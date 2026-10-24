import { memo, useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent } from 'react';
import { useDebouncedValue } from '@mantine/hooks';
import {
  IconAlarm,
  IconArrowLeft,
  IconCornerDownRight,
  IconLayoutColumns,
  IconLayoutSidebarLeftCollapse,
} from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { COL_BOUNDS, useLayoutState } from '../../lib/useLayoutState';
import { useProjectByHandle } from '../../lib/useProjectByHandle';
import { useProjectsList } from '../../lib/useProjectsList';
import {
  keepPreviousData,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { listComponents } from '../../api/components';
import { listMembers } from '../../api/projects';
import { delegateeLabel, needsDirectoryResolve } from '../../lib/delegateeChips';
import { listUserDirectory, type PersonStatus } from '../../api/users';
import { personLabel } from '../../components/UserMention';
import type { TFunction } from 'i18next';
import { useAuth } from '../../auth/AuthContext';
import { useTasks } from '../../lib/useTasks';
import { useTaskSearchModes } from '../../lib/useTaskSearchModes';
import {
  usePublishTasksOutlet,
  usePublishWorkspaceFill,
  type WorkspaceFill,
} from '../../lib/useTasksOutlet';
import { useTasksUiState, type TreeRootAnchor } from '../../lib/useTasksUiState';
import { useBlobMode } from '../../lib/useBlobMode';
import { extractIssueCodes } from '../../lib/extractIssueCodes';
import { buildIssueTree } from '../../lib/buildIssueTree';
import {
  compareIssuesBy,
  directionFor,
  sortDfsBlocks,
  type TasksSortDirection,
  type TasksSortPref,
} from '../../lib/taskSort';
import {
  countCollapsed,
  flattenTree,
  layeredToFlatRows,
  partitionStandingTreeRows,
  type FlatTreeRow,
} from '../../lib/flattenTree';
import { useTreeDepTypes } from '../../lib/useTreeDepTypes';
import { layeredTreeQueryKey, useLayeredTree } from '../../lib/useLayeredTree';
import { isStaleAgainstTasksColumnTreeClock } from '../../lib/tasksColumnTreeClock';
import { useTreeAncestors } from '../../lib/useTreeAncestors';
import {
  collectMatchAncestorIds,
  describeTreeNarrowing,
  mergeFilteredExpansion,
} from '../../lib/filteredTreeExpansion';
import type {
  IssueSummary,
  IssueTreeRowItem,
  StatusFilter,
} from '../../api/issues';
import type { DepType } from '../../api/dependencies';
import { TaskCard } from './TaskCard';
import { KanbanBoard } from './KanbanBoard';
import { useKanbanFoldMemory } from '../../lib/useKanbanFoldMemory';
import { KANBAN_DEFAULT_AXIS, type KanbanAxis } from '../../lib/kanbanBoard';
import type { KanbanCardField } from '../../lib/kanbanCardFields';
import type { TreeColumnSet } from '../../lib/treeColumns';
import {
  listCardFieldsMask,
  type ListCardFieldSet,
} from '../../lib/listCardFields';
import {
  EMPTY_PROJECT_FOCUS,
  focusWithinSpace,
  projectFocusOnPlace,
  replaceFocusWithinSpace,
  type ProjectFocus,
} from '../../lib/kanbanProjectFocus';
import { useMySpaces } from '../../lib/useMySpaces';
import { Link } from 'react-router-dom';
import { TaskFilters, type AssigneeOption, type ProjectFocusOption } from './TaskFilters';
import {
  TaskTreeVirtualList,
  type TaskTreeScroller,
} from './TaskTreeVirtualList';
import { BlobCodesResult } from './BlobCodesResult';
import { BudilnikLensBody } from './BudilnikLensBody';
import { useRingingIssueIds, useRingingTaskCount } from '../../lib/useReminders';
import { SkeinTooltip } from '../../components/SkeinTooltip';
import { useDeclareProjects } from '../../lib/liveProjectDeclaration';

/**
 * sk-285.2.8 — shared empty set for "nothing is auto-expanded". A fresh
 * `new Set()` each render would break the `visibleRows` memo on every
 * pass through an unnarrowed tree.
 */
const NO_AUTO_EXPAND: ReadonlySet<string> = new Set<string>();

/**
 * The style this column takes when it has no width of its own and grows
 * into the row instead.
 *
 * A flex basis of `0%` rather than `auto`, so the row's spare pixels land
 * here instead of being split against a content-sized basis; and the same
 * `min` a dragged column is held to, so "fills the row" can never mean
 * "squeezed to nothing".
 *
 * ONE constant for the two situations that need it — the workspace views
 * taking the room (sk-285.2.23) and the tablet mode handing this column
 * the leftover beside Details (sk-285.7 T020, `width === null`). They are
 * the same claim about the same box; two copies of it would drift.
 */
const ROW_FILLING_STYLE = { flex: '1 1 0%', minWidth: COL_BOUNDS.tasks.min };

/**
 * The Cards column at the width the user dragged.
 *
 * sk-551.43 — shrink 1 down to the same `min`, not `0 0`: the drag now
 * lets the column take everything the reading pane holds above its 420
 * floor (`lib/workspaceResize.ts#tasksDragBounds`), so on a window
 * narrower than the one it was dragged on the saved width no longer
 * fits beside the pane. The pane holds its floor (`index.css`,
 * `.shell-columns .details-frame .col-details`) and this column yields
 * first, the way the board and the tree yield beside the pane.
 */
function draggedWidthStyle(width: number) {
  return { width, flex: `0 1 ${width}px`, minWidth: COL_BOUNDS.tasks.min };
}

interface Props {
  /**
   * The column's pixel width, or `null` when it has none of its own.
   *
   * `null` is the TABLET mode (sk-285.7 T020, plan decision R10). There
   * the two navigation zones are slivers and this column takes the row's
   * leftover alongside Details — "zone widths are derived from the available
   * space, not from the desktop mode's persist". The persisted width is not
   * clamped, not rewritten and not even READ on that path: the caller
   * hands `null` instead of a number, which is what makes "persist is not
   * read" a property of the call rather than of a comment.
   *
   * It resolves to the same flex shape the two workspace views already
   * use when they fill the row, and for the same reason — a basis of 0
   * so the freed pixels land here rather than being split against a
   * content-sized one.
   */
  width: number | null;
  /**
   * Whole-column fold, the same one Projects (sk-290) and Queues (Q32)
   * carry. When true the column renders as a 44px vertical sliver
   * instead of the board; it is NOT unmounted and NOT `display:none`,
   * so the expand affordance keeps its place on screen and in the tab
   * order. Owned by `useLayoutState().tasksCollapsed` (localStorage
   * write-through).
   */
  collapsed: boolean;
  outboxMode: boolean;
  /**
   * sk-30 — "On me" lens, mutually exclusive with outboxMode upstream.
   * When ON, useTasks narrows the column to issues assigned to the
   * caller by someone else that the caller has accepted.
   */
  onMeMode: boolean;
  /**
   * sk-62.2 — Reminders lens, mutually exclusive with the
   * other two upstream. When ON the column REPLACES the normal board
   * with a flat, most-urgent-first list of issues that have reminders
   * (ringing on top), driven by the reminders query rather than
   * `useTasks`. Filters / search / blob mode are all suppressed.
   */
  budilnikMode: boolean;
}

/**
 * Tasks column (F4, Sc3) — wires `TaskFilters`, `useTasks`, and the
 * cards / tree body modes.
 *
 * URL/state matrix (driven by useLayoutState + outboxMode):
 *
 *   /projects/:alias               OFF → all tasks of that project
 *   /projects/:alias               ON  → tasks of that project, createdBy=me
 *   /                              OFF → empty-state (point at Projects)
 *   /                              ON  → cross-project /me/created-by
 *   /projects/:alias/issues/:id    any → same as /projects/:alias
 *   /issues/:id                    any → column hidden by Shell.tsx (overlay)
 *
 * Filters are independent of URL — status / origin / view / sort
 * persist across navigations via localStorage (Q39); search resets on
 * unmount because it's not persisted.
 *
 * Tree expand/collapse state persists per-project under
 * `skein.tasks.tree.{projectAlias}.expanded` so opening a tree in one
 * project doesn't bleed into another. While a filter / lens / search
 * narrows the column (sk-285.2.8) the tree additionally holds the path
 * to every match open, and any toggling done in that state is kept OUT
 * of that key — see `filterExpandOverrides` in TasksBody.
 *
 * The WHOLE column folds into a 44px vertical sliver via the "−" button
 * in its header, exactly as Projects (sk-290) and Queues (Q32) do;
 * clicking the sliver (or hitting Enter / Space on it — it is a real
 * `<button>`) expands it back. The flag lives in
 * `useLayoutState().tasksCollapsed` and is persisted to localStorage.
 * This is the OUTERMOST of three independent fold levels in this
 * column: the filter panel (`taskFiltersCollapsed`) and the per-node
 * tree carets are untouched by it, so reopening restores exactly the
 * shape the user left.
 */
export function TasksColumn({
  width,
  collapsed,
  outboxMode,
  onMeMode,
  budilnikMode,
}: Props) {
  const { t } = useTranslation('tasks');
  const { t: tCommon } = useTranslation('common');
  const layout = useLayoutState();
  const ui = useTasksUiState();
  const auth = useAuth();
  const projectsQ = useProjectsList();
  // sk-674.18 T052 — the place «space»: «my spaces» is the oracle the list
  // asks (`useTasks#selectedSpaceStatus`) and the source of its name for
  // the heading and the focus bar.
  const selectedSpace = layout.selectedProject === null ? layout.selectedSpace : null;
  const mySpacesQ = useMySpaces();
  const selectedSpaceRow =
    selectedSpace === null ? undefined : mySpacesQ.data?.items.find((sp) => sp.id === selectedSpace);
  const spaceName = selectedSpaceRow?.name ?? null;
  const selectedSpaceStatus: 'resolving' | 'found' | 'not-found' | 'unknown' =
    mySpacesQ.isSuccess
      ? selectedSpaceRow === undefined ? 'not-found' : 'found'
      : mySpacesQ.isLoading
        ? 'resolving'
        : 'unknown';
  // sk-62.2 — header count for the budilnik lens (distinct ringing
  // tasks). Drives the column-header count chip while the lens is on.
  const ringingTaskCount = useRingingTaskCount();

  // The list's «display properties», packed ONCE for every cards surface
  // this column can show — the blob-result panel here and the cards body
  // below. `TaskCard` is `memo()`d and takes the set as a NUMBER: handing
  // rows the `ReadonlySet` would give them a prop that compares unequal
  // on every render of this component (a keystroke in the search box is
  // one) and would silently undo that memo.
  const listFieldsMask = useMemo(
    () => listCardFieldsMask(ui.listCardFields),
    [ui.listCardFields],
  );

  // Debounce search at 200ms before triggering a re-query (and a
  // re-sort on the cross-project surface). Local-only state — search
  // is not persisted so we don't need to read it back from storage.
  const [debouncedTyping] = useDebouncedValue(ui.search, 200);
  // sk-303.14 (T024) — CLEARING the box is not debounced. The delay exists
  // to avoid a request per keystroke while the user types; an empty box has
  // nothing left to type and holding the previous term for another 200ms
  // only keeps a narrowing alive that the state has already dropped.
  //
  // Load-bearing for the unreviewed entry: that entry clears `ui.search`
  // during render (see `useTasksUiState`), and a debounced value would
  // still hand the old term to the query for one beat — a first frame
  // narrowed by a search the user has left, and then a SECOND request when
  // the debounce catches up. Reading the live value when it is empty makes
  // the clear land in the same render as everything else.
  const debouncedSearch = ui.search === '' ? '' : debouncedTyping;

  // sk-44.4 / sk-44.5 — search-mode coordinator. Driven by the same
  // debounced search the list query uses so the toggle transitions align
  // with when the RRF query actually fires. Owns the "within filters" +
  // "all projects" toggles and the remembered tree-cursor state, and
  // derives the EFFECTIVE filters the list query should apply. It is a
  // pure overlay: it READS the persisted filters from useTasksUiState but
  // never writes them (a reload mid-search keeps the user's real prefs,
  // and the sk-30 lens coordinator always snapshots the true values).
  // Must run BEFORE useTasks so its effective filters feed the query.
  const searchModes = useTaskSearchModes({
    search: debouncedSearch,
    outboxMode,
    onMeMode,
    statusFilter: ui.statusFilter,
    originFilter: ui.originFilter,
    typeFilter: ui.typeFilter,
    priorityFilter: ui.priorityFilter,
    // sk-69 — persisted filter setters. The hook returns effectiveSet*
    // that route here when no lens is active, or to its own ephemeral
    // lens-filter state while a lens is on (chips live under the lens
    // without touching durable prefs).
    setStatusFilter: ui.setStatusFilter,
    setOriginFilter: ui.setOriginFilter,
    setTypeFilter: ui.setTypeFilter,
    setPriorityFilter: ui.setPriorityFilter,
    // sk-50 — feed the persisted sort in so the hook can surface
    // `effectiveSort` (ephemeral searchSort during a search, persisted
    // otherwise). The hook never writes it back.
    sort: ui.sort,
    selectedProject: layout.selectedProject,
    selectedComponent: layout.selectedComponent,
    setSelectedProject: layout.setSelectedProject,
    setSelectedComponent: layout.setSelectedComponent,
    // sk-674.18 T052 — the place «space» is a scope the search widens from.
    selectedSpaceHandle: layout.selectedSpaceHandle,
    setSelectedSpace: layout.setSelectedSpace,
    // sk-303.14 (T024) — the unreviewed selection and its writer. Read from
    // the address, so the hook derives the first frame's filters in the
    // same render this column builds its list query in.
    unreviewedSelected: layout.unreviewedSelected,
    setUnreviewedSelected: layout.setUnreviewedSelected,
  });

  // sk-47.2 — "paste-a-blob" mode. A DISTINCT input branch from the typed
  // search above: it lives entirely in this hook's `codes` array and, while
  // active, REPLACES the normal board body with the blob result panel. The
  // typed-search machinery (searchModes / useTasks / ui.search) is never
  // fed the pasted text, so the two paths can't interfere.
  const blob = useBlobMode();

  // Paste interceptor wired onto the search input. Extract codes from the
  // pasted text; with ≥1 we preventDefault() (the wall of text must NOT
  // land in the box) and enter blob mode. With 0 codes we do nothing — the
  // browser's default paste runs and the text drives a normal typed search.
  const handleSearchPaste = useCallback(
    (e: ClipboardEvent<HTMLInputElement>) => {
      const text = e.clipboardData.getData('text');
      const codes = extractIssueCodes(text);
      if (codes.length === 0) return; // 0 codes → normal paste / typed search
      e.preventDefault();
      // Clear any live typed search when entering blob mode (TS-review W2+W3):
      //  - W3: keeps the input box and the rendered body in agreement — no
      //    stale "auth" text lingering while the blob panel is shown.
      //  - W2: with ui.search emptied, `debouncedSearch` drops to '' so
      //    `useTasks` falls out of RRF search mode — no wasted cross-project
      //    RRF query keeps refetching in the background behind the panel.
      if (ui.search !== '') ui.setSearch('');
      blob.enter(codes);
    },
    [blob, ui],
  );

  // While blob mode is active, ANY edit to the search input (typing, or
  // clicking the clear ×) exits blob mode first, then applies the change to
  // the typed-search box. This is the "clearing the input leaves blob mode"
  // exit path (the panel × calls blob.exit directly).
  const handleSearchChange = useCallback(
    (v: string) => {
      if (blob.active) blob.exit();
      // sk-98 — typing in the search box escapes anchored (rooted-subtree)
      // mode too: clearing the anchor returns control to the typed-search
      // path rather than leaving a stale rooted tree showing under a fresh
      // query.
      ui.setTreeRootAnchor(null);
      ui.setSearch(v);
    },
    [blob, ui],
  );

  // sk-98 — rooted-subtree drill-in from a found epic in blob results.
  // Set the anchor (epic id + projectId) and force Tree view; the blob
  // panel stays active underneath so clearing the anchor returns to it.
  // This view is intrinsically epic-scoped (a single epic's parent-child
  // subtree) and introduces NO issues-derived counter, so per CLAUDE.md
  // frontend conventions it does not need outboxMode scoping.
  const handleExpandEpic = useCallback(
    (anchor: TreeRootAnchor) => {
      ui.setTreeRootAnchor(anchor);
      ui.setView('tree');
    },
    [ui],
  );
  const handleClearAnchor = useCallback(() => ui.setTreeRootAnchor(null), [ui]);

  /**
   * sk-285.2.19 (step 4) — a click on a tree-table column heading.
   *
   * It writes the COLUMN'S sort preference, the same one the «Sort by»
   * combobox writes and the same one `skein.tasks.sort` persists — a
   * heading is a second control over one order, not a table-local order
   * of its own. `setSort` resets the direction to the key's natural one,
   * so the second call is what carries a reversal; the table decided
   * which of the two happened (`nextSortForColumn`).
   */
  const handleTreeSortChange = useCallback(
    (next: TasksSortPref) => {
      ui.setSort(next.sort);
      ui.setSortDir(next.direction);
    },
    [ui],
  );
  /**
   * sk-285.2.19 (step 5) — the direction the TABLE actually reads, which
   * is the stored one only while the stored KEY is the one in force.
   *
   * A search swaps the key out from under it: `effectiveSort` becomes the
   * ephemeral `searchSort` while `ui.sortDir` still holds the direction
   * picked for the persisted key. Applied blindly, a reader who once
   * reversed «Updated» would find «Priority» reversed too — a direction
   * they never chose, on a key they did not pick it for, with the heading
   * arrow dutifully showing it. `directionFor` scopes the direction to
   * its own key; any other key is read naturally until reversed itself.
   */
  const treeSortDir = directionFor(searchModes.effectiveSort, {
    sort: ui.sort,
    direction: ui.sortDir,
  });
  // sk-98 — anchored = a rooted-subtree drill-in is active. Takes render
  // precedence over blob mode (the blob panel stays mounted underneath so
  // clearing the anchor returns to it).
  const anchored = ui.treeRootAnchor !== null;

  // sk-103 — count of loaded issues hidden under collapsed ancestors in
  // Tree view, lifted out of the (normal) TasksBody. Drives the header
  // chip's "N · M collapsed" form. setState is referentially stable, so it
  // satisfies TasksBody's stable-callback expectation directly.
  const [collapsedCount, setCollapsedCount] = useState(0);

  const tasks = useTasks({
    selectedProject: layout.selectedProject,
    selectedSpace: layout.selectedSpace,
    selectedSpaceStatus,
    selectedComponent: layout.selectedComponent,
    outboxMode,
    onMeMode,
    // sk-44.4 — apply the EFFECTIVE filters (cleared during an unfiltered
    // search; the live persisted values otherwise). The persisted chips
    // still come from useTasksUiState.
    statusFilter: searchModes.effectiveStatusFilter,
    originFilter: searchModes.effectiveOriginFilter,
    typeFilter: searchModes.effectiveTypeFilter,
    priorityFilter: searchModes.effectivePriorityFilter,
    search: debouncedSearch,
    // sk-50 — apply the EFFECTIVE sort (ephemeral 'relevance' default
    // during a search → preserve server RRF order; persisted key
    // otherwise). useTasks treats 'relevance' as "no clientSort".
    sort: searchModes.effectiveSort,
    // sk-285.2.19 (step 5) — and NOT the direction. The key is the
    // column's, shared by every body; the direction is the TREE TABLE's,
    // applied further down in `TasksBody` (`compareSiblings`). This hook
    // feeds the Cards list AND the Kanban board from one array, so a
    // direction handed in here would turn both upside down on a click in
    // a table the reader may not even have open — and the board prints
    // no sort indicator at all, so nothing on screen would account for
    // it. See `TasksSortDirectionScope.test.tsx`.
    // sk-79 / sk-84 — the assignee filter applies on the non-lens surfaces
    // (members / directory chips) AND under the Delegated lens (outboxMode —
    // "who I delegated to", chips derived from the delegated tasks). Only
    // the On-me lens forces it null: there the assignee is always the caller,
    // so a picker would be meaningless.
    assigneeFilter: onMeMode ? null : ui.assigneeFilter,
  });
  // sk-622.21 T041 (US-9) — the project of the open route is declared
  // first, even while it shows no rows (an issue created in it must still
  // arrive). The rows' own projects are declared from the query cache.
  useDeclareProjects('route', [tasks.resolvedProjectId]);

  // sk-285.2.8 — signature of everything currently narrowing the column
  // to a subset of the project ('' when nothing is). The tree holds the
  // path to every match open while this is non-empty, and drops its
  // ephemeral expand overrides whenever the signature changes. Built
  // from the EFFECTIVE filters (the ones the query actually applied), so
  // the tree can never disagree with the rows it was handed.
  const narrowedBy = useMemo(
    () =>
      describeTreeNarrowing({
        search: debouncedSearch,
        statusFilter: searchModes.effectiveStatusFilter,
        originFilter: searchModes.effectiveOriginFilter,
        typeFilter: searchModes.effectiveTypeFilter,
        priorityFilter: searchModes.effectivePriorityFilter,
        assigneeFilter: onMeMode ? null : ui.assigneeFilter,
        selectedComponent: layout.selectedComponent,
        outboxMode,
        onMeMode,
      }),
    [
      debouncedSearch,
      searchModes.effectiveStatusFilter,
      searchModes.effectiveOriginFilter,
      searchModes.effectiveTypeFilter,
      searchModes.effectivePriorityFilter,
      ui.assigneeFilter,
      layout.selectedComponent,
      outboxMode,
      onMeMode,
    ],
  );

  // sk-36 — per-project tree dep-type lens. The chip row in TaskFilters
  // writes here; TasksBody reads it to decide between the fast-path
  // (legacy parent-child-only client-side tree) and the layered-tree
  // backend query.
  const [treeDepTypes, setTreeDepTypes] = useTreeDepTypes(layout.selectedProject);

  // Resolve project UUID → display alias (idPrefix) for cross-project
  // Outbox where `layout.selectedProject` is null but each item carries
  // its own `projectId`. `setSelectedIssue` requires a real handle, so
  // we look it up here in one pass — same trick `InboxColumn` uses.
  const projectHandles = useMemo(() => {
    const out = new Map<string, string>();
    for (const p of projectsQ.data?.items ?? []) {
      out.set(p.id, p.idPrefix);
    }
    return out;
  }, [projectsQ.data]);

  // sk-285.2.6 — options for the board's project-focus picker. The same
  // single-page projects fetch the handle lookup above rides on, so the
  // picker costs no extra round-trip. Ordered by handle — that is what
  // the control shows and what the board's focus bar prints.
  // sk-674.18 T052 — the projects of the space place, for the board's
  // focus (screens 1.9). They come from the same single-page list the
  // picker always used; a list without `spaceId` (an older API) yields
  // `null`, and the focus then works as on «All projects» over rows the
  // server already narrowed.
  const spaceProjectIds = useMemo<ReadonlySet<string> | null>(() => {
    if (selectedSpace === null) return null;
    const items = projectsQ.data?.items ?? [];
    if (items.some((p) => p.spaceId === undefined)) return null;
    return new Set(items.filter((p) => p.spaceId === selectedSpace).map((p) => p.id));
  }, [selectedSpace, projectsQ.data]);
  const focusOnPlace = useMemo(
    () => projectFocusOnPlace(ui.kanbanProjectFocus, layout.selectedProject, spaceProjectIds),
    [ui.kanbanProjectFocus, layout.selectedProject, spaceProjectIds],
  );
  const focusPausedBySpace = focusOnPlace.pausedBySpace ? spaceName ?? selectedSpace : null;

  const projectFocusOptions = useMemo<ProjectFocusOption[]>(() => {
    const out = (projectsQ.data?.items ?? [])
      // sk-674.18 T052 — on a space place the picker offers its projects only.
      .filter((p) => spaceProjectIds === null || spaceProjectIds.has(p.id))
      .map((p) => ({
        id: p.id,
        handle: p.idPrefix,
        name: p.name,
      }));
    out.sort((a, b) => a.handle.localeCompare(b.handle));
    return out;
  }, [projectsQ.data, spaceProjectIds]);

  // sk-285.2.6 — «all projects» reset, and the way OUT of the paused
  // state. The second one is a navigation, not a settings change: the
  // focus is paused because a project is open, so un-pausing it means
  // closing that project, and the board says exactly that.
  const setKanbanProjectFocus = ui.setKanbanProjectFocus;
  // sk-674.18 T052 — on a space place the picker shows and edits only the
  // space's part of the saved focus; the other spaces' part is kept.
  const pickerProjectFocus =
    spaceProjectIds === null
      ? ui.kanbanProjectFocus
      : focusWithinSpace(ui.kanbanProjectFocus, spaceProjectIds);
  const savedProjectFocus = ui.kanbanProjectFocus;
  const handleProjectFocusChange = useCallback(
    (next: ProjectFocus) =>
      setKanbanProjectFocus(
        spaceProjectIds === null
          ? next
          : replaceFocusWithinSpace(savedProjectFocus, spaceProjectIds, next),
      ),
    [setKanbanProjectFocus, spaceProjectIds, savedProjectFocus],
  );
  // «Reset» on a space place empties the space's part only, for the same
  // reason: it must not drop what was chosen in another space.
  const handleClearProjectFocus = useCallback(
    () =>
      setKanbanProjectFocus(
        spaceProjectIds === null
          ? EMPTY_PROJECT_FOCUS
          : replaceFocusWithinSpace(savedProjectFocus, spaceProjectIds, EMPTY_PROJECT_FOCUS),
      ),
    [setKanbanProjectFocus, spaceProjectIds, savedProjectFocus],
  );
  const setLayoutProject = layout.setSelectedProject;
  const handleShowAllProjects = useCallback(
    () => setLayoutProject(null),
    [setLayoutProject],
  );

  // Component-id → name lookup for the single-project surface. Cards
  // use it to render `frontend` instead of `1 component` when a task
  // has exactly one component. Cross-project Outbox skips this (we'd
  // need a per-project lookup that's not worth N round-trips); cards
  // there fall back to the count format.
  const componentsQ = useQuery({
    queryKey: ['components', 'list', tasks.resolvedProjectId ?? ''],
    queryFn: () => listComponents(tasks.resolvedProjectId!),
    enabled: !!tasks.resolvedProjectId,
    staleTime: 60_000,
  });
  // sk-285.2.4 — the CROSS-PROJECT board grouped by component needs the
  // same id → name lookup, and there is no single project to ask. The
  // fetch is therefore per project, lazy in two ways: only while that
  // axis is actually selected, and only for the projects the LOADED
  // board rows belong to (bounded by what is on screen — never by the
  // size of the org). The query key is the one the single-project fetch
  // above and the Projects column already use, so an expanded project
  // costs nothing extra.
  //
  // sk-285.2.5 — the same lookup is what turns the «Components» card
  // property into names instead of uuid tails, so it is needed whenever
  // THAT switch is on too, on any axis. Same two laziness guards apply.
  const boardComponentProjectIds = useMemo(() => {
    if (ui.view !== 'kanban') return [];
    const needed =
      ui.kanbanAxis === 'component' || ui.kanbanCardFields.has('components');
    if (!needed) return [];
    if (tasks.resolvedProjectId) return [];
    return [...new Set((tasks.data ?? []).map((i) => i.projectId))];
  }, [
    ui.view,
    ui.kanbanAxis,
    ui.kanbanCardFields,
    tasks.resolvedProjectId,
    tasks.data,
  ]);

  const crossProjectComponentsQ = useQueries({
    queries: boardComponentProjectIds.map((pid) => ({
      queryKey: ['components', 'list', pid],
      queryFn: () => listComponents(pid),
      staleTime: 60_000,
    })),
  });

  // `useQueries` hands back a fresh array every render, so the map is
  // keyed on WHEN each query last delivered data instead: without that
  // the lookup would change identity on every render and re-bucket the
  // whole board underneath it.
  const crossProjectComponentsStamp = crossProjectComponentsQ
    .map((q) => q.dataUpdatedAt)
    .join('|');

  const componentNames = useMemo(() => {
    const out = new Map<string, string>();
    for (const c of componentsQ.data ?? []) {
      out.set(c.id, c.name);
    }
    for (const q of crossProjectComponentsQ) {
      for (const c of q.data ?? []) out.set(c.id, c.name);
    }
    return out;
    // `crossProjectComponentsQ` is read but deliberately NOT a dep — the
    // stamp above stands in for it, see the comment there.
  }, [componentsQ.data, crossProjectComponentsStamp]);

  // sk-79 / sk-84 — assignee filter (avatar-chip row). Two surfaces show it:
  //   - sk-79 NON-LENS: neither lens on → chips are the project's members
  //     (project selected) or the org directory ("All projects").
  //   - sk-84 DELEGATED (outboxMode): chips are the people I delegated to,
  //     derived from the loaded delegated tasks (see assigneeOptions).
  // The On-me lens still hides it (assignee is always the caller). Blob mode
  // hides it (the board is replaced).
  const crossProjectAllSurface = layout.selectedProject === null;
  const nonLensAssigneeSurface =
    !outboxMode &&
    !onMeMode &&
    (tasks.resolvedProjectId !== null || crossProjectAllSurface);
  const showAssigneeRow =
    !blob.active && (nonLensAssigneeSurface || outboxMode);

  /**
   * sk-342 — is there anything to resolve under the "Delegated" lens.
   *
   * `issues.assignee` is a TEXT field where an MCP client may put a
   * UUID or an email: an agent can assign someone who is not yet in the
   * directory. The chip label then showed exactly what was put there.
   *
   * Resolved by `userId`, and since sk-523 it is filled for these cases:
   * the server join matches the name, the email AND the identifier
   * (`internal/assignee/assignee.go#JoinOn`). Before that task `userId`
   * came NULL precisely in the UUID/email cases, so there was nothing to resolve
   * by — and that was the reason the task waited.
   */
  const delegateeNeedsResolve =
    outboxMode && needsDirectoryResolve(tasks.delegateeAssignees);

  // Project members feed the chip row on the non-lens project surface.
  //
  // sk-342 — under the "Delegated" lens they are requested TOO, but only
  // when there is something to resolve: at least one delegate has a known
  // `userId`. The acceptance criterion says this directly — "no
  // extra request when there is nothing to resolve" — and `enabled`
  // fulfils it, not bypasses it. The set is limited to project membership, so
  // this is not the unbounded directory query that
  // sk-285.5.5 rejected (39,782 records, ~4.3 MB).
  const membersQ = useQuery({
    queryKey: ['members', 'list', tasks.resolvedProjectId ?? ''],
    queryFn: () => listMembers(tasks.resolvedProjectId!),
    enabled:
      showAssigneeRow
      && tasks.resolvedProjectId !== null
      && (!outboxMode || delegateeNeedsResolve),
    staleTime: 60_000,
  });

  // sk-285.5.5 — the assignee SEARCH box inside the "+N" overflow menu.
  //
  // On non-lens "All projects" there is no single membership to source the
  // chip row from. It used to be fed by `listUserDirectory()` — the whole
  // org, unbounded, fetched on mount, a large payload. The chips now come from the loaded tasks (see
  // `assigneeOptions`), and the directory is reduced to what it is good at:
  // finding a person who is NOT on the current board. It is therefore
  // queried only when the reader has typed something, and only with that
  // term.
  //
  // Debounced 300ms — the same cadence as the projects-column search box
  // (`ProjectsColumn.tsx`) and the dependency picker. `keepPreviousData`
  // holds the previous matches on screen while the next term is in flight,
  // so the menu doesn't blank out between keystrokes.
  const [assigneeSearch, setAssigneeSearch] = useState('');
  const [debouncedAssigneeSearch] = useDebouncedValue(assigneeSearch.trim(), 300);
  const assigneeSearchEnabled = showAssigneeRow && !outboxMode && crossProjectAllSurface;
  const directorySearchQ = useQuery({
    queryKey: ['users', 'directory', debouncedAssigneeSearch],
    queryFn: () => listUserDirectory({ q: debouncedAssigneeSearch }),
    enabled: assigneeSearchEnabled && debouncedAssigneeSearch.length > 0,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });

  // sk-285.5.5 review F4 — "the matches on screen are NOT the answer to the
  // term on screen (yet)". Three ways that happens, all folded into one
  // flag the view uses to both spin and refuse selection:
  //
  //   - the debounce has not elapsed, so the query has not even been asked
  //     the current term yet (`assigneeSearch.trim() !== debounced`);
  //   - the query for the current term is in flight (`isFetching`);
  //   - TanStack is serving the PREVIOUS key's rows as placeholder data
  //     (`isPlaceholderData`, the v5 successor of `isPreviousData`) —
  //     exactly the `keepPreviousData` case above.
  //
  // Without it the previous term's people stayed fully clickable under the
  // new term, so a fast typist could filter by somebody they never asked
  // for. There is no last-response-wins race to fix on top of this: each
  // term is its own query key, so a late response lands in ITS OWN cache
  // entry and can never overwrite a newer term's rows.
  const assigneeSearchStale =
    assigneeSearch.trim().length > 0 &&
    (assigneeSearch.trim() !== debouncedAssigneeSearch ||
      directorySearchQ.isFetching ||
      directorySearchQ.isPlaceholderData);

  // Reset the typed term whenever the chip row stops being a directory
  // search surface (project switch, lens toggle) — a stale term would make
  // the menu open onto results for a search the reader can no longer see
  // themselves having made.
  useEffect(() => {
    if (!assigneeSearchEnabled) setAssigneeSearch('');
  }, [assigneeSearchEnabled]);

  const assigneeSearchResults = useMemo<AssigneeOption[]>(() => {
    const me = auth.user?.username?.toLowerCase() ?? null;
    return (directorySearchQ.data?.items ?? []).map<AssigneeOption>((u) => {
      const isMe = me !== null && u.username.toLowerCase() === me;
      return {
        username: u.username,
        userId: u.id,
        label: isMe ? 'me' : personOptionLabel(u.name?.trim() || u.username, u, tCommon),
        isMe,
      };
    });
  }, [directorySearchQ.data, auth.user, tCommon]);

  // Build the chip options from whichever source is active (project members
  // on a project surface, the loaded board's assignees on "All projects").
  // The caller's own chip ("me") floats first, the rest follow in name
  // order. The chip `username` is the wire value the backend filters on;
  // the label is the display name (falling back to username).
  const baseAssigneeOptions = useMemo<AssigneeOption[]>(() => {
    const me = auth.user?.username?.toLowerCase() ?? null;
    // sk-84 — Delegated lens: the chips are the people I actually delegated
    // to. `tasks.delegateeAssignees` is the distinct assignee set of the
    // delegated list computed BEFORE the client-side assignee filter, so the
    // chip set stays complete even after one delegatee is picked. Exclude me
    // (the lens is assignee≠me anyway). No members/directory fetch.
    if (outboxMode) {
      // sk-342 — the label is taken from the directory by `userId`, not from the
      // raw `assignee`. When the user is not there — deleted, external,
      // or an agent wrote an arbitrary string — the ORIGINAL
      // string is shown as is. Not "unknown user": it is the only
      // clue from which one can understand whom was meant.
      const directory = membersQ.data ?? [];
      return tasks.delegateeAssignees
        .filter((d) => me === null || d.username.toLowerCase() !== me)
        .map<AssigneeOption>((d) => ({
          username: d.username,
          userId: d.userId,
          // sk-674.18 T055 (review C4) — the state the rows carry.
          label: personOptionLabel(delegateeLabel(d, directory), d.status, tCommon),
          isMe: false,
        }))
        .sort((a, b) => a.label.localeCompare(b.label));
    }
    // sk-285.5.5 — on cross-project "All projects" the chips are the people
    // who actually appear on the loaded board (`tasks.loadedAssignees`), the
    // same derivation the Delegated lens has used since sk-84. Filtering by
    // somebody with no task in view has no effect worth a 4.3 MB fetch; the
    // people who are NOT on the board are reachable through the search box
    // in the overflow menu instead. A project surface keeps its membership
    // list — that set is already bounded by the project.
    const src: ReadonlyArray<{
      username: string;
      userId?: string | null;
      name: string;
      status?: PersonStatus;
    }> =
      tasks.resolvedProjectId !== null
        ? (membersQ.data ?? []).map((m) => ({
            username: m.username,
            userId: m.userId,
            name: m.name,
            // sk-674.18 T055 — a project member is a person object.
            status: m,
          }))
        : tasks.loadedAssignees.map((a) => ({
            username: a.username,
            userId: a.userId,
            // The list rows carry the assignee HANDLE, not a display name —
            // same as the Delegated chips, which label by handle too.
            name: a.username,
            // sk-674.18 T055 (review C4) — the state the rows carry.
            status: a.status,
          }));
    const opts: AssigneeOption[] = src.map((s) => {
      const isMe = me !== null && s.username.toLowerCase() === me;
      return {
        username: s.username,
        userId: s.userId,
        label: isMe ? 'me' : personOptionLabel(s.name?.trim() || s.username, s.status, tCommon),
        isMe,
      };
    });
    opts.sort((a, b) => {
      if (a.isMe && !b.isMe) return -1;
      if (b.isMe && !a.isMe) return 1;
      return a.label.localeCompare(b.label);
    });
    return opts;
  }, [
    outboxMode,
    tasks.delegateeAssignees,
    tasks.loadedAssignees,
    tasks.resolvedProjectId,
    membersQ.data,
    auth.user,
    tCommon,
  ]);

  // sk-79 / sk-84 — reset the assignee selection whenever the project OR the
  // lens mode changes. A username is surface-specific (project member vs org
  // directory vs delegated-task assignee), so carrying it across a project
  // switch or a lens toggle would silently empty the list on a surface where
  // that user isn't in the chip set.
  const setAssigneeFilter = ui.setAssigneeFilter;
  useEffect(() => {
    setAssigneeFilter(null);
  }, [layout.selectedProject, outboxMode, onMeMode, setAssigneeFilter]);

  // sk-285.5.5 review F1 — the picked assignee ALWAYS gets a chip, even when
  // no source list contains them.
  //
  // The chip is not decoration: it is the only control that clears the
  // filter (clicking the active chip toggles it off). Somebody chosen
  // through the directory search may legitimately have zero tasks under the
  // current filters, and `assigneeFilter` lives in component state, not in
  // the URL — so with no chip the board is empty, unlabelled, and there is
  // nothing left to click to get out of it. We therefore remember the
  // option that was picked and append it to the chip row if the live
  // sources don't carry it.
  const [pickedAssignee, setPickedAssignee] = useState<AssigneeOption | null>(null);

  // Any path that clears the filter (the reset effect above, a second click
  // on the active chip) drops the remembered pick with it.
  useEffect(() => {
    if (ui.assigneeFilter === null) setPickedAssignee(null);
  }, [ui.assigneeFilter]);

  const handleAssigneeChange = useCallback(
    (username: string | null) => {
      if (username === null) {
        setPickedAssignee(null);
      } else {
        const lower = username.toLowerCase();
        setPickedAssignee(
          baseAssigneeOptions.find((o) => o.username.toLowerCase() === lower) ??
            assigneeSearchResults.find((o) => o.username.toLowerCase() === lower) ?? {
              username,
              userId: null,
              label: username,
              isMe: false,
            },
        );
      }
      setAssigneeFilter(username);
    },
    [baseAssigneeOptions, assigneeSearchResults, setAssigneeFilter],
  );

  const assigneeOptions = useMemo<AssigneeOption[]>(() => {
    const picked = pickedAssignee;
    if (picked === null || ui.assigneeFilter === null) return baseAssigneeOptions;
    const lower = ui.assigneeFilter.toLowerCase();
    // Guard against a remembered pick that no longer describes the active
    // filter (it was set by some other path than `handleAssigneeChange`).
    if (picked.username.toLowerCase() !== lower) return baseAssigneeOptions;
    if (baseAssigneeOptions.some((o) => o.username.toLowerCase() === lower)) {
      return baseAssigneeOptions;
    }
    // Appended, not prepended: AssigneeRow already pulls the ACTIVE option
    // to the front of the visible chips wherever it sits in the list.
    return [...baseAssigneeOptions, picked];
  }, [baseAssigneeOptions, pickedAssignee, ui.assigneeFilter]);

  // sk-194.5.2.8.2 — destructured so the callback below depends on the two
  // fields it actually reads instead of the whole context object. `layout`
  // changes identity whenever ANY layout field moves — including
  // `selectedIssue`, i.e. on every card click — which would re-create
  // `handleSelect` and re-render every memoised TaskCard in the column for
  // a selection that only affects two rows. `setSelectedIssue` is itself a
  // `useCallback` in the provider ([navigate, selectedProject,
  // selectedComponent]) so it is stable across issue selection.
  const { setSelectedIssue, selectedProject } = layout;
  const handleSelect = useCallback(
    // sk-421.2 — a tree row (IssueTreeRowItem) carries empty status/type
    // for an inaccessible task. The handler reads ONLY id and projectId,
    // so it accepts a wider type: there is nothing to narrow here.
    (item: IssueTreeRowItem) => {
      // Resolve via the item's OWN project first — item.projectId is
      // authoritative. A project-scoped board can still render rows from a
      // DIFFERENT project (blob-mode pasted codes via `BlobCodesResult`,
      // which reuses this same handler): blindly preferring
      // `layout.selectedProject` there sent the detail fetch through the
      // currently-browsed project's handle instead of the row's actual
      // project, 404ing ("not found or you do not have access") even
      // though the issue existed and was visible. `layout.selectedProject`
      // stays as the fallback for cross-project surfaces (`/` All-projects,
      // `/me/created-by` Outbox) where `projectHandles` might not have the
      // item's project cached yet.
      const handle =
        projectHandles.get(item.projectId) ?? selectedProject ?? '';
      setSelectedIssue(item.id, handle);
    },
    [setSelectedIssue, selectedProject, projectHandles],
  );

  // The number the folded sliver prints, read off the SAME sources the
  // expanded header chip reads, so the two forms of the column can never
  // report different totals:
  //   • Reminders lens → distinct ringing tasks (what its own chip shows);
  //   • anchored (rooted-subtree) → nothing, exactly as the chip shows
  //     nothing: an epic-subtree count is meaningless against the project
  //     and blob totals the chip otherwise reports (sk-98);
  //   • blob mode → pasted codes that resolved to a visible task (sk-47.2);
  //   • normal board → the flat server total (sk-44.2 `+` suffix kept when
  //     the search path has no authoritative COUNT).
  // Tree view's "N · M collapsed" long form (sk-103) has no room inside a
  // 44px sliver; its leading number is this same `tasks.total`, so the
  // sliver stays a truthful subset of the chip rather than a rival number.
  const sliverCountValue = budilnikMode
    ? ringingTaskCount
    : anchored
      ? 0
      : blob.active
        ? blob.foundCount
        : tasks.total;
  // `null` means "this mode HAS no honest column total", not "the total
  // is zero": in anchored (rooted-subtree) mode the chip is suppressed
  // on purpose (sk-98 — the number would be subtree-scoped and
  // meaningless), exactly as in the expanded header below. Every other
  // mode prints its number at every value, zero included.
  // The `+` suffix (search mode: `total` is rows LOADED so far, not a
  // COUNT(*)) is dropped at zero — "0+" would promise rows that a page
  // with none loaded cannot have.
  const sliverCountLabel = anchored
    ? null
    : !budilnikMode &&
        !blob.active &&
        !tasks.totalIsExact &&
        sliverCountValue > 0
      ? `${sliverCountValue}+`
      : String(sliverCountValue);

  // Stage 2 / sk-285.2.23 — "the view takes the workspace", width half.
  // Folding the two navigation columns is pointless if the Tasks column
  // then stays capped at `COL_BOUNDS.tasks.max` (600px) with the freed
  // pixels sitting empty beside it. So in a WORKSPACE VIEW — the board,
  // and since sk-285.2.23 the tree table — the column stops being a
  // fixed-width column and flexes into whatever the row has left; the
  // persisted `width` is untouched and comes straight back in Cards view.
  //
  // At the 1284px floor with both navigation columns folded that is
  // 1278 − 44 − 44 − 420 (`--col-details-board`) = 770px for either
  // view with the reading pane at its floor — the tree's whole reason for
  // joining this mechanism, since its own projection topped out at 680
  // (see `Shell.tsx` for the full arithmetic). sk-551.3 — until the user
  // drags, the pane takes 40 % of those 1190, i.e. 476, and the view 714.
  //
  // The BOARD's condition is the one the body below resolves the board
  // with, not a bare `ui.view === 'kanban'`: a search, a pasted blob of
  // task codes and an anchored subtree each override the picked view, so
  // taking it at face value would stretch a cards list across the whole
  // workspace.
  //
  // The TREE's is the picked view ALONE, which is not an oversight —
  // it is the rule sk-285.2.9 already established for the tree's width
  // and it is kept: a search (which forces `view='cards'` for the body)
  // must not re-flow the whole column the moment the box gets its first
  // character, and an anchored subtree renders the tree table anyway.
  //
  // sk-551.4 — computed HERE, above the fold and Reminders early returns,
  // because the answer is also published to `Shell` (it drops the empty
  // reading pane and picks the resize handle off it). Those two states
  // draw no workspace view, so they publish `null`; the flags themselves
  // are only read below the early returns, where they always applied.
  const treeFillsWorkspace = ui.view === 'tree';
  const boardFillsWorkspace =
    ui.view === 'kanban'
    && !blob.active
    && !anchored
    && !searchModes.searchActive;
  const viewFillsWorkspace = treeFillsWorkspace || boardFillsWorkspace;
  const workspaceFill: WorkspaceFill =
    collapsed || budilnikMode
      ? null
      : treeFillsWorkspace
        ? 'tree'
        : boardFillsWorkspace
          ? 'board'
          : null;
  usePublishWorkspaceFill(workspaceFill);

  // sk-285.7 T019 — hand the two mobile surfaces the number this column
  // has already worked out, instead of letting them work out their own.
  //
  // `sliverCountValue` / `sliverCountLabel` are the column's OWN answer
  // to "how many tasks am I showing" — lensed, mode-corrected, and
  // `null` in the one mode that has no honest total. Publishing them is
  // what makes the zone strip's aggregate counter and the description
  // sheet's positional counter obey the global lens by construction
  // (INV-10) rather than by a second implementation of it that has to be
  // kept in step. See `lib/useTasksOutlet.tsx` for why they cannot ask
  // `useTasks` themselves.
  //
  // Placed here — before the fold branch, the Reminders branch and every
  // other early return — so the publish happens in EVERY state of the
  // column. A folded column still feeds the strip: the user folded a
  // zone, they did not stop having tasks.
  usePublishTasksOutlet(
    anchored ? null : sliverCountValue,
    sliverCountLabel,
    tasks.data,
  );

  // Whole-column fold. Placed BEFORE the Reminders branch so the lens
  // folds like any other state of the column (turning the lens ON
  // unfolds the column — `useLayoutState.tsx#setBudilnikMode`, sk-551.9 —
  // but the user may fold it again over the list), and AFTER every hook above
  // so the hook order is identical in both states. The queries keep
  // running while folded, which is what lets the sliver carry a live count.
  if (collapsed) {
    return (
      <button
        type="button"
        className="col-tasks-collapsed"
        aria-expanded={false}
        // Spoken whenever a number is printed — including zero, so an
        // empty column is distinguishable from one whose count never
        // arrived. Anchored mode prints none and keeps the bare label.
        aria-label={
          sliverCountLabel === null
            ? t('expandColumn')
            : t('expandColumnWithCount', { count: sliverCountValue })
        }
        onClick={() => layout.setTasksCollapsed(false)}
      >
        <span className="col-tasks-sliver-label">
          {t('heading')}
          {sliverCountLabel !== null ? (
            <span
              className={
                sliverCountValue === 0
                  ? 'col-tasks-sliver-count col-count-empty'
                  : 'col-tasks-sliver-count'
              }
            >
              {sliverCountLabel}
            </span>
          ) : null}
        </span>
      </button>
    );
  }

  // sk-62.2 — Reminders lens REPLACES the entire board (filters, search,
  // blob mode) with the flat reminders triage list. Rendered as an early
  // return so none of the useTasks-driven board machinery shows through.
  if (budilnikMode) {
    return (
      <div
        className="col-tasks col-tasks-budilnik"
        style={width === null ? ROW_FILLING_STYLE : draggedWidthStyle(width)}
      >
        <div className="col-header col-tasks-header">
          <span className="col-tasks-heading">
            {/* sk-285.7.2.88 — the lens heading opened with ⏰ (U+23F0),
                one of the four emoji sk-285.7.2.57 removed from the
                OTHER copy of this dictionary. §8 names this object
                `alarm`; an emoji has no stroke to set, no place on the
                16/20/24 scale, and paints in its own face's colours
                rather than the heading's ink. Live before-measure of
                this node: text `⏰ Reminders0 ringing`, svg 0. */}
            <span className="tasks-heading budilnik-heading">
              <IconAlarm size={16} stroke={1.75} aria-hidden />
              {t('remindersLens.heading')}
            </span>
            {/* Printed at every value like every other column count; at
                zero it drops out of attention-amber into the shared dim
                treatment (see `.budilnik-header-count` in index.css). */}
            <span
              className={
                ringingTaskCount === 0
                  ? 'col-header-count budilnik-header-count col-count-empty'
                  : 'col-header-count budilnik-header-count'
              }
            >
              {t('remindersLens.ringingCount', { count: ringingTaskCount })}
            </span>
          </span>
          <button
            type="button"
            className="col-header-btn"
            aria-expanded
            aria-label={t('collapseColumn')}
            onClick={() => layout.setTasksCollapsed(true)}
          >
            {/* sk-285.7.2.49 — §6 "Column (general)" names this control's
                icon by name (`layout-sidebar-left-collapse`), and the
                artboard draws it at 20px. It was the character `−`,
                which is a minus sign standing in for a picture of a
                folding panel: it says nothing about what folds or which
                way, and it cannot be put on §8's stroke or scale. */}
            <IconLayoutSidebarLeftCollapse size={20} stroke={1.75} aria-hidden />
          </button>
        </div>
        <BudilnikLensBody selectedIssueId={layout.selectedIssue} />
      </div>
    );
  }


  // ── Both views take the room the same way — and keep it ────────────
  //
  // Both fold the navigation columns and both flex into the row
  // (sk-285.2.23): `flex: 1 1 0%`, so every pixel the reading pane does
  // not hold lands here.
  //
  // sk-551.29 — the BOARD used to be sized to its content (`flex: 0 1
  // auto`, sk-369) so that a wide window gave its surplus to the reading
  // pane instead of to empty board. The maintainers reversed that on the
  // running app (2026-10-03): "on a wide window the task card must not
  // grow — the extra width goes to the board/tree". The pane now holds a
  // width of its own — the one the user dragged, else the default in
  // `index.css` (the `.col-details` rule beside `.col-tasks-fill`) — and
  // both views take the rest, the board as more room for its columns,
  // the tree as more title.
  //
  // `flex-shrink: 1` with a basis of 0 and the `minWidth` floor: on a
  // window too narrow for view + pane it is the VIEW that gives way
  // first, down to the floor a dragged Cards column has, and the board
  // pans inside itself; only then does the pane shrink to its own floor.
  //
  // The paired half of this rule (the pane's width beside a workspace
  // view) is in `index.css`, keyed off the `col-tasks-fill` class below — only
  // this component knows which body it drew.
  //
  // sk-551.4 — with no issue open there is no reading pane beside the
  // view at all (`Shell` does not render it), and the view takes the
  // whole row by the same style.

  return (
    <div
      className={
        // sk-551.29 — one class for both views: the pane beside them is
        // sized the same way, so the `--tree` / `--board` suffixes the
        // two old rules were keyed on no longer have a reader.
        viewFillsWorkspace ? 'col-tasks col-tasks-fill' : 'col-tasks'
      }
      style={
        viewFillsWorkspace
          ? // Grow into the row; the flex basis of 0 means the freed
            // pixels go here rather than being split against a
            // content-sized basis.
            ROW_FILLING_STYLE
          : width === null
              ? // Tablet (T020): no persisted width was read, so there is
              // nothing to render but the same "take the leftover"
              // shape the workspace views use one branch up.
              ROW_FILLING_STYLE
            : draggedWidthStyle(width)
      }
    >
      <div
        className={[
          'col-header',
          'col-tasks-header',
          // sk-285.7 fidelity M2 — with no project picked this header
          // says nothing the mobile tab strip does not already say: the
          // heading is the word «Tasks», the chip is the number now on
          // the tab, and the collapse button is dead on a phone (there is
          // no second column to give the room to — see the note on
          // `activeZone` being lifted rather than persisted). The class
          // marks that state so the stylesheet can stand the row down
          // there; with a project picked the heading is a BREADCRUMB, and
          // that is not duplicated anywhere, so the row stays.
          layout.selectedProject === null && selectedSpace === null
            ? 'col-header-zone-name-only'
            : '',
        ]
          .filter(Boolean)
          .join(' ')}
        // sk-551.4 — focusable by script only: when the reading pane
        // beside a workspace view closes with focus inside it, focus lands
        // here if the open issue's card / row is not on screen
        // (`Shell.tsx#restoreFocusAfterPane`). Not a tab stop.
        tabIndex={-1}
      >
        {/* Same anatomy as `.col-projects-header` / `.col-queues-header`:
            one flexible heading box (name + count chip) and the 44×44
            collapse button pinned right, so the three column headers read
            as one idiom — including the chip's zero state: whatever mode
            the board is in, the number below is PRINTED at every value,
            with "empty" carried by tone + weight (`.col-count-empty`). */}
        <span className="col-tasks-heading">
          <TasksColumnHeading
            selectedProject={layout.selectedProject}
            spaceName={selectedSpace === null ? null : spaceName ?? selectedSpace}
            selectedComponent={layout.selectedComponent}
            componentNames={componentNames}
          />
          {anchored ? (
            // sk-98 — anchored (rooted-subtree) mode shows NO header count
            // chip: the count would be epic-subtree-scoped and meaningless
            // against the project/blob totals the chip otherwise reports.
            // This is the one mode without a chip, and it is "there is no
            // honest number here", not "the number is zero" — every other
            // mode prints its count including zero.
            null
          ) : blob.active ? (
            // sk-47.2 — in blob mode the header count is the number of
            // pasted codes that resolved to a visible task.
            <span
              className={
                blob.foundCount === 0
                  ? 'col-header-count col-count-empty'
                  : 'col-header-count'
              }
            >
              {blob.foundCount}
            </span>
          ) : (
            // sk-103 — in (non-search) Tree view the flat server `total`
            // overcounts what's on screen: subtrees collapse, so M loaded
            // issues sit hidden under collapsed ancestors. Surface that gap
            // as "N · M collapsed" with a tooltip, while keeping the chip an
            // honest flat total. searchModes.searchActive forces cards, so
            // this branch never collides with the search affordance below.
            ui.view === 'tree' &&
            !searchModes.searchActive &&
            collapsedCount > 0 ? (
              <SkeinTooltip
                position="bottom"
                content={t('collapsedTooltip', {
                  total: tasks.total,
                  collapsed: collapsedCount,
                })}
              >
                <span
                  className="col-header-count"
                  // sk-103 — the visible `N · M collapsed` packs two numbers
                  // around a bare `·`, which screen readers read ambiguously;
                  // the disambiguating "total" wording otherwise lives only in
                  // the hover-only tooltip. Spell both counts out in words for
                  // AT (WCAG 1.3.1 / 4.1.2).
                  aria-label={t('collapsedChipAria', {
                    total: tasks.total,
                    collapsed: collapsedCount,
                  })}
                >
                  {t('collapsedChip', {
                    total: tasks.total,
                    collapsed: collapsedCount,
                  })}
                </span>
              </SkeinTooltip>
            ) : tasks.totalIsExact || tasks.total === 0 ? (
              // sk-44.2 — in search mode `total` is the count of rows LOADED
              // so far (RRF returns no authoritative COUNT). Suffix it with
              // `+` and a tooltip so the user can tell "12 loaded so far"
              // from the exact non-search COUNT(*). Lightest honest option:
              // no extra query, just an honest affordance. At zero the
              // suffix is dropped — "0+" would promise rows a page with
              // none loaded cannot have — so an empty result set prints a
              // plain, dimmed "0" here.
              <span
                className={
                  tasks.total === 0
                    ? 'col-header-count col-count-empty'
                    : 'col-header-count'
                }
              >
                {tasks.total}
              </span>
            ) : (
              <SkeinTooltip
                position="bottom"
                content={t('loadedSoFarTooltip')}
              >
                <span className="col-header-count">{tasks.total}+</span>
              </SkeinTooltip>
            )
          )}
        </span>
        {/* sk-285.7.2.66 — audit 2B, R-4. The artboard puts a caption at
            the right end of this header while the board is on:
            `layout-columns` at 16 beside «Kanban — columns by» in
            `--ink-3`, with the axis word picked out in `--ink-2` 600.
            The product had neither the words nor the icon.

            It names the LIVE axis rather than the artboard's literal
            «status»: the board's columns are whatever field the user
            picked in View settings, and a caption that always said
            "status" would be a caption that lies six times out of seven.

            Decorative by construction — the axis it names is the one the
            View settings control states in full, so a screen reader that
            read this too would hear the same fact twice. */}
        {ui.view === 'kanban' ? (
          <span className="col-tasks-board-note" aria-hidden>
            <IconLayoutColumns size={16} stroke={1.75} aria-hidden />
            <span className="col-tasks-board-note-text">
              {t('boardNote')} <b>{t(`boardAxis.${ui.kanbanAxis}`)}</b>
            </span>
          </span>
        ) : null}
        <button
          type="button"
          className="col-header-btn"
          aria-expanded
          aria-label={t('collapseColumn')}
          onClick={() => layout.setTasksCollapsed(true)}
        >
          {/* sk-285.7.2.49 — §6 "Column (general)" names this control's
              icon by name (`layout-sidebar-left-collapse`), and the
              artboard draws it at 20px. It was the character `−`,
              which is a minus sign standing in for a picture of a
              folding panel: it says nothing about what folds or which
              way, and it cannot be put on §8's stroke or scale. */}
          <IconLayoutSidebarLeftCollapse size={20} stroke={1.75} aria-hidden />
        </button>
      </div>
      <TaskFilters
        search={ui.search}
        // sk-47.2 — wrapped setter: editing the box while in blob mode
        // exits blob mode first, then applies the typed change.
        onSearchChange={handleSearchChange}
        // sk-47.2 — paste interceptor for the paste-a-blob branch.
        onSearchPaste={handleSearchPaste}
        blobActive={blob.active}
        // sk-44.4 / sk-69 — chips DISPLAY the effective filters and their
        // onChange goes to the EFFECTIVE setters. Outside a lens those route
        // to the persisted setters; under a lens they route to the hook's
        // ephemeral lens-filter state (chips live, durable prefs untouched).
        // During an unfiltered search the chips read cleared and are disabled,
        // so there's no display/edit conflict.
        statusFilter={searchModes.effectiveStatusFilter}
        onStatusChange={searchModes.effectiveSetStatusFilter}
        // sk-303.14 (T025) — the selection chip belongs to the Delegated
        // surface and to nothing else; `outboxMode` IS that surface.
        showUnreviewedChip={outboxMode}
        originFilter={searchModes.effectiveOriginFilter}
        onOriginChange={searchModes.effectiveSetOriginFilter}
        typeFilter={searchModes.effectiveTypeFilter}
        onTypeChange={searchModes.effectiveSetTypeFilter}
        priorityFilter={searchModes.effectivePriorityFilter}
        onPriorityChange={searchModes.effectiveSetPriorityFilter}
        // sk-50 — during a search the Cards/Tree toggle is forced to a
        // flat list (a relevance-ranked cross-project tree is
        // meaningless), so reflect 'cards' in the toggle UI and ignore
        // tree selection. On clear, the persisted `ui.view` returns.
        view={searchModes.searchActive ? 'cards' : ui.view}
        sort={searchModes.effectiveSort}
        onSortChange={ui.setSort}
        onSearchSortChange={searchModes.setSearchSort}
        // sk-285.2.4 — the board's column axis. Persisted alongside the
        // view itself, so the board opens on the axis the user last used
        // and the choice needs no confirming step.
        // sk-285.2.5 — the board's «display properties». Persisted like
        // the axis: flipping a switch is the whole save.
        // sk-285.2.6 — the board's project focus. Persisted like the two
        // above; `projectFocusPausedBy` is what keeps it from arguing
        // with the Projects column (see lib/kanbanProjectFocus.ts).
        projectFocus={pickerProjectFocus}
        onProjectFocusChange={handleProjectFocusChange}
        projectFocusOptions={projectFocusOptions}
        projectFocusPausedBy={layout.selectedProject}
        projectFocusPausedBySpace={focusPausedBySpace}
        // sk-50 — the sort combobox binds to the EFFECTIVE sort (ephemeral
        // searchSort during a search; persisted otherwise) so it shows
        // 'Relevance' selected when a search begins. Outside search it
        // shows the persisted value.
        // sk-50 — mid-search sort changes route to the ephemeral
        // searchSort setter (NOT the persisted onSortChange) so a
        // 'relevance' / mid-search choice never persists to localStorage.
        treeDepTypes={treeDepTypes}
        onTreeDepTypesChange={setTreeDepTypes}
        // sk-79 — assignee avatar-chip row (first row). Hidden under the
        // outbox / on-me lenses and on the cross-project surface.
        showAssigneeRow={showAssigneeRow}
        assigneeOptions={assigneeOptions}
        assigneeFilter={ui.assigneeFilter}
        onAssigneeChange={handleAssigneeChange}
        assigneeSearchEnabled={assigneeSearchEnabled}
        assigneeSearchValue={assigneeSearch}
        onAssigneeSearchChange={setAssigneeSearch}
        assigneeSearchResults={assigneeSearchResults}
        assigneeSearchLoading={assigneeSearchStale}
        // A stale page's `hasMore` describes the PREVIOUS term; suppress the
        // "narrow your search" hint until the shown rows match the term.
        assigneeSearchHasMore={!assigneeSearchStale && (directorySearchQ.data?.hasMore ?? false)}
        // sk-44.4 / sk-44.5 — search-mode toggles + chip enabling.
        searchActive={searchModes.searchActive}
        filtersEnabled={searchModes.filtersEnabled}
        withinFilters={searchModes.withinFilters}
        onWithinFiltersToggle={searchModes.toggleWithinFilters}
        allProjects={searchModes.allProjects}
        onAllProjectsToggle={searchModes.toggleAllProjects}
        allProjectsDisabled={searchModes.allProjectsDisabled}
        // sk-44.2 — embedder-down hint (FTS-only recall).
        searchDegraded={tasks.searchDegraded}
        // sk-285.1.13 — filter-panel collapse. Persisted in useLayoutState
        // (localStorage, default collapsed) so the panel opens the way the
        // user left it; TaskFilters stays a pure view.
        collapsed={layout.taskFiltersCollapsed}
        onToggleCollapsed={layout.toggleTaskFiltersCollapsed}
        // sk-285.7 T025 (FR-002) — the panel's LAYOUT. Persisted in
        // useTasksUiState next to the filters themselves rather than in
        // useLayoutState with the collapse flag: it is a preference of
        // the Tasks-column panel, and it rides the same `skein.tasks.*`
        // recipe. It is handed down as a prop for the same reason the
        // collapse flag is — TaskFilters stays a pure view.
        filtersLayout={ui.filtersLayout}
        onFiltersLayoutChange={ui.setFiltersLayout}
      />
      {anchored ? (
        // sk-98 — rooted-subtree mode REPLACES the blob panel (which stays
        // mounted in state underneath; clearing the anchor returns to it).
        // A back breadcrumb sits above a TasksBody forced into the anchored
        // layered tree. TasksBody stays a pure list renderer — the bar lives
        // here in the wrapper.
        <div className="col-body tasks-body tasks-body-anchored">
          <div className="tasks-tree-anchor-bar">
            <button
              type="button"
              className="tasks-tree-anchor-back"
              onClick={handleClearAnchor}
              aria-label={t('anchor.backAria')}
              title={t('anchor.backAria')}
            >
              {/* sk-285.7.2.88 — the `←` that opened `anchor.back` was
                  U+2190, the same character sk-285.7.2.78 took off the
                  mobile sheet's way back for the same reason: §8 lists
                  `arrow-left` and fixes stroke 1.75 and the 16/20/24
                  scale, and a character has none of those — its weight
                  and terminals come from whichever face the system
                  resolves for U+2190, never the face the band is drawn
                  in. Moving it out of the dictionary also takes it out
                  of a translator's reach: `ru` carried its own copy. */}
              <IconArrowLeft size={16} stroke={1.75} aria-hidden />
              {t('anchor.back')}
            </button>
            <span className="tasks-tree-anchor-label">
              <IconCornerDownRight size={16} stroke={1.75} aria-hidden />
              {t('anchor.label')}{' '}
              <span className="tasks-tree-anchor-id">{ui.treeRootAnchor!.id}</span>
            </span>
          </div>
          <TasksBody
            items={tasks.data}
            anchored
            view="tree"
            sort={searchModes.effectiveSort}
            sortDir={treeSortDir}
            onSortChange={handleTreeSortChange}
            searchQuery=""
            narrowedBy={narrowedBy}
            selectedIssueId={layout.selectedIssue}
            selectedProject={layout.selectedProject}
            resolvedProjectId={tasks.resolvedProjectId}
            treeRootAnchor={ui.treeRootAnchor}
            onClearAnchor={handleClearAnchor}
            treeDepTypes={treeDepTypes}
            componentNames={componentNames}
            // sk-285.2.19 — the tree's own column set. Passed here too:
            // the anchored body forces tree view, so it is the ONE body
            // that always renders the table.
            treeColumns={ui.treeColumns}
            listCardFields={ui.listCardFields}
            projectHandles={projectHandles}
            onSelect={handleSelect}
            statusFilter={searchModes.effectiveStatusFilter}
            onStatusFilterChange={searchModes.effectiveSetStatusFilter}
            isLoading={tasks.isLoading}
            error={tasks.error}
            emptyReason={tasks.emptyReason}
            unreviewedSelected={layout.unreviewedSelected}
            hasNextPage={tasks.hasNextPage}
            isFetchingNextPage={tasks.isFetchingNextPage}
            fetchNextPage={tasks.fetchNextPage}
          />
        </div>
      ) : blob.active ? (
        // sk-47.2 — blob mode REPLACES the normal board body with the
        // pasted-codes panel (chips + matched cards). The typed-search
        // TasksBody below is never rendered while blob mode is on, so the
        // two paths can't render simultaneously.
        <BlobCodesResult
          chips={blob.chips}
          matched={blob.matched}
          foundCount={blob.foundCount}
          notFoundCount={blob.notFoundCount}
          totalCount={blob.codes.length}
          isLoading={blob.isLoading}
          error={blob.error}
          selectedIssueId={layout.selectedIssue}
          componentNames={componentNames}
          fields={listFieldsMask}
          onSelect={handleSelect}
          onExit={blob.exit}
          onExpandEpic={handleExpandEpic}
        />
      ) : (
        <TasksBody
          items={tasks.data}
          anchored={false}
          // sk-50 — force the FLAT (cards) rendering path during a search.
          // A relevance-ranked, cross-project result set has no meaningful
          // hierarchy; the tree comparator + layered-tree query are bypassed
          // entirely while searchActive. On clear, the persisted view (which
          // may be 'tree') is restored automatically.
          view={searchModes.searchActive ? 'cards' : ui.view}
          // sk-50 — the EFFECTIVE sort drives BOTH the cards order (already
          // applied in useTasks) and the tree comparator (TasksBody.legacyTree).
          // 'relevance' → preserve server RRF order in both paths.
          sort={searchModes.effectiveSort}
          // sk-285.2.19 (step 4) — the direction the key is read in, and
          // the callback the table's headings write through. Step 5: the
          // direction of the key ACTUALLY in force (`treeSortDir`), not
          // whatever direction the persisted key was left at.
          sortDir={treeSortDir}
          onSortChange={handleTreeSortChange}
          searchQuery={debouncedSearch}
          narrowedBy={narrowedBy}
          selectedIssueId={layout.selectedIssue}
          selectedProject={layout.selectedProject}
          resolvedProjectId={tasks.resolvedProjectId}
          treeRootAnchor={null}
          onClearAnchor={handleClearAnchor}
          treeDepTypes={treeDepTypes}
          componentNames={componentNames}
          // sk-285.2.19 — which columns the tree table prints.
          treeColumns={ui.treeColumns}
          // Which attributes the list's cards print.
          listCardFields={ui.listCardFields}
          projectHandles={projectHandles}
          onSelect={handleSelect}
          // sk-103 — only the normal body reports the collapsed count; the
          // anchored body (above) omits it since its header chip is null.
          onCollapsedCountChange={setCollapsedCount}
          // sk-285.2.3 — the board reads the SAME effective status filter
          // the dropdown displays, and writes through the same setter, so
          // there is exactly one filter behind list and board.
          statusFilter={searchModes.effectiveStatusFilter}
          onStatusFilterChange={searchModes.effectiveSetStatusFilter}
          // sk-285.2.4 — which field the board's columns project.
          kanbanAxis={ui.kanbanAxis}
          // sk-285.2.5 — which properties its cards print.
          kanbanCardFields={ui.kanbanCardFields}
          // sk-285.2.6 — which projects it is focused on, and whether an
          // open project is currently outranking that focus.
          kanbanProjectFocus={focusOnPlace.focus}
          kanbanProjectFocusPausedBySpace={focusPausedBySpace}
          onClearProjectFocus={handleClearProjectFocus}
          onShowAllProjects={handleShowAllProjects}
          isLoading={tasks.isLoading}
          error={tasks.error}
          emptyReason={tasks.emptyReason}
          unreviewedSelected={layout.unreviewedSelected}
          hasNextPage={tasks.hasNextPage}
          isFetchingNextPage={tasks.isFetchingNextPage}
          fetchNextPage={tasks.fetchNextPage}
        />
      )}
    </div>
  );
}

interface TasksColumnHeadingProps {
  /** URL project handle (idPrefix / alias / UUID), or null when none selected. */
  selectedProject: string | null;
  /**
   * sk-674.18 T052 — the name of the space that is the selected place (its
   * id until «my spaces» answers), or null. The heading names the place,
   * as it names a project (screens 1.7).
   */
  spaceName: string | null;
  /** Selected component UUID from the URL, or null. */
  selectedComponent: string | null;
  /** Component-id → display-name lookup built by the parent column. */
  componentNames: Map<string, string>;
}

/**
 * sk-4 — Tasks column heading.
 *
 * The column header used to read a flat "Tasks" regardless of what the
 * Projects panel had selected, so scrolling a long project list lost the
 * context of which project's issues filled the column. This component
 * drives the heading off the same `useLayoutState` selection the column
 * body reads, so heading and content stay in lock-step:
 *
 *   nothing selected            → "Tasks"            (neutral)
 *   project selected            → "<project>"
 *   project + component selected → "<project> / <component>"
 *
 * The project DISPLAY NAME is resolved from the URL handle via
 * `useProjectByHandle` (TanStack-deduped against the same resolve the
 * body's `useTasks` already runs — no extra round-trip). Until it
 * resolves (or if it never does, e.g. a stale deep link) we fall back to
 * the raw handle so the header is never blank. The component name comes
 * from the parent's `componentNames` map; if the map hasn't loaded the
 * component row yet we fall back to a short id stub.
 *
 * Long names truncate with an ellipsis inside the fixed-height header and
 * expose the full "<project> / <component>" path through an instant
 * (0 ms) SkeinTooltip on hover.
 *
 * Memoised: the column body re-renders on every query tick / scroll page;
 * the heading only depends on the selection + the resolved name, so
 * `memo` keeps it from re-rendering in step with the body.
 */
const TasksColumnHeading = memo(function TasksColumnHeading({
  selectedProject,
  spaceName,
  selectedComponent,
  componentNames,
}: TasksColumnHeadingProps) {
  // Deduped against useTasks' own resolve (same query key) — cheap.
  const { t } = useTranslation('tasks');
  const resolved = useProjectByHandle(selectedProject);

  if (selectedProject === null && spaceName !== null) {
    return (
      <SkeinTooltip position="bottom" content={spaceName}>
        <span className="tasks-heading" aria-label={t('headingAria', { path: spaceName })}>
          <span className="tasks-heading-project">{spaceName}</span>
        </span>
      </SkeinTooltip>
    );
  }

  if (selectedProject === null) {
    return <span className="tasks-heading">{t('heading')}</span>;
  }

  // Prefer the resolved display name; fall back to the raw handle while
  // the resolve is in flight or if it never lands (stale deep link).
  const projectLabel = resolved.project?.name ?? selectedProject;
  const componentLabel = selectedComponent
    ? componentNames.get(selectedComponent) ?? selectedComponent.slice(0, 8)
    : null;

  // Full path for the tooltip + aria-label; the visible spans truncate.
  const fullPath = componentLabel
    ? `${projectLabel} / ${componentLabel}`
    : projectLabel;

  return (
    <SkeinTooltip position="bottom" content={fullPath}>
      <span className="tasks-heading" aria-label={t('headingAria', { path: fullPath })}>
        <span className="tasks-heading-project">{projectLabel}</span>
        {componentLabel ? (
          <>
            <span className="tasks-heading-sep" aria-hidden="true">
              {' / '}
            </span>
            <span className="tasks-heading-component">{componentLabel}</span>
          </>
        ) : null}
      </span>
    </SkeinTooltip>
  );
});

interface TasksBodyProps {
  items: IssueSummary[] | undefined;
  /**
   * sk-98 — when true the body renders the layered tree ROOTED at
   * `treeRootAnchor` (the epic drilled into from blob results) instead of
   * the project forest. Forces tree view, gates the layered query on the
   * anchor's project, and seeds the rooted subtree expanded.
   */
  anchored: boolean;
  view: ReturnType<typeof useTasksUiState>['view'];
  sort: ReturnType<typeof useTasksUiState>['sort'];
  /**
   * sk-285.2.19 (step 4) — which way `sort` is read, and the way back
   * for a click on a column heading. Both required at both render sites:
   * the anchored one always renders the tree table, and the other one
   * can.
   *
   * Step 5 — read by the TREE only. The cards and the board render
   * `items` in the order `useTasks` handed them over (the key's natural
   * direction), and this prop never reaches either of them.
   */
  sortDir: TasksSortDirection;
  onSortChange: (next: TasksSortPref) => void;
  searchQuery: string;
  /**
   * sk-285.2.8 — signature of the active narrowing (filters / lenses /
   * search), '' when the column shows everything. Non-empty means the
   * rows on screen are MATCHES and the tree must hold the path to each
   * of them open; a CHANGE of the signature drops the ephemeral
   * expand/collapse overrides taken under the previous narrowing.
   */
  narrowedBy: string;
  selectedIssueId: string | null;
  selectedProject: string | null;
  /**
   * Resolved project UUID for the currently-selected URL handle (or
   * null for cross-project / unresolved). Used by the layered-tree
   * query — the wire endpoint expects a UUID, not an alias.
   */
  resolvedProjectId: string | null;
  /**
   * sk-36 — typed-deps lens set from `useTreeDepTypes`. `parent-child`
   * is always present (the hook enforces it). When the set contains
   * only `parent-child`, TasksBody short-circuits to the legacy
   * `buildIssueTree` fast path — no extra network round-trip. Any
   * other type → `useLayeredTree` query fires.
   */
  treeDepTypes: ReadonlySet<DepType>;
  /**
   * sk-98 — the rooted-subtree anchor (epic id + projectId), or null. When
   * non-null AND `anchored` is true the layered tree is rooted at this id.
   */
  treeRootAnchor: TreeRootAnchor | null;
  /** sk-98 — clear the anchor (used by the back affordance / empty state). */
  onClearAnchor: () => void;
  componentNames: Map<string, string>;
  /**
   * sk-285.2.19 — the switchable columns of the TREE TABLE, straight from
   * the persisted preference. Unused by the cards / kanban bodies, and
   * required rather than optional: both render sites can show the tree
   * (the anchored one always does), so there is no call site that may
   * leave it out.
   */
  treeColumns: TreeColumnSet;
  /**
   * Which attributes the LIST cards print, straight from the persisted
   * preference. Unused by the tree / kanban bodies, and required rather
   * than optional for the same reason `treeColumns` is: both render
   * sites can reach the cards body, so there is no call site that may
   * leave it out.
   */
  listCardFields: ListCardFieldSet;
  /**
   * Project UUID → idPrefix lookup for the cross-project surfaces. When
   * the column is showing tasks from multiple projects we render the
   * project handle in the card meta so the user can disambiguate;
   * single-project surfaces pass an empty/unused map and the cards
   * skip the segment.
   */
  projectHandles: Map<string, string>;
  onSelect: (item: IssueTreeRowItem) => void;
  /**
   * sk-103 — reports how many real loaded issues are currently hidden
   * under collapsed ancestors in Tree view (0 in Cards view). The parent
   * lifts this up to render the "N · M collapsed" header chip. Only the
   * NORMAL render site passes it; the anchored site omits it (its header
   * count is null anyway).
   */
  onCollapsedCountChange?: (n: number) => void;
  /**
   * sk-285.2.3 — the EFFECTIVE status filter and its setter, forwarded to
   * the Kanban board. On a board whose columns ARE the status axis, the
   * shared status filter no longer narrows rows — it blanks whole
   * columns — so the board has to name that state and offer the way out
   * of it. Unused by the cards / tree bodies.
   */
  statusFilter: StatusFilter;
  onStatusFilterChange: (v: StatusFilter) => void;
  /**
   * sk-285.2.4 — the Kanban column axis (persisted user preference).
   * Unused by the cards / tree bodies. Optional so the anchored render
   * site, which forces tree view, does not have to carry it.
   */
  kanbanAxis?: KanbanAxis;
  /**
   * sk-285.2.5 — the board's card-field set («display properties»).
   * Unused by the cards / tree bodies, and optional for the same reason
   * as `kanbanAxis`: the anchored render site forces tree view.
   */
  kanbanCardFields?: ReadonlySet<KanbanCardField>;
  /**
   * sk-285.2.6 — the board's project focus and the two ways out of it.
   * Unused by the cards / tree bodies, and optional for the same reason
   * as `kanbanAxis`: the anchored render site forces tree view.
   */
  kanbanProjectFocus?: ProjectFocus;
  /** sk-674.18 T052 — the space place that holds no focused project, by name. */
  kanbanProjectFocusPausedBySpace?: string | null;
  onClearProjectFocus?: () => void;
  onShowAllProjects?: () => void;
  isLoading: boolean;
  error: unknown;
  emptyReason: ReturnType<typeof useTasks>['emptyReason'];
  /**
   * sk-303.14 (T025) — true while the unreviewed selection is applied.
   * The body needs it for one thing only: an empty list under this
   * selection is the GOOD outcome (nothing left to review), and it has to
   * read as such. "No tasks match the filters" would leave the reader
   * guessing whether the selection is broken; the error styling would say
   * outright that it is.
   */
  unreviewedSelected: boolean;
  /** Forwarded from useTasks for the IntersectionObserver-driven scroll. */
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
}

function TasksBody({
  items,
  anchored,
  view,
  sort,
  sortDir,
  onSortChange,
  searchQuery,
  narrowedBy,
  selectedIssueId,
  selectedProject,
  resolvedProjectId,
  treeRootAnchor,
  onClearAnchor,
  treeDepTypes,
  componentNames,
  treeColumns,
  listCardFields,
  projectHandles,
  onSelect,
  onCollapsedCountChange,
  statusFilter,
  onStatusFilterChange,
  kanbanAxis = KANBAN_DEFAULT_AXIS,
  kanbanCardFields,
  kanbanProjectFocus = EMPTY_PROJECT_FOCUS,
  kanbanProjectFocusPausedBySpace = null,
  onClearProjectFocus,
  onShowAllProjects,
  isLoading,
  error,
  emptyReason,
  unreviewedSelected,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
}: TasksBodyProps) {
  const { t } = useTranslation('tasks');
  // sk-551.32 — the board's fold memory lives HERE, above the loading
  // guard below: the board itself is unmounted while a widened filter
  // loads, and would forget what to fold back to.
  const kanbanFoldMemory = useKanbanFoldMemory(statusFilter, onStatusFilterChange);
  // Tree expand/collapse — Set<string> of issue ids that are open.
  // Persisted per-project so different surfaces don't clobber each
  // other. Default = everything collapsed (per spec).
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // sk-285.2.8 — expand/collapse the user performed WHILE a narrowing is
  // active. Ephemeral by design: under a filter the tree is already
  // unfolded along the paths to the matches, so a toggle there is a
  // statement about the filtered view, not about the shape of the tree
  // the user keeps. Kept out of `expanded` (and therefore out of
  // localStorage) so clearing the filter returns exactly the hand-made
  // shape. Semantics are a FLIP of the merged verdict — see
  // `mergeFilteredExpansion`.
  const [filterExpandOverrides, setFilterExpandOverrides] = useState<
    ReadonlySet<string>
  >(() => new Set<string>());

  // Read persisted state when project changes. Cross-project view
  // (selectedProject === null) uses a fixed key so the user has one
  // consistent expansion view there too.
  const treeStorageKey = useMemo(
    () => `skein.tasks.tree.${selectedProject ?? '__cross__'}.expanded`,
    [selectedProject],
  );

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(treeStorageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setExpanded(new Set(parsed.filter((s) => typeof s === 'string')));
          return;
        }
      }
    } catch {
      /* corrupted storage — fall through to empty set */
    }
    setExpanded(new Set());
  }, [treeStorageKey]);

  // sk-32 slice 8 — auto-expand epic-typed rows in the tree view on
  // first render per project switch. The user-driven toggleExpanded
  // path still persists subsequent collapse/expand to the same
  // localStorage key, so manually collapsing an epic sticks. We only
  // seed the auto-expansion once per (project, items-arrival) pair:
  //   - guarded by `hasSeededAutoExpandRef.current` so we don't fight
  //     the user every time they navigate
  //   - reset on project switch (via the treeStorageKey dep) so the
  //     new project starts fresh
  //   - skipped when localStorage already had a saved expanded set
  //     (the first effect above will have populated it) so we don't
  //     override a user's persisted collapse
  const hasSeededAutoExpandRef = useRef(false);
  useEffect(() => {
    hasSeededAutoExpandRef.current = false;
  }, [treeStorageKey]);
  useEffect(() => {
    if (hasSeededAutoExpandRef.current) return;
    if (!items || items.length === 0) return;
    // Skip auto-expand when we already restored a persisted set —
    // user has been here before, respect their existing choices.
    let persistedHasEntries = false;
    try {
      const raw = window.localStorage.getItem(treeStorageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          persistedHasEntries = true;
        }
      }
    } catch {
      /* fall through */
    }
    if (persistedHasEntries) {
      hasSeededAutoExpandRef.current = true;
      return;
    }
    const epicIds = items
      .filter((it) => it.type === 'epic')
      .map((it) => it.id);
    if (epicIds.length === 0) {
      hasSeededAutoExpandRef.current = true;
      return;
    }
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const id of epicIds) next.add(id);
      return next;
    });
    hasSeededAutoExpandRef.current = true;
  }, [items, treeStorageKey]);

  // IntersectionObserver-driven infinite scroll — mirrors the pattern
  // in `ProjectsColumn`. The sentinel is a zero-height `<div>` rendered
  // after the last row; when it enters the viewport we kick off the
  // next page. rootMargin 200px gives the user 200px of runway so the
  // next batch usually lands before they see "end of list". root is
  // `null` (defaults to the viewport) — same choice as ProjectsColumn,
  // chosen because the `.col-body` element is the actual scroll
  // container but it doesn't get its own scrollable status until first
  // paint; the viewport is reliable across all layout states.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    if (!hasNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && hasNextPage && !isFetchingNextPage) {
            fetchNextPage();
            return;
          }
        }
      },
      { root: null, rootMargin: '200px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // sk-36 — decide the tree rendering pipeline based on the chip-row
  // dep-type set. Only `parent-child` toggled on → fast path
  // (`buildIssueTree` over the already-fetched flat issue list, no
  // round-trip). Anything else → `useLayeredTree` against the new
  // backend endpoint, which returns a pre-flattened DFS row list
  // already-encoding (depth, parent, edge type) per row.
  const onlyParentChild =
    treeDepTypes.size === 1 && treeDepTypes.has('parent-child');

  // sk-98 — when anchored, the layered tree is rooted at the epic and runs
  // against the ANCHOR's projectId (the blob row carried it), regardless of
  // the column's resolved project. Anchored mode always takes the layered
  // path (never the flat parent-child fast path or the cross-project
  // fallback) so the rooted subtree query actually fires.
  const treeProjectId = anchored ? treeRootAnchor!.projectId : resolvedProjectId;

  // sk-44.5 (Fix E), rationale corrected in sk-285.2.14 — gate the
  // layered path off in the cross-project view.
  //
  // The ORIGINAL reason recorded here ("the endpoint is project-scoped;
  // it has no cross-project mode") was simply WRONG: `GET
  // /api/v1/issues/tree` is registered, `IssuesAllHandler.Tree` leaves
  // `IssueTreeArgs.ProjectID` nil — which the store reads as "forest
  // over every visible project" — and `fetchIssueTree` already routes
  // there whenever `projectId` is undefined. The gate is still correct,
  // but for two different reasons:
  //
  // (1) `IssueTreeArgs` accepts NO filter at all — no status, no type,
  //     no origin, no priority, no assignee, no search. (Status is left
  //     out deliberately: filtering it would snap a branch mid-chain.)
  //     "All projects" is the DEFAULT surface, and its chip row is
  //     supposed to narrow the body. A layered query would return the
  //     whole visible forest regardless of the chips, so the header
  //     count would move while the rows beneath it did not.
  //
  // (2) The walk is capped at `IssueTreeDefaultMaxNodes = 1000` and is
  //     not paginated. Across a whole visible forest — for an admin,
  //     literally every root in the installation — 422 `tree_too_large`
  //     is the EXPECTED outcome, not an edge case. It surfaces as a
  //     banner over an empty body whose text tells the user to narrow
  //     the filters — precisely the lever this endpoint does not have.
  //
  // So we fall back to the flat parent-child tree built from the
  // already-loaded, already-filtered cross-project `items`: the user
  // gets a tree of what is actually on screen instead of an empty body
  // under a too-large banner. Anchored mode never reaches this fallback
  // (it always carries a concrete project from the anchor).
  //
  // Revisit when BOTH hold: `IssueTreeArgs` takes the column's filters,
  // and the node ceiling becomes a cursor instead of a 422.
  const layeredUnavailable =
    !anchored && !onlyParentChild && resolvedProjectId === null;
  // `flatTreePath` = render via the client-side parent-child tree
  // (flattenTree(buildIssueTree(items))) rather than the backend layered
  // rows. True for the parent-child-only fast path OR the cross-project
  // fallback above. Anchored mode is ALWAYS the layered path.
  const flatTreePath = !anchored && (onlyParentChild || layeredUnavailable);

  // sk-285.2.7 — on the client-side tree path the page is a slice, so a
  // parent is routinely missing and its child would float to the root.
  // Backfill those parents by id (climbing until the branch reaches a
  // root) and feed them in as CONTEXT rows. Only on `flatTreePath`: the
  // layered path already gets whole branches from the server.
  const ancestors = useTreeAncestors({
    items,
    enabled: view === 'tree' && flatTreePath,
  });

  const layeredTypes = useMemo(() => [...treeDepTypes], [treeDepTypes]);
  // `useLayeredTree` does NOT self-disable on a null project (it collapses
  // null → undefined and would hit the endpoint cross-project), so we gate
  // it explicitly via `treeProjectId !== null` (Fix E).
  //
  // Regression note: when `anchored === false`, `treeProjectId ===
  // resolvedProjectId` and `(anchored || !onlyParentChild)` collapses to
  // `!onlyParentChild`, so this is identical to the prior
  // `view === 'tree' && !onlyParentChild && resolvedProjectId !== null`.
  // sk-429 — the condition is named because two readers use it: the query itself and
  // the freshness check below. Two copies of one condition would drift apart.
  const layeredEnabled =
    view === 'tree' && treeProjectId !== null && (anchored || !onlyParentChild);
  const layered = useLayeredTree({
    project: treeProjectId,
    rootId: anchored ? treeRootAnchor!.id : null,
    types: layeredTypes,
    enabled: layeredEnabled,
  });

  // sk-429 — catch up with an event that arrived DURING a walk in progress.
  //
  // The tree reset (`liveEventInvalidation.ts#invalidateTasksColumnTrees`)
  // marks the key stale with `cancelRefetch: false`: a walk in progress is
  // not cancelled, otherwise under a batch write it would never finish.
  // The price is an event that arrived between the start and the end of the walk: the
  // library does not start a new read while one is in progress, and the success of the one in progress clears the mark, and
  // such an event was caught up by nothing. The tree stayed stale until
  // the next event, which might not have come.
  //
  // Compared are the REQUEST moment of the shown response and the tree clock
  // (`lib/tasksColumnTreeClock.ts`). The request, precisely: a response sent BEFORE
  // the event and arriving AFTER it knows nothing about the change, and by the
  // arrival moment would falsely look fresh.
  //
  // The same composition as in the epic section (`EpicProgressSection.tsx`): the retry is
  // scheduled by the CONSUMER, not by the reset. Making the reset schedule a retry
  // is not possible — it covers several surfaces, and those that already have
  // the check would read twice (the sk-421.1 rule).
  //
  // There is no loop: a re-read sets a new `requestedAt` surely later than the clock,
  // and the next pass exits on the very first check.
  //
  // sk-545 — `cancelRefetch: false` here as well. The check runs when a
  // response is COMMITTED, and a stale response can be committed while a
  // read is already in flight — one the event itself started after the
  // clock moved. The library default (`true`) cancelled that read and
  // started another: one extra read per such event, and under a burst of
  // events the same endless cancelling that the invalidation avoids. Not
  // cancelling loses nothing: if the in-flight read was requested before
  // the clock, its own response is judged by this same check when it
  // commits, and the catch-up read starts then.
  const qc = useQueryClient();
  useEffect(() => {
    if (!layeredEnabled) return;
    if (layered.isLoading) return;
    // There is no response yet — nothing to judge; the request is in flight anyway.
    if (layered.requestedAt === null) return;
    if (!isStaleAgainstTasksColumnTreeClock(layered.requestedAt)) return;
    void qc.invalidateQueries({
      queryKey: layeredTreeQueryKey(
        treeProjectId,
        anchored ? treeRootAnchor!.id : null,
        layeredTypes,
      ),
      refetchType: 'active',
    }, { cancelRefetch: false });
  }, [
    layeredEnabled,
    layered.isLoading,
    layered.requestedAt,
    treeProjectId,
    anchored,
    treeRootAnchor,
    layeredTypes,
    qc,
  ]);

  // sk-98 — seed the rooted subtree EXPANDED on entry. The auto-expand-epics
  // effect above keys off the `useTasks` flat `items` list, not the layered
  // tree, so an anchored rooted tree would otherwise render collapsed. Seed
  // once per anchor id (ref-guarded) with every layered node id so the whole
  // subtree shows open when the user drills in; subsequent manual collapses
  // still stick via toggleExpanded.
  const seededAnchorIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!anchored || !treeRootAnchor) {
      seededAnchorIdRef.current = null;
      return;
    }
    if (seededAnchorIdRef.current === treeRootAnchor.id) return;
    if (layered.tree.length === 0) return;
    setExpanded((prev) => new Set([...prev, ...layered.tree.map((n) => n.item.id)]));
    seededAnchorIdRef.current = treeRootAnchor.id;
  }, [anchored, treeRootAnchor, layered.tree]);

  /**
   * sk-285.2.19 (step 4) — the ONE comparator both tree paths sort by,
   * and the same one `useTasks` orders the Cards list with
   * (`lib/taskSort.ts`). It used to be spelled out here as a private
   * copy of `useTasks.clientSort`; a direction that only one of the two
   * copies knew about is precisely how one stored preference starts
   * meaning two orders.
   *
   * sk-50 — 'relevance' compares every pair equal, i.e. "preserve the
   * server's RRF order". This path is normally NOT reached during a
   * search (TasksColumn forces `view='cards'` while searchActive), but
   * it is honoured here too as defence-in-depth.
   */
  const compareSiblings = useMemo(
    () => compareIssuesBy(sort, sortDir),
    [sort, sortDir],
  );

  // Build the tree once per data change. The comparator above orders the
  // children of each node among themselves — decision A: the sort never
  // moves a row out of its branch, so the hierarchy survives every sort
  // key and every direction, and the price (a LOCAL order) is stated by
  // the table itself. Only used by the fast path (parent-child only).
  const legacyTree = useMemo(() => {
    if (view !== 'tree' || !items || !flatTreePath) return [];
    // Backfilled parents join the page before grouping, and their ids go
    // in as `contextIds` so the tree can tell "this row is here because
    // it matched" from "this row is here to hold the branch up". They
    // sort as ordinary rows of their level — a context parent is a row
    // in its sibling list like any other, dimmed but not floated.
    const withAncestors =
      ancestors.items.length > 0 ? [...items, ...ancestors.items] : items;
    return buildIssueTree(withAncestors, compareSiblings, ancestors.contextIds);
  }, [view, items, compareSiblings, flatTreePath, ancestors.items, ancestors.contextIds]);

  // Flat row list — the unit `TaskTreeNode` consumes. Two sources:
  //
  //   Fast path (parent-child only):  flattenTree(legacyTree)
  //   Layered path:                   adapter over layered.tree from
  //                                   the backend (already flat;
  //                                   compute hasChildren via DFS
  //                                   depth lookahead).
  //
  // sk-135 — re-apply the MANDATORY standing top band at the ROOT of the
  // tree. Both pipelines re-order roots by the active sort (legacy:
  // `buildIssueTree` comparator; layered: backend DFS) and neither floats
  // standing, so without this the band that Cards gets via
  // `partitionStanding` is lost in Tree view. `partitionStandingTreeRows`
  // moves depth-0 standing subtrees (intact) to the front, ranked by the
  // SAME `compareStanding` primitive Cards uses. NOT applied when anchored:
  // the anchored tree is a single rooted subtree at one epic, not a board
  // forest, so there is nothing to float (the lone root is the anchor).
  const flatRows: FlatTreeRow[] = useMemo(() => {
    if (view !== 'tree') return [];
    const base = flatTreePath
      ? flattenTree(legacyTree)
      // sk-285.2.19 (step 4) — the layered tree arrives from the backend
      // in ITS DFS order, which knows nothing about the column's sort
      // key. Put through the same comparator, at every level, so a
      // heading click means the same thing under a dep-type lens and in
      // an anchored subtree as it does on the fast path. `sortDfsBlocks`
      // moves whole subtrees past each other — it cannot reparent, split
      // or drop one — so the tree the server sent is the tree rendered.
      : layeredToFlatRows(sortDfsBlocks(layered.tree, compareSiblings));
    return anchored ? base : partitionStandingTreeRows(base);
  }, [view, flatTreePath, legacyTree, layered.tree, compareSiblings, anchored]);

  // sk-285.2.8 — auto-expansion is live only where the narrowing and the
  // context mechanism both exist: the client-side tree path. The layered
  // path fetches a whole subtree from the backend WITHOUT the column's
  // filters, so every one of its rows would read as a "match" and the
  // rule would degenerate into "open everything". Anchored mode is
  // already excluded — `flatTreePath` is false there — and it seeds its
  // own subtree expanded anyway.
  const autoExpandActive =
    view === 'tree' && flatTreePath && narrowedBy !== '';

  // Ancestors of the matched rows: the rows that must stay open for the
  // matches to be reachable at all.
  const autoExpandedIds = useMemo(
    () => (autoExpandActive ? collectMatchAncestorIds(flatRows) : NO_AUTO_EXPAND),
    [autoExpandActive, flatRows],
  );

  // Drop the ephemeral overrides when the narrowing changes (including
  // when it ends) or the project switches: they describe a filtered view
  // that no longer exists, and carrying them over would silently close a
  // path to a match of the NEW filter. The functional guard keeps this
  // from queueing a state update on mount, where the set is already empty.
  useEffect(() => {
    setFilterExpandOverrides((prev) =>
      prev.size === 0 ? prev : new Set<string>(),
    );
  }, [narrowedBy, treeStorageKey]);

  // The set `visibleRows` and the chevrons actually read. Identical to
  // `expanded` whenever nothing is narrowing.
  const effectiveExpanded = useMemo(
    () =>
      mergeFilteredExpansion(
        expanded,
        autoExpandedIds,
        filterExpandOverrides,
        autoExpandActive,
      ),
    [expanded, autoExpandedIds, filterExpandOverrides, autoExpandActive],
  );

  const toggleExpanded = useCallback(
    (id: string) => {
      // Under a narrowing the toggle is temporary and never persisted —
      // see `filterExpandOverrides`.
      if (autoExpandActive) {
        setFilterExpandOverrides((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
        return;
      }
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        try {
          window.localStorage.setItem(
            treeStorageKey,
            JSON.stringify(Array.from(next)),
          );
        } catch {
          /* private mode / quota — ignore */
        }
        return next;
      });
    },
    [treeStorageKey, autoExpandActive],
  );

  // Apply expand/collapse: a row whose ANY ancestor is collapsed is
  // suppressed. Single forward pass — track the depth at which the
  // collapse happened; while we're below that depth, skip rows; once
  // we step back to ≤ collapsedDepth, resume rendering. Note that the
  // suppressed rows belong to the *most recent* collapsed ancestor;
  // we use a stack of (id, depth) to support multiple nested
  // collapsed ancestors gracefully.
  const visibleRows = useMemo(() => {
    if (view !== 'tree' || flatRows.length === 0) return flatRows;
    const out: FlatTreeRow[] = [];
    // collapsedDepth = smallest depth at which an ancestor is
    // currently collapsed; -1 = no active collapse.
    let collapsedDepth = -1;
    for (const r of flatRows) {
      if (collapsedDepth >= 0 && r.depth > collapsedDepth) {
        // Descendant of a collapsed ancestor — skip.
        continue;
      }
      // We've returned to or above the collapsed depth → release.
      if (collapsedDepth >= 0 && r.depth <= collapsedDepth) {
        collapsedDepth = -1;
      }
      out.push(r);
      // If this row itself is a collapsed parent, mark its depth so
      // subsequent deeper rows are suppressed. Reference rows never
      // have children (cycle / hidden stubs both prune the subtree
      // upstream) so we don't track them here.
      // sk-285.2.7 — a context row is scaffolding, and collapsing it
      // would hide the very rows that passed the filter behind a row the
      // user never asked to see. It renders without a chevron and always
      // open; `expanded` is not consulted for it.
      if (
        r.hasChildren &&
        !r.isReference &&
        !r.isContext &&
        !effectiveExpanded.has(r.item.id)
      ) {
        collapsedDepth = r.depth;
      }
    }
    return out;
  }, [view, flatRows, effectiveExpanded]);

  // sk-103 — how many real loaded issues are hidden under collapsed
  // ancestors. In Cards view `flatRows` is [] so this is 0. Lifted up to
  // the column header via the onCollapsedCountChange callback below.
  const collapsedCount = useMemo(
    () => countCollapsed(flatRows, visibleRows),
    [flatRows, visibleRows],
  );

  // sk-103 — push the collapsed count up to TasksColumn so the header chip
  // can read "N · M collapsed". Fires only when the value actually changes;
  // `onCollapsedCountChange` is the parent's `setCollapsedCount` setState
  // dispatcher, which React keeps referentially stable, so this effect
  // re-runs only on a real `collapsedCount` change (the `?.` covers the
  // anchored site that omits the prop).
  useEffect(() => {
    onCollapsedCountChange?.(collapsedCount);
  }, [collapsedCount, onCollapsedCountChange]);

  /**
   * sk-285.2.10 — imperative handle on the virtualized row list. The only
   * way to reach a row that is off screen: under virtualization it has no
   * DOM node to call `scrollIntoView()` on. Held here (rather than inside
   * the list) because the callers that need it — the reference-row jump
   * below, and keyboard navigation next to it — live at this level.
   */
  const treeScrollerRef = useRef<TaskTreeScroller | null>(null);

  /**
   * sk-36 — fired when the user clicks the "↻ see {firstSeenAt}" link
   * on a reference row. We translate it to a select call on the FIRST
   * occurrence so the issue opens in the Details column.
   */
  const handleJumpToFirst = useCallback(
    (firstSeenAt: string) => {
      // Build a stub IssueSummary the onSelect handler can use to
      // route. The select path only really cares about id + projectId
      // — the rest of the fields stay zero/empty. To get the right
      // projectId we look up the canonical row from the flat list.
      const target = flatRows.find((r) => r.item.id === firstSeenAt);
      if (target) {
        onSelect(target.item);
      }
      // sk-285.2.10 — and bring that canonical row on screen. This used
      // to be left to the user ("scroll the tree to reach it visually");
      // with the list virtualized the row may not exist in the DOM at
      // all, so the jump has to say where it went. A false return means
      // the row is currently collapsed under an ancestor — the Details
      // column still opened, which is the substance of the affordance.
      treeScrollerRef.current?.scrollRowIntoView(firstSeenAt, 'center');
    },
    [flatRows, onSelect],
  );

  // sk-62.2 / sk-194.5.2.8.5 — the cross-surface ringing set, read ONCE for
  // the whole list. `TaskCard` used to call `useRingingIssueIds()` itself,
  // which put one `QueryObserver` on the reminders query per rendered row
  // (474+ on a loaded board). TanStack Query dedupes the fetch by key but not
  // the observers, and each observer re-installs both of its timers on every
  // update of that query, so the cost scaled linearly with the row count —
  // measured at 2 998 timer installs / 26 s, ~26 % of the live-event window
  //. One observer here, a
  // `boolean` down to each card, which also keeps `memo(TaskCard)` intact.
  const ringingIssueIds = useRingingIssueIds();

  // The list's «display properties», packed ONCE for the whole list.
  // `TaskCard` is `memo()`d and takes the mask as a number: handing every
  // row the `ReadonlySet` would give it a prop that compares unequal on
  // every parent render (a keystroke in the search box re-renders this
  // component) and would silently undo that memo.
  const listFieldsMask = useMemo(
    () => listCardFieldsMask(listCardFields),
    [listCardFields],
  );

  // sk-98 — the `items`-based loading / error / empty guards below are
  // driven by the `useTasks` flat list. In anchored mode the body is driven
  // ENTIRELY by the `layered` query (rooted at the epic, possibly in a
  // different project than the column's `useTasks` scope — e.g. a
  // cross-project blob), so these guards would short-circuit a perfectly
  // valid rooted subtree. Skip them when anchored and let the `view ===
  // 'tree'` branch render the layered loading / tooLarge / rows directly.
  // sk-674.18 T052 — a space that is not among «my spaces»: the same
  // words whether it is someone else's or does not exist (US-3), and the
  // way back to «All projects».
  if (!anchored && emptyReason === 'space-not-found') {
    return (
      <div className="col-body tasks-body">
        <div className="tasks-empty-state col-error">
          <div>{t('spaceNotFound')}</div>
          <Link to="/">{t('spaceNotFoundBack')}</Link>
        </div>
      </div>
    );
  }

  if (!anchored && emptyReason === 'project-not-found') {
    return (
      <div className="col-body tasks-body">
        <div className="tasks-empty-state col-error">{t('projectNotFound')}</div>
      </div>
    );
  }

  if (!anchored && isLoading) {
    return (
      <div className="col-body tasks-body">
        <div className="col-empty">{t('loading')}</div>
      </div>
    );
  }

  if (!anchored && error) {
    return (
      <div className="col-body tasks-body">
        <div className="col-empty col-error">{t('loadFailed')}</div>
      </div>
    );
  }

  if (!anchored && (!items || items.length === 0)) {
    // Cross-project surface (no project selected) with a zero-row
    // response and no filters/search applied gets a friendlier copy
    // ("No tasks visible to you.") — the more generic "No tasks match
    // the filters" stays for the cases where filters are in play.
    const noFilters =
      searchQuery.trim() === '';
    const message = (() => {
      if (emptyReason !== 'no-results') return t('empty');
      // sk-303.14 (T025) — an empty unreviewed selection is a normal,
      // reachable state and it is the one the user wants: the selection
      // worked, the set is empty. Say that, in the vocabulary of the set
      // itself, before the generic filter copy gets a chance to imply
      // something went wrong.
      //
      // sk-303.14 (B/1 review C1) — but only when the zero rows really are
      // the answer about the unreviewed set. A search narrowed this list
      // too, and "everything you delegated, you've already reviewed" would then
      // be a statement about the reader's whole set made from a query that
      // never asked about it. `setSearch` releases the selection the moment
      // the box stops being empty, so the two are not supposed to be on at
      // once — this reads the query the rows actually came from rather than
      // trusting that, because the claim is the strong one on this screen.
      if (unreviewedSelected && noFilters) {
        return t('emptyUnreviewed');
      }
      if (selectedProject === null && noFilters) {
        return t('emptyVisible');
      }
      return t('emptyFiltered');
    })();
    return (
      <div className="col-body tasks-body">
        <div className="col-empty">{message}</div>
      </div>
    );
  }

  // sk-285.2.3 — Kanban. Placed before the tree branch and AFTER the
  // shared loading / error / empty guards above, so the board inherits
  // exactly the same "is there anything to show" verdict as the other two
  // bodies instead of re-deciding it. `anchored` never reaches here (it
  // forces view='tree' upstream), and neither does an active search
  // (forced to 'cards'), so the board only ever renders over the plain
  // list result.
  if (view === 'kanban') {
    return (
      <KanbanBoard
        items={items ?? []}
        axis={kanbanAxis}
        cardFields={kanbanCardFields}
        // sk-285.2.6 — the focus is applied INSIDE the board (it also has
        // to state itself there); `selectedProject` is what pauses it.
        projectFocus={kanbanProjectFocus}
        projectFocusPausedBy={selectedProject}
        projectFocusPausedBySpace={kanbanProjectFocusPausedBySpace}
        onClearProjectFocus={onClearProjectFocus}
        onShowAllProjects={onShowAllProjects}
        componentNames={componentNames}
        projectHandles={projectHandles}
        statusFilter={statusFilter}
        onStatusFilterChange={onStatusFilterChange}
        foldMemory={kanbanFoldMemory}
        selectedIssueId={selectedIssueId}
        onSelect={onSelect}
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        fetchNextPage={fetchNextPage}
      />
    );
  }

  if (view === 'tree') {
    // sk-36 — tooLarge banner from the layered query. Shows the
    // current toggle list so the user knows which lens to peel back.
    const renderTooLarge = () =>
      layered.tooLarge ? (
        <div
          className="col-error tasks-tree-toolarge"
          role="alert"
          aria-live="polite"
        >
          {/* sk-98 — anchored-aware copy: the limit was hit on the epic's
              rooted subtree, not the whole project forest. */}
          {anchored ? t('treeTooLargeAnchored') : t('treeTooLarge')}
          {' '}
          <span style={{ color: 'var(--ink-2)' }}>
            {t('activeLens', { lens: [...treeDepTypes].sort().join(', ') })}
          </span>
        </div>
      ) : null;
    // Layered query is loading and we have no rows yet → reuse the
    // standard "Loading tasks…" treatment. Only relevant in the layered
    // path (NOT the flat-tree fast path nor the cross-project fallback,
    // where the layered query is gated off and never loads).
    if (!flatTreePath && layered.isLoading && flatRows.length === 0) {
      return (
        <div className="col-body tasks-body">
          <div className="col-empty">{t('loadingTree')}</div>
        </div>
      );
    }
    // sk-98 — anchored layered query genuinely FAILED (network / server),
    // which is distinct from an empty subtree: on error `flatRows` is also
    // empty, so without this branch the failure falls through to the
    // "empty or unavailable" copy below and reads as a (mis)successful
    // empty result. Surface the failure explicitly + the way back.
    if (anchored && layered.error && !layered.tooLarge) {
      return (
        <div className="col-body tasks-body">
          <div className="col-empty col-error">
            {t('anchor.loadFailed')}{' '}
            <button
              type="button"
              className="tasks-tree-anchor-back tasks-tree-anchor-back-inline"
              onClick={onClearAnchor}
            >
              <IconArrowLeft size={16} stroke={1.75} aria-hidden />
              {t('anchor.backInline')}
            </button>
          </div>
        </div>
      );
    }
    // sk-98 — anchored subtree resolved to nothing (epic hidden / no
    // visible descendants and the root itself filtered out). Offer the
    // way back rather than a blank panel.
    if (anchored && !layered.tooLarge && flatRows.length === 0) {
      return (
        <div className="col-body tasks-body">
          <div className="col-empty">
            {t('anchor.empty')}{' '}
            <button
              type="button"
              className="tasks-tree-anchor-back tasks-tree-anchor-back-inline"
              onClick={onClearAnchor}
            >
              <IconArrowLeft size={16} stroke={1.75} aria-hidden />
              {t('anchor.backInline')}
            </button>
          </div>
        </div>
      );
    }
    // sk-285.2.10 — the banner sits OUTSIDE the scroll container now.
    // The virtualized list positions its rows at offsets measured from
    // the top of the scroller, so anything sharing that scroller above
    // the rows would shift every one of them by its own (wrapping,
    // width-dependent) height. Pinning the banner above the scroll area
    // keeps that offset exactly zero — and an alert that names the lens
    // to peel back is better pinned than scrolled away regardless.
    return (
      <div className="tasks-tree-shell">
        {renderTooLarge()}
        <TaskTreeVirtualList
          ref={treeScrollerRef}
          rows={visibleRows}
          // sk-285.2.13 — the same condition the sentinel below is
          // rendered under, and for the same reason: on the flat-tree
          // path another page can still arrive and grow `visibleRows`,
          // so no row may claim to know how many siblings it has. The
          // layered tree is not paginated (it caps at 1000 nodes), so
          // there the sizes are exact whatever `hasNextPage` says about
          // the unrelated `useTasks` query.
          hasMoreRows={flatTreePath && hasNextPage}
          selectedId={selectedIssueId}
          expanded={effectiveExpanded}
          searchQuery={searchQuery}
          componentNames={componentNames}
          treeColumns={treeColumns}
          // sk-285.2.19 (step 4) — the sort the headings show and change.
          // The EFFECTIVE key (so a stray mid-search tree would print
          // «Relevance» rather than a key it is not ordered by) with the
          // persisted direction.
          sort={sort}
          sortDir={sortDir}
          onSortChange={onSortChange}
          onSelect={onSelect}
          onToggle={toggleExpanded}
          onJumpToFirst={handleJumpToFirst}
          footer={
            <>
              {/* Sentinel for IntersectionObserver — only the flat-tree
                  path (parent-child fast path OR the cross-project
                  fallback) is backed by the paginated useTasks query, so
                  we only kick fetchNextPage in those modes. The layered
                  tree endpoint isn't paginated (it caps at 1000 nodes and
                  422s past that). It stays inside the scroll container,
                  below the row canvas, so it still only comes into view
                  once the user has scrolled past the last row. */}
              {flatTreePath && hasNextPage ? (
                <div ref={sentinelRef} aria-hidden style={{ height: 1 }} />
              ) : null}
              {flatTreePath && isFetchingNextPage ? (
                <div className="col-loading-more">{t('common:loadingMore')}</div>
              ) : null}
            </>
          }
        />
      </div>
    );
  }

  // sk-98 — `view !== 'tree'` (cards) is only reachable in non-anchored mode
  // (anchored forces view='tree'), where the earlier `!anchored && (!items …)`
  // guard already proved `items` non-empty. The `?? []` re-narrows for TS
  // since splitting that guard with `!anchored &&` dropped the flow narrowing.
  return (
    <div className="col-body tasks-body">
      {(items ?? []).map((item) => (
        <TaskCard
          key={item.id}
          item={item}
          selected={selectedIssueId === item.id}
          searchQuery={searchQuery}
          componentNames={componentNames}
          // Project handle under the title. Resolved from `projectId`
          // through the projects map, with the surface's own handle as
          // the fallback when the projects page hasn't cached that UUID
          // (single-project surface: every row belongs to it by
          // construction). Deliberately NOT derived from the issue id —
          // see the `projectHandle` prop doc on TaskCard.
          // sk-194.5.2.8.5 — a boolean, resolved from the ONE ringing set read
          // above. Passing the Set itself would defeat memo(TaskCard).
          isRinging={ringingIssueIds.has(item.id)}
          // The user's list «display properties», as a bitmask — a
          // primitive, for the same memo reason as `isRinging`.
          fields={listFieldsMask}
          // sk-194.5.2.8.2 — the stable list-wide handler, NOT a per-row
          // thunk: a fresh closure here would defeat memo(TaskCard).
          onSelect={onSelect}
        />
      ))}
      {/* Sentinel for IntersectionObserver — same shape as the tree
          branch above. */}
      {hasNextPage ? (
        <div ref={sentinelRef} aria-hidden style={{ height: 1 }} />
      ) : null}
      {isFetchingNextPage ? (
        <div className="col-loading-more">{t('common:loadingMore')}</div>
      ) : null}
    </div>
  );
}

/**
 * sk-674.18 T055 (screens 1.10, INV-18) — a person in the assignee filter:
 * a deleted account as its pseudonym, a departed person with "left"
 * as words in the option's text, the only thing the option shows.
 */
function personOptionLabel(
  name: string,
  status: PersonStatus | null | undefined,
  t: TFunction<'common'>,
): string {
  const label = personLabel(name, status);
  if (label.deleted) return `${label.text} · ${t('person.deleted')}`;
  if (label.departed) return `${label.text} · ${t('person.departed')}`;
  return label.text;
}
