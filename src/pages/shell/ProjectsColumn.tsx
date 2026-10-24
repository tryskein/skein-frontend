import { useEffect, useMemo, useRef, useState } from 'react';
import { TextInput } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { useDebouncedValue } from '@mantine/hooks';
import { Link } from 'react-router-dom';
import {
  IconLayoutSidebarLeftCollapse,
  IconSearch,
  IconX,
} from '@tabler/icons-react';
import { useLayoutState, type ProjectsPickOptions } from '../../lib/useLayoutState';
import { useNavLocalState, useNavScrollMemory } from '../../lib/useNavLocalState';
import { usePublishZoneCount } from '../../lib/useZoneCounts';
import { useProjectsInfinite } from '../../lib/useProjectsList';
import { useDeclareProjects } from '../../lib/liveProjectDeclaration';
import { useProjectByHandle } from '../../lib/useProjectByHandle';
import { useMySpaces } from '../../lib/useMySpaces';
import { useArrivedSpace } from '../../lib/useArrivedSpace';
import { useMyAccount } from '../../lib/useMyAccount';
import { isSpaceCollapsed } from '../../lib/navFoldRules';
import type { ProjectListItem } from '../../api/projects';
import type { MySpace } from '../../api/spaces';
import { ProjectRow } from './ProjectRow';
import { SpaceRow } from './SpaceRow';
import { spaceHandle } from '../../lib/shellUrlState';
import { ComponentRow } from './ComponentRow';
import { ComponentTree } from './ComponentTree';
import { NavSectionFrame, type NavSectionProps } from './NavSection';

interface Props {
  /**
   * The column's pixel width, or `null` when it has none of its own —
   * the TABLET mode (sk-285.7 T020, plan decision R10), where this zone
   * is a sliver and the row distributes what is left. `null` means the
   * persisted width was deliberately NOT read; see `InboxColumn`'s copy
   * of this note for why that distinction is the point.
   */
  width: number | null;
  /**
   * sk-290 — whole-column fold. When true the column renders as a
   * 44px vertical sliver instead of the tree; it is NOT unmounted and
   * NOT `display:none`, so the expand affordance keeps its place on
   * screen and in the tab order. Owned by
   * `useLayoutState().projectsCollapsed` (localStorage write-through).
   */
  collapsed: boolean;
  /**
   * sk-551.8 — draw as the Projects SECTION of the sections column
   * (`NavColumn`) instead of as a column: a section header, the same
   * search and tree as the body. Absent — the column, exactly as before.
   */
  section?: NavSectionProps;
}

/** sk-551.11 — every click in this column is an explicit pick. */
const PICK: ProjectsPickOptions = { endBudilnik: true };

/**
 * Pick the right empty-state message based on the active surface.
 * Search has the highest precedence (the user is actively narrowing),
 * then the lens mode (sk-30 — On me / Delegated), then the default.
 * Backend already filters by lens via the HAVING clause; this string
 * just communicates "your lens has no matches" to the user.
 */
function emptyMessageKey(
  search: string,
  onMeMode: boolean,
  outboxMode: boolean,
): string {
  if (search) return 'emptySearch';
  if (onMeMode) return 'emptyOnMe';
  if (outboxMode) return 'emptyDelegated';
  return 'empty';
}

/** One space row of the column and the loaded projects drawn under it. */
interface SpaceGroup {
  space: MySpace;
  projects: ProjectListItem[];
}

/**
 * sk-674.18 T051 — lay the loaded projects out under their space rows
 * (screens 1.1). `spaces` is `GET /me/spaces` in its own order — the
 * column order "Personal" → common → the rest by name (K9) — and the server
 * sends the projects in that same space order, so a group is never torn
 * apart by the 100-row pages.
 *
 * Which space rows are drawn:
 *   - a space with loaded projects — always;
 *   - under search or a lens (`narrowing`), nothing else: a space left
 *     without matching projects is hidden whole, an empty one too;
 *   - otherwise also a space with no loaded projects — the empty one,
 *     drawn from `/me/spaces` because the project list never carries it —
 *     unless more pages are still to come and the space sorts after the
 *     last one they reached: its projects may simply not be loaded yet.
 *
 * `rest` — loaded projects whose space is not among `spaces` (no such row
 * is expected; they are kept visible rather than dropped), drawn after the
 * groups without a space row.
 */
function buildSpaceGroups(
  spaces: readonly MySpace[],
  projects: readonly ProjectListItem[],
  narrowing: boolean,
  hasNextPage: boolean,
): { groups: SpaceGroup[]; rest: ProjectListItem[] } {
  const bySpace = new Map<string, ProjectListItem[]>(spaces.map((sp) => [sp.id, []]));
  const rest: ProjectListItem[] = [];
  for (const p of projects) {
    const rows = p.spaceId === undefined ? undefined : bySpace.get(p.spaceId);
    if (rows) rows.push(p);
    else rest.push(p);
  }
  let lastReached = -1;
  spaces.forEach((sp, i) => {
    if ((bySpace.get(sp.id) ?? []).length > 0) lastReached = i;
  });
  const groups: SpaceGroup[] = [];
  spaces.forEach((sp, i) => {
    const rows = bySpace.get(sp.id) ?? [];
    if (rows.length === 0 && (narrowing || (hasNextPage && i > lastReached))) return;
    groups.push({ space: sp, projects: rows });
  });
  return { groups, rest };
}

/**
 * Projects column (F3, Sc3). Alphabetic-by-server list of projects the
 * caller can see, with an "All projects" pseudo-row pinned on top (Q11),
 * a server-driven search box (Q9 — FTS+semantic against name / aliases /
 * id_prefix / description), and infinite-scroll pagination.
 *
 * Header renders `Projects (N)` where N is the caller-visible total
 * under the same WHERE clause that produced `items` (permission filter +
 * archived + search match). Even when the column has scrolled through
 * only the first page, the user sees the universe their search/toggle
 * is filtering over.
 *
 * Search box is debounced 300ms — query mutations roll a new query key,
 * so a fresh search resets cursor pagination automatically (TanStack
 * treats it as a different cache entry).
 *
 * Each project row is followed by its `<ComponentRow>` children, fetched
 * by `<ComponentTree>` (which owns its own `useQuery`).
 *
 * sk-290 — the WHOLE column folds into a 44px vertical sliver via the
 * "−" button in its header; clicking the sliver (or hitting Enter /
 * Space on it — it is a real `<button>`) expands it back. The fold
 * flag lives in `useLayoutState().projectsCollapsed` and is persisted
 * to localStorage, so the column comes back the way it was left. This
 * is the OUTER of two independent collapse levels — the inner one is
 * the per-project caret below. Folding the column does not touch the
 * per-project state, so reopening restores the exact tree shape.
 *
 * sk-285.1.2 — every project row carries a collapse caret for its own
 * subtree. sk-551.12 — expanded ids live in
 * `useLayoutState().expandedProjectIds` and are persisted to
 * localStorage, so the shape survives a reload; membership means
 * EXPANDED, so a project the user has never opened is collapsed — 52
 * projects open down to their components were a list nobody could find
 * anything in. The project the address selects (`/projects/{handle}` —
 * idPrefix, UUID or alias — with or without a component) is expanded
 * when it gets selected, so a
 * selected component is never hidden in a folded node; the user may
 * fold it again. A collapsed project doesn't render `<ComponentTree>` at
 * all — the subtree query is skipped along with the rows.
 *
 * Click on a project → URL `/projects/{idPrefix}`. Click "All
 * projects" → URL `/`. Click on a component → URL
 * `/projects/{idPrefix}/components/{cid}`. Re-clicking a selected
 * component deselects it. The Shell layout state reads
 * `selectedProject`/`selectedComponent` back from `useParams()` so
 * the highlight reflects the current URL.
 *
 * sk-551.11 — each of those clicks also ends the Reminders lens
 * (`PICK`): the lens replaces the Tasks column with the ringing list,
 * so a project picked under it would change nothing on screen. Done in
 * the click handlers, not on a URL change, so the paths that move the
 * project as a side effect — a task opened from the Reminders list,
 * Back / Forward — keep the lens. On me / Delegated stay on: they
 * narrow the picked project's list, which is what the user picked it for.
 *
 * outboxMode / onMeMode invariant: when a lens toggle is ON the
 * backend HAVING-filters the row set to projects with at least one
 * matching issue under the lens (sk-30 — `lens=on-me|delegated`
 * query param, see useProjectsInfinite). The column-header `total`
 * matches the lens-narrowed universe; the empty-state copy below
 * uses the active lens to phrase a helpful "no projects match this
 * lens" message instead of the generic "No projects".
 *
 * sk-674.18 T051 (screens 1.1, US-3, SC-014) — with two spaces or more in
 * «my spaces» (`useMySpaces`) the projects go under SPACE rows
 * (`SpaceRow`) in the column order "Personal" → common → the rest by name,
 * each foldable with the person's explicit choice remembered
 * (`navFoldRules.ts#isSpaceCollapsed`), an empty space with a hint under
 * its row, and "Your agent creates projects" (K2) for a person with no
 * project and no API key. With one space — and with none, an external
 * user — not one element of a space is drawn: the column is as before.
 * The space rows carry no task counts, so the lens invariant above has
 * nothing to narrow on them; under a lens, as under a search, a space
 * left without projects is hidden whole.
 */
export function ProjectsColumn({ width, collapsed, section }: Props) {
  const { t } = useTranslation('projects');
  const {
    selectedProject,
    selectedComponent,
    setSelectedProject,
    setSelectedComponent,
    expandedProjectIds,
    toggleProjectCollapsed,
    expandProject,
    setProjectsCollapsed,
    outboxMode,
    onMeMode,
    spaceFoldChoices,
    setSpaceCollapsed,
    setSelectedSpace,
    selectedSpace,
  } = useLayoutState();
  // sk-551.8 (P6) — held by the shell's navigation-state provider when
  // there is one (kept across threshold remounts, reset on a layout
  // change); a plain local state otherwise.
  const [search, setSearch] = useNavLocalState('projectsSearch', '');
  const [debouncedSearch] = useDebouncedValue(search, 300);
  const {
    items,
    total,
    isLoading,
    isError,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useProjectsInfinite(debouncedSearch);

  // sk-285.7 fidelity M1 — the same number the header chip prints, handed
  // to the mobile tab strip, which draws «Projects N» on its own tab
  // (`1g-mobile-390`). `null` while the first page is in flight, so the
  // strip prints nothing rather than a 0 the data does not support.
  usePublishZoneCount('projects', isLoading ? null : total);

  const filtered = useMemo(() => {
    // When the user types into the search box, the server sorts by
    // relevance. When no search is active, we sort alphabetically to
    // match the existing UX. Splitting on the search predicate keeps
    // the relevance order intact on hits.
    //
    // Note: sk-30 lens narrowing (onMeMode / outboxMode) is now
    // applied server-side via the `lens` query param in
    // useProjectsInfinite. We no longer post-filter on the client —
    // the row count the user sees matches the column-header counter.
    return debouncedSearch.trim()
      ? items
      : [...items].sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
        );
  }, [items, debouncedSearch]);

  // sk-674.18 T051 — space rows (screens 1.1). Drawn only with two spaces
  // or more, and only while every loaded project names its space: the
  // field is additive, and a list without it cannot be grouped, so the
  // column stays as it was rather than guessing.
  const spacesItems = useMySpaces().data?.items;
  const spaces = spacesItems ?? [];
  // sk-734 — the space that has just joined the list (`useArrivedSpace.ts`).
  const arrivedSpace = useArrivedSpace(spacesItems);
  const searching = debouncedSearch.trim() !== '';
  const narrowing = searching || onMeMode || outboxMode;
  const grouped = spaces.length >= 2 && filtered.every((p) => p.spaceId !== undefined);
  const layout = useMemo(
    () => (grouped ? buildSpaceGroups(spaces, filtered, narrowing, hasNextPage) : null),
    [grouped, spaces, filtered, narrowing, hasNextPage],
  );
  // A folded space with matches opens for the time of a search, and the
  // stored choice is not written (screens 1.1). A caret clicked DURING the
  // search folds the space for that search only — held here, dropped when
  // the search changes, never persisted.
  const [searchFolded, setSearchFolded] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    setSearchFolded(new Set());
  }, [debouncedSearch]);
  const spaceCollapsed = (sp: MySpace): boolean =>
    isSpaceCollapsed(sp, spaceFoldChoices[sp.id], searching) ||
    (searching && searchFolded.has(sp.id));
  const toggleSpace = (sp: MySpace) => {
    if (searching) {
      setSearchFolded((prev) => {
        const next = new Set(prev);
        if (!next.delete(sp.id)) next.add(sp.id);
        return next;
      });
      return;
    }
    setSpaceCollapsed(sp.id, !spaceCollapsed(sp));
  };

  // sk-734 — bring the arrived space into view: unfold it if a stored
  // choice keeps it folded (a space left and joined again), and scroll its
  // row to the TOP of the column — not merely into view: the bottom-left
  // toast that announced it covers the lower rows. The tail room under the
  // last row (`.projects-body::after`) lets even the last space go up there.
  const spaceNodeRefs = useRef(new Map<string, HTMLDivElement>());
  const arrivedShown = arrivedSpace !== null && layout?.groups.some((g) => g.space.id === arrivedSpace);
  useEffect(() => {
    if (!arrivedShown || arrivedSpace === null) return;
    if (!searching && spaceFoldChoices[arrivedSpace] === 'collapsed') {
      setSpaceCollapsed(arrivedSpace, false);
    }
    const node = spaceNodeRefs.current.get(arrivedSpace);
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    node?.scrollIntoView?.({ block: 'start', behavior: still ? 'auto' : 'smooth' });
    // Once per arrival: a fold or a refetch while it is lit must not pull
    // the column back — so the effect reads the fold and the layout but
    // reruns only on a new arrival.
  }, [arrivedSpace, arrivedShown]);

  // sk-674.18 T051 (K2) — "Your agent creates projects": a person with no
  // project and no API key is told where projects come from. Not under a
  // search or a lens (an empty list there means «nothing matched»), and
  // not while `hasApiKeys` is unknown — the field is additive, so its
  // absence shows nothing rather than a guess.
  const hasApiKeys = useMyAccount().data?.hasApiKeys;
  const showAgentLine =
    hasApiKeys === false && !narrowing && !isLoading && !isError && total === 0;

  // sk-551.12 — expand the selected project once per selection. The
  // address may name it by idPrefix, UUID or alias, so the handle goes
  // through the shared resolver (`useProjectByHandle`) and the UUID it
  // returns is what gets expanded; an alias resolves asynchronously, and
  // the effect waits for it. The guard is keyed on the handle, not on the
  // resolved object: a refetch hands back a new object (the resolver
  // builds one per render for an alias), and re-expanding on that would
  // undo the user's fold of the selected project.
  const { project: selectedProjectItem } = useProjectByHandle(selectedProject);
  const autoExpandedRef = useRef<string | null>(null);
  useEffect(() => {
    if (selectedProject === null) {
      autoExpandedRef.current = null;
      return;
    }
    if (autoExpandedRef.current === selectedProject) return;
    if (selectedProjectItem === null) return;
    autoExpandedRef.current = selectedProject;
    expandProject(selectedProjectItem.id);
  }, [selectedProject, selectedProjectItem, expandProject]);

  // IntersectionObserver-driven infinite scroll. The sentinel is a
  // zero-height `<div>` rendered after the last row; when it enters
  // the column body's viewport we kick off the next page. rootMargin
  // 200px gives the user 200px of runway before they hit the actual
  // last row, so the next batch usually lands before they see "end of
  // list". root is `null` (defaults to the viewport) — chosen
  // because the `.col-body` element is the actual scroll container
  // but it doesn't get its own scrollable status until first paint;
  // viewport is reliable across all layout states.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  useNavScrollMemory('projects', scrollContainerRef);
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    if (!hasNextPage) return;
    const root = scrollContainerRef.current ?? null;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && hasNextPage && !isFetchingNextPage) {
            fetchNextPage();
            return;
          }
        }
      },
      { root, rootMargin: '200px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // sk-622.21 T041 (US-9) — expanded rows show the project's counters and
  // components (registry class 1), so their projects are declared while
  // the rows are on screen. A folded column, a folded Projects section and
  // a section hidden by a shared file (its body stays mounted under
  // `inert`, NavSection) show no rows; collapsed rows are class 3 (focus /
  // navigation) and are not declared.
  const rowsShown = section ? !section.collapsed && !section.hidden : !collapsed;
  // sk-674.18 T051 — a project under a folded space row is not on screen.
  const foldedSpaceIds = layout
    ? layout.groups.filter((g) => spaceCollapsed(g.space)).map((g) => g.space.id).join(',')
    : '';
  const expandedShownIds = useMemo(() => {
    if (!rowsShown) return [];
    const folded = new Set(foldedSpaceIds === '' ? [] : foldedSpaceIds.split(','));
    return filtered
      .filter((p) => expandedProjectIds.has(p.id))
      .filter((p) => p.spaceId === undefined || !folded.has(p.spaceId))
      .map((p) => p.id);
  }, [rowsShown, filtered, expandedProjectIds, foldedSpaceIds]);
  useDeclareProjects('expanded', expandedShownIds);

  // sk-290 — folded state. Rendered AFTER every hook above so the hook
  // order stays identical in both states (an early return placed before
  // them would break the rules of hooks). The query keeps running while
  // folded, which is what lets the sliver carry a live project count.
  if (collapsed && !section) {
    return (
      <button
        type="button"
        className="col-projects-collapsed"
        aria-expanded={false}
        // The count is spoken at every value now that it is PRINTED at
        // every value — an empty column that announces itself without a
        // number would leave a screen-reader user unable to tell "empty"
        // from "not loaded", the same ambiguity the visible chip fixes.
        aria-label={t('expandColumnWithCount', { count: total })}
        onClick={() => setProjectsCollapsed(false)}
      >
        <span className="col-projects-sliver-label">
          {t('title')}
          <span
            className={
              total === 0
                ? 'col-projects-sliver-count col-count-empty'
                : 'col-projects-sliver-count'
            }
          >
            {total}
          </span>
        </span>
      </button>
    );
  }

  const renderProject = (p: ProjectListItem) => {
    // sk-551.12 — the address may name the project by UUID or
    // alias; the resolved project (the one the expansion above
    // uses) decides. idPrefix still matches at once, before the
    // resolver has answered.
    const isSelectedProject =
      selectedProject !== null &&
      (selectedProject === p.idPrefix || selectedProjectItem?.id === p.id);
    // sk-551.12 — membership = expanded, so an unknown id
    // (new project, cleared storage) reads as collapsed.
    const isCollapsed = !expandedProjectIds.has(p.id);
    return (
      <div key={p.id} className="project-tree-node">
        <ProjectRow
          project={p}
          selected={isSelectedProject && selectedComponent === null}
          searchQuery={debouncedSearch}
          onSelect={() => setSelectedProject(p.idPrefix, PICK)}
          collapsed={isCollapsed}
          // sk-551.52 — no components, nothing to unfold: the
          // row gets the caret spacer instead of a chevron. An
          // absent count (older API) keeps the chevron.
          onToggleCollapsed={
            p.componentsCount === 0
              ? undefined
              : () => toggleProjectCollapsed(p.id)
          }
        />
        {isCollapsed ? null : (
          <ComponentTree
            projectId={p.id}
            projectAlias={p.idPrefix}
            selectedComponent={
              isSelectedProject ? selectedComponent : null
            }
            onSelect={(cid) => {
              // Re-clicking the same component deselects it
              // (URL drops `/components/{cid}`); first click
              // navigates into it.
              if (isSelectedProject && selectedComponent === cid) {
                setSelectedComponent(null, p.idPrefix, PICK);
                return;
              }
              setSelectedComponent(cid, p.idPrefix, PICK);
            }}
          />
        )}
      </div>
    );
  };

  const pagingTail = (
    <>
      {/* Sentinel for IntersectionObserver — always rendered when
          more pages exist; the observer above watches it and
          drives fetchNextPage. Zero height so it doesn't shift
          layout. */}
      {hasNextPage ? (
        <div ref={sentinelRef} aria-hidden style={{ height: 1 }} />
      ) : null}
      {isFetchingNextPage ? (
        <div className="col-loading-more">{t('common:loadingMore')}</div>
      ) : null}
    </>
  );

  // sk-674.18 T051 (K2) — the line itself; where it stands is decided
  // below: in place of the empty-list text with one space, under «All
  // projects» above the space rows with several.
  const agentLine = (
    <div className="col-empty space-agent-line">
      <Link to="/settings/api-keys">{t('agentCreatesProjects')}</Link>
    </div>
  );

  const searchBox = (
      <div className="projects-search">
        <TextInput
          size="xs"
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          placeholder={t('searchPlaceholder')}
          // sk-285.7 T027 — 16, the inline step (FR-003 / §8). §6 draws
          // this glyph at 18, which is on no scale the language has; 16
          // is the step it rounds to and the one every other in-field
          // glyph in the shell already takes.
          leftSection={<IconSearch size={16} stroke={1.75} aria-hidden />}
          // sk-285.1.12 — the right section is exactly one tap target
          // wide (44px, see --tap-target) so the ✕ button fills it
          // instead of overflowing the input onto the rows below.
          rightSectionWidth={44}
          rightSection={
            search ? (
              <button
                type="button"
                className="projects-search-clear"
                aria-label={t('common:clearSearch')}
                onClick={() => setSearch('')}
              >
                <IconX size={16} stroke={1.75} aria-hidden />
              </button>
            ) : null
          }
          aria-label={t('searchAria')}
        />
      </div>
  );
  const body = (
      <div className="col-body projects-body" ref={scrollContainerRef}>
        <ProjectRow
          project={null}
          // sk-674.18 T052 — the place «space» is not «All projects».
          selected={selectedProject === null && selectedSpace === null}
          searchQuery=""
          onSelect={() => setSelectedProject(null, PICK)}
        />
        {isLoading ? (
          <div className="col-empty">{t('loading')}</div>
        ) : isError ? (
          <div className="col-empty col-error">{t('loadFailed')}</div>
        ) : layout ? (
          <>
            {showAgentLine ? agentLine : null}
            {layout.groups.length === 0 && layout.rest.length === 0 ? (
              <div className="col-empty">
                {t(emptyMessageKey(debouncedSearch, onMeMode, outboxMode))}
              </div>
            ) : null}
            {layout.groups.map(({ space, projects }) => {
              const isCollapsed = spaceCollapsed(space);
              return (
                <div
                  key={space.id}
                  className={`space-tree-node${space.id === arrivedSpace ? ' arrived' : ''}`}
                  ref={(el) => {
                    if (el) spaceNodeRefs.current.set(space.id, el);
                    else spaceNodeRefs.current.delete(space.id);
                  }}
                >
                  <SpaceRow
                    space={space}
                    collapsed={isCollapsed}
                    onToggleCollapsed={() => toggleSpace(space)}
                    selected={selectedProject === null && selectedSpace === space.id}
                    onSelect={() => setSelectedSpace(spaceHandle(space), PICK)}
                  />
                  {isCollapsed ? null : projects.length > 0 ? (
                    projects.map(renderProject)
                  ) : (
                    <div className="space-empty-hint">
                      <div>{t('spaceEmpty')}</div>
                      <div>
                        {t(space.adminAccess ? 'spaceEmptyJoinFirst' : 'spaceEmptyAskAgent')}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {layout.rest.map(renderProject)}
            {pagingTail}
          </>
        ) : filtered.length === 0 ? (
          showAgentLine ? (
            agentLine
          ) : (
            <div className="col-empty">
              {t(emptyMessageKey(debouncedSearch, onMeMode, outboxMode))}
            </div>
          )
        ) : (
          <>
            {filtered.map(renderProject)}
            {pagingTail}
          </>
        )}
      </div>
  );

  // sk-551.8 — a section of the sections column: the same search and
  // tree under a section header; the column's own header and sliver are
  // not drawn (the sections column has its own sliver).
  if (section) {
    return (
      <NavSectionFrame
        kind="projects"
        title={t('shell:nav.projects')}
        count={total}
        collapsed={section.collapsed}
        onToggle={section.onToggle}
        onCollapseColumn={section.onCollapseColumn}
        hidden={section.hidden}
      >
        {searchBox}
        {body}
      </NavSectionFrame>
    );
  }

  return (
    <div
      className="col-projects"
      // See `InboxColumn`: `null` renders no inline sizing, so the row
      // sizes the column instead of a `0 0 nullpx` basis being emitted.
      style={width === null ? undefined : { width, flex: `0 0 ${width}px` }}
    >
      <div className="col-header col-projects-header">
        <span className="col-projects-heading">
          {t('title')}
          {/* Printed at every value, zero included: see `.col-header-count`
              in index.css — an empty column says "0" in the dim/500
              treatment instead of dropping the chip. */}
          <span
            className={
              total === 0 ? 'col-header-count col-count-empty' : 'col-header-count'
            }
          >
            {total}
          </span>
        </span>
        <button
          type="button"
          className="col-header-btn"
          aria-expanded
          aria-label={t('collapseColumn')}
          onClick={() => setProjectsCollapsed(true)}
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
      {searchBox}
      {body}
    </div>
  );
}

// Re-export so test files can target the row directly.
export { ComponentRow };
