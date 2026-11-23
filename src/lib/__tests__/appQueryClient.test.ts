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
import { AUTH_CONFIG_KEY } from '../useAuthConfig';

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

// sk-1048.41 — the 401 that ends the session also drops what the server
// answered for that person, so the next sign-in in the same tab cannot be
// shown the previous person's data from the cache. The anonymous deployment
// config is not session data and stays.
describe('createAppQueryClient — a 401 drops the data of the ended session', () => {
  const TASKS = ['tasks', 'p-1', 'list'];
  const DETAIL = ['issues', 'detail', 'sk-1'];
  const CONFIG = { authMode: 'local' };

  function signedInClient() {
    const client = createAppQueryClient();
    client.setQueryData(ME_KEY, USER);
    client.setQueryData(AUTH_CONFIG_KEY, CONFIG);
    client.setQueryData(TASKS, { items: [{ id: 'sk-1' }] });
    client.setQueryData(DETAIL, { id: 'sk-1', title: 'private' });
    return client;
  }

  test.each([
    {
      name: 'a query',
      fail: (client: ReturnType<typeof createAppQueryClient>) => failWith(client, new UnauthorizedError()),
    },
    {
      name: 'a mutation',
      fail: (client: ReturnType<typeof createAppQueryClient>) => client
        .getMutationCache()
        .build(client, { mutationFn: () => Promise.reject(new UnauthorizedError()) })
        .execute(undefined)
        .catch(() => {}),
    },
  ])('a 401 from $name removes the session data and keeps the deployment config', async ({ fail }) => {
    const client = signedInClient();

    await fail(client);

    expect(client.getQueryData(TASKS)).toBeUndefined();
    expect(client.getQueryData(DETAIL)).toBeUndefined();
    expect(client.getQueryData(AUTH_CONFIG_KEY)).toEqual(CONFIG);
    expect(client.getQueryData(ME_KEY)).toBeNull();
  });

  test.each([
    { name: '403', err: new ApiError(403, 'forbidden') },
    { name: '500', err: new ApiError(500, 'boom') },
  ])('a $name keeps the signed-in person\'s data', async ({ err }) => {
    const client = signedInClient();

    await failWith(client, err);

    expect(client.getQueryData(TASKS)).toEqual({ items: [{ id: 'sk-1' }] });
    expect(client.getQueryData(DETAIL)).toEqual({ id: 'sk-1', title: 'private' });
    expect(client.getQueryData(ME_KEY)).toEqual(USER);
  });
});
