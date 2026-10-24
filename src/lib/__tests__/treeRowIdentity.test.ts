/**
 * sk-285.2.10 — row identity under virtualization.
 *
 * Two properties the virtualized list depends on, neither of which the
 * component test can show directly:
 *
 *   - keys are unique even where the visual tuple repeats (a multi-parent
 *     issue rendered canonically once and as a pointer row twice), because
 *     the virtualizer stores one measured height per key;
 *   - keys are STABLE when the list changes elsewhere, because a renamed
 *     key discards that measurement and the rows below it jump.
 *
 * Plus the id → index lookup that the scroll contract is built on.
 */

import { describe, expect, test } from 'vitest';
import { buildTreeRowKeys, treeRowIndexById } from '../treeRowIdentity';
import type { FlatTreeRow } from '../flattenTree';
import type { IssueSummary } from '../../api/issues';

function item(id: string): IssueSummary {
  return {
    id,
    projectId: 'proj-1',
    version: 1,
    title: `title ${id}`,
    type: 'task',
    priority: 2,
    status: 'open',
    pinned: false,
    assignee: null,
    parentIdCurrent: null,
    componentIds: [],
    labels: [],
    isBlocked: false,
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
  };
}

function row(id: string, over: Partial<FlatTreeRow> = {}): FlatTreeRow {
  return {
    item: item(id),
    depth: 0,
    edgeType: null,
    isReference: false,
    firstSeenAt: null,
    isContext: false,
    hasChildren: false,
    ...over,
  };
}

describe('buildTreeRowKeys', () => {
  test('one key per row, positionally aligned with the input', () => {
    const rows = [row('a-1'), row('a-2'), row('a-3')];
    expect(buildTreeRowKeys(rows)).toHaveLength(3);
  });

  test('rows sharing the whole visual tuple still get distinct keys', () => {
    // The case the old index-suffixed key existed for: the SAME issue as a
    // pointer row under two different parents, at the same depth, via the
    // same edge type. Nothing in the tuple tells them apart.
    const ref = { depth: 1, edgeType: 'parent-child', isReference: true } as const;
    const rows = [
      row('a-1'),
      row('a-9', { ...ref, firstSeenAt: 'a-1' }),
      row('a-2'),
      row('a-9', { ...ref, firstSeenAt: 'a-1' }),
    ];
    const keys = buildTreeRowKeys(rows);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test('the canonical row and a pointer row to it never share a key', () => {
    const keys = buildTreeRowKeys([
      row('a-9', { depth: 1, edgeType: 'parent-child' }),
      row('a-9', { depth: 1, edgeType: 'parent-child', isReference: true }),
    ]);
    expect(keys[0]).not.toBe(keys[1]);
  });

  test('collapsing a subtree above a row leaves that row’s key untouched', () => {
    // What the array index could not do. `a-1` is expanded in the first
    // list and collapsed in the second, so every row after it shifts
    // position — but their identity did not change and neither may their
    // keys, or the virtualizer throws away their measured heights.
    const expandedList = [
      row('a-1', { hasChildren: true }),
      row('a-1.1', { depth: 1, edgeType: 'parent-child' }),
      row('a-1.2', { depth: 1, edgeType: 'parent-child' }),
      row('a-2'),
      row('a-3'),
    ];
    const collapsedList = [
      row('a-1', { hasChildren: true }),
      row('a-2'),
      row('a-3'),
    ];
    const before = buildTreeRowKeys(expandedList);
    const after = buildTreeRowKeys(collapsedList);
    expect(after[1]).toBe(before[3]); // a-2
    expect(after[2]).toBe(before[4]); // a-3
  });
});

describe('treeRowIndexById', () => {
  test('finds the row showing the issue', () => {
    const rows = [row('a-1'), row('a-2'), row('a-3')];
    expect(treeRowIndexById(rows, 'a-2')).toBe(1);
  });

  test('answers -1 for an issue no row shows', () => {
    expect(treeRowIndexById([row('a-1')], 'a-7')).toBe(-1);
  });

  test('prefers the canonical row over a pointer row that precedes it', () => {
    const rows = [
      row('a-9', { depth: 1, edgeType: 'parent-child', isReference: true }),
      row('a-2'),
      row('a-9', { depth: 1, edgeType: 'parent-child' }),
    ];
    expect(treeRowIndexById(rows, 'a-9')).toBe(2);
  });

  test('falls back to a pointer row when no canonical row is on screen', () => {
    const rows = [
      row('a-2'),
      row('a-9', { depth: 1, edgeType: 'parent-child', isReference: true }),
    ];
    expect(treeRowIndexById(rows, 'a-9')).toBe(1);
  });

  test('an empty list resolves nothing rather than throwing', () => {
    expect(treeRowIndexById([], 'a-1')).toBe(-1);
  });
});
