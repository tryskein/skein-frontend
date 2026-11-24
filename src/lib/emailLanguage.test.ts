import { describe, expect, test } from 'vitest';
import { emailLanguage } from './emailLanguage';

// The language of a transactional email follows the interface language:
// any Russian locale gives ru, everything else en (the API knows ru and en).
describe('emailLanguage', () => {
  test.each([
    ['ru', 'ru'],
    ['ru-RU', 'ru'],
    // The language is the part BEFORE the region: Russian spoken in
    // Ukraine is Russian, English in Russia is English.
    ['ru-UA', 'ru'],
    ['en-RU', 'en'],
    ['RU', 'ru'],
    ['en', 'en'],
    ['en-GB', 'en'],
    ['de', 'en'],
    ['', 'en'],
  ])('%j → %s', (language, want) => {
    expect(emailLanguage(language)).toBe(want);
  });
});
