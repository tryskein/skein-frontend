/**
 * sk-36 F2 — `useLayeredTree` query key shape regression test.
 *
 * The live-event invalidation router and any prefetcher relies on
 * `layeredTreeQueryKey` producing a stable, predictable key. We assert
 * the exact wire shape here so future refactors don't silently break
 * cross-cutting invalidation.
 *
 * sk-421.2 T017 — the key shape was CHANGED DELIBERATELY, together with this guard:
 * a sixth segment was added — the traversal depth (F-3). The epic section requests
 * only the active mode (R-7): "List" is depth 1, "Tree" is a full
 * traversal; without the depth segment both modes would share one cache entry and
 * switching would show another mode's response. The `__full__` sentinel keeps the key
 * length the same — in the same spirit as `__cross__` and `__forest__`.
 *
 * sk-421.2.8 T009 (R-9, matrix row 25) — the key shape was CHANGED DELIBERATELY
 * once more: the seventh segment is the "include blockers" flag
 * (`__blockers__` / `__no_blockers__`). The epic section asks for the field, the tasks column
 * does not; without the segment they would share a cache entry. The prefix
 * `['issues','tree']` is the same — live invalidations by prefix do not change.
 */

import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { DepType } from '../../api/dependencies';
import { fetchIssueTree } from '../../api/issues';
import { layeredTreeQueryKey, useLayeredTree } from '../useLayeredTree';

vi.mock('../../api/issues', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/issues')>();
  return {
    ...actual,
    fetchIssueTree: vi.fn(async () => ({ items: [] })),
  };
});

describe('layeredTreeQueryKey', () => {
  test('canonical key for project + rootId + sorted types', () => {
    const key = layeredTreeQueryKey('proj-uuid', 'epic-1', [
      'parent-child',
      'blocks',
    ] as DepType[]);
    expect(key).toEqual([
      'issues',
      'tree',
      'proj-uuid',
      'epic-1',
      'blocks,parent-child',
      '__full__',
      '__no_blockers__',
    ]);
  });

  test('cross-project (project=null) uses __cross__ sentinel', () => {
    const key = layeredTreeQueryKey(null, null, ['parent-child'] as DepType[]);
    expect(key).toEqual([
      'issues',
      'tree',
      '__cross__',
      '__forest__',
      'parent-child',
      '__full__',
      '__no_blockers__',
    ]);
  });

  test('forest walk (rootId=null) uses __forest__ sentinel', () => {
    const key = layeredTreeQueryKey('proj-x', null, [
      'parent-child',
      'related',
    ] as DepType[]);
    expect(key).toEqual([
      'issues',
      'tree',
      'proj-x',
      '__forest__',
      'parent-child,related',
      '__full__',
      '__no_blockers__',
    ]);
  });

  test('types order does NOT affect the key (sort stabilises it)', () => {
    const a = layeredTreeQueryKey('p', 'r', [
      'related',
      'blocks',
      'parent-child',
    ] as DepType[]);
    const b = layeredTreeQueryKey('p', 'r', [
      'parent-child',
      'related',
      'blocks',
    ] as DepType[]);
    expect(a).toEqual(b);
  });

  // ───────────────────── sk-421.2 T017 — depth ─────────────────────

  test('depth goes into the key as the sixth segment, the blockers flag as the seventh', () => {
    // sk-421.2.8 T009 (a) — previously depth was the last segment; after
    // R-9 it is followed by the blockers flag sentinel.
    const key = layeredTreeQueryKey('p', 'epic-1', ['parent-child'] as DepType[], 1);
    expect(key).toEqual([
      'issues',
      'tree',
      'p',
      'epic-1',
      'parent-child',
      1,
      '__no_blockers__',
    ]);
  });

  test('two modes of one epic do NOT share a cache entry', () => {
    // Exactly what the segment was added for: "List" (depth 1) and
    // "Tree" (full traversal) must be different keys.
    const list = layeredTreeQueryKey('p', 'epic-1', ['parent-child'] as DepType[], 1);
    const tree = layeredTreeQueryKey('p', 'epic-1', ['parent-child'] as DepType[]);
    expect(list).not.toEqual(tree);
  });

  test('different depth limits — different keys', () => {
    const d1 = layeredTreeQueryKey('p', 'r', ['parent-child'] as DepType[], 1);
    const d2 = layeredTreeQueryKey('p', 'r', ['parent-child'] as DepType[], 2);
    expect(d1).not.toEqual(d2);
  });

  test('no depth and an explicit `undefined` give ONE key', () => {
    // Otherwise a caller passing an optional argument straight through
    // would silently miss its own cache.
    const omitted = layeredTreeQueryKey('p', 'r', ['parent-child'] as DepType[]);
    const explicit = layeredTreeQueryKey(
      'p',
      'r',
      ['parent-child'] as DepType[],
      undefined,
    );
    expect(omitted).toEqual(explicit);
  });

  // ──────────── sk-421.2.8 T009 — the blockers flag (row 25) ────────────

  test('(b) keys with and without includeBlockers differ with the other arguments equal', () => {
    const PARENT_CHILD = ['parent-child'] as DepType[];
    for (const depth of [1, undefined]) {
      const withFlag = layeredTreeQueryKey(null, 'sk-42', PARENT_CHILD, depth, true);
      const withoutFlag = layeredTreeQueryKey(null, 'sk-42', PARENT_CHILD, depth);
      expect(withFlag).not.toEqual(withoutFlag);
      // The prefix is the one that live invalidations match by (US-5).
      expect(withFlag.slice(0, 2)).toEqual(['issues', 'tree']);
      expect(withoutFlag.slice(0, 2)).toEqual(['issues', 'tree']);
      // The length is the same: the sentinel stands at both flag values.
      expect(withFlag).toHaveLength(withoutFlag.length);
    }
  });

  test('(b) `false` and no flag give ONE key — the tasks column entry', () => {
    const PARENT_CHILD = ['parent-child'] as DepType[];
    expect(layeredTreeQueryKey('p', null, PARENT_CHILD, undefined, false)).toEqual(
      layeredTreeQueryKey('p', null, PARENT_CHILD),
    );
  });
});

describe('useLayeredTree — the blockers flag reaches the request (row 25 (c))', () => {
  const mockedFetch = vi.mocked(fetchIssueTree);

  function wrapperWith(client: QueryClient) {
    return function Wrapper({ children }: { children: ReactNode }) {
      return createElement(QueryClientProvider, { client }, children);
    };
  }

  function newClient(): QueryClient {
    return new QueryClient({ defaultOptions: { queries: { retry: false } } });
  }

  afterEach(() => {
    mockedFetch.mockClear();
  });

  test('includeBlockers:true → fetchIssueTree called with includeBlockers:true', async () => {
    const client = newClient();
    renderHook(
      () =>
        useLayeredTree({
          project: null,
          rootId: 'sk-42',
          types: ['parent-child'],
          maxDepth: 1,
          includeBlockers: true,
        }),
      { wrapper: wrapperWith(client) },
    );
    await waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(1));
    expect(mockedFetch.mock.calls[0][0]).toMatchObject({
      rootId: 'sk-42',
      maxDepth: 1,
      includeBlockers: true,
    });
    // And the response landed under the key WITH the flag — not under the tasks column key.
    const PARENT_CHILD = ['parent-child'] as DepType[];
    expect(
      client.getQueryData(layeredTreeQueryKey(null, 'sk-42', PARENT_CHILD, 1, true)),
    ).toBeDefined();
    expect(
      client.getQueryData(layeredTreeQueryKey(null, 'sk-42', PARENT_CHILD, 1)),
    ).toBeUndefined();
    client.clear();
  });

  test('without the flag → fetchIssueTree called without a true includeBlockers', async () => {
    const client = newClient();
    renderHook(
      () =>
        useLayeredTree({
          project: null,
          rootId: 'sk-42',
          types: ['parent-child'],
          maxDepth: 1,
        }),
      { wrapper: wrapperWith(client) },
    );
    await waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(1));
    expect(mockedFetch.mock.calls[0][0].includeBlockers).not.toBe(true);
    client.clear();
  });
});
