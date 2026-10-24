/**
 * Collapsing the WHOLE Tasks column into a sliver — the third column to
 * get the fold, so the invariants here are deliberately the same five
 * `ProjectsColumnCollapse.test.tsx` pins for Projects (sk-290). Three
 * columns behaving identically is the point; a divergence in any of
 * these is the bug this file exists to catch.
 *
 *   1. SLIVER, NOT `display: none`. Collapsing must leave a real,
 *      focusable control on screen. A column hidden outright strands
 *      the user: nothing left to click, nothing left in the tab order.
 *   2. ROUND TRIP. The header "−" folds; the sliver unfolds. Both are
 *      buttons, and each announces the disclosure state through
 *      `aria-expanded`.
 *   3. KEYBOARD. Both controls are real `<button>`s, so Enter and Space
 *      operate them for free — the reason the sliver is not a clickable
 *      `<div>`. Exercised, not assumed.
 *   4. IT SURVIVES A RELOAD, under the column namespace key.
 *   5. INDEPENDENT LEVELS. This column has THREE nested fold levels —
 *      the column, the filter panel (sk-285.1.13) and the per-node tree
 *      carets. The outer one must not rewrite the inner ones' storage.
 *
 * Plus one thing Projects has no equivalent of: the header count chip
 * carries the column's own count semantics (sk-47.2 blob mode, sk-103
 * "N · M collapsed", sk-44.2 inexact `+`). The sliver must report the
 * SAME number, so folding can never change what the column says it
 * holds.
 *
 * The column is rendered for real (LayoutProvider + TasksUiStateProvider
 * + router) through a host that wires `tasksCollapsed` back into the
 * `collapsed` prop exactly the way Shell.tsx does, so the state round
 * trip is exercised end to end; only the network hooks are mocked.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import type { IssueSummary } from '../../../api/issues';
import { LayoutProvider, useLayoutState } from '../../../lib/useLayoutState';
import { TasksUiStateProvider } from '../../../lib/useTasksUiState';
import { TasksColumn } from '../TasksColumn';
import { createProjectDeclaration, ProjectDeclarationContext } from '../../../lib/liveProjectDeclaration';

const COLLAPSE_KEY = 'skein.layout.col.tasks-collapsed';
const FILTERS_KEY = 'skein.layout.task-filters-collapsed';
const WIDTH_KEY = 'skein.layout.col.tasks';

function issue(id: string, title: string): IssueSummary {
  return {
    id,
    projectId: 'proj-uuid-1',
    version: 1,
    title,
    type: 'task',
    priority: 2,
    status: 'open',
    pinned: false,
    assignee: null,
    componentIds: [],
    labels: [],
    isBlocked: false,
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
  };
}

const ITEMS = [issue('demo-1', 'Onboarding'), issue('demo-2', 'Deduplication')];

/** Server-side total the header chip (and therefore the sliver) reports. */
const TOTAL = 7;

vi.mock('../../../lib/useTasks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/useTasks')>();
  return {
    ...actual,
    useTasks: () => ({
      data: ITEMS,
      total: TOTAL,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: () => {},
      isLoading: false,
      error: null,
      emptyReason: 'none',
      searchDegraded: false,
      searchMode: false,
      totalIsExact: true,
      resolvedProjectId: 'proj-uuid-1',
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
  useProjectByHandle: () => ({ project: null, isLoading: false, isError: false }),
}));

vi.mock('../../../lib/useReminders', () => ({
  useRingingIssueIds: () => new Set<string>(),
  useRingingTaskCount: () => 0,
  // sk-285.7.2.49 — the Budilnik-lens body reads the LIST, and the lens
  // is the fourth render site of the collapse control. Mocking only the
  // two counters left the lens unrenderable, which is how that site
  // stayed unmeasured in the first place.
  useRemindersList: () => ({
    reminders: [],
    ringingTaskCount: 0,
    isLoading: false,
    error: null,
  }),
}));

vi.mock('../../../api/components', () => ({ listComponents: async () => [] }));
vi.mock('../../../api/projects', () => ({ listMembers: async () => [] }));
// sk-285.5.5 — the directory endpoint is a SEARCH returning an envelope,
// not a bare list. Mocking the old array shape still went green here (the
// caller reads `.items`, which is undefined on an array, and falls back to
// []), but a mock that lies about the contract is a mock that stops
// catching the day the contract matters.
vi.mock('../../../api/users', () => ({
  listUserDirectory: async () => ({ items: [], hasMore: false }),
}));

vi.mock('../../../auth/AuthContext', () => ({
  // sk-551.8 — LayoutProvider reads the layout via useNavLayoutOptional;
  // null = no session known, the side-by-side layout.
  useAuthOptional: () => null,
  useAuth: () => ({ user: { id: 'u-1', username: 'admin' } }),
}));

/**
 * Mirrors Shell.tsx: the fold flag lives in layout state and comes back
 * down as the `collapsed` prop. Rendering with a hard-coded prop instead
 * would test nothing about persistence.
 */
function ColumnHost({ budilnikMode = false }: { budilnikMode?: boolean }) {
  const { tasksCollapsed } = useLayoutState();
  return (
    <TasksColumn
      width={468}
      collapsed={tasksCollapsed}
      outboxMode={false}
      onMeMode={false}
      budilnikMode={budilnikMode}
    />
  );
}

function renderColumn(budilnikMode = false) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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
                    <ColumnHost budilnikMode={budilnikMode} />
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

const collapseBtn = () =>
  screen.getByRole('button', { name: /collapse tasks column/i });
const expandBtn = () =>
  screen.getByRole('button', { name: /expand tasks column/i });

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => cleanup());

describe('Tasks column — whole-column collapse', () => {
  test('the column starts expanded and offers a collapse button', () => {
    renderColumn();

    expect(screen.getByLabelText('Search tasks')).toBeTruthy();
    const btn = collapseBtn();
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.getAttribute('type')).toBe('button');
    expect(btn.getAttribute('aria-expanded')).toBe('true');
  });

  test('the header is the Projects/Queues shape: heading box + count chip + button', () => {
    const { container } = renderColumn();

    const header = container.querySelector('.col-tasks-header');
    expect(header).toBeTruthy();
    // The heading box holds BOTH the path and the count chip; the
    // collapse button is its sibling, pinned right.
    const heading = header!.querySelector('.col-tasks-heading');
    expect(heading).toBeTruthy();
    expect(heading!.querySelector('.tasks-heading')).toBeTruthy();
    expect(heading!.querySelector('.col-header-count')!.textContent).toBe(String(TOTAL));
    expect(header!.querySelector(':scope > .col-header-btn')).toBeTruthy();
  });

  test('collapsing leaves a labelled sliver button, not a hidden column', async () => {
    const user = userEvent.setup();
    renderColumn();

    await user.click(collapseBtn());

    // The board is gone…
    await waitFor(() => expect(screen.queryByLabelText('Search tasks')).toBeNull());
    expect(screen.queryByText('Onboarding')).toBeNull();

    // …but the sliver is still on screen, still a button, still named.
    const sliver = expandBtn();
    expect(sliver.tagName).toBe('BUTTON');
    expect(sliver.getAttribute('aria-expanded')).toBe('false');
    expect(sliver.className).toContain('col-tasks-collapsed');
    expect(sliver.getAttribute('aria-label')).toContain(`${TOTAL} tasks`);
  });

  test('the sliver reports the same count the header chip reported', async () => {
    const user = userEvent.setup();
    const { container } = renderColumn();

    const chip = container.querySelector('.col-tasks-header .col-header-count')!;
    expect(chip.textContent).toBe(String(TOTAL));

    await user.click(collapseBtn());

    const sliverCount = await waitFor(() =>
      container.querySelector('.col-tasks-sliver-count')!,
    );
    expect(sliverCount.textContent).toBe(String(TOTAL));
  });

  test('clicking the sliver expands the column again', async () => {
    const user = userEvent.setup();
    renderColumn();

    await user.click(collapseBtn());
    await waitFor(() => expect(expandBtn()).toBeTruthy());

    await user.click(expandBtn());

    expect(await screen.findByLabelText('Search tasks')).toBeTruthy();
  });

  test('both controls are operable from the keyboard', async () => {
    const user = userEvent.setup();
    renderColumn();

    const collapse = collapseBtn();
    collapse.focus();
    expect(document.activeElement).toBe(collapse);
    await user.keyboard('{Enter}');
    await waitFor(() => expect(expandBtn()).toBeTruthy());

    const sliver = expandBtn();
    sliver.focus();
    expect(document.activeElement).toBe(sliver);
    // Space is the other native activation key for a <button>.
    await user.keyboard(' ');
    expect(await screen.findByLabelText('Search tasks')).toBeTruthy();
  });

  test('the folded column persists and comes back folded after a remount', async () => {
    const user = userEvent.setup();
    const first = renderColumn();

    await user.click(collapseBtn());
    await waitFor(() =>
      expect(window.localStorage.getItem(COLLAPSE_KEY)).toBe('true'),
    );

    first.unmount();
    renderColumn();

    expect(expandBtn()).toBeTruthy();
    expect(screen.queryByLabelText('Search tasks')).toBeNull();
  });

  test('folding the column touches neither the filter panel nor the width', async () => {
    const user = userEvent.setup();
    // The user had expanded the filter panel; the column fold must not
    // silently re-collapse it (they are separate preferences).
    window.localStorage.setItem(FILTERS_KEY, 'false');
    renderColumn();

    await user.click(collapseBtn());
    await waitFor(() =>
      expect(window.localStorage.getItem(COLLAPSE_KEY)).toBe('true'),
    );

    expect(window.localStorage.getItem(FILTERS_KEY)).toBe('false');
    expect(window.localStorage.getItem(WIDTH_KEY)).toBeNull();

    // …and it comes back expanded when the column reopens.
    await user.click(expandBtn());
    expect(await screen.findByLabelText('Search tasks')).toBeTruthy();
    expect(window.localStorage.getItem(FILTERS_KEY)).toBe('false');
  });

  test('the column key is distinct from the filter-panel key', async () => {
    const user = userEvent.setup();
    renderColumn();

    await user.click(collapseBtn());
    await waitFor(() =>
      expect(window.localStorage.getItem(COLLAPSE_KEY)).toBe('true'),
    );
    // Default filter-panel state is COLLAPSED (sk-285.1.13) — written by
    // its own effect, under its own key, unaffected by the column fold.
    expect(window.localStorage.getItem(FILTERS_KEY)).toBe('true');
    expect(COLLAPSE_KEY).not.toBe(FILTERS_KEY);
  });
});

/**
 * sk-285.7.2.49 (audit finding S-1) — the fold control is an ICON.
 *
 * §6 "Column (general)" names it: "on the right a collapse button 44×44
 * (`layout-sidebar-left-collapse`)», and `Sk Queues.dc.html` draws that
 * name at 20px. The product drew the character `−`. Measured live at
 * 1440: three `.col-header-btn` at 44×44 with correct `aria-label` and
 * `svg === 0`, while `.project-collapse-toggle` a few rows below had
 * `svg === 1` — so icons worked; this control simply had none.
 *
 * The Tasks column has a second header in Budilnik-lens mode, with the
 * same class and the same character, so the mounted check runs in both
 * of this column's modes.
 *
 * It lives in this file because this is where the fold control already
 * has a working harness; a second file would have meant a second copy of
 * a hundred lines of mocks for one assertion.
 */
describe('sk-285.7.2.49 — the collapse control carries its icon, not a minus sign', () => {
  for (const budilnik of [false, true]) {
    test(`mounted: ${budilnik ? 'budilnik lens' : 'normal'} mode`, () => {
      const { container } = renderColumn(budilnik);
      const btn = container.querySelector('.col-header-btn')!;
      expect(btn).not.toBeNull();
      expect(btn.querySelectorAll('svg')).toHaveLength(1);
      // Icon-only: the accessible name comes from the label, and the
      // character that used to be the whole content is gone.
      expect((btn.textContent ?? '').trim()).toBe('');
      expect(btn.getAttribute('aria-label')).toBeTruthy();
    });
  }
});

// sk-622.21 T041 (US-9) — the project of the open route is
// declared as the `route` source, observed through the declaration
// controller the provider hands down.
describe('sk-622.21 T041 — the route project is declared', () => {
  test('the resolved project of the route is the `route` source', () => {
    const controller = createProjectDeclaration();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <MantineProvider forceColorScheme="dark">
        <QueryClientProvider client={qc}>
          <ProjectDeclarationContext.Provider value={controller}>
            <MemoryRouter initialEntries={['/projects/demo']}>
              <Routes>
                <Route
                  path="/projects/:alias"
                  element={
                    <LayoutProvider>
                      <TasksUiStateProvider>
                        <ColumnHost />
                      </TasksUiStateProvider>
                    </LayoutProvider>
                  }
                />
              </Routes>
            </MemoryRouter>
          </ProjectDeclarationContext.Provider>
        </QueryClientProvider>
      </MantineProvider>,
    );
    expect([...controller.explicitProjects('route')]).toEqual(['proj-uuid-1']);
  });
});
