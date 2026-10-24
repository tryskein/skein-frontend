/**
 * sk-285.2.20 — a hand-edited localStorage value cannot become a filter.
 *
 * Every enum-shaped preference in `useTasksUiState` is read through one
 * function, `readEnum`, and the whole of its protection is one clause:
 * the stored string has to be a member of that field's own whitelist.
 * Deleting the clause (`if (raw && allowed.includes(raw))` → `if (raw)`)
 * left the entire suite green, which means nothing anywhere asserted
 * that these values are validated at all — and localStorage is the one
 * input to this provider that a user, an extension or a stale build can
 * write anything into.
 *
 * What breaks without it is not cosmetic: the value is handed straight
 * to the list query as `status=…` / `type=…`, and it is written back on
 * the next render, so a junk value PERSISTS as the user's preference.
 * The lens presets, the sort combobox and the view switcher all read
 * the same state.
 *
 * Every readEnum-backed key is covered, not a representative one: the
 * whitelist is passed per call, so a field can lose its own while its
 * neighbours keep theirs.
 */

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { cleanup, render } from '@testing-library/react';

import { TasksUiStateProvider, useTasksUiState } from '../useTasksUiState';
import { KANBAN_DEFAULT_AXIS } from '../kanbanBoard';

let ui: ReturnType<typeof useTasksUiState> | null = null;

function Probe() {
  ui = useTasksUiState();
  return null;
}

function mount() {
  return render(
    <TasksUiStateProvider>
      <Probe />
    </TasksUiStateProvider>,
  );
}

/**
 * Each enum preference: its storage key, the field it lands in, and the
 * value a provider that never opened the picker starts from.
 */
const ENUMS = [
  {
    key: 'skein.tasks.statusFilter',
    field: 'statusFilter',
    fallback: 'active',
    // A real view mode, and a status for nobody.
    alien: 'tree',
  },
  {
    key: 'skein.tasks.originFilter',
    field: 'originFilter',
    fallback: 'all',
    // A real status.
    alien: 'blocked',
  },
  {
    key: 'skein.tasks.typeFilter',
    field: 'typeFilter',
    fallback: 'all',
    // A real view mode.
    alien: 'cards',
  },
  {
    key: 'skein.tasks.priorityFilter',
    field: 'priorityFilter',
    fallback: 'all',
    // A real status. The priority whitelist is 'all' plus '0'..'4'.
    alien: 'open',
  },
  {
    key: 'skein.tasks.view',
    field: 'view',
    fallback: 'cards',
    // A real kanban axis, and a view for nobody.
    alien: 'assignee',
  },
  {
    key: 'skein.tasks.kanbanAxis',
    field: 'kanbanAxis',
    fallback: KANBAN_DEFAULT_AXIS,
    // A real view mode.
    alien: 'cards',
  },
] as const;

beforeEach(() => {
  window.localStorage.clear();
  ui = null;
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('useTasksUiState — a stored enum is checked against its whitelist', () => {
  test.each(ENUMS)(
    '$field falls back to $fallback when the stored value is not one of its own',
    ({ key, field, fallback }) => {
      // Non-empty on purpose: an empty string is already rejected by the
      // truthiness half of the guard, so only a junk STRING can tell the
      // whitelist half apart from it.
      window.localStorage.setItem(key, 'definitely-not-a-value');
      mount();
      expect(ui![field]).toBe(fallback);
    },
  );

  test.each(ENUMS)(
    "$field does not accept another preference's vocabulary ($alien)",
    ({ key, field, fallback, alien }) => {
      // The whitelist is per field, not a shared pool of "words this app
      // uses": each `alien` above is a legal value of some OTHER
      // preference and of no interest to this one. A guard reduced to
      // "is it a non-empty string we recognise anywhere" would pass the
      // junk case above and fail here.
      window.localStorage.setItem(key, alien);
      mount();
      expect(ui![field]).toBe(fallback);
    },
  );

  test('a legal value still loads — the guard rejects, it does not ignore', () => {
    // Without this the whole describe would also pass on a `readEnum`
    // that returned the fallback unconditionally.
    window.localStorage.setItem('skein.tasks.statusFilter', 'blocked');
    window.localStorage.setItem('skein.tasks.view', 'tree');
    window.localStorage.setItem('skein.tasks.kanbanAxis', 'priority');
    mount();
    expect(ui!.statusFilter).toBe('blocked');
    expect(ui!.view).toBe('tree');
    expect(ui!.kanbanAxis).toBe('priority');
  });

  test('and a rejected value never reaches the query as a filter', () => {
    // The reason this matters at all: whatever `readEnum` returns is
    // what the Tasks query sends as `status=…`.
    window.localStorage.setItem('skein.tasks.statusFilter', 'DROP TABLE');
    mount();
    expect(ui!.statusFilter).not.toContain('DROP');
  });
});
