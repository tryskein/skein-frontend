import { Fragment, useEffect, useId, useRef, useState } from 'react';
import { Button, Group, Loader, Stack, Table, Text, TextInput } from '@mantine/core';
import { IconArrowLeft } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../../auth/AuthContext';
import { ApiError, BusinessError } from '../../../api/client';
import { resendInvitation, revokeInvitation } from '../../../api/invitations';
import {
  getSpace,
  renameSpace,
  SpaceErrorCode,
  type SpaceDetail,
  type SpaceInvitation,
  type SpaceMember,
} from '../../../api/spaces';
import { Turnstile } from '../../../components/Turnstile';
import { useToaster } from '../../../components/Toaster';
import { projectsListQueryKey } from '../../../lib/projectHandleCache';
import { quotaLines, seatsLabel } from '../../../lib/spaceQuota';
import { parseSpaceHandle, spaceHandle, spacePath } from '../../../lib/shellUrlState';
import { MY_SPACES_QUERY_PREFIX } from '../../../lib/useMySpaces';
import { useAuthConfig } from '../../../lib/useAuthConfig';
import { useCaptchaAttempt } from '../../../lib/useCaptchaAttempt';
import { SettingsLayout, SettingsPanel } from './SettingsLayout';
import { InviteForm } from './InviteForm';
import { OwnerChangeDialog } from './OwnerChangeDialog';
import { MemberRemovalDialog, SpaceDeletionDialog } from './SpaceRemovalDialog';

/**
 * sk-674.18 T057 — the settings of one space, `/settings/spaces/:space`
 * (screens 2.3, 2.4, 2.14; plan 4.2, 6.2, 7). Reached from the ⚙ of a
 * space row in the projects column and from the «Spaces» tab.
 *
 * What is offered follows the server's answer, never a guess about roles
 * on this side (the server checks every action again):
 *  - managing (rename, invite, the invitation list, remove members) —
 *    `invitations !== null`: the owner and the instance admin (K5);
 *  - "Add" and "Change owner" — the instance admin;
 *  - deletion — `canDelete`, or the reason `cannotDeleteReason` beside an
 *    inactive button; `forbidden` — no button (a member);
 *  - leaving — a member who is not the owner (the owner does not leave).
 *
 * A space that does not exist or that the caller may not see answers 404
 * `space_not_found`: "Space not found", the same for both (INV-3).
 * The personal space has no settings — its address leads to its place.
 *
 * "Again" of an invitation passes the captcha rule of a send (T067): on
 * `captcha_required` Turnstile is shown under the list, and its token sends
 * that resend again; `captcha_failed` — a fresh challenge and the refusal.
 *
 * `?invite=1` opens the invitation form over the page at once — the step
 * after creating a space (K16); closing it leaves the person here.
 *
 * Seats and quotas are people, projects and bytes, not issues: the lenses
 * and `outboxMode` do not apply to them.
 */

export function spaceDetailQueryKey(spaceId: string) {
  // Under the `['spaces', …]` prefix the personal signal `spaces` resets
  // (`livePersonalSignal.ts#SPACES_QUERY_PREFIX`).
  return ['spaces', 'detail', spaceId] as const;
}

/** A resend: the invitation and the space it belongs to, frozen together. */
interface ResendTarget {
  spaceId: string;
  inv: SpaceInvitation;
}

type Dialog =
  | { kind: 'invite' }
  | { kind: 'remove'; member: SpaceMember }
  | { kind: 'leave' }
  | { kind: 'delete' }
  | { kind: 'owner' };

export function SpaceSettingsPage() {
  const { t, i18n } = useTranslation('spaces');
  const { user } = useAuth();
  const params = useParams<{ space: string }>();
  const spaceId = parseSpaceHandle(params.space);
  const qc = useQueryClient();
  const toast = useToaster();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const detailQ = useQuery<SpaceDetail>({
    queryKey: spaceDetailQueryKey(spaceId ?? ''),
    queryFn: () => getSpace(spaceId as string),
    enabled: spaceId !== null,
    retry: false,
  });
  const space = detailQ.data;

  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [name, setName] = useState('');
  useEffect(() => {
    if (space !== undefined) setName(space.name);
  }, [space?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  const canManage = space !== undefined && space.invitations !== null;
  const isAdmin = user?.role === 'admin';

  // K16 — straight from creation: the invitation form over the settings.
  useEffect(() => {
    if (searchParams.get('invite') === null || space === undefined) return;
    if (space.invitations !== null) setDialog({ kind: 'invite' });
    const next = new URLSearchParams(searchParams);
    next.delete('invite');
    setSearchParams(next, { replace: true });
  }, [space, searchParams, setSearchParams]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: spaceDetailQueryKey(spaceId ?? '') });
    void qc.invalidateQueries({ queryKey: MY_SPACES_QUERY_PREFIX });
  };
  /** The space is gone for this person (deleted, left): back to the shell. */
  const leaveTo = (message: string) => {
    void qc.invalidateQueries({ queryKey: MY_SPACES_QUERY_PREFIX });
    void qc.invalidateQueries({ queryKey: projectsListQueryKey });
    qc.removeQueries({ queryKey: spaceDetailQueryKey(spaceId ?? '') });
    toast.success(message);
    navigate('/', { replace: true });
  };

  const rename = useMutation({
    mutationFn: (next: string) => renameSpace(spaceId as string, next),
    onSuccess: (next) => {
      qc.setQueryData(spaceDetailQueryKey(next.id), next);
      // The space's name is shown in the projects column and on queue cards.
      void qc.invalidateQueries({ queryKey: MY_SPACES_QUERY_PREFIX });
      void qc.invalidateQueries({ queryKey: projectsListQueryKey });
      toast.success(t('settings.renamed'));
    },
    onError: (err) =>
      toast.error(t('settings.renameFailed', { message: err instanceof Error ? err.message : String(err) })),
  });
  const siteKey = useAuthConfig().data?.turnstileSiteKey ?? null;
  // The number of the last resend sent (a click or a token). An answer to
  // an earlier one is stale: no widget, no toast; the
  // server's change it reports still refreshes the list.
  const lastResend = useRef(0);
  const sendResend = (target: ResendTarget, turnstileToken?: string) => {
    lastResend.current += 1;
    resend.mutate({ ...target, turnstileToken, action: lastResend.current });
  };
  // A resend the server asked to check: the widget waits for its token.
  // The space is frozen with the invitation: the token goes to the space the
  // check was asked in, never to the one shown now.
  const resendCaptcha = useCaptchaAttempt<ResendTarget>((target, token) => sendResend(target, token));
  /** "Again" clicked: a pending check is void, the new resend goes. */
  const clickResend = (inv: SpaceInvitation) => {
    resendCaptcha.cancel();
    sendResend({ spaceId: spaceId as string, inv });
  };
  // Another space on the same page instance (the route has no key), or the
  // right to manage gone: the check and any answer on its way are void.
  const canManageHere = space !== undefined && space.invitations !== null;
  useEffect(() => {
    resendCaptcha.cancel();
    lastResend.current += 1;
  }, [spaceId, canManageHere]); // eslint-disable-line react-hooks/exhaustive-deps
  const resend = useMutation<unknown, unknown, ResendTarget & { turnstileToken?: string; action: number }>({
    mutationFn: ({ spaceId: target, inv, turnstileToken }) => resendInvitation(target, inv.id, turnstileToken),
    onSuccess: (_res, { action }) => {
      refresh();
      if (action !== lastResend.current) return;
      resendCaptcha.cancel();
      toast.success(t('settings.resent'));
    },
    onError: (err, { spaceId: target, inv, turnstileToken, action }) => {
      if (action !== lastResend.current) return;
      if (err instanceof BusinessError && err.code === SpaceErrorCode.CaptchaRequired) {
        if (siteKey === null) toast.error(t('invite.captchaNotConfigured'));
        else resendCaptcha.start({ spaceId: target, inv });
        return;
      }
      if (err instanceof BusinessError && err.code === SpaceErrorCode.CaptchaFailed && turnstileToken) {
        // A token is single-use: a fresh challenge.
        resendCaptcha.start({ spaceId: target, inv });
        toast.error(t('invite.errors.captcha_failed'));
        return;
      }
      // Any other refusal ends the attempt: no later token sends anything.
      resendCaptcha.cancel();
      toast.error(t('settings.actionFailed', { message: err instanceof Error ? err.message : String(err) }));
    },
  });
  const resendAttempt = resendCaptcha.attempt;
  const resendCaptionId = useId();
  const revoke = useMutation({
    mutationFn: (inv: SpaceInvitation) => revokeInvitation(spaceId as string, inv.id),
    onSuccess: () => {
      refresh();
      toast.success(t('settings.revoked'));
    },
    onError: (err) =>
      toast.error(t('settings.actionFailed', { message: err instanceof Error ? err.message : String(err) })),
  });

  const notFound =
    spaceId === null || (detailQ.error instanceof ApiError && detailQ.error.statusCode === 404);

  let body;
  if (notFound) {
    body = (
      <div className="settings-empty" role="status">
        {t('settings.notFound')}
      </div>
    );
  } else if (detailQ.isLoading) {
    body = (
      <div className="settings-loading" role="status">
        <Loader size="sm" aria-hidden />
        <span className="sr-only">{t('settings.loading')}</span>
      </div>
    );
  } else if (detailQ.isError || space === undefined) {
    body = (
      <div role="alert" className="settings-load-error">
        <Text size="sm">{t('settings.loadFailed')}</Text>
        <Button variant="default" size="sm" mt="xs" loading={detailQ.isFetching} onClick={() => void detailQ.refetch()}>
          {t('settings.retry')}
        </Button>
      </div>
    );
  } else if (space.kind === 'personal') {
    // The personal space has no settings page (screens 2.3) — its place.
    return <Navigate to={spacePath(spaceHandle(space))} replace />;
  } else {
    const seats = seatsLabel(t, space);
    const quotas = quotaLines(t, space, i18n.language, false);
    const self = user?.id ?? '';
    const callerIsOwner = space.myRole === 'owner';
    const deleteReason =
      space.cannotDeleteReason === 'common_space_not_empty' || space.cannotDeleteReason === 'common_space_enabled'
        ? t(`settings.cannotDelete.${space.cannotDeleteReason}`)
        : null;
    const showDelete = space.canDelete || deleteReason !== null;
    const showLeave = space.myRole === 'member';
    const showOwner = isAdmin;
    const trimmed = name.trim();

    body = (
      <>
        <SettingsPanel
          title={space.name}
          actions={
            canManage ? (
              <Group gap="xs">
                <Button size="sm" onClick={() => setDialog({ kind: 'invite' })}>
                  {t('settings.invite')}
                </Button>
                {isAdmin ? (
                  <Button size="sm" variant="default" onClick={() => setDialog({ kind: 'invite' })}>
                    {t('settings.add')}
                  </Button>
                ) : null}
              </Group>
            ) : undefined
          }
        >
          {canManage ? (
            <form
              className="space-rename"
              onSubmit={(e) => {
                e.preventDefault();
                if (trimmed !== '' && trimmed !== space.name) rename.mutate(trimmed);
              }}
            >
              <Group gap="xs" align="flex-end">
                <TextInput
                  label={t('settings.nameLabel')}
                  value={name}
                  onChange={(e) => setName(e.currentTarget.value)}
                  maxLength={200}
                />
                <Button
                  type="submit"
                  variant="default"
                  loading={rename.isPending}
                  disabled={trimmed === '' || trimmed === space.name}
                >
                  {t('settings.save')}
                </Button>
              </Group>
            </form>
          ) : null}
          {seats !== null || quotas.length > 0 ? (
            <ul className="space-quotas">
              {seats !== null ? <li>{seats}</li> : null}
              {quotas.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
        </SettingsPanel>

        <SettingsPanel title={t('settings.membersTitle', { count: space.members.length })}>
          <Table verticalSpacing="xs">
            <Table.Caption className="sr-only">{t('settings.membersCaption')}</Table.Caption>
            <Table.Thead>
              <Table.Tr>
                <Table.Th scope="col">{t('settings.membersCol.username')}</Table.Th>
                <Table.Th scope="col">{t('settings.membersCol.name')}</Table.Th>
                <Table.Th scope="col">{t('settings.membersCol.role')}</Table.Th>
                <Table.Th scope="col" style={{ textAlign: 'right' }}>
                  {t('settings.membersCol.actions')}
                </Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {space.members.map((m) => (
                <Table.Tr key={m.userId} className={m.deactivated ? 'settings-row-muted' : undefined}>
                  <Table.Td>
                    <code>{m.username}</code>
                  </Table.Td>
                  <Table.Td>{m.name}</Table.Td>
                  <Table.Td>
                    {t(`settings.role.${m.role}`)}
                    {m.deactivated ? ` · ${t('settings.deactivated')}` : ''}
                  </Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>
                    {canManage && m.role !== 'owner' && m.userId !== self ? (
                      <Button
                        variant="subtle"
                        color="red"
                        size="compact-xs"
                        aria-label={t('settings.removeAria', { name: m.username })}
                        onClick={() => setDialog({ kind: 'remove', member: m })}
                      >
                        {t('settings.remove')}
                      </Button>
                    ) : null}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </SettingsPanel>

        {space.invitations !== null ? (
          <SettingsPanel title={t('settings.invitationsTitle', { count: space.invitations.length })}>
            {space.invitations.length === 0 ? (
              <div className="settings-empty">{t('settings.invitationsEmpty')}</div>
            ) : (
              <Table verticalSpacing="xs">
                <Table.Caption className="sr-only">{t('settings.invitationsCaption')}</Table.Caption>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th scope="col">{t('settings.invitationsCol.email')}</Table.Th>
                    <Table.Th scope="col">{t('settings.invitationsCol.expires')}</Table.Th>
                    <Table.Th scope="col">{t('settings.invitationsCol.status')}</Table.Th>
                    <Table.Th scope="col" style={{ textAlign: 'right' }}>
                      {t('settings.invitationsCol.actions')}
                    </Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {space.invitations.map((inv) => (
                    <Fragment key={inv.id}>
                      <Table.Tr>
                        <Table.Td>{inv.email}</Table.Td>
                        <Table.Td>
                          {inv.expiresAt !== null
                            ? t('settings.invitationUntil', {
                                date: new Intl.DateTimeFormat(i18n.language, {
                                  day: 'numeric',
                                  month: 'short',
                                }).format(new Date(inv.expiresAt)),
                              })
                            : '—'}
                        </Table.Td>
                        <Table.Td>{t(`settings.invitationStatus.${inv.status}`)}</Table.Td>
                        <Table.Td style={{ textAlign: 'right' }}>
                          {inv.status === 'pending' ? (
                            <Group gap={4} justify="flex-end" wrap="nowrap">
                              <Button
                                variant="subtle"
                                size="compact-xs"
                                aria-label={t('settings.resendAria', { email: inv.email })}
                                loading={resend.isPending && resend.variables?.inv.id === inv.id}
                                onClick={() => clickResend(inv)}
                              >
                                {t('settings.resend')}
                              </Button>
                              <Button
                                variant="subtle"
                                color="red"
                                size="compact-xs"
                                aria-label={t('settings.revokeAria', { email: inv.email })}
                                loading={revoke.isPending && revoke.variables?.id === inv.id}
                                onClick={() => revoke.mutate(inv)}
                              >
                                {t('settings.revoke')}
                              </Button>
                            </Group>
                          ) : null}
                        </Table.Td>
                      </Table.Tr>
                      {resendAttempt !== null &&
                      resendAttempt.payload.spaceId === spaceId &&
                      resendAttempt.payload.inv.id === inv.id &&
                      siteKey !== null ? (
                        // The check of this resend, right under its row — where the
                        // person clicked; its line is announced.
                        <Table.Tr>
                          <Table.Td colSpan={4}>
                            <Stack gap={4}>
                              <Text size="sm" role="status" id={resendCaptionId}>
                                {t('settings.resendCaptcha', { email: inv.email })}
                              </Text>
                              {resendCaptcha.broken ? (
                                <Text size="sm" role="alert">
                                  {t('invite.captchaUnavailable')}
                                </Text>
                              ) : (
                                <Turnstile
                                  key={resendAttempt.id}
                                  siteKey={siteKey}
                                  onToken={(token) => resendCaptcha.onToken(resendAttempt.id, token)}
                                  onLoadError={resendCaptcha.markBroken}
                                  labelledBy={resendCaptionId}
                                />
                              )}
                            </Stack>
                          </Table.Td>
                        </Table.Tr>
                      ) : null}
                    </Fragment>
                  ))}
                </Table.Tbody>
              </Table>
            )}
          </SettingsPanel>
        ) : null}

        {showDelete || showLeave || showOwner ? (
          <SettingsPanel title={t('settings.dangerTitle')}>
            <Group gap="sm" align="flex-start">
              {showOwner ? (
                <Button variant="default" onClick={() => setDialog({ kind: 'owner' })}>
                  {t('settings.changeOwner')}
                </Button>
              ) : null}
              {showLeave ? (
                <Button variant="default" color="red" onClick={() => setDialog({ kind: 'leave' })}>
                  {t('settings.leave')}
                </Button>
              ) : null}
              {showDelete ? (
                <div className="space-delete">
                  <Button
                    color="red"
                    disabled={!space.canDelete}
                    aria-describedby={deleteReason !== null ? 'space-delete-reason' : undefined}
                    onClick={() => setDialog({ kind: 'delete' })}
                  >
                    {t('settings.delete')}
                  </Button>
                  {deleteReason !== null ? (
                    <Text size="sm" id="space-delete-reason" className="space-delete-reason">
                      {deleteReason}
                    </Text>
                  ) : null}
                </div>
              ) : null}
            </Group>
          </SettingsPanel>
        ) : null}

        {dialog?.kind === 'invite' ? (
          <InviteForm space={space} isAdmin={isAdmin} onClose={() => setDialog(null)} onChanged={refresh} />
        ) : null}
        {dialog?.kind === 'remove' ? (
          <MemberRemovalDialog
            spaceId={space.id}
            spaceName={space.name}
            member={dialog.member}
            selfId={self}
            onClose={() => setDialog(null)}
            onDone={() => {
              setDialog(null);
              refresh();
              toast.success(t('settings.removed', { name: dialog.member.username, space: space.name }));
            }}
          />
        ) : null}
        {dialog?.kind === 'leave' ? (
          <MemberRemovalDialog
            spaceId={space.id}
            spaceName={space.name}
            member={null}
            selfId={self}
            onClose={() => setDialog(null)}
            onDone={() => leaveTo(t('settings.left', { name: space.name }))}
          />
        ) : null}
        {dialog?.kind === 'delete' ? (
          <SpaceDeletionDialog
            spaceId={space.id}
            spaceName={space.name}
            callerIsOwner={callerIsOwner}
            onClose={() => setDialog(null)}
            onDone={() => leaveTo(t('settings.deleted', { name: space.name }))}
          />
        ) : null}
        {dialog?.kind === 'owner' ? (
          <OwnerChangeDialog
            space={space}
            onClose={() => setDialog(null)}
            onDone={(next) => {
              setDialog(null);
              qc.setQueryData(spaceDetailQueryKey(next.id), next);
              void qc.invalidateQueries({ queryKey: MY_SPACES_QUERY_PREFIX });
              const owner = next.members.find((m) => m.role === 'owner');
              toast.success(t('owner.done', { space: next.name, name: owner?.username ?? '' }));
            }}
          />
        ) : null}
      </>
    );
  }

  return (
    <SettingsLayout active="spaces">
      {/* sk-733.1 — the way back to «My spaces» from a space's settings,
          in every state of the page (not found and load errors too): the
          tab strip above leads there as well, but the owner found no way
          back, and the page body is where one looks. */}
      <Link to="/settings/spaces" className="settings-back-link space-settings-back">
        <IconArrowLeft size={16} stroke={1.75} aria-hidden />
        {t('settings.backToList')}
      </Link>
      {body}
    </SettingsLayout>
  );
}
