/**
 * sk-285.7 T025 — which SHAPE the filter panel is drawn in.
 *
 * Two layouts over ONE set of filters (handoff §6, "Filter panel"):
 *
 *   - `select` — mode A, the grid of labelled comboboxes. Every
 *     dimension, including the ones whose domain is a directory rather
 *     than a fixed list, and the ones that carry a per-option
 *     explanation line.
 *   - `chips`  — mode B, the quick list: one row per dimension, `label |
 *     chips`, one tap per choice.
 *
 * This is a LAYOUT preference and nothing else. It picks which controls
 * paint the values; it is not itself a filter, holds no filter value,
 * and switching it must leave every filter exactly where it stood —
 * that is US-5's acceptance criterion and what
 * `TaskFilters.layout.test.tsx` pins.
 *
 * Its own module rather than a pair of literals inside
 * `useTasksUiState`, for the same reason `treeColumns` and
 * `listCardFields` have theirs: the value set is read in three places
 * (the provider that persists it, the panel that draws it, the tests
 * that enumerate it), and a set spelled out in each of them is three
 * copies of one decision. Adding a third layout here is what makes the
 * persistence test cover it — the test iterates this array rather than
 * naming the modes.
 */

/** The panel's drawing mode. */
export type FiltersLayout = 'select' | 'chips';

/**
 * Every layout the panel can be in — the whitelist `readEnum` validates
 * a persisted value against, and the list the tests enumerate.
 */
export const FILTERS_LAYOUT_VALUES: readonly FiltersLayout[] = ['select', 'chips'];

/**
 * The layout a reader who never touched the switch gets.
 *
 * `select` because it is the panel that shipped: every dimension is
 * reachable in it, including the assignee directory (whose domain is
 * unbounded and therefore not enumerable as chips) and the multi-valued
 * dep-type / project-focus pickers. Opening the app must never narrow
 * what a reader can reach.
 */
export const FILTERS_LAYOUT_DEFAULT: FiltersLayout = 'select';
