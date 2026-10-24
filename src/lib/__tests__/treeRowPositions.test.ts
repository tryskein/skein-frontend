/**
 * sk-285.2.13 — set size and position per tree row.
 *
 * The properties that live in the SHAPE of a row list, and can therefore
 * be asked of the function alone:
 *
 *   - siblings are the children of one parent, so two branches of the
 *     same depth are two sets, not one long level;
 *   - reference and context rows are numbered like any other row,
 *     because the arrow keys stop on them;
 *   - a list that is still a page short of the result set reports no
 *     size at all rather than a total about to change.
 *
 * Three neighbouring properties are deliberately NOT here, because a
 * pure call cannot fail on them — the mistakes they guard against are
 * mistakes about WHICH list is passed in, and any list produces
 * plausible numbers:
 *
 *   - "the numbers describe the tree, not the scrolled window" and "a
 *     row keeps its place after scrolling far" —
 *     `pages/shell/__tests__/TaskTreeVirtualList.test.tsx`;
 *   - "a collapsed branch is not counted, and opening it renumbers
 *     nothing" (the `visibleRows` / `flatRows` choice) —
 *     `pages/shell/__tests__/TasksTreeSetPositions.test.tsx`;
 *   - "the attributes reach the rendered row at all", hidden cross-project
 *     stubs included —
 *     `pages/shell/__tests__/TaskTreeVirtualList.keyboard.test.tsx`.
 */

import { describe, expect, test } from 'vitest';
import {
  computeTreeRowPositions,
  SET_SIZE_UNKNOWN,
} from '../treeRowPositions';
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

function row(id: string, depth: number, over: Partial<FlatTreeRow> = {}): FlatTreeRow {
  return {
    item: item(id),
    depth,
    edgeType: depth === 0 ? null : 'parent-child',
    isReference: false,
    firstSeenAt: null,
    isContext: false,
    hasChildren: false,
    ...over,
  };
}

/** Compact "pos/size" view of the result, for readable expectations. */
function pairs(rows: FlatTreeRow[]): string[] {
  return computeTreeRowPositions(rows).map((p) => `${p.posInSet}/${p.setSize}`);
}

describe('computeTreeRowPositions', () => {
  test('empty list produces no positions', () => {
    expect(computeTreeRowPositions([])).toEqual([]);
  });

  test('one position per row, positionally aligned with the input', () => {
    const rows = [row('a-1', 0), row('a-2', 0), row('a-3', 0)];
    expect(computeTreeRowPositions(rows)).toHaveLength(3);
  });

  test('flat roots form a single set numbered from one', () => {
    const rows = [row('a-1', 0), row('a-2', 0), row('a-3', 0)];
    expect(pairs(rows)).toEqual(['1/3', '2/3', '3/3']);
  });

  test('a nested branch numbers its children under their own parent', () => {
    //  a-1
    //    a-2
    //    a-3
    //  a-4
    const rows = [row('a-1', 0), row('a-2', 1), row('a-3', 1), row('a-4', 0)];
    expect(pairs(rows)).toEqual(['1/2', '1/2', '2/2', '2/2']);
  });

  test('two branches at the same depth are two sets, not one level', () => {
    //  a-1
    //    a-2
    //    a-3
    //    a-4
    //  b-1
    //    b-2
    const rows = [
      row('a-1', 0),
      row('a-2', 1),
      row('a-3', 1),
      row('a-4', 1),
      row('b-1', 0),
      row('b-2', 1),
    ];
    // a's children count to three; b's single child is 1 of 1 — never
    // "4 of 4" in a level-wide run.
    expect(pairs(rows)).toEqual(['1/2', '1/3', '2/3', '3/3', '2/2', '1/1']);
  });

  test('grandchildren belong to their own parent, not to the root set', () => {
    //  a-1
    //    a-2
    //      a-3
    //      a-4
    const rows = [row('a-1', 0), row('a-2', 1), row('a-3', 2), row('a-4', 2)];
    expect(pairs(rows)).toEqual(['1/1', '1/1', '1/2', '2/2']);
  });

  test('a reference row is numbered like any other sibling', () => {
    //  a-1
    //    a-2
    //    a-3  (cycle pointer back to a-1)
    const rows = [
      row('a-1', 0, { hasChildren: true }),
      row('a-2', 1),
      row('a-3', 1, { isReference: true, firstSeenAt: 'a-1' }),
    ];
    expect(pairs(rows)).toEqual(['1/1', '1/2', '2/2']);
  });

  test('a context row is numbered like any other sibling', () => {
    //  a-1 (context scaffolding, permanently open)
    //    a-2
    //    a-3
    const rows = [
      row('a-1', 0, { isContext: true, hasChildren: true }),
      row('a-2', 1),
      row('a-3', 1),
    ];
    expect(pairs(rows)).toEqual(['1/1', '1/2', '2/2']);
  });

  test('a context row nested among real siblings counts inside the set', () => {
    const rows = [
      row('a-1', 0, { hasChildren: true }),
      row('a-2', 1),
      row('a-ctx', 1, { isContext: true }),
      row('a-3', 1),
    ];
    expect(pairs(rows)).toEqual(['1/1', '1/3', '2/3', '3/3']);
  });

  test('a skipped level still resolves to the nearest shallower ancestor', () => {
    // Malformed input (depth 0 → 2). It must degrade to a real parent
    // rather than reading an empty depth slot.
    const rows = [row('a-1', 0, { hasChildren: true }), row('a-2', 2), row('a-3', 2)];
    expect(pairs(rows)).toEqual(['1/1', '1/2', '2/2']);
  });

  test('a leading orphan row is treated as a root', () => {
    // No preceding shallower row exists, so it joins the root set.
    const rows = [row('a-1', 1), row('a-2', 0)];
    expect(pairs(rows)).toEqual(['1/2', '2/2']);
  });

  test('an unfinished list reports no size at all, at every depth', () => {
    // The rows are a page of a paginated result: the next page can bring
    // a sibling for ANY of these parents, so no set here is closed —
    // not the roots, not the branch under a-1.
    const rows = [
      row('a-1', 0, { hasChildren: true }),
      row('a-2', 1),
      row('a-3', 1),
      row('a-4', 0),
    ];
    const partial = computeTreeRowPositions(rows, { complete: false });
    expect(partial.map((p) => p.setSize)).toEqual([
      SET_SIZE_UNKNOWN,
      SET_SIZE_UNKNOWN,
      SET_SIZE_UNKNOWN,
      SET_SIZE_UNKNOWN,
    ]);
    // The place is still known and still handed out — only the total
    // behind it is withheld.
    expect(partial.map((p) => p.posInSet)).toEqual(
      computeTreeRowPositions(rows).map((p) => p.posInSet),
    );
  });

  test('the sizes come back as soon as the last page has arrived', () => {
    const rows = [row('a-1', 0, { hasChildren: true }), row('a-2', 1)];
    // Explicit and default agree: not paginated is the same statement as
    // "the whole set is here".
    expect(computeTreeRowPositions(rows, { complete: true })).toEqual(
      computeTreeRowPositions(rows),
    );
    expect(pairs(rows)).toEqual(['1/1', '1/1']);
  });
});
