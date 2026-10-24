/**
 * Dependencies API client. Wraps R1.4 endpoints under
 *   /api/v1/projects/{projectId}/issues/{issueId}/dependencies
 *
 * The store NEVER mutates the target issue's status when an edge is
 * inserted (no auto-close of supersedes / duplicates targets). The user
 * does that separately via POST /transitions.
 *
 * Wire shapes mirror skein-api/internal/dependencies/types.go.
 */
import { apiFetch, apiJson } from './client';
import type { IssueStatus, IssueType } from './issues';

// ───────────────────────── Wire enums ─────────────────────────

/**
 * Closed set mirrored from db CHECK on dependencies.type.
 *
 * sk-35: `parent-child` is back as the canonical hierarchy mechanism
 * (beads-style). `from` = child, `to` = parent. The legacy
 * `issues.parent_id` column is frozen — new writes go through the dep
 * table; reads derive parent from the dep graph (see
 * `IssueSummary.parentIdCurrent`).
 */
export type DepType =
  | 'blocks'
  | 'related'
  | 'discovered-from'
  | 'supersedes'
  | 'duplicates'
  | 'waits-for'
  | 'parent-child';

/** Allowed values of metadata.gate when type === 'waits-for'. */
export type Gate = 'all-children' | 'any-children';

// ───────────────────────── Wire DTOs ─────────────────────────

/** Slim summary embedded inside a DependencyEdge.  */
export interface IssueRef {
  id: string;
  projectId: string;
  title: string;
  status: IssueStatus;
  priority: number;
  type: IssueType;
}

/**
 * Wire metadata on a dependency edge. Discriminated by edge `type`:
 * only `waits-for` carries a meaningful `gate`; other types use free-form
 * keys. Index signature keeps the wire-shape open for forward-compat.
 */
export type DependencyMetadata =
  | ({ gate?: Gate } & Record<string, unknown>)
  | Record<string, unknown>;

type DependencyEdgeBase = {
  fromId: string;
  toId: string;
  version: number;
  createdAt: string;
  /**
   * Other side of the edge from the request perspective:
   *   outgoing → Issue == to-side.
   *   incoming → Issue == from-side.
   * Blank when redacted (caller cannot see the foreign project).
   */
  issue?: IssueRef;
  redacted?: boolean;
};

/** Edge with type-narrowed metadata for `waits-for` vs other DepTypes. */
export type DependencyEdge = DependencyEdgeBase &
  (
    | { type: 'waits-for'; metadata: { gate?: Gate } & Record<string, unknown> }
    | { type: Exclude<DepType, 'waits-for'>; metadata: Record<string, unknown> }
  );

export interface DependencyList {
  outgoing: DependencyEdge[];
  incoming: DependencyEdge[];
}

export interface CreateDepInput {
  toId: string;
  type: DepType;
  /** Only honoured when type === 'waits-for'. */
  gate?: Gate;
}

/**
 * 422 dep_cycle carries `path` so the UI can render the cycle for the
 * user. We keep this shape on the BusinessError.extra channel, but expose
 * a typed helper to extract it cleanly.
 */
export interface CycleExtra {
  path?: string[];
}

// ───────────────────────── URL helpers ─────────────────────────

const base = (projectId: string, issueId: string) =>
  `/api/v1/projects/${encodeURIComponent(projectId)}/issues/${encodeURIComponent(issueId)}/dependencies`;

// ───────────────────────── Endpoints ─────────────────────────

/** GET /dependencies → both directions in one shot. */
export async function listDependencies(
  projectId: string,
  issueId: string,
): Promise<DependencyList> {
  return apiJson<DependencyList>(base(projectId, issueId));
}

/**
 * POST /dependencies — insert a single edge.
 *
 * On 422 dep_cycle, the BusinessError.extra contains `{path: [...]}` so
 * the modal can render the cycle. On 409 dependency_exists we keep the
 * default ApiError — the caller can ignore for an idempotent UX.
 */
export async function addDependency(
  projectId: string,
  issueId: string,
  input: CreateDepInput,
): Promise<DependencyEdge> {
  return apiJson<DependencyEdge>(base(projectId, issueId), {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/**
 * DELETE /dependencies/{toId}/{type} — idempotent on the wire (404 if the
 * row was already gone; we silence that here so optimistic UIs don't
 * surface "dependency_not_found" after the user clicked twice).
 */
export async function removeDependency(
  projectId: string,
  issueId: string,
  toId: string,
  type: DepType,
): Promise<void> {
  // Encode both — toId may contain dots (demo-1.1) which are URL-safe but
  // we encode for safety against future hierarchical schemes that use
  // percent-needing chars. type is the closed set above so it never
  // needs encoding, but we apply it uniformly.
  const url =
    `${base(projectId, issueId)}/` +
    `${encodeURIComponent(toId)}/${encodeURIComponent(type)}`;
  await apiFetch(url, { method: 'DELETE' });
}
