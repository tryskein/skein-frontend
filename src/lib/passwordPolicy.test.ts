import { describe, expect, test } from 'vitest';
import { passwordProblem } from './passwordPolicy';

// sk-977.7.20: at least 12 characters (code points), at most 72 bytes of
// UTF-8 — the same bounds as the server.
describe('passwordProblem', () => {
  test.each([
    ['11 ASCII', 'a'.repeat(11), 'tooShort'],
    ['12 ASCII', 'a'.repeat(12), null],
    ['6 Cyrillic = 12 bytes', 'ж'.repeat(6), 'tooShort'],
    ['12 Cyrillic', 'ж'.repeat(12), null],
    ['6 emoji = 12 UTF-16 units', '😀'.repeat(6), 'tooShort'],
    ['12 emoji = 48 bytes', '😀'.repeat(12), null],
    ['72 ASCII bytes', 'a'.repeat(72), null],
    ['73 ASCII bytes', 'a'.repeat(73), 'tooLong'],
    ['37 Cyrillic = 74 bytes', 'ж'.repeat(37), 'tooLong'],
  ])('%s', (_name, value, want) => {
    expect(passwordProblem(value)).toBe(want);
  });
});
