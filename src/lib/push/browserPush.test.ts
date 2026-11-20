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
import { browserPushSupported, readChannel } from './browserPush';

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
