/**
 * sk-421.1 T011 — display rules for the issue card's properties row.
 *
 * Pure functions only (no React, no DOM, no i18n instance of their own):
 * the row component (T014) turns what these return into segments and
 * labels. The one dictionary read is indirect — the claim stamp goes
 * through `formatTimestamp`, the product's one absolute form.
 *
 * ─── The reader's zone ──────────────────────────────────────────────
 *
 * Unlike the product clock in `src/components/format.ts` (UTC, stated),
 * every calendar DAY here is read in the READER's time zone (spec US-6,
 * US-7): a due date is "the calendar day the reader sees on their wall".
 * The claim MOMENT (US-8) is the exception — it is on the product clock
 * (sk-551.28, see `captureMoment`).
 * All zone-dependent work goes through `Date`'s local getters at CALL
 * time, and no `Intl.DateTimeFormat` is cached at module level — a
 * formatter built at import would freeze whatever zone was current then
 * (tests pin `TZ` per file, after imports).
 */

import { formatLocalDay, formatTimestamp, localDayParts } from '../components/format';
import type { IssueSource } from '../api/issues';

// ───────────────────────── calendar day ─────────────────────────

/**
 * The calendar day of `iso` in the reader's zone, `YYYY-MM-DD`
 * (US-6 due date, US-7 defer-until). `null` for an absent or
 * unparsable value — the segment is not drawn (INV-6).
 *
 * Same rule as the Activity feed's `dueAt` / `deferUntil` values — both
 * go through `formatLocalDay`, so there is one instance of the rule.
 */
export function calendarDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return formatLocalDay(iso);
}

/** Numeric `YYYYMMDD` key of a local calendar day, for ordering. */
function dayKey(d: Date): number {
  const { year, month, day } = localDayParts(d);
  return year * 10_000 + month * 100 + day;
}

/**
 * True when the calendar day of `iso` (reader's zone) has ENDED
 * relative to `now` — i.e. `now` falls on a later local day. A due date
 * or defer-until on today's local day is not over, even at 23:59.
 * Used for "overdue" (US-6) and "defer-until passed" (US-7); whether it
 * is highlighted also depends on the status — that is T014's call.
 *
 * Absent or unparsable value → `false` (nothing to be over).
 */
export function isDayOver(iso: string | null | undefined, now: Date = new Date()): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  return dayKey(d) < dayKey(now);
}

// ───────────────────────── capture moment ─────────────────────────

/** Display strings for the moment an issue was claimed (US-8). */
export interface CaptureMoment {
  /**
   * Short label: `HH:MM UTC` when the claim happened on the current UTC
   * day, otherwise the product's absolute stamp (`formatTimestamp`:
   * date with the year, time, `UTC`), so a claim from another day or
   * year is unambiguous.
   */
  label: string;
  /** Full date-time for the native tooltip — `formatTimestamp`. */
  full: string;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** `YYYY-MM-DD` of the UTC day of `d`, for comparing days. */
const utcDayKey = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The claim moment as the card shows it (US-8): "since when", not "how
 * long ago" — so `formatRelative` does not apply.
 *
 * sk-551.28 — on the product clock (`components/format.ts`: UTC, the
 * zone stated), not in the reader's zone. A claim is a MOMENT, like a
 * comment, a closure or a ringing reminder, and every other moment on
 * the card is printed in UTC with the zone said; a bare local `18:21`
 * next to the reminder's `15:22 UTC` read as two clocks, and nothing
 * told the reader which was which — the very confusion sk-285.6.7 took
 * out of the reminder row. The due date and «deferred until» above
 * stay in the reader's zone: they are calendar DAYS, the day on the
 * reader's wall (`calendarDay`), not moments.
 *
 * Absent or unparsable value → `null` (no capture segment time).
 */
export function captureMoment(
  iso: string | null | undefined,
  now: Date = new Date(),
): CaptureMoment | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const full = formatTimestamp(iso);
  const label =
    utcDayKey(d) === utcDayKey(now)
      ? `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())} UTC`
      : full;
  return { label, full };
}

// ───────────────────────── estimate ─────────────────────────

/** An estimate split for display; the unit labels are the caller's. */
export interface EstimateParts {
  hours: number;
  minutes: number;
}

/**
 * Split `estimatedMinutes` into whole hours and remaining minutes
 * (US-6). No day unit: 600 → `{ hours: 10, minutes: 0 }`. The row
 * (T014) drops a zero part when the other is non-zero ("1 h", not
 * "1 h 0 min") and prints `0 min` for 0.
 *
 * Absent, negative, fractional or non-finite input → `null` (the
 * server stores a non-negative integer; anything else is not an
 * estimate the card can state).
 */
export function splitEstimate(minutes: number | null | undefined): EstimateParts | null {
  if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < 0) {
    return null;
  }
  return { hours: Math.floor(minutes / 60), minutes: minutes % 60 };
}

// ───────────────────────── external link ─────────────────────────

/** How the external-reference segment renders (US-12, INV-5). */
export type ExternalRefDisplay =
  /** Empty or whitespace-only — no segment. */
  | { kind: 'none' }
  /** Absolute http/https address — a link to `href`. */
  | { kind: 'link'; href: string; text: string }
  /** Anything else — plain text, never a link. */
  | { kind: 'text'; text: string };

/** Absolute address with an http or https scheme, any case. */
const HTTP_ABSOLUTE = /^https?:\/\//i;

/**
 * Classify an external reference (US-12, INV-5, SC-008). Clickable only
 * when the trimmed value starts with `http://` or `https://` (scheme
 * case-insensitive, so `HTTPS://…` is a link), holds no whitespace or
 * control character, AND parses as a URL. Every other value — an issue
 * key like `JIRA-12`, a relative path, `mailto:`, `data:`,
 * `javascript:` in any case — is text.
 *
 * The prefix test runs on the raw trimmed string, not on a parsed URL:
 * `new URL('https:host')` normalises to `https://host/`, and a value
 * that does not literally spell an absolute address is not one here.
 * Whitespace and control characters make the value text for the same
 * reason: the URL parser silently strips tabs and newlines, so two
 * addresses separated by a newline would open a third, glued host while
 * the card shows the two.
 */
export function classifyExternalRef(value: string | null | undefined): ExternalRefDisplay {
  const text = (value ?? '').trim();
  if (!text) return { kind: 'none' };
  if (HTTP_ABSOLUTE.test(text) && !hasWhitespaceOrControl(text) && parsesAsUrl(text)) {
    return { kind: 'link', href: text, text };
  }
  return { kind: 'text', text };
}

/** C0 controls end below the space character (code 32); DEL is 127. */
const FIRST_PRINTABLE = 32;
const DEL = 127;

/** True when any character is whitespace or an ASCII control character. */
function hasWhitespaceOrControl(value: string): boolean {
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < FIRST_PRINTABLE || code === DEL || /\s/.test(ch)) return true;
  }
  return false;
}

function parsesAsUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

// ───────────────────────── source ─────────────────────────

/** i18n keys (namespace `details`) of the three source labels (US-10). */
const SOURCE_LABEL_KEYS: Record<IssueSource, string> = {
  human: 'properties.source.human',
  agent_directed: 'properties.source.agentDirected',
  agent_autonomous: 'properties.source.agentAutonomous',
};

/**
 * The `details:` i18n key labelling an issue source (US-10): "human" /
 * "agent on request" / "agent on its own". A value outside the known set (a
 * newer server) → `null`: the segment is not drawn and the raw value is
 * never printed. The parameter is `string`, not `IssueSource`, because
 * the value comes off the wire and the type is a promise the server can
 * outgrow.
 */
export function sourceLabelKey(source: string | null | undefined): string | null {
  if (typeof source !== 'string') return null;
  return Object.prototype.hasOwnProperty.call(SOURCE_LABEL_KEYS, source)
    ? SOURCE_LABEL_KEYS[source as IssueSource]
    : null;
}
