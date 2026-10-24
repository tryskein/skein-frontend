/**
 * sk-674.18 T059 — the token stays out of the Referer (row 261;
 * spec "Constraints", US-5, US-9; plan T059 gate "pages with a token do not
 * pass the token through Referer").
 *
 * The live image of skein-frontend serves the document of
 * `/invite/:token` and `/reset-password/:token` with
 * `Referrer-Policy: no-referrer` (`nginx.conf`, the token pages block,
 * `nginx-token-page-headers.conf`). Red if the header is missing.
 *
 * Beyond the header, the request the invitation page itself makes with the
 * token (`GET /api/auth/invitations/<token>`, `src/api/invitations.ts`)
 * leaves without a Referer — the effect the header exists for, observed on
 * the wire. The positive control: a page without a token (`/login`) keeps
 * the default policy, so a policy set for the whole site would not pass for
 * this one.
 *
 * No data is seeded: an unknown token is enough — the headers do not
 * depend on the token being valid, and a dead link still asks the server
 * about it.
 */

import { expect, test } from '@playwright/test';
import { runTag } from './support/liveApi';

test.describe('row 261 — the token pages are served with Referrer-Policy: no-referrer', () => {
  for (const route of ['/invite', '/reset-password'] as const) {
    test(`${route}/:token — the document carries no-referrer`, async ({ page }) => {
      const response = await page.goto(`${route}/e2e-${runTag()}`);
      expect(response, 'the document was served').not.toBeNull();
      expect(response!.status()).toBe(200);
      expect(response!.headers()['referrer-policy']).toBe('no-referrer');
    });
  }

  test('positive control: /login keeps the site-wide policy', async ({ page }) => {
    const response = await page.goto('/login');
    expect(response, 'the document was served').not.toBeNull();
    const policy = response!.headers()['referrer-policy'];
    expect(policy, 'the site sets a policy at all').toBeTruthy();
    expect(policy).not.toBe('no-referrer');
  });

  test('/invite/:token — the page’s own request with the token goes without a Referer', async ({ page }) => {
    const token = `e2e-${runTag()}`;
    const ask = page.waitForRequest(
      (req) => new URL(req.url()).pathname === `/api/auth/invitations/${token}`,
    );
    await page.goto(`/invite/${token}`);
    const request = await ask;
    const headers = await request.allHeaders();
    expect(headers['referer'], 'no Referer on the request made from the token page').toBeUndefined();
  });
});
