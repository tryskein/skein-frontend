/**
 * sk-285.7.2.71 — the filter panel's last two multi-selects join the
 * one picker, so the app stops holding two vocabularies for one widget.
 *
 * ── The finding, measured ───────────────────────────────────────────
 *
 * sk-285.7.2.70 (audit R-9) recomposed the three View-settings pickers
 * out of `Combobox` + `PillsInput` + `Pill`, because `MultiSelect`
 * renders its own pills and forwards nothing per pill — so every remove
 * button took the theme's factory `CloseButton` label. That pass was
 * scoped to the popover the audit counted, and left the filter panel's
 * dep-type and project-focus controls behind. Read off the running app
 * at 1440, transitions killed, with values actually picked:
 *
 *   before, BOTH controls, BOTH bases
 *     composition   MultiSelect
 *     pill ✕        aria-label="Close", aria-hidden="true", tabIndex -1
 *     focus reset   `mantine-InputClearButton-root`, and the SAME
 *                   aria-label="Close", aria-hidden="true", tabIndex -1
 *
 *   after
 *     composition   Combobox + PillsInput + Pill
 *     pill ✕        "Remove blocks" / "Remove related" / "Remove infra"
 *                   / "Remove shop", aria-hidden="false", tabIndex 0
 *     focus reset   "Clear project focus", tabIndex 0
 *
 * The pills' geometry and colour did NOT move (76×18 / 61×18 / 65×18 /
 * 53×18, `rgb(241,243,245)` light and `rgb(20,18,16)` dark, both before
 * and after), which is the answer to the risk the task named: the
 * recomposition changed the SEMANTICS and not the drawing. That grey is
 * Mantine's own and is a separate, pre-existing deviation — §6's chip
 * recipe is scoped to `.header-viewsettings-panel` on purpose, as its
 * own docblock says.
 *
 * ── Why the assertions are a render, not a source scan ──────────────
 *
 * Every claim here is about an attribute Mantine writes at render time
 * onto a node it owns (`aria-hidden` and `tabIndex` on a pill's remove
 * button are set by `Pill`, not by the call site), so the only place
 * the answer exists is a mounted tree. `TaskFilters.test.tsx` already
 * covers what each control DOES; this file covers what both controls
 * ARE, which is the thing that was allowed to diverge.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

import { skeinTheme } from '../../../theme';
import {
  CardFieldsSelect,
  ListCardFieldsSelect,
  TaskFilters,
  TreeColumnsSelect,
  type TaskFiltersProps,
} from '../TaskFilters';
import type { DepType } from '../../../api/dependencies';
import { KANBAN_DEFAULT_CARD_FIELDS, type KanbanCardField } from '../../../lib/kanbanCardFields';
import { LIST_DEFAULT_CARD_FIELDS, type ListCardField } from '../../../lib/listCardFields';
import { TREE_DEFAULT_COLUMNS, type TreeOptionalColumn } from '../../../lib/treeColumns';
import { en } from '../../../i18n/locales/en';
import { ru } from '../../../i18n/locales/ru';

function baseProps(over: Partial<TaskFiltersProps> = {}): TaskFiltersProps {
  return {
    search: '',
    onSearchChange: vi.fn(),
    assigneeFilter: 'all',
    onAssigneeChange: vi.fn(),
    assigneeOptions: [],
    statusFilter: 'all',
    onStatusChange: vi.fn(),
    priorityFilter: 'all',
    onPriorityChange: vi.fn(),
    typeFilter: 'all',
    onTypeChange: vi.fn(),
    originFilter: 'all',
    onOriginChange: vi.fn(),
    sort: 'updated_desc',
    onSortChange: vi.fn(),
    view: 'tree',
    ...over,
  } as unknown as TaskFiltersProps;
}

function renderFilters(over: Partial<TaskFiltersProps> = {}) {
  const props = baseProps(over);
  render(
    <MantineProvider theme={skeinTheme} forceColorScheme="light">
      <TaskFilters {...props} />
    </MantineProvider>,
  );
  return props;
}

/** The control's root, found through the field the label names. */
function control(name: string): HTMLElement {
  const field = screen.getByRole('textbox', { name });
  const root = field.closest('.task-filter-select');
  expect(root, `no .task-filter-select around «${name}»`).not.toBeNull();
  return root as HTMLElement;
}

/** Every pill of a control, as {label, remove button}. */
function pills(root: HTMLElement) {
  return [...root.querySelectorAll('.mantine-Pill-root')].map((p) => ({
    label: (p.querySelector('.mantine-Pill-label')?.textContent ?? '').trim(),
    remove: p.querySelector('.mantine-Pill-remove') as HTMLButtonElement | null,
  }));
}

const DEPS = () =>
  renderFilters({
    view: 'tree',
    treeDepTypes: new Set<DepType>(['parent-child', 'blocks', 'related']),
    onTreeDepTypesChange: vi.fn(),
  });

const FOCUS_OPTIONS = [
  { id: 'uuid-shop', handle: 'shop', name: 'Storefront' },
  { id: 'uuid-infra', handle: 'infra', name: 'Infrastructure' },
  { id: 'uuid-pay', handle: 'pay', name: 'Payments' },
];

const FOCUS = (over: Partial<TaskFiltersProps> = {}) =>
  renderFilters({
    view: 'kanban',
    projectFocus: new Set(['uuid-shop', 'uuid-infra']),
    onProjectFocusChange: vi.fn(),
    projectFocusOptions: FOCUS_OPTIONS,
    ...over,
  });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/**
 * The three pickers the panel draws besides the two above.
 *
 * sk-387 — its acceptance asked for the pill measurement (name,
 * `aria-hidden`, `tabIndex`) on three LEGACY surfaces that still drew a
 * raw `MultiSelect`. sk-303.15 deleted all three with the `/legacy/*`
 * tree, so that measurement has no subject. What DOES have one is the
 * same measurement on the surfaces that exist: five call sites, of which
 * exactly two were covered here. The other three were the ones the
 * scan's own comment calls «the panel's five call sites» — and an
 * uncovered picker is where the factory «Close» would come back without
 * anything going red.
 */
function withTheme(node: React.ReactNode) {
  render(
    <MantineProvider theme={skeinTheme} forceColorScheme="light">
      {node}
    </MantineProvider>,
  );
}

const TREE_COLUMNS = () =>
  withTheme(
    <TreeColumnsSelect
      value={new Set<TreeOptionalColumn>(TREE_DEFAULT_COLUMNS)}
      onChange={vi.fn()}
    />,
  );

const LIST_CARD_FIELDS = () =>
  withTheme(
    <ListCardFieldsSelect
      value={new Set<ListCardField>(LIST_DEFAULT_CARD_FIELDS)}
      onChange={vi.fn()}
    />,
  );

const KANBAN_CARD_FIELDS_PICKER = () =>
  withTheme(
    <CardFieldsSelect
      axis="status"
      value={new Set<KanbanCardField>(KANBAN_DEFAULT_CARD_FIELDS)}
      onChange={vi.fn()}
    />,
  );

describe('sk-285.7.2.71 — every removable pill names its value and takes a tab stop', () => {
  test.each([
    ['Tree edges', DEPS],
    ['Project focus', FOCUS],
    // sk-387 — the remaining three of the panel's five pickers. The
    // names are the dictionary's own labels, read from `en` rather than
    // typed here: a label renamed out from under this list would read as
    // «control missing» instead of as «not checked».
    [en.filters.labels.treeColumns, TREE_COLUMNS],
    [en.filters.labels.listCardFields, LIST_CARD_FIELDS],
    [en.filters.labels.kanbanCardFields, KANBAN_CARD_FIELDS_PICKER],
  ])('%s', (name, mount) => {
    mount();
    const rows = pills(control(name as string)).filter((p) => p.remove !== null);
    // Tripwire: a control with no removable pill would pass the loop
    // below vacuously.
    expect(rows.length).toBeGreaterThan(0);
    for (const { label, remove } of rows) {
      expect(remove!.getAttribute('aria-label'), label).toBe(`Remove ${label}`);
      // The two halves Mantine's default gets wrong, measured live
      // before this change as aria-hidden="true" / tabIndex -1.
      expect(remove!.getAttribute('aria-hidden'), label).toBe('false');
      expect(remove!.tabIndex, label).toBe(0);
    }
    // …and every name is different, which is the whole point: ten
    // buttons called «Close» is what R-9 counted.
    const names = rows.map((r) => r.remove!.getAttribute('aria-label'));
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('sk-285.7.2.71 — `locked` is not `disabled`, and the difference is load-bearing', () => {
  test('the tree spine has no remove button and refuses the toggle', () => {
    const props = DEPS();
    const root = control('Tree edges');
    const spine = pills(root).find((p) => p.label === 'parent-child');
    expect(spine, 'the spine is not among the pills').toBeDefined();
    expect(spine!.remove, 'the spine can be dropped from a chip').toBeNull();

    // And the dropdown row is inert.
    fireEvent.click(screen.getByRole('textbox', { name: 'Tree edges' }));
    fireEvent.click(screen.getByRole('option', { name: /^parent-child/ }));
    expect(props.onTreeDepTypesChange).not.toHaveBeenCalled();
  });

  test('a merely DISABLED option keeps its remove button — the board’s card fields', () => {
    // The regression this flag exists to avoid. The board's card-field
    // picker disables the row the current axis already states, and its
    // chip has always been removable; folding `locked` into `disabled`
    // would have taken that away silently, in a control this task was
    // not supposed to touch.
    render(
      <MantineProvider theme={skeinTheme} forceColorScheme="light">
        <CardFieldsSelect
          axis="status"
          value={new Set<KanbanCardField>(KANBAN_DEFAULT_CARD_FIELDS)}
          onChange={vi.fn()}
        />
      </MantineProvider>,
    );
    const buttons = document.querySelectorAll('.mantine-Pill-remove');
    expect(buttons.length).toBe(new Set(KANBAN_DEFAULT_CARD_FIELDS).size);
  });
});

describe('sk-285.7.2.71 — the two capabilities the move required', () => {
  test('the focus control is searchable, and narrowing really narrows', () => {
    FOCUS({ projectFocus: new Set<string>() });
    const field = screen.getByRole('textbox', { name: 'Project focus' }) as HTMLInputElement;
    // Not read-only: it IS the search box (the dep-type field still is
    // read-only, which the next test pins).
    expect(field.readOnly).toBe(false);
    const rows = () => [...document.querySelectorAll('[role="option"]')].map((o) => o.textContent);
    expect(rows().length).toBe(FOCUS_OPTIONS.length);

    fireEvent.change(field, { target: { value: 'inf' } });
    const narrowed = rows();
    expect(narrowed.length).toBe(1);
    expect(narrowed[0]).toContain('infra');

    fireEvent.change(field, { target: { value: 'zzz' } });
    expect(rows()).toHaveLength(0);
    expect(screen.getByText(en.filters.projectFocus.nothingFound)).toBeTruthy();
  });

  test('the dep-type control is NOT searchable — the capability is opt-in', () => {
    DEPS();
    const field = screen.getByRole('textbox', { name: 'Tree edges' }) as HTMLInputElement;
    expect(field.readOnly).toBe(true);
  });

  test('the reset is named for what it resets, not «Close»', () => {
    const props = FOCUS();
    const root = control('Project focus');
    const clear = [...root.querySelectorAll('button')].find(
      (b) => !b.closest('.mantine-Pill-root'),
    );
    expect(clear, 'no reset rendered beside a non-empty focus').toBeDefined();
    // Measured live before this change on the same control:
    // `mantine-InputClearButton-root`, aria-label="Close",
    // aria-hidden="true", tabIndex -1.
    expect(clear!.getAttribute('aria-label')).toBe(en.filters.projectFocus.clear);
    expect(clear!.getAttribute('aria-label')).not.toBe('Close');
    expect(clear!.tabIndex).toBe(0);

    fireEvent.click(clear!);
    expect(props.onProjectFocusChange).toHaveBeenCalledTimes(1);
    const next = (props.onProjectFocusChange as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as Set<string>;
    expect(next.size).toBe(0);
  });

  test('and there is no reset to mis-name when nothing is picked', () => {
    FOCUS({ projectFocus: new Set<string>() });
    const root = control('Project focus');
    expect([...root.querySelectorAll('button')].filter((b) => !b.closest('.mantine-Pill-root'))).toEqual(
      [],
    );
  });
});

describe('sk-285.7.2.71 — the reset’s wording exists in both dictionaries', () => {
  test('en and ru both name it, and neither says «Close»', () => {
    for (const [lang, dict] of [
      ['en', en],
      ['ru', ru],
    ] as const) {
      const value = dict.filters.projectFocus.clear;
      expect(typeof value, lang).toBe('string');
      expect(value.trim().length, lang).toBeGreaterThan(0);
      expect(value, lang).not.toBe('Close');
    }
  });
});
