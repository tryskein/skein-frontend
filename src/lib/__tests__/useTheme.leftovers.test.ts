/**
 * sk-285.7 T014 — INV-12 on the path that actually paints:
 * "applying a theme leaves no values of the previously applied
 * theme in the document — neither the previous dictionary, nor roles that are not in the applied theme".
 *
 * Coverage matrix rows 20 (nothing outside B survives applying B), 21
 * (switching between two saved themes), 22 (a trip through a builtin
 * theme and back).
 *
 * ── The defect this file reproduces, and the one input that shows it ─
 *
 * `applyActive`'s custom branch used to call `applyVariables` with no
 * strip in front of it, and applying a map only overwrites the keys the
 * map contains. Whether that is observable depends entirely on whether
 * the document can be carrying a key the incoming theme lacks — and
 * between two SAVED themes it cannot, because `migrateThemeVariables`
 * builds its output from `ALL_TOKENS`, so both maps are the whole
 * dictionary and the second overwrites the first key for key. (That is
 * asserted below rather than assumed: it is the reason row 21 needs a
 * third ingredient to be a test rather than a tautology.)
 *
 * The ingredient is a LIVE PREVIEW, which is not a hypothetical either:
 * `useLiveEvents.tsx` hands `applyVariables` the variables map off a
 * `theme.preview` frame, and the editor's BroadcastChannel message does
 * the same in `useTheme` itself. Those maps are arbitrary — another
 * build's dictionary, a partial draft, a role the registry never had —
 * and every re-apply of the active theme that follows goes through
 * `applyActive`. So the sequences here are: preview lands, then the
 * active theme is re-applied (the preview's own 10-minute auto-revert,
 * via the exported `reapplyActiveTheme`), or the user switches theme,
 * or the user goes back to a builtin.
 *
 * Everything is asserted against `document.documentElement.style` —
 * the actual inline set, enumerated, not a sample of keys chosen to
 * pass.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

import { themeQueryKey } from '../../api/themes';
import { useTheme, reapplyActiveTheme } from '../useTheme';
import { applyVariables } from '../themeRuntime';
import { migrateThemeVariables, type ThemeBase } from '../themeMigration';
import { ALL_TOKEN_KEYS } from '../themeTokens';
import { LEGACY_DEFAULTS, LEGACY_TOKEN_KEYS } from '../themeTokensLegacy';

const THEME_A = 'theme-a';
const THEME_B = 'theme-b';

/** Two colours nothing in either dictionary declares — so finding one is proof. */
const COLOUR_A = '#0f7b6c';
const COLOUR_B = '#7b0f6c';

/**
 * The keys a preview can leave behind: names only the pre-redesign
 * dictionary had, plus one that was never a role anywhere.
 *
 * Deliberately NOT a subset of the current registry — those would be
 * overwritten by the incoming theme anyway, so they could not tell a
 * stripped document from an unstripped one.
 */
const FOREIGN_KEY = '--sk-preview-only';
const PREVIEW_KEYS: readonly string[] = [
  ...LEGACY_TOKEN_KEYS.filter((key) => !ALL_TOKEN_KEYS.includes(key)).slice(0, 3),
  FOREIGN_KEY,
];
const PREVIEW_MAP: Record<string, string> = Object.fromEntries(
  PREVIEW_KEYS.map((key) => [key, '#abcdef']),
);

/**
 * A saved theme as it looks AFTER the redesign migration (T011/T012),
 * with one role carrying a colour that identifies it.
 *
 * The distinctive colour is written onto the MIGRATED map rather than
 * seeded as a pre-redesign role and carried across: which old role maps
 * onto which new one is `themeMigration`'s subject and is pinned there. What
 * this file needs from the fixture is only that the two themes are
 * complete and tell each other apart.
 */
function migratedVariables(base: ThemeBase, primary: string): Record<string, string> {
  return { ...migrateThemeVariables(LEGACY_DEFAULTS[base], base), '--primary': primary };
}

const THEME_VARIABLES: Record<string, Record<string, string>> = {
  [THEME_A]: migratedVariables('light', COLOUR_A),
  [THEME_B]: migratedVariables('light', COLOUR_B),
};

function themeRow(id: string) {
  return {
    id,
    name: id,
    base: 'light',
    variables: THEME_VARIABLES[id],
    createdBy: { id: 'u-owner', username: 'owner' },
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    updatedBy: { id: 'u-owner', username: 'owner' },
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * `/api/v1/me/theme` (GET + the optimistic PUT) and `/api/v1/themes/:id`
 * for both rows. No `<AuthProvider>`: with no identity the T013
 * write-back gate never opens, so nothing here can PATCH and the rows
 * stay what this file says they are.
 */
function stubServer(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/api/v1/me/theme')) {
        if ((init?.method ?? 'GET').toUpperCase() === 'PUT') {
          return new Response(init?.body as string, {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return json({ mode: 'custom', builtinTheme: 'light', customThemeId: THEME_A });
      }
      const match = /\/api\/v1\/themes\/([^/?]+)/.exec(url);
      if (match && THEME_VARIABLES[match[1]]) return json(themeRow(match[1]));
      throw new Error(`unexpected request: ${url}`);
    }),
  );
}

function wrapper(): {
  wrapper: ({ children }: { children: ReactNode }) => ReturnType<typeof createElement>;
  client: QueryClient;
} {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    client,
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children),
  };
}

/** Every custom property inline on `<html>` right now, by name. */
function inlineCustomProperties(): string[] {
  const style = document.documentElement.style;
  const names: string[] = [];
  for (let i = 0; i < style.length; i += 1) {
    const name = style.item(i);
    if (name.startsWith('--')) names.push(name);
  }
  return names.sort();
}

function applied(key: string): string {
  return document.documentElement.style.getPropertyValue(key).trim();
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('style');
  stubServer();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('style');
});

async function paintedCustom(colour: string): Promise<void> {
  await waitFor(() => {
    expect(document.documentElement.getAttribute('data-theme')).toBe('custom');
    expect(applied('--primary')).toBe(colour);
  });
}

describe('T014 — the fixtures are what the assertions assume', () => {
  test('a migrated theme is the WHOLE dictionary, so two of them share a key set', () => {
    // This is why row 21 needs a preview to be a real test: with both
    // maps covering every role, the second apply overwrites the first
    // key for key even with no strip at all. Pinned rather than
    // remembered — if the migration ever stops being total, the
    // switch-between-themes case becomes observable and this line says
    // so first.
    expect(Object.keys(THEME_VARIABLES[THEME_A]).sort()).toEqual([...ALL_TOKEN_KEYS].sort());
    expect(Object.keys(THEME_VARIABLES[THEME_B]).sort()).toEqual([...ALL_TOKEN_KEYS].sort());
    expect(THEME_VARIABLES[THEME_A]['--primary']).toBe(COLOUR_A);
    expect(THEME_VARIABLES[THEME_B]['--primary']).toBe(COLOUR_B);
  });

  test('the preview map is made of keys no applied theme can overwrite', () => {
    // Without this the "the preview is gone" assertions would be
    // satisfied by the incoming theme writing over the same names, and
    // would pass with the strip removed.
    expect(PREVIEW_KEYS.length).toBeGreaterThan(1);
    for (const key of PREVIEW_KEYS) expect(ALL_TOKEN_KEYS).not.toContain(key);
  });
});

describe('T014 / row 20 — after applying a theme, nothing outside it is inline', () => {
  test('the inline set is exactly the applied theme, preview leftovers included', async () => {
    const { result } = renderHook(() => useTheme(), wrapper());
    await paintedCustom(COLOUR_A);

    // A preview lands — this is `useLiveEvents`' `theme.preview`
    // handler, verbatim (it calls `applyVariables` with the frame's
    // map).
    act(() => {
      applyVariables(PREVIEW_MAP);
    });
    expect(inlineCustomProperties()).toEqual(
      [...ALL_TOKEN_KEYS, ...PREVIEW_KEYS].sort(),
    );

    // …and its 10-minute auto-revert re-applies the active theme
    // through the same `applyActive` every theme change uses.
    act(() => {
      reapplyActiveTheme();
    });

    expect(inlineCustomProperties()).toEqual([...ALL_TOKEN_KEYS].sort());
    for (const key of PREVIEW_KEYS) expect(applied(key)).toBe('');
    expect(applied('--primary')).toBe(COLOUR_A);
    expect(result.current.active.mode).toBe('custom');
  });
});

describe('T014 / row 21 — switching between two saved themes', () => {
  test('nothing of the first theme, or of a preview over it, survives the second', async () => {
    const harness = wrapper();
    const { result } = renderHook(() => useTheme(), harness);
    await paintedCustom(COLOUR_A);

    // B's row is seeded into the cache BEFORE the switch, and that is
    // load-bearing rather than an optimisation. With a cold cache the
    // hook spends a render with `customTheme === null` — the row is in
    // flight — and `applyActive` takes its BUILTIN branch for that
    // render, which strips. The switch would then come out clean no
    // matter what the custom branch does, and this test would pass with
    // the fix removed. Seeded, the second theme is there the moment the
    // preference flips, so the only code that touches the document is
    // the branch under test. (It is also the ordinary case: switching
    // back to a theme visited earlier in the session.)
    harness.client.setQueryData(themeQueryKey(THEME_B), themeRow(THEME_B));

    act(() => {
      applyVariables(PREVIEW_MAP);
    });
    expect(applied(FOREIGN_KEY)).toBe('#abcdef');

    act(() => {
      result.current.setCustomTheme(THEME_B);
    });
    await paintedCustom(COLOUR_B);

    // Every role of B, and nothing else at all.
    expect(inlineCustomProperties()).toEqual([...ALL_TOKEN_KEYS].sort());
    for (const key of PREVIEW_KEYS) expect(applied(key)).toBe('');
    // A's own values are gone as VALUES too, not merely as names.
    expect(applied('--primary')).not.toBe(COLOUR_A);
    for (const [key, value] of Object.entries(THEME_VARIABLES[THEME_B])) {
      expect(applied(key), `${key} is not B's value`).toBe(value.trim());
    }
  });
});

describe('T014 / row 22 — out to a builtin theme and back', () => {
  test('the builtin leg clears the whole dictionary, the return re-paints it', async () => {
    const { result } = renderHook(() => useTheme(), wrapper());
    await paintedCustom(COLOUR_A);
    act(() => {
      applyVariables(PREVIEW_MAP);
    });

    act(() => {
      result.current.setBuiltin('dark');
    });
    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    });

    // Nothing inline at all: the builtin themes are painted by the
    // cascade in `index.css`, so any leftover custom property here wins
    // over the stylesheet and paints the previous theme's value under a
    // builtin's name.
    expect(inlineCustomProperties()).toEqual([]);
    expect(document.documentElement.style.getPropertyValue('color-scheme')).toBe('');

    act(() => {
      result.current.setCustomTheme(THEME_B);
    });
    await paintedCustom(COLOUR_B);
    expect(inlineCustomProperties()).toEqual([...ALL_TOKEN_KEYS].sort());
    expect(document.documentElement.style.getPropertyValue('color-scheme')).toBe('light');
  });
});
