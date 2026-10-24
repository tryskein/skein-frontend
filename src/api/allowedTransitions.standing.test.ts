/**
 * sk-118 (F2c) — the CORRECTED standing transition matrix, asserted on
 * the client-side `allowedTransitions()` state machine (the source of
 * truth for the status dropdown / shortcut menu).
 *
 * The matrix (decision §3, §11.8):
 *   - promote TO standing from: open, deferred, closed
 *   - demote FROM standing: ONLY → open
 *   - standing → in_progress  : NOT offered (act via children)
 *   - standing → deferred     : NOT offered
 *   - in_progress → standing  : NOT offered (must unclaim → open first)
 */

import { describe, expect, test } from 'vitest';
import { allowedTransitions, type IssueStatus } from './issues';

describe('allowedTransitions — sk-118 standing matrix', () => {
  test('standing demotes to exactly {open}', () => {
    expect(allowedTransitions('standing')).toEqual(['open']);
  });

  test('standing does NOT offer in_progress', () => {
    expect(allowedTransitions('standing')).not.toContain('in_progress');
  });

  test('standing does NOT offer deferred', () => {
    expect(allowedTransitions('standing')).not.toContain('deferred');
  });

  test('standing does NOT offer closed in the transition list (retire goes through the retire dialog)', () => {
    expect(allowedTransitions('standing')).not.toContain('closed');
  });

  test('open can be promoted TO standing', () => {
    expect(allowedTransitions('open')).toContain('standing');
  });

  test('deferred can be promoted TO standing', () => {
    expect(allowedTransitions('deferred')).toContain('standing');
  });

  test('closed can be reopened TO standing (decision #5)', () => {
    expect(allowedTransitions('closed')).toContain('standing');
  });

  test('in_progress is NOT promotable directly TO standing (must unclaim → open first)', () => {
    expect(allowedTransitions('in_progress')).not.toContain('standing');
  });

  test('the non-standing transitions are preserved (no regression)', () => {
    // Spot-check the pre-existing edges still hold so the standing
    // additions didn't clobber the base matrix.
    expect(allowedTransitions('open')).toEqual(
      expect.arrayContaining(['in_progress', 'deferred', 'closed']),
    );
    expect(allowedTransitions('in_progress')).toEqual(
      expect.arrayContaining(['open', 'deferred', 'closed']),
    );
    expect(allowedTransitions('deferred')).toEqual(
      expect.arrayContaining(['in_progress', 'closed']),
    );
    expect(allowedTransitions('closed')).toContain('open');
  });

  test('standing is a member of the IssueStatus union (compile-time + runtime)', () => {
    const s: IssueStatus = 'standing';
    expect(s).toBe('standing');
  });
});
