/**
 * sk-439 — the Tasks column opens a row through the same
 * `layout.setSelectedIssue` the epic section uses, with the row's OWN
 * project handle (`TasksColumn.tsx#handleSelect`). A row from ANOTHER
 * project on a component-filtered board (pasted codes in blob mode are
 * the real case) used to open at `/projects/B/components/<A's
 * component>/issues/<id>`. The rule lives on
 * `useLayoutState.tsx#setSelectedIssue`: the component rides along only
 * into the current project; the query string is carried as before.
 *
 * Harness: the REAL column under a REAL router and `LayoutProvider`, as
 * in `TasksColumnCollapse.test.tsx`; only the network hooks are mocked.
 * The assertion is the address the click produced.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

import type { IssueSummary } from '../../../api/issues';
import { LayoutProvider, useLayoutState } from '../../../lib/useLayoutState';
import { TasksUiStateProvider } from '../../../lib/useTasksUiState';
import { TasksColumn } from '../TasksColumn';

const UUID_A = '0198aaaa-0000-7000-8000-00000000000a';
const UUID_B = '0198bbbb-0000-7000-8000-00000000000b';

function issue(id: string, projectId: string): IssueSummary {
  return {
    id,
    projectId,
    version: 1,
    title: `title ${id}`,
    type: 'task',
    priority: 2,
    status: 'open',
    pinned: false,
    assignee: null,
    componentIds: [],
    labels: [],
    isBlocked: false,
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
  };
}

/** One row of the current project A, one row of project B. */
const ITEMS = [issue('a-1', UUID_A), issue('b-1', UUID_B)];

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
      resolvedProjectId: UUID_A,
      delegateeAssignees: [],
      cacheKey: ['tasks', 'test'],
    }),
  };
});

// The column resolves a row's handle through this list (`projectHandles`).
vi.mock('../../../lib/useProjectsList', () => ({
  projectsListQueryKey: ['projects', 'list', 'shell'],
  useProjectsList: () => ({
    data: {
      items: [
        { id: UUID_A, idPrefix: 'proj-a', name: 'A' },
        { id: UUID_B, idPrefix: 'proj-b', name: 'B' },
      ],
    },
    isLoading: false,
    isError: false,
  }),
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
  // sk-285.7.2.49 — the Budilnik-lens body reads the LIST, and the lens
  // is the fourth render site of the collapse control. Mocking only the
  // two counters left the lens unrenderable, which is how that site
  // stayed unmeasured in the first place.
  useRemindersList: () => ({
    reminders: [],
    ringingTaskCount: 0,
    isLoading: false,
    error: null,
  }),
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

function Probe() {
  const location = useLocation();
  return (
    <>
      <div data-testid="path">{location.pathname}</div>
      <div data-testid="search">{location.search}</div>
    </>
  );
}

function ColumnHost() {
  const { tasksCollapsed } = useLayoutState();
  return (
    <>
      <TasksColumn
        width={468}
        collapsed={tasksCollapsed}
        outboxMode={false}
        onMeMode={false}
        budilnikMode={false}
      />
      <Probe />
    </>
  );
}

function renderAt(entry: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const element = (
    <LayoutProvider>
      <TasksUiStateProvider>
        <ColumnHost />
      </TasksUiStateProvider>
    </LayoutProvider>
  );
  return render(
    <MantineProvider forceColorScheme="dark">
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route path="/projects/:alias/components/:cid" element={element} />
            <Route path="/projects/:alias/components/:cid/issues/:id" element={element} />
            <Route path="/projects/:alias/issues/:id" element={element} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

const address = () => ({
  path: screen.getByTestId('path').textContent,
  search: screen.getByTestId('search').textContent,
});

const QUERY = '?q=needle';

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => cleanup());

describe('sk-439 — tasks column: a row of another project on a board with a component filter', () => {
  test('a project B row → an address without project A component, the query string is kept', async () => {
    const user = userEvent.setup();
    renderAt(`/projects/proj-a/components/cmp-a-1${QUERY}`);
    await user.click(screen.getByRole('button', { name: 'Open issue b-1: title b-1' }));
    expect(address()).toEqual({ path: '/projects/proj-b/issues/b-1', search: QUERY });
  });

  test('a row of its own project → the component and the query string are kept', async () => {
    const user = userEvent.setup();
    renderAt(`/projects/proj-a/components/cmp-a-1${QUERY}`);
    await user.click(screen.getByRole('button', { name: 'Open issue a-1: title a-1' }));
    expect(address()).toEqual({
      path: '/projects/proj-a/components/cmp-a-1/issues/a-1',
      search: QUERY,
    });
  });
});
