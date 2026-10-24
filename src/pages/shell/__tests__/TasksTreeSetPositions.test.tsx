/**
 * sk-285.2.13 — `aria-setsize` / `aria-posinset` through the REAL column.
 *
 * `lib/__tests__/treeRowPositions.test.ts` pins the arithmetic over a row
 * list, and `TaskTreeVirtualList*.test.tsx` pins that the numbers reach
 * the rendered rows. Neither can see the two things that are only
 * decided here, in TasksColumn:
 *
 *   1. WHICH list is numbered. The column holds two: `flatRows` (the
 *      whole tree) and `visibleRows` (what survived collapse). Only the
 *      second is on screen, so only the second may be counted — and both
 *      are `FlatTreeRow[]`, so nothing but a test catches the swap.
 *   2. WHETHER the list is finished. The rows are a page of a paginated
 *      query whose sentinel lives inside this very scroll container, so
 *      the column is the only place that knows another page is coming
 *      and the sets are therefore open-ended.
 *
 * Same harness as `TasksTreeFiltered.test.tsx`: the real column, real
 * tree pipeline, real expansion state, only the network hooks stubbed.
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

/** Flipped per test: whether the paginated query has another page. */
const pages = vi.hoisted(() => ({ hasNextPage: false }));

function issue(id: string, parentIdCurrent: string | null): IssueSummary {
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
    parentIdCurrent,
    componentIds: [],
    labels: [],
    isBlocked: false,
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
  };
}

/**
 * Three roots, one of which owns a single child. Small on purpose: the
 * numbers are then readable by hand, and the ONE hidden row is exactly
 * what separates "the visible list was numbered" from "the whole tree
 * was numbered".
 */
const ITEMS = [
  issue('demo-1', null),
  issue('demo-1.1', 'demo-1'),
  issue('demo-2', null),
  issue('demo-3', null),
];

vi.mock('../../../lib/useTasks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/useTasks')>();
  return {
    ...actual,
    useTasks: () => ({
      data: ITEMS,
      total: ITEMS.length,
      hasNextPage: pages.hasNextPage,
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

interface RowInfo {
  id: string;
  /** `aria-level`, 1-based. */
  level: string;
  /** "posinset/setsize", the pair as a reader would hear it. */
  set: string;
}

/** Every rendered tree row, in document order. */
function rows(container: HTMLElement): RowInfo[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>('.task-tree-node-row'),
  ).map((el) => ({
    id: (el.querySelector('.task-card-title-text')?.textContent ?? '').replace(
      'title ',
      '',
    ),
    level: el.getAttribute('aria-level') ?? '',
    set: `${el.getAttribute('aria-posinset')}/${el.getAttribute('aria-setsize')}`,
  }));
}

function chevronOf(container: HTMLElement, id: string): HTMLButtonElement {
  const el = Array.from(
    container.querySelectorAll<HTMLElement>('.task-tree-node-row'),
  ).find(
    (r) => r.querySelector('.task-card-title-text')?.textContent === `title ${id}`,
  )!;
  return el.querySelector('.task-tree-toggle') as HTMLButtonElement;
}

beforeEach(() => {
  window.localStorage.clear();
  // Tree view, nothing expanded by hand — so `demo-1.1` starts hidden
  // under its collapsed parent.
  window.localStorage.setItem('skein.tasks.view', 'tree');
  window.localStorage.setItem(TREE_KEY, JSON.stringify([]));
  pages.hasNextPage = false;
});

afterEach(() => cleanup());

describe('Tasks tree — the set a row reports is the set on screen', () => {
  test('a row under a collapsed parent is not counted, and expanding it renumbers nothing', async () => {
    const user = userEvent.setup();
    const { container } = renderColumn();
    await waitFor(() => expect(rows(container).length).toBeGreaterThan(0));

    // Collapsed: three rows, one set of three. The hidden child is
    // counted nowhere — a count over the WHOLE tree would put a fourth
    // row on screen and a "1 of 1" no reader could reach.
    const collapsed = rows(container);
    expect(collapsed.map((r) => r.id)).toEqual(['demo-1', 'demo-2', 'demo-3']);
    expect(collapsed.map((r) => r.level)).toEqual(['1', '1', '1']);
    expect(collapsed.map((r) => r.set)).toEqual(['1/3', '2/3', '3/3']);

    await user.click(chevronOf(container, 'demo-1'));
    await waitFor(() => expect(rows(container).length).toBe(4));

    // The child joins the list as a set of its own, one level down. Its
    // parent is still 1 of 3 and its uncles are still 2 and 3 of 3:
    // opening a branch adds a set, it does not resize the one above.
    const expanded = rows(container);
    expect(expanded.map((r) => r.id)).toEqual([
      'demo-1',
      'demo-1.1',
      'demo-2',
      'demo-3',
    ]);
    expect(expanded.map((r) => r.level)).toEqual(['1', '2', '1', '1']);
    expect(expanded.map((r) => r.set)).toEqual(['1/3', '1/1', '2/3', '3/3']);
  });

  test('with another page still to come, no row claims to know its set size', async () => {
    // The sentinel is rendered under this condition, so the observer has
    // to exist — jsdom has none. A no-op stands in: the test is about
    // what the rows SAY while a page is outstanding, not about fetching.
    const observed: Element[] = [];
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe(el: Element) {
          observed.push(el);
        }
        disconnect() {}
        unobserve() {}
      },
    );
    pages.hasNextPage = true;

    try {
      const { container } = renderColumn();
      await waitFor(() => expect(rows(container).length).toBe(3));

      // Scrolling to the bottom will append rows to this very list, so
      // "1 of 3" would be a number the reader is about to be lied to
      // with. `-1` is ARIA's "size unknown"; the place in the set is
      // still real and still announced.
      expect(rows(container).map((r) => r.set)).toEqual([
        '1/-1',
        '2/-1',
        '3/-1',
      ]);
      // Precondition: the page really is unfinished — the sentinel that
      // will grow the list is mounted and being watched.
      expect(observed.length).toBeGreaterThan(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
