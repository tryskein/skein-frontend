/**
 * sk-285.2.17 / sk-285.2.22 / sk-285.2.23 — THE DEPTH INDENT in the
 * Tasks tree, and the guides that are no longer drawn on it.
 *
 * A tree row is stepped right purely geometrically —
 * `padding-left: calc(--space-2 + --depth * --tree-indent-step)` on
 * `.task-tree-cell--title` — and that step is now the ONLY nesting cue
 * the tree draws. This file is what holds it.
 *
 * ─── What this file used to guard, and why it no longer does ────────
 *
 * The indent used to be accompanied by two paints, and most of this
 * file was about them:
 *
 *   • an INDENT GUIDE on `.task-tree-cell--title::after` — a hairline
 *     down an ancestor's indent column. sk-285.2.17 drew one per
 *     ancestor (a ladder, from a `repeating-linear-gradient` at the
 *     indent pitch); sk-285.2.22 cut it to a single line on the
 *     immediate parent's column;
 *   • a typed-deps CONNECTOR — a 12px slot before the chevron carrying
 *     a glyph and a coloured rail per edge type, which the guide of the
 *     row below continued downward.
 *
 * sk-285.2.23 removed both, on review of the running app: expanding an
 * epic stacked the connector glyphs into a column of symbols in the left
 * gutter, and the line under them was buying no readability the indent
 * step was not already giving. So the lattice arithmetic that lined the
 * guide up with the parent's rail has no subject any more, and the tests
 * that measured it are gone rather than adapted — there is nothing left
 * for them to be about. What replaced them is a REMOVAL GUARD: the
 * connector must not creep back into the DOM.
 *
 * What is asserted here is the render side of `TaskTreeNode`: the
 * `--depth` the indent keys on, the `.is-epic` class the border
 * compensation keys on, the DOM cost that stays flat with depth, and the
 * connector that is no longer rendered. The indent geometry itself is
 * decided by the stylesheet and is seen in a browser.
 */

import { afterEach, describe, expect, test } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { TaskTreeNode } from '../TaskTreeNode';
import {
  TREE_DEFAULT_COLUMNS,
  treeColumnOrder,
  treeColumnsMask,
} from '../../../lib/treeColumns';
import type { IssueSummary } from '../../../api/issues';
import type { FlatTreeRow } from '../../../lib/flattenTree';

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
    updatedAt: '2026-05-01T10:00:00Z',
    createdAt: '2026-05-01T10:00:00Z',
    ...over,
  };
}

function row(depth: number, over: Partial<IssueSummary> = {}): FlatTreeRow {
  return {
    item: issue({ id: `sk-1${'.1'.repeat(depth)}`, ...over }),
    depth,
    // Every non-root row in this file carries an edge type — the exact
    // condition the removed connector slot rendered on (`depth > 0 &&
    // edgeType`). Holding it constant is what makes the child-count
    // comparison a statement about depth alone, AND what gives the
    // removal guard a row that would have drawn a connector.
    edgeType: depth === 0 ? null : 'parent-child',
    isReference: false,
    firstSeenAt: null,
    isContext: false,
    hasChildren: false,
  };
}

function renderRow(depth: number, over: Partial<IssueSummary> = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MantineProvider forceColorScheme="dark">
        <MemoryRouter>
          <TaskTreeNode
            row={row(depth, over)}
            selectedId={null}
            expanded={new Set()}
            searchQuery=""
            componentNames={new Map()}
            columns={treeColumnOrder(TREE_DEFAULT_COLUMNS)}
            columnsMask={treeColumnsMask(TREE_DEFAULT_COLUMNS)}
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

function rowEl(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>('.task-tree-node-row');
  expect(el).not.toBeNull();
  return el!;
}

afterEach(() => cleanup());

describe('sk-285.2.17 — the row publishes what the indent keys on', () => {
  test.each([0, 1, 4, 6])('depth %i reaches the row as --depth', (depth) => {
    // The title cell's `padding-left` reads `--depth` off this inline
    // style and has no other source for it: a row that stops publishing
    // it renders at level 0 whatever its real depth, and since
    // sk-285.2.23 the indent is the ONLY thing that says how deep a row
    // is — there is no guide left to fall back on.
    const { container } = renderRow(depth);
    expect(rowEl(container).style.getPropertyValue('--depth')).toBe(
      String(depth),
    );
  });

  test('an epic row is marked .is-epic and a task row is not', () => {
    // `.is-epic` is not only the `--violet` rail: it is the hook that sets
    // `--row-rail-w`, i.e. the compensation for the 3px border that rail
    // is painted with. A row that stops carrying the class keeps the
    // border (it comes with `.is-epic`) — or loses both — but either way
    // the class and the border must travel together.
    const epic = renderRow(2, { type: 'epic' });
    expect(rowEl(epic.container).classList.contains('is-epic')).toBe(true);
    cleanup();

    const task = renderRow(2, { type: 'task' });
    expect(rowEl(task.container).classList.contains('is-epic')).toBe(false);
  });
});

describe('sk-285.2.23 — the connector slot is not rendered any more', () => {
  test.each([1, 2, 6])(
    'a depth-%i row with a typed edge draws no connector element',
    (depth) => {
      // `renderRow` gives every non-root row `edgeType: 'parent-child'`,
      // which is exactly the condition the removed slot rendered on
      // (`depth > 0 && edgeType`). So this is the removal itself, stated
      // where it can be observed: no element.
      const { container } = renderRow(depth);
      expect(
        rowEl(container).querySelector('.task-tree-connector'),
      ).toBeNull();
    },
  );

  test('and the edge type is nowhere in the row, not even as a class', () => {
    // The information the connector carried is gone from the tree
    // altogether — that is the accepted cost, written down so a future
    // reader finds a test rather than a silence. `row.edgeType` still
    // exists on the flat row (see `lib/flattenTree.ts`); bringing it
    // back means a column of the table, not a slot in the title cell.
    // See the header of `TaskTreeNode.tsx`.
    const { container } = renderRow(3);
    expect(rowEl(container).outerHTML).not.toMatch(/parent-child/);
  });
});

describe('sk-285.2.17 — the indent costs no DOM per nesting level', () => {
  test('a depth-6 row has the same element count as a depth-1 row', () => {
    // The indent is a `padding-left`, not a box per level: the rows are
    // virtualized, so per-level boxes would be laid out again for every
    // row the window mounts, on every scroll frame — for decoration.
    // (Until sk-285.2.19 they were also measured one by one with
    // `measureElement`, which made the same point louder; the fixed row
    // height retired the measuring, not the cost.)
    const shallow = renderRow(1);
    const shallowKids = rowEl(shallow.container).querySelectorAll('*').length;
    cleanup();

    const deep = renderRow(6);
    const deepKids = rowEl(deep.container).querySelectorAll('*').length;

    expect(deepKids).toBe(shallowKids);
  });
});
