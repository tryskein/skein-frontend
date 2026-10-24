/**
 * sk-285.5.5 — wire shape of `listUserDirectory`.
 *
 * `GET /api/v1/users/directory` stopped being an unbounded bare array of
 * every active user and became a bounded, searchable page. These tests pin
 * the two halves of that on the client side: the search term really reaches
 * the wire as `q`, and the response is read out of the `{items, hasMore}`
 * envelope instead of being treated as an array.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { listUserDirectory, type UserDirectoryResult } from './users';

const PAGE: UserDirectoryResult = {
  items: [
    { id: 'u-1', username: 'bob', name: 'Bob Brown' },
    { id: 'u-2', username: 'carol', name: 'Carol Clark' },
  ],
  hasMore: true,
};

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // A fresh Response per call — a Response body can only be read once, and
  // several tests below issue two requests.
  fetchSpy = vi.fn().mockImplementation(
    async () =>
      new Response(JSON.stringify(PAGE), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function calledUrl(): string {
  return (fetchSpy.mock.calls[0] as [string, RequestInit])[0];
}

describe('listUserDirectory — sk-285.5.5 search + paging', () => {
  test('a search term reaches the wire as ?q=', async () => {
    await listUserDirectory({ q: 'ali' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(calledUrl()).toBe('/api/v1/users/directory?q=ali');
  });

  test('q is trimmed, and a blank term is not sent at all', async () => {
    await listUserDirectory({ q: '  ali  ' });
    expect(calledUrl()).toBe('/api/v1/users/directory?q=ali');

    fetchSpy.mockClear();
    await listUserDirectory({ q: '   ' });
    expect(calledUrl()).toBe('/api/v1/users/directory');
  });

  test('special characters in the term are URL-encoded, not injected raw', async () => {
    await listUserDirectory({ q: 'a b&c=d%e' });
    // URLSearchParams renders a space as '+', and escapes & = %.
    expect(calledUrl()).toBe('/api/v1/users/directory?q=a+b%26c%3Dd%25e');
  });

  test('limit is forwarded when asked for', async () => {
    await listUserDirectory({ q: 'x', limit: 10 });
    expect(calledUrl()).toBe('/api/v1/users/directory?q=x&limit=10');
  });

  test('no arguments → no query string (backend applies its default page size)', async () => {
    await listUserDirectory();
    expect(calledUrl()).toBe('/api/v1/users/directory');
  });

  test('the response is read as the {items, hasMore} envelope', async () => {
    const got = await listUserDirectory({ q: 'user' });
    expect(got.items.map((u) => u.username)).toEqual(['bob', 'carol']);
    // hasMore is the completeness signal the bounded page carries — it must
    // survive the client boundary, otherwise the UI silently presents a
    // truncated page as the whole directory.
    expect(got.hasMore).toBe(true);
  });
});
