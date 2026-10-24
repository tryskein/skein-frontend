import { useState } from 'react';
import { Button, Group } from '@mantine/core';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { AccountErrorCode, type RuntimeAuthConfig } from '../api/auth';
import { BusinessError } from '../api/client';
import {
  acceptTokenInvitation,
  declineTokenInvitation,
  getInvitationPreview,
  getTokenInvitation,
  type InvitationPreview,
  type TokenInvitationView,
} from '../api/invitations';
import { SpaceErrorCode, type SpaceRef } from '../api/spaces';
import { useAuth } from '../auth/AuthContext';
import { spaceHandle, spacePath } from '../lib/shellUrlState';
import { useAuthConfig } from '../lib/useAuthConfig';
import { FormError, PublicLoading, PublicPage, refusalKey, useNoReferrer } from './publicAuth';
import { SignupForm } from './SignupPage';

/**
 * sk-674.18 T059 — the invitation link `/invite/:token` (screens 2.5, 2.7;
 * spec US-5), public.
 *
 * Who opened it decides the screen, and the states are checked in the
 * order of screens 2.5 — the server answers in that order, the page shows
 * what it answered:
 *
 *  - signed in: GET /api/v1/invitations/{token} — `space_deleted`,
 *    `already_member` ("You are already in …" + "Open", before "invalid"),
 *    `invalid`, `other_email` (no accepting; by sign-in mode, K7 — `local`:
 *    sign out and sign in with another account, back here; SSO: ask for an
 *    invitation of your own address. The address itself is never shown,
 *    the link may be open in someone else's hands), `valid` — "Accept" /
 *    "Decline". Opening it as the addressee confirms the email, so
 *    "Accept" works even with an email unconfirmed before.
 *  - not signed in: GET /api/auth/invitations/{token} — a dead link says
 *    why; a live one leads to sign-in with "Sign in to accept
 *    the invitation to …" when the address has an account (back here after),
 *    or to registration by invitation (2.7) when it has not.
 *
 * Leaving to the app ("Accept" → the space, "Decline" → `/`, "Open")
 * is a document load, not a client-side navigation: this document was
 * served with the token pages' headers (`nginx.conf`: no referrer, the
 * stricter CSP), and the app is loaded fresh with its own.
 */
export function InvitePage() {
  const { t } = useTranslation('auth');
  const { token = '' } = useParams<{ token: string }>();
  const { user, isLoading } = useAuth();
  const config = useAuthConfig();
  useNoReferrer();

  if (isLoading || config.isLoading) {
    return (
      <PublicPage title={t('invite.title', { name: '…' })} titleId="invite-title">
        <PublicLoading />
      </PublicPage>
    );
  }
  if (config.isError || !config.data) {
    return (
      <PublicPage title={t('loadErrorTitle')} titleId="invite-title">
        <FormError>{t('configErrorBody')}</FormError>
        <Button type="button" fullWidth className="login-submit" onClick={() => config.refetch()}>
          {t('retry')}
        </Button>
      </PublicPage>
    );
  }
  return user ? (
    <SignedInInvitation token={token} config={config.data} />
  ) : (
    <VisitorInvitation token={token} config={config.data} />
  );
}

/** Leave this document for the app (see the page's docblock). */
function openInApp(path: string): void {
  window.location.assign(path);
}

/** The text of a dead link, by state; one text per state. */
function DeadLink({ state }: { state: 'space_deleted' | 'invalid' }) {
  const { t } = useTranslation('auth');
  return (
    <PublicPage title={t('invite.heading')} titleId="invite-title">
      <p className="login-note" role="status">
        {state === 'space_deleted' ? t('codes.spaceDeleted') : t('codes.invitationInvalid')}
      </p>
    </PublicPage>
  );
}

function LoadFailure({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t } = useTranslation('auth');
  return (
    <PublicPage title={t('loadErrorTitle')} titleId="invite-title">
      <FormError>{t(refusalKey(error))}</FormError>
      <Button type="button" fullWidth className="login-submit" onClick={onRetry}>
        {t('retry')}
      </Button>
    </PublicPage>
  );
}

// ───────────────────────── Signed in ─────────────────────────

/** A refusal of accept/decline that turns the screen into another state. */
type GoneState = 'space_deleted' | 'invalid' | 'other_email';

function goneState(err: unknown): GoneState | null {
  if (!(err instanceof BusinessError)) return null;
  switch (err.code) {
    case SpaceErrorCode.SpaceDeleted:
      return 'space_deleted';
    case SpaceErrorCode.InvitationInvalid:
      return 'invalid';
    case SpaceErrorCode.InvitationOtherEmail:
      return 'other_email';
    default:
      return null;
  }
}

function SignedInInvitation({ token, config }: { token: string; config: RuntimeAuthConfig }) {
  const { t } = useTranslation('auth');
  const view = useQuery<TokenInvitationView>({
    queryKey: ['invitations', 'token', token],
    queryFn: () => getTokenInvitation(token),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const [gone, setGone] = useState<GoneState | null>(null);
  const [leaving, setLeaving] = useState(false);

  const accept = useMutation({
    mutationFn: () => acceptTokenInvitation(token),
    onSuccess: (res) => {
      setLeaving(true);
      openInApp(spacePath(spaceHandle(res.space)));
    },
    onError: (err) => setGone(goneState(err)),
  });
  const decline = useMutation({
    mutationFn: () => declineTokenInvitation(token),
    onSuccess: () => {
      setLeaving(true);
      openInApp('/');
    },
    onError: (err) => setGone(goneState(err)),
  });

  if (view.isPending || leaving) {
    return (
      <PublicPage title={t('invite.title', { name: '…' })} titleId="invite-title">
        <PublicLoading />
      </PublicPage>
    );
  }
  if (view.isError) return <LoadFailure error={view.error} onRetry={() => void view.refetch()} />;

  const status = gone ?? view.data.status;
  switch (status) {
    case 'space_deleted':
    case 'invalid':
      return <DeadLink state={status} />;
    case 'already_member':
      return <AlreadyMember space={view.data.space} />;
    case 'other_email':
      return <OtherEmail token={token} authMode={config.authMode} />;
    case 'valid':
      break;
  }

  const space = view.data.space;
  const busy = accept.isPending || decline.isPending;
  const failure = accept.error ?? decline.error;
  return (
    <PublicPage title={t('invite.title', { name: space?.name ?? '' })} titleId="invite-title">
      {view.data.inviterUsername ? (
        <p className="login-tagline">{t('invite.invitedBy', { name: view.data.inviterUsername })}</p>
      ) : null}
      {failure && goneState(failure) === null ? <FormError>{t(refusalKey(failure))}</FormError> : null}
      <Group grow>
        <Button
          type="button"
          variant="filled"
          color="orange"
          className="login-submit"
          loading={accept.isPending}
          disabled={busy}
          onClick={() => accept.mutate()}
        >
          {t('invite.accept')}
        </Button>
        <Button
          type="button"
          className="login-submit"
          loading={decline.isPending}
          disabled={busy}
          onClick={() => decline.mutate()}
        >
          {t('invite.decline')}
        </Button>
      </Group>
    </PublicPage>
  );
}

function AlreadyMember({ space }: { space: SpaceRef | null }) {
  const { t } = useTranslation('auth');
  return (
    <PublicPage title={t('invite.alreadyMember', { name: space?.name ?? '' })} titleId="invite-title">
      <Button
        type="button"
        variant="filled"
        color="orange"
        fullWidth
        className="login-submit"
        onClick={() => openInApp(space ? spacePath(spaceHandle(space)) : '/')}
      >
        {t('invite.open')}
      </Button>
    </PublicPage>
  );
}

/**
 * Screens 2.5 "another address" (scenario 4, K7, E-5). No accepting, no
 * address. `local`: sign out, sign in as the right account and come back
 * here. `keycloak` / `hybrid`: signing in again would bring the same SSO
 * account back (in `hybrid` only the external users and the emergency
 * admin use a password, and externals are never invited, K12), so the
 * honest way is to ask for an invitation of one's own address.
 */
function OtherEmail({ token, authMode }: { token: string; authMode: RuntimeAuthConfig['authMode'] }) {
  const { t } = useTranslation('auth');
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const switchAccount = async () => {
    setBusy(true);
    try {
      await logout();
    } finally {
      navigate('/login', { replace: true, state: { from: { pathname: `/invite/${token}` } } });
    }
  };

  return (
    <PublicPage title={t('invite.otherEmail')} titleId="invite-title">
      {authMode === 'local' ? (
        <Button
          type="button"
          variant="filled"
          color="orange"
          fullWidth
          className="login-submit"
          loading={busy}
          onClick={() => void switchAccount()}
        >
          {t('invite.switchAccount')}
        </Button>
      ) : (
        <p className="login-note">{t('invite.askOwnAddress')}</p>
      )}
    </PublicPage>
  );
}

// ───────────────────────── Not signed in ─────────────────────────

function VisitorInvitation({ token, config }: { token: string; config: RuntimeAuthConfig }) {
  const { t } = useTranslation('auth');
  const preview = useQuery<InvitationPreview>({
    queryKey: ['invitations', 'preview', token],
    queryFn: () => getInvitationPreview(token),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const [gone, setGone] = useState<'space_deleted' | 'invalid' | null>(null);
  const [leaving, setLeaving] = useState<string | null>(null);

  if (leaving !== null) {
    return (
      <PublicPage title={t('invite.title', { name: leaving })} titleId="invite-title">
        <PublicLoading />
      </PublicPage>
    );
  }
  if (preview.isPending) {
    return (
      <PublicPage title={t('invite.title', { name: '…' })} titleId="invite-title">
        <PublicLoading />
      </PublicPage>
    );
  }
  if (preview.isError) return <LoadFailure error={preview.error} onRetry={() => void preview.refetch()} />;

  const data = preview.data;
  const status = gone ?? data.status;
  if (status !== 'valid') return <DeadLink state={status} />;
  const space = data.space;
  if (space === null || data.email === null) return <DeadLink state="invalid" />;

  // Scenario 5: the address has an account — sign in, then back here; the
  // token stays out of the sign-in page's address (screens 1.13).
  if (data.hasAccount) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: { pathname: `/invite/${token}` }, invitationSpace: space.name }}
      />
    );
  }

  // Scenario 2: no account. With registration closed there is nothing this
  // link can do — say so rather than show a form the server refuses.
  if (!config.signupEnabled) {
    return (
      <PublicPage title={t('invite.title', { name: space.name })} titleId="invite-title">
        <p className="login-note" role="status">
          {t('invite.signupClosed')}
        </p>
      </PublicPage>
    );
  }

  return (
    <PublicPage title={t('invite.title', { name: space.name })} titleId="invite-title">
      <SignupForm
        config={config}
        invitation={{ token, email: data.email, space }}
        onSignedUp={(result) => {
          setLeaving(space.name);
          const joined = 'space' in result ? result.space : space;
          openInApp(spacePath(spaceHandle(joined)));
        }}
        onInvitationGone={(code) =>
          setGone(code === AccountErrorCode.SpaceDeleted ? 'space_deleted' : 'invalid')
        }
      />
      <p className="login-note public-switch">{t('invite.otherAccountChoice')}</p>
    </PublicPage>
  );
}
