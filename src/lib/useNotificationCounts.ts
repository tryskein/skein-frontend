/**
 * TanStack Query hook for the header-badge counters (F6).
 *
 * Refresh strategy (sk-622.21 US-11, US-14):
 *
 *   1. On mount and on every reset by the personal signal (`inbox`,
 *      `mentions`, `watching`, `lens`, `unreviewed` —
 *      `livePersonalSignal.ts`). Project events do NOT touch it (US-13).
 *   2. On window focus — catches tab returns.
 *   3. The 60 s safety net of the live connection (`liveSafetyNet.ts`,
 *      T045) against a lost signal. The hook no longer polls itself: its
 *      own 30 s `refetchInterval` doubled the safety net and ran even in a
 *      hidden tab (SC-006).
 *
 * Returns a stable `counts` object that defaults to all-zeros on the
 * first paint so the header badges can render unconditionally without
 * `undefined` checks at every call site.
 */
import { useQuery } from '@tanstack/react-query';
import {
  EMPTY_NOTIFICATION_COUNTS,
  getNotificationCounts,
} from '../api/notification-counts';

/**
 * Single source of truth for the query key shape. Exported so
 * `liveEventInvalidation.ts` can target the same key without
 * import-cycling on the hook itself (the invalidator only needs the
 * key, not the fetcher).
 */
export const notificationCountsKey = ['notification-counts'] as const;

export function useNotificationCounts() {
  const q = useQuery({
    queryKey: notificationCountsKey,
    queryFn: getNotificationCounts,
    refetchOnWindowFocus: true,
    staleTime: 10_000,
  });
  return {
    counts: q.data ?? EMPTY_NOTIFICATION_COUNTS,
    isLoading: q.isLoading,
    error: q.error,
  };
}
