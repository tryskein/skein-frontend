/**
 * sk-551.7 — the density is known before the first frame, and it is the
 * signed-in person's own.
 *
 * Reference — brief sk-551.7 ("No flash on load"): the mode is known before
 * the first paint — a cache of the last value in localStorage, an early script
 * sets the attribute, sync after the server answers; the cache is bound to
 * the user — another person's density is not shown after a user switch;
 * a broken or unavailable localStorage — "Normal" without a crash.
 *
 * Two halves, both run rather than read:
 *   - `public/theme-boot.js` is executed (the source the browser is
 *     served, as `ThemeBootFirstFrame.test.ts` does for the theme) against
 *     records written by `densityBootCache.ts` — so a renamed field on
 *     either side fails here, not on a production first frame;
 *   - `useDensitySync` is mounted with the server's answer held back, so
 *     what lands on `<html>` is the cache's doing, not the server's.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import BOOT_SOURCE from '../../../../public/theme-boot.js?raw';

let auth: { user: { id: string } | null; isLoading: boolean; sessionResolved: boolean };
vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => auth,
}));

import {
  DENSITY_BOOT_CACHE_KEY,
  readDensityBootCache,
  writeDensityBootCache,
} from '../../../lib/densityBootCache';
import { DensitySync } from '../../../components/DensitySync';

const attr = () => document.documentElement.getAttribute('data-density');

/** Run the boot script the way the browser does (see ThemeBootFirstFrame). */
function runBoot(): string | null {
  document.documentElement.removeAttribute('data-density');
  new Function(BOOT_SOURCE)();
  return attr();
}

/** GET /me/ui-prefs never answers until released; resolves with `density`. */
let releaseGet: ((density: string) => void) | null;

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-density');
  auth = { user: { id: 'u-1' }, isLoading: false, sessionResolved: true };
  releaseGet = null;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (input: RequestInfo | URL) =>
        new Promise<Response>((resolve) => {
          if (!String(input).endsWith('/api/v1/me/ui-prefs')) {
            resolve(new Response('{}', { status: 404 }));
            return;
          }
          releaseGet = (density) =>
            resolve(
              new Response(JSON.stringify({ issueModalViews: [], density }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              }),
            );
        }),
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-density');
});

function mountSync() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DensitySync />
    </QueryClientProvider>,
  );
}

describe('theme-boot.js paints the cached density before React mounts', () => {
  test('a cached compact density is on <html> on the first frame', () => {
    writeDensityBootCache('u-1', 'compact');
    expect(runBoot()).toBe('compact');
  });

  test('a cached normal density, or none, leaves the attribute off', () => {
    writeDensityBootCache('u-1', 'normal');
    expect(runBoot()).toBeNull();
    window.localStorage.clear();
    expect(runBoot()).toBeNull();
  });

  test('a broken record is «Normal», and the theme and width mode are still painted', () => {
    window.localStorage.setItem(DENSITY_BOOT_CACHE_KEY, '{"v":1,"userId":');
    expect(() => runBoot()).not.toThrow();
    expect(attr()).toBeNull();
    expect(document.documentElement.getAttribute('data-theme')).not.toBeNull();
    expect(document.documentElement.getAttribute('data-width-mode')).not.toBeNull();
  });

  test('a localStorage that throws is «Normal», without an exception', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(() => runBoot()).not.toThrow();
    expect(attr()).toBeNull();
  });
});

describe('useDensitySync — the cache is the signed-in person\'s, or it is not used', () => {
  test('this person\'s cached compact holds the page before the server answers', async () => {
    writeDensityBootCache('u-1', 'compact');
    runBoot();
    mountSync();
    await waitFor(() => expect(releaseGet).not.toBeNull());
    expect(attr()).toBe('compact');
  });

  test('another person\'s cached compact is dropped as soon as the session is known', async () => {
    writeDensityBootCache('u-2', 'compact');
    runBoot(); // the boot script cannot know who is signed in
    mountSync();
    await waitFor(() => expect(releaseGet).not.toBeNull());
    expect(attr()).toBeNull();
  });

  test('while the session is still unknown the boot paint stands', () => {
    writeDensityBootCache('u-2', 'compact');
    runBoot();
    auth = { user: null, isLoading: true, sessionResolved: false };
    mountSync();
    expect(attr()).toBe('compact');
  });

  test('the server overrules the cache and becomes the cache, for this person', async () => {
    writeDensityBootCache('u-1', 'compact');
    runBoot();
    mountSync();
    await waitFor(() => expect(releaseGet).not.toBeNull());
    releaseGet!('normal');
    await waitFor(() => expect(attr()).toBeNull());
    expect(readDensityBootCache()).toEqual({ v: 1, userId: 'u-1', density: 'normal' });
  });

  test('nobody signed in: «Normal», and the record is gone for the next load', () => {
    writeDensityBootCache('u-1', 'compact');
    runBoot();
    auth = { user: null, isLoading: false, sessionResolved: true };
    mountSync();
    expect(attr()).toBeNull();
    expect(readDensityBootCache()).toBeNull();
  });

  test.each([
    ['a record of another schema version', '{"v":2,"userId":"u-1","density":"compact"}'],
    ['a JSON null', 'null'],
    ['a bare string', '"compact"'],
  ])('%s is not this person\'s density: «Normal», no crash', async (_name, raw) => {
    window.localStorage.setItem(DENSITY_BOOT_CACHE_KEY, raw);
    document.documentElement.setAttribute('data-density', 'compact');
    mountSync();
    await waitFor(() => expect(releaseGet).not.toBeNull());
    expect(attr()).toBeNull();
  });

  test('a broken or unreadable cache is «Normal» without a crash', async () => {
    window.localStorage.setItem(DENSITY_BOOT_CACHE_KEY, 'not json');
    mountSync();
    await waitFor(() => expect(releaseGet).not.toBeNull());
    expect(attr()).toBeNull();
    cleanup();

    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    document.documentElement.setAttribute('data-density', 'compact');
    expect(() => mountSync()).not.toThrow();
    expect(attr()).toBeNull();
  });
});
