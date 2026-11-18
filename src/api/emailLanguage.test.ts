import { describe, expect, test } from 'vitest';
import { emailLanguageOf } from './auth';

// The language of a transactional email follows the interface language:
// any Russian locale gives ru, everything else en (the API knows ru and en).
describe('emailLanguageOf', () => {
  test.each([
    ['ru', 'ru'],
    ['ru-RU', 'ru'],
    ['RU', 'ru'],
    ['en', 'en'],
    ['en-GB', 'en'],
    ['de', 'en'],
    ['', 'en'],
  ])('%j → %s', (language, want) => {
    expect(emailLanguageOf(language)).toBe(want);
  });
});
