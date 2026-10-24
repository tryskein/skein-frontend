import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { loginApi, LoginPayload, logoutApi, meApi, User } from '../api/auth';
import { clearDensityBootCache } from '../lib/densityBootCache';
import { clearNavLayoutBootCache } from '../lib/navLayoutBootCache';
import { clearThemeBootCache } from '../lib/themeBootCache';
import { releaseAllAccepted } from '../lib/inboxAcceptedRetention';
import { useAuthConfig, authConfigQueryOptions } from '../lib/useAuthConfig';
import { checkLogoutRedirect } from './logoutRedirect';
import { toaster } from '../components/Toaster';

/**
 * Cache key for "who is logged in?". Exported because the global
 * 401-handler in main.tsx has to clear exactly this entry — it is the
 * value RequireAuth reads to decide whether to bounce to /login.
 */
export const ME_KEY = ['auth', 'me'] as const;

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  /**
   * The server has ANSWERED «who is signed in?» — `user` is that answer,
   * `null` included (a 401, or the logout writing `null`). False while the
   * request is pending, paused offline, or failed without any earlier
   * answer: then `user === null` means «not known», not «nobody».
   *
   * sk-551.7 (review) — `isLoading` cannot say this: it is false for a
   * paused query and for an errored one, and a reader that took
   * `user === null && !isLoading` for «signed out» wiped state it should
   * have kept (the density's boot record).
   */
  sessionResolved: boolean;
  /** Log in. Throws on failure (BusinessError / RateLimitError / network). */
  login: (payload: LoginPayload) => Promise<User>;
  /** Log out. Resolves once the cookie is cleared and cache invalidated. */
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  // sk-303.42 — the post-logout redirect allow-list is a DEPLOYMENT fact, so
  // it is read from the BFF rather than compiled in. Anonymous endpoint,
  // `staleTime: Infinity`: one cached round-trip shared with the Login page.
  const authConfigQuery = useAuthConfig();
  // Rendered value — used by anything that only needs to DISPLAY the config.
  // Logout deliberately does NOT read it: see the fetch inside the mutation.
  const allowedLogoutRedirect = authConfigQuery.data?.logoutRedirectUrl ?? null;

  // The single source of truth for "who is logged in?". `null` means
  // "no session" (a clean 401 from /api/auth/me); `undefined` means
  // "not yet loaded". Infinity staleTime + retry:false keeps this from
  // re-fetching on every component mount — login/logout mutate it directly.
  const meQuery = useQuery<User | null>({
    queryKey: ME_KEY,
    queryFn: meApi,
    retry: false,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
  });

  // sk-622.21 R12 — the Inbox cards accepted in this tab (module state,
  // `inboxAcceptedRetention.ts`) belong to the person who accepted them.
  // A logout does not reload the page, so they would outlive the session and
  // be laid into the next person's Inbox on the same route. Dropped whenever
  // the signed-in identity changes: the logout (`null`), a 401 that ends the
  // session (`signOutOn401` writes `null`), and `/me` answering another
  // person. One point for all three, rather than the logout's `onSettled`
  // alone, which neither of the other two passes through. What the screen
  // shows does not wait for this effect: the snapshots carry the identity
  // that took them and `useInbox`'s projection depends on the identity, so
  // the first render for the next person (or for nobody) lays none of them
  // back; this drops them from memory.
  const identity = meQuery.data?.id ?? null;
  const shownIdentity = useRef(identity);
  useEffect(() => {
    if (shownIdentity.current === identity) return;
    shownIdentity.current = identity;
    releaseAllAccepted();
  }, [identity]);

  const loginMutation = useMutation({
    mutationFn: loginApi,
    onSuccess: (user) => {
      queryClient.setQueryData<User | null>(ME_KEY, user);
    },
  });

  // `onSettled` closes over `allowedLogoutRedirect`. TanStack Query pushes the
  // options object through on every render, so the callback that actually runs
  // is the one from the latest render — not the one captured before the config
  // query resolved.
  const logoutMutation = useMutation({
    mutationFn: logoutApi,
    onSettled: async (result) => {
      // Even on failure (e.g. the cookie was already invalid), clear local
      // state. The protected routes will redirect to /login on next render.
      queryClient.setQueryData<User | null>(ME_KEY, null);
      await queryClient.invalidateQueries();

      // sk-285.7.2.48 — drop the boot-readable mirror of the SERVER's
      // theme (`skein.theme.boot`). It is the one piece of this
      // session's state that survives outside the query cache, and the
      // boot script paints the FIRST FRAME from it: left behind, the
      // login screen after a logout would open in the previous user's
      // theme, asserting a preference we no longer know. `skein.theme`
      // is deliberately NOT touched — that key means «this browser's
      // human picked this», which a logout does not retract.
      //
      // Here rather than only in `useTheme`: the hook clears the cache
      // when it sees a non-server pref, but that requires the hook to
      // still be mounted and to observe the 401 — and on the keycloak
      // path below the tab navigates away before either happens.
      clearThemeBootCache();
      // sk-551.7 — the density's mirror, for the same reason: the boot
      // script would otherwise paint the previous person's density on the
      // login screen and on the next person's first frame.
      clearDensityBootCache();
      // sk-551.8 — the left-panel layout's copy (INV-10): a logout erases
      // it, so the next person's first render is not drawn in the previous
      // person's layout.
      clearNavLayoutBootCache();

      // In an SSO deployment the BFF hands back a redirectTo pointing at the
      // sign-out endpoint that ends the session OUTSIDE this app. We MUST
      // navigate there with a full page load rather than react-router: the
      // target usually lives on a sibling host outside our route table, and
      // only a real navigation clears the proxy's own cookie.
      //
      // The allow-list (see `logoutRedirect.ts`) permits same-origin
      // `/oauth2/*` paths plus the single absolute URL this deployment
      // declared on `GET /api/auth/config`. sk-303.42: it used to permit one
      // hard-coded host instead, so any other install's sign-out URL was
      // refused — and refused into `console.warn`, where nobody saw it: the
      // external session stayed alive behind a logout that looked complete.
      // Hence the toast on refusal. An incomplete logout is a security-
      // relevant outcome and has to be visible to the person who asked for it.
      if (result?.redirectTo) {
        const target = result.redirectTo;

        // Fetch the config here rather than reading the rendered value.
        // The cookie is ALREADY cleared by this point, so a config that had
        // not arrived yet would leave the comparison against `null`, refuse a
        // perfectly legitimate redirect, and strand the upstream session —
        // the exact failure this whole change set to fix, in a new disguise.
        // `ensureQueryData` returns the cache when it is warm and awaits the
        // round-trip when it is not; on rejection we fall through with `null`
        // and tell the person plainly, instead of pretending they signed out.
        let declared = allowedLogoutRedirect;
        let configFailed = false;
        try {
          const config = await queryClient.ensureQueryData(authConfigQueryOptions);
          declared = config.logoutRedirectUrl ?? null;
        } catch {
          configFailed = true;
        }

        const verdict = checkLogoutRedirect(target, declared);
        if (verdict.allowed) {
          window.location.assign(target);
        } else {
          // eslint-disable-next-line no-console
          console.warn(
            `Refusing logout redirect (${verdict.reason}):`,
            target,
          );
          toaster.error(
            configFailed
              ? 'Signed out here, but the identity provider session was not ended: ' +
                  'this app could not reach its own configuration to check where the ' +
                  'server wanted to send you. Close the browser to be sure, and try again.'
              : 'Signed out here, but the identity provider session was not ended: ' +
                  'the server asked for a redirect this app is not allowed to follow. ' +
                  'Close the browser to be sure, and report this to your Skein admin.',
          );
        }
      }
    },
  });

  const login = useCallback(
    async (payload: LoginPayload) => {
      return loginMutation.mutateAsync(payload);
    },
    [loginMutation],
  );

  const logout = useCallback(async () => {
    await logoutMutation.mutateAsync();
  }, [logoutMutation]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user: meQuery.data ?? null,
      isLoading: meQuery.isLoading,
      sessionResolved: meQuery.isSuccess,
      login,
      logout,
    }),
    [meQuery.data, meQuery.isLoading, meQuery.isSuccess, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return ctx;
}

/**
 * Optional variant — returns `null` when no `<AuthProvider>` is mounted
 * instead of throwing. Useful for low-level presentation components
 * (e.g. `UserMention`) that may be rendered in unit tests without the
 * full Shell context. Production callers that genuinely require auth
 * should still use `useAuth()` so the missing-provider invariant fails
 * loud at mount.
 */
export function useAuthOptional(): AuthContextValue | null {
  return useContext(AuthContext) ?? null;
}
