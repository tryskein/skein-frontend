/**
 * sk-285.2.8 — keep the Tasks tree readable while the column is showing
 * a NARROWED set (a filter chip, a lens, a search).
 *
 * ─── The defect ────────────────────────────────────────────────────
 *
 * `useTasks` filters server-side, so a filtered page contains matches
 * only. sk-285.2.7 already backfills the parents that did not come with
 * the page and renders them as CONTEXT rows (`FlatTreeRow.isContext`),
 * so a matched subtask no longer floats to the root — it sits at its
 * real depth under dimmed scaffolding.
 *
 * What that fix does NOT cover: an ancestor the user had COLLAPSED. A
 * collapsed ancestor suppresses every row below it, so applying a
 * filter can leave the column apparently empty while the header count
 * insists there are twelve matches. That is the Jira list-view defect
 * the branch is about, and it is the half this task closes.
 *
 * ─── The rule ──────────────────────────────────────────────────────
 *
 * While the set is narrowed, every ancestor on the path to a match is
 * held OPEN — but only for as long as the narrowing lasts. The manual
 * expansion state (`skein.tasks.tree.{alias}.expanded` in localStorage)
 * is neither read differently nor written to: filtering must not
 * silently rewrite the shape the user arranged by hand.
 *
 * Rejected alternatives, recorded so they are not re-litigated:
 *   - Persist the auto-expansion into the same localStorage set. One
 *     filter would permanently unfold branches the user had collapsed,
 *     and there would be no way to tell the two intents apart later.
 *   - Ignore `expanded` entirely while filtering (render the matched
 *     forest fully open). Simpler, but it also throws away the
 *     collapses that are NOT in the way of any match, so a narrow
 *     filter on a large project explodes into a wall of rows.
 *   - A "tree / matches only" toggle next to the filter (variant 3 in
 *     the task). An extra control for a question with one right answer.
 */

import type { FlatTreeRow } from './flattenTree';

/**
 * The inputs that can narrow the Tasks column to a subset of the
 * project. Everything here is a predicate over issues — navigation
 * that changes WHICH project is on screen (`selectedProject`) is not,
 * because it does not split a project's tree into matches and misses.
 */
export interface TreeNarrowingInputs {
  /** Debounced free-text query ('' when idle). */
  search: string;
  /**
   * Status chip. Two of its values do NOT narrow: `'active'` is the
   * board every user lands on, and `'all'` widens. This is the exact
   * rule `countActiveFilters` (TaskFilters.tsx) uses for the badge on
   * the filter-panel button, and it has to stay the exact rule here —
   * a tree that behaves as if filtered while the badge reads "no
   * filters" is two answers to one question.
   */
  statusFilter: string;
  /** Chip filters whose "no filter" value is 'all'. */
  originFilter: string;
  typeFilter: string;
  priorityFilter: string;
  /** Assignee chip row, or null when nobody is picked. */
  assigneeFilter: string | null;
  /**
   * Component drill-in. Not a filter chip, but a predicate over issues
   * all the same: a component's issues are a subset of the project's and
   * their parents routinely sit outside it.
   */
  selectedComponent: string | null;
  /**
   * Header lenses. Also outside the filter panel (and so outside the
   * badge), also narrowing: each cuts the board down to a caller-scoped
   * slice whose parents are mostly not in it.
   */
  outboxMode: boolean;
  onMeMode: boolean;
}

/**
 * Returns a stable SIGNATURE of the active narrowing, or '' when the
 * column is showing everything it could show.
 *
 * One string rather than a boolean plus a separate cache key on
 * purpose: the caller needs both "is anything narrowing?" and "has the
 * narrowing CHANGED?" (the second drops the ephemeral expand overrides,
 * which describe a tree the user is no longer looking at). Deriving
 * both from one value makes it impossible for them to disagree.
 *
 * `search` is included even though the column currently forces Cards
 * view while a search runs (sk-50) — same defence-in-depth as the
 * `'relevance'` branch of the tree comparator, so a future surface that
 * keeps Tree on mid-search inherits the correct behaviour instead of
 * the defect.
 */
export function describeTreeNarrowing(inputs: TreeNarrowingInputs): string {
  const parts: string[] = [];
  const q = inputs.search.trim();
  if (q !== '') parts.push(`q=${q}`);
  if (inputs.statusFilter !== 'active' && inputs.statusFilter !== 'all') {
    parts.push(`status=${inputs.statusFilter}`);
  }
  if (inputs.originFilter !== 'all') parts.push(`origin=${inputs.originFilter}`);
  if (inputs.typeFilter !== 'all') parts.push(`type=${inputs.typeFilter}`);
  if (inputs.priorityFilter !== 'all') {
    parts.push(`priority=${inputs.priorityFilter}`);
  }
  if (inputs.assigneeFilter !== null) {
    parts.push(`assignee=${inputs.assigneeFilter}`);
  }
  if (inputs.selectedComponent !== null) {
    parts.push(`component=${inputs.selectedComponent}`);
  }
  if (inputs.outboxMode) parts.push('lens=outbox');
  if (inputs.onMeMode) parts.push('lens=onme');
  return parts.join('|');
}

const NO_IDS: ReadonlySet<string> = new Set<string>();

/**
 * Ids of every row that has a MATCH somewhere beneath it — i.e. the
 * union of the ancestor paths of all matched rows.
 *
 * A match is a row that is neither context (sk-285.2.7 scaffolding) nor
 * a reference stub (cycle / duplicate / cross-project `<hidden>`):
 * exactly the rows the filter admitted. A match does NOT put its own id
 * in the set — the path leads TO it, and unfolding its children would
 * show rows the filter rejected. When a child of it also matched, that
 * child adds the parent on its own account.
 *
 * Input must be the pre-order DFS row list (`flattenTree` output, or
 * the same list after `partitionStandingTreeRows`, which moves whole
 * subtrees and therefore preserves DFS order). The ancestor stack is
 * rebuilt from `depth` alone, so the walk is a single pass.
 */
export function collectMatchAncestorIds(
  rows: readonly FlatTreeRow[],
): ReadonlySet<string> {
  if (rows.length === 0) return NO_IDS;
  const out = new Set<string>();
  // Ancestor chain of the row being visited, indexed by depth.
  const stack: string[] = [];
  for (const row of rows) {
    // Pop back to this row's parent level. Popping (rather than
    // assigning at `stack[depth]`) keeps the array hole-free, so a
    // malformed list that jumps a depth forward degrades to "one level
    // shallower than claimed" instead of pushing `undefined` into the
    // ancestor set.
    while (stack.length > row.depth) stack.pop();
    if (!row.isContext && !row.isReference) {
      for (const ancestorId of stack) out.add(ancestorId);
    }
    stack.push(row.item.id);
  }
  return out.size === 0 ? NO_IDS : out;
}

/**
 * Merge the persisted manual expansion with the auto-expanded paths and
 * the user's toggles made DURING the narrowing.
 *
 * `overrides` flips membership (XOR) rather than adding to one side: a
 * row can be open because the user opened it, or because it leads to a
 * match, and a click on its chevron has to mean "close it" in both
 * cases. Flipping is the only rule that reads the same for both without
 * a second, negative set.
 *
 * Returns `manual` itself when nothing is narrowing, so the common case
 * allocates nothing and `visibleRows` keeps its memo.
 */
export function mergeFilteredExpansion(
  manual: ReadonlySet<string>,
  autoExpanded: ReadonlySet<string>,
  overrides: ReadonlySet<string>,
  narrowed: boolean,
): ReadonlySet<string> {
  if (!narrowed) return manual;
  const out = new Set(manual);
  for (const id of autoExpanded) out.add(id);
  for (const id of overrides) {
    if (out.has(id)) out.delete(id);
    else out.add(id);
  }
  return out;
}
