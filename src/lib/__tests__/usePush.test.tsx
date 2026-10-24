/**
 * sk push — usePush hook state-machine tests.
 *
 * Exercises the three branches that matter:
 *   - feature-detect FALSE → supported:false, every action a no-op;
 *   - permission 'default' → subscribe() requests permission, and only
 *     subscribes + POSTs when granted (declined → no POST);
 *   - permission 'granted' on mount → login re-sync re-POSTs the live
 *     subscription.
 *
 * The whole Web Push browser surface (serviceWorker / PushManager /
 * Notification) is stubbed on the global, plus the REST client module.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render, cleanup, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { usePush, type UsePushResult } from '../usePush';

// ── REST client mock ─────────────────────────────────────────────
const getPushConfigSpy = vi.fn<() => Promise<{ publicKey: string }>>();
const registerSubscriptionSpy = vi.fn<(args: unknown) => Promise<void>>();
const deleteSubscriptionSpy = vi.fn<(endpoint: string) => Promise<void>>();

vi.mock('../../api/push', () => ({
  getPushConfig: () => getPushConfigSpy(),
  registerSubscription: (args: unknown) => registerSubscriptionSpy(args),
  deleteSubscription: (endpoint: string) => deleteSubscriptionSpy(endpoint),
}));

vi.mock('../../components/Toaster', () => ({
  useToaster: () => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }),
}));

// ── Web Push surface stubs ───────────────────────────────────────
// A valid base64url VAPID key (the actual bytes don't matter for the
// stubbed pushManager, only that urlBase64ToUint8Array doesn't throw).
const VAPID = 'TWFu';

interface FakeSub {
  endpoint: string;
  toJSON: () => { endpoint: string; keys: { p256dh: string; auth: string } };
  unsubscribe: () => Promise<boolean>;
}

function makeSub(endpoint = 'https://push.example/abc'): FakeSub {
  return {
    endpoint,
    toJSON: () => ({ endpoint, keys: { p256dh: 'p256dh-key', auth: 'auth-key' } }),
    unsubscribe: vi.fn().mockResolvedValue(true),
  };
}

let existingSub: FakeSub | null;
let subscribeImpl: () => Promise<FakeSub>;
let pushManager: {
  getSubscription: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
};

function installPushSurface(opts: { permission: NotificationPermission }) {
  pushManager = {
    getSubscription: vi.fn(async () => existingSub),
    subscribe: vi.fn(async () => {
      existingSub = await subscribeImpl();
      return existingSub;
    }),
  };
  const registration = { pushManager };

  vi.stubGlobal('navigator', {
    userAgent: 'vitest-ua',
    serviceWorker: {
      register: vi.fn(async () => registration),
      getRegistration: vi.fn(async () => registration),
      ready: Promise.resolve(registration),
    },
  });

  // window must carry PushManager; jsdom's window stays the global object.
  (window as unknown as { PushManager: unknown }).PushManager = function () {};

  const requestPermission = vi.fn(async () => 'granted' as NotificationPermission);
  const NotificationStub = function () {} as unknown as {
    permission: NotificationPermission;
    requestPermission: typeof requestPermission;
  };
  NotificationStub.permission = opts.permission;
  NotificationStub.requestPermission = requestPermission;
  vi.stubGlobal('Notification', NotificationStub);

  return { registration, requestPermission };
}

let captured: UsePushResult | null = null;
function Host() {
  captured = usePush();
  return null;
}
function renderHost() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <Host />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  getPushConfigSpy.mockReset().mockResolvedValue({ publicKey: VAPID });
  registerSubscriptionSpy.mockReset().mockResolvedValue(undefined);
  deleteSubscriptionSpy.mockReset().mockResolvedValue(undefined);
  existingSub = null;
  subscribeImpl = async () => makeSub();
  captured = null;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  delete (window as unknown as { PushManager?: unknown }).PushManager;
});

describe('usePush — feature detection', () => {
  test('unsupported browser → supported:false and actions no-op', async () => {
    // No serviceWorker / PushManager / Notification on the global.
    vi.stubGlobal('navigator', { userAgent: 'vitest-ua' });
    delete (window as unknown as { PushManager?: unknown }).PushManager;
    vi.stubGlobal('Notification', undefined);

    renderHost();
    await waitFor(() => expect(captured).not.toBeNull());

    expect(captured!.supported).toBe(false);
    expect(captured!.permission).toBe('default');

    let ok: boolean | undefined;
    await act(async () => {
      ok = await captured!.subscribe();
    });
    expect(ok).toBe(false);
    expect(getPushConfigSpy).not.toHaveBeenCalled();
    expect(registerSubscriptionSpy).not.toHaveBeenCalled();
  });
});

describe('usePush — permission default (soft-ask flow)', () => {
  test('subscribe() requests permission, then subscribes + POSTs on grant', async () => {
    const { requestPermission } = installPushSurface({ permission: 'default' });
    renderHost();
    await waitFor(() => expect(captured).not.toBeNull());
    // Default permission → no login re-sync POST on mount.
    await waitFor(() => expect(captured!.supported).toBe(true));
    expect(registerSubscriptionSpy).not.toHaveBeenCalled();

    let ok: boolean | undefined;
    await act(async () => {
      ok = await captured!.subscribe();
    });

    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(ok).toBe(true);
    expect(pushManager.subscribe).toHaveBeenCalledTimes(1);
    expect(registerSubscriptionSpy).toHaveBeenCalledTimes(1);
    const arg = registerSubscriptionSpy.mock.calls[0][0] as {
      endpoint: string;
      keys: { p256dh: string; auth: string };
      ua: string;
    };
    expect(arg.endpoint).toBe('https://push.example/abc');
    expect(arg.keys).toEqual({ p256dh: 'p256dh-key', auth: 'auth-key' });
    expect(arg.ua).toBe('vitest-ua');
    await waitFor(() => expect(captured!.subscribed).toBe(true));
  });

  test('subscribe() does NOT POST when the user denies the prompt', async () => {
    const { requestPermission } = installPushSurface({ permission: 'default' });
    requestPermission.mockResolvedValue('denied' as NotificationPermission);
    renderHost();
    await waitFor(() => expect(captured?.supported).toBe(true));

    let ok: boolean | undefined;
    await act(async () => {
      ok = await captured!.subscribe();
    });

    expect(ok).toBe(false);
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(registerSubscriptionSpy).not.toHaveBeenCalled();
    expect(captured!.permission).toBe('denied');
  });

  test('subscribe() is a no-op when push is disabled server-side (empty key)', async () => {
    installPushSurface({ permission: 'granted' });
    getPushConfigSpy.mockResolvedValue({ publicKey: '' });
    renderHost();
    await waitFor(() => expect(captured?.supported).toBe(true));

    let ok: boolean | undefined;
    await act(async () => {
      ok = await captured!.subscribe();
    });
    expect(ok).toBe(false);
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(registerSubscriptionSpy).not.toHaveBeenCalled();
  });
});

describe('usePush — permission granted (login re-sync)', () => {
  test('re-POSTs the live subscription on mount when already granted', async () => {
    existingSub = makeSub('https://push.example/existing');
    installPushSurface({ permission: 'granted' });
    renderHost();

    await waitFor(() => expect(registerSubscriptionSpy).toHaveBeenCalledTimes(1));
    const arg = registerSubscriptionSpy.mock.calls[0][0] as { endpoint: string };
    expect(arg.endpoint).toBe('https://push.example/existing');
    // Did NOT create a new subscription — reused the existing one.
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    await waitFor(() => expect(captured!.subscribed).toBe(true));
  });

  test('unsubscribe() tears down locally and DELETEs the server row', async () => {
    existingSub = makeSub('https://push.example/teardown');
    installPushSurface({ permission: 'granted' });
    renderHost();
    await waitFor(() => expect(captured?.subscribed).toBe(true));

    let ok: boolean | undefined;
    await act(async () => {
      ok = await captured!.unsubscribe();
    });
    expect(ok).toBe(true);
    expect(deleteSubscriptionSpy).toHaveBeenCalledWith('https://push.example/teardown');
  });
});
