/**
 * sk-514 (13) — the live ticker speaks the interface language.
 *
 * The complaint (2026-09-21) was that the Live ticker in HOT ZONE was hard
 * to read. One of the causes was the machine verb: `status_changed` reads
 * in no language. The verbs now come from the dictionary; this file holds
 * that the Russian ones really are Russian.
 *
 * The ticker's column headers are checked on the rendered page in
 * `ActivityDashboard.test.tsx`. Contrast and opacity are not checked by
 * tests (sk-540.11, owner decision).
 */

import { describe, expect, test } from 'vitest';

import { ru } from '../../i18n/locales/ru';

describe('sk-514 (13) — the machine token no longer reaches the screen', () => {
  test('the Russian verb labels are really Russian', () => {
    // Key parity lets a dictionary with a copy of the English strings pass.
    // Cyrillic is required.
    for (const [key, value] of Object.entries(ru.ticker.verb as Record<string, string>)) {
      expect(/[а-яё]/i.test(value), `ru: verb "${key}" = "${value}" is not in Russian`).toBe(true);
    }
  });
});
