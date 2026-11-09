# Changelog

All notable changes to **skein-frontend** (React 18 + Vite + TypeScript + Mantine 7 SPA).

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
