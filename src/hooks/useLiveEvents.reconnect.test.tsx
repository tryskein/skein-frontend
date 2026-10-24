/**
 * Reconnect and `resync` (spec sk-622.21 US-14, US-10, SC-005, edge 12,
 * edge 13; plan T044, K18 row "Reconnect / resync"). Test-plan row
 * No. 81.
 *
 * Everything goes through the provider on a fake hub: its `onreconnected`
 * callback and its `resync` / `event` handlers are called by the test, its
 * `invoke` records the declaration. The tab's readers are query observers
 * whose reads are counted; Inbox is one of them. Fake timers; the jitter
 * comes from `Math.random`, replaced per run.
 *
 * The moment of the re-read is OBSERVED («no read before it, the re-read
 * after it»), not computed by a formula in the test: the plan fixes the
 * range, not the formula.
 *
 * The card accepted in this tab staying a snapshot through the resync
 * re-read (R12) is the gate of T046 (No. 83); here Inbox is shown re-read.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query';
import * as signalr from '@microsoft/signalr';
import { LiveEventsProvider, RESYNC_JITTER_MS } from './useLiveEvents';
import { useDeclareProjects } from '../lib/liveProjectDeclaration';
import { LIVE_INVALIDATION_WINDOW_MS } from '../lib/liveInvalidationBatcher';

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u-1', username: 'ann', role: 'user' }, logout: () => Promise.resolve() }),
}));

vi.mock('@microsoft/signalr', () => {
  const HubConnectionState = {
    Disconnected: 'Disconnected',
    Connecting: 'Connecting',
    Connected: 'Connected',
    Reconnecting: 'Reconnecting',
  } as const;
  const LogLevel = { Trace: 0, Debug: 1, Information: 2, Warning: 3, Error: 4, Critical: 5, None: 6 } as const;
  const registry: {
    handlers: Map<string, (payload: unknown) => void>;
    onreconnecting: (() => void) | null;
    onreconnected: (() => void) | null;
    onclose: (() => void) | null;
    /** The latest connection, and a held `start()` (released by the test). */
    conn: { state: string } | null;
    holdStart: boolean;
    releaseStart: (() => void) | null;
    calls: string[];
  } = {
    handlers: new Map(), onreconnecting: null, onreconnected: null, onclose: null,
    conn: null, holdStart: false, releaseStart: null, calls: [],
  };
  class FakeConn {
    state: string = HubConnectionState.Disconnected;
    on = vi.fn((method: string, cb: (payload: unknown) => void) => {
      registry.handlers.set(method, cb);
    });
    constructor() { registry.conn = this; }
    onclose = vi.fn((cb: () => void) => { registry.onclose = cb; });
    onreconnecting = vi.fn((cb: () => void) => { registry.onreconnecting = cb; });
    onreconnected = vi.fn((cb: () => void) => { registry.onreconnected = cb; });
    invoke = vi.fn((method: string, ids: unknown) => {
      registry.calls.push(`invoke:${method}`);
      return Promise.resolve({ accepted: Array.isArray(ids) ? ids : [], rejected: [] });
    });
    stop = vi.fn(() => { this.state = HubConnectionState.Disconnected; return Promise.resolve(); });
    start = vi.fn(function (this: FakeConn) {
      if (registry.holdStart) {
        this.state = HubConnectionState.Connecting;
        return new Promise<void>((resolve) => {
          registry.releaseStart = () => { this.state = HubConnectionState.Connected; resolve(); };
        });
      }
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

const hub = (signalr as unknown as {
  __mock: {
    handlers: Map<string, (payload: unknown) => void>;
    onreconnecting: (() => void) | null;
    onreconnected: (() => void) | null;
    onclose: (() => void) | null;
    conn: { state: string } | null;
    holdStart: boolean;
    releaseStart: (() => void) | null;
    calls: string[];
  };
}).__mock;

const P = '11111111-2222-3333-4444-555555555555';

function DeclareRoute() {
  useDeclareProjects('route', [P]);
  return null;
}

/** Readers of the tab: name → key. All mounted, all counted. */
const READERS = {
  inbox: ['inbox', 'assigned-to-me-unaccepted-open'],
  counts: ['notification-counts'],
  tasks: ['tasks', 'project', P, 'all', 'active', 'all', 'all', 'all', '', '', 'updated', ''],
  detail: ['issues', 'detail', 'sk-1'],
} as const;
type Reader = keyof typeof READERS;

let qc: QueryClient;
let reads: Reader[];
let unsubscribers: Array<() => void>;
let hidden = false;

async function mountTab(): Promise<void> {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  for (const name of Object.keys(READERS) as Reader[]) {
    const observer = new QueryObserver(qc, {
      queryKey: READERS[name],
      queryFn: () => {
        reads.push(name);
        hub.calls.push(`read:${name}`);
        return Promise.resolve({});
      },
      staleTime: Infinity,
    });
    unsubscribers.push(observer.subscribe(() => {}));
  }
  await act(async () => {
    render(
      <QueryClientProvider client={qc}>
        <LiveEventsProvider>
          <DeclareRoute />
        </LiveEventsProvider>
      </QueryClientProvider>,
    );
  });
  // Initial reads, the first declaration (debounced) — then a clean slate.
  await advance(1_000);
  reads = [];
  hub.calls = [];
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function reconnect(): Promise<void> {
  act(() => hub.onreconnecting!());
  act(() => hub.onreconnected!());
  // The declaration's answer is a microtask away.
  await advance(0);
}

/**
 * Advance one millisecond at a time until the first read, up to the bound;
 * return the moment (ms after the trigger) it happened, or null.
 */
async function momentOfFirstRead(boundMs: number): Promise<number | null> {
  for (let t = 1; t <= boundMs; t += 1) {
    await advance(1);
    if (reads.length > 0) return t;
  }
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  hub.handlers.clear();
  hub.onreconnected = null;
  hub.onreconnecting = null;
  hub.onclose = null;
  hub.conn = null;
  hub.holdStart = false;
  hub.releaseStart = null;
  hub.calls = [];
  reads = [];
  unsubscribers = [];
  hidden = false;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
});

afterEach(() => {
  unsubscribers.forEach((u) => u());
  cleanup();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  hidden = false;
});

describe('No. 81 — reconnect: declare first, then re-read every active reader after a random delay', () => {
  /** One run: mount, reconnect with `Math.random = r`, observe the re-read. */
  async function runReconnect(r: number): Promise<number> {
    await mountTab();
    vi.spyOn(Math, 'random').mockReturnValue(r);

    await reconnect();
    // Declared at once — before anything is read.
    expect(hub.calls[0]).toBe('invoke:DeclareProjects');
    expect(reads).toEqual([]);

    // The re-read lands within RESYNC_JITTER_MS of the trigger, the
    // batcher's coalescing window included (No. 81 "no more than RESYNC_JITTER_MS").
    const bound = RESYNC_JITTER_MS;
    const moment = await momentOfFirstRead(bound);
    expect(moment).not.toBeNull();
    expect(moment!).toBeGreaterThan(0);
    expect(moment!).toBeLessThanOrEqual(bound);
    await advance(LIVE_INVALIDATION_WINDOW_MS);
    // Every active reader, Inbox included, once.
    expect([...reads].sort()).toEqual(['counts', 'detail', 'inbox', 'tasks']);
    // The declaration came before the first read.
    expect(hub.calls.indexOf('invoke:DeclareProjects')).toBeLessThan(
      hub.calls.findIndex((c) => c.startsWith('read:')),
    );

    unsubscribers.forEach((u) => u());
    unsubscribers = [];
    cleanup();
    vi.restoreAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    return moment!;
  }

  test('the delay comes from the generator: two values, two different nonzero moments within the range', async () => {
    const early = await runReconnect(0.25);
    const late = await runReconnect(0.75);
    expect(early).not.toBe(late);
  });

  test('resync on the same connection re-reads without declaring again', async () => {
    await mountTab();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    act(() => hub.handlers.get('resync')!({ sentAt: '2026-10-09T10:00:00Z' }));
    await advance(RESYNC_JITTER_MS + LIVE_INVALIDATION_WINDOW_MS);
    expect([...reads].sort()).toEqual(['counts', 'detail', 'inbox', 'tasks']);
    expect(hub.calls.filter((c) => c.startsWith('invoke:'))).toEqual([]);
  });

  test('a hidden tab after a reconnect only takes obligations: 0 reads; visible → one read each', async () => {
    await mountTab();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    hidden = true;
    await reconnect();
    await advance(RESYNC_JITTER_MS + LIVE_INVALIDATION_WINDOW_MS * 2);
    expect(reads).toEqual([]);

    hidden = false;
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await advance(LIVE_INVALIDATION_WINDOW_MS);
    expect([...reads].sort()).toEqual(['counts', 'detail', 'inbox', 'tasks']);
  });

  test('an envelope repeated after a reconnect has no effect (dedup per tab)', async () => {
    await mountTab();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const envelope = {
      id: 777,
      occurredAt: '2026-10-09T10:00:00Z',
      eventType: 'issue.updated',
      entityType: 'issue',
      entityId: 'sk-1',
      projectId: P,
      changedFields: ['title'],
    };
    act(() => hub.handlers.get('event')!(envelope));
    await advance(LIVE_INVALIDATION_WINDOW_MS);
    expect(reads).toEqual(['detail']);

    await reconnect();
    // Let the reconnect re-read pass first (delay 0 with random = 0).
    await advance(LIVE_INVALIDATION_WINDOW_MS * 2);
    reads = [];

    act(() => hub.handlers.get('event')!(envelope));
    await advance(LIVE_INVALIDATION_WINDOW_MS * 2);
    expect(reads).toEqual([]);
  });

  // The delay of the timer plus
  // the batcher's window stays within RESYNC_JITTER_MS at the top of the
  // generator's range.
  test.each<[string, () => Promise<void>]>([
    ['a reconnect', () => reconnect()],
    ['a `resync` frame', async () => { act(() => hub.handlers.get('resync')!({ sentAt: '2026-10-09T10:00:00Z' })); }],
  ])('the largest delay of the generator: after %s the re-read still lands within RESYNC_JITTER_MS', async (_name, trigger) => {
    await mountTab();
    vi.spyOn(Math, 'random').mockReturnValue(0.9999);
    await trigger();
    const moment = await momentOfFirstRead(RESYNC_JITTER_MS);
    expect(moment).not.toBeNull();
    expect(moment!).toBeGreaterThan(LIVE_INVALIDATION_WINDOW_MS);
  });

  // A re-read waiting from the
  // dropped connection does not fire while the next one is not declared.
  test('a drop of the connection cancels the waiting re-read: nothing is read before the new declaration', async () => {
    await mountTab();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    act(() => hub.handlers.get('resync')!({ sentAt: '2026-10-09T10:00:00Z' }));
    await advance(1_000);
    // The connection drops and stays down past the moment of that re-read.
    act(() => hub.onreconnecting!());
    await advance(RESYNC_JITTER_MS + LIVE_INVALIDATION_WINDOW_MS);
    expect(reads).toEqual([]);

    // It comes back: declared first, then the re-read of the new connection.
    act(() => hub.onreconnected!());
    await advance(0);
    expect(hub.calls[0]).toBe('invoke:DeclareProjects');
    await advance(RESYNC_JITTER_MS);
    expect([...reads].sort()).toEqual(['counts', 'detail', 'inbox', 'tasks']);
    expect(hub.calls.indexOf('invoke:DeclareProjects')).toBeLessThan(
      hub.calls.findIndex((c) => c.startsWith('read:')),
    );
  });

  // The terminal close path, as the reconnect one.
  test('a terminal close cancels the waiting re-read: nothing is read before the next connection declares', async () => {
    await mountTab();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    act(() => hub.handlers.get('resync')!({ sentAt: '2026-10-09T10:00:00Z' }));
    await advance(1_000);
    // The socket closes; the next `start()` hangs past the moment of that re-read.
    hub.holdStart = true;
    hub.conn!.state = 'Disconnected';
    act(() => hub.onclose!());
    await advance(RESYNC_JITTER_MS + LIVE_INVALIDATION_WINDOW_MS);
    expect(reads).toEqual([]);

    // The connection is up: declared first, then its own re-read.
    await act(async () => { hub.releaseStart!(); });
    await advance(0);
    expect(hub.calls[0]).toBe('invoke:DeclareProjects');
    await advance(RESYNC_JITTER_MS);
    expect([...reads].sort()).toEqual(['counts', 'detail', 'inbox', 'tasks']);
    expect(hub.calls.indexOf('invoke:DeclareProjects')).toBeLessThan(
      hub.calls.findIndex((c) => c.startsWith('read:')),
    );
  });

  test('a re-read still waiting when the tab goes away is dropped', async () => {
    await mountTab();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    act(() => hub.handlers.get('resync')!({ sentAt: '2026-10-09T10:00:00Z' }));
    // The provider goes; the readers stay mounted, so a leaked timer would read.
    cleanup();
    await advance(RESYNC_JITTER_MS + LIVE_INVALIDATION_WINDOW_MS);
    expect(reads).toEqual([]);
  });
});

describe('No. 81 — a dropped connection is not declared to', () => {
  // Spec US-9 (edge 12): the set is declared on a live connection, and after
  // each reconnect before anything is re-read. A change of the set while the
  // connection is down waits for the next one.
  const Q = '99999999-2222-3333-4444-555555555555';
  function showRowOfAnotherProject(): void {
    act(() => {
      qc.setQueryData(READERS.tasks, {
        pages: [{ items: [{ id: 'q-1', projectId: Q }], hasMore: false }],
        pageParams: [undefined],
      });
    });
  }
  const invokes = () => hub.calls.filter((c) => c.startsWith('invoke:'));

  test('while reconnecting: no declaration; reconnected: declared', async () => {
    await mountTab();
    act(() => hub.onreconnecting!());
    showRowOfAnotherProject();
    await advance(1_000);
    expect(invokes()).toEqual([]);

    act(() => hub.onreconnected!());
    await advance(0);
    expect(invokes()).toEqual(['invoke:DeclareProjects']);
  });

  test('after a terminal close, until the next connection is up: no declaration', async () => {
    await mountTab();
    hub.holdStart = true;
    hub.conn!.state = 'Disconnected';
    act(() => hub.onclose!());
    showRowOfAnotherProject();
    await advance(1_000);
    expect(invokes()).toEqual([]);

    await act(async () => { hub.releaseStart!(); });
    await advance(0);
    expect(invokes()).toEqual(['invoke:DeclareProjects']);
  });
});
