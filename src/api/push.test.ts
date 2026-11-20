/**
 * Push REST contract v2 on the page side: the transport `pushFetch`, the
 * outcome classifier and the wire of the new operations.
 *
 * The expected outcomes come from the contract of the push group: a 401 ends
 * the session whatever the headers (it is produced before the push group);
 * without the marker `Skein-Push-Contract: 2` an answer comes from an older
 * api and is `lost`, never `ok`; with the marker a 2xx is `ok`, a 422 is the
 * refusal of its code (`session_stale` ends the session) and any other status
 * is `lost`. A request without an answer is `lost`.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  pushListDevices,
  pushRemoveChannel,
  pushRemoveDevice,
  pushRequest,
  pushRevokeDevices,
  pushSubscribe,
  type PushOutcome,
} from './push';

afterEach(() => {
  vi.unstubAllGlobals();
});

const V2 = { 'Skein-Push-Contract': '2' };
const USER = '0b5f3c1e-6a2d-4f0e-9c1b-2f4e6a8d0c11';
const LABEL = '7d1e2f3a-4b5c-4d6e-8f70-81a2b3c4d5e6';
const LABEL_2 = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const ENDPOINT = 'https://push.example.test/send/abc';
const SUB_ID = 'c3d4e5f6-0718-4293-a4b5-c6d7e8f90a1b';

const DTO = {
  id: SUB_ID,
  endpointHash: 'ab'.repeat(32),
  deviceLabel: LABEL,
  version: 3,
  ua: 'Firefox',
  createdAt: '2026-11-20T10:00:00Z',
  lastSeenAt: '2026-11-20T11:00:00Z',
};

interface Answer {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
}

function toResponse(a: Answer): Response {
  const text = a.body === undefined ? null : JSON.stringify(a.body);
  return new Response(text, {
    status: a.status,
    headers: { ...(text === null ? {} : { 'Content-Type': 'application/json' }), ...(a.headers ?? {}) },
  });
}

function answer(a: Answer): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => toResponse(a));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('row 33 — outcome of a push answer', () => {
  test.each<[string, Answer, PushOutcome<unknown>['kind']]>([
    // 2xx with the marker
    ['200 with the marker', { status: 200, headers: V2, body: [] }, 'ok'],
    ['an empty 204 with the marker', { status: 204, headers: V2 }, 'ok'],
    // 422 with the marker: each code is its own definite refusal
    ['422 expected_user_mismatch', { status: 422, headers: V2, body: { error: 'expected_user_mismatch', message: 'm' } }, 'userChanged'],
    ['422 device_revoked', { status: 422, headers: V2, body: { error: 'device_revoked', message: 'm' } }, 'revoked'],
    ['422 endpoint_taken', { status: 422, headers: V2, body: { error: 'endpoint_taken', message: 'm' } }, 'taken'],
    ['422 subscription_not_found', { status: 422, headers: V2, body: { error: 'subscription_not_found', message: 'm' } }, 'notFound'],
    ['422 invalid_subscription', { status: 422, headers: V2, body: { error: 'invalid_subscription', message: 'm' } }, 'refused'],
    ['422 session_stale', { status: 422, headers: V2, body: { error: 'session_stale', message: 'm' } }, 'sessionEnded'],
    // 401 ends the session with or without the marker
    ['401 with the marker', { status: 401, headers: V2, body: { error: 'session_revoked' } }, 'sessionEnded'],
    ['401 of the api without the marker', { status: 401, body: { error: 'session_revoked', message: 'm' } }, 'sessionEnded'],
    ['401 of the BFF without the marker', { status: 401, body: { type: 'about:blank', title: 'Unauthorized', status: 401 } }, 'sessionEnded'],
    // other statuses with the marker
    ['400 invalid_request with the marker', { status: 400, headers: V2, body: { error: 'invalid_request', message: 'm' } }, 'lost'],
    ['429 with the marker', { status: 429, headers: V2, body: { error: 'rate_limited' } }, 'lost'],
    ['500 with the marker', { status: 500, headers: V2 }, 'lost'],
    ['503 with the marker', { status: 503, headers: V2 }, 'lost'],
    // a marker of another version is no marker
    ['200 with marker value 1', { status: 200, headers: { 'Skein-Push-Contract': '1' }, body: [] }, 'lost'],
    ['204 with marker value 3', { status: 204, headers: { 'Skein-Push-Contract': '3' } }, 'lost'],
    ['422 with marker value 1', { status: 422, headers: { 'Skein-Push-Contract': '1' }, body: { error: 'device_revoked' } }, 'lost'],
    // no marker: an older api
    ['422 without the marker', { status: 422, body: { error: 'expected_user_mismatch', message: 'm' } }, 'lost'],
    ['200 with an empty list without the marker', { status: 200, body: [] }, 'lost'],
    ['200 with a list without the marker', { status: 200, body: [DTO] }, 'lost'],
    ['204 without the marker', { status: 204 }, 'lost'],
    ['400 without the marker', { status: 400, body: { error: 'invalid_json', message: 'm' } }, 'lost'],
    ['404 without the marker', { status: 404 }, 'lost'],
    ['405 without the marker', { status: 405 }, 'lost'],
    ['429 without the marker', { status: 429, body: { error: 'rate_limited' } }, 'lost'],
    ['500 without the marker', { status: 500 }, 'lost'],
    ['502 without the marker', { status: 502 }, 'lost'],
  ])('%s → %s', async (_name, a, expected) => {
    answer(a);
    const outcome = await pushRequest('/api/v1/push/subscriptions', { method: 'GET' });
    expect(outcome.kind).toBe(expected);
  });

  test('a network failure is lost', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));
    const outcome = await pushRequest('/api/v1/push/subscriptions', { method: 'GET' });
    expect(outcome.kind).toBe('lost');
  });

  test('an abort through the signal is lost', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      })));
    const controller = new AbortController();
    const pending = pushRequest('/api/v1/push/device-revocations', {
      method: 'POST',
      body: '{}',
      signal: controller.signal,
    });
    controller.abort();
    expect((await pending).kind).toBe('lost');
  });

  // Every operation goes through the same classification.
  const operations: Array<[string, () => Promise<PushOutcome<unknown>>, unknown]> = [
    ['pushSubscribe', () => pushSubscribe({ expectedUserId: USER, endpoint: ENDPOINT, keys: { p256dh: 'p', auth: 'a' }, deviceLabel: LABEL, mode: 'upsert' }), DTO],
    ['pushRemoveChannel', () => pushRemoveChannel({ expectedUserId: USER, endpoint: ENDPOINT }), undefined],
    ['pushRevokeDevices', () => pushRevokeDevices({ expectedUserId: USER, deviceLabels: [LABEL] }), undefined],
    ['pushRemoveDevice', () => pushRemoveDevice({ expectedUserId: USER, id: SUB_ID }), undefined],
    ['pushListDevices', () => pushListDevices(USER), [DTO]],
  ];

  test.each(operations)('%s: ok with the marker, lost without it, sessionEnded on 401 and session_stale', async (_name, run, okBody) => {
    const okStatus = okBody === undefined ? 204 : 200;
    answer({ status: okStatus, headers: V2, body: okBody });
    expect((await run()).kind).toBe('ok');
    answer({ status: okStatus, body: okBody });
    expect((await run()).kind).toBe('lost');
    answer({ status: 401 });
    expect((await run()).kind).toBe('sessionEnded');
    answer({ status: 422, headers: V2, body: { error: 'session_stale', message: 'm' } });
    expect((await run()).kind).toBe('sessionEnded');
    answer({ status: 422, headers: V2, body: { error: 'expected_user_mismatch', message: 'm' } });
    expect((await run()).kind).toBe('userChanged');
  });
});

describe('row 34 — wire of the contract v2 operations', () => {
  function lastCall(fetchMock: ReturnType<typeof vi.fn>): { url: string; method: string; body: unknown; credentials: unknown } {
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    return {
      url,
      method: String(init.method),
      body: init.body === undefined ? undefined : JSON.parse(String(init.body)),
      credentials: init.credentials,
    };
  }

  test('pushSubscribe posts the endpoint, keys, ua, expected user, label and mode', async () => {
    const fetchMock = answer({ status: 200, headers: V2, body: DTO });
    const outcome = await pushSubscribe({
      expectedUserId: USER,
      endpoint: ENDPOINT,
      keys: { p256dh: 'P256', auth: 'AUTH' },
      ua: 'Firefox',
      deviceLabel: LABEL,
      mode: 'updateOnly',
    });
    expect(lastCall(fetchMock)).toEqual({
      url: '/api/v1/push/subscriptions',
      method: 'POST',
      credentials: 'include',
      body: {
        endpoint: ENDPOINT,
        keys: { p256dh: 'P256', auth: 'AUTH' },
        ua: 'Firefox',
        expectedUserId: USER,
        deviceLabel: LABEL,
        mode: 'updateOnly',
      },
    });
    expect(outcome).toEqual({ kind: 'ok', value: DTO });
  });

  test('pushSubscribe with mode upsert and without ua', async () => {
    const fetchMock = answer({ status: 200, headers: V2, body: DTO });
    await pushSubscribe({ expectedUserId: USER, endpoint: ENDPOINT, keys: { p256dh: 'P', auth: 'A' }, deviceLabel: LABEL, mode: 'upsert' });
    expect(lastCall(fetchMock).body).toEqual({
      endpoint: ENDPOINT,
      keys: { p256dh: 'P', auth: 'A' },
      expectedUserId: USER,
      deviceLabel: LABEL,
      mode: 'upsert',
    });
  });

  test('pushRemoveChannel deletes by endpoint with the expected user, unconditionally', async () => {
    const fetchMock = answer({ status: 204, headers: V2 });
    await pushRemoveChannel({ expectedUserId: USER, endpoint: ENDPOINT });
    expect(lastCall(fetchMock)).toEqual({
      url: '/api/v1/push/subscriptions',
      method: 'DELETE',
      credentials: 'include',
      body: { expectedUserId: USER, endpoint: ENDPOINT },
    });
  });

  test('pushRemoveChannel with ifSubscription sends its id and version', async () => {
    const fetchMock = answer({ status: 204, headers: V2 });
    await pushRemoveChannel({ expectedUserId: USER, endpoint: ENDPOINT, ifSubscription: { id: SUB_ID, version: 7 } });
    expect(lastCall(fetchMock).body).toEqual({
      expectedUserId: USER,
      endpoint: ENDPOINT,
      ifSubscription: { id: SUB_ID, version: 7 },
    });
  });

  test('pushRevokeDevices posts every label and the endpoint to device-revocations', async () => {
    const fetchMock = answer({ status: 204, headers: V2 });
    await pushRevokeDevices({ expectedUserId: USER, deviceLabels: [LABEL, LABEL_2], endpoint: ENDPOINT });
    expect(lastCall(fetchMock)).toEqual({
      url: '/api/v1/push/device-revocations',
      method: 'POST',
      credentials: 'include',
      body: { expectedUserId: USER, deviceLabels: [LABEL, LABEL_2], endpoint: ENDPOINT },
    });
  });

  test('pushRevokeDevices without labels sends an empty list and the endpoint', async () => {
    const fetchMock = answer({ status: 204, headers: V2 });
    await pushRevokeDevices({ expectedUserId: USER, deviceLabels: [], endpoint: ENDPOINT });
    expect(lastCall(fetchMock).body).toEqual({ expectedUserId: USER, deviceLabels: [], endpoint: ENDPOINT });
  });

  test('pushRemoveDevice posts the id to device-removals', async () => {
    const fetchMock = answer({ status: 204, headers: V2 });
    await pushRemoveDevice({ expectedUserId: USER, id: SUB_ID });
    expect(lastCall(fetchMock)).toEqual({
      url: '/api/v1/push/device-removals',
      method: 'POST',
      credentials: 'include',
      body: { expectedUserId: USER, id: SUB_ID },
    });
  });

  test('pushListDevices reads with the expected user in the query and returns deviceLabel and version', async () => {
    const unlabelled = { ...DTO, id: 'e1f2a3b4-c5d6-4e7f-8a9b-0c1d2e3f4a5b', deviceLabel: null, version: 1 };
    const fetchMock = answer({ status: 200, headers: V2, body: [DTO, unlabelled] });
    const outcome = await pushListDevices(USER);
    const call = lastCall(fetchMock);
    expect(call.method).toBe('GET');
    expect(call.url).toBe(`/api/v1/push/subscriptions?expectedUserId=${USER}`);
    expect(call.body).toBeUndefined();
    expect(outcome.kind).toBe('ok');
    const devices = (outcome as { kind: 'ok'; value: Array<{ deviceLabel: string | null; version: number }> }).value;
    expect(devices.map((d) => [d.deviceLabel, d.version])).toEqual([[LABEL, 3], [null, 1]]);
  });

  test('a v2 list row without deviceLabel or version breaks the contract: lost', async () => {
    const { deviceLabel: _l, version: _v, ...legacyRow } = DTO;
    answer({ status: 200, headers: V2, body: [legacyRow] });
    expect((await pushListDevices(USER)).kind).toBe('lost');
  });
});
