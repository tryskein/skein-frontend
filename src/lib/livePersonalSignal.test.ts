/**
 * Personal signal through the provider (spec sk-622.21 US-11, US-13; plan
 * T042, K18 rows "Signal `inbox` … `projects`", "Notification (personal
 * channel)"). Test-plan row No. 75.
 *
 * A `signal` frame is delivered to the handler the provider registered on
 * the (fake) hub connection — not to `invalidateForSignal` directly — so a
 * handler that is built but not wired fails here. After the coalescing
 * window the test reads which seeded cache entries came out invalidated
 * and compares the set EXACTLY with the literal row of K18; «re-read only
 * if visible» is observed by the reads of a mounted reader.
 */
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { InfiniteQueryObserver, QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query';
import * as signalr from '@microsoft/signalr';
import { LiveEventsProvider } from '../hooks/useLiveEvents';
import { LIVE_INVALIDATION_WINDOW_MS } from './liveInvalidationBatcher';

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u-1', username: 'admin', role: 'user' }, logout: () => Promise.resolve() }),
}));

vi.mock('@microsoft/signalr', () => {
  const HubConnectionState = {
    Disconnected: 'Disconnected',
    Connecting: 'Connecting',
    Connected: 'Connected',
    Reconnecting: 'Reconnecting',
  } as const;
  const LogLevel = { Trace: 0, Debug: 1, Information: 2, Warning: 3, Error: 4, Critical: 5, None: 6 } as const;
  const registry: { handlers: Map<string, (payload: unknown) => void> } = { handlers: new Map() };
  class FakeConn {
    state: string = HubConnectionState.Disconnected;
    on = vi.fn((method: string, cb: (payload: unknown) => void) => {
      registry.handlers.set(method, cb);
    });
    onclose = vi.fn();
    onreconnecting = vi.fn();
    onreconnected = vi.fn();
    invoke = vi.fn(() => Promise.resolve({ accepted: [], rejected: [] }));
    stop = vi.fn(() => { this.state = HubConnectionState.Disconnected; return Promise.resolve(); });
    start = vi.fn(function (this: FakeConn) {
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

const mock = (signalr as unknown as {
  __mock: { handlers: Map<string, (payload: unknown) => void> };
}).__mock;

const P = '11111111-2222-3333-4444-555555555555';

const page = () => ({ pages: [{ items: [], hasMore: false }], pageParams: [undefined] });
const projectList = (lens: string, status: string) =>
  ['tasks', 'project', P, lens, status, 'all', 'all', 'all', '', '', 'updated', ''];

/** Keys personal screens and their neighbours read. */
const KEYS = {
  counts: ['notification-counts'],
  inbox: ['inbox', 'assigned-to-me-unaccepted-open'],
  mentions: ['mentions', 'feed'],
  watching: ['watching', 'feed', 'unread'],
  reminders: ['reminders', 'list', 'all'],
  tasksOnMe: ['tasks', 'me', 'on-me', 'active', 'all', 'all', 'all', '', 'updated'],
  tasksCreatedBy: ['tasks', 'me', 'created-by', 'active', 'all', 'all', 'all', '', 'updated'],
  tasksUnreviewed: ['tasks', 'me', 'created-by', 'unreviewed', 'all', 'all', 'all', '', 'updated'],
  tasksPOutbox: projectList('outbox', 'active'),
  tasksP: projectList('all', 'active'),
  tasksPUnreviewed: projectList('all', 'unreviewed'),
  tasksAll: ['tasks', 'all', 'cross-project', 'active', 'all', 'all', 'all', '', 'updated', ''],
  detail: ['issues', 'detail', 'sk-1'],
  projectsLookup: ['projects', 'list', 'shell'],
  projectsInfinite: ['projects', 'list', 'shell', 'infinite', '', 'all'],
  projectsInfiniteLens: ['projects', 'list', 'shell', 'infinite', '', 'on-me'],
  componentsP: ['components', 'list', P, 'all'],
  componentsPLens: ['components', 'list', P, 'on-me'],
  membersP: ['members', 'list', P],
  notificationsCount: ['notifications', 'count', null],
  notificationsList: ['notifications', 'list', 'unread'],
  // sk-674.18 T053 (row 239) — «my spaces» of the signed-in person
  // (`useMySpaces.ts#mySpacesQueryKey`), the addressee's invitations and a
  // space's settings / invitations (`livePersonalSignal.ts` prefixes).
  mySpaces: ['me', 'spaces', 'u-1'],
  myInvitations: ['me', 'invitations'],
  spaceSettings: ['spaces', 'k3x9p2qa', 'invitations'],
} as const;
type KeyName = keyof typeof KEYS;

const INFINITE: KeyName[] = [
  'tasksOnMe', 'tasksCreatedBy', 'tasksUnreviewed', 'tasksPOutbox', 'tasksP', 'tasksPUnreviewed',
  'tasksAll', 'projectsInfinite', 'projectsInfiniteLens',
];

let qc: QueryClient;

async function mountProvider(): Promise<void> {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  for (const name of Object.keys(KEYS) as KeyName[]) {
    qc.setQueryData(KEYS[name], INFINITE.includes(name) ? page() : {});
  }
  await act(async () => {
    render(createElement(QueryClientProvider, { client: qc }, createElement(LiveEventsProvider, null)));
  });
}

function deliver(method: string, payload: unknown): void {
  const handler = mock.handlers.get(method);
  if (!handler) throw new Error(`no handler registered for ${method}`);
  act(() => handler(payload));
}

async function wave(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(LIVE_INVALIDATION_WINDOW_MS);
  });
}

function invalidated(): KeyName[] {
  return (Object.keys(KEYS) as KeyName[])
    .filter((n) => qc.getQueryState(KEYS[n])?.isInvalidated === true)
    .sort();
}

const sorted = (names: KeyName[]) => [...names].sort();

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  mock.handlers.clear();
});

afterEach(() => {
  cleanup();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('No. 75 — a personal signal re-reads exactly the keys of its areas', () => {
  test.each<[string, KeyName[]]>([
    // sk-674.18 T054 (screens 1.3, row 241): the invitation cards of Inbox
    // too — a confirmed email turns "Accept" on without a reload
    ['inbox', ['counts', 'inbox', 'myInvitations']],
    ['mentions', ['counts', 'mentions']],
    ['watching', ['counts', 'watching']],
    // the lenses of the projects column: only the variants with a lens
    ['lens', ['counts', 'projectsInfiniteLens', 'componentsPLens']],
    // membership of the personal task lists: "assigned to me", "created by me" and
    // the project lists under a lens — not the plain lists
    ['tasks', ['tasksOnMe', 'tasksCreatedBy', 'tasksUnreviewed', 'tasksPOutbox']],
    // counters, the lists filtered by «unreviewed», the open card's private fields
    ['unreviewed', ['counts', 'tasksUnreviewed', 'tasksPUnreviewed', 'detail']],
    ['projects', ['projectsLookup', 'projectsInfinite', 'projectsInfiniteLens', 'membersP']],
    // sk-674.18 T053 (row 239, US-19): «my spaces», the projects, the
    // invitations and the counters — and nothing of the task lists or the
    // open card (the reason-specific part is `accessLoss.ts`, row 240)
    [
      'spaces',
      [
        'counts', 'mySpaces', 'projectsLookup', 'projectsInfinite', 'projectsInfiniteLens', 'membersP',
        'myInvitations', 'spaceSettings',
      ],
    ],
  ])('area %s', async (area, expected) => {
    await mountProvider();
    deliver('signal', { areas: [area], sentAt: '2026-10-09T10:00:00Z' });
    // Applied by the coalescing wave, not synchronously.
    expect(invalidated()).toEqual([]);
    await wave();
    expect(invalidated()).toEqual(sorted(expected));
  });

  test('several areas in one frame: the union of their rows', async () => {
    await mountProvider();
    deliver('signal', { areas: ['inbox', 'mentions'], sentAt: '2026-10-09T10:00:00Z' });
    await wave();
    expect(invalidated()).toEqual(sorted(['counts', 'inbox', 'myInvitations', 'mentions']));
  });

  test('broken entries beside a known area: the area is still re-read', async () => {
    // A frame is a list of area names; an entry that is no name is skipped,
    // it does not take the frame down with it.
    await mountProvider();
    deliver('signal', { areas: [null, 7, '', 'inbox'], sentAt: '2026-10-09T10:00:00Z' });
    await wave();
    expect(invalidated()).toEqual(sorted(['counts', 'inbox', 'myInvitations']));
  });

  test('an unknown area and a malformed frame re-read nothing', async () => {
    await mountProvider();
    deliver('signal', { areas: ['reviewed-by-someone-else'], sentAt: '2026-10-09T10:00:00Z' });
    deliver('signal', null);
    deliver('signal', { areas: 'inbox' });
    await wave();
    expect(invalidated()).toEqual([]);
  });

  test('"Notification (personal channel)": nothing beyond the signal', async () => {
    await mountProvider();
    deliver('event', {
      notificationId: 9001,
      userId: 'u-1',
      eventId: 4242,
      eventType: 'comment.created',
      projectId: P,
      createdAt: '2026-10-09T10:00:00Z',
    });
    await wave();
    expect(invalidated()).toEqual([]);
  });

  test('`watching` re-reads the Watching column only while it is visible', async () => {
    await mountProvider();
    let reads = 0;
    const deliverWatching = async () => {
      deliver('signal', { areas: ['watching'], sentAt: '2026-10-09T10:00:00Z' });
      await wave();
    };

    // Not mounted: marked stale, no request.
    await deliverWatching();
    expect(reads).toBe(0);

    // Mounted (the column is on screen): the signal re-reads it.
    const observer = new QueryObserver(qc, {
      queryKey: KEYS.watching,
      queryFn: () => {
        reads += 1;
        return Promise.resolve({});
      },
      staleTime: Infinity,
    });
    const unsubscribe = observer.subscribe(() => {});
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const afterMount = reads; // a stale entry is read once on mount
    await deliverWatching();
    expect(reads).toBe(afterMount + 1);
    unsubscribe();
  });
});

describe('No. 75 — personal lists are re-read from the first page (K21)', () => {
  test.each<[string, KeyName]>([
    ['tasks', 'tasksOnMe'],
    ['unreviewed', 'tasksUnreviewed'],
  ])('area %s: a list with two loaded pages fetches only the first', async (area, name) => {
    await mountProvider();
    const fetched: unknown[] = [];
    qc.setQueryData(KEYS[name], {
      pages: [{ items: [], hasMore: true, nextCursor: 'c2' }, { items: [], hasMore: false }],
      pageParams: [undefined, 'c2'],
    });
    const observer = new InfiniteQueryObserver(qc, {
      queryKey: KEYS[name],
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (last: { hasMore: boolean; nextCursor?: string }) =>
        last.hasMore ? last.nextCursor : undefined,
      queryFn: ({ pageParam }: { pageParam: unknown }) => {
        fetched.push(pageParam);
        return Promise.resolve({ items: [], hasMore: true, nextCursor: 'c2' });
      },
      staleTime: Infinity,
    });
    const unsubscribe = observer.subscribe(() => {});
    deliver('signal', { areas: [area], sentAt: '2026-10-09T10:00:00Z' });
    await wave();
    expect(fetched).toEqual([undefined]);
    unsubscribe();
  });
});
