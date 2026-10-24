/**
 * sk-285.2.7 — tests for the ancestor backfill that makes the Tasks
 * tree show the project's hierarchy instead of one page's worth of it.
 *
 * The two pure halves are what matter here: `collectMissingParentIds`
 * decides WHAT to ask for, `fetchAncestorChain` decides how far to
 * climb and when to stop. The stopping rules are the load-bearing part
 * — a cycle or a self-reference in the dep graph must end the walk, not
 * spin it — so they get a test each rather than one "it terminates".
 *
 * `fetchById` is injected, so nothing here touches the network; the
 * real fetcher (`findIssueSummaryById`) is covered by the wire-shape
 * tests next to `getIssueByID`.
 */

import { describe, expect, test, vi } from 'vitest';
import type { IssueSummary } from '../../api/issues';
import { buildIssueTree } from '../buildIssueTree';
import {
  ANCESTOR_MAX_LEVELS,
  collectMissingParentIds,
  fetchAncestorChain,
} from '../useTreeAncestors';

function issue(
  id: string,
  parentIdCurrent: string | null = null,
  overrides: Partial<IssueSummary> = {},
): IssueSummary {
  return {
    id,
    projectId: 'p1',
    parentIdCurrent,
    version: 1,
    title: id,
    type: 'task',
    priority: 3,
    status: 'open',
    pinned: false,
    componentIds: [],
    labels: [],
    isBlocked: false,
    updatedAt: '2026-05-01T10:00:00Z',
    createdAt: '2026-05-01T09:00:00Z',
    ...overrides,
  };
}

/** Fetcher over a fixed universe of issues — anything else is invisible. */
function fetcherOver(universe: IssueSummary[]) {
  const byId = new Map(universe.map((it) => [it.id, it]));
  return vi.fn(async (id: string) => byId.get(id) ?? null);
}

describe('collectMissingParentIds', () => {
  test('empty list → nothing to fetch', () => {
    expect(collectMissingParentIds([])).toEqual([]);
  });

  test('parents present on the page are not requested', () => {
    const items = [issue('a'), issue('b', 'a')];
    expect(collectMissingParentIds(items)).toEqual([]);
  });

  test('parent absent from the page is requested exactly once', () => {
    // Two siblings under the same off-page parent → one lookup, not two.
    const items = [issue('b', 'ghost'), issue('c', 'ghost'), issue('d')];
    expect(collectMissingParentIds(items)).toEqual(['ghost']);
  });

  test('order follows first appearance, so a truncated walk keeps the top', () => {
    const items = [issue('b', 'p2'), issue('c', 'p1')];
    expect(collectMissingParentIds(items)).toEqual(['p2', 'p1']);
  });
});

describe('fetchAncestorChain', () => {
  test('climbs a 2+ level chain up to the root', async () => {
    // On screen: `c` only. Real hierarchy: root → mid → c.
    const fetchById = fetcherOver([issue('root'), issue('mid', 'root')]);
    const got = await fetchAncestorChain({
      seedIds: ['mid'],
      known: new Set(['c']),
      fetchById,
    });
    expect(got.map((i) => i.id)).toEqual(['mid', 'root']);
    expect(fetchById).toHaveBeenCalledTimes(2);
  });

  test('the completed chain re-nests the row that had floated to the root', async () => {
    // The end-to-end property the task is about: before the backfill
    // `c` was a root row; after it, it sits two levels deep.
    const page = [issue('c', 'mid')];
    const universe = [issue('root'), issue('mid', 'root')];
    const ancestors = await fetchAncestorChain({
      seedIds: collectMissingParentIds(page),
      known: new Set(page.map((i) => i.id)),
      fetchById: fetcherOver(universe),
    });
    const contextIds = new Set(ancestors.map((i) => i.id));
    const forest = buildIssueTree([...page, ...ancestors], undefined, contextIds);

    expect(forest.map((n) => n.item.id)).toEqual(['root']);
    expect(forest[0].isContext).toBe(true);
    const mid = forest[0].children[0];
    expect(mid.item.id).toBe('mid');
    expect(mid.isContext).toBe(true);
    expect(mid.children.map((n) => n.item.id)).toEqual(['c']);
    expect(mid.children[0].isContext).toBe(false);
  });

  test('ids already on the page are never fetched', async () => {
    const fetchById = fetcherOver([issue('a')]);
    const got = await fetchAncestorChain({
      seedIds: ['a'],
      known: new Set(['a']),
      fetchById,
    });
    expect(got).toEqual([]);
    expect(fetchById).not.toHaveBeenCalled();
  });

  test('an unresolvable parent (absent or invisible) leaves the branch as it was', async () => {
    // Cross-project parent the caller cannot see: the lookup returns
    // null, we add nothing, and the child stays a root row.
    const fetchById = fetcherOver([]);
    const got = await fetchAncestorChain({
      seedIds: ['secret-1'],
      known: new Set(['c']),
      fetchById,
    });
    expect(got).toEqual([]);
  });

  test('one failing lookup does not sink the other branches', async () => {
    const ok = issue('good');
    const fetchById = vi.fn(async (id: string) => {
      if (id === 'boom') throw new Error('network');
      return id === 'good' ? ok : null;
    });
    const got = await fetchAncestorChain({
      seedIds: ['boom', 'good'],
      known: new Set(),
      fetchById,
    });
    expect(got.map((i) => i.id)).toEqual(['good']);
  });

  test('level cap stops a chain deeper than the limit', async () => {
    // A 10-deep chain (l0 → l1 → … → l9) climbed from the bottom.
    const universe = Array.from({ length: 10 }, (_, i) =>
      issue(`l${i}`, i === 9 ? null : `l${i + 1}`),
    );
    const fetchById = fetcherOver(universe);
    const got = await fetchAncestorChain({
      seedIds: ['l0'],
      known: new Set(['leaf']),
      fetchById,
    });
    // One id per level → exactly ANCESTOR_MAX_LEVELS rows, then stop.
    expect(got).toHaveLength(ANCESTOR_MAX_LEVELS);
    expect(fetchById).toHaveBeenCalledTimes(ANCESTOR_MAX_LEVELS);
  });

  test('explicit maxLevels is honoured', async () => {
    const universe = Array.from({ length: 5 }, (_, i) =>
      issue(`l${i}`, i === 4 ? null : `l${i + 1}`),
    );
    const got = await fetchAncestorChain({
      seedIds: ['l0'],
      known: new Set(),
      fetchById: fetcherOver(universe),
      maxLevels: 2,
    });
    expect(got.map((i) => i.id)).toEqual(['l0', 'l1']);
  });

  test('node cap bounds a wide page, keeping the branches nearest the top', async () => {
    const universe = Array.from({ length: 20 }, (_, i) => issue(`p${i}`));
    const fetchById = fetcherOver(universe);
    const got = await fetchAncestorChain({
      seedIds: universe.map((i) => i.id),
      known: new Set(),
      fetchById,
      maxNodes: 3,
    });
    expect(got.map((i) => i.id)).toEqual(['p0', 'p1', 'p2']);
    expect(fetchById).toHaveBeenCalledTimes(3);
  });

  test('a cycle in the dep graph terminates instead of climbing forever', async () => {
    // Broken data: a → b → a. Each id is marked visited before its
    // request, so the second hop back to `a` is never made.
    const fetchById = fetcherOver([issue('a', 'b'), issue('b', 'a')]);
    const got = await fetchAncestorChain({
      seedIds: ['a'],
      known: new Set(),
      fetchById,
    });
    expect(got.map((i) => i.id)).toEqual(['a', 'b']);
    expect(fetchById).toHaveBeenCalledTimes(2);
  });

  test('a self-referential parent is fetched once and goes nowhere', async () => {
    const fetchById = fetcherOver([issue('a', 'a')]);
    const got = await fetchAncestorChain({
      seedIds: ['a'],
      known: new Set(),
      fetchById,
    });
    expect(got.map((i) => i.id)).toEqual(['a']);
    expect(fetchById).toHaveBeenCalledTimes(1);
  });

  test('siblings sharing an off-page grandparent fetch it once', async () => {
    const universe = [issue('gp'), issue('m1', 'gp'), issue('m2', 'gp')];
    const fetchById = fetcherOver(universe);
    const got = await fetchAncestorChain({
      seedIds: ['m1', 'm2'],
      known: new Set(['c1', 'c2']),
      fetchById,
    });
    expect(got.map((i) => i.id)).toEqual(['m1', 'm2', 'gp']);
    expect(fetchById).toHaveBeenCalledTimes(3);
  });
});
