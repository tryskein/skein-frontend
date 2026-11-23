/**
 * The Inbox query (F3, Sc1; the docblock of `useInbox`): open issues from
 * other people, assigned to the caller and not yet accepted —
 * assignee = me ∧ createdBy ≠ me ∧ accepted_at IS NULL ∧ status = open.
 *
 * Those four conditions are the server's to apply, so what the client owns
 * is the request it sends: `GET /api/v1/me/assigned-to` (assignee = me) with
 * `acceptedAt=null`, `status=open` and `createdBy=not-me` (the wire values of
 * `buildMineQuery`). The stub below answers only a request that carries all
 * of them; any other request is a 400, as the server answers an unknown
 * filter, so a lost filter shows both in the URL and as a failed column.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useInbox } from './useInbox';

const fetchSpy = vi.fn<typeof fetch>();

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const INBOX_FILTERS = { acceptedAt: 'null', status: 'open', createdBy: 'not-me' };

beforeEach(() => {
  fetchSpy.mockReset();
  fetchSpy.mockImplementation(async (input) => {
    const url = new URL(String(input), 'http://skein.test');
    const filtered =
      url.pathname === '/api/v1/me/assigned-to' &&
      Object.entries(INBOX_FILTERS).every(([k, v]) => url.searchParams.get(k) === v);
    if (!filtered) return json({ error: 'unexpected request' }, 400);
    return json({
      items: [{ id: 'sk-7', title: 'From bob', status: 'open', assignee: 'ann', acceptedAt: null }],
      nextCursor: null,
      hasMore: false,
    });
  });
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return renderHook(() => useInbox(), { wrapper });
}

describe('the Inbox query', () => {
  test('asks for open, unaccepted issues assigned to me by other people', async () => {
    const view = mount();

    await waitFor(() => expect(view.result.current.isSuccess).toBe(true));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetchSpy.mock.calls[0][0]), 'http://skein.test');
    expect(url.pathname).toBe('/api/v1/me/assigned-to');
    expect(Object.fromEntries(['acceptedAt', 'status', 'createdBy'].map((k) => [k, url.searchParams.get(k)]))).toEqual(
      INBOX_FILTERS,
    );
    expect(view.result.current.data?.items.map((i) => i.id)).toEqual(['sk-7']);
  });
});
