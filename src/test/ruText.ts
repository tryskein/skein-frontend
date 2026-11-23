/**
 * Russian UI text for tests, read from the Russian dictionary rather than
 * written out in the test (the wording is not a contract, TEST_GUIDELINES §5).
 *
 * The value must be non-empty and must differ from the English one: a key
 * missing from `ru.ts` resolves to the English fallback, and an emptied one
 * would otherwise match any text it is searched in.
 */
import { expect } from 'vitest';
import i18n from '../i18n/config';

export function ruOnly(ns: string, key: string, opts: Record<string, unknown> = {}): string {
  const ruText = i18n.getFixedT('ru', ns)(key, opts) as string;
  expect(ruText.trim(), `${ns}:${key} is empty in Russian`).not.toBe('');
  expect(ruText, `${ns}:${key}`).not.toBe(i18n.getFixedT('en', ns)(key, opts) as string);
  return ruText;
}

/** The Russian plural forms an integer count can pick. */
export type RuIntegerForm = 'one' | 'few' | 'many';

/**
 * The Russian text a count of `n` must show, built from the raw template of
 * the form the TEST names (not the form i18next picks — that choice is what
 * is under test): `{{count}}` replaced by `n`.
 */
export function ruPlural(ns: string, key: string, n: number, form: RuIntegerForm): string {
  const raw = ruTemplate(ns, `${key}_${form}`);
  expect(raw, `${ns}:${key}_${form} does not show the count`).toContain('{{count}}');
  return raw.split('{{count}}').join(String(n));
}

/** The raw Russian template of a key, required to be a non-empty string. */
export function ruTemplate(ns: string, key: string): string {
  const raw = i18n.getResource('ru', ns, key) as unknown;
  expect(typeof raw === 'string' && raw.trim() !== '', `${ns}:${key} is missing or empty in Russian`).toBe(true);
  return raw as string;
}
