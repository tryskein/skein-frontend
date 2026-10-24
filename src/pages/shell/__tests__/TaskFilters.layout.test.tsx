/**
 * sk-285.7 T025 — the filter panel has two layouts over ONE set of
 * filters.
 *
 * Coverage matrix rows 37 and 38:
 *   37 — US-5: "switching the panel mode does not change a single value
 *        of the filter"
 *   38 — FR-002: "the panel mode choice survives a remount"
 *
 * ── How row 37 is made to mean something ─────────────────────────────
 *
 * "Nothing changed" is the shape of claim that passes vacuously by
 * default: a panel that rendered no controls at all would also change
 * nothing. Three independent statements therefore stand behind it, and
 * only the three together rule out the vacuous reading:
 *
 *   1. NO SETTER RAN. Every `on…Change` handler the panel is given is
 *      silent across the switch. The list of them is DERIVED from the
 *      props object — `Object.keys(props).filter(isFilterSetter)` — and
 *      not typed out here, so a seventh dimension added to
 *      `TaskFiltersProps` tomorrow is covered by this test the day it
 *      lands, with no edit. That derivation is the whole point: a
 *      hand-written list of six names would keep passing while the
 *      seventh leaked.
 *
 *      ⚠ And it had a hole of exactly that shape, one level down. The
 *      object is `makeProps(): TaskFiltersProps`, and that annotation
 *      only obliges TypeScript to supply the REQUIRED members — an
 *      OPTIONAL dimension left out of the fixture is legal, absent from
 *      `Object.keys`, and therefore absent from the derived list. Two
 *      were: `onProjectFocusChange` and `onTreeDepTypesChange`. Measured
 *      rather than reasoned: a `TaskFilters` that resets the dep-type
 *      lens on every layout switch left this file 20/20 GREEN. Both are
 *      now in the fixture with non-default values.
 *
 *      Both of those dimensions are mounted by the VIEW, not by the
 *      layout — the lens only in `tree`, the focus only in `kanban` —
 *      so the switch is exercised in all three views. A control that
 *      never mounted also never fires, which would have been the next
 *      vacuous reading along.
 *   2. THE VALUES ARE STILL DRAWN. After the switch the chip row of
 *      every dimension reports its non-default value as the CHECKED
 *      chip, and after switching back the comboboxes read exactly the
 *      strings they read before. A panel that quietly rendered nothing
 *      fails here.
 *   3. THE SWITCH ITSELF WORKED. The two bodies are asserted to be
 *      distinguishable (the chip row exists in one and not the other),
 *      so "nothing changed" cannot be satisfied by a switch that never
 *      switched.
 *
 * The fixture deliberately holds a NON-DEFAULT value in every dimension.
 * A panel that reset a filter to its default on switch would be invisible
 * to a fixture that already sat on the defaults.
 *
 * Row 38 is pinned against the provider over real localStorage, and it
 * enumerates `FILTERS_LAYOUT_VALUES` rather than naming the two modes —
 * so a third layout added to `lib/filtersLayout.ts` is persistence-tested
 * the day it is added.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

import { TaskFilters, type TaskFiltersProps } from '../TaskFilters';
import type { DepType } from '../../../api/dependencies';
import {
  FILTERS_LAYOUT_DEFAULT,
  FILTERS_LAYOUT_VALUES,
  type FiltersLayout,
} from '../../../lib/filtersLayout';
import {
  TasksUiStateProvider,
  useTasksUiState,
} from '../../../lib/useTasksUiState';

// ───────────────────────────── fixture ─────────────────────────────

/**
 * Every dimension away from its default, so a reset-on-switch has
 * somewhere to show.
 */
function makeProps(over: Partial<TaskFiltersProps> = {}): TaskFiltersProps {
  return {
    search: '',
    onSearchChange: vi.fn(),
    statusFilter: 'open',
    onStatusChange: vi.fn(),
    originFilter: 'human-driven',
    onOriginChange: vi.fn(),
    typeFilter: 'bug',
    onTypeChange: vi.fn(),
    priorityFilter: '1',
    onPriorityChange: vi.fn(),
    view: 'cards',
    sort: 'updated',
    onSortChange: vi.fn(),
    showAssigneeRow: true,
    assigneeOptions: [
      { username: 'alice', label: 'Alice', userId: 'u-1' },
      { username: 'bob', label: 'Bob', userId: 'u-2' },
    ],
    assigneeFilter: 'alice',
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
    // ── The OPTIONAL dimensions ──────────────────────────────────────
    //
    // Supplied here for the reason the whole fixture exists: statement 1
    // derives the setter list from this object, and TypeScript only
    // makes it complete for the REQUIRED half. Two dimensions
    // (`onProjectFocusChange`, `onTreeDepTypesChange`) had been optional
    // since they were added, were absent here, and so were silently
    // absent from the derivation — the panel could have reset either on
    // a layout switch and row 37 would still have been green. They are
    // now in the fixture.
    //
    // Their VALUES are non-default like every other dimension: a
    // non-empty focus set and a dep-type set beyond the mandatory
    // `parent-child`, so a reset has somewhere to show.
    projectFocus: new Set(['skein']),
    onProjectFocusChange: vi.fn(),
    projectFocusOptions: [
      { id: 'p-1', handle: 'skein', name: 'Skein' },
      { id: 'p-2', handle: 'web', name: 'Web' },
    ],
    projectFocusPausedBy: null,
    treeDepTypes: new Set<DepType>(['parent-child', 'blocks']),
    onTreeDepTypesChange: vi.fn(),
    onSearchSortChange: vi.fn(),
    onAssigneeSearchChange: vi.fn(),
    ...over,
  };
}

/**
 * A panel that owns its own layout, so clicking the switch really
 * re-renders the other body — the app wires exactly this, through
 * `useTasksUiState`.
 */
function renderPanel(over: Partial<TaskFiltersProps> = {}) {
  const props = makeProps(over);
  let layout: FiltersLayout = props.filtersLayout;
  const view = render(
    <MantineProvider forceColorScheme="dark">
      <TaskFilters {...props} />
    </MantineProvider>,
  );
  const rerender = (next: FiltersLayout) => {
    layout = next;
    view.rerender(
      <MantineProvider forceColorScheme="dark">
        <TaskFilters {...props} filtersLayout={layout} />
      </MantineProvider>,
    );
  };
  return { props, rerender };
}

/**
 * The setters row 37 watches, read off the props object rather than
 * listed. `onSearchChange` / `onSearchPaste` are excluded by name and
 * on purpose: the search box is not part of either body and the switch
 * cannot reach it — including it would test the fixture, not the panel.
 */
const NON_FILTER_HANDLERS = new Set([
  'onSearchChange',
  'onSearchPaste',
  'onFiltersLayoutChange',
  'onToggleCollapsed',
  'onWithinFiltersToggle',
  'onAllProjectsToggle',
  'onAssigneeSearchChange',
]);

function filterSetterNames(props: TaskFiltersProps): string[] {
  return Object.keys(props).filter(
    (k) =>
      k.startsWith('on') &&
      !NON_FILTER_HANDLERS.has(k) &&
      typeof (props as unknown as Record<string, unknown>)[k] === 'function',
  );
}

afterEach(() => cleanup());

// ───────────────────── row 37 — values survive ─────────────────────

describe('sk-285.7 T025 / row 37 — switching layout moves no filter', () => {
  test('the fixture really does hand the panel every filter setter', () => {
    // Guards statement 1 against its own failure mode: a derivation that
    // silently found nothing would make the assertions below vacuous.
    const names = filterSetterNames(makeProps());
    expect(names).toEqual(
      expect.arrayContaining([
        'onStatusChange',
        'onPriorityChange',
        'onTypeChange',
        'onOriginChange',
        'onAssigneeChange',
        'onSortChange',
        'onProjectFocusChange',
        'onTreeDepTypesChange',
      ]),
    );
  });

  /**
   * The switch is exercised in every view, because two of the panel's
   * dimensions are mounted by the VIEW rather than by the layout: the
   * dep-type lens only exists in `tree`, the project focus only in
   * `kanban`. Handing the panel their setters is what puts them in the
   * derived list; rendering the view they belong to is what makes the
   * "did not fire" claim about a control that was actually on screen.
   */
  test.each(['cards', 'tree', 'kanban'] as const)(
    'no filter setter is called when the layout switches (%s view)',
    (view) => {
      const { props, rerender } = renderPanel({ view });
      const names = filterSetterNames(props);

      fireEvent.click(screen.getByLabelText('Panel layout: quick list'));
      expect(props.onFiltersLayoutChange).toHaveBeenCalledWith('chips');
      rerender('chips');

      fireEvent.click(screen.getByLabelText('Panel layout: comboboxes'));
      expect(props.onFiltersLayoutChange).toHaveBeenCalledWith('select');
      rerender('select');

      for (const name of names) {
        const spy = (props as unknown as Record<string, ReturnType<typeof vi.fn>>)[name];
        expect(spy, `${name} must not fire on a layout switch in ${view}`).not.toHaveBeenCalled();
      }
    },
  );

  test('the view-mounted dimensions really are on screen in their own view', () => {
    // Otherwise the two rows added to the parametrised test above prove
    // nothing: a control that never mounted also never fires.
    cleanup();
    renderPanel({ view: 'tree' });
    expect(screen.getByLabelText('Tree edges', { selector: 'input' })).toBeTruthy();
    cleanup();
    renderPanel({ view: 'kanban' });
    expect(screen.getByLabelText('Project focus', { selector: 'input' })).toBeTruthy();
  });

  test('the two bodies are actually different, and each draws the values', () => {
    const { rerender } = renderPanel();

    // Mode A: the comboboxes carry the picked labels.
    const before = ['Status', 'Priority', 'Type', 'Source', 'Sort by'].map(
      (label) =>
        (screen.getByLabelText(label, { selector: 'input' }) as HTMLInputElement)
          .value,
    );
    expect(before).toEqual(['Open', 'P1', 'bug', 'From a human', 'Updated']);
    expect(document.querySelector('.task-filters-chip-rows')).toBeNull();

    rerender('chips');

    // Mode B: a chip row per dimension, the picked one checked.
    expect(document.querySelector('.task-filters-chip-rows')).toBeTruthy();
    const checked = (group: string) => {
      const row = screen.getByRole('radiogroup', { name: group });
      return within(row)
        .getAllByRole('radio')
        .filter((el) => el.getAttribute('aria-checked') === 'true')
        .map((el) => el.textContent);
    };
    expect(checked('Status')).toEqual(['Open']);
    expect(checked('Priority')).toEqual(['P1']);
    expect(checked('Type')).toEqual(['bug']);
    expect(checked('Source')).toEqual(['From a human']);
    expect(checked('Sort by')).toEqual(['Updated']);
    // The avatar contributes its own initials to the chip's text, so
    // this one is a containment check rather than an equality one.
    expect(checked('Assignee')).toHaveLength(1);
    expect(checked('Assignee')[0]).toContain('Alice');

    rerender('select');

    // …and back: byte-identical to what mode A read the first time.
    const after = ['Status', 'Priority', 'Type', 'Source', 'Sort by'].map(
      (label) =>
        (screen.getByLabelText(label, { selector: 'input' }) as HTMLInputElement)
          .value,
    );
    expect(after).toEqual(before);
  });

  test('a chip actually drives its own dimension (the row is not decorative)', () => {
    // The negative statements above only bind a panel whose chips CAN
    // change something. This is the positive control for them.
    const { props } = renderPanel({ filtersLayout: 'chips' });
    const row = screen.getByRole('radiogroup', { name: 'Type' });
    fireEvent.click(within(row).getByText('epic'));
    expect(props.onTypeChange).toHaveBeenCalledWith('epic');
  });
});

// ────────────────────── negative / edge cases ──────────────────────

describe('sk-285.7 T025 — the quick list under narrow inputs', () => {
  test('no assignee options: the row still offers "anyone", and it is checked', () => {
    renderPanel({
      filtersLayout: 'chips',
      assigneeOptions: [],
      assigneeFilter: null,
    });
    const row = screen.getByRole('radiogroup', { name: 'Assignee' });
    const chips = within(row).getAllByRole('radio');
    expect(chips).toHaveLength(1);
    expect(chips[0].getAttribute('aria-checked')).toBe('true');
  });

  test('an assignee outside the option list still shows as picked', () => {
    // A filter that IS applied can never read as "anyone".
    renderPanel({
      filtersLayout: 'chips',
      assigneeOptions: [{ username: 'bob', label: 'Bob', userId: 'u-2' }],
      assigneeFilter: 'carol',
    });
    const row = screen.getByRole('radiogroup', { name: 'Assignee' });
    const checked = within(row)
      .getAllByRole('radio')
      .filter((el) => el.getAttribute('aria-checked') === 'true');
    expect(checked).toHaveLength(1);
    expect(checked[0].textContent).toContain('carol');
  });

  test('with the directory wired, the assignee combobox survives into mode B', () => {
    // Chips can only enumerate a domain they can hold; the org directory
    // is not one. Dropping the control would put people out of reach.
    renderPanel({
      filtersLayout: 'chips',
      assigneeSearchEnabled: true,
      assigneeSearchValue: '',
      onAssigneeSearchChange: vi.fn(),
      assigneeSearchResults: [],
      assigneeSearchLoading: false,
      assigneeSearchHasMore: false,
    });
    expect(screen.getByLabelText('Assignee', { selector: 'input' })).toBeTruthy();
    expect(screen.queryByRole('radiogroup', { name: 'Assignee' })).toBeNull();
  });

  test('an inert row (unfiltered search) refuses the click but keeps focus', () => {
    const { props } = renderPanel({ filtersLayout: 'chips', filtersEnabled: false });
    const row = screen.getByRole('radiogroup', { name: 'Status' });
    const chip = within(row).getByText('Done');
    expect(chip.getAttribute('aria-disabled')).toBe('true');
    // aria-disabled, not the native attribute — the chip stays reachable.
    expect((chip as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(chip);
    expect(props.onStatusChange).not.toHaveBeenCalled();
  });

  test('the panel head states the shared-panel rule in both bodies', () => {
    for (const layout of FILTERS_LAYOUT_VALUES) {
      cleanup();
      renderPanel({ filtersLayout: layout });
      expect(
        screen.getByText('Filters apply to Cards, Tree and Board alike'),
      ).toBeTruthy();
    }
  });
});

// ────────────────── row 38 — the choice is durable ──────────────────

/** Reads the provider's layout out and offers the setter. */
function LayoutProbe() {
  const ui = useTasksUiState();
  return (
    <div>
      <span data-testid="layout">{ui.filtersLayout}</span>
      {FILTERS_LAYOUT_VALUES.map((l) => (
        <button key={l} data-testid={`set-${l}`} onClick={() => ui.setFiltersLayout(l)}>
          {l}
        </button>
      ))}
    </div>
  );
}

const STORAGE_KEY = 'skein.tasks.filtersLayout';

describe('sk-285.7 T025 / row 38 — the layout survives a remount', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => window.localStorage.clear());

  test('a fresh provider opens on the documented default', () => {
    render(<TasksUiStateProvider><LayoutProbe /></TasksUiStateProvider>);
    expect(screen.getByTestId('layout').textContent).toBe(FILTERS_LAYOUT_DEFAULT);
  });

  // Enumerated, not named: a third layout added to `filtersLayout.ts`
  // gets this test for free.
  for (const layout of FILTERS_LAYOUT_VALUES) {
    test(`«${layout}» is written through and read back after a remount`, () => {
      const first = render(
        <TasksUiStateProvider><LayoutProbe /></TasksUiStateProvider>,
      );
      act(() => {
        fireEvent.click(screen.getByTestId(`set-${layout}`));
      });
      expect(screen.getByTestId('layout').textContent).toBe(layout);
      expect(window.localStorage.getItem(STORAGE_KEY)).toBe(layout);

      first.unmount();

      render(<TasksUiStateProvider><LayoutProbe /></TasksUiStateProvider>);
      expect(screen.getByTestId('layout').textContent).toBe(layout);
    });
  }

  test('a value this build cannot read falls back to the default', () => {
    // Not an empty-set preference like `treeColumns`: a layout has no
    // "deliberately nothing", so a damaged value and a missing one mean
    // the same thing.
    window.localStorage.setItem(STORAGE_KEY, 'accordion');
    render(<TasksUiStateProvider><LayoutProbe /></TasksUiStateProvider>);
    expect(screen.getByTestId('layout').textContent).toBe(FILTERS_LAYOUT_DEFAULT);
  });
});

