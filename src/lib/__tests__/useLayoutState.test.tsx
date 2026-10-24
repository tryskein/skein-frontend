/**
 * F7 smoke tests for `useLayoutState` (F2).
 *
 * Covers the regression-prone surfaces:
 *   - Initial column widths read from localStorage (clamped to bounds).
 *   - Default widths when localStorage is empty.
 *   - `setColWidth` clamps + writes localStorage.
 *   - `setOutboxMode` / `setInboxCollapsed` / `setProjectsCollapsed`
 *     write-through to localStorage.
 *   - URL navigation helpers produce the expected route shapes.
 *
 * The hook reads `selectedProject` / `selectedIssue` from `useParams()` so
 * we mount the hook under a `MemoryRouter` with a route pattern that
 * matches the URL each test puts on the stack. The navigation helpers
 * call `useNavigate()`; we spy on the returned function via a partial
 * `vi.mock` of `react-router-dom` that preserves every other export.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, render, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { COL_BOUNDS, COL_STORAGE_MAX, LayoutProvider, useLayoutState } from '../useLayoutState';

// Spy on useNavigate WITHOUT swallowing the navigation: since
// sk-303.13 (T027) the tab and the lens are read back out of the
// address, so a stubbed navigate would leave the hook reporting the
// pre-navigation state and every lens assertion would test nothing.
// The spy records the arguments and then forwards to the real router.
const navigateSpy = vi.fn();
vi.mock('react-router-dom', async (importActual) => {
  const actual = await importActual<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => {
      const real = actual.useNavigate();
      return (...args: Parameters<typeof real>) => {
        navigateSpy(...args);
        return real(...args);
      };
    },
  };
});

/**
 * Wrapper that places the hook on a memory route matching `/projects/:alias/issues/:id`.
 * The route pattern decides which params the hook sees; tests that need
 * a specific URL pass `initialEntries` to control it.
 */
/** The inline wrappers of the sk-41 viewer tests below share one client. */
const attachmentsQueryClient = new QueryClient();

function makeWrapper(initialPath: string) {
  // sk-439 — `LayoutProvider` reads the projects cache (`setSelectedIssue`),
  // so it needs a QueryClient, as it has in the app (`main.tsx`).
  const queryClient = new QueryClient();
  return function Wrapper({ children }: { children: ReactNode }) {
    // The hook is shared via LayoutProvider; mount it inside the
    // routed element so useParams() resolves to the right values.
    return (
      <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/" element={<LayoutProvider>{children}</LayoutProvider>} />
          <Route
            path="/projects/:alias"
            element={<LayoutProvider>{children}</LayoutProvider>}
          />
          <Route
            path="/projects/:alias/issues/:id"
            element={<LayoutProvider>{children}</LayoutProvider>}
          />
          <Route
            path="/projects/:alias/components/:cid"
            element={<LayoutProvider>{children}</LayoutProvider>}
          />
          <Route
            path="/projects/:alias/components/:cid/issues/:id"
            element={<LayoutProvider>{children}</LayoutProvider>}
          />
          <Route
            path="/issues/:id"
            element={<LayoutProvider>{children}</LayoutProvider>}
          />
        </Routes>
      </MemoryRouter>
      </QueryClientProvider>
    );
  };
}

beforeEach(() => {
  // Hard-reset localStorage between tests; a stale value from one test
  // would silently change the initial-state computation in the next.
  window.localStorage.clear();
  navigateSpy.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useLayoutState — column widths', () => {
  test('default widths when localStorage is empty', () => {
    const { result } = renderHook(() => useLayoutState(), {
      wrapper: makeWrapper('/'),
    });

    expect(result.current.colWidths).toEqual({
      inbox: COL_BOUNDS.inbox.default,
      projects: COL_BOUNDS.projects.default,
      tasks: COL_BOUNDS.tasks.default,
    });
  });

  test('initial widths read from localStorage when set', () => {
    window.localStorage.setItem('skein.layout.col.inbox', '300');
    window.localStorage.setItem('skein.layout.col.projects', '320');
    window.localStorage.setItem('skein.layout.col.tasks', '500');

    const { result } = renderHook(() => useLayoutState(), {
      wrapper: makeWrapper('/'),
    });

    expect(result.current.colWidths).toEqual({
      inbox: 300,
      projects: 320,
      tasks: 500,
    });
  });

  test('initial widths from localStorage are clamped to bounds', () => {
    // Below min and above max — both should clamp.
    window.localStorage.setItem('skein.layout.col.inbox', '50');
    window.localStorage.setItem('skein.layout.col.tasks', '99999');

    const { result } = renderHook(() => useLayoutState(), {
      wrapper: makeWrapper('/'),
    });

    expect(result.current.colWidths.inbox).toBe(COL_BOUNDS.inbox.min);
    // sk-551.43 — the Tasks column's storage guard is no longer its old drag
    // top (600): the Cards drag may legitimately save more than that.
    expect(result.current.colWidths.tasks).toBe(COL_STORAGE_MAX.tasks);
  });

  test('sk-551.43: a Tasks width above the old 600 top survives storage', () => {
    // The reference is the sk-551.43 acceptance: in "Cards" the handle can be dragged until
    // the task card becomes 420; at 1440 that is a tasks column wider than 600.
    window.localStorage.setItem('skein.layout.col.tasks', '900');
    const { result } = renderHook(() => useLayoutState(), {
      wrapper: makeWrapper('/'),
    });
    expect(result.current.colWidths.tasks).toBe(900);

    act(() => result.current.setColWidth('tasks', 950));
    expect(window.localStorage.getItem('skein.layout.col.tasks')).toBe('950');
  });

  test('setColWidth clamps to per-column min/max and writes localStorage', () => {
    const { result } = renderHook(() => useLayoutState(), {
      wrapper: makeWrapper('/'),
    });

    // Above max → clamps to max.
    act(() => result.current.setColWidth('inbox', 9000));
    expect(result.current.colWidths.inbox).toBe(COL_BOUNDS.inbox.max);
    expect(window.localStorage.getItem('skein.layout.col.inbox')).toBe(
      String(COL_BOUNDS.inbox.max),
    );

    // Below min → clamps to min.
    act(() => result.current.setColWidth('projects', 10));
    expect(result.current.colWidths.projects).toBe(COL_BOUNDS.projects.min);
    expect(window.localStorage.getItem('skein.layout.col.projects')).toBe(
      String(COL_BOUNDS.projects.min),
    );

    // In-bounds → preserved exactly (rounded).
    act(() => result.current.setColWidth('tasks', 400.7));
    expect(result.current.colWidths.tasks).toBe(401);
    expect(window.localStorage.getItem('skein.layout.col.tasks')).toBe('401');
  });
});

describe('useLayoutState — boolean preferences', () => {
  test('outboxMode defaults to false and toggles write-through', () => {
    const { result } = renderHook(() => useLayoutState(), {
      wrapper: makeWrapper('/'),
    });

    expect(result.current.outboxMode).toBe(false);

    act(() => result.current.setOutboxMode(true));
    expect(result.current.outboxMode).toBe(true);
    expect(window.localStorage.getItem('skein.outbox-mode')).toBe('true');

    act(() => result.current.toggleOutboxMode());
    expect(result.current.outboxMode).toBe(false);
    expect(window.localStorage.getItem('skein.outbox-mode')).toBe('false');
  });

  test('inboxCollapsed defaults to false and toggles write-through', () => {
    const { result } = renderHook(() => useLayoutState(), {
      wrapper: makeWrapper('/'),
    });

    expect(result.current.inboxCollapsed).toBe(false);

    act(() => result.current.setInboxCollapsed(true));
    expect(result.current.inboxCollapsed).toBe(true);
    expect(window.localStorage.getItem('skein.layout.inbox-collapsed')).toBe('true');

    act(() => result.current.toggleInboxCollapsed());
    expect(result.current.inboxCollapsed).toBe(false);
  });

  // ── sk-285.1.2 / sk-551.12 — per-project component-tree fold ────────
  test('expandedProjectIds defaults to the empty set (every project collapsed)', () => {
    const { result } = renderHook(() => useLayoutState(), {
      wrapper: makeWrapper('/'),
    });

    expect(result.current.expandedProjectIds.size).toBe(0);
    // Membership is the expanded signal, so an id nobody ever touched —
    // a project created later included — reads as collapsed.
    expect(result.current.expandedProjectIds.has('proj-1')).toBe(false);
  });

  test('toggleProjectCollapsed flips one project and writes through', () => {
    const { result } = renderHook(() => useLayoutState(), {
      wrapper: makeWrapper('/'),
    });

    act(() => result.current.toggleProjectCollapsed('proj-1'));
    expect(result.current.expandedProjectIds.has('proj-1')).toBe(true);
    expect(
      window.localStorage.getItem('skein.layout.project-tree.expanded'),
    ).toBe('["proj-1"]');

    // A second project expands independently — this is per-project
    // state, not a single global flag.
    act(() => result.current.toggleProjectCollapsed('proj-2'));
    expect(result.current.expandedProjectIds.has('proj-1')).toBe(true);
    expect(result.current.expandedProjectIds.has('proj-2')).toBe(true);

    act(() => result.current.toggleProjectCollapsed('proj-1'));
    expect(result.current.expandedProjectIds.has('proj-1')).toBe(false);
    expect(result.current.expandedProjectIds.has('proj-2')).toBe(true);
    expect(
      window.localStorage.getItem('skein.layout.project-tree.expanded'),
    ).toBe('["proj-2"]');
  });

  test('expandProject expands and never collapses (sk-551.12)', () => {
    const { result } = renderHook(() => useLayoutState(), {
      wrapper: makeWrapper('/'),
    });

    act(() => result.current.expandProject('proj-1'));
    act(() => result.current.expandProject('proj-1'));
    expect([...result.current.expandedProjectIds]).toEqual(['proj-1']);
  });

  test('expandedProjectIds initial value reads from localStorage (survives reload)', () => {
    window.localStorage.setItem(
      'skein.layout.project-tree.expanded',
      '["proj-7","proj-9"]',
    );

    const { result } = renderHook(() => useLayoutState(), {
      wrapper: makeWrapper('/'),
    });

    expect([...result.current.expandedProjectIds].sort()).toEqual([
      'proj-7',
      'proj-9',
    ]);
  });

  test('a malformed expanded-projects entry degrades to "all collapsed"', () => {
    window.localStorage.setItem('skein.layout.project-tree.expanded', 'not json');

    const { result } = renderHook(() => useLayoutState(), {
      wrapper: makeWrapper('/'),
    });

    expect(result.current.expandedProjectIds.size).toBe(0);
  });

  test('the retired collapsed-projects key is removed and not read (sk-551.12)', () => {
    window.localStorage.setItem('skein.layout.project-tree.collapsed', '["proj-1"]');

    const { result } = renderHook(() => useLayoutState(), {
      wrapper: makeWrapper('/'),
    });

    expect(result.current.expandedProjectIds.size).toBe(0);
    expect(window.localStorage.getItem('skein.layout.project-tree.collapsed')).toBeNull();
  });

  test('the per-project key does not collide with the column-width keys', () => {
    // sk-290 collapses the whole Projects COLUMN under the
    // `skein.layout.col.*` namespace; this state is a different level
    // and must not share a key with it.
    const { result } = renderHook(() => useLayoutState(), {
      wrapper: makeWrapper('/'),
    });
    act(() => result.current.toggleProjectCollapsed('proj-1'));

    expect(window.localStorage.getItem('skein.layout.col.projects')).toBeNull();
  });

  // ── sk-290 — whole-column collapse for Projects ────────────────────
  test('projectsCollapsed defaults to false and toggles write-through', () => {
    const { result } = renderHook(() => useLayoutState(), {
      wrapper: makeWrapper('/'),
    });

    expect(result.current.projectsCollapsed).toBe(false);

    act(() => result.current.setProjectsCollapsed(true));
    expect(result.current.projectsCollapsed).toBe(true);
    expect(
      window.localStorage.getItem('skein.layout.col.projects-collapsed'),
    ).toBe('true');

    act(() => result.current.toggleProjectsCollapsed());
    expect(result.current.projectsCollapsed).toBe(false);
    expect(
      window.localStorage.getItem('skein.layout.col.projects-collapsed'),
    ).toBe('false');
  });

  test('projectsCollapsed initial value reads from localStorage (survives reload)', () => {
    window.localStorage.setItem('skein.layout.col.projects-collapsed', 'true');

    const { result } = renderHook(() => useLayoutState(), {
      wrapper: makeWrapper('/'),
    });

    expect(result.current.projectsCollapsed).toBe(true);
  });

  test('column collapse and per-project collapse are independent levels', () => {
    // Two levels, two keys, no interference: folding the column must
    // not disturb the per-project shape underneath (it is restored on
    // expand), and folding a project must not fold the column.
    const { result } = renderHook(() => useLayoutState(), {
      wrapper: makeWrapper('/'),
    });

    act(() => result.current.toggleProjectCollapsed('proj-1'));
    act(() => result.current.setProjectsCollapsed(true));

    expect(result.current.projectsCollapsed).toBe(true);
    expect(result.current.expandedProjectIds.has('proj-1')).toBe(true);

    act(() => result.current.setProjectsCollapsed(false));
    expect(result.current.projectsCollapsed).toBe(false);
    expect(result.current.expandedProjectIds.has('proj-1')).toBe(true);

    act(() => result.current.toggleProjectCollapsed('proj-1'));
    expect(result.current.expandedProjectIds.has('proj-1')).toBe(false);
    expect(result.current.projectsCollapsed).toBe(false);
  });

  test('the column-collapse key does not collide with the column-width key', () => {
    const { result } = renderHook(() => useLayoutState(), {
      wrapper: makeWrapper('/'),
    });

    act(() => result.current.setProjectsCollapsed(true));

    // The width key is a strict prefix of nothing here: collapse writes
    // `…col.projects-collapsed`, width writes `…col.projects`.
    expect(window.localStorage.getItem('skein.layout.col.projects')).toBeNull();

    act(() => result.current.setColWidth('projects', 320));
    expect(window.localStorage.getItem('skein.layout.col.projects')).toBe('320');
    expect(
      window.localStorage.getItem('skein.layout.col.projects-collapsed'),
    ).toBe('true');
  });

  // ── sk-285.1.13 — Tasks-column filter panel collapse ───────────────
  test('taskFiltersCollapsed defaults to TRUE for a fresh user', () => {
    // Opposite default from every other collapse flag: a first-time user
    // should land on tasks, not on six rows of filter controls.
    const { result } = renderHook(() => useLayoutState(), {
      wrapper: makeWrapper('/'),
    });

    expect(result.current.taskFiltersCollapsed).toBe(true);
  });

  test('the user choice is remembered across sessions (write-through + read-back)', () => {
    const { result } = renderHook(() => useLayoutState(), {
      wrapper: makeWrapper('/'),
    });

    act(() => result.current.toggleTaskFiltersCollapsed());
    expect(result.current.taskFiltersCollapsed).toBe(false);
    expect(
      window.localStorage.getItem('skein.layout.task-filters-collapsed'),
    ).toBe('false');

    // "Next session": a fresh provider over the same storage keeps the
    // expanded panel instead of falling back to the collapsed default.
    const next = renderHook(() => useLayoutState(), {
      wrapper: makeWrapper('/'),
    });
    expect(next.result.current.taskFiltersCollapsed).toBe(false);

    act(() => next.result.current.setTaskFiltersCollapsed(true));
    expect(
      window.localStorage.getItem('skein.layout.task-filters-collapsed'),
    ).toBe('true');
  });

  test('the filter-panel key is independent of the Projects-column keys', () => {
    const { result } = renderHook(() => useLayoutState(), {
      wrapper: makeWrapper('/'),
    });

    act(() => result.current.setTaskFiltersCollapsed(false));

    // The Projects column is untouched (its own key keeps the mounted
    // default 'false'), and the Tasks column WIDTH key — the closest
    // neighbour by name — is never written by a filter-panel toggle.
    expect(result.current.projectsCollapsed).toBe(false);
    expect(
      window.localStorage.getItem('skein.layout.col.projects-collapsed'),
    ).toBe('false');
    expect(window.localStorage.getItem('skein.layout.col.tasks')).toBeNull();
  });

  test('outboxMode initial value reads from localStorage', () => {
    window.localStorage.setItem('skein.outbox-mode', 'true');

    const { result } = renderHook(() => useLayoutState(), {
      wrapper: makeWrapper('/'),
    });

    expect(result.current.outboxMode).toBe(true);
  });

  test('onMeMode defaults to false and toggles write-through', () => {
    const { result } = renderHook(() => useLayoutState(), {
      wrapper: makeWrapper('/'),
    });

    expect(result.current.onMeMode).toBe(false);

    act(() => result.current.setOnMeMode(true));
    expect(result.current.onMeMode).toBe(true);
    expect(window.localStorage.getItem('skein.layout.onmode')).toBe('true');

    act(() => result.current.toggleOnMeMode());
    expect(result.current.onMeMode).toBe(false);
    expect(window.localStorage.getItem('skein.layout.onmode')).toBe('false');
  });

  test('onMeMode and outboxMode are mutually exclusive (sk-30)', () => {
    const { result } = renderHook(() => useLayoutState(), {
      wrapper: makeWrapper('/'),
    });

    // Turn outbox on first.
    act(() => result.current.setOutboxMode(true));
    expect(result.current.outboxMode).toBe(true);
    expect(result.current.onMeMode).toBe(false);

    // Turning on-me on must auto-flip outbox off.
    act(() => result.current.setOnMeMode(true));
    expect(result.current.onMeMode).toBe(true);
    expect(result.current.outboxMode).toBe(false);

    // Turning outbox back on must auto-flip on-me off.
    act(() => result.current.setOutboxMode(true));
    expect(result.current.outboxMode).toBe(true);
    expect(result.current.onMeMode).toBe(false);

    // toggleOnMeMode also enforces the mutex.
    act(() => result.current.toggleOnMeMode());
    expect(result.current.onMeMode).toBe(true);
    expect(result.current.outboxMode).toBe(false);

    // toggleOutboxMode also enforces the mutex.
    act(() => result.current.toggleOutboxMode());
    expect(result.current.outboxMode).toBe(true);
    expect(result.current.onMeMode).toBe(false);

    // Both can be OFF — turning off the active one leaves the partner alone.
    act(() => result.current.setOutboxMode(false));
    expect(result.current.outboxMode).toBe(false);
    expect(result.current.onMeMode).toBe(false);
  });

  test('budilnikMode defaults to false and toggles write-through (sk-62.2)', () => {
    const { result } = renderHook(() => useLayoutState(), {
      wrapper: makeWrapper('/'),
    });

    expect(result.current.budilnikMode).toBe(false);

    act(() => result.current.setBudilnikMode(true));
    expect(result.current.budilnikMode).toBe(true);
    expect(window.localStorage.getItem('skein.layout.budilnik-mode')).toBe('true');

    act(() => result.current.toggleBudilnikMode());
    expect(result.current.budilnikMode).toBe(false);
    expect(window.localStorage.getItem('skein.layout.budilnik-mode')).toBe('false');
  });

  test('all three lenses are mutually exclusive (sk-62.2)', () => {
    const { result } = renderHook(() => useLayoutState(), {
      wrapper: makeWrapper('/'),
    });

    // On-me ON.
    act(() => result.current.setOnMeMode(true));
    expect(result.current.onMeMode).toBe(true);
    expect(result.current.outboxMode).toBe(false);
    expect(result.current.budilnikMode).toBe(false);

    // Budilnik ON must clear On-me (and Delegated stays off).
    act(() => result.current.setBudilnikMode(true));
    expect(result.current.budilnikMode).toBe(true);
    expect(result.current.onMeMode).toBe(false);
    expect(result.current.outboxMode).toBe(false);

    // Delegated ON must clear Budilnik.
    act(() => result.current.setOutboxMode(true));
    expect(result.current.outboxMode).toBe(true);
    expect(result.current.budilnikMode).toBe(false);
    expect(result.current.onMeMode).toBe(false);

    // Budilnik ON again must clear Delegated.
    act(() => result.current.setBudilnikMode(true));
    expect(result.current.budilnikMode).toBe(true);
    expect(result.current.outboxMode).toBe(false);

    // Turning the active budilnik OFF leaves the others off (all OFF allowed).
    act(() => result.current.setBudilnikMode(false));
    expect(result.current.budilnikMode).toBe(false);
    expect(result.current.onMeMode).toBe(false);
    expect(result.current.outboxMode).toBe(false);
  });

  test('budilnik lens snapshot/restore: ON navigates to /, OFF restores URL (sk-62.2)', () => {
    const { result } = renderHook(() => useLayoutState(), {
      wrapper: makeWrapper('/projects/sk/issues/sk-42'),
    });

    // Cycle starts (all three were OFF): snapshot + navigate to the
    // cross-project view, carrying the lens in the address.
    act(() => result.current.setBudilnikMode(true));
    expect(navigateSpy).toHaveBeenLastCalledWith({
      pathname: '/',
      search: '?lens=budilnik',
    });

    navigateSpy.mockClear();
    // Cycle ends (other two OFF): restore the captured URL.
    act(() => result.current.setBudilnikMode(false));
    expect(result.current.budilnikMode).toBe(false);
    expect(navigateSpy).toHaveBeenCalledWith({
      pathname: '/projects/sk/issues/sk-42',
      search: '',
    });
  });

  test('switching On-me → Budilnik keeps the snapshot and only swaps ?lens= (sk-62.2)', () => {
    const { result } = renderHook(() => useLayoutState(), {
      wrapper: makeWrapper('/projects/sk'),
    });

    act(() => result.current.setOnMeMode(true));
    // cycle start
    expect(navigateSpy).toHaveBeenCalledWith({ pathname: '/', search: '?lens=on-me' });

    navigateSpy.mockClear();
    // Switch lens — no fresh snapshot and the path does not move: the
    // only thing that happens is the `lens` parameter being rewritten.
    act(() => result.current.setBudilnikMode(true));
    expect(result.current.budilnikMode).toBe(true);
    expect(result.current.onMeMode).toBe(false);
    expect(navigateSpy).toHaveBeenCalledTimes(1);
    expect(navigateSpy).toHaveBeenCalledWith(
      { pathname: '/', search: '?lens=budilnik' },
      { state: undefined },
    );

    // Now turning Budilnik OFF (others off) restores the ORIGINAL snapshot.
    act(() => result.current.setBudilnikMode(false));
    expect(navigateSpy).toHaveBeenCalledWith({ pathname: '/projects/sk', search: '' });
  });

  test('turning a lens ON navigates to / (sk-30 cross-project lens)', () => {
    // Caller is on /projects/sk/issues/sk-42 when they flip On me.
    const { result } = renderHook(() => useLayoutState(), {
      wrapper: makeWrapper('/projects/sk/issues/sk-42'),
    });

    act(() => result.current.setOnMeMode(true));
    expect(result.current.onMeMode).toBe(true);
    expect(navigateSpy).toHaveBeenCalledWith({ pathname: '/', search: '?lens=on-me' });
  });

  test('switching lens (on-me → delegated) only swaps ?lens=, path stays', () => {
    const { result } = renderHook(() => useLayoutState(), {
      wrapper: makeWrapper('/projects/sk'),
    });

    act(() => result.current.setOnMeMode(true));
    // First call navigates to "/" (cycle start).
    expect(navigateSpy).toHaveBeenCalledWith({ pathname: '/', search: '?lens=on-me' });

    navigateSpy.mockClear();
    // Switch lens — no fresh snapshot, path unchanged, parameter swapped.
    act(() => result.current.setOutboxMode(true));
    expect(result.current.outboxMode).toBe(true);
    expect(result.current.onMeMode).toBe(false);
    expect(navigateSpy).toHaveBeenCalledTimes(1);
    expect(navigateSpy).toHaveBeenCalledWith(
      { pathname: '/', search: '?lens=delegated' },
      { state: undefined },
    );
  });

  test('turning the last active lens OFF restores URL from snapshot', () => {
    const { result } = renderHook(() => useLayoutState(), {
      wrapper: makeWrapper('/projects/sk/issues/sk-42'),
    });

    // Cycle starts: snapshot taken, navigate to /.
    act(() => result.current.setOnMeMode(true));
    expect(navigateSpy).toHaveBeenLastCalledWith({
      pathname: '/',
      search: '?lens=on-me',
    });

    navigateSpy.mockClear();
    // Cycle ends: restore to /projects/sk/issues/sk-42.
    act(() => result.current.setOnMeMode(false));
    expect(result.current.onMeMode).toBe(false);
    expect(navigateSpy).toHaveBeenCalledWith({
      pathname: '/projects/sk/issues/sk-42',
      search: '',
    });
  });

  // sk-551.25 — a task opened from the Alarm Clock list stays open when the
  // lens goes off: the address keeps the task and loses only `?lens=`.
  // Entered from `/` and from a project, so the restore target differs
  // from the open task in both (the snapshot holds no issue at all).
  test.each([['/'], ['/projects/sk']])(
    'Alarm Clock OFF keeps a task opened from its list open (entered from %s, sk-551.25)',
    (start) => {
      const { result } = renderHook(() => useLayoutState(), {
        wrapper: makeWrapper(start),
      });

      act(() => result.current.setBudilnikMode(true));
      act(() => result.current.setSelectedIssue('infra-3', 'infra'));
      expect(result.current.selectedIssue).toBe('infra-3');

      navigateSpy.mockClear();
      act(() => result.current.setBudilnikMode(false));

      expect(result.current.budilnikMode).toBe(false);
      expect(result.current.selectedIssue).toBe('infra-3');
      expect(navigateSpy.mock.lastCall?.[0]).toEqual({
        pathname: '/issues/infra-3',
        search: '',
      });
    },
  );

  // sk-551.9 — the Alarm Clock lens IS the list in the Tasks column, so
  // turning it on must not leave that column folded to a sliver; turning
  // it off must not fold it back.
  test('Alarm Clock ON unfolds a folded Tasks column, OFF leaves it unfolded (sk-551.9)', () => {
    window.localStorage.setItem('skein.layout.col.tasks-collapsed', 'true');
    const { result } = renderHook(() => useLayoutState(), {
      wrapper: makeWrapper('/projects/sk'),
    });
    expect(result.current.tasksCollapsed).toBe(true);

    act(() => result.current.setBudilnikMode(true));
    expect(result.current.budilnikMode).toBe(true);
    expect(result.current.tasksCollapsed).toBe(false);

    act(() => result.current.setBudilnikMode(false));
    expect(result.current.budilnikMode).toBe(false);
    expect(result.current.tasksCollapsed).toBe(false);
  });

  // sk-551.9 review (grok, critical) — the header toggle also lives on
  // routes with their OWN provider (Settings, AppChrome). Turning the lens
  // on there navigates to `/`, which unmounts that provider before its
  // write-through effect runs; the Shell's provider then reads the stored
  // fold. The unfold has to reach storage synchronously.
  test('Alarm Clock ON from another provider\'s route opens the Shell with Tasks unfolded (sk-551.9)', () => {
    window.localStorage.setItem('skein.layout.col.tasks-collapsed', 'true');
    let fromSettings: ReturnType<typeof useLayoutState> | null = null;
    let fromShell: ReturnType<typeof useLayoutState> | null = null;
    function SettingsToggle() {
      fromSettings = useLayoutState();
      return null;
    }
    function ShellProbe() {
      fromShell = useLayoutState();
      return null;
    }
    // Two different element types, so the route change remounts the
    // provider, as moving from SettingsLayout / AppChrome to Shell does.
    function SettingsRoute() {
      return (
        <LayoutProvider>
          <SettingsToggle />
        </LayoutProvider>
      );
    }
    function ShellRoute() {
      return (
        <LayoutProvider>
          <ShellProbe />
        </LayoutProvider>
      );
    }
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/settings']}>
          <Routes>
            <Route path="/settings" element={<SettingsRoute />} />
            <Route path="/" element={<ShellRoute />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(fromShell).toBeNull();

    act(() => fromSettings!.setBudilnikMode(true));

    expect(fromShell!.budilnikMode).toBe(true);
    expect(fromShell!.tasksCollapsed).toBe(false);
  });

  // sk-551.9 — decision recorded in the task: On me / Delegated narrow the
  // whole shell, so a fold the user chose survives them.
  test.each([
    ['On me', 'setOnMeMode'],
    ['Delegated', 'setOutboxMode'],
  ] as const)('%s ON keeps a folded Tasks column folded (sk-551.9)', (_name, setter) => {
    window.localStorage.setItem('skein.layout.col.tasks-collapsed', 'true');
    const { result } = renderHook(() => useLayoutState(), {
      wrapper: makeWrapper('/projects/sk'),
    });

    act(() => result.current[setter](true));
    expect(result.current.tasksCollapsed).toBe(true);
  });
});

describe('useLayoutState — URL navigation helpers', () => {
  test('selectedProject reflects URL :alias param', () => {
    const { result } = renderHook(() => useLayoutState(), {
      wrapper: makeWrapper('/projects/sk'),
    });
    expect(result.current.selectedProject).toBe('sk');
    expect(result.current.selectedIssue).toBeNull();
  });

  test('selectedIssue reflects URL :id param under /projects/:alias/issues/:id', () => {
    const { result } = renderHook(() => useLayoutState(), {
      wrapper: makeWrapper('/projects/sk/issues/sk-42'),
    });
    expect(result.current.selectedProject).toBe('sk');
    expect(result.current.selectedIssue).toBe('sk-42');
  });

  test('setSelectedProject(alias) navigates to /projects/{alias}', () => {
    const { result } = renderHook(() => useLayoutState(), {
      wrapper: makeWrapper('/'),
    });

    act(() => result.current.setSelectedProject('sk'));
    expect(navigateSpy).toHaveBeenCalledWith({ pathname: '/projects/sk', search: '' });
  });

  test('setSelectedProject(null) navigates to /', () => {
    const { result } = renderHook(() => useLayoutState(), {
      wrapper: makeWrapper('/projects/sk'),
    });

    act(() => result.current.setSelectedProject(null));
    expect(navigateSpy).toHaveBeenCalledWith({ pathname: '/', search: '' });
  });

  test('setSelectedIssue(id, alias) navigates to /projects/{alias}/issues/{id}', () => {
    const { result } = renderHook(() => useLayoutState(), {
      // Project-scoped surface — caller is currently on /projects/sk.
      wrapper: makeWrapper('/projects/sk'),
    });

    act(() => result.current.setSelectedIssue('sk-42', 'sk'));
    expect(navigateSpy).toHaveBeenCalledWith({
      pathname: '/projects/sk/issues/sk-42',
      search: '',
    });
  });

  test('setSelectedIssue from cross-project surface routes to /issues/{id}', () => {
    // selectedProject === null → keep the cross-project tasks list
    // intact by avoiding the project-scoped URL shape.
    const { result } = renderHook(() => useLayoutState(), {
      wrapper: makeWrapper('/'),
    });

    act(() => result.current.setSelectedIssue('sk-42', 'sk'));
    expect(navigateSpy).toHaveBeenCalledWith({ pathname: '/issues/sk-42', search: '' });
  });

  test('clearSelectedIssue navigates to /projects/{alias} when a project is selected', () => {
    const { result } = renderHook(() => useLayoutState(), {
      wrapper: makeWrapper('/projects/sk/issues/sk-42'),
    });

    act(() => result.current.clearSelectedIssue());
    expect(navigateSpy).toHaveBeenCalledWith({ pathname: '/projects/sk', search: '' });
  });

  test('clearSelectedIssue navigates to / when no project is selected', () => {
    // No URL param for :alias → selectedProject is null. Realistic in
    // cross-project Outbox once the user closes the open issue.
    const { result } = renderHook(() => useLayoutState(), {
      wrapper: makeWrapper('/'),
    });

    act(() => result.current.clearSelectedIssue());
    expect(navigateSpy).toHaveBeenCalledWith({ pathname: '/', search: '' });
  });

  test('setSelectedIssue url-encodes path segments with special chars', () => {
    const { result } = renderHook(() => useLayoutState(), {
      // Project-scoped wrapper so the full /projects/{alias}/issues/{id}
      // shape is exercised (cross-project URL only encodes the id).
      wrapper: makeWrapper('/projects/p%20q'),
    });

    act(() => result.current.setSelectedIssue('a/b', 'p q'));
    // encodeURIComponent: '/' → %2F, ' ' → %20.
    expect(navigateSpy).toHaveBeenCalledWith({
      pathname: '/projects/p%20q/issues/a%2Fb',
      search: '',
    });
  });

  test('selectedComponent reflects URL :cid param', () => {
    const { result } = renderHook(() => useLayoutState(), {
      wrapper: makeWrapper('/projects/sk/components/c-123'),
    });
    expect(result.current.selectedProject).toBe('sk');
    expect(result.current.selectedComponent).toBe('c-123');
  });

  test('setSelectedComponent(cid, alias) navigates to /projects/{alias}/components/{cid}', () => {
    const { result } = renderHook(() => useLayoutState(), {
      wrapper: makeWrapper('/projects/sk'),
    });

    act(() => result.current.setSelectedComponent('c-1', 'sk'));
    expect(navigateSpy).toHaveBeenCalledWith({
      pathname: '/projects/sk/components/c-1',
      search: '',
    });
  });

  test('setSelectedComponent(null, alias) drops back to /projects/{alias}', () => {
    const { result } = renderHook(() => useLayoutState(), {
      wrapper: makeWrapper('/projects/sk/components/c-1'),
    });

    act(() => result.current.setSelectedComponent(null, 'sk'));
    expect(navigateSpy).toHaveBeenCalledWith({ pathname: '/projects/sk', search: '' });
  });

  test('setSelectedIssue inside a component context preserves /components/{cid}', () => {
    const { result } = renderHook(() => useLayoutState(), {
      wrapper: makeWrapper('/projects/sk/components/c-1'),
    });

    act(() => result.current.setSelectedIssue('sk-42', 'sk'));
    expect(navigateSpy).toHaveBeenCalledWith({
      pathname: '/projects/sk/components/c-1/issues/sk-42',
      search: '',
    });
  });

  test('clearSelectedIssue keeps /components/{cid} when component is selected', () => {
    const { result } = renderHook(() => useLayoutState(), {
      wrapper: makeWrapper('/projects/sk/components/c-1/issues/sk-42'),
    });

    act(() => result.current.clearSelectedIssue());
    expect(navigateSpy).toHaveBeenCalledWith({
      pathname: '/projects/sk/components/c-1',
      search: '',
    });
  });
});

// ─────────────── sk-41 — attachment viewer wiring ───────────────

describe('useLayoutState — sk-41 file viewer URL/state contract', () => {
  test('selectedAttachment reads from ?file= query param', () => {
    const { result } = renderHook(() => useLayoutState(), {
      wrapper: makeWrapper('/projects/sk/issues/sk-42?file=att-123'),
    });
    expect(result.current.selectedAttachment).toBe('att-123');
    // No `state.selfOpenedFile` ⇒ shared-link load.
    expect(result.current.selfOpenedFile).toBe(false);
  });

  test('selectedAttachment is null when ?file= is absent', () => {
    const { result } = renderHook(() => useLayoutState(), {
      wrapper: makeWrapper('/projects/sk/issues/sk-42'),
    });
    expect(result.current.selectedAttachment).toBeNull();
    expect(result.current.selfOpenedFile).toBe(false);
  });

  test('openAttachment adds ?file= and stamps state.selfOpenedFile = true', () => {
    const { result } = renderHook(() => useLayoutState(), {
      wrapper: makeWrapper('/projects/sk/issues/sk-42'),
    });

    act(() => result.current.openAttachment('att-123'));

    // navigate is called with a `To` object + an options object that
    // contains `state.selfOpenedFile = true`.
    expect(navigateSpy).toHaveBeenCalledTimes(1);
    const [to, options] = navigateSpy.mock.calls[0];
    expect(to).toEqual(
      expect.objectContaining({
        pathname: '/projects/sk/issues/sk-42',
        search: '?file=att-123',
      }),
    );
    expect(options).toEqual({ state: { selfOpenedFile: true } });
  });

  test('openAttachment preserves pre-existing state', () => {
    // Feed the hook a starting URL that already carries nav state;
    // MemoryRouter accepts location-shaped entries.
    //
    // sk-405 — the key used to be `fromInbox`, the shell's second
    // nav-state flag, and that flag no longer exists. The property under
    // test never depended on WHICH key it was — `openAttachment` spreads
    // whatever is there — so the fixture is now a neutral marker rather
    // than the name of something the app does not write. Naming a dead
    // flag here would make this test assert that it is still alive.
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <MemoryRouter
          initialEntries={[
            {
              pathname: '/projects/sk/issues/sk-42',
              search: '',
              state: { carriedThrough: true },
            },
          ]}
        >
          <Routes>
            <Route
              path="/projects/:alias/issues/:id"
              element={
                <QueryClientProvider client={attachmentsQueryClient}>
                  <LayoutProvider>{children}</LayoutProvider>
                </QueryClientProvider>
              }
            />
          </Routes>
        </MemoryRouter>
      );
    }
    const { result } = renderHook(() => useLayoutState(), { wrapper: Wrapper });

    act(() => result.current.openAttachment('att-x'));

    const [, options] = navigateSpy.mock.calls[0];
    expect(options).toEqual({
      state: { carriedThrough: true, selfOpenedFile: true },
    });
  });

  test('closeAttachment strips ?file= and clears only selfOpenedFile from state', () => {
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <MemoryRouter
          initialEntries={[
            {
              pathname: '/projects/sk/issues/sk-42',
              search: '?file=att-1',
              state: { carriedThrough: true, selfOpenedFile: true },
            },
          ]}
        >
          <Routes>
            <Route
              path="/projects/:alias/issues/:id"
              element={
                <QueryClientProvider client={attachmentsQueryClient}>
                  <LayoutProvider>{children}</LayoutProvider>
                </QueryClientProvider>
              }
            />
          </Routes>
        </MemoryRouter>
      );
    }
    const { result } = renderHook(() => useLayoutState(), { wrapper: Wrapper });

    act(() => result.current.closeAttachment());

    expect(navigateSpy).toHaveBeenCalledTimes(1);
    const [to, options] = navigateSpy.mock.calls[0];
    expect(to).toEqual({ pathname: '/projects/sk/issues/sk-42', search: '' });
    // The unrelated key must survive; selfOpenedFile must be gone.
    expect(options).toEqual({ state: { carriedThrough: true } });
  });

  test('closeAttachment is a no-op when ?file= is not present', () => {
    const { result } = renderHook(() => useLayoutState(), {
      wrapper: makeWrapper('/projects/sk/issues/sk-42'),
    });

    act(() => result.current.closeAttachment());

    expect(navigateSpy).not.toHaveBeenCalled();
  });

  test('closeAttachment drops the state arg when only selfOpenedFile was present', () => {
    // After close, the remaining state object would be empty — pass
    // no `state` arg at all so react-router falls back to a clean
    // history entry (`location.state === null`).
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <MemoryRouter
          initialEntries={[
            {
              pathname: '/projects/sk/issues/sk-42',
              search: '?file=att-1',
              state: { selfOpenedFile: true },
            },
          ]}
        >
          <Routes>
            <Route
              path="/projects/:alias/issues/:id"
              element={
                <QueryClientProvider client={attachmentsQueryClient}>
                  <LayoutProvider>{children}</LayoutProvider>
                </QueryClientProvider>
              }
            />
          </Routes>
        </MemoryRouter>
      );
    }
    const { result } = renderHook(() => useLayoutState(), { wrapper: Wrapper });

    act(() => result.current.closeAttachment());

    const [, options] = navigateSpy.mock.calls[0];
    expect(options).toBeUndefined();
  });
});

/**
 * Stage 2 — "the board takes the workspace".
 *
 * The behaviour under test is not "kanban folds two columns" (that part
 * is one line); it is the ATTRIBUTION around it: the fold must be
 * undoable exactly, must never argue with a fold or an unfold the user
 * performed themselves, and must keep both facts across a reload. Each
 * test below pins one of those.
 */
describe('useLayoutState — board workspace (kanban auto-fold)', () => {
  const WS_KEY = 'skein.layout.kanban-workspace';

  test('entering folds Queues + Projects and reports what it folded', () => {
    const { result } = renderHook(() => useLayoutState(), {
      wrapper: makeWrapper('/'),
    });

    let folded: string[] = [];
    act(() => {
      folded = result.current.enterWorkspaceView();
    });

    expect(folded.sort()).toEqual(['inbox', 'projects']);
    expect(result.current.inboxCollapsed).toBe(true);
    expect(result.current.projectsCollapsed).toBe(true);
    // Tasks is the board itself and Details is where a clicked card
    // lands — neither is ever folded for the board.
    expect(result.current.tasksCollapsed).toBe(false);
  });

  test('leaving restores exactly what entering folded', () => {
    const { result } = renderHook(() => useLayoutState(), {
      wrapper: makeWrapper('/'),
    });

    act(() => void result.current.enterWorkspaceView());
    act(() => result.current.leaveWorkspaceView());

    expect(result.current.inboxCollapsed).toBe(false);
    expect(result.current.projectsCollapsed).toBe(false);
  });

  test('a column the user had already folded stays folded on the way out', () => {
    window.localStorage.setItem('skein.layout.col.projects-collapsed', 'true');
    const { result } = renderHook(() => useLayoutState(), {
      wrapper: makeWrapper('/'),
    });

    let folded: string[] = [];
    act(() => {
      folded = result.current.enterWorkspaceView();
    });
    // The board folded Queues only — Projects was not its to give back.
    expect(folded).toEqual(['inbox']);

    act(() => result.current.leaveWorkspaceView());
    expect(result.current.inboxCollapsed).toBe(false);
    expect(result.current.projectsCollapsed).toBe(true);
  });

  test('unfolding by hand inside the board opts that column out of the next fold', () => {
    const { result } = renderHook(() => useLayoutState(), {
      wrapper: makeWrapper('/'),
    });

    act(() => void result.current.enterWorkspaceView());
    // The user reopens Projects while the board is on screen.
    act(() => result.current.setProjectsCollapsed(false));

    act(() => result.current.leaveWorkspaceView());
    // Queues was the board's to give back; Projects is the user's now.
    expect(result.current.inboxCollapsed).toBe(false);
    expect(result.current.projectsCollapsed).toBe(false);

    let folded: string[] = [];
    act(() => {
      folded = result.current.enterWorkspaceView();
    });
    expect(folded).toEqual(['inbox']);
    expect(result.current.projectsCollapsed).toBe(false);
  });

  test('folding it again by hand inside the board re-arms the automation', () => {
    const { result } = renderHook(() => useLayoutState(), {
      wrapper: makeWrapper('/'),
    });

    act(() => void result.current.enterWorkspaceView());
    act(() => result.current.setProjectsCollapsed(false)); // opt out
    act(() => result.current.toggleProjectsCollapsed()); // and back — "I agree again"

    // The fold was the USER'S, so it survives the trip back to the list.
    act(() => result.current.leaveWorkspaceView());
    expect(result.current.projectsCollapsed).toBe(true);

    // …and the opt-out is gone, so a column the user reopens in list view
    // is fair game for the board again.
    act(() => result.current.setProjectsCollapsed(false));
    let folded: string[] = [];
    act(() => {
      folded = result.current.enterWorkspaceView();
    });
    expect(folded).toContain('projects');
  });

  test('a manual unfold outside the board is not an opt-out', () => {
    const { result } = renderHook(() => useLayoutState(), {
      wrapper: makeWrapper('/'),
    });

    // Never entered the board: the user is just arranging their columns.
    act(() => result.current.setProjectsCollapsed(true));
    act(() => result.current.setProjectsCollapsed(false));

    let folded: string[] = [];
    act(() => {
      folded = result.current.enterWorkspaceView();
    });
    expect(folded.sort()).toEqual(['inbox', 'projects']);
  });

  test('the bookkeeping survives a reload — restore still works afterwards', () => {
    const first = renderHook(() => useLayoutState(), { wrapper: makeWrapper('/') });
    act(() => void first.result.current.enterWorkspaceView());
    expect(window.localStorage.getItem(WS_KEY)).toContain('"auto"');
    first.unmount();

    // Fresh provider = a reload with the board still selected. The mount
    // path only SYNCS; it must not fold anything a second time.
    const second = renderHook(() => useLayoutState(), { wrapper: makeWrapper('/') });
    act(() => second.result.current.syncWorkspaceView(true));
    expect(second.result.current.inboxCollapsed).toBe(true);
    expect(second.result.current.projectsCollapsed).toBe(true);

    act(() => second.result.current.leaveWorkspaceView());
    expect(second.result.current.inboxCollapsed).toBe(false);
    expect(second.result.current.projectsCollapsed).toBe(false);
  });

  test('a reload with a column reopened by hand does not re-fold it', () => {
    const first = renderHook(() => useLayoutState(), { wrapper: makeWrapper('/') });
    act(() => void first.result.current.enterWorkspaceView());
    act(() => first.result.current.setProjectsCollapsed(false));
    first.unmount();

    const second = renderHook(() => useLayoutState(), { wrapper: makeWrapper('/') });
    act(() => second.result.current.syncWorkspaceView(true));
    expect(second.result.current.projectsCollapsed).toBe(false);

    // …and switching modes again still leaves it alone.
    act(() => second.result.current.leaveWorkspaceView());
    let folded: string[] = [];
    act(() => {
      folded = second.result.current.enterWorkspaceView();
    });
    expect(folded).not.toContain('projects');
    expect(second.result.current.projectsCollapsed).toBe(false);
  });

  test('syncing to "not on the board" drops a stale auto claim', () => {
    window.localStorage.setItem(
      WS_KEY,
      JSON.stringify({
        auto: { inbox: true, projects: true },
        optOut: { inbox: false, projects: false },
      }),
    );
    const { result } = renderHook(() => useLayoutState(), {
      wrapper: makeWrapper('/'),
    });

    act(() => result.current.syncWorkspaceView(false));
    // Nothing is owed back, so leaving must not expand anything on its
    // own; the columns keep whatever the user left them at.
    act(() => result.current.setProjectsCollapsed(true));
    act(() => result.current.leaveWorkspaceView());
    expect(result.current.projectsCollapsed).toBe(true);
  });

  test('a malformed bookkeeping entry degrades to "nothing owed, nothing opted out"', () => {
    window.localStorage.setItem(WS_KEY, 'not json at all');
    const { result } = renderHook(() => useLayoutState(), {
      wrapper: makeWrapper('/'),
    });

    let folded: string[] = [];
    act(() => {
      folded = result.current.enterWorkspaceView();
    });
    expect(folded.sort()).toEqual(['inbox', 'projects']);
  });
});
