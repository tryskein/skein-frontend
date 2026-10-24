import { useState } from 'react';
import { Button, Group, Modal, NativeSelect, Stack, Text } from '@mantine/core';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { changeSpaceOwner, type SpaceDetail } from '../../../api/spaces';

/**
 * sk-674.18 T057 — "Change owner" (screens 2.14, plan 4.2): the
 * instance admin, in the settings of any space but a personal one. The
 * choice is among the members of THIS space only — the server requires the
 * new owner to be a member already (422 `not_a_member`); the owned-spaces
 * limit of the new owner is not checked, pending invitations are untouched,
 * the previous owner stays a member. The signals to the new and the
 * previous owner are the server's (`owner_assigned` / `owner_changed`).
 */
export interface OwnerChangeDialogProps {
  space: SpaceDetail;
  onClose: () => void;
  /** The space as the server answered after the change. */
  onDone: (next: SpaceDetail) => void;
}

export function OwnerChangeDialog({ space, onClose, onDone }: OwnerChangeDialogProps) {
  const { t } = useTranslation('spaces');
  const owner = space.members.find((m) => m.role === 'owner') ?? null;
  const candidates = space.members.filter((m) => m.role !== 'owner' && !m.deactivated);
  const [pick, setPick] = useState('');

  const run = useMutation({
    mutationFn: () => changeSpaceOwner(space.id, pick),
    onSuccess: onDone,
  });

  return (
    <Modal opened onClose={onClose} title={t('owner.title', { space: space.name })} centered withinPortal>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (pick !== '') run.mutate();
        }}
      >
        <Stack gap="sm">
          {owner !== null ? <Text size="sm">{t('owner.current', { name: owner.username })}</Text> : null}
          {candidates.length === 0 ? (
            <Text size="sm">{t('owner.noCandidates')}</Text>
          ) : (
            <NativeSelect
              label={t('owner.next')}
              value={pick}
              onChange={(e) => setPick(e.currentTarget.value)}
              data={[
                { value: '', label: t('owner.placeholder') },
                ...candidates.map((m) => ({
                  value: m.userId,
                  label: m.name ? `${m.username} — ${m.name}` : m.username,
                })),
              ]}
            />
          )}
          {owner !== null && pick !== '' ? (
            <Text size="sm">{t('owner.stays', { name: owner.username })}</Text>
          ) : null}
          {run.isError ? (
            <Text size="sm" role="alert" className="space-dialog-error">
              {run.error instanceof Error ? run.error.message : String(run.error)}
            </Text>
          ) : null}
          <Group justify="flex-end" gap="sm">
            <Button variant="default" onClick={onClose} disabled={run.isPending}>
              {t('owner.cancel')}
            </Button>
            <Button type="submit" loading={run.isPending} disabled={pick === ''}>
              {t('owner.confirm')}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
