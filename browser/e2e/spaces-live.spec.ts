/**
 * sk-674.18 — spaces, live (rows 255–259; SC-019, SC-015, SC-005,
 * US-5, US-19, E-23, INV-23).
 *
 * Everything is live: skein-api → outbox → NATS → skein-web (the personal
 * signal `spaces`, the access control event, the declared projects) →
 * SignalR → the tab. Data is seeded through the real API
 * (`support/liveApi.ts`), each test with spaces, projects and a user of its
 * own. Waiting is on an observable sign with a timeout, never a pause —
 * except where the row asks for an observed ABSENCE over a bounded window,
 * and then the window is named and bounded.
 *
 * The stack runs with the defaults of skein-api: the common space on, the
 * instance admin on, anyone may create spaces, no seat limit (so the
 * space's counter is «Members (N)»), mail and registration off (accepting
 * from Inbox needs no confirmed email). The browser speaks English (no
 * stored language).
 *
 *   255 — an invitation reaches the addressee's open tab: the card and the
 *         Inbox badge, without a reload.
 *   256 — the addressee accepts in their tab; the owner's open space
 *         settings show the new member and count, without a reload.
 *   257 — a member removed from a space: the tab on the space page goes to
 *         `/` with a toast; an edit of an issue of that space then reaches
 *         the tab by no frame over the observed window (positive control
 *         before the removal). Which mechanism removed the hub groups — the
 *         access event or the periodic recheck — is not this test's claim:
 *         the event path is covered by skein-web's unit tests
 *         (AccessControlSubscriberTests); the recheck period is not
 *         configurable and is not given a test setting (lead's decision).
 *   258 — a project switched `space → members`: a tab on its issue goes to
 *         `/` with a toast, a tab on the space page stays there.
 *   259 — the admin's «All projects» tab gets frames of a non-personal
 *         project they are not in (positive control) and no frame of
 *         another user's personal project, edited after the control.
 */

import { expect, test, type Browser, type Page } from '@playwright/test';
import {
  addSpaceMember,
  createIssue,
  createProject,
  createSpace,
  createUser,
  inviteToSpace,
  login,
  loginAs,
  mySpaces,
  patchIssue,
  removeSpaceMember,
  runTag,
  setProjectVisibility,
  type E2eUser,
} from './support/liveApi';
import { framesNaming, hubAnswered, issueEvents, recordReceivedFrames } from './support/frames';

/** Live event: fractions of a second; 15 s is the cold-stack margin, not polling. */
const LIVE_UPDATE_TIMEOUT_MS = 15_000;

/** Row 257's observation window after the removal, continuously recorded. */
const ABSENCE_WINDOW_MS = 20_000;
/** Row 259's extra observation after the delivery barrier. */
const AFTER_BARRIER_MS = 3_000;

test.use({ viewport: { width: 1600, height: 1000 } });

/** A page of `user`, in a browser context of its own (own cookie, own hub connection). */
async function openAsUser(browser: Browser, user: E2eUser, path: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await loginAs(context.request, user);
  const page = await context.newPage();
  const frames = recordReceivedFrames(page);
  await page.goto(path);
  await waitForHub(frames);
  return page;
}

/** Wait until the hub has answered the tab's subscription (see `hubAnswered`). */
async function waitForHub(frames: string[]): Promise<void> {
  await expect
    .poll(() => hubAnswered(frames), { message: 'precondition: the tab is subscribed on the hub', timeout: LIVE_UPDATE_TIMEOUT_MS })
    .toBe(true);
}

/** Count the page's reloads from now on. */
function countLoads(page: Page): () => number {
  let loads = 0;
  page.on('load', () => {
    loads += 1;
  });
  return () => loads;
}

/** The number of the Inbox badge (its accessible name is «Inbox N», `HeaderBar.tsx#QueueBadge`). */
async function inboxCount(page: Page): Promise<number> {
  const label = await page.getByRole('link', { name: /^Inbox \d+$/ }).first().getAttribute('aria-label');
  return Number(/(\d+)$/.exec(label ?? '')?.[1] ?? NaN);
}

const pathOf = (page: Page) => () => new URL(page.url()).pathname;

test('255: an invitation reaches the addressee’s open tab — card and Inbox badge, no reload', async ({
  browser,
  context,
}) => {
  test.setTimeout(120_000);
  const api = context.request;
  const tag = runTag();
  await login(api);
  const user = await createUser(api, tag);
  const space = await createSpace(api, `Acme ${tag}`);

  const tab = await openAsUser(browser, user, '/');
  const badge = tab.getByRole('link', { name: /^Inbox \d+$/ }).first();
  await expect(badge, 'precondition: the Inbox badge is shown').toBeVisible();
  const before = await inboxCount(tab);
  const card = tab.getByRole('button', { name: `Accept the invitation to ${space.name}` });
  await expect(card, 'precondition: no card yet').toHaveCount(0);
  const loads = countLoads(tab);

  await inviteToSpace(api, space.id, user.id);

  await expect(card, 'the invitation card appeared live').toHaveCount(1, { timeout: LIVE_UPDATE_TIMEOUT_MS });
  await expect
    .poll(() => inboxCount(tab), { message: 'the Inbox badge grew live', timeout: LIVE_UPDATE_TIMEOUT_MS })
    .toBe(before + 1);
  expect(loads(), 'the tab was not reloaded').toBe(0);
  await tab.context().close();
});

test('256: accepted in the addressee’s tab — the owner’s open settings show the member and the count, no reload', async ({
  browser,
  context,
}) => {
  test.setTimeout(120_000);
  const api = context.request;
  const tag = runTag();
  await login(api);
  const user = await createUser(api, tag);
  const space = await createSpace(api, `Acme ${tag}`);
  await inviteToSpace(api, space.id, user.id);

  // Tab A: the owner (the stack admin, who created the space) on its settings.
  const owner = await context.newPage();
  await owner.goto(`/settings/spaces/${space.id}`);
  await expect(owner.getByText('Members (1)', { exact: true }), 'precondition: the owner alone').toBeVisible();
  await expect(owner.getByRole('cell', { name: user.username, exact: true })).toHaveCount(0);
  const ownerLoads = countLoads(owner);

  // Tab B: the addressee accepts from the card.
  const tab = await openAsUser(browser, user, '/');
  const accept = tab.getByRole('button', { name: `Accept the invitation to ${space.name}` });
  await expect(accept, 'precondition: the card is there').toHaveCount(1, { timeout: LIVE_UPDATE_TIMEOUT_MS });
  await accept.click();

  await expect(owner.getByText('Members (2)', { exact: true }), 'the count changed live (`accepted`)').toBeVisible({
    timeout: LIVE_UPDATE_TIMEOUT_MS,
  });
  await expect(owner.getByRole('cell', { name: user.username, exact: true }), 'the member is listed').toHaveCount(1);
  expect(ownerLoads(), 'the owner’s tab was not reloaded').toBe(0);
  await tab.context().close();
});

test('257: a member removed from a space — the tab leaves the space page with a toast, and frames of the space stop', async ({
  browser,
  context,
}) => {
  test.setTimeout(180_000);
  const api = context.request;
  const tag = runTag();
  await login(api);
  const user = await createUser(api, tag);
  const space = await createSpace(api, `Acme ${tag}`);
  await addSpaceMember(api, space.id, user.id);
  const project = await createProject(api, `${tag}a`, { spaceId: space.id, visibility: 'space' });
  let issue = await createIssue(api, project.id, { title: `In the space ${tag}`, type: 'task' });
  // The barrier's project: the common space, still the user's after the removal.
  const control = await createProject(api, `${tag}c`, { visibility: 'space' });
  let controlIssue = await createIssue(api, control.id, { title: `Common ${tag}`, type: 'task' });

  const context2 = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await loginAs(context2.request, user);
  const tab = await context2.newPage();
  const frames = recordReceivedFrames(tab);
  await tab.goto(`/spaces/${space.id}-${space.slug}`);
  await expect(tab.getByText(issue.title, { exact: true }).first(), 'precondition: the space page lists the issue').toBeVisible();
  await waitForHub(frames);

  // Positive control: an edit of the space's issue reaches the tab as a frame.
  issue = await patchIssue(api, project.id, issue, { title: `${issue.title} v2` });
  await expect
    .poll(() => issueEvents(frames, issue.id).length, {
      message: 'positive control: the space’s issue reaches the tab before the removal',
      timeout: LIVE_UPDATE_TIMEOUT_MS,
    })
    .toBeGreaterThan(0);

  const removedAt = Date.now();
  await removeSpaceMember(api, space.id, user.id);
  await expect.poll(pathOf(tab), { message: 'the tab left the space page', timeout: LIVE_UPDATE_TIMEOUT_MS }).toBe('/');
  await expect(tab.getByText(`You are no longer a member of ${space.name}`), 'the toast says why').toBeVisible();

  // From here on: no frame of the lost space's issue.
  const mark = frames.length;
  issue = await patchIssue(api, project.id, issue, { title: `${issue.title} v3` });
  // Delivery barrier: a later write to a project the tab still sees. The
  // outbox publishes in event order — once this frame is here, the frame of
  // the edit above would have come before it.
  controlIssue = await patchIssue(api, control.id, controlIssue, { title: `${controlIssue.title} v2` });
  await expect
    .poll(() => issueEvents(frames, controlIssue.id, mark).length, {
      message: 'the barrier reached the tab',
      timeout: LIVE_UPDATE_TIMEOUT_MS,
    })
    .toBeGreaterThan(0);
  // Then the rest of the window, continuously recorded.
  const left = ABSENCE_WINDOW_MS - (Date.now() - removedAt);
  if (left > 0) await tab.waitForTimeout(left);
  expect(issueEvents(frames, issue.id, mark), 'no frame of the lost space’s issue').toEqual([]);
  await context2.close();
});

test('258: a project switched space → members — a tab on its issue leaves with a toast, a tab on the space page stays', async ({
  browser,
  context,
}) => {
  test.setTimeout(120_000);
  const api = context.request;
  const tag = runTag();
  await login(api);
  const user = await createUser(api, tag);
  const space = await createSpace(api, `Acme ${tag}`);
  await addSpaceMember(api, space.id, user.id);
  const project = await createProject(api, `${tag}a`, { spaceId: space.id, visibility: 'space' });
  const issue = await createIssue(api, project.id, { title: `Members only soon ${tag}`, type: 'task' });

  const onIssue = await openAsUser(browser, user, `/projects/${project.idPrefix}/issues/${issue.id}`);
  await expect(onIssue.getByText(issue.title).first(), 'precondition: the issue is open').toBeVisible();
  const spacePage = await onIssue.context().newPage();
  const spacePath = `/spaces/${space.id}-${space.slug}`;
  await spacePage.goto(spacePath);
  await expect(spacePage.getByText(issue.title, { exact: true }).first(), 'precondition: the space page lists it').toBeVisible();

  await setProjectVisibility(api, project.id, 'members');

  await expect.poll(pathOf(onIssue), { message: 'the issue tab left', timeout: LIVE_UPDATE_TIMEOUT_MS }).toBe('/');
  await expect(onIssue.getByText('The project is no longer available'), 'the toast says why').toBeVisible();
  // The space page lost a project, not the space: it stays, the issue goes.
  await expect(spacePage.getByText(issue.title, { exact: true }), 'the lost project’s issue left the list').toHaveCount(0, {
    timeout: LIVE_UPDATE_TIMEOUT_MS,
  });
  expect(new URL(spacePage.url()).pathname, 'the space page stayed').toBe(spacePath);
  await onIssue.context().close();
});

test('259: the admin’s «All projects» gets a non-personal project they are not in, and nothing of another user’s personal space', async ({
  browser,
  context,
}) => {
  test.setTimeout(120_000);
  const api = context.request;
  const tag = runTag();
  await login(api);
  const user = await createUser(api, tag);
  const userContext = await browser.newContext();
  await loginAs(userContext.request, user);
  const uapi = userContext.request;

  // The user's own space (the admin is not in it) and the user's "Personal".
  const space = await createSpace(uapi, `Owned ${tag}`);
  const shared = await createProject(uapi, `${tag}s`, { spaceId: space.id, visibility: 'space' });
  let sharedIssue = await createIssue(uapi, shared.id, { title: `Shared ${tag}`, type: 'task' });
  const personalSpace = (await mySpaces(uapi)).items.find((sp) => sp.kind === 'personal');
  expect(personalSpace, 'precondition: the user has a personal space').toBeTruthy();
  const personal = await createProject(uapi, `${tag}p`, { spaceId: personalSpace!.id });
  let personalIssue = await createIssue(uapi, personal.id, { title: `Personal ${tag}`, type: 'task' });

  // The admin's tab on «All projects».
  const tab = await context.newPage();
  const frames = recordReceivedFrames(tab);
  await tab.goto('/');
  await expect(tab.locator('.col-tasks').getByText(sharedIssue.title, { exact: true }), 'precondition: the admin sees the shared project').toHaveCount(1, {
    timeout: LIVE_UPDATE_TIMEOUT_MS,
  });

  // Positive control: an edit in the non-personal project reaches the admin.
  sharedIssue = await patchIssue(uapi, shared.id, sharedIssue, { title: `${sharedIssue.title} v2` });
  await expect
    .poll(() => issueEvents(frames, sharedIssue.id).length, {
      message: 'positive control: the non-personal project reaches the admin',
      timeout: LIVE_UPDATE_TIMEOUT_MS,
    })
    .toBeGreaterThan(0);

  // After the control: an edit in the user's "Personal", then a barrier.
  const mark = frames.length;
  personalIssue = await patchIssue(uapi, personal.id, personalIssue, { title: `${personalIssue.title} v2` });
  sharedIssue = await patchIssue(uapi, shared.id, sharedIssue, { title: `${sharedIssue.title} v3` });
  await expect
    .poll(() => issueEvents(frames, sharedIssue.id, mark).length, {
      message: 'the barrier reached the admin',
      timeout: LIVE_UPDATE_TIMEOUT_MS,
    })
    .toBeGreaterThan(0);
  await tab.waitForTimeout(AFTER_BARRIER_MS);

  // Not a single frame of the personal project, over the whole recording.
  expect(framesNaming(frames, personal.id), 'no frame names the personal project').toEqual([]);
  expect(framesNaming(frames, personalIssue.id), 'no frame names its issue').toEqual([]);
  expect(framesNaming(frames, personalIssue.title), 'no frame carries its title').toEqual([]);
  await userContext.close();
});
