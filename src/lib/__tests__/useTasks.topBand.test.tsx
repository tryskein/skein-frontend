/**
 * sk-118 (decision #6, §11.12) — INTEGRATION-level proof of the mandatory
 * top-band invariant THROUGH `useTasks`, not just the bare
 * `partitionStanding` helper (which topBandPartition.test.ts already
 * covers in isolation).
 *
 * `topBandPartition.test.ts` proves the partition function. This file
 * proves the SELECTOR COMPOSITION inside useTasks actually applies it
 * last — i.e. standing rows float above every other row in EVERY sort
 * mode (priority, updated, AND the relevance/search branch where
 * clientSort is skipped), and independent of `pinned`. A regression that
 * dropped the `partitionStanding(items)` call, or ran it before
 * clientSort, would be caught here even though the helper unit-test still
 * passed.
 *
 * Approach: mount the real hook (it's fully mountable — see
 * useTasks.statusFilter.test.tsx) with the data layer mocked. We read the
 * post-selector `data` array off the hook result and assert the standing
 * rows lead. The list-endpoint path covers priority + updated; the RRF
 * `globalSearch` path covers the relevance branch.
 */

import { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import type {
  IssueStatus,
  IssueSummary,
  ListIssuesParams,
  ListIssuesResult,
  ListMineParams,
  ListAllIssuesParams,
  ListAllIssuesResult,
  TasksSortKey,
} from '../../api/issues';
import type { SearchParams, SearchResponse, SearchItem } from '../../api/search';
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

vi.mock('../useProjectByHandle', () => ({
  useProjectByHandle: (handle: string | null) =>
    handle === null
      ? { project: null, isLoading: false, isUnresolved: false }
      : {
          project: { id: 'proj-uuid-test', idPrefix: handle, name: 'test' },
          isLoading: false,
          isUnresolved: false,
        },
}));

import { useTasks } from '../useTasks';

function summary(
  id: string,
  status: IssueStatus,
  opts: { priority?: number; updatedAt?: string; pinned?: boolean } = {},
): IssueSummary {
  return {
    id,
    projectId: 'proj-uuid-test',
    version: 1,
    title: id,
    type: 'task',
    priority: opts.priority ?? 3,
    status,
    pinned: opts.pinned ?? false,
    componentIds: [],
    labels: [],
    isBlocked: false,
    updatedAt: opts.updatedAt ?? '2026-06-01T00:00:00Z',
    createdAt: '2026-06-01T00:00:00Z',
  };
}

function listResult(items: IssueSummary[]): ListIssuesResult {
  return { items, total: items.length, hasMore: false, nextCursor: null };
}

function searchItem(
  id: string,
  status: IssueStatus,
  opts: { priority?: number; score?: number } = {},
): SearchItem {
  return {
    kind: 'issue',
    id,
    title: id,
    projectId: 'proj-uuid-test',
    projectName: 'test',
    snippet: '',
    score: opts.score ?? 1,
    exactMatch: false,
    updatedAt: '2026-05-01T10:00:00Z',
    status,
    type: 'task',
    priority: opts.priority ?? 3,
    pinned: false,
  };
}

function searchResponse(items: SearchItem[]): SearchResponse {
  return { items, nextCursor: null, hasMore: false, degraded: false, tookMs: 1 };
}

let lastResult: UseTasksResult | null = null;

function Harness({ sort, search }: { sort: TasksSortKey; search: string }) {
  lastResult = useTasks({
    selectedProject: 'test',
    selectedComponent: null,
    outboxMode: false,
    onMeMode: false,
    statusFilter: 'all',
    originFilter: 'all',
    typeFilter: 'all',
    priorityFilter: 'all',
    search,
    sort,
    assigneeFilter: null,
  });
  return null;
}

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
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

beforeEach(() => {
  listIssuesSpy.mockReset();
  listAllIssuesSpy.mockReset();
  listCreatedByMeSpy.mockReset();
  listAssignedToMeSpy.mockReset();
  globalSearchSpy.mockReset();
  listIssuesSpy.mockResolvedValue(listResult([]));
  listAllIssuesSpy.mockResolvedValue({ items: [], total: 0, hasMore: false, nextCursor: null });
  listCreatedByMeSpy.mockResolvedValue(listResult([]));
  listAssignedToMeSpy.mockResolvedValue(listResult([]));
  globalSearchSpy.mockResolvedValue(searchResponse([]));
  lastResult = null;
});

afterEach(() => cleanup());

const ids = (r: UseTasksResult | null) => (r?.data ?? []).map((i) => i.id);
const leadingStandingCount = (r: UseTasksResult | null) => {
  const rows = r?.data ?? [];
  let n = 0;
  for (const row of rows) {
    if (row.status === 'standing') n++;
    else break;
  }
  return n;
};

describe('useTasks — sk-118 standing top-band through the selector (list modes)', () => {
  // A deliberately adversarial mix: a HIGHER-priority pinned open row and
  // a more-recently-updated open row, so a missing partition would let
  // either one outrank the standing rows under the respective sort key.
  const mixed = (): IssueSummary[] => [
    summary('open-p0-pinned', 'open', { priority: 0, pinned: true, updatedAt: '2026-06-20T00:00:00Z' }),
    summary('std-a', 'standing', { priority: 3, updatedAt: '2026-06-02T00:00:00Z' }),
    summary('inprog-1', 'in_progress', { priority: 1, updatedAt: '2026-06-19T00:00:00Z' }),
    summary('std-b', 'standing', { priority: 4, updatedAt: '2026-06-01T00:00:00Z' }),
    summary('open-recent', 'open', { priority: 2, updatedAt: '2026-06-21T00:00:00Z' }),
  ];

  test.each<TasksSortKey>(['priority', 'updated', 'priority-updated', 'created', 'id'])(
    'sort=%s → both standing rows lead, every non-standing row trails',
    async (sort) => {
      listIssuesSpy.mockResolvedValue(listResult(mixed()));
      render(
        <Wrapper>
          <Harness sort={sort} search="" />
        </Wrapper>,
      );
      await waitFor(() => expect(lastResult?.data?.length).toBe(5));

      // Exactly the two standing rows occupy the top of the list, before
      // ANY other row — regardless of priority/recency/pin of the others.
      expect(leadingStandingCount(lastResult)).toBe(2);
      const order = ids(lastResult);
      expect(order.slice(0, 2).every((id) => id.startsWith('std-'))).toBe(true);
      expect(order.slice(2)).not.toContain('std-a');
      expect(order.slice(2)).not.toContain('std-b');
    },
  );

  test('the pinned P0 open row does NOT outrank standing (band is by status, not pin)', async () => {
    listIssuesSpy.mockResolvedValue(listResult(mixed()));
    render(
      <Wrapper>
        <Harness sort="priority-updated" search="" />
      </Wrapper>,
    );
    await waitFor(() => expect(lastResult?.data?.length).toBe(5));
    // open-p0-pinned is P0 + pinned + freshly updated — it would top a
    // pin/priority sort, yet it must sit BELOW both standing rows.
    const order = ids(lastResult);
    expect(order.indexOf('open-p0-pinned')).toBeGreaterThan(order.indexOf('std-a'));
    expect(order.indexOf('open-p0-pinned')).toBeGreaterThan(order.indexOf('std-b'));
  });
});

describe('useTasks — sk-118 standing top-band through the relevance/search branch', () => {
  test('search mode (sort=relevance, clientSort skipped) still floats standing to the top', async () => {
    // RRF returns rows ranked by score; the TOP-scored row is a plain open
    // hit, with standing rows ranked lower. partitionStanding must STILL
    // pull the standing rows above the higher-scored open row — proving the
    // partition runs even on the branch where clientSort is bypassed.
    globalSearchSpy.mockResolvedValue(
      searchResponse([
        searchItem('open-top-hit', 'open', { score: 9 }),
        searchItem('std-x', 'standing', { score: 5 }),
        searchItem('open-mid', 'open', { score: 4 }),
        searchItem('std-y', 'standing', { score: 1 }),
      ]),
    );
    render(
      <Wrapper>
        <Harness sort="relevance" search="gateway" />
      </Wrapper>,
    );
    await waitFor(() => expect(lastResult?.searchMode).toBe(true));
    await waitFor(() => expect(lastResult?.data?.length).toBe(4));

    // Both standing rows lead despite the open hit's higher RRF score.
    expect(leadingStandingCount(lastResult)).toBe(2);
    const order = ids(lastResult);
    expect(order.slice(0, 2).sort()).toEqual(['std-x', 'std-y']);
    // The higher-scored open hit is demoted below the standing band.
    expect(order.indexOf('open-top-hit')).toBeGreaterThan(order.indexOf('std-x'));
    expect(order.indexOf('open-top-hit')).toBeGreaterThan(order.indexOf('std-y'));
  });
});
