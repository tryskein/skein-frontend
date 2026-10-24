/**
 * sk-36 — adapter from the legacy nested `IssueTreeNode` (built client-
 * side by `buildIssueTree`) to the flat-row shape consumed by the new
 * single-row `TaskTreeNode` component.
 *
 * The wire format coming out of the new backend tree endpoint is already
 * flat (one row per (issue, parent, edge) triple, pre-order DFS — see
 * `api/issues.ts::IssueTreeNode`). The legacy `buildIssueTree` output,
 * however, is still the only source for the fast-path render when the
 * user has only `parent-child` toggled on (no extra network round-trip,
 * groups the already-fetched flat issue list client-side). This adapter
 * bridges that nested structure into the same flat row shape.
 *
 * Edge type is always `'parent-child'` and `isReference` is always false
 * — the legacy nested tree never carries other typed-deps edges and the
 * cycle guard in `buildIssueTree` already collapses cycles into leaves.
 *
 * `isContext` DOES come through: it is the one flag marking a row that
 * is on screen only to complete a branch (sk-285.2.7 backfilled
 * parents). The backend layered path has no such rows today, so its
 * adapter in TasksColumn sets the field to false.
 */

import type { IssueTreeNode as LegacyIssueTreeNode } from './buildIssueTree';
import type { DepType } from '../api/dependencies';
import type {
  IssueTreeRowItem,
  IssueTreeNode as WireIssueTreeNode,
  TreeBlockerRef,
} from '../api/issues';
import { compareStanding } from './standingOrder';

export interface FlatTreeRow {
  /**
   * sk-421.2 — a row standing for a task in an invisible project carries
   * EMPTY status and type (INV-2), so the row item is `IssueTreeRowItem`
   * rather than a plain `IssueSummary`. Narrowing back to the closed
   * unions happens where a chip is actually rendered, behind the stub
   * guard that already exists.
   */
  item: IssueTreeRowItem;
  depth: number;
  /** null for root rows; the typed-deps edge type for every other row. */
  edgeType: DepType | null;
  /** True for cycle/duplicate/hidden-stub rows. Legacy adapter never sets this. */
  isReference: boolean;
  /** Parent id of the first occurrence (cycle / dup). Legacy adapter never sets this. */
  firstSeenAt: string | null;
  /**
   * sk-285.2.7 — this row is CONTEXT: shown so the branch below it is
   * whole, not because it passed the column's filter. Renders dimmed
   * and non-collapsible, and never counts as a result (see
   * `countCollapsed` and the Tasks header total).
   *
   * This is the single "structural row" flag for the tree, and
   * sk-285.2.8 (ancestors of filter matches) rides on it unchanged. Do
   * not add a second one for the next kind of structural row — set this.
   */
  isContext: boolean;
  /**
   * Whether this row has child rows that follow in the flat list.
   * Pre-computed so the renderer can decide whether to show a chevron
   * without looking ahead.
   */
  hasChildren: boolean;
  /**
   * sk-421.2.8 (US-4, US-1 "the same in all modes") — the blockers of the row's
   * issue, carried over from the tree response node as is (the same array, the
   * server's order). `undefined` when the node has no such field — not `[]`: "the
   * server did not send the field" and "the list is empty" are different. The legacy
   * `flattenTree` adapter does not set the field — the nested tree has no blockers column.
   */
  blockers?: TreeBlockerRef[];
  /**
   * sk-479 (contract sk-423) — the number of links of the row's issue to issues outside
   * the reader's horizon, from the tree response node as is. `undefined` — the
   * node has no such field (0, a request without blockers, or a server older than sk-423).
   */
  unavailableBlockingLinks?: number;
}

/**
 * sk-36 — adapter from the wire `IssueTreeNode[]` (pre-order DFS, one
 * row per (issue, parent, edge) triple, with `parentRef`/`isReference`/
 * `firstSeenAt` already populated) to `FlatTreeRow[]`. The only
 * computed field is `hasChildren`, which we derive in a single
 * forward pass using the DFS-order invariant: row N has children iff
 * row N+1 exists AND row N+1.depth > row N.depth.
 *
 * sk-421.2 T020 — lifted here from `TasksColumn.tsx`, where it was a private
 * module function. The second consumer is the epic section tree, and a copy of
 * the "has children" derivation in the card would drift from the column at the first
 * edit; `flattenTree` and `countCollapsed` also live right here, so
 * this is its natural home, not a new place.
 */
export function layeredToFlatRows(
  rows: readonly WireIssueTreeNode[],
): FlatTreeRow[] {
  const out: FlatTreeRow[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i];
    const next = rows[i + 1];
    const hasChildren = !!next && next.depth > r.depth;
    out.push({
      item: r.item,
      depth: r.depth,
      edgeType: r.parentRef?.edgeType ?? null,
      isReference: r.isReference,
      firstSeenAt: r.firstSeenAt ?? null,
      // sk-285.2.7 — the layered endpoint returns a real subtree, so it
      // has no backfilled rows to mark. Cross-project parents the caller
      // cannot see still arrive as `isReference` hidden stubs from the
      // backend; that path is untouched by the context mechanism.
      isContext: false,
      hasChildren,
      // sk-421.2.8 (FOR-PLAN m-7) — node fields are copied one by one; a field
      // not carried over here will not reach the "Tree" mode row.
      blockers: r.blockers,
      unavailableBlockingLinks: r.unavailableBlockingLinks,
    });
  }
  return out;
}

export function flattenTree(nested: LegacyIssueTreeNode[]): FlatTreeRow[] {
  const out: FlatTreeRow[] = [];
  function walk(nodes: LegacyIssueTreeNode[], depth: number): void {
    for (const n of nodes) {
      out.push({
        item: n.item,
        depth,
        edgeType: depth === 0 ? null : 'parent-child',
        isReference: false,
        firstSeenAt: null,
        isContext: n.isContext,
        hasChildren: n.children.length > 0,
      });
      walk(n.children, depth + 1);
    }
  }
  walk(nested, 0);
  return out;
}

/**
 * sk-135 (decision #6, §11.12) — MANDATORY top band for the TREE view.
 *
 * `partitionStanding` (useTasks.ts) floats standing tasks to the top of
 * the FLAT Cards list, but the Tree view builds its rows through a
 * different pipeline (`buildIssueTree` → `flattenTree`, or the backend
 * layered DFS) that re-orders root nodes by the active sort and never
 * floats standing. This helper re-applies the band at the ROOT level of
 * the already-flattened DFS row list, so both tree paths agree with Cards.
 *
 * Contract:
 *   - Operates on the pre-order DFS `FlatTreeRow[]`. A "root" is a row at
 *     `depth === 0`; its subtree is every row that follows until (but not
 *     including) the next depth-0 row.
 *   - ROOT-level standing subtrees float to the front, ordered among
 *     themselves by `compareStanding` (priority ASC, then updatedAt DESC)
 *     keyed on the ROOT row's own item — the EXACT same primitive Cards
 *     uses, so the two surfaces rank standing identically.
 *   - Each standing root keeps its WHOLE subtree intact and contiguous,
 *     nested directly under it (the DFS span moves as one block; depths
 *     and child order inside the subtree are untouched).
 *   - Non-standing roots keep their incoming relative order (stable).
 *   - A standing task nested under a NORMAL parent is NOT a root row, so
 *     it is intentionally LEFT IN PLACE under its parent — yanking it out
 *     would break the tree. Only depth-0 standing nodes float. (Standing-
 *     under-standing is banned upstream, so a standing root never carries
 *     another standing root inside its span.)
 *
 * Returns the input array unchanged (same reference) when no root row is
 * standing, so the common no-standing case stays allocation-free.
 */
export function partitionStandingTreeRows(rows: FlatTreeRow[]): FlatTreeRow[] {
  if (rows.length === 0) return rows;

  // Split the flat DFS list into top-level spans: one per depth-0 root,
  // each carrying its contiguous subtree rows.
  interface RootSpan {
    root: FlatTreeRow;
    span: FlatTreeRow[];
  }
  const spans: RootSpan[] = [];
  for (const r of rows) {
    if (r.depth === 0) {
      spans.push({ root: r, span: [r] });
    } else {
      // Descendant of the current (last) root. A well-formed DFS list
      // never has a depth>0 row before its depth-0 root, but guard anyway
      // so a malformed list degrades to "leave the orphan where it is"
      // rather than throwing.
      const cur = spans[spans.length - 1];
      if (cur) cur.span.push(r);
      else spans.push({ root: r, span: [r] });
    }
  }

  const hasStandingRoot = spans.some((s) => s.root.item.status === 'standing');
  if (!hasStandingRoot) return rows;

  const standing = spans.filter((s) => s.root.item.status === 'standing');
  const rest = spans.filter((s) => s.root.item.status !== 'standing');
  // Rank standing roots by their OWN item — same comparator as Cards.
  standing.sort((a, b) => compareStanding(a.root.item, b.root.item));

  const out: FlatTreeRow[] = [];
  for (const s of standing) out.push(...s.span);
  for (const s of rest) out.push(...s.span);
  return out;
}

/**
 * sk-103 — count how many REAL loaded issues are hidden because an
 * ancestor row is collapsed. Used by the Tasks column header to surface
 * the gap between the flat server-side `total` and the rows actually on
 * screen in Tree view ("N · M collapsed").
 *
 * M = rows present in `flatRows` but absent from `visibleRows`, excluding
 * reference rows (cycle / duplicate / hidden stubs) and context rows
 * (sk-285.2.7 backfilled parents) on BOTH sides — neither is a real
 * hidden issue and both would inflate the gap. Since `visibleRows` is
 * always a subset of `flatRows`, the set difference reduces to a count
 * difference over the remaining rows.
 */
export function countCollapsed(
  flatRows: FlatTreeRow[],
  visibleRows: FlatTreeRow[],
): number {
  const real = (r: FlatTreeRow) => !r.isReference && !r.isContext;
  const realFlat = flatRows.filter(real).length;
  const realVisible = visibleRows.filter(real).length;
  return realFlat - realVisible;
}
