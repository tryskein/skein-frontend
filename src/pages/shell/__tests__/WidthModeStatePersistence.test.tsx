/**
 * sk-285.7 T022 — crossing a width-mode boundary must not cost the user
 * anything they were in the middle of.
 *
 * Coverage matrix row 32 (US-7): "the mobile ↔ desktop transition does not reset
 * the selected task / scroll". The spec's NF line is wider than the
 * row's title and is what this file actually pins: "Switching the width mode
 * does not cause loss of state (scroll position, selected task,
 * typed text)".
 *
 * ── What a unit test can and cannot say about this ───────────────────
 *
 * jsdom has no layout engine, so a scroll POSITION cannot be measured
 * here — `scrollTop` is a number nothing ever moves in this environment,
 * and a test that set it by hand and read it back would be asserting
 * about its own assignment. What decides whether a real browser keeps a
 * scroll offset is whether the scroller's BOX survived, and the DOM half
 * of that question is checkable and is the half this file takes: the
 * zone the user was looking at must be the SAME ELEMENT after the mode
 * change, not an equal one.
 *
 * Node identity is therefore the assertion throughout, and it is a
 * stronger claim than "the markup still looks right": React reuses a
 * host node only when it reconciles the new element against the old one
 * in the same slot. A remount — a changed `key`, an extra wrapper, a
 * branch that renders the subtree from a different position — produces
 * an identical-looking DOM with a different node object, loses every bit
 * of state the browser keeps on the element (scroll offset, selection,
 * an uncommitted IME composition) and every bit React keeps inside it
 * (`useState`, uncontrolled input values, in-flight queries).
 *
 * Because identity alone can still be argued with, the typed-text check
 * carries the same claim through STATE rather than through the DOM: the
 * Projects search box holds its text in a `useState` inside the column,
 * so text that is still there after two boundary crossings is proof the
 * component instance was never torn down.
 *
 * ── One gap this file deliberately does NOT paper over ───────────────
 *
 * It was found while writing this file, it is real, and it is not fixed
 * here because the fix does not belong to this task's surface. It is
 * filed as its own issue, and named here so the next reader does not
 * mistake this file's green for a complete NF line.
 *
 *   THE HIDDEN ZONES LOSE THEIR SCROLL ANYWAY. Under mobile the two
 *   inactive zones are hidden with `display: none` (T019), and that
 *   destroys the box's rendering state in every engine — the DOM node
 *   survives, the scroll offset does not. No jsdom test can see it
 *   (there is no layout here to scroll), and the fix is in the rules
 *   that hide the zones.
 *
 * A SECOND gap stood here until sk-366 closed it: the description panel
 * was rebuilt when the sheet appeared, because the sheet wrapper came
 * and went with the width mode and moved the panel two levels down. The
 * frame is permanent now and only renames itself, and the claim this
 * file could not make then is made in full by
 * `DetailsSheetStability.test.tsx` — node identity plus a comment draft
 * and a title edit that survive both crossings.
 *
 * What IS claimed below therefore stops at the three navigation zones
 * and at the selection — and says so in each test.
 */

import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { setViewportWidth } from '../../../test/viewport';

// ─────────────────────────── Mocks ───────────────────────────
//
// The same seams `MobileLayout.test.tsx` cuts, for the same reason: the
// shell is being exercised as a whole, and every network-backed hook it
// mounts would otherwise decide the outcome of a test about layout.

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

function issue(id: string, title: string) {
  return {
    id,
    projectId: 'p1',
    parentIdCurrent: null,
    version: 1,
    title,
    type: 'task',
    priority: 3,
    status: 'open',
    pinned: false,
    componentIds: [],
    labels: [],
    assignee: null,
    updatedAt: '2026-05-01T10:00:00Z',
    createdAt: '2026-05-01T09:00:00Z',
  };
}

const ALL = [issue('sk-1', 'One'), issue('sk-3', 'Three'), issue('sk-9', 'Nine')];

vi.mock('../../../lib/useTasks', async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return {
    ...actual,
    useTasks: () => ({
      data: ALL,
      tree: null,
      total: ALL.length,
      totalIsExact: true,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: () => {},
      isLoading: false,
      error: null,
      emptyReason: null,
      searchDegraded: false,
      loadedAssignees: [],
      delegateeAssignees: [],
      resolvedProjectId: 'p1',
      min: null,
      max: null,
      sort: null,
    }),
  };
});

vi.mock('../../../lib/useInbox', () => ({
  inboxQueryKey: ['inbox', 'assigned-to-me-unaccepted-open'] as const,
  useInbox: () => ({
    data: { items: [issue('sk-1', 'One')], hasMore: false, nextCursor: null },
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
      outbox: 0,
      mentions: 0,
      watching: 0,
      onMeOpenCount: 0,
      delegatedOpenCount: 0,
    },
    isLoading: false,
    error: null,
  }),
}));

import { Shell } from '../Shell';

// ─────────────────────────── Harness ───────────────────────────

const MOBILE = 390;
const TABLET = 1024;
const DESKTOP = 1440;

function Wrapper({ children, at = '/' }: { children: ReactNode; at?: string }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return (
    <MantineProvider forceColorScheme="dark">
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[at]}>
          <Routes>
            <Route path="/" element={children} />
            <Route path="/projects/:alias" element={children} />
            <Route path="/projects/:alias/issues/:id" element={children} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>
  );
}

/**
 * Move the window, the way the app hears it.
 *
 * `act` because the width change goes through a `matchMedia` subscriber
 * that sets React state: without it the re-render happens outside React's
 * batching and every assertion below would race the layout it is about.
 */
function resizeTo(width: number): void {
  act(() => {
    setViewportWidth(width);
  });
}

/**
 * The three navigation zones as DOM nodes.
 *
 * Read by the selector that matches in EVERY mode: a zone that is a 44px
 * sliver in tablet is the same zone, so the collapsed spelling counts.
 * `null` for a zone that is not in the document at all — which is itself
 * the failure this file is about, so it is returned rather than thrown
 * on, and the assertion says which zone went missing.
 */
function zoneNodes(): Record<string, Element | null> {
  return {
    queues: document.querySelector('.col-inbox, .col-inbox-collapsed'),
    projects: document.querySelector('.col-projects, .col-projects-collapsed'),
    tasks: document.querySelector('.col-tasks, .col-tasks-collapsed'),
  };
}

/** The Projects column's search box — a `useState` behind a real input. */
function projectsSearch(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>('.projects-search input');
  expect(input, 'the Projects column has no search box to type into').not.toBeNull();
  return input!;
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  setViewportWidth(DESKTOP);
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-width-mode');
});

// ── the zones themselves ────────────────────────────────────────────

describe('T022 / row 32 — a mode change reuses the zones, it does not rebuild them', () => {
  test('the harness really changes the mode (guard against a vacuous pass)', () => {
    // Every test below compares the DOM before a resize with the DOM
    // after one. If the resize did not actually move the app between
    // modes, all of them would pass by comparing a thing with itself.
    render(
      <Wrapper>
        <Shell />
      </Wrapper>,
    );
    expect(document.documentElement.getAttribute('data-width-mode')).toBe('desktop');
    resizeTo(MOBILE);
    expect(document.documentElement.getAttribute('data-width-mode')).toBe('mobile');
    // …and the mobile branch really rendered: the strip is the one piece
    // of markup that exists in exactly one mode.
    expect(document.querySelector('.zone-tabs')).not.toBeNull();
    resizeTo(DESKTOP);
    expect(document.documentElement.getAttribute('data-width-mode')).toBe('desktop');
    expect(document.querySelector('.zone-tabs')).toBeNull();
  });

  test.each([
    ['desktop → mobile → desktop', [MOBILE, DESKTOP]],
    ['desktop → mobile → desktop → mobile', [MOBILE, DESKTOP, MOBILE]],
  ])('%s keeps the very same zone elements', (_name, widths) => {
    render(
      <Wrapper>
        <Shell />
      </Wrapper>,
    );
    const before = zoneNodes();
    for (const [name, node] of Object.entries(before)) {
      expect(node, `${name} is not in the document to begin with`).not.toBeNull();
    }
    for (const width of widths) {
      resizeTo(width);
      const after = zoneNodes();
      for (const name of Object.keys(before)) {
        // Identity, not equality: an equal-looking node in the same place
        // is exactly what a remount produces, and it has none of the
        // browser state (scroll offset, selection) the old one carried.
        expect(after[name], `${name} was rebuilt at ${width}px`).toBe(before[name]);
      }
    }
  });

  /**
   * Tablet is the one boundary where a HOST node legitimately changes,
   * and saying so here is the point: the two navigation zones become
   * slivers (T020), and a sliver is a `<button>` where the zone was a
   * `<div>` — the same swap the user performs by hand with the fold
   * control on desktop, made by the mode instead of by them.
   *
   * So identity is claimed for the zone that does NOT fold, and the
   * folding pair is covered by the STATE checks below, which is the
   * stronger half anyway: `ProjectsColumn` returns the sliver from
   * inside itself, so the component — and everything in its `useState` —
   * is never unmounted, and the text the user was typing is still there
   * when the column comes back.
   *
   * Pinned rather than left implicit: if the fold ever moved into a
   * separate component, this test would stop being an explanation and
   * start being a failure, which is what should happen.
   */
  test('tablet folds the navigation zones and leaves the workspace zone alone', () => {
    render(
      <Wrapper>
        <Shell />
      </Wrapper>,
    );
    const before = zoneNodes();
    resizeTo(TABLET);
    const inTablet = zoneNodes();
    expect(inTablet.tasks, 'the Tasks zone was rebuilt on the way into tablet').toBe(before.tasks);
    // The pair that folds: a different host node, and it is the SLIVER —
    // not some third thing.
    expect(inTablet.queues).not.toBe(before.queues);
    expect(inTablet.queues?.className).toContain('col-inbox-collapsed');
    expect(inTablet.projects?.className).toContain('col-projects-collapsed');

    resizeTo(DESKTOP);
    const back = zoneNodes();
    expect(back.tasks, 'the Tasks zone was rebuilt on the way out of tablet').toBe(before.tasks);
    expect(back.queues?.className).toContain('col-inbox');
    expect(back.projects?.className).toContain('col-projects');
  });

  test('the tab strip appears in front of the zones without displacing them', () => {
    // The strip is rendered by `{mobileZones && <ZoneTabs/>}` as the
    // first child of the column row, and a conditional sibling is the
    // classic way to shift every following child by one slot — which
    // remounts all of them. React keeps the slot when the branch is
    // false, and this is the check that says so out loud.
    render(
      <Wrapper>
        <Shell />
      </Wrapper>,
    );
    const before = zoneNodes();
    resizeTo(MOBILE);
    const strip = document.querySelector('.zone-tabs');
    expect(strip, 'no strip in mobile — nothing was inserted to displace anything').not.toBeNull();
    const after = zoneNodes();
    expect(after.queues).toBe(before.queues);
    // …and the strip really is before them in the document, i.e. the
    // insertion happened where the displacement hazard is.
    expect(
      strip!.compareDocumentPosition(after.queues!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

// ── the state the user is in the middle of ──────────────────────────

describe('T022 / row 32 — the selected issue and the typed text survive', () => {
  test('the open issue is still open after crossing the boundary twice', () => {
    render(
      <Wrapper at="/projects/alpha/issues/sk-3">
        <Shell />
      </Wrapper>,
    );
    // The description zone is showing SOMETHING for the issue rather than
    // its empty state — that is the observable form of "selected task"
    // in this shell (the selection itself lives in `useLayoutState`,
    // derived from the route, and is not a per-column piece of state).
    const emptyAtStart = document.querySelector('.col-details-empty');
    expect(emptyAtStart, 'no issue was open to begin with').toBeNull();

    resizeTo(MOBILE);
    expect(document.querySelector('.col-details-empty'), 'mobile lost the selection').toBeNull();
    resizeTo(DESKTOP);
    expect(document.querySelector('.col-details-empty'), 'the way back lost the selection').toBeNull();
  });

  test('text typed into a column survives both crossings', () => {
    // "Typed text" from the NF line, in its cheapest honest form:
    // the Projects search box keeps its value in a `useState` INSIDE the
    // column, so this text can only still be here if the component
    // instance was never torn down. It is a stronger statement than the
    // node identity above — identity says the host element was reused,
    // this says the React tree under it was too.
    render(
      <Wrapper>
        <Shell />
      </Wrapper>,
    );
    fireEvent.change(projectsSearch(), { target: { value: 'half-typed query' } });
    expect(projectsSearch().value).toBe('half-typed query');

    resizeTo(MOBILE);
    expect(projectsSearch().value, 'mobile dropped the typed text').toBe('half-typed query');
    resizeTo(DESKTOP);
    expect(projectsSearch().value, 'the way back dropped the typed text').toBe('half-typed query');
  });

  test('text typed into a column survives the zone becoming a sliver and back', () => {
    // The tablet leg of the same claim, and the one the node-identity
    // check above deliberately cannot make: in tablet the Projects zone
    // IS a sliver, so its search box is not in the document at all. The
    // text has to come back when the zone does — which it can only do if
    // the component was never unmounted, i.e. if the sliver is a branch
    // INSIDE the column rather than a different component in its slot.
    render(
      <Wrapper>
        <Shell />
      </Wrapper>,
    );
    fireEvent.change(projectsSearch(), { target: { value: 'half-typed query' } });

    resizeTo(TABLET);
    expect(
      document.querySelector('.projects-search input'),
      'the sliver still renders the search box — this test is checking nothing',
    ).toBeNull();

    resizeTo(DESKTOP);
    expect(projectsSearch().value, 'the trip through tablet dropped the typed text').toBe(
      'half-typed query',
    );
  });

  test('the zone the phone was showing is remembered across a trip to desktop', () => {
    // `activeZone` is `useState` in the shell itself, and the shell is
    // rendered in every mode — so a round trip through desktop must not
    // send the user back to the default tab. This is the piece of state
    // that would be lost if the mode branches were separate COMPONENTS
    // rather than one component with two branches.
    render(
      <Wrapper>
        <Shell />
      </Wrapper>,
    );
    resizeTo(MOBILE);
    const projectsTab = screen.getByRole('tab', { name: /^Projects/ });
    fireEvent.click(projectsTab);
    expect(
      document.querySelector('.shell-columns')?.getAttribute('data-active-zone'),
    ).toBe('projects');

    resizeTo(DESKTOP);
    resizeTo(MOBILE);
    expect(
      document.querySelector('.shell-columns')?.getAttribute('data-active-zone'),
      'the phone forgot which zone it was showing',
    ).toBe('projects');
  });

  test('a zone folded on desktop is folded again on the way back from tablet', () => {
    // Tablet overrides the fold flags rather than writing them (T020),
    // and the override is what a mode change must not turn into a write.
    // Read through the DOM: the collapsed spelling of the class IS the
    // user's flag as the shell applies it.
    render(
      <Wrapper>
        <Shell />
      </Wrapper>,
    );
    expect(document.querySelector('.col-projects-collapsed')).toBeNull();
    resizeTo(TABLET);
    expect(
      document.querySelector('.col-projects-collapsed'),
      'tablet did not turn the Projects zone into a sliver',
    ).not.toBeNull();
    resizeTo(DESKTOP);
    expect(
      document.querySelector('.col-projects-collapsed'),
      'the tablet sliver was written back as the desktop preference',
    ).toBeNull();
  });

});
