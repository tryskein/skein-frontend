import { useEffect, useRef } from 'react';
import { Button } from '@mantine/core';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { AccountErrorCode, confirmEmail } from '../api/auth';
import { TAB_PARAM } from '../lib/shellUrlState';
import { useAuthConfig } from '../lib/useAuthConfig';
import { FormError, PublicLoading, PublicPage, refusalCode, refusalKey, useNoReferrer } from './publicAuth';

/** The Inbox tab of the shell, opened by "Open Inbox" (screens 2.9, K8). */
const INBOX_PATH = `/?${TAB_PARAM}=inbox`;

/**
 * sk-674.18 T059 — the link of the confirmation email
 * `/confirm-email/:token` (screens 2.9, spec US-5/US-9), public.
 *
 * Opening the link confirms: the page sends the token once and shows the
 * outcome — "Email confirmed" with "Open Inbox" (pending invitations
 * there can be accepted now), or "Link expired" with the way to send a
 * new email from the settings. With mail off there is nothing to confirm,
 * and the page says that instead of sending.
 *
 * Leaving is a document load (see `InvitePage.tsx`): this document carries
 * the token pages' headers.
 */
export function ConfirmEmailPage() {
  const { t } = useTranslation('auth');
  const { token = '' } = useParams<{ token: string }>();
  const config = useAuthConfig();
  useNoReferrer();

  const confirm = useMutation({ mutationFn: () => confirmEmail(token) });
  const emailEnabled = config.data?.emailEnabled === true;
  // Once per page: a token is single-use, a second send would answer
  // `token_invalid` over a success already shown.
  const sent = useRef(false);
  const { mutate } = confirm;
  useEffect(() => {
    if (!emailEnabled || sent.current) return;
    sent.current = true;
    mutate();
  }, [emailEnabled, mutate]);

  const title = t('confirm.title');
  if (config.isLoading) {
    return (
      <PublicPage title={title} titleId="confirm-title">
        <PublicLoading />
      </PublicPage>
    );
  }
  if (config.isError || !config.data) {
    return (
      <PublicPage title={title} titleId="confirm-title">
        <FormError>{t('configErrorBody')}</FormError>
        <Button type="button" fullWidth className="login-submit" onClick={() => config.refetch()}>
          {t('retry')}
        </Button>
      </PublicPage>
    );
  }
  if (!config.data.emailEnabled) {
    return (
      <PublicPage title={title} titleId="confirm-title">
        <p className="login-note" role="status">
          {t('confirm.emailDisabled')}
        </p>
      </PublicPage>
    );
  }
  if (confirm.isSuccess) {
    return (
      <PublicPage title={t('confirm.done')} titleId="confirm-title">
        <a className="public-link" href={INBOX_PATH}>
          {t('confirm.openInbox')}
        </a>
      </PublicPage>
    );
  }
  if (confirm.isError) {
    const code = refusalCode(confirm.error);
    if (code === AccountErrorCode.TokenInvalid) {
      return (
        <PublicPage title={title} titleId="confirm-title">
          <p className="login-note" role="status">
            {t('confirm.expired')}
          </p>
          <a className="public-link" href="/settings/account">
            {t('confirm.openSettings')}
          </a>
        </PublicPage>
      );
    }
    if (code === AccountErrorCode.EmailDisabled) {
      return (
        <PublicPage title={title} titleId="confirm-title">
          <p className="login-note" role="status">
            {t('confirm.emailDisabled')}
          </p>
        </PublicPage>
      );
    }
    return (
      <PublicPage title={title} titleId="confirm-title">
        <FormError>{t(refusalKey(confirm.error))}</FormError>
        <Button type="button" fullWidth className="login-submit" onClick={() => mutate()}>
          {t('retry')}
        </Button>
      </PublicPage>
    );
  }
  return (
    <PublicPage title={title} titleId="confirm-title">
      <p className="login-note" role="status">
        {t('confirm.confirming')}
      </p>
    </PublicPage>
  );
}
