/**
 * sk-479 (api contract sk-423) — the rule for showing the number of links to issues from
 * unavailable projects (`lib/unavailableLinks.ts`). Both response forms:
 * the new api sends a number (0 or more), the old one does not send the field at all.
 */
import { describe, expect, test } from 'vitest';
import { unavailableLinksToShow } from './unavailableLinks';

describe('unavailableLinksToShow — new api (the field is present)', () => {
  test.each([
    ['open', 1, 1],
    ['in_progress', 2, 2],
    ['deferred', 5, 5],
    ['open', 0, 0],
  ] as const)('%s, %d → %d', (status, count, expected) => {
    expect(unavailableLinksToShow(status, count)).toBe(expected);
  });

  test('closed and permanent — 0: they have no readiness question', () => {
    expect(unavailableLinksToShow('closed', 3)).toBe(0);
    expect(unavailableLinksToShow('standing', 3)).toBe(0);
  });

  test('a row without a status (tree placeholder) — 0', () => {
    expect(unavailableLinksToShow('', 3)).toBe(0);
  });
});

describe('unavailableLinksToShow — old api and a corrupted response', () => {
  test('no field (api older than sk-423) — 0, no error', () => {
    expect(unavailableLinksToShow('open', undefined)).toBe(0);
  });

  test.each([[null], [-1], [1.5], ['2'], [Number.NaN]])(
    'not a positive integer (%j) — 0, not an invented count',
    (value) => {
      expect(unavailableLinksToShow('open', value)).toBe(0);
    },
  );
});
