/**
 * sk-29.2 — TanStack Query hook for the /dashboard/race endpoint.
 *
 * Cache key is `['dashboard', 'race', metric, window, topN, space]` so chip
 * switches read out of cache when the user toggles back and forth; refetch
 * every 60s keeps cold-start day buckets fresh without piggy-backing
 * on every envelope. Real-time increment is handled separately by the
 * RaceChart component (envelope listener → in-memory `useState` patch
 * applied to the query data via `queryClient.setQueryData`).
 *
 * Defaults match the spec: metric=closed, window=30d, topN=8. The
 * topN bound is wired in case a future surface wants 5 or 12; the
 * UI does not expose a control today.
 *
 * sk-674.18 T056 — `space` is the HOT ZONE page's space choice (screens
 * 1.12, `?space=`); null — every space of the caller.
 */

import { keepPreviousData, useQuery } from '@tanstack/react-query';

import {
  getDashboardRace,
  type RaceMetric,
  type RaceResult,
  type RaceWindow,
} from '../api/dashboard';

export interface UseDashboardRaceArgs {
  metric: RaceMetric;
  window: RaceWindow;
  topN?: number;
  space?: string | null;
  /** False — do not ask yet. Default true. */
  enabled?: boolean;
}

export function raceQueryKey(
  metric: RaceMetric,
  window: RaceWindow,
  topN: number,
  space: string | null,
) {
  return ['dashboard', 'race', metric, window, topN, space] as const;
}

export function useDashboardRace({ metric, window, topN = 8, space = null, enabled = true }: UseDashboardRaceArgs) {
  return useQuery<RaceResult>({
    enabled,
    queryKey: raceQueryKey(metric, window, topN, space),
    queryFn: () => getDashboardRace({ metric, window, topN, space }),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    staleTime: 10_000,
    // sk-68 — keep the previous race result (and its rendered SVG, which
    // owns ~400px of vertical space) on screen while a metric/window chip
    // switch refetches. metric + window are both in the query key, so
    // without this the chip click drops `data` to `undefined`, the body
    // collapses to a one-line `<p>loading…</p>` placeholder, and the
    // whole page below the chart jumps up until the new data arrives.
    placeholderData: keepPreviousData,
  });
}
