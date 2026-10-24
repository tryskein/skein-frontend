/**
 * sk-285.7.2.41 — audit finding D2B-7: the affordance under an empty
 * details section («Add», «Upload») shows a short word, and its
 * accessible name is the specific one («Add acceptance criteria»).
 *
 * Voice control («click Add») matches the accessible name against the
 * visible word, so the name has to CONTAIN the word (WCAG 2.5.3). The
 * size and paint of the button are not checked by tests (sk-540.11,
 * owner decision).
 */

import { describe, expect, test } from 'vitest';

import { en } from '../../../i18n/locales/en';
import { ru } from '../../../i18n/locales/ru';

/**
 * The WCAG 2.5.3 half, checked against the DICTIONARY rather than the
 * markup: the visible word and the accessible name are two different
 * strings in two different keys, and the requirement is a relation
 * between them.
 */
describe('D2B-7 — the accessible name contains the visible word (WCAG 2.5.3)', () => {
  const PAIRS: Array<[keyof typeof SHORT, string]> = [
    ['add', 'addDescription'],
    ['add', 'addAcceptanceCriteria'],
    ['add', 'addNotes'],
    // sk-421.1 T017 (US-9) — the «Design» section's add affordance.
    ['add', 'addDesign'],
    ['upload', 'addAttachment'],
  ];
  const SHORT = { add: '', upload: '', watch: '' };

  for (const locale of ['en', 'ru'] as const) {
    test(`${locale}`, () => {
      const dict = (locale === 'en' ? en : ru).details as Record<string, unknown>;
      const short = dict.emptyAdd as Record<string, string>;
      expect(typeof short.add).toBe('string');
      expect(typeof short.upload).toBe('string');
      expect(typeof short.watch).toBe('string');
      for (const [shortKey, nameKey] of PAIRS) {
        const name = dict[nameKey] as string;
        expect(typeof name, `${locale}.details.${nameKey} is missing`).toBe('string');
        expect(name.toLowerCase()).toContain(short[shortKey].toLowerCase());
        // …and the name is the SPECIFIC one, i.e. longer than the word.
        expect(name.length).toBeGreaterThan(short[shortKey].length);
      }
      // The two nested ones, same rule.
      const deps = dict.deps as Record<string, string>;
      expect(deps.addAffordance.toLowerCase()).toContain(short.add.toLowerCase());
      const watchers = dict.watchers as Record<string, string>;
      expect(watchers.add.toLowerCase()).toContain(short.watch.toLowerCase());
      // No literal plus survives in any of them.
      for (const s of [...PAIRS.map(([, k]) => dict[k] as string), deps.addAffordance, watchers.add]) {
        expect(s).not.toContain('+');
      }
    });
  }
});
