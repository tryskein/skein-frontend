/**
 * sk-421.2 T020 (US-2, US-3, R-7, INV-7, SC-010, SC-011, SC-013, SC-017,
 * F-9) — the "Tree" mode of the epic section.
 *
 * ─── What is shown ─────────────────────────────────────────────────
 *
 * The full subtree of the epic. The root (the epic itself) is not shown: the
 * card is already about it.
 *
 * sk-460.12 — "List" shows the SAME set of rows, not the first level of it:
 * the modes differ in layout, not in content, and now share a single
 * query. The selection of section rows is extracted into `isEpicSectionRow`
 * and called by both modes — two copies of the predicate would drift apart,
 * and then two screens of the same card would give different answers to the
 * question "how many tasks are here" (INV-7/SC-017).
 *
 * The issue type is printed in BOTH modes (sk-460.13): the design draws the
 * type chip in both "List" and "Tree" (the type pill on both boards).
 * Previously the tree turned it off with `showType={false}`, justified by a reference to
 * the spec ("the set of row fields stays as it is today") — exactly the form
 * of justification that the "design wins" decision cancelled (sk-460.8).
 *
 * The row is still drawn by the shared `EpicChildRow`, which prints the type
 * itself; the tree turns nothing off and adds no markup of its own — two
 * markups of the same thing would drift apart at the first edit.
 *
 * ─── Collapsed state ───────────────────────────────────────────────
 *
 * Every time the card is opened the tree is expanded IN FULL (3.3): the
 * collapsed state lives in this component and starts empty, i.e. "nothing
 * is collapsed". There is no need to keep the collapsed state between
 * openings of the card — T022 keeps it only while the card is OPEN,
 * including across mode switches.
 *
 * ─── Row visibility — the rule of the tasks column, not our own ─────
 *
 * Which rows are on screen is decided by the same pass as in the tasks
 * column (`TasksColumn.visibleRows`): walk the DFS and suppress the
 * descendants of a row that is itself collapsed. The key consequence is
 * F-9: a "no access" row is `isReference`, and reference rows do NOT become
 * a collapse boundary, so their descendants are ALWAYS visible, exactly as in
 * the column. Not a coincidence and not a gift: the rule was copied on purpose.
 *
 * ─── Keyboard ──────────────────────────────────────────────────────
 *
 * The WAI-ARIA tree model with ONE focus element for the whole tree
 * (roving tabindex). Keys are resolved by the shared `resolveTreeKey` — the
 * same as in the tasks column; introducing a second semantics of "what
 * does ← do" would mean introducing a copy that drifts apart.
 *
 * One exception is handled ABOVE the shared resolver: per US-2, on a
 * "no access" row the → arrow moves to the first descendant, if there is
 * one, while `resolveTreeKey` answers `none` for reference rows (in the
 * column they never have descendants). Here they do — so this case is
 * handled before the shared rule is consulted, not instead of it.
 *
 * ─── sk-421.2.8 T013 — the blockers sub-row in the "Tree" (US-6, UD-K) ────
 *
 * The `EpicChildBlockers` sub-row is rendered INSIDE the `treeitem`, after
 * the row (R-12). The tab stops of the tree are the active row
 * (`tabIndex 0`) and the elements of ITS sub-row; for inactive rows the
 * sub-row is not tabbable, and neither are the row button and the stub
 * (sk-441, T012). Tab from the active row passes through the sub-row and
 * leaves the tree, Shift+Tab from outside the tree lands on the last element
 * of the sub-row — all in DOM order, with no Tab interception.
 *
 * **The active row** is the last row on which, or on an element of whose
 * sub-row, the focus was (the row's `onFocus` bubbles from the sub-row), and
 * also the row whose sub-row element was activated with the mouse
 * (`onActivate`): keyboard focus is not forcibly moved in that case. A click
 * on the chevron does not change the active row (`onMouseDown` with `preventDefault`).
 *
 * **Keys (R-13)** — the row is taken from the `treeitem` that contains the
 * focus, not from a remembered index. Enter and Space on a sub-row element
 * are not handed to the tree: the button itself handles them, and the
 * child's card does not open. Arrows, Home, End and `*` act as from the
 * row; focus moves only when the key has a target ROW — collapse, expand
 * and `*` leave it on the sub-row element.
 *
 * **Screen reader (R-16)** — the accessible name of a `treeitem` is computed
 * by `aria-labelledby` from today's name sources (the chevron label and the
 * row content, in today's order): a sub-row lying in the same `treeitem` does
 * not get into the name. The sub-row is announced as a description
 * (`aria-describedby`).
 *
 * **Focus memory (R-14, sk-444)** — by the time of the effect, an unmounted
 * or reordered element has already handed focus to `body`, and
 * `document.activeElement` does not show the loss. So the tree remembers
 * the last focused element — a sub-row element (row + key
 * R-15 + the element itself) or the row itself (the `treeitem` or an element inside it
 * outside the sub-row): `focusin` in the tree overwrites the memory, `focusout` with
 * a deferred check erases it if the focus left on its own (the remembered element
 * is not active and there was no restore). On every new set of rows:
 * if the focus was on the remembered element and is now in `body` — the focus goes to the same
 * sub-row element if it is redrawn, otherwise to the child's row, otherwise
 * by `resolveEpicFocusTarget` (the nearest row above in the previous display
 * order, the first row, and the toggle and "Add child" are handled
 * by the section through `onFocusFallback`). The former transfer on a change of the row index
 * fires only if the focus was on the `treeitem` itself — otherwise
 * a surviving reference would lose the focus. A change of epic erases the memory.
 *
 * sk-444 — the restore effect is LAYERED (`useLayoutEffect`), and this is
 * the essence: it must run in the same commit that took the focus away,
 * before the deferred `focusout` check. Reordering rows moves the
 * `treeitem` in the DOM, and the focus is lost although the node stays in the document —
 * the "node detached" sign does not work here, only the order tells them apart:
 * the commit, and right after it the restore.
 *
 * Expanding "+N" is reset on a mode switch and on collapsing an
 * ancestor by unmounting the sub-row (R-11).
 */

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MutableRefObject,
} from 'react';
import { useTranslation } from 'react-i18next';
import { IconChevronDown, IconChevronRight } from '@tabler/icons-react';
import { EpicChildRow } from './EpicChildRow';
import {
  EpicChildBlockers,
  EpicChildUnavailableLinks,
  epicChildDescribedBy,
  shouldShowEpicChildBlockers,
} from './EpicChildBlockers';
import { statusFill } from '../../../../components/Attribute';
import {
  isKnownEpicChildStatus,
  isUnavailableChild,
} from '../../../../lib/epicChildCategories';
import { layeredToFlatRows, type FlatTreeRow } from '../../../../lib/flattenTree';
import { resolveTreeKey } from '../../../../lib/treeKeyboardNav';
import { resolveEpicFocusTarget } from '../../../../lib/epicRowFocus';
import type { IssueTreeNode } from '../../../../api/issues';

export interface EpicChildrenTreeProps {
  /** The full subtree of the epic in server order (the root is a depth-0 row). */
  rows: IssueTreeNode[];
  isLoading: boolean;
  tooLarge: boolean;
  error: unknown;
  onOpen: (id: string, projectId: string) => void;
  /**
   * sk-421.2 T022 — collapsed nodes come from ABOVE and live in the section.
   *
   * In T020 this state was internal, and "expanded in full on every
   * opening of the card" held by itself. But the section must keep the
   * collapsed state while the card is OPEN, including across the
   * "Tree → List → Tree" switch, and internal state dies together with
   * the unmount. So the owner is the section.
   *
   * ⚠ The second half of the earlier argument — "it is remounted for a new
   * card, so both requirements hold at once" — WAS FALSE, and this is
   * more dangerous than an ordinary inaccuracy: the argument stood right above the declaration
   * of the state around which PK-3 is built, and the next reader would
   * take both the type and the justification from here. The details panel is rendered WITHOUT `key`
   * (`DetailsColumn.tsx#<IssueDetailPanel issueId={issueId} projectHandle={selectedProject} />`
   * — both render sites): a change of the card's identity does not
   * remount the section. The subtree disappears only on the paths where the panel
   * stops rendering it (`IssueDetailPanel.tsx#if (detail.isLoading)`,
   * `IssueDetailPanel.tsx#detail.isError || !detail.issue`,
   * `IssueDetailPanel.tsx#issue.type === 'epic' && issue.epic`), and a direct
   * "epic → epic" transition goes through none of
   * them.
   *
   * Resetting the collapsed state for a new card is now EXPLICIT — an effect on
   * `issue.id` in the section (sk-421.3 T15). Before, "expanded in full"
   * held only because node ids of different epics did not
   * coincide, i.e. by accident.
   */
  collapsed: ReadonlySet<string>;
  onCollapsedChange: (next: ReadonlySet<string>) => void;
  /** Id of the epic — the ancestor of the first-level rows (F-22). */
  epicId: string;
  /**
   * Review skein-frontend/4 MAJOR-1 — move the focus to a fallback target OUTSIDE
   * the tree (the mode toggle, otherwise "Add child"). These elements
   * live in the section, so the section performs it — the same contract as
   * `EpicChildrenList`.
   */
  onFocusFallback?: () => void;
  /**
   * sk-427 item 3 (sk-421.2 US-2, SC-013) — memory of the "Tree" entry point.
   *
   * The tree is unmounted when switching to "List", while US-2 requires
   * it to remember the row of its entry point. So the section remembers —
   * the same move as with the collapsed state (`collapsed`). The tree reads the memory
   * on mount and writes it on every change of the active row or of the
   * set of rows. Another epic's memory is not read: the entry point
   * belongs to the card, like the collapsed state (PK-3).
   */
  entryMemory?: MutableRefObject<EpicTreeEntry | null>;
}

/**
 * sk-427 item 3 — the "Tree" entry point: the shown rows and the index of the
 * active row among them at the moment of the last change. The set of rows is stored
 * whole, not as a single row key: if the entry-point row is gone by the
 * return or hidden by a collapsed ancestor, the target is chosen by the shared
 * fallback-target rule (`resolveEpicFocusTarget`), which needs the previous order.
 */
export interface EpicTreeEntry {
  epicId: string;
  rows: FlatTreeRow[];
  index: number;
}

/** Attribute of the focusable sub-row elements: the R-15 key with a place. */
const BLOCKER_EL_ATTR = 'data-epic-blocker-el';

/**
 * What the tree remembers about the last focused element: a sub-row element
 * (R-14) or the row itself (sk-444).
 */
type TreeFocusMemory =
  | {
      kind: 'subline';
      /** Id of the child in whose sub-row the element stood. */
      rowId: string;
      /** Element key by R-15 (`data-epic-blocker-el`). */
      elKey: string;
      /** The element itself — to tell "lost by rendering" from "focus left on its own". */
      el: HTMLElement;
    }
  | {
      kind: 'row';
      /**
       * The element with the focus: the `treeitem` or an element of the row outside the sub-row.
       * The row it stood in is named by `focusIndex`: the same `focusin`
       * makes it the active row.
       */
      el: HTMLElement;
    };

/** Focus is lost — it is in `body` or nowhere. */
function focusIsLost(): boolean {
  const active = document.activeElement;
  return !active || active === document.body;
}

/** The sub-row element of the row with key `elKey`, if it is rendered. */
function sublineElement(
  item: Element | undefined,
  elKey: string,
): HTMLElement | null {
  if (!item) return null;
  for (const el of item.querySelectorAll<HTMLElement>(`[${BLOCKER_EL_ATTR}]`)) {
    if (el.getAttribute(BLOCKER_EL_ATTR) === elKey) return el;
  }
  return null;
}

/**
 * The rows the tree shows: without the root and without reference rows
 * that are not a stub.
 *
 * A repeated occurrence of a node (a cycle or a duplicate) is a row of a task already
 * shown in the same panel; US-2 requires not showing it. The stub of
 * an inaccessible task is also `isReference`, but it stays: otherwise the tail
 * "inaccessible W" would point to children that are nowhere (INV-7).
 */
export function isEpicSectionRow(
  r: Pick<IssueTreeNode, 'item' | 'depth' | 'isReference'>,
): boolean {
  if (r.depth === 0) return false; // the root is the card itself
  if (!r.isReference) return true;
  return isUnavailableChild(r.item, r.isReference);
}

export function treeRowsOf(rows: readonly IssueTreeNode[]): FlatTreeRow[] {
  // The order "flatten, THEN filter" is the essence, not style.
  // `layeredToFlatRows` derives `hasChildren` from ROW ADJACENCY, so
  // filtering before flattening would strip the parent flag from a row whose
  // only next neighbour was a repeated occurrence.
  return layeredToFlatRows(rows).filter(isEpicSectionRow);
}

/**
 * Whether a row is expandable — ONE predicate for all consumers.
 *
 * It decides both the presence of a chevron and membership in the bulk
 * collapse set. A separate predicate for the second would make the control promise
 * "everything collapsed" while a node the user cannot expand is present —
 * or, the other way round, stay silent for a node the user sees expanded.
 *
 * ⚠ The reasoning without which the next edit will silently pull the keyboard and the control
 * apart (finding N-7). There are TWO predicates in play: this one and
 * `isExpandableRow = hasChildren && !isReference && !isContext`
 * (`lib/treeKeyboardNav.ts`), used by the asterisk key.
 * They coincide not by design but because `layeredToFlatRows` hard-codes
 * `isContext: false` UNCONDITIONALLY (`lib/flattenTree.ts`). Once a context
 * row appears in the section, the predicates will diverge, and the key will
 * start expanding what the control does not hold in its set. Then
 * they must be merged here, not discovered diverging from a complaint.
 */
export function isExpandableTreeRow(row: FlatTreeRow): boolean {
  return row.hasChildren && !row.isReference;
}

/**
 * Ids of all expandable nodes — a pure function for the bulk collapse
 * control (US-6, PL-7).
 *
 * The input is the FLAT rows after `treeRowsOf`, not the layered server response.
 * The difference is not cosmetic: `treeRowsOf` drops the root (which is the
 * card itself) and repeated occurrences, keeping the stubs of inaccessible tasks.
 * Pass a layered array here and the root will be counted as an expandable node,
 * and reference rows will enter the count, so the control will stop offering
 * "expand" exactly when it should.
 *
 * The set is computed from the RECEIVED tree, not from the shown rows:
 * "collapse all" must also reach nodes temporarily hidden under
 * other collapsed ones (US-6, SC-009).
 */
export function expandableIds(rows: readonly FlatTreeRow[]): string[] {
  return rows.filter(isExpandableTreeRow).map((r) => r.item.id);
}

/** Visible rows: descendants of a collapsed row are hidden. The tasks column rule. */
export function visibleTreeRows(
  rows: readonly FlatTreeRow[],
  collapsed: ReadonlySet<string>,
): FlatTreeRow[] {
  const out: FlatTreeRow[] = [];
  let collapsedDepth = -1;
  for (const r of rows) {
    if (collapsedDepth >= 0 && r.depth > collapsedDepth) continue;
    if (collapsedDepth >= 0 && r.depth <= collapsedDepth) collapsedDepth = -1;
    out.push(r);
    // Reference rows do not become a collapse boundary — hence F-9.
    // The predicate is SHARED (sk-421.3 T16): the collapse boundary and the presence of a chevron are
    // one and the same property of a row, and two copies of it would drift apart.
    if (isExpandableTreeRow(r) && collapsed.has(r.item.id)) {
      collapsedDepth = r.depth;
    }
  }
  return out;
}

export function EpicChildrenTree({
  rows,
  isLoading,
  tooLarge,
  error,
  onOpen,
  collapsed,
  onCollapsedChange,
  epicId,
  onFocusFallback,
  entryMemory,
}: EpicChildrenTreeProps) {
  const { t } = useTranslation('details');
  // Prefix of the ids of row labels and chevrons: `aria-labelledby` refers to
  // them, and task ids do not go into attributes.
  const uid = useId();

  // sk-427 item 3 — the entry point remembered by the section for THIS epic.
  // Taken once, on mount: after that the tree maintains it itself.
  const [entry] = useState<EpicTreeEntry | null>(() =>
    entryMemory?.current?.epicId === epicId ? entryMemory.current : null,
  );
  const [focusIndex, setFocusIndex] = useState(entry?.index ?? 0);
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const treeRef = useRef<HTMLDivElement>(null);
  // sk-421.2, wave B/2 review (BLOCKER, 2/2) — before this fix the keys
  // moved only `tabIndex`, while DOM focus stayed on the previous row:
  // the screen reader was silent, Enter opened a "virtual" row. The roving
  // tabindex role is kept, but it does NOT replace focus — the reference is next door,
  // `TaskTreeVirtualList.tsx#pendingFocusRef`.
  //
  // Focus is taken only when it is ALREADY inside the tree: otherwise opening
  // a card would drag the user's focus away from the place where they
  // left it.
  const pendingFocusRef = useRef(false);
  // sk-421.2.8 T013 (R-14), sk-444 — the last focused element
  // of the tree: a sub-row element or a row.
  const memoryRef = useRef<TreeFocusMemory | null>(null);

  const allRows = useMemo(() => treeRowsOf(rows), [rows]);
  const shown = useMemo(
    () => visibleTreeRows(allRows, collapsed),
    [allRows, collapsed],
  );

  /** Index of the shown row whose `treeitem` contains the element. */
  const indexOfElement = useCallback(
    (el: Element | null): number => {
      const item = el?.closest('[role="treeitem"]');
      if (!item) return -1;
      for (let i = 0; i < shown.length; i += 1) {
        if (rowRefs.current.get(shown[i].item.id) === item) return i;
      }
      return -1;
    },
    [shown],
  );

  // A change of the section's epic erases the sub-row focus memory: the section and the tree
  // survive a card change without remounting (R-14). Declared BEFORE
  // the rows effect, so on one commit it runs first.
  // sk-444 — layered, like the rows effect: a passive one would run AFTER
  // it, and the old card's memory could drag the focus to a row of the new one.
  useLayoutEffect(() => {
    memoryRef.current = null;
  }, [epicId]);

  // The row with the focus could disappear — an ancestor was collapsed, a live
  // event arrived, the server returned a different set. Focus moves by the SHARED
  // rule (US-2): the same task, otherwise the nearest surviving one ABOVE it,
  // otherwise the first row. Simply clamping the index to the list length
  // would silently put the focus on a different task.
  //
  // sk-427 item 3 — on return to the "Tree", the "previous set" is the entry-point
  // set: the entry-point row, which disappeared or got hidden while the
  // "List" was open, is resolved by the same rule as the row with the focus.
  const prevShownRef = useRef<FlatTreeRow[]>(entry?.rows ?? shown);
  // sk-444 — layered, not passive: see "Focus memory" in the file header.
  useLayoutEffect(() => {
    // Rows are still loading — nothing to judge; the previous set (including
    // the entry-point set) stays the reference until the new one arrives.
    if (isLoading) return;
    const prev = prevShownRef.current;
    prevShownRef.current = shown;
    if (prev === shown) return;

    const memory = memoryRef.current;
    // The focus stood on a remembered element and was lost by this commit. If it stands
    // on something real, the user or other code put it there, and
    // it must not be taken away.
    const lost = memory !== null && document.activeElement !== memory.el ? memory : null;
    if (lost) memoryRef.current = null;

    // sk-444 — the ROW with the focus is lost: it disappeared, its ancestor was collapsed
    // or a reorder moved its node. There is one fallback-target rule (US-2);
    // the row on which the focus stood is `focusIndex` of the previous set.
    if (lost?.kind === 'row' && focusIsLost()) {
      const target = resolveEpicFocusTarget({
        prevRows: prev,
        prevIndex: focusIndex,
        nextRows: shown,
        epicId,
        hasSwitcher: true,
      });
      if (target.kind === 'row') {
        setFocusIndex(target.index);
        rowRefs.current.get(shown[target.index].item.id)?.focus();
        return;
      }
      // No rows left: the target outside the tree is handled by the section.
      onFocusFallback?.();
      return;
    }

    // sk-421.2.8 T013 (R-14) — the SUB-ROW ELEMENT with the focus is lost.
    if (lost?.kind === 'subline') {
      if (focusIsLost()) {
        const nextIndex = shown.findIndex(
          (r) => !r.isReference && r.item.id === lost.rowId,
        );
        if (nextIndex >= 0) {
          const item = rowRefs.current.get(shown[nextIndex].item.id);
          (sublineElement(item, lost.elKey) ?? item)?.focus();
          return;
        }
        const prevIndex = prev.findIndex(
          (r) => !r.isReference && r.item.id === lost.rowId,
        );
        const target = resolveEpicFocusTarget({
          prevRows: prev,
          prevIndex,
          nextRows: shown,
          epicId,
          hasSwitcher: true,
        });
        if (target.kind === 'row') {
          rowRefs.current.get(shown[target.index].item.id)?.focus();
          return;
        }
        // Review skein-frontend/4 MAJOR-1 — no rows left: the target outside the tree
        // (the mode toggle, otherwise "Add child") is handled by the section,
        // as for the "List" (spec US-6, plan T013).
        onFocusFallback?.();
        return;
      }
    }

    const target = resolveEpicFocusTarget({
      prevRows: prev,
      prevIndex: focusIndex,
      nextRows: shown,
      epicId,
      // The toggle lives in the section; from here all that is known about it
      // is that it exists when the set of rows is non-empty.
      hasSwitcher: true,
    });
    if (target.kind === 'row' && target.index !== focusIndex) {
      // sk-421.2.8 T013 (R-14) — the focus may follow the index
      // only if it stood on the `treeitem` itself: a surviving sub-row
      // element would otherwise lose the focus when rows shift.
      //
      // sk-444 — moved IMMEDIATELY, not via `pendingFocusRef`: the effect
      // is layered, and the passive transfer effect of the same commit would run
      // before the re-render with the old `focusIndex` — i.e. it would take
      // the focus to the row that stood at the previous index.
      const active = document.activeElement;
      setFocusIndex(target.index);
      if (
        active &&
        active.getAttribute('role') === 'treeitem' &&
        treeRef.current?.contains(active)
      ) {
        rowRefs.current.get(shown[target.index].item.id)?.focus();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, epicId, isLoading]);

  // sk-427 item 3 — recording the entry point for the section. Declared AFTER the
  // restore effect: on one commit it gets to correct the index, and
  // the re-render will record the already corrected one.
  useLayoutEffect(() => {
    if (!entryMemory || isLoading) return;
    entryMemory.current = { epicId, rows: shown, index: focusIndex };
  }, [entryMemory, epicId, shown, focusIndex, isLoading]);

  // Moving DOM focus after `focusIndex`. A separate effect, not
  // inside the handler: the row the focus goes to may not yet
  // exist at the moment of the keypress (a node was expanded — the descendants appear
  // only after render).
  useEffect(() => {
    if (!pendingFocusRef.current) return;
    pendingFocusRef.current = false;
    const row = shown[focusIndex];
    if (!row) return;
    rowRefs.current.get(row.item.id)?.focus();
  }, [focusIndex, shown]);

  const toggle = useCallback(
    (id: string) => {
      const next = new Set(collapsed);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      onCollapsedChange(next);
    },
    [collapsed, onCollapsedChange],
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (shown.length === 0) return;
      const source = e.target as HTMLElement;
      // R-13 — did the event come from a sub-row element?
      const fromSubline = source.closest('.epic-child-blockers') !== null;
      // Enter and Space are handled by the sub-row button itself; the tree does not
      // touch them, otherwise bubbling would open the child's card (M-2).
      if (fromSubline && (e.key === 'Enter' || e.key === ' ')) return;

      // The row is the one containing the focus, not a remembered index.
      const located = indexOfElement(source);
      const index = located >= 0 ? located : focusIndex;
      const row = shown[index];
      if (!row) return;

      // US-2, an exception above the shared rule: on a "no access" row → leads
      // to the first descendant. The shared resolver is silent for reference rows
      // because in the tasks column they have no descendants.
      if (
        e.key === 'ArrowRight' &&
        row.isReference &&
        row.hasChildren &&
        shown[index + 1]?.depth > row.depth
      ) {
        e.preventDefault();
        pendingFocusRef.current = true;
        setFocusIndex(index + 1);
        return;
      }

      // The shared resolver computes "expanded" from the set of EXPANDED ones, while
      // here the set of COLLAPSED ones is stored (empty = everything open). We hand it
      // the complement over the visible rows.
      const expanded = new Set(
        shown.filter((r) => r.hasChildren && !collapsed.has(r.item.id))
          .map((r) => r.item.id),
      );
      const action = resolveTreeKey(e.key, {
        rows: shown,
        index,
        expanded,
      });
      if (action.kind === 'none') return;
      e.preventDefault();
      switch (action.kind) {
        case 'focus':
          pendingFocusRef.current = true;
          if (action.index === focusIndex) {
            // The index does not change, the effect will not rerun — move it ourselves.
            pendingFocusRef.current = false;
            rowRefs.current.get(shown[action.index].item.id)?.focus();
          } else {
            setFocusIndex(action.index);
          }
          break;
        case 'expand':
        case 'collapse':
          toggle(action.id);
          break;
        case 'expandSiblings': {
          const next = new Set(collapsed);
          for (const id of action.ids) next.delete(id);
          onCollapsedChange(next);
          break;
        }
        case 'activate': {
          const target = shown[action.index];
          if (target && !target.isReference) {
            onOpen(target.item.id, target.item.projectId);
          }
          break;
        }
      }
    },
    [shown, focusIndex, collapsed, toggle, onOpen, onCollapsedChange, indexOfElement],
  );

  // R-14, sk-444 — `focusin` inside the tree overwrites the memory: a sub-row
  // element is remembered with the R-15 key, any other element as a row.
  const handleFocusIn = useCallback(
    (e: FocusEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement;
      const el = target.closest<HTMLElement>(`[${BLOCKER_EL_ATTR}]`);
      if (!el) {
        memoryRef.current = indexOfElement(target) >= 0 ? { kind: 'row', el: target } : null;
        return;
      }
      const index = indexOfElement(el);
      const row = index >= 0 ? shown[index] : undefined;
      const elKey = el.getAttribute(BLOCKER_EL_ATTR);
      memoryRef.current =
        row && elKey !== null ? { kind: 'subline', rowId: row.item.id, elKey, el } : null;
    },
    [indexOfElement, shown],
  );

  // R-14, sk-444 — `focusout` from a remembered element. A focus loss caused by rendering
  // is restored by the layered effect in the same commit, i.e. earlier than this
  // deferred check; if by then the remembered element is still not active and the
  // memory is not overwritten — the focus left at the user's will.
  const handleFocusOut = useCallback((e: FocusEvent<HTMLDivElement>) => {
    const memory = memoryRef.current;
    if (!memory || e.target !== memory.el) return;
    setTimeout(() => {
      if (memoryRef.current === memory && document.activeElement !== memory.el) {
        memoryRef.current = null;
      }
    }, 0);
  }, []);

  if (isLoading) {
    return <div className="col-empty">{t('epic.loadingChildren')}</div>;
  }
  if (tooLarge) {
    // Here the advice is feasible, unlike the "List": that one asks for depth 1 and
    // usually passes on the same epic.
    return (
      <div className="col-empty col-error" role="alert" aria-live="polite">
        {t('epic.tooLargeTree')}
      </div>
    );
  }
  if (error) {
    return (
      <div className="col-empty col-error" role="alert" aria-live="assertive">
        {t('epic.loadChildrenFailed')}
      </div>
    );
  }
  if (shown.length === 0) return null;

  return (
    <div
      ref={treeRef}
      className="epic-children-tree"
      role="tree"
      aria-label={t('epic.title')}
      onKeyDown={onKeyDown}
      onFocus={handleFocusIn}
      onBlur={handleFocusOut}
    >
      {shown.map((row, i) => {
        // The same predicate as for the bulk collapse set and for
        // the collapse boundary (sk-421.3 T16) — the row with a chevron and the row
        // that the control will collapse must be one and the same row.
        const expandable = isExpandableTreeRow(row);
        const isOpen = expandable && !collapsed.has(row.item.id);
        const showBlockers = shouldShowEpicChildBlockers(
          row.item,
          row.isReference,
          row.blockers,
        );
        // R-16 — today's sources of the row name in today's order:
        // the chevron label (if there is one) and the content of the child's row.
        const chevronId = `${uid}-chevron-${i}`;
        const rowLabelId = `${uid}-row-${i}`;
        return (
          <div
            key={row.item.id}
            ref={(el) => {
              if (el) rowRefs.current.set(row.item.id, el);
              else rowRefs.current.delete(row.item.id);
            }}
            role="treeitem"
            aria-level={row.depth}
            aria-expanded={expandable ? isOpen : undefined}
            aria-labelledby={expandable ? `${chevronId} ${rowLabelId}` : rowLabelId}
            aria-describedby={epicChildDescribedBy(
              row.item,
              row.isReference,
              row.blockers,
              row.unavailableBlockingLinks,
            )}
            // One focus element for the whole tree (roving tabindex).
            tabIndex={i === focusIndex ? 0 : -1}
            // Bubbles up from sub-row elements as well: focus on them makes the row
            // active (US-6, "The active row").
            onFocus={() => setFocusIndex(i)}
            className="epic-tree-row"
            /* sk-421.3 T12 (PL-2, PL-3, PK-1 item 2, INV-6, SC-006) — the tone
               of the left-edge mark.

               The tone is taken from the SHARED map and only for the five known
               values: for an unknown value the map answers with the same
               tone as for `deferred` (`--ink-2`), i.e. it would paint
               someone else's status. So `statusFill` is not called for it
               AT ALL — not "called and discarded". sk-460.9 moved
               `closed` to `--ink-3`, and the coincidences became one instead of two;
               this does not weaken the argument, because it is about the ABSENCE
               of a call, not about the difference between answers.

               The mark gets the task's OWN status and never
               replaces it with the derived blocked flag: otherwise a
               blocked open row would get a red mark
               while lying in the `open` category, and the screen would report two different
               statuses for one row. The row chip does exactly the same
               (`EpicChildRow` draws it without `isBlocked`).

               A row of an inaccessible task carries no mark by construction: it
               has an empty status, and that is not a known one. */
            style={
              {
                '--depth': row.depth - 1,
                ...(isKnownEpicChildStatus(row.item.status)
                  ? { '--epic-mark': `var(${statusFill(row.item.status)})` }
                  : {}),
              } as React.CSSProperties
            }
          >
            {expandable ? (
              <button
                type="button"
                id={chevronId}
                className="epic-tree-chevron"
                // An existing label is taken, from the `tasks` namespace:
                // it is the same control as in the tasks column, and a second
                // text for the same action would drift apart from the first.
                aria-label={isOpen ? t('tasks:tree.collapse') : t('tasks:tree.expand')}
                // The only tab stop of the tree is the row. A chevron in
                // the traversal order would give a second one inside each parent
                // row; the keyboard opens and closes with arrows.
                tabIndex={-1}
                // A click must not drag the focus from the row to a button the
                // keyboard contract does not know about.
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  // The row opens the card on click; pressing the chevron
                  // must only collapse or expand.
                  e.stopPropagation();
                  toggle(row.item.id);
                }}
              >
                {/* Drawn icons, not typographic characters: a typed
                    glyph is drawn in whatever typeface the run resolves,
                    and off the 16/1.75 scale (the same reason
                    sk-285.7.2.88 removed the literal "+" from this panel). */}
                {isOpen ? (
                  <IconChevronDown size={16} stroke={1.75} aria-hidden />
                ) : (
                  <IconChevronRight size={16} stroke={1.75} aria-hidden />
                )}
              </button>
            ) : (
              /* A leaf gets a dot, not an empty box: it answers the
                 question "what is under this row" — nothing.

                 sk-460.5 — the dot is DRAWN by the stylesheet (a 6×6 circle with
                 a border),
                 not by the `IconPoint` icon
                 of size 16. The reason is not cosmetic: the product's icon scale
                 is 16/20/24 (FR-003), and the design's
                  6px marker does not fit this scale and cannot.
                 Shrinking the icon by a rule would leave in the source
                 a `size={16}` that corresponds to nothing on screen —
                 i.e. get past the guard rather than meet the requirement.

                 A circle is not a glyph: it is not typeset in a typeface and has no relation to the
                 icon scale, so the ban on typographic
                 characters (sk-285.7.2.88) does not touch it. The border takes
                 `currentColor` — the tone is set once on the box below by one role. */
              <span className="epic-tree-chevron-placeholder" aria-hidden>
                <span className="epic-tree-leaf" />
              </span>
            )}
            <EpicChildRow
              item={row.item}
              isReference={row.isReference}
              onOpen={onOpen}
              // sk-460.13 — `showType` is no longer passed: both modes print
              // the type, and the prop default means exactly that.
              // sk-421.2.8 T012 (sk-441) — the tree has one tab stop: the
              // `treeitem` itself with tabIndex 0. The row button and the "no
              // access" stub in the "Tree" do not get Tab.
              treeMode
              id={rowLabelId}
            />
            {showBlockers ? (
              // sk-421.2.8 T013 — the sub-row inside the `treeitem`, after the row
              // (R-12). Tabbable only for the active row; a mouse click on
              // any of its elements makes the row active without moving
              // the focus.
              <EpicChildBlockers
                item={row.item}
                isReference={row.isReference}
                blockers={row.blockers}
                tabbable={i === focusIndex}
                onActivate={() => setFocusIndex(i)}
              />
            ) : null}
            {/* sk-479 — the sub-row of inaccessible links: after the blockers
                sub-row, inside the same `treeitem`; not in the focus order. */}
            <EpicChildUnavailableLinks
              item={row.item}
              isReference={row.isReference}
              unavailableBlockingLinks={row.unavailableBlockingLinks}
            />
          </div>
        );
      })}
    </div>
  );
}
