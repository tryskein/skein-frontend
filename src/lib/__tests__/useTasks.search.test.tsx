/**
 * sk-44.2 — `useTasks` hybrid-search routing.
 *
 * Asserts that a non-empty search box on the project-scoped and "All
 * projects" surfaces routes to the hybrid `globalSearch` (RRF) endpoint
 * instead of the legacy `text=` / `q=` list paths. Project-scoped lenses
 * use hybrid search with ownership predicates; cross-project outbox /
 * on-me surfaces retain their list endpoints and client-side title search.
 * Also covers `degraded:true` handling and the
 * `total` = loaded-row-count policy in search mode.
 *
 * We render a tiny harness that calls `useTasks` and capture the wire
 * calls via vi.mock on `../../api/search` + `../../api/issues`.
 */

import { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render, cleanup, waitFor, act } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import type {
  IssueSummary,
  StatusFilter,
  ListIssuesParams,
  ListIssuesResult,
  ListMineParams,
  ListAllIssuesParams,
  ListAllIssuesResult,
  PriorityFilter,
  TasksSortKey,
} from '../../api/issues';
import type { SearchParams, SearchResponse, SearchItem } from '../../api/search';
import { ApiError } from '../../api/client';
import type { UseTasksResult } from '../useTasks';

const listIssuesSpy = vi.fn<(projectId: string, params?: ListIssuesParams) => Promise<ListIssuesResult>>();
const listAllIssuesSpy = vi.fn<(params?: ListAllIssuesParams) => Promise<ListAllIssuesResult>>();
const listCreatedByMeSpy = vi.fn<(params?: ListMineParams) => Promise<ListIssuesResult>>();
const listAssignedToMeSpy = vi.fn<(params?: ListMineParams) => Promise<ListIssuesResult>>();
const globalSearchSpy = vi.fn<(params: SearchParams) => Promise<SearchResponse>>();

vi.mock('../../api/issues', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/issues')>();
  return {
    ...actual,
    listIssues: (...args: [string, ListIssuesParams?]) => listIssuesSpy(...args),
    listAllIssues: (...args: [ListAllIssuesParams?]) => listAllIssuesSpy(...args),
    listCreatedByMe: (...args: [ListMineParams?]) => listCreatedByMeSpy(...args),
    listAssignedToMe: (...args: [ListMineParams?]) => listAssignedToMeSpy(...args),
  };
});

vi.mock('../../api/search', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/search')>();
  return {
    ...actual,
    globalSearch: (...args: [SearchParams]) => globalSearchSpy(...args),
  };
});

vi.mock('../useProjectByHandle', () => {
  return {
    useProjectByHandle: (handle: string | null) => {
      if (handle === null) {
        return { project: null, isLoading: false, isUnresolved: false };
      }
      return {
        project: { id: 'proj-uuid-test', idPrefix: handle, name: 'test' },
        isLoading: false,
        isUnresolved: false,
      };
    },
  };
});

import { useTasks } from '../useTasks';
import { invalidateForSignal } from '../livePersonalSignal';

function emptyResult(): ListIssuesResult {
  return { items: [], total: 0, hasMore: false, nextCursor: null };
}
function emptyAllResult(): ListAllIssuesResult {
  return { items: [], total: 0, hasMore: false, nextCursor: null };
}
function searchItem(partial: Partial<SearchItem> & { id: string; title: string }): SearchItem {
  return {
    kind: 'issue',
    projectId: 'proj-uuid-test',
    projectName: 'test',
    snippet: '',
    score: 1,
    exactMatch: false,
    updatedAt: '2026-05-01T10:00:00Z',
    status: 'open',
    type: 'task',
    priority: 3,
    pinned: false,
    ...partial,
  };
}
function searchResponse(items: SearchItem[], over: Partial<SearchResponse> = {}): SearchResponse {
  return {
    items,
    nextCursor: null,
    hasMore: false,
    degraded: false,
    tookMs: 1,
    ...over,
  };
}

beforeEach(() => {
  listIssuesSpy.mockReset();
  listAllIssuesSpy.mockReset();
  listCreatedByMeSpy.mockReset();
  listAssignedToMeSpy.mockReset();
  globalSearchSpy.mockReset();
  listIssuesSpy.mockResolvedValue(emptyResult());
  listAllIssuesSpy.mockResolvedValue(emptyAllResult());
  listCreatedByMeSpy.mockResolvedValue(emptyResult());
  listAssignedToMeSpy.mockResolvedValue(emptyResult());
  globalSearchSpy.mockResolvedValue(searchResponse([]));
});

afterEach(() => cleanup());

interface HarnessProps {
  selectedProject: string | null;
  selectedComponent?: string | null;
  outboxMode?: boolean;
  onMeMode?: boolean;
  search: string;
  statusFilter?: StatusFilter;
  typeFilter?: 'all' | 'bug';
  originFilter?: 'all' | 'human-driven' | 'agent-autonomous';
  priorityFilter?: PriorityFilter;
  sort?: TasksSortKey;
  assigneeFilter?: string | null;
}

let lastResult: UseTasksResult | null = null;

function Harness(props: HarnessProps) {
  lastResult = useTasks({
    selectedProject: props.selectedProject,
    selectedComponent: props.selectedComponent ?? null,
    outboxMode: props.outboxMode ?? false,
    onMeMode: props.onMeMode ?? false,
    statusFilter: props.statusFilter ?? 'all',
    originFilter: props.originFilter ?? 'all',
    typeFilter: props.typeFilter ?? 'all',
    priorityFilter: props.priorityFilter ?? 'all',
    search: props.search,
    sort: props.sort ?? 'priority-updated',
    assigneeFilter: props.assigneeFilter ?? null,
  });
  return null;
}

function Wrapper({ children, client }: { children: ReactNode; client?: QueryClient }) {
  const qc = client ?? new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return (
    <MantineProvider forceColorScheme="dark">
      <QueryClientProvider client={qc}>
        <MemoryRouter>{children}</MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>
  );
}

describe('useTasks — sk-44.2 hybrid RRF search routing', () => {
  test.each([
    { surface: 'project list', selectedProject: 'test', search: '' },
    { surface: 'cross-project list with text', selectedProject: null, search: 'lookup' },
    { surface: 'project hybrid search', selectedProject: 'test', search: 'lookup' },
  ])('sk-346 — Delegated and Blocked survive on $surface', async ({ selectedProject, search }) => {
    render(
      <Wrapper>
        <Harness
          selectedProject={selectedProject}
          outboxMode
          statusFilter="blocked"
          search={search}
        />
      </Wrapper>,
    );

    if (selectedProject === null) {
      // The endpoint itself supplies the caller's Delegated scope.
      await waitFor(() => expect(listCreatedByMeSpy).toHaveBeenCalled());
      expect(listCreatedByMeSpy.mock.calls[0][0]).toEqual(expect.objectContaining({ isBlocked: true }));
      expect(globalSearchSpy).not.toHaveBeenCalled();
    } else if (search === '') {
      await waitFor(() => expect(listIssuesSpy).toHaveBeenCalled());
      expect(listIssuesSpy.mock.calls[0][1]).toEqual(expect.objectContaining({
        createdBy: 'me',
        isBlocked: true,
      }));
    } else {
      // Both predicates must reach the search service before its ranking
      // and result cap; filtering the returned page would lose matches.
      await waitFor(() => expect(globalSearchSpy).toHaveBeenCalled());
      expect(globalSearchSpy.mock.calls[0][0]).toEqual(expect.objectContaining({
        createdBy: 'me',
        isBlocked: true,
      }));
    }
  });

  test('sk-346 — hybrid carries component, origin, type, priority and delegatee together', async () => {
    render(
      <Wrapper>
        <Harness
          selectedProject="test"
          selectedComponent="component-uuid"
          outboxMode
          statusFilter="open"
          originFilter="human-driven"
          typeFilter="bug"
          priorityFilter="2"
          assigneeFilter="carol"
          search="lookup"
        />
      </Wrapper>,
    );
    await waitFor(() => expect(globalSearchSpy).toHaveBeenCalled());
    expect(globalSearchSpy.mock.calls[0][0]).toEqual(expect.objectContaining({
      project: 'proj-uuid-test',
      createdBy: 'me',
      componentId: 'component-uuid',
      assignee: 'carol',
      status: ['open'],
      type: 'bug',
      priority: 2,
      origin: ['human-driven'],
    }));
  });

  test.each([
    { statusFilter: 'active', isBlocked: undefined },
    { statusFilter: 'blocked', isBlocked: true },
  ] as const)('sk-346 — $statusFilter excludes closed before search ranking', async ({ statusFilter, isBlocked }) => {
    render(
      <Wrapper>
        <Harness selectedProject="test" search="lookup" statusFilter={statusFilter} />
      </Wrapper>,
    );
    await waitFor(() => expect(globalSearchSpy).toHaveBeenCalled());
    const params = globalSearchSpy.mock.calls[0][0];
    expect(params.status).toEqual(['open', 'in_progress', 'deferred', 'standing']);
    expect(params.isBlocked).toBe(isBlocked);
  });

  test('sk-346 — On me hybrid preserves assignment, authorship and acceptance', async () => {
    render(
      <Wrapper>
        <Harness selectedProject="test" onMeMode search="lookup" />
      </Wrapper>,
    );
    await waitFor(() => expect(globalSearchSpy).toHaveBeenCalled());
    expect(globalSearchSpy.mock.calls[0][0]).toEqual(expect.objectContaining({
      assignee: 'me',
      createdBy: 'not-me',
      acceptedAt: 'not-null',
    }));
  });

  test('sk-346 — changing a lens with the same query never reuses another lens page', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    globalSearchSpy
      .mockResolvedValueOnce(searchResponse([searchItem({ id: 'all-1', title: 'all scope' })]))
      .mockResolvedValueOnce(searchResponse([searchItem({ id: 'delegated-1', title: 'delegated scope' })]))
      .mockResolvedValueOnce(searchResponse([searchItem({ id: 'onme-1', title: 'accepted scope' })]));
    const host = (lens: 'all' | 'outbox' | 'on-me') => (
      <Wrapper client={client}>
        <Harness selectedProject="test" search="lookup" outboxMode={lens === 'outbox'} onMeMode={lens === 'on-me'} />
      </Wrapper>
    );
    const { rerender } = render(host('all'));
    await waitFor(() => expect(lastResult?.data?.map((i) => i.id)).toEqual(['all-1']));
    rerender(host('outbox'));
    await waitFor(() => expect(lastResult?.data?.map((i) => i.id)).toEqual(['delegated-1']));
    expect(globalSearchSpy.mock.calls.at(-1)?.[0].createdBy).toBe('me');
    rerender(host('on-me'));
    await waitFor(() => expect(lastResult?.data?.map((i) => i.id)).toEqual(['onme-1']));
    expect(globalSearchSpy.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({
      createdBy: 'not-me', assignee: 'me', acceptedAt: 'not-null',
    }));
    rerender(host('all'));
    await waitFor(() => expect(lastResult?.data?.map((i) => i.id)).toEqual(['all-1']));
  });

  test.each([
    { lens: 'outbox', outboxMode: true, onMeMode: false, invalidated: true },
    { lens: 'on-me', outboxMode: false, onMeMode: true, invalidated: true },
    { lens: 'all', outboxMode: false, onMeMode: false, invalidated: false },
  ])('sk-346 — personal tasks signal targets the real $lens hybrid cache entry', async ({ outboxMode, onMeMode, invalidated }) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const { unmount } = render(
      <Wrapper client={client}>
        <Harness selectedProject="test" search="lookup" outboxMode={outboxMode} onMeMode={onMeMode} />
      </Wrapper>,
    );
    await waitFor(() => expect(lastResult?.data).toEqual([]));
    const key = lastResult!.cacheKey;
    expect(client.getQueryState(key)).toBeDefined();
    expect(client.getQueryState(key)?.isInvalidated).toBe(false);
    // Keep the actual hook-created cache entry, without an active reader
    // immediately refetching it and clearing the invalidation under test.
    unmount();
    await act(async () => {
      invalidateForSignal(client, { areas: ['tasks'], sentAt: '2026-11-04T10:00:00Z' });
    });
    expect(client.getQueryState(key)?.isInvalidated).toBe(invalidated);
  });

  test('sk-346 — later search pages retain the complete narrowing', async () => {
    globalSearchSpy
      .mockResolvedValueOnce(searchResponse([], { hasMore: true, nextCursor: 'continuation' }))
      .mockResolvedValueOnce(searchResponse([]));
    render(
      <Wrapper>
        <Harness selectedProject="test" selectedComponent="component-uuid" outboxMode
          statusFilter="blocked" originFilter="human-driven" typeFilter="bug" priorityFilter="1"
          assigneeFilter="carol" search="lookup" />
      </Wrapper>,
    );
    await waitFor(() => expect(lastResult?.hasNextPage).toBe(true));
    await act(async () => { await lastResult!.fetchNextPage(); });
    expect(globalSearchSpy.mock.calls[1][0]).toEqual(expect.objectContaining({
      cursor: 'continuation', project: 'proj-uuid-test', componentId: 'component-uuid',
      createdBy: 'me', isBlocked: true, assignee: 'carol', origin: ['human-driven'],
      status: ['open', 'in_progress', 'deferred', 'standing'], type: 'bug', priority: 1,
    }));
  });

  test('sk-346 — expired hybrid cursor restarts the current scope without old pages or offsets', async () => {
    let resolveFresh!: (response: SearchResponse) => void;
    const freshPage = new Promise<SearchResponse>((resolve) => { resolveFresh = resolve; });
    const hit = (id: string, title: string) => searchItem({ id, title, type: 'bug', priority: 1, assignee: 'carol' });
    globalSearchSpy
      .mockResolvedValueOnce(searchResponse([hit('old-1', 'old first')], { hasMore: true, nextCursor: 'old-next' }))
      .mockResolvedValueOnce(searchResponse([hit('old-2', 'old second')], { hasMore: true, nextCursor: 'expired' }))
      .mockRejectedValueOnce(new ApiError(400, 'snapshot unavailable', 'invalid_cursor'))
      .mockReturnValueOnce(freshPage)
      .mockResolvedValueOnce(searchResponse([hit('fresh-2', 'fresh second')]));
    render(
      <Wrapper>
        <Harness selectedProject="test" selectedComponent="component-uuid" outboxMode
          statusFilter="blocked" originFilter="human-driven" typeFilter="bug" priorityFilter="1"
          assigneeFilter="carol" search="lookup" />
      </Wrapper>,
    );
    await waitFor(() => expect(lastResult?.data?.map((i) => i.id)).toEqual(['old-1']));
    act(() => lastResult!.fetchNextPage());
    await waitFor(() => expect(lastResult?.data?.map((i) => i.id)).toEqual(['old-1', 'old-2']));
    act(() => lastResult!.fetchNextPage());
    await waitFor(() => expect(globalSearchSpy.mock.calls[3]?.[0]).toEqual(expect.objectContaining({
      cursor: undefined, q: 'lookup', project: 'proj-uuid-test', componentId: 'component-uuid',
      createdBy: 'me', isBlocked: true, assignee: 'carol', origin: ['human-driven'],
      status: ['open', 'in_progress', 'deferred', 'standing'], type: 'bug', priority: 1,
    })));
    await waitFor(() => expect(lastResult?.isLoading).toBe(true));
    expect(lastResult?.emptyReason).toBeNull();
    await act(async () => {
      resolveFresh(searchResponse([hit('fresh-1', 'fresh first')], { hasMore: true, nextCursor: 'fresh-next' }));
    });
    await waitFor(() => expect(lastResult?.data?.map((i) => i.id)).toEqual(['fresh-1']));
    expect(lastResult?.error).toBeNull();
    act(() => lastResult!.fetchNextPage());
    await waitFor(() => expect(lastResult?.data?.map((i) => i.id)).toEqual(['fresh-1', 'fresh-2']));
    expect(globalSearchSpy.mock.calls[4][0].cursor).toBe('fresh-next');
  });

  test('sk-346 — a second cursor expiry without a successful continuation remains an error', async () => {
    globalSearchSpy
      .mockResolvedValueOnce(searchResponse([searchItem({ id: 'old-1', title: 'old' })], { hasMore: true, nextCursor: 'expired-old' }))
      .mockRejectedValueOnce(new ApiError(400, '', 'invalid_cursor'))
      .mockResolvedValueOnce(searchResponse([searchItem({ id: 'fresh-1', title: 'fresh' })], { hasMore: true, nextCursor: 'expired-fresh' }))
      .mockRejectedValueOnce(new ApiError(400, '', 'invalid_cursor'));
    render(<Wrapper><Harness selectedProject="test" search="lookup" /></Wrapper>);
    await waitFor(() => expect(lastResult?.data?.[0]?.id).toBe('old-1'));
    act(() => lastResult!.fetchNextPage());
    await waitFor(() => expect(lastResult?.data?.[0]?.id).toBe('fresh-1'));
    act(() => lastResult!.fetchNextPage());
    await waitFor(() => expect(lastResult?.error).toMatchObject({ statusCode: 400, code: 'invalid_cursor' }));
    expect(lastResult?.isLoading).toBe(false);
    expect(globalSearchSpy).toHaveBeenCalledTimes(4);
  });

  test('sk-346 — failure of the restarted first page stays visible without another restart', async () => {
    globalSearchSpy
      .mockResolvedValueOnce(searchResponse([searchItem({ id: 'old-1', title: 'old' })], { hasMore: true, nextCursor: 'expired' }))
      .mockRejectedValueOnce(new ApiError(400, '', 'invalid_cursor'))
      .mockRejectedValueOnce(new ApiError(500, '', 'internal_error'));
    render(<Wrapper><Harness selectedProject="test" search="lookup" /></Wrapper>);
    await waitFor(() => expect(lastResult?.data?.[0]?.id).toBe('old-1'));
    act(() => lastResult!.fetchNextPage());
    await waitFor(() => expect(lastResult?.error).toMatchObject({ statusCode: 500, code: 'internal_error' }));
    expect(lastResult?.isLoading).toBe(false);
    expect(lastResult?.emptyReason).toBeNull();
    expect(lastResult?.data).toBeUndefined();
    expect(globalSearchSpy).toHaveBeenCalledTimes(3);
  });

  test('sk-346 — an old in-flight cursor rejection cannot reset the newly selected scope', async () => {
    let rejectOld!: (error: Error) => void;
    const oldContinuation = new Promise<SearchResponse>((_resolve, reject) => { rejectOld = reject; });
    globalSearchSpy
      .mockResolvedValueOnce(searchResponse([searchItem({ id: 'old-1', title: 'old' })], { hasMore: true, nextCursor: 'expired' }))
      .mockReturnValueOnce(oldContinuation)
      .mockResolvedValueOnce(searchResponse([searchItem({ id: 'new-1', title: 'new scope' })]));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const host = (search: string) => <Wrapper client={client}><Harness selectedProject="test" search={search} /></Wrapper>;
    const { rerender } = render(host('old query'));
    await waitFor(() => expect(lastResult?.data?.[0]?.id).toBe('old-1'));
    act(() => lastResult!.fetchNextPage());
    await waitFor(() => expect(globalSearchSpy).toHaveBeenCalledTimes(2));
    rerender(host('new query'));
    await waitFor(() => expect(lastResult?.data?.map((i) => i.id)).toEqual(['new-1']));
    await act(async () => { rejectOld(new ApiError(400, '', 'invalid_cursor')); });
    expect(lastResult?.data?.map((i) => i.id)).toEqual(['new-1']);
    expect(lastResult?.error).toBeNull();
    expect(globalSearchSpy).toHaveBeenCalledTimes(3);
  });

  test.each([
    { status: 500, code: 'internal_error' },
    { status: 400, code: 'invalid_query' },
    { status: 422, code: 'invalid_cursor' },
  ])('sk-346 — hybrid $status/$code is not treated as an expired continuation', async ({ status, code }) => {
    globalSearchSpy
      .mockResolvedValueOnce(searchResponse([searchItem({ id: 'old-1', title: 'old' })], { hasMore: true, nextCursor: 'next' }))
      .mockRejectedValueOnce(new ApiError(status, '', code));
    render(<Wrapper><Harness selectedProject="test" search="lookup" /></Wrapper>);
    await waitFor(() => expect(lastResult?.data?.[0]?.id).toBe('old-1'));
    act(() => lastResult!.fetchNextPage());
    await waitFor(() => expect(lastResult?.error).toMatchObject({ statusCode: status, code }));
    expect(globalSearchSpy).toHaveBeenCalledTimes(2);
  });

  test('sk-346 — a list endpoint cursor error does not trigger hybrid recovery', async () => {
    listIssuesSpy
      .mockResolvedValueOnce({ items: [issueSummary('old-1', 'carol')], total: 2, hasMore: true, nextCursor: 'next' })
      .mockRejectedValueOnce(new ApiError(400, '', 'invalid_cursor'));
    render(<Wrapper><Harness selectedProject="test" search="" /></Wrapper>);
    await waitFor(() => expect(lastResult?.data?.[0]?.id).toBe('old-1'));
    act(() => lastResult!.fetchNextPage());
    await waitFor(() => expect(lastResult?.error).toMatchObject({ statusCode: 400, code: 'invalid_cursor' }));
    expect(listIssuesSpy).toHaveBeenCalledTimes(2);
    expect(globalSearchSpy).not.toHaveBeenCalled();
  });

  test('sk-346 — a successful continuation rearms recovery for a later expiry', async () => {
    globalSearchSpy
      .mockResolvedValueOnce(searchResponse([searchItem({ id: 'old-1', title: 'old' })], { hasMore: true, nextCursor: 'expired-old' }))
      .mockRejectedValueOnce(new ApiError(400, '', 'invalid_cursor'))
      .mockResolvedValueOnce(searchResponse([searchItem({ id: 'fresh-1', title: 'fresh first' })], { hasMore: true, nextCursor: 'fresh-next' }))
      .mockResolvedValueOnce(searchResponse([searchItem({ id: 'fresh-2', title: 'fresh second' })], { hasMore: true, nextCursor: 'expired-later' }))
      .mockRejectedValueOnce(new ApiError(400, '', 'invalid_cursor'))
      .mockResolvedValueOnce(searchResponse([searchItem({ id: 'latest-1', title: 'new generation' })]));
    render(<Wrapper><Harness selectedProject="test" search="lookup" /></Wrapper>);
    await waitFor(() => expect(lastResult?.data?.[0]?.id).toBe('old-1'));
    act(() => lastResult!.fetchNextPage());
    await waitFor(() => expect(lastResult?.data?.[0]?.id).toBe('fresh-1'));
    act(() => lastResult!.fetchNextPage());
    await waitFor(() => expect(lastResult?.data?.map((i) => i.id)).toEqual(['fresh-1', 'fresh-2']));
    act(() => lastResult!.fetchNextPage());
    await waitFor(() => expect(lastResult?.data?.map((i) => i.id)).toEqual(['latest-1']));
    expect(globalSearchSpy.mock.calls[5][0].cursor).toBeUndefined();
  });

  test('sk-346 — wire-filtered search keeps the previously loaded assignee options', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    globalSearchSpy
      .mockResolvedValueOnce(searchResponse([
        searchItem({ id: 'sk-1', title: 'first', assignee: 'bob' }),
        searchItem({ id: 'sk-2', title: 'second', assignee: 'carol' }),
      ]))
      .mockResolvedValueOnce(searchResponse([searchItem({ id: 'sk-1', title: 'first', assignee: 'bob' })]));
    const host = (assigneeFilter: string | null) => (
      <Wrapper client={client}>
        <Harness selectedProject="test" outboxMode search="lookup" assigneeFilter={assigneeFilter} />
      </Wrapper>
    );
    const { rerender } = render(host(null));
    await waitFor(() => expect(lastResult?.loadedAssignees.map((a) => a.username)).toEqual(['bob', 'carol']));
    rerender(host('bob'));
    await waitFor(() => expect(globalSearchSpy.mock.calls.at(-1)?.[0].assignee).toBe('bob'));
    await waitFor(() => expect(lastResult?.data?.map((i) => i.id)).toEqual(['sk-1']));
    expect(lastResult?.loadedAssignees.map((a) => a.username)).toEqual(['bob', 'carol']);
  });

  test('project-scoped + non-empty search → globalSearch(project=uuid, kind=[issue])', async () => {
    globalSearchSpy.mockResolvedValue(
      searchResponse([searchItem({ id: 'sk-14', title: 'hit' })]),
    );
    render(
      <Wrapper>
        <Harness selectedProject="test" search="lookup" />
      </Wrapper>,
    );
    await waitFor(() => expect(globalSearchSpy).toHaveBeenCalled());
    const [params] = globalSearchSpy.mock.calls[0];
    expect(params.q).toBe('lookup');
    expect(params.project).toBe('proj-uuid-test');
    expect(params.kind).toEqual(['issue']);
    // The legacy project-scoped list path must NOT fire in search mode.
    expect(listIssuesSpy).not.toHaveBeenCalled();
  });

  test('all-projects + non-empty search → globalSearch with NO project arg', async () => {
    render(
      <Wrapper>
        <Harness selectedProject={null} search="thing" />
      </Wrapper>,
    );
    await waitFor(() => expect(globalSearchSpy).toHaveBeenCalled());
    const [params] = globalSearchSpy.mock.calls[0];
    expect(params.q).toBe('thing');
    expect(params.project).toBeUndefined();
    // Legacy cross-project FTS path (listAllIssues with q=) must NOT fire.
    expect(listAllIssuesSpy).not.toHaveBeenCalled();
  });

  test('empty search on project surface uses the list endpoint, not search', async () => {
    render(
      <Wrapper>
        <Harness selectedProject="test" search="" />
      </Wrapper>,
    );
    await waitFor(() => expect(listIssuesSpy).toHaveBeenCalled());
    expect(globalSearchSpy).not.toHaveBeenCalled();
    // sk-44.2 — `text=` is gone; the list path never carries a search term.
    const [, params] = listIssuesSpy.mock.calls[0];
    expect(params?.text).toBeUndefined();
  });

  test('outbox lens with search STAYS on /me/created-by (client-side search)', async () => {
    listCreatedByMeSpy.mockResolvedValue({
      items: [],
      total: 0,
      hasMore: false,
      nextCursor: null,
    });
    render(
      <Wrapper>
        <Harness selectedProject={null} outboxMode search="abc" />
      </Wrapper>,
    );
    await waitFor(() => expect(listCreatedByMeSpy).toHaveBeenCalled());
    // Cross-project Delegated retains its existing list/title-search path;
    // project-scoped Delegated is covered by the hybrid cases above.
    expect(globalSearchSpy).not.toHaveBeenCalled();
  });

  test('forwards status/type/origin filters to globalSearch', async () => {
    render(
      <Wrapper>
        <Harness
          selectedProject="test"
          search="x"
          statusFilter="open"
          typeFilter="bug"
          originFilter="agent-autonomous"
        />
      </Wrapper>,
    );
    await waitFor(() => expect(globalSearchSpy).toHaveBeenCalled());
    const [params] = globalSearchSpy.mock.calls[0];
    expect(params.status).toEqual(['open']);
    expect(params.type).toBe('bug');
    expect(params.origin).toEqual(['agent-autonomous']);
    expect(params.source).toBeUndefined();
  });

  test('human-driven search uses the complete origin group, including directed agents', async () => {
    render(
      <Wrapper>
        <Harness selectedProject="test" search="x" originFilter="human-driven" />
      </Wrapper>,
    );
    await waitFor(() => expect(globalSearchSpy).toHaveBeenCalled());
    const [params] = globalSearchSpy.mock.calls[0];
    expect(params.origin).toEqual(['human-driven']);
    expect(params.source).toBeUndefined();
  });

  test('origin all leaves search origins unrestricted', async () => {
    render(
      <Wrapper>
        <Harness selectedProject="test" search="x" originFilter="all" />
      </Wrapper>,
    );
    await waitFor(() => expect(globalSearchSpy).toHaveBeenCalled());
    const [params] = globalSearchSpy.mock.calls[0];
    expect(params.origin).toBeUndefined();
    expect(params.source).toBeUndefined();
  });

  test('degraded:true surfaces on searchDegraded without erroring', async () => {
    globalSearchSpy.mockResolvedValue(
      searchResponse([searchItem({ id: 'sk-1', title: 'a' })], { degraded: true }),
    );
    render(
      <Wrapper>
        <Harness selectedProject="test" search="q" />
      </Wrapper>,
    );
    await waitFor(() => expect(lastResult?.searchDegraded).toBe(true));
    expect(lastResult?.error).toBeFalsy();
    expect(lastResult?.data?.length).toBe(1);
  });

  test('total in search mode = loaded row count (no fabricated COUNT)', async () => {
    globalSearchSpy.mockResolvedValue(
      searchResponse([
        searchItem({ id: 'sk-1', title: 'a' }),
        searchItem({ id: 'sk-2', title: 'b' }),
        searchItem({ id: 'sk-3', title: 'c' }),
      ]),
    );
    render(
      <Wrapper>
        <Harness selectedProject="test" search="q" />
      </Wrapper>,
    );
    await waitFor(() => expect(lastResult?.data?.length).toBe(3));
    expect(lastResult?.total).toBe(3);
  });

  test('sk-55 — search with statusFilter=all keeps closed hits; active drops them', async () => {
    // The alpha-15/sk-15 case: numeric / exact-id search lands mostly on
    // CLOSED issues. With the cleared search default now 'all' (sk-55), the
    // client-side post-filter must NOT drop them.
    globalSearchSpy.mockResolvedValue(
      searchResponse([
        searchItem({ id: 'sk-15', title: 'closed hit', status: 'closed' }),
        searchItem({ id: 'sk-2.15', title: 'open hit', status: 'open' }),
      ]),
    );
    const { rerender } = render(
      <Wrapper>
        <Harness selectedProject="test" search="15" statusFilter="all" />
      </Wrapper>,
    );
    await waitFor(() => expect(lastResult?.data?.length).toBe(2));
    expect(lastResult?.data?.map((i) => i.id).sort()).toEqual(['sk-15', 'sk-2.15']);

    // Contrast: an EXPLICIT 'active' (e.g. within-filters ON) still drops
    // closed — the user asked for active-only.
    rerender(
      <Wrapper>
        <Harness selectedProject="test" search="15" statusFilter="active" />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(lastResult?.data?.map((i) => i.id)).toEqual(['sk-2.15']),
    );
  });

  test('Fix D — searchMode/totalIsExact affordance distinguishes loaded vs exact', async () => {
    // Search mode: total is loaded-row count, NOT exact.
    globalSearchSpy.mockResolvedValue(
      searchResponse([searchItem({ id: 'sk-1', title: 'a' })]),
    );
    render(
      <Wrapper>
        <Harness selectedProject="test" search="q" />
      </Wrapper>,
    );
    await waitFor(() => expect(lastResult?.searchMode).toBe(true));
    expect(lastResult?.totalIsExact).toBe(false);
    cleanup();

    // Non-search list mode: total is the authoritative COUNT(*) → exact.
    listIssuesSpy.mockResolvedValue({
      items: [],
      total: 42,
      hasMore: false,
      nextCursor: null,
    });
    render(
      <Wrapper>
        <Harness selectedProject="test" search="" />
      </Wrapper>,
    );
    // Wait for the list query to resolve (total comes off the page).
    await waitFor(() => expect(lastResult?.total).toBe(42));
    expect(lastResult?.searchMode).toBe(false);
    expect(lastResult?.totalIsExact).toBe(true);
  });

  test('Fix C — searchDegraded reflects the LATEST page, not page 1', async () => {
    // Page 1 clean (hasMore → page 2 exists), page 2 degraded. The
    // banner must follow the latest loaded page.
    globalSearchSpy.mockImplementation(async (params: SearchParams) => {
      if (!params.cursor) {
        return searchResponse([searchItem({ id: 'sk-1', title: 'a' })], {
          degraded: false,
          hasMore: true,
          nextCursor: 'c2',
        });
      }
      return searchResponse([searchItem({ id: 'sk-2', title: 'b' })], {
        degraded: true,
        hasMore: false,
        nextCursor: null,
      });
    });
    render(
      <Wrapper>
        <Harness selectedProject="test" search="q" />
      </Wrapper>,
    );
    // Page 1: clean → banner off.
    await waitFor(() => expect(lastResult?.data?.length).toBe(1));
    expect(lastResult?.searchDegraded).toBe(false);

    // Fetch page 2 (came back degraded) → banner must turn ON. With the
    // old pages[0] read this would have stayed false.
    act(() => lastResult!.fetchNextPage());
    await waitFor(() => expect(lastResult?.data?.length).toBe(2));
    expect(lastResult?.searchDegraded).toBe(true);
  });

  test('sk-50 — search mode with an EXPLICIT key (sort=id) re-ranks (user opt-in)', async () => {
    // sk-48 history: `useTasks` originally skipped clientSort whenever
    // searchMode was active, regardless of the sort key — that was the
    // fix for the alpha-24 bug (sort=ID surfacing the weakest match
    // first). sk-50 MOVES that guarantee from a searchMode gate onto the
    // `sort === 'relevance'` value: relevance-preservation is now covered
    // by the dedicated 'sort=relevance preserves server RRF order' test.
    //
    // Under sk-50, in real usage the column feeds effectiveSort to
    // useTasks — that is 'relevance' on the search-begin edge, so the
    // alpha-24 regression stays fixed by default. But if the user
    // EXPLICITLY picks 'id' (or Priority/etc.) mid-search, effectiveSort
    // becomes that key and clientSort legitimately re-ranks — the
    // "find X, then show by id" case. This test pins that opt-in path:
    // sort=id in search mode now re-sorts by hierarchical id.
    globalSearchSpy.mockResolvedValue(
      searchResponse([
        searchItem({ id: 'gamma-web-1', title: 'strong relevance' }),
        searchItem({ id: 'beta-1', title: 'mid relevance' }),
        searchItem({ id: 'alpha-24', title: 'weak semantic' }),
      ]),
    );
    render(
      <Wrapper>
        <Harness selectedProject={null} search="support" sort="id" />
      </Wrapper>,
    );
    await waitFor(() => expect(lastResult?.data?.length).toBe(3));
    // Explicit id-sort opt-in → hierarchical id order (alpha < beta <
    // shimmer by prefix). The default-relevance guarantee is asserted in
    // the dedicated sort=relevance test above; this is the opt-in branch.
    expect(lastResult?.data?.map((i) => i.id)).toEqual([
      'alpha-24',
      'beta-1',
      'gamma-web-1',
    ]);
  });

  test('sk-50 — sort=relevance preserves server RRF order (no clientSort)', async () => {
    // The column feeds effectiveSort='relevance' into useTasks while a
    // search is active. useTasks must NOT clientSort — the server rows
    // come back already ranked by RRF and the ids are deliberately in
    // reverse id-sort order to prove no id re-rank slipped in.
    globalSearchSpy.mockResolvedValue(
      searchResponse([
        searchItem({ id: 'gamma-web-1', title: 'strong relevance' }),
        searchItem({ id: 'beta-1', title: 'mid relevance' }),
        searchItem({ id: 'alpha-24', title: 'weak semantic' }),
      ]),
    );
    render(
      <Wrapper>
        <Harness selectedProject={null} search="support" sort="relevance" />
      </Wrapper>,
    );
    await waitFor(() => expect(lastResult?.data?.length).toBe(3));
    expect(lastResult?.data?.map((i) => i.id)).toEqual([
      'gamma-web-1',
      'beta-1',
      'alpha-24',
    ]);
  });

  test('sk-50 — switching to a real key (priority) re-sorts the search result set', async () => {
    // Same server (relevance) order, but the user opts into Priority
    // mid-search → effectiveSort='priority' → clientSort runs over the
    // RRF results. Priority ASC (P0 first), id tiebreaker on ties.
    globalSearchSpy.mockResolvedValue(
      searchResponse([
        searchItem({ id: 'gamma-web-1', title: 'a', priority: 3 }),
        searchItem({ id: 'beta-1', title: 'b', priority: 0 }),
        searchItem({ id: 'alpha-24', title: 'c', priority: 1 }),
      ]),
    );
    render(
      <Wrapper>
        <Harness selectedProject={null} search="support" sort="priority" />
      </Wrapper>,
    );
    await waitFor(() => expect(lastResult?.data?.length).toBe(3));
    // Re-ranked by priority ASC: P0 (beta-1), P1 (alpha-24), P3 (gamma-web-1).
    expect(lastResult?.data?.map((i) => i.id)).toEqual([
      'beta-1',
      'alpha-24',
      'gamma-web-1',
    ]);
  });

  test('Fix C — degraded page 1 followed by clean page 2 clears the banner', async () => {
    // Inverse of the above: page 1 degraded, page 2 recovered. The old
    // pages[0] read would have stuck the banner ON forever.
    globalSearchSpy.mockImplementation(async (params: SearchParams) => {
      if (!params.cursor) {
        return searchResponse([searchItem({ id: 'sk-1', title: 'a' })], {
          degraded: true,
          hasMore: true,
          nextCursor: 'c2',
        });
      }
      return searchResponse([searchItem({ id: 'sk-2', title: 'b' })], {
        degraded: false,
        hasMore: false,
        nextCursor: null,
      });
    });
    render(
      <Wrapper>
        <Harness selectedProject="test" search="q" />
      </Wrapper>,
    );
    await waitFor(() => expect(lastResult?.data?.length).toBe(1));
    expect(lastResult?.searchDegraded).toBe(true);

    act(() => lastResult!.fetchNextPage());
    await waitFor(() => expect(lastResult?.data?.length).toBe(2));
    expect(lastResult?.searchDegraded).toBe(false);
  });
});

describe('useTasks — sk-79 assignee filter', () => {
  test('project-scoped list path forwards assignee to listIssues', async () => {
    render(
      <Wrapper>
        <Harness selectedProject="test" search="" assigneeFilter="carol" />
      </Wrapper>,
    );
    await waitFor(() => expect(listIssuesSpy).toHaveBeenCalled());
    const [, params] = listIssuesSpy.mock.calls[0];
    expect(params?.assignee).toBe('carol');
  });

  test('no assignee picked → listIssues called without assignee', async () => {
    render(
      <Wrapper>
        <Harness selectedProject="test" search="" assigneeFilter={null} />
      </Wrapper>,
    );
    await waitFor(() => expect(listIssuesSpy).toHaveBeenCalled());
    const [, params] = listIssuesSpy.mock.calls[0];
    expect(params?.assignee).toBeUndefined();
  });

  test('search carries the picked assignee before the server result cap', async () => {
    render(
      <Wrapper>
        <Harness selectedProject="test" search="q" assigneeFilter="dave" />
      </Wrapper>,
    );
    await waitFor(() => expect(globalSearchSpy).toHaveBeenCalled());
    expect(globalSearchSpy.mock.calls[0][0].assignee).toBe('dave');
  });
});

function issueSummary(id: string, assignee: string | null): IssueSummary {
  return {
    id,
    projectId: 'proj-uuid-test',
    version: 1,
    title: id,
    type: 'task',
    priority: 3,
    status: 'open',
    pinned: false,
    assignee,
    componentIds: [],
    labels: [],
    isBlocked: false,
    parentIdCurrent: null,
    updatedAt: '2026-05-01T10:00:00Z',
    createdAt: '2026-05-01T10:00:00Z',
  };
}

describe('useTasks — sk-84 Delegated assignee filter', () => {
  test('project Delegated: NOT wire-filtered by assignee; delegatees from full list; client-filtered', async () => {
    listIssuesSpy.mockResolvedValue({
      items: [
        issueSummary('a-1', 'bob'),
        issueSummary('a-2', 'carol'),
        issueSummary('a-3', 'bob'),
      ],
      total: 3,
      hasMore: false,
      nextCursor: null,
    });
    render(
      <Wrapper>
        <Harness selectedProject="test" outboxMode search="" assigneeFilter="bob" />
      </Wrapper>,
    );
    await waitFor(() => expect(listIssuesSpy).toHaveBeenCalled());
    const [, params] = listIssuesSpy.mock.calls[0];
    expect(params?.createdBy).toBe('me');
    // sk-84 — under Delegated the assignee is NOT sent on the wire (so the
    // chip set can be derived from the full delegated list).
    expect(params?.assignee).toBeUndefined();
    // delegatees = distinct assignees of the UN-narrowed list.
    await waitFor(() =>
      expect((lastResult?.delegateeAssignees ?? []).map((d) => d.username).sort()).toEqual([
        'bob',
        'carol',
      ]),
    );
    // data is client-filtered to the picked delegatee.
    expect((lastResult?.data ?? []).map((i) => i.id).sort()).toEqual(['a-1', 'a-3']);
  });

  test('cross-project Delegated (/me/created-by): client-filtered + delegatees exposed', async () => {
    listCreatedByMeSpy.mockResolvedValue({
      items: [issueSummary('b-1', 'bob'), issueSummary('b-2', 'dave')],
      total: 2,
      hasMore: false,
      nextCursor: null,
    });
    render(
      <Wrapper>
        <Harness selectedProject={null} outboxMode search="" assigneeFilter="dave" />
      </Wrapper>,
    );
    await waitFor(() => expect(listCreatedByMeSpy).toHaveBeenCalled());
    await waitFor(() => expect((lastResult?.data ?? []).map((i) => i.id)).toEqual(['b-2']));
    expect((lastResult?.delegateeAssignees ?? []).map((d) => d.username).sort()).toEqual([
      'bob',
      'dave',
    ]);
  });

  test('delegateeAssignees is empty outside the Delegated lens', async () => {
    listIssuesSpy.mockResolvedValue({
      items: [issueSummary('c-1', 'bob')],
      total: 1,
      hasMore: false,
      nextCursor: null,
    });
    render(
      <Wrapper>
        <Harness selectedProject="test" search="" />
      </Wrapper>,
    );
    await waitFor(() => expect(listIssuesSpy).toHaveBeenCalled());
    await waitFor(() => expect(lastResult?.data?.length).toBe(1));
    expect(lastResult?.delegateeAssignees).toEqual([]);
  });
});

describe('useTasks — sk-285.5.5 loadedAssignees (cross-project chip source)', () => {
  test('All projects: distinct assignees of the loaded list, deduped case-insensitively', async () => {
    listAllIssuesSpy.mockResolvedValue({
      items: [
        { ...issueSummary('x-1', 'bob'), assigneeUserId: 'uuid-bob' },
        { ...issueSummary('x-2', 'Bob'), assigneeUserId: 'uuid-bob' },
        { ...issueSummary('x-3', 'carol'), assigneeUserId: 'uuid-carol' },
        issueSummary('x-4', null),
        { ...issueSummary('x-5', '   '), assigneeUserId: null },
      ],
      total: 5,
      hasMore: false,
      nextCursor: null,
    });
    render(
      <Wrapper>
        <Harness selectedProject={null} search="" />
      </Wrapper>,
    );
    await waitFor(() => expect(listAllIssuesSpy).toHaveBeenCalled());
    await waitFor(() => expect(lastResult?.data?.length).toBe(5));

    // The chip row on "All projects" reads THIS — it no longer fetches the
    // org-wide user directory (sk-285.5.5).
    expect((lastResult?.loadedAssignees ?? []).map((a) => a.username)).toEqual([
      'bob',
      'carol',
    ]);
    expect((lastResult?.loadedAssignees ?? []).map((a) => a.userId)).toEqual([
      'uuid-bob',
      'uuid-carol',
    ]);
    // Unchanged contract: delegateeAssignees stays lens-scoped.
    expect(lastResult?.delegateeAssignees).toEqual([]);
  });

  test('picking an assignee does NOT collapse the chip set (wire filter honoured)', async () => {
    // The real `listAllIssues` sends `assignee` ON THE WIRE and the server
    // returns only that person's rows. A stub that ignores the argument
    // makes this test pass no matter what the hook does — so it honours it.
    const board = [issueSummary('y-1', 'bob'), issueSummary('y-2', 'carol')];
    listAllIssuesSpy.mockImplementation(async (params) => {
      const want = params?.assignee?.toLowerCase();
      const items = want
        ? board.filter((i) => (i.assignee ?? '').toLowerCase() === want)
        : board;
      return { items, total: items.length, hasMore: false, nextCursor: null };
    });

    const view = render(
      <Wrapper>
        <Harness selectedProject={null} search="" assigneeFilter={null} />
      </Wrapper>,
    );
    // Unfiltered board first — this is the state the chip row is built from.
    await waitFor(() =>
      expect((lastResult?.loadedAssignees ?? []).map((a) => a.username).sort()).toEqual([
        'bob',
        'carol',
      ]),
    );

    // Now pick bob. The wire refetches narrowed to bob (assignee is
    // part of the cache key), so the loaded rows carry ONE assignee...
    view.rerender(
      <Wrapper>
        <Harness selectedProject={null} search="" assigneeFilter="bob" />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(
        listAllIssuesSpy.mock.calls.some(([p]) => p?.assignee === 'bob'),
      ).toBe(true),
    );
    await waitFor(() => expect((lastResult?.data ?? []).map((i) => i.id)).toEqual(['y-1']));

    // ...but the chip set must still offer BOTH, or there is no way to
    // switch to carol and no un-narrowed request to rebuild it from.
    expect((lastResult?.loadedAssignees ?? []).map((a) => a.username).sort()).toEqual([
      'bob',
      'carol',
    ]);

    // Clearing the pick re-snapshots from the freshly un-narrowed board.
    view.rerender(
      <Wrapper>
        <Harness selectedProject={null} search="" assigneeFilter={null} />
      </Wrapper>,
    );
    await waitFor(() => expect((lastResult?.data ?? []).map((i) => i.id)).toEqual(['y-1', 'y-2']));
    expect((lastResult?.loadedAssignees ?? []).map((a) => a.username).sort()).toEqual([
      'bob',
      'carol',
    ]);
  });

  test('a pick with no matching row leaves the chip set intact', async () => {
    // The second failure mode of the same defect: somebody chosen through
    // the directory search has no task on the board, so the narrowed
    // request returns NOTHING. Deriving the chips from that response leaves
    // an empty chip row — an empty board with no control to clear it.
    const board = [issueSummary('w-1', 'bob'), issueSummary('w-2', 'carol')];
    listAllIssuesSpy.mockImplementation(async (params) => {
      const want = params?.assignee?.toLowerCase();
      const items = want
        ? board.filter((i) => (i.assignee ?? '').toLowerCase() === want)
        : board;
      return { items, total: items.length, hasMore: false, nextCursor: null };
    });

    const view = render(
      <Wrapper>
        <Harness selectedProject={null} search="" assigneeFilter={null} />
      </Wrapper>,
    );
    await waitFor(() => expect(lastResult?.data?.length).toBe(2));

    view.rerender(
      <Wrapper>
        <Harness selectedProject={null} search="" assigneeFilter="stranger" />
      </Wrapper>,
    );
    await waitFor(() => expect(lastResult?.data?.length).toBe(0));
    expect((lastResult?.loadedAssignees ?? []).map((a) => a.username).sort()).toEqual([
      'bob',
      'carol',
    ]);
  });

  test('under the Delegated lens loadedAssignees and delegateeAssignees agree', async () => {
    listCreatedByMeSpy.mockResolvedValue({
      items: [issueSummary('z-1', 'bob'), issueSummary('z-2', 'dave')],
      total: 2,
      hasMore: false,
      nextCursor: null,
    });
    render(
      <Wrapper>
        <Harness selectedProject={null} outboxMode search="" />
      </Wrapper>,
    );
    await waitFor(() => expect(listCreatedByMeSpy).toHaveBeenCalled());
    await waitFor(() => expect(lastResult?.delegateeAssignees?.length).toBe(2));
    expect(lastResult?.loadedAssignees).toEqual(lastResult?.delegateeAssignees);
  });
});


function issueSummaryP(id: string, priority: number): IssueSummary {
  return { ...issueSummary(id, null), priority };
}

describe('useTasks — sk-86 priority filter', () => {
  test('project-scoped list path forwards the parsed priority int to listIssues', async () => {
    render(
      <Wrapper>
        <Harness selectedProject="test" search="" priorityFilter="2" />
      </Wrapper>,
    );
    await waitFor(() => expect(listIssuesSpy).toHaveBeenCalled());
    const [, params] = listIssuesSpy.mock.calls[0];
    // 'all' → undefined; '2' → 2 (number) on the wire.
    expect(params?.priority).toBe(2);
  });

  test("priorityFilter='all' → listIssues called without priority", async () => {
    render(
      <Wrapper>
        <Harness selectedProject="test" search="" priorityFilter="all" />
      </Wrapper>,
    );
    await waitFor(() => expect(listIssuesSpy).toHaveBeenCalled());
    const [, params] = listIssuesSpy.mock.calls[0];
    expect(params?.priority).toBeUndefined();
  });

  test('search mode forwards the parsed priority int to globalSearch', async () => {
    render(
      <Wrapper>
        <Harness selectedProject="test" search="q" priorityFilter="0" />
      </Wrapper>,
    );
    await waitFor(() => expect(globalSearchSpy).toHaveBeenCalled());
    const [params] = globalSearchSpy.mock.calls[0];
    expect(params.priority).toBe(0);
  });

  test('cross-project "All projects" list lacks wire priority → rows post-filtered client-side', async () => {
    // listAllIssues has no priority wire param, so the narrowing must happen
    // client-side over the returned rows.
    listAllIssuesSpy.mockResolvedValue({
      items: [issueSummaryP('a-1', 0), issueSummaryP('a-2', 2), issueSummaryP('a-3', 2)],
      total: 3,
      hasMore: false,
      nextCursor: null,
    });
    render(
      <Wrapper>
        <Harness selectedProject={null} search="" priorityFilter="2" />
      </Wrapper>,
    );
    await waitFor(() => expect(listAllIssuesSpy).toHaveBeenCalled());
    await waitFor(() =>
      expect((lastResult?.data ?? []).map((i) => i.id).sort()).toEqual(['a-2', 'a-3']),
    );
  });

  test('cross-project Delegated (/me/created-by) lacks wire priority → post-filtered client-side', async () => {
    listCreatedByMeSpy.mockResolvedValue({
      items: [issueSummaryP('b-1', 1), issueSummaryP('b-2', 4)],
      total: 2,
      hasMore: false,
      nextCursor: null,
    });
    render(
      <Wrapper>
        <Harness selectedProject={null} outboxMode search="" priorityFilter="4" />
      </Wrapper>,
    );
    await waitFor(() => expect(listCreatedByMeSpy).toHaveBeenCalled());
    await waitFor(() => expect((lastResult?.data ?? []).map((i) => i.id)).toEqual(['b-2']));
  });
});

// ────── sk-303.14 (T025, rows 91–92) — the unreviewed selection is a
//        QUERY PARAMETER, on both halves of the Delegated surface ──────

describe('useTasks — sk-303.14 unreviewed selection on the wire', () => {
  test('row 91 — cross-project half: /me/created-by carries unreviewed=true', async () => {
    render(
      <Wrapper>
        <Harness selectedProject={null} outboxMode search="" statusFilter="unreviewed" />
      </Wrapper>,
    );
    await waitFor(() => expect(listCreatedByMeSpy).toHaveBeenCalled());
    const [params] = listCreatedByMeSpy.mock.calls[0];
    expect(params?.unreviewed).toBe(true);
    // The sentinel is not a wire status — sending it would be a 400.
    expect(params?.status).toBeUndefined();
    // No `includeClosed` alongside: the server lifts its own open-only
    // default for this selection. Sending both would say the same thing
    // twice, in two vocabularies that can drift apart.
    expect(params?.includeClosed).toBeUndefined();
  });

  test('row 91 — project half: listIssues carries unreviewed=true beside createdBy=me', async () => {
    // The half a reader reaches by picking a project inside the lens. Wire
    // the selection into only the other builder and THIS is where it
    // silently stops narrowing — no error, just more rows than the chip
    // claims.
    render(
      <Wrapper>
        <Harness selectedProject="test" outboxMode search="" statusFilter="unreviewed" />
      </Wrapper>,
    );
    await waitFor(() => expect(listIssuesSpy).toHaveBeenCalled());
    const [, params] = listIssuesSpy.mock.calls[0];
    expect(params?.unreviewed).toBe(true);
    expect(params?.createdBy).toBe('me');
    expect(params?.status).toBeUndefined();
  });

  test('row 92 — closed rows survive: the selection is closed results by construction', async () => {
    // The two older sentinels ('active', 'blocked') drop closed rows in the
    // post-filter. Adding this one to that list would empty the column
    // while the server had answered correctly — and the second number
    // would go on counting the rows the user cannot see.
    const closed: IssueSummary = {
      id: 'sk-9',
      projectId: 'proj-uuid-test',
      version: 1,
      title: 'delivered, unread',
      type: 'task',
      priority: 2,
      status: 'closed',
      pinned: false,
      assignee: 'someone',
      componentIds: [],
      labels: [],
      isBlocked: false,
      parentIdCurrent: null,
      updatedAt: '2026-05-01T10:00:00Z',
      createdAt: '2026-05-01T09:00:00Z',
    };
    listCreatedByMeSpy.mockResolvedValue({
      items: [closed],
      total: 1,
      hasMore: false,
      nextCursor: null,
    });
    render(
      <Wrapper>
        <Harness selectedProject={null} outboxMode search="" statusFilter="unreviewed" />
      </Wrapper>,
    );
    await waitFor(() => expect(lastResult?.data?.length).toBe(1));
    expect(lastResult!.data![0].id).toBe('sk-9');
    expect(lastResult!.total).toBe(1);
  });

  test('the selection does not leak onto surfaces that have no such set', async () => {
    // `unreviewed` exists on the two delegated paths only. The chip that
    // produces it is Delegated-only, and this pins the other direction:
    // even handed the sentinel, a non-delegated surface sends no such
    // parameter rather than a request the endpoint would reject.
    render(
      <Wrapper>
        <Harness selectedProject="test" search="" statusFilter="unreviewed" />
      </Wrapper>,
    );
    await waitFor(() => expect(listIssuesSpy).toHaveBeenCalled());
    const [, params] = listIssuesSpy.mock.calls[0];
    expect(params?.unreviewed).toBeUndefined();
    expect(params?.createdBy).toBeUndefined();
  });
});

// sk-674.18 T055 (row 245) — the assignees of the loaded
// board carry the state the rows carry, so the assignee filter on «All
// projects», a space and the Delegated lens marks a departed or deleted
// person as everywhere people are shown. Rows of different spaces are
// merged: a deletion is of the account (one row says it for all); a
// departure is from one space (only when every row says so).
describe('useTasks — sk-674.18 assignee state on the board’s chip source', () => {
  const DEPARTED = { departed: true, deleted: false, pseudonym: null };
  const DELETED = { departed: false, deleted: true, pseudonym: 'deleted-7f3a' };

  test('All projects: departed everywhere → departed; departed in one space only → not; deleted → deleted', async () => {
    listAllIssuesSpy.mockResolvedValue({
      items: [
        { ...issueSummary('x-1', 'oleg'), assigneeStatus: DEPARTED },
        { ...issueSummary('x-2', 'oleg'), assigneeStatus: DEPARTED },
        { ...issueSummary('x-3', 'ira'), assigneeStatus: DEPARTED },
        // ira is still a member of the space of this one.
        issueSummary('x-4', 'ira'),
        { ...issueSummary('x-5', 'deleted-7f3a'), assigneeStatus: DELETED },
      ],
      total: 5,
      hasMore: false,
      nextCursor: null,
    });
    render(
      <Wrapper>
        <Harness selectedProject={null} search="" />
      </Wrapper>,
    );
    await waitFor(() => expect(lastResult?.loadedAssignees.length).toBe(3));
    const by = new Map((lastResult?.loadedAssignees ?? []).map((a) => [a.username, a.status]));
    expect(by.get('oleg')?.departed).toBe(true);
    expect(by.get('ira')?.departed ?? false).toBe(false);
    expect(by.get('deleted-7f3a')).toEqual({ deleted: true, departed: false, pseudonym: 'deleted-7f3a' });
  });

  test('Delegated (/me/created-by): the delegatees carry the state too', async () => {
    listCreatedByMeSpy.mockResolvedValue({
      items: [{ ...issueSummary('b-1', 'oleg'), assigneeStatus: DEPARTED }, issueSummary('b-2', 'dave')],
      total: 2,
      hasMore: false,
      nextCursor: null,
    });
    render(
      <Wrapper>
        <Harness selectedProject={null} outboxMode search="" />
      </Wrapper>,
    );
    await waitFor(() => expect(lastResult?.delegateeAssignees.length).toBe(2));
    const by = new Map((lastResult?.delegateeAssignees ?? []).map((a) => [a.username, a.status]));
    expect(by.get('oleg')?.departed).toBe(true);
    expect(by.get('dave')).toBeUndefined();
  });
});
