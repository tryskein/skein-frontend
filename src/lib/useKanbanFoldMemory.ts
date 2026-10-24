import { useCallback, useMemo, useState } from 'react';

import type { StatusFilter } from '../api/issues';

/**
 * sk-551.32 — what the board needs to fold an unfolded column back.
 *
 * `restoreTo` is the filter a sliver widened FROM (see `foldFilterFor`
 * in `kanbanBoard.ts`), or `null` when no widening was seen. `unfold` is
 * the sliver's action, `fold` the head button's.
 */
export interface KanbanFoldMemory {
  restoreTo: StatusFilter | null;
  /**
   * `focusColumn` — the key of the column unfolded from the keyboard: its
   * fold button takes focus once drawn (see `focusAfterToggle`). Omitted
   * for a pointer press, which leaves focus where the pointer put it.
   */
  unfold: (focusColumn?: string) => void;
  /** Same contract as `unfold`; the column's sliver takes focus. */
  fold: (to: StatusFilter, focusColumn?: string) => void;
  /**
   * The column whose replacement control (sliver after a fold, fold
   * button after an unfold) should take focus when it appears, or
   * `null`. Either press removes the very button that had focus. Kept
   * here rather than in the board for the same reason as `restoreTo`:
   * the press changes the query key, and the replacement may be drawn by
   * a board mounted after the loading state.
   */
  focusAfterToggle: string | null;
  /** The replacement took focus — the request is spent. */
  toggleFocused: () => void;
}

/**
 * sk-551.32 — remembers which filter the board's sliver widened to `'all'`
 * from, so the fold can put exactly that one back.
 *
 * Owned by whoever owns the board's PLACE, not by the board: widening
 * the filter changes the task query's key, an uncached `'all'` result is
 * a loading state, and the Tasks column answers loading by replacing the
 * board with a spinner (`TasksBody`'s loading guard). Memory kept inside
 * the board died with it and the fold fell back to the default, so the
 * Tasks body calls this hook above its guards and hands the result down.
 * `KanbanBoard` keeps its own instance only as the fallback for a board
 * rendered without an owner.
 *
 * The record describes one gesture, not a preference, and is worthless
 * once the filter is changed by anything else: it is dropped as soon as
 * the shared filter leaves `'all'` (the "adjust state while rendering"
 * pattern; an effect would paint one frame with the stale value).
 */
export function useKanbanFoldMemory(
  statusFilter: StatusFilter,
  onStatusFilterChange: (v: StatusFilter) => void,
): KanbanFoldMemory {
  const [widenedFrom, setWidenedFrom] = useState<StatusFilter | null>(null);
  const [focusRequest, setFocusRequest] = useState<{
    column: string;
    filter: StatusFilter;
  } | null>(null);
  const [seenFilter, setSeenFilter] = useState(statusFilter);
  if (seenFilter !== statusFilter) {
    setSeenFilter(statusFilter);
    if (statusFilter !== 'all') setWidenedFrom(null);
    // A focus request belongs to the fold that made it; any other filter
    // change voids it, so a later fold by other means does not pull focus.
    if (focusRequest && focusRequest.filter !== statusFilter) setFocusRequest(null);
  }
  const unfold = useCallback(
    (focusColumn?: string) => {
      setWidenedFrom(statusFilter);
      setFocusRequest(
        focusColumn === undefined ? null : { column: focusColumn, filter: 'all' },
      );
      onStatusFilterChange('all');
    },
    [statusFilter, onStatusFilterChange],
  );
  const fold = useCallback(
    (to: StatusFilter, focusColumn?: string) => {
      setWidenedFrom(null);
      setFocusRequest(focusColumn === undefined ? null : { column: focusColumn, filter: to });
      onStatusFilterChange(to);
    },
    [onStatusFilterChange],
  );
  const toggleFocused = useCallback(() => setFocusRequest(null), []);
  const focusAfterToggle = focusRequest?.column ?? null;
  return useMemo(
    () => ({ restoreTo: widenedFrom, unfold, fold, focusAfterToggle, toggleFocused }),
    [widenedFrom, unfold, fold, focusAfterToggle, toggleFocused],
  );
}
