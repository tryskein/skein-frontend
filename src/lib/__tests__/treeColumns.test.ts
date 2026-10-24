/**
 * sk-285.2.19 — the tree-table column model.
 *
 * Four promises, each of the kind that breaks quietly:
 *
 *   1. the TITLE COLUMN IS STRUCTURAL — it is first, it is always there,
 *      and nothing a user or a hand-edited storage value can say removes
 *      it. Losing it does not hide a property, it deletes the tree
 *      (chevron, indent, typed-deps connector all live in that cell);
 *   2. the defaults ARE the tree row as it reads today — switching to
 *      the table shows a user who never opens the picker neither less
 *      nor more than before;
 *   3. the mask is a faithful packing, because the virtualized rows are
 *      memo()d on it;
 *   4. an EMPTY selection round-trips as empty (a bare tree of titles is
 *      a choice), and only a MISSING key means "use the defaults".
 */

import { describe, expect, test } from 'vitest';
import {
  TREE_DEFAULT_COLUMNS,
  TREE_OPTIONAL_COLUMNS,
  TREE_TITLE_COLUMN,
  hasTreeColumn,
  parseTreeColumns,
  serializeTreeColumns,
  treeColumnOrder,
  treeColumnsMask,
  type TreeOptionalColumn,
} from '../treeColumns';

describe('the title column is structural, not a preference', () => {
  test('it is not one of the switchable columns', () => {
    expect(TREE_OPTIONAL_COLUMNS as readonly string[]).not.toContain(
      TREE_TITLE_COLUMN,
    );
    expect(TREE_DEFAULT_COLUMNS as readonly string[]).not.toContain(
      TREE_TITLE_COLUMN,
    );
  });

  test('it leads the order even when every switch is off', () => {
    expect(treeColumnOrder([])).toEqual([TREE_TITLE_COLUMN]);
  });

  test('it leads the order when every switch is on, exactly once', () => {
    const order = treeColumnOrder(TREE_OPTIONAL_COLUMNS);
    expect(order[0]).toBe(TREE_TITLE_COLUMN);
    expect(order.filter((c) => c === TREE_TITLE_COLUMN)).toHaveLength(1);
  });

  test('a stored value that names it cannot smuggle it into the set', () => {
    // `title` is not a switchable column, so it is dropped like any other
    // unknown name — and the pinned slot still comes from treeColumnOrder.
    const parsed = parseTreeColumns('title,id')!;
    expect([...parsed]).toEqual(['id']);
    expect(treeColumnOrder(parsed)).toEqual([TREE_TITLE_COLUMN, 'id']);
  });

  test('and it is never written back out', () => {
    expect(serializeTreeColumns(['id', 'status'])).not.toContain(
      TREE_TITLE_COLUMN,
    );
  });
});

describe('the default set is a width budget, not a transcript', () => {
  test('identity, state, urgency, owner — and nothing else', () => {
    // sk-285.2.22. It used to be «the tree row as it reads today»: all
    // nine properties the mini-card row printed. That set demanded 944px
    // in a column that has ~620, so the default state of the default view
    // was a table under a permanent horizontal scrollbar. The four below
    // are what a triage table cannot say without — the arithmetic that
    // picked them is written out on `TREE_DEFAULT_COLUMNS`, and the
    // inequality it turns on is pinned in `TreeTableLayout.test.tsx`.
    expect([...TREE_DEFAULT_COLUMNS]).toEqual([
      'id',
      'status',
      'priority',
      'assignee',
    ]);
  });

  test('and the table it draws reads title → identity → state → people', () => {
    // The order a reader actually sees, spelled out rather than derived
    // from the registry the code derives it from: identity, then state,
    // then who. Either the registry being reshuffled or the default set
    // gaining a member moves this literal, which is the point — the
    // previous version of this test rebuilt the expectation with the same
    // filter `treeColumnOrder` uses and could only ever agree with it.
    expect(treeColumnOrder(TREE_DEFAULT_COLUMNS)).toEqual([
      TREE_TITLE_COLUMN,
      'id',
      'status',
      'priority',
      'assignee',
    ]);
  });

  test('the columns the mini-card row never showed are still off', () => {
    // Unchanged by sk-285.2.22 and for the older reason: turning the
    // table on must not START printing information the tree never
    // carried. `labels` and `created` are opt-in, as they always were.
    const mask = treeColumnsMask(TREE_DEFAULT_COLUMNS);
    expect(hasTreeColumn(mask, 'labels')).toBe(false);
    expect(hasTreeColumn(mask, 'created')).toBe(false);
  });

  test('nothing is DELETED — every dropped column is still offered', () => {
    // The five columns sk-285.2.22 switched off are one click away in the
    // picker, not gone. A change that narrowed the default set by
    // narrowing the registry would be a very different (and much worse)
    // change, and this is what tells the two apart.
    for (const c of ['blocked', 'type', 'components', 'progress', 'updated']) {
      expect(TREE_OPTIONAL_COLUMNS as readonly string[]).toContain(c);
      expect(TREE_DEFAULT_COLUMNS as readonly string[]).not.toContain(c);
    }
  });

  test('every default is a column this build actually offers', () => {
    for (const c of TREE_DEFAULT_COLUMNS) {
      expect(TREE_OPTIONAL_COLUMNS).toContain(c);
    }
  });
});

describe('order is the registry order, not the pick order', () => {
  test('picking columns back-to-front still draws them left-to-right', () => {
    const reversed = [...TREE_OPTIONAL_COLUMNS].reverse();
    expect(treeColumnOrder(reversed)).toEqual([
      TREE_TITLE_COLUMN,
      ...TREE_OPTIONAL_COLUMNS,
    ]);
  });

  test('a subset keeps the registry order between its members', () => {
    expect(treeColumnOrder(['updated', 'id', 'priority'])).toEqual([
      TREE_TITLE_COLUMN,
      'id',
      'priority',
      'updated',
    ]);
  });

  test('the order carries only what was picked', () => {
    expect(treeColumnOrder(['labels'])).toEqual([TREE_TITLE_COLUMN, 'labels']);
  });
});

describe('the mask is a faithful packing', () => {
  test('every column has its own bit', () => {
    const bits = TREE_OPTIONAL_COLUMNS.map((c) => treeColumnsMask([c]));
    expect(new Set(bits).size).toBe(TREE_OPTIONAL_COLUMNS.length);
  });

  test('round-trips a set of any shape', () => {
    const picked: TreeOptionalColumn[] = ['labels', 'created', 'progress'];
    const mask = treeColumnsMask(picked);
    for (const c of TREE_OPTIONAL_COLUMNS) {
      expect(hasTreeColumn(mask, c)).toBe(picked.includes(c));
    }
  });

  test('an empty pick hides every switchable column', () => {
    const mask = treeColumnsMask([]);
    for (const c of TREE_OPTIONAL_COLUMNS) {
      expect(hasTreeColumn(mask, c)).toBe(false);
    }
  });
});

describe('persistence', () => {
  test('a stored set round-trips, order-independently', () => {
    const raw = serializeTreeColumns(['updated', 'id', 'labels']);
    const back = parseTreeColumns(raw)!;
    expect([...back].sort()).toEqual(['id', 'labels', 'updated']);
  });

  test('an EMPTY selection round-trips as empty, not as the defaults', () => {
    const back = parseTreeColumns(serializeTreeColumns([]));
    expect(back).not.toBeNull();
    expect(back!.size).toBe(0);
  });

  test('a missing key is the ONLY thing that means "use the defaults"', () => {
    expect(parseTreeColumns(null)).toBeNull();
    expect(parseTreeColumns(undefined)).toBeNull();
  });

  test('a column this build does not know is dropped, not fatal', () => {
    // Padding around every name on purpose: a hand-edited storage value
    // is written by a human, and «id, updated» must load as two columns
    // rather than as one plus a mystery.
    const back = parseTreeColumns(' id , estimate ,updated ')!;
    expect([...back].sort()).toEqual(['id', 'updated']);
  });

  test('a value with NO column name in it is unreadable, not «titles only»', () => {
    // The distinction this whole function turns on. `'{"cols":["id"]}'`
    // is what a wrong writer, a half-finished migration or a fat-fingered
    // hand edit leaves behind; reading it as the EMPTY SET would be
    // reading it as a deliberate «titles only» choice, and the caller
    // would then store that accident as the user's preference. Anything
    // this build cannot read means the same as nothing at all: use the
    // defaults.
    expect(parseTreeColumns('{"cols":["id"]}')).toBeNull();
    expect(parseTreeColumns('!!!,,,   ,{}')).toBeNull();
    expect(parseTreeColumns('true')).toBeNull();
  });

  test('and the empty selection is still empty — the two are NOT the same answer', () => {
    // Same function, same shape of input, opposite meaning: `''` is what
    // `serializeTreeColumns([])` writes, so it is the user speaking.
    const empty = parseTreeColumns('');
    expect(empty).not.toBeNull();
    expect(empty!.size).toBe(0);
    // Whitespace is a hand-edited spelling of the same thing.
    expect(parseTreeColumns('   ')!.size).toBe(0);
  });

  test('damage AROUND a real name still degrades partially, not to the defaults', () => {
    // Forward compatibility is not dropped by the rule above: as long as
    // one name is recognisable the value is a selection, and the rest is
    // dropped.
    expect([...parseTreeColumns('id,{},!!!')!]).toEqual(['id']);
  });
});
