/**
 * Watching feed query (sk-39).
 *
 * Sibling of `useMentions` — different surface, same shape. Returns the caller's active issue subscriptions, each row
 * carrying the issue summary, every reason the caller is subscribed
 * (creator/assignee/manual — sorted by server),
 * the unread-events badge count, and the top-5 recent events on the
 * issue within the last 7 days.
 *
 * Watching is a list of CARDS first, event feed second (sk-622.21, US-5):
 * subscribed cards and historical ones (no subscription, notifications
 * still in the window). A click on a card is «read card X» (US-7,
 * `useMarkWatchingCardRead`): every unread notification of the card
 * — the task's own and its descendants' — is read, and the card STAYS in
 * the list; only the badge clears. Leaving is explicit (× on each card →
 * DELETE /api/v1/issues/{id}/watch — «unsubscribe» on a subscribed card,
 * «remove» on a historical one).
 *
 * sk-551.10 — the list is filtered Open / Closed / All on the server,
 * and each filter is its own cache entry under the common prefix
 * `watchingQueryKey`. Live-event invalidation (`liveEventInvalidation.ts`)
 * matches the `'watching'` head, so it reaches every filter; optimistic
 * writers go through `watchingCache.ts`, which patches all of them.
 *
 * staleTime 30s mirrors the inbox / mentions cadence.
 */

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { fetchWatching, type WatchingState } from '../api/notifications';

/** Prefix of every Watching list cache entry (one per filter). */
export const watchingQueryKey = ['watching', 'feed'] as const;

export function watchingStateQueryKey(state: WatchingState) {
  return [...watchingQueryKey, state] as const;
}

export function useWatching(state: WatchingState = 'open') {
  return useQuery({
    queryKey: watchingStateQueryKey(state),
    // The query's signal goes to fetch: a cancelled query also aborts
    // its HTTP request instead of letting it land into nothing.
    queryFn: ({ signal }) => fetchWatching(state, signal),
    staleTime: 30_000,
    // Switching the filter keeps the previous list on screen until the
    // new one arrives: the queue picker's number (unreadTotal, the same
    // for every filter) must not drop to zero for a round-trip, and the
    // column must not flash «Loading». The response carries its own
    // `state`, so what is shown is never mislabelled.
    placeholderData: keepPreviousData,
  });
}
