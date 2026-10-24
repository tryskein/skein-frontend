/**
 * sk-47.2 — wire-shape tests for the lookupIdBatch client.
 *
 * Verifies the client POSTs `{ ids }` to the FROZEN endpoint
 * `/api/v1/search/lookup-id-batch` and parses the `{ items }` response.
 * The store-side semantics (visibility filtering, found-only rows) live in
 * the backend; here we only assert the wire contract the parallel backend
 * task builds against.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { lookupIdBatch, type SearchItem } from './search';

const ITEM: SearchItem = {
  kind: 'issue',
  id: 'sk-14',
  projectId: 'p-uuid',
  projectName: 'Skein',
  title: 'mock issue',
  snippet: '',
  score: 0,
  exactMatch: true,
  status: 'open',
  priority: 2,
  type: 'task',
  pinned: false,
  assignee: null,
  updatedAt: '2026-05-15T10:00:00Z',
};

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ items: [ITEM] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sk-47.2 lookupIdBatch wire shape', () => {
  test('POSTs to /api/v1/search/lookup-id-batch with { ids } body', async () => {
    const got = await lookupIdBatch(['sk-14', 'demo-2.1']);
    expect(got).toEqual({ items: [ITEM] });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/search/lookup-id-batch');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ ids: ['sk-14', 'demo-2.1'] });
  });

  test('sends JSON content-type (body present → apiFetch sets it)', async () => {
    await lookupIdBatch(['sk-14']);
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
  });

  test('parses the { items } response verbatim', async () => {
    const got = await lookupIdBatch(['sk-14']);
    expect(got.items).toHaveLength(1);
    expect(got.items[0].id).toBe('sk-14');
  });

  test('an empty server response (no rows found) parses to items: []', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const got = await lookupIdBatch(['nope-1', 'nope-2']);
    expect(got.items).toEqual([]);
  });
});
