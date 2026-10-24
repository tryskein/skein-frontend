/**
 * sk-285.2.3 — what the board actually renders.
 *
 * The drag itself is a pointer gesture that jsdom cannot honestly
 * simulate (it needs real PointerEvents with coordinates and a layout),
 * and it was verified in a live browser instead. What IS asserted here
 * is everything the drag depends on and everything a keyboard user gets
 * without it: the columns and their accessible names, the read-only
 * column's before-the-attempt lock, the folded-column affordance, and
 * the card being a real button that opens the task.
 */

import { useState } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import i18n from '../../../i18n/config';
import { KanbanBoard, type KanbanBoardProps } from '../KanbanBoard';
import type { IssueSummary, StatusFilter } from '../../../api/issues';
import {
  KANBAN_CARD_FIELDS,
  type KanbanCardField,
} from '../../../lib/kanbanCardFields';

function issue(over: Partial<IssueSummary> = {}): IssueSummary {
  return {
    id: 'sk-1',
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
    updatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    ...over,
  };
}

function renderBoard(over: Partial<KanbanBoardProps> = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const props: KanbanBoardProps = {
    items: [],
    // sk-285.2.4 — the axis is a choice now; 'status' is the default the
    // board opens on with no configuration at all.
    axis: 'status',
    statusFilter: 'all' as StatusFilter,
    onStatusFilterChange: vi.fn(),
    selectedIssueId: null,
    onSelect: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    ...over,
  };
  const utils = render(
    <QueryClientProvider client={client}>
      <MantineProvider forceColorScheme="dark">
        <MemoryRouter>
          <KanbanBoard {...props} />
        </MemoryRouter>
      </MantineProvider>
    </QueryClientProvider>,
  );
  return { ...utils, props };
}

/** Columns are <section aria-label>, i.e. accessible regions. */
function columns() {
  return screen.getAllByRole('region');
}

afterEach(() => cleanup());

describe('KanbanBoard — columns', () => {
  test('renders one column per status, in flow order, with no configuration', () => {
    renderBoard();
    const names = columns().map((c) => c.getAttribute('aria-label') ?? '');
    expect(names).toHaveLength(5);
    expect(names[0]).toMatch(/Open/);
    expect(names[1]).toMatch(/In progress/);
    expect(names[2]).toMatch(/Deferred/);
    expect(names[3]).toMatch(/Done/);
    expect(names[4]).toMatch(/Standing/);
  });

  test('every column names itself and its count for assistive tech', () => {
    renderBoard({
      items: [issue({ id: 'a' }), issue({ id: 'b' }), issue({ id: 'c', status: 'deferred' })],
    });
    const names = columns().map((c) => c.getAttribute('aria-label') ?? '');
    expect(names[0]).toMatch(/Open column, 2 tasks/);
    expect(names[2]).toMatch(/Deferred column, 1 task\b/);
  });

  test('an empty column says so instead of rendering a blank box', () => {
    renderBoard({ items: [issue({ status: 'open' })] });
    expect(within(columns()[1]).getByText('Empty')).toBeTruthy();
  });

  test('counts print with a "+" while more pages are unloaded', () => {
    // "1 on the board so far", not "1 in this status" — the board only
    // ever sees the pages that have been fetched.
    renderBoard({ items: [issue({ id: 'a' })], hasNextPage: true });
    expect(within(columns()[0]).getByText('1+')).toBeTruthy();
  });

  test('and print bare once every page is in', () => {
    renderBoard({ items: [issue({ id: 'a' })], hasNextPage: false });
    expect(within(columns()[0]).getByText('1')).toBeTruthy();
  });
});

describe('KanbanBoard — the standing column is read-only BEFORE the attempt', () => {
  test('its head carries a lock with an explanation, and no other head does', () => {
    renderBoard({ items: [issue({ id: 's', status: 'standing' })] });
    const standing = columns()[4];
    const lock = within(standing).getByRole('img');
    expect(lock.getAttribute('aria-label')).toMatch(/perpetual obligations/i);
    expect(within(columns()[0]).queryByRole('img')).toBeNull();
  });
});

describe('KanbanBoard — the shared status filter', () => {
  test("under the default 'active' filter the Done column is a named way back, not an empty box", () => {
    // sk-551.3 — a column the filter hides holds nothing the filter
    // admits; it is drawn as a sliver (its width is the manual browser
    // pass) that names the column and offers the way back.
    renderBoard({
      statusFilter: 'active',
      items: [issue({ id: 'c', status: 'closed' })],
    });
    const done = columns()[3];
    expect(done.getAttribute('aria-label')).toMatch(/hidden by the status filter/i);
    // No cards, and not "0 tasks" — the number is unknown under this
    // filter, not zero.
    expect(within(done).queryByRole('button', { name: /Open issue c/ })).toBeNull();
    expect(within(done).queryByText('0')).toBeNull();
    // Its one control is the way back, and its name carries the column's.
    const back = within(done).getByRole('button', {
      name: i18n.t('tasks:kanban.showAllStatusesFor', { name: 'Done' }),
    });
    expect(back).toBeTruthy();
    expect(within(done).getAllByRole('button')).toHaveLength(1);
  });

  test('the way back writes the SHARED filter rather than a board-local one', () => {
    const onStatusFilterChange = vi.fn();
    renderBoard({ statusFilter: 'active', onStatusFilterChange });
    fireEvent.click(
      screen.getByRole('button', {
        name: i18n.t('tasks:kanban.showAllStatusesFor', { name: 'Done' }),
      }),
    );
    expect(onStatusFilterChange).toHaveBeenCalledWith('all');
  });

  test('with the filter cleared the closed work appears and the way back is gone', () => {
    renderBoard({ statusFilter: 'all', items: [issue({ id: 'c', status: 'closed' })] });
    const done = columns()[3];
    expect(done.getAttribute('aria-label')).not.toMatch(/hidden by the status filter/i);
    expect(within(done).getByRole('button', { name: /Open issue c/ })).toBeTruthy();
    expect(
      screen.queryByRole('button', {
        name: i18n.t('tasks:kanban.showAllStatusesFor', { name: 'Done' }),
      }),
    ).toBeNull();
  });
});

/**
 * sk-551.32 — a board whose status filter is real state, the way the
 * Tasks column wires it: the board writes through `onStatusFilterChange`
 * and reads the new value back on the next render.
 */
function StatefulBoard({
  initial,
  onWrite,
}: {
  initial: StatusFilter;
  onWrite?: (v: StatusFilter) => void;
}) {
  const [filter, setFilter] = useState<StatusFilter>(initial);
  return (
    <KanbanBoard
      items={[issue({ id: 'c', status: 'closed' })]}
      axis="status"
      statusFilter={filter}
      onStatusFilterChange={(v) => {
        onWrite?.(v);
        setFilter(v);
      }}
      selectedIssueId={null}
      onSelect={vi.fn()}
      hasNextPage={false}
      isFetchingNextPage={false}
      fetchNextPage={vi.fn()}
    />
  );
}

function renderStateful(initial: StatusFilter, onWrite?: (v: StatusFilter) => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MantineProvider forceColorScheme="dark">
        <MemoryRouter>
          <StatefulBoard initial={initial} onWrite={onWrite} />
        </MemoryRouter>
      </MantineProvider>
    </QueryClientProvider>,
  );
}

const unfoldName = (name: string) => i18n.t('tasks:kanban.showAllStatusesFor', { name });
const foldName = (name: string) => i18n.t('tasks:kanban.foldColumn', { name });

/** A board driven from outside, for walking the shared filter by hand. */
const controlledClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
function controlledBoard(
  statusFilter: StatusFilter,
  onStatusFilterChange: (v: StatusFilter) => void,
  axis: KanbanBoardProps['axis'] = 'status',
) {
  return (
    <QueryClientProvider client={controlledClient}>
      <MantineProvider forceColorScheme="dark">
        <MemoryRouter>
          <KanbanBoard
            items={[]}
            axis={axis}
            statusFilter={statusFilter}
            onStatusFilterChange={onStatusFilterChange}
            selectedIssueId={null}
            onSelect={vi.fn()}
            hasNextPage={false}
            isFetchingNextPage={false}
            fetchNextPage={vi.fn()}
          />
        </MemoryRouter>
      </MantineProvider>
    </QueryClientProvider>
  );
}

describe('KanbanBoard — folding an unfolded column back (sk-551.32)', () => {
  test('sliver → unfolded Done with a fold in its head → fold → sliver again', () => {
    const writes: StatusFilter[] = [];
    renderStateful('active', (v) => writes.push(v));
    fireEvent.click(screen.getByRole('button', { name: unfoldName('Done') }));
    // Unfolded: its card is on the board, and its head offers the fold.
    expect(screen.getByRole('button', { name: /Open issue c/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: foldName('Done') }));
    // Folded again: the filter is back where it was, the sliver is back,
    // the card and the fold are gone.
    expect(writes).toEqual(['all', 'active']);
    expect(screen.getByRole('button', { name: unfoldName('Done') })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Open issue c/ })).toBeNull();
    expect(screen.queryByRole('button', { name: foldName('Done') })).toBeNull();
  });

  test('the fold is reachable and pressable from the keyboard', async () => {
    const user = userEvent.setup();
    renderStateful('all');
    const fold = screen.getByRole('button', { name: foldName('Done') });
    fold.focus();
    expect(document.activeElement).toBe(fold);
    await user.keyboard('{Enter}');
    // The fold removed the focused button; focus lands on the sliver that
    // replaced it, on the same column — not on <body>.
    const sliver = screen.getByRole('button', { name: unfoldName('Done') });
    expect(document.activeElement).toBe(sliver);
    // And the cycle closes from there: Enter unfolds again.
    await user.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: foldName('Done') })).toBeTruthy();
  });

  test('a keyboard unfold hands focus to the fold button of the same column', async () => {
    const user = userEvent.setup();
    renderStateful('active');
    const sliver = screen.getByRole('button', { name: unfoldName('Done') });
    sliver.focus();
    await user.keyboard('{Enter}');
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: foldName('Done') }),
    );
  });

  test('a pointer unfold leaves focus where the pointer put it', async () => {
    const user = userEvent.setup();
    renderStateful('active');
    await user.click(screen.getByRole('button', { name: unfoldName('Done') }));
    expect(document.activeElement).not.toBe(
      screen.getByRole('button', { name: foldName('Done') }),
    );
  });

  test('a pointer fold leaves focus where the pointer put it', async () => {
    const user = userEvent.setup();
    renderStateful('all');
    await user.click(screen.getByRole('button', { name: foldName('Done') }));
    const sliver = screen.getByRole('button', { name: unfoldName('Done') });
    expect(document.activeElement).not.toBe(sliver);
  });

  test('the fold puts back the filter the sliver widened from, not the default', () => {
    const onStatusFilterChange = vi.fn();
    const { rerender } = render(controlledBoard('open', onStatusFilterChange));
    fireEvent.click(screen.getByRole('button', { name: unfoldName('Done') }));
    expect(onStatusFilterChange).toHaveBeenLastCalledWith('all');
    rerender(controlledBoard('all', onStatusFilterChange));
    // Every column `open` hid gets the fold; `open` itself does not.
    expect(screen.queryByRole('button', { name: foldName('Open') })).toBeNull();
    for (const name of ['In progress', 'Deferred', 'Done', '∞ Standing']) {
      expect(screen.getByRole('button', { name: foldName(name) })).toBeTruthy();
    }
    fireEvent.click(screen.getByRole('button', { name: foldName('In progress') }));
    expect(onStatusFilterChange).toHaveBeenLastCalledWith('open');
  });

  test("with no widening seen (reload, or 'all' picked in the panel) the fold restores the default filter", () => {
    const onStatusFilterChange = vi.fn();
    renderBoard({ statusFilter: 'all', onStatusFilterChange });
    // Only the column the default filter hides is foldable.
    expect(screen.queryByRole('button', { name: foldName('Open') })).toBeNull();
    expect(screen.queryByRole('button', { name: foldName('∞ Standing') })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: foldName('Done') }));
    expect(onStatusFilterChange).toHaveBeenCalledWith('active');
  });

  test('a filter change made elsewhere forgets the widening', () => {
    const onStatusFilterChange = vi.fn();
    const { rerender } = render(controlledBoard('open', onStatusFilterChange));
    fireEvent.click(screen.getByRole('button', { name: unfoldName('Done') }));
    // The shared filter goes to all, then the filter panel moves it on
    // and back: the board no longer knows what `all` was widened from.
    rerender(controlledBoard('all', onStatusFilterChange));
    rerender(controlledBoard('deferred', onStatusFilterChange));
    rerender(controlledBoard('all', onStatusFilterChange));
    expect(screen.queryByRole('button', { name: foldName('In progress') })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: foldName('Done') }));
    expect(onStatusFilterChange).toHaveBeenLastCalledWith('active');
  });

  test('under a filter narrower than all, no head offers a fold', () => {
    for (const statusFilter of ['active', 'open', 'blocked'] as StatusFilter[]) {
      renderBoard({ statusFilter });
      for (const name of ['Open', 'In progress', 'Deferred', 'Done', '∞ Standing']) {
        expect(screen.queryByRole('button', { name: foldName(name) })).toBeNull();
      }
      cleanup();
    }
  });

  test('on another axis nothing folds, even with a widening on record', () => {
    // One board instance: widen from `open` on the status axis (so the
    // board holds `open` as the filter to restore), then switch the axis.
    // Under that record every priority value would read as "hidden by
    // `open`" — only the axis rule keeps the heads clean.
    const onStatusFilterChange = vi.fn();
    const { rerender } = render(controlledBoard('open', onStatusFilterChange));
    fireEvent.click(screen.getByRole('button', { name: unfoldName('Done') }));
    expect(onStatusFilterChange).toHaveBeenCalledTimes(1);
    rerender(controlledBoard('all', onStatusFilterChange, 'priority'));
    for (const name of ['P0', 'P1', 'P2', 'P3', 'P4']) {
      expect(screen.queryByRole('button', { name: foldName(name) })).toBeNull();
    }
    expect(onStatusFilterChange).toHaveBeenCalledTimes(1);
  });
});

describe('KanbanBoard — a card is a task you can open', () => {
  test('clicking a card opens it in Details', () => {
    const onSelect = vi.fn();
    const item = issue({ id: 'a' });
    renderBoard({ items: [item], onSelect });
    fireEvent.click(screen.getByRole('button', { name: /Open issue a/ }));
    expect(onSelect).toHaveBeenCalledWith(item);
  });

  test('so does Enter — dragging is never the only way to reach a task', () => {
    const onSelect = vi.fn();
    const item = issue({ id: 'a' });
    renderBoard({ items: [item], onSelect });
    const card = screen.getByRole('button', { name: /Open issue a/ });
    // A native <button> fires click on Enter; assert it IS one, since
    // that is what carries the keyboard behaviour.
    expect(card.tagName).toBe('BUTTON');
    fireEvent.click(card);
    expect(onSelect).toHaveBeenCalledWith(item);
  });

  test('the card shows id, type and priority — and NOT its own column', () => {
    renderBoard({ items: [issue({ id: 'a', type: 'bug', priority: 0 })] });
    const card = screen.getByRole('button', { name: /Open issue a/ });
    expect(within(card).getByText('a')).toBeTruthy();
    expect(within(card).getByText('bug')).toBeTruthy();
    expect(within(card).getByText('P0')).toBeTruthy();
    // The column head already states the status.
    expect(within(card).queryByText('open')).toBeNull();
  });

  test('a blocked card still says so — that is not what the column states', () => {
    renderBoard({ items: [issue({ id: 'a', isBlocked: true })] });
    const card = screen.getByRole('button', { name: /Open issue a/ });
    expect(within(card).getByText('blocked')).toBeTruthy();
  });
});

describe('KanbanBoard — paging', () => {
  test('no "load more" when everything is loaded', () => {
    renderBoard({ hasNextPage: false });
    expect(screen.queryByRole('button', { name: 'Load more tasks' })).toBeNull();
  });

  test('"load more" is an explicit action, not an auto-paging sentinel', () => {
    const fetchNextPage = vi.fn();
    renderBoard({ hasNextPage: true, fetchNextPage });
    fireEvent.click(screen.getByRole('button', { name: 'Load more tasks' }));
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
  });
});

/**
 * sk-285.2.4 — the same board, other axes.
 *
 * The axis changes three visible things: what the column heads say, how
 * many columns there are, and which of them refuse a drop. The fourth —
 * a card appearing in two columns at once — is the one that could be
 * mistaken for a bug in the data, so it is asserted together with the
 * mark that explains it.
 */
describe('KanbanBoard — the axis is a choice', () => {
  test('priority draws five columns, P0 first', () => {
    renderBoard({ axis: 'priority', items: [issue({ id: 'a', priority: 0 })] });
    const names = columns().map((c) => c.getAttribute('aria-label') ?? '');
    expect(names).toHaveLength(5);
    expect(names[0]).toMatch(/^P0 column/);
    expect(within(columns()[0]).getByRole('button', { name: /Open issue a/ })).toBeTruthy();
  });

  test('assignee names the people and keeps one bucket for nobody', () => {
    renderBoard({
      axis: 'assignee',
      items: [issue({ id: 'a', assignee: 'zoe' }), issue({ id: 'b', assignee: null })],
    });
    const names = columns().map((c) => c.getAttribute('aria-label') ?? '');
    expect(names[0]).toMatch(/^zoe column/);
    expect(names[1]).toMatch(/^unassigned column/);
  });

  test('a card on a non-status axis shows its status — the column no longer states it', () => {
    renderBoard({ axis: 'priority', items: [issue({ id: 'a', status: 'in_progress' })] });
    const card = screen.getByRole('button', { name: /Open issue a/ });
    // sk-285.7 fidelity T3 — the badge spells the status as prose, so the
    // wire value `in_progress` reaches the screen as «in progress». What
    // this test is about is that the status is PRESENT on a card whose
    // column does not state it; the spelling belongs to <Attribute> and
    // is pinned in `Attribute.status.test.tsx`.
    expect(within(card).getByText('in progress')).toBeTruthy();
  });

  test('and on the assignee axis the card drops the assignee the column names', () => {
    // The mirror of the status rule: a card never repeats its own column.
    renderBoard({ axis: 'assignee', items: [issue({ id: 'a', assignee: 'zoe' })] });
    const card = screen.getByRole('button', { name: /Open issue a/ });
    expect(within(card).queryByText('zoe')).toBeNull();
    // …but it still names the assignee everywhere else.
    renderBoard({ axis: 'priority', items: [issue({ id: 'b', assignee: 'zoe' })] });
    const other = screen.getByRole('button', { name: /Open issue b/ });
    expect(within(other).getByText('zoe')).toBeTruthy();
  });

  test('the project axis is read-only, and says why before you try', () => {
    renderBoard({
      axis: 'project',
      items: [issue({ id: 'a', projectId: 'p1' })],
      projectHandles: new Map([['p1', 'mob']]),
    });
    const col = columns()[0];
    expect(col.getAttribute('aria-label')).toMatch(/^mob column/);
    const lock = within(col).getByRole('img');
    expect(lock.getAttribute('aria-label')).toMatch(/cannot move tasks between projects/i);
  });

  test('component columns are named, not uuid-shaped', () => {
    renderBoard({
      axis: 'component',
      items: [issue({ id: 'a', componentIds: ['c1'] })],
      componentNames: new Map([['c1', 'frontend']]),
    });
    expect(columns()[0].getAttribute('aria-label')).toMatch(/^frontend column/);
  });
});

describe('KanbanBoard — a task in two columns says so', () => {
  const twoComponents = () =>
    renderBoard({
      axis: 'component',
      items: [issue({ id: 'a', componentIds: ['c1', 'c2'] })],
      componentNames: new Map([
        ['c1', 'frontend'],
        ['c2', 'backend'],
      ]),
    });

  test('the same task really is rendered in both columns', () => {
    twoComponents();
    // Two named columns plus the empty "no component" bucket — and the
    // SAME task id appears in both named ones.
    expect(columns()).toHaveLength(3);
    expect(screen.getAllByRole('button', { name: /Open issue a/ })).toHaveLength(2);
  });

  test('and each copy names the OTHER column it lives in', () => {
    twoComponents();
    // backend sorts before frontend, so column 0 is backend.
    expect(within(columns()[0]).getByText('also in: frontend')).toBeTruthy();
    expect(within(columns()[1]).getByText('also in: backend')).toBeTruthy();
  });

  test('the duplication is in the accessible name too, not just the paint', () => {
    twoComponents();
    const cards = screen.getAllByRole('button', { name: /Open issue a/ });
    expect(cards[0].getAttribute('aria-label')).toMatch(/also in: frontend/);
  });

  test('a task with one component is not marked as duplicated', () => {
    renderBoard({
      axis: 'component',
      items: [issue({ id: 'a', componentIds: ['c1'] })],
      componentNames: new Map([['c1', 'frontend']]),
    });
    const card = screen.getByRole('button', { name: /Open issue a/ });
    expect(card.getAttribute('aria-label')).not.toMatch(/also in:/);
    expect(screen.queryByText(/also in:/)).toBeNull();
  });
});

/**
 * sk-285.2.5 — the card prints what the user asked for.
 *
 * The default is asserted as "the board did not change", because that is
 * the actual promise: a user who never opens the picker must not notice
 * that the picker exists. The rest asserts the two directions a switch
 * can fail in — a field that will not turn on, and one that will not
 * turn off — plus the interaction with the axis rule, which is the only
 * place the two features can contradict each other.
 */
describe('KanbanBoard — display properties', () => {
  const rich = () =>
    issue({
      id: 'a',
      type: 'bug',
      priority: 1,
      assignee: 'zoe',
      componentIds: ['c1', 'c2'],
      labels: ['api', 'ui'],
      iAssigned: true,
    });
  const names = new Map([
    ['c1', 'frontend'],
    ['c2', 'backend'],
  ]);
  const all: ReadonlySet<KanbanCardField> = new Set(KANBAN_CARD_FIELDS);

  test('with no setting at all the card is exactly what it always was', () => {
    renderBoard({ items: [rich()], componentNames: names });
    const card = screen.getByRole('button', { name: /Open issue a/ });
    expect(within(card).getByText('a')).toBeTruthy();
    expect(within(card).getByText('bug')).toBeTruthy();
    expect(within(card).getByText('P1')).toBeTruthy();
    expect(within(card).getByText('zoe')).toBeTruthy();
    // …and nothing the shipped board never printed.
    expect(within(card).queryByText(/components:/)).toBeNull();
    expect(within(card).queryByText(/labels:/)).toBeNull();
    expect(within(card).queryByText(/upd\./)).toBeNull();
  });

  test('turning everything on prints every property the wire carries', () => {
    renderBoard({ items: [rich()], componentNames: names, cardFields: all });
    const card = screen.getByRole('button', { name: /Open issue a/ });
    expect(within(card).getByText('a')).toBeTruthy();
    expect(within(card).getByText('bug')).toBeTruthy();
    expect(within(card).getByText('P1')).toBeTruthy();
    expect(within(card).getByText('zoe')).toBeTruthy();
    // Component IDs are resolved to names, not printed as uuids.
    expect(within(card).getByText('components: frontend, backend')).toBeTruthy();
    expect(within(card).getByText('labels: api, ui')).toBeTruthy();
    expect(within(card).getByText(/upd\./)).toBeTruthy();
    expect(within(card).getByText(/created/)).toBeTruthy();
    // ★ — the task is one the caller delegated.
    expect(within(card).getByText(/Delegated by me/)).toBeTruthy();
  });

  test('turning a property off removes it, and only it', () => {
    renderBoard({
      items: [rich()],
      cardFields: new Set<KanbanCardField>(['type', 'assignee']),
    });
    const card = screen.getByRole('button', { name: /Open issue a/ });
    expect(within(card).getByText('bug')).toBeTruthy();
    expect(within(card).getByText('zoe')).toBeTruthy();
    expect(within(card).queryByText('P1')).toBeNull();
    // The id badge is gone with its switch.
    expect(within(card).queryByText('a')).toBeNull();
  });

  test('every switch off leaves a card that is still a task you can open', () => {
    const onSelect = vi.fn();
    const item = rich();
    renderBoard({ items: [item], cardFields: new Set<KanbanCardField>(), onSelect });
    const card = screen.getByRole('button', { name: /Open issue a/ });
    // The title is not a property — it is the card.
    expect(within(card).getByText('hello world')).toBeTruthy();
    fireEvent.click(card);
    expect(onSelect).toHaveBeenCalledWith(item);
  });

  test('the axis still wins: the status board hides the status chip even switched on', () => {
    renderBoard({
      axis: 'status',
      items: [issue({ id: 'a', status: 'open' })],
      cardFields: new Set<KanbanCardField>(['status']),
    });
    const card = screen.getByRole('button', { name: /Open issue a/ });
    expect(within(card).queryByText('open')).toBeNull();
  });

  test('and the component board hides the component list it already names', () => {
    renderBoard({
      axis: 'component',
      items: [issue({ id: 'a', componentIds: ['c1'] })],
      componentNames: new Map([['c1', 'frontend']]),
      cardFields: new Set<KanbanCardField>(['components']),
    });
    const card = screen.getByRole('button', { name: /Open issue a/ });
    expect(within(card).queryByText(/components:/)).toBeNull();
  });

  test('the blocked marker is its own switch, separate from the status chip', () => {
    // ON with status OFF — blocked-ness is derived from the dep graph,
    // so no column ever states it and it must be reachable on its own.
    renderBoard({
      axis: 'status',
      items: [issue({ id: 'a', isBlocked: true })],
      cardFields: new Set<KanbanCardField>(['blocked']),
    });
    expect(
      within(screen.getByRole('button', { name: /Open issue a/ })).getByText('blocked'),
    ).toBeTruthy();

    cleanup();

    // OFF — the card stops shouting about it.
    renderBoard({
      axis: 'status',
      items: [issue({ id: 'a', isBlocked: true })],
      cardFields: new Set<KanbanCardField>(['type']),
    });
    expect(
      within(screen.getByRole('button', { name: /Open issue a/ })).queryByText('blocked'),
    ).toBeNull();
  });

  test('a component with no known name degrades to a short id, not to a blank', () => {
    renderBoard({
      items: [issue({ id: 'a', componentIds: ['0199aa-deadbeef'] })],
      cardFields: new Set<KanbanCardField>(['components']),
    });
    const card = screen.getByRole('button', { name: /Open issue a/ });
    expect(within(card).getByText('components: …deadbeef')).toBeTruthy();
  });
});
