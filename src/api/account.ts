/**
 * Own-account client (sk-674.18, T050) — the logged-in account routes of
 * the skein-api contract `internal/spaces/contract.go` (T013): the account
 * as the database holds it now (with `emailConfirmed` / `hasApiKeys`), the
 * confirmation email, and account deletion. Reached through the BFF proxy.
 *
 * The cookie-derived `/api/auth/me` of `auth.ts` stays the session check;
 * this module reads `/api/v1/auth/me`, which skein-api refetches from the
 * database on every call.
 */

import { apiFetch, apiJson } from './client';
import type { EmailLanguage } from './auth';
import type { SpaceKind, SpaceRef } from './spaces';

/** 200 body of GET /api/v1/auth/me. */
export interface MyAccount {
  id: string;
  /** Login email, lowercased. */
  email: string;
  username: string;
  name: string;
  role: 'admin' | 'user';
  isExternal: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  /**
   * The email is confirmed (the closed set of spec US-5). Additive field of
   * T037: absent until skein-api serves it.
   */
  emailConfirmed?: boolean;
  /**
   * The user has at least one active API key. Additive field of T037:
   * absent until skein-api serves it.
   */
  hasApiKeys?: boolean;
}

/** GET /api/v1/auth/me — the caller's account, fresh from the database. */
export async function getMyAccount(): Promise<MyAccount> {
  return apiJson<MyAccount>('/api/v1/auth/me');
}

/**
 * POST /api/v1/me/email/confirmation — queue a confirmation email (the
 * latest link is the one that works). 204; an already confirmed email is
 * 204 with nothing sent. Refusals: 422 `email_disabled`, 429.
 */
export async function requestEmailConfirmation(language: EmailLanguage): Promise<void> {
  await apiFetch('/api/v1/me/email/confirmation', {
    method: 'POST',
    body: JSON.stringify({ language }),
  });
}

// ───────────────────────── Account deletion ─────────────────────────

/** A space that blocks deletion: owned with other members, or the common space. */
export interface BlockingSpace extends SpaceRef {
  kind: Extract<SpaceKind, 'common' | 'regular'>;
  memberCount: number;
}

/** A space deleted with the account: the personal one and owned spaces where the caller is alone. */
export interface DeletedSpacePreview extends SpaceRef {
  kind: Extract<SpaceKind, 'personal' | 'regular'>;
  projectCount: number;
}

/** 200 body of GET /api/v1/me/deletion-preview. */
export interface AccountDeletionPreview {
  /** Empty = deletion possible. */
  blocking: BlockingSpace[];
  deleted: DeletedSpacePreview[];
  /** Open issues in other spaces that lose the caller as assignee. */
  openAssignedIssues: number;
}

/** GET /api/v1/me/deletion-preview. Refusal: 422 `account_deletion_disabled`. */
export async function getAccountDeletionPreview(): Promise<AccountDeletionPreview> {
  return apiJson<AccountDeletionPreview>('/api/v1/me/deletion-preview');
}

/**
 * DELETE /api/v1/me — the account is deleted at once and for good; every
 * session and API key is revoked. 204. Refusals: 422
 * `account_deletion_disabled`, `owns_spaces_with_members`,
 * `owns_common_space`, `invalid_credentials`.
 */
export async function deleteMyAccount(password: string): Promise<void> {
  await apiFetch('/api/v1/me', {
    method: 'DELETE',
    body: JSON.stringify({ password }),
  });
}
