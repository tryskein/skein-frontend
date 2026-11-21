/**
 * The check of whose session the cookie holds before the logout after an
 * account deletion (spec "Ways a session ends", US-5).
 *
 * Expected: only the status 401 says no session is left; only 200 with a
 * user object carrying an id names a session; 204, 200 with JSON `null`,
 * 200 without an id, another status and no answer are unknown.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import { checkSessionApi } from './auth';

afterEach(() => {
  vi.unstubAllGlobals();
});

function answering(response: () => Response | Promise<Response>): void {
  vi.stubGlobal('fetch', vi.fn(async () => response()));
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('GET /api/auth/me as the check before clearing the cookie', () => {
  test.each([
    { case: '401', response: () => new Response(null, { status: 401 }), expected: { kind: 'none' } },
    { case: '200 with a user', response: () => json(200, { id: 'u-1', email: 'u@example.test' }), expected: { kind: 'user', id: 'u-1' } },
    { case: '204', response: () => new Response(null, { status: 204 }), expected: { kind: 'unknown' } },
    { case: '200 with JSON null', response: () => json(200, null), expected: { kind: 'unknown' } },
    { case: '200 without an id', response: () => json(200, { email: 'u@example.test' }), expected: { kind: 'unknown' } },
    { case: '500', response: () => json(500, { error: 'internal' }), expected: { kind: 'unknown' } },
    { case: 'no answer (network)', response: () => Promise.reject(new TypeError('Failed to fetch')), expected: { kind: 'unknown' } },
  ])('$case → $expected.kind', async ({ response, expected }) => {
    answering(response);
    expect(await checkSessionApi()).toEqual(expected);
  });
});
