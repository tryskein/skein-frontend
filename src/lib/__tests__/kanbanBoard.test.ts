/**
 * sk-285.2.3 — the board's model rules.
 *
 * These are the rules the paint and the drop handler BOTH read, so a
 * regression here is a regression in two places at once: a column that
 * looks droppable and is not, or a card that lands in a column the
 * server will reject. Hence a DOM-free test of the rules themselves.
 */

import { describe, expect, test } from 'vitest';
import {
  KANBAN_CLOSED_WINDOW_DAYS,
  KANBAN_COLUMN_ORDER,
  buildKanbanColumns,
  isCardDraggable,
  isColumnDroppable,
  isColumnHiddenByFilter,
  isKanbanDraggable,
  isKanbanDropTarget,
  isWithinClosedWindow,
  nextMultiValue,
  otherAxisValues,
} from '../kanbanBoard';
import type { IssueStatus, IssueSummary } from '../../api/issues';

const NOW = Date.parse('2026-08-21T12:00:00Z');
const daysAgo = (n: number) =>
  new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString();

function issue(over: Partial<IssueSummary> = {}): IssueSummary {
  return {
    id: 'sk-1',
    projectId: 'p',
    version: 1,
    title: 'hello',
    type: 'task',
    priority: 3,
    status: 'open',
    pinned: false,
    componentIds: [],
    labels: [],
    isBlocked: false,
    updatedAt: daysAgo(1),
    createdAt: daysAgo(1),
    ...over,
  };
}

describe('kanban column axis', () => {
  test('the promised flow order is open → in_progress → deferred → closed', () => {
    const flow = KANBAN_COLUMN_ORDER.filter((s) => s !== 'standing');
    expect(flow).toEqual(['open', 'in_progress', 'deferred', 'closed']);
  });

  test('standing is present as a column, and sits outside the flow', () => {
    expect(KANBAN_COLUMN_ORDER).toContain('standing');
    expect(KANBAN_COLUMN_ORDER.indexOf('standing')).toBe(
      KANBAN_COLUMN_ORDER.length - 1,
    );
  });

  test('standing is the only status locked in BOTH directions', () => {
    for (const s of KANBAN_COLUMN_ORDER) {
      const locked = s === 'standing';
      expect(isKanbanDraggable(s)).toBe(!locked);
      expect(isKanbanDropTarget(s)).toBe(!locked);
    }
  });
});

describe('closed window', () => {
  test('a closure inside the window is shown, one outside is not', () => {
    expect(isWithinClosedWindow(daysAgo(0), NOW)).toBe(true);
    expect(isWithinClosedWindow(daysAgo(KANBAN_CLOSED_WINDOW_DAYS - 1), NOW)).toBe(
      true,
    );
    expect(isWithinClosedWindow(daysAgo(KANBAN_CLOSED_WINDOW_DAYS + 1), NOW)).toBe(
      false,
    );
  });

  test('an unreadable timestamp keeps the card rather than dropping it', () => {
    expect(isWithinClosedWindow('not-a-date', NOW)).toBe(true);
  });

  test('only the closed column is windowed — old open work still shows', () => {
    const cols = buildKanbanColumns(
      {
        axis: 'status',
        items: [
          issue({ id: 'a', status: 'open', updatedAt: daysAgo(400) }),
          issue({ id: 'b', status: 'closed', updatedAt: daysAgo(400) }),
          issue({ id: 'c', status: 'closed', updatedAt: daysAgo(2) }),
        ],
        statusFilter: 'all',
        now: NOW,
      },
    );
    const open = cols.find((c) => c.value === 'open')!;
    const closed = cols.find((c) => c.value === 'closed')!;
    expect(open.items.map((i) => i.id)).toEqual(['a']);
    expect(closed.items.map((i) => i.id)).toEqual(['c']);
    // The dropped closure is REPORTED, not silently swallowed.
    expect(closed.hiddenByWindow).toBe(1);
  });
});

describe('the shared status filter blanks columns rather than rows', () => {
  test("the default 'active' filter blanks exactly the closed column", () => {
    for (const s of KANBAN_COLUMN_ORDER) {
      expect(isColumnHiddenByFilter(s, 'active')).toBe(s === 'closed');
    }
  });

  test("'all' and the derived 'blocked' lens blank nothing", () => {
    for (const s of KANBAN_COLUMN_ORDER) {
      expect(isColumnHiddenByFilter(s, 'all')).toBe(false);
      expect(isColumnHiddenByFilter(s, 'blocked')).toBe(false);
    }
  });

  test('a single-status filter blanks every other column', () => {
    for (const s of KANBAN_COLUMN_ORDER) {
      expect(isColumnHiddenByFilter(s, 'in_progress')).toBe(s !== 'in_progress');
    }
  });

  test('a blanked column holds no cards even when rows for it exist', () => {
    const cols = buildKanbanColumns({
      axis: 'status',
      items: [issue({ id: 'a', status: 'closed', updatedAt: daysAgo(1) })],
      statusFilter: 'active',
      now: NOW,
    });
    const closed = cols.find((c) => c.value === 'closed')!;
    expect(closed.hiddenByFilter).toBe(true);
    expect(closed.items).toHaveLength(0);
  });
});

describe('bucketing', () => {
  test('every visible issue lands in the column of its own status', () => {
    const statuses: IssueStatus[] = [
      'open',
      'in_progress',
      'deferred',
      'closed',
      'standing',
    ];
    const items = statuses.map((s, i) => issue({ id: `i${i}`, status: s }));
    const cols = buildKanbanColumns({ axis: 'status', items, statusFilter: 'all', now: NOW });
    for (const col of cols) {
      expect(col.items.map((i) => i.status)).toEqual([col.value]);
    }
  });

  test('the list order the shared sort produced is preserved inside a column', () => {
    const items = [
      issue({ id: 'first' }),
      issue({ id: 'second' }),
      issue({ id: 'third' }),
    ];
    const cols = buildKanbanColumns({ axis: 'status', items, statusFilter: 'all', now: NOW });
    expect(cols[0].items.map((i) => i.id)).toEqual(['first', 'second', 'third']);
  });

  test('column counts are exactly the cards the column renders', () => {
    // The outboxMode lens is applied upstream (useTasks narrows the wire
    // query), so "count == items.length" is what keeps the head honest
    // under the lens: whatever rows arrive, the number is derived from
    // them and cannot drift from the cards beneath it.
    const items = [
      issue({ id: 'a', status: 'open' }),
      issue({ id: 'b', status: 'open' }),
      issue({ id: 'c', status: 'in_progress' }),
    ];
    const cols = buildKanbanColumns({ axis: 'status', items, statusFilter: 'all', now: NOW });
    const byStatus = Object.fromEntries(
      cols.map((c) => [c.value, c.items.length]),
    );
    expect(byStatus).toMatchObject({ open: 2, in_progress: 1, deferred: 0 });
  });

  test('an unknown wire status is dropped, not given a column of its own', () => {
    const cols = buildKanbanColumns({
      axis: 'status',
      items: [issue({ id: 'x', status: 'wat' as IssueStatus })],
      statusFilter: 'all',
      now: NOW,
    });
    expect(cols).toHaveLength(KANBAN_COLUMN_ORDER.length);
    expect(cols.flatMap((c) => c.items)).toHaveLength(0);
  });

  test('every column is returned even with no issues at all', () => {
    const cols = buildKanbanColumns({ axis: 'status', items: [], statusFilter: 'all', now: NOW });
    expect(cols.map((c) => c.value)).toEqual([...KANBAN_COLUMN_ORDER]);
    expect(cols.every((c) => c.items.length === 0)).toBe(true);
  });
});

/**
 * sk-285.2.4 — the axis is a choice, and every rule above has to hold on
 * each of them. What is asserted here is what the board CANNOT get right
 * by accident: which columns exist per axis, where a card with several
 * values ends up, and which columns refuse a drop before the gesture.
 */
describe('axis: priority', () => {
  const build = (items: IssueSummary[]) =>
    buildKanbanColumns({ axis: 'priority', items, statusFilter: 'all', now: NOW });

  test('five columns, P0 first, present even when empty', () => {
    const cols = build([]);
    expect(cols.map((c) => c.value)).toEqual(['0', '1', '2', '3', '4']);
  });

  test('a card lands in the column of its own priority', () => {
    const cols = build([issue({ id: 'a', priority: 0 }), issue({ id: 'b', priority: 4 })]);
    expect(cols[0].items.map((i) => i.id)).toEqual(['a']);
    expect(cols[4].items.map((i) => i.id)).toEqual(['b']);
  });

  test('every column takes drops — priority has no locked value', () => {
    expect(build([]).every((c) => c.droppable)).toBe(true);
  });

  test('the status filter narrows rows here, it does not blank a column', () => {
    // On the status axis 'active' blanks the Done column; on any other
    // axis the same filter is back to being an ordinary row filter, so
    // no column may claim to be hidden by it.
    const cols = buildKanbanColumns({
      axis: 'priority',
      items: [issue({ id: 'a', priority: 1 })],
      statusFilter: 'active',
      now: NOW,
    });
    expect(cols.some((c) => c.hiddenByFilter)).toBe(false);
  });
});

describe('axis: type', () => {
  test('one column per wire type, in the filter dropdown’s order', () => {
    const cols = buildKanbanColumns({
      axis: 'type',
      items: [],
      statusFilter: 'all',
      now: NOW,
    });
    expect(cols.map((c) => c.value)).toEqual([
      'bug',
      'feature',
      'task',
      'epic',
      'chore',
      'decision',
      'idea',
      'note',
    ]);
  });

  test('cards bucket by their own type', () => {
    const cols = buildKanbanColumns({
      axis: 'type',
      items: [issue({ id: 'a', type: 'bug' }), issue({ id: 'b', type: 'epic' })],
      statusFilter: 'all',
      now: NOW,
    });
    expect(cols[0].items.map((i) => i.id)).toEqual(['a']);
    expect(cols[3].items.map((i) => i.id)).toEqual(['b']);
  });
});

describe('axis: assignee', () => {
  const build = (items: IssueSummary[]) =>
    buildKanbanColumns({ axis: 'assignee', items, statusFilter: 'all', now: NOW });

  test('columns come from the visible cards, sorted, "unassigned" last', () => {
    const cols = build([
      issue({ id: 'a', assignee: 'zoe' }),
      issue({ id: 'b', assignee: 'adam' }),
      issue({ id: 'c', assignee: null }),
    ]);
    expect(cols.map((c) => c.value)).toEqual(['adam', 'zoe', null]);
  });

  test('the "unassigned" column stays even when empty — it is a destination', () => {
    // Dropping into it is the only way to unassign by drag. Were it to
    // vanish with its last card, the axis would be one-way.
    const cols = build([issue({ id: 'a', assignee: 'adam' })]);
    expect(cols.map((c) => c.value)).toEqual(['adam', null]);
    expect(cols[1].items).toHaveLength(0);
  });

  test('an empty assignee string counts as unassigned, not as a person', () => {
    const cols = build([issue({ id: 'a', assignee: '' })]);
    expect(cols.map((c) => c.value)).toEqual([null]);
  });

  test('the unassigned column accepts drops — dropping there unassigns', () => {
    expect(isColumnDroppable('assignee', null)).toBe(true);
  });
});

describe('axis: project — read-only, painted before the gesture', () => {
  test('no column of this axis accepts a drop', () => {
    const cols = buildKanbanColumns({
      axis: 'project',
      items: [issue({ id: 'a', projectId: 'p1' }), issue({ id: 'b', projectId: 'p2' })],
      statusFilter: 'all',
      now: NOW,
    });
    // No trailing "none" bucket either: every issue has a project, and
    // the axis cannot be written anyway.
    expect(cols.map((c) => c.value)).toEqual(['p1', 'p2']);
    expect(cols.some((c) => c.droppable)).toBe(false);
  });

  test('and no card of this axis can be picked up', () => {
    expect(isCardDraggable('project', issue())).toBe(false);
  });
});

describe('axis: component — one task, several columns', () => {
  const build = (items: IssueSummary[], knownComponentIds?: string[]) =>
    buildKanbanColumns({
      axis: 'component',
      items,
      statusFilter: 'all',
      now: NOW,
      knownComponentIds,
    });

  test('a task with two components is rendered in BOTH columns', () => {
    const cols = build([issue({ id: 'a', componentIds: ['api', 'ui'] })]);
    // …plus the always-present "no component" bucket at the end.
    expect(cols.map((c) => c.value)).toEqual(['api', 'ui', null]);
    expect(cols[0].items.map((i) => i.id)).toEqual(['a']);
    expect(cols[1].items.map((i) => i.id)).toEqual(['a']);
  });

  test('so the per-column counts SUM to more than the number of tasks', () => {
    // Deliberate: the card really is in both columns. The board pays for
    // it by naming the duplication on every copy (`otherAxisValues`).
    const cols = build([issue({ id: 'a', componentIds: ['api', 'ui'] })]);
    expect(cols.reduce((n, c) => n + c.items.length, 0)).toBe(2);
  });

  test('a component with no loaded task still gets its (empty) column', () => {
    const cols = build([issue({ id: 'a', componentIds: ['api'] })], ['api', 'db']);
    expect(cols.map((c) => c.value)).toEqual(['api', 'db', null]);
    expect(cols[1].items).toHaveLength(0);
  });

  test('tasks with no component collect in one bucket, last', () => {
    const cols = build([
      issue({ id: 'a', componentIds: ['api'] }),
      issue({ id: 'b', componentIds: [] }),
    ]);
    expect(cols.map((c) => c.value)).toEqual(['api', null]);
    expect(cols[1].items.map((i) => i.id)).toEqual(['b']);
  });

  test('and that bucket survives its last card leaving — detaching needs it', () => {
    const cols = build([issue({ id: 'a', componentIds: ['api'] })]);
    expect(cols.map((c) => c.value)).toEqual(['api', null]);
    expect(cols[1].items).toHaveLength(0);
  });

  test('the duplicate names its other columns, and a single card names none', () => {
    const dup = issue({ id: 'a', componentIds: ['api', 'ui'] });
    expect(otherAxisValues(dup, 'component', 'api')).toEqual(['ui']);
    const single = issue({ id: 'b', componentIds: ['api'] });
    expect(otherAxisValues(single, 'component', 'api')).toEqual([]);
    // Single-value axes never duplicate, so they never claim to.
    expect(otherAxisValues(dup, 'status', 'open')).toEqual([]);
  });
});

describe('axis: label', () => {
  test('a task with two labels is in both columns, sorted, none-bucket last', () => {
    const cols = buildKanbanColumns({
      axis: 'label',
      items: [issue({ id: 'a', labels: ['ux', 'perf'] }), issue({ id: 'b', labels: [] })],
      statusFilter: 'all',
      now: NOW,
    });
    expect(cols.map((c) => c.value)).toEqual(['perf', 'ux', null]);
    expect(cols[0].items.map((i) => i.id)).toEqual(['a']);
    expect(cols[1].items.map((i) => i.id)).toEqual(['a']);
    expect(cols[2].items.map((i) => i.id)).toEqual(['b']);
  });
});

describe('the closed window follows the ISSUE, not the Done column', () => {
  test('an old closure is off the board on a priority axis too', () => {
    const cols = buildKanbanColumns({
      axis: 'priority',
      items: [
        issue({ id: 'old', priority: 1, status: 'closed', updatedAt: daysAgo(400) }),
        issue({ id: 'new', priority: 1, status: 'closed', updatedAt: daysAgo(2) }),
      ],
      statusFilter: 'all',
      now: NOW,
    });
    expect(cols[1].items.map((i) => i.id)).toEqual(['new']);
    expect(cols[1].hiddenByWindow).toBe(1);
  });
});

describe('nextMultiValue — what a drag means on a multi-value axis', () => {
  test('it REPLACES the value of the column dragged from, keeping the rest', () => {
    expect(nextMultiValue(['api', 'ui'], 'api', 'db')).toEqual(['db', 'ui']);
  });

  test('dragging out of the "none" bucket adds the target', () => {
    expect(nextMultiValue([], null, 'db')).toEqual(['db']);
  });

  test('dropping into the "none" bucket removes just that one value', () => {
    expect(nextMultiValue(['api', 'ui'], 'api', null)).toEqual(['ui']);
  });

  test('dropping onto a value the task already has does not duplicate it', () => {
    expect(nextMultiValue(['api', 'ui'], 'api', 'ui')).toEqual(['ui']);
  });
});
