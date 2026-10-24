/**
 * sk-551.10 — optimistic writes over EVERY cached Watching list.
 *
 * Since the Open / Closed / All filter, the Watching feed is cached once
 * per filter (`['watching', 'feed', <state>]`). A mutation that patched
 * only one of them would leave the others contradicting it: unsubscribe
 * on «All», switch to «Closed», and the card is back until a refetch.
 * So the optimistic writers walk all of them, and the snapshot they
 * return restores all of them.
 *
 * Review (sk-551.10): the caches are fetched at
 * different moments, so one subscription can look different in two of
 * them — a stale inactive «Open» next to a fresh «All». Two rules follow:
 *
 *   - a ROW is patched from that cache's own copy of it, never from a
 *     copy found in another cache;
 *   - a TOTAL that every filter shares (unreadTotal, subscriptionsTotal,
 *     the open/closed split) moves by a delta taken from the FRESHEST
 *     copy of the row (`authoritativeRow`, by `dataUpdatedAt`);
 *
 * and every writer invalidates all Watching caches once it settles
 * (`invalidateWatching`, inactive ones included), so the optimistic
 * numbers are replaced by the server's rather than trusted.
 */

import type { QueryClient, QueryKey } from '@tanstack/react-query';
import {
  isHistoricalWatchingCard,
  watchingStateIncludes,
  type WatchingItem,
  type WatchingListResponse,
} from '../api/notifications';
import { watchingQueryKey } from './useWatching';

/** Every cached Watching list as it was before a patch. */
export type WatchingSnapshot = Array<[QueryKey, WatchingListResponse | undefined]>;

export function readWatchingCaches(qc: QueryClient): WatchingSnapshot {
  return qc.getQueriesData<WatchingListResponse>({ queryKey: watchingQueryKey });
}

/**
 * The copy of a subscription from the most recently fetched Watching
 * cache that carries it, or `undefined` when no cache does.
 */
export function authoritativeRow(qc: QueryClient, issueId: string): WatchingItem | undefined {
  let best: { row: WatchingItem; at: number } | undefined;
  for (const query of qc.getQueryCache().findAll({ queryKey: watchingQueryKey })) {
    const data = query.state.data as WatchingListResponse | undefined;
    const row = data?.items.find((it) => it.item.id === issueId);
    if (!row) continue;
    const at = query.state.dataUpdatedAt;
    if (!best || at > best.at) best = { row, at };
  }
  return best?.row;
}

/**
 * Apply `patch` to every cached Watching list that has data, and return
 * the snapshot to restore on failure.
 */
export function patchWatchingCaches(
  qc: QueryClient,
  patch: (prev: WatchingListResponse) => WatchingListResponse,
): WatchingSnapshot {
  const snap = readWatchingCaches(qc);
  for (const [key, prev] of snap) {
    if (prev) qc.setQueryData<WatchingListResponse>(key, patch(prev));
  }
  return snap;
}

export function restoreWatchingCaches(qc: QueryClient, snap: WatchingSnapshot | undefined) {
  if (!snap) return;
  for (const [key, prev] of snap) {
    qc.setQueryData(key, prev);
  }
}

/**
 * Cancel in-flight Watching fetches before an optimistic write — but only
 * those that already HAVE data to protect. Cancelling a first fetch (a
 * filter just chosen, still showing the previous filter as placeholder)
 * reverts it to `pending` with nothing to retry it: the list would sit on
 * the placeholder for good. That fetch is left to land; the settle-time
 * invalidation reconciles it anyway.
 */
export async function cancelWatchingFetches(qc: QueryClient): Promise<void> {
  await qc.cancelQueries({
    queryKey: watchingQueryKey,
    predicate: (q) => q.state.data !== undefined,
  });
}

/** Refetch every Watching cache, inactive filters included. */
export function invalidateWatching(qc: QueryClient) {
  return qc.invalidateQueries({ queryKey: watchingQueryKey, refetchType: 'all' });
}

/**
 * Take the given cards off one cached list. `removed` are the
 * AUTHORITATIVE copies of the rows (see `authoritativeRow`): they decide
 * how the shared totals move; whether a card leaves THIS list is decided
 * by this list's own items.
 *
 * sk-622.21 (US-5) — a card is subscribed or historical. Both leave the
 * card totals (open / closed / closedAuto / state) and take their unread
 * with them; only a subscribed card is a subscription, so only those move
 * `subscriptionsTotal`.
 */
export function withoutCards(
  prev: WatchingListResponse,
  removed: readonly WatchingItem[],
): WatchingListResponse {
  if (removed.length === 0) return prev;
  const ids = new Set(removed.map((r) => r.item.id));
  let subscriptions = 0;
  let open = 0;
  let closed = 0;
  let closedAuto = 0;
  let inState = 0;
  let unread = 0;
  for (const r of removed) {
    if (!isHistoricalWatchingCard(r)) subscriptions += 1;
    const isClosed = r.item.status === 'closed';
    if (isClosed) {
      closed += 1;
      if (!r.reasons.includes('manual')) closedAuto += 1;
    } else {
      open += 1;
    }
    if (watchingStateIncludes(prev.state, r.item.status)) inState += 1;
    unread += r.unreadEventsCount;
  }
  return {
    ...prev,
    items: prev.items.filter((it) => !ids.has(it.item.id)),
    subscriptionsTotal: Math.max(0, prev.subscriptionsTotal - subscriptions),
    openTotal: Math.max(0, prev.openTotal - open),
    closedTotal: Math.max(0, prev.closedTotal - closed),
    closedAutoTotal: Math.max(0, prev.closedAutoTotal - closedAuto),
    stateTotal: Math.max(0, prev.stateTotal - inState),
    unreadTotal: Math.max(0, prev.unreadTotal - unread),
  };
}

/**
 * «Read card X» (US-7) applied to one cached list: every unread
 * notification whose card is X is read now — the task's own and its
 * descendants', in the window and outside it. So X's card loses its whole
 * unread count and every row of its timeline is read; the card stays (a
 * subscription stays a subscription, a historical card stays while it has
 * notifications in the window, read or not).
 *
 * `cleared` is how much the shared `unreadTotal` drops — the badge moves
 * by exactly the card's unread inside the window, which is the FRESHEST
 * copy's `unreadEventsCount` (the caller passes it, see
 * `authoritativeRow`). Other cards are untouched.
 */
export function withCardRead(
  prev: WatchingListResponse,
  issueId: string,
  cleared: number,
  readAt: string,
): WatchingListResponse {
  return {
    ...prev,
    unreadTotal: Math.max(0, prev.unreadTotal - cleared),
    items: prev.items.map((it) =>
      it.item.id === issueId
        ? {
            ...it,
            unreadEventsCount: 0,
            recentEvents: it.recentEvents.map((ev) => (ev.readAt ? ev : { ...ev, readAt })),
          }
        : it,
    ),
  };
}
