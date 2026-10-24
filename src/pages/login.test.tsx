/**
 * sk-163 S4c — Login page renders the right affordance per `authMode`, and
 * handles the 403 `sso_required` response without auto-redirecting.
 *
 * Render contract (from sk-163.12, updated sk-303.8 — the Host-based
 * `isExternalHost` split was removed; hybrid mode now always renders both
 * affordances):
 *   local     → password form only
 *   keycloak  → SSO button only
 *   hybrid    → SSO button AND password form (break-glass)
 *   403 sso_required → SSO affordance shown, NO auto-redirect
 *
 * Both hooks the page depends on (useAuthConfig, useAuth) are mocked at the
 * module level — same offline/deterministic strategy as HeaderBar.test.tsx.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { MantineProvider } from '@mantine/core';
import { ApiError, BusinessError } from '../api/client';
import type { RuntimeAuthConfig } from '../api/auth';
import i18n from '../i18n/config';

// ─────────────────────────── Mocks ───────────────────────────

type AuthMode = 'local' | 'keycloak' | 'hybrid';

// Mutable driver — each test sets the authMode it wants before rendering.
// Initialised at declaration so the vi.mock factory (called lazily at
// render time) always sees a defined value.
let mockAuthConfig: {
  data: (Partial<RuntimeAuthConfig> & { authMode: AuthMode }) | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
} = {
  data: { authMode: 'local' },
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
};

vi.mock('../lib/useAuthConfig', () => ({
  useAuthConfig: () => mockAuthConfig,
}));

const mockLogin = vi.fn();
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ user: null, login: mockLogin, logout: vi.fn(), isLoading: false }),
}));

// Imported AFTER the mocks so the mocked modules are wired in.
import { LoginPage } from './login';
import { ForgotPasswordPage } from './ForgotPasswordPage';
import { ResetPasswordPage } from './ResetPasswordPage';

function setAuth(authMode: AuthMode) {
  mockAuthConfig = {
    data: { authMode },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  };
}

function renderLogin() {
  return render(
    <MantineProvider>
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    </MantineProvider>,
  );
}

// sk-285.6.14 — the copy moved into the `auth` dictionary and the
// English wording became «Log in with Keycloak» (the old literal read
// `> login via keycloak`, terminal prompt included). The QUERIES below
// were re-pointed at the new wording; not one assertion in this file
// changed, because none of the behaviour did.
const ssoButton = () => screen.queryByRole('button', { name: /keycloak/i });
const passwordField = () => screen.queryByPlaceholderText('••••••••');
const emailField = () => screen.queryByPlaceholderText('you@example.com');

// jsdom's window.location.assign is non-configurable, so vi.spyOn can't
// wrap it. Swap the whole location object for a stub that exposes just
// the props the component touches (origin + assign).
let assignMock: ReturnType<typeof vi.fn>;
const realLocation = window.location;

beforeEach(() => {
  mockLogin.mockReset();
  assignMock = vi.fn();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { origin: realLocation.origin, href: realLocation.href, assign: assignMock },
  });
});

afterEach(() => {
  cleanup();
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation });
});

// ─────────────────────────── Render contract ───────────────────────────

describe('LoginPage render contract (sk-163 S4c)', () => {
  test('local → password form only, no SSO button', () => {
    setAuth('local');
    renderLogin();
    expect(emailField()).not.toBeNull();
    expect(passwordField()).not.toBeNull();
    expect(ssoButton()).toBeNull();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeTruthy();
  });

  test('keycloak → SSO button only, no password form', () => {
    setAuth('keycloak');
    renderLogin();
    expect(ssoButton()).not.toBeNull();
    expect(emailField()).toBeNull();
    expect(passwordField()).toBeNull();
  });

  test('hybrid → BOTH SSO button and password form (break-glass)', () => {
    setAuth('hybrid');
    renderLogin();
    // Under active OIDC: SSO is primary, but the password form MUST stay
    // reachable so the break-glass admin is not locked out. sk-303.8 — this
    // used to only hold on a host classified "internal"; that classification
    // is gone and hybrid mode now always renders both.
    expect(ssoButton()).not.toBeNull();
    expect(emailField()).not.toBeNull();
    expect(passwordField()).not.toBeNull();
  });
});

// ─────────────────────────── 403 sso_required ───────────────────────────

describe('LoginPage 403 sso_required handling (sk-163 S4c)', () => {
  test('renders SSO affordance and does NOT auto-redirect', async () => {
    // Hybrid mode normally also shows a persistent SSO button
    // (showSsoAlongsideForm); the page suppresses it while the sso_required
    // affordance is up so there is exactly one "login via keycloak" button,
    // not two.
    setAuth('hybrid');
    mockLogin.mockRejectedValueOnce(
      new ApiError(403, 'sso_required', 'sso_required', { loginUrl: '/oauth2/start' }),
    );
    renderLogin();

    fireEvent.change(emailField()!, { target: { value: 'employee@corp.example' } });
    fireEvent.change(passwordField()!, { target: { value: 'hunter2' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    // The affordance message + SSO button appear once the rejection settles.
    await waitFor(() => {
      expect(screen.getByText(/must sign in with keycloak/i)).toBeTruthy();
    });
    expect(ssoButton()).not.toBeNull();

    // Critical: no automatic navigation — the user must click.
    expect(assignMock).not.toHaveBeenCalled();

    // Clicking the affordance navigates to the server-supplied loginUrl.
    fireEvent.click(ssoButton()!);
    expect(assignMock).toHaveBeenCalledWith('/oauth2/start');
  });

  test('falls back to /oauth2/start when loginUrl is unsafe (protocol-relative)', async () => {
    setAuth('hybrid');
    mockLogin.mockRejectedValueOnce(
      new ApiError(403, 'sso_required', 'sso_required', { loginUrl: '//evil.example/x' }),
    );
    renderLogin();

    fireEvent.change(emailField()!, { target: { value: 'employee@corp.example' } });
    fireEvent.change(passwordField()!, { target: { value: 'hunter2' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(ssoButton()).not.toBeNull();
    });
    fireEvent.click(ssoButton()!);
    // The protocol-relative open-redirect is rejected; we use the safe default.
    expect(assignMock).toHaveBeenCalledWith('/oauth2/start');
  });
});

// ─────────────────────── email validation / error mapping ───────────────────────

describe('LoginPage email validation + error mapping (sk-163.17 follow-up)', () => {
  test('non-email input shows a validation message and never calls login', async () => {
    setAuth('hybrid');
    renderLogin();

    fireEvent.change(emailField()!, { target: { value: 'notanemail' } });
    fireEvent.change(passwordField()!, { target: { value: 'whatever' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByText(/enter a valid email/i)).toBeTruthy();
    });
    // Client-side gate: the pointless round-trip is skipped entirely.
    expect(mockLogin).not.toHaveBeenCalled();
  });

  test('server 400 maps to the email message, NOT "service unavailable"', async () => {
    setAuth('hybrid');
    // A syntactically-valid email that still trips server-side validation → 400.
    mockLogin.mockRejectedValueOnce(
      new ApiError(400, 'One or more validation errors occurred.', '', {}),
    );
    renderLogin();

    fireEvent.change(emailField()!, { target: { value: 'valid@example.com' } });
    fireEvent.change(passwordField()!, { target: { value: 'whatever' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByText(/enter a valid email/i)).toBeTruthy();
    });
    expect(screen.queryByText(/service unavailable/i)).toBeNull();
  });

  test('valid email + wrong password (422) shows invalid-credentials', async () => {
    setAuth('hybrid');
    mockLogin.mockRejectedValueOnce(
      new BusinessError(422, 'Email or password is incorrect.', 'invalid-credentials', {}),
    );
    renderLogin();

    fireEvent.change(emailField()!, { target: { value: 'ghost@customer.com' } });
    fireEvent.change(passwordField()!, { target: { value: 'wrongpass123' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByText(/invalid email or password/i)).toBeTruthy();
    });
  });
});

// ─────────────────────── sk-674.18 T059 — "Forgot password?" (row 253) ───────────────────────
//
// Screens 1.13 and 2.8, US-9: the link is there only with mail on and a
// password that signs in; with mail off it is gone, and the reset routes
// opened directly answer on the route itself with the honest text — no
// form, no redirect (K10).

describe('row 253 — "Forgot password?" follows the mail switch', () => {
  const forgotLink = () =>
    screen.queryByRole('link', { name: i18n.t('auth:links.forgotPassword') as string });

  function setConfig(authMode: AuthMode, emailEnabled: boolean) {
    mockAuthConfig = {
      data: { authMode, emailEnabled, signupEnabled: false },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
  }

  test.each(['local', 'hybrid'] as const)('%s, mail on: the link leads to /forgot-password', (mode) => {
    setConfig(mode, true);
    renderLogin();
    expect(forgotLink()?.getAttribute('href')).toBe('/forgot-password');
  });

  test.each(['local', 'hybrid'] as const)('%s, mail off: no link', (mode) => {
    setConfig(mode, false);
    renderLogin();
    expect(emailField()).not.toBeNull();
    expect(forgotLink()).toBeNull();
  });

  function renderRoute(path: string) {
    return render(
      <MantineProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password/:token" element={<ResetPasswordPage />} />
            <Route path="/login" element={<div data-testid="login-route" />} />
          </Routes>
        </MemoryRouter>
      </MantineProvider>,
    );
  }

  test.each(['/forgot-password', '/reset-password/tok-1'])(
    'mail off: %s opened directly shows the honest text and a way to sign in, no form',
    (path) => {
      setConfig('local', false);
      renderRoute(path);
      expect(screen.getByRole('status').textContent).toBe(i18n.t('auth:codes.emailDisabled'));
      expect(screen.getByRole('link', { name: i18n.t('auth:links.signIn') as string }).getAttribute('href')).toBe('/login');
      // No form: no field to type into, no submit of either page.
      expect(screen.queryByRole('textbox')).toBeNull();
      // The card is named like the field ("New password"): look for the input.
      expect(
        screen.queryByLabelText(new RegExp(`^${i18n.t('auth:reset.passwordLabel')}`), { selector: 'input' }),
      ).toBeNull();
      expect(screen.queryByRole('button', { name: i18n.t('auth:forgot.submit') as string })).toBeNull();
      expect(screen.queryByRole('button', { name: i18n.t('auth:reset.submit') as string })).toBeNull();
      expect(screen.queryByTestId('login-route')).toBeNull();
    },
  );

  test.each(['/forgot-password', '/reset-password/tok-1'])('mail on: %s shows its form', (path) => {
    setConfig('local', true);
    renderRoute(path);
    expect(screen.queryByText(i18n.t('auth:codes.emailDisabled') as string)).toBeNull();
    expect(
      screen.getByRole('button', {
        name: i18n.t(path === '/forgot-password' ? 'auth:forgot.submit' : 'auth:reset.submit') as string,
      }),
    ).toBeTruthy();
    // The positive control of the «no form» queries above.
    if (path === '/forgot-password') expect(screen.getByRole('textbox')).toBeTruthy();
    else
      expect(
        screen.queryByLabelText(new RegExp(`^${i18n.t('auth:reset.passwordLabel')}`), { selector: 'input' }),
      ).not.toBeNull();
  });
});
