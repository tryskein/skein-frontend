/**
 * sk-133 — standing-status rows get a THICK left accent rail so a
 * perpetual obligation stands out beyond the small ∞ pill. The rail is a
 * theme-safe `.is-standing` class on the row element (Cards: `.task-card`,
 * Tree: `.task-tree-node-row`). These tests assert the class is applied for `status: 'standing'` and absent for
 * a normal `open` row, in BOTH views, plus that the standing status
 * <Attribute> pill carries the standing marker.
 */

import { afterEach, describe, expect, test } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { TaskCard } from '../TaskCard';
import {
  LIST_DEFAULT_CARD_FIELDS,
  listCardFieldsMask,
} from '../../../lib/listCardFields';
import { TaskTreeNode } from '../TaskTreeNode';
import {
  TREE_DEFAULT_COLUMNS,
  treeColumnOrder,
  treeColumnsMask,
} from '../../../lib/treeColumns';
import { Attribute } from '../../../components/Attribute';
import type { IssueSummary } from '../../../api/issues';
import type { FlatTreeRow } from '../../../lib/flattenTree';

/**
 * sk-285.2.19 — the row is a TABLE row now, so it has to be told which
 * columns to print. The DEFAULT set is used here: this file is not about
 * the column preference, and the defaults are what a user who never
 * opens the picker sees.
 */
const COLUMNS = treeColumnOrder(TREE_DEFAULT_COLUMNS);
const COLUMNS_MASK = treeColumnsMask(TREE_DEFAULT_COLUMNS);

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

function row(item: IssueSummary): FlatTreeRow {
  return {
    item,
    depth: 0,
    edgeType: null,
    isReference: false,
    isContext: false,
    firstSeenAt: null,
    hasChildren: false,
  };
}

function withProviders(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MantineProvider forceColorScheme="dark">
        <MemoryRouter>{node}</MemoryRouter>
      </MantineProvider>
    </QueryClientProvider>,
  );
}

function renderCard(item: IssueSummary) {
  return withProviders(
    <TaskCard
      item={item}
      selected={false}
      searchQuery=""
      componentNames={new Map()}
      isRinging={false}
      // The default «display properties» — this file is about the
      // standing-task rail, not about which attributes are switched on.
      fields={listCardFieldsMask(LIST_DEFAULT_CARD_FIELDS)}
      onSelect={() => {}}
    />,
  );
}

function renderTreeNode(item: IssueSummary) {
  return withProviders(
    <TaskTreeNode
      row={row(item)}
      selectedId={null}
      expanded={new Set()}
      searchQuery=""
      componentNames={new Map()}
      columns={COLUMNS}
      columnsMask={COLUMNS_MASK}
      onSelect={() => {}}
      onToggle={() => {}}
      // sk-285.2.13 — the row renders one at a time here, so the set it
      // belongs to is the one-row set it is alone in.
      position={{ setSize: 1, posInSet: 1 }}
      // sk-285.2.19 — a lone row is the first data row of a one-row
      // grid: the header row is aria-rowindex 1.
      ariaRowIndex={2}
    />,
  );
}

afterEach(() => cleanup());

describe('sk-133 — standing left-rail class (Cards view)', () => {
  test('a standing row gets the .is-standing rail class', () => {
    const { container } = renderCard(issue({ status: 'standing' }));
    expect(container.querySelector('.task-card.is-standing')).not.toBeNull();
  });

  test('a normal open row does NOT get the .is-standing class', () => {
    const { container } = renderCard(issue({ status: 'open' }));
    expect(container.querySelector('.task-card.is-standing')).toBeNull();
    expect(container.querySelector('.task-card')).not.toBeNull();
  });
});

describe('sk-133 — standing left-rail class (Tree view)', () => {
  test('a standing row gets the .is-standing rail class', () => {
    const { container } = renderTreeNode(issue({ status: 'standing' }));
    expect(
      container.querySelector('.task-tree-node-row.is-standing'),
    ).not.toBeNull();
  });

  test('a normal open row does NOT get the .is-standing class', () => {
    const { container } = renderTreeNode(issue({ status: 'open' }));
    expect(
      container.querySelector('.task-tree-node-row.is-standing'),
    ).toBeNull();
    expect(container.querySelector('.task-tree-node-row')).not.toBeNull();
  });
});

describe('sk-133 — the standing pill', () => {
  test('the standing pill carries the ∞ standing marker and status role', () => {
    const { getByRole, getByText } = withProviders(
      <Attribute kind="status" value="standing" />,
    );
    const chip = getByRole('status');
    expect(chip.getAttribute('aria-label')).toMatch(/Standing/);
    expect(getByText(/standing/i).textContent).toContain('∞');
  });
});
