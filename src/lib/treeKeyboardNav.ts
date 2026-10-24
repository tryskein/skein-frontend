/**
 * sk-285.2.11 — the WAI-ARIA Authoring Practices keyboard contract for the
 * Tasks tree, as a PURE resolver: (key, visible rows, focused index,
 * expansion set) → one action the renderer performs.
 *
 * ─── Why a pure module and not a hook ──────────────────────────────
 *
 * The contract is thirteen rules that each depend only on the shape of
 * the row list around the focused row — «is this node open», «where does
 * its parent sit», «which rows are its siblings». Written inline in the
 * list component every one of those rules would only be reachable
 * through a rendered, virtualized, measured DOM, and each of the
 * thirteen acceptance cases would need a full component render to state
 * a fact about an array. Here they are ordinary array questions with
 * ordinary array answers, and the component keeps exactly one job:
 * carrying out the action (move DOM focus, toggle, select).
 *
 * Rejected: encoding the rules as a keymap object (`{ ArrowRight: fn }`).
 * Half the rules are conditional on the row under the cursor rather than
 * on the key — Right alone means expand, descend, or nothing — so the
 * table would hold three-branch functions anyway, and the switch reads
 * closer to the APG text it has to be checked against.
 *
 * ─── What the rows are ─────────────────────────────────────────────
 *
 * `rows` is the VISIBLE row list (`visibleRows` in TasksColumn): the DFS
 * flat list after collapse has been applied. That is what makes Up/Down
 * a simple ±1 and «first child» a lookahead — a collapsed subtree is
 * simply not in the array. Every index in an action indexes THIS array.
 *
 * Two kinds of row are navigable but not operable, per the task spec:
 *   - reference rows (`isReference`) — cycle pointers and the
 *     `<hidden>` cross-project stubs. Arrow keys pass over them, but
 *     they never expand and Enter does nothing: there is no issue behind
 *     them to open.
 *   - context rows (`isContext`, sk-285.2.7) — real openable issues held
 *     on screen to keep a branch whole. They are permanently expanded
 *     and carry no chevron, so they cannot be collapsed; Right still
 *     descends into them and Enter still opens them.
 */

import type { FlatTreeRow } from './flattenTree';

/**
 * Does this row own a chevron — i.e. can the user open and close it?
 *
 * Shared with the renderer (`TaskTreeNode`) on purpose: the row that
 * shows a chevron and the row the keyboard will expand have to be the
 * same row, and a second copy of this predicate is how those two drift.
 */
export function isExpandableRow(row: FlatTreeRow): boolean {
  return row.hasChildren && !row.isReference && !row.isContext;
}

/**
 * Is this row's subtree currently on screen?
 *
 * Context rows answer true whenever they have children: the column keeps
 * them permanently open (collapsing scaffolding would hide the rows that
 * actually matched the filter), so `expanded` is never consulted for
 * them — exactly as in `visibleRows`.
 */
export function isOpenRow(row: FlatTreeRow, expanded: ReadonlySet<string>): boolean {
  if (!row.hasChildren || row.isReference) return false;
  if (row.isContext) return true;
  return expanded.has(row.item.id);
}

export interface TreeNavContext {
  /** Visible rows, in render order (post-collapse DFS). */
  rows: readonly FlatTreeRow[];
  /** Index of the row that currently owns focus. */
  index: number;
  /** Effective expansion set the rows were built with. */
  expanded: ReadonlySet<string>;
}

/**
 * What the renderer must do. `focus` moves the roving tabindex (and the
 * DOM focus) to a row; `expand` / `collapse` / `expandSiblings` name rows
 * by ISSUE ID because that is what the column's toggle takes; `activate`
 * carries an index because the row itself (not just its id) is selected.
 */
export type TreeKeyAction =
  | { kind: 'none' }
  | { kind: 'focus'; index: number }
  | { kind: 'expand'; id: string }
  | { kind: 'collapse'; id: string }
  | { kind: 'expandSiblings'; ids: string[] }
  | { kind: 'activate'; index: number };

const NONE: TreeKeyAction = { kind: 'none' };

/** Index of the nearest preceding row shallower than `row`, or -1. */
function parentIndex(rows: readonly FlatTreeRow[], index: number): number {
  const depth = rows[index].depth;
  for (let i = index - 1; i >= 0; i--) {
    if (rows[i].depth < depth) return i;
  }
  return -1;
}

/**
 * Siblings of the focused row that are closed and openable, in render
 * order, INCLUDING the focused row itself.
 *
 * «Sibling» is same-parent, not merely same-depth: the span is bounded
 * on both sides by the first row shallower than the focused one, which
 * is precisely its parent (or the edge of the list for a root). APG says
 * "sibling nodes", and a same-depth-anywhere reading would open
 * unrelated branches the user never looked at.
 */
function closedSiblingIds(
  rows: readonly FlatTreeRow[],
  index: number,
  expanded: ReadonlySet<string>,
): string[] {
  const depth = rows[index].depth;
  let start = index;
  while (start - 1 >= 0 && rows[start - 1].depth >= depth) start--;
  let end = index;
  while (end + 1 < rows.length && rows[end + 1].depth >= depth) end++;

  const ids: string[] = [];
  for (let i = start; i <= end; i++) {
    const r = rows[i];
    if (r.depth !== depth) continue;
    if (!isExpandableRow(r)) continue;
    if (isOpenRow(r, expanded)) continue;
    ids.push(r.item.id);
  }
  return ids;
}

/**
 * Resolve one navigation key against the tree. Returns `none` for any key
 * the contract does not claim — including printable characters, which the
 * caller feeds to `resolveTypeahead` instead.
 */
export function resolveTreeKey(key: string, ctx: TreeNavContext): TreeKeyAction {
  const { rows, index, expanded } = ctx;
  if (index < 0 || index >= rows.length) return NONE;
  const row = rows[index];

  switch (key) {
    case 'ArrowRight': {
      // Closed node → open it and STAY. Open node → step onto its first
      // child. Leaf (and reference rows, which never own a subtree) →
      // nothing. The first child of an open node is always the next
      // visible row: the list is a DFS and the subtree is not collapsed.
      if (!row.hasChildren || row.isReference) return NONE;
      if (isOpenRow(row, expanded)) {
        const next = rows[index + 1];
        return next && next.depth > row.depth
          ? { kind: 'focus', index: index + 1 }
          : NONE;
      }
      return { kind: 'expand', id: row.item.id };
    }

    case 'ArrowLeft': {
      // Open node → close it. Otherwise climb to the parent. A context
      // row is open but has no chevron, so it takes the climb: the
      // alternative would be a keystroke that visibly does nothing on a
      // row the user cannot close by any other means either.
      if (isExpandableRow(row) && isOpenRow(row, expanded)) {
        return { kind: 'collapse', id: row.item.id };
      }
      const parent = parentIndex(rows, index);
      return parent >= 0 ? { kind: 'focus', index: parent } : NONE;
    }

    case 'ArrowDown':
      return index + 1 < rows.length ? { kind: 'focus', index: index + 1 } : NONE;

    case 'ArrowUp':
      return index - 1 >= 0 ? { kind: 'focus', index: index - 1 } : NONE;

    case 'Home':
      return index === 0 ? NONE : { kind: 'focus', index: 0 };

    case 'End':
      return index === rows.length - 1
        ? NONE
        : { kind: 'focus', index: rows.length - 1 };

    case 'Enter':
      // Reference rows point at an issue rendered elsewhere (or at one
      // this user cannot see at all) — there is nothing to open here.
      return row.isReference ? NONE : { kind: 'activate', index };

    case '*': {
      const ids = closedSiblingIds(rows, index, expanded);
      return ids.length > 0 ? { kind: 'expandSiblings', ids } : NONE;
    }

    default:
      return NONE;
  }
}

/**
 * Typeahead: the index of the next row whose title starts with `prefix`,
 * or -1.
 *
 * Search starts AFTER the focused row and wraps, so repeatedly typing the
 * same letter cycles through the rows that begin with it. `includeCurrent`
 * makes the focused row itself the first candidate, which is what a
 * GROWING buffer needs: typing "d", "e", "m" must refine onto the row the
 * "d" already selected rather than skip to the next one that matches.
 *
 * Case-insensitive on both sides. Reference and context rows participate:
 * they are navigable rows with visible titles, and skipping them would
 * make the letter key disagree with the arrow keys about what is in the
 * list.
 */
export function resolveTypeahead(
  rows: readonly FlatTreeRow[],
  index: number,
  prefix: string,
  includeCurrent = false,
): number {
  if (rows.length === 0 || prefix === '') return -1;
  const needle = prefix.toLowerCase();
  const from = index < 0 ? 0 : index;
  const start = includeCurrent ? 0 : 1;
  for (let step = start; step <= rows.length; step++) {
    const i = (from + step) % rows.length;
    if (rows[i].item.title.toLowerCase().startsWith(needle)) return i;
  }
  return -1;
}
