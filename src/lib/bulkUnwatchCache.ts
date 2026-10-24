/**
 * sk-551.10 — what a FINISHED bulk unwatch is known to have done to one
 * cached Watching list. Pure: the hook applies it to every cache.
 *
 *   - `issueIds`: those subscriptions are gone. The totals move by the
 *     freshest known copy of each row (`removed`), exactly as a single
 *     unwatch moves them.
 *   - `state` sweep: the server reports how many it stopped
 *     (`result.unwatched`) but not which ones beyond the cards on screen.
 *     Cards in this list that the sweep certainly covered (task in the
 *     swept state, and no manual reason unless `includeManual`) are
 *     dropped; the counters the number determines are moved by it. What
 *     it does not determine — the unread total of rows nobody has on
 *     screen, the open/closed split of an «all» sweep — is left to the
 *     refetch that follows.
 *
 * sk-622.21 (US-6) — a sweep also removes the historical cards of tasks in
 * the swept state (`result.historicalRemoved`, counted in cards). Those
 * are cards, not subscriptions: they move the card totals (open / closed /
 * closedAuto / state) beside the stopped subscriptions, never
 * `subscriptionsTotal`. A historical card has no manual reason, so the
 * on-screen ones fall under `swept` like any automatic subscription.
 */

import {
  watchingStateIncludes,
  type WatchingItem,
  type WatchingListResponse,
} from '../api/notifications';
import type { BulkUnwatchInput, BulkUnwatchResult } from '../api/watchers';
import { withoutCards } from './watchingCache';

export function applyBulkUnwatch(
  prev: WatchingListResponse,
  input: BulkUnwatchInput,
  result: BulkUnwatchResult,
  removed: readonly WatchingItem[],
): WatchingListResponse {
  if ('issueIds' in input) {
    return withoutCards(prev, removed);
  }
  const { state } = input;
  const includeManual = input.includeManual === true;
  const n = result.unwatched;
  // Cards that left: one per stopped subscription plus the historical ones.
  const cards = n + result.historicalRemoved;
  const swept = (it: WatchingItem) =>
    watchingStateIncludes(state, it.item.status) &&
    (includeManual || !it.reasons.includes('manual'));
  const next: WatchingListResponse = {
    ...prev,
    items: prev.items.filter((it) => !swept(it)),
    subscriptionsTotal: Math.max(0, prev.subscriptionsTotal - n),
  };
  if (state === 'closed') {
    next.closedTotal = Math.max(0, prev.closedTotal - cards);
    next.closedAutoTotal = includeManual ? 0 : Math.max(0, prev.closedAutoTotal - cards);
  } else if (state === 'open') {
    next.openTotal = Math.max(0, prev.openTotal - cards);
  }
  // The selected filter's own size moves only when the sweep covered it
  // entirely or exactly: «all» always contains the swept rows; a filter
  // equal to the swept state does too; the other one is untouched.
  if (prev.state === 'all' || prev.state === state) {
    next.stateTotal = Math.max(0, prev.stateTotal - cards);
  }
  return next;
}
