/**
 * Theme runtime — DOM side-effect helpers shared between `useTheme` and
 * the SignalR live-event listener (sk-10.3).
 *
 * Why a separate module?
 *
 *   `useTheme.ts` owned `applyVariables` / `stripAppliedVariables` /
 *   `setDataTheme` / `applyActive` as file-private functions. The
 *   SignalR `theme.preview` / `theme.updated` / `theme.user-pref.updated`
 *   listeners live in `useLiveEvents.tsx` (one HubConnection per tab,
 *   mounted at the app root) and need to apply transient variables
 *   without round-tripping through React state. Lifting these helpers
 *   into a runtime module lets both consumers call them with identical
 *   semantics — no risk of two competing apply paths drifting apart.
 *
 *   The helpers are intentionally module-level (not hooks): they're pure
 *   side-effect on `document.documentElement.style`, idempotent, and
 *   safe to call from any callback. `appliedKeys` is a module-scoped
 *   Set so a strip from one caller cleans up applies from any other.
 */

import {
  DEFAULT_GOOGLE_FONT_WEIGHTS,
  findPreset,
  MONO_FONT_PRESETS,
  UI_FONT_PRESETS,
} from './themePresets';
import { ALL_TOKEN_KEYS } from './themeTokens';
import { LEGACY_TOKEN_KEYS } from './themeTokensLegacy';

/**
 * Track which keys were set via `setProperty` so a subsequent strip
 * removes only what we own — we never touch arbitrary inline styles
 * a different subsystem (or a browser extension) may have set.
 *
 * Module-scoped, intentionally shared across every caller of
 * `applyVariables`. A `theme.preview` SignalR event and a local
 * BroadcastChannel preview both feed into the same Set so a reset
 * cleans up the union of both sources.
 */
const appliedKeys = new Set<string>();

/**
 * Cache of Google-Fonts `<link>` elements injected into `<head>`, keyed
 * by family name. Lazy and idempotent: a second call for the same
 * family is a no-op so quickly toggling between presets doesn't churn
 * the DOM (or trigger a re-fetch — the browser HTTP cache handles
 * cross-tab reuse).
 *
 * We do NOT garbage-collect links when the variable changes back. Once
 * loaded, a font stays in `<head>` for the page's lifetime.
 */
const googleFontLinks = new Map<string, HTMLLinkElement>();

function ensureGoogleFont(
  family: string | null | undefined,
  weights: string = DEFAULT_GOOGLE_FONT_WEIGHTS,
): void {
  if (typeof document === 'undefined') return;
  if (!family) return;
  if (googleFontLinks.has(family)) return;
  const familyParam = encodeURIComponent(family).replace(/%20/g, '+');
  const url = `https://fonts.googleapis.com/css2?family=${familyParam}:wght@${weights}&display=swap`;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = url;
  link.setAttribute('data-skein-font', family);
  document.head.appendChild(link);
  googleFontLinks.set(family, link);
}

/**
 * Inspect the variables map for `--font-ui` and `--font-mono`; if either
 * value matches a preset that declares a `googleFamily`, ensure the
 * Google Fonts stylesheet is loaded.
 */
function ensureFontsForVariables(variables: Record<string, string>): void {
  const uiStack = variables['--font-ui'];
  if (uiStack) {
    const preset = findPreset(uiStack, UI_FONT_PRESETS);
    if (preset?.googleFamily) {
      ensureGoogleFont(preset.googleFamily, preset.googleWeights);
    }
  }
  const monoStack = variables['--font-mono'];
  if (monoStack) {
    const preset = findPreset(monoStack, MONO_FONT_PRESETS);
    if (preset?.googleFamily) {
      ensureGoogleFont(preset.googleFamily, preset.googleWeights);
    }
  }
}

/**
 * Apply a CSS-variable map to `:root` as inline styles. Tracks every
 * key it sets so a later `stripAppliedVariables` can remove them
 * cleanly. Triggers Google-Fonts injection when the map references a
 * known preset family.
 */
export function applyVariables(variables: Record<string, string>): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  for (const [key, value] of Object.entries(variables)) {
    root.style.setProperty(key, value);
    appliedKeys.add(key);
  }
  ensureFontsForVariables(variables);
}

/**
 * Remove every CSS variable we own from `:root`.
 *
 * Three passes, as designed (T014):
 * `appliedKeys ∪ ALL_TOKEN_KEYS ∪ LEGACY_TOKEN_KEYS`.
 *
 * ── Pass 1: the tracked set, which is what normally does the work ────
 *
 * `appliedKeys` records every key this module wrote through
 * `applyVariables`, whatever dictionary the name belongs to: a role of
 * the current registry, a role only the pre-redesign dictionary had, or
 * a name neither declares — a live preview hands this module an
 * arbitrary map, and the map is tracked key by key on the way in.
 * Iterating the tracked set is what makes INV-12 hold for all three at
 * once ("neither the old dictionary nor roles that are absent from the applied
 * theme") without consulting a dictionary at all.
 *
 * ── Passes 2 and 3: the net for a property nobody tracked ────────────
 *
 * The two name lists behind it catch a custom property that reached
 * `<html>` WITHOUT passing through `applyVariables` — i.e. a
 * `document.documentElement.style.setProperty` call somewhere else in
 * the shipped page. There IS such a writer now (see the reach of that
 * claim below), and these two lists are what removes what it left.
 *
 * The writer arrived exactly where this docblock predicted it would:
 * `public/theme-boot.js` writes to `<html>` before React exists, and
 * sk-285.7.2.48 asked it for the one thing left to ask — paint the
 * custom theme's own variables map before the first frame, so an
 * account on a custom theme stops starting on the built-in base. That
 * map is not in `appliedKeys`: the script runs before this module is
 * imported and cannot reach it. Passes 2 and 3 are therefore what
 * clears a boot-painted map on the first strip after mount, and the
 * boot script's own comment names them as the mechanism it relies on.
 *
 * They also cover the case those lists cannot: the boot cache holds an
 * ARBITRARY map (whatever the user's theme declared), so a key in
 * neither dictionary survives both name lists. It is bounded rather
 * than unbounded — the next `applyVariables` overwrites every key the
 * live theme declares, and a leftover can only be a role the previous
 * theme had and the current one does not, i.e. a stale value under a
 * name nothing reads.
 *
 * They also stay TOGETHER. Keeping the registry pass while dropping the
 * legacy one would leave the net covering the NEW dictionary and not
 * the old one, and INV-12 names the old dictionary first: an untracked
 * `--bg-base` (legacy-only) would outlive the strip while an untracked
 * registry role did not. The asymmetry is not hypothetical to test
 * either — `themeRuntime.test.ts` sets one key of each kind directly on
 * `<html>` and asserts one strip clears all three, so each pass has an
 * input on which it executes and removes something.
 *
 * ── The single-writer claim, and its exact reach ─────────────────────
 *
 * Checked rather than remembered (sk-285.7 T014, re-checked in the
 * review fix): `.style.setProperty` across `src/**` has two
 * hits outside comments — this module's, and `SkeinTooltip.tsx` writing
 * `--skein-tooltip-max-w` onto its own floating element, not onto
 * `<html>`. `useTheme.applyActive` touches the same `<html>` `style`
 * object, but for the standard `color-scheme` property, which it also
 * removes itself.
 *
 * ⚠ The reach of that grep is `src/**`; the BUNDLE is larger.
 * `public/theme-boot.js` is served raw, has no imports and is not part
 * of the bundle, so the check above never looked at it. As of this
 * writing (sk-285.7.2.48) it sets the `data-theme` and `data-width-mode`
 * attributes AND, on the custom-theme branch of its boot cache, the
 * theme's own custom properties plus `color-scheme` on `<html>` — so
 * the module is no longer the single writer of custom properties there,
 * and passes 2 and 3 have a real input rather than a hypothetical one.
 * `ThemeBootFirstFrame.test.ts` runs that branch and asserts the map
 * lands, so this sentence is pinned by a test rather than by a reading
 * of the file.
 */
export function stripAppliedVariables(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  for (const key of appliedKeys) root.style.removeProperty(key);
  for (const key of ALL_TOKEN_KEYS) root.style.removeProperty(key);
  for (const key of LEGACY_TOKEN_KEYS) root.style.removeProperty(key);
  appliedKeys.clear();
}

/** Type of the `data-theme` attribute on `:root`. */
export type DataThemeValue = 'light' | 'dark' | 'custom';

export function setDataTheme(theme: DataThemeValue): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', theme);
}

// ---------------- Auto-reset timer for `theme.preview` ---------------

/**
 * SignalR `theme.preview` is ephemeral — the contract is "apply, don't
 * persist, and revert if no follow-up event arrives within N minutes".
 * The brief specifies a 10-minute TTL. A single module-level timer is
 * enough: subsequent previews extend the TTL by replacing the timer;
 * a `theme.updated` or `theme.user-pref.updated` that re-applies the
 * active theme should clear the pending timer so we don't double-strip.
 */
let pendingResetTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Cancel any pending auto-reset timer. Idempotent — calling on an
 * already-cleared timer is a no-op.
 */
export function cancelAutoReset(): void {
  if (pendingResetTimer !== null) {
    clearTimeout(pendingResetTimer);
    pendingResetTimer = null;
  }
}

/**
 * Schedule `onReset` to run after `ms` milliseconds. Replaces any
 * existing pending timer (so a fresh preview extends the TTL instead of
 * stacking timeouts). The caller is responsible for what "reset"
 * means — typically re-applying the user's active theme via
 * `applyActiveResolver` exposed by `useTheme`.
 */
export function scheduleAutoReset(ms: number, onReset: () => void): void {
  cancelAutoReset();
  pendingResetTimer = setTimeout(() => {
    pendingResetTimer = null;
    try {
      onReset();
    } catch (err) {
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.warn('[themeRuntime] auto-reset handler failed', err);
      }
    }
  }, ms);
}
