/**
 * sk-479 (api contract sk-423) — how many links to unavailable issues
 * to show on an issue.
 *
 * ─── What this number is ─────────────────────────────────────────────
 *
 * `unavailableBlockingLinks` is the number of outgoing `blocks` /
 * `waits-for` links to issues in projects outside the reader's horizon, WHATEVER their
 * status. It is a fact of the link, not a block: the "blocked" flag and
 * the list of blockers are computed only from visible blockers, and the frontend does not
 * derive it itself — neither from this number nor from hidden records of the old api. But
 * readiness for work takes ALL blockers into account, so an issue that looks
 * unblocked with such a number may be waiting for a hidden issue; this is why
 * the number is shown.
 *
 * ─── When it is shown ────────────────────────────────────────────────
 *
 * The number is an integer greater than zero, and the issue is neither closed nor permanent: a
 * closed and a permanent issue have no "is it ready for work" question (the same
 * exception as for `isDerivedBlocked`), and a line about a link would be
 * noise there. Otherwise — 0, and the surface draws nothing.
 *
 * ─── Old and new api ─────────────────────────────────────────────────
 *
 * The new api (sk-423): the detail always has the field (0 — no links), a tree
 * node has it only with `includeBlockers`, only on the canonical visible
 * row and only when greater than zero. The old api does not send the field at all:
 * `undefined` reads as 0 — nothing to show, no error. A value that is not
 * a number, fractional or negative (a corrupted response) is also 0: an invented
 * number about other people's issues is worse than none.
 */

import type { IssueStatus } from '../api/issues';

export function unavailableLinksToShow(
  status: IssueStatus | '',
  count: unknown,
): number {
  if (status === '' || status === 'closed' || status === 'standing') return 0;
  if (typeof count !== 'number' || !Number.isInteger(count) || count <= 0) return 0;
  return count;
}
