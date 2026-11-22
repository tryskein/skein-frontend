/**
 * The service worker `public/sw.js`, executed in a stand-in `self`
 * (rows 81 and 82 of the test matrix).
 *
 * Expected (spec US-10, R-9, "Component boundaries"): on
 * `pushsubscriptionchange` the worker makes no server request and creates no
 * channel; a `push` with a body shows a notification titled from the body;
 * `notificationclick` opens the notification's URL.
 *
 * The worker is served raw from `public/` and is not in the bundle, so it is
 * loaded as text and run here — what is checked is what it does with the
 * events, not how it is written.
 */
import { describe, expect, test, vi } from 'vitest';
import SW_SOURCE from '../../../public/sw.js?raw';

type Listener = (event: unknown) => void;

interface Worker {
  dispatch: (type: string, event: Record<string, unknown>) => Promise<void>;
  fetch: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  showNotification: ReturnType<typeof vi.fn>;
  openWindow: ReturnType<typeof vi.fn>;
}

const ORIGIN = 'https://skein.example.test';

const NEW_SUBSCRIPTION = {
  endpoint: 'https://push.example.test/send/new',
  toJSON: () => ({ endpoint: 'https://push.example.test/send/new', keys: { p256dh: 'BPk', auth: 'AQID' } }),
  getKey: () => new Uint8Array([1, 2, 3]).buffer,
  unsubscribe: async () => true,
};

function runWorker(): Worker {
  const listeners = new Map<string, Listener[]>();
  // A server and a browser that would let a worker re-register: the config
  // publishes a key, subscribe returns a channel, the subscriptions route
  // accepts it. A worker that writes on a subscription change gets all the
  // way to the POST with this fixture.
  const fetchMock = vi.fn(async (url: string) =>
    url.endsWith('/push/config')
      ? new Response(JSON.stringify({ publicKey: 'BPkAAQID' }), { headers: { 'Content-Type': 'application/json' } })
      : new Response(null, { status: 204 }));
  const subscribe = vi.fn(async () => NEW_SUBSCRIPTION);
  const showNotification = vi.fn(async () => undefined);
  const openWindow = vi.fn(async () => null);
  const clients = {
    claim: vi.fn(async () => undefined),
    matchAll: vi.fn(async () => []),
    openWindow,
  };
  const self = {
    addEventListener: (type: string, listener: Listener) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    skipWaiting: vi.fn(),
    clients,
    location: { origin: ORIGIN },
    registration: { showNotification, pushManager: { subscribe, getSubscription: vi.fn(async () => null) } },
    navigator: { userAgent: 'test' },
    atob: (s: string) => atob(s),
  };
  new Function('self', 'clients', 'fetch', SW_SOURCE)(self, clients, fetchMock);

  return {
    async dispatch(type, event) {
      const waits: Array<Promise<unknown>> = [];
      const full = { ...event, waitUntil: (p: Promise<unknown>) => { waits.push(p); } };
      for (const listener of listeners.get(type) ?? []) listener(full);
      await Promise.all(waits);
    },
    fetch: fetchMock,
    subscribe,
    showNotification,
    openWindow,
  };
}

describe('row 81 — the worker does not write to the server on a subscription change', () => {
  test('pushsubscriptionchange calls neither fetch nor pushManager.subscribe', async () => {
    const worker = runWorker();
    await worker.dispatch('pushsubscriptionchange', { oldSubscription: null, newSubscription: NEW_SUBSCRIPTION });
    // Let any work the worker started outside waitUntil settle.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(worker.fetch).not.toHaveBeenCalled();
    expect(worker.subscribe).not.toHaveBeenCalled();
  });
});

describe('row 82 — showing a notification and opening it', () => {
  test('a push with a body shows a notification titled from the body', async () => {
    const worker = runWorker();
    await worker.dispatch('push', {
      data: { json: () => ({ title: 'Issue sk-1 updated', body: 'b', url: '/issues/sk-1' }), text: () => '' },
    });
    expect(worker.showNotification).toHaveBeenCalledTimes(1);
    const [title, options] = worker.showNotification.mock.calls[0] as unknown as [string, { data: { url: string } }];
    expect(title).toBe('Issue sk-1 updated');
    expect(options.data.url).toBe('/issues/sk-1');
    expect(worker.fetch).not.toHaveBeenCalled();
  });

  test('notificationclick opens the URL of the notification', async () => {
    const worker = runWorker();
    const close = vi.fn();
    await worker.dispatch('notificationclick', {
      notification: { close, data: { url: '/issues/sk-1' } },
    });
    expect(close).toHaveBeenCalledTimes(1);
    expect(worker.openWindow).toHaveBeenCalledWith(`${ORIGIN}/issues/sk-1`);
  });
});
