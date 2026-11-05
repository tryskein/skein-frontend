/**
 * sk-763 — the Tasks column tree keeps the reader's row in place when its
 * data is refreshed in the background, and only then.
 *
 * The reference is the acceptance of sk-763: with the project, filters and
 * sort unchanged, a background refresh does not move the reading position —
 * rows that appear above the row being read do not slide it away. A switch
 * of conditions is not such a refresh, even when the rows of the new
 * conditions are already in the cache and arrive without a loading state:
 * the reading anchor must not drag the old row's position into another
 * list.
 *
 * The real `TasksColumn` renders the client-built parent-child tree; the
 * list behind it (`useTasks`) is replaced by a literal answer whose rows and
 * cache key the test sets, the way a warm `QueryClient` cache would hand
 * them over. jsdom has no scrolling: the column body is made to behave like
 * a scroll container below, as in `TaskTreeVirtualList.test.tsx`.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import type { IssueSummary } from '../../../api/issues';
import { LayoutProvider } from '../../../lib/useLayoutState';
import { TasksUiStateProvider } from '../../../lib/useTasksUiState';
import { TREE_ROW_HEIGHT_PX } from '../../../lib/treeColumnLayout';

const PROJECT_ID = 'proj-uuid-1';
const DEP_TYPES_KEY = 'skein.tasks.tree.demo.depTypes';
const VIEWPORT_PX = 800;

function issue(id: string, n: number): IssueSummary {
  // Newest first by every server and client order the column may use.
  const ts = new Date(Date.UTC(2026, 5, 1) + n * 60_000).toISOString();
  return {
    id,
    projectId: PROJECT_ID,
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
    createdAt: ts,
    updatedAt: ts,
  };
}

/** demo-1 is the newest; demo-500 the oldest. */
const BASE: IssueSummary[] = Array.from({ length: 500 }, (_, i) => issue(`demo-${i + 1}`, 1000 - i));
const newer = (k: number): IssueSummary[] =>
  Array.from({ length: k }, (_, i) => issue(`demo-new-${i + 1}`, 2000 - i));

/** What the list behind the tree answers right now. */
const list: { data: IssueSummary[]; cacheKey: readonly unknown[] } = {
  data: BASE,
  cacheKey: ['tasks', 'project', PROJECT_ID, 'status=all'],
};

vi.mock('../../../lib/useTasks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/useTasks')>();
  return {
    ...actual,
    useTasks: () => ({
      data: list.data,
      total: list.data.length,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: () => {},
      isLoading: false,
      error: null,
      emptyReason: null,
      searchDegraded: false,
      searchMode: false,
      totalIsExact: true,
      resolvedProjectId: PROJECT_ID,
      delegateeAssignees: [],
      loadedAssignees: [],
      cacheKey: list.cacheKey,
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
    project: { id: PROJECT_ID, alias: 'demo' },
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
vi.mock('../../../api/users', () => ({
  listUserDirectory: async () => ({ items: [], hasMore: false }),
}));

vi.mock('../../../auth/AuthContext', () => ({
  useAuthOptional: () => null,
  useAuth: () => ({ user: { id: 'u-1', username: 'admin', role: 'user' } }),
}));

import { TasksColumn } from '../TasksColumn';

function column(qc: QueryClient) {
  return (
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
    </MantineProvider>
  );
}

/** Make the tree's scroll container scroll; returns a reader of its offset. */
function emulateScrolling(container: HTMLElement): { offset: () => number; scrollTo: (top: number) => void } {
  const body = container.querySelector<HTMLElement>('.col-body')!;
  const canvas = () => container.querySelector<HTMLElement>('.task-tree-virtual-canvas');
  let offset = 0;
  Object.defineProperty(body, 'scrollTop', {
    configurable: true,
    get: () => offset,
    set: (v: number) => { offset = v; },
  });
  Object.defineProperty(body, 'clientHeight', { configurable: true, get: () => VIEWPORT_PX });
  Object.defineProperty(body, 'scrollHeight', {
    configurable: true,
    get: () => Number.parseFloat(canvas()?.style.height ?? '0'),
  });
  body.scrollTo = ((options?: ScrollToOptions) => {
    const top = options?.top ?? 0;
    if (top === offset) return;
    offset = top;
    body.dispatchEvent(new Event('scroll'));
  }) as HTMLElement['scrollTo'];
  return {
    offset: () => offset,
    scrollTo: (top) => act(() => { body.scrollTo({ top }); }),
  };
}

function renderedTitles(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('.task-card-title-text')).map((el) => el.textContent ?? '');
}

/** The reader is at demo-301 (row index 300), 10 px into it. */
const READING_AT = 300 * TREE_ROW_HEIGHT_PX + 10;

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem('skein.tasks.view', 'tree');
  // Only parent-child edges: the column builds the tree from the list itself.
  window.localStorage.setItem(DEP_TYPES_KEY, JSON.stringify(['parent-child']));
  list.data = BASE;
  list.cacheKey = ['tasks', 'project', PROJECT_ID, 'status=all'];
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('sk-763 — the reading anchor of the Tasks column tree', () => {
  test('a background refresh of the same list puts new rows above: the row being read stays in place', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(column(qc));
    const scroll = emulateScrolling(view.container);
    scroll.scrollTo(READING_AT);
    expect(renderedTitles(view.container)).toContain('title demo-301');

    list.data = [...newer(3), ...BASE];
    act(() => { view.rerender(column(qc)); });

    expect(scroll.offset()).toBe(READING_AT + 3 * TREE_ROW_HEIGHT_PX);
    expect(renderedTitles(view.container)).toContain('title demo-301');
  });

  test('a switch of conditions answered from the cache at once is another list: the offset is not anchored to the old row', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(column(qc));
    const scroll = emulateScrolling(view.container);
    scroll.scrollTo(READING_AT);

    // Another filter whose answer is already cached: no loading state, and
    // the old rows are in it shifted by three — the shape an anchor would
    // follow if it did not know the conditions changed.
    list.cacheKey = ['tasks', 'project', PROJECT_ID, 'status=open'];
    list.data = [...newer(3), ...BASE];
    act(() => { view.rerender(column(qc)); });

    expect(scroll.offset()).toBe(READING_AT);
  });
});
