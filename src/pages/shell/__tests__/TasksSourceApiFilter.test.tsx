/**
 * sk-878.3.1 — the exact «API» source in the Tasks column's origin filter.
 *
 * The spec makes the exact value `source=api` a filter of the UI, next to
 * the origin groups (the human-driven group includes `api` on the server).
 * The failure this pins is the quiet one: an «API» option that the reader
 * can pick but that reaches the wire only as a group — or not at all — so
 * the list never narrows to API writes.
 *
 * Real column, real `useTasks`, real `useTasksUiState`; only the network is
 * stubbed. The option is found by role and accessible name, the way the
 * reader meets it.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import {
  listAllIssues,
  listAssignedToMe,
  listCreatedByMe,
  type ListIssuesParams,
  type ListIssuesResult,
} from '../../../api/issues';
import { LayoutProvider } from '../../../lib/useLayoutState';
import { TasksUiStateProvider } from '../../../lib/useTasksUiState';
import { TasksColumn } from '../TasksColumn';

const listIssuesSpy = vi.fn<
  (projectId: string, params?: ListIssuesParams) => Promise<ListIssuesResult>
>(async () => ({ items: [], total: 0, hasMore: false, nextCursor: null }));

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
vi.mock('../../../api/users', () => ({
  listUserDirectory: async () => ({ items: [], hasMore: false }),
}));

vi.mock('../../../auth/AuthContext', () => ({
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

/** The params of the latest project-list read. */
function lastListParams(): ListIssuesParams | undefined {
  const calls = listIssuesSpy.mock.calls;
  return calls.length ? calls[calls.length - 1][1] : undefined;
}

beforeEach(() => {
  window.localStorage.clear();
  // The panel open and drawn as chip rows, so the Source row is a radiogroup.
  window.localStorage.setItem('skein.layout.task-filters-collapsed', 'false');
  window.localStorage.setItem('skein.tasks.filtersLayout', 'chips');
  listIssuesSpy.mockClear();
});

afterEach(() => cleanup());

describe('sk-878.3.1 — the exact API source in the Tasks origin filter', () => {
  test('picking API lists with source=api; the people group still goes as a group', async () => {
    renderColumn();
    await waitFor(() => expect(listIssuesSpy).toHaveBeenCalled());
    const source = screen.getByRole('radiogroup', { name: 'Source' });

    fireEvent.click(within(source).getByRole('radio', { name: 'API' }));
    await waitFor(() => expect(lastListParams()?.source).toBe('api'));
    expect(lastListParams()?.origin).toBeUndefined();

    fireEvent.click(within(source).getByRole('radio', { name: 'From a human' }));
    await waitFor(() => expect(lastListParams()?.origin).toBe('human-driven'));
    expect(lastListParams()?.source).toBeUndefined();
  });
});

// The column's cross-project and personal surfaces read other endpoints;
// the same choice must reach each of them as `source=api` (the lead's
// decision for this task: one behaviour on every surface of the column).
describe('sk-878.3.1 — the cross-project reads carry the exact source', () => {
  const fetchSpy = vi.fn<typeof fetch>();
  beforeEach(() => {
    fetchSpy.mockReset();
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ items: [], total: 0, hasMore: false, nextCursor: null }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchSpy);
  });
  afterEach(() => vi.unstubAllGlobals());

  test.each([
    ['/api/v1/issues', () => listAllIssues({ source: 'api' })],
    ['/api/v1/me/created-by', () => listCreatedByMe({ source: 'api' })],
    ['/api/v1/me/assigned-to', () => listAssignedToMe({ source: 'api' })],
  ])('%s gets source=api', async (path, call) => {
    await call();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetchSpy.mock.calls[0][0]), 'http://localhost');
    expect(url.pathname).toBe(path);
    expect(url.searchParams.get('source')).toBe('api');
    expect(url.searchParams.has('origin')).toBe(false);
  });
});
