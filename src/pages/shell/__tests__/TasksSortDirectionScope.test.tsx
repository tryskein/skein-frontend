/**
 * sk-285.2.19 (step 5) — the sort DIRECTION belongs to the tree table,
 * and to nothing else.
 *
 * The key is shared: «Sort by» and the table's headings name the same
 * field, and every body of the column is ordered by it. The DIRECTION is
 * not. It has exactly one control — a second click on the heading of the
 * column already sorted — and that control lives in the tree table. A
 * reader who reverses «Updated» there has said something about the
 * table; they have not asked for the Cards list to turn upside down, nor
 * for the order inside every Kanban column to invert (a board that shows
 * no direction indicator at all, so the change would arrive unexplained
 * and unexplainable).
 *
 * That is what this file pins, and it pins it where the leak would
 * happen: the ONE `useTasks` call the whole column shares. Feeding
 * `sortDir` into it re-orders `data`, and `data` is what the Cards list
 * maps over AND what `KanbanBoard` distributes into columns — so the
 * regression is a one-line prop away and invisible to every test that
 * only looks at the tree.
 *
 * Real column, real `useTasks`, real `useTasksUiState` over real
 * localStorage; only the network is stubbed. The fixture is handed to
 * the stub in a scrambled order so nothing here can pass on a list that
 * arrived sorted by luck.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import type {
  IssueSummary,
  ListIssuesParams,
  ListIssuesResult,
} from '../../../api/issues';
import { LayoutProvider } from '../../../lib/useLayoutState';
import { TasksUiStateProvider } from '../../../lib/useTasksUiState';
import { TasksColumn } from '../TasksColumn';

/** The ONE key the column's order has ever been stored under. */
const SORT_KEY = 'skein.tasks.sort';
const VIEW_KEY = 'skein.tasks.view';

function issue(id: string, updatedAt: string): IssueSummary {
  return {
    id,
    projectId: 'proj-uuid-1',
    version: 1,
    title: id,
    type: 'task',
    priority: 2,
    status: 'open',
    pinned: false,
    assignee: null,
    parentIdCurrent: null,
    componentIds: [],
    labels: [],
    isBlocked: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt,
  };
}

/**
 * Three ROOTS — no hierarchy at all, so «within each branch» has nothing
 * to hide behind: whatever order a body shows is the order the sort gave
 * it, in every one of the three views.
 */
const ITEMS = [
  issue('demo-2', '2026-02-01T00:00:00Z'),
  issue('demo-3', '2026-03-01T00:00:00Z'),
  issue('demo-1', '2026-01-01T00:00:00Z'),
];

/** «updated» read the way its label has always meant it: newest first. */
const NATURAL = ['demo-3', 'demo-2', 'demo-1'];
/** The same key reversed — what the tree table shows at `updated:asc`. */
const REVERSED = ['demo-1', 'demo-2', 'demo-3'];

const listIssuesSpy = vi.fn<
  (projectId: string, params?: ListIssuesParams) => Promise<ListIssuesResult>
>(async () => ({
  items: ITEMS,
  total: ITEMS.length,
  hasMore: false,
  nextCursor: null,
}));

vi.mock('../../../api/issues', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/issues')>();
  return {
    ...actual,
    listIssues: (...args: [string, ListIssuesParams?]) => listIssuesSpy(...args),
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
  useProjectByHandle: (handle: string | null) =>
    handle === null
      ? { project: null, isLoading: false, isUnresolved: false }
      : {
          project: { id: 'proj-uuid-1', idPrefix: handle, name: handle },
          isLoading: false,
          isUnresolved: false,
        },
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

/** Titles are the ids, so every body can be read the same way. */
function texts(container: HTMLElement, selector: string): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>(selector)).map(
    (el) => el.getAttribute('title') ?? '?',
  );
}

const cardIds = (c: HTMLElement) => texts(c, '.task-card-title-block');
const kanbanIds = (c: HTMLElement) => texts(c, '.kanban-card-title');
const treeIds = (c: HTMLElement) => texts(c, '.task-tree-cell--id');

async function waitForCount(read: () => string[], n: number) {
  await waitFor(() => expect(read()).toHaveLength(n));
}

beforeEach(() => {
  window.localStorage.clear();
  listIssuesSpy.mockClear();
});

afterEach(() => cleanup());

describe('sk-285.2.19 — a heading click does not reach the Cards list', () => {
  test('Cards show the key’s natural order — at both stored directions', async () => {
    window.localStorage.setItem(VIEW_KEY, 'cards');
    window.localStorage.setItem(SORT_KEY, 'updated:desc');
    const first = renderColumn();
    await waitForCount(() => cardIds(first.container), ITEMS.length);
    expect(cardIds(first.container)).toEqual(NATURAL);
    cleanup();

    // The reader reversed the tree table's «Updated» column. The Cards
    // list is not a view of that table and does not follow it.
    window.localStorage.setItem(SORT_KEY, 'updated:asc');
    const second = renderColumn();
    await waitForCount(() => cardIds(second.container), ITEMS.length);
    expect(cardIds(second.container)).toEqual(NATURAL);
  });

  test('the Kanban columns keep the natural order too', async () => {
    window.localStorage.setItem(VIEW_KEY, 'kanban');
    window.localStorage.setItem(SORT_KEY, 'updated:desc');
    const first = renderColumn();
    await waitForCount(() => kanbanIds(first.container), ITEMS.length);
    expect(kanbanIds(first.container)).toEqual(NATURAL);
    cleanup();

    // The board prints no direction indicator anywhere: an inverted
    // column here would be a change the reader cannot see the cause of.
    window.localStorage.setItem(SORT_KEY, 'updated:asc');
    const second = renderColumn();
    await waitForCount(() => kanbanIds(second.container), ITEMS.length);
    expect(kanbanIds(second.container)).toEqual(NATURAL);
  });

  test('and the tree table — the one surface that owns it — does reverse', async () => {
    // The other half of the same statement: the direction is not gone,
    // it is scoped. Without this, deleting the feature outright would
    // satisfy the two tests above.
    window.localStorage.setItem(VIEW_KEY, 'tree');
    window.localStorage.setItem(SORT_KEY, 'updated:desc');
    const first = renderColumn();
    await waitForCount(() => treeIds(first.container), ITEMS.length);
    expect(treeIds(first.container)).toEqual(NATURAL);
    cleanup();

    window.localStorage.setItem(SORT_KEY, 'updated:asc');
    const second = renderColumn();
    await waitForCount(() => treeIds(second.container), ITEMS.length);
    expect(treeIds(second.container)).toEqual(REVERSED);
  });
});
