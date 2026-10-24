/**
 * sk-285.7.2.48 — what fills the window between the first frame and the
 * server's answer.
 *
 * The boot script paints from the record on disk; React mounts a moment
 * later and, before `/me/theme` lands, has to paint from SOMETHING. That
 * something used to be `bootstrapPref()` — a guess from the OS — and the
 * measured result was that the flash moved rather than went: 28.8ms dark
 * from the script, then 351.0ms LIGHT from React, then 368.1ms dark,
 * with first-contentful-paint at 364.0ms landing in the wrong theme.
 *
 * So two claims are asserted here, and each has a way of being false
 * that a happy-path test would not notice:
 *
 *   - the in-flight window is filled from the RECORD, not the guess, and
 *     the record is not destroyed by a load that never finishes;
 *   - the record is written on every SETTLED server answer, including
 *     one that merely confirms the guess — the case where the resolved
 *     theme is referentially unchanged and an effect keyed on it alone
 *     would skip the write, leaving exactly one class of user still
 *     mispainted.
 *
 * Everything is asserted against what landed on `document.documentElement`
 * and what came back out of `readThemeBootCache`, never against the
 * hook's own report of itself.
 *
 * The OS preference is a stub here because the suite's own `matchMedia`
 * (`src/test/viewport.ts`) answers width queries and refuses
 * `prefers-color-scheme` by design.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

import { useTheme } from '../useTheme';
import { readThemeBootCache, writeThemeBootCache } from '../themeBootCache';

interface OSPreference {
  /** Flip the system theme the way a desktop does: value, then event. */
  set: (next: 'light' | 'dark') => void;
}

function installOSPreference(initial: 'light' | 'dark'): OSPreference {
  let current = initial;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();

  window.matchMedia = ((query: string) => {
    const isColorScheme = query.includes('prefers-color-scheme: dark');
    return {
      get matches(): boolean {
        return isColorScheme && current === 'dark';
      },
      media: query,
      onchange: null,
      addEventListener: (type: string, handler: (event: MediaQueryListEvent) => void) => {
        if (isColorScheme && type === 'change') listeners.add(handler);
      },
      removeEventListener: (_type: string, handler: (event: MediaQueryListEvent) => void) => {
        listeners.delete(handler);
      },
      addListener: (handler: (event: MediaQueryListEvent) => void) => {
        if (isColorScheme) listeners.add(handler);
      },
      removeListener: (handler: (event: MediaQueryListEvent) => void) => {
        listeners.delete(handler);
      },
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;

  return {
    set(next) {
      current = next;
      const event = { matches: next === 'dark' } as MediaQueryListEvent;
      for (const listener of [...listeners]) listener(event);
    },
  };
}

interface StoredPref {
  mode: 'builtin' | 'custom';
  builtinTheme: 'light' | 'dark';
  customThemeId: string | null;
}

interface Server {
  /** Every body PUT to /api/v1/me/theme, oldest first. */
  puts: StoredPref[];
}

/**
 * `/api/v1/me/theme`, GET and PUT, with the PUT echoed back the way the
 * real endpoint answers — so the query cache ends up holding exactly
 * what was stored and a write-back loop, if one existed, would show up
 * as a second PUT rather than as silence.
 */
function stubServer(stored: StoredPref, delayMs = 0): Server {
  const puts: StoredPref[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    if (url.includes('/api/v1/me/theme')) {
      if (delayMs > 0 && (init?.method ?? 'GET').toUpperCase() === 'GET') {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      if ((init?.method ?? 'GET').toUpperCase() === 'PUT') {
        const body = JSON.parse(String(init?.body ?? '{}')) as StoredPref;
        puts.push(body);
        return new Response(JSON.stringify(body), {
          status: 200,
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
  });
  vi.stubGlobal('fetch', fetchMock);
  return { puts };
}

function wrapper(): ({ children }: { children: ReactNode }) => ReturnType<typeof createElement> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
}

let savedMatchMedia: typeof window.matchMedia | undefined;

beforeEach(() => {
  savedMatchMedia = window.matchMedia;
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  if (savedMatchMedia) window.matchMedia = savedMatchMedia;
});

describe('the in-flight window does not contradict the first frame', () => {
  test('React does not repaint from the OS guess while /me/theme is in flight', async () => {
    // MEASURED regression, on the signed-in shell. With the boot cache
    // in place but React still mounting on `bootstrapPref()`, a live
    // load of an account on dark under a light OS painted: 28.8ms dark
    // (boot script) → 351.0ms LIGHT (React's guess) → 368.1ms dark,
    // with first-contentful-paint at 364.0ms landing in the wrong
    // theme. The flash had moved, not gone; on a cold server it lasts
    // as long as the request does.
    installOSPreference('light');
    writeThemeBootCache({ v: 1, mode: 'builtin', builtin: 'dark' });
    const server = stubServer(
      { mode: 'builtin', builtinTheme: 'dark', customThemeId: null },
      200,
    );

    const { result } = renderHook(() => useTheme(), { wrapper: wrapper() });

    // Synchronously after mount — effects have run, the response has
    // not landed. This is the frame the browser shows during the whole
    // request.
    expect(document.documentElement.dataset.theme).toBe('dark');

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(server.puts).toEqual([]);
  });

  test('with no record the guess is still what fills the window', async () => {
    // The login screen and the first visit: nothing better exists, and
    // the OS guess is what the boot script painted too, so the two
    // still agree.
    installOSPreference('dark');
    stubServer(
      { mode: 'builtin', builtinTheme: 'dark', customThemeId: null },
      200,
    );

    renderHook(() => useTheme(), { wrapper: wrapper() });
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  test('an in-flight load does not destroy the record it is painting from', async () => {
    // A tab closed mid-request must not cost the NEXT load its first
    // frame: until the answer settles, the record is neither confirmed
    // nor cleared.
    installOSPreference('light');
    writeThemeBootCache({ v: 1, mode: 'builtin', builtin: 'dark' });
    stubServer(
      { mode: 'builtin', builtinTheme: 'dark', customThemeId: null },
      200,
    );

    const { unmount } = renderHook(() => useTheme(), { wrapper: wrapper() });
    expect(readThemeBootCache()?.builtin).toBe('dark');
    unmount();
    expect(readThemeBootCache()?.builtin).toBe('dark');
  });
});

describe('the boot cache mirrors the SERVER, not the resolution', () => {
  test('it stores the server palette even when the OS says the opposite', async () => {
    // The record asserts «this is what the server last said», and the
    // boot script paints the first frame from that claim. An OS reading
    // that leaked into the record would make the next load paint this
    // device's environment instead of this account's preference — the
    // mispaint this whole guard exists to keep fixed, arriving by the
    // other door.
    installOSPreference('dark');
    stubServer({ mode: 'builtin', builtinTheme: 'light', customThemeId: null });

    renderHook(() => useTheme(), { wrapper: wrapper() });
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'));

    await waitFor(() => {
      const cached = readThemeBootCache();
      expect(cached).not.toBeNull();
      expect(cached?.builtin).toBe('light');
    });
  });

  test('the record is written even when the server merely CONFIRMS the guess', async () => {
    // The corner the split effect exists for. `bootstrapPref()` and the
    // stored row have the same shape, so for a user whose OS already
    // matches their account the resolved theme is referentially
    // unchanged when the response lands — and an effect keyed on it
    // alone would skip the write. That user would then be the ONE who
    // still gets the measured mispaint, on the first load after they
    // switch their OS.
    installOSPreference('light');
    stubServer({ mode: 'builtin', builtinTheme: 'light', customThemeId: null });

    renderHook(() => useTheme(), { wrapper: wrapper() });

    await waitFor(() =>
      expect(readThemeBootCache()).toEqual({
        v: 1,
        mode: 'builtin',
        builtin: 'light',
      }),
    );
  });

  test('an unauthenticated load caches nothing', async () => {
    installOSPreference('dark');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 401 })),
    );

    renderHook(() => useTheme(), { wrapper: wrapper() });
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));

    // A guess written to the boot cache would outlive the session it was
    // guessed in and would tell the next load it came from the server.
    expect(readThemeBootCache()).toBeNull();
  });
});
