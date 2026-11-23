/**
 * sk-1048.70 — the review-prefs client on the HTTP boundary.
 *
 * Contract (skein-api `handler/review_prefs.go`): `GET` and `PUT`
 * `/api/v1/me/review-prefs`. `PUT` is partial: an absent key is left alone and
 * an explicit `null` clears a schedule parameter, so the two must reach the wire
 * as different bodies. A value out of bounds is refused with 422
 * `invalid_schedule_setting` naming the field in `param`.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { getReviewPrefs, updateReviewPrefs, type ReviewPrefs } from './review-prefs';

const STORED: ReviewPrefs = {
  mechanicEnabled: true,
  reviewRequiredDefault: false,
  burstCount: 0,
  unacceptedIntervalMinutes: null,
  unreviewedIntervalMinutes: 240,
  effective: { burstCount: 0, unacceptedIntervalMinutes: 60, unreviewedIntervalMinutes: 240 },
  bounds: {
    burstCount: { min: 0, max: 10, factory: 3 },
    unacceptedIntervalMinutes: { min: 15, max: 1440, factory: 60 },
    unreviewedIntervalMinutes: { min: 15, max: 10080, factory: 1440 },
  },
};

const fetchSpy = vi.fn<typeof fetch>();

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  fetchSpy.mockReset();
  fetchSpy.mockImplementation(async () => json(200, STORED));
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => vi.unstubAllGlobals());

function onlyCall(): { url: string; method: string | undefined; body: string | undefined } {
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  const [url, init] = fetchSpy.mock.calls[0];
  return { url: String(url), method: init?.method ?? 'GET', body: init?.body === undefined ? undefined : String(init.body) };
}

describe('review-prefs client', () => {
  test('reads with GET and returns the server payload', async () => {
    await expect(getReviewPrefs()).resolves.toEqual(STORED);
    expect(onlyCall()).toEqual({ url: '/api/v1/me/review-prefs', method: 'GET', body: undefined });
  });

  test('saves with PUT, keeping an explicit null apart from an absent key', async () => {
    await expect(updateReviewPrefs({ burstCount: 0, unacceptedIntervalMinutes: null })).resolves.toEqual(STORED);
    const call = onlyCall();
    expect(call.url).toBe('/api/v1/me/review-prefs');
    expect(call.method).toBe('PUT');
    expect(JSON.parse(call.body ?? '')).toStrictEqual({ burstCount: 0, unacceptedIntervalMinutes: null });
  });

  test('passes the refusal code and the refused field of an out-of-bounds value to the caller', async () => {
    fetchSpy.mockImplementation(async () => json(422, {
      error: 'invalid_schedule_setting', message: 'burstCount out of range', param: 'burstCount',
    }));
    await expect(updateReviewPrefs({ burstCount: 99 })).rejects.toMatchObject({
      name: 'BusinessError', statusCode: 422, code: 'invalid_schedule_setting', extra: { param: 'burstCount' },
    });
  });
});
