/**
 * sk-674.18 T053 — loss of access in a live tab (row 240; spec
 * US-19, SC-015, E-9, E-23; screens 1.15).
 *
 * Driven the way the tab meets it: a personal-signal frame arrives on the
 * hub connection of the real `LiveEventsProvider`, mounted inside a router,
 * and the provider's loss-of-access hook (`accessLoss.ts#LiveAccessLoss`)
 * consumes it — the signal, and for a single lost project the server's
 * answer to re-reading the open issue. No helper is called directly.
 *
 *  - a possible loss (`removed` / `deleted`, `owner_changed`, the area
 *    `projects`) drops from the cache the queues, the task lists, the
 *    cards, the search, the people directory and HOT ZONE, on any route —
 *    a card on screen is emptied, a read in flight cannot write after it;
 *    any other reason touches none of it;
 *  - the place of a lost space, or an issue of one of its projects, is
 *    left for `/` with the toast of the reason;
 *  - a lost single project (the frame carries `projects`, the open issue
 *    now answers «not found») leaves for `/`; on the space place it only
 *    closes the card — the space page closes only when the space itself is
 *    lost.
 *
 * The SignalR mock is the one of `livePersonalSignal.test.ts`.
 */
import { createElement, Fragment } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import * as signalr from '@microsoft/signalr';
import i18n from '../i18n/config';
import { LiveEventsProvider } from '../hooks/useLiveEvents';
import { LIVE_INVALIDATION_WINDOW_MS } from './liveInvalidationBatcher';
import type { IssueSummary } from '../api/issues';
import { releaseAllAccepted, retainAccepted } from './inboxAcceptedRetention';
import { useInbox } from './useInbox';
import { _resetDashboardBusForTests, subscribeDashboardPurge } from './dashboardEventBus';

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u-1', username: 'u1', role: 'user' }, logout: () => Promise.resolve() }),
  useAuthOptional: () => ({ user: { id: 'u-1', username: 'u1', role: 'user' } }),
}));

const toastInfo = vi.fn();
vi.mock('../components/Toaster', () => ({
  toaster: { info: (m: string) => toastInfo(m), error: vi.fn(), success: vi.fn() },
  useToaster: () => ({ info: vi.fn(), error: vi.fn(), success: vi.fn() }),
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

const ACME = 'k3x9p2qa';
const WEB_PROJECT = '11111111-2222-3333-4444-555555555555';

/** Keys of everything a lost space may still hold, and a neighbour that must stay. */
const KEYS = {
  counts: ['notification-counts'],
  inbox: ['inbox', 'assigned-to-me-unaccepted-open'],
  mentions: ['mentions', 'feed'],
  watching: ['watching', 'feed', 'unread'],
  tasksAll: ['tasks', 'all', 'cross-project', 'active', 'all', 'all', 'all', '', 'updated', '', ''],
  detail: ['issues', 'detail', 'web-1'],
  tree: ['issues', 'tree', 'cross'],
  search: ['search', 'global', 'acme', 'issue'],
  directory: ['users', 'directory', 'bo'],
  hotZone: ['dashboard', 'feed', 'initial'],
  // Not data of a space: a theme.
  theme: ['themes', 'list'],
} as const;
type KeyName = keyof typeof KEYS;

let qc: QueryClient;
let location = '';
/** Whether the open issue is still readable for the signed-in person. */
let issueReadable = true;
/** Whether the project `web` is still readable — by id and by resolve. */
let projectReadable = true;
/** The server fails the issue read (not «not found»). */
let issueFails = false;

const WEB_MATCH = { id: WEB_PROJECT, name: 'Web', idPrefix: 'web', similarity: 1, matchedVia: 'alias' };

function LocationProbe() {
  location = useLocation().pathname;
  return null;
}

async function mount(path: string, extra?: ReturnType<typeof createElement>): Promise<void> {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  for (const name of Object.keys(KEYS) as KeyName[]) qc.setQueryData(KEYS[name], {});
  // The server's Inbox: the cards accepted in this tab are no longer in it.
  qc.setQueryData(KEYS.inbox, EMPTY_LIST);
  // The open card of a project of Acme (its space is on the card).
  qc.setQueryData(['issues', 'detail', 'web-1'], { id: 'web-1', projectId: WEB_PROJECT, spaceId: ACME });
  // «My spaces» before the frame — for names and «new space».
  qc.setQueryData(['me', 'spaces', 'u-1'], {
    items: [{ id: ACME, name: 'Acme' }],
    ownedCount: 0,
    ownedLimit: null,
    canCreate: true,
    cannotCreateReason: null,
  });
  const page = createElement(Fragment, null, createElement(LocationProbe), extra);
  await act(async () => {
    render(
      createElement(
        QueryClientProvider,
        { client: qc },
        createElement(
          MemoryRouter,
          { initialEntries: [path] },
          createElement(
            LiveEventsProvider,
            null,
            createElement(Routes, null, createElement(Route, { path: '*', element: page })),
          ),
        ),
      ),
    );
  });
}

function deliver(payload: unknown): void {
  const handler = mock.handlers.get('signal');
  if (!handler) throw new Error('no signal handler registered');
  act(() => handler(payload));
}

async function settle(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(LIVE_INVALIDATION_WINDOW_MS);
  });
}

/** The keys of {@link KEYS} that still hold data. */
function cached(): KeyName[] {
  return (Object.keys(KEYS) as KeyName[])
    .filter((n) => qc.getQueryData(KEYS[n]) !== undefined)
    .sort();
}

function invalidated(): KeyName[] {
  return (Object.keys(KEYS) as KeyName[])
    .filter((n) => qc.getQueryState(KEYS[n])?.isInvalidated === true)
    .sort();
}

const frame = (areas: string[], spaces?: unknown[]) => ({
  areas,
  ...(spaces ? { spaces } : {}),
  sentAt: '2026-10-12T10:00:00Z',
});

const EMPTY_LIST = { items: [], total: 0, hasMore: false, nextCursor: null };

/** An Inbox card accepted in this tab on `/`, of the space `spaceId`. */
function acceptedCard(id: string, spaceId: string | undefined): IssueSummary {
  return {
    id,
    projectId: WEB_PROJECT,
    ...(spaceId === undefined ? {} : { spaceId }),
    parentIdCurrent: null,
    version: 1,
    title: id,
    type: 'task',
    priority: 2,
    status: 'open',
    pinned: false,
    assignee: 'u1',
    assigneeUserId: 'u-1',
    isBlocked: false,
    componentIds: [],
    labels: [],
    createdAt: '2026-10-01T10:00:00Z',
    updatedAt: '2026-10-01T10:00:00Z',
    acceptedAt: '2026-10-12T10:00:00Z',
  } as IssueSummary;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  mock.handlers.clear();
  toastInfo.mockClear();
  location = '';
  issueReadable = true;
  projectReadable = true;
  issueFails = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === 'string' ? input : input.toString(), 'http://app.test');
      // `getIssueByID`, hop 1: the cross-project list by id. An issue the
      // reader can no longer see is simply not in it.
      if (url.pathname === '/api/v1/issues' && url.searchParams.get('q') === 'web-1') {
        return json({
          items: issueReadable ? [{ id: 'web-1', projectId: WEB_PROJECT }] : [],
          total: issueReadable ? 1 : 0,
          hasMore: false,
          nextCursor: null,
        });
      }
      if (url.pathname === '/api/v1/me/assigned-to') return json(EMPTY_LIST);
      if (url.pathname === `/api/v1/projects/${WEB_PROJECT}`) {
        return projectReadable ? json({ id: WEB_PROJECT, idPrefix: 'web' }) : json({ error: 'project_not_found' }, 404);
      }
      if (url.pathname === '/api/v1/projects/resolve') {
        return json({ match: projectReadable ? WEB_MATCH : null, candidates: [] });
      }
      if (issueFails && url.pathname === '/api/v1/issues') return json({ error: 'internal_error' }, 500);
      if (url.pathname === `/api/v1/projects/${WEB_PROJECT}/issues/web-1`) {
        return issueReadable ? json({ id: 'web-1', projectId: WEB_PROJECT }) : json({ error: 'issue_not_found' }, 404);
      }
      return json({});
    }),
  );
});

afterEach(() => {
  cleanup();
  releaseAllAccepted();
  _resetDashboardBusForTests();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('row 240 — a lost space', () => {
  test('drops queues, lists, the card, search, directory and HOT ZONE from the cache on any route', async () => {
    // A route that has nothing to do with the lost space: the purge is
    // about the data, not about the page. Nothing shows these queries, so
    // their next mount must read the server, not the cache.
    await mount('/search');
    deliver(frame(['spaces'], [{ reason: 'removed', spaceId: ACME, spaceName: 'Acme' }]));
    await settle();
    expect(cached()).toEqual(['theme']);
    // No toast and no move — the page is not of that space.
    expect(location).toBe('/search');
    expect(toastInfo).not.toHaveBeenCalled();
  });

  test.each([
    ['owner_changed (E-29)', frame(['spaces'], [{ reason: 'owner_changed', spaceId: ACME }])],
    ['the area projects', frame(['projects'])],
  ])('a possible loss — %s — purges the same data', async (_label, f) => {
    await mount('/search');
    deliver(f);
    await settle();
    expect(cached()).toEqual(['theme']);
  });

  test('a read begun before the loss cannot write its answer after it', async () => {
    await mount('/search');
    let answer!: (v: unknown) => void;
    const late = qc.fetchQuery({
      queryKey: ['issues', 'detail', 'web-2'],
      queryFn: () => new Promise((r) => { answer = r; }),
    }).catch(() => undefined);
    deliver(frame(['spaces'], [{ reason: 'removed', spaceId: ACME, spaceName: 'Acme' }]));
    await act(async () => {
      answer({ id: 'web-2', projectId: WEB_PROJECT, spaceId: ACME });
      await late;
    });
    await settle();
    expect(qc.getQueryData(['issues', 'detail', 'web-2'])).toBeUndefined();
  });

  test('a list on screen reading at the loss: its pre-loss answer is never shown, the re-read is', async () => {
    const shown: unknown[] = [];
    const answers: Array<(v: unknown) => void> = [];
    function List() {
      const q = useQuery({
        queryKey: KEYS.tasksAll,
        queryFn: () => new Promise((r) => { answers.push(r); }),
        staleTime: Infinity,
      });
      shown.push(q.data);
      return null;
    }
    await mount('/search', createElement(List));
    // A read begun before the loss, still in flight when the frame comes.
    act(() => { void qc.refetchQueries({ queryKey: KEYS.tasksAll }); });
    expect(answers).toHaveLength(1);
    deliver(frame(['projects']));
    await act(async () => {
      answers[0]('pre-loss');
    });
    await settle();
    // The batcher's re-read is the second read; it answers after the loss.
    expect(answers).toHaveLength(2);
    await act(async () => {
      answers[1]('after');
    });
    expect(shown).not.toContain('pre-loss');
    expect(qc.getQueryData(KEYS.tasksAll)).toBe('after');
  });

  test('a card on screen is emptied at once, and a failed re-read does not bring it back', async () => {
    // The search page shows an issue card of Acme; its re-read is refused.
    const shown: Array<unknown> = [];
    function Card() {
      const q = useQuery({
        queryKey: KEYS.detail,
        queryFn: () => Promise.reject(new Error('issue_not_found')),
        staleTime: Infinity,
      });
      shown.push(q.data);
      return null;
    }
    await mount('/search', createElement(Card));
    expect(shown.at(-1)).toEqual({ id: 'web-1', projectId: WEB_PROJECT, spaceId: ACME });
    deliver(frame(['spaces'], [{ reason: 'removed', spaceId: ACME, spaceName: 'Acme' }]));
    // Gone from the cache with the frame, not with the re-read's answer.
    expect(qc.getQueryData(KEYS.detail)).toBeUndefined();
    await settle();
    expect(shown.at(-1)).toBeUndefined();
    expect(qc.getQueryData(KEYS.detail)).toBeUndefined();
  });

  test.each([
    ['its place', `/spaces/${ACME}-acme`],
    ['an issue open on its place', `/spaces/${ACME}-acme/issues/web-1`],
    ['an issue of one of its projects', '/projects/web/issues/web-1'],
    ['its settings', `/settings/spaces/${ACME}-acme`],
  ])('removed while on %s: leaves for / with «no longer a member»', async (_label, path) => {
    await mount(path);
    deliver(frame(['spaces', 'inbox'], [{ reason: 'removed', spaceId: ACME, spaceName: 'Acme' }]));
    await settle();
    expect(location).toBe('/');
    expect(toastInfo).toHaveBeenCalledWith(i18n.t('common:accessLoss.spaceRemoved', { name: 'Acme' }));
  });

  test('deleted (E-9) while its issue is open: leaves for / with «deleted»', async () => {
    await mount('/projects/web/issues/web-1');
    deliver(frame(['spaces'], [{ reason: 'deleted', spaceId: ACME, spaceName: 'Acme' }]));
    await settle();
    expect(location).toBe('/');
    expect(toastInfo).toHaveBeenCalledWith(i18n.t('common:accessLoss.spaceDeleted', { name: 'Acme' }));
  });

  test('another space lost: the place of this one stays open', async () => {
    await mount(`/spaces/${ACME}-acme`);
    deliver(frame(['spaces'], [{ reason: 'removed', spaceId: 'z9z9z9z9', spaceName: 'Zeta' }]));
    await settle();
    expect(location).toBe(`/spaces/${ACME}-acme`);
    expect(toastInfo).not.toHaveBeenCalled();
  });

  test('removed, then added back within one frame: the last entry wins, the place stays', async () => {
    await mount(`/spaces/${ACME}-acme`);
    deliver(frame(['spaces'], [
      { reason: 'removed', spaceId: ACME, spaceName: 'Acme' },
      { reason: 'added', spaceId: ACME, spaceName: 'Acme' },
    ]));
    await settle();
    expect(location).toBe(`/spaces/${ACME}-acme`);
  });
});

describe('row 240 — copies outside the cache (review C2)', () => {
  /** The Inbox column on `/`, as the person sees it. */
  let inboxIds: string[] = [];
  function InboxColumn() {
    const q = useInbox('/');
    inboxIds = (q.data?.items ?? []).map((it) => it.id);
    return null;
  }

  beforeEach(() => {
    inboxIds = [];
    // Accepted here earlier: a card of Acme, one of another space, one
    // whose space the list did not say.
    retainAccepted(acceptedCard('acme-1', ACME), 0, '/', 'u-1');
    retainAccepted(acceptedCard('zeta-1', 'z9z9z9z9'), 1, '/', 'u-1');
    retainAccepted(acceptedCard('old-1', undefined), 2, '/', 'u-1');
  });

  test('a lost space: its accepted Inbox cards leave the open column, the others stay', async () => {
    await mount('/', createElement(InboxColumn));
    expect(inboxIds).toEqual(['acme-1', 'zeta-1', 'old-1']);
    deliver(frame(['spaces'], [{ reason: 'removed', spaceId: ACME, spaceName: 'Acme' }]));
    await settle();
    expect(location).toBe('/');
    expect(inboxIds).toEqual(['zeta-1']);
  });

  test('the lost project set unknown (area projects): every accepted card leaves', async () => {
    await mount('/', createElement(InboxColumn));
    deliver(frame(['projects']));
    await settle();
    expect(inboxIds).toEqual([]);
  });

  test('HOT ZONE is told to drop its buffer on a loss, and only on a loss', async () => {
    const purges = vi.fn();
    subscribeDashboardPurge(purges);
    await mount('/activity');
    deliver(frame(['spaces'], [{ reason: 'renamed', spaceId: ACME, spaceName: 'Acme Ltd' }]));
    await settle();
    expect(purges).not.toHaveBeenCalled();
    deliver(frame(['spaces'], [{ reason: 'deleted', spaceId: ACME, spaceName: 'Acme' }]));
    await settle();
    expect(purges).toHaveBeenCalledTimes(1);
  });
});

describe('row 240 — a reason that takes no access away purges nothing', () => {
  // `livePersonalSignal.ts` re-reads the counters for the area `spaces`;
  // nothing else of the space's data is touched, and the open card is not
  // read again — even one the reader could no longer see.
  test.each(['invited', 'accepted', 'declined', 'expired', 'added', 'owner_assigned', 'renamed'])(
    '%s: only the counters are re-read, the open card is not re-checked',
    async (reason) => {
      issueReadable = false;
      await mount('/projects/web/issues/web-1');
      deliver(frame(['spaces'], [{ reason, spaceId: ACME, spaceName: 'Acme' }]));
      await settle();
      expect(invalidated()).toEqual(['counts']);
      expect(location).toBe('/projects/web/issues/web-1');
      expect(vi.mocked(fetch).mock.calls.map(([u]) => String(u)).filter((u) => u.includes('web-1'))).toEqual([]);
    },
  );

  test('owner_changed (E-29) may take projects away: the open card is re-checked', async () => {
    issueReadable = false;
    await mount('/projects/web/issues/web-1');
    deliver(frame(['spaces'], [{ reason: 'owner_changed', spaceId: ACME }]));
    await settle();
    expect(location).toBe('/');
    expect(toastInfo).toHaveBeenCalledWith(i18n.t('common:accessLoss.projectLost'));
  });
});

describe('row 240 — a project open by its alias (review C3)', () => {
  // `/projects/site`: `site` is an alias of `web` — neither its id nor
  // its idPrefix. The page resolved it, so this handle's resolve answer
  // is cached under its own key.
  const seedResolve = () => qc.setQueryData(['project', 'resolve', 'site'], { match: WEB_MATCH, candidates: [] });

  test('the project now answers «not found»: leaves for / with «project no longer available»', async () => {
    projectReadable = false;
    await mount('/projects/site');
    seedResolve();
    deliver(frame(['projects']));
    await settle();
    expect(location).toBe('/');
    expect(toastInfo).toHaveBeenCalledWith(i18n.t('common:accessLoss.projectLost'));
  });

  test('the project still answers: the tab stays', async () => {
    await mount('/projects/site');
    seedResolve();
    deliver(frame(['projects']));
    await settle();
    expect(location).toBe('/projects/site');
    expect(toastInfo).not.toHaveBeenCalled();
  });

  test('its space lost: the space is known through the resolved id, the tab leaves with the reason', async () => {
    await mount('/projects/site');
    seedResolve();
    qc.setQueryData(['projects', 'list', 'shell'], {
      items: [{ id: WEB_PROJECT, idPrefix: 'web', spaceId: ACME }],
      total: 1,
      hasMore: false,
      nextCursor: null,
    });
    deliver(frame(['spaces'], [{ reason: 'removed', spaceId: ACME, spaceName: 'Acme' }]));
    await settle();
    expect(location).toBe('/');
    expect(toastInfo).toHaveBeenCalledWith(i18n.t('common:accessLoss.spaceRemoved', { name: 'Acme' }));
  });

  test('a handle this tab never resolved is asked of the server: no match leaves', async () => {
    projectReadable = false;
    await mount('/projects/site');
    deliver(frame(['projects']));
    await settle();
    expect(location).toBe('/');
    expect(toastInfo).toHaveBeenCalledWith(i18n.t('common:accessLoss.projectLost'));
  });

  test('a handle this tab never resolved, still visible: the tab stays', async () => {
    await mount('/projects/site');
    deliver(frame(['projects']));
    await settle();
    expect(location).toBe('/projects/site');
  });
});

describe('row 240 — owner_assigned toasts (screens 1.15)', () => {
  test('a space not among my spaces before the frame: «owner of a new space»', async () => {
    await mount('/search');
    deliver(frame(['spaces'], [{ reason: 'owner_assigned', spaceId: 'n0n0n0n0', spaceName: 'Nova' }]));
    expect(toastInfo).toHaveBeenCalledTimes(1);
    expect(toastInfo).toHaveBeenCalledWith(i18n.t('common:accessLoss.ownerAssignedNew', { name: 'Nova' }));
  });

  test('a space already among my spaces (an owner change): «owner of the space»', async () => {
    await mount('/search');
    deliver(frame(['spaces'], [{ reason: 'owner_assigned', spaceId: ACME, spaceName: 'Acme' }]));
    expect(toastInfo).toHaveBeenCalledTimes(1);
    expect(toastInfo).toHaveBeenCalledWith(i18n.t('common:accessLoss.ownerAssigned', { name: 'Acme' }));
  });

  test('no name in the frame: the known space is named from my spaces', async () => {
    await mount('/search');
    deliver(frame(['spaces'], [{ reason: 'owner_assigned', spaceId: ACME }]));
    expect(toastInfo).toHaveBeenCalledWith(i18n.t('common:accessLoss.ownerAssigned', { name: 'Acme' }));
  });
});

describe('row 240 — an open project without a card (path B)', () => {
  // `/projects/web`: the project page, no issue open; the shell's project
  // list knows the project (and its space).
  const seedList = () =>
    qc.setQueryData(['projects', 'list', 'shell'], {
      items: [{ id: WEB_PROJECT, idPrefix: 'web', spaceId: ACME }],
      total: 1,
      hasMore: false,
      nextCursor: null,
    });

  test('the project now answers «not found»: leaves for / with «project no longer available»', async () => {
    projectReadable = false;
    await mount('/projects/web');
    seedList();
    deliver(frame(['projects']));
    await settle();
    expect(location).toBe('/');
    expect(toastInfo).toHaveBeenCalledWith(i18n.t('common:accessLoss.projectLost'));
  });

  test('the project still answers: the tab stays', async () => {
    await mount('/projects/web');
    seedList();
    deliver(frame(['projects']));
    await settle();
    expect(location).toBe('/projects/web');
    expect(toastInfo).not.toHaveBeenCalled();
  });

  test('not in any cache: the server is asked what the handle names; no match leaves', async () => {
    projectReadable = false;
    await mount('/projects/web');
    deliver(frame(['projects']));
    await settle();
    expect(location).toBe('/');
    expect(toastInfo).toHaveBeenCalledWith(i18n.t('common:accessLoss.projectLost'));
  });
});

describe('row 240 — owner toasts read the signed-in person’s spaces only (review W1)', () => {
  // The previous person of this tab (u-0) knew the space Xeno; the signed-in
  // u-1 never had it. A logout keeps u-0's entry in the cache.
  const XENO = 'x7x7x7x7';
  const seedPreviousPerson = () =>
    qc.setQueryData(['me', 'spaces', 'u-0'], {
      items: [{ id: XENO, name: 'Xeno (old name)' }],
      ownedCount: 1,
      ownedLimit: null,
      canCreate: true,
      cannotCreateReason: null,
    });

  test('a space only the previous person knew is «new» for this one', async () => {
    await mount('/search');
    seedPreviousPerson();
    deliver(frame(['spaces'], [{ reason: 'owner_assigned', spaceId: XENO, spaceName: 'Xeno' }]));
    expect(toastInfo).toHaveBeenCalledWith(i18n.t('common:accessLoss.ownerAssignedNew', { name: 'Xeno' }));
    expect(toastInfo).toHaveBeenCalledTimes(1);
  });

  test('a frame without a name never borrows the previous person’s name', async () => {
    await mount('/search');
    seedPreviousPerson();
    deliver(frame(['spaces'], [{ reason: 'owner_assigned', spaceId: XENO }]));
    expect(toastInfo).toHaveBeenCalledWith(i18n.t('common:accessLoss.ownerAssignedNew', { name: XENO }));
  });
});

describe('row 240 — a lost single project: the answer decides', () => {
  test('the open issue now answers «not found»: leaves for / with «project no longer available»', async () => {
    issueReadable = false;
    await mount('/projects/web/issues/web-1');
    deliver(frame(['projects']));
    await settle();
    expect(location).toBe('/');
    expect(toastInfo).toHaveBeenCalledWith(i18n.t('common:accessLoss.projectLost'));
  });

  test('the re-read fails otherwise (a 500): nothing is decided, the tab stays', async () => {
    issueFails = true;
    await mount('/projects/web/issues/web-1');
    deliver(frame(['projects']));
    await settle();
    expect(location).toBe('/projects/web/issues/web-1');
    expect(toastInfo).not.toHaveBeenCalled();
  });

  test('the open issue still answers: the tab stays', async () => {
    issueReadable = true;
    await mount('/projects/web/issues/web-1');
    deliver(frame(['projects']));
    await settle();
    expect(location).toBe('/projects/web/issues/web-1');
    expect(toastInfo).not.toHaveBeenCalled();
  });

  test('on the space place, a lost project closes the card but not the space page', async () => {
    issueReadable = false;
    await mount(`/spaces/${ACME}-acme/issues/web-1`);
    deliver(frame(['projects']));
    await settle();
    expect(location).toBe(`/spaces/${ACME}-acme`);
  });

  test('on the space place with no card open, a project signal leaves the page as it is', async () => {
    issueReadable = false;
    await mount(`/spaces/${ACME}-acme`);
    deliver(frame(['projects']));
    await settle();
    expect(location).toBe(`/spaces/${ACME}-acme`);
    expect(toastInfo).not.toHaveBeenCalled();
  });
});
