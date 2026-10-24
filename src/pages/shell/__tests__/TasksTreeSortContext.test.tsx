/**
 * sk-285.2.19 (step 5) — a CONTEXT row sorts by the MATCHES it is
 * holding up, and stays marked as context.
 *
 * sk-285.2.7 / sk-285.2.8 backfill the parents a filtered page did not
 * return, so a match keeps its place in the hierarchy under a parent
 * that is scaffolding rather than a result (`isContext` → announced as
 * context, no chevron). Step 4 gave that tree an order, and the two
 * features meet in one question this file answers:
 *
 *   what is a backfilled parent WORTH, in a list ordered by a key it
 *   never matched on?
 *
 * Step 4 answered "its own field value, ranked among its siblings", and
 * that answer let a row which is not a result take the top of a list of
 * results — the parent had been touched most recently, so «updated» put
 * a non-match first and pushed every actual match below it. Step 5
 * answers: a branch is worth what its best match is worth. The context
 * row is ranked by the best-ranked row inside its subtree and carries
 * the subtree there.
 *
 * The fixture makes the two answers loudly different: the context parent
 * is the MOST recently updated row on the page while the match under it
 * is the LEAST. By its own value it leads; by its match it trails. It is
 * still not pinned — the other direction moves it — and it is still
 * marked as context, both asserted here.
 *
 * Harness copied from `TasksTreeFiltered.test.tsx` — the real column,
 * the real backfill, only the network stubbed.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import type { IssueSummary } from '../../../api/issues';
import { LayoutProvider } from '../../../lib/useLayoutState';
import { TasksUiStateProvider } from '../../../lib/useTasksUiState';
import { TasksColumn } from '../TasksColumn';

const TREE_KEY = 'skein.tasks.tree.demo.expanded';
const SORT_KEY = 'skein.tasks.sort';

function issue(
  id: string,
  parentIdCurrent: string | null,
  updatedAt: string,
): IssueSummary {
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
    updatedAt,
  };
}

/**
 * What the filtered query returned — MATCHES only. `demo-1.1` hangs off
 * `demo-1`, which did not match and is therefore absent. It is also the
 * OLDEST row on the page, which is what puts its branch last under
 * «updated» descending — unless the scaffolding above it is allowed to
 * rank in its place.
 */
const MATCHES = [
  issue('demo-2', null, '2026-02-01T00:00:00Z'),
  issue('demo-1.1', 'demo-1', '2026-01-01T00:00:00Z'),
];

/**
 * The parent only the backfill can supply — and the most recently
 * updated row of the lot. Ranked by ITSELF it would lead every «updated»
 * descending list; ranked by the match it holds up (January) it trails
 * `demo-2` (February). The gap between those two outcomes is the whole
 * subject of this file.
 */
const MISSING_PARENT = issue('demo-1', null, '2026-09-01T00:00:00Z');

const findIssueSummaryById = vi.fn(async (id: string) =>
  id === 'demo-1' ? MISSING_PARENT : null,
);

vi.mock('../../../api/issues', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/issues')>();
  return {
    ...actual,
    findIssueSummaryById: (id: string) => findIssueSummaryById(id),
  };
});

vi.mock('../../../lib/useTasks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/useTasks')>();
  return {
    ...actual,
    useTasks: () => ({
      data: MATCHES,
      total: MATCHES.length,
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
                      // The narrowing that makes the page a set of
                      // matches — the same lens `TasksTreeFiltered` uses.
                      outboxMode
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

/** Rows top to bottom, as `id` plus whether the row is scaffolding. */
function rows(container: HTMLElement): Array<{ id: string; context: boolean }> {
  return Array.from(
    container.querySelectorAll<HTMLElement>('.task-tree-node-row'),
  ).map((r) => ({
    id: r.querySelector<HTMLElement>('.task-tree-cell--id')?.title ?? '?',
    context: /parent shown for context/.test(r.getAttribute('aria-label') ?? ''),
  }));
}

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem('skein.tasks.view', 'tree');
  window.localStorage.setItem(TREE_KEY, JSON.stringify([]));
  findIssueSummaryById.mockClear();
});

afterEach(() => cleanup());

describe('sk-285.2.19 (step 5) — context rows rank by their matches', () => {
  test('a backfilled parent takes its subtree’s place — and stays context', async () => {
    window.localStorage.setItem(SORT_KEY, 'updated:desc');
    const { container } = renderColumn();
    await waitFor(() =>
      expect(rows(container).some((r) => r.id === 'demo-1')).toBe(true),
    );
    expect(rows(container)).toEqual([
      // demo-2 matched, and matched more recently (Feb) than the only
      // match in the other branch (Jan) — so its branch leads…
      { id: 'demo-2', context: false },
      // …and the scaffolding follows at the rank of the match it holds
      // up, NOT at its own September timestamp.
      { id: 'demo-1', context: true },
      { id: 'demo-1.1', context: false },
    ]);
  });

  test('the newest row on the page is a non-match, and it does not lead', async () => {
    // Said as a fact about the fixture rather than about the order, so
    // this reads as the rule and not as a restatement of the array
    // above: the row a naive «sort everything by updatedAt» would put
    // first is precisely the one that must not be first.
    window.localStorage.setItem(SORT_KEY, 'updated:desc');
    const { container } = renderColumn();
    await waitFor(() =>
      expect(rows(container).some((r) => r.id === 'demo-1')).toBe(true),
    );
    const newest = [...MATCHES, MISSING_PARENT].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    )[0];
    expect(newest.id).toBe('demo-1');
    expect(rows(container)[0].id).not.toBe('demo-1');
  });

  test('and the other direction moves it, which a pinned row would not do', async () => {
    // Ascending, the January match is the best of the page, so its
    // branch — scaffolding and all — leads. The context row is ranked,
    // not pinned: it changes places with the direction like any row.
    window.localStorage.setItem(SORT_KEY, 'updated:asc');
    const { container } = renderColumn();
    await waitFor(() =>
      expect(rows(container).some((r) => r.id === 'demo-1')).toBe(true),
    );
    expect(rows(container)).toEqual([
      { id: 'demo-1', context: true },
      { id: 'demo-1.1', context: false },
      { id: 'demo-2', context: false },
    ]);
  });
});
