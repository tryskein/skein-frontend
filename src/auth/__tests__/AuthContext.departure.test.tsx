/**
 * Rows 68, 68a, 68b, 69 — the ways a session ends, through the real
 * `logout(kind)` (spec "Ways a session ends", US-4, US-5, INV-3, INV-7,
 * SC-006; rule 8 "the revocation first").
 *
 * Real: `AuthProvider`, the departure (`lib/push/departure.ts`), the
 * controller, the locks over a substituted `navigator.locks`, the push state
 * over jsdom's localStorage, the appearance store. Substituted: `api/auth`
 * (`/me`, `POST /api/auth/logout`, the auth config), the push transport
 * (`api/push.ts`, a model of the server's push contract), the browser
 * adapter `browserPush.ts`, and `window.location.assign`.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { User } from '../../api/auth';
import { UnauthorizedError } from '../../api/client';
import {
  A,
  addSub,
  B,
  browser,
  channel,
  enabledConsent,
  FakeLocks,
  installPushHarness,
  LABEL_A,
  LABEL_B,
  model,
  seed,
  server,
  settle,
  uninstallPushHarness,
} from '../../test/pushHarness';
import { PUSH_STATE_KEY, readPushState } from '../../lib/push/pushState';

const auth = vi.hoisted(() => ({
  meApi: vi.fn(),
  logoutApi: vi.fn(),
  getAuthConfig: vi.fn(),
}));

vi.mock('../../api/auth', () => ({
  meApi: (...args: unknown[]) => auth.meApi(...args),
  logoutApi: (...args: unknown[]) => auth.logoutApi(...args),
  getAuthConfig: (...args: unknown[]) => auth.getAuthConfig(...args),
  loginApi: vi.fn(),
}));

vi.mock('../../components/Toaster', () => ({
  toaster: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
  useToaster: () => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }),
}));

const api = vi.hoisted(() => ({
  getPushConfig: vi.fn(),
  pushListDevices: vi.fn(),
  pushSubscribe: vi.fn(),
  pushRemoveChannel: vi.fn(),
  pushRevokeDevices: vi.fn(),
  pushRemoveDevice: vi.fn(),
}));

vi.mock('../../api/push', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/push')>()),
  ...api,
}));

const browserApi = vi.hoisted(() => ({
  browserPushSupported: vi.fn(),
  readChannel: vi.fn(),
  createChannel: vi.fn(),
  removeChannel: vi.fn(),
  notificationPermission: vi.fn(),
}));

vi.mock('../../lib/push/browserPush', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/push/browserPush')>()),
  ...browserApi,
}));

import { AuthProvider, ME_KEY, useAuth } from '../AuthContext';
import { createAppQueryClient } from '../../lib/appQueryClient';
import { currentAppearance, noteLogin, noteSignedOut } from '../appearance';

const SIGN_OUT_URL = 'https://sso.example.net/oauth2/sign_out';
const realSetTimeout = globalThis.setTimeout;

function user(id: string): User {
  return { id, email: `${id.slice(0, 4)}@example.test`, username: `u-${id.slice(0, 4)}`, name: 'User', role: 'user', createdAt: null, lastLoginAt: null };
}

/** Lets real asynchronous work (not timers) run. */
async function flush(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => realSetTimeout(resolve, 0));
}

let locks: FakeLocks;
let assign: ReturnType<typeof vi.fn>;
let originalLocation: Location;
let latest: ReturnType<typeof useAuth> | null = null;

function Probe() {
  latest = useAuth();
  return null;
}

const current = () => {
  if (latest === null) throw new Error('the provider has not rendered');
  return latest;
};

/** Renders the provider with `client` and waits for the appearance of A. */
async function mount(client: QueryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })): Promise<QueryClient> {
  render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(current().appearance?.userId).toBe(A));
  await waitFor(() => expect(client.getQueryData(['auth', 'config'])).toBeDefined());
  return client;
}

const pushCallsBesidesList = () =>
  api.pushSubscribe.mock.calls.length +
  api.pushRemoveChannel.mock.calls.length +
  api.pushRevokeDevices.mock.calls.length +
  api.pushRemoveDevice.mock.calls.length;

beforeEach(() => {
  locks = new FakeLocks();
  installPushHarness(api, browserApi, locks);
  server.caller = A;
  auth.meApi.mockReset().mockImplementation(async () => user(server.caller));
  auth.logoutApi.mockReset().mockImplementation(async () => ({ redirectTo: SIGN_OUT_URL }));
  auth.getAuthConfig.mockReset().mockResolvedValue({ authMode: 'keycloak', logoutRedirectUrl: SIGN_OUT_URL, mcpUrl: null });
  assign = vi.fn();
  originalLocation = window.location;
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: { ...originalLocation, origin: 'https://tasks.example.org', assign },
  });
});

afterEach(async () => {
  vi.useRealTimers();
  cleanup();
  latest = null;
  noteSignedOut();
  await settle(locks);
  Object.defineProperty(window, 'location', { configurable: true, writable: true, value: originalLocation });
  uninstallPushHarness();
});

/** A with push on this device: the consent, the channel and the subscription. */
function pushOnForA(): void {
  const a = channel('a');
  browser.channel = a;
  addSub(A, a.endpoint, LABEL_A);
  seed({ [A]: enabledConsent(LABEL_A, a, null) });
}

// ───────────────────────── Row 68 ─────────────────────────

describe('row 68 — the order of an explicit logout', () => {
  test('revocation → POST /api/auth/logout → channel removal → /me null → SSO redirect', async () => {
    pushOnForA();
    const client = await mount();
    const events: string[] = [];
    const meState = () => (client.getQueryData(ME_KEY) === null ? 'null' : 'user');
    api.pushRevokeDevices.mockImplementation(async (args) => {
      events.push('revoke');
      return model.revokeDevices(args);
    });
    auth.logoutApi.mockImplementation(async () => {
      events.push('logoutApi');
      return { redirectTo: SIGN_OUT_URL };
    });
    const removeChannel = browserApi.removeChannel.getMockImplementation()!;
    browserApi.removeChannel.mockImplementation(async (endpoint: string) => {
      events.push(`removeChannel:${meState()}`);
      return removeChannel(endpoint);
    });
    assign.mockImplementation(() => events.push(`assign:${meState()}`));

    await act(async () => {
      await current().logout('explicit');
    });

    expect(events).toEqual(['revoke', 'logoutApi', 'removeChannel:user', 'assign:null']);
    expect(assign).toHaveBeenCalledWith(SIGN_OUT_URL);
    expect(browser.channel).toBeNull();
  });
});

// ───────────────────────── Row 68b ─────────────────────────

describe('row 68b — one budget of 2 s on the whole logout (INV-7, SC-006)', () => {
  test('the revocation hangs 1.5 s, then the channel removal hangs: /me null and the redirect come at 2 s', async () => {
    pushOnForA();
    const client = await mount();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const events: string[] = [];
    api.pushRevokeDevices.mockImplementationOnce(
      (args) =>
        new Promise((resolve) => {
          setTimeout(() => {
            events.push('revoke');
            resolve(model.revokeDevices(args));
          }, 1500);
        }),
    );
    auth.logoutApi.mockImplementation(async () => {
      events.push('logoutApi');
      return { redirectTo: SIGN_OUT_URL };
    });
    browserApi.removeChannel.mockImplementation(() => {
      events.push('removeChannel');
      return new Promise(() => undefined);
    });
    assign.mockImplementation(() => events.push(`assign:${client.getQueryData(ME_KEY) === null ? 'null' : 'user'}`));

    void current().logout('explicit');
    await flush();
    await vi.advanceTimersByTimeAsync(1500);
    await flush();
    expect(events).toEqual(['revoke', 'logoutApi', 'removeChannel']);

    await vi.advanceTimersByTimeAsync(499);
    await flush();
    expect(assign).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await flush();
    expect(client.getQueryData(ME_KEY)).toBeNull();
    expect(events).toEqual(['revoke', 'logoutApi', 'removeChannel', 'assign:null']);
  });
});

// ───────────────────────── Row 68a ─────────────────────────

describe('row 68a — the server confirmed another user', () => {
  test('no logout: /me is the confirmed user, the session cache stays, no redirect; push state of B unchanged', async () => {
    seed({ [B]: enabledConsent(LABEL_B, channel('b'), null) });
    browser.channel = channel('b');
    const client = await mount();
    client.setQueryData(['issues', 'session'], 'data of the session');
    const stateBefore = localStorage.getItem(PUSH_STATE_KEY);
    // Another tab signed B in: the cookie is B's now.
    server.caller = B;

    await act(async () => {
      await current().logout('explicit');
    });

    expect(auth.logoutApi).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
    expect((client.getQueryData(ME_KEY) as User | null)?.id).toBe(B);
    // The logout removes the session's queries; here none was removed.
    expect(client.getQueryCache().find({ queryKey: ['issues', 'session'] })).toBeDefined();
    expect(localStorage.getItem(PUSH_STATE_KEY)).toBe(stateBefore);
    expect(browser.channel).toEqual(channel('b'));
    expect(pushCallsBesidesList()).toBe(0);
  });
});

describe('row 68a — another appearance while the logout prepares', () => {
  test('B signed in meanwhile: no POST /api/auth/logout, /me stays B, no redirect', async () => {
    pushOnForA();
    const client = await mount();
    api.pushListDevices.mockImplementationOnce(async (userId: string) => {
      const listed = await model.list(userId);
      // Another tab signed B in, and this page has confirmed B already.
      server.caller = B;
      noteLogin(B);
      client.setQueryData(ME_KEY, user(B));
      return listed;
    });

    let result: unknown;
    await act(async () => {
      result = await current().logout('explicit');
    });

    expect(result).toBe('superseded');
    expect(auth.logoutApi).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
    expect((client.getQueryData(ME_KEY) as User | null)?.id).toBe(B);
  });
});

// ───────────────────────── Row 69 ─────────────────────────

describe('row 69 — accountDeleted, consequence and the 401 handler (INV-3, US-5)', () => {
  test('accountDeleted deletes the consent of the user and removes the channel, without a server revocation', async () => {
    pushOnForA();
    seed({ [A]: enabledConsent(LABEL_A, channel('a'), null), [B]: enabledConsent(LABEL_B, channel('b'), null) });
    await mount();

    await act(async () => {
      await current().logout('accountDeleted');
    });

    expect(readPushState().consents[A]).toBeUndefined();
    expect(readPushState().consents[B]).toBeDefined();
    expect(browser.channel).toBeNull();
    expect(pushCallsBesidesList()).toBe(0);
    expect(api.pushListDevices).not.toHaveBeenCalled();
    expect(auth.logoutApi).toHaveBeenCalledTimes(1);
  });

  test('accountDeleted removes the channel this browser has, also one without a consent (US-9)', async () => {
    const a = channel('a');
    browser.channel = a;
    addSub(A, a.endpoint, null);
    await mount();

    await act(async () => {
      await current().logout('accountDeleted', current().appearance);
    });

    expect(browser.channel).toBeNull();
    expect(readPushState().works).toEqual([]);
    expect(pushCallsBesidesList()).toBe(0);
  });

  test('accountDeleted of an appearance another one replaced meanwhile touches neither B nor the session', async () => {
    seed({ [B]: enabledConsent(LABEL_B, channel('b'), null) });
    browser.channel = channel('b');
    const client = await mount();
    const owner = current().appearance;
    const stateBefore = localStorage.getItem(PUSH_STATE_KEY);
    // B appeared while the deletion request of A was on its way.
    server.caller = B;
    act(() => noteLogin(B));

    await act(async () => {
      await current().logout('accountDeleted', owner);
    });

    expect(auth.logoutApi).not.toHaveBeenCalled();
    expect(client.getQueryData(ME_KEY)).not.toBeNull();
    expect(localStorage.getItem(PUSH_STATE_KEY)).toBe(stateBefore);
    expect(browser.channel).toEqual(channel('b'));
  });

  test('consequence changes neither the consent nor the channel', async () => {
    pushOnForA();
    const client = await mount();
    const stateBefore = localStorage.getItem(PUSH_STATE_KEY);

    await act(async () => {
      await current().logout('consequence');
    });

    expect(client.getQueryData(ME_KEY)).toBeNull();
    expect(localStorage.getItem(PUSH_STATE_KEY)).toBe(stateBefore);
    expect(browser.channel).toEqual(channel('a'));
    expect(pushCallsBesidesList()).toBe(0);
    expect(api.pushListDevices).not.toHaveBeenCalled();
  });

  test('the 401 handler of the app changes neither the consent nor the channel', async () => {
    pushOnForA();
    const client = await mount(createAppQueryClient());
    const stateBefore = localStorage.getItem(PUSH_STATE_KEY);

    await act(async () => {
      await client
        .fetchQuery({
          queryKey: ['issues', 'any'],
          queryFn: async (): Promise<string> => {
            throw new UnauthorizedError();
          },
        })
        .catch(() => undefined);
    });

    expect(client.getQueryData(ME_KEY)).toBeNull();
    // The appearance of A ends with the 401: a push step of A has no effect after it.
    expect(currentAppearance()).toBeNull();
    expect(localStorage.getItem(PUSH_STATE_KEY)).toBe(stateBefore);
    expect(browser.channel).toEqual(channel('a'));
    expect(pushCallsBesidesList()).toBe(0);
    expect(api.pushListDevices).not.toHaveBeenCalled();
  });
});
