# Changelog

All notable changes to **skein-frontend** (React 19 + Vite + TypeScript + Mantine 7 SPA).

## [2.1.0] - 2026-11-24

- Push notifications belong to the person who turned them on: no silent
  subscription on sign-in, and logging out turns push off for this device
  (sk-984.2).
- Clearer push messages in settings and the banner, and the missing Russian
  translations (sk-984.2.6.4).
- The Inbox counter updates right after you accept an issue (sk-1060).
- Password forms ask for at least 12 characters (sk-977.7.20).
- The email about a new API key comes in your language (sk-977.7.49).

### Upgrade notes

- Requires skein-api 2.1.0 (sk-984.2).

## [2.0.0] - 2026-11-22

- API keys page. A key gets explicit permissions (`read`, `write` or `manage`,
  or `admin`), a scope (all projects you see, chosen projects or chosen
  spaces, with a searchable picker) and a lifetime (the default or a date
  within the instance maximum). A key can be narrowed in place and reissued
  with a new secret; the page shows its status (active, expired, revoked),
  when it was last used and permissions its owner no longer holds. A block
  shows whether the public REST API is enabled and where its address and
  OpenAPI document are (sk-878.3.1).
- Issues and comments written with an API key are shown with the origin
  "API". The origin filter of the Tasks column, search and the comment thread
  filter can select it; the "human-driven" group and the "Humans" chip include
  it (sk-878.3.1).
- Signing out, a `401` or a change of the signed-in person drops the data
  cached in the tab, so the next person in the same tab never sees the
  previous person's data (sk-977.7.17).
- The SignalR connection token of `/hub?id=` is masked in the nginx access log
  and kept out of the error log (sk-977.7.84, sk-977.7.123).
- nginx sends `X-Forwarded-Host` equal to the host it answered for and drops a
  client's `Forwarded` header, so skein-web takes the request host from nginx,
  not from the client (sk-977.7.83).
- New response headers `Permissions-Policy` (camera, microphone, geolocation
  and payment off) and `Cross-Origin-Opener-Policy: same-origin`; the nginx
  version is no longer shown (sk-977.7.80, sk-977.7.82).
- `theme-boot.js` and the favicons are revalidated instead of being cached for
  a year, so a changed theme script reaches every browser (sk-977.7.81).
- A commit hash links out only when its address is an absolute http(s) URL.
  Links without a scheme in notes (`example.com/path`, `www.example.com`) stay
  links (sk-977.7.75, sk-976.3).
- The image declares a healthcheck on `/healthz`, no longer ships source maps,
  is built on Node 26 and nginx 1.30 and installs dependencies without install
  scripts. The UI runs on React 19 (sk-976.3, sk-977.7.78, sk-977.7.88,
  sk-977.7.89).

### Upgrade notes

- Needs skein-api 2.0.0 and skein-web 2.0.0; upgrade all three together. With
  skein-api 1.x the API keys page does not work, and skein-frontend 1.x cannot
  create keys with skein-api 2.0.0.
- If you keep your own copy of `nginx.conf`, carry over the new
  `X-Forwarded-Host` and `Forwarded ""` lines of every proxy block.

## [1.1.0] - 2026-11-09

- The Tasks column no longer jumps while you read it. Live changes that can be
  applied in place still are; anything else is held, and an "Updates
  available" button shows the fresh list from the top in one step. This works
  in the list, tree and grouped views, keeps your place when you switch between
  them, and tells you if the update failed so you can retry (sk-763).
- Search in the Tasks column keeps the active filters and the Delegated mode:
  the server applies them before ranking, so results and further pages match
  what the column shows. A search continuation that has expired starts again
  from a fresh first page instead of failing (sk-346).
- The podium on the Activity page shows complete statistics and breaks ties on
  everyone's real number of closed tasks, also for people beyond the first 50
  rows of the activity matrix (sk-192).
- Code blocks in Markdown follow the active theme, including dark and custom
  themes, instead of always using light colours (sk-278).

### Upgrade notes

- Scoped search and the complete podium statistics need skein-api 1.1.0. With
  skein-api 1.0.0, search ignores the new filters and the podium falls back to
  the first 50 rows of the activity matrix.

## [1.0.0] - 2026-10-23

- First public release.
