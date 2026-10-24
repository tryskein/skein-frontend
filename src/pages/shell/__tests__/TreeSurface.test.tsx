/**
 * sk-285.7 T028 — the Tree view under the new language (handoff §6
 * «Tree view»): three chevron states (`chevron-down` / `chevron-right` /
 * `point`), the leaf point that is not a control, and the id badge that
 * renders inside the cell which steps it down.
 *
 * `TreeTableLayout.test.tsx` owns the column set and `TaskTreeNode.layout
 * .test.tsx` owns the row's cell STRUCTURE; this file owns what T028
 * could only prove by rendering.
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

function renderRow(r: FlatTreeRow, expanded: Set<string> = new Set()) {
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
            expanded={expanded}
            searchQuery=""
            componentNames={new Map()}
            columns={treeColumnOrder(TREE_DEFAULT_COLUMNS)}
            columnsMask={treeColumnsMask(TREE_DEFAULT_COLUMNS)}
            onSelect={() => {}}
            onToggle={() => {}}
            position={{ setSize: 1, posInSet: 1 }}
            ariaRowIndex={2}
          />
        </MemoryRouter>
      </MantineProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => cleanup());

describe('T028 · the three chevron states — §6 «chevron-down/right/point»', () => {
  test('an expanded parent draws chevron-down', () => {
    const { container } = renderRow(
      row(issue(), { hasChildren: true }),
      new Set(['sk-42.1']),
    );
    const svg = container.querySelector('.task-tree-toggle svg')!;
    expect(svg.classList.contains('tabler-icon-chevron-down')).toBe(true);
  });

  test('a collapsed parent draws chevron-right', () => {
    const { container } = renderRow(row(issue(), { hasChildren: true }));
    const svg = container.querySelector('.task-tree-toggle svg')!;
    expect(svg.classList.contains('tabler-icon-chevron-right')).toBe(true);
  });

  test('a LEAF draws the point — §6’s third state, which used to be nothing', () => {
    // The gutter of a tree is scanned, and an empty box of the chevron's
    // width kept the alignment while saying nothing. The dot answers the
    // question the reader is actually asking there.
    const { container } = renderRow(row(issue()));
    expect(container.querySelector('.task-tree-toggle')).toBeNull();
    const holder = container.querySelector('.task-tree-toggle-placeholder')!;
    const svg = holder.querySelector('svg')!;
    expect(svg.classList.contains('tabler-icon-point')).toBe(true);
  });

  test('the point is not a control, and does not pretend to be one', () => {
    // It is a `<span>` and it is hidden from assistive tech (the row's
    // own `aria-expanded` — absent on a leaf — is where the same fact is
    // read).
    const { container } = renderRow(row(issue()));
    const holder = container.querySelector('.task-tree-toggle-placeholder')!;
    expect(holder.tagName).toBe('SPAN');
    expect(holder.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('T028 · the id badge really is inside the cell that steps it down', () => {
  /**
   * A custom property inherits DOWN and never sideways, so
   * `.task-tree-cell--id` may only carry the badge's size knob while the
   * badge actually renders INSIDE it. A render can check that.
   */
  test('the rendered id cell contains the badge', () => {
    const { container } = renderRow(row(issue()));
    const cell = container.querySelector('.task-tree-cell--id')!;
    expect(cell, 'the default column set has no id cell').not.toBeNull();
    const badge = cell.querySelector('.issue-id-badge');
    expect(badge, 'the id badge is not inside the cell declaring its knob').not
      .toBeNull();
    expect(badge!.textContent).toContain('sk-42.1');
  });
});
