/**
 * sk-285.2.5 — the card-field set is a PERSONAL preference that saves
 * itself.
 *
 * Two contracts, pinned at the real provider boundary rather than at the
 * helper, because both of them are about what survives a reload:
 *
 *   1. no stored key → the defaults, i.e. the board as it shipped;
 *   2. an EMPTY selection is a choice and comes back empty. This is the
 *      one that a "falsy → fall back to defaults" read would break
 *      silently: the user turns everything off, reloads, and the board
 *      quietly undoes their setting.
 *
 * There is no "save" button in the flow on purpose (Linear's model) — the write-through
 * effect below IS the save, so the test asserts storage right after the
 * setter call.
 */

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';

import { TasksUiStateProvider, useTasksUiState } from '../useTasksUiState';
import {
  KANBAN_DEFAULT_CARD_FIELDS,
  type KanbanCardField,
} from '../kanbanCardFields';

const KEY = 'skein.tasks.kanbanCardFields';

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

describe('kanban card fields — persistence', () => {
  test('a user who has never touched the picker gets the shipped board', () => {
    mount();
    expect([...ui!.kanbanCardFields].sort()).toEqual(
      [...KANBAN_DEFAULT_CARD_FIELDS].sort(),
    );
  });

  test('picking writes through immediately — there is no save step', () => {
    mount();
    act(() => {
      ui!.setKanbanCardFields(new Set<KanbanCardField>(['id', 'labels']));
    });
    expect(window.localStorage.getItem(KEY)).toBe('id,labels');
  });

  test('and a remount (reload) reads the choice back', () => {
    mount();
    act(() => {
      ui!.setKanbanCardFields(new Set<KanbanCardField>(['updated', 'created']));
    });
    cleanup();
    mount();
    expect([...ui!.kanbanCardFields].sort()).toEqual(['created', 'updated']);
  });

  test('turning EVERYTHING off survives the reload — it is a choice, not an absence', () => {
    mount();
    act(() => {
      ui!.setKanbanCardFields(new Set<KanbanCardField>());
    });
    expect(window.localStorage.getItem(KEY)).toBe('');
    cleanup();
    mount();
    expect(ui!.kanbanCardFields.size).toBe(0);
  });

  test('a garbage value degrades to what it can read rather than throwing', () => {
    window.localStorage.setItem(KEY, 'id,not-a-field');
    mount();
    expect([...ui!.kanbanCardFields]).toEqual(['id']);
  });
});
