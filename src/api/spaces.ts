/**
 * Spaces REST client (sk-674.18, T050) — TypeScript mirror of the skein-api
 * contract `internal/spaces/contract.go` (T013): the space routes, their
 * DTOs and the single registry of refusal codes shared by REST and MCP.
 *
 * Every path, JSON name and code below is a stable cross-repository
 * contract: additive changes only. Invitations live in `invitations.ts`,
 * the account routes (email confirmation, deletion) in `account.ts`, the
 * prefix routes in `projects.ts`, a user's spaces (admin) in `users.ts` and
 * the claim release in `issues.ts` — the same contract, split by surface.
 *
 * Identifiers: a space is named by its short id — 8 lowercase base32
 * characters (`k3x9p2qa`), stable for the life of the space. It is the `id`
 * of every space DTO, the `{id}` of every `/spaces/{id}` route and the value
 * of every `spaceId` field anywhere in the API. The slug forms the address
 * `/spaces/<id>-<slug>` and is never looked up: a stale slug still resolves.
 *
 * Refusals arrive as `{"error":"<code>","message":"…"}` plus the extra
 * fields named at the code; `apiFetch` turns them into `BusinessError` (422),
 * `ApiError` (403, 404 `space_not_found`) and `RateLimitError` (429). Branch
 * on `code`, never on `message`. Two 403 codes are told apart:
 *  - `forbidden` — the caller sees the space but its role in it does not
 *    allow the action (a member renaming the space or inviting);
 *  - `not_admin` — a route marked "admin" (POST …/members, POST …/owner,
 *    `/users/{id}/spaces*`) called by a non-admin: the RequireAdmin refusal.
 */

import { apiFetch, apiJson } from './client';
import type { PersonStatus } from './users';

// ───────────────────────── Enumerations ─────────────────────────

/** Space kind: the owner's personal space, the common space, or a regular one. */
export type SpaceKind = 'personal' | 'common' | 'regular';

/** Role in a space. */
export type SpaceRole = 'owner' | 'member';

/** Project visibility inside its space (`visibility` on project rows). */
export type ProjectVisibility = 'space' | 'members';

/**
 * Invitation status as the space owner and the admin see it: `pending`
 * waits for an answer and occupies a seat; `not_accepted` (declined) is
 * shown neutrally for 7 days without details and occupies no seat.
 */
export type SpaceInvitationStatus = 'pending' | 'not_accepted';

// ───────────────────────── Code registry (SC-012) ─────────────────────────

/**
 * Refusal codes of the spaces feature — the `code` of a `BusinessError`
 * (422 unless stated otherwise). One list for REST and MCP. The same
 * decision yields the same code everywhere, so e.g.
 * `MySpacesResponse.cannotCreateReason` is the code `POST /spaces` would
 * return.
 */
export const SpaceErrorCode = {
  /** 404: the space does not exist or the caller may not see it (indistinguishable, INV-3). */
  SpaceNotFound: 'space_not_found',

  // — creating a space (also `cannotCreateReason` of GET /me/spaces) —
  /** SKEIN_SPACE_OWNED_LIMIT reached; carries `ownedCount`, `ownedLimit`. Never for an admin. */
  OwnedLimit: 'owned_limit',
  /** SKEIN_SPACE_CREATION=admin and the caller is not one. */
  AdminOnly: 'admin_only',
  /** SKEIN_SPACE_CREATION=none. */
  SpaceCreationDisabled: 'space_creation_disabled',
  /** The user is external: owns no space, is not invited to or added to spaces. */
  ExternalUser: 'external_user',

  // — settings and deletion —
  /** The action does not exist for a personal space. */
  PersonalSpace: 'personal_space',
  /** DELETE /spaces/{id}: the typed confirmation is not the space name. */
  NameMismatch: 'name_mismatch',
  /** The common space still has projects. */
  CommonSpaceNotEmpty: 'common_space_not_empty',
  /** The empty common space cannot be deleted while SKEIN_COMMON_SPACE_ENABLED=true. */
  CommonSpaceEnabled: 'common_space_enabled',

  // — members —
  /** The owner cannot leave; change the owner first. */
  OwnerCannotLeave: 'owner_cannot_leave',
  /** The owner cannot be removed; change the owner first. */
  OwnerCannotBeRemoved: 'owner_cannot_be_removed',
  /** The user named is not a member of the space. */
  NotAMember: 'not_a_member',
  /** The user is already a member (direct add by an admin). */
  AlreadyMember: 'already_member',
  /** SKEIN_SPACE_MEMBER_LIMIT reached; carries `memberCount`, `pendingInvitations`, `memberLimit` (and `spaceId` on PUT /users/{id}/spaces). */
  NoSeats: 'no_seats',
  /** A project member present through the space cannot be removed from the project alone (US-17). */
  MemberViaSpace: 'member_via_space',
  /** A membership operation lost to a concurrent one; nothing changed — repeat. */
  ConcurrentChange: 'concurrent_change',

  // — invitations —
  /** Registration is closed and no account has this email. */
  NoSuchUser: 'no_such_user',
  /** Mail is off and the invited email has no account. */
  EmailDisabled: 'email_disabled',
  /** SKEIN_SPACE_INVITES_PER_DAY reached for the sender. */
  DailyLimit: 'daily_limit',
  /** Suspicious invitation rate: repeat with `turnstileToken`. */
  CaptchaRequired: 'captcha_required',
  /** The Turnstile token did not verify. */
  CaptchaFailed: 'captcha_failed',
  /** Resend of an invitation that is no longer pending. */
  InvitationNotPending: 'invitation_not_pending',
  /** Accept/decline of an invitation that expired, was revoked or used. */
  InvitationInvalid: 'invitation_invalid',
  /** Accept/decline of an invitation whose space was deleted. */
  SpaceDeleted: 'space_deleted',
  /** Accept from Inbox while mail is on and the caller's email is not confirmed. */
  EmailUnconfirmed: 'email_unconfirmed',
  /** Accept/decline by token by a logged-in user whose email is not the invited one. */
  InvitationOtherEmail: 'invitation_other_email',
  /** MCP only: an agent cannot accept or decline an invitation. */
  InvitationAgentForbidden: 'invitation_agent_forbidden',

  // — quotas —
  /** Project quota reached (archived count); carries `spaceId`, `projectCount`, `projectQuota`. */
  ProjectQuota: 'project_quota',
  /** Attachment storage quota used up; carries `spaceId`, `storageUsedBytes`, `storageQuotaBytes`. */
  StorageQuota: 'storage_quota',

  // — projects —
  /** The project prefix is taken (neutral); carries `suggestions`: 2–3 free prefixes. */
  PrefixTaken: 'prefix_taken',
  /** The prefix breaks the prefix rule. */
  PrefixInvalid: 'prefix_invalid',
  /** A project with this name exists in the space. */
  ProjectNameTaken: 'project_name_taken',
  /** PATCH /projects/{id} tried to move the project to another space; nothing changed. */
  SpaceChangeForbidden: 'space_change_forbidden',
  /** POST /projects without spaceId while the caller can create in more than one space; carries `spaces`. */
  SpaceRequired: 'space_required',
  /**
   * The action needs membership of the space and the caller only has the
   * admin's access (`adminAccess`): creating a project there. Remedy: add
   * oneself as a member. Inside the space's projects the admin has the
   * owner's rights and may be the assignee without membership (sk-741).
   * Carries `spaceId`.
   */
  NotSpaceMember: 'not_space_member',
  /**
   * The assignee chosen by id is no longer allowed for the issue (left the
   * space, lost access to the project) between the choice and the save; the
   * previous assignment is kept.
   */
  AssigneeNotAllowed: 'assignee_not_allowed',
  /** A project string resolved to several accessible projects by exact name; carries `candidates`. */
  AmbiguousProject: 'ambiguous_project',
  /** The caller may not release another holder's claim. */
  ForceUnlockForbidden: 'force_unlock_forbidden',

  // — account deletion —
  /** DELETE /me while registration is closed: accounts are managed by the admin. */
  AccountDeletionDisabled: 'account_deletion_disabled',
  /** The caller owns spaces with other people; they must be deleted first. */
  OwnsSpacesWithMembers: 'owns_spaces_with_members',
  /** The caller owns the common space; an admin must change its owner first. */
  OwnsCommonSpace: 'owns_common_space',
  /** The confirming password is wrong. */
  InvalidCredentials: 'invalid_credentials',
} as const;

/** A value of {@link SpaceErrorCode}. */
export type SpaceErrorCodeValue = (typeof SpaceErrorCode)[keyof typeof SpaceErrorCode];

/**
 * Why a space cannot be created now — `cannotCreateReason` of
 * GET /me/spaces, equal to the code POST /spaces would return.
 */
export type CannotCreateSpaceReason =
  | typeof SpaceErrorCode.OwnedLimit
  | typeof SpaceErrorCode.AdminOnly
  | typeof SpaceErrorCode.SpaceCreationDisabled
  | typeof SpaceErrorCode.ExternalUser;

/** Why a space cannot be deleted now — `SpaceDetail.cannotDeleteReason`. */
export type CannotDeleteSpaceReason =
  | typeof SpaceErrorCode.PersonalSpace
  | typeof SpaceErrorCode.CommonSpaceNotEmpty
  | typeof SpaceErrorCode.CommonSpaceEnabled
  | 'forbidden';

// ───────────────────────── Shared DTOs ─────────────────────────

/** Names a space. */
export interface SpaceRef {
  /** Space short id. */
  id: string;
  /** Address slug. */
  slug: string;
  /** Space name (not unique). */
  name: string;
}

// ───────────────────────── Structural refusals ─────────────────────────
//
// Extra fields of refusals that carry data beside `error` / `message` — the
// `extra` of the thrown `BusinessError`, typed here.

/**
 * `extra` of 422 `space_required` (POST /projects without `spaceId` while
 * several spaces are eligible): every space GET /me/spaces lists with
 * `canCreateProject=true`, in column order, so the client can ask.
 */
export interface SpaceRequiredRefusal {
  spaces: SpaceRef[];
}

/** One accessible project of an `ambiguous_project` refusal — enough to tell same-named projects apart. */
export interface AmbiguousProjectCandidate {
  /** The project prefix — an exact handle to re-call with. */
  idPrefix: string;
  name: string;
  /** Short id of the project's space. */
  spaceId: string;
  spaceName: string;
}

/**
 * `extra` of 422 `ambiguous_project`: a project string matched several
 * ACCESSIBLE projects by exact name (INV-29). Never names a project the
 * caller cannot see. The same body in REST and MCP.
 */
export interface AmbiguousProjectRefusal {
  /** The string as the caller sent it. */
  q: string;
  candidates: AmbiguousProjectCandidate[];
}

/** `extra` of 422 `not_space_member`: the space the caller only has admin access to. */
export interface NotSpaceMemberRefusal {
  spaceId: string;
}

/** Names a project. */
export interface ProjectRef {
  /** Project id (UUID). */
  id: string;
  name: string;
  idPrefix: string;
}

// ───────────────────────── GET /me/spaces ─────────────────────────

/** One space of GET /me/spaces. */
export interface MySpace {
  id: string;
  slug: string;
  name: string;
  kind: SpaceKind;
  /** null for the admin in a space they are not a member of (then `adminAccess` is true). */
  myRole: SpaceRole | null;
  /** The instance admin in a space they are not in: owner rights over the space itself, no project rights. */
  adminAccess: boolean;
  /** The caller may create projects here: every member; external users and admin-access never. */
  canCreateProject: boolean;
  memberCount: number;
  /** SKEIN_SPACE_MEMBER_LIMIT; null = no limit (always null for personal and common). */
  memberLimit: number | null;
  /** Pending invitations (they occupy seats); 0 for the personal space. */
  pendingInvitations: number;
  /** Projects of the space, archived included. */
  projectCount: number;
  /** Project quota; null = no quota. */
  projectQuota: number | null;
  /** Attachment bytes stored in the space. */
  storageUsedBytes: number;
  /** Storage quota in bytes; null = no quota. */
  storageQuotaBytes: number | null;
}

/**
 * 200 body of GET /api/v1/me/spaces: every space the caller sees, whole,
 * in projects-column order (personal → common → the rest by name). An
 * external user gets none.
 */
export interface MySpacesResponse {
  items: MySpace[];
  /** Spaces owned, personal and common not counted. */
  ownedCount: number;
  /** SKEIN_SPACE_OWNED_LIMIT; null = no limit. */
  ownedLimit: number | null;
  /** POST /spaces would be allowed now. */
  canCreate: boolean;
  /** null when `canCreate`, otherwise the code POST /spaces would return. */
  cannotCreateReason: CannotCreateSpaceReason | null;
}

/** GET /api/v1/me/spaces. */
export async function getMySpaces(): Promise<MySpacesResponse> {
  return apiJson<MySpacesResponse>('/api/v1/me/spaces');
}

// ───────────────────────── POST /spaces ─────────────────────────

export interface CreateSpaceInput {
  /** Required, not unique. */
  name: string;
  /** Admin only; omitted = the caller. An admin naming someone else does not become a member. */
  ownerId?: string;
}

/** 201 body of POST /api/v1/spaces. */
export interface CreateSpaceResponse {
  id: string;
  slug: string;
}

/**
 * POST /api/v1/spaces — a new regular space. Refusals: 422 `owned_limit`,
 * `admin_only`, `space_creation_disabled`, `external_user`; 400
 * `validation_error`; 403 `forbidden` (ownerId from a non-admin).
 */
export async function createSpace(input: CreateSpaceInput): Promise<CreateSpaceResponse> {
  return apiJson<CreateSpaceResponse>('/api/v1/spaces', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

// ───────────────────────── GET / PATCH / DELETE /spaces/{id} ─────────────────────────

/** One member of a space — a person object (`PersonStatus`). */
export interface SpaceMember extends PersonStatus {
  userId: string;
  username: string;
  name: string;
  role: SpaceRole;
  /** A deactivated account (membership stays). */
  deactivated: boolean;
}

/** One invitation as the space owner and the admin see it. */
export interface SpaceInvitation {
  id: string;
  /** The invited email, lowercased — shown only to those who manage it. */
  email: string;
  status: SpaceInvitationStatus;
  /** Username of the sender. */
  invitedBy: string;
  /** Expiry of a pending invitation (RFC 3339 UTC); null for not_accepted. */
  expiresAt: string | null;
  /** When it was (last) sent. */
  createdAt: string;
}

/** 200 body of GET /spaces/{id}, PATCH /spaces/{id} and POST /spaces/{id}/owner. */
export interface SpaceDetail extends MySpace {
  /** Owner first, then by username. */
  members: SpaceMember[];
  /** Pending and recently declined, newest first; null for a member (may not manage them). */
  invitations: SpaceInvitation[] | null;
  /** DELETE would be allowed now for the caller. */
  canDelete: boolean;
  /** null when `canDelete`, otherwise the refusal code. */
  cannotDeleteReason: CannotDeleteSpaceReason | null;
}

const spaceBase = (id: string) => `/api/v1/spaces/${encodeURIComponent(id)}`;

/** GET /api/v1/spaces/{id}. 404 `space_not_found` for a space the caller may not see. */
export async function getSpace(id: string): Promise<SpaceDetail> {
  return apiJson<SpaceDetail>(spaceBase(id));
}

/** PATCH /api/v1/spaces/{id} (owner, admin). Refusals: 422 `personal_space`; 400; 403 `forbidden`. */
export async function renameSpace(id: string, name: string): Promise<SpaceDetail> {
  return apiJson<SpaceDetail>(spaceBase(id), {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  });
}

/**
 * DELETE /api/v1/spaces/{id} (owner, admin) — irreversible: every project,
 * issue and attachment. `confirmName` is the space name typed by the person,
 * compared exactly by the server. 204. Refusals: 422 `name_mismatch`,
 * `personal_space`, `common_space_not_empty`, `common_space_enabled`; 403 `forbidden`.
 */
export async function deleteSpace(id: string, confirmName: string): Promise<void> {
  await apiFetch(spaceBase(id), {
    method: 'DELETE',
    body: JSON.stringify({ confirmName }),
  });
}

/** 200 body of GET /spaces/{id}/deletion-preview: what DELETE would destroy, now. */
export interface SpaceDeletionPreview {
  /** Archived included. */
  projectCount: number;
  issueCount: number;
  storageBytes: number;
  /** Invitations that will be revoked. */
  pendingInvitations: number;
  /** The owner — the admin's dialog names them. */
  ownerUsername: string;
}

/** GET /api/v1/spaces/{id}/deletion-preview (owner, admin). */
export async function getSpaceDeletionPreview(id: string): Promise<SpaceDeletionPreview> {
  return apiJson<SpaceDeletionPreview>(`${spaceBase(id)}/deletion-preview`);
}

// ───────────────────────── Members ─────────────────────────

/**
 * 200 body of GET /spaces/{id}/members/{userId}/removal-preview: the
 * consequences of removing that member, or of the caller leaving
 * (`userId` = the caller). The same numbers the removal then produces.
 */
export interface MemberRemovalPreview {
  /** Open issues of the space's projects that lose this assignee. */
  openAssignedIssues: number;
  /** Claims of the user and their agents in the space that are released. */
  claimedIssues: number;
  /** Projects where the user has the project owner role; they stay under the space owner. */
  ownedProjects: ProjectRef[];
}

/** GET /api/v1/spaces/{id}/members/{userId}/removal-preview. */
export async function getMemberRemovalPreview(
  spaceId: string,
  userId: string,
): Promise<MemberRemovalPreview> {
  return apiJson<MemberRemovalPreview>(
    `${spaceBase(spaceId)}/members/${encodeURIComponent(userId)}/removal-preview`,
  );
}

/**
 * DELETE /api/v1/spaces/{id}/members/{userId} (owner, admin) — 204; access
 * to the space's projects is revoked (INV-12). Refusals: 422
 * `owner_cannot_be_removed`, `not_a_member`, `personal_space`,
 * `concurrent_change`; 403 `forbidden`.
 */
export async function removeSpaceMember(spaceId: string, userId: string): Promise<void> {
  await apiFetch(`${spaceBase(spaceId)}/members/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
  });
}

/**
 * POST /api/v1/spaces/{id}/leave (a member) — 204. Refusals: 422
 * `owner_cannot_leave`, `not_a_member`, `personal_space`,
 * `concurrent_change`; 403 `forbidden`.
 */
export async function leaveSpace(spaceId: string): Promise<void> {
  await apiFetch(`${spaceBase(spaceId)}/leave`, { method: 'POST' });
}

/**
 * POST /api/v1/spaces/{id}/members (admin only) — the user becomes a member
 * at once; a pending invitation of theirs to this space is closed as
 * accepted. Refusals: 422 `external_user`, `already_member`, `no_seats`,
 * `personal_space`, `concurrent_change`; 403 `not_admin`.
 */
export async function addSpaceMember(spaceId: string, userId: string): Promise<SpaceMember> {
  return apiJson<SpaceMember>(`${spaceBase(spaceId)}/members`, {
    method: 'POST',
    body: JSON.stringify({ userId }),
  });
}

/**
 * POST /api/v1/spaces/{id}/owner (admin only) — the new owner must already
 * be a member; the previous one stays a member. Refusals: 422
 * `not_a_member`, `personal_space`; 403 `not_admin`.
 */
export async function changeSpaceOwner(spaceId: string, userId: string): Promise<SpaceDetail> {
  return apiJson<SpaceDetail>(`${spaceBase(spaceId)}/owner`, {
    method: 'POST',
    body: JSON.stringify({ userId }),
  });
}
