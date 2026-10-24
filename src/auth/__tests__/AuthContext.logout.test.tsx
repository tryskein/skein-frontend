import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const logoutApi = vi.fn();
const meApi = vi.fn();
const getAuthConfig = vi.fn();
const toasterError = vi.fn();

vi.mock('../../api/auth', () => ({
  logoutApi: (...args: unknown[]) => logoutApi(...args),
  meApi: (...args: unknown[]) => meApi(...args),
  getAuthConfig: (...args: unknown[]) => getAuthConfig(...args),
  loginApi: vi.fn(),
}));

vi.mock('../../components/Toaster', () => ({
  toaster: {
    error: (...args: unknown[]) => toasterError(...args),
    success: vi.fn(),
    info: vi.fn(),
  },
  useToaster: () => ({ error: toasterError, success: vi.fn(), info: vi.fn() }),
}));

import { AuthProvider, useAuth } from '../AuthContext';

/**
 * sk-303.42 — end-to-end wiring of the logout redirect gate: the allow-list
 * the provider applies has to be the one the BFF declared on
 * `GET /api/auth/config`, not a constant.
 *
 * The old code accepted exactly one organisation's proxy host, so any other
 * deployment's sign-out URL was dropped into `console.warn` — invisible, with
 * the external session left alive behind a logout the UI called successful.
 * These tests pin both halves of the replacement: the declared URL IS
 * followed, a foreign one is NOT, and a refusal is now surfaced to the user.
 */
describe('AuthProvider logout redirect', () => {
  let assign: ReturnType<typeof vi.fn>;
  let originalLocation: Location;

  beforeEach(() => {
    vi.clearAllMocks();
    meApi.mockResolvedValue(null);
    assign = vi.fn();
    originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { ...originalLocation, origin: 'https://tasks.example.org', assign },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: originalLocation,
    });
  });

  function Harness({ onReady }: { onReady: (logout: () => Promise<void>) => void }) {
    const { logout } = useAuth();
    onReady(logout);
    return <div>ready</div>;
  }

  async function mountAndLogout(): Promise<void> {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    let logout: (() => Promise<void>) | null = null;
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    render(
      <AuthProvider>
        <Harness onReady={(fn) => { logout = fn; }} />
      </AuthProvider>,
      { wrapper },
    );
    await screen.findByText('ready');
    // The allow-list comes from the config query — wait for it to land before
    // logging out, otherwise the test would prove nothing about its content.
    await waitFor(() => expect(getAuthConfig).toHaveBeenCalled());
    await waitFor(() =>
      expect(client.getQueryData(['auth', 'config'])).toBeDefined(),
    );
    await act(async () => {
      await logout!();
    });
  }

  /**
   * Mount and log out WITHOUT waiting for the config query — the case the
   * helper above deliberately excludes. A person clicking "sign out" the
   * moment the page is usable does exactly this.
   */
  async function mountAndLogoutImmediately() {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    let logout: (() => Promise<void>) | undefined;
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    render(
      <AuthProvider>
        <Harness onReady={(fn) => { logout = fn; }} />
      </AuthProvider>,
      { wrapper },
    );
    await screen.findByText('ready');
    await act(async () => {
      await logout!();
    });
  }

  it('follows the declared URL even when logout beats the config query', async () => {
    // Regression: the allow-list used to be read from RENDERED state, so a
    // logout that ran before the config arrived compared against `null`,
    // refused a legitimate redirect and stranded the upstream session — with
    // the local cookie already cleared. The redirect target is now resolved
    // imperatively at logout time.
    let resolveConfig: ((v: unknown) => void) | undefined;
    getAuthConfig.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveConfig = resolve;
          setTimeout(
            () =>
              resolve({
                authMode: 'keycloak',
                logoutRedirectUrl: 'https://sso.example.net/oauth2/sign_out',
                mcpUrl: null,
              }),
            0,
          );
        }),
    );
    logoutApi.mockResolvedValue({ redirectTo: 'https://sso.example.net/oauth2/sign_out' });

    await mountAndLogoutImmediately();
    void resolveConfig;

    expect(assign).toHaveBeenCalledWith('https://sso.example.net/oauth2/sign_out');
    expect(toasterError).not.toHaveBeenCalled();
  });

  it('does not pretend the logout was complete when the config cannot be read', async () => {
    // The honest failure: we cannot tell whether the redirect is legitimate,
    // so we refuse it AND say why. Silently swallowing it would leave the
    // person believing the identity-provider session had ended.
    getAuthConfig.mockRejectedValue(new Error('config unreachable'));
    logoutApi.mockResolvedValue({ redirectTo: 'https://sso.example.net/oauth2/sign_out' });

    await mountAndLogoutImmediately();

    expect(assign).not.toHaveBeenCalled();
    expect(toasterError).toHaveBeenCalledTimes(1);
    expect(String(toasterError.mock.calls[0][0])).toContain('could not reach its own configuration');
  });

  it("follows the deployment's declared logout URL", async () => {
    getAuthConfig.mockResolvedValue({
      authMode: 'keycloak',
      logoutRedirectUrl: 'https://sso.example.net/oauth2/sign_out',
      mcpUrl: null,
    });
    logoutApi.mockResolvedValue({ redirectTo: 'https://sso.example.net/oauth2/sign_out' });

    await mountAndLogout();

    expect(assign).toHaveBeenCalledWith('https://sso.example.net/oauth2/sign_out');
    expect(toasterError).not.toHaveBeenCalled();
  });

  it('refuses a redirect to a host the deployment did not declare, and says so', async () => {
    getAuthConfig.mockResolvedValue({
      authMode: 'keycloak',
      logoutRedirectUrl: 'https://sso.example.net/oauth2/sign_out',
      mcpUrl: null,
    });
    logoutApi.mockResolvedValue({ redirectTo: 'https://evil.example.com/oauth2/sign_out' });

    await mountAndLogout();

    expect(assign).not.toHaveBeenCalled();
    // The refusal must be visible: a silent drop is what made the old bug
    // survive — the user believed they were fully signed out.
    expect(toasterError).toHaveBeenCalledTimes(1);
  });

  it('refuses any absolute redirect when the deployment declared none', async () => {
    getAuthConfig.mockResolvedValue({
      authMode: 'keycloak',
      logoutRedirectUrl: null,
      mcpUrl: null,
    });
    logoutApi.mockResolvedValue({ redirectTo: 'https://sso.example.net/oauth2/sign_out' });

    await mountAndLogout();

    expect(assign).not.toHaveBeenCalled();
    expect(toasterError).toHaveBeenCalledTimes(1);
  });

  it('still follows same-origin /oauth2/* without any declared URL', async () => {
    getAuthConfig.mockResolvedValue({ authMode: 'keycloak', logoutRedirectUrl: null });
    logoutApi.mockResolvedValue({ redirectTo: '/oauth2/sign_out' });

    await mountAndLogout();

    expect(assign).toHaveBeenCalledWith('/oauth2/sign_out');
    expect(toasterError).not.toHaveBeenCalled();
  });

  it('navigates nowhere when the BFF returns no redirect', async () => {
    getAuthConfig.mockResolvedValue({ authMode: 'local', logoutRedirectUrl: null });
    logoutApi.mockResolvedValue({ redirectTo: null });

    await mountAndLogout();

    expect(assign).not.toHaveBeenCalled();
    expect(toasterError).not.toHaveBeenCalled();
  });
});
