/**
 * sk-551.8 — the fold rules of the left panel, as ONE pure function (plan
 * P1). The norm is the spec section "Fold events rule"; US-7, US-9,
 * US-10, US-11 and US-12 are its acceptances, and where they disagree the
 * section wins.
 *
 *     reduce(state, ctx, event) → { state, temp, deferredReturn, effects }
 *
 * No React, no storage: the layout provider (`useLayoutState.tsx`) reads
 * the stored values into `state`, calls this, writes the result back,
 * keeps `temp` in its state and `deferredReturn` in a ref, and applies the
 * effects (hint toast, focus).
 *
 * ── What this function owns ──────────────────────────────────────────
 *
 *   - Active SECTIONS layout, desktop/tablet: everything in the layer-2
 *     table — the sections column, its two sections, its opt-out and its
 *     auto-fold mark.
 *   - The two exceptions of the side-by-side layout (US-7): the return
 *     that also re-opens marked side-by-side columns while the sections
 *     layout is active (and drops their stale marks otherwise), and the
 *     switch to side-by-side on a board/tree folding its open columns.
 *   - Active SIDE-BY-SIDE layout: ONLY the sections column's mark — its
 *     return (immediate or deferred by a shared file) and its drop when
 *     the shell lands on cards otherwise. Every other side-by-side
 *     behaviour stays with the existing code (plan P2, INV-1); this
 *     function does not duplicate it, and so never touches the
 *     side-by-side record while that layout is active, except for the
 *     mode switch itself (exception 2).
 *
 * ── Layer 1 — the shared file ────────────────────────────────────────
 *
 * While a shared file is open on desktop/tablet nothing is written: the
 * gestures change only `temp`, the temporary picture (sections layout
 * only), and closing the file brings back the stored view. The DEFERRED
 * RETURN is a separate output field, not part of `temp`: `temp` is
 * dropped on close, and the flag must live until exactly that moment.
 * The provider passes it back in `ctx.layer1` on every call; a reload or
 * a fresh shell starts a new provider with `false`, which is how those
 * end it.
 *
 * `temp` is passed back the same way (`ctx.layer1.temp`) — a pure
 * function cannot otherwise accumulate two gestures made during one file.
 *
 * ── The phone ("Area") ────────────────────────────────────────────
 *
 * On a phone nothing is written by the sections rules, in either layout's
 * record, with one exception: when the shell lands on cards, stale marks
 * are dropped without opening anything — the sections column's always,
 * the side-by-side columns' only while sections is active. A shared file
 * does not start layer 1 on a phone.
 */
import type { ViewMode } from '../api/issues';
import type { NavLayout } from '../api/uiPrefs';
import type { WidthMode } from './useWidthMode';
import type { SpaceKind } from '../api/spaces';

export type NavFoldSection = 'projects' | 'queues';
export type SideColumn = 'inbox' | 'projects';

const SIDE_COLUMNS: readonly SideColumn[] = ['inbox', 'projects'];

/** The stored state of the SECTIONS column (spec INV-3: owned by that layout). */
export interface SectionsFoldState {
  /** The whole column is folded into its sliver. */
  columnCollapsed: boolean;
  /** Folded sections — only their header is left. */
  sections: Record<NavFoldSection, boolean>;
  /** `auto` — the board/tree folded it itself; `optOut` — «leave it alone». */
  workspace: { auto: boolean; optOut: boolean };
}

/** The stored state of the SIDE-BY-SIDE columns this function may touch. */
export interface ColumnsFoldState {
  collapsed: Record<SideColumn, boolean>;
  workspace: {
    auto: Record<SideColumn, boolean>;
    optOut: Record<SideColumn, boolean>;
  };
}

export interface NavFoldState {
  sections: SectionsFoldState;
  columns: ColumnsFoldState;
  /** Whether each layout's auto-fold hint was already shown in this browser. */
  hintSeen: { sections: boolean; columns: boolean };
}

/** The temporary picture of the sections column while a shared file is open. */
export interface NavFoldTemp {
  columnCollapsed: boolean;
  queuesCollapsed: boolean;
}

export interface NavFoldContext {
  /** The layout active when the event happens (`modeChanged` carries its own `to`). */
  mode: NavLayout;
  width: WidthMode;
  /** The task view at the moment of the event (`viewChanged` carries from/to). */
  view: ViewMode;
  layer1: {
    /** A shared file is open (`?file=` not opened from a card). */
    fileOpen: boolean;
    /** The return postponed by leaving the board while the file was open. */
    deferredReturn: boolean;
    /** The temporary picture as last returned, or `null`. */
    temp: NavFoldTemp | null;
  };
}

/** Why the shell is on cards without a return ("Ended up on cards otherwise"). */
export type LandedOnCardsCause = 'remount' | 'reload' | 'phone';

export type NavFoldEvent =
  | { type: 'viewChanged'; from: ViewMode; to: ViewMode; onShownShell: boolean }
  | { type: 'shellLandedOnCards'; cause: LandedOnCardsCause }
  | { type: 'modeChanged'; to: NavLayout; source: 'gesture' | 'profile' }
  | { type: 'widthCrossed'; to: WidthMode }
  | { type: 'gestureExpand'; via: 'strip' | 'badge' }
  | { type: 'gestureCollapseColumn' }
  | { type: 'chevron'; section: NavFoldSection }
  | { type: 'addressReveal' }
  | { type: 'queueFell' }
  | { type: 'queueRose' }
  | { type: 'fileOpened' }
  | { type: 'fileClosed' };

/**
 * Where focus goes if it was inside what just folded (US-3, US-6, US-11).
 * The consumer moves it only when focus actually was inside.
 */
export type NavFoldFocus = 'strip' | 'projectsChevron' | 'queuesChevron' | 'fileCollapseButton';

export interface NavFoldEffects {
  /** Show this layout's auto-fold hint (its `hintSeen` is already set in `state`). */
  hint?: NavLayout;
  focus?: NavFoldFocus;
}

export interface NavFoldResult {
  state: NavFoldState;
  temp: NavFoldTemp | null;
  deferredReturn: boolean;
  effects: NavFoldEffects;
}

function isWorkspaceView(view: ViewMode): boolean {
  return view === 'kanban' || view === 'tree';
}

function isWide(width: WidthMode): boolean {
  return width !== 'mobile';
}

/** A working copy; the input is never mutated. */
function cloneState(s: NavFoldState): NavFoldState {
  return {
    sections: {
      columnCollapsed: s.sections.columnCollapsed,
      sections: { ...s.sections.sections },
      workspace: { ...s.sections.workspace },
    },
    columns: {
      collapsed: { ...s.columns.collapsed },
      workspace: {
        auto: { ...s.columns.workspace.auto },
        optOut: { ...s.columns.workspace.optOut },
      },
    },
    hintSeen: { ...s.hintSeen },
  };
}

/** A fresh «everything the file needs is open» picture — never a shared object. */
function initialTemp(): NavFoldTemp {
  return { columnCollapsed: false, queuesCollapsed: false };
}

/**
 * The return: every MARKED column opens and loses its mark — the sections
 * column in either layout, the side-by-side columns only while sections is
 * active (exception 1; with side-by-side active they return the old way).
 */
function applyReturn(s: NavFoldState, mode: NavLayout): void {
  if (s.sections.workspace.auto) {
    s.sections.columnCollapsed = false;
    s.sections.workspace.auto = false;
  }
  if (mode !== 'sections') return;
  for (const col of SIDE_COLUMNS) {
    if (s.columns.workspace.auto[col]) {
      s.columns.collapsed[col] = false;
      s.columns.workspace.auto[col] = false;
    }
  }
}

/** Stale marks dropped WITHOUT opening anything (same split by layout). */
function dropMarks(s: NavFoldState, mode: NavLayout): void {
  s.sections.workspace.auto = false;
  if (mode !== 'sections') return;
  for (const col of SIDE_COLUMNS) s.columns.workspace.auto[col] = false;
}

/**
 * Auto-fold of the sections column: only an open column without an
 * opt-out, and only that column gets the mark.
 */
function autoFoldSections(s: NavFoldState, effects: NavFoldEffects): void {
  const sec = s.sections;
  if (sec.columnCollapsed || sec.workspace.optOut) return;
  sec.columnCollapsed = true;
  sec.workspace.auto = true;
  effects.focus = 'strip';
  if (!s.hintSeen.sections) {
    s.hintSeen.sections = true;
    effects.hint = 'sections';
  }
}

/** Exception 2: switching to side-by-side on a board/tree folds its open columns. */
function autoFoldColumns(s: NavFoldState, effects: NavFoldEffects): void {
  let folded = false;
  for (const col of SIDE_COLUMNS) {
    if (s.columns.collapsed[col] || s.columns.workspace.optOut[col]) continue;
    s.columns.collapsed[col] = true;
    s.columns.workspace.auto[col] = true;
    folded = true;
  }
  if (folded && !s.hintSeen.columns) {
    s.hintSeen.columns = true;
    effects.hint = 'columns';
  }
}

export function reduce(state: NavFoldState, ctx: NavFoldContext, event: NavFoldEvent): NavFoldResult {
  const s = cloneState(state);
  const effects: NavFoldEffects = {};
  const wide = isWide(ctx.width);
  const layer1 = ctx.layer1.fileOpen && wide;
  let deferredReturn = ctx.layer1.deferredReturn;
  let temp: NavFoldTemp | null = ctx.layer1.temp;
  // The layout active AFTER the event — only a mode switch changes it.
  let mode: NavLayout = ctx.mode;
  let width: WidthMode = ctx.width;
  let fileOpen = ctx.layer1.fileOpen;
  const sectionsHere = ctx.mode === 'sections' && wide;
  const tempNow = (): NavFoldTemp => temp ?? initialTemp();

  switch (event.type) {
    case 'viewChanged': {
      const fromWs = isWorkspaceView(event.from);
      const toWs = isWorkspaceView(event.to);
      if (fromWs === toWs) break; // cards → cards, board ↔ tree: nothing
      if (!toWs) {
        // Leaving the board/tree for cards.
        if (layer1 && event.onShownShell) {
          deferredReturn = true; // the return waits for the file to close
        } else if (wide && event.onShownShell) {
          // No file here (else layer 1): the flag is cleared by the
          // normalisation below.
          applyReturn(s, ctx.mode);
        } else {
          dropMarks(s, ctx.mode); // a phone, or a view changed off the shell
          deferredReturn = false;
        }
        break;
      }
      // Entering the board/tree from cards.
      if (layer1) {
        deferredReturn = false; // back on the board: the mark lives on
        break;
      }
      if (!sectionsHere || !event.onShownShell) break;
      if (s.sections.columnCollapsed) {
        s.sections.workspace.auto = false; // already a sliver: nothing to return
      } else {
        autoFoldSections(s, effects);
      }
      break;
    }

    case 'shellLandedOnCards': {
      dropMarks(s, ctx.mode);
      deferredReturn = false;
      break;
    }

    case 'modeChanged': {
      mode = event.to;
      if (layer1 || !wide) break; // layer 1 and the phone apply no auto-fold
      if (event.source !== 'gesture' || !isWorkspaceView(ctx.view)) break;
      if (event.to === 'sections') autoFoldSections(s, effects);
      else autoFoldColumns(s, effects);
      break;
    }

    case 'widthCrossed': {
      width = event.to;
      if (event.to !== 'mobile') break; // the stored view, nothing more
      // Narrowing to a phone ends the deferred return and acts by the view.
      if (ctx.layer1.fileOpen) {
        deferredReturn = false;
        if (!isWorkspaceView(ctx.view)) dropMarks(s, ctx.mode);
      }
      break;
    }

    case 'gestureExpand': {
      if (!sectionsHere) break;
      if (layer1) {
        // During the file the badge only selects the queue and scrolls it
        // (US-11, US-12) — the picture stays; the strip opens the column
        // in the temporary picture only.
        if (event.via === 'strip') temp = { ...tempNow(), columnCollapsed: false };
        break;
      }
      s.sections.columnCollapsed = false;
      if (event.via === 'badge') s.sections.sections.queues = false;
      if (isWorkspaceView(ctx.view)) s.sections.workspace.optOut = true;
      s.sections.workspace.auto = false;
      break;
    }

    case 'gestureCollapseColumn': {
      if (!sectionsHere) break;
      effects.focus = 'strip';
      if (layer1) {
        temp = { ...tempNow(), columnCollapsed: true };
        break;
      }
      s.sections.columnCollapsed = true;
      if (isWorkspaceView(ctx.view)) s.sections.workspace.optOut = false;
      s.sections.workspace.auto = false;
      break;
    }

    case 'chevron': {
      if (!sectionsHere) break;
      if (layer1) {
        // Projects is hidden while the file is shown; only Queues has a chevron.
        if (event.section !== 'queues') break;
        const folded = !tempNow().queuesCollapsed;
        temp = { ...tempNow(), queuesCollapsed: folded };
        if (folded) effects.focus = 'queuesChevron';
        break;
      }
      const folded = !s.sections.sections[event.section];
      s.sections.sections[event.section] = folded;
      if (folded) effects.focus = event.section === 'queues' ? 'queuesChevron' : 'projectsChevron';
      break;
    }

    case 'addressReveal': {
      if (!sectionsHere || layer1) break;
      s.sections.columnCollapsed = false;
      s.sections.sections.queues = false;
      break;
    }

    case 'queueFell': {
      if (!sectionsHere || layer1) break;
      if (!s.sections.sections.queues) {
        s.sections.sections.queues = true;
        effects.focus = 'queuesChevron';
      }
      break;
    }

    case 'queueRose':
      break;

    case 'fileOpened': {
      fileOpen = true;
      deferredReturn = false;
      if (!sectionsHere) break;
      temp = initialTemp();
      effects.focus = 'fileCollapseButton';
      break;
    }

    case 'fileClosed': {
      fileOpen = false;
      if (layer1 && deferredReturn && !isWorkspaceView(ctx.view)) applyReturn(s, ctx.mode);
      break; // the deferred return ends with the file — the normalisation below
    }
  }

  // The temporary picture exists only while a file is open, on desktop or
  // tablet, with the sections layout active; it starts as «everything the
  // file needs is open» whenever it comes into being.
  const tempLives = fileOpen && isWide(width) && mode === 'sections';
  if (!tempLives) temp = null;
  else if (temp === null) temp = initialTemp();
  // The deferred return lives only while a file is open.
  if (!fileOpen) deferredReturn = false;

  return { state: s, temp, deferredReturn, effects };
}

// ───────────────────────── Space rows of the Projects column ─────────────────────────

/**
 * sk-674.18 T051 — a person's EXPLICIT fold choice for one space row
 * (screens 1.1, K9). Only a click on the space's caret writes one; no
 * entry means «the default decides», so the default can keep moving with
 * the data (an untouched empty "Personal" opens by itself once its first
 * project appears) while a choice made by hand stays where it was left.
 */
export type SpaceFoldChoice = 'collapsed' | 'expanded';

/** What the space-fold rule reads off a space of `GET /me/spaces`. */
export interface SpaceFoldSubject {
  kind: SpaceKind;
  /** Projects of the space, archived included (`MySpace.projectCount`). */
  projectCount: number;
}

/**
 * The default fold of a space nobody has folded or opened by hand (K9):
 * an empty "Personal" is collapsed, every other space is open.
 */
export function spaceCollapsedByDefault(space: SpaceFoldSubject): boolean {
  return space.kind === 'personal' && space.projectCount === 0;
}

/**
 * Whether a space row is drawn collapsed.
 *
 * While the person searches the projects, a space that is shown at all
 * has matches (a space without them is hidden with its row), and a
 * collapsed space with matches opens for the time of the search — the
 * stored choice is neither consulted nor written, so clearing the search
 * brings back exactly what was stored (screens 1.1 "Project search").
 * Otherwise the explicit choice wins over the default.
 */
export function isSpaceCollapsed(
  space: SpaceFoldSubject,
  choice: SpaceFoldChoice | undefined,
  searching: boolean,
): boolean {
  if (searching) return false;
  if (choice !== undefined) return choice === 'collapsed';
  return spaceCollapsedByDefault(space);
}
