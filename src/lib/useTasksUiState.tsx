/**
 * Tasks-column UI state (F4, Sc3, Q39).
 *
 * Persists the user's filter / view / sort preferences across reloads
 * via localStorage. Search is intentionally NOT persisted — the search
 * box should clear when the user navigates between projects so they
 * don't get stale matches lingering on a different surface.
 *
 * Per Q39: status filter, origin filter, view mode, and sort key all
 * persist. The four keys live under `skein.tasks.*` and are read once
 * on mount + written through on every change. SSR / private-mode
 * fallbacks degrade gracefully (default values, no throw).
 *
 * sk-30 / sk-46 — exposed as a React context so the column can read the
 * persisted filter set. The lens preset (`statusFilter='active'`,
 * `typeFilter='all'`, `originFilter='human-driven'`, `search=''`) is
 * applied as an EPHEMERAL OVERLAY by `useTaskSearchModes` (the same
 * pattern search uses, sk-44.4) — NOT by writing the persisted setters.
 *
 * Earlier (sk-30) the lens coordinator in `useLayoutState` reached back
 * through an imperative bridge and called the persisted filter setters
 * to apply the preset, which write-through to localStorage. A reload
 * mid-lens then dropped the in-memory snapshot but KEPT the preset in
 * storage, permanently clobbering the user's real preferences. sk-46
 * removed that bridge: the preset is now derived, the persisted state is
 * never touched, and a reload mid-lens preserves the user's true prefs.
 * `LENS_FILTER_PRESET` below is exported for `useTaskSearchModes` to read.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  KANBAN_AXES,
  KANBAN_DEFAULT_AXIS,
  type KanbanAxis,
} from './kanbanBoard';
import {
  KANBAN_DEFAULT_CARD_FIELDS,
  parseCardFields,
  serializeCardFields,
  type KanbanCardField,
} from './kanbanCardFields';
import {
  LIST_DEFAULT_CARD_FIELDS,
  parseListCardFields,
  serializeListCardFields,
  type ListCardFieldSet,
} from './listCardFields';
import {
  parseProjectFocus,
  serializeProjectFocus,
  type ProjectFocus,
} from './kanbanProjectFocus';
import {
  TREE_DEFAULT_COLUMNS,
  parseTreeColumns,
  serializeTreeColumns,
  type TreeColumnSet,
} from './treeColumns';
import {
  defaultSortDirection,
  formatSortPref,
  parseSortPref,
  type TasksSortDirection,
} from './taskSort';
import {
  FILTERS_LAYOUT_DEFAULT,
  FILTERS_LAYOUT_VALUES,
  type FiltersLayout,
} from './filtersLayout';
import type {
  OriginFilter,
  PriorityFilter,
  StatusFilter,
  TasksSortKey,
  TypeFilter,
  ViewMode,
} from '../api/issues';
import { useOptionalLayoutState } from './useLayoutState';

const STORAGE = {
  status: 'skein.tasks.statusFilter',
  origin: 'skein.tasks.originFilter',
  type: 'skein.tasks.typeFilter',
  priority: 'skein.tasks.priorityFilter',
  view: 'skein.tasks.view',
  sort: 'skein.tasks.sort',
  // sk-285.2.4 — which field the Kanban columns project. A PERSONAL
  // preference in the Linear sense: it is remembered the moment it is
  // picked, with no "save" step and no shared/board-level copy.
  kanbanAxis: 'skein.tasks.kanbanAxis',
  // sk-285.2.5 — which properties the board's cards print. Personal, in
  // the same Linear sense as the axis: flipping a switch IS saving it.
  // Stored as a CSV of field names; the key being ABSENT (never touched)
  // is what selects the defaults, so an empty selection persists as an
  // empty selection rather than snapping back.
  kanbanCardFields: 'skein.tasks.kanbanCardFields',
  // sk-285.2.6 — which projects the board is focused on. Personal, in
  // the same Linear sense as the axis and the card fields. Stored as a
  // CSV of project uuids; an empty / absent value is the same board
  // (every visible project), so no absence semantics are needed here.
  kanbanProjectFocus: 'skein.tasks.kanbanProjectFocus',
  // sk-285.2.19 — which columns the tree TABLE prints. Its OWN key, not
  // a share of `kanbanCardFields`: the board and the tree are two
  // surfaces, and narrowing one must never narrow the other. Same
  // absence semantics as the card fields — the key being missing is what
  // selects the defaults, so an empty selection (a bare tree of titles)
  // persists as an empty selection.
  treeColumns: 'skein.tasks.treeColumns',
  // Which attributes the LIST cards print. The third key of the same
  // family, and a third key rather than a share of either of the other
  // two for the same reason `treeColumns` is not a share of
  // `kanbanCardFields`: the list, the board and the tree are three
  // surfaces, and narrowing one must never narrow another. Same absence
  // semantics — the key being missing is what selects the defaults, so
  // an empty selection (a list of bare titles) persists as one.
  listCardFields: 'skein.tasks.listCardFields',
  // sk-285.7 T025 (FR-002) — which SHAPE the filter panel is drawn in
  // (comboboxes / chips). A plain enum, so it takes the plain
  // `readEnum` / `writeEnum` recipe the four filter dimensions above
  // use, and NOT the absence semantics of the three field-set keys: a
  // layout has no "empty selection" to tell apart from "never touched",
  // so a missing key and a damaged one mean the same thing — the
  // default.
  //
  // ONE key, not one per view: the panel is one panel, shared by Cards,
  // Tree and Board (handoff §6 — "Filter panel (shared for Cards /
  // Tree / Board)», and the caption inside the panel says so to the
  // reader). Per-view keys would let the same reader meet two different
  // panels over the same filter values.
  filtersLayout: 'skein.tasks.filtersLayout',
} as const;

// sk-303.14 (T025) — `'unreviewed'` is DELIBERATELY ABSENT, for the same
// reason `'relevance'` is absent from SORT_VALUES below: it is a selection
// carried by the address, not a stored preference. Keeping it out of this
// whitelist is what makes the exclusion structural — `readEnum` rejects a
// hand-edited or legacy storage value naming it, and `setStatusFilter`
// refuses to write it, so no path leaves the shell opening on a selection
// the user never took. Do NOT add it here.
const STATUS_VALUES: readonly StatusFilter[] = [
  'active',
  'open',
  'in_progress',
  'blocked',
  'deferred',
  'standing',
  'closed',
  'all',
];
const ORIGIN_VALUES: readonly OriginFilter[] = [
  'human-driven',
  'agent-autonomous',
  'all',
];
const TYPE_VALUES: readonly TypeFilter[] = [
  'bug',
  'feature',
  'task',
  'epic',
  'chore',
  'decision',
  'idea',
  'note',
  'all',
];
const PRIORITY_VALUES: readonly PriorityFilter[] = [
  'all',
  '0',
  '1',
  '2',
  '3',
  '4',
];
const VIEW_VALUES: readonly ViewMode[] = ['cards', 'tree', 'kanban'];
// sk-50 — `'relevance'` is DELIBERATELY ABSENT from this whitelist. It is
// an ephemeral, search-only sort key owned by `useTaskSearchModes`'
// `searchSort` overlay; it must never round-trip through localStorage.
// Keeping it out here means `readEnum` rejects any stray persisted
// 'relevance' (e.g. from a hand-edited storage value) and falls back to
// the default — so the combobox can never show 'Relevance' outside an
// active search. Do NOT add 'relevance' to this list.
const SORT_VALUES: readonly TasksSortKey[] = [
  'priority-updated',
  'updated',
  'priority',
  'created',
  'id',
];

const KANBAN_AXIS_VALUES: readonly KanbanAxis[] = KANBAN_AXES;

function readEnum<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw && (allowed as readonly string[]).includes(raw)) {
      return raw as T;
    }
  } catch {
    /* SSR / private mode — ignore */
  }
  return fallback;
}

/**
 * sk-285.2.5 — read the persisted card-field set.
 *
 * Distinct from {@link readEnum} because the fallback is not a value but
 * an ABSENCE: only a missing key means "use the defaults". A stored
 * empty string is a real, deliberate choice (a card of nothing but its
 * title) and has to round-trip as one.
 */
function readCardFields(key: string): ReadonlySet<KanbanCardField> {
  try {
    const parsed = parseCardFields(window.localStorage.getItem(key));
    if (parsed !== null) return parsed;
  } catch {
    /* SSR / private mode — ignore */
  }
  return new Set(KANBAN_DEFAULT_CARD_FIELDS);
}

/**
 * sk-285.2.19 — read the persisted tree-column set.
 *
 * Same absence semantics as {@link readCardFields}, and a separate
 * function reading a separate key on purpose: the two preferences share
 * a shape, not a value.
 *
 * `parseTreeColumns` answers `null` for BOTH "no key" and "a value this
 * build cannot read", and both mean the same thing here: the defaults. A
 * damaged value must never arrive as the empty set — that is somebody's
 * deliberate «titles only» choice, and handing it back for a value
 * nobody chose is how an accident becomes a permanent preference.
 */
function readTreeColumns(key: string): TreeColumnSet {
  try {
    const parsed = parseTreeColumns(window.localStorage.getItem(key));
    if (parsed !== null) return parsed;
  } catch {
    /* SSR / private mode — ignore */
  }
  return new Set(TREE_DEFAULT_COLUMNS);
}

/**
 * Read the persisted list-card field set.
 *
 * Same absence semantics as {@link readTreeColumns}, and a separate
 * function reading a separate key on purpose: the three preferences
 * share a shape, not a value.
 *
 * `parseListCardFields` answers `null` for BOTH "no key" and "a value
 * this build cannot read", and both mean the same thing here: the
 * defaults. A damaged value must never arrive as the empty set — that is
 * somebody's deliberate «titles only» choice, and handing it back for a
 * value nobody chose is how an accident becomes a permanent preference.
 */
function readListCardFields(key: string): ListCardFieldSet {
  try {
    const parsed = parseListCardFields(window.localStorage.getItem(key));
    if (parsed !== null) return parsed;
  } catch {
    /* SSR / private mode — ignore */
  }
  return new Set(LIST_DEFAULT_CARD_FIELDS);
}

/**
 * sk-285.2.19 (step 4) — read the persisted sort preference: which key,
 * read which way.
 *
 * Not {@link readEnum}, because the stored value is no longer just the
 * key: it is `key:direction` (`lib/taskSort.ts` owns that encoding), the
 * two halves of ONE preference under the ONE `skein.tasks.sort` key that
 * has always held the list's order. Values written before directions
 * existed are bare keys and still load — as that key at its natural
 * direction, which is what they meant.
 *
 * The KEY whitelist stays here (see `SORT_VALUES` and its `relevance`
 * note): a stored key this build does not persist is rejected exactly as
 * before, and the fallback is the shipped default, not a half-restored
 * preference.
 */
function readSortPref(): { sort: TasksSortKey; direction: TasksSortDirection } {
  try {
    const parsed = parseSortPref(window.localStorage.getItem(STORAGE.sort));
    if (parsed && (SORT_VALUES as readonly string[]).includes(parsed.sort)) {
      const sort = parsed.sort as TasksSortKey;
      return { sort, direction: parsed.direction ?? defaultSortDirection(sort) };
    }
  } catch {
    /* SSR / private mode — ignore */
  }
  return {
    sort: 'priority-updated',
    direction: defaultSortDirection('priority-updated'),
  };
}

function writeEnum(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private mode / quota — ignore */
  }
}

/**
 * sk-98 — anchor for the rooted-subtree view. When a user expands an
 * epic found in blob-mode results, the Tasks column switches to Tree
 * view ROOTED at that epic (epic + parent-child descendants). The
 * anchor carries the epic id + its project UUID (blob `SearchItem`s map
 * `projectId` through `searchItemToSummary`). Clearing the anchor drops
 * back to the underlying blob results.
 */
export interface TreeRootAnchor {
  id: string;
  projectId: string;
}

export interface TasksUiState {
  statusFilter: StatusFilter;
  originFilter: OriginFilter;
  typeFilter: TypeFilter;
  /**
   * sk-86 — priority filter (the pill row right after the status row).
   * `'all'` = no filter; `'0'`..`'4'` narrow to that single board priority.
   * Persisted to localStorage like status / origin / type.
   */
  priorityFilter: PriorityFilter;
  view: ViewMode;
  /**
   * sk-285.2.4 — the Kanban column axis. Read only by the board (and by
   * the axis dropdown, which is only rendered in Kanban view), so it
   * never affects the Cards / Tree bodies. Persisted like `view` and
   * `sort`: picking an axis IS saving it.
   */
  kanbanAxis: KanbanAxis;
  /**
   * sk-285.2.5 — which properties the board's cards print («display
   * properties», Linear-style). Read only by the board and by its
   * picker, both of which live in Kanban view, so Cards / Tree are
   * untouched. Defaults to the set the board shipped with, so a user
   * who never opens the picker sees no change at all.
   *
   * A `ReadonlySet` rather than an array so "is this field on" is a
   * lookup, and so the value has no meaningless ordering to disagree
   * about.
   */
  kanbanCardFields: ReadonlySet<KanbanCardField>;
  /**
   * sk-285.2.6 — the projects the board is focused on (uuids). Empty =
   * every visible project, which is the board a user who never opened
   * the picker gets. Read by the board and by its picker, both of which
   * live in Kanban view, so Cards / Tree are untouched.
   *
   * PAUSED, not applied, while a single project is open in the Projects
   * column — see `lib/kanbanProjectFocus.ts` for why the explicit click
   * outranks the saved preference.
   */
  kanbanProjectFocus: ProjectFocus;
  /**
   * sk-285.2.19 — which columns the tree table prints. Read only by the
   * tree body and by its picker, both of which live in Tree view, so
   * Cards / Kanban are untouched — the exact mirror of what
   * `kanbanCardFields` is to the board.
   *
   * The structural title column is NOT in this set (see
   * `lib/treeColumns.ts`): it carries the chevron, the indent and the
   * connector, so switching it off would delete the tree rather than
   * hide a property.
   */
  treeColumns: TreeColumnSet;
  /**
   * Which attributes the LIST cards print. Read only by the cards body
   * and by its picker, both of which live in Cards view, so Tree /
   * Kanban are untouched — the exact mirror of what `treeColumns` is to
   * the tree and `kanbanCardFields` is to the board.
   *
   * The title is NOT in this set (see `lib/listCardFields.ts`): a card
   * with no title is not a narrowed card, it is an unreadable one.
   */
  listCardFields: ListCardFieldSet;
  /**
   * sk-285.7 T025 (FR-002) — which shape the filter panel is drawn in.
   *
   * NOT a filter and deliberately listed among them anyway: it is read
   * by the same panel, persisted by the same recipe and lives in the
   * same provider. What keeps it honest is that no query reads it —
   * `useTasks` is handed the dimensions above and never this — so a
   * layout switch cannot move a single row of the list. See
   * `lib/filtersLayout.ts`.
   */
  filtersLayout: FiltersLayout;
  sort: TasksSortKey;
  /**
   * sk-285.2.19 (step 4) — which way {@link sort} is read. Persisted
   * with the key, in the SAME `skein.tasks.sort` value (`key:direction`),
   * because it is the other half of one preference and not a second one:
   * see the module doc of `lib/taskSort.ts`.
   *
   * Every key has a natural direction (`updated` = newest first, and so
   * on) — that is what this holds until the reader reverses it by
   * clicking the tree table's column header a second time.
   */
  sortDir: TasksSortDirection;
  search: string;
  /**
   * sk-79 — assignee filter (the avatar-chip row above the status row).
   * `null` = no filter ("anyone"); otherwise the picked assignee's
   * username. Deliberately NOT persisted to localStorage and NOT written
   * through (mirrors `search`): a username is project-member-specific, so
   * carrying it across a project switch would silently yield an empty list
   * on a project the user isn't a member of. TasksColumn resets it to null
   * whenever `selectedProject` changes.
   */
  assigneeFilter: string | null;
  /**
   * sk-98 — rooted-subtree anchor (the epic the tree is rooted at), or
   * null when no anchor is active. In-memory only (NOT persisted, same
   * as `search` / `assigneeFilter`): the anchor is a transient drill-in
   * from blob results and must not survive a reload.
   */
  treeRootAnchor: TreeRootAnchor | null;
}

/**
 * Snapshot shape captured before a lens turns ON. The lens
 * coordinator stores this in-memory (NOT localStorage — reloads
 * deliberately drop the snapshot so users in mid-lens after refresh
 * don't get a stale restore). On lens OFF, every field is applied
 * back via the matching setter.
 */
export type TasksUiSnapshot = Readonly<TasksUiState>;

export interface TasksUiActions {
  setStatusFilter: (v: StatusFilter) => void;
  setOriginFilter: (v: OriginFilter) => void;
  setTypeFilter: (v: TypeFilter) => void;
  /** sk-86 — set the priority filter; `'all'` clears it. */
  setPriorityFilter: (v: PriorityFilter) => void;
  setView: (v: ViewMode) => void;
  /** sk-285.2.4 — pick the Kanban column axis (write-through to storage). */
  setKanbanAxis: (v: KanbanAxis) => void;
  /**
   * sk-285.2.5 — replace the board's card-field set (write-through to
   * storage). No "save" step: the switch IS the save.
   */
  setKanbanCardFields: (v: ReadonlySet<KanbanCardField>) => void;
  /**
   * sk-285.2.6 — replace the board's focused-project set (write-through
   * to storage). Passing an empty set is the "all projects" reset.
   */
  setKanbanProjectFocus: (v: ProjectFocus) => void;
  /**
   * sk-285.2.19 — replace the tree's column set (write-through to
   * storage). No "save" step: the switch IS the save. Takes only
   * switchable columns, so the pinned title column cannot be removed
   * through this setter.
   */
  setTreeColumns: (v: TreeColumnSet) => void;
  /**
   * Replace the list's attribute set (write-through to storage). No
   * "save" step: the switch IS the save. Takes only switchable fields,
   * so the card's title cannot be removed through this setter.
   */
  setListCardFields: (v: ListCardFieldSet) => void;
  /**
   * sk-285.7 T025 — pick the panel's layout (write-through to storage).
   * No "save" step: the switch IS the save, as everywhere else here.
   *
   * It touches NOTHING but the layout. That is the whole contract of
   * US-5 and it is a property of this setter's body, not a convention:
   * it calls one state setter and no other.
   */
  setFiltersLayout: (v: FiltersLayout) => void;
  /**
   * Pick the sort KEY. Resets the direction to that key's natural one —
   * "sort by Updated" means newest-first, whichever way the previous key
   * happened to be reversed. The tree table's header follows this with
   * {@link TasksUiActions.setSortDir} when it wants the other direction.
   */
  setSort: (v: TasksSortKey) => void;
  /** Reverse (or set) the direction the current sort key is read in. */
  setSortDir: (v: TasksSortDirection) => void;
  setSearch: (v: string) => void;
  /** sk-79 — set the assignee filter; pass null to clear ("anyone"). */
  setAssigneeFilter: (v: string | null) => void;
  /** sk-98 — set the rooted-subtree anchor; pass null to clear it. */
  setTreeRootAnchor: (v: TreeRootAnchor | null) => void;
}

type TasksUiContextValue = TasksUiState & TasksUiActions;

const TasksUiContext = createContext<TasksUiContextValue | null>(null);

/**
 * The lens preset applied to filter state when a lens (on-me /
 * delegated) turns ON. Search is cleared; status falls back to
 * 'active' so the user sees the open backlog; type goes to 'all'
 * (lenses care about ownership, not type); origin lands on
 * 'human-driven' (sk-30 spec — lenses are about human collaboration,
 * not autonomous-agent traffic).
 */
export const LENS_FILTER_PRESET: Pick<
  TasksUiState,
  'statusFilter' | 'typeFilter' | 'originFilter' | 'priorityFilter' | 'search'
> = {
  statusFilter: 'active',
  typeFilter: 'all',
  originFilter: 'human-driven',
  // sk-86 — a lens is an ownership view, not a priority view: open with
  // every priority shown, same spirit as type='all'.
  priorityFilter: 'all',
  search: '',
};

/**
 * TasksUiStateProvider — wraps the Shell so every column / surface
 * reads the same filter state. Mounted inside LayoutProvider in
 * Shell.tsx so the lens coordinator can drive it.
 */
export function TasksUiStateProvider({ children }: { children: ReactNode }) {
  const [statusFilter, setStatusFilterState] = useState<StatusFilter>(() =>
    readEnum<StatusFilter>(STORAGE.status, STATUS_VALUES, 'active'),
  );
  const [originFilter, setOriginFilterState] = useState<OriginFilter>(() =>
    readEnum<OriginFilter>(STORAGE.origin, ORIGIN_VALUES, 'all'),
  );
  const [typeFilter, setTypeFilterState] = useState<TypeFilter>(() =>
    readEnum<TypeFilter>(STORAGE.type, TYPE_VALUES, 'all'),
  );
  const [priorityFilter, setPriorityFilterState] = useState<PriorityFilter>(() =>
    readEnum<PriorityFilter>(STORAGE.priority, PRIORITY_VALUES, 'all'),
  );
  const [view, setViewState] = useState<ViewMode>(() =>
    readEnum<ViewMode>(STORAGE.view, VIEW_VALUES, 'cards'),
  );
  const [kanbanAxis, setKanbanAxisState] = useState<KanbanAxis>(() =>
    readEnum<KanbanAxis>(STORAGE.kanbanAxis, KANBAN_AXIS_VALUES, KANBAN_DEFAULT_AXIS),
  );
  const [kanbanCardFields, setKanbanCardFieldsState] = useState<
    ReadonlySet<KanbanCardField>
  >(() => readCardFields(STORAGE.kanbanCardFields));
  const [kanbanProjectFocus, setKanbanProjectFocusState] = useState<ProjectFocus>(
    () => {
      try {
        return parseProjectFocus(window.localStorage.getItem(STORAGE.kanbanProjectFocus));
      } catch {
        /* SSR / private mode — ignore */
        return new Set<string>();
      }
    },
  );
  const [treeColumns, setTreeColumnsState] = useState<TreeColumnSet>(() =>
    readTreeColumns(STORAGE.treeColumns),
  );
  /**
   * sk-285.2.19 — the encoded column set as it stands IN STORAGE, so the
   * write-through effect below can tell "the user changed something"
   * from "React just mounted".
   *
   * Seeded from the set the provider started with, which is either what
   * the key held or — when there is no key — the defaults. That second
   * case is the one this ref exists for: without it the effect fires on
   * mount and writes THIS build's defaults into a key the user never
   * touched, and the documented "a missing key is the ONLY thing that
   * means «use the defaults»" (`lib/treeColumns.ts`) stops being true
   * one render after the app opens. The preference would then be frozen
   * at the defaults of whichever build the user happened to open first,
   * which is precisely the protection absence was supposed to give them.
   *
   * It moves with every write, so a user who switches a column off and
   * back on still gets that second write — the ref tracks what is
   * stored, not what was stored at mount.
   */
  const treeColumnsWrittenRef = useRef<string | null>(null);
  if (treeColumnsWrittenRef.current === null) {
    treeColumnsWrittenRef.current = serializeTreeColumns(treeColumns);
  }
  const [listCardFields, setListCardFieldsState] = useState<ListCardFieldSet>(
    () => readListCardFields(STORAGE.listCardFields),
  );
  /**
   * The encoded field set as it stands IN STORAGE, so the write-through
   * effect below can tell "the user changed something" from "React just
   * mounted" — the same guard, for the same reason, as
   * {@link treeColumnsWrittenRef}: without it the effect fires on mount
   * and writes THIS build's defaults into a key the user never touched,
   * and "a missing key is the ONLY thing that means «use the defaults»"
   * stops being true one render after the app opens.
   */
  const listCardFieldsWrittenRef = useRef<string | null>(null);
  if (listCardFieldsWrittenRef.current === null) {
    listCardFieldsWrittenRef.current = serializeListCardFields(listCardFields);
  }
  const [filtersLayout, setFiltersLayoutState] = useState<FiltersLayout>(() =>
    readEnum<FiltersLayout>(
      STORAGE.filtersLayout,
      FILTERS_LAYOUT_VALUES,
      FILTERS_LAYOUT_DEFAULT,
    ),
  );
  const [sort, setSortState] = useState<TasksSortKey>(() => readSortPref().sort);
  const [sortDir, setSortDirState] = useState<TasksSortDirection>(
    () => readSortPref().direction,
  );
  const [search, setSearchState] = useState<string>('');
  // sk-79 — assignee filter. In-memory only (not persisted); see the
  // TasksUiState.assigneeFilter doc-comment for why it must not survive a
  // project switch.
  const [assigneeFilter, setAssigneeFilterState] = useState<string | null>(null);
  // sk-98 — rooted-subtree anchor. In-memory only (no writeEnum / persist
  // effect); see the TasksUiState.treeRootAnchor doc-comment.
  const [treeRootAnchor, setTreeRootAnchorState] =
    useState<TreeRootAnchor | null>(null);

  // Write-through persistence — search is intentionally NOT persisted.
  useEffect(() => {
    writeEnum(STORAGE.status, statusFilter);
  }, [statusFilter]);
  useEffect(() => {
    writeEnum(STORAGE.origin, originFilter);
  }, [originFilter]);
  useEffect(() => {
    writeEnum(STORAGE.type, typeFilter);
  }, [typeFilter]);
  useEffect(() => {
    writeEnum(STORAGE.priority, priorityFilter);
  }, [priorityFilter]);
  // `view` has NO write-through effect on purpose — `setView` below is
  // its only writer, and it writes storage itself. See the doc-comment
  // there for why a second, effect-shaped writer is not a harmless
  // duplicate but a race that loses the user's click.
  useEffect(() => {
    writeEnum(STORAGE.kanbanAxis, kanbanAxis);
  }, [kanbanAxis]);
  useEffect(() => {
    writeEnum(STORAGE.kanbanCardFields, serializeCardFields(kanbanCardFields));
  }, [kanbanCardFields]);
  useEffect(() => {
    writeEnum(STORAGE.kanbanProjectFocus, serializeProjectFocus(kanbanProjectFocus));
  }, [kanbanProjectFocus]);
  // sk-285.2.19 — write-through, but NOT on mount: the effect writes only
  // what differs from what storage already holds (see
  // `treeColumnsWrittenRef`). Picking still saves itself with no save
  // step; a provider that merely rendered still stores nothing.
  useEffect(() => {
    const encoded = serializeTreeColumns(treeColumns);
    if (encoded === treeColumnsWrittenRef.current) return;
    treeColumnsWrittenRef.current = encoded;
    writeEnum(STORAGE.treeColumns, encoded);
  }, [treeColumns]);
  // Write-through, but NOT on mount — see `listCardFieldsWrittenRef`.
  useEffect(() => {
    const encoded = serializeListCardFields(listCardFields);
    if (encoded === listCardFieldsWrittenRef.current) return;
    listCardFieldsWrittenRef.current = encoded;
    writeEnum(STORAGE.listCardFields, encoded);
  }, [listCardFields]);
  // sk-285.7 T025 (FR-002) — the layout choice survives the session.
  // Plain write-through, like the four filter dimensions above and
  // unlike `view`: the layout switch lives INSIDE the panel, which only
  // exists on the Tasks column, so there is no "click on a focus page,
  // navigate, unmount in the same commit" path for the effect to lose
  // (that is what `setView` writes synchronously to avoid).
  useEffect(() => {
    writeEnum(STORAGE.filtersLayout, filtersLayout);
  }, [filtersLayout]);
  useEffect(() => {
    writeEnum(STORAGE.sort, formatSortPref({ sort, direction: sortDir }));
  }, [sort, sortDir]);

  // sk-303.14 (T024) — the layout is read HERE, above the setters, because
  // two things below need it: `setSearch` (the selection and a non-empty
  // search box are mutually exclusive — see there) and the entry
  // normalisation further down (which drops the three in-memory narrowings
  // this provider owns when the selection is taken).
  //
  // `useOptionalLayoutState` rather than `useLayoutState`: tests mount this
  // provider on its own, with no LayoutProvider above it. No layout → no
  // selection → both mechanisms below are inert.
  const layout = useOptionalLayoutState();
  const unreviewedSelected = layout?.unreviewedSelected ?? false;
  const setUnreviewedSelected = layout?.setUnreviewedSelected;

  const setStatusFilter = useCallback((v: StatusFilter) => {
    // sk-303.14 — never persist a non-whitelisted status. The chips route
    // the `'unreviewed'` sentinel to the address parameter instead of
    // here (see `useTaskSearchModes`), so this guard should never fire;
    // it exists so the "the sentinel cannot reach storage" property holds
    // for any future caller too, rather than resting on one call site
    // staying correct. Same shape as the `setSort` guard below.
    if (!STATUS_VALUES.includes(v)) return;
    setStatusFilterState(v);
  }, []);
  const setOriginFilter = useCallback(
    (v: OriginFilter) => setOriginFilterState(v),
    [],
  );
  const setTypeFilter = useCallback((v: TypeFilter) => setTypeFilterState(v), []);
  const setPriorityFilter = useCallback(
    (v: PriorityFilter) => setPriorityFilterState(v),
    [],
  );
  /**
   * sk-285.6.17 — the ONE preference here persisted by its SETTER
   * instead of by a write-through effect. There is no effect for
   * `view`; this is its only writer.
   *
   * Same reason `useLayoutState.setInboxTab` writes synchronously, and
   * the same flow: the view switcher lives in the header, which is
   * painted on every page, and from a focus page (/settings/*,
   * /legacy/*, /activity) choosing a view now calls `setView` and then
   * `navigate('/')` in the SAME event. Every surface mounts its own
   * TasksUiStateProvider, so React's batching unmounts THIS provider in
   * the very commit that would have run its write-through effect, and
   * the value is dropped.
   *
   * Measured in Chromium before the fix: from /settings/api-keys the
   * click landed on "/" with `skein.tasks.view` still holding the
   * previous value and the previous view drawn — the button the user
   * pressed was not the one that came up. Writing here makes the choice
   * durable at the moment of the click, before anything can unmount.
   *
   * ── Why the write-through effect is GONE, not kept as a no-op ──────
   * It was first left in place as a harmless duplicate. It is not
   * harmless: the effect closes over the `view` of the render that
   * scheduled it, so a mount-commit effect that has not flushed yet
   * still holds the PREVIOUS value. React flushes pending passive
   * effects before it renders the next update, i.e. AFTER this setter
   * has already written the new value — the stale effect then puts the
   * old one back. That is a second writer racing the first, and its
   * symptom is the very bug this task fixed: the click lands on "/"
   * with the previous view stored.
   *
   * Provenance, stated exactly: review reported
   * `viewPersistOnUnmount.test.tsx` red on BOTH its tests in one full
   * suite run out of five, `expected 'cards' to be 'tree'` — 'cards'
   * being precisely the value a stale effect would restore. The
   * intermittency was NOT reproduced afterwards (12 further full runs,
   * none red), so the race is argued from the code above, not from a
   * repro; what IS reproducible is the effect writing on mount, which
   * the test below pins.
   *
   * Removal is safe because `setViewState` has exactly two call sites:
   * the `useState` initialiser above and this setter. Nothing else can
   * move `view`, so nothing else needs persisting. Mounting therefore
   * writes NOTHING — the key stays absent until the user picks a view,
   * which is also what `treeColumns` / `listCardFields` guarantee with
   * their refs, and what `lib/__tests__/viewPersistOnUnmount.test.tsx`
   * pins.
   */
  const setView = useCallback((v: ViewMode) => {
    setViewState(v);
    writeEnum(STORAGE.view, v);
  }, []);
  const setKanbanAxis = useCallback((v: KanbanAxis) => setKanbanAxisState(v), []);
  const setKanbanCardFields = useCallback(
    (v: ReadonlySet<KanbanCardField>) => setKanbanCardFieldsState(v),
    [],
  );
  const setKanbanProjectFocus = useCallback(
    (v: ProjectFocus) => setKanbanProjectFocusState(v),
    [],
  );
  const setTreeColumns = useCallback(
    (v: TreeColumnSet) => setTreeColumnsState(v),
    [],
  );
  const setListCardFields = useCallback(
    (v: ListCardFieldSet) => setListCardFieldsState(v),
    [],
  );
  const setFiltersLayout = useCallback(
    (v: FiltersLayout) => setFiltersLayoutState(v),
    [],
  );
  const setSort = useCallback((v: TasksSortKey) => {
    // sk-50 — never persist a non-whitelisted sort. `'relevance'` is an
    // ephemeral search-only overlay (lives in useTaskSearchModes, never
    // here); if any caller ever routed it into the persisted setter it
    // would write-through to localStorage. readEnum already rejects it on
    // load, but guard the write path too so the "relevance never round-
    // trips storage" intent holds for any future caller.
    if (!SORT_VALUES.includes(v)) return;
    setSortState(v);
    // A key carries its own reading direction; picking one from the
    // combobox is picking that direction too. The header of an
    // already-sorted column reverses it right after this call.
    setSortDirState(defaultSortDirection(v));
  }, []);
  const setSortDir = useCallback(
    (v: TasksSortDirection) => setSortDirState(v),
    [],
  );
  // sk-303.14 (B/1 review C1) — the unreviewed selection and a non-empty
  // search box are MUTUALLY EXCLUSIVE on this surface, and typing is what
  // breaks the tie: the selection is RELEASED, visibly, chip and address
  // together.
  //
  // Why they cannot coexist. The selection has exactly one definition and
  // it lives on the wire — `unreviewed=true` on the two list endpoints. A
  // non-empty box routes the project-scoped half of the Delegated surface
  // to the hybrid `/search` endpoint instead (`useTasks` → `searchMode`),
  // and that endpoint takes no such parameter: the rows that come back are
  // not a subset of the unreviewed set, while the chip goes on claiming
  // they are. That is "the number and the list disagree" — the failure INV-3
  // forbids, and it is reachable in two ordinary gestures — take the
  // selection, pick a project (the parameter survives the path change),
  // start typing.
  //
  // Why RELEASE and not BLOCK. Disabling the box while the selection is on
  // would take the more frequent gesture away for the rarer one, and it
  // would still have to answer the same question the moment the reader
  // wants both. Releasing says what actually happened, in the one place the
  // reader is looking.
  //
  // Why on EVERY delegated surface and not only where the query would
  // really lose the parameter. The cross-project half keeps the list
  // endpoint and searches the loaded rows on the client, so there the
  // selection would in fact survive — but a chip whose survival depends on
  // whether a project happens to be selected is a rule no reader can hold,
  // and an inconsistent one is worse than a plain one. One sentence covers
  // it: search and the selection do not run together.
  //
  // The opposite direction needs no guard. TAKING the selection already
  // clears the box (the entry normalisation below), so pressing the chip
  // during a search stays a coherent gesture and the chip stays live.
  const setSearch = useCallback(
    (v: string) => {
      if (v !== '' && unreviewedSelected) setUnreviewedSelected?.(false);
      setSearchState(v);
    },
    [setUnreviewedSelected, unreviewedSelected],
  );
  const setAssigneeFilter = useCallback(
    (v: string | null) => setAssigneeFilterState(v),
    [],
  );
  const setTreeRootAnchor = useCallback(
    (v: TreeRootAnchor | null) => setTreeRootAnchorState(v),
    [],
  );

  // sk-46 — the lens preset is no longer pushed into the persisted
  // filter state through an imperative bridge. `useTaskSearchModes`
  // derives the preset as an ephemeral overlay (reading
  // `LENS_FILTER_PRESET`), so this provider stays a pure leaf consumer:
  // it owns the persisted prefs and nothing reaches back to overwrite
  // them on lens activation. That's what keeps a reload mid-lens from
  // clobbering the user's real preferences.

  // sk-303.14 (T024) — the THREE in-memory narrowings this provider owns
  // (`search`, `assigneeFilter`, `treeRootAnchor`) are dropped when the
  // unreviewed selection is taken, and dropped DURING RENDER.
  //
  // Why they must go: SC-017 normalises the first frame across every
  // dimension the surface can narrow by, not just the four the lens preset
  // covers. An assignee chip left over from the previous view, or a rooted
  // subtree, or a live search term, all narrow the list — and every one of
  // them is part of the Tasks query key, so a first frame under them shows
  // fewer rows than the second number counts (INV-3) and the correction
  // arrives as an extra request.
  //
  // Why during render and not in an effect: the same reason the lens seed
  // moved (see `useTaskSearchModes`) — an effect lands after the first
  // request is already in flight, which is "replaced immediately after
  // the jump", exactly what US-2 rules out. React re-runs this provider
  // before rendering children or firing effects, so the column never sees
  // the stale values; the locals below carry the cleared values through
  // THIS pass so even the memoised context value is already correct.
  //
  // The layout this reads is resolved once, above the setters (see there).
  const [seededFor, setSeededFor] = useState(unreviewedSelected);
  let liveSearch = search;
  let liveAssigneeFilter = assigneeFilter;
  let liveTreeRootAnchor = treeRootAnchor;
  if (seededFor !== unreviewedSelected) {
    setSeededFor(unreviewedSelected);
    // Only on the way IN. Dropping the selection leaves the surface as the
    // user left it — there is nothing to normalise on the way out.
    if (unreviewedSelected) {
      liveSearch = '';
      liveAssigneeFilter = null;
      liveTreeRootAnchor = null;
      setSearchState('');
      setAssigneeFilterState(null);
      setTreeRootAnchorState(null);
    }
  }

  const value = useMemo<TasksUiContextValue>(
    () => ({
      statusFilter,
      originFilter,
      typeFilter,
      priorityFilter,
      view,
      kanbanAxis,
      kanbanCardFields,
      kanbanProjectFocus,
      treeColumns,
      listCardFields,
      filtersLayout,
      sort,
      sortDir,
      search: liveSearch,
      assigneeFilter: liveAssigneeFilter,
      treeRootAnchor: liveTreeRootAnchor,
      setStatusFilter,
      setOriginFilter,
      setTypeFilter,
      setPriorityFilter,
      setView,
      setKanbanAxis,
      setKanbanCardFields,
      setKanbanProjectFocus,
      setTreeColumns,
      setListCardFields,
      setFiltersLayout,
      setSort,
      setSortDir,
      setSearch,
      setAssigneeFilter,
      setTreeRootAnchor,
    }),
    [
      statusFilter,
      originFilter,
      typeFilter,
      priorityFilter,
      view,
      kanbanAxis,
      kanbanCardFields,
      kanbanProjectFocus,
      treeColumns,
      listCardFields,
      filtersLayout,
      sort,
      sortDir,
      liveSearch,
      liveAssigneeFilter,
      liveTreeRootAnchor,
      setStatusFilter,
      setOriginFilter,
      setTypeFilter,
      setPriorityFilter,
      setView,
      setKanbanAxis,
      setKanbanCardFields,
      setKanbanProjectFocus,
      setTreeColumns,
      setListCardFields,
      setFiltersLayout,
      setSort,
      setSortDir,
      setSearch,
      setAssigneeFilter,
      setTreeRootAnchor,
    ],
  );

  return <TasksUiContext.Provider value={value}>{children}</TasksUiContext.Provider>;
}

export function useTasksUiState(): TasksUiContextValue {
  const ctx = useContext(TasksUiContext);
  if (ctx === null) {
    throw new Error('useTasksUiState must be used inside <TasksUiStateProvider>');
  }
  return ctx;
}
