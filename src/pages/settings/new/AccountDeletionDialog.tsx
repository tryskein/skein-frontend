import { useState } from 'react';
import { Button, Group, Loader, Modal, PasswordInput, Stack, Text } from '@mantine/core';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { deleteMyAccount, getAccountDeletionPreview } from '../../../api/account';
import { BusinessError } from '../../../api/client';
import { useAuth } from '../../../auth/AuthContext';
import { spaceHandle } from '../../../lib/shellUrlState';

/**
 * sk-674.18 T058 — deleting one's own account (screens 2.13, plan 8; only
 * with registration open — the «Account» tab offers it then alone).
 *
 * First what blocks it, from `GET /me/deletion-preview`: spaces the person
 * owns with other people in them (each with a link to its settings —
 * ownership cannot be handed over yet, so they are deleted first), or the
 * common space («ask the administrator to change the owner»). Otherwise the
 * consequences, then the password (decision No. 9). After the server answers,
 * every session of the account is gone: the tab signs out and lands on the
 * public "Account deleted" page (screens 2.13, `AccountDeletedPage.tsx`).
 */
export function AccountDeletionDialog({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation('account');
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');

  const preview = useQuery({
    queryKey: ['me', 'deletion-preview'],
    queryFn: getAccountDeletionPreview,
    gcTime: 0,
    staleTime: 0,
  });
  const run = useMutation({
    mutationFn: () => deleteMyAccount(password),
    onSuccess: async () => {
      try {
        // The server has revoked the session already; the logout clears
        // what the tab still holds.
        await logout();
      } catch {
        // A failed logout call changes nothing here: the local state is
        // cleared in its `onSettled` either way.
      }
      navigate('/account-deleted', { replace: true });
    },
  });

  const err = run.error;
  const errorText =
    err === null
      ? null
      : err instanceof BusinessError && i18n.exists(`account:deletion.errors.${err.code}`)
        ? t(`deletion.errors.${err.code}`)
        : t('deletion.failed');

  const p = preview.data;
  const ownsCommon = p?.blocking.some((sp) => sp.kind === 'common') ?? false;
  const blockingOthers = p?.blocking.filter((sp) => sp.kind !== 'common') ?? [];
  const blocked = p !== undefined && p.blocking.length > 0;
  const others = p?.deleted.filter((sp) => sp.kind !== 'personal') ?? [];

  return (
    <Modal
      opened
      onClose={onClose}
      title={blocked ? t('deletion.blockedTitle') : t('deletion.title')}
      centered
      withinPortal
    >
      {preview.isLoading ? (
        <div className="settings-loading" role="status">
          <Loader size="sm" aria-hidden />
          <span className="sr-only">{t('deletion.loading')}</span>
        </div>
      ) : preview.isError || p === undefined ? (
        <div role="alert">
          <Text size="sm">{t('deletion.previewFailed')}</Text>
          <Button variant="default" size="xs" mt="xs" onClick={() => void preview.refetch()}>
            {t('deletion.retry')}
          </Button>
        </div>
      ) : blocked ? (
        <Stack gap="sm">
          {blockingOthers.length > 0 ? (
            <>
              <Text size="sm">{t('deletion.blockedIntro')}</Text>
              <ul className="space-consequences">
                {blockingOthers.map((sp) => (
                  <li key={sp.id}>
                    {t('deletion.blockedMembers', { name: sp.name, count: sp.memberCount })}{' '}
                    <Link to={`/settings/spaces/${spaceHandle(sp)}`}>{t('deletion.openSettings')}</Link>
                  </li>
                ))}
              </ul>
              <Text size="sm">{t('deletion.blockedOutro')}</Text>
            </>
          ) : null}
          {ownsCommon ? <Text size="sm">{t('deletion.ownsCommon')}</Text> : null}
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              {t('deletion.close')}
            </Button>
          </Group>
        </Stack>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (password !== '') run.mutate();
          }}
        >
          <Stack gap="sm">
            <ul className="space-consequences">
              <li>{t('deletion.now')}</li>
              <li>
                {others.length > 0
                  ? t('deletion.spaces', {
                      list: others
                        .map((sp) => t('deletion.spaceItem', { name: sp.name, count: sp.projectCount }))
                        .join(', '),
                    })
                  : t('deletion.personalOnly')}
              </li>
              <li>
                {p.openAssignedIssues > 0
                  ? t('deletion.assigned', { count: p.openAssignedIssues })
                  : t('deletion.noAssigned')}
              </li>
              <li>{t('deletion.keys')}</li>
              <li>{t('deletion.names')}</li>
            </ul>
            <PasswordInput
              label={t('deletion.password')}
              value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
              error={errorText ?? undefined}
              autoComplete="current-password"
            />
            <Group justify="flex-end" gap="sm">
              <Button variant="default" onClick={onClose} disabled={run.isPending}>
                {t('deletion.cancel')}
              </Button>
              <Button color="red" type="submit" loading={run.isPending} disabled={password === ''}>
                {t('deletion.confirm')}
              </Button>
            </Group>
          </Stack>
        </form>
      )}
    </Modal>
  );
}
