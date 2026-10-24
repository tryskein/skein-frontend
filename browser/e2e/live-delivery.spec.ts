/**
 * sk-622.21 — addressed live delivery on the live stack (spec US-9, US-10,
 * US-11, US-13, US-15, SC-005, SC-007, SC-010, INV-13; test-plan rows
 * No. 94–No. 98).
 *
 * Everything is live: skein-api → outbox → NATS → skein-web (declared
 * projects, personal signal) → SignalR → the tab → re-read → screen. Data is
 * seeded through the real API (`support/liveApi.ts`), each test on a project
 * of its own. Waiting is on an observable sign with a timeout, never a pause.
 *
 *   No. 94 — a row of «All projects» changes live: its project is declared by
 *         the rows the column shows (US-9, R1′), the event reaches the tab.
 *   No. 95 — a user added to a project from another tab sees it in the
 *         projects column without a reload (personal frame `projects`).
 *   No. 96 — an admin tab gets the events of the declared project only, and no
 *         frame carries the text of an issue field (SC-005, SC-010, INV-13).
 *   No. 97 — the Watching badge of a subscriber grows on a comment by someone
 *         else without a reload and before the 60 s safety net (signal path).
 *   No. 98 — a title changed by another session is laid into the project's
 *         task list from the event's row, without a single request of the
 *         task list (US-15, SC-007, phase 2). Its account is its own and in
 *         no shared space, so no other worker's write can re-read the list.
 */

import { expect, test, type Browser, type Page } from '@playwright/test';
import {
  addComment,
  addMember,
  closeIssue,
  createIssue,
  createProject,
  createUser,
  login,
  loginAs,
  mySpaces,
  patchIssue,
  runTag,
  setReasonFeed,
  watchIssue,
  type E2eUser,
} from './support/liveApi';

/** Live event: fractions of a second; 15 s is the cold-stack margin, not polling. */
const LIVE_UPDATE_TIMEOUT_MS = 15_000;

// Desktop width: the projects and tasks columns are full columns, not
// slivers (the app's minimum desktop width is 1284).
test.use({ viewport: { width: 1600, height: 1000 } });

/**
 * The live batcher's coalescing window (`src/lib/liveInvalidationBatcher.ts#LIVE_INVALIDATION_WINDOW_MS`):
 * a re-read an event queues goes out at the latest when it ends.
 */
const LIVE_INVALIDATION_WINDOW_MS = 1_500;

/** A page of the second user, in a browser context of its own. */
async function openAsUser(browser: Browser, user: E2eUser, path: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await loginAs(context.request, user);
  const page = await context.newPage();
  await page.goto(path);
  return page;
}

/** Frames the page's WebSocket received, as text (SignalR JSON protocol). */
function recordReceivedFrames(page: Page): string[] {
  const frames: string[] = [];
  page.on('websocket', (ws) => {
    ws.on('framereceived', (frame) => {
      frames.push(typeof frame.payload === 'string' ? frame.payload : frame.payload.toString('utf8'));
    });
  });
  return frames;
}

/**
 * Distinct ids of the `event` envelopes in the recorded frames that match
 * `pred` (SignalR JSON protocol: messages split by the record separator).
 */
function eventIds(frames: string[], pred: (env: Record<string, unknown>) => boolean): Set<number> {
  const ids = new Set<number>();
  for (const frame of frames) {
    for (const part of frame.split('\u001e')) {
      if (part.trim() === '') continue;
      let msg: { target?: string; arguments?: unknown[] };
      try {
        msg = JSON.parse(part) as { target?: string; arguments?: unknown[] };
      } catch {
        continue;
      }
      const env = msg.arguments?.[0] as Record<string, unknown> | undefined;
      if (msg.target !== 'event' || !env || typeof env.id !== 'number') continue;
      if (pred(env)) ids.add(env.id);
    }
  }
  return ids;
}

test('No. 94: a row of «All projects» closed in another tab changes without navigation or reload', async ({ context }) => {
  test.setTimeout(120_000);
  const api = context.request;
  const tag = runTag();
  await login(api);
  const project = await createProject(api, tag);
  const issue = await createIssue(api, project.id, { title: `All-projects row ${tag}`, type: 'task' });

  // Tab A: no project chosen — the tasks column shows «All projects».
  const tabA = await context.newPage();
  let loads = 0;
  tabA.on('load', () => {
    loads += 1;
  });
  await tabA.goto('/');
  const row = tabA.locator('.col-tasks').getByText(issue.title, { exact: true });
  await expect(row, 'precondition: the row is shown in «All projects»').toHaveCount(1);
  const loadsBefore = loads;

  // Tab B — another tab of the same user — closes the issue.
  await closeIssue(api, project.id, issue);

  // The default status filter shows active issues: the closed one leaves.
  await expect(row, 'the closed issue left the list live').toHaveCount(0, { timeout: LIVE_UPDATE_TIMEOUT_MS });
  expect(loads, 'tab A was not reloaded').toBe(loadsBefore);
});

test('No. 95: a user added to a project from another tab sees it in the projects column without a reload', async ({
  browser,
  context,
}) => {
  test.setTimeout(120_000);
  const api = context.request;
  const tag = runTag();
  await login(api);
  const second = await createUser(api, tag);

  const page = await openAsUser(browser, second, '/');
  await expect(page.locator('.col-projects'), 'precondition: the projects column is shown').toBeVisible();
  let loads = 0;
  page.on('load', () => {
    loads += 1;
  });

  // The admin creates a project and adds the second user to it.
  const project = await createProject(api, tag);
  const projectRow = page.locator('.col-projects').getByText(project.name, { exact: true });
  await expect(projectRow, 'precondition: not a member yet').toHaveCount(0);
  await addMember(api, project.id, second.id);

  await expect(projectRow, 'the project appeared live (personal frame `projects`)').toHaveCount(1, {
    timeout: LIVE_UPDATE_TIMEOUT_MS,
  });
  expect(loads, 'the page was not reloaded').toBe(0);
  await page.context().close();
});

test('No. 96: an admin tab gets only the declared project, and never the text of an issue field', async ({
  browser,
  context,
}) => {
  test.setTimeout(120_000);
  const api = context.request;
  const tag = runTag();
  await login(api);
  const p1 = await createProject(api, `${tag}a`);
  const p2 = await createProject(api, `${tag}b`);
  const x1 = await createIssue(api, p1.id, { title: `Declared ${tag}`, type: 'task' });
  const x2 = await createIssue(api, p2.id, { title: `Undeclared ${tag}`, type: 'task' });

  // The admin's tab: the card of X1 on the route of P1. P2 is shown nowhere.
  const tab = await context.newPage();
  const frames = recordReceivedFrames(tab);
  await tab.goto(`/projects/${p1.idPrefix}/issues/${x1.id}`);
  await expect(tab.getByText(x1.title).first(), 'precondition: the card of X1 is open').toBeVisible();

  // Another session of the admin edits X1 (a unique description) and X2.
  const other = await browser.newContext();
  await login(other.request);
  const secret = `secret-description-${tag}-${Math.random().toString(36).slice(2)}`;
  const x1v2 = await patchIssue(other.request, p1.id, x1, { description: secret });
  await patchIssue(other.request, p2.id, x2, { title: `Undeclared ${tag} renamed` });
  // Delivery barrier: a control write to the DECLARED project after the
  // write to P2. The outbox publishes in event-id order, so once the
  // control's frame is here, the event of X2 has been published before it
  // and its frame, had the hub sent it to this tab, would have come first.
  // A server read of X2 proves only the commit, not the publication.
  await patchIssue(other.request, p1.id, x1v2, { description: `control-${tag}` });

  // Positive control and barrier: both edits of X1 (the description, then
  // the control) reached the tab as event frames.
  const x1Updates = () =>
    eventIds(frames, (env) => env.eventType === 'issue.updated' && env.entityId === x1.id).size;
  await expect
    .poll(x1Updates, {
      message: 'both edits of the declared project reached the tab',
      timeout: LIVE_UPDATE_TIMEOUT_MS,
    })
    .toBeGreaterThanOrEqual(2);

  expect(frames.some((f) => f.includes(secret)), 'no frame carries the description text').toBe(false);
  expect(
    frames.some((f) => f.includes(p2.id) || f.includes(`"${x2.id}"`)),
    'no frame of the undeclared project',
  ).toBe(false);
  await other.close();
});

test('No. 97: the Watching badge of a subscriber grows on a comment by someone else, live and before the safety net', async ({
  browser,
  context,
}) => {
  test.setTimeout(120_000);
  const api = context.request;
  const tag = runTag();
  await login(api);
  const second = await createUser(api, tag);
  const project = await createProject(api, tag);
  await addMember(api, project.id, second.id);
  const issue = await createIssue(api, project.id, { title: `Watched ${tag}`, type: 'task' });

  const page = await openAsUser(browser, second, '/');
  // The badge counts the subscriber's unread feed notifications with a card
  // (spec US-5), and the «Comment» reason's feed is off by default
  // (`skein-api internal/notifications/reasons.go#ReasonKeyComment`,
  // DefaultOn: false) — without this a comment writes no notification and
  // there is nothing for the badge to count, signal or not. Switching it on
  // is the second user's own setting, before anything is watched.
  await setReasonFeed(page.context().request, 'comment', true);
  await watchIssue(page.context().request, issue.id);
  // Subscribing is the second user's own act; reload once so the badge
  // starts from the server's number, then everything else is live.
  await page.reload();
  const badge = page.locator('[aria-label^="Watching "]').first();
  await expect(badge, 'precondition: the Watching badge is shown').toBeVisible();
  const count = async () => Number(/(\d+)$/.exec((await badge.getAttribute('aria-label')) ?? '')?.[1] ?? NaN);
  const before = await count();
  let loads = 0;
  page.on('load', () => {
    loads += 1;
  });

  await addComment(api, project.id, issue.id, `ping ${tag}`);

  // 15 s, against a 60 s safety net: green here is the signal's doing.
  await expect.poll(count, { message: 'the badge grew live', timeout: LIVE_UPDATE_TIMEOUT_MS }).toBeGreaterThan(before);
  expect(loads, 'the page was not reloaded').toBe(0);
  await page.context().close();
});

test('No. 98: a title changed by another session is laid into the project list without a single list request', async ({
  browser,
  context,
}) => {
  test.setTimeout(120_000);
  const api = context.request;
  const tag = runTag();
  await login(api);
  // The test claims that NOTHING reads the task list while the event is laid
  // in, so the tab must belong to an account nobody else acts on. The admin
  // is shared by every Playwright worker, and so is the stack's shared space:
  // a project another worker creates there reaches the tab as the personal
  // signal `projects`, which re-reads every task list of the tab
  // (`src/lib/accessLoss.ts#resetAfterAccessLoss`). An account in no shared
  // space, working in its own "Personal", hears only its own writes.
  const owner = await createUser(api, tag, { spaceIds: [] });
  await loginAs(api, owner);
  const personal = (await mySpaces(api)).items.find((sp) => sp.kind === 'personal');
  expect(personal, 'precondition: the account has its own "Personal"').toBeTruthy();
  const project = await createProject(api, tag, { spaceId: personal!.id });
  const issue = await createIssue(api, project.id, { title: `Row before ${tag}`, type: 'task' });

  // Tab A: the project's task list.
  const tabA = await context.newPage();
  await tabA.goto(`/projects/${project.idPrefix}`);
  const tasks = tabA.locator('.col-tasks');
  await expect(tasks.getByText(issue.title, { exact: true }), 'precondition: the row is shown').toHaveCount(1);

  // From here on: every read of a task list of the project (`GET
  // /api/v1/projects/{project}/issues`, `src/api/issues.ts#listIssues`).
  const listRequests: string[] = [];
  tabA.on('request', (req) => {
    if (req.method() !== 'GET') return;
    if (/^\/api\/v1\/projects\/[^/]+\/issues$/.test(new URL(req.url()).pathname)) listRequests.push(req.url());
  });

  // Another session of the same user renames the issue.
  const other = await browser.newContext();
  await loginAs(other.request, owner);
  const renamed = `Row after ${tag}`;
  await patchIssue(other.request, project.id, issue, { title: renamed });

  await expect(tasks.getByText(renamed, { exact: true }), 'the row shows the new title live').toHaveCount(1, {
    timeout: LIVE_UPDATE_TIMEOUT_MS,
  });
  await expect(tasks.getByText(issue.title, { exact: true }), 'the old title is gone').toHaveCount(0);
  // Absence is observed over one whole batch window after the row changed:
  // a re-read the event had queued would have gone out by its end.
  await tabA.waitForTimeout(LIVE_INVALIDATION_WINDOW_MS + 500);
  expect(listRequests, 'tab A sent no request of the task list').toEqual([]);
  await other.close();
});
