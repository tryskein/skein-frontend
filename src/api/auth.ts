import { apiFetch, apiJson, UnauthorizedError } from './client';

/**
 * Runtime auth flags served by skein-web (BFF) at `GET /api/auth/config`.
 * Used by the SPA to:
 *   - render the password form, the SSO button, or BOTH on the Login page,
 *     depending on `authMode` (see LoginPage);
 *   - disable admin "+ New user" in keycloak mode (users auto-provision
 *     on first SSO login).
 *
 * `authMode` (sk-163 S4a/S4b):
 *   - `local`    — password auth only.
 *   - `keycloak` — SSO (OIDC) only.
 *   - `hybrid`   — both are possible; the Login page renders BOTH the SSO
 *                  button and the password form.
 *
 * sk-303.8 — this used to also carry `isExternalHost`, a per-request
 * classification of which host (public vs. internal) served the response,
 * used in hybrid mode to decide whether to show the SSO button alongside
 * the password form. The BFF-side allowlist it was derived from
 * (`SKEIN_INTERNAL_HOSTS`) was removed: it derived a UI/privilege signal
 * from a header the client controls, and it never actually divided anything
 * in this deployment (skein-web has no public route). The field is gone —
 * `hybrid` now always renders both affordances, matching what
 * `isExternalHost` always evaluated to (`false`) under that allowlist's
 * empty-by-default production value.
 *
 * Fetched ONCE at app boot via `useAuthConfig` and kept for the lifetime of
 * the page. `authMode` is fixed for the BFF process; since sk-674.18 the
 * installation fields are re-read by the BFF from skein-api on every
 * request, so a new page load sees a changed value without a BFF restart.
 */
export interface RuntimeAuthConfig {
  authMode: 'local' | 'keycloak' | 'hybrid';
  /**
   * sk-303.42 — the ONE absolute URL this SPA may navigate to when
   * `POST /api/auth/logout` returns a `redirectTo` (see
   * `auth/logoutRedirect.ts`), or `null` when the deployment has no external
   * session to terminate. Comes from the BFF's
   * `Authentication:LogoutRedirectUrl`.
   *
   * The allow-list used to be a constant naming one organisation's proxy, so
   * every other install's sign-out URL was rejected — quietly, leaving the
   * external session alive behind a logout that reported success.
   *
   * Optional in the type: a BFF older than sk-303.42 omits the key, which
   * deserialises to `undefined` and is treated exactly like `null` (no
   * absolute redirect permitted).
   */
  logoutRedirectUrl?: string | null;
  /**
   * sk-303.42 — absolute URL of the MCP endpoint for the `.mcp.json` snippet
   * on the Api Keys page (BFF `SKEIN_MCP_URL`), or `null`/absent when MCP is
   * served from this same origin. Replaces a client-side derivation that
   * rewrote a known host prefix into a sibling host name.
   */
  mcpUrl?: string | null;
  /**
   * sk-674.18 US-18, T044 (D-7) — the six installation fields below are
   * read by the BFF from skein-api on every request (a restart of skein-api
   * alone changes them). Every key is always present, `null` meaning "not
   * configured"; the client assumes no default for them (skein-api
   * unavailable → the BFF answers 503 instead of a stale or default value).
   *
   * Self-service registration is open (`SKEIN_SIGNUP_ENABLED`). `false` =
   * no registration link; the signup screens say registration is closed.
   */
  signupEnabled: boolean;
  /**
   * Outgoing mail works (`SKEIN_EMAIL_ENABLED`). `false` = no "Forgot
   * password?" link, honest texts on the reset and confirmation screens,
   * and accepting an invitation from Inbox does not need a confirmed email.
   */
  emailEnabled: boolean;
  /** Public Cloudflare Turnstile site key for signup; null = no captcha, send no token. */
  turnstileSiteKey: string | null;
  /** Minimum length of a new project prefix; null = no minimum. */
  projectPrefixMinLength: number | null;
  /** Terms of service linked from the consent checkbox; null = plain text. */
  termsUrl: string | null;
  /** Privacy policy linked from the consent checkbox; null = plain text. */
  privacyUrl: string | null;
}

export async function getAuthConfig(): Promise<RuntimeAuthConfig> {
  return apiJson<RuntimeAuthConfig>('/api/auth/config');
}

/**
 * Shape of the `POST /api/auth/logout` response. In keycloak mode the BFF
 * returns the deployment's configured sign-out URL so the SPA can do a
 * top-level navigation — a same-origin `fetch` cannot end the upstream proxy
 * session, only a full browser navigation clears the proxy's cookie on its own
 * cookie domain. `redirectTo` is null in local mode, and also in keycloak mode
 * when the deployment has not configured a sign-out URL; the caller then stays
 * on the current route. The value is validated against the BFF-declared
 * allow-list before navigation — see `auth/logoutRedirect.ts`.
 */
export interface LogoutResponse {
  redirectTo: string | null;
}

/**
 * User as returned by skein-web BFF (mirrors UserDto in the .NET project).
 * `createdAt` and `lastLoginAt` come back as ISO-8601 strings (or null when
 * the BFF returns the cookie-derived form rather than skein-api's full row).
 */
export interface User {
  id: string;
  email: string;
  username: string;
  name: string;
  role: string;
  createdAt: string | null;
  lastLoginAt: string | null;
  /**
   * External-collaborator flag (sk-163). `true` = an external user
   * (role is always `user`, never admin/owner). The BFF `/api/auth/me`
   * serialises `UserDto.IsExternal` as camelCase `isExternal`; older
   * BFFs that predate the field omit it, so it deserialises as
   * `undefined` → treat absent as internal (the safe default). The
   * Activity dashboard reads this to disable profile links to
   * non-co-member users (their profiles stay co-set scoped server-side,
   * so a click would 404/oracle — sk-163.18 §7).
   */
  isExternal?: boolean;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export async function loginApi(payload: LoginPayload): Promise<User> {
  return apiJson<User>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function logoutApi(): Promise<LogoutResponse> {
  const response = await apiFetch('/api/auth/logout', { method: 'POST' });
  // Pre-R5.1 BFFs returned 204; R5.1+ returns 200 with a body. Handle
  // both shapes so a transient version skew between deploys doesn't
  // throw "Unexpected end of JSON input".
  if (response.status === 204) {
    return { redirectTo: null };
  }
  try {
    return (await response.json()) as LogoutResponse;
  } catch (err) {
    // Malformed body (BFF bug, proxy injecting HTML, etc.) — treat as
    // a local-mode logout. In keycloak mode this means the upstream
    // oauth2-proxy cookie survives and the user re-authenticates on
    // next request. Surface it so we can diagnose in post-incident.
    // eslint-disable-next-line no-console
    console.warn('Malformed logout response, treating as local logout:', err);
    return { redirectTo: null };
  }
}

// ───────────────────────── Public account routes (sk-674.18) ─────────────────────────
//
// The public BFF routes of `skein-web/src/Auth/UserDto.cs#PublicAuthRoutes`
// (T044), relaying skein-api `internal/accounts/contract.go` (T012). Besides
// login and config they are the only routes reachable without a session.
// The invitation-by-token pair lives in `invitations.ts`.

/**
 * Machine codes of the public account routes (the `code` of the thrown
 * error). A malformed body is answered by the BFF with 400 before skein-api
 * is called; skein-api unreachable is 502.
 */
export const AccountErrorCode = {
  /** 400 — syntax refused by skein-api. */
  InvalidRequest: 'invalid_request',
  /** 429 — the action's rate limit (thrown as `RateLimitError`). */
  RateLimited: 'rate_limited',
  /** Registration is closed on this installation. */
  SignupDisabled: 'signup_disabled',
  /** Outgoing mail is off: no reset link or confirmation can be sent. */
  EmailDisabled: 'email_disabled',
  /** keycloak mode: passwords are recovered at the SSO provider. */
  PasswordLoginDisabled: 'password_login_disabled',
  /** The email belongs to an account (a deleted one included). */
  EmailTaken: 'email_taken',
  /** The username belongs to an account; the error carries `suggestions`. */
  UsernameTaken: 'username_taken',
  /** The username breaks the username rule. */
  UsernameInvalid: 'username_invalid',
  /** The password breaks the password policy. */
  PasswordWeak: 'password_weak',
  /** The password is in the Pwned Passwords corpus. */
  PasswordPwned: 'password_pwned',
  /** The consent checkbox is not ticked. */
  TermsRequired: 'terms_required',
  /** Turnstile is configured and the token is missing or did not verify. */
  CaptchaFailed: 'captcha_failed',
  /** The reset or confirmation link token is unknown, expired or used. */
  TokenInvalid: 'token_invalid',
  /** The invitation is unknown, expired, revoked or used (signup by invitation). */
  InvitationInvalid: 'invitation_invalid',
  /** The invitation's space was deleted (signup by invitation). */
  SpaceDeleted: 'space_deleted',
} as const;

/** A value of {@link AccountErrorCode}. */
export type AccountErrorCodeValue = (typeof AccountErrorCode)[keyof typeof AccountErrorCode];

/** Language of a transactional email: the interface language, not stored on the user. */
export type EmailLanguage = 'ru' | 'en';

/** Body of POST /api/auth/signup. */
export interface SignupInput {
  email: string;
  username: string;
  password: string;
  /** Anything but `true` is `terms_required`. */
  termsAccepted: boolean;
  /** Send when `turnstileSiteKey` is set; omit or null otherwise. */
  turnstileToken?: string | null;
  /** Language of the confirmation email. */
  language: EmailLanguage;
}

/**
 * POST /api/auth/signup — the account and its personal space are created
 * and the user is logged in (Set-Cookie), as after a password login.
 * Refusals, in this order: 422 `signup_disabled`; 429; 422
 * `captcha_failed`, `terms_required`, `username_invalid`, `password_weak`,
 * `password_pwned`, `email_taken`, `username_taken` (with `suggestions`).
 */
export async function signupApi(input: SignupInput): Promise<User> {
  return apiJson<User>('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** 200 body of GET /api/auth/username-suggestions. */
export interface UsernameSuggestionsResponse {
  /** 2–3 usernames free at the moment of the answer, best first. */
  suggestions: string[];
}

/**
 * GET /api/auth/username-suggestions?email= ("Generate from email").
 * Refusals: 400 `invalid_request`, 422 `signup_disabled`, 429.
 */
export async function getUsernameSuggestions(email: string): Promise<UsernameSuggestionsResponse> {
  return apiJson<UsernameSuggestionsResponse>(
    `/api/auth/username-suggestions?email=${encodeURIComponent(email)}`,
  );
}

/**
 * POST /api/auth/password-reset — 204, NEUTRAL: identical whether or not an
 * account with the email exists. Refusals (independent of the email): 422
 * `password_login_disabled`, `email_disabled`; 429.
 */
export async function requestPasswordReset(email: string, language: EmailLanguage): Promise<void> {
  await apiFetch('/api/auth/password-reset', {
    method: 'POST',
    body: JSON.stringify({ email, language }),
  });
}

/**
 * POST /api/auth/password-reset/{token} — 204 with no body. The password is
 * set and every other session of the user ends (API keys keep working). A
 * session of the SAME user stays logged in; without a session, or with
 * another user's, no session is issued — the SPA sends the visitor to
 * `/login`. Refusals: 422 `password_login_disabled`, `email_disabled`,
 * `token_invalid`, `password_weak`, `password_pwned`; 429.
 */
export async function completePasswordReset(token: string, password: string): Promise<void> {
  await apiFetch(`/api/auth/password-reset/${encodeURIComponent(token)}`, {
    method: 'POST',
    body: JSON.stringify({ password }),
  });
}

/**
 * POST /api/auth/confirm-email/{token} — 204: the email of the token's
 * account is confirmed; no session is issued or changed. Refusals: 422
 * `email_disabled`, `token_invalid`; 429.
 */
export async function confirmEmail(token: string): Promise<void> {
  await apiFetch(`/api/auth/confirm-email/${encodeURIComponent(token)}`, { method: 'POST' });
}

/**
 * GET /api/auth/me. Returns null when the user is not authenticated
 * instead of throwing — the AuthProvider keeps `null` as a stable
 * "logged out" state.
 */
export async function meApi(): Promise<User | null> {
  try {
    return await apiJson<User>('/api/auth/me');
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return null;
    }
    throw err;
  }
}
