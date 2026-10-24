/**
 * sk-285.7 T016 — the width mode is unambiguous in all three ranges and
 * ON both boundaries, and the document says which one it is.
 *
 * Coverage matrix row 24: "the width mode is unambiguous in three ranges and
 * on both boundaries (no flicker)", US-7, INV-6.
 *
 * ── What "unambiguous" has to mean for a test to be able to fail ────
 *
 * Not "the hook returns a string": it always does. The claims that can
 * be wrong are (a) every width belongs to EXACTLY one range, boundaries
 * included, (b) the boundary belongs to the UPPER range — the thing
 * `(min-width: N)` gives us for free and a hand-written `>` would take
 * away, (c) the answer is a function of the width alone, so approaching
 * a boundary from below and from above lands on the same mode rather
 * than on whichever side you came from, and (d) the document is told.
 * Each of those is asserted from a width, at widths named as numbers —
 * the environment (T035) has no `setMobile()` and this file wants none:
 * a boundary case has to BE the boundary width.
 *
 * ── The default matters more here than anywhere else ────────────────
 *
 * Nothing read a width before this task. The first test below is
 * therefore not decoration: it declares no width at all and asserts
 * `desktop`, which is the promise the other 160-odd test files rest on
 * — they were written against the desktop layout and would silently
 * assert about a different interface if the environment's default fell
 * under the floor. This file guards it through the code that will
 * actually do the switching.
 */

import { afterEach, describe, expect, test } from 'vitest';
import { act, render, renderHook } from '@testing-library/react';
import { createElement, Fragment } from 'react';

import {
  DESKTOP_MIN_PX,
  MOBILE_MIN_PX,
  WIDTH_MODE_ATTRIBUTE,
  readWidthMode,
  useWidthMode,
  widthModeFor,
  type WidthMode,
} from './useWidthMode';
import {
  DEFAULT_TEST_VIEWPORT_WIDTH,
  liveQueryCount,
  setViewportWidth,
} from '../test/viewport';

function attribute(): string | null {
  return document.documentElement.getAttribute(WIDTH_MODE_ATTRIBUTE);
}

afterEach(() => {
  document.documentElement.removeAttribute(WIDTH_MODE_ATTRIBUTE);
});

/**
 * The widths this file reasons about, and what each one is for.
 * `-1` / `0` / `+1` around each threshold is the whole boundary
 * question: the pair either side proves the cut is where it is, and
 * the threshold itself proves which side owns it.
 *
 * Module-scoped so the `matchMedia` walk and the `innerWidth` FALLBACK
 * walk are the same table rather than two tables that could drift: the
 * claim under test is that the two readers agree, and they cannot be
 * compared over different inputs.
 */
const CASES: ReadonlyArray<[number, WidthMode]> = [
  [320, 'mobile'],
  [390, 'mobile'], // the width US-6's acceptance names
  [MOBILE_MIN_PX - 1, 'mobile'],
  [MOBILE_MIN_PX, 'tablet'], // ← the boundary belongs to the upper range
  [MOBILE_MIN_PX + 1, 'tablet'],
  [1024, 'tablet'], // jsdom's own width, and a real tablet width
  [1280, 'tablet'], // a laptop just under the floor — panning is what T018–T020 remove
  [DESKTOP_MIN_PX - 1, 'tablet'],
  [DESKTOP_MIN_PX, 'desktop'], // ← the boundary belongs to the upper range
  [DESKTOP_MIN_PX + 1, 'desktop'],
  [1440, 'desktop'],
  [2560, 'desktop'],
];

describe('T016 / row 24 — three ranges and both boundaries', () => {
  test('the case table covers every range and both boundaries', () => {
    // A table that lost its mobile rows would leave the assertions
    // below green and the claim untested.
    const modes = new Set(CASES.map(([, mode]) => mode));
    expect([...modes].sort()).toEqual(['desktop', 'mobile', 'tablet']);
    expect(CASES.map(([w]) => w)).toContain(MOBILE_MIN_PX);
    expect(CASES.map(([w]) => w)).toContain(DESKTOP_MIN_PX);
  });

  test.each(CASES)('%ipx reads as %s', (width, expected) => {
    setViewportWidth(width);
    // The pure function, the environment reader, and the hook — three
    // ways to the same answer, and they have to agree or the mode is
    // not a function of the width.
    expect(widthModeFor(width)).toBe(expected);
    expect(readWidthMode()).toBe(expected);

    const { result } = renderHook(() => useWidthMode());
    expect(result.current).toBe(expected);
    expect(attribute()).toBe(expected);
  });

  test('a width is in exactly one range', () => {
    // Stated as a partition rather than as three separate rules: every
    // width from 0 to 3000 gets one of the three modes, and the cut
    // points are where the constants say.
    for (let width = 0; width <= 3000; width += 1) {
      const mode = widthModeFor(width);
      const expected =
        width >= DESKTOP_MIN_PX ? 'desktop' : width >= MOBILE_MIN_PX ? 'tablet' : 'mobile';
      expect(mode, `${width}px`).toBe(expected);
    }
  });
});

describe('T016 — the environment default is desktop', () => {
  test('a test that says nothing about width gets the desktop layout', () => {
    // Deliberately no setViewportWidth call: this is the state every
    // other test file in the suite is in.
    expect(DEFAULT_TEST_VIEWPORT_WIDTH).toBeGreaterThanOrEqual(DESKTOP_MIN_PX);
    const { result } = renderHook(() => useWidthMode());
    expect(result.current).toBe('desktop');
    expect(attribute()).toBe('desktop');
  });
});

describe('T016 — crossing a boundary, in both directions', () => {
  test('the mode and the attribute follow the window', () => {
    setViewportWidth(1440);
    const { result } = renderHook(() => useWidthMode());
    expect(result.current).toBe('desktop');

    const walk: ReadonlyArray<[number, WidthMode]> = [
      [DESKTOP_MIN_PX - 1, 'tablet'],
      [MOBILE_MIN_PX - 1, 'mobile'],
      [MOBILE_MIN_PX, 'tablet'], // up through the boundary from below
      [DESKTOP_MIN_PX, 'desktop'], // …and through the other one
      [DESKTOP_MIN_PX - 1, 'tablet'], // back down: the same width, the same answer
      [390, 'mobile'],
    ];
    for (const [width, expected] of walk) {
      act(() => setViewportWidth(width));
      expect(result.current, `${width}px`).toBe(expected);
      expect(attribute(), `${width}px`).toBe(expected);
    }
  });

  test('sitting ON a boundary does not oscillate', () => {
    // The "flicker" half of row 24. Re-declaring the same width, and
    // stepping one pixel off the boundary and back, has to return the
    // same answer every time — which it does because the answer is a
    // function of the width and the queries are inclusive on one side
    // only.
    const { result } = renderHook(() => useWidthMode());
    const seen: WidthMode[] = [];
    for (let i = 0; i < 4; i += 1) {
      act(() => setViewportWidth(DESKTOP_MIN_PX));
      seen.push(result.current);
      act(() => setViewportWidth(DESKTOP_MIN_PX - 1));
      seen.push(result.current);
    }
    expect(seen).toEqual([
      'desktop',
      'tablet',
      'desktop',
      'tablet',
      'desktop',
      'tablet',
      'desktop',
      'tablet',
    ]);
  });
});

describe('T016 — negative paths', () => {
  test('unmounting releases both subscriptions and stops tracking', () => {
    setViewportWidth(1440);
    const before = liveQueryCount();
    const { result, unmount } = renderHook(() => useWidthMode());
    expect(result.current).toBe('desktop');
    expect(liveQueryCount()).toBe(before + 2); // one per boundary

    unmount();
    expect(liveQueryCount()).toBe(before);

    // The attribute keeps the last known mode — the mode is a property
    // of the window, not of a component — but nothing updates it any
    // more, which is what proves the listeners are gone.
    act(() => setViewportWidth(390));
    expect(attribute()).toBe('desktop');
  });

  test('two mounts share the window and one unmount does not deafen the other', () => {
    setViewportWidth(1440);
    const first = renderHook(() => useWidthMode());
    const second = renderHook(() => useWidthMode());
    expect(liveQueryCount()).toBe(4);

    first.unmount();
    act(() => setViewportWidth(390));
    expect(second.result.current).toBe('mobile');
    expect(attribute()).toBe('mobile');
  });

  test('without matchMedia the mode still resolves, and still follows resize', () => {
    // Not a hypothetical shape: `useTheme` guards the same way for its
    // `prefers-color-scheme` listener. `innerWidth` is the same
    // measurement the `width` media feature is defined against
    // (viewport including a rendered scrollbar), so the fallback answers
    // what the query would have.
    setViewportWidth(1440);
    const real = window.matchMedia;
    try {
      // @ts-expect-error — removing a DOM API is the condition under test.
      delete window.matchMedia;
      expect(window.matchMedia).toBeUndefined();

      const { result } = renderHook(() => useWidthMode());
      expect(result.current).toBe('desktop');
      expect(attribute()).toBe('desktop');

      // `setViewportWidth` moves `innerWidth` and dispatches `resize`,
      // which is the only signal available in this mode.
      act(() => setViewportWidth(390));
      expect(result.current).toBe('mobile');
      expect(attribute()).toBe('mobile');
    } finally {
      window.matchMedia = real;
    }
  });

  test('the innerWidth fallback answers what the queries answer — every range, both boundaries', () => {
    // The review fix. Until now the fallback was reached at two
    // widths (1440 and 390) and NEITHER of them was a boundary, so the
    // claim in `useWidthMode.ts` that the two readers agree «across the
    // ranges and both boundaries» was a claim about the `matchMedia`
    // path only — the walk above never entered the `innerWidth` branch.
    // Same table, other reader: if `widthModeFor`'s comparisons and the
    // `min-width` queries ever disagreed about who owns a threshold,
    // exactly one of the two walks would go red.
    const real = window.matchMedia;
    try {
      // @ts-expect-error — removing a DOM API is the condition under test.
      delete window.matchMedia;
      expect(window.matchMedia).toBeUndefined();

      for (const [width, expected] of CASES) {
        setViewportWidth(width);
        expect(readWidthMode(), `${width}px via innerWidth`).toBe(expected);
      }
    } finally {
      window.matchMedia = real;
    }
  });

  test('the fallback follows a boundary crossing in both directions', () => {
    // The subscription half: without `matchMedia` the only signal is
    // `resize`, and the boundary widths have to arrive through it too —
    // not just resolve correctly on a fresh read.
    setViewportWidth(1440);
    const real = window.matchMedia;
    try {
      // @ts-expect-error — removing a DOM API is the condition under test.
      delete window.matchMedia;
      const { result } = renderHook(() => useWidthMode());
      expect(result.current).toBe('desktop');

      const walk: ReadonlyArray<[number, WidthMode]> = [
        [DESKTOP_MIN_PX - 1, 'tablet'],
        [DESKTOP_MIN_PX, 'desktop'],
        [MOBILE_MIN_PX, 'tablet'],
        [MOBILE_MIN_PX - 1, 'mobile'],
        [MOBILE_MIN_PX, 'tablet'], // back up through the same boundary
      ];
      for (const [width, expected] of walk) {
        act(() => setViewportWidth(width));
        expect(result.current, `${width}px via resize`).toBe(expected);
        expect(attribute(), `${width}px via resize`).toBe(expected);
      }
    } finally {
      window.matchMedia = real;
    }
  });

  test('a resize DURING the commit is not missed', () => {
    // The gap the re-read in the subscribe effect exists for, built as
    // an actual input rather than argued for in a comment: React
    // renders every component first and runs effects afterwards, so a
    // sibling that changes the width from its own render body moves the
    // window between the hook's initial read and its subscription —
    // exactly the window a real resize can land in. Without the re-read
    // the hook keeps reporting the mode the window has already left,
    // and no later event corrects it (the crossing has already
    // happened, and nothing was listening).
    setViewportWidth(1440);
    let seen: WidthMode | null = null;
    const Probe = (): null => {
      seen = useWidthMode();
      return null;
    };
    const ResizeDuringRender = (): null => {
      setViewportWidth(390);
      return null;
    };
    render(createElement(Fragment, null, createElement(Probe), createElement(ResizeDuringRender)));

    expect(seen).toBe('mobile');
    expect(attribute()).toBe('mobile');
  });

  test('a width of 0, or one that is not a number, reads as mobile', () => {
    // The safe end: the narrow layout fits on a wide window, the wide
    // one does not fit on a narrow one. `NaN` fails both comparisons
    // and needs no branch of its own — which is why there is none.
    expect(widthModeFor(0)).toBe('mobile');
    expect(widthModeFor(Number.NaN)).toBe('mobile');
    expect(widthModeFor(-1)).toBe('mobile');
  });

  test('the environment refuses to declare a width of 0', () => {
    // The other half of the case above: nothing in the suite can put
    // the window at 0, so the guard in `widthModeFor` is for a reading
    // that comes from outside the harness (an `innerWidth` of 0 in a
    // detached document, say), not for a width a test can set.
    expect(() => setViewportWidth(0)).toThrow();
    expect(() => setViewportWidth(Number.NaN)).toThrow();
  });
});
