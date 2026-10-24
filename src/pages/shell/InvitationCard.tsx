import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IconCheck, IconUsersGroup, IconX } from '@tabler/icons-react';
import {
  acceptMyInvitation,
  declineMyInvitation,
  type MyInvitation,
} from '../../api/invitations';
import { requestEmailConfirmation } from '../../api/account';
import type { EmailLanguage } from '../../api/auth';
import { BusinessError, RateLimitError } from '../../api/client';
import { SpaceErrorCode } from '../../api/spaces';
import { SkeinTooltip } from '../../components/SkeinTooltip';
import { useToaster } from '../../components/Toaster';
import { MY_INVITATIONS_QUERY_PREFIX } from '../../lib/livePersonalSignal';
import { MY_SPACES_QUERY_PREFIX } from '../../lib/useMySpaces';
import { notificationCountsKey } from '../../lib/useNotificationCounts';
import { projectsListQueryKey } from '../../lib/projectHandleCache';
import { spaceHandle, spacePath } from '../../lib/shellUrlState';

/**
 * sk-674.18 T054 — an invitation to a space, pinned above the Inbox tasks
 * (screens 1.3, plan 5.2, 6.2). Shown with any number of spaces: it is the
 * only way into a second one.
 *
 * sk-733.3 — drawn unlike a task card (the owner: they looked alike): a
 * tinted card with an accent edge and a people glyph, the space's name
 * set apart. Pinned by its group in `InboxColumn.tsx` (`.inbox-invitations`).
 *
 * sk-733.5 — "Accept" and "Decline" are square glyph buttons at the end
 * of the title row (a green ✓, a ✕), each named by its tooltip: the
 * labelled pair stacked into two rows of their own in a narrow column.
 *
 *   ┌──────────────────────────────────────────┐
 *   │ 👥 You are invited to Acme            [✓] [✕] │
 *   │    Invited by: anna · valid until 18 Oct  │
 *   └──────────────────────────────────────────┘
 *
 * "Accept" is offered as the server says it would succeed now
 * (`canAccept`): with mail on and the email not confirmed it is off, and
 * the hint under the card names both ways to confirm (K8) — the link
 * of the invitation email, or a confirmation email sent from here. The
 * personal signal `inbox` re-reads the invitations once the email is
 * confirmed, so the button turns on in this tab without a reload.
 * "Decline" is always offered and asks nothing.
 *
 * Accepting toasts "You are in Acme" with an "Open" link to the space; the
 * move is offered, not made — the person may be in the middle of a task.
 * An invitation that expired, was revoked or whose space was deleted while
 * the card was on screen answers "The invitation is no longer valid", and
 * the card goes.
 */
export interface InvitationCardProps {
  invitation: MyInvitation;
}

/**
 * sk-674.18 T054 (review TS-W2; spec E-26, screens 2.9) — after a
 * confirmation email was sent (or the send was rate limited) the button
 * stays off for a minute, then comes back.
 */
export const CONFIRMATION_RESEND_COOLDOWN_MS = 60_000;

/** i18next language → the language of the confirmation email. */
function emailLanguage(language: string): EmailLanguage {
  return language.toLowerCase().startsWith('ru') ? 'ru' : 'en';
}

export function InvitationCard({ invitation }: InvitationCardProps) {
  const { t, i18n } = useTranslation('inbox');
  const qc = useQueryClient();
  const toast = useToaster();
  const navigate = useNavigate();
  const space = invitation.spaceName;

  /** Drop this card from the cached list at once; the re-read confirms it. */
  const dropCard = () => {
    qc.setQueriesData<{ items: MyInvitation[] }>(
      { queryKey: MY_INVITATIONS_QUERY_PREFIX },
      (prev) =>
        prev === undefined
          ? prev
          : { ...prev, items: prev.items.filter((it) => it.id !== invitation.id) },
    );
  };
  const rereadInvitations = () => {
    void qc.invalidateQueries({ queryKey: MY_INVITATIONS_QUERY_PREFIX });
    // The Inbox badge counts pending invitations.
    void qc.invalidateQueries({ queryKey: notificationCountsKey });
  };
  /** The refusals accept and decline share (contract: AcceptInvitationResponse). */
  const onRefusal = (err: unknown, failedKey: string) => {
    const code = err instanceof BusinessError ? err.code : '';
    if (code === SpaceErrorCode.InvitationInvalid || code === SpaceErrorCode.SpaceDeleted) {
      toast.error(t('invitation.noLongerValid'));
      dropCard();
    } else if (code === SpaceErrorCode.EmailUnconfirmed) {
      toast.error(t('invitation.emailUnconfirmed'));
    } else {
      toast.error(t(failedKey));
    }
    rereadInvitations();
  };

  const acceptMut = useMutation({
    mutationFn: () => acceptMyInvitation(invitation.id),
    onSuccess: (res) => {
      dropCard();
      rereadInvitations();
      // The space joined: its row and its projects appear in the column.
      void qc.invalidateQueries({ queryKey: MY_SPACES_QUERY_PREFIX });
      void qc.invalidateQueries({ queryKey: projectsListQueryKey });
      toast.success(t('invitation.joined', { space: res.space.name }), {
        action: {
          label: t('invitation.open'),
          to: spacePath(spaceHandle(res.space)),
          navigate,
        },
      });
    },
    onError: (err) => onRefusal(err, 'invitation.acceptFailed'),
  });
  const declineMut = useMutation({
    mutationFn: () => declineMyInvitation(invitation.id),
    onSuccess: () => {
      dropCard();
      rereadInvitations();
    },
    onError: (err) => onRefusal(err, 'invitation.declineFailed'),
  });
  // The send is off until this moment (E-26); null — on.
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  useEffect(() => {
    if (cooldownUntil === null) return;
    const timer = setTimeout(() => setCooldownUntil(null), Math.max(0, cooldownUntil - Date.now()));
    return () => clearTimeout(timer);
  }, [cooldownUntil]);
  const startCooldown = () => setCooldownUntil(Date.now() + CONFIRMATION_RESEND_COOLDOWN_MS);
  const confirmMut = useMutation({
    mutationFn: () => requestEmailConfirmation(emailLanguage(i18n.language)),
    onSuccess: () => {
      startCooldown();
      toast.success(t('invitation.confirmationSent'));
    },
    onError: (err) => {
      if (err instanceof RateLimitError) {
        startCooldown();
        toast.error(t('invitation.rateLimited'));
      } else if (err instanceof BusinessError && err.code === SpaceErrorCode.EmailDisabled) {
        toast.error(t('invitation.emailDisabled'));
      } else {
        toast.error(t('invitation.confirmationFailed'));
      }
    },
  });

  const busy = acceptMut.isPending || declineMut.isPending;
  const unconfirmed =
    !invitation.canAccept && invitation.cannotAcceptReason === SpaceErrorCode.EmailUnconfirmed;
  const until = new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'short' }).format(
    new Date(invitation.expiresAt),
  );
  const hintId = `invitation-hint-${invitation.id}`;

  return (
    <div className="inbox-card invitation-card">
      <div className="invitation-card-head">
        <IconUsersGroup className="invitation-card-icon" size={20} stroke={1.75} aria-hidden />
        <div className="invitation-card-title">{t('invitation.title', { space })}</div>
        <div className="invitation-card-actions">
          <SkeinTooltip content={t('invitation.accept')} position="top">
            <button
              type="button"
              className="invitation-card-btn accept"
              disabled={!invitation.canAccept || busy}
              aria-label={t('invitation.acceptAria', { space })}
              aria-describedby={unconfirmed ? hintId : undefined}
              onClick={() => acceptMut.mutate()}
            >
              <IconCheck size={18} stroke={2.25} aria-hidden />
            </button>
          </SkeinTooltip>
          <SkeinTooltip content={t('invitation.decline')} position="top">
            <button
              type="button"
              className="invitation-card-btn decline"
              disabled={busy}
              aria-label={t('invitation.declineAria', { space })}
              onClick={() => declineMut.mutate()}
            >
              <IconX size={18} stroke={2} aria-hidden />
            </button>
          </SkeinTooltip>
        </div>
      </div>
      <div className="inbox-card-meta invitation-card-meta">
        {t('invitation.meta', { inviter: invitation.invitedBy, date: until })}
      </div>
      {unconfirmed ? (
        <p className="invitation-card-hint" id={hintId}>
          {t('invitation.unconfirmedHint')}{' '}
          <button
            type="button"
            className="invitation-card-link"
            disabled={confirmMut.isPending || cooldownUntil !== null}
            onClick={() => confirmMut.mutate()}
          >
            {t('invitation.sendConfirmation')}
          </button>
        </p>
      ) : null}
    </div>
  );
}
