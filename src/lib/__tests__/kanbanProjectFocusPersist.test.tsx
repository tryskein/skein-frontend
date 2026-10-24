/**
 * sk-285.2.6 — the project focus is a PERSONAL preference that saves
 * itself.
 *
 * Same contract as the axis and the card fields (Linear's model): there is no "save"
 * step, the write-through effect IS the save, and a reload gives the
 * user back the board they left. The one difference from the card-field
 * set is asserted here too: an EMPTY focus carries no special meaning —
 * it is simply "all projects" — so no absence semantics are needed and
 * clearing really does reset.
 */

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';

import { TasksUiStateProvider, useTasksUiState } from '../useTasksUiState';

const KEY = 'skein.tasks.kanbanProjectFocus';

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

describe('kanban project focus — persistence', () => {
  test('a user who has never touched the picker sees every project', () => {
    mount();
    expect(ui!.kanbanProjectFocus.size).toBe(0);
  });

  test('picking writes through immediately — there is no save step', () => {
    mount();
    act(() => {
      ui!.setKanbanProjectFocus(new Set(['mob-uuid', 'pay-uuid']));
    });
    expect(window.localStorage.getItem(KEY)).toBe('mob-uuid,pay-uuid');
  });

  test('and a remount (reload) reads the focus back', () => {
    mount();
    act(() => {
      ui!.setKanbanProjectFocus(new Set(['mob-uuid', 'pay-uuid']));
    });
    cleanup();
    mount();
    expect([...ui!.kanbanProjectFocus].sort()).toEqual(['mob-uuid', 'pay-uuid']);
  });

  test('clearing is the "all projects" reset, and it sticks', () => {
    window.localStorage.setItem(KEY, 'mob-uuid');
    mount();
    expect(ui!.kanbanProjectFocus.size).toBe(1);
    act(() => {
      ui!.setKanbanProjectFocus(new Set());
    });
    expect(window.localStorage.getItem(KEY)).toBe('');
    cleanup();
    mount();
    expect(ui!.kanbanProjectFocus.size).toBe(0);
  });
});
