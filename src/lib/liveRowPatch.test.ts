/**
 * Phase 2 — the event's neutral row and its freshness order (spec sk-622.21
 * US-15, INV-14, D7, edge 13; plan T049, K16, K17). Test-plan rows No. 87, No. 89.
 *
 * Everything goes through the provider on a fake hub: envelopes are handed
 * to its `event` handler exactly as SignalR would, so dedup, the router and
 * the coalescing batcher are the app's own. The tab's readers are query
 * observers over a seeded cache; their reads are counted, and what the tab
 * shows is read off the `QueryClient` — never off the module's internals.
 *
 * Expected values come from the spec and from literal REST answers written
 * here by hand: the row a REST read would give the reader (with `iAssigned`
 * by the server rule `issues/store.go#ListIssues`), never from the code
 * under test.
 *
 * Known boundary: the Tasks column has no label filter today
 * (`useTasks.ts#cacheKey` carries none), so "the composition of a list filtered by
 * label" has no surface to observe; the label part is proven on the row of
 * a list (adds and removes by another actor, replay and reordered delivery).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { createElement } from 'react';
import {
  InfiniteQueryObserver,
  QueryClient,
  QueryClientProvider,
  QueryObserver,
  type InfiniteData,
} from '@tanstack/react-query';
import * as signalr from '@microsoft/signalr';
import { LiveEventsProvider } from '../hooks/useLiveEvents';
import { useDeclareProjects } from './liveProjectDeclaration';
import { LIVE_INVALIDATION_WINDOW_MS } from './liveInvalidationBatcher';
import type { EventEnvelope } from './eventEnvelope';
import type { IssueSummary } from '../api/issues';
import { compareServerOrder, MAX_TRACKED_ISSUES } from './liveRowPatch';

const auth = vi.hoisted(() => ({ user: { id: 'u-1', username: 'ann', role: 'user' } }));
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ user: auth.user, logout: () => Promise.resolve() }),
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
    invoke = vi.fn((_m: string, ids: unknown) =>
      Promise.resolve({ accepted: Array.isArray(ids) ? ids : [], rejected: [] }));
    stop = vi.fn(() => { this.state = HubConnectionState.Disconnected; return Promise.resolve(); });
    start = vi.fn(() => { this.state = HubConnectionState.Connected; return Promise.resolve(); });
  }
  class HubConnectionBuilder {
    withUrl() { return this; }
    withAutomaticReconnect() { return this; }
    configureLogging() { return this; }
    build() { return new FakeConn(); }
  }
  return { HubConnectionBuilder, HubConnectionState, LogLevel, __mock: registry };
});

const hub = (signalr as unknown as { __mock: { handlers: Map<string, (payload: unknown) => void> } }).__mock;

const P = '11111111-2222-3333-4444-555555555555';
const ME = 'u-1';

interface Page {
  items: IssueSummary[];
  total?: number;
  hasMore: boolean;
  nextCursor?: string | null;
}

/** A project list key as `useTasks.ts#cacheKey` builds it. */
function projectListKey(over: { status?: string; priority?: string; sort?: string } = {}): readonly unknown[] {
  return ['tasks', 'project', P, 'all', over.status ?? 'all', 'all', 'all', over.priority ?? 'all', '', '', over.sort ?? 'updated', ''];
}

function ts(n: number): string {
  return `2026-10-01T10:00:${String(n).padStart(2, '0')}.000001Z`;
}

/** A list row as REST returns it to reader u-1. */
function summary(id: string, over: Partial<IssueSummary> = {}): IssueSummary {
  return {
    id,
    projectId: P,
    version: 3,
    title: id,
    type: 'task',
    priority: 2,
    status: 'open',
    pinned: false,
    createdBy: 'u-2',
    componentIds: [],
    labels: [],
    isBlocked: false,
    updatedAt: ts(1),
    createdAt: ts(0),
    rowSeq: 40,
    ...over,
  };
}

/** A neutral event row (skein-api `issues.NeutralRow`): no reader fields. */
function eventRow(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    projectId: P,
    version: 3,
    title: id,
    type: 'task',
    priority: 2,
    status: 'open',
    pinned: false,
    createdBy: 'u-2',
    componentIds: [],
    labels: [],
    updatedAt: ts(1),
    createdAt: ts(0),
    rowSeq: 41,
    ...over,
  };
}

let nextEnvelopeId = 1;
function envelope(eventType: string, entityId: string, extra: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    id: nextEnvelopeId++,
    occurredAt: '2026-10-01T10:01:00Z',
    eventType,
    entityType: eventType.startsWith('dependency.') ? 'dependency' : 'issue',
    entityId,
    projectId: P,
    actor: 'bob',
    actorType: 'human',
    actorUserId: 'u-2',
    entityTitle: entityId,
    projectIdPrefix: 'sk',
    ...extra,
  };
}

let qc: QueryClient;
let reads: Map<string, number>;
let unsubscribers: Array<() => void>;
/** What the fake server answers the next read of a list, by list name. */
let server: Map<string, Page>;

function readsOf(name: string): number {
  return reads.get(name) ?? 0;
}

function seedList(name: string, key: readonly unknown[], pages: Page[]): void {
  qc.setQueryData<InfiniteData<Page>>(key, { pages, pageParams: pages.map((_, i) => (i === 0 ? undefined : `c${i}`)) });
  server.set(name, pages[0]);
  const observer = new InfiniteQueryObserver<Page, Error, InfiniteData<Page>, readonly unknown[], string | undefined>(qc, {
    queryKey: key,
    queryFn: () => {
      reads.set(name, readsOf(name) + 1);
      return Promise.resolve(server.get(name)!);
    },
    initialPageParam: undefined,
    getNextPageParam: (last) => (last.hasMore ? last.nextCursor ?? undefined : undefined),
    staleTime: Infinity,
  });
  unsubscribers.push(observer.subscribe(() => {}));
}

function seedReader(name: string, key: readonly unknown[], data: unknown): void {
  qc.setQueryData(key, data);
  const observer = new QueryObserver(qc, {
    queryKey: key,
    queryFn: () => {
      reads.set(name, readsOf(name) + 1);
      return Promise.resolve(data);
    },
    staleTime: Infinity,
  });
  unsubscribers.push(observer.subscribe(() => {}));
}

function rowsOf(key: readonly unknown[]): IssueSummary[] {
  const data = qc.getQueryData<InfiniteData<Page>>(key);
  return data ? data.pages.flatMap((p) => p.items) : [];
}

function rowOf(key: readonly unknown[], id: string): IssueSummary | undefined {
  return rowsOf(key).find((r) => r.id === id);
}

function DeclareRoute() {
  useDeclareProjects('route', [P]);
  return null;
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function tab() {
  return createElement(
    QueryClientProvider,
    { client: qc },
    createElement(LiveEventsProvider, null, createElement(DeclareRoute)),
  );
}

let rerenderTab: (() => void) | null = null;

async function mountTab(): Promise<void> {
  await act(async () => {
    const r = render(tab());
    rerenderTab = () => r.rerender(tab());
  });
  await advance(1_000);
  reads = new Map();
}

/** Hand one envelope to the provider and let the batcher's wave run. */
async function deliver(env: EventEnvelope): Promise<void> {
  act(() => hub.handlers.get('event')!(env));
  await advance(LIVE_INVALIDATION_WINDOW_MS + 200);
}

beforeEach(() => {
  auth.user = { id: 'u-1', username: 'ann', role: 'user' };
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  hub.handlers.clear();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  reads = new Map();
  unsubscribers = [];
  server = new Map();
});

afterEach(() => {
  unsubscribers.forEach((u) => u());
  cleanup();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ─────────────────────────────── No. 87 ────────────────────────────────

describe('No. 87 — the row is laid in by its freshness order, per issue', () => {
  test('a title change that keeps membership and order sends no list request', async () => {
    const L = projectListKey();
    seedList('L', L, [{ items: [summary('sk-2', { updatedAt: ts(5) }), summary('sk-1', { updatedAt: ts(3) })], hasMore: false }]);
    await mountTab();

    await deliver(envelope('issue.updated', 'sk-2', {
      changedFields: ['title'],
      row: eventRow('sk-2', { title: 'renamed', version: 4, updatedAt: ts(6), rowSeq: 41 }),
    }));

    expect(readsOf('L')).toBe(0);
    expect(rowsOf(L).map((r) => [r.id, r.title])).toEqual([['sk-2', 'renamed'], ['sk-1', 'sk-1']]);
  });

  // Two writes by another actor that move neither `version` nor
  // `updatedAt` apart (one microsecond, the same version): only `rowSeq`
  // tells them apart.
  const added = (id: number) => envelope('issue.label_added', 'sk-1', {
    id,
    row: eventRow('sk-1', { labels: ['old', 'x'], updatedAt: ts(7), rowSeq: 41 }),
  });
  const removed = (id: number) => envelope('issue.label_removed', 'sk-1', {
    id,
    row: eventRow('sk-1', { labels: ['x'], updatedAt: ts(7), rowSeq: 42 }),
  });

  test.each([
    ['in commit order', [added, removed]],
    ['reordered (removal first)', [removed, added]],
  ] as const)('label added then removed by another actor, delivered %s → the later state, no request', async (_name, order) => {
    const L = projectListKey();
    seedList('L', L, [{ items: [summary('sk-1', { labels: ['old'], updatedAt: ts(2) })], hasMore: false }]);
    await mountTab();

    const envs = [order[0](9001), order[1](9002)];
    for (const env of envs) await deliver(env);
    expect(rowOf(L, 'sk-1')?.labels).toEqual(['x']);

    // A replay of either envelope (same id) brings nothing back.
    await deliver(envs[0]);
    await deliver(envs[1]);
    expect(rowOf(L, 'sk-1')?.labels).toEqual(['x']);
    expect(readsOf('L')).toBe(0);
  });

  test('«close B → rename B» delivered rename first: B is not rolled back, the close still unblocks, moves the epic and the activity; a replay does nothing', async () => {
    // B's own list, the list where A (blocked by B) is shown, the list where
    // B's epic E is shown — split by priority so each read is seen apart.
    const LB = projectListKey({ priority: '2' });
    const LA = projectListKey({ priority: '1' });
    const LE = projectListKey({ priority: '0' });
    seedList('LB', LB, [{ items: [summary('sk-5.1', { parentIdCurrent: 'sk-5', updatedAt: ts(2) })], hasMore: false }]);
    seedList('LA', LA, [{ items: [summary('sk-9', { priority: 1, isBlocked: true })], hasMore: false }]);
    seedList('LE', LE, [{
      items: [summary('sk-5', { priority: 0, type: 'epic', epicProgress: { closed: 0, total: 2 } })],
      hasMore: false,
    }]);
    seedReader('activity', ['activity', 'issue', P, 'sk-5.1'], { items: [] });
    await mountTab();

    // Commit order: close (rowSeq 50), then rename (rowSeq 51). Delivery:
    // the rename first — its row already shows the closed state.
    await deliver(envelope('issue.updated', 'sk-5.1', {
      changedFields: ['title'],
      row: eventRow('sk-5.1', {
        title: 'B renamed', status: 'closed', closeOutcome: 'done', parentIdCurrent: 'sk-5', updatedAt: ts(9), rowSeq: 51,
      }),
    }));
    expect(rowOf(LB, 'sk-5.1')).toMatchObject({ title: 'B renamed', status: 'closed' });
    reads = new Map();

    const close = envelope('issue.closed', 'sk-5.1', {
      row: eventRow('sk-5.1', { status: 'closed', closeOutcome: 'done', parentIdCurrent: 'sk-5', updatedAt: ts(8), rowSeq: 50 }),
    });
    await deliver(close);

    // The stale row changes nothing and is read for nothing …
    expect(rowOf(LB, 'sk-5.1')).toMatchObject({ title: 'B renamed', status: 'closed' });
    expect(readsOf('LB')).toBe(0);
    // … while the other reactions of a close stay: the blocked row, the
    // epic's progress and the activity are re-read.
    expect(readsOf('LA')).toBe(1);
    expect(readsOf('LE')).toBe(1);
    expect(readsOf('activity')).toBe(1);

    reads = new Map();
    await deliver(close);
    expect([...reads.values()].reduce((a, b) => a + b, 0)).toBe(0);
  });

  test('a row not fresher than the shown one changes nothing and is read for nothing, though first received', async () => {
    const L = projectListKey();
    seedList('L', L, [{ items: [summary('sk-1', { title: 'shown', rowSeq: 60, updatedAt: ts(2) })], hasMore: false }]);
    seedReader('activity', ['activity', 'issue', P, 'sk-1'], { items: [] });
    seedReader('tree', ['issues', 'tree', P, '__forest__', '', '__full__', '__no_blockers__'], {
      // An older copy: the list alone shows 60.
      rows: [{ item: summary('sk-1', { title: 'shown', rowSeq: 30 }), depth: 0, isReference: false }],
      requestedAt: 1,
    });
    await mountTab();

    await deliver(envelope('issue.updated', 'sk-1', {
      changedFields: ['title'],
      row: eventRow('sk-1', { title: 'older', updatedAt: ts(5), rowSeq: 50 }),
    }));

    expect(rowOf(L, 'sk-1')?.title).toBe('shown');
    expect(readsOf('L')).toBe(0);
    expect(readsOf('tree')).toBe(0);
    // Its other reaction stays: the issue's activity.
    expect(readsOf('activity')).toBe(1);
  });

  // R26: rows not written since the phase-2 rollout carry rowSeq 0 — «order
  // unknown»; a shown row without the key (the Ready surface) is the same.
  test('a shown row with rowSeq 0 or without the key takes any event row with a positive order', async () => {
    const L = projectListKey();
    const { rowSeq: _drop, ...noKey } = summary('sk-2', { updatedAt: ts(1) });
    seedList('L', L, [{ items: [summary('sk-1', { rowSeq: 0, updatedAt: ts(2) }), noKey as IssueSummary], hasMore: false }]);
    await mountTab();

    await deliver(envelope('issue.updated', 'sk-1', {
      changedFields: ['title'], row: eventRow('sk-1', { title: 'one', updatedAt: ts(5), rowSeq: 1 }),
    }));
    await deliver(envelope('issue.updated', 'sk-2', {
      changedFields: ['title'], row: eventRow('sk-2', { title: 'two', updatedAt: ts(6), rowSeq: 1 }),
    }));

    expect(rowsOf(L).map((r) => r.title)).toEqual(['two', 'one']);
    expect(readsOf('L')).toBe(0);
  });

  test('an event row with rowSeq 0 is not fresher than a shown 0: nothing laid in, nothing read for it', async () => {
    const L = projectListKey();
    seedList('L', L, [{ items: [summary('sk-1', { rowSeq: 0, updatedAt: ts(2) })], hasMore: false }]);
    await mountTab();

    await deliver(envelope('issue.updated', 'sk-1', {
      changedFields: ['title'], row: eventRow('sk-1', { title: 'unknown order', updatedAt: ts(5), rowSeq: 0 }),
    }));

    expect(rowOf(L, 'sk-1')?.title).toBe('sk-1');
    expect(readsOf('L')).toBe(0);
  });

  test('the order is per issue: A at 100 through the handler, then B at 50 applies and B at 45 does not', async () => {
    const L = projectListKey();
    seedList('L', L, [{
      items: [summary('sk-1', { rowSeq: 40, updatedAt: ts(2) }), summary('sk-2', { rowSeq: 40, updatedAt: ts(1) })],
      hasMore: false,
    }]);
    await mountTab();

    await deliver(envelope('issue.updated', 'sk-1', {
      changedFields: ['title'],
      row: eventRow('sk-1', { title: 'A100', updatedAt: ts(5), rowSeq: 100 }),
    }));
    expect(rowOf(L, 'sk-1')?.title).toBe('A100');

    await deliver(envelope('issue.updated', 'sk-2', {
      changedFields: ['title'],
      row: eventRow('sk-2', { title: 'B50', updatedAt: ts(6), rowSeq: 50 }),
    }));
    expect(rowOf(L, 'sk-2')?.title).toBe('B50');

    await deliver(envelope('issue.updated', 'sk-2', {
      changedFields: ['title'],
      row: eventRow('sk-2', { title: 'B45', updatedAt: ts(7), rowSeq: 45 }),
    }));
    expect(rowOf(L, 'sk-2')?.title).toBe('B50');
    expect(readsOf('L')).toBe(0);
  });

  test('the order is per issue: a cache seeded with A = 100 and B = 40 takes B at 50', async () => {
    const L = projectListKey();
    seedList('L', L, [{
      items: [summary('sk-1', { rowSeq: 100, updatedAt: ts(2) }), summary('sk-2', { rowSeq: 40, updatedAt: ts(1) })],
      hasMore: false,
    }]);
    await mountTab();

    await deliver(envelope('issue.updated', 'sk-2', {
      changedFields: ['title'],
      row: eventRow('sk-2', { title: 'B50', updatedAt: ts(6), rowSeq: 50 }),
    }));
    expect(rowOf(L, 'sk-2')?.title).toBe('B50');
  });
});

describe('No. 87 — a stale row still re-reads the lists whose filter a row cannot answer', () => {
  // US-15 keeps the
  // other reactions of the matrix row for a stale row, «lists with filters
  // a row cannot answer» among them. A fresher card says nothing about what
  // a filtered answer holds.
  test.each<[string, Partial<EventEnvelope>, string]>([
    ['a title', { changedFields: ['title'] }, 'issue.updated'],
    ['the pin', {}, 'issue.pinned'],
  ])('%s, first received, older than the card', async (_n, extra, type) => {
    const BY_SOURCE = ['tasks', 'project', P, 'all', 'all', 'human', 'all', 'all', '', '', 'updated', ''];
    const PLAIN = projectListKey();
    seedList('S', BY_SOURCE, [{ items: [summary('sk-1', { title: 'old', rowSeq: 40, updatedAt: ts(2) })], hasMore: false }]);
    seedList('L', PLAIN, [{ items: [summary('sk-1', { title: 'old', rowSeq: 40, updatedAt: ts(2) })], hasMore: false }]);
    seedReader('card', ['issues', 'detail', 'sk-1'], { ...summary('sk-1', { title: 'newest', rowSeq: 60, updatedAt: ts(8) }), description: '' });
    await mountTab();

    await deliver(envelope(type, 'sk-1', {
      ...extra,
      row: eventRow('sk-1', { title: 'mid', pinned: type === 'issue.pinned', updatedAt: ts(5), rowSeq: 50 }),
    }));

    expect(readsOf('S')).toBe(1);
    expect(readsOf('L')).toBe(0);
    expect(rowOf(PLAIN, 'sk-1')?.title).toBe('old');
  });
});

describe('No. 87 — a stale row: which opaque lists it reaches', () => {
  const CARD60 = () => seedReader('card', ['issues', 'detail', 'sk-1'], {
    ...summary('sk-1', { title: 'newest', rowSeq: 60, updatedAt: ts(8) }), description: '',
  });
  const stale = () => envelope('issue.updated', 'sk-1', {
    changedFields: ['title'], row: eventRow('sk-1', { title: 'mid', updatedAt: ts(5), rowSeq: 50 }),
  });
  const ALL_BY_SOURCE = ['tasks', 'all', 'cross-project', 'all', 'human', 'all', 'all', '', 'updated', ''];
  const DELEGATED = ['tasks', 'me', 'created-by', 'all', 'all', 'all', 'all', '', 'updated'];

  test('a project list with a source filter, not showing the issue: re-read', async () => {
    seedList('S', ['tasks', 'project', P, 'all', 'all', 'human', 'all', 'all', '', '', 'updated', ''], [{ items: [summary('sk-7', { updatedAt: ts(2) })], hasMore: false }]);
    CARD60();
    await mountTab();
    await deliver(stale());
    expect(readsOf('S')).toBe(1);
  });

  test('«All projects» with a source filter, not showing the issue: re-read', async () => {
    seedList('A', ALL_BY_SOURCE, [{ items: [summary('sk-7', { updatedAt: ts(2) })], hasMore: false }]);
    CARD60();
    await mountTab();
    await deliver(stale());
    expect(readsOf('A')).toBe(1);
  });

  test.each([
    ['showing the issue: re-read', true, 1],
    ['not showing it: left (membership follows the `tasks` signal)', false, 0],
  ] as const)('the delegated lens over all projects, %s', async (_n, shows, expected) => {
    const delegated = (id: string, n: number) => summary(id, { createdBy: ME, assignee: 'bob', assigneeUserId: 'u-2', rowSeq: 40, updatedAt: ts(n) });
    seedList('D', DELEGATED, [
      { items: [delegated('sk-6', 4), ...(shows ? [delegated('sk-1', 3)] : [])], hasMore: true, nextCursor: 'c1' },
      { items: [delegated('sk-7', 2)], hasMore: false },
    ]);
    CARD60();
    await mountTab();
    await deliver(stale());
    expect(readsOf('D')).toBe(expected);
  });
});

describe('No. 87 — every surface showing the issue takes the row; what shows it counts as «shown»', () => {
  const TREE = ['issues', 'tree', P, '__forest__', '', '__full__', '__blockers__'] as const;
  const BACKFILL = ['tasks', 'ancestors', 'seed-1'] as const;

  function treeNode(item: IssueSummary, blockers?: Array<{ id: string; title: string; status: string; projectId: string }>) {
    return { item, depth: 0, isReference: false, ...(blockers ? { blockers } : {}) };
  }

  test('a column tree (node and blocker entry) and an ancestor backfill take the row without a request', async () => {
    seedReader('tree', TREE, {
      rows: [
        treeNode(summary('sk-1', { updatedAt: ts(2) })),
        treeNode(summary('sk-9', { isBlocked: true }), [{ id: 'sk-1', title: 'sk-1', status: 'open', projectId: P }]),
        // A legacy redacted entry carrying the id is never given a title.
        { ...treeNode(summary('sk-10', { isBlocked: true })), blockers: [{ redacted: true, id: 'sk-1' }] },
        // A stub of an issue outside the horizon is never written.
        treeNode({ ...summary('sk-1'), status: '' } as unknown as IssueSummary),
      ],
      requestedAt: 1,
    });
    seedReader('backfill', BACKFILL, [summary('sk-1', { updatedAt: ts(2) }), summary('sk-7')]);
    await mountTab();

    await deliver(envelope('issue.updated', 'sk-1', {
      changedFields: ['title'],
      row: eventRow('sk-1', { title: 'renamed', updatedAt: ts(5), rowSeq: 41 }),
    }));

    const tree = qc.getQueryData<{ rows: Array<{ item: IssueSummary; blockers?: Array<{ title: string }> }>; requestedAt: number }>(TREE)!;
    expect(tree.rows[0].item.title).toBe('renamed');
    expect(tree.rows[1].item.title).toBe('sk-9');
    expect(tree.rows[1].blockers?.[0].title).toBe('renamed');
    expect(tree.rows[2].blockers).toEqual([{ redacted: true, id: 'sk-1' }]);
    expect(tree.rows[3].item.title).toBe('sk-1');
    expect(tree.requestedAt).toBe(1);
    expect(qc.getQueryData<IssueSummary[]>(BACKFILL)!.map((r) => r.title)).toEqual(['renamed', 'sk-7']);
    expect(readsOf('tree')).toBe(0);
    expect(readsOf('backfill')).toBe(0);
  });

  test.each([
    ['a tree node', 'tree'],
    ['an ancestor backfill', 'backfill'],
    ['the open card', 'card'],
  ] as const)('%s showing rowSeq 60 makes a first-received row at 50 stale for the list too', async (_n, where) => {
    const L = projectListKey();
    seedList('L', L, [{ items: [summary('sk-1', { title: 'shown', rowSeq: 40, updatedAt: ts(2) })], hasMore: false }]);
    if (where === 'tree') seedReader('other', TREE, { rows: [treeNode(summary('sk-1', { rowSeq: 60 }))], requestedAt: 1 });
    if (where === 'backfill') seedReader('other', BACKFILL, [summary('sk-1', { rowSeq: 60 })]);
    if (where === 'card') seedReader('other', ['issues', 'detail', 'sk-1'], { ...summary('sk-1', { rowSeq: 60 }), description: '' });
    await mountTab();

    await deliver(envelope('issue.updated', 'sk-1', {
      changedFields: ['title'],
      row: eventRow('sk-1', { title: 'older', updatedAt: ts(5), rowSeq: 50 }),
    }));

    expect(rowOf(L, 'sk-1')?.title).toBe('shown');
  });

  test.each([
    ['a title edit', 'issue.updated', ['title']],
    ['a status change', 'issue.status_changed', undefined],
    ['a commit attach', 'issue.commits_attached', undefined],
  ] as const)('%s while the tree is being read: the patch is laid AND the tree is re-read after that read', async (_n, type, changedFields) => {
    let release: (() => void) | null = null;
    let treeReads = 0;
    qc.setQueryData(TREE, { rows: [treeNode(summary('sk-1', { updatedAt: ts(2) }))], requestedAt: 1 });
    const observer = new QueryObserver(qc, {
      queryKey: TREE,
      queryFn: () => {
        treeReads += 1;
        // The read started before the commit answers the OLD row.
        return new Promise((resolve) => {
          release = () => resolve({ rows: [treeNode(summary('sk-1', { updatedAt: ts(2) }))], requestedAt: 2 });
        });
      },
      staleTime: Infinity,
    });
    unsubscribers.push(observer.subscribe(() => {}));
    await mountTab();
    void act(() => { void qc.refetchQueries({ queryKey: TREE }); });
    expect(treeReads).toBe(1);

    await deliver(envelope(type, 'sk-1', {
      changedFields: changedFields ? [...changedFields] : undefined,
      row: eventRow('sk-1', { title: 'renamed', updatedAt: ts(5), rowSeq: 41 }),
    }));
    await act(async () => { release!(); });
    await advance(LIVE_INVALIDATION_WINDOW_MS + 200);

    expect(treeReads).toBe(2);
  });
});

describe('No. 87 — a list or card being read when the row arrives is patched and re-read after that read', () => {
  test.each([
    ['a task list', 'list'],
    ['«All projects»', 'allList'],
    ['the open card', 'card'],
    ['an ancestor backfill', 'backfill'],
  ] as const)('%s', async (_n, which) => {
    const key = which === 'list' ? projectListKey() : which === 'card' ? ['issues', 'detail', 'sk-1'] : ['tasks', 'ancestors', 'seed'];
    const shown = summary('sk-1', { updatedAt: ts(2) });
    const data = which === 'list'
      ? { pages: [{ items: [shown], hasMore: false }], pageParams: [undefined] }
      : which === 'card' ? { ...shown, description: '' } : [shown];
    // A reader the event has nothing to do with.
    seedReader('other', ['issues', 'detail', 'sk-77'], { ...summary('sk-77'), description: '' });
    let release: (() => void) | null = null;
    let n = 0;
    qc.setQueryData(key, data);
    const observer = which === 'list'
      ? new InfiniteQueryObserver<Page, Error, InfiniteData<Page>, readonly unknown[], string | undefined>(qc, {
        queryKey: key,
        queryFn: () => { n += 1; return new Promise<Page>((r) => { release = () => r({ items: [shown], hasMore: false }); }); },
        initialPageParam: undefined,
        getNextPageParam: () => undefined,
        staleTime: Infinity,
      })
      : new QueryObserver(qc, {
        queryKey: key,
        queryFn: () => { n += 1; return new Promise((r) => { release = () => r(which === 'card' ? { ...shown, description: '' } : [shown]); }); },
        staleTime: Infinity,
      });
    unsubscribers.push(observer.subscribe(() => {}));
    await mountTab();
    void act(() => { void qc.refetchQueries({ queryKey: key }); });
    expect(n).toBe(1);

    await deliver(envelope('issue.updated', 'sk-1', {
      changedFields: ['title'],
      row: eventRow('sk-1', { title: 'renamed', updatedAt: ts(5), rowSeq: 41 }),
    }));
    await act(async () => { release!(); });
    await advance(LIVE_INVALIDATION_WINDOW_MS + 200);

    expect(n).toBe(2);
    expect(readsOf('other')).toBe(0);
  });

  test('a list of two pages keeps both through the re-read after a read in flight', async () => {
    // The set did not move,
    // only the read in flight could overwrite the patch — the scrolled-in
    // tail stays.
    const L = projectListKey();
    const p1 = (title: string): Page => ({ items: [summary('sk-1', { title, updatedAt: ts(5) })], hasMore: true, nextCursor: 'c1' });
    const p2: Page = { items: [summary('sk-2', { updatedAt: ts(1) })], hasMore: false, nextCursor: null };
    qc.setQueryData<InfiniteData<Page>>(L, { pages: [p1('old'), p2], pageParams: [undefined, 'c1'] });
    let firstPage = p1('old');
    let hold: (() => void) | null = null;
    const observer = new InfiniteQueryObserver<Page, Error, InfiniteData<Page>, readonly unknown[], string | undefined>(qc, {
      queryKey: L,
      queryFn: ({ pageParam }) => {
        if (pageParam === 'c1') return Promise.resolve(p2);
        const answer = firstPage;
        if (hold === null) return Promise.resolve(answer);
        return new Promise<Page>((r) => { const go = hold!; hold = () => { go(); r(answer); }; });
      },
      initialPageParam: undefined,
      getNextPageParam: (last) => (last.hasMore ? last.nextCursor ?? undefined : undefined),
      staleTime: Infinity,
    });
    unsubscribers.push(observer.subscribe(() => {}));
    await mountTab();
    // A read of every page starts before the commit.
    hold = () => {};
    void act(() => { void observer.refetch(); });

    firstPage = p1('renamed');
    await deliver(envelope('issue.updated', 'sk-1', {
      changedFields: ['title'], row: eventRow('sk-1', { title: 'renamed', updatedAt: ts(6), rowSeq: 41 }),
    }));
    const release = hold;
    hold = null;
    await act(async () => { release(); });
    await advance(LIVE_INVALIDATION_WINDOW_MS + 200);

    expect(rowsOf(L).map((r) => [r.id, r.title])).toEqual([['sk-1', 'renamed'], ['sk-2', 'sk-2']]);
    expect(qc.getQueryData<InfiniteData<Page>>(L)?.pages).toHaveLength(2);
  });

  test('a tree not showing the issue is left as it is', async () => {
    const L = projectListKey();
    seedList('L', L, [{ items: [summary('sk-1', { updatedAt: ts(2) })], hasMore: false }]);
    const otherTree = { rows: [{ item: summary('sk-5'), depth: 0, isReference: false }], requestedAt: 1 };
    seedReader('tree', ['issues', 'tree', P, 'sk-5', '', '__full__', '__no_blockers__'], otherTree);
    await mountTab();

    await deliver(envelope('issue.updated', 'sk-1', {
      changedFields: ['title'], row: eventRow('sk-1', { title: 'renamed', updatedAt: ts(5), rowSeq: 41 }),
    }));

    expect(rowOf(L, 'sk-1')?.title).toBe('renamed');
    expect(qc.getQueryData(['issues', 'tree', P, 'sk-5', '', '__full__', '__no_blockers__'])).toEqual(otherTree);
    expect(readsOf('tree')).toBe(0);
  });
});

describe('No. 87 — a reader whose first read is out when the row arrives is re-read after that read', () => {
  // nothing is cached yet, so there is nothing to patch; the read may have
  // started before the commit and lands the older state. US-13: the event
  // shows once that read returned — one more read, carrying the new state.
  const CARD = ['issues', 'detail', 'sk-1'];
  const SECTION = ['issues', 'tree', '__cross__', 'sk-5', '', '__full__', '__blockers__'];
  const COLUMN_TREE = ['issues', 'tree', P, '', '', '__full__', '__no_blockers__'];
  const before = summary('sk-1', { title: 'old', updatedAt: ts(2), rowSeq: 40 });
  const after = summary('sk-1', { title: 'renamed', updatedAt: ts(5), rowSeq: 50 });
  const answers = {
    list: (r: IssueSummary) => ({ items: [r], hasMore: false }),
    allList: (r: IssueSummary) => ({ items: [r], hasMore: false }),
    card: (r: IssueSummary) => ({ ...r, description: '' }),
    backfill: (r: IssueSummary) => [r],
    section: (r: IssueSummary) => ({ rows: [{ item: r, depth: 1, isReference: false }], requestedAt: 1 }),
    columnTree: (r: IssueSummary) => ({ rows: [{ item: r, depth: 0, isReference: false }], requestedAt: 1 }),
  } as const;
  const keys = {
    list: projectListKey(),
    allList: ['tasks', 'all', 'cross-project', 'all', 'all', 'all', 'all', '', 'updated', ''],
    card: CARD,
    backfill: ['tasks', 'ancestors', 'seed'],
    section: SECTION,
    columnTree: COLUMN_TREE,
  } as const;

  test.each([
    ['a task list', 'list'],
    ['«All projects»', 'allList'],
    ['the open card', 'card'],
    ['an ancestor backfill', 'backfill'],
    ['an epic section', 'section'],
    ['a column tree', 'columnTree'],
  ] as const)('%s', async (_n, which) => {
    const key = keys[which];
    let n = 0;
    let release: (() => void) | null = null;
    const queryFn = () => {
      n += 1;
      // The first read started before the commit: it answers the old state.
      if (n === 1) return new Promise<unknown>((r) => { release = () => r(answers[which](before)); });
      return Promise.resolve(answers[which](after));
    };
    const observer = which === 'list' || which === 'allList'
      ? new InfiniteQueryObserver<Page, Error, InfiniteData<Page>, readonly unknown[], string | undefined>(qc, {
        queryKey: key,
        queryFn: queryFn as () => Promise<Page>,
        initialPageParam: undefined,
        getNextPageParam: () => undefined,
        staleTime: Infinity,
      })
      : new QueryObserver(qc, { queryKey: key, queryFn, staleTime: Infinity });
    unsubscribers.push(observer.subscribe(() => {}));
    // A reader the event has nothing to do with.
    seedReader('other', ['issues', 'detail', 'sk-77'], { ...summary('sk-77'), description: '' });
    await mountTab();
    expect(n).toBe(1);

    await deliver(envelope('issue.updated', 'sk-1', {
      changedFields: ['title'],
      row: eventRow('sk-1', { title: 'renamed', updatedAt: ts(5), rowSeq: 50 }),
    }));
    await act(async () => { release!(); });
    await advance(LIVE_INVALIDATION_WINDOW_MS + 200);

    expect(n).toBe(2);
    expect(JSON.stringify(qc.getQueryData(key))).toContain('"title":"renamed"');
    expect(readsOf('other')).toBe(0);
  });

  test('a personal lens still loading is re-read after its first read', async () => {
    const key = ['tasks', 'me', 'on-me', 'all', 'all', 'all', 'all', '', 'updated'];
    let n = 0;
    let release: (() => void) | null = null;
    const observer = new InfiniteQueryObserver<Page, Error, InfiniteData<Page>, readonly unknown[], string | undefined>(qc, {
      queryKey: key,
      queryFn: () => {
        n += 1;
        if (n === 1) return new Promise<Page>((r) => { release = () => r({ items: [], hasMore: false }); });
        return Promise.resolve({ items: [], hasMore: false });
      },
      initialPageParam: undefined,
      getNextPageParam: () => undefined,
      staleTime: Infinity,
    });
    unsubscribers.push(observer.subscribe(() => {}));
    await mountTab();

    await deliver(envelope('issue.updated', 'sk-1', {
      changedFields: ['title'], row: eventRow('sk-1', { title: 'renamed', updatedAt: ts(5), rowSeq: 50 }),
    }));
    await act(async () => { release!(); });
    await advance(LIVE_INVALIDATION_WINDOW_MS + 200);

    expect(n).toBe(2);
  });

  test('an answered column tree not showing the issue is not re-read beside an unanswered one', async () => {
    const answered = { rows: [{ item: summary('sk-5'), depth: 0, isReference: false }], requestedAt: 1 };
    seedReader('answered', ['issues', 'tree', P, 'sk-5', '', '__full__', '__no_blockers__'], answered);
    const o = new QueryObserver(qc, { queryKey: COLUMN_TREE, queryFn: () => new Promise(() => {}), staleTime: Infinity });
    unsubscribers.push(o.subscribe(() => {}));
    await mountTab();

    await deliver(envelope('issue.updated', 'sk-1', {
      changedFields: ['title'], row: eventRow('sk-1', { title: 'renamed', updatedAt: ts(5), rowSeq: 50 }),
    }));

    expect(readsOf('answered')).toBe(0);
  });

  test('a column tree still loading is re-read after its first read, beside an answered tree', async () => {
    const answered = { rows: [{ item: summary('sk-5'), depth: 0, isReference: false }], requestedAt: 1 };
    seedReader('answered', ['issues', 'tree', P, 'sk-5', '', '__full__', '__no_blockers__'], answered);
    let n = 0;
    let release: (() => void) | null = null;
    const o = new QueryObserver(qc, {
      queryKey: COLUMN_TREE,
      queryFn: () => {
        n += 1;
        if (n === 1) return new Promise<unknown>((r) => { release = () => r(answers.columnTree(before)); });
        return Promise.resolve(answers.columnTree(after));
      },
      staleTime: Infinity,
    });
    unsubscribers.push(o.subscribe(() => {}));
    await mountTab();

    await deliver(envelope('issue.updated', 'sk-1', {
      changedFields: ['title'], row: eventRow('sk-1', { title: 'renamed', updatedAt: ts(5), rowSeq: 50 }),
    }));
    await act(async () => { release!(); });
    await advance(LIVE_INVALIDATION_WINDOW_MS + 200);

    expect(n).toBe(2);
    expect(JSON.stringify(qc.getQueryData(COLUMN_TREE))).toContain('"title":"renamed"');
    expect(readsOf('answered')).toBe(0);
  });

  test('a tasks query that is no list (unknown project, never read) does not stop the row', async () => {
    // `useTasks.ts#cacheKey` on a project URL the tab cannot resolve:
    // `['tasks','not-found',<alias>]`, disabled, without an answer.
    const nf = new InfiniteQueryObserver<Page, Error, InfiniteData<Page>, readonly unknown[], string | undefined>(qc, {
      queryKey: ['tasks', 'not-found', 'zz'],
      queryFn: () => Promise.resolve({ items: [], hasMore: false }),
      initialPageParam: undefined,
      getNextPageParam: () => undefined,
      enabled: false,
    });
    unsubscribers.push(nf.subscribe(() => {}));
    const L = projectListKey();
    seedList('L', L, [{ items: [before], hasMore: false }]);
    await mountTab();

    await deliver(envelope('issue.updated', 'sk-1', {
      changedFields: ['title'], row: eventRow('sk-1', { title: 'renamed', updatedAt: ts(5), rowSeq: 50 }),
    }));

    expect(rowOf(L, 'sk-1')?.title).toBe('renamed');
    expect(readsOf('L')).toBe(0);
  });

  test('a list of another project still loading is not re-read', async () => {
    const key = ['tasks', 'project', 'ffffffff-0000-0000-0000-000000000009', 'all', 'all', 'all', 'all', 'all', '', '', 'updated', ''];
    let n = 0;
    let release: (() => void) | null = null;
    const observer = new InfiniteQueryObserver<Page, Error, InfiniteData<Page>, readonly unknown[], string | undefined>(qc, {
      queryKey: key,
      queryFn: () => {
        n += 1;
        return new Promise<Page>((r) => { release = () => r({ items: [], hasMore: false }); });
      },
      initialPageParam: undefined,
      getNextPageParam: () => undefined,
      staleTime: Infinity,
    });
    unsubscribers.push(observer.subscribe(() => {}));
    await mountTab();

    await deliver(envelope('issue.updated', 'sk-1', {
      changedFields: ['title'],
      row: eventRow('sk-1', { title: 'renamed', updatedAt: ts(5), rowSeq: 50 }),
    }));
    await act(async () => { release!(); });
    await advance(LIVE_INVALIDATION_WINDOW_MS + 200);

    expect(n).toBe(1);
  });
});

describe('No. 88 — a row moved inside a loaded prefix of several pages survives a re-read of every page', () => {
  // The patch keeps the stored
  // `pageParams`; a later re-read of the whole infinite list must still give
  // the server's set without a hole. The server below pages by
  // `updated_at DESC, id DESC` with a keyset cursor of the last row
  // (skein-api `issues/store.go#ListIssues`), three rows a page.
  test('a rename of the first row of page two, then a full re-read', async () => {
    const L = projectListKey();
    let table = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id, i) => summary(id, { updatedAt: ts(20 - i), rowSeq: 40 }));
    const cursorOf = (r: IssueSummary) => `${r.updatedAt}|${r.id}`;
    const pageAfter = (cursor: string | undefined): Page => {
      const sorted = [...table].sort((x, y) => compareServerOrder('updated', x, y));
      const from = cursor === undefined ? 0 : sorted.findIndex((r) => compareServerOrder('updated', r, {
        id: cursor.split('|')[1], updatedAt: cursor.split('|')[0], createdAt: '',
      }) > 0);
      const rest = from < 0 ? [] : sorted.slice(from);
      const items = rest.slice(0, 3);
      const hasMore = rest.length > 3;
      return { items, hasMore, nextCursor: hasMore ? cursorOf(items[items.length - 1]) : null };
    };
    const observer = new InfiniteQueryObserver<Page, Error, InfiniteData<Page>, readonly unknown[], string | undefined>(qc, {
      queryKey: L,
      queryFn: ({ pageParam }) => Promise.resolve(pageAfter(pageParam)),
      initialPageParam: undefined,
      getNextPageParam: (last) => (last.hasMore ? last.nextCursor ?? undefined : undefined),
      staleTime: Infinity,
    });
    unsubscribers.push(observer.subscribe(() => {}));
    await mountTab();
    await act(async () => { await observer.fetchNextPage(); });
    expect(rowsOf(L).map((r) => r.id)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);

    // `d` is renamed: it moves to the top on the server.
    table = table.map((r) => (r.id === 'd' ? { ...r, title: 'renamed', updatedAt: ts(30), rowSeq: 41 } : r));
    await deliver(envelope('issue.updated', 'd', {
      changedFields: ['title'], row: eventRow('d', { title: 'renamed', updatedAt: ts(30), rowSeq: 41 }),
    }));
    expect(rowsOf(L).map((r) => r.id)).toEqual(['d', 'a', 'b', 'c', 'e', 'f']);

    await act(async () => { await observer.refetch(); });

    expect(rowsOf(L).map((r) => r.id)).toEqual(['d', 'a', 'b', 'c', 'e', 'f']);
  });
});

describe('No. 87 — a patched answer is not passed off as a fresh one', () => {
  // A patch replaces one
  // row; an inactive list an earlier reaction marked stale, or whose answer
  // is older than its `staleTime`, still reads when it is mounted again.
  const mountList = (key: readonly unknown[], name: string) => {
    const observer = new InfiniteQueryObserver<Page, Error, InfiniteData<Page>, readonly unknown[], string | undefined>(qc, {
      queryKey: key,
      queryFn: () => { reads.set(name, readsOf(name) + 1); return Promise.resolve(server.get(name)!); },
      initialPageParam: undefined,
      getNextPageParam: () => undefined,
      // `useTasks.ts`: the Tasks column's list.
      staleTime: 30_000,
    });
    unsubscribers.push(observer.subscribe(() => {}));
  };

  test('a list marked stale by an earlier event, unmounted, reads on mount after the patch', async () => {
    const L = projectListKey();
    const page: Page = { items: [summary('sk-1', { updatedAt: ts(2) }), summary('sk-9', { updatedAt: ts(1) })], hasMore: false };
    qc.setQueryData<InfiniteData<Page>>(L, { pages: [page], pageParams: [undefined] });
    server.set('L', page);
    await mountTab();
    // Event 1 marks the list (it shows an end of the new blocking link).
    await deliver(envelope('dependency.created', 'dep-1', { dep: { type: 'blocks', fromId: 'sk-9', toId: 'sk-8' } }));
    expect(qc.getQueryState(L)?.isInvalidated).toBe(true);

    // Event 2 renames a row the list shows.
    await deliver(envelope('issue.updated', 'sk-1', {
      changedFields: ['title'], row: eventRow('sk-1', { title: 'renamed', updatedAt: ts(5), rowSeq: 41 }),
    }));
    expect(rowOf(L, 'sk-1')?.title).toBe('renamed');

    await act(async () => { mountList(L, 'L'); });
    await advance(10);
    expect(readsOf('L')).toBe(1);
  });

  test('a fresh list, unmounted and not marked, does not read on mount after the patch', async () => {
    const L = projectListKey();
    const page: Page = { items: [summary('sk-1', { updatedAt: ts(2) })], hasMore: false };
    qc.setQueryData<InfiniteData<Page>>(L, { pages: [page], pageParams: [undefined] });
    server.set('L', page);
    await mountTab();

    await deliver(envelope('issue.updated', 'sk-1', {
      changedFields: ['title'], row: eventRow('sk-1', { title: 'renamed', updatedAt: ts(5), rowSeq: 41 }),
    }));
    expect(qc.getQueryState(L)?.isInvalidated).toBe(false);

    await act(async () => { mountList(L, 'L'); });
    await advance(10);
    expect(readsOf('L')).toBe(0);
    expect(rowOf(L, 'sk-1')?.title).toBe('renamed');
  });

  test('a list answered longer ago than its staleTime, unmounted, reads on mount after the patch', async () => {
    const L = projectListKey();
    const page: Page = { items: [summary('sk-1', { updatedAt: ts(2) })], hasMore: false };
    qc.setQueryData<InfiniteData<Page>>(L, { pages: [page], pageParams: [undefined] });
    server.set('L', page);
    await mountTab();
    await advance(31_000);

    await deliver(envelope('issue.updated', 'sk-1', {
      changedFields: ['title'], row: eventRow('sk-1', { title: 'renamed', updatedAt: ts(5), rowSeq: 41 }),
    }));
    expect(rowOf(L, 'sk-1')?.title).toBe('renamed');

    await act(async () => { mountList(L, 'L'); });
    await advance(10);
    expect(readsOf('L')).toBe(1);
  });
});

describe('No. 87 — a broken row is not laid in: the event is handled as in phase 1', () => {
  // One defect at a time on an otherwise valid row; the wire is untrusted.
  test.each<[string, Record<string, unknown>]>([
    ['row is not an object', { __replace: 'text' }],
    ['row is an array', { __replace: [] }],
    ['id missing', { id: undefined }],
    ['projectId of another project', { projectId: 'ffffffff-0000-0000-0000-000000000009' }],
    ['projectId missing', { projectId: undefined }],
    ['rowSeq a string', { rowSeq: '41' }],
    ['rowSeq negative', { rowSeq: -1 }],
    ['rowSeq not finite', { rowSeq: Number.POSITIVE_INFINITY }],
    ['version missing', { version: undefined }],
    ['title missing', { title: undefined }],
    ['type missing', { type: undefined }],
    ['status missing', { status: undefined }],
    ['priority a string', { priority: '2' }],
    ['pinned missing', { pinned: undefined }],
    ['createdBy missing', { createdBy: undefined }],
    ['labels not an array', { labels: 'x' }],
    ['labels with a number', { labels: [1] }],
    ['componentIds missing', { componentIds: undefined }],
    ['updatedAt missing', { updatedAt: undefined }],
    ['createdAt missing', { createdAt: undefined }],
    ['parentIdCurrent a number', { parentIdCurrent: 5 }],
    ['assignee a number', { assignee: 5 }],
    ['assigneeUserId a number', { assigneeUserId: 5 }],
    ['createdByUsername a number', { createdByUsername: 5 }],
    ['acceptedAt a number', { acceptedAt: 5 }],
    ['closeOutcome a number', { closeOutcome: 5 }],
  ])('%s', async (_n, defect) => {
    // «All projects» answers rows of every project, so a row naming another
    // project would be taken here if it were not refused.
    const L = ['tasks', 'all', 'cross-project', 'all', 'all', 'all', 'all', '', 'updated', ''];
    seedList('L', L, [{ items: [summary('sk-1', { updatedAt: ts(2) })], hasMore: false }]);
    await mountTab();

    const good = eventRow('sk-1', { title: 'renamed', updatedAt: ts(5), rowSeq: 41 });
    const row = '__replace' in defect ? defect.__replace : { ...good, ...defect };
    await deliver(envelope('issue.updated', 'sk-1', { changedFields: ['title'], row }));

    expect(rowOf(L, 'sk-1')?.title).toBe('sk-1');
    expect(readsOf('L')).toBe(1);
  });

  test('null optional fields are absent values, the row is laid in', async () => {
    const L = projectListKey();
    seedList('L', L, [{ items: [summary('sk-1', { assignee: 'bob', parentIdCurrent: 'sk-5', updatedAt: ts(2) })], hasMore: false }]);
    await mountTab();

    await deliver(envelope('issue.updated', 'sk-1', {
      changedFields: ['title'],
      row: eventRow('sk-1', {
        title: 'renamed', updatedAt: ts(5), rowSeq: 41,
        parentIdCurrent: null, assignee: null, assigneeUserId: null, createdByUsername: null, acceptedAt: null, closeOutcome: null,
      }),
    }));

    expect(rowOf(L, 'sk-1')).toMatchObject({ title: 'renamed', parentIdCurrent: 'sk-5' });
    expect(rowOf(L, 'sk-1')?.assignee ?? null).toBeNull();
    expect(readsOf('L')).toBe(0);
  });
});

describe('No. 87 — the store of rows taken from events', () => {
  test('a REST answer older than a taken row does not let a stale event through', async () => {
    const L = projectListKey();
    seedList('L', L, [{ items: [summary('sk-2', { title: 'B', rowSeq: 40, updatedAt: ts(1) })], hasMore: false }]);
    await mountTab();

    await deliver(envelope('issue.updated', 'sk-2', {
      changedFields: ['title'], row: eventRow('sk-2', { title: 'B50', updatedAt: ts(6), rowSeq: 50 }),
    }));
    expect(rowOf(L, 'sk-2')?.title).toBe('B50');

    // A read started before that commit lands after it with the older row.
    server.set('L', { items: [summary('sk-2', { title: 'B', rowSeq: 40, updatedAt: ts(1) })], hasMore: false });
    await act(async () => { await qc.refetchQueries({ queryKey: L }); });
    expect(rowOf(L, 'sk-2')?.title).toBe('B');

    await deliver(envelope('issue.updated', 'sk-2', {
      changedFields: ['title'], row: eventRow('sk-2', { title: 'B45', updatedAt: ts(7), rowSeq: 45 }),
    }));
    expect(rowOf(L, 'sk-2')?.title).toBe('B');
  });

  /** Take as many other issues from events as the tab keeps (another project). */
  function takeOtherIssues(): void {
    const OTHER = 'ffffffff-0000-0000-0000-000000000009';
    act(() => {
      for (let i = 0; i < MAX_TRACKED_ISSUES; i += 1) {
        hub.handlers.get('event')!(envelope('issue.updated', `zz-${i}`, {
          projectId: OTHER,
          changedFields: ['title'],
          row: eventRow(`zz-${i}`, { projectId: OTHER, title: 't', updatedAt: ts(9), rowSeq: 1 }),
        }));
      }
    });
  }

  test.each([
    ['older than the row taken', { rowSeq: 40 }, 1],
    ['without an order (R26: unknown)', { rowSeq: undefined }, 1],
    ['as new as the row taken', { rowSeq: 50 }, 0],
  ] as const)('past its bound, the issue taken longest ago drops out; a copy %s is re-read', async (_n, copy, expected) => {
    // A copy older than what the tab took must not be left for a stale
    // event to overwrite; a copy that shows it needs nothing.
    const L = projectListKey();
    seedList('L', L, [{ items: [summary('sk-2', { title: 'B', rowSeq: 40, updatedAt: ts(1) })], hasMore: false }]);
    seedReader('other', ['issues', 'detail', 'sk-77'], { ...summary('sk-77'), description: '' });
    await mountTab();
    await deliver(envelope('issue.updated', 'sk-2', {
      changedFields: ['title'], row: eventRow('sk-2', { title: 'B50', updatedAt: ts(6), rowSeq: 50 }),
    }));
    // A read lands after the event: an older answer started before the
    // commit, or the committed one.
    const landed = { ...summary('sk-2', { title: copy.rowSeq === 50 ? 'B50' : 'B', updatedAt: ts(1) }), rowSeq: copy.rowSeq };
    if (landed.rowSeq === undefined) delete (landed as { rowSeq?: number }).rowSeq;
    server.set('L', { items: [landed as IssueSummary], hasMore: false });
    await act(async () => { await qc.refetchQueries({ queryKey: L }); });
    reads = new Map();

    // The server now answers the committed state.
    server.set('L', { items: [summary('sk-2', { title: 'B50', rowSeq: 50, updatedAt: ts(6) })], hasMore: false });
    takeOtherIssues();
    await advance(LIVE_INVALIDATION_WINDOW_MS + 200);
    expect(readsOf('L')).toBe(expected);
    expect(readsOf('other')).toBe(0);
    expect(rowOf(L, 'sk-2')?.title).toBe('B50');

    // A stale event still does not win.
    await deliver(envelope('issue.updated', 'sk-2', {
      changedFields: ['title'], row: eventRow('sk-2', { title: 'B45', updatedAt: ts(7), rowSeq: 45 }),
    }));
    expect(rowOf(L, 'sk-2')?.title).toBe('B50');
  });

  test('the row brings the author name and the close outcome', async () => {
    const L = projectListKey();
    seedList('L', L, [{ items: [summary('sk-1', { updatedAt: ts(2) })], hasMore: false }]);
    await mountTab();

    await deliver(envelope('issue.closed', 'sk-1', {
      row: eventRow('sk-1', { status: 'closed', closeOutcome: 'wont_do', createdByUsername: 'bob', updatedAt: ts(5), rowSeq: 41 }),
    }));

    expect(rowOf(L, 'sk-1')).toMatchObject({ status: 'closed', closeOutcome: 'wont_do', createdByUsername: 'bob' });
  });
});

describe('No. 87 — an issue dropped from the store keeps its mark until the repair read is answered', () => {
  // `releaseEvicted`: the eviction queues a re-read of the older copy, but
  // until that read delivers, a stale event between the copy and the mark
  // dropped must still be refused — in a visible tab with the read held, in
  // a hidden tab that only takes obligations, and on a reader nobody shows.
  let hidden = false;
  beforeEach(() => {
    hidden = false;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  });
  afterEach(() => {
    hidden = false;
  });

  const OTHER = 'ffffffff-0000-0000-0000-000000000009';
  /** Take `count` other issues from events (another project), named `<prefix>-<i>`. */
  function takeOtherIssues(count = MAX_TRACKED_ISSUES, prefix = 'zz'): void {
    act(() => {
      for (let i = 0; i < count; i += 1) {
        hub.handlers.get('event')!(envelope('issue.updated', `${prefix}-${i}`, {
          projectId: OTHER,
          changedFields: ['title'],
          row: eventRow(`${prefix}-${i}`, { projectId: OTHER, title: 't', updatedAt: ts(9), rowSeq: 1 }),
        }));
      }
    });
  }

  /** A shown list whose reads wait until `release` is called. */
  function seedHeldList(key: readonly unknown[], first: Page): { release: (p: Page) => Promise<void> } {
    qc.setQueryData<InfiniteData<Page>>(key, { pages: [first], pageParams: [undefined] });
    const waiting: Array<(p: Page) => void> = [];
    const observer = new InfiniteQueryObserver<Page, Error, InfiniteData<Page>, readonly unknown[], string | undefined>(qc, {
      queryKey: key,
      queryFn: () => {
        reads.set('L', readsOf('L') + 1);
        return new Promise<Page>((resolve) => { waiting.push(resolve); });
      },
      initialPageParam: undefined,
      getNextPageParam: () => undefined,
      staleTime: Infinity,
    });
    unsubscribers.push(observer.subscribe(() => {}));
    return {
      release: async (p: Page) => {
        await act(async () => {
          waiting.splice(0).forEach((resolve) => resolve(p));
          await vi.advanceTimersByTimeAsync(0);
        });
      },
    };
  }

  const at40 = () => summary('sk-1', { title: 'old-40', rowSeq: 40, updatedAt: ts(1) });
  const at100 = () => summary('sk-1', { title: 'committed-100', rowSeq: 100, updatedAt: ts(8) });
  const titleEvent = (title: string, rowSeq: number, n: number) => envelope('issue.updated', 'sk-1', {
    changedFields: ['title'], row: eventRow('sk-1', { title, updatedAt: ts(n), rowSeq }),
  });

  /**
   * The tab took row 100, then a read started before that commit landed
   * with the older copy at 40 (through the held reader when there is one,
   * as an answer written into the cache when nobody shows the list).
   */
  async function takeThenOlderCopy(L: readonly unknown[], list?: { release: (p: Page) => Promise<void> }): Promise<void> {
    act(() => hub.handlers.get('event')!(titleEvent('committed-100', 100, 8)));
    expect(rowOf(L, 'sk-1')?.title).toBe('committed-100');
    if (list) {
      act(() => { void qc.refetchQueries({ queryKey: L }); });
      await list.release({ items: [at40()], hasMore: false });
    } else {
      act(() => {
        qc.setQueryData<InfiniteData<Page>>(L, { pages: [{ items: [at40()], hasMore: false }], pageParams: [undefined] });
      });
    }
    expect(rowOf(L, 'sk-1')?.title).toBe('old-40');
    reads = new Map();
  }

  test('visible tab, repair read held: a stale event is not laid; the answer replaces the copy', async () => {
    const L = projectListKey();
    const list = seedHeldList(L, { items: [at40()], hasMore: false });
    await mountTab();
    await takeThenOlderCopy(L, list);
    takeOtherIssues();
    await advance(LIVE_INVALIDATION_WINDOW_MS + 200);
    expect(readsOf('L')).toBeGreaterThan(0);

    await deliver(titleEvent('stale-50', 50, 6));
    expect(rowOf(L, 'sk-1')?.title).toBe('old-40');

    // The repair read answers; a reset the stale event queued behind it
    // answers the same committed row.
    await list.release({ items: [at100()], hasMore: false });
    await advance(LIVE_INVALIDATION_WINDOW_MS + 200);
    await list.release({ items: [at100()], hasMore: false });
    expect(rowOf(L, 'sk-1')?.title).toBe('committed-100');

    // Answered: the copy itself guards from now on, and a newer row lays in.
    await deliver(titleEvent('stale-60', 60, 7));
    expect(rowOf(L, 'sk-1')?.title).toBe('committed-100');
    await deliver(titleEvent('next-101', 101, 9));
    expect(rowOf(L, 'sk-1')?.title).toBe('next-101');
  });

  test('a stale event right after the eviction, before the batch window, is not laid either', async () => {
    const L = projectListKey();
    const list = seedHeldList(L, { items: [at40()], hasMore: false });
    await mountTab();
    await takeThenOlderCopy(L, list);
    takeOtherIssues();
    act(() => hub.handlers.get('event')!(titleEvent('stale-50', 50, 6)));
    expect(readsOf('L')).toBe(0);
    expect(rowOf(L, 'sk-1')?.title).toBe('old-40');
  });

  test('hidden tab: no read, the stale event is not laid; shown again, the read brings the committed row', async () => {
    const L = projectListKey();
    const list = seedHeldList(L, { items: [at40()], hasMore: false });
    await mountTab();
    await takeThenOlderCopy(L, list);
    hidden = true;
    takeOtherIssues();
    await advance(LIVE_INVALIDATION_WINDOW_MS + 200);
    await deliver(titleEvent('stale-50', 50, 6));
    expect(readsOf('L')).toBe(0);
    expect(rowOf(L, 'sk-1')?.title).toBe('old-40');

    hidden = false;
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await advance(LIVE_INVALIDATION_WINDOW_MS + 200);
    expect(readsOf('L')).toBeGreaterThan(0);
    await list.release({ items: [at100()], hasMore: false });
    expect(rowOf(L, 'sk-1')?.title).toBe('committed-100');
  });

  test('a reader nobody shows is only marked stale: the stale event is not laid on it', async () => {
    const L = projectListKey();
    qc.setQueryData<InfiniteData<Page>>(L, { pages: [{ items: [at40()], hasMore: false }], pageParams: [undefined] });
    await mountTab();
    await takeThenOlderCopy(L);
    takeOtherIssues();
    await advance(LIVE_INVALIDATION_WINDOW_MS + 200);
    expect(qc.getQueryState(L)?.isInvalidated).toBe(true);

    await deliver(titleEvent('stale-50', 50, 6));
    expect(rowOf(L, 'sk-1')?.title).toBe('old-40');
  });
  test('the copy left the cache: the mark is let go, and the event is handled by the copies alone', async () => {
    const L = projectListKey();
    const L2 = projectListKey({ priority: '1' });
    qc.setQueryData<InfiniteData<Page>>(L, { pages: [{ items: [at40()], hasMore: false }], pageParams: [undefined] });
    seedList('L2', L2, [{ items: [summary('sk-9', { priority: 1 })], hasMore: false }]);
    await mountTab();
    await takeThenOlderCopy(L);
    takeOtherIssues();
    act(() => { qc.removeQueries({ queryKey: L, exact: true }); });
    await advance(LIVE_INVALIDATION_WINDOW_MS + 200);
    reads = new Map();

    // No copy of sk-1 is cached any more: its row at 50 is fresher than
    // everything shown, enters the priority-1 list and re-reads it (K21).
    await deliver(envelope('issue.updated', 'sk-1', {
      changedFields: ['priority'], row: eventRow('sk-1', { priority: 1, updatedAt: ts(6), rowSeq: 50 }),
    }));
    expect(readsOf('L2')).toBe(1);
  });

  test('many issues dropped at once keep every mark whose copy is still older', async () => {
    // Past the size at which the awaiting set is swept, the marks still
    // guarding an older copy stay.
    const L = projectListKey();
    const ids = Array.from({ length: 70 }, (_, i) => `sk-a${i}`);
    const at = (seq: number, title: (id: string) => string) =>
      ids.map((id) => summary(id, { title: title(id), rowSeq: seq, updatedAt: ts(1) }));
    seedList('L', L, [{ items: at(40, (id) => `${id}-40`), hasMore: false }]);
    await mountTab();
    act(() => {
      for (const id of ids) {
        hub.handlers.get('event')!(envelope('issue.updated', id, {
          changedFields: ['title'], row: eventRow(id, { title: `${id}-100`, updatedAt: ts(8), rowSeq: 100 }),
        }));
      }
    });
    expect(rowOf(L, 'sk-a0')?.title).toBe('sk-a0-100');
    server.set('L', { items: at(40, (id) => `${id}-40`), hasMore: false });
    await act(async () => { await qc.refetchQueries({ queryKey: L }); });
    expect(rowOf(L, 'sk-a0')?.title).toBe('sk-a0-40');

    takeOtherIssues();
    act(() => {
      for (const id of [ids[0], ids[69]]) {
        hub.handlers.get('event')!(envelope('issue.updated', id, {
          changedFields: ['title'], row: eventRow(id, { title: `${id}-stale-50`, updatedAt: ts(6), rowSeq: 50 }),
        }));
      }
    });
    expect(rowOf(L, 'sk-a0')?.title).toBe('sk-a0-40');
    expect(rowOf(L, 'sk-a69')?.title).toBe('sk-a69-40');
  });

  test('exactly as many issues as the tab keeps: none drops, nothing is re-read', async () => {
    const L = projectListKey();
    seedList('L', L, [{ items: [at40()], hasMore: false }]);
    await mountTab();
    await deliver(titleEvent('committed-100', 100, 8));
    server.set('L', { items: [at40()], hasMore: false });
    await act(async () => { await qc.refetchQueries({ queryKey: L }); });
    reads = new Map();

    takeOtherIssues(MAX_TRACKED_ISSUES - 1);
    await advance(LIVE_INVALIDATION_WINDOW_MS + 200);
    expect(readsOf('L')).toBe(0);
    expect(rowOf(L, 'sk-1')?.title).toBe('old-40');
  });

  test('a stale event does not count as taking the issue again: it still drops first', async () => {
    const L = projectListKey();
    seedList('L', L, [{ items: [at40()], hasMore: false }]);
    await mountTab();
    await deliver(titleEvent('committed-100', 100, 8));
    server.set('L', { items: [at40()], hasMore: false });
    await act(async () => { await qc.refetchQueries({ queryKey: L }); });
    takeOtherIssues(MAX_TRACKED_ISSUES - 1);
    // Older than what the tab took: not laid, and not «taken».
    await deliver(titleEvent('stale-50', 50, 6));
    expect(rowOf(L, 'sk-1')?.title).toBe('old-40');
    server.set('L', { items: [at100()], hasMore: false });
    reads = new Map();

    // One more issue: sk-1, taken longest ago, drops; its older copy is re-read.
    takeOtherIssues(1, 'yy');
    await advance(LIVE_INVALIDATION_WINDOW_MS + 200);
    expect(readsOf('L')).toBe(1);
    expect(rowOf(L, 'sk-1')?.title).toBe('committed-100');
  });

  test('an issue taken again moves to the newest: the one taken longest ago drops first', async () => {
    const L = projectListKey();
    seedList('L', L, [{ items: [at40()], hasMore: false }]);
    await mountTab();
    await deliver(titleEvent('first-50', 50, 6));
    takeOtherIssues(MAX_TRACKED_ISSUES - 1);
    // Taken again — and then an older read leaves the copy behind it.
    await deliver(titleEvent('committed-100', 100, 8));
    server.set('L', { items: [at40()], hasMore: false });
    await act(async () => { await qc.refetchQueries({ queryKey: L }); });
    reads = new Map();

    // One more issue: the one dropped is `zz-0`, which no list shows.
    takeOtherIssues(1, 'yy');
    await advance(LIVE_INVALIDATION_WINDOW_MS + 200);
    expect(readsOf('L')).toBe(0);
  });
});

describe('No. 87 — the rows taken under one identity do not judge the next one', () => {
  // A logout keeps
  // the tab, the query cache (marked stale) and the provider.
  async function signInAs(id: string, username: string): Promise<void> {
    await act(async () => {
      await qc.invalidateQueries();
      auth.user = { id, username, role: 'user' };
      rerenderTab!();
    });
    await advance(1_000);
  }

  test('a row the previous identity took does not refuse the next identity’s event', async () => {
    const L = projectListKey();
    seedList('L', L, [{ items: [summary('sk-2', { title: 'B', rowSeq: 40, updatedAt: ts(1) })], hasMore: false }]);
    await mountTab();
    await deliver(envelope('issue.updated', 'sk-2', {
      changedFields: ['title'], row: eventRow('sk-2', { title: 'B50', updatedAt: ts(6), rowSeq: 50 }),
    }));
    expect(rowOf(L, 'sk-2')?.title).toBe('B50');

    // The next person's tab reads the list: its answer shows sk-2 at 40.
    server.set('L', { items: [summary('sk-2', { title: 'B', rowSeq: 40, updatedAt: ts(1) })], hasMore: false });
    await signInAs('u-9', 'vic');
    expect(rowOf(L, 'sk-2')?.title).toBe('B');

    await deliver(envelope('issue.updated', 'sk-2', {
      changedFields: ['title'], row: eventRow('sk-2', { title: 'B45', updatedAt: ts(7), rowSeq: 45 }),
    }));
    expect(rowOf(L, 'sk-2')?.title).toBe('B45');
  });

  test('a list the logout marked stale, not shown, stays marked after a patch and reads when shown', async () => {
    const L = projectListKey();
    const page: Page = { items: [summary('sk-1', { updatedAt: ts(2) })], hasMore: false };
    qc.setQueryData<InfiniteData<Page>>(L, { pages: [page], pageParams: [undefined] });
    server.set('L', page);
    await mountTab();
    await signInAs('u-9', 'vic');
    expect(qc.getQueryState(L)?.isInvalidated).toBe(true);

    await deliver(envelope('issue.updated', 'sk-1', {
      changedFields: ['title'], row: eventRow('sk-1', { title: 'renamed', updatedAt: ts(5), rowSeq: 41 }),
    }));
    expect(qc.getQueryState(L)?.isInvalidated).toBe(true);

    const observer = new InfiniteQueryObserver<Page, Error, InfiniteData<Page>, readonly unknown[], string | undefined>(qc, {
      queryKey: L,
      queryFn: () => { reads.set('L', readsOf('L') + 1); return Promise.resolve(page); },
      initialPageParam: undefined,
      getNextPageParam: () => undefined,
      staleTime: 30_000,
    });
    await act(async () => { unsubscribers.push(observer.subscribe(() => {})); });
    await advance(10);
    expect(readsOf('L')).toBe(1);
  });
});

describe('No. 88 (helper) — the server order the continuation is checked against', () => {
  // skein-api `issues/store.go#ListIssues`: `ORDER BY i.<col> DESC, i.id DESC`,
  // timestamps at microsecond precision.
  const row = (id: string, updatedAt: string, createdAt = updatedAt) => ({ id, updatedAt, createdAt });
  test.each<[string, 'updated' | 'created', ReturnType<typeof row>, ReturnType<typeof row>, number]>([
    ['later updated first', 'updated', row('a', '2026-10-01T10:00:09Z'), row('b', '2026-10-01T10:00:08Z'), -1],
    ['one microsecond apart', 'updated', row('a', '2026-10-01T10:00:09.000002Z'), row('b', '2026-10-01T10:00:09.000001Z'), -1],
    ['fraction written shorter', 'updated', row('a', '2026-10-01T10:00:09.1Z'), row('b', '2026-10-01T10:00:09.09Z'), -1],
    ['no fraction against one', 'updated', row('a', '2026-10-01T10:00:09Z'), row('b', '2026-10-01T10:00:09.000001Z'), 1],
    ['an offset other than Z', 'updated', row('a', '2026-10-01T12:00:09+02:00'), row('b', '2026-10-01T10:00:08Z'), -1],
    ['a tie goes by id, greater first', 'updated', row('sk-2', '2026-10-01T10:00:09Z'), row('sk-10', '2026-10-01T10:00:09Z'), -1],
    ['created order ignores updated', 'created', row('a', '2026-10-01T10:00:01Z', '2026-10-01T09:00:00Z'), row('b', '2026-10-01T10:00:09Z', '2026-10-01T09:00:05Z'), 1],
    ['same row', 'updated', row('a', '2026-10-01T10:00:09Z'), row('a', '2026-10-01T10:00:09Z'), 0],
    ['updated order ignores created', 'updated', row('a', '2026-10-01T10:00:09Z', '2026-10-01T09:00:00Z'), row('b', '2026-10-01T10:00:01Z', '2026-10-01T09:00:05Z'), -1],
    ['a tie, the smaller id second', 'updated', row('sk-10', '2026-10-01T10:00:09Z'), row('sk-2', '2026-10-01T10:00:09Z'), 1],
    ['an offset other than Z, earlier', 'updated', row('a', '2026-10-01T12:00:07+02:00'), row('b', '2026-10-01T10:00:08Z'), 1],
    ['one microsecond later, ids against it', 'updated', row('b', '2026-10-01T10:00:09Z'), row('a', '2026-10-01T10:00:09.000001Z'), 1],
  ])('%s', (_n, order, a, b, sign) => {
    expect(Math.sign(compareServerOrder(order, a, b))).toBe(sign);
  });
});

// ─────────────────────────────── No. 89 ────────────────────────────────

describe('No. 89 — fields of the reader and of the horizon', () => {
  // The literal REST row for reader u-1 (`iAssigned` is wire-omitempty:
  // absent unless the reader created the issue and it is assigned to
  // someone else who resolves to a user).
  test.each([
    ['the author', { createdBy: ME, assigneeUserId: 'u-2', assignee: 'bob' }, { iAssigned: true }, { }],
    ['the assignee', { createdBy: 'u-2', assigneeUserId: ME, assignee: 'ann' }, { }, { iAssigned: true }],
    ['an outsider', { createdBy: 'u-2', assigneeUserId: 'u-3', assignee: 'cid' }, { }, { iAssigned: true }],
    // The server compares the RESOLVED user (`ua.id`): an assignee text that
    // names no user, and the author assigned to herself, give no flag.
    ['the author, assignee resolving to no user', { createdBy: ME, assignee: 'ghost' }, { }, { iAssigned: true }],
    ['the author assigned to herself', { createdBy: ME, assigneeUserId: ME, assignee: 'ann' }, { }, { iAssigned: true }],
  ] as const)('iAssigned matches the REST answer for %s', async (_who, fields, rest, shownBefore) => {
    const L = projectListKey();
    seedList('L', L, [{ items: [summary('sk-1', { ...shownBefore })], hasMore: false }]);
    await mountTab();

    await deliver(envelope('issue.updated', 'sk-1', {
      changedFields: ['assignee'],
      row: eventRow('sk-1', { ...fields, updatedAt: ts(4), rowSeq: 41 }),
    }));

    expect(rowOf(L, 'sk-1')?.iAssigned).toBe((rest as { iAssigned?: boolean }).iAssigned);
    expect(rowOf(L, 'sk-1')?.assignee).toBe(fields.assignee);
  });

  test('isBlocked and the epic progress are kept as shown, not taken from the event row', async () => {
    const L = projectListKey();
    seedList('L', L, [{
      items: [summary('sk-5', { type: 'epic', isBlocked: true, epicProgress: { closed: 1, total: 3 } })],
      hasMore: false,
    }]);
    await mountTab();

    await deliver(envelope('issue.updated', 'sk-5', {
      changedFields: ['title'],
      row: eventRow('sk-5', { type: 'epic', title: 'epic renamed', updatedAt: ts(4), rowSeq: 41 }),
    }));

    expect(rowOf(L, 'sk-5')).toMatchObject({ title: 'epic renamed', isBlocked: true, epicProgress: { closed: 1, total: 3 } });
    expect(readsOf('L')).toBe(0);
  });

  test('the shown parent is kept when the row carries none (parent in another project, INV-17); a cleared assignee is cleared', async () => {
    const L = projectListKey();
    seedList('L', L, [{
      items: [
        summary('sk-1', { parentIdCurrent: 'xx-7', assignee: 'bob', assigneeUserId: 'u-2', updatedAt: ts(2) }),
        summary('sk-2', { parentIdCurrent: 'sk-5', updatedAt: ts(1) }),
      ],
      hasMore: false,
    }]);
    await mountTab();

    await deliver(envelope('issue.updated', 'sk-1', {
      changedFields: ['assignee'],
      row: eventRow('sk-1', { updatedAt: ts(4), rowSeq: 41 }),
    }));
    // A row that does carry the parent (same project) brings it.
    await deliver(envelope('issue.updated', 'sk-2', {
      changedFields: ['title'],
      row: eventRow('sk-2', { title: 'moved', parentIdCurrent: 'sk-6', updatedAt: ts(6), rowSeq: 42 }),
    }));

    const one = rowOf(L, 'sk-1');
    expect(one?.parentIdCurrent).toBe('xx-7');
    expect(one?.assignee ?? null).toBeNull();
    expect(one?.assigneeUserId ?? null).toBeNull();
    expect(rowOf(L, 'sk-2')).toMatchObject({ title: 'moved', parentIdCurrent: 'sk-6' });
    expect(readsOf('L')).toBe(0);
  });

  test('a row that names another issue is not laid in: the event is handled as in phase 1', async () => {
    const L = projectListKey();
    seedList('L', L, [{ items: [summary('sk-1', { updatedAt: ts(2) })], hasMore: false }]);
    await mountTab();

    await deliver(envelope('issue.updated', 'sk-1', {
      changedFields: ['title'],
      row: eventRow('sk-99', { title: 'foreign', updatedAt: ts(5), rowSeq: 41 }),
    }));

    expect(rowOf(L, 'sk-1')?.title).toBe('sk-1');
    expect(readsOf('L')).toBe(1);
  });

  test('a row naming another issue the list shows leaves that issue as shown, and the event’s own issue is re-read as in phase 1', async () => {
    // both issues on screen, more pages to come.
    const L = projectListKey();
    seedList('L', L, [{
      items: [summary('sk-1', { updatedAt: ts(3) }), summary('sk-2', { title: 'B', updatedAt: ts(2) })],
      hasMore: true,
      nextCursor: 'c1',
    }]);
    await mountTab();

    act(() => hub.handlers.get('event')!(envelope('issue.updated', 'sk-1', {
      changedFields: ['title'],
      row: eventRow('sk-2', { title: 'foreign', updatedAt: ts(2), rowSeq: 50 }),
    })));
    // Before any re-read: the foreign row was laid on nothing.
    expect(rowOf(L, 'sk-2')?.title).toBe('B');
    await advance(LIVE_INVALIDATION_WINDOW_MS + 200);

    expect(rowOf(L, 'sk-2')?.title).toBe('B');
    expect(readsOf('L')).toBe(1);
  });

  test('a reopened blocker re-reads a list showing it: the row it blocks, not flagged yet, takes the flag from the answer', async () => {
    const L = projectListKey();
    seedList('L', L, [{
      items: [summary('sk-8', { status: 'closed', closeOutcome: 'done', updatedAt: ts(2) }), summary('sk-9', { isBlocked: false, updatedAt: ts(1) })],
      hasMore: false,
    }]);
    await mountTab();
    server.set('L', {
      items: [summary('sk-8', { status: 'open', updatedAt: ts(6), rowSeq: 41 }), summary('sk-9', { isBlocked: true, updatedAt: ts(1) })],
      hasMore: false,
    });

    await deliver(envelope('issue.reopened', 'sk-8', { row: eventRow('sk-8', { status: 'open', updatedAt: ts(6), rowSeq: 41 }) }));

    expect(readsOf('L')).toBe(1);
    expect(rowOf(L, 'sk-9')?.isBlocked).toBe(true);
  });

  test('a status change to a gating status re-reads a list showing the issue', async () => {
    const L = projectListKey();
    seedList('L', L, [{
      items: [summary('sk-8', { status: 'standing', updatedAt: ts(2) }), summary('sk-9', { isBlocked: false, updatedAt: ts(1) })],
      hasMore: false,
    }]);
    await mountTab();
    server.set('L', {
      items: [summary('sk-8', { status: 'open', updatedAt: ts(6), rowSeq: 41 }), summary('sk-9', { isBlocked: true, updatedAt: ts(1) })],
      hasMore: false,
    });

    await deliver(envelope('issue.status_changed', 'sk-8', { row: eventRow('sk-8', { status: 'open', updatedAt: ts(6), rowSeq: 41 }) }));

    expect(readsOf('L')).toBe(1);
    expect(rowOf(L, 'sk-9')?.isBlocked).toBe(true);
  });

  test.each([
    ['closed', { status: 'closed', closeOutcome: 'done' }],
    ['made standing', { status: 'standing' }],
  ] as const)('a status change that ends gating (%s), no row flagged: only the row is laid in', async (_n, fields) => {
    const L = projectListKey();
    seedList('L', L, [{ items: [summary('sk-8', { updatedAt: ts(2) }), summary('sk-9', { updatedAt: ts(1) })], hasMore: false }]);
    await mountTab();

    await deliver(envelope('issue.status_changed', 'sk-8', { row: eventRow('sk-8', { ...fields, updatedAt: ts(6), rowSeq: 41 }) }));

    expect(readsOf('L')).toBe(0);
    expect(rowOf(L, 'sk-8')).toMatchObject(fields);
  });

  test('a claim, which leaves the issue gating, only lays its row in', async () => {
    const L = projectListKey();
    seedList('L', L, [{ items: [summary('sk-8', { updatedAt: ts(2) }), summary('sk-9', { updatedAt: ts(1) })], hasMore: false }]);
    await mountTab();

    await deliver(envelope('issue.claimed', 'sk-8', { row: eventRow('sk-8', { status: 'in_progress', updatedAt: ts(6), rowSeq: 41 }) }));

    expect(readsOf('L')).toBe(0);
    expect(rowOf(L, 'sk-8')?.status).toBe('in_progress');
  });

  test('a blocking link re-reads the loaded rows of a list without a blocked filter', async () => {
    const L = projectListKey();
    seedList('L', L, [{ items: [summary('sk-9'), summary('sk-8', { updatedAt: ts(0) })], hasMore: false }]);
    await mountTab();
    server.set('L', { items: [summary('sk-9', { isBlocked: true }), summary('sk-8', { updatedAt: ts(0) })], hasMore: false });

    await deliver(envelope('dependency.created', 'dep-1', { dep: { type: 'blocks', fromId: 'sk-9', toId: 'sk-8' } }));

    expect(readsOf('L')).toBe(1);
    expect(rowOf(L, 'sk-9')?.isBlocked).toBe(true);
  });

  test.each([
    ['status', 'issue.status_changed', { status: 'closed', closeOutcome: 'done' }],
    ['outcome', 'issue.outcome_changed', { status: 'closed', closeOutcome: 'wont_do' }],
  ] as const)('a change of the blocker’s %s re-reads the blocked row, while the blocker takes its row', async (_n, type, fields) => {
    const L = projectListKey();
    seedList('L', L, [{
      items: [summary('sk-9', { isBlocked: true, updatedAt: ts(2) }), summary('sk-8', { updatedAt: ts(1) })],
      hasMore: false,
    }]);
    await mountTab();
    server.set('L', {
      items: [summary('sk-8', { ...fields, updatedAt: ts(6), rowSeq: 41 }), summary('sk-9', { isBlocked: false, updatedAt: ts(2) })],
      hasMore: false,
    });

    await deliver(envelope(type, 'sk-8', { row: eventRow('sk-8', { ...fields, updatedAt: ts(6), rowSeq: 41 }) }));

    expect(readsOf('L')).toBe(1);
    expect(rowOf(L, 'sk-9')?.isBlocked).toBe(false);
    expect(rowOf(L, 'sk-8')).toMatchObject(fields);
  });
});
