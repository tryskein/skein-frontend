/**
 * sk-622.21 (No. 86, T048) — the personal reminder frame.
 *
 * A reminder reaches its owner as the `reminder` client method (US-11,
 * K14), whatever projects the tab declared. Its K18 row "Reminder
 * frame": the reminders list `['reminders','list','all']` is
 * re-read and nothing else; a `rang` frame rings the bell. Delivery is
 * at-least-once, so a frame may come twice — also after a reconnect — and
 * the bell rings once per FIRING (`firingId` = reminder + due time), not
 * once per reminder: a snoozed reminder that fires again rings again.
 *
 * The ring is observed where it happens — the ring epoch the header keys
 * its animation restart off (`HeaderBar.tsx#useRingEpoch`), counted as the
 * number of rings — and the frame goes through the handler the provider
 * installs on the hub connection, not through a helper called directly.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as signalr from '@microsoft/signalr';
import { LiveEventsProvider } from './useLiveEvents';
import { LIVE_INVALIDATION_WINDOW_MS } from '../lib/liveInvalidationBatcher';
import { ringReminderFiring, useRingEpoch } from '../lib/useReminders';
import type { Reminder, RemindersListResponse } from '../api/reminders';
import type { ReminderFrame } from '../lib/eventEnvelope';

// ─────────────────────────── Mocks ───────────────────────────

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u-1', username: 'admin', role: 'admin' } }),
}));

const listSpy = vi.fn<() => Promise<RemindersListResponse>>();
vi.mock('../api/reminders', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/reminders')>();
  return { ...actual, listReminders: () => listSpy() };
});

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
  const registry: { conn: FakeConn | null } = { conn: null };

  class FakeConn {
    state: string = HubConnectionState.Disconnected;
    on = vi.fn();
    onclose = vi.fn();
    onreconnecting = vi.fn();
    onreconnected = vi.fn();
    invoke = vi.fn(() => Promise.resolve({ accepted: [], rejected: [] }));
    stop = vi.fn(() => { this.state = HubConnectionState.Disconnected; return Promise.resolve(); });
    start = vi.fn(() => { this.state = HubConnectionState.Connected; return Promise.resolve(); });
  }

  class HubConnectionBuilder {
    withUrl() { return this; }
    withAutomaticReconnect() { return this; }
    configureLogging() { return this; }
    build() { registry.conn = new FakeConn(); return registry.conn; }
  }

  return { HubConnectionBuilder, HubConnectionState, LogLevel, __mock: registry };
});

type Callback = (...args: unknown[]) => void;
const mock = (signalr as unknown as {
  __mock: {
    conn: {
      state: string;
      on: ReturnType<typeof vi.fn>;
      invoke: ReturnType<typeof vi.fn>;
      onreconnecting: ReturnType<typeof vi.fn>;
      onreconnected: ReturnType<typeof vi.fn>;
    } | null;
  };
}).__mock;

/** The provider's own handler for a client method, as installed on the hub. */
function handler(method: string): Callback {
  const entry = mock.conn!.on.mock.calls.find((c: unknown[]) => c[0] === method);
  if (!entry) throw new Error(`no "${method}" handler registered on the connection`);
  return entry[1] as Callback;
}

// ─────────────────────────── Fixtures ───────────────────────────

/** The issue's project. The tab below never declares it. */
const UNDECLARED_PROJECT = '22222222-2222-4222-8222-222222222222';

function frame(kind: string, reminderId: string, remindAt: string) {
  return {
    reminderId,
    issueId: 'sk-1',
    projectId: UNDECLARED_PROJECT,
    kind,
    remindAt,
    firingId: `${reminderId}@${remindAt}`,
  };
}

function ringing(id: string, remindAt: string): Reminder {
  return {
    id,
    issueId: 'sk-1',
    issueTitle: 'title',
    issueStatus: 'open',
    projectId: UNDECLARED_PROJECT,
    issueType: 'task',
    issuePriority: 3,
    remindAt,
    snoozeCount: 0,
    state: 'ringing',
  };
}

const emptyList: RemindersListResponse = { reminders: [], ringingTaskCount: 0 };

// ─────────────────────────── Harness ───────────────────────────

let rings = 0;
function RingProbe() {
  rings = useRingEpoch();
  return null;
}

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // Keys another frame or event could plausibly reset: they must stay put.
  qc.setQueryData(['notifications', 'count', null], { inbox: 0 });
  qc.setQueryData(['watching', 'feed', 'open'], { items: [] });
  qc.setQueryData(['issue', 'sk-1'], { id: 'sk-1' });
  qc.setQueryData(['tasks', 'list', 'p1'], { items: [] });
  const utils = render(
    <QueryClientProvider client={qc}>
      <LiveEventsProvider>
        <RingProbe />
      </LiveEventsProvider>
    </QueryClientProvider>,
  );
  return { qc, ...utils };
}

async function settle(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(LIVE_INVALIDATION_WINDOW_MS);
  });
}

async function deliver(payload: unknown): Promise<void> {
  act(() => handler('reminder')(payload));
  await settle();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  mock.conn = null;
  rings = 0;
  listSpy.mockReset();
  listSpy.mockResolvedValue(emptyList);
});

afterEach(() => {
  cleanup();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ─────────────────────────── Tests ───────────────────────────

describe('No. 86 — the personal reminder frame re-reads the reminders list and nothing else', () => {
  test.each(['set', 'snoozed', 'rang', 'dismissed'])('kind %s', async (kind) => {
    const { qc } = renderTab();
    await settle();
    const readsBefore = listSpy.mock.calls.length;

    await deliver(frame(kind, 'rem-1', '2026-06-01T10:00:00Z'));

    expect(listSpy.mock.calls.length).toBe(readsBefore + 1);
    for (const key of [
      ['notifications', 'count', null],
      ['watching', 'feed', 'open'],
      ['issue', 'sk-1'],
      ['tasks', 'list', 'p1'],
    ]) {
      expect(qc.getQueryState(key)!.isInvalidated, JSON.stringify(key)).toBe(false);
    }
  });
});

describe('No. 86 — the bell rings once per firing, in a tab that never declared the project', () => {
  test('a `rang` frame rings; the tab declared no project', async () => {
    renderTab();
    await settle();
    expect(rings).toBe(0);

    await deliver(frame('rang', 'rem-1', '2026-06-01T10:00:00Z'));

    expect(rings).toBe(1);
    const declared = mock.conn!.invoke.mock.calls.flatMap((c: unknown[]) => c.slice(1));
    expect(JSON.stringify(declared)).not.toContain(UNDECLARED_PROJECT);
  });

  test('the other kinds re-read the list but do not ring', async () => {
    renderTab();
    await settle();
    for (const kind of ['set', 'snoozed', 'dismissed']) {
      await deliver(frame(kind, 'rem-1', '2026-06-01T10:00:00Z'));
    }
    expect(rings).toBe(0);
  });

  test('two firings of one reminder ring twice; each repeat — before and after a reconnect — rings no more', async () => {
    renderTab();
    await settle();
    const first = frame('rang', 'rem-1', '2026-06-01T10:00:00Z');
    // Snoozed and due again: the same reminder, a new firing.
    const second = frame('rang', 'rem-1', '2026-06-01T10:15:00Z');

    await deliver(first);
    await deliver(second);
    expect(rings).toBe(2);

    await deliver(first);
    await deliver(second);
    expect(rings).toBe(2);

    // The hub drops and comes back (same connection, as SignalR's
    // automatic reconnect does); the server re-sends what it had.
    act(() => (mock.conn!.onreconnecting.mock.calls[0][0] as Callback)());
    act(() => (mock.conn!.onreconnected.mock.calls[0][0] as Callback)());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    await deliver(first);
    await deliver(second);
    expect(rings).toBe(2);
  });

  test('the list showing the firing the frame already rang does not ring it again', async () => {
    renderTab();
    await settle();
    // The re-read the frame triggers returns the reminder as ringing —
    // with the due time spelled differently than in the frame.
    listSpy.mockResolvedValue({
      reminders: [ringing('rem-1', '2026-06-01T10:00:00.000Z')],
      ringingTaskCount: 1,
    });

    await deliver(frame('rang', 'rem-1', '2026-06-01T10:00:00Z'));
    await settle();

    expect(rings).toBe(1);
  });

  test('a malformed frame neither rings nor re-reads', async () => {
    renderTab();
    await settle();
    const readsBefore = listSpy.mock.calls.length;
    const good = frame('rang', 'rem-1', '2026-06-01T10:00:00Z');
    const without = (key: string) => {
      const copy: Record<string, unknown> = { ...good };
      delete copy[key];
      return copy;
    };
    for (const junk of [
      null,
      'rang',
      without('reminderId'),
      { ...good, reminderId: '' },
      without('kind'),
      without('firingId'),
      { ...good, firingId: '' },
    ]) {
      await deliver(junk);
    }
    expect(rings).toBe(0);
    expect(listSpy.mock.calls.length).toBe(readsBefore);
  });

  // The server's `firingId` is THE dedup key
  // (BrowserContract.cs#ReminderFrame), not a fallback behind the client's
  // own `reminderId@remindAt`. Red while the key was built from `remindAt`:
  // the first two frames share a due time (one ring), the third shares the
  // first's firingId under another due time (a second ring).
  test('the key is the server\'s `firingId`, not the frame\'s `remindAt`', async () => {
    renderTab();
    await settle();
    const first = frame('rang', 'rem-1', '2026-06-01T10:00:00Z');
    const otherFiring = { ...first, firingId: 'rem-1@2026-06-01T10:15:00Z' };
    const sameFiring = { ...first, remindAt: '2026-06-01T11:00:00Z' };

    await deliver(first);
    await deliver(otherFiring);
    expect(rings).toBe(2);

    await deliver(sameFiring);
    expect(rings).toBe(2);
  });

  // Only a frame with no `firingId` at all falls back to the client's key;
  // the provider drops such a frame (see the malformed-frame test above),
  // so the insurance is exercised on the ring function the provider calls.
  // It shares the ledger with the frame and the list: the same firing,
  // keyed either way, rings once.
  test('without a `firingId`, the firing is keyed by reminder and due time — once', () => {
    const qc = new QueryClient();
    const bare = {
      ...frame('rang', 'rem-1', '2026-06-01T10:00:00Z'),
      firingId: '',
    } as ReminderFrame;
    expect(ringReminderFiring(qc, bare)).toBe(true);
    expect(ringReminderFiring(qc, bare)).toBe(false);
    // The same firing as the server names it, its time spelled otherwise.
    const named = {
      ...frame('rang', 'rem-1', '2026-06-01T10:00:00Z'),
      firingId: 'rem-1@2026-06-01T10:00:00.000000000Z',
    } as ReminderFrame;
    expect(ringReminderFiring(qc, named)).toBe(false);
    // A later firing of the same reminder is a new ring.
    expect(
      ringReminderFiring(qc, { ...bare, remindAt: '2026-06-01T10:15:00Z' }),
    ).toBe(true);
  });

  test('a frame without a due time still rings once per `firingId`', async () => {
    renderTab();
    await settle();
    const a = { ...frame('rang', 'rem-1', ''), firingId: 'rem-1@a' };
    const b = { ...frame('rang', 'rem-1', ''), firingId: 'rem-1@b' };
    await deliver(a);
    await deliver(b);
    await deliver(a);
    expect(rings).toBe(2);
  });
});
