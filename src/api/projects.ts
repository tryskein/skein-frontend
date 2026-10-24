/**
 * Projects API client. Wraps GET/POST/PATCH/DELETE for /api/v1/projects/*
 * via the BFF cookie session. Every function returns parsed JSON or throws
 * one of the typed errors from ./client (UnauthorizedError, BusinessError,
 * ApiError) so callers can branch with `instanceof`.
 *
 * Type names mirror the Go DTOs in skein-api/internal/projects/types.go.
 * Field shapes use camelCase exactly as the Go json tags emit them.
 */

import { apiFetch, apiJson, BusinessError } from './client';
import { buildQuery } from './queryString';
import type { ProjectVisibility } from './spaces';
import type { PersonStatus } from './users';

// ───────────────────────── Types (mirrors Go DTOs) ─────────────────────────

export type IDMode = 'counter' | 'hash' | 'custom';
export type Role = 'owner' | 'member';
export type AddedByKind = 'human' | 'agent' | 'system';

/** One git_repo entry inside a project. */
export interface GitRepo {
  id: string;
  name: string;
  url: string;
  /** Optional. Empty when never set. */
  defaultBranch?: string;
}

/** Component path: glob pattern scoped to a specific repo within the project. */
export interface ComponentPath {
  repoId: string;
  glob: string;
}

/**
 * Per-project status / caller-scoped breakdown. Mirrors
 * skein-api/internal/projects/types.go::ProjectStats. All counts ignore
 * the "issue archived" notion (issues have no archived_at — `closed`
 * is terminal) and are project-wide except `myAssigned` / `myCreated`
 * which are scoped to the request actor.
 */
export interface ProjectStats {
  open: number;
  inProgress: number;
  blocked: number;
  deferred: number;
  closed: number;
  /**
   * sk-118 (decision #4). Count of `standing` (perpetual-obligation)
   * issues. Standing is EXCLUDED from open / inProgress / blocked /
   * myAssigned (those route through the backend `status.ActiveWork`
   * predicate) and reported here so the «Standing» pill renders as a
   * distinct aggregate rather than folding into open work. Wire field
   * is `standingCount`. Optional for graceful degradation if the
   * frontend ships ahead of the backend.
   */
  standingCount?: number;
  total: number;
  /** Issues assigned to the caller, excluding closed. */
  myAssigned: number;
  /** Issues created by the caller (any status). */
  myCreated: number;
  /** ISO datetime of max(updated_at) across all issues; null when project has zero issues. */
  lastActivity?: string | null;
}

/**
 * Full project DTO returned by GET /projects/{id}.
 * Note: backend returns `gitRepos` (array) — the *Count fields below carry
 * the cheap aggregates the UI uses to render headers without a second
 * round-trip. There is no `aliasesCount` server-side; UI fetches aliases
 * separately when rendering the aliases tab. `stats` carries the per-status
 * breakdown for the project tooltip.
 */
export interface Project {
  id: string;
  name: string;
  idPrefix: string;
  defaultIdMode: IDMode;
  description: string;
  gitRepos: GitRepo[];
  /** Optional — null/undefined when never set. */
  gitlabGroup?: string | null;
  /** ISO datetime, present iff project has been archived. */
  archivedAt?: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  membersCount: number;
  componentsCount: number;
  reposCount: number;
  stats: ProjectStats;
  /**
   * sk-674.18 (T032) — short id of the project's space; never null once
   * served. Additive: absent until skein-api serves it.
   */
  spaceId?: string;
  /**
   * sk-674.18 (T024) — `space`: every member of the space sees it;
   * `members`: only project members and the space owner. Additive: absent
   * until skein-api serves it.
   */
  visibility?: ProjectVisibility;
}

/**
 * Lean shape returned by GET /projects (cursor-paginated). Issue counts
 * (open / inProgress / blocked) ride along on every row so the new
 * shell can render the right-aligned `{open}/{inProgress}` summary
 * without N round-trips against /projects/{id}.
 */
export interface ProjectListItem {
  id: string;
  name: string;
  idPrefix: string;
  defaultIdMode: IDMode;
  description: string;
  archivedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  openCount: number;
  inProgressCount: number;
  blockedCount: number;
  /**
   * sk-118 (decision #4). Count of `standing` (perpetual-obligation)
   * issues on this project row. Surfaced as its OWN «Standing» pill:
   * standing is EXCLUDED from openCount / inProgressCount / blockedCount
   * (they route through the backend `status.ActiveWork` predicate).
   * Optional for graceful degradation if frontend ships ahead.
   */
  standingCount?: number;
  /**
   * My-assigned-mode (outbox) per-status counts: same shape as the
   * unscoped `*Count` fields above but narrowed to "issues the caller
   * created and delegated to someone else" — created_by = caller AND
   * assignee != caller's username. The new shell flips its row counts
   * to these when `useLayoutState().outboxMode` is ON. Backend
   * collapses to zero when it can't resolve the caller's username.
   */
  myOutboxOpenCount: number;
  myOutboxInProgressCount: number;
  myOutboxBlockedCount: number;
  /**
   * sk-118 (decision #4 + outboxMode invariant). The outbox-scoped
   * standing aggregate — same Delegated predicate as myOutboxOpenCount
   * narrowed to status='standing'. The «Standing» pill flips to this
   * value when `outboxMode` is ON, exactly like the other counts.
   * Optional for graceful degradation.
   */
  myOutboxStandingCount?: number;
  /**
   * "On me" lens (sk-30) per-status counts: same shape as the unscoped
   * `*Count` fields but narrowed to "issues assigned to the caller by
   * SOMEONE ELSE that the caller has already accepted" — LOWER(assignee)
   * = LOWER(callerUsername) AND created_by != caller AND accepted_at IS
   * NOT NULL. Optional so the type degrades gracefully if backend ships
   * before frontend.
   */
  onMeOpenCount?: number;
  onMeInProgressCount?: number;
  onMeBlockedCount?: number;
  /**
   * sk-32. Number of epic-typed, non-closed issues in this project
   * whose child set is non-empty AND every child is closed — i.e.
   * epics the UI should surface as "ready to close". Empty epics
   * never qualify. Children sourced from hierarchical (parent_id)
   * only (sk-33 dropped the parent-child dep edge). Optional to
   * degrade gracefully if backend ships before frontend.
   */
  epicsEligibleCount?: number;
  /**
   * sk-551.52 / sk-551.53. Number of NON-archived components in this
   * project. The Projects column hides the row's expand chevron when it
   * is 0 (nothing to unfold). Optional: an API without sk-551.53 does not
   * send it, and then the chevron is drawn as before.
   */
  componentsCount?: number;
  /**
   * sk-674.18 (T032) — short id of the project's space; never null once
   * served. Additive: absent until skein-api serves it.
   */
  spaceId?: string;
  /**
   * sk-674.18 (T024) — `space`: every member of the space sees it;
   * `members`: only project members and the space owner. Additive: absent
   * until skein-api serves it.
   */
  visibility?: ProjectVisibility;
}

export interface ListProjectsResult {
  items: ProjectListItem[];
  /**
   * Caller-visible total under the same WHERE clause used to fetch
   * `items` (permission + archived + optional search match). Powers
   * the column-header counter in the new shell. Exact COUNT(*) — fast
   * (~2 ms) on a 13k-row projects table.
   */
  total: number;
  nextCursor?: string | null;
  hasMore: boolean;
}

export interface CreateProjectInput {
  name: string;
  description?: string;
  /** Auto-derived from name on the server when omitted. Immutable post-creation. */
  idPrefix?: string;
  defaultIdMode?: IDMode;
  gitlabGroup?: string | null;
  /**
   * sk-674.18 (T024) — the space (short id) to create the project in.
   * "Eligible" spaces are those GET /me/spaces lists with
   * `canCreateProject=true`.
   *  - Given: the project goes there. A space the caller cannot see → 404
   *    `space_not_found`; one seen only through the admin's access
   *    (`adminAccess`) → 422 `not_space_member` (`NotSpaceMemberRefusal`).
   *  - Omitted, exactly one eligible space → that one.
   *  - Omitted, several eligible spaces → 422 `space_required` carrying
   *    `spaces` (`SpaceRequiredRefusal`).
   *  - No eligible space (an external user) → 422
   *    `external_cannot_create_project`, as before.
   */
  spaceId?: string;
  /**
   * sk-674.18 (T024) — omitted: SKEIN_PROJECT_DEFAULT_VISIBILITY
   * (`members` in a personal space).
   */
  visibility?: ProjectVisibility;
}

export interface PatchProjectInput {
  name?: string;
  description?: string;
  defaultIdMode?: IDMode;
  /** Pass null/'' to clear, omit to leave alone. */
  gitlabGroup?: string | null;
  /**
   * sk-674.18 (T024) — `space → members` takes access away from members
   * outside the project (INV-12). The space itself cannot change: a
   * `spaceId` is refused with 422 `space_change_forbidden`.
   */
  visibility?: ProjectVisibility;
}

export interface ProjectAlias {
  alias: string;
  projectId: string;
  addedBy: string;
  addedByKind: AddedByKind;
  createdAt: string;
}

export interface ProjectMember extends PersonStatus {
  userId: string;
  username: string;
  name: string;
  role: Role;
  addedAt: string;
  addedBy: string;
}

export interface AddRepoInput {
  name: string;
  url: string;
  defaultBranch?: string;
}

export interface UpdateRepoInput {
  name?: string;
  url?: string;
  defaultBranch?: string;
}

/** How project resolve matched a candidate (wire values from resolve.go). */
export type ResolveMatchedVia =
  | 'name'
  | 'alias'
  | 'trigram-name'
  | 'trigram-alias'
  | 'repo'
  | (string & {});

export interface ResolveMatch {
  id: string;
  name: string;
  idPrefix: string;
  similarity: number;
  matchedVia: ResolveMatchedVia;
}

/**
 * Result of GET /projects/resolve. sk-674.18 (INV-29): the string resolves
 * only among the caller's accessible projects; an exact-name match of
 * several of them is the final refusal 422 `ambiguous_project` carrying
 * `q` and `candidates` (`AmbiguousProjectRefusal`), which fuzzy matching
 * does not override.
 */
export interface ResolveResult {
  /** Non-null when one candidate was a clear winner. */
  match: ResolveMatch | null;
  candidates: ResolveMatch[];
}

// ───────────────────────── Listing & search ─────────────────────────

export interface ListProjectsParams {
  /** 'false' (default) | 'true' | 'all' */
  archived?: 'false' | 'true' | 'all';
  search?: string;
  /**
   * Free-form search query. Server runs FTS against tsv_ru/tsv_en
   * (russian+english stemming), plus idPrefix prefix, name ILIKE
   * substring, and project_aliases match. When set, items are ordered
   * by relevance score; empty falls through to the alphabetic listing.
   */
  q?: string;
  cursor?: string | null;
  /** 1..100, default 50. */
  limit?: number;
  mineOnly?: boolean;
  /**
   * sk-30 — server-side lens narrowing. When set, only projects with
   * at least one matching issue under the lens (open / in_progress /
   * blocked) survive the HAVING filter. Undefined leaves the full
   * caller-visible list intact (current behaviour). The frontend
   * flips this from `useLayoutState`'s `onMeMode` / `outboxMode`.
   */
  lens?: 'on-me' | 'delegated';
  /**
   * sk-674.18 (T024) — only that space's projects (short id). Rows are
   * ordered personal → common → others by space name, then by project name
   * (or by relevance with `q`).
   */
  space?: string | null;
}

export async function listProjects(params: ListProjectsParams = {}): Promise<ListProjectsResult> {
  const qs = buildQuery({
    archived: params.archived,
    search: params.search,
    q: params.q,
    cursor: params.cursor,
    limit: params.limit,
    mineOnly: params.mineOnly,
    lens: params.lens,
    space: params.space,
  });
  return apiJson<ListProjectsResult>(`/api/v1/projects${qs}`);
}

export async function resolveProject(q: string): Promise<ResolveResult> {
  return apiJson<ResolveResult>(`/api/v1/projects/resolve?q=${encodeURIComponent(q)}`);
}

// ───────────────────────── CRUD ─────────────────────────

export async function getProject(id: string): Promise<Project> {
  return apiJson<Project>(`/api/v1/projects/${encodeURIComponent(id)}`);
}

/**
 * POST /api/v1/projects. sk-674.18 refusals of the space choice (see
 * `CreateProjectInput.spaceId`): 404 `space_not_found`; 422
 * `not_space_member` (with `spaceId`), `space_required` (with `spaces`).
 */
export async function createProject(input: CreateProjectInput): Promise<Project> {
  return apiJson<Project>('/api/v1/projects', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function patchProject(id: string, patch: PatchProjectInput): Promise<Project> {
  return apiJson<Project>(`/api/v1/projects/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function archiveProject(id: string): Promise<void> {
  await apiFetch(`/api/v1/projects/${encodeURIComponent(id)}/archive`, { method: 'POST' });
}

export async function unarchiveProject(id: string): Promise<void> {
  await apiFetch(`/api/v1/projects/${encodeURIComponent(id)}/unarchive`, { method: 'POST' });
}

// ───────────────────────── Repos ─────────────────────────

export async function addRepo(projectId: string, input: AddRepoInput): Promise<GitRepo> {
  return apiJson<GitRepo>(`/api/v1/projects/${encodeURIComponent(projectId)}/repos`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateRepo(
  projectId: string,
  repoId: string,
  patch: UpdateRepoInput,
): Promise<GitRepo> {
  return apiJson<GitRepo>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/repos/${encodeURIComponent(repoId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(patch),
    },
  );
}

export async function removeRepo(projectId: string, repoId: string): Promise<void> {
  await apiFetch(
    `/api/v1/projects/${encodeURIComponent(projectId)}/repos/${encodeURIComponent(repoId)}`,
    { method: 'DELETE' },
  );
}

// ───────────────────────── Aliases ─────────────────────────

export async function listAliases(projectId: string): Promise<ProjectAlias[]> {
  return apiJson<ProjectAlias[]>(`/api/v1/projects/${encodeURIComponent(projectId)}/aliases`);
}

export async function addAlias(projectId: string, alias: string): Promise<ProjectAlias> {
  return apiJson<ProjectAlias>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/aliases`,
    {
      method: 'POST',
      body: JSON.stringify({ alias }),
    },
  );
}

export async function removeAlias(projectId: string, alias: string): Promise<void> {
  // Cyrillic / unicode aliases — encodeURIComponent is mandatory, the alias
  // is part of the URL path.
  await apiFetch(
    `/api/v1/projects/${encodeURIComponent(projectId)}/aliases/${encodeURIComponent(alias)}`,
    { method: 'DELETE' },
  );
}

// ───────────────────────── Members ─────────────────────────

export async function listMembers(projectId: string): Promise<ProjectMember[]> {
  return apiJson<ProjectMember[]>(`/api/v1/projects/${encodeURIComponent(projectId)}/members`);
}

export async function upsertMember(
  projectId: string,
  userId: string,
  role: Role,
): Promise<ProjectMember> {
  return apiJson<ProjectMember>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(userId)}`,
    {
      method: 'PUT',
      body: JSON.stringify({ role }),
    },
  );
}

export async function removeMember(projectId: string, userId: string): Promise<void> {
  await apiFetch(
    `/api/v1/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(userId)}`,
    { method: 'DELETE' },
  );
}

// ───────────────────────── Error code helpers ─────────────────────────

/**
 * The Go handler emits ProblemDetails-style 422 bodies that include a
 * machine-readable code in the message. Some endpoints embed extra fields
 * (existingProjectId/existingProjectName for alias_taken, components for
 * repo_in_use). We surface those by reading the Response again is too
 * late — the BusinessError already wraps the message string. This helper
 * tries to parse the message back into a known code so call sites can
 * branch on it.
 *
 * NOTE: BusinessError currently keeps only a string `message`. We rely on
 * server-side conventions: the message contains the human description, but
 * the *type* is signalled by HTTP status + endpoint. Callers should match
 * on `err instanceof BusinessError` AND optionally check `err.message`.
 */
export function isBusinessError(err: unknown): err is BusinessError {
  return err instanceof BusinessError;
}

// ───────────────────────── Prefixes (sk-674.18, T025) ─────────────────────────

/** 200 body of GET /projects/prefix-suggestions. */
export interface PrefixSuggestionsResponse {
  /** Free prefixes, best first: the first goes into the field, the next 3–4 are offered as buttons. Not reserved. */
  suggestions: string[];
}

/**
 * GET /api/v1/projects/prefix-suggestions?name=&spaceId= — free prefixes
 * derived from the project name. Refusals: 400 `validation_error` (no
 * name), 429.
 */
export async function getPrefixSuggestions(
  name: string,
  spaceId?: string | null,
): Promise<PrefixSuggestionsResponse> {
  const qs = buildQuery({ name, spaceId });
  return apiJson<PrefixSuggestionsResponse>(`/api/v1/projects/prefix-suggestions${qs}`);
}

/** 200 body of GET /projects/prefix-check. A taken prefix never says where or by whom. */
export interface PrefixCheckResponse {
  available: boolean;
  /** null when available, otherwise `prefix_taken` | `prefix_invalid`. */
  reason: 'prefix_taken' | 'prefix_invalid' | null;
  /** 2–3 free prefixes when taken; empty otherwise. */
  suggestions: string[];
}

/** GET /api/v1/projects/prefix-check?prefix=. Refusal: 429. */
export async function checkPrefix(prefix: string): Promise<PrefixCheckResponse> {
  const qs = buildQuery({ prefix });
  return apiJson<PrefixCheckResponse>(`/api/v1/projects/prefix-check${qs}`);
}
