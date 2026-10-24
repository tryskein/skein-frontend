/**
 * sk-285.2.19 (step 4) — the sort preference is ONE preference: a key
 * and the direction it is read in, under the one `skein.tasks.sort`
 * value the column's order has always lived in.
 *
 * Pinned at the real provider boundary, because every question here is
 * about what survives a reload:
 *
 *   1. nothing stored → the shipped default, at its natural direction;
 *   2. a bare key (what every build before this one wrote) still loads,
 *      meaning that key at its natural direction;
 *   3. both halves write through immediately and come back on a remount;
 *   4. picking a KEY resets the direction to that key's natural one —
 *      «Updated» selected from the combobox means newest first, however
 *      the previous key had been reversed. Without this, a label in the
 *      dropdown quietly describes the opposite of the order on screen;
 *   5. there is no SECOND storage key: the direction did not get its own.
 */

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';

import { TasksUiStateProvider, useTasksUiState } from '../useTasksUiState';

const KEY = 'skein.tasks.sort';

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

describe('the sort preference — one key, both halves', () => {
  test('nothing stored → the shipped default at its natural direction', () => {
    mount();
    expect(ui!.sort).toBe('priority-updated');
    expect(ui!.sortDir).toBe('asc');
  });

  test('a bare key from an older build loads at its natural direction', () => {
    window.localStorage.setItem(KEY, 'updated');
    mount();
    expect(ui!.sort).toBe('updated');
    expect(ui!.sortDir).toBe('desc');
  });

  test('a reversed direction round-trips through a remount', () => {
    window.localStorage.setItem(KEY, 'updated');
    mount();
    act(() => ui!.setSortDir('asc'));
    expect(window.localStorage.getItem(KEY)).toBe('updated:asc');
    cleanup();
    mount();
    expect(ui!.sort).toBe('updated');
    expect(ui!.sortDir).toBe('asc');
  });

  test('picking a key resets the direction to that key’s natural one', () => {
    mount();
    act(() => ui!.setSort('updated'));
    act(() => ui!.setSortDir('asc'));
    expect(ui!.sortDir).toBe('asc');
    // «Created» from the dropdown means newest first — it does not
    // inherit the reversal the previous key was left in.
    act(() => ui!.setSort('created'));
    expect(ui!.sort).toBe('created');
    expect(ui!.sortDir).toBe('desc');
    expect(window.localStorage.getItem(KEY)).toBe('created:desc');
  });

  test('the direction did not get a storage key of its own', () => {
    mount();
    act(() => ui!.setSort('id'));
    act(() => ui!.setSortDir('desc'));
    const keys = Object.keys(window.localStorage).filter((k) =>
      k.startsWith('skein.tasks.sort'),
    );
    expect(keys).toEqual([KEY]);
    expect(window.localStorage.getItem(KEY)).toBe('id:desc');
  });

  test('a stored key this build does not persist is rejected whole', () => {
    // `relevance` is search-only and deliberately absent from the
    // persisted whitelist; a hand-edited value must not resurrect it,
    // direction attached or not.
    window.localStorage.setItem(KEY, 'relevance:desc');
    mount();
    expect(ui!.sort).toBe('priority-updated');
    expect(ui!.sortDir).toBe('asc');
  });
});
