/**
 * sk-674.18 T059 — registration and the public routes (US-8, US-9; screens 1.16, 2.6).
 *
 * Row 252:
 *   • the public routes open without a session — `/signup`,
 *     `/forgot-password`, `/reset-password/:token`, `/confirm-email/:token`,
 *     `/invite/:token` render their own screen, not the sign-in page
 *     (screens 1.16); registration closed sends `/signup` to `/login`;
 *   • Turnstile is mounted only when a site key is configured — and then
 *     the request waits for its token and carries it; without a key no
 *     widget and no token;
 *   • the consent label: the terms and the policy are links to the
 *     configured addresses, plain words where an address is not set;
 *   • the consent checkbox is required: no request without it.
 *
 * The real App routes and pages; stubbed are the network (auth config,
 * signup, the invitation preview, the confirmation), the session (none),
 * the shell and `window.turnstile`.
 */
import type { TOptions } from 'i18next';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { currentAppearance, noteSignedOut } from '../auth/appearance';
import i18n from '../i18n/config';

const world = vi.hoisted(() => ({
  config: {} as Record<string, unknown>,
}));
const api = vi.hoisted(() => ({
  signupApi: vi.fn(async (_input: unknown) => ({
    id: 'u-new', email: 'dev@client.io', username: 'dev', name: '', role: 'user',
    createdAt: null, lastLoginAt: null,
  })),
  confirmEmail: vi.fn(async (_token: string) => undefined),
  signupByInvitation: vi.fn(async (_token: string, _input: unknown) => ({
    id: 'u-inv', email: 'guest@client.io', username: 'guest', name: '', role: 'user',
    createdAt: null, lastLoginAt: null, space: { id: 'sp1', slug: 'acme', name: 'Acme' },
  })),
}));

vi.mock('../auth/AuthContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../auth/AuthContext')>();
  return {
    ...actual,
    useAuth: () => ({ user: null, isLoading: false, login: vi.fn(), logout: vi.fn() }),
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
    confirmEmail: api.confirmEmail,
    getUsernameSuggestions: async () => ({ suggestions: ['guest'] }),
  };
});
vi.mock('../api/invitations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/invitations')>();
  return {
    ...actual,
    getInvitationPreview: async () => ({
      status: 'invalid', space: null, inviterUsername: null, email: null, hasAccount: null,
    }),
    signupByInvitation: api.signupByInvitation,
  };
});

import App from '../App';
import type { RuntimeAuthConfig } from '../api/auth';
import { ME_KEY } from '../auth/AuthContext';
import { SignupForm, type SignupInvitation } from './SignupPage';

function config(over: Record<string, unknown> = {}) {
  return {
    authMode: 'local', logoutRedirectUrl: null, mcpUrl: null, signupEnabled: true, emailEnabled: true,
    turnstileSiteKey: null, projectPrefixMinLength: null, termsUrl: null, privacyUrl: null, ...over,
  };
}

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <MantineProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

/** A fake `window.turnstile`: the widgets it was asked to render. */
interface FakeWidget {
  options: Record<string, unknown> & { callback: (token: string) => void };
}
function installTurnstile() {
  const widgets: FakeWidget[] = [];
  const fake = {
    render: vi.fn((_el: HTMLElement, options: FakeWidget['options']) => {
      widgets.push({ options });
      return `w${widgets.length}`;
    }),
    remove: vi.fn(),
  };
  (window as unknown as { turnstile?: unknown }).turnstile = fake;
  return { widgets, fake };
}

const t = (key: string, opts: TOptions = {}) => i18n.t(key, opts) as string;
const signupButton = () => screen.getByRole('button', { name: t('auth:signup.submit') });
const consentBox = () => screen.getByRole('checkbox');

async function openSignup() {
  renderAt('/signup');
  // The heading is there while the config loads; the form is the page.
  await screen.findByRole('button', { name: t('auth:signup.submit') });
}

function fillForm() {
  fireEvent.change(screen.getByRole('textbox', { name: new RegExp(`^${t('auth:emailLabel')}`) }), {
    target: { value: 'dev@client.io' },
  });
  fireEvent.change(screen.getByRole('textbox', { name: new RegExp(`^${t('auth:signup.usernameLabel')}`) }), {
    target: { value: 'dev' },
  });
  fireEvent.change(screen.getByLabelText(new RegExp(`^${t('auth:signup.passwordLabel')}`)), {
    target: { value: 'correct horse battery' },
  });
}

let ts: ReturnType<typeof installTurnstile>;

beforeEach(async () => {
  await i18n.changeLanguage('ru');
  world.config = config();
  ts = installTurnstile();
  for (const fn of Object.values(api)) fn.mockClear();
});

afterEach(() => {
  cleanup();
  delete (window as unknown as { turnstile?: unknown }).turnstile;
});

// ─────────────────────────── Public routes ───────────────────────────

describe('row 252 — the public routes open without a session', () => {
  test.each([
    ['/signup', 'auth:signup.title'],
    ['/forgot-password', 'auth:forgot.title'],
    ['/reset-password/tok-1', 'auth:reset.title'],
    ['/confirm-email/tok-1', 'auth:confirm.done'],
    ['/invite/tok-1', 'auth:invite.heading'],
  ])('%s shows its own screen, not the sign-in page', async (path, headingKey) => {
    renderAt(path);
    expect(await screen.findByRole('heading', { name: t(headingKey) })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: t('auth:title') })).toBeNull();
  });

  test('registration closed — /signup leads to the sign-in page', async () => {
    world.config = config({ signupEnabled: false });
    renderAt('/signup');
    expect(await screen.findByRole('heading', { name: t('auth:title') })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: t('auth:signup.title') })).toBeNull();
  });
});

// ─────────────────────────── Turnstile ───────────────────────────

describe('row 252 — Turnstile only with a configured site key', () => {
  test('no key: no widget, the request goes without a token', async () => {
    await openSignup();
    fillForm();
    fireEvent.click(consentBox());
    fireEvent.click(signupButton());
    await waitFor(() => expect(api.signupApi).toHaveBeenCalledTimes(1));
    expect(ts.fake.render).not.toHaveBeenCalled();
    expect(api.signupApi.mock.calls[0][0]).toMatchObject({
      email: 'dev@client.io', username: 'dev', termsAccepted: true, turnstileToken: null,
    });
  });

  test('an open registration is the appearance of the new user, as a login is', async () => {
    noteSignedOut();
    await openSignup();
    fillForm();
    fireEvent.click(consentBox());
    fireEvent.click(signupButton());
    await waitFor(() => expect(currentAppearance()?.userId).toBe('u-new'));
    noteSignedOut();
  });

  test('a key: one widget with that key; the request waits for its token and carries it', async () => {
    world.config = config({ turnstileSiteKey: 'site-key' });
    await openSignup();
    await waitFor(() => expect(ts.fake.render).toHaveBeenCalledTimes(1));
    expect(ts.widgets[0].options).toMatchObject({ sitekey: 'site-key' });

    fillForm();
    fireEvent.click(consentBox());
    expect((signupButton() as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(t('auth:signup.captchaPending'))).toBeTruthy();

    act(() => ts.widgets[0].options.callback('token-1'));
    await waitFor(() => expect((signupButton() as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(signupButton());
    await waitFor(() => expect(api.signupApi).toHaveBeenCalledTimes(1));
    expect(api.signupApi.mock.calls[0][0]).toMatchObject({ turnstileToken: 'token-1' });
  });
});

// ─────────────────────────── Consent ───────────────────────────

describe('row 252 — the consent label', () => {
  test.each([
    ['both addresses', 'https://skein.example.com/terms', 'https://skein.example.com/privacy'],
    ['only the terms', 'https://skein.example.com/terms', null],
    ['only the policy', null, 'https://skein.example.com/privacy'],
    ['no addresses', null, null],
  ])('%s — a link where the address is set, plain words where it is not', async (_c, termsUrl, privacyUrl) => {
    world.config = config({ termsUrl, privacyUrl });
    await openSignup();
    const label = consentBox().closest('.mantine-Checkbox-root') as HTMLElement;
    const ru = i18n.getFixedT('ru', 'account');
    const terms = ru('consent').match(/<terms>(.*?)<\/terms>/)?.[1] ?? '';
    const privacy = ru('consent').match(/<privacy>(.*?)<\/privacy>/)?.[1] ?? '';
    expect(terms).not.toBe('');
    expect(privacy).not.toBe('');

    const termsLink = within(label).queryByRole('link', { name: terms });
    const privacyLink = within(label).queryByRole('link', { name: privacy });
    if (termsUrl !== null) expect(termsLink?.getAttribute('href')).toBe(termsUrl);
    else expect(termsLink).toBeNull();
    if (privacyUrl !== null) expect(privacyLink?.getAttribute('href')).toBe(privacyUrl);
    else expect(privacyLink).toBeNull();
    // The words are there either way — as links or as text.
    expect(within(label).getByText(terms)).toBeTruthy();
    expect(within(label).getByText(privacy)).toBeTruthy();
  });
});

describe('row 252 — the consent checkbox is required', () => {
  test('unticked: the button is off and a submit sends nothing; ticked: the request says termsAccepted', async () => {
    await openSignup();
    fillForm();
    expect((signupButton() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(signupButton().closest('form') as HTMLFormElement);
    await act(async () => undefined);
    expect(api.signupApi).not.toHaveBeenCalled();

    fireEvent.click(consentBox());
    expect((signupButton() as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(signupButton());
    await waitFor(() => expect(api.signupApi).toHaveBeenCalledTimes(1));
    expect(api.signupApi.mock.calls[0][0]).toMatchObject({ termsAccepted: true });
  });
});

// ─────────────────────────── The answer of a successful registration ───────────────────────────

/**
 * What a successful answer does (the docblocks of `SignupPage` and
 * `SignupForm`): an open registration makes the answered user the session's
 * user — the `ME_KEY` slot every `useAuth` reads — and reports the account
 * as signed up; `SignupPage` turns that report into the app at `/`. A
 * registration by invitation reports the answer and leaves the session to
 * the document load of `InvitePage`, so it does not write `ME_KEY`.
 */
describe('a successful registration', () => {
  function renderForm(invitation?: SignupInvitation) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const onSignedUp = vi.fn();
    render(
      <MantineProvider>
        <QueryClientProvider client={qc}>
          <MemoryRouter>
            <SignupForm config={{ ...config(), authMode: 'local' } as RuntimeAuthConfig} invitation={invitation} onSignedUp={onSignedUp} />
          </MemoryRouter>
        </QueryClientProvider>
      </MantineProvider>,
    );
    return { qc, onSignedUp };
  }

  test('open registration: the answered user becomes the session and the account is reported signed up', async () => {
    const { qc, onSignedUp } = renderForm();
    fillForm();
    fireEvent.click(consentBox());
    fireEvent.click(signupButton());

    await waitFor(() => expect(onSignedUp).toHaveBeenCalledTimes(1));
    const answered = await api.signupApi.mock.results[0].value;
    expect(onSignedUp).toHaveBeenCalledWith(answered);
    expect(qc.getQueryData(ME_KEY)).toEqual({
      id: 'u-new', email: 'dev@client.io', username: 'dev', name: '', role: 'user',
      createdAt: null, lastLoginAt: null,
    });
  });

  test('registration by invitation: the answer is reported and the session is left to the page load', async () => {
    const { qc, onSignedUp } = renderForm({
      token: 'tok-9',
      email: 'guest@client.io',
      space: { id: 'sp1', slug: 'acme', name: 'Acme' },
    });
    await waitFor(() =>
      expect(
        (screen.getByRole('textbox', { name: new RegExp(`^${t('auth:signup.usernameLabel')}`) }) as HTMLInputElement).value,
      ).toBe('guest'),
    );
    fireEvent.change(screen.getByLabelText(new RegExp(`^${t('auth:signup.passwordLabel')}`)), {
      target: { value: 'correct horse battery' },
    });
    fireEvent.click(consentBox());
    fireEvent.click(screen.getByRole('button', { name: t('auth:invite.signupSubmit', { name: 'Acme' }) }));

    await waitFor(() => expect(onSignedUp).toHaveBeenCalledTimes(1));
    expect(api.signupByInvitation).toHaveBeenCalledWith('tok-9', expect.objectContaining({ username: 'guest' }));
    expect(onSignedUp.mock.calls[0][0]).toMatchObject({ id: 'u-inv', space: { slug: 'acme' } });
    expect(qc.getQueryData(ME_KEY)).toBeUndefined();
  });
});
