/**
 * sk-551.32 — the fold remembers the filter the sliver widened from
 * ACROSS the loading state that widening causes.
 *
 * Reference — acceptance of sk-551.32: folding is the reverse of a click on the strip.
 * Defect (codex review): a click on the strip changes the filter → a new key
 * of the tasks query → while the `all` result loads, the Tasks column draws
 * "loading" instead of the board → the board is unmounted, and the memory of the previous
 * filter was lost: folding returned `active`, not the original `open`.
 *
 * So here is a real Shell and a real query lifecycle:
 * `useTasks` is replaced by a thin wrapper over `useQuery` whose key is the status
 * filter, and the test releases the answer for each filter itself. The harness of the network
 * hooks is as in `WorkspaceSplit.test.tsx`.
 */

import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';

vi.mock('../../../auth/AuthContext', () => ({
  useAuthOptional: () => null,
  useAuth: () => ({
    user: {
      id: 'u-1',
      email: 'admin@test.com',
      username: 'admin',
      name: 'Admin',
      role: 'admin',
      createdAt: null,
      lastLoginAt: null,
    },
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

const ITEMS = [
  {
    id: 'sk-1',
    projectId: 'p1',
    parentIdCurrent: null,
    version: 1,
    title: 'One',
    type: 'task',
    priority: 3,
    status: 'open',
    pinned: false,
    componentIds: [],
    labels: [],
    assignee: null,
    updatedAt: '2026-05-01T10:00:00Z',
    createdAt: '2026-05-01T09:00:00Z',
  },
];

/** One gate per status filter: the response for it lands when released. */
const gates = new Map<string, { promise: Promise<void>; release: () => void }>();
function gate(filter: string) {
  let g = gates.get(filter);
  if (!g) {
    let release = () => {};
    const promise = new Promise<void>((r) => {
      release = r;
    });
    g = { promise, release };
    gates.set(filter, g);
  }
  return g;
}

vi.mock('../../../lib/useTasks', async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return {
    ...actual,
    useTasks: (args: { statusFilter: string }) => {
      const q = useQuery({
        queryKey: ['fold-lifecycle-tasks', args.statusFilter],
        queryFn: async () => {
          await gate(args.statusFilter).promise;
          return ITEMS;
        },
      });
      return {
        data: q.data,
        tree: null,
        total: q.data?.length ?? 0,
        totalIsExact: true,
        hasNextPage: false,
        isFetchingNextPage: false,
        fetchNextPage: () => {},
        isLoading: q.isPending,
        error: null,
        emptyReason: null,
        searchDegraded: false,
        loadedAssignees: [],
        delegateeAssignees: [],
        resolvedProjectId: 'p1',
        min: null,
        max: null,
        sort: null,
      };
    },
  };
});

vi.mock('../../../lib/useInbox', () => ({
  inboxQueryKey: ['inbox', 'assigned-to-me-unaccepted-open'] as const,
  useInbox: () => ({
    data: { items: [], hasMore: false, nextCursor: null },
    isLoading: false,
    isError: false,
    isSuccess: true,
    error: null,
  }),
}));

vi.mock('../../../lib/useProjectsList', () => ({
  projectsListQueryKey: ['projects', 'list', 'shell'] as const,
  useProjectsList: () => ({
    data: { items: [], total: 0, hasMore: false, nextCursor: null },
    isLoading: false,
    isError: false,
    isSuccess: true,
    error: null,
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

vi.mock('../../../lib/useNotificationCounts', () => ({
  notificationCountsKey: ['notification-counts'] as const,
  useNotificationCounts: () => ({
    counts: {
      inbox: 0,
      outbox: 0,
      mentions: 0,
      watching: 0,
      onMeOpenCount: 0,
      delegatedOpenCount: 0,
    },
    isLoading: false,
    error: null,
  }),
}));

import { Shell } from '../Shell';
import i18n from '../../../i18n/config';

const STATUS_KEY = 'skein.tasks.statusFilter';

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } },
  });
  return (
    <MantineProvider forceColorScheme="dark">
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/projects/alpha']}>
          <Routes>
            <Route path="/projects/:alias" element={children} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>
  );
}

const unfoldName = (name: string) => i18n.t('tasks:kanban.showAllStatusesFor', { name });
const foldName = (name: string) => i18n.t('tasks:kanban.foldColumn', { name });

async function release(filter: string) {
  await act(async () => {
    gate(filter).release();
  });
}

beforeEach(() => {
  window.localStorage.clear();
  gates.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('sk-551.32 — the fold survives the loading state the widening causes', () => {
  test('open → sliver → loading → all → fold puts back open, not the default', async () => {
    window.localStorage.setItem('skein.tasks.view', 'kanban');
    window.localStorage.setItem(STATUS_KEY, 'open');
    render(
      <Wrapper>
        <Shell />
      </Wrapper>,
    );
    await release('open');
    fireEvent.click(await screen.findByRole('button', { name: unfoldName('Done') }));

    // The widened result is not cached yet: the board gives way to the
    // loading state — it is unmounted, not merely re-rendered.
    expect(screen.queryByRole('region', { name: /Done/ })).toBeNull();
    await release('all');

    // `open` hid In progress too: under the remembered filter it folds;
    // under the `active` fallback it would not.
    expect(
      await screen.findByRole('button', { name: foldName('In progress') }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: foldName('Done') }));
    expect(window.localStorage.getItem(STATUS_KEY)).toBe('open');
    expect(
      await screen.findByRole('button', { name: unfoldName('In progress') }),
    ).toBeTruthy();
  });
});
