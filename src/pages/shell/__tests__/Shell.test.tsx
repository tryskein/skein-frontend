/**
 * F7 integration smoke test for the new 4-column Shell.
 *
 * Strategy: mock the data hooks (`useInbox`, `useProjectsList`,
 * `useNotificationCounts`) at the module level so the test renders the
 * real layout components but with deterministic, empty data. This is
 * faster and far less brittle than spinning up MSW + real fetches; we
 * already have dedicated unit tests for the API clients.
 *
 * `useAuth` is mocked to return a fixed user so HeaderBar renders the
 * username area without going through AuthProvider's me-query.
 *
 * We assert the *structural* surfaces only — column headers + the
 * details empty-state. Pixel-level layout (CSS grid widths, animations)
 * is out of scope.
 */

import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ─────────────────────────── Mocks ───────────────────────────

// HeaderBar's only non-layout dependency. Returns a stable user so the
// "username · Logout" affordance renders.
vi.mock('../../../auth/AuthContext', () => ({
  // sk-285.7 T013: the shell mounts `useTheme`, which asks who is signed
  // in before writing a migrated theme back. Nothing here is on a custom
  // theme, so `null` keeps this suite about layout.
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

// Inbox / projects / counts — return empty/zero data so the columns
// render their headers + empty states without hitting the network.
//
// IMPORTANT: an *empty* inbox triggers the auto-collapse useEffect
// (Q32). To exercise the standard 4-column layout we seed one item so
// the column stays expanded — that way the "Inbox" header text in
// `.col-header` is visible. The collapsed sliver also contains the
// word "Inbox", so the assertion would still pass either way; this
// just keeps the test exercising the real layout path.
vi.mock('../../../lib/useInbox', () => ({
  inboxQueryKey: ['inbox', 'assigned-to-me-unaccepted-open'] as const,
  useInbox: () => ({
    data: {
      items: [
        {
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
        },
      ],
      hasMore: false,
      nextCursor: null,
    },
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

// Defer importing Shell until after the mocks are registered above.
// (Vitest hoists vi.mock to the top of the file, but this static-import
// ordering keeps the linter happy and the intent obvious.)
import { Shell } from '../Shell';

// ─────────────────────────── Wrapper ───────────────────────────

function Wrapper({
  children,
  path = '/',
  state,
}: {
  children: ReactNode;
  path?: string;
  /** Optional location.state — used to flip Shell into inbox-overlay mode. */
  state?: unknown;
}) {
  // Fresh QueryClient per test — even though mocks intercept every fetch,
  // the AuthProvider isn't mounted here so there's nothing else to leak.
  // retry:false keeps any unmocked code path from blocking on retries.
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  // MemoryRouter's `initialEntries` accepts either a path string or a
  // location-object; the latter lets us seed `state` for routes whose
  // behavior depends on it (Shell's inbox-overlay detection).
  const entry = state === undefined ? path : { pathname: path, state };
  return (
    <MantineProvider forceColorScheme="dark">
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[entry]}>{children}</MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('Shell — 4-column layout structure', () => {
  test('renders the HeaderBar logo', () => {
    render(
      <Wrapper>
        <Shell />
      </Wrapper>,
    );
    // The logo is "SKEIN" rendered with decorative ░▒▓ wings. The
    // visible text is the wings + brand; the accessible name comes
    // from the Link's aria-label so screen readers hear "Skein".
    expect(screen.getByRole('link', { name: /Skein/i })).toBeTruthy();
  });

  test('renders the username affordance from useAuth', () => {
    render(
      <Wrapper>
        <Shell />
      </Wrapper>,
    );
    // sk-285.1.18.5 — user · Logout lives in the account menu behind the
    // avatar (the hamburger is gone). Open the menu, then assert the same
    // affordance.
    expect(screen.queryByRole('button', { name: /Log out/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Account menu — admin' }));
    expect(screen.getByText('admin')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Log out/i })).toBeTruthy();
  });

  test('renders all four header notification badges', () => {
    render(
      <Wrapper>
        <Shell />
      </Wrapper>,
    );
    // Badges have aria-label="<Label> <count>" — useNotificationCounts
    // returns zeros so every badge ends in " 0".
    expect(screen.getByLabelText('Inbox 0')).toBeTruthy();
    expect(screen.getByLabelText('Mentions 0')).toBeTruthy();
    expect(screen.getByLabelText('Watching 0')).toBeTruthy();
  });

  test('renders Queues, Projects, and Tasks column headers', () => {
    render(
      <Wrapper>
        <Shell />
      </Wrapper>,
    );
    // Each column writes its title in a <span> inside .col-header. The
    // left column is headed "Queues" (it used to open with a bare row
    // of Inbox/Outbox/Mentions/Watching tabs and no title at all); the
    // four queue names now live in its picker, and "Inbox" separately
    // labels a header badge — hence the title assertion here, not a
    // getAllByText('Inbox') that either of those would satisfy.
    expect(screen.getByText('Queues')).toBeTruthy();
    expect(screen.getByText('Projects')).toBeTruthy();
    expect(screen.getByText('Tasks')).toBeTruthy();
  });

  test('Details column shows empty-state copy when no issue is selected', () => {
    render(
      <Wrapper>
        <Shell />
      </Wrapper>,
    );
    expect(screen.getByText('Select a task to view details')).toBeTruthy();
  });

  test('an issue address keeps the 4-column layout, with or without nav state', () => {
    // sk-405 — this pair used to be "fromInbox hides the middle columns"
    // and "without it they render". The first half asserted the very
    // mechanism the owner asked to remove, so it is gone; what is left
    // is the surviving half, plus the same URL carrying the retired flag
    // to show it is now inert. The rule itself — and the reason for it —
    // lives in `InboxSelectionKeepsColumns.test.tsx`; this file keeps a
    // structural sanity check because it is the layout smoke test.
    render(
      <Wrapper path="/projects/p1/issues/sk-42">
        <Shell />
      </Wrapper>,
    );
    expect(screen.getByRole('link', { name: /Skein/i })).toBeTruthy();
    expect(screen.getByText('Projects')).toBeTruthy();
    expect(screen.getByText('Tasks')).toBeTruthy();
    cleanup();

    render(
      <Wrapper path="/projects/p1/issues/sk-42" state={{ fromInbox: true }}>
        <Shell />
      </Wrapper>,
    );
    expect(screen.getByText('Projects')).toBeTruthy();
    expect(screen.getByText('Tasks')).toBeTruthy();
  });

  // ─────────────── sk-41 — inbox-overlay derivation ───────────────

  test('sk-41 — shared link with ?file= activates inbox-overlay', () => {
    // Fresh URL load with `?file=` but no nav state. Shell.tsx must
    // treat this as a shared-file link and hide Projects + Tasks so
    // the Details column can split card + viewer 50/50.
    render(
      <Wrapper path="/projects/p1/issues/sk-42?file=att-x">
        <Shell />
      </Wrapper>,
    );
    expect(screen.queryByText('Projects')).toBeNull();
    expect(screen.queryByText('Tasks')).toBeNull();
  });

  test('sk-41 — in-card open (?file= + selfOpenedFile) does NOT activate overlay', () => {
    // User clicked an attachment inside an open card. Shell stays
    // 4-column; the DetailsColumn (mocked here only structurally) is
    // responsible for swapping its single pane to the viewer.
    render(
      <Wrapper
        path="/projects/p1/issues/sk-42?file=att-x"
        state={{ selfOpenedFile: true }}
      >
        <Shell />
      </Wrapper>,
    );
    expect(screen.getByText('Projects')).toBeTruthy();
    expect(screen.getByText('Tasks')).toBeTruthy();
  });

  // sk-405 — the third case of this group is gone with its premise. It
  // read "fromInbox + ?file= keeps the overlay active (fromInbox
  // dominates)", i.e. it was about the COMPOSITION of two producers, and
  // there is only one producer now: with `selfOpenedFile` set that
  // address is the in-card case immediately above, which already states
  // the answer. Kept as a note rather than rewritten into a duplicate.
});

// ────────── sk-303.13 (T027, row 40) — the address drives the shell ──────────

describe('Shell — the address opens the tab and shows the lens', () => {
  beforeEach(() => {
    // These two cases are the only ones in this file that read
    // localStorage; clear it so a stored tab/collapse from one does not
    // seed the next.
    window.localStorage.clear();
  });

  test('a link to a tab expands the column on that tab, over a stored collapse', () => {
    // The user had collapsed the sidebar and last used Inbox; the link
    // they followed says Watching. The link wins, and the column is
    // open — a tab that opens invisible is the bug this pins.
    window.localStorage.setItem('skein.layout.inbox-collapsed', 'true');
    window.localStorage.setItem('skein.layout.inbox-tab', 'inbox');

    render(
      <Wrapper path="/?tab=watching">
        <Shell />
      </Wrapper>,
    );

    // sk-285.7 (T027) — the queue is picked from ONE `<Select>` now, not
    // from a row of `role="tab"` pills; the closed control names the
    // queue on screen. The assertion is unchanged in substance: the
    // ADDRESS decided, over the stored tab.
    const picker = screen.getByRole('textbox', { name: 'Queue' }) as HTMLInputElement;
    expect(picker.value).toMatch(/^Watching /);
    // …and the column really is open, not a sliver.
    expect(document.querySelector('.col-inbox .col-body')).not.toBeNull();
  });

  test('a lens in the address is visibly on, not silently on', () => {
    const { container } = render(
      <Wrapper path="/?lens=budilnik">
        <Shell />
      </Wrapper>,
    );

    // The whole shell carries the lens marker (the coloured frame)…
    expect(container.querySelector('.shell-root.lens-budilnik')).not.toBeNull();
    // …and the lens toggle itself reads as pressed.
    const budilnik = screen.getByRole('button', { name: /Reminders/i });
    expect(budilnik.getAttribute('aria-pressed')).toBe('true');
  });
});
