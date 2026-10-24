/**
 * Bounds of the handle drag between the workspace (tree, board) and the task panel.
 *
 * sk-551.29 — the handle moves the PANEL WIDTH, and the view takes the remainder: in a
 * wide window the extra width goes to the board/tree, the panel keeps its own
 * (the maintainers' decision 2026-10-03). Before that (sk-551.14) the view width
 * was remembered, and all the window's gain went to the panel.
 *
 * The handle's travel is still indistinguishable from "Cards": the boundary follows the cursor
 * from the first pixel, in both directions. For this the drag starts from the
 * ACTUAL panel width at the moment of the press, not from the stored number
 * (in a narrow window the panel could be squeezed below it — the difference would go into
 * idle cursor travel), and the upper bound is counted from the same measurement: panel plus
 * view minus the view floor. Everything above that the view cannot give, and writing there
 * would be a dead zone on the way back.
 *
 * The measurement is here, not in `ResizeHandle`: the handle is shared by all columns and
 * does not know that its neighbours in meaning are the view and the task panel.
 *
 * sk-551.43 — the same for "Cards" (`tasksDragBounds`): there the handle moves
 * the TASKS COLUMN width, and the panel is the remainder. The upper bound was rigid
 * (`COL_BOUNDS.tasks.max`, 600), and the task card could not be narrowed
 * the same way as next to the tree and the board. Now the upper bound is column plus panel
 * minus the panel floor, the same 420 as in the other two views.
 */

/**
 * sk-551.30 — layouts that have a handle between the view and the task panel
 * and their own remembered panel width. On a phone the panel is a full-screen
 * sheet and has no width.
 *
 * sk-551.8 — declared here, in a module without React, so that it can be read by the pure
 * section layout modules (`navLayoutStorage.ts`, `navResize.ts`);
 * `useLayoutState` re-exports it.
 */
export type WorkspaceWidthMode = 'desktop' | 'tablet';

/** Task panel floor if the token could not be read (`index.css#--col-details-board`). */
export const DETAILS_WORKSPACE_MIN_PX = 420;

export interface DetailsDragInput {
  /** Measured task panel width, px; 0 — no measurement. */
  detailsPx: number;
  /** Measured view (tasks column) width, px; 0 — no measurement. */
  viewPx: number;
  /** Task panel floor, px. */
  detailsMinPx: number;
  /** View floor, px. */
  viewMinPx: number;
  /** What to drag from if the panel is not measured: the stored width or the floor. */
  fallbackStart: number;
  /** Upper bound if there is no measurement; also the upper bound in general (storage protection). */
  fallbackMax: number;
}

export interface DetailsDragBounds {
  start: number;
  min: number;
  max: number;
}

/**
 * Start and limits of one drag, in the panel width.
 *
 * A zero measurement means "not laid out yet" (and jsdom): substituting the unknown
 * with zero is not allowed, so then the start is `fallbackStart`, the upper bound —
 * `fallbackMax`.
 *
 * The interval always contains the start. The panel can be narrower than its floor (in the
 * tablet layout the row squeezes it, sk-551.30) — then the lower bound equals it
 * itself, not the floor above it; a view at its floor gives an upper bound equal to the
 * panel itself — travel remains only where there is room.
 */
export function detailsDragBounds({
  detailsPx,
  viewPx,
  detailsMinPx,
  viewMinPx,
  fallbackStart,
  fallbackMax,
}: DetailsDragInput): DetailsDragBounds {
  if (!(detailsPx > 0)) {
    const start = Math.max(detailsMinPx, Math.min(fallbackMax, fallbackStart));
    return { start, min: detailsMinPx, max: fallbackMax };
  }
  const start = Math.round(detailsPx);
  const live = viewPx > 0 ? detailsPx + viewPx - viewMinPx : fallbackMax;
  const max = Math.max(start, Math.min(fallbackMax, Math.round(live)));
  return { start, min: Math.min(detailsMinPx, start), max };
}

/**
 * The task panel floor is the token that `index.css` sets next to the
 * stretched view. It is read from the panel itself and not given as a second number
 * in code: change the token — the handle learns about it on its own.
 */
function readDetailsMinPx(details: Element | null): number {
  if (details === null) return DETAILS_WORKSPACE_MIN_PX;
  const raw = window.getComputedStyle(details).getPropertyValue('--col-details-board');
  const px = Number.parseFloat(raw);
  return Number.isFinite(px) && px > 0 ? px : DETAILS_WORKSPACE_MIN_PX;
}

/**
 * Measure the row at the moment the handle is pressed.
 *
 * The view is the handle's left neighbour (`Shell.tsx` puts it right after the tasks column).
 * The task panel is NOT the right neighbour: the panel itself lies inside
 * `.details-frame` with `display: contents` (such a node has no box of its own),
 * so it is found by class within the row — there is exactly one in the row.
 */
export function measureDetailsDrag(
  handle: HTMLElement,
  bounds: { viewMin: number; max: number },
  savedWidth: number | null,
): DetailsDragBounds {
  const view = handle.previousElementSibling;
  const details = handle.parentElement?.querySelector('.col-details') ?? null;
  const detailsMinPx = readDetailsMinPx(details);
  return detailsDragBounds({
    detailsPx: details?.getBoundingClientRect().width ?? 0,
    viewPx: view?.getBoundingClientRect().width ?? 0,
    detailsMinPx,
    viewMinPx: bounds.viewMin,
    fallbackStart: savedWidth ?? detailsMinPx,
    fallbackMax: bounds.max,
  });
}

export interface TasksDragInput {
  /** Measured tasks column width, px; 0 — no measurement. */
  tasksPx: number;
  /** Measured task panel width, px; 0 — no measurement (or no panel). */
  detailsPx: number;
  /** Task panel floor, px. */
  detailsMinPx: number;
  /** Tasks column floor, px. */
  tasksMinPx: number;
  /** Stored column width — the start if the column is not measured. */
  savedWidth: number;
  /** Upper bound if the panel is not measured: the former drag limit. */
  fallbackMax: number;
  /** Upper bound in general — storage protection from garbage. */
  hardMax: number;
}

/**
 * sk-551.43 — start and limits of one drag in "Cards", in the width of the
 * TASKS COLUMN (the handle is to the right of it, `sizes="before"`).
 *
 * A mirror of {@link detailsDragBounds}: the start is the actual column width
 * (the window could squeeze it below the stored one), the upper bound is column plus panel
 * minus the panel floor, so the drag never makes the panel narrower than 420. Without a panel
 * measurement (it is not in the row, or jsdom) the upper bound is the former `fallbackMax`: there is
 * nothing to drag towards the row's edge, which is not visible.
 *
 * The interval always contains the start: a panel already squeezed below its floor
 * gives an upper bound equal to the column itself — travel only to the left, where the panel
 * gains.
 */
export function tasksDragBounds({
  tasksPx,
  detailsPx,
  detailsMinPx,
  tasksMinPx,
  savedWidth,
  fallbackMax,
  hardMax,
}: TasksDragInput): DetailsDragBounds {
  const start = tasksPx > 0 ? Math.round(tasksPx) : savedWidth;
  const min = Math.min(tasksMinPx, start);
  if (!(tasksPx > 0) || !(detailsPx > 0)) {
    return { start, min, max: Math.max(start, fallbackMax) };
  }
  const live = Math.round(tasksPx + detailsPx - detailsMinPx);
  return { start, min, max: Math.max(start, Math.min(hardMax, live)) };
}

/**
 * Measure the "Cards" row at the moment the tasks column handle is pressed.
 *
 * The column is the handle's left neighbour (`Shell.tsx` puts it right after the
 * tasks column), the panel is `.col-details` within the row, as in
 * {@link measureDetailsDrag}.
 */
export function measureTasksDrag(
  handle: HTMLElement,
  bounds: { min: number; fallbackMax: number; hardMax: number },
  savedWidth: number,
): DetailsDragBounds {
  const tasks = handle.previousElementSibling;
  const details = handle.parentElement?.querySelector('.col-details') ?? null;
  return tasksDragBounds({
    tasksPx: tasks?.getBoundingClientRect().width ?? 0,
    detailsPx: details?.getBoundingClientRect().width ?? 0,
    detailsMinPx: readDetailsMinPx(details),
    tasksMinPx: bounds.min,
    savedWidth,
    fallbackMax: bounds.fallbackMax,
    hardMax: bounds.hardMax,
  });
}
