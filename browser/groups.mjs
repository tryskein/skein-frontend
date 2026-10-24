/**
 * sk-443 — registry of browser check groups. The only source of truth about
 * which groups exist: it is read by the Playwright config (one project per
 * group), the harness `scripts/browser-test.mjs` (selector → groups, count of
 * executed tests per group) and the guard `scripts/check-test-groups.mjs` (the
 * `TEST_GROUPS` slugs of the manual CI run). A group that is not here is
 * not run anywhere: a selector naming it is red before the browser starts.
 *
 * Group fields:
 *   - `dir` — the spec directory relative to `browser/`; Playwright takes
 *     only `*.spec.ts` from there (vitest sees only `src/**\/*.test.{ts,tsx}`,
 *     Stryker — only the files of its `mutate`, so neither of them
 *     picks up browser specs);
 *   - `description` — what the group proves, in one phrase;
 *   - `backend` — what the group needs from the backend. One kind exists:
 *       - `'live-stack'` (sk-442) — the live stack: skein-frontend (nginx) →
 *         skein-web → skein-api + Postgres/Redis/NATS/Garage, started from
 *         images. The harness builds nothing, takes the entry address from
 *         `E2E_BASE_URL` (required, no default) and waits for readiness.
 *     sk-540.10 removed the `'mocked'` kind (built app + strict in-browser
 *     API mock) together with its only group `a11y`: the project's test
 *     guidelines forbid accessibility checks. Kinds are never mixed in one run
 *     (harness exit 2);
 *   - `explicitOnly` — the group is NOT part of "empty = all": neither in an empty
 *     `TEST_GROUPS` nor in a harness run without arguments.
 *     Only an explicit slug includes it. This is how `e2e` works: it needs
 *     published images by tag, and an empty selector on a branch without tags would give
 *     a false red, while a silent skip would give a false green;
 *   - `ciRequiredVariables` — variables without which the group cannot start
 *     (image tags). The selector guard goes red if the group is selected and the
 *     variable is unset or is not a semver tag (`X.Y.Z` / `X.Y.Z-rc.N` — the tags
 *     under which the release workflows publish images).
 *
 * The group name is a `TEST_GROUPS` slug: `[a-z0-9-]+`, no commas or spaces.
 *
 * @typedef {'live-stack'} BrowserBackend
 * @typedef {{
 *   dir: string,
 *   description: string,
 *   backend: BrowserBackend,
 *   explicitOnly?: boolean,
 *   ciRequiredVariables?: readonly string[],
 * }} BrowserGroup
 * @type {Readonly<Record<string, BrowserGroup>>}
 */
export const BROWSER_GROUPS = Object.freeze({
  e2e: {
    dir: 'e2e',
    description:
      'End-to-end scenarios through the live stack (nginx → skein-web → skein-api, SignalR): the first is US-5 B8',
    backend: 'live-stack',
    explicitOnly: true,
    ciRequiredVariables: Object.freeze(['E2E_API_TAG', 'E2E_WEB_TAG', 'E2E_FRONTEND_TAG']),
  },
});

/**
 * Groups that are part of "empty = all" (without `explicitOnly`) — one rule
 * for the harness and the guard.
 *
 * @param {BrowserBackend} [backend] only groups of this backend (all when omitted).
 * @returns {string[]}
 */
export function defaultGroups(backend) {
  return Object.entries(BROWSER_GROUPS)
    .filter(([, g]) => !g.explicitOnly && (backend === undefined || g.backend === backend))
    .map(([name]) => name);
}

/**
 * `TEST_GROUPS` slugs of the NON-browser test levels (`unit`, `mutation`).
 * The harness skips them, the selector guard recognises them. Added a level with
 * its own slug — add it here.
 */
export const NON_BROWSER_TEST_GROUPS = Object.freeze(['unit', 'mutation']);
