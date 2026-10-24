/**
 * The 60-second safety net of a live tab (spec sk-622.21 US-14, R11, R13,
 * D5; plan T045, K18 row "60 s safety net").
 *
 * A personal signal may be lost (R11, R13): it is published after the
 * commit, best effort, and a lost one leaves no trace — not even a changed
 * number, when the badge stays the same while the column under it changed.
 * Once every {@link LIVE_SAFETY_NET_MS} the tab re-reads exactly what a lost
 * signal could leave stale and what is cheap to read:
 *   - the header counters `['notification-counts']`;
 *   - the personal queues on screen — Inbox, Mentions, Watching;
 *   - the open issue card (`['issues','detail',openId]`; its private review
 *     fields follow `unreviewed`, R13);
 *   - the task list with the «unreviewed» filter (R13), first page (K21).
 * Everything else personal follows R11 (focus, visibility, navigation —
 * `liveVisibility.ts`).
 *
 * The tick goes through the coalescing batcher like every other reset, so
 * it is applied with the next wave, only mounted readers re-read
 * (`refetchType: 'active'` — «visible» queues), and a hidden tab sends
 * nothing: the tick only leaves obligations (K22) that the return of
 * visibility walks. Inbox keeps the card accepted in this tab (R12, T046).
 *
 * The counters used to poll themselves every 30 s
 * (`useNotificationCounts.ts`); the safety net and the signals replace it.
 */

import type { Query } from '@tanstack/react-query';
import { tasksListInfo } from './liveEventInvalidation';
import type { LiveInvalidationTarget } from './liveInvalidationBatcher';

/** Period of the safety net, ms (spec US-14: "once per 60 s"). */
export const LIVE_SAFETY_NET_MS = 60_000;

/** Apply one tick: exactly the keys of the K18 row "60 s safety net". */
export function invalidateSafetyNet(target: LiveInvalidationTarget): void {
  target.invalidateQueries({ queryKey: ['notification-counts'] });
  target.invalidateQueries({ queryKey: ['inbox'] });
  target.invalidateQueries({ queryKey: ['mentions'] });
  target.invalidateQueries({ queryKey: ['watching'] });
  target.invalidateQueries({ queryKey: ['issues', 'detail'] });
  target.invalidateQueries({
    predicate: (q: Query) => tasksListInfo(q.queryKey)?.status === 'unreviewed',
    firstPageOnly: true,
  });
}

/**
 * Start the safety net of one live connection; returns the stop function.
 * Started and stopped with the connection's batcher (`useLiveEvents.tsx`).
 */
export function startLiveSafetyNet(
  target: LiveInvalidationTarget,
  periodMs: number = LIVE_SAFETY_NET_MS,
): () => void {
  const timer = setInterval(() => invalidateSafetyNet(target), periodMs);
  return () => clearInterval(timer);
}
