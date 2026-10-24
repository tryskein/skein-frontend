/**
 * sk-421.1 — unit tests for the properties-row display rules
 * (src/lib/issueProperties.ts).
 *
 * ─── Zone and "now" (FIXED-ZONE) ───────────────────────────
 *
 * These rules read dates in the READER's zone, so each block pins
 * `process.env.TZ` for its own duration (Node re-reads it on assignment)
 * and restores it afterwards — the previous value, or `delete` when there
 * was none (assigning `undefined` would leave the string "undefined",
 * i.e. offset 0). The zone is NOT set globally: other suites (Activity
 * feed, TimeLabel) run in the environment's zone.
 *
 * Two zones, both without DST: `Pacific/Honolulu` (UTC−10) is the
 * discriminating half — a `…T00:00:00Z` value lands on the PREVIOUS local
 * day only under a negative offset, so "formatted in UTC" is caught
 * there; `Asia/Tokyo` (UTC+9) covers the other boundary, where 23:59
 * local is still the same UTC day and 00:30 local is the previous one.
 *
 * The first assertion of every block is a zone self-check, so a zone
 * that failed to apply turns that line red instead of silently passing
 * the case under test. "Now" is pinned with fake timers, so "today",
 * "yesterday" and "over" never depend on the date of the run.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import {
  calendarDay,
  captureMoment,
  classifyExternalRef,
  isDayOver,
  sourceLabelKey,
  splitEstimate,
} from './issueProperties';
import { en } from '../i18n/locales/en';
import { ru } from '../i18n/locales/ru';

// Regression (review of wave sk-421.1/skein-frontend/1): the URL parser
// silently strips tabs and newlines, so a value holding whitespace or a
// control character must not become a link whose href differs from the
// visible text. Characters are built from codes to keep the source plain.
describe('external reference — whitespace or control characters inside', () => {
  const ch = (code: number) => String.fromCharCode(code);

  test.each([
    ['newline between two addresses', `https://a.com${ch(10)}https://b.com`],
    ['tab inside the host', `http://a.b${ch(9)}c`],
    ['space inside the path', 'https://a.com/x y'],
    ['NUL inside the path', `https://a.com/${ch(0)}x`],
    ['DEL at the end of the path', `HTTPS://a.com/${ch(127)}`],
  ])('%s → text, not a link', (_name, value) => {
    expect(classifyExternalRef(value)).toEqual({ kind: 'text', text: value });
  });

  test('an absolute https address without them stays a link (trimmed)', () => {
    expect(classifyExternalRef('  https://a.com/path?q=1  ')).toEqual({
      kind: 'link',
      href: 'https://a.com/path?q=1',
      text: 'https://a.com/path?q=1',
    });
  });
});

// ─── US-12, INV-5, SC-008 — scheme classification (row 34) ──
//
// Clickable only for an absolute http/https address, scheme case-insensitive;
// every other value is text; empty or whitespace-only is no segment. The
// render half (target, rel, truncation) is in IssuePropertiesRow.test.tsx.

describe('external reference — which values become a link (row 34)', () => {
  test.each([
    'http://example.com',
    'https://example.com/path?q=1#frag',
    'HTTPS://EXAMPLE.COM/UPPER',
    'Http://example.com',
  ])('%s → link to itself', (value) => {
    expect(classifyExternalRef(value)).toEqual({ kind: 'link', href: value, text: value });
  });

  test.each([
    ['executable scheme', 'javascript:alert(1)'],
    ['executable scheme, upper case', 'JAVASCRIPT:alert(1)'],
    ['data scheme', 'data:text/html,<b>x</b>'],
    ['mailto scheme', 'mailto:someone@example.com'],
    ['other scheme', 'ftp://example.com/file'],
    ['relative address', '/projects/sk/issues/sk-1'],
    ['scheme-relative address', '//example.com/x'],
    ['text identifier', 'JIRA-1234'],
    ['http without slashes', 'https:example.com'],
  ])('%s → text, not a link', (_name, value) => {
    expect(classifyExternalRef(value)).toEqual({ kind: 'text', text: value });
  });

  test.each([
    ['null', null],
    ['undefined', undefined],
    ['empty', ''],
    ['whitespace only', '   '],
  ])('%s → no segment', (_name, value) => {
    expect(classifyExternalRef(value)).toEqual({ kind: 'none' });
  });
});

// ─── US-10 — source label, closed set (row 35, rule half) ───
//
// The three server values map to `details:` keys that exist in BOTH
// dictionaries; anything else (a newer server) maps to null so the segment
// is not drawn and the raw value is never printed. The render half is in
// IssuePropertiesRow.test.tsx.

describe('source label — closed set, unknown value is not labelled (row 35)', () => {
  /** Resolve a dotted `details:` key in one locale's dictionary. */
  function lookup(dict: { details: unknown }, key: string): unknown {
    return key
      .split('.')
      .reduce<unknown>(
        (node, part) =>
          node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined,
        dict.details,
      );
  }

  test.each([
    ['human', 'человек', 'human'],
    ['agent_directed', 'агент по поручению', 'agent on request'],
    ['agent_autonomous', 'агент сам', 'agent on its own'],
  ])('%s → a key labelled in ru and en', (value, ruLabel, enLabel) => {
    const key = sourceLabelKey(value);
    expect(key).not.toBeNull();
    expect(lookup(ru, key!)).toBe(ruLabel);
    expect(lookup(en, key!)).toBe(enLabel);
  });

  test.each([
    ['legacy value', 'agent'],
    ['future value', 'agent_supervised'],
    ['prototype property name', 'toString'],
    ['empty', ''],
    ['null', null],
    ['undefined', undefined],
  ])('%s → null (no segment)', (_name, value) => {
    expect(sourceLabelKey(value)).toBeNull();
  });
});

// `process` is typed as the narrow Vite shim here, so the env bag is
// reached through a local widening (same as ActivitySection.test.tsx).
const env = (globalThis as { process?: { env: Record<string, string | undefined> } })
  .process!.env;

/** Pin TZ for the enclosing describe and restore it exactly afterwards. */
function pinZone(zone: string): void {
  const had = Object.prototype.hasOwnProperty.call(env, 'TZ');
  const previous = env.TZ;
  beforeAll(() => {
    env.TZ = zone;
  });
  afterAll(() => {
    if (had) env.TZ = previous;
    else delete env.TZ;
  });
}

/** Pin "now" for one test; the caller restores with `vi.useRealTimers()`. */
function pinNow(iso: string): void {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(iso));
}

describe('calendar day and "day is over" — Pacific/Honolulu (UTC−10)', () => {
  pinZone('Pacific/Honolulu');
  afterAll(() => {
    vi.useRealTimers();
  });

  test('zone self-check', () => {
    expect(new Date('2026-01-15T12:00:00Z').getTimezoneOffset()).toBe(600);
  });

  test('a due date at UTC midnight is the previous local calendar day', () => {
    expect(calendarDay('2026-03-10T00:00:00Z')).toBe('2026-03-09');
  });

  describe('now = 23:59 local on 2026-03-09 (UTC already 2026-03-10)', () => {
    // 2026-03-10T09:59:00Z = 2026-03-09 23:59 in Honolulu.
    beforeAll(() => pinNow('2026-03-10T09:59:00Z'));
    afterAll(() => {
      vi.useRealTimers();
    });

    test('due date on today\'s local day is not over — even the UTC-midnight one', () => {
      // 2026-03-09 00:00 local, and 2026-03-09 14:00 local (UTC 10th).
      expect(isDayOver('2026-03-09T10:00:00Z')).toBe(false);
      expect(isDayOver('2026-03-10T00:00:00Z')).toBe(false);
    });

    test('due date on yesterday\'s local day is over', () => {
      // 2026-03-08 23:59 local.
      expect(isDayOver('2026-03-09T09:59:00Z')).toBe(true);
    });

    test('defer-until follows the same rule: today not passed, yesterday passed', () => {
      expect(isDayOver('2026-03-09T20:00:00Z')).toBe(false);
      expect(isDayOver('2026-03-08T20:00:00Z')).toBe(true);
    });
  });

  describe('now = 00:00 local on 2026-03-10', () => {
    // 2026-03-10T10:00:00Z = 2026-03-10 00:00 in Honolulu.
    beforeAll(() => pinNow('2026-03-10T10:00:00Z'));
    afterAll(() => {
      vi.useRealTimers();
    });

    test('once the local day rolls over, yesterday\'s due date is over', () => {
      // 2026-03-09 23:59 local (UTC already 2026-03-10T09:59Z) — the
      // local day ended one minute ago.
      expect(isDayOver('2026-03-10T09:59:00Z')).toBe(true);
      expect(isDayOver('2026-03-10T00:00:00Z')).toBe(true);
    });

    test('a due date on the new local day is not over', () => {
      expect(isDayOver('2026-03-10T10:00:00Z')).toBe(false);
    });
  });
});

describe('calendar day and "day is over" — Asia/Tokyo (UTC+9)', () => {
  pinZone('Asia/Tokyo');
  afterAll(() => {
    vi.useRealTimers();
  });

  test('zone self-check', () => {
    expect(new Date('2026-01-15T12:00:00Z').getTimezoneOffset()).toBe(-540);
  });

  test('23:59 local is the same day while UTC is the same day', () => {
    // 2026-03-09T14:59:00Z = 2026-03-09 23:59 in Tokyo.
    expect(calendarDay('2026-03-09T14:59:00Z')).toBe('2026-03-09');
  });

  test('00:30 local is the next day while UTC is still the previous one', () => {
    // 2026-03-09T15:30:00Z = 2026-03-10 00:30 in Tokyo.
    expect(calendarDay('2026-03-09T15:30:00Z')).toBe('2026-03-10');
  });

  describe('now = 23:59 local on 2026-03-09', () => {
    beforeAll(() => pinNow('2026-03-09T14:59:00Z'));
    afterAll(() => {
      vi.useRealTimers();
    });

    test('due / defer-until on today\'s local day is not over', () => {
      // 2026-03-09 09:00 local.
      expect(isDayOver('2026-03-09T00:00:00Z')).toBe(false);
    });

    test('a date on the next local day (same UTC day) is not over', () => {
      expect(isDayOver('2026-03-09T15:30:00Z')).toBe(false);
    });

    test('a date on yesterday\'s local day is over', () => {
      // 2026-03-08 23:59 local.
      expect(isDayOver('2026-03-08T14:59:00Z')).toBe(true);
    });
  });

  describe('now = 00:30 local on 2026-03-10 (UTC still 2026-03-09)', () => {
    beforeAll(() => pinNow('2026-03-09T15:30:00Z'));
    afterAll(() => {
      vi.useRealTimers();
    });

    test('a date at 23:59 local yesterday is over although UTC is the same day', () => {
      expect(isDayOver('2026-03-09T14:59:00Z')).toBe(true);
    });

    test('a date on the new local day is not over', () => {
      expect(isDayOver('2026-03-09T15:30:00Z')).toBe(false);
    });
  });
});

// ─── US-8 capture moment (row 32) ──────────────────────────
//
// "Since when", not "how long ago": a claim made on the reader's
// current local day shows the time of day; any other day shows date and
// time; the tooltip string is the full local date-time with the offset.
// The discriminating case is a claim that is "today" locally but
// "yesterday" in UTC (Honolulu) — a UTC day rule prints a date there.

// sk-551.28 — the claim moment is on the product clock (UTC, the zone
// stated: `components/format.ts`), not in the reader's zone. Expected
// values follow from that rule alone; each case is chosen so the old
// local-zone rule would print something else (another hour, or a time
// where a date is due and back).
describe('capture moment — Pacific/Honolulu (UTC−10)', () => {
  pinZone('Pacific/Honolulu');
  // now = 2026-03-09 23:59:30 local; UTC is already 2026-03-10.
  beforeAll(() => pinNow('2026-03-10T09:59:30Z'));
  afterAll(() => {
    vi.useRealTimers();
  });

  test('zone self-check', () => {
    expect(new Date('2026-01-15T12:00:00Z').getTimezoneOffset()).toBe(600);
  });

  test('claimed today (UTC) while the local day is yesterday → UTC time of day', () => {
    // 2026-03-10T00:30:00Z = 2026-03-09 14:30 local.
    expect(captureMoment('2026-03-10T00:30:00Z')).toEqual({
      label: '00:30 UTC',
      full: '2026-03-10 00:30 UTC',
    });
  });

  test('claimed yesterday (UTC) although the local day is today → UTC date and time', () => {
    // 2026-03-09T10:30:00Z = 2026-03-09 00:30 local — today on the wall.
    expect(captureMoment('2026-03-09T10:30:00Z')).toEqual({
      label: '2026-03-09 10:30 UTC',
      full: '2026-03-09 10:30 UTC',
    });
  });

  test('claimed a year earlier → the date carries the year', () => {
    expect(captureMoment('2025-03-10T00:30:00Z')).toEqual({
      label: '2025-03-10 00:30 UTC',
      full: '2025-03-10 00:30 UTC',
    });
  });
});

describe('capture moment — Asia/Tokyo (UTC+9)', () => {
  pinZone('Asia/Tokyo');
  // now = 2026-03-10 00:30 local; UTC is still 2026-03-09.
  beforeAll(() => pinNow('2026-03-09T15:30:00Z'));
  afterAll(() => {
    vi.useRealTimers();
  });

  test('zone self-check', () => {
    expect(new Date('2026-01-15T12:00:00Z').getTimezoneOffset()).toBe(-540);
  });

  test('claimed today (UTC, local just after midnight) → UTC time of day', () => {
    // 2026-03-09T15:10:00Z = 2026-03-10 00:10 local.
    expect(captureMoment('2026-03-09T15:10:00Z')).toEqual({
      label: '15:10 UTC',
      full: '2026-03-09 15:10 UTC',
    });
  });

  test('claimed today (UTC) although the local day is yesterday → UTC time of day', () => {
    // 2026-03-09T14:59:00Z = 2026-03-09 23:59 local.
    expect(captureMoment('2026-03-09T14:59:00Z')).toEqual({
      label: '14:59 UTC',
      full: '2026-03-09 14:59 UTC',
    });
  });

  test('claimed yesterday (UTC) → UTC date and time', () => {
    expect(captureMoment('2026-03-08T23:00:00Z')).toEqual({
      label: '2026-03-08 23:00 UTC',
      full: '2026-03-08 23:00 UTC',
    });
  });
});

// ─── US-6 estimate numbers (row 33, numbers half) ──────────
//
// The rule returns NUMBERS; the unit labels are the row's (render half in
// IssuePropertiesRow.test.tsx). No day unit: 600 minutes is 10 hours.

describe('estimate — whole hours and remaining minutes, no days', () => {
  test.each([
    [0, { hours: 0, minutes: 0 }],
    [45, { hours: 0, minutes: 45 }],
    [60, { hours: 1, minutes: 0 }],
    [90, { hours: 1, minutes: 30 }],
    [600, { hours: 10, minutes: 0 }],
  ])('%i minutes → %o', (minutes, expected) => {
    expect(splitEstimate(minutes)).toEqual(expected);
  });

  test('a very large estimate stays in hours (no day unit)', () => {
    // 3 days' worth of minutes — still hours.
    expect(splitEstimate(3 * 24 * 60 + 15)).toEqual({ hours: 72, minutes: 15 });
  });
});
