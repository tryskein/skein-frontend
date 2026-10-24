/**
 * sk-285.2.19 — the geometry of the tree TABLE, as TypeScript computes
 * it and as the rendered list publishes it.
 *
 * `lib/treeColumnLayout.ts` computes the grid template and the width
 * floor the table pans at; `TaskTreeVirtualList` publishes both as
 * custom properties on its scroll container, where the header and the
 * rows inherit them. Both halves are observable without a layout engine:
 * the arithmetic is plain TypeScript, and the publication is an inline
 * `style` plus a DOM ancestry. How the browser lays the grid out is seen
 * in a browser, not here.
 */

import { afterEach, describe, expect, test } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import { TaskTreeVirtualList } from '../TaskTreeVirtualList';
import {
  TREE_COLUMN_WIDTH_PX,
  TREE_TITLE_MIN_PX,
  treeGridTemplate,
  treeTableMinWidthPx,
} from '../../../lib/treeColumnLayout';
import {
  TREE_DEFAULT_COLUMNS,
  TREE_OPTIONAL_COLUMNS,
  treeColumnOrder,
} from '../../../lib/treeColumns';
import type { TreeOptionalColumn } from '../../../lib/treeColumns';
import type { FlatTreeRow } from '../../../lib/flattenTree';
import type { IssueSummary } from '../../../api/issues';

/**
 * A `grid-template-columns` string split into its TOP-LEVEL tracks:
 * `minmax(200px, 1fr)` is one track and contains a space of its own.
 */
function tracksOf(template: string): string[] {
  const tracks: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of template) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ' ' && depth === 0) {
      if (current) tracks.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current) tracks.push(current);
  return tracks;
}

describe('sk-285.2.19 — the width floor, computed in TypeScript', () => {
  test('every column keeps a floor, so no value collapses to mush', () => {
    for (const column of TREE_OPTIONAL_COLUMNS) {
      expect(TREE_COLUMN_WIDTH_PX[column], column).toBeGreaterThanOrEqual(48);
    }
    expect(TREE_TITLE_MIN_PX).toBeGreaterThanOrEqual(160);
  });

  test('the title column is the only elastic track', () => {
    // Extra width goes to the titles — the column a reader reads — and
    // never to a date column that has nothing to do with it.
    const template = treeGridTemplate(treeColumnOrder(TREE_DEFAULT_COLUMNS));
    const tracks = tracksOf(template);
    expect(tracks[0]).toBe(`minmax(${TREE_TITLE_MIN_PX}px, 1fr)`);
    expect(tracks.slice(1).filter((t) => t.includes('fr'))).toEqual([]);
    expect(tracks).toHaveLength(TREE_DEFAULT_COLUMNS.length + 1);
  });
});

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

const RENDER_ROWS: FlatTreeRow[] = [
  {
    item: item('demo-1', 'Alpha'),
    depth: 0,
    edgeType: null,
    isReference: false,
    firstSeenAt: null,
    isContext: false,
    hasChildren: true,
  },
];

function renderTree(columns: readonly TreeOptionalColumn[]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MantineProvider forceColorScheme="dark">
        <MemoryRouter>
          <TaskTreeVirtualList
            rows={RENDER_ROWS}
            hasMoreRows={false}
            selectedId={null}
            expanded={new Set<string>()}
            searchQuery=""
            componentNames={new Map()}
            treeColumns={new Set(columns)}
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

/** The scroll container — the element the two properties are set on. */
function scroller(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>('.tasks-tree-table');
  if (!el) throw new Error('no .tasks-tree-table in the rendered tree');
  return el;
}

/**
 * The elements that consume the published properties, by the selectors
 * `index.css` reads them under (sk-285.2.19): the header and every row
 * read `--tree-grid-cols`, the header and the row canvas read
 * `--tree-table-min-w`.
 */
const CONSUMERS: Record<string, string[]> = {
  '--tree-grid-cols': ['.task-tree-head', '.task-tree-node-row'],
  '--tree-table-min-w': ['.task-tree-head', '.task-tree-virtual-canvas'],
};

afterEach(() => cleanup());

describe('sk-285.2.19 — the geometry is published where the rules inherit it', () => {
  test('the scroll container publishes both properties, with the computed values', () => {
    // The ONE path from `treeColumnLayout.ts` into the browser. Drop the
    // `style` from this element and the stylesheet is asking for two
    // values nobody defines: `grid-template-columns: var(--tree-grid-cols)`
    // resolves to nothing on both the header and every row (one column,
    // full width, cells stacked in it), and `min-width:
    // var(--tree-table-min-w)` to nothing on the header and the canvas,
    // so the table stops panning too. There is no table left — and no
    // render test can see that, because jsdom applies no stylesheet.
    const { container } = renderTree(TREE_DEFAULT_COLUMNS);
    const order = treeColumnOrder(TREE_DEFAULT_COLUMNS);
    const style = scroller(container).style;
    expect(style.getPropertyValue('--tree-grid-cols')).toBe(
      treeGridTemplate(order),
    );
    expect(style.getPropertyValue('--tree-table-min-w')).toBe(
      `${treeTableMinWidthPx(order)}px`,
    );
  });

  test('it publishes them where the rules that read them will inherit them', () => {
    // Custom properties travel by INHERITANCE: publishing them on a
    // sibling of the header, or on the row canvas alone, would leave
    // half the table without tracks. So the publisher has to contain
    // every element that reads the property.
    const { container } = renderTree(TREE_DEFAULT_COLUMNS);
    const root = scroller(container);
    for (const name of ['--tree-grid-cols', '--tree-table-min-w']) {
      const selectors = CONSUMERS[name];
      for (const selector of selectors) {
        // `.tasks-tree-table` itself is a legal consumer (it is where
        // the property is set); everything else has to be inside it.
        const els = Array.from(container.querySelectorAll(selector));
        expect(els.length, `${selector} renders nothing`).toBeGreaterThan(0);
        for (const el of els) {
          expect(
            root === el || root.contains(el),
            `${selector} reads ${name} but is not inside the element that publishes it`,
          ).toBe(true);
        }
      }
    }
  });

  test('the published geometry follows the user\'s column set', () => {
    // The properties are not a constant that could be written into the
    // stylesheet once: switching a column on has to change the tracks
    // AND the floor, or the header keeps the old grid while the rows
    // print a cell the header has no heading for.
    const narrow = renderTree(['id']);
    const narrowStyle = scroller(narrow.container).style;
    const narrowCols = narrowStyle.getPropertyValue('--tree-grid-cols');
    const narrowMin = narrowStyle.getPropertyValue('--tree-table-min-w');
    cleanup();

    const wide = renderTree(['id', 'status']);
    const wideStyle = scroller(wide.container).style;
    expect(wideStyle.getPropertyValue('--tree-grid-cols')).toBe(
      `${narrowCols} ${TREE_COLUMN_WIDTH_PX.status}px`,
    );
    expect(
      Number.parseFloat(wideStyle.getPropertyValue('--tree-table-min-w')),
    ).toBe(Number.parseFloat(narrowMin) + TREE_COLUMN_WIDTH_PX.status);
  });
});
