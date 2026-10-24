import { useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from 'react';
import { QueryClientContext, hashKey, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { NavLayout, UiPrefs } from '../api/uiPrefs';
import { useAuth, useAuthOptional } from '../auth/AuthContext';
import {
  clearNavLayoutBootCache,
  readNavLayoutBootCache,
  writeNavLayoutBootCache,
} from './navLayoutBootCache';
import { uiPrefsKey, useUiPrefs } from './useUiPrefs';

/**
 * sk-551.8 — the layout to draw while the person's profile has not
 * answered yet (spec INV-10), read synchronously from this browser's copy
 * (`navLayoutBootCache.ts`) so the first render is already right (SC-005,
 * D7, plan P5):
 *
 *   - the session is not known yet (`/api/auth/me` pending, paused offline,
 *     or failed without an earlier answer) — the last value this browser
 *     stored, whoever it belonged to: that is the person who is back far
 *     more often than not, and nothing better is known;
 *   - the server ANSWERED that nobody is signed in — "Columns side by side": the
 *     layout is a property of a profile, and there is none;
 *   - a person is known — their own stored value only; another person's
 *     record means "Columns side by side" until their own profile arrives.
 *
 * A failed profile request leaves this in place: a dropped connection
 * neither erases the stored value nor resets the layout to the factory.
 */
interface BeforeProfile {
  navLayout: NavLayout;
  /**
   * The value is this browser's stored record (INV-10), not the factory
   * `columns` drawn for want of one.
   */
  fromCache: boolean;
}

function navLayoutBeforeProfile(userId: string | null, sessionResolved: boolean): BeforeProfile {
  const factory: BeforeProfile = { navLayout: 'columns', fromCache: false };
  if (userId === null && sessionResolved) return factory;
  const cached = readNavLayoutBootCache();
  if (cached === null) return factory;
  if (userId !== null && cached.userId !== userId) return factory;
  return { navLayout: cached.navLayout, fromCache: true };
}

export interface NavLayoutApi {
  /**
   * The layout to draw: the person's own server value once it is in,
   * before that the stored value by INV-10 (see `navLayoutBeforeProfile`).
   */
  navLayout: NavLayout;
  /**
   * The person's own value has arrived. Until then the switch is
   * unavailable and does not present the stored guess as their choice
   * (US-1).
   */
  loaded: boolean;
  /**
   * Choose a layout. The same value as the one in the person's profile
   * cache AT THE MOMENT OF THE CALL (the optimistic value of an earlier,
   * not yet rendered click included) — nothing happens. Otherwise applied
   * at once (optimistic) through the person's shared chain of profile
   * writes, and the PUT carries only `navLayout`; the last choice of a
   * series wins, and a refusal rolls the value back and says so in a
   * toast. A call before the person's own value arrived does nothing
   * (`useUiPrefs#update`).
   */
  setNavLayout: (navLayout: NavLayout) => void;
}

/**
 * sk-551.8 — "Left panel: Columns side by side / Sections in one column", a
 * reader of the shared appearance settings (`useUiPrefs`). Writing goes
 * through the same chain as the density and the window checkboxes, so
 * quick clicks on different controls cannot undo each other, and the last
 * click wins.
 *
 * Where a change came from (a click here, a late profile, a rollback) is
 * NOT this hook's business — the shell tells them apart itself (plan P13).
 *
 * Requires `AuthProvider` and `QueryClientProvider`; a reader that must
 * survive without them (the layout provider in unit tests) uses
 * `useNavLayoutOptional`.
 */
export function useNavLayout(): NavLayoutApi {
  const { t } = useTranslation('header');
  const qc = useQueryClient();
  const { sessionResolved } = useAuth();
  const { userId, prefs, update } = useUiPrefs();
  const beforeProfile = useMemo(
    () => navLayoutBeforeProfile(userId, sessionResolved).navLayout,
    [userId, sessionResolved],
  );
  const navLayout = prefs?.navLayout ?? beforeProfile;
  const setNavLayout = useCallback(
    (next: NavLayout) => {
      // Compared with the LIVE cache, not with this render's `navLayout`:
      // two calls before a re-render (`sections`, then `columns` while
      // `columns` is drawn) must not drop the second one — the first has
      // already put `sections` into the cache optimistically. No cache
      // entry for this person yet — `update` would refuse the call anyway.
      if (userId === null) return;
      const current = qc.getQueryData<UiPrefs>(uiPrefsKey(userId));
      if (current === undefined || current.navLayout === next) return;
      update(() => ({ navLayout: next }), t('navLayout.saveFailed'));
    },
    [qc, userId, update, t],
  );
  return {
    navLayout,
    loaded: userId !== null && prefs !== undefined,
    setNavLayout,
  };
}

const noopUnsubscribe = () => {};

/**
 * sk-551.8 — the layout to draw, for a reader that may be mounted without
 * `AuthProvider` or without `QueryClientProvider` (the layout provider:
 * many existing unit tests mount it bare). Same value as
 * `useNavLayout().navLayout` when both providers are present; without
 * them — `columns`, and it never throws.
 *
 * It only READS the profile cache (subscribing to the query cache, not
 * starting a query): the request itself is kept alive by
 * `useNavLayoutSync`, mounted at the app root, and by every other
 * `useUiPrefs` reader.
 */
export function useNavLayoutOptional(): NavLayout {
  return useNavLayoutOptionalState().navLayout;
}

export interface NavLayoutOptionalState {
  navLayout: NavLayout;
  /**
   * The value is the person's KNOWN layout: their profile answered, or it
   * is this browser's stored record (INV-10). `false` while the drawn
   * `columns` is only the factory value for want of either — and always
   * without the providers.
   */
  known: boolean;
}

/**
 * sk-551.8 — `useNavLayoutOptional` with where the value came from. The
 * layout provider needs it to answer the initial-load question by the
 * person's FIRST KNOWN layout (plan P3): the stored record the first
 * render started from, or else the first profile answer.
 */
export function useNavLayoutOptionalState(): NavLayoutOptionalState {
  const auth = useAuthOptional();
  const qc = useContext(QueryClientContext);
  const hasAuth = auth !== null;
  const userId = auth?.user?.id ?? null;
  const sessionResolved = auth?.sessionResolved ?? false;

  // Only this person's profile entry is listened to: the query cache
  // notifies synchronously while OTHER components build their queries
  // during render, and re-checking this reader's owner (the layout
  // provider) in the middle of someone else's render is what React
  // warns about.
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (qc === undefined || userId === null) return noopUnsubscribe;
      const hash = hashKey(uiPrefsKey(userId));
      return qc.getQueryCache().subscribe((event) => {
        if (event.query.queryHash === hash) onChange();
      });
    },
    [qc, userId],
  );
  const getServerValue = useCallback(
    (): NavLayout | undefined =>
      qc !== undefined && userId !== null
        ? qc.getQueryData<UiPrefs>(uiPrefsKey(userId))?.navLayout
        : undefined,
    [qc, userId],
  );
  const serverValue = useSyncExternalStore(subscribe, getServerValue, getServerValue);

  // Without either provider the answer is `columns`, and this browser's
  // copy is not read at all (the hooks above still run unconditionally).
  const hasProviders = hasAuth && qc !== undefined;
  const beforeProfile = useMemo<BeforeProfile>(
    () =>
      hasProviders
        ? navLayoutBeforeProfile(userId, sessionResolved)
        : { navLayout: 'columns', fromCache: false },
    [hasProviders, userId, sessionResolved],
  );
  return useMemo<NavLayoutOptionalState>(() => {
    if (!hasProviders) return { navLayout: 'columns', known: false };
    if (serverValue !== undefined) return { navLayout: serverValue, known: true };
    return { navLayout: beforeProfile.navLayout, known: beforeProfile.fromCache };
  }, [hasProviders, serverValue, beforeProfile]);
}

/**
 * Keep this browser's copy of the layout (`navLayoutBootCache`) on the
 * signed-in person's server value (spec INV-10):
 *
 *   - the server ANSWERED that nobody is signed in (a 401, or the logout
 *     writing `null`) — the copy is erased, so the next load does not draw
 *     a previous person's layout;
 *   - no person and no answer (`/api/auth/me` pending, paused offline or
 *     failed) — nothing is touched: «nobody» is not known yet, and wiping
 *     the copy on a dropped connection would hand the next load a frame of
 *     the wrong layout;
 *   - signed in, own settings in — that value is written, the optimistic
 *     click and its rollback included (both pass through the cache);
 *   - signed in, settings not in yet (or their request failed) — the
 *     effect does nothing: the copy keeps whatever it held, and nothing is
 *     written until the profile answers (a click cannot write earlier
 *     either: `useUiPrefs#update` refuses before the settings are in).
 *
 * Only the SIGNED-IN person's value is ever written, under their id: the
 * profile cache is keyed by user (`useUiPrefs#uiPrefsKey`), so a
 * confirmation arriving after a logout, after a 401, or for a session of
 * another person lands under its own owner's key and never reaches this
 * writer.
 *
 * Mounted once at the root (`components/NavLayoutSync.tsx`) next to
 * `DensitySync`, so the copy follows the profile whatever page is shown.
 */
export function useNavLayoutSync(): void {
  const { user, sessionResolved } = useAuth();
  const { prefs } = useUiPrefs();
  const userId = user?.id ?? null;
  const serverNavLayout = prefs?.navLayout;

  useEffect(() => {
    if (userId === null) {
      if (!sessionResolved) return;
      clearNavLayoutBootCache();
      return;
    }
    if (serverNavLayout !== undefined) {
      writeNavLayoutBootCache(userId, serverNavLayout);
    }
  }, [sessionResolved, userId, serverNavLayout]);
}
