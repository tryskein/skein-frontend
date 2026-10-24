/**
 * sk-674.18 T050 (review fix No. 7) — a 429 keeps its machine code. The public
 * account routes and the spaces routes answer 429 with `error: "rate_limited"`
 * (BFF ProblemDetails or the API's `{error,message}`); callers branch on the
 * code, so `apiFetch` must not drop it when it turns the answer into a
 * `RateLimitError`.
 */
import { afterEach, expect, test, vi } from 'vitest';
import { apiFetch, RateLimitError } from './client';

afterEach(() => {
  vi.unstubAllGlobals();
});

function answer429(body: unknown): void {
  vi.stubGlobal('fetch', vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status: 429,
      headers: { 'Content-Type': 'application/problem+json' },
    })));
}

test.each([
  ['BFF ProblemDetails', { type: 'https://skein.local/errors/rate-limited', title: 'Too many requests', status: 429, detail: 'slow down', error: 'rate_limited' }],
  ['API refusal', { error: 'rate_limited', message: 'slow down' }],
])('a 429 %s is a RateLimitError carrying the code rate_limited', async (_name, body) => {
  answer429(body);
  const err = await apiFetch('/api/auth/password-reset', { method: 'POST', body: '{}' }).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(RateLimitError);
  expect((err as RateLimitError).code).toBe('rate_limited');
});
