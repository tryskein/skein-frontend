import { describe, expect, test } from 'vitest';
import type { ActivityEntry } from '../api/activity';
import {
  EMPTY_VALUE,
  formatActivityDetail,
  formatFieldValue,
} from './formatActivityDetail';

// sk-73 — the Activity feed renders structured change detail from the
// event's audit data (oldValue / newValue / changes[]) instead of a flat
// summary. These tests pin the verb + transition + per-field diff output.

function entry(partial: Partial<ActivityEntry>): ActivityEntry {
  return {
    id: 1,
    occurredAt: '2026-05-31T10:40:00Z',
    type: 'issue.updated',
    actor: { userId: 'u-1', username: 'alice', type: 'human' },
    entity: {
      type: 'issue',
      id: 'sk-71.1',
      title: 'Example',
      projectId: 'p-1',
      projectIdPrefix: 'sk',
    },
    summary: 'alice updated sk-71.1',
    projectId: 'p-1',
    ...partial,
  };
}

describe('formatActivityDetail — verbs', () => {
  test('issue.created → "created this task"', () => {
    expect(formatActivityDetail(entry({ type: 'issue.created' })).verb).toBe(
      'created this task',
    );
  });

  test('comment.created → "commented"', () => {
    expect(formatActivityDetail(entry({ type: 'comment.created' })).verb).toBe(
      'commented',
    );
  });

  test('issue.claimed / accepted / closed / archived', () => {
    expect(formatActivityDetail(entry({ type: 'issue.claimed' })).verb).toBe(
      'claimed the task',
    );
    expect(formatActivityDetail(entry({ type: 'issue.accepted' })).verb).toBe(
      'accepted the task',
    );
    expect(formatActivityDetail(entry({ type: 'issue.closed' })).verb).toBe(
      'closed the issue',
    );
    expect(formatActivityDetail(entry({ type: 'issue.archived' })).verb).toBe(
      'archived the issue',
    );
  });

  test('unknown type falls back to a humanised verb', () => {
    expect(formatActivityDetail(entry({ type: 'issue.pinned' })).verb).toBe(
      'pinned',
    );
  });
});

describe('formatActivityDetail — issue.unclaimed stale flag', () => {
  test('system actor → "(stale)" tail', () => {
    const d = formatActivityDetail(
      entry({
        type: 'issue.unclaimed',
        actor: { userId: null, username: 'system', type: 'system' },
      }),
    );
    expect(d.verb).toBe('released the lock');
    expect(d.tail).toBe('(stale)');
  });

  test('human actor → no tail', () => {
    const d = formatActivityDetail(entry({ type: 'issue.unclaimed' }));
    expect(d.tail).toBeUndefined();
  });
});

describe('formatActivityDetail — status transition', () => {
  test('shows old → new status explicitly', () => {
    const d = formatActivityDetail(
      entry({
        type: 'issue.status_changed',
        field: 'status',
        oldValue: 'open',
        newValue: 'in_progress',
      }),
    );
    expect(d.verb).toBe('changed status');
    expect(d.transition).toEqual({ from: 'open', to: 'in_progress' });
    expect(d.changes).toHaveLength(0);
  });

  test('missing values fall back to ∅', () => {
    const d = formatActivityDetail(entry({ type: 'issue.status_changed' }));
    expect(d.transition).toEqual({ from: EMPTY_VALUE, to: EMPTY_VALUE });
  });
});

describe('formatActivityDetail — reparent transition', () => {
  test('renders old parent → new parent', () => {
    const d = formatActivityDetail(
      entry({
        type: 'issue.reparented',
        oldValue: { parentIds: ['sk-1'] },
        newValue: { parentId: 'sk-2' },
      }),
    );
    expect(d.verb).toBe('changed parent');
    expect(d.transition).toEqual({ from: 'sk-1', to: 'sk-2' });
  });

  test('no previous parent / moved to top-level', () => {
    const d = formatActivityDetail(
      entry({
        type: 'issue.reparented',
        oldValue: { parentIds: [] },
        newValue: { parentId: '' },
      }),
    );
    expect(d.transition).toEqual({ from: 'top-level', to: 'top-level' });
  });
});

describe('formatActivityDetail — dependency edges', () => {
  test('created → edge descriptor tail', () => {
    const d = formatActivityDetail(
      entry({
        type: 'dependency.created',
        newValue: { fromId: 'sk-3', toId: 'sk-4', type: 'blocks' },
      }),
    );
    expect(d.verb).toBe('added a dependency');
    expect(d.tail).toBe('blocks: sk-3 → sk-4');
  });

  test('deleted reads from oldValue', () => {
    const d = formatActivityDetail(
      entry({
        type: 'dependency.deleted',
        oldValue: { fromId: 'sk-3', toId: 'sk-4', type: 'related' },
      }),
    );
    expect(d.verb).toBe('removed a dependency');
    expect(d.tail).toBe('related: sk-3 → sk-4');
  });

  test('unrecognised edge shape → no tail', () => {
    const d = formatActivityDetail(
      entry({ type: 'dependency.created', newValue: {} }),
    );
    expect(d.tail).toBeUndefined();
  });
});

describe('formatActivityDetail — issue.updated field diffs', () => {
  test('simple fields render inline old → new with priority formatting', () => {
    const d = formatActivityDetail(
      entry({
        changes: [
          { field: 'priority', oldValue: 3, newValue: 2 },
          { field: 'assignee', oldValue: null, newValue: 'alice' },
        ],
      }),
    );
    expect(d.verb).toBe('updated');
    expect(d.detailless).toBe(false);
    expect(d.changes).toEqual([
      { field: 'priority', label: 'priority', large: false, oldText: 'P3', newText: 'P2' },
      {
        field: 'assignee',
        label: 'assignee',
        large: false,
        oldText: EMPTY_VALUE,
        newText: 'alice',
      },
    ]);
  });

  test('large markdown fields are flagged for compact + expandable rendering', () => {
    const d = formatActivityDetail(
      entry({
        changes: [
          { field: 'description', oldValue: 'old body', newValue: 'new body' },
          { field: 'acceptanceCriteria', oldValue: 'a', newValue: 'b' },
        ],
      }),
    );
    expect(d.changes[0]).toMatchObject({ field: 'description', large: true });
    expect(d.changes[1]).toMatchObject({
      field: 'acceptanceCriteria',
      label: 'acceptance criteria',
      large: true,
    });
  });

  test('issue.updated with EXPLICIT empty changes is detailless (suppressible noise)', () => {
    expect(formatActivityDetail(entry({ changes: [] })).detailless).toBe(true);
  });

  test('issue.updated with ABSENT changes is kept (legacy/undecoded row, not noise)', () => {
    const d = formatActivityDetail(entry({ changes: undefined }));
    expect(d.detailless).toBe(false);
    expect(d.verb).toBe('updated the issue');
    expect(d.changes).toHaveLength(0);
  });
});

describe('formatFieldValue', () => {
  test('priority → Pn', () => {
    expect(formatFieldValue('priority', 0)).toBe('P0');
    expect(formatFieldValue('priority', 4)).toBe('P4');
  });

  test('null/empty → ∅', () => {
    expect(formatFieldValue('assignee', null)).toBe(EMPTY_VALUE);
    expect(formatFieldValue('title', '')).toBe(EMPTY_VALUE);
  });

  test('estimatedMinutes → Nm', () => {
    expect(formatFieldValue('estimatedMinutes', 90)).toBe('90m');
  });

  test('dueAt → YYYY-MM-DD, non-date passes through', () => {
    expect(formatFieldValue('dueAt', '2026-05-31T10:00:00Z')).toMatch(
      /^\d{4}-\d{2}-\d{2}$/,
    );
    expect(formatFieldValue('dueAt', 'not-a-date')).toBe('not-a-date');
  });

  test('plain string field passes through', () => {
    expect(formatFieldValue('title', 'Hello')).toBe('Hello');
  });
});

// ───────── sk-489 T018 — outcome change in the issue history (US-3, SC-008, row 64) ─────────
//
// The spec requires the history to show a "was → became" row "by the norm of its
// surface", and the norm here is the form of the NEIGHBOUR, the status change: a transition
// with two sides, no field label, in English in both locales.
// So what is checked is not "the row is non-empty" but exactly this form: both the upper
// bound (not the generic `default` tail, which loses the sides) and the lower one (not a
// `changes[]` entry, which would draw a field edit instead of a change of the
// issue state).

describe('formatActivityDetail — issue.outcome_changed (sk-489 T018)', () => {
  const outcome = (oldValue: unknown, newValue: unknown) =>
    formatActivityDetail(
      entry({ type: 'issue.outcome_changed', field: 'closeOutcome', oldValue, newValue }),
    );

  test('a "was → became" transition in the neighbour form, without a field label', () => {
    const d = outcome('done', 'wont_do');
    expect(d.verb).toBe('changed outcome');
    expect(d.transition).toEqual({ from: 'done', to: 'wont_do' });
    // Not a field edit: `closeOutcome: done → wont_do` would describe a column,
    // while the event describes the issue state.
    expect(d.changes).toEqual([]);
    // ...and not suppressed noise: the row must stay in the feed.
    expect(d.detailless).toBe(false);
  });

  test('the generic tail is NOT acceptable: it loses both sides', () => {
    // A discriminating assertion. Without the `default` branch it yields
    // "outcome changed" and no transition — a row from which one can read
    // neither what it was nor what it became.
    const d = outcome('wont_do', 'duplicate');
    expect(d.verb).not.toBe('outcome changed');
    expect(d.transition).toBeTruthy();
  });

  test('an unfamiliar value is printed as is (INV-2)', () => {
    expect(outcome('done', 'flattened_into_epic').transition).toEqual({
      from: 'done',
      to: 'flattened_into_epic',
    });
  });

  test('a missing side → ∅, as in a status change', () => {
    // The same substitution as the neighbour's: there is one rule, and renaming
    // the helper did not split it in two.
    expect(outcome(null, 'wont_do').transition).toEqual({
      from: EMPTY_VALUE,
      to: 'wont_do',
    });
  });
});
