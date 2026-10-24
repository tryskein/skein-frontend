import { useQuery } from '@tanstack/react-query';
import { resolveProject, type ProjectListItem } from '../api/projects';
import { useProjectsList } from './useProjectsList';
import { projectResolveQueryKey } from './projectHandleCache';

/**
 * Resolve a URL project handle (idPrefix / alias / UUID) to a full
 * `ProjectListItem`.
 *
 * Two-stage:
 *   1. Fast path — check the cached first-page list (`useProjectsList`)
 *      for `idPrefix === handle || id === handle`. Hits when the
 *      project is among the alphabetically-first 100 the column shows.
 *   2. Fallback — call `GET /api/v1/projects/resolve?q={handle}` which
 *      runs the backend's full alias/trigram/UUID resolver. Caches per
 *      handle. This is what makes alias-only projects (like `demo` →
 *      project name `demodemodemo` paginated past page 1) resolvable from
 *      a fresh URL hit / deep link.
 *
 * Returns the full DTO so consumers (useTasks, IssueDetailPanel) can
 * read the UUID for REST calls (`/api/v1/projects/{uuid}/...` rejects
 * non-UUID handles).
 *
 * When `handle` is null, returns null immediately without a query.
 * When the resolve call returns no match (404 or `match: null`),
 * returns null after the query lands so callers can show
 * "project-not-found" without churning forever.
 */
export interface UseProjectByHandleResult {
  /** Resolved project, or null if handle is null / unresolvable. */
  project: ProjectListItem | null;
  /** True while either the list cache or the resolve call is in flight. */
  isLoading: boolean;
  /** True iff resolve completed and returned no match. */
  isUnresolved: boolean;
}

export function useProjectByHandle(handle: string | null): UseProjectByHandleResult {
  const listQ = useProjectsList();

  // Fast-path scan of the cached first page. If we have a hit, we
  // never need the resolve call. Returning the full DTO so consumers
  // can rely on count fields, name, etc. — not just UUID.
  const cached = handle
    ? (listQ.data?.items ?? []).find(
        (p) => p.idPrefix === handle || p.id === handle,
      ) ?? null
    : null;

  // Always-armed resolve query — disabled when handle is null OR the
  // cached list already has the answer. TanStack dedupes concurrent
  // calls so two components asking for the same handle share one
  // network round-trip.
  const resolveQ = useQuery({
    queryKey: projectResolveQueryKey(handle),
    queryFn: () => resolveProject(handle!),
    enabled: !!handle && cached === null,
    // Resolve is keyed by exact handle string — server is deterministic
    // per (handle, caller). Cache 5 min; SignalR invalidation will
    // refresh stale entries when a project mutation happens.
    staleTime: 5 * 60_000,
  });

  if (handle === null) {
    return { project: null, isLoading: false, isUnresolved: false };
  }
  if (cached !== null) {
    return { project: cached, isLoading: false, isUnresolved: false };
  }
  if (resolveQ.isLoading || resolveQ.isFetching) {
    return { project: null, isLoading: true, isUnresolved: false };
  }
  // Resolve landed. ResolveResult.match is a ResolveMatch — a subset of
  // ProjectListItem. We need the full list-item shape for count fields.
  // Two paths:
  //   - If the resolve match's id is in the cached first-page list:
  //     unlikely (we already checked above), but defensive.
  //   - Otherwise: build a minimal ProjectListItem from the resolve
  //     payload. Count fields default to 0 — the consumer (useTasks /
  //     IssueDetailPanel) only needs `id` and `idPrefix` for routing,
  //     not the counts.
  const match = resolveQ.data?.match ?? null;
  if (match === null) {
    return { project: null, isLoading: false, isUnresolved: true };
  }
  const synthetic: ProjectListItem = {
    id: match.id,
    name: match.name,
    idPrefix: match.idPrefix,
    description: '',
    defaultIdMode: 'counter',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    openCount: 0,
    inProgressCount: 0,
    blockedCount: 0,
    myOutboxOpenCount: 0,
    myOutboxInProgressCount: 0,
    myOutboxBlockedCount: 0,
  };
  return { project: synthetic, isLoading: false, isUnresolved: false };
}
