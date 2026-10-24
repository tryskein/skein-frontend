/**
 * F7 smoke tests for `buildIssueTree` (F4).
 *
 * The Tasks-column tree groups a flat issue list by `parentIdCurrent`.
 * Roots are issues whose `parentIdCurrent` is null OR whose parent
 * isn't in the fetched set ("orphans" — surfaced at root rather than
 * dropped). The optional comparator orders siblings at every level.
 *
 * sk-35 renamed the wire field from `parentId` to `parentIdCurrent` to
 * signal that it's derived from the dep graph at SELECT time rather
 * than stored on the issues row.
 */

import { describe, expect, test } from 'vitest';
import type { IssueSummary } from '../../api/issues';
import { buildIssueTree, type TreeComparator } from '../buildIssueTree';

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

describe('buildIssueTree', () => {
  test('empty list → empty forest', () => {
    expect(buildIssueTree([])).toEqual([]);
  });

  test('flat list with no parents → all at root', () => {
    const items = [issue('a'), issue('b'), issue('c')];
    const forest = buildIssueTree(items);
    expect(forest).toHaveLength(3);
    expect(forest.every((n) => n.children.length === 0)).toBe(true);
    expect(forest.map((n) => n.item.id)).toEqual(['a', 'b', 'c']);
  });

  test('two-level tree: child nests under parent', () => {
    const items = [issue('a'), issue('b', 'a')];
    const forest = buildIssueTree(items);
    expect(forest).toHaveLength(1);
    expect(forest[0].item.id).toBe('a');
    expect(forest[0].children).toHaveLength(1);
    expect(forest[0].children[0].item.id).toBe('b');
  });

  test('three-level tree (grandparent → parent → child)', () => {
    const items = [issue('a'), issue('b', 'a'), issue('c', 'b')];
    const forest = buildIssueTree(items);
    expect(forest).toHaveLength(1);
    expect(forest[0].item.id).toBe('a');
    expect(forest[0].children).toHaveLength(1);
    expect(forest[0].children[0].item.id).toBe('b');
    expect(forest[0].children[0].children).toHaveLength(1);
    expect(forest[0].children[0].children[0].item.id).toBe('c');
  });

  test('orphan child (parent not in result) surfaces at root', () => {
    // 'b' has parentIdCurrent='ghost' which is not in the input — must
    // NOT be dropped, must appear at root level alongside 'a'.
    const items = [issue('a'), issue('b', 'ghost')];
    const forest = buildIssueTree(items);
    expect(forest.map((n) => n.item.id).sort()).toEqual(['a', 'b']);
    // 'b' is at root with no children of its own.
    const b = forest.find((n) => n.item.id === 'b');
    expect(b?.children).toEqual([]);
  });

  test('mixed orphans + real roots — original order preserved without comparator', () => {
    // Order in input: a (root), b (orphan), c (root), d (child of a).
    // Without a comparator, buckets preserve insertion order.
    const items = [
      issue('a'),
      issue('b', 'ghost'),
      issue('c'),
      issue('d', 'a'),
    ];
    const forest = buildIssueTree(items);
    expect(forest.map((n) => n.item.id)).toEqual(['a', 'b', 'c']);
    const a = forest.find((n) => n.item.id === 'a');
    expect(a?.children.map((n) => n.item.id)).toEqual(['d']);
  });

  test('comparator (priority+updated) applies at every level consistently', () => {
    // Priority ASC, updated DESC — the default Tasks-column sort (Q30).
    const compare: TreeComparator = (a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return b.updatedAt.localeCompare(a.updatedAt);
    };

    const items = [
      issue('a', null, { priority: 3 }),
      issue('b', null, { priority: 1 }),
      issue('c', null, { priority: 2 }),
      issue('child-low', 'b', { priority: 5 }),
      issue('child-high', 'b', { priority: 1 }),
    ];

    const forest = buildIssueTree(items, compare);
    // Roots ordered: b (P1), c (P2), a (P3).
    expect(forest.map((n) => n.item.id)).toEqual(['b', 'c', 'a']);
    // b's children: child-high (P1) before child-low (P5).
    const b = forest.find((n) => n.item.id === 'b');
    expect(b?.children.map((n) => n.item.id)).toEqual(['child-high', 'child-low']);
  });

  test('comparator with equal priority falls back to secondary key (updated DESC)', () => {
    const compare: TreeComparator = (a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return b.updatedAt.localeCompare(a.updatedAt);
    };

    const items = [
      issue('older', null, { priority: 2, updatedAt: '2026-01-01T00:00:00Z' }),
      issue('newer', null, { priority: 2, updatedAt: '2026-05-01T00:00:00Z' }),
    ];

    const forest = buildIssueTree(items, compare);
    expect(forest.map((n) => n.item.id)).toEqual(['newer', 'older']);
  });

  test('context ids are flagged on their nodes, everything else is not', () => {
    // `mid` was backfilled (sk-285.2.7) so `c` could nest under it.
    const items = [issue('c', 'mid'), issue('mid', null)];
    const forest = buildIssueTree(items, undefined, new Set(['mid']));
    expect(forest.map((n) => n.item.id)).toEqual(['mid']);
    expect(forest[0].isContext).toBe(true);
    expect(forest[0].children[0].item.id).toBe('c');
    expect(forest[0].children[0].isContext).toBe(false);
  });

  test('without contextIds every node reports isContext false', () => {
    const forest = buildIssueTree([issue('a'), issue('b', 'a')]);
    expect(forest[0].isContext).toBe(false);
    expect(forest[0].children[0].isContext).toBe(false);
  });

  test('a context node with nothing under it is dropped', () => {
    // Held-over backfill from a previous page: `stale` no longer holds
    // any row that passed the filter, so it must not parade at the root.
    const items = [issue('a'), issue('stale', null)];
    const forest = buildIssueTree(items, undefined, new Set(['stale']));
    expect(forest.map((n) => n.item.id)).toEqual(['a']);
  });

  test('a context chain whose only leaf is context collapses entirely', () => {
    // root(ctx) → mid(ctx) → nothing real: the whole scaffold goes.
    const items = [issue('root'), issue('mid', 'root'), issue('real')];
    const forest = buildIssueTree(items, undefined, new Set(['root', 'mid']));
    expect(forest.map((n) => n.item.id)).toEqual(['real']);
  });

  test('a context ancestor two levels up survives because a real row hangs below', () => {
    const items = [issue('root'), issue('mid', 'root'), issue('c', 'mid')];
    const forest = buildIssueTree(items, undefined, new Set(['root', 'mid']));
    expect(forest.map((n) => n.item.id)).toEqual(['root']);
    expect(forest[0].children.map((n) => n.item.id)).toEqual(['mid']);
    expect(forest[0].children[0].children.map((n) => n.item.id)).toEqual(['c']);
  });

  test('parentIdCurrent === null and parentIdCurrent === undefined both treated as root', () => {
    const items: IssueSummary[] = [
      issue('a', null),
      { ...issue('b'), parentIdCurrent: undefined },
    ];
    const forest = buildIssueTree(items);
    expect(forest).toHaveLength(2);
    expect(forest.map((n) => n.item.id).sort()).toEqual(['a', 'b']);
  });
});
