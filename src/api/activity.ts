/**
 * Activity feed API client (R3.4).
 *
 * Wraps two endpoints:
 *   - GET /api/v1/projects/{projectId}/activity → per-project feed
 *   - GET /api/v1/me/activity                  → cross-project feed
 *
 * Both return an `ActivityListResponse` with keyset pagination via an
 * opaque `nextCursor` (base64url over the events.id bigserial).
 *
 * The shape mirrors the inbox NotificationItem so a row can render
 * with the same components — Avatar + summary + relative time +
 * entity link — but Activity is project-visibility-scoped (admin sees
 * everything, non-admin restricted to their member set), where Inbox
 * is recipient-scoped (one user's materialized rows).
 */

import { apiJson } from './client';
import { buildQuery } from './queryString';
import type { PersonStatus } from './users';

// ───────────────────────── Wire DTOs ─────────────────────────

export type ActivityActorType = 'human' | 'agent' | 'system';
export type ActivityEntityType =
  | 'issue'
  | 'project'
  | 'comment'
  | 'dep'
  | 'component';

/** Who did it — a person object of the spaces contract (`PersonStatus`). */
export interface ActivityActor extends PersonStatus {
  /**
   * Absent (omitted) for system events — the backend tags `userId` with
   * `omitempty` and sends nothing when the actor has no user id, so this
   * is `string | null | undefined` on the wire.
   */
  userId?: string | null;
  username: string;
  type: ActivityActorType;
}

export interface ActivityEntity {
  type: ActivityEntityType;
  /** Hierarchical id for issues; uuid string for projects/components.
   * Optional because a HARD-redacted row (external caller, inaccessible
   * project — sk-163.18) drops this field entirely (`omitempty`); every
   * render path MUST guard on `redacted` before dereferencing it. */
  id?: string;
  /** Omitted by the backend (`omitempty`) for entities with no canonical
   * title — dep / component rows, an issue whose title JOIN missed, OR a
   * redacted row whose content was stripped server-side. */
  title?: string;
  /** UUID of the scoping project. Optional — dropped on a HARD-redacted
   * row (sk-163.18). Guard on `redacted`. */
  projectId?: string;
  /** Compact slug (e.g. "demo") for breadcrumbs / route building. Omitted
   * (`omitempty`) when the project JOIN yielded no prefix, OR dropped on
   * a HARD-redacted row (sk-163.18). */
  projectIdPrefix?: string;
}

/**
 * One field-level change inside an `issue.updated` event — mirrors the
 * backend `events.payload.changes[]` shape (sk-73). `oldValue` /
 * `newValue` are free-form keyed by `field`; the formatter renders them
 * per field name.
 */
export interface ActivityChange {
  field: string;
  oldValue?: unknown;
  newValue?: unknown;
}

/**
 * Known activity event types from the wire feed. Open-ended via
 * `| (string & {})` so forward-compat events still type-check while
 * known literals stay autocomplete-friendly.
 */
export type ActivityEventType =
  | 'issue.created'
  | 'issue.accepted'
  | 'issue.claimed'
  | 'issue.unclaimed'
  | 'issue.closed'
  | 'issue.archived'
  | 'issue.status_changed'
  // sk-489 (US-3) — a change of a closed issue's outcome. The type is public and
  // gets into the history feed on a par with its neighbours; the sides of the transition
  // come as the usual `oldValue` / `newValue`, as with a status change.
  | 'issue.outcome_changed'
  | 'issue.reparented'
  | 'issue.updated'
  | 'comment.created'
  | 'dependency.created'
  | 'dependency.deleted'
  | (string & {});

export interface ActivityEntry {
  id: number;
  occurredAt: string;
  type: ActivityEventType;
  actor: ActivityActor;
  entity: ActivityEntity;
  /** Set on field_changed.* and issue.updated children — rare in feed. */
  field?: string;
  /** Pre-formatted human-readable summary, built via FormatSummary.
   * Optional — stripped (`omitempty`) on a redacted row, since the
   * summary embeds the title / id the redaction is hiding. */
  summary?: string;
  /**
   * sk-73 — single-field old/new for events that store a scalar diff in
   * events.old_data / new_data: `issue.status_changed` (status strings),
   * `issue.reparented` ({parentIds}/{parentId}), `dependency.created` /
   * `dependency.deleted` (the edge descriptor). Absent for events with
   * no scalar diff.
   */
  oldValue?: unknown;
  newValue?: unknown;
  /**
   * sk-73 — per-field diff for `issue.updated`, lifted from
   * events.payload.changes[]. Absent for every other event type.
   */
  changes?: ActivityChange[];
  /** UUID of the scoping project. Optional — dropped on a HARD-redacted
   * row (sk-163.18); the feed keys off the event `id`, not `projectId`. */
  projectId?: string;
  /**
   * Server flags rows whose project the caller can't see. Two redaction
   * levels share this flag (sk-163.18):
   *   - SOFT (internal war-room): `title` / `summary` stripped; issue
   *     `id`, project prefix and `projectId` KEPT.
   *   - HARD (external caller): the above PLUS `entity.id`,
   *     `entity.projectIdPrefix`, `entity.projectId` and top-level
   *     `projectId` all dropped — every stable project/task identifier
   *     is absent from the wire, not merely blurred in CSS.
   * The frontend renders redacted rows with a 🔒 in place of the id /
   * prefix and an inactive (non-navigable) link. `DashboardFeedEntry`
   * aliases this type and inherits the field.
   */
  redacted?: boolean;
}

export interface ActivityListResponse {
  items: ActivityEntry[];
  /** Absent (omitted via `omitempty`) when there is no further page; may
   * also arrive as explicit null. Treat undefined and null identically. */
  nextCursor?: string | null;
}

// ───────────────────────── Inputs ─────────────────────────

export interface ActivityListParams {
  /** 1..100, default 50. */
  limit?: number;
  cursor?: string | null;
}

// ───────────────────────── Endpoints ─────────────────────────

export async function listProjectActivity(
  projectId: string,
  params: ActivityListParams = {},
): Promise<ActivityListResponse> {
  const qs = buildQuery({ limit: params.limit, cursor: params.cursor });
  return apiJson<ActivityListResponse>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/activity${qs}`,
  );
}

/**
 * Per-issue activity feed (P5).
 *
 * Replaces the F5 stop-gap where the frontend pulled the project-wide
 * top-100 events and filtered client-side; that broke for busy projects
 * whose issue's events fell off the first page. The server-side
 * predicate covers direct issue events, comment events on this issue,
 * and dependency-edge events that mention the issue on either side.
 *
 * Wire shape is identical to the project + /me feeds — same
 * ActivityEntry rows, same opaque cursor.
 */
export async function listIssueActivity(
  projectId: string,
  issueId: string,
  params: ActivityListParams = {},
): Promise<ActivityListResponse> {
  const qs = buildQuery({ limit: params.limit, cursor: params.cursor });
  return apiJson<ActivityListResponse>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/issues/${encodeURIComponent(issueId)}/activity${qs}`,
  );
}

export async function listMyActivity(
  params: ActivityListParams = {},
): Promise<ActivityListResponse> {
  const qs = buildQuery({ limit: params.limit, cursor: params.cursor });
  return apiJson<ActivityListResponse>(`/api/v1/me/activity${qs}`);
}
