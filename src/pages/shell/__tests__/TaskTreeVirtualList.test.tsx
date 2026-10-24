/**
 * sk-285.2.10 — the Tasks tree renders a WINDOW of its rows.
 *
 * Four acceptance properties, in the order they matter:
 *
 *   1. a long tree keeps a bounded number of rows in the DOM;
 *   2. the scrollable height still describes the WHOLE tree, so the
 *      scrollbar does not lie about how much is below;
 *   3. row heights are MEASURED, not assumed — the offset a row is
 *      positioned at follows the real height of the row above it, which
 *      is what keeps a wrapped title from being clipped by its neighbour;
 *   4. a row can be brought on screen BY ISSUE ID, including one that is
 *      not currently rendered. This is the contract keyboard navigation
 *      is built on: `scrollIntoView()` does not exist for an element that
 *      does not exist.
 *
 * Plus the one sk-285.2.13 property that only a virtualized list can be
 * asked about: the set a row reports itself part of is the WHOLE tree,
 * not the handful of rows that happen to be mounted around it.
 *
 * jsdom has no layout and no scrolling. The heights come from the global
 * stub in `test/setup.ts`; the scrolling is emulated per-test below,
 * deliberately NOT globally — only these two tests care, and a scroll
 * container that answers about its own content is a lie worth keeping
 * local.
 */

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { createRef, type RefObject } from 'react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import {
  TaskTreeVirtualList,
  type TaskTreeScroller,
} from '../TaskTreeVirtualList';
import {
  TREE_DEFAULT_COLUMNS,
  TREE_OPTIONAL_COLUMNS,
  type TreeOptionalColumn,
} from '../../../lib/treeColumns';
import { TREE_ROW_HEIGHT_PX } from '../../../lib/treeColumnLayout';
import type { FlatTreeRow } from '../../../lib/flattenTree';
import type { IssueSummary } from '../../../api/issues';

/** Height `test/setup.ts` reports for a column's scroll container. */
const VIEWPORT_PX = 800;
/** Rows that fit one viewport, at the tree's fixed row height. */
const ROWS_PER_VIEWPORT = Math.ceil(VIEWPORT_PX / TREE_ROW_HEIGHT_PX);

const ROW_COUNT = 500;

function item(id: string): IssueSummary {
  return {
    id,
    projectId: 'proj-1',
    version: 1,
    title: `title ${id}`,
    type: 'task',
    priority: 2,
    status: 'open',
    pinned: false,
    assignee: null,
    parentIdCurrent: null,
    componentIds: [],
    labels: [],
    isBlocked: false,
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
  };
}

function row(id: string): FlatTreeRow {
  return {
    item: item(id),
    depth: 0,
    edgeType: null,
    isReference: false,
    firstSeenAt: null,
    isContext: false,
    hasChildren: false,
  };
}

const ROWS: FlatTreeRow[] = Array.from({ length: ROW_COUNT }, (_, i) =>
  row(`demo-${i + 1}`),
);

function renderList(
  ref?: RefObject<TaskTreeScroller>,
  rows: FlatTreeRow[] = ROWS,
  columns: readonly TreeOptionalColumn[] = TREE_DEFAULT_COLUMNS,
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MantineProvider forceColorScheme="dark">
        <MemoryRouter>
          <TaskTreeVirtualList
            ref={ref}
            rows={rows}
            // The whole fixture is loaded: no page is outstanding, so
            // the set sizes below are exact numbers.
            hasMoreRows={false}
            selectedId={null}
            expanded={new Set()}
            searchQuery=""
            componentNames={new Map()}
            // sk-285.2.19 — this file is not about the column
            // preference; the defaults are what a user who never opens
            // the picker sees.
            treeColumns={new Set(columns)}
            // sk-285.2.19 (step 4) — the sort the headings show. This
            // file is not about sorting; the column's shipped default is
            // what a user who never clicked a heading sees.
            sort="priority-updated"
            sortDir="asc"
            onSortChange={() => {}}
            onSelect={() => {}}
            onToggle={() => {}}
          />
        </MemoryRouter>
      </MantineProvider>
    </QueryClientProvider>,
  );
}

/** Titles of the rows currently in the DOM. */
function renderedTitles(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('.task-card-title-text')).map(
    (el) => el.textContent ?? '',
  );
}

function canvasHeight(container: HTMLElement): number {
  const canvas = container.querySelector<HTMLElement>(
    '.task-tree-virtual-canvas',
  );
  return canvas ? Number.parseFloat(canvas.style.height) : 0;
}

/**
 * Make the rendered column body behave like a scroll container: report
 * the size of its content, remember an offset, and fire `scroll` when the
 * offset is written — the three things the virtualizer reads and jsdom
 * does not provide. Returns a reader for the current offset.
 */
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
    get: () => canvasHeight(container),
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

describe('sk-285.2.10 — virtualized tree rows', () => {
  test('a 500-row tree keeps a bounded slice of rows in the DOM', () => {
    const { container } = renderList();
    const rendered = container.querySelectorAll('.task-tree-node-row').length;

    expect(rendered).toBeGreaterThan(0);
    // One viewport of rows plus overscan on either side. The ceiling is
    // generous on purpose: the property is that the DOM does not grow
    // with the tree, not that the window is exactly N rows wide.
    expect(rendered).toBeLessThan(ROWS_PER_VIEWPORT + 24);
    expect(rendered).toBeLessThan(ROW_COUNT);
  });

  test('a row far down the tree can be scrolled to by issue id', () => {
    const ref = createRef<TaskTreeScroller>();
    const { container } = renderList(ref);
    const offset = emulateScrolling(container);

    // Precondition: the target is nowhere near the rendered window.
    expect(renderedTitles(container)).not.toContain('title demo-400');

    let answered: boolean | undefined;
    act(() => {
      answered = ref.current!.scrollRowIntoView('demo-400', 'start');
    });

    expect(answered).toBe(true);
    // The container really moved, and the row it moved to is mounted.
    expect(offset()).toBeGreaterThan(0);
    expect(renderedTitles(container)).toContain('title demo-400');
  });

  test('a row reports the size of the whole tree, not of the mounted window', () => {
    const { container } = renderList();
    const mounted = Array.from(
      container.querySelectorAll<HTMLElement>('.task-tree-virtual-row'),
    );
    // Precondition — this is the assertion's whole force: the window is
    // a fraction of the tree, so a count taken over it would be off by
    // hundreds and its positions would restart from 1 on every scroll.
    expect(mounted.length).toBeGreaterThan(1);
    expect(mounted.length).toBeLessThan(ROW_COUNT / 4);

    for (const wrapper of mounted) {
      const index = Number(wrapper.dataset.index);
      const rowEl = wrapper.querySelector('.task-tree-node-row')!;
      expect(rowEl.getAttribute('aria-setsize')).toBe(String(ROW_COUNT));
      expect(rowEl.getAttribute('aria-posinset')).toBe(String(index + 1));
    }
  });

  test('a row scrolled to from far away keeps its place in the whole tree', () => {
    // The same property observed after the window has MOVED: row 400 is
    // the 400th of 500 whether the reader arrived at it from the top or
    // jumped straight to it.
    const ref = createRef<TaskTreeScroller>();
    const { container } = renderList(ref);
    emulateScrolling(container);
    act(() => {
      ref.current!.scrollRowIntoView('demo-400', 'start');
    });

    const wrapper = container.querySelector<HTMLElement>(
      '.task-tree-virtual-row[data-index="399"]',
    );
    expect(wrapper).not.toBeNull();
    const rowEl = wrapper!.querySelector('.task-tree-node-row')!;
    expect(rowEl.getAttribute('aria-posinset')).toBe('400');
    expect(rowEl.getAttribute('aria-setsize')).toBe(String(ROW_COUNT));
  });

  test('a row nobody has rendered is budgeted at the same height as one they have', () => {
    // sk-285.2.19 — the inverse of the property this test used to hold.
    // Rows were mini-cards whose height followed their depth and their
    // title length, so the budget for an unrendered row had to be
    // modelled per row (`lib/treeRowHeightEstimate.ts`, now retired).
    // Decision B made every row exactly `--tree-row-h` tall, so the
    // budget is a constant — and a component that went back to guessing
    // per row would make the two canvases below differ.
    //
    // Two trees, identical for the whole mounted window and differing
    // only in rows BELOW it — the ones the virtualizer never renders.
    // Deep rows with very long titles are exactly what used to make a
    // row taller, so they are what a per-row guess would react to.
    const TOTAL = 80;
    const SAME_UNTIL = 40; // safely past the mounted window
    const build = (deep: boolean): FlatTreeRow[] =>
      Array.from({ length: TOTAL }, (_, i) => {
        const base = row(`demo-${i + 1}`);
        if (i < SAME_UNTIL || !deep) return base;
        return {
          ...base,
          depth: 6,
          edgeType: 'parent-child',
          item: { ...base.item, title: 'w'.repeat(60) },
        };
      });

    const shallow = renderList(undefined, build(false));
    const shallowMounted = shallow.container.querySelectorAll(
      '.task-tree-virtual-row',
    ).length;
    const shallowHeight = canvasHeight(shallow.container);
    cleanup();

    const deep = renderList(undefined, build(true));
    const deepMounted = deep.container.querySelectorAll(
      '.task-tree-virtual-row',
    ).length;
    const deepHeight = canvasHeight(deep.container);

    // Precondition: the rows that differ are all outside the window, so
    // any difference below could only come from the budget.
    expect(shallowMounted).toBe(deepMounted);
    expect(shallowMounted).toBeLessThan(SAME_UNTIL);

    expect(deepHeight).toBe(shallowHeight);
    // …and the budget really is the row height, not merely some other
    // constant applied consistently.
    expect(shallowHeight).toBe(TOTAL * TREE_ROW_HEIGHT_PX);
  });

  test('an issue with no row on screen is reported, not silently ignored', () => {
    const ref = createRef<TaskTreeScroller>();
    const { container } = renderList(ref);
    const offset = emulateScrolling(container);

    expect(ref.current!.rowIndex('demo-99999')).toBe(-1);
    let answered: boolean | undefined;
    act(() => {
      answered = ref.current!.scrollRowIntoView('demo-99999');
    });
    expect(answered).toBe(false);
    expect(offset()).toBe(0);
  });
});

/**
 * sk-285.2.19 — the column header strip.
 *
 * It is the half of the table only the LIST can be asked about: a row
 * knows which columns it prints, but only the list draws the headings
 * over them, and only the list decides where the strip sits relative to
 * the `role="tree"` canvas and to the scroll container.
 */
describe('sk-285.2.19 — the header names the columns the rows print', () => {
  /** The column each header cell carries, in DOM order. */
  function headColumns(container: HTMLElement): string[] {
    return Array.from(
      container.querySelectorAll('.task-tree-head-cell'),
    ).map(
      (el) =>
        [...el.classList]
          .find((c) => c.startsWith('task-tree-head-cell--'))
          ?.replace('task-tree-head-cell--', '') ?? '?',
    );
  }

  /** The column each cell of the FIRST rendered row carries, in order. */
  function firstRowColumns(container: HTMLElement): string[] {
    const rowEl = container.querySelector('.task-tree-node-row')!;
    return Array.from(rowEl.querySelectorAll('.task-tree-cell')).map(
      (el) =>
        [...el.classList]
          .find((c) => c.startsWith('task-tree-cell--'))
          ?.replace('task-tree-cell--', '') ?? '?',
    );
  }

  test('one heading per column, title first, in registry order', () => {
    const { container } = renderList();
    expect(headColumns(container)).toEqual(['title', ...TREE_DEFAULT_COLUMNS]);
  });

  test('the headings and the row cells are the SAME list in the SAME order', () => {
    // The one failure a table can have that looks like no failure at
    // all: a value printed under somebody else's heading.
    const { container } = renderList();
    expect(headColumns(container)).toEqual(firstRowColumns(container));
  });

  test('switching a column off drops its heading and its cells together', () => {
    const without = TREE_DEFAULT_COLUMNS.filter((c) => c !== 'priority');
    const { container } = renderList(undefined, ROWS, without);
    expect(headColumns(container)).toEqual(['title', ...without]);
    expect(headColumns(container)).toEqual(firstRowColumns(container));
    expect(container.querySelector('.task-tree-head-cell--priority')).toBeNull();
  });

  test('every heading is named — including the pinned title column', () => {
    // The strip is the only place the reader is told what a column of
    // bare chips means. Blank is one way to fail; the other, and the
    // likelier one, is a MISSING dictionary entry — i18next answers a
    // missing key with the key itself, so `filters.treeColumns.title`
    // would render as that literal string and look like a label to
    // anything that only checked for emptiness. Every column, the
    // structural one included, is checked for both. Setup boots the real
    // dictionaries (`test/setup.ts`), so this is the shipped copy.
    const { container } = renderList(undefined, ROWS, TREE_OPTIONAL_COLUMNS);
    const cells = container.querySelectorAll('.task-tree-head-cell');
    expect(cells.length).toBe(TREE_OPTIONAL_COLUMNS.length + 1);
    for (const cell of cells) {
      const text = cell.textContent?.trim() ?? '';
      expect(text, cell.className).not.toBe('');
      expect(text, cell.className).not.toContain('treeColumns.');
    }
  });

  test('the strip is inside the scroller but OUTSIDE the grid element', () => {
    // Inside the scroll container, because that is what makes it hold
    // its place vertically and travel with the columns horizontally.
    // Outside the `role="treegrid"` canvas, whose height is the
    // virtualizer's arithmetic and which the sticky strip therefore
    // cannot live in. sk-285.2.19 (step 3) closes the gap that leaves —
    // the grid ADOPTS the strip with `aria-owns`, which is pinned in
    // `TaskTreeVirtualList.treegrid.test.tsx`.
    const { container } = renderList();
    const strip = container.querySelector('.task-tree-head')!;
    const scroller = container.querySelector('.col-body')!;
    const grid = container.querySelector('[role="treegrid"]')!;
    expect(scroller.contains(strip)).toBe(true);
    expect(grid.contains(strip)).toBe(false);
  });
});
