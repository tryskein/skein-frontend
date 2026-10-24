/**
 * sk-421.2 T022 — row identification and the fallback focus target
 * (US-2 "focus", SC-013, F-22).
 *
 * The logic is pure, so it is proven without rendering: one rule for both
 * modes, and checking it through two components would mean checking
 * the same thing twice and still not seeing the rule itself.
 */

import { describe, expect, test } from 'vitest';
import {
  epicRowKey,
  epicRowKeys,
  resolveEpicFocusTarget,
} from '../epicRowFocus';
import type { FlatTreeRow } from '../flattenTree';
import type { IssueTreeRowItem } from '../../api/issues';

const EPIC = 'sk-42';

function row(
  id: string,
  depth: number,
  over: Partial<FlatTreeRow> = {},
): FlatTreeRow {
  return {
    item: {
      id,
      projectId: 'p',
      version: 1,
      title: id,
      type: 'task',
      priority: 2,
      status: 'open',
      pinned: false,
      assignee: null,
      componentIds: [],
      labels: [],
      isBlocked: false,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    } as IssueTreeRowItem,
    depth,
    edgeType: 'parent-child',
    isReference: false,
    firstSeenAt: null,
    isContext: false,
    hasChildren: false,
    ...over,
  };
}

/** Stub of an inaccessible task: a reference with empty values. */
function stub(id: string, depth: number): FlatTreeRow {
  return row(id, depth, {
    isReference: true,
    item: { ...row(id, depth).item, status: '', type: '' } as IssueTreeRowItem,
  });
}

describe('epicRowKey — what identifies a row', () => {
  test('an ordinary row is identified by the task id', () => {
    const rows = [row('sk-42.1', 1), row('sk-42.2', 1)];
    expect(epicRowKey(rows, 0, EPIC)).toBe('id:sk-42.1');
    expect(epicRowKey(rows, 1, EPIC)).toBe('id:sk-42.2');
  });

  test('a stub is NOT identified by its own id: it is unstable between refetches', () => {
    // The same set, but the server gave the stub another synthetic id.
    const before = [row('sk-42.1', 1), stub('hidden-1', 1)];
    const after = [row('sk-42.1', 1), stub('hidden-77', 1)];
    expect(epicRowKey(before, 1, EPIC)).toBe(epicRowKey(after, 1, EPIC));
    // …and it is definitely not the identifier.
    expect(epicRowKey(before, 1, EPIC)).not.toContain('hidden-1');
  });

  test('for the first level the parent is the epic itself', () => {
    const rows = [stub('hidden-1', 1)];
    expect(epicRowKey(rows, 0, EPIC)).toBe(`stub:${EPIC}:0`);
  });

  test('stubs are told apart by position in their parent subtree', () => {
    const rows = [stub('h-1', 1), stub('h-2', 1)];
    expect(epicRowKey(rows, 0, EPIC)).toBe(`stub:${EPIC}:0`);
    expect(epicRowKey(rows, 1, EPIC)).toBe(`stub:${EPIC}:1`);
  });

  test('stubs under DIFFERENT parents are numbered independently', () => {
    const rows = [
      row('sk-42.1', 1),
      stub('h-a', 2),
      row('sk-42.2', 1),
      stub('h-b', 2),
    ];
    expect(epicRowKey(rows, 1, EPIC)).toBe('stub:sk-42.1:0');
    expect(epicRowKey(rows, 3, EPIC)).toBe('stub:sk-42.2:0');
  });
});

describe('resolveEpicFocusTarget — fallback target', () => {
  const base = [row('sk-42.1', 1), row('sk-42.2', 1), row('sk-42.3', 1)];

  test('the row survived — focus on it, even if the position changed', () => {
    const next = [row('sk-42.0', 1), ...base];
    const t = resolveEpicFocusTarget({
      prevRows: base,
      prevIndex: 1,
      nextRows: next,
      epicId: EPIC,
      hasSwitcher: true,
    });
    expect(t).toEqual({ kind: 'row', index: 2 });
  });

  test('the row is gone — focus on the nearest surviving one ABOVE it', () => {
    // sk-42.2 left; sk-42.1 stood above it.
    const next = [row('sk-42.1', 1), row('sk-42.3', 1)];
    const t = resolveEpicFocusTarget({
      prevRows: base,
      prevIndex: 1,
      nextRows: next,
      epicId: EPIC,
      hasSwitcher: true,
    });
    expect(t).toEqual({ kind: 'row', index: 0 });
  });

  test('up, not down: another task could have shifted into the vanished one\'s place', () => {
    // If the rule took "the same position", focus would silently land on
    // sk-42.3 — a different task. The neighbour above stays the same.
    const next = [row('sk-42.1', 1), row('sk-42.3', 1)];
    const t = resolveEpicFocusTarget({
      prevRows: base,
      prevIndex: 1,
      nextRows: next,
      epicId: EPIC,
      hasSwitcher: true,
    });
    expect(next[(t as { index: number }).index].item.id).toBe('sk-42.1');
  });

  test('nothing above survived — the first shown row', () => {
    const next = [row('sk-99', 1)];
    const t = resolveEpicFocusTarget({
      prevRows: base,
      prevIndex: 2,
      nextRows: next,
      epicId: EPIC,
      hasSwitcher: true,
    });
    expect(t).toEqual({ kind: 'row', index: 0 });
  });

  test('no rows left — the switcher', () => {
    const t = resolveEpicFocusTarget({
      prevRows: base,
      prevIndex: 0,
      nextRows: [],
      epicId: EPIC,
      hasSwitcher: true,
    });
    expect(t).toEqual({ kind: 'switcher' });
  });

  test('no rows and no switcher — the "Add child" button', () => {
    // Empty set: per SC-014 there is no switcher on screen.
    const t = resolveEpicFocusTarget({
      prevRows: base,
      prevIndex: 0,
      nextRows: [],
      epicId: EPIC,
      hasSwitcher: false,
    });
    expect(t).toEqual({ kind: 'addChild' });
  });

  test('a stub survives a refetch with a new synthetic id', () => {
    const before = [row('sk-42.1', 1), stub('hidden-1', 1)];
    const after = [row('sk-42.1', 1), stub('hidden-77', 1)];
    const t = resolveEpicFocusTarget({
      prevRows: before,
      prevIndex: 1,
      nextRows: after,
      epicId: EPIC,
      hasSwitcher: true,
    });
    // Focus stayed on the stub, not shifted to a neighbour.
    expect(t).toEqual({ kind: 'row', index: 1 });
  });

  test('no match — the fallback target, not a random row', () => {
    // The stub was under sk-42.1 but came back under another parent: per F-22
    // it is no longer the same row, and the rule returns the nearest above.
    const before = [row('sk-42.1', 1), stub('h', 2)];
    const after = [row('sk-42.1', 1), row('sk-42.2', 1), stub('h', 2)];
    const t = resolveEpicFocusTarget({
      prevRows: before,
      prevIndex: 1,
      nextRows: after,
      epicId: EPIC,
      hasSwitcher: true,
    });
    expect(t).toEqual({ kind: 'row', index: 0 });
  });
});

// ───────── sk-421.3 T01 — keys in one pass (m-9, INV-11, P-105) ─────────
//
// The bulk form must number stubs exactly as the key definition says:
// a stub's anchor is the nearest row above it with a smaller depth that
// is not itself a stub (the epic when there is none), and its position
// is the count of earlier stubs at the same depth under the same anchor.
// The expected keys below are worked out by hand from that definition.

/** Stubs under different anchors and depths, mixed with ordinary rows. */
const MIXED: FlatTreeRow[] = [
  row('A', 1), //  0
  stub('h1', 2), // 1 — under A
  stub('h2', 2), // 2 — second under A at depth 2
  row('B', 1), //  3
  stub('h3', 2), // 4 — under B, numbering restarts
  stub('h4', 1), // 5 — no shallower row above: under the epic
  row('C', 2), //  6
  stub('h5', 3), // 7 — under C
  stub('h6', 1), // 8 — second under the epic at depth 1
  stub('h7', 2), // 9 — under B again (C is not shallower than depth 2)
];

const MIXED_KEYS = [
  'id:A',
  'stub:A:0',
  'stub:A:1',
  'id:B',
  'stub:B:0',
  `stub:${EPIC}:0`,
  'id:C',
  'stub:C:0',
  `stub:${EPIC}:1`,
  'stub:B:1',
];

describe('epicRowKeys — stub numbering follows the key definition', () => {
  test('stubs under different anchors and depths', () => {
    expect(epicRowKeys(MIXED, EPIC)).toEqual(MIXED_KEYS);
  });

  // One anchor, stubs at several depths. The position counts earlier
  // stubs at the SAME depth under the same anchor, so a depth-3 stub
  // between two depth-2 stubs starts its own count and does not shift
  // the second depth-2 stub. Worked out by hand from the definition above.
  test.each([
    {
      name: 'under a visible row',
      rows: [row('A', 1), stub('h1', 2), stub('h2', 3), stub('h3', 2)],
      keys: ['id:A', 'stub:A:0', 'stub:A:0', 'stub:A:1'],
    },
    {
      name: 'under the epic',
      rows: [stub('h1', 1), stub('h2', 2), stub('h3', 1), stub('h4', 2)],
      keys: [
        `stub:${EPIC}:0`,
        `stub:${EPIC}:0`,
        `stub:${EPIC}:1`,
        `stub:${EPIC}:1`,
      ],
    },
  ])('one anchor, several depths: numbering is per depth ($name)', ({ rows, keys }) => {
    expect(epicRowKeys(rows, EPIC)).toEqual(keys);
    rows.forEach((_, i) => {
      expect(epicRowKey(rows, i, EPIC), `row ${i}`).toBe(keys[i]);
    });
  });

  test('a stub does not pop an ancestor off the stack that will still be needed', () => {
    // «Pop the stack by the stub's depth» would make C's successor D
    // lose its anchor; the stub still belongs to A.
    const rows = [
      row('A', 1),
      row('C', 5),
      stub('h', 5),
      row('D', 6),
    ];
    expect(epicRowKeys(rows, EPIC)).toEqual(['id:A', 'id:C', 'stub:A:0', 'id:D']);
  });

  test('the per-row form answers the same as the bulk one, including out-of-range indices', () => {
    MIXED.forEach((_, i) => {
      expect(epicRowKey(MIXED, i, EPIC)).toBe(MIXED_KEYS[i]);
    });
    expect(epicRowKey(MIXED, MIXED.length, EPIC)).toBe('');
    expect(epicRowKey(MIXED, -1, EPIC)).toBe('');
  });

  test('3000 stubs at one depth: sequential keys and the last row as the fallback target', () => {
    const rows = Array.from({ length: 3000 }, (_, i) => stub(`h-${i}`, 1));
    const keys = epicRowKeys(rows, EPIC);
    const target = resolveEpicFocusTarget({
      prevRows: rows,
      prevIndex: rows.length - 1,
      nextRows: rows,
      epicId: EPIC,
      hasSwitcher: true,
    });
    expect(keys).toHaveLength(3000);
    expect(keys[0]).toBe(`stub:${EPIC}:0`);
    expect(keys[2999]).toBe(`stub:${EPIC}:2999`);
    expect(target).toEqual({ kind: 'row', index: 2999 });
  });
});
