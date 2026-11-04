import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { globalSearch } from './search';

const fetchSpy = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchSpy.mockReset();
  fetchSpy.mockResolvedValue(new Response(JSON.stringify({
    items: [], hasMore: false, nextCursor: null, degraded: false, tookMs: 0,
  }), { status: 200, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => vi.unstubAllGlobals());

function sentQuery(): URLSearchParams {
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  const [url] = fetchSpy.mock.calls[0];
  return new URL(String(url), 'http://localhost').searchParams;
}

describe('sk-346 — search narrowing on the HTTP boundary', () => {
  test('serializes caller, acceptance, blocked, component and origin selections together', async () => {
    await globalSearch({
      q: 'needle', kind: ['issue'], createdBy: 'me', assignee: 'person+tag@example.test',
      acceptedAt: 'not-null', isBlocked: true, componentId: '11111111-2222-3333-4444-555555555555',
      origin: ['human-driven', 'agent-autonomous'], source: 'agent_directed',
    });
    const query = sentQuery();
    expect(query.get('createdBy')).toBe('me');
    expect(query.get('assignee')).toBe('person+tag@example.test');
    expect(query.get('acceptedAt')).toBe('not-null');
    expect(query.get('isBlocked')).toBe('true');
    expect(query.get('componentId')).toBe('11111111-2222-3333-4444-555555555555');
    expect(query.get('origin')).toBe('human-driven,agent-autonomous');
    expect(query.get('source')).toBe('agent_directed');
  });

  test('preserves false and the null acceptance selection as explicit filters', async () => {
    await globalSearch({ q: 'needle', createdBy: 'not-me', assignee: 'me', acceptedAt: 'null', isBlocked: false });
    const query = sentQuery();
    expect(query.get('createdBy')).toBe('not-me');
    expect(query.get('assignee')).toBe('me');
    expect(query.get('acceptedAt')).toBe('null');
    expect(query.get('isBlocked')).toBe('false');
  });

  test('leaves existing callers unscoped when the new selections are absent', async () => {
    await globalSearch({ q: 'needle', source: 'human', origin: [] });
    const query = sentQuery();
    expect([...query.keys()].sort()).toEqual(['q', 'source']);
    expect(query.get('source')).toBe('human');
  });

  test('exposes an expired cursor through the stable HTTP error code', async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ error: 'invalid_cursor' }), {
      status: 400, headers: { 'content-type': 'application/json' },
    }));
    await expect(globalSearch({ q: 'needle', createdBy: 'me', cursor: 'expired' })).rejects.toMatchObject({
      name: 'ApiError', statusCode: 400, code: 'invalid_cursor',
    });
  });
});
