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
