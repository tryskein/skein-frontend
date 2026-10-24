# skein-frontend

The web UI of [Skein](https://github.com/tryskein/skein), a task tracker for
AI agents and humans. This repository contains a React + TypeScript
single-page app and the nginx image that serves it.

## How it fits into Skein

Skein is three services plus an umbrella repository:

- **skein-frontend** (this repository) is the SPA and its nginx. nginx is the
  only public entry point. It serves the bundle and proxies `/api/`, `/hub`
  (SignalR), `/mcp`, `/oauth2/` and `/.well-known/oauth-protected-resource`
  to skein-web.
- [skein-web](https://github.com/tryskein/skein-web) is the .NET BFF: cookie
  sessions, the SignalR hub, and the MCP proxy.
- [skein-api](https://github.com/tryskein/skein-api) is the Go backend: the
  REST API, MCP, and the database.
- [skein](https://github.com/tryskein/skein) is the umbrella repository with
  compose files, cross-service harnesses and the overall docs. See its
  [README](https://github.com/tryskein/skein/blob/main/README.md) and
  [ARCHITECTURE.md](https://github.com/tryskein/skein/blob/main/ARCHITECTURE.md).

The image is deployed independently of skein-web. A frontend-only release
therefore does not restart the BFF or drop live SignalR connections.

The UI has a four-column shell (Inbox / Projects / Tasks / Details), an
activity dashboard, settings pages (password, API keys, users,
notifications, theme editor) and the login, invitation and password-reset
pages. Data comes from `/api/v1` through TanStack Query. Live updates arrive
over a SignalR subscription to `/hub`. The UI is available in English and
Russian.

## Stack

- React 18, TypeScript 5, Vite 5
- Mantine 7, Tabler icons
- TanStack Query 5 and TanStack Virtual, React Router 6
- `@microsoft/signalr` for live updates
- `markdown-it` + `shiki` + `dompurify` to render descriptions and comments
- i18next / react-i18next, `@dnd-kit/core`, `@zxcvbn-ts/*` for password
  strength
- Vitest + Testing Library + jsdom for unit tests, Playwright for e2e,
  StrykerJS for mutation testing
- nginx (`nginxinc/nginx-unprivileged`) at runtime

## Build and run

The usual way to run Skein is the umbrella workspace. Clone the services into
`skein/projects/` and start the local stack there, as described in the
umbrella [DEVELOPMENT.md](https://github.com/tryskein/skein/blob/main/DEVELOPMENT.md).

To work on the UI itself:

```bash
npm ci
npm run dev        # Vite dev server on http://localhost:5173
npm run build      # type-check, then bundle into dist/
npm run preview    # serve the built dist/
npm run typecheck  # tsc for the app and for the e2e specs
```

The dev server forwards `/api` and `/hub` to a running backend, by default
`http://localhost:8080`, the umbrella's local stack. Set
`VITE_PROXY_TARGET` to point it elsewhere.

The production image:

```bash
docker build --build-arg APP_VERSION=1.2.3 -t skein-frontend .
```

It listens on port 5102 and expects skein-web at `http://skein-web:8080` on
the same network. `APP_VERSION` is written to `/version.json`. The SPA polls
that file and offers a reload when a new version is deployed. Published
images are at `ghcr.io/tryskein/skein-frontend`.

## Configuration

The built SPA reads **no environment variables**. Deployment-specific values
are fetched once at startup from skein-web's `GET /api/auth/config`:

| Field | What the SPA does with it |
|---|---|
| `authMode` | selects the login page options (password form, SSO button, or both) |
| `logoutRedirectUrl` | the only absolute URL the app navigates to after logout. Without it, no absolute redirect is followed |
| `mcpUrl` | the URL in the `.mcp.json` snippet on the API keys page. Without it, same-origin `/mcp` is used |

These values are configured on skein-web. The dev-server variable and the
build and container settings are listed in
[`docs/env-reference.md`](docs/env-reference.md).

## Tests

```bash
npm test                 # unit tests (vitest)
npm run test:mutation    # mutation testing (StrykerJS), advisory
```

The end-to-end suite covers the whole product. It lives in `browser/e2e/` and
runs from the umbrella with `./scripts/e2e-test.sh`. Commands, narrowed runs
and prerequisites are in the [`## Testing`](CLAUDE.md#testing) section of
`CLAUDE.md`.

## Contributing

See the umbrella
[CONTRIBUTING.md](https://github.com/tryskein/skein/blob/main/CONTRIBUTING.md).

## License

Business Source License 1.1. See [`LICENSE`](LICENSE).

Report vulnerabilities as described in [SECURITY.md](https://github.com/tryskein/skein/blob/main/SECURITY.md). The Skein name and logo are covered by [TRADEMARKS.md](https://github.com/tryskein/skein/blob/main/TRADEMARKS.md).
