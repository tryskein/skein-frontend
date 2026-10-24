/**
 * sk-285.7.2.66 — audit 2B, finding R-4: the board caption in the Tasks
 * column header.
 *
 * The artboard draws it at the right end of that header while the board
 * is on:
 *
 *   <span style="font-size:12px;color:var(--ink-3);display:flex;
 *                align-items:center;gap:6px">
 *     <i class="ti ti-layout-columns" style="font-size:16px"></i>
 *     Kanban — columns by
 *     <b style="font-weight:600;color:var(--ink-2)">status</b></span>
 *
 * The product had neither the words nor the icon: measured live, the
 * header's whole text was «Tasks|49» with one `<svg>` in it (the
 * collapse control).
 *
 * ── The one place this departs from the artboard, on purpose ───────
 *
 * The artboard's word is the literal «status». Our board's columns are
 * whatever field the user picked in View settings — seven of them — so
 * the caption names the LIVE axis. A caption that always said "status"
 * would be wrong six times out of seven, which is worse than the
 * missing caption it replaces.
 *
 * The Russian dictionary carries its own axis words rather than
 * lower-casing the control labels: «Колонки по» ("Columns by") takes the dative
 * («по статусу»), and a lower-cased label would read «по статус».
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import type { IssueSummary } from '../../../api/issues';
import { LayoutProvider, useLayoutState } from '../../../lib/useLayoutState';
import { TasksUiStateProvider } from '../../../lib/useTasksUiState';
import { TasksColumn } from '../TasksColumn';


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

const VIEW_KEY = 'skein.tasks.view';
const AXIS_KEY = 'skein.tasks.kanbanAxis';

function header(): HTMLElement {
  const el = document.querySelector('.col-tasks-header');
  if (!el) throw new Error('the Tasks header did not render');
  return el as HTMLElement;
}

const note = () => header().querySelector('.col-tasks-board-note');

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => cleanup());

describe('R-4 — the board says what its columns are cut by', () => {
  test('cards view draws no caption — it is a statement about the BOARD', async () => {
    window.localStorage.setItem(VIEW_KEY, 'cards');
    renderColumn();
    await waitFor(() => expect(header()).toBeTruthy());
    expect(note()).toBeNull();
  });

  test('tree view draws none either', async () => {
    window.localStorage.setItem(VIEW_KEY, 'tree');
    renderColumn();
    await waitFor(() => expect(header()).toBeTruthy());
    expect(note()).toBeNull();
  });

  test('board view: the artboard’s caption, with its icon', async () => {
    window.localStorage.setItem(VIEW_KEY, 'kanban');
    renderColumn();
    await waitFor(() => expect(note()).toBeTruthy());
    const el = note()!;
    expect(el.textContent).toBe('Kanban — columns by status');
    expect(el.querySelector('svg')).toBeTruthy();
    // The axis word is the picked-out half.
    expect(el.querySelector('b')?.textContent).toBe('status');
  });

  test('it names the LIVE axis, not the artboard’s literal word', async () => {
    window.localStorage.setItem(VIEW_KEY, 'kanban');
    window.localStorage.setItem(AXIS_KEY, 'assignee');
    renderColumn();
    await waitFor(() => expect(note()).toBeTruthy());
    expect(note()!.textContent).toBe('Kanban — columns by assignee');
  });

  test('the caption is decorative: the axis is stated in full by the control that sets it', async () => {
    window.localStorage.setItem(VIEW_KEY, 'kanban');
    renderColumn();
    await waitFor(() => expect(note()).toBeTruthy());
    // A screen reader that read this would hear the same fact twice —
    // once here and once from View settings, which owns the choice.
    expect(note()!.getAttribute('aria-hidden')).toBe('true');
  });
});
