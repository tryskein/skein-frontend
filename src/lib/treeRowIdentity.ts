/**
 * sk-285.2.10 — identity of a rendered tree row: a stable key per row,
 * and the lookup «which row shows this issue id».
 *
 * Both exist because the tree list is virtualized. A virtualizer caches
 * the MEASURED height of every row under the key the caller hands it, and
 * it addresses rows by index — so the key has to survive a re-render of
 * the same logical row, and there has to be an id → index translation for
 * anything that wants to bring a row on screen.
 *
 * ─── Why not the id alone ──────────────────────────────────────────
 *
 * One issue can legitimately occupy several rows at once: a multi-parent
 * issue is canonical under one parent and a `isReference` pointer row
 * under the others, and the same reference can repeat under two different
 * parents at the same depth via the same edge type. So the key is the
 * whole visual tuple (id, depth, edgeType, canonical|reference) plus an
 * occurrence counter that separates rows the tuple still cannot tell
 * apart.
 *
 * ─── Why not the array index (what the code did before) ────────────
 *
 * The previous React key ended in the row's index in the visible list.
 * That was correct for uniqueness but it renames every row below the one
 * the user collapses, which under virtualization throws away the whole
 * measurement cache from that point down: the rows below jump to the
 * estimated height for a frame and the scroll position slides. The
 * occurrence counter is index-like but counts only within its own tuple,
 * so collapsing a subtree elsewhere leaves these keys untouched.
 *
 * TaskTreeNode holds no per-row state, so nothing depends on a row being
 * remounted when the list reorders — which is the one thing the index
 * key bought.
 */

import type { FlatTreeRow } from './flattenTree';

/**
 * Stable, unique key per row, positionally matching `rows`.
 *
 * Two rows get the same key only if they are the same issue, at the same
 * depth, under the same edge type, in the same canonical/reference role,
 * AND the same occurrence number among those — i.e. never.
 */
export function buildTreeRowKeys(rows: readonly FlatTreeRow[]): string[] {
  const seen = new Map<string, number>();
  const keys: string[] = new Array(rows.length);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const tuple = `${r.item.id}_${r.depth}_${r.edgeType ?? 'root'}_${
      r.isReference ? 'ref' : 'canon'
    }`;
    const nth = seen.get(tuple) ?? 0;
    seen.set(tuple, nth + 1);
    keys[i] = `${tuple}#${nth}`;
  }
  return keys;
}

/**
 * Index of the row that SHOWS issue `id`, or -1 when no row does.
 *
 * Prefers the canonical row over a reference (pointer) row: a caller
 * asking to reveal an issue means the place where the issue actually
 * lives, not the "↻ see …" stub that points at it. Reference rows are
 * still answered when there is nothing else, so a jump into a subtree
 * whose canonical row is hidden still lands somewhere truthful rather
 * than reporting «no such row».
 */
export function treeRowIndexById(rows: readonly FlatTreeRow[], id: string): number {
  let fallback = -1;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.item.id !== id) continue;
    if (!r.isReference) return i;
    if (fallback < 0) fallback = i;
  }
  return fallback;
}
