/**
 * sk-303.14 (T030, matrix rows 94, 95, 96, 103, 119) — the SECOND number on
 * the Delegated control, and the entry into the set it counts.
 *
 * sk-404.3 — the one-action JUMP that used to stand beside the toggle is
 * gone on the maintainers' word, so the rows that drove it now drive the entry
 * that survived it: the «Unreviewed» chip on the status axis. Nothing was
 * deleted with the button — rows 119 and 95 are statements about WHERE the
 * entry lands and HOW LONG the first list is, and both are properties of
 * the entry channel rather than of the control that used to open it. The
 * two assertions that were about the button ITSELF (that it disappears
 * with the mechanic, and that it stands outside the toggle) went with the
 * button, and their replacement is `HeaderRailNoUnreviewedJump.test.tsx`.
 *
 * Driven through the real Shell rather than through HeaderBar alone, because
 * three of the five rows are statements about the whole surface and cannot be
 * made anywhere smaller:
 *
 *   - row 95 wants the LIST the jump produces to be as long as the number the
 *     reader clicked, which needs the header, the address, `useLayoutState`,
 *     `useTasks` and the wire in one place;
 *   - row 96 wants the number to be ABSENT from the project / component tree
 *     and from the Tasks column, which is only observable where those columns
 *     exist;
 *   - row 119 wants the address the entry lands on to be the address the
 *     server's digest encodes, which is a property of the navigation, not of
 *     the control that starts it.
 *
 * The counts mock is MUTABLE and carries the two contract-C2 keys. That is
 * deliberate and it is the point of the row-94 cases: a mock frozen at the
 * pre-C2 shape renders no second number at all, so a suite built on one would
 * be green against an implementation that never reads the flag.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type {
  IssueSummary,
  ListIssuesParams,
  ListIssuesResult,
  ListMineParams,
  ListAllIssuesParams,
  ListAllIssuesResult,
} from '../../../api/issues';
import type { SearchParams, SearchResponse } from '../../../api/search';
import type { NotificationCounts } from '../../../api/notification-counts';
import type { Component } from '../../../api/components';

// ─────────────────────────── Mocks ───────────────────────────

const listIssuesSpy =
  vi.fn<(projectId: string, params?: ListIssuesParams) => Promise<ListIssuesResult>>();
const listAllIssuesSpy =
  vi.fn<(params?: ListAllIssuesParams) => Promise<ListAllIssuesResult>>();
const listCreatedByMeSpy = vi.fn<(params?: ListMineParams) => Promise<ListIssuesResult>>();
const listAssignedToMeSpy = vi.fn<(params?: ListMineParams) => Promise<ListIssuesResult>>();
const globalSearchSpy = vi.fn<(params: SearchParams) => Promise<SearchResponse>>();

vi.mock('../../../api/issues', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/issues')>();
  return {
    ...actual,
    listIssues: (...args: [string, ListIssuesParams?]) => listIssuesSpy(...args),
    listAllIssues: (...args: [ListAllIssuesParams?]) => listAllIssuesSpy(...args),
    listCreatedByMe: (...args: [ListMineParams?]) => listCreatedByMeSpy(...args),
    listAssignedToMe: (...args: [ListMineParams?]) => listAssignedToMeSpy(...args),
  };
});

vi.mock('../../../api/search', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/search')>();
  return {
    ...actual,
    globalSearch: (...args: [SearchParams]) => globalSearchSpy(...args),
  };
});

// One component under the one project, so row 96's "component tree rows"
// half has a real row to look at rather than an empty container.
const COMPONENT_ROW: Component = {
  id: 'comp-uuid-1',
  projectId: 'proj-uuid-test',
  name: 'api',
  description: '',
  archivedAt: null,
  createdAt: '2026-05-01T09:00:00Z',
  updatedAt: '2026-05-01T09:00:00Z',
  openCount: 1,
  inProgressCount: 2,
  blockedCount: 0,
  standingCount: 0,
  myOutboxOpenCount: 1,
  myOutboxInProgressCount: 2,
  myOutboxBlockedCount: 0,
  myOutboxStandingCount: 0,
} as unknown as Component;

vi.mock('../../../api/components', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/components')>();
  return { ...actual, listComponents: () => Promise.resolve([COMPONENT_ROW]) };
});

vi.mock('../../../lib/useProjectByHandle', () => ({
  useProjectByHandle: (handle: string | null) =>
    handle === null
      ? { project: null, isLoading: false, isUnresolved: false }
      : {
          project: { id: 'proj-uuid-test', idPrefix: handle, name: 'test' },
          isLoading: false,
          isUnresolved: false,
        },
}));

vi.mock('../../../auth/AuthContext', () => ({
  // sk-551.8 — LayoutProvider reads the layout via useNavLayoutOptional;
  // null = no session known, the side-by-side layout.
  useAuthOptional: () => null,
  useAuth: () => ({
    user: {
      id: 'u-1',
      email: 'admin@test.com',
      username: 'admin',
      name: 'Admin',
      role: 'admin',
      createdAt: null,
      lastLoginAt: null,
    },
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

vi.mock('../../../lib/useInbox', () => ({
  inboxQueryKey: ['inbox', 'assigned-to-me-unaccepted-open'] as const,
  useInbox: () => ({
    data: { items: [], hasMore: false, nextCursor: null },
    isLoading: false,
    isError: false,
    isSuccess: true,
    error: null,
  }),
}));

/**
 * Project row counts are 1 open / 2 in progress. Every number in this fixture
 * is deliberately NOT the second number used by row 96 (7), so a stray "7"
 * found inside the projects column can only have come from the counts hook.
 */
const PROJECT_ROW = {
  id: 'proj-uuid-test',
  name: 'test',
  idPrefix: 'test',
  defaultIdMode: 'hier',
  description: '',
  archivedAt: null,
  createdAt: '2026-05-01T09:00:00Z',
  updatedAt: '2026-05-01T09:00:00Z',
  openCount: 1,
  inProgressCount: 2,
  blockedCount: 0,
  standingCount: 0,
  myOutboxOpenCount: 1,
  myOutboxInProgressCount: 2,
  myOutboxBlockedCount: 0,
  myOutboxStandingCount: 0,
};

vi.mock('../../../lib/useProjectsList', () => ({
  projectsListQueryKey: ['projects', 'list', 'shell'] as const,
  useProjectsList: () => ({
    data: { items: [PROJECT_ROW], total: 1, hasMore: false, nextCursor: null },
    isLoading: false,
    isError: false,
    isSuccess: true,
    error: null,
  }),
  useProjectsInfinite: () => ({
    items: [PROJECT_ROW],
    total: 1,
    isLoading: false,
    isFetching: false,
    isFetchingNextPage: false,
    isError: false,
    hasNextPage: false,
    fetchNextPage: () => {},
  }),
}));

let mockCounts: NotificationCounts;
vi.mock('../../../lib/useNotificationCounts', () => ({
  notificationCountsKey: ['notification-counts'] as const,
  useNotificationCounts: () => ({
    counts: mockCounts,
    isLoading: false,
    error: null,
  }),
}));

import { Shell } from '../Shell';
import { UNREVIEWED_DIGEST_ROUTE } from '../../../lib/shellUrlState';

// ─────────────────────────── Fixtures ───────────────────────────

function counts(over: Partial<NotificationCounts> = {}): NotificationCounts {
  return {
    inbox: 0,
    mentions: 0,
    watching: 0,
    onMeOpenCount: 0,
    delegatedOpenCount: 6,
    reviewMechanicEnabled: false,
    delegatedUnreviewedCount: null,
    ...over,
  };
}

function issue(over: Partial<IssueSummary> & { id: string }): IssueSummary {
  return {
    projectId: 'proj-uuid-test',
    version: 1,
    title: `title ${over.id}`,
    type: 'task',
    priority: 2,
    status: 'closed',
    pinned: false,
    assignee: 'bob',
    componentIds: [],
    labels: [],
    isBlocked: false,
    parentIdCurrent: null,
    updatedAt: '2026-05-01T10:00:00Z',
    createdAt: '2026-05-01T09:00:00Z',
    ...over,
  } as IssueSummary;
}

function page(items: IssueSummary[]): ListIssuesResult {
  return { items, total: items.length, hasMore: false, nextCursor: null };
}

function Url() {
  const loc = useLocation();
  return <span data-testid="url">{`${loc.pathname}${loc.search}`}</span>;
}

function mountAt(entry: string) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const element = (
    <>
      <Url />
      <Shell />
    </>
  );
  return render(
    <MantineProvider forceColorScheme="dark">
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route path="/" element={element} />
            <Route path="/projects/:alias" element={element} />
            <Route path="/projects/:alias/issues/:id" element={element} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

/** Every request that can fill the Tasks column, counted as one number. */
function columnRequests(): number {
  return (
    listIssuesSpy.mock.calls.length
    + listAllIssuesSpy.mock.calls.length
    + listCreatedByMeSpy.mock.calls.length
    + listAssignedToMeSpy.mock.calls.length
    + globalSearchSpy.mock.calls.length
  );
}

function taskRows(): HTMLElement[] {
  return screen.queryAllByRole('button', { name: /^Open issue / });
}

/**
 * The entry into the unreviewed set: the «Unreviewed» value on the status
 * axis of the filters panel. sk-404.3 made this the only one-action route —
 * see the file docblock.
 *
 * The chip is drawn only inside the Delegated lens (`showUnreviewedChip=
 * outboxMode`), which is why the two rows that use it mount with
 * `?lens=delegated`. That is not a weaker starting point than the jump's:
 * the lens is ALSO project-scoped at that address, so the claims below —
 * the project is dropped, the list is exactly as long as the number — are
 * still statements about an entry that has something to undo.
 */
function unreviewedChip(): HTMLElement {
  const status = screen.getByRole('radiogroup', { name: 'Status' });
  return within(status).getByRole('radio', { name: /^Unreviewed/ });
}

/** Address as a comparable shape — parameter ORDER is not part of the state. */
function addressShape(raw: string): { pathname: string; params: string[] } {
  const [pathname, search = ''] = raw.split('?');
  const params = Array.from(new URLSearchParams(search).entries())
    .map(([k, v]) => `${k}=${v}`)
    .sort();
  return { pathname, params };
}

beforeEach(() => {
  window.localStorage.clear();
  // sk-404.3 — the entry the jump-driven rows moved onto is a CHIP in the
  // filters panel, and the redesigned panel starts collapsed and defaults
  // to comboboxes. Both are stored preferences, so stating them here is
  // the panel's own supported route rather than a test-only back door —
  // and it keeps every mount in the file identical.
  window.localStorage.setItem('skein.layout.task-filters-collapsed', 'false');
  window.localStorage.setItem('skein.tasks.filtersLayout', 'chips');
  mockCounts = counts();
  listIssuesSpy.mockReset();
  listAllIssuesSpy.mockReset();
  listCreatedByMeSpy.mockReset();
  listAssignedToMeSpy.mockReset();
  globalSearchSpy.mockReset();
  listIssuesSpy.mockResolvedValue(page([issue({ id: 'sk-1' })]));
  listAllIssuesSpy.mockResolvedValue({
    items: [],
    total: 0,
    hasMore: false,
    nextCursor: null,
  });
  listCreatedByMeSpy.mockResolvedValue(page([]));
  listAssignedToMeSpy.mockResolvedValue(page([]));
  globalSearchSpy.mockResolvedValue({
    items: [],
    nextCursor: null,
    hasMore: false,
    degraded: false,
    tookMs: 1,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/*
 * sk-411 — rows 94, 103 and 96 stood here and were REMOVED WITH THEIR
 * SUBJECT, not deleted for being inconvenient: the maintainers took the second
 * number off the Delegated control ("Delegated 2 numbers, remove
 * this yourself"), so "shown or hidden by the explicit flag", "the tooltip names
 * both differences» and «the number is confined to the Delegated control»
 * are all questions about an element that no longer exists.
 *
 * What the removal did NOT touch is below, and that is the point of
 * keeping this file rather than dropping it: rows 119 and 95 are about
 * the unreviewed SELECTION — the «Unreviewed» chip on the status axis,
 * the route it opens and the length of the list it returns. That surface
 * survives, so its guards do.
 *
 * The inverse claim — one number on the control, mechanic on — lives in
 * `HeaderRailNoUnreviewedJump.test.tsx`, beside the other assertion about
 * what that rail no longer draws.
 */

// ────────────── rows 119 + 95 — the entry and its first frame ──────────────

describe('rows 119 + 95 — where the entry lands, and how long the list is', () => {
  test('row 119 — taking the selection opens the state the digest encodes in its route', async () => {
    mockCounts = counts({
      reviewMechanicEnabled: true,
      delegatedUnreviewedCount: 3,
    });
    mountAt('/projects/test?lens=delegated');
    await waitFor(() => expect(columnRequests()).toBeGreaterThan(0));

    listCreatedByMeSpy.mockResolvedValue(
      page([issue({ id: 'sk-1' }), issue({ id: 'sk-2' }), issue({ id: 'sk-3' })]),
    );
    fireEvent.click(unreviewedChip());
    await waitFor(() => expect(listCreatedByMeSpy).toHaveBeenCalled());

    // The two sides of this comparison are produced independently: the app
    // composed its address out of the lens/select parameter machinery, and
    // UNREVIEWED_DIGEST_ROUTE is transcribed from the server's digest.go.
    // Nothing in the app navigates BY that constant, so this is a real
    // agreement between two producers rather than a restatement.
    expect(addressShape(screen.getByTestId('url').textContent ?? '')).toEqual(
      addressShape(UNREVIEWED_DIGEST_ROUTE),
    );
  });

  test('row 95 — the first frame holds exactly as many rows as the number', async () => {
    mockCounts = counts({
      reviewMechanicEnabled: true,
      delegatedUnreviewedCount: 3,
    });
    mountAt('/projects/test?lens=delegated');
    await waitFor(() => expect(columnRequests()).toBeGreaterThan(0));

    // Everything up to here is set-up; from here the reader does one thing.
    listIssuesSpy.mockClear();
    listAllIssuesSpy.mockClear();
    listCreatedByMeSpy.mockClear();
    listAssignedToMeSpy.mockClear();
    globalSearchSpy.mockClear();
    listCreatedByMeSpy.mockResolvedValue(
      page([issue({ id: 'sk-1' }), issue({ id: 'sk-2' }), issue({ id: 'sk-3' })]),
    );

    fireEvent.click(unreviewedChip());
    await waitFor(() => expect(taskRows().length).toBe(3));

    // Let a late correction arrive before ruling one out — 400ms clears the
    // 200ms search debounce with room. This is what makes "first frame" a
    // claim rather than a hope: with EXACTLY ONE request there is only one
    // result set, so no frame can have shown a different non-zero list.
    await new Promise((r) => setTimeout(r, 400));
    expect(columnRequests()).toBe(1);
    expect(listCreatedByMeSpy.mock.calls[0][0]?.unreviewed).toBe(true);

    // The length of the list the reader is looking at equals the number
    // they clicked (INV-3, SC-017).
    const shown = taskRows().length;
    expect(shown).toBe(3);
    expect(shown).toBe(mockCounts.delegatedUnreviewedCount);
  });
});
