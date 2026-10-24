/**
 * sk-421.1 T012 — review fix F-2: `dependenciesStatus` after a failed
 * BACKGROUND refetch.
 *
 * TanStack keeps the last data on a failed refetch but sets the query's
 * `status` to `'error'` unconditionally. The card reads `dependenciesStatus`
 * to decide «not received / failed / received»; passing the raw status
 * through would degrade a card that still holds a real list (parent segment,
 * blocker links) into «failed to load». The hook's contract: a held list is
 * `'success'`; `'error'` only when nothing is held.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { DependencyList } from '../../api/dependencies';
import type { IssueDetail } from '../../api/issues';

const { listDependenciesSpy } = vi.hoisted(() => ({ listDependenciesSpy: vi.fn() }));

const PROJECT = 'proj-deps';
const ISSUE_ID = 'sk-88';

vi.mock('../../api/issues', async (importActual) => {
  const actual = await importActual<typeof import('../../api/issues')>();
  return {
    ...actual,
    getIssue: () =>
      Promise.resolve({
        id: ISSUE_ID,
        projectId: PROJECT,
        version: 1,
        title: 't',
        status: 'open',
        blockers: [],
        isBlocked: false,
      } as unknown as IssueDetail),
    listComments: () => Promise.resolve([]),
  };
});
vi.mock('../../api/dependencies', () => ({
  listDependencies: listDependenciesSpy,
}));
vi.mock('../../api/activity', () => ({
  listIssueActivity: () => Promise.resolve({ items: [], nextCursor: null }),
}));
vi.mock('../../api/attachments', () => ({
  listAttachments: () => Promise.resolve({ items: [] }),
}));
vi.mock('../../api/watchers', () => ({
  listIssueWatchers: () => Promise.resolve([]),
}));
vi.mock('../../components/Toaster', () => ({
  useToaster: () => ({ error: vi.fn(), success: vi.fn() }),
}));

import { issueDependenciesKey, useIssueDetail } from '../useIssueDetail';

const RECEIVED: DependencyList = {
  outgoing: [
    {
      type: 'parent-child',
      fromId: ISSUE_ID,
      toId: 'sk-80',
      version: 1,
      createdAt: '2026-01-01T00:00:00Z',
      metadata: {},
      issue: {
        id: 'sk-80',
        projectId: PROJECT,
        title: 'Parent',
        status: 'open',
        priority: 2,
        type: 'epic',
      },
    },
  ],
  incoming: [],
};

beforeEach(() => {
  listDependenciesSpy.mockReset();
});

afterEach(cleanup);

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    () => useIssueDetail({ issueId: ISSUE_ID, projectHandle: PROJECT }),
    { wrapper },
  );
  return { qc, ...hook };
}

describe('dependenciesStatus — a held list survives a failed background refetch (review F-2)', () => {
  test('received, then the refetch fails → still success, the received list is kept', async () => {
    listDependenciesSpy.mockResolvedValueOnce(RECEIVED);
    const { qc, result } = mount();

    await waitFor(() => expect(result.current.dependenciesStatus).toBe('success'));
    expect(result.current.dependencies).toEqual(RECEIVED);

    // A live event resets the list; the refetch fails.
    listDependenciesSpy.mockRejectedValueOnce(new Error('network down'));
    await act(async () => {
      await qc
        .invalidateQueries({ queryKey: issueDependenciesKey(PROJECT, ISSUE_ID) })
        .catch(() => undefined);
    });
    // The refetch really ran and really failed underneath.
    await waitFor(() => expect(listDependenciesSpy).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(qc.getQueryState(issueDependenciesKey(PROJECT, ISSUE_ID))?.status).toBe('error'),
    );

    expect(result.current.dependenciesStatus).toBe('success');
    expect(result.current.dependencies).toEqual(RECEIVED);
  });

  test('the first read fails with nothing held → error', async () => {
    listDependenciesSpy.mockRejectedValueOnce(new Error('network down'));
    const { result } = mount();

    await waitFor(() => expect(result.current.dependenciesStatus).toBe('error'));
    expect(result.current.dependencies).toBeUndefined();
  });
});
