/**
 * sk-285.7.2.48 — logging out drops the boot-readable theme record.
 *
 * The record (`skein.theme.boot`) exists so the FIRST FRAME can be
 * painted from the server's preference instead of from the OS. That
 * makes it the one piece of a session's state that lives outside the
 * query cache and survives a reload — so a logout that clears the cache
 * and leaves the record behind hands the next person at this browser the
 * previous user's theme on the login screen, asserting a preference we
 * no longer know.
 *
 * `skein.theme` is deliberately NOT part of that: it means «the human at
 * this browser picked this», which signing out does not retract, and it
 * is what the login screen is supposed to honour.
 *
 * Asserted through the real `logout()` — the mutation, its `onSettled`
 * and the query-cache reset — rather than by calling
 * `clearThemeBootCache` directly, which would only prove the module
 * exports a working function.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

import { AuthProvider, useAuth } from '../AuthContext';
import {
  THEME_BOOT_CACHE_KEY,
  THEME_BOOT_CACHE_VERSION,
  readThemeBootCache,
  writeThemeBootCache,
} from '../../lib/themeBootCache';
import { readDensityBootCache, writeDensityBootCache } from '../../lib/densityBootCache';

const LEGACY_KEY = 'skein.theme';

function stubServer(logoutBody: unknown = { redirectTo: null }): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/api/auth/logout')) {
        return new Response(JSON.stringify(logoutBody), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/api/auth/me')) {
        return new Response(
          JSON.stringify({
            id: 'u-1',
            email: 'admin@test.com',
            username: 'admin',
            name: 'admin',
            role: 'admin',
            createdAt: null,
            lastLoginAt: null,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      throw new Error(`unexpected request: ${url}`);
    }),
  );
}

function wrapper(): ({ children }: { children: ReactNode }) => ReturnType<typeof createElement> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) =>
    createElement(
      QueryClientProvider,
      { client },
      createElement(AuthProvider, null, children as never),
    );
}

beforeEach(() => {
  window.localStorage.clear();
  writeThemeBootCache({
    v: THEME_BOOT_CACHE_VERSION,
    mode: 'builtin',
    builtin: 'dark',
  });
  window.localStorage.setItem(LEGACY_KEY, 'dark');
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('logout and the first frame of the NEXT load', () => {
  test('the boot record is gone once logout settles', async () => {
    stubServer();
    const { result } = renderHook(() => useAuth(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.user).not.toBeNull());
    expect(readThemeBootCache()).not.toBeNull();

    await act(async () => {
      await result.current.logout();
    });

    expect(window.localStorage.getItem(THEME_BOOT_CACHE_KEY)).toBeNull();
    expect(readThemeBootCache()).toBeNull();
  });

  // sk-551.7 — the density's boot record goes with it: left behind, the
  // login screen and the next person's first frame would be painted in
  // the previous person's density (brief sk-551.7: "do not show another
  // person's density after a user switch").
  test('the density boot record is gone once logout settles', async () => {
    writeDensityBootCache('u-1', 'compact');
    stubServer();
    const { result } = renderHook(() => useAuth(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.user).not.toBeNull());
    expect(readDensityBootCache()).not.toBeNull();

    await act(async () => {
      await result.current.logout();
    });

    expect(readDensityBootCache()).toBeNull();
  });

  test('the human’s own pick is left alone', async () => {
    stubServer();
    const { result } = renderHook(() => useAuth(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.user).not.toBeNull());

    await act(async () => {
      await result.current.logout();
    });

    // `skein.theme` is what the login screen paints from. Clearing it
    // here would make signing out ALSO forget the theme this browser's
    // human chose, which nobody asked for.
    expect(window.localStorage.getItem(LEGACY_KEY)).toBe('dark');
  });

  test('a logout that fails server-side still clears it', async () => {
    // `onSettled`, not `onSuccess`: the local session is being torn down
    // either way (that is why the cache reset already sits there), and a
    // record left behind by the failure path would be the same stale
    // first frame.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo) => {
        const url = typeof input === 'string' ? input : (input as Request).url;
        if (url.includes('/api/auth/logout')) return new Response(null, { status: 500 });
        return new Response(
          JSON.stringify({
            id: 'u-1',
            email: 'admin@test.com',
            username: 'admin',
            name: 'admin',
            role: 'admin',
            createdAt: null,
            lastLoginAt: null,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }),
    );

    const { result } = renderHook(() => useAuth(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.user).not.toBeNull());

    await act(async () => {
      await result.current.logout().catch(() => {
        /* the mutation rejects; the teardown still has to have happened */
      });
    });

    await waitFor(() => expect(readThemeBootCache()).toBeNull());
  });
});
