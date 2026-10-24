/**
 * sk-421.2 T017 — the "last section event" clock and the freshness criterion
 * (US-2 "Freshness on display", SC-015).
 *
 * Covers:
 *   - before the first event nothing is stale;
 *   - a response REQUESTED before the event is stale;
 *   - a response requested after the event is fresh;
 *   - equal moments are NOT staleness (the rule boundary);
 *   - the clock does not go backwards on an event "from the past";
 *   - the absence of a response counts as stale;
 *   - a call without an argument takes the current time.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  epicSectionClock,
  isStaleAgainstEpicSectionClock,
  markEpicSectionEvent,
  resetEpicSectionClockForTests,
} from '../epicSectionClock';

beforeEach(() => {
  resetEpicSectionClockForTests();
});
afterEach(() => {
  resetEpicSectionClockForTests();
  vi.useRealTimers();
});

describe('epicSectionClock', () => {
  test('before the first event the clock stands and nothing is stale', () => {
    expect(epicSectionClock()).toBe(0);
    expect(isStaleAgainstEpicSectionClock(1_000)).toBe(false);
  });

  test('a response REQUESTED EARLIER than the event is stale', () => {
    markEpicSectionEvent(2_000);
    expect(epicSectionClock()).toBe(2_000);
    expect(isStaleAgainstEpicSectionClock(1_999)).toBe(true);
  });

  test('a response requested LATER than the event is fresh', () => {
    markEpicSectionEvent(2_000);
    expect(isStaleAgainstEpicSectionClock(2_001)).toBe(false);
  });

  test('equal moments do not count as staleness', () => {
    // The rule boundary: a response requested STRICTLY before the event is stale.
    // On equality the request already carried this change.
    markEpicSectionEvent(2_000);
    expect(isStaleAgainstEpicSectionClock(2_000)).toBe(false);
  });

  test('the clock does not go backwards on an event "from the past"', () => {
    markEpicSectionEvent(5_000);
    markEpicSectionEvent(1_000);
    expect(epicSectionClock()).toBe(5_000);
    // …and a response requested between them is still stale: rolling the clock back
    // would "rejuvenate" it.
    expect(isStaleAgainstEpicSectionClock(3_000)).toBe(true);
  });

  test('the absence of a response counts as stale', () => {
    expect(isStaleAgainstEpicSectionClock(null)).toBe(true);
    expect(isStaleAgainstEpicSectionClock(undefined)).toBe(true);
  });

  test('a call without an argument takes the current time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_700_000_000_000));
    markEpicSectionEvent();
    expect(epicSectionClock()).toBe(1_700_000_000_000);
  });
});
