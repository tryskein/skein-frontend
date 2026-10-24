/**
 * sk-421.2 T022 (US-2 "focus", SC-013, F-22) — identification of a section row
 * between refetches and the single rule for the fallback focus target.
 *
 * ─── Why a separate module ─────────────────────────────────────────
 *
 * One rule for BOTH modes — "List" and "Tree". Two copies would diverge
 * at the first edit, and having diverged, would give different focus behaviour
 * on the same card. The logic here is pure: it can be proven without
 * rendering, which is what its test does.
 *
 * ─── What identifies a row ─────────────────────────────────────────
 *
 * An ordinary row — by the task identifier. It is stable between
 * refetches, and that is enough.
 *
 * A "no access" row — NOT by identifier: stubs have synthetic ids that are
 * not stable between refetches (F-22), and identifying by them would return
 * the focus to the wrong place or lose it out of nowhere. So a stub
 * is identified by the pair "the nearest visible ancestor + the position among stubs in
 * the subtree of this ancestor". For a first-level row the ancestor is the epic itself.
 *
 * ─── Where the focus goes when the row is gone ─────────────────────
 *
 * The order from US-2, top to bottom:
 *   1. the same row, if it survived;
 *   2. the nearest surviving row that stood ABOVE it in the previous
 *      display order;
 *   3. the first shown row;
 *   4. the mode switcher;
 *   5. the "Add child" button.
 *
 * Item 2 looks up, not down, deliberately: rows below could have
 * shifted into the place of the vanished one, and a jump "to the same position" would take the
 * focus to another task silently — whereas the neighbour above remains the same
 * task it was.
 *
 * The rule does NOT take away focus that is outside the section: the caller
 * applies it only when the focus was inside.
 */

import type { FlatTreeRow } from './flattenTree';

/** An opaque row key, stable between refetches. */
export type EpicRowKey = string;

/** A visible ancestor on the stack. Only NON-stubs; depths strictly increase. */
interface VisibleAncestor {
  id: string;
  depth: number;
}

/**
 * The nearest visible ancestor for a row of depth `depth`: the last stack
 * entry with a SMALLER depth.
 *
 * The search is binary, not a linear scan top to bottom, and this is not decoration.
 * Depths on the stack strictly increase, so binary search is correct; and
 * a linear scan would bring back to the bulk form exactly the cost it was
 * introduced to remove: a first-level stub under a long chain of ancestors
 * would cost O(depth), and on the input "a deep chain plus stubs"
 * the form would become quadratic again.
 */
function anchorAt(
  ancestors: readonly VisibleAncestor[],
  depth: number,
  epicId: string,
): string {
  let lo = 0;
  let hi = ancestors.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (ancestors[mid].depth < depth) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found === -1 ? epicId : ancestors[found].id;
}

/**
 * Keys of ALL rows of the set in one pass — the form used by
 * `resolveEpicFocusTarget` (sk-421.3 T01, m-9, INV-11).
 *
 * ─── What is computed here ─────────────────────────────────────────
 *
 * Exactly what the per-row form computed, and redoing it is
 * forbidden (PK-2 item 2): an ordinary row — `id:<id>`; a stub —
 * `stub:<the nearest visible ancestor>:<ordinal among stubs of THE SAME
 * depth under this ancestor>`. The number is counted in display order.
 *
 * ─── Why one pass, not n calls of the per-row form ─────────────────
 *
 * The per-row form walked back over all preceding rows and for each
 * stub of the same depth walked back again for its ancestor — i.e. O(i²)
 * per row and O(n³) for a set consisting entirely of stubs. Here
 * the ancestor stack and the stub counters per the pair "ancestor + depth" survive
 * the iteration, so each row costs O(log n) for the ancestor search and O(1)
 * for the number.
 *
 * ─── Why a stub does NOT touch the stack ───────────────────────────
 *
 * The stack is popped only by non-stubs. Popping it by the stub's depth
 * is not allowed, and this is not caution but a fixed bug: let the rows be
 * `A(1) · C(5) · stub(5) · D(6)`. D's ancestor is `C` (the nearest row above
 * of smaller depth, itself not a stub). If the stub of depth 5
 * popped `C` off the stack, D's ancestor would be `A` — the key would silently diverge
 * from the per-row form, on an input the test may easily not generate.
 * A stub cannot be an ancestor, so it is not pushed onto the stack.
 */
export function epicRowKeys(
  rows: readonly FlatTreeRow[],
  epicId: string,
): EpicRowKey[] {
  const keys: EpicRowKey[] = new Array<EpicRowKey>(rows.length);
  const ancestors: VisibleAncestor[] = [];
  // The map key is the pair "ancestor + depth", not an ancestor alone: numbering
  // goes among stubs of THE SAME depth under this ancestor.
  const stubCounts = new Map<string, number>();

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];

    if (!row.isReference) {
      while (
        ancestors.length > 0 &&
        ancestors[ancestors.length - 1].depth >= row.depth
      ) {
        ancestors.pop();
      }
      keys[i] = `id:${row.item.id}`;
      ancestors.push({ id: row.item.id, depth: row.depth });
      continue;
    }

    const anchor = anchorAt(ancestors, row.depth, epicId);
    const bucket = `${anchor}\u0000${row.depth}`;
    const position = stubCounts.get(bucket) ?? 0;
    stubCounts.set(bucket, position + 1);
    keys[i] = `stub:${anchor}:${position}`;
  }

  return keys;
}

/**
 * The key of ONE row. An ordinary one — by the task identifier; a stub — by the
 * nearest visible ancestor and the ordinal among the stubs of its
 * subtree (F-22).
 *
 * Expressed through the shared pass deliberately: two implementations of one key
 * would diverge at the first edit, and having diverged, would give different focus
 * depending on who asked. An index outside the set gives an
 * empty key, as before.
 */
export function epicRowKey(
  rows: readonly FlatTreeRow[],
  index: number,
  epicId: string,
): EpicRowKey {
  return epicRowKeys(rows, epicId)[index] ?? '';
}

/** Where to put the focus after a refetch. */
export type EpicFocusTarget =
  | { kind: 'row'; index: number }
  | { kind: 'switcher' }
  | { kind: 'addChild' };

export interface ResolveFocusArgs {
  /** Rows before the refetch, in display order. */
  prevRows: readonly FlatTreeRow[];
  /** The index of the row that had focus. */
  prevIndex: number;
  /** Rows after the refetch. */
  nextRows: readonly FlatTreeRow[];
  /** The epic identifier — the first-level ancestor. */
  epicId: string;
  /** Whether the mode switcher is on screen (it is not for an empty set). */
  hasSwitcher: boolean;
}

export function resolveEpicFocusTarget({
  prevRows,
  prevIndex,
  nextRows,
  epicId,
  hasSwitcher,
}: ResolveFocusArgs): EpicFocusTarget {
  // Both sets are walked in ONE pass each (T01). Before, a call of the per-row
  // form for every row stood here — i.e. a pass
  // inside a pass, and on a set of stubs that gave a cube.
  const nextRowKeys = epicRowKeys(nextRows, epicId);
  const prevRowKeys = epicRowKeys(prevRows, epicId);

  const nextKeys = new Map<EpicRowKey, number>();
  for (let i = 0; i < nextRowKeys.length; i += 1) {
    const key = nextRowKeys[i];
    // The first occurrence wins: stub keys are numbered in order,
    // so there should be no collisions, but if they appear — we take the upper one.
    if (!nextKeys.has(key)) nextKeys.set(key, i);
  }

  // 1. The same row.
  if (prevIndex >= 0 && prevIndex < prevRows.length) {
    const same = nextKeys.get(prevRowKeys[prevIndex]);
    if (same !== undefined) return { kind: 'row', index: same };
  }

  // 2. The nearest surviving one ABOVE it.
  for (let i = Math.min(prevIndex, prevRows.length) - 1; i >= 0; i -= 1) {
    const found = nextKeys.get(prevRowKeys[i]);
    if (found !== undefined) return { kind: 'row', index: found };
  }

  // 3. The first shown row.
  if (nextRows.length > 0) return { kind: 'row', index: 0 };

  // 4-5. The switcher, otherwise the add button.
  return hasSwitcher ? { kind: 'switcher' } : { kind: 'addChild' };
}
