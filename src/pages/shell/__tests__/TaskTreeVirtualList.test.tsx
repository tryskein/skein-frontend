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
  anchorScope?: string,
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const result = render(listElement(client, ref, rows, columns, anchorScope));
  return {
    ...result,
    /** Re-render the same mounted list with another set of rows (and scope). */
    rerenderRows: (next: FlatTreeRow[], nextScope: string | undefined = anchorScope) =>
      result.rerender(listElement(client, ref, next, columns, nextScope)),
  };
}

function listElement(
  client: QueryClient,
  ref: RefObject<TaskTreeScroller> | undefined,
  rows: FlatTreeRow[],
  columns: readonly TreeOptionalColumn[],
  anchorScope?: string,
) {
  return (
    <QueryClientProvider client={client}>
      <MantineProvider forceColorScheme="dark">
        <MemoryRouter>
          <TaskTreeVirtualList
            ref={ref}
            rows={rows}
            anchorScope={anchorScope}
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
    </QueryClientProvider>
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
function emulateScrolling(
  container: HTMLElement,
  viewportPx: number | (() => number) = VIEWPORT_PX,
  /** Whether a written offset fires `scroll` now (a browser may not for a box it does not lay out). */
  firesScroll: () => boolean = () => true,
): () => number {
  const body = container.querySelector<HTMLElement>('.col-body')!;
  const height = typeof viewportPx === 'number' ? () => viewportPx : viewportPx;
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
    get: height,
  });
  Object.defineProperty(body, 'scrollHeight', {
    configurable: true,
    get: () => canvasHeight(container),
  });
  body.scrollTo = ((options?: ScrollToOptions) => {
    const top = options?.top ?? 0;
    if (top === offset) return; // a browser fires no event for a no-op
    offset = top;
    if (firesScroll()) body.dispatchEvent(new Event('scroll'));
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

// ─────────── sk-763 — the reading position survives new data ───────────
//
// The reference is the acceptance of sk-763: a background refresh of the
// tree's data does not move the reading position. With the rows at a fixed
// height, the row at the top of the viewport is the reader's anchor: rows
// that appear or go away ABOVE it must not slide it up or down, and a
// reader at the very top keeps seeing the top, where new rows appear. The
// expected offsets are literal row arithmetic of the fixture, not read off
// the component.

describe('sk-763 — the row the reader is at keeps its place when rows change above it', () => {
  /** Scroll the emulated container like a reader would. */
  function scrollTo(container: HTMLElement, top: number): void {
    const body = container.querySelector<HTMLElement>('.col-body')!;
    act(() => {
      body.scrollTo({ top });
    });
  }

  /** The reader is at row demo-301 (index 300), 10 px into it. */
  const READING_AT = 300 * TREE_ROW_HEIGHT_PX + 10;

  test('three rows added above: the offset moves by exactly three rows, the same row stays on top', () => {
    const view = renderList();
    const offset = emulateScrolling(view.container);
    scrollTo(view.container, READING_AT);
    expect(renderedTitles(view.container)).toContain('title demo-301');

    act(() => {
      view.rerenderRows([row('new-1'), row('new-2'), row('new-3'), ...ROWS]);
    });

    expect(offset()).toBe(READING_AT + 3 * TREE_ROW_HEIGHT_PX);
    expect(renderedTitles(view.container)).toContain('title demo-301');
  });

  test('two rows above go away: the offset moves back by exactly two rows', () => {
    const view = renderList();
    const offset = emulateScrolling(view.container);
    scrollTo(view.container, READING_AT);

    act(() => {
      view.rerenderRows(ROWS.filter((r) => r.item.id !== 'demo-5' && r.item.id !== 'demo-6'));
    });

    expect(offset()).toBe(READING_AT - 2 * TREE_ROW_HEIGHT_PX);
  });

  test('the top row itself goes away: the next row of the window keeps its place', () => {
    const view = renderList();
    const offset = emulateScrolling(view.container);
    scrollTo(view.container, READING_AT);

    // demo-301 is gone and one row is added above: demo-302 was one row
    // below the top, and stays one row below where the top was.
    act(() => {
      view.rerenderRows([row('new-1'), ...ROWS.filter((r) => r.item.id !== 'demo-301')]);
    });

    expect(offset()).toBe(READING_AT);
  });

  test('a reader at the very top stays at the top, where the new rows appear', () => {
    const view = renderList();
    const offset = emulateScrolling(view.container);

    act(() => {
      view.rerenderRows([row('new-1'), row('new-2'), ...ROWS]);
    });

    expect(offset()).toBe(0);
    expect(renderedTitles(view.container)).toContain('title new-1');
  });

  test('another scope (filters, sort, project) is another list: its rows, even from the cache at once, do not move the offset', () => {
    const view = renderList(undefined, ROWS, TREE_DEFAULT_COLUMNS, 'scope-a');
    const offset = emulateScrolling(view.container);
    scrollTo(view.container, READING_AT);

    // The same rows lead the other list, shifted: within one scope this
    // would be an anchor shift of three rows.
    act(() => {
      view.rerenderRows([row('new-1'), row('new-2'), row('new-3'), ...ROWS], 'scope-b');
    });
    expect(offset()).toBe(READING_AT);

    // Back in the new scope, a background refresh is anchored again.
    act(() => {
      view.rerenderRows([row('new-0'), row('new-1'), row('new-2'), row('new-3'), ...ROWS], 'scope-b');
    });
    expect(offset()).toBe(READING_AT + TREE_ROW_HEIGHT_PX);
  });

  /** The same rows with `ids` taken out and put back, in that order, from index `to`. */
  function moved(ids: readonly string[], to: number): FlatTreeRow[] {
    const rest = ROWS.filter((r) => !ids.includes(r.item.id));
    const block = ids.map((id) => ROWS.find((r) => r.item.id === id)!);
    return [...rest.slice(0, to), ...block, ...rest.slice(to)];
  }

  // Rows re-sorted by a change of their own (an edit moves them in the
  // server's order) leave their places: the rest of the viewport is the
  // reading context, and the offset keeps the most rows of the viewport
  // where they are on screen — whether the moved row was the top one or
  // not, and however many moved together. The rows viewport is the body
  // less the table head, 800 − 40 = 760 px; from 300·44+10 = 13210 it shows
  // [13210, 13970): rows 300…317 (row 317 is 13948…13992, row 318 starts at
  // 13992, out of view). The expected offsets are the index arithmetic of
  // the fixture over those 18 rows.
  test.each<[string, readonly string[], number, number]>([
    // 17 rows (prev 301…317) keep their index: one row out above them, one in above them.
    ['the top row moves up, far above the window (300 → 20)', ['demo-301'], 20, READING_AT],
    // 17 rows (prev 301…317) move up one index.
    ['the top row moves down, far below the window (300 → 450)', ['demo-301'], 450, READING_AT - TREE_ROW_HEIGHT_PX],
    // 10 rows (prev 301…310) move up one index, 7 (prev 311…317) keep theirs.
    ['the top row moves down inside the window (300 → 310)', ['demo-301'], 310, READING_AT - TREE_ROW_HEIGHT_PX],
    // 9 rows (prev 301…309) move up one index, 8 (prev 310…317) keep theirs;
    // row 318, out of view, has no say.
    ['the top row moves down inside the window (300 → 309)', ['demo-301'], 309, READING_AT - TREE_ROW_HEIGHT_PX],
    // 13 rows (prev 305…317) keep their index, 4 (prev 300…303) move down one.
    ['another row of the window moves up, far above it (304 → 20)', ['demo-305'], 20, READING_AT],
    // 16 rows (prev 302…317) keep their index; the two moved ones stay neighbours.
    ['the two top rows move up together, far above the window (300, 301 → 20, 21)', ['demo-301', 'demo-302'], 20, READING_AT],
  ])('%s: the reading context keeps its place', (_n, ids, to, expected) => {
    const view = renderList();
    const offset = emulateScrolling(view.container);
    scrollTo(view.container, READING_AT);

    act(() => {
      view.rerenderRows(moved(ids, to));
    });

    expect(offset()).toBe(expected);
  });

  // A browser scrolls by fractions of a pixel: a row counts when any part
  // of it is in [offset, offset + 760). The move is the top row 300 → 309:
  // prev 301…309 move up one index, prev 310…318 keep theirs.
  test.each<[string, number, number]>([
    // [13232.2, 13992.2): row 318 (13992…14036) is in view by 0.2 px — 9 rows
    // move, 9 stay: a tie, and the smaller move (none) is taken.
    ['the viewport ends 0.2 px into row 318', 13232.2, 13232.2],
    // [13231.8, 13991.8): row 318 is not in view — 9 rows move, 8 stay.
    ['the viewport ends 0.2 px before row 318', 13231.8, 13187.8],
    // [13232, 13992): row 318 starts exactly where the range ends — not in view; 9 rows move, 8 stay.
    ['the viewport ends exactly where row 318 starts', 13232, 13188],
  ])('%s: the rows partly in view count, the rows out of view do not', (_n, readingAt, expected) => {
    const view = renderList();
    const offset = emulateScrolling(view.container);
    scrollTo(view.container, readingAt);

    act(() => {
      view.rerenderRows(moved(['demo-301'], 309));
    });

    expect(offset()).toBeCloseTo(expected, 6);
  });

  // A body no taller than the table head shows no row at all: there is no
  // reading context to keep, and rows moving do not move the offset.
  test.each<[string, number]>([
    ['as tall as the head (no room for rows)', 40],
    ['shorter than the head', 39],
  ])('a body %s: the top row moving away (300 → 20) leaves the offset where it is', (_n, bodyPx) => {
    const view = renderList();
    const offset = emulateScrolling(view.container, bodyPx);
    scrollTo(view.container, READING_AT);

    act(() => {
      view.rerenderRows(moved(['demo-301'], 20));
    });

    expect(offset()).toBe(READING_AT);
  });

  /** `rows` with `ids` taken out and put back, in that order, from index `to`. */
  function movedIn(rows: readonly FlatTreeRow[], ids: readonly string[], to: number): FlatTreeRow[] {
    const rest = rows.filter((r) => !ids.includes(r.item.id));
    const block = ids.map((id) => rows.find((r) => r.item.id === id)!);
    return [...rest.slice(0, to), ...block, ...rest.slice(to)];
  }

  // On a phone the Tasks zone the reader left stays mounted with a body of
  // no height (its rows are not laid out: `clientHeight` 0, or its padding
  // alone), and its offset is kept. What the reader read is the viewport
  // they saw last — 760 px of rows from 13210, rows 300…317. A row loaded
  // below it moving to the top while the zone is hidden moves every one of
  // those rows down one index: the offset follows them, so the reader comes
  // back to the rows they left, and each such move adds one row more —
  // whether or not the hidden body reports the offsets written to it.
  test.each<[string, number, boolean]>([
    ['a body of no height, reporting its scroll', 0, true],
    ['a body of no height, not reporting its scroll', 0, false],
    ['a body as tall as its padding, reporting its scroll', 16, true],
    ['a body as tall as its padding, not reporting its scroll', 16, false],
  ])('the reader read, then left the zone (%s): rows moving above them keep the reading context for the return', (_n, hiddenPx, hiddenScrollEvents) => {
    let bodyPx = VIEWPORT_PX;
    const view = renderList();
    const offset = emulateScrolling(view.container, () => bodyPx, () => bodyPx === VIEWPORT_PX || hiddenScrollEvents);
    scrollTo(view.container, READING_AT);

    bodyPx = hiddenPx;
    // demo-450 (index 449, below the viewport) moves to index 0: demo-301 300 → 301.
    const once = movedIn(ROWS, ['demo-450'], 0);
    act(() => {
      view.rerenderRows(once);
    });
    expect(offset()).toBe(READING_AT + TREE_ROW_HEIGHT_PX);

    // demo-451 (index 450, still below) moves to index 0 as well: demo-301 301 → 302.
    act(() => {
      view.rerenderRows(movedIn(once, ['demo-451'], 0));
    });
    expect(offset()).toBe(READING_AT + 2 * TREE_ROW_HEIGHT_PX);

    // Back on the zone: the offset is where the rows are, and the row read is in view.
    bodyPx = VIEWPORT_PX;
    act(() => {
      view.container.querySelector<HTMLElement>('.col-body')!.dispatchEvent(new Event('scroll'));
    });
    expect(offset()).toBe(READING_AT + 2 * TREE_ROW_HEIGHT_PX);
    expect(renderedTitles(view.container)).toContain('title demo-301');
  });

  // What the offset was moved to while hidden is the reader's position only
  // until the reader moves: back on the zone, they scroll to 13210 — the
  // very offset the list was at before — and read there. A row loaded below
  // that moving to the top then keeps THAT position.
  test('back on the zone, the reader scrolls to where the list once was: the next rows moving above keep the new position', () => {
    let bodyPx = VIEWPORT_PX;
    const view = renderList();
    const offset = emulateScrolling(view.container, () => bodyPx, () => bodyPx === VIEWPORT_PX);
    scrollTo(view.container, READING_AT);

    bodyPx = 0;
    // demo-450 (index 449) → 0 while hidden; the hidden body reports no scroll.
    const once = movedIn(ROWS, ['demo-450'], 0);
    act(() => {
      view.rerenderRows(once);
    });
    expect(offset()).toBe(READING_AT + TREE_ROW_HEIGHT_PX);

    bodyPx = VIEWPORT_PX;
    scrollTo(view.container, READING_AT);
    expect(offset()).toBe(READING_AT);

    // demo-451 (index 450, below the viewport) → 0: rows 300…317 of the new position move down one.
    act(() => {
      view.rerenderRows(movedIn(once, ['demo-451'], 0));
    });
    expect(offset()).toBe(READING_AT + TREE_ROW_HEIGHT_PX);
  });

  test('the reader left the zone and the top row read moves up far away (300 → 20): the rest of what was read keeps its place', () => {
    let bodyPx = VIEWPORT_PX;
    const view = renderList();
    const offset = emulateScrolling(view.container, () => bodyPx);
    scrollTo(view.container, READING_AT);

    bodyPx = 0;
    // 17 rows of the last viewport (prev 301…317) keep their index.
    act(() => {
      view.rerenderRows(moved(['demo-301'], 20));
    });

    expect(offset()).toBe(READING_AT);
  });

  // A body that never showed a row has nothing read to keep: a row moving
  // does not move the offset.
  test.each<[string, number]>([
    ['of no height', 0],
    ['as tall as its padding', 16],
  ])('a body %s from the start: the top row moving away (300 → 20) leaves the offset where it is', (_n, bodyPx) => {
    const view = renderList();
    const offset = emulateScrolling(view.container, bodyPx);
    scrollTo(view.container, READING_AT);

    act(() => {
      view.rerenderRows(moved(['demo-301'], 20));
    });

    expect(offset()).toBe(READING_AT);
  });

  test('the reader left the zone and the list changed (another scope): a row moving in the new list leaves the offset where it is', () => {
    let bodyPx = VIEWPORT_PX;
    const view = renderList(undefined, ROWS, TREE_DEFAULT_COLUMNS, 'scope-a');
    const offset = emulateScrolling(view.container, () => bodyPx);
    scrollTo(view.container, READING_AT);

    bodyPx = 0;
    act(() => {
      view.rerenderRows(ROWS, 'scope-b');
    });
    // The new list was never read: what was read of the old one says nothing of it.
    act(() => {
      view.rerenderRows(movedIn(ROWS, ['demo-450'], 0), 'scope-b');
    });

    expect(offset()).toBe(READING_AT);
  });

  test('rows changing below the reader do not move the offset', () => {
    const view = renderList();
    const offset = emulateScrolling(view.container);
    scrollTo(view.container, READING_AT);

    act(() => {
      view.rerenderRows([...ROWS.filter((r) => r.item.id !== 'demo-450'), row('new-tail')]);
    });

    expect(offset()).toBe(READING_AT);
  });
});
