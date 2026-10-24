/**
 * sk-285.7 T008 — the width budget (`appFloorPx`) and its terms.
 *
 * The budget sums the default widths of the fixed columns, one resize
 * handle per column, the lens frame on both sides and the readability
 * threshold left for Details. These tests hold the arithmetic: every
 * term moves the total with the multiplier it is supposed to have, and
 * inputs the budget cannot sum are refused.
 *
 * The lengths are test inputs rather than values read from the
 * stylesheet (sk-540.11, owner decision: tests do not read CSS text).
 */

import { describe, expect, test } from 'vitest';

import { COL_BOUNDS } from './useLayoutState';
import {
  DETAILS_MIN_READABLE_PX,
  LENS_FRAME_SIDES,
  appFloorBreakdown,
  appFloorPx,
  type ColWidthBoundsMap,
} from './widthBudget';

/** Frame and handle widths fed to the budget — arbitrary distinct px. */
const LENS_FRAME_PX = 3;
const WIDTH_RESIZE_PX = 5;

const TOKENS_IN = { lensFramePx: LENS_FRAME_PX, widthResizePx: WIDTH_RESIZE_PX };
const COL_KEYS = Object.keys(COL_BOUNDS);

/* ───────────────── the inputs are real before they are used ────────── */

describe('width budget — the inputs exist and are non-degenerate', () => {
  test('the workspace declares at least one fixed column', () => {
    // A budget summed over an empty map returns frame + threshold and
    // agrees with nothing; every check below would then be arithmetic
    // about a layout that does not exist.
    expect(COL_KEYS.length).toBeGreaterThan(0);
  });

  test.each(COL_KEYS)('%s has a positive default that sits inside its own drag bounds', (col) => {
    // The floor is built on the DEFAULTS, and the defaults are the width
    // the user gets back when they have never dragged (or when the
    // persisted value is out of range and gets clamped). A default
    // outside its own min/max is a width the layout budgets for and can
    // never actually restore — the floor would then be sized for a state
    // the shell refuses to enter.
    const b = COL_BOUNDS[col as keyof typeof COL_BOUNDS];
    expect(b.default).toBeGreaterThan(0);
    expect(b.min).toBeLessThanOrEqual(b.default);
    expect(b.default).toBeLessThanOrEqual(b.max);
  });

  test('the formula consumes EVERY fixed column, not a subset', () => {
    // A column dropped from the sum would only show as a smaller total;
    // the breakdown says which columns went in.
    const b = appFloorBreakdown(COL_BOUNDS as ColWidthBoundsMap, TOKENS_IN);
    expect(b.columns.map((c) => c.col).sort()).toEqual([...COL_KEYS].sort());
  });

  test('the threshold is a declared constant, not a number in a comment', () => {
    // If the constant were ever softened into "whatever is left", the
    // budget would define itself and the criterion would be unfalsifiable.
    expect(Number.isInteger(DETAILS_MIN_READABLE_PX)).toBe(true);
    expect(DETAILS_MIN_READABLE_PX).toBeGreaterThan(0);
    const b = appFloorBreakdown(COL_BOUNDS as ColWidthBoundsMap, TOKENS_IN);
    expect(b.floorPx - b.framePx - b.columnsPx - b.handlesPx).toBe(DETAILS_MIN_READABLE_PX);
  });
});

/* ──────────────── every term actually moves the total ──────────────── */

describe('sensitivity — no term of the formula is inert', () => {
  const base = appFloorPx(COL_BOUNDS as ColWidthBoundsMap, TOKENS_IN);
  /** An arbitrary non-unit delta, so a term counted once cannot be
   *  confused with one counted twice. */
  const D = 7;

  test.each(COL_KEYS)('%s.default moves the floor 1:1', (col) => {
    const bumped = {
      ...COL_BOUNDS,
      [col]: {
        ...COL_BOUNDS[col as keyof typeof COL_BOUNDS],
        default: COL_BOUNDS[col as keyof typeof COL_BOUNDS].default + D,
      },
    } as ColWidthBoundsMap;
    expect(appFloorPx(bumped, TOKENS_IN)).toBe(base + D);
  });

  test('--lens-frame moves the floor by LENS_FRAME_SIDES per px', () => {
    expect(appFloorPx(COL_BOUNDS as ColWidthBoundsMap, { ...TOKENS_IN, lensFramePx: LENS_FRAME_PX + D })).toBe(
      base + LENS_FRAME_SIDES * D,
    );
  });

  test('--width-resize moves the floor by one handle per fixed column', () => {
    expect(
      appFloorPx(COL_BOUNDS as ColWidthBoundsMap, { ...TOKENS_IN, widthResizePx: WIDTH_RESIZE_PX + D }),
    ).toBe(base + COL_KEYS.length * D);
  });

  test('the floor is recomputed, never read back from the stylesheet', () => {
    // The degenerate implementation this guards against: a formula that
    // parses --app-min-width and returns it would satisfy the equality
    // test forever. Under a fabricated column map it must produce a
    // fabricated floor, not the declared one.
    const fake: ColWidthBoundsMap = { only: { min: 1, max: 9999, default: 1000 } };
    const out = appFloorPx(fake, { lensFramePx: 1, widthResizePx: 2 });
    expect(out).toBe(2 * 1 + 1000 + 1 * 2 + DETAILS_MIN_READABLE_PX);
  });
});

/* ───────────────────────── refusals (negative) ─────────────────────── */

describe('appFloorBreakdown refuses inputs it cannot budget', () => {
  test('an empty column map throws instead of returning a plausible number', () => {
    expect(() => appFloorPx({}, TOKENS_IN)).toThrow(/empty/i);
  });

  test('a non-finite or negative length throws', () => {
    expect(() =>
      appFloorPx(COL_BOUNDS as ColWidthBoundsMap, { ...TOKENS_IN, lensFramePx: Number.NaN }),
    ).toThrow(/--lens-frame/);
    expect(() =>
      appFloorPx(COL_BOUNDS as ColWidthBoundsMap, { ...TOKENS_IN, widthResizePx: -4 }),
    ).toThrow(/--width-resize/);
    expect(() =>
      appFloorPx({ ghost: { min: 0, max: 0, default: Number.NaN } }, TOKENS_IN),
    ).toThrow(/ghost\.default/);
  });
});
