/**
 * sk-285.7.5 — what the second writer did to the first one's key.
 *
 * ── The chain, and which half lives here ────────────────────────────
 *
 * Two mechanisms write a saved theme's variables map, with different
 * semantics. `skein_theme(action="set_variables")` on the MCP side MERGES
 * a partial map into the row. The one-time migration write-back in
 * `useTheme` REPLACES the map wholesale with `migrateThemeVariables`'s
 * output. Separately each is correct; together they made an agent's write
 * disappear:
 *
 *   1. the agent merges a pre-redesign role name into the row;
 *   2. the row now holds a name only the OLD dictionary had, so
 *      `needsMigration` is true again — the flag is about the SHAPE of
 *      the row, so one such key re-arms it however migrated the rest is;
 *   3. the owner opens a page, the write-back fires, and the map is
 *      replaced by one built from the CURRENT dictionary — where that key
 *      does not exist.
 *
 * The key is gone, it painted nothing while it was there, and nothing
 * anywhere reported a problem. The fix is in skein-api: the MCP boundary
 * now refuses such a patch outright (`unknown_theme_role`), so step 1 is
 * impossible and the row never reaches step 2. That refusal — and the
 * fact that the row stays free of dead names — is pinned there, in
 * `theme_tools_test.go`.
 *
 * This file pins the half that only exists in the frontend: WHY the
 * refusal is the right answer rather than an over-reaction. It shows the
 * loss actually happening on the mechanism as it stands, which is the
 * claim the backend test cannot make and the one a reader is entitled to
 * see demonstrated rather than asserted.
 *
 * ── Why `--bg-hover` in particular ──────────────────────────────────
 *
 * Because it is the worst case, and the reason is not obvious. Most
 * retired names have a successor, so one could imagine the value merely
 * "moving". It does not, and for a reason that only bites on the row an
 * agent actually writes to: a MIGRATED row already carries `--elev`, and
 * route 1 of the migration (the role's own name, when the input already
 * speaks the new dictionary) answers before the legacy sources are ever
 * consulted. So `--elev` keeps its own value and `--bg-hover` is dropped
 * with nothing carried over. The value is not relocated — it is deleted.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

import { useTheme, __resetMigrationWriteback } from '../useTheme';
import { needsMigration } from '../themeMigration';
import { defaultVariablesForBase } from '../themeTokens';
import { AuthProvider } from '../../auth/AuthContext';

const THEME_ID = 'theme-written-by-two';
const OWNER = { id: 'u-owner', username: 'owner' };

/** The value an agent would have sent for the retired role. */
const AGENT_VALUE = 'rgba(0, 90, 255, 0.08)';
/** A colour the user chose, so the row is not merely the defaults. */
const USER_PRIMARY = '#0f7b6c';

/** A row the migration has nothing left to do to. */
function migratedRow(): Record<string, string> {
  return { ...defaultVariablesForBase('light'), '--primary': USER_PRIMARY };
}

/** …and the same row after an MCP `set_variables` merged a dead name in. */
function rowAfterAgentWrite(): Record<string, string> {
  return { ...migratedRow(), '--bg-hover': AGENT_VALUE };
}

function themeRow(variables: Record<string, string>) {
  return {
    id: THEME_ID,
    name: 'Two writers',
    base: 'light',
    variables,
    createdBy: OWNER,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    updatedBy: OWNER,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** `/api/auth/me`, `/api/v1/me/theme`, `/api/v1/themes/:id`. */
function stubServer(variables: Record<string, string>): {
  patches: Array<Record<string, unknown>>;
} {
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
      return json({ mode: 'custom', builtinTheme: 'light', customThemeId: THEME_ID });
    }
    if (url.includes('/api/v1/themes/')) {
      if ((init?.method ?? 'GET').toUpperCase() === 'PATCH') {
        patches.push(JSON.parse(String(init?.body ?? '{}')));
        return json(themeRow(variables));
      }
      return json(themeRow(variables));
    }
    throw new Error(`unexpected request: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { patches };
}

function authedWrapper() {
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

const applied = (key: string) =>
  document.documentElement.style.getPropertyValue(key).trim();

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

describe('sk-285.7.5 — an agent key in a migrated row is lost, silently', () => {
  test('the key re-arms needsMigration on a row that was already clean', () => {
    // Step 2 of the chain, isolated. This is the whole reason a merge of
    // one dead name is not the harmless no-op it looks like: the flag
    // reads the SHAPE of the map, so a single legacy-only name flips a
    // fully migrated row back to "stale".
    expect(needsMigration(migratedRow())).toBe(false);
    expect(needsMigration(rowAfterAgentWrite())).toBe(true);
  });

  test('the owner opening a page deletes it — and does not move it to --elev', async () => {
    const server = stubServer(rowAfterAgentWrite());
    renderHook(() => useTheme(), authedWrapper());
    await paint();
    await waitFor(() => expect(server.patches.length).toBe(1));

    const written = (server.patches[0] as { variables: Record<string, string> }).variables;

    // The key is gone from the row the server will now hold.
    expect(written).not.toHaveProperty('--bg-hover');

    // And the value went nowhere. `--elev` is the retired role's declared
    // successor, but the row already carried `--elev` under its own name,
    // so route 1 of the migration answers first and the agent's value is
    // not carried anywhere at all.
    expect(written['--elev']).toBe(migratedRow()['--elev']);
    expect(Object.values(written)).not.toContain(AGENT_VALUE);

    // The user's own setting is untouched — the loss is specific to the
    // dead name, which is what makes it easy to miss.
    expect(written['--primary']).toBe(USER_PRIMARY);

    // It never painted either, so there was no moment at which anyone
    // could have seen it work.
    expect(applied('--bg-hover')).toBe('');
    expect(applied('--elev')).toBe(migratedRow()['--elev']);
  });

  test('without that key the same row is not rewritten at all', async () => {
    // The pair. Without it the test above passes on a build that rewrites
    // every row on every load, where "the key disappeared" would say
    // nothing about the key.
    const server = stubServer(migratedRow());
    renderHook(() => useTheme(), authedWrapper());
    await paint();
    // Give the effect the same room the positive case needed before
    // concluding that nothing was sent.
    await waitFor(() => expect(applied('--primary')).toBe(USER_PRIMARY));
    expect(server.patches).toEqual([]);
  });
});
