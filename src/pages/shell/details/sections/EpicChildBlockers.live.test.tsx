/**
 * sk-421.2.8 — matrix row 31 (US-5, SC-008, US-1 "refetch while the
 * list is expanded", NF "the section makes no new requests"): live update
 * of the blockers sub-row of an open epic section without reopening.
 *
 * The rig is the real epic section, `useLayeredTree`, QueryClient and
 * the live-event router `invalidateForEvent`. Only the network
 * `fetchIssueTree` is mocked: it answers with the current "server state", which the test
 * changes between events. This also models a change on the server WITHOUT an
 * event (step 6): the answer is already different, but there is no refetch until the event
 * arrives.
 *
 * The sequence is run in "List" mode (children at depth 1) and
 * separately in "Tree" mode (the same children at depth 2). Exactly one
 * `fetchIssueTree` read per event.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type {
  FetchIssueTreeArgs,
  IssueDetail,
  IssueTreeNode,
  IssueTreeRowItem,
  TreeBlockerRef,
} from '../../../../api/issues';
import { classifyEvent } from '../../../../lib/eventClassify';
import type { EventEnvelope } from '../../../../lib/eventEnvelope';
import { resetEpicSectionClockForTests } from '../../../../lib/epicSectionClock';
import { invalidateForEvent } from '../../../../lib/liveEventInvalidation';
import { LayoutProvider } from '../../../../lib/useLayoutState';
import '../../../../i18n/config';

vi.mock('../../../../api/issues', async (importActual) => {
  const actual = await importActual<typeof import('../../../../api/issues')>();
  return { ...actual, fetchIssueTree: vi.fn(), createIssue: vi.fn() };
});

vi.mock('../../../../auth/AuthContext', () => ({
  // sk-551.8 — LayoutProvider reads the layout via useNavLayoutOptional;
  // null = no session known, the side-by-side layout.
  useAuthOptional: () => null,
  useAuth: () => ({
    user: { id: 'u-live', username: 'live', role: 'user' },
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

import { fetchIssueTree } from '../../../../api/issues';
import { EpicProgressSection } from './EpicProgressSection';

const PROJECT_ID = '00000000-0000-0000-0000-000000000001';
const USER_ID = 'u-live';
const EPIC_ID = 'ep-1';
const PARENT_ID = 'ep-1.9';
const CTX = { isAdmin: false, currentUserId: USER_ID };

const fetchMock = vi.mocked(fetchIssueTree);

// ───────────────────────── "server" ─────────────────────────

interface ChildState {
  item: Partial<IssueTreeRowItem>;
  blockers?: TreeBlockerRef[];
}

function visible(id: string, title = `Title ${id}`, status: TreeBlockerRef['status'] = 'open'): TreeBlockerRef {
  return { id, title, status: status ?? 'open', projectId: 'proj-b' };
}

let server: Record<'X' | 'Y' | 'Z' | 'W', ChildState>;

function resetServer(): void {
  server = {
    // Five entries, one hidden: "+2".
    X: {
      item: { isBlocked: true },
      blockers: [visible('a'), visible('b'), { id: 'q-1', redacted: true }, visible('c'), visible('d')],
    },
    // The only visible blocker.
    Y: { item: { isBlocked: true }, blockers: [visible('e')] },
    // The only hidden blocker.
    Z: { item: { isBlocked: true }, blockers: [{ id: 'q-2', redacted: true }] },
    // A blocked child that will be closed.
    W: { item: { isBlocked: true }, blockers: [visible('f')] },
  };
}

function rowItem(id: string, over: Partial<IssueTreeRowItem> = {}): IssueTreeRowItem {
  return {
    id,
    projectId: 'proj-child',
    version: 1,
    title: id,
    type: 'task',
    priority: 2,
    status: 'open',
    pinned: false,
    componentIds: [],
    labels: [],
    isBlocked: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...over,
  } as IssueTreeRowItem;
}

/** The tree response from the current server state for the request arguments. */
function respond(args: FetchIssueTreeArgs) {
  const list = args.maxDepth === 1;
  const depth = list ? 1 : 2;
  const parent = list ? EPIC_ID : PARENT_ID;
  const items: IssueTreeNode[] = [
    { item: rowItem(EPIC_ID, { type: 'epic' }), depth: 0, parentRef: null, isReference: false, firstSeenAt: null },
  ];
  if (!list) {
    items.push({
      item: rowItem(PARENT_ID),
      depth: 1,
      parentRef: { id: EPIC_ID, edgeType: 'parent-child' },
      isReference: false,
      firstSeenAt: null,
    });
  }
  for (const key of ['X', 'Y', 'Z', 'W'] as const) {
    const state = server[key];
    items.push({
      item: rowItem(key, state.item),
      depth,
      parentRef: { id: parent, edgeType: 'parent-child' },
      isReference: false,
      firstSeenAt: null,
      ...(state.blockers ? { blockers: state.blockers.map((b) => ({ ...b })) } : {}),
    });
  }
  return { items };
}

// ───────────────────────── events ─────────────────────────

let seq = 0;

/**
 * sk-622.21 No. 79 — events are fed as a compact browser envelope (US-12):
 * a field edit carries `changedFields`, a link carries `dep` with the ends of its
 * project; there is no `newData` in the envelope.
 */
function issueEvent(
  action: string,
  entityId: string,
  extra: Partial<EventEnvelope> = {},
): EventEnvelope {
  seq += 1;
  return {
    id: seq,
    occurredAt: '2026-09-15T10:00:00Z',
    eventType: `issue.${action}`,
    entityType: 'issue',
    entityId,
    projectId: PROJECT_ID,
    ...extra,
  } as EventEnvelope;
}

function blocksCreated(fromId: string, toId: string): EventEnvelope {
  seq += 1;
  return {
    id: seq,
    occurredAt: '2026-09-15T10:00:00Z',
    eventType: 'dependency.created',
    entityType: 'dep',
    entityId: `${fromId}::${toId}::blocks`,
    projectId: PROJECT_ID,
    dep: { type: 'blocks', fromId, toId },
  } as EventEnvelope;
}

// ───────────────────────── rig ─────────────────────────

function epic(): IssueDetail {
  return {
    id: EPIC_ID,
    projectId: PROJECT_ID,
    version: 1,
    title: 'epic',
    description: '',
    type: 'epic',
    priority: 2,
    status: 'open',
    pinned: false,
    source: 'human',
    design: '',
    acceptanceCriteria: '',
    notes: '',
    createdBy: 'u-1',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    metadata: {},
    componentIds: [],
    labels: [],
    commentsCount: 0,
    commitRefs: [],
    mentions: [],
    isBlocked: false,
    blockers: [],
    epic: {
      totalChildren: 5,
      openChildren: 5,
      inProgressChildren: 0,
      closedChildren: 0,
      blockedChildren: 4,
      eligibleForClose: false,
    },
  } as unknown as IssueDetail;
}

let qc: QueryClient;

function mount() {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MantineProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <LayoutProvider>
            <EpicProgressSection issue={epic()} />
          </LayoutProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

/** A child row (a "List" li or a "Tree" treeitem) by its id title. */
function rowOf(container: HTMLElement, id: string): HTMLElement | null {
  const title = Array.from(container.querySelectorAll('.epic-child-title')).find(
    (el) => el.textContent === id,
  );
  return (title?.closest('li, [role="treeitem"]') as HTMLElement | null) ?? null;
}

function sublineOf(container: HTMLElement, id: string): HTMLElement | null {
  return rowOf(container, id)?.querySelector<HTMLElement>('.epic-child-blockers') ?? null;
}

/** The row's status announces it as blocked (its accessible name says so). */
function highlighted(container: HTMLElement, id: string): boolean {
  const status = rowOf(container, id)?.querySelector('.epic-child-status');
  return /blocked by dependencies/.test(status?.getAttribute('aria-label') ?? '');
}

/** Send an event and wait for exactly one new read. */
async function deliver(envelope: EventEnvelope) {
  const before = fetchMock.mock.calls.length;
  act(() => invalidateForEvent(qc, classifyEvent(envelope), envelope, CTX));
  await waitFor(() => expect(fetchMock.mock.calls.length).toBe(before + 1));
  return before;
}

/**
 * Wait for the QueryClient to go idle: no read in progress, the effects of the last
 * render are flushed, and after the flush there are still no reads. Review
 * skein-frontend/4 MINOR-6 — instead of a fixed sleep: a late read
 * started by an effect (for example, the section freshness effect) is seen as
 * `isFetching() > 0` right at the start, not "if it made it into the window".
 */
async function settleQueries() {
  await waitFor(() => expect(qc.isFetching()).toBe(0));
  await act(async () => {
    await Promise.resolve();
  });
  expect(qc.isFetching()).toBe(0);
}

/** Make sure no second read went out after the event. */
async function assertSingleRead(before: number) {
  await settleQueries();
  expect(fetchMock.mock.calls.length).toBe(before + 1);
}

beforeEach(() => {
  resetServer();
  resetEpicSectionClockForTests();
  window.localStorage.clear();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (args: FetchIssueTreeArgs) => respond(args));
});

afterEach(() => {
  cleanup();
  qc?.clear();
});

async function runSequence(mode: 'list' | 'tree') {
  const { container } = mount();
  if (mode === 'tree') {
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Tree' })).toBeTruthy());
    fireEvent.click(screen.getByRole('radio', { name: 'Tree' }));
  }
  await waitFor(() => expect(sublineOf(container, 'X')).not.toBeNull());
  // The rig really is in the needed mode and at the needed depth.
  if (mode === 'tree') {
    expect(rowOf(container, 'X')?.getAttribute('role')).toBe('treeitem');
    expect(rowOf(container, 'X')?.getAttribute('aria-level')).toBe('2');
  } else {
    expect(rowOf(container, 'X')?.tagName).toBe('LI');
  }
  // The request carries the blockers flag and the depth of the active mode.
  const last = fetchMock.mock.calls[fetchMock.mock.calls.length - 1][0];
  expect(last.includeBlockers).toBe(true);
  // sk-460.12 — there is no depth in the request in any mode anymore: the coverage
  // of "List" is merged with "Tree", they share one set, one request.
  expect(last.maxDepth).toBeUndefined();

  // "+N" expanded on the child with five entries.
  const more = within(sublineOf(container, 'X')!).getByRole('button', { name: '+2' });
  fireEvent.click(more);
  expect(within(sublineOf(container, 'X')!).getByRole('list', { name: 'All blockers' })).toBeTruthy();

  const expandedOfX = () =>
    Array.from(sublineOf(container, 'X')?.querySelectorAll('.epic-child-blockers-list > li') ?? []).map(
      (li) => li.textContent,
    );

  // (1) A new blocker through a link → an entry appears; the expansion is kept.
  server.X.blockers = [...server.X.blockers!, visible('g')];
  let before = await deliver(blocksCreated('X', 'g'));
  await waitFor(() => expect(expandedOfX()).toContain('g · Title g · open'));
  expect(within(sublineOf(container, 'X')!).getByRole('button', { name: '+3' }).getAttribute('aria-expanded')).toBe(
    'true',
  );
  await assertSingleRead(before);

  // (2) The only visible blocker Y is closed → the highlight and the sub-row disappear.
  server.Y = { item: { isBlocked: false } };
  before = await deliver(issueEvent('closed', 'e'));
  await waitFor(() => expect(sublineOf(container, 'Y')).toBeNull());
  expect(highlighted(container, 'Y')).toBe(false);
  await assertSingleRead(before);

  // (3) The title of a visible blocker changed → the expanded list shows the new one,
  // the expansion is kept (not reset by the refetch).
  server.X.blockers = server.X.blockers!.map((b) => (b.id === 'a' ? visible('a', 'A renamed') : b));
  before = await deliver(issueEvent('updated', 'a', { changedFields: ['title'] }));
  await waitFor(() => expect(expandedOfX()).toContain('a · A renamed · open'));
  await assertSingleRead(before);

  // (4) The status changed → the chip text is new.
  server.X.blockers = server.X.blockers!.map((b) => (b.id === 'b' ? visible('b', 'Title b', 'in_progress') : b));
  before = await deliver(issueEvent('status_changed', 'b'));
  await waitFor(() =>
    expect(sublineOf(container, 'X')?.querySelector('.epic-child-blockers-line')?.textContent).toContain(
      'b · in progress',
    ),
  );
  await assertSingleRead(before);

  // (5) The child is moved to "closed" → no sub-row.
  server.W = { ...server.W, item: { isBlocked: true, status: 'closed' } };
  before = await deliver(issueEvent('closed', 'W'));
  await waitFor(() => expect(sublineOf(container, 'W')).toBeNull());
  expect(highlighted(container, 'W')).toBe(false);
  await assertSingleRead(before);

  // (6) The server closed the hidden blocker Z, no event → "unavailable" and
  // the highlight remain; the next delivered event → they disappear.
  server.Z = { item: { isBlocked: false } };
  const quiet = fetchMock.mock.calls.length;
  await settleQueries();
  expect(fetchMock.mock.calls.length).toBe(quiet);
  expect(sublineOf(container, 'Z')?.textContent).toContain('unavailable');
  expect(highlighted(container, 'Z')).toBe(true);

  before = await deliver(issueEvent('updated', 'X', { changedFields: ['title'] }));
  await waitFor(() => expect(sublineOf(container, 'Z')).toBeNull());
  expect(highlighted(container, 'Z')).toBe(false);
  await assertSingleRead(before);
}

describe('row 31 — live update of the sub-row without reopening', () => {
  test('"List" mode', async () => {
    await runSequence('list');
  });

  test('"Tree" mode (a child at depth 2)', async () => {
    await runSequence('tree');
  });
});
