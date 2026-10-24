/**
 * sk-285.5.5 — the assignee directory search.
 *
 * On the cross-project "All projects" surface the assignee options are built
 * from the people on the LOADED board, so anyone with no visible task is
 * unreachable from the local list. This search is how they are reached: the
 * control hands the typed term back to the owner, which debounces it and
 * queries `GET /api/v1/users/directory?q=`, then hands the matches back.
 *
 * Merge note (stage 2.1 ← main): main wrote these tests against the avatar
 * chip row and its "+N ▾" overflow Menu. Stage 2 replaced that row with a
 * Mantine `Select` (`AssigneeSelect`), so the DOM assertions moved to the
 * combobox — the contract under test (raw term out, server matches in,
 * picking filters, truncation announced, stale rows refuse selection) is
 * main's, unchanged. The two cases that were purely about the chip row's
 * mount/unmount rules are gone: the Select is one control that is either
 * rendered or not, so `showAssigneeRow` alone decides, and that is already
 * covered in TaskFilters.test.tsx.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

import { TaskFilters, type AssigneeOption, type TaskFiltersProps } from '../TaskFilters';
import { FILTERS_LAYOUT_DEFAULT } from '../../../lib/filtersLayout';

function makeProps(over: Partial<TaskFiltersProps> = {}): TaskFiltersProps {
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
    // sk-285.7 T025 — the panel's layout. `select` is the app's own
    // default (lib/filtersLayout.ts), so these fixtures keep asserting
    // against the combobox body they were written for; the chip body
    // has its own file, TaskFilters.layout.test.tsx.
    filtersLayout: FILTERS_LAYOUT_DEFAULT,
    onFiltersLayoutChange: vi.fn(),
    ...over,
  };
}

function renderFilters(over: Partial<TaskFiltersProps> = {}) {
  const props = makeProps(over);
  render(
    <MantineProvider forceColorScheme="dark">
      <TaskFilters {...props} />
    </MantineProvider>,
  );
  return props;
}

function person(username: string, label = username): AssigneeOption {
  return { username, label, userId: `uuid-${username}` };
}

const assigneeInput = () =>
  screen.getByRole('textbox', { name: 'Assignee' }) as HTMLInputElement;

/** Opens the assignee combobox and waits for its dropdown to mount. */
async function openAssignee() {
  const input = assigneeInput();
  fireEvent.click(input);
  await screen.findByRole('listbox');
  return input;
}

const searchProps = (over: Partial<TaskFiltersProps> = {}): Partial<TaskFiltersProps> => ({
  assigneeSearchEnabled: true,
  assigneeSearchValue: '',
  onAssigneeSearchChange: vi.fn(),
  assigneeSearchResults: [],
  assigneeSearchLoading: false,
  assigneeSearchHasMore: false,
  ...over,
});

afterEach(() => cleanup());

describe('TaskFilters — sk-285.5.5 assignee directory search', () => {
  test('typing reports the raw term to the owner', async () => {
    const onAssigneeSearchChange = vi.fn();
    renderFilters(searchProps({ onAssigneeSearchChange }));
    const input = await openAssignee();
    fireEvent.change(input, { target: { value: 'ali' } });
    // Raw and undebounced — the owner owns the debounce, the control must
    // not swallow or delay keystrokes.
    expect(onAssigneeSearchChange).toHaveBeenCalledWith('ali');
  });

  test('server matches join the local options while a term is typed', async () => {
    renderFilters(
      searchProps({
        assigneeOptions: [person('board1', 'Board One')],
        assigneeSearchValue: 'off',
        assigneeSearchResults: [person('offboard', 'Off Board')],
      }),
    );
    await openAssignee();
    // The person who has no task on the board is reachable — that is the
    // whole point of the search.
    await waitFor(() => expect(screen.getByRole('option', { name: /Off Board/ })).toBeTruthy());
  });

  test('a server hit whose USERNAME matches but whose label does not is still offered', async () => {
    // Mantine's built-in filter reads the rendered label only. The backend
    // matches on handle as well, so left to itself the client would hide
    // exactly the person the reader searched for.
    renderFilters(
      searchProps({
        assigneeOptions: [],
        assigneeSearchValue: 'zzz',
        assigneeSearchResults: [person('zzz9', 'Pyotr Petrov')],
      }),
    );
    await openAssignee();
    await waitFor(() =>
      expect(screen.getByRole('option', { name: /Pyotr Petrov/ })).toBeTruthy(),
    );
  });

  test('with an empty term only the local options are listed', async () => {
    renderFilters(
      searchProps({
        assigneeOptions: [person('board1', 'Board One')],
        assigneeSearchValue: '',
        assigneeSearchResults: [],
      }),
    );
    await openAssignee();
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1));
    expect(screen.getByRole('option', { name: /Board One/ })).toBeTruthy();
  });

  test('picking a search result applies it as the assignee filter', async () => {
    const props = renderFilters(
      searchProps({
        assigneeOptions: [],
        assigneeSearchValue: 'off',
        assigneeSearchResults: [person('offboard', 'Off Board')],
      }),
    );
    await openAssignee();
    fireEvent.click(await screen.findByRole('option', { name: /Off Board/ }));
    expect(props.onAssigneeChange).toHaveBeenCalledWith('offboard');
  });

  test('picking clears the typed term', async () => {
    const onAssigneeSearchChange = vi.fn();
    renderFilters(
      searchProps({
        onAssigneeSearchChange,
        assigneeSearchValue: 'off',
        assigneeSearchResults: [person('offboard', 'Off Board')],
      }),
    );
    await openAssignee();
    fireEvent.click(await screen.findByRole('option', { name: /Off Board/ }));
    // A term left in the box would re-narrow the list next time the dropdown
    // opens, hiding the board's own people.
    expect(onAssigneeSearchChange).toHaveBeenCalledWith('');
  });

  test('a truncated page tells the reader to narrow the term', () => {
    renderFilters(
      searchProps({
        assigneeSearchValue: 'a',
        assigneeSearchResults: [person('a1'), person('a2')],
        assigneeSearchHasMore: true,
      }),
    );
    expect(screen.getByText(/уточните запрос|narrow the term/i)).toBeTruthy();
  });

  test('the narrowing hint goes away with the term that earned it', () => {
    // `hasMore` describes the LAST query and outlives the term. After a pick
    // the box is empty, so the advice would be about a question nobody is
    // asking any more.
    renderFilters(
      searchProps({
        assigneeSearchValue: '',
        assigneeSearchResults: [person('a1'), person('a2')],
        assigneeSearchHasMore: true,
      }),
    );
    expect(screen.queryByText(/уточните запрос|narrow the term/i)).toBeNull();
  });

  test('a complete page says nothing about narrowing', () => {
    renderFilters(
      searchProps({
        assigneeSearchValue: 'a',
        assigneeSearchResults: [person('a1')],
        assigneeSearchHasMore: false,
      }),
    );
    expect(screen.queryByText(/уточните запрос|narrow the term/i)).toBeNull();
  });

  test('stale matches are shown but refuse selection until they catch up', async () => {
    const props = renderFilters(
      searchProps({
        assigneeOptions: [person('board1', 'Board One')],
        assigneeSearchValue: 'off',
        assigneeSearchResults: [person('offboard', 'Off Board')],
        assigneeSearchLoading: true,
      }),
    );
    await openAssignee();
    const stale = await screen.findByRole('option', { name: /Off Board/ });
    // Still on screen — the list must not blank out between keystrokes...
    expect(stale).toBeTruthy();
    fireEvent.click(stale);
    // ...but it answers the PREVIOUS term, so it must not filter.
    expect(props.onAssigneeChange).not.toHaveBeenCalled();
  });

  test('a LOCAL option stays selectable while the server half is in flight', async () => {
    const props = renderFilters(
      searchProps({
        assigneeOptions: [person('board1', 'Board One')],
        assigneeSearchValue: 'boa',
        assigneeSearchResults: [person('offboard', 'Off Board')],
        assigneeSearchLoading: true,
      }),
    );
    await openAssignee();
    fireEvent.click(await screen.findByRole('option', { name: /Board One/ }));
    // Board options are local data — never stale, so never frozen.
    expect(props.onAssigneeChange).toHaveBeenCalledWith('board1');
  });

  test('fresh matches are selectable', async () => {
    const props = renderFilters(
      searchProps({
        assigneeSearchValue: 'off',
        assigneeSearchResults: [person('offboard', 'Off Board')],
        assigneeSearchLoading: false,
      }),
    );
    await openAssignee();
    fireEvent.click(await screen.findByRole('option', { name: /Off Board/ }));
    expect(props.onAssigneeChange).toHaveBeenCalledWith('offboard');
  });

  test('an option already carrying the active assignee is not duplicated', async () => {
    renderFilters(
      searchProps({
        assigneeOptions: [person('dup', 'Duplicate Person')],
        assigneeSearchValue: 'dup',
        // The backend legitimately returns somebody who is also on the board.
        assigneeSearchResults: [person('dup', 'Duplicate Person')],
      }),
    );
    await openAssignee();
    await waitFor(() =>
      expect(screen.getAllByRole('option', { name: /Duplicate Person/ })).toHaveLength(1),
    );
  });

  test('a search that matched nobody says so, but not while it is still loading', async () => {
    const { rerender } = { rerender: null as unknown as never };
    void rerender;
    renderFilters(
      searchProps({
        assigneeOptions: [],
        assigneeSearchValue: 'nobody',
        assigneeSearchResults: [],
        assigneeSearchLoading: true,
      }),
    );
    await openAssignee();
    // In flight: an empty list is not yet an answer.
    expect(screen.queryByText('No one matches')).toBeNull();
    cleanup();

    renderFilters(
      searchProps({
        assigneeOptions: [],
        assigneeSearchValue: 'nobody',
        assigneeSearchResults: [],
        assigneeSearchLoading: false,
      }),
    );
    await openAssignee();
    await waitFor(() => expect(screen.getByText('No one matches')).toBeTruthy());
  });
});
