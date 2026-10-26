# skein-frontend — environment variable reference

**This file is the single source of truth for skein-frontend configuration.**
The README and deployment manifests link here; they do not keep lists of their
own.

The short version: **the built SPA reads no environment variables at all.** It is
a static bundle served by nginx, and everything deployment-specific it needs
(auth mode, the MCP endpoint address, the logout redirect) is fetched from the
backend at runtime through `GET /api/auth/config`. That is deliberate — a value
baked into a bundle at build time would be wrong for every install that reuses
the image.

What remains is one variable for the Vite dev server, plus a few build-time and
container-level knobs that belong to other tools. They are all listed below.

No test compares this file with the code, so any new `process.env.*` or
`import.meta.env.*` read must be added here in the same change.

<!-- prod-required:begin -->
## Must be set in production — no safe default exists

| Variable | Why |
|---|---|
| — | There are none. The production image needs no environment variables; `APP_VERSION` is a build argument, described below. |
<!-- prod-required:end -->

---

## Development

#### `VITE_PROXY_TARGET`

- **Purpose:** where the Vite dev server forwards `/api` and `/hub` (the latter
  with WebSocket upgrade, for SignalR). Forwarding keeps the session cookie
  same-origin across the proxy, exactly as in production.
- **Required:** no · **Default:** `http://localhost:8080` · **Format:** absolute
  URL with scheme, host and port.
- **If unset:** `http://localhost:8080` — right when the BFF runs on the host.
  Inside the compose dev container the target is another container, so the local
  stack sets `http://skein-web:8080`.
- **Read at:** Vite config evaluation time (`process.env` in `vite.config.ts`),
  not in the browser. It affects `npm run dev` only and has **no** effect on
  `npm run build` or on the production image.

---

## Test suite

#### `TZ`

- **Purpose:** the process time zone. Two tests — `src/lib/issueProperties.test.ts`
  and `src/pages/shell/details/sections/ActivitySection.test.tsx` — assign
  `process.env.TZ` for their own duration (Node re-reads it on assignment) to
  prove that dates render in UTC or in the local zone as intended, and restore
  the previous value afterwards.
- **Required:** no · **Default:** whatever the machine running `npm test` has.
- **If unset:** the suite still passes — the tests that care pin their own zone.
- **Read at:** test run time only. Neither the dev server, the build nor the
  production bundle reads it.

---

<!-- unchecked:begin -->
## Not read by the application's own code

Nothing in `src/` or the Vite config reads these. They are listed because
whoever builds or deploys the image will come across them.

- **`APP_VERSION`** — a **Docker build argument**, not a runtime variable
  (`--build-arg APP_VERSION=…`). The Dockerfile writes it into
  `public/version.json` *before* `npm run build`, so it ends up in the bundle as
  `/version.json`. The SPA polls that file and shows an "update available"
  banner when the deployed version differs from the one the tab loaded.
  Defaults to `dev`; CI passes the git tag. Setting it as an environment variable
  on a running container does nothing — the value is baked in at build time.
- **`PORT`** — the runtime image sets `ENV PORT=5102`, but nginx listens on the
  literal `listen 5102;` in `nginx.conf`, and that file contains no
  substitutable placeholder. Changing `PORT` therefore does **not** change the
  port nginx binds. Publish a different host port instead (`-p 8080:5102`).
- **`NODE_ENV`, `CHOKIDAR_USEPOLLING`** — set on the optional
  `skein-frontend-dev` container of the development overlay
  `docker-compose.local.build.yml` in the root repository. They are
  consumed by Node and by the file watcher, not by this project's code.
  `CHOKIDAR_USEPOLLING=true` is on because bind mounts on WSL2 / Docker Desktop
  do not deliver inotify events reliably.
- **`import.meta.env.DEV`** — Vite's built-in mode flag, used in several modules
  to gate debug logging. It is derived from the build mode (`vite dev` versus
  `vite build`), not from an environment variable, so there is nothing to set.
- **`VITE_*` in `.env` files** — Vite's standard mechanism: a variable prefixed
  `VITE_` in `.env` / `.env.local` is inlined into the bundle as
  `import.meta.env.VITE_…`. No such variable is read by this project today, and
  `.env*` files are gitignored. If one is ever added, it must carry the `VITE_`
  prefix to reach the browser at all — and it must be added to this file.
<!-- unchecked:end -->

## A stale comment, not a variable

`nginx.conf` carries a comment saying that `SKEIN_BFF_URL` "is templated by
`envsubst` at container start (entrypoint hook)". **There is no such variable.**
The backend address in that file is the literal `http://skein-web:8080`, the file
contains no `${…}` placeholder, and the Dockerfile installs no entrypoint hook —
it copies `nginx.conf` straight to `conf.d/default.conf`. To point the proxy
somewhere else today, edit the file and rebuild. The comment is described here,
rather than in a list of variables, so that nobody sets `SKEIN_BFF_URL` and
expects it to be read.
