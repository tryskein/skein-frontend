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
import type { WorkspaceWidthMode } from './workspaceResize';
import {
  useLocation,
  useNavigate,
  useNavigationType,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import type { ViewMode } from '../api/issues';
import type { NavLayout } from '../api/uiPrefs';
import {
  reduce as reduceNavFold,
  type NavFoldEffects,
  type NavFoldEvent,
  type NavFoldSection,
  type NavFoldState,
  type NavFoldTemp,
  type SpaceFoldChoice,
} from './navFoldRules';
import {
  NAV_COLUMN_BOUNDS,
  NAV_SPLIT_BOUNDS,
  readNavColumnCollapsed,
  readNavHintSeen,
  readNavSections,
  readNavWidth,
  readNavWorkspace,
  writeNavColumnCollapsed,
  writeNavHintSeen,
  writeNavSections,
  writeNavWidth,
  writeNavWorkspace,
  type NavWorkspaceRecord,
} from './navLayoutStorage';
import {
  carryState,
  isIntentNavigation,
  readInitialLoadIntent,
  readRevealNonce,
  withReveal,
} from './navAddressIntent';
import { useNavLayoutOptionalState } from './useNavLayout';
import { readWidthMode } from './useWidthMode';
import { useQueryClient } from '@tanstack/react-query';
import { isKnownSameProject } from './projectHandleCache';
import { DETAILS_MIN_READABLE_PX } from './widthBudget';
import {
  DEFAULT_TAB,
  FILE_PARAM,
  LENS_PARAM,
  SELECT_PARAM,
  TAB_PARAM,
  normalizeShellSearch,
  parseLens,
  parseSpaceHandle,
  spacePath,
  parseSelect,
  parseTab,
  updateSearch,
  type InboxTab,
  type Lens,
  type ShellSelect,
} from './shellUrlState';

/**
 * Layout state for the new 4-column Shell (F2).
 *
 * - `selectedProject` / `selectedIssue` come from the URL via
 *   `useParams()`. Sources of truth live in the route, not in
 *   localStorage — refresh / share-link / back-button just work.
 * - `inboxTab` and the three lenses come from the URL too, as the
 *   `?tab=` / `?lens=` query parameters (sk-303.13 / T027). The address
 *   WINS: a stored preference can never override a parameter that is
 *   present. The stored value is consulted only as the mount-time
 *   fallback for a dimension the address says nothing about, so a plain
 *   reload of `/` still lands the user on their usual tab while every
 *   explicit address reproduces itself exactly.
 * - `inboxCollapsed` is a user preference persisted to localStorage
 *   write-through — except that an address carrying `?tab=` expands the
 *   column, because a link to a tab must not open it invisible (US-10).
 * - `colWidths` are persisted per column with min/max bounds (Q36).
 *
 * The state is shared across every consumer via React Context — the
 * provider lives once at the top of the Shell tree, and every
 * `useLayoutState()` call reads the same instance. Earlier the hook
 * called `useState` directly; each caller got an independent state
 * cell, so toggling outboxMode in HeaderBar didn't propagate to
 * TasksColumn (and similar bugs for inboxCollapsed + colWidths).
 */

const STORAGE_OUTBOX = 'skein.outbox-mode';
const STORAGE_ONME = 'skein.layout.onmode';
const STORAGE_BUDILNIK = 'skein.layout.budilnik-mode';
const STORAGE_INBOX_COLLAPSED = 'skein.layout.inbox-collapsed';
/**
 * sk-290 — whole-COLUMN collapse for Projects. Namespaced under
 * `skein.layout.col.*` (the column namespace) and deliberately NOT
 * under `project-tree`, which sk-285.1.2 owns for the per-project
 * subtree carets. The two levels are independent and both persist:
 * collapsing the column hides the tree, and the per-project fold
 * state survives underneath and is restored when the column reopens.
 *
 * The key is `…col.projects-collapsed`, not `…col.projects.collapsed`,
 * so it can never be confused with the column WIDTH key
 * (`skein.layout.col.projects`) by a prefix scan.
 */
const STORAGE_PROJECTS_COLLAPSED = 'skein.layout.col.projects-collapsed';
/**
 * Whole-COLUMN collapse for Tasks — the third and last column to get
 * one, so all three now fold by the same idiom. Named by the same rule
 * as its Projects neighbour: `…col.tasks-collapsed`, not
 * `…col.tasks.collapsed`, so a prefix scan can never confuse it with
 * the column WIDTH key (`skein.layout.col.tasks`).
 *
 * Deliberately distinct from `STORAGE_TASK_FILTERS_COLLAPSED` below:
 * that one folds the FILTER PANEL inside the column, this one folds
 * the column itself. Neither reads nor writes the other, so a user who
 * folded the filter panel gets it back folded when the column reopens.
 */
const STORAGE_TASKS_COLLAPSED = 'skein.layout.col.tasks-collapsed';
const STORAGE_INBOX_TAB = 'skein.layout.inbox-tab';
/**
 * sk-551.12 — per-project component-tree fold. Holds the ids of the
 * projects whose subtree is EXPANDED (JSON array of project UUIDs);
 * absence from the set means collapsed, so the default — an empty /
 * missing entry, a project created later — is "every project
 * collapsed". It replaced sk-285.1.2's set of COLLAPSED ids under
 * `STORAGE_PROJECT_TREE_COLLAPSED_LEGACY`, whose default was the
 * opposite: 52 projects opened down to their components.
 *
 * The key deliberately namespaces under `project-tree` and NOT under
 * `skein.layout.col.*`: sk-290 collapses the whole Projects COLUMN and
 * owns its own key in the column namespace. The two levels are
 * independent (column collapsed hides everything; per-project state
 * survives underneath and is restored when the column reopens).
 */
const STORAGE_PROJECT_TREE_EXPANDED = 'skein.layout.project-tree.expanded';
/**
 * sk-674.18 T051 — the fold of the SPACE rows of the Projects column
 * (screens 1.1, K9). Unlike the project tree above it stores no set but
 * the person's explicit choice per space — a JSON object
 * `{ <spaceId>: 'collapsed' | 'expanded' }` — because the default is
 * computed (an empty "Personal" starts folded) and must keep following the
 * data until the person decides (`navFoldRules.ts#isSpaceCollapsed`).
 * Independent of the whole-column fold and of the project tree.
 */
const STORAGE_SPACE_TREE_FOLD = 'skein.layout.space-tree.fold';
/**
 * sk-551.12 — the retired set of COLLAPSED ids (sk-285.1.2). It is not
 * migrated: the inverse of "folded by hand" is not "opened by hand",
 * and the owner asked for everything to start folded. Removed on mount.
 */
const STORAGE_PROJECT_TREE_COLLAPSED_LEGACY = 'skein.layout.project-tree.collapsed';
/**
 * sk-285.1.13 — collapse state of the Tasks-column FILTER PANEL (the
 * chip rows: assignee / status / priority / type / source / dep-types
 * and the view+sort tools row). Same write-through-localStorage recipe
 * as `projectsCollapsed` (sk-290), but with the opposite default: the panel starts
 * COLLAPSED for a user who has never touched it, because six control
 * rows above the first task push the actual content off short /
 * narrow screens. A user who expands it keeps it expanded across
 * sessions — the persisted value always wins over the default.
 *
 * The key sits outside the `skein.layout.col.*` namespace on purpose:
 * this is an in-column panel, NOT a column-level collapse, and the
 * prefix scan for column state must not pick it up.
 */
const STORAGE_TASK_FILTERS_COLLAPSED = 'skein.layout.task-filters-collapsed';
/**
 * Stage 2 — bookkeeping for the "the view takes the workspace" behaviour.
 *
 * Switching the Tasks column into a WORKSPACE VIEW — the Kanban board
 * (Stage 2) or the tree table (sk-285.2.23) — folds the two NAVIGATION
 * columns (Queues, Projects) so that view gets their width back, and
 * switching away unfolds exactly what the fold took. Two facts have to
 * survive a reload for that to be honest, and neither is derivable from
 * the collapse flags themselves:
 *
 *   `auto`   — which columns are collapsed BECAUSE the workspace view
 *              folded them. Only these are re-opened on the way out, so
 *              a column the user had already folded by hand stays folded
 *              (requirement 3).
 *   `optOut` — which columns the user re-opened BY HAND while a
 *              workspace view was on screen. The automation never
 *              touches those again until the user folds that column by
 *              hand inside one, which reads as "I agree again" and
 *              re-arms it (requirement 2).
 *
 * ONE record for both views, deliberately: a user who re-opened Projects
 * on the board is saying "leave that column alone", not "leave it alone
 * on boards". Switching board ↔ tree is therefore not a transition at
 * all (see `Shell.tsx`) — the columns hold still and nothing is folded
 * or unfolded twice.
 *
 * Stored as one JSON object rather than four booleans so the pair can
 * never be read half-updated. Nothing renders from it (it drives
 * imperative transitions only), so it lives in a ref with a synchronous
 * write-through — no state cell, no re-render.
 *
 * The KEY still says `kanban-workspace`: it is the one the board has
 * been writing since Stage 2, and it holds the user's opt-outs. Renaming
 * it would silently re-arm the automation on every column a user had
 * already told it to leave alone, which is the exact behaviour this
 * record exists to prevent.
 */
const STORAGE_WORKSPACE_VIEW = 'skein.layout.kanban-workspace';
/**
 * sk-551.8 — the side-by-side auto-fold hint flag. The same key as
 * `Shell.tsx#STORAGE_BOARD_HINT_SEEN`: the fold rules decide the hint of
 * exception 2 (a switch to side-by-side on a board) «by the same flag as
 * today», so the router reads and sets exactly that flag.
 */
const STORAGE_BOARD_HINT_SEEN = 'skein.layout.board-workspace-hint-seen';
const STORAGE_COL = {
  inbox: 'skein.layout.col.inbox',
  projects: 'skein.layout.col.projects',
  tasks: 'skein.layout.col.tasks',
} as const;

/**
 * sk-551.29 — width of the task panel next to the workspace (tree, board);
 * absence = the default width.
 *
 * sk-551.30 — the tablet layout has ITS OWN key: R10 — the tablet neither reads nor writes the
 * remembered desktop widths. A desktop 600 in a
 * 900 window would leave the view below its floor, and dragging in the tablet must not
 * change what a person will see on returning to a wide window.
 */
const STORAGE_WORKSPACE_DETAILS_WIDTH: Readonly<Record<WorkspaceWidthMode, string>> = {
  desktop: 'skein.layout.col.workspace-details',
  tablet: 'skein.layout.col.workspace-details-tablet',
};
/**
 * sk-551.29 — key of the VIEW width from sk-551.14. Not read: the view width and
 * the panel width are different quantities, and one can be converted to the other
 * only in the window where it was set. It is only erased on the first
 * mount of the provider — like the sk-514 ceiling below.
 */
const STORAGE_WORKSPACE_VIEW_WIDTH_LEGACY = 'skein.layout.col.workspace';
/**
 * sk-551.14 — key of the width CEILING from sk-514. Not read: the ceiling and the
 * width are different quantities, and carrying one over to the other would
 * pass an old number off as a choice the user never made.
 * It is only erased on the first mount of the provider.
 */
const STORAGE_WORKSPACE_MAX_LEGACY = 'skein.layout.col.workspaceMax';

/**
 * Drag bounds and untouched widths for the three FIXED zones of the
 * workspace. Details is the elastic one and has no entry: it is
 * whatever the row has left, which is why every pixel past the floor
 * goes to it.
 *
 * The defaults are also a TERM OF THE FLOOR. `--app-min-width` is the
 * sum `2·lens-frame + Σ default + 3·width-resize + 234` (see
 * `lib/widthBudget.ts`), so moving a number here moves the width below
 * which the app leaves the desktop layout for the tablet one —
 * `widthBudget.test.ts` fails the build if the two stop agreeing. (It
 * used to say "starts panning", which was the model before sk-285.7
 * T016/T020: the narrow modes reflow now and are explicitly kept from
 * panning. The floor still moves with these numbers either way; only
 * what sits below it changed.)
 *
 * sk-285.7 T009 — Queues 240 → 264 and Projects 280 → 300, the widths
 * handoff §1 gives for the 1440 layout («Queues 264 · Projects 300 ·
 * Tasks flex · Details 440»). The new spacing scale is what makes them
 * necessary rather than decorative: at 4px-and-up steps the old
 * columns no longer hold their content. Tasks stays 468 — §1 draws it
 * as `flex` and gives no number, and inventing one would move the
 * floor on a guess.
 *
 * The FIXED/ELASTIC split is the code's, not the drawing's, and that
 * is deliberate: §1 makes Tasks the elastic zone, this map keeps
 * Details elastic. Swapping them would change which handle grows when
 * the window does — a change to the drag mechanics, which the redesign
 * spec did not ask for.
 *
 * ── sk-285.7.16 — DECIDED: the split stays inverted, as a deviation ──
 *
 * The paragraph above states the inversion; this one records that it was
 * examined against §1 and kept, so the next reader does not have to
 * re-open the question from scratch.
 *
 * WHAT IT COSTS, measured in Chromium on the running app:
 *
 *   window   §1 / §5 draws   the app renders
 *   1440         440              402      (audit L1 — narrower)
 *   1024         400            480.5      (audit L4 — wider)
 *
 * One defect with two signs, and that is the signature of the model
 * rather than of a wrong constant: with Details taking the REMAINDER, a
 * wide window leaves it less than the drawing and a narrow one leaves it
 * more. No value in this map can fix both.
 *
 * WHY IT WAS NOT INVERTED HERE. The inversion is not a change to this
 * map. `--app-min-width` is computed as 6 + (264 + 300 + 468) + 12 + 234
 * in `lib/widthBudget.ts`, where the 234 is «the minimum Details may
 * be»; make Details the fixed basis and that term stops being a minimum
 * while Tasks acquires one, so the floor is recomputed from a different
 * shape. `widthBudget.ts` was outside this pass, and it is not
 * incidental to the change — it IS the change. Everything downstream
 * moves with it: `COL_BOUNDS` needs a `details` entry and `tasks` loses
 * the point of a fixed width, the three drag handles are the wrong three
 * (a handle on the elastic column means nothing, and Details needs one),
 * and `TABLE_AREA_PX` in `TreeTableLayout.test.tsx` is derived from the
 * floor, so the tree's column budget is recomputed too (sk-285.7.14).
 *
 * WHY THE CHEAP VERSION IS NOT A VERSION. Setting `tasks.default` 468 →
 * 418 so that 1440 leaves Details 440 does not work and does not even
 * fail honestly: `widthBudget.test.ts` recomputes the floor to 1234,
 * which drops `TABLE_AREA_PX` to 704 against a default tree set that
 * needs more than that — a red guard, in a file this change has no
 * business touching. And it would buy nothing anyway: Details would
 * still be the remainder, so it would still be wrong at every width
 * except the one that was tuned.
 *
 * §1 and §5 are therefore marked as diverging from the implementation in
 * the handoff's "Amendments to the package", and the inversion stays available
 * as a whole piece of work rather than half-done here. */
export const COL_BOUNDS = {
  inbox: { min: 200, max: 480, default: 264 },
  projects: { min: 200, max: 400, default: 300 },
  tasks: { min: 280, max: 600, default: 468 },
} as const;

export type ColKey = keyof typeof COL_BOUNDS;

/**
 * sk-551.43 — upper bound of the tasks column width in STORAGE, separately from
 * `COL_BOUNDS.tasks.max`.
 *
 * The tasks column handle in "Cards" no longer stops at 600: its upper bound is
 * computed live — the column plus the panel minus the panel floor
 * (`lib/workspaceResize.ts#tasksDragBounds`), otherwise the task card
 * could not be narrowed to 420, as next to the tree and the board. In a wide window
 * this bound is above 600, and writing it there is legal. `COL_BOUNDS.tasks.max`
 * remains the drag upper bound while the panel is not measured, and the input field of
 * `widthBudget` (which reads only `default`) — the app floor is not
 * shifted.
 *
 * Here — only protection from garbage, like {@link WORKSPACE_DETAILS_BOUNDS}.
 * A column too wide for the window is squeezed by the row: in "Cards" it yields
 * first, the panel keeps its floor (`index.css`, the rule
 * `.shell-columns .details-frame .col-details`).
 */
export const COL_STORAGE_MAX: Readonly<Record<ColKey, number>> = {
  inbox: COL_BOUNDS.inbox.max,
  projects: COL_BOUNDS.projects.max,
  tasks: 3840,
};

/**
 * sk-551.29 — width of the TASK PANEL next to the workspace (tree, board).
 *
 * History: sk-514 moved the view ceiling, sk-551.14 — the view width ("as in
 * "Cards": the tasks column is fixed, the panel is the remainder"). The owner
 * looked at the stand (2026-10-03): in a wide window the task card
 * grows while the board stands still. Decision: "in a wide window the task card
 * must not grow — the extra width goes to the board/tree". So now
 * the panel width is remembered, and the view (`flex: 1 1 0%`, `TasksColumn`)
 * takes the remainder. The handle is the same, the drag goes from the first pixel
 * (`lib/workspaceResize.ts#detailsDragBounds`).
 *
 * `null` — the user did not drag: the width comes from `index.css` (the rule
 * `.col-details` next to `.col-tasks-fill`). One width for both views.
 *
 * ─── Where the bounds come from ────────────────────────────────────
 *
 * Here — only protection of the storage from garbage. The real limits are computed
 * LIVE at the start of each drag: the lower one — the panel floor `--col-details-board`,
 * the upper one — panel plus view minus the view floor. A number that is right at one window
 * width cannot be here.
 *
 * The range [`DETAILS_MIN_READABLE_PX` (234, `lib/widthBudget.ts`) …
 * 3840] — the garbage bound for reading and writing, not a width that
 * the layout promises: on desktop CSS keeps the panel no narrower than
 * `--col-details-board`, in the tablet the row may squeeze it below the stored value
 * (grok ts review). Raising the lower bound to 420 is not allowed: in the tablet the drag legally
 * writes a width narrower than 420 (`lib/workspaceResize.ts#detailsDragBounds`).
 *
 * ⚠ NOT a `COL_BOUNDS` key: `widthBudget.appFloorBreakdown` sums all
 * its keys, and the app floor would shift.
 */
export const WORKSPACE_DETAILS_BOUNDS = { min: DETAILS_MIN_READABLE_PX, max: 3840 } as const;

/** @see workspaceResize.ts#WorkspaceWidthMode */
export type { WorkspaceWidthMode };

/**
 * The columns a workspace view (Kanban board, tree table) is allowed to
 * fold for itself.
 *
 * Queues and Projects only — both are NAVIGATION surfaces: they pick
 * what the Tasks column should show, and once the board or the tree is
 * on screen the user is working inside it, not re-picking. Details is
 * deliberately NOT in the list: opening a card is the main verb of both
 * views, and folding the surface that card lands in would make them
 * unusable. Tasks is the view itself.
 */
export const WORKSPACE_FOLDED_COLS = ['inbox', 'projects'] as const;
export type WorkspaceFoldedCol = (typeof WORKSPACE_FOLDED_COLS)[number];

/** @see STORAGE_WORKSPACE_VIEW */
interface WorkspaceRecord {
  auto: Record<WorkspaceFoldedCol, boolean>;
  optOut: Record<WorkspaceFoldedCol, boolean>;
}

const EMPTY_WORKSPACE_RECORD: WorkspaceRecord = {
  auto: { inbox: false, projects: false },
  optOut: { inbox: false, projects: false },
};

export interface ColWidths {
  inbox: number;
  projects: number;
  tasks: number;
}

export interface LayoutState {
  selectedProject: string | null;
  /**
   * sk-674.18 T052 — the id of the space that is the selected PLACE
   * (`/spaces/<id>-<slug>[/issues/:id]`, screens 1.7, 1.16), or null.
   * Only the id: the slug never identifies a space
   * (`shellUrlState.ts#parseSpaceHandle`). Never set together with
   * `selectedProject` — the two places are siblings, like a project and
   * «All projects».
   */
  selectedSpace: string | null;
  /**
   * The `:space` segment as the address carries it (`<id>-<slug>`), for
   * navigating inside the place without rewriting the slug; null when no
   * space is selected.
   */
  selectedSpaceHandle: string | null;
  selectedIssue: string | null;
  /**
   * Component UUID picked from the URL when the path matches
   * `/projects/:alias/components/:cid[/issues/:id]`. null when no
   * component is in the URL. The Tasks column reads this and filters
   * via `componentId={cid}` on the issues list endpoint.
   */
  selectedComponent: string | null;
  outboxMode: boolean;
  /**
   * "On me" lens (sk-30). Mutually exclusive with `outboxMode` — when one
   * is turned on the other auto-flips off. When ON, every shell surface
   * narrows to "issues assigned to the caller by someone else that the
   * caller has already accepted and is actively working":
   *   assignee = me AND created_by != me AND accepted_at IS NOT NULL.
   * When both are OFF, the shell shows the unfiltered All-tasks view.
   */
  onMeMode: boolean;
  /**
   * sk-62.2 — Reminders lens. The THIRD lens, mutually
   * exclusive with `onMeMode` and `outboxMode` (turning any one ON
   * auto-flips the other two OFF). When ON the shell auto-scopes to All
   * projects and the Tasks column shows a flat, most-urgent-first list
   * of issues that have reminders (ringing on top, armed below) instead
   * of the normal board. Shares the same URL snapshot/restore cycle as
   * the other two lenses, so entering/leaving budilnik mode preserves
   * exactly where the user was.
   */
  budilnikMode: boolean;
  /**
   * sk-303.14 (T024) — the unreviewed selection is applied to the
   * Delegated surface: `?lens=delegated&select=unreviewed`.
   *
   * A DERIVATION of the address, read during render — that is the whole
   * point. The Tasks column builds its list request in the same render
   * that reads this, so the first request after the jump already carries
   * the selection. Seeding it afterwards (an effect) would let a first
   * request go out with the previous filters and turn the normalisation
   * into a SECOND request — the exact defect SC-017 forbids.
   *
   * Gated on the lens by construction: the selection narrows the
   * Delegated surface and means nothing anywhere else, so a stale
   * `?select=` next to another lens (or no lens) reads as `false` rather
   * than silently narrowing a surface it does not belong to.
   */
  unreviewedSelected: boolean;
  inboxCollapsed: boolean;
  /**
   * Which tab is active in the left sidebar column. `'inbox'` shows
   * issues assigned to the caller that haven't been accepted yet (the
   * F3 incoming-from-others queue). `'mentions'` (sk-38) shows unread
   * comment.mention / issue.mention notifications addressed to the
   * caller. `'watching'` (sk-39) shows the caller's subscriptions.
   *
   * There is no `'outbox'` tab: US-9 removed that surface. A stored
   * value naming it is unknown to `parseTab`, so `readStoredTab` below
   * lands on Inbox rather than on an empty screen.
   *
   * sk-303.13 (T027) — the ADDRESS owns this: it is read from `?tab=`
   * whenever that parameter carries a value the app knows. The
   * localStorage copy survives as the mount-time fallback for an
   * address that says nothing about the tab, so a bare `/` still opens
   * on the user's usual queue.
   */
  inboxTab: InboxTab;
  /**
   * sk-285.7 T019/T024 — which of the three navigation zones the shell
   * is SHOWING. Written at every width (it is a property of the shell,
   * not of the phone) and simply unused above the mobile threshold,
   * where all four zones are on screen at once.
   *
   * It lives here rather than in `Shell`'s own `useState`, where T019
   * put it, because T024 gave the compact header a second way in: the
   * phone's aggregate «Queues» button. `HeaderBar` is mounted by three
   * different roots (`Shell`, `AppChrome`, `SettingsLayout`) and gets no
   * props from any of them, so a zone selector held inside `Shell` was
   * unreachable from the header — and a header button that expands a
   * column the phone is not showing is a dead control, which is exactly
   * the failure sk-285.6.17 fixed for the view switcher.
   *
   * NOT persisted, deliberately: unlike `inboxTab` (a preference) this
   * is where the user currently IS, and restoring "Projects" into a
   * fresh tab days later would be answering a question nobody asked.
   */
  activeZone: 'queues' | 'projects' | 'tasks';
  /**
   * sk-551.12 — ids of the projects whose component subtree is
   * EXPANDED in the Projects column. Membership is the expanded signal,
   * so the empty set (the default, and what a missing localStorage
   * entry produces) means "every project is collapsed", and a project
   * that appears later arrives collapsed. Keyed by project UUID
   * (`ProjectListItem.id`), which is immutable, rather than by idPrefix.
   *
   * Persisted to localStorage write-through, so the shape of the tree
   * the user left behind is the shape they come back to.
   */
  expandedProjectIds: ReadonlySet<string>;
  /**
   * sk-674.18 T051 — the explicit fold choice per space row of the
   * Projects column, keyed by space id; a space without an entry follows
   * the computed default (`navFoldRules.ts#isSpaceCollapsed`). Persisted
   * to localStorage write-through.
   */
  spaceFoldChoices: Readonly<Record<string, SpaceFoldChoice>>;
  /**
   * sk-290 — true when the ENTIRE Projects column is folded into its
   * 44px sliver. This is the outer of the two independent collapse
   * levels; the inner one is `expandedProjectIds` (per-project
   * subtrees). The column is never unmounted — it renders as a
   * vertical sliver button, so the expand affordance stays on screen
   * and keeps its place in the tab order.
   *
   * Persisted to localStorage write-through; defaults to expanded.
   */
  projectsCollapsed: boolean;
  /**
   * True when the ENTIRE Tasks column is folded into its 44px sliver —
   * the same whole-column fold `projectsCollapsed` (sk-290) and
   * `inboxCollapsed` (Q32) describe for their columns, so the three
   * behave identically. The column is never unmounted: it renders as a
   * vertical sliver button, so the expand affordance keeps its place on
   * screen and in the tab order.
   *
   * Independent of `taskFiltersCollapsed` (the in-column filter panel)
   * and of the per-node tree folds — folding the column touches
   * neither, so reopening restores exactly the shape the user left.
   *
   * Persisted to localStorage write-through; defaults to expanded.
   */
  tasksCollapsed: boolean;
  /**
   * sk-285.1.13 — true when the Tasks-column filter panel is folded to
   * its compact bar (search box + expand button + active-filter
   * counter). Defaults to TRUE for a fresh user; the user's own choice
   * is persisted to localStorage write-through and wins on every later
   * session.
   *
   * Collapsing hides the CHIP ROWS only — the search box, the
   * search-scope toggles and the degraded-search hint stay on screen,
   * and the counter keeps the fact that a filter is narrowing the list
   * visible.
   */
  taskFiltersCollapsed: boolean;
  colWidths: ColWidths;
  /**
   * sk-551.29 — width of the task panel next to the tree / board, px, per
   * layout (sk-551.30: the tablet has its own). `null` — the user did not
   * drag: the default width from `index.css`.
   */
  workspaceDetailsWidth: Readonly<Record<WorkspaceWidthMode, number | null>>;
  /**
   * sk-41 — current attachment id from the URL's `?file=` query
   * parameter, or null when no viewer is open. The DetailsColumn reads
   * this to mount `FileViewerPanel`.
   */
  selectedAttachment: string | null;
  /**
   * sk-41 — true when the viewer was opened from inside an already-
   * mounted card (user clicked an attachment row). False (or absent)
   * means the URL was loaded from a shared link / fresh navigation, in
   * which case Shell renders the split layout (card + viewer) and
   * activates inbox-overlay mode.
   *
   * Sourced from `location.state.selfOpenedFile`, set by
   * `openAttachment(...)`. Survives only the navigation that planted
   * it — any subsequent navigate() without re-tagging clears it. Since
   * sk-405 retired `fromInbox` it is the only nav-state key the shell
   * writes.
   */
  selfOpenedFile: boolean;
  /**
   * sk-551.8 — the left-panel layout ACTIVE for this provider: the
   * person's profile value (`useNavLayoutOptional`), `columns` without
   * auth/query providers. Read once here so the shell, the columns and
   * the fold router agree on one value per render.
   */
  navLayout: NavLayout;
  /**
   * sk-551.8 — the sections column's stored width per width mode
   * (`navLayoutStorage`, INV-4). The tablet's live limit is applied on
   * screen by the drawer (`navResize.ts#navColumnWidthOnScreen`), never
   * written back here.
   */
  navWidth: Readonly<Record<WorkspaceWidthMode, number>>;
  /** sk-551.8 — Projects' share of the two section bodies, 0…1. */
  navSplit: number;
  /** sk-551.8 — stored folding of the two sections. */
  navSectionsCollapsed: Readonly<Record<NavFoldSection, boolean>>;
  /** sk-551.8 — the whole sections column folded into its sliver (stored). */
  navColumnCollapsed: boolean;
  /**
   * sk-551.8 — the temporary picture while a shared file is open
   * (layer 1, `navFoldRules`); `null` otherwise. Drawn instead of the
   * stored folding, never written.
   */
  navTemp: NavFoldTemp | null;
}

/**
 * sk-551.8 — a gesture of the person on the sections column or on a
 * queue badge, routed by `reportNavGesture` (plan P11).
 */
export type NavGesture = Extract<
  NavFoldEvent,
  { type: 'gestureExpand' } | { type: 'gestureCollapseColumn' } | { type: 'chevron' }
>;

/** sk-551.8 — where a layout change came from (plan P13). */
export type NavModeSource = 'gesture' | 'profile';

/**
 * sk-551.11 — how an EXPLICIT pick in the Projects column moves the shell.
 * Only that column's click handlers pass it; every other caller (a task
 * row, a queue card, the URL) leaves it out and keeps the lens.
 */
export interface ProjectsPickOptions {
  /**
   * End the Reminders lens in the same navigation. The lens replaces the
   * Tasks column with the ringing list, so a project picked under it
   * would change nothing the user can see. One navigation, not
   * `setBudilnikMode(false)` followed by the pick: turning the lens off
   * restores its snapshot (a history entry of its own), and the pick
   * would carry the stale `?lens=` along. The snapshot is dropped — the
   * user has chosen where to go. On me / Delegated are untouched: they
   * narrow the picked project's list rather than replace it.
   */
  endBudilnik?: boolean;
}

export interface LayoutActions {
  setOutboxMode: (v: boolean) => void;
  toggleOutboxMode: () => void;
  /**
   * sk-30 — "On me" lens setter. Turning it on auto-turns-off
   * `outboxMode` (mutex invariant), and vice versa. The two toggles
   * never coexist as ON.
   */
  setOnMeMode: (v: boolean) => void;
  toggleOnMeMode: () => void;
  /**
   * sk-62.2 — Reminders lens setter. Turning it ON auto-turns-off
   * both `onMeMode` and `outboxMode` (the three-way mutex), and being
   * turned off by either of those in turn. Shares the snapshot/restore
   * cycle: ON while all three were OFF captures the URL snapshot and
   * navigates to the cross-project view; OFF while the other two are
   * OFF restores the snapshot — unless a task is open (sk-551.25): then
   * OFF only drops `?lens=` and the task stays open.
   *
   * sk-551.9 — ON also unfolds a folded Tasks column: the lens IS the
   * list of ringing reminders, and a folded column shows only its
   * count. OFF leaves the fold alone — the user was just working with
   * that list. On me / Delegated do not unfold (see `setBudilnikMode`).
   */
  setBudilnikMode: (v: boolean) => void;
  toggleBudilnikMode: () => void;
  /**
   * sk-303.14 (T024) — turn the unreviewed selection on or off.
   *
   * ON is the "jump to the unreviewed set in one action" channel (US-2 /
   * SC-017): it lands on the Delegated lens over ALL visible projects
   * (`/`), with the project and issue selection dropped and `?file=` with
   * them, and stamps `?select=unreviewed`. It works from anywhere — no
   * lens, another lens, or the Delegated lens already open on a single
   * project — because every one of those has to end on the same surface.
   *
   * OFF drops the parameter and leaves the user where they are: the
   * selection is a narrowing of the current surface, not a place.
   */
  setUnreviewedSelected: (v: boolean) => void;
  setInboxCollapsed: (v: boolean) => void;
  toggleInboxCollapsed: () => void;
  /**
   * Switch the left sidebar's tab. Writes `?tab=` on the CURRENT path
   * (a real history entry, so Back returns to the previous tab) and
   * keeps every other parameter — `?file=` included. Also persisted to
   * localStorage as the next mount's fallback.
   */
  setInboxTab: (tab: InboxTab) => void;
  /**
   * Show one of the three navigation zones. The phone's tab strip and
   * the compact header's «Queues» button are its two callers; above the
   * mobile threshold the value is written and ignored. Not persisted —
   * see `activeZone`.
   */
  setActiveZone: (zone: 'queues' | 'projects' | 'tasks') => void;
  /**
   * sk-285.1.2 — flip one project's component subtree between expanded
   * and collapsed. Idempotent per call (toggle), persisted immediately.
   * `projectId` is the project UUID.
   */
  toggleProjectCollapsed: (projectId: string) => void;
  /**
   * sk-551.12 — expand one project's component subtree; a no-op when it
   * is already expanded. Persisted like the toggle. The Projects column
   * calls it for the project the address selects.
   */
  expandProject: (projectId: string) => void;
  /**
   * sk-674.18 T051 — record the person's explicit choice for one space
   * row: `true` folded, `false` open. Only the space caret calls it; the
   * search-time opening of a folded space is never written.
   */
  setSpaceCollapsed: (spaceId: string, collapsed: boolean) => void;
  /**
   * sk-290 — fold / unfold the whole Projects column. Independent of
   * `toggleProjectCollapsed`: neither one touches the other's state,
   * so re-expanding the column restores exactly the per-project shape
   * the user left behind.
   */
  setProjectsCollapsed: (v: boolean) => void;
  toggleProjectsCollapsed: () => void;
  /**
   * Fold / unfold the whole Tasks column. Independent of
   * `setTaskFiltersCollapsed` (the in-column filter panel) and of the
   * per-node tree folds — neither is touched, so re-expanding the
   * column restores exactly the shape the user left behind.
   */
  setTasksCollapsed: (v: boolean) => void;
  toggleTasksCollapsed: () => void;
  /**
   * sk-285.1.13 — fold / unfold the Tasks-column filter panel. Purely a
   * presentation preference: it never touches the filter VALUES, so a
   * collapse cannot silently widen or narrow the list.
   */
  setTaskFiltersCollapsed: (v: boolean) => void;
  toggleTaskFiltersCollapsed: () => void;
  setColWidth: (col: ColKey, w: number) => void;
  /**
   * sk-551.29 — remember the task panel width next to the tree / board
   * for layout `mode` (sk-551.30); the other layout is not touched.
   */
  setWorkspaceDetailsWidth: (mode: WorkspaceWidthMode, w: number) => void;
  /**
   * Stage 2 — the Tasks column just switched INTO a workspace view
   * (Kanban board or tree table). Folds every
   * column in {@link WORKSPACE_FOLDED_COLS} that is currently open and that
   * the user has not opted out of, and remembers which ones it folded so
   * {@link leaveWorkspaceView} can put back exactly that much.
   *
   * Returns the columns it actually folded (empty when everything was
   * already folded or opted out) so the caller can explain the fold the
   * first time it happens and stay silent otherwise.
   *
   * Call ONLY on a real Cards → workspace-view transition. Calling it on
   * mount would re-fold a column the user re-opened by hand before
   * reloading, which is precisely the behaviour this design forbids —
   * use {@link syncWorkspaceView} there.
   */
  enterWorkspaceView: () => WorkspaceFoldedCol[];
  /**
   * Stage 2 — the Tasks column just switched OUT of every workspace view
   * (i.e. into Cards). Re-opens the
   * columns that `enterWorkspaceView` folded and NOTHING else: a
   * column the user had folded before entering the view, or folded by
   * hand while inside it, stays folded.
   */
  leaveWorkspaceView: () => void;
  /**
   * Stage 2 — tell the layout whether a workspace view is on screen
   * WITHOUT folding or unfolding anything. Used on mount (a reload inside
   * the board or the tree must leave the columns exactly as the user left
   * them) so that
   * later manual collapses/expands are still attributed correctly.
   */
  syncWorkspaceView: (active: boolean) => void;
  /**
   * sk-551.8 (P2) — tell the side-by-side bookkeeping whether a workspace
   * view is on screen WITHOUT writing anything: with the sections layout
   * active only the fold rules change the side-by-side record (the two
   * exceptions), and `syncWorkspaceView(false)` would drop marks a
   * deferred return still needs (US-11).
   */
  noteWorkspaceView: (active: boolean) => void;
  /**
   * Navigate to the URL that selects the given project handle (alias /
   * idPrefix / UUID — backend resolves all three). Pass `null` to clear
   * selection (URL becomes `/`). `opts` — see `ProjectsPickOptions`.
   */
  setSelectedProject: (handle: string | null, opts?: ProjectsPickOptions) => void;
  /**
   * sk-674.18 T051 — navigate to the place «space»: `/spaces/{handle}`,
   * where `handle` is `<id>-<slug>` (screens 1.1, 1.16). The same pick as
   * `setSelectedProject` — `opts` ends Reminders the same way.
   */
  setSelectedSpace: (handle: string, opts?: ProjectsPickOptions) => void;
  /**
   * Navigate to the standard 4-column route
   * `/projects/{handle}/issues/{id}`. The signature requires both
   * arguments — the bare `/issues/:id` URL shape was retired in P1
   * (only `selectInboxIssue` could produce it, and it did so through a
   * nav-state flag rather than through the URL; sk-405 removed the flag
   * too). If a caller can't supply a
   * project handle that's a bug at the call site; resolve via
   * `useProjectsList` (item.projectId → idPrefix) and pass it.
   *
   * To deselect the issue while keeping the current project context,
   * call `clearSelectedIssue` instead.
   *
   * Component segment (sk-439). On a component-filtered route the
   * current component rides along ONLY when the target is known to be
   * in the CURRENT project: a component belongs to one project, and
   * `/projects/B/components/<A's component>/…` filters B by something B
   * does not have. "Known" is decided by `projectHandleCache.ts#isKnownSameProject`
   * — the handle may be a UUID while the address carries the alias, so
   * the strings alone cannot tell. When the cache cannot say (projects
   * list not loaded, project never resolved) the component is DROPPED:
   * a foreign component in the address is a defect, a missing filter is
   * not. The query string is carried either way, as before; the «All
   * projects» view (`/issues/<id>`) is unchanged.
   */
  setSelectedIssue: (id: string, projectHandle: string) => void;
  /**
   * Drop the current issue selection. If a project is selected, the
   * URL becomes `/projects/{alias}`; otherwise `/`. Pure deselect —
   * use `setSelectedProject(null)` to also drop the project.
   */
  clearSelectedIssue: () => void;
  /**
   * Navigate to a component-scoped tasks view. Passing a non-null
   * component UUID drives the URL to
   * `/projects/{projectHandle}/components/{cid}`; passing null drops
   * the `/components/{cid}` segment and lands back on
   * `/projects/{projectHandle}`. Re-selecting the same component is
   * idempotent (no re-render needed); the column reads the URL via
   * params, not via this action's return value. `opts` — see
   * `ProjectsPickOptions`.
   */
  setSelectedComponent: (
    cid: string | null,
    projectHandle: string,
    opts?: ProjectsPickOptions,
  ) => void;
  /**
   * Navigate to an issue from the Queues column.
   *
   * sk-405 — the same target URL as `setSelectedIssue(id,
   * projectHandle)`, and since that task the same navigation in every
   * other respect too. It used to tag `location.state.fromInbox = true`
   * so Shell rendered in overlay mode (Projects + Tasks unmounted,
   * Details filling the right pane); the owner asked for the zones to
   * stay, so the tag is gone. The action survives under its own name
   * because the CALLER is still worth naming — the queue resolves the
   * project handle from its own row, which `setSelectedIssue` cannot do
   * for it.
   *
   * `projectHandle` MUST be a non-null project handle. Earlier the
   * function fell back to a bare `/issues/:id` URL when the handle
   * couldn't be resolved (e.g. projects list still loading). The
   * legacy `/issues/:id` route was retired in P1 — that fallback
   * bounced the user to the home shell via the catch-all redirect.
   * The InboxColumn is responsible for gating clicks until the
   * handle resolves.
   */
  selectInboxIssue: (id: string, projectHandle: string) => void;
  /**
   * sk-41 — open an attachment in the in-card viewer. Mutates the URL's
   * `?file=` query parameter only; the path stays put so the parent
   * card remains addressable. `location.state.selfOpenedFile` is set to
   * `true` (and any pre-existing state is preserved — nothing else
   * writes nav state today, so that half is defensive) so Shell.tsx
   * renders single-pane (viewer replaces the
   * card) instead of the split shared-link layout.
   *
   * Triggered from AttachmentList row clicks; the row decides whether
   * to call this (viewable extension) or fall back to the download
   * flow.
   */
  openAttachment: (attachmentId: string) => void;
  /**
   * sk-41 — close the viewer. Strips `?file=` from the URL while
   * keeping every other piece of `location.state` intact, so any
   * context a future feature plants there survives the round trip.
   * Idempotent — calling on a URL without `?file=` is a no-op.
   */
  closeAttachment: () => void;
  /** sk-551.8 — store the sections column's width for this width mode (rounded, 200…480). */
  setNavWidth: (mode: WorkspaceWidthMode, w: number) => void;
  /**
   * sk-551.8 — store the split (0…1). Nothing is written while a shared
   * file is open (layer 1 writes no split).
   */
  setNavSplit: (split: number) => void;
  /** sk-551.8 — equal bodies (0.5); the handle's double click. Same layer-1 rule. */
  resetNavSplit: () => void;
  /**
   * sk-551.8 — a section's chevron: the `chevron` gesture through the
   * fold rules. Returns the effects (focus) for the caller to apply.
   */
  toggleNavSection: (section: NavFoldSection) => NavFoldEffects;
  /**
   * sk-551.8 — "Collapse column" (`true`) or a click on the sliver
   * (`false`): the gesture through the fold rules, with the view last
   * given to {@link LayoutActions.syncNavView}. Returns the effects.
   */
  setNavCollapsed: (collapsed: boolean) => NavFoldEffects;
  /**
   * sk-551.8 — tell the fold router which task view is on screen. The
   * view lives in `TasksUiStateProvider`, nested INSIDE this provider, so
   * the shell reports it: once on mount and on every change. Gestures
   * depend on it (an opt-out is written only on a board or tree, US-7);
   * without it a reload on the board would treat a gesture as one on
   * cards. Writes nothing.
   */
  syncNavView: (view: ViewMode) => void;
  /**
   * sk-551.8 (P11) — the active queue FELL to zero by its authoritative
   * count (Q32). The caller decides that it is a fall — not a tab switch,
   * not a Watching filter change, not a loading or failed query.
   * Side-by-side active: the column folds exactly as before
   * (`setInboxCollapsed(true)`). Sections active: the fold rules (only
   * the Queues section folds; nothing on a phone or during a file).
   */
  reportQueueFell: () => void;
  /** sk-551.8 (P11) — the active queue rose again: changes nothing, by rule. */
  reportQueueRose: () => void;
  /**
   * sk-551.8 (P11) — a gesture of the person, in the view last given to
   * {@link LayoutActions.syncNavView}. Sections active: the fold rules
   * (the opt-out depends on the view); returns their effects (focus,
   * hint) for the caller to apply. Side-by-side active: a badge unfolds
   * the Queues column as before; the other gestures belong to the
   * sections column only and do nothing; the effects are empty.
   */
  reportNavGesture: (gesture: NavGesture) => NavFoldEffects;
  /**
   * sk-551.8 (P1, P11) — the single door into `navFoldRules.reduce`. The
   * result is written (only what changed: the sections keys `nav.*`, and
   * — for the two side-by-side exceptions — the side-by-side columns
   * through the automation primitives, never as a user fold), the
   * temporary picture is kept in state and the deferred return in a ref
   * that dies with this provider. Returns the effects (hint, focus) for
   * the caller to apply. `view` is the task view at the moment of the
   * event (it also becomes the router's current view; after a
   * `viewChanged` the current view is its `to`).
   */
  dispatchNavEvent: (event: NavFoldEvent, view: ViewMode) => NavFoldEffects;
  /**
   * sk-551.8 (P13) — the switch in Appearance records that the person is
   * choosing `to`, synchronously, before the profile write starts.
   */
  noteNavModeGesture: (to: NavLayout) => void;
  /**
   * sk-551.8 (P13) — the shell observed the layout change to `value`:
   * `gesture` if this provider's cell holds exactly `value`, `profile`
   * otherwise (a late GET, the answer to another field's PUT, a
   * rollback). The cell is emptied on every call.
   */
  takeNavModeSource: (value: NavLayout) => NavModeSource;
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function readBool(key: string, fallback = false): boolean {
  try {
    const v = window.localStorage.getItem(key);
    if (v === 'true') return true;
    if (v === 'false') return false;
  } catch {
    /* SSR / private mode — ignore */
  }
  return fallback;
}

function writeBool(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(key, value ? 'true' : 'false');
  } catch {
    /* private mode / quota — ignore */
  }
}

/**
 * sk-285.1.2 — read a persisted id set. Anything that isn't a JSON
 * array of strings (hand-edited entry, a value written by an older
 * build, a quota/private-mode throw) degrades to the empty set, i.e.
 * to "every project collapsed" (sk-551.12) — the default, and a state
 * the user recovers from one click per project.
 */
function readIdSet(key: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === 'string'));
  } catch {
    /* SSR / private mode / malformed JSON — ignore */
    return new Set();
  }
}

/**
 * Read the space-fold choices. Anything but an object of
 * `'collapsed' | 'expanded'` values (older build, hand-edited entry,
 * private-mode throw) is dropped entry by entry — a lost choice only
 * returns that space to its default.
 */
function readSpaceFoldChoices(): Record<string, SpaceFoldChoice> {
  try {
    const raw = window.localStorage.getItem(STORAGE_SPACE_TREE_FOLD);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const out: Record<string, SpaceFoldChoice> = {};
    for (const [id, v] of Object.entries(parsed)) {
      if (v === 'collapsed' || v === 'expanded') out[id] = v;
    }
    return out;
  } catch {
    /* SSR / private mode / malformed JSON — ignore */
    return {};
  }
}

function writeIdSet(key: string, value: ReadonlySet<string>): void {
  try {
    window.localStorage.setItem(key, JSON.stringify([...value]));
  } catch {
    /* private mode / quota — ignore */
  }
}

/**
 * Read the workspace-view bookkeeping. Anything that isn't the exact
 * shape written by {@link writeWorkspaceRecord} (older build, hand-edited
 * entry, private-mode throw) degrades to "no workspace view has ever folded
 * anything and the user has never opted out" — the state from which the
 * next fold/unfold cycle is correct again.
 */
function readWorkspaceRecord(): WorkspaceRecord {
  try {
    const raw = window.localStorage.getItem(STORAGE_WORKSPACE_VIEW);
    if (raw === null) return EMPTY_WORKSPACE_RECORD;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return EMPTY_WORKSPACE_RECORD;
    const rec = parsed as { auto?: unknown; optOut?: unknown };
    const pick = (src: unknown): Record<WorkspaceFoldedCol, boolean> => {
      const obj = typeof src === 'object' && src !== null ? (src as Record<string, unknown>) : {};
      return {
        inbox: obj.inbox === true,
        projects: obj.projects === true,
      };
    };
    return { auto: pick(rec.auto), optOut: pick(rec.optOut) };
  } catch {
    /* SSR / private mode / malformed JSON — ignore */
    return EMPTY_WORKSPACE_RECORD;
  }
}

function writeWorkspaceRecord(value: WorkspaceRecord): void {
  try {
    window.localStorage.setItem(STORAGE_WORKSPACE_VIEW, JSON.stringify(value));
  } catch {
    /* private mode / quota — ignore */
  }
}

/**
 * Mount-time fallback for the left column's tab: the last tab the user
 * looked at, validated against the tabs that currently exist. A stored
 * value naming a tab that has since been removed does NOT produce an
 * empty screen — it falls back to Inbox (documented edge case).
 */
function readStoredTab(): InboxTab {
  try {
    return parseTab(window.localStorage.getItem(STORAGE_INBOX_TAB)) ?? DEFAULT_TAB;
  } catch {
    /* SSR / private mode — ignore */
  }
  return DEFAULT_TAB;
}

/**
 * Mount-time fallback for the lens. Three legacy boolean keys (one per
 * lens) are still the storage shape — reading them into a single
 * nullable value is what makes the three-way mutex structural rather
 * than something the setters have to keep re-establishing. If two keys
 * are somehow both `true` (a pre-mutex install, or a hand-edited
 * storage), the fixed order below decides — no lens is ever "both".
 */
function readStoredLens(): Lens | null {
  if (readBool(STORAGE_ONME, false)) return 'on-me';
  if (readBool(STORAGE_OUTBOX, false)) return 'delegated';
  if (readBool(STORAGE_BUDILNIK, false)) return 'budilnik';
  return null;
}

function readColWidth(col: ColKey): number {
  const bounds = COL_BOUNDS[col];
  try {
    const raw = window.localStorage.getItem(STORAGE_COL[col]);
    if (raw !== null) {
      const n = Number.parseInt(raw, 10);
      if (Number.isFinite(n)) return clamp(n, bounds.min, COL_STORAGE_MAX[col]);
    }
  } catch {
    /* ignore */
  }
  return bounds.default;
}

/**
 * sk-551.29 — task panel width from storage.
 *
 * An absent key and an unfit value give ONE answer — `null`, that is the
 * default width.
 */
function readWorkspaceDetailsWidth(mode: WorkspaceWidthMode): number | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_WORKSPACE_DETAILS_WIDTH[mode]);
    if (raw === null) return null;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n)) return null;
    return clamp(n, WORKSPACE_DETAILS_BOUNDS.min, WORKSPACE_DETAILS_BOUNDS.max);
  } catch {
    return null;
  }
}

function writeWorkspaceDetailsWidth(mode: WorkspaceWidthMode, value: number): void {
  try {
    window.localStorage.setItem(STORAGE_WORKSPACE_DETAILS_WIDTH[mode], String(Math.round(value)));
  } catch {
    /* ignore */
  }
}

/**
 * Erase the former workspace values without carrying them over: the sk-514 ceiling
 * ({@link STORAGE_WORKSPACE_MAX_LEGACY}) and the sk-551.14 view width
 * ({@link STORAGE_WORKSPACE_VIEW_WIDTH_LEGACY}).
 */
function dropLegacyWorkspaceKeys(): void {
  try {
    window.localStorage.removeItem(STORAGE_WORKSPACE_MAX_LEGACY);
    window.localStorage.removeItem(STORAGE_WORKSPACE_VIEW_WIDTH_LEGACY);
  } catch {
    /* ignore */
  }
}

function writeColWidth(col: ColKey, value: number): void {
  try {
    window.localStorage.setItem(STORAGE_COL[col], String(Math.round(value)));
  } catch {
    /* ignore */
  }
}

type LayoutContextValue = LayoutState & LayoutActions;

const LayoutContext = createContext<LayoutContextValue | null>(null);

/**
 * sk-30 / sk-46 — snapshot captured when ANY lens turns ON (and both
 * were OFF beforehand). Used to restore the URL when ALL lenses turn
 * back OFF.
 *
 * sk-46 — the snapshot no longer carries filter state. The lens preset
 * is now an ephemeral overlay derived in `useTaskSearchModes` (it reads
 * `LENS_FILTER_PRESET` and never touches the persisted filters), so
 * there is nothing to snapshot or restore on the filter side: turning
 * the lens OFF simply drops the overlay and the column reverts to the
 * user's untouched persisted preferences. Only the URL is restored here.
 */
interface LensSnapshot {
  /** URL state at the moment the lens cycle started. */
  selectedProject: string | null;
  /** sk-674.18 T052 — the place «space» the cycle left (its address segment). */
  selectedSpaceHandle: string | null;
  selectedIssue: string | null;
  selectedComponent: string | null;
  /**
   * sk-303.13 (T027) — the open attachment, if any. A lens drops the
   * entity selection (it is a cross-project view), and an attachment
   * parameter without its issue is a dangling viewer, so `?file=` is
   * stripped on the way in and restored on the way out. That keeps the
   * lens round-trip lossless for the one parameter that IS bound to the
   * path; `?tab=` and anything else are orthogonal and are simply left
   * alone throughout the cycle.
   */
  selectedAttachment: string | null;
}

/**
 * Build the URL path that a snapshot restores to. Mirrors the
 * URL shapes the navigation helpers emit so the round-trip is
 * lossless.
 */
function snapshotToPath(snap: LensSnapshot): string {
  if (snap.selectedProject !== null) {
    const proj = encodeURIComponent(snap.selectedProject);
    if (snap.selectedComponent !== null && snap.selectedIssue !== null) {
      return `/projects/${proj}/components/${encodeURIComponent(snap.selectedComponent)}/issues/${encodeURIComponent(snap.selectedIssue)}`;
    }
    if (snap.selectedComponent !== null) {
      return `/projects/${proj}/components/${encodeURIComponent(snap.selectedComponent)}`;
    }
    if (snap.selectedIssue !== null) {
      return `/projects/${proj}/issues/${encodeURIComponent(snap.selectedIssue)}`;
    }
    return `/projects/${proj}`;
  }
  if (snap.selectedSpaceHandle !== null) {
    return spacePath(snap.selectedSpaceHandle, snap.selectedIssue);
  }
  if (snap.selectedIssue !== null) {
    return `/issues/${encodeURIComponent(snap.selectedIssue)}`;
  }
  return '/';
}

export function LayoutProvider({ children }: { children: ReactNode }) {
  const params = useParams<{ alias?: string; id?: string; cid?: string; space?: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const selectedProject = params.alias ?? null;
  // sk-674.18 T052 — the place «space»; an empty id names no space.
  const selectedSpace = parseSpaceHandle(params.space);
  const selectedSpaceHandle = selectedSpace === null ? null : params.space ?? null;
  const selectedIssue = params.id ?? null;
  const selectedComponent = params.cid ?? null;
  // sk-439 — read-only access to the projects cache, for telling whether
  // `setSelectedIssue`'s target is in the current project.
  const queryClient = useQueryClient();
  // sk-41 — `?file=<attachmentId>` selects an attachment in the in-card
  // viewer. URL is the source of truth; bookmarking / sharing /
  // back-button-after-close all work without extra coordination.
  const selectedAttachment = searchParams.get(FILE_PARAM);
  // sk-41 — `location.state.selfOpenedFile` distinguishes the in-card
  // open ("user clicked an attachment, viewer replaces the card") from
  // the shared-link load ("URL has ?file= on fresh navigation, render
  // split layout"). Narrow without a cast so a malformed state shape
  // can't accidentally claim the flag.
  const navState = location.state;
  const selfOpenedFile =
    typeof navState === 'object'
    && navState !== null
    && 'selfOpenedFile' in navState
    && (navState as { selfOpenedFile?: unknown }).selfOpenedFile === true;

  // sk-551.8 — the left-panel layout ACTIVE for this provider, through the
  // OPTIONAL reader (bare providers in unit tests answer `columns`).
  // Declared here, before its first reader (the `?tab=` effect, P4).
  const { navLayout, known: navLayoutKnown } = useNavLayoutOptionalState();
  const navLayoutRef = useRef<NavLayout>(navLayout);
  navLayoutRef.current = navLayout;

  // sk-303.13 (T027) — tab + lens are derived from the address.
  //
  // The fallbacks below are read from localStorage ONCE, at provider
  // mount, and then frozen in refs. That is deliberate and load-bearing
  // for back/forward: if the fallback tracked the live preference, an
  // entry without `?tab=` would render whatever the user last picked
  // rather than what that entry meant, and Back would silently land on
  // the wrong tab. Frozen, an address without the parameter always
  // means the same thing for as long as the shell is mounted; a reload
  // re-reads the preference, which is exactly when "my usual tab"
  // should apply again.
  const fallbackTabRef = useRef<InboxTab>(readStoredTab());
  const fallbackLensRef = useRef<Lens | null>(readStoredLens());

  const rawTabParam = searchParams.get(TAB_PARAM);
  const rawLensParam = searchParams.get(LENS_PARAM);
  // Address wins whenever it carries a value the app knows. An unknown
  // value counts as no opinion (and gets normalised out of the URL by
  // the effect below) rather than as an error screen.
  const inboxTab = parseTab(rawTabParam) ?? fallbackTabRef.current;
  const lens = parseLens(rawLensParam) ?? fallbackLensRef.current;

  // One parameter, three booleans: the three-way mutex is structural —
  // a single `?lens=` value cannot name two lenses, so no setter has to
  // enforce it and no URL can express "both on".
  const onMeMode = lens === 'on-me';
  const outboxMode = lens === 'delegated';
  const budilnikMode = lens === 'budilnik';

  // sk-303.14 (T024) — the selection, read from the address in the same
  // render every consumer builds its query in. No storage fallback (see
  // SELECTS in shellUrlState) and no state: this value IS the parameter.
  //
  // sk-303.14 (B/1 review W1) — gated on the ADDRESSED lens, not on the
  // effective one. `outboxMode` above can be lit by localStorage when the
  // address is silent about the lens; reading the selection off that would
  // give `?select=unreviewed` a storage fallback through the back door —
  // the same link opening a narrowed surface for a reader whose last lens
  // was Delegated and an unnarrowed one for everybody else, which is
  // exactly what "reproducible from the URL alone" rules out. It also put
  // the state outside its own contract: with no `?lens=` in the address
  // the OFF path reads as "the lens cycle is starting", so dropping the
  // selection navigated the reader to `/` instead of leaving them where
  // they were. An address that wants the selection has to name its lens —
  // and every write in this module writes the pair together, so nothing
  // in-app can produce a half address. One that arrives anyway (hand-
  // edited, truncated, stale) is normalised in `normalizeShellSearch`.
  const shellSelect = parseSelect(searchParams.get(SELECT_PARAM));
  const unreviewedSelected =
    parseLens(rawLensParam) === 'delegated' && shellSelect === 'unreviewed';

  // The lens setters read the current lens through a ref so they stay
  // stable across navigations (a changing identity would re-render
  // every useLayoutState() consumer on each keystroke elsewhere).
  const lensRef = useRef<Lens | null>(lens);
  useEffect(() => {
    lensRef.current = lens;
  }, [lens]);

  // sk-30 / sk-46 — lens URL snapshot held in memory only (not
  // localStorage by design: reload-while-in-lens should NOT silently
  // roll back to a stale snapshot; the user stays in the lens until they
  // explicitly toggle it OFF). Re-entering the lens cycle after a reload
  // simply captures a fresh URL snapshot of whatever the user currently
  // has on screen.
  //
  // sk-46 — the snapshot is now URL-ONLY (selectedProject, selectedIssue,
  // selectedComponent). Filter state is no longer snapshotted/restored:
  // the lens preset is a pure overlay in `useTaskSearchModes`, so the
  // persisted filters are never disturbed and need no restore.
  //
  // Lifecycle: one snapshot per lens cycle. Snapshot is taken the
  // FIRST time any lens turns ON when both were OFF. Subsequent lens
  // switches (on-me → delegated) keep the original snapshot. When
  // ALL lenses go OFF, restore the URL from the snapshot then clear it.
  const lensSnapshotRef = useRef<LensSnapshot | null>(null);

  // Refs for the current URL state so the lens transition callbacks
  // see the latest values without re-creating themselves on every
  // navigation. (Re-creating would invalidate the useMemo'd context
  // value and re-render every consumer on every keystroke through
  // useTasksUiState — too expensive.)
  //
  // sk-41 (review TS-W6) — `navState` joins the same ref so the
  // openAttachment / closeAttachment closures don't carry it in their
  // dep arrays. Without this, every URL change reruns the closures
  // (and the useMemo'd context value), forcing a re-render of every
  // useLayoutState() consumer.
  const urlStateRef = useRef({
    selectedProject,
    selectedSpaceHandle,
    selectedIssue,
    selectedComponent,
    locationKey: location.key,
    pathname: location.pathname,
    search: location.search,
    navState,
  });
  useEffect(() => {
    urlStateRef.current = {
      selectedProject,
      selectedSpaceHandle,
      selectedIssue,
      selectedComponent,
      locationKey: location.key,
      pathname: location.pathname,
      search: location.search,
      navState,
    };
  }, [selectedProject, selectedSpaceHandle, selectedIssue, selectedComponent, location.key, location.pathname, location.search, navState]);

  // sk-41 (review HC-W8) — remember the DOM element that held focus
  // when `openAttachment` was called so `closeAttachment` can restore
  // focus to it. In the split-layout flow the trigger is still in the
  // DOM after close; in the single-pane flow it is unmounted and the
  // captured ref's `parentNode` becomes null — we silently skip the
  // focus restore in that case (the document re-focuses body, browsers
  // don't restore the unmounted element). Best-effort, APG-compatible.
  const attachmentTriggerRef = useRef<HTMLElement | null>(null);
  const [inboxCollapsed, setInboxCollapsedState] = useState<boolean>(() =>
    readBool(STORAGE_INBOX_COLLAPSED, false),
  );
  // sk-285.7 T024 — which navigation zone is on screen. `tasks` is the
  // opening zone on a phone for the same reason it is the widest column
  // on a desktop: it is what the user came for. No storage read: the
  // value is a position, not a preference (see `activeZone` on the
  // context type).
  const [activeZone, setActiveZone] = useState<'queues' | 'projects' | 'tasks'>('tasks');
  // sk-551.12 — per-project fold. Set semantics: present = expanded.
  const [expandedProjectIds, setExpandedProjectIds] = useState<ReadonlySet<string>>(
    () => readIdSet(STORAGE_PROJECT_TREE_EXPANDED),
  );
  // sk-674.18 T051 — explicit fold choices of the space rows.
  const [spaceFoldChoices, setSpaceFoldChoices] = useState<
    Readonly<Record<string, SpaceFoldChoice>>
  >(() => readSpaceFoldChoices());
  // sk-290 — whole-column collapse. Separate cell from the per-project
  // set above on purpose: the two levels persist and restore
  // independently.
  const [projectsCollapsed, setProjectsCollapsedState] = useState<boolean>(() =>
    readBool(STORAGE_PROJECTS_COLLAPSED, false),
  );
  // Whole-column collapse for Tasks — its own cell, same recipe as the
  // Projects one above. Defaults to expanded.
  const [tasksCollapsed, setTasksCollapsedState] = useState<boolean>(() =>
    readBool(STORAGE_TASKS_COLLAPSED, false),
  );
  // sk-285.1.13 — filter-panel collapse. NOTE the `true` fallback: unlike
  // every other collapse flag in this file the panel defaults to CLOSED,
  // so a first-time user sees tasks instead of six rows of controls. A
  // persisted 'false' (the user expanded it) overrides that on load.
  const [taskFiltersCollapsed, setTaskFiltersCollapsedState] = useState<boolean>(
    () => readBool(STORAGE_TASK_FILTERS_COLLAPSED, true),
  );
  const [colWidths, setColWidths] = useState<ColWidths>(() => ({
    inbox: readColWidth('inbox'),
    projects: readColWidth('projects'),
    tasks: readColWidth('tasks'),
  }));
  // sk-551.29 — `null` = the default width (the user did not drag).
  const [workspaceDetailsWidth, setWorkspaceDetailsWidthState] = useState<
    Readonly<Record<WorkspaceWidthMode, number | null>>
  >(() => ({
    desktop: readWorkspaceDetailsWidth('desktop'),
    tablet: readWorkspaceDetailsWidth('tablet'),
  }));
  // The former workspace values are erased once, without carrying over.
  useEffect(() => {
    dropLegacyWorkspaceKeys();
  }, []);

  // Write-through persistence
  useEffect(() => {
    writeBool(STORAGE_OUTBOX, outboxMode);
  }, [outboxMode]);

  useEffect(() => {
    writeBool(STORAGE_ONME, onMeMode);
  }, [onMeMode]);

  useEffect(() => {
    writeBool(STORAGE_BUDILNIK, budilnikMode);
  }, [budilnikMode]);

  useEffect(() => {
    writeBool(STORAGE_INBOX_COLLAPSED, inboxCollapsed);
  }, [inboxCollapsed]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_INBOX_TAB, inboxTab);
    } catch {
      /* ignore */
    }
  }, [inboxTab]);

  useEffect(() => {
    writeIdSet(STORAGE_PROJECT_TREE_EXPANDED, expandedProjectIds);
  }, [expandedProjectIds]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_SPACE_TREE_FOLD, JSON.stringify(spaceFoldChoices));
    } catch {
      /* private mode / quota — ignore */
    }
  }, [spaceFoldChoices]);

  useEffect(() => {
    try {
      window.localStorage.removeItem(STORAGE_PROJECT_TREE_COLLAPSED_LEGACY);
    } catch {
      /* private mode — ignore */
    }
  }, []);

  useEffect(() => {
    writeBool(STORAGE_PROJECTS_COLLAPSED, projectsCollapsed);
  }, [projectsCollapsed]);

  useEffect(() => {
    writeBool(STORAGE_TASKS_COLLAPSED, tasksCollapsed);
  }, [tasksCollapsed]);

  useEffect(() => {
    writeBool(STORAGE_TASK_FILTERS_COLLAPSED, taskFiltersCollapsed);
  }, [taskFiltersCollapsed]);

  // ── Stage 2 — "the view takes the workspace" ─────────────────────────
  //
  // Three refs, no state cells: none of this is rendered, it only drives
  // imperative fold/unfold transitions, so keeping it out of state keeps
  // the memoised context value (and every consumer) from re-rendering.
  //
  // `workspaceRecordRef` is the persisted bookkeeping (auto / optOut).
  // `workspaceActiveRef` is "is a workspace view (board / tree) on screen
  // right now" — needed so that a manual collapse/expand can be
  // attributed: the SAME click on the same sliver means "I disagree with
  // the automation" inside one of those views and means nothing at all
  // outside them.
  // `collapsedNowRef` mirrors the two collapse flags so the transitions
  // can read them without taking a dependency on them (which would
  // rebuild the callbacks, and the context value, on every fold).
  const workspaceRecordRef = useRef<WorkspaceRecord>(readWorkspaceRecord());
  const workspaceActiveRef = useRef(false);
  const collapsedNowRef = useRef<Record<WorkspaceFoldedCol, boolean>>({
    inbox: inboxCollapsed,
    projects: projectsCollapsed,
  });
  useEffect(() => {
    collapsedNowRef.current = { inbox: inboxCollapsed, projects: projectsCollapsed };
  }, [inboxCollapsed, projectsCollapsed]);

  const putWorkspaceRecord = useCallback((next: WorkspaceRecord) => {
    workspaceRecordRef.current = next;
    writeWorkspaceRecord(next);
  }, []);

  /**
   * Fold / unfold one of the two workspace-managed columns from the
   * AUTOMATION side. Deliberately bypasses the public setters below:
   * those record user intent, and the automation is not the user.
   */
  const setFoldedColState = useCallback((col: WorkspaceFoldedCol, v: boolean) => {
    if (col === 'inbox') {
      writeBool(STORAGE_INBOX_COLLAPSED, v);
      setInboxCollapsedState(v);
    } else {
      writeBool(STORAGE_PROJECTS_COLLAPSED, v);
      setProjectsCollapsedState(v);
    }
    collapsedNowRef.current = { ...collapsedNowRef.current, [col]: v };
  }, []);

  /**
   * Record that the USER folded or unfolded one of the workspace-managed
   * columns by hand. Outside a workspace view this is a no-op — a fold
   * made in Cards view is just the user's normal layout, and the board /
   * tree will happily honour it (an already-folded column is left alone
   * on entry).
   *
   * Inside a workspace view:
   *   unfold → the user overrules the automation for this column, and it
   *            is left alone from now on (also dropping any claim that
   *            the automation owns its state);
   *   fold   → the user agrees with the automation again, so the opt-out
   *            is cleared — but `auto` stays false, because THIS fold is
   *            the user's and must survive the way back to list view.
   */
  const noteManualFold = useCallback(
    (col: WorkspaceFoldedCol, collapsed: boolean) => {
      // Keep the mirror eager so two folds inside one event still see
      // the right "current" value (the effect above only catches up on
      // the next commit).
      collapsedNowRef.current = { ...collapsedNowRef.current, [col]: collapsed };
      if (!workspaceActiveRef.current) return;
      const prev = workspaceRecordRef.current;
      putWorkspaceRecord({
        auto: { ...prev.auto, [col]: false },
        optOut: { ...prev.optOut, [col]: !collapsed },
      });
    },
    [putWorkspaceRecord],
  );

  const enterWorkspaceView = useCallback((): WorkspaceFoldedCol[] => {
    workspaceActiveRef.current = true;
    const prev = workspaceRecordRef.current;
    const auto = { ...prev.auto };
    const folded: WorkspaceFoldedCol[] = [];
    for (const col of WORKSPACE_FOLDED_COLS) {
      if (prev.optOut[col] || collapsedNowRef.current[col]) {
        // Opted out, or already folded by the user — either way the
        // automation has nothing to give back later.
        auto[col] = false;
        continue;
      }
      setFoldedColState(col, true);
      auto[col] = true;
      folded.push(col);
    }
    putWorkspaceRecord({ auto, optOut: prev.optOut });
    return folded;
  }, [putWorkspaceRecord, setFoldedColState]);

  const leaveWorkspaceView = useCallback(() => {
    workspaceActiveRef.current = false;
    const prev = workspaceRecordRef.current;
    for (const col of WORKSPACE_FOLDED_COLS) {
      if (prev.auto[col]) setFoldedColState(col, false);
    }
    // `optOut` deliberately SURVIVES the trip out: a user who re-opened
    // Projects on the board (or in the tree) wants it open the next time
    // they open either one, not just this once.
    putWorkspaceRecord({ auto: { inbox: false, projects: false }, optOut: prev.optOut });
  }, [putWorkspaceRecord, setFoldedColState]);

  const syncWorkspaceView = useCallback(
    (active: boolean) => {
      workspaceActiveRef.current = active;
      if (active) return;
      // No workspace view on screen, so nothing is owed back. Drop any
      // `auto` claim left over from a session that ended inside one with a
      // different view persisted — it can only mis-fire otherwise.
      const prev = workspaceRecordRef.current;
      if (prev.auto.inbox || prev.auto.projects) {
        putWorkspaceRecord({
          auto: { inbox: false, projects: false },
          optOut: prev.optOut,
        });
      }
    },
    [putWorkspaceRecord],
  );

  const noteWorkspaceView = useCallback((active: boolean) => {
    workspaceActiveRef.current = active;
  }, []);

  const setProjectsCollapsed = useCallback(
    (v: boolean) => {
      noteManualFold('projects', v);
      setProjectsCollapsedState(v);
    },
    [noteManualFold],
  );
  const toggleProjectsCollapsed = useCallback(() => {
    const next = !collapsedNowRef.current.projects;
    noteManualFold('projects', next);
    setProjectsCollapsedState(next);
  }, [noteManualFold]);

  const setTasksCollapsed = useCallback(
    (v: boolean) => setTasksCollapsedState(v),
    [],
  );
  const toggleTasksCollapsed = useCallback(
    () => setTasksCollapsedState((v) => !v),
    [],
  );

  const setTaskFiltersCollapsed = useCallback(
    (v: boolean) => setTaskFiltersCollapsedState(v),
    [],
  );
  const toggleTaskFiltersCollapsed = useCallback(
    () => setTaskFiltersCollapsedState((v) => !v),
    [],
  );

  const toggleProjectCollapsed = useCallback((projectId: string) => {
    setExpandedProjectIds((prev) => {
      const next = new Set(prev);
      if (!next.delete(projectId)) next.add(projectId);
      return next;
    });
  }, []);

  const expandProject = useCallback((projectId: string) => {
    setExpandedProjectIds((prev) => {
      if (prev.has(projectId)) return prev;
      return new Set(prev).add(projectId);
    });
  }, []);

  const setSpaceCollapsed = useCallback((spaceId: string, collapsed: boolean) => {
    const choice: SpaceFoldChoice = collapsed ? 'collapsed' : 'expanded';
    setSpaceFoldChoices((prev) =>
      prev[spaceId] === choice ? prev : { ...prev, [spaceId]: choice },
    );
  }, []);

  // US-10 — "a link to a tab expands the column, it does not open it
  // invisible". A stored `collapsed = true` loses to an address that
  // names a tab. Keyed on the RAW parameter so it fires on entry by
  // address and on every later change of the parameter, and not on an
  // unrelated re-render: once expanded, the user may collapse the
  // column again without this effect fighting them.
  //
  // sk-551.8 (P4) — only with the side-by-side layout active. With the
  // sections layout the reveal by address is the P12 subscriber's, and
  // `?tab=` must not write the side-by-side `inbox-collapsed` (US-12).
  // The layout is read through its ref: a later switch of layout is not
  // an address change and must not re-run this.
  useEffect(() => {
    if (navLayoutRef.current !== 'columns') return;
    if (parseTab(rawTabParam) === null) return;
    setInboxCollapsedState(false);
  }, [rawTabParam]);

  // Normalise an address the app cannot honour (unknown or emptied
  // `tab` / `lens`). `replace` — a correction is not a destination, and
  // a pushed entry would make Back bounce between the bad URL and its
  // fix. `location.state` is carried over so the correction doesn't
  // drop `selfOpenedFile`.
  useEffect(() => {
    const normalized = normalizeShellSearch(location.search);
    if (normalized === null) return;
    navigate(
      { pathname: location.pathname, search: normalized },
      { replace: true, state: location.state ?? undefined },
    );
  }, [location.search, location.pathname, location.state, navigate]);

  const setInboxTab = useCallback(
    (tab: InboxTab) => {
      const url = urlStateRef.current;
      navigate(
        {
          pathname: url.pathname,
          // Functional update: keep `file` and every other parameter,
          // touch only `tab`.
          search: updateSearch(url.search, { [TAB_PARAM]: tab }),
        },
        // sk-551.8 (P12) — choosing another queue is a deliberate move
        // to it: the state carries a one-shot reveal nonce on top of
        // everything else (`selfOpenedFile` survives).
        { state: withReveal(url.navState) },
      );
    },
    [navigate],
  );

  // Lens transitions (sk-30 / sk-62.2, re-cut for T027).
  //
  // The lens now lives in `?lens=`, so "which lens is on" is no longer
  // three booleans that have to be kept mutually exclusive — it is one
  // value, and the only thing these setters decide is what the URL
  // should become:
  //   * "cycle starts" — the address carries no lens (nothing was on, or
  //     the lens came from storage alone). Snapshot the entity
  //     selection, then navigate to the cross-project view "/" carrying
  //     the lens.
  //   * "lens switch" — the address already names a lens. Swap the
  //     parameter in place: same path, same snapshot (the user is
  //     changing lens, not leaving the cycle).
  //   * "cycle ends" — the active lens is turning off. Drop the
  //     parameter and restore the snapshotted path (and its `?file=`).
  //     Reminders with a task open is the exception: it stays on the
  //     task (sk-551.25, see the branch below).
  //
  // sk-46 — no filter snapshot / preset push anywhere in here: the lens
  // preset is an ephemeral overlay derived in `useTaskSearchModes`, so
  // the user's persisted filters are never touched and need no restore.
  // sk-303.14 (T024) — `select` is the SECOND axis this function writes.
  // It rides along on every transition instead of being a separate
  // navigation, so a lens change and its selection are one history entry
  // and one address, never a two-step where the intermediate URL is a
  // state the app never meant to show. Omit it (the default) and the
  // transition CLEARS any selection that was there: a selection belongs
  // to the surface it was entered on, so leaving that surface — the cycle
  // ending, or another lens taking over — takes it with it. That is the
  // "cleared on exit" half of T024; the carrying half is free,
  // because `updateSearch` preserves every parameter it is not given.
  const setLens = useCallback(
    (next: Lens | null, select: ShellSelect | null = null) => {
      const current = lensRef.current;
      const url = urlStateRef.current;
      const addressedSelect = parseSelect(
        new URLSearchParams(url.search).get(SELECT_PARAM),
      );
      if (current === next && addressedSelect === select) return;
      // Whether we are INSIDE a lens cycle is a property of the ADDRESS,
      // not of the effective lens. A lens lit only by storage leaves the
      // URL silent: no `?lens=` was ever pushed, so no snapshot was ever
      // taken and there is nothing for the in-place swap to swap. Gating
      // the cycle on `current` would call that state "already in a
      // cycle" and switch lenses on the current path — a stored On me on
      // `/projects/sk` plus a click on Reminders would land on
      // `/projects/sk?lens=budilnik` instead of the cross-project
      // `/?lens=budilnik`, and turning it off afterwards would have no
      // snapshot to restore.
      const addressedLens = parseLens(
        new URLSearchParams(url.search).get(LENS_PARAM),
      );
      // The stored lens answered for an address that stayed silent
      // about the lens; the user has now spoken, so it stops answering
      // for the rest of this mount. Without this, turning OFF a lens
      // that came from storage would be a no-op: the parameter we
      // delete was never in the URL, and the stored value would light
      // the lens straight back up.
      fallbackLensRef.current = null;

      const startsCycle = next !== null && addressedLens === null;
      // sk-303.14 (T024) — TAKING a selection lands on the cross-project
      // surface even when the lens is already open, because that is what
      // the selection means: the whole set across every visible project,
      // with the project and issue selection dropped (SC-017). Dropping a
      // selection does not move anything — the user stays on the surface
      // they are looking at, one narrowing lighter.
      const takesSelect = select !== null && addressedSelect !== select;

      if (next !== null && (startsCycle || takesSelect)) {
        // Cycle starts. On me / Delegated / Reminders are cross-project
        // lenses by design, so the entity selection is dropped — and
        // with it `?file=`, which addresses an attachment of the issue
        // we are leaving. Both come back when the cycle ends.
        //
        // The snapshot is taken ONLY when the cycle starts: taking a
        // selection inside an open cycle must not overwrite the URL the
        // cycle will restore to (the user is narrowing, not re-entering).
        if (startsCycle) {
          lensSnapshotRef.current = {
            selectedProject: url.selectedProject,
            selectedSpaceHandle: url.selectedSpaceHandle,
            selectedIssue: url.selectedIssue,
            selectedComponent: url.selectedComponent,
            selectedAttachment: new URLSearchParams(url.search).get(FILE_PARAM),
          };
        }
        navigate({
          pathname: '/',
          search: updateSearch(url.search, {
            [LENS_PARAM]: next,
            [SELECT_PARAM]: select,
            [FILE_PARAM]: null,
          }),
        });
        return;
      }

      if (next !== null) {
        // Lens switch — the new lens wants the same cross-project view,
        // so only the parameter moves. Nav state is carried so an
        // in-flight overlay flag isn't dropped by the swap.
        navigate(
          {
            pathname: url.pathname,
            search: updateSearch(url.search, {
              [LENS_PARAM]: next,
              [SELECT_PARAM]: select,
            }),
          },
          { state: carryState(url.navState) ?? undefined },
        );
        return;
      }

      // Cycle ends. Without a snapshot (reload mid-lens, or a remount)
      // there is nothing to restore — just drop the parameter and stay
      // where we are.
      //
      // sk-551.25 — Reminders ending with a task open stays on that task.
      // Its list IS the Tasks column, so a task open now was opened from
      // the list (the cycle start dropped the issue), and the reminder is
      // being answered in it: restoring the snapshot would close the very
      // card the user is working in. The snapshot is dropped — the user
      // has chosen where to be — and `?file=`, if any, is this task's.
      // On me / Delegated keep the restore (as in `ProjectsPickOptions`).
      if (current === 'budilnik' && url.selectedIssue !== null) {
        lensSnapshotRef.current = null;
        navigate(
          {
            pathname: url.pathname,
            search: updateSearch(url.search, { [LENS_PARAM]: null, [SELECT_PARAM]: null }),
          },
          { state: carryState(url.navState) ?? undefined },
        );
        return;
      }
      const snap = lensSnapshotRef.current;
      const search = updateSearch(url.search, {
        [LENS_PARAM]: null,
        [SELECT_PARAM]: null,
        [FILE_PARAM]: snap?.selectedAttachment ?? null,
      });
      if (snap === null) {
        navigate(
          { pathname: url.pathname, search },
          { state: carryState(url.navState) ?? undefined },
        );
        return;
      }
      // Navigate without state — `selfOpenedFile` and anything else a
      // future feature plants there should not leak back into the
      // restored project view.
      navigate({ pathname: snapshotToPath(snap), search });
      lensSnapshotRef.current = null;
    },
    [navigate],
  );

  const setOutboxMode = useCallback(
    (v: boolean) => {
      if (v) setLens('delegated');
      else if (lensRef.current === 'delegated') setLens(null);
    },
    [setLens],
  );

  const toggleOutboxMode = useCallback(() => {
    setOutboxMode(!outboxMode);
  }, [outboxMode, setOutboxMode]);

  const setOnMeMode = useCallback(
    (v: boolean) => {
      if (v) setLens('on-me');
      else if (lensRef.current === 'on-me') setLens(null);
    },
    [setLens],
  );

  const toggleOnMeMode = useCallback(() => {
    setOnMeMode(!onMeMode);
  }, [onMeMode, setOnMeMode]);

  // sk-62.2 — Reminders lens setter. Same cycle as the other two.
  //
  // sk-551.9 — turning it ON unfolds the Tasks column. The lens replaces
  // the column's body with the ringing list (`BudilnikLensBody`), and a
  // folded column renders only its sliver, so a user answering a ringing
  // reminder would land on an empty details pane. No issue is selected
  // here on purpose (owner, 2026-09-30): the list itself is the answer
  // to «what is ringing».
  //
  // The unfold is written to storage synchronously, as `setInboxCollapsed`
  // does: the header toggle also runs under the provider of Settings /
  // AppChrome, the lens navigates to `/`, and that provider unmounts
  // before its write-through effect commits — the Shell's provider would
  // then read the stale fold.
  //
  // On me / Delegated keep the fold. They narrow the whole shell, not
  // just this column — the Projects counts and the folded sliver's own
  // count follow them — so with the column folded they still change what
  // is on screen, and the fold is a layout the user chose. Reminders is
  // the one lens whose whole content lives inside the column.
  const setBudilnikMode = useCallback(
    (v: boolean) => {
      if (v) {
        writeBool(STORAGE_TASKS_COLLAPSED, false);
        setTasksCollapsedState(false);
        setLens('budilnik');
      } else if (lensRef.current === 'budilnik') setLens(null);
    },
    [setLens],
  );

  const toggleBudilnikMode = useCallback(() => {
    setBudilnikMode(!budilnikMode);
  }, [budilnikMode, setBudilnikMode]);

  // sk-303.14 (T024) — the entry channel for the unreviewed selection.
  //
  // ON always goes through the Delegated lens: the selection is a subset
  // of that surface, so "jump to the unreviewed set" and "open Delegated"
  // are one navigation, not two. `setLens` decides the rest — it lands on
  // `/` (all visible projects) and drops the entity selection whether the
  // lens was closed, showing another lens, or already open on a project.
  //
  // OFF keeps the lens and drops only the parameter.
  const setUnreviewedSelected = useCallback(
    (v: boolean) => {
      if (v) {
        setLens('delegated', 'unreviewed');
        return;
      }
      // Dropping a selection is a no-op unless the Delegated lens is the
      // one on screen. Without this guard an OFF arriving while another
      // lens is up would read as `setLens('delegated', …)` and SWITCH the
      // lens — a navigation nobody asked for.
      if (lensRef.current !== 'delegated') return;
      setLens('delegated', null);
    },
    [setLens],
  );

  /**
   * Same synchronous write-through as `setInboxTab` above, for the same
   * reason: the header badge expands the column and navigates to the
   * Shell in one event, and the persistence effect of the unmounting
   * provider would never run.
   */
  const setInboxCollapsed = useCallback(
    (v: boolean) => {
      noteManualFold('inbox', v);
      writeBool(STORAGE_INBOX_COLLAPSED, v);
      setInboxCollapsedState(v);
    },
    [noteManualFold],
  );
  const toggleInboxCollapsed = useCallback(() => {
    const next = !collapsedNowRef.current.inbox;
    noteManualFold('inbox', next);
    setInboxCollapsedState(next);
  }, [noteManualFold]);

  /**
   * sk-551.29 — remember the task panel width.
   *
   * The upper and lower bounds of the drag are not checked here — they depend on the row and
   * are clamped by the handle at the start of the drag
   * (`lib/workspaceResize.ts#detailsDragBounds`); here only protection from
   * garbage, {@link WORKSPACE_DETAILS_BOUNDS}.
   */
  const setWorkspaceDetailsWidth = useCallback((mode: WorkspaceWidthMode, w: number) => {
    const next = clamp(Math.round(w), WORKSPACE_DETAILS_BOUNDS.min, WORKSPACE_DETAILS_BOUNDS.max);
    setWorkspaceDetailsWidthState((prev) => {
      if (prev[mode] === next) return prev;
      writeWorkspaceDetailsWidth(mode, next);
      return { ...prev, [mode]: next };
    });
  }, []);

  const setColWidth = useCallback((col: ColKey, w: number) => {
    const bounds = COL_BOUNDS[col];
    const clamped = clamp(Math.round(w), bounds.min, COL_STORAGE_MAX[col]);
    setColWidths((prev) => {
      if (prev[col] === clamped) return prev;
      writeColWidth(col, clamped);
      return { ...prev, [col]: clamped };
    });
  }, []);

  // Navigation helpers — single source of truth is the URL. These
  // helpers exist so column components don't have to import `useNavigate`
  // on top of `useLayoutState`; the layout abstraction owns route shape.
  //
  // sk-303.13 (T027) — every one of them carries the shell parameters
  // across the path change: picking a project or a task must not drop
  // the tab and lens the user is looking through. `?file=` is the one
  // parameter that does NOT survive, because it names an attachment of
  // the issue being left behind; carrying it over would open a viewer
  // for a file that belongs to another card.
  const searchAcrossPathChange = useCallback(
    () => updateSearch(urlStateRef.current.search, { [FILE_PARAM]: null }),
    [],
  );

  // sk-551.11 — the query string of an explicit Projects-column pick: the
  // shell parameters as above, minus the Reminders lens when the pick
  // asks to end it (`ProjectsPickOptions#endBudilnik`). A lens lit only
  // by storage has no `?lens=` to drop, so the stored fallback is retired
  // too, exactly as `setLens` does when the user speaks.
  const searchForProjectsPick = useCallback(
    (opts: ProjectsPickOptions | undefined) => {
      const search = searchAcrossPathChange();
      if (!opts?.endBudilnik || lensRef.current !== 'budilnik') return search;
      fallbackLensRef.current = null;
      lensSnapshotRef.current = null;
      return updateSearch(search, { [LENS_PARAM]: null, [SELECT_PARAM]: null });
    },
    [searchAcrossPathChange],
  );

  const setSelectedProject = useCallback(
    (handle: string | null, opts?: ProjectsPickOptions) => {
      const search = searchForProjectsPick(opts);
      if (handle === null || handle === '') {
        navigate({ pathname: '/', search });
        return;
      }
      navigate({ pathname: `/projects/${encodeURIComponent(handle)}`, search });
    },
    [navigate, searchForProjectsPick],
  );

  const setSelectedSpace = useCallback(
    (handle: string, opts?: ProjectsPickOptions) => {
      navigate({ pathname: spacePath(handle), search: searchForProjectsPick(opts) });
    },
    [navigate, searchForProjectsPick],
  );

  const setSelectedIssue = useCallback(
    (id: string, projectHandle: string) => {
      const search = searchAcrossPathChange();
      // Cross-project surface (`/` — "All projects" view): keep the
      // tasks list intact by routing to `/issues/:id` instead of the
      // project-scoped URL. Otherwise the URL change would narrow the
      // Tasks column down to a single project.
      if (selectedProject === null) {
        // sk-674.18 T052 — the place «space» keeps its list the same way:
        // the issue opens inside the place, not on «All projects».
        navigate({
          pathname:
            selectedSpaceHandle !== null
              ? spacePath(selectedSpaceHandle, id)
              : `/issues/${encodeURIComponent(id)}`,
          search,
        });
        return;
      }
      // Component-scoped issue link rides the same `/components/{cid}`
      // segment so back-button after selecting an issue lands the user
      // on the same component-filtered tasks list — but only inside the
      // current project (sk-439): the component is this project's, and
      // an unknown target project gets no component (see the contract
      // on `useLayoutState.tsx#setSelectedIssue`).
      if (
        selectedComponent &&
        isKnownSameProject(queryClient, projectHandle, selectedProject)
      ) {
        navigate({
          pathname: `/projects/${encodeURIComponent(projectHandle)}/components/${encodeURIComponent(selectedComponent)}/issues/${encodeURIComponent(id)}`,
          search,
        });
        return;
      }
      navigate({
        pathname: `/projects/${encodeURIComponent(projectHandle)}/issues/${encodeURIComponent(id)}`,
        search,
      });
    },
    [navigate, searchAcrossPathChange, selectedProject, selectedSpaceHandle, selectedComponent, queryClient],
  );

  const clearSelectedIssue = useCallback(() => {
    const search = searchAcrossPathChange();
    if (selectedProject && selectedComponent) {
      navigate({
        pathname: `/projects/${encodeURIComponent(selectedProject)}/components/${encodeURIComponent(selectedComponent)}`,
        search,
      });
      return;
    }
    if (selectedProject) {
      navigate({
        pathname: `/projects/${encodeURIComponent(selectedProject)}`,
        search,
      });
      return;
    }
    if (selectedSpaceHandle !== null) {
      navigate({ pathname: spacePath(selectedSpaceHandle), search });
      return;
    }
    navigate({ pathname: '/', search });
  }, [navigate, searchAcrossPathChange, selectedProject, selectedSpaceHandle, selectedComponent]);

  const setSelectedComponent = useCallback(
    (cid: string | null, projectHandle: string, opts?: ProjectsPickOptions) => {
      const search = searchForProjectsPick(opts);
      if (cid === null) {
        navigate({
          pathname: `/projects/${encodeURIComponent(projectHandle)}`,
          search,
        });
        return;
      }
      navigate({
        pathname: `/projects/${encodeURIComponent(projectHandle)}/components/${encodeURIComponent(cid)}`,
        search,
      });
    },
    [navigate, searchForProjectsPick],
  );

  const selectInboxIssue = useCallback(
    (id: string, projectHandle: string) => {
      // The project-scoped URL gives the API call project context.
      //
      // sk-405 — and NOTHING else. This call used to plant
      // `state: { fromInbox: true }`, which Shell read to unmount the
      // Projects and Tasks columns; the owner asked for those columns to
      // stay, so the flag went with the behaviour rather than being left
      // written-and-unread. Selecting a queue card is now an ordinary
      // navigation: the address moves, the Details column fills, and
      // every list that holds this id marks its row.
      navigate({
        pathname: `/projects/${encodeURIComponent(projectHandle)}/issues/${encodeURIComponent(id)}`,
        search: searchAcrossPathChange(),
      });
    },
    [navigate, searchAcrossPathChange],
  );

  // sk-41 — viewer open/close. Reads the latest path + state through
  // refs (review TS-W6) — `navState` lives in urlStateRef so the
  // callbacks are stable across navigation and don't re-fire every
  // useMemo() consumer.
  const openAttachment = useCallback(
    (attachmentId: string) => {
      // HC-W8 — capture the trigger BEFORE navigation. closeAttachment
      // will refocus it if still in the DOM (split flow) or no-op
      // (single-pane flow where the row unmounts).
      const active = typeof document !== 'undefined' ? document.activeElement : null;
      attachmentTriggerRef.current =
        active instanceof HTMLElement ? active : null;

      const url = urlStateRef.current;
      // Functional update — `?tab=` / `?lens=` and anything else in the
      // address stay put, only `?file=` is written. URLSearchParams
      // handles encoding.
      const search = updateSearch(url.search, { [FILE_PARAM]: attachmentId });
      // Preserve every other piece of state and stamp
      // `selfOpenedFile = true` so Shell renders the
      // single-pane (viewer-replaces-card) layout.
      // sk-551.8 (P12) — an ordinary move: the one-shot reveal mark is
      // not inherited (`carryState`).
      const carried = carryState(url.navState);
      const prevState =
        typeof carried === 'object' && carried !== null
          ? (carried as Record<string, unknown>)
          : {};
      navigate(
        { pathname: url.pathname, search },
        { state: { ...prevState, selfOpenedFile: true } },
      );
    },
    [navigate],
  );

  const closeAttachment = useCallback(() => {
    const url = urlStateRef.current;
    if (!new URLSearchParams(url.search).has(FILE_PARAM)) return; // idempotent
    const search = updateSearch(url.search, { [FILE_PARAM]: null });
    // Strip only the `selfOpenedFile` marker — keep anything else, so a
    // context some other feature planted survives closing the viewer.
    let preservedState: Record<string, unknown> | null = null;
    const carried = carryState(url.navState);
    if (typeof carried === 'object' && carried !== null) {
      const copy = { ...(carried as Record<string, unknown>) };
      delete copy.selfOpenedFile;
      if (Object.keys(copy).length > 0) preservedState = copy;
    }
    navigate(
      { pathname: url.pathname, search },
      preservedState !== null ? { state: preservedState } : undefined,
    );

    // HC-W8 — restore focus to the original trigger after React has
    // flushed the resulting re-render. setTimeout(0) puts us after the
    // commit; we then check that the captured node is still in the
    // DOM (parentNode !== null) before focusing. Detached → skip.
    const trigger = attachmentTriggerRef.current;
    attachmentTriggerRef.current = null;
    if (trigger !== null) {
      setTimeout(() => {
        if (trigger.isConnected) trigger.focus();
      }, 0);
    }
  }, [navigate]);


  // ── sk-551.8 — the sections layout and the fold router (plan P1, P11–P13) ──
  //
  // The active layout is read through the OPTIONAL reader: this provider
  // is mounted bare (no AuthProvider / QueryClientProvider) by many unit
  // tests, and then the answer is `columns` — the side-by-side layout,
  // byte for byte as before (INV-1).
  //
  // The width is read at the moment of each event (`readWidthMode`), not
  // through `useWidthMode`: that hook also publishes `<html
  // data-width-mode>`, and this provider is mounted on /settings,
  // /activity and /search too, where the attribute stays the boot
  // script's (see the TABLET block of `Shell.tsx`).
  const navigationType = useNavigationType();

  const [navWidth, setNavWidthState] = useState<Readonly<Record<WorkspaceWidthMode, number>>>(
    () => ({ desktop: readNavWidth('desktop'), tablet: readNavWidth('tablet') }),
  );
  const [navSections, setNavSectionsState] = useState(readNavSections);
  const [navColumnCollapsed, setNavColumnCollapsedState] = useState<boolean>(readNavColumnCollapsed);
  const [navTemp, setNavTemp] = useState<NavFoldTemp | null>(null);
  // Synchronous mirrors, for the same reason as `collapsedNowRef`: two
  // events inside one handler must each see the other's result.
  const navSectionsRef = useRef(navSections);
  const navColumnCollapsedRef = useRef(navColumnCollapsed);
  const navTempRef = useRef<NavFoldTemp | null>(null);
  const navWorkspaceRef = useRef<NavWorkspaceRecord>(readNavWorkspace());
  // The deferred return (layer 1). A ref, never storage: a reload or the
  // shell shown again starts a new provider with `false`, which is
  // exactly how the spec says those end it.
  const navDeferredReturnRef = useRef(false);
  // The task view lives in `TasksUiStateProvider`, which sits INSIDE this
  // one; the shell reports it (`syncNavView`), and every dispatch updates
  // it. Gestures and queue events read it from here.
  const navViewRef = useRef<ViewMode>('cards');
  // Whether a SHARED file (layer 1) is the one currently open: set when
  // `fileOpened` is accepted, read by `fileClosed`. A file opened from a
  // card never starts layer 1 (US-11, "Scope").
  const navSharedFileRef = useRef(false);
  const navWidthRef = useRef<Readonly<Record<WorkspaceWidthMode, number>>>({
    desktop: 0,
    tablet: 0,
  });
  // P13 — the layout the person is choosing right now, in THIS provider.
  // A new provider (another page, the shell shown again) starts empty.
  const navModeGestureRef = useRef<{ to: NavLayout } | null>(null);

  // A shared file (layer 1): `?file=` that was not opened from a card.
  const sharedFileOpen = selectedAttachment !== null && !selfOpenedFile;
  const sharedFileOpenRef = useRef(sharedFileOpen);
  sharedFileOpenRef.current = sharedFileOpen;

  /** Write what the fold rules changed — and nothing else. */
  const applyNavResult = useCallback(
    (prev: NavFoldState, next: NavFoldState) => {
      // Sections column — its own keys only.
      const ps = prev.sections;
      const ns = next.sections;
      if (ns.columnCollapsed !== ps.columnCollapsed) {
        writeNavColumnCollapsed(ns.columnCollapsed);
        navColumnCollapsedRef.current = ns.columnCollapsed;
        setNavColumnCollapsedState(ns.columnCollapsed);
      }
      if (
        ns.sections.projects !== ps.sections.projects ||
        ns.sections.queues !== ps.sections.queues
      ) {
        const record = { split: navSectionsRef.current.split, collapsed: { ...ns.sections } };
        writeNavSections(record);
        navSectionsRef.current = record;
        setNavSectionsState(record);
      }
      if (ns.workspace.auto !== ps.workspace.auto || ns.workspace.optOut !== ps.workspace.optOut) {
        navWorkspaceRef.current = { ...ns.workspace };
        writeNavWorkspace(navWorkspaceRef.current);
      }
      // Side-by-side columns — only the two exceptions ever change them,
      // and they do it as the automation does (P2): no `noteManualFold`.
      for (const col of WORKSPACE_FOLDED_COLS) {
        if (next.columns.collapsed[col] !== prev.columns.collapsed[col]) {
          setFoldedColState(col, next.columns.collapsed[col]);
        }
      }
      const pw = prev.columns.workspace;
      const nw = next.columns.workspace;
      const workspaceChanged = WORKSPACE_FOLDED_COLS.some(
        (col) => pw.auto[col] !== nw.auto[col] || pw.optOut[col] !== nw.optOut[col],
      );
      if (workspaceChanged) {
        putWorkspaceRecord({ auto: { ...nw.auto }, optOut: { ...nw.optOut } });
      }
      if (next.hintSeen.sections && !prev.hintSeen.sections) writeNavHintSeen();
      if (next.hintSeen.columns && !prev.hintSeen.columns) writeBool(STORAGE_BOARD_HINT_SEEN, true);
    },
    [putWorkspaceRecord, setFoldedColState],
  );

  const dispatchNavEvent = useCallback(
    (event: NavFoldEvent, view: ViewMode): NavFoldEffects => {
      navViewRef.current = event.type === 'viewChanged' ? event.to : view;
      // Layer 1 belongs to a SHARED file only: an attachment opened from
      // a card is not one, so its open and close are not events here.
      if (event.type === 'fileOpened') {
        if (!sharedFileOpenRef.current) return {};
        navSharedFileRef.current = true;
      }
      if (event.type === 'fileClosed') {
        if (!navSharedFileRef.current) return {};
        navSharedFileRef.current = false;
      }
      const prev: NavFoldState = {
        sections: {
          columnCollapsed: navColumnCollapsedRef.current,
          sections: { ...navSectionsRef.current.collapsed },
          workspace: { ...navWorkspaceRef.current },
        },
        columns: {
          collapsed: { ...collapsedNowRef.current },
          workspace: {
            auto: { ...workspaceRecordRef.current.auto },
            optOut: { ...workspaceRecordRef.current.optOut },
          },
        },
        hintSeen: {
          sections: readNavHintSeen(),
          columns: readBool(STORAGE_BOARD_HINT_SEEN, false),
        },
      };
      const out = reduceNavFold(
        prev,
        {
          mode: navLayoutRef.current,
          width: readWidthMode(),
          view,
          layer1: {
            // `fileClosed` is reported once the address has already lost
            // `?file=`; the event happens to an OPEN shared file (checked
            // above), so that is the state it is reduced in (the deferred
            // return needs it).
            fileOpen: event.type === 'fileClosed' ? true : sharedFileOpenRef.current,
            deferredReturn: navDeferredReturnRef.current,
            temp: navTempRef.current,
          },
        },
        event,
      );
      applyNavResult(prev, out.state);
      navDeferredReturnRef.current = out.deferredReturn;
      const before = navTempRef.current;
      const tempChanged =
        (before === null) !== (out.temp === null) ||
        before?.columnCollapsed !== out.temp?.columnCollapsed ||
        before?.queuesCollapsed !== out.temp?.queuesCollapsed;
      if (tempChanged) {
        navTempRef.current = out.temp;
        setNavTemp(out.temp);
      }
      return out.effects;
    },
    [applyNavResult],
  );

  const syncNavView = useCallback((view: ViewMode) => {
    navViewRef.current = view;
  }, []);

  const reportNavGesture = useCallback(
    (gesture: NavGesture): NavFoldEffects => {
      if (navLayoutRef.current === 'sections') {
        return dispatchNavEvent(gesture, navViewRef.current);
      }
      // Side-by-side: the badge unfolds the Queues column, as it always
      // has; the sections column's own gestures do not exist here.
      if (
        gesture.type === 'gestureExpand' &&
        gesture.via === 'badge' &&
        collapsedNowRef.current.inbox
      ) {
        setInboxCollapsed(false);
      }
      return {};
    },
    [dispatchNavEvent, setInboxCollapsed],
  );

  const reportQueueFell = useCallback(() => {
    if (navLayoutRef.current === 'sections') {
      dispatchNavEvent({ type: 'queueFell' }, navViewRef.current);
      return;
    }
    setInboxCollapsed(true);
  }, [dispatchNavEvent, setInboxCollapsed]);

  const reportQueueRose = useCallback(() => {
    if (navLayoutRef.current !== 'sections') return;
    dispatchNavEvent({ type: 'queueRose' }, navViewRef.current);
  }, [dispatchNavEvent]);

  const toggleNavSection = useCallback(
    (section: NavFoldSection) => reportNavGesture({ type: 'chevron', section }),
    [reportNavGesture],
  );

  const setNavCollapsed = useCallback(
    (collapsed: boolean) =>
      reportNavGesture(
        collapsed ? { type: 'gestureCollapseColumn' } : { type: 'gestureExpand', via: 'strip' },
      ),
    [reportNavGesture],
  );

  navWidthRef.current = navWidth;
  const setNavWidth = useCallback((mode: WorkspaceWidthMode, w: number) => {
    if (!Number.isFinite(w)) return;
    const next = clamp(Math.round(w), NAV_COLUMN_BOUNDS.min, NAV_COLUMN_BOUNDS.max);
    if (navWidthRef.current[mode] === next) return;
    // The write lives outside the state updater: StrictMode calls an
    // updater twice, and a side effect has no business there.
    writeNavWidth(mode, next);
    navWidthRef.current = { ...navWidthRef.current, [mode]: next };
    setNavWidthState(navWidthRef.current);
  }, []);

  const setNavSplit = useCallback((split: number) => {
    // Layer 1: nothing is written while a shared file is shown.
    if (sharedFileOpenRef.current && readWidthMode() !== 'mobile') return;
    if (!Number.isFinite(split)) return;
    const next = clamp(split, NAV_SPLIT_BOUNDS.min, NAV_SPLIT_BOUNDS.max);
    if (navSectionsRef.current.split === next) return;
    const record = { split: next, collapsed: { ...navSectionsRef.current.collapsed } };
    writeNavSections(record);
    navSectionsRef.current = record;
    setNavSectionsState(record);
  }, []);

  const resetNavSplit = useCallback(() => setNavSplit(NAV_SPLIT_BOUNDS.default), [setNavSplit]);

  const noteNavModeGesture = useCallback((to: NavLayout) => {
    navModeGestureRef.current = { to };
  }, []);

  const takeNavModeSource = useCallback((value: NavLayout): NavModeSource => {
    const cell = navModeGestureRef.current;
    navModeGestureRef.current = null;
    return cell !== null && cell.to === value ? 'gesture' : 'profile';
  }, []);

  // P12 / P3 — the reveal by address. Only with the sections layout
  // active on desktop/tablet; with side-by-side active nothing is read,
  // consumed or written (`?tab=` stays the `rawTabParam` effect's, P4).
  //
  // Two questions, two lifetimes:
  //
  //   - the INITIAL LOAD (source a) is asked about the provider's first
  //     history entry only, while no move has happened yet, and it is
  //     decided by the person's FIRST KNOWN layout: the stored record the
  //     first render started from (INV-10), or — without one — the first
  //     profile answer, on that same entry. That first known layout being
  //     anything but `sections` on desktop/tablet burns the question; a
  //     later change of layout (a gesture, a profile after the first
  //     answer) never asks it — a switch to sections on a board is a mode
  //     change and folds (US-7), it is not a load by link. The first move
  //     to another entry burns it too: a POP back onto the first entry
  //     (Back/Forward) is not a load by link. Sections on a PHONE burns
  //     it: there nothing is written, and widening shows the stored view
  //     ("Scope");
  //   - a DELIBERATE MOVE (source b) is asked on every new entry that is
  //     reached while the sections layout is active; a layout switch on
  //     an entry already reached is not a move and does not ask it.
  //
  // Re-runs on the entry and on the active layout; the rest is read
  // through refs.
  const navHandledNoncesRef = useRef<Set<number>>(new Set());
  const navFirstEntryKeyRef = useRef(location.key);
  const navInitialOpenRef = useRef(true);
  const navLastEntryKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const newEntry = navLastEntryKeyRef.current !== location.key;
    navLastEntryKeyRef.current = location.key;
    if (location.key !== navFirstEntryKeyRef.current) navInitialOpenRef.current = false;
    if (navInitialOpenRef.current && navLayoutKnown) {
      // Decided now, by the first known layout — and only once. The
      // document's question is spent whatever the answer, so a later
      // provider on the same entry (the shell shown again after Back)
      // cannot ask it afresh.
      navInitialOpenRef.current = false;
      const loadedByLink = readInitialLoadIntent(location.key);
      if (navLayout === 'sections' && readWidthMode() !== 'mobile' && loadedByLink) {
        dispatchNavEvent({ type: 'addressReveal' }, navViewRef.current);
        return;
      }
    }
    if (navLayout !== 'sections' || readWidthMode() === 'mobile') return;
    if (!newEntry) return;
    if (!isIntentNavigation(location, navigationType, navHandledNoncesRef.current)) return;
    const nonce = readRevealNonce(location.state);
    if (nonce !== null) navHandledNoncesRef.current.add(nonce);
    dispatchNavEvent({ type: 'addressReveal' }, navViewRef.current);
    // The mark is one-shot: take it off the entry, keep the rest.
    navigate(
      { pathname: location.pathname, search: location.search },
      { replace: true, state: carryState(location.state) ?? undefined },
    );
  }, [location.key, navLayout, navLayoutKnown]);

  const value = useMemo<LayoutContextValue>(
    () => ({
      selectedProject,
      selectedSpace,
      selectedSpaceHandle,
      selectedIssue,
      selectedComponent,
      outboxMode,
      onMeMode,
      budilnikMode,
      unreviewedSelected,
      inboxCollapsed,
      inboxTab,
      activeZone,
      expandedProjectIds,
      spaceFoldChoices,
      projectsCollapsed,
      tasksCollapsed,
      taskFiltersCollapsed,
      colWidths,
      workspaceDetailsWidth,
      selectedAttachment,
      selfOpenedFile,
      navLayout,
      navWidth,
      navSplit: navSections.split,
      navSectionsCollapsed: navSections.collapsed,
      navColumnCollapsed,
      navTemp,
      setOutboxMode,
      toggleOutboxMode,
      setOnMeMode,
      toggleOnMeMode,
      setBudilnikMode,
      toggleBudilnikMode,
      setUnreviewedSelected,
      setInboxCollapsed,
      toggleInboxCollapsed,
      setInboxTab,
      setActiveZone,
      toggleProjectCollapsed,
      expandProject,
      setSpaceCollapsed,
      setProjectsCollapsed,
      toggleProjectsCollapsed,
      setTasksCollapsed,
      toggleTasksCollapsed,
      setTaskFiltersCollapsed,
      toggleTaskFiltersCollapsed,
      setColWidth,
      setWorkspaceDetailsWidth,
      enterWorkspaceView,
      leaveWorkspaceView,
      syncWorkspaceView,
      noteWorkspaceView,
      setSelectedProject,
      setSelectedSpace,
      setSelectedIssue,
      clearSelectedIssue,
      setSelectedComponent,
      selectInboxIssue,
      openAttachment,
      closeAttachment,
      setNavWidth,
      setNavSplit,
      resetNavSplit,
      toggleNavSection,
      setNavCollapsed,
      reportQueueFell,
      reportQueueRose,
      reportNavGesture,
      syncNavView,
      dispatchNavEvent,
      noteNavModeGesture,
      takeNavModeSource,
    }),
    [
      selectedProject,
      selectedSpace,
      selectedSpaceHandle,
      selectedIssue,
      selectedComponent,
      outboxMode,
      onMeMode,
      budilnikMode,
      unreviewedSelected,
      inboxCollapsed,
      inboxTab,
      activeZone,
      expandedProjectIds,
      spaceFoldChoices,
      projectsCollapsed,
      tasksCollapsed,
      taskFiltersCollapsed,
      colWidths,
      workspaceDetailsWidth,
      selectedAttachment,
      selfOpenedFile,
      navLayout,
      navWidth,
      navSections,
      navColumnCollapsed,
      navTemp,
      setOutboxMode,
      toggleOutboxMode,
      setOnMeMode,
      toggleOnMeMode,
      setBudilnikMode,
      toggleBudilnikMode,
      setUnreviewedSelected,
      setInboxCollapsed,
      toggleInboxCollapsed,
      setInboxTab,
      setActiveZone,
      toggleProjectCollapsed,
      expandProject,
      setSpaceCollapsed,
      setProjectsCollapsed,
      toggleProjectsCollapsed,
      setTasksCollapsed,
      toggleTasksCollapsed,
      setTaskFiltersCollapsed,
      toggleTaskFiltersCollapsed,
      setColWidth,
      setWorkspaceDetailsWidth,
      enterWorkspaceView,
      leaveWorkspaceView,
      syncWorkspaceView,
      noteWorkspaceView,
      setSelectedProject,
      setSelectedSpace,
      setSelectedIssue,
      clearSelectedIssue,
      setSelectedComponent,
      selectInboxIssue,
      openAttachment,
      closeAttachment,
      setNavWidth,
      setNavSplit,
      resetNavSplit,
      toggleNavSection,
      setNavCollapsed,
      reportQueueFell,
      reportQueueRose,
      reportNavGesture,
      syncNavView,
      dispatchNavEvent,
      noteNavModeGesture,
      takeNavModeSource,
    ],
  );

  return <LayoutContext.Provider value={value}>{children}</LayoutContext.Provider>;
}

export function useLayoutState(): LayoutContextValue {
  const ctx = useContext(LayoutContext);
  if (ctx === null) {
    throw new Error('useLayoutState must be used inside <LayoutProvider>');
  }
  return ctx;
}

/**
 * sk-41 — non-throwing variant for components that may be mounted
 * outside the new Shell (e.g. AttachmentList re-used from legacy
 * pages). Returns `null` when the provider is missing instead of
 * throwing.
 */
export function useOptionalLayoutState(): LayoutContextValue | null {
  return useContext(LayoutContext);
}
