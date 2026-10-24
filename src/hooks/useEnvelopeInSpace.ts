/**
 * sk-674.18 T056 — does a live envelope belong to the space chosen on the
 * HOT ZONE page (screens 1.12, `?space=`)?
 *
 * The page's requests carry the choice and the server narrows them; the
 * ticker and the race also grow from live envelopes between those reads
 * (`ActivityDashboard.tsx#useDashboardFeed`, `RaceChart.tsx`). The hub
 * delivers every project the tab can see, whatever the page shows, and the
 * compact envelope names the project, not its space — so with one space
 * chosen, an event of another space would slip into a page filtered away
 * from it.
 *
 * The project's space is read from the projects list the shell already
 * caches (`useProjectsList.ts#useProjectsList`, rows carry `spaceId`).
 * With «all» chosen every envelope passes, as before. With one space
 * chosen:
 *  - a project KNOWN to be in that space — the envelope passes;
 *  - a project known to be in another space — dropped, nothing else;
 *  - a project the map does not hold (beyond the first page of the list,
 *    the map not answered yet, a row without `spaceId`) — not taken
 *    blindly and not lost either: `onUnknown` is called,
 *    debounced, and the caller reads its query again with the space, so
 *    the server answers with what belongs.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { EventEnvelope } from '../lib/eventEnvelope';
import { useProjectsList } from '../lib/useProjectsList';

/** A burst of unknown events asks for one read, not one per event. */
export const UNKNOWN_PROJECT_REREAD_DEBOUNCE_MS = 500;

export function useEnvelopeInSpace(
  space: string | null,
  onUnknown?: () => void,
): (env: EventEnvelope) => boolean {
  const projectsQ = useProjectsList();
  const spaceOfProject = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of projectsQ.data?.items ?? []) {
      if (p.spaceId !== undefined) map.set(p.id, p.spaceId);
    }
    return map;
  }, [projectsQ.data]);

  const onUnknownRef = useRef(onUnknown);
  useEffect(() => {
    onUnknownRef.current = onUnknown;
  });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    [],
  );
  const scheduleReread = useCallback(() => {
    if (timerRef.current !== null) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      onUnknownRef.current?.();
    }, UNKNOWN_PROJECT_REREAD_DEBOUNCE_MS);
  }, []);

  return useCallback(
    (env: EventEnvelope) => {
      if (space === null) return true;
      if (!env.projectId) return false;
      const of = spaceOfProject.get(env.projectId);
      if (of === undefined) {
        scheduleReread();
        return false;
      }
      return of === space;
    },
    [space, spaceOfProject, scheduleReread],
  );
}
