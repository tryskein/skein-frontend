/**
 * sk-1048.28 — `listIssues` filter serialization on the HTTP boundary.
 *
 * The project-scoped list handler (skein-api `GET /api/v1/projects/{id}/issues`)
 * reads `status` as one comma-separated list, `assignee` as a username or the
 * literal `me`, and `createdBy` as exactly `me` or `not-me`. These tests call
 * the real client with `fetch` stubbed and read the URL it actually sent.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { listIssues } from './issues';

const fetchSpy = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchSpy.mockReset();
  fetchSpy.mockImplementation(async () => new Response(JSON.stringify({ items: [], hasMore: false, nextCursor: null }), {
    status: 200, headers: { 'content-type': 'application/json' },
  }));
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => vi.unstubAllGlobals());

function sentUrl(): URL {
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  const [url, init] = fetchSpy.mock.calls[0];
  expect(init?.method ?? 'GET').toBe('GET');
  return new URL(String(url), 'http://localhost');
}

describe('listIssues — query filters on the wire', () => {
  test('sends status as one comma-separated list, assignee verbatim and the createdBy lens', async () => {
    await listIssues('proj-1', {
      status: ['open', 'in_progress'],
      assignee: 'person+tag@example.test',
      createdBy: 'not-me',
    });
    const url = sentUrl();
    expect(url.pathname).toBe('/api/v1/projects/proj-1/issues');
    expect(url.searchParams.getAll('status')).toEqual(['open,in_progress']);
    expect(url.searchParams.getAll('assignee')).toEqual(['person+tag@example.test']);
    expect(url.searchParams.getAll('createdBy')).toEqual(['not-me']);
  });

  test('sends the caller shortcuts assignee=me and createdBy=me', async () => {
    await listIssues('proj-1', { status: ['closed'], assignee: 'me', createdBy: 'me' });
    const query = sentUrl().searchParams;
    expect(query.get('status')).toBe('closed');
    expect(query.get('assignee')).toBe('me');
    expect(query.get('createdBy')).toBe('me');
  });

  test('sends no query string when no filter is given or the status list is empty', async () => {
    await listIssues('proj 1/x');
    await listIssues('proj 1/x', { status: [] });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    for (const [url] of fetchSpy.mock.calls) {
      expect(String(url)).toBe('/api/v1/projects/proj%201%2Fx/issues');
    }
  });
});
