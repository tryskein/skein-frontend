/**
 * sk-489 (test plan, row 50) — INV-2 on the client: the known values,
 * their label keys and the "no work" predicate.
 *
 * What is proven here and why it is worth a test:
 *
 *  1. The list of the four values and the list of label keys are ONE
 *     source. If they diverged, the modal would offer a variant that has
 *     no label — and the variant would be printed as a key.
 *  2. An unfamiliar value (an api newer than us) gets no label, is not
 *     counted as done and is not counted as dropped out. That is INV-2 on
 *     the client: print as is, and take the numbers from the server. The error
 *     the test guards against is silent: the predicate "anything that is not done" would throw
 *     an unfamiliar task out of the progress denominator — i.e. would change the
 *     NUMBERS by a value the server does not let in.
 *  3. Exactly "duplicate" and "superseded" accept a target (US-2) — and exactly them, not
 *     "everything but done": the server rejects the target field for
 *     "won't do".
 */

import { describe, expect, test } from 'vitest';

import {
  KNOWN_CLOSE_OUTCOMES,
  closeOutcomeAcceptsTarget,
  closeOutcomeLabelKey,
  isDoneOutcome,
  isKnownCloseOutcome,
  isNoWorkOutcome,
} from './closeOutcome';
import { en } from '../i18n/locales/en';
import { ru } from '../i18n/locales/ru';

/** A value that is not in the set and cannot be — "an api newer than us". */
const UNKNOWN = 'invented_by_a_newer_server';

describe('closeOutcome — known values', () => {
  test('there are exactly four, in display order, with "done" first', () => {
    // The order carries meaning: "done" is preselected on closing (US-1), and
    // it stands first in the modal precisely because of this list.
    expect(KNOWN_CLOSE_OUTCOMES).toEqual([
      'done',
      'wont_do',
      'duplicate',
      'superseded',
    ]);
  });

  test('the membership predicate is true exactly on them', () => {
    for (const o of KNOWN_CLOSE_OUTCOMES) expect(isKnownCloseOutcome(o)).toBe(true);
    expect(isKnownCloseOutcome(UNKNOWN)).toBe(false);
    // An empty string and absence are not an outcome. An unclosed task has no outcome
    // and it must not be treated as a value.
    expect(isKnownCloseOutcome('')).toBe(false);
    expect(isKnownCloseOutcome(null)).toBe(false);
    expect(isKnownCloseOutcome(undefined)).toBe(false);
    // Case is not normalised — exactly as on the server
    // (`close_outcome.go#ValidateCloseOutcome`).
    expect(isKnownCloseOutcome('Done')).toBe(false);
  });

  test('each has a label key, and the key resolves in BOTH dictionaries', () => {
    // Otherwise "the key exists" would only mean "the string is non-empty", and the
    // key itself would reach the screen.
    for (const o of KNOWN_CLOSE_OUTCOMES) {
      const key = closeOutcomeLabelKey(o);
      expect(key, `no label key for "${o}"`).toBeTruthy();
      // The keys are namespaced: `details:closeOutcome.<name>`.
      const [ns, path] = key!.split(':');
      expect(ns).toBe('details');
      // The path is counted FROM THE NAMESPACE, not from the dictionary root:
      // `details:closeOutcome.done` lives at `en.details.closeOutcome.done`.
      const pick = (dict: Record<string, unknown>) =>
        path.split('.').reduce<unknown>((acc, seg) => {
          return acc && typeof acc === 'object'
            ? (acc as Record<string, unknown>)[seg]
            : undefined;
        }, dict[ns]);
      expect(typeof pick(en as unknown as Record<string, unknown>)).toBe('string');
      expect(typeof pick(ru as unknown as Record<string, unknown>)).toBe('string');
    }
  });

  test('the keys are distinct — four values do not collapse into one label', () => {
    const keys = KNOWN_CLOSE_OUTCOMES.map((o) => closeOutcomeLabelKey(o));
    expect(new Set(keys).size).toBe(KNOWN_CLOSE_OUTCOMES.length);
  });
});

describe('closeOutcome — the "no work" predicate (INV-5 on the client)', () => {
  test('true on three values and false on "done"', () => {
    expect(isNoWorkOutcome('wont_do')).toBe(true);
    expect(isNoWorkOutcome('duplicate')).toBe(true);
    expect(isNoWorkOutcome('superseded')).toBe(true);
    expect(isNoWorkOutcome('done')).toBe(false);
  });

  test('an UNFAMILIAR value is not dropped out — a whitelist, not "anything that is not done"', () => {
    // It discriminates exactly the implementation one is tempted to write:
    // `outcome !== 'done'`. It is green on the four known values and
    // lies on the fifth — silently throwing the task out of the progress denominator.
    expect(isNoWorkOutcome(UNKNOWN)).toBe(false);
    expect(isNoWorkOutcome('')).toBe(false);
    expect(isNoWorkOutcome(null)).toBe(false);
    expect(isNoWorkOutcome(undefined)).toBe(false);
  });

  test('and is NOT counted as done — neither of the two predicates assigns it', () => {
    expect(isDoneOutcome(UNKNOWN)).toBe(false);
    expect(isDoneOutcome(null)).toBe(false);
    expect(isDoneOutcome(undefined)).toBe(false);
    expect(isDoneOutcome('done')).toBe(true);
    // Together: an unfamiliar value belongs to neither of the two
    // buckets. That is the "I do not claim" of INV-2, not a third bucket.
    expect(isDoneOutcome(UNKNOWN) || isNoWorkOutcome(UNKNOWN)).toBe(false);
  });
});

describe('closeOutcome — printing an unfamiliar value', () => {
  test('no label — only the string itself may be printed', () => {
    // `null`, not a fallback key: the caller must be left with no
    // way to print an unfamiliar value in someone else's word.
    expect(closeOutcomeLabelKey(UNKNOWN)).toBeNull();
    expect(closeOutcomeLabelKey('')).toBeNull();
    expect(closeOutcomeLabelKey(null)).toBeNull();
    expect(closeOutcomeLabelKey(undefined)).toBeNull();
  });
});

describe('closeOutcome — link target (US-2)', () => {
  test('exactly "duplicate" and "superseded" accept it', () => {
    expect(closeOutcomeAcceptsTarget('duplicate')).toBe(true);
    expect(closeOutcomeAcceptsTarget('superseded')).toBe(true);
    expect(closeOutcomeAcceptsTarget('done')).toBe(false);
    // Not "everything that is not done": a target with "won't do" is a validation
    // refusal on the server.
    expect(closeOutcomeAcceptsTarget('wont_do')).toBe(false);
  });

  test('an unfamiliar value does not accept a target', () => {
    // The interface does not offer a field whose meaning we do not know.
    expect(closeOutcomeAcceptsTarget(UNKNOWN)).toBe(false);
  });
});
