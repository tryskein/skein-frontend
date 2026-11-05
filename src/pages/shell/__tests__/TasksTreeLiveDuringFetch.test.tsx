/**
 * sk-429 — the tasks column tree does not lose a live event that arrived DURING
 * a refetch in progress.
 *
 * ─── What was broken ───────────────────────────────────────────────
 *
 * Invalidating the column tree (`liveEventInvalidation.ts#invalidateTasksColumnTrees`)
 * marks the key stale with `cancelRefetch: false` — and that is right:
 * otherwise under a batched write (a series of events in a row) the full walk would be cancelled
 * by the next event and would never finish. But such coalescing has a
 * second half: while a read is in progress the library does not start a new one, and the success
 * of that read clears the stale mark. An event that arrived between the start
 * and the end of the walk is caught up by NOTHING — the tree stays stale until
 * the next event, which may never come.
 *
 * The epic section is protected from the same defect by a check "the request time
 * of the shown response against the tab clock" (`lib/epicSectionClock.ts`,
 * `EpicProgressSection.tsx#isStaleAgainstEpicSectionClock`). The column
 * tree had no such check; sk-429 gives it its own
 * (`lib/tasksColumnTreeClock.ts`).
 *
 * ─── Why the test counts READS and does not look at rows ───────────
 *
 * "The tree is stale" is a statement about WHETHER the server was ASKED, not about
 * what is on screen: rows rendered from a stale response look
 * exactly like fresh ones, and a markup comparison would pass even without the fix. So
 * the stand keeps `fetchIssueTree` on a manual brake (each call returns a
 * promise that the test itself resolves) and counts the calls — so "no
 * catch-up read under the hold" is distinguishable from "one" and from "two".
 * What the reads deliver is checked where it must show: the read the
 * reader applies has to bring a new row of the fixture (`NEW_ROWS`) on
 * screen — the old rows alone would look the same either way.
 *
 * The clock and the request time are both taken via `Date.now()`, and equality is not
 * staleness (a request made IN THE SAME millisecond already
 * carried the change). So the time is faked here: real
 * milliseconds would make the outcome of the test a race.
 *
 * The flip side — "the epic section reads once on the same event, not
 * twice" — is guarded by `EpicChildBlockers.live.test.tsx` ("exactly one
 * `fetchIssueTree` read per event"), which this change does not touch: the two
 * surfaces have their own clocks and their own keys.
 *
 * ─── sk-763: the tree the column shows is held ─────────────────────
 *
 * The owner's decision (`lib/liveListDirty.ts`, module header): the list the
 * column shows — here the project's layered tree — is not read again by the
 * background; a change it cannot apply in place is offered as «Updates
 * available», and the reader's press reads it once. So the reads that can be
 * in flight under an event are the tree's FIRST read and the read the button
 * started; the catch-up of an event that came during one of them is the
 * offer, not a read of its own. Events reach the column as in the app:
 * through the live coalescer with the reading hold
 * (`useLiveEvents.tsx` → `createLiveInvalidationBatcher(…, readingListHold)`),
 * not straight into the client — the hold lives in the coalescer, and so
 * does the release of the offer by the read that delivers it.
 *
 * The coalescer's window is 1 ms here (its public parameter), not 1.5 s: a
 * wave then runs before the stand's next macrotask boundary
 * (`commitNotifications`), since Node runs a 0 ms timer as a 1 ms one, in
 * the order the timers were set.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import {
  QueryClient,
  QueryClientProvider,
  defaultScheduler,
  notifyManager,
} from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import type {
  FetchIssueTreeArgs,
  IssueSummary,
  IssueTreeNode,
} from '../../../api/issues';
import i18n from '../../../i18n/config';
import { classifyEvent, type ClassifiedEvent } from '../../../lib/eventClassify';
import type { EventEnvelope } from '../../../lib/eventEnvelope';
import { LayoutProvider } from '../../../lib/useLayoutState';
import { TasksUiStateProvider } from '../../../lib/useTasksUiState';

const PROJECT_ID = 'proj-uuid-1';
const TREE_KEY = 'skein.tasks.tree.demo.expanded';
const DEP_TYPES_KEY = 'skein.tasks.tree.demo.depTypes';

vi.mock('../../../api/issues', async (importActual) => {
  const actual = await importActual<typeof import('../../../api/issues')>();
  return { ...actual, fetchIssueTree: vi.fn() };
});

function issue(id: string): IssueSummary {
  return {
    id,
    projectId: PROJECT_ID,
    version: 1,
    title: `title ${id}`,
    type: 'task',
    priority: 2,
    status: 'open',
    pinned: false,
    assignee: null,
    parentIdCurrent: null,
    componentIds: [],
    labels: [],
    isBlocked: false,
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
  };
}

const ROWS: IssueTreeNode[] = [
  {
    item: issue('demo-1'),
    depth: 0,
    parentRef: null,
    isReference: false,
    firstSeenAt: null,
  },
];

vi.mock('../../../lib/useTasks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/useTasks')>();
  return {
    ...actual,
    useTasks: () => ({
      data: ROWS.map((n) => n.item),
      total: ROWS.length,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: () => {},
      isLoading: false,
      error: null,
      emptyReason: 'none',
      searchDegraded: false,
      searchMode: false,
      totalIsExact: true,
      resolvedProjectId: PROJECT_ID,
      delegateeAssignees: [],
      cacheKey: ['tasks', 'test'],
    }),
  };
});

vi.mock('../../../lib/useProjectsList', () => ({
  projectsListQueryKey: ['projects', 'list', 'shell'],
  useProjectsList: () => ({ data: { items: [] }, isLoading: false, isError: false }),
  useProjectsInfinite: () => ({
    items: [],
    total: 0,
    isLoading: false,
    isFetching: false,
    isFetchingNextPage: false,
    isError: false,
    hasNextPage: false,
    fetchNextPage: () => {},
  }),
}));

vi.mock('../../../lib/useProjectByHandle', () => ({
  useProjectByHandle: () => ({
    project: { id: PROJECT_ID, alias: 'demo' },
    isLoading: false,
    isError: false,
  }),
}));

vi.mock('../../../lib/useReminders', () => ({
  useRingingIssueIds: () => new Set<string>(),
  useRingingTaskCount: () => 0,
}));

vi.mock('../../../api/components', () => ({ listComponents: async () => [] }));
vi.mock('../../../api/projects', () => ({ listMembers: async () => [] }));
vi.mock('../../../api/users', () => ({
  listUserDirectory: async () => ({ items: [], hasMore: false }),
}));

vi.mock('../../../auth/AuthContext', () => ({
  // sk-551.8 — LayoutProvider reads the layout via useNavLayoutOptional;
  // null = no session known, the side-by-side layout.
  useAuthOptional: () => null,
  useAuth: () => ({ user: { id: 'u-1', username: 'admin', role: 'user' } }),
}));

import { fetchIssueTree } from '../../../api/issues';
import { invalidateForEvent } from '../../../lib/liveEventInvalidation';
import { createLiveInvalidationBatcher, type LiveInvalidationBatcher } from '../../../lib/liveInvalidationBatcher';
import { readingListHold } from '../../../lib/liveListDirty';
import { TasksColumn } from '../TasksColumn';

const fetchMock = vi.mocked(fetchIssueTree);

// ───────────────────────── Time ─────────────────────────

/**
 * The faked tab clock. Both compared numbers — the request time of the response
 * and the reading of the tree clock — are taken with `Date.now()`, so the test moves
 * time itself: on real milliseconds "requested before the event" would be
 * a race, not a statement.
 *
 * The tree clock is MODULE state (as with the epic section: it is moved by the
 * live-event router, a plain module without a component), and
 * unmounting does not reset it. So each test starts not from
 * zero, but knowingly LATER than anything the previous one could have marked — this is
 * more honest than an exported reset: the tab clock only moves forward, and
 * the test has to work in the same world.
 */
let now = 1_000;
/** The start of the current test's time. */
let base = 1_000;

// ───────────────────────── The "network" on a manual brake ─────────────────────────

let pending: Array<(rows: IssueTreeNode[]) => void>;
/** The abort signal each read was started with, by read index. */
let signals: Array<AbortSignal | undefined>;

function installDeferredFetch(): void {
  pending = [];
  signals = [];
  fetchMock.mockImplementation(
    (args: FetchIssueTreeArgs) =>
      new Promise((resolve) => {
        signals.push(args.signal);
        pending.push((rows) => resolve({ items: rows }));
      }) as ReturnType<typeof fetchIssueTree>,
  );
}

// ───────────────────────── Observer notifications under manual control ─────────────────────────

/**
 * sk-545 — when a finished read reaches the column is decided by the test,
 * not by the timer queue.
 *
 * react-query writes a finished read into the cache at once, but tells the
 * component about it through `notifyManager`, whose default scheduler is a
 * zero-delay `setTimeout`. Whether that timer fired before or after the
 * test's next step used to be a coin toss (RTL's `waitFor` drains a
 * macrotask on its own), and the column's catch-up check runs only when the
 * response is COMMITTED. So the old stand sometimes committed read No. 1 after
 * event A had already started read No. 2 — a different scenario from the one
 * the test describes, and one that exposed a real product defect (sk-545).
 * Under the hold (sk-763) that late commit only marks the shown tree
 * (`TasksColumn.tsx`, `readingListHold.mark`): it starts or cancels no read.
 *
 * Here notifications are queued and delivered only by `commitNotifications`,
 * so every step states which responses the column has seen.
 */
let queuedNotifications: Array<() => void> = [];

function installManualNotifyScheduler(): void {
  queuedNotifications = [];
  notifyManager.setScheduler((cb) => {
    queuedNotifications.push(cb);
  });
}

/**
 * Let every settled read reach the cache (a macrotask boundary drains the
 * promise chains behind the resolved fetches), then deliver all queued
 * notifications to the component — repeatedly, since a delivery can queue
 * more — until nothing is left.
 */
async function commitNotifications(): Promise<void> {
  for (let round = 0; ; round += 1) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    if (queuedNotifications.length === 0) return;
    if (round > 50) {
      throw new Error('notifications keep coming: the column re-renders in a loop');
    }
    act(() => {
      queuedNotifications.splice(0).forEach((cb) => cb());
    });
  }
}

/** Finish read No. `index` (0-based) with `rows` and let the column commit its response. */
async function settle(index: number, rows: IssueTreeNode[] = ROWS): Promise<void> {
  pending[index](rows);
  await commitNotifications();
}

/** The tree after a change: a second root row. */
const NEW_ROWS: IssueTreeNode[] = [
  ...ROWS,
  { item: issue('demo-2'), depth: 0, parentRef: null, isReference: false, firstSeenAt: null },
];

// ───────────────────────── The event ─────────────────────────

let seq = 0;

/** The live coalescer of the stand, with the reading hold, as the app wires it. */
let batcher: LiveInvalidationBatcher | null = null;

function liveCoalescer(qc: QueryClient): LiveInvalidationBatcher {
  batcher = createLiveInvalidationBatcher(qc, 1, () => false, readingListHold);
  return batcher;
}

/** The event `entityId` as the live layer delivers it to the column. */
async function deliver(target: LiveInvalidationBatcher, entityId: string): Promise<void> {
  const [ev, env] = issueEvent(entityId);
  act(() => {
    invalidateForEvent(target, ev, env, { isAdmin: false, currentUserId: 'u-1' });
  });
  await commitNotifications();
}

const offer = () => screen.queryByRole('button', { name: i18n.t('tasks:updatesAvailable') });

/** The updates button in any of its states — offered, applying, failed — or null. */
const updatesButton = () =>
  (['updatesAvailable', 'updatesApplying', 'updatesFailed'] as const)
    .map((k) => screen.queryByRole('button', { name: i18n.t(`tasks:${k}`) }))
    .find((b) => b !== null) ?? null;

/**
 * sk-622.21 No. 79 — a compact browser envelope (US-12): a status change
 * of a tree task, without `newData`; the real `classifyEvent` classifies it.
 * Row K18 "Status" refetches the tree of the project column of the event.
 */
function issueEvent(entityId: string): [ClassifiedEvent, EventEnvelope] {
  seq += 1;
  const envelope = {
    id: seq,
    occurredAt: '2026-09-15T10:00:00Z',
    eventType: 'issue.status_changed',
    entityType: 'issue',
    entityId,
    projectId: PROJECT_ID,
  } as EventEnvelope;
  return [classifyEvent(envelope), envelope];
}

// ───────────────────────── The stand ─────────────────────────

function renderColumn(qc: QueryClient) {
  return render(
    <MantineProvider forceColorScheme="dark">
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/projects/demo']}>
          <Routes>
            <Route
              path="/projects/:alias"
              element={
                <LayoutProvider>
                  <TasksUiStateProvider>
                    <TasksColumn
                      width={468}
                      collapsed={false}
                      outboxMode={false}
                      onMeMode={false}
                      budilnikMode={false}
                    />
                  </TasksUiStateProvider>
                </LayoutProvider>
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

beforeEach(() => {
  base = now + 100_000;
  now = base;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  seq = 0;
  installDeferredFetch();
  installManualNotifyScheduler();
  window.localStorage.clear();
  window.localStorage.setItem('skein.tasks.view', 'tree');
  window.localStorage.setItem(TREE_KEY, JSON.stringify(['demo-1']));
  // The second link type is on — this is what puts the column on the layered path
  // (`useLayeredTree`), not on the client tree from a flat list.
  window.localStorage.setItem(
    DEP_TYPES_KEY,
    JSON.stringify(['blocks', 'parent-child']),
  );
});

afterEach(() => {
  batcher?.dispose();
  batcher = null;
  cleanup();
  notifyManager.setScheduler(defaultScheduler);
  vi.restoreAllMocks();
});

describe('sk-429 — an event during a walk in progress is caught up, as the offer of the held tree', () => {
  test('an event during the tree\'s first read is offered when the read ends — not read again; the button reads once', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const live = liveCoalescer(qc);
    renderColumn(qc);

    // Read No. 1 — the first render of the tree, requested at +0.
    await waitFor(() => expect(pending.length).toBe(1));

    // Event A arrives WHILE read No. 1 is in flight: no second read starts.
    now = base + 2_000;
    await deliver(live, 'demo-1');
    expect(pending.length).toBe(1);

    // Read No. 1 ends. It was requested before event A, so the shown rows
    // know nothing about A: the tree is offered, not read again.
    now = base + 3_000;
    await settle(0);
    expect(offer()).not.toBeNull();
    expect(pending.length).toBe(1);

    // The reader applies it: one read, requested after the event.
    now = base + 4_000;
    await act(async () => { fireEvent.click(offer()!); });
    await waitFor(() => expect(pending.length).toBe(2));
    now = base + 5_000;
    await settle(1, NEW_ROWS);

    expect(screen.queryByText('title demo-2')).not.toBeNull();
    expect(updatesButton()).toBeNull();
    expect(pending.length).toBe(2);
  });

  test('with no event in flight there is no catch-up: the read the button started ends the offer, and nothing more is read', async () => {
    // The flip side: a first read with no event in flight is not offered, an
    // event on the shown tree is offered without a read, and the read the
    // button starts — with nothing arriving during it — ends the offer.
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const live = liveCoalescer(qc);
    renderColumn(qc);

    await waitFor(() => expect(pending.length).toBe(1));
    now = base + 1_000;
    await settle(0);
    expect(offer()).toBeNull();

    // Event A on the shown tree: offered, not read.
    now = base + 2_000;
    await deliver(live, 'demo-1');
    await waitFor(() => expect(offer()).not.toBeNull());
    expect(pending.length).toBe(1);

    // Nothing arrives during the read the button starts — it settles the question.
    now = base + 3_000;
    await act(async () => { fireEvent.click(offer()!); });
    await waitFor(() => expect(pending.length).toBe(2));
    now = base + 4_000;
    await settle(1, NEW_ROWS);

    expect(screen.queryByText('title demo-2')).not.toBeNull();
    expect(updatesButton()).toBeNull();
    expect(pending.length).toBe(2);
  });

  test('an event during the read the button started neither cancels nor repeats it: the event is offered after it', async () => {
    // sk-545 — the catch-up of an event must not cancel a read already in
    // flight and start another. Under the hold the event during the read the
    // button started is owed as the offer: that read goes on, and ends.
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const live = liveCoalescer(qc);
    renderColumn(qc);

    await waitFor(() => expect(pending.length).toBe(1));
    now = base + 1_000;
    await settle(0);
    now = base + 2_000;
    await deliver(live, 'demo-1');
    await waitFor(() => expect(offer()).not.toBeNull());

    // The button's read No. 2, requested at +3000.
    now = base + 3_000;
    await act(async () => { fireEvent.click(offer()!); });
    await waitFor(() => expect(pending.length).toBe(2));

    // Event B arrives WHILE read No. 2 is in flight.
    now = base + 4_000;
    await deliver(live, 'demo-1');
    expect(pending.length).toBe(2);
    expect(signals[1]?.aborted).toBe(false);

    // Read No. 2 ends; it knows nothing about B: B is offered, not read.
    now = base + 5_000;
    await settle(1, NEW_ROWS);

    expect(screen.queryByText('title demo-2')).not.toBeNull();
    expect(offer()).not.toBeNull();
    expect(pending.length).toBe(2);
    expect(signals[1]?.aborted).toBe(false);
  });
});
