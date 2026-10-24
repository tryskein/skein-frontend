/**
 * sk-285.2.19 — the tree row is a TABLE ROW: one cell per column, in the
 * order the registry gives, with everything structural in the first one.
 *
 * ─── What this file replaced, and why ──────────────────────────────
 *
 * It used to assert the OPPOSITE arrangement (sk-285.5.4): that the tree
 * row and the card stacked the same three blocks in the same order —
 * title block, then the id on its own line, then a meta row — so that
 * flipping Cards ↔ Tree changed the list's structure and not the shape
 * of its rows. That was the right property for a tree of mini-cards and
 * it is the wrong one for a table: a stack whose id and meta line follow
 * however much title the row above happened to have gives the eye no
 * column to scan down, which is the entire reason the tree became a
 * table. The card keeps that stack; `TaskCard` is still a card.
 *
 * ─── What is pinned here ───────────────────────────────────────────
 *
 * Everything below is DOM structure, which is what a jsdom render can
 * honestly see. Nothing here measures anything: vitest runs with
 * `css: false` and there is no layout engine, so column widths, the
 * ellipsis and the fixed row height are pinned in
 * `TreeTableLayout.test.tsx` against the stylesheet instead.
 *
 *   1. one cell per column, in registry order, title first;
 *   2. the columns the user switched OFF are not printed;
 *   3. the chevron, the indent carrier and the title all live in the
 *      FIRST cell — nothing structural leaks right, and since
 *      sk-285.2.23 there is no typed-edge connector among them;
 *   4. a value cell holds the value the registry says it holds.
 */

import { afterEach, describe, expect, test } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { TaskTreeNode } from '../TaskTreeNode';
import {
  TREE_DEFAULT_COLUMNS,
  TREE_OPTIONAL_COLUMNS,
  treeColumnOrder,
  treeColumnsMask,
  type TreeOptionalColumn,
} from '../../../lib/treeColumns';
import type { IssueSummary } from '../../../api/issues';
import type { FlatTreeRow } from '../../../lib/flattenTree';

function issue(over: Partial<IssueSummary> = {}): IssueSummary {
  return {
    id: 'sk-42.1',
    projectId: 'p',
    version: 1,
    title: 'hello world',
    type: 'task',
    priority: 3,
    status: 'open',
    pinned: false,
    componentIds: [],
    labels: [],
    isBlocked: false,
    updatedAt: '2026-05-01T10:00:00Z',
    createdAt: '2026-05-01T10:00:00Z',
    ...over,
  };
}

function row(item: IssueSummary, over: Partial<FlatTreeRow> = {}): FlatTreeRow {
  return {
    item,
    depth: 0,
    edgeType: null,
    isReference: false,
    isContext: false,
    firstSeenAt: null,
    hasChildren: false,
    ...over,
  };
}

function renderTreeNode(
  r: FlatTreeRow,
  columns: readonly TreeOptionalColumn[] = TREE_DEFAULT_COLUMNS,
  componentNames = new Map<string, string>(),
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MantineProvider forceColorScheme="dark">
        <MemoryRouter>
          <TaskTreeNode
            row={r}
            selectedId={null}
            expanded={new Set()}
            searchQuery=""
            componentNames={componentNames}
            columns={treeColumnOrder(columns)}
            columnsMask={treeColumnsMask(columns)}
            onSelect={() => {}}
            onToggle={() => {}}
            // sk-285.2.13 — a lone row is a set of one.
            position={{ setSize: 1, posInSet: 1 }}
            // sk-285.2.19 — a lone row is the first data row of a
            // one-row grid: the header row is aria-rowindex 1.
            ariaRowIndex={2}
          />
        </MemoryRouter>
      </MantineProvider>
    </QueryClientProvider>,
  );
}

/**
 * The row's cells, named by the column each one carries — read off the
 * `task-tree-cell--{column}` modifier, in DOM order.
 */
function cellColumns(container: Element): string[] {
  return [...container.querySelectorAll('.task-tree-cell')].map((el) => {
    const modifier = [...el.classList].find((c) =>
      c.startsWith('task-tree-cell--'),
    );
    return modifier?.replace('task-tree-cell--', '') ?? '?';
  });
}

/** Text of the cell carrying `column`. */
function cellText(container: Element, column: string): string {
  return (
    container.querySelector(`.task-tree-cell--${column}`)?.textContent ?? ''
  );
}

/**
 * The default set plus the `blocked` column — for the four tests that are
 * about that column's own behaviour. sk-285.2.22 dropped `blocked` from
 * the defaults (see `TREE_DEFAULT_COLUMNS`: the status chip carries the
 * marker while the column is off), so "the defaults" is no longer a way
 * to get the cell on screen.
 */
const WITH_BLOCKED: readonly TreeOptionalColumn[] = [
  ...TREE_DEFAULT_COLUMNS,
  'blocked',
];

afterEach(() => cleanup());

describe('sk-285.2.19 — one cell per column, registry order, title first', () => {
  test('the default row prints the title column and every default column', () => {
    const { container } = renderTreeNode(row(issue()));
    expect(cellColumns(container)).toEqual([
      'title',
      ...TREE_DEFAULT_COLUMNS,
    ]);
  });

  test('every switchable column on: still one cell each, registry order', () => {
    const { container } = renderTreeNode(row(issue()), TREE_OPTIONAL_COLUMNS);
    expect(cellColumns(container)).toEqual([
      'title',
      ...TREE_OPTIONAL_COLUMNS,
    ]);
  });

  test('switching a column off removes exactly that cell', () => {
    const without = TREE_DEFAULT_COLUMNS.filter((c) => c !== 'assignee');
    const { container } = renderTreeNode(row(issue()), without);
    expect(cellColumns(container)).toEqual(['title', ...without]);
    expect(container.querySelector('.task-tree-cell--assignee')).toBeNull();
  });

  test('the empty set leaves the tree itself — a bare column of titles', () => {
    // A legal choice (see `parseTreeColumns`): the title column is
    // structural, so it cannot be switched off with the rest.
    const { container } = renderTreeNode(row(issue()), []);
    expect(cellColumns(container)).toEqual(['title']);
    expect(container.querySelector('.task-card-title-text')?.textContent).toBe(
      'hello world',
    );
  });
});

describe('sk-285.2.19 — the first cell is the tree, and nothing leaks right', () => {
  test('chevron and title are both inside the title cell', () => {
    // sk-285.2.23 — the connector used to be pinned here as a third
    // structural element of this cell. It is not rendered any more (see
    // the next test, and `TreeIndentGuides.test.tsx` for the removal
    // guard): the cell now opens straight on the chevron.
    const { container } = renderTreeNode(
      row(issue(), { depth: 2, edgeType: 'parent-child', hasChildren: true }),
    );
    const title = container.querySelector('.task-tree-cell--title')!;
    expect(title.querySelector('.task-tree-toggle')).not.toBeNull();
    expect(title.querySelector('.task-card-title-text')?.textContent).toBe(
      'hello world',
    );
  });

  test('and nothing draws the typed edge — no connector, in any cell', () => {
    // The row below carries `edgeType: 'parent-child'` at depth 2, which
    // is exactly the condition the removed slot rendered on. Asserted
    // over the WHOLE row rather than the title cell alone: the point of
    // the removal is that the glyph column in the left gutter is gone,
    // not that it moved.
    const { container } = renderTreeNode(
      row(issue(), { depth: 2, edgeType: 'parent-child', hasChildren: true }),
    );
    expect(container.querySelector('.task-tree-connector')).toBeNull();
  });

  test('no value cell contains a chevron or a title', () => {
    // The property the table exists for: a deeper row moves its title and
    // leaves the value columns where the header put them. A structural
    // element inside a value cell would be indented with the row.
    const { container } = renderTreeNode(
      row(issue(), { depth: 4, edgeType: 'blocks', hasChildren: true }),
      TREE_OPTIONAL_COLUMNS,
    );
    const values = [...container.querySelectorAll('.task-tree-cell')].filter(
      (el) => !el.classList.contains('task-tree-cell--title'),
    );
    expect(values.length).toBe(TREE_OPTIONAL_COLUMNS.length);
    for (const cell of values) {
      expect(cell.querySelector('.task-tree-toggle')).toBeNull();
      expect(cell.querySelector('.task-tree-toggle-placeholder')).toBeNull();
      expect(cell.querySelector('.task-card-title-text')).toBeNull();
    }
  });

  test('the depth is carried by the ROW, not a cell', () => {
    // The treegrid row publishes its level; a cell that carried its own
    // would make the row and its cells disagree about where they sit.
    const { container } = renderTreeNode(row(issue(), { depth: 3 }));
    const rowEl = container.querySelector<HTMLElement>('.task-tree-node-row')!;
    expect(rowEl.getAttribute('aria-level')).toBe('4');
    for (const cell of container.querySelectorAll<HTMLElement>('.task-tree-cell')) {
      expect(cell.hasAttribute('aria-level')).toBe(false);
    }
  });
});

describe('sk-285.2.19 — each cell carries its own column’s value', () => {
  test('id, assignee, components, labels and progress land in their cells', () => {
    const { container } = renderTreeNode(
      row(
        issue({
          id: 'sk-42.7',
          assignee: 'kim',
          componentIds: ['c-1', 'c-2'],
          labels: ['research', 'ui'],
          type: 'epic',
          // sk-489 T016 — summary of the new server: the cell label became
          // "done X/Y". The old form lives in its own case below.
          epicProgress: { closed: 3, total: 9, done: 3, counted: 9, noWork: 0 },
        }),
      ),
      TREE_OPTIONAL_COLUMNS,
      new Map([
        ['c-1', 'api'],
        ['c-2', 'web'],
      ]),
    );
    expect(cellText(container, 'id')).toContain('sk-42.7');
    expect(cellText(container, 'assignee')).toBe('kim');
    expect(cellText(container, 'components')).toBe('api, web');
    expect(cellText(container, 'labels')).toBe('research, ui');
    // sk-285.2.20 — the WHOLE string, not "it mentions a 3 and a 9".
    // `card.epicProgressPlain` takes two interchangeable numbers, and a
    // `{closed, total}` swapped at the call site prints «9/3 closed» —
    // an epic with three times more work done than it has — while a
    // pair of `toContain`s stays green either way.
    //
    // sk-407 (3) — and the trailing `· ` is gone with the key. The cell
    // used to ask for `card.epicProgress`, a form whose separator only
    // makes sense inside a META LINE of segments joined end to end. A
    // table cell joins nothing, so the column printed a dangling glyph —
    // and paid 9.14px of a 72px track for it (Chromium, 1440, ru). The
    // list card had already moved to the plain form; this cell was the
    // separator variant's last reader, so the key went with it.
    expect(cellText(container, 'progress')).toBe('(3/9 done)');
  });

  test('an unassigned row says so rather than leaving the cell blank', () => {
    const { container } = renderTreeNode(row(issue({ assignee: null })));
    expect(cellText(container, 'assignee')).not.toBe('');
  });

  test('a row carrying no rollup leaves the progress cell empty', () => {
    // The cell prints what the ROW carries, and this fixture carries
    // nothing: a leaf has no children, so the tree endpoint computes no
    // pair for it and a rollup invented here would be a number nothing
    // stands behind.
    //
    // sk-462 — it is no longer "non-epics never get one". That was true
    // while the endpoint gated the projection on `type = 'epic'`; sk-461
    // removed the gate, and the case that used to be impossible is
    // pinned by the test below.
    const { container } = renderTreeNode(row(issue()), TREE_OPTIONAL_COLUMNS);
    expect(container.querySelector('.task-tree-cell--progress')).not.toBeNull();
    expect(cellText(container, 'progress')).toBe('');
  });

  test('sk-462 — a NON-EPIC parent prints its share, like any row carrying one', () => {
    // sk-461 removed the `type = 'epic'` gate from the tree endpoint's
    // progress projection: `epicProgress` now rides on every row that has
    // children. Both readers of `useLayeredTree` print what arrives —
    // the epic section (`EpicProgressSection`), for which the fix was
    // made, and this column, which got the behaviour in passing. The
    // owner kept it, so it is ASSERTED here rather than left for the
    // next edit to drop in silence.
    //
    // The fixture CARRIES the field, on a `task` row with children: a
    // fixture without the key stays green whether the cell prints a
    // share or not, and that blindness is exactly why sk-461 lived long
    // enough to be found by hand.
    const { container } = renderTreeNode(
      row(issue({ type: 'task', epicProgress: { closed: 2, total: 5 } }), {
        hasChildren: true,
      }),
      TREE_OPTIONAL_COLUMNS,
    );
    // The WHOLE string, for the reason the epic row's own assertion
    // gives: two interchangeable numbers swapped at the call site still
    // pass a pair of `toContain`s.
    //
    // sk-489 T016 — this fixture INTENTIONALLY stayed without the total fields:
    // it is also the rollout-window guard for the cell (US-10, SC-010). An api
    // response that knows nothing about the total must print today's pair
    // in today's words — "closed", not "done".
    expect(cellText(container, 'progress')).toBe('(2/5 closed)');
  });

  test('the two date columns each print their OWN date', () => {
    // sk-285.2.20 — nothing could see these two cells. Both run through
    // `formatRelative`, so a cell wired to the wrong timestamp still
    // prints a plausible date; `updated` is on by DEFAULT and is half of
    // the default sort key, so a swap would be read as the truth. A
    // fixture whose two dates are equal — which is what every other row
    // in this file uses — cannot tell them apart at all.
    //
    // The dates are far enough in the past that `formatRelative` returns
    // the absolute form, so the assertion needs no control over the
    // clock and cannot rot into "N days ago" as the suite ages.
    //
    // sk-285.6.7 — that absolute form now states its zone (`… UTC`).
    // The product does not know the reader's timezone (sk-340), so a
    // bare `2024-01-02` was a date silently claiming to be local; the
    // marker is part of the label, not decoration on it.
    const { container } = renderTreeNode(
      row(
        issue({
          createdAt: '2024-01-02T03:04:05Z',
          updatedAt: '2024-03-04T05:06:07Z',
        }),
      ),
      TREE_OPTIONAL_COLUMNS,
    );
    expect(cellText(container, 'created')).toBe('2024-01-02 UTC');
    expect(cellText(container, 'updated')).toBe('2024-03-04 UTC');
  });

  test('and each hands the exact instant over on hover', () => {
    // The relative form is lossy on purpose; the `title` is where the
    // reader gets the real timestamp back, and it has to be the same
    // row's own field rather than whichever date the cell printed.
    //
    // sk-285.6.7 — what comes back on hover is now the PRODUCT's stamp
    // (`formatTimestamp`, minute precision, zone stated), not the raw
    // wire ISO. The hover is a thing a human reads; `2024-01-02T03:04:05Z`
    // was the transport leaking into the UI, and it differed from the
    // hover on every other timestamp in the app.
    const { container } = renderTreeNode(
      row(
        issue({
          createdAt: '2024-01-02T03:04:05Z',
          updatedAt: '2024-03-04T05:06:07Z',
        }),
      ),
      TREE_OPTIONAL_COLUMNS,
    );
    expect(
      container.querySelector('.task-tree-cell--created')?.getAttribute('title'),
    ).toBe('2024-01-02 03:04 UTC');
    expect(
      container.querySelector('.task-tree-cell--updated')?.getAttribute('title'),
    ).toBe('2024-03-04 05:06 UTC');
  });

  test('the blocked column carries the marker, and the status chip yields it', () => {
    // One fact, one cell. With a blocked column on screen the status chip
    // states the WIRE status — otherwise the row would say "blocked"
    // twice and never say what the task's own status is.
    //
    // The column set is stated explicitly: sk-285.2.22 took `blocked` out
    // of `TREE_DEFAULT_COLUMNS` (it is folded back into the status chip
    // while it is off — the very next test), so a test about the blocked
    // COLUMN has to switch it on rather than lean on the defaults.
    const { container } = renderTreeNode(
      row(issue({ status: 'in_progress', isBlocked: true })),
      WITH_BLOCKED,
    );
    expect(cellText(container, 'blocked')).toContain('blocked');
    // sk-285.7 fidelity T3 — the badge spells the status as prose
    // («in progress»), so the underscore of the wire value is gone from
    // every chip. The claim here is unchanged: the status cell states the
    // task's OWN status rather than repeating «blocked».
    expect(cellText(container, 'status')).toContain('in progress');
    expect(cellText(container, 'status')).not.toContain('blocked');
  });

  test('with no blocked column the status chip carries the marker again', () => {
    // The fallback that keeps the fact on screen: a reader who switched
    // the blocked column off must not lose blocked-ness entirely.
    const { container } = renderTreeNode(
      row(issue({ status: 'in_progress', isBlocked: true })),
      // …which is the DEFAULT set since sk-285.2.22. Stated through the
      // filter anyway: the claim is "with the blocked column off", and it
      // must keep holding if the defaults ever carry it again.
      TREE_DEFAULT_COLUMNS.filter((c) => c !== 'blocked'),
    );
    expect(container.querySelector('.task-tree-cell--blocked')).toBeNull();
    expect(cellText(container, 'status')).toContain('blocked');
  });

  test('a CLOSED row with a stale blocker edge leaves the blocked cell empty', () => {
    // The suppression rule (`isDerivedBlocked`): a terminal status beats
    // a stale blocker edge, so there is no blocked-ness to print. What
    // must NOT happen is the cell falling through to an ordinary status
    // chip — the blocked column would then print `closed`, i.e. the
    // STATUS column's value, and the two columns would say the same
    // thing while claiming to answer different questions.
    const { container } = renderTreeNode(
      row(issue({ status: 'closed', isBlocked: true })),
      WITH_BLOCKED,
    );
    expect(container.querySelector('.task-tree-cell--blocked')).not.toBeNull();
    expect(cellText(container, 'blocked')).toBe('');
    expect(cellText(container, 'status')).toContain('closed');
  });

  test('and a STANDING row does the same — the column is about blocked-ness only', () => {
    // sk-118: nothing can block a standing task, so the marker is
    // suppressed there too.
    const { container } = renderTreeNode(
      row(issue({ status: 'standing', isBlocked: true })),
      WITH_BLOCKED,
    );
    expect(cellText(container, 'blocked')).toBe('');
    expect(cellText(container, 'status')).toContain('standing');
  });

  test('a hidden cross-project stub prints its cells EMPTY, not invented', () => {
    // The stub is a placeholder for a record the caller cannot read.
    // Its cells stay in place (or the columns to the right would slide
    // left on exactly the rows that already read as odd) and stay blank.
    const { container } = renderTreeNode(
      row(issue({ title: '<hidden>' }), {
        depth: 1,
        edgeType: 'parent-child',
        isReference: true,
        firstSeenAt: null,
      }),
    );
    expect(cellColumns(container)).toEqual(['title', ...TREE_DEFAULT_COLUMNS]);
    for (const column of TREE_DEFAULT_COLUMNS) {
      expect(cellText(container, column), column).toBe('');
    }
  });
});

/**
 * sk-489 T016 (US-6, INV-5, SC-008, SC-010; test plan row 62) — the
 * "Progress" cell of the Tasks column.
 *
 * The second of three label places. Its own, not "the same as the card's":
 * the cell calls its own rule, and an error exactly in it is green for
 * the other two — i18n params are not typed, the compiler does not
 * catch such a swap.
 */
describe('sk-489 T016 — progress cell: "done out of counted"', () => {
  const cell = (epicProgress: IssueSummary['epicProgress']): string => {
    const { container } = renderTreeNode(
      row(issue({ type: 'epic', epicProgress }), { hasChildren: true }),
      TREE_OPTIONAL_COLUMNS,
    );
    return cellText(container, 'progress');
  };

  // sk-540.3 — the cell is 92px wide and clips (review sk-540.12/.13), so
  // it keeps the bare counted pair; the excluded tail lives on the list
  // card, the branch row and the ring. When nothing is counted, the short
  // "excluded: N" replaces the pair. Expected strings: sk-540.3 / sk-540.5.
  test.each([
    {
      name: '3 done + 1 won\'t do → counted pair, no tail in the narrow cell',
      progress: { closed: 4, total: 4, done: 3, counted: 3, noWork: 1 },
      want: '(3/3 done)',
    },
    {
      name: '2 done + 1 open + 1 duplicate → counted pair, not "(3/4 closed)"',
      progress: { closed: 3, total: 4, done: 2, counted: 3, noWork: 1 },
      want: '(2/3 done)',
    },
    {
      name: 'every counted child excluded → the short excluded caption, not "0/0"',
      progress: { closed: 2, total: 2, done: 0, counted: 0, noWork: 2 },
      want: 'excluded: 2',
    },
    {
      name: 'no children → the pair, no tail',
      progress: { closed: 0, total: 0, done: 0, counted: 0, noWork: 0 },
      want: '(0/0 done)',
    },
  ])('sk-540.3 — $name', ({ progress, want }) => {
    expect(cell(progress)).toBe(want);
  });

  test('US-10, SC-010 — a response without the new fields: the old pair in the old words', () => {
    expect(cell({ closed: 3, total: 4 })).toBe('(3/4 closed)');
  });
});
