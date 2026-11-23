/**
 * sk-1048.49 — the "new version" banner of `VersionCheck`.
 *
 * Contract (DEV_GUIDELINES «SPA versioning», `VersionCheck.tsx`): `/version.json`
 * is read with `cache: 'no-store'` on mount and then every 60 s; the first
 * valid answer is the baseline and shows nothing; a failed read is ignored and
 * the next poll still runs; only a version different from the baseline shows
 * the banner; unmounting stops the polling.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

import { VersionCheck } from './VersionCheck';

const POLL_MS = 60_000;
const fetchSpy = vi.fn<typeof fetch>();

function version(v: string): Response {
  return new Response(JSON.stringify({ version: v }), { status: 200, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  vi.useFakeTimers();
  fetchSpy.mockReset();
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function mount() {
  return render(
    <MantineProvider>
      <VersionCheck />
    </MantineProvider>,
  );
}

describe('VersionCheck', () => {
  test('baseline, same version, failed reads, then a new version shows the banner', async () => {
    fetchSpy
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(version('1.4.0'))
      .mockResolvedValueOnce(version('1.4.0'))
      .mockResolvedValueOnce(new Response('', { status: 502 }))
      .mockResolvedValueOnce(version('1.5.0'));
    mount();

    await tick(0);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith('/version.json', { cache: 'no-store' });

    await tick(POLL_MS);
    await tick(POLL_MS);
    await tick(POLL_MS);
    expect(fetchSpy).toHaveBeenCalledTimes(4);
    expect(screen.queryByRole('alert')).toBeNull();

    await tick(POLL_MS);
    expect(fetchSpy).toHaveBeenCalledTimes(5);
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  test('unmounting stops the polling', async () => {
    fetchSpy.mockImplementation(async () => version('1.4.0'));
    const view = mount();
    await tick(0);
    await tick(POLL_MS);
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    view.unmount();
    await tick(3 * POLL_MS);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
