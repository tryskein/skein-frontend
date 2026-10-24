import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { ApiError, UnauthorizedError } from '../api/client';
import {
  ME_THEME_QUERY_KEY,
  THEME_PREVIEW_CHANNEL,
  themeQueryKey,
  getMeTheme,
  getTheme,
  setMeTheme,
  Theme as ApiTheme,
  UserThemePref,
} from '../api/themes';
import { updateTheme } from '../api/themes';
import { useTranslation } from 'react-i18next';
import { useToaster } from '../components/Toaster';
import { useAuthOptional } from '../auth/AuthContext';
import { migrateThemeVariables, needsMigration } from './themeMigration';
import { selectorsForSection } from './themeTokens';
import {
  applyVariables,
  setDataTheme,
  stripAppliedVariables,
} from './themeRuntime';
import { clearThemeBootCache, readThemeBootCache, writeThemeBootCache } from './themeBootCache';

/**
 * Theme management — server-backed (sk-10).
 *
 * Mode model:
 *   - builtin: active theme is the in-CSS Solarized Light or Dark. NO
 *     inline CSS variables on `:root` — the cascade picks them up from
 *     `[data-theme="light"]` / `[data-theme="dark"]` rules in index.css.
 *   - custom:  active theme is a row in /api/v1/themes. Every entry in
 *     `theme.variables` is applied via `document.documentElement.style
 *     .setProperty(key, value)`, then `data-theme="custom"`. If the
 *     active theme was deleted (customThemeId === null from server), we
 *     fall back to `builtinTheme`.
 *
 * Source of truth:
 *   - Server: GET /api/v1/me/theme (TanStack Query cache).
 *   - localStorage 'skein.theme' is retained ONLY for the unauthenticated
 *     boot flow (login page) and prefers-color-scheme drift. Authenticated
 *     pages always reconcile to the server response on mount; mutating
 *     actions PUT to the server first, then update the cache. The legacy
 *     `theme-boot.js` keeps writing data-theme before React mounts to
 *     avoid FOUC.
 *
 * BroadcastChannel preview (sk-10):
 *   When the user is in the editor (another tab), a 'preview' message
 *   carrying a variables map applies that map inline to `:root` and sets
 *   `data-theme="custom"`. On 'reset' (editor closed), we strip everything
 *   the preview applied AND re-apply the current active theme.
 */

export type BuiltinTheme = 'light' | 'dark';

/** Legacy alias — old `useTheme` returned a `Theme = 'light' | 'dark'`
 *  type that's now refined as `BuiltinTheme`. Re-exported so callers
 *  (and tests) that still import `Theme` from this module compile. */
export type Theme = BuiltinTheme;

const STORAGE_KEY = 'skein.theme';

/**
 * sk-389 (self-review W-3) — the mutation scope every write to
 * `/me/theme` shares, so TanStack runs them in CLICK order. Rationale
 * at the `scope:` line of `putMutation`; a constant so a second call
 * site cannot join the queue by accident or miss it by typo.
 */
const ME_THEME_MUTATION_SCOPE = 'me-theme';

/**
 * sk-389 (self-review W-3) — the state a chain of overlapping theme
 * writes must fall back to, and the bookkeeping that keeps it.
 *
 * MODULE-level rather than a `useRef`, deliberately: the mutation
 * `scope` above is global to the QueryClient, so two mounted
 * `useTheme()` instances share ONE queue of PUTs. Per-instance
 * bookkeeping would give that one queue two disagreeing baselines.
 *
 *   - `inFlight`  how many writes are between `onMutate` and
 *                 `onSettled`. A chain is the span where this is > 0.
 *   - `started`   monotonic id of the newest write; an older
 *                 acceptance compares against it and declines to
 *                 paint.
 *   - `confirmed` the newest state the SERVER confirmed: captured
 *                 from the client when a chain opens (nothing is
 *                 optimistic yet, so what is on screen is what the
 *                 server last said), then advanced by each acceptance.
 *
 * `pref: undefined` is a real value — the theme query has not resolved
 * — and is distinct from «light». `stored: null` likewise means «this
 * person has never picked in this browser», which is what gates the
 * OS-preference tracker.
 */
const themeWriteChain: {
  inFlight: number;
  started: number;
  confirmed: { pref: UserThemePref | undefined; stored: BuiltinTheme | null };
} = {
  inFlight: 0,
  started: 0,
  confirmed: { pref: undefined, stored: null },
};

/** Open (or join) a chain. Returns this write's id. */
function beginThemeWrite(queryClient: QueryClient): number {
  if (themeWriteChain.inFlight === 0) {
    themeWriteChain.confirmed = {
      pref: queryClient.getQueryData<UserThemePref>(ME_THEME_QUERY_KEY),
      stored: readStoredBuiltin(),
    };
  }
  themeWriteChain.inFlight += 1;
  themeWriteChain.started += 1;
  return themeWriteChain.started;
}

/** The server took this write: it is the new fallback for the chain. */
function confirmThemeWrite(server: UserThemePref, pickedHere: BuiltinTheme | null): void {
  themeWriteChain.confirmed = {
    pref: server,
    // A write that carried no `pickedHere` (the custom-theme path)
    // leaves the key alone, so the record of it must not move either.
    stored: pickedHere ?? themeWriteChain.confirmed.stored,
  };
}

/**
 * Close one write. When the chain drains, put both surfaces back onto
 * the newest confirmed state — unconditionally, because when the last
 * write was accepted that IS the state and the call is a no-op.
 */
function endThemeWrite(queryClient: QueryClient): void {
  themeWriteChain.inFlight -= 1;
  if (themeWriteChain.inFlight > 0) return;
  themeWriteChain.inFlight = 0;
  const { pref, stored } = themeWriteChain.confirmed;
  if (pref) queryClient.setQueryData<UserThemePref>(ME_THEME_QUERY_KEY, pref);
  restoreStoredBuiltin(stored);
}

/** Active theme as seen by consumers. */
export interface ActiveTheme {
  mode: 'builtin' | 'custom';
  builtinTheme: BuiltinTheme;
  customThemeId: string | null;
  /** Loaded only when mode='custom' AND customThemeId is set. */
  customTheme: ApiTheme | null;
}

/**
 * What one PUT to `/me/theme` is asked to do (sk-389).
 *
 * Two fields because the write has two halves and only the CALL SITE
 * knows whether the second one applies. `next` is the row to store;
 * `pickedHere` additionally records «the human at this browser chose
 * this colour» in `skein.theme` — the key that gates the OS-preference
 * tracker and that the boot script falls back to. Picking a palette is
 * such a gesture; leaving a custom theme, or having one deleted out
 * from under you, is not, and conflating them would freeze the tracker
 * for users who never chose anything.
 */
interface ThemeWrite {
  next: UserThemePref;
  pickedHere?: BuiltinTheme;
}

export interface UseThemeApi {
  /** Effective dark/light state — `dark` iff (mode='custom' AND base='dark') OR (mode='builtin' AND builtinTheme='dark'). */
  theme: BuiltinTheme;
  /** Active theme detail (mode + builtin + custom). */
  active: ActiveTheme;
  /** True until the initial /me/theme fetch resolves. */
  isLoading: boolean;
  /** Toggle the BUILT-IN theme. Also exits 'custom' mode if it was on. */
  toggle: () => void;
  /** Switch to a specific built-in. Also exits 'custom' mode. */
  setBuiltin: (theme: BuiltinTheme) => void;
  /** Backward-compat alias for `setBuiltin` — keeps old callers and
   *  unit tests that pre-date the server-backed refactor compiling. */
  setTheme: (theme: BuiltinTheme) => void;
  /** Switch to a saved custom theme by id. */
  setCustomTheme: (id: string) => void;
  /** Drop custom selection and return to the current built-in. */
  clearCustom: () => void;
}

function readStoredBuiltin(): BuiltinTheme | null {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch {
    /* SSR / private mode — ignore */
  }
  return null;
}

function readOSPreference(): BuiltinTheme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function readCurrentBuiltin(): BuiltinTheme {
  if (typeof document !== 'undefined') {
    const attr = document.documentElement.getAttribute('data-theme');
    if (attr === 'light' || attr === 'dark') return attr;
  }
  return readStoredBuiltin() ?? readOSPreference();
}

// `applyVariables`, `stripAppliedVariables`, `setDataTheme` are imported
// from `./themeRuntime` so the SignalR live-event listener
// (`useLiveEvents.tsx`) can share the same DOM-side-effect implementation
// without re-implementing the same logic against a different `appliedKeys`
// Set. Behaviour is unchanged — see themeRuntime.ts for the docstring.

/**
 * Apply the resolved active theme to the DOM. Pure side-effect — does
 * not write to React state. Idempotent.
 *
 * Also drives `html.style.colorScheme` so native form-controls + browser
 * scrollbar chrome match the custom theme's base. Without this, a user
 * on a dark-base custom theme sees light-mode `<input type=color>`
 * widget chrome on a dark canvas (the cascade falls through to `:root`
 * `color-scheme: light` because `[data-theme='custom']` doesn't declare
 * one in index.css).
 */
function applyActive(active: ActiveTheme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (active.mode === 'custom' && active.customTheme) {
    // INV-12 (sk-285.7 T014) — clear FIRST, paint second.
    //
    // Applying a map only overwrites the keys that map contains, so
    // anything the document was already carrying under a key the new
    // theme does not declare survives the switch and keeps painting.
    // That is reachable, and by one route rather than by imagination:
    // a live preview. `theme.preview` over SignalR
    // (`useLiveEvents.tsx`) and the editor's BroadcastChannel message
    // (below in this file) both hand `applyVariables` an ARBITRARY map
    // — the editor's own draft, a role set from another build — and
    // every re-apply of the active theme that follows (the preview's
    // 10-minute auto-revert, a `theme.updated`, the user picking
    // another saved theme) comes through here. Without the strip the
    // preview's keys outlive the preview.
    //
    // Two saved themes cannot leave residue in each OTHER by that
    // route, and it is worth saying why rather than leaving it to be
    // rediscovered: `migrateThemeVariables` builds its output from
    // `ALL_TOKENS`, so every migrated theme carries exactly the new
    // dictionary and the second apply overwrites the first key for
    // key. The strip is what keeps that from being the ONLY reason the
    // invariant holds — it stops depending on a property of a
    // different module.
    stripAppliedVariables();
    // Apply custom variables, then mark data-theme so colour-scheme +
    // legacy.css mappings react. The cascade falls back to the built-in
    // base for any token the custom theme didn't override.
    setDataTheme(active.builtinTheme);
    applyVariables(active.customTheme.variables);
    setDataTheme('custom');
    root.style.colorScheme = active.customTheme.base;
    return;
  }
  // builtin OR (mode=custom with null/missing customThemeId): strip
  // inline overrides and let index.css's [data-theme] rules win.
  stripAppliedVariables();
  setDataTheme(active.builtinTheme);
  // Clear inline colorScheme so the cascade from index.css's :root /
  // [data-theme='dark'] rules takes over.
  root.style.removeProperty('color-scheme');
}

/**
 * Module-level "currently-resolved active theme" snapshot. Written by
 * the `useTheme` effect that already reconciles DOM state on every
 * change, read by `useLiveEvents.tsx` so the SignalR theme.preview
 * auto-reset and theme.user-pref.updated handlers can re-apply the
 * active theme without going through React state.
 *
 * Default seeds from the `data-theme` attribute the boot script painted
 * on <html> before React mounted — that way an early `theme.preview`
 * arriving before any `useTheme` mount falls back to the boot-script's
 * actual paint state (dark or light) instead of an arbitrary 'light'
 * default. The first `useTheme` mount overwrites it with the resolved
 * /me/theme + custom-theme map.
 */
function readBootBuiltin(): BuiltinTheme {
  if (typeof document === 'undefined') return 'light';
  const attr = document.documentElement.getAttribute('data-theme');
  return attr === 'dark' ? 'dark' : 'light';
}

let lastActiveSnapshot: ActiveTheme = {
  mode: 'builtin',
  builtinTheme: readBootBuiltin(),
  customThemeId: null,
  customTheme: null,
};

/**
 * Re-apply whatever the most recently resolved active theme was. Used
 * by the SignalR theme.preview TTL (auto-revert after 10 min if no
 * `theme.updated` lands) and by the theme.user-pref.updated handler
 * (after refetching /me/theme, the cache observer in the next render
 * cycle will call `applyActive` again — this is the immediate-revert
 * fallback for tabs that don't have `useTheme` mounted).
 */
export function reapplyActiveTheme(): void {
  applyActive(lastActiveSnapshot);
}

function writeStoredBuiltin(theme: BuiltinTheme): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* private mode / quota — ignore */
  }
}

/**
 * Put `skein.theme` back to what it held before an optimistic write
 * (sk-389).
 *
 * `null` is a value here, not a missing one: «nothing stored» is what
 * gates the OS-preference tracker and what `bootstrapPref()` reads, so
 * a rollback that left the key present with some plausible colour would
 * silently convert a user who had never picked a theme into one who
 * had. Removing is therefore the correct restore, not a shortcut.
 */
function restoreStoredBuiltin(previous: BuiltinTheme | null): void {
  try {
    if (previous === null) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, previous);
  } catch {
    /* private mode / quota — nothing was written either, so nothing to undo */
  }
}

/**
 * Fallback `me/theme` value used when the API is unreachable or the
 * user is not authenticated. Mirrors what the backend returns for a
 * fresh user, with one tweak: builtinTheme follows the OS preference on
 * first paint so the unauthenticated login screen doesn't flash light
 * when the user's OS is dark.
 */
function bootstrapPref(): UserThemePref {
  const stored = readStoredBuiltin();
  const builtinTheme = stored ?? readOSPreference();
  return {
    mode: 'builtin',
    builtinTheme,
    customThemeId: null,
  } satisfies UserThemePref;
}

/**
 * What to paint from while `/me/theme` is still in flight
 * (sk-285.7.2.48).
 *
 * MEASURED, on the fix as first written, in a SIGNED-IN shell: the boot
 * script painted the first frame `dark` at 28.8ms for an account on dark
 * under a light OS — and React then repainted it `light` at 351.0ms and
 * back to `dark` at 368.1ms, putting first-contentful-paint (364.0ms) in
 * the WRONG theme. The mount does not wait for the response, and
 * `bootstrapPref()` is a guess from the OS: so the flash simply moved
 * from before the first frame to just after it, and on a cold server it
 * lasts exactly as long as the request does — the ~2s two auditors
 * reported. With the record as the placeholder the same load measures
 * 32.8ms dark, first-paint 404.0ms dark, first-contentful-paint 424.0ms
 * dark, and no light frame at all.
 *
 * The record the boot script painted from is the better placeholder for
 * that window, because it is the same answer: it is what the server last
 * said, already resolved, and using anything else means React
 * contradicting the frame the browser is showing.
 *
 * `null` when there is no record — first visit, the login screen, a
 * cleared cache after logout — and the caller falls back to the guess.
 */
function bootCachePref(): UserThemePref | null {
  const cached = readThemeBootCache();
  if (!cached) return null;
  // Deliberately not `mode: 'custom'`: the record carries the variables
  // map but NOT the theme's id, and claiming a custom mode without one
  // would make the hook fetch nothing and report a custom theme it does
  // not have. The base is the tone the boot script's palette was built
  // on, which is the closest true statement available for this window.
  return {
    mode: 'builtin',
    builtinTheme: cached.mode === 'custom' ? (cached.base ?? cached.builtin) : cached.builtin,
    customThemeId: null,
  } satisfies UserThemePref;
}

/**
 * Runtime narrowing for messages received on the preview BroadcastChannel.
 * `MessageEvent.data` is `any` at the type level — any same-origin tab
 * (or a stale extension) can post arbitrary shapes, so we validate before
 * piping values into `setProperty`. Without this, a `{ type: 'preview',
 * variables: { '--bg': {} } }` payload would silently coerce to
 * `setProperty('--bg', '[object Object]')`.
 *
 * sk-10.3 — Designer-style highlight: the editor sidebar publishes
 * `{type: 'highlight-section', section}` when a tab is hovered/active,
 * and the row hover publishes `{type: 'highlight-tokens', selectors}`
 * to override with per-token selectors. We mutate a single `<style>`
 * element in `<head>` so the outline is purely cosmetic — it never
 * touches the existing inline preview variables.
 */
type PreviewMessage =
  | { type: 'preview'; variables: Record<string, string> }
  | { type: 'reset' }
  | { type: 'highlight-section'; section: string | null }
  | { type: 'highlight-tokens'; selectors: string[] };

function parsePreviewMessage(d: unknown): PreviewMessage | null {
  if (!d || typeof d !== 'object') return null;
  const m = d as Record<string, unknown>;
  if (m.type === 'reset') return { type: 'reset' };
  if (m.type === 'highlight-section') {
    const s = m.section;
    if (s === null || typeof s === 'string') {
      return { type: 'highlight-section', section: s };
    }
    return null;
  }
  if (m.type === 'highlight-tokens') {
    const sel = m.selectors;
    if (!Array.isArray(sel)) return null;
    // Empty selector arrays are meaningless — drop the message rather
    // than apply an "all rules off" rule that the consumer would have
    // to special-case.
    if (sel.length === 0) return null;
    for (const v of sel) {
      if (typeof v !== 'string' || v.length === 0) return null;
    }
    return { type: 'highlight-tokens', selectors: sel as string[] };
  }
  if (m.type !== 'preview') return null;
  const vars = m.variables;
  if (!vars || typeof vars !== 'object') return null;
  for (const v of Object.values(vars as Record<string, unknown>)) {
    if (typeof v !== 'string') return null;
  }
  return { type: 'preview', variables: vars as Record<string, string> };
}

/**
 * Mutate a single `<style id="skein-theme-highlight">` element in
 * `<head>`. Idempotent: same input → same `textContent`. Passing
 * `null`/empty list clears the rule but keeps the element around so
 * subsequent messages don't churn the DOM.
 *
 * The outline is intentionally THINNER than in the visual design tool
 * this pattern was borrowed from (1px / -1px instead of 2px / -2px) —
 * Skein chrome is dense and a thicker ring covers too much of the
 * underlying control. Colour `#E53935` matches that tool's red so the
 * visual language is shared.
 */
const HIGHLIGHT_STYLE_ID = 'skein-theme-highlight';

function ensureHighlightStyle(): HTMLStyleElement | null {
  if (typeof document === 'undefined') return null;
  let el = document.getElementById(HIGHLIGHT_STYLE_ID);
  if (el instanceof HTMLStyleElement) return el;
  el = document.createElement('style');
  el.id = HIGHLIGHT_STYLE_ID;
  document.head.appendChild(el);
  return el as HTMLStyleElement;
}

function applyHighlight(selectors: string[] | null): void {
  const el = ensureHighlightStyle();
  if (!el) return;
  if (!selectors || selectors.length === 0) {
    if (el.textContent !== '') el.textContent = '';
    return;
  }
  // Deterministic concatenation — sort by string so the same set of
  // selectors regardless of input order produces identical CSS text.
  const sorted = [...selectors].sort();
  const next = `${sorted.join(', ')} { outline: 1px solid #E53935 !important; outline-offset: -1px !important; position: relative !important; z-index: 1 !important; }`;
  if (el.textContent !== next) el.textContent = next;
}

function clearHighlight(): void {
  applyHighlight(null);
}

/* ══════════ T013 — writing the migrated snapshot back, ONCE ═══════════ */

/**
 * Theme ids this TAB has already attempted the one-time write-back for.
 *
 * Module-scoped rather than a ref, and that is the whole mechanism.
 * `useTheme` is mounted three times over in a live shell — `ThemeSync`
 * at the app root, `ThemeToggle` in the account menu, the Activity
 * dashboard — and each mount resolves the same row, so a per-hook guard
 * would fire the PATCH once per mount. A module-level Set is shared by
 * every mount in the tab and survives remounting, which is what "one
 * write per theme" has to mean on the client.
 *
 * An id is added BEFORE the request goes out, not after it succeeds: a
 * second mount during the in-flight PATCH must see the claim, or two
 * requests race. It is never removed, so a failed write is not retried
 * for the life of the page — deliberate, and the cheaper of the two
 * mistakes. Retrying would put a hook whose effect re-runs on every
 * resolved row into a loop against a server that is already refusing;
 * not retrying costs one page load, after which the next visit tries
 * again from a clean module scope.
 *
 * ── Several tabs ────────────────────────────────────────────────────
 *
 * The Set is per tab, so N tabs opened on a stale theme send N PATCHes —
 * one each, and nothing on the client or the server suppresses the
 * later ones. The invariant survives that, because it is about the
 * STORED ROW rather than about the request count: the payload is
 * `migrateThemeVariables(row)`, a pure function of the row, so tabs that
 * fetched the same row carry byte-identical variables and every write
 * after the first is a no-op in content — "an interruption does not leave the theme
 * half-switched" holds whichever order they land in.
 * `useTheme.writeback.test.ts` pins that equality («the payload two tabs
 * would send is byte-identical»); it is the single leg this paragraph
 * stands on.
 *
 * It used to claim a second leg — that the first write emits
 * `theme.updated`, which `useLiveEvents.tsx` merges into the theme
 * cache, so a tab that has not written yet re-reads a row
 * `needsMigration` rejects. That is FALSE against the API as it stands:
 * `PublishThemeUpdated` has exactly one caller in `skein-api`
 * (`internal/mcp/tools/theme_set_variables.go`), and the REST handler
 * this path uses — `PATCH /api/v1/themes/{id}`,
 * `internal/handler/themes.go` — publishes nothing at all. No event
 * leaves the write, so no other tab learns anything, and each one sends
 * its own PATCH.
 *
 * Making the REST path publish stays UNDONE, deliberately. sk-285.7.5
 * weighed it and declined: it would not have fixed anything (the
 * byte-identical payload is what makes several writes safe, and that
 * holds with or without an event), and it would move every open editor's
 * source row under it mid-draft. What that issue did instead is remove
 * the OTHER writer's ability to re-arm this one — the MCP boundary now
 * refuses a variables patch naming a role the current dictionary does not
 * declare (`unknown_theme_role`), so a row that has been migrated cannot
 * be pushed back into `needsMigration` by an agent. See
 * `internal/themes/roles.go` in skein-api, and
 * `useTheme.agentWrite.test.ts` beside this file for what the loss looked
 * like before that.
 *
 * ── The write is one-way, and that is a recorded decision ────────────
 *
 * There is no `variables_version` on the row, no "migrated" marker, and
 * no snapshot of the map as it was. `updated_by` / `updated_at` move
 * exactly as they would for an edit the user made by hand, so the audit
 * trail cannot tell the two apart, and no event carries the old map
 * either (see above). A user's pre-redesign values therefore exist
 * nowhere after this PATCH: `themeTokensLegacy.ts` froze the DEFAULTS,
 * not anybody's settings.
 *
 * sk-285.7.5 considered adding a marker and chose not to. The marker's
 * appeal was that it would decouple `needsMigration` from the map's
 * contents — but the thing that was re-arming it was an agent writing a
 * name that paints nothing, and keeping such a name in the row makes that
 * silent no-op PERMANENT instead of transient. The boundary refusal
 * removes the cause; a marker would have preserved the symptom and added
 * a schema column, a DTO field and a second definition of "migrated" to
 * keep in step. The absence of a rollback is accepted as the price, and
 * it is written down here rather than left to be discovered: if a
 * migration turns out to be wrong, the affected users re-set the roles in
 * the editor, because there is nothing to restore from.
 */
const migrationWriteAttempted = new Set<string>();

/**
 * TEST SEAM — forget the tab's write-back claims. Ships in the
 * production bundle, and that is a deliberate choice rather than an
 * oversight, so it is labelled instead of hidden.
 *
 * WHY IT CANNOT JUST GO. The Set above is module state by design (that
 * is the whole mechanism — see its docblock), and module state outlives
 * a test. The suite's alternative is `vi.resetModules()` plus a dynamic
 * `import()` per test, which re-instantiates EVERY module-level binding
 * in this file and in everything it pulls in — the query keys the
 * fixtures compare against, the mocked API module, the React Query
 * imports the harness shares. That is a large change to
 * `useTheme.writeback.test.ts` with a new failure mode (two copies of a
 * module in one run), bought for the deletion of a three-line function.
 *
 * WHY SHIPPING IT IS HARMLESS. It clears a Set that every page load
 * starts empty. The worst a caller can do — and there is no caller — is
 * permit one additional PATCH of a payload that is byte-identical to the
 * one already sent. It reads nothing, exposes nothing and cannot leave
 * the theme half-written; that is what makes it safe to leave in, and it
 * is why the seam is this function and not, say, an exported setter for
 * the Set itself.
 *
 * The `__` prefix is the marker: nothing outside `src/lib/__tests__/`
 * may call it.
 */
export function __resetMigrationWriteback(): void {
  migrationWriteAttempted.clear();
}

export function useTheme(): UseThemeApi {
  const queryClient = useQueryClient();

  // /me/theme. retry:false because UnauthorizedError on the login page
  // is the steady-state for unauthenticated users — we fall back to
  // localStorage / OS prefs. enabled is always-on so the hook can be
  // mounted by ThemeToggle in the header without an auth gate (the
  // header itself only renders when authenticated, but the hook is also
  // pulled into the broadcaster mounted at the app root).
  /**
   * Did the preference we are holding come from the SERVER?
   *
   * `bootstrapPref()` is returned for an unauthenticated caller, so the
   * query's `data` alone cannot answer this — the two are the same
   * shape. Only a real response may seed the boot cache or be corrected
   * by the write-back; a guess must do neither.
   */
  const serverBackedRef = useRef(false);

  const prefQuery = useQuery<UserThemePref>({
    queryKey: ME_THEME_QUERY_KEY,
    queryFn: async () => {
      try {
        const server = await getMeTheme();
        serverBackedRef.current = true;
        return server;
      } catch (err) {
        // Unauthenticated boot — fall back to local. Anything else
        // bubbles so React Query records the error.
        if (err instanceof UnauthorizedError) {
          serverBackedRef.current = false;
          return bootstrapPref();
        }
        throw err;
      }
    },
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  /**
   * The placeholder for the in-flight window, resolved ONCE per mount.
   *
   * Once, because nothing but this hook writes the record and a fresh
   * read on every render would hand `pref` — and therefore `active`, and
   * therefore the DOM effect — a new object each time. The boot cache
   * wins over the guess for the reason in `bootCachePref`: it is what
   * the browser is already showing.
   */
  const placeholderPref = useRef<UserThemePref | null>(null);
  if (placeholderPref.current === null) {
    placeholderPref.current = bootCachePref() ?? bootstrapPref();
  }

  const pref = prefQuery.data ?? placeholderPref.current;

  // Custom theme detail (only fetched when mode=custom AND id is set).
  const customQuery = useQuery<ApiTheme>({
    queryKey: pref.customThemeId ? themeQueryKey(pref.customThemeId) : ['theme', 'none'],
    queryFn: () => {
      if (!pref.customThemeId) throw new Error('no custom theme id');
      return getTheme(pref.customThemeId);
    },
    enabled: pref.mode === 'custom' && !!pref.customThemeId,
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  /**
   * The saved theme, translated into the current role dictionary
   * (sk-285.7 T012, US-3 / INV-9).
   *
   * A theme row is a flat snapshot keyed by ROLE NAME, written before
   * the redesign replaced that dictionary. Applied as saved it would
   * paint the old language: the roles the redesign renamed would land
   * nowhere, and the roles it introduced would be resolved by the
   * builtin cascade — except they would not be, because a custom theme
   * carries its own `data-theme="custom"` marker that no builtin rule
   * matches. So the migration happens HERE, on the read path, ahead of
   * `active` and therefore ahead of `applyActive`: the first frame is
   * already correct, whether or not the snapshot is ever written back.
   *
   * Writing it back is deliberately NOT here — that is T013, a
   * single-flight PATCH that can fail, be switched off, or lose a race
   * between tabs without any of it reaching the screen. Read and write
   * are separable precisely because this side is a pure function of the
   * row.
   *
   * CHEAP AND IDEMPOTENT, in that order, because a read path is hit
   * often. Cheap: the memo is keyed on the fetched object, so the
   * 86-role rebuild runs once per theme the server hands over, not once
   * per render — and the SignalR `theme.updated` handler writes into
   * that same query cache, so a live edit re-migrates by producing a new
   * object rather than by any extra plumbing here. Idempotent:
   * `migrateThemeVariables` is a fixed point on its own output
   * (`themeMigration.ts` states why, `themeMigration.test.ts` pins it),
   * so a row that T013 has already written back migrates to itself and
   * re-running costs correctness nothing.
   *
   * The failure path is untouched on purpose. A theme that does not load
   * leaves `customQuery.data` undefined, this returns `null`, and
   * `applyActive` takes its builtin branch — the user gets a whole
   * builtin theme rather than a half-populated set of roles, which is
   * what the spec's failure edge asks for. Migration cannot change that
   * because it has nothing to migrate.
   */
  const migratedCustomTheme = useMemo<ApiTheme | null>(() => {
    const saved = customQuery.data;
    if (!saved) return null;
    return { ...saved, variables: migrateThemeVariables(saved.variables, saved.base) };
  }, [customQuery.data]);

  /**
   * Write the migrated snapshot back to the server — once per theme,
   * by the theme's OWNER only, and never at the expense of what is on
   * screen (sk-285.7 T013, US-3, plan decision R2).
   *
   * ── What it does, and what it deliberately does not ─────────────────
   *
   * One `PATCH /themes/:id` carrying the WHOLE new map. Not a diff:
   * the spec's failure edge is "an interruption does not leave the theme in a
   * half-switched state", and a single request replacing
   * `variables` wholesale is the only shape where an interrupted write
   * leaves the row exactly as it was rather than half-translated.
   *
   * It does NOT write the response into the query cache. The screen
   * already shows these values — `migratedCustomTheme` painted them
   * before this effect ran — so feeding the echo back would rebuild the
   * memo and re-apply 86 inline properties to produce the picture
   * already on screen. The write is bookkeeping about the ROW; the
   * paint is settled elsewhere and stays settled.
   *
   * It does NOT touch anything on failure either, which is matrix row
   * 19 ("a failed write does not change the drawn theme"): the rejection is
   * logged and dropped. Nothing downstream of here reads its outcome,
   * so a 500, an offline tab and a revoked session all leave exactly the
   * theme the read path resolved. The read path is authoritative and
   * runs every load; the write is an optimisation of the row, and the
   * two are separable precisely because migration is a pure function
   * (T012's docstring states the same split from the other side).
   *
   * ── Three gates, in the order they can be answered cheaply ─────────
   *
   *   1. OWNERSHIP (matrix row 18). Only the theme's creator writes.
   *      `useAuthOptional` rather than `useAuth` so the hook keeps
   *      mounting outside an `<AuthProvider>` — in that case there is
   *      no identity to compare against and the safe answer, «do not
   *      write someone's theme», is the one that falls out.
   *   2. NECESSITY. `needsMigration` on the SAVED row, not on the
   *      migrated one: the question is whether the stored row is stale.
   *      Because the migration's output can never need migrating, a row
   *      this has already rewritten fails the gate on its own — the Set
   *      below is a guard against concurrent mounts, not the thing that
   *      makes the write one-time.
   *   3. THE CLAIM. See {@link migrationWriteAttempted}.
   */
  const currentUserId = useAuthOptional()?.user?.id ?? null;

  // sk-389 — the surface a refused theme write reports on. `useToaster`
  // hands back one stable object, so it is safe in the mutation's deps.
  const toast = useToaster();
  const { t } = useTranslation('chrome');

  useEffect(() => {
    const saved = customQuery.data;
    if (!saved || !migratedCustomTheme) return;
    if (!currentUserId || saved.createdBy?.id !== currentUserId) return;
    if (!needsMigration(saved.variables)) return;
    if (migrationWriteAttempted.has(saved.id)) return;
    migrationWriteAttempted.add(saved.id);

    void updateTheme(saved.id, { variables: migratedCustomTheme.variables }).catch((err) => {
      // Deliberately terminal: nothing reads this, and nothing should.
      // eslint-disable-next-line no-console
      console.warn('[theme] could not write the migrated snapshot back:', err);
    });
  }, [customQuery.data, migratedCustomTheme, currentUserId]);

  const active: ActiveTheme = useMemo(
    () => ({
      mode: pref.mode,
      builtinTheme: pref.builtinTheme,
      customThemeId: pref.customThemeId,
      customTheme: migratedCustomTheme,
    }),
    [pref.mode, pref.builtinTheme, pref.customThemeId, migratedCustomTheme],
  );

  // Apply to DOM on every active-theme change. The boot script in
  // index.html already painted the cascade-level data-theme; this
  // reconciles after React mounts.
  //
  // NOTE: `skein.theme` is intentionally NOT touched here. The "user
  // explicitly picked X" signal lives in setBuiltin/toggle (the only
  // surfaces that write that key). Writing here couples DOM reconciliation
  // to side-effect storage and silently "freezes" the OS-pref tracker
  // (see the prefers-color-scheme effect below) for users who never
  // explicitly chose a theme.
  //
  // The BOOT CACHE (sk-285.7.2.48) is a different key carrying a
  // different assertion — «this is what the server last said» rather
  // than «the user picked this here» — so it gets its own effect, right
  // below. Without it the boot script has no access to the server at all
  // and paints the first frame from the OS; measured, that was 244ms of
  // light under an account on the dark theme.
  useEffect(() => {
    // Mirror the resolved active theme into the module-level snapshot
    // so the SignalR theme.preview auto-reset / theme.user-pref.updated
    // handler in `useLiveEvents.tsx` can re-apply the active theme
    // outside React state. Writing in the same effect that applies the
    // DOM keeps the snapshot in lockstep with what the user sees.
    lastActiveSnapshot = active;
    applyActive(active);
  }, [active]);

  /**
   * Mirror the SERVER's preference into the boot cache (sk-285.7.2.48).
   *
   * A separate effect from the DOM apply above, and `dataUpdatedAt` in
   * its deps, for one reason worth stating: whether the answer came from
   * the server is NOT visible in the answer. `bootstrapPref()` has the
   * same shape, so when the guess and the stored row happen to agree —
   * an account on light, in a browser whose OS is light — `active` is
   * referentially unchanged across the response and an effect keyed on
   * it alone never re-runs. The cache would then never be written for
   * exactly those users, and the first frame after they switch their OS
   * would be the mispaint this task fixed. `dataUpdatedAt` moves on
   * every settled fetch whether or not the value did, which is the
   * event this write actually cares about.
   *
   * Only a SERVER answer is worth caching: on the login screen `pref` is
   * a guess from the same two sources the boot script already consults,
   * so caching it would add nothing and would outlive the session it was
   * guessed in.
   */
  useEffect(() => {
    // Nothing has settled yet. The record on disk is the last thing the
    // server said and the frame on screen was painted from it — so it is
    // neither confirmed nor destroyed until there is an answer. Clearing
    // it here instead would mean a load abandoned mid-flight (a closed
    // tab, a dropped connection) leaves the NEXT load with no record and
    // the OS-guess first frame this task removed.
    if (prefQuery.dataUpdatedAt === 0) return;
    if (!serverBackedRef.current) {
      clearThemeBootCache();
      return;
    }
    const custom = active.mode === 'custom' && active.customTheme ? active.customTheme : null;
    writeThemeBootCache({
      v: 1,
      mode: custom ? 'custom' : 'builtin',
      // The server's own stored value, read off `pref` rather than off
      // `active`: the record asserts «this is what the server last
      // said», and it is that claim the boot script paints the first
      // frame from.
      builtin: pref.builtinTheme,
      ...(custom ? { vars: custom.variables, base: custom.base } : {}),
    });
  }, [active, pref.builtinTheme, prefQuery.dataUpdatedAt]);

  // OS-preference listener — only relevant when the user has no server-
  // backed preference yet (covered by `pref` defaulting to bootstrap on
  // 401). Switches the *built-in* base; doesn't touch custom mode.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => {
      // Only follow OS prefs if there's no stored override AND the
      // server hasn't given us a preference yet (steady state for the
      // login page).
      if (readStoredBuiltin() !== null) return;
      if (prefQuery.data) return;
      queryClient.setQueryData<UserThemePref>(ME_THEME_QUERY_KEY, {
        mode: 'builtin',
        builtinTheme: e.matches ? 'dark' : 'light',
        customThemeId: null,
      });
    };
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [prefQuery.data, queryClient]);

  // BroadcastChannel listener — live preview from the editor in another
  // tab. The editor publishes {type:'preview', variables} on every
  // change and {type:'reset'} on close. We apply / strip directly on
  // :root and ignore React state — preview is a transient overlay.
  //
  // Deps are [] — the channel is opened once for the lifetime of the
  // hook instance. Reading `active` directly inside the handler would
  // tear down + re-create the channel on every active-theme change,
  // losing any preview / reset message that arrives during the window
  // between cleanup and re-subscribe (the user could wiggle a slider
  // in the editor and see no effect in the shell tab). We read the
  // latest active via a ref instead.
  const activeRef = useRef(active);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
      return;
    }
    const bc = new BroadcastChannel(THEME_PREVIEW_CHANNEL);
    const onMessage = (e: MessageEvent) => {
      const msg = parsePreviewMessage(e.data);
      if (!msg) return;
      if (msg.type === 'preview') {
        applyVariables(msg.variables);
        setDataTheme('custom');
        return;
      }
      if (msg.type === 'reset') {
        // reset — re-apply the currently-active theme. Strips preview
        // keys, re-applies custom theme variables if mode=custom, or
        // just sets data-theme back to the built-in base. Also clear
        // any lingering Designer-style highlight ring.
        applyActive(activeRef.current);
        clearHighlight();
        return;
      }
      if (msg.type === 'highlight-section') {
        applyHighlight(selectorsForSection(msg.section));
        return;
      }
      if (msg.type === 'highlight-tokens') {
        applyHighlight(msg.selectors);
        return;
      }
    };
    bc.addEventListener('message', onMessage);
    return () => {
      bc.removeEventListener('message', onMessage);
      bc.close();
      // Clear the highlight on hook unmount — if the editor crashed or
      // the parent navigated away we don't want a stale ring left over.
      clearHighlight();
    };
  }, []);

  // Mutation: PUT /me/theme. Optimistic — write the cache immediately so
  // the DOM update happens before the server confirms.
  //
  // Context generic carries the rollback snapshot so onError doesn't
  // need to cast back to the right shape. ApiError (vs bare Error) keeps
  // the discriminated-union of API error types — callers branching on
  // 422 vs 500 can rely on `err instanceof BusinessError` etc.
  //
  // sk-389 — the optimistic write has TWO halves, and both belong here.
  // `skein.theme` used to be written at the call site, before `mutate`
  // was even entered, which put it outside the rollback: a refused PUT
  // left storage saying `dark` while `data-theme` and `aria-pressed`
  // said `light`, and the next boot would have painted from the value
  // the server rejected. MEASURED on the live stand (sk-389, against an
  // API that answered 400):
  //
  //     localStorage['skein.theme']              = "dark"   (changed)
  //     document.documentElement.dataset.theme   = "light"  (unchanged)
  //     [aria-label="Light theme"] aria-pressed  = "true"   (unchanged)
  //
  // Moving the write in here is what makes it one optimistic update
  // instead of two: `onMutate` is the only place that can apply both
  // halves at the same instant. WHERE the undo lives moved once more
  // afterwards — see the `scope:` docblock below: per-write rollback
  // is what let an older refusal undo a newer acceptance, so the undo
  // is now the chain's, in `onSettled`.
  const putMutation = useMutation<UserThemePref, ApiError, ThemeWrite, { seq: number }>({
    /**
     * sk-389 (self-review W-3) — the rollback is per CHAIN of writes,
     * not per write.
     *
     * ── The defect this replaces ────────────────────────────────────
     *
     * The version above snapshotted what to roll back to inside
     * `onMutate`, by READING the current state: `readStoredBuiltin()`
     * for the key, `getQueryData` for the cache. Neither reading is
     * owned by the mutation taking it. `useMutation` does not
     * serialise, and the two cells this hook serves sit side by side
     * in the header, so two clicks gave the SECOND write a snapshot of
     * the FIRST one's optimism:
     *
     *   click 1 (→dark):  previousStored = null ;  writes 'dark'
     *   click 2 (→light): previousStored = 'dark' — click 1's optimism
     *   click 2 accepted → cache and DOM say light
     *   click 1 refused  → restoreStoredBuiltin(null) → key REMOVED
     *
     * MEASURED on the real hook (PUT #1 answering 500 after 80 ms,
     * PUT #2 answering 200 at once): `dataTheme=light`, `stored=null`.
     * That is the same three-surfaces-two-answers shape sk-389 exists
     * to remove, reached by a different road — and reached BY sk-389,
     * which is what moved the storage write into the rollback pair.
     * `skein.theme === null` is not inert either: it means «never
     * picked here», it gates the OS-preference tracker, and after a
     * logout the login screen paints from the OS instead of from the
     * colour the server accepted.
     *
     * ── Why `scope` alone does not fix it ───────────────────────────
     *
     * The obvious answer is `scope`, and it is not enough: read
     * `mutation.js`, `execute()` — `onMutate` is awaited BEFORE
     * `retryer.start()`, and the scope gate lives in the retryer's
     * `canRun`. So a scope serialises the network calls and lets both
     * `onMutate`s run back to back exactly as before. Measured with
     * `scope` and nothing else: `dataTheme=dark`, `stored=dark` when
     * BOTH writes were refused — the surfaces agree now, on a colour
     * the server rejected twice. Agreement is not the invariant;
     * agreement ON A CONFIRMED VALUE is.
     *
     * ── What this does instead ──────────────────────────────────────
     *
     * The bookkeeping moves from the mutation to the CHAIN of writes
     * that overlap in time (`themeWriteChain`):
     *
     *   • the first write of a chain records the baseline — the last
     *     state the server confirmed, before anyone was optimistic;
     *   • every acceptance advances that record;
     *   • when the chain drains, both surfaces are set BACK to it,
     *     unconditionally. When the last write was accepted this is a
     *     no-op, which is why there is no branch: the client always
     *     ends on the newest state the server actually confirmed.
     *
     * `scope` stays, and now earns its place for the other reason: it
     * makes the PUTs land in CLICK order, so «the newest confirmed
     * state» is the newest click the server took rather than whichever
     * response happened to be quickest. It costs nothing on screen —
     * `onMutate` is not gated by it, so the optimistic paint is still
     * immediate.
     */
    scope: { id: ME_THEME_MUTATION_SCOPE },
    mutationFn: ({ next }) => setMeTheme(next),
    onMutate: async ({ next, pickedHere }) => {
      // First statement, before any await: `onSettled` decrements
      // unconditionally, so the increment must not be skippable.
      const seq = beginThemeWrite(queryClient);
      await queryClient.cancelQueries({ queryKey: ME_THEME_QUERY_KEY });
      if (pickedHere) writeStoredBuiltin(pickedHere);
      queryClient.setQueryData<UserThemePref>(ME_THEME_QUERY_KEY, next);
      return { seq };
    },
    onError: (err) => {
      // No rollback here — that is `onSettled`'s job, once the whole
      // chain has drained. Rolling back per write is what let an older
      // refusal undo a newer acceptance.
      //
      // A refusal the user is not told about reads as a click that did
      // nothing. Same surface every other failed mutation in the app
      // uses (see `useKanbanMove`, `useAcceptIssue`): the server's own
      // message when it wrote one, our sentence when it did not.
      toast.error(err?.message ? `${t('theme.saveFailed')}: ${err.message}` : t('theme.saveFailed'));
    },
    onSuccess: (server, vars, ctx) => {
      confirmThemeWrite(server, vars.pickedHere ?? null);
      // Only the newest write may paint. An older acceptance landing
      // after a newer click would otherwise drag the UI back to the
      // colour the user has already moved on from.
      if (ctx && ctx.seq === themeWriteChain.started) {
        queryClient.setQueryData<UserThemePref>(ME_THEME_QUERY_KEY, server);
      }
    },
    onSettled: () => {
      endThemeWrite(queryClient);
    },
  });

  // Stable refs to avoid re-creating callbacks on every render — the
  // ThemeToggle wraps them in event handlers and we don't want to
  // remount Mantine's Menu just because the active object changed.
  const prefRef = useRef(pref);
  prefRef.current = pref;

  const setBuiltin = useCallback(
    (next: BuiltinTheme) => {
      const current = prefRef.current;
      putMutation.mutate({
        next: {
          mode: 'builtin',
          builtinTheme: next,
          customThemeId: current.customThemeId, // preserve so the user's pick is remembered
        },
        // This IS the «picked here» gesture, so it is the one call that
        // records one. The write itself happens in `onMutate` — see the
        // mutation for why it cannot stay out here.
        pickedHere: next,
      });
    },
    [putMutation],
  );

  const toggle = useCallback(() => {
    const current = prefRef.current;
    const next: BuiltinTheme = current.builtinTheme === 'dark' ? 'light' : 'dark';
    setBuiltin(next);
  }, [setBuiltin]);

  const setCustomTheme = useCallback(
    (id: string) => {
      const current = prefRef.current;
      putMutation.mutate({
        next: {
          mode: 'custom',
          builtinTheme: current.builtinTheme,
          customThemeId: id,
        },
      });
    },
    [putMutation],
  );

  const clearCustom = useCallback(() => {
    const current = prefRef.current;
    putMutation.mutate({
      next: {
        mode: 'builtin',
        builtinTheme: current.builtinTheme,
        customThemeId: current.customThemeId,
      },
    });
  }, [putMutation]);

  // `theme` — effective light/dark for any consumer that just wants to
  // know the surface tone (e.g. the toggle icon). When mode=custom we
  // surface the custom theme's OWN base so the icon reflects what's
  // actually painted (a custom theme based on 'dark' shows ☾ even if the
  // user's last builtin pick was 'light'). Falls back to the builtin
  // base when the custom theme hasn't loaded yet — single-paint flash
  // is acceptable; mis-displaying the toggle is not.
  const theme: BuiltinTheme =
    active.mode === 'custom' && active.customTheme
      ? active.customTheme.base
      : active.builtinTheme;

  return {
    theme,
    active,
    isLoading: prefQuery.isLoading,
    toggle,
    setBuiltin,
    setTheme: setBuiltin,
    setCustomTheme,
    clearCustom,
  };
}

// Convenience re-export for callers that want the synchronous "what's
// painted right now" value without subscribing to the hook (e.g. tests).
export { readCurrentBuiltin };
