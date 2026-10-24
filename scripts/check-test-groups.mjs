#!/usr/bin/env node
/**
 * Guard of the `TEST_GROUPS` selector and of the Playwright version.
 *
 * ─── Selector ──────────────────────────────────────────────────────
 *
 * The browser harness selects levels with the variable `TEST_GROUPS`
 * (comma-separated slugs, empty = everything). A typo (`unitt`) would select
 * nothing and the run would go green without running what was asked. The guard checks
 * every slug against the registry (`browser/groups.mjs`: browser groups +
 * `NON_BROWSER_TEST_GROUPS`) and goes red on an unknown one.
 * Call: `node scripts/check-test-groups.mjs "<TEST_GROUPS>"`; the harness calls the
 * same parser itself.
 *
 * The grammar is strict (`parseSelector`): a malformed string such as `" , "` is
 * refused, not normalised into something that selects no test.
 *
 * When a group with `ciRequiredVariables` (the `e2e` image tags) is selected, every
 * variable must be set to a semver tag (`ciVariableProblems`).
 *
 * ─── Playwright version ────────────────────────────────────────────
 *
 * The browsers in the Playwright image (`mcr.microsoft.com/playwright:v<X>-…`) are built
 * for ONE Playwright version. If it diverges from `@playwright/test` in
 * `package.json`, the run fails with "Executable doesn't exist" right after
 * `npm ci`, while everything is green locally. The guard requires the exact version in
 * `package.json` (no `^`/`~`). `package.json` is the single source of the version.
 * When the umbrella checkout is next to this repository, the guard also compares the
 * image tag in the umbrella's `docker-compose.e2e.yml` with it (`UMBRELLA_COMPOSE_CANDIDATES`);
 * without the umbrella that comparison is skipped, not failed.
 *
 * Exit code: 0 — everything matches; 2 — the selector or the version do not match.
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { BROWSER_GROUPS, NON_BROWSER_TEST_GROUPS } from '../browser/groups.mjs';

/** Tags under which the release workflows publish images. */
export const IMAGE_TAG = /^\d+\.\d+\.\d+(-rc\.\d+)?$/;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The selector is not parsed by the `TEST_GROUPS` grammar. */
export class SelectorError extends Error {}

/**
 * The `TEST_GROUPS` grammar (sk-533 C2). An empty string is the full set (`[]`).
 * Otherwise — comma-separated elements, each exactly `SP*slug SP*`: a slug is
 * `[a-z0-9-]+`, surrounded only by ASCII spaces. An empty element (` , `,
 * `unit,,mutation`), a tab and any other whitespace character are refused, not
 * "trimmed and forgotten".
 */
export function parseSelector(raw) {
  const text = raw ?? '';
  if (text === '') return [];
  return text.split(',').map((element) => {
    const m = /^ *([a-z0-9-]+) *$/.exec(element);
    if (!m) {
      throw new SelectorError(
        `malformed element ${JSON.stringify(element)} in ${JSON.stringify(text)} — ` +
          'expected comma-separated slugs [a-z0-9-]+, only ASCII spaces around them, no empty elements',
      );
    }
    return m[1];
  });
}

/**
 * Full selector check: the grammar, the slug registry and the variables of
 * the selected groups (`ciRequiredVariables`) in `env`.
 *
 * @param {string | undefined} raw — `TEST_GROUPS` as is.
 * @param {Record<string, string | undefined>} env — environment variables.
 * @returns {{slugs: string[], problems: string[]}}
 */
export function checkSelector(raw, env) {
  const text = raw ?? '';
  let slugs;
  try {
    slugs = parseSelector(text);
  } catch (err) {
    if (err instanceof SelectorError) return { slugs: [], problems: [err.message] };
    throw err;
  }
  const problems = [];
  const unknown = unknownSlugs(slugs);
  if (unknown.length > 0) {
    problems.push(`unknown group(s) ${unknown.join(', ')} — known: ${knownSlugsText()}`);
  }
  // Groups that the string really enables: those named by a slug or
  // (empty selector) those part of "empty = all".
  const selectedGroups = Object.keys(BROWSER_GROUPS).filter((g) =>
    text === '' ? !BROWSER_GROUPS[g].explicitOnly : slugs.includes(g),
  );
  problems.push(...ciVariableProblems(selectedGroups, env));
  return { slugs, problems };
}

/**
 * Variables without which a group does not start
 * (`ciRequiredVariables` of the registry: the `e2e` image tags). Each must be
 * set and be a tag under which the image is published (`IMAGE_TAG`).
 *
 * @param {string[]} groups — selected groups.
 * @param {Record<string, string | undefined>} env
 * @returns {string[]} problems; empty — everything is set.
 */
export function ciVariableProblems(groups, env) {
  const problems = [];
  for (const g of groups) {
    for (const name of BROWSER_GROUPS[g]?.ciRequiredVariables ?? []) {
      const value = env?.[name];
      if (value === undefined || value === '') {
        problems.push(`${g} needs ${name} (image tag X.Y.Z or X.Y.Z-rc.N) — it is not set`);
      } else if (!IMAGE_TAG.test(value)) {
        problems.push(`${g}: ${name}=${JSON.stringify(value)} is not an image tag (X.Y.Z or X.Y.Z-rc.N)`);
      }
    }
  }
  return problems;
}

/** Unknown slugs of the selector (an empty array — the selector is valid). */
export function unknownSlugs(slugs) {
  const known = new Set([...Object.keys(BROWSER_GROUPS), ...NON_BROWSER_TEST_GROUPS]);
  return slugs.filter((s) => !known.has(s));
}

/** The list of known slugs for the error message. */
export function knownSlugsText() {
  return [...NON_BROWSER_TEST_GROUPS, ...Object.keys(BROWSER_GROUPS)].join(', ');
}

/**
 * Where the umbrella's e2e compose file may be, relative to this repository: the
 * contributor layout (`skein/projects/skein-frontend` -> `skein/`) and a sibling
 * `skein` checkout.
 */
const UMBRELLA_COMPOSE_CANDIDATES = [
  join(ROOT, '..', '..', 'docker-compose.e2e.yml'),
  join(ROOT, '..', 'skein', 'docker-compose.e2e.yml'),
];

/** Playwright version mismatch; `null` — it matches. */
export function playwrightVersionProblem() {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const declared = pkg.devDependencies?.['@playwright/test'];
  if (typeof declared !== 'string' || !/^\d+\.\d+\.\d+$/.test(declared)) {
    return `package.json: @playwright/test must be pinned to an exact version, got ${JSON.stringify(declared)}`;
  }
  const compose = UMBRELLA_COMPOSE_CANDIDATES.find((f) => existsSync(f));
  if (compose === undefined) return null;
  const tags = [
    ...readFileSync(compose, 'utf8').matchAll(/mcr\.microsoft\.com\/playwright:v(\d+\.\d+\.\d+)-/g),
  ].map((m) => m[1]);
  if (tags.length === 0) return `${compose}: no mcr.microsoft.com/playwright:v<version>-… image found`;
  const off = tags.filter((t) => t !== declared);
  if (off.length > 0) {
    return `${compose} uses Playwright image v${off.join(', v')} but package.json pins @playwright/test ${declared}`;
  }
  return null;
}

function main() {
  const raw = process.argv[2] ?? '';
  const { slugs, problems } = checkSelector(raw, process.env);
  for (const p of problems) console.error(`✗ TEST_GROUPS: ${p}`);
  const version = playwrightVersionProblem();
  if (version) console.error(`✗ ${version}`);
  if (problems.length > 0 || version) process.exit(2);
  console.log(
    `✓ TEST_GROUPS ${slugs.length ? slugs.join(',') : '(empty = all)'} is valid; ` +
      'Playwright version is consistent',
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
