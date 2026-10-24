/**
 * sk-622.21 (US-7) — the Watching card's click: «read card X», sent on
 * every ordinary open of the card (`InboxColumn.tsx#InboxColumn`). The
 * column's earlier read went through `mark-read-by-entity`, which could
 * not reach a subtree card's descendants' notifications.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { markWatchingCardRead, type MarkCardReadResult } from '../api/notifications';
import { notificationCountsKey } from './useNotificationCounts';
import {
  authoritativeRow,
  cancelWatchingFetches,
  invalidateWatching,
  patchWatchingCaches,
  restoreWatchingCaches,
  withCardRead,
  type WatchingSnapshot,
} from './watchingCache';

interface CardReadRollback {
  prevWatching?: WatchingSnapshot;
}

/**
 * sk-622.21 (US-7) — «read card X»: the click on a Watching card.
 *
 * POST /api/v1/me/watching/{issueId}/read reads every unread notification
 * of the caller whose card is X — the task's own and, on a subtree card,
 * its descendants', inside the window and outside it. It replaced
 * `mark-read-by-entity` here, which reads the task's own events only: on
 * a subtree card that left the descendants' unread standing, and the
 * badge never reached zero by clicking the card (the defect US-7 was
 * filed for). `mark-read-by-entity` keeps its own contract for its other
 * callers.
 *
 * Optimistic, because the outcome is fully known: in every cached filter
 * X's card drops to zero unread with its timeline read, and the shared
 * `unreadTotal` drops by the card's in-window unread — the FRESHEST copy's
 * `unreadEventsCount` (`authoritativeRow`), exactly the badge drop the
 * contract promises. Mentions are not touched: a mention never has a
 * card. On failure every cache is restored; once the request settles the
 * Watching caches and the header counters are refetched, so the server's
 * numbers replace the guess.
 */
export function useMarkWatchingCardRead() {
  const qc = useQueryClient();
  return useMutation<MarkCardReadResult, Error, string, CardReadRollback>({
    mutationFn: (issueId: string) => markWatchingCardRead(issueId),
    onMutate: async (issueId) => {
      await cancelWatchingFetches(qc);
      const cleared = authoritativeRow(qc, issueId)?.unreadEventsCount ?? 0;
      const readAt = new Date().toISOString();
      return {
        prevWatching: patchWatchingCaches(qc, (prev) =>
          withCardRead(prev, issueId, cleared, readAt),
        ),
      };
    },
    onError: (_err, _id, context) => {
      restoreWatchingCaches(qc, context?.prevWatching);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: notificationCountsKey });
      void invalidateWatching(qc);
    },
  });
}
