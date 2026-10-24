/**
 * sk-36 F2 — `useLayeredTree` shared hook for the layered tree-view
 * surfaces (Tasks-column tree + `EpicProgressSection` children list).
 *
 * Wraps `fetchIssueTree` in a `useQuery` so the cache lifecycle, retries,
 * and live-event invalidation all behave consistently with the rest of
 * the shell. The returned `tree` is the raw flat row list from the
 * backend (matches the new wire shape — see `api/issues.ts::IssueTreeNode`);
 * callers handle the flat-row rendering directly.
 *
 * `tooLarge` is the 422 `tree_too_large` branch raised back as a flag so
 * the caller can render an inline banner without having to type-check
 * the underlying `BusinessError`.
 *
 * Query key shape (stable so the live-event invalidation router can
 * predicate-match without enumerating every type permutation):
 *
 *   ['issues', 'tree', <project | __cross__>, <rootId | __forest__>,
 *    '<sorted,types>', <maxDepth | __full__>]
 *
 * sk-421.2 T017 (F-3) — the last segment was added: the key must distinguish
 * not only the query variant but also the DEPTH. The epic section requests data
 * of the active mode only (R-7): "List" — depth 1, "Tree" — a full
 * walk. Without the depth segment the two modes would share one cache entry, and
 * switching would show someone else's answer. The `__full__` sentinel keeps the shape of the
 * key the same length for all queries — like `__cross__` and `__forest__`
 * above; the react-query cache here is in memory only (the project has no persister,
 * see `lib/appQueryClient.ts`), so changing the key shape costs nothing
 * between sessions, and within a session all that matters is that the query site and the
 * invalidation site compute the key IDENTICALLY.
 *
 * sk-421.2.8 T009 (R-9) — the seventh segment: the "include blockers" flag
 * (`__blockers__` / `__no_blockers__`). The epic section asks for the `blockers` field,
 * the tasks column does not (D-2); without the segment they would share a cache entry with equal other
 * arguments, and one would get the other's answer. A sentinel for BOTH
 * values keeps the key length constant. The `['issues','tree']` prefix is
 * unchanged, so live invalidations by prefix cover both variants.
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { BusinessError } from '../api/client';
import {
  fetchIssueTree,
  type IssueStatus,
  type IssueTreeNode,
  type IssueTreeRowItem,
} from '../api/issues';
import type { DepType } from '../api/dependencies';

/** Sentinel key "depth is unlimited". */
const FULL_DEPTH = '__full__';
/** Sentinel keys of the "include blockers" flag (R-9). */
const WITH_BLOCKERS = '__blockers__';
const WITHOUT_BLOCKERS = '__no_blockers__';

export interface UseLayeredTreeArgs {
  /** Project alias / UUID — when null, hits the cross-project endpoint. */
  project: string | null;
  /** Anchor issue id; null walks the forest of root issues. */
  rootId: string | null;
  /** Validated subset of `DepType` the caller toggled on. */
  types: DepType[];
  /**
   * sk-421.2 (US-3, R-7) — limit on the walk depth, counted from the seed row
   * (depth 0): `1` gives the roots and their direct children. Not set — a full walk.
   * Part of the cache key, so the two section modes do not share one entry.
   */
  maxDepth?: number;
  /**
   * sk-421.2.8 (US-4, D-2, R-9) — ask the server for the `blockers` field of nodes.
   * Passed through to `fetchIssueTree` and part of the cache key. The tasks column
   * does not pass it; `false` and absence give the same key and request.
   */
  includeBlockers?: boolean;
  /** When false, the underlying query is gated off. */
  enabled?: boolean;
}

export interface UseLayeredTreeResult {
  tree: IssueTreeNode[];
  isLoading: boolean;
  error: unknown;
  /**
   * True iff the backend returned 422 `tree_too_large`. The query's
   * `error` is still populated with the underlying `BusinessError`;
   * this flag is a UI affordance, not a substitute.
   */
  tooLarge: boolean;
  /**
   * sk-421.2 T017 (US-2 "Freshness on display") — the moment the shown
   * response was REQUESTED; `null` while there is no response.
   *
   * Requested, not received: a response sent BEFORE a live event and
   * arriving AFTER it knows nothing about the change, and by arrival time it
   * would falsely look fresh. Compared with the section's clock
   * (`lib/epicSectionClock.ts`).
   *
   * Lives in the cache together with the rows, so it survives unmounting:
   * opening a card must judge the freshness of the response it
   * will show, not of the one currently being requested.
   */
  requestedAt: number | null;
}

/** What lies in the cache: the rows plus the moment this response was requested. */
interface LayeredTreePayload {
  rows: IssueTreeNode[];
  requestedAt: number;
}

/**
 * Compose the stable react-query key for a tree query.
 * Exported so consumers (live-event invalidation, prefetchers, tests)
 * can compute the same key without re-implementing the shape.
 */
export function layeredTreeQueryKey(
  project: string | null,
  rootId: string | null,
  types: readonly DepType[],
  maxDepth?: number,
  includeBlockers?: boolean,
): readonly unknown[] {
  return [
    'issues',
    'tree',
    project ?? '__cross__',
    rootId ?? '__forest__',
    [...types].sort().join(','),
    maxDepth ?? FULL_DEPTH,
    includeBlockers === true ? WITH_BLOCKERS : WITHOUT_BLOCKERS,
  ] as const;
}

/**
 * sk-622.21 (US-15, T049) — lay a phase-2 event row onto a cached tree
 * answer without a request: every node whose `item` is issue `id` (its
 * canonical row and its reference rows) gets `patchItem(item)`, and every
 * visible blocker entry naming `id` gets the row's title and status. A stub
 * (`status: ''`, an issue outside the reader's horizon) is left alone, and
 * so is everything the server derived for the reader beside the item —
 * `blockers` of the node itself, `unavailableBlockingLinks`, `depth`,
 * `parentRef` — which a row cannot know.
 *
 * Returns the new payload, or `undefined` when the tree does not show the
 * issue (nothing to write). `requestedAt` is kept: the shown answer is still
 * the one requested then, now with one row brought forward — the catch-up
 * clocks of the section and the column judge requests, not patches.
 */
export function patchLayeredTreeRow(
  data: unknown,
  id: string,
  patchItem: (item: IssueTreeRowItem) => IssueTreeRowItem,
  blocker: { title: string; status: IssueStatus },
): unknown {
  if (!data || typeof data !== 'object') return undefined;
  const payload = data as LayeredTreePayload;
  if (!Array.isArray(payload.rows)) return undefined;
  let touched = false;
  const rows = payload.rows.map((node) => {
    let next = node;
    const item = node.item;
    if (item && item.id === id && item.status !== '') {
      next = { ...next, item: patchItem(item) };
      touched = true;
    }
    if (Array.isArray(node.blockers) && node.blockers.some((b) => b.redacted !== true && b.id === id)) {
      next = {
        ...next,
        blockers: node.blockers.map((b) =>
          b.redacted !== true && b.id === id
            ? { ...b, title: blocker.title, status: blocker.status }
            : b,
        ),
      };
      touched = true;
    }
    return next;
  });
  return touched ? { ...payload, rows } : undefined;
}

export function useLayeredTree(args: UseLayeredTreeArgs): UseLayeredTreeResult {
  const { project, rootId, types, maxDepth, includeBlockers, enabled = true } = args;

  const query: UseQueryResult<LayeredTreePayload, unknown> = useQuery({
    queryKey: layeredTreeQueryKey(project, rootId, types, maxDepth, includeBlockers),
    queryFn: async ({ signal }) => {
      // The REQUEST moment is taken here, before going to the network. `dataUpdatedAt`
      // of react-query is the moment of ARRIVAL and does not suit the freshness rule.
      const requestedAt = Date.now();
      const res = await fetchIssueTree({
        // The hook accepts a project alias OR a UUID — but the wire
        // endpoint expects a UUID. Callers (TasksColumn,
        // EpicProgressSection) pass UUIDs by this point (resolved
        // upstream via useProjectByHandle); the cross-project surface
        // passes `null` and we collapse it to `undefined`.
        projectId: project ?? undefined,
        rootId: rootId ?? undefined,
        types,
        maxDepth,
        includeBlockers,
        signal,
      });
      return { rows: res.items, requestedAt };
    },
    enabled,
    staleTime: 5_000,
  });

  const tooLarge = (() => {
    if (!query.error) return false;
    if (query.error instanceof BusinessError) {
      return query.error.code === 'tree_too_large';
    }
    return false;
  })();

  return {
    tree: query.data?.rows ?? [],
    isLoading: query.isLoading,
    error: query.error,
    tooLarge,
    requestedAt: query.data?.requestedAt ?? null,
  };
}
