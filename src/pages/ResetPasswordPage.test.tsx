/**
 * sk-1081 — the success view of `/reset-password/:token` follows the session
 * the 204 issued.
 *
 * `POST /api/auth/password-reset/{token}` answers 204 with a cookie of a NEW
 * session of the link's owner, whatever cookie came in
 * (`api/auth.ts#completePasswordReset`). A visitor who had no session is
 * signed in by it, so the success view offers to open the app, not to sign
 * in.
 *
 * The real `AuthProvider` and page; stubbed is `api/auth` at the module
 * boundary: `/me` answers nobody before the submit and the owner after it.
 */
import type { TOptions } from 'i18next';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import i18n from '../i18n/config';
import type { User } from '../api/auth';

const OWNER: User = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'owner@example.test',
  username: 'owner',
  name: 'Owner',
  role: 'user',
  createdAt: null,
  lastLoginAt: null,
};

const server = vi.hoisted(() => ({
  session: null as User | null,
}));
const meApi = vi.fn(async () => server.session);
const completePasswordReset = vi.fn(async (_token: string, _password: string) => {
  // The 204 sets the cookie of the owner's new session.
  server.session = OWNER;
});

vi.mock('../api/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/auth')>();
  return {
    ...actual,
    meApi: () => meApi(),
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

beforeEach(() => {
  server.session = null;
  vi.clearAllMocks();
});

afterEach(() => cleanup());

describe('ResetPasswordPage — success after the 204', () => {
  test('a visitor with no session is signed in by the 204 and is offered the app, not the sign-in', async () => {
    renderReset();
    const field = await screen.findByLabelText(new RegExp(`^${t('auth:reset.passwordLabel')}`), {
      selector: 'input',
    });
    fireEvent.change(field, { target: { value: 'a-long-new-password-1' } });
    fireEvent.click(screen.getByRole('button', { name: t('auth:reset.submit') }));

    const open = await screen.findByRole('link', { name: t('auth:reset.openApp') });
    expect(open.getAttribute('href')).toBe('/');
    expect(screen.queryByRole('link', { name: t('auth:links.signIn') })).toBeNull();
    expect(completePasswordReset).toHaveBeenCalledWith('tok-1', 'a-long-new-password-1');
  });
});
