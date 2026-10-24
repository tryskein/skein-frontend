/**
 * Client for `GET /api/v1/me/notification-counts` (B6).
 *
 * Wire shape mirrors `notificationCountsResponse` in
 * `projects/skein-api/src/internal/handler/me.go` — lowercase camelCase
 * fields driving the header badges of the new shell:
 *
 *   - `inbox`    — open, unaccepted issues assigned to me, plus (sk-674.18,
 *                  T029/T040) my pending space invitations; still across
 *                  every space — the header badges are not narrowed by space
 *   - `mentions` — unread mention notifications
 *   - `watching` — unread feed notifications attributed to my
 *                  subscriptions. The rule is «there is a subscription», nothing
 *                  more: it says NOTHING about who authored the issue,
 *                  so an issue I created and still watch counts here
 *                  like anyone else's (sk-303.13 / US-9, contract C3).
 *                  Equal by construction to `unreadTotal` of
 *                  `GET /api/v1/me/watching` — same SQL on the server.
 *
 * The `outbox` field is GONE, not zeroed (sk-303.13 / US-9, contract
 * C2). A zero would have kept the contract alive and let the header
 * paint a permanently empty badge; an absent field cannot. Nothing here
 * breaks on its absence either way — the fetch below spreads the wire
 * response over an all-zero literal, so any field this build knows and
 * the server omits reads as 0 rather than `undefined`.
 *   - `onMeOpenCount`      — non-closed issues in my "On me" lens
 *                            (assignee = me ∧ createdBy ≠ me ∧
 *                             acceptedAt ≠ null ∧ status ≠ closed),
 *                            aggregated across every visible project (sk-54)
 *   - `delegatedOpenCount` — non-closed issues in my "Delegated" lens
 *                            (createdBy = me ∧ assignee ≠ me ∧
 *                             status ≠ closed, with the sticky
 *                             previous-assignee chain), global (sk-54)
 *
 * Endpoint is cookie-only by design (server-side `caller(r)` requires
 * the BFF-injected user headers); MCP clients fetch the same data via
 * `skein_notifications(action="inbox")` / `skein_prime`.
 */
import { apiJson } from './client';

export interface NotificationCounts {
  /**
   * Unaccepted issues assigned to me + pending invitations to me
   * (sk-674.18, T029). Not narrowed by space.
   */
  inbox: number;
  mentions: number;
  watching: number;
  /**
   * Non-closed issues in the caller's "On me" lens (sk-54). Drives the
   * live "On me" tab badge. Older API builds that predate sk-54 omit
   * this field — getNotificationCounts normalizes the response against
   * EMPTY_NOTIFICATION_COUNTS, so a missing field becomes 0 (not
   * undefined) and the badge renders 0 cleanly rather than NaN.
   */
  onMeOpenCount: number;
  /**
   * Non-closed issues in the caller's "Delegated" lens (sk-54). Drives
   * the live "Delegated" tab badge. Same forward-compat note as
   * onMeOpenCount.
   *
   * sk-303.14 / SC-014 — the review workflow left this field's value AND
   * its meaning alone: still NON-CLOSED work currently sitting with other
   * people, the sticky previous-assignee chain included. The second number
   * below comes from a DIFFERENT set, and the gap between them is a
   * membership rule, not a loss.
   */
  delegatedOpenCount: number;

  /**
   * sk-303.14 (contract C2, US-6, SC-016) — the EXPLICIT "is the review
   * mechanic on for me" flag (INV-6).
   *
   * This flag, and nothing else, separates «there is no second number at
   * all» from «the second number is zero». Read it, never the number.
   *
   * Why a flag has to exist at all is visible three lines down in this very
   * file: `getNotificationCounts` spreads the wire response over
   * `EMPTY_NOTIFICATION_COUNTS`, so a field the server omitted arrives here
   * as its default and «no key» is indistinguishable from «key present and
   * empty». That normalisation is deliberate (badges must never render
   * `undefined`) and it is exactly the trap the spec forbids branching on.
   */
  reviewMechanicEnabled: boolean;

  /**
   * sk-303.14 (contract C2) — the SECOND number: the size of the caller's
   * unreviewed set (closed results they created, delegated, and have not
   * marked read yet).
   *
   * The wire key is ALWAYS present: `null` when the mechanic is off, a
   * number when it is on. `null` is at least observable, unlike an absent
   * key — but it is still not the authority. `reviewMechanicEnabled` is.
   *
   * sk-411 — nothing in the shell reads this field any more: the second
   * number it fed was removed from the Delegated control by a product
   * decision. It stays here because it is the response shape the API sends.
   *
   * INV-13 — this number lives ONLY on the Delegated control, in the
   * unreviewed selection and in the digest. Project / component tree row
   * counters and the Tasks column do not carry it and do not recompute it.
   */
  delegatedUnreviewedCount: number | null;
}

/*
 * sk-411 — `unreviewedBadge()` stood here and decided whether the second
 * number was drawn on the Delegated control. The control now draws one
 * number, by a product decision, so the helper had no readers left and went
 * with it. The two wire fields above stay: they are the response shape the
 * API sends, and `outboxSurfaceRemoved.test.tsx` asserts it.
 */

/**
 * All-zero counts. Exported so the boundary fetch below and the hook's
 * first-paint default share one definition. The fetch spreads the wire
 * response over this, so an older API build that omits a field
 * (e.g. pre-sk-54, no `onMeOpenCount`) yields 0 for it rather than
 * `undefined` — the forward-compat promise the field docs make.
 */
export const EMPTY_NOTIFICATION_COUNTS: NotificationCounts = {
  inbox: 0,
  mentions: 0,
  watching: 0,
  onMeOpenCount: 0,
  delegatedOpenCount: 0,
  // sk-303.14 — the safe default for the review workflow is "off": a build
  // talking to an API that predates the contract must show NO second number
  // rather than a confident "0", which would assert "nothing waiting" about
  // a set the server never counted.
  reviewMechanicEnabled: false,
  delegatedUnreviewedCount: null,
};

export async function getNotificationCounts(): Promise<NotificationCounts> {
  const raw = await apiJson<Partial<NotificationCounts>>(
    '/api/v1/me/notification-counts',
    { method: 'GET' },
  );
  // Per-field default: a field absent from the wire (older API) becomes 0,
  // not undefined — so badges never render `undefined` / NaN.
  return { ...EMPTY_NOTIFICATION_COUNTS, ...raw };
}
