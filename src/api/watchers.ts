/**
 * Watchers API client. Wraps endpoints under
 *   /api/v1/issues/{iid}/watch     POST/DELETE
 *   /api/v1/issues/{iid}/watchers  GET
 *   /api/v1/projects/{pid}/watch   POST/DELETE
 *   /api/v1/projects/{pid}/watchers GET
 *
 * Watch reasons are server-derived: the backend tracks why a user is
 * watching (creator, assignee, commenter, mention, manual). Manual
 * un-watch is recorded as `unwatched` so re-derivation doesn't add the
 * user back automatically.
 */

import { apiFetch, apiJson } from './client';
import type { PersonStatus } from './users';

// ───────────────────────── Wire enums ─────────────────────────

export type WatchReason =
  | 'creator'
  | 'assignee'
  | 'commenter'
  | 'mention'
  | 'manual'
  | 'unwatched';

// ───────────────────────── Wire DTOs ─────────────────────────

/**
 * A watcher of an issue or a project — a person object of the spaces
 * contract (sk-674.18, T027): {@link PersonStatus} marks a departed or
 * deleted watcher.
 */
export interface WatcherEntry extends PersonStatus {
  userId: string;
  username: string;
  name: string;
  /** All reasons that apply, ordered by server. May contain `unwatched` last. */
  reasons: WatchReason[];
  /** ISO datetime of first reason that triggered the watch. */
  since: string;
}

// ───────────────────────── Issue watchers ─────────────────────────

const issuesBase = (iid: string) =>
  `/api/v1/issues/${encodeURIComponent(iid)}`;

export async function watchIssue(iid: string): Promise<void> {
  await apiFetch(`${issuesBase(iid)}/watch`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

/**
 * DELETE /api/v1/issues/{id}/watch — the caller's explicit «stop
 * watching» (sk-622.21, US-6). On a subscribed task: the subscription is
 * deleted and an opt-out recorded. On a historical Watching card (no
 * subscription): only the card is removed, no opt-out (R3). Either way
 * the card leaves the Watching column. Idempotent.
 */
export async function unwatchIssue(iid: string): Promise<void> {
  await apiFetch(`${issuesBase(iid)}/watch`, { method: 'DELETE' });
}

export async function listIssueWatchers(iid: string): Promise<WatcherEntry[]> {
  return apiJson<WatcherEntry[]>(`${issuesBase(iid)}/watchers`);
}

// ───────────────────────── Bulk unwatch (sk-551.10) ─────────────────────────

/**
 * Body of POST /api/v1/me/watching/unwatch — exactly one selector.
 *
 * - `issueIds`: an explicit selection, handled per card kind. A card the
 *   caller is subscribed to is stopped like `unwatchIssue` (manual ones
 *   too — picking them is the explicit choice; an opt-out is recorded);
 *   a historical card is removed without an opt-out (sk-622.21, R3).
 * - `state`: every subscription on tasks in that state, without an
 *   opt-out; manual ones are kept (and counted in `keptManual`) unless
 *   `includeManual`. Every historical card of a task in that state is
 *   removed too.
 *
 * Only the caller's own subscriptions and cards change.
 */
export type BulkUnwatchInput =
  | { issueIds: string[] }
  | { state: 'open' | 'closed' | 'all'; includeManual?: boolean };

/**
 * What a bulk unwatch did. Wire literal (sk-622.21 T008):
 * `{"unwatched":3,"keptManual":1,"historicalRemoved":2}`.
 */
export interface BulkUnwatchResult {
  /** Subscriptions stopped. */
  unwatched: number;
  /** Manual subscriptions a state sweep matched and left alone. */
  keptManual: number;
  /**
   * Historical Watching cards removed, counted in cards (distinct tasks,
   * not notifications). Cards of tasks that were still watched are in
   * `unwatched`, never here.
   */
  historicalRemoved: number;
}

/**
 * Read a bulk-unwatch body. A count the body does not carry is 0: an API
 * from before T008 sends no `historicalRemoved`, and it removed no
 * historical card — it had none.
 */
export function normalizeBulkUnwatchResult(raw: unknown): BulkUnwatchResult {
  const src = (raw ?? {}) as Partial<Record<keyof BulkUnwatchResult, unknown>>;
  const num = (v: unknown) => (typeof v === 'number' ? v : 0);
  return {
    unwatched: num(src.unwatched),
    keptManual: num(src.keptManual),
    historicalRemoved: num(src.historicalRemoved),
  };
}

export async function bulkUnwatch(input: BulkUnwatchInput): Promise<BulkUnwatchResult> {
  return normalizeBulkUnwatchResult(
    await apiJson<unknown>(`/api/v1/me/watching/unwatch`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  );
}

// ───────────────────────── Project watchers ─────────────────────────

const projectsBase = (pid: string) =>
  `/api/v1/projects/${encodeURIComponent(pid)}`;

export async function watchProject(pid: string): Promise<void> {
  await apiFetch(`${projectsBase(pid)}/watch`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function unwatchProject(pid: string): Promise<void> {
  await apiFetch(`${projectsBase(pid)}/watch`, { method: 'DELETE' });
}

export async function listProjectWatchers(
  pid: string,
): Promise<WatcherEntry[]> {
  return apiJson<WatcherEntry[]>(`${projectsBase(pid)}/watchers`);
}

/**
 * R3.3 — update the event_types whitelist on the caller's existing
 * project_watchers row. Pass `null` to clear the filter (subscribe to
 * all notifiable types); pass an array to set a strict whitelist.
 *
 * The watcher must already exist (POST /watch first); 404
 * watcher_not_found otherwise.
 */
export async function patchProjectWatchEventTypes(
  pid: string,
  eventTypes: string[] | null,
): Promise<void> {
  await apiFetch(`${projectsBase(pid)}/watch`, {
    method: 'PATCH',
    body: JSON.stringify({ eventTypes }),
  });
}

// ───────────────────────── Helpers ─────────────────────────

/**
 * Effective watch state: a user is "watching" if they appear in the
 * watcher list AND none of their reasons is `unwatched`. The
 * `unwatched` reason is the manual override that suppresses
 * automatically-derived reasons (creator/assignee/commenter/mention).
 *
 * Edge case — `unwatched` WINS regardless of position: a row carrying
 * `reasons: ['manual', 'unwatched']` reads as NOT watching, because the
 * sticky unwatch marker is exactly what keeps auto-watch paths
 * (creator/assignee/commenter/mention) from silently re-subscribing the
 * user. Order inside `reasons[]` is not part of the contract, so the
 * check is a membership test, not a last-element test.
 */
export function isWatching(
  watchers: WatcherEntry[] | undefined,
  userId: string | undefined,
): boolean {
  if (!watchers || !userId) return false;
  const entry = watchers.find((w) => w.userId === userId);
  if (!entry) return false;
  if (entry.reasons.length === 0) return false;
  return !entry.reasons.includes('unwatched');
}
