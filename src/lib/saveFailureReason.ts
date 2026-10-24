/**
 * sk-425 — why an inline save was refused, in words for the editor.
 *
 * Three cases, in the order the API can produce them (skein-api
 * `handler/issues.go`, both 422 with a stable `error` code):
 *
 *   - `locked_by_other` — the issue is claimed (an agent's MCP session
 *     holds it) and a REST write carries no session, so every save is
 *     refused while the claim lasts. The body's `lockedBy` is a SESSION
 *     id and is never shown; the holder is named by the card's own
 *     `lockedByUsername`, which the card already displays — nothing is
 *     disclosed that the reader cannot already see. Unknown holder →
 *     "another session".
 *   - `version_conflict` — someone saved first. In an editor the text is
 *     kept and a retry writes it over the new version; for a header
 *     field (`where: 'field'`) there is no text to keep and no retry —
 *     the card is re-read and the reader picks again.
 *   - anything else — the error's own message, as before.
 *
 * sk-492 — the ONE place a refused card save is worded. The inline
 * editors (the four text sections, the title) print it under the editor;
 * the header fields (priority, type), which have no room for it in place,
 * get it in the save toast `useIssueDetail#updateField` raises. The
 * editors suppress that toast, so the reason is never said twice.
 */

import type { TFunction } from 'i18next';
import { ApiError, BusinessError } from '../api/client';
import { SpaceErrorCode, type AmbiguousProjectCandidate } from '../api/spaces';

/**
 * sk-425 — the API refuses a stale `If-Match` with 422
 * `version_conflict` (skein-api `handler/issues.go`); a 409 is accepted
 * too, as the toast formatter always did.
 *
 * Lives here, not in `useIssueDetail`, since sk-492: the hook now words
 * its save toast through `saveFailureReason`, and the two modules
 * importing each other would be a cycle.
 */
export function isVersionConflict(err: unknown): boolean {
  if (err instanceof BusinessError || err instanceof ApiError) {
    return err.code === 'version_conflict' || err.statusCode === 409;
  }
  return false;
}

export function saveFailureReason(
  err: Error,
  t: TFunction<'details'>,
  lockedByUsername: string | null | undefined,
  where: 'editor' | 'field' = 'editor',
): string {
  if (err instanceof BusinessError && err.code === 'locked_by_other') {
    return lockedByUsername
      ? t('editable.reason.lockedBy', { user: lockedByUsername })
      : t('editable.reason.locked');
  }
  if (isVersionConflict(err)) {
    return where === 'field'
      ? t('editable.reason.versionConflictField')
      : t('editable.reason.versionConflict');
  }
  return refusalReason(err, t) ?? err.message;
}

/**
 * sk-674.18 T055 — the refusals of the spaces feature that a card's links
 * and people can meet, each in its own words (screens 1.10, US-13, US-14,
 * US-16): the code of the refusal picks the message, never its English
 * `message`. One place for every surface of the card that reports a
 * refused save in a toast or under an editor — header fields and editors
 * (`saveFailureReason` above), "Dependencies", "Move", the claim
 * release — so a code reads the same wherever it arrives.
 *
 *   - `ambiguous_project` — a project string matched several accessible
 *     projects by exact name; the candidates are named by prefix and
 *     space so the reader can repeat with the prefix (INV-29).
 *   - `force_unlock_forbidden` — only the project owner, the space owner
 *     and the admin release another holder's claim (US-16).
 *   - `assignee_not_allowed` — the person chosen left the space or lost
 *     the project between the choice and the save; the previous
 *     assignment is kept (INV-30).
 *   - `not_space_member` — the admin's access to a space is not
 *     membership: becoming assignee or project member needs it.
 *   - `member_via_space` — a member present through the space cannot be
 *     removed from the project alone (US-17).
 *   - `concurrent_change` — a membership operation lost to a concurrent
 *     one; nothing changed, repeat.
 *   - `storage_quota` / `project_quota` — the space's quota is used up
 *     (US-14); the attachment zone words the first one at the upload
 *     (`AttachmentDropzone.tsx#describeError`).
 *
 * Any other refusal returns null: the caller keeps its own wording.
 */
/** The words for a refusal of the spaces feature, or null for any other error. */
export function refusalReason(err: unknown, t: TFunction<'details'>): string | null {
  if (!(err instanceof BusinessError)) return null;
  switch (err.code) {
    case SpaceErrorCode.AmbiguousProject: {
      const raw = err.extra.candidates;
      const candidates = Array.isArray(raw) ? (raw as AmbiguousProjectCandidate[]) : [];
      const list = candidates
        .map((c) => t('refusal.ambiguousProjectCandidate', { prefix: c.idPrefix, space: c.spaceName }))
        .join(', ');
      return list === ''
        ? t('refusal.ambiguousProjectBare')
        : t('refusal.ambiguousProject', { candidates: list });
    }
    case SpaceErrorCode.ForceUnlockForbidden:
      return t('refusal.forceUnlockForbidden');
    case SpaceErrorCode.AssigneeNotAllowed:
      return t('refusal.assigneeNotAllowed');
    case SpaceErrorCode.NotSpaceMember:
      return t('refusal.notSpaceMember');
    case SpaceErrorCode.MemberViaSpace:
      return t('refusal.memberViaSpace');
    case SpaceErrorCode.ConcurrentChange:
      return t('refusal.concurrentChange');
    case SpaceErrorCode.StorageQuota:
      return t('refusal.storageQuota');
    case SpaceErrorCode.ProjectQuota:
      return t('refusal.projectQuota');
    default:
      return null;
  }
}
