/**
 * sk-285.2.19 — the tree-table column set is a PERSONAL preference that
 * saves itself, and it is NOT the board's card-property set.
 *
 * Pinned at the real provider boundary rather than at the helper,
 * because all of it is about what survives a reload:
 *
 *   1. no stored key → the defaults, i.e. the tree row as it reads today;
 *   2. picking writes through immediately — there is no save step;
 *   3. an EMPTY selection is a choice (a bare tree of titles) and comes
 *      back empty. A "falsy → use the defaults" read would undo it
 *      silently on the next reload;
 *   4. a value this build CANNOT read is not a choice: it falls back to
 *      the defaults, is left in place rather than overwritten, and — the
 *      pair that made the old bug permanent — merely mounting the
 *      provider writes nothing at all;
 *   5. ISOLATION: the tree's columns and the board's card properties are
 *      two preferences for two surfaces. Editing one must not move the
 *      other — not in memory, not in storage, not across a reload. They
 *      share a shape, and that is exactly why they could be wired to one
 *      key by accident.
 */

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';

import { TasksUiStateProvider, useTasksUiState } from '../useTasksUiState';
import { TREE_DEFAULT_COLUMNS, type TreeOptionalColumn } from '../treeColumns';
import {
  KANBAN_DEFAULT_CARD_FIELDS,
  type KanbanCardField,
} from '../kanbanCardFields';

const KEY = 'skein.tasks.treeColumns';
const CARD_KEY = 'skein.tasks.kanbanCardFields';

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

beforeEach(() => {
  window.localStorage.clear();
  ui = null;
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('tree columns — persistence', () => {
  test('a user who has never touched the picker gets the tree as it reads today', () => {
    mount();
    expect([...ui!.treeColumns].sort()).toEqual([...TREE_DEFAULT_COLUMNS].sort());
  });

  test('picking writes through immediately — there is no save step', () => {
    mount();
    act(() => {
      ui!.setTreeColumns(new Set<TreeOptionalColumn>(['id', 'labels']));
    });
    expect(window.localStorage.getItem(KEY)).toBe('id,labels');
  });

  test('and a remount (reload) reads the choice back', () => {
    mount();
    act(() => {
      ui!.setTreeColumns(new Set<TreeOptionalColumn>(['updated', 'created']));
    });
    cleanup();
    mount();
    expect([...ui!.treeColumns].sort()).toEqual(['created', 'updated']);
  });

  test('turning EVERY column off survives the reload — it is a choice, not an absence', () => {
    mount();
    act(() => {
      ui!.setTreeColumns(new Set<TreeOptionalColumn>());
    });
    expect(window.localStorage.getItem(KEY)).toBe('');
    cleanup();
    mount();
    expect(ui!.treeColumns.size).toBe(0);
  });

  test('a garbage value degrades to what it can read rather than throwing', () => {
    window.localStorage.setItem(KEY, 'id,not-a-column,title');
    mount();
    expect([...ui!.treeColumns]).toEqual(['id']);
  });

  test('a value with nothing readable in it gives the DEFAULTS, not an empty table', () => {
    // The failure this pins: an unreadable value used to parse as the
    // empty set, so the table drew nothing but titles — a set the user
    // never picked, on a screen where "I turned my columns off" and "my
    // storage got corrupted" look identical.
    window.localStorage.setItem(KEY, '{"cols":["id"]}');
    mount();
    expect([...ui!.treeColumns].sort()).toEqual([...TREE_DEFAULT_COLUMNS].sort());
  });

  test('and it is not overwritten on sight — the damage stays visible, the accident is not promoted', () => {
    // The second half of the same bug: the write-through effect used to
    // fire on mount and store `''` over the damaged value, turning an
    // accident into a deliberate-looking, permanent «titles only»
    // preference that no reload could undo.
    window.localStorage.setItem(KEY, '{"cols":["id"]}');
    mount();
    expect(window.localStorage.getItem(KEY)).toBe('{"cols":["id"]}');
    // And a second reload reads the defaults again, not an empty set.
    cleanup();
    mount();
    expect([...ui!.treeColumns].sort()).toEqual([...TREE_DEFAULT_COLUMNS].sort());
  });

  test('merely opening the app stores nothing — a missing key stays missing', () => {
    // "The key being absent is what selects the defaults" is what
    // protects a user who never opened the picker from being frozen at
    // the defaults of whichever build they happened to open first. A
    // write-through that fires on mount makes that false one render in.
    mount();
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  test('but the first real change still writes, and so does a change back', () => {
    // The mount guard must not cost the write-through: switching a column
    // off and back on has to reach storage both times.
    window.localStorage.setItem(KEY, 'id,status');
    mount();
    act(() => {
      ui!.setTreeColumns(new Set<TreeOptionalColumn>(['id']));
    });
    expect(window.localStorage.getItem(KEY)).toBe('id');
    act(() => {
      ui!.setTreeColumns(new Set<TreeOptionalColumn>(['id', 'status']));
    });
    expect(window.localStorage.getItem(KEY)).toBe('id,status');
  });
});

describe('tree columns and board card properties do not leak into each other', () => {
  test('they are stored under two different keys', () => {
    mount();
    act(() => {
      ui!.setTreeColumns(new Set<TreeOptionalColumn>(['id']));
      ui!.setKanbanCardFields(new Set<KanbanCardField>(['labels']));
    });
    expect(window.localStorage.getItem(KEY)).toBe('id');
    expect(window.localStorage.getItem(CARD_KEY)).toBe('labels');
  });

  test('narrowing the tree leaves the board alone', () => {
    mount();
    act(() => {
      ui!.setTreeColumns(new Set<TreeOptionalColumn>(['created']));
    });
    expect([...ui!.kanbanCardFields].sort()).toEqual(
      [...KANBAN_DEFAULT_CARD_FIELDS].sort(),
    );
    expect(window.localStorage.getItem(CARD_KEY)).toBe(
      [...KANBAN_DEFAULT_CARD_FIELDS].join(','),
    );
  });

  test('narrowing the board leaves the tree alone', () => {
    mount();
    act(() => {
      ui!.setKanbanCardFields(new Set<KanbanCardField>(['id']));
    });
    expect([...ui!.treeColumns].sort()).toEqual([...TREE_DEFAULT_COLUMNS].sort());
  });

  test('a stored board set is not read as a tree set, even across a reload', () => {
    // The card fields carry `delegated`, which is not a tree column at
    // all — if the two ever shared a key this is what would arrive.
    window.localStorage.setItem(CARD_KEY, 'delegated,labels');
    mount();
    expect([...ui!.treeColumns].sort()).toEqual([...TREE_DEFAULT_COLUMNS].sort());
    expect([...ui!.kanbanCardFields].sort()).toEqual(['delegated', 'labels']);
  });

  test('and a stored tree set is not read as a board set', () => {
    window.localStorage.setItem(KEY, 'progress,created');
    mount();
    expect([...ui!.kanbanCardFields].sort()).toEqual(
      [...KANBAN_DEFAULT_CARD_FIELDS].sort(),
    );
    expect([...ui!.treeColumns].sort()).toEqual(['created', 'progress']);
  });
});
