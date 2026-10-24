import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  COL_BOUNDS,
  COL_STORAGE_MAX,
  WORKSPACE_DETAILS_BOUNDS,
  LayoutProvider,
  useLayoutState,
  type WorkspaceWidthMode,
} from '../../lib/useLayoutState';
import { TasksUiStateProvider, useTasksUiState } from '../../lib/useTasksUiState';
import {
  TasksOutletProvider,
  useTasksOutlet,
  useWorkspaceFill,
} from '../../lib/useTasksOutlet';
import { ZoneCountsProvider, useZoneTabLabels } from '../../lib/useZoneCounts';
import { readWidthMode as readWidthModeNow, useWidthMode } from '../../lib/useWidthMode';
import { useIssueModalViews } from '../../lib/useIssueModalViews';
import { measureDetailsDrag, measureTasksDrag } from '../../lib/workspaceResize';
import type { ViewMode } from '../../api/issues';
import type { NavFoldEffects } from '../../lib/navFoldRules';
import { measureNavWidthDrag, navColumnWidthOnScreen } from '../../lib/navResize';
import { NAV_COLUMN_BOUNDS } from '../../lib/navLayoutStorage';
import { NavLocalStateProvider, useNavLocalStateApi } from '../../lib/useNavLocalState';
import { NavColumn } from './NavColumn';
import { useToaster } from '../../components/Toaster';
import { DetailsColumn } from './DetailsColumn';
import { HeaderBar } from './HeaderBar';
import { InboxColumn } from './InboxColumn';
import { ProjectsColumn } from './ProjectsColumn';
import { ResizeHandle } from './ResizeHandle';
import { TasksColumn } from './TasksColumn';

/**
 * Top-level layout for the new UI (F2 + F3).
 *
 * Renders the HeaderBar above a 4-column body:
 *   Inbox │ Projects │ Tasks │ Details
 *
 * Columns are resizable via `ResizeHandle` (widths persisted to
 * localStorage, see `useLayoutState`). Inbox can be manually
 * collapsed to a thin sliver, or auto-collapses when empty (F3, Q32).
 * Projects and Tasks collapse the same way (sk-290 and its Tasks
 * counterpart) — manual only, no auto-collapse — and all three fold
 * flags persist to localStorage. Folding all three at once is a
 * supported end state: the three 44px slivers stay side by side on the
 * left and the Details column takes every remaining pixel.
 *
 * The same Shell component is mounted for `/`, `/projects/:alias`,
 * `/projects/:alias/issues/:id` and `/issues/:id` — `useLayoutState`
 * reads the preselect from URL params.
 *
 * **Overlay mode (F3, Sc1 → sk-41 → sk-405):** Projects + Tasks are not
 * rendered and Details flexes to fill the right pane, with the
 * `.shell-columns.inbox-overlay` modifier capping the reading width.
 * ONE producer is left: a shared-link load of `?file=` (sk-41), which
 * wants the card and the file viewer side by side.
 *
 * Selecting an issue is NOT a producer any more. It was — the Queues
 * column tagged its navigations `location.state.fromInbox = true` and
 * this component folded the row on that flag — and sk-405 removed the
 * flag from both ends on the maintainers' instruction. Opening a task now
 * leaves every zone where it was; see the block above `inboxOverlay`
 * for the pixel measurement that says the four of them fit at the
 * floor.
 */
export function Shell() {
  // TasksUiStateProvider is mounted INSIDE LayoutProvider so the Tasks
  // column can read the persisted filter context alongside the layout /
  // lens state. LayoutProvider stays the outer boundary because it owns
  // URL state and the inbox-overlay flag (consumed by HeaderBar et al.).
  // sk-46 — the lens preset is now an ephemeral overlay derived in
  // `useTaskSearchModes` (it reads `LENS_FILTER_PRESET` and never writes
  // the persisted filters), so there is no longer an imperative bridge
  // between the two providers — the nesting is purely for context reads.
  return (
    <LayoutProvider>
      <TasksUiStateProvider>
        {/* sk-285.7 T019 — the Tasks column publishes its lensed result
            here so the two mobile counters (the zone strip's aggregate,
            the description sheet's position) read the SAME number the
            column shows, instead of each deriving a lens of its own.
            Innermost, because both the publisher and both consumers are
            inside `ShellInner`. */}
        <TasksOutletProvider>
          {/* sk-285.7 fidelity M1 — and the other two zones publish their
              own counts here, for the same reason and by the same route:
              the mobile strip draws one number per tab, and each number
              belongs to the column that already worked it out. Separate
              from the outlet above because that one carries the LENSED
              result (INV-10) and these two are not lens-derived — see
              `lib/useZoneCounts.tsx`. */}
          <ZoneCountsProvider>
            {/* sk-551.8 (P6) — the navigation's local state (search,
                Watching filter, marks, body scroll), held across threshold
                remounts and reset by a layout change. */}
            <NavLocalStateRoot>
              <ShellInner />
            </NavLocalStateRoot>
          </ZoneCountsProvider>
        </TasksOutletProvider>
      </TasksUiStateProvider>
    </LayoutProvider>
  );
}

/** sk-551.8 — the P6 provider, its scroll memory on with the sections setting. */
function NavLocalStateRoot({ children }: { children: ReactNode }) {
  const { navLayout } = useLayoutState();
  return (
    <NavLocalStateProvider rememberScroll={navLayout === 'sections'}>{children}</NavLocalStateProvider>
  );
}

/**
 * sk-551.8 — the row's width, for the tablet's live limit of the sections
 * column (US-8). `0` until measured (and in jsdom), which leaves the
 * stored width as it is.
 */
function useElementWidth(ref: RefObject<HTMLElement>, enabled: boolean): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    // Measured only while the sections column is drawn: the side-by-side
    // layout neither needs the number nor pays a re-render per resize.
    if (!enabled || el === null) return;
    const read = () => setWidth(el.getBoundingClientRect().width);
    read();
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, enabled]);
  return enabled ? width : 0;
}

/**
 * The navigation zones, in INV-1 order: "header on top, below it the zones in the
 * order Queues → Projects → Task list → Task description".
 *
 * Description is not in the list on purpose. It is the fourth zone and
 * it keeps its place at the end of the row — but on a phone it is not a
 * TAB, it is the full-screen sheet that opens on top of whichever zone
 * you were in, so it is reached by opening a task rather than by
 * picking it from a strip.
 *
 * The array is the single source of the order for the mobile strip
 * (SC-005: "the order and composition of zones match INV-1 in all width
 * modes — 0 deviations"). No test pins it against the DOM order of the
 * zones; keeping the two in step is this comment's and review's job.
 */
const ZONES = ['queues', 'projects', 'tasks'] as const;
export type ZoneKey = (typeof ZONES)[number];

/**
 * Stage 2 — one-time explanation of the auto-fold, so the first time two
 * columns disappear the user reads "the view took the room" instead of
 * "the app broke". Persisted, not per-session: the behaviour only
 * surprises once.
 *
 * ONE flag for both workspace views (board and tree), and one KEY, kept
 * at its Stage 2 spelling so a user who has already met the fold on the
 * board is not told about it again by the tree. The two views phrase the
 * sentence differently (`boardWorkspaceHint` / `treeWorkspaceHint`) —
 * whichever one folds first is the one that explains it.
 */
const STORAGE_BOARD_HINT_SEEN = 'skein.layout.board-workspace-hint-seen';

/** sk-551.8 — what a shared file hides in the sections layout (US-11). */
const FILE_HIDDEN_ZONES = '.nav-section--projects, .col-tasks';

/**
 * sk-285.7 T019 — the mobile zone strip.
 *
 * Three tabs in INV-1 order and one aggregate counter. Rendered only
 * below the mobile threshold: at wider widths every zone is on screen at
 * once, and three permanently-correct tabs would be three extra stops in
 * the keyboard tab order that select what is already selected.
 *
 * ── The accessible shape, and why it is `tablist` ────────────────────
 *
 * The strip picks which of several always-present panels is shown, which
 * is the tab pattern exactly. Each tab carries a TEXT name — the spec's
 * NFR line asks for it in as many words ("zone sliders and tabs have
 * text names with counters for screen readers") — and
 * the visible label is that same text, not an icon a screen reader would
 * have to be told about separately.
 *
 * ── The counters (INV-10) ───────────────────────────────────────────
 *
 * sk-285.7 fidelity M1 — ONE NUMBER PER TAB, which is what
 * `1g-mobile-390` draws: «Queues 10 · Projects 5 · Tasks 49», each
 * number beside the name it counts.
 *
 * The strip used to carry a single aggregate at its right edge — the
 * Tasks total — and that was a narrower reading of INV-10 than the
 * invariant asks for. The invariant is about the LENS: a number derived
 * from "the task list" has to move when the lens moves. It says nothing
 * against a tab counting its own zone, and two of these three zones are
 * not lens-derived at all (see `lib/useZoneCounts.tsx`). What the old
 * shape actually produced was a number floating free of the thing it
 * counted: at the right edge of a three-tab strip, «49» reads as
 * belonging to the strip.
 *
 * Every number is HANDED IN, none is computed here. Tasks arrives as the
 * label its own column prints (`countLabel`, `+` suffix and all), so the
 * strip and that header can never read differently; Queues and Projects
 * arrive from the two columns that own them.
 *
 * `null` is printed as NOTHING, deliberately: for Tasks it means the
 * current mode has no honest total (anchored subtree); for the other two
 * it means the column has not answered yet. A `0` in either case would
 * be a number the data does not support — but a real 0 IS printed, the
 * same way the column headers print theirs.
 */
function ZoneTabs({
  active,
  onSelect,
  counts,
}: {
  active: ZoneKey;
  onSelect: (zone: ZoneKey) => void;
  counts: Readonly<Record<ZoneKey, string | null>>;
}) {
  const { t } = useTranslation('shell');
  return (
    <nav className="zone-tabs" aria-label={t('zoneTabs')}>
      <div className="zone-tabs-list" role="tablist">
        {ZONES.map((zone) => {
          const count = counts[zone];
          return (
            <button
              key={zone}
              type="button"
              role="tab"
              className={
                zone === active ? 'zone-tab zone-tab-active' : 'zone-tab'
              }
              aria-selected={zone === active}
              // The count is inside the tab now, so the tab's accessible
              // name has to say what the number means — «Tasks 49» read
              // out as two loose tokens is the ambiguity WCAG 1.3.1 is
              // about. The visible text stays the short form.
              aria-label={
                count === null
                  ? t(`zone.${zone}`)
                  : t('zoneTabWithCount', { zone: t(`zone.${zone}`), count })
              }
              onClick={() => onSelect(zone)}
            >
              {t(`zone.${zone}`)}
              {count !== null && (
                <span className="zone-tab-count" aria-hidden="true">
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

/**
 * sk-551.4 — keep focus on the page when the reading pane beside a
 * workspace view goes away.
 *
 * Esc or the × closes the issue, and the pane and the workspace resize
 * handle unmount in the same commit. If focus was in either of them, the
 * browser drops it to `<body>` and the next Tab restarts at the skip
 * link. So, once the pane is gone, focus moves to what stays: the card or
 * tree row of the issue that was open, else the Tasks column header.
 *
 * Where focus WAS is taken from the last `focusin`, not from
 * `document.activeElement` at unmount time: by the time a layout effect
 * runs the node is already detached and the browser has moved focus.
 * A detached node still answers `closest()` within its removed subtree,
 * which is how «it was in the pane or on the handle» is told apart from
 * focus that was somewhere else entirely — that focus is left alone, as
 * is any focus that is still on a live element.
 */
function useRestoreFocusAfterPane(paneGone: boolean, selectedIssue: string | null) {
  const lastFocusRef = useRef<Element | null>(null);
  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      lastFocusRef.current = e.target instanceof Element ? e.target : null;
    };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, []);

  const openIssueRef = useRef(selectedIssue);
  useLayoutEffect(() => {
    const closed = openIssueRef.current;
    openIssueRef.current = selectedIssue;
    if (!paneGone || closed === null) return;
    restoreFocusAfterPane(lastFocusRef.current, closed);
  }, [paneGone, selectedIssue]);
}

function restoreFocusAfterPane(lastFocused: Element | null, closedIssue: string): void {
  if (lastFocused === null || lastFocused.isConnected) return;
  if (
    lastFocused.closest('.details-frame, .details-modal, .col-details, .resize-handle--workspace') ===
    null
  ) {
    return;
  }
  const active = document.activeElement;
  if (active !== null && active !== document.body) return;
  const card = [...document.querySelectorAll<HTMLElement>('.col-tasks [data-issue-id]')].find(
    (el) => el.dataset.issueId === closedIssue,
  );
  const target = card ?? document.querySelector<HTMLElement>('.col-tasks-header');
  target?.focus();
}

/**
 * sk-551.5 (review C2) — while the issue window is open, the columns under
 * its backdrop are `inert`: no Tab stop, no click, no screen-reader
 * browsing. Without it a click in the header took focus out of the window
 * and the next Tab walked into cards nobody could see.
 *
 * Only the row's own children are touched — never `document.body` and not
 * the header: menus and confirmations opened from inside the issue portal
 * to `body`, and the header (lenses, search, account menu) stays live
 * above the window. The window and its backdrop are excluded by class.
 *
 * Re-applied after EVERY render of the shell, not only when the flag
 * flips: the row's children are this component's own JSX, so a column or
 * handle that mounts while the window is open (a view switch) is a new
 * node that has to be marked too. React does not manage the attribute, so
 * nothing re-renders it away.
 */
function useInertBehindIssueModal(mainRef: RefObject<HTMLElement>, open: boolean): void {
  useLayoutEffect(() => {
    const main = mainRef.current;
    if (main === null) return;
    for (const child of Array.from(main.children)) {
      const isWindow =
        child.classList.contains('details-modal') ||
        child.classList.contains('details-modal-backdrop');
      if (open && !isWindow) child.setAttribute('inert', '');
      else child.removeAttribute('inert');
    }
  });
}

function ShellInner() {
  const { t } = useTranslation('shell');
  const layout = useLayoutState();
  const ui = useTasksUiState();
  const toaster = useToaster();
  const [searchParams] = useSearchParams();

  // ── "the view takes the workspace" — ONE mechanism, two views ───────
  //
  // sk-285.2.23. Stage 2 gave this to the Kanban board; the tree table
  // now enters by the SAME door. Entering either view folds the two
  // navigation columns; leaving for Cards puts back exactly what the
  // fold took. All the "did the automation or the user do this"
  // bookkeeping lives in `useLayoutState` (see `enterWorkspaceView`);
  // this effect only reports the TRANSITION.
  //
  // WHY the tree stopped having a mechanism of its own (it had one:
  // `treeWorkspaceWidths.ts`, deleted with this change), in pixels, at
  // the 1284px floor with nothing else folded (sk-285.7 T009 raised it
  // from 1240; every line below moved 44px with it):
  //
  //   `.shell-columns`     1284 − 2 × 3px lens frame            = 1278
  //   Kanban  Tasks        1278 − 44 − 44 (slivers) − 420
  //                        (`--col-details-board`)              =  770
  //   Tree    Tasks BEFORE 468 + (264−176) + (300−176) reclaimed =  680
  //   Tree    Tasks AFTER  the same row as the board            =  770
  //
  // The old projection could not reach the board's number and no
  // re-tuning of it could: with both navigation columns on screen at
  // their tree floor (176 + 176) and one 4px drag handle, the whole row
  // has 1278 − 356 = 922 to split between Tasks and Details, so a 770px
  // Tasks column would have left the reading pane 152px — below the
  // ~234px this layout tolerates. (152 either way: the floor and the
  // board's share both grew by the same 44.) The pixels the tree needed
  // were the ones the two navigation columns were holding, all of them,
  // which is precisely what folding does and pinning cannot.
  //
  // What the table does with them: it demands 596px at
  // `TREE_DEFAULT_COLUMNS` and now has 770 − 1px column border − ~15px
  // scrollbar gutter = 754, i.e. 158px of slack (was 96 when the tree
  // pinned the navigation columns instead of folding them), and every
  // one of those goes to the title — the only elastic track.
  //
  // sk-551.3 — those numbers have the reading pane at its 420 floor. Until
  // the user drags it, the pane now takes 40 % of the 1190 the view and
  // the pane split (476), the tree 714, and the table 714 − 16 = 698
  // against its current demand (`treeColumns.ts`). Dragging the pane down
  // to its floor gives back the 770 above.
  //
  // The demand is 596, not the 524 this comment carried until sk-285.7:
  // `status` 84 → 108 and `priority` 48 → 96 were widened after the
  // table was seen running, and this copy of the number was not moved
  // with them. `treeColumns.ts` holds the itemised version.
  // `TreeTableLayout.test.tsx` pins that inequality against the CSS
  // tokens above, so a change to either number turns red here.
  //
  // The `null` first value matters: on mount we merely tell the layout
  // where we are, without folding anything. A reload inside the board or
  // the tree must leave the columns exactly as the user left them —
  // re-folding a column they had re-opened by hand is the one behaviour
  // this whole design exists to prevent.
  //
  // Board ↔ tree is NOT a transition: `workspaceView` is true on both
  // sides, so the effect returns early and the columns hold still — no
  // fold/unfold flicker, no scroll reset, on a switch between the two
  // views that share the layout.

  // Which sentence the hint uses. A ref rather than an effect dependency:
  // the view name is not what should re-run the fold transition, it is
  // only what the toast says when one happens.
  const hintKeyRef = useRef<'boardWorkspaceHint' | 'treeWorkspaceHint'>(
    'boardWorkspaceHint',
  );
  hintKeyRef.current =
    ui.view === 'tree' ? 'treeWorkspaceHint' : 'boardWorkspaceHint';
  const workspaceView = ui.view === 'kanban' || ui.view === 'tree';
  const {
    enterWorkspaceView,
    leaveWorkspaceView,
    syncWorkspaceView,
  } = layout;
  // sk-551.8 — the layout is read through a ref here: the fold transition
  // below must not re-run on a change of layout (that is its own event).
  const navLayoutRef = useRef(layout.navLayout);
  navLayoutRef.current = layout.navLayout;
  const {
    dispatchNavEvent,
    syncNavView,
    takeNavModeSource,
    noteWorkspaceView,
  } = layout;
  // sk-551.8 — what the fold rules hand back for the shell to apply: the
  // auto-fold hint of the layout that folded (each by its own flag, which
  // the provider has already set), and focus moved off what a shared file
  // hides. Focus onto a chevron or the sliver is the section's and the
  // column's own business (`NavSection`, `NavColumn`).
  const pendingFileFocusRef = useRef(false);
  const applyNavEffects = (effects: NavFoldEffects) => {
    if (effects.hint === 'sections') toaster.info(t('nav.sectionsWorkspaceHint'));
    else if (effects.hint === 'columns') toaster.info(t(hintKeyRef.current));
    if (effects.focus === 'fileCollapseButton') pendingFileFocusRef.current = true;
  };
  const applyNavEffectsRef = useRef(applyNavEffects);
  applyNavEffectsRef.current = applyNavEffects;
  const prevWorkspaceViewRef = useRef<boolean | null>(null);
  const prevViewRef = useRef<ViewMode>(ui.view);
  useEffect(() => {
    const prev = prevWorkspaceViewRef.current;
    const prevView = prevViewRef.current;
    prevWorkspaceViewRef.current = workspaceView;
    prevViewRef.current = ui.view;
    const sectionsActive = navLayoutRef.current === 'sections';
    if (prev === null) {
      // With sections active the side-by-side record is the fold rules'
      // alone (P2): the bookkeeping only learns the view.
      if (sectionsActive) noteWorkspaceView(workspaceView);
      else syncWorkspaceView(workspaceView);
      // sk-551.8 — the shell shown again (or reloaded) on cards: stale
      // auto-fold marks go without opening anything (P2: the event is
      // also reported with side-by-side active, for the sections column).
      if (!workspaceView) {
        dispatchNavEvent(
          { type: 'shellLandedOnCards', cause: readWidthModeNow() === 'mobile' ? 'phone' : 'remount' },
          ui.view,
        );
      }
      return;
    }
    if (prev === workspaceView) return;
    const navEvent = {
      type: 'viewChanged' as const,
      from: prevView,
      to: ui.view,
      onShownShell: true,
    };
    if (sectionsActive) {
      // sk-551.8 (P2) — with the sections layout active the fold rules
      // alone decide and alone write the side-by-side record; its
      // bookkeeping only learns which view is on screen. (`syncWorkspaceView`
      // would drop the side-by-side marks on the way to cards — the marks a
      // deferred return still needs while a shared file is open, US-11.)
      applyNavEffectsRef.current(dispatchNavEvent(navEvent, prevView));
      noteWorkspaceView(workspaceView);
      return;
    }
    // sk-551.8 (P2) — side-by-side active: the fold rules hear the change
    // too, for the sections column's mark only.
    dispatchNavEvent(navEvent, prevView);
    if (!workspaceView) {
      leaveWorkspaceView();
      return;
    }
    const folded = enterWorkspaceView();
    if (folded.length === 0) return;
    let seen = true;
    try {
      seen = window.localStorage.getItem(STORAGE_BOARD_HINT_SEEN) === 'true';
    } catch {
      /* private mode — treat as seen, a hint is not worth a throw */
    }
    if (seen) return;
    try {
      window.localStorage.setItem(STORAGE_BOARD_HINT_SEEN, 'true');
    } catch {
      /* ignore */
    }
    // The view that actually folded is the one that explains itself.
    toaster.info(t(hintKeyRef.current));
    // The view is the only input: the layout and the width are read
    // through refs above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    workspaceView,
    enterWorkspaceView,
    leaveWorkspaceView,
    syncWorkspaceView,
    toaster,
    t,
  ]);

  // sk-551.8 — the router keeps the task view for the gestures (US-7).
  useEffect(() => {
    syncNavView(ui.view);
  }, [ui.view, syncNavView]);

  // ── TABLET (sk-285.7 T020, US-7, plan decision R10) ────────────────
  //
  // Between the mobile threshold and the app floor the desktop row does
  // not fit: four zones at their persisted widths add up to more than
  // the window has. The mode answers that by turning the two NAVIGATION
  // zones into their slivers (`--width-sliver`, 44px — the same folded
  // state the user can reach by hand on desktop, with the same label,
  // count and accessible name) and letting Tasks and Details share what
  // is left.
  //
  // Two properties, and the plan is explicit that only one arrangement
  // has both:
  //
  //   (a) the persisted widths are NOT READ here. Not clamped, not
  //       scaled — not consulted. A width the user deliberately dragged
  //       narrow on desktop would otherwise arrive in tablet as a zone
  //       narrower than the sliver it is supposed to be, and INV-4 does
  //       not allow that. So the zones are handed `null` and the row
  //       sizes them: sliver, sliver, flex, flex.
  //   (b) the persisted widths are NOT WRITTEN either. Nothing on this
  //       path calls `setColWidth` — the drag handles, the only writers
  //       of `skein.layout.col.*`, are not rendered at all, because in
  //       this mode there is no fixed width for a handle to move. A
  //       visit to tablet and back therefore leaves the desktop widths
  //       byte-for-byte as they were (coverage row 31).
  //
  //       In TABLET that falls out of the fold flags — both navigation
  //       zones are slivers, and a folded column renders no handle. On a
  //       phone it does NOT: the flags are false there on purpose (see
  //       the mobile block below), so each handle states `!narrowZones`
  //       itself. Two ways of reaching the same property, and the second
  //       one is written down because assuming the first covered mobile
  //       is exactly the mistake this comment used to describe as done.
  //
  //       sk-551.30 — ONE handle is back in tablet: the one between a
  //       workspace view (board, tree) and the reading pane. It does not
  //       break (a) or (b): it reads and writes a tablet-only width
  //       (`skein.layout.col.workspace-details-tablet`), never a
  //       desktop key — see `workspaceWidthMode` below.
  //
  // The FOLD FLAGS are overridden, not written, for the same reason: the
  // user's own `inboxCollapsed` / `projectsCollapsed` are their desktop
  // preference and are handed straight back on the way out. `||` rather
  // than an assignment is the whole mechanism — a zone the user had
  // already folded stays folded, and one they had open comes back open.
  //
  // `useWidthMode` is mounted HERE, and this is its first consumer: it
  // also keeps `<html data-width-mode>` in step with the window after the
  // boot script (T017) wrote the first value. Routes outside the shell
  // still read the boot value only; giving them a live one is T022's
  // business, not this task's.
  const widthMode = useWidthMode();
  const tabletSlivers = widthMode === 'tablet';

  // ── MOBILE (sk-285.7 T019, US-6, INV-1, INV-10) ────────────────────
  //
  // Below the mobile threshold four zones cannot sit in a row at all, so
  // the row becomes a COLUMN with one zone on screen and a tab strip
  // picking which — "a tab strip for the three navigation zones in the order of
  // INV-1", with the description opening as a full-screen sheet on top.
  //
  // Every zone is still RENDERED, in the same order, in every mode: the
  // strip changes which one is visible (a `data-active-zone` attribute
  // the stylesheet reads), it does not mount and unmount them. Three
  // reasons, and the first is the one that would bite silently:
  //
  //   1. the aggregate counter on the strip comes from the Tasks column
  //      (see `TasksOutletProvider` above). Unmounting that column while
  //      the user is in Queues would freeze the counter at its last
  //      value — a number that looks live and is not.
  //   2. the zones keep their scroll and their in-flight queries across
  //      a tab switch, which is what makes the strip feel like a strip
  //      and not like navigation. Staying mounted buys the QUERIES on
  //      its own; the SCROLL is the stylesheet's half of the promise and
  //      it is named there — the off-screen zone is hidden with
  //      `content-visibility: hidden`, which preserves rendering state,
  //      rather than with `display: none`, which is specified to destroy
  //      it (sk-365, measured: scrollTop read 0 under `display: none`
  //      while the zone was away, 1200 under `content-visibility`).
  //   3. INV-1's "composition of zones" becomes a property of the DOM in all three
  //      modes rather than of this mode's branch.
  const mobileZones = widthMode === 'mobile';
  // sk-285.7 T024 — the zone selection moved out of this component into
  // `useLayoutState`. It was a local `useState` here while the phone's
  // tab strip was its only caller; the compact header's aggregate
  // «Queues» button is the second one, and `HeaderBar` receives no props
  // from any of its three mounting roots. See `activeZone` on the layout
  // context for why lifting it beat threading a prop through all three.
  const activeZone: ZoneKey = layout.activeZone;
  const setActiveZone = layout.setActiveZone;
  // The description sheet, and the condition is deliberately narrow: no
  // open issue means no sheet, because a sheet showing "choose a task"
  // would cover the strip with an empty screen and the only way out of
  // it would be its own back button.
  const detailsAsSheet = mobileZones && layout.selectedIssue !== null;
  // INV-10 — the strip's aggregate counter. Not derived here: it is the
  // number the Tasks column already computed under the active lens, and
  // it is `null` in the one mode that has no honest total (anchored
  // subtree), where the strip prints nothing rather than a zero.
  const tasksOutlet = useTasksOutlet();
  // sk-285.7 fidelity M1 — the three labels the mobile strip prints. The
  // Tasks one is the outlet's own (lensed, `+`-suffixed when the total is
  // "rows loaded so far"); the other two come from the columns that own
  // them. Assembled here so `ZoneTabs` stays a view.
  const zoneTabLabels = useZoneTabLabels(tasksOutlet.countLabel);
  // sk-551.4 — the body the Tasks column fills the row with (board, tree)
  // or `null`. Published by the column, because only it knows which body
  // it ended up drawing (a search, pasted codes, an anchored subtree each
  // override the board).
  const workspaceFill = useWorkspaceFill();
  // sk-551.4 — beside a workspace view an EMPTY reading pane is not
  // drawn at all: "Choose a task…" held 420+ px beside a board that was
  // being cut off, with nothing to close it. Picking a card brings the
  // pane back; the × in its header (deselect) takes it away again. Cards
  // view keeps the empty pane — there it is a fixed part of the grid.
  // Not on a phone: there the pane is the sheet, and `detailsAsSheet`
  // already says «no open issue means no sheet».
  // ── sk-551.5 — the issue in a pop-up window, per view ───────────────
  //
  // The person can ask, per view (Cards / Board / Tree), for the open
  // issue to be drawn as a centred modal window over the view instead of
  // as the pane beside it (Appearance → «Open the issue in a pop-up
  // window»; the maintainers' decision of 2026-10-05). Keyed on the view the person
  // PICKED (`ui.view`), not on the body the column ended up drawing: the
  // setting is named after the switch the person sees, and a search that
  // draws cards inside the board view is still «the board» to them.
  //
  // Desktop and tablet only. On a phone the issue is the full-screen sheet
  // whatever the setting says. Not over the shared-file split either
  // (`inboxOverlay`): that layout already hands the row to the card and
  // the file viewer side by side.
  //
  // With the window on, the reading pane leaves the row for good — also
  // in Cards, where an empty «select a task» pane is otherwise part of the
  // grid — and the view takes the whole row (`tasksWidth` below). The one
  // exception is a FOLDED Tasks column: with nothing left to fill the row,
  // the empty pane stays where it was rather than leaving a blank band.
  const issueModalViews = useIssueModalViews().views;
  const hasFileParam = searchParams.has('file');
  const sharedFileLoad = hasFileParam && !layout.selfOpenedFile;
  const issueModal = !mobileZones && !sharedFileLoad && issueModalViews.has(ui.view);
  const detailsHidden =
    !mobileZones &&
    layout.selectedIssue === null &&
    (workspaceFill !== null || (issueModal && !layout.tasksCollapsed));
  // The window going away is the pane going away, for focus: closing it
  // (× or Esc) unmounts it (`detailsHidden` above), and focus lands on the
  // card of the issue that was open rather than on <body> — in all three
  // views. Stepping to another issue inside the window is NOT a close
  // (`selectedIssue` stays set), so focus stays in the window. With the
  // Tasks column folded the frame stays mounted as the empty pane; there
  // is no card and no column header to return to then anyway.
  useRestoreFocusAfterPane(detailsHidden, layout.selectedIssue);
  const issueModalOpen = issueModal && layout.selectedIssue !== null;
  const mainRef = useRef<HTMLElement>(null);
  useInertBehindIssueModal(mainRef, issueModalOpen);


  // ── The overlay, and the producer sk-405 took away ─────────────────
  //
  // There were TWO ways into this layout. Opening a card in the Queues
  // column was one of them: `selectInboxIssue` tagged the navigation
  // with `location.state.fromInbox = true` and this component read it,
  // which unmounted Projects and Tasks so the reading pane got the row.
  // sk-405 removed that producer entirely — the flag is not written and
  // not read any more — because the maintainers asked for the opposite:
  // "When a task is selected from the list, the projects and list
  // blocks must not be closed". The zones stay; the issue opens in the Details column and
  // is marked in whichever list already holds it.
  //
  // It was not a width decision to overturn. Measured at the floor
  // (`--app-min-width` 1284, Chromium, default persisted widths) the
  // four zones already sit side by side with nothing selected —
  // 264 + 300 + 468 + 246 = 1278, horizontal overflow 0 — so keeping
  // them costs nothing that was not already being spent, and no
  // threshold has to be introduced.
  //
  // sk-41 is the surviving producer: a shared-link load of `?file=`
  // (a URL with no `selfOpenedFile` marker) still gets the split layout
  // — card LEFT + viewer RIGHT — because that is a two-pane reading
  // surface, not a task selection. The in-card flow
  // (`selfOpenedFile = true`) keeps the full 4-column layout, with the
  // viewer replacing the Details column instead of commandeering the
  // shell.
  //
  // The CSS modifier keeps its `inbox-overlay` name. It is the same
  // layout state it always was, `.shell-columns.inbox-overlay` also
  // caps the reading width of the pane, and renaming a class to track
  // which feature happens to switch it on would churn the sheet and its
  // guards for no behavioural gain.
  // (`hasFileParam` / `sharedFileLoad` are read above, with the window.)
  //
  // …and it is a DESKTOP/TABLET behaviour only. On a phone the overlay
  // would hide the very zones the tab strip navigates between, and it
  // exists to give the open issue the whole pane — which the sheet
  // (T019) already does, better, by covering the screen.
  const inboxOverlay = !mobileZones && sharedFileLoad;

  // ── sk-551.8 — the sections layout ("Sections in one column") ───────
  //
  // Active on desktop and tablet only; on a phone the sheets and zone
  // tabs stay as they are whatever the setting says (US-9), and the
  // side-by-side branch below renders unchanged (INV-1).
  const navSections = layout.navLayout === 'sections' && !mobileZones;
  const navLocal = useNavLocalStateApi();

  // P13 — a change of the layout this shell OBSERVES. The first
  // observation is the mount and is not an event. Each change asks the
  // provider's cell where it came from: the person's click (`gesture`,
  // which may fold on a board) or anything else (`profile`: a late GET,
  // another field's PUT answer, a rollback — never folds). On desktop
  // and tablet the navigation's local state is dropped (US-15).
  const prevNavLayoutRef = useRef(layout.navLayout);
  useEffect(() => {
    const prev = prevNavLayoutRef.current;
    const next = layout.navLayout;
    if (prev === next) return;
    prevNavLayoutRef.current = next;
    const source = takeNavModeSource(next);
    applyNavEffectsRef.current(
      dispatchNavEvent({ type: 'modeChanged', to: next, source }, ui.view),
    );
    if (readWidthModeNow() !== 'mobile') navLocal?.reset();
    // Only the layout is the input; the view is read at the moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout.navLayout]);

  // Layer 1 — a SHARED file comes or goes (also on mount: a reload of a
  // link with `?file=`). The provider ignores a file opened from a card.
  const prevSharedFileRef = useRef<boolean | null>(null);
  useEffect(() => {
    const prev = prevSharedFileRef.current;
    prevSharedFileRef.current = sharedFileLoad;
    if (prev === sharedFileLoad || (prev === null && !sharedFileLoad)) return;
    applyNavEffectsRef.current(
      dispatchNavEvent({ type: sharedFileLoad ? 'fileOpened' : 'fileClosed' }, ui.view),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharedFileLoad]);

  // A width threshold crossed (desktop ↔ tablet ↔ phone).
  const prevWidthModeRef = useRef(widthMode);
  useEffect(() => {
    if (prevWidthModeRef.current === widthMode) return;
    prevWidthModeRef.current = widthMode;
    dispatchNavEvent({ type: 'widthCrossed', to: widthMode }, ui.view);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widthMode]);

  // US-11 — a shared file hides Projects and Tasks: focus that was in
  // them goes to "Collapse column" in the Queues header.
  //
  // WHERE focus was is recorded as it moves, not read when the file's
  // event is applied: the commit that brings `?file=` already takes the
  // Tasks column out of the row, and a focused element that leaves the
  // DOM leaves focus on <body> — by then nothing says it was in Tasks.
  const focusInHiddenRef = useRef(false);
  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      // Focus landing on <body> is focus LOST (the element left the DOM or
      // went inert), not a new place: it must not erase where it was.
      if (target === document.body || target === document.documentElement) return;
      focusInHiddenRef.current =
        target instanceof Element && target.closest(FILE_HIDDEN_ZONES) !== null;
    };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, []);
  useLayoutEffect(() => {
    if (!pendingFileFocusRef.current) return;
    pendingFileFocusRef.current = false;
    const active = document.activeElement;
    const wasInHidden =
      active === null || active === document.body
        ? focusInHiddenRef.current
        : active.closest(FILE_HIDDEN_ZONES) !== null;
    if (!wasInHidden) return;
    document
      .querySelector<HTMLElement>('.nav-section--queues .nav-section-header .col-header-btn')
      ?.focus();
  });

  // sk-285.2.23 — no per-view width projection any more. Both workspace
  // views take their room the same way (fold the navigation columns, let
  // the Tasks column flex into the row — see `TasksColumn`), so the
  // widths rendered here are simply the user's persisted ones.
  const colWidths = layout.colWidths;

  // What each zone is handed. Written out as three names rather than
  // inlined at four call sites so "the tablet does not read persist" is one
  // readable statement instead of a property of four ternaries.
  //
  // Mobile joins tablet on the width half and parts company with it on
  // the fold half. A phone zone has no width of its own either — it is
  // the whole screen — so the persisted numbers are just as irrelevant
  // there, and just as untouched. But it must never render a SLIVER: in
  // tablet the sliver sits beside the zones it is a shortcut back to, on
  // a phone it would be a 44px stripe alone on the screen with the tab
  // strip already doing that job. So the user's own fold flags, which a
  // phone user never set and cannot see, are simply not consulted.
  const narrowZones = tabletSlivers || mobileZones;
  const inboxWidth = narrowZones ? null : colWidths.inbox;
  const projectsWidth = narrowZones ? null : colWidths.projects;
  // sk-551.5 — with the issue window on, Cards has no pane beside it, so
  // the column takes the row (`null` → the row-filling shape). The
  // persisted width is not read and not written here, and comes back
  // untouched when the window is turned off.
  const tasksWidth = narrowZones || issueModal ? null : colWidths.tasks;
  const inboxCollapsed = tabletSlivers || (!mobileZones && layout.inboxCollapsed);
  const projectsCollapsed = tabletSlivers || (!mobileZones && layout.projectsCollapsed);
  const tasksCollapsed = !mobileZones && layout.tasksCollapsed;

  // Lens indicator — a colored border around the whole shell when On
  // me / Delegated / Reminders is active (the toggle button alone is easy
  // to miss). The colours are the `.shell-root.lens-*` rules in index.css
  // (sk-551.13).
  // The earlier banner under the header caused layout jump on toggle
  // so it was removed; the matching button colour does the textual
  // work instead.
  const lens = layout.onMeMode
    ? 'on-me'
    : layout.outboxMode
      ? 'delegated'
      : layout.budilnikMode
        ? 'budilnik'
        : null;

  // sk-551.29 — the reading pane's width beside a workspace view, when the
  // user dragged one. Handed to the stylesheet as a modifier class and a
  // custom property on the row: the rules that size the pane
  // (`index.css`, `.col-details` beside `.col-tasks-fill`) read them, and
  // without them the pane takes its default (sk-551.3; 400 in tablet).
  // Cards view has no `.col-tasks-fill`, so both are inert there.
  //
  // sk-551.30 — the tablet has a width of ITS OWN, and that is R10 kept,
  // not bent: the desktop number is not read here and a tablet drag does
  // not write it. A pane dragged to 600 on a wide window would leave a
  // 900px window's view below its floor, and a drag on the narrow window
  // must not change what the wide one shows when the user comes back.
  // Not on a phone: the pane is the full-screen sheet there.
  const workspaceWidthMode: WorkspaceWidthMode | null = mobileZones
    ? null
    : tabletSlivers
      ? 'tablet'
      : 'desktop';
  const workspaceDetailsWidth =
    workspaceWidthMode === null ? null : layout.workspaceDetailsWidth[workspaceWidthMode];
  const columnsStyle =
    workspaceDetailsWidth === null
      ? undefined
      : ({ '--workspace-details-w': `${workspaceDetailsWidth}px` } as CSSProperties);

  // sk-551.8 — the sections column's width: its own number per width mode
  // (INV-4), 300 on a first visit; on a tablet limited ON SCREEN by what
  // leaves Tasks its 280 (US-8). Nothing is written by drawing it — only
  // the handle writes, and only the width of the mode it is dragged in.
  const navWidthMode: WorkspaceWidthMode = tabletSlivers ? 'tablet' : 'desktop';
  const rowWidth = useElementWidth(mainRef, navSections);
  const navWidthShown = navColumnWidthOnScreen({
    mode: navWidthMode,
    savedWidth: layout.navWidth[navWidthMode],
    availablePx: rowWidth,
    tasksMinPx: COL_BOUNDS.tasks.min,
  });
  const navColumnShownCollapsed =
    layout.navTemp !== null ? layout.navTemp.columnCollapsed : layout.navColumnCollapsed;

  return (
    <div className={`shell-root${lens ? ` lens-${lens}` : ''}`}>
      <a className="sr-only-focusable" href="#main-content">
        {t('skipToContent')}
      </a>
      <HeaderBar />
      <main
        ref={mainRef}
        id="main-content"
        className={`shell-columns${inboxOverlay ? ' inbox-overlay' : ''}${
          workspaceDetailsWidth === null ? '' : ' shell-columns--details-sized'
        }${issueModalOpen ? ' shell-columns--issue-modal' : ''}`}
        style={columnsStyle}
        // T019 — which zone the phone is showing. An ATTRIBUTE, read by
        // `[data-width-mode='mobile'] .shell-columns[data-active-zone=…]`
        // rules, so every zone stays mounted and the stylesheet decides
        // which one is on screen. Written at every width (it is a
        // property of the shell, not of the phone) and simply unused
        // above the threshold, where all four zones are visible at once.
        data-active-zone={activeZone}
        aria-label={t('workspace')}
      >
        {/* Page-level heading for screen-reader outline navigation
            (WCAG 2.4.6). The header logo is chrome (<span>) so the
            document gets exactly one <h1> — this one. Visually hidden
            because the visible page is a 4-column workspace where a
            text heading would be visual noise. */}
        <h1 className="sr-only">{t('workspace')}</h1>
        {mobileZones && (
          <ZoneTabs
            active={activeZone}
            onSelect={setActiveZone}
            counts={zoneTabLabels}
          />
        )}
        {navSections ? (
          <NavColumn width={navWidthShown} />
        ) : (
          <InboxColumn
            collapsed={inboxCollapsed}
            width={inboxWidth}
          />
        )}
        {/* A folded column has no width to drag, so no handle — which is
            also the state both workspace views (board, tree) leave this
            column in. The persisted width is untouched and the handle
            comes back with the column, whether the user unfolds it by
            hand or leaves for Cards view.

            The tablet mode (T020) is covered by the fold condition
            without a clause of its own: `inboxCollapsed` is true there
            by construction, so no handle is rendered.

            MOBILE is NOT, and this is where relying on the fold flag
            went wrong. On a phone the flags are deliberately not
            consulted (`inboxCollapsed` is FALSE there — a phone must
            never draw a 44px sliver beside the tab strip), so the fold
            condition alone rendered the handle: two `role="separator"`
            stops on a stacked `.shell-columns`, reading the desktop
            widths into `aria-valuenow` and writing them back through
            `setColWidth` on an arrow key. `!narrowZones` is the clause
            that actually states R10 — "in narrow modes the persisted widths are not
            read and not written" — and it is the same clause the Tasks
            handle below already carried. */}
        {navSections ? (
          !navColumnShownCollapsed && (
            // sk-551.8 — the sections column's width (US-5): 200…480 on a
            // desktop, the live limit on a tablet (US-8); writes the width
            // of the mode it is dragged in only.
            <ResizeHandle
              // A key of its own: the side-by-side Queues handle sits in the
              // same slot, and its live ARIA must not carry over (INV-1).
              key="nav-width"
              variant="plain"
              label={t('nav.resizeWidth')}
              min={NAV_COLUMN_BOUNDS.min}
              max={NAV_COLUMN_BOUNDS.max}
              width={navWidthShown}
              onResize={(w) => layout.setNavWidth(navWidthMode, w)}
              liveBounds={(handle) =>
                measureNavWidthDrag(
                  handle,
                  navWidthMode,
                  COL_BOUNDS.tasks.min,
                  layout.navWidth[navWidthMode],
                )
              }
            />
          )
        ) : (
          !inboxCollapsed && !narrowZones && !inboxOverlay && (
            <ResizeHandle
              key="inbox-width"
              col="inbox"
              min={COL_BOUNDS.inbox.min}
              max={COL_BOUNDS.inbox.max}
              width={layout.colWidths.inbox}
            />
          )
        )}
        {!inboxOverlay && (
          <>
            {navSections ? null : (
              <ProjectsColumn
                width={projectsWidth}
                collapsed={projectsCollapsed}
              />
            )}
            {/* sk-290 — no drag handle while the column is a sliver:
                there is no width to drag, and the handle would sit
                between two collapsed-state affordances. The persisted
                width survives untouched and comes back on expand. The
                tablet sliver (T020) rides the same condition; MOBILE
                does not, and needs `!narrowZones` in its own right —
                see the Queues handle above for why the fold flag is
                false there and what that handle was doing on a phone. */}
            {!navSections && !projectsCollapsed && !narrowZones && (
              <ResizeHandle
                col="projects"
                min={COL_BOUNDS.projects.min}
                max={COL_BOUNDS.projects.max}
                width={layout.colWidths.projects}
              />
            )}
            <TasksColumn
              width={tasksWidth}
              collapsed={tasksCollapsed}
              outboxMode={layout.outboxMode}
              onMeMode={layout.onMeMode}
              budilnikMode={layout.budilnikMode}
            />
            {/* The handle between the WORKSPACE (tree, board) and the task
                panel. sk-551.29 — moves the PANEL width (`sizes="after"`):
                it is remembered, the view takes the remainder, so the extra
                window width goes to the board/tree. The travel is as in "Cards",
                from the first pixel: `width` can be `null` (not dragged,
                the default width from `index.css`), so the start and
                limits of the drag are measured live at the moment of the press
                (`lib/workspaceResize.ts#measureDetailsDrag`): the view is the
                left neighbour, hence the place right after the column.

                sk-551.4 — the handle exists only while there is a task panel
                next to it: without it there is no boundary and nothing to drag, and a handle at the
                right edge would hang there pointlessly. Which of the two handles on
                Tasks is needed is decided by what the column
                `workspaceFill`.

                sk-551.30 — also in the tablet layout: the maintainers considered it
                a defect that the panel width cannot be changed in a narrow window.
                It writes the TABLET width (`workspaceWidthMode`), does not read or touch the
                desktop one — R10 (see above). On a phone there is no handle:
                the panel there is a full-screen sheet. */}
            {!tasksCollapsed &&
              workspaceWidthMode !== null &&
              workspaceFill !== null &&
              !issueModal &&
              !detailsHidden && (
                <ResizeHandle
                  col="workspace"
                  sizes="after"
                  min={WORKSPACE_DETAILS_BOUNDS.min}
                  max={WORKSPACE_DETAILS_BOUNDS.max}
                  width={workspaceDetailsWidth}
                  onResize={(w) => layout.setWorkspaceDetailsWidth(workspaceWidthMode, w)}
                  liveBounds={(handle) =>
                    measureDetailsDrag(
                      handle,
                      { viewMin: COL_BOUNDS.tasks.min, max: WORKSPACE_DETAILS_BOUNDS.max },
                      workspaceDetailsWidth,
                    )
                  }
                />
              )}
            {/* Same rule as the Projects handle above: a folded column
                has no width to drag, and the handle would only sit
                between two collapsed-state affordances. The persisted
                width survives untouched and comes back on expand.

                Stage 2 / sk-285.2.23 — and none while a workspace view
                (board, tree) fills the row: the column has no fixed
                width there. The handle above moves the reading pane's
                width instead; the persisted one is untouched and comes
                back in Cards view.

                T020 — and not in tablet either: the column has no fixed
                width there (it takes the row's leftover), so there is
                nothing for a drag to move, and rendering the handle
                would put the one writer of `skein.layout.col.*` on a
                surface whose whole contract is that it does not write.

                sk-551.43 — the upper bound of the drag is measured live, not taken from
                `COL_BOUNDS.tasks.max`: column plus panel minus the panel
                floor (`lib/workspaceResize.ts#measureTasksDrag`), so that
                the task card can be narrowed to the same 420 as
                next to the tree and the board. The start and ARIA come from the same
                measurement, as for the handle above. */}
            {!tasksCollapsed && !narrowZones && workspaceFill === null && !issueModal && (
              <ResizeHandle
                col="tasks"
                min={COL_BOUNDS.tasks.min}
                max={COL_BOUNDS.tasks.max}
                width={layout.colWidths.tasks}
                liveBounds={(handle) =>
                  measureTasksDrag(
                    handle,
                    {
                      min: COL_BOUNDS.tasks.min,
                      fallbackMax: COL_BOUNDS.tasks.max,
                      hardMax: COL_STORAGE_MAX.tasks,
                    },
                    layout.colWidths.tasks,
                  )
                }
              />
            )}
          </>
        )}
        {!detailsHidden && (
          <DetailsColumn
            issueId={layout.selectedIssue}
            sheet={detailsAsSheet}
            modal={issueModal}
          />
        )}
      </main>
      {/* Toast surface lives at the app root: <Notifications /> mounted
          in main.tsx, fed via `useToaster()` (Toaster.tsx shim). */}
    </div>
  );
}
