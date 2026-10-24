/**
 * Shared formatting helpers used by tables, cards and detail panes.
 *
 * ─── One clock for the whole product (sk-285.6.7) ──────────────────
 *
 * The card used to print `2026-08-31 07:01 UTC` under a comment while
 * the tree printed `9 days ago` for the same task, on the same screen.
 * Two dialects, no rule saying which applied where. There is now one
 * rule and one threshold, and it lives here:
 *
 *   age of the timestamp        rendered as
 *   ─────────────────────────   ──────────────────────────────
 *   < 30 s                      "just now"
 *   < 1 min                     "N sec ago"
 *   < 1 hour                    "N min ago"
 *   < 24 h                      "N hours ago"
 *   < RELATIVE_UNTIL_MS (7 d)   "N days ago"
 *   ≥ RELATIVE_UNTIL_MS         "YYYY-MM-DD UTC"   ← absolute
 *
 * Past the threshold relative time stops carrying information ("11
 * months ago" tells you nothing you can act on), so the label flips to
 * an absolute date. Under it, "how long ago" is what the reader wants
 * and the exact stamp is one hover away — every surface that shows a
 * relative label MUST also carry `formatTimestamp()` as its title.
 * `<TimeLabel>` (src/components/TimeLabel.tsx) is that pairing;
 * prefer it over calling these two by hand.
 *
 * The timezone is spelled out on every absolute form. The product does
 * not know the reader's zone yet (sk-340), so UTC is stated rather
 * than implied — a bare `2026-08-31` would silently read as local.
 */

import i18n from '../i18n/config';

/**
 * sk-514 (15) — parts of one moment from which the dictionary assembles
 * the entry. The code does NOT decide the order and does not glue the string itself: the Russian
 * entry (day, month name, year) and the English "2026-08-31" differ
 * in the order and the form of the month, and both patterns live in the dictionary.
 *
 * There is a single zone here — UTC. A language change changes the ENTRY, not the moment:
 * `day`/`hh` are read by the same getUTC* as before, so the numbers under
 * Russian and English must coincide. This is exactly the edge where
 * "locale" is easily confused with "time zone"; the guard checks it.
 *
 * Exported FOR THE GUARD'S SAKE: the list of parts is a contract between the code
 * and the dictionary patterns, and checking it against the text of this file would mean
 * comparing a regex with the source. The names are taken from a real call.
 */
export function utcParts(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  const month = d.getUTCMonth() + 1;
  const months = i18n.t('common:time.months', { returnObjects: true }) as string[];
  return {
    year: d.getUTCFullYear(),
    month,
    month2: pad(month),
    monthName: Array.isArray(months) ? months[month - 1] : String(month),
    day: d.getUTCDate(),
    day2: pad(d.getUTCDate()),
    hh: pad(d.getUTCHours()),
    mm: pad(d.getUTCMinutes()),
  };
}

/**
 * The one switch-over point between relative and absolute time.
 *
 * Seven days: long enough that "3 days ago" still answers "is this
 * fresh?", short enough that nothing older than a week is described by
 * a number the reader has to subtract from today. Changing this number
 * changes every timestamp in the product at once — that is the point.
 */
export const RELATIVE_UNTIL_MS = 7 * 24 * 60 * 60 * 1000;

export function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return i18n.t('common:time.stamp', utcParts(d));
  } catch {
    return iso;
  }
}

/** "YYYY-MM-DD" — bare calendar day, no zone marker. Used where a
 * column header already establishes the zone (admin tables). New UI
 * should reach for `formatDateUtc` so the zone is never implied. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return i18n.t('common:time.absolute', utcParts(d));
  } catch {
    return iso;
  }
}

/** "YYYY-MM-DD UTC" — the compact absolute form, zone stated. */
export function formatDateUtc(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return i18n.t('common:time.absoluteZoned', utcParts(d));
  } catch {
    return iso;
  }
}

// ─── Reader-local calendar day (sk-421.1 T011) ──────────────────────
//
// The one exception to the UTC clock above: calendar DATES the user set
// (due date, defer-until) are read as the day on the READER's wall, not
// as a UTC day. One rule, shared by the Activity feed (`dueAt` /
// `deferUntil` values) and the issue card's properties row — do not add
// a second copy. Local getters are read at call time, so the zone is
// whatever `TZ` / the browser says at that moment.

/** Local (reader's zone) year / month (1-12) / day of `d`. */
export function localDayParts(d: Date): { year: number; month: number; day: number } {
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
}

/**
 * The calendar day of `iso` in the reader's zone, written the way the
 * active language writes dates (sk-514 item 15) and WITHOUT a zone suffix.
 * `null` when `iso` does not parse as a date, so each caller decides its
 * own fallback (the Activity feed prints the raw value; the properties
 * row draws no segment).
 */
export function formatLocalDay(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const { year, month, day } = localDayParts(d);
  const pad = (n: number) => String(n).padStart(2, '0');
  const months = i18n.t('common:time.months', { returnObjects: true }) as string[];
  // The same pattern as the UTC day's — but the parts are LOCAL, and a zone suffix
  // is not here and never appears: this is the day on the reader's wall, not UTC.
  return i18n.t('common:time.absolute', {
    year,
    month,
    month2: pad(month),
    monthName: Array.isArray(months) ? months[month - 1] : String(month),
    day,
    day2: pad(day),
  });
}

/**
 * The product's one timestamp label. Relative while the age is under
 * `RELATIVE_UNTIL_MS`, absolute from there on — see the table at the
 * top of this file.
 *
 * sk-514 (15) — here used to stand "deliberately English": the clock was
 * the only surface deliberately left untranslated. Now it
 * reads the dictionary like everything else. The English forms did not
 * change by a single byte — the source of the strings moved, not the strings.
 *
 * i18next takes the plural: Russian has three forms (one, few, many),
 * and the ternary `h === 1 ? '' : 's'`, which was enough for
 * English, is wrong for them in principle.
 *
 * Future timestamps (clock skew, a reminder due tomorrow) clamp to
 * "just now" rather than reading "in -3 days"; `Math.max(0, …)` is what
 * does it, and it is intentional.
 */
export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const then = new Date(iso).getTime();
    if (!Number.isFinite(then)) return iso;
    const diffMs = Math.max(0, Date.now() - then);
    if (diffMs >= RELATIVE_UNTIL_MS) return formatDateUtc(iso);
    const diffSec = diffMs / 1000;
    if (diffSec < 30) return i18n.t('common:time.justNow');
    if (diffSec < 60) {
      return i18n.t('common:time.secondsAgo', { count: Math.floor(diffSec) });
    }
    if (diffSec < 60 * 60) {
      return i18n.t('common:time.minutesAgo', { count: Math.floor(diffSec / 60) });
    }
    if (diffSec < 60 * 60 * 24) {
      return i18n.t('common:time.hoursAgo', { count: Math.floor(diffSec / 3600) });
    }
    return i18n.t('common:time.daysAgo', { count: Math.floor(diffSec / 86400) });
  } catch {
    return iso;
  }
}

/**
 * Slugify name → id_prefix: lowercase, ASCII-ish, dash-separated. Mirrors
 * the server-side projects.Slug() function for client-side preview while
 * the user types a name. Final value is still validated server-side.
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
}
