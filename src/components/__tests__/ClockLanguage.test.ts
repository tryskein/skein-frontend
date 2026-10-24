/**
 * sk-514 (15) — the product clock writes the date the way the active language writes it.
 *
 * ─── What is really guarded here ───────────────────────────────────
 *
 * Not "the strings are translated": that would be a dictionary parity check, and it
 * proves nothing (see sk-514 item 9 — a dictionary into which English
 * strings were copied passes parity). Here are three different assertions.
 *
 * FIRST. The English entry did not change by a single byte. The change moved the
 * SOURCE of the strings, not the strings; dozens of tests across the tree read
 * English labels, and their green is the proof of
 * unchangedness. Here it is pinned explicitly, so that the intent is
 * written down, not inferred from other files.
 *
 * SECOND. The Russian entry is really Russian and in the order that was
 * ordered: DD MMMM YYYY, the month as a word and in the genitive case.
 *
 * THIRD, and for it this file matters more than the first two: A LANGUAGE CHANGE DOES NOT
 * CHANGE THE MOMENT. Locale and time zone are different things that are very
 * easy to confuse in such a change: it is enough to take `toLocaleDateString`
 * with a Russian locale, and the entry moves to the reader's local time while keeping
 * the "UTC" suffix. From outside this looks like a translation, but in fact it is a lie
 * about time, and a silent one. So the day, year, hours and minutes are extracted from
 * BOTH entries and compared as numbers, under a time zone that is deliberately
 * not equal to UTC.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';

import i18n, { DEFAULT_LANGUAGE } from '../../i18n/config';
import { ru } from '../../i18n/locales/ru';
import { en } from '../../i18n/locales/en';
import {
  formatDate,
  formatDateUtc,
  formatLocalDay,
  formatRelative,
  formatTimestamp,
  utcParts,
} from '../format';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } })
  .process!.env;

/** A time zone deliberately not equal to UTC: under it the local day and the UTC day
 *  diverge on late evening stamps. Exactly such a substitution is
 *  caught by the third block. */
const OFFSET_ZONE = 'Asia/Tokyo';

const had = Object.prototype.hasOwnProperty.call(env, 'TZ');
const previousZone = env.TZ;
beforeAll(() => {
  env.TZ = OFFSET_ZONE;
});
afterAll(async () => {
  if (had) env.TZ = previousZone;
  else delete env.TZ;
  if (i18n.language !== DEFAULT_LANGUAGE) await i18n.changeLanguage(DEFAULT_LANGUAGE);
});

afterEach(async () => {
  vi.useRealTimers();
  if (i18n.language !== DEFAULT_LANGUAGE) await i18n.changeLanguage(DEFAULT_LANGUAGE);
});

/** Late evening UTC — in Tokyo it is already the next day. */
const INSTANT = '2026-08-31T23:30:00Z';

describe('sk-514 (15) — the English clock did not move by a single byte', () => {
  test('all four absolute forms are exactly the same as before the dictionary', async () => {
    await i18n.changeLanguage('en');
    expect(formatTimestamp(INSTANT)).toBe('2026-08-31 23:30 UTC');
    expect(formatDate(INSTANT)).toBe('2026-08-31');
    expect(formatDateUtc(INSTANT)).toBe('2026-08-31 UTC');
    // The local day: in Tokyo it is already 1 September — which also proves that
    // this form still reads the reader's zone, not UTC.
    expect(formatLocalDay(INSTANT)).toBe('2026-09-01');
  });

  test('relative forms are the same, including the singular', async () => {
    await i18n.changeLanguage('en');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-01T00:00:00Z'));
    expect(formatRelative('2026-08-31T23:59:50Z')).toBe('just now');
    expect(formatRelative('2026-08-31T23:59:15Z')).toBe('45 sec ago');
    // 23:01, not 23:00: exactly an hour is already the hour branch ("1 hour ago"),
    // the `< 60 * 60` boundary is strict, and it was so before the change.
    expect(formatRelative('2026-08-31T23:01:00Z')).toBe('59 min ago');
    expect(formatRelative('2026-08-31T23:00:00Z')).toBe('1 hour ago');
    expect(formatRelative('2026-08-31T22:00:00Z')).toBe('2 hours ago');
    expect(formatRelative('2026-08-31T00:00:00Z')).toBe('1 day ago');
    expect(formatRelative('2026-08-29T00:00:00Z')).toBe('3 days ago');
  });
});

describe('sk-514 (15) — the Russian entry: day, month as a word, year', () => {
  test('the month stands as a WORD and in the genitive case, the order is DD MMMM YYYY', async () => {
    await i18n.changeLanguage('ru');
    expect(formatDate(INSTANT)).toBe('31 августа 2026');
    expect(formatDateUtc(INSTANT)).toBe('31 августа 2026 UTC');
    expect(formatTimestamp(INSTANT)).toBe('31 августа 2026, 23:30 UTC');
    expect(formatLocalDay(INSTANT)).toBe('1 сентября 2026');
  });

  test('UTC remains a SUFFIX — where it was, and only there', async () => {
    await i18n.changeLanguage('ru');
    // A bare calendar day claims no zone in any language, and
    // the reader's local day even less so: attaching "UTC" to it would be
    // lying. This separation is what is checked, not the presence of three letters.
    expect(formatDate(INSTANT).endsWith(' UTC')).toBe(false);
    expect(formatLocalDay(INSTANT)!.endsWith(' UTC')).toBe(false);
    expect(formatDateUtc(INSTANT).endsWith(' UTC')).toBe(true);
    expect(formatTimestamp(INSTANT).endsWith(' UTC')).toBe(true);
  });

  test('three plural forms, not the English two', async () => {
    await i18n.changeLanguage('ru');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-10T00:00:00Z'));
    // 1 / 2 / 5 — exactly the three cases on which the English ternary
    // `n === 1 ? '' : 's'` gives wrong Russian.
    expect(formatRelative('2026-09-09T00:00:00Z')).toBe('1 день назад');
    expect(formatRelative('2026-09-08T00:00:00Z')).toBe('2 дня назад');
    expect(formatRelative('2026-09-05T00:00:00Z')).toBe('5 дней назад');
    expect(formatRelative('2026-09-09T23:59:50Z')).toBe('только что');
  });
});

describe('sk-514 (15) — a language change changes the ENTRY, not the moment', () => {
  test('the day, year, hours and minutes coincide in both entries', async () => {
    await i18n.changeLanguage('en');
    const enStamp = formatTimestamp(INSTANT);
    await i18n.changeLanguage('ru');
    const ruStamp = formatTimestamp(INSTANT);

    const enParts = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}) UTC$/.exec(enStamp);
    const ruParts = /^(\d{1,2}) (\S+) (\d{4}), (\d{2}):(\d{2}) UTC$/.exec(ruStamp);
    expect(enParts, `the English entry "${enStamp}" was not parsed`).not.toBeNull();
    expect(ruParts, `the Russian entry "${ruStamp}" was not parsed`).not.toBeNull();

    const months = ru.common.time.months as readonly string[];
    const ruMonth = months.indexOf(ruParts![2]) + 1;
    expect(ruMonth, `the month "${ruParts![2]}" was not found in the dictionary`).toBeGreaterThan(0);

    // Numbers, not strings: an identical string is not expected here — the entries
    // differ by construction. The MOMENT must coincide.
    expect([Number(ruParts![1]), ruMonth, Number(ruParts![3]), ruParts![4], ruParts![5]]).toEqual([
      Number(enParts![3]),
      Number(enParts![2]),
      Number(enParts![1]),
      enParts![4],
      enParts![5],
    ]);
  });

  test('the local day does not drift either: in both entries it is 1 September', async () => {
    // Under Asia/Tokyo the UTC day and the local one diverge, and this is the only
    // place where such a divergence is LEGITIMATE. It is easiest to confuse it with a language one
    // exactly here, so the case is recorded separately.
    await i18n.changeLanguage('en');
    expect(formatLocalDay(INSTANT)).toBe('2026-09-01');
    await i18n.changeLanguage('ru');
    expect(formatLocalDay(INSTANT)).toBe('1 сентября 2026');
  });
});

/**
 * sk-514 (15) — the dictionary patterns rely only on the parts that the code
 * really supplies.
 *
 * This is a replacement for the substitution parity removed for these three keys in
 * `i18n.test.tsx`. The replacement is not weaker but stronger: parity compares two
 * dictionaries with each other and therefore lets through a CONSISTENT typo —
 * `{{monthname}}` in both languages at once it counts as a match and keeps silent,
 * while the reader sees a literal. Here the comparison is with the real call of the
 * formatter, and such a typo goes red in any language.
 */
describe('sk-514 (15) — the date patterns do not ask for parts that do not exist', () => {
  const placeholders = (pattern: string) =>
    [...pattern.matchAll(/\{\{\s*([\w.]+)[^}]*\}\}/g)].map((m) => m[1]);

  const SUPPLIED = new Set(Object.keys(utcParts(new Date(INSTANT))));

  for (const [lang, dict] of [['ru', ru], ['en', en]] as const) {
    for (const key of ['absolute', 'absoluteZoned', 'stamp'] as const) {
      test(`${lang}: "${key}" — every substitution is among the supplied parts`, () => {
        const pattern = dict.common.time[key];
        const used = placeholders(pattern);
        expect(used.length, `${lang}.${key} substitutes nothing`).toBeGreaterThan(0);
        for (const name of used) {
          expect(
            SUPPLIED.has(name),
            `${lang}.${key} asks for "${name}", while the formatter supplies: ${[...SUPPLIED].join(', ')}`,
          ).toBe(true);
        }
      });
    }
  }

  test('"absolute" does not ask for the time of day — not every call supplies it', () => {
    // `formatLocalDay` builds the parts itself and does not supply hours with minutes:
    // this is a CALENDAR day, it has no time. Ask the pattern for `hh` — and
    // the local day would print the literal "{{hh}}" instead of an hour.
    for (const dict of [ru, en]) {
      const used = placeholders(dict.common.time.absolute);
      expect(used).not.toContain('hh');
      expect(used).not.toContain('mm');
    }
  });
});
