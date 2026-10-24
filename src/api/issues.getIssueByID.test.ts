/**
 * Wire-shape tests for `getIssueByID` — reading an issue when the caller
 * knows only its id.
 *
 * Context: the frontend used to derive the project from the id by parsing
 * it as `{prefix}-{n}` and matching the prefix against a project idPrefix.
 * For ids that don't fit that shape — hash / custom id modes such as
 * `fv-other-1fe1d873`, or ids whose prefix no longer matches their project
 * — the parse returned null and NO request was sent at all: the details
 * panel sat on "failed to load" forever. Verified against the live stack:
 * zero detail requests for such an id, five for a counter-mode one.
 *
 * The fix resolves the project instead of guessing it, over two endpoints
 * that already exist (there is no `GET /api/v1/issues/{id}` on the server —
 * that prefix serves only sub-resources):
 *   1. GET /api/v1/issues?q={id}  — cross-project, visibility-filtered,
 *      exact-id boosted; every row carries its projectId.
 *   2. GET /api/v1/projects/{projectId}/issues/{id} — the normal read.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { getIssue, getIssueByID } from './issues';
import { ApiError } from './client';

const HASH_ID = 'fv-other-1fe1d873';
const PROJECT_UUID = '55362761-87b3-435b-a7d3-29d1d9491c00';

function summaryRow(over: Record<string, unknown> = {}) {
  return {
    id: HASH_ID,
    projectId: PROJECT_UUID,
    version: 1,
    title: HASH_ID,
    type: 'task',
    priority: 2,
    status: 'open',
    pinned: false,
    componentIds: [],
    labels: [],
    isBlocked: false,
    updatedAt: '2026-08-11T09:19:04Z',
    createdAt: '2026-08-11T09:19:04Z',
    ...over,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** URLs the client hit, in order. */
function calledUrls(): string[] {
  return fetchSpy.mock.calls.map((c) => String(c[0]));
}

describe('getIssueByID', () => {
  test('resolves the project from the cross-project list, then reads the issue', async () => {
    fetchSpy
      .mockResolvedValueOnce(jsonResponse({ items: [summaryRow()], nextCursor: null }))
      .mockResolvedValueOnce(jsonResponse(summaryRow({ description: 'body' })));

    const issue = await getIssueByID(HASH_ID);

    expect(issue.id).toBe(HASH_ID);
    const [lookupUrl, readUrl] = calledUrls();
    // Hop 1: cross-project list, filtered by the id itself.
    expect(lookupUrl).toContain('/api/v1/issues?');
    expect(lookupUrl).toContain(`q=${encodeURIComponent(HASH_ID)}`);
    // Hop 2: the ordinary project-scoped read, with the resolved project.
    expect(readUrl).toContain(`/api/v1/projects/${PROJECT_UUID}/issues/${encodeURIComponent(HASH_ID)}`);
  });

  test('matches by exact id, never by "first row returned"', async () => {
    // A substring hit sorts first; opening it instead of the requested id
    // would silently show the user a different issue.
    fetchSpy
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            summaryRow({ id: 'fv-other-1fe1d873-suffix', projectId: 'wrong-project' }),
            summaryRow(),
          ],
          nextCursor: null,
        }),
      )
      .mockResolvedValueOnce(jsonResponse(summaryRow()));

    await getIssueByID(HASH_ID);

    const readUrl = calledUrls()[1];
    expect(readUrl).toContain(`/api/v1/projects/${PROJECT_UUID}/`);
    expect(readUrl).not.toContain('wrong-project');
  });

  test('no matching row → 404 ApiError, and no second request', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ items: [], nextCursor: null }));

    const err = await getIssueByID(HASH_ID).then(
      () => { throw new Error('expected getIssueByID to reject'); },
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ statusCode: 404, code: 'issue_not_found' });
    // Only the lookup ran — nothing was read from a guessed project.
    expect(fetchSpy.mock.calls.length).toBe(1);
  });
});

// ──────── sk-421.1 T016 — row 52: the cancel signal reaches the wire ────────
//
// «A burst of events leaves at most one detail read in flight — on the
// network too» (decision F-2). The read's AbortSignal must be handed to
// EVERY request of the detail read: the one `fetch` of `getIssue`, and both
// hops of `getIssueByID`. A signal that only reaches hop 2 would leave the
// lookup running after a cancel.

describe('detail read — the cancel signal reaches every fetch (row 52)', () => {
  /** The `signal` the n-th fetch call was given, or undefined. */
  function signalOf(call: number): AbortSignal | undefined {
    const init = fetchSpy.mock.calls[call]?.[1] as RequestInit | undefined;
    return init?.signal ?? undefined;
  }

  test('getIssue(…, { signal }) → its fetch receives that same signal', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(summaryRow()));
    const controller = new AbortController();

    await getIssue(PROJECT_UUID, HASH_ID, { signal: controller.signal });

    expect(fetchSpy.mock.calls.length).toBe(1);
    expect(signalOf(0)).toBe(controller.signal);
  });

  test('getIssueByID(…, { signal }) → BOTH fetches (lookup and read) receive that signal', async () => {
    fetchSpy
      .mockResolvedValueOnce(jsonResponse({ items: [summaryRow()], nextCursor: null }))
      .mockResolvedValueOnce(jsonResponse(summaryRow()));
    const controller = new AbortController();

    await getIssueByID(HASH_ID, { signal: controller.signal });

    expect(fetchSpy.mock.calls.length).toBe(2);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/api/v1/issues?');
    expect(signalOf(0)).toBe(controller.signal);
    expect(String(fetchSpy.mock.calls[1][0])).toContain(`/api/v1/projects/${PROJECT_UUID}/issues/`);
    expect(signalOf(1)).toBe(controller.signal);
  });

  test('cancelled before the second hop → the second request never goes out', async () => {
    const controller = new AbortController();
    fetchSpy.mockImplementationOnce(async () => {
      // The cancel lands while hop 1 is answering.
      controller.abort();
      return jsonResponse({ items: [summaryRow()], nextCursor: null });
    });

    const err = await getIssueByID(HASH_ID, { signal: controller.signal }).then(
      () => {
        throw new Error('expected getIssueByID to reject after the cancel');
      },
      (e: unknown) => e,
    );

    expect((err as { name?: string }).name).toBe('AbortError');
    // Only the lookup was sent.
    expect(fetchSpy.mock.calls.length).toBe(1);
  });
});
