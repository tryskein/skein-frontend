/**
 * sk-489 (test plan, row 52) — REQUEST BODIES of the close outcome
 * (US-10, US-11, US-12).
 *
 * A rule that lives in the request shape and nowhere else:
 *
 *   `transitionStatus` on a close with "done" does NOT put the outcome key into
 *   the body; `patchIssue` and `bulkAction` ALWAYS put it there, including
 *   "done".
 *
 * Both halves are needed, and both are equally easy to break in opposite directions:
 *
 *  - "`done` is sent nowhere" — then an outcome edit to "done" (US-12)
 *    turns into a PATCH that changes nothing, and an explicit batch outcome
 *    (US-11) does not override the archiving default "won't do";
 *  - "`done` is sent everywhere" — then a close from the modal with a preselected
 *    "done" against an OLD api gets a refusal: it rejects an unfamiliar request field
 *    as a whole, and the most frequent close path fails in the rollout
 *    window (SC-010).
 *
 * So the body keys are enumerated exactly (`Object.keys`) instead of
 * checked for presence: "the body contains closeOutcome" stays green even
 * when it contains it one time too many.
 *
 * The shape model is `api/issues.review.test.ts`; it enumerates keys the same
 * way, but its own key is always sent, and it does not touch the bodies of `transitionStatus` /
 * `patchIssue` / `bulkAction`.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { bulkAction, patchIssue, transitionStatus, type IssueDetail } from './issues';

const ISSUE: IssueDetail = {
  id: 'sk-99',
  projectId: 'p-uuid',
  version: 3,
  title: 'mock',
  description: '',
  type: 'task',
  priority: 2,
  status: 'closed',
  pinned: false,
  source: 'human',
  design: '',
  acceptanceCriteria: '',
  notes: '',
  createdBy: 'u-1',
  createdAt: '2026-05-15T10:00:00Z',
  updatedAt: '2026-05-15T10:00:00Z',
  metadata: {},
  componentIds: [],
  labels: [],
  commentsCount: 0,
  commitRefs: [],
  mentions: [],
  isBlocked: false,
  blockers: [],
  closeOutcome: 'wont_do',
};

let fetchSpy: ReturnType<typeof vi.fn>;

const jsonResponse = (payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

beforeEach(() => {
  // A new `Response` FOR EVERY call: a body is read once, and one
  // shared object for several requests fails with "Body has already been
  // read" — a test failure, not a code failure.
  fetchSpy = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(ISSUE)));
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The body of the last request as an object. */
function lastBody(): Record<string, unknown> {
  const [, init] = fetchSpy.mock.calls[fetchSpy.mock.calls.length - 1] as [
    string,
    RequestInit,
  ];
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

describe('transitionStatus — "done" does not go on the wire (US-10, SC-010)', () => {
  test('close with "done": the body is the status only, WITHOUT the closeOutcome key', async () => {
    await transitionStatus('p-uuid', 'sk-99', 7, 'closed', undefined, undefined, {
      closeOutcome: 'done',
    });
    // An enumeration, not the absence of one key: the body of this request
    // must pass on an api that knows nothing about the outcome, and it rejects
    // ANY unfamiliar field.
    expect(Object.keys(lastBody())).toEqual(['status']);
  });

  test('close with "will not do": the outcome key is present', async () => {
    await transitionStatus('p-uuid', 'sk-99', 7, 'closed', undefined, undefined, {
      closeOutcome: 'wont_do',
    });
    const body = lastBody();
    expect(Object.keys(body).sort()).toEqual(['closeOutcome', 'status']);
    expect(body.closeOutcome).toBe('wont_do');
  });

  test('the target goes only when given', async () => {
    await transitionStatus('p-uuid', 'sk-99', 7, 'closed', undefined, undefined, {
      closeOutcome: 'duplicate',
    });
    expect(Object.keys(lastBody()).sort()).toEqual(['closeOutcome', 'status']);

    await transitionStatus('p-uuid', 'sk-99', 7, 'closed', undefined, undefined, {
      closeOutcome: 'duplicate',
      closeTarget: 'sk-7',
    });
    const withTarget = lastBody();
    expect(Object.keys(withTarget).sort()).toEqual([
      'closeOutcome',
      'closeTarget',
      'status',
    ]);
    expect(withTarget.closeTarget).toBe('sk-7');
  });

  test('reason and outcome coexist, the former reason behaviour is untouched', async () => {
    await transitionStatus('p-uuid', 'sk-99', 7, 'closed', 'no longer needed', undefined, {
      closeOutcome: 'wont_do',
    });
    const body = lastBody();
    expect(Object.keys(body).sort()).toEqual(['closeOutcome', 'reason', 'status']);
    expect(body.reason).toBe('no longer needed');

    // …and without an outcome the body is exactly the same as before the feature.
    await transitionStatus('p-uuid', 'sk-99', 7, 'closed', 'just a reason');
    expect(Object.keys(lastBody()).sort()).toEqual(['reason', 'status']);
  });

  test('no outcome passed at all — the body as today (board path, US-1)', async () => {
    await transitionStatus('p-uuid', 'sk-99', 7, 'closed');
    expect(Object.keys(lastBody())).toEqual(['status']);
  });

  test('the version still goes in If-Match, the address did not change', async () => {
    await transitionStatus('p-uuid', 'sk-99', 7, 'closed', undefined, undefined, {
      closeOutcome: 'wont_do',
    });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/projects/p-uuid/issues/sk-99/transitions');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['If-Match']).toBe('7');
  });
});

describe('patchIssue — an outcome edit ALWAYS sends it, including "done" (US-12)', () => {
  test('closeOutcome: "done" is present in the body', async () => {
    await patchIssue('p-uuid', 'sk-99', 7, { closeOutcome: 'done' });
    const body = lastBody();
    // Discriminates the "`done` is sent nowhere" error: with the key omitted
    // this would be a PATCH with an empty body, that is an edit that changes
    // nothing.
    expect(Object.keys(body)).toEqual(['closeOutcome']);
    expect(body.closeOutcome).toBe('done');
  });

  test('the outcome and the target go together, under If-Match', async () => {
    await patchIssue('p-uuid', 'sk-99', 7, {
      closeOutcome: 'superseded',
      closeTarget: 'sk-12',
    });
    expect(lastBody()).toEqual({ closeOutcome: 'superseded', closeTarget: 'sk-12' });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/projects/p-uuid/issues/sk-99');
    expect(init.method).toBe('PATCH');
    expect((init.headers as Record<string, string>)['If-Match']).toBe('7');
  });
});

describe('bulkAction — one outcome and one target per batch (US-11)', () => {
  beforeEach(() => {
    fetchSpy.mockImplementation(() =>
      Promise.resolve(jsonResponse({ succeeded: ['sk-1'], failed: [] })),
    );
  });

  test('the "done" outcome in a batch is sent — it overrides the position default', async () => {
    await bulkAction('p-uuid', {
      ids: ['sk-1', 'sk-2'],
      action: 'archive',
      closeOutcome: 'done',
    });
    const body = lastBody();
    // The archiving default of an unclosed non-permanent task is "won't
    // do". An omitted "done" would ask the server for something else.
    expect(Object.keys(body).sort()).toEqual(['action', 'closeOutcome', 'ids']);
    expect(body.closeOutcome).toBe('done');
  });

  test('the outcome and the target per batch', async () => {
    await bulkAction('p-uuid', {
      ids: ['sk-1'],
      action: 'close',
      closeOutcome: 'duplicate',
      closeTarget: 'sk-42',
    });
    expect(lastBody()).toEqual({
      ids: ['sk-1'],
      action: 'close',
      closeOutcome: 'duplicate',
      closeTarget: 'sk-42',
    });
  });

  test('without an outcome the batch body is as before the feature', async () => {
    await bulkAction('p-uuid', { ids: ['sk-1'], action: 'close', reason: 'r' });
    expect(Object.keys(lastBody()).sort()).toEqual(['action', 'ids', 'reason']);
  });
});
