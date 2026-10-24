/**
 * sk-303.14 (T030) — the two review writes as the HOOK performs them.
 *
 * Contract C1 says both operations present the issue's current version and
 * neither MOVES it: the server verifies and deliberately does not increment,
 * because an assignee with the card open must not be able to see that
 * anything happened (INV-2, SC-028).
 *
 * That has a consequence the card cannot show and the sections cannot test:
 * if the optimistic cache write bumps `version` the way every other mutation
 * in this file's subject does, the cache ends up one ahead of the server and
 * the reader's NEXT ordinary edit fails its `If-Match` — a defect that
 * surfaces far from its cause, on an unrelated save. So the version is
 * pinned here, at the source, on both operations and on both outcomes.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { renderHook, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import type { IssueDetail } from '../../api/issues';
import { BusinessError } from '../../api/client';
import { useIssueDetail, issueDetailKey } from '../useIssueDetail';

const setReviewRequiredSpy =
  vi.fn<
    (project: string, id: string, version: number, required: boolean) => Promise<IssueDetail>
  >();
const markReviewedSpy =
  vi.fn<(project: string, id: string, expectedVersion: number) => Promise<IssueDetail>>();
const getIssueSpy = vi.fn<(project: string, id: string) => Promise<IssueDetail>>();

vi.mock('../../api/issues', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/issues')>();
  return {
    ...actual,
    getIssue: (...args: [string, string]) => getIssueSpy(...args),
    setReviewRequired: (...args: [string, string, number, boolean]) =>
      setReviewRequiredSpy(...args),
    markReviewed: (...args: [string, string, number]) => markReviewedSpy(...args),
    listComments: () => Promise.resolve([]),
  };
});

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

const ISSUE_ID = 'sk-42';
const PROJECT = 'sk';
const VERSION = 7;

function makeIssue(over: Partial<IssueDetail> = {}): IssueDetail {
  return {
    id: ISSUE_ID,
    projectId: 'proj-uuid',
    version: VERSION,
    title: 'delegated task',
    description: '',
    type: 'task',
    priority: 3,
    status: 'closed',
    pinned: false,
    source: 'human',
    design: '',
    acceptanceCriteria: '',
    notes: '',
    createdBy: 'u-author',
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
    metadata: {},
    componentIds: [],
    labels: [],
    commentsCount: 0,
    commitRefs: [],
    mentions: [],
    isBlocked: false,
    blockers: [],
    reviewRequired: true,
    ...over,
  } as IssueDetail;
}

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData<IssueDetail>(issueDetailKey(ISSUE_ID), makeIssue());
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

function cached(client: QueryClient): IssueDetail | undefined {
  return client.getQueryData<IssueDetail>(issueDetailKey(ISSUE_ID));
}

beforeEach(() => {
  setReviewRequiredSpy.mockReset();
  markReviewedSpy.mockReset();
  getIssueSpy.mockReset();
  getIssueSpy.mockResolvedValue(makeIssue());
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('the review writes present the version and never move it', () => {
  test('changeReviewRequired sends the current version and leaves the cache at it', async () => {
    const { client, wrapper } = makeWrapper();
    // The server answers with the SAME version — that is the contract, not a
    // quirk of this stub.
    setReviewRequiredSpy.mockResolvedValue(
      makeIssue({ reviewRequired: false, version: VERSION }),
    );

    const { result } = renderHook(
      () => useIssueDetail({ issueId: ISSUE_ID, projectHandle: PROJECT }),
      { wrapper },
    );

    await result.current.changeReviewRequired(false);

    expect(setReviewRequiredSpy).toHaveBeenCalledWith(PROJECT, ISSUE_ID, VERSION, false);
    await waitFor(() => expect(cached(client)?.reviewRequired).toBe(false));
    // The version the NEXT ordinary edit will present as If-Match.
    expect(cached(client)?.version).toBe(VERSION);
  });

  // The frame IN FLIGHT is the one that matters, and it is not visible in
  // the settled state: the server answer overwrites the cache a moment
  // later, so a bumped version disappears by the time the action resolves —
  // while still having been readable, for the whole round trip, by any
  // concurrent ordinary save that resolves its `If-Match` from this cache.
  //
  // So every frame is recorded, not just the last one, and BOTH operations
  // are put through it: a mutation that bumped the version in only one of
  // the two optimistic writes survived a version of this test that watched
  // only the flag.
  test.each([
    {
      name: 'changeReviewRequired',
      spy: () => setReviewRequiredSpy,
      run: (h: ReturnType<typeof useIssueDetail>) => h.changeReviewRequired(false),
      answer: () => makeIssue({ reviewRequired: false, version: VERSION }),
      applied: (i: IssueDetail | undefined) => i?.reviewRequired === false,
    },
    {
      name: 'markResultReviewed',
      spy: () => markReviewedSpy,
      run: (h: ReturnType<typeof useIssueDetail>) => h.markResultReviewed(),
      answer: () => makeIssue({ reviewedAt: '2026-06-02T00:00:00Z', version: VERSION }),
      applied: (i: IssueDetail | undefined) => Boolean(i?.reviewedAt),
    },
  ])('$name: no frame — in flight or settled — moves the version', async (op) => {
    const { client, wrapper } = makeWrapper();
    let release: (v: IssueDetail) => void = () => {};
    op.spy().mockImplementation(
      () => new Promise<IssueDetail>((resolve) => { release = resolve; }),
    );

    // Record the cached version on EVERY render, not only when we look.
    const versionsSeen: (number | undefined)[] = [];
    const { result } = renderHook(() => {
      const hook = useIssueDetail({ issueId: ISSUE_ID, projectHandle: PROJECT });
      versionsSeen.push(cached(client)?.version);
      return hook;
    }, { wrapper });

    const pending = op.run(result.current);
    // Wait for the optimistic write, then read the in-flight frame directly.
    await waitFor(() => expect(op.applied(cached(client))).toBe(true));
    expect(cached(client)?.version).toBe(VERSION);

    release(op.answer());
    await pending;

    expect(cached(client)?.version).toBe(VERSION);
    // And no frame in between held anything else.
    expect(versionsSeen.filter((v) => v !== undefined)).toEqual(
      versionsSeen.filter((v) => v !== undefined).map(() => VERSION),
    );
  });

  test('markResultReviewed sends the version in the body and leaves it alone', async () => {
    const { client, wrapper } = makeWrapper();
    markReviewedSpy.mockResolvedValue(
      makeIssue({ reviewedAt: '2026-06-02T00:00:00Z', version: VERSION }),
    );

    const { result } = renderHook(
      () => useIssueDetail({ issueId: ISSUE_ID, projectHandle: PROJECT }),
      { wrapper },
    );

    await result.current.markResultReviewed();

    expect(markReviewedSpy).toHaveBeenCalledWith(PROJECT, ISSUE_ID, VERSION);
    await waitFor(() => expect(cached(client)?.reviewedAt).toBeTruthy());
    expect(cached(client)?.version).toBe(VERSION);
  });

  test('a refusal rolls the cache back untouched — flag, mark and version', async () => {
    const { client, wrapper } = makeWrapper();
    markReviewedSpy.mockRejectedValue(
      new BusinessError(
        422,
        'cannot mark reviewed while the review flag is cleared',
        'review_flag_cleared',
      ),
    );

    const { result } = renderHook(
      () => useIssueDetail({ issueId: ISSUE_ID, projectHandle: PROJECT }),
      { wrapper },
    );

    const out = await result.current.markResultReviewed();

    // The refusal is already surfaced by the mutation's toast; the action
    // resolves null rather than throwing, and nothing optimistic survives.
    expect(out).toBeNull();
    await waitFor(() => expect(cached(client)?.reviewedAt).toBeFalsy());
    expect(cached(client)?.reviewRequired).toBe(true);
    expect(cached(client)?.version).toBe(VERSION);
  });
});
