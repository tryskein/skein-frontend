/**
 * sk-285.7 T017 — the FIRST FRAME already knows which width mode it is
 * in, and it decides it exactly the way every later frame does.
 *
 * The spec's edge case in its own words: "a narrow screen does not get
 * the desktop layout even for the duration of one frame".
 *
 * `public/theme-boot.js` is served raw to the browser. It is not in the
 * bundle, has no imports and cannot read `src/lib/useWidthMode.ts` at
 * runtime — so its thresholds and comparisons are a second copy of the
 * hook's, and a copy drifts. This file RUNS the script, in jsdom, at
 * fifteen widths including all four boundary neighbours, and compares
 * the attribute it leaves on `<html>` against `widthModeFor` from the
 * module. Same input, same answer, or the build is red.
 *
 * Running it is possible because the script asks for nothing jsdom
 * lacks: `window.innerWidth`, `window.localStorage`, `window.matchMedia`
 * and `document.documentElement`. So this is not a re-implementation of
 * the boot script under test — it is the boot script.
 */

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  DESKTOP_MIN_PX,
  MOBILE_MIN_PX,
  WIDTH_MODE_ATTRIBUTE,
  widthModeFor,
} from '../../../lib/useWidthMode';
import { setViewportWidth, resetViewportWidth } from '../../../test/viewport';
// Loaded as text only to be EXECUTED below, never searched.
import BOOT_SOURCE from '../../../../public/theme-boot.js?raw';

/** Run the boot script the way the browser does, and report what it set. */
function runBoot(): string | null {
  document.documentElement.removeAttribute(WIDTH_MODE_ATTRIBUTE);
  // `new Function` rather than `eval`: the boot script is a top-level
  // IIFE and must not see this file's scope, or a stray local of the
  // same name here could stand in for one of its own declarations and
  // the guard would be testing a script that does not exist on disk.
  new Function(BOOT_SOURCE)();
  return document.documentElement.getAttribute(WIDTH_MODE_ATTRIBUTE);
}

afterEach(() => {
  document.documentElement.removeAttribute(WIDTH_MODE_ATTRIBUTE);
  resetViewportWidth();
});

describe('T017 — running the script gives the same answer as the hook', () => {
  /**
   * Every width the two readers have to agree on. `-1 / 0 / +1` around
   * each threshold is the boundary question in full: the pair either
   * side says where the cut is, the threshold itself says which range
   * owns it.
   */
  const WIDTHS = [
    320,
    375,
    390,
    MOBILE_MIN_PX - 1,
    MOBILE_MIN_PX,
    MOBILE_MIN_PX + 1,
    900,
    1024,
    1240,
    DESKTOP_MIN_PX - 1,
    DESKTOP_MIN_PX,
    DESKTOP_MIN_PX + 1,
    1440,
    1920,
    2560,
  ];

  test.each(WIDTHS)('at %ipx the first frame agrees with widthModeFor', (width) => {
    setViewportWidth(width);
    expect(runBoot()).toBe(widthModeFor(width));
  });

  test('a phone never sees the desktop layout, not even for one frame', () => {
    // The spec's edge case, asserted as itself rather than only as a
    // consequence of the table above: below the floor the attribute is
    // never `desktop`, and it is never ABSENT either — an unset
    // attribute is the state the desktop stylesheet applies in.
    for (const width of [320, 390, 767, 768, 1024, DESKTOP_MIN_PX - 1]) {
      setViewportWidth(width);
      const mode = runBoot();
      expect(mode, `${width}px must not boot as desktop`).not.toBe('desktop');
      expect(mode, `${width}px must boot with a mode at all`).not.toBeNull();
    }
  });

  test('a desktop is NOT given the narrow layout for a frame either', () => {
    // The mirror of the rule above, and the reason R8 rules out
    // "default to mobile until measured": that would fix the phone by
    // breaking every wide window instead.
    for (const width of [DESKTOP_MIN_PX, 1440, 2560]) {
      setViewportWidth(width);
      expect(runBoot()).toBe('desktop');
    }
  });
});

describe('T017 — the width mode does not depend on the theme half', () => {
  const KEY = 'skein.theme';

  beforeEach(() => {
    window.localStorage.clear();
  });

  test('both attributes land in one run', () => {
    document.documentElement.removeAttribute('data-theme');
    window.localStorage.setItem(KEY, 'dark');
    setViewportWidth(390);
    expect(runBoot()).toBe('mobile');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  test('a blocked localStorage still leaves a width mode', () => {
    // The theme half is wrapped in try/catch and its catch writes a
    // fallback; the width half sits AFTER that block precisely so a
    // storage failure cannot cost the first frame its layout. Private
    // mode and "block site data" both reach this.
    const storage = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('storage blocked');
      },
    });
    try {
      setViewportWidth(390);
      expect(runBoot()).toBe('mobile');
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    } finally {
      if (storage) Object.defineProperty(window, 'localStorage', storage);
      else Reflect.deleteProperty(window as unknown as Record<string, unknown>, 'localStorage');
    }
  });
});
