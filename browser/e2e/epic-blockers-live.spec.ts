/**
 * sk-442 — the first e2e-level scenario: US-5 B8 ("US-5 — Live update", acceptance "The only visible blocker is closed →
 * the blocked marker and the sub-line disappear"; SC-008).
 *
 * Until this level the chain was covered link by link — rows 23, 30, 31
 * of the test matrix: the server writes the event (23),
 * the live event covers the tree key (30), the section is refetched (31, with
 * a mocked `fetchIssueTree`) — and the end-to-end "in another tab" pass was
 * a manual STOP & VALIDATE item. Here it is automatic and LIVE END TO END:
 * skein-api → outbox → NATS → skein-web (SignalR) → browser → section
 * refetch → screen. No mocks at all.
 *
 * Scenario:
 *   1. Seeding through the real API (`support/liveApi.ts`): a project of
 *      its own per run; epic E, child C, blocker B; a `blocks` link C→B (C
 *      is blocked by task B).
 *   2. Tab A opens the card of E: the row of C has a blockers sub-line with B
 *      and a highlighted status (`.is-blocked`). This is the precondition: without it
 *      "gone" would prove nothing.
 *   3. Tab B (a second page of the same context — the same user in
 *      another tab) closes B THROUGH THE UI of card B: status →
 *      "closed" → confirmation. This is how US-5 is worded — "you close
 *      the blocker in another tab" — and the event is born by the same path as
 *      for a user. That the server really closed B is checked
 *      separately, through the API: otherwise a red tab A could not be told apart from
 *      a close that did not happen.
 *   4. Tab A, WITHOUT navigation or reload: the blockers sub-line of C and
 *      the status highlight disappear. The wait is on an observable sign with
 *      a timeout, not a pause. "Without reopening" is proven by a marker in `window`
 *      set before step 3: a reload or a new document navigation would have
 *      erased it; plus tab A received no `load` event.
 *
 * sk-622.21 (test-plan row No. 93; US-9, US-13, T041, T042, T032, T033) —
 * after addressed delivery a project event reaches only the tab that
 * declared that project. Tab A opens the epic card by an address WITHOUT
 * a project (`/issues/:id`): the project is declared by the open card (and the rows of
 * the lists shown), not by the route. That the tab really declared the
 * project is read from the WebSocket frames it sent (a hub call
 * `DeclareProjects` with the project id); that the compact envelope refetched the section is
 * step 4, as before.
 */

import { expect, test, type Locator, type Page } from '@playwright/test';
import { addDependency, createIssue, createProject, getIssue, login, runTag } from './support/liveApi';

/** A live event arrives within fractions of a second; 15 s is headroom for a cold CI stack, not for polling. */
const LIVE_UPDATE_TIMEOUT_MS = 15_000;

/** A child row in the epic section — by the child's title (the title is unique per run). */
function childRow(page: Page, title: string): Locator {
  return page.locator('li, [role="treeitem"]').filter({
    has: page.locator('.epic-child-title').getByText(title, { exact: true }),
  });
}

test('US-5: a blocker closed in another tab disappears from the epic section sub-line without reopening', async ({
  context,
}) => {
  test.setTimeout(120_000);
  const api = context.request;
  const tag = runTag();

  // ── 1. seeding ──────────────────────────────────────────────────
  await login(api);
  const project = await createProject(api, tag);
  const epic = await createIssue(api, project.id, { title: `Epic ${tag}`, type: 'epic' });
  const child = await createIssue(api, project.id, {
    title: `Child ${tag}`,
    type: 'task',
    parentId: epic.id,
  });
  const blocker = await createIssue(api, project.id, { title: `Blocker ${tag}`, type: 'task' });
  await addDependency(api, project.id, child.id, blocker.id, 'blocks');

  // ── 2. tab A: epic card, C blocked by B ─────────────────────────
  const tabA = await context.newPage();
  let loadsA = 0;
  tabA.on('load', () => {
    loadsA += 1;
  });
  // Frames sent by tab A to the hub (SignalR JSON protocol — text).
  const sentA: string[] = [];
  tabA.on('websocket', (ws) => {
    ws.on('framesent', (frame) => {
      sentA.push(typeof frame.payload === 'string' ? frame.payload : frame.payload.toString('utf8'));
    });
  });
  await tabA.goto(`/issues/${epic.id}`);
  const row = childRow(tabA, child.title);
  await expect(row).toHaveCount(1);
  const blockersLine = row.locator('.epic-child-blockers');
  await expect(blockersLine, 'precondition: blockers sub-line of C').toBeVisible();
  await expect(blockersLine).toContainText(blocker.id);
  await expect(row.locator('.epic-child-status.is-blocked'), 'precondition: status of C is highlighted').toBeVisible();

  await expect
    .poll(() => sentA.some((f) => f.includes('"DeclareProjects"') && f.includes(project.id)), {
      message: 'tab A declared the project of the open card (DeclareProjects)',
      timeout: LIVE_UPDATE_TIMEOUT_MS,
    })
    .toBe(true);

  const sentinel = `e2e-${tag}`;
  await tabA.evaluate((value) => {
    (window as unknown as { __e2eSentinel?: string }).__e2eSentinel = value;
  }, sentinel);
  const loadsBefore = loadsA;

  // ── 3. tab B: close the blocker through the UI ──────────────────
  const tabB = await context.newPage();
  await tabB.goto(`/projects/${project.idPrefix}/issues/${blocker.id}`);
  await tabB.getByRole('button', { name: 'Status: open', exact: true }).click();
  await tabB.getByRole('menuitem', { name: 'closed', exact: true }).click();
  const dialog = tabB.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect
    .poll(async () => (await getIssue(api, project.id, blocker.id)).status, {
      message: 'the server closed the blocker',
    })
    .toBe('closed');

  // ── 4. tab A updated itself ─────────────────────────────────────
  await expect(
    blockersLine,
    'the blockers sub-line of C disappeared without reopening (live event through skein-web)',
  ).toHaveCount(0, { timeout: LIVE_UPDATE_TIMEOUT_MS });
  await expect(row.locator('.epic-child-status.is-blocked'), 'the status highlight of C is gone').toHaveCount(0, {
    timeout: LIVE_UPDATE_TIMEOUT_MS,
  });
  await expect(row, 'the row of C stayed in place').toHaveCount(1);

  expect(
    await tabA.evaluate(() => (window as unknown as { __e2eSentinel?: string }).__e2eSentinel),
    'tab A was not reloaded or reopened',
  ).toBe(sentinel);
  expect(loadsA, 'tab A received no new load event').toBe(loadsBefore);
});
