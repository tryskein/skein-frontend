/**
 * sk-982 — an instance of Skein serves the directives that ask search
 * engines not to crawl it and not to index what they fetch.
 *
 * The scenario reads HTTP answers only. It does not show that the instance
 * is absent from search results: a crawler that obeys `Disallow: /` never
 * fetches a page and so never reads its `X-Robots-Tag`, and a URL linked
 * from elsewhere may still be listed bare (see `docs/env-reference.md`).
 *
 * The live image of skein-frontend answers `/robots.txt` with the file
 * `public/robots.txt` as UTF-8 plain text, not the SPA's index.html
 * (`location = /robots.txt` in `nginx.conf`), and that file has one group,
 * for every user agent, that disallows every path and allows none. Every
 * response also carries
 * `X-Robots-Tag: noindex, nofollow`: the pages under the site-wide header
 * snippet (`nginx-security-headers.conf`) and the token pages, which use
 * their own snippet (`nginx-token-page-headers.conf`).
 *
 * No data is seeded: none of these answers depends on a session or a token
 * being valid.
 */

import { expect, test } from '@playwright/test';
import { runTag } from './support/liveApi';

test.describe('sk-982 — the instance serves disallow-all and noindex directives', () => {
  test('/robots.txt is plain UTF-8 text that disallows everything, not the SPA', async ({ request }) => {
    const response = await request.get('/robots.txt');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toBe('text/plain; charset=utf-8');
    // The active directives in file order, comments and blank lines left
    // out: the one wildcard group forbids every path, and no other group or
    // `Allow` line can take a crawler out of that rule.
    const directives = (await response.text())
      .split('\n')
      .map((line) => line.replace(/#.*/, '').trim())
      .filter((line) => line !== '');
    expect(directives).toEqual(['User-agent: *', 'Disallow: /']);
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
