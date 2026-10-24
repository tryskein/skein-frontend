/**
 * Client for `GET` / `PUT /api/v1/me/review-prefs` — sk-303.14, contract C4.
 *
 * Five settings of the review workflow: the master switch, the personal
 * default of the per-issue flag, and three schedule parameters. Wire shape
 * mirrors `notifications.ReviewPrefsDTO` in
 * `projects/skein-api/src/internal/notifications/review_prefs.go`.
 *
 * Two things about this contract decide how the form is written:
 *
 *  1. **A schedule parameter has THREE input states, not two.** A number,
 *     an explicit `null` («empty» — the built-in default applies), and an
 *     absent key («leave unchanged»). They stay apart on the wire because `0` is
 *     a legitimate burst setting meaning «no burst» and must not be
 *     confused with «unset». See `UpdateReviewPrefsInput` below.
 *
 *  2. **The bounds come from the server.** `bounds` carries min / max /
 *     factory for each of the three, so the form never writes those numbers
 *     down a third time. A hand-copied range is silent when the contract
 *     moves — and diverging quietly is exactly the failure the server went
 *     out of its way to prevent by shipping the block at all.
 */
import { apiJson } from './client';

/** Allowed range and built-in default of ONE schedule parameter. */
export interface ReviewSettingBounds {
  /** Smallest accepted value, inclusive. */
  min: number;
  /** Largest accepted value, inclusive. */
  max: number;
  /** What applies while the field is empty. */
  factory: number;
}

/**
 * The three schedule parameters RESOLVED — factory values already
 * substituted for the empty ones, so every field here is what actually
 * happens rather than «maybe null».
 */
export interface ReviewSchedule {
  /** Reminders in the first hour for unaccepted issues. 0 = no burst. */
  burstCount: number;
  /** Background interval for unaccepted issues, minutes. */
  unacceptedIntervalMinutes: number;
  /** Background interval for unreviewed results, minutes. */
  unreviewedIntervalMinutes: number;
}

export interface ReviewBounds {
  burstCount: ReviewSettingBounds;
  unacceptedIntervalMinutes: ReviewSettingBounds;
  unreviewedIntervalMinutes: ReviewSettingBounds;
}

export interface ReviewPrefs {
  /**
   * The master switch (INV-6). Off = the unreviewed set, its display and
   * its reminders all disappear for this user; nothing is deleted, and
   * everything comes back when it is switched on again.
   */
  mechanicEnabled: boolean;
  /**
   * Personal default of the per-issue «needs review» flag, applied on
   * every creation path that does not name the flag explicitly (US-3).
   */
  reviewRequiredDefault: boolean;

  /**
   * The three parameters AS STORED: `null` means «empty, built-in default
   * applies». Deliberately separate from `effective` below — the form
   * needs both, one to show an empty field empty rather than filled with a
   * factory number the user never typed, the other to show what the
   * schedule actually is.
   */
  burstCount: number | null;
  unacceptedIntervalMinutes: number | null;
  unreviewedIntervalMinutes: number | null;

  /** Read-only. The schedule in force. `PUT` does not accept this field. */
  effective: ReviewSchedule;
  /** Read-only. Bounds + factory values. `PUT` does not accept this field. */
  bounds: ReviewBounds;
}

/**
 * Partial update body. A key that is absent is left alone; a key set to
 * `null` clears the parameter back to empty/unset.
 *
 * `undefined` disappears in `JSON.stringify`, so «absent» and «explicit
 * null» survive the round trip as different bodies — which is the whole
 * reason the server parses these three through `json.RawMessage`.
 */
export interface UpdateReviewPrefsInput {
  mechanicEnabled?: boolean;
  reviewRequiredDefault?: boolean;
  burstCount?: number | null;
  unacceptedIntervalMinutes?: number | null;
  unreviewedIntervalMinutes?: number | null;
}

export async function getReviewPrefs(): Promise<ReviewPrefs> {
  return apiJson<ReviewPrefs>('/api/v1/me/review-prefs', { method: 'GET' });
}

/**
 * Save. Answers with the same payload `GET` returns, so the form re-renders
 * from the authority instead of from its own guess.
 *
 * A value outside the contract bounds is REFUSED with 422
 * `invalid_schedule_setting` naming the offending field, and NOTHING is
 * written — the request is all-or-nothing. It is never silently clamped,
 * which is why this client does no range checking of its own: a client-side
 * correction would leave the person looking at a form that agreed with them
 * while the system did something else (SC-022, SC-027).
 */
export async function updateReviewPrefs(
  input: UpdateReviewPrefsInput,
): Promise<ReviewPrefs> {
  return apiJson<ReviewPrefs>('/api/v1/me/review-prefs', {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}
