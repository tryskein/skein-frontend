/**
 * sk-551.8 F6 — bounds of the sections column's two handles.
 *
 * Reference: US-5 (desktop 200…480, default 300), US-8 (tablet: the
 * column keeps ≥ 200, Tasks keeps its 280, the task pane yields; the drag
 * stops at the live limit; a stored width above it is limited on screen),
 * US-4 and INV-9 (both bodies ≥ 200, the split is a share of the two
 * bodies, a shortage collapses the bounds rather than dropping a minimum).
 * Expected numbers are worked out by hand from those rules.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  measureNavWidthDrag,
  measureSplitDrag,
  navColumnWidthOnScreen,
  navWidthDragBounds,
  pxToSplit,
  splitBounds,
  splitDragBounds,
  splitToPx,
} from '../navResize';

const TASKS_MIN = 280;

function boxOf(el: Element, size: { width?: number; height?: number }): void {
  el.getBoundingClientRect = () =>
    ({ width: size.width ?? 0, height: size.height ?? 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('width — desktop 200…480', () => {
  it.each([
    [{ columnPx: 300, tasksPx: 600, detailsPx: 400 }, { start: 300, min: 200, max: 480 }],
    [{ columnPx: 300, tasksPx: 280, detailsPx: 0 }, { start: 300, min: 200, max: 480 }],
    [{ columnPx: 0, tasksPx: 0, detailsPx: 0 }, { start: 300, min: 200, max: 480 }],
  ])('measured %o → %o', (measured, expected) => {
    expect(
      navWidthDragBounds({ mode: 'desktop', tasksMinPx: TASKS_MIN, savedWidth: 300, ...measured }),
    ).toEqual(expected);
  });

  it('the stored width on screen stays within 200…480', () => {
    expect(navColumnWidthOnScreen({ mode: 'desktop', savedWidth: 480, availablePx: 700, tasksMinPx: TASKS_MIN })).toBe(480);
    expect(navColumnWidthOnScreen({ mode: 'desktop', savedWidth: 900, availablePx: 700, tasksMinPx: TASKS_MIN })).toBe(480);
  });
});

describe('width — tablet 768 with the task pane open: the top never takes Tasks below 280', () => {
  it.each([
    // column 300 + Tasks 300 + pane 100 = 700; 700 − 280 = 420
    [{ columnPx: 300, tasksPx: 300, detailsPx: 100 }, 420],
    // a wider pane gives more: 300 + 300 + 160 − 280 = 480 (the cap)
    [{ columnPx: 300, tasksPx: 300, detailsPx: 160 }, 480],
    // Tasks already at 280, no pane: nothing to take — the top is the column itself
    [{ columnPx: 300, tasksPx: 280, detailsPx: 0 }, 300],
    // the pane window (sk-551.5): no pane in the row, the row splits between column and view
    [{ columnPx: 250, tasksPx: 438, detailsPx: 0 }, 408],
  ])('measured %o → max %d', (measured, max) => {
    const b = navWidthDragBounds({ mode: 'tablet', tasksMinPx: TASKS_MIN, savedWidth: 300, ...measured });
    expect(b.max).toBe(max);
    expect(b.start).toBe(measured.columnPx);
    expect(b.min).toBe(200);
  });

  it('stored 480 from another visit is limited on screen by the live limit', () => {
    // column + Tasks + pane share 600 px; Tasks keeps 280 → 320 for the column
    expect(navColumnWidthOnScreen({ mode: 'tablet', savedWidth: 480, availablePx: 600, tasksMinPx: TASKS_MIN })).toBe(320);
    // room enough — the stored width as it is
    expect(navColumnWidthOnScreen({ mode: 'tablet', savedWidth: 480, availablePx: 1000, tasksMinPx: TASKS_MIN })).toBe(480);
    // not even 200 left — still 200; folding is the person's call
    expect(navColumnWidthOnScreen({ mode: 'tablet', savedWidth: 480, availablePx: 400, tasksMinPx: TASKS_MIN })).toBe(200);
  });

  it('the row is measured live from the DOM at the press', () => {
    const row = document.createElement('div');
    const column = document.createElement('div');
    const handle = document.createElement('div');
    const tasks = document.createElement('div');
    tasks.className = 'col-tasks';
    const frame = document.createElement('div');
    const details = document.createElement('div');
    details.className = 'col-details';
    frame.append(details);
    row.append(column, handle, tasks, frame);
    document.body.append(row);
    boxOf(column, { width: 300 });
    boxOf(tasks, { width: 300 });
    boxOf(details, { width: 100 });

    expect(measureNavWidthDrag(handle, 'tablet', TASKS_MIN, 480)).toEqual({ start: 300, min: 200, max: 420 });
    boxOf(details, { width: 40 });
    expect(measureNavWidthDrag(handle, 'tablet', TASKS_MIN, 480).max).toBe(360);
  });
});

describe('split — over the sum of the two bodies, both ≥ 200', () => {
  it.each([
    [600, { min: 200, max: 400 }],
    [400, { min: 200, max: 200 }],
    // not enough for two minimums: collapsed onto 200, the column scrolls
    [350, { min: 200, max: 200 }],
    [0, { min: 200, max: 200 }],
  ])('bodies %d px → top body %o', (bodies, expected) => {
    expect(splitBounds(bodies)).toEqual(expected);
  });

  it.each([
    [0.5, 600, 300],
    [0.9, 600, 400],
    [0.1, 600, 200],
    [0.5, 350, 200],
  ])('split %d of %d px → top body %d px', (split, bodies, px) => {
    expect(splitToPx(split, bodies)).toBe(px);
  });

  it.each([
    [300, 600, 0.5],
    [240, 600, 0.4],
    [100, 600, 200 / 600],
    [550, 600, 400 / 600],
  ])('top body %d px of %d → split %d', (px, bodies, split) => {
    expect(pxToSplit(px, bodies)).toBeCloseTo(split, 10);
  });

  it('no bodies to divide → the default 0.5', () => {
    expect(pxToSplit(120, 0)).toBe(0.5);
  });

  it('the drag is bounded by the bodies alone, headers and handle not counted', () => {
    expect(splitDragBounds(300, 300)).toEqual({ start: 300, min: 200, max: 400 });
    const top = document.createElement('div');
    const bottom = document.createElement('div');
    boxOf(top, { height: 260 });
    boxOf(bottom, { height: 340 });
    expect(measureSplitDrag(top, bottom)).toEqual({ start: 260, min: 200, max: 400 });
  });
});
