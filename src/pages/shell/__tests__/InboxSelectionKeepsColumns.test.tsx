/**
 * sk-405, requirement 2 — "When selecting a task from the list there is no need to close
 * the projects and list blocks. Just open the task in the block and highlight
 * it in the list if it is there".
 *
 * ── What it replaces ───────────────────────────────────────────────
 *
 * Clicking a card in the Queues column used to navigate with
 * `location.state.fromInbox = true`; `Shell` read that flag and stopped
 * RENDERING the Projects and Tasks columns (`inboxOverlay` — the
 * columns were conditionally mounted, so this was never merely a
 * `display: none`). The reading pane got the whole row and the two
 * navigation zones vanished for as long as the flag survived.
 *
 * ── Why the budget does not forbid the change ──────────────────────
 *
 * The obvious objection is width: `sk-285.7.14` narrowed the tree's
 * column budget and warned that the floor is tight. Measured in
 * Chromium at the floor (`--app-min-width` 1284) BEFORE any selection,
 * with the default persisted widths:
 *
 *   .col-inbox     3…267    264
 *   .col-projects  267…567  300
 *   .col-tasks     567…1035 468
 *   .col-details   1035…1281 246
 *   document.scrollWidth − clientWidth = 0   (no horizontal overflow)
 *
 * Four zones at 1284 are not a NEW state that has to be made to fit:
 * they are what the shell already draws when nothing is selected.
 * Selecting an issue puts content into the Details column that was
 * already there at its already-measured 246px. So nothing is being
 * squeezed, and there is no threshold to introduce (the way sk-404.2
 * had to introduce `VIEW_LABELS_MIN_PX` for a control that genuinely
 * did not fit). The overlay was a reading-comfort choice, not a
 * fitting constraint — and the owner has now chosen otherwise.
 *
 * ── The three width modes ──────────────────────────────────────────
 *
 * DESKTOP is the case the owner is looking at: click a card, the two
 * middle columns stay, the card is marked selected.
 *
 * TABLET (768 ≤ w < 1284) reaches the same end state by a different
 * road: both navigation zones are ALREADY slivers there (T020), so the
 * Queues list has no cards to click. What the rule says at that width
 * is that arriving at an issue address does not remove the zones — they
 * stay as the slivers the mode makes them.
 *
 * MOBILE never had the overlay in the first place (`inboxOverlay` was
 * `!mobileZones && …`): the description is a full-screen sheet over
 * whichever zone the tab strip is on, and all three zones stay mounted
 * so their scroll and their in-flight queries survive. The rule is
 * satisfied there by the mechanism that was already in place, and this
 * file pins that it stays that way.
 *
 * ── The issue that is NOT in the list ──────────────────────────────
 *
 * DECISION, recorded rather than left to chance: the Tasks column is
 * not re-filtered, re-scoped or scrolled to make room for the opened
 * issue. Its rows come from the address (project / component / lens /
 * filters), the highlight is `selectedIssueId === item.id`, and an
 * issue outside that selection simply has no row to mark. The
 * alternative — widening or clearing the user's own filters so the
 * issue appears — would answer "highlight it in the list IF IT IS
 * THERE" by changing what is there, which is the opposite of what the
 * sentence asks. Nothing else moves either: no toast, no scroll jump.
 * The last test in this file is that promise, stated as a test.
 */

import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { setViewportWidth } from '../../../test/viewport';

// ─────────────────────────── Mocks ───────────────────────────
//
// Same shape as `Shell.test.tsx`: the data hooks are stubbed so the
// REAL layout components render against deterministic rows. The only
// addition is `useTasks`, because this file has to say something about
// the Tasks list itself (that the opened issue is highlighted in it),
// and a column with no rows could not carry that claim.

vi.mock('../../../auth/AuthContext', () => ({
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

const ISSUE = {
  id: 'sk-1',
  projectId: 'p1',
  parentIdCurrent: null,
  version: 1,
  title: 'Sample inbox issue',
  type: 'task',
  priority: 3,
  status: 'open',
  pinned: false,
  componentIds: [],
  labels: [],
  updatedAt: '2026-05-01T10:00:00Z',
  createdAt: '2026-05-01T09:00:00Z',
};

vi.mock('../../../lib/useInbox', () => ({
  inboxQueryKey: ['inbox', 'assigned-to-me-unaccepted-open'] as const,
  useInbox: () => ({
    data: { items: [ISSUE], hasMore: false, nextCursor: null },
    isLoading: false,
    isError: false,
    isSuccess: true,
    error: null,
  }),
}));

vi.mock('../../../lib/useProjectsList', () => ({
  projectsListQueryKey: ['projects', 'list', 'shell'] as const,
  useProjectsList: () => ({
    data: { items: [], total: 0, hasMore: false, nextCursor: null },
    isLoading: false,
    isError: false,
    isSuccess: true,
    error: null,
  }),
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

vi.mock('../../../lib/useNotificationCounts', () => ({
  notificationCountsKey: ['notification-counts'] as const,
  useNotificationCounts: () => ({
    counts: {
      inbox: 0,
      mentions: 0,
      watching: 0,
      onMeOpenCount: 0,
      delegatedOpenCount: 0,
      reviewMechanicEnabled: false,
      delegatedUnreviewedCount: null,
    },
    isLoading: false,
    error: null,
  }),
}));

/**
 * The Tasks list. `tasksRows` is a mutable handle so one test can hand
 * the column a list CONTAINING the opened issue and another a list that
 * does not — which is the pair the "if it is there" clause is about.
 */
let tasksRows: Array<typeof ISSUE> = [ISSUE];

vi.mock('../../../lib/useTasks', () => ({
  tasksQueryKey: ['tasks'] as const,
  useTasks: () => ({
    data: tasksRows,
    total: tasksRows.length,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: () => {},
    isLoading: false,
    error: null,
    emptyReason: null,
    searchDegraded: false,
    searchMode: false,
    totalIsExact: true,
    resolvedProjectId: 'p1',
    delegateeAssignees: [],
    loadedAssignees: [],
    cacheKey: ['tasks'] as const,
  }),
}));

import { Shell } from '../Shell';

function Wrapper({
  children,
  path = '/',
  state,
}: {
  children: ReactNode;
  path?: string;
  state?: unknown;
}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const entry = state === undefined ? path : { pathname: path, state };
  // The shell's selection comes out of `useParams()`, so the routes have
  // to be REAL here: rendering `<Shell/>` as a bare child of the router
  // (what `Shell.test.tsx` does, because it only ever asked about
  // `location.state`) leaves `useParams()` empty at every address, and
  // «the opened issue is selected» would be untestable — it would read
  // as "nothing is ever selected" and pass a weaker claim silently.
  // Mirrors `App.tsx`'s four shell mounts.
  return (
    <MantineProvider forceColorScheme="dark">
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route path="/" element={children} />
            <Route path="/issues/:id" element={children} />
            <Route path="/projects/:alias" element={children} />
            <Route path="/projects/:alias/issues/:id" element={children} />
            <Route path="/projects/:alias/components/:cid" element={children} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>
  );
}

/**
 * Click the card body of the one queue row this file seeds.
 *
 * Scoped to the Queues column on purpose: the same issue is also a row
 * in the Tasks list here (that is the point of the highlight test), and
 * both rows carry an "Open issue sk-1 …" accessible name. An unscoped
 * query would resolve to two elements and fail for a reason that has
 * nothing to do with the rule.
 */
function openTheQueueCard(container: HTMLElement): void {
  const column = container.querySelector('.col-inbox');
  if (!(column instanceof HTMLElement)) throw new Error('the Queues column is not rendered');
  fireEvent.click(within(column).getByRole('button', { name: /Open issue sk-1/i }));
}

beforeEach(() => {
  tasksRows = [ISSUE];
  window.localStorage.clear();
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('sk-405 — opening a queue card leaves Projects and Tasks standing', () => {
  test('desktop: after the click both middle columns are still rendered', () => {
    const { container } = render(
      <Wrapper>
        <Shell />
      </Wrapper>,
    );
    // Before: the four-zone shell.
    expect(container.querySelector('.col-projects')).not.toBeNull();
    expect(container.querySelector('.col-tasks')).not.toBeNull();

    openTheQueueCard(container);

    // After: the SAME four zones. `.col-*` rather than the header text
    // because the defect removed the elements, not the words.
    expect(container.querySelector('.col-inbox')).not.toBeNull();
    expect(container.querySelector('.col-projects')).not.toBeNull();
    expect(container.querySelector('.col-tasks')).not.toBeNull();
    expect(container.querySelector('.col-details')).not.toBeNull();
  });

  test('desktop: the opened card is marked selected in the queue it was clicked in', () => {
    const { container } = render(
      <Wrapper>
        <Shell />
      </Wrapper>,
    );
    expect(container.querySelector('.inbox-card.selected')).toBeNull();

    openTheQueueCard(container);

    const selected = container.querySelector('.inbox-card.selected');
    expect(selected).not.toBeNull();
    expect(selected?.textContent).toContain('Sample inbox issue');
  });

  test('desktop: the opened issue is highlighted in the Tasks list when it is in it', () => {
    const { container } = render(
      <Wrapper>
        <Shell />
      </Wrapper>,
    );
    openTheQueueCard(container);

    const selected = container.querySelector('.task-card.selected');
    expect(selected).not.toBeNull();
    expect(selected?.textContent).toContain('Sample inbox issue');
  });

  test('desktop: an issue outside the current selection leaves the Tasks list untouched', () => {
    // The recorded decision: no re-filtering to make it appear. The list
    // keeps exactly the rows the address asked for, and none of them is
    // marked — "if it is there" is a condition, not an instruction to
    // put it there.
    tasksRows = [{ ...ISSUE, id: 'sk-99', title: 'Some other task' }];
    const { container } = render(
      <Wrapper>
        <Shell />
      </Wrapper>,
    );
    openTheQueueCard(container);

    expect(container.querySelector('.col-tasks')).not.toBeNull();
    expect(container.querySelectorAll('.task-card')).toHaveLength(1);
    expect(container.querySelector('.task-card')?.textContent).toContain('Some other task');
    expect(container.querySelector('.task-card.selected')).toBeNull();
    // …and the queue still marks it, so the user is not left with no
    // indication of what is open.
    expect(container.querySelector('.inbox-card.selected')).not.toBeNull();
  });

  test('the removed nav-state flag no longer hides anything', () => {
    // `fromInbox` was the whole mechanism. Planting it by hand must now
    // be inert: this is the mutation-proof assertion — restore the read
    // in Shell.tsx and this is the test that turns red.
    const { container } = render(
      <Wrapper path="/projects/sk/issues/sk-1" state={{ fromInbox: true }}>
        <Shell />
      </Wrapper>,
    );
    expect(container.querySelector('.col-projects')).not.toBeNull();
    expect(container.querySelector('.col-tasks')).not.toBeNull();
  });

  test('the shared-file split (sk-41) still folds the two columns', () => {
    // The other producer of the same layout modifier is untouched: a
    // shared `?file=` link still gets card + viewer across the row. If
    // this went green-by-accident the change would have removed a
    // neighbouring feature instead of the one the owner named.
    const { container } = render(
      <Wrapper path="/projects/sk/issues/sk-1?file=att-x">
        <Shell />
      </Wrapper>,
    );
    expect(container.querySelector('.col-projects')).toBeNull();
    expect(container.querySelector('.col-tasks')).toBeNull();
  });
});

describe('sk-405 — the same rule in the other two width modes', () => {
  test('tablet: the zones stay on an issue address, as slivers', () => {
    setViewportWidth(1024);
    const { container } = render(
      <Wrapper path="/projects/sk/issues/sk-1">
        <Shell />
      </Wrapper>,
    );
    // Both navigation zones are present — in their tablet form. Neither
    // is gone, which is the property this task is about.
    expect(container.querySelector('.col-inbox-collapsed')).not.toBeNull();
    expect(container.querySelector('.col-projects-collapsed')).not.toBeNull();
    expect(container.querySelector('.col-tasks')).not.toBeNull();
  });

  test('mobile: all three zones stay mounted with an issue open', () => {
    setViewportWidth(390);
    const { container } = render(
      <Wrapper path="/projects/sk/issues/sk-1">
        <Shell />
      </Wrapper>,
    );
    // The phone shows one zone at a time via `data-active-zone`, but it
    // never unmounts the others — the sheet opens ON TOP. A slice of the
    // shell that dropped Projects/Tasks here would break the zone strip's
    // counters as well as this rule.
    expect(container.querySelector('.col-inbox')).not.toBeNull();
    expect(container.querySelector('.col-projects')).not.toBeNull();
    expect(container.querySelector('.col-tasks')).not.toBeNull();
    expect(container.querySelector('.zone-tabs')).not.toBeNull();
  });
});
