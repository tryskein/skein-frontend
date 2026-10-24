/**
 * sk-489 (test plan, row 51) — recognizing an old api on the frontend
 * (US-10, SC-010, SC-002).
 *
 * The module chooses between two sets of fields, and its whole point is the
 * difference that is easy to erase with one line:
 *
 *   "the field did not arrive"  ≠  "zero arrived"
 *
 * `?? 0` turns the former into the latter, and after that the old api's ring
 * shows "0 of 0" instead of today's numbers, and the tail "no work: 0"
 * asserts something the server did not report. So there is a separate
 * case for `noWork: 0` and a separate one for its absence, and they must
 * give a DIFFERENT result.
 *
 * The second half is SC-002: with data where all closed are "done"
 * (`done = closed`, `counted = total`), the new path must give exactly the same
 * numbers as the old one. Otherwise the migration would shift percentages on a data
 * snapshot where there is nothing to shift.
 */

import { describe, expect, test } from 'vitest';

import type { EpicProgress, EpicRollup } from '../api/issues';
import { progressCaption, progressNumbers } from './progressNumbers';

/** An epic rollup of the old api: no new fields at all. */
function oldRollup(over: Partial<EpicRollup> = {}): EpicRollup {
  return {
    totalChildren: 4,
    openChildren: 1,
    inProgressChildren: 0,
    closedChildren: 3,
    blockedChildren: 0,
    eligibleForClose: false,
    ...over,
  };
}

/** A row progress of the old api: only the old pair. */
function oldProgress(over: Partial<EpicProgress> = {}): EpicProgress {
  return { closed: 3, total: 4, ...over };
}

describe('progressNumbers — epic rollup (EpicRollup)', () => {
  test('with the new fields: denominator = countedChildren, and it is NOT totalChildren', () => {
    // Spec, US-5: 3 done + 1 "won't do" → "3 of 3", tail "1".
    // The denominator is 3, while there are 4 children in total — if the helper takes
    // `totalChildren`, the ring will show 75 % instead of 100 %.
    const got = progressNumbers(
      oldRollup({
        totalChildren: 4,
        closedChildren: 4,
        doneChildren: 3,
        noWorkChildren: 1,
        countedChildren: 3,
      }),
    );
    expect(got).toEqual({
      done: 3,
      denominator: 3,
      noWork: 1,
      fromNewFields: true,
    });
  });

  test('without the new fields: the old closed/total pair, no flag, noWork is ABSENT', () => {
    const got = progressNumbers(oldRollup());
    expect(got).toEqual({ done: 3, denominator: 4, fromNewFields: false });
    // Precisely the absence of the key, not zero: the caller uses it to decide that
    // the "no work" tail must not exist at all.
    expect('noWork' in got).toBe(false);
  });

  test('noWorkChildren: 0 ARRIVED — this is not the same as not arriving', () => {
    const came = progressNumbers(
      oldRollup({ doneChildren: 4, noWorkChildren: 0, countedChildren: 4 }),
    );
    const absent = progressNumbers(
      oldRollup({ doneChildren: 4, countedChildren: 4 }),
    );
    expect(came.noWork).toBe(0);
    expect('noWork' in came).toBe(true);
    expect('noWork' in absent).toBe(false);
    // And this is exactly the pair that `?? 0` would glue together.
    expect(came).not.toEqual(absent);
  });
});

describe('progressNumbers — row progress (EpicProgress)', () => {
  test('with the new fields: denominator = counted', () => {
    const got = progressNumbers(
      oldProgress({ closed: 4, total: 4, done: 3, noWork: 1, counted: 3 }),
    );
    expect(got).toEqual({ done: 3, denominator: 3, noWork: 1, fromNewFields: true });
  });

  test('without the new fields: the old pair, noWork is absent', () => {
    const got = progressNumbers(oldProgress());
    expect(got).toEqual({ done: 3, denominator: 4, fromNewFields: false });
    expect('noWork' in got).toBe(false);
  });

  test('noWork: 0 arrived ≠ did not arrive', () => {
    const came = progressNumbers(oldProgress({ done: 3, noWork: 0, counted: 4 }));
    const absent = progressNumbers(oldProgress({ done: 3, counted: 4 }));
    expect(came.noWork).toBe(0);
    expect('noWork' in absent).toBe(false);
    expect(came).not.toEqual(absent);
  });

  test('two field forms — one rule: the same input gives the same output', () => {
    // The epic rollup and the row progress differ only in the spelling of the fields.
    // They must not drift apart: INV-5 requires one number on all
    // surfaces of one screen.
    const fromRollup = progressNumbers(
      oldRollup({ doneChildren: 2, noWorkChildren: 1, countedChildren: 3 }),
    );
    const fromProgress = progressNumbers(
      oldProgress({ done: 2, noWork: 1, counted: 3 }),
    );
    expect(fromRollup).toEqual(fromProgress);
  });
});

describe('progressNumbers — SC-002: the data snapshot before the rollout does not shift', () => {
  test('done = closed and counted = total → the same numbers as by the old path', () => {
    // Exactly the state after seeding (US-8): all closed are "done",
    // there are no dropped ones. The numbers must match the path by the old fields,
    // otherwise the migration would shift percentages on data where there is nothing to shift.
    const legacy = progressNumbers(oldRollup({ closedChildren: 3, totalChildren: 4 }));
    const migrated = progressNumbers(
      oldRollup({
        closedChildren: 3,
        totalChildren: 4,
        doneChildren: 3,
        noWorkChildren: 0,
        countedChildren: 4,
      }),
    );
    expect(migrated.done).toBe(legacy.done);
    expect(migrated.denominator).toBe(legacy.denominator);
    // The ratio is the same number, not "about the same".
    expect(migrated.done / migrated.denominator).toBe(
      legacy.done / legacy.denominator,
    );
    // Exactly one thing differs: the new response has something to say about
    // the dropped ones (there are none), the old one does not.
    expect(migrated.fromNewFields).toBe(true);
    expect(legacy.fromNewFields).toBe(false);
  });
});

describe('progressNumbers — half of the new fields is not counted as a new response', () => {
  test('"done" arrived but the denominator did not → the old pair', () => {
    // The fraction is built from TWO numbers. Taking the numerator from the new field and
    // the denominator from the old `totalChildren` would mix two
    // rules and produce a ratio that no api version has.
    const got = progressNumbers(oldRollup({ doneChildren: 2 }));
    expect(got).toEqual({ done: 3, denominator: 4, fromNewFields: false });
  });

  test('the denominator arrived but "done" did not → the old pair', () => {
    const got = progressNumbers(oldRollup({ countedChildren: 3 }));
    expect(got).toEqual({ done: 3, denominator: 4, fromNewFields: false });
  });
});

/**
 * sk-540.3 — the caption rule of the compact progress surfaces (chip, tree
 * cell, branch row). Expected forms come from the acceptance of sk-540.3:
 * the excluded count is shown next to "done / counted"; an empty
 * denominator with excluded children has its own caption; "no children"
 * stays a pair; an old api (no outcome legs) keeps the legacy pair and
 * never gets a tail; a missing `noWork` is never a tail of 0.
 */
describe('sk-540.3 — progressCaption', () => {
  test.each<{ name: string; progress: EpicProgress; want: ReturnType<typeof progressCaption> }>([
    {
      name: 'excluded children → pair plus the excluded count',
      progress: { closed: 4, total: 4, done: 3, counted: 3, noWork: 1 },
      want: { kind: 'done', done: 3, counted: 3, excluded: 1 },
    },
    {
      name: 'nothing excluded → pair, no tail',
      progress: { closed: 1, total: 2, done: 1, counted: 2, noWork: 0 },
      want: { kind: 'done', done: 1, counted: 2, excluded: null },
    },
    {
      name: 'noWork not reported → pair, no tail (not a tail of 0)',
      progress: { closed: 1, total: 2, done: 1, counted: 2 },
      want: { kind: 'done', done: 1, counted: 2, excluded: null },
    },
    {
      name: 'all counted children excluded → allExcluded',
      progress: { closed: 3, total: 3, done: 0, counted: 0, noWork: 3 },
      want: { kind: 'allExcluded', excluded: 3 },
    },
    {
      name: 'no children (or only standing) → pair 0/0, not allExcluded',
      progress: { closed: 0, total: 0, done: 0, counted: 0, noWork: 0 },
      want: { kind: 'done', done: 0, counted: 0, excluded: null },
    },
    {
      name: 'only unavailable children besides the excluded → pair, not allExcluded',
      progress: { closed: 2, total: 3, unavailable: 1, done: 0, counted: 1, noWork: 2 },
      want: { kind: 'done', done: 0, counted: 1, excluded: 2 },
    },
    {
      name: 'old api → legacy closed/total pair',
      progress: { closed: 3, total: 4 },
      want: { kind: 'plain', closed: 3, total: 4 },
    },
  ])('$name', ({ progress, want }) => {
    expect(progressCaption(progressNumbers(progress))).toEqual(want);
  });
});
