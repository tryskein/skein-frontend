/**
 * sk-285.2.8 — the three primitives behind "tree under a filter shows
 * matches plus their ancestors, and unfolds the way to them".
 *
 * What each test is guarding against:
 *
 *   describeTreeNarrowing  — the tree deciding it is filtered when the
 *     filter panel's own badge says it is not (or the reverse). The last
 *     test in that block pins the two rules together against the real
 *     `countActiveFilters`, so a future change to one of them fails here
 *     instead of shipping two answers to one question.
 *   collectMatchAncestorIds — auto-expanding the wrong rows: a match's
 *     own subtree (would show rows the filter rejected) or nothing at
 *     all (leaves the match hidden under a collapsed ancestor, which is
 *     the defect).
 *   mergeFilteredExpansion — the manual, persisted expansion set being
 *     mutated by a filter.
 */

import { describe, expect, test } from 'vitest';

import {
  collectMatchAncestorIds,
  describeTreeNarrowing,
  mergeFilteredExpansion,
  type TreeNarrowingInputs,
} from '../filteredTreeExpansion';
import type { FlatTreeRow } from '../flattenTree';
import type { IssueSummary } from '../../api/issues';
import { countActiveFilters } from '../../pages/shell/TaskFilters';
import type {
  OriginFilter,
  PriorityFilter,
  StatusFilter,
  TypeFilter,
} from '../../api/issues';

const NEUTRAL: TreeNarrowingInputs = {
  search: '',
  statusFilter: 'active',
  originFilter: 'all',
  typeFilter: 'all',
  priorityFilter: 'all',
  assigneeFilter: null,
  selectedComponent: null,
  outboxMode: false,
  onMeMode: false,
};

function issue(id: string): IssueSummary {
  return {
    id,
    projectId: 'p',
    version: 1,
    title: id,
    type: 'task',
    priority: 2,
    status: 'open',
    pinned: false,
    componentIds: [],
    labels: [],
    isBlocked: false,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
  };
}

function row(
  id: string,
  depth: number,
  over: Partial<FlatTreeRow> = {},
): FlatTreeRow {
  return {
    item: issue(id),
    depth,
    edgeType: depth === 0 ? null : 'parent-child',
    isReference: false,
    firstSeenAt: null,
    isContext: false,
    hasChildren: false,
    ...over,
  };
}

describe('describeTreeNarrowing', () => {
  test('the default board is not narrowed', () => {
    expect(describeTreeNarrowing(NEUTRAL)).toBe('');
  });

  test("status 'all' widens, so it is not a narrowing either", () => {
    expect(describeTreeNarrowing({ ...NEUTRAL, statusFilter: 'all' })).toBe('');
  });

  test('every narrowing dimension shows up in the signature', () => {
    expect(describeTreeNarrowing({ ...NEUTRAL, statusFilter: 'closed' })).toBe(
      'status=closed',
    );
    expect(describeTreeNarrowing({ ...NEUTRAL, search: '  bug ' })).toBe('q=bug');
    expect(describeTreeNarrowing({ ...NEUTRAL, typeFilter: 'epic' })).toBe(
      'type=epic',
    );
    expect(describeTreeNarrowing({ ...NEUTRAL, priorityFilter: '0' })).toBe(
      'priority=0',
    );
    expect(describeTreeNarrowing({ ...NEUTRAL, originFilter: 'human-driven' })).toBe(
      'origin=human-driven',
    );
    expect(describeTreeNarrowing({ ...NEUTRAL, assigneeFilter: 'ann' })).toBe(
      'assignee=ann',
    );
    expect(describeTreeNarrowing({ ...NEUTRAL, selectedComponent: 'api' })).toBe(
      'component=api',
    );
    expect(describeTreeNarrowing({ ...NEUTRAL, outboxMode: true })).toBe(
      'lens=outbox',
    );
    expect(describeTreeNarrowing({ ...NEUTRAL, onMeMode: true })).toBe('lens=onme');
  });

  test('the signature changes when the filter changes, and only then', () => {
    const a = describeTreeNarrowing({ ...NEUTRAL, statusFilter: 'closed' });
    const b = describeTreeNarrowing({ ...NEUTRAL, statusFilter: 'blocked' });
    const aAgain = describeTreeNarrowing({ ...NEUTRAL, statusFilter: 'closed' });
    expect(a).not.toBe(b);
    expect(a).toBe(aAgain);
  });

  test('agrees with the filter-panel badge on every chip dimension', () => {
    const statuses: StatusFilter[] = [
      'all',
      'active',
      'open',
      'in_progress',
      'closed',
      'blocked',
      'standing',
    ];
    for (const statusFilter of statuses) {
      const badge = countActiveFilters({
        statusFilter,
        priorityFilter: 'all',
        typeFilter: 'all',
        originFilter: 'all',
        assigneeFilter: null,
      });
      const signature = describeTreeNarrowing({ ...NEUTRAL, statusFilter });
      expect(signature !== '').toBe(badge > 0);
    }

    const others: TreeNarrowingInputs[] = [
      { ...NEUTRAL, typeFilter: 'bug' },
      { ...NEUTRAL, priorityFilter: '1' },
      { ...NEUTRAL, originFilter: 'agent-autonomous' },
      { ...NEUTRAL, assigneeFilter: 'bob' },
    ];
    for (const inputs of others) {
      const badge = countActiveFilters({
        statusFilter: inputs.statusFilter as StatusFilter,
        priorityFilter: inputs.priorityFilter as PriorityFilter,
        typeFilter: inputs.typeFilter as TypeFilter,
        originFilter: inputs.originFilter as OriginFilter,
        assigneeFilter: inputs.assigneeFilter,
      });
      expect(describeTreeNarrowing(inputs) !== '').toBe(badge > 0);
    }
  });
});

describe('collectMatchAncestorIds', () => {
  test('a match puts its whole ancestor chain in, and itself out', () => {
    // ctx-1 > ctx-1.1 > match-1.1.1
    const rows = [
      row('ctx-1', 0, { isContext: true, hasChildren: true }),
      row('ctx-1.1', 1, { isContext: true, hasChildren: true }),
      row('match-1.1.1', 2),
    ];
    const ids = collectMatchAncestorIds(rows);
    expect([...ids].sort()).toEqual(['ctx-1', 'ctx-1.1']);
  });

  test('a match with no matched descendant does not unfold its own subtree', () => {
    const rows = [row('a', 0, { hasChildren: true })];
    expect(collectMatchAncestorIds(rows).size).toBe(0);
  });

  test('branches without a match anywhere below stay closed', () => {
    // a > a.1 (match) and b > b.1 (context only, pruned to nothing real)
    const rows = [
      row('a', 0, { hasChildren: true }),
      row('a.1', 1),
      row('b', 0, { hasChildren: true }),
      row('b.1', 1, { isContext: true }),
    ];
    const ids = collectMatchAncestorIds(rows);
    expect(ids.has('a')).toBe(true);
    expect(ids.has('b')).toBe(false);
  });

  test('reference stubs are not matches — a cycle row unfolds nothing', () => {
    const rows = [
      row('a', 0, { hasChildren: true }),
      row('a.1', 1, { isReference: true, firstSeenAt: 'a' }),
    ];
    expect(collectMatchAncestorIds(rows).size).toBe(0);
  });

  test('the ancestor stack pops back correctly across sibling branches', () => {
    // root > mid-1 > leaf (match), then root > mid-2 (context leaf)
    const rows = [
      row('root', 0, { isContext: true, hasChildren: true }),
      row('mid-1', 1, { isContext: true, hasChildren: true }),
      row('leaf', 2),
      row('mid-2', 1, { isContext: true }),
    ];
    const ids = collectMatchAncestorIds(rows);
    expect([...ids].sort()).toEqual(['mid-1', 'root']);
  });

  test('an empty row list yields an empty set', () => {
    expect(collectMatchAncestorIds([]).size).toBe(0);
  });
});

describe('mergeFilteredExpansion', () => {
  const manual = new Set(['kept']);

  test('returns the manual set untouched when nothing is narrowing', () => {
    const merged = mergeFilteredExpansion(
      manual,
      new Set(['auto']),
      new Set(['flip']),
      false,
    );
    expect(merged).toBe(manual);
  });

  test('auto-expanded paths are added on top of the manual set', () => {
    const merged = mergeFilteredExpansion(manual, new Set(['auto']), new Set(), true);
    expect([...merged].sort()).toEqual(['auto', 'kept']);
    // The persisted set is never mutated — that is what makes clearing
    // the filter give the user their own tree back.
    expect([...manual]).toEqual(['kept']);
  });

  test('an override closes a row the filter opened', () => {
    const merged = mergeFilteredExpansion(
      manual,
      new Set(['auto']),
      new Set(['auto']),
      true,
    );
    expect([...merged]).toEqual(['kept']);
  });

  test('an override opens a row neither side had open', () => {
    const merged = mergeFilteredExpansion(manual, new Set(), new Set(['extra']), true);
    expect([...merged].sort()).toEqual(['extra', 'kept']);
  });

  test('an override closes a row the USER had open, without touching the source', () => {
    const merged = mergeFilteredExpansion(manual, new Set(), new Set(['kept']), true);
    expect(merged.size).toBe(0);
    expect([...manual]).toEqual(['kept']);
  });
});
