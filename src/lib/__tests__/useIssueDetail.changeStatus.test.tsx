/**
 * sk-118 (F5) — REAL regression test for `useIssueDetail.changeStatus()`.
 *
 * The retire-guard test in DetailsHeader.test.tsx hands the component a
 * MOCKED `onChangeStatus` that already returns `{ error }`, so it cannot
 * catch a regression where the HOOK itself swallows a rejected
 * transition and returns `null`. That is the exact F5 bug: the
 * reason-required retire dialog branches on the `{ error }` wrapper to
 * keep its modal open and render the standing-children guard — if
 * `changeStatus` ever reverts to `return null` on error, the dialog
 * closes silently and the guard never shows.
 *
 * These tests pin the contract AT THE SOURCE by mounting the real hook
 * (renderHook + QueryClient) and mocking the `transitionStatus` API call
 * to REJECT with a BusinessError. We assert `changeStatus` resolves to
 * the typed `{ error }` result carrying that BusinessError — NOT `null`,
 * and NOT throwing. A success path (resolves to IssueDetail) is asserted
 * too so the wrapper isn't conflating the two.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { renderHook, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import type {
  IssueDetail,
  IssueStatus,
  TransitionCloseInput,
} from '../../api/issues';
import { BusinessError } from '../../api/client';
import {
  useIssueDetail,
  issueDetailKey,
  isStatusChangeFailure,
} from '../useIssueDetail';

// ── Spy the API surface the mutation calls. We only need transitionStatus
//    + getIssue; everything else is forwarded to the real module so the
//    sub-queries (comments/attachments/etc.) don't blow up on import. They
//    stay disabled / resolve to whatever the real fns return — irrelevant
//    to changeStatus, which never reads them. ──────────────────────────
const transitionStatusSpy =
  vi.fn<
    (
      project: string,
      id: string,
      expectedVersion: number,
      status: IssueStatus,
      reason?: string,
      force?: boolean,
      // sk-489 (T013) — the outcome and the close target.
      close?: TransitionCloseInput,
    ) => Promise<IssueDetail>
  >();
const getIssueSpy = vi.fn<(project: string, id: string) => Promise<IssueDetail>>();

vi.mock('../../api/issues', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/issues')>();
  return {
    ...actual,
    getIssue: (...args: [string, string]) => getIssueSpy(...args),
    transitionStatus: (
      ...args: [
        string,
        string,
        number,
        IssueStatus,
        (string | undefined)?,
        (boolean | undefined)?,
        (TransitionCloseInput | undefined)?,
      ]
    ) => transitionStatusSpy(...args),
    // Keep the comments sub-query off the network — it's irrelevant to
    // changeStatus but the hook fires it (enabled when project+id set).
    listComments: () => Promise.resolve([]),
  };
});

// The hook fires several side-channel queries (comments / attachments /
// deps / watchers / activity) from other modules. Stub them to resolve
// empty so nothing throws — they're disabled in practice but a defensive
// stub keeps the test hermetic regardless of `enabled` evaluation order.
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

// listComments lives in api/issues (already spread above) — stub it via the
// same factory so it doesn't hit the network.
vi.mock('../../components/Toaster', () => ({
  useToaster: () => ({ error: vi.fn(), success: vi.fn() }),
}));

const ISSUE_ID = 'sk-42';
const PROJECT = 'sk';

function makeIssue(over: Partial<IssueDetail> = {}): IssueDetail {
  return {
    id: ISSUE_ID,
    projectId: 'proj-uuid',
    version: 7,
    title: 'standing task',
    description: '',
    type: 'task',
    priority: 3,
    status: 'standing',
    pinned: false,
    source: 'human',
    design: '',
    acceptanceCriteria: '',
    notes: '',
    createdBy: 'u-1',
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
    ...over,
  };
}

function childErr() {
  return new BusinessError(
    422,
    'cannot retire (close) a standing task while it still has non-closed children',
    'standing_has_open_children',
    { childIds: ['sk-42.3', 'sk-42.5'] },
  );
}

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  // Seed the issue-detail cache so changeStatus can resolve the canonical
  // version (it reads qc.getQueryData before mutating). Without this, the
  // wrapper short-circuits to its "issue not loaded" null branch and the
  // mutation never fires — we'd be testing the wrong path.
  client.setQueryData<IssueDetail>(issueDetailKey(ISSUE_ID), makeIssue());
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

beforeEach(() => {
  transitionStatusSpy.mockReset();
  getIssueSpy.mockReset();
  // getIssue is only invoked by the (disabled-but-defensive) detail query;
  // seed it so any stray call returns the same detail rather than throwing.
  getIssueSpy.mockResolvedValue(makeIssue());
});

afterEach(() => cleanup());

describe('useIssueDetail.changeStatus — F5 typed-error contract at the source', () => {
  test('a REJECTED transition (BusinessError) resolves to { error } — NOT null, NOT a throw', async () => {
    const err = childErr();
    transitionStatusSpy.mockRejectedValue(err);
    const { wrapper } = makeWrapper();

    const { result } = renderHook(
      () => useIssueDetail({ issueId: ISSUE_ID, projectHandle: PROJECT }),
      { wrapper },
    );

    // changeStatus must not throw — it wraps the rejection.
    const outcome = await result.current.changeStatus('closed', 'retiring');

    expect(transitionStatusSpy).toHaveBeenCalledTimes(1);
    // The version captured from cache (7) must reach the wire as expectedVersion.
    //
    // First argument is the issue's canonical projectId ('proj-uuid' from
    // the seeded cache), NOT the handle passed to the hook. Mutations
    // switched to the echoed projectId when the cross-project read landed:
    // an issue opened by id alone has no handle at all, and the REST route
    // parses {projectID} strictly as a UUID — sending the alias would be a
    // 400 in real life. The handle stays as the fallback until the detail
    // response arrives.
    // sk-489 (T013) — the seventh is the outcome and the close target
    // (`TransitionCloseInput`). They were not passed here, and the hook must
    // pass on exactly "not asked" (`undefined`), not
    // substitute "done" on its own: the transition default belongs to
    // the server, and a client substituting it itself would, on an old api, have got
    // a refusal where closing passes today (US-10).
    expect(transitionStatusSpy).toHaveBeenCalledWith(
      'proj-uuid',
      ISSUE_ID,
      7,
      'closed',
      'retiring',
      undefined,
      undefined,
    );

    // The exact F5 contract: a typed { error } wrapper, never null.
    expect(outcome).not.toBeNull();
    expect(isStatusChangeFailure(outcome)).toBe(true);
    const failure = outcome as { error: Error };
    // The SAME BusinessError instance is surfaced (code + childIds intact)
    // so the retire dialog can render the standing-children guard.
    expect(failure.error).toBe(err);
    expect(failure.error).toBeInstanceOf(BusinessError);
    expect((failure.error as BusinessError).code).toBe('standing_has_open_children');
    expect((failure.error as BusinessError).extra.childIds).toEqual(['sk-42.3', 'sk-42.5']);
  });

  test('a non-Error rejection is still surfaced as { error } (wrapped), never null', async () => {
    transitionStatusSpy.mockRejectedValue('boom-string');
    const { wrapper } = makeWrapper();

    const { result } = renderHook(
      () => useIssueDetail({ issueId: ISSUE_ID, projectHandle: PROJECT }),
      { wrapper },
    );

    const outcome = await result.current.changeStatus('closed', 'retiring');

    expect(outcome).not.toBeNull();
    expect(isStatusChangeFailure(outcome)).toBe(true);
    expect((outcome as { error: Error }).error).toBeInstanceOf(Error);
    expect((outcome as { error: Error }).error.message).toBe('boom-string');
  });

  test('a SUCCESSFUL transition resolves to the IssueDetail (and writes it to cache)', async () => {
    const closed = makeIssue({ status: 'closed', version: 8 });
    transitionStatusSpy.mockResolvedValue(closed);
    const { wrapper, client } = makeWrapper();

    const { result } = renderHook(
      () => useIssueDetail({ issueId: ISSUE_ID, projectHandle: PROJECT }),
      { wrapper },
    );

    const outcome = await result.current.changeStatus('closed', 'retiring');

    // Success path: the resolved value is the IssueDetail, not a failure wrapper.
    expect(isStatusChangeFailure(outcome)).toBe(false);
    expect(outcome).toMatchObject({ id: ISSUE_ID, status: 'closed', version: 8 });

    // onSuccess writes the canonical server detail back to the cache.
    await waitFor(() => {
      expect(
        client.getQueryData<IssueDetail>(issueDetailKey(ISSUE_ID))?.status,
      ).toBe('closed');
    });
  });

  // sk-489 (test plan, row 55) — the outcome and target collected by the modal
  // reach the api call unchanged.
  //
  // The hook is the only link between the modal and `transitionStatus`, and
  // it can be lost here silently: the outcome choice in the modal keeps working,
  // closing passes, and the task closes as "done" instead of the chosen one.
  // The rule "`done` does not go on the wire" lives NOT here but in the api layer
  // (row 52) — the hook must pass exactly what it received.
  test('sk-489 — the outcome and target reach transitionStatus as is', async () => {
    transitionStatusSpy.mockResolvedValue(makeIssue({ status: 'closed', version: 8 }));
    const { wrapper } = makeWrapper();

    const { result } = renderHook(
      () => useIssueDetail({ issueId: ISSUE_ID, projectHandle: PROJECT }),
      { wrapper },
    );

    await result.current.changeStatus('closed', 'duplicate', undefined, {
      closeOutcome: 'duplicate',
      closeTarget: 'sk-7',
    });

    expect(transitionStatusSpy).toHaveBeenCalledWith(
      'proj-uuid',
      ISSUE_ID,
      7,
      'closed',
      'duplicate',
      undefined,
      { closeOutcome: 'duplicate', closeTarget: 'sk-7' },
    );
  });

  test('sk-489 — "done" is passed on by the hook, not filtered out by it', async () => {
    // Filtering out `done` is the api layer's concern (one place for all callers).
    // A hook that decided not to pass "done" would break the `patchIssue` path
    // of editing the outcome on the very next reuse, and would break it silently.
    transitionStatusSpy.mockResolvedValue(makeIssue({ status: 'closed', version: 8 }));
    const { wrapper } = makeWrapper();

    const { result } = renderHook(
      () => useIssueDetail({ issueId: ISSUE_ID, projectHandle: PROJECT }),
      { wrapper },
    );

    await result.current.changeStatus('closed', undefined, undefined, {
      closeOutcome: 'done',
    });

    expect(transitionStatusSpy).toHaveBeenCalledWith(
      'proj-uuid',
      ISSUE_ID,
      7,
      'closed',
      undefined,
      undefined,
      { closeOutcome: 'done' },
    );
  });
});
