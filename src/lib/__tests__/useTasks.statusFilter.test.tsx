/**
 * sk-31 wire-mapping test for `useTasks`. Asserts that when the column
 * status filter is set to `'blocked'` the wire request omits `status`
 * and sets `isBlocked=true` instead — that's the new derived semantics.
 *
 * We don't render the full Shell; we render a tiny harness that calls
 * `useTasks` with controlled inputs and inspect the captured wire
 * params via vi.mock on `../api/issues`.
 */

import { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import type {
  ListIssuesParams,
  ListIssuesResult,
  ListMineParams,
  ListAllIssuesParams,
  ListAllIssuesResult,
} from '../../api/issues';

// vi.fn is generic on the function-signature shape; use the explicit
// (...args) => Promise form so both vitest v0.x and v1.x type variants
// accept it.
const listIssuesSpy = vi.fn<(projectId: string, params?: ListIssuesParams) => Promise<ListIssuesResult>>();
const listAllIssuesSpy = vi.fn<(params?: ListAllIssuesParams) => Promise<ListAllIssuesResult>>();
const listCreatedByMeSpy = vi.fn<(params?: ListMineParams) => Promise<ListIssuesResult>>();
const listAssignedToMeSpy = vi.fn<(params?: ListMineParams) => Promise<ListIssuesResult>>();

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

// useProjectByHandle is called inside useTasks to resolve the URL handle
// to a real project UUID. The implementation hits the projects API; we
// stub it to short-circuit straight to a known project.
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

function emptyResult(): ListIssuesResult {
  return { items: [], total: 0, hasMore: false, nextCursor: null };
}

function emptyAllResult(): ListAllIssuesResult {
  return { items: [], total: 0, hasMore: false, nextCursor: null };
}

beforeEach(() => {
  listIssuesSpy.mockReset();
  listAllIssuesSpy.mockReset();
  listCreatedByMeSpy.mockReset();
  listAssignedToMeSpy.mockReset();
  listIssuesSpy.mockResolvedValue(emptyResult());
  listAllIssuesSpy.mockResolvedValue(emptyAllResult());
  listCreatedByMeSpy.mockResolvedValue(emptyResult());
  listAssignedToMeSpy.mockResolvedValue(emptyResult());
});

afterEach(() => {
  cleanup();
});

function Harness({ statusFilter }: { statusFilter: 'blocked' | 'open' }) {
  useTasks({
    selectedProject: 'test',
    selectedComponent: null,
    outboxMode: false,
    onMeMode: false,
    statusFilter,
    originFilter: 'all',
    typeFilter: 'all',
    priorityFilter: 'all',
    search: '',
    sort: 'priority-updated',
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

describe('useTasks — sk-31 statusFilter=blocked wire mapping', () => {
  test('translates statusFilter=blocked to isBlocked=true on listIssues', async () => {
    render(
      <Wrapper>
        <Harness statusFilter="blocked" />
      </Wrapper>,
    );
    await waitFor(() => {
      expect(listIssuesSpy).toHaveBeenCalled();
    });
    const [, params] = listIssuesSpy.mock.calls[0];
    expect(params?.isBlocked).toBe(true);
    // Wire status param must be undefined so the EXISTS predicate is the
    // only narrowing rule — backend doesn't have a 'blocked' wire status
    // any more.
    expect(params?.status).toBeUndefined();
  });

  test('non-blocked statusFilter passes through to wire status', async () => {
    render(
      <Wrapper>
        <Harness statusFilter="open" />
      </Wrapper>,
    );
    await waitFor(() => {
      expect(listIssuesSpy).toHaveBeenCalled();
    });
    const [, params] = listIssuesSpy.mock.calls[0];
    expect(params?.isBlocked).toBeUndefined();
    expect(params?.status).toEqual(['open']);
  });
});
