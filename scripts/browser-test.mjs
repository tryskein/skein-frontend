#!/usr/bin/env node
/**
 * sk-443 — harness of the browser checks in one command; sk-442 — and e2e.
 *
 *   npm run test:browser -- [group ...] [-- Playwright flags]
 *   node scripts/browser-test.mjs --selector "$TEST_GROUPS" --backend <kind>   (CI)
 *
 * Steps:
 *   1. Selector → groups. Positional arguments are group slugs of the
 *      `browser/groups.mjs` registry. Without them the harness takes the
 *      default groups (`groups.mjs#defaultGroups`: all but `explicitOnly`).
 *      sk-540.10: that set is EMPTY now — the only group, `e2e`, is
 *      explicit-only — so a run without groups is exit 2 with «no groups
 *      selected, nothing ran» and a hint to name one; `e2e` is never switched
 *      on implicitly, and nothing is reported as passed. In `--selector`
 *      mode (CI) `TEST_GROUPS` is parsed as the pipeline does: slugs of
 *      NON-browser jobs (`unit`, `mutation`) and of groups of another kind
 *      are skipped, empty = the default groups of `--backend` (each browser
 *      job of CI runs its own kind). An unknown slug is red BEFORE any
 *      browser starts; the same step checks the Playwright version against
 *      the CI image. Groups of different backend kinds are never mixed in
 *      one run — exit 2.
 *   2. Preparation for the `live-stack` kind (sk-442): nothing is built, the
 *      live stack serves the app. `E2E_BASE_URL` is required (missing, not a
 *      URL, not http(s) — exit 2). The harness waits for readiness:
 *      `E2E_BASE_URL/healthz` and every address of `E2E_READY_URLS` (comma
 *      separated) must answer 200; not within `E2E_READY_TIMEOUT_S`
 *      (default 180) — exit 1 listing what did not answer. In CI mode the
 *      same step re-checks the group variables (`ciRequiredVariables`).
 *      (sk-540.10 removed the `mocked` kind: build + `vite preview` + the
 *      harness self-checks of the strict API mock.)
 *   3. `playwright test --project=<group> ...` with json and junit reports
 *      (`reports/browser/`), the backend kind in `BROWSER_BACKEND`. Flags
 *      after `--` go to Playwright as is (for example `-g <pattern>` to
 *      narrow). The CI selector goes through the same grammar as the guard
 *      (`check-test-groups.mjs#parseSelector`).
 *   4. «Green ≠ ran»: Playwright's exit code is not taken on faith. The json
 *      report is read and, for EACH selected group, tests EXECUTED and
 *      passed (`status: expected` with `expectedStatus: passed`) are
 *      counted. Zero in any group is red: both «nothing matched» (a `-g`
 *      typo, an empty directory) and «all skipped» (`test.skip`). Any
 *      unexpected/flaky, a run-level error or a missing report is red too.
 *
 * Exit: 0 — everything selected ran and passed; 1 — a failure, zero executed
 * or the stack not ready; 2 — no group selected, invalid selector / kind /
 * address / variables, Playwright version mismatch.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BROWSER_GROUPS,
  defaultGroups,
  NON_BROWSER_TEST_GROUPS,
} from '../browser/groups.mjs';
import {
  ciVariableProblems,
  knownSlugsText,
  parseSelector,
  playwrightVersionProblem,
  SelectorError,
  unknownSlugs,
} from './check-test-groups.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = 'browser/playwright.config.ts';
const REPORT = join(ROOT, 'reports', 'browser', 'results.json');

function fail(code, message) {
  console.error(`✗ browser tests: ${message}`);
  process.exit(code);
}

// ── 1. selector ────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const dashDash = argv.indexOf('--');
const own = dashDash >= 0 ? argv.slice(0, dashDash) : argv;
const passthrough = dashDash >= 0 ? argv.slice(dashDash + 1) : [];

const BACKENDS = ['live-stack'];

let requested;
let ciMode = false;
let ciBackend;
if (own[0] === '--selector') {
  // CI: `--selector <TEST_GROUPS> --backend <kind>` — exactly like this.
  if (own.length !== 4 || own[2] !== '--backend') {
    fail(2, `CI mode is exactly: --selector "<TEST_GROUPS>" --backend <${BACKENDS.join('|')}>`);
  }
  ciMode = true;
  ciBackend = own[3];
  if (!BACKENDS.includes(ciBackend)) fail(2, `--backend ${JSON.stringify(ciBackend)} — expected ${BACKENDS.join(' or ')}`);
  try {
    requested = parseSelector(own[1]);
  } catch (err) {
    if (err instanceof SelectorError) fail(2, `TEST_GROUPS: ${err.message}`);
    throw err;
  }
} else {
  const flag = own.find((a) => a.startsWith('-'));
  if (flag) fail(2, `unknown option ${flag}; pass Playwright flags after "--"`);
  requested = own;
}

const unknown = unknownSlugs(requested);
if (unknown.length > 0) fail(2, `unknown group(s) ${unknown.join(', ')} — known: ${knownSlugsText()}`);
const notBrowser = requested.filter((s) => NON_BROWSER_TEST_GROUPS.includes(s));
if (!ciMode && notBrowser.length > 0) {
  fail(2, `${notBrowser.join(', ')} is not a browser group (run it with its own command)`);
}

let groups;
if (ciMode) {
  // A CI job runs one kind; the slugs of a foreign kind enable their own job.
  const picked = [...new Set(requested.filter((s) => BROWSER_GROUPS[s]?.backend === ciBackend))];
  if (requested.length > 0 && picked.length === 0) {
    fail(2, `TEST_GROUPS=${requested.join(',')} selects no ${ciBackend} group, yet the ${ciBackend} job ran`);
  }
  groups = picked.length > 0 ? picked : defaultGroups(ciBackend);
  if (groups.length === 0) {
    fail(2, `empty TEST_GROUPS selects no ${ciBackend} group (explicit-only groups need their slug)`);
  }
} else {
  groups = requested.length > 0 ? [...new Set(requested)] : defaultGroups();
  if (groups.length === 0) {
    // sk-540.10: every group is explicit-only, so the default set is empty.
    // Nothing is switched on implicitly and nothing is reported as passed.
    const explicit = Object.keys(BROWSER_GROUPS).filter((g) => BROWSER_GROUPS[g].explicitOnly);
    fail(
      2,
      'no groups selected, nothing ran — every browser group needs its explicit name; ' +
        `try: ${explicit.map((g) => `npm run test:browser -- ${g}`).join(' | ')}`,
    );
  }
}

const backends = [...new Set(groups.map((g) => BROWSER_GROUPS[g].backend))];
if (backends.length !== 1) {
  fail(
    2,
    `groups ${groups.join(', ')} need different backends (${backends.join(', ')}) — run them separately`,
  );
}
const backend = backends[0];

const version = playwrightVersionProblem();
if (version) fail(2, version);

if (!ciMode && requested.length === 0) {
  const left = Object.keys(BROWSER_GROUPS).filter((g) => !groups.includes(g));
  if (left.length > 0) console.log(`▶ not in the default set (name them explicitly): ${left.join(', ')}`);
}

console.log(`▶ browser groups: ${groups.join(', ')} (backend: ${backend})`);

// ── 2. preparation by kind ─────────────────────────────────────────
const childEnv = { ...process.env, BROWSER_BACKEND: backend };
if (ciMode) {
  const missing = ciVariableProblems(groups, process.env);
  if (missing.length > 0) fail(2, missing.join('; '));
}
const base = liveBaseUrl(process.env.E2E_BASE_URL);
childEnv.E2E_BASE_URL = base;
await waitReady([`${base}/healthz`, ...readyUrls(process.env.E2E_READY_URLS)]);

// ── 3. Playwright ──────────────────────────────────────────────────
rmSync(REPORT, { force: true });
const pw = spawnSync(
  'npx',
  ['playwright', 'test', '-c', CONFIG, ...groups.map((g) => `--project=${g}`), ...passthrough],
  { cwd: ROOT, stdio: 'inherit', env: childEnv },
);

// ── 4. count of executed tests ─────────────────────────────────────
if (!existsSync(REPORT)) fail(1, `no JSON report at ${REPORT} (Playwright exit ${pw.status})`);
const report = JSON.parse(readFileSync(REPORT, 'utf8'));

const perGroup = new Map(groups.map((g) => [g, { passed: 0, skipped: 0, failed: 0 }]));
const foreign = new Set();
const walk = (suite) => {
  for (const spec of suite.specs ?? []) {
    for (const t of spec.tests ?? []) {
      const bucket = perGroup.get(t.projectName);
      if (!bucket) {
        foreign.add(t.projectName);
        continue;
      }
      if (t.status === 'expected' && t.expectedStatus === 'passed') bucket.passed += 1;
      else if (t.status === 'skipped') bucket.skipped += 1;
      else bucket.failed += 1; // unexpected, flaky, or "expected to fail" (test.fail)
    }
  }
  for (const child of suite.suites ?? []) walk(child);
};
for (const suite of report.suites ?? []) walk(suite);

const problems = [];
if ((report.errors ?? []).length > 0) {
  problems.push(`run-level errors: ${report.errors.map((e) => e.message?.split('\n')[0]).join(' | ')}`);
}
if (foreign.size > 0) problems.push(`report has tests of unselected projects: ${[...foreign].join(', ')}`);
for (const [group, c] of perGroup) {
  console.log(`  ${group}: passed ${c.passed}, skipped ${c.skipped}, failed ${c.failed}`);
  if (c.failed > 0) problems.push(`${group}: ${c.failed} test(s) did not pass`);
  // Zero passed with some failed is already red from the line above; "zero executed"
  // is a separate diagnosis: nothing was found or everything was skipped.
  if (c.passed === 0 && c.failed === 0) {
    problems.push(
      c.skipped > 0
        ? `${group}: ZERO tests executed — all ${c.skipped} skipped`
        : `${group}: ZERO tests executed — nothing matched`,
    );
  }
}
if (pw.status !== 0) problems.push(`Playwright exited ${pw.status}`);

if (problems.length > 0) fail(1, problems.join('; '));
const sum = (key) => groups.reduce((a, g) => a + perGroup.get(g)[key], 0);
console.log(
  `✓ browser tests passed (groups: ${groups.join(', ')}; executed: ${sum('passed')}, ` +
    `skipped: ${sum('skipped')})`,
);

// ── helper: live stack ─────────────────────────────────────────────

/** `E2E_BASE_URL` → address without a trailing `/`; unset or not an http(s) URL — exit 2. */
function liveBaseUrl(raw) {
  if (!raw) {
    fail(
      2,
      'E2E_BASE_URL is not set — live-stack groups have no default address. ' +
        'Locally run the root harness scripts/e2e-test.sh; in CI the test-e2e job sets it.',
    );
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    fail(2, `E2E_BASE_URL=${JSON.stringify(raw)} is not a URL`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    fail(2, `E2E_BASE_URL=${JSON.stringify(raw)} must be http(s)`);
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    fail(2, `E2E_BASE_URL=${JSON.stringify(raw)} must be an origin (no path, query or fragment)`);
  }
  return url.origin;
}

/** `E2E_READY_URLS` — comma-separated addresses; empty — none. Each must be an http(s) URL. */
function readyUrls(raw) {
  if (!raw) return [];
  return raw.split(',').map((item) => {
    const text = item.trim();
    let url;
    try {
      url = new URL(text);
    } catch {
      fail(2, `E2E_READY_URLS: ${JSON.stringify(text)} is not a URL`);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      fail(2, `E2E_READY_URLS: ${JSON.stringify(text)} must be http(s)`);
    }
    return url.href;
  });
}

/**
 * Waits until EVERY address answers 200 — by polling once a second, not
 * by a blind pause. If not ready within `E2E_READY_TIMEOUT_S` — exit 1 and the last
 * answer of each unready address.
 */
async function waitReady(urls) {
  const rawTimeout = process.env.E2E_READY_TIMEOUT_S ?? '180';
  const timeoutS = Number(rawTimeout);
  if (!Number.isInteger(timeoutS) || timeoutS <= 0) {
    fail(2, `E2E_READY_TIMEOUT_S=${JSON.stringify(rawTimeout)} must be a positive integer`);
  }
  const deadline = Date.now() + timeoutS * 1000;
  const last = new Map(urls.map((u) => [u, 'not polled yet']));
  const started = Date.now();
  const pending = new Set(urls);
  while (pending.size > 0) {
    for (const u of [...pending]) {
      try {
        const res = await fetch(u, { signal: AbortSignal.timeout(5_000), cache: 'no-store' });
        if (res.status === 200) pending.delete(u);
        else last.set(u, `HTTP ${res.status}`);
      } catch (err) {
        last.set(u, err instanceof Error ? (err.cause?.code ?? err.message) : String(err));
      }
    }
    if (pending.size === 0) break;
    if (Date.now() >= deadline) {
      fail(1, `stack not ready after ${timeoutS}s: ${[...pending].map((u) => `${u} (${last.get(u)})`).join(', ')}`);
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  console.log(`▶ stack ready in ${((Date.now() - started) / 1000).toFixed(1)}s: ${urls.join(', ')}`);
}
