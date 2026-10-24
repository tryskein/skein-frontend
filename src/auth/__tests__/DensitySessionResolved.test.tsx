/**
 * sk-551.7 — the density's boot record and the
 * attribute are dropped only when the server ANSWERED that nobody is
 * signed in.
 *
 * The reference is the rule: "clear the cache/attribute only when
 * /me answered successfully with no user (logout and 401→null are success); while
 * pending/paused/error — leave as theme-boot.js painted it". Regressions:
 * /me error → attribute and cache intact; /me paused → intact; /me success with no
 * user → cleared.
 *
 * The defect: `useDensitySync` read `user === null && !isLoading` as
 * «signed out», and `isLoading` is false for an errored and for a paused
 * query — a 500 or an offline load wiped the record, and the next load
 * flashed the normal density.
 *
 * Runs the REAL `AuthProvider` (its `/api/auth/me` query and the answer
 * it derives) with `DensitySync`; `fetch` is stubbed at the network
 * boundary, and offline is TanStack's own `onlineManager`.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';

import { AuthProvider } from '../AuthContext';
import { DensitySync } from '../../components/DensitySync';
import { readDensityBootCache, writeDensityBootCache } from '../../lib/densityBootCache';

const attr = () => document.documentElement.getAttribute('data-density');

/** How `/api/auth/me` answers; every other request is a plain 404. */
let meStatus: number;
let meCalls: number;

beforeEach(() => {
  window.localStorage.clear();
  // What theme-boot.js left on <html> from the record below.
  writeDensityBootCache('u-1', 'compact');
  document.documentElement.setAttribute('data-density', 'compact');
  meCalls = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/auth/me')) {
        meCalls += 1;
        return new Response(JSON.stringify({ error: 'x' }), {
          status: meStatus,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } });
    }),
  );
});

afterEach(() => {
  cleanup();
  onlineManager.setOnline(true);
  vi.unstubAllGlobals();
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-density');
});

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <DensitySync />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return qc;
}

describe('the density is dropped only on an answered «nobody»', () => {
  test('/me fails (500): the attribute and the record stay as the boot painted them', async () => {
    meStatus = 500;
    const qc = mount();
    await waitFor(() =>
      expect(qc.getQueryState(['auth', 'me'])?.status).toBe('error'),
    );
    expect(attr()).toBe('compact');
    expect(readDensityBootCache()).toEqual({ v: 1, userId: 'u-1', density: 'compact' });
  });

  test('/me paused offline: the attribute and the record stay', async () => {
    onlineManager.setOnline(false);
    meStatus = 401;
    const qc = mount();
    await waitFor(() =>
      expect(qc.getQueryState(['auth', 'me'])?.fetchStatus).toBe('paused'),
    );
    expect(meCalls).toBe(0);
    expect(attr()).toBe('compact');
    expect(readDensityBootCache()).not.toBeNull();
  });

  test('/me answers 401 (nobody signed in): «Normal», and the record is gone', async () => {
    meStatus = 401;
    mount();
    await waitFor(() => expect(attr()).toBeNull());
    expect(readDensityBootCache()).toBeNull();
  });
});
