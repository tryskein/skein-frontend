/**
 * Phase 2 — membership and continuation of a Tasks-column list (spec
 * sk-622.21 US-15, SC-007 phase 2; plan T049, K21). Test-plan row No. 88.
 *
 * The real `useTasks` hook is mounted inside the real `LiveEventsProvider`
 * on a fake hub; envelopes go to the provider's `event` handler. The list
 * endpoints are replaced by a LITERAL server: pages written out by hand in
 * the server's order (`updated_at DESC, id DESC`, keyset cursor — skein-api
 * `issues/store.go#ListIssues`), answered by cursor. What a continuation
 * must give is read off that literal answer, never computed by the code
 * under test.
 *
 * Out of reach of a hook test: "no focus change" — the hook has no focus;
 * what is proven here is that the row arrives through the first-page
 * re-read and nothing else is done to the list.
 */
import { type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import * as signalr from '@microsoft/signalr';

import type {
  IssueSummary,
  ListAllIssuesParams,
  ListAllIssuesResult,
  ListIssuesParams,
  ListIssuesResult,
  ListMineParams,
  OriginFilter,
  PriorityFilter,
  StatusFilter,
  TypeFilter,
  TasksSortKey,
} from '../../api/issues';
import type { SearchParams, SearchResponse } from '../../api/search';
import type { EventEnvelope } from '../eventEnvelope';
import type { UseTasksResult } from '../useTasks';

const P = '11111111-2222-3333-4444-555555555555';
const ME = 'u-1';

const listIssuesSpy = vi.fn<(projectId: string, params?: ListIssuesParams) => Promise<ListIssuesResult>>();
const listAllIssuesSpy = vi.fn<(params?: ListAllIssuesParams) => Promise<ListAllIssuesResult>>();
const listCreatedByMeSpy = vi.fn<(params?: ListMineParams) => Promise<ListIssuesResult>>();
const listAssignedToMeSpy = vi.fn<(params?: ListMineParams) => Promise<ListIssuesResult>>();
const globalSearchSpy = vi.fn<(params: SearchParams) => Promise<SearchResponse>>();

vi.mock('../../api/issues', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/issues')>();
  return {
    ...actual,
    listIssues: (...args: [string, ListIssuesParams?]) => listIssuesSpy(...args),
    listAllIssues: (...args: [ListAllIssuesParams?]) => listAllIssuesSpy(...args),
    listCreatedByMe: (...args: [ListMineParams?]) => listCreatedByMeSpy(...args),
    listAssignedToMe: (...args: [ListMineParams?]) => listAssignedToMeSpy(...args),
  };
});

vi.mock('../../api/search', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/search')>();
  return { ...actual, globalSearch: (...args: [SearchParams]) => globalSearchSpy(...args) };
});

vi.mock('../useProjectByHandle', () => ({
  useProjectByHandle: (handle: string | null) =>
    handle === null
      ? { project: null, isLoading: false, isUnresolved: false }
      : { project: { id: P, idPrefix: handle, name: 'test' }, isLoading: false, isUnresolved: false },
}));

vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: ME, username: 'ann', role: 'user' }, logout: () => Promise.resolve() }),
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

// Imported after the mocks.
const { LiveEventsProvider } = await import('../../hooks/useLiveEvents');
const { LIVE_INVALIDATION_WINDOW_MS } = await import('../liveInvalidationBatcher');
const { useTasks } = await import('../useTasks');

function ts(n: number): string {
  return `2026-10-01T10:00:${String(n).padStart(2, '0')}.000001Z`;
}

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

/** The neutral row of an event (no reader fields), from a list row. */
function rowFrom(s: IssueSummary, over: Partial<IssueSummary>): Record<string, unknown> {
  const { isBlocked: _b, epicProgress: _e, iAssigned: _i, ...rest } = { ...s, ...over };
  return rest;
}

let nextEnvelopeId = 1;
function envelope(eventType: string, entityId: string, extra: Partial<EventEnvelope>): EventEnvelope {
  return {
    id: nextEnvelopeId++,
    occurredAt: '2026-10-01T10:01:00Z',
    eventType,
    entityType: 'issue',
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

/** A literal server: pages by cursor (`undefined` = first page). */
type Pages = Record<string, ListIssuesResult>;
let pages: Pages;
const FIRST = '<first>';

/** Every list read, in order, as the cursor it asked for. */
let calls: Array<string | null | undefined>;

function serveFrom(): void {
  const answer = (cursor: string | null | undefined) => {
    calls.push(cursor);
    return Promise.resolve(pages[cursor ?? FIRST]);
  };
  listIssuesSpy.mockImplementation((_pid, params) => answer(params?.cursor));
  listAllIssuesSpy.mockImplementation((params) => answer(params?.cursor).then((r) => ({ ...r, total: r.total ?? 0 })));
  listCreatedByMeSpy.mockImplementation((params) => answer(params?.cursor));
  listAssignedToMeSpy.mockImplementation((params) => answer(params?.cursor));
  globalSearchSpy.mockImplementation(() => Promise.resolve({
    items: (pages[FIRST]?.items ?? []).map((i) => ({
      kind: 'issue' as const, id: i.id, title: i.title, projectId: P, projectName: 'test', snippet: '',
      score: 1, exactMatch: false, updatedAt: i.updatedAt, status: i.status, type: i.type, priority: i.priority, pinned: i.pinned,
    })),
    nextCursor: null, hasMore: false, degraded: false, tookMs: 1,
  }));
}

/** Calls of the list endpoints after the mount, as cursors. */
function listCalls(): Array<string | null | undefined> {
  return calls;
}

interface HarnessArgs {
  selectedProject?: string | null;
  selectedComponent?: string | null;
  outboxMode?: boolean;
  typeFilter?: TypeFilter;
  priorityFilter?: PriorityFilter;
  assigneeFilter?: string | null;
  statusFilter?: StatusFilter;
  originFilter?: OriginFilter;
  sort?: TasksSortKey;
  onMeMode?: boolean;
  search?: string;
}

let last: UseTasksResult | null = null;
let qc: QueryClient;

function Harness(args: HarnessArgs) {
  last = useTasks({
    selectedProject: args.selectedProject === undefined ? 'sk' : args.selectedProject,
    selectedComponent: args.selectedComponent ?? null,
    outboxMode: args.outboxMode ?? false,
    onMeMode: args.onMeMode ?? false,
    statusFilter: args.statusFilter ?? 'all',
    originFilter: args.originFilter ?? 'all',
    typeFilter: args.typeFilter ?? 'all',
    priorityFilter: args.priorityFilter ?? 'all',
    search: args.search ?? '',
    sort: args.sort ?? 'updated',
    assigneeFilter: args.assigneeFilter ?? null,
  });
  return null;
}

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <LiveEventsProvider>{children}</LiveEventsProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Mount, load `loadPages` pages, then forget the calls made so far. */
async function mount(args: HarnessArgs, loadPages = 1): Promise<void> {
  await act(async () => {
    render(<Wrapper><Harness {...args} /></Wrapper>);
  });
  await advance(1_000);
  for (let i = 1; i < loadPages; i += 1) {
    await act(async () => { last!.fetchNextPage(); });
    await advance(100);
  }
  calls = [];
  globalSearchSpy.mockClear();
}

async function deliver(env: EventEnvelope): Promise<void> {
  act(() => hub.handlers.get('event')!(env));
  await advance(LIVE_INVALIDATION_WINDOW_MS + 300);
}

const ids = () => (last?.data ?? []).map((r) => r.id);
const loadedPageCount = (key: readonly unknown[]) =>
  (qc.getQueryData<{ pages: unknown[] }>(key)?.pages ?? []).length;

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  hub.handlers.clear();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  listIssuesSpy.mockReset();
  listAllIssuesSpy.mockReset();
  listCreatedByMeSpy.mockReset();
  listAssignedToMeSpy.mockReset();
  globalSearchSpy.mockReset();
  listAllIssuesSpy.mockResolvedValue({ items: [], total: 0, hasMore: false, nextCursor: null });
  listCreatedByMeSpy.mockResolvedValue({ items: [], total: 0, hasMore: false, nextCursor: null });
  listAssignedToMeSpy.mockResolvedValue({ items: [], total: 0, hasMore: false, nextCursor: null });
  last = null;
  calls = [];
});

afterEach(() => {
  cleanup();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('No. 88 — membership and continuation (US-15, K21)', () => {
  test('two pages loaded: an edit that moves the server order but not the screen order (priority sort) — continuation without gaps or repeats', async () => {
    // Server order before: A(9) B(8) | C(7) D(6) | E(5); screen: by priority.
    const A = summary('sk-a', { priority: 0, updatedAt: ts(9) });
    const B = summary('sk-b', { priority: 1, updatedAt: ts(8) });
    const C = summary('sk-c', { priority: 2, updatedAt: ts(7) });
    const D = summary('sk-d', { priority: 3, updatedAt: ts(6) });
    const E = summary('sk-e', { priority: 4, updatedAt: ts(5) });
    pages = {
      [FIRST]: { items: [A, B], total: 5, hasMore: true, nextCursor: 'c1' },
      c1: { items: [C, D], total: 5, hasMore: true, nextCursor: 'c2' },
      // The continuation after D's OLD key — (6, sk-d): the server answers
      // the rows below it, whatever moved above.
      c2: { items: [E], total: 5, hasMore: false, nextCursor: null },
    };
    serveFrom();
    await mount({ sort: 'priority' }, 2);
    expect(ids()).toEqual(['sk-a', 'sk-b', 'sk-c', 'sk-d']);

    // D is renamed: its updated_at moves to the top of the server order.
    await deliver(envelope('issue.updated', 'sk-d', {
      changedFields: ['title'],
      row: rowFrom(D, { title: 'D renamed', version: 4, updatedAt: ts(10), rowSeq: 41 }),
    }));
    expect(listCalls()).toEqual([]);
    expect(ids()).toEqual(['sk-a', 'sk-b', 'sk-c', 'sk-d']);

    await act(async () => { last!.fetchNextPage(); });
    await advance(100);

    // Exactly the continuation, and the whole list is the server's set once.
    expect(listCalls()).toEqual(['c2']);
    expect(ids()).toEqual(['sk-a', 'sk-b', 'sk-c', 'sk-d', 'sk-e']);
    expect(last?.data?.find((r) => r.id === 'sk-d')?.title).toBe('D renamed');
  });

  test('closing a task in the «open» list re-reads it from the first page; the loaded tail is dropped', async () => {
    const A = summary('sk-a', { updatedAt: ts(9) });
    const B = summary('sk-b', { updatedAt: ts(8) });
    const C = summary('sk-c', { updatedAt: ts(7) });
    pages = {
      [FIRST]: { items: [A, B], total: 3, hasMore: true, nextCursor: 'c1' },
      c1: { items: [C], total: 3, hasMore: false, nextCursor: null },
    };
    serveFrom();
    await mount({ statusFilter: 'open' }, 2);
    expect(ids()).toEqual(['sk-a', 'sk-b', 'sk-c']);

    // The server after the close: B is gone.
    pages = {
      [FIRST]: { items: [A], total: 2, hasMore: true, nextCursor: 'c1' },
      c1: { items: [C], total: 2, hasMore: false, nextCursor: null },
    };
    await deliver(envelope('issue.closed', 'sk-b', {
      row: rowFrom(B, { status: 'closed', closeOutcome: 'done', updatedAt: ts(10), rowSeq: 41 }),
    }));

    expect(listCalls()).toEqual([undefined]);
    expect(ids()).toEqual(['sk-a']);
    expect(loadedPageCount(last!.cacheKey)).toBe(1);
  });

  test('re-assignment away from me re-reads «on me» from the first page', async () => {
    const A = summary('sk-a', { assignee: 'ann', assigneeUserId: ME, acceptedAt: ts(3), updatedAt: ts(9) });
    const B = summary('sk-b', { assignee: 'ann', assigneeUserId: ME, acceptedAt: ts(3), updatedAt: ts(8) });
    pages = { [FIRST]: { items: [A, B], total: 2, hasMore: false, nextCursor: null } };
    serveFrom();
    await mount({ onMeMode: true });

    pages = { [FIRST]: { items: [B], total: 1, hasMore: false, nextCursor: null } };
    await deliver(envelope('issue.updated', 'sk-a', {
      changedFields: ['assignee'],
      row: rowFrom(A, { assignee: 'bob', assigneeUserId: 'u-2', acceptedAt: undefined, updatedAt: ts(10), rowSeq: 41 }),
    }));

    expect(listCalls()).toEqual([undefined]);
    expect(ids()).toEqual(['sk-b']);
  });

  test.each<[string, HarnessArgs]>([
    ['a source filter', { originFilter: 'human-driven' }],
    ['a blocked filter', { statusFilter: 'blocked' }],
  ])('a list with %s is re-read from the first page on a title change of its row', async (_n, args) => {
    const A = summary('sk-a', { updatedAt: ts(9), isBlocked: args.statusFilter === 'blocked' });
    pages = { [FIRST]: { items: [A], total: 1, hasMore: false, nextCursor: null } };
    serveFrom();
    await mount(args);

    await deliver(envelope('issue.updated', 'sk-a', {
      changedFields: ['title'],
      row: rowFrom(A, { title: 'renamed', updatedAt: ts(10), rowSeq: 41 }),
    }));

    expect(listCalls()).toEqual([undefined]);
  });

  test('a list with a text search is re-read from the first page on a title change of its row', async () => {
    const A = summary('sk-a', { updatedAt: ts(9) });
    pages = { [FIRST]: { items: [A], total: 1, hasMore: false, nextCursor: null } };
    serveFrom();
    await mount({ search: 'sk' });

    await deliver(envelope('issue.updated', 'sk-a', {
      changedFields: ['title'],
      row: rowFrom(A, { title: 'renamed', updatedAt: ts(10), rowSeq: 41 }),
    }));

    expect(globalSearchSpy.mock.calls.map((c) => c[0].cursor)).toEqual([undefined]);
  });

  test('source filter, updated order: a matching task outside the loaded part arrives on the first page; a non-matching one is not inserted', async () => {
    const A = summary('sk-a', { updatedAt: ts(9) });
    const B = summary('sk-b', { updatedAt: ts(8) });
    const Z = summary('sk-z', { updatedAt: ts(2) });
    pages = {
      [FIRST]: { items: [A, B], total: 3, hasMore: true, nextCursor: 'c1' },
      c1: { items: [Z], total: 3, hasMore: false, nextCursor: null },
    };
    serveFrom();
    await mount({ originFilter: 'human-driven' });
    expect(ids()).toEqual(['sk-a', 'sk-b']);

    // Z (matching, not loaded) is renamed — the server puts it on top.
    pages = {
      [FIRST]: { items: [{ ...Z, title: 'Z renamed', updatedAt: ts(10) }, A], total: 3, hasMore: true, nextCursor: 'c1' },
      c1: { items: [B], total: 3, hasMore: false, nextCursor: null },
    };
    await deliver(envelope('issue.updated', 'sk-z', {
      changedFields: ['title'],
      row: rowFrom(Z, { title: 'Z renamed', updatedAt: ts(10), rowSeq: 41 }),
    }));
    expect(listCalls()).toEqual([undefined]);
    expect(ids()).toEqual(['sk-z', 'sk-a']);

    // An agent-autonomous task (not in this list) is renamed: the server's
    // first page does not have it, and the client inserts nothing itself.
    calls = [];
    await deliver(envelope('issue.updated', 'sk-q', {
      changedFields: ['title'],
      row: rowFrom(summary('sk-q'), { title: 'Q renamed', updatedAt: ts(11), rowSeq: 41 }),
    }));
    expect(listCalls()).toEqual([undefined]);
    expect(ids()).toEqual(['sk-z', 'sk-a']);
  });

  test('source filter, created order: a title change of a matching task outside the loaded part does not put it on the first page', async () => {
    const A = summary('sk-a', { createdAt: ts(9), updatedAt: ts(9) });
    const B = summary('sk-b', { createdAt: ts(8), updatedAt: ts(8) });
    const Z = summary('sk-z', { createdAt: ts(2), updatedAt: ts(2) });
    pages = {
      [FIRST]: { items: [A, B], total: 3, hasMore: true, nextCursor: 'c1' },
      c1: { items: [Z], total: 3, hasMore: false, nextCursor: null },
    };
    serveFrom();
    await mount({ originFilter: 'human-driven', sort: 'created' });

    await deliver(envelope('issue.updated', 'sk-z', {
      changedFields: ['title'],
      row: rowFrom(Z, { title: 'Z renamed', updatedAt: ts(10), rowSeq: 41 }),
    }));

    expect(listCalls()).toEqual([undefined]);
    expect(ids()).toEqual(['sk-a', 'sk-b']);
  });

  test('computable filter: a row entering the loaded range re-reads from the first page; one beyond it does nothing', async () => {
    const A = summary('sk-a', { status: 'open', createdAt: ts(9), updatedAt: ts(9) });
    const B = summary('sk-b', { status: 'open', createdAt: ts(8), updatedAt: ts(8) });
    pages = { [FIRST]: { items: [A, B], total: 4, hasMore: true, nextCursor: 'c1' } };
    serveFrom();
    await mount({ statusFilter: 'open', sort: 'created' });

    // Beyond the loaded range in created order (created before B): the
    // continuation brings it, nothing to do now.
    await deliver(envelope('issue.status_changed', 'sk-y', {
      row: rowFrom(summary('sk-y', { createdAt: ts(3) }), { status: 'open', updatedAt: ts(10), rowSeq: 41 }),
    }));
    expect(listCalls()).toEqual([]);

    // Inside it (created between A and B): it entered.
    await deliver(envelope('issue.status_changed', 'sk-x', {
      row: rowFrom(summary('sk-x', { createdAt: ts(8) }), { status: 'open', createdAt: '2026-10-01T10:00:08.500000Z', updatedAt: ts(11), rowSeq: 41 }),
    }));
    expect(listCalls()).toEqual([undefined]);
  });

  // ── which conditions the row can answer, list by list ──────────────

  /** One loaded page of `rows`, all of it (no continuation). */
  function onePage(...rows: IssueSummary[]): void {
    pages = { [FIRST]: { items: rows, total: rows.length, hasMore: false, nextCursor: null } };
  }

  test.each<[string, HarnessArgs, Partial<IssueSummary>, Partial<IssueSummary>]>([
    ['«All projects»', { selectedProject: null }, { assignee: 'bob' }, { assignee: 'bob' }],
    ['«All projects», type filter on the wire', { selectedProject: null, typeFilter: 'bug' }, { type: 'bug' }, { type: 'bug' }],
    ['«All projects», assignee filter (case-insensitive on this endpoint)', { selectedProject: null, assigneeFilter: 'Bob' }, { assignee: 'bob' }, { assignee: 'bob' }],
    ['a priority filter', { priorityFilter: '1' }, { priority: 1 }, { priority: 1 }],
    ['a component filter', { selectedComponent: 'c-1' }, { componentIds: ['c-1'] }, { componentIds: ['c-1'] }],
    ['an assignee filter (exact on the project endpoint)', { assigneeFilter: 'bob' }, { assignee: 'bob' }, { assignee: 'bob' }],
    ['the «active» pill (no status on the wire)', { statusFilter: 'active' }, {}, { status: 'closed', closeOutcome: 'done' }],
    ['«on me», the row stays mine', { onMeMode: true }, { assignee: 'ann', assigneeUserId: ME, acceptedAt: ts(3) }, { assignee: 'ann', assigneeUserId: ME, acceptedAt: ts(3) }],
  ])('%s: the row stays in the list — laid in, no request', async (_n, args, shown, after) => {
    const A = summary('sk-a', { ...shown, updatedAt: ts(9) });
    onePage(A);
    serveFrom();
    await mount(args);

    await deliver(envelope('issue.updated', 'sk-a', {
      changedFields: ['title'],
      row: rowFrom(A, { ...after, title: 'renamed', updatedAt: ts(10), rowSeq: 41 }),
    }));

    expect(listCalls()).toEqual([]);
    const shownRow = qc.getQueryData<{ pages: Array<{ items: IssueSummary[] }> }>(last!.cacheKey)?.pages[0].items[0];
    expect(shownRow?.title).toBe('renamed');
  });

  test.each<[string, HarnessArgs, Partial<IssueSummary>, Partial<IssueSummary>]>([
    ['«All projects», type filter: the type changes away', { selectedProject: null, typeFilter: 'bug' }, { type: 'bug' }, { type: 'task' }],
    ['«All projects», assignee filter: re-assigned', { selectedProject: null, assigneeFilter: 'bob' }, { assignee: 'bob' }, { assignee: 'cid' }],
    ['a priority filter: the priority changes away', { priorityFilter: '1' }, { priority: 1 }, { priority: 2 }],
    ['a component filter: the component is removed', { selectedComponent: 'c-1' }, { componentIds: ['c-1'] }, { componentIds: [] }],
    ['an assignee filter: re-assigned', { assigneeFilter: 'bob' }, { assignee: 'bob' }, { assignee: 'Bob' }],
    ['«on me»: I am the author now', { onMeMode: true }, { assignee: 'ann', assigneeUserId: ME, acceptedAt: ts(3) }, { assignee: 'ann', assigneeUserId: ME, acceptedAt: ts(3), createdBy: ME }],
    ['«on me»: re-assigned, the accept stamp still on the row', { onMeMode: true }, { assignee: 'ann', assigneeUserId: ME, acceptedAt: ts(3) }, { assignee: 'cid', assigneeUserId: 'u-3', acceptedAt: ts(3) }],
    ['«on me»: not accepted any more', { onMeMode: true }, { assignee: 'ann', assigneeUserId: ME, acceptedAt: ts(3) }, { assignee: 'ann', assigneeUserId: ME, acceptedAt: undefined }],
  ])('%s — the row left, the list is re-read from the first page', async (_n, args, shown, after) => {
    const A = summary('sk-a', { ...shown, updatedAt: ts(9) });
    onePage(A);
    serveFrom();
    await mount(args);

    await deliver(envelope('issue.updated', 'sk-a', {
      changedFields: ['title'],
      row: rowFrom(A, { ...after, updatedAt: ts(10), rowSeq: 41 }),
    }));

    expect(listCalls()).toEqual([undefined]);
  });

  test.each<[string, HarnessArgs]>([
    ['a blocked filter', { statusFilter: 'blocked' }],
    ['the delegated lens of a project', { outboxMode: true }],
    ['a text search over all projects', { selectedProject: null, search: 'sk' }],
  ])('%s: an event of a row the list does not show still re-reads it from the first page', async (_n, args) => {
    onePage(summary('sk-a', { updatedAt: ts(9), isBlocked: args.statusFilter === 'blocked' }));
    serveFrom();
    await mount(args);

    await deliver(envelope('issue.updated', 'sk-q', {
      changedFields: ['title'],
      row: rowFrom(summary('sk-q'), { title: 'Q', updatedAt: ts(10), rowSeq: 41 }),
    }));

    expect([...listCalls(), ...globalSearchSpy.mock.calls.map((c) => c[0].cursor)]).toEqual([undefined]);
  });

  test('a personal lens («delegated», all projects) follows the event only for a row it shows', async () => {
    onePage(summary('sk-a', { createdBy: ME, assignee: 'bob', assigneeUserId: 'u-2', updatedAt: ts(9) }));
    serveFrom();
    await mount({ selectedProject: null, outboxMode: true });

    // A row it does not show: membership comes from the `tasks` signal.
    await deliver(envelope('issue.updated', 'sk-q', {
      changedFields: ['title'],
      row: rowFrom(summary('sk-q', { createdBy: ME }), { title: 'Q', updatedAt: ts(10), rowSeq: 41 }),
    }));
    expect(listCalls()).toEqual([]);

    // A row it shows: its condition is not on the row — first page.
    await deliver(envelope('issue.updated', 'sk-a', {
      changedFields: ['title'],
      row: rowFrom(summary('sk-a', { createdBy: ME, assignee: 'bob', assigneeUserId: 'u-2' }), { title: 'A', updatedAt: ts(11), rowSeq: 41 }),
    }));
    expect(listCalls()).toEqual([undefined]);
  });

  describe('«on me» over all projects (`/me/assigned-to`): its conditions are on the row', () => {
    // Review of wave skein-frontend/4 (fable MINOR-1). skein-api
    // `issues/list_by_user.go`: `ua.id = me`, `created_by <> me`,
    // `accepted_at IS NOT NULL`, no status = active work only, order
    // `updated_at DESC, id DESC`.
    const mine = { assignee: 'ann', assigneeUserId: ME, acceptedAt: ts(3) };
    const ON_ME = { selectedProject: null, onMeMode: true } as const;

    test.each<[string, StatusFilter]>([
      ['the «all» pill', 'all'],
      ['the «active» pill', 'active'],
    ])('%s: a title change of a shown row is laid in without a request', async (_n, statusFilter) => {
      const A = summary('sk-a', { ...mine, updatedAt: ts(9) });
      const B = summary('sk-b', { ...mine, updatedAt: ts(8) });
      onePage(A, B);
      serveFrom();
      await mount({ ...ON_ME, statusFilter });

      await deliver(envelope('issue.updated', 'sk-b', {
        changedFields: ['title'],
        row: rowFrom(B, { title: 'renamed', updatedAt: ts(10), rowSeq: 41 }),
      }));

      expect(listCalls()).toEqual([]);
      expect(ids()).toEqual(['sk-b', 'sk-a']);
      expect((last?.data ?? []).find((r) => r.id === 'sk-b')?.title).toBe('renamed');
    });

    test.each<[string, StatusFilter, Partial<IssueSummary>]>([
      ['re-assigned', 'all', { assignee: 'cid', assigneeUserId: 'u-3' }],
      ['closed under the «active» pill', 'active', { status: 'closed', closeOutcome: 'done' }],
      ['made standing under the «active» pill', 'active', { status: 'standing' }],
    ])('a shown row %s left: first page', async (_n, statusFilter, change) => {
      const A = summary('sk-a', { ...mine, updatedAt: ts(9) });
      onePage(A);
      serveFrom();
      await mount({ ...ON_ME, statusFilter });

      await deliver(envelope('issue.updated', 'sk-a', {
        changedFields: ['assignee'],
        row: rowFrom(A, { ...change, updatedAt: ts(10), rowSeq: 41 }),
      }));

      expect(listCalls()).toEqual([undefined]);
    });

    test.each<[string, Partial<IssueSummary>, Array<string | undefined>]>([
      ['still open: laid in, no request', {}, []],
      ['closed: it left, first page', { status: 'closed', closeOutcome: 'done' }, [undefined]],
      ['taken in progress: it left, first page', { status: 'in_progress' }, [undefined]],
      ['now authored by me: it left, first page', { createdBy: ME }, [undefined]],
    ])('the «open» pill, a shown row %s', async (_n, change, expected) => {
      const A = summary('sk-a', { ...mine, status: 'open', updatedAt: ts(9) });
      onePage(A);
      serveFrom();
      await mount({ ...ON_ME, statusFilter: 'open' });

      await deliver(envelope('issue.updated', 'sk-a', {
        changedFields: ['title'],
        row: rowFrom(A, { ...change, title: 'renamed', updatedAt: ts(10), rowSeq: 41 }),
      }));

      expect(listCalls()).toEqual(expected);
    });

    test('with a source filter (not on the row): a title change of a shown row re-reads from the first page', async () => {
      const A = summary('sk-a', { ...mine, updatedAt: ts(9) });
      onePage(A);
      serveFrom();
      await mount({ ...ON_ME, originFilter: 'human-driven' });

      await deliver(envelope('issue.updated', 'sk-a', {
        changedFields: ['title'],
        row: rowFrom(A, { title: 'renamed', updatedAt: ts(10), rowSeq: 41 }),
      }));

      expect(listCalls()).toEqual([undefined]);
    });

    test('a row it does not show sends nothing: membership comes from the `tasks` signal', async () => {
      onePage(summary('sk-a', { ...mine, updatedAt: ts(9) }));
      serveFrom();
      await mount(ON_ME);

      await deliver(envelope('issue.updated', 'sk-q', {
        changedFields: ['title'],
        row: rowFrom(summary('sk-q', mine), { title: 'Q', updatedAt: ts(10), rowSeq: 41 }),
      }));

      expect(listCalls()).toEqual([]);
    });
  });

  test('a list of another project is not touched by a row of this one', async () => {
    onePage(summary('sk-a', { updatedAt: ts(9) }));
    serveFrom();
    await mount({});

    await deliver(envelope('issue.updated', 'xx-1', {
      projectId: 'ffffffff-0000-0000-0000-000000000009',
      changedFields: ['title'],
      row: { ...rowFrom(summary('xx-1'), { title: 'X', updatedAt: ts(10), rowSeq: 41 }), projectId: 'ffffffff-0000-0000-0000-000000000009' },
    }));

    expect(listCalls()).toEqual([]);
  });

  test('computable filter, everything loaded: an event of a task outside the list sends nothing', async () => {
    onePage(summary('sk-a', { status: 'open', updatedAt: ts(9) }));
    serveFrom();
    await mount({ statusFilter: 'open' });

    await deliver(envelope('issue.status_changed', 'sk-q', {
      row: rowFrom(summary('sk-q'), { status: 'closed', closeOutcome: 'done', updatedAt: ts(10), rowSeq: 41 }),
    }));

    expect(listCalls()).toEqual([]);
  });

  test.each<[string, HarnessArgs]>([
    ['a project list in created order', { statusFilter: 'open', sort: 'created' }],
    ['«All projects»', { selectedProject: null, statusFilter: 'open' }],
  ])('%s, everything loaded: a task that starts matching enters — first page, even sorting after the last row', async (_n, args) => {
    onePage(summary('sk-a', { status: 'open', createdAt: ts(9), updatedAt: ts(9) }));
    serveFrom();
    await mount(args);

    await deliver(envelope('issue.status_changed', 'sk-q', {
      row: rowFrom(summary('sk-q', { createdAt: ts(1), updatedAt: ts(1) }), { status: 'open', rowSeq: 41 }),
    }));

    expect(listCalls()).toEqual([undefined]);
  });

  test.each<[string, HarnessArgs]>([
    ['the delegated lens of a project', { outboxMode: true }],
    ['«All projects» with a source filter', { selectedProject: null, originFilter: 'human-driven' }],
  ])('%s: a title change of a shown row re-reads from the first page (its condition is not on the row)', async (_n, args) => {
    const A = summary('sk-a', { createdBy: ME, assignee: 'bob', assigneeUserId: 'u-2', updatedAt: ts(9) });
    onePage(A);
    serveFrom();
    await mount(args);

    await deliver(envelope('issue.updated', 'sk-a', {
      changedFields: ['title'],
      row: rowFrom(A, { title: 'renamed', updatedAt: ts(10), rowSeq: 41 }),
    }));

    expect(listCalls()).toEqual([undefined]);
  });

  test.each<[string, string]>([
    ['a middle row', 'sk-b'],
    ['the last row', 'sk-c'],
  ])('created order, two pages: an edit of %s keeps the server order of the loaded rows', async (_n, edited) => {
    const A = summary('sk-a', { createdAt: ts(9), updatedAt: ts(9) });
    const B = summary('sk-b', { createdAt: ts(8), updatedAt: ts(8) });
    const C = summary('sk-c', { createdAt: ts(7), updatedAt: ts(7) });
    pages = {
      [FIRST]: { items: [A, B], total: 4, hasMore: true, nextCursor: 'c1' },
      c1: { items: [C], total: 4, hasMore: true, nextCursor: 'c2' },
    };
    serveFrom();
    await mount({ sort: 'created' }, 2);
    const src = edited === 'sk-b' ? B : C;

    await deliver(envelope('issue.updated', edited, {
      changedFields: ['title'],
      row: rowFrom(src, { title: 'renamed', updatedAt: ts(11), rowSeq: 41 }),
    }));

    expect(listCalls()).toEqual([]);
    const cached = qc.getQueryData<{ pages: Array<{ items: IssueSummary[] }> }>(last!.cacheKey)!;
    expect(cached.pages.map((p) => p.items.map((r) => r.id))).toEqual([['sk-a', 'sk-b'], ['sk-c']]);
  });

  test('a personal lens shows the row on its second page only: it still follows the event', async () => {
    const A = summary('sk-a', { createdBy: ME, assignee: 'bob', assigneeUserId: 'u-2', updatedAt: ts(9) });
    const B = summary('sk-b', { createdBy: ME, assignee: 'bob', assigneeUserId: 'u-2', updatedAt: ts(8) });
    const C = summary('sk-c', { createdBy: ME, assignee: 'bob', assigneeUserId: 'u-2', updatedAt: ts(7) });
    pages = {
      [FIRST]: { items: [A], total: 3, hasMore: true, nextCursor: 'c1' },
      c1: { items: [B, C], total: 3, hasMore: false, nextCursor: null },
    };
    serveFrom();
    await mount({ selectedProject: null, outboxMode: true }, 2);

    await deliver(envelope('issue.updated', 'sk-b', {
      changedFields: ['title'],
      row: rowFrom(B, { title: 'renamed', updatedAt: ts(10), rowSeq: 41 }),
    }));

    expect(listCalls()).toEqual([undefined]);
  });

  test('«All projects» with a source filter: an event of a row it does not show re-reads it from the first page', async () => {
    onePage(summary('sk-a', { updatedAt: ts(9) }));
    serveFrom();
    await mount({ selectedProject: null, originFilter: 'human-driven' });

    await deliver(envelope('issue.updated', 'sk-q', {
      changedFields: ['title'],
      row: rowFrom(summary('sk-q'), { title: 'Q', updatedAt: ts(10), rowSeq: 41 }),
    }));

    expect(listCalls()).toEqual([undefined]);
  });

  test('a text search of this project is not re-read by a row of another project', async () => {
    onePage(summary('sk-a', { updatedAt: ts(9) }));
    serveFrom();
    await mount({ search: 'sk' });
    globalSearchSpy.mockClear();
    const OTHER = 'ffffffff-0000-0000-0000-000000000009';

    await deliver(envelope('issue.updated', 'xx-1', {
      projectId: OTHER,
      changedFields: ['title'],
      row: { ...rowFrom(summary('xx-1'), { title: 'X', updatedAt: ts(10), rowSeq: 41 }), projectId: OTHER },
    }));

    expect(globalSearchSpy).not.toHaveBeenCalled();
  });
});

