/**
 * sk-44.4 / sk-44.5 — search-mode coordinator for the Tasks column.
 *
 * Owns two ORTHOGONAL axes that activate while a search is in flight
 * (non-empty search box) and reset cleanly when the box is cleared:
 *
 *   Filters axis (sk-44.4) — EPHEMERAL OVERLAY model
 *     - This hook NEVER mutates the persisted filter state
 *       (status / origin / type live in `useTasksUiState`, write-through
 *       to localStorage). Instead it computes the EFFECTIVE filters the
 *       list query should apply and returns them:
 *         • search active AND "within filters" OFF → effective filters
 *           are CLEARED (search runs unfiltered over the scope).
 *         • otherwise (within-filters ON, or no search) → effective =
 *           the live persisted filters, untouched.
 *     - The "within filters" toggle is a pure boolean flip: it changes
 *       which effective set we return; it writes nothing back.
 *     - Because the persisted state is never overwritten, a reload
 *       mid-search keeps the user's real filter preferences, and the
 *       sk-30 lens coordinator (which snapshots the persisted filters on
 *       lens activation) always sees the TRUE values — the two
 *       snapshot/restore machines no longer race over shared state.
 *     - The filter chips DISPLAY the effective filters and are disabled
 *       while the unfiltered search runs, so there is no display/edit
 *       conflict; their onChange still writes the persisted setters.
 *
 *   Sort axis (sk-50) — EPHEMERAL OVERLAY model, mirrors the filters axis
 *     - This hook NEVER mutates the persisted sort key (it lives in
 *       `useTasksUiState`, write-through to localStorage). Instead it
 *       owns an in-memory `searchSort` and returns `effectiveSort`:
 *         • search active → `effectiveSort = searchSort` (defaults to
 *           `'relevance'` — keep the server RRF order).
 *         • no search → `effectiveSort = persistedSort` (the live value
 *           passed in), so clearing the box snaps the combobox back to
 *           the user's persisted choice (e.g. ID) automatically.
 *     - `searchSort` is set to `'relevance'` ONLY on the search-BEGIN
 *       edge (empty → non-empty), in the same transition effect that
 *       resets `withinFilters`. It is NOT reset on later keystrokes — so
 *       if the user switches to Priority mid-search, that choice holds
 *       until the box is cleared.
 *     - `'relevance'` is never persisted (it's deliberately absent from
 *       the `SORT_VALUES` whitelist in `useTasksUiState`); it only ever
 *       lives here in the ephemeral overlay.
 *
 *   Scope axis (sk-44.5)
 *     - The "all projects" toggle widens the search scope to every
 *       visible project. On press we REMEMBER the current project +
 *       component selection, then move the project-tree cursor to the
 *       "All Projects" node (`setSelectedProject(null)`). On unpress —
 *       or when the search box is cleared — we RESTORE the cursor to
 *       the remembered project/component.
 *     - sk-674.18 T052 — the place «space» is a scope to widen FROM as
 *       well: on press the space is remembered and the cursor moves to
 *       «All projects», on unpress (or a cleared box) it comes back, so
 *       the search can still be widened on the new place.
 *
 * The two axes combine freely: a search can be (filtered | unfiltered)
 * × (current-project | all-projects) in any of the four combinations.
 *
 *   Lens axis (sk-46) — EPHEMERAL OVERLAY model, same shape as filters
 *     - The On-me / Delegated lenses (sk-30) are cross-project ownership
 *       lenses. While a lens is active the column must show the lens
 *       PRESET filters (`LENS_FILTER_PRESET`: status='active', type='all',
 *       origin='human-driven'), NOT the user's persisted preferences.
 *     - Previously the lens coordinator in `useLayoutState` applied that
 *       preset by calling the PERSISTED filter setters through the lens
 *       bridge — a write-through to localStorage. A reload mid-lens then
 *       dropped the in-memory snapshot but KEPT the preset in storage,
 *       permanently clobbering the user's real preferences (active / all /
 *       human-driven stuck forever). sk-46 fixes this exactly the way
 *       sk-44.4 fixed search: the preset is now a pure DERIVATION here.
 *     - When `lensActive`, the `effective*Filter` outputs surface the
 *       `LENS_FILTER_PRESET` values; the persisted state is never touched,
 *       so a reload mid-lens preserves the user's true filter prefs and a
 *       lens OFF simply reverts the derivation to those persisted values
 *       (no restore step, no snapshot to lose).
 *     - The lens axis takes priority over the search axis, but the two
 *       never fight: `searchActive` is already gated `&& !lensActive`, so
 *       the unfiltered-search branch is inert while a lens is on.
 *
 * Where the durable state lives:
 *   - persisted filters    → `useTasksUiState` (this hook only READS
 *     them and decides which set to surface as effective — it never
 *     writes them). The persisted state IS the filter memory now.
 *   - remembered tree pos  → `rememberedScopeRef` (this hook, in-memory)
 *   - withinFilters / allProjects toggle booleans → React state (this
 *     hook) so the buttons re-render on flip.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  OriginFilter,
  PriorityFilter,
  StatusFilter,
  TasksSortKey,
  TypeFilter,
} from '../api/issues';
import { LENS_FILTER_PRESET } from './useTasksUiState';

/** Snapshot of the tree cursor taken when "all projects" turns on. */
interface RememberedScope {
  /** Project handle (alias / idPrefix) — null means already All Projects. */
  selectedProject: string | null;
  /** Component UUID under the project, or null. */
  selectedComponent: string | null;
  /** sk-674.18 T052 — the place «space» (`<id>-<slug>`), or null. */
  selectedSpaceHandle: string | null;
}

export interface UseTaskSearchModesArgs {
  /** Debounced search box value (already trimmed-or-not — we trim here). */
  search: string;
  /** Lens flags — search mode is inert while either lens is on (sk-30). */
  outboxMode: boolean;
  onMeMode: boolean;
  /**
   * sk-303.14 (T024) — the unreviewed selection, read from the address by
   * `useLayoutState`. While it is on, `effectiveStatusFilter` IS the
   * `'unreviewed'` sentinel: the address is the single source of truth
   * for the selection, so there is no second copy in state that could
   * disagree with the URL, and the value is available in the SAME render
   * the list query is built in.
   */
  unreviewedSelected?: boolean;
  /**
   * sk-303.14 (T024) — write side of the same parameter. The status chips
   * route here instead of into filter state whenever the sentinel is
   * involved: picking it turns the selection on, picking anything else
   * turns it off. That is what keeps the sentinel out of every store —
   * ephemeral and persisted alike.
   */
  setUnreviewedSelected?: (v: boolean) => void;

  // Live persisted filter state (from useTasksUiState). The hook surfaces
  // these as the effective filters when not running an unfiltered search
  // and not under a lens, but never writes them back directly — the
  // persisted prefs are only ever mutated through the persisted setters
  // below, and only when NO lens is active (sk-69).
  statusFilter: StatusFilter;
  originFilter: OriginFilter;
  typeFilter: TypeFilter;
  /** sk-86 — live persisted priority filter; same overlay treatment as the rest. */
  priorityFilter: PriorityFilter;

  // sk-69 — persisted filter setters (from useTasksUiState). The hook
  // returns `effectiveSet*Filter` that route to THESE when no lens is
  // active, or to its own ephemeral lens-filter state while a lens is on
  // (so editing chips under a lens never touches the user's durable
  // prefs — the sk-46 invariant). The caller wires the chips' onChange to
  // the effective setters, not to these directly.
  setStatusFilter: (v: StatusFilter) => void;
  setOriginFilter: (v: OriginFilter) => void;
  setTypeFilter: (v: TypeFilter) => void;
  /** sk-86 — persisted priority setter (routed like the others). */
  setPriorityFilter: (v: PriorityFilter) => void;

  // sk-50 — live persisted sort key (from useTasksUiState). READ-ONLY
  // here: the hook surfaces it as `effectiveSort` when no search is
  // active, but never writes it back. During a search the ephemeral
  // `searchSort` overlay takes over.
  sort: TasksSortKey;

  // Live tree cursor (from useLayoutState).
  selectedProject: string | null;
  selectedComponent: string | null;
  /** Navigate the tree cursor. null = "All Projects" node. */
  setSelectedProject: (handle: string | null) => void;
  /** Navigate to a component under a project (used to restore scope). */
  setSelectedComponent: (cid: string | null, projectHandle: string) => void;
  /**
   * sk-674.18 T052 — the place «space» as the address names it
   * (`<id>-<slug>`), or null. Omitted — no space is the place.
   */
  selectedSpaceHandle?: string | null;
  /** sk-674.18 T052 — navigate back to a space place (used to restore scope). */
  setSelectedSpace?: (handle: string) => void;
}

export interface UseTaskSearchModesResult {
  /** True while a (lens-free) search is active — drives toggle visibility. */
  searchActive: boolean;
  /** True when the filter chips should be interactive. */
  filtersEnabled: boolean;
  /** "within filters" toggle state. */
  withinFilters: boolean;
  /** Flip "within filters". */
  toggleWithinFilters: () => void;
  /** "all projects" toggle state. */
  allProjects: boolean;
  /** Flip "all projects". */
  toggleAllProjects: () => void;
  /**
   * True when the "all projects" toggle can't do anything useful (the
   * user is already on the cross-project surface, so there's no project
   * to widen FROM). The view renders it disabled.
   */
  allProjectsDisabled: boolean;
  /**
   * sk-44.4 — EFFECTIVE filters the list query should apply. During an
   * unfiltered search (search active AND withinFilters OFF) these are
   * the CLEARED defaults so the RRF query runs over the full scope;
   * otherwise they mirror the live persisted filters. The persisted
   * state is never mutated — these are a pure derivation.
   */
  effectiveStatusFilter: StatusFilter;
  effectiveOriginFilter: OriginFilter;
  effectiveTypeFilter: TypeFilter;
  /** sk-86 — EFFECTIVE priority filter (cleared during unfiltered search; lens preset under a lens). */
  effectivePriorityFilter: PriorityFilter;
  /**
   * sk-69 — EFFECTIVE filter setters the chips' onChange should call.
   * While a lens is active they write the hook's ephemeral lens-filter
   * state (so the chips are LIVE under the lens — narrow the On-me /
   * Delegated list — without ever mutating the durable prefs). Outside a
   * lens they pass straight through to the persisted setters. The search
   * overlay does NOT need a routed setter: its chips are disabled while
   * unfiltered, and re-enabled (withinFilters ON) only when effective ===
   * persisted, so writes there always belong to the persisted prefs.
   */
  effectiveSetStatusFilter: (v: StatusFilter) => void;
  effectiveSetOriginFilter: (v: OriginFilter) => void;
  effectiveSetTypeFilter: (v: TypeFilter) => void;
  /** sk-86 — EFFECTIVE priority setter (lens-ephemeral under a lens, persisted otherwise). */
  effectiveSetPriorityFilter: (v: PriorityFilter) => void;
  /**
   * sk-50 — EFFECTIVE sort key the list query + tree comparator should
   * apply. During a search this is the ephemeral `searchSort` (defaults
   * to `'relevance'` = preserve server RRF order); otherwise it mirrors
   * the live persisted sort passed in. The persisted sort is never
   * mutated — this is a pure derivation, so clearing the box snaps the
   * combobox back to the persisted choice automatically.
   */
  effectiveSort: TasksSortKey;
  /**
   * sk-50 — set the ephemeral search-sort. The combobox calls this while
   * a search is active (NOT the persisted `setSort`), so a mid-search
   * sort choice never leaks into localStorage and vanishes on clear.
   * Outside a search this has no observable effect (`effectiveSort`
   * falls back to the persisted value), but the combobox routes to
   * `setSort` then anyway.
   */
  setSearchSort: (sort: TasksSortKey) => void;
}

/**
 * The cleared filter set surfaced as EFFECTIVE during an unfiltered
 * search — so the search runs over the full scope.
 *
 * sk-55 — statusFilter is `'all'`, NOT `'active'`. A search must find
 * CLOSED issues too (you're hunting a specific task, not browsing the
 * active backlog). With `'active'` the client-side post-filter in
 * useTasks (`if (statusFilter === 'active') drop closed`) silently hid
 * every closed hit — which broke numeric / exact-id search hard, since
 * small-numbered ids (sk-15, nova-15…) are mostly closed. `'all'` skips
 * that post-filter (it only fires for `'active'`) AND maps to the same
 * `undefined` wire status, so the server behaviour is unchanged. The
 * lens "cleared" preset stays `'active'` (a lens IS an active-backlog
 * view) — that's a separate constant in useTasksUiState.
 */
const FILTERS_CLEARED = {
  statusFilter: 'all' as StatusFilter,
  originFilter: 'all' as OriginFilter,
  typeFilter: 'all' as TypeFilter,
  priorityFilter: 'all' as PriorityFilter,
};

/** The four filter axes the lens overlay owns, as one value. */
interface LensFilters {
  statusFilter: StatusFilter;
  originFilter: OriginFilter;
  typeFilter: TypeFilter;
  priorityFilter: PriorityFilter;
}

/** The lens preset, as a `LensFilters` value (see `LENS_FILTER_PRESET`). */
const LENS_ENTRY_FILTERS: LensFilters = {
  statusFilter: LENS_FILTER_PRESET.statusFilter,
  originFilter: LENS_FILTER_PRESET.originFilter,
  typeFilter: LENS_FILTER_PRESET.typeFilter,
  priorityFilter: LENS_FILTER_PRESET.priorityFilter,
};

/**
 * sk-303.14 (T024) — what the overlay is seeded to when the surface is
 * entered WITH the unreviewed selection. Deliberately NOT the lens preset:
 * SC-017 requires every dimension other than the selection to be in the
 * "does not narrow" state, and the lens preset narrows two of them.
 *
 *   - `origin` — the preset is `'human-driven'`, which would drop every
 *     agent-created result. The unreviewed set does not care who filed the
 *     task, so a first frame under the preset would show FEWER rows than
 *     the second number counts — a direct INV-3 break, and the reason this
 *     constant exists at all rather than reusing the preset.
 *   - `status` — the preset is `'active'`, i.e. "everything except done",
 *     and the unreviewed set is closed results by construction. While the
 *     selection is on this value is not read (the sentinel overrides it);
 *     it is what the chips fall back to when the selection is DROPPED, so
 *     `'all'` is the honest seed: turning the selection off widens the
 *     list instead of emptying it.
 */
const UNREVIEWED_ENTRY_FILTERS: LensFilters = {
  statusFilter: 'all',
  originFilter: 'all',
  typeFilter: 'all',
  priorityFilter: 'all',
};

/** The status-chip value that stands for the unreviewed selection. */
const UNREVIEWED_STATUS: StatusFilter = 'unreviewed';

export function useTaskSearchModes(
  args: UseTaskSearchModesArgs,
): UseTaskSearchModesResult {
  const {
    search,
    outboxMode,
    onMeMode,
    statusFilter,
    originFilter,
    typeFilter,
    priorityFilter,
    setStatusFilter,
    setOriginFilter,
    setTypeFilter,
    setPriorityFilter,
    sort,
    selectedProject,
    selectedComponent,
    setSelectedProject,
    setSelectedComponent,
    selectedSpaceHandle = null,
    setSelectedSpace,
    unreviewedSelected = false,
    setUnreviewedSelected,
  } = args;

  const lensActive = outboxMode || onMeMode;
  const searchActive = search.trim() !== '' && !lensActive;

  // "within filters" — when OFF, the effective filters are CLEARED
  // (search runs unfiltered over scope) and the chips are disabled; when
  // ON, the live persisted filters apply and the chips re-enable.
  // Default OFF: a fresh search starts unfiltered.
  const [withinFilters, setWithinFilters] = useState(false);
  // "all projects" — when ON, scope widened to all visible projects.
  const [allProjects, setAllProjects] = useState(false);

  // sk-50 — ephemeral search-sort overlay. Defaults to 'relevance' (keep
  // the server RRF order). Set to 'relevance' on the search-BEGIN edge
  // (below); the combobox flips it to a real key mid-search via
  // setSearchSort. Never persisted — it falls out of scope when the box
  // is cleared (effectiveSort then reverts to the persisted `sort`).
  const [searchSort, setSearchSort] = useState<TasksSortKey>('relevance');

  // sk-69 — ephemeral, EDITABLE lens-filter overlay. While a lens is
  // active the chips read AND write THIS (not the persisted prefs), so
  // the user can narrow the On-me / Delegated list by status / type /
  // origin / priority without ever mutating their durable filter prefs
  // (the sk-46 invariant: no write-through to localStorage under a lens).
  // Seeded on each ENTRY edge (below) and simply stops being read on
  // exit — re-entry re-seeds. In-memory only: a reload mid-lens starts
  // back at the seed, same policy as `searchSort`.
  //
  // sk-303.14 (T024) — the four axes are ONE state value, not four, so a
  // seed is one atomic assignment. That matters now that the seed happens
  // during render (below): four separate setters would be four render-time
  // writes to reason about, and a partially-applied seed is exactly the
  // "first frame is narrower than the second number" defect.
  //
  // The initial value is seeded from the FIRST RENDER's inputs, not from a
  // constant. A surface can be entered by address as well as by click — a
  // shared link, a bookmark, a tap on a push notification all mount
  // straight into `?lens=delegated&select=unreviewed`. That mount fires no
  // edge (nothing changed; it started that way), so a constant initial
  // value would leave the entry seed unapplied and the overlay sitting on
  // the LENS preset — whose `origin: 'human-driven'` drops every
  // agent-filed result. Same first frame, same requirement, other door.
  const [lensFiltersState, setLensFiltersState] = useState<LensFilters>(() =>
    unreviewedSelected ? UNREVIEWED_ENTRY_FILTERS : LENS_ENTRY_FILTERS,
  );

  // sk-303.14 (T024) — the entry edge, detected DURING RENDER.
  //
  // This used to be a `useEffect` keyed on `lensActive`, and that was the
  // defect T024 exists to remove: an effect runs AFTER the render commits,
  // and the Tasks column builds its list request DURING that render. So
  // the first request went out carrying the previous filters, the seed
  // landed a moment later, and the normalisation arrived as a SECOND
  // request — while SC-017 asks for exactly one, already carrying the
  // selection.
  //
  // The React-sanctioned fix is to adjust state while rendering: the
  // component's own state, compared against the value it was computed
  // for. React re-runs this component immediately, before rendering
  // children or firing any effect, so nothing downstream ever observes
  // the stale value. Effects keep only side effects.
  //
  // `lensFilters` below is assigned the seed in the same pass as well.
  // That assignment is NOT what makes this work — React's re-run already
  // guarantees no stale value is committed, and removing the assignment
  // leaves every test in this class green (checked). It is here so the
  // value read a few lines down is visibly the one just decided, rather
  // than one that happens to arrive by a mechanism you have to know.
  //
  // Two edges seed, and both must:
  //   - entering a lens (the sk-69 behaviour, unchanged);
  //   - taking the unreviewed selection, which can happen with the
  //     Delegated lens ALREADY open (the jump from a narrowed Delegated
  //     view). No lens edge fires there, so keying on `lensActive` alone
  //     would leave the previous narrowing in place — chips still set to
  //     `type=bug`, and a first frame that cannot match the count.
  // Leaving the selection does NOT re-seed: the chips keep what they show
  // and the list simply widens.
  const [seededFor, setSeededFor] = useState({ lensActive, unreviewedSelected });
  let lensFilters = lensFiltersState;
  if (
    seededFor.lensActive !== lensActive
    || seededFor.unreviewedSelected !== unreviewedSelected
  ) {
    const entersLens = lensActive && !seededFor.lensActive;
    const takesSelect = unreviewedSelected && !seededFor.unreviewedSelected;
    setSeededFor({ lensActive, unreviewedSelected });
    if (entersLens || takesSelect) {
      lensFilters = unreviewedSelected
        ? UNREVIEWED_ENTRY_FILTERS
        : LENS_ENTRY_FILTERS;
      setLensFiltersState(lensFilters);
    }
  }

  // Per-axis writers over the single overlay value — what the chips call.
  const setLensStatusFilter = useCallback(
    (v: StatusFilter) => setLensFiltersState((p) => ({ ...p, statusFilter: v })),
    [],
  );
  const setLensOriginFilter = useCallback(
    (v: OriginFilter) => setLensFiltersState((p) => ({ ...p, originFilter: v })),
    [],
  );
  const setLensTypeFilter = useCallback(
    (v: TypeFilter) => setLensFiltersState((p) => ({ ...p, typeFilter: v })),
    [],
  );
  const setLensPriorityFilter = useCallback(
    (v: PriorityFilter) => setLensFiltersState((p) => ({ ...p, priorityFilter: v })),
    [],
  );

  // Remembered tree cursor across a single search cycle. Cleared when
  // the search box empties or the toggle is turned off. In-memory only —
  // a reload mid-search starts fresh (same policy as the lens snapshot).
  const rememberedScopeRef = useRef<RememberedScope | null>(null);

  // Track the previous searchActive value so we fire the
  // begin/end-search transitions exactly once per edge.
  const prevSearchActiveRef = useRef(false);

  // Read-current refs so the transition effect doesn't need the live
  // tree cursor/setters in its dep array (which would re-fire on every
  // keystroke). The effect reads these at edge time only. Filters are
  // intentionally ABSENT — the hook no longer touches them.
  const liveRef = useRef({
    selectedProject,
    selectedComponent,
    setSelectedProject,
    setSelectedComponent,
    selectedSpaceHandle,
    setSelectedSpace,
  });
  useEffect(() => {
    liveRef.current = {
      selectedProject,
      selectedComponent,
      setSelectedProject,
      setSelectedComponent,
      selectedSpaceHandle,
      setSelectedSpace,
    };
  });

  // Begin / end search transitions. Fires only on the searchActive
  // edge so typing more characters mid-search doesn't re-fire. Filters
  // are NOT manipulated here — only the withinFilters reset (on the
  // search→empty edge) and the scope restore.
  useEffect(() => {
    const prev = prevSearchActiveRef.current;
    if (prev === searchActive) return;
    prevSearchActiveRef.current = searchActive;

    const live = liveRef.current;
    if (searchActive) {
      // empty → non-empty: a fresh search starts unfiltered. We do NOT
      // touch persisted filters — the effective-filter derivation below
      // surfaces the cleared set while withinFilters is OFF.
      setWithinFilters(false);
      // sk-50 — a fresh search defaults to relevance order. This fires
      // ONLY on the begin edge (this branch runs once per empty→non-empty
      // transition), so typing more characters mid-search does NOT reset
      // a mid-search sort choice the user made (e.g. switched to Priority).
      setSearchSort('relevance');
    } else {
      // non-empty → empty: restore the scope cursor, reset both toggles.
      const rs = rememberedScopeRef.current;
      if (rs) {
        restoreScope(rs, live.setSelectedProject, live.setSelectedComponent, live.setSelectedSpace);
      }
      rememberedScopeRef.current = null;
      setWithinFilters(false);
      setAllProjects(false);
    }
  }, [searchActive]);

  // Pure boolean flip — the effective-filter derivation reacts to it; no
  // persisted filter setter is ever called.
  const toggleWithinFilters = useCallback(() => {
    setWithinFilters((v) => !v);
  }, []);

  const toggleAllProjects = useCallback(() => {
    setAllProjects((prev) => {
      const next = !prev;
      const live = liveRef.current;
      if (next) {
        // Turning ON — remember the current cursor, jump to All Projects.
        // Guard: only snapshot when we're on a real project AND no prior
        // snapshot is held. The null-snapshot guard protects against a
        // rapid re-toggle / in-flight route navigation reading a stale
        // `selectedProject` and clobbering a good remembered scope (the
        // OFF branch is what nulls the ref, so a non-null ref means a
        // restore is still pending and must not be overwritten).
        if (
          (live.selectedProject !== null || live.selectedSpaceHandle !== null)
          && rememberedScopeRef.current === null
        ) {
          rememberedScopeRef.current = {
            selectedProject: live.selectedProject,
            selectedComponent: live.selectedComponent,
            selectedSpaceHandle: live.selectedProject === null ? live.selectedSpaceHandle : null,
          };
          live.setSelectedProject(null);
        }
      } else {
        // Turning OFF — restore the remembered cursor.
        const rs = rememberedScopeRef.current;
        if (rs) {
          restoreScope(rs, live.setSelectedProject, live.setSelectedComponent, live.setSelectedSpace);
          rememberedScopeRef.current = null;
        }
      }
      return next;
    });
  }, []);

  // The chips are interactive when there's no active search OR the
  // "within filters" toggle is on. Outside search they always work.
  const filtersEnabled = !searchActive || withinFilters;

  // "all projects" is meaningless when the user is already on the
  // cross-project surface (no project to widen FROM). Once ON
  // (allProjects === true) we keep it enabled so the user can flip back.
  const allProjectsDisabled =
    !allProjects && selectedProject === null && selectedSpaceHandle === null;

  // EFFECTIVE filters — the only thing the list query should read.
  // Priority order:
  //   1. sk-46/sk-69 lens overlay — while a lens is active surface the
  //      EPHEMERAL lens-filter state, seeded to the preset (status=
  //      'active', type='all', origin='human-driven') on lens enter and
  //      then freely edited by the chips. Reads from the in-memory lens
  //      state, NOT the persisted prefs — so the persisted prefs stay
  //      untouched (sk-46), and a reload mid-lens drops back to them while
  //      the lens state re-seeds. The lens overlay wins over the search
  //      overlay — but they can't fight, since `searchActive` is already
  //      gated `&& !lensActive`.
  //   2. unfiltered search — the cleared set (search runs over the full
  //      scope) while a search is active and "within filters" is OFF.
  //   3. otherwise — the live persisted values, surfaced unchanged.
  //
  // sk-303.14 (T024) — the unreviewed selection sits ABOVE all three on
  // the status axis, and only there: the selection IS the status the
  // surface is showing, so while it is on the sentinel is what the chips
  // display and what the query builds from. It is a pure read of the
  // address (`unreviewedSelected`) — no state, nothing to seed, nothing
  // that can be one render behind. The other three axes stay on the lens
  // overlay, which the entry seeded to the non-narrowing set above.
  const unfilteredSearch = searchActive && !withinFilters;
  const effectiveStatusFilter = unreviewedSelected
    ? UNREVIEWED_STATUS
    : lensActive
      ? lensFilters.statusFilter
      : unfilteredSearch
        ? FILTERS_CLEARED.statusFilter
        : statusFilter;
  const effectiveOriginFilter = lensActive
    ? lensFilters.originFilter
    : unfilteredSearch
      ? FILTERS_CLEARED.originFilter
      : originFilter;
  const effectiveTypeFilter = lensActive
    ? lensFilters.typeFilter
    : unfilteredSearch
      ? FILTERS_CLEARED.typeFilter
      : typeFilter;
  const effectivePriorityFilter = lensActive
    ? lensFilters.priorityFilter
    : unfilteredSearch
      ? FILTERS_CLEARED.priorityFilter
      : priorityFilter;

  // sk-69 — EFFECTIVE setters the chips' onChange calls. Under a lens they
  // write the ephemeral lens-filter state (chips LIVE, prefs untouched);
  // otherwise they pass straight through to the persisted setters. Search
  // mode needs no special-casing here — its chips are disabled while
  // unfiltered and only re-enable (withinFilters ON) when effective ===
  // persisted, so a write there correctly lands on the persisted prefs.
  //
  // sk-303.14 (T024/T025) — the status chip is the one that also drives
  // the selection, because the selection occupies the status axis. The
  // sentinel therefore NEVER reaches a filter store: picking it writes the
  // address parameter, and picking anything ELSE while it is on drops the
  // parameter first, so the value the store receives is always a real
  // filter value. That is the whole mechanism behind "the sentinel cannot
  // leak into the persisted settings" — not a check somewhere downstream.
  const setStatusOrSelect = useCallback(
    (v: StatusFilter) => {
      if (v === UNREVIEWED_STATUS) {
        setUnreviewedSelected?.(true);
        return;
      }
      if (unreviewedSelected) setUnreviewedSelected?.(false);
      if (lensActive) setLensStatusFilter(v);
      else setStatusFilter(v);
    },
    [
      lensActive,
      setLensStatusFilter,
      setStatusFilter,
      setUnreviewedSelected,
      unreviewedSelected,
    ],
  );
  const effectiveSetStatusFilter = setStatusOrSelect;
  const effectiveSetOriginFilter = lensActive
    ? setLensOriginFilter
    : setOriginFilter;
  const effectiveSetTypeFilter = lensActive
    ? setLensTypeFilter
    : setTypeFilter;
  const effectiveSetPriorityFilter = lensActive
    ? setLensPriorityFilter
    : setPriorityFilter;

  // sk-50 — EFFECTIVE sort. While a search is active the ephemeral
  // `searchSort` drives ordering (defaults to 'relevance' = preserve
  // server RRF order); otherwise the live persisted sort. The lens does
  // NOT override sort — the sk-30 preset never included view/sort (those
  // are preserved across a lens cycle), so `lensActive` falls through to
  // the persisted `sort` here. Pure derivation — the persisted sort is
  // never written, so clearing the box reverts the combobox to it
  // automatically.
  const effectiveSort = searchActive ? searchSort : sort;

  return {
    searchActive,
    filtersEnabled,
    withinFilters,
    toggleWithinFilters,
    allProjects,
    toggleAllProjects,
    allProjectsDisabled,
    effectiveStatusFilter,
    effectiveOriginFilter,
    effectiveTypeFilter,
    effectivePriorityFilter,
    effectiveSetStatusFilter,
    effectiveSetOriginFilter,
    effectiveSetTypeFilter,
    effectiveSetPriorityFilter,
    effectiveSort,
    setSearchSort,
  };
}

/**
 * Restore the tree cursor to a remembered scope. When a component was
 * selected we route through `setSelectedComponent` (which builds the
 * `/projects/{h}/components/{cid}` URL); otherwise `setSelectedProject`.
 */
function restoreScope(
  rs: RememberedScope,
  setSelectedProject: (handle: string | null) => void,
  setSelectedComponent: (cid: string | null, projectHandle: string) => void,
  setSelectedSpace: ((handle: string) => void) | undefined,
): void {
  if (rs.selectedProject === null && rs.selectedSpaceHandle !== null && setSelectedSpace) {
    setSelectedSpace(rs.selectedSpaceHandle);
    return;
  }
  if (rs.selectedProject === null) {
    setSelectedProject(null);
    return;
  }
  if (rs.selectedComponent !== null) {
    setSelectedComponent(rs.selectedComponent, rs.selectedProject);
    return;
  }
  setSelectedProject(rs.selectedProject);
}
