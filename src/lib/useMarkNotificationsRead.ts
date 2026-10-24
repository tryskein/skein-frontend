/**
 * sk-38 — batch mark-as-read mutation for Mentions cards.
 *
 * Clicking a mention card opens the underlying issue AND marks the
 * notification read. UX requirement: the card should NOT disappear from
 * the feed immediately — instead it stays visible in a grayed-out state
 * so the user keeps the context of what they just dismissed. On the next
 * natural refresh (live event, reload, etc.) the server-side filter
 * excludes read items and the card is gone.
 *
 * Implementation: optimistic cache update sets `readAt = now()` on the
 * matching items in `mentionsQueryKey`. The mutation takes a list of ids
 * and does not care which surface they came from. We deliberately DO NOT
 * invalidate the feed — that would refetch and drop the cards before the
 * user can scan them. The notification-counts query IS invalidated so
 * the header bell badges tick down immediately.
 *
 * sk-303.13 (T026) — this hook used to patch a second cache slot, the
 * Outbox feed. That surface is gone (US-9) and so is its query key; a
 * snapshot/patch/rollback of a cache nothing reads is dead weight, not
 * defensive coding.
 *
 * The backend exposes `POST /api/v1/notifications/:id/read` for
 * single-row mark-read. Batch fan-out via Promise.all — typical batch
 * size is small (1-5 events). The read flag is monotonic; one
 * failure rejects the whole mutation but partial-success state is
 * benign (a stale cache entry that the next refresh will reconcile).
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { markRead, type ListNotificationsResult } from '../api/notifications';
import { mentionsQueryKey } from './useMentions';
import { notificationCountsKey } from './useNotificationCounts';

/**
 * Snapshot of the cache captured pre-mutation for rollback on error.
 * Stored under the mutation's `context` slot so the existing TanStack
 * `onError(ctx)` signature still applies; the pointer may be undefined
 * when the query hasn't been touched yet.
 */
interface RollbackSnapshot {
  prevMentions?: ListNotificationsResult;
}

export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  return useMutation<void, Error, number[]>({
    mutationFn: async (ids: number[]) => {
      if (ids.length === 0) return;
      await Promise.all(ids.map((id) => markRead(id)));
    },
    onMutate: async (ids) => {
      // Optimistic update — mark the supplied ids as read in the
      // mentions feed cache so the card turns gray immediately. We
      // cancel any in-flight query for that key first to prevent the
      // patch being clobbered by a stale-but-still-arriving response.
      await qc.cancelQueries({ queryKey: mentionsQueryKey });

      const idSet = new Set(ids);
      const now = new Date().toISOString();

      const snap: RollbackSnapshot = {};

      const prevMentions = qc.getQueryData<ListNotificationsResult>(mentionsQueryKey);
      if (prevMentions) {
        snap.prevMentions = prevMentions;
        qc.setQueryData<ListNotificationsResult>(mentionsQueryKey, {
          ...prevMentions,
          items: prevMentions.items.map((it) =>
            idSet.has(it.id) ? { ...it, readAt: now } : it,
          ),
        });
      }
      return snap;
    },
    onError: (_err, _ids, context) => {
      const ctx = context as RollbackSnapshot | undefined;
      if (ctx?.prevMentions) {
        qc.setQueryData(mentionsQueryKey, ctx.prevMentions);
      }
    },
    onSettled: () => {
      // Header bell badge reflects unread counts — refresh that. We
      // deliberately do NOT invalidate the mentions feed: keeping the
      // grayed card around is the whole point of the optimistic update. Live-event invalidation handles the
      // eventual refresh when new activity comes in.
      qc.invalidateQueries({ queryKey: notificationCountsKey });
    },
  });
}
