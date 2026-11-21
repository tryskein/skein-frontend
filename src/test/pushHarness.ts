/**
 * Stand of the push controller tests: the two substituted boundaries — the
 * push transport (`api/push.ts`, answered by a small model of the server's
 * push contract) and the browser adapter (`lib/push/browserPush.ts`, one
 * channel) — plus Web Locks for `navigator.locks` and helpers that seed the
 * push state record.
 *
 * A test file mocks the two modules with its own hoisted `vi.fn`s and hands
 * them to {@link installPushHarness}; the locks, the state, the decision and
 * the appearance stay real.
 */
import type { Mock } from 'vitest';
import type { PushDevice, PushOutcome, RemoveChannelArgs, RevokeDevicesArgs, SubscribeArgs } from '../api/push';
import type { BrowserChannel, ChannelRead } from '../lib/push/browserPush';
import { type Consent, emptyConsent, PUSH_STATE_KEY, type PushWork } from '../lib/push/pushState';

export const A = '11111111-1111-4111-8111-111111111111';
export const B = '22222222-2222-4222-8222-222222222222';
export const LABEL_A = 'aaaaaaaa-0000-4000-8000-000000000001';
export const LABEL_B = 'bbbbbbbb-0000-4000-8000-000000000002';

/** Lowercase hex SHA-256, as the server computes `endpointHash`. */
export async function sha256(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** A browser channel named `name`. */
export function channel(name: string): BrowserChannel {
  return { endpoint: `https://push.example.test/send/${name}`, keys: { p256dh: `BP${name}`, auth: `AU${name}` } };
}

// ───────────────────────── Web Locks ─────────────────────────

/** Exclusive Web Locks with abortable waiting, as the browser grants them. */
export class FakeLocks {
  private readonly held = new Set<string>();
  private readonly queues = new Map<string, Array<() => void>>();
  /** Names of the lock requests, in the order they were made. */
  readonly requests: string[] = [];
  /** Called as a lock is released, before the next waiter gets it. */
  onRelease: ((name: string) => void) | null = null;

  async request(name: string, options: LockOptions, callback: (lock: Lock | null) => unknown): Promise<unknown> {
    this.requests.push(name);
    const signal = options.signal;
    if (signal?.aborted) throw signal.reason;
    await new Promise<void>((resolve, reject) => {
      if (!this.held.has(name)) {
        this.held.add(name);
        resolve();
        return;
      }
      const queue = this.queues.get(name) ?? [];
      this.queues.set(name, queue);
      const onAbort = () => {
        const i = queue.indexOf(grant);
        if (i >= 0) queue.splice(i, 1);
        reject(signal?.reason);
      };
      const grant = () => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      };
      queue.push(grant);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
    try {
      return await callback({ name, mode: 'exclusive' } as Lock);
    } finally {
      this.onRelease?.(name);
      const next = this.queues.get(name)?.shift();
      if (next) next();
      else this.held.delete(name);
    }
  }

  /** The held locks, as `navigator.locks.query()` answers. */
  async query(): Promise<LockManagerSnapshot> {
    return { held: [...this.held].map((name) => ({ name, mode: 'exclusive' as LockMode })), pending: [] };
  }

  idle(): boolean {
    return this.held.size === 0 && [...this.queues.values()].every((q) => q.length === 0);
  }
}

// ───────────────────────── The server ─────────────────────────

export interface Sub {
  id: string;
  version: number;
  owner: string;
  endpoint: string;
  deviceLabel: string | null;
}

/** The server's side of the push contract, reduced to what the page can observe. */
export const server = {
  /** The user of the session cookie. */
  caller: '',
  publicKey: 'BPkAAQID',
  subs: [] as Sub[],
  /** `<userId>/<label>` of every revoked label. */
  revoked: new Set<string>(),
  nextId: 1,
};

async function device(sub: Sub): Promise<PushDevice> {
  return {
    id: sub.id,
    endpointHash: await sha256(sub.endpoint),
    ua: 'test',
    createdAt: '2026-01-01T00:00:00Z',
    lastSeenAt: '2026-01-01T00:00:00Z',
    deviceLabel: sub.deviceLabel,
    version: sub.version,
  };
}

/** Adds a subscription on the server. */
export function addSub(owner: string, endpoint: string, deviceLabel: string | null): Sub {
  const sub = { id: `sub-${server.nextId++}`, version: 1, owner, endpoint, deviceLabel };
  server.subs.push(sub);
  return sub;
}

/** Answers of the server model, one per operation of the push client. */
export const model = {
  async list(expectedUserId: string): Promise<PushOutcome<PushDevice[]>> {
    if (expectedUserId !== server.caller) return { kind: 'userChanged' };
    return { kind: 'ok', value: await Promise.all(server.subs.filter((s) => s.owner === server.caller).map(device)) };
  },
  async subscribe(args: SubscribeArgs): Promise<PushOutcome<PushDevice>> {
    if (args.expectedUserId !== server.caller) return { kind: 'userChanged' };
    if (server.revoked.has(`${server.caller}/${args.deviceLabel}`)) return { kind: 'revoked' };
    const existing = server.subs.find((s) => s.endpoint === args.endpoint);
    if (existing !== undefined && existing.owner !== server.caller) return { kind: 'taken' };
    if (existing === undefined) {
      if (args.mode === 'updateOnly') return { kind: 'notFound' };
      return { kind: 'ok', value: await device(addSub(server.caller, args.endpoint, args.deviceLabel)) };
    }
    existing.deviceLabel = args.deviceLabel;
    existing.version += 1;
    return { kind: 'ok', value: await device(existing) };
  },
  async removeChannel(args: RemoveChannelArgs): Promise<PushOutcome> {
    if (args.expectedUserId !== server.caller) return { kind: 'userChanged' };
    const cond = args.ifSubscription;
    server.subs = server.subs.filter(
      (s) => !(s.endpoint === args.endpoint && (cond === undefined || (s.id === cond.id && s.version === cond.version))),
    );
    return { kind: 'ok', value: undefined };
  },
  async revokeDevices(args: RevokeDevicesArgs): Promise<PushOutcome> {
    if (args.expectedUserId !== server.caller) return { kind: 'userChanged' };
    for (const label of args.deviceLabels) server.revoked.add(`${server.caller}/${label}`);
    server.subs = server.subs.filter(
      (s) =>
        !(
          s.owner === server.caller &&
          ((s.deviceLabel !== null && args.deviceLabels.includes(s.deviceLabel)) ||
            (s.deviceLabel === null && s.endpoint === args.endpoint))
        ),
    );
    return { kind: 'ok', value: undefined };
  },
  async removeDevice(args: { expectedUserId: string; id: string }): Promise<PushOutcome> {
    if (args.expectedUserId !== server.caller) return { kind: 'userChanged' };
    const sub = server.subs.find((s) => s.id === args.id && s.owner === server.caller);
    if (sub === undefined) return { kind: 'notFound' };
    const label = sub.deviceLabel;
    if (label !== null) server.revoked.add(`${server.caller}/${label}`);
    server.subs = server.subs.filter(
      (s) => s !== sub && !(label !== null && s.owner === server.caller && s.deviceLabel === label),
    );
    return { kind: 'ok', value: undefined };
  },
};

// ───────────────────────── The browser ─────────────────────────

/** The browser of the stand: one channel. */
export const browser = {
  channel: null as BrowserChannel | null,
  permission: 'granted' as NotificationPermission,
  readFails: false,
  removeFails: false,
  created: 0,
};

// ───────────────────────── Installation ─────────────────────────

/** The hoisted mocks of `api/push.ts` a test file substitutes. */
export interface PushApiMocks {
  getPushConfig: Mock;
  pushListDevices: Mock;
  pushSubscribe: Mock;
  pushRemoveChannel: Mock;
  pushRevokeDevices: Mock;
  pushRemoveDevice: Mock;
}

/** The hoisted mocks of `browserPush.ts` a test file substitutes. */
export interface BrowserApiMocks {
  browserPushSupported: Mock;
  readChannel: Mock;
  createChannel: Mock;
  removeChannel: Mock;
  notificationPermission: Mock;
  requestNotificationPermission?: Mock;
}

/**
 * Resets the server, the browser and the push state, installs `locks` as
 * `navigator.locks`, and points the mocks at the models.
 */
export function installPushHarness(api: PushApiMocks, browserApi: BrowserApiMocks, locks: FakeLocks): void {
  localStorage.clear();
  Object.defineProperty(navigator, 'locks', { value: locks, configurable: true });

  server.caller = '';
  server.subs = [];
  server.revoked = new Set();
  server.nextId = 1;
  server.publicKey = 'BPkAAQID';
  browser.channel = null;
  browser.permission = 'granted';
  browser.readFails = false;
  browser.removeFails = false;
  browser.created = 0;

  api.getPushConfig.mockReset().mockImplementation(async () => ({ publicKey: server.publicKey }));
  api.pushListDevices.mockReset().mockImplementation(model.list);
  api.pushSubscribe.mockReset().mockImplementation(model.subscribe);
  api.pushRemoveChannel.mockReset().mockImplementation(model.removeChannel);
  api.pushRevokeDevices.mockReset().mockImplementation(model.revokeDevices);
  api.pushRemoveDevice.mockReset().mockImplementation(model.removeDevice);

  browserApi.browserPushSupported.mockReset().mockReturnValue(true);
  browserApi.notificationPermission.mockReset().mockImplementation(() => browser.permission);
  browserApi.requestNotificationPermission?.mockReset().mockImplementation(async () => browser.permission);
  browserApi.readChannel.mockReset().mockImplementation(async (): Promise<ChannelRead> => {
    if (browser.readFails) return { kind: 'unreadable' };
    return browser.channel === null ? { kind: 'none' } : { kind: 'channel', channel: browser.channel };
  });
  // The browser effects run the caller's precondition after the adapter's
  // own wait, as `browserPush.ts` does, so a caller that stops passing its
  // liveness check is seen by the controller tests too.
  browserApi.createChannel.mockReset().mockImplementation(async (_key: string, _signal?: AbortSignal, precondition?: () => void) => {
    await Promise.resolve();
    precondition?.();
    browser.created += 1;
    browser.channel = channel(`new-${browser.created}`);
    return browser.channel;
  });
  browserApi.removeChannel.mockReset().mockImplementation(async (endpoint: string, precondition?: () => void) => {
    await Promise.resolve();
    if (browser.removeFails) throw new DOMException('broken', 'InvalidStateError');
    if (browser.channel?.endpoint !== endpoint) return 'notCurrent';
    precondition?.();
    browser.channel = null;
    return 'removed';
  });
}

/** Removes `navigator.locks`. */
export function uninstallPushHarness(): void {
  delete (navigator as unknown as Record<string, unknown>).locks;
}

/** Waits until no push operation holds or waits for a lock. */
export async function settle(locks: FakeLocks): Promise<void> {
  let quiet = 0;
  for (let i = 0; i < 1000 && quiet < 5; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    quiet = locks.idle() ? quiet + 1 : 0;
  }
}

// ───────────────────────── The push state ─────────────────────────

/** Writes the push state record: these consents (over "no mark") and works. */
export function seed(consents: Record<string, Partial<Consent>>, works: PushWork[] = []): void {
  const full: Record<string, Consent> = {};
  for (const [userId, consent] of Object.entries(consents)) full[userId] = { ...emptyConsent(), ...consent };
  localStorage.setItem(PUSH_STATE_KEY, JSON.stringify({ consents: full, works }));
}

/** An "enabled" consent with one label at `ch`. */
export function enabledConsent(
  label: string,
  ch: BrowserChannel,
  fingerprint: string | null,
  pending: Consent['pending'] = null,
): Partial<Consent> {
  return { state: 'enabled', labels: [label], label, pending, endpoint: ch.endpoint, keysFingerprint: fingerprint };
}
