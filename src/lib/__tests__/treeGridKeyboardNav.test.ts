/**
 * sk-285.2.19 — the WAI-ARIA APG keyboard contract for the Tasks TABLE,
 * rule by rule.
 *
 * The tree pattern's thirteen rules are pinned next door, in
 * `treeKeyboardNav.test.ts`, and this file does NOT restate them: the
 * grid resolver delegates row-mode Right/Left/Up/Down/Enter/`*` to that
 * resolver, so a copy here would only assert that delegation twice. What
 * IS asserted here is everything the tree pattern does not have —
 *
 *   - the second focus mode: a cursor on one CELL of a row, how it is
 *     entered, how it is left, and what the arrows mean while in it;
 *   - `Home` / `End` reading the cursor's MODE — the ends of the GRID on
 *     a row, the ends of the ROW in a cell — and `Ctrl+Home` /
 *     `Ctrl+End` reaching the ends of the grid from either;
 *   - `Page Up` / `Page Down`;
 *
 * — plus the tree rules whose ANSWER the grid changes (Right no longer
 * descends to the first child, and no longer does nothing on a leaf: in
 * every case but a collapsed openable row it enters the row's cells) and
 * the two row kinds the task calls out by name, checked here because
 * delegation is exactly the kind of thing that can be quietly cut.
 *
 * Every rule below is the APG text quoted in the module's own doc
 * comment; where a test's name is not obviously that text, the quote is
 * in the test.
 *
 * The fixture is the row list AS RENDERED — post-collapse, pre-order
 * DFS:
 *
 *   0  Alpha     depth 0, parent, OPEN
 *   1    Beta    depth 1, parent, closed
 *   2    Bravo   depth 1, parent, closed
 *   3    Gamma   depth 1, leaf
 *   4  Delta     depth 0, leaf
 *   5  Epsilon   depth 0, parent, closed
 *
 * The table is four columns wide (the pinned title plus three) and one
 * page is two rows — both small enough that every edge is one keystroke
 * away.
 */

import { describe, expect, test } from 'vitest';

import { resolveTreeGridKey } from '../treeGridKeyboardNav';
import type { TreeGridCursor } from '../treeGridKeyboardNav';
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

const EXPANDED = new Set(['demo-1']);
const COL_COUNT = 4;
const PAGE = 2;

/** One keystroke on the fixture. `col: null` is row mode. */
function key(
  k: string,
  cursor: TreeGridCursor,
  opts: {
    ctrl?: boolean;
    rows?: readonly FlatTreeRow[];
    expanded?: ReadonlySet<string>;
    colCount?: number;
    pageSize?: number;
  } = {},
) {
  return resolveTreeGridKey(
    k,
    {
      rows: opts.rows ?? ROWS,
      cursor,
      expanded: opts.expanded ?? EXPANDED,
      colCount: opts.colCount ?? COL_COUNT,
      pageSize: opts.pageSize ?? PAGE,
    },
    { ctrl: opts.ctrl },
  );
}

/** The focus action naming row `r`, cell `c` (null = the row itself). */
function focus(r: number, c: number | null) {
  return { kind: 'focus', cursor: { row: r, col: c } };
}

const NONE = { kind: 'none' };

describe('sk-285.2.19 — Right arrow', () => {
  test('row mode, COLLAPSED row: expands it — the one branch that opens', () => {
    // «If a row is focused, and it is collapsed, expands the current
    // row.» Focus does not move: the reader stays on the row they opened.
    expect(key('ArrowRight', { row: 1, col: null })).toEqual({
      kind: 'expand',
      id: 'demo-1.1',
    });
  });

  test('row mode, EXPANDED row: focuses the first cell, NOT the first child', () => {
    // «If a row is focused, and it is expanded, focuses the first cell in
    // the row.» Row 0 is open and row 1 is its child, so the two answers
    // are visibly different — and the wrong one (focus(1, null)) is the
    // TREE pattern's Right, which this resolver carried until
    // sk-285.2.19 step 2. Descending is Down here; Right is the cell
    // axis.
    expect(key('ArrowRight', { row: 0, col: null })).toEqual(focus(0, 0));
  });

  test('row mode, a row with no children: focuses the first cell too', () => {
    // The pattern page's widening: «an expanded row OR a row that does
    // not have child rows». Row 3 is a leaf.
    expect(key('ArrowRight', { row: 3, col: null })).toEqual(focus(3, 0));
  });

  test('row mode, an open row whose subtree is not in the list: the cells', () => {
    // An open parent the layered path pruned — no child row follows it.
    // The tree resolver answers "nothing" here; the grid still enters the
    // cells, because the row is expanded.
    const pruned = [
      row('demo-9', 'Solo', 0, { hasChildren: true }),
      row('demo-10', 'Next', 0),
    ];
    expect(
      key('ArrowRight', { row: 0, col: null }, {
        rows: pruned,
        expanded: new Set(['demo-9']),
      }),
    ).toEqual(focus(0, 0));
  });

  test('entering the cells is the ONLY thing Right does to a non-collapsed row', () => {
    // The three shapes above answer with the same cursor, and none of
    // them toggles anything: a Right that expanded or descended here
    // would be the tree pattern leaking back in.
    for (const r of [0, 3]) {
      expect(key('ArrowRight', { row: r, col: null })).toEqual(focus(r, 0));
    }
  });

  test('cell mode: one cell to the right', () => {
    expect(key('ArrowRight', { row: 3, col: 0 })).toEqual(focus(3, 1));
    expect(key('ArrowRight', { row: 3, col: 2 })).toEqual(focus(3, 3));
  });

  test('cell mode, on the LAST cell: nothing', () => {
    // A wall, not a wrap onto the next row: the reader has reached the
    // end of the row and must be told by the silence.
    expect(key('ArrowRight', { row: 3, col: COL_COUNT - 1 })).toEqual(NONE);
  });

  test('cell mode never expands, not even on a closed parent row', () => {
    // Same keystroke, same row, different mode: in cell mode Right is a
    // move along the row and must not toggle anything.
    expect(key('ArrowRight', { row: 1, col: 1 })).toEqual(focus(1, 2));
  });
});

describe('sk-285.2.19 — Left arrow', () => {
  test('row mode, EXPANDED row: collapses it', () => {
    // «If a row is focused, and it is expanded, collapses the current
    // row.»
    expect(key('ArrowLeft', { row: 0, col: null })).toEqual({
      kind: 'collapse',
      id: 'demo-1',
    });
  });

  test('row mode, COLLAPSED row or leaf: moves to the parent row', () => {
    // «If a row is focused, and it is collapsed, moves to the parent row
    // (if there is one).»
    expect(key('ArrowLeft', { row: 1, col: null })).toEqual(focus(0, null));
    expect(key('ArrowLeft', { row: 3, col: null })).toEqual(focus(0, null));
  });

  test('row mode, a root row with no parent: nothing', () => {
    // «…(if there is one)». Row 4 is a depth-0 leaf.
    expect(key('ArrowLeft', { row: 4, col: null })).toEqual(NONE);
  });

  test('cell mode, a cell in another column: one cell to the left', () => {
    // «If a cell in a different column is focused, moves focus one cell
    // to the left.»
    expect(key('ArrowLeft', { row: 3, col: 2 })).toEqual(focus(3, 1));
  });

  test('cell mode, a cell in the FIRST column: focuses the row', () => {
    // «If a cell in the first column is focused, focuses the row.» The
    // way out of cell mode, and the mirror of the Right that entered it.
    // Not "nothing", or the reader would be stuck in the row.
    expect(key('ArrowLeft', { row: 3, col: 0 })).toEqual(focus(3, null));
  });

  test('cell mode never collapses, not even on an open parent row', () => {
    expect(key('ArrowLeft', { row: 0, col: 2 })).toEqual(focus(0, 1));
  });
});

describe('sk-285.2.19 — Up and Down', () => {
  test('row mode: one visible row, no expansion', () => {
    expect(key('ArrowDown', { row: 0, col: null })).toEqual(focus(1, null));
    expect(key('ArrowUp', { row: 4, col: null })).toEqual(focus(3, null));
  });

  test('cell mode: one row, SAME column', () => {
    // The property that makes a column readable top to bottom. Dropping
    // the column here would send the reader back to the row on every
    // step.
    expect(key('ArrowDown', { row: 0, col: 2 })).toEqual(focus(1, 2));
    expect(key('ArrowUp', { row: 4, col: 2 })).toEqual(focus(3, 2));
  });

  test('the ends of the grid are walls in both modes', () => {
    expect(key('ArrowUp', { row: 0, col: null })).toEqual(NONE);
    expect(key('ArrowUp', { row: 0, col: 2 })).toEqual(NONE);
    expect(key('ArrowDown', { row: ROWS.length - 1, col: 2 })).toEqual(NONE);
  });
});

describe('sk-285.2.19 — Home and End read the cursor’s MODE', () => {
  test('ROW mode: the ends of the GRID, and the mode does not change', () => {
    // «If a row is focused, moves to the first row» / «…to the last row.»
    // The bug this stands against shipped: the resolver asked
    // `col === 0`, which is false for the `null` of row mode, so Home on
    // a row dived into its first cell and the first row was unreachable
    // without Ctrl.
    expect(key('Home', { row: 2, col: null })).toEqual(focus(0, null));
    expect(key('End', { row: 2, col: null })).toEqual(
      focus(ROWS.length - 1, null),
    );
  });

  test('ROW mode, already at that end: nothing', () => {
    expect(key('Home', { row: 0, col: null })).toEqual(NONE);
    expect(key('End', { row: ROWS.length - 1, col: null })).toEqual(NONE);
  });

  test('CELL mode: the ends of the ROW containing focus', () => {
    // «If a cell is focused, moves focus to the first / last cell in the
    // row containing focus.» The row does NOT change: that is what
    // separates these from Ctrl+Home / Ctrl+End.
    expect(key('Home', { row: 2, col: 2 })).toEqual(focus(2, 0));
    expect(key('End', { row: 2, col: 1 })).toEqual(focus(2, COL_COUNT - 1));
  });

  test('CELL mode, already at that end: nothing', () => {
    expect(key('Home', { row: 2, col: 0 })).toEqual(NONE);
    expect(key('End', { row: 2, col: COL_COUNT - 1 })).toEqual(NONE);
  });

  test('the row’s last cell follows the column count, not a fixed table', () => {
    // Columns are switchable (`lib/treeColumns.ts`), so "the last cell"
    // is whatever the user has switched on.
    expect(key('End', { row: 2, col: 0 }, { colCount: 2 })).toEqual(
      focus(2, 1),
    );
    // …and a cursor left past the new end by a column being switched off
    // is already there, rather than being sent further right.
    expect(key('End', { row: 2, col: 3 }, { colCount: 2 })).toEqual(NONE);
  });
});

describe('sk-285.2.19 — Ctrl+Home and Ctrl+End are the ends of the GRID', () => {
  test('they jump to the first and last row', () => {
    expect(key('Home', { row: 3, col: null }, { ctrl: true })).toEqual(
      focus(0, null),
    );
    expect(key('End', { row: 0, col: null }, { ctrl: true })).toEqual(
      focus(ROWS.length - 1, null),
    );
  });

  test('they keep the column, so a cell reader stays in their column', () => {
    expect(key('End', { row: 0, col: 2 }, { ctrl: true })).toEqual(
      focus(ROWS.length - 1, 2),
    );
    expect(key('Home', { row: 3, col: 2 }, { ctrl: true })).toEqual(
      focus(0, 2),
    );
  });

  test('already at that end: nothing', () => {
    expect(key('Home', { row: 0, col: null }, { ctrl: true })).toEqual(NONE);
    expect(
      key('End', { row: ROWS.length - 1, col: null }, { ctrl: true }),
    ).toEqual(NONE);
  });

  test('every OTHER Ctrl keystroke is left to the browser', () => {
    // Ctrl+F, Ctrl+←, Ctrl+Enter: the grid claims two modified keys and
    // no more.
    expect(key('ArrowDown', { row: 0, col: null }, { ctrl: true })).toEqual(NONE);
    expect(key('Enter', { row: 0, col: null }, { ctrl: true })).toEqual(NONE);
    expect(key('f', { row: 0, col: null }, { ctrl: true })).toEqual(NONE);
  });
});

describe('sk-285.2.19 — Page Up and Page Down', () => {
  test('they move by one grid height', () => {
    expect(key('PageDown', { row: 0, col: null })).toEqual(focus(PAGE, null));
    expect(key('PageUp', { row: 4, col: null })).toEqual(focus(4 - PAGE, null));
  });

  test('they clamp to the ends instead of refusing', () => {
    // A page that would overshoot lands ON the last row: paging to the
    // end of a long list must not require counting rows.
    expect(key('PageDown', { row: 5, col: null }, { pageSize: 99 })).toEqual(
      NONE,
    );
    expect(key('PageDown', { row: 4, col: null }, { pageSize: 99 })).toEqual(
      focus(ROWS.length - 1, null),
    );
    expect(key('PageUp', { row: 1, col: null }, { pageSize: 99 })).toEqual(
      focus(0, null),
    );
    expect(key('PageUp', { row: 0, col: null })).toEqual(NONE);
  });

  test('they keep the column', () => {
    expect(key('PageDown', { row: 0, col: 3 })).toEqual(focus(PAGE, 3));
  });
});

describe('sk-285.2.19 — Enter and asterisk operate the ROW, from either mode', () => {
  test('Enter activates the row the cursor is on', () => {
    expect(key('Enter', { row: 4, col: null })).toEqual({
      kind: 'activate',
      index: 4,
    });
  });

  test('Enter on a CELL activates its row — the same thing clicking it does', () => {
    expect(key('Enter', { row: 4, col: 2 })).toEqual({
      kind: 'activate',
      index: 4,
    });
  });

  test('asterisk opens the closed siblings of the focused row', () => {
    expect(key('*', { row: 1, col: null })).toEqual({
      kind: 'expandSiblings',
      ids: ['demo-1.1', 'demo-1.2'],
    });
    // …and from a cell of that row, too: it is a fact about rows.
    expect(key('*', { row: 1, col: 2 })).toEqual({
      kind: 'expandSiblings',
      ids: ['demo-1.1', 'demo-1.2'],
    });
  });
});

/**
 * Reference rows (cycle pointers, `<hidden>` cross-project stubs) are
 * navigable but never open and never activate. The rule itself is the
 * tree's and is pinned there; what is checked here is that the GRID did
 * not lose it — and what the grid adds, which is that their cells are
 * still walkable.
 */
describe('sk-285.2.19 — reference rows', () => {
  const MIXED: FlatTreeRow[] = [
    row('demo-1', 'Alpha', 0, { hasChildren: true, isContext: true }),
    row('demo-1.1', 'Beta', 1, { isReference: true, firstSeenAt: 'demo-7' }),
    row('demo-1.2', 'Gamma', 1),
  ];
  const mixed = (k: string, cursor: TreeGridCursor) =>
    key(k, cursor, { rows: MIXED, expanded: new Set<string>() });

  test('the arrows still walk over them', () => {
    expect(mixed('ArrowDown', { row: 1, col: null })).toEqual(focus(2, null));
    expect(mixed('ArrowUp', { row: 1, col: null })).toEqual(focus(0, null));
  });

  test('Enter does not activate them, in either mode', () => {
    expect(mixed('Enter', { row: 1, col: null })).toEqual(NONE);
    expect(mixed('Enter', { row: 1, col: 2 })).toEqual(NONE);
  });

  test('Right walks into their cells rather than expanding them', () => {
    // They own no subtree, so they are never "collapsed" in the sense the
    // source means — and the grid must not invent an expansion: this is a
    // move into the row's own cells, like any other non-collapsed row.
    expect(mixed('ArrowRight', { row: 1, col: null })).toEqual(focus(1, 0));
  });

  test('a context row is permanently open: Right enters ITS cells too', () => {
    // Row 0 is a context parent and row 1 IS its child, so the discarded
    // tree answer (focus(1, null), a descent) is again visibly different
    // from the grid's.
    expect(mixed('ArrowRight', { row: 0, col: null })).toEqual(focus(0, 0));
  });

  test('Home and End still reach the ends of the grid over them', () => {
    // The row-mode reading does not consult the row at all, so a
    // reference row must not become a stop the reader cannot pass.
    expect(mixed('End', { row: 0, col: null })).toEqual(focus(2, null));
    expect(mixed('Home', { row: 1, col: null })).toEqual(focus(0, null));
  });
});

describe('sk-285.2.19 — keys and cursors the contract does not claim', () => {
  test('a cursor outside the list resolves to nothing rather than throwing', () => {
    // Including the keys the GRID answers by itself: the delegated ones
    // are guarded by the tree resolver, but `End` and `Page Down` are
    // pure arithmetic on the cursor and would happily name a cell of a
    // row that does not exist.
    expect(key('ArrowDown', { row: -1, col: null })).toEqual(NONE);
    expect(key('Enter', { row: ROWS.length, col: 0 })).toEqual(NONE);
    expect(key('End', { row: ROWS.length, col: 0 })).toEqual(NONE);
    expect(key('PageDown', { row: -1, col: null })).toEqual(NONE);
  });

  test('unclaimed keys are left to the browser', () => {
    expect(key('Tab', { row: 0, col: null })).toEqual(NONE);
    expect(key(' ', { row: 0, col: null })).toEqual(NONE);
    expect(key('a', { row: 0, col: null })).toEqual(NONE);
  });
});
