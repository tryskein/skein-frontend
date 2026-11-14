/**
 * sk-878.3.1 — a key issued in the API keys page opens the public REST API
 * (row 119; R-1, INV-10, US-9, US-10).
 *
 * The chain under test, all live: a user of the run signs in, opens the API
 * keys page, creates a key and reads its secret from the one-time reveal
 * (US-10) → an API client — Playwright `request` from the runner container,
 * not the browser and not skein-web — calls skein-api's public port
 * straight:
 *   - `GET /api/v1/openapi.json` answers 200 with an OpenAPI 3.1 document
 *     (US-9);
 *   - `GET /api/v1/me` with the key answers 200 and names the key's owner
 *     (the product chain: key lookup, grant, identity);
 *   - `/ui/v1/...` — the internal API of the browser — does not exist on
 *     the public port: 404 (INV-10, the allowlist).
 *
 * Red if skein-api mounted the wrong handler on the public server, the
 * compose stack did not open the port, or the key from the page is not
 * accepted by the public entry.
 *
 * The public address comes from `E2E_PUBLIC_API_URL` (the umbrella
 * `docker-compose.e2e.yml`, service `e2e-runner`); no default, as with
 * `E2E_BASE_URL`. The page shows the instance's own public address and its
 * `openapi.json` link (`SKEIN_PUBLIC_API_URL` of the same stack), and the
 * spec follows that link's target with the API client.
 */

import { expect, request, test } from '@playwright/test';
import { en } from '../../src/i18n/locales/en';
import { createUser, loginAs, login, runTag } from './support/liveApi';

declare const process: { env: Record<string, string | undefined> };

const keys = en.settings.keys;

function publicApiUrl(): string {
  const raw = process.env.E2E_PUBLIC_API_URL;
  if (!raw) throw new Error('E2E_PUBLIC_API_URL is not set — the public API scenario has no default address');
  return raw.replace(/\/+$/, '');
}

test.use({ viewport: { width: 1600, height: 1000 } });

test('119: a key created in the API keys page opens the public API — openapi.json, GET /api/v1/me, no /ui/v1', async ({
  browser,
  context,
}) => {
  test.setTimeout(120_000);
  const base = publicApiUrl();
  const tag = runTag();
  await login(context.request);
  const user = await createUser(context.request, tag);

  // The owner of the key is the run's own user, signed in in its own context.
  const userContext = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await loginAs(userContext.request, user);
  const page = await userContext.newPage();
  await page.goto('/settings/api-keys');

  // The page states where the public API lives and links its document.
  const openApiLink = page.getByRole('link', { name: keys.publicApi.openApi });
  await expect(openApiLink, 'the page links openapi.json of this instance').toBeVisible();
  const openApiHref = await openApiLink.getAttribute('href');
  expect(openApiHref, 'the link is the public openapi.json').toBe(`${base}/api/v1/openapi.json`);

  // Create a key: a name, the "read" preset, every project, the default lifetime.
  const label = `e2e-public-${tag}`;
  await page.getByRole('button', { name: keys.list.newKey }).click();
  const form = page.getByRole('form', { name: keys.form.createAria });
  await form.getByRole('textbox', { name: keys.form.label }).fill(label);
  await form.getByRole('radio', { name: keys.preset.read }).check();
  await form.getByRole('radio', { name: keys.scopeMode.all }).check();
  await form.getByRole('button', { name: keys.form.create }).click();

  // The secret, from the one-time reveal.
  const reveal = page.getByRole('dialog', { name: keys.reveal.title });
  await expect(reveal).toBeVisible();
  const secret = ((await reveal.getByLabel(en.secretReveal.valueLabel, { exact: true }).textContent()) ?? '').trim();
  expect(secret, 'the reveal shows an ska_ key').toMatch(/^ska_\S+$/);

  // The API client: straight at skein-api's public port, no cookie, no BFF.
  const client = await request.newContext({ baseURL: base });
  try {
    const doc = await client.get('/api/v1/openapi.json');
    expect(doc.status(), 'openapi.json on the public port').toBe(200);
    expect(((await doc.json()) as { openapi?: string }).openapi, 'an OpenAPI 3.1 document').toBe('3.1.0');

    const me = await client.get('/api/v1/me', { headers: { 'X-Skein-Api-Key': secret } });
    const meBody = await me.text();
    expect(me.status(), `GET /api/v1/me with the key from the page (body ${meBody})`).toBe(200);
    const identity = JSON.parse(meBody) as { user?: { id?: string; email?: string } };
    expect(identity.user?.id, 'the key acts as its owner').toBe(user.id);
    expect(identity.user?.email).toBe(user.email);

    // The browser's internal API is not on the public port (allowlist).
    const internal = await client.get('/ui/v1/me/api-keys', { headers: { 'X-Skein-Api-Key': secret } });
    expect(internal.status(), '/ui/v1 does not exist on the public port').toBe(404);
  } finally {
    await client.dispose();
    await userContext.close();
  }
});
