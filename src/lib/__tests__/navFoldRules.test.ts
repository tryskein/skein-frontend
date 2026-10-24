/**
 * sk-551.8 F1–F4 — the fold rules of the left panel (`navFoldRules.reduce`).
 *
 * Reference: spec "Fold events rule" (Scope, Concepts, layer 1,
 * layer 2, two "side by side" exceptions, hint) and the acceptances of US-7,
 * US-9, US-10, US-11, US-12, quoted per case. The expected values are
 * written from those sentences, not read off the function.
 *
 * The reducer owns the sections column and the two side-by-side
 * exceptions; the side-by-side columns' OWN automation (entering a board
 * with side-by-side active, its return while side-by-side is active) is
 * the existing code (plan P2). In a chain that passes through it, the
 * step is written as a `legacy` literal: the state that code is known to
 * produce, so the chain can continue — it is a precondition, not a
 * subject.
 */
import { describe, expect, it } from 'vitest';
import type { ViewMode } from '../../api/issues';
import type { NavLayout } from '../../api/uiPrefs';
import {
  reduce,
  type NavFoldEffects,
  type NavFoldEvent,
  type NavFoldState,
  type NavFoldTemp,
} from '../navFoldRules';
import type { WidthMode } from '../useWidthMode';

// ── Harness ─────────────────────────────────────────────────────────

interface World {
  mode: NavLayout;
  width: WidthMode;
  view: ViewMode;
  fileOpen: boolean;
}

/** Everything expanded, no marks, no opt-outs, no hint shown. */
function fresh(): NavFoldState {
  return {
    sections: {
      columnCollapsed: false,
      sections: { projects: false, queues: false },
      workspace: { auto: false, optOut: false },
    },
    columns: {
      collapsed: { inbox: false, projects: false },
      workspace: { auto: { inbox: false, projects: false }, optOut: { inbox: false, projects: false } },
    },
    hintSeen: { sections: false, columns: false },
  };
}

type Patch = (s: NavFoldState) => void;

function make(...patches: Patch[]): NavFoldState {
  const s = fresh();
  for (const p of patches) p(s);
  return s;
}

/** The sections column folded into its sliver by the board (marked). */
const sectionsAutoFolded: Patch = (s) => {
  s.sections.columnCollapsed = true;
  s.sections.workspace.auto = true;
};
/** Both side-by-side columns folded by the board (marked). */
const columnsAutoFolded: Patch = (s) => {
  s.columns.collapsed = { inbox: true, projects: true };
  s.columns.workspace.auto = { inbox: true, projects: true };
};

type Step =
  | NavFoldEvent
  /** A new provider: reload or the shell shown again — memory is gone. */
  | { type: 'newProvider' }
  /** What the existing side-by-side code does at this point (plan P2). */
  | { type: 'legacy'; apply: Patch };

interface Run {
  state: NavFoldState;
  world: World;
  deferredReturn: boolean;
  temp: NavFoldTemp | null;
  effects: NavFoldEffects[];
}

function run(
  state: NavFoldState,
  world: World,
  steps: Step[],
  memory: { deferredReturn: boolean; temp: NavFoldTemp | null } = { deferredReturn: false, temp: null },
): Run {
  let s = state;
  const w = { ...world };
  let deferredReturn = memory.deferredReturn;
  let temp: NavFoldTemp | null = memory.temp;
  const effects: NavFoldEffects[] = [];
  for (const step of steps) {
    if (step.type === 'newProvider') {
      deferredReturn = false;
      temp = null;
      continue;
    }
    if (step.type === 'legacy') {
      s = structuredClone(s);
      step.apply(s);
      continue;
    }
    const out = reduce(
      s,
      { mode: w.mode, width: w.width, view: w.view, layer1: { fileOpen: w.fileOpen, deferredReturn, temp } },
      step,
    );
    s = out.state;
    deferredReturn = out.deferredReturn;
    temp = out.temp;
    effects.push(out.effects);
    if (step.type === 'viewChanged') w.view = step.to;
    if (step.type === 'modeChanged') w.mode = step.to;
    if (step.type === 'widthCrossed') w.width = step.to;
    if (step.type === 'fileOpened') w.fileOpen = true;
    if (step.type === 'fileClosed') w.fileOpen = false;
  }
  return { state: s, world: w, deferredReturn, temp, effects };
}

/** Continue a chain in the same provider: its memory (deferred return, temp) carries over. */
function cont(r: Run, steps: Step[]): Run {
  return run(r.state, r.world, steps, r);
}

const desktop = (mode: NavLayout, view: ViewMode, extra: Partial<World> = {}): World => ({
  mode,
  width: 'desktop',
  view,
  fileOpen: false,
  ...extra,
});

const toBoard: NavFoldEvent = { type: 'viewChanged', from: 'cards', to: 'kanban', onShownShell: true };
const toCards: NavFoldEvent = { type: 'viewChanged', from: 'kanban', to: 'cards', onShownShell: true };
const toSections: NavFoldEvent = { type: 'modeChanged', to: 'sections', source: 'gesture' };
const toColumns: NavFoldEvent = { type: 'modeChanged', to: 'columns', source: 'gesture' };

// ── F1 — layer 2 and US-7 ───────────────────────────────────────────

describe('F1 · US-7 chains', () => {
  it('forward: side by side → board → sections → cards → side by side — everything is expanded', () => {
    const r = run(fresh(), desktop('columns', 'cards'), [
      toBoard,
      { type: 'legacy', apply: columnsAutoFolded },
      toSections,
    ]);
    // "sections mode is on (sections column in the strip)"
    expect(r.state.sections.columnCollapsed).toBe(true);
    expect(r.state.sections.workspace.auto).toBe(true);

    const end = cont(r, [toCards, toColumns]);
    // "cards (the sections column and both side-by-side columns came back expanded)"
    expect(end.state.sections).toMatchObject({ columnCollapsed: false, workspace: { auto: false } });
    expect(end.state.columns.collapsed).toEqual({ inbox: false, projects: false });
    expect(end.state.columns.workspace.auto).toEqual({ inbox: false, projects: false });
  });

  it('backward: sections → board → side by side → cards → sections — the column is expanded', () => {
    const r = run(fresh(), desktop('sections', 'cards'), [toBoard, toColumns]);
    // "side-by-side mode is on (both columns in strips)"
    expect(r.state.columns.collapsed).toEqual({ inbox: true, projects: true });
    expect(r.state.columns.workspace.auto).toEqual({ inbox: true, projects: true });
    expect(r.state.sections.columnCollapsed).toBe(true);

    const back = cont(r, [toCards]);
    // the sections column returns; the side-by-side columns are the old code's job
    expect(back.state.sections).toMatchObject({ columnCollapsed: false, workspace: { auto: false } });
    expect(back.state.columns).toEqual(r.state.columns);

    const end = cont(back, [
      {
        type: 'legacy',
        apply: (s) => {
          s.columns.collapsed = { inbox: false, projects: false };
          s.columns.workspace.auto = { inbox: false, projects: false };
        },
      },
      toSections,
    ]);
    expect(end.state.sections.columnCollapsed).toBe(false);
  });

  it('mixed: sections on the board → side by side → phone, cards → wider: no sections mark, the file later does not expand', () => {
    const r = run(make(sectionsAutoFolded), desktop('sections', 'kanban'), [
      toColumns,
      { type: 'widthCrossed', to: 'mobile' },
      toCards,
      { type: 'widthCrossed', to: 'desktop' },
      { type: 'fileOpened' },
      { type: 'fileClosed' },
    ]);
    expect(r.state.sections).toMatchObject({ columnCollapsed: true, workspace: { auto: false } });
  });

  it('the human folded "Projects": switching to "side by side" on the board folds only "Queues"', () => {
    const humanFoldedProjects: Patch = (s) => {
      s.columns.collapsed.projects = true;
    };
    const r = run(make(humanFoldedProjects), desktop('sections', 'cards'), [toBoard, toColumns]);
    expect(r.state.columns.collapsed).toEqual({ inbox: true, projects: true });
    expect(r.state.columns.workspace.auto).toEqual({ inbox: true, projects: false });
  });

  it('two mode switches in a row on one board and leaving — everything the automation folded is expanded', () => {
    const r = run(fresh(), desktop('columns', 'cards'), [
      toBoard,
      { type: 'legacy', apply: columnsAutoFolded },
      toSections,
      toColumns,
      toSections,
    ]);
    // "marks are not removed by a mode switch"
    expect(r.state.sections.workspace.auto).toBe(true);
    expect(r.state.columns.workspace.auto).toEqual({ inbox: true, projects: true });

    const end = cont(r, [toCards]);
    expect(end.state.sections.columnCollapsed).toBe(false);
    expect(end.state.columns.collapsed).toEqual({ inbox: false, projects: false });
    expect(end.state.sections.workspace.auto).toBe(false);
    expect(end.state.columns.workspace.auto).toEqual({ inbox: false, projects: false });
  });

  it('?tab= expanded the column on the board, the human folded it, left for cards — it stays folded', () => {
    const r = run(make(sectionsAutoFolded), desktop('sections', 'kanban'), [
      { type: 'addressReveal' },
      { type: 'gestureCollapseColumn' },
      toCards,
    ]);
    expect(r.state.sections.columnCollapsed).toBe(true);
    expect(r.state.sections.workspace.auto).toBe(false);
  });
});

describe('F1 · layer-2 rows, sections active on desktop', () => {
  it.each<{
    name: string;
    view: ViewMode;
    start: Patch[];
    event: NavFoldEvent;
    expected: Partial<{ columnCollapsed: boolean; auto: boolean; optOut: boolean; queues: boolean }>;
  }>([
    {
      name: 'cards → board: expanded without refusal → strip with a mark',
      view: 'cards',
      start: [],
      event: toBoard,
      expected: { columnCollapsed: true, auto: true, optOut: false },
    },
    {
      name: 'cards → board with refusal: not folded and not marked',
      view: 'cards',
      start: [(s) => (s.sections.workspace.optOut = true)],
      event: toBoard,
      expected: { columnCollapsed: false, auto: false, optOut: true },
    },
    {
      name: 'cards → board, column already in a strip: the mark is removed',
      view: 'cards',
      start: [sectionsAutoFolded],
      event: toBoard,
      expected: { columnCollapsed: true, auto: false },
    },
    {
      name: 'cards → tree — the same as board',
      view: 'cards',
      start: [],
      event: { type: 'viewChanged', from: 'cards', to: 'tree', onShownShell: true },
      expected: { columnCollapsed: true, auto: true },
    },
    {
      name: 'board ↔ tree: nothing',
      view: 'kanban',
      start: [],
      event: { type: 'viewChanged', from: 'kanban', to: 'tree', onShownShell: true },
      expected: { columnCollapsed: false, auto: false },
    },
    {
      name: '"expand" gesture by the strip on the board: expanded, refusal is set, mark is removed',
      view: 'kanban',
      start: [sectionsAutoFolded],
      event: { type: 'gestureExpand', via: 'strip' },
      expected: { columnCollapsed: false, auto: false, optOut: true },
    },
    {
      name: '"expand" gesture by the badge on the board: column and Queues expanded, refusal is set',
      view: 'kanban',
      start: [sectionsAutoFolded, (s) => (s.sections.sections.queues = true)],
      event: { type: 'gestureExpand', via: 'badge' },
      expected: { columnCollapsed: false, queues: false, auto: false, optOut: true },
    },
    {
      name: '"Collapse column" on the board: strip, refusal is removed, no mark',
      view: 'kanban',
      start: [(s) => (s.sections.workspace.optOut = true)],
      event: { type: 'gestureCollapseColumn' },
      expected: { columnCollapsed: true, auto: false, optOut: false },
    },
    {
      name: 'reveal by address: column and Queues expanded, no refusal, mark is not removed',
      view: 'kanban',
      start: [sectionsAutoFolded, (s) => (s.sections.sections.queues = true)],
      event: { type: 'addressReveal' },
      expected: { columnCollapsed: false, queues: false, auto: true, optOut: false },
    },
    {
      name: 'late profile turned sections on on the board: saved view, no auto-fold',
      view: 'kanban',
      start: [],
      event: { type: 'modeChanged', to: 'sections', source: 'profile' },
      expected: { columnCollapsed: false, auto: false },
    },
    {
      name: 'mode switch to sections on cards: saved view',
      view: 'cards',
      start: [],
      event: toSections,
      expected: { columnCollapsed: false, auto: false },
    },
    {
      name: 'crossing the width threshold on the board: does not fold',
      view: 'kanban',
      start: [],
      event: { type: 'widthCrossed', to: 'tablet' },
      expected: { columnCollapsed: false, auto: false },
    },
  ])('$name', ({ view, start, event, expected }) => {
    const r = run(make(...start), desktop('sections', view), [event]);
    const sec = r.state.sections;
    const actual = {
      columnCollapsed: sec.columnCollapsed,
      auto: sec.workspace.auto,
      optOut: sec.workspace.optOut,
      queues: sec.sections.queues,
    };
    expect(actual).toMatchObject(expected);
    // Every row is about the sections column: the side-by-side record is untouched.
    expect(r.state.columns).toEqual(fresh().columns);
  });

  it('mode switch to sections on the board: expanded without refusal → strip with a mark', () => {
    const r = run(fresh(), desktop('columns', 'kanban'), [toSections]);
    expect(r.state.sections).toMatchObject({ columnCollapsed: true, workspace: { auto: true } });
  });
});

describe('F1 · two side-by-side exceptions', () => {
  it('returning with active sections expands the marked "side by side" columns', () => {
    const r = run(make(columnsAutoFolded), desktop('sections', 'kanban'), [toCards]);
    expect(r.state.columns.collapsed).toEqual({ inbox: false, projects: false });
    expect(r.state.columns.workspace.auto).toEqual({ inbox: false, projects: false });
  });

  it('switching to "side by side" on the board folds the expanded ones without refusal and does not touch the one protected by refusal', () => {
    const r = run(
      make((s) => (s.columns.workspace.optOut.projects = true)),
      desktop('sections', 'kanban'),
      [toColumns],
    );
    expect(r.state.columns.collapsed).toEqual({ inbox: true, projects: false });
    expect(r.state.columns.workspace.auto).toEqual({ inbox: true, projects: false });
  });

  it('with "side by side" active, leaving the board does not touch the "side by side" columns (the previous code drives them)', () => {
    const start = make(columnsAutoFolded, sectionsAutoFolded);
    const r = run(start, desktop('columns', 'kanban'), [toCards]);
    expect(r.state.columns).toEqual(start.columns);
    expect(r.state.sections).toMatchObject({ columnCollapsed: false, workspace: { auto: false } });
  });

  it('the sections refusal is written to the sections record, not to the "side by side" record', () => {
    const r = run(make(sectionsAutoFolded), desktop('sections', 'kanban'), [
      { type: 'gestureExpand', via: 'strip' },
    ]);
    expect(r.state.sections.workspace.optOut).toBe(true);
    expect(r.state.columns.workspace.optOut).toEqual({ inbox: false, projects: false });
  });
});

describe('F1 · the auto-fold hint', () => {
  it('sections: the first auto-fold shows the hint, even if the "side by side" hint already was; the second time — no', () => {
    const r = run(
      make((s) => (s.hintSeen.columns = true)),
      desktop('sections', 'cards'),
      [toBoard, toCards, toBoard],
    );
    expect(r.effects[0].hint).toBe('sections');
    expect(r.effects[2].hint).toBeUndefined();
    expect(r.state.hintSeen.sections).toBe(true);
  });

  it('"side by side": a mode switch on the board shows its own hint by its own flag', () => {
    const first = run(make((s) => (s.hintSeen.sections = true)), desktop('sections', 'kanban'), [toColumns]);
    expect(first.effects[0].hint).toBe('columns');
    const again = run(make((s) => (s.hintSeen.columns = true)), desktop('sections', 'kanban'), [toColumns]);
    expect(again.effects[0].hint).toBeUndefined();
  });
});

// ── F2 — US-10 (Q32) ────────────────────────────────────────────────

describe('F2 · US-10, the queue fell to zero', () => {
  it.each<{ name: string; view: ViewMode; start: Patch[] }>([
    { name: 'on cards, Projects expanded', view: 'cards', start: [] },
    {
      name: 'on the board with refusal, Projects folded',
      view: 'kanban',
      start: [(s) => (s.sections.workspace.optOut = true), (s) => (s.sections.sections.projects = true)],
    },
  ])('$name: only the "Queues" section is folded', ({ view, start }) => {
    const before = make(...start);
    const r = run(before, desktop('sections', view), [{ type: 'queueFell' }]);
    expect(r.state.sections.sections.queues).toBe(true);
    expect(r.state.sections.sections.projects).toBe(before.sections.sections.projects);
    expect(r.state.sections.columnCollapsed).toBe(before.sections.columnCollapsed);
    expect(r.state.sections.workspace).toEqual(before.sections.workspace);
    expect(r.state.columns).toEqual(before.columns);
  });

  it('after the drop a card arrived — the section stays folded', () => {
    const r = run(fresh(), desktop('sections', 'cards'), [{ type: 'queueFell' }, { type: 'queueRose' }]);
    expect(r.state.sections.sections.queues).toBe(true);
  });

  it('the human expanded the section at zero — it holds until a new drop happens', () => {
    const held = run(fresh(), desktop('sections', 'cards'), [
      { type: 'queueFell' },
      { type: 'chevron', section: 'queues' },
      { type: 'queueRose' },
    ]);
    expect(held.state.sections.sections.queues).toBe(false);
    const fellAgain = cont(held, [{ type: 'queueFell' }]);
    expect(fellAgain.state.sections.sections.queues).toBe(true);
  });

  it.each<{ name: string; world: World }>([
    { name: 'during the shared file', world: desktop('sections', 'cards', { fileOpen: true }) },
    { name: 'on the phone', world: { mode: 'sections', width: 'mobile', view: 'cards', fileOpen: false } },
  ])('$name the drop writes nothing', ({ world }) => {
    const r = run(fresh(), world, [{ type: 'queueFell' }]);
    expect(r.state).toEqual(fresh());
  });
});

// ── F3 — US-11, layer 1 ─────────────────────────────────────────────

const fileOpened: NavFoldEvent = { type: 'fileOpened' };
const fileClosed: NavFoldEvent = { type: 'fileClosed' };

describe('F3 · US-11 chains', () => {
  it('both folded sections are saved: the file shows Queues expanded, after closing both are folded again', () => {
    const start = make((s) => (s.sections.sections = { projects: true, queues: true }));
    const open = run(start, desktop('sections', 'cards'), [fileOpened]);
    expect(open.temp).toEqual({ columnCollapsed: false, queuesCollapsed: false });
    expect(open.effects[0].focus).toBe('fileCollapseButton');
    const closed = cont(open, [fileClosed]);
    expect(closed.temp).toBeNull();
    expect(closed.state.sections.sections).toEqual({ projects: true, queues: true });
  });

  it('board, refusal, file: badge, "Collapse column", drop, closing — the refusal is in place, Queues in the saved view', () => {
    const start = make((s) => (s.sections.workspace.optOut = true));
    const r = run(start, desktop('sections', 'kanban'), [
      fileOpened,
      { type: 'gestureExpand', via: 'badge' },
      { type: 'gestureCollapseColumn' },
      { type: 'queueFell' },
    ]);
    expect(r.state).toEqual(start);
    expect(r.temp).toEqual({ columnCollapsed: true, queuesCollapsed: false });
    const closed = cont(r, [fileClosed]);
    expect(closed.state).toEqual(start);
  });

  it('during the file a view and mode switch apply no auto-fold and write nothing', () => {
    const r = run(fresh(), desktop('sections', 'cards'), [fileOpened, toBoard, toColumns, toSections]);
    expect(r.state).toEqual(fresh());
  });

  it('"side by side", board, file; sections on, file closed, leaving for cards — saved view, no mark', () => {
    const r = run(fresh(), desktop('columns', 'kanban'), [fileOpened, toSections, fileClosed, toCards]);
    expect(r.state.sections).toEqual(fresh().sections);
  });

  it('board, strip (auto-fold), file; cards, closing — the column is expanded', () => {
    const left = run(make(sectionsAutoFolded), desktop('sections', 'kanban'), [fileOpened, toCards]);
    expect(left.deferredReturn).toBe(true);
    expect(left.state.sections.columnCollapsed).toBe(true);
    const closed = cont(left, [fileClosed]);
    // the harness re-feeds deferredReturn; the closing call must see it
    expect(closed.state.sections).toMatchObject({ columnCollapsed: false, workspace: { auto: false } });
    expect(closed.deferredReturn).toBe(false);
  });

  it('same, the deferred return survives closing the file, although the temporary picture disappears on closing', () => {
    const start = make(sectionsAutoFolded);
    const ctx = { mode: 'sections' as const, width: 'desktop' as const };
    const opened = reduce(start, { ...ctx, view: 'kanban', layer1: { fileOpen: true, deferredReturn: false, temp: null } }, fileOpened);
    const left = reduce(opened.state, { ...ctx, view: 'kanban', layer1: { fileOpen: true, deferredReturn: opened.deferredReturn, temp: opened.temp } }, toCards);
    expect(left.deferredReturn).toBe(true);
    const closed = reduce(left.state, { ...ctx, view: 'cards', layer1: { fileOpen: true, deferredReturn: left.deferredReturn, temp: null } }, fileClosed);
    expect(closed.state.sections.columnCollapsed).toBe(false);
  });

  it('board, strip, file, cards; settings → "Back" to an address with a file — the return is finished, closing does not expand', () => {
    const r = run(make(sectionsAutoFolded), desktop('sections', 'kanban'), [
      fileOpened,
      toCards,
      { type: 'newProvider' },
      { type: 'shellLandedOnCards', cause: 'remount' },
    ]);
    expect(r.deferredReturn).toBe(false);
    expect(r.state.sections).toMatchObject({ columnCollapsed: true, workspace: { auto: false } });
    const closed = cont(r, [fileClosed]);
    expect(closed.state.sections.columnCollapsed).toBe(true);
  });

  it('board, strip, file; refresh on the board — the mark is alive; closing and leaving for cards expand', () => {
    const r = run(make(sectionsAutoFolded), desktop('sections', 'kanban'), [
      fileOpened,
      { type: 'newProvider' },
    ]);
    expect(r.state.sections.workspace.auto).toBe(true);
    const end = cont(r, [fileClosed, toCards]);
    expect(end.state.sections).toMatchObject({ columnCollapsed: false, workspace: { auto: false } });
  });

  it('same, but before closing cards and a refresh — strip, no mark; the next entry to the board and leaving do not expand', () => {
    const r = run(make(sectionsAutoFolded), desktop('sections', 'kanban'), [
      fileOpened,
      toCards,
      { type: 'newProvider' },
      { type: 'shellLandedOnCards', cause: 'reload' },
      fileClosed,
    ]);
    expect(r.state.sections).toMatchObject({ columnCollapsed: true, workspace: { auto: false } });
    const next = cont(r, [toBoard, toCards]);
    expect(next.state.sections.columnCollapsed).toBe(true);
  });

  it('board, strip, file; cards, board again, closing — strip, the mark is alive, leaving expands', () => {
    const r = run(make(sectionsAutoFolded), desktop('sections', 'kanban'), [
      fileOpened,
      toCards,
      toBoard,
    ]);
    expect(r.deferredReturn).toBe(false);
    const closed = cont(r, [fileClosed]);
    expect(closed.state.sections).toMatchObject({ columnCollapsed: true, workspace: { auto: true } });
    const end = cont(closed, [toCards]);
    expect(end.state.sections.columnCollapsed).toBe(false);
  });

  it('sections, board, strip; "side by side" on, file, cards, closing — the sections column is expanded, the mark is removed', () => {
    const r = run(make(sectionsAutoFolded), desktop('sections', 'kanban'), [
      toColumns,
      fileOpened,
      toCards,
    ]);
    expect(r.deferredReturn).toBe(true);
    expect(r.state.sections.columnCollapsed).toBe(true);
    const closed = cont(r, [fileClosed]);
    expect(closed.state.sections).toMatchObject({ columnCollapsed: false, workspace: { auto: false } });
  });

  it('same, but the board again before closing — after closing the mark is alive, the next leaving expands', () => {
    const r = run(make(sectionsAutoFolded), desktop('sections', 'kanban'), [
      toColumns,
      fileOpened,
      toCards,
      toBoard,
      fileClosed,
    ]);
    expect(r.state.sections).toMatchObject({ columnCollapsed: true, workspace: { auto: true } });
    const end = cont(r, [toCards]);
    expect(end.state.sections.columnCollapsed).toBe(false);
  });

  it('closing on cards with active sections also expands the marked "side by side" columns', () => {
    const r = run(make(columnsAutoFolded, sectionsAutoFolded), desktop('sections', 'kanban'), [
      fileOpened,
      toCards,
      fileClosed,
    ]);
    expect(r.state.columns.collapsed).toEqual({ inbox: false, projects: false });
    expect(r.state.columns.workspace.auto).toEqual({ inbox: false, projects: false });
    expect(r.state.sections.columnCollapsed).toBe(false);
  });

  it('narrowing to a phone during the file on cards cancels the return, marks are removed without expanding', () => {
    const r = run(make(sectionsAutoFolded), desktop('sections', 'kanban'), [
      fileOpened,
      toCards,
      { type: 'widthCrossed', to: 'mobile' },
    ]);
    expect(r.deferredReturn).toBe(false);
    expect(r.state.sections).toMatchObject({ columnCollapsed: true, workspace: { auto: false } });
  });

  it('closing the file on the board does not apply the auto-fold', () => {
    const r = run(fresh(), desktop('sections', 'cards'), [fileOpened, toBoard, fileClosed]);
    expect(r.state.sections.columnCollapsed).toBe(false);
    expect(r.state.sections.workspace.auto).toBe(false);
  });
});

// ── F4 — "Scope", US-9, US-12 on the phone ─────────────────────────

const phone = (mode: NavLayout, view: ViewMode): World => ({ mode, width: 'mobile', view, fileOpen: false });

describe('F4 · the phone writes nothing', () => {
  it.each<{ name: string; view: ViewMode; event: NavFoldEvent }>([
    { name: 'queue drop', view: 'cards', event: { type: 'queueFell' } },
    { name: 'entry to the board', view: 'cards', event: toBoard },
    { name: 'mode switch to "side by side" on the board', view: 'kanban', event: toColumns },
    { name: 'queue total button', view: 'kanban', event: { type: 'gestureExpand', via: 'badge' } },
    { name: '"Collapse column"', view: 'kanban', event: { type: 'gestureCollapseColumn' } },
    { name: 'reveal by address', view: 'kanban', event: { type: 'addressReveal' } },
  ])('sections mode: $name — neither sections values nor "side by side" values', ({ view, event }) => {
    const start = make((s) => (s.columns.collapsed.inbox = true), sectionsAutoFolded);
    const r = run(start, phone('sections', view), [event]);
    expect(r.state).toEqual(start);
  });

  it('sections mode: ended up on cards — marks of both modes are removed without expanding', () => {
    const r = run(make(sectionsAutoFolded, columnsAutoFolded), phone('sections', 'kanban'), [toCards]);
    expect(r.state.sections).toMatchObject({ columnCollapsed: true, workspace: { auto: false } });
    expect(r.state.columns.collapsed).toEqual({ inbox: true, projects: true });
    expect(r.state.columns.workspace.auto).toEqual({ inbox: false, projects: false });
  });

  it('"side by side" mode: ended up on cards — the sections mark is removed, "side by side" columns are untouched', () => {
    const start = make(sectionsAutoFolded, columnsAutoFolded);
    const r = run(start, phone('columns', 'kanban'), [toCards]);
    expect(r.state.sections.workspace.auto).toBe(false);
    expect(r.state.sections.columnCollapsed).toBe(true);
    expect(r.state.columns).toEqual(start.columns);
  });

  it('US-12: phone, board, "Queues" "side by side" folded; total button, wider, switch to "side by side" by a late profile — folded, no refusal', () => {
    const start = make((s) => (s.columns.collapsed.inbox = true));
    const r = run(start, phone('sections', 'kanban'), [
      { type: 'gestureExpand', via: 'badge' },
      { type: 'widthCrossed', to: 'desktop' },
      { type: 'modeChanged', to: 'columns', source: 'profile' },
    ]);
    expect(r.state.columns.collapsed.inbox).toBe(true);
    expect(r.state.columns.workspace.optOut).toEqual({ inbox: false, projects: false });
    expect(r.state.sections).toEqual(start.sections);
  });
});

describe('F4 · what does not fold', () => {
  it.each<{ name: string; event: NavFoldEvent }>([
    { name: 'late profile turned sections on on the board', event: { type: 'modeChanged', to: 'sections', source: 'profile' } },
    { name: 'late profile turned "side by side" on on the board', event: { type: 'modeChanged', to: 'columns', source: 'profile' } },
    { name: 'crossing the width threshold', event: { type: 'widthCrossed', to: 'tablet' } },
  ])('$name — nothing is folded', ({ event }) => {
    const r = run(fresh(), desktop('sections', 'kanban'), [event]);
    expect(r.state.sections.columnCollapsed).toBe(false);
    expect(r.state.columns.collapsed).toEqual({ inbox: false, projects: false });
  });

  it('a reload on the board does not remove the mark: in a new provider leaving for cards expands the column', () => {
    // A reload on the board sends no event (the shell is not on cards);
    // what it must not do is lose the mark — the next return proves it.
    const r = run(make(sectionsAutoFolded), desktop('sections', 'kanban'), [{ type: 'newProvider' }, toCards]);
    expect(r.state.sections).toMatchObject({ columnCollapsed: false, workspace: { auto: false } });
  });
});

// ── Mutation follow-up: spec statements the chains above left unasserted ──

describe('F1 · gestures off the board and section chevrons', () => {
  it('the "expand" gesture on cards sets no refusal; "Collapse column" on cards does not remove the refusal', () => {
    const expanded = run(make((s) => (s.sections.columnCollapsed = true)), desktop('sections', 'cards'), [
      { type: 'gestureExpand', via: 'strip' },
    ]);
    expect(expanded.state.sections.workspace.optOut).toBe(false);
    const folded = run(make((s) => (s.sections.workspace.optOut = true)), desktop('sections', 'cards'), [
      { type: 'gestureCollapseColumn' },
    ]);
    expect(folded.state.sections.workspace.optOut).toBe(true);
  });

  it('a click on the strip expands the column, sections in the remembered view (folded Queues stay folded)', () => {
    const r = run(
      make((s) => (s.sections.columnCollapsed = true), (s) => (s.sections.sections.queues = true)),
      desktop('sections', 'kanban'),
      [{ type: 'gestureExpand', via: 'strip' }],
    );
    expect(r.state.sections.columnCollapsed).toBe(false);
    expect(r.state.sections.sections.queues).toBe(true);
  });

  it.each<{ section: 'projects' | 'queues'; focus: string }>([
    { section: 'projects', focus: 'projectsChevron' },
    { section: 'queues', focus: 'queuesChevron' },
  ])('the $section chevron folds only its own section, focus on its chevron; expands again', ({ section, focus }) => {
    const r = run(fresh(), desktop('sections', 'kanban'), [{ type: 'chevron', section }]);
    expect(r.state.sections.sections[section]).toBe(true);
    const other = section === 'projects' ? 'queues' : 'projects';
    expect(r.state.sections.sections[other]).toBe(false);
    expect(r.state.sections.columnCollapsed).toBe(false);
    expect(r.effects[0].focus).toBe(focus);
    const again = cont(r, [{ type: 'chevron', section }]);
    expect(again.state.sections.sections[section]).toBe(false);
    expect(again.effects[0].focus).toBeUndefined();
  });

  it('"Collapse column" and auto-fold move focus to the strip', () => {
    expect(run(fresh(), desktop('sections', 'kanban'), [{ type: 'gestureCollapseColumn' }]).effects[0].focus).toBe('strip');
    expect(run(fresh(), desktop('sections', 'cards'), [toBoard]).effects[0].focus).toBe('strip');
  });

  it('with "side by side" active, gestures, address and drop do not touch the sections column', () => {
    const start = make((s) => (s.sections.columnCollapsed = true));
    const r = run(start, desktop('columns', 'kanban'), [
      { type: 'gestureExpand', via: 'badge' },
      { type: 'addressReveal' },
      { type: 'queueFell' },
      { type: 'chevron', section: 'projects' },
      { type: 'gestureCollapseColumn' },
    ]);
    expect(r.state).toEqual(start);
  });

  it('returning with active sections does not expand the "side by side" column folded by the human', () => {
    const r = run(
      make((s) => {
        s.columns.collapsed = { inbox: true, projects: true };
        s.columns.workspace.auto.inbox = true;
      }),
      desktop('sections', 'kanban'),
      [toCards],
    );
    expect(r.state.columns.collapsed).toEqual({ inbox: false, projects: true });
  });

  it('the "side by side" hint is not shown the second time', () => {
    const r = run(make((s) => (s.hintSeen.sections = true)), desktop('sections', 'kanban'), [
      toColumns,
      { type: 'legacy', apply: (s) => (s.columns.collapsed = { inbox: false, projects: false }) },
      toSections,
      toColumns,
    ]);
    expect(r.effects[0].hint).toBe('columns');
    expect(r.effects[2].hint).toBeUndefined();
  });
});

describe('F2 · growth changes nothing', () => {
  it('a count growth changes nothing and does not open the file', () => {
    const start = make((s) => (s.sections.sections.queues = true));
    const out = reduce(
      start,
      { mode: 'sections', width: 'desktop', view: 'cards', layer1: { fileOpen: false, deferredReturn: false, temp: null } },
      { type: 'queueRose' },
    );
    expect(out.state).toEqual(start);
    expect(out.temp).toBeNull();
    expect(out.effects).toEqual({});
  });
});

describe('F3 · the temporary picture', () => {
  it('during the file: the strip expands the column, Queues — as in the temporary picture; the badge does not change the picture', () => {
    const r = run(fresh(), desktop('sections', 'kanban'), [
      fileOpened,
      { type: 'chevron', section: 'queues' },
      { type: 'gestureCollapseColumn' },
      { type: 'gestureExpand', via: 'strip' },
    ]);
    expect(r.temp).toEqual({ columnCollapsed: false, queuesCollapsed: true });
    expect(r.effects[1].focus).toBe('queuesChevron');
    // US-11 / US-12: "during the shared file the badge only selects the queue and scrolls"
    const badge = cont(r, [{ type: 'gestureCollapseColumn' }, { type: 'gestureExpand', via: 'badge' }]);
    expect(badge.temp).toEqual({ columnCollapsed: true, queuesCollapsed: true });
    expect(badge.state).toEqual(fresh());
  });

  it('during the file the Projects chevron (section hidden) does nothing', () => {
    const r = run(fresh(), desktop('sections', 'kanban'), [fileOpened, { type: 'chevron', section: 'projects' }]);
    expect(r.temp).toEqual({ columnCollapsed: false, queuesCollapsed: false });
    expect(r.state).toEqual(fresh());
  });

  it('with "side by side" active there is no temporary picture and focus is not moved', () => {
    const r = run(fresh(), desktop('columns', 'cards'), [fileOpened]);
    expect(r.temp).toBeNull();
    expect(r.effects[0].focus).toBeUndefined();
  });

  it('a mode switch to sections during the file creates a temporary picture', () => {
    const r = run(fresh(), desktop('columns', 'kanban'), [fileOpened, toSections]);
    expect(r.temp).toEqual({ columnCollapsed: false, queuesCollapsed: false });
    expect(r.state).toEqual(fresh());
  });

  it('closing the file on cards without a deferred return does not expand the marked column', () => {
    const out = reduce(
      make(sectionsAutoFolded),
      { mode: 'sections', width: 'desktop', view: 'cards', layer1: { fileOpen: true, deferredReturn: false, temp: null } },
      fileClosed,
    );
    expect(out.state.sections.columnCollapsed).toBe(true);
  });

  it('crossing the desktop ↔ tablet threshold during the file does not cancel the return', () => {
    const r = run(make(sectionsAutoFolded), desktop('sections', 'kanban'), [
      fileOpened,
      toCards,
      { type: 'widthCrossed', to: 'tablet' },
    ]);
    expect(r.deferredReturn).toBe(true);
  });

  it('narrowing to a phone during the file on the board: the return is finished, the mark is alive', () => {
    const r = run(make(sectionsAutoFolded), desktop('sections', 'kanban'), [
      fileOpened,
      { type: 'widthCrossed', to: 'mobile' },
    ]);
    expect(r.deferredReturn).toBe(false);
    expect(r.state.sections.workspace.auto).toBe(true);
  });
});

describe('F3 · leaving the board without a return', () => {
  it('a view switch board → cards outside the shown shell: no return, marks are removed, the deferred return ends', () => {
    const out = reduce(
      make(sectionsAutoFolded, columnsAutoFolded),
      { mode: 'sections', width: 'desktop', view: 'kanban', layer1: { fileOpen: true, deferredReturn: true, temp: null } },
      { type: 'viewChanged', from: 'kanban', to: 'cards', onShownShell: false },
    );
    expect(out.state.sections).toMatchObject({ columnCollapsed: true, workspace: { auto: false } });
    expect(out.state.columns.collapsed).toEqual({ inbox: true, projects: true });
    expect(out.state.columns.workspace.auto).toEqual({ inbox: false, projects: false });
    expect(out.deferredReturn).toBe(false);
  });

  it('same without a file: no return, the mark is removed', () => {
    const r = run(make(sectionsAutoFolded), desktop('sections', 'kanban'), [
      { type: 'viewChanged', from: 'kanban', to: 'cards', onShownShell: false },
    ]);
    expect(r.state.sections).toMatchObject({ columnCollapsed: true, workspace: { auto: false } });
  });

  it('leaving the board on a phone with an open file: the deferred return ends, the mark is removed without expanding', () => {
    const out = reduce(
      make(sectionsAutoFolded),
      { mode: 'sections', width: 'mobile', view: 'kanban', layer1: { fileOpen: true, deferredReturn: true, temp: null } },
      toCards,
    );
    expect(out.deferredReturn).toBe(false);
    expect(out.state.sections).toMatchObject({ columnCollapsed: true, workspace: { auto: false } });
  });

  it('switching to "side by side" on the board when both columns are already folded: no hint', () => {
    const r = run(make((s) => (s.columns.collapsed = { inbox: true, projects: true })), desktop('sections', 'kanban'), [
      toColumns,
    ]);
    expect(r.effects[0].hint).toBeUndefined();
    expect(r.state.hintSeen.columns).toBe(false);
  });
});

describe('results are fresh objects', () => {
  it('a change to the returned temporary picture does not spoil the next one', () => {
    const ctx = { mode: 'sections' as const, width: 'desktop' as const, view: 'cards' as const };
    const first = reduce(fresh(), { ...ctx, layer1: { fileOpen: false, deferredReturn: false, temp: null } }, fileOpened);
    first.temp!.columnCollapsed = true;
    const second = reduce(fresh(), { ...ctx, layer1: { fileOpen: false, deferredReturn: false, temp: null } }, fileOpened);
    expect(second.temp).toEqual({ columnCollapsed: false, queuesCollapsed: false });
  });
});

describe('F2/F3 · focus and the flag at the edges', () => {
  it('US-3: a drop folds Queues and moves focus to their chevron; a repeated drop while folded — no move', () => {
    const r = run(fresh(), desktop('sections', 'cards'), [{ type: 'queueFell' }, { type: 'queueFell' }]);
    expect(r.effects[0].focus).toBe('queuesChevron');
    expect(r.effects[1].focus).toBeUndefined();
  });

  it('during the file expanding Queues by the chevron does not move focus', () => {
    const r = run(fresh(), desktop('sections', 'cards'), [
      fileOpened,
      { type: 'chevron', section: 'queues' },
      { type: 'chevron', section: 'queues' },
    ]);
    expect(r.effects[1].focus).toBe('queuesChevron');
    expect(r.effects[2].focus).toBeUndefined();
  });

  it('opening the file sets no deferred return — only leaving for cards sets it', () => {
    const r = run(make(sectionsAutoFolded), desktop('sections', 'cards'), [fileOpened]);
    expect(r.deferredReturn).toBe(false);
  });
});
