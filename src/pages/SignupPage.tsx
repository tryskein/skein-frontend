import { FormEvent, ReactNode, useEffect, useRef, useState } from 'react';
import { Button, Group, PasswordInput, Stack, Text, TextInput } from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { BusinessError } from '../api/client';
import {
  AccountErrorCode,
  getUsernameSuggestions,
  signupApi,
  type RuntimeAuthConfig,
  type User,
} from '../api/auth';
import { signupByInvitation, type InvitationSignupResponse } from '../api/invitations';
import type { SpaceRef } from '../api/spaces';
import { ME_KEY, useAuth } from '../auth/AuthContext';
import { Turnstile } from '../components/Turnstile';
import { emailLanguage } from '../lib/emailLanguage';
import { useAuthConfig } from '../lib/useAuthConfig';
import {
  ConsentCheckbox,
  EMAIL_SHAPE,
  FormError,
  PasswordStrengthMeter,
  PublicLoading,
  PublicPage,
  refusalCode,
  refusalKey,
} from './publicAuth';

/**
 * sk-674.18 T059 — registration (screens 2.6, spec US-8) at `/signup`,
 * public. Only while registration is open (`signupEnabled` of
 * `/api/auth/config`); closed — the route leads to `/login`. A person who
 * is already signed in has nothing to register and goes to `/`.
 *
 * Success: the account and its "Personal" exist and the person is signed in
 * (the BFF set the cookie), so the answer becomes the session's user and
 * the app opens on `/` (onboarding is deferred, decision No. 10).
 */
export function SignupPage() {
  const { t } = useTranslation('auth');
  const { user, isLoading } = useAuth();
  const config = useAuthConfig();
  const navigate = useNavigate();

  if (isLoading || config.isLoading) {
    return (
      <PublicPage title={t('signup.title')} titleId="signup-title">
        <PublicLoading />
      </PublicPage>
    );
  }
  if (config.isError || !config.data) {
    return (
      <PublicPage title={t('signup.title')} titleId="signup-title">
        <FormError>{t('configErrorBody')}</FormError>
        <Button type="button" fullWidth className="login-submit" onClick={() => config.refetch()}>
          {t('retry')}
        </Button>
      </PublicPage>
    );
  }
  if (user) return <Navigate to="/" replace />;
  if (!config.data.signupEnabled) return <Navigate to="/login" replace />;

  return (
    <PublicPage title={t('signup.title')} titleId="signup-title">
      <SignupForm config={config.data} onSignedUp={() => navigate('/', { replace: true })} />
      <p className="login-note public-switch">
        {t('links.haveAccount')} <Link to="/login">{t('links.signIn')}</Link>
      </p>
    </PublicPage>
  );
}

/** Registration by invitation (screens 2.7): the email is the invitation's. */
export interface SignupInvitation {
  token: string;
  /** The invited email, shown locked. */
  email: string;
  space: SpaceRef;
}

interface SignupFormProps {
  config: RuntimeAuthConfig;
  /** Present — registration by invitation (screens 2.7); absent — open registration (2.6). */
  invitation?: SignupInvitation;
  /** The account exists and the session is set. */
  onSignedUp: (result: User | InvitationSignupResponse) => void;
  /** Registration by invitation only: the invitation died while the form was open. */
  onInvitationGone?: (code: typeof AccountErrorCode.InvitationInvalid | typeof AccountErrorCode.SpaceDeleted) => void;
}

interface FieldErrors {
  email?: ReactNode;
  username?: ReactNode;
  password?: ReactNode;
}

/** One Turnstile challenge: a new id remounts the widget (`Turnstile.tsx`). */
interface CaptchaAttempt {
  id: number;
  token: string | null;
}

/**
 * The registration form of screens 2.6 and 2.7: email (locked for an
 * invitation), username with "Generate from email", password with the
 * strength line, the consent checkbox (the button is off without it),
 * Turnstile when a site key is configured.
 *
 * Every refusal code has its place (screens 2.6 "Errors"): email and
 * username under their fields — a taken username offers the free names
 * the server sent as buttons —, the password's under the password, the
 * check, the rate limit, the consent and a closed registration over the
 * button.
 *
 * A Turnstile token is spent by the server's check whatever the answer
 * after it, so every refusal starts a new challenge (`refresh-expired:
 * manual` — a new token needs the person).
 */
export function SignupForm({ config, invitation, onSignedUp, onInvitationGone }: SignupFormProps) {
  const { t, i18n } = useTranslation('auth');
  const queryClient = useQueryClient();
  const siteKey = config.turnstileSiteKey;

  const [email, setEmail] = useState(invitation?.email ?? '');
  const [username, setUsername] = useState('');
  const usernameTouched = useRef(false);
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [terms, setTerms] = useState(false);
  const [captcha, setCaptcha] = useState<CaptchaAttempt>({ id: 0, token: null });
  const [captchaBroken, setCaptchaBroken] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [generating, setGenerating] = useState(false);

  // Screens 2.7: "Username prefilled from email" — the server's first free
  // name, unless the person has typed one already.
  const invitedEmail = invitation?.email ?? null;
  useEffect(() => {
    if (invitedEmail === null) return;
    let live = true;
    getUsernameSuggestions(invitedEmail).then(
      (res) => {
        if (live && !usernameTouched.current && res.suggestions[0]) setUsername(res.suggestions[0]);
      },
      () => {
        // No prefill — the field stays for the person to fill.
      },
    );
    return () => {
      live = false;
    };
  }, [invitedEmail]);

  const changeUsername = (value: string) => {
    usernameTouched.current = true;
    setUsername(value);
    setFieldErrors((prev) => ({ ...prev, username: undefined }));
    setSuggestions([]);
  };

  const generate = async () => {
    const trimmed = email.trim();
    if (!EMAIL_SHAPE.test(trimmed)) {
      setFieldErrors((prev) => ({ ...prev, email: t('errors.email') }));
      return;
    }
    setGenerating(true);
    setFormError(null);
    try {
      const res = await getUsernameSuggestions(trimmed);
      if (res.suggestions[0]) changeUsername(res.suggestions[0]);
    } catch (err) {
      setFormError(t(refusalKey(err)));
    } finally {
      setGenerating(false);
    }
  };

  const showRefusal = (err: unknown) => {
    const code = refusalCode(err);
    switch (code) {
      case AccountErrorCode.EmailTaken:
        setFieldErrors({
          email: (
            <>
              {t('codes.emailTaken')} <Link to="/login">{t('links.signIn')}</Link>
            </>
          ),
        });
        return;
      case AccountErrorCode.UsernameTaken: {
        const offered =
          err instanceof BusinessError && Array.isArray(err.extra.suggestions)
            ? err.extra.suggestions.filter((s): s is string => typeof s === 'string')
            : [];
        setFieldErrors({ username: t('codes.usernameTaken') });
        setSuggestions(offered);
        return;
      }
      case AccountErrorCode.UsernameInvalid:
        setFieldErrors({ username: t('codes.usernameInvalid') });
        return;
      case AccountErrorCode.PasswordWeak:
      case AccountErrorCode.PasswordPwned:
        setFieldErrors({ password: t(refusalKey(err)) });
        return;
      case AccountErrorCode.InvitationInvalid:
      case AccountErrorCode.SpaceDeleted:
        if (onInvitationGone) {
          onInvitationGone(code);
          return;
        }
        setFormError(t(refusalKey(err)));
        return;
      default:
        setFormError(t(refusalKey(err)));
    }
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting || !terms) return;
    setFormError(null);
    setFieldErrors({});
    setSuggestions([]);
    const trimmedEmail = email.trim();
    if (!invitation && !EMAIL_SHAPE.test(trimmedEmail)) {
      setFieldErrors({ email: t('errors.email') });
      return;
    }
    const turnstileToken = siteKey !== null ? captcha.token : null;
    if (siteKey !== null && turnstileToken === null) return;
    setSubmitting(true);
    try {
      const result = invitation
        ? await signupByInvitation(invitation.token, {
            username: username.trim(),
            password,
            termsAccepted: terms,
            turnstileToken,
          })
        : await signupApi({
            email: trimmedEmail,
            username: username.trim(),
            password,
            termsAccepted: terms,
            turnstileToken,
            language: emailLanguage(i18n.language),
          });
      // Open registration stays in this document: the answer is the
      // session's user from now on. Registration by invitation leaves for
      // the space with a document load (`InvitePage.tsx`), which reads the
      // session afresh — setting it here would first redraw the link page
      // as a signed-in one.
      if (!invitation) queryClient.setQueryData<User | null>(ME_KEY, result);
      onSignedUp(result);
    } catch (err) {
      if (siteKey !== null) setCaptcha((prev) => ({ id: prev.id + 1, token: null }));
      showRefusal(err);
    } finally {
      setSubmitting(false);
    }
  };

  const waitingForCaptcha = siteKey !== null && captcha.token === null;

  return (
    <form className="login-form" onSubmit={handleSubmit} noValidate>
      <TextInput
        label={t('emailLabel')}
        placeholder={t('emailPlaceholder')}
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(e) => {
          setEmail(e.currentTarget.value);
          setFieldErrors((prev) => ({ ...prev, email: undefined }));
        }}
        readOnly={invitation !== undefined}
        disabled={submitting}
        error={fieldErrors.email}
      />
      <Stack gap={6}>
        <TextInput
          label={t('signup.usernameLabel')}
          description={t('signup.usernameHint')}
          autoComplete="username"
          required
          value={username}
          onChange={(e) => changeUsername(e.currentTarget.value)}
          disabled={submitting}
          error={fieldErrors.username}
        />
        <Group gap="xs">
          <Button
            type="button"
            variant="default"
            size="xs"
            onClick={() => void generate()}
            loading={generating}
            disabled={submitting}
          >
            {t('signup.generate')}
          </Button>
        </Group>
        {suggestions.length > 0 ? (
          <Group gap="xs" role="group" aria-label={t('signup.suggestions')}>
            <Text size="xs" c="var(--ink-2)" aria-hidden>
              {t('signup.suggestions')}
            </Text>
            {suggestions.map((name) => (
              <Button key={name} type="button" variant="default" size="xs" onClick={() => changeUsername(name)}>
                {name}
              </Button>
            ))}
          </Group>
        ) : null}
      </Stack>
      <Stack gap={6}>
        <PasswordInput
          label={t('signup.passwordLabel')}
          autoComplete="new-password"
          required
          value={password}
          onChange={(e) => {
            setPassword(e.currentTarget.value);
            setFieldErrors((prev) => ({ ...prev, password: undefined }));
          }}
          visible={passwordVisible}
          onVisibilityChange={setPasswordVisible}
          visibilityToggleButtonProps={{
            tabIndex: 0,
            'aria-label': passwordVisible ? t('hidePassword') : t('showPassword'),
            'aria-pressed': passwordVisible,
          }}
          disabled={submitting}
          error={fieldErrors.password}
        />
        <PasswordStrengthMeter password={password} />
      </Stack>
      <ConsentCheckbox
        checked={terms}
        onChange={setTerms}
        termsUrl={config.termsUrl}
        privacyUrl={config.privacyUrl}
        disabled={submitting}
      />
      {siteKey !== null ? (
        captchaBroken ? (
          <FormError>{t('signup.captchaLoadError')}</FormError>
        ) : (
          <Turnstile
            key={captcha.id}
            siteKey={siteKey}
            onToken={(token) => {
              const id = captcha.id;
              // A late callback of a replaced challenge changes nothing.
              setCaptcha((prev) => (prev.id === id ? { ...prev, token } : prev));
            }}
            onLoadError={() => setCaptchaBroken(true)}
          />
        )
      ) : null}
      {formError !== null ? <FormError>{formError}</FormError> : null}
      {waitingForCaptcha && terms && !captchaBroken ? (
        <p className="login-note">{t('signup.captchaPending')}</p>
      ) : null}
      <Button
        type="submit"
        variant="filled"
        color="orange"
        fullWidth
        className="login-submit"
        loading={submitting}
        disabled={!terms || waitingForCaptcha}
      >
        {submitting
          ? t('signup.submitting')
          : invitation
            ? t('invite.signupSubmit', { name: invitation.space.name })
            : t('signup.submit')}
      </Button>
    </form>
  );
}
