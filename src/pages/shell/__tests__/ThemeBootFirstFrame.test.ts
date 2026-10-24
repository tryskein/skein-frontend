/**
 * sk-285.7.2.48 — the FIRST FRAME is already in the user's theme, and it
 * decides that theme from the server's preference rather than from the
 * OS.
 *
 * ── The defect this guard exists to keep fixed ──────────────────────
 *
 * Measured on live Chromium (`http://host.docker.internal:5173/`), an
 * account whose stored theme is `dark`, an OS on light, and no
 * `skein.theme` in this browser:
 *
 *     24.2ms  data-theme="light"       ← theme-boot.js
 *    244.0ms  first-paint              light
 *    276.0ms  first-contentful-paint   still light
 *    301.2ms  data-theme="dark"        ← /me/theme finally resolved
 *
 * Two independent auditors of sk-285.7 reported the same thing as
 * «starts light, switches after ~2s» — the number depends only on how
 * long `/me/theme` takes. The script always ran, and ran early: it read
 * `localStorage['skein.theme']` → `prefers-color-scheme` → `light`, and
 * the server, which is the truth after login, appears in none of those.
 *
 * ── Why the guard has to RUN the script ─────────────────────────────
 *
 * A guard that asserted the script is present in `index.html`, or that
 * grepped it for the new key, would be green under every one of the
 * failure modes the task enumerated: a script that never runs, a script
 * that runs late, a script that reads the wrong source. Only executing
 * it against a record the app really writes can tell those apart. So
 * this file RUNS `theme-boot.js` — in jsdom, via `new Function`, the same
 * source the browser is served — against records produced by
 * `writeThemeBootCache` and reads back what landed on `<html>`.
 *
 * That direction matters. The records are never hand-written JSON here:
 * they come out of `src/lib/themeBootCache.ts`, so a field the module
 * renames and the script still reads (or the reverse) fails HERE
 * instead of on the first frame of a production load. The shape is
 * duplicated between the two files by necessity — the script is served
 * raw, has no imports and is not in the bundle — and this is the seam
 * that holds the copies together.
 *
 * The script asks for nothing jsdom lacks: `localStorage`, `matchMedia`
 * (stubbed per-test here because the suite's own `matchMedia` refuses
 * `prefers-color-scheme` by design — see `src/test/viewport.ts`),
 * `window.innerWidth` and `document.documentElement`.
 */

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  THEME_BOOT_CACHE_KEY,
  THEME_BOOT_CACHE_VERSION,
  clearThemeBootCache,
  readThemeBootCache,
  writeThemeBootCache,
  type ThemeBootCache,
} from '../../../lib/themeBootCache';

// The script is served raw from `public/` and is not in the bundle, so
// it is loaded as text and executed below — the behaviour under test is
// what it paints, not how it is written.
import BOOT_SOURCE from '../../../../public/theme-boot.js?raw';

/** The key the app has always used for «the human picked this, here». */
const LEGACY_KEY = 'skein.theme';

/**
 * The map a custom theme hands the boot script.
 *
 * Deliberately names no role from either dictionary: the script copies
 * any `--*` key regardless, so what these are called is exactly the
 * point that does NOT matter here.
 */
const CUSTOM_VARS = { '--x-boot-probe-bg': '#101014', '--x-boot-probe-ink': '#0f7b6c' };

let savedMatchMedia: typeof window.matchMedia | undefined;

/**
 * Declare what `prefers-color-scheme` answers for the next run.
 *
 * `'absent'` removes `matchMedia` entirely — a real state (old
 * browsers, and any environment that strips it), and the one branch
 * where the script must fall back to the server's last resolved
 * palette instead of guessing light.
 */
function setOSTheme(os: 'light' | 'dark' | 'absent'): void {
  if (os === 'absent') {
    Reflect.deleteProperty(window as unknown as Record<string, unknown>, 'matchMedia');
    return;
  }
  window.matchMedia = ((query: string) =>
    ({
      matches: os === 'dark' && query.includes('prefers-color-scheme: dark'),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList) as typeof window.matchMedia;
}

/**
 * Run the boot script the way the browser does, and report the theme it
 * left on `<html>`.
 *
 * `new Function` rather than `eval` for the reason `BootWidthMode`
 * gives: the script is a top-level IIFE and must not see this file's
 * scope, or a local of the same name here could stand in for one of its
 * own declarations and the guard would be testing a script that does
 * not exist on disk.
 */
function runBoot(): string | null {
  const root = document.documentElement;
  root.removeAttribute('data-theme');
  root.style.removeProperty('color-scheme');
  for (const key of Object.keys(CUSTOM_VARS)) root.style.removeProperty(key);
  new Function(BOOT_SOURCE)();
  return root.getAttribute('data-theme');
}

/** A built-in record, as `useTheme` writes one. */
function builtinRecord(builtin: 'light' | 'dark'): ThemeBootCache {
  return { v: THEME_BOOT_CACHE_VERSION, mode: 'builtin', builtin };
}

beforeEach(() => {
  savedMatchMedia = window.matchMedia;
  window.localStorage.clear();
  setOSTheme('light');
});

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.style.removeProperty('color-scheme');
  for (const key of Object.keys(CUSTOM_VARS)) {
    document.documentElement.style.removeProperty(key);
  }
  if (savedMatchMedia) window.matchMedia = savedMatchMedia;
});

describe('the measured defect, asserted as itself', () => {
  test('an account on dark, an OS on light, no local pick — the first frame is dark', () => {
    // This is the 244ms-of-light load, reproduced at its source. It is
    // the one assertion in this file that would have been red before
    // the fix and green after it, with nothing else changed.
    setOSTheme('light');
    writeThemeBootCache(builtinRecord('dark'));
    expect(runBoot()).toBe('dark');
  });

  test('the reverse mispaint too: an account on light under a dark OS', () => {
    setOSTheme('dark');
    writeThemeBootCache(builtinRecord('light'));
    expect(runBoot()).toBe('light');
  });

  test('the server record outranks a stale local pick', () => {
    setOSTheme('light');
    window.localStorage.setItem(LEGACY_KEY, 'light');
    writeThemeBootCache(builtinRecord('dark'));
    expect(runBoot()).toBe('dark');
  });
});

describe('a record answers the question outright — the OS is not asked', () => {
  // sk-285.7.19. A third state used to sit between the record and the
  // paint: `followSystem` sent the script to `matchMedia` even when a
  // record existed. It is gone, and this is the shape that replaces it —
  // a record is the whole answer, and no branch inside it defers to the
  // browser.
  test.each([
    ['dark', 'light'],
    ['light', 'dark'],
  ] as const)('OS %s does not move a record that says %s', (os, builtin) => {
    setOSTheme(os);
    writeThemeBootCache(builtinRecord(builtin));
    expect(runBoot()).toBe(builtin);
  });

  test('a record still paints where `matchMedia` does not exist at all', () => {
    // The browser cannot be asked, and with a record there is nothing to
    // ask it: the stored palette is the answer either way.
    setOSTheme('absent');
    writeThemeBootCache(builtinRecord('dark'));
    expect(runBoot()).toBe('dark');
  });
});

describe('a custom theme paints its own map before React exists', () => {
  const customRecord: ThemeBootCache = {
    v: THEME_BOOT_CACHE_VERSION,
    mode: 'custom',
    builtin: 'light',
    vars: CUSTOM_VARS,
    base: 'dark',
  };

  test('every variable lands on `<html>`, with the theme base as color-scheme', () => {
    writeThemeBootCache(customRecord);
    expect(runBoot()).toBe('custom');
    const style = document.documentElement.style;
    for (const [key, value] of Object.entries(CUSTOM_VARS)) {
      expect(style.getPropertyValue(key)).toBe(value);
    }
    expect(style.colorScheme).toBe('dark');
  });

  test('a light-based custom theme gets `color-scheme: light`', () => {
    writeThemeBootCache({ ...customRecord, base: 'light' });
    runBoot();
    expect(document.documentElement.style.colorScheme).toBe('light');
  });

  test('only custom properties are copied out of the map', () => {
    // The map arrives from the server. A record carrying `position` or
    // `background` would otherwise be inline styles on `<html>` that
    // no strip in `themeRuntime` knows about.
    writeThemeBootCache({
      ...customRecord,
      vars: { ...CUSTOM_VARS, position: 'fixed' },
    });
    runBoot();
    expect(document.documentElement.style.getPropertyValue('position')).toBe('');
    expect(document.documentElement.style.getPropertyValue('--x-boot-probe-ink')).toBe(
      CUSTOM_VARS['--x-boot-probe-ink'],
    );
  });

  test('a custom record with no map falls back to the stored built-in', () => {
    // Reachable: `useTheme` writes `mode: 'custom'` only with a loaded
    // theme, but a record written by an older build, or one whose theme
    // was deleted server-side, can arrive without `vars`.
    writeThemeBootCache({ v: THEME_BOOT_CACHE_VERSION, mode: 'custom', builtin: 'dark' });
    setOSTheme('light');
    expect(runBoot()).toBe('dark');
  });
});

describe('an unusable record falls back to the order that shipped before', () => {
  test('no record at all: the local pick wins, then the OS', () => {
    clearThemeBootCache();
    window.localStorage.setItem(LEGACY_KEY, 'dark');
    setOSTheme('light');
    expect(runBoot()).toBe('dark');

    window.localStorage.removeItem(LEGACY_KEY);
    setOSTheme('dark');
    expect(runBoot()).toBe('dark');

    setOSTheme('light');
    expect(runBoot()).toBe('light');
  });

  test('a record from a future schema version is ignored, not guessed at', () => {
    window.localStorage.setItem(
      THEME_BOOT_CACHE_KEY,
      JSON.stringify({ v: THEME_BOOT_CACHE_VERSION + 1, mode: 'builtin', builtin: 'dark' }),
    );
    setOSTheme('light');
    expect(runBoot()).toBe('light');
    // And the module's own reader agrees it is unusable — the two
    // parses answer the same, which is what makes «ignored» a property
    // of the schema rather than of one of its two readers.
    expect(readThemeBootCache()).toBeNull();
  });

  test('corrupt JSON costs the frame nothing', () => {
    window.localStorage.setItem(THEME_BOOT_CACHE_KEY, '{not json');
    window.localStorage.setItem(LEGACY_KEY, 'dark');
    expect(runBoot()).toBe('dark');
    expect(readThemeBootCache()).toBeNull();
  });

  test('a record with an unknown built-in value does not paint it', () => {
    window.localStorage.setItem(
      THEME_BOOT_CACHE_KEY,
      JSON.stringify({ v: THEME_BOOT_CACHE_VERSION, mode: 'builtin', builtin: 'solarized' }),
    );
    setOSTheme('dark');
    expect(runBoot()).toBe('dark');
  });

  test('a blocked localStorage still leaves a theme on the first frame', () => {
    const storage = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('storage blocked');
      },
    });
    try {
      expect(runBoot()).toBe('light');
    } finally {
      if (storage) Object.defineProperty(window, 'localStorage', storage);
      else Reflect.deleteProperty(window as unknown as Record<string, unknown>, 'localStorage');
    }
  });
});

describe('the record survives the round trip through storage', () => {
  test('what the module writes is what the module reads back', () => {
    const record = builtinRecord('dark');
    writeThemeBootCache(record);
    expect(readThemeBootCache()).toEqual(record);
  });

  test('clearing it returns the boot script to the pre-login order', () => {
    writeThemeBootCache(builtinRecord('dark'));
    expect(runBoot()).toBe('dark');
    clearThemeBootCache();
    setOSTheme('light');
    expect(runBoot()).toBe('light');
  });
});
