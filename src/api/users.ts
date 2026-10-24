/**
 * API client for /api/v1/users/* (R3.1) — admin-only user management,
 * plus /api/v1/me/password for self-service password change.
 *
 * Wire shapes mirror users.UserDTO from skein-api:
 *   - GET /users / GET /users/{id} / POST /users / PATCH /users/{id}
 *     return UserDTO.
 *   - POST /users/{id}/(de|re)activate are 204 (no body).
 *   - POST /me/password is 204 (no body) on success. Error codes (sk-303.20
 *     corrected the ones below — they were documented as 401/400 before an
 *     audit against the actual handler; see PasswordPage.tsx for how each
 *     is mapped to a form message):
 *       - 422 `invalid_credentials` — current password did not verify (also
 *         covers a deactivated or SSO-only account, collapsed into the
 *         same code so the response can't be used to enumerate account
 *         state).
 *       - 400 `invalid_password` — new password shorter than 8 bytes.
 *       - 400 `password_too_long` — new password exceeds 72 bytes once
 *         UTF-8 encoded (bcrypt's structural ceiling).
 *       - 422 `password_pwned` — new password found in the Pwned Passwords
 *         breach corpus (only when the server has the check enabled — see
 *         `getPasswordPolicy`).
 *       - 403 `local_password_disabled` — account authenticates via SSO;
 *         there is no local password to rotate.
 *   - GET /me/password/policy is 200 `{pwnedCheckEnabled: boolean}` — the
 *     single source of truth for whether the frontend's own client-side
 *     pwned-hint lookup (a request to a third-party breach-check API) may
 *     run at all.
 *
 * Admin gating is enforced server-side: non-admin callers receive 403
 * `{error:"not_admin"}` from the RequireAdmin middleware.
 */

import { apiFetch, apiJson } from './client';
import type { SpaceKind, SpaceRef, SpaceRole, MemberRemovalPreview } from './spaces';

/**
 * sk-674.18 (spaces contract, T027) — the three keys every person object of
 * the API gains, so a departed or deleted person renders one way
 * everywhere. Carried here by every object the client types as a person:
 * the directory, the profile, the admin user row, project and space
 * members, watchers, notification and activity actors, HOT ZONE
 * contributors. Additive: absent until skein-api serves them.
 */
export interface PersonStatus {
  /** Left the space of this context; shown greyed. */
  departed?: boolean;
  /** The account was deleted. */
  deleted?: boolean;
  /** The stable alias shown for a deleted account; null otherwise. */
  pseudonym?: string | null;
}

/**
 * Audit-safe shape returned by GET /users — no password hash, no
 * keycloak_sub. A person object of the spaces contract (`PersonStatus`).
 */
export interface User extends PersonStatus {
  id: string;
  email: string;
  username: string;
  name: string;
  role: 'admin' | 'user';
  createdAt: string;
  /** ISO 8601, null until first successful login. */
  lastLoginAt: string | null;
  /** ISO 8601, null while active. IS NOT NULL = deactivated. */
  deactivatedAt: string | null;
  /**
   * Derived auth-method state. `password` = local password set,
   * `keycloak` = SSO subject linked (auto-provisioned via SSO login),
   * `both` = both linked. Raw password_hash / keycloak_sub columns
   * are never exposed on the wire.
   */
  authMethod: 'password' | 'keycloak' | 'both';
  /**
   * sk-163 — true for an external collaborator account. External users are
   * visibility-scoped to their own projects and are permanently capped at
   * role='user'. Set only at create time (no conversion path).
   */
  isExternal: boolean;
}

/** Cursor-paginated wrapper returned by GET /users. */
export interface UserListResult {
  items: User[];
  nextCursor: string | null;
  hasMore: boolean;
}

/** Filters for GET /users. All fields optional. */
export interface ListUsersParams {
  /** "false" (default, active only) | "true" (deactivated only) | "all" */
  archived?: 'false' | 'true' | 'all';
  /** Substring filter (case-insensitive ILIKE on email/username/name). */
  search?: string;
  /**
   * sk-163 — filter on the is_external flag. `true` → external collaborators
   * only, `false` → internal only, omitted → both. Applied server-side so it
   * is correct across all cursor pages.
   */
  external?: boolean;
  /** Cursor token from a previous response's nextCursor. */
  cursor?: string;
  /** 1..100, default 50. */
  limit?: number;
}

/** Body of POST /users. */
export interface CreateUserPayload {
  email: string;
  /** Optional — auto-derived from email when omitted. */
  username?: string;
  name: string;
  password: string;
  role: 'admin' | 'user';
  /**
   * sk-163 — create as an external collaborator account. When true the
   * server caps the role at 'user' (external + admin is rejected with
   * external_cannot_be_admin). Defaults to false (internal user).
   */
  isExternal?: boolean;
  /**
   * sk-674.18 (T037) — spaces (short ids) the new user joins at creation.
   * Omitted = the common space, if there is one.
   */
  spaceIds?: string[];
}

/** Body of PATCH /users/{id}. All fields optional. */
export interface UpdateUserPayload {
  name?: string;
  role?: 'admin' | 'user';
  password?: string;
}

/** Body of POST /me/password. */
export interface ChangePasswordPayload {
  currentPassword: string;
  newPassword: string;
}

/** Body of GET /me/password/policy. */
export interface PasswordPolicy {
  /**
   * Whether the server will run the Pwned Passwords k-anonymity check
   * against a new password on POST /me/password. The frontend's own
   * client-side breach-check hint must only run when this is true — see
   * PasswordPage.tsx.
   */
  pwnedCheckEnabled: boolean;
}

/**
 * sk-79 — lean directory entry returned by GET /api/v1/users/directory.
 * id + username + display name only. Unlike {@link User}, this endpoint is
 * available to ANY authenticated caller (NOT admin-gated) — it backs the
 * assignee picker on the cross-project "All projects" Tasks surface, where
 * there's no single project membership to source from. Email / role /
 * auth-method stay on the admin-only `/users` endpoint.
 */
export interface UserDirectoryEntry extends PersonStatus {
  id: string;
  username: string;
  name: string;
}

/** sk-285.5.5 — query parameters of GET /api/v1/users/directory. */
export interface UserDirectoryParams {
  /**
   * Case-insensitive SUBSTRING match against username AND display name.
   * Omitted/blank = no filter (the alphabetically first page). `%` and `_`
   * are matched literally by the backend, not as wildcards.
   */
  q?: string;
  /** Page size. Backend default 50, ceiling 100; out-of-range → 400. */
  limit?: number;
}

/**
 * sk-285.5.5 — envelope of GET /api/v1/users/directory. `hasMore` is true
 * when more users matched than the page returned; the UI uses it to tell
 * the reader that narrowing the search will reveal more, since there is no
 * cursor to page with (the directory is a typeahead source, you narrow it,
 * you don't scroll it).
 */
export interface UserDirectoryResult {
  items: UserDirectoryEntry[];
  hasMore: boolean;
}

/**
 * GET /api/v1/users/directory — a BOUNDED page of active (non-deactivated)
 * users as lean id/username/name entries. Non-admin: any authenticated user
 * may call it.
 *
 * sk-285.5.5 — this used to be an unbounded bare array of every active user
 * and was fetched on mount by the assignee chip row; on a stand with 39 782
 * active users that was ~4.3 MB of JSON per mount. It is now a search
 * endpoint: call it WITH `q` from a search box, don't call it to enumerate
 * the org. The chip row builds its options from the loaded tasks instead.
 */
export async function listUserDirectory(
  params: UserDirectoryParams = {},
): Promise<UserDirectoryResult> {
  const search = new URLSearchParams();
  const q = params.q?.trim();
  if (q) search.set('q', q);
  if (params.limit !== undefined) search.set('limit', String(params.limit));
  const qs = search.toString();
  return apiJson<UserDirectoryResult>(
    `/api/v1/users/directory${qs ? `?${qs}` : ''}`,
  );
}

export async function listUsers(params: ListUsersParams = {}): Promise<UserListResult> {
  const search = new URLSearchParams();
  if (params.archived) search.set('archived', params.archived);
  if (params.search) search.set('search', params.search);
  if (params.external !== undefined) search.set('external', String(params.external));
  if (params.cursor) search.set('cursor', params.cursor);
  if (params.limit !== undefined) search.set('limit', String(params.limit));
  const qs = search.toString();
  return apiJson<UserListResult>(`/api/v1/users${qs ? `?${qs}` : ''}`);
}

export async function getUser(id: string): Promise<User> {
  return apiJson<User>(`/api/v1/users/${id}`);
}

export async function createUser(payload: CreateUserPayload): Promise<User> {
  return apiJson<User>('/api/v1/users', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateUser(id: string, payload: UpdateUserPayload): Promise<User> {
  return apiJson<User>(`/api/v1/users/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function deactivateUser(id: string): Promise<void> {
  await apiFetch(`/api/v1/users/${id}/deactivate`, { method: 'POST' });
}

export async function reactivateUser(id: string): Promise<void> {
  await apiFetch(`/api/v1/users/${id}/reactivate`, { method: 'POST' });
}

export async function changeMyPassword(payload: ChangePasswordPayload): Promise<void> {
  await apiFetch('/api/v1/me/password', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * GET /api/v1/me/password/policy — sk-303.20. Read once by PasswordPage on
 * mount to decide whether its own client-side pwned-hint lookup may run.
 */
export async function getPasswordPolicy(): Promise<PasswordPolicy> {
  return apiJson<PasswordPolicy>('/api/v1/me/password/policy');
}

/**
 * Public user profile shape returned by GET /api/v1/users/profile/{username}.
 * R4.3 — used by the stub `/users/:username` page reached via clicking
 * an `@mention`. Available to any authenticated user.
 *
 * `email` and `deactivatedAt` are admin-visible only — non-admin
 * viewers see them as `undefined` (the backend omits the JSON keys
 * entirely for non-admins).
 */
export interface PublicProfile extends PersonStatus {
  id: string;
  username: string;
  name: string;
  role: 'admin' | 'user';
  /** Admin-only — undefined for non-admin viewers. */
  email?: string;
  /** Admin-only ISO 8601 timestamp; undefined for non-admin viewers
   *  AND for active users. */
  deactivatedAt?: string;
}

/**
 * GET /api/v1/users/profile/{username} — fetch the public profile for
 * a user by their canonical lowercase username. Returns 422
 * `user_not_found` (mapped to BusinessError by apiJson) when the
 * username does not match any row.
 */
export async function getUserProfile(username: string): Promise<PublicProfile> {
  return apiJson<PublicProfile>(
    `/api/v1/users/profile/${encodeURIComponent(username)}`,
  );
}

// ───────────────────────── A user's spaces (admin, sk-674.18 T037) ─────────────────────────

/** One membership of a user outside personal spaces. */
export interface UserSpace extends SpaceRef {
  kind: Extract<SpaceKind, 'common' | 'regular'>;
  role: SpaceRole;
}

/** 200 body of GET and PUT /api/v1/users/{id}/spaces. */
export interface UserSpacesResponse {
  items: UserSpace[];
}

/** One removed space of a preview, with the removal consequences. */
export interface UserSpaceRemoval extends SpaceRef, MemberRemovalPreview {}

/** 200 body of POST /api/v1/users/{id}/spaces/preview. */
export interface UserSpacesPreview {
  /** The spaces the user would leave. */
  removed: UserSpaceRemoval[];
}

const userSpaces = (id: string) => `/api/v1/users/${encodeURIComponent(id)}/spaces`;

/** GET /api/v1/users/{id}/spaces (admin). */
export async function getUserSpaces(id: string): Promise<UserSpacesResponse> {
  return apiJson<UserSpacesResponse>(userSpaces(id));
}

/**
 * PUT /api/v1/users/{id}/spaces (admin) — the whole wanted set (space short
 * ids; personal spaces are not accepted), applied in one operation: added
 * spaces make the user a member at once, removed ones are removals with
 * their consequences. Refusals: 422 `owner_cannot_be_removed`, `no_seats`
 * (carries `spaceId`), `external_user`, `concurrent_change`; 404
 * `user_not_found`; 403 `not_admin`.
 */
export async function putUserSpaces(id: string, spaceIds: string[]): Promise<UserSpacesResponse> {
  return apiJson<UserSpacesResponse>(userSpaces(id), {
    method: 'PUT',
    body: JSON.stringify({ spaceIds }),
  });
}

/** POST /api/v1/users/{id}/spaces/preview (admin) — what PUT with the same set would do. */
export async function previewUserSpaces(id: string, spaceIds: string[]): Promise<UserSpacesPreview> {
  return apiJson<UserSpacesPreview>(`${userSpaces(id)}/preview`, {
    method: 'POST',
    body: JSON.stringify({ spaceIds }),
  });
}
