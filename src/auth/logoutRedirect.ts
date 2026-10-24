/**
 * Post-logout redirect allow-list.
 *
 * `POST /api/auth/logout` may hand back a `redirectTo` the SPA must navigate
 * to so the session OUTSIDE this app is torn down as well (an authenticating
 * proxy's sign-out endpoint, or the BFF's own RP-logout path). A top-level
 * navigation to a server-supplied URL is worth gating, so the target is
 * checked before `window.location.assign`.
 *
 * sk-303.42 — the allow-list used to be a compiled-in constant naming one
 * organisation's proxy host. Every other deployment's sign-out URL therefore
 * failed the check, and failed it QUIETLY: the console warning nobody reads,
 * an external session left alive, and a logout that looked like it worked.
 * The permitted absolute URL is now the one the BFF declares for this
 * deployment (`logoutRedirectUrl` on `GET /api/auth/config`), so the check
 * follows the install instead of the vendor.
 */

/**
 * The BFF's own RP-initiated logout path. Declared by attribute routing on
 * `AuthController` (`[Route("api/auth")]` + `[HttpGet("oidc-signout")]`), so
 * it is a contract of this application rather than a property of any one
 * deployment — unlike the proxy URL, which is configuration.
 *
 * In `KeycloakOidc` mode `POST /api/auth/logout` hands this path back, and
 * navigating to it is what makes Keycloak end the realm session. Leaving it
 * out of the allow-list left the cookie cleared and the upstream session
 * alive: the user saw the login page and believed they had signed out, while
 * the next visitor to that browser was let straight back in.
 */
const BFF_SIGNOUT_PATH = '/api/auth/oidc-signout';

/**
 * Sign-out path of an authenticating proxy sharing this origin. Kept for the
 * deployment shape where the proxy is mounted alongside the app rather than on
 * a host of its own; the exact path is the one oauth2-proxy publishes.
 */
const SAME_ORIGIN_PROXY_SIGNOUT_PATH = '/oauth2/sign_out';

export type LogoutRedirectVerdict =
  | { allowed: true }
  | { allowed: false; reason: 'protocol-relative' | 'not-allowed' };

/**
 * Decide whether the SPA may navigate to `target`.
 *
 * Accepted:
 *  - the BFF's own RP-logout path, exactly (see `BFF_SIGNOUT_PATH`);
 *  - the sign-out path of a proxy mounted on this origin, exactly
 *    (see `SAME_ORIGIN_PROXY_SIGNOUT_PATH`);
 *  - the exact absolute URL the BFF declared in `logoutRedirectUrl`.
 *
 * Every branch matches a WHOLE value, never a prefix. `/oauth2/` used to be
 * accepted as a namespace, which let `/oauth2/start?rd=…` through the guard —
 * a sign-IN entry point, and a redirect carrier, passing a sign-OUT check.
 * The BFF never returns such a value (it answers with the configured absolute
 * URL, the RP-logout path, or nothing), so the namespace bought nothing and
 * widened the guard for free.
 *
 * Everything else is refused. Protocol-relative targets (`//host/path`) are
 * refused explicitly and never reach the path branch: the browser reads them
 * as a different origin, so they are an absolute URL wearing a path's clothes.
 *
 * The absolute comparison is exact rather than prefix-based on purpose. Both
 * sides come from the same BFF configuration value, so there is nothing to be
 * lenient about, and a prefix test would accept `https://evil.example/` for a
 * declared `https://evil.example.com/…`-style value the moment the declared
 * URL lacked a trailing separator.
 */
export function checkLogoutRedirect(
  target: string,
  allowedAbsolute: string | null | undefined,
): LogoutRedirectVerdict {
  if (target.startsWith('//')) {
    return { allowed: false, reason: 'protocol-relative' };
  }
  if (target === BFF_SIGNOUT_PATH || target === SAME_ORIGIN_PROXY_SIGNOUT_PATH) {
    return { allowed: true };
  }
  const declared = allowedAbsolute?.trim();
  if (declared && target === declared) {
    return { allowed: true };
  }
  return { allowed: false, reason: 'not-allowed' };
}
