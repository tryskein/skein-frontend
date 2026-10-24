/**
 * sk-421.1 T013 — the issue card's component directory (US-3, R-1).
 *
 * The properties row names an issue's components. Names come from the
 * component list of the ISSUE's project, archived ones included — not
 * from the project selected in the tree and not through any Tasks-column
 * lens (INV-8). This is the card's only new read, and only for an issue
 * that has components.
 *
 * ─── Cache key ───────────────────────────────────────────────────────
 *
 * `['component-names', projectId]` is deliberately its own namespace:
 *   - NOT under `['projects', …]` — every issue event runs a broad
 *     invalidation over that whole space (`liveEventInvalidation.ts`),
 *     so the directory would be re-read on every foreign edit;
 *   - NOT `['components', 'list', pid, …]` — the Tasks column's tree key,
 *     also reset on every issue event (plan decision 6).
 * Only component events reset it (`invalidateComponentEvent`), so a
 * rename or an archive shows up on an open card live, and issue events —
 * `issue.components_changed` included, which changes an issue's
 * attachment, not a name — leave it alone. No lens in the key: the same
 * directory serves every lens.
 *
 * ─── Freshness and retention are ONE requirement ─────────────────────
 *
 * "Reopening cards of the same project does not repeat the read until a
 * component event arrives" needs both, set on this query (not on the app
 * client, whose defaults stay as they are):
 *   - `staleTime: Infinity` — the app client sets no staleTime, i.e. 0,
 *     so every new card mount would otherwise refetch;
 *   - `gcTime: Infinity` — TanStack removes an unobserved entry after 5
 *     minutes by default, so a project whose cards were all closed longer
 *     than that would be re-read with no component event.
 * Either one alone still re-reads; do not split them.
 */

import { useQuery, type QueryKey, type UseQueryResult } from '@tanstack/react-query';
import { type Component, listComponents } from '../api/components';

/** The directory's cache key for one project. */
export const projectComponentNamesKey = (projectId: string): QueryKey =>
  ['component-names', projectId] as const;

/** What the card needs to name one component. */
export interface ComponentName {
  name: string;
  /** True when the component is archived (shown with a muted mark). */
  archived: boolean;
}

/** Component id → name entry, for the issue's project. */
export type ComponentNameMap = ReadonlyMap<string, ComponentName>;

function toNameMap(components: Component[]): ComponentNameMap {
  const map = new Map<string, ComponentName>();
  for (const c of components) {
    map.set(c.id, { name: c.name, archived: !!c.archivedAt });
  }
  return map;
}

/**
 * Read the component directory of `projectId` (the issue's own project),
 * archived components included — only when `componentIds` is non-empty.
 * With no project or no components the query stays disabled: no request,
 * `status: 'pending'`, `data: undefined`.
 *
 * The consumer reads `data` for names and `status` for the fallback: on
 * `'error'` the row shows a count without names or ids (US-3).
 */
export function useProjectComponentNames(
  projectId: string | null | undefined,
  componentIds: readonly string[] | null | undefined,
): UseQueryResult<ComponentNameMap, Error> {
  const enabled = !!projectId && !!componentIds && componentIds.length > 0;
  return useQuery<Component[], Error, ComponentNameMap>({
    queryKey: projectComponentNamesKey(projectId ?? '∅'),
    queryFn: () => listComponents(projectId!, 'all'),
    enabled,
    staleTime: Infinity,
    gcTime: Infinity,
    select: toNameMap,
  });
}
