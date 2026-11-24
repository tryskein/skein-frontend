import { FormEvent, useState } from 'react';
import { Button, PasswordInput, Stack } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { Navigate, useParams } from 'react-router';
import { AccountErrorCode, completePasswordReset } from '../api/auth';
import { useAuth } from '../auth/AuthContext';
import { useAuthConfig } from '../lib/useAuthConfig';
import { MailOffNote } from './ForgotPasswordPage';
import {
  FormError,
  PasswordStrengthMeter,
  PublicLoading,
  PublicPage,
  refusalCode,
  refusalKey,
  useNoReferrer,
} from './publicAuth';

/**
 * sk-674.18 T059 — a new password by the reset link
 * `/reset-password/:token` (screens 2.8, spec US-9), public; the gates of
 * `/forgot-password` (`keycloak` → `/login`, mail off → the honest text).
 *
 * The answer is 204 with a NEW session of the link's owner (see
 * `api/auth.ts#completePasswordReset`): every session of the account ends,
 * API keys keep working, the cookie this browser sent is revoked whoever it
 * belonged to, and the 204 sets a cookie of the owner's new session, whatever
 * cookie came in. Success says "Password changed"; the link under it is
 * chosen by `user` as loaded before the submit (open the app if someone was
 * signed in here, otherwise sign in), not by the session the 204 issued. A
 * dead link ("Link expired") offers a new one.
 *
 * Leaving is a document load (see `InvitePage.tsx`): this document carries
 * the token pages' headers.
 */
export function ResetPasswordPage() {
  const { t } = useTranslation('auth');
  const { token = '' } = useParams<{ token: string }>();
  const { user } = useAuth();
  const config = useAuthConfig();
  useNoReferrer();
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<'form' | 'done' | 'expired'>('form');
  const [submitting, setSubmitting] = useState(false);

  const title = t('reset.title');
  if (config.isLoading) {
    return (
      <PublicPage title={title} titleId="reset-title">
        <PublicLoading />
      </PublicPage>
    );
  }
  if (config.isError || !config.data) {
    return (
      <PublicPage title={title} titleId="reset-title">
        <FormError>{t('configErrorBody')}</FormError>
        <Button type="button" fullWidth className="login-submit" onClick={() => config.refetch()}>
          {t('retry')}
        </Button>
      </PublicPage>
    );
  }
  if (config.data.authMode === 'keycloak') return <Navigate to="/login" replace />;
  if (!config.data.emailEnabled) {
    return (
      <PublicPage title={title} titleId="reset-title">
        <MailOffNote />
      </PublicPage>
    );
  }

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting || !password) return;
    setError(null);
    setFieldError(null);
    setSubmitting(true);
    try {
      await completePasswordReset(token, password);
      setState('done');
    } catch (err) {
      const code = refusalCode(err);
      if (code === AccountErrorCode.TokenInvalid) setState('expired');
      else if (code === AccountErrorCode.PasswordWeak || code === AccountErrorCode.PasswordPwned)
        setFieldError(t(refusalKey(err)));
      else setError(t(refusalKey(err)));
    } finally {
      setSubmitting(false);
    }
  };

  if (state === 'done') {
    return (
      <PublicPage title={title} titleId="reset-title">
        <p className="login-note" role="status">
          {t('reset.done')}
        </p>
        <a className="public-link" href={user ? '/' : '/login'}>
          {user ? t('reset.openApp') : t('links.signIn')}
        </a>
      </PublicPage>
    );
  }
  if (state === 'expired') {
    return (
      <PublicPage title={title} titleId="reset-title">
        <p className="login-note" role="status">
          {t('codes.tokenInvalid')}
        </p>
        <a className="public-link" href="/forgot-password">
          {t('reset.requestNew')}
        </a>
      </PublicPage>
    );
  }

  return (
    <PublicPage title={title} titleId="reset-title">
      <form className="login-form" onSubmit={handleSubmit} noValidate>
        <Stack gap={6}>
          <PasswordInput
            label={t('reset.passwordLabel')}
            autoComplete="new-password"
            autoFocus
            required
            value={password}
            onChange={(e) => {
              setPassword(e.currentTarget.value);
              setFieldError(null);
            }}
            visible={passwordVisible}
            onVisibilityChange={setPasswordVisible}
            visibilityToggleButtonProps={{
              tabIndex: 0,
              'aria-label': passwordVisible ? t('hidePassword') : t('showPassword'),
              'aria-pressed': passwordVisible,
            }}
            disabled={submitting}
            error={fieldError}
          />
          <PasswordStrengthMeter password={password} />
        </Stack>
        {error !== null ? <FormError>{error}</FormError> : null}
        <Button
          type="submit"
          variant="filled"
          color="orange"
          fullWidth
          className="login-submit"
          loading={submitting}
          disabled={!password}
        >
          {submitting ? t('reset.submitting') : t('reset.submit')}
        </Button>
      </form>
    </PublicPage>
  );
}
