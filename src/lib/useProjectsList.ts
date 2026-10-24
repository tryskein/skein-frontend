/**
 * Project listing hooks.
 *
 * Two hooks live here, sharing a base query key:
 *
 *   - `useProjectsList()` — single-shot fetch of the first 100 projects.
 *     Consumers that just need a project-id → idPrefix lookup map
 *     (Inbox column, IssueDetailPanel, useTasks) use this. Same shape
 *     and limits as before the infinite-scroll work landed — keeps the
 *     existing call sites unchanged.
 *
 *   - `useProjectsInfinite(query)` — TanStack `useInfiniteQuery` powering
 *     the Projects column in the new Shell (F3, scenarios doc § Layout).
 *     Paginates 100-at-a-time via `nextCursor`; when `query` changes the
 *     queryKey rotates so the cache treats it as a fresh entry, no
 *     manual reset needed. Surfaces `total` from the first page for the
 *     column-header counter.
 *
 * Why split: lookup callers want a small, snappy single-page response.
 * The Projects column itself is the only surface that needs the full
 * list — pulling it through useInfiniteQuery there preserves the
 * single-page semantics everywhere else.
 *
 * staleTime 60s = projects rarely change. Live-event invalidation (the
 * project-namespace branch in lib/liveEventInvalidation.ts) wipes the
 * `['projects', ...]` predicate on every project event, so creates and
 * archives appear within the SignalR round-trip.
 */

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { listProjects, type ProjectListItem } from '../api/projects';
import { useLayoutState } from './useLayoutState';
import { projectsListQueryKey } from './projectHandleCache';

// sk-439 — the key lives in `projectHandleCache.ts` (a hook-free module
// `useLayoutState` can import without a cycle); re-exported for the
// existing importers.
export { projectsListQueryKey };

const PAGE_SIZE = 100;

/**
 * Single-page projects fetch — kept for callers that only need a
 * lookup map. Shape matches the pre-infinite-scroll behaviour.
 */
export function useProjectsList() {
  return useQuery({
    queryKey: projectsListQueryKey,
    queryFn: () => listProjects({ archived: 'all', limit: PAGE_SIZE }),
    staleTime: 60_000,
  });
}

/**
 * Infinite-scroll result helper consumed by `<ProjectsColumn>`:
 * flattens pages into a single array and surfaces the total reported
 * on the first page.
 */
export interface UseProjectsInfiniteResult {
  items: ProjectListItem[];
  total: number;
  isLoading: boolean;
  isFetching: boolean;
  isFetchingNextPage: boolean;
  isError: boolean;
  hasNextPage: boolean;
  fetchNextPage: () => void;
}

export function useProjectsInfinite(query: string = ''): UseProjectsInfiniteResult {
  const trimmedQuery = query.trim();
  // sk-30 — derive the lens query param from the active lens. Both
  // lenses are mutex upstream so we never have to pick between them.
  // Including `lens` in the queryKey makes lens toggles roll a fresh
  // cache entry instead of mixing rows across lenses.
  const { onMeMode, outboxMode } = useLayoutState();
  const lens: 'on-me' | 'delegated' | undefined = onMeMode
    ? 'on-me'
    : outboxMode
      ? 'delegated'
      : undefined;
  const q = useInfiniteQuery({
    queryKey: [...projectsListQueryKey, 'infinite', trimmedQuery, lens ?? 'all'],
    queryFn: ({ pageParam }) =>
      listProjects({
        archived: 'all',
        limit: PAGE_SIZE,
        cursor: pageParam ?? undefined,
        q: trimmedQuery || undefined,
        lens,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.hasMore ? last.nextCursor ?? undefined : undefined),
    staleTime: 60_000,
  });

  // Flatten pages into a single items[]. Spread is fine here — `pages`
  // is a small array (typically 1..few) so the cost is negligible and
  // the consumer expects a single list.
  const items: ProjectListItem[] = [];
  if (q.data) {
    for (const page of q.data.pages) {
      for (const it of page.items) items.push(it);
    }
  }

  return {
    items,
    total: q.data?.pages[0]?.total ?? 0,
    isLoading: q.isLoading,
    isFetching: q.isFetching,
    isFetchingNextPage: q.isFetchingNextPage,
    isError: q.isError,
    hasNextPage: q.hasNextPage ?? false,
    fetchNextPage: () => {
      // useInfiniteQuery's fetchNextPage returns a promise; we don't
      // need to await it from callers (the IntersectionObserver
      // doesn't care when it lands, only that it was kicked off).
      void q.fetchNextPage();
    },
  };
}
