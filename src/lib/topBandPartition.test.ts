/**
 * sk-118 (decision #6, §11.12) — the MANDATORY top-band invariant: standing
 * tasks ALWAYS render above every other task, in EVERY sort order,
 * INDEPENDENT of the `pinned` flag. `partitionStanding` is the pre-sort
 * partition applied last in useTasks' selector, so these tests pin the
 * invariant at the unit level.
 */

import { describe, expect, test } from 'vitest';
import { partitionStanding } from './useTasks';
import type { IssueStatus, IssueSummary } from '../api/issues';

function mk(
  id: string,
  status: IssueStatus,
  opts: { priority?: number; updatedAt?: string; pinned?: boolean } = {},
): IssueSummary {
  return {
    id,
    projectId: 'p1',
    version: 1,
    title: id,
    type: 'task',
    priority: opts.priority ?? 3,
    status,
    pinned: opts.pinned ?? false,
    componentIds: [],
    labels: [],
    isBlocked: false,
    updatedAt: opts.updatedAt ?? '2026-06-01T00:00:00Z',
    createdAt: '2026-06-01T00:00:00Z',
  };
}

describe('partitionStanding — sk-118 mandatory top band', () => {
  test('standing rows float to the front regardless of incoming order', () => {
    const input = [
      mk('a-1', 'open'),
      mk('a-2', 'standing'),
      mk('a-3', 'in_progress'),
      mk('a-4', 'standing'),
      mk('a-5', 'closed'),
    ];
    const out = partitionStanding(input);
    // First two are the standing rows; the rest keep relative order.
    expect(out.slice(0, 2).every((i) => i.status === 'standing')).toBe(true);
    expect(out.slice(2).some((i) => i.status === 'standing')).toBe(false);
  });

  test('non-standing tail preserves the caller-supplied (already-sorted) order', () => {
    const input = [
      mk('a-1', 'open'),
      mk('a-2', 'in_progress'),
      mk('a-3', 'standing'),
      mk('a-4', 'deferred'),
    ];
    const out = partitionStanding(input);
    expect(out.map((i) => i.id)).toEqual(['a-3', 'a-1', 'a-2', 'a-4']);
  });

  test('within the standing block: priority ASC then recency DESC', () => {
    const input = [
      mk('s-low', 'standing', { priority: 4, updatedAt: '2026-06-10T00:00:00Z' }),
      mk('s-hi-old', 'standing', { priority: 0, updatedAt: '2026-06-01T00:00:00Z' }),
      mk('s-hi-new', 'standing', { priority: 0, updatedAt: '2026-06-09T00:00:00Z' }),
      mk('plain', 'open', { priority: 0 }),
    ];
    const out = partitionStanding(input);
    // P0 newest, then P0 older, then P4 — then the open row.
    expect(out.map((i) => i.id)).toEqual(['s-hi-new', 's-hi-old', 's-low', 'plain']);
  });

  test('standing floats above a PINNED non-standing row (independent of pinned)', () => {
    const input = [
      mk('pinned-open', 'open', { pinned: true, priority: 0 }),
      mk('plain-standing', 'standing', { priority: 3 }),
    ];
    const out = partitionStanding(input);
    // The standing row wins the top slot even though the open row is
    // pinned AND higher priority — the band is by status, not by pin.
    expect(out[0].id).toBe('plain-standing');
    expect(out[1].id).toBe('pinned-open');
  });

  test('a standing row that is ALSO pinned still bands by status, not pin', () => {
    const input = [
      mk('s1', 'standing', { pinned: true }),
      mk('o1', 'open', { pinned: true }),
    ];
    const out = partitionStanding(input);
    expect(out[0].status).toBe('standing');
  });

  test('no standing rows → input returned unchanged (identity, no reorder)', () => {
    const input = [mk('a', 'open'), mk('b', 'in_progress'), mk('c', 'closed')];
    const out = partitionStanding(input);
    expect(out).toBe(input);
  });

  test('does not mutate the input array', () => {
    const input = [mk('a-1', 'open'), mk('a-2', 'standing')];
    const snapshot = input.map((i) => i.id);
    partitionStanding(input);
    expect(input.map((i) => i.id)).toEqual(snapshot);
  });
});
