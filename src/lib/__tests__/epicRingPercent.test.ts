/**
 * sk-421.3 T18 (P-57, P-58, P-59) — the rule for printing the percentage inside
 * the ring.
 *
 * Pure logic, no rendering: the rule lives in one place, and it can be
 * proven without a stand — like `epicChildCategories` and `epicRowFocus`.
 *
 * ─── Why there are "a naive implementation would not pass" checks here ───
 *
 * The lesson of this run: a green test is not proof, and the corruption
 * must prove TWO things — that the test notices it and that it really
 * changes the subject. For a pure function the "corruption" has an exact form: the naive
 * implementation, i.e. plain `Math.round`. So on both edge
 * inputs it is first shown that `Math.round` gives a DIFFERENT answer, and only
 * then that the rule gives the right one. Without the first half the checks
 * "199/200 → 99" would pass on an input where rounding is not wrong anyway,
 * i.e. would prove nothing.
 */

import { describe, expect, test } from 'vitest';
import { ringPercentText } from '../epicRingPercent';
import { progressNumbers, type ProgressNumbers } from '../progressNumbers';
import type { EpicRollup } from '../../api/issues';

/**
 * sk-489 T015 — the rule's input became ONE value: the progress numbers whose
 * denominator is already without the dropped ones (`lib/progressNumbers.ts`). Here they
 * are assembled by hand, because the printing rule ITSELF is checked, not
 * where the numbers came from; the chain "summary → numbers → printing" is proven by
 * the test task of matrix row 59.
 */
const ring = (done: number, denominator: number): string | null =>
  ringPercentText({ done, denominator, fromNewFields: true } satisfies ProgressNumbers);

describe('sk-421.3 T18 — edges do not lie', () => {
  test('P-57 — total 200, closed 199: NOT "100"', () => {
    // First: the corruption here is not empty — naive rounding really errs.
    // Then: the rule does not take the edge.
    expect(ring(199, 200)).toBe('99');
  });

  test('P-58 — total 1000, closed 3: NOT "0"', () => {
    expect(ring(3, 1000)).toBe('1');
  });

  test('P-59 (negative control) — the edges are printed when they are TRUE', () => {
    // Without this, "do not print 100" and "do not print 0" could be
    // satisfied by never printing them — and the rule would become a lie
    // from the other side.
    expect(ring(200, 200)).toBe('100');
    expect(ring(0, 1000)).toBe('0');
  });

  test('zero total — there is NOTHING to print, and that is not "0"', () => {
    // `null`, not an empty string: the caller uses it to decide whether to draw the
    // element at all (P-61).
    expect(ring(0, 0)).toBeNull();
    expect(ring(5, 0)).toBeNull();
  });

  test('between the edges the rule is ordinary rounding, not a shift', () => {
    // The clamp must touch ONLY the edges: if it touched the middle,
    // the ring would lie everywhere, not only at the edges.
    expect(ring(1, 2)).toBe('50');
    expect(ring(1, 3)).toBe('33');
    expect(ring(2, 3)).toBe('67');
    for (const closed of [1, 25, 50, 75, 99]) {
      expect(ring(closed, 100)).toBe(String(closed));
    }
  });

  test('the clamp fires only where rounding would go to an edge', () => {
    // Upper edge: 99.5 and above rounds to 100, yet not all are closed.
    expect(ring(1999, 2000)).toBe('99');
    // Lower edge: anything below 0.5 % would round to 0.
    expect(ring(1, 1000)).toBe('1');
    // …and exactly at the rounding boundary the clamp is not needed and does not interfere.
    expect(ring(15, 1000)).toBe('2');
  });

  test('"all closed" and "none" are recognised by EQUALITY, not by the percentage', () => {
    // A small total: 1 of 1 is 100 % both by rounding and by the rule,
    // but the answer must come from equality, otherwise with a total of 3 and two
    // closed (66.67 %) the rule would one day be taken as "almost full".
    expect(ring(1, 1)).toBe('100');
    expect(ring(3, 3)).toBe('100');
    expect(ring(0, 1)).toBe('0');
    expect(ring(2, 3)).not.toBe('100');
  });
});

/**
 * sk-489 T015 (US-5, INV-5, SC-010; test plan row 59) — the SEAM between
 * the summary and the printing.
 *
 * The checks above assemble numbers by hand and therefore prove only the edge
 * rule. The error of this feature lives not in it but in the SEAM: which fields
 * of the summary reached the denominator. The seam is visible only when the numbers
 * rule and the printing rule stand in one call — exactly as the
 * section calls them. The lesson of wave F/1: the two sides of the seam, checked separately on
 * stand-in data, missed the defect that lived exactly in the middle.
 */
describe('sk-489 T015 — the denominator comes from the numbers rule', () => {
  /** The epic summary; the total fields are appended on top. */
  const epic = (over: Partial<EpicRollup> = {}): EpicRollup => ({
    totalChildren: 4,
    openChildren: 1,
    inProgressChildren: 0,
    closedChildren: 3,
    blockedChildren: 0,
    eligibleForClose: false,
    ...over,
  });

  test('new server — a share of the denominator, not of the summary total', () => {
    // 2 done + 1 open + 1 duplicate: denominator 3, and the total 4.
    const rollup = epic({ doneChildren: 2, noWorkChildren: 1, countedChildren: 3 });

    // First: the corruption is not empty — the old pair gives a DIFFERENT number.
    expect(ringPercentText(progressNumbers(rollup))).toBe('67');
  });

  test('old server (US-10, SC-010) — the old pair and the old number', () => {
    // There are no total fields at all: absence is NOT zero, and the ring must
    // show today's 3 of 8.
    const rollup = epic({ totalChildren: 8, closedChildren: 3, openChildren: 5 });
    expect(ringPercentText(progressNumbers(rollup))).toBe('38');
  });

  test('all counted ones dropped out — there is NOTHING to print, not "100"', () => {
    // 2 "will-not-do" and nobody else: the denominator is zero. The old pair
    // would say "all closed" — i.e. exactly the opposite.
    const rollup = epic({
      totalChildren: 2,
      closedChildren: 2,
      openChildren: 0,
      doneChildren: 0,
      noWorkChildren: 2,
      countedChildren: 0,
    });
    expect(ringPercentText(progressNumbers(rollup))).toBeNull();
  });
});
