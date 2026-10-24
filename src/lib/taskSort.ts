/**
 * sk-285.2.19 (step 4) — the ONE sort model of the Tasks column: which
 * field the list is ordered by, in which direction, and — for the tree
 * table — which column header can change that.
 *
 * ─── Why this module exists ────────────────────────────────────────
 *
 * The comparator behind the sort key used to be written out twice: once
 * in `useTasks.clientSort` (the flat Cards list) and once inside
 * `TasksColumn`'s `legacyTree` memo (the tree's sibling order). They
 * agreed by copy, which is a promise nothing kept. A clickable column
 * header adds a DIRECTION to the same state, and a direction realised in
 * one of two copies is exactly how the same stored preference starts
 * meaning two different orders in two views of one column. So the
 * comparator moved here, both callers read it, and the direction is a
 * parameter of it rather than a second mechanism bolted onto one caller.
 *
 * ─── Decision A: the sort is applied INSIDE each parent ────────────
 *
 * The table never flattens the tree. The children of every node are
 * ordered among themselves and the roots among themselves, and no row
 * moves out of its branch under any key or any direction —
 * `buildIssueTree` has always done this for the client-side path (it
 * takes the comparator from here), and the layered (backend-DFS) path
 * goes through {@link sortDfsBlocks} with the SAME comparator, so the
 * two paths cannot disagree about what a sorted tree is.
 *
 * The price is real and it is deliberate: the order is LOCAL. Sorted by
 * «updated», the first row is the most recently touched task of the
 * FIRST branch, not of the project — the project's freshest task can sit
 * anywhere down the list, inside whichever branch it belongs to. This is
 * MUI X's default for tree data and it is the price of never breaking
 * the hierarchy. The user is TOLD, not left to discover it: the table
 * prints the caveat under its header (`tasks:tree.sortScope`, wired in
 * `TaskTreeVirtualList`), naming the field and the direction currently
 * in force.
 *
 * ─── Which columns can be clicked ──────────────────────────────────
 *
 * Exactly the ones the app's sort model already has a key for — see
 * {@link TREE_COLUMN_SORT_KEY}. A header click does not invent a new
 * ordering, it PICKS ONE OF THE EXISTING SORT KEYS: the same value the
 * «Sort by» combobox writes, into the same state, under the same
 * `skein.tasks.sort` storage key. That is why clicking «Updated» in the
 * table also moves the combobox and re-keys the Cards list — there is
 * one KEY in this column, displayed and editable in two places, not a
 * table-local key shadowing a global one.
 *
 * Columns with no key (status, type, assignee, components, labels,
 * progress, and the structural title column) are NOT clickable and carry
 * no `aria-sort`. Adding one is a change to the sort model — a new key
 * in `TasksSortKey`, a new combobox option, a new entry here — not a
 * change to the header strip.
 *
 * ─── Direction belongs to the tree table ───────────────────────────
 *
 * The KEY is the column's; the DIRECTION is the table's, and only the
 * table's. Cards and Kanban read every key in its natural direction
 * ({@link NATURAL_SORT_DIRECTION}) whatever the table is showing.
 *
 * That asymmetry is not an oversight, it is the shape of the controls.
 * The key has two of them — the combobox and the headings — and both
 * name the field in words, so a change made in one is legible in the
 * other. The direction has exactly ONE: a second click on the heading
 * already sorted, reported back by nothing but that heading's arrow and
 * its `aria-sort`. The Kanban board prints no sort indicator anywhere,
 * and the Cards list prints only the combobox's field name; a direction
 * reaching them would invert lists with nothing on screen accounting
 * for it. So it does not reach them: `useTasks` (the ONE query behind
 * all three bodies) takes the key alone, and the tree applies the
 * direction to its own rows afterwards — see `TasksColumn.compareSiblings`
 * and `TasksSortDirectionScope.test.tsx`, which fails if it leaks.
 *
 * A direction also belongs to the key it was chosen for, and to no
 * other: {@link directionFor} is that rule, and it is what keeps a
 * reversal of «Updated» from silently becoming a reversal of the
 * ephemeral search key that replaced it.
 *
 * ─── What «sorted» ranks: the loaded rows ──────────────────────────
 *
 * BOUNDARY, true of every key and inherited (not introduced) by the
 * direction: the Tasks column ranks the pages it has FETCHED. The wire
 * sort is coarse (`useTasks.wireSort` — `updated` or `created`, nothing
 * else), so with a further page still unfetched the top row is the best
 * of what arrived, not of what exists; reversing a heading re-ranks the
 * same loaded rows rather than asking the server for the other end of
 * the list. Making it otherwise is a server-side ordering contract for
 * every key (priority, id, and both directions of each) plus a refetch
 * on every heading click — a change to the list protocol, not to this
 * module. Until then this is the honest reading of the caption: sorted,
 * within each branch, over the rows the column has loaded.
 *
 * ─── Direction, and where it is stored ─────────────────────────────
 *
 * Every key has a NATURAL direction ({@link NATURAL_SORT_DIRECTION}) —
 * the one the app shipped with and the one the combobox's label
 * describes («Updated» has always meant newest first). Picking a key
 * from the combobox resets the direction to that natural one; clicking
 * the header of the column already sorted reverses it.
 *
 * Both halves live in the SINGLE existing preference, encoded into the
 * one `skein.tasks.sort` value as `key:direction` (see
 * {@link formatSortPref} / {@link parseSortPref}). There is no second
 * storage key and no second copy of "what order is this list in": a
 * value written by an older build (a bare `updated`) still loads, and
 * reads back as that key at its natural direction.
 */

import type { IssueTreeRowItem, TasksSortKey } from '../api/issues';
import type { TreeComparator } from './buildIssueTree';
import { compareHierarchicalId } from './hierIdCompare';
import type { TreeColumn } from './treeColumns';

/** Which way a sort key is read. */
export type TasksSortDirection = 'asc' | 'desc';

/** The two directions, for validating a stored value. */
export const TASKS_SORT_DIRECTIONS: readonly TasksSortDirection[] = [
  'asc',
  'desc',
];

/**
 * The direction each key is read in when nobody has said otherwise —
 * i.e. the order this app has always produced for that key.
 *
 * `updated` / `created` are DESCENDING (newest first, which is what
 * their combobox labels have always meant); `priority` is ASCENDING (P0
 * first — the priority scale runs the other way); `id` is ascending
 * hierarchical order. `priority-updated` is the composite default: it is
 * priority-ascending first, so its natural direction is `asc`.
 * `relevance` is search-only and has no direction at all (nothing is
 * re-ordered under it) — `asc` is recorded only so the map is total.
 */
export const NATURAL_SORT_DIRECTION: Record<TasksSortKey, TasksSortDirection> = {
  'priority-updated': 'asc',
  priority: 'asc',
  updated: 'desc',
  created: 'desc',
  id: 'asc',
  relevance: 'asc',
};

/** The direction a key is read in when nobody has picked one. */
export function defaultSortDirection(sort: TasksSortKey): TasksSortDirection {
  return NATURAL_SORT_DIRECTION[sort];
}

/**
 * The direction the ACTIVE key is read in, given the stored preference.
 *
 * A direction is chosen for a key — «Updated, oldest first» — and says
 * nothing about any other key. The two can come apart, because the key
 * in force is not always the stored one: a search replaces it with an
 * ephemeral one (`useTaskSearchModes.effectiveSort`), and the stored
 * direction, untouched by that, would otherwise be applied to a key
 * nobody picked it for — «Priority, descending» from a reader who only
 * ever reversed «Updated».
 *
 * So: the stored direction holds while the stored key is the one being
 * read, and any other key is read naturally until the reader reverses
 * THAT one. Which is also what the heading arrow then shows.
 */
export function directionFor(
  active: TasksSortKey,
  pref: TasksSortPref,
): TasksSortDirection {
  return active === pref.sort ? pref.direction : defaultSortDirection(active);
}

/**
 * Which sort key a tree-table column header changes the list to.
 *
 * A partial map on purpose: a column absent from it is not sortable, and
 * that is a statement about the SORT MODEL (there is no such key), not
 * about the header strip. See «Which columns can be clicked» above.
 */
export const TREE_COLUMN_SORT_KEY: Partial<Record<TreeColumn, TasksSortKey>> = {
  id: 'id',
  priority: 'priority',
  updated: 'updated',
  created: 'created',
};

/** The sort key a column's header switches to, or null if it has none. */
export function treeColumnSortKey(column: TreeColumn): TasksSortKey | null {
  return TREE_COLUMN_SORT_KEY[column] ?? null;
}

/**
 * The column whose header shows the active sort, or null when no single
 * column does.
 *
 * `priority-updated` deliberately marks NOTHING: it is two keys at once
 * (priority, then recency) and pointing it at one header would claim the
 * table is ordered by that column alone. The caption under the header
 * names it in full instead, which is the one place a composite fits.
 */
export function sortedTreeColumn(sort: TasksSortKey): TreeColumn | null {
  for (const [column, key] of Object.entries(TREE_COLUMN_SORT_KEY)) {
    if (key === sort) return column as TreeColumn;
  }
  return null;
}

/**
 * The comparator for a key, read in its NATURAL direction. Private —
 * callers go through {@link compareIssuesBy}, which is the only place
 * the direction is applied.
 */
function naturalComparator(sort: TasksSortKey): TreeComparator {
  switch (sort) {
    case 'priority-updated':
      // Priority ASC (P0 first), then updated_at DESC.
      return (a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        return b.updatedAt.localeCompare(a.updatedAt);
      };
    case 'priority':
      // sk-40 — id tiebreaker; without it equal-priority siblings appear
      // in whatever order the server happened to return.
      return (a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        return compareHierarchicalId(a.id, b.id);
      };
    case 'updated':
      return (a, b) => b.updatedAt.localeCompare(a.updatedAt);
    case 'created':
      return (a, b) => b.createdAt.localeCompare(a.createdAt);
    case 'id':
      return (a, b) => compareHierarchicalId(a.id, b.id);
    case 'relevance':
      // sk-50 — search-only: "keep the server's RRF ranking", i.e. do not
      // re-order at all. A comparator that answers 0 for every pair is
      // exactly that, on a stable sort.
      return () => 0;
    default: {
      const _exhaustive: never = sort;
      void _exhaustive;
      return () => 0;
    }
  }
}

/**
 * The comparator for a key read in a given direction.
 *
 * Reversal is a negation of the natural comparator, tiebreakers
 * included: descending `priority` is P4 first AND the id tiebreaker
 * reversed with it, so the order is the exact mirror of the ascending
 * one rather than a third ordering nobody asked for.
 *
 * `relevance` is never reversed — there is no ranking of ours to
 * reverse, and flipping the server's would be a claim about relevance
 * we cannot make.
 */
export function compareIssuesBy(
  sort: TasksSortKey,
  direction: TasksSortDirection = defaultSortDirection(sort),
): TreeComparator {
  const base = naturalComparator(sort);
  if (sort === 'relevance') return base;
  if (direction === NATURAL_SORT_DIRECTION[sort]) return base;
  return (a: IssueTreeRowItem, b: IssueTreeRowItem) => -base(a, b);
}

/**
 * Decision A, realised on a DFS row list: order the children of every
 * parent among themselves, recursively, and the roots among themselves.
 *
 * The layered (backend) tree arrives as a FLAT depth-first list — a row,
 * then its descendants, then the next sibling — so a "node" here is a
 * BLOCK: the row plus every row after it that is deeper. Sorting moves
 * whole blocks past each other and then recurses into each one, which is
 * exactly what «sort within the parent» means and is why the hierarchy
 * cannot come apart: a block is never split, never re-parented, never
 * dropped, and the output holds every input row exactly once.
 *
 * Stable by construction (`Array.prototype.sort` is): rows the
 * comparator calls equal keep the order the server sent them in.
 *
 * Generic over the row so it can order any DFS list carrying a depth and
 * an issue — the layered wire rows today, without this module having to
 * know that shape. Returns new arrays; the input is a react-query cache
 * value and mutating it would re-order somebody else's copy.
 *
 * The CLIENT-SIDE path needs none of this: `buildIssueTree` sorts as it
 * groups, taking the same comparator, so both paths order siblings by
 * one function.
 */
export function sortDfsBlocks<T extends { depth: number; item: IssueTreeRowItem }>(
  rows: readonly T[],
  compare: TreeComparator,
): T[] {
  if (rows.length < 2) return [...rows];
  // Blocks of the SHALLOWEST depth in this slice. A row deeper than the
  // block head belongs to the block; anything at that depth or above
  // (which a well-formed DFS list never goes) opens the next one.
  const base = rows[0].depth;
  const blocks: T[][] = [];
  for (const r of rows) {
    if (r.depth <= base || blocks.length === 0) blocks.push([r]);
    else blocks[blocks.length - 1].push(r);
  }
  blocks.sort((a, b) => compare(a[0].item, b[0].item));
  return blocks.flatMap((block) =>
    block.length > 1
      ? [block[0], ...sortDfsBlocks(block.slice(1), compare)]
      : block,
  );
}

/** The sort state as one value: which key, read which way. */
export interface TasksSortPref {
  sort: TasksSortKey;
  direction: TasksSortDirection;
}

/**
 * What a click on a column header should make the sort.
 *
 * Two rules, and they are the ones every table in the world has:
 * clicking the column that is ALREADY sorted reverses it; clicking any
 * other sortable column switches to it at its natural direction (so
 * «Updated» opens newest-first, the way its combobox label reads).
 *
 * Returns null for a column with no sort key — the header strip renders
 * those as plain text, and this is the same verdict expressed for a
 * caller that asks anyway.
 */
export function nextSortForColumn(
  column: TreeColumn,
  current: TasksSortPref,
): TasksSortPref | null {
  const key = treeColumnSortKey(column);
  if (key === null) return null;
  if (key !== current.sort) return { sort: key, direction: defaultSortDirection(key) };
  return {
    sort: key,
    direction: current.direction === 'asc' ? 'desc' : 'asc',
  };
}

/**
 * Encode the preference for storage: `key:direction`, always both
 * halves.
 *
 * One value under the one existing `skein.tasks.sort` key — see
 * «Direction, and where it is stored» in the module doc.
 */
export function formatSortPref(pref: TasksSortPref): string {
  return `${pref.sort}:${pref.direction}`;
}

/**
 * Decode a stored value, WITHOUT judging the key.
 *
 * The whitelist of persistable sort keys lives in `useTasksUiState`
 * (`relevance` is deliberately not on it), and duplicating it here would
 * be a second place for it to drift. So this returns the key as the raw
 * string it found and the direction only if the value actually carried a
 * valid one; the caller validates the key and fills the direction in
 * from {@link defaultSortDirection}.
 *
 * A bare `updated` — every value written before directions existed —
 * parses to that key with no direction, i.e. to its natural order, which
 * is exactly what the older build meant by it.
 */
export function parseSortPref(
  raw: string | null | undefined,
): { sort: string; direction: TasksSortDirection | null } | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const sep = raw.lastIndexOf(':');
  if (sep < 0) return { sort: raw, direction: null };
  const key = raw.slice(0, sep);
  const dir = raw.slice(sep + 1);
  return {
    sort: key,
    direction: (TASKS_SORT_DIRECTIONS as readonly string[]).includes(dir)
      ? (dir as TasksSortDirection)
      : null,
  };
}
