/**
 * R12 / US-14 "Inbox after acceptance" (spec sk-622.21; plan T046, K19).
 * Test-plan row No. 83.
 *
 * The card accepted in this tab stays on screen, accepted, at its former
 * position, through every path that re-reads Inbox — the personal signal
 * `inbox`, the return of visibility, `resync`, the 60 s safety net — while
 * the OTHER cards follow the server; a status / accept event does not
 * re-read Inbox at all (R22); a change of route drops it. «Accepted» is read off the card's accessible state (the
 * accept control is replaced by the «accepted» indicator, by name), the
 * position off the order of the cards; colour is not looked at (§7).
 *
 * The stand: the real `InboxColumn` (Inbox queue) with the real `useInbox`
 * and `useAcceptIssue`, inside `LiveEventsProvider` on a fake hub, on a
 * `fetch` stub that models the server: after the accept, Inbox no longer
 * returns the accepted card. The neighbouring queues are stubbed.
 *
 * The Inbox queue has no filter or sort control today, so "filter or
 * sort change of the Inbox" has no path to exercise.
 *
 * No. 91 (T049): the phase-2 path — an event whose row leaves a loaded task
 * list re-reads that list from its first page — does not take the card
 * accepted here off Inbox either, alone or in one wave with the `inbox`
 * signal the server sends for the same write.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { InfiniteQueryObserver, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import '../i18n/config';
import { LiveEventsProvider, RESYNC_JITTER_MS } from '../hooks/useLiveEvents';
import { LIVE_INVALIDATION_WINDOW_MS } from './liveInvalidationBatcher';
import { LIVE_SAFETY_NET_MS } from './liveSafetyNet';
import { releaseAllAccepted } from './inboxAcceptedRetention';

const hubHandlers = new Map<string, (payload: unknown) => void>();

vi.mock('../auth/AuthContext', () => ({
  useAuthOptional: () => null,
  useAuth: () => ({ user: { id: 'u-1', username: 'ann', role: 'user' }, logout: () => Promise.resolve() }),
}));
vi.mock('@microsoft/signalr', () => {
  class FakeConn {
    state = 'Disconnected';
    on = (method: string, cb: (payload: unknown) => void) => { hubHandlers.set(method, cb); };
    onclose = () => {};
    onreconnecting = () => {};
    onreconnected = () => {};
    invoke = (_m: string, ids: unknown) => Promise.resolve({ accepted: Array.isArray(ids) ? ids : [], rejected: [] });
    stop = () => { this.state = 'Disconnected'; return Promise.resolve(); };
    start = () => { this.state = 'Connected'; return Promise.resolve(); };
  }
  class HubConnectionBuilder {
    withUrl() { return this; }
    withAutomaticReconnect() { return this; }
    configureLogging() { return this; }
    build() { return new FakeConn(); }
  }
  return {
    HubConnectionBuilder,
    HubConnectionState: { Disconnected: 'Disconnected', Connecting: 'Connecting', Connected: 'Connected', Reconnecting: 'Reconnecting' },
    LogLevel: { Information: 2, Warning: 3 },
  };
});
vi.mock('../components/Toaster', () => ({
  toaster: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
  useToaster: () => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }),
}));
vi.mock('./useLayoutState', () => ({
  useLayoutState: () => ({
    setInboxCollapsed: vi.fn(),
    selectedIssue: null,
    selectInboxIssue: vi.fn(),
    inboxTab: 'inbox',
    setInboxTab: vi.fn(),
    reportQueueFell: vi.fn(),
    onMeMode: false,
    outboxMode: false,
  }),
}));
vi.mock('./useMentions', () => ({ useMentions: () => ({ data: { items: [] }, isSuccess: true }) }));
vi.mock('./useWatching', () => ({
  watchingQueryKey: ['watching', 'feed'],
  useWatching: () => ({
    data: {
      items: [], unreadTotal: 0, subscriptionsTotal: 0, truncated: false, state: 'open', stateTotal: 0,
      openTotal: 0, closedTotal: 0, closedAutoTotal: 0,
    },
    isSuccess: true,
  }),
}));
vi.mock('./useReasonPrefsProbe', () => ({ useFeedChannelsAllOff: () => null }));
vi.mock('./useProjectsList', () => ({
  projectsListQueryKey: ['projects', 'list', 'shell'],
  useProjectsList: () => ({ data: { items: [{ id: 'p1', idPrefix: 'sk' }] } }),
}));
vi.mock('./useMarkNotificationsRead', () => ({ useMarkNotificationsRead: () => ({ mutate: vi.fn() }) }));
vi.mock('./useMarkWatchingCardRead', () => ({ useMarkWatchingCardRead: () => ({ mutate: vi.fn() }) }));
vi.mock('./useUnwatch', () => ({ useUnwatch: () => ({ mutate: vi.fn() }) }));
vi.mock('./useBulkUnwatch', () => ({ useBulkUnwatch: () => ({ mutate: vi.fn(), isPending: false }) }));
vi.mock('./useReminders', () => ({ useRingingIssueIds: () => new Set() }));

import { InboxColumn } from '../pages/shell/InboxColumn';

// ───────────────────────────── the server ─────────────────────────────

interface Row { id: string; title: string }
let inbox: Row[];
let inboxReads: number;
/** Ids whose accept the server refuses (422). */
let refuseAccept: Set<string>;

const summary = (r: Row) => ({
  id: r.id, projectId: 'p1', parentIdCurrent: null, version: 1, title: r.title, type: 'task', priority: 2,
  status: 'open', pinned: false, componentIds: [], labels: [], createdByUsername: 'bob',
  updatedAt: '2026-10-01T10:00:00Z', createdAt: '2026-10-01T09:00:00Z',
});

function stubServer(): void {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (url.startsWith('/api/v1/me/assigned-to')) {
      inboxReads += 1;
      return json({ items: inbox.map(summary), total: inbox.length, hasMore: false });
    }
    const accept = /^\/api\/v1\/issues\/([^/]+)\/accept/.exec(url);
    if (accept && init?.method === 'POST') {
      const id = decodeURIComponent(accept[1]);
      if (refuseAccept.has(id)) {
        return new Response(JSON.stringify({ error: 'version_conflict' }), {
          status: 422,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      // Accepted: no longer in «assigned to me, not accepted».
      inbox = inbox.filter((r) => r.id !== id);
      return json({ ...summary({ id, title: id }), acceptedAt: '2026-10-09T10:00:00Z' });
    }
    return json({});
  }));
}

// ───────────────────────────── the tab ─────────────────────────────

function Navigate() {
  const navigate = useNavigate();
  return (
    <>
      <button type="button" onClick={() => navigate('/elsewhere')}>go elsewhere</button>
      <button type="button" onClick={() => navigate('/activity')}>go to activity</button>
      <button type="button" onClick={() => navigate(-1)}>go back</button>
    </>
  );
}

let qc: QueryClient;
let hidden = false;
// The snapshots are per tab (module state) and outlive a test: every test
// starts with none, as a tab does after a navigation (the product's own
// `releaseAllAccepted`), and mounts on a route of its own.
let routeNo = 0;

async function mountTab(): Promise<void> {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await act(async () => {
    render(
      <MantineProvider>
        <QueryClientProvider client={qc}>
          <MemoryRouter initialEntries={[`/inbox-route-${++routeNo}`]}>
            <LiveEventsProvider>
              <Navigate />
              <Routes>
                {/* As in the product: /activity is a page outside the shell,
                    with no Inbox column on it. */}
                <Route path="/activity" element={null} />
                <Route path="*" element={<InboxColumn collapsed={false} width={340} />} />
              </Routes>
            </LiveEventsProvider>
          </MemoryRouter>
        </QueryClientProvider>
      </MantineProvider>,
    );
  });
  await advance(50);
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Cards on screen, in order: id and whether it shows as accepted. */
function cards(): Array<{ id: string; accepted: boolean }> {
  return screen.queryAllByRole('button', { name: /^Open issue / }).map((b) => {
    const id = /^Open issue ([^:]+):/.exec(b.getAttribute('aria-label') ?? '')![1];
    return { id, accepted: screen.queryByLabelText(`${id} accepted`) !== null };
  });
}
const titles = () =>
  screen.queryAllByRole('button', { name: /^Open issue / }).map((b) => /: (.*)$/.exec(b.getAttribute('aria-label') ?? '')![1]);

async function acceptSecond(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Accept sk-2' }));
  });
  await advance(10);
  expect(cards()).toEqual([
    { id: 'sk-1', accepted: false },
    { id: 'sk-2', accepted: true },
    { id: 'sk-3', accepted: false },
  ]);
  // Meanwhile another card changes on the server.
  inbox = inbox.map((r) => (r.id === 'sk-3' ? { ...r, title: 'Three v2' } : r));
}

const KEPT = [
  { id: 'sk-1', accepted: false },
  { id: 'sk-2', accepted: true },
  { id: 'sk-3', accepted: false },
];

function deliver(method: string, payload: unknown): void {
  act(() => hubHandlers.get(method)!(payload));
}
let eventId = 100;
const issueEvent = (eventType: string, entityId: string) => ({
  id: ++eventId, occurredAt: '2026-10-09T10:00:00Z', eventType, entityType: 'issue', entityId, projectId: 'p1',
});

beforeEach(() => {
  releaseAllAccepted();
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  hubHandlers.clear();
  inbox = [
    { id: 'sk-1', title: 'One' },
    { id: 'sk-2', title: 'Two' },
    { id: 'sk-3', title: 'Three' },
  ];
  inboxReads = 0;
  refuseAccept = new Set();
  hidden = false;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  stubServer();
});

afterEach(() => {
  cleanup();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  hidden = false;
});

describe('No. 83 — the card accepted in this tab stays, accepted, in place', () => {
  test.each<[string, () => Promise<void>]>([
    ['the personal signal `inbox`', async () => {
      deliver('signal', { areas: ['inbox'], sentAt: '2026-10-09T10:00:00Z' });
      await advance(LIVE_INVALIDATION_WINDOW_MS);
    }],
    ['loss and return of visibility', async () => {
      hidden = true;
      act(() => { document.dispatchEvent(new Event('visibilitychange')); });
      deliver('signal', { areas: ['inbox'], sentAt: '2026-10-09T10:00:00Z' });
      await advance(LIVE_INVALIDATION_WINDOW_MS);
      hidden = false;
      act(() => { document.dispatchEvent(new Event('visibilitychange')); });
      act(() => { window.dispatchEvent(new Event('focus')); });
      await advance(LIVE_INVALIDATION_WINDOW_MS);
    }],
    ['`resync`', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.1);
      deliver('resync', { sentAt: '2026-10-09T10:00:00Z' });
      await advance(RESYNC_JITTER_MS + LIVE_INVALIDATION_WINDOW_MS);
    }],
    ['the safety-net tick', async () => {
      await advance(LIVE_SAFETY_NET_MS + LIVE_INVALIDATION_WINDOW_MS);
    }],
  ])('after %s: Inbox re-read, the accepted card in place, the others updated', async (_name, path) => {
    await mountTab();
    await acceptSecond();
    const readsBefore = inboxReads;

    await path();
    // Let the answer of the re-read land.
    await advance(50);

    expect(inboxReads).toBeGreaterThan(readsBefore);
    expect(cards()).toEqual(KEPT);
    expect(titles()).toEqual(['One', 'Two', 'Three v2']);
  });

  // R22: a status / accept event of a declared project does not re-read
  // Inbox (the personal signal does — the row above); the card stays.
  test.each<[string, string]>([
    ['issue.accepted', 'sk-2'],
    ['issue.status_changed', 'sk-3'],
  ])('after the event %s of %s: Inbox not re-read, the accepted card in place', async (eventType, id) => {
    await mountTab();
    await acceptSecond();
    const readsBefore = inboxReads;

    deliver('event', issueEvent(eventType, id));
    await advance(LIVE_INVALIDATION_WINDOW_MS + 50);

    expect(inboxReads).toBe(readsBefore);
    expect(cards()).toEqual(KEPT);
  });

  test('a change of route drops the snapshot: the next re-read shows the server\'s list', async () => {
    await mountTab();
    await acceptSecond();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'go elsewhere' }));
    });
    await advance(10);

    deliver('signal', { areas: ['inbox'], sentAt: '2026-10-09T10:00:00Z' });
    await advance(LIVE_INVALIDATION_WINDOW_MS + 50);
    expect(cards()).toEqual([
      { id: 'sk-1', accepted: false },
      { id: 'sk-3', accepted: false },
    ]);
  });

  // The route changes on a page without the Inbox column, and the person
  // comes back to the same path.
  test('leaving the shell (/activity) and coming back to the same path drops the snapshot', async () => {
    await mountTab();
    await acceptSecond();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'go to activity' }));
    });
    await advance(10);
    expect(cards()).toEqual([]);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'go back' }));
    });
    await advance(10);

    deliver('signal', { areas: ['inbox'], sentAt: '2026-10-09T10:00:00Z' });
    await advance(LIVE_INVALIDATION_WINDOW_MS + 50);
    expect(inboxReads).toBeGreaterThan(1);
    expect(cards()).toEqual([
      { id: 'sk-1', accepted: false },
      { id: 'sk-3', accepted: false },
    ]);
  });

  test('on the new route the snapshot is not laid back even before any re-read', async () => {
    await mountTab();
    await acceptSecond();
    // The server's answer without the accepted card is in the cache.
    deliver('signal', { areas: ['inbox'], sentAt: '2026-10-09T10:00:00Z' });
    await advance(LIVE_INVALIDATION_WINDOW_MS + 50);
    expect(cards().map((c) => c.id)).toEqual(['sk-1', 'sk-2', 'sk-3']);
    const reads = inboxReads;

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'go elsewhere' }));
    });
    await advance(10);

    expect(inboxReads).toBe(reads);
    expect(cards()).toEqual([
      { id: 'sk-1', accepted: false },
      { id: 'sk-3', accepted: false },
    ]);
  });
});

describe('No. 83 — positions and failures', () => {
  async function accept(id: string): Promise<void> {
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: `Accept ${id}` }));
    });
    await advance(10);
  }
  async function reRead(): Promise<void> {
    deliver('signal', { areas: ['inbox'], sentAt: '2026-10-09T10:00:00Z' });
    await advance(LIVE_INVALIDATION_WINDOW_MS + 50);
  }

  test('the FIRST card accepted stays first', async () => {
    await mountTab();
    await accept('sk-1');
    await reRead();
    expect(cards()).toEqual([
      { id: 'sk-1', accepted: true },
      { id: 'sk-2', accepted: false },
      { id: 'sk-3', accepted: false },
    ]);
  });

  test('two accepted cards keep their places and their order', async () => {
    await mountTab();
    await accept('sk-3');
    await accept('sk-1');
    await reRead();
    expect(cards()).toEqual([
      { id: 'sk-1', accepted: true },
      { id: 'sk-2', accepted: false },
      { id: 'sk-3', accepted: true },
    ]);
  });

  test('a refused accept leaves no snapshot: the card is back, unaccepted, and follows the server', async () => {
    await mountTab();
    refuseAccept.add('sk-2');
    await accept('sk-2');
    await advance(50);
    expect(cards().find((c) => c.id === 'sk-2')).toEqual({ id: 'sk-2', accepted: false });
    // The server drops it for another reason (closed elsewhere): it goes.
    inbox = inbox.filter((r) => r.id !== 'sk-2');
    await reRead();
    expect(cards().map((c) => c.id)).toEqual(['sk-1', 'sk-3']);
  });

  // The
  // second card's position is the one on screen, not the one in the cache —
  // after a re-read the cache no longer holds the first accepted card.
  test.each<[string, string, string]>([
    ['sk-1', 'sk-2', 'the next card'],
    ['sk-1', 'sk-3', 'a card further down'],
  ])('accept %s → re-read → accept %s (%s) → re-read: the order on screen does not change', async (first, second) => {
    await mountTab();
    await accept(first);
    await reRead();
    await accept(second);
    await reRead();
    expect(cards().map((c) => c.id)).toEqual(['sk-1', 'sk-2', 'sk-3']);
    expect(cards().filter((c) => c.accepted).map((c) => c.id)).toEqual([first, second]);
  });

  test('cards accepted in reverse order are laid back in list order', async () => {
    await mountTab();
    await accept('sk-2');
    await accept('sk-1');
    await reRead();
    expect(cards()).toEqual([
      { id: 'sk-1', accepted: true },
      { id: 'sk-2', accepted: true },
      { id: 'sk-3', accepted: false },
    ]);
  });
});

describe('No. 91 — the phase-2 re-read keeps the card accepted in this tab (R12 × US-15)', () => {
  test('a row leaving the «open» task list re-reads it from the first page; the accepted Inbox card stays, accepted, in place', async () => {
    await mountTab();
    // A task list of the same project, «open», showing the accepted card.
    const listKey = ['tasks', 'project', 'p1', 'all', 'open', 'all', 'all', 'all', '', '', 'updated', ''];
    let listReads = 0;
    qc.setQueryData(listKey, {
      pages: [{ items: [{ ...summary({ id: 'sk-2', title: 'Two' }), createdBy: 'u-2', rowSeq: 40, isBlocked: false }], hasMore: false }],
      pageParams: [undefined],
    });
    const observer = new InfiniteQueryObserver(qc, {
      queryKey: listKey,
      queryFn: () => { listReads += 1; return Promise.resolve({ items: [], hasMore: false }); },
      initialPageParam: undefined,
      getNextPageParam: () => undefined,
      staleTime: Infinity,
    });
    const unsubscribe = observer.subscribe(() => {});
    await acceptSecond();
    const inboxBefore = inboxReads;

    // Another session moves sk-2 to «in progress»: its row leaves «open»;
    // the server also signals Inbox for the same write.
    deliver('event', {
      ...issueEvent('issue.status_changed', 'sk-2'),
      row: {
        id: 'sk-2', projectId: 'p1', version: 2, title: 'Two', type: 'task', priority: 2, status: 'in_progress',
        pinned: false, createdBy: 'u-2', componentIds: [], labels: [], acceptedAt: '2026-10-09T10:00:00Z',
        updatedAt: '2026-10-09T10:05:00Z', createdAt: '2026-10-01T09:00:00Z', rowSeq: 41,
      },
    });
    deliver('signal', { areas: ['inbox'], sentAt: '2026-10-09T10:05:00Z' });
    await advance(LIVE_INVALIDATION_WINDOW_MS + 50);

    expect(listReads).toBe(1);
    expect(inboxReads).toBeGreaterThan(inboxBefore);
    expect(cards()).toEqual(KEPT);
    unsubscribe();
  });
});
