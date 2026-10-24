/**
 * Smoke tests for `useTheme` (sk-10 — server-backed).
 *
 * The hook now reads `/api/v1/me/theme` via TanStack Query. Tests stub
 * `fetch` to return canned responses and wrap renderHook in a
 * QueryClientProvider so the query layer initialises cleanly.
 *
 * Coverage focuses on the DOM side-effects (data-theme attribute,
 * inline CSS variable strip) — those are what other Skein code actually
 * relies on. Network layer behaviour is left to the API client's own
 * unit tests; here we only need the fetch mock to resolve.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { useTheme } from '../useTheme';

function stubMatchMedia(prefersDark: boolean): void {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: prefersDark && query.includes('prefers-color-scheme: dark'),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

function wrapWithQueryClient(): {
  wrapper: ({ children }: { children: ReactNode }) => ReturnType<typeof createElement>;
} {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return {
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children),
  };
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  stubMatchMedia(false);
  // Default fetch mock — empty pref so the hook falls back to bootstrap.
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_input: RequestInfo, _init?: RequestInit) => {
      return new Response(
        JSON.stringify({ mode: 'builtin', builtinTheme: 'light', customThemeId: null }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useTheme — initial resolution', () => {
  test('falls back to light when server returns light pref', async () => {
    const { wrapper } = wrapWithQueryClient();
    const { result } = renderHook(() => useTheme(), { wrapper });
    await waitFor(() => {
      expect(result.current.theme).toBe('light');
    });
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  test('respects server-side dark preference', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({ mode: 'builtin', builtinTheme: 'dark', customThemeId: null }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    const { wrapper } = wrapWithQueryClient();
    const { result } = renderHook(() => useTheme(), { wrapper });
    await waitFor(() => {
      expect(result.current.theme).toBe('dark');
      expect(document.documentElement.dataset.theme).toBe('dark');
    });
  });

  test('unauthorized server bootstrap uses OS preference', async () => {
    stubMatchMedia(true);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 401 })),
    );
    const { wrapper } = wrapWithQueryClient();
    const { result } = renderHook(() => useTheme(), { wrapper });
    await waitFor(() => {
      expect(result.current.theme).toBe('dark');
    });
  });
});

describe('useTheme — actions', () => {
  test('setTheme writes data-theme attribute', async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        return new Response(init.body as string, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify({ mode: 'builtin', builtinTheme: 'light', customThemeId: null }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const { wrapper } = wrapWithQueryClient();
    const { result } = renderHook(() => useTheme(), { wrapper });
    await waitFor(() => expect(result.current.theme).toBe('light'));

    act(() => result.current.setTheme('dark'));
    await waitFor(() => {
      expect(result.current.theme).toBe('dark');
      expect(document.documentElement.dataset.theme).toBe('dark');
    });
  });

  test('toggle flips between light and dark', async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        return new Response(init.body as string, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify({ mode: 'builtin', builtinTheme: 'light', customThemeId: null }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const { wrapper } = wrapWithQueryClient();
    const { result } = renderHook(() => useTheme(), { wrapper });
    await waitFor(() => expect(result.current.theme).toBe('light'));

    act(() => result.current.toggle());
    await waitFor(() => expect(result.current.theme).toBe('dark'));

    act(() => result.current.toggle());
    await waitFor(() => expect(result.current.theme).toBe('light'));
  });
});
