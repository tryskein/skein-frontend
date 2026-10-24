/**
 * sk-285.2.7 — how the tree row renders a CONTEXT row: a parent pulled
 * in by the ancestor backfill so the branch under it is whole.
 *
 * Three properties are pinned, and each of them is a way the feature
 * could quietly go wrong:
 *
 *   1. The row is marked in its accessible name — otherwise a row that never
 *      passed the filter reads as one that did, and the column's header
 *      count stops matching what the user sees.
 *   2. The row has NO chevron. The caller keeps context rows permanently
 *      expanded; a chevron that toggles nothing would be a dead control,
 *      and one that worked would hide the matched rows behind
 *      scaffolding the user never asked for.
 *   3. It stays openable. A context row is a real issue — dimming it is
 *      a statement about why it is on screen, not about what it is.
 *
 * The last test guards the OTHER structural row kind: cross-project
 * parents the caller cannot see still arrive from the backend as
 * `isReference` hidden stubs. Context rows must not disturb that path.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
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

/**
 * sk-285.2.19 — the row is a TABLE row and has to be told which columns
 * to print. The DEFAULT set: this file is not about the column
 * preference, and the defaults are what a user who never opens the
 * picker sees.
 */
const COLUMNS = treeColumnOrder(TREE_DEFAULT_COLUMNS);
const COLUMNS_MASK = treeColumnsMask(TREE_DEFAULT_COLUMNS);

function issue(over: Partial<IssueSummary> = {}): IssueSummary {
  return {
    id: 'sk-42',
    projectId: 'p',
    version: 1,
    title: 'parent epic',
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

function row(over: Partial<FlatTreeRow> = {}): FlatTreeRow {
  return {
    item: issue(),
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
  onSelect = () => {},
  onToggle = () => {},
  searchQuery = '',
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
            searchQuery={searchQuery}
            componentNames={new Map()}
            columns={COLUMNS}
            columnsMask={COLUMNS_MASK}
            onSelect={onSelect}
            onToggle={onToggle}
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

afterEach(() => cleanup());

describe('sk-285.2.7 / sk-285.2.8 — context rows in the tree', () => {
  test('a context row announces itself as context in its accessible name', () => {
    const { container } = renderTreeNode(row({ isContext: true }));
    expect(container.querySelector('.task-tree-node-row')!.getAttribute('aria-label')).toBe(
      'Open sk-42: parent epic (parent shown for context, not a filter match)',
    );
  });

  test('an ordinary row does not', () => {
    const { container } = renderTreeNode(row());
    expect(container.querySelector('.task-tree-node-row')!.getAttribute('aria-label')).toBe(
      'Open issue sk-42: parent epic',
    );
  });

  test('a context row with children renders no chevron', () => {
    const { container } = renderTreeNode(row({ isContext: true, hasChildren: true }));
    expect(container.querySelector('.task-tree-toggle')).toBeNull();
    expect(container.querySelector('.task-tree-toggle-placeholder')).not.toBeNull();
  });

  test('an ordinary row with children still renders its chevron', () => {
    const { container } = renderTreeNode(row({ hasChildren: true }));
    expect(container.querySelector('.task-tree-toggle')).not.toBeNull();
  });

  // sk-285.2.19 — the click target is the ROW, not an inner body box.
  // The row is a table row now: clicking its status or its assignee is
  // clicking the row, and a handler that only covered the title cell
  // would make most of the row dead.
  test('a context row is still clickable and opens its issue', () => {
    const onSelect = vi.fn();
    const { container } = renderTreeNode(row({ isContext: true }), onSelect);
    const rowEl = container.querySelector('.task-tree-node-row');
    expect(rowEl).not.toBeNull();
    fireEvent.click(rowEl!);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0].id).toBe('sk-42');
  });

  test('a value cell of a context row opens it too', () => {
    // The property the row-level handler exists for: the click lands on
    // a cell several columns away from the title and still selects.
    const onSelect = vi.fn();
    const { container } = renderTreeNode(row({ isContext: true }), onSelect);
    const cell = container.querySelector('.task-tree-cell--assignee');
    expect(cell).not.toBeNull();
    fireEvent.click(cell!);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  // sk-285.2.8 — a context row is on screen to explain WHERE a match
  // lives, so it must not itself look like one. A yellow hit inside its
  // title would claim a match the query never made.
  test('a matched row highlights the query', () => {
    const { container } = renderTreeNode(
      row({ item: issue({ title: 'parent epic' }) }),
      () => {},
      () => {},
      'epic',
    );
    expect(container.querySelector('.task-card-title-text b')?.textContent).toBe(
      'epic',
    );
  });

  test('a context row carries no search highlight', () => {
    const { container } = renderTreeNode(
      row({ isContext: true, item: issue({ title: 'parent epic' }) }),
      () => {},
      () => {},
      'epic',
    );
    expect(container.querySelector('.task-card-title-text b')).toBeNull();
    expect(container.querySelector('.task-card-title-text')?.textContent).toBe(
      'parent epic',
    );
  });

  test('the hidden cross-project stub is untouched by the context path', () => {
    const onSelect = vi.fn();
    const { container } = renderTreeNode(
      row({
        item: issue({ title: '<hidden>' }),
        depth: 1,
        edgeType: 'parent-child',
        isReference: true,
        firstSeenAt: null,
      }),
      onSelect,
    );
    // Still the plain gray row that opens NOTHING: there is no issue
    // behind it to open. Stated as behaviour rather than as "no inner
    // button", because sk-285.2.19 moved the click handler onto the row
    // itself — the absence has to be checked where the handler now is.
    fireEvent.click(container.querySelector('.task-tree-node-row')!);
    expect(onSelect).not.toHaveBeenCalled();
    // …and no jump affordance, and NOT dressed as a context row.
    expect(container.querySelector('.task-tree-hidden-stub')).not.toBeNull();
    expect(container.querySelector('.task-tree-jump-ref')).toBeNull();
    expect(container.querySelector('.task-tree-node-row')!.getAttribute('aria-label')).not.toMatch(
      /context/,
    );
    expect(container.querySelector('.task-tree-node-row.is-reference')).not.toBeNull();
  });

  test('F-4: a hidden stub draws its value cells empty — status and type never reach them', () => {
    // sk-421.2 / INV-2 — the row of an inaccessible task carries EMPTY status and
    // type. The stub branch is chosen by three conditions at once
    // (`isReference && firstSeenAt === null && title === '<hidden>'`,
    // TaskTreeNode.tsx:379), so the fixture carries all of them: without it
    // the row would render as a normal one, and the checks below would pass VACUOUSLY,
    // saying nothing about F-4.
    const item: FlatTreeRow['item'] = {
      ...issue({ title: '<hidden>' }),
      status: '',
      type: '',
    };
    const { container } = renderTreeNode(
      row({
        item,
        depth: 1,
        edgeType: 'parent-child',
        isReference: true,
        firstSeenAt: null,
      }),
    );
    const rowEl = container.querySelector('.task-tree-node-row')!;

    // Positive control: the stub branch really was taken.
    expect(container.querySelector('.task-tree-hidden-stub')).not.toBeNull();
    expect(rowEl.classList.contains('is-reference')).toBe(true);

    // And above all — the MECHANISM itself that F-4 rests on: the meaningful cells
    // of the stub are rendered (otherwise the columns to the right would shift and the table
    // would lose alignment exactly on the rows that already read
    // oddly), but are empty — status and type do not reach `renderCell`
    // at all. This can fail: it is enough to remove the stub short-circuit (TaskTreeNode.tsx:633)
    // together with the empty-value guards in `renderCell`.
    // The title cell is excluded from the selection on purpose: it also carries
    // the `task-tree-cell` class (:500-501) and carries the stub title.
    const valueCells = Array.from(
      container.querySelectorAll('.task-tree-cell:not(.task-tree-cell--title)'),
    );
    expect(valueCells.length).toBeGreaterThan(0);
    for (const cell of valueCells) {
      expect(cell.textContent).toBe('');
    }
  });
});
