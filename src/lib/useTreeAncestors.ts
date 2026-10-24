/**
 * sk-285.2.7 — backfill the parents a page of the flat issue list is
 * missing, so the Tasks tree shows the project's hierarchy instead of
 * the hierarchy of whatever happened to fit on one page.
 *
 * ─── The problem ───────────────────────────────────────────────────
 *
 * `buildIssueTree` groups ONE page of `useTasks` by `parentIdCurrent`.
 * The server clamps `limit` to 1..100, so a parent very often is not on
 * the page — its child then counts as an "orphan" and floats to the
 * root. Nothing on screen says the row is actually nested three levels
 * deep in an epic; the tree quietly describes a random sub-sample.
 *
 * ─── The fix ───────────────────────────────────────────────────────
 *
 * Ask for the missing parents by id and climb: each fetched parent may
 * itself point at a parent that is also absent, so the walk continues
 * level by level until it reaches roots, runs out of resolvable ids, or
 * hits the caps below.
 *
 * Two REJECTED alternatives, recorded so they are not re-litigated:
 *   - Leave the orphans and print "showing N of M". Honest, but it
 *     describes the defect instead of fixing it: the row still sits at
 *     the wrong level.
 *   - A server-side tree mode (recursive CTE over `parent_id`). The
 *     right long-term shape and strictly fewer round-trips — but this
 *     stage does not touch skein-api, so it is out of scope here.
 *
 * ─── Why one id per request ────────────────────────────────────────
 *
 * A batch endpoint exists (`POST /search/lookup-id-batch`) and would be
 * one round-trip per level instead of N. It returns `SearchItem`, which
 * carries NO `parentIdCurrent` — the one field the climb runs on — and
 * lacks half of `IssueSummary` besides, so using it would mean
 * fabricating rows and then still fetching each parent to learn where
 * to go next. `findIssueSummaryById` (the cross-project list, filtered
 * server-side by visibility) returns the real summary row in a single
 * request, which is both correct and cheaper than batch+refetch.
 * Requests inside one level go out in parallel; only the levels are
 * sequential, because level N+1's ids are not known until N answers.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { findIssueSummaryById, type IssueSummary } from '../api/issues';

/**
 * How many levels the walk may climb. A hierarchy deeper than this is
 * possible but vanishingly rare (Skein ids like `sk-285.2.7` are three
 * levels); the cap is here because BROKEN data is not rare — a cycle or
 * a self-reference must terminate the walk, and the dedup set alone
 * would not bound a long adversarial chain of one-parent-per-level.
 */
export const ANCESTOR_MAX_LEVELS = 6;

/**
 * Hard ceiling on backfilled rows (and therefore on requests) for one
 * page. A page of 100 unrelated issues in 100 different branches would
 * otherwise fire 100 lookups on a view the user only glanced at. When
 * the ceiling truncates, the branches that did resolve are still whole
 * and the rest degrade to today's behaviour (orphan at root).
 */
export const ANCESTOR_MAX_NODES = 40;

/** Resolves an id to its summary row, or null when absent / invisible. */
export type AncestorFetcher = (id: string) => Promise<IssueSummary | null>;

/**
 * Ids referenced as `parentIdCurrent` by some row but not present in
 * the list itself — the seeds of the climb. Order follows first
 * appearance in `items` so a truncated walk keeps the branches nearest
 * the top of the column.
 */
export function collectMissingParentIds(items: readonly IssueSummary[]): string[] {
  const present = new Set(items.map((it) => it.id));
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    const parentId = it.parentIdCurrent;
    if (!parentId) continue;
    if (present.has(parentId)) continue;
    if (seen.has(parentId)) continue;
    seen.add(parentId);
    missing.push(parentId);
  }
  return missing;
}

export interface FetchAncestorChainArgs {
  /** Missing parent ids to start from (see `collectMissingParentIds`). */
  seedIds: readonly string[];
  /** Ids already on screen — never fetched, and never climbed into. */
  known: ReadonlySet<string>;
  fetchById: AncestorFetcher;
  maxLevels?: number;
  maxNodes?: number;
}

/**
 * Climb `parentIdCurrent` from `seedIds` upwards, returning every
 * ancestor row that resolved. Pure over `fetchById` so the walk is
 * testable without React or the network.
 *
 * Termination is guaranteed three times over: an id is marked visited
 * BEFORE its request goes out (so a cycle a→b→a stops at the second
 * hop, and a self-reference never even starts one), the level counter
 * caps the depth, and the node counter caps the total.
 *
 * A lookup that fails is treated exactly like a lookup that found
 * nothing: that branch keeps today's behaviour (child stays at the
 * root) instead of the whole backfill collapsing because one id out of
 * twenty was flaky. Auth failures are unaffected by this — `apiFetch`
 * routes a 401 to sign-out globally, above this call.
 */
export async function fetchAncestorChain({
  seedIds,
  known,
  fetchById,
  maxLevels = ANCESTOR_MAX_LEVELS,
  maxNodes = ANCESTOR_MAX_NODES,
}: FetchAncestorChainArgs): Promise<IssueSummary[]> {
  const out: IssueSummary[] = [];
  const visited = new Set<string>(known);

  let frontier = seedIds.filter((id) => !visited.has(id));

  for (let level = 0; level < maxLevels && frontier.length > 0; level += 1) {
    if (out.length + frontier.length > maxNodes) {
      frontier = frontier.slice(0, maxNodes - out.length);
    }
    for (const id of frontier) visited.add(id);

    const rows = await Promise.all(
      frontier.map((id) => fetchById(id).catch(() => null)),
    );

    const next: string[] = [];
    for (const row of rows) {
      if (!row) continue;
      out.push(row);
      const parentId = row.parentIdCurrent;
      if (!parentId) continue;
      if (visited.has(parentId)) continue;
      if (next.includes(parentId)) continue;
      next.push(parentId);
    }

    if (out.length >= maxNodes) break;
    frontier = next;
  }

  return out;
}

export interface UseTreeAncestorsArgs {
  /** The page currently on screen; `undefined` while it loads. */
  items: IssueSummary[] | undefined;
  /** False outside the client-side tree path — no reason to pay for it. */
  enabled: boolean;
}

export interface UseTreeAncestorsResult {
  /** Backfilled rows, to be concatenated with the page before building. */
  items: IssueSummary[];
  /** Their ids — `buildIssueTree` marks exactly these as context rows. */
  contextIds: ReadonlySet<string>;
}

const NO_ANCESTORS: IssueSummary[] = [];
const NO_CONTEXT_IDS: ReadonlySet<string> = new Set<string>();

export function useTreeAncestors({
  items,
  enabled,
}: UseTreeAncestorsArgs): UseTreeAncestorsResult {
  const missingParentIds = useMemo(
    () => (items ? collectMissingParentIds(items) : []),
    [items],
  );
  // Ids present on the page. Passed as `known` so a parent that IS on
  // screen is never re-fetched, and so the climb cannot walk back down
  // into rows the page already has.
  const presentIds = useMemo(
    () => new Set((items ?? []).map((it) => it.id)),
    [items],
  );

  // The cache key is the SORTED seed set: two pages that are missing
  // the same parents share one cached walk, and a re-ordering of the
  // same page does not refetch. `presentIds` is deliberately NOT in the
  // key — it only ever prunes work, and folding a 100-id set into the
  // key would make every page a fresh cache entry.
  //
  // `'tasks'` first is not cosmetic: the live-event router invalidates
  // by `queryKey[0] === 'tasks'`, so a reparent / delete lands on the
  // backfill as well as the page it decorates. Without it the tree
  // would keep showing a parent the graph no longer has.
  const seedKey = useMemo(
    () => [...missingParentIds].sort().join(','),
    [missingParentIds],
  );

  const query = useQuery({
    queryKey: ['tasks', 'ancestors', seedKey],
    queryFn: () =>
      fetchAncestorChain({
        seedIds: missingParentIds,
        known: presentIds,
        fetchById: findIssueSummaryById,
      }),
    enabled: enabled && missingParentIds.length > 0,
    staleTime: 30_000,
    // Hold the previous walk while the next one runs. Pagination
    // changes the seed set on every appended page; without this the
    // whole tree would re-flatten to orphans-at-root for the duration
    // of each refetch. Rows kept from the previous walk that no longer
    // hold anything are dropped by `buildIssueTree` (a childless
    // context node is pruned), so stale context cannot linger on screen.
    placeholderData: (prev) => prev,
  });

  // Drop any backfilled row the page itself now carries. This can only
  // happen with a held-over previous walk (see `placeholderData`), and
  // an id appearing twice in the input would give `buildIssueTree` two
  // buckets for one issue — i.e. the row rendered twice.
  const ancestors = useMemo(() => {
    const raw = query.data ?? NO_ANCESTORS;
    const deduped = raw.filter((it) => !presentIds.has(it.id));
    return deduped.length === raw.length ? raw : deduped;
  }, [query.data, presentIds]);

  const contextIds = useMemo(() => {
    if (ancestors.length === 0) return NO_CONTEXT_IDS;
    return new Set(ancestors.map((it) => it.id));
  }, [ancestors]);

  return { items: ancestors, contextIds };
}
