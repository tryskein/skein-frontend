/**
 * sk-285.1.16 — the live-connection banner belongs to a signed-in
 * session and to nothing else.
 *
 * Before this task the banner was mounted at the app root and read the
 * SignalR state alone. LiveEventsProvider parks that state on
 * 'disconnected' while there is no user, so a first-time visitor met a
 * corner chip reading [disconnected] on /login before typing anything.
 *
 * The gate asserted here is the AUTH STATE, not the route: the banner
 * must stay absent on ANY unauthenticated surface, and must behave
 * exactly as before once a user is present.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { AuthProvider } from '../auth/AuthContext';
import { ConnectionStatus } from './ConnectionStatus';
import type { User } from '../api/auth';

// The real auth wiring is exercised (AuthProvider + its `me` query); only
// the network call underneath is faked, so "unauthenticated" here means
// what it means in production: `GET /api/auth/me` yields no user.
const meApi = vi.fn<() => Promise<User | null>>();
vi.mock('../api/auth', () => ({
  meApi: () => meApi(),
  loginApi: vi.fn(),
  logoutApi: vi.fn(),
  // AuthProvider reads the runtime auth config (sk-303.42 logout allow-list).
  getAuthConfig: vi.fn(() =>
    Promise.resolve({ authMode: 'local', logoutRedirectUrl: null, mcpUrl: null }),
  ),
}));

// Connection state is the other input. Held at 'disconnected' — the exact
// state that used to leak the banner onto the login screen.
const liveState = vi.fn(() => 'disconnected');
vi.mock('../hooks/useLiveEvents', () => ({
  useLiveEventsState: () => liveState(),
}));

const USER: User = {
  id: 'u-1',
  email: 'a@example.com',
  username: 'agent',
  name: 'Agent',
  role: 'user',
  createdAt: null,
  lastLoginAt: null,
};

function Wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={client}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  meApi.mockReset();
  liveState.mockReturnValue('disconnected');
});

afterEach(() => {
  cleanup();
});

describe('ConnectionStatus — hidden until signed in', () => {
  test('no banner while unauthenticated, even though the state is disconnected', async () => {
    meApi.mockResolvedValue(null);

    render(
      <Wrapper>
        <ConnectionStatus />
      </Wrapper>,
    );

    await waitFor(() => expect(meApi).toHaveBeenCalled());
    // Give the settled query a chance to flush before asserting absence.
    await waitFor(() => {
      expect(screen.queryByRole('status')).toBeNull();
    });
    expect(screen.queryByText('[disconnected]')).toBeNull();
  });

  test('no banner while the session is still being resolved', () => {
    // `me` never settles → isLoading, user still null. Nothing shows.
    meApi.mockReturnValue(new Promise<User | null>(() => {}));

    render(
      <Wrapper>
        <ConnectionStatus />
      </Wrapper>,
    );

    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByText('[disconnected]')).toBeNull();
  });

  test('banner comes back once a user is signed in', async () => {
    meApi.mockResolvedValue(USER);

    render(
      <Wrapper>
        <ConnectionStatus />
      </Wrapper>,
    );

    expect(await screen.findByText('[disconnected]')).toBeTruthy();
  });

  test('signed in and connected stays silent, as before', async () => {
    meApi.mockResolvedValue(USER);
    liveState.mockReturnValue('connected');

    render(
      <Wrapper>
        <ConnectionStatus />
      </Wrapper>,
    );

    await waitFor(() => expect(meApi).toHaveBeenCalled());
    expect(screen.queryByRole('status')).toBeNull();
  });
});
