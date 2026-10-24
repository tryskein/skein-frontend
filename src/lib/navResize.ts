/**
 * sk-551.8 — bounds of the two handles of the sections column (plan P9):
 * its width (US-5, US-8) and the split of height between its two sections
 * (US-4, INV-9). Pure functions plus two thin DOM readers, the same
 * division as `lib/workspaceResize.ts`.
 *
 * ── Width ────────────────────────────────────────────────────────────
 *
 * Desktop: 200…480 px. Tablet: the upper bound is LIVE — the column may
 * not take the Tasks column's minimum (280) from it; the task pane is what
 * yields, as on a tablet today (it has no minimum). So the most the column
 * can grow to is itself + (Tasks − 280) + the pane, and never above 480.
 * A stored width above that limit is limited ON SCREEN
 * (`navColumnWidthOnScreen`); nothing here writes it back — the stored
 * value changes only by the person's drag (US-8).
 *
 * The drag starts from the column's MEASURED width, not the stored number,
 * and the interval always contains the start (the lesson of
 * `workspaceResize.ts#detailsDragBounds`): a start outside the declared
 * bounds would be a dead zone of the pointer, and the announced bounds
 * must equal the real ones (US-5).
 *
 * ── Split ────────────────────────────────────────────────────────────
 *
 * The split is a share of the sum of the two BODIES — never of the
 * headers or the handle. No expanded body is shorter than 200 px; when
 * the two bodies cannot both have 200, the bounds collapse onto 200 and
 * the column scrolls instead of either minimum being dropped (INV-9).
 */
import { NAV_COLUMN_BOUNDS, NAV_SECTION_MIN_PX, NAV_SPLIT_BOUNDS } from './navLayoutStorage';
import type { WorkspaceWidthMode } from './workspaceResize';

/** The start of one drag and its bounds, px — the shape `ResizeHandle` takes. */
export interface NavDragBounds {
  start: number;
  min: number;
  max: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ── Width ───────────────────────────────────────────────────────────

export interface NavWidthDragInput {
  mode: WorkspaceWidthMode;
  /** Measured width of the sections column, px; 0 — not measured. */
  columnPx: number;
  /** Measured width of the Tasks column, px; 0 — not measured. */
  tasksPx: number;
  /** Measured width of the task pane, px; 0 — none on screen. */
  detailsPx: number;
  /** The Tasks column's minimum, px. */
  tasksMinPx: number;
  /** The stored width of this width mode. */
  savedWidth: number;
}

/**
 * Start and bounds of one width drag. Desktop: 200…480. Tablet: the top is
 * column + (Tasks − its minimum) + pane, capped at 480; unmeasured (not
 * laid out yet, jsdom) — the fixed 480, as there is nothing to measure.
 */
export function navWidthDragBounds({
  mode,
  columnPx,
  tasksPx,
  detailsPx,
  tasksMinPx,
  savedWidth,
}: NavWidthDragInput): NavDragBounds {
  const { min: floor, max: ceiling } = NAV_COLUMN_BOUNDS;
  const start = columnPx > 0 ? Math.round(columnPx) : clamp(Math.round(savedWidth), floor, ceiling);
  const min = Math.min(floor, start);
  if (mode === 'desktop' || !(columnPx > 0) || !(tasksPx > 0)) {
    return { start, min, max: Math.max(start, ceiling) };
  }
  const live = Math.floor(columnPx + (tasksPx - tasksMinPx) + Math.max(0, detailsPx));
  return { start, min, max: Math.max(start, Math.min(ceiling, live)) };
}

export interface NavWidthOnScreenInput {
  mode: WorkspaceWidthMode;
  savedWidth: number;
  /** Width shared by the sections column, the Tasks column and the pane, px. */
  availablePx: number;
  tasksMinPx: number;
}

/**
 * The width to DRAW. Desktop — the stored width within 200…480. Tablet —
 * additionally no wider than what leaves the Tasks column its minimum
 * (the pane yields), and never below 200: when even that does not fit,
 * the person folds the column into its sliver by hand (US-8). Read-only:
 * the stored value is left as it is.
 */
export function navColumnWidthOnScreen({
  mode,
  savedWidth,
  availablePx,
  tasksMinPx,
}: NavWidthOnScreenInput): number {
  const { min: floor, max: ceiling } = NAV_COLUMN_BOUNDS;
  const stored = clamp(Math.round(savedWidth), floor, ceiling);
  if (mode === 'desktop' || !(availablePx > 0)) return stored;
  return Math.max(floor, Math.min(stored, Math.floor(availablePx - tasksMinPx)));
}

/**
 * Measure the row when the width handle is pressed. The column is the
 * handle's left neighbour (the handle sits right of it); the Tasks column
 * and the pane are found by class within the row — the pane lives inside
 * a `display: contents` frame, as `measureDetailsDrag` explains.
 */
export function measureNavWidthDrag(
  handle: HTMLElement,
  mode: WorkspaceWidthMode,
  tasksMinPx: number,
  savedWidth: number,
): NavDragBounds {
  const row = handle.parentElement;
  return navWidthDragBounds({
    mode,
    columnPx: handle.previousElementSibling?.getBoundingClientRect().width ?? 0,
    tasksPx: row?.querySelector('.col-tasks')?.getBoundingClientRect().width ?? 0,
    detailsPx: row?.querySelector('.col-details')?.getBoundingClientRect().width ?? 0,
    tasksMinPx,
    savedWidth,
  });
}

// ── Split ───────────────────────────────────────────────────────────

/** Bounds of the TOP body (Projects), px, for a given sum of both bodies. */
export function splitBounds(bodiesPx: number): { min: number; max: number } {
  const min = NAV_SECTION_MIN_PX;
  if (!(bodiesPx >= 2 * min)) return { min, max: min };
  return { min, max: bodiesPx - min };
}

/** The top body's height for a split, within the live bounds. */
export function splitToPx(split: number, bodiesPx: number): number {
  const { min, max } = splitBounds(bodiesPx);
  const share = Number.isFinite(split) ? split : NAV_SPLIT_BOUNDS.default;
  return clamp(Math.round(share * bodiesPx), min, max);
}

/**
 * The split for a top body height: a share of the sum of the two bodies,
 * the height first held within the live bounds. No bodies to divide —
 * the default.
 */
export function pxToSplit(topPx: number, bodiesPx: number): number {
  if (!(bodiesPx > 0)) return NAV_SPLIT_BOUNDS.default;
  const { min, max } = splitBounds(bodiesPx);
  return clamp(clamp(topPx, min, max) / bodiesPx, NAV_SPLIT_BOUNDS.min, NAV_SPLIT_BOUNDS.max);
}

/**
 * Start and bounds of one split drag, in the top body's height. `topPx`
 * and `bottomPx` are the two bodies alone — without headers and handle.
 */
export function splitDragBounds(topPx: number, bottomPx: number): NavDragBounds {
  const bodies = Math.max(0, topPx) + Math.max(0, bottomPx);
  const { min, max } = splitBounds(bodies);
  const start = Math.round(Math.max(0, topPx));
  return { start, min: Math.min(min, start), max: Math.max(max, start) };
}

/** Measure the two bodies when the split handle is pressed. */
export function measureSplitDrag(topBody: Element | null, bottomBody: Element | null): NavDragBounds {
  return splitDragBounds(
    topBody?.getBoundingClientRect().height ?? 0,
    bottomBody?.getBoundingClientRect().height ?? 0,
  );
}
