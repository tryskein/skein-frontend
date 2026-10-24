/**
 * sk-285.2.19 — the column preference reaches the TABLE, through the
 * real column.
 *
 * `lib/__tests__/treeColumns*.test.*` pin the registry and its
 * persistence; `TaskTreeNode.layout.test.tsx` and
 * `TaskTreeVirtualList.test.tsx` pin that a row and a header draw
 * whatever set they are handed. None of them can see the one thing
 * decided here, in `TasksColumn`: WHICH set is handed down. The prop is
 * required, so the compiler proves that something is passed — it cannot
 * prove that the something is the user's stored preference rather than
 * `new Set()` or a hard-coded default, and that substitution is exactly
 * the shape this bug would take.
 *
 * Same harness as `TasksTreeSetPositions.test.tsx`: the real column, the
 * real tree pipeline, the real `useTasksUiState` reading real
 * localStorage — only the network hooks stubbed.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import type { IssueSummary } from '../../../api/issues';
import { LayoutProvider } from '../../../lib/useLayoutState';
import { TasksUiStateProvider } from '../../../lib/useTasksUiState';
import { TREE_DEFAULT_COLUMNS } from '../../../lib/treeColumns';
import { TasksColumn } from '../TasksColumn';

const TREE_KEY = 'skein.tasks.tree.demo.expanded';
/** The key `useTasksUiState` stores the tree's column set under. */
const COLUMNS_KEY = 'skein.tasks.treeColumns';

function issue(id: string): IssueSummary {
  return {
    id,
    projectId: 'proj-uuid-1',
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

const ITEMS = [issue('demo-1'), issue('demo-2')];

vi.mock('../../../lib/useTasks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/useTasks')>();
  return {
    ...actual,
    useTasks: () => ({
      data: ITEMS,
      total: ITEMS.length,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: () => {},
      isLoading: false,
      error: null,
      emptyReason: 'none',
      searchDegraded: false,
      searchMode: false,
      totalIsExact: true,
      resolvedProjectId: 'proj-uuid-1',
      delegateeAssignees: [],
      cacheKey: ['tasks', 'test'],
    }),
  };
});

vi.mock('../../../lib/useProjectsList', () => ({
  projectsListQueryKey: ['projects', 'list', 'shell'],
  useProjectsList: () => ({ data: { items: [] }, isLoading: false, isError: false }),
  useProjectsInfinite: () => ({
    items: [],
    total: 0,
    isLoading: false,
    isFetching: false,
    isFetchingNextPage: false,
    isError: false,
    hasNextPage: false,
    fetchNextPage: () => {},
  }),
}));

vi.mock('../../../lib/useProjectByHandle', () => ({
  useProjectByHandle: () => ({ project: null, isLoading: false, isError: false }),
}));

vi.mock('../../../lib/useReminders', () => ({
  useRingingIssueIds: () => new Set<string>(),
  useRingingTaskCount: () => 0,
}));

vi.mock('../../../api/components', () => ({ listComponents: async () => [] }));
vi.mock('../../../api/projects', () => ({ listMembers: async () => [] }));
// sk-285.5.5 — the directory endpoint is a SEARCH returning an envelope,
// not a bare list. Mocking the old array shape still went green here (the
// caller reads `.items`, which is undefined on an array, and falls back to
// []), but a mock that lies about the contract is a mock that stops
// catching the day the contract matters.
vi.mock('../../../api/users', () => ({
  listUserDirectory: async () => ({ items: [], hasMore: false }),
}));

vi.mock('../../../auth/AuthContext', () => ({
  // sk-551.8 — LayoutProvider reads the layout via useNavLayoutOptional;
  // null = no session known, the side-by-side layout.
  useAuthOptional: () => null,
  useAuth: () => ({ user: { id: 'u-1', username: 'admin' } }),
}));

function renderColumn() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MantineProvider forceColorScheme="dark">
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/projects/demo']}>
          <Routes>
            <Route
              path="/projects/:alias"
              element={
                <LayoutProvider>
                  <TasksUiStateProvider>
                    <TasksColumn
                      width={468}
                      collapsed={false}
                      outboxMode={false}
                      onMeMode={false}
                      budilnikMode={false}
                    />
                  </TasksUiStateProvider>
                </LayoutProvider>
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

/** The column each header cell carries, in DOM order. */
function headColumns(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('.task-tree-head-cell')).map(
    (el) =>
      [...el.classList]
        .find((c) => c.startsWith('task-tree-head-cell--'))
        ?.replace('task-tree-head-cell--', '') ?? '?',
  );
}

/** The column each cell of the first rendered row carries, in order. */
function firstRowColumns(container: HTMLElement): string[] {
  const rowEl = container.querySelector('.task-tree-node-row')!;
  return Array.from(rowEl.querySelectorAll('.task-tree-cell')).map(
    (el) =>
      [...el.classList]
        .find((c) => c.startsWith('task-tree-cell--'))
        ?.replace('task-tree-cell--', '') ?? '?',
  );
}

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem('skein.tasks.view', 'tree');
  window.localStorage.setItem(TREE_KEY, JSON.stringify([]));
});

afterEach(() => cleanup());

describe('sk-285.2.19 — the stored column set reaches the tree table', () => {
  test('with nothing stored the table draws the defaults', async () => {
    const { container } = renderColumn();
    await waitFor(() =>
      expect(container.querySelector('.task-tree-node-row')).not.toBeNull(),
    );
    expect(headColumns(container)).toEqual(['title', ...TREE_DEFAULT_COLUMNS]);
    expect(firstRowColumns(container)).toEqual(headColumns(container));
  });

  test('a stored set narrows the header AND the rows together', async () => {
    // Deliberately a set no default could be confused with: two of the
    // defaults dropped, and `created` — which is NOT on by default —
    // switched on. A column wired to `TREE_DEFAULT_COLUMNS` instead of to
    // the preference cannot produce this list.
    window.localStorage.setItem(COLUMNS_KEY, 'id,type,created');
    const { container } = renderColumn();
    await waitFor(() =>
      expect(container.querySelector('.task-tree-node-row')).not.toBeNull(),
    );
    expect(headColumns(container)).toEqual(['title', 'id', 'type', 'created']);
    expect(firstRowColumns(container)).toEqual(headColumns(container));
  });

  test('an empty stored set leaves the tree and nothing else', async () => {
    // A legal, distinguishable choice: the key EXISTS and is empty, which
    // is what tells the reader "no columns" apart from "no preference".
    window.localStorage.setItem(COLUMNS_KEY, '');
    const { container } = renderColumn();
    await waitFor(() =>
      expect(container.querySelector('.task-tree-node-row')).not.toBeNull(),
    );
    expect(headColumns(container)).toEqual(['title']);
    expect(firstRowColumns(container)).toEqual(['title']);
  });
});
