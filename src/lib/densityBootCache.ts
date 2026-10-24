/**
 * sk-551.7 — the boot-readable mirror of the SERVER's density, the same
 * device `themeBootCache.ts` is for the theme (read its header for the
 * measured first-frame defect both exist to prevent).
 *
 * The density lives in the profile (`/api/v1/me/ui-prefs`), and the answer
 * arrives hundreds of milliseconds after the first frame. Without a local
 * copy a compact user would see every load start at the normal sizes and
 * then shrink — the whole page reflowing under them. So the last answer
 * this browser saw is kept here, `public/theme-boot.js` reads it before
 * React mounts and writes `<html data-density>`, and `DensitySync`
 * (`lib/useDensity.ts`) overrules it with the server on every load.
 *
 * ── Whose density ────────────────────────────────────────────────────
 *
 * The record names the user it belongs to. The boot script cannot check
 * that — it runs before anyone knows who is signed in — so it paints the
 * last signed-in person's density, which is the person who is back far
 * more often than not. The app checks it the moment the session is known:
 * another person's record is never used as their density, and the page
 * falls back to "Normal" until their own answer arrives. A logout drops
 * the record outright (`AuthContext`), as it does the theme's.
 *
 * ── Failure ──────────────────────────────────────────────────────────
 *
 * Every storage failure (private mode, quota, blocked site data) is
 * swallowed. A cache that cannot be read or written costs one reflow on
 * the next load — never an exception.
 */

import type { Density } from '../api/uiPrefs';

/** localStorage key. Duplicated in `public/theme-boot.js` (no imports there). */
export const DENSITY_BOOT_CACHE_KEY = 'skein.density.boot';

/** Schema version. A record from another version is ignored, not guessed at. */
export const DENSITY_BOOT_CACHE_VERSION = 1;

export interface DensityBootCache {
  v: typeof DENSITY_BOOT_CACHE_VERSION;
  /** The user whose profile this density came from. */
  userId: string;
  density: Density;
}

export function writeDensityBootCache(userId: string, density: Density): void {
  const record: DensityBootCache = { v: DENSITY_BOOT_CACHE_VERSION, userId, density };
  try {
    window.localStorage.setItem(DENSITY_BOOT_CACHE_KEY, JSON.stringify(record));
  } catch {
    /* private mode / quota — the next load reflows once, as before */
  }
}

export function clearDensityBootCache(): void {
  try {
    window.localStorage.removeItem(DENSITY_BOOT_CACHE_KEY);
  } catch {
    /* nothing stored, nothing to clear */
  }
}

/** The record, or `null` when there is none or it is unusable. */
export function readDensityBootCache(): DensityBootCache | null {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(DENSITY_BOOT_CACHE_KEY);
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
  const c = parsed as Partial<DensityBootCache>;
  if (c.v !== DENSITY_BOOT_CACHE_VERSION) return null;
  if (typeof c.userId !== 'string' || c.userId === '') return null;
  if (c.density !== 'normal' && c.density !== 'compact') return null;
  return { v: DENSITY_BOOT_CACHE_VERSION, userId: c.userId, density: c.density };
}
