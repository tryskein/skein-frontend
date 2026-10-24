/**
 * Client for `GET` / `PUT /api/v1/me/issue-create-prefs` — sk-565, contract
 * C-REST (decision D8).
 *
 * One personal setting: whether an issue the caller's own agent creates over
 * MCP without an assignee is assigned to the caller. Wire shape mirrors
 * `notifications.IssueCreatePrefsDTO` in
 * `projects/skein-api/src/internal/notifications/issue_create_prefs.go`; the
 * route itself is `handler/issue_create_prefs.go#PutIssueCreatePrefs`.
 *
 * A contract of its own, not a field of `review-prefs` (D8): review-prefs is
 * the review workflow (switch, schedule), and self-assignment has nothing to
 * do with it. Unlike that client there is no `null` third state, no `bounds`
 * block and no 422 — the only refusal is a body-shape one, 400
 * `invalid_json` (an `ApiError` from `apiJson`), and nothing is written then.
 */
import { apiJson } from './client';

export interface IssueCreatePrefs {
  /**
   * On: an issue the caller's agent creates over MCP (`skein_create`,
   * `skein_epic_create`) without an assignee is assigned to the caller.
   * Standing issues and issues under someone else's parent are excepted;
   * REST creation (the web UI) never reads it. Factory value — `true`,
   * returned also for a user who never saved any personal setting.
   */
  assignAgentIssuesToMe: boolean;
}

/**
 * Partial update body. An absent key is left unchanged, so `{}` writes
 * nothing and answers with the current value. `null` is not a value here —
 * the server refuses it with 400 `invalid_json`, which is why the type does
 * not allow it.
 */
export interface UpdateIssueCreatePrefsInput {
  assignAgentIssuesToMe?: boolean;
}

/** Read the caller's setting. Never creates the server-side row. */
export async function getIssueCreatePrefs(): Promise<IssueCreatePrefs> {
  return apiJson<IssueCreatePrefs>('/api/v1/me/issue-create-prefs', { method: 'GET' });
}

/**
 * Save. Answers with the same payload `GET` returns, so the caller renders
 * the stored value from the authority rather than from its own guess.
 */
export async function updateIssueCreatePrefs(
  input: UpdateIssueCreatePrefsInput,
): Promise<IssueCreatePrefs> {
  return apiJson<IssueCreatePrefs>('/api/v1/me/issue-create-prefs', {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}
