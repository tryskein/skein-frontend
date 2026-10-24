/**
 * sk-285.2.19 (step 4) — the stored sort preference reaches the tree
 * TABLE, and a click on a heading reaches the storage.
 *
 * `lib/__tests__/taskSort.test.ts` pins the model and
 * `TaskTreeSortHeader.test.tsx` pins what the header strip renders and
 * reports. Neither can see the two things decided here, in the real
 * column:
 *
 *   1. that the preference the table sorts by is the PERSISTED one —
 *      `skein.tasks.sort`, the same key the «Sort by» combobox has
 *      always written, read on mount. A reload is exactly that: a fresh
 *      mount reading storage, which is how this file tests one;
 *   2. that decision A survives the whole pipeline — the rows arrive
 *      sorted INSIDE each parent, with the hierarchy intact, whichever
 *      direction is stored.
 *
 * Same harness as `TasksTreeColumns.test.tsx`: the real column, the real
 * tree pipeline, the real `useTasksUiState` over real localStorage, only
 * the network hooks stubbed.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import type { IssueSummary } from '../../../api/issues';
import { LayoutProvider } from '../../../lib/useLayoutState';
import { TasksUiStateProvider } from '../../../lib/useTasksUiState';
import { TasksColumn } from '../TasksColumn';

const TREE_KEY = 'skein.tasks.tree.demo.expanded';
/** The ONE key the column's order has ever been stored under. */
const SORT_KEY = 'skein.tasks.sort';

function issue(
  id: string,
  parentId: string | null,
  updatedAt: string,
  priority = 2,
): IssueSummary {
  return {
    id,
    projectId: 'proj-uuid-1',
    version: 1,
    title: `title ${id}`,
    type: 'task',
    priority,
    status: 'open',
    pinned: false,
    assignee: null,
    parentIdCurrent: parentId,
    componentIds: [],
    labels: [],
    isBlocked: false,
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt,
  };
}

/**
 * Two roots, one of them with three children, and the timestamps chosen
 * so the LOCAL order is visibly not a global one: `demo-1.3` (the June
 * child) is the most recently updated issue in the whole set, and no
 * direction of any key floats it above `demo-2`.
 *
 *   demo-1    root, updated Feb
 *     demo-1.2      updated Mar
 *     demo-1.3      updated Jun   ← newest of everything
 *     demo-1.1      updated Jan
 *   demo-2    root, updated Apr
 */
const ITEMS = [
  issue('demo-1', null, '2026-02-01T00:00:00Z'),
  issue('demo-1.2', 'demo-1', '2026-03-01T00:00:00Z'),
  issue('demo-1.3', 'demo-1', '2026-06-01T00:00:00Z'),
  issue('demo-1.1', 'demo-1', '2026-01-01T00:00:00Z'),
  issue('demo-2', null, '2026-04-01T00:00:00Z'),
];

vi.mock('../../../lib/useTasks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/useTasks')>();
  return {
    ...actual,
    // `sortDir` is deliberately NOT in this signature: the column's one
    // shared query takes the sort KEY only (step 5 — the direction is the
    // tree table's alone), and a mock that accepted one would let the
    // real call site start passing it again unnoticed.
    useTasks: (args: { sort: string }) => ({
      // The hook's own client sort is exercised by its own tests; here
      // the fixture is handed over in a FIXED order so that any ordering
      // the table shows is the tree pipeline's doing and not a
      // pre-sorted list arriving in the right shape by luck.
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
      cacheKey: ['tasks', 'test', args.sort],
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

/** The issue id of every rendered row, top to bottom. */
function renderedIds(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>('.task-tree-node-row'),
  ).map(
    (r) => r.querySelector<HTMLElement>('.task-tree-cell--id')?.title ?? '?',
  );
}

/** id → depth, from what each row announces to a screen reader. */
function renderedLevels(container: HTMLElement): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of container.querySelectorAll<HTMLElement>('.task-tree-node-row')) {
    const id = r.querySelector<HTMLElement>('.task-tree-cell--id')?.title ?? '?';
    out[id] = r.getAttribute('aria-level') ?? '?';
  }
  return out;
}

/**
 * Storage key for the tree's column set.
 *
 * sk-285.2.22 narrowed `TREE_DEFAULT_COLUMNS` to a set that FITS the
 * Tasks column, and `updated` is not in it any more — so the two tests
 * that click the «Updated» heading have to switch that column on first.
 * They are about a heading CLICK, not about which columns are on by
 * default; writing the preference here says so, and keeps them from
 * silently re-passing if the default set ever drifts back.
 */
const COLUMNS_KEY = 'skein.tasks.treeColumns';

/** The «Updated» heading's button. */
function updatedHeading(container: HTMLElement): HTMLElement {
  const button = container.querySelector<HTMLElement>(
    '.task-tree-head-cell--updated button',
  );
  if (!button) throw new Error('the Updated heading is not a sort control');
  return button;
}

async function waitForRows(container: HTMLElement) {
  await waitFor(() =>
    expect(container.querySelector('.task-tree-node-row')).not.toBeNull(),
  );
}

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem('skein.tasks.view', 'tree');
  // The branch is open, so its children are on screen to be ordered.
  window.localStorage.setItem(TREE_KEY, JSON.stringify(['demo-1']));
});

afterEach(() => cleanup());

describe('sk-285.2.19 (step 4) — the stored order reaches the table', () => {
  test('«updated» descending orders each parent’s children, newest first', async () => {
    window.localStorage.setItem(SORT_KEY, 'updated:desc');
    const { container } = renderColumn();
    await waitForRows(container);
    expect(renderedIds(container)).toEqual([
      // Roots by their own recency: demo-2 (Apr) before demo-1 (Feb)…
      'demo-2',
      'demo-1',
      // …and demo-1's children among themselves.
      'demo-1.3',
      'demo-1.2',
      'demo-1.1',
    ]);
  });

  test('the other direction reverses every level, and only that', async () => {
    window.localStorage.setItem(SORT_KEY, 'updated:asc');
    const { container } = renderColumn();
    await waitForRows(container);
    expect(renderedIds(container)).toEqual([
      'demo-1',
      'demo-1.1',
      'demo-1.2',
      'demo-1.3',
      'demo-2',
    ]);
    // The tree did not flatten: the children are still one level under
    // the root they belong to, in both directions.
    expect(renderedLevels(container)).toEqual({
      'demo-1': '1',
      'demo-1.1': '2',
      'demo-1.2': '2',
      'demo-1.3': '2',
      'demo-2': '1',
    });
  });

  test('the newest task of the project is NOT on top — the order is branch-local', async () => {
    // The cost of decision A, asserted on the real column. demo-1.3 is
    // the most recently updated issue in the set; sorted by «updated» it
    // stays inside demo-1, below demo-2. This is what the table's
    // caption tells the reader — and the caption is only honest while
    // this holds.
    window.localStorage.setItem(SORT_KEY, 'updated:desc');
    const { container } = renderColumn();
    await waitForRows(container);
    const rows = renderedIds(container);
    const newest = [...ITEMS].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    )[0];
    expect(newest.id).toBe('demo-1.3');
    expect(rows[0]).not.toBe('demo-1.3');
    expect(rows.indexOf('demo-1.3')).toBeGreaterThan(rows.indexOf('demo-1'));
  });

  test('a value written by a build without directions still loads', async () => {
    // A bare key is what `skein.tasks.sort` held before step 4; it means
    // that key at its natural direction (newest first).
    window.localStorage.setItem(SORT_KEY, 'updated');
    const { container } = renderColumn();
    await waitForRows(container);
    expect(renderedIds(container)).toEqual([
      'demo-2',
      'demo-1',
      'demo-1.3',
      'demo-1.2',
      'demo-1.1',
    ]);
  });
});

describe('sk-285.2.19 (step 4) — a heading click is a durable preference', () => {
  test('clicking the sorted heading reverses the table AND the stored value', async () => {
    window.localStorage.setItem(SORT_KEY, 'updated:desc');
    window.localStorage.setItem(COLUMNS_KEY, 'id,updated');
    const { container } = renderColumn();
    await waitForRows(container);
    await userEvent.click(updatedHeading(container));

    await waitFor(() =>
      expect(renderedIds(container)).toEqual([
        'demo-1',
        'demo-1.1',
        'demo-1.2',
        'demo-1.3',
        'demo-2',
      ]),
    );
    // Written through to the ONE key the order lives under — no second
    // key holding a direction beside it.
    expect(window.localStorage.getItem(SORT_KEY)).toBe('updated:asc');
  });

  test('and the reversal survives a reload', async () => {
    window.localStorage.setItem(SORT_KEY, 'updated:desc');
    window.localStorage.setItem(COLUMNS_KEY, 'id,updated');
    const first = renderColumn();
    await waitForRows(first.container);
    await userEvent.click(updatedHeading(first.container));
    await waitFor(() =>
      expect(window.localStorage.getItem(SORT_KEY)).toBe('updated:asc'),
    );

    // A reload is a fresh mount reading storage — nothing of the old
    // tree survives it but that value.
    cleanup();
    const second = renderColumn();
    await waitForRows(second.container);
    expect(renderedIds(second.container)).toEqual([
      'demo-1',
      'demo-1.1',
      'demo-1.2',
      'demo-1.3',
      'demo-2',
    ]);
  });

  test('clicking another heading switches key at its natural direction', async () => {
    window.localStorage.setItem(SORT_KEY, 'updated:asc');
    const { container } = renderColumn();
    await waitForRows(container);
    const idHeading = container.querySelector<HTMLElement>(
      '.task-tree-head-cell--id button',
    )!;
    await userEvent.click(idHeading);
    // «ID» opens ascending — the direction «Updated» was reversed into
    // does not carry over to a different key.
    await waitFor(() =>
      expect(window.localStorage.getItem(SORT_KEY)).toBe('id:asc'),
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
