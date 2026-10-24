import { useEffect, useState } from 'react';
import { Button, Loader, Text } from '@mantine/core';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getMyAccount, requestEmailConfirmation, type MyAccount } from '../../../api/account';
import type { EmailLanguage } from '../../../api/auth';
import { BusinessError, RateLimitError } from '../../../api/client';
import { SpaceErrorCode } from '../../../api/spaces';
import { useAuth } from '../../../auth/AuthContext';
import { useAuthConfig } from '../../../lib/useAuthConfig';
import { CONFIRMATION_RESEND_COOLDOWN_MS } from '../../shell/InvitationCard';
import { AccountDeletionDialog } from './AccountDeletionDialog';
import { SettingsLayout, SettingsPanel } from './SettingsLayout';

/**
 * sk-674.18 T058 — the «Account» tab, `/settings/account` (screens 2.9,
 * 2.13, 1.14; plan 6, 6.1, 8). Every person, external ones too.
 *
 *   Email      dev@client.io    ⚠ not confirmed   [Send email]
 *              Confirmation is needed to accept invitations …
 *   Username   dev              (read only)
 *   Danger zone   [ Delete account ]      ← registration open only
 *
 * The confirmation status is shown only where it means something: mail is
 * on (`emailEnabled`; with mail off the requirement does not apply, plan 6)
 * and the email is not confirmed by the identity provider — a person who
 * came through SSO has the email line without a status and without the
 * button (screens 2.9). The instance tells SSO by `authMode`: under
 * `keycloak` every account comes through it. Under `hybrid` the account
 * read (`GET /api/v1/auth/me`) does not say how this person signed in, so
 * the status follows `emailConfirmed` — an SSO account is confirmed by the
 * closed set of US-5 and reads "✓ confirmed".
 *
 * "Send email" is off for a minute after a send or a rate-limit
 * answer, then on again (E-26; the same pause as the invitation card,
 * `InvitationCard.tsx#CONFIRMATION_RESEND_COOLDOWN_MS`).
 *
 * The danger zone with account deletion exists only with self-service
 * registration (`signupEnabled`); in a corporate instance accounts are the
 * admin's (deactivation).
 */

/** i18next language → the language of the confirmation email. */
function emailLanguage(language: string): EmailLanguage {
  return language.toLowerCase().startsWith('ru') ? 'ru' : 'en';
}

export function myAccountQueryKey(userId: string) {
  return ['me', 'account', userId] as const;
}

export function AccountPage() {
  const { t, i18n } = useTranslation('account');
  const { user } = useAuth();
  const config = useAuthConfig().data;
  const accountQ = useQuery<MyAccount>({
    queryKey: myAccountQueryKey(user?.id ?? ''),
    queryFn: getMyAccount,
    enabled: user !== null,
  });
  const account = accountQ.data;

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  // The send is off until this moment (E-26); null — on.
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  useEffect(() => {
    if (cooldownUntil === null) return;
    const timer = setTimeout(() => setCooldownUntil(null), Math.max(0, cooldownUntil - Date.now()));
    return () => clearTimeout(timer);
  }, [cooldownUntil]);
  const startCooldown = () => setCooldownUntil(Date.now() + CONFIRMATION_RESEND_COOLDOWN_MS);

  const send = useMutation({
    mutationFn: () => requestEmailConfirmation(emailLanguage(i18n.language)),
    onSuccess: () => {
      startCooldown();
      setSendError(null);
      setSentTo(account?.email ?? '');
    },
    onError: (err) => {
      setSentTo(null);
      if (err instanceof RateLimitError) {
        startCooldown();
        setSendError(t('rateLimited'));
      } else if (err instanceof BusinessError && err.code === SpaceErrorCode.EmailDisabled) {
        setSendError(t('emailDisabled'));
      } else {
        setSendError(t('confirmationFailed'));
      }
    },
  });

  const showStatus =
    config !== undefined && config.emailEnabled && config.authMode !== 'keycloak' && account !== undefined;
  const confirmed = account?.emailConfirmed === true;
  const showDanger = config?.signupEnabled === true;

  return (
    <SettingsLayout active="account">
      <SettingsPanel title={t('title')}>
        {accountQ.isLoading ? (
          <div className="settings-loading" role="status">
            <Loader size="sm" aria-hidden />
            <span className="sr-only">{t('loading')}</span>
          </div>
        ) : accountQ.isError || account === undefined ? (
          <div role="alert" className="settings-load-error">
            <Text size="sm">{t('loadFailed')}</Text>
            <Button variant="default" size="sm" loading={accountQ.isFetching} onClick={() => void accountQ.refetch()}>
              {t('retry')}
            </Button>
          </div>
        ) : (
          <dl className="account-facts">
            <dt>{t('email')}</dt>
            <dd>
              <span className="account-email">{account.email}</span>
              {showStatus ? (
                confirmed ? (
                  <span className="account-status account-status-ok">{t('confirmed')}</span>
                ) : (
                  <>
                    <span className="account-status account-status-warn">{t('unconfirmed')}</span>
                    <Button
                      variant="default"
                      size="compact-sm"
                      onClick={() => send.mutate()}
                      loading={send.isPending}
                      disabled={cooldownUntil !== null}
                    >
                      {t('sendConfirmation')}
                    </Button>
                    <span className="account-hint">{t('confirmationHint')}</span>
                    {sentTo !== null ? (
                      <span className="account-hint" role="status">
                        {t('confirmationSent', { email: sentTo })}
                      </span>
                    ) : null}
                    {sendError !== null ? (
                      <span className="account-hint" role="alert">
                        {sendError}
                      </span>
                    ) : null}
                  </>
                )
              ) : null}
            </dd>
            <dt>{t('username')}</dt>
            <dd>
              <code>{account.username}</code> <span className="account-hint-inline">({t('readOnly')})</span>
            </dd>
          </dl>
        )}
      </SettingsPanel>

      {showDanger ? (
        <SettingsPanel title={t('dangerTitle')}>
          <Button color="red" onClick={() => setDeleteOpen(true)}>
            {t('deleteAccount')}
          </Button>
        </SettingsPanel>
      ) : null}

      {deleteOpen ? <AccountDeletionDialog onClose={() => setDeleteOpen(false)} /> : null}
    </SettingsLayout>
  );
}
