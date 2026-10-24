/**
 * sk-39 — unsubscribe mutation for Watching cards.
 *
 * Clicking the `×` button on a Watching card sends
 * `DELETE /api/v1/issues/{id}/watch`. On a subscribed card the server
 * deletes the caller's subscription row and records an opt-out from that
 * deleted row, so the automatic paths (creator's errand, assignment,
 * reopen) do not subscribe the caller again; watching by hand removes the
 * opt-out. Without a subscription (a historical card) nothing is recorded
 * and only the card is removed (R3). Either way the card leaves the
 * Watching column (sk-622.21, US-6).
 *
 * UX: optimistic remove from the Watching list (the user's intent is
 * explicit — they clicked the unsubscribe button). The card vanishes
 * immediately; failure rolls back. We also bust the per-issue
 * `['watchers', 'issue', issueId]` cache so the IssueDetail "Watch /
 * Unwatch" surface stays in sync.
 *
 * Header bell `Watching N` may shift if the removed issue had unread
 * events — invalidate `notificationCountsKey` on settle.
 *
 * sk-303.13.2.10 (FE-G2 / C1) — the optimistic patch moves the
 * response's AGGREGATES too, not only `items`. Since T028 the column
 * reads `subscriptionsTotal` / `unreadTotal` off the response instead
 * of counting the cards, so dropping a row while leaving the totals
 * alone produced a screen that contradicts itself: leaving the only
 * silent subscription left `subscriptionsTotal: 1` beside `items: []`
 * and the empty state read "Subscriptions: 1. No new events on them
 * yet." to a user who had just unsubscribed from it; leaving the only
 * subscription that still had unread events left `unreadTotal > 0` with
 * no card, which paints the "Subscriptions exist, but their issues are
 * currently unavailable." fallback — a false claim about visibility.
 *
 * So: subscriptionsTotal − 1 and unreadTotal − (that row's unread), both
 * clamped at zero. `truncated` is untouched on purpose — a prefix with
 * one row removed is still a prefix, and the banner keeps quoting the
 * server's own totals.
 *
 * Rollback needs no extra work: the snapshot is the whole response
 * object, totals included.
 *
 * sk-551.10 — one cache entry per filter (Open / Closed / All). Every
 * one of them is patched: the row leaves the lists that carry it, and
 * the totals move in all of them (`stateTotal` only where the row's task
 * belongs to that filter), by the freshest copy of the row — see
 * `watchingCache.ts`. `truncated` stays as the server said, and every
 * Watching cache is refetched once the request settles.
 *
 * sk-622.21 (US-6) — on a HISTORICAL card (no subscription) the same
 * request is "remove": the server drops the card without an opt-out (R3).
 * The patch is the same card removal, except that `subscriptionsTotal`
 * does not move — a historical card was never a subscription
 * (`withoutCards`).
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { unwatchIssue } from '../api/watchers';
import { notificationCountsKey } from './useNotificationCounts';
import {
  authoritativeRow,
  cancelWatchingFetches,
  invalidateWatching,
  patchWatchingCaches,
  restoreWatchingCaches,
  withoutCards,
  type WatchingSnapshot,
} from './watchingCache';

interface RollbackSnapshot {
  prevWatching?: WatchingSnapshot;
}

export function useUnwatch() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (issueId: string) => {
      if (!issueId) return;
      await unwatchIssue(issueId);
    },
    onMutate: async (issueId) => {
      await cancelWatchingFetches(qc);
      // sk-551.10 review — the shared totals move by the FRESHEST copy of
      // the row (its unread count, status and reasons); each list drops
      // the card only if it carries it.
      const removed = authoritativeRow(qc, issueId);
      const snap: RollbackSnapshot = {};
      // Only charge the totals for a row we actually know — an unwatch
      // fired from IssueDetail on an issue no cached list carried must
      // not decrement anything here.
      if (!removed) return snap;
      snap.prevWatching = patchWatchingCaches(qc, (prev) => withoutCards(prev, [removed]));
      return snap;
    },
    onError: (_err, _id, context) => {
      const ctx = context as RollbackSnapshot | undefined;
      restoreWatchingCaches(qc, ctx?.prevWatching);
    },
    onSettled: (_data, _err, issueId) => {
      // The optimistic numbers are a guess; the server's replace them.
      void invalidateWatching(qc);
      // Header bell shifts if the removed issue had unread events.
      qc.invalidateQueries({ queryKey: notificationCountsKey });
      // IssueDetail watch panel reflects the new state.
      if (issueId) {
        qc.invalidateQueries({ queryKey: ['watchers', 'issue', issueId] });
      }
    },
  });
}
