/**
 * Pure client-side reminder countdown / state derivation — sk-62.2.
 *
 * The card-level reminder block ticks once per second and renders a
 * live countdown ("⏰ rings in Xh Ym") for armed reminders and a
 * "🔔 ringing since HH:MM UTC" pulse for ringing ones. The state is derived from
 * the RFC3339 `remindAt` against the current clock — so an armed
 * reminder flips to ringing the instant its time passes, without a
 * server round-trip.
 *
 * Kept as a pure function (no React, no `Date.now()` capture inside) so
 * vitest can drive it with a fixed `now` and assert the boundary
 * behaviour deterministically.
 */

import type { ReminderState } from '../api/reminders';

/**
 * Derive the live reminder state from `remindAt` vs `now`.
 *
 * `ringing` ⟺ remindAt <= now (the alarm time has arrived/passed).
 * `armed`   ⟺ remindAt >  now (still counting down).
 *
 * This intentionally ignores the server-stamped `state` field: the
 * server stamps it at fetch time, but between fetches the clock moves,
 * and an armed reminder must visibly flip to ringing on its own once
 * the second hand crosses `remindAt`. A malformed / unparseable
 * `remindAt` is treated as `armed` (we never want to scream "ringing"
 * on garbage input).
 *
 * Cross-link: {@link formatCountdown} returns `null` for the same
 * unparseable / past-due inputs (caller then renders the ringing
 * branch). The two functions deliberately diverge on unparseable
 * input — `reminderState` stays `armed`, `formatCountdown` yields
 * `null` — so UI never flashes a "ringing" pulse on garbage timestamps.
 */
export function reminderState(remindAt: string, now: number): ReminderState {
  const t = Date.parse(remindAt);
  if (Number.isNaN(t)) return 'armed';
  return t <= now ? 'ringing' : 'armed';
}

/**
 * Format the remaining time until an armed reminder fires, as a compact
 * English phrase. Granularity adapts to the magnitude so the countdown
 * reads naturally at every scale:
 *
 *   >= 1 day   → "Xd Yh"      (e.g. "3d 4h")
 *   >= 1 hour  → "Xh Ym"      (e.g. "2h 5m")
 *   >= 1 min   → "Xm Ys"      (e.g. "12m 03s")
 *   <  1 min   → "Ys"         (e.g. "42s")
 *
 * Returns the bare magnitude string (no "in" prefix — the caller
 * owns the "⏰ rings in …" framing). When `remindAt` is already
 * in the past (or unparseable) returns `null` — the caller renders the
 * ringing branch instead.
 *
 * Cross-link: see {@link reminderState} for how unparseable `remindAt`
 * is classified on the state axis (`armed`, not `ringing`).
 */
export function formatCountdown(remindAt: string, now: number): string | null {
  const t = Date.parse(remindAt);
  if (Number.isNaN(t)) return null;
  let ms = t - now;
  if (ms <= 0) return null;

  const sec = Math.floor(ms / 1000);
  const days = Math.floor(sec / 86_400);
  const hours = Math.floor((sec % 86_400) / 3_600);
  const minutes = Math.floor((sec % 3_600) / 60);
  const seconds = sec % 60;

  if (days >= 1) {
    return `${days}d ${hours}h`;
  }
  if (hours >= 1) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes >= 1) {
    // Zero-pad seconds so the tail doesn't jitter in width as it counts
    // 9 → 8 → … → 0.
    return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  }
  return `${seconds}s`;
}

/**
 * Format the wall-clock time a reminder started ringing, as
 * `HH:MM UTC`. Used by the "🔔 ringing since HH:MM UTC" pulse — we prefer
 * `notifiedAt` (when the bell actually fired) and fall back to
 * `remindAt` (when it was scheduled to fire). Returns `''` on
 * unparseable input so the caller can render the glyph alone.
 *
 * sk-285.6.7 — UTC, and the zone SAID rather than implied. This used to
 * read the browser's zone and print a bare `14:30`, which put a second
 * clock inside a card whose every other stamp (comments, closed-at, the
 * activity feed) is UTC-suffixed: a reader in UTC+3 had no way to tell
 * which of the two `14:30` belonged to. The product does not know the
 * reader's zone yet (sk-340); until it does, the one zone it can name
 * is the one it prints.
 *
 * `formatRemindAtLocal` used to live next to this and printed a third
 * form (`DD.MM HH:MM`, local, no year, no zone) for the armed tooltip.
 * It is gone: that tooltip now uses `formatTimestamp` from
 * `components/format`, the product's one absolute form.
 */
export function formatRingingSince(
  notifiedAt: string | null | undefined,
  remindAt: string,
): string {
  const source = notifiedAt && notifiedAt.length > 0 ? notifiedAt : remindAt;
  const t = Date.parse(source);
  if (Number.isNaN(t)) return '';
  const d = new Date(t);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm} UTC`;
}

/**
 * Sort comparator for the budilnik lens flat list — "most urgent
 * first": ringing reminders before armed, and within each group the
 * EARLIER `remindAt` first (a reminder that rang/ rings sooner is more
 * urgent). Derives state from `now` so the partition matches the live
 * countdown rather than a stale server stamp.
 */
export function compareReminderUrgency(
  a: { remindAt: string },
  b: { remindAt: string },
  now: number,
): number {
  const sa = reminderState(a.remindAt, now);
  const sb = reminderState(b.remindAt, now);
  if (sa !== sb) {
    // ringing (0) sorts before armed (1).
    return sa === 'ringing' ? -1 : 1;
  }
  // Same group → earlier remindAt first.
  const ta = Date.parse(a.remindAt);
  const tb = Date.parse(b.remindAt);
  const na = Number.isNaN(ta) ? Infinity : ta;
  const nb = Number.isNaN(tb) ? Infinity : tb;
  return na - nb;
}
