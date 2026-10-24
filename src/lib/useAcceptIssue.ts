/**
 * Accept-issue mutation hook — drives the [✓ Accept] button in the
 * Inbox column (F3) and (later) the Details panel (F5).
 *
 * Optimistic-update strategy:
 *   1. On `mutate`, set `acceptedAt = now()` on the matching item in
 *      the inbox cache so the card stays in the list but turns gray
 *      (matches the Mentions mark-read UX — the user keeps the
 *      context of what they just acknowledged).
 *   2. On error, restore the previous cache snapshot AND surface the
 *      reason via toast — the user knows their click didn't land.
 *   3. On success, re-seed the per-issue detail cache.
 *
 * We do NOT invalidate the inbox query on settled. sk-622.21 (R12, K19):
 * an accept sent from the Inbox column (`retainOnRoute`) also leaves a
 * snapshot of the dimmed card (`inboxAcceptedRetention.ts`), so no later
 * re-read of Inbox in this tab — the personal signal `inbox`, focus,
 * resync, the safety net (a project's status / accept event does not
 * re-read it, R22) — takes it away before the route changes.
 *
 * Notification counts ARE invalidated so the header bell badge ticks
 * down as soon as the row is accepted.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { acceptIssue, type IssueDetail, type ListIssuesResult } from '../api/issues';
import { BusinessError } from '../api/client';
import { inboxQueryKey } from './useInbox';
import {
  applyAcceptedRetention,
  releaseAccepted,
  retainAccepted,
} from './inboxAcceptedRetention';
import { useToaster } from '../components/Toaster';
import { useAuthOptional } from '../auth/AuthContext';

export interface AcceptArgs {
  id: string;
  expectedVersion: number;
  /**
   * The route of the Inbox column the accept was sent from. When set, the
   * accepted card is kept dimmed in place on that route (R12, K19).
   */
  retainOnRoute?: string;
}

interface AcceptContext {
  /** Pre-mutation snapshot — used to restore on error. */
  previousInbox: ListIssuesResult | undefined;
}

export function useAcceptIssue() {
  const qc = useQueryClient();
  const toast = useToaster();
  // Whose snapshot it is (`inboxAcceptedRetention.ts`): the column lays back
  // only the signed-in person's.
  const identity = useAuthOptional()?.user?.id ?? null;

  return useMutation<IssueDetail, Error, AcceptArgs, AcceptContext>({
    mutationFn: ({ id, expectedVersion }) => acceptIssue(id, expectedVersion),

    // Optimistic patch — mark the matching item as accepted in place.
    // The card stays in the inbox list (rendered dimmed) until the
    // next refetch drops it server-side. Matches the Mentions feed UX.
    onMutate: async ({ id, retainOnRoute }) => {
      await qc.cancelQueries({ queryKey: inboxQueryKey });
      const previousInbox = qc.getQueryData<ListIssuesResult>(inboxQueryKey);
      if (previousInbox) {
        const now = new Date().toISOString();
        if (retainOnRoute !== undefined) {
          // The position is the one on SCREEN: the list as the column shows
          // it, with the cards already accepted here laid back in. The cache
          // holds the server's answer, which no longer has them after a
          // re-read — an index taken there would shift the card by the
          // number of accepted cards above it (R12: "in place").
          const shown = applyAcceptedRetention(previousInbox, retainOnRoute, identity).items;
          const index = shown.findIndex((it) => it.id === id);
          if (index >= 0) {
            // Before the cache write: the column's `select` lays the snapshot
            // in as soon as the optimistic answer lands.
            retainAccepted({ ...shown[index], acceptedAt: now }, index, retainOnRoute, identity);
          }
        }
        qc.setQueryData<ListIssuesResult>(inboxQueryKey, {
          ...previousInbox,
          items: previousInbox.items.map((it) =>
            it.id === id ? { ...it, acceptedAt: now } : it,
          ),
        });
      }
      return { previousInbox };
    },

    onError: (err, { id }, ctx) => {
      // Rollback — clear the optimistic acceptedAt so the user doesn't
      // see a phantom "accepted" state. The snapshot goes first: the
      // restored answer must not have the dimmed card laid back in.
      releaseAccepted(id);
      if (ctx?.previousInbox) {
        qc.setQueryData<ListIssuesResult>(inboxQueryKey, ctx.previousInbox);
      }
      const message =
        err instanceof BusinessError
          ? `Accept ${id} failed: ${err.message}`
          : `Accept ${id} failed: ${err.message ?? 'network error'}`;
      toast.error(message);
    },

    onSuccess: (detail, { id }) => {
      toast.success(`Accepted ${id}`);
      // Re-seed the per-issue detail so the Details column sees the
      // new acceptedAt/version without a fresh GET.
      qc.setQueryData(['issues', 'detail', id], detail);
    },

    onSettled: () => {
      // Header bell badge reflects unaccepted counts — refresh that.
      // We deliberately do NOT invalidate the inbox feed: keeping the
      // dimmed card around is the whole point of the optimistic patch.
      qc.invalidateQueries({
        predicate: (q) =>
          Array.isArray(q.queryKey) && q.queryKey[0] === 'notifications',
      });
    },
  });
}
