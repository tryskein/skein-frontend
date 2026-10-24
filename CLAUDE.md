# skein-frontend

The Skein web UI: a React 18 + Vite + TypeScript + Mantine 7 + TanStack Query
SPA, served by nginx from this repository's image. nginx is the only public
entry point of Skein: it serves the bundle and proxies `/api/`, `/hub`,
`/mcp`, `/oauth2/` and `/.well-known/oauth-protected-resource[/mcp]` to
skein-web.

This repository is cloned into `skein/projects/skein-frontend/` of the
umbrella workspace (`https://github.com/tryskein/skein`). The umbrella
`CLAUDE.md` (`../../CLAUDE.md` from here) holds the cross-service rules,
including the `Delegated` mode (`outboxMode`) invariant that every UI surface
must honour.
Read it before changing this repository.

## Layout

| Path | What |
|---|---|
| `src/main.tsx`, `src/App.tsx` | entry (Mantine, TanStack Query, router) and route table |
| `src/api/` | typed REST clients, one module per resource |
| `src/auth/` | `AuthContext`, `RequireAuth`, logout-redirect policy |
| `src/components/`, `src/pages/` | shared components; pages (login, shell, settings, activity) |
| `src/hooks/` | `useLiveEvents.tsx` (SignalR) and other hooks |
| `src/lib/` | pure helpers: event classification, live invalidation, trees, theme runtime |
| `src/i18n/` | i18next setup, dictionaries `locales/en.ts` and `locales/ru.ts` |
| `src/test/` | vitest setup |
| `public/` | `sw.js` (Web Push), `theme-boot.js`, committed `version.json` |
| `browser/` | Playwright e2e: config, group registry `groups.mjs`, specs `e2e/` |
| `scripts/` | browser harness, test-selector guard, mutation guard |
| `nginx.conf`, `nginx-*-headers.conf` | runtime server config and header snippets |
| `docs/env-reference.md` | every environment variable and build argument |

## Commands

```bash
npm ci                 # before anything else
npm run dev            # Vite dev server :5173, proxies /api and /hub to VITE_PROXY_TARGET
npm run build          # tsc -b, then bundle to dist/
npm run typecheck      # tsc -b and tsc -p browser/tsconfig.json
npm test               # vitest run
docker build --build-arg APP_VERSION=dev -t skein-frontend .
```

The dev server needs a running backend. `VITE_PROXY_TARGET` defaults to
`http://localhost:8080`, the local stack of the umbrella. The image listens on
5102, and nginx proxies to the literal `http://skein-web:8080`. `PORT` does
not change the nginx port (see `docs/env-reference.md`).

## Conventions

- **No environment variables in the bundle.** Deployment-specific values
  (auth mode, MCP URL, logout redirect) come from `GET /api/auth/config` at
  runtime. A new `process.env.*` or `import.meta.env.*` read must be added to
  `docs/env-reference.md` in the same change.
- **`Delegated` mode** (`outboxMode`) applies to every count, list and filter
  derived from issues. The rule is in the umbrella `CLAUDE.md`, section
  "Frontend: `Delegated` mode is a global lens".
- **UI strings** go through i18next. Add every new key to both
  `src/i18n/locales/en.ts` and `src/i18n/locales/ru.ts`. English is the
  default.
- **Theme tokens.** `src/lib/themeTokens.ts#TOKEN_SECTIONS` is mirrored in
  skein-api. After changing it, run `./scripts/check-theme-mirror.sh` from the
  top of `skein/`.
- **`/version.json`.** `public/version.json` is committed with `dev`, and the
  Dockerfile overwrites it from the `APP_VERSION` build argument. The SPA polls
  it and offers a reload banner.
- **nginx headers.** A `location` with its own `add_header` stops inheriting
  the server-level headers, so every location includes a header snippet
  explicitly. The token pages (`/invite/`, `/reset-password/`,
  `/confirm-email/`) use `nginx-token-page-headers.conf` (`no-referrer`, CSP).
- **Code references** in comments and docs use a name anchor
  (`lib/themeTokens.ts#TOKEN_SECTIONS`), never a line number.

## Testing

### Kinds

| Kind | Status | In this project | Command (local) | Narrowed run | Location |
|---|---|---|---|---|---|
| unit | enabled | vitest + jsdom + Testing Library: lib, hooks, components, pages | `npm test` | `npx vitest run <file>` or `npx vitest run -t '<name pattern>'` | `src/**/*.test.{ts,tsx}`, setup `src/test/setup.ts` |
| integration | not used | — | — | — | — |
| e2e | enabled, manual only | Playwright + Chromium against a live stack of the three images plus Postgres, Redis, NATS and Garage (S3), no mocks. One suite for the whole product | from the top of `skein/`: `./scripts/e2e-test.sh` | `./scripts/e2e-test.sh -- -g '<test title pattern>'` | `browser/e2e/**/*.spec.ts`, seeding `browser/e2e/support/liveApi.ts`, stack `skein/docker-compose.e2e.yml` |
| smoke (image contract) | not used | — | — | — | — |
| mutation | enabled, advisory | StrykerJS. The output is the list of surviving mutants, not a score | `npm run test:mutation` (fixed `mutate` slice of the config) | changed lines only, see "Project specifics" | `stryker.config.mjs`, reports in `reports/mutation/` |
| source-reading checks | not used | none are added; existing ones are kept as they are | — | — | — |
| artifact contract | not used | — | — | — | — |

### Project specifics

- e2e is the only end-to-end suite of Skein, so it also covers the skein-api
  and skein-web images. By default the umbrella harness builds all three images
  from `skein/projects/*`. To test published images instead:
  ```bash
  E2E_REGISTRY=ghcr.io/tryskein E2E_API_TAG=X.Y.Z E2E_WEB_TAG=X.Y.Z E2E_FRONTEND_TAG=X.Y.Z \
    ./scripts/e2e-test.sh --images registry
  ```
  Tags must be release tags (`X.Y.Z` or `X.Y.Z-rc.N`).
- The umbrella harness runs `scripts/browser-test.mjs` in a container. That
  script counts executed tests per group from Playwright's JSON report. If no
  test ran, the run is red, whatever Playwright's exit code was. The group
  registry is `browser/groups.mjs`. Its only group, `e2e`, runs only when named
  explicitly: `npm run test:browser` without a group name exits 2.
- Run mutation testing on your change only, from the root of this repository.
  `BASE` is the parent of the first commit of your change, not necessarily
  `origin/main`. It targets the changed line ranges:
  ```bash
  BASE=<parent of the first commit of your change>
  MUTATE="$(git diff --unified=0 --diff-filter=AMR "$BASE"..HEAD -- src | awk '
    /^\+\+\+ b\//{f=substr($0,7); next}
    /^@@/{ if (f ~ /\.tsx?$/ && f !~ /\.(test|d)\.tsx?$/ && f !~ /^src\/test\//) {
             split($3,a,","); s=substr(a[1],2); n=(a[2]==""?1:a[2]);
             if (n>0) print f ":" s "-" (s+n-1) } }' | paste -sd, -)"
  [ -n "$MUTATE" ] && npx stryker run stryker.config.mjs --mutate "$MUTATE" || echo "no source lines in the diff"
  ```
- Stryker mutates a copy in `.stryker-tmp/` and never changes the source
  files. Incremental mode is on (`reports/stryker-incremental.json`). Delete
  that file or pass `--force` for a clean full run.
- No score threshold is set. Each surviving mutant gets a verdict: a real gap
  (strengthen a test), equivalent (no behaviour changes on any reachable
  path), or unproductive (no contract decides it).
- A run that measured nothing must not pass as an advisory warning. Check with
  `node scripts/assert-mutants-measured.mjs <stryker log> reports/mutation/mutation.json`.
  It exits 9 when no mutant was measured.

### Prerequisites

- `npm ci` in this repository before any run. The e2e runner container uses
  this tree's `node_modules`.
- No secrets: the e2e stack uses local development values from
  `skein/docker-compose.e2e.yml`.
- e2e needs Docker with Compose v2 (`up --wait`), a free subnet in
  `10.212.0.0/16`, and the three service repositories cloned under
  `skein/projects/`. Inside a devcontainer, export `HOST_WORKSPACE` (the path of
  `skein/` as the Docker daemon sees it).
- `scripts/browser-test.mjs` requires `E2E_BASE_URL` (exit 2 without it; there
  is no default). It waits for `E2E_BASE_URL/healthz` and every URL in
  `E2E_READY_URLS` (timeout `E2E_READY_TIMEOUT_S`, default 180 s).
- `@playwright/test` is pinned to an exact version in `package.json`.
  Browsers come from the image `mcr.microsoft.com/playwright:v<same version>-noble`.

### When what runs

| Event | unit | integration | e2e | smoke | mutation |
|---|---|---|---|---|---|
| push to `main` / pull request | `ci.yml`: `npm run typecheck`, `node scripts/check-test-groups.mjs ""`, vitest with a zero-tests guard | — | — | — | — |
| release tag `X.Y.Z` | `release.yml` calls `ci.yml` first, then builds and publishes the image | — | — | — | — |
| pull request / push to `main` touching `src/lib/themeTokens.ts` or `src/lib/themeMigration.ts` | `theme-mirror.yml` runs the umbrella `scripts/check-theme-mirror.sh` against skein-api `main` | — | — | — | — |
| manual | `npm test` | — | `./scripts/e2e-test.sh` in the umbrella | — | `npm run test:mutation` |

- `ci.yml` also runs on `workflow_call`; `release.yml` uses that, so a tag is
  built only after the same checks pass. Tags `X.Y.Z-rc.N` start nothing.
- `release.yml` triggers on `X.Y.Z` tags only, re-checks the tag with a strict
  regex, requires the tagged commit to be on `main`, builds `linux/amd64` and
  `linux/arm64` natively, pushes `ghcr.io/tryskein/skein-frontend:X.Y.Z` and
  `:latest`, then creates the GitHub Release. The publishing jobs use the
  `release` environment.
- e2e and mutation are not run on GitHub: e2e needs the three images and a
  live stack, mutation is advisory and run by hand.
- `theme-mirror.yml` checks out the umbrella `tryskein/skein` and
  `tryskein/skein-api` (`main`) beside this repository. It reports the
  mismatches between the two theme registries as they are; it does not fix them.

### Pitfalls

- vitest and Stryker do not see `browser/**/*.spec.ts`. `npm run typecheck`
  type-checks them.
- A bare `npx playwright test -c browser/playwright.config.ts` is rejected:
  `BROWSER_BACKEND` is unset, and only the harness sets it. Reports and traces
  go to `reports/browser/`.
- Upgrading `@playwright/test` means changing the Playwright image tag in the
  same change. `package.json` is the source of the version. The tag also
  appears in `skein/docker-compose.e2e.yml` of the umbrella, and
  `scripts/check-test-groups.mjs#playwrightVersionProblem` reports a mismatch
  when the umbrella is checked out next to this repository (and requires the
  exact pin in `package.json` either way).
- In e2e, wait for an observable state, such as `toHaveCount(0, { timeout })`.
  Never use `waitForTimeout`.
- Stryker:
  - the config path is POSITIONAL (`stryker run <file>`). `-c` means
    `--concurrency`;
  - repeated `--mutate` flags do not accumulate, the last one wins. Pass
    several files comma-separated in one flag;
  - never pass an empty `--mutate`. Without the flag, Stryker uses the config
    slice;
  - count mutants without running them:
    `npx stryker run stryker.config.mjs --dryRunOnly --mutate '<a.ts,b.ts>'`.
    The count is in the line `Instrumented N source file(s) with M mutant(s)`.
    Do this before widening `mutate`;
  - `concurrency` is pinned to 6 because of memory. Raise it for one run with
    `--concurrency N` and do not commit the change.

### Kinds without automatic runs

- e2e and mutation are manual only. unit and the type check run on GitHub
  Actions, see "When what runs".
