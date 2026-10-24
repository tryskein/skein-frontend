/**
 * sk-34 — wire-shape tests for dismissIssue / undismissIssue.
 *
 * Verifies the client posts to the right endpoint (non-project-scoped,
 * empty body, POST) and parses the IssueDetail response. The wire shape
 * is the only thing that matters here — the store-side semantics
 * (idempotency, sticky-unwatch, event emission) live in the backend
 * integration tests.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { dismissIssue, undismissIssue, type IssueDetail } from './issues';

const ISSUE: IssueDetail = {
  id: 'sk-99',
  projectId: 'p-uuid',
  version: 3,
  title: 'mock',
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
  previousAssignees: ['u-2'],
  dismissedBy: ['u-2'],
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

describe('sk-34 dismissIssue / undismissIssue wire shape', () => {
  test('dismissIssue POSTs to /api/v1/issues/{id}/dismiss without body', async () => {
    const got = await dismissIssue('sk-99');
    expect(got).toEqual(ISSUE);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/issues/sk-99/dismiss');
    expect(init.method).toBe('POST');
    // No body — backend doesn't take any parameters beyond the path id.
    expect(init.body).toBeUndefined();
  });

  test('undismissIssue POSTs to /api/v1/issues/{id}/undismiss', async () => {
    const got = await undismissIssue('sk-99');
    expect(got).toEqual(ISSUE);

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/issues/sk-99/undismiss');
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
  });

  test('id is URI-encoded so hierarchical ids with dots survive', async () => {
    await dismissIssue('demo-42.1');
    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/issues/demo-42.1/dismiss');
  });
});
