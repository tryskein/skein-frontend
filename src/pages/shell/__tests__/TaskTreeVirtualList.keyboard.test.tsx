/**
 * sk-285.2.11 — the tree as the KEYBOARD and a screen reader meet it.
 *
 * `lib/__tests__/treeKeyboardNav.test.ts` pins the thirteen APG rules as
 * pure array questions. This file pins the half that only exists once the
 * list is rendered:
 *
 *   - the ARIA shape (`treegrid` / `row` / `aria-expanded` /
 *     `aria-selected` / `aria-level`), including the localized name;
 *   - the roving tabindex — exactly ONE tab stop in the whole tree;
 *   - that a key really moves DOM focus, and that focus really lands on a
 *     row the virtualizer had not mounted (the reason this work waited
 *     for sk-285.2.10);
 *   - that none of it changed what the mouse does.
 *
 * jsdom has no layout: row heights come from the global stub in
 * `test/setup.ts`, and scrolling is emulated locally (same approach as
 * `TaskTreeVirtualList.test.tsx`, which explains why it is not global).
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import { TaskTreeVirtualList } from '../TaskTreeVirtualList';
import { TREE_DEFAULT_COLUMNS } from '../../../lib/treeColumns';
import type { FlatTreeRow } from '../../../lib/flattenTree';
import type { IssueSummary, IssueTreeRowItem } from '../../../api/issues';

const VIEWPORT_PX = 800;

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
 * Same shape as the pure test's fixture, so a failure here and a failure
 * there describe the same tree:
 *
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

interface Handlers {
  onSelect?: (item: IssueTreeRowItem) => void;
  onToggle?: (id: string) => void;
}

function renderTree(
  rows: FlatTreeRow[] = ROWS,
  { onSelect = () => {}, onToggle = () => {} }: Handlers = {},
  selectedId: string | null = null,
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MantineProvider forceColorScheme="dark">
        <MemoryRouter>
          <TaskTreeVirtualList
            rows={rows}
            hasMoreRows={false}
            selectedId={selectedId}
            expanded={EXPANDED}
            searchQuery=""
            componentNames={new Map()}
            // sk-285.2.19 — this file is about keyboard behaviour, not
            // about the column preference: the defaults are what a user
            // who never opens the picker sees.
            treeColumns={new Set(TREE_DEFAULT_COLUMNS)}
            // sk-285.2.19 (step 4) — not what this file is about: the
            // shipped default sort, and a heading click nobody performs.
            sort="priority-updated"
            sortDir="asc"
            onSortChange={() => {}}
            onSelect={onSelect}
            onToggle={onToggle}
          />
        </MemoryRouter>
      </MantineProvider>
    </QueryClientProvider>,
  );
}

/** Rendered rows, in document order. */
function treeItems(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>('.task-tree-node-row'),
  );
}

function titleOf(el: Element): string {
  return el.querySelector('.task-card-title-text')?.textContent ?? '';
}

/** Title of the row that currently holds DOM focus. */
function focusedTitle(container: HTMLElement): string {
  const active = document.activeElement;
  const rowEl = treeItems(container).find((el) => el === active);
  return rowEl ? titleOf(rowEl) : '<none>';
}

/** Focus the tree the way Tab would: on its single tab stop. */
function enterTree(container: HTMLElement): HTMLElement {
  const stop = treeItems(container).find((el) => el.tabIndex === 0)!;
  stop.focus();
  return stop;
}

/** Emulate the scroll container jsdom does not implement. */
function emulateScrolling(container: HTMLElement): () => number {
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
    if (top === offset) return; // a browser fires no event for a no-op
    offset = top;
    body.dispatchEvent(new Event('scroll'));
  }) as HTMLElement['scrollTo'];
  return () => offset;
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => cleanup());

describe('sk-285.2.11 — ARIA shape of the tree', () => {
  test('the container is a treegrid with a localized accessible name', () => {
    // sk-285.2.19 — `treegrid`, not `tree`: the rows have columns now.
    // The rest of the shape (name, single-select) is unchanged, and the
    // grid-only half — rowcount / colcount / rowindex / colindex — is
    // pinned in `TaskTreeVirtualList.treegrid.test.tsx`.
    const { container } = renderTree();
    const tree = container.querySelector('[role="treegrid"]')!;
    expect(tree).not.toBeNull();
    // From the real `tasks` dictionary — not a string typed into the JSX.
    expect(tree.getAttribute('aria-label')).toBe('Task tree');
    // Single-select tree: the two attributes that would say otherwise
    // must be absent everywhere.
    expect(tree.getAttribute('aria-multiselectable')).toBeNull();
    expect(container.querySelector('[aria-checked]')).toBeNull();
  });

  test('every row is a grid row carrying its depth', () => {
    const { container } = renderTree();
    const items = treeItems(container);
    expect(items).toHaveLength(ROWS.length);
    // sk-285.2.19 — `row`, not `treeitem`; `aria-level` stays, because a
    // row in a treegrid carries the tree half of the shape.
    for (const el of items) expect(el.getAttribute('role')).toBe('row');
    expect(items.map((el) => el.getAttribute('aria-level'))).toEqual([
      '1',
      '2',
      '2',
      '2',
      '1',
    ]);
  });

  test('only rows with a subtree report expansion, and they report it truthfully', () => {
    const { container } = renderTree();
    const items = treeItems(container);
    expect(items[0].getAttribute('aria-expanded')).toBe('true'); // Alpha, open
    expect(items[1].getAttribute('aria-expanded')).toBe('false'); // Beta, closed
    expect(items[3].getAttribute('aria-expanded')).toBeNull(); // Gamma, leaf
    expect(items[4].getAttribute('aria-expanded')).toBeNull(); // Delta, leaf
  });

  test('the selected row, and only it, is aria-selected', () => {
    const { container } = renderTree(ROWS, {}, 'demo-1.2');
    const selected = treeItems(container).filter(
      (el) => el.getAttribute('aria-selected') === 'true',
    );
    expect(selected).toHaveLength(1);
    expect(titleOf(selected[0])).toBe('Bravo');
  });
});

describe('sk-285.2.11 — roving tabindex', () => {
  test('exactly one row is in the tab order', () => {
    const { container } = renderTree();
    const stops = treeItems(container).filter((el) => el.tabIndex === 0);
    expect(stops).toHaveLength(1);
    // Nothing else inside the tree competes for it — the chevrons are
    // mouse affordances now.
    const tree = container.querySelector<HTMLElement>('[role="treegrid"]')!;
    const tabbable = Array.from(
      tree.querySelectorAll<HTMLElement>('button, [tabindex]'),
    ).filter((el) => el.tabIndex === 0);
    expect(tabbable).toHaveLength(1);
  });

  test('a reference row adds no second tab stop', () => {
    // The "↻ see" jump is a button inside a row; left tabbable it
    // would be a second stop in the tree, and a reader tabbing "out" of
    // the tree would land inside it instead.
    const withRef = [
      ...ROWS,
      row('demo-1', 'Alpha', 1, { isReference: true, firstSeenAt: 'demo-1' }),
    ];
    const { container } = renderTree(withRef);
    const tree = container.querySelector<HTMLElement>('[role="treegrid"]')!;
    expect(tree.querySelector('.task-tree-jump-ref')).not.toBeNull();
    const tabbable = Array.from(
      tree.querySelectorAll<HTMLElement>('button, [tabindex]'),
    ).filter((el) => el.tabIndex === 0);
    expect(tabbable).toHaveLength(1);
  });

  test('the tab stop starts on the open issue when there is one', () => {
    const { container } = renderTree(ROWS, {}, 'demo-2');
    expect(titleOf(treeItems(container).find((el) => el.tabIndex === 0)!)).toBe(
      'Delta',
    );
  });

  test('the tab stop follows the keyboard, and stays a single stop', async () => {
    const user = userEvent.setup();
    const { container } = renderTree();
    enterTree(container);
    await user.keyboard('{ArrowDown}');

    const stops = treeItems(container).filter((el) => el.tabIndex === 0);
    expect(stops).toHaveLength(1);
    expect(titleOf(stops[0])).toBe('Beta');
  });
});

describe('sk-285.2.11 — keys move real focus', () => {
  test('Down and Up walk the visible rows', async () => {
    const user = userEvent.setup();
    const { container } = renderTree();
    enterTree(container);

    await user.keyboard('{ArrowDown}');
    expect(focusedTitle(container)).toBe('Beta');
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(focusedTitle(container)).toBe('Gamma');
    await user.keyboard('{ArrowUp}');
    expect(focusedTitle(container)).toBe('Bravo');
  });

  test('Right on an open node enters its cells instead of descending', async () => {
    // sk-285.2.19 step 2 — this used to assert the TREE pattern's answer
    // ("steps onto its first child"), which is not what a treegrid does:
    // «If a row is focused, and it is expanded, focuses the first cell in
    // the row» (APG, treegrid-1). Descending is Down here — the first
    // child IS the next visible row, as 'Down and Up walk the visible
    // rows' above already pins.
    //
    // What this file adds to the resolver's own test is that the key
    // moves REAL focus off the row and onto a cell of it, and still
    // toggles nothing.
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const { container } = renderTree(ROWS, { onToggle });
    const alpha = enterTree(container); // Alpha, open

    await user.keyboard('{ArrowRight}');
    expect(onToggle).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(
      alpha.querySelector('.task-tree-cell[data-col="0"]'),
    );
    // …and NOT the child row the tree pattern would have jumped to.
    expect(focusedTitle(container)).not.toBe('Beta');
  });

  test('Right on a closed node opens it and leaves focus alone', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const { container } = renderTree(ROWS, { onToggle });
    enterTree(container);
    await user.keyboard('{ArrowDown}'); // Beta, closed

    await user.keyboard('{ArrowRight}');
    expect(onToggle).toHaveBeenCalledWith('demo-1.1');
    expect(focusedTitle(container)).toBe('Beta');
  });

  test('Left collapses an open node, and climbs out of a closed one', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const { container } = renderTree(ROWS, { onToggle });
    enterTree(container);

    await user.keyboard('{ArrowLeft}'); // on Alpha, open → collapse
    expect(onToggle).toHaveBeenCalledWith('demo-1');
    onToggle.mockClear();

    await user.keyboard('{ArrowDown}{ArrowLeft}'); // Beta → its parent
    expect(onToggle).not.toHaveBeenCalled();
    expect(focusedTitle(container)).toBe('Alpha');
  });

  test('Ctrl+Home and Ctrl+End jump to the ends of the list', async () => {
    // sk-285.2.19 — the ends of the GRID moved onto the modified keys
    // when the tree became a treegrid: bare Home/End now mean the ends
    // of the focused ROW, which `TaskTreeVirtualList.treegrid.test.tsx`
    // pins. This test is the same rule on its new keystroke.
    const user = userEvent.setup();
    const { container } = renderTree();
    enterTree(container);

    await user.keyboard('{Control>}{End}{/Control}');
    expect(focusedTitle(container)).toBe('Delta');
    await user.keyboard('{Control>}{Home}{/Control}');
    expect(focusedTitle(container)).toBe('Alpha');
  });

  test('Enter opens the focused issue, exactly like clicking it', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const { container } = renderTree(ROWS, { onSelect });
    enterTree(container);
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0].id).toBe('demo-1.2');
  });

  test('asterisk opens every closed sibling of the focused row', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const { container } = renderTree(ROWS, { onToggle });
    enterTree(container);
    await user.keyboard('{ArrowDown}'); // Beta

    await user.keyboard('*');
    expect(onToggle.mock.calls.map((c) => c[0])).toEqual([
      'demo-1.1',
      'demo-1.2',
    ]);
  });

  test('typing a letter moves focus to the next row that starts with it', async () => {
    const user = userEvent.setup();
    const { container } = renderTree();
    enterTree(container);

    await user.keyboard('d');
    expect(focusedTitle(container)).toBe('Delta');
    // A second buffered character refines rather than restarts.
    await user.keyboard('e');
    expect(focusedTitle(container)).toBe('Delta');
  });
});

describe('sk-285.2.11 — focus across the virtualized window', () => {
  const LONG: FlatTreeRow[] = Array.from({ length: 500 }, (_, i) =>
    row(`demo-${i + 1}`, `title ${i + 1}`, 0),
  );

  test('Ctrl+End reaches a row the virtualizer had not mounted', async () => {
    const user = userEvent.setup();
    const { container } = renderTree(LONG);
    const offset = emulateScrolling(container);

    // Precondition: the last row is nowhere near the DOM.
    expect(treeItems(container).map(titleOf)).not.toContain('title 500');

    enterTree(container);
    await user.keyboard('{Control>}{End}{/Control}');

    // The list scrolled to it, mounted it, and put focus on it.
    expect(offset()).toBeGreaterThan(0);
    expect(focusedTitle(container)).toBe('title 500');
  });

  test('the tab stop never disappears while the focused row is off screen', async () => {
    const user = userEvent.setup();
    const { container } = renderTree(LONG);
    emulateScrolling(container);
    enterTree(container);
    await user.keyboard('{Control>}{End}{/Control}');

    const stops = treeItems(container).filter((el) => el.tabIndex === 0);
    expect(stops).toHaveLength(1);
  });
});

describe('sk-285.2.11 — the mouse still works the way it did', () => {
  test('clicking a row selects its issue', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const { container } = renderTree(ROWS, { onSelect });

    // sk-285.2.19 — the click target is the ROW itself: it is a table
    // row now, and every cell of it belongs to the same issue.
    await user.click(treeItems(container)[4]);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0].id).toBe('demo-2');
  });

  test('clicking the chevron toggles that row and nothing else', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onToggle = vi.fn();
    const { container } = renderTree(ROWS, { onSelect, onToggle });

    await user.click(
      treeItems(container)[1].querySelector('.task-tree-toggle')!,
    );
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith('demo-1.1');
    expect(onSelect).not.toHaveBeenCalled();
  });

  test('a chevron clicked from inside the tree takes the focus ring with it', async () => {
    // The chevron itself refuses focus (it is a mouse affordance), so
    // without the row adopting it, the tab stop and the visible focus
    // would sit on different rows — and the next Enter would open the
    // wrong issue.
    const user = userEvent.setup();
    const { container } = renderTree();
    enterTree(container); // focus is on Alpha

    await user.click(
      treeItems(container)[2].querySelector('.task-tree-toggle')!,
    );
    expect(focusedTitle(container)).toBe('Bravo');
    expect(document.activeElement).not.toBe(
      treeItems(container)[2].querySelector('.task-tree-toggle'),
    );
  });

  test('a chevron clicked from OUTSIDE the tree does not steal focus', async () => {
    const user = userEvent.setup();
    const { container } = render(<input data-testid="outside" />);
    const tree = renderTree();
    const outside = container.querySelector<HTMLElement>('input')!;
    outside.focus();

    await user.click(
      treeItems(tree.container)[1].querySelector('.task-tree-toggle')!,
    );
    expect(document.activeElement).toBe(outside);
  });

  test('clicking hands the tab stop to the row that was clicked', async () => {
    const user = userEvent.setup();
    const { container } = renderTree(ROWS, {});

    await user.click(treeItems(container)[3]);
    const stops = treeItems(container).filter((el) => el.tabIndex === 0);
    expect(stops).toHaveLength(1);
    expect(titleOf(stops[0])).toBe('Gamma');
  });
});

/**
 * sk-285.2.13 — the half of the set-position work that only exists once
 * the rows are rendered.
 *
 * `lib/__tests__/treeRowPositions.test.ts` proves the ARITHMETIC over a
 * row list. Nothing there can tell whether the numbers ever reach a
 * row, which is the only place a reader can hear them — so the
 * attributes are read off the DOM here, row by row.
 */
describe('sk-285.2.13 — set size and position on the rendered rows', () => {
  /** `aria-posinset/aria-setsize` of every rendered row, in order. */
  function setPositions(container: HTMLElement): string[] {
    return treeItems(container).map(
      (el) =>
        `${el.getAttribute('aria-posinset')}/${el.getAttribute('aria-setsize')}`,
    );
  }

  test('every row states its place among its own siblings', () => {
    const { container } = renderTree();
    // The fixture is two roots; the first holds three children.
    //   Alpha  1 of 2      Delta  2 of 2
    //     Beta 1 of 3, Bravo 2 of 3, Gamma 3 of 3
    expect(setPositions(container)).toEqual([
      '1/2',
      '1/3',
      '2/3',
      '3/3',
      '2/2',
    ]);
  });

  test('a hidden cross-project stub is numbered like the rows around it', () => {
    // The one row rendered by a DIFFERENT branch of `TaskTreeNode`: no
    // jump affordance, no issue name, a fixed "no access" label. It is
    // still a row the arrow keys stop on, so it still has to carry
    // its place — a set that skipped it would count to fewer rows than
    // Down actually visits.
    const stub = row('demo-1.0', '<hidden>', 1, {
      isReference: true,
      firstSeenAt: null,
    });
    const { container } = renderTree([ROWS[0], stub, ...ROWS.slice(1)]);
    const items = treeItems(container);
    const stubEl = items[1];

    expect(stubEl.getAttribute('aria-label')).toBe(
      'Cross-project parent (no access)',
    );
    expect(stubEl.querySelector('.task-tree-jump-ref')).toBeNull();
    expect(setPositions(container)).toEqual([
      '1/2',
      '1/4',
      '2/4',
      '3/4',
      '4/4',
      '2/2',
    ]);
  });

  test('the grid owns its rows: no generic element sits between them', () => {
    // Both wrappers between the canvas and a row — the virtualizer's
    // measurement box and `.task-tree-node` — are layout only. Left as
    // generic elements they break the grid's ownership of its rows, and
    // a reader that stops treating these as the grid's rows stops
    // announcing the level, position and set size the rows carry.
    // sk-285.2.19 changed the container's role and nothing about this:
    // the wrappers are still exactly two, and still `presentation`.
    const { container } = renderTree();
    const tree = container.querySelector<HTMLElement>('[role="treegrid"]')!;
    const rows = treeItems(container);
    expect(rows.length).toBeGreaterThan(0);

    for (const rowEl of rows) {
      let el = rowEl.parentElement;
      let hops = 0;
      while (el && el !== tree) {
        expect(['presentation', 'none']).toContain(el.getAttribute('role'));
        el = el.parentElement;
        hops++;
      }
      // The walk really reached the tree, and really passed through the
      // two wrappers rather than finding a row parented straight to it.
      expect(el).toBe(tree);
      expect(hops).toBe(2);
    }
  });
});
