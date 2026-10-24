/**
 * sk-551.8 — this browser's copy of the SERVER's left-panel layout
 * (`navLayout`), read synchronously by `useNavLayout` before the profile
 * answers (spec INV-10, SC-005, decision D7).
 *
 * The layout lives in the profile (`/api/v1/me/ui-prefs`), and the answer
 * arrives hundreds of milliseconds after the shell first renders. Without a
 * local copy a person in the sections layout would see every load start
 * with two columns side by side and then rebuild into one — a frame of
 * "Columns side by side" the spec forbids (SC-005). So the last value this
 * browser saw for a person is kept here. The layout hooks do not hold it
 * in state: until the profile arrives they DERIVE the value to draw from
 * it in a `useMemo` (`useNavLayout.ts#navLayoutBeforeProfile`), so the
 * first render already reads it, and the profile's own value replaces it
 * as soon as it is in the cache.
 *
 * ── What is borrowed from the density cache, and what is not ─────────
 *
 * Only the record `{v, userId, …}`, its reading with rejection, and its
 * removal on logout are the `densityBootCache.ts` pattern. The boot script
 * (`public/theme-boot.js`) and an attribute on `<html>` are deliberately
 * NOT part of it (plan P5): the layout is drawn by React, and the shell
 * mounts only after the session has resolved, so a synchronous read
 * during the render (the `useMemo` above) is already «before the first
 * frame» of the shell.
 *
 * ── Whose layout ─────────────────────────────────────────────────────
 *
 * The record names the user it belongs to. The reader, not this module,
 * decides whether to use it (INV-10): before the session is known — the
 * last value this browser stored; once it is known — only a record of
 * THIS person, otherwise "Columns side by side" until their profile arrives. A
 * record of another person is never written in their name: writers pass
 * the id of the session the value was confirmed for.
 *
 * ── Failure ──────────────────────────────────────────────────────────
 *
 * Every storage failure (private mode, quota, blocked site data) is
 * swallowed, and an unusable record reads as «none». A cache that cannot
 * be read or written costs one rebuild on the next load — never an
 * exception.
 */

import type { NavLayout } from '../api/uiPrefs';

/** localStorage key. */
export const NAV_LAYOUT_BOOT_CACHE_KEY = 'skein.navLayout.boot';

/** Schema version. A record from another version is ignored, not guessed at. */
export const NAV_LAYOUT_BOOT_CACHE_VERSION = 1;

export interface NavLayoutBootCache {
  v: typeof NAV_LAYOUT_BOOT_CACHE_VERSION;
  /** The user whose profile this layout came from. */
  userId: string;
  navLayout: NavLayout;
}

export function writeNavLayoutBootCache(userId: string, navLayout: NavLayout): void {
  const record: NavLayoutBootCache = { v: NAV_LAYOUT_BOOT_CACHE_VERSION, userId, navLayout };
  try {
    window.localStorage.setItem(NAV_LAYOUT_BOOT_CACHE_KEY, JSON.stringify(record));
  } catch {
    /* private mode / quota — the next load rebuilds once, as before */
  }
}

export function clearNavLayoutBootCache(): void {
  try {
    window.localStorage.removeItem(NAV_LAYOUT_BOOT_CACHE_KEY);
  } catch {
    /* nothing stored, nothing to clear */
  }
}

/**
 * The record, or `null` when there is none or it is unusable: unreadable
 * storage, broken JSON, another schema version, no user id, or a layout
 * other than exactly `columns` / `sections` (no case folding — the same
 * strictness as the server's word).
 */
export function readNavLayoutBootCache(): NavLayoutBootCache | null {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(NAV_LAYOUT_BOOT_CACHE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const c = parsed as Partial<NavLayoutBootCache>;
  if (c.v !== NAV_LAYOUT_BOOT_CACHE_VERSION) return null;
  if (typeof c.userId !== 'string' || c.userId === '') return null;
  if (c.navLayout !== 'columns' && c.navLayout !== 'sections') return null;
  return { v: NAV_LAYOUT_BOOT_CACHE_VERSION, userId: c.userId, navLayout: c.navLayout };
}
