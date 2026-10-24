/**
 * sk-36 — `flattenTree` adapter tests. The legacy nested
 * `buildIssueTree` output is the only source for the fast-path render
 * (parent-child only); this adapter turns that nested structure into
 * the new flat-row shape `TaskTreeNode` now consumes.
 */

import { describe, expect, test } from 'vitest';
import type {
  IssueStatus,
  IssueSummary,
  IssueTreeNode as WireIssueTreeNode,
  TreeBlockerRef,
} from '../../api/issues';
import { buildIssueTree, type IssueTreeNode } from '../buildIssueTree';
import {
  countCollapsed,
  flattenTree,
  layeredToFlatRows,
  partitionStandingTreeRows,
  type FlatTreeRow,
} from '../flattenTree';

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

describe('flattenTree', () => {
  test('empty nested forest → empty flat list', () => {
    expect(flattenTree([])).toEqual([]);
  });

  test('flat list (all roots) → all rows at depth 0', () => {
    const items = [issue('a'), issue('b'), issue('c')];
    const nested = buildIssueTree(items);
    const flat = flattenTree(nested);
    expect(flat).toHaveLength(3);
    expect(flat.every((r) => r.depth === 0)).toBe(true);
    expect(flat.every((r) => r.edgeType === null)).toBe(true);
    expect(flat.every((r) => r.hasChildren === false)).toBe(true);
    expect(flat.every((r) => r.isReference === false)).toBe(true);
  });

  test('two-level tree → root at depth 0, child at depth 1 with parent-child edge', () => {
    const nested = buildIssueTree([issue('a'), issue('b', 'a')]);
    const flat = flattenTree(nested);
    expect(flat).toHaveLength(2);
    expect(flat[0].item.id).toBe('a');
    expect(flat[0].depth).toBe(0);
    expect(flat[0].edgeType).toBeNull();
    expect(flat[0].hasChildren).toBe(true);
    expect(flat[1].item.id).toBe('b');
    expect(flat[1].depth).toBe(1);
    expect(flat[1].edgeType).toBe('parent-child');
    expect(flat[1].hasChildren).toBe(false);
  });

  test('three-level tree preserves DFS order', () => {
    const nested = buildIssueTree([issue('a'), issue('b', 'a'), issue('c', 'b')]);
    const flat = flattenTree(nested);
    expect(flat.map((r) => r.item.id)).toEqual(['a', 'b', 'c']);
    expect(flat.map((r) => r.depth)).toEqual([0, 1, 2]);
  });

  test('context flag survives the flatten — it is the row-level marker', () => {
    // sk-285.2.7: `mid` is a backfilled parent, `c` passed the filter.
    const nested = buildIssueTree(
      [issue('c', 'mid'), issue('mid')],
      undefined,
      new Set(['mid']),
    );
    const flat = flattenTree(nested);
    expect(flat.map((r) => [r.item.id, r.isContext])).toEqual([
      ['mid', true],
      ['c', false],
    ]);
  });

  test('rows are not context by default', () => {
    const flat = flattenTree(buildIssueTree([issue('a'), issue('b', 'a')]));
    expect(flat.every((r) => r.isContext === false)).toBe(true);
  });

  test('directly accepts nested IssueTreeNode without going through buildIssueTree', () => {
    const a = issue('a');
    const b = issue('b', 'a');
    const nested: IssueTreeNode[] = [
      {
        item: a,
        children: [{ item: b, children: [], isContext: false }],
        isContext: false,
      },
    ];
    const flat = flattenTree(nested);
    expect(flat).toHaveLength(2);
    expect(flat[0].hasChildren).toBe(true);
    expect(flat[1].hasChildren).toBe(false);
  });
});

/**
 * sk-103 — `countCollapsed` powers the Tasks header "N · M collapsed"
 * chip in Tree view: M = real loaded issues hidden under a collapsed
 * ancestor. Reference rows (cycle / dup stubs) are excluded on both
 * sides so they never inflate the gap.
 */

// Mirror of the inline collapse pass in TasksColumn.tsx::visibleRows —
// a forward DFS that suppresses rows beneath a collapsed ancestor. Used
// here to produce realistic flat/visible pairs for the helper under test.
function applyCollapse(
  flat: FlatTreeRow[],
  expanded: Set<string>,
): FlatTreeRow[] {
  const out: FlatTreeRow[] = [];
  let collapsedDepth = -1;
  for (const r of flat) {
    if (collapsedDepth >= 0 && r.depth > collapsedDepth) continue;
    if (collapsedDepth >= 0 && r.depth <= collapsedDepth) collapsedDepth = -1;
    out.push(r);
    if (r.hasChildren && !r.isReference && !expanded.has(r.item.id)) {
      collapsedDepth = r.depth;
    }
  }
  return out;
}

describe('countCollapsed', () => {
  test('cards view (empty flat list) → 0', () => {
    expect(countCollapsed([], [])).toBe(0);
  });

  test('all rows visible (everything expanded) → 0', () => {
    const flat = flattenTree(
      buildIssueTree([issue('a'), issue('b', 'a'), issue('c', 'b')]),
    );
    const visible = applyCollapse(flat, new Set(['a', 'b']));
    expect(visible).toHaveLength(3);
    expect(countCollapsed(flat, visible)).toBe(0);
  });

  test('collapsed parent hides its whole subtree → M = hidden descendants', () => {
    // a → b → c, plus a sibling root d. Collapse `a` (and leave b/c
    // unexpanded): only a and d remain visible; b and c are hidden.
    const flat = flattenTree(
      buildIssueTree([
        issue('a'),
        issue('b', 'a'),
        issue('c', 'b'),
        issue('d'),
      ]),
    );
    const visible = applyCollapse(flat, new Set());
    expect(visible.map((r) => r.item.id)).toEqual(['a', 'd']);
    expect(countCollapsed(flat, visible)).toBe(2);
  });

  test('context rows are excluded from the hidden count', () => {
    // sk-285.2.7 — a backfilled parent is not one of the loaded issues,
    // so hiding it must not inflate "M collapsed". Here `ctx` holds one
    // real child `b`; collapsing the real root `a` hides both, and only
    // `b` counts.
    const flat = flattenTree(
      buildIssueTree(
        [issue('a'), issue('ctx', 'a'), issue('b', 'ctx')],
        undefined,
        new Set(['ctx']),
      ),
    );
    expect(flat).toHaveLength(3);
    const visible = flat.slice(0, 1); // only `a` on screen
    expect(countCollapsed(flat, visible)).toBe(1);
  });

  test('reference rows are excluded from the hidden count', () => {
    // Hand-built flat list: collapsed root `a` hides one real child `b`
    // and one reference stub `b-ref`. Only the real child counts.
    const a: FlatTreeRow = {
      item: issue('a'),
      depth: 0,
      edgeType: null,
      isReference: false,
      isContext: false,
      firstSeenAt: null,
      hasChildren: true,
    };
    const b: FlatTreeRow = {
      item: issue('b', 'a'),
      depth: 1,
      edgeType: 'parent-child',
      isReference: false,
      isContext: false,
      firstSeenAt: null,
      hasChildren: false,
    };
    const bRef: FlatTreeRow = {
      item: issue('b', 'a'),
      depth: 1,
      edgeType: 'related',
      isReference: true,
      isContext: false,
      firstSeenAt: 'a',
      hasChildren: false,
    };
    const flat = [a, b, bRef];
    const visible = [a]; // `a` collapsed → both children suppressed
    // b is hidden+real (counts), bRef is hidden+reference (excluded).
    expect(countCollapsed(flat, visible)).toBe(1);
  });
});

/**
 * sk-135 (decision #6, §11.12) — the MANDATORY top band must hold in TREE
 * view too, not only Cards. `partitionStandingTreeRows` floats ROOT-level
 * standing subtrees to the front of the already-flattened DFS row list,
 * keeping each subtree intact and nested. Standing tasks nested under a
 * NORMAL parent stay in place (only depth-0 standing roots float).
 */

function issueS(
  id: string,
  status: IssueStatus,
  parentIdCurrent: string | null = null,
  overrides: Partial<IssueSummary> = {},
): IssueSummary {
  return issue(id, parentIdCurrent, { status, ...overrides });
}

describe('partitionStandingTreeRows — sk-135 tree top band', () => {
  test('empty list → returned unchanged', () => {
    const rows: FlatTreeRow[] = [];
    expect(partitionStandingTreeRows(rows)).toBe(rows);
  });

  test('no standing root → identity (same reference, no reorder)', () => {
    const rows = flattenTree(buildIssueTree([issue('a'), issue('b')]));
    expect(partitionStandingTreeRows(rows)).toBe(rows);
  });

  /**
   * sk-421.2 T013 — rows are built DIRECTLY, not through
   * `flattenTree(buildIssueTree(...))`, like the neighbouring tests: `buildIssueTree`
   * accepts `IssueSummary[]` with closed unions and will not let an empty status
   * in. The inaccessible row does not come from there either — the tree
   * response supplies it — so direct assembly is more honest here than bypassing the type.
   */
  function treeRow(
    item: FlatTreeRow['item'],
    over: Partial<FlatTreeRow> = {},
  ): FlatTreeRow {
    return {
      item,
      depth: 0,
      edgeType: null,
      isReference: false,
      firstSeenAt: null,
      isContext: false,
      hasChildren: false,
      ...over,
    };
  }

  test('F-4 (sorting): an empty status is not read as "standing" — identity', () => {
    // The only place on the sorting path that reads the status is
    // this function (`item.status === 'standing'`). With an empty status
    // there is no match, the standing band does not appear, and the list
    // is returned as the SAME array.
    const hidden: FlatTreeRow['item'] = {
      ...issue('h-1'),
      status: '',
      type: '',
    };
    const rows = [treeRow(issue('n-1')), treeRow(hidden)];
    expect(partitionStandingTreeRows(rows)).toBe(rows);
  });

  test('F-4 (sorting): next to a real standing one an empty status does not float up', () => {
    // A positive control inside one test: a real standing
    // row rises to the top, while the row with an empty status stays in
    // the common band, keeping its order relative to an ordinary one.
    const hidden: FlatTreeRow['item'] = {
      ...issue('h-1'),
      status: '',
      type: '',
    };
    const rows = [
      treeRow(issue('n-1')),
      treeRow(hidden),
      treeRow(issueS('s-1', 'standing')),
    ];
    expect(partitionStandingTreeRows(rows).map((r) => r.item.id)).toEqual([
      's-1',
      'n-1',
      'h-1',
    ]);
  });

  test('older standing root floats above a fresher normal root', () => {
    // Repro of the bug: fresh normal root sorted ABOVE an older standing
    // root by the "Updated" sort; the band must put standing first.
    const normalFresh = issueS('n-1', 'open', null, {
      updatedAt: '2026-06-22T10:16:00Z',
    });
    const standingOld = issueS('s-1', 'standing', null, {
      updatedAt: '2026-06-22T09:33:00Z',
    });
    // Incoming order = the "Updated DESC" sort: fresh normal first.
    const rows = flattenTree(buildIssueTree([normalFresh, standingOld]));
    expect(rows.map((r) => r.item.id)).toEqual(['n-1', 's-1']);
    const out = partitionStandingTreeRows(rows);
    expect(out.map((r) => r.item.id)).toEqual(['s-1', 'n-1']);
  });

  test('standing root floats as a UNIT with its whole subtree intact', () => {
    // s-1 (standing) has children c-1, c-2; n-1 is a fresher normal root.
    const rows = flattenTree(
      buildIssueTree([
        issueS('n-1', 'open', null, { updatedAt: '2026-06-22T10:16:00Z' }),
        issueS('s-1', 'standing', null, { updatedAt: '2026-06-22T09:33:00Z' }),
        issueS('c-1', 'open', 's-1'),
        issueS('c-2', 'open', 's-1'),
      ]),
    );
    const out = partitionStandingTreeRows(rows);
    // Standing subtree comes first, contiguous, with depths preserved.
    expect(out.map((r) => r.item.id)).toEqual(['s-1', 'c-1', 'c-2', 'n-1']);
    expect(out.map((r) => r.depth)).toEqual([0, 1, 1, 0]);
  });

  test('multiple standing roots ordered by priority ASC then recency DESC', () => {
    const rows = flattenTree(
      buildIssueTree([
        issueS('plain', 'open', null, { priority: 0 }),
        issueS('s-low', 'standing', null, {
          priority: 4,
          updatedAt: '2026-06-10T00:00:00Z',
        }),
        issueS('s-hi-old', 'standing', null, {
          priority: 0,
          updatedAt: '2026-06-01T00:00:00Z',
        }),
        issueS('s-hi-new', 'standing', null, {
          priority: 0,
          updatedAt: '2026-06-09T00:00:00Z',
        }),
      ]),
    );
    const out = partitionStandingTreeRows(rows);
    // P0 newest, P0 older, P4 — then the plain root. Matches Cards'
    // partitionStanding intra-band ranking exactly.
    expect(out.map((r) => r.item.id)).toEqual([
      's-hi-new',
      's-hi-old',
      's-low',
      'plain',
    ]);
  });

  test('standing nested under a NORMAL parent stays in place (only roots float)', () => {
    // n-1 (normal root) → s-child (standing, depth 1). The standing child
    // must NOT be yanked to the front — that would break the tree.
    const rows = flattenTree(
      buildIssueTree([
        issueS('n-1', 'open'),
        issueS('s-child', 'standing', 'n-1'),
        issueS('n-2', 'open'),
      ]),
    );
    const out = partitionStandingTreeRows(rows);
    // No root is standing → identity; the standing child stays nested.
    expect(out.map((r) => r.item.id)).toEqual(['n-1', 's-child', 'n-2']);
    expect(out.map((r) => r.depth)).toEqual([0, 1, 0]);
  });

  test('does not mutate the input array', () => {
    const rows = flattenTree(
      buildIssueTree([issue('n-1'), issueS('s-1', 'standing')]),
    );
    const snapshot = rows.map((r) => r.item.id);
    partitionStandingTreeRows(rows);
    expect(rows.map((r) => r.item.id)).toEqual(snapshot);
  });
});

// ─────────────── sk-421.2.8 — row 27: carrying the blockers field ───────────────
//
// FOR-PLAN round 1 m-7, US-1 "the same in the modes, at any tree level":
// the "Tree" mode gets rows through `layeredToFlatRows`, which copies
// the node fields by name. A field not carried over there will not reach the row.
// Checked with data, not by reading the source (the file is in the mutation slice).

describe('layeredToFlatRows — sk-421.2.8 carrying blockers over (row 27)', () => {
  function wireNode(
    depth: number,
    id: string,
    blockers?: TreeBlockerRef[],
  ): WireIssueTreeNode {
    const n: WireIssueTreeNode = {
      item: issue(id, null, { isBlocked: blockers !== undefined }),
      depth,
      parentRef: depth === 0 ? null : { id: 'e-1', edgeType: 'parent-child' },
      isReference: false,
      firstSeenAt: null,
    };
    if (blockers !== undefined) n.blockers = blockers;
    return n;
  }

  // All three forms of the record, in server order: visible, then hidden.
  const ROOT_BLOCKERS: TreeBlockerRef[] = [
    { id: 'p-2', title: 'Blocker p-2', status: 'in_progress', projectId: 'p1' },
    { id: 'p-9', title: 'Blocker p-9', status: 'open', projectId: 'p1' },
    { id: 'q-1', redacted: true },
    { redacted: true },
  ];
  const DEEP_BLOCKERS: TreeBlockerRef[] = [
    { id: 'x-7', title: 'Other project blocker', status: 'deferred', projectId: 'p2' },
    { redacted: true },
  ];

  const WIRE: WireIssueTreeNode[] = [
    wireNode(0, 'e-1', ROOT_BLOCKERS),
    wireNode(1, 'e-1.1'),
    wireNode(2, 'e-1.1.1', DEEP_BLOCKERS),
    wireNode(1, 'e-1.2'),
  ];

  test('nodes at depth 0 and 2 with blockers → the rows have the same array (order and content)', () => {
    const rows = layeredToFlatRows(WIRE);
    expect(rows.map((r) => [r.item.id, r.depth])).toEqual([
      ['e-1', 0],
      ['e-1.1', 1],
      ['e-1.1.1', 2],
      ['e-1.2', 1],
    ]);
    expect(rows[0].blockers).toEqual([
      { id: 'p-2', title: 'Blocker p-2', status: 'in_progress', projectId: 'p1' },
      { id: 'p-9', title: 'Blocker p-9', status: 'open', projectId: 'p1' },
      { id: 'q-1', redacted: true },
      { redacted: true },
    ]);
    expect(rows[2].blockers).toEqual([
      { id: 'x-7', title: 'Other project blocker', status: 'deferred', projectId: 'p2' },
      { redacted: true },
    ]);
  });

  test('a node without the field → the row has the field undefined, not []', () => {
    const rows = layeredToFlatRows(WIRE);
    expect(rows[1].blockers).toBeUndefined();
    expect(rows[3].blockers).toBeUndefined();
  });

  test('an empty list on a node is carried over empty, not lost', () => {
    const rows = layeredToFlatRows([wireNode(0, 'e-1', [])]);
    expect(rows[0].blockers).toEqual([]);
  });

  test('carrying the field over does not shift the other row fields', () => {
    const rows = layeredToFlatRows(WIRE);
    expect(rows[0]).toMatchObject({
      depth: 0,
      edgeType: null,
      isReference: false,
      firstSeenAt: null,
      isContext: false,
      hasChildren: true,
    });
    expect(rows[2]).toMatchObject({
      depth: 2,
      edgeType: 'parent-child',
      hasChildren: false,
    });
  });

  test('the legacy flattenTree does not set the blockers field', () => {
    const rows = flattenTree(
      buildIssueTree([issue('a', null, { isBlocked: true }), issue('b', 'a', { isBlocked: true })]),
    );
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.blockers).toBeUndefined();
      expect(Object.prototype.hasOwnProperty.call(r, 'blockers')).toBe(false);
    }
  });
});
