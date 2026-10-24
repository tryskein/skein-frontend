import { useState } from 'react';
import { Button, Group, Loader, Modal, Stack, Text, TextInput } from '@mantine/core';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { BusinessError } from '../../../api/client';
import {
  deleteSpace,
  getMemberRemovalPreview,
  getSpaceDeletionPreview,
  leaveSpace,
  removeSpaceMember,
  SpaceErrorCode,
} from '../../../api/spaces';
import { formatBytes } from '../../../lib/spaceQuota';

/**
 * sk-674.18 T057 — the two irreversible dialogs of the space settings
 * (screens 2.3, plan 4.2, 7):
 *
 *  - {@link MemberRemovalDialog}: removing a member (owner, admin) or
 *    leaving (a member, first person). The consequences are shown BEFORE
 *    the button, from the server's `removal-preview` — the same numbers the
 *    removal then produces (US-7).
 *  - {@link SpaceDeletionDialog}: deleting the space — what goes, from
 *    `deletion-preview`, and the name typed to confirm. The button is on
 *    once the preview has answered (and is not being re-read) and the
 *    typed text equals the name — the consequences come before the
 *    irreversible step, so a pending or refused preview sends nothing
 *   ; the server compares the name again
 *    (US-4: "Deletion confirmation is checked against the name on the server") and a
 *    mismatch there is said under the field.
 */

function refusalMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface MemberRemovalDialogProps {
  spaceId: string;
  spaceName: string;
  /** The member removed; null — the caller leaves. */
  member: { userId: string; username: string } | null;
  /** The caller's id — the preview of leaving is asked for them. */
  selfId: string;
  onClose: () => void;
  /** After the server removed the member (or the caller left). */
  onDone: () => void;
}

export function MemberRemovalDialog({
  spaceId,
  spaceName,
  member,
  selfId,
  onClose,
  onDone,
}: MemberRemovalDialogProps) {
  const { t } = useTranslation('spaces');
  const leaving = member === null;
  const userId = member?.userId ?? selfId;
  const name = member?.username ?? '';

  const preview = useQuery({
    queryKey: ['spaces', 'removal-preview', spaceId, userId],
    queryFn: () => getMemberRemovalPreview(spaceId, userId),
    gcTime: 0,
    staleTime: 0,
  });
  const run = useMutation({
    mutationFn: () => (leaving ? leaveSpace(spaceId) : removeSpaceMember(spaceId, userId)),
    onSuccess: onDone,
  });

  const p = preview.data;
  const lines: string[] = [];
  if (p !== undefined) {
    if (p.openAssignedIssues > 0) {
      lines.push(
        t(leaving ? 'removal.myOpenAssigned' : 'removal.openAssigned', { count: p.openAssignedIssues }),
      );
    }
    if (p.claimedIssues > 0) lines.push(t(leaving ? 'removal.myClaims' : 'removal.claims', { name }));
    lines.push(t(leaving ? 'removal.myProjects' : 'removal.projects', { name, space: spaceName }));
    if (p.ownedProjects.length > 0) {
      lines.push(
        t(leaving ? 'removal.myOwned' : 'removal.owned', {
          name,
          space: spaceName,
          projects: p.ownedProjects.map((pr) => pr.name).join(', '),
        }),
      );
    }
    lines.push(t(leaving ? 'removal.myKeys' : 'removal.keys', { name, space: spaceName }));
    lines.push(t(leaving ? 'removal.myHistory' : 'removal.history', { name }));
  }

  return (
    <Modal
      opened
      onClose={onClose}
      title={
        leaving
          ? t('removal.leaveTitle', { space: spaceName })
          : t('removal.removeTitle', { name, space: spaceName })
      }
      centered
      withinPortal
    >
      <Stack gap="sm">
        {preview.isLoading ? (
          <div className="settings-loading" role="status">
            <Loader size="sm" aria-hidden />
            <span className="sr-only">{t('removal.loading')}</span>
          </div>
        ) : preview.isError ? (
          <div role="alert">
            <Text size="sm">{t('removal.previewFailed')}</Text>
            <Button variant="default" size="xs" mt="xs" onClick={() => void preview.refetch()}>
              {t('removal.retry')}
            </Button>
          </div>
        ) : (
          <ul className="space-consequences">
            {lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
        {run.isError ? (
          <Text size="sm" role="alert" className="space-dialog-error">
            {refusalMessage(run.error)}
          </Text>
        ) : null}
        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={onClose} disabled={run.isPending}>
            {t('removal.cancel')}
          </Button>
          <Button
            color="red"
            onClick={() => run.mutate()}
            loading={run.isPending}
            // The consequences are named before the button (screens 2.3).
            disabled={p === undefined}
          >
            {leaving ? t('removal.confirmLeave') : t('removal.confirmRemove')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

export interface SpaceDeletionDialogProps {
  spaceId: string;
  spaceName: string;
  /**
   * The caller is not the owner (the admin, K5): the dialog names the owner
   * who is not warned (screens 2.3, proposal), so a live space of someone
   * else is not deleted by mistake.
   */
  callerIsOwner: boolean;
  onClose: () => void;
  onDone: () => void;
}

export function SpaceDeletionDialog({
  spaceId,
  spaceName,
  callerIsOwner,
  onClose,
  onDone,
}: SpaceDeletionDialogProps) {
  const { t, i18n } = useTranslation('spaces');
  const [typed, setTyped] = useState('');

  const preview = useQuery({
    queryKey: ['spaces', 'deletion-preview', spaceId],
    queryFn: () => getSpaceDeletionPreview(spaceId),
    gcTime: 0,
    staleTime: 0,
  });
  const run = useMutation({
    mutationFn: () => deleteSpace(spaceId, typed),
    onSuccess: onDone,
  });

  const err = run.error;
  const fieldError =
    err instanceof BusinessError && err.code === SpaceErrorCode.NameMismatch
      ? t('deletion.errors.name_mismatch')
      : null;
  const p = preview.data;
  // The consequences were shown, from an answer that is current.
  const previewShown = preview.isSuccess && !preview.isFetching && p !== undefined;
  const canDelete = previewShown && typed === spaceName;

  return (
    <Modal opened onClose={onClose} title={t('deletion.title', { name: spaceName })} centered withinPortal>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canDelete) run.mutate();
        }}
      >
        <Stack gap="sm">
          {preview.isLoading ? (
            <div className="settings-loading" role="status">
              <Loader size="sm" aria-hidden />
              <span className="sr-only">{t('deletion.loading')}</span>
            </div>
          ) : preview.isError ? (
            <div role="alert">
              <Text size="sm">{t('deletion.previewFailed')}</Text>
              <Button variant="default" size="xs" mt="xs" onClick={() => void preview.refetch()}>
                {t('deletion.retry')}
              </Button>
            </div>
          ) : p !== undefined ? (
            <>
              <Text size="sm">
                {t('deletion.summary', {
                  projects: p.projectCount,
                  issues: p.issueCount,
                  storage: formatBytes(p.storageBytes, i18n.language),
                })}
              </Text>
              <Text size="sm">{t('deletion.invitations')}</Text>
              {callerIsOwner ? null : (
                <Text size="sm" fw={600}>
                  {t('deletion.owner', { owner: p.ownerUsername })}
                </Text>
              )}
            </>
          ) : null}
          <TextInput
            label={t('deletion.typeName')}
            value={typed}
            onChange={(e) => setTyped(e.currentTarget.value)}
            error={fieldError ?? undefined}
            autoComplete="off"
          />
          {err !== null && fieldError === null ? (
            <Text size="sm" role="alert" className="space-dialog-error">
              {refusalMessage(err)}
            </Text>
          ) : null}
          <Group justify="flex-end" gap="sm">
            <Button variant="default" onClick={onClose} disabled={run.isPending}>
              {t('deletion.cancel')}
            </Button>
            <Button color="red" type="submit" loading={run.isPending} disabled={!canDelete}>
              {t('deletion.confirm')}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
