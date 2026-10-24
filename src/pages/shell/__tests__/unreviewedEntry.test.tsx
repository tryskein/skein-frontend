/**
 * sk-303.14 (T026, matrix rows 88, 89, 107, 109, 110) — the first frame
 * after the jump to the unreviewed set.
 *
 * This is the row the whole of T024 exists for, and it can only be
 * answered end-to-end: "exactly one list request, and it already carries
 * the selection" is a statement about the real chain — address →
 * `useLayoutState` → `useTaskSearchModes` → `useTasks` → the wire — in the
 * real Shell. A harness that re-implemented that wiring could pass while
 * the product sent two requests.
 *
 * Why one request is the requirement and not a nicety: the reader is
 * promised a list whose length equals the number they clicked (INV-3,
 * SC-017). A first frame built from the PREVIOUS filters is a different,
 * narrower list; the correction that follows is both a wasted round trip
 * and a visible flash of the wrong answer. The old implementation seeded
 * the lens filters in an effect — after the commit that had already
 * asked the server — so the correct list was always the SECOND one.
 *
 * The mock set mirrors `Shell.test.tsx` (auth, inbox, projects, counts)
 * plus the two things this row is actually about: the issues API, so the
 * requests can be counted and read, and the alias resolver, so the
 * project-scoped surface has a project id without a network round trip.
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

// ─────────────────────────── Mocks ───────────────────────────

const listIssuesSpy =
  vi.fn<(projectId: string, params?: ListIssuesParams) => Promise<ListIssuesResult>>();
const listAllIssuesSpy =
  vi.fn<(params?: ListAllIssuesParams) => Promise<ListAllIssuesResult>>();
const listCreatedByMeSpy =
  vi.fn<(params?: ListMineParams) => Promise<ListIssuesResult>>();
const listAssignedToMeSpy =
  vi.fn<(params?: ListMineParams) => Promise<ListIssuesResult>>();
// Under the Delegated lens WITH a project selected, a non-empty search box
// routes the column to the hybrid search endpoint instead of the list one.
// It is therefore a fifth way to produce the column's rows, and row 88
// counts REQUESTS THAT FILL THE COLUMN — not calls to one function.
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

// One real project row, so "pick a project" is a click the reader can
// actually perform in this harness rather than a navigation the test
// performs on their behalf. The sequence that loses the selection starts
// with exactly that click.
const PROJECT_ROW = {
  id: 'proj-uuid-test',
  name: 'test',
  idPrefix: 'test',
  defaultIdMode: 'hier',
  description: '',
  archivedAt: null,
  createdAt: '2026-05-01T09:00:00Z',
  updatedAt: '2026-05-01T09:00:00Z',
  openCount: 0,
  inProgressCount: 0,
  blockedCount: 0,
  standingCount: 0,
  myOutboxOpenCount: 0,
  myOutboxInProgressCount: 0,
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

vi.mock('../../../lib/useNotificationCounts', () => ({
  notificationCountsKey: ['notification-counts'] as const,
  useNotificationCounts: () => ({
    counts: {
      inbox: 0,
      mentions: 0,
      watching: 0,
      onMeOpenCount: 0,
      delegatedOpenCount: 0,
      // sk-303.14 — the two contract-C2 keys, spelled out even though
      // this suite is not about them. A mock frozen at the pre-C2 shape
      // renders no second number at all, so a green run here would say
      // nothing about whether the header reads the flag (T030). Off is
      // the right value for these cases; the flag itself is exercised in
      // unreviewedSecondNumber.test.tsx.
      reviewMechanicEnabled: false,
      delegatedUnreviewedCount: null,
    },
    isLoading: false,
    error: null,
  }),
}));

import { Shell } from '../Shell';

// ─────────────────────────── Fixtures ───────────────────────────

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

function currentUrl(): string {
  return screen.getByTestId('url').textContent ?? '';
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

function statusRow() {
  return screen.getByRole('radiogroup', { name: 'Status' });
}

function unreviewedChip() {
  return within(statusRow()).getByRole('radio', { name: /^Unreviewed/ });
}

beforeEach(() => {
  window.localStorage.clear();
  // sk-395 (portion 3) — this file was written against a panel that was
  // always open and always drew its dimensions as chips. The redesigned
  // panel starts COLLAPSED and defaults to comboboxes, so the chip rows
  // these tests reach into are not in the document at all unless both
  // preferences are stated. They are stored preferences, so stating them
  // here is the panel's own supported route, not a test-only back door —
  // and it keeps every mount below identical, including the remounts.
  window.localStorage.setItem('skein.layout.task-filters-collapsed', 'false');
  window.localStorage.setItem('skein.tasks.filtersLayout', 'chips');
  listIssuesSpy.mockReset();
  listAllIssuesSpy.mockReset();
  listCreatedByMeSpy.mockReset();
  listAssignedToMeSpy.mockReset();
  listIssuesSpy.mockResolvedValue(page([issue({ id: 'sk-1' })]));
  listAllIssuesSpy.mockResolvedValue({
    items: [],
    total: 0,
    hasMore: false,
    nextCursor: null,
  });
  listCreatedByMeSpy.mockResolvedValue(page([]));
  listAssignedToMeSpy.mockResolvedValue(page([]));
  globalSearchSpy.mockReset();
  globalSearchSpy.mockResolvedValue({
    items: [],
    nextCursor: null,
    hasMore: false,
    degraded: false,
    tookMs: 1,
  });
});

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

function clearRequestCounts(): void {
  listIssuesSpy.mockClear();
  listAllIssuesSpy.mockClear();
  listCreatedByMeSpy.mockClear();
  listAssignedToMeSpy.mockClear();
  globalSearchSpy.mockClear();
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('sk-303.14 — the first frame after the jump to the unreviewed set', () => {
  test('rows 88/89/107 — one request, already carrying the selection, from a thoroughly narrowed view', async () => {
    // Start where the defect is worst: inside the Delegated lens, scoped
    // to one project, with narrowings from FOUR different stores —
    // the lens overlay (type), the persisted prefs behind it, the
    // in-memory assignee pick, and the search box. Each of those is part
    // of the Tasks query key, so each is one more chance for the first
    // frame to be narrow and for the correction to cost a request.
    mountAt('/projects/sk?lens=delegated');
    await waitFor(() => expect(listIssuesSpy).toHaveBeenCalled());

    // Narrow by type (lens overlay).
    fireEvent.click(
      within(screen.getByRole('radiogroup', { name: 'Type' })).getByRole('radio', {
        name: 'bug',
      }),
    );
    // Narrow by assignee (in-memory pick; under Delegated the chips are
    // the people the caller delegated to, derived from the loaded rows).
    const assigneeRow = await screen.findByRole('radiogroup', { name: 'Assignee' });
    await waitFor(() =>
      expect(within(assigneeRow).getAllByRole('radio').length).toBeGreaterThan(0),
    );
    fireEvent.click(within(assigneeRow).getAllByRole('radio')[0]);
    // Narrow by text. Debounced, so wait for it to actually reach the
    // wire — and prove it did, rather than assuming. A set-up step that
    // silently no-ops turns the whole test into a tautology: the jump
    // would be "unnarrowing" a board that was never narrowed.
    const beforeTyping = columnRequests();
    fireEvent.change(screen.getByLabelText('Search tasks'), {
      target: { value: 'zzz' },
    });
    expect((screen.getByLabelText('Search tasks') as HTMLInputElement).value).toBe('zzz');
    await waitFor(() => expect(columnRequests()).toBeGreaterThan(beforeTyping), {
      timeout: 2000,
    });
    // Every narrowing is now live and visible in the controls.
    expect((screen.getByLabelText('Search tasks') as HTMLInputElement).value).toBe('zzz');
    expect(
      within(screen.getByRole('radiogroup', { name: 'Type' }))
        .getByRole('radio', { name: 'bug' })
        .getAttribute('aria-checked'),
    ).toBe('true');
    expect(
      within(screen.getByRole('radiogroup', { name: 'Assignee' }))
        .getAllByRole('radio')
        .some((b) => b.getAttribute('aria-checked') === 'true'),
    ).toBe(true);

    // Everything up to here is set-up. From this point the ONLY thing the
    // reader does is take the selection, and the only thing we count is
    // what that costs.
    clearRequestCounts();
    listCreatedByMeSpy.mockResolvedValue(page([issue({ id: 'sk-7' })]));

    fireEvent.click(unreviewedChip());

    await waitFor(() => expect(listCreatedByMeSpy).toHaveBeenCalled());
    // Give any late correction a chance to arrive before we assert there
    // was none. 400ms clears the 200ms search debounce with room to spare:
    // a narrowing that settles one beat late shows up here as a second
    // request, which is exactly the defect being ruled out.
    await new Promise((r) => setTimeout(r, 400));

    // ROW 88 — exactly one request filled the column, and it is the
    // cross-project delegated one. Not "at least one": the count IS the
    // assertion, across every endpoint that could have produced rows.
    expect(columnRequests()).toBe(1);
    expect(listCreatedByMeSpy).toHaveBeenCalledTimes(1);

    // …and it already carries the selection.
    const [params] = listCreatedByMeSpy.mock.calls[0];
    expect(params?.unreviewed).toBe(true);

    // ROW 89 — and nothing else narrows it. Every one of these would have
    // been inherited from the view we jumped out of.
    expect(params?.status).toBeUndefined();
    expect(params?.origin).toBeUndefined();
    expect(params?.isBlocked).toBeUndefined();
    expect(params?.acceptedAtNull).toBeUndefined();
    expect(params?.createdBy).toBeUndefined();

    // The address says the same thing the request does — project and
    // issue selection dropped, both parameters present.
    expect(currentUrl()).toBe('/?lens=delegated&select=unreviewed');

    // And the controls agree with the request: the type chip is released
    // and the search box is empty. A control still claiming a narrowing
    // the request does not apply is its own defect.
    expect(
      within(screen.getByRole('radiogroup', { name: 'Type' }))
        .getByRole('radio', { name: 'bug' })
        .getAttribute('aria-checked'),
    ).toBe('false');
    expect((screen.getByLabelText('Search tasks') as HTMLInputElement).value).toBe('');
  });

  test('row 107 — the jump from a NON-lens narrowed board is equally unnarrowed', async () => {
    // The other door: no lens on, the reader's own persisted preferences
    // narrowing the board. Those must not be inherited either — and they
    // must not be overwritten (that half is `lensReloadFilters`).
    window.localStorage.setItem('skein.tasks.statusFilter', 'open');
    window.localStorage.setItem('skein.tasks.typeFilter', 'bug');
    window.localStorage.setItem('skein.tasks.originFilter', 'agent-autonomous');
    window.localStorage.setItem('skein.tasks.priorityFilter', '1');

    mountAt('/projects/sk?lens=delegated');
    await waitFor(() => expect(listIssuesSpy).toHaveBeenCalled());
    clearRequestCounts();

    fireEvent.click(unreviewedChip());
    await waitFor(() => expect(listCreatedByMeSpy).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 400));

    expect(columnRequests()).toBe(1);
    const [params] = listCreatedByMeSpy.mock.calls[0];
    expect(params?.unreviewed).toBe(true);
    expect(params?.status).toBeUndefined();
    // `origin` is the one the LENS preset would have set to 'human-driven'
    // — which drops every agent-filed result and makes the row count
    // disagree with the number the reader clicked.
    expect(params?.origin).toBeUndefined();
  });

  test('the chip exists only on the Delegated surface', async () => {
    // The set is "results I delegated and have not reviewed". On a board
    // that is not the delegated one there is no such set, and the
    // endpoints behind those boards take no such parameter — so offering
    // the chip would promise a narrowing nothing can perform.
    mountAt('/projects/sk');
    await waitFor(() => expect(listIssuesSpy).toHaveBeenCalled());
    expect(
      within(statusRow()).queryByRole('radio', { name: /^Unreviewed/ }),
    ).toBeNull();

    cleanup();

    mountAt('/?lens=on-me');
    await waitFor(() => expect(listAssignedToMeSpy).toHaveBeenCalled());
    expect(
      within(statusRow()).queryByRole('radio', { name: /^Unreviewed/ }),
    ).toBeNull();
  });

  test('rows 109/110 — arriving by a stale notification link opens the same state, and an empty set is not an error', async () => {
    // A push notification names a set that may have emptied by the time it
    // is tapped. The link must open the same target state as the in-app
    // jump, and the empty result must read as "nothing left to review" —
    // not as a broken filter and not as a failure.
    listCreatedByMeSpy.mockResolvedValue(page([]));

    mountAt('/?lens=delegated&select=unreviewed');
    await waitFor(() => expect(listCreatedByMeSpy).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 400));

    // Same target state, same single request.
    expect(columnRequests()).toBe(1);
    const [params] = listCreatedByMeSpy.mock.calls[0];
    expect(params?.unreviewed).toBe(true);
    expect(params?.origin).toBeUndefined();
    // The selection is applied, and the chip shows it.
    expect(unreviewedChip().getAttribute('aria-checked')).toBe('true');

    // The empty state speaks the vocabulary of the set…
    const empty = await screen.findByText(/Nothing unreviewed/);
    // …and is not dressed as a failure. `col-error` is what this column
    // uses to say something went wrong; an emptied set did not.
    expect(empty.className).not.toContain('col-error');
    expect(screen.queryByText('Failed to load tasks')).toBeNull();
  });

  test('C1 — jump, pick a project, start typing: the selection is released, not silently ignored', async () => {
    // The sequence is three ordinary gestures, and the third one used to
    // break the promise the chip makes. Taking the selection lands on all
    // projects; picking a project carries the parameter along (by design —
    // the project-scoped half applies the same selection); typing then
    // routes the column to the hybrid search endpoint, which takes no
    // `unreviewed` parameter at all. The rows stopped being the unreviewed
    // set while the chip went on saying they were.
    //
    // The contract now is that the two are mutually exclusive and that the
    // reader is TOLD: typing releases the selection, chip and address
    // together. The assertion below is that the state is honest, not that
    // some particular request was made — a version that quietly kept the
    // chip pressed and sent a search anyway would fail on the chip, and a
    // version that kept the chip pressed and sent `unreviewed` to an
    // endpoint that ignores it would fail on the address.
    mountAt('/?lens=delegated');
    await waitFor(() => expect(listCreatedByMeSpy).toHaveBeenCalled());

    // 1 — take the selection.
    fireEvent.click(unreviewedChip());
    await waitFor(() =>
      expect(currentUrl()).toBe('/?lens=delegated&select=unreviewed'),
    );
    expect(unreviewedChip().getAttribute('aria-checked')).toBe('true');

    // 2 — pick a project. The selection survives, and that is the point:
    // this is the surface where the search path loses it.
    fireEvent.click(screen.getByRole('button', { name: 'Select project test' }));
    await waitFor(() =>
      expect(currentUrl()).toBe('/projects/test?lens=delegated&select=unreviewed'),
    );
    expect(unreviewedChip().getAttribute('aria-checked')).toBe('true');
    await waitFor(() => expect(listIssuesSpy).toHaveBeenCalled());
    // Pre-condition made checkable rather than assumed: the project-scoped
    // request really does carry the selection at this point. Without this,
    // a build where the selection never reached step 2 would still pass the
    // assertions below — by having nothing left to release.
    expect(listIssuesSpy.mock.calls.at(-1)![1]?.unreviewed).toBe(true);
    clearRequestCounts();

    // 3 — type.
    fireEvent.change(screen.getByLabelText('Search tasks'), {
      target: { value: 'zzz' },
    });

    // Released — in the address…
    await waitFor(() => expect(currentUrl()).toBe('/projects/test?lens=delegated'));
    // …and on the control the reader is looking at.
    expect(unreviewedChip().getAttribute('aria-checked')).toBe('false');
    // The box kept what was typed: the selection gave way to the search,
    // not the other way round.
    expect((screen.getByLabelText('Search tasks') as HTMLInputElement).value).toBe(
      'zzz',
    );

    // And once the search has actually reached the wire, nothing claims a
    // selection any more: the search endpoint cannot carry one, and no list
    // request went out behind it still asking for the unreviewed set.
    await waitFor(() => expect(globalSearchSpy).toHaveBeenCalled(), {
      timeout: 2000,
    });
    expect(
      listIssuesSpy.mock.calls.every(([, params]) => params?.unreviewed !== true),
    ).toBe(true);
    expect(
      listCreatedByMeSpy.mock.calls.every((call) => call[0]?.unreviewed !== true),
    ).toBe(true);
    // The chip is still OFFERED — the surface is still Delegated. Only the
    // claim was withdrawn, and pressing it again is a live gesture (the
    // entry clears the box, so the two never collide from that direction).
    expect(unreviewedChip()).toBeTruthy();
  });

  test('typing is still debounced — a burst of keystrokes is one request', async () => {
    // B/1 review W3. `TasksColumn` line "debouncedSearch" is the line this
    // wave edited: clearing the box stopped being debounced so the entry's
    // in-render clear could land in the same frame as everything else. The
    // author checked the mutation in one direction (put the debounce back
    // on the CLEAR → two requests). The other direction — drop the debounce
    // entirely, `debouncedSearch = ui.search`, a request per keystroke —
    // left the whole suite green, because nothing anywhere asserted the
    // guarantee the delay exists for.
    //
    // It belongs here rather than beside the ordinary search tests because
    // this file is the one that counts EVERY request that can fill the
    // column, which is what "one request" has to mean.
    mountAt('/projects/test');
    await waitFor(() => expect(listIssuesSpy).toHaveBeenCalled());
    clearRequestCounts();

    const box = screen.getByLabelText('Search tasks');
    for (const term of ['a', 'au', 'aut', 'auth']) {
      fireEvent.change(box, { target: { value: term } });
    }

    // Wait past the 200ms window with room to spare, then count. A
    // per-keystroke implementation has fired four times by now.
    await waitFor(() => expect(globalSearchSpy).toHaveBeenCalled(), {
      timeout: 2000,
    });
    await new Promise((r) => setTimeout(r, 400));

    expect(columnRequests()).toBe(1);
    // …and the one request carries what the reader finished typing, not the
    // first letter of it.
    expect(globalSearchSpy.mock.calls[0][0].q).toBe('auth');
  });

  test('picking another status leaves the selection — one axis, one chip pressed', async () => {
    // The selection occupies the status axis, so leaving it is the same
    // gesture as changing any status: pick a different chip. That is also
    // what keeps the sentinel out of the stores — the value that lands in
    // the filter overlay is the real one the reader picked.
    mountAt('/?lens=delegated&select=unreviewed');
    await waitFor(() => expect(listCreatedByMeSpy).toHaveBeenCalled());
    listCreatedByMeSpy.mockClear();

    fireEvent.click(within(statusRow()).getByRole('radio', { name: 'All' }));
    await waitFor(() => expect(listCreatedByMeSpy).toHaveBeenCalled());

    const [params] = listCreatedByMeSpy.mock.calls.at(-1)!;
    expect(params?.unreviewed).toBeUndefined();
    // 'all' on the wire is "no status param" plus the closed rows asked
    // for explicitly.
    expect(params?.status).toBeUndefined();
    expect(params?.includeClosed).toBe(true);
    // The parameter left the address with the selection.
    expect(currentUrl()).toBe('/?lens=delegated');
    expect(unreviewedChip().getAttribute('aria-checked')).toBe('false');
  });
});
