/**
 * sk-285.7 T013 — the migrated snapshot is written back ONCE.
 *
 * T012 put the migration on the read path, so the screen is already
 * correct whether or not the row is ever rewritten. What is at stake
 * here is different in kind: this is the first task of the redesign that
 * WRITES to a user's data. The three claims the coverage matrix names
 * (rows 17–19) are therefore each about a way that write can go wrong
 * rather than about what it produces:
 *
 *   17. it happens ONCE per theme — a hook mounted three times over in a
 *       live shell must not PATCH three times, and neither must a
 *       remount;
 *   18. it is done by the theme's OWNER — nobody rewrites a theme that
 *       is not theirs;
 *   19. a REFUSED write changes nothing on screen — the read path stays
 *       authoritative, so a 500 costs the user a stale row and not a
 *       repainted UI.
 *
 * Everything is asserted against what actually left through `fetch` and
 * what actually landed on `document.documentElement.style`. A test that
 * read the hook's own report of itself would pass on a hook that reports
 * confidently and does nothing.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

import { useTheme, __resetMigrationWriteback } from '../useTheme';
import { migrateThemeVariables, needsMigration, type ThemeBase } from '../themeMigration';
import { ALL_TOKEN_KEYS } from '../themeTokens';
import { LEGACY_DEFAULTS } from '../themeTokensLegacy';
import { AuthProvider } from '../../auth/AuthContext';

const THEME_ID = 'theme-under-test';
const OWNER = { id: 'u-owner', username: 'owner' };
const SOMEONE_ELSE = { id: 'u-other', username: 'other' };

/** A colour nothing in either dictionary declares — so finding it is proof. */
const USER_BRAND = '#0f7b6c';

function savedVariables(base: ThemeBase): Record<string, string> {
  return { ...LEGACY_DEFAULTS[base], '--brand': USER_BRAND };
}

function themeRow(base: ThemeBase, variables: Record<string, string>, createdBy = OWNER) {
  return {
    id: THEME_ID,
    name: 'Migrated under test',
    base,
    variables,
    createdBy,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    updatedBy: createdBy,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

interface Server {
  fetchMock: ReturnType<typeof vi.fn>;
  /** Every PATCH the tab sent to /api/v1/themes/:id, oldest first. */
  patches: Array<Record<string, unknown>>;
}

/**
 * `/api/auth/me`, `/api/v1/me/theme` and `/api/v1/themes/:id`.
 *
 * `signedInAs = null` means no session, which is also what an unmounted
 * `<AuthProvider>` amounts to from the hook's point of view.
 */
function stubServer(options: {
  row: () => Response;
  signedInAs?: { id: string; username: string } | null;
  patchResponse?: () => Response;
}): Server {
  const patches: Array<Record<string, unknown>> = [];
  const who = options.signedInAs === undefined ? OWNER : options.signedInAs;
  const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    if (url.includes('/api/auth/me')) {
      if (!who) return new Response('unauthorized', { status: 401 });
      return json({
        ...who,
        email: `${who.username}@example.test`,
        name: who.username,
        role: 'user',
        createdAt: null,
        lastLoginAt: null,
      });
    }
    if (url.includes('/api/v1/me/theme')) {
      return json({ mode: 'custom', builtinTheme: 'light', customThemeId: THEME_ID });
    }
    if (url.includes('/api/v1/themes/')) {
      if ((init?.method ?? 'GET').toUpperCase() === 'PATCH') {
        patches.push(JSON.parse(String(init?.body ?? '{}')));
        return (options.patchResponse ?? (() => json(themeRow('light', {}))))();
      }
      return options.row();
    }
    throw new Error(`unexpected request: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, patches };
}

/** A wrapper WITH an auth provider — the shape the real app mounts. */
function authedWrapper(): {
  wrapper: ({ children }: { children: ReactNode }) => ReturnType<typeof createElement>;
} {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(
        QueryClientProvider,
        { client },
        createElement(AuthProvider, null, children as never),
      ),
  };
}

/** …and one WITHOUT, which is how most of this suite mounts the hook. */
function bareWrapper(): {
  wrapper: ({ children }: { children: ReactNode }) => ReturnType<typeof createElement>;
} {
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

/** The whole painted map, for comparing a before against an after. */
function paintedMap(): Record<string, string> {
  return Object.fromEntries(ALL_TOKEN_KEYS.map((k) => [k, applied(k)]));
}

async function paint(): Promise<void> {
  await waitFor(() => {
    expect(document.documentElement.getAttribute('data-theme')).toBe('custom');
  });
}

beforeEach(() => {
  __resetMigrationWriteback();
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('style');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  __resetMigrationWriteback();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('style');
});

describe('T013 — the fixture is a row that genuinely needs migrating', () => {
  test('the saved snapshot is stale and the migrated one is not', () => {
    // Every claim below is "one write happened" or "none did"; both are
    // vacuous if the row did not need one in the first place.
    expect(needsMigration(savedVariables('light'))).toBe(true);
    expect(needsMigration(migrateThemeVariables(savedVariables('light'), 'light'))).toBe(false);
    // …and the write would actually change something.
    expect(migrateThemeVariables(savedVariables('light'), 'light')).not.toEqual(
      savedVariables('light'),
    );
  });
});

describe('T013 / row 17 — the write happens once per theme', () => {
  test('one mount sends exactly one PATCH, carrying the whole migrated map', async () => {
    const server = stubServer({ row: () => json(themeRow('light', savedVariables('light'))) });
    renderHook(() => useTheme(), authedWrapper());
    await paint();
    await waitFor(() => expect(server.patches.length).toBe(1));

    // The payload is the migration's output, whole — not a diff. An
    // interrupted partial write is the state the spec forbids
    // ("an interruption does not leave the theme in a half-translated state"),
    // and one request replacing `variables` outright is what rules it
    // out.
    expect(server.patches[0]).toEqual({
      variables: migrateThemeVariables(savedVariables('light'), 'light'),
    });
    expect(Object.keys(server.patches[0].variables as object).sort()).toEqual(
      [...ALL_TOKEN_KEYS].sort(),
    );
  });

  test('re-rendering does not send a second one', async () => {
    const server = stubServer({ row: () => json(themeRow('light', savedVariables('light'))) });
    const { rerender } = renderHook(() => useTheme(), authedWrapper());
    await paint();
    await waitFor(() => expect(server.patches.length).toBe(1));
    rerender();
    rerender();
    rerender();
    await Promise.resolve();
    expect(server.patches.length).toBe(1);
  });

  test('THREE simultaneous mounts send one PATCH between them', async () => {
    // The live shell mounts `useTheme` in ThemeSync, in ThemeToggle and
    // in the Activity dashboard, all against the same row. A per-hook
    // guard would send three. This is the case the module-scoped claim
    // exists for, and it is claimed BEFORE the request goes out so the
    // second and third mounts see it mid-flight rather than after.
    const server = stubServer({ row: () => json(themeRow('light', savedVariables('light'))) });
    const { wrapper } = authedWrapper();
    renderHook(
      () => {
        useTheme();
        useTheme();
        useTheme();
      },
      { wrapper },
    );
    await paint();
    await waitFor(() => expect(server.patches.length).toBe(1));
    expect(server.patches.length).toBe(1);
  });

  test('a remount does not send another', async () => {
    const server = stubServer({ row: () => json(themeRow('light', savedVariables('light'))) });
    const first = renderHook(() => useTheme(), authedWrapper());
    await paint();
    await waitFor(() => expect(server.patches.length).toBe(1));
    first.unmount();

    // A fresh QueryClient too, i.e. nothing carried over but the module
    // scope — which is exactly what survives a remount in the app.
    renderHook(() => useTheme(), authedWrapper());
    await paint();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(server.patches.length).toBe(1);
  });

  test('an ALREADY-migrated row is not written at all (idempotence)', async () => {
    // The state this task leaves behind. Migrating it again is a no-op,
    // so writing it again would be pure noise in the DB and in the live
    // event feed. The gate is `needsMigration` on the saved row, which
    // the migration's own output can never satisfy.
    const migrated = migrateThemeVariables(savedVariables('light'), 'light');
    const server = stubServer({ row: () => json(themeRow('light', migrated)) });
    renderHook(() => useTheme(), authedWrapper());
    await paint();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(server.patches).toEqual([]);
    // …and the user's colour is still on screen, so "no write" is not
    // "no theme".
    expect(applied('--primary')).toBe(USER_BRAND);
  });

  test('the payload two tabs would send is byte-identical', () => {
    // The module scope is per tab, so two tabs open at once can each
    // send the PATCH. That is safe because the payload is a pure
    // function of the row they both fetched — whichever lands second
    // writes the same bytes, so no ordering leaves the theme half
    // translated.
    const a = migrateThemeVariables(savedVariables('light'), 'light');
    const b = migrateThemeVariables(savedVariables('light'), 'light');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('T013 / row 18 — only the owner writes', () => {
  test('a theme created by someone else is NOT written back', async () => {
    const server = stubServer({
      row: () => json(themeRow('light', savedVariables('light'), SOMEONE_ELSE)),
      signedInAs: OWNER,
    });
    renderHook(() => useTheme(), authedWrapper());
    await paint();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(server.patches).toEqual([]);
    // …but it is still painted in the new language: reading someone
    // else's theme is fine, rewriting it is not.
    expect(applied('--primary')).toBe(USER_BRAND);
    expect(ALL_TOKEN_KEYS.filter((k) => applied(k) === '')).toEqual([]);
  });

  test('the same row IS written when the signed-in user is its creator', async () => {
    // The other half of the pair — without it "no PATCH" above could be
    // "this harness never PATCHes".
    const server = stubServer({
      row: () => json(themeRow('light', savedVariables('light'), SOMEONE_ELSE)),
      signedInAs: SOMEONE_ELSE,
    });
    renderHook(() => useTheme(), authedWrapper());
    await paint();
    await waitFor(() => expect(server.patches.length).toBe(1));
  });

  test('an unauthenticated tab writes nothing', async () => {
    const server = stubServer({
      row: () => json(themeRow('light', savedVariables('light'))),
      signedInAs: null,
    });
    renderHook(() => useTheme(), authedWrapper());
    await paint();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(server.patches).toEqual([]);
  });

  test('a hook mounted outside <AuthProvider> writes nothing', async () => {
    // There is no identity to compare against, so the safe answer — do
    // not rewrite somebody's theme — is the one that falls out.
    const server = stubServer({ row: () => json(themeRow('light', savedVariables('light'))) });
    renderHook(() => useTheme(), bareWrapper());
    await paint();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(server.patches).toEqual([]);
    expect(applied('--primary')).toBe(USER_BRAND);
  });
});

describe('T013 / row 19 — a refused write does not touch the screen', () => {
  test.each([
    ['500', () => new Response('boom', { status: 500 })],
    ['403', () => new Response('nope', { status: 403 })],
    ['422', () => json({ message: 'business', code: 'nope' }, 422)],
    ['a malformed body', () => new Response('<html>', { status: 200 })],
  ])('the theme survives a %s from PATCH', async (_name, patchResponse) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const server = stubServer({
      row: () => json(themeRow('light', savedVariables('light'))),
      patchResponse,
    });
    renderHook(() => useTheme(), authedWrapper());
    await paint();
    await waitFor(() => expect(server.patches.length).toBe(1));
    // Let the rejection settle — the point is that settling changes
    // nothing, and a test that never waited could not tell.
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(paintedMap()).toEqual(
      migrateThemeVariables(savedVariables('light'), 'light'),
    );
    expect(applied('--primary')).toBe(USER_BRAND);
    expect(document.documentElement.getAttribute('data-theme')).toBe('custom');
    // The failure is recorded rather than swallowed silently.
    expect(warn).toHaveBeenCalled();
  });

  test('a network failure is the same non-event', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubServer({ row: () => json(themeRow('light', savedVariables('light'))) });
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const inner = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/api/v1/themes/') && (init?.method ?? 'GET').toUpperCase() === 'PATCH') {
        throw new TypeError('Failed to fetch');
      }
      return inner(input, init);
    });

    renderHook(() => useTheme(), authedWrapper());
    await paint();
    const before = paintedMap();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(paintedMap()).toEqual(before);
    expect(paintedMap()).toEqual(migrateThemeVariables(savedVariables('light'), 'light'));
    expect(warn).toHaveBeenCalled();
  });

  test('a failed write is not retried for the life of the page', async () => {
    // Deliberate, and the cheaper of the two mistakes: this effect
    // re-runs on every resolved row, so retrying would loop against a
    // server that is already refusing. The next page load starts from a
    // clean module scope and tries again.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const server = stubServer({
      row: () => json(themeRow('light', savedVariables('light'))),
      patchResponse: () => new Response('boom', { status: 500 }),
    });
    const first = renderHook(() => useTheme(), authedWrapper());
    await paint();
    await waitFor(() => expect(server.patches.length).toBe(1));
    first.unmount();

    renderHook(() => useTheme(), authedWrapper());
    await paint();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(server.patches.length).toBe(1);

    // …and a fresh page load (module scope reset) does try again.
    __resetMigrationWriteback();
    renderHook(() => useTheme(), authedWrapper());
    await paint();
    await waitFor(() => expect(server.patches.length).toBe(2));
  });
});

describe('T013 — negative paths that must not produce a write', () => {
  test('a theme that never loads is not written back', async () => {
    // Nothing to migrate, so nothing to store. The user is on a builtin
    // theme (T012's failure edge) and the row on the server is left
    // exactly as it is rather than overwritten from a guess.
    const server = stubServer({ row: () => new Response('boom', { status: 500 }) });
    renderHook(() => useTheme(), authedWrapper());
    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(server.patches).toEqual([]);
  });

  test('a builtin-mode user sends nothing at all', async () => {
    const patches: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/api/auth/me')) {
        return json({
          ...OWNER,
          email: 'owner@example.test',
          name: 'owner',
          role: 'user',
          createdAt: null,
          lastLoginAt: null,
        });
      }
      if (url.includes('/api/v1/me/theme')) {
        return json({ mode: 'builtin', builtinTheme: 'dark', customThemeId: null });
      }
      if (url.includes('/api/v1/themes/')) {
        if ((init?.method ?? 'GET').toUpperCase() === 'PATCH') {
          patches.push(JSON.parse(String(init?.body ?? '{}')));
        }
        throw new Error('the builtin path must not touch /themes/');
      }
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderHook(() => useTheme(), authedWrapper());
    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(patches).toEqual([]);
  });

  test('an EMPTY snapshot is still a stale row, and IS written back', async () => {
    // `{}` lacks every role of the new dictionary, so `needsMigration`
    // says yes and the row is filled from the theme's own base (INV-9).
    // The opposite answer would leave a permanently empty row that the
    // read path has to reconstruct on every load, forever.
    const server = stubServer({ row: () => json(themeRow('dark', {})) });
    renderHook(() => useTheme(), authedWrapper());
    await paint();
    await waitFor(() => expect(server.patches.length).toBe(1));
    expect(server.patches[0]).toEqual({ variables: migrateThemeVariables({}, 'dark') });
  });
});
