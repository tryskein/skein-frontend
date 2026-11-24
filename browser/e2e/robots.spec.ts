/**
 * sk-982 — an instance of Skein is not indexed by search engines.
 *
 * The live image of skein-frontend answers `/robots.txt` with the file
 * `public/robots.txt` as UTF-8 plain text, not the SPA's index.html
 * (`location = /robots.txt` in `nginx.conf`), and that file forbids
 * crawling everything. Every response also carries
 * `X-Robots-Tag: noindex, nofollow`: the pages under the site-wide header
 * snippet (`nginx-security-headers.conf`) and the token pages, which use
 * their own snippet (`nginx-token-page-headers.conf`).
 *
 * No data is seeded: none of these answers depends on a session or a token
 * being valid.
 */

import { expect, test } from '@playwright/test';
import { runTag } from './support/liveApi';

test.describe('sk-982 — the instance forbids indexing', () => {
  test('/robots.txt is plain UTF-8 text that disallows everything, not the SPA', async ({ request }) => {
    const response = await request.get('/robots.txt');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toBe('text/plain; charset=utf-8');
    const lines = (await response.text()).split('\n').map((line) => line.trim());
    expect(lines).toContain('User-agent: *');
    expect(lines).toContain('Disallow: /');
    expect(response.headers()['x-robots-tag']).toBe('noindex, nofollow');
  });

  // `/login` is under the site-wide header snippet, a token page under its own.
  for (const route of ['/login', '/reset-password'] as const) {
    test(`${route} — the document says noindex, nofollow`, async ({ page }) => {
      const response = await page.goto(route === '/login' ? route : `${route}/e2e-${runTag()}`);
      expect(response, 'the document was served').not.toBeNull();
      expect(response!.status()).toBe(200);
      expect(response!.headers()['x-robots-tag']).toBe('noindex, nofollow');
    });
  }
});
