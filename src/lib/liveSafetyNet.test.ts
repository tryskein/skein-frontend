/**
 * The 60-second safety net (spec sk-622.21 US-14, R11, R13; plan T045, K18
 * row "60 s safety net"). Test-plan row No. 82.
 *
 * The stand: `LiveEventsProvider` on a fake hub, and real readers on a
 * `fetch` stub — the real `useNotificationCounts` (not a module stub: its own
 * polling must be seen to be gone), `useWatching`, `useInbox`,
 * `useMentions`, the open card (`useIssueDetail`), the task list with the
 * «unreviewed» filter, and readers the safety net must NOT touch (a plain
 * task list, the projects column). Requests are counted on the wire; time
 * is fake.
 */
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { InfiniteQueryObserver, QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import '../i18n/config';
import { LiveEventsProvider } from '../hooks/useLiveEvents';
import { LIVE_INVALIDATION_WINDOW_MS } from './liveInvalidationBatcher';
import { LIVE_SAFETY_NET_MS } from './liveSafetyNet';
import { useNotificationCounts } from './useNotificationCounts';
import { useWatching } from './useWatching';
import { useInbox } from './useInbox';
import { useMentions } from './useMentions';
import { useIssueDetail } from './useIssueDetail';
import { useTasks } from './useTasks';
import { useProjectsInfinite } from './useProjectsList';

const P = '11111111-2222-3333-4444-555555555555';

vi.mock('../auth/AuthContext', () => {
  const auth = { user: { id: 'u-1', username: 'ann', role: 'user' }, logout: () => Promise.resolve() };
  // `useInbox` reads the identity through `useAuthOptional` (R12 snapshots).
  return { useAuth: () => auth, useAuthOptional: () => auth };
});
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
  class FakeConn {
    state = 'Disconnected';
    on = () => {};
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

type Kind =
  | 'counts' | 'watching' | 'inbox' | 'mentions'
  | 'detail' | 'deps' | 'watchers' | 'comments' | 'attachments' | 'activity'
  | 'tasks' | 'tasksUnreviewed' | 'projects' | 'other';

function kindOf(url: string): Kind {
  const [path, query = ''] = url.split('?');
  if (path === '/api/v1/me/notification-counts') return 'counts';
  if (path === '/api/v1/me/watching') return 'watching';
  if (path === '/api/v1/me/assigned-to') return 'inbox';
  if (path === '/api/v1/notifications' && query.includes('scope=mentions')) return 'mentions';
  if (path.endsWith('/dependencies')) return 'deps';
  if (path.endsWith('/watchers')) return 'watchers';
  if (path.endsWith('/comments')) return 'comments';
  if (path.endsWith('/attachments')) return 'attachments';
  if (path.endsWith('/activity')) return 'activity';
  if (/\/projects\/[^/]+\/issues\/[^/]+$/.test(path)) return 'detail';
  if (/\/projects\/[^/]+\/issues$/.test(path)) return query.includes('unreviewed') ? 'tasksUnreviewed' : 'tasks';
  if (path === '/api/v1/projects') return 'projects';
  return 'other';
}

let log: Kind[];
/** What the server answers for Watching — a test changes it without a signal. */
let watchingMarker = 'v1';

function body(kind: Kind): unknown {
  switch (kind) {
    case 'counts': return { inbox: 0, mentions: 0, watching: 3 };
    case 'watching': return { items: [{ marker: watchingMarker }], unreadTotal: 3, state: 'open', stateTotal: 1 };
    case 'inbox': return { items: [], total: 0, hasMore: false };
    case 'mentions': return { items: [], total: 0 };
    case 'detail': return {
      id: 'sk-1', projectId: P, version: 1, title: 'one', description: '', type: 'task', priority: 2,
      status: 'open', pinned: false, source: 'human', design: '', acceptanceCriteria: '', notes: '',
      createdBy: 'u-1', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', metadata: {},
      componentIds: [], labels: [], commentsCount: 0, commitRefs: [], mentions: [], isBlocked: false, blockers: [],
    };
    case 'deps': return { outgoing: [], incoming: [] };
    case 'watchers': return [];
    case 'comments': return [];
    case 'attachments': return { items: [] };
    case 'activity': return { items: [] };
    case 'tasks':
    case 'tasksUnreviewed': return { items: [], total: 0, hasMore: false };
    case 'projects': return { items: [], total: 0, hasMore: false };
    default: return {};
  }
}

const filters = (statusFilter: 'active' | 'unreviewed') => ({
  selectedProject: 'pp',
  selectedComponent: null,
  outboxMode: statusFilter === 'unreviewed',
  onMeMode: false,
  statusFilter,
  originFilter: 'all' as const,
  typeFilter: 'all' as const,
  priorityFilter: 'all' as const,
  search: '',
  sort: 'priority-updated' as const,
  assigneeFilter: null,
});

function Readers() {
  useNotificationCounts();
  useWatching('open');
  useInbox();
  useMentions();
  useIssueDetail({ issueId: 'sk-1', projectHandle: P });
  useTasks(filters('unreviewed'));
  useTasks(filters('active'));
  useProjectsInfinite('');
  return null;
}

let qc: QueryClient;
let hidden = false;

async function mountTab(): Promise<void> {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    render(
      createElement(MantineProvider, null,
        createElement(QueryClientProvider, { client: qc },
          createElement(MemoryRouter, null,
            createElement(LiveEventsProvider, null, createElement(Readers))))),
    );
  });
  await advance(50);
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const count = (kind: Kind, from: number) => log.slice(from).filter((k) => k === kind).length;

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  log = [];
  watchingMarker = 'v1';
  hidden = false;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    const kind = kindOf(url);
    log.push(kind);
    return new Response(JSON.stringify(body(kind)), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
});

afterEach(() => {
  cleanup();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  hidden = false;
});

describe('No. 82 — the 60 s safety net of a visible tab', () => {
  test('the stand mounts every reader (each was read once)', async () => {
    await mountTab();
    for (const k of ['counts', 'watching', 'inbox', 'mentions', 'detail', 'tasks', 'tasksUnreviewed', 'projects'] as Kind[]) {
      expect(count(k, 0), k).toBeGreaterThan(0);
    }
  });

  test('no signal: nothing at 30 s (the counters no longer poll); at 60 s exactly the keys of the row', async () => {
    await mountTab();
    const mark = log.length;

    await advance(30_000);
    expect(log.slice(mark)).toEqual([]);

    await advance(LIVE_SAFETY_NET_MS - 30_000 - 50 + LIVE_INVALIDATION_WINDOW_MS);
    expect(count('counts', mark)).toBe(1);
    expect(count('watching', mark)).toBe(1);
    expect(count('inbox', mark)).toBe(1);
    expect(count('mentions', mark)).toBe(1);
    expect(count('detail', mark)).toBe(1);
    expect(count('tasksUnreviewed', mark)).toBe(1);
    // Nothing else.
    for (const k of ['deps', 'watchers', 'comments', 'attachments', 'activity', 'tasks', 'projects', 'other'] as Kind[]) {
      expect(count(k, mark), k).toBe(0);
    }
  });

  test('a lost Watching signal with an unchanged badge: the visible column converges within 60 s', async () => {
    await mountTab();
    const column = () =>
      (qc.getQueryData(['watching', 'feed', 'open']) as { items: Array<{ marker: string }> }).items[0].marker;
    expect(column()).toBe('v1');

    // The column changed on the server; the signal was lost; the badge is the same.
    watchingMarker = 'v2';
    await advance(LIVE_SAFETY_NET_MS - 50 - 1);
    expect(column()).toBe('v1');
    await advance(1 + LIVE_INVALIDATION_WINDOW_MS);
    expect(column()).toBe('v2');
  });

  test('a hidden tab: the tick only leaves obligations — 0 requests', async () => {
    await mountTab();
    hidden = true;
    const mark = log.length;
    await advance(LIVE_SAFETY_NET_MS * 2 + LIVE_INVALIDATION_WINDOW_MS);
    expect(log.slice(mark)).toEqual([]);
  });
});

describe('No. 82 — the shape of the tick', () => {
  test('the «unreviewed» list is re-read from its first page only (K21)', async () => {
    await mountTab();
    const key = ['tasks', 'me', 'created-by', 'unreviewed', 'all', 'all', 'all', '', 'updated'];
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
    await advance(LIVE_SAFETY_NET_MS + LIVE_INVALIDATION_WINDOW_MS);
    expect(params).toEqual([undefined]);
    stop();
  });

  test('the tab gone, the safety net stops', async () => {
    await mountTab();
    // A reader that outlives the provider: a leaked interval would re-read it.
    let reads = 0;
    const observer = new QueryObserver(qc, {
      queryKey: ['notification-counts'],
      queryFn: () => {
        reads += 1;
        return Promise.resolve({});
      },
      staleTime: Infinity,
    });
    const stop = observer.subscribe(() => {});
    cleanup();
    await advance(LIVE_SAFETY_NET_MS * 2 + LIVE_INVALIDATION_WINDOW_MS);
    expect(reads).toBe(0);
    stop();
  });
});
