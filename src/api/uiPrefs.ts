/**
 * sk-551.5 / sk-551.7 / sk-551.8 — the caller's personal
 * interface-appearance settings, `GET/PUT /api/v1/me/ui-prefs`.
 *
 * Three fields: `issueModalViews`, the task views in which a selected
 * issue opens as a centred pop-up window instead of the pane beside the
 * view; `density`, the interface density (normal / compact); and
 * `navLayout`, the left-panel layout (columns side by side / sections in
 * one column). The server
 * keeps them in the profile, so the choice follows the person across
 * browsers. The PUT is partial on the server side (an absent field keeps
 * its value), which is why the request type makes every field optional —
 * and why each control sends only its own field.
 */
import type { ViewMode } from './issues';
import { apiJson } from './client';

export const ME_UI_PREFS_QUERY_KEY = ['me', 'ui-prefs'] as const;

/**
 * The three views in the order the server answers them — and the order the
 * Appearance checkboxes are drawn in, so the request a click sends and the
 * response it gets back list the views the same way.
 */
export const ISSUE_MODAL_VIEW_ORDER: readonly ViewMode[] = ['cards', 'kanban', 'tree'];

/**
 * sk-551.7 — the interface density. `normal` is the factory position (no
 * attribute on `<html>`, today's sizes); `compact` is
 * `<html data-density="compact">` — see the «Density» block in index.css.
 * The words are the server's (`user_ui_prefs.density`).
 */
export type Density = 'normal' | 'compact';

/** The two densities in the order the Appearance switch draws them. */
export const DENSITY_VALUES: readonly Density[] = ['normal', 'compact'];

/**
 * sk-551.8 — the left-panel layout. `columns` is the factory position
 * ("Columns side by side": the Queues and Projects columns side by side, as
 * before the setting existed); `sections` puts both into one column as
 * sections one above the other ("Sections in one column"). The words are
 * the server's (`user_ui_prefs.nav_layout`).
 */
export type NavLayout = 'columns' | 'sections';

/** The two layouts in the order the Appearance switch draws them. */
export const NAV_LAYOUT_VALUES: readonly NavLayout[] = ['columns', 'sections'];

export interface UiPrefs {
  /** Views that open the issue as a pop-up window. Empty — none (default). */
  issueModalViews: ViewMode[];
  /** Interface density. `normal` for someone who never chose. */
  density: Density;
  /** Left-panel layout. `columns` for someone who never chose. */
  navLayout: NavLayout;
}

export type UiPrefsUpdate = Partial<UiPrefs>;

/**
 * The answer as the rest of the app may rely on it. An API older than
 * sk-551.7 sends no `density`, and anything but `compact` means the
 * factory position — so a missing or unknown word reads as `normal`
 * rather than as `undefined` leaking into the switch.
 *
 * sk-551.8 — the same rule for `navLayout`: an API older than sk-551.8
 * sends no field, and only the exact word `sections` means the sections
 * layout. Anything else — absent, another case (`"Sections"`), an empty
 * string, a number — is the factory `columns`, never a guess at
 * «sections». Every answer goes through here, the PUT of ANOTHER field
 * included (the server answers each PUT with the whole record), so a
 * density click never drops the layout from the cache.
 */
function normalizeUiPrefs(raw: Partial<UiPrefs>): UiPrefs {
  return {
    issueModalViews: raw.issueModalViews ?? [],
    density: raw.density === 'compact' ? 'compact' : 'normal',
    navLayout: raw.navLayout === 'sections' ? 'sections' : 'columns',
  };
}

export async function getMeUiPrefs(): Promise<UiPrefs> {
  return normalizeUiPrefs(await apiJson<Partial<UiPrefs>>('/api/v1/me/ui-prefs'));
}

export async function putMeUiPrefs(body: UiPrefsUpdate): Promise<UiPrefs> {
  return normalizeUiPrefs(
    await apiJson<Partial<UiPrefs>>('/api/v1/me/ui-prefs', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  );
}
