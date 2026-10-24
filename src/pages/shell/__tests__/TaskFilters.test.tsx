/**
 * sk-44.2 / sk-44.4 / sk-44.5 / sk-285.1.18 — TaskFilters view.
 *
 * Replaces the deleted TaskFilters.idLookup.test.tsx. The id-lookup
 * typeahead dropdown (consumer A of the search box) was removed in
 * sk-44.3, so these tests assert:
 *   - typing produces NO overlay (no listbox / EXACT MATCH);
 *   - typing only drives `onSearchChange` (consumer B → list filter);
 *   - the "within filters" / "all projects" toggles render only while
 *     a search is active and call their handlers;
 *   - the filter selects go disabled when `filtersEnabled` is false;
 *   - the degraded hint renders when `searchDegraded` is true.
 *
 * sk-285.1.18 — the expanded panel is now one labelled DROPDOWN per
 * filter dimension instead of rows of chip-pills, so every
 * display/selection assertion below reads the select's value or its option
 * list. The multi-valued dimension (tree dep types) is a MultiSelect and
 * is pinned as such: picking adds instead of replacing.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';

import {
  countActiveFilters,
  TaskFilters,
  type TaskFiltersProps,
} from '../TaskFilters';
import { FILTERS_LAYOUT_DEFAULT } from '../../../lib/filtersLayout';
import type { DepType } from '../../../api/dependencies';

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
    // sk-79 — assignee row defaults: hidden, no options, no selection.
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
    // sk-47.2 — paste-a-blob props (defaults: no paste handler invoked,
    // blob mode off).
    onSearchPaste: vi.fn(),
    blobActive: false,
    // sk-285.1.13 — these tests assert on the filter dropdowns, so the
    // default here is the EXPANDED panel. The app's own default (collapsed) lives
    // in useLayoutState and is covered by its own tests.
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

afterEach(() => cleanup());

describe('TaskFilters — sk-44.3 dropdown removed', () => {
  test('typing produces NO typeahead overlay', () => {
    renderFilters({ search: 'sk-14' });
    // No id-lookup overlay artefacts.
    expect(screen.queryByText('EXACT MATCH')).toBeNull();
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.queryByText('(hidden by filters)')).toBeNull();
  });

  test('typing in the box only calls onSearchChange', () => {
    const props = renderFilters();
    const input = screen.getByLabelText('Search tasks');
    fireEvent.change(input, { target: { value: 'auth' } });
    expect(props.onSearchChange).toHaveBeenCalledWith('auth');
  });

  test('Enter in the box does nothing destructive (no navigation hook)', () => {
    renderFilters({ search: 'sk-14' });
    const input = screen.getByLabelText('Search tasks');
    // Just assert it doesn't throw and no overlay appears.
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});

describe('TaskFilters — sk-44.4/5 search-mode toggles', () => {
  test('toggles hidden when no search is active', () => {
    renderFilters({ searchActive: false });
    expect(screen.queryByLabelText('Search within filters')).toBeNull();
    expect(screen.queryByLabelText('Search all projects')).toBeNull();
  });

  test('toggles shown while search is active', () => {
    renderFilters({ searchActive: true });
    expect(screen.getByLabelText('Search within filters')).toBeTruthy();
    expect(screen.getByLabelText('Search all projects')).toBeTruthy();
  });

  test('within-filters button fires its handler', () => {
    const props = renderFilters({ searchActive: true });
    fireEvent.click(screen.getByLabelText('Search within filters'));
    expect(props.onWithinFiltersToggle).toHaveBeenCalledTimes(1);
  });

  test('all-projects button fires its handler', () => {
    const props = renderFilters({ searchActive: true });
    fireEvent.click(screen.getByLabelText('Search all projects'));
    expect(props.onAllProjectsToggle).toHaveBeenCalledTimes(1);
  });

  test('disabled all-projects button uses aria-disabled (keyboard-focusable) + stays inert', () => {
    const props = renderFilters({ searchActive: true, allProjectsDisabled: true });
    const btn = screen.getByLabelText('Search all projects') as HTMLButtonElement;
    // Fix H — NOT the native `disabled` attribute (that removes the
    // element from the focus order → its explanatory tooltip becomes
    // mouse-only). aria-disabled keeps it focusable so keyboard users
    // can hover/focus to read the tooltip.
    expect(btn.disabled).toBe(false);
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    // Still keyboard-reachable: no negative tabindex, not natively disabled.
    expect(btn.tabIndex).toBeGreaterThanOrEqual(0);
    // Click handler early-returns → handler stays inert.
    fireEvent.click(btn);
    expect(props.onAllProjectsToggle).not.toHaveBeenCalled();
  });

  test('enabled all-projects button has no aria-disabled', () => {
    renderFilters({ searchActive: true, allProjectsDisabled: false });
    const btn = screen.getByLabelText('Search all projects') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(btn.getAttribute('aria-disabled')).toBeNull();
  });

  test('disabled all-projects tooltip is reachable via keyboard focus', async () => {
    renderFilters({ searchActive: true, allProjectsDisabled: true });
    const btn = screen.getByLabelText('Search all projects') as HTMLButtonElement;
    // The button is NOT natively disabled (aria-disabled), so it accepts
    // focus — which is exactly what makes the SkeinTooltip's useFocus
    // trigger fire for keyboard users. A native disabled button would
    // refuse focus and the explanation would be mouse-only.
    btn.focus();
    expect(document.activeElement).toBe(btn);
    // Focus opens the tooltip (role=tooltip) with the disabled-state copy.
    await waitFor(() => {
      expect(
        screen.getByText('Already searching across every project you can see.'),
      ).toBeTruthy();
    });
  });

  test('aria-pressed reflects toggle state', () => {
    renderFilters({ searchActive: true, withinFilters: true, allProjects: true });
    expect(
      screen.getByLabelText('Search within filters').getAttribute('aria-pressed'),
    ).toBe('true');
    expect(
      screen.getByLabelText('Search all projects').getAttribute('aria-pressed'),
    ).toBe('true');
  });
});

describe('TaskFilters — sk-285.1.18 one dropdown per filter dimension', () => {
  // Mantine 7 puts the accessible name on BOTH the <input> and the
  // dropdown <div role="listbox">, so getByLabelText is ambiguous. Target
  // the control via role=textbox, the choices via role=option.
  const select = (name: string) =>
    screen.getByRole('textbox', { name }) as HTMLInputElement;
  const open = (name: string) => {
    fireEvent.click(select(name));
  };

  test('every dimension renders exactly one labelled select', () => {
    renderFilters();
    for (const name of ['Status', 'Priority', 'Type', 'Source', 'Sort by']) {
      expect(select(name)).toBeTruthy();
    }
    // The chip rows are gone — no pill buttons left in the panel body.
    expect(document.querySelectorAll('.task-filters-body .filter-pill')).toHaveLength(
      0,
    );
  });

  test('each select displays its EFFECTIVE value without being opened', () => {
    // sk-44.4 — TaskFilters is a pure view: TasksColumn feeds it the
    // EFFECTIVE filters (cleared during an unfiltered search), so whatever
    // it is handed must be readable at a glance.
    renderFilters({
      statusFilter: 'in_progress',
      priorityFilter: '2',
      typeFilter: 'bug',
      originFilter: 'agent-autonomous',
      view: 'tree',
    });
    expect(select('Status').value).toBe('In progress');
    expect(select('Priority').value).toBe('P2');
    expect(select('Type').value).toBe('bug');
    expect(select('Source').value).toBe('From an agent');
  });

  test('cleared effective filters (active/all/all) read Active / All', () => {
    // Mirrors what TasksColumn passes during an unfiltered search.
    renderFilters({ statusFilter: 'active', originFilter: 'all', typeFilter: 'all' });
    expect(select('Status').value).toBe('Active');
    // Every dimension's "no filter" option is labelled "All"; reading them
    // off their own inputs is unambiguous (the chip rows needed scoping).
    expect(select('Source').value).toBe('All');
    expect(select('Type').value).toBe('All');
  });

  test('picking a status option calls onStatusChange with the WIRE value', () => {
    const props = renderFilters({ statusFilter: 'all' });
    open('Status');
    fireEvent.click(screen.getByRole('option', { name: /^In progress/ }));
    expect(props.onStatusChange).toHaveBeenCalledWith('in_progress');
  });

  test('picking a source option calls onOriginChange with the WIRE value', () => {
    const props = renderFilters();
    open('Source');
    fireEvent.click(screen.getByRole('option', { name: /^From an agent/ }));
    expect(props.onOriginChange).toHaveBeenCalledWith('agent-autonomous');
  });

  test('picking a type option calls onTypeChange with the wire type', () => {
    const props = renderFilters();
    open('Type');
    fireEvent.click(screen.getByRole('option', { name: 'bug' }));
    expect(props.onTypeChange).toHaveBeenCalledWith('bug');
  });

  test('the view switcher is NOT here — it lives in the header rail', () => {
    // Stage 2: the panel narrows WHICH tasks; the view picks HOW they are
    // drawn, so the switcher moved to the header (HeaderBar.viewswitch
    // covers its behaviour). A control in both places would be two
    // sources of truth for one setting.
    renderFilters({ view: 'cards' });
    expect(screen.queryByRole('textbox', { name: 'View' })).toBeNull();
  });

  test('options carry their explanation as a visible second line', () => {
    // The chips could only hang this on a `title` attribute — mouse-only
    // and delayed. In the dropdown it is real text.
    renderFilters();
    open('Status');
    expect(
      screen.getByRole('option', { name: /Everything except Done/ }),
    ).toBeTruthy();
  });

  test('the selects are keyboard-operable end to end (arrows + Enter)', () => {
    // Mantine reads `event.code`, so the synthetic events carry both.
    const props = renderFilters({ priorityFilter: 'all' });
    const input = select('Priority');
    input.focus();
    expect(document.activeElement).toBe(input);

    // ArrowDown opens the list and lands on the current value…
    fireEvent.keyDown(input, { key: 'ArrowDown', code: 'ArrowDown' });
    expect(screen.getByRole('option', { name: /^P0/ })).toBeTruthy();
    // …the next ArrowDown moves to P0, Enter picks it. No mouse involved.
    fireEvent.keyDown(input, { key: 'ArrowDown', code: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    expect(props.onPriorityChange).toHaveBeenCalledWith('0');
  });
});

describe('TaskFilters — sk-118 standing (∞ Standing) status option', () => {
  // The standing lens/filter lets the standing band be viewed as a
  // watchlist on its own.
  const statusSelect = () =>
    screen.getByRole('textbox', { name: 'Status' }) as HTMLInputElement;

  test('the standing option is offered by the status select', () => {
    renderFilters();
    fireEvent.click(statusSelect());
    expect(screen.getByRole('option', { name: /∞ Standing/ })).toBeTruthy();
  });

  test('the status select displays it when statusFilter=standing', () => {
    renderFilters({ statusFilter: 'standing' });
    expect(statusSelect().value).toBe('∞ Standing');
  });

  test('a different statusFilter does not display it', () => {
    renderFilters({ statusFilter: 'open' });
    expect(statusSelect().value).toBe('Open');
  });

  test("picking it calls onStatusChange('standing')", () => {
    const props = renderFilters({ statusFilter: 'all' });
    fireEvent.click(statusSelect());
    fireEvent.click(screen.getByRole('option', { name: /∞ Standing/ }));
    expect(props.onStatusChange).toHaveBeenCalledWith('standing');
  });
});

describe('TaskFilters — sk-86 priority dimension', () => {
  const prioritySelect = () =>
    screen.getByRole('textbox', { name: 'Priority' }) as HTMLInputElement;

  test('offers All + P0..P4', () => {
    renderFilters();
    fireEvent.click(prioritySelect());
    expect(screen.getByRole('option', { name: /^All/ })).toBeTruthy();
    for (const label of ['P0', 'P1', 'P2', 'P3', 'P4']) {
      expect(screen.getByRole('option', { name: new RegExp(`^${label}`) })).toBeTruthy();
    }
  });

  test('displays the priorityFilter prop', () => {
    renderFilters({ priorityFilter: '2' });
    expect(prioritySelect().value).toBe('P2');
  });

  test('picking a priority calls onPriorityChange with its value', () => {
    const props = renderFilters();
    fireEvent.click(prioritySelect());
    fireEvent.click(screen.getByRole('option', { name: /^P1/ }));
    expect(props.onPriorityChange).toHaveBeenCalledWith('1');
  });

  test('disabled when filtersEnabled=false', () => {
    renderFilters({ filtersEnabled: false });
    expect(prioritySelect().disabled).toBe(true);
  });
});

describe('TaskFilters — sk-36 tree dep-type MultiSelect', () => {
  const deps = (over?: Partial<TaskFiltersProps>) =>
    renderFilters({
      view: 'tree',
      treeDepTypes: new Set<DepType>(['parent-child', 'blocks']),
      onTreeDepTypesChange: vi.fn(),
      ...over,
    });
  const depsInput = () => screen.getByRole('textbox', { name: 'Tree edges' });

  test('rendered only in tree view', () => {
    deps({ view: 'cards' });
    expect(screen.queryByRole('textbox', { name: 'Tree edges' })).toBeNull();
    cleanup();
    deps();
    expect(depsInput()).toBeTruthy();
  });

  test('the picked edge types are visible as pills without opening it', () => {
    deps();
    const field = depsInput().closest('.task-filter-select') as HTMLElement;
    expect(field.textContent).toContain('parent-child');
    expect(field.textContent).toContain('blocks');
    expect(field.textContent).not.toContain('waits-for');
  });

  test('picking another edge type ADDS it (multi-select, not radio)', () => {
    const props = deps();
    fireEvent.click(depsInput());
    fireEvent.click(screen.getByRole('option', { name: /^waits-for/ }));
    expect(props.onTreeDepTypesChange).toHaveBeenCalledTimes(1);
    const next = (props.onTreeDepTypesChange as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as Set<DepType>;
    expect([...next].sort()).toEqual(['blocks', 'parent-child', 'waits-for']);
  });

  test('parent-child is the spine: no remove button on its pill, option inert', () => {
    const props = deps();
    const field = depsInput().closest('.task-filter-select') as HTMLElement;
    // Mantine drops the pill's remove button for a disabled option.
    const pills = [...field.querySelectorAll('[class*="Pill-root"]')];
    const spine = pills.find((p) => (p.textContent ?? '').includes('parent-child'))!;
    const blocks = pills.find((p) => (p.textContent ?? '').includes('blocks'))!;
    expect(spine.querySelector('[class*="Pill-remove"]')).toBeNull();
    expect(blocks.querySelector('[class*="Pill-remove"]')).toBeTruthy();

    // And the dropdown entry cannot be clicked off.
    fireEvent.click(depsInput());
    fireEvent.click(screen.getByRole('option', { name: /^parent-child/ }));
    expect(props.onTreeDepTypesChange).not.toHaveBeenCalled();
  });

  test('unpicking a non-spine edge type removes only that one', () => {
    const props = deps({
      treeDepTypes: new Set<DepType>(['parent-child', 'blocks', 'related']),
    });
    fireEvent.click(depsInput());
    fireEvent.click(screen.getByRole('option', { name: /^blocks/ }));
    const next = (props.onTreeDepTypesChange as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as Set<DepType>;
    expect([...next].sort()).toEqual(['parent-child', 'related']);
  });
});

describe('TaskFilters — sk-79 assignee dropdown', () => {
  const opts = [
    { username: 'alice', userId: 'u-alice', label: 'me', isMe: true },
    { username: 'carol', userId: 'u-carol', label: 'Carol Clark' },
    { username: 'dave', userId: 'u-dave', label: 'Dave Davis' },
  ];
  const assigneeInput = () =>
    screen.getByRole('textbox', { name: 'Assignee' }) as HTMLInputElement;

  test('hidden when showAssigneeRow=false', () => {
    renderFilters({ showAssigneeRow: false, assigneeOptions: opts });
    expect(screen.queryByRole('textbox', { name: 'Assignee' })).toBeNull();
  });

  test('no selection reads as the "Anyone" placeholder', () => {
    renderFilters({ showAssigneeRow: true, assigneeOptions: opts });
    const input = assigneeInput();
    expect(input.value).toBe('');
    expect(input.placeholder).toBe('Anyone');
  });

  test('the picked assignee is visible without opening the dropdown', () => {
    renderFilters({
      showAssigneeRow: true,
      assigneeOptions: opts,
      assigneeFilter: 'dave',
    });
    expect(assigneeInput().value).toBe('Dave Davis');
  });

  test('a filter naming someone outside the option list still shows', () => {
    // The applied filter must never silently read as "anyone".
    renderFilters({
      showAssigneeRow: true,
      assigneeOptions: opts,
      assigneeFilter: 'ghost',
    });
    expect(assigneeInput().value).toBe('ghost');
  });

  test('opening lists every member; picking one calls onAssigneeChange', async () => {
    const props = renderFilters({ showAssigneeRow: true, assigneeOptions: opts });
    fireEvent.click(assigneeInput());
    await waitFor(() => {
      expect(screen.getAllByRole('option')).toHaveLength(3);
    });
    fireEvent.click(screen.getByRole('option', { name: /Dave Davis/ }));
    expect(props.onAssigneeChange).toHaveBeenCalledWith('dave');
  });

  test('clearing the select calls onAssigneeChange(null)', () => {
    const props = renderFilters({
      showAssigneeRow: true,
      assigneeOptions: opts,
      assigneeFilter: 'dave',
    });
    const clear = screen
      .getByRole('textbox', { name: 'Assignee' })
      .closest('.task-filter-select')!
      .querySelector('button[class*="InputClearButton"]') as HTMLButtonElement;
    expect(clear).toBeTruthy();
    fireEvent.click(clear);
    expect(props.onAssigneeChange).toHaveBeenCalledWith(null);
  });

  test('re-picking the selected assignee clears the filter (keyboard path)', () => {
    // Mantine's clear button is aria-hidden / tabIndex -1, so deselecting
    // via the option list is how a keyboard user lifts this filter.
    const props = renderFilters({
      showAssigneeRow: true,
      assigneeOptions: opts,
      assigneeFilter: 'dave',
    });
    fireEvent.click(assigneeInput());
    fireEvent.click(screen.getByRole('option', { name: /Dave Davis/ }));
    expect(props.onAssigneeChange).toHaveBeenCalledWith(null);
  });

  test('stays enabled while an unfiltered search disables the other filters', () => {
    // The assignee filter is NOT cleared by an unfiltered search (TasksColumn
    // keeps feeding it to the query), so its control must stay operable —
    // otherwise the user cannot lift a filter that is still applied.
    renderFilters({
      showAssigneeRow: true,
      assigneeOptions: opts,
      assigneeFilter: 'dave',
      searchActive: true,
      filtersEnabled: false,
    });
    expect(assigneeInput().disabled).toBe(false);
    expect(
      (screen.getByRole('textbox', { name: 'Status' }) as HTMLInputElement).disabled,
    ).toBe(true);
  });
});

describe('TaskFilters — sk-194.5.2.8.1 assignee options are built lazily', () => {
  // Profiled regression guard:
  // on the cross-project lens the assignee list holds the whole org
  // directory (a large directory). Mantine re-parses `data` on EVERY render, so
  // the full list is only materialised while the dropdown is open — a
  // keystroke in the search box must not rebuild it.
  const many = Array.from({ length: 60 }, (_, i) => ({
    username: `u${i}`,
    userId: `id${i}`,
    label: `User ${i}`,
  }));

  test('closed: not one option label is in the DOM', () => {
    renderFilters({ showAssigneeRow: true, assigneeOptions: many });
    expect(screen.queryByText('User 0')).toBeNull();
    expect(screen.queryByText('User 59')).toBeNull();
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });

  test('closed WITH a selection: only the selected label is built', () => {
    renderFilters({
      showAssigneeRow: true,
      assigneeOptions: many,
      assigneeFilter: 'u42',
    });
    expect(
      (screen.getByRole('textbox', { name: 'Assignee' }) as HTMLInputElement).value,
    ).toBe('User 42');
    expect(screen.queryByText('User 41')).toBeNull();
  });

  test('opening materialises the list, capped at the dropdown limit', async () => {
    renderFilters({ showAssigneeRow: true, assigneeOptions: many });
    fireEvent.click(screen.getByRole('textbox', { name: 'Assignee' }));
    await waitFor(() => {
      expect(screen.getAllByRole('option').length).toBeGreaterThan(0);
    });
    // 60 members, limit 50 — the tail is reached by typing, not scrolling.
    expect(screen.getAllByRole('option')).toHaveLength(50);
    expect(screen.getByRole('option', { name: /User 0/ })).toBeTruthy();
  });

  test('typing narrows to the members past the cap', async () => {
    const props = renderFilters({ showAssigneeRow: true, assigneeOptions: many });
    const input = screen.getByRole('textbox', { name: 'Assignee' });
    fireEvent.click(input);
    fireEvent.change(input, { target: { value: 'User 59' } });
    await waitFor(() => {
      expect(screen.getAllByRole('option')).toHaveLength(1);
    });
    fireEvent.click(screen.getByRole('option', { name: /User 59/ }));
    expect(props.onAssigneeChange).toHaveBeenCalledWith('u59');
  });
});

describe('TaskFilters — filter enabling + degraded hint', () => {
  test('filter selects disabled when filtersEnabled=false', () => {
    renderFilters({ searchActive: true, filtersEnabled: false });
    for (const name of ['Status', 'Priority', 'Type', 'Source']) {
      expect((screen.getByRole('textbox', { name }) as HTMLInputElement).disabled).toBe(
        true,
      );
    }
    // Sort re-shapes rather than narrows, so it stays live even when the
    // filters themselves are disabled. (View moved to the header rail.)
    expect(
      (screen.getByRole('textbox', { name: 'Sort by' }) as HTMLInputElement).disabled,
    ).toBe(false);
  });

  test('filter selects enabled when filtersEnabled=true', () => {
    renderFilters({ filtersEnabled: true });
    expect(
      (screen.getByRole('textbox', { name: 'Status' }) as HTMLInputElement).disabled,
    ).toBe(false);
  });

  test('degraded hint renders only when search active + degraded', () => {
    renderFilters({ searchActive: true, searchDegraded: true });
    expect(screen.getByRole('status')).toBeTruthy();
  });

  test('no degraded hint when not degraded', () => {
    renderFilters({ searchActive: true, searchDegraded: false });
    expect(screen.queryByRole('status')).toBeNull();
  });
});


describe('TaskFilters — sk-50 Relevance sort option (search-only)', () => {
  // Mantine 7 Select puts the aria-label on BOTH the readonly <input>
  // and the dropdown <div role="listbox">, so getByLabelText('Sort by')
  // is ambiguous. Target the input via role=textbox, options via
  // role=option (exact accessible-name match avoids the
  // "Priority"/"Priority + Updated" substring collision).
  const sortInput = () =>
    screen.getByRole('textbox', { name: 'Sort by' }) as HTMLInputElement;

  test('Relevance option is absent from the combobox when NOT searching', () => {
    renderFilters({ searchActive: false, sort: 'id' });
    fireEvent.click(sortInput());
    // Real persisted buckets are present, but Relevance is not offered.
    expect(screen.getByRole('option', { name: 'ID' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Relevance' })).toBeNull();
  });

  test('Relevance option appears in the combobox while searching', () => {
    renderFilters({ searchActive: true, sort: 'relevance' });
    fireEvent.click(sortInput());
    // Option list now offers Relevance plus the persisted buckets.
    expect(screen.getByRole('option', { name: 'Relevance' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Priority' })).toBeTruthy();
  });

  test('combobox shows the effective sort value (Relevance) when searching', () => {
    renderFilters({ searchActive: true, sort: 'relevance' });
    expect(sortInput().value).toBe('Relevance');
  });

  test('picking a sort WHILE searching routes to onSearchSortChange, not onSortChange', () => {
    const onSearchSortChange = vi.fn();
    const props = renderFilters({
      searchActive: true,
      sort: 'relevance',
      onSearchSortChange,
    });
    fireEvent.click(sortInput());
    fireEvent.click(screen.getByRole('option', { name: 'Priority' }));
    expect(onSearchSortChange).toHaveBeenCalledWith('priority');
    expect(props.onSortChange).not.toHaveBeenCalled();
  });

  test('picking a sort OUTSIDE search routes to onSortChange, not onSearchSortChange', () => {
    const onSearchSortChange = vi.fn();
    const props = renderFilters({
      searchActive: false,
      sort: 'id',
      onSearchSortChange,
    });
    fireEvent.click(sortInput());
    fireEvent.click(screen.getByRole('option', { name: 'Priority' }));
    expect(props.onSortChange).toHaveBeenCalledWith('priority');
    expect(onSearchSortChange).not.toHaveBeenCalled();
  });
});

describe('TaskFilters — sk-285.1.13 collapsible filter panel', () => {
  const toggle = () => screen.getByRole('button', { name: /filters/i });

  test('collapsed: the dropdowns are hidden, the search box stays visible', () => {
    renderFilters({ collapsed: true });

    // The panel body is still in the DOM (so aria-controls resolves) but
    // hidden — Testing Library's role query respects `hidden`, so the
    // selects are gone from the a11y tree.
    for (const name of ['Status', 'Priority', 'Type', 'Source', 'Sort by']) {
      expect(screen.queryByRole('textbox', { name })).toBeNull();
    }
    expect(screen.queryByRole('group', { name: 'Task filters' })).toBeNull();

    // The most-used control survives the fold.
    expect(screen.getByLabelText('Search tasks')).toBeTruthy();
  });

  test('expanded: the dropdowns render', () => {
    renderFilters({ collapsed: false });
    expect(screen.getByRole('group', { name: 'Task filters' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Status' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Sort by' })).toBeTruthy();
  });

  test('toggle button exposes aria-expanded + aria-controls and fires the handler', () => {
    const props = renderFilters({ collapsed: true });
    const btn = toggle();
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(btn.getAttribute('aria-controls')).toBe('task-filters-body');
    // The controlled region exists even while folded.
    expect(document.getElementById('task-filters-body')).toBeTruthy();

    fireEvent.click(btn);
    expect(props.onToggleCollapsed).toHaveBeenCalledTimes(1);
  });

  test('keyboard: the toggle is a native button, so Enter/Space activate it', () => {
    const props = renderFilters({ collapsed: true });
    const btn = toggle();
    expect(btn.tagName).toBe('BUTTON');
    btn.focus();
    expect(document.activeElement).toBe(btn);
    // jsdom fires click for keyboard activation of a focused button only via
    // the click event; assert the handler is the click handler (same path the
    // browser takes for Enter / Space on a <button>).
    fireEvent.click(document.activeElement as HTMLElement);
    expect(props.onToggleCollapsed).toHaveBeenCalledTimes(1);
  });

  test('aria-expanded flips to true when the panel is open', () => {
    renderFilters({ collapsed: false });
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
  });

  test('collapsed bar surfaces the active-filter count', () => {
    renderFilters({
      collapsed: true,
      statusFilter: 'closed',
      typeFilter: 'bug',
      priorityFilter: 'all',
      originFilter: 'all',
      assigneeFilter: null,
    });
    const btn = toggle();
    expect(btn.textContent).toContain('2');
    expect(btn.getAttribute('aria-label')).toContain('active filters: 2');
  });

  test('no narrowing filters → no count badge, and AT hears "no active filters"', () => {
    renderFilters({ collapsed: true });
    const btn = toggle();
    expect(btn.querySelector('.task-filters-count')).toBeNull();
    expect(btn.getAttribute('aria-label')).toContain('no active filters');
  });
});

describe('countActiveFilters — sk-285.1.13', () => {
  const neutral = {
    statusFilter: 'active',
    priorityFilter: 'all',
    typeFilter: 'all',
    originFilter: 'all',
    assigneeFilter: null,
  } as const;

  test('the default board counts as unfiltered', () => {
    expect(countActiveFilters(neutral)).toBe(0);
  });

  test("status 'all' widens, so it is not counted either", () => {
    expect(countActiveFilters({ ...neutral, statusFilter: 'all' })).toBe(0);
  });

  test('every narrowing status counts', () => {
    expect(countActiveFilters({ ...neutral, statusFilter: 'closed' })).toBe(1);
    expect(countActiveFilters({ ...neutral, statusFilter: 'blocked' })).toBe(1);
    expect(countActiveFilters({ ...neutral, statusFilter: 'standing' })).toBe(1);
  });

  test('priority / type / source / assignee each add one', () => {
    expect(countActiveFilters({ ...neutral, priorityFilter: '0' })).toBe(1);
    expect(countActiveFilters({ ...neutral, typeFilter: 'bug' })).toBe(1);
    expect(
      countActiveFilters({ ...neutral, originFilter: 'human-driven' }),
    ).toBe(1);
    expect(countActiveFilters({ ...neutral, assigneeFilter: 'ann' })).toBe(1);
  });

  test('narrowing filters accumulate', () => {
    expect(
      countActiveFilters({
        statusFilter: 'open',
        priorityFilter: '1',
        typeFilter: 'task',
        originFilter: 'agent-autonomous',
        assigneeFilter: 'bob',
      }),
    ).toBe(5);
  });

  // sk-285.2.6 — the board's project focus counts like any other
  // narrowing control: ONE, whatever its size, and only while it is
  // actually applied (the caller zeroes it when the focus is paused or
  // when the board is not the current view).
  test('a project focus counts as one filter, not one per project', () => {
    expect(countActiveFilters({ ...neutral, projectFocus: 1 })).toBe(1);
    expect(countActiveFilters({ ...neutral, projectFocus: 3 })).toBe(1);
  });

  test('an unapplied project focus counts for nothing', () => {
    expect(countActiveFilters({ ...neutral, projectFocus: 0 })).toBe(0);
    expect(countActiveFilters(neutral)).toBe(0);
  });
});

/**
 * sk-285.2.6 — «Project focus», the board's project subset.
 *
 * The control itself is one more dropdown in this panel, so it gets the
 * same tests the others do. What is specific to it is the relationship
 * with the Projects column: an open project PAUSES the focus, and both
 * the control and the panel's badge have to reflect that — a setting
 * that is switched on but doing nothing must not be advertised as if it
 * were filtering.
 */
describe('TaskFilters — project focus (board only)', () => {
  const OPTIONS = [
    { id: 'uuid-mob', handle: 'mob', name: 'Mobile app' },
    { id: 'uuid-pay', handle: 'pay', name: 'Payments' },
    { id: 'uuid-shop', handle: 'shop', name: 'Storefront' },
  ];
  const board = (over: Partial<TaskFiltersProps> = {}) =>
    renderFilters({
      view: 'kanban',
      projectFocus: new Set<string>(),
      onProjectFocusChange: vi.fn(),
      projectFocusOptions: OPTIONS,
      ...over,
    });
  const input = () => screen.getByRole('textbox', { name: 'Project focus' });

  test('rendered only while the board is the view', () => {
    board({ view: 'cards' });
    expect(screen.queryByRole('textbox', { name: 'Project focus' })).toBeNull();
    cleanup();
    board();
    expect(input()).toBeTruthy();
  });

  test('picking a project hands back the whole new set', () => {
    const props = board();
    fireEvent.click(input());
    fireEvent.click(screen.getByRole('option', { name: /^pay/ }));
    const next = (props.onProjectFocusChange as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as Set<string>;
    expect([...next]).toEqual(['uuid-pay']);
  });

  test('the picked projects are legible without opening it', () => {
    board({ projectFocus: new Set(['uuid-mob', 'uuid-pay']) });
    const field = input().closest('.task-filter-select') as HTMLElement;
    expect(field.textContent).toContain('mob');
    expect(field.textContent).toContain('pay');
  });

  test('an applied focus shows on the collapsed panel badge', () => {
    board({ projectFocus: new Set(['uuid-mob']), collapsed: true });
    expect(
      screen.getByRole('button', { name: /Show filters.*1/ }),
    ).toBeTruthy();
  });

  test('a PAUSED focus is not counted, and the control says why', () => {
    board({
      projectFocus: new Set(['uuid-mob']),
      projectFocusPausedBy: 'shop',
    });
    // The badge stays at zero — nothing is being narrowed.
    expect(
      screen.getByRole('button', { name: /Hide filters, no active filters/i }),
    ).toBeTruthy();
    const field = input().closest('.task-filter-select') as HTMLElement;
    expect(field.textContent).toContain('shop');
  });
});

/* ────── sk-303.14 (T025) — the unreviewed selection on the status axis ──────
 *
 * The incoming side wrote these six against the pre-redesign panel: a
 * `role="group"` named «Status filter» holding toggle buttons that report
 * with `aria-pressed`, and a chip labelled `'👁 Непросмотренные'`. None of
 * those three survive here — the panel draws a dimension as a combobox
 * (the app default) or as a radio row (`aria-checked`, because exactly one
 * option is always true), and its labels come from the dictionary.
 *
 * So the queries are retargeted and every assertion keeps its meaning. One
 * is ADDED rather than translated: the incoming panel had a single body, so
 * "it is offered" was one question. Here it is two, and a selection
 * reachable in one body and not the other is exactly the partial toggle the
 * shell forbids — so both are asked.
 */
describe('TaskFilters — the unreviewed selection', () => {
  const statusSelect = () =>
    screen.getByRole('textbox', { name: 'Status' }) as HTMLInputElement;
  const NAME = /^Unreviewed/;

  test('is absent by default — the set exists only on the Delegated surface', () => {
    // Offering it elsewhere would promise a narrowing the endpoint under
    // that surface cannot perform.
    renderFilters();
    fireEvent.click(statusSelect());
    expect(screen.queryByRole('option', { name: NAME })).toBeNull();
  });

  test('is offered under the Delegated lens', () => {
    renderFilters({ showUnreviewedChip: true });
    fireEvent.click(statusSelect());
    expect(screen.getByRole('option', { name: NAME })).toBeTruthy();
  });

  test('sits on the status axis — it is an option of Status, not a control of its own', () => {
    renderFilters({ showUnreviewedChip: true });
    // No fourth dimension appeared beside Status / Priority / Type / Source.
    expect(screen.queryByRole('textbox', { name: /Unreviewed/ })).toBeNull();
    fireEvent.click(statusSelect());
    const list = screen.getByRole('listbox', { name: 'Status' });
    expect(
      within(list).getByRole('option', { name: NAME }),
    ).toBeTruthy();
  });

  test('picking it reports the sentinel through the same status handler', () => {
    // One handler, one axis: that is what lets picking any other status
    // option drop the selection without a second coordination path.
    const props = renderFilters({ showUnreviewedChip: true });
    fireEvent.click(statusSelect());
    fireEvent.click(screen.getByRole('option', { name: NAME }));
    expect(props.onStatusChange).toHaveBeenCalledWith('unreviewed');
  });

  test('the select displays it while the selection is applied', () => {
    renderFilters({ showUnreviewedChip: true, statusFilter: 'unreviewed' });
    expect(statusSelect().value).toBe('Unreviewed');
  });

  test('an ordinary status displays itself instead', () => {
    renderFilters({ showUnreviewedChip: true, statusFilter: 'active' });
    expect(statusSelect().value).toBe('Active');
  });

  test('the chip body offers it too, and exactly one chip on the axis reads checked', () => {
    // The other panel body. Mutual exclusion is visible here, not merely
    // intended: the selection and the ordinary statuses share one axis, so
    // exactly one chip in the row can be checked.
    renderFilters({
      filtersLayout: 'chips',
      showUnreviewedChip: true,
      statusFilter: 'unreviewed',
    });
    const row = screen.getByRole('radiogroup', { name: 'Status' });
    const checked = within(row)
      .getAllByRole('radio')
      .filter((el) => el.getAttribute('aria-checked') === 'true')
      .map((el) => el.textContent);
    expect(checked).toEqual(['Unreviewed']);
  });

  test('the chip body reports the sentinel through the same handler', () => {
    const props = renderFilters({ filtersLayout: 'chips', showUnreviewedChip: true });
    const row = screen.getByRole('radiogroup', { name: 'Status' });
    fireEvent.click(within(row).getByRole('radio', { name: NAME }));
    expect(props.onStatusChange).toHaveBeenCalledWith('unreviewed');
  });
});

/**
 * sk-285.2.5 — «Card properties», the board's display-properties picker.
 *
 * It lives in this panel, next to «Columns», rather than behind a menu
 * on the board: this is already the place every "how do I want to look
 * at these tasks" control sits. So the tests it needs are the ones every
 * other control here has — it appears with the body it configures, it
 * reports the current selection without being opened, and clicking a row
 * writes the whole new set.
 */


describe('TaskFilters — sk-401 «Search everywhere» exit', () => {
  // The exit is a router <Link>, so this block mounts under a router; the
  // rest of the file never renders it (no active non-empty search), and a
  // stray render there would throw outside a router rather than pass.
  function renderWithRouter(over: Partial<TaskFiltersProps> = {}) {
    const props = makeProps(over);
    render(
      <MantineProvider forceColorScheme="dark">
        <MemoryRouter>
          <TaskFilters {...props} />
        </MemoryRouter>
      </MantineProvider>,
    );
    return props;
  }
  const exit = () => screen.queryByRole('link', { name: /Search everywhere/ });

  test('carries the trimmed query to /search, URL-encoded', () => {
    renderWithRouter({ searchActive: true, search: '  a&b ё ' });
    expect(exit()?.getAttribute('href')).toBe('/search?q=a%26b%20%D1%91');
  });

  test('accessible name starts with the visible text (WCAG 2.5.3)', () => {
    renderWithRouter({ searchActive: true, search: 'ring' });
    const link = exit()!;
    const visible = link.textContent!.trim();
    expect(visible).toBe('Search everywhere');
    expect(link.getAttribute('aria-label')!.startsWith(visible)).toBe(true);
    expect(link.getAttribute('aria-label')).toContain('ring');
  });

  test('absent when search is inactive, blank, or a blob paste', () => {
    renderWithRouter({ searchActive: false, search: 'ring' });
    expect(exit()).toBeNull();
    cleanup();
    renderWithRouter({ searchActive: true, search: '   ' });
    expect(exit()).toBeNull();
    cleanup();
    renderWithRouter({ searchActive: true, search: 'ring', blobActive: true });
    expect(exit()).toBeNull();
  });
});
