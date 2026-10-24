/**
 * sk-285.2.19 — the WAI-ARIA APG keyboard contract for the Tasks TABLE,
 * as a pure resolver: (key, visible rows, cursor, expansion set, table
 * shape) → one action the renderer performs.
 *
 * ─── Why this is a second module and not an edit of the first ───────
 *
 * `treeKeyboardNav.ts` implements the TREE pattern, and tree and
 * treegrid are two patterns, not one pattern with different attribute
 * names. The difference is not decoration:
 *
 *   - focus has TWO modes here. It sits on a row (as in a tree) or on a
 *     single cell of a row, and half the keys read differently in each;
 *   - `Home` / `End` gain a second reading: still «first / last row»
 *     while a row holds focus, but «first / last cell of THIS row» once
 *     a cell does — and `Ctrl+Home` / `Ctrl+End` reach the ends of the
 *     grid from either mode, keeping the column;
 *   - `Page Up` / `Page Down` exist at all.
 *
 * So the cursor is `{row, col}` rather than an index, and the action can
 * name a cell. Both of those change the resolver's TYPES, which is the
 * honest signal that this is a different contract: had it been folded
 * into `resolveTreeKey`, every existing caller and every one of its
 * thirteen pinned rules would have had to be restated in terms of a
 * cursor that the tree pattern has no concept of.
 *
 * ─── …but the tree rules are REUSED where the two patterns AGREE ───
 *
 * Up/Down, Enter and `*` are word for word the tree contract — one
 * visible row, activate, open the siblings — over the same flat
 * post-collapse row list and with the same two exceptions for reference
 * and context rows. Restating them here would be a second copy free to
 * drift from the one `treeKeyboardNav.test.ts` guards, and the two
 * copies would disagree about exactly the rows that are hardest to
 * reason about (a `<hidden>` stub, a permanently-open context parent).
 * So those keys DELEGATE to `resolveTreeKey` and this module lifts the
 * answer into a cursor.
 *
 * Right, Left, Home and End are NOT the tree's, and the difference is
 * the whole reason this module exists. They are quoted below, in full,
 * from the source they implement — because they were once written from
 * memory of the tree pattern, and three of the four came out wrong.
 *
 * ─── The contract, quoted ──────────────────────────────────────────
 *
 * WAI-ARIA APG, treegrid pattern example «treegrid-1», table «Keyboard
 * Support» (https://www.w3.org/WAI/ARIA/apg/patterns/treegrid/examples/
 * treegrid-1/), verbatim:
 *
 *   Right Arrow — «If a row is focused, and it is collapsed, expands the
 *   current row. If a row is focused, and it is expanded, focuses the
 *   first cell in the row. If a cell is focused, moves one cell to the
 *   right. If focus is on the right most cell, focus does not move.»
 *
 *   Left Arrow — «If a row is focused, and it is expanded, collapses the
 *   current row. If a row is focused, and it is collapsed, moves to the
 *   parent row (if there is one). If a cell in the first column is
 *   focused, focuses the row. If a cell in a different column is
 *   focused, moves focus one cell to the left.»
 *
 *   Home — «If a row is focused, moves to the first row. If a cell is
 *   focused, moves focus to the first cell in the row containing focus.»
 *
 *   End — «If a row is focused, moves to the last row. If a cell is
 *   focused, moves focus to the last cell in the row containing focus.»
 *
 *   Control + Home — «If a row has focus, moves focus to the first row.
 *   If a cell has focus, moves focus to the cell in the first row in the
 *   same column as the cell that had focus.»
 *
 *   Control + End — «If a row has focus, moves focus to the last row. If
 *   a cell has focus, moves focus to the cell in the last row in the same
 *   column as the cell that had focus.»
 *
 * The pattern page (https://www.w3.org/WAI/ARIA/apg/patterns/treegrid/,
 * «Keyboard Interaction») answers the one case the example's table
 * leaves open — a row that is neither expanded nor collapsible:
 *
 *   Right Arrow — «If focus is on a collapsed row, expands the row. If
 *   focus is on an expanded row or is on a row that does not have child
 *   rows, moves focus to the first cell in the row.»
 *
 * — and is where the page keys come from at all:
 *
 *   Page Down — «If focus is on a row, moves focus down an
 *   author-determined number of rows, typically scrolling so the bottom
 *   row in the currently visible set of rows becomes one of the first
 *   visible rows.»
 *
 *   Page Up — «If focus is on a row, moves focus up an author-determined
 *   number of rows, typically scrolling so the top row in the currently
 *   visible set of rows becomes one of the last visible rows.»
 *
 * ─── The two places this deliberately reads past the quote ─────────
 *
 * 1. Left on a COLLAPSED row climbs to the parent, per the example
 *    above. The pattern page says instead that «focus does not move».
 *    The example is the newer and more specific text, it is what the
 *    tree pattern does, and it is what `resolveTreeKey` already
 *    implements — so the two halves of this table agree with each other
 *    as well as with the example.
 *
 * 2. Left on a CONTEXT row (sk-285.2.7 — a parent held on screen to keep
 *    a matched branch whole) climbs rather than collapses, even though
 *    the row is expanded. Context rows are permanently open and carry no
 *    chevron: collapsing is not a thing the user can ask for by any
 *    other means either, so a Left that visibly did nothing would be the
 *    only dead keystroke in the table. That decision is the tree's, is
 *    documented in `treeKeyboardNav.ts`, and reaches here through the
 *    delegation.
 *
 * ─── The junction between the two modes ────────────────────────────
 *
 * Right is the ONLY keyboard route into cell mode (row → first cell) and
 * Left on the first cell is the only route out (cell → row). Home and
 * End do not cross the line in either direction: on a row they are the
 * ends of the GRID, in a cell the ends of the ROW. That is the quoted
 * contract, and it is also what keeps the two modes distinguishable —
 * a reader who never presses Right never lands in a cell.
 *
 * Typeahead is not restated either: `resolveTypeahead` moves focus to a
 * ROW by title, which is the same question in both patterns. The caller
 * keeps using it directly and simply preserves the column it was on.
 */

import { resolveTreeKey, type TreeKeyAction } from './treeKeyboardNav';
import type { FlatTreeRow } from './flattenTree';

/**
 * Where focus is.
 *
 * `col === null` is ROW mode — the row itself holds focus and the tab
 * stop, exactly as a treeitem did. A number is CELL mode: that column of
 * that row holds both. There is no third state, and no state in which
 * both a row and one of its cells are focused.
 */
export interface TreeGridCursor {
  /** Index into the VISIBLE rows (post-collapse), as in the tree. */
  row: number;
  /** Column index into the rendered column order, or null in row mode. */
  col: number | null;
}

export interface TreeGridNavContext {
  /** Visible rows, in render order (post-collapse DFS). */
  rows: readonly FlatTreeRow[];
  cursor: TreeGridCursor;
  /** Effective expansion set the rows were built with. */
  expanded: ReadonlySet<string>;
  /**
   * How many columns the table currently prints, the pinned title column
   * included — i.e. `treeColumnOrder(...).length`. It is what `End` and
   * the right-hand wall are measured against, and it changes whenever
   * the user switches a column on or off.
   */
  colCount: number;
  /**
   * How many rows one `Page Up` / `Page Down` moves by: the number of
   * rows the reader can SEE at once — «the bottom row in the currently
   * visible set of rows becomes one of the first visible rows», as the
   * pattern page puts it.
   *
   * Supplied by the caller because only the rendered grid knows its own
   * height, and because «visible» is not the same as «tall enough for»:
   * the caller has a sticky heading strip painted over the top of its
   * own scroller, and the rows behind it are not part of a page.
   */
  pageSize: number;
}

/**
 * What the renderer must do.
 *
 * `focus` carries a whole CURSOR, not an index: a keystroke can move
 * along either axis, and «same row, one column right» and «same column,
 * one row down» are both a focus move. `expand` / `collapse` /
 * `expandSiblings` / `activate` are passed through from the tree
 * contract unchanged — they name rows, and a grid does not change what
 * opening or activating a row means.
 */
export type TreeGridKeyAction =
  | { kind: 'none' }
  | { kind: 'focus'; cursor: TreeGridCursor }
  | { kind: 'expand'; id: string }
  | { kind: 'collapse'; id: string }
  | { kind: 'expandSiblings'; ids: string[] }
  | { kind: 'activate'; index: number };

/** Modifier state the contract actually reads. */
export interface TreeGridModifiers {
  /** Ctrl (or ⌘, which the caller folds in) — the grid-wide jumps. */
  ctrl?: boolean;
}

const NONE: TreeGridKeyAction = { kind: 'none' };

function at(row: number, col: number | null): TreeGridKeyAction {
  return { kind: 'focus', cursor: { row, col } };
}

/**
 * Lift a tree action into the grid.
 *
 * The only branch that needs translating is `focus`, which names a ROW
 * index: it becomes a cursor on that row, keeping `col`. Keeping the
 * column is what makes Up/Down walk a single column in cell mode instead
 * of dropping the reader back onto the row — and in row mode `col` is
 * null, so the same line is also the row-mode rule.
 */
function lift(action: TreeKeyAction, col: number | null): TreeGridKeyAction {
  return action.kind === 'focus' ? at(action.index, col) : action;
}

/**
 * Resolve one keystroke against the table. Returns `none` for any key the
 * contract does not claim — including printable characters, which the
 * caller feeds to `resolveTypeahead` instead.
 */
export function resolveTreeGridKey(
  key: string,
  ctx: TreeGridNavContext,
  modifiers: TreeGridModifiers = {},
): TreeGridKeyAction {
  const { rows, cursor, expanded, colCount, pageSize } = ctx;
  const { row: index, col } = cursor;
  if (index < 0 || index >= rows.length) return NONE;
  if (colCount < 1) return NONE;

  const lastRow = rows.length - 1;
  const lastCol = colCount - 1;
  const treeCtx = { rows, index, expanded };

  // ─── Ctrl+Home / Ctrl+End: the ends of the GRID ──────────────────
  //
  // Claimed before the unmodified switch, because Home and End mean
  // something else there. Every OTHER modified keystroke is left alone:
  // Ctrl+F, ⌘←, Alt+← belong to the browser and the OS.
  if (modifiers.ctrl) {
    if (key === 'Home') return index === 0 ? NONE : at(0, col);
    if (key === 'End') return index === lastRow ? NONE : at(lastRow, col);
    return NONE;
  }

  switch (key) {
    case 'ArrowRight': {
      if (col !== null) {
        // Cell mode: one cell right, and the last cell is a wall.
        return col < lastCol ? at(index, col + 1) : NONE;
      }
      // Row mode. Exactly ONE branch opens something — «if a row is
      // focused, and it is collapsed, expands the current row» — and it
      // is the only answer taken from the tree resolver, which returns
      // `expand` for precisely the collapsed openable rows (never for a
      // reference row, never for a context row). EVERY other row goes
      // into its own cells: «if a row is focused, and it is expanded,
      // focuses the first cell in the row», widened by the pattern page
      // to «an expanded row OR a row that does not have child rows».
      //
      // What this notably does NOT do is step onto the first child. That
      // is the TREE pattern's Right, and it was here until sk-285.2.19
      // step 2: in a treegrid a descent is Down (the child is the next
      // visible row) and Right is the cell axis. Delegating the whole
      // key would silently reinstate it — hence the narrow `expand` test
      // rather than a `kind === 'none'` fallback.
      const tree = resolveTreeKey('ArrowRight', treeCtx);
      return tree.kind === 'expand' ? tree : at(index, 0);
    }

    case 'ArrowLeft': {
      if (col !== null) {
        // Cell mode: one cell left, and the FIRST cell hands focus back
        // to the row — the mirror of the Right that entered the cells,
        // and the only way back out of them.
        return col === 0 ? at(index, null) : at(index, col - 1);
      }
      // Row mode: collapse an expanded row, otherwise climb to the
      // parent — which is the tree's Left verbatim, so it delegates.
      // (See «the two places this reads past the quote» in the module
      // doc for the collapsed-row and context-row readings.)
      return lift(resolveTreeKey('ArrowLeft', treeCtx), null);
    }

    // Up and Down are the tree's rules in both modes: one visible row,
    // never an expansion. `col` rides along, so in cell mode the reader
    // walks a single column and in row mode nothing changes.
    case 'ArrowDown':
    case 'ArrowUp':
      return lift(resolveTreeKey(key, treeCtx), col);

    // Home and End read the CURSOR'S MODE, and this is the rule that was
    // wrong until sk-285.2.19 step 2 (the old code asked `col === 0`,
    // which is false for the `null` of row mode, so a row-mode Home
    // always dived into a cell). On a row they are the ends of the grid
    // — the tree's own Home/End, delegated — and only in a cell do they
    // become the ends of that row. Ctrl+Home / Ctrl+End, above, are what
    // reach the ends of the grid from INSIDE a cell.
    case 'Home':
      return col === null
        ? lift(resolveTreeKey('Home', treeCtx), null)
        : col === 0
          ? NONE
          : at(index, 0);

    case 'End':
      return col === null
        ? lift(resolveTreeKey('End', treeCtx), null)
        : col >= lastCol
          ? NONE
          : at(index, lastCol);

    // A page is the grid's own height in rows, clamped to the ends. The
    // clamp is deliberate: stopping AT the first/last row is what lets a
    // reader page to the end of a long list without counting, whereas
    // refusing the whole keystroke near an edge would strand them one
    // partial page short.
    case 'PageDown': {
      const target = Math.min(lastRow, index + Math.max(1, pageSize));
      return target === index ? NONE : at(target, col);
    }

    case 'PageUp': {
      const target = Math.max(0, index - Math.max(1, pageSize));
      return target === index ? NONE : at(target, col);
    }

    // Enter and `*` operate the ROW, from either mode: activating a cell
    // means activating the row it belongs to (the same thing clicking
    // any cell does), and the sibling expansion is a fact about rows.
    case 'Enter':
    case '*':
      return lift(resolveTreeKey(key, treeCtx), col);

    default:
      return NONE;
  }
}
