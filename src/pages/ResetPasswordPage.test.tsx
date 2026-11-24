/**
 * sk-1081 — the success view of `/reset-password/:token` follows the session
 * the 204 issued.
 *
 * `POST /api/auth/password-reset/{token}` answers 204 with a cookie of a NEW
 * session of the link's owner, whatever cookie came in
 * (`api/auth.ts#completePasswordReset`). The success view appears with the
 * 204; its link opens the app only when a read of `/me` made after the 204
 * names a user, and offers to sign in otherwise — also while that read is
 * pending or after it failed, whoever the page knew before the submit.
 *
 * The real `AuthProvider` and page; stubbed is `api/auth` at the module
 * boundary: `/me` answers `server.before` until the reset and then what
 * `server.afterReset` names, and a test may hold single reads.
 */
import type { TOptions } from 'i18next';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import i18n from '../i18n/config';
import type { User } from '../api/auth';
import { ApiError } from '../api/client';
import { currentAppearance, noteSignedOut } from '../auth/appearance';

function person(id: string, username: string): User {
  return { id, email: `${username}@example.test`, username, name: username, role: 'user', createdAt: null, lastLoginAt: null };
}
const OWNER = person('11111111-1111-4111-8111-111111111111', 'owner');
const OTHER = person('22222222-2222-4222-8222-222222222222', 'other');

/** What `/me` answers after the reset: the owner, nobody, or a 500. */
type AfterReset = 'owner' | 'nobody' | 'fails';

const server = vi.hoisted(() => ({
  before: null as User | null,
  afterReset: 'owner' as 'owner' | 'nobody' | 'fails',
  reset: false,
}));

async function answerMe(): Promise<User | null> {
  if (!server.reset) return server.before;
  if (server.afterReset === 'fails') throw new ApiError(500, 'HTTP 500');
  return server.afterReset === 'owner' ? OWNER : null;
}
const meApi = vi.fn<(signal?: AbortSignal) => Promise<User | null>>();
const completePasswordReset = vi.fn(async (_token: string, _password: string) => {
  // The 204 sets the cookie of the owner's new session.
  server.reset = true;
});

vi.mock('../api/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/auth')>();
  return {
    ...actual,
    meApi: (signal?: AbortSignal) => meApi(signal),
    completePasswordReset: (token: string, password: string) => completePasswordReset(token, password),
    getAuthConfig: async () => ({
      authMode: 'local',
      logoutRedirectUrl: null,
      mcpUrl: null,
      signupEnabled: false,
      emailEnabled: true,
      turnstileSiteKey: null,
      projectPrefixMinLength: null,
      termsUrl: null,
      privacyUrl: null,
    }),
  };
});

vi.mock('../components/Toaster', () => ({
  toaster: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
  useToaster: () => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }),
}));

import { AuthProvider } from '../auth/AuthContext';
import { ResetPasswordPage } from './ResetPasswordPage';

const t = (key: string, opts: TOptions = {}) => i18n.t(key, opts) as string;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Lets every pending promise continuation run. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function renderReset() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <MantineProvider>
      <QueryClientProvider client={client}>
        <AuthProvider>
          <MemoryRouter initialEntries={['/reset-password/tok-1']}>
            <Routes>
              <Route path="/reset-password/:token" element={<ResetPasswordPage />} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

async function submitNewPassword() {
  const field = await screen.findByLabelText(new RegExp(`^${t('auth:reset.passwordLabel')}`), {
    selector: 'input',
  });
  fireEvent.change(field, { target: { value: 'a-long-new-password-1' } });
  fireEvent.click(screen.getByRole('button', { name: t('auth:reset.submit') }));
}

const openAppLink = () => screen.queryByRole('link', { name: t('auth:reset.openApp') });
const signInLink = () => screen.queryByRole('link', { name: t('auth:links.signIn') });

beforeEach(() => {
  server.before = null;
  server.afterReset = 'owner';
  server.reset = false;
  vi.clearAllMocks();
  meApi.mockReset().mockImplementation(answerMe);
  noteSignedOut();
});

afterEach(() => cleanup());

describe('ResetPasswordPage — success after the 204', () => {
  test.each<{ name: string; before: User | null; after: AfterReset; link: 'openApp' | 'signIn' }>([
    { name: 'nobody before, the owner after: the app', before: null, after: 'owner', link: 'openApp' },
    { name: 'another person before, the owner after: the app', before: OTHER, after: 'owner', link: 'openApp' },
    { name: 'another person before, the read after fails: the sign-in', before: OTHER, after: 'fails', link: 'signIn' },
    { name: 'nobody before, nobody after: the sign-in', before: null, after: 'nobody', link: 'signIn' },
  ])('$name', async ({ before, after, link }) => {
    server.before = before;
    server.afterReset = after;
    renderReset();
    // The page holds the answer from before the submit.
    await waitFor(() => expect(meApi).toHaveBeenCalledTimes(1));
    await settle();
    await submitNewPassword();
    // The read after the reset has answered.
    await waitFor(() => expect(meApi).toHaveBeenCalledTimes(2));
    await settle();

    expect(screen.getByRole('status').textContent).toBe(t('auth:reset.done'));
    if (link === 'openApp') {
      expect(openAppLink()?.getAttribute('href')).toBe('/');
      expect(signInLink()).toBeNull();
    } else {
      expect(signInLink()?.getAttribute('href')).toBe('/login');
      expect(openAppLink()).toBeNull();
    }
    expect(completePasswordReset).toHaveBeenCalledWith('tok-1', 'a-long-new-password-1');
  });

  test('a read of /me sent before the reset and answered after it decides neither the link nor the appearance', async () => {
    const early = deferred<User | null>();
    meApi.mockImplementationOnce(() => early.promise);
    renderReset();
    // The form is ready while the first read of /me is still out.
    await submitNewPassword();
    await waitFor(() => expect(completePasswordReset).toHaveBeenCalledTimes(1));
    await settle();

    // That read answers now, with the state from before the reset: nobody.
    early.resolve(null);
    await settle();

    expect(openAppLink()?.getAttribute('href')).toBe('/');
    expect(signInLink()).toBeNull();
    expect(currentAppearance()?.userId).toBe(OWNER.id);
  });

  test('the success view appears with the 204 and offers the sign-in until the read after it confirms a user', async () => {
    renderReset();
    await waitFor(() => expect(meApi).toHaveBeenCalledTimes(1));
    await settle();
    const after = deferred<User | null>();
    meApi.mockImplementationOnce(() => after.promise);
    await submitNewPassword();
    await waitFor(() => expect(meApi).toHaveBeenCalledTimes(2));
    await settle();

    expect(screen.getByRole('status').textContent).toBe(t('auth:reset.done'));
    expect(screen.queryByRole('button', { name: t('auth:reset.submitting') })).toBeNull();
    expect(signInLink()?.getAttribute('href')).toBe('/login');
    expect(openAppLink()).toBeNull();

    after.resolve(OWNER);
    await settle();
    expect(openAppLink()?.getAttribute('href')).toBe('/');
    expect(signInLink()).toBeNull();
  });
});
