/**
 * sk-285.2.19 — the Tasks table as a TREEGRID: the half of the pattern
 * that only exists once the rows are rendered.
 *
 * `lib/__tests__/treeGridKeyboardNav.test.ts` pins the keyboard contract
 * as pure array questions, and
 * `TaskTreeVirtualList.keyboard.test.tsx` pins what the tree pattern
 * already had (the roving tabindex, focus across the virtualized window,
 * the mouse). This file pins what the SWITCH from tree to treegrid
 * introduced, and nothing else:
 *
 *   - the grid's structure: the header row, the gridcells, and the
 *     `aria-owns` that joins a sticky strip the canvas cannot contain;
 *   - the four attributes virtualization makes mandatory —
 *     `aria-rowcount` / `aria-colcount` on the grid, `aria-rowindex` /
 *     `aria-colindex` on rows and cells — including the one case where
 *     the row count is honestly unknown;
 *   - the second focus mode, end to end: how a reader enters the cells,
 *     walks them, leaves them, and where the single tab stop sits while
 *     they do.
 *
 * jsdom has no layout: the row count comes from the `.col-body` height
 * stub in `test/setup.ts`, and scrolling (and the grid height one Page
 * Down moves by) is emulated locally, the same way the keyboard file
 * does it.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import { TaskTreeVirtualList } from '../TaskTreeVirtualList';
import { TREE_DEFAULT_COLUMNS } from '../../../lib/treeColumns';
import { TREE_ROW_HEIGHT_PX } from '../../../lib/treeColumnLayout';
import type { TreeOptionalColumn } from '../../../lib/treeColumns';
import type { FlatTreeRow } from '../../../lib/flattenTree';
import type { IssueSummary, IssueTreeRowItem } from '../../../api/issues';

const VIEWPORT_PX = 800;

/**
 * What one Page Down is worth at this viewport — worked out by hand, on
 * purpose.
 *
 * Re-deriving it with the component's own expression would make the test
 * agree with whatever the component computes, including the wrong thing:
 * the count shipped as `clientHeight / rowHeight`, which counts a row
 * that is behind the sticky heading strip and steps one row past the
 * screenful it claims to move by.
 *
 * The arithmetic, in prose (re-derived for sk-285.7 T028, which took the
 * heading strip from 28px to §6's 40px): the scroller is 800px tall and
 * the strip is painted over its top 40px, so 760px of row canvas is
 * visible. A row is 44px. Seventeen rows need 748px and fit; eighteen
 * need 792px and do not. A page is still seventeen rows — the strip grew
 * by 12px and the page had 24px of slack, so the count did not move.
 * That it did NOT move is why the literal below is unchanged; the test
 * under it re-checks the three inputs so the next change cannot assume
 * the same.
 */
const PAGE_ROWS = 17;

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

/**
 *   0  Alpha    depth 0, parent, OPEN
 *   1    Beta   depth 1, parent, closed
 *   2    Bravo  depth 1, parent, closed
 *   3    Gamma  depth 1, leaf
 *   4  Delta    depth 0, leaf
 */
const ROWS: FlatTreeRow[] = [
  row('demo-1', 'Alpha', 0, { hasChildren: true }),
  row('demo-1.1', 'Beta', 1, { hasChildren: true }),
  row('demo-1.2', 'Bravo', 1, { hasChildren: true }),
  row('demo-1.3', 'Gamma', 1),
  row('demo-2', 'Delta', 0),
];
const EXPANDED = new Set(['demo-1']);

interface Options {
  rows?: FlatTreeRow[];
  hasMoreRows?: boolean;
  columns?: readonly TreeOptionalColumn[];
  onSelect?: (item: IssueTreeRowItem) => void;
  onToggle?: (id: string) => void;
}

function gridElement(
  client: QueryClient,
  {
    rows = ROWS,
    hasMoreRows = false,
    columns = TREE_DEFAULT_COLUMNS,
    onSelect = () => {},
    onToggle = () => {},
  }: Options,
) {
  return (
    <QueryClientProvider client={client}>
      <MantineProvider forceColorScheme="dark">
        <MemoryRouter>
          <TaskTreeVirtualList
            rows={rows}
            hasMoreRows={hasMoreRows}
            selectedId={null}
            expanded={EXPANDED}
            searchQuery=""
            componentNames={new Map()}
            treeColumns={new Set(columns)}
            // sk-285.2.19 (step 4) — the shipped default sort; this file
            // pins the grid roles and the keyboard, not the ordering.
            sort="priority-updated"
            sortDir="asc"
            onSortChange={() => {}}
            onSelect={onSelect}
            onToggle={onToggle}
          />
        </MemoryRouter>
      </MantineProvider>
    </QueryClientProvider>
  );
}

function renderGrid(options: Options = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(gridElement(client, options));
  return {
    ...view,
    /**
     * Re-render the SAME component instance with a changed prop. The
     * cursor and the DOM focus survive it, which is the whole point: a
     * column preference can change while a cell of that column holds
     * focus, and no keystroke is involved.
     */
    update: (next: Options) =>
      view.rerender(gridElement(client, { ...options, ...next })),
  };
}

function grid(container: HTMLElement): HTMLElement {
  return container.querySelector<HTMLElement>('[role="treegrid"]')!;
}

function rowsOf(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>('.task-tree-node-row'),
  );
}

function titleOf(el: Element): string {
  return el.querySelector('.task-card-title-text')?.textContent ?? '';
}

/** Focus the grid the way Tab would: on its single tab stop. */
function enterGrid(container: HTMLElement): HTMLElement {
  const stop = Array.from(
    container.querySelectorAll<HTMLElement>('.task-tree-node-row'),
  ).find((el) => el.tabIndex === 0)!;
  stop.focus();
  return stop;
}

/** Everything in the grid that a bare Tab could land on. */
function tabStops(container: HTMLElement): HTMLElement[] {
  return Array.from(
    grid(container).querySelectorAll<HTMLElement>('[tabindex], button'),
  ).filter((el) => el.tabIndex === 0);
}

/** `{title, col}` of whatever holds DOM focus, or null. */
function focusedCell(): { title: string; col: string | null } | null {
  const active = document.activeElement as HTMLElement | null;
  if (!active) return null;
  const rowEl = active.closest('.task-tree-node-row');
  if (!rowEl) return null;
  return {
    title: titleOf(rowEl),
    col: active.classList.contains('task-tree-cell')
      ? active.getAttribute('data-col')
      : null,
  };
}

/** Emulate the scroll container jsdom does not implement. */
function emulateScrolling(container: HTMLElement): void {
  const body = container.querySelector<HTMLElement>('.col-body')!;
  let offset = 0;
  Object.defineProperty(body, 'scrollTop', {
    configurable: true,
    get: () => offset,
    set: (v: number) => {
      offset = v;
    },
  });
  Object.defineProperty(body, 'clientHeight', {
    configurable: true,
    get: () => VIEWPORT_PX,
  });
  Object.defineProperty(body, 'scrollHeight', {
    configurable: true,
    get: () => {
      const canvas = container.querySelector<HTMLElement>(
        '.task-tree-virtual-canvas',
      );
      return canvas ? Number.parseFloat(canvas.style.height) : 0;
    },
  });
  body.scrollTo = ((options?: ScrollToOptions) => {
    const top = options?.top ?? 0;
    if (top === offset) return;
    offset = top;
    body.dispatchEvent(new Event('scroll'));
  }) as HTMLElement['scrollTo'];
}

const LONG: FlatTreeRow[] = Array.from({ length: 500 }, (_, i) =>
  row(`demo-${i + 1}`, `title ${i + 1}`, 0),
);

afterEach(() => cleanup());

describe('sk-285.2.19 — the grid is built out of grid parts', () => {
  test('the heading strip is the grid’s header ROW of columnheaders', () => {
    const { container } = renderGrid();
    const strip = container.querySelector<HTMLElement>('.task-tree-head')!;
    expect(strip.getAttribute('role')).toBe('row');
    // The header row is row 1 of the grid — the number every data row is
    // offset by.
    expect(strip.getAttribute('aria-rowindex')).toBe('1');
    const heads = Array.from(strip.querySelectorAll('.task-tree-head-cell'));
    expect(heads.length).toBe(TREE_DEFAULT_COLUMNS.length + 1);
    for (const head of heads) {
      expect(head.getAttribute('role')).toBe('columnheader');
    }
  });

  test('the grid ADOPTS the strip it cannot contain, with aria-owns', () => {
    // The strip is sticky against a scroller the canvas does not span, so
    // it cannot be the canvas's child — and a grid whose columnheaders
    // are outside it has none. `aria-owns` is the ARIA escape hatch for
    // exactly that, and this is the assertion that it is actually wired
    // up rather than merely intended.
    const { container } = renderGrid();
    const strip = container.querySelector<HTMLElement>('.task-tree-head')!;
    const owns = grid(container).getAttribute('aria-owns');
    expect(owns).toBeTruthy();
    expect(strip.id).toBe(owns);
    // Genuinely OUTSIDE — otherwise `aria-owns` would be decoration.
    expect(grid(container).contains(strip)).toBe(false);
  });

  test('every cell of a row is a gridcell, numbered like its heading', () => {
    // The pairing that lets a reader say "assignee: nobody" — the value
    // and the heading are in different subtrees, so the column INDEX is
    // the only thing that connects them.
    const { container } = renderGrid();
    const cells = Array.from(
      rowsOf(container)[0].querySelectorAll('.task-tree-cell'),
    );
    expect(cells.length).toBe(TREE_DEFAULT_COLUMNS.length + 1);
    for (const cell of cells) expect(cell.getAttribute('role')).toBe('gridcell');
    const colIndexes = cells.map((c) => c.getAttribute('aria-colindex'));
    const headIndexes = Array.from(
      container.querySelectorAll('.task-tree-head-cell'),
    ).map((c) => c.getAttribute('aria-colindex'));
    // 1-based, gapless, in render order — and the SAME numbers the
    // headings carry.
    expect(colIndexes).toEqual(
      cells.map((_, i) => String(i + 1)),
    );
    expect(colIndexes).toEqual(headIndexes);
  });

  test('the column count is stated, and follows the column preference', () => {
    const { container } = renderGrid();
    expect(grid(container).getAttribute('aria-colcount')).toBe(
      String(TREE_DEFAULT_COLUMNS.length + 1),
    );
    cleanup();

    const fewer = TREE_DEFAULT_COLUMNS.filter((c) => c !== 'priority');
    const second = renderGrid({ columns: fewer });
    expect(grid(second.container).getAttribute('aria-colcount')).toBe(
      String(fewer.length + 1),
    );
  });
});

describe('sk-285.2.19 — the size of a grid only a slice of which exists', () => {
  test('the row count is the WHOLE list plus the header row', () => {
    const { container } = renderGrid({ rows: LONG });
    // The premise: the DOM holds a window, not the list.
    expect(rowsOf(container).length).toBeLessThan(LONG.length);
    expect(grid(container).getAttribute('aria-rowcount')).toBe(
      String(LONG.length + 1),
    );
  });

  test('the row count is -1 while another page is still to come', () => {
    // The same decision `aria-setsize` makes in sk-285.2.13, from the
    // same flag: a total that is about to grow under the reader is worse
    // than an honest "unknown".
    const { container } = renderGrid({ rows: LONG, hasMoreRows: true });
    expect(grid(container).getAttribute('aria-rowcount')).toBe('-1');
  });

  test('each row states its place in the whole list, header included', () => {
    const { container } = renderGrid();
    expect(rowsOf(container).map((el) => el.getAttribute('aria-rowindex'))).toEqual(
      ['2', '3', '4', '5', '6'],
    );
  });

  test('a row scrolled to keeps its own number, not the window’s', () => {
    // The failure this stands against: numbering the MOUNTED rows, so
    // that the row a reader scrolled to at 400 is announced as "row 2".
    const { container } = renderGrid({ rows: LONG });
    emulateScrolling(container);
    const body = container.querySelector<HTMLElement>('.col-body')!;
    body.scrollTo({ top: 300 * TREE_ROW_HEIGHT_PX });

    const first = rowsOf(container)[0];
    expect(Number(first.getAttribute('aria-rowindex'))).toBeGreaterThan(200);
    // …and it is still the index of the row it actually shows.
    const shown = Number(titleOf(first).replace('title ', ''));
    expect(first.getAttribute('aria-rowindex')).toBe(String(shown + 1));
  });
});

describe('sk-285.2.19 — the cell cursor, on the rendered grid', () => {
  test('Right on a row with nothing to open moves focus into its first cell', async () => {
    const user = userEvent.setup();
    const { container } = renderGrid();
    enterGrid(container);
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}'); // Gamma, a leaf

    await user.keyboard('{ArrowRight}');
    expect(focusedCell()).toEqual({ title: 'Gamma', col: '0' });
  });

  test('Right on an EXPANDED row enters its cells rather than its children', async () => {
    // «If a row is focused, and it is expanded, focuses the first cell in
    // the row» (APG, treegrid-1). Alpha is open and Beta is its first
    // child, so the tree pattern's answer — which this grid shipped —
    // is a visibly different one.
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const { container } = renderGrid({ onToggle });
    enterGrid(container); // Alpha, open

    await user.keyboard('{ArrowRight}');
    expect(focusedCell()).toEqual({ title: 'Alpha', col: '0' });
    expect(onToggle).not.toHaveBeenCalled();
  });

  test('the single tab stop moves onto the cell with the focus', async () => {
    // The roving tabindex invariant, restated for the second mode: one
    // element at `tabIndex=0` in the whole grid, and in cell mode it is
    // the cell rather than the row.
    const user = userEvent.setup();
    const { container } = renderGrid();
    enterGrid(container);
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowRight}');

    const stops = tabStops(container);
    expect(stops).toHaveLength(1);
    expect(stops[0].classList.contains('task-tree-cell')).toBe(true);
    expect(stops[0].getAttribute('data-col')).toBe('0');

    // …and it keeps travelling: a VALUE cell takes the stop exactly like
    // the pinned title cell does. The two are rendered by different
    // branches of `TaskTreeNode`, so one of them can lose the tab stop
    // while the other keeps it.
    await user.keyboard('{ArrowRight}');
    const moved = tabStops(container);
    expect(moved).toHaveLength(1);
    expect(moved[0].getAttribute('data-col')).toBe('1');
  });

  test('Left on the first cell hands focus back to the row', async () => {
    const user = userEvent.setup();
    const { container } = renderGrid();
    enterGrid(container);
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowRight}');

    await user.keyboard('{ArrowLeft}');
    expect(focusedCell()).toEqual({ title: 'Gamma', col: null });
    expect(tabStops(container)[0].classList.contains('task-tree-node-row')).toBe(
      true,
    );
  });

  test('Down in cell mode stays in the same column', async () => {
    const user = userEvent.setup();
    const { container } = renderGrid();
    enterGrid(container);
    // Gamma → its cells → two columns right → the row below.
    await user.keyboard(
      '{ArrowDown}{ArrowDown}{ArrowDown}{ArrowRight}{ArrowRight}{ArrowRight}',
    );
    expect(focusedCell()).toEqual({ title: 'Gamma', col: '2' });

    await user.keyboard('{ArrowDown}');
    expect(focusedCell()).toEqual({ title: 'Delta', col: '2' });
  });

  test('Home and End are the ends of the GRID while a ROW holds focus', async () => {
    // «If a row is focused, moves to the first row» / «…to the last row»
    // (APG, treegrid-1). This is the rule the grid shipped inverted: it
    // tested the column for 0, which a row-mode cursor (`col === null`)
    // never is, so Home on a row dived into that row's first cell and
    // the top of the list was unreachable without a modifier.
    const user = userEvent.setup();
    const { container } = renderGrid();
    enterGrid(container);
    await user.keyboard('{ArrowDown}'); // Beta

    await user.keyboard('{End}');
    expect(focusedCell()).toEqual({ title: 'Delta', col: null });
    await user.keyboard('{Home}');
    expect(focusedCell()).toEqual({ title: 'Alpha', col: null });
  });

  test('Home and End are the ends of the ROW while a CELL holds focus', async () => {
    // «If a cell is focused, moves focus to the first / last cell in the
    // row containing focus.» Same two keystrokes as the test above, one
    // Right apart, and the row must NOT change.
    const user = userEvent.setup();
    const { container } = renderGrid();
    enterGrid(container);
    // Alpha is expanded, so Right enters its cells (Beta, one row down,
    // is COLLAPSED — Right would open it instead).
    await user.keyboard('{ArrowRight}');

    await user.keyboard('{End}');
    expect(focusedCell()).toEqual({
      title: 'Alpha',
      col: String(TREE_DEFAULT_COLUMNS.length),
    });
    await user.keyboard('{Home}');
    expect(focusedCell()).toEqual({ title: 'Alpha', col: '0' });
  });

  test('Enter on a cell opens the issue of the row it belongs to', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const { container } = renderGrid({ onSelect });
    enterGrid(container);
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowRight}{ArrowRight}');
    expect(focusedCell()).toEqual({ title: 'Gamma', col: '1' });

    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0].id).toBe('demo-1.3');
  });
});

describe('sk-285.2.19 — Page Up and Page Down move by the VISIBLE rows', () => {
  test('Page Down lands one screenful further down the list', async () => {
    // The sticky heading strip covers the top of the scroller, so the
    // screenful is what fits BELOW it. Measured against the whole
    // `clientHeight` instead — which is how this shipped — the page is a
    // row too long and every Page Down skips a row.
    const user = userEvent.setup();
    const { container } = renderGrid({ rows: LONG });
    emulateScrolling(container);
    enterGrid(container); // row 0

    await user.keyboard('{PageDown}');
    expect(focusedCell()?.title).toBe(`title ${PAGE_ROWS + 1}`);
    await user.keyboard('{PageUp}');
    expect(focusedCell()?.title).toBe('title 1');
  });
});

describe('sk-285.2.19 — the column travels with the cursor', () => {
  test('typeahead moves the row and KEEPS the column', async () => {
    // Typeahead is a ROW search in both patterns, so a reader scanning
    // the second column and jumping by title must land in the second
    // column of the row they jumped to — not be dropped back onto the
    // row, which is a silent exit from cell mode.
    const user = userEvent.setup();
    const { container } = renderGrid();
    enterGrid(container); // Alpha, expanded
    await user.keyboard('{ArrowRight}{ArrowRight}'); // its cells, column 1
    expect(focusedCell()).toEqual({ title: 'Alpha', col: '1' });

    await user.keyboard('d'); // → Delta
    expect(focusedCell()).toEqual({ title: 'Delta', col: '1' });
  });

  test('⌘+End is Ctrl+End: the end of the GRID, in the same column', async () => {
    // The only route to the grid-wide jumps on a Mac keyboard — folded
    // in by the key handler, and invisible unless the two readings of
    // End differ. In CELL mode they do: bare End would stay on Alpha and
    // walk to its last cell.
    const user = userEvent.setup();
    const { container } = renderGrid();
    enterGrid(container);
    await user.keyboard('{ArrowRight}{ArrowRight}'); // Alpha, column 1

    await user.keyboard('{Meta>}{End}{/Meta}');
    expect(focusedCell()).toEqual({ title: 'Delta', col: '1' });
    await user.keyboard('{Meta>}{Home}{/Meta}');
    expect(focusedCell()).toEqual({ title: 'Alpha', col: '1' });
  });

  test('a column switched off UNDER the cursor keeps the tab stop', async () => {
    // No keystroke is involved: the column preference changes while a
    // cell of the last column holds focus, and the cursor's column index
    // is suddenly past the end of the table. Unclamped, no cell in the
    // row matches it and the grid loses its only tab stop — a grid
    // nobody can Tab into.
    const user = userEvent.setup();
    const { container, update } = renderGrid();
    enterGrid(container);
    await user.keyboard('{ArrowRight}{End}'); // Alpha, its LAST cell
    expect(focusedCell()).toEqual({
      title: 'Alpha',
      col: String(TREE_DEFAULT_COLUMNS.length),
    });

    const fewer = TREE_DEFAULT_COLUMNS.filter((c) => c !== 'priority');
    update({ columns: fewer });

    const stops = tabStops(container);
    expect(stops).toHaveLength(1);
    expect(stops[0].getAttribute('data-col')).toBe(String(fewer.length));
  });
});

describe('sk-285.2.19 — Enter belongs to the control that holds focus', () => {
  test('Enter on the chevron works the chevron, and does NOT open the issue', async () => {
    // Tab walks into the row's own controls (below), and Enter there is
    // the button's, not the grid's. Without that guard the grid would
    // swallow the keystroke, prevent its default, and open the issue —
    // so the one key that operates the chevron would instead navigate
    // away from it.
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onToggle = vi.fn();
    const { container } = renderGrid({ onSelect, onToggle });
    const stop = enterGrid(container);

    await user.tab(); // onto Alpha's chevron
    expect(document.activeElement).toBe(
      stop.querySelector('.task-tree-toggle'),
    );

    await user.keyboard('{Enter}');
    expect(onSelect).not.toHaveBeenCalled();
    expect(onToggle).toHaveBeenCalledWith('demo-1');
  });

  test('Enter on the ROW does open it — the guard is not a blanket refusal', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const { container } = renderGrid({ onSelect });
    enterGrid(container);

    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0].id).toBe('demo-1');
  });
});

describe('sk-285.2.19 — Tab reaches the controls inside a row, then leaves', () => {
  test('Tab moves focus onto the chevron of the focused row', async () => {
    // The chevron is a MOUSE affordance with `tabIndex={-1}` — the roving
    // tabindex allows one tab stop and it is the row — so the browser's
    // own Tab would skip it. The grid walks it instead, which is what
    // makes it reachable without a second stop.
    const user = userEvent.setup();
    const { container } = renderGrid();
    const stop = enterGrid(container);

    await user.tab();
    expect(document.activeElement).toBe(
      stop.querySelector('.task-tree-toggle'),
    );
  });

  test('Tab past the last control leaves the grid', async () => {
    const user = userEvent.setup();
    const { container } = renderGrid();
    enterGrid(container);

    await user.tab(); // the chevron
    await user.tab(); // out
    expect(grid(container).contains(document.activeElement)).toBe(false);
  });

  test('a row with no controls hands Tab straight out', async () => {
    const user = userEvent.setup();
    const { container } = renderGrid();
    enterGrid(container);
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}'); // Gamma, a leaf

    await user.tab();
    expect(grid(container).contains(document.activeElement)).toBe(false);
  });
});
