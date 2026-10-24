/**
 * sk-622.21 T041 — the tab's project declaration (spec US-9,
 * R1′, R2).
 *
 * Driven through the real `LiveEventsProvider` with the SignalR module
 * replaced by a fake hub, the way `src/hooks/useLiveEvents.test.tsx` does
 * it. What is observed is what the hub receives: the arguments of
 * `connection.invoke('DeclareProjects' | 'DeclareAllVisible', …)`.
 *
 * Sources: the route / open card / expanded rows / `/activity` register
 * through the public hooks `useDeclareProjects` / `useDeclareAllVisible`
 * (the components that call them are thin wrappers); the rows' projects
 * come from ACTIVE queries in the QueryCache under the real key shapes of
 * the tasks column (`useTasks.ts`) and the tree (`useLayeredTree.ts`).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import * as signalr from '@microsoft/signalr';
import { LiveEventsProvider } from '../hooks/useLiveEvents';
import {
  DECLARE_DEBOUNCE_MS,
  DECLARE_RATE_LIMIT,
  DECLARE_RATE_WINDOW_MS,
  DECLARE_RETRY_DELAYS_MS,
  useDeclareAllVisible,
  useDeclareProjects,
  type DeclarationSource,
} from './liveProjectDeclaration';

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

  const registry: {
    conn: FakeConn | null;
    invokeImpl: (method: string, arg: unknown) => Promise<unknown>;
  } = {
    conn: null,
    invokeImpl: (_method, arg) =>
      Promise.resolve({ accepted: Array.isArray(arg) ? arg : [], rejected: [] }),
  };

  class FakeConn {
    state: string = HubConnectionState.Disconnected;
    on = vi.fn();
    onclose = vi.fn();
    onreconnecting = vi.fn();
    onreconnected = vi.fn();
    invoke = vi.fn((method: string, arg: unknown) => registry.invokeImpl(method, arg));
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

const mock = (signalr as unknown as {
  __mock: {
    conn: {
      invoke: ReturnType<typeof vi.fn>;
      onreconnecting: ReturnType<typeof vi.fn>;
      onreconnected: ReturnType<typeof vi.fn>;
    } | null;
    invokeImpl: (method: string, arg: unknown) => Promise<unknown>;
  };
}).__mock;

// ─────────────────────────── Fixtures ───────────────────────────

const P_ROUTE = '00000000-0000-0000-0000-00000000000a';
const P_CARD = '00000000-0000-0000-0000-00000000000b';
const P_EXPANDED = '00000000-0000-0000-0000-00000000000c';
const P_ROWS_MANY = '00000000-0000-0000-0000-0000000000d1';
const P_ROWS_FEW = '00000000-0000-0000-0000-0000000000d2';
const P_TREE = '00000000-0000-0000-0000-0000000000e1';
const P_LENS = '00000000-0000-0000-0000-0000000000e2';
const P_BLOB = '00000000-0000-0000-0000-0000000000f1';
const P_NEW = '00000000-0000-0000-0000-0000000000f2';

/**
 * "All projects" (cross-project list) — infinite pages of `items`. The board
 * without a focused project reads the same query (`useTasks` feeds the
 * cards list and the kanban board from one array), so this key covers it.
 */
const ALL_PROJECTS_KEY = ['tasks', 'all', 'cross-project', 'active', 'all', 'all', 'all', '', 'updated', ''];
/** The "assigned to me" lens of the tasks column, no project selected. */
const LENS_KEY = ['tasks', 'me', 'on-me', 'active', 'all', 'all', 'all', '', 'updated'];
const TREE_KEY = ['issues', 'tree', '__cross__', '__forest__', 'parent-child', '__full__', '__no_blockers__'];
/** Paste-a-blob mode — out of scope, keyed outside the row prefixes. */
const BLOB_KEY = ['lookup-id-batch', ['x-1']];

function pageOf(...projectIds: string[]) {
  return {
    pages: [{ items: projectIds.map((pid, i) => ({ id: `t-${pid}-${i}`, projectId: pid })), hasMore: false }],
    pageParams: [null],
  };
}

function treeOf(...projectIds: string[]) {
  return {
    rows: projectIds.map((pid, i) => ({
      item: { id: `n-${pid}-${i}`, title: 't', status: 'open', projectId: pid },
      depth: 0,
      isReference: false,
    })),
  };
}

// ─────────────────────────── Harness ───────────────────────────

function Explicit({ source, ids }: { source: DeclarationSource; ids: string[] }) {
  useDeclareProjects(source, ids);
  return null;
}

function ActivityPage() {
  useDeclareAllVisible(true);
  return null;
}

function Rows({ queryKey }: { queryKey: readonly unknown[] }) {
  useQuery({ queryKey, queryFn: () => new Promise(() => {}), staleTime: Infinity });
  return null;
}

function setup(seed: Array<[readonly unknown[], unknown]>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  for (const [key, data] of seed) qc.setQueryData(key, data);
  const wrap = (children: ReactNode) =>
    createElement(
      QueryClientProvider,
      { client: qc },
      createElement(LiveEventsProvider, null, children),
    );
  const view = render(wrap(null));
  return {
    qc,
    show: (...children: ReactNode[]) => view.rerender(wrap(children)),
  };
}

function declareCalls(): unknown[][] {
  return mock.conn!.invoke.mock.calls.filter((c: unknown[]) => c[0] === 'DeclareProjects');
}

function allVisibleCalls(): unknown[][] {
  return mock.conn!.invoke.mock.calls.filter((c: unknown[]) => c[0] === 'DeclareAllVisible');
}

/** Let the connection's start() settle (declaration on connect runs here). */
async function settle(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  mock.conn = null;
  mock.invokeImpl = (_method, arg) =>
    Promise.resolve({ accepted: Array.isArray(arg) ? arg : [], rejected: [] });
});

afterEach(() => {
  cleanup();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ─────────────────────────── Tests ───────────────────────────

describe('project declaration — composition and priority (US-9, R1′)', () => {
  test('set = route → card → expanded → projects of shown rows by frequency; blob mode is not declared', async () => {
    const { show } = setup([
      // P_ROWS_MANY owns more shown rows than any explicit source — it
      // still comes after them: explicit sources outrank rows under the
      // limit.
      [ALL_PROJECTS_KEY, pageOf(P_ROWS_MANY, P_ROWS_MANY, P_ROWS_MANY, P_ROWS_FEW)],
      [LENS_KEY, pageOf(P_LENS, P_LENS)],
      // The route's project also has a shown row: declared once, at the
      // route's place.
      [TREE_KEY, treeOf(P_TREE, P_ROUTE)],
      [BLOB_KEY, treeOf(P_BLOB)],
    ]);
    show(
      createElement(Explicit, { key: 'r', source: 'route', ids: [P_ROUTE] }),
      createElement(Explicit, { key: 'c', source: 'card', ids: [P_CARD] }),
      createElement(Explicit, { key: 'e', source: 'expanded', ids: [P_EXPANDED] }),
      createElement(Rows, { key: 'all', queryKey: ALL_PROJECTS_KEY }),
      createElement(Rows, { key: 'lens', queryKey: LENS_KEY }),
      createElement(Rows, { key: 'tree', queryKey: TREE_KEY }),
      createElement(Rows, { key: 'blob', queryKey: BLOB_KEY }),
    );
    await settle(DECLARE_DEBOUNCE_MS);

    const calls = declareCalls();
    expect(calls).toHaveLength(1);
    const declared = calls[0][1] as string[];
    // Spec order (K18): route → card → expanded → rows by frequency.
    expect(declared.slice(0, 5)).toEqual([
      P_ROUTE,
      P_CARD,
      P_EXPANDED,
      P_ROWS_MANY, // 3 rows
      P_LENS, // 2 rows
    ]);
    // One row each: their order among themselves is not set by the spec.
    expect(new Set(declared.slice(5))).toEqual(new Set([P_ROWS_FEW, P_TREE]));
    expect(declared).toHaveLength(7);
    expect(declared).not.toContain(P_BLOB);
  });

  test('a query that is not active (no observer) does not contribute its rows', async () => {
    const { show } = setup([[ALL_PROJECTS_KEY, pageOf(P_ROWS_MANY)]]);
    show(createElement(Explicit, { key: 'r', source: 'route', ids: [P_ROUTE] }));
    await settle(DECLARE_DEBOUNCE_MS);

    const calls = declareCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toEqual([P_ROUTE]);
  });
});

describe('project declaration — a row query switched off (observerOptionsUpdated)', () => {
  test('a row query whose observer turns enabled=false stops contributing its rows', async () => {
    function Toggle({ enabled }: { enabled: boolean }) {
      useQuery({
        queryKey: TREE_KEY,
        queryFn: () => new Promise(() => {}),
        staleTime: Infinity,
        enabled,
      });
      return null;
    }
    const { show } = setup([[TREE_KEY, treeOf(P_TREE)]]);
    show(
      createElement(Explicit, { key: 'r', source: 'route', ids: [P_ROUTE] }),
      createElement(Toggle, { key: 't', enabled: true }),
    );
    await settle(DECLARE_DEBOUNCE_MS);
    expect(declareCalls()).toHaveLength(1);
    expect(declareCalls()[0][1]).toEqual([P_ROUTE, P_TREE]);

    show(
      createElement(Explicit, { key: 'r', source: 'route', ids: [P_ROUTE] }),
      createElement(Toggle, { key: 't', enabled: false }),
    );
    await settle(DECLARE_DEBOUNCE_MS);

    expect(declareCalls()).toHaveLength(2);
    expect(declareCalls()[1][1]).toEqual([P_ROUTE]);
  });
});

describe('project declaration — sending (debounce, same set, new rows)', () => {
  test('a new query with rows of another project widens the set: one DeclareProjects after the debounce', async () => {
    const { qc, show } = setup([[ALL_PROJECTS_KEY, pageOf(P_ROWS_MANY)]]);
    show(createElement(Rows, { key: 'all', queryKey: ALL_PROJECTS_KEY }));
    await settle(DECLARE_DEBOUNCE_MS);
    const before = declareCalls().length;
    expect(declareCalls()[before - 1][1]).toEqual([P_ROWS_MANY]);

    qc.setQueryData(TREE_KEY, treeOf(P_NEW));
    show(
      createElement(Rows, { key: 'all', queryKey: ALL_PROJECTS_KEY }),
      createElement(Rows, { key: 'tree', queryKey: TREE_KEY }),
    );
    await settle(DECLARE_DEBOUNCE_MS - 1);
    expect(declareCalls()).toHaveLength(before);

    await settle(1);
    expect(declareCalls()).toHaveLength(before + 1);
    expect(declareCalls()[before][1]).toEqual([P_ROWS_MANY, P_NEW]);
  });

  test('a source going away narrows the set (a collapsed row, a closed card)', async () => {
    const { show } = setup([]);
    show(
      createElement(Explicit, { key: 'r', source: 'route', ids: [P_ROUTE] }),
      createElement(Explicit, { key: 'e', source: 'expanded', ids: [P_EXPANDED] }),
    );
    await settle(DECLARE_DEBOUNCE_MS);
    const before = declareCalls().length;
    expect(declareCalls()[before - 1][1]).toEqual([P_ROUTE, P_EXPANDED]);

    show(createElement(Explicit, { key: 'r', source: 'route', ids: [P_ROUTE] }));
    await settle(DECLARE_DEBOUNCE_MS);

    expect(declareCalls()).toHaveLength(before + 1);
    expect(declareCalls()[before][1]).toEqual([P_ROUTE]);
  });

  test('new data of an already shown row query (a refetch, a next page) widens the set', async () => {
    const { qc, show } = setup([[ALL_PROJECTS_KEY, pageOf(P_ROWS_MANY)]]);
    show(createElement(Rows, { key: 'all', queryKey: ALL_PROJECTS_KEY }));
    await settle(DECLARE_DEBOUNCE_MS);
    expect(declareCalls()).toHaveLength(1);

    await act(async () => {
      qc.setQueryData(ALL_PROJECTS_KEY, pageOf(P_ROWS_MANY, P_NEW));
    });
    await settle(DECLARE_DEBOUNCE_MS);

    expect(declareCalls()).toHaveLength(2);
    expect(declareCalls()[1][1]).toEqual([P_ROWS_MANY, P_NEW]);
  });

  test('a burst of changes inside the debounce window gives a single call', async () => {
    const { show } = setup([]);
    show(createElement(Explicit, { key: 'r', source: 'route', ids: [P_ROUTE] }));
    await settle(DECLARE_DEBOUNCE_MS);
    const before = declareCalls().length;

    show(createElement(Explicit, { key: 'r', source: 'route', ids: [P_CARD] }));
    await settle(DECLARE_DEBOUNCE_MS / 2);
    show(createElement(Explicit, { key: 'r', source: 'route', ids: [P_EXPANDED] }));
    await settle(DECLARE_DEBOUNCE_MS / 2);
    show(createElement(Explicit, { key: 'r', source: 'route', ids: [P_NEW] }));
    await settle(DECLARE_DEBOUNCE_MS);

    expect(declareCalls()).toHaveLength(before + 1);
    expect(declareCalls()[before][1]).toEqual([P_NEW]);
  });

  test('re-composing the same set sends nothing', async () => {
    const { qc, show } = setup([[ALL_PROJECTS_KEY, pageOf(P_ROWS_MANY, P_ROWS_FEW)]]);
    show(
      createElement(Explicit, { key: 'r', source: 'route', ids: [P_ROUTE] }),
      createElement(Rows, { key: 'all', queryKey: ALL_PROJECTS_KEY }),
    );
    await settle(DECLARE_DEBOUNCE_MS);
    const before = mock.conn!.invoke.mock.calls.length;
    expect(declareCalls()).toHaveLength(1);

    // Same projects again: another row query over the same projects, a
    // re-registered route, a refreshed page with the same projects.
    qc.setQueryData(LENS_KEY, pageOf(P_ROWS_FEW, P_ROWS_FEW, P_ROWS_FEW));
    show(
      createElement(Explicit, { key: 'r2', source: 'route', ids: [P_ROUTE] }),
      createElement(Rows, { key: 'all', queryKey: ALL_PROJECTS_KEY }),
      createElement(Rows, { key: 'lens', queryKey: LENS_KEY }),
    );
    await act(async () => {
      qc.setQueryData(ALL_PROJECTS_KEY, pageOf(P_ROWS_FEW, P_ROWS_MANY));
    });
    await settle(DECLARE_DEBOUNCE_MS * 4);

    expect(mock.conn!.invoke.mock.calls).toHaveLength(before);
  });
});

/** The hub's default per-connection limit (spec US-9, `HUB_MAX_PROJECTS_PER_CONNECTION`). */
const HUB_LIMIT = 50;

/** A hub that keeps the first `HUB_LIMIT` ids and cuts the rest with `limit`, as the hub does. */
function limitingHub(method: string, arg: unknown): Promise<unknown> {
  if (method !== 'DeclareProjects') return Promise.resolve({ accepted: [], rejected: [] });
  const ids = arg as string[];
  return Promise.resolve({
    accepted: ids.slice(0, HUB_LIMIT),
    rejected: ids.slice(HUB_LIMIT).map((projectId) => ({ projectId, reason: 'limit' })),
  });
}

function projectId(n: number): string {
  return `00000000-0000-0000-0001-${n.toString().padStart(12, '0')}`;
}

describe('project declaration — priority under the hub limit (US-9)', () => {
  test('a project rising from the cut tail into the route is declared again, inside the kept part', async () => {
    mock.invokeImpl = limitingHub;
    const P_TAIL = projectId(999);
    // 54 projects with two shown rows each, one project with a single row:
    // with the route that is 56 projects, and the single-row one is in the
    // tail the hub cuts.
    const busy = Array.from({ length: 54 }, (_, i) => projectId(i + 1));
    const { show } = setup([[ALL_PROJECTS_KEY, pageOf(...busy, ...busy, P_TAIL)]]);
    show(
      createElement(Explicit, { key: 'r', source: 'route', ids: [P_ROUTE] }),
      createElement(Rows, { key: 'all', queryKey: ALL_PROJECTS_KEY }),
    );
    await settle(DECLARE_DEBOUNCE_MS);
    expect(declareCalls()).toHaveLength(1);
    expect((declareCalls()[0][1] as string[]).slice(0, HUB_LIMIT)).not.toContain(P_TAIL);

    // The tail project becomes the route; the old route stays as the open
    // card — the members of the whole set are the same, only the order moved.
    show(
      createElement(Explicit, { key: 'r', source: 'route', ids: [P_TAIL] }),
      createElement(Explicit, { key: 'c', source: 'card', ids: [P_ROUTE] }),
      createElement(Rows, { key: 'all', queryKey: ALL_PROJECTS_KEY }),
    );
    await settle(DECLARE_DEBOUNCE_MS);

    expect(declareCalls()).toHaveLength(2);
    const kept = (declareCalls()[1][1] as string[]).slice(0, HUB_LIMIT);
    expect(kept[0]).toBe(P_TAIL);
    expect(kept[1]).toBe(P_ROUTE);
  });

  test('a change only in the cut tail sends nothing', async () => {
    mock.invokeImpl = limitingHub;
    const busy = Array.from({ length: 54 }, (_, i) => projectId(i + 1));
    const tailA = projectId(901);
    const tailB = projectId(902);
    const { qc, show } = setup([[ALL_PROJECTS_KEY, pageOf(...busy, ...busy, tailA)]]);
    show(
      createElement(Explicit, { key: 'r', source: 'route', ids: [P_ROUTE] }),
      createElement(Rows, { key: 'all', queryKey: ALL_PROJECTS_KEY }),
    );
    await settle(DECLARE_DEBOUNCE_MS);
    expect(declareCalls()).toHaveLength(1);

    await act(async () => {
      qc.setQueryData(ALL_PROJECTS_KEY, pageOf(...busy, ...busy, tailB));
    });
    await settle(DECLARE_DEBOUNCE_MS * 2);

    expect(declareCalls()).toHaveLength(1);
  });
});

describe('project declaration — a hub call that throws is retried with a bounded back-off', () => {
  test('DeclareProjects throws once → the same set is sent again after the first back-off step, without a change', async () => {
    let attempts = 0;
    mock.invokeImpl = (_method, arg) => {
      attempts += 1;
      if (attempts === 1) return Promise.reject(new Error('access check failed'));
      return Promise.resolve({ accepted: arg as string[], rejected: [] });
    };
    const { show } = setup([]);
    show(createElement(Explicit, { key: 'r', source: 'route', ids: [P_ROUTE] }));
    // The connection declares at once, so the failed call is at t = 0.
    await settle(0);
    expect(declareCalls()).toHaveLength(1);

    await settle(DECLARE_RETRY_DELAYS_MS[0] - 1);
    expect(declareCalls()).toHaveLength(1);
    await settle(1);
    expect(declareCalls()).toHaveLength(2);
    expect(declareCalls()[1][1]).toEqual([P_ROUTE]);

    // Answered: nothing more is sent while the set stays the same.
    await settle(DECLARE_RETRY_DELAYS_MS[DECLARE_RETRY_DELAYS_MS.length - 1] * 2);
    expect(declareCalls()).toHaveLength(2);
  });

  test('DeclareAllVisible throws once → retried, then the mode is on', async () => {
    let attempts = 0;
    mock.invokeImpl = (method) => {
      if (method === 'DeclareAllVisible') {
        attempts += 1;
        if (attempts === 1) return Promise.reject(new Error('transport'));
      }
      return Promise.resolve({ accepted: [], rejected: [] });
    };
    const { show } = setup([]);
    show(createElement(ActivityPage, { key: 'activity' }));
    await settle(DECLARE_DEBOUNCE_MS);
    expect(allVisibleCalls().map((c) => c[1])).toEqual([true]);

    await settle(DECLARE_RETRY_DELAYS_MS[0]);
    expect(allVisibleCalls().map((c) => c[1])).toEqual([true, true]);
  });

  test('a hub that keeps throwing gets one retry per back-off step, then nothing until the set changes', async () => {
    mock.invokeImpl = () => Promise.reject(new Error('down'));
    const { show } = setup([]);
    show(createElement(Explicit, { key: 'r', source: 'route', ids: [P_ROUTE] }));
    await settle(DECLARE_DEBOUNCE_MS);
    const total = DECLARE_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0);
    await settle(total);
    expect(declareCalls()).toHaveLength(1 + DECLARE_RETRY_DELAYS_MS.length);

    await settle(total * 2);
    expect(declareCalls()).toHaveLength(1 + DECLARE_RETRY_DELAYS_MS.length);

    show(createElement(Explicit, { key: 'r', source: 'route', ids: [P_CARD] }));
    await settle(DECLARE_DEBOUNCE_MS);
    expect(declareCalls()).toHaveLength(2 + DECLARE_RETRY_DELAYS_MS.length);
    expect(declareCalls()[declareCalls().length - 1][1]).toEqual([P_CARD]);
  });
});

describe('project declaration — the hub rate limit and reconnects (edge 11, edge 12)', () => {
  test('changes past the rate limit wait for the window instead of being sent', async () => {
    const { show } = setup([]);
    const ids = Array.from({ length: DECLARE_RATE_LIMIT + 1 }, (_, i) => projectId(100 + i));
    for (const id of ids) {
      show(createElement(Explicit, { key: 'r', source: 'route', ids: [id] }));
      await settle(DECLARE_DEBOUNCE_MS);
    }
    // The first change went out at t = 0 on connect, each following one
    // after the debounce: the last one is past the limit and waits.
    expect(declareCalls()).toHaveLength(DECLARE_RATE_LIMIT);

    // The loop took (limit + 1) debounces; the window opens 10 s after the
    // first call (t = 0).
    await settle(DECLARE_RATE_WINDOW_MS - (DECLARE_RATE_LIMIT + 1) * DECLARE_DEBOUNCE_MS - 1);
    expect(declareCalls()).toHaveLength(DECLARE_RATE_LIMIT);
    await settle(1);
    expect(declareCalls()).toHaveLength(DECLARE_RATE_LIMIT + 1);
    expect(declareCalls()[DECLARE_RATE_LIMIT][1]).toEqual([ids[ids.length - 1]]);
  });

  test('a call refused with `rate` is sent again after the window', async () => {
    let attempts = 0;
    mock.invokeImpl = (_method, arg) => {
      attempts += 1;
      const ids = arg as string[];
      return Promise.resolve(
        attempts === 1
          ? { accepted: [], rejected: ids.map((projectId) => ({ projectId, reason: 'rate' })) }
          : { accepted: ids, rejected: [] },
      );
    };
    const { show } = setup([]);
    show(createElement(Explicit, { key: 'r', source: 'route', ids: [P_ROUTE] }));
    await settle(0);
    expect(declareCalls()).toHaveLength(1);

    await settle(DECLARE_RATE_WINDOW_MS - 1);
    expect(declareCalls()).toHaveLength(1);
    await settle(1);
    expect(declareCalls()).toHaveLength(2);
    expect(declareCalls()[1][1]).toEqual([P_ROUTE]);
  });

  test('after a reconnect the same set is declared again at once, with the "all visible" mode', async () => {
    const { show } = setup([]);
    show(
      createElement(Explicit, { key: 'r', source: 'route', ids: [P_ROUTE] }),
      createElement(ActivityPage, { key: 'activity' }),
    );
    await settle(DECLARE_DEBOUNCE_MS);
    expect(declareCalls()).toHaveLength(1);
    expect(allVisibleCalls()).toHaveLength(1);

    const reconnecting = mock.conn!.onreconnecting.mock.calls[0][0] as () => void;
    const reconnected = mock.conn!.onreconnected.mock.calls[0][0] as () => void;
    await act(async () => {
      reconnecting();
      reconnected();
    });
    await settle(0);

    expect(declareCalls()).toHaveLength(2);
    expect(declareCalls()[1][1]).toEqual([P_ROUTE]);
    expect(allVisibleCalls().map((c) => c[1])).toEqual([true, true]);
  });
});

describe('project declaration — hub answers and /activity (edge 11, R2)', () => {
  test('rejected projects are written to the console with the list', async () => {
    const rejected = [{ projectId: P_CARD, reason: 'no_access' }];
    mock.invokeImpl = (method, arg) =>
      Promise.resolve(
        method === 'DeclareProjects'
          ? { accepted: (arg as string[]).filter((id) => id !== P_CARD), rejected }
          : { accepted: [], rejected: [] },
      );
    const { show } = setup([]);
    show(
      createElement(Explicit, { key: 'r', source: 'route', ids: [P_ROUTE] }),
      createElement(Explicit, { key: 'c', source: 'card', ids: [P_CARD] }),
    );
    await settle(DECLARE_DEBOUNCE_MS);

    expect(declareCalls()).toHaveLength(1);
    const logged = warnSpy.mock.calls.some((args: unknown[]) =>
      args.some((a) => Array.isArray(a) && a.some((r) => (r as { projectId?: string }).projectId === P_CARD && (r as { reason?: string }).reason === 'no_access')),
    );
    expect(logged).toBe(true);
  });

  test('/activity turns DeclareAllVisible on while mounted and off on leaving', async () => {
    const { show } = setup([]);
    show(createElement(ActivityPage, { key: 'activity' }));
    await settle(DECLARE_DEBOUNCE_MS);

    expect(allVisibleCalls().map((c) => c[1])).toEqual([true]);

    show();
    await settle(DECLARE_DEBOUNCE_MS);

    expect(allVisibleCalls().map((c) => c[1])).toEqual([true, false]);
  });
});

// ──────────── No. 92 — gaps the final mutation run of T041 showed ────────────

/** A hub whose answers are held until the test releases them, in call order. */
interface HeldCall {
  method: string;
  arg: unknown;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
}
function holdAnswers(): HeldCall[] {
  const held: HeldCall[] = [];
  mock.invokeImpl = (method, arg) =>
    new Promise((resolve, reject) => {
      held.push({ method, arg, resolve, reject });
    });
  return held;
}
const accept = (c: HeldCall) =>
  c.resolve({ accepted: Array.isArray(c.arg) ? c.arg : [], rejected: [] });

async function release(fn: () => void): Promise<void> {
  await act(async () => {
    fn();
    await vi.advanceTimersByTimeAsync(0);
  });
}

function reconnectHandlers(): { reconnecting: () => void; reconnected: () => void } {
  return {
    reconnecting: mock.conn!.onreconnecting.mock.calls[0][0] as () => void,
    reconnected: mock.conn!.onreconnected.mock.calls[0][0] as () => void,
  };
}

function lastDeclared(): unknown {
  const calls = declareCalls();
  return calls[calls.length - 1][1];
}

describe('project declaration — which cached rows count (No. 92)', () => {
  test('rows of a query outside the row prefixes (the epic picker, `issues/list-all`) are not declared', async () => {
    const PICKER_KEY = ['issues', 'list-all', { type: 'epic', q: '' }];
    const { show } = setup([[PICKER_KEY, { items: [{ id: 'e-1', projectId: P_BLOB }], total: 1 }]]);
    show(
      createElement(Explicit, { key: 'r', source: 'route', ids: [P_ROUTE] }),
      createElement(Rows, { key: 'picker', queryKey: PICKER_KEY }),
    );
    await settle(DECLARE_DEBOUNCE_MS);
    expect(lastDeclared()).toEqual([P_ROUTE]);
  });

  test('the ancestor backfill (a flat row array, `tasks/ancestors`) declares its rows', async () => {
    const ANCESTORS_KEY = ['tasks', 'ancestors', 'x-1'];
    const { show } = setup([[ANCESTORS_KEY, [{ id: 'a-1', projectId: P_NEW }]]]);
    show(
      createElement(Explicit, { key: 'r', source: 'route', ids: [P_ROUTE] }),
      createElement(Rows, { key: 'anc', queryKey: ANCESTORS_KEY }),
    );
    await settle(DECLARE_DEBOUNCE_MS);
    expect(lastDeclared()).toEqual([P_ROUTE, P_NEW]);
  });

  test('a redacted tree item (no project) is skipped; the other rows still count', async () => {
    const tree = treeOf(P_TREE);
    tree.rows.push({ item: { id: 'hidden' } as never, depth: 1, isReference: false });
    const { show } = setup([[TREE_KEY, tree]]);
    show(
      createElement(Explicit, { key: 'r', source: 'route', ids: [P_ROUTE] }),
      createElement(Rows, { key: 'tree', queryKey: TREE_KEY }),
    );
    await settle(DECLARE_DEBOUNCE_MS);
    expect(lastDeclared()).toEqual([P_ROUTE, P_TREE]);
  });

  test.each([
    ['removed from the cache', 'remove'],
    ['reset (its data dropped)', 'reset'],
    ['no longer shown (its observer gone)', 'unmount'],
  ] as const)('an active row query %s stops contributing its rows', async (_n, how) => {
    const { qc, show } = setup([[ALL_PROJECTS_KEY, pageOf(P_ROWS_MANY)]]);
    show(
      createElement(Explicit, { key: 'r', source: 'route', ids: [P_ROUTE] }),
      createElement(Rows, { key: 'all', queryKey: ALL_PROJECTS_KEY }),
    );
    await settle(DECLARE_DEBOUNCE_MS);
    expect(lastDeclared()).toEqual([P_ROUTE, P_ROWS_MANY]);

    if (how === 'unmount') {
      show(createElement(Explicit, { key: 'r', source: 'route', ids: [P_ROUTE] }));
    } else {
      await act(async () => {
        if (how === 'remove') qc.removeQueries({ queryKey: ALL_PROJECTS_KEY });
        else void qc.resetQueries({ queryKey: ALL_PROJECTS_KEY });
      });
    }
    await settle(DECLARE_DEBOUNCE_MS);
    expect(declareCalls()).toHaveLength(2);
    expect(lastDeclared()).toEqual([P_ROUTE]);
  });

  test('rows already shown when the provider mounts are declared on connect', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(ALL_PROJECTS_KEY, pageOf(P_ROWS_MANY));
    render(
      createElement(
        QueryClientProvider,
        { client: qc },
        createElement(LiveEventsProvider, null, createElement(Rows, { queryKey: ALL_PROJECTS_KEY })),
      ),
    );
    await settle(DECLARE_DEBOUNCE_MS);
    expect(declareCalls()).toHaveLength(1);
    expect(lastDeclared()).toEqual([P_ROWS_MANY]);
  });
});

describe('project declaration — explicit sources (No. 92)', () => {
  test('the priority holds whatever order the sources registered in', async () => {
    const { show } = setup([]);
    show(
      createElement(Explicit, { key: 'e', source: 'expanded', ids: [P_EXPANDED] }),
      createElement(Explicit, { key: 'c', source: 'card', ids: [P_CARD] }),
      createElement(Explicit, { key: 'r', source: 'route', ids: [P_ROUTE] }),
    );
    await settle(DECLARE_DEBOUNCE_MS);
    expect(lastDeclared()).toEqual([P_ROUTE, P_CARD, P_EXPANDED]);
  });

  test('a source with several projects declares each; a source with none declares nothing', async () => {
    const { show } = setup([]);
    show(
      createElement(Explicit, { key: 'r', source: 'route', ids: [P_ROUTE] }),
      createElement(Explicit, { key: 'c', source: 'card', ids: [] }),
      createElement(Explicit, { key: 'e', source: 'expanded', ids: [P_EXPANDED, P_NEW] }),
    );
    await settle(DECLARE_DEBOUNCE_MS);
    expect(lastDeclared()).toEqual([P_ROUTE, P_EXPANDED, P_NEW]);
  });

  test('/activity mounted after the connection turns the mode on; `enabled` switched off turns it off', async () => {
    function Activity({ enabled }: { enabled: boolean }) {
      useDeclareAllVisible(enabled);
      return null;
    }
    const { show } = setup([]);
    show(createElement(Explicit, { key: 'r', source: 'route', ids: [P_ROUTE] }));
    await settle(DECLARE_DEBOUNCE_MS);
    expect(allVisibleCalls()).toHaveLength(0);

    show(
      createElement(Explicit, { key: 'r', source: 'route', ids: [P_ROUTE] }),
      createElement(Activity, { key: 'a', enabled: true }),
    );
    await settle(DECLARE_DEBOUNCE_MS);
    expect(allVisibleCalls().map((c) => c[1])).toEqual([true]);

    show(
      createElement(Explicit, { key: 'r', source: 'route', ids: [P_ROUTE] }),
      createElement(Activity, { key: 'a', enabled: false }),
    );
    await settle(DECLARE_DEBOUNCE_MS);
    expect(allVisibleCalls().map((c) => c[1])).toEqual([true, false]);
  });
});

describe('project declaration — sending under the hub limit and answers (No. 92)', () => {
  test('an order change that keeps one position still re-sends the kept part', async () => {
    mock.invokeImpl = limitingHub;
    const P_TAIL = projectId(999);
    const busy = Array.from({ length: 54 }, (_, i) => projectId(i + 1));
    const { show } = setup([[ALL_PROJECTS_KEY, pageOf(...busy, ...busy, P_TAIL)]]);
    show(
      createElement(Explicit, { key: 'r', source: 'route', ids: [P_ROUTE] }),
      createElement(Explicit, { key: 'c', source: 'card', ids: [P_CARD] }),
      createElement(Rows, { key: 'all', queryKey: ALL_PROJECTS_KEY }),
    );
    await settle(DECLARE_DEBOUNCE_MS);
    expect(declareCalls()).toHaveLength(1);

    // The tail project becomes the route, the card stays second, the old
    // route moves to an expanded row.
    show(
      createElement(Explicit, { key: 'r', source: 'route', ids: [P_TAIL] }),
      createElement(Explicit, { key: 'c', source: 'card', ids: [P_CARD] }),
      createElement(Explicit, { key: 'e', source: 'expanded', ids: [P_ROUTE] }),
      createElement(Rows, { key: 'all', queryKey: ALL_PROJECTS_KEY }),
    );
    await settle(DECLARE_DEBOUNCE_MS);
    expect(declareCalls()).toHaveLength(2);
    expect((lastDeclared() as string[]).slice(0, 3)).toEqual([P_TAIL, P_CARD, P_ROUTE]);
  });

  test('after a `no_access` refusal a new project is still declared (no limit is learned from it)', async () => {
    mock.invokeImpl = (method, arg) =>
      Promise.resolve(
        method === 'DeclareProjects'
          ? {
            accepted: (arg as string[]).filter((id) => id !== P_CARD),
            rejected: (arg as string[]).includes(P_CARD) ? [{ projectId: P_CARD, reason: 'no_access' }] : [],
          }
          : { accepted: [], rejected: [] },
      );
    const { show } = setup([]);
    show(
      createElement(Explicit, { key: 'r', source: 'route', ids: [P_ROUTE] }),
      createElement(Explicit, { key: 'c', source: 'card', ids: [P_CARD] }),
    );
    await settle(DECLARE_DEBOUNCE_MS);
    expect(declareCalls()).toHaveLength(1);

    show(
      createElement(Explicit, { key: 'r', source: 'route', ids: [P_ROUTE] }),
      createElement(Explicit, { key: 'c', source: 'card', ids: [P_CARD] }),
      createElement(Explicit, { key: 'e', source: 'expanded', ids: [P_EXPANDED] }),
    );
    await settle(DECLARE_DEBOUNCE_MS);
    expect(declareCalls()).toHaveLength(2);
    expect(lastDeclared()).toEqual([P_ROUTE, P_CARD, P_EXPANDED]);
  });

  test('a hub that keeps more than the learned limit forgets it: a change past the old cut is sent', async () => {
    let hubLimit = HUB_LIMIT;
    mock.invokeImpl = (method, arg) => {
      if (method !== 'DeclareProjects') return Promise.resolve({ accepted: [], rejected: [] });
      const ids = arg as string[];
      return Promise.resolve({
        accepted: ids.slice(0, hubLimit),
        rejected: ids.slice(hubLimit).map((projectId) => ({ projectId, reason: 'limit' })),
      });
    };
    const busy = Array.from({ length: 54 }, (_, i) => projectId(i + 1));
    const tailA = projectId(901);
    const tailB = projectId(902);
    const { qc, show } = setup([[ALL_PROJECTS_KEY, pageOf(...busy, ...busy, tailA)]]);
    show(
      createElement(Explicit, { key: 'r', source: 'route', ids: [P_ROUTE] }),
      createElement(Rows, { key: 'all', queryKey: ALL_PROJECTS_KEY }),
    );
    await settle(DECLARE_DEBOUNCE_MS);
    expect(declareCalls()).toHaveLength(1);

    // The hub now keeps every project; a change at the head reaches it.
    hubLimit = 100;
    show(
      createElement(Explicit, { key: 'r', source: 'route', ids: [P_CARD] }),
      createElement(Rows, { key: 'all', queryKey: ALL_PROJECTS_KEY }),
    );
    await settle(DECLARE_DEBOUNCE_MS);
    expect(declareCalls()).toHaveLength(2);

    // A change only in what used to be the cut tail is now in force.
    await act(async () => {
      qc.setQueryData(ALL_PROJECTS_KEY, pageOf(...busy, ...busy, tailB));
    });
    await settle(DECLARE_DEBOUNCE_MS);
    expect(declareCalls()).toHaveLength(3);
    expect(lastDeclared()).toContain(tailB);
  });

  test('DeclareAllVisible refused with `rate` is logged and sent again after the window, once', async () => {
    let attempts = 0;
    mock.invokeImpl = (method, arg) => {
      if (method !== 'DeclareAllVisible') {
        return Promise.resolve({ accepted: Array.isArray(arg) ? arg : [], rejected: [] });
      }
      attempts += 1;
      return Promise.resolve(
        attempts === 1 ? { accepted: [], rejected: [{ projectId: '', reason: 'rate' }] } : { accepted: [], rejected: [] },
      );
    };
    const { show } = setup([]);
    show(createElement(ActivityPage, { key: 'activity' }));
    await settle(0);
    expect(allVisibleCalls().map((c) => c[1])).toEqual([true]);
    const logged = warnSpy.mock.calls.some((args: unknown[]) =>
      args.some((a) => Array.isArray(a) && a.some((r) => (r as { reason?: string }).reason === 'rate')),
    );
    expect(logged).toBe(true);

    await settle(DECLARE_RATE_WINDOW_MS - 1);
    expect(allVisibleCalls()).toHaveLength(1);
    await settle(1);
    expect(allVisibleCalls().map((c) => c[1])).toEqual([true, true]);

    await settle(DECLARE_RATE_WINDOW_MS * 2);
    expect(allVisibleCalls()).toHaveLength(2);
  });

  test('the rate limit holds in every window, not only the first', async () => {
    const { show } = setup([]);
    show(createElement(Explicit, { key: 'r', source: 'route', ids: [projectId(1)] }));
    await settle(DECLARE_DEBOUNCE_MS);
    for (let i = 2; i <= DECLARE_RATE_LIMIT; i += 1) {
      show(createElement(Explicit, { key: 'r', source: 'route', ids: [projectId(i)] }));
      await settle(DECLARE_DEBOUNCE_MS);
    }
    expect(declareCalls()).toHaveLength(DECLARE_RATE_LIMIT);
    // Every send of the first window is long past.
    await settle(DECLARE_RATE_WINDOW_MS * 2);

    const ids = Array.from({ length: DECLARE_RATE_LIMIT + 1 }, (_, i) => projectId(200 + i));
    for (const id of ids) {
      show(createElement(Explicit, { key: 'r', source: 'route', ids: [id] }));
      await settle(DECLARE_DEBOUNCE_MS);
    }
    expect(declareCalls()).toHaveLength(DECLARE_RATE_LIMIT * 2);
  });

  test('a set seen again while a failed call waits for its back-off does not restart the back-off', async () => {
    mock.invokeImpl = () => Promise.reject(new Error('down'));
    const { qc, show } = setup([[ALL_PROJECTS_KEY, pageOf(P_ROWS_MANY)]]);
    show(createElement(Rows, { key: 'all', queryKey: ALL_PROJECTS_KEY }));
    await settle(DECLARE_DEBOUNCE_MS);
    const before = declareCalls().length;

    // Same projects again (a refetch with the same rows).
    await act(async () => {
      qc.setQueryData(ALL_PROJECTS_KEY, pageOf(P_ROWS_MANY));
    });
    await settle(DECLARE_DEBOUNCE_MS * 2);
    expect(declareCalls()).toHaveLength(before);
  });
});

describe('project declaration — calls in flight and reconnects (No. 92)', () => {
  test('a change while a call is in flight is sent once, after its answer — never in parallel', async () => {
    const held = holdAnswers();
    const { show } = setup([]);
    show(createElement(Explicit, { key: 'r', source: 'route', ids: [P_ROUTE] }));
    await settle(0);
    expect(declareCalls()).toHaveLength(1);

    show(createElement(Explicit, { key: 'r', source: 'route', ids: [P_CARD] }));
    await settle(DECLARE_DEBOUNCE_MS * 2);
    expect(declareCalls()).toHaveLength(1);

    await release(() => accept(held[0]));
    expect(declareCalls()).toHaveLength(2);
    expect(lastDeclared()).toEqual([P_CARD]);
  });

  test('a reconnect with a call in flight declares at once; the stale answer does not open a parallel run', async () => {
    const held = holdAnswers();
    const { show } = setup([]);
    show(createElement(Explicit, { key: 'r', source: 'route', ids: [P_ROUTE] }));
    await settle(0);
    expect(declareCalls()).toHaveLength(1);

    const { reconnecting, reconnected } = reconnectHandlers();
    await act(async () => {
      reconnecting();
      reconnected();
    });
    await settle(0);
    expect(declareCalls()).toHaveLength(2);

    // The first connection's answer arrives late.
    await release(() => accept(held[0]));
    show(createElement(Explicit, { key: 'r', source: 'route', ids: [P_CARD] }));
    await settle(DECLARE_DEBOUNCE_MS * 2);
    expect(declareCalls()).toHaveLength(2);

    await release(() => accept(held[1]));
    expect(declareCalls()).toHaveLength(3);
    expect(lastDeclared()).toEqual([P_CARD]);
  });

  test('nothing is sent while reconnecting; the new connection declares the changed set', async () => {
    const { show } = setup([]);
    show(createElement(Explicit, { key: 'r', source: 'route', ids: [P_ROUTE] }));
    await settle(DECLARE_DEBOUNCE_MS);
    expect(declareCalls()).toHaveLength(1);

    const { reconnecting, reconnected } = reconnectHandlers();
    await act(async () => {
      reconnecting();
    });
    show(createElement(Explicit, { key: 'r', source: 'route', ids: [P_CARD] }));
    await settle(DECLARE_DEBOUNCE_MS * 4);
    expect(declareCalls()).toHaveLength(1);

    await act(async () => {
      reconnected();
    });
    await settle(0);
    expect(declareCalls()).toHaveLength(2);
    expect(lastDeclared()).toEqual([P_CARD]);
  });

  test.each([
    ['DeclareProjects answered', 'projects', 'resolve'],
    ['DeclareProjects failed', 'projects', 'reject'],
    ['DeclareAllVisible answered', 'mode', 'resolve'],
    ['DeclareAllVisible failed', 'mode', 'reject'],
  ] as const)('a call of the previous connection %s late changes nothing on the new one', async (_n, what, how) => {
    const held = holdAnswers();
    const { show } = setup([]);
    if (what === 'projects') {
      show(createElement(Explicit, { key: 'r', source: 'route', ids: [P_ROUTE] }));
    } else {
      show(createElement(ActivityPage, { key: 'activity' }));
    }
    await settle(0);
    expect(held).toHaveLength(1);
    // The wish moves while the call is out: route A → B, or /activity left.
    if (what === 'projects') {
      show(createElement(Explicit, { key: 'r', source: 'route', ids: [P_CARD] }));
    } else {
      show();
    }
    await settle(DECLARE_DEBOUNCE_MS);

    const { reconnecting, reconnected } = reconnectHandlers();
    await act(async () => {
      reconnecting();
      reconnected();
    });
    await settle(0);
    // The new connection declares the current wish (projects: B; mode: off
    // = nothing to send); answer it.
    for (const c of held.slice(1)) await release(() => accept(c));
    const projectsBefore = declareCalls().length;
    const modeBefore = allVisibleCalls().length;

    // The old call's answer lands.
    await release(() => (how === 'resolve' ? accept(held[0]) : held[0].reject(new Error('late'))));
    // A later change of the other kind runs the loop on the new connection.
    if (what === 'projects') {
      show(
        createElement(Explicit, { key: 'r', source: 'route', ids: [P_CARD] }),
        createElement(ActivityPage, { key: 'activity' }),
      );
    } else {
      show(createElement(Explicit, { key: 'r', source: 'route', ids: [P_ROUTE] }));
    }
    for (let i = 0; i < 4; i += 1) {
      await settle(DECLARE_DEBOUNCE_MS);
      for (const c of held.slice(1)) await release(() => accept(c));
    }
    await settle(DECLARE_RETRY_DELAYS_MS[0]);
    for (const c of held.slice(1)) await release(() => accept(c));

    if (what === 'projects') {
      expect(declareCalls()).toHaveLength(projectsBefore);
      expect(allVisibleCalls()).toHaveLength(modeBefore + 1);
    } else {
      expect(declareCalls()).toHaveLength(projectsBefore + 1);
      expect(allVisibleCalls()).toHaveLength(modeBefore);
    }
  });
});
