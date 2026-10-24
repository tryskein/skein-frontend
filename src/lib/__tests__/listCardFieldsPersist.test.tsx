/**
 * The LIST's attribute set is a PERSONAL preference that saves itself,
 * and it is neither the board's card properties nor the tree's table
 * columns.
 *
 * Pinned at the real provider boundary rather than at the helper,
 * because all of it is about what survives a reload — the same shape,
 * and for the same reasons, as `treeColumnsPersist.test.tsx`:
 *
 *   1. no stored key → the defaults, i.e. the card as it reads today;
 *   2. picking writes through immediately — there is no save step;
 *   3. an EMPTY selection is a choice (a list of bare titles) and comes
 *      back empty. A "falsy → use the defaults" read would undo it
 *      silently on the next reload;
 *   4. a value this build CANNOT read is not a choice: it falls back to
 *      the defaults, is left in place rather than overwritten, and —
 *      the pair that makes such a bug permanent — merely mounting the
 *      provider writes nothing at all;
 *   5. ISOLATION, in every direction. There are now THREE preferences of
 *      the same shape over three surfaces, which is exactly why two of
 *      them could be wired to one key by accident. Editing any one must
 *      leave the other two where they were — not in memory, not in
 *      storage, not across a reload.
 */

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';

import { TasksUiStateProvider, useTasksUiState } from '../useTasksUiState';
import {
  LIST_DEFAULT_CARD_FIELDS,
  type ListCardField,
} from '../listCardFields';
import { TREE_DEFAULT_COLUMNS, type TreeOptionalColumn } from '../treeColumns';
import {
  KANBAN_DEFAULT_CARD_FIELDS,
  type KanbanCardField,
} from '../kanbanCardFields';

const KEY = 'skein.tasks.listCardFields';
const TREE_KEY = 'skein.tasks.treeColumns';
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

describe('list card fields — persistence', () => {
  test('a user who has never touched the picker gets the card as it reads today', () => {
    mount();
    expect([...ui!.listCardFields].sort()).toEqual(
      [...LIST_DEFAULT_CARD_FIELDS].sort(),
    );
  });

  test('picking writes through immediately — there is no save step', () => {
    mount();
    act(() => {
      ui!.setListCardFields(new Set<ListCardField>(['id', 'labels']));
    });
    expect(window.localStorage.getItem(KEY)).toBe('id,labels');
  });

  test('and a remount (reload) reads the choice back', () => {
    mount();
    act(() => {
      ui!.setListCardFields(new Set<ListCardField>(['updated', 'created']));
    });
    cleanup();
    mount();
    expect([...ui!.listCardFields].sort()).toEqual(['created', 'updated']);
  });

  test('turning EVERY attribute off survives the reload — it is a choice, not an absence', () => {
    mount();
    act(() => {
      ui!.setListCardFields(new Set<ListCardField>());
    });
    expect(window.localStorage.getItem(KEY)).toBe('');
    cleanup();
    mount();
    expect(ui!.listCardFields.size).toBe(0);
  });

  test('a garbage value degrades to what it can read rather than throwing', () => {
    window.localStorage.setItem(KEY, 'id,not-a-field,title');
    mount();
    expect([...ui!.listCardFields]).toEqual(['id']);
  });

  test('a value with nothing readable in it gives the DEFAULTS, not an empty card', () => {
    // «I turned my attributes off» and «my storage got corrupted» look
    // identical on screen; only one of them is a preference.
    window.localStorage.setItem(KEY, '{"fields":["id"]}');
    mount();
    expect([...ui!.listCardFields].sort()).toEqual(
      [...LIST_DEFAULT_CARD_FIELDS].sort(),
    );
  });

  test('and it is not overwritten on sight — the damage stays visible, the accident is not promoted', () => {
    window.localStorage.setItem(KEY, '{"fields":["id"]}');
    mount();
    expect(window.localStorage.getItem(KEY)).toBe('{"fields":["id"]}');
    cleanup();
    mount();
    expect([...ui!.listCardFields].sort()).toEqual(
      [...LIST_DEFAULT_CARD_FIELDS].sort(),
    );
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
    window.localStorage.setItem(KEY, 'id,status');
    mount();
    act(() => {
      ui!.setListCardFields(new Set<ListCardField>(['id']));
    });
    expect(window.localStorage.getItem(KEY)).toBe('id');
    act(() => {
      ui!.setListCardFields(new Set<ListCardField>(['id', 'status']));
    });
    expect(window.localStorage.getItem(KEY)).toBe('id,status');
  });
});

describe('the three surfaces do not leak into each other', () => {
  test('they are stored under three different keys', () => {
    mount();
    act(() => {
      ui!.setListCardFields(new Set<ListCardField>(['id']));
      ui!.setTreeColumns(new Set<TreeOptionalColumn>(['status']));
      ui!.setKanbanCardFields(new Set<KanbanCardField>(['labels']));
    });
    expect(window.localStorage.getItem(KEY)).toBe('id');
    expect(window.localStorage.getItem(TREE_KEY)).toBe('status');
    expect(window.localStorage.getItem(CARD_KEY)).toBe('labels');
  });

  test('narrowing the list leaves the tree and the board alone', () => {
    mount();
    act(() => {
      ui!.setListCardFields(new Set<ListCardField>(['created']));
    });
    expect([...ui!.treeColumns].sort()).toEqual([...TREE_DEFAULT_COLUMNS].sort());
    expect([...ui!.kanbanCardFields].sort()).toEqual(
      [...KANBAN_DEFAULT_CARD_FIELDS].sort(),
    );
    expect(window.localStorage.getItem(TREE_KEY)).toBeNull();
  });

  test('narrowing the tree leaves the list alone', () => {
    mount();
    act(() => {
      ui!.setTreeColumns(new Set<TreeOptionalColumn>(['id']));
    });
    expect([...ui!.listCardFields].sort()).toEqual(
      [...LIST_DEFAULT_CARD_FIELDS].sort(),
    );
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  test('narrowing the board leaves the list alone', () => {
    mount();
    act(() => {
      ui!.setKanbanCardFields(new Set<KanbanCardField>(['id']));
    });
    expect([...ui!.listCardFields].sort()).toEqual(
      [...LIST_DEFAULT_CARD_FIELDS].sort(),
    );
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  test('a stored tree set is not read as a list set, even across a reload', () => {
    // The tree columns carry `progress` and NOT `delegated`; the list has
    // both. If the two ever shared a key, this is what would arrive.
    window.localStorage.setItem(TREE_KEY, 'progress,created');
    mount();
    expect([...ui!.listCardFields].sort()).toEqual(
      [...LIST_DEFAULT_CARD_FIELDS].sort(),
    );
    expect([...ui!.treeColumns].sort()).toEqual(['created', 'progress']);
  });

  test('and a stored board set is not read as a list set', () => {
    window.localStorage.setItem(CARD_KEY, 'delegated,labels');
    mount();
    expect([...ui!.listCardFields].sort()).toEqual(
      [...LIST_DEFAULT_CARD_FIELDS].sort(),
    );
    expect([...ui!.kanbanCardFields].sort()).toEqual(['delegated', 'labels']);
  });

  test('and a stored list set is read by neither of the other two', () => {
    window.localStorage.setItem(KEY, 'labels,created');
    mount();
    expect([...ui!.treeColumns].sort()).toEqual([...TREE_DEFAULT_COLUMNS].sort());
    expect([...ui!.kanbanCardFields].sort()).toEqual(
      [...KANBAN_DEFAULT_CARD_FIELDS].sort(),
    );
    expect([...ui!.listCardFields].sort()).toEqual(['created', 'labels']);
  });
});
