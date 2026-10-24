/**
 * Hidden tab, return of visibility and focus (spec sk-622.21 US-13, US-14,
 * SC-006; plan T043, K22, K18 rows "Focus/visibility/navigation" and the
 * exit obligation). Test-plan row No. 80.
 *
 * The stand: the real `AuthProvider` and `LiveEventsProvider` on a fake hub
 * whose handlers the test calls; real readers — `useNotificationCounts`,
 * `useWatching` (the Watching column), `useIssueDetail` (the open card with
 * its links and watchers), `useTasks`, `useProjectsInfinite` — on a `fetch`
 * stub that models the BFF. Requests are counted on the wire, by URL; events
 * and signals go into the provider's handlers; visibility is
 * `document.hidden` + `visibilitychange`, focus is `window` `focus`.
 */
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { InfiniteQueryObserver, QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query';
import { MemoryRouter, useNavigate, type NavigateFunction } from 'react-router-dom';
import * as signalr from '@microsoft/signalr';
import '../i18n/config';
import { AuthProvider } from '../auth/AuthContext';
import { LiveEventsProvider } from '../hooks/useLiveEvents';
import { LiveNavigationRefresh } from './liveVisibility';
import { LIVE_INVALIDATION_WINDOW_MS } from './liveInvalidationBatcher';
import { LIVE_SAFETY_NET_MS } from './liveSafetyNet';
import { useNotificationCounts } from './useNotificationCounts';
import { useWatching } from './useWatching';
import { useIssueDetail } from './useIssueDetail';
import { useTasks } from './useTasks';
import { useProjectsInfinite } from './useProjectsList';

const P = '11111111-2222-3333-4444-555555555555';
const ME = '77777777-7777-7777-7777-777777777777';

vi.mock('../components/Toaster', () => ({
  toaster: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
  useToaster: () => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }),
}));

vi.mock('./useLayoutState', () => ({
  useLayoutState: () => ({ onMeMode: false, outboxMode: false }),
}));

vi.mock('./useProjectByHandle', () => ({
  useProjectByHandle: (handle: string | null) =>
    handle === null
      ? { project: null, isLoading: false, isUnresolved: false }
      : { project: { id: P, idPrefix: handle, name: 'p' }, isLoading: false, isUnresolved: false },
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

const hub = (signalr as unknown as {
  __mock: { handlers: Map<string, (payload: unknown) => void> };
}).__mock;

// ───────────────────────────── the BFF ─────────────────────────────

type Kind =
  | 'me' | 'config' | 'logout'
  | 'counts' | 'watching'
  | 'detail' | 'deps' | 'watchers' | 'comments' | 'attachments' | 'activity'
  | 'tasks' | 'projects' | 'other';

function kindOf(url: string, method: string): Kind {
  const path = url.split('?')[0];
  if (path === '/api/auth/me') return 'me';
  if (path === '/api/auth/config') return 'config';
  if (path === '/api/auth/logout' && method === 'POST') return 'logout';
  if (path === '/api/v1/me/notification-counts') return 'counts';
  if (path === '/api/v1/me/watching') return 'watching';
  if (path.endsWith('/dependencies')) return 'deps';
  if (path.endsWith('/watchers')) return 'watchers';
  if (path.endsWith('/comments')) return 'comments';
  if (path.endsWith('/attachments')) return 'attachments';
  if (path.endsWith('/activity')) return 'activity';
  if (/\/projects\/[^/]+\/issues\/[^/]+$/.test(path)) return 'detail';
  if (/\/projects\/[^/]+\/issues$/.test(path)) return 'tasks';
  if (path === '/api/v1/projects') return 'projects';
  return 'other';
}

interface Bff {
  log: Kind[];
  cookieAlive: boolean;
  /** Hold the next response of a kind until released. */
  hold: Partial<Record<Kind, Array<() => void>>>;
  holdNext: Set<Kind>;
}

let bff: Bff;

const USER = { id: ME, username: 'ann', email: 'ann@example.org', name: 'Ann', role: 'user' };

function body(kind: Kind): unknown {
  switch (kind) {
    case 'me': return USER;
    case 'config': return { authMode: 'local', logoutRedirectUrl: null, mcpUrl: null };
    case 'logout': return { redirectTo: null };
    case 'counts': return { inbox: 0, mentions: 0, watching: 0 };
    case 'watching': return { items: [], state: 'open', unreadTotal: 0 };
    case 'detail': return {
      id: 'sk-1', projectId: P, version: 1, title: 'one', description: '', type: 'task', priority: 2,
      status: 'open', pinned: false, source: 'human', design: '', acceptanceCriteria: '', notes: '',
      createdBy: ME, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', metadata: {},
      componentIds: [], labels: [], commentsCount: 0, commitRefs: [], mentions: [], isBlocked: false, blockers: [],
    };
    case 'deps': return { outgoing: [], incoming: [] };
    case 'watchers': return [];
    case 'comments': return [];
    case 'attachments': return { items: [] };
    case 'activity': return { items: [] };
    case 'tasks': return { items: [{ id: 'sk-1', projectId: P, title: 'one', status: 'open', type: 'task', priority: 2 }], total: 1, hasMore: false };
    case 'projects': return { items: [], total: 0, hasMore: false };
    default: return {};
  }
}

function stubBff(): void {
  bff = { log: [], cookieAlive: true, hold: {}, holdNext: new Set() };
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const kind = kindOf(url, init?.method ?? 'GET');
    bff.log.push(kind);
    if (kind === 'logout') bff.cookieAlive = false;
    const status = kind === 'me' && !bff.cookieAlive ? 401 : 200;
    const respond = () =>
      new Response(JSON.stringify(status === 401 ? { error: 'unauthorized' } : body(kind)), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    if (bff.holdNext.has(kind)) {
      bff.holdNext.delete(kind);
      return new Promise<Response>((resolve) => {
        (bff.hold[kind] ??= []).push(() => resolve(respond()));
      });
    }
    return respond();
  }));
}

const count = (kind: Kind, from = 0) => bff.log.slice(from).filter((k) => k === kind).length;

// ───────────────────────────── the tab ─────────────────────────────

/** The tab's router, for the navigation tests. */
const nav: { current: NavigateFunction | null } = { current: null };

function Readers() {
  nav.current = useNavigate();
  useNotificationCounts();
  useWatching('open');
  useIssueDetail({ issueId: 'sk-1', projectHandle: P });
  useTasks({
    selectedProject: 'pp',
    selectedComponent: null,
    outboxMode: false,
    onMeMode: false,
    statusFilter: 'active',
    originFilter: 'all',
    typeFilter: 'all',
    priorityFilter: 'all',
    search: '',
    sort: 'priority-updated',
    assigneeFilter: null,
  });
  useProjectsInfinite('');
  return null;
}

let hidden = false;

function setHidden(value: boolean): void {
  hidden = value;
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

async function flush(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function mountTab(): Promise<QueryClient> {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrap = (children: ReactNode) =>
    createElement(
      MantineProvider,
      null,
      createElement(
        QueryClientProvider,
        { client: qc },
        createElement(
          MemoryRouter,
          null,
          createElement(AuthProvider, null, createElement(LiveEventsProvider, null, children)),
        ),
      ),
    );
  await act(async () => {
    render(wrap(createElement(Readers)));
  });
  // Let the session, the hub and every reader settle.
  await flush(50);
  expect(hub.handlers.has('event')).toBe(true);
  return qc;
}

let seq = 1000;
function deliverEvent(fields: Record<string, unknown>): void {
  seq += 1;
  const handler = hub.handlers.get('event')!;
  act(() => handler({ id: seq, occurredAt: '2026-10-09T10:00:00Z', projectId: P, ...fields }));
}
function deliverSignal(areas: string[]): void {
  const handler = hub.handlers.get('signal')!;
  act(() => handler({ areas, sentAt: '2026-10-09T10:00:00Z' }));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  hub.handlers.clear();
  hidden = false;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => (hidden ? 'hidden' : 'visible'),
  });
  stubBff();
});

afterEach(() => {
  cleanup();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  hidden = false;
});

// ───────────────────────────── No. 80 ─────────────────────────────

describe('No. 80 — a hidden tab sends nothing; its return re-reads once', () => {
  test('N events and signals while hidden → 0 requests; return → each marked active reader once', async () => {
    await mountTab();
    setHidden(true);
    const mark = bff.log.length;

    for (let i = 0; i < 5; i += 1) {
      deliverEvent({ eventType: 'issue.status_changed', entityType: 'issue', entityId: 'sk-1' });
    }
    deliverEvent({ eventType: 'comment.created', entityType: 'comment', entityId: 'c-1', issueId: 'sk-1' });
    deliverSignal(['watching', 'inbox']);
    deliverSignal(['watching']);
    await flush(LIVE_INVALIDATION_WINDOW_MS * 5);
    expect(bff.log.slice(mark)).toEqual([]);

    setHidden(false);
    await flush(LIVE_INVALIDATION_WINDOW_MS);
    // Marked and active: one read each, however many events touched it.
    expect(count('counts', mark)).toBe(1);
    expect(count('watching', mark)).toBe(1);
    expect(count('detail', mark)).toBe(1);
    expect(count('comments', mark)).toBe(1);
    expect(count('activity', mark)).toBe(1);
    expect(count('tasks', mark)).toBe(1);
    // And then quiet.
    const after = bff.log.length;
    await flush(LIVE_INVALIDATION_WINDOW_MS * 3);
    expect(bff.log.slice(after)).toEqual([]);
  });

  test('a read begun before the event, finished while hidden, does not cover it: exactly one fresh read', async () => {
    await mountTab();
    // A counters read is in flight (slow database) …
    bff.holdNext.add('counts');
    deliverSignal(['inbox']);
    await flush(LIVE_INVALIDATION_WINDOW_MS);
    expect(bff.hold.counts).toHaveLength(1);
    const mark = bff.log.length;

    // … the tab is hidden, a new signal arrives, the old read ends.
    setHidden(true);
    deliverSignal(['inbox']);
    await flush(LIVE_INVALIDATION_WINDOW_MS);
    act(() => bff.hold.counts!.shift()!());
    await flush(LIVE_INVALIDATION_WINDOW_MS);
    expect(count('counts', mark)).toBe(0);

    // Visible again, well inside staleTime: one read, and only one.
    setHidden(false);
    await flush(LIVE_INVALIDATION_WINDOW_MS * 3);
    expect(count('counts', mark)).toBe(1);
  });

  test('return of visibility re-reads the open card: its links, its detail, its watchers', async () => {
    await mountTab();
    setHidden(true);
    const mark = bff.log.length;
    await flush(LIVE_INVALIDATION_WINDOW_MS);
    setHidden(false);
    await flush(LIVE_INVALIDATION_WINDOW_MS);
    expect(count('deps', mark)).toBe(1);
    expect(count('detail', mark)).toBe(1);
    expect(count('watchers', mark)).toBe(1);
  });

  test('focus re-reads the projects column (folded rows) and the first page of the task list', async () => {
    await mountTab();
    // Out of the coalescing window of the mount.
    await flush(LIVE_INVALIDATION_WINDOW_MS * 2);
    const mark = bff.log.length;
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await flush(LIVE_INVALIDATION_WINDOW_MS);
    expect(count('projects', mark)).toBe(1);
    expect(count('tasks', mark)).toBe(1);
    // The header counters are no class-3 data.
    expect(count('counts', mark)).toBe(0);
  });

  test('the return fires visibilitychange then focus: one read per query', async () => {
    await mountTab();
    setHidden(true);
    const mark = bff.log.length;
    setHidden(false);
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await flush(LIVE_INVALIDATION_WINDOW_MS * 2);
    expect(count('tasks', mark)).toBe(1);
    expect(count('projects', mark)).toBe(1);
  });

  test('user.deactivated about me while hidden: 0 requests; return → the logout first, no re-read', async () => {
    const qc = await mountTab();
    setHidden(true);
    const mark = bff.log.length;

    deliverEvent({ eventType: 'issue.status_changed', entityType: 'issue', entityId: 'sk-1' });
    deliverEvent({ eventType: 'user.deactivated', entityType: 'user', entityId: ME, projectId: null });
    deliverSignal(['inbox']);
    await flush(LIVE_INVALIDATION_WINDOW_MS * 2);
    expect(bff.log.slice(mark)).toEqual([]);

    setHidden(false);
    await flush(LIVE_INVALIDATION_WINDOW_MS);
    const afterReturn = bff.log.slice(mark);
    // The logout is the first request of the return …
    expect(afterReturn[0]).toBe('logout');
    // … and the session is over.
    expect(qc.getQueryData(['auth', 'me'])).toBeNull();
  });
});

// ─────────── No. 80 — what the return, focus and navigation re-read, and how ───────────

describe('No. 80 — class 3 and the obligations: shape of the re-read', () => {
  /** A mounted reader of `key` whose reads are counted (no network). */
  function mountCounter(qc: QueryClient, key: readonly unknown[]): { reads: () => number; stop: () => void } {
    let n = 0;
    qc.setQueryData(key, {});
    const observer = new QueryObserver(qc, {
      queryKey: key,
      queryFn: () => {
        n += 1;
        return Promise.resolve({});
      },
      staleTime: Infinity,
    });
    const stop = observer.subscribe(() => {});
    return { reads: () => n, stop };
  }

  /** A mounted task list with two loaded pages; records the page params it reads. */
  function mountTwoPageList(qc: QueryClient): { params: unknown[]; stop: () => void } {
    const key = ['tasks', 'project', 'q-proj', 'all', 'active', 'all', 'all', 'all', '', '', 'updated', ''];
    const params: unknown[] = [];
    qc.setQueryData(key, {
      pages: [{ items: [], hasMore: true, nextCursor: 'c2' }, { items: [], hasMore: false }],
      pageParams: [undefined, 'c2'],
    });
    const observer = new InfiniteQueryObserver(qc, {
      queryKey: key,
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (last: { hasMore: boolean; nextCursor?: string }) => (last.hasMore ? last.nextCursor : undefined),
      queryFn: ({ pageParam }: { pageParam: unknown }) => {
        params.push(pageParam);
        return Promise.resolve({ items: [], hasMore: true, nextCursor: 'c2' });
      },
      staleTime: Infinity,
    });
    const stop = observer.subscribe(() => {});
    return { params, stop };
  }

  async function settle(): Promise<void> {
    await flush(LIVE_INVALIDATION_WINDOW_MS * 2);
  }

  test('focus re-reads the task lists from the first page only (K21), the members and the active trees', async () => {
    const qc = await mountTab();
    await settle();
    const list = mountTwoPageList(qc);
    const members = mountCounter(qc, ['members', 'list', P]);
    const tree = mountCounter(qc, ['issues', 'tree', P, '__forest__', 'parent-child', '__full__', '__no_blockers__']);
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await flush(LIVE_INVALIDATION_WINDOW_MS);
    expect(list.params).toEqual([undefined]);
    expect(members.reads()).toBe(1);
    expect(tree.reads()).toBe(1);
    list.stop();
    members.stop();
    tree.stop();
  });

  test('a change of route re-reads class 3; the first render does not', async () => {
    const qc = await mountTab();
    const members = mountCounter(qc, ['members', 'list', P]);
    await settle();
    expect(members.reads()).toBe(0);
    await act(async () => {
      nav.current!('/elsewhere');
    });
    await flush(LIVE_INVALIDATION_WINDOW_MS);
    expect(members.reads()).toBe(1);
    // The query string is not a navigation (the shell keeps the open card there).
    await act(async () => {
      nav.current!('/elsewhere?issue=sk-1');
    });
    await flush(LIVE_INVALIDATION_WINDOW_MS);
    expect(members.reads()).toBe(1);
    members.stop();
  });

  test('the return walks the obligations at once, without waiting for a coalescing window', async () => {
    await mountTab();
    setHidden(true);
    deliverSignal(['inbox']);
    await flush(LIVE_INVALIDATION_WINDOW_MS);
    const mark = bff.log.length;
    setHidden(false);
    await flush(0);
    expect(count('counts', mark)).toBe(1);
  });

  test('a read delivered between two hidden events covers only the first: the return still re-reads', async () => {
    const qc = await mountTab();
    setHidden(true);
    deliverSignal(['inbox']);
    await flush(LIVE_INVALIDATION_WINDOW_MS);
    // The counters read themselves while hidden (e.g. a mutation), delivered.
    await act(async () => {
      await qc.refetchQueries({ queryKey: ['notification-counts'] });
    });
    deliverSignal(['inbox']);
    await flush(LIVE_INVALIDATION_WINDOW_MS);
    const mark = bff.log.length;
    setHidden(false);
    await flush(LIVE_INVALIDATION_WINDOW_MS);
    expect(count('counts', mark)).toBe(1);
  });

  test('an UNMOUNTED query touched while hidden is marked stale, without a request', async () => {
    const qc = await mountTab();
    qc.setQueryData(['inbox', 'assigned-to-me-unaccepted-open'], { items: [] });
    setHidden(true);
    const mark = bff.log.length;
    deliverSignal(['inbox']);
    await flush(LIVE_INVALIDATION_WINDOW_MS);
    expect(bff.log.slice(mark)).toEqual([]);
    expect(qc.getQueryState(['inbox', 'assigned-to-me-unaccepted-open'])?.isInvalidated).toBe(true);
  });

  // While the logout
  // waits for its answer, the connection reads nothing — neither the wave
  // armed before it, nor the safety net, nor the focus that follows the
  // return; the exit obligation is lifted by the end of the logout only.
  test.each<[string, boolean]>([
    ['returned to a hidden tab', true],
    ['in a visible tab', false],
  ])('the logout (%s) waits for its answer: until then no read, not even the armed wave or the safety net', async (_name, wasHidden) => {
    const qc = await mountTab();
    if (wasHidden) setHidden(true);
    const mark = bff.log.length;
    bff.holdNext.add('logout');

    // A wave is armed (the window runs) and then the deactivation arrives.
    deliverSignal(['watching']);
    deliverEvent({ eventType: 'issue.status_changed', entityType: 'issue', entityId: 'sk-1' });
    await flush(LIVE_INVALIDATION_WINDOW_MS / 3);
    deliverEvent({ eventType: 'user.deactivated', entityType: 'user', entityId: ME, projectId: null });
    if (wasHidden) {
      setHidden(false);
      act(() => { window.dispatchEvent(new Event('focus')); });
    }

    // Past the armed window and a safety-net tick, the logout still pending.
    await flush(LIVE_SAFETY_NET_MS + LIVE_INVALIDATION_WINDOW_MS * 2);
    act(() => { window.dispatchEvent(new Event('focus')); });
    await flush(LIVE_INVALIDATION_WINDOW_MS * 2);
    expect(bff.log.slice(mark)).toEqual(['logout']);

    // The logout ends: the session is over.
    act(() => { bff.hold.logout!.shift()!(); });
    await flush(LIVE_INVALIDATION_WINDOW_MS);
    expect(qc.getQueryData(['auth', 'me'])).toBeNull();
    expect(count('logout')).toBe(1);
  });

  test('a second deactivation frame while the logout waits for its answer does not log out again', async () => {
    await mountTab();
    bff.holdNext.add('logout');
    deliverEvent({ eventType: 'user.deactivated', entityType: 'user', entityId: ME, projectId: null });
    deliverEvent({ eventType: 'user.deactivated', entityType: 'user', entityId: ME, projectId: null });
    await flush(LIVE_INVALIDATION_WINDOW_MS);
    expect(count('logout')).toBe(1);
    act(() => { bff.hold.logout!.shift()!(); });
    await flush(LIVE_INVALIDATION_WINDOW_MS);
    expect(count('logout')).toBe(1);
  });

  test('the exit obligation runs once: a later return does not log out again', async () => {
    await mountTab();
    setHidden(true);
    deliverEvent({ eventType: 'user.deactivated', entityType: 'user', entityId: ME, projectId: null });
    setHidden(false);
    await flush(LIVE_INVALIDATION_WINDOW_MS);
    expect(count('logout')).toBe(1);
    setHidden(true);
    setHidden(false);
    await flush(LIVE_INVALIDATION_WINDOW_MS);
    expect(count('logout')).toBe(1);
  });

  test('after the tab is gone, visibility and focus re-read nothing', async () => {
    const qc = await mountTab();
    // Readers that outlive the provider: leaked listeners would re-read them.
    const members = mountCounter(qc, ['members', 'list', P]);
    setHidden(true);
    cleanup();
    setHidden(false);
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await flush(LIVE_INVALIDATION_WINDOW_MS * 2);
    expect(members.reads()).toBe(0);
    members.stop();
  });

  test('the first render is not a navigation: no class-3 re-read at mount', async () => {
    await mountTab();
    await settle();
    expect(count('projects')).toBe(1);
  });

  test('a read begun after the last hidden event covers it: the return re-reads nothing more', async () => {
    const qc = await mountTab();
    setHidden(true);
    deliverSignal(['inbox']);
    await flush(LIVE_INVALIDATION_WINDOW_MS);
    deliverSignal(['inbox']);
    await flush(LIVE_INVALIDATION_WINDOW_MS);
    await act(async () => {
      await qc.refetchQueries({ queryKey: ['notification-counts'] });
    });
    const mark = bff.log.length;
    setHidden(false);
    await flush(LIVE_INVALIDATION_WINDOW_MS);
    expect(count('counts', mark)).toBe(0);
  });

  test('an obligation keeps «first page only»: a new issue while hidden → one page on return', async () => {
    const qc = await mountTab();
    await settle();
    const list = mountTwoPageList(qc);
    setHidden(true);
    deliverEvent({ eventType: 'issue.created', entityType: 'issue', entityId: 'q-9', projectId: 'q-proj' });
    await flush(LIVE_INVALIDATION_WINDOW_MS);
    expect(list.params).toEqual([]);
    setHidden(false);
    await flush(LIVE_INVALIDATION_WINDOW_MS);
    expect(list.params).toEqual([undefined]);
    list.stop();
  });
});

describe('No. 80 — a navigation with no live connection', () => {
  // No signed-in user, or between two connections: the provider holds no
  // controller, and a change of route still renders `LiveNavigationRefresh`.
  test('a change of route without a controller re-reads nothing and does not break the page', async () => {
    const controller = { current: null };
    function Nav() {
      nav.current = useNavigate();
      return null;
    }
    await act(async () => {
      render(
        createElement(
          MemoryRouter,
          null,
          createElement(LiveNavigationRefresh, { controller }),
          createElement(Nav),
        ),
      );
    });
    await act(async () => {
      nav.current!('/elsewhere');
    });
    expect(controller.current).toBeNull();
  });
});
