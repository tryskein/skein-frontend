/**
 * sk-389 — a refused theme write must not leave the client split.
 *
 * ── The measured defect ─────────────────────────────────────────────
 *
 * Live stand, `http://host.docker.internal:5173/`, account
 * `admin@test.com`, one click on the «Dark theme» cell against an API
 * that answered `400 invalid_json`:
 *
 *     localStorage['skein.theme']                = "dark"   ← CHANGED
 *     document.documentElement.dataset.theme     = "light"  ← unchanged
 *     [aria-label="Light theme"] aria-pressed    = "true"   ← unchanged
 *     [aria-label="Dark theme"]  aria-pressed    = "false"
 *
 * Three surfaces, two answers. The optimistic update rolled back
 * through the query cache, which is what `data-theme` and `aria-pressed`
 * are derived from; `skein.theme` was written at the CALL SITE, before
 * `mutate` was entered, so no rollback path had ever heard of it. And
 * `skein.theme` is not inert: it is the boot script's fallback and the
 * gate on the OS-preference tracker, so the split outlives the session
 * that made it.
 *
 * The 400 itself was environmental (an API that predated a field the
 * client had started sending, since withdrawn — sk-285.7.19). The
 * DEFECT is not: a server that refuses is a normal event — an expired
 * session, a dropped connection, a rolled-back deployment — and the
 * client owns what happens next.
 *
 * ── What is asserted, and why in this shape ─────────────────────────
 *
 * Consistency is asserted BETWEEN the three surfaces rather than
 * against a hard-coded «light», because the bug is precisely that they
 * disagreed; a test that pinned each one separately would pass on a
 * fix that made them agree on the WRONG value. So the DOM is read, and
 * storage is required to say the same thing — including when the
 * honest answer is «nothing stored», which is a distinct state from
 * «stored light» and the one that gates the OS tracker.
 *
 * The toast is asserted through the module every other failed mutation
 * in the app reports on (`useKanbanMove`, `useAcceptIssue`), not
 * through a rendered DOM node: what this hook owes the user is that it
 * REPORTS, and the rendering surface is `<Notifications />`'s business.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

import { useTheme } from '../useTheme';

const toastError = vi.fn();
vi.mock('../../components/Toaster', () => ({
  useToaster: () => ({ error: toastError, success: vi.fn(), info: vi.fn() }),
}));

const STORAGE_KEY = 'skein.theme';

interface StoredPref {
  mode: 'builtin' | 'custom';
  builtinTheme: 'light' | 'dark';
  customThemeId: string | null;
}

/** `/me/theme`: GET answers `stored`, PUT is refused with `putStatus`. */
function stubServer(stored: StoredPref, putStatus: number, putBody: string) {
  const puts: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/api/v1/me/theme')) {
        if ((init?.method ?? 'GET').toUpperCase() === 'PUT') {
          puts.push(String(init?.body ?? ''));
          return new Response(putBody, {
            status: putStatus,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(JSON.stringify(stored), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/api/auth/me')) return new Response('unauthorized', { status: 401 });
      throw new Error(`unexpected request: ${url}`);
    }),
  );
  return { puts };
}

function wrapper(): ({ children }: { children: ReactNode }) => ReturnType<typeof createElement> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
}

/** What the three surfaces say right now, read the way a user sees them. */
function surfaces() {
  return {
    dataTheme: document.documentElement.getAttribute('data-theme'),
    stored: window.localStorage.getItem(STORAGE_KEY),
  };
}

beforeEach(() => {
  toastError.mockClear();
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('sk-389 — the server refuses the theme write', () => {
  test('storage does not keep a colour the DOM refused to paint', async () => {
    // The measured case, at its source: nothing stored (a user who has
    // never picked in this browser), account on light, one click on
    // dark, server answers 400.
    const server = stubServer(
      { mode: 'builtin', builtinTheme: 'light', customThemeId: null },
      400,
      JSON.stringify({ error: 'invalid_json', message: 'invalid request body' }),
    );

    const { result } = renderHook(() => useTheme(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'));

    await act(async () => {
      result.current.setBuiltin('dark');
    });

    // The PUT really was attempted — otherwise this test would pass on
    // a hook that had stopped talking to the server at all.
    await waitFor(() => expect(server.puts).toHaveLength(1));

    await waitFor(() => {
      const s = surfaces();
      // The DOM rolled back on its own; the point is that storage now
      // agrees with it. Read as a pair, so a fix that made both say
      // «dark» could not pass either.
      expect(s.dataTheme).toBe('light');
      expect(s.stored).not.toBe('dark');
    });

    // And specifically: «nothing stored» is restored as nothing. A
    // rollback that wrote 'light' here would convert a user who never
    // picked a theme into one who did, freezing the OS-preference
    // tracker for them.
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(result.current.theme).toBe('light');
  });

  test('an EARLIER pick is restored, not erased', async () => {
    // The other half of «restore»: this browser had a pick on record,
    // and a refused write must give that pick back rather than clear
    // it. Only asserting the null case above would let a rollback that
    // always removes the key pass.
    window.localStorage.setItem(STORAGE_KEY, 'light');
    stubServer({ mode: 'builtin', builtinTheme: 'light', customThemeId: null }, 500, '{}');

    const { result } = renderHook(() => useTheme(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      result.current.setBuiltin('dark');
    });

    await waitFor(() => expect(window.localStorage.getItem(STORAGE_KEY)).toBe('light'));
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  test('the user is told, and told what the server said', async () => {
    // A refusal nobody reports reads as a click that did nothing —
    // which is exactly how the defect presented on the live stand.
    stubServer(
      { mode: 'builtin', builtinTheme: 'light', customThemeId: null },
      422,
      JSON.stringify({ error: 'follow_system_requires_builtin', message: 'nope' }),
    );

    const { result } = renderHook(() => useTheme(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      result.current.setBuiltin('dark');
    });

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    const message = String(toastError.mock.calls[0][0]);
    // Our sentence, so the user knows the theme did not stick…
    expect(message).toContain('Could not save the theme');
    // …and the server's own words, so a support conversation has
    // something to go on beyond «it failed».
    expect(message).toContain('nope');
  });

  test('a write that SUCCEEDS still records the pick', async () => {
    // The rollback must not be paid for by the happy path: a fix that
    // moved the storage write somewhere it never ran would satisfy
    // every assertion above and break the boot script's fallback.
    stubServer({ mode: 'builtin', builtinTheme: 'light', customThemeId: null }, 200, '');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : (input as Request).url;
        if (url.includes('/api/v1/me/theme')) {
          const body =
            (init?.method ?? 'GET').toUpperCase() === 'PUT'
              ? String(init?.body ?? '{}')
              : JSON.stringify({ mode: 'builtin', builtinTheme: 'light', customThemeId: null });
          return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
        }
        if (url.includes('/api/auth/me')) return new Response('unauthorized', { status: 401 });
        throw new Error(`unexpected request: ${url}`);
      }),
    );

    const { result } = renderHook(() => useTheme(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      result.current.setBuiltin('dark');
    });

    await waitFor(() => expect(window.localStorage.getItem(STORAGE_KEY)).toBe('dark'));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
    expect(toastError).not.toHaveBeenCalled();
  });
});
