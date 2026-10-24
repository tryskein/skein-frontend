/**
 * Invitations client (sk-674.18, T050) — every invitation route of the
 * spaces feature, by who calls it:
 *
 *  - the space owner / admin (`/api/v1/spaces/{id}/invitations/*`) and the
 *    addressee from Inbox (`/api/v1/me/invitations/*`) — skein-api contract
 *    `internal/spaces/contract.go` (T013), through the BFF proxy;
 *  - a logged-in tab opening an invitation link (`/api/v1/invitations/{token}`)
 *    — the same contract;
 *  - a visitor WITHOUT a session (`/api/auth/invitations/{token}`) — the
 *    public BFF routes of `skein-web/src/Auth/UserDto.cs#PublicAuthRoutes`
 *    (T044), relaying skein-api `internal/accounts/contract.go` (T012).
 *
 * Refusal codes are `SpaceErrorCode` (spaces routes) and `AccountErrorCode`
 * (public BFF routes). Tokens travel only in the path and are never logged
 * or stored by this module.
 */

import { apiFetch, apiJson } from './client';
import type { EmailLanguage, User } from './auth';
import type { MySpace, SpaceInvitation, SpaceRef } from './spaces';

const spaceInvitations = (spaceId: string) =>
  `/api/v1/spaces/${encodeURIComponent(spaceId)}/invitations`;

// ───────────────────────── Owner / admin ─────────────────────────

/** Fields of POST /spaces/{id}/invitations besides the addressee. */
interface CreateInvitationCommon {
  /**
   * The inviter's interface language — the language of the invitation email
   * (spec: "the invitation is in the inviter's language"); required. Stored with the
   * invitation, not on anyone's profile; a resend reuses it.
   */
  language: EmailLanguage;
  /** Required only after `captcha_required`. */
  turnstileToken?: string;
}

/** Body of POST /spaces/{id}/invitations — exactly one of `email` or `userId`. */
export type CreateInvitationInput =
  | (CreateInvitationCommon & { email: string; userId?: never })
  | (CreateInvitationCommon & { userId: string; email?: never });

/**
 * Non-error outcome of creating an invitation: `sent`; `already_member`
 * (nothing created, informational); `already_pending` (registration closed
 * only — the existing invitation is returned so the form can offer resend).
 */
export type CreateInvitationOutcome = 'sent' | 'already_member' | 'already_pending';

/** 200 body of POST /spaces/{id}/invitations. */
export interface CreateInvitationResponse {
  outcome: CreateInvitationOutcome;
  /** The pending invitation for `already_pending`; null otherwise. */
  invitation: SpaceInvitation | null;
}

/**
 * POST /api/v1/spaces/{id}/invitations (owner, admin). A person picked from
 * the directory is sent by `userId` — the directory never discloses emails.
 * With registration open the answer is always a neutral `sent`. Refusals:
 * 422 `no_such_user`, `email_disabled` (registration closed, no account),
 * `external_user`, `no_seats`, `daily_limit`, `captcha_required`,
 * `captcha_failed`, `personal_space`; 403 `forbidden`; 400 `validation_error`
 * (neither or both of email/userId, malformed email, unknown `language`).
 */
export async function createInvitation(
  spaceId: string,
  input: CreateInvitationInput,
): Promise<CreateInvitationResponse> {
  return apiJson<CreateInvitationResponse>(spaceInvitations(spaceId), {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/**
 * POST /spaces/{id}/invitations/{invId}/resend (owner, admin) — a new token
 * and expiry; the old link stops working. The email is written in the
 * language stored with the invitation at creation (the original inviter's),
 * whoever resends it. A resend is a send of whoever resends: the same daily
 * limit and captcha rule as a creation (T067, api `spaces/contract.go`
 * `ResendInvitationRequest`) — the body `{"turnstileToken"}` goes only after
 * `captcha_required`, otherwise there is no body. Refusals: 422
 * `daily_limit`, `captcha_failed`, `captcha_required`,
 * `invitation_not_pending`; 403; 404 `invitation_not_found`.
 */
export async function resendInvitation(
  spaceId: string,
  invitationId: string,
  turnstileToken?: string,
): Promise<SpaceInvitation> {
  return apiJson<SpaceInvitation>(
    `${spaceInvitations(spaceId)}/${encodeURIComponent(invitationId)}/resend`,
    turnstileToken !== undefined
      ? { method: 'POST', body: JSON.stringify({ turnstileToken }) }
      : { method: 'POST' },
  );
}

/**
 * DELETE /spaces/{id}/invitations/{invId} (owner, admin) — revokes a pending
 * invitation (frees its seat) or removes a not_accepted row. 204. Refusals:
 * 403; 404 `invitation_not_found`.
 */
export async function revokeInvitation(spaceId: string, invitationId: string): Promise<void> {
  await apiFetch(`${spaceInvitations(spaceId)}/${encodeURIComponent(invitationId)}`, {
    method: 'DELETE',
  });
}

// ───────────────────────── Addressee (Inbox) ─────────────────────────

/** One pending invitation addressed to the caller. Never the token or the link. */
export interface MyInvitation {
  id: string;
  spaceId: string;
  spaceName: string;
  /** Sender's username. */
  invitedBy: string;
  /** RFC 3339 UTC. */
  expiresAt: string;
  /** Accept would succeed now. */
  canAccept: boolean;
  /** null when `canAccept`, otherwise `email_unconfirmed`. */
  cannotAcceptReason: 'email_unconfirmed' | null;
}

/** 200 body of GET /api/v1/me/invitations — newest first. */
export interface MyInvitationsResponse {
  items: MyInvitation[];
}

/** 200 body of both accept routes: the space joined, as GET /me/spaces lists it. */
export interface AcceptInvitationResponse {
  space: MySpace;
}

const myInvitation = (id: string) => `/api/v1/me/invitations/${encodeURIComponent(id)}`;

/** GET /api/v1/me/invitations. */
export async function listMyInvitations(): Promise<MyInvitationsResponse> {
  return apiJson<MyInvitationsResponse>('/api/v1/me/invitations');
}

/**
 * POST /api/v1/me/invitations/{invId}/accept. Refusals: 422
 * `invitation_invalid`, `space_deleted`, `email_unconfirmed`.
 */
export async function acceptMyInvitation(id: string): Promise<AcceptInvitationResponse> {
  return apiJson<AcceptInvitationResponse>(`${myInvitation(id)}/accept`, { method: 'POST' });
}

/** POST /api/v1/me/invitations/{invId}/decline — 204; same refusals as accept. */
export async function declineMyInvitation(id: string): Promise<void> {
  await apiFetch(`${myInvitation(id)}/decline`, { method: 'POST' });
}

// ───────────────────────── By token, logged in ─────────────────────────

/**
 * Logged-in states of GET /api/v1/invitations/{token}, in the order checked
 * (screens 2.5).
 */
export type TokenInvitationStatus =
  | 'space_deleted'
  | 'already_member'
  | 'invalid'
  | 'other_email'
  | 'valid';

/**
 * 200 body of GET /api/v1/invitations/{token} for a logged-in caller.
 * Opening it as the invited user confirms that user's email; it accepts
 * nothing.
 */
export interface TokenInvitationView {
  status: TokenInvitationStatus;
  /** For `already_member` and `valid`; null otherwise. */
  space: SpaceRef | null;
  /** For `valid`; null otherwise. */
  inviterUsername: string | null;
  /** For `valid`; null otherwise. */
  expiresAt: string | null;
}

const tokenInvitation = (token: string) => `/api/v1/invitations/${encodeURIComponent(token)}`;

/** GET /api/v1/invitations/{token} (logged-in tab). */
export async function getTokenInvitation(token: string): Promise<TokenInvitationView> {
  return apiJson<TokenInvitationView>(tokenInvitation(token));
}

/**
 * POST /api/v1/invitations/{token}/accept. Refusals: 422
 * `invitation_invalid`, `space_deleted`, `invitation_other_email`.
 */
export async function acceptTokenInvitation(token: string): Promise<AcceptInvitationResponse> {
  return apiJson<AcceptInvitationResponse>(`${tokenInvitation(token)}/accept`, {
    method: 'POST',
  });
}

/** POST /api/v1/invitations/{token}/decline — 204; same refusals as accept. */
export async function declineTokenInvitation(token: string): Promise<void> {
  await apiFetch(`${tokenInvitation(token)}/decline`, { method: 'POST' });
}

// ───────────────────────── By token, no session (public BFF) ─────────────────────────

/** States of the public invitation preview, in the order checked (screens 2.5). */
export type InvitationPreviewStatus = 'space_deleted' | 'invalid' | 'valid';

/**
 * 200 body of GET /api/auth/invitations/{token} — every state is a 200.
 * The fields after `status` are non-null only when `valid`: a dead link
 * reveals nothing about whom it was for. Opening the link changes nothing.
 */
export interface InvitationPreview {
  status: InvitationPreviewStatus;
  space: SpaceRef | null;
  inviterUsername: string | null;
  /** The invited email. */
  email: string | null;
  /** An account with the invited email exists (log in to accept) or not (sign up by invitation). */
  hasAccount: boolean | null;
}

const publicInvitation = (token: string) => `/api/auth/invitations/${encodeURIComponent(token)}`;

/**
 * GET /api/auth/invitations/{token} — for a visitor without a session.
 * Refusals: 400 `invalid_request`, 429 `rate_limited`.
 */
export async function getInvitationPreview(token: string): Promise<InvitationPreview> {
  return apiJson<InvitationPreview>(publicInvitation(token));
}

/**
 * Body of POST /api/auth/invitations/{token}/signup — the email is the
 * invitation's. Like every registration it is protected by Turnstile when
 * a site key is configured.
 */
export interface InvitationSignupInput {
  username: string;
  password: string;
  /** Anything but `true` is `terms_required`. */
  termsAccepted: boolean;
  /**
   * Send when `turnstileSiteKey` of `/api/auth/config` is set (otherwise
   * `captcha_failed`); omit or null when it is null.
   */
  turnstileToken?: string | null;
}

/**
 * 200 body of POST /api/auth/invitations/{token}/signup: the logged-in user
 * plus the space joined; the SPA goes to `/spaces/<space.id>-<space.slug>`.
 */
export interface InvitationSignupResponse extends User {
  space: SpaceRef;
}

/**
 * POST /api/auth/invitations/{token}/signup — the user is logged in
 * (Set-Cookie). Refusals, in this order: 422 `signup_disabled`; 429
 * `rate_limited`; 422 `captcha_failed` (only when Turnstile is configured),
 * `space_deleted`,
 * `invitation_invalid`, `terms_required`, `username_invalid`,
 * `password_weak`, `password_pwned`, `email_taken`, `username_taken`
 * (with `suggestions`); 400.
 */
export async function signupByInvitation(
  token: string,
  input: InvitationSignupInput,
): Promise<InvitationSignupResponse> {
  return apiJson<InvitationSignupResponse>(`${publicInvitation(token)}/signup`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
