/**
 * sk-674.18 — a deactivated user's open tab is signed out on its next
 * request (row 260; INV-26, the web↔api chain of T036/T048).
 *
 * The chain under test, all live: the admin deactivates the user →
 * skein-api ends the user's sessions (the session epoch moves) → the next
 * request of the user's tab goes through skein-web with the old epoch
 * (`X-Skein-Session-Epoch`) → skein-api answers 401 `session_revoked` →
 * skein-web ends the session (cookie and Redis ticket) and passes the 401
 * on → the SPA's single 401 handler (`src/lib/appQueryClient.ts`) clears
 * the user → the tab is on the sign-in page.
 *
 * Red if the session keeps working after the deactivation: the tab's
 * request is answered, or the cookie still opens `/api/auth/me`; red too
 * if the request is refused for any other reason than the end of the
 * session (`session_revoked` from skein-api, or skein-web's own
 * `unauthenticated` once it has removed the ticket — see below).
 * The positive control is the same session answering before it.
 *
 * The tab runs without the live channel. With it, the `user.deactivated`
 * event about the signed-in user signs the tab out by itself
 * (`src/lib/liveVisibility.ts`, sk-622.21 K18 — a different path, covered
 * by its own tests): the logout goes first and the request chain under test
 * never runs. Without the hub the shell still opens — the live connection
 * only retries in the background (`src/hooks/useLiveEvents.tsx#tryConnect`).
 *
 * Written to the contract of T036 (skein-api, 401 `session_revoked`) — it
 * runs at Stage 7, once T036 is in.
 */

import { expect, test } from '@playwright/test';
import { createUser, deactivateUser, login, loginAs, runTag } from './support/liveApi';

/** The answer reaches the tab in well under a second; 15 s is the cold-stack margin. */
const RESPONSE_TIMEOUT_MS = 15_000;

test.use({ viewport: { width: 1600, height: 1000 } });

test('260: a user deactivated by the admin — the open tab’s next request signs it out', async ({
  browser,
  context,
}) => {
  test.setTimeout(120_000);
  const api = context.request;
  const tag = runTag();
  await login(api);
  const user = await createUser(api, tag);

  const userContext = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await loginAs(userContext.request, user);
  const tab = await userContext.newPage();
  // Cut the tab off the SignalR hub before it loads, every transport: the
  // negotiate and the HTTP fallbacks (SSE, long polling — `/hub/…`,
  // `/hub?id=…`) are aborted, a WebSocket to `/hub` is closed without ever
  // reaching skein-web. Disjoint from the `/api/v1/` route below, so the
  // order of the routes does not matter.
  const isHub = (url: URL) => url.pathname === '/hub' || url.pathname.startsWith('/hub/');
  await tab.route(isHub, (route) => route.abort());
  await tab.routeWebSocket(isHub, (ws) => ws.close({ code: 1008, reason: 'e2e: hub cut off' }));
  await tab.goto('/');
  const mentions = tab.getByRole('link', { name: /^Mentions \d+$/ }).first();
  await expect(mentions, 'precondition: the shell is open').toBeVisible();
  // Positive control: the session works.
  expect((await userContext.request.get('/api/auth/me')).status(), 'precondition: the session answers').toBe(200);

  await deactivateUser(api, user.id);

  // The tab's next request to skein-api, made by the tab itself with its
  // own cookie (a click on a loaded queue reads nothing). Either refusal is
  // the exit of row 260 — decision of 2026-10-15 (sk-674.18): the
  // session must not answer, by whichever of the two live mechanisms ends
  // it first. skein-web removes the user's tickets on the NATS event of the
  // deactivation (`Hubs/AccessControlSubscriber.cs#DeactivateAsync`) — then
  // its own gate answers `unauthenticated` without calling skein-api;
  // a request that outruns that subscriber reaches skein-api with the old
  // epoch and gets `session_revoked`, on which the proxy ends the session
  // (K-16). The proxy's handling of `session_revoked` itself is covered by
  // skein-web's unit tests (rows 214–217); here the property is the live
  // outcome. Any other answer — 200, or a 401 for another reason — is red.
  const refusal = await tab.evaluate(async () => {
    const res = await fetch('/api/v1/me/spaces', { credentials: 'same-origin' });
    return { status: res.status, body: await res.text() };
  });
  expect(refusal.status, `the tab's next request is refused (body ${refusal.body})`).toBe(401);
  const code = (JSON.parse(refusal.body) as { error?: string }).error;
  expect(['session_revoked', 'unauthenticated'], `the refusal says the session is over (got ${code})`).toContain(code);

  // The tab follows: on its next load the SPA finds no session.
  await tab.reload();
  await expect
    .poll(() => new URL(tab.url()).pathname, { message: 'the tab is on the sign-in page', timeout: RESPONSE_TIMEOUT_MS })
    .toBe('/login');
  await expect(tab.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  // The session itself is over, not only this tab's view of it.
  expect((await userContext.request.get('/api/auth/me')).status(), 'the session no longer opens anything').toBe(401);
  await userContext.close();
});
