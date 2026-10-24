import type { RaceMetric, RaceResult } from '../api/dashboard';
import type { EventEnvelope } from './eventEnvelope';

/**
 * Live-increment helper for the /activity RaceChart (sk-194 wave C:
 * moved out of `pages/activity/RaceChart.tsx`, which had to widen its
 * export surface purely so the unit tests could reach this pure
 * function). Logic is unchanged byte-for-byte.
 */

/**
 * Map a race metric to the envelope event types that trigger a live
 * cumulative increment. Mirrors the backend predicate (store.go Race):
 * commits counts issue_commits rows via issue.commits_attached, whose
 * compact-envelope `commitHashes` carries the exact SHA count to bump by
 * (spec sk-622.21 US-12, "Envelope consumers" — the race by commits).
 */
const METRIC_TO_EVENT_TYPES: Record<RaceMetric, ReadonlySet<string>> = {
  closed: new Set(['issue.closed']),
  commits: new Set(['issue.commits_attached']),
  created: new Set(['issue.created']),
  comments: new Set(['comment.created']),
};

/**
 * Apply one envelope to the cached RaceResult. Bumps the matching
 * user's last cumulative point by `delta` (1 for event metrics;
 * hash count for commits). If the user isn't in the top-N, bumps
 * `others`. Returns a NEW object reference so React renders.
 *
 * Falls back to username matching when `actorUserId` is absent on the
 * envelope — older skein-api versions don't ship the JOIN-enriched
 * actor uuid, and we don't want to lose increments to that gap.
 */
export function applyEnvelopeToResult(
  prev: RaceResult,
  env: EventEnvelope,
  metric: RaceMetric,
): RaceResult {
  const eventTypes = METRIC_TO_EVENT_TYPES[metric];
  if (!eventTypes.has(env.eventType)) return prev;

  // For commits we bump by the exact number of linked hashes carried on
  // the issue.commits_attached envelope (commitHashes). Anything that is
  // not a non-empty array contributes 0 — no optimistic bump on a malformed
  // or empty payload.
  //
  // Optimistic-live drift (reconciled by the 60s refetch, which counts
  // issue_commits rows — the source of truth):
  //  - close-with-commits emits issue.closed only (no commits_attached), so
  //    the live line lags by one poll cycle on that path;
  //  - a duplicate skein_commits_attach re-emits hashes that inserted no
  //    rows (ON CONFLICT), so the live line can transiently over-count.
  // Both self-correct within one refetch; neither persists a wrong value.
  const hashes: unknown = env.commitHashes;
  const delta = metric === 'commits' ? (Array.isArray(hashes) ? hashes.length : 0) : 1;
  if (delta <= 0) return prev;

  const matchByUserId = env.actorUserId ?? null;
  const matchByUsername = env.actor ?? null;
  if (!matchByUserId && !matchByUsername) return prev;

  // Find the matching top-N user, if any.
  const idx = prev.users.findIndex((u) => {
    if (matchByUserId && u.userId === matchByUserId) return true;
    if (matchByUsername && u.username === matchByUsername) return true;
    return false;
  });

  if (idx >= 0) {
    const user = prev.users[idx];
    if (user.points.length === 0) return prev;
    const lastIdx = user.points.length - 1;
    const updatedPoints = user.points.slice();
    updatedPoints[lastIdx] = {
      ...updatedPoints[lastIdx],
      cumulative: updatedPoints[lastIdx].cumulative + delta,
    };
    const updatedUser = {
      ...user,
      total: user.total + delta,
      points: updatedPoints,
    };
    const newUsers = prev.users.slice();
    newUsers[idx] = updatedUser;
    return { ...prev, users: newUsers };
  }

  // Not in top-N — fold into the `others` shadow line.
  if (prev.others.points.length === 0) return prev;
  const lastIdx = prev.others.points.length - 1;
  const updatedOtherPoints = prev.others.points.slice();
  updatedOtherPoints[lastIdx] = {
    ...updatedOtherPoints[lastIdx],
    cumulative: updatedOtherPoints[lastIdx].cumulative + delta,
  };
  return {
    ...prev,
    others: {
      ...prev.others,
      total: prev.others.total + delta,
      points: updatedOtherPoints,
    },
  };
}
