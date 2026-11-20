/**
 * Web Push REST client — sk push phase 1.
 *
 * Wraps the device endpoints skein-api exposes (the skein-web BFF proxies
 * `/api/v1` with the session cookie):
 *
 *   GET    /api/v1/push/config             → { publicKey }
 *   POST   /api/v1/push/subscriptions      → upsert caller's subscription
 *   DELETE /api/v1/push/subscriptions      → remove one by endpoint (body)
 *   DELETE /api/v1/push/subscriptions/{id} → remove one by row id (owner-scoped)
 *   GET    /api/v1/push/subscriptions      → caller's devices (NO secrets)
 *
 * Contract v2 (see the "Contract v2" section below) adds the expected user to
 * every operation, the device label and the record version, and two routes:
 *
 *   POST   /api/v1/push/device-revocations → revoke the caller's device labels
 *   POST   /api/v1/push/device-removals    → remove a caller's device by id
 *
 * The VAPID public key from `/config` is base64url. When the server has
 * push DISABLED the key is the empty string — callers MUST treat an empty
 * `publicKey` as "push unavailable" and stop (do NOT try to subscribe with
 * an empty applicationServerKey).
 *
 * The device-list rows deliberately carry NO raw `endpoint` / `keys` — those
 * never leave the server. Each row DOES carry `endpointHash` (SHA-256 hex of
 * the endpoint) so the settings page can identify "this device" by hashing
 * its own live endpoint and matching.
 *
 * All camelCase JSON, mirroring the contract.
 */

import { apiFetch, apiJson } from './client';

// ───────────────────────── Wire DTOs ─────────────────────────

/** Response of `GET /api/v1/push/config`. */
export interface PushConfig {
  /**
   * VAPID application-server public key, base64url. Empty string when
   * push is disabled server-side → treat as "push unavailable".
   */
  publicKey: string;
}

/**
 * The subset of `PushSubscription.toJSON()` the backend needs. The browser
 * gives us exactly this shape from `subscription.toJSON()`.
 */
export interface PushSubscriptionKeys {
  p256dh: string;
  auth: string;
}

/** Body for `POST /api/v1/push/subscriptions`. */
export interface RegisterSubscriptionArgs {
  endpoint: string;
  keys: PushSubscriptionKeys;
  /** Caller's user-agent string, for the device list. Optional. */
  ua?: string;
}

/**
 * One registered device, as returned by `GET /api/v1/push/subscriptions`.
 * No `endpoint` / `keys` by design — the server never echoes the secret
 * material back.
 */
export interface PushDevice {
  /** Subscription row UUID. */
  id: string;
  /**
   * Lowercase hex SHA-256 of the device's push endpoint. The raw endpoint
   * never leaves the server; this hash lets the client identify "this
   * device" by hashing its own live endpoint and matching (see
   * PushDevicesSection).
   */
  endpointHash: string;
  /** User-agent string captured at registration. */
  ua: string;
  /** RFC3339 — when the subscription was first registered. */
  createdAt: string;
  /** RFC3339 — last time a push was successfully delivered / re-synced. */
  lastSeenAt: string;
  /**
   * UUID label of the device consent the subscription was registered with;
   * `null` for a subscription registered without one. Sent by an api of
   * contract v2 (see {@link PUSH_CONTRACT_HEADER}).
   */
  deviceLabel: string | null;
  /** Grows with every write of the subscription. Contract v2. */
  version: number;
}

// ───────────────────────── Operations ─────────────────────────

/**
 * Fetch the push configuration. An empty `publicKey` means push is
 * disabled server-side; the per-field default guards against a malformed
 * wire response so callers always get a string.
 */
export async function getPushConfig(): Promise<PushConfig> {
  const raw = await apiJson<Partial<PushConfig>>('/api/v1/push/config', {
    method: 'GET',
  });
  return { publicKey: typeof raw.publicKey === 'string' ? raw.publicKey : '' };
}

/**
 * Register (upsert) the caller's push subscription. Idempotent on the
 * backend — re-POSTing the same endpoint refreshes the row rather than
 * duplicating it, which is what the login re-sync relies on.
 */
export async function registerSubscription(
  args: RegisterSubscriptionArgs,
): Promise<void> {
  const body: RegisterSubscriptionArgs = {
    endpoint: args.endpoint,
    keys: { p256dh: args.keys.p256dh, auth: args.keys.auth },
  };
  if (args.ua && args.ua.trim() !== '') body.ua = args.ua;
  await apiFetch('/api/v1/push/subscriptions', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** Remove the caller's subscription identified by its endpoint. */
export async function deleteSubscription(endpoint: string): Promise<void> {
  await apiFetch('/api/v1/push/subscriptions', {
    method: 'DELETE',
    body: JSON.stringify({ endpoint }),
  });
}

/**
 * Remove one of the caller's devices by its subscription row id. Owner-scoped
 * server-side — deleting a row that isn't yours (or doesn't exist) is a 404.
 * Used by the settings device list to unsubscribe ANY device (not just the
 * current browser, which only knows its own endpoint).
 */
export async function deleteSubscriptionById(id: string): Promise<void> {
  await apiFetch(`/api/v1/push/subscriptions/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

/** List the caller's registered devices (metadata only — no secrets). */
export async function listPushDevices(): Promise<PushDevice[]> {
  const raw = await apiJson<PushDevice[] | null>('/api/v1/push/subscriptions', {
    method: 'GET',
  });
  return Array.isArray(raw) ? raw : [];
}

// ───────────────────────── Contract v2 ─────────────────────────
//
// Every push operation of contract v2 carries the user the page expects to be
// the caller (`expectedUserId`) and is answered with an outcome instead of an
// exception. Requests go through `pushFetch`, not `apiFetch`: `apiFetch`
// throws on 401 and 422 and drops the response headers, and the outcome
// depends on the contract marker header.
//
// Classification order:
//   1. status 401 → `sessionEnded`, whatever the headers (a 401 of the BFF or
//      of the session-epoch middleware is produced before the push group and
//      never carries the marker);
//   2. no marker `Skein-Push-Contract: 2` → `lost` (an older api: a 200 list
//      or a 204 without the new semantics, 400 for a new body, 404/405 for a
//      new route);
//   3. with the marker: 2xx → `ok`; 422 → the refusal of its code
//      (`session_stale` → `sessionEnded`); anything else (400, 429, 5xx) →
//      `lost`.
// A network failure, a timeout or an abort through the caller's signal is
// `lost` as well.

/** Response header that marks a response of the push REST contract v2. */
export const PUSH_CONTRACT_HEADER = 'Skein-Push-Contract';

/** Value of {@link PUSH_CONTRACT_HEADER} on a contract v2 response. */
export const PUSH_CONTRACT_VERSION = '2';

/** Largest number of labels one device revocation may carry. */
export const MAX_REVOKED_DEVICE_LABELS = 1000;

/** What `pushFetch` hands to the classifier. */
export interface PushResponse {
  status: number;
  headers: Headers;
  /** Parsed JSON body; `null` when the body is empty or not JSON. */
  body: unknown;
}

/** A definite refusal of a contract v2 operation (422 with the marker). */
export type PushRefusal = 'userChanged' | 'revoked' | 'taken' | 'notFound' | 'refused';

/**
 * Outcome of a contract v2 push operation. What to do on each outcome is up
 * to the caller.
 */
export type PushOutcome<T = void> =
  | { kind: 'ok'; value: T }
  | { kind: PushRefusal }
  | { kind: 'sessionEnded' }
  | { kind: 'lost' };

const REFUSAL_BY_CODE: Readonly<Record<string, PushRefusal>> = {
  expected_user_mismatch: 'userChanged',
  device_revoked: 'revoked',
  endpoint_taken: 'taken',
  subscription_not_found: 'notFound',
  invalid_subscription: 'refused',
};

/**
 * Transport of the push operations: `fetch` with the session cookie and JSON,
 * returning the status, the headers and the parsed body of any HTTP answer.
 * Rejects only when no answer arrived (network failure, abort).
 */
export async function pushFetch(path: string, init: RequestInit = {}): Promise<PushResponse> {
  const hasBody = init.body !== undefined && init.body !== null;
  const response = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: {
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      Accept: 'application/json',
    },
  });
  let body: unknown = null;
  const text = await response.text();
  if (text !== '') {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  return { status: response.status, headers: response.headers, body };
}

/**
 * Classifies an answer of a push operation (see the order above). An `ok`
 * carries the body; the operation parses it.
 */
export function classifyPushResponse(res: PushResponse): PushOutcome<unknown> {
  if (res.status === 401) return { kind: 'sessionEnded' };
  if (res.headers.get(PUSH_CONTRACT_HEADER) !== PUSH_CONTRACT_VERSION) return { kind: 'lost' };
  if (res.status >= 200 && res.status < 300) return { kind: 'ok', value: res.body };
  if (res.status !== 422) return { kind: 'lost' };
  const code =
    res.body !== null && typeof res.body === 'object' && typeof (res.body as { error?: unknown }).error === 'string'
      ? (res.body as { error: string }).error
      : '';
  if (code === 'session_stale') return { kind: 'sessionEnded' };
  return { kind: REFUSAL_BY_CODE[code] ?? 'refused' };
}

/**
 * Sends one push operation and classifies its answer; a request that got no
 * answer is `lost`.
 */
export async function pushRequest(
  path: string,
  init: RequestInit = {},
): Promise<PushOutcome<unknown>> {
  let res: PushResponse;
  try {
    res = await pushFetch(path, init);
  } catch {
    return { kind: 'lost' };
  }
  return classifyPushResponse(res);
}

/** Maps the body of an `ok`; a body that breaks the contract is `lost`. */
function mapOk<T>(
  outcome: PushOutcome<unknown>,
  parse: (body: unknown) => { value: T } | undefined,
): PushOutcome<T> {
  if (outcome.kind !== 'ok') return outcome;
  const parsed = parse(outcome.value);
  return parsed === undefined ? { kind: 'lost' } : { kind: 'ok', value: parsed.value };
}

function parseDevice(raw: unknown): PushDevice | undefined {
  if (raw === null || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  if (
    typeof r.id !== 'string' ||
    typeof r.endpointHash !== 'string' ||
    !(r.deviceLabel === null || typeof r.deviceLabel === 'string') ||
    typeof r.version !== 'number' ||
    typeof r.createdAt !== 'string' ||
    typeof r.lastSeenAt !== 'string'
  ) {
    return undefined;
  }
  return {
    id: r.id,
    endpointHash: r.endpointHash,
    ua: typeof r.ua === 'string' ? r.ua : '',
    createdAt: r.createdAt,
    lastSeenAt: r.lastSeenAt,
    deviceLabel: r.deviceLabel,
    version: r.version,
  };
}

function parseDeviceList(raw: unknown): PushDevice[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const devices: PushDevice[] = [];
  for (const row of raw) {
    const device = parseDevice(row);
    if (device === undefined) return undefined;
    devices.push(device);
  }
  return devices;
}

const noBody = (): { value: void } => ({ value: undefined });

function parseDeviceBody(raw: unknown): { value: PushDevice } | undefined {
  const device = parseDevice(raw);
  return device === undefined ? undefined : { value: device };
}

function parseDeviceListBody(raw: unknown): { value: PushDevice[] } | undefined {
  const devices = parseDeviceList(raw);
  return devices === undefined ? undefined : { value: devices };
}

/** `mode` of {@link SubscribeArgs}. */
export type PushSubscribeMode = 'upsert' | 'updateOnly';

/** Arguments of {@link pushSubscribe}. */
export interface SubscribeArgs {
  expectedUserId: string;
  endpoint: string;
  keys: PushSubscriptionKeys;
  /** Caller's user-agent string, for the device list. Optional. */
  ua?: string;
  /** UUID label of the device consent, created by the browser. */
  deviceLabel: string;
  /**
   * `upsert` creates or updates the caller's subscription for the endpoint;
   * `updateOnly` only updates an existing one (`notFound` without it).
   */
  mode: PushSubscribeMode;
}

/**
 * Registers the caller's subscription with a device label:
 * `POST /api/v1/push/subscriptions`. `ok` carries the stored subscription.
 */
export async function pushSubscribe(
  args: SubscribeArgs,
  signal?: AbortSignal,
): Promise<PushOutcome<PushDevice>> {
  const body: Record<string, unknown> = {
    endpoint: args.endpoint,
    keys: { p256dh: args.keys.p256dh, auth: args.keys.auth },
    expectedUserId: args.expectedUserId,
    deviceLabel: args.deviceLabel,
    mode: args.mode,
  };
  if (args.ua && args.ua.trim() !== '') body.ua = args.ua;
  return mapOk(
    await pushRequest('/api/v1/push/subscriptions', {
      method: 'POST',
      body: JSON.stringify(body),
      signal,
    }),
    parseDeviceBody,
  );
}

/** Subscription a conditional channel removal is limited to. */
export interface IfSubscription {
  id: string;
  version: number;
}

/** Arguments of {@link pushRemoveChannel}. */
export interface RemoveChannelArgs {
  expectedUserId: string;
  endpoint: string;
  /** When present, only the subscription with this id and version is removed. */
  ifSubscription?: IfSubscription;
}

/**
 * Removes a channel held by another user, by its endpoint:
 * `DELETE /api/v1/push/subscriptions`.
 */
export async function pushRemoveChannel(
  args: RemoveChannelArgs,
  signal?: AbortSignal,
): Promise<PushOutcome> {
  const body: Record<string, unknown> = {
    expectedUserId: args.expectedUserId,
    endpoint: args.endpoint,
  };
  if (args.ifSubscription) {
    body.ifSubscription = { id: args.ifSubscription.id, version: args.ifSubscription.version };
  }
  return mapOk(
    await pushRequest('/api/v1/push/subscriptions', {
      method: 'DELETE',
      body: JSON.stringify(body),
      signal,
    }),
    noBody,
  );
}

/** Arguments of {@link pushRevokeDevices}. */
export interface RevokeDevicesArgs {
  expectedUserId: string;
  /** Labels to revoke, at most {@link MAX_REVOKED_DEVICE_LABELS}. */
  deviceLabels: readonly string[];
  /** Also removes the caller's unlabelled subscription with this endpoint. */
  endpoint?: string;
}

/**
 * Revokes the caller's device labels in one request:
 * `POST /api/v1/push/device-revocations`. At least one of `deviceLabels` and
 * `endpoint` must be non-empty.
 */
export async function pushRevokeDevices(
  args: RevokeDevicesArgs,
  signal?: AbortSignal,
): Promise<PushOutcome> {
  const body: Record<string, unknown> = {
    expectedUserId: args.expectedUserId,
    deviceLabels: [...args.deviceLabels],
  };
  if (args.endpoint !== undefined && args.endpoint !== '') body.endpoint = args.endpoint;
  return mapOk(
    await pushRequest('/api/v1/push/device-revocations', {
      method: 'POST',
      body: JSON.stringify(body),
      signal,
    }),
    noBody,
  );
}

/** Arguments of {@link pushRemoveDevice}. */
export interface RemoveDeviceArgs {
  expectedUserId: string;
  /** Subscription id. */
  id: string;
}

/**
 * Removes one of the caller's devices by subscription id, revoking its label:
 * `POST /api/v1/push/device-removals`.
 */
export async function pushRemoveDevice(
  args: RemoveDeviceArgs,
  signal?: AbortSignal,
): Promise<PushOutcome> {
  return mapOk(
    await pushRequest('/api/v1/push/device-removals', {
      method: 'POST',
      body: JSON.stringify({ expectedUserId: args.expectedUserId, id: args.id }),
      signal,
    }),
    noBody,
  );
}

/**
 * Lists the caller's subscriptions as the expected user:
 * `GET /api/v1/push/subscriptions?expectedUserId=`.
 */
export async function pushListDevices(
  expectedUserId: string,
  signal?: AbortSignal,
): Promise<PushOutcome<PushDevice[]>> {
  const query = new URLSearchParams({ expectedUserId }).toString();
  return mapOk(
    await pushRequest(`/api/v1/push/subscriptions?${query}`, { method: 'GET', signal }),
    parseDeviceListBody,
  );
}

// ───────────────────────── Category preferences — removed ─────────────────────────
//
// `/me/push-prefs` (the per-category opt-out set plus its registry) is gone
// from the client with sk-303.13: push categories were a second vocabulary of
// channels beside the notify-event-type list, and one reason table now says
// whether a reason goes to the feed, to push, or to neither. See
// `api/notification-reasons.ts`. What stays here is device management, which
// is not a reason and has its own contract.
