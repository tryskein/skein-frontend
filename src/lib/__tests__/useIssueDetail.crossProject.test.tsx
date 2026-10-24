/**
 * Regression tests for opening an issue when its project is unknown.
 *
 * The bug: `useIssueDetail` gated the detail query on having a project
 * handle, and the only way to get one from a bare `/issues/:id` URL was
 * to parse the id as `{prefix}-{n}` and match the prefix against a
 * project's idPrefix. For ids that don't fit that shape — hash / custom
 * id modes like `fv-other-1fe1d873`, or ids whose prefix stopped
 * matching their project — the parse returned null, the query stayed
 * `enabled: false`, and NO REQUEST WAS EVER SENT. The panel showed
 * "failed to load" forever. Verified against the live stack before the
 * fix: zero detail requests for such an id, five for a counter-mode one.
 *
 * The fix: `GET /api/v1/issues/{id}` (ids are globally unique — the
 * column is the PRIMARY KEY), used whenever no project handle is known.
 * Child queries and mutations then use the projectId echoed by the
 * detail response.
 *
 * These tests pin all three halves of that contract at the hook level.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { renderHook, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import type { IssueDetail, PatchIssueInput } from '../../api/issues';
import { useIssueDetail } from '../useIssueDetail';

const getIssueSpy = vi.fn<(project: string, id: string) => Promise<IssueDetail>>();
const getIssueByIDSpy = vi.fn<(id: string) => Promise<IssueDetail>>();
const patchIssueSpy =
  vi.fn<
    (project: string, id: string, expectedVersion: number, patch: PatchIssueInput) => Promise<IssueDetail>
  >();
const listCommentsSpy = vi.fn<(project: string, id: string) => Promise<[]>>();

vi.mock('../../api/issues', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/issues')>();
  return {
    ...actual,
    getIssue: (...a: [string, string]) => getIssueSpy(...a),
    getIssueByID: (...a: [string]) => getIssueByIDSpy(...a),
    patchIssue: (...a: [string, string, number, PatchIssueInput]) => patchIssueSpy(...a),
    listComments: (...a: [string, string]) => listCommentsSpy(...a),
  };
});

// Side-channel queries the hook fires — stubbed so nothing hits the network.
vi.mock('../../api/activity', () => ({
  listIssueActivity: () => Promise.resolve({ items: [], nextCursor: null }),
}));
vi.mock('../../api/attachments', () => ({
  listAttachments: () => Promise.resolve({ items: [] }),
}));
vi.mock('../../api/dependencies', () => ({
  listDependencies: () => Promise.resolve({ outgoing: [], incoming: [] }),
}));
vi.mock('../../api/watchers', () => ({
  listIssueWatchers: () => Promise.resolve([]),
}));
vi.mock('../../components/Toaster', () => ({
  useToaster: () => ({ error: vi.fn(), success: vi.fn() }),
}));

// Shaped like the ids that exposed the bug: non-numeric hash suffix, and
// a prefix ("fv-other") unrelated to the owning project's idPrefix.
const HASH_ID = 'fv-other-1fe1d873';
const PROJECT_UUID = '55362761-87b3-435b-a7d3-29d1d9491c00';

function makeIssue(over: Partial<IssueDetail> = {}): IssueDetail {
  return {
    id: HASH_ID,
    projectId: PROJECT_UUID,
    version: 1,
    title: 'fv-other-1fe1d873',
    description: '',
    type: 'task',
    priority: 2,
    status: 'open',
    pinned: false,
    source: 'human',
    design: '',
    acceptanceCriteria: '',
    notes: '',
    createdBy: 'u-1',
    createdAt: '2026-08-11T09:19:04Z',
    updatedAt: '2026-08-11T09:19:04Z',
    metadata: {},
    componentIds: [],
    labels: [],
    commentsCount: 0,
    commitRefs: [],
    mentions: [],
    isBlocked: false,
    blockers: [],
    ...over,
  };
}

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  getIssueSpy.mockReset();
  getIssueByIDSpy.mockReset();
  patchIssueSpy.mockReset();
  listCommentsSpy.mockReset();
  getIssueByIDSpy.mockResolvedValue(makeIssue());
  getIssueSpy.mockResolvedValue(makeIssue());
  patchIssueSpy.mockResolvedValue(makeIssue({ version: 2 }));
  listCommentsSpy.mockResolvedValue([]);
});
afterEach(cleanup);

describe('useIssueDetail without a project handle', () => {
  test('fires the cross-project read instead of doing nothing', async () => {
    const { result } = renderHook(
      () => useIssueDetail({ issueId: HASH_ID, projectHandle: null }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.issue).toBeDefined());

    // The regression: this used to be zero calls, forever.
    // sk-421.1 T016 — same id, and the read now hands its cancel signal on.
    expect(getIssueByIDSpy).toHaveBeenCalledWith(
      HASH_ID,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(getIssueSpy).not.toHaveBeenCalled();
    expect(result.current.issue?.id).toBe(HASH_ID);
  });

  test('child queries use the projectId echoed by the detail response', async () => {
    const { result } = renderHook(
      () => useIssueDetail({ issueId: HASH_ID, projectHandle: null }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.issue).toBeDefined());
    // Comments are project-scoped on the wire; the project can only come
    // from the detail response here.
    await waitFor(() => expect(listCommentsSpy).toHaveBeenCalled());
    expect(listCommentsSpy).toHaveBeenCalledWith(PROJECT_UUID, HASH_ID);
  });

  test('mutations target the resolved projectId, not undefined', async () => {
    const { result } = renderHook(
      () => useIssueDetail({ issueId: HASH_ID, projectHandle: null }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.issue).toBeDefined());
    await result.current.updateField({ title: 'renamed' });

    expect(patchIssueSpy).toHaveBeenCalledTimes(1);
    const [projectArg, idArg] = patchIssueSpy.mock.calls[0];
    expect(projectArg).toBe(PROJECT_UUID);
    expect(idArg).toBe(HASH_ID);
  });
});

describe('useIssueDetail with a known project handle', () => {
  test('keeps using the project-scoped route', async () => {
    const { result } = renderHook(
      () => useIssueDetail({ issueId: HASH_ID, projectHandle: PROJECT_UUID }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.issue).toBeDefined());

    // sk-421.1 T016 — same ids, plus the read's cancel signal.
    expect(getIssueSpy).toHaveBeenCalledWith(
      PROJECT_UUID,
      HASH_ID,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(getIssueByIDSpy).not.toHaveBeenCalled();
  });
});
