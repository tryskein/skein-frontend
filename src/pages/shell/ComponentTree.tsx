import { useQuery } from '@tanstack/react-query';
import { listComponents, type Component } from '../../api/components';
import { useLayoutState } from '../../lib/useLayoutState';
import { ComponentRow } from './ComponentRow';

/**
 * Fetches and renders the components sub-tree for one project. One
 * `useQuery` per project — the cache key is `['components', projectId]`
 * so React Query dedupes concurrent calls and the live-event
 * invalidation in `lib/liveEventInvalidation.ts` can match the
 * components family by predicate later.
 *
 * staleTime is 60s (components rarely change) and we accept the
 * background refresh on focus that React Query does by default. There
 * is no error UI — failures collapse silently to "no components". The
 * tree is decorative: no data → no children.
 */
interface Props {
  projectId: string;
  projectAlias: string;
  selectedComponent: string | null;
  onSelect: (cid: string) => void;
}

export function ComponentTree({
  projectId,
  selectedComponent,
  onSelect,
}: Props) {
  const { outboxMode, onMeMode } = useLayoutState();
  // sk-30 — server-side lens narrowing. When a lens is ON, the
  // backend HAVING-filters components whose scoped counts are all
  // zero, so we don't need a client-side filter anymore. The lens
  // value also rides in the queryKey so toggling lenses rolls a
  // fresh cache entry (otherwise switching from "no lens" to
  // "on-me" would briefly show stale components from the cached
  // unfiltered list).
  const lens: 'on-me' | 'delegated' | undefined = onMeMode
    ? 'on-me'
    : outboxMode
      ? 'delegated'
      : undefined;
  const q = useQuery<Component[]>({
    queryKey: ['components', 'list', projectId, lens ?? 'all'],
    queryFn: () => listComponents(projectId, undefined, lens),
    staleTime: 60_000,
  });

  if (q.isLoading) {
    return null;
  }
  const items = q.data ?? [];
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="component-list">
      {items.map((c) => (
        <ComponentRow
          key={c.id}
          component={c}
          selected={selectedComponent === c.id}
          onSelect={() => onSelect(c.id)}
        />
      ))}
    </div>
  );
}
