/**
 * Components API client.
 *
 * Components are owned by a project — every endpoint is nested under
 * /api/v1/projects/{projectId}/components. DELETE is a soft-archive alias
 * for POST /archive (kept for ergonomics; both behave identically).
 *
 * Mirrors ComponentDTO from skein-api/internal/projects/types.go.
 */

import { apiFetch, apiJson } from './client';
import type { ComponentPath } from './projects';

export interface Component {
  id: string;
  projectId: string;
  name: string;
  description: string;
  paths: ComponentPath[];
  archivedAt?: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  /**
   * Issue counts. Populated only by `listComponents()` — `getComponent()`,
   * `createComponent()`, and `patchComponent()` leave them at zero (those
   * paths don't render the right-aligned counts). Counts ignore closed /
   * deferred issues; the new shell uses them for the row summary.
   */
  openCount: number;
  inProgressCount: number;
  blockedCount: number;
  /**
   * sk-118 (decision #4). Count of `standing` (perpetual-obligation)
   * issues attached to this component. Its OWN «Standing» pill:
   * standing is EXCLUDED from openCount / inProgressCount / blockedCount.
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
   * standing aggregate — same Delegated predicate narrowed to
   * status='standing'. The «Standing» pill flips to this value when
   * `outboxMode` is ON. Optional for graceful degradation.
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
}

export interface CreateComponentInput {
  name: string;
  description?: string;
  paths?: ComponentPath[];
}

export interface PatchComponentInput {
  name?: string;
  description?: string;
  /** Pass [] to clear all paths, omit to leave alone. */
  paths?: ComponentPath[];
}

/**
 * GET /api/v1/projects/{projectId}/components?archived=...&lens=...
 *
 * @param archived — undefined → active only, 'true' → archived only, 'all' → both.
 * @param lens — sk-30 server-side narrowing. 'on-me' / 'delegated' keep only
 *   components with at least one matching issue under the active lens.
 */
export async function listComponents(
  projectId: string,
  archived?: 'true' | 'false' | 'all',
  lens?: 'on-me' | 'delegated',
): Promise<Component[]> {
  const parts: string[] = [];
  if (archived) parts.push(`archived=${encodeURIComponent(archived)}`);
  if (lens) parts.push(`lens=${encodeURIComponent(lens)}`);
  const qs = parts.length > 0 ? `?${parts.join('&')}` : '';
  return apiJson<Component[]>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/components${qs}`,
  );
}

export async function getComponent(projectId: string, id: string): Promise<Component> {
  return apiJson<Component>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/components/${encodeURIComponent(id)}`,
  );
}

export async function createComponent(
  projectId: string,
  input: CreateComponentInput,
): Promise<Component> {
  return apiJson<Component>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/components`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
}

export async function patchComponent(
  projectId: string,
  id: string,
  patch: PatchComponentInput,
): Promise<Component> {
  return apiJson<Component>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/components/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(patch),
    },
  );
}

export async function archiveComponent(projectId: string, id: string): Promise<void> {
  await apiFetch(
    `/api/v1/projects/${encodeURIComponent(projectId)}/components/${encodeURIComponent(id)}/archive`,
    { method: 'POST' },
  );
}

export async function unarchiveComponent(projectId: string, id: string): Promise<void> {
  await apiFetch(
    `/api/v1/projects/${encodeURIComponent(projectId)}/components/${encodeURIComponent(id)}/unarchive`,
    { method: 'POST' },
  );
}

/**
 * DELETE on a component is a soft-archive alias on the server side. We keep
 * the function for callers that prefer the noun "delete" but it behaves
 * exactly like archiveComponent.
 */
export async function deleteComponent(projectId: string, id: string): Promise<void> {
  await apiFetch(
    `/api/v1/projects/${encodeURIComponent(projectId)}/components/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  );
}
