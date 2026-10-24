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
 * promise that the test itself resolves) and counts the calls — so "one
 * catch-up read" is distinguishable from "none" and from "two".
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
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
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
 * the test describes, and one that exposed a real product defect (see the
 * regression test below).
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

/** Finish read No. `index` (0-based) and let the column commit its response. */
async function settle(index: number): Promise<void> {
  pending[index](ROWS);
  await commitNotifications();
}

// ───────────────────────── The event ─────────────────────────

let seq = 0;

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
  cleanup();
  notifyManager.setScheduler(defaultScheduler);
  vi.restoreAllMocks();
});

describe('sk-429 — an event during a walk in progress is caught up by one read', () => {
  test('an event that arrived in flight gives EXACTLY one repeated read after it', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderColumn(qc);

    // Read No. 1 — the first render of the tree.
    await waitFor(() => expect(pending.length).toBe(1));
    now = base + 1_000;
    await settle(0);

    // Event A: the key is marked stale, read No. 2 starts.
    now = base + 2_000;
    const [evA, envA] = issueEvent('demo-1');
    act(() => {
      invalidateForEvent(qc, evA, envA, { isAdmin: false, currentUserId: 'u-1' });
    });
    await waitFor(() => expect(pending.length).toBe(2));

    // Event B arrives WHILE read No. 2 is in flight. `cancelRefetch: false`
    // does not start a third read here — and must not: otherwise a series of
    // events would cancel the walk endlessly.
    now = base + 3_000;
    const [evB, envB] = issueEvent('demo-1');
    act(() => {
      invalidateForEvent(qc, evB, envB, { isAdmin: false, currentUserId: 'u-1' });
    });
    expect(pending.length).toBe(2);

    // Read No. 2 finishes. It was REQUESTED at mark +2000 —
    // before event B (+3000), so the shown rows know nothing about B. Here the
    // catch-up read No. 3 must happen; before the fix there were two of them.
    now = base + 4_000;
    await settle(1);
    await waitFor(() => expect(pending.length).toBe(3));

    // Read No. 3 is requested at +4000 — later than the clock (+3000). No loop: after
    // it nothing more is read.
    now = base + 5_000;
    await settle(2);
    expect(pending.length).toBe(3);
  });

  test('with no event in flight there is no catch-up read', async () => {
    // The flip side: the check must STAY SILENT when there is nothing to catch up.
    // Without this case "always read once more" would pass the first test.
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderColumn(qc);

    await waitFor(() => expect(pending.length).toBe(1));
    now = base + 1_000;
    await settle(0);

    now = base + 2_000;
    const [ev, env] = issueEvent('demo-1');
    act(() => {
      invalidateForEvent(qc, ev, env, { isAdmin: false, currentUserId: 'u-1' });
    });
    await waitFor(() => expect(pending.length).toBe(2));

    // Nothing arrives in flight — read No. 2 settles the question.
    now = base + 3_000;
    await settle(1);
    expect(pending.length).toBe(2);
  });

  test('a response committed after a later read started does not cancel or repeat that read', async () => {
    // sk-545 — the product defect behind the flaky first test. Read No. 1 is
    // finished, but the column has not committed it yet when event A starts
    // read No. 2. When the column then commits read No. 1, its requestedAt is
    // earlier than the clock, so the catch-up check fires. Read No. 2, already
    // requested AFTER event A, answers that event; the catch-up must not
    // cancel it and start read No. 3. Before the fix the catch-up invalidated
    // with the library default `cancelRefetch: true` and did exactly that.
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderColumn(qc);

    await waitFor(() => expect(pending.length).toBe(1));
    now = base + 1_000;
    pending[0](ROWS);
    // Read No. 1 reaches the cache; the column is not told yet.
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(queuedNotifications.length).toBeGreaterThan(0);

    now = base + 2_000;
    const [evA, envA] = issueEvent('demo-1');
    act(() => {
      invalidateForEvent(qc, evA, envA, { isAdmin: false, currentUserId: 'u-1' });
    });
    expect(pending.length).toBe(2);

    // The column now commits read No. 1 (requested at +0, older than the clock).
    await commitNotifications();
    expect(pending.length).toBe(2);
    expect(signals[1]?.aborted).toBe(false);

    // Read No. 2 was requested at +2000, not earlier than the clock: nothing to
    // catch up after it either.
    now = base + 3_000;
    await settle(1);
    expect(pending.length).toBe(2);
  });
});
