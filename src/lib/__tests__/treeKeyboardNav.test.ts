/**
 * sk-285.2.11 — the WAI-ARIA APG keyboard contract for the Tasks tree,
 * rule by rule.
 *
 * The task states thirteen rules and this file states them back as
 * thirteen assertions against `resolveTreeKey` / `resolveTypeahead`: the
 * resolver IS the contract, so a rule that is not pinned here is a rule
 * nothing stops the next change from quietly dropping. What the renderer
 * does with the resolved action (move DOM focus, scroll a virtualized row
 * into existence, toggle, select) is pinned separately in
 * `pages/shell/__tests__/TaskTreeVirtualList.keyboard.test.tsx`.
 *
 * The fixture is the row list AS RENDERED — post-collapse, pre-order DFS,
 * exactly what `visibleRows` hands the list:
 *
 *   0  Alpha     depth 0, parent, OPEN
 *   1    Beta    depth 1, parent, closed
 *   2    Bravo   depth 1, parent, closed
 *   3    Gamma   depth 1, leaf
 *   4  Delta     depth 0, leaf
 *   5  Epsilon   depth 0, parent, closed
 *
 * Beta's and Bravo's own children are absent because both are closed —
 * that is the property that makes Up/Down a ±1 walk and «first child» a
 * single lookahead.
 */

import { describe, expect, test } from 'vitest';

import {
  isExpandableRow,
  isOpenRow,
  resolveTreeKey,
  resolveTypeahead,
} from '../treeKeyboardNav';
import type { FlatTreeRow } from '../flattenTree';
import type { IssueSummary } from '../../api/issues';

function item(id: string, title: string): IssueSummary {
  return {
    id,
    projectId: 'proj-1',
    version: 1,
    title,
    type: 'task',
    priority: 2,
    status: 'open',
    pinned: false,
    assignee: null,
    componentIds: [],
    labels: [],
    isBlocked: false,
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
  };
}

function row(
  id: string,
  title: string,
  depth: number,
  extra: Partial<FlatTreeRow> = {},
): FlatTreeRow {
  return {
    item: item(id, title),
    depth,
    edgeType: depth === 0 ? null : 'parent-child',
    isReference: false,
    firstSeenAt: null,
    isContext: false,
    hasChildren: false,
    ...extra,
  };
}

const ROWS: FlatTreeRow[] = [
  row('demo-1', 'Alpha', 0, { hasChildren: true }),
  row('demo-1.1', 'Beta', 1, { hasChildren: true }),
  row('demo-1.2', 'Bravo', 1, { hasChildren: true }),
  row('demo-1.3', 'Gamma', 1),
  row('demo-2', 'Delta', 0),
  row('demo-3', 'Epsilon', 0, { hasChildren: true }),
];

/** Only Alpha is open — which is why its three children are on screen. */
const EXPANDED = new Set(['demo-1']);

function key(k: string, index: number, expanded: ReadonlySet<string> = EXPANDED) {
  return resolveTreeKey(k, { rows: ROWS, index, expanded });
}

describe('sk-285.2.11 — Right arrow', () => {
  test('on a CLOSED node: opens it and leaves focus where it is', () => {
    // The action names a toggle, not a focus move — that is the "focus
    // does NOT move" half of the rule.
    expect(key('ArrowRight', 1)).toEqual({ kind: 'expand', id: 'demo-1.1' });
  });

  test('on an OPEN node: moves focus to the first child', () => {
    expect(key('ArrowRight', 0)).toEqual({ kind: 'focus', index: 1 });
  });

  test('on a leaf: does nothing', () => {
    expect(key('ArrowRight', 3)).toEqual({ kind: 'none' });
    expect(key('ArrowRight', 4)).toEqual({ kind: 'none' });
  });

  test('on an open node whose children are not below it: does nothing', () => {
    // A row marked open + hasChildren but whose subtree is not in the
    // list (the layered path can prune it) must not "descend" onto its
    // next SIBLING, which is what an unguarded index+1 would do.
    const rows = [row('demo-9', 'Solo', 0, { hasChildren: true }), row('demo-10', 'Next', 0)];
    expect(
      resolveTreeKey('ArrowRight', {
        rows,
        index: 0,
        expanded: new Set(['demo-9']),
      }),
    ).toEqual({ kind: 'none' });
  });
});

describe('sk-285.2.11 — Left arrow', () => {
  test('on an OPEN node: collapses it', () => {
    expect(key('ArrowLeft', 0)).toEqual({ kind: 'collapse', id: 'demo-1' });
  });

  test('on a CLOSED node or a leaf: moves focus to the parent', () => {
    expect(key('ArrowLeft', 1)).toEqual({ kind: 'focus', index: 0 }); // closed
    expect(key('ArrowLeft', 3)).toEqual({ kind: 'focus', index: 0 }); // leaf
  });

  test('on a root that is closed, or a root leaf: does nothing', () => {
    expect(key('ArrowLeft', 5)).toEqual({ kind: 'none' }); // closed root
    expect(key('ArrowLeft', 4)).toEqual({ kind: 'none' }); // root leaf
  });
});

describe('sk-285.2.11 — Up and Down', () => {
  test('Down steps to the next visible row and never expands', () => {
    // From the OPEN parent onto its child, and from the last child of a
    // subtree back out to the next root: both are just +1 in the list.
    expect(key('ArrowDown', 0)).toEqual({ kind: 'focus', index: 1 });
    expect(key('ArrowDown', 3)).toEqual({ kind: 'focus', index: 4 });
    // A closed parent stays closed: stepping onto its sibling, not into
    // a subtree the reader never opened.
    expect(key('ArrowDown', 1)).toEqual({ kind: 'focus', index: 2 });
  });

  test('Up steps to the previous visible row and never collapses', () => {
    expect(key('ArrowUp', 4)).toEqual({ kind: 'focus', index: 3 });
    expect(key('ArrowUp', 1)).toEqual({ kind: 'focus', index: 0 });
  });

  test('the ends of the list are walls, not wraps', () => {
    expect(key('ArrowUp', 0)).toEqual({ kind: 'none' });
    expect(key('ArrowDown', ROWS.length - 1)).toEqual({ kind: 'none' });
  });
});

describe('sk-285.2.11 — Home and End', () => {
  test('Home goes to the first row, End to the last, without expanding', () => {
    expect(key('Home', 3)).toEqual({ kind: 'focus', index: 0 });
    expect(key('End', 0)).toEqual({ kind: 'focus', index: ROWS.length - 1 });
  });

  test('already there: nothing happens', () => {
    expect(key('Home', 0)).toEqual({ kind: 'none' });
    expect(key('End', ROWS.length - 1)).toEqual({ kind: 'none' });
  });
});

describe('sk-285.2.11 — Enter', () => {
  test('activates the focused row (same as clicking it)', () => {
    expect(key('Enter', 4)).toEqual({ kind: 'activate', index: 4 });
  });

  test('activates a parent row too — Enter opens, it does not toggle', () => {
    expect(key('Enter', 0)).toEqual({ kind: 'activate', index: 0 });
  });
});

describe('sk-285.2.11 — asterisk', () => {
  test('opens every closed sibling at the focused level', () => {
    // Beta and Bravo are Alpha's closed children; Gamma is a leaf with
    // nothing to open.
    expect(key('*', 1)).toEqual({
      kind: 'expandSiblings',
      ids: ['demo-1.1', 'demo-1.2'],
    });
  });

  test('siblings means SAME PARENT, not merely same depth', () => {
    // Focused on the closed root Epsilon: Alpha is the only other root,
    // and it is already open, so nothing is left to expand — the closed
    // rows one level down are NOT its siblings.
    expect(key('*', 5)).toEqual({
      kind: 'expandSiblings',
      ids: ['demo-3'],
    });
    // …and from inside Alpha's subtree the roots are out of scope.
    const fromChild = key('*', 2);
    expect(fromChild.kind).toBe('expandSiblings');
    expect(fromChild.kind === 'expandSiblings' && fromChild.ids).not.toContain(
      'demo-3',
    );
  });

  test('nothing to open: no action', () => {
    // Every sibling of Gamma's level is already open.
    const allOpen = new Set(['demo-1', 'demo-1.1', 'demo-1.2']);
    expect(key('*', 3, allOpen)).toEqual({ kind: 'none' });
  });
});

describe('sk-285.2.11 — typeahead', () => {
  test('moves to the next row whose title starts with the buffer', () => {
    expect(resolveTypeahead(ROWS, 0, 'b')).toBe(1); // Beta
  });

  test('the same letter again walks to the next match', () => {
    expect(resolveTypeahead(ROWS, 1, 'b')).toBe(2); // Bravo
  });

  test('the search wraps around the end of the list', () => {
    expect(resolveTypeahead(ROWS, 5, 'a')).toBe(0); // back to Alpha
  });

  test('a growing buffer refines onto the row it already found', () => {
    // "b" landed on Beta; typing "e" must keep it there rather than jump
    // to the next b-row.
    expect(resolveTypeahead(ROWS, 1, 'be', true)).toBe(1);
  });

  test('matching is case-insensitive on both sides', () => {
    expect(resolveTypeahead(ROWS, 0, 'DE')).toBe(4); // Delta
  });

  test('no match leaves focus alone', () => {
    expect(resolveTypeahead(ROWS, 0, 'zz')).toBe(-1);
    expect(resolveTypeahead(ROWS, 0, '')).toBe(-1);
  });
});

/**
 * Reference rows (cycle pointers, `<hidden>` cross-project stubs) and
 * context rows (sk-285.2.7 scaffolding parents) are the two row kinds the
 * task calls out by name: both are walked over by the arrows, but a
 * reference row can neither open nor be opened.
 */
describe('sk-285.2.11 — reference and context rows', () => {
  const MIXED: FlatTreeRow[] = [
    row('demo-1', 'Alpha', 0, { hasChildren: true, isContext: true }),
    row('demo-1.1', 'Beta', 1, {
      isReference: true,
      firstSeenAt: 'demo-7',
    }),
    row('demo-1.2', 'Gamma', 1),
  ];
  const mixedKey = (k: string, index: number) =>
    resolveTreeKey(k, { rows: MIXED, index, expanded: new Set<string>() });

  test('a reference row is navigable', () => {
    expect(mixedKey('ArrowDown', 1)).toEqual({ kind: 'focus', index: 2 });
    expect(mixedKey('ArrowUp', 1)).toEqual({ kind: 'focus', index: 0 });
  });

  test('a reference row never expands and never activates', () => {
    expect(mixedKey('ArrowRight', 1)).toEqual({ kind: 'none' });
    expect(mixedKey('Enter', 1)).toEqual({ kind: 'none' });
    expect(isExpandableRow(MIXED[1])).toBe(false);
  });

  test('a reference row climbs to its parent on Left like any other row', () => {
    expect(mixedKey('ArrowLeft', 1)).toEqual({ kind: 'focus', index: 0 });
  });

  test('a context row is permanently open: Right descends into it', () => {
    expect(isOpenRow(MIXED[0], new Set<string>())).toBe(true);
    expect(mixedKey('ArrowRight', 0)).toEqual({ kind: 'focus', index: 1 });
  });

  test('a context row cannot be collapsed, and Left does not pretend it can', () => {
    // It is a root here, so there is no parent to climb to either — the
    // key must resolve to nothing rather than to a collapse the renderer
    // would refuse to perform.
    expect(mixedKey('ArrowLeft', 0)).toEqual({ kind: 'none' });
    expect(isExpandableRow(MIXED[0])).toBe(false);
  });

  test('a context row is a real issue: Enter opens it', () => {
    expect(mixedKey('Enter', 0)).toEqual({ kind: 'activate', index: 0 });
  });
});

describe('sk-285.2.11 — no focused row', () => {
  test('keys resolve to nothing rather than throwing', () => {
    expect(key('ArrowDown', -1)).toEqual({ kind: 'none' });
    expect(key('Enter', ROWS.length)).toEqual({ kind: 'none' });
    expect(resolveTypeahead([], 0, 'a')).toBe(-1);
  });

  test('unclaimed keys are left to the browser', () => {
    expect(key('PageDown', 0)).toEqual({ kind: 'none' });
    expect(key('Tab', 0)).toEqual({ kind: 'none' });
    expect(key(' ', 0)).toEqual({ kind: 'none' });
  });
});
