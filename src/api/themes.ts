/**
 * API client for /api/v1/themes/* and /api/v1/me/theme (sk-10).
 *
 * User-customisable theme catalog. Backend stores arbitrary CSS variable
 * maps; the frontend applies them via inline `style.setProperty` calls on
 * `document.documentElement`.
 *
 * Wire shapes (frozen contract, agreed with the parallel backend agent):
 *   - Theme.variables: free-form `Record<string, string>` keyed by the CSS
 *     custom property name including the leading `--`. Backend does NOT
 *     validate hex / rgba / px / etc. — that's the editor's responsibility.
 *   - UserThemePref.mode: 'builtin' falls back to `builtinTheme`; 'custom'
 *     applies the theme with `customThemeId`. When mode=custom AND
 *     `customThemeId` is null (theme was deleted while active), the
 *     consumer must fall back to `builtinTheme`.
 */

import { apiFetch, apiJson } from './client';

// ---------------- Query keys & channel name (shared) ----------------
//
// Hoisted here so every consumer (useTheme, ThemeToggle, ThemeEditorPage)
// imports the same identity. A typo on import is a compile-time error;
// duplicating the literal in two files would silently desync the cache /
// broadcast channel on rename.

/** TanStack Query key for the cross-tab theme list. */
export const THEMES_QUERY_KEY = ['themes'] as const;

/** TanStack Query key for the caller's active theme preference. */
export const ME_THEME_QUERY_KEY = ['me', 'theme'] as const;

/** TanStack Query key builder for a single theme by id. */
export const themeQueryKey = (id: string) => ['theme', id] as const;

/**
 * BroadcastChannel name for editor → main-window live preview.
 *
 * Versioned (`/v1`) so future protocol changes don't fight with cached
 * tabs on stale frontend versions — a tab on `/v1` and a tab on `/v2`
 * simply don't see each other's messages, instead of mis-parsing them.
 */
export const THEME_PREVIEW_CHANNEL = 'skein-theme-preview/v1';

/** A user-saved theme. `variables` is the full CSS-variable map. */
export interface Theme {
  id: string;
  name: string;
  base: 'light' | 'dark';
  variables: Record<string, string>;
  createdBy: { id: string; username: string };
  createdAt: string;
  updatedAt: string;
  updatedBy: { id: string; username: string };
}

/** Per-user active-theme preference. */
export interface UserThemePref {
  mode: 'builtin' | 'custom';
  /**
   * The built-in palette: exactly the two the stylesheet defines.
   *
   * Never a third value. The server has no `prefers-color-scheme` input
   * and cannot resolve one, so anything it stores here has to be a
   * colour something can actually paint — which is also what the MCP
   * theme tools seed a fork from.
   */
  builtinTheme: 'light' | 'dark';
  /** null when the active custom theme was deleted — caller falls back
   *  to `builtinTheme` until the user picks a new one. */
  customThemeId: string | null;
}

/** Body for POST /api/v1/themes. */
export interface CreateThemeRequest {
  name: string;
  base: 'light' | 'dark';
  variables: Record<string, string>;
}

/** Body for PATCH /api/v1/themes/:id. All fields optional. */
export interface UpdateThemeRequest {
  name?: string;
  base?: 'light' | 'dark';
  variables?: Record<string, string>;
}

/** List every theme visible to the caller, newest-first. */
export async function listThemes(): Promise<Theme[]> {
  return apiJson<Theme[]>('/api/v1/themes');
}

/** Fetch one theme by id. */
export async function getTheme(id: string): Promise<Theme> {
  return apiJson<Theme>(`/api/v1/themes/${encodeURIComponent(id)}`);
}

/** Create a new theme. */
export async function createTheme(body: CreateThemeRequest): Promise<Theme> {
  return apiJson<Theme>('/api/v1/themes', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** Update an existing theme. */
export async function updateTheme(id: string, body: UpdateThemeRequest): Promise<Theme> {
  return apiJson<Theme>(`/api/v1/themes/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

/** Delete a theme by id. 204 on success. */
export async function deleteTheme(id: string): Promise<void> {
  await apiFetch(`/api/v1/themes/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** Read the caller's active theme preference. */
export async function getMeTheme(): Promise<UserThemePref> {
  return apiJson<UserThemePref>('/api/v1/me/theme');
}

/** Replace the caller's active theme preference. */
export async function setMeTheme(body: UserThemePref): Promise<UserThemePref> {
  return apiJson<UserThemePref>('/api/v1/me/theme', {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

/**
 * Inspect-selection payload — sk-10.3.
 *
 * Sent to `POST /api/v1/me/theme/inspect` when the user clicks an element
 * with the IconCrosshair tool armed. The backend caches the most recent
 * selection per user in memory so the MCP agent (running on the user's
 * behalf in another tab / process) can read it via the corresponding
 * tool and use it to scope theme edits.
 *
 * Fields:
 *   - `selector`     — class-chain selector of the clicked element
 *                       (e.g. `.task-card.is-epic`), or its tag name
 *                       when the element has no classes.
 *   - `parents`      — ancestor selectors, up to 5 levels (closest first).
 *   - `tokens`       — theme-token keys the frontend's
 *                       `reverseLookupTokens()` heuristic believes are
 *                       relevant to the clicked element. The agent
 *                       uses this as a starting hint, not a hard answer.
 *   - `computedStyle` — small bag of resolved CSS properties (color,
 *                       fontFamily, fontSize, fontWeight, backgroundColor).
 *                       The agent reads this to understand the current
 *                       paint without having to ask the browser itself.
 */
export interface InspectSelection {
  selector: string;
  parents: string[];
  tokens: string[];
  computedStyle: Record<string, string>;
}

/**
 * Send an Inspect selection to the BFF for the MCP agent to read.
 *
 * Backend responds 204 on success — body is intentionally empty. We use
 * `apiFetch` (not `apiJson`) to avoid the JSON parse on an empty body.
 *
 * In DEV we additionally assert the documented 204 status so a contract
 * regression on the backend (e.g. someone flips it to 200 with a body)
 * surfaces immediately in DevTools rather than silently breaking the
 * MCP agent's read path.
 */
export async function postInspectSelection(sel: InspectSelection): Promise<void> {
  const res = await apiFetch('/api/v1/me/theme/inspect', {
    method: 'POST',
    body: JSON.stringify(sel),
  });
  if (import.meta.env.DEV && res?.status !== 204) {
    // eslint-disable-next-line no-console
    console.warn('[inspect] expected 204, got', res?.status);
  }
}
