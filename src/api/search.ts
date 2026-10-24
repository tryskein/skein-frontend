/**
 * Global hybrid search API client. Wraps the single endpoint
 *   GET /api/v1/search?q=...&project=&kind=&limit=&cursor=&status=&priority=&type=&label=
 *
 * The backend fans out across four entity kinds (issue, comment, project,
 * component), runs vector + dual-FTS retrieval, fuses with RRF, and emits
 * unified result rows. The wire shape is FROZEN by R1.5 spec — see
 * skein-api docs for details. This client only renders.
 *
 * Errors:
 *   - 401 → handled by apiFetch (RequireAuth re-routes to /login)
 *   - 400 q_required / q_too_long / invalid_kind / invalid_cursor → ApiError
 *   - 422 (none defined for /search today) → BusinessError
 *   - 200 with `degraded: true` → Ollama down, only FTS results returned;
 *     UI must surface this to the user.
 *
 * Filter parameters status / priority / type / label are silently ignored
 * by the server when `kind` doesn't include `issue`. The client passes
 * them through unchanged — explicit user choice still survives a
 * hypothetical future where the backend grows comment/project filters.
 */

import { apiJson } from './client';
import type { IssueSource, IssueStatus, IssueType } from './issues';

// ───────────────────────── Wire enums ─────────────────────────

export type SearchKind = 'issue' | 'comment' | 'project' | 'component';

export const ALL_KINDS: SearchKind[] = ['issue', 'comment', 'project', 'component'];

// ───────────────────────── Wire DTOs ─────────────────────────

/**
 * One row of the unified result set. Common fields are always present;
 * kind-specific fields are populated only when `kind` matches. The
 * snippet is `ts_headline()` output and may contain `<b>highlight</b>`
 * tags — render through SearchHighlight (DOMPurify allowlist).
 */
export interface SearchItem {
  kind: SearchKind;
  /** UUID for project/component, varchar(1000) hierarchical id for issue/comment. */
  id: string;
  /** null when the row IS the project entity itself. */
  projectId: string | null;
  /**
   * sk-674.18 (T031) — short id of the hit's space. Additive: absent until
   * skein-api serves it.
   */
  spaceId?: string;
  /** Human-readable project name, always populated for context. */
  projectName: string;
  /** Issue.title / project.name / component.name / first 100 chars of comment.body. */
  title: string;
  /** ts_headline() output — may contain `<b>` tags. Render via SearchHighlight. */
  snippet: string;
  /** RRF score, opaque to UI — backend already sorted by it. */
  score: number;
  /** True when this row matched the ID prefix fast-path (top hit). */
  exactMatch: boolean;

  // Issue-specific (kind === 'issue')
  status?: IssueStatus;
  priority?: number;
  type?: IssueType;
  pinned?: boolean;
  assignee?: string | null;

  // Comment-specific (kind === 'comment')
  /** Issue id this comment belongs to (for navigation). */
  parentIssueId?: string;
  authorUsername?: string;

  // Project-specific (kind === 'project')
  archived?: boolean;

  // Component-specific (kind === 'component')
  componentArchived?: boolean;

  /** Common: ISO datetime, last modification of the underlying entity. */
  updatedAt: string;
}

export interface SearchResponse {
  items: SearchItem[];
  nextCursor: string | null;
  hasMore: boolean;
  /** True when Ollama was down — results are FTS-only, no vector recall. */
  degraded: boolean;
  tookMs: number;
}

// ───────────────────────── Inputs ─────────────────────────

export interface SearchParams {
  /** Required, length 1..500. */
  q: string;
  /** Optional UUID — narrow to one project. Without it: all visible projects. */
  project?: string;
  /** Subset of kinds. Default (omit) = all four. */
  kind?: SearchKind[];
  /** 1..100, default 50. */
  limit?: number;
  /** Server-opaque base64. Pass back the previous response's nextCursor. */
  cursor?: string | null;

  // Issue-only filters (silently dropped when kind excludes 'issue').
  status?: IssueStatus[];
  priority?: number;
  type?: IssueType;
  /** Repeated `?label=` on the wire. */
  labels?: string[];
  /**
   * Filter issues by origin — one of the server's closed set
   * (`IssueSource`: `human` / `agent_directed` / `agent_autonomous`).
   * Vision §F24/§F25. Server returns 400 invalid_source on anything
   * else; silently dropped server-side when kind excludes 'issue'.
   */
  source?: IssueSource;
  /** sk-674.18 (T031) — only that space (short id). Without it: every visible space. */
  space?: string | null;
}

// ───────────────────────── URL builder ─────────────────────────

function buildSearchQuery(p: SearchParams): string {
  const parts: string[] = [];
  const push = (k: string, v: string | number | boolean) =>
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);

  // Required.
  push('q', p.q);

  if (p.project) push('project', p.project);
  if (p.kind && p.kind.length) push('kind', p.kind.join(','));
  if (p.limit !== undefined) push('limit', p.limit);
  if (p.cursor) push('cursor', p.cursor);

  if (p.status && p.status.length) push('status', p.status.join(','));
  if (p.priority !== undefined) push('priority', p.priority);
  if (p.type) push('type', p.type);
  if (p.labels) for (const l of p.labels) push('label', l);
  if (p.source) push('source', p.source);
  if (p.space) push('space', p.space);

  return `?${parts.join('&')}`;
}

// ───────────────────────── Endpoint ─────────────────────────

/**
 * GET /api/v1/search — single hybrid endpoint. The server enforces:
 *   - q non-empty, max 500 chars
 *   - limit clamp 1..100 (default 50)
 *   - cursor opacity (we never construct cursors client-side)
 *
 * Any filter parameter passed when `kind` excludes `issue` is dropped
 * server-side; we send what the caller asked and let the contract
 * dictate visibility.
 */
export async function globalSearch(params: SearchParams): Promise<SearchResponse> {
  return apiJson<SearchResponse>(`/api/v1/search${buildSearchQuery(params)}`);
}

// ───────────────────────── ID-prefix lookup ─────────────────────────

/**
 * Inputs for the lightweight ID-prefix lookup endpoint.
 *
 *   q          — query string (the SQL self-gates on the id-prefix
 *                regex; pass anything, free text yields empty items)
 *   projectId  — optional UUID to narrow to one project
 */
export interface IdLookupParams {
  q: string;
  projectId?: string;
}

/**
 * Response shape for /api/v1/search/lookup-id.
 *
 * The server reuses the search.Item DTO, so item objects are
 * structurally identical to SearchItem — share the same TS type
 * everywhere so callers can render lookup-id rows through the same
 * highlight / icon paths the full /search results use.
 */
export interface IdLookupResponse {
  items: SearchItem[];
}

/**
 * GET /api/v1/search/lookup-id — typeahead direct-jump endpoint.
 *
 * Sibling to /api/v1/search, but skips the full hybrid pipeline:
 *   - No embedding round-trip
 *   - No cache, no cursor pagination
 *   - Returns up to 10 rows (issues + projects) matching the typed
 *     id prefix
 *   - Free-text queries fail the SQL regex gate and produce an empty
 *     items array (200, NOT 4xx)
 *
 * Used by the tasks-column search box on the new shell so the user
 * can type `sk-14<Enter>` and jump directly to the issue without
 * waiting for the four-kind hybrid stack to settle.
 */
export async function idLookup(params: IdLookupParams): Promise<IdLookupResponse> {
  const parts: string[] = [];
  const push = (k: string, v: string) =>
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  push('q', params.q);
  if (params.projectId) push('project', params.projectId);
  return apiJson<IdLookupResponse>(`/api/v1/search/lookup-id?${parts.join('&')}`);
}

// ───────────────────────── Batch ID lookup ─────────────────────────

/**
 * Response shape for POST /api/v1/search/lookup-id-batch (sk-47.2).
 *
 * Like /lookup-id, the server reuses the search.Item DTO so each row is
 * structurally identical to SearchItem. The contract is FROZEN — a
 * parallel backend task builds the endpoint:
 *
 *   - The body is `{ ids: string[] }` — the exact hierarchical codes the
 *     client extracted from a pasted blob (e.g. ["sk-14", "demo-2.1"]).
 *   - The response is `{ items: SearchItem[] }` containing ONLY the rows
 *     that were found AND are visible to the caller. The server does NOT
 *     echo back a "not found" list — the client diffs the requested ids
 *     against the returned `items` (by `id`) to learn which codes were
 *     absent (nonexistent OR not visible). Both cases render as the same
 *     dimmed "not found" chip; the server intentionally does not
 *     distinguish them (it would leak the existence of issues in projects
 *     the caller can't see).
 *   - Resolution is filter-agnostic and spans every visible project —
 *     pasted codes are frequently cross-project, so board filters never
 *     narrow this lookup.
 */
export interface LookupIdBatchResponse {
  items: SearchItem[];
}

/**
 * POST /api/v1/search/lookup-id-batch — resolve a set of hierarchical
 * issue codes to their SearchItem rows in one round-trip.
 *
 * Powers the Tasks-column paste-a-blob flow (sk-47.2): the user pastes a
 * chunk of text, the client extracts the issue codes (see
 * `extractIssueCodes`), and this call resolves them all at once. Only
 * found+visible rows come back; the caller diffs to surface "not found"
 * chips for the rest.
 *
 * `ids` should already be de-duplicated by the caller (extractIssueCodes
 * dedupes), but the endpoint is robust to duplicates either way.
 */
export async function lookupIdBatch(ids: string[]): Promise<LookupIdBatchResponse> {
  return apiJson<LookupIdBatchResponse>('/api/v1/search/lookup-id-batch', {
    method: 'POST',
    body: JSON.stringify({ ids }),
  });
}
