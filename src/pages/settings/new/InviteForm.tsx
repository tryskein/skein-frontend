import { useEffect, useId, useRef, useState } from 'react';
import { Button, Group, Modal, Stack, Text, TextInput } from '@mantine/core';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { emailLanguage } from '../../../lib/emailLanguage';
import { BusinessError } from '../../../api/client';
import {
  createInvitation,
  resendInvitation,
  type CreateInvitationInput,
  type CreateInvitationResponse,
} from '../../../api/invitations';
import { addSpaceMember, SpaceErrorCode, type SpaceDetail } from '../../../api/spaces';
import { listUserDirectory, listUsers } from '../../../api/users';
import { Turnstile } from '../../../components/Turnstile';
import { useAuthConfig } from '../../../lib/useAuthConfig';
import { useCaptchaAttempt } from '../../../lib/useCaptchaAttempt';
import { noSeatsLeft, seatsLabel } from '../../../lib/spaceQuota';

/**
 * sk-674.18 T057 — inviting a person to a space (screens 2.4, plan 6.2):
 * the owner and the instance admin (K5), from the space settings; opened by
 * itself right after a space is created (K16).
 *
 * One field: an email, or a person picked from the list — then the server
 * gets the person's id and takes the email itself (the list never shows
 * emails, screens 2.4). The list for an owner is the people directory, the
 * server narrows it (INV-9); for the admin it is every account of the
 * instance but the external ones (`GET /users?external=false`), himself
 * included — that is how an admin without membership adds himself.
 *
 * What the form says after sending follows the server's answer, not the
 * flags: `sent` (with registration open it is always that, for an existing
 * address or not), `already_member`, `already_pending` with "Send again",
 * and a text per refusal code. `captcha_required` shows Turnstile
 * and sends again once the check passes (lead's decision (A): the widget
 * is created here, T059 reuses it) — for "Send again" too: a resend
 * passes the same captcha rule as a creation (T067).
 *
 * "Add" (admin only, plan 2.6, 4.2): the picked person becomes a
 * member at once, without consent; the seat limit holds.
 *
 * Without seats (pending invitations counted) both buttons are off and the
 * seats line says so (screens 2.4).
 */

/** A light shape check before sending; the server is the judge. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Person {
  id: string;
  username: string;
  name: string;
}

/**
 * What a captcha attempt sends once its token arrives: the invitation as
 * the server was asked for it, or the resend of the pending one (T067).
 * Editing the addressee cancels the attempt.
 */
type CaptchaSend =
  | { kind: 'create'; input: CreateInvitationInput }
  | { kind: 'resend'; invitationId: string };

type Outcome =
  | { kind: 'sent' }
  | { kind: 'already_member'; name: string }
  | { kind: 'already_pending'; invitationId: string | null }
  | { kind: 'resent' }
  | { kind: 'added'; name: string };

export interface InviteFormProps {
  space: SpaceDetail;
  /** The caller is the instance admin: the list of every account and "Add". */
  isAdmin: boolean;
  onClose: () => void;
  /** Members or invitations changed — the settings re-read the space. */
  onChanged: () => void;
}

export function InviteForm({ space, isAdmin, onClose, onChanged }: InviteFormProps) {
  const { t, i18n } = useTranslation('spaces');
  const siteKey = useAuthConfig().data?.turnstileSiteKey ?? null;
  const captchaCaptionId = useId();

  const [text, setText] = useState('');
  const [picked, setPicked] = useState<Person | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  // The number of the person's last action (a send, a resend, "Add",
  // a token sent, an edit of the addressee). An answer to an earlier one is
  // stale: it changes nothing on the form — no widget, no text, no outcome
  //; the server's change it reports still refreshes the
  // space.
  const lastAction = useRef(0);
  const nextAction = () => {
    lastAction.current += 1;
    return lastAction.current;
  };
  const isStale = (action: number) => action !== lastAction.current;
  // `captcha_required` was answered: the widget is shown, and the send it
  // was asked for waits for its token. Editing the addressee cancels it.
  const captcha = useCaptchaAttempt<CaptchaSend>((pending, token) => {
    if (pending.kind === 'create') {
      invite.mutate({ input: { ...pending.input, turnstileToken: token }, action: nextAction() });
    } else {
      resend.mutate({ invitationId: pending.invitationId, turnstileToken: token, action: nextAction() });
    }
  });
  /**
   * The server's answer to a send that may need the check: `captcha_required`
   * starts a challenge for it, `captcha_failed` of a sent token a fresh one
   * (a token is single-use); any other refusal ends the
   * attempt, so no later token sends anything without the person. Returns
   * the text for the field, or null when there is nothing to say.
   */
  const captchaOnError = (err: unknown, pending: CaptchaSend, hadToken: boolean): string | null => {
    if (err instanceof BusinessError && err.code === SpaceErrorCode.CaptchaRequired) {
      if (siteKey === null) return t('invite.captchaNotConfigured');
      captcha.start(pending);
      return null;
    }
    if (err instanceof BusinessError && err.code === SpaceErrorCode.CaptchaFailed && hadToken) {
      captcha.start(pending);
    } else {
      captcha.cancel();
    }
    return refusalText(err);
  };

  // The list follows the typing, a beat behind it.
  const [q, setQ] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQ(picked === null ? text.trim() : ''), 250);
    return () => clearTimeout(timer);
  }, [text, picked]);
  const people = useQuery<Person[]>({
    queryKey: ['spaces', 'invite-people', isAdmin ? 'admin' : 'directory', q],
    queryFn: async () => {
      if (isAdmin) {
        const res = await listUsers({ search: q, external: false, limit: 10 });
        return res.items.map((u) => ({ id: u.id, username: u.username, name: u.name }));
      }
      const res = await listUserDirectory({ q, limit: 10 });
      return res.items.map((u) => ({ id: u.id, username: u.username, name: u.name }));
    },
    enabled: q !== '' && !q.includes('@'),
    staleTime: 30_000,
  });

  const refusalText = (err: unknown): string => {
    if (err instanceof BusinessError) {
      const known = `invite.errors.${err.code}`;
      if (i18n.exists(`spaces:${known}`)) return t(known);
    }
    return err instanceof Error && err.message ? err.message : t('invite.failed');
  };

  const invite = useMutation<CreateInvitationResponse, unknown, { input: CreateInvitationInput; action: number }>({
    mutationFn: ({ input }) => createInvitation(space.id, input),
    onSuccess: (res, { input, action }) => {
      if (isStale(action)) {
        if (res.outcome === 'sent') onChanged();
        return;
      }
      captcha.cancel();
      if (res.outcome === 'sent') {
        setOutcome({ kind: 'sent' });
        setText('');
        setPicked(null);
        onChanged();
      } else if (res.outcome === 'already_member') {
        setOutcome({ kind: 'already_member', name: picked?.username ?? input.email ?? '' });
      } else {
        setOutcome({ kind: 'already_pending', invitationId: res.invitation?.id ?? null });
      }
    },
    onError: (err, { input, action }) => {
      if (isStale(action)) return;
      const pending: CaptchaSend = { kind: 'create', input: { ...input, turnstileToken: undefined } };
      const text = captchaOnError(err, pending, Boolean(input.turnstileToken));
      if (text !== null) setFieldError(text);
    },
  });
  const resend = useMutation<unknown, unknown, { invitationId: string; turnstileToken?: string; action: number }>({
    mutationFn: ({ invitationId, turnstileToken }) => resendInvitation(space.id, invitationId, turnstileToken),
    onSuccess: (_res, { action }) => {
      if (isStale(action)) {
        onChanged();
        return;
      }
      captcha.cancel();
      setOutcome({ kind: 'resent' });
      onChanged();
    },
    onError: (err, { invitationId, turnstileToken, action }) => {
      if (isStale(action)) return;
      const text = captchaOnError(err, { kind: 'resend', invitationId }, Boolean(turnstileToken));
      if (text !== null) setFieldError(text);
    },
  });
  const add = useMutation<unknown, unknown, { person: Person; action: number }>({
    mutationFn: ({ person }) => addSpaceMember(space.id, person.id),
    onSuccess: (_member, { person, action }) => {
      if (isStale(action)) {
        onChanged();
        return;
      }
      setOutcome({ kind: 'added', name: person.username });
      setText('');
      setPicked(null);
      onChanged();
    },
    onError: (err, { action }) => {
      if (!isStale(action)) setFieldError(refusalText(err));
    },
  });

  const busy = invite.isPending || add.isPending || resend.isPending;
  const seats = seatsLabel(t, space);
  const full = noSeatsLeft(space);

  const clearAnswer = () => {
    setFieldError(null);
    setOutcome(null);
  };
  /**
   * A new action of the person: the previous answer, any pending check and
   * any answer still on its way are void. Returns the
   * action's number.
   */
  const startAction = () => {
    clearAnswer();
    captcha.cancel();
    return nextAction();
  };
  /** The addressee changed: the answer and any pending captcha attempt are void. */
  const addresseeChanged = () => {
    startAction();
  };

  /** Closing ends any pending check: its token sends nothing. */
  const close = () => {
    captcha.cancel();
    onClose();
  };

  const submitInvite = () => {
    const action = startAction();
    const language = emailLanguage(i18n.language);
    if (picked !== null) {
      invite.mutate({ input: { userId: picked.id, language }, action });
      return;
    }
    const email = text.trim();
    if (!email.includes('@')) {
      setFieldError(t('invite.pickOrEmail'));
      return;
    }
    if (!EMAIL_SHAPE.test(email)) {
      setFieldError(t('invite.badEmail'));
      return;
    }
    invite.mutate({ input: { email, language }, action });
  };

  const submitAdd = () => {
    const action = startAction();
    if (picked === null) {
      setFieldError(t('invite.pickForAdd'));
      return;
    }
    add.mutate({ person: picked, action });
  };

  const outcomeText = (o: Outcome): string => {
    switch (o.kind) {
      case 'sent':
        return t('invite.sent');
      case 'already_member':
        return t('invite.alreadyMember', { name: o.name });
      case 'already_pending':
        return t('invite.alreadyPending');
      case 'resent':
        return t('invite.resent');
      case 'added':
        return t('invite.added', { name: o.name, space: space.name });
    }
  };

  const suggestions = picked === null && q !== '' ? people.data ?? [] : [];
  const captchaAttempt = captcha.attempt;

  return (
    <Modal opened onClose={close} title={t('invite.title', { space: space.name })} centered withinPortal>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!full && !busy) submitInvite();
        }}
      >
        <Stack gap="sm">
          <TextInput
            label={t('invite.field')}
            placeholder={t('invite.placeholder')}
            value={picked !== null ? (picked.name ? `${picked.username} — ${picked.name}` : picked.username) : text}
            onChange={(e) => {
              setPicked(null);
              setText(e.currentTarget.value);
              addresseeChanged();
            }}
            error={fieldError ?? undefined}
            autoComplete="off"
            data-autofocus
          />
          {suggestions.length > 0 ? (
            <div className="invite-suggestions" role="group" aria-label={t('invite.suggestionsAria')}>
              {suggestions.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="invite-suggestion"
                  onClick={() => {
                    setPicked(p);
                    addresseeChanged();
                  }}
                >
                  <span className="invite-suggestion-username">{p.username}</span>
                  {p.name ? <span className="invite-suggestion-name">{p.name}</span> : null}
                </button>
              ))}
            </div>
          ) : null}
          {seats !== null ? (
            <Text size="sm" c={full ? undefined : 'dimmed'} fw={full ? 600 : undefined}>
              {full ? t('invite.noSeats', { seats }) : t('invite.seatsOneMore', { seats })}
            </Text>
          ) : null}
          {captchaAttempt !== null && siteKey !== null ? (
            <Stack gap={4}>
              <Text size="sm" id={captchaCaptionId}>
                {t('invite.captcha')}
              </Text>
              {captcha.broken ? (
                <Text size="sm" role="alert">
                  {t('invite.captchaUnavailable')}
                </Text>
              ) : (
                <Turnstile
                  key={captchaAttempt.id}
                  siteKey={siteKey}
                  onToken={(token) => captcha.onToken(captchaAttempt.id, token)}
                  onLoadError={captcha.markBroken}
                  labelledBy={captchaCaptionId}
                />
              )}
            </Stack>
          ) : null}
          {outcome !== null ? (
            <div role="status" className="invite-outcome">
              <Text size="sm">{outcomeText(outcome)}</Text>
              {outcome.kind === 'already_pending' && outcome.invitationId !== null ? (
                <Button
                  variant="default"
                  size="xs"
                  mt="xs"
                  loading={resend.isPending}
                  onClick={() => {
                    const invitationId = outcome.invitationId as string;
                    setFieldError(null);
                    captcha.cancel();
                    resend.mutate({ invitationId, action: nextAction() });
                  }}
                >
                  {t('invite.resend')}
                </Button>
              ) : null}
            </div>
          ) : null}
          <Group justify="flex-end" gap="sm">
            <Button variant="default" onClick={close}>
              {outcome !== null ? t('invite.done') : t('invite.cancel')}
            </Button>
            {isAdmin ? (
              <Button variant="default" onClick={submitAdd} disabled={full || busy} loading={add.isPending}>
                {t('invite.add')}
              </Button>
            ) : null}
            <Button type="submit" disabled={full || busy} loading={invite.isPending}>
              {t('invite.invite')}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
