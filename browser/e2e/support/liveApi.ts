/**
 * sk-442 — e2e data seeding through the REAL API of the live stack.
 *
 * Requests go the same way as the app's: nginx skein-frontend →
 * skein-web (cookie session `skein.sid`, proxy `/api/v1/*`) → skein-api.
 * `APIRequestContext` is taken from the browser context (`context.request`),
 * so the login cookie is shared by both the seeding and the test tabs — as with one
 * user in two tabs.
 *
 * The account is the first administrator that skein-api seeds at
 * startup from `SKEIN_INITIAL_ADMIN_*` (`docker-compose.e2e.yml` of the umbrella). The password is a dev value of the test stack, not a secret.
 *
 * Every run creates ITS OWN project with a unique prefix: tests do not
 * depend on order or on other people's data, and a repeated run on the same
 * stack does not meet the tasks of the previous one.
 *
 * Paths and body shapes are the same as the product client's (`src/api/*.ts`: login
 * `loginApi`, project `createProject`, issue `createIssue`, link
 * `addDependency`); response types come from there too, so a divergence from
 * the contract goes red in `tsc`.
 */

import { expect, type APIRequestContext, type APIResponse } from '@playwright/test';
import type { IssueDetail, IssueType } from '../../../src/api/issues';
import type { Project } from '../../../src/api/projects';
import type { DepType } from '../../../src/api/dependencies';
import type { User } from '../../../src/api/users';
import type {
  CreateSpaceResponse,
  MySpacesResponse,
  ProjectVisibility,
  SpaceRef,
} from '../../../src/api/spaces';
import type { CreateInvitationResponse } from '../../../src/api/invitations';

export const ADMIN = { email: 'admin@test.com', password: 'qwerty12' } as const;

/** Unique run label: time + random tail, `[a-z0-9]`. */
export function runTag(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * sk-674.18, contract K-7: membership and space operations (creating
 * a user — it joins the shared space —, a project, a member,
 * an invitation, a visibility change) run SERIALIZABLE under a lock on the space
 * row and are retried by the server three times
 * (`internal/spaces/membership.go#WithRetry`); having lost all three, the server
 * rolls the whole transaction back and answers 422 `concurrent_change` —
 * "nothing changed, retry". Playwright workers (`fullyParallel`)
 * seed into ONE shared space of the stack at the same time, so this
 * refusal is a normal answer, and the seeding honours the contract: it retries the request.
 * Only that one is retried; any other refusal goes red at once.
 */
const CONCURRENT_CHANGE_ATTEMPTS = 8;
/** Pause before a retry: random, grows with the attempt number — workers spread apart. */
const CONCURRENT_CHANGE_PAUSE_MS = 250;

/** Business refusal code from the body `{"error": "..."}`; a non-JSON body has no code. */
function errorCode(body: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed === 'object' && parsed !== null && 'error' in parsed && typeof parsed.error === 'string') {
      return parsed.error;
    }
  } catch {
    // Not JSON (a proxy page, an empty body) — this is not `concurrent_change`.
  }
  return undefined;
}

/**
 * The only place where the seeding sends a request: success is returned, 422
 * `concurrent_change` is retried (see `CONCURRENT_CHANGE_ATTEMPTS`), anything
 * else and running out of attempts go red.
 */
async function send(request: () => Promise<APIResponse>, what: string): Promise<APIResponse> {
  for (let attempt = 1; ; attempt += 1) {
    const res = await request();
    const body = await res.text();
    const retry =
      !res.ok() &&
      attempt < CONCURRENT_CHANGE_ATTEMPTS &&
      res.status() === 422 &&
      errorCode(body) === 'concurrent_change';
    if (!retry) {
      // Status and body go in the message: on a live stack the reason for a refusal is only there.
      expect(res.ok(), `${what}: HTTP ${res.status()} ${body} (attempt ${attempt})`).toBe(true);
      return res;
    }
    await new Promise((resolve) => setTimeout(resolve, Math.random() * CONCURRENT_CHANGE_PAUSE_MS * attempt));
  }
}

async function json<T>(request: () => Promise<APIResponse>, what: string): Promise<T> {
  return (await (await send(request, what)).json()) as T;
}

export async function login(api: APIRequestContext): Promise<void> {
  await json(() => api.post('/api/auth/login', { data: ADMIN }), 'login as the stack admin');
}

/** "My spaces" of the `api` owner (`src/api/spaces.ts#getMySpaces`). */
export async function mySpaces(api: APIRequestContext): Promise<MySpacesResponse> {
  return json<MySpacesResponse>(() => api.get('/api/v1/me/spaces'), 'my spaces');
}

/**
 * The run's project (`src/api/projects.ts#createProject`).
 *
 * sk-674.18, maintenance row O-f4: for a person with a "Personal" and a shared
 * space `POST /projects` without `spaceId` is ambiguous and answers 422
 * `space_required` (contract T013, "Choosing the space of a new project").
 * So without an explicit `spaceId` the project goes into the stack's shared space from
 * `GET /me/spaces`; if there is no shared one and there is a single space — the request goes without `spaceId`,
 * as before spaces (the server will pick the only one).
 */
export async function createProject(
  api: APIRequestContext,
  tag: string,
  opts: { spaceId?: string; visibility?: ProjectVisibility } = {},
): Promise<Project> {
  let spaceId = opts.spaceId;
  if (spaceId === undefined) {
    const spaces = await mySpaces(api);
    spaceId = spaces.items.find((sp) => sp.kind === 'common')?.id;
  }
  return json<Project>(
    () => api.post('/api/v1/projects', {
      data: {
        name: `e2e ${tag}`,
        idPrefix: `e2e${tag}`,
        ...(spaceId !== undefined ? { spaceId } : {}),
        ...(opts.visibility !== undefined ? { visibility: opts.visibility } : {}),
      },
    }),
    'create project',
  );
}

export async function createIssue(
  api: APIRequestContext,
  projectId: string,
  input: { title: string; type: IssueType; parentId?: string },
): Promise<IssueDetail> {
  return json<IssueDetail>(
    () => api.post(`/api/v1/projects/${encodeURIComponent(projectId)}/issues`, { data: input }),
    `create ${input.type} "${input.title}"`,
  );
}

/** A `from → to` link of type `type` (for `blocks`: `from` is blocked by task `to`). */
export async function addDependency(
  api: APIRequestContext,
  projectId: string,
  fromId: string,
  toId: string,
  type: DepType,
): Promise<void> {
  await json(
    () => api.post(
      `/api/v1/projects/${encodeURIComponent(projectId)}/issues/${encodeURIComponent(fromId)}/dependencies`,
      { data: { toId, type } },
    ),
    `dependency ${fromId} -${type}-> ${toId}`,
  );
}

/** The issue card — to check that the server really recorded it. */
export async function getIssue(
  api: APIRequestContext,
  projectId: string,
  id: string,
): Promise<IssueDetail> {
  return json<IssueDetail>(
    () => api.get(`/api/v1/projects/${encodeURIComponent(projectId)}/issues/${encodeURIComponent(id)}`),
    `get ${id}`,
  );
}

// ─────────────── sk-622.21 No. 95, No. 97 — a second user and personal delivery ───────────────
//
// The second user is created by the admin through `POST /api/v1/users` (the same
// path as `src/api/users.ts#createUser`) and logs in in ITS OWN browser
// context (`browser.newContext()`): its own cookie session, its own SignalR
// connections — the personal signal is addressed to it, not to the admin.

/** Password of the accounts created by the run: a dev value of the test stack, not a secret. */
export const E2E_USER_PASSWORD = 'e2e-Live-Delivery-9!';

export interface E2eUser {
  id: string;
  email: string;
  username: string;
}

/**
 * Create a regular user with the run's unique email and username.
 *
 * `spaceIds` are the spaces the account joins at once
 * (`POST /api/v1/users` `spaceIds`): omitted — the stack's shared space, as
 * an admin-created account gets by default; `[]` — none, only its own
 * "Personal". An account in no shared space receives no personal signal
 * caused by what the other Playwright workers do in the shared space at the
 * same time (a project created there with visibility `space` re-reads the
 * task lists of every member's tab, `src/lib/accessLoss.ts`).
 */
export async function createUser(
  api: APIRequestContext,
  tag: string,
  opts: { spaceIds?: string[] } = {},
): Promise<E2eUser> {
  const user = await json<User>(
    () => api.post('/api/v1/users', {
      data: {
        email: `e2e-${tag}@test.com`,
        username: `e2e${tag}`,
        name: `E2E ${tag}`,
        password: E2E_USER_PASSWORD,
        role: 'user',
        ...(opts.spaceIds !== undefined ? { spaceIds: opts.spaceIds } : {}),
      },
    }),
    'create the second user',
  );
  return { id: user.id, email: user.email, username: user.username };
}

/** Log in as `user` in the `api` context (this context's cookie). */
export async function loginAs(api: APIRequestContext, user: E2eUser): Promise<void> {
  await json(
    () => api.post('/api/auth/login', { data: { email: user.email, password: E2E_USER_PASSWORD } }),
    `login as ${user.username}`,
  );
}

/** Add a user to a project (`src/api/projects.ts#upsertMember`). */
export async function addMember(
  api: APIRequestContext,
  projectId: string,
  userId: string,
  role: 'member' | 'owner' = 'member',
): Promise<void> {
  await json(
    () => api.put(
      `/api/v1/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(userId)}`,
      { data: { role } },
    ),
    `add ${userId} to ${projectId}`,
  );
}

/** Subscribe to an issue (`src/api/watchers.ts#watchIssue`) — on behalf of the `api` owner. */
export async function watchIssue(api: APIRequestContext, issueId: string): Promise<void> {
  await send(() => api.post(`/api/v1/issues/${encodeURIComponent(issueId)}/watch`), `watch ${issueId}`);
}

/**
 * Turn on or off the feed channel of one notification reason
 * (`src/api/notification-reasons.ts#updateReasonPrefs`) — on behalf of the `api`
 * owner. The server's answer is a fresh view of the settings; it is what is used to check that the
 * channel really took the needed position.
 */
export async function setReasonFeed(api: APIRequestContext, reason: string, enabled: boolean): Promise<void> {
  const prefs = await json<{ reasons: { key: string; feed: { enabled: boolean } }[] }>(
    () => api.put('/api/v1/me/notification-reasons', { data: { reasons: [{ reason, feed: enabled }] } }),
    `set the feed of reason ${reason} to ${enabled}`,
  );
  const row = prefs.reasons.find((r) => r.key === reason);
  expect(row?.feed.enabled, `the feed of reason ${reason} is ${enabled}`).toBe(enabled);
}

/** A comment on an issue (`src/api/issues.ts#addComment`). */
export async function addComment(
  api: APIRequestContext,
  projectId: string,
  issueId: string,
  body: string,
): Promise<void> {
  await json(
    () => api.post(
      `/api/v1/projects/${encodeURIComponent(projectId)}/issues/${encodeURIComponent(issueId)}/comments`,
      { data: { body } },
    ),
    `comment on ${issueId}`,
  );
}

/** Editing issue fields (`src/api/issues.ts#patchIssue`, If-Match by version). */
export async function patchIssue(
  api: APIRequestContext,
  projectId: string,
  issue: Pick<IssueDetail, 'id' | 'version'>,
  patch: Record<string, unknown>,
): Promise<IssueDetail> {
  return json<IssueDetail>(
    () => api.patch(
      `/api/v1/projects/${encodeURIComponent(projectId)}/issues/${encodeURIComponent(issue.id)}`,
      { data: patch, headers: { 'If-Match': String(issue.version) } },
    ),
    `patch ${issue.id}`,
  );
}

/** Close an issue by a status transition (`src/api/issues.ts#transitionStatus`). */
export async function closeIssue(
  api: APIRequestContext,
  projectId: string,
  issue: Pick<IssueDetail, 'id' | 'version'>,
): Promise<IssueDetail> {
  return json<IssueDetail>(
    () => api.post(
      `/api/v1/projects/${encodeURIComponent(projectId)}/issues/${encodeURIComponent(issue.id)}/transitions`,
      { data: { status: 'closed' }, headers: { 'If-Match': String(issue.version) } },
    ),
    `close ${issue.id}`,
  );
}

// ─────────────── sk-674.18 — spaces (rows 255–259) ───────────────
//
// Paths and bodies are the same as the product client's (`src/api/spaces.ts`,
// `src/api/invitations.ts`, `src/api/projects.ts#patchProject`).

/** A regular space; the owner is the one on whose behalf `api` acts (`createSpace`). */
export async function createSpace(api: APIRequestContext, name: string): Promise<SpaceRef> {
  const res = await json<CreateSpaceResponse>(
    () => api.post('/api/v1/spaces', { data: { name } }),
    `create space ${name}`,
  );
  return { id: res.id, slug: res.slug, name };
}

/** Invite a user by id (`createInvitation`); the answer is `sent`. */
export async function inviteToSpace(api: APIRequestContext, spaceId: string, userId: string): Promise<void> {
  const res = await json<CreateInvitationResponse>(
    () => api.post(`/api/v1/spaces/${encodeURIComponent(spaceId)}/invitations`, {
      data: { userId, language: 'en' },
    }),
    `invite ${userId} to ${spaceId}`,
  );
  expect(res.outcome, `the invitation of ${userId} was sent`).toBe('sent');
}

/** The admin adds a member at once, without consent (`addSpaceMember`). */
export async function addSpaceMember(api: APIRequestContext, spaceId: string, userId: string): Promise<void> {
  await json(
    () => api.post(`/api/v1/spaces/${encodeURIComponent(spaceId)}/members`, { data: { userId } }),
    `add ${userId} to space ${spaceId}`,
  );
}

/** Remove a member (`removeSpaceMember`). */
export async function removeSpaceMember(api: APIRequestContext, spaceId: string, userId: string): Promise<void> {
  await send(
    () => api.delete(`/api/v1/spaces/${encodeURIComponent(spaceId)}/members/${encodeURIComponent(userId)}`),
    `remove ${userId} from ${spaceId}`,
  );
}

/** Change the project visibility (`patchProject`); `space → members` takes access away (INV-12). */
export async function setProjectVisibility(
  api: APIRequestContext,
  projectId: string,
  visibility: ProjectVisibility,
): Promise<Project> {
  return json<Project>(
    () => api.patch(`/api/v1/projects/${encodeURIComponent(projectId)}`, { data: { visibility } }),
    `set ${projectId} visibility to ${visibility}`,
  );
}

/** Deactivate a user (`src/api/users.ts#deactivateUser`) — on behalf of the admin `api`. */
export async function deactivateUser(api: APIRequestContext, userId: string): Promise<void> {
  await send(() => api.post(`/api/v1/users/${encodeURIComponent(userId)}/deactivate`), `deactivate ${userId}`);
}
