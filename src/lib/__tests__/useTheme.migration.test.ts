/**
 * sk-285.7 T012 — the saved theme is migrated ON THE READ PATH.
 *
 * T011 built `migrateThemeVariables` and proved it in isolation. What is
 * at stake here is different and is not provable from that file: that
 * the function is actually IN the path a saved theme travels to the
 * screen. The failure this guards against is silent in the worst way —
 * the app renders, `useTheme` reports a custom theme, nothing throws,
 * and the user sees the pre-redesign type scale with their own colours
 * on it, or a role painted by nothing at all because the value points
 * at a name the dictionary no longer declares.
 *
 * So every assertion below reads what actually landed on
 * `document.documentElement.style` after the hook resolved — the same
 * inline properties the browser paints from — rather than anything the
 * hook returns about itself.
 *
 * ## Where the two sides of each comparison come from
 *
 * The fixture is a real pre-redesign snapshot (`LEGACY_DEFAULTS`, the
 * frozen photograph from T002) with exactly two roles edited, so it is
 * the shape a live user's row actually has. Expected values are read
 * from the OTHER module in each case — the new registry (`ALL_TOKENS`)
 * for a re-seeded role, the fixture's own literal for a carried one —
 * and every pair that has to DIFFER for the assertion to mean anything
 * is asserted to differ first. A guard whose two sides can coincide
 * proves nothing, and here they very nearly do: `--font-sm` moved
 * 13px → 14px, one pixel apart.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

import { useTheme } from '../useTheme';
import { migrateThemeVariables, type ThemeBase } from '../themeMigration';
import { ALL_TOKENS, ALL_TOKEN_KEYS, defaultVariablesForBase } from '../themeTokens';
import { LEGACY_DEFAULTS, LEGACY_TOKEN_KEYS } from '../themeTokensLegacy';

const THEME_ID = 'theme-under-test';

/** A colour nothing in either dictionary declares — so finding it is proof. */
const USER_BRAND = '#0f7b6c';
/** A text size nobody's default is, on either side of the redesign. */
const USER_FONT_SM = '11px';

/** The builtin value of one new role on one base — the INV-9 seed. */
function builtin(key: string, base: ThemeBase): string {
  const def = ALL_TOKENS.find((t) => t.key === key);
  if (!def) throw new Error(`${key} is not a role of the new registry`);
  return base === 'dark' ? def.dark : def.light;
}

/**
 * A saved row exactly as it sat on the server the day before the
 * redesign: the whole old dictionary, with two roles the user changed.
 */
function savedVariables(base: ThemeBase): Record<string, string> {
  return {
    ...LEGACY_DEFAULTS[base],
    // A COLOUR the user chose — INV-2 says it survives.
    '--brand': USER_BRAND,
    // A STRUCTURAL role the user chose — INV-11 / R5 say it survives
    // BECAUSE it differs from the old default.
    '--font-sm': USER_FONT_SM,
  };
}

function themeRow(base: ThemeBase, variables: Record<string, string>) {
  return {
    id: THEME_ID,
    name: 'Migrated under test',
    base,
    variables,
    createdBy: { id: 'u1', username: 'someone' },
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    updatedBy: { id: 'u1', username: 'someone' },
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Serve `/api/v1/me/theme` (mode=custom) and `/api/v1/themes/:id`.
 * `themeResponse` decides what the theme endpoint answers, so the
 * failure path is expressed by handing it a 500 rather than by a
 * separate harness.
 */
function stubServer(
  themeResponse: () => Response,
  builtinTheme: ThemeBase = 'light',
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: RequestInfo) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    if (url.includes('/api/v1/me/theme')) {
      return json({ mode: 'custom', builtinTheme, customThemeId: THEME_ID });
    }
    if (url.includes('/api/v1/themes/')) return themeResponse();
    throw new Error(`unexpected request: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function wrapper(): { wrapper: ({ children }: { children: ReactNode }) => ReturnType<typeof createElement> } {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children),
  };
}

/** What is actually inline on `:root` right now. */
function applied(key: string): string {
  return document.documentElement.style.getPropertyValue(key).trim();
}

/**
 * Render the hook against a saved row and wait until the custom theme
 * has been resolved AND painted.
 */
async function paintSavedTheme(base: ThemeBase, variables: Record<string, string>): Promise<void> {
  stubServer(() => json(themeRow(base, variables)));
  renderHook(() => useTheme(), wrapper());
  await waitFor(() => {
    expect(document.documentElement.getAttribute('data-theme')).toBe('custom');
  });
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('style');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('style');
});

describe('T012 — the fixture is the shape it claims to be', () => {
  test('the pairs the assertions depend on actually differ', () => {
    // Every one of these is a "before ≠ after" the tests below lean on.
    // If any pair collapsed, the corresponding assertion would pass for
    // both a migrated and an unmigrated theme.
    expect(LEGACY_DEFAULTS.light['--font-base']).not.toBe(builtin('--font-base', 'light'));
    expect(LEGACY_DEFAULTS.light['--font-sm']).not.toBe(USER_FONT_SM);
    expect(builtin('--font-sm', 'light')).not.toBe(USER_FONT_SM);
    expect(LEGACY_DEFAULTS.light['--brand']).not.toBe(USER_BRAND);
    expect(builtin('--primary', 'light')).not.toBe(USER_BRAND);
    expect(builtin('--primary', 'dark')).not.toBe(USER_BRAND);
    expect(builtin('--primary', 'dark')).not.toBe(builtin('--primary', 'light'));
    expect(builtin('--n-900', 'dark')).not.toBe(builtin('--n-900', 'light'));
    // `--n-900` must be a role NOTHING carries into, or the dark-base
    // test below would be watching a carried value, not a seeded one.
    expect(ALL_TOKENS.find((t) => t.key === '--n-900')?.predecessors).toBeUndefined();
    // And the fixture really is the old dictionary, not a stub of it.
    expect(Object.keys(savedVariables('light')).sort()).toEqual([...LEGACY_TOKEN_KEYS].sort());
    expect(LEGACY_TOKEN_KEYS.length).toBeGreaterThan(0);
    expect(ALL_TOKEN_KEYS.length).toBeGreaterThan(0);
  });
});

describe('T012 / US-3 — a saved theme is painted in the NEW language', () => {
  test('the colour the user chose survives to the document (INV-2)', async () => {
    await paintSavedTheme('light', savedVariables('light'));
    // `--brand` no longer exists; its value now belongs to `--primary`.
    expect(applied('--primary')).toBe(USER_BRAND);
  });

  test('an untouched structural role is re-seeded with the NEW default', async () => {
    await paintSavedTheme('light', savedVariables('light'));
    // This is "the new typography": the snapshot says 14px, the redesign
    // says 16px, and the redesign wins because nobody chose the 14.
    expect(applied('--font-base')).toBe(builtin('--font-base', 'light'));
    expect(applied('--font-base')).not.toBe(LEGACY_DEFAULTS.light['--font-base']);
  });

  test('a structural role the user DID set keeps their value (INV-11, R5)', async () => {
    await paintSavedTheme('light', savedVariables('light'));
    expect(applied('--font-sm')).toBe(USER_FONT_SM);
  });

  test('a role the saved theme never had is seeded from the theme base (INV-9)', async () => {
    await paintSavedTheme('light', savedVariables('light'));
    // `--font-2xl` has no predecessor at all — it did not exist before.
    expect(applied('--font-2xl')).toBe(builtin('--font-2xl', 'light'));
  });

  test('EVERY role of the new dictionary is painted, none left to the cascade (INV-9)', async () => {
    await paintSavedTheme('light', savedVariables('light'));
    const missing = ALL_TOKEN_KEYS.filter((k) => applied(k) === '');
    expect(missing).toEqual([]);
  });

  test('no pre-redesign-only name is painted', async () => {
    await paintSavedTheme('light', savedVariables('light'));
    // The names the new dictionary kept are legitimately here; the ones
    // it dropped must not be, or the document carries a value nothing
    // reads and the next theme inherits it.
    const known = new Set(ALL_TOKEN_KEYS);
    const goneButPainted = LEGACY_TOKEN_KEYS.filter((k) => !known.has(k) && applied(k) !== '');
    expect(goneButPainted).toEqual([]);
    // Non-degenerate: the fixture really did carry names that are gone.
    expect(LEGACY_TOKEN_KEYS.filter((k) => !known.has(k)).length).toBeGreaterThan(0);
  });

  test('a DARK theme is filled from the dark column, never the light one', async () => {
    await paintSavedTheme('dark', savedVariables('dark'));
    // The user's own colour is base-independent — they chose it.
    expect(applied('--primary')).toBe(USER_BRAND);
    // A role the snapshot could not have had — `--n-900` is part of the
    // ramp the redesign introduced, so nothing carries into it and it is
    // SEEDED. Seeded from the theme's own base, which is the claim.
    expect(applied('--n-900')).toBe(builtin('--n-900', 'dark'));
    expect(applied('--n-900')).not.toBe(builtin('--n-900', 'light'));
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });

  test('a value that referenced a retired role does not point at a dead name (INV-13)', async () => {
    await paintSavedTheme('light', savedVariables('light'));
    const known = new Set(ALL_TOKEN_KEYS);
    const dangling: string[] = [];
    for (const key of ALL_TOKEN_KEYS) {
      for (const ref of applied(key).matchAll(/var\(\s*(--[a-zA-Z0-9_-]+)/g)) {
        if (!known.has(ref[1])) dangling.push(`${key} → ${ref[1]}`);
      }
    }
    expect(dangling).toEqual([]);
  });
});

describe('T012 — the read path is idempotent, so T013 may or may not have run', () => {
  test('a row already written back in the new dictionary reads back unchanged', async () => {
    // This is the state T013 leaves behind. Migrating it again must be
    // a no-op, or the two tasks would fight each other on every load.
    const alreadyMigrated = migrateThemeVariables(savedVariables('light'), 'light');
    await paintSavedTheme('light', alreadyMigrated);

    const painted = Object.fromEntries(ALL_TOKEN_KEYS.map((k) => [k, applied(k)]));
    const expected = Object.fromEntries(
      Object.entries(alreadyMigrated).map(([k, v]) => [k, v.trim()]),
    );
    expect(painted).toEqual(expected);
    // …and it is still the user's theme, not a re-seeded one.
    expect(painted['--primary']).toBe(USER_BRAND);
    expect(painted['--font-sm']).toBe(USER_FONT_SM);
  });

  test('the migration does not re-run on every render', async () => {
    // "Cheap" is the other half of the T012 brief, and it is checkable
    // as IDENTITY: a migration recomputed per render would hand back a
    // fresh object each time, which re-runs `applyActive` and rewrites
    // 86 inline properties on every render of anything that mounts the
    // hook. Same object across renders means it ran once for this row.
    stubServer(() => json(themeRow('light', savedVariables('light'))));
    const { result, rerender } = renderHook(() => useTheme(), wrapper());
    await waitFor(() => expect(result.current.active.customTheme).not.toBeNull());

    const first = result.current.active.customTheme;
    rerender();
    rerender();
    expect(result.current.active.customTheme).toBe(first);
    // Non-degenerate: `first` is a real migrated theme, not null.
    expect(first?.variables['--primary']).toBe(USER_BRAND);
  });

  test('the un-migrated and the already-migrated row paint the SAME document', async () => {
    await paintSavedTheme('light', savedVariables('light'));
    const fromLegacy = Object.fromEntries(ALL_TOKEN_KEYS.map((k) => [k, applied(k)]));

    document.documentElement.removeAttribute('style');
    document.documentElement.removeAttribute('data-theme');
    vi.unstubAllGlobals();

    await paintSavedTheme('light', migrateThemeVariables(savedVariables('light'), 'light'));
    const fromMigrated = Object.fromEntries(ALL_TOKEN_KEYS.map((k) => [k, applied(k)]));

    expect(fromMigrated).toEqual(fromLegacy);
    // Guard against both being empty, which would make the line above
    // true and meaningless.
    expect(Object.values(fromLegacy).filter((v) => v !== '').length).toBe(ALL_TOKEN_KEYS.length);
  });
});

describe('T012 — negative paths', () => {
  test('a theme that fails to load gives a WHOLE builtin theme, not half a set', async () => {
    // The spec's failure edge: "theme load failure from the server —
    // the user gets the builtin theme of their base, not a
    // half-settled set of roles."
    stubServer(() => new Response('boom', { status: 500 }));
    const { result } = renderHook(() => useTheme(), wrapper());

    await waitFor(() => {
      expect(result.current.active.customThemeId).toBe(THEME_ID);
    });
    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    });
    // Nothing inline at all: the builtin theme lives in the stylesheet's
    // `[data-theme]` rules, and a partial inline set is precisely the
    // "half-populated" state the edge case forbids.
    const painted = ALL_TOKEN_KEYS.filter((k) => applied(k) !== '');
    expect(painted).toEqual([]);
    expect(result.current.active.customTheme).toBeNull();
  });

  test('the builtin the failure falls back to follows the BASE, not a constant', async () => {
    // "the builtin theme of ITS OWN BASE" — the half of the edge case a
    // light-only test cannot see. When the row never arrives, the theme's
    // own base is unknowable (it lives in the row), so the user's builtin
    // preference IS the base on offer — and it has to be honoured rather
    // than defaulted to light.
    stubServer(() => new Response('boom', { status: 500 }), 'dark');
    renderHook(() => useTheme(), wrapper());

    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    });
    expect(ALL_TOKEN_KEYS.filter((k) => applied(k) !== '')).toEqual([]);
  });

  test('an EMPTY variables map is filled from the base, not left blank', async () => {
    await paintSavedTheme('dark', {});
    const missing = ALL_TOKEN_KEYS.filter((k) => applied(k) === '');
    expect(missing).toEqual([]);
    expect(applied('--bg')).toBe(builtin('--bg', 'dark'));
  });

  test('a map of names from no dictionary at all is dropped, not painted', async () => {
    await paintSavedTheme('light', {
      '--not-a-role': 'red',
      '--another-invention': '99px',
      '--brand': USER_BRAND,
    });
    expect(applied('--not-a-role')).toBe('');
    expect(applied('--another-invention')).toBe('');
    // The one real role in that map still lands.
    expect(applied('--primary')).toBe(USER_BRAND);
    // And the rest of the dictionary is complete regardless.
    expect(ALL_TOKEN_KEYS.filter((k) => applied(k) === '')).toEqual([]);
  });
});

describe('T012 — the editor and the shell seed from the same rule', () => {
  test('a brand-new theme and migrate({}) agree, on both bases', () => {
    // The editor still seeds a NEW theme (no snapshot to own) from
    // `defaultVariablesForBase`. That is only safe while it is the same
    // answer the migration gives for an empty snapshot — otherwise
    // "one ownership rule" would be two again, quietly.
    for (const base of ['light', 'dark'] as const) {
      expect(migrateThemeVariables({}, base)).toEqual(defaultVariablesForBase(base));
    }
    // Non-degenerate: neither side is empty.
    expect(Object.keys(defaultVariablesForBase('light')).length).toBe(ALL_TOKEN_KEYS.length);
  });
});
