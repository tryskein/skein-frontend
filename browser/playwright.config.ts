/**
 * sk-443 — browser checks config (Playwright, Chromium); sk-442 — e2e.
 *
 * Run through the harness: `npm run test:browser -- <group>`
 * (`scripts/browser-test.mjs`). The harness checks the selector against the
 * registry, waits for the stack and counts executed tests; a bare
 * `npx playwright test` has no zero-test guard.
 *
 * One Playwright project per group of the `groups.mjs` registry — the
 * project name is the group slug, and the harness counts executed tests by
 * `projectName`.
 *
 * The backend kind of the run (`groups.mjs#BrowserBackend`) comes from the
 * harness in `BROWSER_BACKEND`. The only kind is `live-stack` (sk-442): the
 * app is served by the live stack at `E2E_BASE_URL`, no `webServer` is
 * started. The address is required: a default would point the check at
 * somebody else's server (for example, the live dev stack). sk-540.10
 * removed the `mocked` kind (built app under `vite preview`, API mocked in
 * the browser) together with the `a11y` group.
 *
 * Service workers are blocked: on the live stack one would cache the app
 * shell between runs.
 */

import { defineConfig, devices } from '@playwright/test';
import { BROWSER_GROUPS } from './groups.mjs';

declare const process: { env: Record<string, string | undefined> };

const BACKEND = process.env.BROWSER_BACKEND;
if (BACKEND !== 'live-stack') {
  throw new Error(
    `BROWSER_BACKEND=${JSON.stringify(BACKEND)} — run browser tests through the harness: ` +
      'npm run test:browser -- <group> (scripts/browser-test.mjs)',
  );
}

function liveStackUrl(): string {
  const raw = process.env.E2E_BASE_URL;
  if (!raw) throw new Error('E2E_BASE_URL is not set — the live-stack groups have no default address');
  return raw.replace(/\/+$/, '');
}

const BASE_URL = liveStackUrl();
const REPORT_DIR = '../reports/browser';

const groups = Object.fromEntries(
  Object.entries(BROWSER_GROUPS).filter(([, g]) => g.backend === BACKEND),
);

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  // A `test.only` forgotten in a commit would narrow the run silently.
  forbidOnly: true,
  // No retries: a retry would hide a defect.
  retries: 0,
  fullyParallel: true,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  outputDir: `${REPORT_DIR}/artifacts`,
  reporter: [
    ['list'],
    // Machine report — the input of the zero guard in the harness.
    ['json', { outputFile: `${REPORT_DIR}/results.json` }],
    // CI artifact (`reports: junit`).
    ['junit', { outputFile: `${REPORT_DIR}/junit.xml` }],
  ],
  use: {
    baseURL: BASE_URL,
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
  projects: Object.entries(groups).map(([name, group]) => ({
    name,
    testDir: `./${group.dir}`,
    use: { ...devices['Desktop Chrome'] },
  })),
});
