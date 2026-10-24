/**
 * sk-285.7.2.48 — the boot-readable mirror of the SERVER's theme
 * preference.
 *
 * ── The measurement this module exists to answer ─────────────────────
 *
 * Live Chromium, `http://host.docker.internal:5173/`, account theme
 * `dark`, OS `light`, no `skein.theme` in `localStorage`:
 *
 *     24.2ms  data-theme="light"   ← theme-boot.js
 *    244.0ms  first-paint          light  (rgb(246,244,241))
 *    276.0ms  first-contentful-paint  still light
 *    301.2ms  data-theme="dark"    ← /me/theme finally resolved
 *
 * With `skein.theme=dark` present the same load paints dark at 21.4ms
 * and never repaints; with the OS itself dark, likewise. So the boot
 * script runs, and runs early — it reads the wrong source. Its priority
 * order was `localStorage['skein.theme']` → `prefers-color-scheme` →
 * `light`, and the actual source of truth after login — the server —
 * appears in none of them. `useTheme` deliberately does NOT write the
 * resolved theme into `skein.theme` (see the note beside the
 * DOM-reconciliation effect there): that key means «the user picked
 * this, in this browser», and it gates the OS-preference tracker.
 * Writing the server's answer into it would freeze that tracker for
 * everyone who never picked anything.
 *
 * Hence a SECOND key, carrying a different assertion: «this is what the
 * server last said, already resolved». The boot script reads it, paints
 * the first frame from it, and `skein.theme` keeps meaning what it
 * meant.
 *
 * ── Why the whole record and not just light/dark ─────────────────────
 *
 * Two states have to survive a reload, and each decides a different
 * first frame:
 *
 *   - a built-in pick — paint `builtin`;
 *   - a custom theme — the variables map itself, or the first frame
 *     shows the built-in base under a custom-theme user and repaints
 *     the moment `/me/theme` and `/themes/:id` land.
 *
 * ── The stale-cache question, answered rather than avoided ───────────
 *
 * The cache can be wrong: the user changed the theme on another device
 * since this browser last loaded. Then the first frame is their PREVIOUS
 * theme and React corrects it exactly where it corrects everything else
 * today. That is strictly the current behaviour's failure mode, made
 * rarer — never a new one. It is not a second source of truth: nothing
 * ever READS this cache except the boot script, and the boot script is
 * overruled by the server response on every load.
 */

import type { BuiltinTheme } from './useTheme';

/**
 * localStorage key. Deliberately NOT `skein.theme` — see the header:
 * that key is the «user picked it here» signal and gates the OS tracker.
 */
export const THEME_BOOT_CACHE_KEY = 'skein.theme.boot';

/** Schema version. A record from a future version is ignored, not guessed at. */
export const THEME_BOOT_CACHE_VERSION = 1;

export interface ThemeBootCache {
  v: typeof THEME_BOOT_CACHE_VERSION;
  mode: 'builtin' | 'custom';
  /** The built-in palette the server last stored. */
  builtin: BuiltinTheme;
  /** Present only for mode='custom': the map to paint before React mounts. */
  vars?: Record<string, string>;
  /** Present only for mode='custom': the custom theme's own base, for `color-scheme`. */
  base?: BuiltinTheme;
}

/**
 * Write the record the boot script will read on the next load.
 *
 * Swallows every storage failure: private mode, a full quota, a browser
 * with site data blocked. A cache that cannot be written costs one
 * repaint on the next load — the behaviour that shipped before this
 * module — and must never cost the caller an exception mid-render.
 */
export function writeThemeBootCache(cache: ThemeBootCache): void {
  try {
    window.localStorage.setItem(THEME_BOOT_CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* private mode / quota — the next load simply repaints as before */
  }
}

/**
 * Drop the record. Called on logout: the next person at this browser is
 * not necessarily the last one, and painting the previous session's
 * theme on the login screen would be asserting something we no longer
 * know.
 */
export function clearThemeBootCache(): void {
  try {
    window.localStorage.removeItem(THEME_BOOT_CACHE_KEY);
  } catch {
    /* nothing stored, nothing to clear */
  }
}

/**
 * Read the record back, or `null` when there is none / it is unusable.
 *
 * The app itself does not consume this — the boot script does, in its
 * own duplicated parse (it is served raw and cannot import). This reader
 * exists so the guard can state the two sides agree, the same way
 * `BootWidthMode.test.ts` pins the boot script's thresholds to the
 * module's.
 */
export function readThemeBootCache(): ThemeBootCache | null {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(THEME_BOOT_CACHE_KEY);
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
  const c = parsed as Partial<ThemeBootCache>;
  if (c.v !== THEME_BOOT_CACHE_VERSION) return null;
  if (c.mode !== 'builtin' && c.mode !== 'custom') return null;
  if (c.builtin !== 'light' && c.builtin !== 'dark') return null;
  return {
    v: THEME_BOOT_CACHE_VERSION,
    mode: c.mode,
    builtin: c.builtin,
    ...(c.vars && typeof c.vars === 'object' ? { vars: c.vars } : {}),
    ...(c.base === 'light' || c.base === 'dark' ? { base: c.base } : {}),
  };
}
