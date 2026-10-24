/**
 * sk-47.2 — paste-a-blob trigger behaviour.
 *
 * Asserts the onPaste branch keyed on `extractIssueCodes`:
 *   - paste with ≥1 code → preventDefault() called + blob mode entered
 *     (the wall of text must NOT land in the input);
 *   - paste with 0 codes → preventDefault() NOT called + blob mode NOT
 *     entered (the browser's default paste runs → normal typed search).
 *
 * The handler under test is the exact production handler shape used in
 * TasksColumn (extract codes → ≥1 ? preventDefault + enter : no-op),
 * wired onto the real `TaskFilters` search input so we exercise the
 * actual `onPaste` plumbing, not a stand-in.
 */

import type { ClipboardEvent } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

import { TaskFilters, type TaskFiltersProps } from '../TaskFilters';
import { FILTERS_LAYOUT_DEFAULT } from '../../../lib/filtersLayout';
import { extractIssueCodes } from '../../../lib/extractIssueCodes';

/**
 * Build the production paste handler. `enter` is the blob-mode entry point
 * (spied in tests); the decision logic mirrors TasksColumn.handleSearchPaste
 * exactly.
 */
function makePasteHandler(enter: (codes: string[]) => void) {
  return (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text');
    const codes = extractIssueCodes(text);
    if (codes.length === 0) return;
    e.preventDefault();
    enter(codes);
  };
}

function baseProps(over: Partial<TaskFiltersProps> = {}): TaskFiltersProps {
  return {
    search: '',
    onSearchChange: vi.fn(),
    statusFilter: 'all',
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
    showAssigneeRow: false,
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
    // sk-285.1.13 — panel expanded; the search box (what these tests
    // exercise) renders in both states.
    collapsed: false,
    onToggleCollapsed: vi.fn(),
    // sk-285.7 T025 — the panel's layout. `select` is the app's own
    // default (lib/filtersLayout.ts), so these fixtures keep asserting
    // against the combobox body they were written for; the chip body
    // has its own file, TaskFilters.layout.test.tsx.
    filtersLayout: FILTERS_LAYOUT_DEFAULT,
    onFiltersLayoutChange: vi.fn(),
    ...over,
  };
}

/**
 * jsdom's fireEvent.paste does not synthesise a DataTransfer, and React
 * wraps the native event in a SyntheticEvent whose preventDefault delegates
 * to the native one. To observe preventDefault reliably we build a REAL
 * paste Event, attach a `clipboardData` stub + spy on the native
 * `preventDefault`, and dispatch it through fireEvent so React's handler
 * runs against our event. The synthetic preventDefault() then calls our
 * native spy.
 */
function firePaste(input: HTMLElement, text: string) {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: { getData: (type: string) => (type === 'text' ? text : '') },
  });
  const preventDefault = vi.spyOn(event, 'preventDefault');
  fireEvent(input, event);
  return preventDefault;
}

afterEach(() => cleanup());

describe('paste-a-blob trigger (sk-47.2)', () => {
  test('paste with ≥1 code → preventDefault called + enter(codes)', () => {
    const enter = vi.fn();
    render(
      <MantineProvider forceColorScheme="dark">
        <TaskFilters {...baseProps({ onSearchPaste: makePasteHandler(enter) })} />
      </MantineProvider>,
    );
    const input = screen.getByLabelText('Search tasks');
    const preventDefault = firePaste(
      input,
      'standup: finished sk-14, blocked on demo-2.1, see sk-14 again',
    );

    expect(preventDefault).toHaveBeenCalledTimes(1);
    // Deduped, first-seen order.
    expect(enter).toHaveBeenCalledTimes(1);
    expect(enter).toHaveBeenCalledWith(['sk-14', 'demo-2.1']);
  });

  test('paste with 0 codes → preventDefault NOT called + enter NOT called', () => {
    const enter = vi.fn();
    render(
      <MantineProvider forceColorScheme="dark">
        <TaskFilters {...baseProps({ onSearchPaste: makePasteHandler(enter) })} />
      </MantineProvider>,
    );
    const input = screen.getByLabelText('Search tasks');
    const preventDefault = firePaste(
      input,
      'just some prose with 15 items and the year 2024, no codes here',
    );

    // Default paste runs → text drives the normal typed search.
    expect(preventDefault).not.toHaveBeenCalled();
    expect(enter).not.toHaveBeenCalled();
  });

  test('a single bare number does NOT trigger blob mode', () => {
    const enter = vi.fn();
    render(
      <MantineProvider forceColorScheme="dark">
        <TaskFilters {...baseProps({ onSearchPaste: makePasteHandler(enter) })} />
      </MantineProvider>,
    );
    const input = screen.getByLabelText('Search tasks');
    const preventDefault = firePaste(input, '42');
    expect(preventDefault).not.toHaveBeenCalled();
    expect(enter).not.toHaveBeenCalled();
  });
});
