/**
 * Row 47b — the browser boundary of push (Edge 13, decision table rows 0
 * and 8).
 *
 * Expected: push is supported only with a service worker, the Push API,
 * notifications and Web Locks together — missing any one of them makes it
 * unsupported; reading the channel gives `none` when the browser has no
 * subscription, `unreadable` when the browser fails, and the endpoint with
 * the base64url keys from `getKey` otherwise. `unreadable` is never `none`.
 *
 * The browser APIs are stand-ins: this checks our mapping, not the browser.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import { browserPushSupported, createChannel, readChannel, removeChannel } from './browserPush';

type Capability = 'serviceWorker' | 'PushManager' | 'Notification' | 'locks';
const CAPABILITIES: Capability[] = ['serviceWorker', 'PushManager', 'Notification', 'locks'];

function bytes(...values: number[]): ArrayBuffer {
  return new Uint8Array(values).buffer;
}

function install(
  capabilities: Capability[],
  getRegistration: () => Promise<unknown> = async () => undefined,
): void {
  if (capabilities.includes('serviceWorker')) {
    Object.defineProperty(navigator, 'serviceWorker', { value: { getRegistration: vi.fn(getRegistration) }, configurable: true });
  }
  if (capabilities.includes('locks')) {
    Object.defineProperty(navigator, 'locks', { value: { request: vi.fn() }, configurable: true });
  }
  if (capabilities.includes('PushManager')) {
    Object.defineProperty(window, 'PushManager', { value: function PushManager() {}, configurable: true });
  }
  if (capabilities.includes('Notification')) {
    Object.defineProperty(window, 'Notification', { value: { permission: 'default' }, configurable: true });
  }
}

afterEach(() => {
  delete (navigator as unknown as Record<string, unknown>).serviceWorker;
  delete (navigator as unknown as Record<string, unknown>).locks;
  delete (window as unknown as Record<string, unknown>).PushManager;
  delete (window as unknown as Record<string, unknown>).Notification;
});

function registrationWith(getSubscription: () => Promise<unknown>): () => Promise<unknown> {
  return async () => ({ pushManager: { getSubscription: vi.fn(getSubscription) } });
}

describe('row 47b — support', () => {
  test('supported with all four capabilities', () => {
    install(CAPABILITIES);
    expect(browserPushSupported()).toBe(true);
  });

  test.each(CAPABILITIES)('not supported without %s', (missing) => {
    install(CAPABILITIES.filter((c) => c !== missing));
    expect(browserPushSupported()).toBe(false);
  });
});

describe('row 47b — reading the channel', () => {
  test('a browser that does not answer: the read is unreadable once the caller\'s signal aborts', async () => {
    install(CAPABILITIES, registrationWith(() => new Promise(() => undefined)));
    const controller = new AbortController();
    const read = readChannel(controller.signal);
    controller.abort(new DOMException('the step ended', 'AbortError'));
    expect(await read).toEqual({ kind: 'unreadable' });
  });

  test('a null subscription is none', async () => {
    install(CAPABILITIES, registrationWith(async () => null));
    expect(await readChannel()).toEqual({ kind: 'none' });
  });

  test('a rejected getSubscription is unreadable, not none', async () => {
    install(CAPABILITIES, registrationWith(async () => {
      throw new DOMException('broken', 'InvalidStateError');
    }));
    const read = await readChannel();
    expect(read).toEqual({ kind: 'unreadable' });
    expect(read).not.toEqual({ kind: 'none' });
  });

  test('a rejected getRegistration is unreadable', async () => {
    install(CAPABILITIES, async () => {
      throw new DOMException('broken', 'InvalidStateError');
    });
    expect(await readChannel()).toEqual({ kind: 'unreadable' });
  });

  test('a subscription is its endpoint with the base64url keys from getKey', async () => {
    const keys: Record<string, ArrayBuffer> = {
      p256dh: bytes(0xfb, 0xff, 0xbf),
      auth: bytes(0x01, 0x02, 0x03),
    };
    install(CAPABILITIES, registrationWith(async () => ({
      endpoint: 'https://push.example.test/send/one',
      getKey: (name: string) => keys[name] ?? null,
    })));
    expect(await readChannel()).toEqual({
      kind: 'channel',
      channel: { endpoint: 'https://push.example.test/send/one', keys: { p256dh: '-_-_', auth: 'AQID' } },
    });
  });
});

describe('row 47b — creating the channel', () => {
  test('with no active worker the wait for serviceWorker.ready ends when the signal aborts', async () => {
    const subscribe = vi.fn();
    const registration = { pushManager: { subscribe } };
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        getRegistration: vi.fn(async () => registration),
        register: vi.fn(),
        ready: new Promise<never>(() => {}),
      },
      configurable: true,
    });
    const controller = new AbortController();
    const pending = createChannel('AQID', controller.signal);
    controller.abort(new DOMException('deadline', 'AbortError'));
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(subscribe).not.toHaveBeenCalled();
  });
});

describe('row 47b — no browser effect once the caller ended, after the adapter\'s own waits', () => {
  test('createChannel: the caller ends while the worker becomes active — no subscription', async () => {
    const subscribe = vi.fn();
    let activate: (r: unknown) => void = () => undefined;
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        getRegistration: vi.fn(async () => ({ pushManager: { subscribe } })),
        register: vi.fn(),
        ready: new Promise((resolve) => (activate = resolve)),
      },
      configurable: true,
    });
    let callerLive = true;
    const pending = createChannel('AQID', undefined, () => {
      if (!callerLive) throw new Error('ended');
    });
    callerLive = false;
    activate({ pushManager: { subscribe } });
    await expect(pending).rejects.toThrow('ended');
    expect(subscribe).not.toHaveBeenCalled();
  });

  test('createChannel: the caller ends while the registration is read — no service worker is registered', async () => {
    const register = vi.fn();
    let found: (r: unknown) => void = () => undefined;
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        getRegistration: vi.fn(() => new Promise((resolve) => (found = resolve))),
        register,
        ready: new Promise(() => undefined),
      },
      configurable: true,
    });
    let callerLive = true;
    const pending = createChannel('AQID', undefined, () => {
      if (!callerLive) throw new Error('ended');
    });
    callerLive = false;
    found(undefined);
    await expect(pending).rejects.toThrow('ended');
    expect(register).not.toHaveBeenCalled();
  });

  test('removeChannel: the caller ends while the subscription is read — no unsubscription', async () => {
    const unsubscribe = vi.fn(async () => true);
    let read: (s: unknown) => void = () => undefined;
    install(CAPABILITIES, registrationWith(() => new Promise((resolve) => (read = resolve))));
    let callerLive = true;
    const pending = removeChannel('https://push.example.test/send/one', () => {
      if (!callerLive) throw new Error('ended');
    });
    callerLive = false;
    // The read reaches getSubscription after the registration is found.
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    read({ endpoint: 'https://push.example.test/send/one', unsubscribe });
    await expect(pending).rejects.toThrow('ended');
    expect(unsubscribe).not.toHaveBeenCalled();
  });
});
