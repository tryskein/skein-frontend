/**
 * sk-878.3.1 — the exact «API» source in the Tasks column's origin filter.
 *
 * The spec makes the exact value `source=api` a filter of the UI, next to
 * the origin groups (the human-driven group includes `api` on the server).
 * The failure this pins is the quiet one: an «API» option that the reader
 * can pick but that reaches the wire only as a group — or not at all — on
 * one of the column's surfaces, so that list never narrows to API writes.
 *
 * Real column, real `useTasks`, real `useTasksUiState` over real
 * localStorage; only the network is stubbed. Every read the column can make
 * is a spy, so each surface is checked on the call it really makes. The
 * option is found by role and accessible name, the way the reader meets it.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import type {
  ListAllIssuesParams,
  ListAllIssuesResult,
  ListIssuesParams,
  ListIssuesResult,
  ListMineParams,
} from '../../../api/issues';
import type { SearchParams, SearchResponse } from '../../../api/search';
import { LayoutProvider } from '../../../lib/useLayoutState';
import { TasksUiStateProvider } from '../../../lib/useTasksUiState';
import { TasksColumn } from '../TasksColumn';

const EMPTY_PAGE = { items: [], total: 0, hasMore: false, nextCursor: null };

const listIssuesSpy = vi.fn<
  (projectId: string, params?: ListIssuesParams) => Promise<ListIssuesResult>
>(async () => EMPTY_PAGE);
const listAllIssuesSpy = vi.fn<(params?: ListAllIssuesParams) => Promise<ListAllIssuesResult>>(
  async () => EMPTY_PAGE as unknown as ListAllIssuesResult,
);
const listCreatedByMeSpy = vi.fn<(params?: ListMineParams) => Promise<ListIssuesResult>>(
  async () => EMPTY_PAGE,
);
const listAssignedToMeSpy = vi.fn<(params?: ListMineParams) => Promise<ListIssuesResult>>(
  async () => EMPTY_PAGE,
);
const globalSearchSpy = vi.fn<(params: SearchParams) => Promise<SearchResponse>>(
  async () => ({ items: [], hasMore: false, nextCursor: null, degraded: false, tookMs: 0 }) as SearchResponse,
);

vi.mock('../../../api/issues', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/issues')>();
  return {
    ...actual,
    listIssues: (...args: [string, ListIssuesParams?]) => listIssuesSpy(...args),
    listAllIssues: (params?: ListAllIssuesParams) => listAllIssuesSpy(params),
    listCreatedByMe: (params?: ListMineParams) => listCreatedByMeSpy(params),
    listAssignedToMe: (params?: ListMineParams) => listAssignedToMeSpy(params),
  };
});

vi.mock('../../../api/search', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/search')>();
  return { ...actual, globalSearch: (params: SearchParams) => globalSearchSpy(params) };
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

const ORIGIN_KEY = 'skein.tasks.originFilter';

function renderColumn(url: string, lens: { outboxMode?: boolean; onMeMode?: boolean } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const column = (
    <LayoutProvider>
      <TasksUiStateProvider>
        <TasksColumn
          width={468}
          collapsed={false}
          outboxMode={lens.outboxMode ?? false}
          onMeMode={lens.onMeMode ?? false}
          budilnikMode={false}
        />
      </TasksUiStateProvider>
    </LayoutProvider>
  );
  return render(
    <MantineProvider forceColorScheme="dark">
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[url]}>
          <Routes>
            <Route path="/projects/:alias" element={column} />
            <Route path="/" element={column} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

/** The params of the latest call of a spy whose params are its last argument. */
function lastParams<P>(spy: { mock: { calls: unknown[][] } }): P | undefined {
  const calls = spy.mock.calls;
  if (calls.length === 0) return undefined;
  const args = calls[calls.length - 1];
  return args[args.length - 1] as P;
}

beforeEach(() => {
  window.localStorage.clear();
  // The panel open and drawn as chip rows, so the Source row is a radiogroup.
  window.localStorage.setItem('skein.layout.task-filters-collapsed', 'false');
  window.localStorage.setItem('skein.tasks.filtersLayout', 'chips');
  for (const spy of [listIssuesSpy, listAllIssuesSpy, listCreatedByMeSpy, listAssignedToMeSpy, globalSearchSpy]) {
    spy.mockClear();
  }
});

afterEach(() => cleanup());

describe('sk-878.3.1 — the exact API source in the Tasks origin filter', () => {
  test('picking API lists with source=api; the people group still goes as a group', async () => {
    renderColumn('/projects/demo');
    await waitFor(() => expect(listIssuesSpy).toHaveBeenCalled());
    const source = screen.getByRole('radiogroup', { name: 'Source' });

    fireEvent.click(within(source).getByRole('radio', { name: 'API' }));
    await waitFor(() => expect(lastParams<ListIssuesParams>(listIssuesSpy)?.source).toBe('api'));
    expect(lastParams<ListIssuesParams>(listIssuesSpy)?.origin).toBeUndefined();

    fireEvent.click(within(source).getByRole('radio', { name: 'From a human' }));
    await waitFor(() => expect(lastParams<ListIssuesParams>(listIssuesSpy)?.origin).toBe('human-driven'));
    expect(lastParams<ListIssuesParams>(listIssuesSpy)?.source).toBeUndefined();
  });

  test('a stored API choice is restored: the radio is checked and the first read already narrows', async () => {
    window.localStorage.setItem(ORIGIN_KEY, 'api');
    renderColumn('/projects/demo');
    await waitFor(() => expect(listIssuesSpy).toHaveBeenCalled());
    expect(listIssuesSpy.mock.calls[0][1]).toMatchObject({ source: 'api' });
    expect(listIssuesSpy.mock.calls[0][1]?.origin).toBeUndefined();
    const source = screen.getByRole('radiogroup', { name: 'Source' });
    expect(within(source).getByRole('radio', { name: 'API' }).getAttribute('aria-checked')).toBe('true');
  });

  // Every surface of the column, each on the read it makes. A branch of
  // `useTasks` that drops `source: wireSource` turns its row red.
  test.each([
    ['the project list, On me', '/projects/demo', { onMeMode: true }, listIssuesSpy],
    ['all projects', '/', {}, listAllIssuesSpy],
    ['Delegated across projects', '/', { outboxMode: true }, listCreatedByMeSpy],
    ['On me across projects', '/', { onMeMode: true }, listAssignedToMeSpy],
  ] as const)('%s reads with source=api and no group', async (_name, url, lens, spy) => {
    window.localStorage.setItem(ORIGIN_KEY, 'api');
    renderColumn(url, lens);
    await waitFor(() => expect(spy).toHaveBeenCalled());
    const params = lastParams<{ source?: string; origin?: string }>(spy);
    expect(params?.source).toBe('api');
    expect(params?.origin).toBeUndefined();
  });

  test('a search in the column sends source=api and no group', async () => {
    window.localStorage.setItem(ORIGIN_KEY, 'api');
    renderColumn('/projects/demo');
    fireEvent.change(screen.getByPlaceholderText('Search by task text or code'), {
      target: { value: 'needle' },
    });
    await waitFor(() => expect(globalSearchSpy).toHaveBeenCalled());
    const params = lastParams<SearchParams>(globalSearchSpy);
    expect(params?.source).toBe('api');
    expect(params?.origin).toBeUndefined();
  });
});

// The column's cross-project and personal clients put the choice on the
// wire as `source=api` (the server's own filter on those endpoints).
describe('sk-878.3.1 — the cross-project reads carry the exact source', () => {
  const fetchSpy = vi.fn<typeof fetch>();
  beforeEach(() => {
    fetchSpy.mockReset();
    fetchSpy.mockResolvedValue(new Response(JSON.stringify(EMPTY_PAGE), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchSpy);
  });
  afterEach(() => vi.unstubAllGlobals());

  test.each([
    ['/api/v1/issues', 'listAllIssues'],
    ['/api/v1/me/created-by', 'listCreatedByMe'],
    ['/api/v1/me/assigned-to', 'listAssignedToMe'],
  ] as const)('%s gets source=api', async (path, name) => {
    const actual = await vi.importActual<typeof import('../../../api/issues')>('../../../api/issues');
    await actual[name]({ source: 'api' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetchSpy.mock.calls[0][0]), 'http://localhost');
    expect(url.pathname).toBe(path);
    expect(url.searchParams.get('source')).toBe('api');
    expect(url.searchParams.has('origin')).toBe(false);
  });
});
