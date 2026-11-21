/**
 * Rows 78 and 79 — the push settings as the app mounts them, across its outer
 * boundaries only (spec problem 2, INV-2, US-3).
 *
 * Expected: mounting the settings with the permission `granted` and a live
 * channel registers nothing (no `POST /push/subscriptions`); unsubscribing
 * this device revokes it — `POST /push/device-revocations` with its label and
 * endpoint, then its channel is removed; unsubscribing another device removes
 * it by id — `POST /push/device-removals`. The page used to re-POST the live
 * subscription on every mount and to delete subscriptions with
 * `DELETE /push/subscriptions`, which revokes nothing.
 *
 * Real: the auth provider, the push controller when the app has one
 * (`lib/push/PushProvider.tsx`, mounted by `main.tsx`), the device block and
 * everything under them. Substituted: only `fetch` (a model of the auth and
 * push endpoints) and the browser's push surface (service worker
 * registration, PushManager, Notification, Web Locks) — the boundaries every
 * revision of the page shares, so the same test runs on a revision before the
 * push controller and shows what that page did.
 */
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { type ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { AuthProvider } from '../../auth/AuthContext';
import i18n from '../../i18n/config';
import { PushDevicesSection } from '../../pages/settings/new/PushDevicesSection';

/** The push controller of the app, where the revision has one. */
const providers = import.meta.glob<{ PushProvider: (props: { children: ReactNode }) => ReactNode }>(
  '../push/PushProvider.tsx',
  { eager: true },
);
const PushProvider = Object.values(providers)[0]?.PushProvider ?? (({ children }: { children: ReactNode }) => <>{children}</>);

const A = '11111111-1111-4111-8111-111111111111';
const LABEL = 'aaaaaaaa-0000-4000-8000-000000000001';
const OTHER_LABEL = 'bbbbbbbb-0000-4000-8000-000000000002';
const ENDPOINT = 'https://push.example.test/send/this-browser';
const FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0';
const SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

interface Sub {
  id: string;
  endpointHash: string;
  ua: string;
  createdAt: string;
  lastSeenAt: string;
  deviceLabel: string | null;
  version: number;
}

interface Call {
  method: string;
  path: string;
  body: Record<string, unknown> | undefined;
}

async function sha256(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

// ───────────────────────── The server (fetch) ─────────────────────────

let subs: Sub[] = [];
const calls: Call[] = [];

function answer(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Skein-Push-Contract': '2' },
  });
}

/** Requests of the page still waiting for their answer. */
let inFlight = 0;

async function serve(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  inFlight += 1;
  try {
    return await answerOf(input, init);
  } finally {
    inFlight -= 1;
  }
}

async function answerOf(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://localhost');
  const method = (init?.method ?? 'GET').toUpperCase();
  const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
  calls.push({ method, path: url.pathname, body });
  switch (`${method} ${url.pathname}`) {
    case 'GET /api/auth/me':
      return answer(200, { id: A, email: 'a@example.test', username: 'a', name: 'A', role: 'user', createdAt: null, lastLoginAt: null });
    case 'GET /api/auth/config':
      return answer(200, { authMode: 'local', logoutRedirectUrl: null, mcpUrl: null });
    case 'GET /api/v1/push/config':
      return answer(200, { publicKey: 'BPkAAQID' });
    case 'GET /api/v1/push/subscriptions':
      return answer(200, subs);
    case 'POST /api/v1/push/device-revocations': {
      const labels = (body?.deviceLabels as string[] | undefined) ?? [];
      subs = subs.filter((s) => s.deviceLabel === null || !labels.includes(s.deviceLabel));
      return answer(204);
    }
    case 'POST /api/v1/push/device-removals':
      subs = subs.filter((s) => s.id !== body?.id);
      return answer(204);
    default:
      // The removal of a subscription by id of the page before contract v2,
      // modelled so that page reaches the end of its action too.
      if (method === 'DELETE' && url.pathname.startsWith('/api/v1/push/subscriptions/')) {
        const id = decodeURIComponent(url.pathname.slice('/api/v1/push/subscriptions/'.length));
        subs = subs.filter((s) => s.id !== id);
      }
      return answer(204);
  }
}

// ───────────────────────── The browser ─────────────────────────

let live: PushSubscription | null = null;

function subscription(): PushSubscription {
  const key = new Uint8Array([1, 2, 3, 4]).buffer;
  const sub = {
    endpoint: ENDPOINT,
    expirationTime: null,
    options: { userVisibleOnly: true, applicationServerKey: null },
    getKey: () => key,
    toJSON: () => ({ endpoint: ENDPOINT, keys: { p256dh: 'AQIDBA', auth: 'AQIDBA' } }),
    unsubscribe: vi.fn(async () => {
      live = null;
      return true;
    }),
  };
  return sub as unknown as PushSubscription;
}

/** Exclusive Web Locks, as the browser grants them. */
class Locks {
  private readonly tails = new Map<string, Promise<void>>();
  private readonly held = new Set<string>();
  async query(): Promise<{ held: Array<{ name: string; mode: string }>; pending: [] }> {
    return { held: [...this.held].map((name) => ({ name, mode: 'exclusive' })), pending: [] };
  }
  async request(name: string, options: LockOptions, callback: () => unknown): Promise<unknown> {
    const before = this.tails.get(name) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.tails.set(name, before.then(() => mine));
    try {
      await new Promise<void>((resolve, reject) => {
        const signal = options.signal;
        if (signal?.aborted) {
          reject(signal.reason);
          return;
        }
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
        void before.then(resolve);
      });
      this.held.add(name);
      return await callback();
    } finally {
      this.held.delete(name);
      release();
    }
  }
}

function installBrowser(): void {
  live = subscription();
  const registration = {
    pushManager: {
      getSubscription: async () => live,
      subscribe: async () => {
        live = subscription();
        return live;
      },
    },
  };
  const serviceWorker = {
    getRegistration: async () => registration,
    register: async () => registration,
    ready: Promise.resolve(registration),
  };
  Object.defineProperty(navigator, 'serviceWorker', { value: serviceWorker, configurable: true });
  Object.defineProperty(navigator, 'locks', { value: new Locks(), configurable: true });
  Object.defineProperty(window, 'PushManager', { value: function PushManager() {}, configurable: true });
  Object.defineProperty(window, 'Notification', {
    value: { permission: 'granted', requestPermission: async () => 'granted' },
    configurable: true,
  });
}

function uninstallBrowser(): void {
  for (const key of ['serviceWorker', 'locks']) delete (navigator as unknown as Record<string, unknown>)[key];
  for (const key of ['PushManager', 'Notification']) delete (window as unknown as Record<string, unknown>)[key];
}

// ───────────────────────── The page ─────────────────────────

function renderSettings(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <MantineProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <AuthProvider>
            <PushProvider>
              <PushDevicesSection />
            </PushProvider>
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

/**
 * The end of the mount: the device list is shown with this device, the page
 * has read the push configuration of the server (the last read of the
 * decision on the appearance, and the read before a registration), and no
 * request of the page waits for its answer.
 */
async function mounted(): Promise<void> {
  await waitFor(() => expect(screen.getByText(i18n.t('push:devices.thisDevice'))).toBeTruthy());
  await waitFor(() => expect(calls.some((c) => c.path === '/api/v1/push/config')).toBe(true));
  await waitFor(() => expect(inFlight).toBe(0));
}

function unsubscribeButtonOf(row: string): HTMLElement {
  return within(screen.getByText(row).closest('li')!).getByRole('button', { name: /Unsubscribe/ });
}

let thisHash = '';

beforeEach(async () => {
  thisHash = await sha256(ENDPOINT);
  calls.length = 0;
  inFlight = 0;
  subs = [
    { id: 'sub-this', endpointHash: thisHash, ua: FIREFOX, createdAt: '2026-06-01T10:00:00Z', lastSeenAt: '2026-06-01T10:00:00Z', deviceLabel: LABEL, version: 1 },
    { id: 'sub-other', endpointHash: 'other-hash', ua: SAFARI, createdAt: '2026-06-01T09:00:00Z', lastSeenAt: '2026-06-01T09:00:00Z', deviceLabel: OTHER_LABEL, version: 1 },
  ];
  // This browser enabled push for A with LABEL before (spec "Terms": the consent).
  localStorage.setItem(
    'skein.push.v1.state',
    JSON.stringify({
      consents: {
        [A]: { state: 'enabled', gen: 0, labels: [LABEL], label: LABEL, pending: null, endpoint: ENDPOINT, keysFingerprint: null, offUnconfirmed: false, rev: 1 },
      },
      works: [],
    }),
  );
  installBrowser();
  vi.stubGlobal('fetch', vi.fn(serve));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  uninstallBrowser();
  localStorage.clear();
});

const registrations = () => calls.filter((c) => c.method === 'POST' && c.path === '/api/v1/push/subscriptions');
const deletions = () => calls.filter((c) => c.method === 'DELETE');

describe('row 78 — the settings mounted with permission granted and a live channel', () => {
  test('register nothing', async () => {
    renderSettings();
    await mounted();

    expect(registrations()).toEqual([]);
    expect(live).not.toBeNull();
  });
});

describe('row 79 — unsubscribing devices in the settings (US-3)', () => {
  test('this device: its label and endpoint are revoked, then its channel is removed; nothing is deleted without a revocation', async () => {
    renderSettings();
    await mounted();
    const row = within(screen.getByText(i18n.t('push:devices.thisDevice')).closest('li')!);

    fireEvent.click(row.getByRole('button', { name: /Unsubscribe/ }));
    // The end of the action: the channel of this browser is gone.
    await waitFor(() => expect(live).toBeNull());

    const revocations = calls.filter((c) => c.method === 'POST' && c.path === '/api/v1/push/device-revocations');
    expect(revocations).toHaveLength(1);
    expect(revocations[0].body).toMatchObject({ expectedUserId: A, deviceLabels: [LABEL], endpoint: ENDPOINT });
    expect(deletions()).toEqual([]);
  });

  test('another device: it is removed by id', async () => {
    renderSettings();
    await mounted();

    fireEvent.click(unsubscribeButtonOf('Safari 17 · macOS'));
    // The end of the action: the device is no longer listed.
    await waitFor(() => expect(screen.queryByText('Safari 17 · macOS')).toBeNull());

    const removals = calls.filter((c) => c.method === 'POST' && c.path === '/api/v1/push/device-removals');
    expect(removals).toHaveLength(1);
    expect(removals[0].body).toMatchObject({ expectedUserId: A, id: 'sub-other' });
    expect(deletions()).toEqual([]);
    expect(live).not.toBeNull();
  });
});
