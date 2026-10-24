import { useMemo, useState, type ClipboardEvent, type Ref } from 'react';
import { Loader, Select, TextInput } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { TFunction } from 'i18next';
import {
  IconChevronDown,
  IconFilter,
  IconForms,
  IconArrowUpRight,
  IconListDetails,
  IconSearch,
  IconWorld,
  IconX,
} from '@tabler/icons-react';
import type {
  OriginFilter,
  PriorityFilter,
  StatusFilter,
  TasksSortKey,
  TypeFilter,
  ViewMode,
} from '../../api/issues';
import type { DepType } from '../../api/dependencies';
import {
  KANBAN_AXES,
  type KanbanAxis,
} from '../../lib/kanbanBoard';
import {
  KANBAN_AXIS_SUPPRESSED,
  KANBAN_CARD_FIELDS,
  type KanbanCardField,
} from '../../lib/kanbanCardFields';
import {
  LIST_CARD_FIELDS,
  type ListCardField,
  type ListCardFieldSet,
} from '../../lib/listCardFields';
import type { ProjectFocus } from '../../lib/kanbanProjectFocus';
import { useRadioGroupKeys } from '../../lib/useRadioGroupKeys';
import {
  TREE_OPTIONAL_COLUMNS,
  type TreeColumnSet,
  type TreeOptionalColumn,
} from '../../lib/treeColumns';
import {
  FILTERS_LAYOUT_VALUES,
  type FiltersLayout,
} from '../../lib/filtersLayout';
import { AttributePicker, COMBOBOX_PROPS, OptionBody } from '../../components/AttributePicker';
import { SkeinTooltip } from '../../components/SkeinTooltip';
import { Avatar } from '../../components/Avatar';
import { priorityFill, statusFill, typeFill } from '../../components/Attribute';

/**
 * sk-79 — one selectable assignee in the assignee dropdown. `username`
 * is the wire value passed back to `onAssigneeChange` (the backend filters
 * `assignee=<username>`); `label` is the display text (name, falling back to
 * username); `isMe` floats the caller's own entry first and labels it "me".
 */
export interface AssigneeOption {
  username: string;
  userId?: string | null;
  label: string;
  isMe?: boolean;
}

/**
 * sk-285.1.18 — how many assignee options the dropdown renders at once.
 * The cross-project lens hands this component the whole org directory
 * ,
 * so the list is capped and narrowed by typing instead of rendered whole.
 */
/** Stable identity so an absent result set never re-triggers the memo below. */
const EMPTY_ASSIGNEE_RESULTS: ReadonlyArray<AssigneeOption> = [];

const ASSIGNEE_DROPDOWN_LIMIT = 50;

/**
 * sk-285.2.6 — one project the board can be focused on.
 *
 * `id` is the uuid the focus set stores and the rows are matched on;
 * `handle` is the short prefix the user knows the project by (and what
 * the board's focus bar prints); `name` is the long form, shown as the
 * option's second line so two similarly-prefixed projects can be told
 * apart in the dropdown.
 */
export interface ProjectFocusOption {
  id: string;
  handle: string;
  name: string;
}

/**
 * Filter zone at the top of the Tasks column (F4, Sc3).
 *
 * A search box plus a collapsible body of labelled DROPDOWNS — one per
 * filter dimension:
 *
 *   [search……………………… ×] [⛉ Filters (2) ▾]
 *   ┌ Assignee ─────┐ ┌ Status ───────┐ ┌ Priority ─────┐
 *   ┌ Type ─────────┐ ┌ Source ───────┐ ┌ Tree edges ───┐
 *   ┌ View ─────────┐ ┌ Columns ──────┐ ┌ Sort by ──────┐
 *
 * («Tree edges» only in Tree view, «Columns» only in Board view — each
 * belongs to the body it configures.)
 *
 * sk-285.1.18 — the body used to be five rows of chip-pills, which spent
 * the column's whole width on options nobody had picked and pushed the
 * task list below the fold. Each dimension is now one `Select` (one
 * `MultiSelect` for the tree-edge lens, the only dimension that is
 * genuinely multi-valued): the CHOSEN value is what stays on screen, the
 * alternatives live one keystroke away in the dropdown. Every control is
 * a real Mantine combobox, so it is reachable by Tab and drivable by
 * arrow keys / Enter — the chip rows only ever offered Tab.
 *
 * Wire values stay untranslated: the option `value`s are protocol
 * (`in_progress`, `human-driven`, `bug`, `blocks`, …); only labels and
 * descriptions are UI copy. Issue TYPES are additionally rendered with
 * their wire identifier AS the label — `bug` / `feature` / `epic` read
 * the same in the `<Attribute>` pill and the details dropdown, so
 * translating them here alone would make one value read two ways on one
 * screen.
 *
 * sk-285.1.13 — the body COLLAPSES. Folded, the panel is one compact
 * line: the search box (never folded — see the render comment for why)
 * plus an expand button carrying a badge with the number of filters
 * currently narrowing the list, so a filtered list can never look like an
 * empty project. The state itself lives in `useLayoutState` (persisted;
 * collapsed by default) — this component only receives `collapsed` +
 * `onToggleCollapsed`.
 *
 * sk-44.2 — the typeahead direct-jump dropdown (consumer A of the
 * search box) was removed. Typing now ONLY drives the list filter
 * (consumer B → `onSearchChange`) which routes through the hybrid RRF
 * search in `useTasks`. No overlay renders on keystrokes.
 *
 * sk-44.4 / sk-44.5 — two toggle buttons sit to the right of the search
 * box, surfaced only while a search is active:
 *   - "within filters" (sk-44.4): off → search runs UNFILTERED over the
 *     current scope and the status/type/origin selects are cleared +
 *     disabled; on → the remembered filters return AND apply to the RRF
 *     query, selects re-enabled.
 *   - "all projects" (sk-44.5): off → search is scoped to the current
 *     project; on → scope widens to every visible project (and the
 *     project-tree cursor jumps to "All Projects"). The two axes are
 *     orthogonal and combine freely. State lives in
 *     `useTaskSearchModes` (TasksColumn), not here — this component is a
 *     pure view.
 */
export interface TaskFiltersProps {
  search: string;
  onSearchChange: (v: string) => void;
  statusFilter: StatusFilter;
  onStatusChange: (v: StatusFilter) => void;
  /**
   * sk-303.14 (T025) — render the «Unreviewed» selection chip.
   *
   * TRUE only under the Delegated lens. The chip is not a general status:
   * the set it selects is "closed results I delegated and have not marked
   * reviewed", which exists only on that surface. Offering it elsewhere
   * would promise a narrowing the endpoint underneath cannot perform.
   *
   * Rendered inside the status row rather than beside it, because it
   * occupies the same axis: it is mutually exclusive with the other
   * status chips, and picking any of them drops it.
   */
  showUnreviewedChip?: boolean;
  originFilter: OriginFilter;
  onOriginChange: (v: OriginFilter) => void;
  typeFilter: TypeFilter;
  onTypeChange: (v: TypeFilter) => void;
  /**
   * sk-86 — priority filter. `'all'` = no filter; `'0'`..`'4'` narrow to
   * that single board priority. Same effective-overlay wiring as
   * status/type/origin (TasksColumn passes the EFFECTIVE value + setter
   * from useTaskSearchModes).
   */
  priorityFilter: PriorityFilter;
  onPriorityChange: (v: PriorityFilter) => void;
  view: ViewMode;
  /**
   * sk-285.2.6 — the board's project focus: the two or three projects
   * the user actually works in. Rendered next to «Columns» / «Card
   * properties» and under the same condition — it configures the board,
   * so it appears only while the board is the current view.
   *
   * Empty set = «all projects», which is also the reset: clearing the
   * control is the whole "back to everything" gesture.
   */
  projectFocus?: ProjectFocus;
  onProjectFocusChange?: (v: ProjectFocus) => void;
  /** Projects the user can see, for the picker's options. */
  projectFocusOptions?: ReadonlyArray<ProjectFocusOption>;
  /**
   * The handle of the single project open in the Projects column, or
   * null. Non-null means the focus is PAUSED (the explicit click
   * outranks the saved set — see `lib/kanbanProjectFocus.ts`), which
   * the control says out loud and the badge below stops counting: a
   * setting that is not narrowing anything must not be advertised as
   * if it were.
   */
  projectFocusPausedBy?: string | null;
  /**
   * sk-674.18 T052 — the name of the space that is the selected place
   * when the saved focus holds none of its projects, or null. Non-null
   * pauses the focus like an open project: the control says so and the
   * badge stops counting it. On a space place the caller passes as
   * `projectFocus` and `projectFocusOptions` only the space's part.
   */
  projectFocusPausedBySpace?: string | null;
  /**
   * sk-36 F3 — layered-tree dep-type lens. Only rendered when
   * `view === 'tree'` AND both props are supplied. This is the one
   * genuinely MULTI-valued dimension, so it renders as a `MultiSelect`.
   * Mandatory-on `parent-child` is a disabled option: it cannot be
   * unpicked from the dropdown, its pill carries no remove button, and
   * the change handler re-adds it defensively.
   */
  treeDepTypes?: ReadonlySet<DepType>;
  onTreeDepTypesChange?: (next: ReadonlySet<DepType>) => void;
  /**
   * sk-44 — true while a search is active (non-empty box). Drives
   * visibility of the "within filters" / "all projects" toggle buttons
   * and the disabled state of the filter selects.
   */
  searchActive: boolean;
  /**
   * sk-79 — assignee filter dropdown. Rendered as the FIRST control,
   * above the status select, ONLY when `showAssigneeRow` is true (a project
   * is selected and no outbox / on-me lens is active — see TasksColumn). The
   * options are the project's members; `assigneeFilter` is the picked
   * username (or null = "anyone"); picking an option calls
   * `onAssigneeChange` with its username, and clearing the select calls it
   * with null. When `showAssigneeRow` is false none of these are read.
   */
  showAssigneeRow: boolean;
  assigneeOptions: ReadonlyArray<AssigneeOption>;
  assigneeFilter: string | null;
  onAssigneeChange: (username: string | null) => void;
  /**
   * sk-285.5.5 — directory SEARCH inside the assignee control. On the
   * cross-project "All projects" surface the options are only the people
   * present on the loaded board, so somebody with no visible task is
   * unreachable without a search; this is that search.
   *
   * `assigneeSearchEnabled` turns it on. `assigneeSearchValue` /
   * `onAssigneeSearchChange` are the RAW, undebounced box contents — the
   * owner debounces before it queries, so typing stays responsive.
   * `assigneeSearchResults` are the matches for the debounced term,
   * `assigneeSearchLoading` is true while they are in flight, and
   * `assigneeSearchHasMore` says the backend had more matches than it
   * returned (narrow the term). All ignored when the flag is false.
   *
   * Merge note (stage 2.1 ← main): main built this contract against the
   * avatar chip row + "+N" overflow Menu. Stage 2 had already replaced that
   * row with `AssigneeSelect`, so the props survived the merge unchanged
   * and now drive the Select's own search box instead. Same contract, same
   * owner-side plumbing in `TasksColumn`; different surface.
   */
  assigneeSearchEnabled?: boolean;
  assigneeSearchValue?: string;
  onAssigneeSearchChange?: (value: string) => void;
  assigneeSearchResults?: ReadonlyArray<AssigneeOption>;
  assigneeSearchLoading?: boolean;
  assigneeSearchHasMore?: boolean;
  /**
   * sk-44.4 — true when the status/priority/type/origin selects are
   * interactive (the assignee select is NOT gated on this — see
   * `AssigneeSelect`). When a search is active and "within filters" is OFF,
   * they are cleared upstream and disabled here (the search runs
   * unfiltered over scope). Outside search, always true.
   */
  filtersEnabled: boolean;
  /**
   * sk-44.4 — "within filters" toggle state. Pressed → the remembered
   * filters return and narrow the RRF query. Only meaningful while
   * `searchActive`.
   */
  withinFilters: boolean;
  /** sk-44.4 — flip the "within filters" toggle. */
  onWithinFiltersToggle: () => void;
  /**
   * sk-44.5 — "all projects" toggle state. Pressed → search scope
   * widens to every visible project (and the tree cursor moved to "All
   * Projects" upstream). Only meaningful while `searchActive`.
   */
  allProjects: boolean;
  /** sk-44.5 — flip the "all projects" toggle. */
  onAllProjectsToggle: () => void;
  /**
   * sk-44.5 — disable the "all projects" toggle. True when there is no
   * current project to widen FROM (the user is already on the
   * cross-project "All projects" surface), so the toggle is a no-op and
   * we render it inert rather than letting it flip a meaningless flag.
   */
  allProjectsDisabled: boolean;
  /**
   * sk-44.2 — true when the hybrid search came back FTS-only (embedder
   * down). Renders a non-blocking hint under the search box. Never an
   * error state.
   */
  searchDegraded: boolean;
  /**
   * sk-47.2 — paste interceptor for the "paste-a-blob" mode. Receives the
   * raw clipboard event; the handler (in TasksColumn) extracts issue codes
   * and, if ≥1 found, calls `e.preventDefault()` to suppress the normal
   * paste and enters blob mode. When 0 codes are found it does nothing, so
   * the browser's default paste runs and the text lands in the box as a
   * normal typed search. This is a DISTINCT branch from `onSearchChange`;
   * the typed-search path is untouched.
   */
  onSearchPaste: (e: ClipboardEvent<HTMLInputElement>) => void;
  /**
   * sk-47.2 — true while blob mode is active. The toggle row (within
   * filters / all projects) and the degraded hint are hidden in blob mode
   * — those affordances only make sense for the RRF typed-search path,
   * which blob mode replaces.
   */
  blobActive: boolean;
  /**
   * sk-285.1.13 — true when the filter body is folded away and only the
   * compact bar (search box + expand button + active-filter counter)
   * renders. Owned by `useLayoutState` (persisted to localStorage,
   * default collapsed); this component stays a pure view.
   */
  collapsed: boolean;
  /** sk-285.1.13 — flip the collapsed state. */
  /**
   * Sort key currently in effect. Stays in THIS panel rather than moving
   * to the header with the other view knobs: during a search the key is
   * an ephemeral 'relevance' overlay owned by `useTaskSearchModes`,
   * which lives inside TasksColumn — below the header in the tree. A
   * header-side control could not reach it without lifting the whole
   * search-mode state above the header (sk-50), and a sort that silently
   * stopped honouring Relevance while searching would be worse than one
   * that sits in the panel.
   */
  sort: TasksSortKey;
  onSortChange: (v: TasksSortKey) => void;
  /** Search-only ephemeral setter — see `sort` above. */
  onSearchSortChange?: (v: TasksSortKey) => void;
  onToggleCollapsed: () => void;
  /**
   * sk-285.7 T025 (US-5 / FR-002) — which shape the panel is drawn in:
   * `select` = the grid of comboboxes, `chips` = the quick list.
   *
   * A LAYOUT, not a filter. It appears nowhere in `countActiveFilters`,
   * nowhere in the list query, and switching it calls no filter setter —
   * the same values are simply painted by different controls. Persisted
   * by `useTasksUiState`; this component stays a pure view, as it is for
   * `collapsed`.
   */
  filtersLayout: FiltersLayout;
  /** sk-285.7 T025 — pick the panel's layout. */
  onFiltersLayoutChange: (v: FiltersLayout) => void;
}

/**
 * sk-285.1.13 — inputs of the active-filter counter shown on the
 * collapsed bar. Deliberately a standalone shape (not `TaskFiltersProps`)
 * so the rule can be unit-tested and reused without a render.
 */
export interface ActiveFilterCountInput {
  statusFilter: StatusFilter;
  priorityFilter: PriorityFilter;
  typeFilter: TypeFilter;
  originFilter: OriginFilter;
  assigneeFilter: string | null;
  /**
   * sk-285.2.6 — how many projects the board's focus is narrowing to
   * RIGHT NOW: 0 when the set is empty, when the board is not the
   * current view, or while the focus is paused by an open project.
   * Optional so every existing caller keeps its meaning unchanged.
   */
  projectFocus?: number;
}

/**
 * sk-285.1.13 — how many filters are NARROWING the list right now.
 *
 * A collapsed panel must never hide the fact that the list is filtered,
 * so this number is what the expand button carries as a badge. The rule
 * is "count the controls that cut rows out of the default board":
 *
 *   - status: counted for every value EXCEPT the default `'active'`
 *     (the board the user always lands on) and `'all'` (which widens,
 *     never narrows). `'closed'`, `'blocked'`, `'standing'`, … count.
 *   - priority / type / source: counted when not `'all'`.
 *   - assignee: counted when a username is picked.
 *   - project focus: counted as ONE (a control, not a project each)
 *     while it is actually narrowing the board — the same rule the
 *     other dimensions follow.
 *
 * View mode and sort are NOT counted — they reorder / re-shape, they
 * never remove rows. Search is not counted either: the search box stays
 * visible while collapsed, so an active query is never hidden.
 *
 * The caller passes the EFFECTIVE filters (the ones the list query
 * actually applies), so during an unfiltered search — where the filters
 * are cleared upstream — the badge honestly reads 0.
 */
export function countActiveFilters({
  statusFilter,
  priorityFilter,
  typeFilter,
  originFilter,
  assigneeFilter,
  projectFocus = 0,
}: ActiveFilterCountInput): number {
  let n = 0;
  if (statusFilter !== 'active' && statusFilter !== 'all') n += 1;
  if (priorityFilter !== 'all') n += 1;
  if (typeFilter !== 'all') n += 1;
  if (originFilter !== 'all') n += 1;
  if (assigneeFilter !== null) n += 1;
  if (projectFocus > 0) n += 1;
  return n;
}

/**
 * One dropdown entry. `value` is the WIRE value (protocol, never
 * translated); `label` is UI copy; `description` is the optional second
 * line rendered under the label inside the dropdown — it carries the
 * explanations the old chips could only put in a `title` attribute
 * (which is mouse-only and delayed).
 */
interface FilterOption<T extends string> {
  value: T;
  label: string;
  description?: string;
}

/**
 * sk-285.1.17 — option lists are built from the dictionary at render
 * time rather than from module-level constants, so a language switch
 * rebuilds them.
 */
const TYPE_VALUES: ReadonlyArray<TypeFilter> = [
  'bug',
  'feature',
  'task',
  'epic',
  'chore',
  'decision',
  'idea',
  'note',
];

function statusOptions(t: TFunction): ReadonlyArray<FilterOption<StatusFilter>> {
  return [
    { value: 'active', label: t('status.active'), description: t('status.activeTitle') },
    { value: 'open', label: t('status.open') },
    { value: 'in_progress', label: t('status.in_progress') },
    { value: 'blocked', label: t('status.blocked') },
    { value: 'deferred', label: t('status.deferred') },
    // sk-118 — the standing lens / filter. Scopes the list to standing
    // (perpetual-obligation) tasks so the standing band can be viewed as
    // a watchlist on its own.
    {
      value: 'standing',
      label: t('status.standing'),
      description: t('status.standingTitle'),
    },
    { value: 'closed', label: t('status.closed') },
    { value: 'all', label: t('status.all') },
  ];
}

/**
 * sk-303.14 (T025) — the unreviewed selection, as one more option on the
 * STATUS axis. Built from the dictionary like every other option here and
 * kept OUT of `statusOptions` on purpose: that list is unconditional, this
 * one entry is conditional on the Delegated lens.
 *
 * It arrives from sk-303.14 labelled `'👁 Unreviewed'`. Both halves of
 * that string had to go: the emoji is a stand-in mark §8 draws instead,
 * and a hardcoded Russian label in a row whose five neighbours read
 * through `t()` would be the only untranslated chip on the axis.
 */
function unreviewedOption(t: TFunction): FilterOption<StatusFilter> {
  return {
    value: 'unreviewed',
    label: t('status.unreviewed'),
    description: t('status.unreviewedTitle'),
  };
}

function priorityOptions(t: TFunction): ReadonlyArray<FilterOption<PriorityFilter>> {
  return [
    { value: 'all', label: t('priority.all'), description: t('priority.allTitle') },
    { value: '0', label: 'P0', description: t('priority.p0Title') },
    { value: '1', label: 'P1', description: t('priority.p1Title') },
    { value: '2', label: 'P2', description: t('priority.p2Title') },
    { value: '3', label: 'P3', description: t('priority.p3Title') },
    { value: '4', label: 'P4', description: t('priority.p4Title') },
  ];
}

function originOptions(t: TFunction): ReadonlyArray<FilterOption<OriginFilter>> {
  return [
    { value: 'all', label: t('origin.all'), description: t('origin.allTitle') },
    {
      value: 'human-driven',
      label: t('origin.human'),
      description: t('origin.humanTitle'),
    },
    {
      value: 'agent-autonomous',
      label: t('origin.agent'),
      description: t('origin.agentTitle'),
    },
  ];
}

function typeOptions(t: TFunction): ReadonlyArray<FilterOption<TypeFilter>> {
  return [
    { value: 'all' as TypeFilter, label: t('type.all') },
    ...TYPE_VALUES.map((v) => ({ value: v, label: v })),
  ];
}


/**
 * sk-285.2.4 — the column axes, in the order the dropdown offers them.
 *
 * The wording carries the two facts a user cannot guess: which axes
 * duplicate a card (component / label — an issue can hold several) and
 * which one the board cannot write (project — Skein has no move between
 * projects, so those columns are read-only).
 */
export function kanbanAxisOptions(t: TFunction): ReadonlyArray<FilterOption<KanbanAxis>> {
  return KANBAN_AXES.map((axis) => ({
    value: axis,
    label: t(`kanbanAxis.${axis}`),
    description: t(`kanbanAxis.${axis}Title`),
  }));
}

export function sortOptions(t: TFunction): ReadonlyArray<FilterOption<TasksSortKey>> {
  return [
    { value: 'priority-updated', label: t('sort.priorityUpdated') },
    { value: 'priority', label: t('sort.priority') },
    { value: 'updated', label: t('sort.updated') },
    { value: 'created', label: t('sort.created') },
    { value: 'id', label: t('sort.id') },
  ];
}

/**
 * sk-36 — visual recipe per typed-deps edge. The colour is read here so
 * the dot in the dropdown option matches the connector glyph rendered in
 * `TaskTreeNode`. CSS-variable names mirror `index.css` (`--accent-*`
 * tokens defined under `:root`).
 */
interface DepTypeDescriptor {
  value: DepType;
  label: string;
  description: string;
  cssVar: string;
}

/**
 * The option LABEL is the wire dep type (`waits-for`, `discovered-from`,
 * …) — the same identifier the tree connectors, the MCP tools and the
 * API all use, so it stays untranslated. Only the explanatory
 * `description` is copy.
 */
function depTypeDescriptors(t: TFunction): ReadonlyArray<DepTypeDescriptor> {
  return [
    {
      value: 'parent-child',
      label: 'parent-child',
      description: t('depTypes.parentChild'),
      cssVar: '--ink-2',
    },
    {
      value: 'blocks',
      label: 'blocks',
      description: t('depTypes.blocks'),
      cssVar: '--err',
    },
    {
      value: 'waits-for',
      label: 'waits-for',
      description: t('depTypes.waitsFor'),
      cssVar: '--warn',
    },
    {
      value: 'related',
      label: 'related',
      description: t('depTypes.related'),
      cssVar: '--secondary',
    },
    {
      value: 'discovered-from',
      label: 'discovered-from',
      description: t('depTypes.discoveredFrom'),
      cssVar: '--info',
    },
    {
      value: 'supersedes',
      label: 'supersedes',
      description: t('depTypes.supersedes'),
      cssVar: '--violet',
    },
    {
      value: 'duplicates',
      label: 'duplicates',
      description: t('depTypes.duplicates'),
      cssVar: '--ink-3',
    },
  ];
}

/*
 * sk-285.7.2.72 — the filter label's size is no longer set here.
 *
 * sk-285.7.2.67 had to pass a `styles` prop on these five controls,
 * because `theme.ts` wrote `font-size: var(--font-sm)` INLINE on every
 * Mantine label and inline beats every selector — `index.css` already
 * carried `.task-filter-select label { font-size: var(--font-xs) }` and
 * was losing to it. That prop fixed the panel and left every other form
 * in the app on 14px, which is what audit 2B then measured on `/login`,
 * `/settings/theme` and the Move dialog.
 *
 * The size has since moved out of `theme.ts` into a real rule on
 * `.mantine-InputWrapper-label` in `index.css`, so there is nothing
 * inline left to beat and the panel gets its 12 from the same place as
 * everything else. The prop is gone rather than kept as a harmless
 * duplicate: a second statement of the same value is a second place to
 * change it, and the panel would keep its 12 while the rest of the app
 * silently drifted.
 */

/**
 * sk-285.5.5 — the assignee dropdown alone can hold DISABLED options (stale
 * server rows). Mantine paints those at reduced opacity, which measured
 * ~1.93:1 on the dropdown surface — under SC 1.4.3. The class is the hook
 * that restores readable contrast in `index.css`; staleness is signalled by
 * the spinner and `aria-busy`, not by dimming.
 */
const ASSIGNEE_COMBOBOX_PROPS = {
  ...COMBOBOX_PROPS,
  classNames: { dropdown: 'filter-assignee-dropdown' },
} as const;

/**
 * One single-choice filter dimension. Deselection is off (`allowDeselect`)
 * because every list here carries its own explicit "no filter" option
 * (`all` / `active`) — an empty select would be a state the query cannot
 * express.
 */
export function FilterSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
  neutral,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<FilterOption<T>>;
  onChange: (v: T) => void;
  disabled?: boolean;
  /**
   * sk-285.7.2.68 — audit 2B, R-6. The option that means "this
   * dimension is NOT narrowing the list" — `all` on status / priority /
   * type / source. While the control shows it, §6 draws the value
   * muted; anything else is the reader's own choice and is drawn in
   * full ink.
   *
   * OMITTED where the dimension has no such option: «Sort by» always
   * names a real ordering, and the artboard draws it picked out for
   * that reason («Priority + Updated», `--ink` 500) even though it is
   * the value the app starts with. Omission therefore means "always
   * chosen", not "unknown".
   */
  neutral?: T;
}) {
  const descriptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of options) if (o.description) m.set(o.value, o.description);
    return m;
  }, [options]);

  return (
    <Select
      className={`task-filter-select${neutral !== undefined && value === neutral ? ' is-default' : ''}`}
      size="xs"
      label={label}
      value={value}
      data={options.map((o) => ({ value: o.value, label: o.label }))}
      onChange={(v) => {
        // `allowDeselect={false}` means Mantine only ever hands back a
        // real option value here; the null guard is belt-and-braces.
        if (v === null) return;
        onChange(v as T);
      }}
      allowDeselect={false}
      disabled={disabled}
      renderOption={({ option, checked }) => (
        <OptionBody
          checked={!!checked}
          label={option.label}
          description={descriptions.get(option.value)}
        />
      )}
      comboboxProps={COMBOBOX_PROPS}
      maxDropdownHeight={280}
    />
  );
}

/** sk-79 — case-insensitive "is this the picked assignee" test. */
function assigneeEq(a: string | null, b: string): boolean {
  return a !== null && a.toLowerCase() === b.toLowerCase();
}

/**
 * sk-285.5.5 — the directory-search half of the assignee control.
 *
 * `results` answer the DEBOUNCED term and may therefore lag `value` by one
 * debounce; `loading` says exactly that ("what you see is not yet the
 * answer to what you typed"), so the control can stay populated between
 * keystrokes instead of blanking, while still telling the reader the rows
 * are not current.
 */
export interface AssigneeSearchProps {
  /** Raw (undebounced) box contents. */
  value: string;
  onChange: (value: string) => void;
  /** Matches for the DEBOUNCED term — may lag `value` by one debounce. */
  results: ReadonlyArray<AssigneeOption>;
  loading: boolean;
  /** Backend had more matches than it returned — narrow the term. */
  hasMore: boolean;
}

/**
 * sk-79 — the assignee dimension: a searchable, clearable dropdown over
 * the project members (empty = anyone).
 *
 * NOT gated on `filtersEnabled` (unlike status / priority / type / source).
 * That flag marks the filters an unfiltered search CLEARS upstream; the
 * assignee filter is not one of them — TasksColumn keeps feeding it to the
 * query during a search. Disabling the control while its filter is still
 * applied would leave the user unable to lift it.
 *
 * sk-194.5.2.8.1 (carried over from the chip row it replaces): Mantine
 * re-parses `data` on every render, so the list is only materialised while
 * the dropdown is OPEN; closed, `data` holds at most the selected option
 * (all the input needs to display its label). `limit` then caps how many
 * options are actually rendered when it opens — typing narrows the rest.
 *
 * That gating was sized against a cross-project `options` holding the whole
 * org directory. sk-285.5.5 has since cut
 * that source down to the assignees of the LOADED board, so the list is now
 * short and the gating is cheap insurance rather than the load-bearing fix
 * it was. Reachability of everyone else moved to `search` (below), which
 * asks the backend instead of shipping the directory to the client.
 */
function AssigneeSelect({
  options,
  value,
  onChange,
  search,
}: {
  options: ReadonlyArray<AssigneeOption>;
  value: string | null;
  onChange: (username: string | null) => void;
  search?: AssigneeSearchProps;
}) {
  const { t } = useTranslation('filters');
  const [opened, setOpened] = useState(false);

  // The picked option, or a synthetic one when the filter names someone
  // outside the current option set — a filter that IS applied must stay
  // visible, never silently read as "anyone".
  const selected = useMemo(() => {
    if (value === null) return null;
    const hit = options.find((o) => assigneeEq(value, o.username));
    return hit ?? { username: value, label: value, userId: null };
  }, [options, value]);

  // sk-285.5.5 — with `search` wired, `options` is only the loaded board's
  // assignees; everyone else arrives as `search.results`. The two lists are
  // unioned (board first, so the people already in front of the reader keep
  // their place) and deduped by username: the backend can legitimately
  // return somebody who is also on the board.
  const merged = useMemo<ReadonlyArray<AssigneeOption>>(() => {
    if (!search || search.results.length === 0) return options;
    const seen = new Set(options.map((o) => o.username.toLowerCase()));
    const extra = search.results.filter((o) => !seen.has(o.username.toLowerCase()));
    return extra.length === 0 ? options : [...options, ...extra];
    // `search` itself is a fresh object literal on every parent render;
    // only its `results` identity can actually change the outcome.
  }, [options, search?.results]);

  // sk-285.5.5 review F4 (carried across the merge) — rows that answer the
  // PREVIOUS term stay on screen so the list does not blank out between
  // keystrokes, but they refuse selection until they catch up: a stale row
  // that still filters is a row the reader never asked for. Only the
  // SERVER half can go stale; the board's own options are local and always
  // current, so they stay live even mid-query.
  const staleUsernames = useMemo(() => {
    if (!search || !search.loading || search.value.trim().length === 0) return null;
    const local = new Set(options.map((o) => o.username.toLowerCase()));
    const stale = new Set<string>();
    for (const o of merged) {
      const key = o.username.toLowerCase();
      if (!local.has(key)) stale.add(key);
    }
    return stale.size === 0 ? null : stale;
  }, [merged, options, search?.loading, search?.value]);

  const data = useMemo(() => {
    if (!opened) {
      return selected ? [{ value: selected.username, label: selected.label }] : [];
    }
    return merged.map((o) => ({
      value: o.username,
      label: o.label,
      disabled: staleUsernames?.has(o.username.toLowerCase()) ?? false,
    }));
  }, [opened, merged, selected, staleUsernames]);

  const avatars = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const o of merged) m.set(o.username, o.userId ?? null);
    return m;
  }, [merged]);

  return (
    <Select
      // The assignee dimension's neutral value is the ABSENCE of one:
      // an empty control filters nobody out and shows the «Anyone»
      // placeholder (sk-285.7.2.68, R-6).
      className={`task-filter-select task-filter-select-assignee${
        selected ? '' : ' is-default'
      }`}
      size="xs"
      label={t('labels.assignee')}
      placeholder={t('assignee.anyone')}
      value={selected ? selected.username : null}
      data={data}
      onChange={(v) => {
        // Picking someone ends the search: the term has served its purpose,
        // and leaving it in the box would re-narrow the list the next time
        // the dropdown opens, hiding the board's own people.
        search?.onChange('');
        onChange(v);
      }}
      onDropdownOpen={() => setOpened(true)}
      onDropdownClose={() => {
        setOpened(false);
        search?.onChange('');
      }}
      searchable
      clearable
      limit={ASSIGNEE_DROPDOWN_LIMIT}
      {...(search
        ? {
            searchValue: search.value,
            onSearchChange: search.onChange,
            // sk-285.5.5 — the backend matches on username AND display
            // name, Mantine's built-in filter only on the rendered label.
            // Left to itself it would hide a server hit whose username
            // matched but whose label did not — the exact person the
            // reader searched for. So while a term is typed the client
            // filter steps aside and the server's answer stands; with an
            // empty term it is the plain local list and Mantine filters as
            // usual.
            filter: ({ options: opts, search: term, limit }) => {
              const q = term.trim().toLowerCase();
              const list = opts.filter((o) =>
                q.length === 0 || !('value' in o)
                  ? true
                  : o.value.toLowerCase().includes(q) ||
                    (o.label ?? '').toLowerCase().includes(q) ||
                    // Server hit: it answers the term by construction.
                    (search.results.some((r) => assigneeEq(o.value, r.username)) &&
                      !search.loading),
              );
              return list.slice(0, limit);
            },
            // Rows on screen may still answer the PREVIOUS term. Say so
            // rather than letting them read as the current answer.
            rightSection: search.loading ? <Loader size="xs" /> : undefined,
            // Only while a term is actually typed. `hasMore` describes the
            // LAST query and outlives the term that produced it, so keying
            // the hint on the flag alone leaves "narrow the term" standing
            // under an empty box after a pick — advice about a question no
            // longer being asked.
            description:
              search.hasMore && search.value.trim().length > 0
                ? t('assignee.searchHasMore')
                : undefined,
          }
        : {})}
      nothingFoundMessage={
        search?.loading ? t('assignee.searching') : t('assignee.nothingFound')
      }
      leftSection={
        selected ? (
          <Avatar
            username={selected.username}
            userId={selected.userId ?? undefined}
            size="sm"
          />
        ) : undefined
      }
      renderOption={({ option, checked }) => (
        <OptionBody
          checked={!!checked}
          label={option.label}
          leading={
            <Avatar
              username={option.value}
              userId={avatars.get(option.value) ?? undefined}
              size="sm"
            />
          }
        />
      )}
      comboboxProps={ASSIGNEE_COMBOBOX_PROPS}
      maxDropdownHeight={280}
    />
  );
}

/**
 * sk-36 — the tree dep-type lens: the one MULTI-valued dimension of the
 * tree, so it is a multi-select. `parent-child` is the tree spine and is
 * a DISABLED option, which means both «cannot be picked or unpicked from
 * the dropdown» and «its pill carries no remove button». The change
 * handler re-adds it anyway (defence in depth for any caller that
 * reaches the setter another way).
 *
 * sk-285.7.2.71 — `AttributePicker`, not Mantine's `MultiSelect`. The
 * reason is R-9's: `MultiSelect` renders its own pills and forwards
 * nothing per pill, so every remove button here carried the theme's
 * factory `aria-label="Close"` plus `aria-hidden` and `tabIndex={-1}` —
 * a wrong name that was not announced, on an affordance the keyboard
 * could not reach. The three View-settings pickers were recomposed for
 * exactly that in sk-285.7.2.70 and this control was left behind; the
 * app carried two multi-select vocabularies until now.
 */
function DepTypesSelect({
  descriptors,
  value,
  onChange,
}: {
  descriptors: ReadonlyArray<DepTypeDescriptor>;
  value: ReadonlySet<DepType>;
  onChange: (next: ReadonlySet<DepType>) => void;
}) {
  const { t } = useTranslation('filters');

  return (
    <AttributePicker
      className="task-filter-select task-filter-select-deps"
      label={t('labels.depTypes')}
      options={descriptors.map((d) => ({
        value: d.value,
        label: d.label,
        description: d.description,
        disabled: d.value === 'parent-child',
        locked: d.value === 'parent-child',
        leading: (
          <span
            className="dep-type-chip-dot"
            style={{ background: `var(${d.cssVar})` }}
            aria-hidden
          />
        ),
      }))}
      value={value as ReadonlySet<string>}
      onChange={(next) => {
        const set = new Set(next as DepType[]);
        set.add('parent-child');
        onChange(set);
      }}
      removeLabel={(attribute) => t('viewSettings.removeAttribute', { attribute })}
    />
  );
}

/**
 * sk-285.2.5 — the board's «display properties».
 *
 * A flat list of switches, Linear-style: no ordering, no per-field
 * renaming, no drag-to-arrange (see `lib/kanbanCardFields.ts` for why
 * that model and not YouTrack's «Cards» tab). A `MultiSelect` gives the
 * list a tick per row and a summary of the picked set in the closed
 * control — which is exactly a column of toggles plus a legible resting
 * state, without a second widget vocabulary.
 *
 * The field the current axis already states is shown DISABLED with the
 * reason spelled out, rather than hidden. Hiding it would make the list
 * change length as the axis changes, and the user would read that as the
 * setting having been lost.
 */
export function CardFieldsSelect({
  axis,
  value,
  onChange,
  inputRef,
}: {
  axis: KanbanAxis;
  value: ReadonlySet<KanbanCardField>;
  onChange: (next: ReadonlySet<KanbanCardField>) => void;
  /**
   * sk-285.7.11 (VS3) — handle on the control's own field, so a caller
   * can OPEN this picker from a button of its own (the View settings
   * panel's dashed «+ Add attribute» chip). Mantine forwards a
   * `MultiSelect` ref to the input element, and clicking that element is
   * the same gesture a user makes on the field — no private API, no
   * reaching into another component's DOM from outside.
   */
  inputRef?: Ref<HTMLInputElement>;
}) {
  const { t } = useTranslation('filters');
  const suppressed = KANBAN_AXIS_SUPPRESSED[axis];

  return (
    <AttributePicker
      className="task-filter-select task-filter-select-card-fields"
      inputRef={inputRef}
      label={t('labels.kanbanCardFields')}
      placeholder={t('kanbanCardFields.none')}
      options={KANBAN_CARD_FIELDS.map((f) => ({
        value: f,
        label: t(`kanbanCardFields.${f}`),
        disabled: f === suppressed,
        description:
          f === suppressed
            ? t('kanbanCardFields.statedByColumn')
            : t(`kanbanCardFields.${f}Title`),
      }))}
      value={value as ReadonlySet<string>}
      onChange={(next) => onChange(new Set(next as KanbanCardField[]))}
      removeLabel={(attribute) => t('viewSettings.removeAttribute', { attribute })}
    />
  );
}

/**
 * sk-285.2.19 — the tree table's columns.
 *
 * The board's card-property picker, one surface over: the same
 * `MultiSelect`, so the two "which fields do I want" controls read and
 * behave identically instead of inventing a second vocabulary for the
 * same question.
 *
 * The TITLE COLUMN IS NOT IN THIS LIST, and deliberately has no disabled
 * row standing in for it (unlike the axis-suppressed card field, which
 * IS listed-but-disabled). A disabled row invites the reader to wonder
 * what would happen if it were enabled; the title column is not a
 * property that happens to be locked, it is the tree itself — the
 * chevron, the indent and the connector live in it. It is stated once,
 * in the control's description line, and then not offered.
 */
export function TreeColumnsSelect({
  value,
  onChange,
  inputRef,
}: {
  value: TreeColumnSet;
  onChange: (next: TreeColumnSet) => void;
  /** See {@link CardFieldsSelect}'s `inputRef`. */
  inputRef?: Ref<HTMLInputElement>;
}) {
  const { t } = useTranslation('filters');

  return (
    <AttributePicker
      className="task-filter-select task-filter-select-tree-columns"
      inputRef={inputRef}
      label={t('labels.treeColumns')}
      description={t('treeColumns.titlePinned')}
      placeholder={t('treeColumns.none')}
      options={TREE_OPTIONAL_COLUMNS.map((c) => ({
        value: c,
        label: t(`treeColumns.${c}`),
        description: t(`treeColumns.${c}Title`),
      }))}
      value={value as ReadonlySet<string>}
      onChange={(next) => onChange(new Set(next as TreeOptionalColumn[]))}
      removeLabel={(attribute) => t('viewSettings.removeAttribute', { attribute })}
    />
  );
}

/**
 * The list card's attributes.
 *
 * The third «which fields do I want» control, and the same `MultiSelect`
 * as the other two on purpose: the board's card properties, the tree's
 * table columns and this one are one question asked about three
 * surfaces, so they read and behave identically instead of inventing a
 * third vocabulary for it.
 *
 * The TITLE IS NOT IN THIS LIST, and — exactly as in
 * {@link TreeColumnsSelect} — has no disabled row standing in for it. A
 * disabled row invites the reader to wonder what would happen if it were
 * enabled; the title is not an attribute that happens to be locked, it
 * is the card. It is stated once, in the control's description line, and
 * then not offered.
 */
export function ListCardFieldsSelect({
  value,
  onChange,
  inputRef,
}: {
  value: ListCardFieldSet;
  onChange: (next: ListCardFieldSet) => void;
  /** See {@link CardFieldsSelect}'s `inputRef`. */
  inputRef?: Ref<HTMLInputElement>;
}) {
  const { t } = useTranslation('filters');

  return (
    <AttributePicker
      className="task-filter-select task-filter-select-list-card-fields"
      inputRef={inputRef}
      label={t('labels.listCardFields')}
      description={t('listCardFields.titlePinned')}
      placeholder={t('listCardFields.none')}
      options={LIST_CARD_FIELDS.map((f) => ({
        value: f,
        label: t(`listCardFields.${f}`),
        description: t(`listCardFields.${f}Title`),
      }))}
      value={value as ReadonlySet<string>}
      onChange={(next) => onChange(new Set(next as ListCardField[]))}
      removeLabel={(attribute) => t('viewSettings.removeAttribute', { attribute })}
    />
  );
}

/**
 * sk-285.2.6 — "Projects focus": the two or three projects the board
 * shows.
 *
 * A multi-select for the same reason the card-field picker is one — a
 * tick per row plus a legible resting state, without inventing a second
 * widget vocabulary. The reset matters more here than anywhere else in
 * the panel: «back to all projects» has to be one gesture, so the ✕
 * inside the control IS the documented reset (the board's own bar
 * carries the other copy of it).
 *
 * sk-285.7.2.71 — `AttributePicker`, not Mantine's `MultiSelect`, for
 * R-9's reason (see `DepTypesSelect` above). Two of the picker's opt-in
 * capabilities were added FOR this control: `searchable`, because a
 * workspace with forty projects is not a list anyone scrolls, and
 * `onClear`, which is the reset `MultiSelect`'s `clearable` used to
 * draw. The reset is named explicitly — it is a `CloseButton`, so an
 * unnamed one would arrive carrying the same «Close» the pills were
 * carrying.
 *
 * While a single project is open in the Projects column the focus is
 * PAUSED, and the control says so in its description line instead of
 * going away. Hiding it would leave the user with a setting that is on,
 * invisible, and doing nothing — the exact confusion the paused state
 * exists to prevent. It stays editable while paused: preparing tomorrow
 * evening's focus while reading one project today is a reasonable thing
 * to do, and nothing about it is destructive.
 */
function ProjectFocusSelect({
  options,
  value,
  pausedBy,
  pausedBySpace,
  onChange,
}: {
  options: ReadonlyArray<ProjectFocusOption>;
  value: ProjectFocus;
  pausedBy: string | null;
  /** sk-674.18 T052 — the space place that holds no focused project. */
  pausedBySpace: string | null;
  onChange: (next: ProjectFocus) => void;
}) {
  const { t } = useTranslation('filters');
  const byId = useMemo(() => {
    const m = new Map<string, ProjectFocusOption>();
    for (const o of options) m.set(o.id, o);
    return m;
  }, [options]);

  // A focused project that is not in the option list (hidden, archived,
  // or simply not loaded yet) must still show as picked — a focus that
  // IS applied can never read as "all projects".
  const data = useMemo(() => {
    const rows = options.map((o) => ({ value: o.id, label: o.handle }));
    for (const id of value) {
      if (!byId.has(id)) rows.push({ value: id, label: `…${id.slice(-8)}` });
    }
    return rows;
  }, [options, value, byId]);

  return (
    <AttributePicker
      className="task-filter-select task-filter-select-project-focus"
      label={t('labels.projectFocus')}
      description={
        pausedBy && value.size > 0
          ? t('projectFocus.paused', { project: pausedBy })
          : pausedBySpace
            ? t('projectFocus.pausedSpace', { space: pausedBySpace })
            : undefined
      }
      placeholder={value.size === 0 ? t('projectFocus.allProjects') : undefined}
      options={data.map((row) => ({
        value: row.value,
        label: row.label,
        description: byId.get(row.value)?.name,
      }))}
      value={value}
      onChange={(next) => onChange(new Set(next))}
      removeLabel={(attribute) => t('viewSettings.removeAttribute', { attribute })}
      searchable
      nothingFoundMessage={t('projectFocus.nothingFound')}
      onClear={() => onChange(new Set())}
      clearLabel={t('projectFocus.clear')}
    />
  );
}

// ───────────────── sk-285.7 T025 — mode B (the quick list) ─────────────────

/**
 * The panel's layout switch (handoff §6): two icon buttons, `forms` for
 * the combobox grid and `list-details` for the quick list.
 *
 * Rendered from {@link FILTERS_LAYOUT_VALUES} rather than from two
 * hand-written buttons, so a third layout added to that array arrives
 * here with a button — and arrives in the tests, which enumerate the
 * same array. The icon and the copy are looked up per value; a value
 * with neither would fail to compile rather than render a blank button.
 */
const LAYOUT_ICONS: Record<FiltersLayout, typeof IconForms> = {
  select: IconForms,
  chips: IconListDetails,
};

function FiltersLayoutSwitch({
  value,
  onChange,
}: {
  value: FiltersLayout;
  onChange: (v: FiltersLayout) => void;
}) {
  const { t } = useTranslation('filters');
  return (
    <div
      className="task-filters-layout-switch"
      role="group"
      aria-label={t('layout.groupAria')}
    >
      {FILTERS_LAYOUT_VALUES.map((layout) => {
        const Icon = LAYOUT_ICONS[layout];
        const active = layout === value;
        return (
          <SkeinTooltip key={layout} position="bottom" content={t(`layout.${layout}`)}>
            <button
              type="button"
              className={`task-filters-layout-btn${active ? ' active' : ''}`}
              aria-pressed={active}
              aria-label={t(`layout.${layout}Aria`)}
              onClick={() => onChange(layout)}
            >
              <Icon size={16} stroke={1.75} aria-hidden />
            </button>
          </SkeinTooltip>
        );
      })}
    </div>
  );
}

/**
 * The 6px dot a chip carries, as a CSS custom-property NAME — or `null`
 * for a chip that carries none.
 *
 * Handoff §6 dots exactly three things: statuses, priorities and epic.
 * NOT the whole type row, and that restraint is the design's, not an
 * omission to be tidied up. It used to be defensive as well: `feature`
 * and `in_progress` both answered `--info` from the maps in
 * `Attribute.tsx` and the two sit one row apart in this very panel, so
 * dotting every type would have put one hue on two chips meaning
 * different things.
 *
 * sk-285.7.3 has since been decided — colour belongs to status and
 * priority, form to the type sets — and sk-367 carried it into those
 * maps: `typeFill` now answers `--violet` for epic and the neutral ink
 * for every other type, so there is no per-type hue left to dot. The
 * §6 restraint and the map now say the same thing for the same reason,
 * which is why this function did not have to change.
 *
 * The hues themselves are READ from `Attribute.tsx`, never restated: one
 * map per dimension, every surface a reader of it.
 *
 * Aggregate options (`all`, and status's `active`) get no dot — they are
 * not a status or a priority, they are the absence of that filter.
 */
function statusDot(value: StatusFilter): string | null {
  // `unreviewed` joins `all` and `active` here for the same reason and by
  // the same rule: it is a SELECTION over the axis, not a point on it, so
  // it has no status colour to show (and `statusFill` has no case for it).
  if (value === 'all' || value === 'active' || value === 'unreviewed') return null;
  return statusFill(value);
}

function priorityDot(value: PriorityFilter): string | null {
  if (value === 'all') return null;
  return priorityFill(Number(value));
}

function typeDot(value: TypeFilter): string | null {
  return value === 'epic' ? typeFill('epic') : null;
}

/**
 * One dimension as a row of chips: `label 72px | chips` (handoff §6).
 *
 * Single-choice, so the chips are a radio group — `aria-checked` per
 * chip (§7), not `aria-pressed`, because exactly one of them is always
 * true and a screen reader should say which. One tap IS the choice;
 * there is no deselect, for the same reason the combobox has
 * `allowDeselect={false}`: every list carries its own explicit "no
 * filter" option and an empty selection is a state the query cannot
 * express.
 *
 * sk-491 — and a radio group by keyboard too, not only by ARIA: one Tab
 * stop per row (the picked chip), ←/→ and ↑/↓ pick the neighbour round
 * the ring and move focus onto it. The model is the shared
 * `useRadioGroupKeys`, the same one the epic section's mode switch uses
 * (sk-490); the arrow order is `options`, the list the chips are drawn
 * from.
 */
function FilterChipRow<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
  dotOf,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<FilterOption<T>>;
  onChange: (v: T) => void;
  disabled?: boolean;
  dotOf?: (v: T) => string | null;
}) {
  const values = useMemo(() => options.map((o) => o.value), [options]);
  const keys = useRadioGroupKeys({ values, value, onChange, disabled });
  return (
    <div className="task-filters-chip-row">
      <span className="task-filters-chip-label" aria-hidden>
        {label}
      </span>
      {/* `aria-label`, not `aria-labelledby` pointing at the span:
          several of these labels are two words («Sort by»), and an
          IDREF list splits on whitespace — the group would end up with
          no accessible name at all. The span is hidden from AT to keep
          the name from being announced twice. */}
      <div
        className="task-filters-chips"
        role="radiogroup"
        aria-label={label}
        onKeyDown={keys.onKeyDown}
      >
        {options.map((o, i) => {
          const dot = dotOf?.(o.value) ?? null;
          const active = o.value === value;
          return (
            <button
              key={o.value}
              {...keys.itemProps(i)}
              type="button"
              role="radio"
              // sk-414.7 — the product's one filter chip, at §6's quick-list
              // density. No `.active`: the row is a radiogroup, so
              // `aria-checked` already has to be right and the stylesheet
              // paints the picked chip off that same attribute.
              className="filter-chip filter-chip-lg"
              aria-checked={active}
              // aria-disabled, not the native attribute: a disabled
              // <button> drops out of the tab order, and the row would
              // then be unreachable by keyboard exactly when a reader
              // most wants to know why it is inert. The handler
              // early-returns instead.
              aria-disabled={disabled || undefined}
              title={o.description}
              onClick={() => {
                if (disabled) return;
                onChange(o.value);
              }}
            >
              {dot ? (
                <span
                  className="filter-chip-dot"
                  style={{ background: `var(${dot})` }}
                  aria-hidden
                />
              ) : null}
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * sk-491 — the assignee row's "is this chip the picked one", the same
 * rule its `aria-checked` uses: `null` is the "anyone" chip, a username
 * matches by `assigneeEq`.
 */
function assigneeChipSelected(value: string | null, option: string | null): boolean {
  return option === null ? value === null : assigneeEq(value, option);
}

/**
 * The assignee dimension as chips.
 *
 * Its option list is the assignees of the LOADED board (sk-285.5.5), so
 * it is short and enumerable — which is what a chip row needs. The
 * "anyone" chip is the `null` value, i.e. this dimension's own explicit
 * "no filter", so the row obeys the same one-of-N rule as the others.
 *
 * A filter naming somebody outside the option list still has to SHOW —
 * a filter that IS applied can never read as "anyone" — so the picked
 * username is appended as its own chip when the list does not hold it.
 * Same rule, same reason, as `AssigneeSelect`'s synthetic option.
 *
 * sk-491 — keyboard as in `FilterChipRow`: one Tab stop, arrows round
 * the ring via `useRadioGroupKeys`. The ring is "anyone" first, then
 * `rows` — the exact order the chips are drawn in.
 */
function AssigneeChipRow({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: ReadonlyArray<AssigneeOption>;
  value: string | null;
  onChange: (username: string | null) => void;
}) {
  const { t } = useTranslation('filters');
  const rows = useMemo<ReadonlyArray<AssigneeOption>>(() => {
    if (value === null) return options;
    return options.some((o) => assigneeEq(value, o.username))
      ? options
      : [...options, { username: value, label: value, userId: null }];
  }, [options, value]);
  const values = useMemo<ReadonlyArray<string | null>>(
    () => [null, ...rows.map((o) => o.username)],
    [rows],
  );
  const keys = useRadioGroupKeys({
    values,
    value,
    onChange,
    isSelected: assigneeChipSelected,
  });

  return (
    <div className="task-filters-chip-row">
      <span className="task-filters-chip-label" aria-hidden>
        {label}
      </span>
      <div
        className="task-filters-chips"
        role="radiogroup"
        aria-label={label}
        onKeyDown={keys.onKeyDown}
      >
        <button
          {...keys.itemProps(0)}
          type="button"
          role="radio"
          className="filter-chip filter-chip-lg"
          aria-checked={value === null}
          onClick={() => onChange(null)}
        >
          {t('assignee.anyone')}
        </button>
        {rows.map((o, i) => {
          const active = assigneeEq(value, o.username);
          return (
            <button
              key={o.username}
              {...keys.itemProps(i + 1)}
              type="button"
              role="radio"
              className="filter-chip filter-chip-lg"
              aria-checked={active}
              onClick={() => onChange(o.username)}
            >
              <Avatar username={o.username} userId={o.userId ?? undefined} size="sm" />
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function TaskFilters({
  search,
  onSearchChange,
  statusFilter,
  onStatusChange,
  showUnreviewedChip = false,
  originFilter,
  onOriginChange,
  typeFilter,
  onTypeChange,
  priorityFilter,
  onPriorityChange,
  view,
  projectFocus,
  onProjectFocusChange,
  projectFocusOptions,
  projectFocusPausedBy = null,
  projectFocusPausedBySpace = null,
  treeDepTypes,
  onTreeDepTypesChange,
  showAssigneeRow,
  assigneeOptions,
  assigneeFilter,
  onAssigneeChange,
  assigneeSearchEnabled,
  assigneeSearchValue,
  onAssigneeSearchChange,
  assigneeSearchResults,
  assigneeSearchLoading,
  assigneeSearchHasMore,
  searchActive,
  filtersEnabled,
  withinFilters,
  onWithinFiltersToggle,
  allProjects,
  onAllProjectsToggle,
  allProjectsDisabled,
  searchDegraded,
  onSearchPaste,
  blobActive,
  collapsed,
  sort,
  onSortChange,
  onSearchSortChange,
  onToggleCollapsed,
  filtersLayout,
  onFiltersLayoutChange,
}: TaskFiltersProps) {
  const { t } = useTranslation('filters');
  // Option lists are rebuilt when the language changes — `t` is a fresh
  // reference per language, which is exactly the dependency we want.
  // sk-303.14 (T025) — the selection joins the STATUS axis rather than
  // standing beside it: it is mutually exclusive with the ordinary statuses
  // and picking any of them drops it, which is exactly what one option list
  // through one `onStatusChange` expresses. Appended after `all`, the
  // position the incoming side gave it.
  //
  // Built ONCE here rather than at each of the two layouts: the panel draws
  // this dimension as chips OR as a combobox, and a selection reachable in
  // one of them and not the other is the partial toggle the shell forbids.
  const STATUS_OPTIONS = useMemo(
    () =>
      showUnreviewedChip
        ? [...statusOptions(t), unreviewedOption(t)]
        : statusOptions(t),
    [t, showUnreviewedChip],
  );
  const PRIORITY_OPTIONS = useMemo(() => priorityOptions(t), [t]);
  const ORIGIN_OPTIONS = useMemo(() => originOptions(t), [t]);
  const TYPE_OPTIONS = useMemo(() => typeOptions(t), [t]);
  const SORT_OPTIONS = useMemo(() => sortOptions(t), [t]);
  // sk-50 — 'Relevance' is search-only: prepend it while searchActive
  // (it is the default ordering then), drop it otherwise so it cannot be
  // picked — or persisted — outside a search.
  const SORT_DATA = useMemo(
    () => [
      ...(searchActive
        ? [{ value: 'relevance' as TasksSortKey, label: t('sort.relevance') }]
        : []),
      ...SORT_OPTIONS,
    ],
    [searchActive, SORT_OPTIONS, t],
  );
  const DEP_TYPES = useMemo(() => depTypeDescriptors(t), [t]);
  // sk-36 — the dep-type lens is only meaningful in tree mode AND when
  // the caller wired in both the state + setter. Cards view has no notion
  // of dep types (it's a flat list of tasks), so we hide the control.
  const showDepTypes =
    view === 'tree' && treeDepTypes !== undefined && onTreeDepTypesChange !== undefined;
  // sk-285.2.4 — the axis picker belongs to the board, exactly as the
  // dep-type lens belongs to the tree.
  const showKanbanAxis = view === 'kanban';

  // sk-285.1.13 — badge for the collapsed bar. Derived from the same
  // EFFECTIVE filter props the selects display, so the number can never
  // disagree with what the list query actually applies.
  // sk-285.2.6 — the focus counts as an active filter exactly when it is
  // narrowing the board: board view, non-empty set, not paused by an
  // open project. Anywhere else it is a stored preference doing nothing,
  // and a badge for it would be a lie in the other direction.
  const projectFocusCount =
    showKanbanAxis && projectFocusPausedBy === null && projectFocusPausedBySpace === null
      ? (projectFocus?.size ?? 0)
      : 0;

  const activeFilterCount = countActiveFilters({
    statusFilter,
    priorityFilter,
    typeFilter,
    originFilter,
    assigneeFilter,
    projectFocus: projectFocusCount,
  });

  return (
    <div className="task-filters">
      {/* sk-285.1.13 — compact head. The search box NEVER collapses: it is
          the most-used control in the panel, and (unlike the dropdowns) an
          active query is self-evident from the text sitting in the box, so
          folding it away would hide a filter instead of saving space. The
          expand button sits beside it and carries the active-filter count. */}
      <div className="task-filters-head">
        <div className="task-filters-search">
          <TextInput
            className="task-filters-search-input"
            size="xs"
            value={search}
            onChange={(e) => onSearchChange(e.currentTarget.value)}
            // sk-47.2 — intercept paste BEFORE the value lands. The handler
            // extracts issue codes; with ≥1 it preventDefault()s and enters
            // blob mode (so the wall of text never hits the box) — with 0 it
            // no-ops and the default paste runs as a normal typed search.
            onPaste={onSearchPaste}
            placeholder={t('searchPlaceholder')}
            // sk-285.7 T027 — 16, the inline step (FR-003 / §8); the
            // same glyph at the same step as the Projects search, since
            // §6 states the search band once for a column in general.
            leftSection={<IconSearch size={16} stroke={1.75} aria-hidden />}
            // sk-285.1.12 — one tap target (44px) wide, so the ✕ button
            // fits inside the field instead of hanging over the controls
            // underneath it.
            rightSectionWidth={44}
            rightSection={
              search ? (
                <button
                  type="button"
                  className="task-search-clear"
                  aria-label={t('common:clearSearch')}
                  onClick={() => onSearchChange('')}
                >
                  <IconX size={16} stroke={1.75} aria-hidden />
                </button>
              ) : null
            }
            aria-label={t('searchAria')}
          />
          {searchActive && !blobActive ? (
            <div className="task-search-modes" role="group" aria-label={t('scopeAria')}>
              <SkeinTooltip position="bottom" content={t('withinFiltersTooltip')}>
                <button
                  type="button"
                  className={`task-search-mode-btn${withinFilters ? ' active' : ''}`}
                  aria-pressed={withinFilters}
                  aria-label={t('withinFiltersAria')}
                  onClick={onWithinFiltersToggle}
                >
                  <IconFilter size={16} stroke={1.5} aria-hidden />
                  <span>{t('withinFilters')}</span>
                </button>
              </SkeinTooltip>
              <SkeinTooltip
                position="bottom"
                content={
                  allProjectsDisabled
                    ? t('allProjectsTooltipDisabled')
                    : t('allProjectsTooltip')
                }
              >
                <button
                  type="button"
                  className={`task-search-mode-btn${allProjects ? ' active' : ''}`}
                  aria-pressed={allProjects}
                  aria-label={t('allProjectsAria')}
                  // Fix H — use aria-disabled (not the native `disabled`
                  // attribute) so the button stays focusable. A native
                  // disabled <button> can't receive focus, which makes the
                  // SkeinTooltip explaining WHY it's disabled mouse-hover
                  // only — keyboard users never reach it. The click handler
                  // early-returns when disabled so it stays inert.
                  aria-disabled={allProjectsDisabled || undefined}
                  onClick={() => {
                    if (allProjectsDisabled) return;
                    onAllProjectsToggle();
                  }}
                >
                  <IconWorld size={16} stroke={1.5} aria-hidden />
                  <span>{t('allProjects')}</span>
                </button>
              </SkeinTooltip>
            </div>
          ) : null}
          {/* sk-401 — an exit to the global search with the same query.

              The two switches above NARROW the column's task list; this
              element is a transition to another page, where comments,
              projects and components are searched as well. So it is a link, not a
              button with `aria-pressed`, and stands NEXT TO the "search
              scope" group, not inside it: a transition is not a mode.

              Shown under the same condition as the modes: while search is
              active. With an empty query there is nowhere to take them — the search page
              opens with an empty field at the direct address anyway. */}
          {searchActive && !blobActive && search.trim() ? (
            <Link
              to={`/search?q=${encodeURIComponent(search.trim())}`}
              className="task-search-everywhere"
              aria-label={t('search:everywhereAria', { q: search.trim() })}
            >
              <span>{t('search:everywhere')}</span>
              <IconArrowUpRight size={16} stroke={1.75} aria-hidden />
            </Link>
          ) : null}
          {searchActive && !blobActive && searchDegraded ? (
            <div className="task-search-degraded" role="status" aria-live="polite">
              {t('degraded')}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          className={`task-filters-toggle${collapsed ? '' : ' expanded'}`}
          aria-expanded={!collapsed}
          aria-controls="task-filters-body"
          // Spell the state AND the count out for AT: the visual badge is a
          // bare number next to an icon, which reads as "Filters 2" without
          // saying what the 2 is.
          aria-label={
            (collapsed ? t('toggleShow') : t('toggleHide')) +
            (activeFilterCount > 0
              ? t('toggleActiveCount', { count: activeFilterCount })
              : t('toggleNoneActive'))
          }
          title={
            activeFilterCount > 0
              ? t('toggleTitleCount', { count: activeFilterCount })
              : t('toggleLabel')
          }
          onClick={onToggleCollapsed}
        >
          <IconFilter size={16} stroke={1.5} aria-hidden />
          <span className="task-filters-toggle-label">{t('toggleLabel')}</span>
          {activeFilterCount > 0 ? (
            <span className="task-filters-count" aria-hidden>
              {activeFilterCount}
            </span>
          ) : null}
          <IconChevronDown
            size={16}
            stroke={1.5}
            className="task-filters-toggle-caret"
            aria-hidden
          />
        </button>
      </div>

      {/* The dropdown grid. Kept in the tree (so `aria-controls` always
          resolves) but emptied while collapsed: `hidden` takes it out of the
          a11y tree and the tab order, and skipping the children avoids
          building the assignee select — whose option list can hold the whole
          org directory. */}
      <div
        id="task-filters-body"
        className="task-filters-body"
        hidden={collapsed}
        role="group"
        aria-label={t('panelAria')}
      >
        {collapsed ? null : (
          <>
            {/* sk-285.7 T025 — the panel head (handoff §6): the caption
                that says the filters are shared by all three views, and
                the layout switch. Above BOTH bodies, because it belongs
                to the panel rather than to either shape of it. */}
            <div className="task-filters-panel-head">
              <span className="task-filters-note">{t('layout.note')}</span>
              <FiltersLayoutSwitch
                value={filtersLayout}
                onChange={onFiltersLayoutChange}
              />
            </div>

            {/* Mode B — the quick list. Chip rows for the six dimensions
                handoff §6 names, in its order. The dimensions it does
                NOT name stay comboboxes in both layouts and are rendered
                by the shared tail below: the assignee DIRECTORY (whose
                domain is the org, not a list a row could hold), the
                tree's dep-type lens and the board's project focus (both
                multi-valued, both carrying a per-option explanation
                line). Mode B is the quick path to the common dimensions,
                not a second, poorer copy of every control. */}
            {filtersLayout === 'chips' ? (
              <div className="task-filters-chip-rows">
                {showAssigneeRow && !assigneeSearchEnabled ? (
                  <AssigneeChipRow
                    label={t('labels.assignee')}
                    options={assigneeOptions}
                    value={assigneeFilter}
                    onChange={onAssigneeChange}
                  />
                ) : null}

                <FilterChipRow
                  label={t('labels.status')}
                  value={statusFilter}
                  options={STATUS_OPTIONS}
                  onChange={onStatusChange}
                  disabled={!filtersEnabled}
                  dotOf={statusDot}
                />

                <FilterChipRow
                  label={t('labels.priority')}
                  value={priorityFilter}
                  options={PRIORITY_OPTIONS}
                  onChange={onPriorityChange}
                  disabled={!filtersEnabled}
                  dotOf={priorityDot}
                />

                <FilterChipRow
                  label={t('labels.type')}
                  value={typeFilter}
                  options={TYPE_OPTIONS}
                  onChange={onTypeChange}
                  disabled={!filtersEnabled}
                  dotOf={typeDot}
                />

                <FilterChipRow
                  label={t('labels.source')}
                  value={originFilter}
                  options={ORIGIN_OPTIONS}
                  onChange={onOriginChange}
                  disabled={!filtersEnabled}
                />

                <FilterChipRow
                  label={t('labels.sort')}
                  value={sort}
                  options={SORT_DATA}
                  onChange={(v) => {
                    if (searchActive && onSearchSortChange) {
                      onSearchSortChange(v);
                    } else {
                      onSortChange(v);
                    }
                  }}
                />
              </div>
            ) : null}

            {/* The combobox grid. In mode B it holds only what a chip
                row cannot express — so it is not "mode A's body", it is
                the panel's combobox half, and mode A is the case where
                every dimension lands in it. */}
            <div className="task-filters-grid">
            {/* The assignee combobox survives into mode B when — and
                only when — the DIRECTORY is wired: with it the domain
                is the whole org, which no row of chips can enumerate,
                and dropping the control would put people the chip row
                never lists out of reach. Without it the option list is
                the loaded board's assignees, the chip row holds all of
                them, and a second control over the same value would be
                two answers to one question. */}
            {showAssigneeRow && (filtersLayout === 'select' || assigneeSearchEnabled) ? (
              <AssigneeSelect
                options={assigneeOptions}
                value={assigneeFilter}
                onChange={onAssigneeChange}
                search={
                  assigneeSearchEnabled && onAssigneeSearchChange
                    ? {
                        value: assigneeSearchValue ?? '',
                        onChange: onAssigneeSearchChange,
                        results: assigneeSearchResults ?? EMPTY_ASSIGNEE_RESULTS,
                        loading: assigneeSearchLoading ?? false,
                        hasMore: assigneeSearchHasMore ?? false,
                      }
                    : undefined
                }
              />
            ) : null}

            {filtersLayout === 'select' ? (
              <>
                <FilterSelect
                  label={t('labels.status')}
                  value={statusFilter}
                  options={STATUS_OPTIONS}
                  onChange={onStatusChange}
                  disabled={!filtersEnabled}
                  neutral="all"
                />

                <FilterSelect
                  label={t('labels.priority')}
                  value={priorityFilter}
                  options={PRIORITY_OPTIONS}
                  onChange={onPriorityChange}
                  disabled={!filtersEnabled}
                  neutral="all"
                />

                <FilterSelect
                  label={t('labels.type')}
                  value={typeFilter}
                  options={TYPE_OPTIONS}
                  onChange={onTypeChange}
                  disabled={!filtersEnabled}
                  neutral="all"
                />

                <FilterSelect
                  label={t('labels.source')}
                  value={originFilter}
                  options={ORIGIN_OPTIONS}
                  onChange={onOriginChange}
                  disabled={!filtersEnabled}
                  neutral="all"
                />
              </>
            ) : null}

            {showDepTypes && treeDepTypes && onTreeDepTypesChange ? (
              <DepTypesSelect
                descriptors={DEP_TYPES}
                value={treeDepTypes}
                onChange={onTreeDepTypesChange}
              />
            ) : null}

            {/* Stage 2 — the view switcher, the board's column axis, the
                card-property toggles and the sort key all moved to the
                header rail (see ViewSwitch / ViewSettings in HeaderBar).
                What stays here narrows the SET of tasks; what left
                decides the SHAPE they are drawn in. Project focus stays
                because it is a filter: it picks which projects' tasks
                are on screen at all. */}

            {showKanbanAxis && projectFocus && onProjectFocusChange ? (
              <ProjectFocusSelect
                options={projectFocusOptions ?? []}
                value={projectFocus}
                pausedBy={projectFocusPausedBy}
                pausedBySpace={projectFocusPausedBySpace}
                onChange={onProjectFocusChange}
              />
            ) : null}

            {filtersLayout === 'select' ? (
              <FilterSelect
                label={t('labels.sort')}
                value={sort}
                options={SORT_DATA}
                onChange={(v) => {
                  if (searchActive && onSearchSortChange) {
                    onSearchSortChange(v);
                  } else {
                    onSortChange(v);
                  }
                }}
              />
            ) : null}

          </div>
          </>
        )}
      </div>
    </div>
  );
}
