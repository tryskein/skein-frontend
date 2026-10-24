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

// ───────────────────────── Category preferences — removed ─────────────────────────
//
// `/me/push-prefs` (the per-category opt-out set plus its registry) is gone
// from the client with sk-303.13: push categories were a second vocabulary of
// channels beside the notify-event-type list, and one reason table now says
// whether a reason goes to the feed, to push, or to neither. See
// `api/notification-reasons.ts`. What stays here is device management, which
// is not a reason and has its own contract.
