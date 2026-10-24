import { useState } from 'react';
import { Button, Loader, Modal, NativeSelect, Stack, Table, Text, TextInput } from '@mantine/core';
import { IconPlus, IconSettings } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../../auth/AuthContext';
import { BusinessError } from '../../../api/client';
import { createSpace, SpaceErrorCode, type MySpace } from '../../../api/spaces';
import { listUsers } from '../../../api/users';
import { SkeinTooltip } from '../../../components/SkeinTooltip';
import { InvitationCard } from '../../shell/InvitationCard';
import { projectsListQueryKey } from '../../../lib/projectHandleCache';
import { quotaLines } from '../../../lib/spaceQuota';
import { spaceHandle } from '../../../lib/shellUrlState';
import { useMyInvitations } from '../../../lib/useMyInvitations';
import { MY_SPACES_QUERY_PREFIX, useMySpaces } from '../../../lib/useMySpaces';
import { SettingsLayout, SettingsPanel } from './SettingsLayout';

/**
 * sk-674.18 T057 — the «Spaces» tab, `/settings/spaces` (screens 2.1, 2.2;
 * plan 4.2, 4.5; K1, K3, K11, K16). Everyone but an external user (they are
 * outside the rules of spaces); shown with one space too — it is where the
 * invitations to me are seen and a second space is created.
 *
 *  - "Invitations" — the same cards as in Inbox (`InvitationCard`), on the
 *    same terms (a confirmed email where mail is on).
 *  - "Your spaces: 2 of 3" when `SKEIN_SPACE_OWNED_LIMIT` is set; it
 *    may read "4 of 3" (the limit was lowered, or an admin gave one).
 *  - The table, in the column order the server gives (personal → common →
 *    the rest by name): name, kind, my role (or "— admin access" for the
 *    admin's spaces he is not in, K1), the number of members ("—" for
 *    "Personal"). Under "Personal" its quotas, only those set. sk-733.2 — the
 *    names are plain text (the owner: a name that led "Personal" into the
 *    shell and the rest into settings read as one control doing two
 *    things); the settings of a space are a ⚙ button at the end of its
 *    row, named "Space settings <name>". "Personal" has no settings,
 *    so no ⚙ and its row leads nowhere.
 *  - "New space" answers as the server would (`canCreate` and
 *    `cannotCreateReason` of GET /me/spaces — the code POST /spaces would
 *    return): off with "Your spaces: 3 of 3" at the owned limit, off
 *    with "New spaces are created by the administrator" when only the admin
 *    may, absent when creation is off on the instance.
 *
 * Counts here are people and spaces, not issues: the lenses and
 * `outboxMode` do not apply.
 */
export function SpacesPage() {
  const { t, i18n } = useTranslation('spaces');
  const { user } = useAuth();
  const spacesQ = useMySpaces();
  const invitationsQ = useMyInvitations();
  const [createOpen, setCreateOpen] = useState(false);

  // Hooks above; the gate on derived state (as `UsersPage.tsx#NewUsersPage`).
  if (user?.isExternal === true) return <Navigate to="/settings/password" replace />;

  const data = spacesQ.data;
  const invitations = invitationsQ.data?.items ?? [];
  const reason = data?.cannotCreateReason ?? null;
  const ownedLabel =
    data !== undefined && data.ownedLimit !== null
      ? t('quota.owned', { owned: data.ownedCount, limit: data.ownedLimit })
      : null;
  const showCreate = data !== undefined && reason !== SpaceErrorCode.SpaceCreationDisabled && reason !== SpaceErrorCode.ExternalUser;
  // The reason the button is off. At the owned limit it IS the "Your
  // spaces: N of M" line already above — said once, the button
  // pointing at it; only «admin only» needs a text of its own.
  const ownedLineId = 'spaces-owned-line';
  const describedBy =
    data?.canCreate !== false
      ? undefined
      : reason === SpaceErrorCode.OwnedLimit && ownedLabel !== null
        ? ownedLineId
        : reason === SpaceErrorCode.AdminOnly
          ? 'spaces-create-reason'
          : undefined;

  return (
    <SettingsLayout active="spaces">
      {invitations.length > 0 ? (
        <SettingsPanel title={t('list.invitationsTitle')}>
          <div className="settings-invitations">
            {invitations.map((inv) => (
              <InvitationCard key={inv.id} invitation={inv} />
            ))}
          </div>
        </SettingsPanel>
      ) : null}

      <SettingsPanel
        title={t('list.mineTitle')}
        description={ownedLabel ?? undefined}
        descriptionId={ownedLineId}
        actions={
          showCreate ? (
            <div className="spaces-create">
              <Button
                size="sm"
                disabled={!data.canCreate}
                aria-describedby={describedBy}
                onClick={() => setCreateOpen(true)}
                leftSection={<IconPlus size={16} stroke={1.75} aria-hidden />}
              >
                {t('list.newSpace')}
              </Button>
              {!data.canCreate && reason === SpaceErrorCode.AdminOnly ? (
                <Text size="sm" id="spaces-create-reason" className="spaces-create-reason">
                  {t('list.adminOnly')}
                </Text>
              ) : null}
            </div>
          ) : undefined
        }
      >
        {spacesQ.isLoading ? (
          <div className="settings-loading" role="status">
            <Loader size="sm" aria-hidden />
            <span className="sr-only">{t('list.loading')}</span>
          </div>
        ) : spacesQ.isError || data === undefined ? (
          <div role="alert" className="settings-load-error">
            <Text size="sm">{t('list.loadFailed')}</Text>
            <Button variant="default" size="sm" mt="xs" loading={spacesQ.isFetching} onClick={() => void spacesQ.refetch()}>
              {t('list.retry')}
            </Button>
          </div>
        ) : (
          <SpacesTable spaces={data.items} language={i18n.language} />
        )}
      </SettingsPanel>

      {createOpen ? <CreateSpaceDialog onClose={() => setCreateOpen(false)} /> : null}
    </SettingsLayout>
  );
}

function SpacesTable({ spaces, language }: { spaces: MySpace[]; language: string }) {
  const { t } = useTranslation('spaces');
  return (
    <Table verticalSpacing="xs">
      <Table.Caption className="sr-only">{t('list.caption')}</Table.Caption>
      <Table.Thead>
        <Table.Tr>
          <Table.Th scope="col">{t('list.col.name')}</Table.Th>
          <Table.Th scope="col">{t('list.col.kind')}</Table.Th>
          <Table.Th scope="col">{t('list.col.role')}</Table.Th>
          <Table.Th scope="col">{t('list.col.members')}</Table.Th>
          <Table.Th scope="col">
            <span className="sr-only">{t('list.col.settings')}</span>
          </Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {spaces.flatMap((sp) => {
          const personal = sp.kind === 'personal';
          const name = personal ? t('list.personal') : sp.name;
          const role =
            sp.myRole !== null
              ? t(`list.role.${sp.myRole}`)
              : sp.adminAccess
                ? `— ${t('list.role.adminAccess')}`
                : '';
          const rows = [
            <Table.Tr key={sp.id}>
              <Table.Td className="spaces-row-name">{name}</Table.Td>
              <Table.Td>{sp.kind === 'regular' ? '' : t(`list.kind.${sp.kind}`)}</Table.Td>
              <Table.Td>{role}</Table.Td>
              <Table.Td>{personal ? t('list.noMembers') : sp.memberCount}</Table.Td>
              <Table.Td className="spaces-row-actions">
                {personal ? null : (
                  <SkeinTooltip content={t('list.settingsAria', { name })} position="top">
                    <Link
                      to={`/settings/spaces/${spaceHandle(sp)}`}
                      className="spaces-row-settings"
                      aria-label={t('list.settingsAria', { name })}
                    >
                      <IconSettings size={18} stroke={1.75} aria-hidden />
                    </Link>
                  </SkeinTooltip>
                )}
              </Table.Td>
            </Table.Tr>,
          ];
          // Under "Personal" — its quotas, only those set (K3).
          const quotas = personal ? quotaLines(t, sp, language, true) : [];
          if (quotas.length > 0) {
            rows.push(
              <Table.Tr key={`${sp.id}-quota`} className="spaces-quota-row">
                <Table.Td colSpan={5}>{quotas.join(' · ')}</Table.Td>
              </Table.Tr>,
            );
          }
          return rows;
        })}
      </Table.Tbody>
    </Table>
  );
}

/**
 * Creating a space (screens 2.2, plan 4.2, K11, K16): a name (not unique,
 * nothing to check), and for the admin the owner — himself by default, any
 * active account but an external one. An admin naming someone else does
 * not become a member (he keeps owner rights by K5). After creation — the
 * settings of the new space with the invitation form over them.
 */
function CreateSpaceDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('spaces');
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const isAdmin = user?.role === 'admin';

  const [name, setName] = useState('');
  const [ownerSearch, setOwnerSearch] = useState('');
  // null — the admin himself (the server's default: ownerId omitted). The
  // pick is kept with its label: a new search must not drop it from the list.
  const [owner, setOwner] = useState<{ id: string; label: string } | null>(null);

  const owners = useQuery({
    queryKey: ['spaces', 'owner-candidates', ownerSearch.trim()],
    queryFn: () => listUsers({ search: ownerSearch.trim() || undefined, external: false, limit: 20 }),
    enabled: isAdmin,
    staleTime: 30_000,
  });

  const create = useMutation({
    mutationFn: () =>
      createSpace({ name: name.trim(), ...(isAdmin && owner !== null ? { ownerId: owner.id } : {}) }),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: MY_SPACES_QUERY_PREFIX });
      void qc.invalidateQueries({ queryKey: projectsListQueryKey });
      onClose();
      navigate(`/settings/spaces/${spaceHandle(res)}?invite=1`);
    },
  });

  const err = create.error;
  const errorText =
    err === null
      ? null
      : err instanceof BusinessError && err.code === SpaceErrorCode.OwnedLimit
        ? t('create.errors.owned_limit', { owned: err.extra.ownedCount, limit: err.extra.ownedLimit })
        : err instanceof BusinessError &&
            (err.code === SpaceErrorCode.AdminOnly ||
              err.code === SpaceErrorCode.SpaceCreationDisabled ||
              err.code === SpaceErrorCode.ExternalUser)
          ? t(`create.errors.${err.code}`)
          : err instanceof Error && err.message
            ? err.message
            : t('create.failed');

  const personLabel = (u: { username: string; name: string }) =>
    u.name ? `${u.username} — ${u.name}` : u.username;
  const found = (owners.data?.items ?? [])
    .filter((u) => u.id !== user?.id && !u.isExternal)
    .map((u) => ({ value: u.id, label: personLabel(u) }));
  const ownerOptions = [
    { value: '', label: t('create.ownerSelf', { name: user?.username ?? '' }) },
    ...(owner !== null && !found.some((o) => o.value === owner.id)
      ? [{ value: owner.id, label: owner.label }]
      : []),
    ...found,
  ];

  return (
    <Modal opened onClose={onClose} title={t('create.title')} centered withinPortal>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim() !== '') create.mutate();
        }}
      >
        <Stack gap="sm">
          <TextInput
            label={t('create.name')}
            description={t('create.hint')}
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            error={errorText ?? undefined}
            maxLength={200}
            data-autofocus
          />
          {isAdmin ? (
            <>
              <TextInput
                label={t('create.ownerSearch')}
                value={ownerSearch}
                onChange={(e) => setOwnerSearch(e.currentTarget.value)}
                autoComplete="off"
              />
              <NativeSelect
                label={t('create.owner')}
                value={owner?.id ?? ''}
                onChange={(e) => {
                  const id = e.currentTarget.value;
                  const option = ownerOptions.find((o) => o.value === id);
                  setOwner(id === '' || option === undefined ? null : { id, label: option.label });
                }}
                data={ownerOptions}
              />
            </>
          ) : null}
          <div className="spaces-create-actions">
            <Button variant="default" onClick={onClose} disabled={create.isPending}>
              {t('create.cancel')}
            </Button>
            <Button type="submit" loading={create.isPending} disabled={name.trim() === ''}>
              {t('create.submit')}
            </Button>
          </div>
        </Stack>
      </form>
    </Modal>
  );
}
