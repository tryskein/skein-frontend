/**
 * sk-285.7.2.68 — audit 2B, finding R-6: default vs chosen in the
 * filter panel.
 *
 * §6, mode A: "value ≠ default — 500 --ink, default — --ink-3". The
 * artboard states it as data:
 *
 *   Assignee «Anyone»            --ink-3  400
 *   Status   «Active»            --ink    500
 *   Priority «All»               --ink-3  400
 *   Type     «All»               --ink-3  400
 *   Source   «All»               --ink-3  400
 *   Sort by  «Priority + Updated»--ink    500
 *
 * All six measured identical in the product (`--ink`, 400): the
 * mechanism did not exist, so the panel could not tell a dimension that
 * is narrowing the list from one that is not. These tests hold which
 * dimensions the panel marks as untouched (`is-default`); the paint of
 * that mark is not checked by tests (sk-540.11, owner decision).
 *
 * ── What «default» was taken to mean, and why ──────────────────────
 *
 * The dimension's NEUTRAL option — «All» / «Anyone» — i.e. "this
 * dimension is not filtering anything right now". Two consequences,
 * both of which the artboard's own data confirms:
 *
 *   • Status «Active» reads as CHOSEN even though it is the value the
 *     app starts with, because it genuinely hides closed tasks;
 *   • «Sort by» has no neutral option at all, so it is always chosen —
 *     which is exactly how the artboard draws it.
 *
 * The alternative reading — "default = whatever the app boots with" —
 * would have muted both of those and contradicted the artboard.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

import { skeinTheme } from '../../../theme';
import { TaskFilters, type TaskFiltersProps } from '../TaskFilters';
import { FILTERS_LAYOUT_DEFAULT } from '../../../lib/filtersLayout';

function props(over: Partial<TaskFiltersProps> = {}): TaskFiltersProps {
  return {
    search: '',
    onSearchChange: vi.fn(),
    statusFilter: 'active',
    onStatusChange: vi.fn(),
    originFilter: 'all',
    onOriginChange: vi.fn(),
    typeFilter: 'all',
    onTypeChange: vi.fn(),
    priorityFilter: 'all',
    onPriorityChange: vi.fn(),
    view: 'cards',
    sort: 'priority-updated',
    onSortChange: vi.fn(),
    showAssigneeRow: true,
    assigneeOptions: [],
    assigneeFilter: null,
    onAssigneeChange: vi.fn(),
    searchActive: false,
    filtersEnabled: true,
    withinFilters: false,
    onWithinFiltersToggle: vi.fn(),
    allProjects: false,
    onAllProjectsToggle: vi.fn(),
    allProjectsDisabled: false,
    searchDegraded: false,
    onSearchPaste: vi.fn(),
    blobActive: false,
    collapsed: false,
    onToggleCollapsed: vi.fn(),
    filtersLayout: FILTERS_LAYOUT_DEFAULT,
    onFiltersLayoutChange: vi.fn(),
    ...over,
  };
}

function renderPanel(over: Partial<TaskFiltersProps> = {}) {
  render(
    <MantineProvider theme={skeinTheme} forceColorScheme="light">
      <TaskFilters {...props(over)} />
    </MantineProvider>,
  );
}

interface Row {
  label: string;
  isDefault: boolean;
}

function rows(): Row[] {
  return [...document.querySelectorAll('.task-filters-grid .task-filter-select')].map((wrap) => ({
    label: wrap.querySelector('label')?.textContent ?? '',
    isDefault: wrap.classList.contains('is-default'),
  }));
}

describe('R-6 — an untouched panel is quiet, and a set filter is not', () => {
  afterEach(() => {
    cleanup();
  });

  test('the six dimensions, exactly as the artboard draws them', () => {
    renderPanel();
    const byLabel = new Map(rows().map((r) => [r.label, r]));
    expect([...byLabel.keys()]).toEqual([
      'Assignee',
      'Status',
      'Priority',
      'Type',
      'Source',
      'Sort by',
    ]);

    for (const label of ['Assignee', 'Priority', 'Type', 'Source']) {
      const row = byLabel.get(label)!;
      expect(row.isDefault, `${label} should read as untouched`).toBe(true);
    }

    // «Active» narrows the list (it hides closed tasks) and «Sort by»
    // has no neutral option — the artboard picks both out.
    for (const label of ['Status', 'Sort by']) {
      const row = byLabel.get(label)!;
      expect(row.isDefault, `${label} should read as chosen`).toBe(false);
    }
  });

  test('picking a value moves that dimension — and only that one', () => {
    renderPanel({ priorityFilter: '1' });
    const byLabel = new Map(rows().map((r) => [r.label, r]));
    const priority = byLabel.get('Priority')!;
    expect(priority.isDefault).toBe(false);
    // Its neighbours have not moved with it.
    expect(byLabel.get('Type')!.isDefault).toBe(true);
    expect(byLabel.get('Source')!.isDefault).toBe(true);
  });

  test('clearing it back to the neutral option makes it quiet again', () => {
    renderPanel({ priorityFilter: 'all' });
    const priority = rows().find((r) => r.label === 'Priority')!;
    expect(priority.isDefault).toBe(true);
  });

  test('an assignee picked from the directory reads as chosen', () => {
    renderPanel({
      assigneeFilter: 'tester',
      assigneeOptions: [{ username: 'tester', label: 'tester', userId: 'u-30' }],
    });
    const assignee = rows().find((r) => r.label === 'Assignee')!;
    expect(assignee.isDefault).toBe(false);
  });
});
