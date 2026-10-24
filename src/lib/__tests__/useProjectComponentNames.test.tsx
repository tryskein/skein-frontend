/**
 * sk-421.1 T013 — row 40: the issue card's component directory
 * hook (US-3, R-1, INV-8, NFR "at most one new read per card open").
 *
 * What is pinned:
 *   - the directory of the ISSUE's project is read, archived included:
 *     `listComponents(<that project>, 'all')` — the overlay case where the
 *     issue lives in a project other than the one selected in the tree;
 *   - no components → no request;
 *   - the key does not depend on the `outboxMode` lens;
 *   - freshness AND retention, as one check: after the card unmounts and
 *     longer than TanStack's default retention (5 min) passes, a new
 *     mount with no component event does not read again.
 *
 * Harness for the retention check (row 40 (a)–(d)):
 *   (a) full `vi.useFakeTimers()` BEFORE mounting — the GC timer takes the
 *       global `setTimeout` when it is scheduled, so `toFake: ['Date']` or
 *       clocks faked after unmount would leave a real timer and pass
 *       silently;
 *   (b) the first read is driven with `vi.waitFor` (it advances fake
 *       timers itself), waiting for the query to be SETTLED — `success` +
 *       `idle` — not merely for `listComponents` to have been called (that
 *       call is synchronous on mount; a query still fetching at unmount is
 *       never garbage-collected, which would also pass silently);
 *   (c) unmount → advance past the default retention → remount → exactly
 *       one `listComponents` call;
 *   (d) the test client sets NO `staleTime` / `gcTime` = Infinity: client
 *       defaults would make a hook without its own settings look right.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Component } from '../../api/components';
import { LayoutProvider, useLayoutState } from '../useLayoutState';
import {
  projectComponentNamesKey,
  useProjectComponentNames,
} from '../useProjectComponentNames';

const { listComponentsSpy } = vi.hoisted(() => ({
  listComponentsSpy: vi.fn(),
}));

vi.mock('../../api/components', () => ({
  listComponents: listComponentsSpy,
}));

const PROJECT_B = 'proj-b-uuid';

function component(over: Partial<Component>): Component {
  return {
    id: 'c-1',
    projectId: PROJECT_B,
    name: 'alpha',
    description: '',
    paths: [],
    archivedAt: null,
    createdBy: 'u-1',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    openCount: 0,
    inProgressCount: 0,
    blockedCount: 0,
    ...over,
  } as Component;
}

/** (d) — no staleTime / gcTime here: the hook must carry its own. */
function newClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function wrapperFor(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  listComponentsSpy.mockReset();
  listComponentsSpy.mockResolvedValue([
    component({ id: 'c-1', name: 'alpha' }),
    component({ id: 'c-2', name: 'legacy', archivedAt: '2026-02-01T00:00:00Z' }),
  ]);
});

afterEach(() => {
  vi.useRealTimers();
  window.localStorage.clear();
});

describe('useProjectComponentNames — what is read', () => {
  test("reads the ISSUE's project directory with archived components", async () => {
    const qc = newClient();
    const { result } = renderHook(
      () => useProjectComponentNames(PROJECT_B, ['c-1']),
      { wrapper: wrapperFor(qc) },
    );
    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(listComponentsSpy).toHaveBeenCalledTimes(1);
    expect(listComponentsSpy).toHaveBeenCalledWith(PROJECT_B, 'all');
    expect(result.current.data?.get('c-1')).toEqual({ name: 'alpha', archived: false });
    expect(result.current.data?.get('c-2')).toEqual({ name: 'legacy', archived: true });
  });

  test('an issue without components sends no request', async () => {
    const qc = newClient();
    const { result } = renderHook(
      () => useProjectComponentNames(PROJECT_B, []),
      { wrapper: wrapperFor(qc) },
    );
    // Give any stray fetch a chance to start before asserting its absence.
    await act(async () => {
      await Promise.resolve();
    });
    expect(listComponentsSpy).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
  });
});

describe('useProjectComponentNames — the lens does not reach the key (INV-8)', () => {
  /** Mount the hook under the real layout provider with the lens set. */
  async function keysUnderLens(outbox: boolean): Promise<unknown[][]> {
    window.localStorage.setItem('skein.outbox-mode', String(outbox));
    const qc = newClient();
    const seen: { outboxMode?: boolean } = {};
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={qc}>
          <MemoryRouter>
            <LayoutProvider>{children}</LayoutProvider>
          </MemoryRouter>
        </QueryClientProvider>
      );
    }
    const { result } = renderHook(
      () => {
        seen.outboxMode = useLayoutState().outboxMode;
        return useProjectComponentNames(PROJECT_B, ['c-1']);
      },
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.status).toBe('success'));
    // The lens really was in the requested state — otherwise the
    // comparison below would compare two identical worlds.
    expect(seen.outboxMode).toBe(outbox);
    return qc
      .getQueryCache()
      .findAll({ queryKey: ['component-names'] })
      .map((q) => [...q.queryKey]);
  }

  test('outboxMode on and off produce the same single key', async () => {
    const withLens = await keysUnderLens(true);
    const withoutLens = await keysUnderLens(false);
    expect(withLens).toEqual([[...projectComponentNamesKey(PROJECT_B)]]);
    expect(withoutLens).toEqual(withLens);
  });
});

describe('useProjectComponentNames — freshness and retention (one requirement)', () => {
  test('remounting after all cards were closed longer than the default retention does not read again', async () => {
    // (a) fake timers BEFORE the first mount.
    vi.useFakeTimers();
    const qc = newClient();
    const wrapper = wrapperFor(qc);
    const key = projectComponentNamesKey(PROJECT_B);

    const first = renderHook(
      () => useProjectComponentNames(PROJECT_B, ['c-1']),
      { wrapper },
    );
    // (b) wait for the read to SETTLE, not merely to start. Inside `act`
    // because the settling query re-renders the hook.
    await act(async () => {
      await vi.waitFor(() => {
        expect(qc.getQueryState(key)).toMatchObject({
          status: 'success',
          fetchStatus: 'idle',
        });
      });
    });
    expect(first.result.current.data).toBeDefined();
    expect(listComponentsSpy).toHaveBeenCalledTimes(1);

    // (c) every card of the project closes; wait past TanStack's 5 min.
    first.unmount();
    vi.advanceTimersByTime(5 * 60_000 + 1);

    const second = renderHook(
      () => useProjectComponentNames(PROJECT_B, ['c-1']),
      { wrapper },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(second.result.current.data?.get('c-1')).toEqual({
      name: 'alpha',
      archived: false,
    });
    expect(listComponentsSpy).toHaveBeenCalledTimes(1);
    second.unmount();
  });
});
