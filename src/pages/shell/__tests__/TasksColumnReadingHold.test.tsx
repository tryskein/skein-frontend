/**
 * sk-763 — the real Tasks column holds the list it shows, offers «Updates
 * available» where the reader can reach it, and applies it with one read of
 * the first page.
 *
 * The reference is the owner's decision for sk-763 (see
 * `lib/liveListDirty.ts`): the list the column shows is not reset or re-read
 * by the background, whatever its size and wherever its reader is; changes of
 * its rows the client can apply are applied in place, and the reader applies
 * the owed membership changes with one click — the first page, one request —
 * and is shown the list from its start.
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
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import * as signalr from '@microsoft/signalr';
import i18n from '../../../i18n/config';

import type { FetchIssueTreeArgs, IssueSummary, IssueTreeResponse, ListIssuesParams, ListIssuesResult } from '../../../api/issues';

const P = 'proj-uuid-1';

const listIssuesSpy = vi.fn<(projectId: string, params?: ListIssuesParams) => Promise<ListIssuesResult>>();
/** The tree endpoint (`GET …/issues/tree`), the column's layered tree reads it. */
const fetchIssueTreeSpy = vi.fn<(args: FetchIssueTreeArgs) => Promise<IssueTreeResponse>>();

vi.mock('../../../api/issues', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/issues')>();
  return {
    ...actual,
    listIssues: (...args: [string, ListIssuesParams?]) => listIssuesSpy(...args),
    fetchIssueTree: (args: FetchIssueTreeArgs) => fetchIssueTreeSpy(args),
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
const { TasksUiStateProvider, useTasksUiState } = await import('../../../lib/useTasksUiState');
const { TasksColumn } = await import('../TasksColumn');
const { setViewportWidth } = await import('../../../test/viewport');
const { resetTasksColumnTreeClockForTests } = await import('../../../lib/tasksColumnTreeClock');

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

/** The column's own UI state, as the header's view switch uses it (`HeaderBar.tsx#ViewSwitch`). */
let ui: ReturnType<typeof useTasksUiState> | null = null;
function UiState() {
  ui = useTasksUiState();
  return null;
}

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
                        <UiState />
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
  // The column tree's clock is the tab's (module state): a case's fake time
  // starts at the real now again, so an event stamped by the case before
  // would lie in this case's future and make its first answer stale.
  resetTasksColumnTreeClockForTests();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = FakeIntersectionObserver;
  observers.splice(0);
  window.localStorage.clear();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  listIssuesSpy.mockReset();
  fetchIssueTreeSpy.mockReset();
  fetchIssueTreeSpy.mockImplementation(async () => ({ items: [] }));
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

  // sk-763 (owner's decision) — the list the column shows is held whatever
  // its size and wherever its reader is: one page at its start too. A change
  // of membership waits for «Updates available», which reads the first page
  // once. Another surface — another view, or the board grouped by another
  // field — shows the same list, and it stays held: the change of surface
  // takes neither the mark nor the pages, and itself reads nothing.

  type Surface = 'tree' | 'kanban';

  /** A one-page list (more on the server) on `surface`, its reader away from the start. */
  async function onePageReadAwayFromStart(surface: Surface): Promise<void> {
    window.localStorage.setItem('skein.tasks.view', surface);
    server(1, 30);
    pages[FIRST] = { ...pages[FIRST], hasMore: true, nextCursor: 'c1' };
    serve();
    await act(async () => { render(column('/projects/demo')); });
    await advance(500);
    if (surface === 'tree') {
      scrollable(listBody(), canvasPx);
      act(() => { listBody().scrollTo({ top: 200 }); });
    } else {
      const lanes = [...document.querySelectorAll<HTMLElement>('.kanban-col-body')];
      expect(lanes.length).toBeGreaterThan(0);
      lanes.forEach((lane) => scrollable(lane, () => 3000));
      act(() => { lanes[0].scrollTo({ top: 600 }); });
    }
  }

  /** Two pages loaded on `surface` (the tree by its sentinel, the board by «Load more»). */
  async function twoPagesLoaded(surface: Surface): Promise<void> {
    window.localStorage.setItem('skein.tasks.view', surface);
    server(3, 60);
    serve();
    await act(async () => { render(column('/projects/demo')); });
    await advance(500);
    if (surface === 'tree') {
      scrollable(listBody(), canvasPx);
      act(() => { listBody().scrollTo({ top: 1e9 }); });
      await deliverIntersections();
    } else {
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: /load more/i })); });
    }
    await advance(300);
    expect(calls).toEqual([undefined, 'c1']);
  }

  /** The lane titles of the board (the grouping it shows). */
  const laneTitles = () => [...document.querySelectorAll('.kanban-col-title')].map((el) => el.textContent);

  /**
   * A change of surface, as the header's controls make it
   * (`HeaderBar.tsx#ViewSwitch`, the board's grouping), and what shows that
   * the new surface is on screen.
   */
  const changes = {
    'the tree, then the board': {
      from: 'tree',
      change: async () => {
        await act(async () => { ui!.setView('kanban'); });
        await advance(300);
        expect(document.querySelector('.task-tree-virtual-canvas')).toBeNull();
        expect(document.querySelector('.kanban-col-body')).not.toBeNull();
      },
    },
    'the tree, then the cards': {
      from: 'tree',
      change: async () => {
        await act(async () => { ui!.setView('cards'); });
        await advance(300);
        expect(document.querySelector('.task-tree-virtual-canvas')).toBeNull();
      },
    },
    // Every task of the fixture has priority 2: grouped by priority, the
    // board shows the lane of that value («P2»), which grouping by status
    // does not; and the lanes it shows now are at their start.
    'the board by status, then by priority': {
      from: 'kanban',
      change: async () => {
        expect(laneTitles()).not.toContain('P2');
        await act(async () => { ui!.setKanbanAxis('priority'); });
        await advance(300);
        expect(laneTitles()).toContain('P2');
        const lanes = [...document.querySelectorAll<HTMLElement>('.kanban-col-body')];
        expect(lanes.length).toBeGreaterThan(0);
        expect(lanes.map((lane) => lane.scrollTop)).toEqual(lanes.map(() => 0));
      },
    },
  } satisfies Record<string, { from: Surface; change: () => Promise<void> }>;
  type ChangeName = keyof typeof changes;
  const changeNames = (Object.keys(changes) as ChangeName[]).map((n): [ChangeName] => [n]);

  /** Change the surface; the change itself sends no request. */
  async function changeSurface(name: ChangeName): Promise<void> {
    const before = [...calls];
    await changes[name].change();
    expect(calls).toEqual(before);
  }

  test.each<[string, 'tree' | 'cards' | 'kanban']>([
    ['the tree', 'tree'],
    ['the cards', 'cards'],
    ['the board', 'kanban'],
  ])('%s, one page read from its start: a created issue sends nothing and is offered; the button reads the first page once', async (_n, view) => {
    window.localStorage.setItem('skein.tasks.view', view);
    server(1, 30);
    pages[FIRST] = { ...pages[FIRST], hasMore: true, nextCursor: 'c1' };
    serve();
    await act(async () => { render(column('/projects/demo')); });
    await advance(500);
    expect(calls).toEqual([undefined]);
    calls = [];

    await issueCreated('demo-new');
    expect(calls).toEqual([]);
    expect(updatesButton()).not.toBeNull();

    await act(async () => { fireEvent.click(updatesButton()!); });
    await advance(300);
    expect(calls).toEqual([undefined]);
    expect(updatesButton()).toBeNull();
  });

  test.each(changeNames)('a one-page list read away from its start, %s shown from its start: the list stays held — a created issue sends nothing and is offered', async (name) => {
    await onePageReadAwayFromStart(changes[name].from);
    expect(calls).toEqual([undefined]);
    await changeSurface(name);
    calls = [];

    await issueCreated('demo-new');

    expect(calls).toEqual([]);
    expect(updatesButton()).not.toBeNull();
  });

  test.each(changeNames)('a one-page list that owes its updates, %s: the list stays held and the offer stays', async (name) => {
    await onePageReadAwayFromStart(changes[name].from);
    calls = [];
    await issueCreated('demo-new-1');
    expect(calls).toEqual([]);
    expect(updatesButton()).not.toBeNull();

    await changeSurface(name);
    await issueCreated('demo-new-2');

    expect(calls).toEqual([]);
    expect(updatesButton()).not.toBeNull();
  });

  test.each(changeNames)('a list with two pages loaded, %s shown from its start: the list stays held, and a created issue is offered', async (name) => {
    await twoPagesLoaded(changes[name].from);
    await changeSurface(name);
    calls = [];
    await issueCreated('demo-new');

    expect(calls).toEqual([]);
    expect(updatesButton()).not.toBeNull();
  });

  // sk-763 — the tree with a link lens beyond parent-child (here «blocks»)
  // draws its rows from the project's layered tree (`useLayeredTree`); the
  // task list behind it still decides what the body shows around them —
  // loading, a failure, an empty filtered set — and the header's count. The
  // surface has these two sources, and both are held: the background reads
  // neither, a membership change waits for «Updates available», and the one
  // button reads each source once and is done only when both are.

  /** A tree node of the literal tree endpoint. */
  const node = (n: number) => ({ item: issue(n), depth: 0, isReference: false }) as unknown as IssueTreeResponse['items'][number];

  /** The tree endpoint answers `n` root rows. */
  const treeOf = (n: number): IssueTreeResponse => ({ items: Array.from({ length: n }, (_, i) => node(i + 1)) });

  const treeReads = () => fetchIssueTreeSpy.mock.calls.length;

  /** The tree view of `demo` with the «blocks» lens, as the lens control stores it, mounted. */
  async function mountLayeredTree(): Promise<void> {
    window.localStorage.setItem('skein.tasks.view', 'tree');
    window.localStorage.setItem('skein.tasks.tree.demo.depTypes', JSON.stringify(['blocks', 'parent-child']));
    server(1, 30);
    serve();
    await act(async () => { render(column('/projects/demo')); });
  }

  /** The tree view with the «blocks» lens, its tree answered with `rows` rows. */
  async function layeredTreeShown(rows = 5): Promise<void> {
    fetchIssueTreeSpy.mockImplementation(async () => treeOf(rows));
    await mountLayeredTree();
    await advance(500);
    // The layered tree of the project, with the lens, is what is drawn.
    expect(treeReads()).toBe(1);
    expect(fetchIssueTreeSpy.mock.calls[0][0]).toMatchObject({ projectId: P, rootId: undefined });
    expect(fetchIssueTreeSpy.mock.calls[0][0].types).toContain('blocks');
    expect(screen.queryByText(`title demo-${rows}`)).not.toBeNull();
  }

  test.each<[string, () => Promise<void>]>([
    ['a created issue', () => issueCreated('demo-new')],
    ['the return to the tab', () => returnToTab()],
  ])('the tree with the «blocks» lens: %s reads neither the tree nor the task list and offers the updates; the button reads each once', async (_n, wave) => {
    await layeredTreeShown();
    fetchIssueTreeSpy.mockClear();
    calls = [];

    await wave();

    expect(treeReads()).toBe(0);
    expect(calls).toEqual([]);
    expect(screen.queryByText('title demo-5')).not.toBeNull();
    expect(updatesButton()).not.toBeNull();

    fetchIssueTreeSpy.mockImplementation(async () => treeOf(6));
    await act(async () => { fireEvent.click(updatesButton()!); });
    await advance(300);

    expect(treeReads()).toBe(1);
    expect(calls).toEqual([undefined]);
    expect(screen.queryByText('title demo-6')).not.toBeNull();
    expect(updatesButton()).toBeNull();
    expect(screen.getByRole('status').textContent).not.toBe('');
  });

  // An event before the first answer of the tree is owed by that answer,
  // whichever way the live layer meets it: a created issue names the
  // project's trees; a row change of an issue (phase 2) meets the tree only
  // as «not answered yet», and that answer may come before the wave.
  test.each<[string, () => void]>([
    ['a created issue', () => {
      act(() => hub.handlers.get('event')!({
        id: nextEnvelope++, occurredAt: '2026-10-01T10:01:00Z', eventType: 'issue.created', entityType: 'issue',
        entityId: 'demo-new', projectId: P, actor: 'bob', actorType: 'human', actorUserId: 'u-2', entityTitle: 'demo-new', projectIdPrefix: 'demo',
      }));
    }],
    ['a renamed issue (its row on the event)', () => {
      const { isBlocked: _b, ...row } = { ...issue(1), title: 'renamed demo-1', version: 2, updatedAt: ts(20_000), rowSeq: 41 };
      act(() => hub.handlers.get('event')!({
        id: nextEnvelope++, occurredAt: '2026-10-01T10:02:00Z', eventType: 'issue.updated', entityType: 'issue',
        entityId: row.id, projectId: P, actor: 'bob', actorType: 'human', actorUserId: 'u-2', entityTitle: row.title, projectIdPrefix: 'demo',
        changedFields: ['title'], row,
      }));
    }],
  ])('the tree with the «blocks» lens: %s during its first read, answered before the wave, is offered — not read again', async (_n, event) => {
    let answer: () => void = () => {};
    fetchIssueTreeSpy.mockImplementation(() => new Promise((resolve) => { answer = () => resolve(treeOf(5)); }));
    await mountLayeredTree();
    await advance(100);
    expect(treeReads()).toBe(1);

    event();
    await advance(100);
    answer();
    await advance(LIVE_INVALIDATION_WINDOW_MS + 300);

    expect(screen.queryByText('title demo-5')).not.toBeNull();
    expect(treeReads()).toBe(1);
    expect(updatesButton()).not.toBeNull();

    fetchIssueTreeSpy.mockImplementation(async () => treeOf(6));
    await act(async () => { fireEvent.click(updatesButton()!); });
    await advance(300);
    expect(treeReads()).toBe(2);
    expect(screen.queryByText('title demo-6')).not.toBeNull();
    expect(updatesButton()).toBeNull();
  });

  test('the tree with the «blocks» lens: an event during the reads the button started is offered when they end, not read again', async () => {
    await layeredTreeShown();
    await issueCreated('demo-new-1');
    expect(updatesButton()).not.toBeNull();
    fetchIssueTreeSpy.mockClear();
    calls = [];
    let answer: () => void = () => {};
    fetchIssueTreeSpy.mockImplementation(() => new Promise((resolve) => { answer = () => resolve(treeOf(6)); }));

    await act(async () => { fireEvent.click(updatesButton()!); });
    await advance(0);
    expect(treeReads()).toBe(1);
    await issueCreated('demo-new-2');
    answer();
    await advance(LIVE_INVALIDATION_WINDOW_MS + 300);

    expect(screen.queryByText('title demo-6')).not.toBeNull();
    expect(treeReads()).toBe(1);
    expect(calls).toEqual([undefined]);
    expect(updatesButton()).not.toBeNull();
  });

  test('the tree with the «blocks» lens: the network back after the tree went stale reads no tree', async () => {
    await layeredTreeShown();
    fetchIssueTreeSpy.mockClear();
    calls = [];

    try {
      act(() => { onlineManager.setOnline(false); });
      await advance(10_000);
    } finally {
      act(() => { onlineManager.setOnline(true); });
    }
    await advance(300);

    expect(treeReads()).toBe(0);
    expect(calls).toEqual([]);
    expect(screen.queryByText('title demo-5')).not.toBeNull();
  });

  // The two reads of the button are one attempt: a failure of either keeps
  // the offer to retry, and the retry reads only the source still owed.
  test.each<[string, 'tree' | 'list']>([
    ['the tree', 'tree'],
    ['the task list', 'list'],
  ])('the tree with the «blocks» lens: the read of %s fails — the button offers a retry, which reads only that source and ends the updates', async (_n, failing) => {
    await layeredTreeShown();
    await issueCreated('demo-new');
    fetchIssueTreeSpy.mockClear();
    calls = [];
    fetchIssueTreeSpy.mockImplementation(async () => {
      if (failing === 'tree') throw new Error('down');
      return treeOf(6);
    });
    if (failing === 'list') {
      listIssuesSpy.mockImplementationOnce((_pid, params) => {
        calls.push(params?.cursor);
        return Promise.reject(new Error('down'));
      });
    }

    await act(async () => { fireEvent.click(updatesButton()!); });
    await advance(300);

    expect(treeReads()).toBe(1);
    expect(calls).toEqual([undefined]);
    const retry = screen.queryByRole('button', { name: 'Update failed — retry' });
    expect(retry).not.toBeNull();

    fetchIssueTreeSpy.mockClear();
    calls = [];
    fetchIssueTreeSpy.mockImplementation(async () => treeOf(6));
    act(() => { retry!.focus(); });
    await act(async () => { fireEvent.click(retry!); });
    await advance(300);

    expect(treeReads()).toBe(failing === 'tree' ? 1 : 0);
    expect(calls).toEqual(failing === 'list' ? [undefined] : []);
    expect(screen.queryByText('title demo-6')).not.toBeNull();
    expect(screen.queryByRole('button', { name: /Updating…|Update failed|Updates available/ })).toBeNull();
    // The retry read only the failed source, and it is this surface's own
    // end (the clean source is part of it): told, and the focus given back.
    expect(screen.getByRole('status').textContent).toBe(i18n.t('tasks:updatesApplied'));
    expect(document.activeElement).not.toBeNull();
    expect(document.activeElement!.matches('.col-tasks-header, .task-filters-search input')).toBe(true);
  });

  test('the tree with the «blocks» lens: the tree read landed, the task list read not yet — the button stays busy, a press reads nothing more, the end is told when both landed', async () => {
    await layeredTreeShown();
    await issueCreated('demo-new');
    fetchIssueTreeSpy.mockClear();
    calls = [];
    fetchIssueTreeSpy.mockImplementation(async () => treeOf(6));
    let answer: () => void = () => {};
    const first = pages[FIRST];
    listIssuesSpy.mockImplementationOnce((_pid, params) => {
      calls.push(params?.cursor);
      return new Promise((resolve) => { answer = () => resolve(first); });
    });

    const button = updatesButton()!;
    act(() => { button.focus(); });
    await act(async () => { fireEvent.click(button); });
    await advance(300);

    // The tree has its answer; the task list has not.
    expect(screen.queryByText('title demo-6')).not.toBeNull();
    expect(treeReads()).toBe(1);
    expect(calls).toEqual([undefined]);
    const busy = screen.queryByRole('button', { name: 'Updating…' });
    expect(busy).not.toBeNull();
    expect(document.activeElement).toBe(busy);
    expect(screen.getByRole('status').textContent).toBe('Updating…');

    await act(async () => { fireEvent.click(busy!); });
    await advance(300);
    expect(treeReads()).toBe(1);
    expect(calls).toEqual([undefined]);

    answer();
    await advance(300);

    expect(screen.queryByRole('button', { name: /Updating…|Update failed|Updates available/ })).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('The list is updated');
    // Where the single-list contract sends it: the header, or the search
    // field where the header is not laid out (`TasksColumn.tsx#focusAfterUpdates`).
    expect(document.activeElement).not.toBeNull();
    expect(document.activeElement!.matches('.col-tasks-header, .task-filters-search input')).toBe(true);
    expect(treeReads()).toBe(1);
    expect(calls).toEqual([undefined]);
  });

  // A failed attempt keeps the obligations of the source that landed: a new
  // event before the retry marks it again, and the retry reads both — each once.
  test.each<[string, 'tree' | 'list']>([
    ['the tree', 'tree'],
    ['the task list', 'list'],
  ])('the tree with the «blocks» lens: the read of %s failed and an issue is created before the retry — the retry reads both sources once', async (_n, failing) => {
    await layeredTreeShown();
    await issueCreated('demo-new-1');
    fetchIssueTreeSpy.mockClear();
    calls = [];
    fetchIssueTreeSpy.mockImplementation(async () => {
      if (failing === 'tree') throw new Error('down');
      return treeOf(6);
    });
    if (failing === 'list') {
      listIssuesSpy.mockImplementationOnce((_pid, params) => {
        calls.push(params?.cursor);
        return Promise.reject(new Error('down'));
      });
    }
    await act(async () => { fireEvent.click(updatesButton()!); });
    await advance(300);
    expect(treeReads()).toBe(1);
    expect(calls).toEqual([undefined]);
    expect(screen.queryByRole('button', { name: 'Update failed — retry' })).not.toBeNull();

    fetchIssueTreeSpy.mockClear();
    calls = [];
    fetchIssueTreeSpy.mockImplementation(async () => treeOf(7));
    await issueCreated('demo-new-2');
    // The background still reads neither source.
    expect(treeReads()).toBe(0);
    expect(calls).toEqual([]);
    const retry = screen.queryByRole('button', { name: 'Update failed — retry' });
    expect(retry).not.toBeNull();

    await act(async () => { fireEvent.click(retry!); });
    await advance(300);

    expect(treeReads()).toBe(1);
    expect(calls).toEqual([undefined]);
    expect(screen.queryByText('title demo-7')).not.toBeNull();
    expect(screen.queryByRole('button', { name: /Updating…|Update failed|Updates available/ })).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('The list is updated');
  });

  test('the tree with the «blocks» lens and a filter with no task: the column shows its empty state, not the tree', async () => {
    await layeredTreeShown();
    listIssuesSpy.mockImplementation((_pid, params) => {
      calls.push(params?.cursor);
      return Promise.resolve(params?.priority === 1
        ? { items: [], total: 0, hasMore: false, nextCursor: null }
        : pages[params?.cursor ?? FIRST]);
    });

    await act(async () => { ui!.setPriorityFilter('1'); });
    await advance(500);

    // The tree is not filtered (sk-44.5); the empty filtered task list keeps
    // it off the screen, as before.
    expect(screen.queryByText('title demo-5')).toBeNull();
    expect(screen.queryByText('title demo-1')).toBeNull();
    expect(screen.queryByText(i18n.t('tasks:emptyFiltered'))).not.toBeNull();
  });

  // The end of an attempt belongs to the surface that was pressed — all of
  // its lists, read or not — not to any surface that shares one of them.
  test('the tree with the «blocks» lens: the task filter changes while the button reads — the end of the old reads is not told to the new pair', async () => {
    await layeredTreeShown();
    await issueCreated('demo-new');
    fetchIssueTreeSpy.mockImplementation(async () => treeOf(6));
    let answer: () => void = () => {};
    const first = pages[FIRST];
    listIssuesSpy.mockImplementationOnce((_pid, params) => {
      calls.push(params?.cursor);
      return new Promise((resolve) => { answer = () => resolve(first); });
    });
    await act(async () => { fireEvent.click(updatesButton()!); });
    await advance(300);
    expect(screen.queryByText('title demo-6')).not.toBeNull();

    // The new task list (the same tree) fails its first read.
    listIssuesSpy.mockImplementation((_pid, params) => {
      calls.push(params?.cursor);
      return params?.priority === 1 ? Promise.reject(new Error('down')) : Promise.resolve(pages[params?.cursor ?? FIRST]);
    });
    await act(async () => { ui!.setPriorityFilter('1'); });
    await advance(300);

    answer();
    await advance(300);

    expect(screen.getByRole('status').textContent).not.toBe(i18n.t('tasks:updatesApplied'));
  });

  test('the cards turn into the tree with the «blocks» lens while the button reads — the end of the list\'s read is not told to the tree, and the leaving button gives its focus to the column', async () => {
    window.localStorage.setItem('skein.tasks.view', 'cards');
    window.localStorage.setItem('skein.tasks.tree.demo.depTypes', JSON.stringify(['blocks', 'parent-child']));
    server(1, 30);
    serve();
    await act(async () => { render(column('/projects/demo')); });
    await advance(500);
    expect(treeReads()).toBe(0);
    await issueCreated('demo-new');
    expect(updatesButton()).not.toBeNull();
    let answer: () => void = () => {};
    const first = pages[FIRST];
    listIssuesSpy.mockImplementationOnce((_pid, params) => {
      calls.push(params?.cursor);
      return new Promise((resolve) => { answer = () => resolve(first); });
    });
    await act(async () => { fireEvent.click(updatesButton()!); });
    await advance(300);

    // The tree's first read waits.
    let treeAnswer: () => void = () => {};
    fetchIssueTreeSpy.mockImplementation(() => new Promise((resolve) => { treeAnswer = () => resolve(treeOf(5)); }));
    await act(async () => { ui!.setView('tree'); });
    await advance(300);
    expect(treeReads()).toBe(1);
    // The tree's button shows the list's read running; the reader is on it.
    const busy = screen.queryByRole('button', { name: i18n.t('tasks:updatesApplying') });
    expect(busy).not.toBeNull();
    act(() => { busy!.focus(); });
    const listReads = calls.length;

    answer();
    await advance(300);

    expect(screen.getByRole('status').textContent).not.toBe(i18n.t('tasks:updatesApplied'));
    // Nothing is owed any more: the button leaves, its focus goes to the column.
    expect(screen.queryByRole('button', { name: /Updating…|Update failed|Updates available/ })).toBeNull();
    expect(document.activeElement).not.toBeNull();
    expect(document.activeElement!.matches('.col-tasks-header, .task-filters-search input')).toBe(true);
    expect(treeReads()).toBe(1);
    expect(calls.length).toBe(listReads);
    treeAnswer();
    await advance(300);
  });

  test('the tree with the «blocks» lens: an issue created while the button reads — the reads land, the offer stays and keeps the focus', async () => {
    await layeredTreeShown();
    await issueCreated('demo-new-1');
    let answer: () => void = () => {};
    fetchIssueTreeSpy.mockImplementation(() => new Promise((resolve) => { answer = () => resolve(treeOf(6)); }));
    const button = updatesButton()!;
    act(() => { button.focus(); });
    await act(async () => { fireEvent.click(button); });
    await advance(0);
    await issueCreated('demo-new-2');
    answer();
    await advance(300);

    expect(screen.queryByText('title demo-6')).not.toBeNull();
    const offer = updatesButton();
    expect(offer).not.toBeNull();
    expect(document.activeElement).toBe(offer);
  });

  test('the tree rooted at an epic: the network back after it went stale reads it again, as before', async () => {
    await layeredTreeShown();
    await act(async () => { ui!.setTreeRootAnchor({ id: 'demo-1', projectId: P }); });
    await advance(500);
    const rooted = () => fetchIssueTreeSpy.mock.calls.filter(([args]) => args.rootId === 'demo-1').length;
    expect(rooted()).toBe(1);

    try {
      act(() => { onlineManager.setOnline(false); });
      await advance(10_000);
    } finally {
      act(() => { onlineManager.setOnline(true); });
    }
    await advance(300);

    expect(rooted()).toBe(2);
  });

  test('the tree with the «blocks» lens: the button moves to the filters row while it reads — it stays busy, reads nothing more, and tells the end there', async () => {
    setViewportWidth(1440);
    await layeredTreeShown();
    await issueCreated('demo-new');
    fetchIssueTreeSpy.mockClear();
    calls = [];
    fetchIssueTreeSpy.mockImplementation(async () => treeOf(6));
    let answer: () => void = () => {};
    const first = pages[FIRST];
    listIssuesSpy.mockImplementationOnce((_pid, params) => {
      calls.push(params?.cursor);
      return new Promise((resolve) => { answer = () => resolve(first); });
    });
    const inHeader = updatesButton()!;
    expect(inHeader.closest('.col-tasks-header')).not.toBeNull();
    await act(async () => { fireEvent.click(inHeader); });
    await advance(300);
    expect(treeReads()).toBe(1);
    expect(calls).toEqual([undefined]);

    // A phone: the column header is stripped, the button is in the filters row.
    act(() => { setViewportWidth(390); });
    await advance(300);
    const busy = screen.queryByRole('button', { name: 'Updating…' });
    expect(busy).not.toBeNull();
    expect(busy).not.toBe(inHeader);
    expect(busy!.closest('.col-tasks-header')).toBeNull();
    expect(treeReads()).toBe(1);
    expect(calls).toEqual([undefined]);
    act(() => { busy!.focus(); });

    answer();
    await advance(300);

    expect(screen.queryByRole('button', { name: /Updating…|Update failed|Updates available/ })).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('The list is updated');
    expect(document.activeElement).not.toBeNull();
    expect(document.activeElement!.matches('.col-tasks-header, .task-filters-search input')).toBe(true);
    expect(treeReads()).toBe(1);
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
