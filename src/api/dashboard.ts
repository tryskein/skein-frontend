/**
 * Activity dashboard API client (sk-17).
 *
 * Two endpoints:
 *   - GET /api/v1/dashboard/scoring → 3-axis × 3-window throughput matrix
 *     + 2 leaderboards + per-user matrix.
 *   - GET /api/v1/dashboard/feed → opaque-cursor paginated activity feed
 *     reusing the ActivityEntry shape from the existing /me/activity
 *     endpoint.
 *
 * The live "ticker" updates ride the existing SignalR `event` channel —
 * see hooks/useLiveEvents.tsx + lib/eventEnvelope.ts. The frontend
 * subscribes to those envelopes and converts them into rolling ticker
 * rows; no separate firehose connection is required.
 *
 * sk-674.18 (T030) — every endpoint takes `?space=<short id>` and its rows
 * carry `spaceId` (spaces contract `internal/spaces/contract.go`).
 */

import { apiJson } from './client';
import { buildQuery } from './queryString';
import type { ActivityEntry, ActivityListResponse } from './activity';
import type { IssueStatus, IssueType } from './issues';
import type { PersonStatus } from './users';

// ───────────────────────── Scoring DTOs ─────────────────────────

export type DashboardWindow = '24h' | '7d' | '30d' | 'all-time';

export interface MetricRow {
  key: string;
  human: number;
  agent_directed: number;
  agent_autonomous: number;
}

export interface LeaderboardEntry {
  username: string;
  count: number;
}

export interface MetricScope {
  projectId?: string | null;
  username?: string | null;
}

export interface MatrixUserRow {
  username: string;
  issuesCreatedHuman: number;
  issuesCreatedDirected: number;
  issuesCreatedAutonomous: number;
  issuesClosedHuman: number;
  issuesClosedDirected: number;
  issuesClosedAutonomous: number;
  closedWithCommitsHuman: number;
  closedWithCommitsDir: number;
  closedWithCommitsAuto: number;
  commentsHuman: number;
  commentsDirected: number;
  commentsAutonomous: number;
  closedHumanDriven: number;
}

export interface ScoringResult {
  window: DashboardWindow | string;
  scope: MetricScope;
  metrics: MetricRow[];
  leaderboards: Record<string, LeaderboardEntry[]>;
  matrixUsers: MatrixUserRow[];
}

export interface ScoringQuery {
  window: DashboardWindow;
  projectId?: string | null;
  username?: string | null;
  /**
   * sk-674.18 (T030) — only that space (short id); omitted = every space of
   * the caller ("All my spaces").
   */
  space?: string | null;
}

export async function getDashboardScoring(q: ScoringQuery): Promise<ScoringResult> {
  const qs = buildQuery({
    window: q.window,
    project: q.projectId ?? undefined,
    user: q.username ?? undefined,
    space: q.space,
  });
  return apiJson<ScoringResult>(`/api/v1/dashboard/scoring${qs}`);
}

// ───────────────────────── Feed DTOs ─────────────────────────

export type DashboardFeedEntry = ActivityEntry & {
  /**
   * sk-674.18 (T030) — short id of the row's space. Additive: absent until
   * skein-api serves it.
   */
  spaceId?: string;
};
export type DashboardFeedResponse = Omit<ActivityListResponse, 'items'> & {
  items: DashboardFeedEntry[];
};

export interface FeedQuery {
  limit?: number;
  cursor?: string | null;
  /**
   * sk-674.18 (T030) — only that space (short id); omitted = every space of
   * the caller ("All my spaces").
   */
  space?: string | null;
}

export async function getDashboardFeed(q: FeedQuery = {}): Promise<DashboardFeedResponse> {
  const qs = buildQuery({ limit: q.limit, cursor: q.cursor, space: q.space });
  return apiJson<DashboardFeedResponse>(`/api/v1/dashboard/feed${qs}`);
}

// ───────────────────────── In-progress DTOs ─────────────────────────

/**
 * One row of the "now working" zone — a single issue that's currently
 * being actively worked on (status='in_progress' OR locked_by IS NOT
 * NULL). `since` is the freshest activity timestamp; `staleLock`
 * fires when an agent lock is >25 min old (auto-release ~5 min away).
 */
export interface InProgressRow {
  /** Hierarchical issue id. Optional — dropped on a HARD-redacted row
   * (sk-163.18); guard on `redacted` and key by a composite instead. */
  issueId?: string;
  /** Project UUID. Optional — dropped on a HARD-redacted row. */
  projectId?: string;
  /** Compact project slug. Optional — dropped on a HARD-redacted row. */
  projectPrefix?: string;
  title: string;
  /** Known wire IssueType, or any string for forward-compat. */
  type: IssueType | (string & {});
  priority: number;
  assignee?: string | null;
  assigneeUserId?: string | null;
  /** Known wire IssueStatus, or any string for forward-compat. */
  status: IssueStatus | (string & {});
  /** Raw Mcp-Session-Id of the locking agent. Optional — dropped on a
   * HARD-redacted row (a precise cross-project correlator, no UX value). */
  lockedBySession?: string | null;
  lockedAt?: string | null;
  startedAt?: string | null;
  acceptedAt?: string | null;
  since: string;
  staleLock: boolean;
  /**
   * Server flags rows whose project the caller can't see. Two redaction
   * levels share this flag (sk-163.18):
   *   - SOFT (internal war-room): `title` stripped; `issueId`,
   *     `projectPrefix`, `projectId` KEPT.
   *   - HARD (external caller): the above PLUS `issueId`,
   *     `projectPrefix`, `projectId` and `lockedBySession` all dropped
   *     from the wire. `assignee` / `status` / `priority` / timestamps
   *     are KEPT (the accepted "people + shape" exposure).
   * The frontend renders a 🔒 in place of the id / prefix, colours the
   * row by a constant bucket (not the empty prefix), and keys the row by
   * a composite of kept fields + index (issueId is absent).
   */
  redacted?: boolean;
  /**
   * sk-674.18 (T030) — short id of the row's space. Additive: absent until
   * skein-api serves it.
   */
  spaceId?: string;
}

export interface InProgressResult {
  items: InProgressRow[];
}

export interface InProgressQuery {
  projectId?: string | null;
  limit?: number;
  /**
   * sk-674.18 (T030) — only that space (short id); omitted = every space of
   * the caller ("All my spaces").
   */
  space?: string | null;
}

export async function getDashboardInProgress(
  q: InProgressQuery = {},
): Promise<InProgressResult> {
  const qs = buildQuery({ project: q.projectId ?? undefined, limit: q.limit, space: q.space });
  return apiJson<InProgressResult>(`/api/v1/dashboard/in-progress${qs}`);
}

// ───────────────────────── Agents DTOs (sk-22) ─────────────────────────

/**
 * One row of the `agents` zone — per-user MCP-session counts across
 * four windows. A "session" is one `Mcp-Session-Id` registered in
 * the `agents` table; it rotates on MCP reconnect, so the counts
 * reflect MCP sessions, not physical Claude Code instances.
 */
export interface AgentsRow {
  username: string;
  live: number; // last_seen_at > now - 15min
  h24: number;
  d7: number;
  d30: number;
  allTime: number; // every session ever (no time bound)
}

export interface AgentsResult {
  items: AgentsRow[];
}

export interface AgentsQuery {
  /**
   * sk-674.18 (T030) — only that space (short id); omitted = every space of
   * the caller ("All my spaces").
   */
  space?: string | null;
}

export async function getDashboardAgents(q: AgentsQuery = {}): Promise<AgentsResult> {
  const qs = buildQuery({ space: q.space });
  return apiJson<AgentsResult>(`/api/v1/dashboard/agents${qs}`);
}

// ───────────────────────── Race DTOs (sk-29) ─────────────────────────

/**
 * Race metric — which event-set drives the cumulative line per user.
 *
 *   closed   → `issue.closed` events authored by the user
 *   commits  → closed events whose row joined to commit_refs (shipped code)
 *   created  → `issue.created` events
 *   comments → `comment.created` events
 *
 * Default on the wire and in the UI chip row: `closed`.
 */
export type RaceMetric = 'closed' | 'commits' | 'created' | 'comments';

/**
 * Race window — how far back to fetch. `all` means "since the first
 * event in the DB" and disables the cold-start clamp. Default `30d`.
 */
export type RaceWindow = '7d' | '30d' | '90d' | 'all';

/**
 * One (day, cumulative) datum on a user's race line. `day` is an
 * RFC3339 UTC midnight timestamp (e.g. "2026-05-18T00:00:00Z"); the
 * frontend typically slices the date portion only for the X axis.
 * `cumulative` is the running count of matching events from
 * `effectiveStart` up to and including this day.
 */
export interface RacePoint {
  day: string;
  cumulative: number;
}

/**
 * One user's series on the race chart. `userId` may be missing for
 * legacy events whose `actor_user_id` never got backfilled; in that
 * case `username` is the stable identity key (and the SignalR live
 * increment falls back to matching by username when the envelope's
 * `actorUserId` is absent).
 */
export interface RaceUser {
  userId?: string;
  username: string;
  total: number;
  points: RacePoint[];
}

/**
 * The single "shadow line" lumping all users outside the top-N into
 * one cumulative series. `userCount` is the cardinality of contri-
 * buting users (so the frontend can tooltip "+12 others").
 */
export interface RaceOthers {
  userCount: number;
  total: number;
  points: RacePoint[];
}

/**
 * Wire shape returned by GET /api/v1/dashboard/race.
 *
 * `effectiveStart` / `effectiveEnd` are UTC midnight day-stamps that
 * bound the dense point arrays — every user's `points` array (and
 * `others.points`) is the same length and aligned on the same days,
 * so the frontend can render polylines without per-user X scaling.
 *
 * `isColdStart` fires when `effectiveStart == firstEventInDb` AND
 * `window != all` — i.e. the DB doesn't carry enough history to fill
 * the requested window. The UI swaps the generic "30d race" header
 * for "since {effectiveStart formatted as 'May 18'}".
 */
export interface RaceResult {
  metric: RaceMetric;
  window: RaceWindow;
  firstEventInDb?: string;
  effectiveStart: string;
  effectiveEnd: string;
  isColdStart: boolean;
  users: RaceUser[];
  others: RaceOthers;
}

export interface RaceQuery {
  metric: RaceMetric;
  window: RaceWindow;
  /** Number of coloured lines to return. Default 8 (backend caps at 20). */
  topN?: number;
  /**
   * sk-674.18 (T030) — only that space (short id); omitted = every space of
   * the caller ("All my spaces").
   */
  space?: string | null;
}

export async function getDashboardRace(q: RaceQuery): Promise<RaceResult> {
  const qs = buildQuery({
    metric: q.metric,
    window: q.window,
    topN: q.topN,
    space: q.space,
  });
  return apiJson<RaceResult>(`/api/v1/dashboard/race${qs}`);
}

// ───────────────────────── Projects DTOs (sk-183) ─────────────────────────

/**
 * Window for the per-project HOT ZONE leaderboard
 * (GET /api/v1/dashboard/projects). Distinct type from
 * `DashboardWindow` (`'24h'|'7d'|'30d'|'all-time'`, used by the
 * scoring/throughput endpoints) — this endpoint's "everything" bucket
 * is spelled `all`, matching `RaceWindow`'s convention rather than the
 * legacy `all-time` one.
 */
export type ProjectsWindow = '24h' | '7d' | '30d' | 'all';

/** One user's contribution toward a single metric — powers the
 *  hover-tooltip contributor breakdown on every metric cell. A person
 *  object of the spaces contract (`PersonStatus`). */
export interface ContributorDTO extends PersonStatus {
  username: string;
  userId?: string;
  count: number;
}

/**
 * One metric's total plus its top contributors (server-sorted desc,
 * top 8 max). `otherContributorsCount` is present only when the
 * contributor list was truncated beyond the top 8 — render a
 * trailing "+N more" line when set.
 */
export interface MetricValue {
  count: number;
  contributors: ContributorDTO[];
  otherContributorsCount?: number;
}

/**
 * One row of the per-project HOT ZONE leaderboard.
 *
 * Redaction contract (sk-183 — DELIBERATELY narrower than
 * `InProgressRow.redacted`): when `redacted` is true, ONLY the
 * project-identity fields (`projectName` / `projectPrefix` /
 * `projectId`) are hidden. Every metric (`events`, `commits`,
 * `issuesOpened`, `issuesClosed`, `activeAgents`), `topActor`, and
 * every `contributors[]` entry (including on a redacted row) are
 * ALWAYS fully populated with real data — the server never redacts
 * counts or usernames on this endpoint. This
 * surface's contract differs from the in-progress zone's.
 */
export interface ProjectActivityRow {
  /** Absent/empty when `redacted`. */
  projectId?: string;
  /** Absent/empty when `redacted`. */
  projectName?: string;
  /** Absent/empty when `redacted`. */
  projectPrefix?: string;
  redacted: boolean;
  events: MetricValue;
  commits: MetricValue;
  issuesOpened: MetricValue;
  issuesClosed: MetricValue;
  activeAgents: MetricValue;
  topActor?: ContributorDTO;
  /**
   * sk-674.18 (T030) — short id of the row's space. Additive: absent until
   * skein-api serves it.
   */
  spaceId?: string;
}

export interface ProjectsResult {
  window: ProjectsWindow;
  /** Org-wide "ALL PROJECTS" summary row — org-wide total, never
   *  redacted, carries no project-identity fields. Always render
   *  pinned above `rows`. */
  all: ProjectActivityRow;
  /** Per-project rows, already sorted server-side by `events.count`
   *  desc — do NOT re-sort client-side. */
  rows: ProjectActivityRow[];
}

export async function getDashboardProjects(
  window: ProjectsWindow,
  space?: string | null,
): Promise<ProjectsResult> {
  const qs = buildQuery({ window, space });
  return apiJson<ProjectsResult>(`/api/v1/dashboard/projects${qs}`);
}
