/**
 * sk-285.2.19 (step 4) — the sort model behind the tree table's column
 * headings.
 *
 * Decision A, restated because everything here is a consequence of it:
 * a click on a heading sorts the children of each parent AMONG
 * THEMSELVES. The tree never flattens, the hierarchy is never touched,
 * and the price is that the order is local to a branch.
 *
 * Four things are pinned, each of which fails silently otherwise:
 *
 *   1. the order INSIDE a parent is the one the key names;
 *   2. sorting cannot change the SHAPE of the tree — under any key, in
 *      either direction, every row keeps its parent, and none is lost or
 *      duplicated. A sort that "works" while quietly re-parenting rows
 *      looks entirely correct until somebody reads the tree;
 *   3. the direction actually reverses (and reverses the tiebreaker with
 *      it, so the two directions are mirrors rather than two unrelated
 *      orders);
 *   4. the stored value carries both halves, and a value written by a
 *      build that had no directions still loads.
 *
 * `TasksTreeSort.test.tsx` takes the same questions through the real
 * column, where the preference is read from real localStorage.
 */

import { describe, expect, test } from 'vitest';

import {
  NATURAL_SORT_DIRECTION,
  compareIssuesBy,
  defaultSortDirection,
  directionFor,
  formatSortPref,
  nextSortForColumn,
  parseSortPref,
  sortDfsBlocks,
  sortedTreeColumn,
  treeColumnSortKey,
  type TasksSortDirection,
} from '../taskSort';
import type { IssueSummary, TasksSortKey } from '../../api/issues';

function item(
  id: string,
  over: Partial<IssueSummary> = {},
): IssueSummary {
  return {
    id,
    projectId: 'proj-1',
    version: 1,
    title: id,
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
  };
}

/** A DFS row of the layered shape: the issue plus its depth. */
interface DfsRow {
  depth: number;
  item: IssueSummary;
}

function dfs(depth: number, id: string, over: Partial<IssueSummary> = {}): DfsRow {
  return { depth, item: item(id, over) };
}

/**
 * The fixture the shape assertions run on — deliberately NOT sorted in
 * any of the orders under test, and with values chosen so that every key
 * produces a DIFFERENT arrangement:
 *
 *   demo-9              root, P3, updated Jan, created Mar
 *     demo-9.2          P0, updated Feb, created Feb
 *     demo-9.1          P4, updated Mar, created Jan
 *       demo-9.1.1      P1, updated Jan
 *       demo-9.1.2      P0, updated Feb
 *   demo-2              root, P1, updated Mar, created Jan
 *     demo-2.1          P2, updated Jan, created Mar
 */
const TREE: DfsRow[] = [
  dfs(0, 'demo-9', { priority: 3, updatedAt: '2026-01-05T00:00:00Z', createdAt: '2026-03-01T00:00:00Z' }),
  dfs(1, 'demo-9.2', { priority: 0, updatedAt: '2026-02-05T00:00:00Z', createdAt: '2026-02-01T00:00:00Z' }),
  dfs(1, 'demo-9.1', { priority: 4, updatedAt: '2026-03-05T00:00:00Z', createdAt: '2026-01-01T00:00:00Z' }),
  dfs(2, 'demo-9.1.1', { priority: 1, updatedAt: '2026-01-09T00:00:00Z' }),
  dfs(2, 'demo-9.1.2', { priority: 0, updatedAt: '2026-02-09T00:00:00Z' }),
  dfs(0, 'demo-2', { priority: 1, updatedAt: '2026-03-01T00:00:00Z', createdAt: '2026-01-02T00:00:00Z' }),
  dfs(1, 'demo-2.1', { priority: 2, updatedAt: '2026-01-02T00:00:00Z', createdAt: '2026-03-02T00:00:00Z' }),
];

/** id → id of the row it hangs under, derived from the DFS depths. */
function parentOf(rows: readonly DfsRow[]): Map<string, string | null> {
  const out = new Map<string, string | null>();
  const stack: string[] = [];
  for (const r of rows) {
    stack.length = r.depth;
    out.set(r.item.id, r.depth === 0 ? null : (stack[r.depth - 1] ?? null));
    stack[r.depth] = r.item.id;
  }
  return out;
}

const ids = (rows: readonly DfsRow[]) => rows.map((r) => r.item.id);

const EVERY_KEY: readonly TasksSortKey[] = [
  'priority-updated',
  'priority',
  'updated',
  'created',
  'id',
  'relevance',
];
const EVERY_DIRECTION: readonly TasksSortDirection[] = ['asc', 'desc'];

describe('sk-285.2.19 (step 4) — the order INSIDE each parent', () => {
  test('«updated» puts each parent’s freshest child first — inside that parent', () => {
    const sorted = ids(sortDfsBlocks(TREE, compareIssuesBy('updated')));
    // Roots by their own updatedAt (demo-2 Mar, demo-9 Jan), each
    // followed by its own subtree — NOT by whatever was globally newest.
    expect(sorted).toEqual([
      'demo-2',
      'demo-2.1',
      'demo-9',
      'demo-9.1',
      'demo-9.1.2',
      'demo-9.1.1',
      'demo-9.2',
    ]);
  });

  test('the price of decision A: the freshest row of the tree is NOT on top', () => {
    // The whole cost, as an assertion. demo-9.1 (Mar 5) is the most
    // recently updated row in the fixture, and sorting by «updated» does
    // not float it: it stays inside demo-9, which is itself below
    // demo-2. This is what the table's caption tells the reader, and if
    // this expectation ever flips, the caption has started lying.
    const sorted = sortDfsBlocks(TREE, compareIssuesBy('updated'));
    const newest = [...TREE].sort((a, b) =>
      b.item.updatedAt.localeCompare(a.item.updatedAt),
    )[0];
    expect(newest.item.id).toBe('demo-9.1');
    expect(sorted[0].item.id).not.toBe(newest.item.id);
  });

  test('«priority» orders siblings P0 first, with an id tiebreaker', () => {
    const sorted = ids(sortDfsBlocks(TREE, compareIssuesBy('priority')));
    expect(sorted).toEqual([
      'demo-2', // P1 root before the P3 root
      'demo-2.1',
      'demo-9',
      'demo-9.2', // P0 before its P4 sibling
      'demo-9.1',
      'demo-9.1.2', // P0 before P1
      'demo-9.1.1',
    ]);
  });

  test('reversing a key mirrors it — tiebreaker included', () => {
    const asc = ids(sortDfsBlocks(TREE, compareIssuesBy('id', 'asc')));
    const desc = ids(sortDfsBlocks(TREE, compareIssuesBy('id', 'desc')));
    expect(asc).toEqual([
      'demo-2',
      'demo-2.1',
      'demo-9',
      'demo-9.1',
      'demo-9.1.1',
      'demo-9.1.2',
      'demo-9.2',
    ]);
    // Every sibling group reversed — and only the groups: the subtrees
    // travel with their parents.
    expect(desc).toEqual([
      'demo-9',
      'demo-9.2',
      'demo-9.1',
      'demo-9.1.2',
      'demo-9.1.1',
      'demo-2',
      'demo-2.1',
    ]);
  });

  test('«relevance» re-orders nothing — the server’s ranking is the order', () => {
    for (const direction of EVERY_DIRECTION) {
      expect(ids(sortDfsBlocks(TREE, compareIssuesBy('relevance', direction)))).toEqual(
        ids(TREE),
      );
    }
  });
});

describe('sk-285.2.19 (step 4) — sorting never changes the tree’s shape', () => {
  test('every key, in both directions, keeps every row under its own parent', () => {
    const before = parentOf(TREE);
    for (const sort of EVERY_KEY) {
      for (const direction of EVERY_DIRECTION) {
        const sorted = sortDfsBlocks(TREE, compareIssuesBy(sort, direction));
        const label = `${sort}/${direction}`;
        // Nothing lost, nothing duplicated.
        expect(ids(sorted).slice().sort(), label).toEqual(ids(TREE).slice().sort());
        // …and nothing re-parented: the depth walk of the sorted list
        // yields the SAME parent for every row.
        expect(parentOf(sorted), label).toEqual(before);
      }
    }
  });

  test('the input array is not touched', () => {
    const snapshot = ids(TREE);
    sortDfsBlocks(TREE, compareIssuesBy('priority', 'desc'));
    expect(ids(TREE)).toEqual(snapshot);
  });

  test('rows the comparator calls equal keep the order they arrived in', () => {
    // Stability is what keeps a re-sort from shuffling rows the user is
    // looking at for no reason the data can explain.
    const flat = [dfs(0, 'demo-3'), dfs(0, 'demo-1'), dfs(0, 'demo-2')];
    expect(ids(sortDfsBlocks(flat, () => 0))).toEqual(['demo-3', 'demo-1', 'demo-2']);
  });
});

describe('sk-285.2.19 (step 4) — what a heading click does', () => {
  test('a new column opens at its natural direction', () => {
    // sk-285.2.20 — the fixture this replaced could not tell the right
    // answer from two wrong ones. It asked for «updated» while «id» was
    // read descending, and for «priority» while «id» was read ascending
    // — and in both pairs the CURRENT direction already equalled the new
    // column's natural one, so «carry the current direction over» passed
    // it unchanged. (Its own comment claimed the opposite arrangement.)
    //
    // Two wrong implementations have to be excluded, and no single case
    // excludes both:
    //
    //   • «keep the current direction» — dies only where the current
    //     direction DIFFERS from the new column's natural one;
    //   • «flip whatever is there» — dies only where it MATCHES.
    //
    // So every sortable column is asked for from every other key, in
    // both directions, and the answer is always that column's own
    // natural direction. Both relations occur throughout, and the loop
    // cannot be satisfied by carrying or by flipping.
    for (const column of ['id', 'priority', 'updated', 'created'] as const) {
      for (const sort of EVERY_KEY) {
        if (sort === treeColumnSortKey(column)) continue; // reversal — next test
        for (const direction of EVERY_DIRECTION) {
          expect(
            nextSortForColumn(column, { sort, direction }),
            `${column} from ${sort}:${direction}`,
          ).toEqual({
            sort: treeColumnSortKey(column),
            direction: defaultSortDirection(treeColumnSortKey(column)!),
          });
        }
      }
    }

    // Spelled out for the reader, one of each relation, so the property
    // above is legible without running it: «updated» is naturally desc
    // and «priority» naturally asc, and neither carries nor flips the
    // direction it was asked from.
    expect(nextSortForColumn('updated', { sort: 'id', direction: 'asc' })).toEqual({
      sort: 'updated',
      direction: 'desc',
    });
    expect(nextSortForColumn('updated', { sort: 'id', direction: 'desc' })).toEqual({
      sort: 'updated',
      direction: 'desc',
    });
    expect(nextSortForColumn('priority', { sort: 'id', direction: 'asc' })).toEqual({
      sort: 'priority',
      direction: 'asc',
    });
    expect(nextSortForColumn('priority', { sort: 'id', direction: 'desc' })).toEqual({
      sort: 'priority',
      direction: 'asc',
    });
  });

  test('the column already sorted reverses', () => {
    expect(nextSortForColumn('updated', { sort: 'updated', direction: 'desc' })).toEqual({
      sort: 'updated',
      direction: 'asc',
    });
    expect(nextSortForColumn('updated', { sort: 'updated', direction: 'asc' })).toEqual({
      sort: 'updated',
      direction: 'desc',
    });
  });

  test('a column the sort model has no key for is not a sort control', () => {
    for (const column of ['title', 'status', 'blocked', 'type', 'assignee', 'components', 'labels', 'progress'] as const) {
      expect(treeColumnSortKey(column), column).toBeNull();
      expect(nextSortForColumn(column, { sort: 'id', direction: 'asc' }), column).toBeNull();
    }
    for (const column of ['id', 'priority', 'updated', 'created'] as const) {
      expect(treeColumnSortKey(column), column).not.toBeNull();
    }
  });

  test('the composite default marks no single column', () => {
    // `priority-updated` is two keys at once; pointing an arrow at one of
    // them would claim the table is ordered by that column alone.
    expect(sortedTreeColumn('priority-updated')).toBeNull();
    expect(sortedTreeColumn('updated')).toBe('updated');
    expect(sortedTreeColumn('id')).toBe('id');
  });
});

describe('sk-285.2.19 (step 5) — a direction belongs to its own key', () => {
  test('the stored direction applies to the stored key', () => {
    expect(directionFor('updated', { sort: 'updated', direction: 'asc' })).toBe('asc');
    expect(directionFor('priority', { sort: 'priority', direction: 'desc' })).toBe(
      'desc',
    );
  });

  test('any OTHER key is read naturally — the reversal does not travel', () => {
    // The case that produces this in the app: a search replaces the
    // persisted key with an ephemeral one (`effectiveSort`) while the
    // stored direction, chosen for «Updated», stays behind. Carried over,
    // it would reverse a key the reader never picked it for.
    const reversedUpdated = { sort: 'updated', direction: 'asc' } as const;
    expect(directionFor('priority', reversedUpdated)).toBe('asc'); // natural for priority
    expect(directionFor('created', reversedUpdated)).toBe('desc'); // natural for created
    expect(directionFor('relevance', reversedUpdated)).toBe(
      defaultSortDirection('relevance'),
    );
  });

  // Hand-written from the natural directions the combobox labels describe
  // («Updated» and «Created» newest first, everything else ascending), not
  // read from the product map.
  const NATURAL: Record<TasksSortKey, TasksSortDirection> = {
    'priority-updated': 'asc',
    priority: 'asc',
    updated: 'desc',
    created: 'desc',
    id: 'asc',
    relevance: 'asc',
  };

  test.each([
    ['priority-updated', 'asc'],
    ['priority-updated', 'desc'],
    ['priority', 'asc'],
    ['priority', 'desc'],
    ['updated', 'asc'],
    ['updated', 'desc'],
    ['created', 'asc'],
    ['created', 'desc'],
    ['id', 'asc'],
    ['id', 'desc'],
    ['relevance', 'asc'],
    ['relevance', 'desc'],
  ] as const)('stored %s:%s applies to %s itself', (key, direction) => {
    expect(directionFor(key, { sort: key, direction })).toBe(direction);
  });

  test('every other stored key and direction leaves the active key natural', () => {
    for (const active of EVERY_KEY) {
      for (const sort of EVERY_KEY.filter((k) => k !== active)) {
        for (const direction of EVERY_DIRECTION) {
          expect(directionFor(active, { sort, direction }), `${active} vs ${sort}:${direction}`).toBe(
            NATURAL[active],
          );
        }
      }
    }
  });
});

describe('sk-285.2.19 (step 4) — the stored preference', () => {
  test('key and direction survive a round trip through one value', () => {
    for (const sort of EVERY_KEY) {
      for (const direction of EVERY_DIRECTION) {
        const raw = formatSortPref({ sort, direction });
        expect(parseSortPref(raw), raw).toEqual({ sort, direction });
      }
    }
  });

  test('a value written before directions existed still loads', () => {
    // The bare key is what every older build wrote; it means that key at
    // its natural direction, and the reader fills that in.
    expect(parseSortPref('updated')).toEqual({ sort: 'updated', direction: null });
    expect(defaultSortDirection('updated')).toBe('desc');
    expect(defaultSortDirection('priority')).toBe('asc');
    expect(defaultSortDirection('id')).toBe('asc');
  });

  test('a damaged direction degrades to "none stated", not to a wrong order', () => {
    expect(parseSortPref('updated:sideways')).toEqual({
      sort: 'updated',
      direction: null,
    });
    expect(parseSortPref('')).toBeNull();
    expect(parseSortPref(null)).toBeNull();
  });

  test('the natural direction of every key is stated', () => {
    // A key missing from the map would read as `undefined` and turn
    // every comparison into the reversed branch by accident.
    for (const sort of EVERY_KEY) {
      expect(EVERY_DIRECTION, sort).toContain(NATURAL_SORT_DIRECTION[sort]);
    }
  });
});

/**
 * sk-421.2 T012 — the consumer of the id order rule (US-6, F-7 frontend half).
 *
 * The comparator lives in `hierIdCompare`, and the full reference list from the appendix
 * "Reference id sample" is pinned by its own test. What is checked here is
 * SOMETHING ELSE: that both consumers in `taskSort` — the "by id" key and the resolution of ties
 * by priority — go through this rule, not through their own comparison.
 *
 * The fixture below DISTINGUISHES the rules, and this was verified by running the real former
 * implementation from history (`git show 6773a92:src/lib/hierIdCompare.ts`), not by
 * reasoning:
 *
 *   old rule: sk--1, sk-002, sk-2, sk-2.2, sk-2.10, sk-10
 *   new rule: sk-2, sk-2.2, sk-2.10, sk-002, sk-10, sk--1
 *
 * That is, before T011 these assertions would have been red. They arrive green
 * because T011 already fixed the rule under them: their job is to guard that the
 * consumer does not introduce a local comparison again.
 */
describe('sk-421.2 T012 — the "by id" key and priority ties on the new rule', () => {
  const MIXED = [
    dfs(0, 'sk--1'),
    dfs(0, 'sk-10'),
    dfs(0, 'sk-002'),
    dfs(0, 'sk-2.10'),
    dfs(0, 'sk-2.2'),
    dfs(0, 'sk-2'),
  ];

  test('the "by id" key orders siblings by the id order rule', () => {
    expect(ids(sortDfsBlocks(MIXED, compareIssuesBy('id', 'asc')))).toEqual([
      'sk-2',
      'sk-2.2',
      'sk-2.10',
      'sk-002',
      'sk-10',
      'sk--1',
    ]);
  });

  test('the reverse direction mirrors the same order', () => {
    expect(ids(sortDfsBlocks(MIXED, compareIssuesBy('id', 'desc')))).toEqual([
      'sk--1',
      'sk-10',
      'sk-002',
      'sk-2.10',
      'sk-2.2',
      'sk-2',
    ]);
  });

  test('the rule applies at any depth, the block stays contiguous', () => {
    const nested = [
      dfs(0, 'sk-2'),
      dfs(1, 'sk-2.10'),
      dfs(1, 'sk-2.2'),
      dfs(0, 'sk-002'),
    ];
    expect(ids(sortDfsBlocks(nested, compareIssuesBy('id', 'asc')))).toEqual([
      'sk-2',
      'sk-2.2',
      'sk-2.10',
      'sk-002',
    ]);
  });

  test('ties by priority are resolved by the same rule', () => {
    // All with the same priority — the order is decided entirely by the id rule.
    // On the former rule sk-2 and sk-002 compared as EQUAL (the comparator
    // returned 0), i.e. the order was not defined at all.
    const tied = [dfs(0, 'sk-002'), dfs(0, 'sk-2'), dfs(0, 'sk--1'), dfs(0, 'sk-10')];
    expect(ids(sortDfsBlocks(tied, compareIssuesBy('priority', 'asc')))).toEqual([
      'sk-2',
      'sk-002',
      'sk-10',
      'sk--1',
    ]);
  });

  test('priority still outranks id', () => {
    const mixedPriority = [
      dfs(0, 'sk-2', { priority: 3 }),
      dfs(0, 'sk-10', { priority: 0 }),
    ];
    expect(
      ids(sortDfsBlocks(mixedPriority, compareIssuesBy('priority', 'asc'))),
    ).toEqual(['sk-10', 'sk-2']);
  });

  test('synthetic stub ids are ordered like ordinary ids', () => {
    // US-6: the frontend sort does not know about stubs and does not single them out —
    // the "stubs after visible siblings" rule lives in the server response (T005).
    const stubs = [dfs(0, 'hidden-10'), dfs(0, 'hidden-2'), dfs(0, 'hidden-1')];
    expect(ids(sortDfsBlocks(stubs, compareIssuesBy('id', 'asc')))).toEqual([
      'hidden-1',
      'hidden-2',
      'hidden-10',
    ]);
  });
});
