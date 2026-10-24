/**
 * sk-303.14 (T030) — wire shape of the two contract-C1 operations.
 *
 * These two functions exist BECAUSE of two rules that live in the shape of
 * the request and nowhere else, so the shape is what gets pinned:
 *
 *   - the flag PATCH carries the flag AND NOTHING ELSE. A body that mixes it
 *     with any ordinary field is refused by the server with 400 (the form
 *     check that stops such a request from applying half of itself), so a
 *     stray extra key here is a request that can only ever fail;
 *   - both operations PRESENT the current version — the flag through
 *     `If-Match`, exactly like an ordinary edit, the mark through the body,
 *     exactly like `/accept`. The server verifies it and does not increment
 *     it (INV-2), which is why the version has to be sent even though the
 *     answer never moves it.
 *
 * The store-side semantics (who may do it, when it is refused, idempotence
 * of a repeated mark) live in the backend integration tests.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { markReviewed, setReviewRequired, type IssueDetail } from './issues';

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
  reviewRequired: true,
};

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(ISSUE), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('setReviewRequired — the flag, alone, under If-Match', () => {
  test('PATCHes the issue with ONLY the flag in the body', async () => {
    const got = await setReviewRequired('p-uuid', 'sk-99', 7, false);
    expect(got).toEqual(ISSUE);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/projects/p-uuid/issues/sk-99');
    expect(init.method).toBe('PATCH');

    // The body is enumerated, not merely checked for the flag: a mixed body
    // is a 400 from the server, and "contains reviewRequired" would pass on
    // one. This is the assertion that fails when someone adds a field.
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(['reviewRequired']);
    expect(body.reviewRequired).toBe(false);
  });

  test('turning the flag back ON is the same request with true', async () => {
    await setReviewRequired('p-uuid', 'sk-99', 7, true);
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(['reviewRequired']);
    expect(body.reviewRequired).toBe(true);
  });

  test('the version travels in If-Match, as on any ordinary edit', async () => {
    await setReviewRequired('p-uuid', 'sk-99', 7, false);
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['If-Match']).toBe('7');
  });

  test('hierarchical ids survive the path', async () => {
    await setReviewRequired('p-uuid', 'demo-42.1', 2, true);
    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/projects/p-uuid/issues/demo-42.1');
  });
});

describe('markReviewed — its own route, version in the body', () => {
  test('POSTs to the issue’s /review with the expected version', async () => {
    const got = await markReviewed('p-uuid', 'sk-99', 7);
    expect(got).toEqual(ISSUE);

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/projects/p-uuid/issues/sk-99/review');
    expect(init.method).toBe('POST');

    // Body, not If-Match: this is a point action taken from the card, the
    // same way /accept is, rather than an edit of the resource.
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(['expectedVersion']);
    expect(body.expectedVersion).toBe(7);
    expect((init.headers as Record<string, string>)['If-Match']).toBeUndefined();
  });

  test('hierarchical ids survive the path', async () => {
    await markReviewed('p-uuid', 'demo-42.1', 2);
    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/projects/p-uuid/issues/demo-42.1/review');
  });
});
