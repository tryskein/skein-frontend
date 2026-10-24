/**
 * Build a forest of issue trees from a flat IssueSummary list (F4).
 *
 * The Tasks column tree view groups issues by `parentIdCurrent`. The
 * fetch returns a flat list (server doesn't materialise a tree), so we
 * group client-side. Roots are issues whose `parentIdCurrent` is null
 * OR whose parent isn't in the fetched set ("orphans" — typically
 * because the filter excluded the parent). Orphans are surfaced at the
 * root level rather than dropped — losing them would hide work that
 * matches the filter just because its parent doesn't.
 *
 * Children are sorted by the same comparator the caller passes for the
 * root level (priority-updated by default). Sort runs once per node so
 * a deeply-nested tree stays fast.
 *
 * ─── Context rows (sk-285.2.7) ─────────────────────────────────────
 *
 * A page of the flat list is a slice of the project, so a parent very
 * often did not make the page and its child floated to the root — the
 * tree then showed the hierarchy of a random sub-sample. The caller
 * (`useTreeAncestors`) now backfills those parents by id and passes
 * their ids in `contextIds`.
 *
 * A backfilled parent is CONTEXT, not a result: it did not pass the
 * column's filter and it must not be counted or read as one of the
 * rows the user asked for. `isContext` on the node is the ONE flag
 * carrying that distinction through the whole tree pipeline
 * (`flattenTree` → `FlatTreeRow.isContext` → dimmed row, excluded from
 * the collapsed-count). Anything else that later needs to show a row
 * "for structure only" reuses this same flag rather than inventing a
 * parallel one; two near-identical dimming mechanisms is exactly how a
 * list stops agreeing with its own header. sk-285.2.8 (ancestors of
 * filter matches) is that reuse: under a filter the missing parent IS
 * the non-matching ancestor, so it arrives here by the same route and
 * needs no second flag.
 *
 * A context node with no children left is DROPPED. Context exists only
 * to hold real rows under it, so a childless one is noise — and this is
 * also what keeps a stale backfill (ids kept across a refetch while the
 * page changes underneath) from parading unrelated rows at the root.
 *
 * ─── Where a context row SORTS (sk-285.2.19, step 5) ───────────────
 *
 * By the rows it is holding up, not by itself.
 *
 * A context row did not match. Its own `updatedAt`, its own priority —
 * none of it is an answer to the question the reader asked, so ranking
 * it against the matches lets a row that is not a result take the top
 * of a list of results: sorted by «updated», a parent touched this
 * morning heads a filtered list whose actual matches are all from
 * March. What the reader is choosing between at that level is BRANCHES,
 * and a branch is worth what its best match is worth. So a context node
 * is ranked by the best-ranked row inside its subtree (best = first
 * under the same comparator, its own context descendants resolved the
 * same way), and it carries its subtree to that position.
 *
 * Two things this deliberately is NOT:
 *   - not a pin. A context row has no reserved place, at the top or
 *     anywhere else; it competes on its subtree's rank and moves when
 *     the direction flips, like everything else on its level.
 *   - not a re-parenting. It is still a row of its own sibling list —
 *     decision A holds: nothing leaves its branch, and its own children
 *     are ordered among themselves by the same comparator.
 *
 * Matched rows are unaffected: a row that passed the filter is ranked
 * by its own value, whatever hangs under it.
 */

import type { IssueSummary, IssueTreeRowItem } from '../api/issues';

export interface IssueTreeNode {
  item: IssueSummary;
  children: IssueTreeNode[];
  /**
   * True when this row was pulled in only to complete a branch (its
   * parent chain), NOT because it passed the column's filter. Consumers
   * must keep it out of result counts and render it as scaffolding.
   */
  isContext: boolean;
}

/**
 * sk-421.2 — the parameters are widened to `IssueTreeRowItem`: a tree row can
 * stand for an inaccessible task and carry an empty status and type (INV-2).
 * Widening the PARAMETERS is safe for consumers: a function accepting a
 * wider type is substitutable wherever a narrower one is expected.
 */
export type TreeComparator = (a: IssueTreeRowItem, b: IssueTreeRowItem) => number;

export function buildIssueTree(
  items: IssueSummary[],
  compare?: TreeComparator,
  contextIds?: ReadonlySet<string>,
): IssueTreeNode[] {
  // Index by id for O(1) parent lookup.
  const byId = new Map<string, IssueSummary>();
  for (const it of items) byId.set(it.id, it);

  // Bucket children by parent id. The bucket key is the actual
  // parentId string; orphans + roots all share the synthetic ROOT key.
  const childrenByParent = new Map<string, IssueSummary[]>();
  const ROOT = '\0root';
  childrenByParent.set(ROOT, []);

  for (const it of items) {
    const parentId = it.parentIdCurrent;
    const isRoot = !parentId || !byId.has(parentId);
    const key = isRoot ? ROOT : parentId!;
    const bucket = childrenByParent.get(key) ?? [];
    bucket.push(it);
    childrenByParent.set(key, bucket);
  }

  const isContextId = (id: string) => contextIds?.has(id) ?? false;

  /**
   * A built node plus the item its SIBLING RANK is taken from — itself
   * for a real row, its best-ranked descendant for a context row (see
   * «Where a context row SORTS» above). Internal: `rank` is a fact about
   * ordering this list, not a property of the tree, and nothing outside
   * this function needs it.
   */
  interface Ranked {
    node: IssueTreeNode;
    rank: IssueSummary;
  }

  // Recursively materialise nodes. Each node's children come from the
  // bucket keyed by its own id. The `seen` Set guards against a
  // server-side data corruption that would produce a self-referential
  // parent chain — without the guard, `nodeFor` would stack-overflow.
  // Server-side validation should prevent cycles, but the cost of a
  // tiny defensive check is far cheaper than a crashed renderer.
  function nodeFor(item: IssueSummary, seen: Set<string>): Ranked {
    const isContext = isContextId(item.id);
    if (seen.has(item.id)) {
      // Cycle detected — render the node as a leaf to break the loop.
      // Nothing hangs under it, so it can only rank as itself.
      return { node: { item, children: [], isContext }, rank: item };
    }
    const nextSeen = new Set(seen);
    nextSeen.add(item.id);
    const kids = childrenByParent.get(item.id) ?? [];
    const children = orderSiblings(kids.map((k) => nodeFor(k, nextSeen)));
    return {
      node: { item, children: children.map((c) => c.node), isContext },
      // A context row is scaffolding: it stands where its best match
      // stands. `children` is already ordered, so that is its head —
      // and the head's own rank, so a context chain resolves through to
      // the real row at the bottom of it.
      rank: isContext && children.length > 0 ? children[0].rank : item,
    };
  }

  /**
   * Prune, then order — one step, because the two are entangled: a
   * pruned context node must not vote on the order (it is not going to
   * be rendered), and the order is what makes `children[0]` the BEST
   * rank rather than merely the first.
   *
   * Post-order: a context node is kept only while something real still
   * hangs under it. Runs on the ALREADY-built children, so a context
   * parent whose only child was itself a pruned context leaf collapses
   * away in the same pass.
   *
   * The sort is stable (`Array.prototype.sort` is), so rows the
   * comparator calls equal keep the order they arrived in.
   */
  function orderSiblings(nodes: Ranked[]): Ranked[] {
    const kept =
      !contextIds || contextIds.size === 0
        ? nodes
        : nodes.filter((n) => !n.node.isContext || n.node.children.length > 0);
    if (compare) kept.sort((a, b) => compare(a.rank, b.rank));
    return kept;
  }

  const roots = childrenByParent.get(ROOT) ?? [];
  const initialSeen = new Set<string>();
  return orderSiblings(roots.map((r) => nodeFor(r, initialSeen))).map(
    (r) => r.node,
  );
}
