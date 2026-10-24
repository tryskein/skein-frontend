import { FormEvent, useState } from 'react';
import { Button, TextInput } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { Link, Navigate } from 'react-router-dom';
import { requestPasswordReset } from '../api/auth';
import { emailLanguage } from '../lib/emailLanguage';
import { useAuthConfig } from '../lib/useAuthConfig';
import { EMAIL_SHAPE, FormError, PublicLoading, PublicPage, refusalKey } from './publicAuth';

/**
 * sk-674.18 T059 — "Password recovery" `/forgot-password` (screens
 * 2.8, spec US-9), public.
 *
 * Only where a password signs in (`local`, `hybrid`); in `keycloak` there
 * is no password and the route leads to `/login`. With mail off the route
 * stays and says so honestly, with a way to sign in (K10) — the link to it
 * is gone from the sign-in page, a direct visit gets the reason, not a
 * redirect.
 *
 * The answer to a request is one and the same whether or not an account
 * with the address exists (the server's 204 is neutral, plan 6.1); the
 * page shows that one text.
 */
export function ForgotPasswordPage() {
  const { t, i18n } = useTranslation('auth');
  const config = useAuthConfig();
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const title = t('forgot.title');
  if (config.isLoading) {
    return (
      <PublicPage title={title} titleId="forgot-title">
        <PublicLoading />
      </PublicPage>
    );
  }
  if (config.isError || !config.data) {
    return (
      <PublicPage title={title} titleId="forgot-title">
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
      <PublicPage title={title} titleId="forgot-title">
        <MailOffNote />
      </PublicPage>
    );
  }

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setEmailError(null);
    const trimmed = email.trim();
    if (!EMAIL_SHAPE.test(trimmed)) {
      setEmailError(t('errors.email'));
      return;
    }
    setSubmitting(true);
    try {
      await requestPasswordReset(trimmed, emailLanguage(i18n.language));
      setSent(true);
    } catch (err) {
      setError(t(refusalKey(err)));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PublicPage title={title} titleId="forgot-title">
      {sent ? (
        <p className="login-note" role="status">
          {t('forgot.sent')}
        </p>
      ) : (
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
            error={emailError}
          />
          {error !== null ? <FormError>{error}</FormError> : null}
          <Button
            type="submit"
            variant="filled"
            color="orange"
            fullWidth
            className="login-submit"
            loading={submitting}
          >
            {submitting ? t('forgot.submitting') : t('forgot.submit')}
          </Button>
        </form>
      )}
      <p className="login-note public-switch">
        <Link to="/login">{t('links.signIn')}</Link>
      </p>
    </PublicPage>
  );
}

/**
 * Screens 2.8 "Mail is off": the reason and the way on — the password
 * is reset by an administrator in "Users".
 */
export function MailOffNote() {
  const { t } = useTranslation('auth');
  return (
    <>
      <p className="login-note" role="status">
        {t('codes.emailDisabled')}
      </p>
      <a className="public-link" href="/login">
        {t('links.signIn')}
      </a>
    </>
  );
}
