/**
 * sk-763 — a background re-read of the project handle resolution does not
 * take a loaded task list off the screen.
 *
 * A project outside the first page of the projects lookup list is found
 * through `GET /projects/resolve` (`useProjectByHandle`). That answer is
 * re-read in the background — an event of the project invalidates it
 * (`liveEventInvalidation.ts#invalidateProjectEvent`). The reference is the
 * acceptance of sk-763: a background refresh, with no change of the
 * project, filters or sort, does not drop the loaded rows, so the column
 * keeps the list it shows instead of a «Loading» placeholder (which
 * unmounts the list and its scroll position).
 *
 * The real `useTasks` and the real `useProjectByHandle` / `useProjectsList`
 * run against literal answers of the projects and issues endpoints.
 */
import { type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import type { IssueSummary, ListIssuesParams, ListIssuesResult } from '../../api/issues';
import type { ListProjectsParams, ListProjectsResult, ResolveResult } from '../../api/projects';
import type { UseTasksResult } from '../useTasks';

const P = '11111111-2222-3333-4444-555555555555';

const listIssuesSpy = vi.fn<(projectId: string, params?: ListIssuesParams) => Promise<ListIssuesResult>>();
const listProjectsSpy = vi.fn<(params?: ListProjectsParams) => Promise<ListProjectsResult>>();
const resolveProjectSpy = vi.fn<(q: string) => Promise<ResolveResult>>();

vi.mock('../../api/issues', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/issues')>();
  return { ...actual, listIssues: (...args: [string, ListIssuesParams?]) => listIssuesSpy(...args) };
});

vi.mock('../../api/projects', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/projects')>();
  return {
    ...actual,
    listProjects: (...args: [ListProjectsParams?]) => listProjectsSpy(...args),
    resolveProject: (...args: [string]) => resolveProjectSpy(...args),
  };
});

const { useTasks } = await import('../useTasks');

function summary(id: string, createdAt: string): IssueSummary {
  return {
    id,
    projectId: P,
    version: 1,
    title: id,
    type: 'task',
    priority: 2,
    status: 'open',
    pinned: false,
    createdBy: 'u-2',
    componentIds: [],
    labels: [],
    isBlocked: false,
    updatedAt: createdAt,
    createdAt,
  };
}

const RESOLVED: ResolveResult = {
  match: { id: P, name: 'Zeta', idPrefix: 'zz', similarity: 1, matchedVia: 'prefix' },
  candidates: [],
};

let last: UseTasksResult | null = null;
let qc: QueryClient;

function Harness() {
  last = useTasks({
    selectedProject: 'zz',
    selectedComponent: null,
    outboxMode: false,
    onMeMode: false,
    statusFilter: 'all',
    originFilter: 'all',
    typeFilter: 'all',
    priorityFilter: 'all',
    search: '',
    sort: 'created',
    assigneeFilter: null,
  });
  return null;
}

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

const ids = () => (last?.data ?? []).map((r) => r.id);

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // The lookup list does not hold the project: it is resolved by handle.
  listProjectsSpy.mockResolvedValue({ items: [], total: 0, hasMore: false, nextCursor: null } as ListProjectsResult);
  resolveProjectSpy.mockResolvedValue(RESOLVED);
  listIssuesSpy.mockImplementation((_pid, params) => Promise.resolve(
    params?.cursor === 'c-1'
      ? { items: [summary('zz-2', '2026-10-01T10:00:01Z')], total: 2, hasMore: false, nextCursor: null }
      : { items: [summary('zz-1', '2026-10-01T10:00:02Z')], total: 2, hasMore: true, nextCursor: 'c-1' },
  ));
  last = null;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('sk-763 — the resolution of a project handle re-read in the background', () => {
  test('the loaded list stays: no loading state, the same project and every loaded row', async () => {
    render(<Wrapper><Harness /></Wrapper>);
    await waitFor(() => expect(ids()).toEqual(['zz-1']));
    await act(async () => { last!.fetchNextPage(); });
    await waitFor(() => expect(ids()).toEqual(['zz-1', 'zz-2']));

    // The re-read does not answer until the test lets it.
    let release: () => void = () => {};
    resolveProjectSpy.mockImplementationOnce(() => new Promise((resolve) => {
      release = () => resolve(RESOLVED);
    }));
    await act(async () => {
      void qc.invalidateQueries({ queryKey: ['project', 'resolve', 'zz'] });
    });
    await waitFor(() => expect(resolveProjectSpy).toHaveBeenCalledTimes(2));

    expect(last!.isLoading).toBe(false);
    expect(last!.resolvedProjectId).toBe(P);
    expect(ids()).toEqual(['zz-1', 'zz-2']);

    await act(async () => { release(); });
    expect(last!.isLoading).toBe(false);
    expect(ids()).toEqual(['zz-1', 'zz-2']);
  });
});
