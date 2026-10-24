/**
 * sk-62.2 — pure reminder countdown / state-derivation tests.
 *
 * Drives the helpers with a fixed `now` so the armed/ringing boundary,
 * the countdown granularity ladder, and the urgency comparator are all
 * deterministic.
 */

import { describe, expect, test } from 'vitest';
import {
  compareReminderUrgency,
  formatCountdown,
  formatRingingSince,
  reminderState,
} from './reminderCountdown';

const NOW = Date.parse('2026-06-01T12:00:00.000Z');

describe('reminderState — armed vs ringing from remindAt', () => {
  test('future remindAt → armed', () => {
    expect(reminderState('2026-06-01T12:00:01.000Z', NOW)).toBe('armed');
  });

  test('past remindAt → ringing', () => {
    expect(reminderState('2026-06-01T11:59:59.000Z', NOW)).toBe('ringing');
  });

  test('exactly now → ringing (boundary is inclusive)', () => {
    expect(reminderState('2026-06-01T12:00:00.000Z', NOW)).toBe('ringing');
  });

  test('unparseable remindAt → armed (never scream on garbage)', () => {
    expect(reminderState('not-a-date', NOW)).toBe('armed');
  });
});

describe('formatCountdown — granularity ladder', () => {
  test('null when already past', () => {
    expect(formatCountdown('2026-06-01T11:00:00.000Z', NOW)).toBeNull();
  });

  test('>= 1 day → "Xd Yh"', () => {
    // +3 days 4 hours.
    const t = new Date(NOW + (3 * 86_400 + 4 * 3_600) * 1000).toISOString();
    expect(formatCountdown(t, NOW)).toBe('3d 4h');
  });

  test('>= 1 hour → "Xh Ym"', () => {
    const t = new Date(NOW + (2 * 3_600 + 5 * 60) * 1000).toISOString();
    expect(formatCountdown(t, NOW)).toBe('2h 5m');
  });

  test('>= 1 minute → "Xm YYs" (seconds zero-padded)', () => {
    const t = new Date(NOW + (12 * 60 + 3) * 1000).toISOString();
    expect(formatCountdown(t, NOW)).toBe('12m 03s');
  });

  test('< 1 minute → "Ys"', () => {
    const t = new Date(NOW + 42 * 1000).toISOString();
    expect(formatCountdown(t, NOW)).toBe('42s');
  });
});

describe('formatRingingSince — HH:MM UTC, prefers notifiedAt', () => {
  // sk-285.6.7 — these used to build LOCAL Dates and compare the output
  // against their own getHours(), which made them pass in every zone and
  // assert nothing about which clock the card runs on. The pulse now
  // prints UTC and says so, so the expectation is a literal: a fixed
  // instant has exactly one UTC reading, and the test is only stable
  // across zones because the production code stopped reading the zone.
  test('prefers notifiedAt over remindAt', () => {
    const out = formatRingingSince(
      '2026-06-01T09:07:00.000Z',
      '2026-06-01T08:00:00.000Z',
    );
    expect(out).toBe('09:07 UTC');
  });

  test('falls back to remindAt when notifiedAt is absent', () => {
    expect(formatRingingSince(null, '2026-06-01T14:30:00.000Z')).toBe(
      '14:30 UTC',
    );
  });

  test('the zone is stated, not implied', () => {
    // The defect this replaces: a bare `14:30` in a card whose comment
    // stamps, closed-at row and activity feed all end in `UTC`. Nothing
    // on screen told the reader the pulse was the ONE label on a
    // different clock.
    expect(formatRingingSince(null, '2026-06-01T14:30:00.000Z')).toMatch(
      / UTC$/,
    );
  });
});

describe('compareReminderUrgency — ringing first, then earliest remindAt', () => {
  test('ringing sorts before armed', () => {
    const ringing = { remindAt: '2026-06-01T11:00:00.000Z' };
    const armed = { remindAt: '2026-06-01T13:00:00.000Z' };
    expect(compareReminderUrgency(ringing, armed, NOW)).toBeLessThan(0);
    expect(compareReminderUrgency(armed, ringing, NOW)).toBeGreaterThan(0);
  });

  test('within the same group, earlier remindAt is more urgent', () => {
    const earlier = { remindAt: '2026-06-01T13:00:00.000Z' };
    const later = { remindAt: '2026-06-01T15:00:00.000Z' };
    expect(compareReminderUrgency(earlier, later, NOW)).toBeLessThan(0);
  });

  test('full sort: ringing-by-time then armed-by-time', () => {
    const list = [
      { id: 'armed-late', remindAt: '2026-06-01T18:00:00.000Z' },
      { id: 'ring-late', remindAt: '2026-06-01T11:30:00.000Z' },
      { id: 'armed-soon', remindAt: '2026-06-01T13:00:00.000Z' },
      { id: 'ring-early', remindAt: '2026-06-01T10:00:00.000Z' },
    ];
    const sorted = [...list].sort((a, b) => compareReminderUrgency(a, b, NOW));
    expect(sorted.map((r) => r.id)).toEqual([
      'ring-early',
      'ring-late',
      'armed-soon',
      'armed-late',
    ]);
  });
});
