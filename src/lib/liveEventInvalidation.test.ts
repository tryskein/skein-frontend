/**
 * Reaction of a visible tab to project and user events — the rows of the
 * reaction matrix owned by T042 (spec sk-622.21 US-13, §"Frontend reaction
 * matrix"; plan K18 "Reaction matrix → cache keys"). Test-plan rows No. 71,
 * No. 72, No. 73, No. 74 (router part), No. 77.
 *
 * Method. A real `QueryClient` is seeded with one entry per cache key the
 * app reads (and the keys K18 says nobody reads), the envelope is routed,
 * and the test reads which entries came out `isInvalidated`. The expected
 * set of every row is a literal taken from the K18 table — not from the
 * router's output — and it is compared EXACTLY: a reaction wider than the
 * row (the old «reset the project» fan-out, the header counters on a
 * project event) and a narrower one (a key of the row missing) both fail.
 *
 * The envelope goes through the real classifier (`classifyEvent`), so the
 * compact fields the router reads (`changedFields`, `dep`, `issueId`,
 * `reparent`) are the wire shape; there is no `newData` anywhere.
 *
 * That the router is wired into the provider is proven by No. 75/No. 76 (the same
 * provider, `useLiveEvents.*.test.tsx`) and by e2e.
 */
import { InfiniteQueryObserver, QueryClient, QueryObserver } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { classifyEvent } from './eventClassify';
import type { EventEnvelope } from './eventEnvelope';
import { invalidateForEvent, type InvalidationContext } from './liveEventInvalidation';
import { createLiveInvalidationBatcher, LIVE_INVALIDATION_WINDOW_MS } from './liveInvalidationBatcher';
import { epicSectionClock, resetEpicSectionClockForTests } from './epicSectionClock';
import {
  resetTasksColumnTreeClockForTests,
  tasksColumnTreeClock,
} from './tasksColumnTreeClock';

// The provider block at the end mounts `LiveEventsProvider` on a fake hub.
const authUser = { id: '77777777-7777-7777-7777-777777777777', username: 'ann', role: 'user' as 'admin' | 'user' };
const hubHandlers = new Map<string, (payload: unknown) => void>();
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ user: authUser, logout: () => Promise.resolve() }),
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

const P = '11111111-2222-3333-4444-555555555555';
const Q = '22222222-3333-4444-5555-666666666666';
const ME = '77777777-7777-7777-7777-777777777777';
const OTHER_USER = '99999999-9999-9999-9999-999999999999';

// ───────────────────────────── the cache ─────────────────────────────

/** A tasks-list key in the shape of `useTasks.ts#cacheKey` (project surface). */
const projectList = (pid: string, lens: string, status: string, search = '') =>
  ['tasks', 'project', pid, lens, status, 'all', 'all', 'all', '', search, 'updated', ''];

const page = (...rows: Array<{ id: string; isBlocked?: boolean; parentIdCurrent?: string }>) => ({
  pages: [{ items: rows, hasMore: false }],
  pageParams: [undefined],
});
const tree = (...ids: string[]) => ({
  rows: ids.map((id) => ({ item: { id }, depth: 1, isReference: false })),
  requestedAt: 0,
});

/**
 * Every key a screen reads, plus the keys K18 says nobody reads. Issues:
 * `sk-1` (project P, child of `sk-0`), `sk-2` (P, blocked), `sk-3` (P,
 * blocked, in the «blocked» list), `sk-9` (P, unrelated), `q-1` and `q-7`
 * (project Q; `q-7` hangs under a row of P's tree), `q-5` (Q, an open card
 * whose links name `sk-1`).
 */
const KEYS = {
  // personal screens — moved by the personal signal only
  counts: { key: ['notification-counts'], data: {} },
  watching: { key: ['watching', 'feed', 'unread'], data: {} },
  mentions: { key: ['mentions', 'feed'], data: {} },
  inbox: { key: ['inbox', 'assigned-to-me-unaccepted-open'], data: [] },
  reminders: { key: ['reminders', 'list', 'all'], data: [] },
  // task lists
  tasksP: { key: projectList(P, 'all', 'active'), data: page({ id: 'sk-1', parentIdCurrent: 'sk-0' }, { id: 'sk-2', isBlocked: true }) },
  // the «blocked» list holds no row of the events below: only its filter can hit it
  tasksPBlocked: { key: projectList(P, 'all', 'blocked'), data: page() },
  // a plain list holding a blocked row only (a row a status change may unblock)
  tasksPBlockedRow: { key: projectList(P, 'all', 'all'), data: page({ id: 'sk-4', isBlocked: true }) },
  tasksPSearch: { key: projectList(P, 'all', 'active', 'needle'), data: page() },
  tasksPOutbox: { key: projectList(P, 'outbox', 'active'), data: page() },
  tasksQ: { key: projectList(Q, 'all', 'active'), data: page({ id: 'q-1' }) },
  tasksAll: { key: ['tasks', 'all', 'cross-project', 'active', 'all', 'all', 'all', '', 'updated', ''], data: page({ id: 'sk-1' }, { id: 'q-1' }) },
  tasksSearchAll: { key: ['tasks', 'search', 'all', 'active', 'all', 'all', 'all', '', 'needle', ''], data: page() },
  tasksSearchQ: { key: ['tasks', 'search', Q, 'active', 'all', 'all', 'all', '', 'needle', ''], data: page() },
  tasksSearchP: { key: ['tasks', 'search', P, 'active', 'all', 'all', 'all', '', 'needle', ''], data: page() },
  tasksMeOnMe: { key: ['tasks', 'me', 'on-me', 'active', 'all', 'all', 'all', '', 'updated'], data: page() },
  tasksMeUnreviewed: { key: ['tasks', 'me', 'created-by', 'unreviewed', 'all', 'all', 'all', '', 'updated'], data: page() },
  ancestors: { key: ['tasks', 'ancestors', 'sk-0'], data: [{ id: 'sk-0' }] },
  // an ancestor backfill of rows no event below touches
  ancestorsOther: { key: ['tasks', 'ancestors', 'sk-77'], data: [{ id: 'sk-77' }] },
  // trees
  treeP: { key: ['issues', 'tree', P, '__forest__', 'parent-child', '__full__', '__no_blockers__'], data: tree('sk-0', 'sk-1', 'q-7') },
  treeQ: { key: ['issues', 'tree', Q, '__forest__', 'parent-child', '__full__', '__no_blockers__'], data: tree('q-1') },
  section: { key: ['issues', 'tree', '__cross__', 'sk-0', 'parent-child', '__full__', '__blockers__'], data: tree('sk-1') },
  // the section of another epic, showing none of the issues below
  sectionOther: { key: ['issues', 'tree', '__cross__', 'sk-99', 'parent-child', '__full__', '__blockers__'], data: tree('sk-98') },
  // the open cards and their parts
  detail1: { key: ['issues', 'detail', 'sk-1'], data: { id: 'sk-1', parentIdCurrent: 'sk-0' } },
  detail0: { key: ['issues', 'detail', 'sk-0'], data: { id: 'sk-0' } },
  detail9: { key: ['issues', 'detail', 'sk-9'], data: { id: 'sk-9' } },
  detailLinker: { key: ['issues', 'detail', 'q-5'], data: { id: 'q-5' } },
  depsLinker: {
    key: ['deps', Q, 'q-5'],
    data: { outgoing: [{ fromId: 'q-5', toId: 'sk-1', type: 'related', issue: { id: 'sk-1' } }], incoming: [] },
  },
  deps1: { key: ['deps', P, 'sk-1'], data: { outgoing: [], incoming: [] } },
  deps9: { key: ['deps', P, 'sk-9'], data: { outgoing: [], incoming: [] } },
  comments1: { key: ['issues', 'comments', 'sk-1'], data: [] },
  attachments1: { key: ['issues', 'sk-1', 'attachments'], data: {} },
  watchers1: { key: ['watchers', 'issue', 'sk-1'], data: [] },
  activity1: { key: ['activity', 'issue', P, 'sk-1'], data: {} },
  activityProjectP: { key: ['activity', 'project', P], data: {} },
  // projects column, components, members
  projectsLookup: { key: ['projects', 'list', 'shell'], data: {} },
  projectsInfinite: { key: ['projects', 'list', 'shell', 'infinite', '', 'all'], data: page() },
  projectsInfiniteLens: { key: ['projects', 'list', 'shell', 'infinite', '', 'on-me'], data: page() },
  componentsP: { key: ['components', 'list', P, 'all'], data: [] },
  componentsPLens: { key: ['components', 'list', P, 'on-me'], data: [] },
  componentsQ: { key: ['components', 'list', Q, 'all'], data: [] },
  componentNamesP: { key: ['component-names', P], data: [] },
  membersP: { key: ['members', 'list', P], data: [] },
  membersQ: { key: ['members', 'list', Q], data: [] },
  resolveP: { key: ['project', 'resolve', 'pp'], data: { match: { id: P } } },
  resolveQ: { key: ['project', 'resolve', 'qq'], data: { match: { id: Q } } },
  projectDetailP: { key: ['project', 'detail', P], data: {} },
  projectDetailQ: { key: ['project', 'detail', Q], data: {} },
  // users, /me, /activity
  usersAdmin: { key: ['users-admin', 'active', false], data: [] },
  me: { key: ['auth', 'me'], data: { id: ME } },
  inProgress: { key: ['dashboard', 'in-progress', null], data: [] },
  // K18 "No longer reset (nobody reads them)"
  ready: { key: ['ready', P], data: [] },
  projectLabels: { key: ['issues', 'project-labels', P], data: [] },
  projectsMembers: { key: ['projects', 'members', P], data: [] },
  projectsComponents: { key: ['projects', 'components', P, false], data: [] },
  projectsDetail: { key: ['projects', 'detail', P], data: {} },
  notificationsCount: { key: ['notifications', 'count', null], data: 0 },
  notificationsList: { key: ['notifications', 'list', 'unread'], data: [] },
  issuesList: { key: ['issues', 'list', P, {}], data: [] },
} as const;
type KeyName = keyof typeof KEYS;

const NEVER_RESET: KeyName[] = [
  'ready',
  'projectLabels',
  'projectsMembers',
  'projectsComponents',
  'projectsDetail',
  'notificationsCount',
  'notificationsList',
  'issuesList',
];

/**
 * Entries mounted by a screen: the open card in project Q and its links,
 * and the open card of `sk-1`. `invalidateOpenCardsLinkingTo` looks only at
 * mounted entries, so these carry an observer; the read never resolves and
 * the seeded data stays.
 */
const MOUNTED: KeyName[] = ['depsLinker', 'detailLinker', 'deps1', 'detail1'];

let qc: QueryClient;
let unsubscribers: Array<() => void>;

function seed(): void {
  for (const name of Object.keys(KEYS) as KeyName[]) {
    qc.setQueryData(KEYS[name].key, KEYS[name].data);
  }
  for (const name of MOUNTED) {
    const observer = new QueryObserver(qc, {
      queryKey: KEYS[name].key,
      queryFn: () => new Promise(() => {}),
      staleTime: Infinity,
    });
    unsubscribers.push(observer.subscribe(() => {}));
  }
}

function invalidated(): KeyName[] {
  return (Object.keys(KEYS) as KeyName[])
    .filter((name) => qc.getQueryState(KEYS[name].key)?.isInvalidated === true)
    .sort();
}

const EXPANDED_P: InvalidationContext = {
  isAdmin: false,
  currentUserId: ME,
  expandedProjectIds: new Set([P]),
};
const FOLDED: InvalidationContext = { isAdmin: false, currentUserId: ME };

let nextId = 1;
function envelope(fields: Partial<EventEnvelope> & Pick<EventEnvelope, 'eventType' | 'entityType' | 'entityId'>): EventEnvelope {
  return {
    id: nextId++,
    occurredAt: '2026-10-09T10:00:00Z',
    projectId: P,
    ...fields,
  } as EventEnvelope;
}

function route(env: EventEnvelope, ctx: InvalidationContext = EXPANDED_P): void {
  invalidateForEvent(qc, classifyEvent(env), env, ctx);
}

const issueEnv = (action: string, extra: Partial<EventEnvelope> = {}, id = 'sk-1', pid = P) =>
  envelope({ eventType: `issue.${action}`, entityType: 'issue', entityId: id, projectId: pid, ...extra });

const depEnv = (action: 'created' | 'deleted', type: string, fromId?: string, toId?: string, pid = P) =>
  envelope({
    eventType: `dependency.${action}`,
    entityType: 'dep',
    entityId: `${fromId ?? ''}::${toId ?? ''}::${type}`,
    projectId: pid,
    dep: { type, ...(fromId ? { fromId } : {}), ...(toId ? { toId } : {}) },
  });

const sorted = (names: KeyName[]) => [...names].sort();

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  unsubscribers = [];
  nextId = 1;
  resetEpicSectionClockForTests();
  resetTasksColumnTreeClockForTests();
  seed();
});

afterEach(() => {
  unsubscribers.forEach((u) => u());
  qc.clear();
  vi.restoreAllMocks();
});

// ───────────────────────── No. 71: issue rows ───────────────────────────

describe('No. 71 — issue events re-read exactly their K18 row', () => {
  // A child is created as `<parent>.N`: `sk-0.5` lands in the section of
  // its parent `sk-0`; the section of another epic is not touched (K18).
  test('"Issue created": first page of the project lists, trees, the parent\'s section, expanded counters, deps of P, project activity', () => {
    route(issueEnv('created', {}, 'sk-0.5'));
    expect(invalidated()).toEqual(sorted([
      'tasksP', 'tasksPBlocked', 'tasksPBlockedRow', 'tasksPSearch', 'tasksPOutbox', 'tasksAll', 'tasksSearchAll', 'tasksSearchP',
      'treeP', 'section',
      'componentsP', 'componentsPLens', 'projectsInfinite', 'projectsInfiniteLens',
      'deps1', 'deps9',
      'activityProjectP',
    ]));
  });

  test('"Issue created" with the project row folded: no project / component counters', () => {
    route(issueEnv('created', {}, 'sk-0.5'), FOLDED);
    expect(invalidated()).toEqual(sorted([
      'tasksP', 'tasksPBlocked', 'tasksPBlockedRow', 'tasksPSearch', 'tasksPOutbox', 'tasksAll', 'tasksSearchAll', 'tasksSearchP',
      'treeP', 'section',
      'deps1', 'deps9',
      'activityProjectP',
    ]));
  });

  test('"Row fields" (title): the card, the rows showing it, open cards linking to it, its activity', () => {
    route(issueEnv('updated', { changedFields: ['title'] }));
    expect(invalidated()).toEqual(sorted([
      'detail1', 'tasksP', 'tasksAll', 'treeP', 'section',
      'detailLinker', 'depsLinker',
      'activity1',
    ]));
  });

  test.each([
    ['label_added'],
    ['label_removed'],
    ['pinned'],
    ['unpinned'],
  ])('"Row fields" as its own event (issue.%s) — same keys', (action) => {
    route(issueEnv(action));
    expect(invalidated()).toEqual(sorted([
      'detail1', 'tasksP', 'tasksAll', 'treeP', 'section',
      'detailLinker', 'depsLinker',
      'activity1',
    ]));
  });

  test('"Row fields" components: + the project\'s component lists', () => {
    route(issueEnv('components_changed'));
    expect(invalidated()).toEqual(sorted([
      'detail1', 'tasksP', 'tasksAll', 'treeP', 'section',
      'detailLinker', 'depsLinker',
      'activity1',
      'componentsP', 'componentsPLens',
    ]));
  });

  test('"Assignee": the card, the rows, the activity, the lens counters of the expanded row', () => {
    route(issueEnv('updated', { changedFields: ['assignee'] }));
    expect(invalidated()).toEqual(sorted([
      'detail1', 'tasksP', 'tasksAll', 'treeP', 'section', 'activity1',
      'projectsInfiniteLens', 'componentsPLens',
    ]));
  });

  test.each([['dueAt'], ['estimatedMinutes']])('"Dates, estimate" (%s): the card, the rows, the activity', (field) => {
    route(issueEnv('updated', { changedFields: [field] }));
    expect(invalidated()).toEqual(sorted(['detail1', 'tasksP', 'tasksAll', 'treeP', 'section', 'activity1']));
  });

  test.each([['description'], ['design'], ['acceptanceCriteria'], ['notes']])(
    '"Text fields" (%s): the card, the activity, only the lists with a text search',
    (field) => {
      route(issueEnv('updated', { changedFields: [field] }));
      expect(invalidated()).toEqual(sorted(['detail1', 'activity1', 'tasksPSearch', 'tasksSearchAll', 'tasksSearchQ', 'tasksSearchP']));
    },
  );

  const STATUS_ROW: KeyName[] = [
    // the card and the ancestor's card (children counters, progress)
    'detail1', 'detail0',
    // rows: the issue, its ancestor (progress), the loaded blocked rows;
    // the list filtered by blocked-ness (first page)
    'tasksP', 'tasksAll', 'ancestors', 'tasksPBlockedRow', 'tasksPBlocked',
    // trees: the project's column tree and the sections of the ancestors —
    // `section` (epic sk-0) shows sk-1; `sectionOther` (epic sk-99) does not
    'treeP', 'section',
    // open cards of any project that link to the issue
    'detailLinker', 'depsLinker',
    // counters of the expanded row
    'projectsInfinite', 'projectsInfiniteLens', 'componentsP', 'componentsPLens',
    'activity1',
    // NOT Inbox (R22): the personal signal `inbox` and the safety net
  ];

  test.each([['status_changed'], ['closed'], ['claimed'], ['unclaimed']])(
    '"Status" (issue.%s): only the keys of the row + «in progress» of /activity',
    (action) => {
      route(issueEnv(action));
      expect(invalidated()).toEqual(sorted([...STATUS_ROW, 'inProgress']));
    },
  );

  test.each([['reopened'], ['outcome_changed']])('"Status" (issue.%s): the row, no «in progress»', (action) => {
    route(issueEnv(action));
    expect(invalidated()).toEqual(sorted(STATUS_ROW));
  });

  test('«accept»: the whole row, Inbox not re-read — the personal signal `inbox` does that (R22)', () => {
    route(issueEnv('accepted'));
    expect(invalidated()).toEqual(sorted([...STATUS_ROW, 'inProgress']));
  });

  test('an edit event without field names takes every edit row', () => {
    route(issueEnv('updated'));
    expect(invalidated()).toEqual(sorted([
      'detail1', 'tasksP', 'tasksAll', 'treeP', 'section',
      'detailLinker', 'depsLinker', 'activity1',
      'projectsInfiniteLens', 'componentsPLens',
      'tasksPSearch', 'tasksSearchAll', 'tasksSearchQ', 'tasksSearchP',
    ]));
  });

  test('a mention of an issue is a notification, not a change: nothing', () => {
    route(issueEnv('mention'));
    route(envelope({ eventType: 'comment.mention', entityType: 'comment', entityId: 'c-1', issueId: 'sk-1' }));
    expect(invalidated()).toEqual([]);
  });

  test('header counters, Watching, Mentions and Inbox are never re-read by an event', () => {
    const events = [
      issueEnv('created', {}, 'sk-50'),
      issueEnv('updated', { changedFields: ['title', 'assignee', 'description'] }),
      issueEnv('status_changed'),
      issueEnv('closed'),
      issueEnv('claimed'),
      issueEnv('accepted'),
      issueEnv('reopened'),
      issueEnv('unclaimed'),
      issueEnv('outcome_changed'),
      issueEnv('archived'),
      issueEnv('reparented', { reparent: { oldParentIds: [], newParentId: 'sk-0' } }),
      depEnv('created', 'blocks', 'sk-1', 'sk-9'),
      depEnv('deleted', 'parent-child', 'sk-1', 'sk-0'),
      envelope({ eventType: 'comment.created', entityType: 'comment', entityId: 'c-1', issueId: 'sk-1' }),
      envelope({ eventType: 'project.member_added', entityType: 'project', entityId: P }),
    ];
    for (const env of events) route(env);
    const touched = invalidated();
    expect(touched).not.toContain('counts');
    expect(touched).not.toContain('watching');
    expect(touched).not.toContain('mentions');
    expect(touched).not.toContain('inbox');
  });
});

// ──────────── No. 72: reparent, links, comments, attachments … ──────────

describe('No. 72 — link, comment, attachment, commit and delegation rows', () => {
  test('"Move": the issue, the new parent, trees, sections, rows and ancestor backfills', () => {
    route(issueEnv('reparented', { reparent: { oldParentIds: [], newParentId: 'sk-0' } }));
    expect(invalidated()).toEqual(sorted([
      'detail1', 'detail0', 'treeP', 'section', 'tasksP', 'tasksAll', 'ancestors', 'ancestorsOther',
    ]));
  });

  test.each([['created'], ['deleted']] as const)('"Parent-child link" (%s): trees, both ends, deps of the ends', (action) => {
    route(depEnv(action, 'parent-child', 'sk-1', 'sk-0'));
    expect(invalidated()).toEqual(sorted([
      'deps1', 'detail1', 'detail0', 'treeP', 'section', 'tasksP', 'tasksAll', 'ancestors', 'ancestorsOther',
    ]));
  });

  test.each([['blocks'], ['waits-for']])('"Blocking link" (%s): ends, rows, blockers, blocked lists, counters', (type) => {
    route(depEnv('created', type, 'sk-1', 'sk-9'));
    expect(invalidated()).toEqual(sorted([
      'deps1', 'deps9', 'detail1', 'detail9',
      'treeP', 'section', 'tasksP', 'tasksAll',
      'tasksPBlocked',
      'projectsInfinite', 'projectsInfiniteLens', 'componentsP', 'componentsPLens',
    ]));
  });

  test.each([['related'], ['discovered-from'], ['supersedes'], ['duplicates']])(
    '"Other links" (%s): only the dependency lists of the ends',
    (type) => {
      route(depEnv('created', type, 'sk-1', 'sk-9'));
      expect(invalidated()).toEqual(sorted(['deps1', 'deps9']));
    },
  );

  test('an end in another project is absent from `dep` and is not guessed', () => {
    // sk-1 blocks an issue of another project: skein-web drops that end
    // (R8 / K15); only sk-1 is touched.
    route(depEnv('created', 'blocks', 'sk-1', undefined));
    expect(invalidated()).toEqual(sorted([
      'deps1', 'detail1', 'treeP', 'section', 'tasksP', 'tasksAll', 'tasksPBlocked',
      'projectsInfinite', 'projectsInfiniteLens', 'componentsP', 'componentsPLens',
    ]));
  });

  test('the router reads the ends from `dep` only — an old-shaped `newData` is ignored', () => {
    const env = {
      ...depEnv('created', 'related'),
      newData: { type: 'related', fromId: 'sk-1', toId: 'sk-9' },
    } as unknown as EventEnvelope;
    route(env);
    expect(invalidated()).toEqual([]);
  });

  test.each([['comment.created'], ['comment.edited'], ['comment.deleted']])(
    '"Comment" (%s): comments, the card (its counter), the activity',
    (eventType) => {
      route(envelope({ eventType, entityType: 'comment', entityId: 'c-1', issueId: 'sk-1' }));
      expect(invalidated()).toEqual(sorted(['comments1', 'detail1', 'activity1']));
    },
  );

  test('a comment without `issueId` touches nothing but the console', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    route(envelope({ eventType: 'comment.created', entityType: 'comment', entityId: 'c-1' }));
    expect(invalidated()).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test.each([['attachment.added'], ['attachment.removed']])('"Attachment" (%s): attachments and activity', (eventType) => {
    route(envelope({ eventType, entityType: 'attachment', entityId: 'a-1', issueId: 'sk-1' }));
    expect(invalidated()).toEqual(sorted(['attachments1', 'activity1']));
  });

  test('an attachment without `issueId` touches nothing but the console', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    route(envelope({ eventType: 'attachment.removed', entityType: 'attachment', entityId: 'a-1' }));
    expect(invalidated()).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test.each([['commits_attached'], ['commits_detached']])('"Commits" (issue.%s): the card only', (action) => {
    route(issueEnv(action, { commitHashes: ['abc1234'] }));
    expect(invalidated()).toEqual(['detail1']);
  });

  test.each([['delegation_dropped'], ['delegation_resumed']])('"Delegation" (issue.%s): the card\'s watchers only', (action) => {
    route(issueEnv(action));
    expect(invalidated()).toEqual(['watchers1']);
  });
});

// ───────────── No. 73: other project, components, projects ──────────────

describe('No. 73 — another project\'s issue in an open tree, components, projects', () => {
  test('"Issue from another project in an open tree": the event of its project re-reads the tree showing it', () => {
    // q-7 (project Q) is shown under a row of P's column tree.
    route(issueEnv('updated', { changedFields: ['title'] }, 'q-7', Q));
    expect(invalidated()).toEqual(['treeP']);
  });

  test.each([['component.created'], ['component.updated'], ['component.archived']])(
    '"Component" (%s): component lists and names of P, the projects list while P is expanded; no tasks',
    (eventType) => {
      route(envelope({ eventType, entityType: 'component', entityId: 'cmp-1' }));
      expect(invalidated()).toEqual(sorted([
        'componentsP', 'componentsPLens', 'componentNamesP', 'projectsInfinite', 'projectsInfiniteLens',
      ]));
    },
  );

  test('"Component" with the row folded: no projects list', () => {
    route(envelope({ eventType: 'component.created', entityType: 'component', entityId: 'cmp-1' }), FOLDED);
    expect(invalidated()).toEqual(sorted(['componentsP', 'componentsPLens', 'componentNamesP']));
  });

  test.each([
    ['project.updated'],
    ['project.archived'],
    ['project.member_added'],
    ['project.member_removed'],
    ['project.member_role_changed'],
  ])('"Project/members" (%s): projects lists, members of P, resolutions of P, the open project card; no tasks', (eventType) => {
    route(envelope({ eventType, entityType: 'project', entityId: P }));
    expect(invalidated()).toEqual(sorted([
      'projectsLookup', 'projectsInfinite', 'projectsInfiniteLens',
      'membersP', 'resolveP', 'projectDetailP',
    ]));
  });
});

// ─────────────────── No. 74: /activity and users ────────────────────────

describe('No. 74 — /activity «in progress» and user events', () => {
  test('"in progress" moves on claim / unclaim / status / accept / close — and on no other issue event', () => {
    for (const action of ['claimed', 'unclaimed', 'status_changed', 'accepted', 'closed']) {
      qc.clear();
      seed();
      route(issueEnv(action));
      expect(invalidated(), action).toContain('inProgress');
    }
    for (const action of ['created', 'updated', 'reparented', 'reopened', 'outcome_changed', 'label_added']) {
      qc.clear();
      seed();
      route(issueEnv(action, { changedFields: ['title'] }));
      expect(invalidated(), action).not.toContain('inProgress');
    }
  });

  const userEnv = (action: string, userId: string) =>
    envelope({ eventType: `user.${action}`, entityType: 'user', entityId: userId, projectId: null });

  test('an admin re-reads the users list on any user event; /me only when it is about them', () => {
    route(userEnv('updated', OTHER_USER), { isAdmin: true, currentUserId: ME });
    expect(invalidated()).toEqual(['usersAdmin']);

    qc.clear();
    seed();
    route(userEnv('updated', ME), { isAdmin: true, currentUserId: ME });
    expect(invalidated()).toEqual(sorted(['usersAdmin', 'me']));
  });

  test('a non-admin: /me about themselves, nothing about others', () => {
    route(userEnv('updated', OTHER_USER), FOLDED);
    expect(invalidated()).toEqual([]);
    route(userEnv('updated', ME), FOLDED);
    expect(invalidated()).toEqual(['me']);
  });
});

// ──────────────────── No. 77: keys nobody reads ─────────────────────────

describe('No. 77 — keys no screen reads are never reset', () => {
  test('no event of any kind resets them', () => {
    const events: Array<[EventEnvelope, InvalidationContext]> = [
      [issueEnv('created', {}, 'sk-50'), EXPANDED_P],
      [issueEnv('updated', { changedFields: ['title', 'assignee', 'description', 'dueAt'] }), EXPANDED_P],
      [issueEnv('updated'), EXPANDED_P],
      ...['status_changed', 'closed', 'reopened', 'outcome_changed', 'claimed', 'unclaimed', 'accepted',
        'label_added', 'label_removed', 'components_changed', 'pinned', 'commits_attached',
        'delegation_dropped', 'archived'].map((a) => [issueEnv(a), EXPANDED_P] as [EventEnvelope, InvalidationContext]),
      [issueEnv('reparented', { reparent: { oldParentIds: [], newParentId: 'sk-0' } }), EXPANDED_P],
      ...['parent-child', 'blocks', 'waits-for', 'related'].map(
        (t) => [depEnv('created', t, 'sk-1', 'sk-9'), EXPANDED_P] as [EventEnvelope, InvalidationContext],
      ),
      [envelope({ eventType: 'comment.created', entityType: 'comment', entityId: 'c-1', issueId: 'sk-1' }), EXPANDED_P],
      [envelope({ eventType: 'attachment.added', entityType: 'attachment', entityId: 'a-1', issueId: 'sk-1' }), EXPANDED_P],
      [envelope({ eventType: 'component.created', entityType: 'component', entityId: 'cmp-1' }), EXPANDED_P],
      [envelope({ eventType: 'project.member_added', entityType: 'project', entityId: P }), EXPANDED_P],
      [envelope({ eventType: 'user.updated', entityType: 'user', entityId: ME, projectId: null }), { isAdmin: true, currentUserId: ME }],
    ];
    // Positive control: the run does reset something.
    for (const [env, ctx] of events) route(env, ctx);
    const touched = invalidated();
    expect(touched.length).toBeGreaterThan(0);
    for (const name of NEVER_RESET) expect(touched, name).not.toContain(name);
  });
});

// ─────────────── K21: lists re-read from the first page ──────────────

describe('K21 — a list K18 re-reads «first page» is re-read with one page through the batcher', () => {
  test('a new issue: the infinite list of P drops its later pages and fetches only the first', async () => {
    vi.useFakeTimers();
    try {
      const listQc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const fetched: unknown[] = [];
      const key = KEYS.tasksP.key;
      // Two loaded pages, mounted list.
      listQc.setQueryData(key, {
        pages: [{ items: [{ id: 'sk-1' }], hasMore: true, nextCursor: 'c2' }, { items: [{ id: 'sk-2' }], hasMore: false }],
        pageParams: [undefined, 'c2'],
      });
      const infinite = new InfiniteQueryObserver(listQc, {
        queryKey: key,
        initialPageParam: undefined as string | undefined,
        getNextPageParam: (last: { hasMore: boolean; nextCursor?: string }) =>
          last.hasMore ? last.nextCursor : undefined,
        queryFn: ({ pageParam }: { pageParam: unknown }) => {
          fetched.push(pageParam);
          return Promise.resolve({ items: [{ id: 'sk-1' }, { id: 'sk-50' }], hasMore: true, nextCursor: 'c2' });
        },
        staleTime: Infinity,
      });
      const unsub = infinite.subscribe(() => {});
      const batcher = createLiveInvalidationBatcher(listQc);
      const env = issueEnv('created', {}, 'sk-50');
      invalidateForEvent(batcher, classifyEvent(env), env, FOLDED);
      await vi.advanceTimersByTimeAsync(LIVE_INVALIDATION_WINDOW_MS);

      // One request, for the first page only (no cursor).
      expect(fetched).toEqual([undefined]);
      const data = listQc.getQueryData<{ pages: unknown[]; pageParams: unknown[] }>(KEYS.tasksP.key);
      expect(data?.pageParams).toEqual([undefined]);
      expect(data?.pages).toHaveLength(1);
      unsub();
      batcher.dispose();
      listQc.clear();
    } finally {
      vi.useRealTimers();
    }
  });
});

// ─────────── epic section and column trees (sk-421.2, sk-427) ────────

describe('sk-421.2 / sk-427 — trees: options and clocks', () => {
  test('F-21 — every variant of the section key is marked (depth and sentinel)', async () => {
    const { layeredTreeQueryKey } = await import('./useLayeredTree');
    const capped = layeredTreeQueryKey(null, 'sk-0', ['parent-child'], 1, true);
    const full = layeredTreeQueryKey(null, 'sk-0', ['parent-child'], undefined, true);
    const plain = layeredTreeQueryKey(null, 'sk-0', ['parent-child'], 1);
    for (const k of [capped, full, plain]) qc.setQueryData(k, tree('sk-9'));
    route(issueEnv('closed', {}, 'sk-9'));
    for (const k of [capped, full, plain]) {
      expect(qc.getQueryState(k)?.isInvalidated, JSON.stringify(k)).toBe(true);
    }
  });

  test('F-23 — trees re-read only mounted entries and a burst does not cancel a running walk', () => {
    const calls: Array<{ filters: unknown; options: unknown }> = [];
    const target = {
      invalidateQueries: (filters?: unknown, options?: unknown) => {
        calls.push({ filters, options });
        return Promise.resolve();
      },
      getQueryCache: () => qc.getQueryCache(),
    };
    const env = issueEnv('closed');
    invalidateForEvent(target as never, classifyEvent(env), env, FOLDED);
    const treeQuery = qc.getQueryCache().find({ queryKey: KEYS.section.key, exact: true })!;
    const treeCalls = calls.filter((c) => {
      const pred = (c.filters as { predicate?: (q: unknown) => boolean } | undefined)?.predicate;
      return typeof pred === 'function' && pred(treeQuery);
    });
    expect(treeCalls.length).toBeGreaterThan(0);
    for (const c of treeCalls) {
      expect((c.filters as { refetchType?: string }).refetchType).toBe('active');
      expect(c.options).toEqual({ cancelRefetch: false });
    }
  });

  test('SC-015 — the section clock moves on an event that hits a MOUNTED section, not on one of another epic', () => {
    const observer = new QueryObserver(qc, {
      queryKey: KEYS.section.key,
      queryFn: () => new Promise(() => {}),
      staleTime: Infinity,
    });
    const unsub = observer.subscribe(() => {});
    // q-9 is in no section: the mounted section is not hit, no catch-up read.
    route(issueEnv('closed', {}, 'q-9', Q));
    expect(epicSectionClock()).toBe(0);
    route(issueEnv('closed'));
    expect(epicSectionClock()).toBeGreaterThan(0);
    unsub();
  });

  test('sk-429 — the column-tree clock moves only when a MOUNTED tree is hit', () => {
    route(issueEnv('closed', {}, 'q-1', Q));
    // treeQ is hit, but nothing mounts it.
    expect(tasksColumnTreeClock()).toBe(0);
    const observer = new QueryObserver(qc, {
      queryKey: KEYS.treeQ.key,
      queryFn: () => new Promise(() => {}),
      staleTime: Infinity,
    });
    const unsub = observer.subscribe(() => {});
    route(issueEnv('closed', {}, 'q-1', Q));
    expect(tasksColumnTreeClock()).toBeGreaterThan(0);
    unsub();
  });

  test('a section still on its first read cannot tell what it shows: it is hit, the clock moves', () => {
    const pendingKey = ['issues', 'tree', '__cross__', 'sk-70', 'parent-child', '__full__', '__blockers__'];
    const observer = new QueryObserver(qc, { queryKey: pendingKey, queryFn: () => new Promise(() => {}) });
    const unsub = observer.subscribe(() => {});
    route(issueEnv('closed', {}, 'q-9', Q));
    expect(qc.getQueryState(pendingKey)?.isInvalidated).toBe(true);
    expect(epicSectionClock()).toBeGreaterThan(0);
    // The answered sections showing nothing of the event are not.
    expect(invalidated()).not.toContain('section');
    expect(invalidated()).not.toContain('sectionOther');
    unsub();
  });

  /** Which trees an event marks — table of sk-427 item 4 under K18. */
  const TREES: KeyName[] = ['treeP', 'treeQ', 'section', 'sectionOther'];
  const treesMarked = () => invalidated().filter((n) => TREES.includes(n));

  test.each<[string, () => EventEnvelope, KeyName[]]>([
    ['issue.updated sk-1 (P, shown in treeP and the section)', () => issueEnv('updated', { changedFields: ['title'] }), ['section', 'treeP']],
    ['issue.created sk-50 (P, a new root: in no section)', () => issueEnv('created', {}, 'sk-50'), ['treeP']],
    // A root's id is no child id: `sk-990` is not a child of `sk-99`.
    ['issue.created sk-990 (P, a new root whose id begins with a section root\'s)', () => issueEnv('created', {}, 'sk-990'), ['treeP']],
    // A custom-mode root may carry a dot in its suffix: not a child id.
    ['issue.created sk-99.rc (P, a custom root with a dot: in no section)', () => issueEnv('created', {}, 'sk-99.rc'), ['treeP']],
    ['issue.created sk-99.1rc (P, a custom root: the suffix is not a number)', () => issueEnv('created', {}, 'sk-99.1rc'), ['treeP']],
    ['issue.created sk-0.12 (P, child of the root of `section`, a two-digit N)', () => issueEnv('created', {}, 'sk-0.12'), ['section', 'treeP']],
    ['issue.created sk-0.5 (P, child of the root of `section`)', () => issueEnv('created', {}, 'sk-0.5'), ['section', 'treeP']],
    ['issue.created sk-98.1 (P, child of a row of `sectionOther`)', () => issueEnv('created', {}, 'sk-98.1'), ['sectionOther', 'treeP']],
    ['issue.updated q-7 (Q, shown in treeP only)', () => issueEnv('updated', { changedFields: ['title'] }, 'q-7', Q), ['treeP']],
    ['issue.updated q-9 (Q, shown nowhere)', () => issueEnv('updated', { changedFields: ['title'] }, 'q-9', Q), []],
    ['issue.closed q-9 (Q): Q\'s tree; no section shows it', () => issueEnv('closed', {}, 'q-9', Q), ['treeQ']],
    ['issue.closed sk-98 (P): the section showing it only', () => issueEnv('closed', {}, 'sk-98'), ['sectionOther', 'treeP']],
    ['dep related sk-1 → sk-9: no tree', () => depEnv('created', 'related', 'sk-1', 'sk-9'), []],
    ['dep parent-child q-8 → q-1 (Q): no section shows either end', () => depEnv('created', 'parent-child', 'q-8', 'q-1', Q), ['treeQ']],
    ['dep parent-child q-8 → sk-99 (P): the section rooted at the parent', () => depEnv('created', 'parent-child', 'q-8', 'sk-99'), ['sectionOther', 'treeP']],
    ['issue.reparented q-8 → sk-99 (P): the new parent\'s section', () => issueEnv('reparented', { reparent: { oldParentIds: [], newParentId: 'sk-99' } }, 'q-8'), ['sectionOther', 'treeP']],
    ['dep blocks sk-98 → q-1 (P): the section and the trees showing an end', () => depEnv('created', 'blocks', 'sk-98', 'q-1'), ['sectionOther', 'treeP', 'treeQ']],
  ])('%s', (_name, make, expected) => {
    route(make(), FOLDED);
    expect(treesMarked()).toEqual(sorted(expected));
  });
});

// ─────────────── edit fields, actions and fields not named above ───────────────

describe('No. 71 — every edit field and action lands in its row', () => {
  test.each([['deferUntil']])('"Dates" (%s): the card, the rows, the activity', (field) => {
    route(issueEnv('updated', { changedFields: [field] }));
    expect(invalidated()).toEqual(sorted(['detail1', 'tasksP', 'tasksAll', 'treeP', 'section', 'activity1']));
  });

  test('"Text fields" (externalRef): the card, the activity, the searched lists', () => {
    route(issueEnv('updated', { changedFields: ['externalRef'] }));
    expect(invalidated()).toEqual(sorted(['detail1', 'activity1', 'tasksPSearch', 'tasksSearchAll', 'tasksSearchQ', 'tasksSearchP']));
  });

  test('a field name the router does not know is a row field', () => {
    route(issueEnv('updated', { changedFields: ['someFutureField'] }));
    expect(invalidated()).toEqual(sorted([
      'detail1', 'tasksP', 'tasksAll', 'treeP', 'section', 'detailLinker', 'depsLinker', 'activity1',
    ]));
  });

  test('issue.assigned is the assignee row', () => {
    route(issueEnv('assigned'));
    expect(invalidated()).toEqual(sorted([
      'detail1', 'tasksP', 'tasksAll', 'treeP', 'section', 'activity1',
      'projectsInfiniteLens', 'componentsPLens',
    ]));
  });

  test('an issue action the router does not know re-reads the card and the rows, not the edit fan-out', () => {
    route(issueEnv('made_up'));
    expect(invalidated()).toEqual(sorted([
      'detail1', 'tasksP', 'tasksAll', 'treeP', 'section', 'detailLinker', 'depsLinker', 'activity1',
    ]));
  });

  test.each([['archived'], ['teleported']])('issue.%s rides the "Status" row', (action) => {
    route(issueEnv(action));
    expect(invalidated()).toContain('tasksPBlocked');
    expect(invalidated()).toContain('section');
    expect(invalidated()).not.toContain('sectionOther');
    expect(invalidated()).not.toContain('inbox');
    expect(invalidated()).not.toContain('inProgress');
  });

  test('`dependency` is the same entity as `dep`', () => {
    route({ ...depEnv('created', 'related', 'sk-1', 'sk-9'), entityType: 'dependency' });
    expect(invalidated()).toEqual(sorted(['deps1', 'deps9']));
  });

  test.each([['comment.created', 'comment'], ['attachment.added', 'attachment']])(
    '%s with an empty `issueId` is a missing one',
    (eventType, entityType) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      route(envelope({ eventType, entityType, entityId: 'x-1', issueId: '' }));
      expect(invalidated()).toEqual([]);
      expect(warn).toHaveBeenCalledTimes(1);
    },
  );
});

// ─────────────── what the cache knows: open cards and ancestors ───────────────

describe('open cards linking to an issue and the ancestors the cache knows', () => {
  function fresh(): void {
    unsubscribers.forEach((u) => u());
    unsubscribers = [];
    qc.clear();
  }
  function seedEntry(key: readonly unknown[], data: unknown, mounted: boolean): void {
    qc.setQueryData(key, data);
    if (!mounted) return;
    const observer = new QueryObserver(qc, { queryKey: key, queryFn: () => new Promise(() => {}), staleTime: Infinity });
    unsubscribers.push(observer.subscribe(() => {}));
  }
  const isInvalidated = (key: readonly unknown[]) => qc.getQueryState(key)?.isInvalidated === true;
  const CARD = ['issues', 'detail', 'q-5'];
  const CARD_DEPS = ['deps', Q, 'q-5'];

  test.each<[string, unknown, boolean]>([
    ['an outgoing edge to it (toId)', { outgoing: [{ fromId: 'q-5', toId: 'sk-1' }], incoming: [] }, true],
    ['an incoming edge from it (fromId)', { outgoing: [], incoming: [{ fromId: 'sk-1', toId: 'q-5' }] }, true],
    ['its id on the far side only (issue.id)', { outgoing: [{ issue: { id: 'sk-1' } }], incoming: [] }, true],
    ['no edge naming it', { outgoing: [{ fromId: 'q-5', toId: 'sk-9', issue: { id: 'sk-9' } }], incoming: [] }, false],
    ['a malformed list', { outgoing: 'x', incoming: [null, 5] }, false],
  ])('a mounted card whose links have %s', (_name, deps, expected) => {
    fresh();
    seedEntry(CARD, { id: 'q-5' }, true);
    seedEntry(CARD_DEPS, deps, true);
    route(issueEnv('updated', { changedFields: ['title'] }));
    expect(isInvalidated(CARD)).toBe(expected);
    expect(isInvalidated(CARD_DEPS)).toBe(expected);
  });

  test('an UNMOUNTED card linking to it is not looked at', () => {
    fresh();
    seedEntry(CARD, { id: 'q-5' }, false);
    seedEntry(CARD_DEPS, { outgoing: [{ fromId: 'q-5', toId: 'sk-1' }], incoming: [] }, false);
    route(issueEnv('updated', { changedFields: ['title'] }));
    expect(isInvalidated(CARD)).toBe(false);
    expect(isInvalidated(CARD_DEPS)).toBe(false);
  });

  test.each<[string, unknown]>([
    ['names it as its parent', { id: 'q-5', parentIdCurrent: 'sk-1' }],
    ['lists it among its blockers', { id: 'q-5', blockers: [{ id: 'sk-1', title: 't', status: 'open' }] }],
  ])('a mounted card that %s is re-read with its links', (_name, detail) => {
    fresh();
    seedEntry(CARD, detail, true);
    seedEntry(CARD_DEPS, { outgoing: [], incoming: [] }, true);
    route(issueEnv('updated', { changedFields: ['title'] }));
    expect(isInvalidated(CARD)).toBe(true);
    expect(isInvalidated(CARD_DEPS)).toBe(true);
  });

  test('an UNMOUNTED card naming it as its parent is not looked at', () => {
    fresh();
    seedEntry(CARD, { id: 'q-5', parentIdCurrent: 'sk-1' }, false);
    route(issueEnv('updated', { changedFields: ['title'] }));
    expect(isInvalidated(CARD)).toBe(false);
  });

  test('a card naming another parent and other blockers is left alone', () => {
    fresh();
    seedEntry(CARD, { id: 'q-5', parentIdCurrent: 'sk-9', blockers: [{ id: 'sk-8' }] }, true);
    route(issueEnv('updated', { changedFields: ['title'] }));
    expect(isInvalidated(CARD)).toBe(false);
  });

  // Ancestors: a status change re-reads the cards of the ancestors the
  // cache knows (children counters, progress). Each source alone suffices.
  const D = (id: string) => ['issues', 'detail', id];

  test.each<[string, () => void]>([
    ['the issue\'s own card', () => seedEntry(D('sk-1'), { id: 'sk-1', parentIdCurrent: 'sk-0' }, false)],
    ['a row of a task list', () => seedEntry(KEYS.tasksQ.key, page({ id: 'sk-1', parentIdCurrent: 'sk-0' }), false)],
    ['a row of a tree', () => seedEntry(KEYS.treeQ.key, {
      rows: [{ item: { id: 'sk-1', parentIdCurrent: 'sk-0' }, depth: 1, isReference: false }],
    }, false)],
  ])('the parent known only from %s is re-read', (_name, seedParentSource) => {
    fresh();
    seedEntry(D('sk-0'), { id: 'sk-0' }, false);
    seedParentSource();
    route(issueEnv('status_changed'));
    expect(isInvalidated(D('sk-0'))).toBe(true);
  });

  test('nothing in the cache names a parent: no ancestor card is touched', () => {
    fresh();
    seedEntry(D('sk-0'), { id: 'sk-0' }, false);
    seedEntry(D('sk-1'), { id: 'sk-1', parentIdCurrent: '' }, false);
    seedEntry(KEYS.tasksQ.key, page({ id: 'sk-1' }, { id: 'sk-5', parentIdCurrent: 'sk-0' }), false);
    route(issueEnv('status_changed'));
    expect(isInvalidated(D('sk-0'))).toBe(false);
  });

  test('the walk goes up the chain and stops on a cycle', () => {
    fresh();
    seedEntry(D('sk-1'), { id: 'sk-1', parentIdCurrent: 'sk-0' }, false);
    seedEntry(D('sk-0'), { id: 'sk-0', parentIdCurrent: 'sk-00' }, false);
    // A cycle in stale data: sk-00 → sk-1.
    seedEntry(D('sk-00'), { id: 'sk-00', parentIdCurrent: 'sk-1' }, false);
    route(issueEnv('status_changed'));
    expect(isInvalidated(D('sk-0'))).toBe(true);
    expect(isInvalidated(D('sk-00'))).toBe(true);
  });

  test('a list showing only the ancestor is re-read (its progress moved)', () => {
    fresh();
    seedEntry(D('sk-1'), { id: 'sk-1', parentIdCurrent: 'sk-0' }, false);
    seedEntry(KEYS.tasksQ.key, page({ id: 'sk-0' }), false);
    route(issueEnv('status_changed'));
    expect(isInvalidated(KEYS.tasksQ.key)).toBe(true);
  });
});

// ─────────────── the section clock moves only when it has to ───────────────

describe('sk-429 — a row edit moves the section clock only when a mounted section shows the row', () => {
  test('no mounted section shows the row: the clock stays', () => {
    route(issueEnv('updated', { changedFields: ['title'] }, 'sk-9'));
    expect(epicSectionClock()).toBe(0);
  });

  test('an UNMOUNTED section shows the row: the clock stays (only a mounted one would catch up)', () => {
    route(issueEnv('updated', { changedFields: ['title'] }));
    expect(qc.getQueryState(KEYS.section.key)?.isInvalidated).toBe(true);
    expect(epicSectionClock()).toBe(0);
  });

  test('a mounted section shows the row: the clock moves', () => {
    const observer = new QueryObserver(qc, {
      queryKey: KEYS.section.key,
      queryFn: () => new Promise(() => {}),
      staleTime: Infinity,
    });
    unsubscribers.push(observer.subscribe(() => {}));
    route(issueEnv('updated', { changedFields: ['title'] }));
    expect(epicSectionClock()).toBeGreaterThan(0);
  });
});

// ─────────────── K21 through the batcher: which re-read takes one page ───────────────

describe('K21 — first page only where K18 says so', () => {
  async function runOnTwoPages(
    envs: EventEnvelope[],
    key: readonly unknown[] = KEYS.tasksP.key,
  ): Promise<unknown[]> {
    vi.useFakeTimers();
    try {
      const listQc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const fetched: unknown[] = [];
      listQc.setQueryData(key, {
        pages: [
          { items: [{ id: 'sk-1' }], hasMore: true, nextCursor: 'c2' },
          { items: [{ id: 'sk-2' }], hasMore: false },
        ],
        pageParams: [undefined, 'c2'],
      });
      const infinite = new InfiniteQueryObserver(listQc, {
        queryKey: key,
        initialPageParam: undefined as string | undefined,
        getNextPageParam: (last: { hasMore: boolean; nextCursor?: string }) =>
          last.hasMore ? last.nextCursor : undefined,
        queryFn: ({ pageParam }: { pageParam: unknown }) => {
          fetched.push(pageParam);
          return Promise.resolve(
            pageParam === undefined
              ? { items: [{ id: 'sk-1' }], hasMore: true, nextCursor: 'c2' }
              : { items: [{ id: 'sk-2' }], hasMore: false },
          );
        },
        staleTime: Infinity,
      });
      const unsub = infinite.subscribe(() => {});
      const batcher = createLiveInvalidationBatcher(listQc);
      for (const env of envs) invalidateForEvent(batcher, classifyEvent(env), env, FOLDED);
      await vi.advanceTimersByTimeAsync(LIVE_INVALIDATION_WINDOW_MS);
      unsub();
      batcher.dispose();
      listQc.clear();
      return fetched;
    } finally {
      vi.useRealTimers();
    }
  }

  test('a row edit re-reads the loaded pages of the list showing it (phase 1)', async () => {
    expect(await runOnTwoPages([issueEnv('updated', { changedFields: ['title'] })])).toEqual([undefined, 'c2']);
  });

  test('the list filtered by blocked-ness after a status change: first page', async () => {
    expect(await runOnTwoPages([issueEnv('status_changed')], projectList(P, 'all', 'blocked'))).toEqual([undefined]);
  });

  test('a first-page reset and a full one in the same wave: the first page wins', async () => {
    expect(await runOnTwoPages([
      issueEnv('updated', { changedFields: ['title'] }),
      issueEnv('created', {}, 'sk-50'),
    ])).toEqual([undefined]);
  });
});

// ─────────────── the router as the provider calls it ───────────────

describe('the provider feeds the router: role, expanded rows, malformed frames', () => {
  async function mountProvider(role: 'admin' | 'user', expanded: string[]) {
    const { createElement } = await import('react');
    const { render, act } = await import('@testing-library/react');
    const { LiveEventsProvider } = await import('../hooks/useLiveEvents');
    const { useDeclareProjects } = await import('./liveProjectDeclaration');
    const { QueryClientProvider } = await import('@tanstack/react-query');
    authUser.role = role;
    function Expanded() {
      useDeclareProjects('expanded', expanded);
      return null;
    }
    await act(async () => {
      render(createElement(QueryClientProvider, { client: qc },
        createElement(LiveEventsProvider, null, createElement(Expanded))));
    });
    const deliver = (env: unknown) => act(() => hubHandlers.get('event')!(env));
    const wave = () => act(async () => {
      await vi.advanceTimersByTimeAsync(LIVE_INVALIDATION_WINDOW_MS);
    });
    return { deliver, wave };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    hubHandlers.clear();
  });
  afterEach(async () => {
    const { cleanup } = await import('@testing-library/react');
    cleanup();
    vi.useRealTimers();
  });

  test('the projects column counters follow the rows the column declared expanded', async () => {
    const { deliver, wave } = await mountProvider('user', [P]);
    deliver(issueEnv('created', {}, 'sk-50'));
    await wave();
    expect(invalidated()).toContain('projectsInfinite');
  });

  test('only the EXPANDED source counts: a project declared by the route is not an expanded row', async () => {
    const { createElement } = await import('react');
    const { render, act } = await import('@testing-library/react');
    const { LiveEventsProvider } = await import('../hooks/useLiveEvents');
    const { useDeclareProjects } = await import('./liveProjectDeclaration');
    const { QueryClientProvider } = await import('@tanstack/react-query');
    function Route() {
      useDeclareProjects('route', [P]);
      return null;
    }
    await act(async () => {
      render(createElement(QueryClientProvider, { client: qc },
        createElement(LiveEventsProvider, null, createElement(Route))));
    });
    act(() => hubHandlers.get('event')!(issueEnv('created', {}, 'sk-50')));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LIVE_INVALIDATION_WINDOW_MS);
    });
    expect(invalidated()).not.toContain('projectsInfinite');
  });

  test('with no expanded row, no projects counters', async () => {
    const { deliver, wave } = await mountProvider('user', []);
    deliver(issueEnv('created', {}, 'sk-50'));
    await wave();
    expect(invalidated()).not.toContain('projectsInfinite');
  });

  test('the role reaches the router: an admin re-reads the users list', async () => {
    const { deliver, wave } = await mountProvider('admin', []);
    deliver(envelope({ eventType: 'user.updated', entityType: 'user', entityId: '42', projectId: null }));
    await wave();
    expect(invalidated()).toEqual(['usersAdmin']);
  });

  test('a frame without a numeric id, and a malformed one, do nothing', async () => {
    const { deliver, wave } = await mountProvider('user', []);
    deliver({ ...issueEnv('closed'), id: 'x' });
    deliver({ ...issueEnv('closed'), eventType: 'closed' });
    deliver(null);
    await wave();
    expect(invalidated()).toEqual([]);
  });
});

// ─────────── sk-644.6 (No. 92): survivors of the final mutation run ───────────

describe('trees still on their first read, and the clock of each kind of tree', () => {
  /** Mount a reader whose read never answers: `data` stays undefined. */
  function mountPending(key: readonly unknown[]): void {
    const observer = new QueryObserver(qc, { queryKey: key, queryFn: () => new Promise(() => {}) });
    unsubscribers.push(observer.subscribe(() => {}));
  }

  test.each([
    ['comment.created', () => envelope({ eventType: 'comment.created', entityType: 'comment', entityId: 'c-1', issueId: 'sk-1' })],
    ['attachment.added', () => envelope({ eventType: 'attachment.added', entityType: 'attachment', entityId: 'a-1', issueId: 'sk-1' })],
    ['project.updated', () => envelope({ eventType: 'project.updated', entityType: 'project', entityId: P })],
  ] as const)('%s touches no tree: a section and a column tree on their first read are left alone', (_n, make) => {
    // US-13: only the data the event can change; these rows of K18 name no tree.
    const pendingSection = ['issues', 'tree', '__cross__', 'sk-70', 'parent-child', '__full__', '__blockers__'];
    const pendingColumn = ['issues', 'tree', Q, '__forest__', 'parent-child', '__full__', '__blockers__'];
    mountPending(pendingSection);
    mountPending(pendingColumn);
    route(make());
    expect(qc.getQueryState(pendingSection)?.isInvalidated).toBe(false);
    expect(qc.getQueryState(pendingColumn)?.isInvalidated).toBe(false);
    expect(epicSectionClock()).toBe(0);
    expect(tasksColumnTreeClock()).toBe(0);
  });

  test('a mounted section hit by an event moves the section clock, not the column-tree clock', () => {
    // sk-429: a clock moves only when a mounted tree OF ITS KIND is hit; the
    // column tree would otherwise catch up for an event that is not its own.
    const observer = new QueryObserver(qc, {
      queryKey: KEYS.sectionOther.key,
      queryFn: () => new Promise(() => {}),
      staleTime: Infinity,
    });
    unsubscribers.push(observer.subscribe(() => {}));
    route(issueEnv('updated', { changedFields: ['title'] }, 'sk-98'), FOLDED);
    expect(epicSectionClock()).toBeGreaterThan(0);
    expect(tasksColumnTreeClock()).toBe(0);
  });
});

describe('frames whose optional part is missing or empty', () => {
  test.each([
    ['without `reparent`', {}],
    ['with `reparent: null`', { reparent: null }],
    ['with no new parent in `reparent`', { reparent: { oldParentIds: [] } }],
  ])('"Move" %s: the issue itself is still re-read — its card, trees, rows, backfills', (_n, extra) => {
    route(issueEnv('reparented', extra as Partial<EventEnvelope>));
    expect(invalidated()).toEqual(sorted([
      'detail1', 'treeP', 'section', 'tasksP', 'tasksAll', 'ancestors', 'ancestorsOther',
    ]));
  });

  test.each([
    ['without `dep`', {}],
    ['with `dep: null`', { dep: null }],
  ])('a dependency frame %s names no end: nothing is re-read', (_n, extra) => {
    const env = envelope({ eventType: 'dependency.created', entityType: 'dep', entityId: 'x', ...(extra as object) });
    route(env);
    expect(invalidated()).toEqual([]);
  });

  test('a project event: a handle that resolved to nothing, or is still resolving, is not re-read', () => {
    const unresolved = ['project', 'resolve', 'zz'];
    const resolving = ['project', 'resolve', 'yy'];
    qc.setQueryData(unresolved, { match: null });
    const observer = new QueryObserver(qc, { queryKey: resolving, queryFn: () => new Promise(() => {}) });
    unsubscribers.push(observer.subscribe(() => {}));
    route(envelope({ eventType: 'project.updated', entityType: 'project', entityId: P }));
    expect(invalidated()).toEqual(sorted([
      'projectsLookup', 'projectsInfinite', 'projectsInfiniteLens',
      'membersP', 'resolveP', 'projectDetailP',
    ]));
    expect(qc.getQueryState(unresolved)?.isInvalidated).toBe(false);
    expect(qc.getQueryState(resolving)?.isInvalidated).toBe(false);
  });
});

describe('open cards: the issue\'s own card, cards still loading, redacted links', () => {
  function mount(key: readonly unknown[], data?: unknown): void {
    if (data !== undefined) qc.setQueryData(key, data);
    const observer = new QueryObserver(qc, { queryKey: key, queryFn: () => new Promise(() => {}), staleTime: Infinity });
    unsubscribers.push(observer.subscribe(() => {}));
  }

  test('the issue\'s own open card lists its links: a title change does not re-read them', () => {
    // K18 "open cards linked to the issue" — cards OF OTHER issues
    // showing it; the card's own links show the other ends, not the issue.
    qc.setQueryData(KEYS.deps1.key, {
      outgoing: [{ fromId: 'sk-1', toId: 'sk-9', type: 'related', issue: { id: 'sk-9' } }],
      incoming: [],
    });
    route(issueEnv('updated', { changedFields: ['title'] }));
    expect(invalidated()).toEqual(sorted([
      'detail1', 'tasksP', 'tasksAll', 'treeP', 'section',
      'detailLinker', 'depsLinker',
      'activity1',
    ]));
  });

  test('a card still loading, a card whose links are loading, a card with a redacted link: none is taken as linking', () => {
    const loadingCard = ['issues', 'detail', 'q-6'];
    const linksLoadingCard = ['issues', 'detail', 'q-8'];
    const linksLoading = ['deps', Q, 'q-8'];
    const redactedCard = ['issues', 'detail', 'q-9'];
    const redactedLinks = ['deps', Q, 'q-9'];
    mount(loadingCard);
    mount(linksLoadingCard, { id: 'q-8' });
    mount(linksLoading);
    mount(redactedCard, { id: 'q-9' });
    // An edge to an issue the reader cannot see carries no `issue` (R8).
    mount(redactedLinks, { outgoing: [{ fromId: 'q-9', toId: 'zz-1', type: 'related', issue: null, redacted: true }], incoming: [] });
    route(issueEnv('closed'));
    for (const key of [loadingCard, linksLoadingCard, linksLoading, redactedCard, redactedLinks]) {
      expect(qc.getQueryState(key)?.isInvalidated, JSON.stringify(key)).toBe(false);
    }
    expect(invalidated()).toEqual(sorted([...[
      'detail1', 'detail0', 'tasksP', 'tasksAll', 'ancestors', 'tasksPBlockedRow', 'tasksPBlocked',
      'treeP', 'section', 'detailLinker', 'depsLinker',
      'projectsInfinite', 'projectsInfiniteLens', 'componentsP', 'componentsPLens', 'activity1',
    ] as KeyName[], 'inProgress']));
  });
});
