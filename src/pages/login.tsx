import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Divider, Loader, PasswordInput, TextInput } from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ApiError, BusinessError, RateLimitError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useAuthConfig } from '../lib/useAuthConfig';
import { SkeinMark } from './shell/SkeinMark';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { ERR_ALERT_VARS } from '../lib/mantineVariantVars';

interface LocationState {
  from?: { pathname?: string };
  /**
   * sk-674.18 T059 (screens 1.13, 2.5) — the invitation link sent a
   * visitor whose address has an account here: the name of the space for
   * "Sign in to accept the invitation to …". The token itself rides only
   * in `from` (the way back), never in this page's address.
   */
  invitationSpace?: string;
}

/**
 * The sign-in screen (sk-285.6.14 · audit 2B, finding N-1).
 *
 * ── What this page was ─────────────────────────────────────────────
 *
 * The last screen still written in the terminal language the product
 * left behind in stages 1 and 2 — and the FIRST screen anybody sees,
 * which is what made it the largest single divergence of the second
 * audit pass. Measured in Chromium at 1440 with `data-theme=light`
 * forced:
 *
 *   card ground   rgb(34,24,20)  — `--skein-bg-elev`, the legacy
 *                                  ember palette, on a `--bg` page
 *   card radius   0px            — not a step of §4's 6 / 8 / 12
 *   content       a seven-line ASCII wordmark, `░▒▓ centralized task
 *                                  tracker ▓▒░`, `login@skein:~$ auth`,
 *                                  `> sign in`, `> waiting for input`
 *   submit        rgb(255,255,255) on rgb(33,37,41), border
 *                                  rgb(206,212,218), 16/600, 42px tall
 *   svg elements  1 (the password eye — no logo at all)
 *
 * The submit button is the part worth naming twice: `#212529` /
 * `#ced4da` is Mantine's own grey ramp, so the primary action of the
 * product's front door carried neither the new language nor the old
 * one. The cause is not local — `theme.ts` sets
 * `Button.defaultProps.variant = 'default'`, and Mantine's `default`
 * variant ignores `color` entirely, so the `color="orange"` this file
 * passed did nothing. Hence `variant="filled"` below, explicitly.
 *
 * ── What it is now ─────────────────────────────────────────────────
 *
 * §9 of the handoff hands the screens it does not draw — "login" named
 * among them — to §2–§6, so this page reuses the product's own pieces
 * rather than inventing a third vocabulary:
 *
 *   • the MARK is `<SkeinMark />`, the very component the header
 *     renders, beside «SKEIN» at §6's 16/700 with .08em tracking;
 *   • the card is a panel: `--surface`, `--line` hairline, `--radius-
 *     panel`, and NO shadow (§4: "cards without shadow (outline --line)");
 *   • fields and labels come from the shell's own rules — 44px band and
 *     12/500 caption, both of which are stated once in `index.css` and
 *     apply here because this page finally stopped fighting them;
 *   • the primary action is `--primary` / `--on-primary` at §6's 14/600
 *     and the field band's 44px;
 *   • the failure state is §6 "Forms"'s error: `--err` on `--err-t`,
 *     12px, with the `alert-circle` icon §8 lists.
 *
 * ── What did NOT change ────────────────────────────────────────────
 *
 * Every line of authentication behaviour. The (authMode × host) render
 * contract, the client-side email gate, the four error mappings and the
 * two open-redirect guards are byte-for-byte the same logic; only their
 * strings moved into the dictionary. `login.test.tsx` is the contract
 * and it still passes — two of its queries were re-pointed at the new
 * wording, and none of its assertions changed.
 */
export function LoginPage() {
  const { t } = useTranslation('auth');
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as LocationState | null)?.from?.pathname || '/';
  const invitationSpace = (location.state as LocationState | null)?.invitationSpace ?? null;

  // R5.1 — runtime auth flags from BFF. While in flight we render a small
  // loader so we don't briefly show the password form to an SSO user (who
  // would then see it swap to a single button — jarring).
  const authConfig = useAuthConfig();
  const authMode = authConfig.data?.authMode ?? 'local';

  // sk-163 S4c — render the right login affordance per authMode:
  //   local    → password form only  (unchanged)
  //   keycloak → SSO button only     (unchanged)
  //   hybrid   → SSO button + password form (BOTH)
  //
  // The hybrid "both" case is the break-glass guarantee: the admin logs in
  // with a password while OIDC is active, so an SSO-only screen there would
  // lock them out.
  //
  // sk-303.8 — this used to also branch on which host served the response
  // (`isExternalHost`), hiding the SSO button on a host classified public so
  // only the password form showed. That classification was removed (it
  // derived a UI signal from a header the client controls, and never
  // actually divided anything in this deployment — see
  // `RuntimeAuthConfig` in `api/auth.ts`), so hybrid mode now always shows
  // both — the behaviour `isExternalHost` always produced in production
  // anyway.
  const isKeycloakOnly = authMode === 'keycloak';
  // The persistent SSO button shown ALONGSIDE the password form in hybrid
  // mode. keycloak (non-hybrid) renders its own dedicated SSO-only screen
  // below instead.
  const showSsoAlongsideForm = authMode === 'hybrid';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  // sk-163 S4c — when POST /api/auth/login answers 403 `sso_required`
  // (a non-external account tried the password form in hybrid mode), we
  // surface an explicit "use Keycloak" affordance with the loginUrl the
  // server handed back. We deliberately do NOT auto-redirect — that would
  // risk a redirect loop; the user clicks the button.
  const [ssoRequired, setSsoRequired] = useState<{ loginUrl: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // sk-285.6.14 — the show/hide state is held HERE rather than left to
  // `PasswordInput`'s own, so the toggle's accessible name can say which
  // way it will go. See the control below for why that matters.
  const [passwordVisible, setPasswordVisible] = useState(false);
  // sk-350.x a11y fix — a screen-reader/keyboard user who submits the
  // password form and gets `sso_required` back needs two things a plain
  // state flip doesn't give them: the change announced (role="alert"
  // below on the message box) and their focus actually moved onto the
  // one remaining login control, since focus otherwise just sits on the
  // now-pointless password Submit button. Focus the Keycloak button
  // whenever `ssoRequired` transitions to non-null.
  const ssoRequiredButtonRef = useRef<HTMLButtonElement>(null);

  // Already authenticated? Bounce. Effect rather than render-time Navigate
  // so the form mounts cleanly on direct /login visits.
  useEffect(() => {
    if (user) {
      navigate(from, { replace: true });
    }
  }, [user, navigate, from]);

  // sk-350.x a11y fix — move focus onto the Keycloak button the moment
  // `sso_required` renders it, so keyboard/SR users land on the only
  // remaining login affordance instead of an alert they may not have
  // heard read out (role="alert" on the message box announces it for
  // those who did; this covers focus for everyone else).
  useEffect(() => {
    if (ssoRequired) {
      ssoRequiredButtonRef.current?.focus();
    }
  }, [ssoRequired]);

  // R5.1 — kick off the SSO redirect. `rd` is the return-to URL that
  // oauth2-proxy will bounce back to after Keycloak login. Send the user
  // back to the originally-requested page (or `/` if they came straight
  // to /login). Use the full origin so oauth2-proxy honours it on any
  // host the deployment answers on, production or development alike.
  //
  // Defence-in-depth: `from` comes from React Router location state and
  // is normally a clean SPA path, but a future code path could plant a
  // protocol-relative URL ("//evil") that browsers treat as cross-origin.
  // Whitelist to single-slash same-origin paths before forwarding.
  const handleSsoLogin = () => {
    const safeFrom =
      typeof from === 'string' && from.startsWith('/') && !from.startsWith('//')
        ? from
        : '/';
    const returnTo = window.location.origin + safeFrom;
    window.location.assign(`/oauth2/start?rd=${encodeURIComponent(returnTo)}`);
  };

  // sk-163 S4c — navigate to the SSO start URL the server returned on a
  // 403 `sso_required`. Same single-slash same-origin whitelist as the
  // logout redirect: the contract says loginUrl is a hardcoded relative
  // path ("/oauth2/start"), but we defend against a protocol-relative
  // ("//evil") value before forwarding. User-initiated (button click),
  // so there is no redirect loop.
  const handleSsoRequiredLogin = () => {
    const url = ssoRequired?.loginUrl ?? '/oauth2/start';
    const safeUrl = url.startsWith('/') && !url.startsWith('//') ? url : '/oauth2/start';
    window.location.assign(safeUrl);
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSsoRequired(null);
    const trimmedEmail = email.trim();
    // Client-side email-format gate. The API validates Email as a proper
    // address and returns 400 (not 422) for a non-email — that is a request
    // shape error, not a credential failure. Catch it here so the user gets a
    // clear "enter a valid email" instead of the misleading "service
    // unavailable" the generic ApiError branch would show, and skip a pointless
    // round-trip. (External users log in by email.)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError(t('errors.email'));
      return;
    }
    setSubmitting(true);
    try {
      await login({ email: trimmedEmail, password });
      navigate(from, { replace: true });
    } catch (err) {
      // Map typed errors → user-facing messages. Avoid leaking server
      // strings that might contain stack traces or internal hostnames.
      //
      // sk-163 S4c — 403 `sso_required` surfaces as an ApiError (client.ts
      // routes any non-401/429/422 !ok into ApiError, lifting `error`→code
      // and the rest of the body → `extra`). Render the SSO affordance
      // instead of a plain error string; no auto-redirect.
      if (err instanceof ApiError && err.code === 'sso_required') {
        const loginUrl =
          typeof err.extra.loginUrl === 'string' ? err.extra.loginUrl : '/oauth2/start';
        setSsoRequired({ loginUrl });
      } else if (err instanceof BusinessError) {
        setError(t('errors.credentials'));
      } else if (err instanceof RateLimitError) {
        setError(t('errors.rateLimit'));
      } else if (err instanceof ApiError && err.statusCode === 400) {
        // Server-side validation (e.g. a malformed address that slipped past
        // the client check) — a request-shape error, not a service outage.
        setError(t('errors.email'));
      } else if (err instanceof ApiError) {
        setError(t('errors.unavailable'));
      } else {
        setError(t('errors.network'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  /* §6 "Buttons": the SSO affordance is the primary action on the screens
     where it appears, so it is the filled one there. `variant` is passed
     explicitly on every filled button of this page — see the docblock:
     the theme's default variant discards `color`. */
  const ssoButton = (onClick: () => void, ref?: React.Ref<HTMLButtonElement>) => (
    <Button
      ref={ref}
      type="button"
      variant="filled"
      color="orange"
      fullWidth
      className="login-submit"
      onClick={onClick}
    >
      {t('sso')}
    </Button>
  );

  return (
    <div className="login-page">
      {/* sk-514 (14) — the TOP STRIP OF THE PAGE, not the content
          of the card.

          The requester's request: "I do not like that the logo is in the
          login block, I would move it somewhere up and to the left", and "there is no
          language choice". Both controls belong to the PAGE, not to the form:
          the brand names the product, the switcher changes the language of the whole
          interface, and neither is part of signing in. Standing
          inside the card, the brand took the first row of the form and
          pushed the heading down.

          The switcher is the same `LanguageSwitcher` as in the app
          header, not a second drawing of it: the language here is chosen
          by exactly the same mechanism (a write to localStorage, live
          i18next switching), and a second implementation would drift from the
          first on the first edit. It is needed exactly here: before sign-in
          there is no header, and there was nowhere to change the language — that is, on the first
          screen the user was locked into a language they did not choose
          themselves. */}
      <header className="login-chrome">
        {/* The mark is the header's own component, not a second drawing
            of the brand. Decorative: the wordmark beside it is the
            accessible text, so a second name here would make a screen
            reader say «Skein» twice. */}
        <div className="login-brand">
          <SkeinMark />
          <span className="login-wordmark">SKEIN</span>
        </div>
        <LanguageSwitcher />
      </header>
      <main className="login-card" aria-labelledby="login-title">
        <h1 className="login-title" id="login-title">
          {t('title')}
        </h1>
        <p className="login-tagline">{t('tagline')}</p>
        {invitationSpace !== null ? (
          <p className="login-note" role="status">
            {t('inviteLoginNote', { name: invitationSpace })}
          </p>
        ) : null}

        {authConfig.isLoading ? (
          <div className="login-loading">
            <Loader size="sm" color="orange" />
          </div>
        ) : authConfig.isError ? (
          // Don't silently fall back to local-mode form on /config
          // failure — an SSO-only user would see a form they cannot
          // use. Show retry hint instead.
          <>
            <Alert variant="light" style={ERR_ALERT_VARS} title={t('configErrorTitle')}>
              {t('configErrorBody')}
            </Alert>
            <Button
              type="button"
              fullWidth
              className="login-submit"
              onClick={() => authConfig.refetch()}
            >
              {t('retry')}
            </Button>
          </>
        ) : isKeycloakOnly ? (
          // R5.1 SSO mode: single button, no form. We deliberately do
          // not show the password fields at all — they're not just
          // disabled, they don't exist in this build path. Subtitle
          // sets expectations about the upcoming browser redirect.
          <>
            <p className="login-note">{t('ssoRedirectNote')}</p>
            {ssoButton(handleSsoLogin)}
          </>
        ) : (
          <>
            {/* sk-163 S4c — break-glass / external-account hint: the
                server told us this account must use SSO. Render a button
                the user clicks; never auto-redirect (loop guard). */}
            {ssoRequired && (
              <>
                {/* sk-350.x — `role="alert"` so the swap is announced, and
                    the effect above moves focus onto the button below, so
                    keyboard users land on the only login affordance left
                    instead of the now-inert submit they pressed. */}
                <p className="login-note" role="alert">
                  {t('ssoRequired')}
                </p>
                {ssoButton(handleSsoRequiredLogin, ssoRequiredButtonRef)}
              </>
            )}

            {/* sk-163 S4c — hybrid mode: SSO is the primary path, but the
                password form below stays reachable so the break-glass admin
                can sign in under active OIDC. Suppressed while `ssoRequired`
                draws its own SSO button above — sk-303.8 made hybrid always
                set `showSsoAlongsideForm`, so without this guard a 403
                `sso_required` would render the same button twice. */}
            {showSsoAlongsideForm && !ssoRequired && (
              <>
                <p className="login-note">{t('ssoRedirectNote')}</p>
                {ssoButton(handleSsoLogin)}
                <Divider className="login-divider" label={t('orPassword')} />
              </>
            )}

            <form className="login-form" onSubmit={handleSubmit} noValidate>
              <TextInput
                label={t('emailLabel')}
                placeholder={t('emailPlaceholder')}
                type="email"
                autoComplete="email"
                autoFocus
                required
                value={email}
                onChange={(e) => setEmail(e.currentTarget.value)}
                disabled={submitting}
              />
              <PasswordInput
                label={t('passwordLabel')}
                placeholder={t('passwordPlaceholder')}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.currentTarget.value)}
                disabled={submitting}
                visible={passwordVisible}
                onVisibilityChange={setPasswordVisible}
                /*
                 * The eye, which nobody had looked at.
                 *
                 * §7 — it is an icon button and therefore a tap target;
                 * measured 28×28 before, both axes now lifted to
                 * `--tap-target` in `index.css` (the rule explains why
                 * the obvious width/height pair does not work).
                 *
                 * KEYBOARD. Mantine defaults this button to
                 * `tabIndex: -1`, i.e. Tab skips it entirely, and it is
                 * the only way to reveal what you typed. `tabIndex: 0`
                 * puts it back in the sequence; Mantine's own handler
                 * already toggles on Space, and Enter is added here
                 * because a <button> that answers one of the two reads
                 * as broken. The two do not collide: Mantine calls this
                 * handler first and only then looks for Space.
                 *
                 * NAME. `aria-label` names what the press will DO and
                 * flips with the state, and `aria-pressed` says which
                 * state it is in — without both, a screen reader hears
                 * «show password» while the password is already showing.
                 * (Passing any props here also clears Mantine's default
                 * `aria-hidden`, which would otherwise hide the control
                 * from the same reader.)
                 */
                visibilityToggleButtonProps={{
                  tabIndex: 0,
                  'aria-label': passwordVisible ? t('hidePassword') : t('showPassword'),
                  'aria-pressed': passwordVisible,
                  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      setPasswordVisible((v) => !v);
                    }
                  },
                }}
              />

              {/* sk-674.18 T059 (screens 1.13, 2.8) — only where mail works
                  and a password signs in: this branch is `local` or
                  `hybrid` (keycloak has its own screen above). In `hybrid`
                  the email goes only to the accounts a password signs in. */}
              {authConfig.data?.emailEnabled ? (
                <Link className="login-forgot" to="/forgot-password">
                  {t('links.forgotPassword')}
                </Link>
              ) : null}

              {error && (
                <div className="login-error" role="alert">
                  {/* §8 lists `alert-circle`; §6 "Forms" asks for the
                      message to carry it. 16px is the inline step. */}
                  <IconAlertCircle size={16} stroke={1.75} aria-hidden />
                  <span>{error}</span>
                </div>
              )}

              <Button
                type="submit"
                variant="filled"
                color="orange"
                fullWidth
                className="login-submit"
                loading={submitting}
              >
                {submitting ? t('submitting') : t('submit')}
              </Button>
            </form>
          </>
        )}
        {/* sk-674.18 T059 (screens 1.13) — only while registration is open. */}
        {authConfig.data?.signupEnabled ? (
          <p className="login-note public-switch">
            {t('links.noAccount')} <Link to="/signup">{t('links.signup')}</Link>
          </p>
        ) : null}
      </main>
    </div>
  );
}
