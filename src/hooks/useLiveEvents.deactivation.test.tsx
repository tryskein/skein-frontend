/**
 * Self-deactivation ends the session (spec sk-622.21 US-13 row "User
 * events"; plan K18 "Sign-out on own deactivation", T042).
 * Test-plan row No. 76.
 *
 * A visible tab that receives `user.deactivated` about the signed-in user
 * calls the real `useAuth().logout()`: `POST /api/auth/logout`, `null` in
 * `['auth','me']`, and `RequireAuth` replaces the shell with the login
 * screen — whether the ticket is still alive (logout answers 200) or
 * skein-web already dropped it (401, T034). The deactivation of another
 * user signs nobody out.
 *
 * The stand: the real `AuthProvider`, `LiveEventsProvider` and
 * `RequireAuth` on a `fetch` stub that models the BFF — `/api/auth/me`
 * keeps answering the user while the cookie lives (a deactivation does not
 * remove it), so a mechanism that re-read `/me` instead of logging out would
 * leave the shell on screen and fail here.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import * as signalr from '@microsoft/signalr';
import { AuthProvider } from '../auth/AuthContext';
import { RequireAuth } from '../auth/RequireAuth';
import { LiveEventsProvider } from './useLiveEvents';

vi.mock('../components/PushSoftAsk', () => ({ PushSoftAsk: () => null }));

vi.mock('@microsoft/signalr', () => {
  const HubConnectionState = {
    Disconnected: 'Disconnected',
    Connecting: 'Connecting',
    Connected: 'Connected',
    Reconnecting: 'Reconnecting',
  } as const;
  const LogLevel = { Trace: 0, Debug: 1, Information: 2, Warning: 3, Error: 4, Critical: 5, None: 6 } as const;
  const registry: { handlers: Map<string, (payload: unknown) => void> } = { handlers: new Map() };
  class FakeConn {
    state: string = HubConnectionState.Disconnected;
    on = vi.fn((method: string, cb: (payload: unknown) => void) => {
      registry.handlers.set(method, cb);
    });
    onclose = vi.fn();
    onreconnecting = vi.fn();
    onreconnected = vi.fn();
    invoke = vi.fn(() => Promise.resolve({ accepted: [], rejected: [] }));
    stop = vi.fn(() => { this.state = HubConnectionState.Disconnected; return Promise.resolve(); });
    start = vi.fn(function (this: FakeConn) {
      this.state = HubConnectionState.Connected;
      return Promise.resolve();
    });
  }
  class HubConnectionBuilder {
    withUrl() { return this; }
    withAutomaticReconnect() { return this; }
    configureLogging() { return this; }
    build() { return new FakeConn(); }
  }
  return { HubConnectionBuilder, HubConnectionState, LogLevel, __mock: registry };
});

const mock = (signalr as unknown as {
  __mock: { handlers: Map<string, (payload: unknown) => void> };
}).__mock;

const ME = '77777777-7777-7777-7777-777777777777';
const OTHER = '99999999-9999-9999-9999-999999999999';
const USER = { id: ME, username: 'ann', email: 'ann@example.org', name: 'Ann', role: 'user' };

/** The BFF as far as these tests need it. */
function stubBff(logoutStatus: 200 | 401) {
  const state = { cookieAlive: true, logoutCalls: 0, meCalls: 0 };
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';
    if (url.startsWith('/api/auth/me')) {
      state.meCalls += 1;
      return state.cookieAlive ? json(200, USER) : json(401, { error: 'unauthorized' });
    }
    if (url.startsWith('/api/auth/logout') && method === 'POST') {
      state.logoutCalls += 1;
      state.cookieAlive = false;
      return logoutStatus === 200 ? json(200, { redirectTo: null }) : json(401, { error: 'unauthorized' });
    }
    if (url.startsWith('/api/auth/config')) {
      return json(200, { authMode: 'local', logoutRedirectUrl: null, mcpUrl: null });
    }
    return json(200, {});
  }));
  return state;
}

async function mountShell(): Promise<QueryClient> {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  await act(async () => {
    render(
      <MantineProvider>
        <QueryClientProvider client={qc}>
          <AuthProvider>
            <LiveEventsProvider>
              <MemoryRouter initialEntries={['/']}>
                <Routes>
                  <Route path="/login" element={<div>login screen</div>} />
                  <Route element={<RequireAuth />}>
                    <Route path="/" element={<div>shell</div>} />
                  </Route>
                </Routes>
              </MemoryRouter>
            </LiveEventsProvider>
          </AuthProvider>
        </QueryClientProvider>
      </MantineProvider>,
    );
  });
  await screen.findByText('shell');
  await waitFor(() => expect(mock.handlers.has('event')).toBe(true));
  return qc;
}

function deliverUserEvent(action: string, userId: string, id: number): void {
  const handler = mock.handlers.get('event')!;
  act(() =>
    handler({
      id,
      occurredAt: '2026-10-09T10:00:00Z',
      eventType: `user.${action}`,
      entityType: 'user',
      entityId: userId,
      projectId: null,
    }),
  );
}

beforeEach(() => {
  mock.handlers.clear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('No. 76 — user.deactivated about me ends the session in a visible tab', () => {
  test.each([[200], [401]] as const)('logout answers %s: logout called, /me is null, the login screen replaces the shell', async (status) => {
    const bff = stubBff(status);
    const qc = await mountShell();

    deliverUserEvent('deactivated', ME, 1);

    await screen.findByText('login screen');
    expect(screen.queryByText('shell')).toBeNull();
    expect(bff.logoutCalls).toBe(1);
    expect(qc.getQueryData(['auth', 'me'])).toBeNull();
  });

  test('the deactivation of another user signs nobody out', async () => {
    const bff = stubBff(200);
    await mountShell();

    deliverUserEvent('deactivated', OTHER, 1);
    // Give a would-be logout every chance to run.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(bff.logoutCalls).toBe(0);
    expect(screen.getByText('shell')).toBeTruthy();
  });

  test('another event about me (not a deactivation) does not sign me out', async () => {
    const bff = stubBff(200);
    await mountShell();

    deliverUserEvent('updated', ME, 1);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(bff.logoutCalls).toBe(0);
    expect(screen.getByText('shell')).toBeTruthy();
  });
});
