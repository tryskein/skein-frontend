/**
 * API client for /api/v1/me/api-keys/* — the signed-in user's own keys
 * (US-10). The BFF forwards these browser paths to skein-api
 * `/ui/v1/me/api-keys/*`.
 *
 * Wire shapes mirror the skein-api cabinet contract:
 *  - POST returns the plain key (`plainKey`) exactly once. The caller MUST
 *    store/show it immediately; subsequent GETs strip the field. POST
 *    requires the label, permissions and scope; without an expiry the key
 *    gets the default lifetime. A body without permissions, scope and
 *    expiry answers 400 `validation_error` with
 *    `details.staleClient = true` and creates nothing.
 *  - GET returns audit-safe rows: prefix, timestamps, status with its
 *    reason, permissions, scope, and the permissions the owner lost.
 *  - PATCH narrows a key's grant in place; widening is refused (422
 *    `invalid_grant`, `details.rule = not_narrowing`) — a wider grant needs
 *    a new key.
 *  - POST …/{id}/reissue returns a new key and secret with the same label,
 *    permissions and scope and the default lifetime; a revoked key answers
 *    422 `key_revoked`.
 *  - DELETE soft-revokes; the row stays in GET responses with `revokedAt`.
 *  - GET …/settings reports whether the public API is enabled, its address
 *    and the key lifetime policy.
 */

import { apiFetch, apiJson } from './client';

/** Permission level of a key: `read` ⊂ `write` ⊂ `manage`. */
export type ApiKeyLevel = 'read' | 'write' | 'manage';

/** The permission part of a key's grant. */
export interface ApiKeyPermissions {
  /** `null` when the key has only the `admin` permission. */
  level: ApiKeyLevel | null;
  /** Instance-admin permission; allowed only with scope `all`. */
  admin: boolean;
}

/** What a key reaches: listed projects, listed spaces, or everything the owner sees. */
export type ApiKeyScopeMode = 'projects' | 'spaces' | 'all';

/** One project or space of a key's scope, as listed. */
export interface ApiKeyScopeMember {
  /** Project id (UUID), or the space short id. */
  id: string;
  name: string;
}

/** A key's scope as the list returns it. The unused member list is empty. */
export interface ApiKeyScope {
  mode: ApiKeyScopeMode;
  projects: ApiKeyScopeMember[];
  spaces: ApiKeyScopeMember[];
}

/**
 * A key's scope in a create or narrow request: member ids — project ids
 * (UUID) and space short ids. `projects` is sent with mode `projects`,
 * `spaces` with mode `spaces`, neither with `all`.
 */
export interface ApiKeyScopeInput {
  mode: ApiKeyScopeMode;
  projects?: string[];
  spaces?: string[];
}

export type ApiKeyStatus = 'active' | 'inactive';

/** Why a key is inactive. */
export type ApiKeyStatusReason = 'revoked' | 'expired';

/** A permission the key grants but its owner does not hold now. */
export type ApiKeyUnavailablePermission = 'admin';

/** Audit-safe shape returned by GET /me/api-keys (no plain key). */
export interface ApiKey {
  id: string;
  label: string;
  /** First 12 chars of the plain key — non-secret, used for display. */
  prefix: string;
  createdAt: string;
  /** ISO 8601 end of the lifetime; `null` only on a key created before lifetimes existed. */
  expiresAt: string | null;
  /** ISO 8601, null until the first request authenticates with this key. */
  lastUsedAt: string | null;
  /** ISO 8601, null while the key is not revoked. */
  revokedAt: string | null;
  status: ApiKeyStatus;
  /** `null` for an active key. */
  statusReason: ApiKeyStatusReason | null;
  permissions: ApiKeyPermissions;
  scope: ApiKeyScope;
  /** Granted by the key but no longer held by its owner (the owner's role went down). */
  unavailablePermissions: ApiKeyUnavailablePermission[];
  /** The key this one was reissued from; `null` otherwise. */
  reissuedFromId: string | null;
}

/**
 * Response from POST /me/api-keys and POST …/{id}/reissue. Includes
 * `plainKey` — the ONLY time the full key value is visible. Frontend hands
 * this to the SecretReveal modal and never persists it.
 */
export interface ApiKeyCreateResponse extends ApiKey {
  /** Full key value, e.g. "ska_aBcDeFgHiJkLmNoPqRsTuV". One-shot. */
  plainKey: string;
}

/** Body of POST /me/api-keys. */
export interface CreateApiKeyInput {
  label: string;
  permissions: ApiKeyPermissions;
  scope: ApiKeyScopeInput;
  /**
   * RFC 3339; after now and no later than now + `maxTtlSeconds`. Omitted:
   * the key gets the default lifetime (`defaultTtlSeconds`).
   */
  expiresAt?: string;
}

/** Body of PATCH /me/api-keys/{id}: the new grant, no wider than the current one. */
export interface NarrowApiKeyInput {
  permissions: ApiKeyPermissions;
  scope: ApiKeyScopeInput;
  /** RFC 3339, not later than the current expiry; omitted keeps the current expiry. */
  expiresAt?: string;
}

/** Body of GET /me/api-keys/settings. */
export interface ApiKeysSettings {
  /** Whether this instance serves the public API. */
  publicApiEnabled: boolean;
  /** External address of the public API; `null` when disabled or not configured. */
  publicApiUrl: string | null;
  /** Address of the public API's OpenAPI document; `null` exactly when `publicApiUrl` is. */
  openApiUrl: string | null;
  /** Lifetime of a new or reissued key when none is chosen. */
  defaultTtlSeconds: number;
  /** Longest lifetime a new key may be given. */
  maxTtlSeconds: number;
}

/** Create a new API key. The response carries the plaintext exactly once. */
export async function createApiKey(input: CreateApiKeyInput): Promise<ApiKeyCreateResponse> {
  return apiJson<ApiKeyCreateResponse>('/api/v1/me/api-keys', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** List the calling user's keys (active, expired and revoked). Newest-first. */
export async function listApiKeys(): Promise<ApiKey[]> {
  return apiJson<ApiKey[]>('/api/v1/me/api-keys');
}

/** Narrow a key's grant in place. Returns the key after the change. */
export async function narrowApiKey(id: string, input: NarrowApiKeyInput): Promise<ApiKey> {
  return apiJson<ApiKey>(`/api/v1/me/api-keys/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

/** Reissue a key: a new key and secret with the same label and grant. */
export async function reissueApiKey(id: string): Promise<ApiKeyCreateResponse> {
  return apiJson<ApiKeyCreateResponse>(`/api/v1/me/api-keys/${encodeURIComponent(id)}/reissue`, {
    method: 'POST',
  });
}

/** Revoke (soft-delete) a key by id. 204 on success. */
export async function revokeApiKey(id: string): Promise<void> {
  await apiFetch(`/api/v1/me/api-keys/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** Public API availability and the key lifetime policy of this instance. */
export async function getApiKeysSettings(): Promise<ApiKeysSettings> {
  return apiJson<ApiKeysSettings>('/api/v1/me/api-keys/settings');
}
