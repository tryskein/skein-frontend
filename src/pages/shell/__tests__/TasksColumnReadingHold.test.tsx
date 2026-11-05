/**
 * sk-763 — the real Tasks column holds the list its reader is in, offers
 * «Updates available» where the reader can reach it, and applies it with
 * one read of the first page.
 *
 * The reference is the owner's decision for sk-763 (see
 * `lib/liveListDirty.ts`): a list being read is not reset under its reader;
 * the reader applies the owed updates with one click — the first page, one
 * request — and is shown the list from its start.
 *
 * The real `TasksColumn`, `useTasks` and `LiveEventsProvider` run on a fake
 * hub; the list endpoint is a literal server answered by cursor. jsdom has
 * no layout: the column's scroll containers are made to scroll below, and
 * the infinite-scroll sentinel's IntersectionObserver reports «in view»
 * exactly when the list body is scrolled to its end — what a browser does
 * when a shorter list is shown at a clamped offset.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import * as signalr from '@microsoft/signalr';

import type { IssueSummary, ListIssuesParams, ListIssuesResult } from '../../../api/issues';

const P = 'proj-uuid-1';

const listIssuesSpy = vi.fn<(projectId: string, params?: ListIssuesParams) => Promise<ListIssuesResult>>();

vi.mock('../../../api/issues', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/issues')>();
  return {
    ...actual,
    listIssues: (...args: [string, ListIssuesParams?]) => listIssuesSpy(...args),
    fetchIssueTree: vi.fn(async () => ({ items: [] })),
  };
});

vi.mock('../../../api/search', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/search')>();
  return { ...actual, lookupIdBatch: vi.fn(async () => ({ items: [] })) };
});

vi.mock('../../../lib/useProjectsList', () => ({
  projectsListQueryKey: ['projects', 'list', 'shell'],
  useProjectsList: () => ({ data: { items: [] }, isLoading: false, isError: false }),
  useProjectsInfinite: () => ({
    items: [], total: 0, isLoading: false, isFetching: false, isFetchingNextPage: false,
    isError: false, hasNextPage: false, fetchNextPage: () => {},
  }),
}));

vi.mock('../../../lib/useProjectByHandle', () => ({
  useProjectByHandle: (handle: string | null) =>
    handle === null
      ? { project: null, isLoading: false, isUnresolved: false }
      : { project: { id: P, idPrefix: handle, name: 'demo' }, isLoading: false, isUnresolved: false },
}));

vi.mock('../../../lib/useReminders', () => ({
  useRingingIssueIds: () => new Set<string>(),
  useRingingTaskCount: () => 0,
  useRemindersList: () => ({ reminders: [], ringingTaskCount: 0, isLoading: false, error: null }),
}));

vi.mock('../../../api/components', () => ({ listComponents: async () => [] }));
vi.mock('../../../api/projects', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/projects')>();
  return { ...actual, listMembers: async () => [] };
});
vi.mock('../../../api/users', () => ({
  listUserDirectory: async () => ({ items: [], hasMore: false }),
}));

vi.mock('../../../auth/AuthContext', () => ({
  useAuthOptional: () => null,
  useAuth: () => ({ user: { id: 'u-1', username: 'ann', role: 'user' }, logout: () => Promise.resolve() }),
}));

vi.mock('@microsoft/signalr', () => {
  const HubConnectionState = { Disconnected: 'Disconnected', Connecting: 'Connecting', Connected: 'Connected', Reconnecting: 'Reconnecting' } as const;
  const LogLevel = { Trace: 0, Debug: 1, Information: 2, Warning: 3, Error: 4, Critical: 5, None: 6 } as const;
  const registry: { handlers: Map<string, (payload: unknown) => void> } = { handlers: new Map() };
  class FakeConn {
    state: string = HubConnectionState.Disconnected;
    on = vi.fn((method: string, cb: (payload: unknown) => void) => { registry.handlers.set(method, cb); });
    onclose = vi.fn();
    onreconnecting = vi.fn();
    onreconnected = vi.fn();
    invoke = vi.fn((_m: string, ids: unknown) => Promise.resolve({ accepted: Array.isArray(ids) ? ids : [], rejected: [] }));
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

const { LiveEventsProvider } = await import('../../../hooks/useLiveEvents');
const { LIVE_INVALIDATION_WINDOW_MS } = await import('../../../lib/liveInvalidationBatcher');
const { LayoutProvider } = await import('../../../lib/useLayoutState');
const { TasksUiStateProvider } = await import('../../../lib/useTasksUiState');
const { TasksColumn } = await import('../TasksColumn');
const { setViewportWidth } = await import('../../../test/viewport');

const hub = (signalr as unknown as { __mock: { handlers: Map<string, (payload: unknown) => void> } }).__mock;

let nextEnvelope = 1;
/** A created issue of the project, as the hub delivers it. */
async function issueCreated(id: string): Promise<void> {
  act(() => hub.handlers.get('event')!({
    id: nextEnvelope++, occurredAt: '2026-10-01T10:01:00Z', eventType: 'issue.created', entityType: 'issue',
    entityId: id, projectId: P, actor: 'bob', actorType: 'human', actorUserId: 'u-2', entityTitle: id, projectIdPrefix: 'demo',
  }));
  await advance(LIVE_INVALIDATION_WINDOW_MS + 300);
}

/** A shown row renamed, as the hub delivers it (a row change the list patches in place). */
async function issueRenamed(n: number, title: string): Promise<void> {
  const { isBlocked: _b, ...row } = { ...issue(n), title, version: 2, updatedAt: ts(20_000), rowSeq: 41 };
  act(() => hub.handlers.get('event')!({
    id: nextEnvelope++, occurredAt: '2026-10-01T10:02:00Z', eventType: 'issue.updated', entityType: 'issue',
    entityId: row.id, projectId: P, actor: 'bob', actorType: 'human', actorUserId: 'u-2', entityTitle: title, projectIdPrefix: 'demo',
    changedFields: ['title'], row,
  }));
  await advance(LIVE_INVALIDATION_WINDOW_MS + 300);
}

const VIEWPORT_PX = 800;

function ts(n: number): string {
  return new Date(Date.UTC(2026, 5, 1) + n * 60_000).toISOString();
}

function issue(n: number): IssueSummary {
  return {
    id: `demo-${n}`, projectId: P, version: 1, title: `title demo-${n}`, type: 'task', priority: 2,
    status: 'open', pinned: false, assignee: null, parentIdCurrent: null, createdBy: 'u-2',
    componentIds: [], labels: [], isBlocked: false, createdAt: ts(10_000 - n), updatedAt: ts(10_000 - n), rowSeq: 40,
  } as IssueSummary;
}

/** A literal server: pages by cursor (`undefined` = the first page). */
let pages: Record<string, ListIssuesResult>;
let calls: Array<string | null | undefined>;
const FIRST = '<first>';

function serve(): void {
  listIssuesSpy.mockImplementation((_pid, params) => {
    calls.push(params?.cursor);
    return Promise.resolve(pages[params?.cursor ?? FIRST]);
  });
}

/** `n` pages of `per` issues each. */
function server(n: number, per: number): void {
  pages = {};
  for (let p = 0; p < n; p += 1) {
    const items = Array.from({ length: per }, (_, i) => issue(p * per + i + 1));
    pages[p === 0 ? FIRST : `c${p}`] = {
      items, total: n * per, hasMore: p < n - 1, nextCursor: p < n - 1 ? `c${p + 1}` : null,
    };
  }
}

// ── jsdom stand-ins for layout: scrolling and the sentinel's observer ──

const observers: Array<{ cb: IntersectionObserverCallback; nodes: Element[] }> = [];

class FakeIntersectionObserver {
  private readonly entry: { cb: IntersectionObserverCallback; nodes: Element[] };
  constructor(cb: IntersectionObserverCallback) {
    this.entry = { cb, nodes: [] };
    observers.push(this.entry);
  }
  observe(node: Element) { this.entry.nodes.push(node); }
  unobserve() {}
  disconnect() { this.entry.nodes = []; }
  takeRecords() { return []; }
}

/** Offsets of every element made scrollable here. */
const offsets = new WeakMap<HTMLElement, number>();

function scrollable(el: HTMLElement, contentPx: () => number): void {
  if (offsets.has(el)) return;
  offsets.set(el, 0);
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get: () => offsets.get(el) ?? 0,
    set: (v: number) => { offsets.set(el, Math.max(0, Math.min(v, Math.max(0, contentPx() - VIEWPORT_PX)))); },
  });
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => VIEWPORT_PX });
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => contentPx() });
  el.scrollTo = ((o?: ScrollToOptions) => {
    el.scrollTop = o?.top ?? 0;
    el.dispatchEvent(new Event('scroll'));
  }) as HTMLElement['scrollTo'];
}

const listBody = () => document.querySelector<HTMLElement>('.col-body.tasks-body')!;

/** Height of the tree canvas the virtualizer declares. */
const canvasPx = () => Number.parseFloat(document.querySelector<HTMLElement>('.task-tree-virtual-canvas')?.style.height ?? '0');

/** The sentinel is in view when the body is at its end (rootMargin 200px). */
async function deliverIntersections(): Promise<void> {
  const body = listBody();
  const atEnd = body.scrollTop + body.clientHeight >= body.scrollHeight - 200;
  for (const o of [...observers]) {
    const entries = o.nodes.map((target) => ({ target, isIntersecting: atEnd }) as unknown as IntersectionObserverEntry);
    if (entries.length > 0) await act(async () => { o.cb(entries, {} as IntersectionObserver); });
  }
}

let qc: QueryClient;

function column(path: string, budilnikMode = false) {
  return (
    <MantineProvider forceColorScheme="light">
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>
          <LiveEventsProvider>
            <Routes>
              {['/projects/:alias', '/'].map((p) => (
                <Route
                  key={p}
                  path={p}
                  element={
                    <LayoutProvider>
                      <TasksUiStateProvider>
                        <TasksColumn width={468} collapsed={false} outboxMode={false} onMeMode={false} budilnikMode={budilnikMode} />
                      </TasksUiStateProvider>
                    </LayoutProvider>
                  }
                />
              ))}
            </Routes>
          </LiveEventsProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>
  );
}

async function advance(ms: number): Promise<void> {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

async function returnToTab(): Promise<void> {
  act(() => { document.dispatchEvent(new Event('visibilitychange')); });
  await advance(LIVE_INVALIDATION_WINDOW_MS + 300);
}

const updatesButton = () => screen.queryByRole('button', { name: 'Updates available' });

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = FakeIntersectionObserver;
  observers.splice(0);
  window.localStorage.clear();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  listIssuesSpy.mockReset();
  calls = [];
});

afterEach(() => {
  cleanup();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('sk-763 — the Tasks column applies the updates of a held list', () => {
  test('the tree: the list is at its start before the first page answers, and the one read is the only one', async () => {
    window.localStorage.setItem('skein.tasks.view', 'tree');
    server(3, 60);
    serve();
    await act(async () => { render(column('/projects/demo')); });
    await advance(500);
    scrollable(listBody(), canvasPx);
    // Down to the end of the first page, then the next ones.
    for (let i = 0; i < 2; i += 1) {
      act(() => { listBody().scrollTo({ top: 1e9 }); });
      await deliverIntersections();
      await advance(300);
    }
    expect(calls).toEqual([undefined, 'c1', 'c2']);
    act(() => { listBody().scrollTo({ top: 120 * 44 }); });

    await returnToTab();
    expect(updatesButton()).not.toBeNull();
    calls = [];

    let answer: () => void = () => {};
    const first = pages[FIRST];
    listIssuesSpy.mockImplementationOnce((_pid, params) => {
      calls.push(params?.cursor);
      return new Promise((resolve) => { answer = () => resolve(first); });
    });
    await act(async () => { fireEvent.click(updatesButton()!); });
    await advance(0);
    // Before the answer: the reader is already at the start, one request.
    expect(listBody().scrollTop).toBe(0);
    expect(calls).toEqual([undefined]);

    answer();
    await advance(300);
    await deliverIntersections();
    await advance(300);
    // The shorter list is shown from its start: the sentinel is far below.
    expect(calls).toEqual([undefined]);
    expect(updatesButton()).toBeNull();
  });

  test('a short first page (the sentinel is in view from the top): the apply is one read, and the next page waits for the reader', async () => {
    window.localStorage.setItem('skein.tasks.view', 'tree');
    server(3, 5);
    serve();
    await act(async () => { render(column('/projects/demo')); });
    await advance(500);
    scrollable(listBody(), canvasPx);
    // The short list is loaded to its end by the sentinel, as before.
    for (let i = 0; i < 3; i += 1) {
      await deliverIntersections();
      await advance(300);
    }
    expect(calls).toEqual([undefined, 'c1', 'c2']);
    await returnToTab();
    expect(updatesButton()).not.toBeNull();
    calls = [];

    let answer: () => void = () => {};
    const first = pages[FIRST];
    listIssuesSpy.mockImplementationOnce((_pid, params) => {
      calls.push(params?.cursor);
      return new Promise((resolve) => { answer = () => resolve(first); });
    });
    await act(async () => { fireEvent.click(updatesButton()!); });
    await advance(0);
    // The short first page is all in view: the sentinel reports it.
    await deliverIntersections();
    await advance(0);
    expect(calls).toEqual([undefined]);

    answer();
    await advance(300);
    await deliverIntersections();
    await advance(300);
    expect(calls).toEqual([undefined]);
    expect(updatesButton()).toBeNull();

    // The reader moves in the list (a wheel turn — the short list does not
    // scroll): the next page loads.
    act(() => { listBody().dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true })); });
    await deliverIntersections();
    await advance(300);
    expect(calls).toEqual([undefined, 'c1']);
  });

  /**
   * A short tree list (the sentinel is in view from the top) loaded to its
   * end, marked, and applied: one read of the first page, and the next page
   * waits for the reader. `calls` is left with that one read.
   */
  async function applyOnShortList(): Promise<void> {
    window.localStorage.setItem('skein.tasks.view', 'tree');
    server(3, 5);
    serve();
    await act(async () => { render(column('/projects/demo')); });
    await advance(500);
    scrollable(listBody(), canvasPx);
    for (let i = 0; i < 3; i += 1) {
      await deliverIntersections();
      await advance(300);
    }
    await returnToTab();
    calls = [];
    await act(async () => { fireEvent.click(updatesButton()!); });
    await advance(300);
    await deliverIntersections();
    await advance(300);
    expect(calls).toEqual([undefined]);
    expect(updatesButton()).toBeNull();
  }

  const searchBox = () => screen.getByRole('textbox', { name: /search/i });

  // What says «go on with the list» after an apply is the reader's move IN
  // the list it reads: a gesture over the list body, a navigation key on
  // it. A key typed into a text field and a gesture over the header or the
  // filters say nothing of the list, and a scroll alone is the code's own.
  test.each<[string, string, () => void, Array<string | undefined>]>([
    ['a space in the search field', 'the apply stays the one read', () => { fireEvent.keyDown(searchBox(), { key: ' ' }); }, [undefined]],
    ['an arrow key in the search field', 'the apply stays the one read', () => { fireEvent.keyDown(searchBox(), { key: 'ArrowDown' }); }, [undefined]],
    ['a wheel turn over the column header', 'the apply stays the one read', () => {
      document.querySelector('.col-tasks-header')!.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true }));
    }, [undefined]],
    ['a wheel turn over the filters', 'the apply stays the one read', () => {
      document.querySelector('.task-filters')!.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true }));
    }, [undefined]],
    ['a scroll of the list body by the code', 'the apply stays the one read', () => { listBody().scrollTo({ top: 300 }); }, [undefined]],
    ['a wheel turn over the list body', 'the next page is read', () => {
      listBody().dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true }));
    }, [undefined, 'c1']],
    ['an arrow key on the list body', 'the next page is read', () => { fireEvent.keyDown(listBody(), { key: 'ArrowDown' }); }, [undefined, 'c1']],
  ])('after an apply on a short list, %s: %s', async (_n, _outcome, gesture, expected) => {
    await applyOnShortList();

    act(gesture);
    await deliverIntersections();
    await advance(300);

    expect(calls).toEqual(expected);
  });

  // A failed apply leaves the short list as an apply that landed does: its
  // next page waits for the reader. The failed read shows the column's
  // error in place of the list; a row change patched in place brings the
  // list (and its sentinel, in view) back without any read.
  test('a short list whose apply failed: when the list is shown again, the next page still waits for the reader', async () => {
    window.localStorage.setItem('skein.tasks.view', 'tree');
    server(3, 5);
    serve();
    await act(async () => { render(column('/projects/demo')); });
    await advance(500);
    scrollable(listBody(), canvasPx);
    for (let i = 0; i < 3; i += 1) {
      await deliverIntersections();
      await advance(300);
    }
    await returnToTab();
    calls = [];
    listIssuesSpy.mockImplementationOnce((_pid, params) => {
      calls.push(params?.cursor);
      return Promise.reject(new Error('down'));
    });
    await act(async () => { fireEvent.click(updatesButton()!); });
    await advance(300);
    expect(screen.queryByRole('button', { name: 'Update failed — retry' })).not.toBeNull();

    await issueRenamed(1, 'renamed demo-1');
    expect(screen.queryByText('renamed demo-1')).not.toBeNull();
    await deliverIntersections();
    await advance(300);
    expect(calls).toEqual([undefined]);

    act(() => { listBody().dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true })); });
    await deliverIntersections();
    await advance(300);
    expect(calls).toEqual([undefined, 'c1']);
  });

  // The reminders lens shows something else over the list (it is not the
  // list being read): «Updates available» of the list is not offered there,
  // on any width — the phone carries it in the filters row.
  test.each<[string, number]>([
    ['a desktop', 1440],
    ['a phone', 390],
  ])('on %s, a marked list under the reminders lens offers no «Updates available»', async (_n, width) => {
    setViewportWidth(width);
    window.localStorage.setItem('skein.tasks.view', 'tree');
    server(3, 60);
    serve();
    let rerender: (ui: React.ReactElement) => void = () => {};
    await act(async () => { ({ rerender } = render(column('/projects/demo'))); });
    await advance(500);
    scrollable(listBody(), canvasPx);
    act(() => { listBody().scrollTo({ top: 1e9 }); });
    await deliverIntersections();
    await advance(300);
    await returnToTab();
    expect(updatesButton()).not.toBeNull();

    await act(async () => { rerender(column('/projects/demo', true)); });
    await advance(300);

    expect(updatesButton()).toBeNull();
  });

  test('the board: «Load more» pressed while the apply reads does not cancel it', async () => {
    window.localStorage.setItem('skein.tasks.view', 'kanban');
    server(2, 30);
    serve();
    await act(async () => { render(column('/projects/demo')); });
    await advance(500);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /load more/i })); });
    await advance(300);
    expect(calls).toEqual([undefined, 'c1']);
    await returnToTab();
    expect(updatesButton()).not.toBeNull();
    calls = [];

    let answer: () => void = () => {};
    const first = pages[FIRST];
    listIssuesSpy.mockImplementationOnce((_pid, params) => {
      calls.push(params?.cursor);
      return new Promise((resolve) => { answer = () => resolve(first); });
    });
    await act(async () => { fireEvent.click(updatesButton()!); });
    await advance(0);
    const more = screen.getByRole('button', { name: /load more/i });
    await act(async () => { fireEvent.click(more); });
    await advance(0);
    expect(calls).toEqual([undefined]);
    answer();
    await advance(300);
    expect(calls).toEqual([undefined]);
    expect(updatesButton()).toBeNull();
  });

  test('the board: one page, a lane scrolled down — the list is held, and the apply brings every lane to its start with one read', async () => {
    window.localStorage.setItem('skein.tasks.view', 'kanban');
    server(1, 30);
    pages[FIRST] = { ...pages[FIRST], hasMore: true, nextCursor: 'c1' };
    serve();
    await act(async () => { render(column('/projects/demo')); });
    await advance(500);
    const lanes = [...document.querySelectorAll<HTMLElement>('.kanban-col-body')];
    expect(lanes.length).toBeGreaterThan(0);
    lanes.forEach((lane) => scrollable(lane, () => 3000));
    act(() => { lanes[0].scrollTo({ top: 600 }); });
    calls = [];

    await issueCreated('demo-new');
    expect(calls).toEqual([]);
    expect(updatesButton()).not.toBeNull();

    await act(async () => { fireEvent.click(updatesButton()!); });
    expect(lanes.every((lane) => lane.scrollTop === 0)).toBe(true);
    await advance(300);
    expect(calls).toEqual([undefined]);
  });

  // The column keeps the list's query observed under a surface that shows
  // something else (the reminders lens, the result of pasted codes): such a
  // list is not one the reader is in, and has no «Updates available» to
  // offer — it is re-read as before (K21). A rooted subtree (anchored) is
  // the third such surface; it is reached through the same «shown» report
  // of the column, not driven here.
  test.each<[string, (rerender: (ui: React.ReactElement) => void) => Promise<void>]>([
    ['the reminders lens', async (rerender) => {
      await act(async () => { rerender(column('/projects/demo', true)); });
    }],
    ['the result of pasted codes', async () => {
      const search = screen.getByRole('textbox', { name: /search/i });
      await act(async () => {
        fireEvent.paste(search, { clipboardData: { getData: () => 'demo-1 demo-2' } });
      });
    }],
  ])('a list under %s is not held: it is re-read as before', async (_n, enter) => {
    window.localStorage.setItem('skein.tasks.view', 'tree');
    server(3, 60);
    serve();
    let rerender: (ui: React.ReactElement) => void = () => {};
    await act(async () => { ({ rerender } = render(column('/projects/demo'))); });
    await advance(500);
    scrollable(listBody(), canvasPx);
    act(() => { listBody().scrollTo({ top: 1e9 }); });
    await deliverIntersections();
    await advance(300);
    expect(calls).toEqual([undefined, 'c1']);

    await enter(rerender);
    await advance(300);
    calls = [];
    await returnToTab();
    expect(calls).toEqual([undefined]);
  });
});
