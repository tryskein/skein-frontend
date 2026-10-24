/**
 * sk-47.2 — `useBlobMode` coordinator tests.
 *
 * Mocks `lookupIdBatch` (the FROZEN batch endpoint built in parallel by a
 * backend task — tests MUST NOT hit a live endpoint) and asserts:
 *   - enter() resolves the codes via one batch call;
 *   - the found/not-found diff is computed against the returned items
 *     (server returns only found+visible rows);
 *   - chips preserve first-seen (paste) order; found chips carry their row;
 *   - matched[] is the found subset mapped to IssueSummary for TaskCard;
 *   - exit() drops back out of blob mode.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render, cleanup, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type { SearchItem, LookupIdBatchResponse } from '../../api/search';
import { useBlobMode, type UseBlobModeResult } from '../useBlobMode';

const lookupSpy = vi.fn<(ids: string[]) => Promise<LookupIdBatchResponse>>();

vi.mock('../../api/search', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/search')>();
  return {
    ...actual,
    lookupIdBatch: (...args: [string[]]) => lookupSpy(...args),
  };
});

function item(id: string, over: Partial<SearchItem> = {}): SearchItem {
  return {
    kind: 'issue',
    id,
    projectId: 'p-uuid',
    projectName: 'Skein',
    title: `title ${id}`,
    snippet: '',
    score: 0,
    exactMatch: true,
    status: 'open',
    priority: 3,
    type: 'task',
    pinned: false,
    assignee: null,
    updatedAt: '2026-05-15T10:00:00Z',
    ...over,
  };
}

let hook: UseBlobModeResult | null = null;

function Host() {
  hook = useBlobMode();
  return null;
}

function renderHook() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <Host />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  lookupSpy.mockReset();
});

afterEach(() => {
  cleanup();
  hook = null;
});

describe('useBlobMode — entering / exiting', () => {
  test('starts inactive with empty codes', () => {
    lookupSpy.mockResolvedValue({ items: [] });
    renderHook();
    expect(hook!.active).toBe(false);
    expect(hook!.codes).toEqual([]);
    // No fetch fires while inactive.
    expect(lookupSpy).not.toHaveBeenCalled();
  });

  test('enter([]) is a no-op (defensive — stays inactive)', () => {
    lookupSpy.mockResolvedValue({ items: [] });
    renderHook();
    act(() => hook!.enter([]));
    expect(hook!.active).toBe(false);
    expect(lookupSpy).not.toHaveBeenCalled();
  });

  test('enter(codes) activates blob mode and fires ONE batch call', async () => {
    lookupSpy.mockResolvedValue({ items: [item('sk-14')] });
    renderHook();
    act(() => hook!.enter(['sk-14']));
    expect(hook!.active).toBe(true);
    expect(hook!.codes).toEqual(['sk-14']);
    await waitFor(() => expect(lookupSpy).toHaveBeenCalledTimes(1));
    expect(lookupSpy).toHaveBeenCalledWith(['sk-14']);
  });

  test('exit() leaves blob mode', async () => {
    lookupSpy.mockResolvedValue({ items: [item('sk-14')] });
    renderHook();
    act(() => hook!.enter(['sk-14']));
    expect(hook!.active).toBe(true);
    act(() => hook!.exit());
    expect(hook!.active).toBe(false);
    expect(hook!.codes).toEqual([]);
  });
});

describe('useBlobMode — found / not-found diff', () => {
  test('all codes found → every chip found, matched has all rows', async () => {
    lookupSpy.mockResolvedValue({
      items: [item('sk-14'), item('demo-2')],
    });
    renderHook();
    act(() => hook!.enter(['sk-14', 'demo-2']));
    // chips length is synchronous (derived from codes); wait for the
    // query to resolve so the found diff is populated.
    await waitFor(() => expect(hook!.foundCount).toBe(2));

    expect(hook!.chips).toHaveLength(2);
    expect(hook!.chips.every((c) => c.found)).toBe(true);
    expect(hook!.notFoundCount).toBe(0);
    expect(hook!.matched.map((m) => m.id)).toEqual(['sk-14', 'demo-2']);
  });

  test('codes absent from the response render as not-found chips', async () => {
    // Server returns only sk-14 (demo-2 + ghost-9 are missing / not visible).
    lookupSpy.mockResolvedValue({ items: [item('sk-14')] });
    renderHook();
    act(() => hook!.enter(['sk-14', 'demo-2', 'ghost-9']));
    await waitFor(() => expect(hook!.foundCount).toBe(1));

    expect(hook!.chips).toHaveLength(3);
    const byCode = Object.fromEntries(hook!.chips.map((c) => [c.code, c]));
    expect(byCode['sk-14'].found).toBe(true);
    expect(byCode['sk-14'].item).not.toBeNull();
    expect(byCode['demo-2'].found).toBe(false);
    expect(byCode['demo-2'].item).toBeNull();
    expect(byCode['ghost-9'].found).toBe(false);

    expect(hook!.foundCount).toBe(1);
    expect(hook!.notFoundCount).toBe(2);
    // matched is only the found subset.
    expect(hook!.matched.map((m) => m.id)).toEqual(['sk-14']);
  });

  test('chips preserve first-seen (paste) order regardless of response order', async () => {
    // Response order is reversed vs the requested order.
    lookupSpy.mockResolvedValue({
      items: [item('demo-2'), item('sk-14')],
    });
    renderHook();
    act(() => hook!.enter(['sk-14', 'demo-2']));
    await waitFor(() => expect(hook!.matched).toHaveLength(2));
    // Chips (and matched) follow the requested order, not the server's.
    expect(hook!.chips.map((c) => c.code)).toEqual(['sk-14', 'demo-2']);
    expect(hook!.matched.map((m) => m.id)).toEqual(['sk-14', 'demo-2']);
  });

  test('zero codes found → all chips not-found, matched empty', async () => {
    lookupSpy.mockResolvedValue({ items: [] });
    renderHook();
    act(() => hook!.enter(['nope-1', 'nope-2']));
    // Wait for the query to settle so the (empty) diff is authoritative.
    await waitFor(() => expect(hook!.isLoading).toBe(false));
    expect(hook!.chips).toHaveLength(2);
    expect(hook!.chips.every((c) => !c.found)).toBe(true);
    expect(hook!.foundCount).toBe(0);
    expect(hook!.notFoundCount).toBe(2);
    expect(hook!.matched).toEqual([]);
  });

  test('matched rows map SearchItem → IssueSummary for TaskCard', async () => {
    lookupSpy.mockResolvedValue({
      items: [item('sk-14', { title: 'Refactor auth', priority: 1, type: 'bug' })],
    });
    renderHook();
    act(() => hook!.enter(['sk-14']));
    await waitFor(() => expect(hook!.matched).toHaveLength(1));
    const row = hook!.matched[0];
    expect(row.id).toBe('sk-14');
    expect(row.title).toBe('Refactor auth');
    expect(row.priority).toBe(1);
    expect(row.type).toBe('bug');
    // Lean defaults filled for fields the batch projection omits.
    expect(row.componentIds).toEqual([]);
    expect(row.isBlocked).toBe(false);
  });
});
