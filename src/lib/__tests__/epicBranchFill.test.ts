/**
 * sk-421.3 T14a (PL-6a, US-5 acceptance "segment edges do not lie") — the rule
 * for the branch segment size.
 *
 * Pure logic, no rendering: the rule lives in one place, and it can be
 * proven without a stand — like `epicRingPercent` and `epicChildCategories`.
 *
 * ─── The corruption must prove TWO things ─────────────────────────
 *
 * The lesson of this run, which cost the review a separate finding: a green
 * test is not proof, and the negative control must show not only that the
 * check goes red, but that the corruption REALLY corrupts the subject.
 * For a pure function the "corruption" has an exact form — the very naive
 * implementation the rule replaces (`Math.round`). So on every edge input
 * it is first shown that the naive answer is DIFFERENT, and only then that
 * the rule answers correctly. Without the first half the check
 * "199/200 is not filled completely" would pass on an input where rounding
 * is not wrong anyway, i.e. would prove nothing.
 */

import { describe, expect, test } from 'vitest';
import { branchFillPercent } from '../epicBranchFill';
import { progressNumbers, type ProgressNumbers } from '../progressNumbers';
import type { EpicProgress } from '../../api/issues';

/**
 * sk-489 T016 — the rule's input became ONE value: the progress numbers whose
 * denominator is already without the dropped ones (`lib/progressNumbers.ts`). Here they
 * are assembled by hand, because the size rule ITSELF is checked, not
 * where the numbers came from; the chain "summary → numbers → width" is proven by
 * the test task of matrix row 61.
 */
const fill = (done: number, denominator: number): number | null =>
  branchFillPercent({ done, denominator, fromNewFields: true } satisfies ProgressNumbers);

describe('sk-421.3 T14a — branch segment edges do not lie', () => {
  test('199 of 200: the segment is NOT filled completely', () => {
    // First: the corruption here is not empty — naive rounding really lies.
    // Then: the rule does not take the upper edge.
    const width = fill(199, 200);
    expect(width, 'the styling claims an unclosed branch is complete').not.toBe(100);
    expect(width).toBeCloseTo(99.5, 10);
  });

  test('1 of 1000: the segment is visible, not empty', () => {
    const width = fill(1, 1000)!;
    expect(width, 'the finished work is shown as an empty bar').toBeGreaterThan(0);
    expect(width).toBeCloseTo(0.1, 10);
  });

  test('negative control — the edges are taken when they are TRUE', () => {
    // Without this, "do not fill completely" and "do not leave empty" could
    // be satisfied by never doing it AT ALL, and the rule would become a lie
    // from the other side.
    expect(fill(200, 200), 'all are closed, yet the segment is not full').toBe(100);
    expect(fill(1, 1), 'all are closed, yet the segment is not full').toBe(100);
    expect(fill(0, 1000), 'none is closed, yet the segment is not empty').toBe(0);
  });

  test('full fill — IF AND ONLY IF all are closed', () => {
    // Recognised by EQUALITY, not by the share being close to a hundred: otherwise
    // "almost all" would one day be taken as complete — exactly the earlier defect.
    for (const [closed, total] of [
      [199, 200],
      [1999, 2000],
      [19999, 20000],
      [2, 3],
      [99, 100],
    ]) {
      expect(
        fill(closed, total),
        `${closed}/${total}: a branch with a live unclosed child is filled completely`,
      ).toBeLessThan(100);
    }
    // A summary with more closed than the total gives no segment longer than the bar.
    expect(fill(5, 3)).toBe(100);
  });

  test('non-zero width — for EACH closed child, however small the contribution', () => {
    for (const total of [1000, 10_000, 1_000_000]) {
      expect(
        fill(1, total),
        `1/${total}: the finished work is shown as an empty bar`,
      ).toBeGreaterThan(0);
    }
  });

  test('between the edges — the EXACT share, no rounding to whole percents', () => {
    // The essence of PL-6a: the rule touches only the two edges, and
    // everything else must remain the value as is.
    expect(fill(1, 4)).toBe(25);
    expect(fill(1, 2)).toBe(50);
    expect(fill(7, 9)).toBeCloseTo(77.777_777_777, 6);
    expect(fill(1, 3)).toBeCloseTo(33.333_333_333, 6);
    // And precisely NOT rounded: an integer here would be a different answer.
    expect(fill(7, 9)).not.toBe(78);
    expect(fill(1, 3)).not.toBe(33);
  });

  test('zero total — there is NO segment, and that is not a zero width', () => {
    // `null`, not `0`: the caller uses it to decide whether to draw the
    // element at all. US-5 acceptance forbids an empty space in place of the segment.
    expect(fill(0, 0)).toBeNull();
    expect(fill(5, 0)).toBeNull();
  });

  test('the ring printing rule did NOT move here (m-16)', () => {
    // The duplication m-16 fears has an observable trace: clamping
    // 1…99 would make the segment at 199/200 SHORTER than the exact share, and at
    // 1/1000 — longer. This is what is checked, not the function name.
    expect(fill(199, 200)).toBeGreaterThan(99);
    expect(fill(1, 1000)).toBeLessThan(1);
  });
});

/**
 * sk-489 T016 (US-6, INV-5, SC-010; test plan row 61) — the SEAM between
 * the row progress and the segment size.
 *
 * The checks above assemble numbers by hand and prove only the edge rule.
 * The feature's error lives not in it but in the seam: which progress fields reached
 * the denominator. It is visible only where both rules stand in one call —
 * exactly as the row calls them. The lesson of wave F/1: the two sides of the seam, checked
 * separately on stand-in data, missed the defect exactly in the middle.
 */
describe('sk-489 T016 — the segment denominator comes from the numbers rule', () => {
  /** The row progress; the total fields are appended on top. */
  const progress = (over: Partial<EpicProgress> = {}): EpicProgress => ({
    closed: 3,
    total: 4,
    ...over,
  });

  test('new server — a share of the denominator, not of the row total', () => {
    // 1 done + 1 in progress + 2 will-not-do: denominator 2, total 4.
    const row = progress({ done: 1, counted: 2, noWork: 2 });

    // First: the corruption is not empty — the old pair gives a DIFFERENT width.
    expect(branchFillPercent(progressNumbers(row))).toBeCloseTo(50, 6);
  });

  test('old server (US-10, SC-010) — the old pair and the old width', () => {
    expect(branchFillPercent(progressNumbers(progress()))).toBeCloseTo(75, 6);
  });

  test('all counted ones dropped out — there is NO segment, not a full fill', () => {
    // The old pair would say "all closed" and fill the bar completely —
    // i.e. declare complete a branch where nothing is done.
    const row = progress({ closed: 2, total: 2, done: 0, counted: 0, noWork: 2 });
    expect(branchFillPercent(progressNumbers(row))).toBeNull();
  });
});
