import { useCallback, useLayoutEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { Density } from '../api/uiPrefs';
import { useAuth } from '../auth/AuthContext';
import { clearDensityBootCache, readDensityBootCache, writeDensityBootCache } from './densityBootCache';
import { useUiPrefs } from './useUiPrefs';

/** The attribute the «Density» block in index.css keys on. */
export const DENSITY_ATTRIBUTE = 'data-density';

/**
 * Put a density on `<html>`. "Normal" is the ABSENCE of the attribute —
 * the stylesheet's numbers as written — so a page that never heard of the
 * setting and a person on the default look exactly alike.
 */
export function applyDensity(density: Density): void {
  const root = document.documentElement;
  if (density === 'compact') root.setAttribute(DENSITY_ATTRIBUTE, 'compact');
  else root.removeAttribute(DENSITY_ATTRIBUTE);
}

export interface DensityApi {
  /** The signed-in person's own density; `normal` until it arrives. */
  density: Density;
  /** Their own density has arrived (the switch reflects it). */
  loaded: boolean;
  /** Choose a density. Applied at once; the PUT carries only `density`. */
  setDensity: (density: Density) => void;
}

/**
 * sk-551.7 — "Density: Normal / Compact", a reader of the shared
 * appearance settings (`useUiPrefs`). Writing goes through the same chain
 * as the window checkboxes, so a density click and a checkbox click in
 * quick succession cannot undo each other.
 *
 * Keeping `<html>` on the setting is `useDensitySync`'s, mounted once at
 * the root — so the attribute follows the cache whoever changed it, and a
 * refusal that rolls the cache back rolls the page back with it. The click
 * paints the attribute itself only so it lands in the same frame.
 */
export function useDensity(): DensityApi {
  const { t } = useTranslation('header');
  const { userId, prefs, update } = useUiPrefs();
  const setDensity = useCallback(
    (density: Density) => {
      // Painted in the click handler as well as by the sync: TanStack
      // hands a cache change to its observers on a later tick, and the
      // the requirement "applies immediately" means this frame. The sync then
      // agrees with it, and puts it back if the server refuses.
      if (update(() => ({ density }), t('density.saveFailed'))) applyDensity(density);
    },
    [update, t],
  );
  return {
    density: prefs?.density ?? 'normal',
    loaded: userId !== null && prefs !== undefined,
    setDensity,
  };
}

/**
 * Keep `<html data-density>` on the signed-in person's density, and the
 * boot cache on the last answer, from the first frame on.
 *
 *   - the server ANSWERED that nobody is signed in (a 401, or the logout
 *     writing `null`) — "Normal": the density is a property of a
 *     profile, and there is none; the cache is dropped too, so the next
 *     load does not paint a previous person's choice on the login page;
 *   - no person and no answer — `/api/auth/me` pending, paused offline or
 *     failed — leave everything as `theme-boot.js` painted it from the
 *     cache (replacing it with a guess is the reflow the cache exists to
 *     avoid): «nobody» is not known yet, and wiping the record on a dropped connection would
 *     hand the NEXT load a normal first frame and a reflow (the same
 *     refusal `useTheme` makes before its first settled answer);
 *   - signed in, own settings in — that density (the cache included: an
 *     optimistic click is written through, and so is its rollback);
 *   - signed in, settings not in yet — the cached density if, and only if,
 *     the cache is THIS person's; anyone else's record means "Normal"
 *     until their own answer arrives.
 *
 * A layout effect: it runs before the browser paints the render that
 * produced it, so a click in the menu never shows a frame of the old
 * density under the new switch.
 */
export function useDensitySync(): void {
  const { user, sessionResolved } = useAuth();
  const { prefs } = useUiPrefs();
  const userId = user?.id ?? null;
  const serverDensity = prefs?.density;

  useLayoutEffect(() => {
    if (userId === null) {
      if (!sessionResolved) return;
      clearDensityBootCache();
      applyDensity('normal');
      return;
    }
    if (serverDensity !== undefined) {
      writeDensityBootCache(userId, serverDensity);
      applyDensity(serverDensity);
      return;
    }
    const cached = readDensityBootCache();
    applyDensity(cached !== null && cached.userId === userId ? cached.density : 'normal');
  }, [sessionResolved, userId, serverDensity]);
}
