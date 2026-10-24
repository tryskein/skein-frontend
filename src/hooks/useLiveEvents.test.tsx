/**
 * sk-64 — SignalR self-healing reconnect.
 *
 * Regression guard for the "stuck forever in [disconnected]" bug: when
 * the network drops and returns, the live-events connection must recover
 * on its own (no manual reload). Three behaviours are pinned:
 *
 *  1. A failed INITIAL start() retries with backoff until it succeeds —
 *     SignalR's own withAutomaticReconnect does NOT cover the first
 *     handshake, so this is the part that used to dead-end.
 *  2. A `window` `online` event short-circuits the pending backoff and
 *     reconnects immediately (no waiting out a 30s timer).
 *  3. Teardown (logout / unmount) stops the connection and detaches the
 *     `online` listener — no retries fire after cleanup.
 *
 * The @microsoft/signalr module is mocked with a fake HubConnection whose
 * start() behaviour is driven per-test via `__mock.startImpl`.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query';
import * as signalr from '@microsoft/signalr';
import {
  LiveEventsProvider,
  useLiveEventsState,
  reconnectDelayMs,
  RECONNECT_DELAYS_MS,
} from './useLiveEvents';
import { LIVE_INVALIDATION_WINDOW_MS } from '../lib/liveInvalidationBatcher';

// ─────────────────────────── Mocks ───────────────────────────

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u-1', username: 'admin', role: 'admin' } }),
}));

vi.mock('@microsoft/signalr', () => {
  const HubConnectionState = {
    Disconnected: 'Disconnected',
    Connecting: 'Connecting',
    Connected: 'Connected',
    Reconnecting: 'Reconnecting',
  } as const;
  const LogLevel = {
    Trace: 0, Debug: 1, Information: 2, Warning: 3, Error: 4, Critical: 5, None: 6,
  } as const;

  // Shared registry so tests can reach the live conn + steer start().
  const registry: {
    conn: FakeConn | null;
    startImpl: (conn: FakeConn) => Promise<void>;
  } = {
    conn: null,
    // Default: always succeed.
    startImpl: (c) => { c.state = HubConnectionState.Connected; return Promise.resolve(); },
  };

  class FakeConn {
    state: string = HubConnectionState.Disconnected;
    on = vi.fn();
    onclose = vi.fn();
    onreconnecting = vi.fn();
    onreconnected = vi.fn();
    stop = vi.fn(() => { this.state = HubConnectionState.Disconnected; return Promise.resolve(); });
    start = vi.fn(() => registry.startImpl(this));
  }

  class HubConnectionBuilder {
    withUrl() { return this; }
    withAutomaticReconnect() { return this; }
    configureLogging() { return this; }
    build() { registry.conn = new FakeConn(); return registry.conn; }
  }

  return { HubConnectionBuilder, HubConnectionState, LogLevel, __mock: registry };
});

// Typed handle on the mock registry exposed by the factory above.
const mock = (signalr as unknown as {
  __mock: {
    conn: {
      state: string;
      start: ReturnType<typeof vi.fn>;
      stop: ReturnType<typeof vi.fn>;
      on: ReturnType<typeof vi.fn>;
    } | null;
    startImpl: (conn: { state: string }) => Promise<void>;
  };
}).__mock;

/**
 * The Hub's `event` callback, as installed by the provider. Tests drive
 * envelopes through the real receive path instead of re-implementing it.
 */
function emitEvent(envelope: unknown): void {
  const entry = mock.conn!.on.mock.calls.find((c: unknown[]) => c[0] === 'event');
  if (!entry) throw new Error('no "event" handler registered on the connection');
  (entry[1] as (e: unknown) => void)(envelope);
}

// ─────────────────────────── Harness ───────────────────────────

function Probe() {
  return <span data-testid="state">{useLiveEventsState()}</span>;
}

function renderProvider() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LiveEventsProvider>
        <Probe />
      </LiveEventsProvider>
    </QueryClientProvider>,
  );
}

const stateText = () => screen.getByTestId('state').textContent;

beforeEach(() => {
  vi.useFakeTimers();
  // Kill jitter so backoff delays are exact in assertions.
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  mock.conn = null;
  mock.startImpl = (c) => { c.state = 'Connected'; return Promise.resolve(); };
});

afterEach(() => {
  cleanup();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ─────────────────────────── reconnectDelayMs ───────────────────────────

describe('reconnectDelayMs', () => {
  test('follows the ramp and clamps to the last delay forever', () => {
    // Math.random is pinned to 0.5 → zero jitter, exact values.
    expect(reconnectDelayMs(0)).toBe(0);
    expect(reconnectDelayMs(1)).toBe(2_000);
    expect(reconnectDelayMs(5)).toBe(30_000);
    // Clamps past the end — never returns null/undefined, so the
    // connection retries every ~30s indefinitely.
    expect(reconnectDelayMs(99)).toBe(RECONNECT_DELAYS_MS[RECONNECT_DELAYS_MS.length - 1]);
  });

  test('stays within ±20% jitter of the base delay', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0); // floor
    expect(reconnectDelayMs(5)).toBe(24_000); // 30000 - 20%
    vi.spyOn(Math, 'random').mockReturnValue(1); // ceil
    expect(reconnectDelayMs(5)).toBe(36_000); // 30000 + 20%
  });
});

// ─────────────────────────── self-healing ───────────────────────────

describe('LiveEventsProvider reconnection', () => {
  test('retries a failing initial start() with backoff until it connects', async () => {
    let attempts = 0;
    mock.startImpl = (c) => {
      attempts += 1;
      if (attempts <= 2) {
        c.state = 'Disconnected';
        return Promise.reject(new Error('network down'));
      }
      c.state = 'Connected';
      return Promise.resolve();
    };

    renderProvider();
    const conn = mock.conn!;

    // attempt 1 (sync) → reject → 0ms retry → attempt 2 → reject →
    // 2000ms retry → attempt 3 → resolve. Advance past the ramp.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(conn.start).toHaveBeenCalledTimes(3);
    expect(stateText()).toBe('connected');
  });

  test('an `online` event reconnects immediately without waiting out the backoff', async () => {
    let networkUp = false;
    mock.startImpl = (c) => {
      if (!networkUp) {
        c.state = 'Disconnected';
        return Promise.reject(new Error('offline'));
      }
      c.state = 'Connected';
      return Promise.resolve();
    };

    renderProvider();
    const conn = mock.conn!;

    // Let the initial attempt + its 0ms retry fail; a longer backoff timer
    // is now armed and the banner is stuck disconnected.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(stateText()).toBe('disconnected');
    const callsBeforeOnline = conn.start.mock.calls.length;

    // Network returns: the `online` event must retry NOW, not after the
    // pending ~2s+ backoff timer.
    networkUp = true;
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await Promise.resolve();
    });

    expect(conn.start.mock.calls.length).toBe(callsBeforeOnline + 1);
    expect(stateText()).toBe('connected');
  });

  test('teardown stops the connection and detaches the online listener', async () => {
    mock.startImpl = (c) => {
      c.state = 'Disconnected';
      return Promise.reject(new Error('offline'));
    };

    const { unmount } = renderProvider();
    const conn = mock.conn!;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    unmount();
    expect(conn.stop).toHaveBeenCalled();

    const callsAfterUnmount = conn.start.mock.calls.length;
    // A late `online` event must NOT resurrect a torn-down connection.
    window.dispatchEvent(new Event('online'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(conn.start.mock.calls.length).toBe(callsAfterUnmount);
  });
});

// ───────── sk-303.13 (T035, row 43) — the alarm rides EventEnvelope ─────────

describe('LiveEventsProvider — reminder liveness without a notification frame', () => {
  const REMINDERS_KEY = ['reminders', 'list', 'all'];
  const NOTIFICATIONS_COUNT_KEY = ['notifications', 'count', null];

  /**
   * Renders the provider around a QueryClient whose `invalidateQueries`
   * is recorded, so a test can ask what the receive path busted.
   *
   * sk-622.1 — the receive path no longer calls `invalidateQueries` per
   * router call: resets are coalesced and applied as one wave per window,
   * with a predicate over the queries the wave covers. So a key counts as
   * busted when a recorded call's filter MATCHES that key's query in the
   * cache — which is why the tracked keys are seeded into the cache first.
   */
  function renderWithSpy() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(REMINDERS_KEY, []);
    qc.setQueryData(NOTIFICATIONS_COUNT_KEY, 0);
    const calls: unknown[] = [];
    const original = qc.invalidateQueries.bind(qc);
    qc.invalidateQueries = ((filters?: unknown, options?: unknown) => {
      calls.push(filters);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return original(filters as any, options as any);
    }) as typeof qc.invalidateQueries;

    const utils = render(
      <QueryClientProvider client={qc}>
        <LiveEventsProvider>
          <Probe />
        </LiveEventsProvider>
      </QueryClientProvider>,
    );
    return { qc, calls, ...utils };
  }

  function bustedKeyCount(qc: QueryClient, calls: unknown[], target: readonly unknown[]): number {
    const query = qc.getQueryCache().find({ queryKey: target, exact: true });
    if (!query) throw new Error(`query ${JSON.stringify(target)} is not seeded`);
    return calls.filter((filter) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      qc.getQueryCache().findAll(filter as any).includes(query)).length;
  }

  /** Let the coalescing window close so the collected wave is applied. */
  async function applyWave(): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LIVE_INVALIDATION_WINDOW_MS);
    });
  }

  const rangEnvelope = {
    id: 4242,
    occurredAt: '2026-06-01T10:00:00Z',
    eventType: 'reminder.rang',
    entityType: 'issue',
    entityId: 'sk-1',
    projectId: '11111111-1111-4111-8111-111111111111',
  };

  // sk-622.21 T048 (No. 78, K18 "Reminder frame") — the reverse of what this
  // test used to say: a reminder reaches its owner as the PERSONAL
  // `reminder` frame (K14), so a project `reminder.*` envelope re-reads
  // nothing — not the reminders list, not any key of the issue it names.
  test('a project EventEnvelope reminder.* gets no reaction', async () => {
    const { qc, calls } = renderWithSpy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    for (const [i, eventType] of ['reminder.rang', 'reminder.set', 'reminder.snoozed', 'reminder.dismissed'].entries()) {
      act(() => emitEvent({ ...rangEnvelope, id: rangEnvelope.id + i, eventType }));
    }
    await applyWave();
    expect(bustedKeyCount(qc, calls, REMINDERS_KEY)).toBe(0);
    expect(calls).toEqual([]);
  });

  test('a reminder NotificationEnvelope does NOT touch the reminders list', async () => {
    // A rung reminder is a push-only record: it is never published into
    // the feed stream, so the shell must not be listening for it here.
    // If this ever fails, the dependency T035 removed has crept back.
    const { qc, calls } = renderWithSpy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    act(() =>
      emitEvent({
        notificationId: 9001,
        userId: 'u-1',
        eventId: 4242,
        eventType: 'reminder.rang',
        projectId: '11111111-1111-4111-8111-111111111111',
        createdAt: '2026-06-01T10:00:00Z',
      }),
    );
    await applyWave();

    expect(bustedKeyCount(qc, calls, REMINDERS_KEY)).toBe(0);
    // sk-622.21 (K18 "Notification (personal channel)"): the notification frame
    // re-reads nothing beyond the personal signal — the old
    // `['notifications', 'count', …]` reset is gone with the rest.
    expect(bustedKeyCount(qc, calls, NOTIFICATIONS_COUNT_KEY)).toBe(0);
  });

  // sk-622.21 T048 (No. 78) — "a duplicate reminder.rang envelope is routed
  // once" left this file: a project `reminder.*` envelope is no longer
  // routed at all (above), and the at-least-once repeat it guarded moved to
  // the personal frame — one ring per firing, `useLiveEvents.reminder.test.tsx`
  // (No. 86). Envelope-id dedup itself is still the receive loop's: see "a
  // repeated envelope (same id) is applied once" below, on an envelope the
  // provider still routes.
});

describe('LiveEventsProvider — sk-622.1 burst of project events', () => {
  /**
   * The incident shape (sk-609): agents emit dozens of project events a
   * minute, and every open tab used to refetch the header counters on each
   * one, cancelling the read still in flight. The receive path must turn a
   * burst into one refetch per window and never abort a read.
   *
   * sk-622.21 (US-13, K18): a project event no longer re-reads the header
   * counters at all (the personal signal does), so the burst is observed on
   * a key `issue.closed` does re-read — the «in progress» block of
   * `/activity` (K18 row "Dashboard `/activity`").
   */
  function renderWithCounters() {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    const signals: AbortSignal[] = [];
    const resolvers: Array<(v: unknown) => void> = [];
    const observer = new QueryObserver(qc, {
      queryKey: ['dashboard', 'in-progress', null],
      queryFn: ({ signal }) =>
        new Promise((resolve) => {
          signals.push(signal);
          resolvers.push(resolve);
        }),
    });
    const unsubscribe = observer.subscribe(() => {});
    const utils = render(
      <QueryClientProvider client={qc}>
        <LiveEventsProvider>
          <Probe />
        </LiveEventsProvider>
      </QueryClientProvider>,
    );
    return { signals, resolvers, unsubscribe, ...utils };
  }

  const issueEnvelope = (id: number) => ({
    id,
    occurredAt: '2026-10-07T15:47:00Z',
    eventType: 'issue.closed',
    entityType: 'issue',
    entityId: `sk-${id}`,
    projectId: '11111111-1111-4111-8111-111111111111',
  });

  test('ten events inside one window refetch a re-read key once', async () => {
    const { signals, resolvers, unsubscribe } = renderWithCounters();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(signals).toHaveLength(1);
    resolvers[0]({});
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    for (let i = 1; i <= 10; i += 1) {
      act(() => emitEvent(issueEnvelope(i)));
    }
    expect(signals).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(LIVE_INVALIDATION_WINDOW_MS);
    });
    expect(signals).toHaveLength(2);
    unsubscribe();
  });

  // No. 78 / US-14 "Repeats" (fable MAJOR-2) — the receive loop drops an
  // envelope whose `id` it has already applied: at-least-once delivery may
  // hand the same envelope over twice, and the repeat must have no effect.
  // Shown on `issue.closed`, which still re-reads `['dashboard',
  // 'in-progress']`; red if the provider stops consulting its dedup.
  test('a repeated envelope (same id) is applied once', async () => {
    const { signals, resolvers, unsubscribe } = renderWithCounters();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(signals).toHaveLength(1);
    resolvers[0]({});
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // First delivery, own wave: one re-read.
    act(() => emitEvent(issueEnvelope(1)));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LIVE_INVALIDATION_WINDOW_MS);
    });
    expect(signals).toHaveLength(2);
    resolvers[1]({});
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // The same envelope again, in a wave of its own: nothing.
    act(() => emitEvent(issueEnvelope(1)));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LIVE_INVALIDATION_WINDOW_MS);
    });
    expect(signals).toHaveLength(2);

    // A new id in the same position still re-reads — the silence above is
    // the dedup, not a dead receive path.
    act(() => emitEvent(issueEnvelope(2)));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LIVE_INVALIDATION_WINDOW_MS);
    });
    expect(signals).toHaveLength(3);
    unsubscribe();
  });

  test('an event during a read does not abort it, and is applied after it', async () => {
    const { signals, resolvers, unsubscribe } = renderWithCounters();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    // The initial read is still in flight (slow database).
    expect(signals).toHaveLength(1);

    act(() => emitEvent(issueEnvelope(1)));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LIVE_INVALIDATION_WINDOW_MS);
    });
    expect(signals[0].aborted).toBe(false);
    expect(signals).toHaveLength(1);

    resolvers[0]({});
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LIVE_INVALIDATION_WINDOW_MS);
    });
    // The read began before the event, so the event is caught up afterwards.
    expect(signals).toHaveLength(2);
    expect(signals[0].aborted).toBe(false);
    unsubscribe();
  });
});

describe('LiveEventsProvider — sk-622.1 teardown order', () => {
  test('a frame that lands while the hub is stopping is still applied', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // sk-622.21 T048 — the probe is a key a project event still re-reads
    // (K18 "Dashboard `/activity`"); a project `reminder.*` re-reads nothing now.
    qc.setQueryData(['dashboard', 'in-progress', null], {});
    const utils = render(
      <QueryClientProvider client={qc}>
        <LiveEventsProvider>
          <Probe />
        </LiveEventsProvider>
      </QueryClientProvider>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // stop() is asynchronous: the connection keeps delivering frames until
    // it settles. Hold it open, unmount, and deliver one frame in the gap.
    let finishStop: () => void = () => {};
    mock.conn!.stop.mockImplementation(
      () => new Promise<void>((resolve) => { finishStop = resolve; }),
    );
    utils.unmount();
    act(() =>
      emitEvent({
        id: 5151,
        occurredAt: '2026-10-08T10:00:00Z',
        eventType: 'issue.closed',
        entityType: 'issue',
        entityId: 'sk-1',
        projectId: '11111111-1111-4111-8111-111111111111',
      }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LIVE_INVALIDATION_WINDOW_MS);
    });
    expect(
      qc.getQueryCache().find({ queryKey: ['dashboard', 'in-progress', null] })!.state.isInvalidated,
    ).toBe(true);
    finishStop();
  });
});
