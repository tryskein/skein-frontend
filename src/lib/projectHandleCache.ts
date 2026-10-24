/**
 * sk-439 — which project a URL handle names, from the query cache alone.
 *
 * A project handle in an address is an idPrefix, an alias or a UUID
 * (the routes accept all three), so two DIFFERENT strings can name the
 * SAME project: the epic section opens a child by the row's UUID while
 * the address carries the alias. Comparing the strings would call them
 * two projects.
 *
 * The lookup is the one `useProjectByHandle` already does, in the same
 * order: the shell's first-page projects list, then this handle's own
 * resolve answer. Both cache keys live HERE, in a module that imports
 * no hooks, so `useLayoutState` can read them without importing
 * `useProjectsList` (which imports `useLayoutState` back).
 *
 * It only READS what is cached — no subscription, no request — so it is
 * safe inside an event handler.
 */

import type { QueryClient } from '@tanstack/react-query';
import type { ListProjectsResult, ResolveResult } from '../api/projects';

/** Cache key of the shell's single-page projects list (`useProjectsList`). */
export const projectsListQueryKey = ['projects', 'list', 'shell'] as const;

/** Cache key of the per-handle resolve call (`useProjectByHandle`, stage 2). */
export function projectResolveQueryKey(handle: string | null) {
  return ['project', 'resolve', handle] as const;
}

/**
 * The project UUID `handle` names, or `null` when that is not known
 * right now (list not loaded yet, project past the first page and never
 * resolved). `null` is "unknown", NOT "no such project" — callers pick
 * their own safe side.
 */
export function cachedProjectIdOf(qc: QueryClient, handle: string): string | null {
  const list = qc.getQueryData<ListProjectsResult>(projectsListQueryKey);
  const hit = (list?.items ?? []).find((p) => p.idPrefix === handle || p.id === handle);
  if (hit) return hit.id;
  const resolved = qc.getQueryData<ResolveResult>(projectResolveQueryKey(handle));
  return resolved?.match?.id ?? null;
}

/**
 * Do two handles KNOWABLY name the same project? Equal strings do by
 * definition; otherwise both must resolve from the cache to one UUID.
 * Anything unknown answers `false`.
 */
export function isKnownSameProject(qc: QueryClient, a: string, b: string): boolean {
  if (a === b) return true;
  const ia = cachedProjectIdOf(qc, a);
  return ia !== null && ia === cachedProjectIdOf(qc, b);
}
