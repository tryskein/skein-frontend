/**
 * sk-285.2.19 (step 4) — the SECOND tree pipeline obeys the same sort.
 *
 * The Tasks tree is built two ways: from the flat issue list on the
 * client (`buildIssueTree`, which has always taken a comparator), and —
 * whenever a typed-deps lens is on, or the tree is anchored at an epic —
 * from the backend's layered endpoint, which returns a ready DFS row
 * list in ITS own order.
 *
 * A column heading that reorders one of those and not the other is a
 * control that silently stops working depending on a chip the user
 * toggled somewhere else. This file pins that the layered rows go
 * through the same comparator (`sortDfsBlocks`), at every level, with
 * the subtrees kept intact — `lib/__tests__/taskSort.test.ts` proves the
 * function does that, and this proves the column actually calls it.
 *
 * Harness: the real column with the layered hook stubbed, and the
 * dep-type lens seeded ON in localStorage — which is what selects this
 * pipeline over the client-side one.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import type { IssueSummary, IssueTreeNode } from '../../../api/issues';
import type { UseLayeredTreeArgs } from '../../../lib/useLayeredTree';
import { LayoutProvider } from '../../../lib/useLayoutState';
import { TasksUiStateProvider } from '../../../lib/useTasksUiState';
import { TasksColumn } from '../TasksColumn';

const TREE_KEY = 'skein.tasks.tree.demo.expanded';
const DEP_TYPES_KEY = 'skein.tasks.tree.demo.depTypes';
const SORT_KEY = 'skein.tasks.sort';

function issue(id: string, updatedAt: string): IssueSummary {
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
    updatedAt,
  };
}

function node(depth: number, id: string, updatedAt: string): IssueTreeNode {
  return {
    item: issue(id, updatedAt),
    depth,
    parentRef: depth === 0 ? null : { id: 'demo-1', edgeType: 'parent-child' },
    isReference: false,
    firstSeenAt: null,
  };
}

/**
 * What the backend sent, in ITS order — deliberately not the order any
 * sort key produces:
 *
 *   demo-1        updated Feb
 *     demo-1.1    updated Jan
 *     demo-1.3    updated Jun
 *     demo-1.2    updated Mar
 *   demo-2        updated Apr
 */
const LAYERED: IssueTreeNode[] = [
  node(0, 'demo-1', '2026-02-01T00:00:00Z'),
  node(1, 'demo-1.1', '2026-01-01T00:00:00Z'),
  node(1, 'demo-1.3', '2026-06-01T00:00:00Z'),
  node(1, 'demo-1.2', '2026-03-01T00:00:00Z'),
  node(0, 'demo-2', '2026-04-01T00:00:00Z'),
];

/**
 * sk-421.2.8 — matrix row 26: the arguments of each hook call by the column.
 * `vi.hoisted`, because the `vi.mock` factory is hoisted above the module
 * declarations and does not yet see an ordinary variable.
 */
const layeredCalls = vi.hoisted(() => [] as UseLayeredTreeArgs[]);

vi.mock('../../../lib/useLayeredTree', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../lib/useLayeredTree')>();
  return {
    ...actual,
    useLayeredTree: (args: UseLayeredTreeArgs) => {
      layeredCalls.push(args);
      return {
      tree: LAYERED,
      isLoading: false,
      error: null,
      tooLarge: false,
      // sk-421.2 T017 — the hook now also returns the request time of the answer.
      requestedAt: null,
      };
    },
  };
});

vi.mock('../../../lib/useTasks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/useTasks')>();
  return {
    ...actual,
    useTasks: () => ({
      // The layered pipeline renders from the hook above; this list only
      // has to be non-empty so the column gets past its empty state.
      data: LAYERED.map((n) => n.item),
      total: LAYERED.length,
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
  useProjectByHandle: () => ({
    project: { id: 'proj-uuid-1', alias: 'demo' },
    isLoading: false,
    isError: false,
  }),
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

function renderedIds(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>('.task-tree-node-row'),
  ).map(
    (r) => r.querySelector<HTMLElement>('.task-tree-cell--id')?.title ?? '?',
  );
}

function renderedLevels(container: HTMLElement): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of container.querySelectorAll<HTMLElement>('.task-tree-node-row')) {
    const id = r.querySelector<HTMLElement>('.task-tree-cell--id')?.title ?? '?';
    out[id] = r.getAttribute('aria-level') ?? '?';
  }
  return out;
}

beforeEach(() => {
  layeredCalls.length = 0;
  window.localStorage.clear();
  window.localStorage.setItem('skein.tasks.view', 'tree');
  window.localStorage.setItem(TREE_KEY, JSON.stringify(['demo-1']));
  // A second edge type ON is what routes the column through the layered
  // endpoint instead of the client-side `buildIssueTree`.
  window.localStorage.setItem(
    DEP_TYPES_KEY,
    JSON.stringify(['blocks', 'parent-child']),
  );
});

afterEach(() => cleanup());

describe('sk-421.2.8 — the tasks column does not request the blockers field (row 26)', () => {
  test('no useLayeredTree call from TasksColumn carries a true includeBlockers', async () => {
    // Q4, D-2, NF "the tasks column does not pay": the "include blockers" flag
    // is asked for only by the epic section.
    const { container } = renderColumn();
    await waitFor(() =>
      expect(container.querySelector('.task-tree-node-row')).not.toBeNull(),
    );
    // The tree rows came from the mocked hook — so the column
    // really went the layered way, and the check below is not empty.
    expect(layeredCalls.length).toBeGreaterThan(0);
    for (const call of layeredCalls) {
      expect(call.includeBlockers).not.toBe(true);
    }
  });
});

describe('sk-285.2.19 (step 4) — the layered tree sorts by the same key', () => {
  test('the backend’s DFS order is re-ordered inside each parent', async () => {
    window.localStorage.setItem(SORT_KEY, 'updated:desc');
    const { container } = renderColumn();
    await waitFor(() =>
      expect(container.querySelector('.task-tree-node-row')).not.toBeNull(),
    );
    expect(renderedIds(container)).toEqual([
      'demo-2',
      'demo-1',
      'demo-1.3',
      'demo-1.2',
      'demo-1.1',
    ]);
    // The subtrees travelled whole: nothing was re-parented on the way.
    expect(renderedLevels(container)).toEqual({
      'demo-1': '1',
      'demo-1.1': '2',
      'demo-1.2': '2',
      'demo-1.3': '2',
      'demo-2': '1',
    });
  });

  test('and the direction applies here too', async () => {
    window.localStorage.setItem(SORT_KEY, 'updated:asc');
    const { container } = renderColumn();
    await waitFor(() =>
      expect(container.querySelector('.task-tree-node-row')).not.toBeNull(),
    );
    expect(renderedIds(container)).toEqual([
      'demo-1',
      'demo-1.1',
      'demo-1.2',
      'demo-1.3',
      'demo-2',
    ]);
  });
});
