/**
 * sk-118 / sk-135 — shared standing-task ordering primitive.
 *
 * Decision #6 (§11.12): a standing (perpetual-obligation) task ALWAYS
 * renders above every other task, in EVERY sort order, INDEPENDENT of the
 * `pinned` flag. Within the standing band itself the order is its OWN
 * internal ranking — priority ASC (P0 first), then most-recently-updated
 * (updatedAt DESC) — decoupled from the active list sort.
 *
 * This module is the single source of truth for that intra-band ordering
 * so the Cards path (`partitionStanding` in useTasks.ts) and the Tree path
 * (`partitionStandingTreeRows` in flattenTree.ts) agree byte-for-byte.
 * Keep it dependency-light (only the `IssueSummary` type) so it can be
 * imported from both a hook module and a pure tree util without dragging
 * react-query into the latter's module graph.
 */

import type { IssueTreeRowItem } from '../api/issues';

/**
 * Intra-standing-band comparator: priority ASC (P0 first), then updatedAt
 * DESC (most recent first). Stable for equal (priority, updatedAt) pairs
 * because `Array.prototype.sort` is stable in modern engines and callers
 * clone before sorting.
 */
export function compareStanding(a: IssueTreeRowItem, b: IssueTreeRowItem): number {
  if (a.priority !== b.priority) return a.priority - b.priority;
  return b.updatedAt.localeCompare(a.updatedAt);
}
