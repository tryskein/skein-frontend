/**
 * Regression tests for session-death handling.
 *
 * The bug: when the session cookie expired while a tab sat open, the
 * cached `['auth','me']` entry (staleTime: Infinity, never refetched)
 * kept the app believing someone was signed in. RequireAuth stayed
 * satisfied, the shell stayed mounted, and only the data queries 401'd —
 * so the Tasks column rendered "Failed to load tasks" and the user was
 * told the server had failed when in fact they had been signed out.
 * Reproduced live: dropping `skein.sid` and touching a filter left the
 * URL on `/` showing `Tasks 0` + the failure copy.
 *
 * The fix clears the cached user on ANY UnauthorizedError, which is
 * enough because RequireAuth redirects to /login when `user` is falsy.
 * These tests pin the three halves of that contract: it fires, it fires
 * only for 401, and it does not thrash while already signed out.
 */

import { describe, expect, test } from 'vitest';
import { ApiError, BusinessError, UnauthorizedError } from '../../api/client';
import { createAppQueryClient } from '../appQueryClient';
import { ME_KEY } from '../../auth/AuthContext';

const USER = { id: 'u-1', username: 'admin', name: 'Administrator' };

/** Run a query that rejects with `error` and wait for it to settle. */
async function failWith(client: ReturnType<typeof createAppQueryClient>, error: unknown) {
  await client
    .fetchQuery({
      queryKey: ['some', 'data', Math.random()],
      queryFn: () => Promise.reject(error),
      retry: false,
    })
    .catch(() => {});
}

describe('createAppQueryClient — session death routes to sign-out', () => {
  test('a 401 from an unrelated query clears the cached user', async () => {
    const client = createAppQueryClient();
    client.setQueryData(ME_KEY, USER);

    await failWith(client, new UnauthorizedError());

    // null, not undefined: "no session", which is what RequireAuth reads.
    expect(client.getQueryData(ME_KEY)).toBeNull();
  });

  test('a 401 from a mutation clears it too', async () => {
    const client = createAppQueryClient();
    client.setQueryData(ME_KEY, USER);

    await client
      .getMutationCache()
      .build(client, { mutationFn: () => Promise.reject(new UnauthorizedError()) })
      .execute(undefined)
      .catch(() => {});

    expect(client.getQueryData(ME_KEY)).toBeNull();
  });

  test('other failures leave the session alone', async () => {
    const client = createAppQueryClient();

    for (const err of [
      new ApiError(500, 'boom'),
      new ApiError(403, 'forbidden'),
      new BusinessError(422, 'nope', 'some_code'),
      new TypeError('Failed to fetch'), // dead network
    ]) {
      client.setQueryData(ME_KEY, USER);
      await failWith(client, err);
      // Still signed in — a broken server must keep showing its own error
      // instead of pretending the user was logged out.
      expect(client.getQueryData(ME_KEY)).toEqual(USER);
    }
  });

  test('does not rewrite the cache when already signed out', async () => {
    const client = createAppQueryClient();
    client.setQueryData(ME_KEY, null);

    let notifications = 0;
    const unsubscribe = client.getQueryCache().subscribe((event) => {
      if (event.query.queryHash === JSON.stringify(ME_KEY) && event.type === 'updated') {
        notifications++;
      }
    });

    // On /login a stream of 401s is the NORMAL state, not an event.
    await failWith(client, new UnauthorizedError());
    await failWith(client, new UnauthorizedError());

    unsubscribe();
    expect(notifications).toBe(0);
    expect(client.getQueryData(ME_KEY)).toBeNull();
  });
});
