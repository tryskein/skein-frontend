/**
 * sk-285.6.8 — the card's empty states, read as strings.
 *
 * Four empty states in one card used to be written four ways:
 *
 *   "> no attachments yet."         prefix ">", lower case, full stop
 *   "— none"          (×2, deps)    prefix "—", no stop
 *   "— commits not linked"          same prefix, but a phrase
 *   "No alarms on this task."        no prefix, capital, a sentence
 *
 * Three prefixes and three registers in a row read as three authors.
 * They are now ONE key — `details.emptyValue` — and the private
 * variants are gone: a future section that invents its own
 * "— nothing here" adds a key, and only the keys are enumerable.
 */

import { describe, expect, it } from 'vitest';

import { ru } from '../../../i18n/locales/ru';
import { en } from '../../../i18n/locales/en';

type Dict = Record<string, unknown>;
function at(dict: Dict, dotted: string): unknown {
  return dotted
    .split('.')
    .reduce<unknown>(
      (node, key) =>
        node != null && typeof node === 'object'
          ? (node as Dict)[key]
          : undefined,
      dict,
    );
}

describe('card empty states — one template, both locales', () => {
  it('both dictionaries carry the shared empty word', () => {
    expect(typeof at(ru as Dict, 'details.emptyValue')).toBe('string');
    expect(typeof at(en as Dict, 'details.emptyValue')).toBe('string');
  });

  it('the four private dialects are gone, not merely unused', () => {
    // Each of these WAS one of the four manners. A key left behind is a
    // key the next section will copy.
    const retired = [
      'details.commits.empty',
      'details.watchers.empty',
      'details.deps.none',
      'details.reminders.empty',
      'details.activity.empty',
    ];
    for (const key of retired) {
      expect(at(ru as Dict, key)).toBeUndefined();
      expect(at(en as Dict, key)).toBeUndefined();
    }
  });

  it('every empty-state string obeys the template: no prefix, lower case, no full stop', () => {
    const strings = [
      at(ru as Dict, 'details.emptyValue'),
      at(en as Dict, 'details.emptyValue'),
      at(ru as Dict, 'attachments.empty'),
      at(en as Dict, 'attachments.empty'),
    ];
    for (const s of strings) {
      expect(typeof s).toBe('string');
      const text = s as string;
      // The three retired prefixes, plus the bullet family they invite.
      expect(text).not.toMatch(/^[>—–-]/);
      expect(text).not.toMatch(/\.$/);
      // Lower case: compare the first character to its own lowering, so
      // this holds for Cyrillic as well as Latin.
      expect(text[0]).toBe(text[0].toLowerCase());
    }
  });
});
