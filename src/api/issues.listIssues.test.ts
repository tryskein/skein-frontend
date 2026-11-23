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

// sk-1048.84 — every other filter of the same handler (`handler/issues.go#List`):
// one value each, `label` repeated, `origin=all` and `unreviewed=false` spelled
// by leaving the parameter out, explicit `false` / `0` kept.
describe('listIssues — the remaining filters on the wire', () => {
  test('sends every filter by its handler name', async () => {
    await listIssues('proj-1', {
      priority: 2,
      parentId: 'sk-7',
      pinned: true,
      text: 'login bug',
      acceptedAtNull: true,
      origin: 'agent-autonomous',
      labels: ['ui', 'auth'],
      componentId: '11111111-2222-3333-4444-555555555555',
      source: 'api',
      sort: 'created',
      isBlocked: true,
      unreviewed: true,
      cursor: 'c-2',
      limit: 50,
    });
    const query = sentUrl().searchParams;
    expect(query.get('priority')).toBe('2');
    expect(query.get('parentId')).toBe('sk-7');
    expect(query.get('pinned')).toBe('true');
    expect(query.get('text')).toBe('login bug');
    expect(query.get('acceptedAt')).toBe('null');
    expect(query.get('origin')).toBe('agent-autonomous');
    expect(query.getAll('label')).toEqual(['ui', 'auth']);
    expect(query.get('componentId')).toBe('11111111-2222-3333-4444-555555555555');
    expect(query.get('source')).toBe('api');
    expect(query.get('sort')).toBe('created');
    expect(query.get('isBlocked')).toBe('true');
    expect(query.get('unreviewed')).toBe('true');
    expect(query.get('cursor')).toBe('c-2');
    expect(query.get('limit')).toBe('50');
  });

  test('keeps explicit false and zero, and spells "accepted" as not-null', async () => {
    await listIssues('proj-1', { priority: 0, pinned: false, isBlocked: false, acceptedAtNotNull: true, limit: 0 });
    const query = sentUrl().searchParams;
    expect(query.get('priority')).toBe('0');
    expect(query.get('pinned')).toBe('false');
    expect(query.get('isBlocked')).toBe('false');
    expect(query.get('acceptedAt')).toBe('not-null');
    expect(query.get('limit')).toBe('0');
  });

  test('leaves out origin=all, unreviewed=false and empty values', async () => {
    await listIssues('proj-1', {
      origin: 'all', unreviewed: false, labels: [], parentId: '', text: '', cursor: null,
    });
    expect([...sentUrl().searchParams.keys()]).toEqual([]);
  });
});
