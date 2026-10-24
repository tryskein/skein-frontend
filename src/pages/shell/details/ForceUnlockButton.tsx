import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { forceUnlockIssue, type IssueDetail } from '../../../api/issues';
import { useAuthOptional } from '../../../auth/AuthContext';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { useToaster } from '../../../components/Toaster';
import { extractMessage } from '../../../lib/extractApiMessage';
import { refusalReason } from '../../../lib/saveFailureReason';
import { issueDetailKey } from '../../../lib/useIssueDetail';

/**
 * sk-674.18 T055 — "Release the lock" beside the claim mark of the card's
 * properties row (screens 1.10, US-16, K4). The claim is who HOLDS the
 * issue, not the `blocked` derived from dependencies.
 *
 * Shown exactly when the server says the caller may release another
 * holder's claim (`canForceUnlock` of the card: the project owner, the
 * space owner, the admin) and the caller is not the holder — one's own
 * claim is released as before, by the holder. Absent `canForceUnlock`
 * (an api that does not serve it yet) reads as «may not».
 *
 * Asks first: "The lock is held by oleg since 12:40. Release it?". The answer of the
 * server is the card as its GET, put in place of the cached one; the event
 * in the history comes from the server. A refusal is worded by its code.
 */
export interface ForceUnlockButtonProps {
  issue: IssueDetail;
  /** The claim moment as the row prints it (`12:40`, `yesterday 12:40`). */
  claimedAt: string;
}

export function ForceUnlockButton(props: ForceUnlockButtonProps) {
  // Nothing to offer — and nothing to read or prepare — unless the server
  // says the caller may release another holder's claim.
  if (props.issue.canForceUnlock !== true) return null;
  return <ForceUnlockControl {...props} />;
}

function ForceUnlockControl({ issue, claimedAt }: ForceUnlockButtonProps) {
  const { t } = useTranslation('details');
  const qc = useQueryClient();
  const toast = useToaster();
  const me = useAuthOptional()?.user?.username ?? null;
  const [confirmOpen, setConfirmOpen] = useState(false);

  const holder = issue.lockedByUsername?.trim() || '';
  const holdsItself = me !== null && holder !== '' && holder.toLowerCase() === me.toLowerCase();

  const unlockMut = useMutation<IssueDetail, Error, void>({
    mutationFn: () => forceUnlockIssue(issue.projectId, issue.id),
    onSuccess: (card) => {
      qc.setQueryData<IssueDetail>(issueDetailKey(issue.id), card);
      setConfirmOpen(false);
      toast.success(t('forceUnlock.done', { id: issue.id }));
    },
    onError: (err) => {
      setConfirmOpen(false);
      toast.error(refusalReason(err, t) ?? extractMessage(err));
      // The claim may have changed meanwhile: show what the server holds.
      void qc.invalidateQueries({ queryKey: issueDetailKey(issue.id) });
    },
  });

  if (holdsItself) return null;

  return (
    <>
      <button
        type="button"
        className="issue-props-force-unlock"
        onClick={() => setConfirmOpen(true)}
        disabled={unlockMut.isPending}
      >
        {t('forceUnlock.button')}
      </button>
      <ConfirmDialog
        opened={confirmOpen}
        title={t('forceUnlock.title')}
        message={
          holder
            ? t('forceUnlock.confirm', { name: holder, time: claimedAt })
            : t('forceUnlock.confirmNoName', { time: claimedAt })
        }
        confirmLabel={t('forceUnlock.confirmLabel')}
        loading={unlockMut.isPending}
        danger
        onConfirm={() => unlockMut.mutate()}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
