import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { IconArrowDown, IconArrowUp, IconArrowsSort } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { TaskTreeNode } from './TaskTreeNode';
import { buildTreeRowKeys, treeRowIndexById } from '../../lib/treeRowIdentity';
import { resolveTypeahead } from '../../lib/treeKeyboardNav';
import { resolveTreeGridKey } from '../../lib/treeGridKeyboardNav';
import { computeTreeRowPositions } from '../../lib/treeRowPositions';
import {
  treeColumnOrder,
  treeColumnsMask,
  type TreeColumn,
  type TreeColumnSet,
} from '../../lib/treeColumns';
import {
  nextSortForColumn,
  sortedTreeColumn,
  treeColumnSortKey,
  type TasksSortDirection,
  type TasksSortPref,
} from '../../lib/taskSort';
import {
  TREE_HEAD_HEIGHT_PX,
  TREE_ROW_HEIGHT_PX,
  treeGridTemplate,
  treeTableMinWidthPx,
  type TreeColumnOrder,
} from '../../lib/treeColumnLayout';
import type { FlatTreeRow } from '../../lib/flattenTree';
import type { IssueTreeRowItem, TasksSortKey } from '../../api/issues';

/**
 * sk-285.2.10 — the scrolling body of the Tasks tree, virtualized.
 *
 * ─── What is virtualized ───────────────────────────────────────────
 *
 * The already-computed `FlatTreeRow[]` AFTER collapse has been applied
 * (`visibleRows` in TasksColumn) — one layer BELOW the tree itself. That
 * is the whole trick: expanding or collapsing a node is just a different
 * array length here, so the virtualizer needs to know nothing about
 * depth, parents or edges, and every tree behaviour above it (the
 * «N · M collapsed» chip, search highlight, the selected row, the
 * auto-opened path to a match) keeps working on the list it always
 * worked on.
 *
 * ─── Library choice: @tanstack/react-virtual ───────────────────────
 *
 * `react-virtual` is headless: we keep our own DOM and CSS — the rows
 * stay the same elements the non-virtualized list rendered.
 *
 * It ALSO measures each rendered row through a ResizeObserver, and
 * sk-285.2.19 stopped asking it to. That measurement existed because
 * rows were mini-cards of one, two or three lines, whose height could
 * only be guessed before they were rendered; every guess was corrected
 * once the real height arrived, and the correction is what moved the
 * rows under the reader (TanStack/virtual#659). With a FIXED row height
 * the size handed to `estimateSize` is not a guess, so measuring can
 * only ever confirm it — while the correction machinery stays live and
 * misbehaves the moment anything reports a different number. It really
 * does misbehave: a measured height that disagrees with the budget
 * re-lays out the window, and a row that has just been scrolled to and
 * focused can be un-mounted by that pass, dropping focus to the body in
 * the middle of a keyboard move.
 *
 * So the rows are positioned from the row height and nothing else, and
 * the stylesheet is held to that number by `TreeTableLayout.test.tsx`
 * rather than by a per-row measurement. `data-index` stays on the
 * measurement box — it is how the focus effect below finds a row.
 *
 * Rejected:
 *   - react-virtuoso: does measure dynamically, but it owns the scroll
 *     container and its chrome, and this list scrolls inside the shared
 *     `.col-body` that the column's infinite-scroll sentinel, the
 *     too-large banner and now the sticky column header live in.
 *   - hand-rolled: dynamic measurement plus scroll anchoring (keeping
 *     the scroll position stable when a measured row turns out taller
 *     than estimated) is exactly the part that is easy to get subtly
 *     wrong, and it is what the library does.
 *
 * Same vendor as `@tanstack/react-query`, already a dependency.
 *
 * ─── The header, and why it is INSIDE the scroller (sk-285.2.19) ────
 *
 * The table's column headings scroll SIDEWAYS with the columns they name
 * and stay put VERTICALLY. Only one arrangement gives both: the header is
 * a `position: sticky` strip inside the very container that scrolls, so
 * horizontal panning moves it with the rows and vertical scrolling does
 * not.
 *
 * The cost is that the row canvas no longer starts at the top of the
 * scroll container, and the virtualizer measures every offset from that
 * top. `scrollMargin` is its own option for exactly this: without it
 * `scrollToIndex` — i.e. every keyboard move onto an off-screen row —
 * would put the target row one header height too high, behind the header
 * that is pinned over it.
 *
 * ─── Sorting from the headings (sk-285.2.19, step 4) ───────────────
 *
 * A heading whose column the sort model has a key for is a `<button>`:
 * it switches the COLUMN'S one sort preference (the same state the
 * «Sort by» combobox writes and `skein.tasks.sort` persists), and a
 * second click on the sorted column reverses it. The policy is
 * `nextSortForColumn` in `lib/taskSort.ts`; this component performs it
 * and reports the verdict upward — it holds no sort state of its own.
 *
 * The buttons are outside the grid's roving tabindex on purpose: the
 * grid owns ROWS and its single tab stop is a row, so a heading is
 * reached the ordinary way, by Tab, before the rows.
 *
 * Above the scroller sits the one line that makes decision A honest:
 * sorting orders children INSIDE each parent, so the order is LOCAL —
 * the first row is the top of the first branch, not of the project. The
 * caption names the field, the direction, and that caveat, and every
 * sortable heading points at it with `aria-describedby` so it reaches a
 * reader who cannot see the strip.
 *
 * ─── Scroll contract ───────────────────────────────────────────────
 *
 * Under virtualization a row that is not on screen is not in the DOM, so
 * `element.scrollIntoView()` is no longer available to callers. The
 * imperative `TaskTreeScroller` handle replaces it: address a row by
 * ISSUE ID and the virtualizer scrolls to its index, mounting it on the
 * way. Keyboard navigation (moving focus to a row far off screen) and
 * «jump to the canonical row» both need this and nothing else.
 *
 * ─── Keyboard (sk-285.2.11, re-patterned in sk-285.2.19) ───────────
 *
 * This element is the `role="treegrid"`, and it owns the whole WAI-ARIA
 * APG keyboard contract for the rows below it. It lives HERE, not in
 * TasksColumn, because everything the contract asks about is already a
 * prop of this component — the visible rows, the expansion set, the
 * toggle, the select — and because the two halves the contract cannot be
 * split across are both here too: the roving tabindex (which needs the
 * row INDEX, not the issue id — one issue can occupy two rows) and the
 * virtualizer (a focus move onto an unmounted row has to scroll first
 * and focus after the row mounts).
 *
 * The rules themselves are in `lib/treeGridKeyboardNav.ts` as a pure
 * resolver (which delegates the row-mode half back to the tree contract
 * in `lib/treeKeyboardNav.ts` — see that module's header); this file
 * performs the action it returns and nothing else. One `keydown` on the
 * container, not one per row: the rows are remounted constantly by the
 * virtualizer, and a handler per row would be 500 closures re-created on
 * every scroll frame for a single active row.
 *
 * A treegrid has TWO focus modes, and the state below carries both: a
 * row key (which row) plus a column index that is `null` while the ROW
 * holds focus and a number once focus has stepped into its cells. The
 * roving tabindex follows that pair — exactly one element in the whole
 * grid carries `tabIndex={0}`, and it is the row in row mode and the
 * cell in cell mode.
 *
 * ─── Why the grid is the canvas, and the header is joined by
 *     `aria-owns` ─────────────────────────────────────────────────────
 *
 * The `role="treegrid"` stays on the row canvas for the reason the
 * `role="tree"` was put there: the scroll container ALSO holds the
 * infinite-scroll sentinel and the "loading more" line, and a grid may
 * own rows and rowgroups and nothing else. But a grid must also own its
 * column headers, and the header strip cannot be a DOM child of the
 * canvas — it is `position: sticky` against a scroller the canvas does
 * not span, and the canvas's height is the virtualizer's arithmetic.
 *
 * `aria-owns` is the escape hatch ARIA provides for exactly this: the
 * strip is a `role="row"` of `columnheader`s, adopted by the grid
 * without moving in the DOM. Its place in the grid is stated by
 * `aria-rowindex="1"` rather than by document order — which is also what
 * the DATA rows rely on, since under virtualization the mounted slice is
 * not the list.
 */

export interface TaskTreeScroller {
  /**
   * Bring the row showing `issueId` into view.
   *
   * Returns false when no visible row shows that issue — it is collapsed
   * under an ancestor, or not on the loaded page at all — so the caller
   * can expand the path (or give up) instead of believing in a scroll
   * that never happened. Never throws on an unknown id.
   */
  scrollRowIntoView(
    issueId: string,
    align?: 'auto' | 'start' | 'center' | 'end',
  ): boolean;
  /** Index of the visible row showing `issueId`, or -1. */
  rowIndex(issueId: string): number;
}

export interface TaskTreeVirtualListProps {
  /** Visible rows: post-collapse, in render order. */
  rows: FlatTreeRow[];
  /**
   * sk-285.2.13 — `rows` is a loaded PREFIX: the paginated query behind
   * the tree has another page, which the footer sentinel will fetch as
   * the reader reaches the bottom.
   *
   * Required, and deliberately not defaulted: `false` is the claim "this
   * is the whole set", which is what every row's `aria-setsize` then
   * states out loud. A call site that has not thought about it must not
   * be able to make that claim by omission.
   */
  hasMoreRows: boolean;
  selectedId: string | null;
  expanded: ReadonlySet<string>;
  searchQuery: string;
  componentNames: Map<string, string>;
  /**
   * sk-285.2.19 — which switchable columns the table prints, straight
   * from the user's preference (`useTasksUiState().treeColumns`).
   *
   * REQUIRED, and taken as the `Set` rather than as a ready-made order:
   * the order and the bitmask are derived here, once per change, so that
   * every row is handed the SAME array reference and the header strip is
   * laid out from the same one. A caller that passed its own order could
   * hand the header and the rows two different lists, which is the one
   * way a table can silently print a value under the wrong heading.
   */
  treeColumns: TreeColumnSet;
  /**
   * sk-285.2.19 (step 4) — the sort the table is showing: which key, read
   * which way. Both REQUIRED, for the same reason `hasMoreRows` is: the
   * header prints an arrow that CLAIMS an order, and a default would let
   * a call site make that claim by omission.
   *
   * The KEY is the column's one sort preference (`useTasksUiState`), not
   * a table-local one — which is why clicking a heading also moves the
   * «Sort by» combobox and re-keys the Cards list. The DIRECTION is this
   * table's alone: no other body of the column reads it (sk-285.2.19
   * step 5 — see «Direction belongs to the tree table» in
   * `lib/taskSort.ts`), and the caller hands over the direction of the
   * key ACTUALLY in force, which during a search is not the stored one.
   */
  sort: TasksSortKey;
  sortDir: TasksSortDirection;
  /**
   * Asked for a new sort by a click on a column heading. The policy (a
   * new column opens at its natural direction, the sorted one reverses)
   * is `nextSortForColumn` in `lib/taskSort.ts`; this only reports the
   * verdict, and headings with no sort key never fire it.
   */
  onSortChange: (next: TasksSortPref) => void;
  onSelect: (item: IssueTreeRowItem) => void;
  onToggle: (id: string) => void;
  onJumpToFirst?: (firstSeenAt: string) => void;
  /**
   * Rendered inside the scroll container, after the rows: the column's
   * IntersectionObserver sentinel and its "loading more" line. They have
   * to sit INSIDE this element — the sentinel only fires when the user
   * has scrolled past the last row, and the last row is here.
   */
  footer?: ReactNode;
}

/**
 * Rows kept mounted beyond each edge of the viewport. Six is a fraction
 * of a screen at the `TREE_ROW_HEIGHT_PX` rows this table renders:
 * enough that a fast wheel scroll lands on real rows instead of blank
 * space, small enough that the DOM stays bounded (the acceptance
 * criterion for sk-285.2.10).
 */
const OVERSCAN = 6;

/**
 * How long a typeahead buffer stays alive between keystrokes, in ms.
 *
 * Long enough to type a word at conversational speed, short enough that
 * a letter pressed after a pause starts a fresh search rather than
 * appending to something the reader has forgotten typing. Matches the
 * dwell native list controls use.
 */
const TYPEAHEAD_RESET_MS = 1000;

export const TaskTreeVirtualList = forwardRef<
  TaskTreeScroller,
  TaskTreeVirtualListProps
>(function TaskTreeVirtualList(
  {
    rows,
    hasMoreRows,
    selectedId,
    expanded,
    searchQuery,
    componentNames,
    treeColumns,
    sort,
    sortDir,
    onSortChange,
    onSelect,
    onToggle,
    onJumpToFirst,
    footer,
  },
  ref,
) {
  const { t } = useTranslation('tasks');
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rowKeys = useMemo(() => buildTreeRowKeys(rows), [rows]);
  /**
   * The header strip's id, for the grid's `aria-owns`. From `useId`
   * rather than a constant: two Tasks columns on one page (the shell
   * mounts one, but nothing here may assume it) would otherwise publish
   * the same id twice and the second grid would adopt the first's
   * header.
   */
  const headId = useId();
  /**
   * sk-285.2.19 (step 4) — id of the caption that states what «sorted»
   * means in a TREE. Every sortable heading points at it with
   * `aria-describedby`, so the caveat is not a thing a sighted reader
   * happens to notice under the header while a screen-reader user
   * activates the same control blind.
   */
  const sortNoteId = useId();

  /**
   * sk-285.2.19 — the table's shape, derived ONCE per column change.
   *
   * `columnOrder` is handed to the header strip and to every row, so both
   * iterate the same list in the same order and a cell cannot end up
   * under the wrong heading. It is also reference-stable across scroll
   * frames, which is what keeps it safe to pass into rows the virtualizer
   * remounts constantly.
   *
   * `columnsMask` is the same set as a number, for the one cell that has
   * to ask about a column other than its own (the status chip, which only
   * carries the derived blocked marker when no `blocked` column does).
   * A `Set` passed down instead would be a fresh identity every render —
   * the trap `kanbanCardFields` documents.
   */
  const columnOrder: TreeColumnOrder = useMemo(
    () => treeColumnOrder(treeColumns),
    [treeColumns],
  );
  const columnsMask = useMemo(() => treeColumnsMask(treeColumns), [treeColumns]);
  /**
   * The two numbers CSS needs, published as custom properties on the
   * scroll container and inherited by the header and by every row: the
   * grid tracks they are both laid out on, and the width below which the
   * table pans sideways instead of squeezing its columns into mush.
   */
  const tableStyle = useMemo(
    () =>
      ({
        '--tree-grid-cols': treeGridTemplate(columnOrder),
        '--tree-table-min-w': `${treeTableMinWidthPx(columnOrder)}px`,
      }) as React.CSSProperties,
    [columnOrder],
  );

  /**
   * sk-285.2.13 — `aria-setsize` / `aria-posinset` per row, computed over
   * the WHOLE `rows` array rather than the mounted window: a row's place
   * among its siblings is a fact about the tree, and recomputing it from
   * `virtualRows` would make the announced set size change as the reader
   * scrolls. Memoised on `rows` for the same reason `rowKeys` is — the
   * array only changes when the tree does, not on every scroll frame.
   *
   * `hasMoreRows` closes the OTHER way a set size could move under the
   * reader: `rows` itself grows when the footer sentinel pulls the next
   * page. While that is still to come no set is closed, so the module
   * hands back `aria-setsize="-1"` ("unknown") instead of a total that
   * is about to be wrong.
   */
  const rowPositions = useMemo(
    () => computeTreeRowPositions(rows, { complete: !hasMoreRows }),
    [rows, hasMoreRows],
  );

  /**
   * Which row owns the tree's single tab stop, held as its ROW KEY.
   *
   * Not the issue id: an issue can be on screen twice (canonical row plus
   * a "↻ see" pointer row), and both would then claim the tab stop.
   * Not the index either: expanding or collapsing anything above the
   * focused row renumbers it, and the roving focus would silently slide
   * onto a different task. The row key is stable across both — see
   * `treeRowIdentity.ts`.
   */
  const [focusedKey, setFocusedKey] = useState<string | null>(null);

  /**
   * sk-285.2.19 — the OTHER half of the cursor: which cell of the
   * focused row holds focus, or `null` while the row itself does.
   *
   * Kept as a column INDEX and not as a column id: `End` means "the last
   * cell of this row" and `Ctrl+End` keeps the column while changing the
   * row, both of which are questions about position. A column switched
   * off under the cursor would leave an index past the end, so every
   * read of this value is clamped against the current column count
   * below — the clamp lives at the read, not at the write, because the
   * column set can change without any keystroke at all.
   */
  const [focusedColState, setFocusedColState] = useState<number | null>(null);
  const focusedCol =
    focusedColState === null
      ? null
      : Math.min(focusedColState, columnOrder.length - 1);

  // `getItemKey` reads the memoised key array rather than rebuilding the
  // tuple per call: the virtualizer asks for keys per measurement pass,
  // and the occurrence counter is only computable over the whole list.
  const getItemKey = useCallback(
    (index: number) => rowKeys[index] ?? index,
    [rowKeys],
  );

  /**
   * sk-285.2.19 — the height of an unrendered row, EXACTLY.
   *
   * This used to be a model (`lib/treeRowHeightEstimate.ts`): rows were
   * mini-cards whose height depended on their depth, because the indent
   * took width from the text box and the title wrapped to a second line
   * further down the tree. Every guess was corrected by the
   * ResizeObserver moments later, and the size of the correction was the
   * size of the jump the reader saw — the open upstream defect
   * TanStack/virtual#659.
   *
   * A fixed row height does not shrink that correction, it DELETES it:
   * the number below is the row's real height, so the canvas the
   * scrollbar describes is right on the first pass for rows nobody has
   * rendered yet, and nothing moves under the reader when they are.
   * The model, and its calibration, retired with the variable row.
   *
   * A constant, so no `rows[index]` lookup and no out-of-range case to
   * guard: there is no index for which this is not the answer.
   */
  const estimateSize = useCallback(() => TREE_ROW_HEIGHT_PX, []);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize,
    overscan: OVERSCAN,
    getItemKey,
    // The sticky header sits above the canvas INSIDE this scroller — see
    // «The header» in the module doc. Row offsets are therefore shifted
    // by its height, and this is what tells the virtualizer so; the rows
    // subtract it back out when they position themselves inside the
    // canvas, which starts below the header.
    scrollMargin: TREE_HEAD_HEIGHT_PX,
  });

  useImperativeHandle(
    ref,
    (): TaskTreeScroller => ({
      rowIndex: (issueId) => treeRowIndexById(rows, issueId),
      scrollRowIntoView: (issueId, align = 'auto') => {
        const index = treeRowIndexById(rows, issueId);
        if (index < 0) return false;
        virtualizer.scrollToIndex(index, { align });
        return true;
      },
    }),
    [rows, virtualizer],
  );

  const virtualRows = virtualizer.getVirtualItems();

  /**
   * The row the tab stop is on, as an index into `rows`.
   *
   * Falls back — in this order — to the selected row, then to the first
   * row. A tree whose rows are ALL `tabIndex={-1}` cannot be reached by
   * Tab at all, so "no row has been focused yet" must still name one; and
   * naming the row the reader is already looking at (the open issue)
   * beats dumping them at the top of a list they have scrolled away from.
   */
  const focusIndex = useMemo(() => {
    if (rows.length === 0) return -1;
    if (focusedKey !== null) {
      const i = rowKeys.indexOf(focusedKey);
      if (i >= 0) return i;
    }
    if (selectedId !== null) {
      const i = treeRowIndexById(rows, selectedId);
      if (i >= 0) return i;
    }
    return 0;
  }, [rows, rowKeys, focusedKey, selectedId]);

  /**
   * The row that carries `tabIndex={0}` in THIS render.
   *
   * Normally the focused row — but under virtualization the focused row
   * may not be mounted, and a tree in which every mounted row is
   * `tabIndex={-1}` cannot be entered with Tab at all. When that happens
   * the stop is lent to the first mounted row; whoever tabs into it
   * reports its focus back and becomes the focused row for real.
   *
   * Exactly one index either way — never two, never none while rows are
   * on screen.
   */
  const tabStopIndex = useMemo(() => {
    if (virtualRows.length === 0) return focusIndex;
    const mounted = virtualRows.some((v) => v.index === focusIndex);
    return mounted ? focusIndex : virtualRows[0].index;
  }, [virtualRows, focusIndex]);

  /**
   * Set by the key handler when a keystroke MOVED the focus, cleared once
   * the DOM focus has followed.
   *
   * Without the flag the effect below would pull focus into the tree on
   * every render that changes `focusIndex` — including the very first
   * one, and including a selection made from another column — stealing
   * the caret from whatever the user was actually typing in.
   */
  const pendingFocusRef = useRef(false);

  /**
   * Move the real DOM focus onto the focused row, scrolling it into
   * existence first if the virtualizer has not mounted it.
   *
   * Runs again after the scroll because `virtualRows` is in the deps: the
   * scroll changes the mounted window, which re-renders, which re-runs
   * this effect — and on that pass the row exists and can take focus.
   * That is the whole reason the tree can focus a row 400 places down a
   * list where only ~20 rows are in the DOM.
   */
  useEffect(() => {
    if (!pendingFocusRef.current) return;
    if (focusIndex < 0) {
      pendingFocusRef.current = false;
      return;
    }
    const rowEl = scrollRef.current?.querySelector<HTMLElement>(
      `.task-tree-virtual-row[data-index="${focusIndex}"] .task-tree-node-row`,
    );
    // In cell mode the focus target is the CELL, addressed by the same
    // `data-col` the tab stop is placed on — the row is only the way in
    // to it. A cell that is somehow absent (a column switched off in the
    // same frame) falls back to its row rather than dropping focus to
    // the document body.
    const el =
      focusedCol === null
        ? rowEl
        : (rowEl?.querySelector<HTMLElement>(
            `.task-tree-cell[data-col="${focusedCol}"]`,
          ) ?? rowEl);
    if (el) {
      pendingFocusRef.current = false;
      el.focus();
      return;
    }
    // The row is not mounted: scroll to it and let the re-render that
    // follows re-enter this effect, where the row now exists and takes
    // focus. `pendingFocusRef` stays set across that hop — it is what
    // tells the second pass that this focus is still owed.
    virtualizer.scrollToIndex(focusIndex, { align: 'auto' });
  }, [focusIndex, focusedCol, virtualRows, virtualizer]);

  /**
   * Move the roving tab stop (and the DOM focus) to a cursor: row
   * `index`, and either the row itself (`col === null`) or one of its
   * cells. Both halves move together — there is no keystroke that
   * changes one without settling the other.
   */
  const focusCursor = useCallback(
    (index: number, col: number | null) => {
      const key = rowKeys[index];
      if (key === undefined) return;
      pendingFocusRef.current = true;
      setFocusedKey(key);
      setFocusedColState(col);
    },
    [rowKeys],
  );

  /**
   * Keep the tab stop wherever focus actually landed — a click on a row,
   * a Tab into the tree, a screen reader's own cursor. Addressed by id
   * because that is all the row knows about itself; the canonical row
   * wins when an issue is on screen twice, which is the row a reader
   * reaching in from outside means.
   */
  const handleRowFocus = useCallback(
    (id: string, col?: number | null) => {
      const i = treeRowIndexById(rows, id);
      const key = rowKeys[i];
      if (key === undefined) return;
      setFocusedKey(key);
      // `undefined` means the row could not say which axis focus landed
      // on — it went to the chevron or the jump button inside a cell,
      // which are neither the row nor a cell and must not silently drag
      // the cursor onto one. A real `null` (the row) or a number (that
      // cell) settles the mode.
      if (col !== undefined) setFocusedColState(col);
    },
    [rows, rowKeys],
  );

  /**
   * The row was operated with the POINTER: move the tab stop onto it, so
   * that picking the keyboard back up continues from the row just
   * clicked rather than from wherever the stop was left.
   *
   * DOM focus follows only when it is already inside the tree. Two
   * reasons for the condition. If focus is elsewhere — a search box,
   * another column — a click on a row is not a request to move it, and
   * yanking it here would eat the reader's next keystroke. If focus IS
   * in the tree, it MUST move: the chevron suppresses its own focus (see
   * `TaskTreeNode`), so without this the tab stop and the focus ring
   * would end up on different rows, and the next Enter would open a row
   * other than the one that looks focused.
   */
  const adoptRow = useCallback(
    (id: string) => {
      const key = rowKeys[treeRowIndexById(rows, id)];
      if (key === undefined) return;
      const active = document.activeElement;
      if (active && scrollRef.current?.contains(active)) {
        pendingFocusRef.current = true;
      }
      setFocusedKey(key);
    },
    [rows, rowKeys],
  );

  const handleSelect = useCallback(
    (item: IssueTreeRowItem) => {
      adoptRow(item.id);
      onSelect(item);
    },
    [adoptRow, onSelect],
  );

  const handleToggle = useCallback(
    (id: string) => {
      adoptRow(id);
      onToggle(id);
    },
    [adoptRow, onToggle],
  );

  /**
   * Typeahead buffer. A ref, not state: it never affects what is
   * rendered, and re-rendering the whole list on every keystroke of a
   * search that only moves focus would be a real cost on a long tree.
   */
  const typeaheadRef = useRef<{ buffer: string; at: number }>({
    buffer: '',
    at: 0,
  });

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (focusIndex < 0) return;
      // ⌘ is folded into Ctrl: the grid-wide jumps are Ctrl+Home /
      // Ctrl+End in APG, and on a Mac keyboard the same gesture is typed
      // with ⌘. Alt is not: Alt+← is the browser's own history.
      const ctrl = e.ctrlKey || e.metaKey;
      if (e.altKey) return;

      // sk-285.2.19 — Tab walks the interactive controls INSIDE the
      // focused row (the chevron, the "↻ see" jump) and then leaves the
      // grid, which is the treegrid contract. Those controls keep
      // `tabIndex={-1}` — the roving tabindex allows exactly one element
      // at 0, and it is the row or the cell — so the browser's own Tab
      // would skip straight past them; walking them here is what makes
      // them reachable without a second tab stop. Once past the last
      // one, the keystroke is NOT prevented and focus leaves the grid
      // the way it always did.
      //
      // There is deliberately no Shift+Tab mirror. A row holds at most
      // ONE control — the chevron needs `isExpandableRow`, which
      // excludes reference rows, and the "↻ see" jump exists only on
      // reference rows — and the tab stop (the row, or in cell mode the
      // cell the chevron sits in) is that control's ANCESTOR, so it
      // comes before it in the tab order and the browser's own
      // Shift+Tab already walks back onto it. A hand-written mirror
      // would be code with no observable effect: verified by deleting it
      // again under `TaskTreeVirtualList.treegrid.test.tsx`, which does
      // not notice. It becomes worth writing the day a row grows a
      // second control, and not before.
      if (e.key === 'Tab' && !e.shiftKey && !ctrl) {
        const rowEl = scrollRef.current?.querySelector<HTMLElement>(
          `.task-tree-virtual-row[data-index="${focusIndex}"] .task-tree-node-row`,
        );
        const controls = rowEl
          ? Array.from(
              rowEl.querySelectorAll<HTMLElement>(
                'button, a[href], input, select, textarea',
              ),
            )
          : [];
        const active = document.activeElement as HTMLElement | null;
        const at = active ? controls.indexOf(active) : -1;
        const next = controls[at + 1];
        if (next) {
          e.preventDefault();
          next.focus();
        }
        return;
      }
      if (ctrl && e.key !== 'Home' && e.key !== 'End') return;

      const action = resolveTreeGridKey(
        e.key,
        {
          rows,
          cursor: { row: focusIndex, col: focusedCol },
          expanded,
          colCount: columnOrder.length,
          // A page is the number of rows the reader can actually SEE at
          // once. Read off the live scroll container rather than held in
          // state: it changes with every window resize and with the
          // column layout, and no render depends on it.
          //
          // `- TREE_HEAD_HEIGHT_PX` because the sticky heading strip is
          // INSIDE this scroller and is painted over the top of the row
          // canvas — the same fact `scrollMargin` states to the
          // virtualizer a few lines up. The rows the reader can see are
          // the ones below it, so a page measured against the full
          // `clientHeight` counts one row that is behind the header and
          // steps a row further than the screenful it claims to move by.
          pageSize: Math.max(
            1,
            Math.floor(
              ((scrollRef.current?.clientHeight ?? 0) - TREE_HEAD_HEIGHT_PX) /
                TREE_ROW_HEIGHT_PX,
            ),
          ),
        },
        { ctrl },
      );

      if (action.kind !== 'none') {
        // Enter is the one key an inner control may still want for
        // itself: pressed while the chevron or the "↻ see" button holds
        // focus, it must operate THAT button rather than open the row.
        // A CELL may activate — clicking one selects the issue, and the
        // keyboard does not get to disagree with the mouse about that.
        const target = e.target instanceof HTMLElement ? e.target : null;
        const onRow = !!target?.classList.contains('task-tree-node-row');
        const onCell = !!target?.classList.contains('task-tree-cell');
        if (action.kind === 'activate' && !onRow && !onCell) return;

        e.preventDefault();
        switch (action.kind) {
          case 'focus':
            focusCursor(action.cursor.row, action.cursor.col);
            break;
          case 'expand':
          case 'collapse':
            // One toggle, both directions: the resolver only ever names a
            // row whose state is the opposite of the action.
            onToggle(action.id);
            break;
          case 'expandSiblings':
            for (const id of action.ids) onToggle(id);
            break;
          case 'activate':
            focusCursor(action.index, focusedCol);
            onSelect(rows[action.index].item);
            break;
        }
        return;
      }

      // Typeahead — every printable single character except the space,
      // which is left to the browser (the tree has no Space binding, and
      // no issue title starts with one anyway).
      if (e.key.length !== 1 || e.key === ' ') return;
      const now = Date.now();
      const ta = typeaheadRef.current;
      const buffer =
        now - ta.at > TYPEAHEAD_RESET_MS
          ? e.key.toLowerCase()
          : ta.buffer + e.key.toLowerCase();
      ta.buffer = buffer;
      ta.at = now;
      // A buffer that is still growing must be allowed to match the row
      // it already selected ("d" → demo-1, then "de" → still demo-1);
      // a fresh single letter must move on, so that pressing it again
      // walks through the rows starting with it.
      const target = resolveTypeahead(rows, focusIndex, buffer, buffer.length > 1);
      if (target < 0) return;
      e.preventDefault();
      // Typeahead is a ROW search in both patterns, so the column rides
      // along untouched: a reader scanning the assignee column and
      // jumping by title stays in that column.
      focusCursor(target, focusedCol);
    },
    [
      rows,
      expanded,
      focusIndex,
      focusedCol,
      columnOrder,
      focusCursor,
      onToggle,
      onSelect,
    ],
  );

  /**
   * A heading was clicked. The policy lives in `lib/taskSort.ts`
   * (`nextSortForColumn`): a different column opens at its natural
   * direction, the column already sorted reverses. A column with no sort
   * key never reaches here — it renders as plain text, with no button —
   * and the `null` guard is what makes that true rather than intended.
   */
  const handleHeadSort = useCallback(
    (column: TreeColumn) => {
      const next = nextSortForColumn(column, { sort, direction: sortDir });
      if (next) onSortChange(next);
    },
    [sort, sortDir, onSortChange],
  );

  /**
   * The heading of the sort currently in force, spelled out: the field's
   * own name (the SAME string the «Sort by» combobox shows — one order,
   * named one way) plus the direction it is read in.
   *
   * `relevance` carries no direction: it means "keep the server's RRF
   * ranking", and there is nothing of ours to reverse.
   */
  const sortFieldLabel = t(
    `filters:sort.${sort === 'priority-updated' ? 'priorityUpdated' : sort}`,
  );
  const sortOrderLabel =
    sort === 'relevance'
      ? sortFieldLabel
      : t('tree.sortOrder', {
          field: sortFieldLabel,
          direction: t(sortDir === 'asc' ? 'tree.sortAsc' : 'tree.sortDesc'),
        });

  /**
   * The ONE column whose heading shows the sort — `null` while the
   * composite `priority-updated` is in force, which points at no single
   * column (see `sortedTreeColumn`). Asked once, so the strip cannot end
   * up with two headings claiming the order, or none.
   */
  const sortedColumn = sortedTreeColumn(sort);

  /**
   * sk-285.2.19 (step 5) — is the MANDATORY standing band (sk-135)
   * currently displacing anything?
   *
   * `partitionStandingTreeRows` floats standing ROOTS above every other
   * root AFTER the sort has run, so while it is doing that the caption's
   * promise — "sorted by X, within each branch" — is not the whole
   * truth: the top of the table is a band that no sort key put there and
   * no direction moves. The caption says so, but only when it is
   * happening: a table with no standing root, or with nothing but
   * standing roots, is exactly as sorted as the first clause claims, and
   * a permanent caveat about an absent band is noise the reader learns
   * to skip past.
   */
  const standingLeads = useMemo(() => {
    let standingRoot = false;
    let plainRoot = false;
    for (const r of rows) {
      if (r.depth !== 0) continue;
      if (r.item.status === 'standing') standingRoot = true;
      else plainRoot = true;
      if (standingRoot && plainRoot) return true;
    }
    return false;
  }, [rows]);

  return (
    <>
      {/* sk-285.2.19 (step 4) — the PRICE of decision A, stated instead
          of discovered.

          Sorting a tree table sorts children INSIDE each parent: the
          hierarchy never breaks, and in exchange the order is local. By
          «updated», the top row is the freshest task of the FIRST branch
          — the project's freshest task is somewhere further down, inside
          whichever branch owns it. A reader who assumes a global ranking
          reads the table wrong and has no way to find that out from the
          rows themselves, so the table says it, in words, next to the
          headings that do it.

          OUTSIDE the scroll container on purpose: the virtualizer
          positions every row at an offset measured from the top of that
          container (that is what `scrollMargin` accounts for, and it
          accounts for the header strip alone), so anything else sharing
          it above the rows would shift all of them. Same reason the
          too-large banner sits outside it in `TasksColumn`. */}
      <div className="task-tree-sort-note" id={sortNoteId}>
        {t('tree.sortScope', { order: sortOrderLabel })}
        {standingLeads ? ` ${t('tree.sortScopeStanding')}` : ''}
      </div>
      <div
        className="col-body tasks-body tasks-tree-table"
        ref={scrollRef}
        style={tableStyle}
      >
        {/* sk-285.2.19 — the column headings. Sticky INSIDE this scroller,
            so they hold their place while the rows scroll under them and
            travel with the columns when the table is panned sideways. Kept
            out of the `role="treegrid"` canvas below, which may own rows
            and rowgroups and nothing else.

            sk-285.2.19 (step 3) — it is now the grid's HEADER ROW: one
            `role="row"` of `columnheader`s, joined to the treegrid by
            `aria-owns` because it cannot be its DOM child (see «Why the
            grid is the canvas» in the module doc). `aria-rowindex={1}` is
            what places it first — neither DOM order nor the order
            `aria-owns` implies can say that here. */}
        <div
          className="task-tree-head"
          id={headId}
          role="row"
          aria-rowindex={1}
        >
          {columnOrder.map((column, i) => {
            // The heading text is the same string the column PICKER shows
            // (`filters:treeColumns.*`), deliberately: a column switched on
            // in the picker has to be findable by the same word in the
            // table. `filters` is its own namespace — the picker reads it
            // with `useTranslation('filters')`, and this component's
            // default namespace is `tasks`, hence the explicit prefix.
            const label = t(`filters:treeColumns.${column}`);
            // sk-285.2.19 (step 4) — a heading is clickable exactly when
            // the app's sort model has a key for it; see «Which columns can
            // be clicked» in `lib/taskSort.ts`. `null` here is not "not
            // wired up yet", it is "there is no such order".
            const sortKey = treeColumnSortKey(column);
            // Which heading shows the order is one question with one
            // answer (`sortedColumn`), not a per-heading comparison that
            // could be spelled differently here than it is anywhere else.
            const isSorted = sortedColumn !== null && column === sortedColumn;
            return (
              <div
                key={column}
                className={
                  `task-tree-head-cell task-tree-head-cell--${column}` +
                  (isSorted ? ' task-tree-head-cell--sorted' : '')
                }
                role="columnheader"
                // 1-based, and the same number the cell under it carries:
                // this is how a reader maps a value to its heading when the
                // two are not in the same subtree.
                aria-colindex={i + 1}
                /**
                 * Sortable headings state their state; the others say
                 * nothing at all rather than `none`, which would advertise
                 * a sort control that does not exist. Only ONE heading is
                 * ever `ascending` / `descending` — and while the composite
                 * `priority-updated` is in force, none is (it is two keys
                 * at once; the caption names it instead).
                 */
                aria-sort={
                  sortKey === null
                    ? undefined
                    : isSorted
                      ? sortDir === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : 'none'
                }
                title={
                  sortKey === null
                    ? label
                    : t('tree.sortColumnTitle', { column: label })
                }
              >
                {sortKey === null ? (
                  label
                ) : (
                  <button
                    type="button"
                    className="task-tree-head-sort"
                    // The caveat about what sorting a TREE does. Read out
                    // with the button, so the trade-off reaches a reader
                    // who never sees the caption under the header.
                    aria-describedby={sortNoteId}
                    onClick={() => handleHeadSort(column)}
                  >
                    <span className="task-tree-head-sort-label">{label}</span>
                    {/* Direction glyph. `aria-hidden`: `aria-sort` on the
                        heading already says this, and says it in words.

                        sk-285.7.2.88 — DRAWN, not typed. These were
                        U+2191 / U+2193 / U+21C5 written as escapes,
                        which is why the enumeration that opened this
                        task (a scan for the literal characters) never
                        saw them: the escape hides the mark from every
                        reader but the compiler. §8 names all three —
                        `arrow-up`, `arrow-down`, `arrows-sort` — and
                        fixes stroke 1.75 and the 16/20/24 scale, none
                        of which a character can take. */}
                    <span className="task-tree-head-sort-arrow" aria-hidden>
                      {isSorted ? (
                        sortDir === 'asc' ? (
                          <IconArrowUp size={16} stroke={1.75} />
                        ) : (
                          <IconArrowDown size={16} stroke={1.75} />
                        )
                      ) : (
                        <IconArrowsSort size={16} stroke={1.75} />
                      )}
                    </span>
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {/* Full-height canvas: holds the scrollbar honest while only the
            visible slice exists as DOM. Each row is absolutely positioned
            at its measured offset — NOT laid out in flow — because in flow
            the rows would stack from the top of the canvas instead of at
            the scroll position they belong to. */}
        {/* sk-285.2.11 — the grid role sits on the CANVAS, not on the
            scroll container: the canvas holds the rows and nothing else,
            while the scroller also carries the infinite-scroll sentinel and
            the "loading more" line, neither of which is a row and neither
            of which a grid may own. Keydown is bound here because
            every row's events bubble through it. */}
        <div
          className="task-tree-virtual-canvas"
          // sk-285.2.19 — `treegrid`, not `tree`: the rows have columns a
          // reader can move through, which is a different APG pattern and
          // a different keyboard contract, not a renamed one.
          role="treegrid"
          aria-label={t('tree.ariaLabel')}
          // The header row, adopted without moving it in the DOM.
          aria-owns={headId}
          /**
           * sk-285.2.19 — the size of the grid, which a reader can no
           * longer count for itself: only a window of rows is mounted, and
           * `aria-rowindex` below is meaningless without a total to read
           * it against. Counted over the FULL row list plus the header
           * row, never over the mounted slice.
           *
           * `-1` while another page is still to come, for the reason
           * `aria-setsize` is -1 then (sk-285.2.13): the total is not
           * unknown-to-us, it is genuinely not yet decided, and announcing
           * a number that grows under the reader is worse than announcing
           * none. Same source of truth, so the two can never disagree.
           */
          aria-rowcount={hasMoreRows ? -1 : rows.length + 1}
          // Columns, unlike rows, are all in the DOM — but the count is
          // still stated, because it is the denominator every cell's
          // `aria-colindex` is read against.
          aria-colcount={columnOrder.length}
          onKeyDown={handleKeyDown}
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualRows.map((v) => {
            const row = rows[v.index];
            if (!row) return null;
            return (
              <div
                key={v.key}
                // sk-285.2.19 — `data-index` without the
                // `virtualizer.measureElement` ref that used to accompany
                // it: rows are a fixed height now, so nothing is measured
                // (see «Library choice» in the module doc). The attribute
                // stays because the focus effect addresses a row by it.
                data-index={v.index}
                className="task-tree-virtual-row"
                // sk-285.2.13 — a POSITIONING box, not a node of the tree:
                // it exists so the row has something to be positioned by
                // (and, before sk-285.2.19, something to measure). Without
                // an explicit role it sits between `role="treegrid"` and
                // `role="row"` as a generic element, which breaks the
                // grid's ownership of its rows and can stop a reader
                // announcing them at all — level, position and set size
                // included. `presentation` keeps `data-index` and the
                // positioning working while removing the box from the
                // accessibility tree.
                role="presentation"
                // `- TREE_HEAD_HEIGHT_PX`: the offsets the virtualizer
                // reports are measured from the top of the SCROLL
                // container (that is what `scrollMargin` told it), while
                // this row is positioned inside the canvas, which starts
                // one header height further down. Subtracting it back out
                // is the other half of that option — without it every row
                // would be drawn a header lower than it is scrolled to.
                style={{
                  transform: `translateY(${v.start - TREE_HEAD_HEIGHT_PX}px)`,
                }}
              >
                <TaskTreeNode
                  row={row}
                  selectedId={selectedId}
                  expanded={expanded}
                  searchQuery={searchQuery}
                  componentNames={componentNames}
                  columns={columnOrder}
                  columnsMask={columnsMask}
                  onSelect={handleSelect}
                  onToggle={handleToggle}
                  onJumpToFirst={onJumpToFirst}
                  focused={v.index === tabStopIndex}
                  // Which cell of the focused row owns the tab stop, or
                  // null for the row itself. Only read when `focused`.
                  focusedColumn={focusedCol}
                  onRowFocus={handleRowFocus}
                  position={rowPositions[v.index]}
                  // 1-based and header-inclusive: the header row is index
                  // 1, so the first data row is 2. This is the row's place
                  // in the WHOLE grid, which is the one thing the mounted
                  // window cannot state for itself.
                  ariaRowIndex={v.index + 2}
                />
              </div>
            );
          })}
        </div>
        {footer}
      </div>
    </>
  );
});
