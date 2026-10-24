/**
 * sk-674.18 T059 — what each refusal says on the public screens
 * (US-5, US-8, E-5; screens 2.5–2.9).
 *
 * Row 254 — every refusal code of screens 2.5–2.8 shows its own message,
 * on every page it can reach: the invitation link (signed in and not,
 * the states and the refusals of "Accept"), registration and
 * registration by invitation, the reset request, the new password, the
 * email confirmation. Each case asserts that its message is shown and that
 * no other code's message is — a shared «something went wrong» for two
 * codes turns the row red.
 *
 * Row 254a (E-5) — the link opened under another account: no accepting,
 * the address not shown; `local` offers "Sign out and sign in with another account"
 * (sign out, then the sign-in page with the way back to this link),
 * `keycloak` and `hybrid` say to ask for an invitation of one's own
 * address.
 *
 * The real App routes and pages; stubbed are the network (auth config,
 * the public account routes, the invitation routes), the session and the
 * shell. Texts come from the dictionary.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation, type Location } from 'react-router-dom';
import i18n from '../i18n/config';
import { BusinessError, RateLimitError } from '../api/client';

const world = vi.hoisted(() => ({
  user: null as null | { id: string; email: string; username: string; name: string; role: string },
  config: {} as Record<string, unknown>,
  tokenView: {} as Record<string, unknown>,
  preview: {} as Record<string, unknown>,
}));
const api = vi.hoisted(() => ({
  signupApi: vi.fn(async (_input: unknown): Promise<unknown> => ({})),
  signupByInvitation: vi.fn(async (_token: string, _input: unknown): Promise<unknown> => ({})),
  requestPasswordReset: vi.fn(async (_email: string, _lang: string): Promise<void> => undefined),
  completePasswordReset: vi.fn(async (_token: string, _password: string): Promise<void> => undefined),
  confirmEmail: vi.fn(async (_token: string): Promise<void> => undefined),
  acceptTokenInvitation: vi.fn(async (_token: string): Promise<unknown> => ({})),
  declineTokenInvitation: vi.fn(async (_token: string): Promise<void> => undefined),
  logout: vi.fn(async () => {
    world.user = null;
  }),
}));

vi.mock('../auth/AuthContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../auth/AuthContext')>();
  return {
    ...actual,
    useAuth: () => ({ user: world.user, isLoading: false, login: vi.fn(), logout: api.logout }),
  };
});
vi.mock('./shell/Shell', () => ({ Shell: () => <div data-testid="shell-stub" /> }));
vi.mock('../components/VersionCheck', () => ({ VersionCheck: () => null }));
vi.mock('../api/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/auth')>();
  return {
    ...actual,
    getAuthConfig: async () => world.config,
    signupApi: api.signupApi,
    getUsernameSuggestions: async () => ({ suggestions: ['dev'] }),
    requestPasswordReset: api.requestPasswordReset,
    completePasswordReset: api.completePasswordReset,
    confirmEmail: api.confirmEmail,
  };
});
vi.mock('../api/invitations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/invitations')>();
  return {
    ...actual,
    getTokenInvitation: async () => world.tokenView,
    getInvitationPreview: async () => world.preview,
    acceptTokenInvitation: api.acceptTokenInvitation,
    declineTokenInvitation: api.declineTokenInvitation,
    signupByInvitation: api.signupByInvitation,
  };
});

import App from '../App';

const SPACE = { id: 'k3x9p2qa', slug: 'acme', name: 'Acme' };
const ME = { id: 'u-dev', email: 'dev@client.io', username: 'dev', name: 'Dev', role: 'user' };

function config(over: Record<string, unknown> = {}) {
  return {
    authMode: 'local', logoutRedirectUrl: null, mcpUrl: null, signupEnabled: true, emailEnabled: true,
    turnstileSiteKey: null, projectPrefixMinLength: null, termsUrl: null, privacyUrl: null, ...over,
  };
}

let lastLocation: Location | null = null;
function LocationProbe() {
  lastLocation = useLocation();
  return null;
}

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <MantineProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>
          <App />
          <LocationProbe />
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, opts) as string;
const refused = (code: string, extra: Record<string, unknown> = {}) =>
  new BusinessError(422, code, code, extra);
const rateLimited = () => new RateLimitError('rate limited', 'rate_limited');

/**
 * Every refusal message of the public screens: a case passes only if its
 * own message is shown and none of the others is.
 */
const ALL_MESSAGES = [
  'auth:codes.emailTaken',
  'auth:codes.usernameTaken',
  'auth:codes.usernameInvalid',
  'auth:codes.passwordWeak',
  'auth:codes.passwordPwned',
  'auth:codes.termsRequired',
  'auth:codes.captchaFailed',
  'auth:codes.rateLimited',
  'auth:codes.signupDisabled',
  'auth:codes.invalidRequest',
  'auth:codes.tokenInvalid',
  'auth:codes.emailDisabled',
  'auth:codes.passwordLoginDisabled',
  'auth:codes.invitationInvalid',
  'auth:codes.spaceDeleted',
  'auth:codes.unavailable',
  'auth:codes.network',
  'auth:confirm.expired',
  'auth:confirm.emailDisabled',
  'auth:invite.otherEmail',
  'auth:invite.signupClosed',
];

/** The message `key` is on the page; no other refusal message is. */
async function expectOnly(key: string, opts?: Record<string, unknown>) {
  expect(await screen.findByText(new RegExp(escape(t(key, opts))))).toBeTruthy();
  for (const other of ALL_MESSAGES) {
    if (other === key) continue;
    expect(screen.queryByText(new RegExp(escape(t(other))))).toBeNull();
  }
}
function escape(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

beforeEach(async () => {
  await i18n.changeLanguage('ru');
  world.user = null;
  world.config = config();
  world.tokenView = { status: 'valid', space: SPACE, inviterUsername: 'anna', expiresAt: '2026-10-20T00:00:00Z' };
  world.preview = { status: 'valid', space: SPACE, inviterUsername: 'anna', email: 'new@client.io', hasAccount: false };
  lastLocation = null;
  for (const fn of Object.values(api)) fn.mockClear();
});

afterEach(() => cleanup());

// ─────────────────────────── The invitation link (2.5) ───────────────────────────

describe('row 254 — the invitation link: each state its own message', () => {
  test.each([
    ['space_deleted', 'auth:codes.spaceDeleted'],
    ['invalid', 'auth:codes.invitationInvalid'],
  ])('signed in, %s', async (status, key) => {
    world.user = ME;
    world.tokenView = { status, space: null, inviterUsername: null, expiresAt: null };
    renderAt('/invite/tok-1');
    await expectOnly(key);
    expect(screen.queryByRole('button', { name: t('auth:invite.accept') })).toBeNull();
  });

  test('signed in, already a member: "You are already in Acme" and "Open", nothing to accept', async () => {
    world.user = ME;
    world.tokenView = { status: 'already_member', space: SPACE, inviterUsername: null, expiresAt: null };
    renderAt('/invite/tok-1');
    expect(await screen.findByRole('heading', { name: t('auth:invite.alreadyMember', { name: 'Acme' }) })).toBeTruthy();
    expect(screen.getByRole('button', { name: t('auth:invite.open') })).toBeTruthy();
    expect(screen.queryByRole('button', { name: t('auth:invite.accept') })).toBeNull();
    for (const key of ALL_MESSAGES) expect(screen.queryByText(t(key))).toBeNull();
  });

  test.each([
    ['space_deleted', 'auth:codes.spaceDeleted'],
    ['invalid', 'auth:codes.invitationInvalid'],
  ])('not signed in, %s', async (status, key) => {
    world.preview = { status, space: null, inviterUsername: null, email: null, hasAccount: null };
    renderAt('/invite/tok-1');
    await expectOnly(key);
  });

  test.each([
    ['space_deleted', 'auth:codes.spaceDeleted'],
    ['invitation_invalid', 'auth:codes.invitationInvalid'],
    ['invitation_other_email', 'auth:invite.otherEmail'],
  ])('"Accept" refused with %s', async (code, key) => {
    world.user = ME;
    api.acceptTokenInvitation.mockRejectedValueOnce(refused(code));
    renderAt('/invite/tok-1');
    fireEvent.click(await screen.findByRole('button', { name: t('auth:invite.accept') }));
    await expectOnly(key);
    expect(screen.queryByRole('button', { name: t('auth:invite.accept') })).toBeNull();
  });

  test('no account and registration closed: says so, no form', async () => {
    world.config = config({ signupEnabled: false });
    renderAt('/invite/tok-1');
    await expectOnly('auth:invite.signupClosed');
    expect(screen.queryByRole('button', { name: t('auth:invite.signupSubmit', { name: 'Acme' }) })).toBeNull();
  });
});

// ─────────────────────────── Registration (2.6, 2.7) ───────────────────────────

async function submitSignup(path: string, submitName: string) {
  renderAt(path);
  const submit = await screen.findByRole('button', { name: submitName });
  if (path === '/signup') {
    fireEvent.change(screen.getByRole('textbox', { name: new RegExp(`^${t('auth:emailLabel')}`) }), {
      target: { value: 'dev@client.io' },
    });
  }
  fireEvent.change(screen.getByRole('textbox', { name: new RegExp(`^${t('auth:signup.usernameLabel')}`) }), {
    target: { value: 'dev' },
  });
  fireEvent.change(screen.getByLabelText(new RegExp(`^${t('auth:signup.passwordLabel')}`), { selector: 'input' }), {
    target: { value: 'correct horse battery' },
  });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(submit);
}

const SIGNUP_CODES: Array<[string, () => Error, string]> = [
  ['email_taken', () => refused('email_taken'), 'auth:codes.emailTaken'],
  ['username_taken', () => refused('username_taken', { suggestions: ['dev2', 'dev-client'] }), 'auth:codes.usernameTaken'],
  ['username_invalid', () => refused('username_invalid'), 'auth:codes.usernameInvalid'],
  ['password_weak', () => refused('password_weak'), 'auth:codes.passwordWeak'],
  ['password_pwned', () => refused('password_pwned'), 'auth:codes.passwordPwned'],
  ['terms_required', () => refused('terms_required'), 'auth:codes.termsRequired'],
  ['captcha_failed', () => refused('captcha_failed'), 'auth:codes.captchaFailed'],
  ['rate_limited', rateLimited, 'auth:codes.rateLimited'],
  ['signup_disabled', () => refused('signup_disabled'), 'auth:codes.signupDisabled'],
];

describe('row 254 — registration: each refusal its own message', () => {
  test.each(SIGNUP_CODES)('/signup, %s', async (_code, error, key) => {
    api.signupApi.mockRejectedValueOnce(error());
    await submitSignup('/signup', t('auth:signup.submit'));
    await expectOnly(key);
  });

  test('/signup, email_taken offers to sign in', async () => {
    api.signupApi.mockRejectedValueOnce(refused('email_taken'));
    await submitSignup('/signup', t('auth:signup.submit'));
    await expectOnly('auth:codes.emailTaken');
    const signIn = screen.getAllByRole('link', { name: t('auth:links.signIn') });
    expect(signIn.some((a) => a.getAttribute('href') === '/login')).toBe(true);
  });

  test('/signup, username_taken offers the free names the server sent, and one fills the field', async () => {
    api.signupApi.mockRejectedValueOnce(refused('username_taken', { suggestions: ['dev2', 'dev-client'] }));
    await submitSignup('/signup', t('auth:signup.submit'));
    await expectOnly('auth:codes.usernameTaken');
    const offered = screen.getByRole('group', { name: t('auth:signup.suggestions') });
    expect(offered.querySelectorAll('button')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'dev-client' }));
    expect(
      (screen.getByRole('textbox', { name: new RegExp(`^${t('auth:signup.usernameLabel')}`) }) as HTMLInputElement).value,
    ).toBe('dev-client');
  });

  test.each(SIGNUP_CODES.filter(([code]) => code !== 'email_taken'))(
    'by invitation, %s',
    async (_code, error, key) => {
      api.signupByInvitation.mockRejectedValueOnce(error());
      await submitSignup('/invite/tok-1', t('auth:invite.signupSubmit', { name: 'Acme' }));
      await expectOnly(key);
    },
  );

  test.each([
    ['invitation_invalid', 'auth:codes.invitationInvalid'],
    ['space_deleted', 'auth:codes.spaceDeleted'],
  ])('by invitation, the invitation died while filling: %s replaces the form', async (code, key) => {
    api.signupByInvitation.mockRejectedValueOnce(refused(code));
    await submitSignup('/invite/tok-1', t('auth:invite.signupSubmit', { name: 'Acme' }));
    await expectOnly(key);
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
});

// ─────────────────────────── Password reset (2.8) ───────────────────────────

describe('row 254 — the password reset: each refusal its own message', () => {
  test.each([
    ['rate_limited', rateLimited, 'auth:codes.rateLimited'],
    ['email_disabled', () => refused('email_disabled'), 'auth:codes.emailDisabled'],
    ['password_login_disabled', () => refused('password_login_disabled'), 'auth:codes.passwordLoginDisabled'],
  ])('the request, %s', async (_code, error, key) => {
    api.requestPasswordReset.mockRejectedValueOnce(error());
    renderAt('/forgot-password');
    fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'dev@client.io' } });
    fireEvent.click(screen.getByRole('button', { name: t('auth:forgot.submit') }));
    await expectOnly(key);
  });

  test('the request answers one neutral text', async () => {
    renderAt('/forgot-password');
    fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'dev@client.io' } });
    fireEvent.click(screen.getByRole('button', { name: t('auth:forgot.submit') }));
    expect(await screen.findByText(t('auth:forgot.sent'))).toBeTruthy();
    for (const key of ALL_MESSAGES) expect(screen.queryByText(t(key))).toBeNull();
  });

  test.each([
    ['token_invalid', () => refused('token_invalid'), 'auth:codes.tokenInvalid'],
    ['password_weak', () => refused('password_weak'), 'auth:codes.passwordWeak'],
    ['password_pwned', () => refused('password_pwned'), 'auth:codes.passwordPwned'],
    ['rate_limited', rateLimited, 'auth:codes.rateLimited'],
    ['email_disabled', () => refused('email_disabled'), 'auth:codes.emailDisabled'],
    ['password_login_disabled', () => refused('password_login_disabled'), 'auth:codes.passwordLoginDisabled'],
  ])('the new password, %s', async (_code, error, key) => {
    api.completePasswordReset.mockRejectedValueOnce(error());
    renderAt('/reset-password/tok-1');
    const field = await screen.findByLabelText(new RegExp(`^${t('auth:reset.passwordLabel')}`), { selector: 'input' });
    fireEvent.change(field, { target: { value: 'correct horse battery' } });
    fireEvent.click(screen.getByRole('button', { name: t('auth:reset.submit') }));
    await expectOnly(key);
  });

  test('the new password, token_invalid offers a new link', async () => {
    api.completePasswordReset.mockRejectedValueOnce(refused('token_invalid'));
    renderAt('/reset-password/tok-1');
    const field = await screen.findByLabelText(new RegExp(`^${t('auth:reset.passwordLabel')}`), { selector: 'input' });
    fireEvent.change(field, { target: { value: 'correct horse battery' } });
    fireEvent.click(screen.getByRole('button', { name: t('auth:reset.submit') }));
    const again = await screen.findByRole('link', { name: t('auth:reset.requestNew') });
    expect(again.getAttribute('href')).toBe('/forgot-password');
  });
});

// ─────────────────────────── Email confirmation (2.9) ───────────────────────────

describe('row 254 — the email confirmation: each refusal its own message', () => {
  test.each([
    ['token_invalid', () => refused('token_invalid'), 'auth:confirm.expired'],
    ['email_disabled', () => refused('email_disabled'), 'auth:confirm.emailDisabled'],
    ['rate_limited', rateLimited, 'auth:codes.rateLimited'],
  ])('%s', async (_code, error, key) => {
    api.confirmEmail.mockRejectedValueOnce(error());
    renderAt('/confirm-email/tok-1');
    await expectOnly(key);
    expect(api.confirmEmail).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────── Another account (2.5, E-5) ───────────────────────────

describe('row 254a — the link opened under another account', () => {
  beforeEach(() => {
    world.user = ME;
    world.tokenView = { status: 'other_email', space: null, inviterUsername: null, expiresAt: null };
  });

  function expectNoAcceptingNoAddress() {
    expect(screen.queryByRole('button', { name: t('auth:invite.accept') })).toBeNull();
    expect(screen.queryByText(/@/)).toBeNull();
  }

  test('local: "Sign out and sign in with another account" signs out and opens sign-in with the way back here', async () => {
    renderAt('/invite/tok-1');
    expect(await screen.findByRole('heading', { name: t('auth:invite.otherEmail') })).toBeTruthy();
    expectNoAcceptingNoAddress();
    expect(screen.queryByText(t('auth:invite.askOwnAddress'))).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: t('auth:invite.switchAccount') }));
    await waitFor(() => expect(api.logout).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('heading', { name: t('auth:title') })).toBeTruthy();
    expect(lastLocation?.pathname).toBe('/login');
    expect((lastLocation?.state as { from?: { pathname?: string } } | null)?.from?.pathname).toBe('/invite/tok-1');
  });

  test.each(['keycloak', 'hybrid'])('%s: ask to invite your own address, no sign-out action', async (authMode) => {
    world.config = config({ authMode });
    renderAt('/invite/tok-1');
    expect(await screen.findByRole('heading', { name: t('auth:invite.otherEmail') })).toBeTruthy();
    expect(screen.getByText(t('auth:invite.askOwnAddress'))).toBeTruthy();
    expect(screen.queryByRole('button', { name: t('auth:invite.switchAccount') })).toBeNull();
    expectNoAcceptingNoAddress();
  });
});
