/**
 * Inbox query — open issues from other people assigned to the caller
 * that haven't been accepted yet (assignee = me ∧ createdBy ≠ me ∧
 * accepted_at IS NULL ∧ status = 'open'). Powers the Inbox column in
 * the new Shell (F3, scenarios doc Sc1).
 *
 * The `createdBy ≠ me` clause is the semantic anchor: Inbox is "from
 * others". Without it, anything the caller's own agent creates under
 * the shared api_key (api_key → owning user, so agent and human are
 * the same identity at the audit layer) would land here, polluting
 * the "incoming from others" surface with the user's own work.
 *
 * Cache key is intentionally flat — there's exactly one Inbox surface
 * per user, so we don't parametrise the key. Project events do not re-read
 * it (sk-622.21 R22): the personal signal `inbox` (lib/livePersonalSignal.ts)
 * and the 60 s safety net (lib/liveSafetyNet.ts) do.
 *
 * staleTime 30s = "treat the cache as fresh for half a minute" —
 * mirrors the notifications-count cadence (R3.2d). On manual remount
 * (route nav, F5 polish) TanStack will revalidate at 30s+; on live
 * events the explicit invalidation forces an immediate refetch.
 */

import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listAssignedToMe, type ListIssuesResult } from '../api/issues';
import { applyAcceptedRetention, useAcceptedRetentionRevision } from './inboxAcceptedRetention';
import { useAuthOptional } from '../auth/AuthContext';

export const inboxQueryKey = ['inbox', 'assigned-to-me-unaccepted-open'] as const;

/**
 * @param route the route the Inbox column is shown on. When given, cards
 *   accepted in this tab on this route are laid back into every answer at
 *   their former positions (sk-622.21 R12, K19 —
 *   `inboxAcceptedRetention.ts`) — those the signed-in person accepted; the
 *   cache itself holds the server's answer.
 */
export function useInbox(route?: string) {
  // The snapshots belong to the person who accepted (sk-622.21 R12): the
  // projection depends on the signed-in identity, so a change of identity
  // recomputes it at once — TanStack keeps a `select` result for as long as
  // the data and the function are the same.
  const identity = useAuthOptional()?.user?.id ?? null;
  // A loss of access releases snapshots on the same route and identity
  // (`releaseAcceptedWhere`): the revision makes the projection run again.
  const revision = useAcceptedRetentionRevision();
  const select = useCallback(
    (data: ListIssuesResult) => {
      void revision;
      return route === undefined ? data : applyAcceptedRetention(data, route, identity);
    },
    [route, identity, revision],
  );
  return useQuery({
    queryKey: inboxQueryKey,
    queryFn: () =>
      listAssignedToMe({
        acceptedAtNull: true,
        status: 'open',
        createdBy: 'not-me',
        limit: 100,
      }),
    staleTime: 30_000,
    select,
  });
}
