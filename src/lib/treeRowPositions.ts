/**
 * sk-285.2.13 — `aria-setsize` / `aria-posinset` for every row of the
 * Tasks tree: how many siblings a row has under its own parent, and
 * which one of them it is.
 *
 * ─── Why the tree needs them at all ────────────────────────────────
 *
 * WAI-ARIA APG lets a tree omit both attributes only while the COMPLETE
 * set of nodes is present in the DOM — then assistive tech can count the
 * siblings itself. Two things make that permanently false here:
 *
 *   - the list is virtualized (sk-285.2.10), so only a window of ~20 rows
 *     around the viewport exists as DOM at any moment;
 *   - the rows are FLAT by construction — one `role="row"` per row (a
 *     `role="treeitem"` until sk-285.2.19 turned the tree into a
 *     treegrid; the attributes below moved host, not meaning), no nested
 *     `role="group"` wrapper — so even with every row mounted there is
 *     no container whose children a reader could count.
 *
 * The flat shape is not an accident to be fixed here: the virtualizer
 * positions each row absolutely at its measured offset, and a group
 * element wrapping a subtree would have to span rows that are not in the
 * DOM. `aria-setsize` / `aria-posinset` are precisely the escape hatch
 * the spec provides for that situation, and they are the ONLY way this
 * tree can state a level's size and a row's place in it.
 *
 * `aria-level` is deliberately NOT computed here: it is `depth + 1` and
 * needs no knowledge of any other row, so the renderer keeps deriving it
 * from the row it already holds. This module exists for the two facts a
 * single row genuinely cannot know about itself.
 *
 * ─── Why over the FULL row list, and what "full" cannot mean ──────
 *
 * The input is the whole post-collapse row list (`visibleRows` in
 * TasksColumn — the same array the virtualizer indexes into), never the
 * virtual window. A row's set size must not depend on the SCROLL
 * POSITION: computed over the mounted slice it would announce "3 of 7"
 * and then "3 of 4" for the same task, which is worse than announcing
 * nothing. The cost is one linear pass over a list the caller already
 * holds and already memoises.
 *
 * That closes the virtualization axis, and only that one. The list is
 * ALSO a prefix: on the client-side tree path the rows are built from a
 * paginated query (`useTasks`, 500 per page) whose sentinel lives inside
 * this very scroll container, so reaching the bottom fetches another
 * page and `rows` grows underneath the numbering — a root that was
 * "1 of 500" would become "1 of 1000" without anything the reader did
 * being wrong. A count over a prefix is not a small count, it is a false
 * one.
 *
 * ARIA has the answer for exactly this: `aria-setsize="-1"` states that
 * the size of the set is NOT KNOWN. So the caller passes `complete`, and
 * while a page is outstanding every row reports `SET_SIZE_UNKNOWN`
 * instead of a number that is about to change.
 *
 * Every row, not just the roots: the tree is assembled client-side from
 * a flat page of issues, and the page boundary can fall anywhere, so the
 * next page may bring a child of ANY loaded issue. No set — root or
 * nested — is provably closed while another page exists, and claiming
 * exactness for the deep ones would be a guess wearing the costume of a
 * fact.
 *
 * `posInSet` stays a real number throughout. ARIA has no "unknown" for
 * it, the row's place among the siblings loaded SO FAR is genuinely
 * known, and `-1` on the size is precisely the signal that tells the
 * reader the total behind it is provisional.
 *
 * When the last page has arrived (`complete`, the common case — most
 * projects are under one page) every row carries its exact size again.
 * The layered path is not paginated at all (the endpoint caps at 1000
 * nodes and 422s past that), so it is always complete.
 *
 * ─── Why collapsing a branch does not renumber anything ────────────
 *
 * Siblings are the children of ONE parent, not "every row at this
 * depth". Two different parents each holding three children give two
 * sets of three — never one set of six — so a reader hears "2 of 3"
 * inside a branch rather than a position in a level-wide run that has no
 * meaning to them.
 *
 * That definition is also what makes collapse harmless. Collapsing a row
 * removes its DESCENDANTS from the list; the row itself stays, still a
 * child of its own parent, still counted. So a collapsed sibling neither
 * shrinks the set it belongs to nor shifts the numbers of the rows after
 * it. The one thing that does change is the collapsed row's own subtree,
 * which is not on screen to be numbered.
 *
 * ─── Why reference and context rows are counted ────────────────────
 *
 * Both are real `role="row"` elements that arrow keys stop on
 * (`treeKeyboardNav.ts` navigates over every visible row, operable or
 * not), so both must be numbered: a set that skipped them would count to
 * fewer rows than Down actually visits, and the reader would be told
 * they are at "3 of 3" with two more stops still to come.
 *
 *   - reference rows (`isReference`) — cycle pointers and the `<hidden>`
 *     cross-project stubs. They occupy a position under their parent
 *     exactly like any other row; that they cannot be opened changes
 *     nothing about where they sit.
 *   - context rows (`isContext`, sk-285.2.7/.8) — real openable issues
 *     held on screen to keep a branch whole. Dimmed, but visible,
 *     focusable and selectable.
 *
 * ─── How the parent of a row is recovered ──────────────────────────
 *
 * `FlatTreeRow` carries no parent pointer, so the parent is recovered
 * POSITIONALLY, from the invariant the list is built on: the rows are a
 * pre-order DFS, therefore a row's parent is the nearest PRECEDING row
 * with a smaller `depth`. A row at depth 0 has no parent, and all depth-0
 * rows form one set (the tree's roots).
 *
 * The alternative — `item.parentIdCurrent` — is the wrong parent twice
 * over. The tree's edges are typed dependencies, so a row can hang off a
 * `blocks` / `related` / `discovered-from` edge that has nothing to do
 * with the issue's parent-child field; and one issue can occupy several
 * rows at once under several different parents (canonical row plus
 * pointer rows), which a single field on the shared issue record cannot
 * express. The position in the DFS list is what the reader is actually
 * navigating, so the position is what the numbering has to follow.
 *
 * The stack below implements "nearest preceding row of smaller depth"
 * literally rather than indexing by depth, so a malformed list that
 * skips a level (depth 0 → depth 2) still resolves to a real ancestor
 * instead of reading an empty slot.
 */

import type { FlatTreeRow } from './flattenTree';

/**
 * The `aria-setsize` value that means "the size of this set is not
 * known" — the spec's own escape hatch, and the only honest answer while
 * the row list is still a page short of the result set.
 */
export const SET_SIZE_UNKNOWN = -1;

/** The two set-relative facts a single row cannot derive on its own. */
export interface TreeRowPosition {
  /**
   * `aria-setsize`: how many children this row's parent has, or
   * `SET_SIZE_UNKNOWN` when more rows are still to be fetched.
   */
  setSize: number;
  /** `aria-posinset`: this row's 1-based place among those children. */
  posInSet: number;
}

export interface TreeRowPositionOptions {
  /**
   * Whether `rows` is the WHOLE result set rather than a loaded prefix.
   *
   * False while the paginated query behind the tree has another page:
   * every set is then open-ended, so every row reports
   * `SET_SIZE_UNKNOWN` rather than a total the next scroll will change.
   * Defaults to true — the shape of a list that is not paginated at all.
   */
  complete?: boolean;
}

/**
 * Set size and position for every row, positionally matching `rows`.
 *
 * `rows` must be the post-collapse DFS list, in render order — the same
 * array the virtualizer indexes into, never a window of it: numbering a
 * window would produce sizes that change as the reader scrolls.
 *
 * Pass `complete: false` when that array is a page short of the full
 * result set; see the module header for why the answer is then `-1` on
 * every row rather than a count of what happens to be loaded.
 */
export function computeTreeRowPositions(
  rows: readonly FlatTreeRow[],
  { complete = true }: TreeRowPositionOptions = {},
): TreeRowPosition[] {
  const positions: TreeRowPosition[] = new Array(rows.length);

  // Index of each row's parent; -1 for roots. Roots share the sentinel,
  // which is what makes them one set.
  const parentOf: number[] = new Array(rows.length);
  // Open ancestors of the row being visited, innermost last. Only their
  // depths are consulted, so the array doubles as the DFS spine.
  const ancestors: number[] = [];

  for (let i = 0; i < rows.length; i++) {
    const depth = rows[i].depth;
    // Everything at or below this depth is a closed branch, not an
    // ancestor: pop until the top is strictly shallower.
    while (
      ancestors.length > 0 &&
      rows[ancestors[ancestors.length - 1]].depth >= depth
    ) {
      ancestors.pop();
    }
    parentOf[i] = ancestors.length > 0 ? ancestors[ancestors.length - 1] : -1;
    ancestors.push(i);
  }

  // Second pass: the size of a set is only known once all of it has been
  // seen, so count first, then walk again handing out places.
  const sizes = new Map<number, number>();
  for (let i = 0; i < rows.length; i++) {
    const p = parentOf[i];
    sizes.set(p, (sizes.get(p) ?? 0) + 1);
  }

  const nextPos = new Map<number, number>();
  for (let i = 0; i < rows.length; i++) {
    const p = parentOf[i];
    const pos = (nextPos.get(p) ?? 0) + 1;
    nextPos.set(p, pos);
    // The place is always the real one; only the total is withheld when
    // the list is a prefix — that is the whole meaning of `-1` here.
    positions[i] = {
      setSize: complete ? (sizes.get(p) ?? 1) : SET_SIZE_UNKNOWN,
      posInSet: pos,
    };
  }

  return positions;
}
