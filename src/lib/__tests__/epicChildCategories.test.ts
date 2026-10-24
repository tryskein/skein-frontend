/**
 * sk-421.3 T05 — distribution of the epic section rows into categories
 * (PK-1, SC-001, SC-002, INV-2, INV-4, INV-10, R-2).
 *
 * The logic is pure, so it is proven without rendering: one rule for both
 * surfaces, and checking it through a component would mean checking
 * the markup, labels and tones as well — i.e. going red for three reasons
 * where one is being checked.
 */

import { describe, expect, test } from 'vitest';
import {
  epicChildCategories,
  isKnownEpicChildStatus,
  type EpicChildCategory,
  type EpicChildCategoryRow,
} from '../epicChildCategories';
import type { IssueTreeRowItem } from '../../api/issues';

function item(over: Partial<IssueTreeRowItem> = {}): IssueTreeRowItem {
  return {
    id: 'sk-42.1',
    projectId: 'p',
    version: 1,
    title: 'child task',
    type: 'task',
    priority: 2,
    status: 'open',
    pinned: false,
    assignee: null,
    componentIds: [],
    labels: [],
    isBlocked: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...over,
  } as IssueTreeRowItem;
}

/** An ordinary row with the given status value (including an unknown one). */
function node(id: string, status: string): EpicChildCategoryRow {
  return { item: item({ id, status } as Partial<IssueTreeRowItem>), isReference: false };
}

/** Stub of an inaccessible task: a reference, status and type empty. */
function stub(id: string): EpicChildCategoryRow {
  return {
    item: item({ id, status: '', type: '' } as Partial<IssueTreeRowItem>),
    isReference: true,
  };
}

/** Category keys in output order — a short form for checking the order. */
function keys(cats: readonly EpicChildCategory<EpicChildCategoryRow>[]): string[] {
  return cats.map((c) => c.key);
}

/** All rows of all categories in sequence. */
function flatten(
  cats: readonly EpicChildCategory<EpicChildCategoryRow>[],
): EpicChildCategoryRow[] {
  return cats.flatMap((c) => c.rows);
}

const ids = (rows: readonly EpicChildCategoryRow[]) => rows.map((r) => r.item.id);

describe('epicChildCategories — distribution (PK-1)', () => {
  test('P-01 — every row is in exactly one category', () => {
    const rows = [
      node('a', 'open'),
      node('b', 'closed'),
      stub('h-1'),
      node('c', 'weird'),
      node('d', 'in_progress'),
    ];
    const cats = epicChildCategories(rows);

    for (const row of rows) {
      const hits = cats.filter((c) => c.rows.includes(row));
      expect(hits, `row ${row.item.id} landed in ${hits.length} categories`).toHaveLength(1);
    }
  });

  test('P-02 — the sum of the counters equals the number of input rows (INV-4)', () => {
    const rows = [
      node('a', 'open'),
      node('b', 'open'),
      stub('h-1'),
      stub('h-2'),
      node('c', 'weird'),
    ];
    const cats = epicChildCategories(rows);
    const total = cats.reduce((sum, c) => sum + c.rows.length, 0);
    expect(total).toBe(rows.length);
  });

  test('P-03 — a category with zero rows is not created', () => {
    // An input with exactly two of the five known statuses: the three
    // other categories must be absent, not arrive empty.
    const cats = epicChildCategories([node('a', 'open'), node('b', 'closed')]);
    expect(keys(cats)).toEqual(['status:open', 'status:closed']);
    for (const c of cats) expect(c.rows.length).toBeGreaterThan(0);
  });

  test('P-04 — positions of the named categories do not depend on the data composition', () => {
    const order = ['in_progress', 'open', 'deferred', 'closed', 'standing'];

    // The input is shuffled so that the on-screen order repeats neither
    // the input nor the alphabetical order.
    const all = epicChildCategories([
      node('a', 'standing'),
      node('b', 'closed'),
      node('c', 'open'),
      node('d', 'in_progress'),
      node('e', 'deferred'),
    ]);
    expect(keys(all)).toEqual(order.map((s) => `status:${s}`));

    // The same order on any SUBSET of statuses: the positions
    // of the named categories are a property of the rule, not of the data.
    const some = epicChildCategories([
      node('a', 'standing'),
      node('b', 'in_progress'),
      node('c', 'closed'),
    ]);
    expect(keys(some)).toEqual(['status:in_progress', 'status:closed', 'status:standing']);
  });

  test('P-05 — row order inside a category is the input order, with no sorting at all (R-2)', () => {
    // The identifiers are deliberately NOT sorted: sorting by number is
    // exactly what the design does and what the mechanism must not do.
    const cats = epicChildCategories([
      node('sk-42.10', 'open'),
      node('sk-42.2', 'open'),
      node('sk-42.1', 'open'),
    ]);
    expect(cats).toHaveLength(1);
    expect(ids(cats[0].rows)).toEqual(['sk-42.10', 'sk-42.2', 'sk-42.1']);
  });

  test('P-06 — the expansion of the categories equals the input as a multiset (INV-2)', () => {
    const rows = [
      node('c', 'open'),
      node('a', 'closed'),
      stub('h-1'),
      node('b', 'weird'),
      node('a2', 'open'),
      node('d', 'standing'),
    ];
    const cats = epicChildCategories(rows);
    // The composition does not change: no row was lost or doubled.
    // Compared as a multiset, not by order — the order does change
    // here, and that is its right.
    expect(ids(flatten(cats)).sort()).toEqual(ids(rows).sort());
    expect(flatten(cats)).toHaveLength(rows.length);
  });
});

describe('epicChildCategories — trailing and "unavailable" (PK-1, SC-002)', () => {
  test('P-07 — trailing ones are ordered by FIRST APPEARANCE, and that is not alphabetical', () => {
    // 'zeta' appears before 'alpha': if the rule sorted the
    // values, the order would be reversed — so the input is chosen
    // such that the two orders are distinguishable. Otherwise the test would pass in vain.
    const cats = epicChildCategories([
      node('a', 'zeta'),
      node('b', 'alpha'),
      node('c', 'zeta'),
    ]);

    const tail = cats.filter((c) => c.kind === 'unknown');
    expect(tail.map((c) => (c.kind === 'unknown' ? c.value : ''))).toEqual(['zeta', 'alpha']);
    // …and this assertion is strong only together with the next one:
    expect(['zeta', 'alpha']).not.toEqual([...['zeta', 'alpha']].sort());
    // Rows inside a trailing category are also in input order.
    expect(ids(tail[0].rows)).toEqual(['a', 'c']);
  });

  test('trailing ones stand after ALL the known ones and before "unavailable"', () => {
    const cats = epicChildCategories([
      stub('h-1'),
      node('a', 'weird'),
      node('b', 'standing'),
      node('c', 'in_progress'),
    ]);
    expect(keys(cats)).toEqual([
      'status:in_progress',
      'status:standing',
      'unknown:weird',
      'unavailable',
    ]);
  });

  test('P-08 — an empty status without referentiality goes to "no status" (PK-1 item 4)', () => {
    // The triple predicate of PK-1 item 1: a stub is referentiality AND an empty
    // status AND an empty type. A row with an empty status that is not a reference
    // does not match it and cannot get into "unavailable".
    const ordinary = { item: item({ id: 'a', status: '' } as Partial<IssueTreeRowItem>), isReference: false };
    const cats = epicChildCategories([ordinary, stub('h-1')]);

    const unavailable = cats.find((c) => c.kind === 'unavailable');
    expect(unavailable, 'the "unavailable" category must exist').toBeDefined();
    expect(unavailable!.rows).toHaveLength(1);
    expect(ids(unavailable!.rows)).toEqual(['h-1']);

    // m-5 — the branch is named POSITIVELY. The earlier edition wrote here
    // two `not.toBe`, and they are true for ANY third branch: the test was
    // green even when the row fell into the trailing category of the empty
    // value, i.e. exactly the defect T13a was
    // created for. A negation does not tell "the right branch" from "any other".
    const hits = cats.filter((c) => c.rows.includes(ordinary));
    expect(hits).toHaveLength(1);
    expect(hits[0].kind, 'the row with an empty status did not land in "no status"').toBe('nostatus');
    expect(hits[0].key).toBe('nostatus');
    // …and the whole order — "no status" BEFORE "unavailable" (SC-002).
    expect(keys(cats)).toEqual(['nostatus', 'unavailable']);
  });

  test('SC-002 — "no status" after the trailing ones and BEFORE "unavailable"', () => {
    // The input from the T13a statement, and it is DISTINGUISHING: the empty status is
    // FIRST in the input. On the old code such a row went into the table of
    // trailing categories, which are issued in first-appearance order,
    // so the result was ['', 'weird'], the opposite of the required order.
    // If the fourth branch is removed, this test goes red immediately.
    const cats = epicChildCategories([node('a', ''), node('b', 'weird'), stub('h-1')]);
    expect(keys(cats)).toEqual(['unknown:weird', 'nostatus', 'unavailable']);
  });

  test('the "no status" position does not depend on the data composition', () => {
    // Two trailing values, the empty status first again: if the
    // category lived in the table of trailing ones, it would stand before both.
    // The position of a NAMED category is a property of the rule, not of the data.
    const cats = epicChildCategories([node('a', ''), node('b', 'zeta'), node('c', 'alpha')]);
    expect(keys(cats)).toEqual(['unknown:zeta', 'unknown:alpha', 'nostatus']);
  });

  test('INV-4 — the sum of the counters also matches with the "no status" rows', () => {
    const rows = [
      node('a', ''),
      node('b', ''),
      node('c', 'weird'),
      stub('h-1'),
      node('d', 'open'),
    ];
    const cats = epicChildCategories(rows);
    expect(cats.reduce((sum, c) => sum + c.rows.length, 0)).toBe(rows.length);
    // Rows inside a category — in input order, as everywhere.
    const nostatus = cats.find((c) => c.kind === 'nostatus');
    expect(nostatus, 'the "no status" category was not created').toBeDefined();
    expect(ids(nostatus!.rows)).toEqual(['a', 'b']);
  });

  test('the "no status" category is not created when there are no such rows (P-03)', () => {
    const cats = epicChildCategories([node('a', 'open'), stub('h-1')]);
    expect(keys(cats)).toEqual(['status:open', 'unavailable']);
  });

  test('INV-6 — "no status" has NO tone to ask', () => {
    const cats = epicChildCategories([node('a', '')]);
    expect(cats).toHaveLength(1);
    const cat = cats[0];
    expect(cat.kind).toBe('nostatus');
    // The tagged-union branch carries neither `status` nor `value`:
    // there is literally nothing to colour by, not by convention. It is checked,
    // not implied — a convention can be forgotten, a field cannot.
    expect('status' in cat).toBe(false);
    expect('value' in cat).toBe(false);
  });

  test('"unavailable" is always last, even when the stubs came first', () => {
    const cats = epicChildCategories([stub('h-1'), stub('h-2'), node('a', 'open')]);
    expect(keys(cats)).toEqual(['status:open', 'unavailable']);
    expect(ids(cats[1].rows)).toEqual(['h-1', 'h-2']);
  });

  test('a standing task lands in its named category', () => {
    const cats = epicChildCategories([node('a', 'standing')]);
    expect(cats).toHaveLength(1);
    expect(cats[0].kind).toBe('status');
    expect(cats[0].key).toBe('status:standing');
  });
});

describe('isKnownEpicChildStatus — runtime value check (PL-3)', () => {
  test('knows exactly the five contract values', () => {
    for (const s of ['open', 'in_progress', 'deferred', 'closed', 'standing']) {
      expect(isKnownEpicChildStatus(s), s).toBe(true);
    }
  });

  test('does not know an empty value or foreign words', () => {
    // `blocked` is especially important here: it is NOT a contract status but a
    // derived flag by which the common chip substitutes the value
    // (PK-1 item 2). It cannot be a category.
    for (const s of ['', 'blocked', 'kanban', 'Open', 'in progress']) {
      expect(isKnownEpicChildStatus(s), s).toBe(false);
    }
  });
});

// ───────── sk-489 T017 — the total does NOT split categories (US-7 "Out of scope", row 63) ─────────
//
// The product decision is named in the spec as a separate item: ALL
// breakdowns BY STATUS stay unchanged, and the "Completed" category in the
// "List" still collects all closed children AT ANY TOTAL.
// The rule is pure, so the guard is pure: rendering proves
// only that the mode calls the rule (`EpicChildrenList.test.tsx`), and
// the rule itself is proven here.
//
// The guard is negative by meaning, and such a guard must be able to go
// red. And it does: an implementation that gave the dropped ones their own bucket
// (or sent them to a trailing one by the total value) would give two
// categories instead of one and three rows in the first instead of four.

describe('epicChildCategories — the total does not affect the category (sk-489 T017)', () => {
  /** A closed row with the given total. */
  function closed(id: string, closeOutcome: string): EpicChildCategoryRow {
    return {
      item: item({ id, status: 'closed', closeOutcome } as Partial<IssueTreeRowItem>),
      isReference: false,
    };
  }

  test('all four totals — one category "closed", input order', () => {
    const cats = epicChildCategories([
      closed('a', 'done'),
      closed('b', 'wont_do'),
      closed('c', 'duplicate'),
      closed('d', 'superseded'),
    ]);
    expect(keys(cats)).toEqual(['status:closed']);
    expect(ids(cats[0].rows)).toEqual(['a', 'b', 'c', 'd']);
  });

  test('an unfamiliar total also enters the closed category (INV-2)', () => {
    // Trailing categories are created by an UNKNOWN STATUS, not by an unknown
    // total: the total value does not select the category at all.
    const cats = epicChildCategories([closed('a', 'done'), closed('b', 'flattened_into_epic')]);
    expect(keys(cats)).toEqual(['status:closed']);
    expect(ids(cats[0].rows)).toEqual(['a', 'b']);
  });

  test('the total on a row of a NON-closed status does not change the category', () => {
    // The server will not send this (INV-1), but the rule does not ask for
    // the total either: the row goes to the category of its status, whatever the total
    // is. The assertion is exactly about this — "the rule reads the status".
    const cats = epicChildCategories([
      { item: item({ id: 'a', status: 'open', closeOutcome: 'wont_do' } as Partial<IssueTreeRowItem>), isReference: false },
      closed('b', 'wont_do'),
    ]);
    expect(keys(cats)).toEqual(['status:open', 'status:closed']);
  });
});
