/**
 * API client for /api/v1/me/api-keys/* (R2.1).
 *
 * Wire shapes mirror the FROZEN R2.1 contract:
 *  - POST returns the plain key (`plainKey`) exactly once. The caller MUST
 *    store/show it immediately; subsequent GETs strip the field.
 *  - GET returns audit-safe rows: id, label, prefix (12 chars), timestamps.
 *  - DELETE soft-revokes; the row stays in GET responses with `revokedAt`.
 */

import { apiFetch, apiJson } from './client';

/** Audit-safe shape returned by GET /me/api-keys (no plain key). */
export interface ApiKey {
  id: string;
  label: string;
  /** First 12 chars of the plain key — non-secret, used for display. */
  prefix: string;
  createdAt: string;
  /** ISO 8601, null until first MCP request authenticates with this key. */
  lastUsedAt: string | null;
  /** ISO 8601, null while the key is active. */
  revokedAt: string | null;
}

/**
 * Response from POST /me/api-keys. Includes `plainKey` — the ONLY time
 * the full key value is visible. Frontend hands this to the
 * SecretReveal modal and never persists it.
 */
export interface ApiKeyCreateResponse {
  id: string;
  label: string;
  prefix: string;
  /** Full key value, e.g. "ska_aBcDeFgHiJkLmNoPqRsTuV". One-shot. */
  plainKey: string;
  createdAt: string;
}

/** Create a new API key. The response carries the plaintext exactly once. */
export async function createApiKey(label: string): Promise<ApiKeyCreateResponse> {
  return apiJson<ApiKeyCreateResponse>('/api/v1/me/api-keys', {
    method: 'POST',
    body: JSON.stringify({ label }),
  });
}

/** List the calling user's keys (active + revoked). Newest-first. */
export async function listApiKeys(): Promise<ApiKey[]> {
  return apiJson<ApiKey[]>('/api/v1/me/api-keys');
}

/** Revoke (soft-delete) a key by id. 204 on success. */
export async function revokeApiKey(id: string): Promise<void> {
  await apiFetch(`/api/v1/me/api-keys/${id}`, { method: 'DELETE' });
}
