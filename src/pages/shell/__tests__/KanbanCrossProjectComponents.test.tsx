/**
 * Component names on a board that spans projects (sk-285.2.5; the
 * `boardComponentProjectIds` lookup in `TasksColumn`). With no project
 * selected the board can carry cards of several projects, and a component
 * id means something only inside its project: the column asks each project
 * of the loaded cards for its components — once per project — whenever the
 * board needs names (the «Components» card property, or columns by
 * component), so cards and columns show names, not id tails. When the board
 * needs no names, it asks nothing.
 *
 * The stand: the real column on `/` (no project) with the loaded cards
 * stubbed at `useTasks`, and `listComponents` answering per project.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';

import type { Component } from '../../../api/components';
import type { IssueSummary } from '../../../api/issues';
import { LayoutProvider } from '../../../lib/useLayoutState';
import { TasksUiStateProvider, useTasksUiState } from '../../../lib/useTasksUiState';
import { TasksColumn } from '../TasksColumn';
import i18n from '../../../i18n/config';

const A = 'proj-a-uuid';
const B = 'proj-b-uuid';

function issue(id: string, projectId: string, componentId: string): IssueSummary {
  return {
    id, projectId, version: 1, title: `title ${id}`, type: 'task', priority: 2, status: 'open',
    pinned: false, assignee: null, componentIds: [componentId], labels: [], isBlocked: false,
    createdAt: '2026-06-01T00:00:00Z', updatedAt: '2026-06-01T00:00:00Z',
  };
}

const ITEMS = [
  issue('alpha-1', A, 'comp-a-billing-0001'),
  issue('alpha-2', A, 'comp-a-billing-0001'),
  issue('beta-1', B, 'comp-b-search-0002'),
];

const COMPONENTS: Record<string, Component[]> = {
  [A]: [{ id: 'comp-a-billing-0001', projectId: A, name: 'Billing' } as Component],
  [B]: [{ id: 'comp-b-search-0002', projectId: B, name: 'Search' } as Component],
};

const listComponentsSpy = vi.fn(async (projectId: string) => COMPONENTS[projectId] ?? []);

vi.mock('../../../api/components', () => ({
  listComponents: (projectId: string) => listComponentsSpy(projectId),
}));

vi.mock('../../../lib/useTasks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/useTasks')>();
  return {
    ...actual,
    useTasks: () => ({
      data: ITEMS, total: ITEMS.length, hasNextPage: false, isFetchingNextPage: false,
      fetchNextPage: () => {}, isLoading: false, error: null, emptyReason: 'none',
      searchDegraded: false, searchMode: false, totalIsExact: true,
      // No project selected: the board spans projects.
      resolvedProjectId: null,
      delegateeAssignees: [], loadedAssignees: [], cacheKey: ['tasks', 'cross-project'],
    }),
  };
});

vi.mock('../../../lib/useProjectsList', () => ({
  projectsListQueryKey: ['projects', 'list', 'shell'],
  useProjectsList: () => ({ data: { items: [] }, isLoading: false, isError: false }),
  useProjectsInfinite: () => ({
    items: [], total: 0, isLoading: false, isFetching: false, isFetchingNextPage: false,
    isError: false, hasNextPage: false, fetchNextPage: () => {},
  }),
}));
vi.mock('../../../lib/useProjectByHandle', () => ({
  useProjectByHandle: () => ({ project: null, isLoading: false, isError: false }),
}));
vi.mock('../../../lib/useReminders', () => ({
  useRingingIssueIds: () => new Set<string>(),
  useRingingTaskCount: () => 0,
  useRemindersList: () => ({ reminders: [], ringingTaskCount: 0, isLoading: false, error: null }),
}));
vi.mock('../../../api/projects', () => ({ listMembers: async () => [] }));
vi.mock('../../../api/users', () => ({
  listUserDirectory: async () => ({ items: [], hasMore: false }),
}));
vi.mock('../../../auth/AuthContext', () => ({
  useAuthOptional: () => null,
  useAuth: () => ({ user: { id: 'u-1', username: 'admin' } }),
}));

let ui: ReturnType<typeof useTasksUiState> | null = null;
function UiProbe() {
  ui = useTasksUiState();
  return null;
}

let qc: QueryClient;

function renderBoard() {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MantineProvider forceColorScheme="dark">
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route
              path="/"
              element={
                <LayoutProvider>
                  <TasksUiStateProvider>
                    <UiProbe />
                    <TasksColumn width={1200} collapsed={false} outboxMode={false} onMeMode={false} budilnikMode={false} />
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

const asked = () => listComponentsSpy.mock.calls.map(([pid]) => pid).sort();
/** The card of an issue, found by its accessible name; throws when the card is not there. */
const card = (id: string) =>
  screen.getByRole('button', { name: i18n.t('tasks:card.openIssue', { id, title: `title ${id}` }) as string });

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem('skein.tasks.view', 'kanban');
  listComponentsSpy.mockClear();
  ui = null;
});

afterEach(() => cleanup());

describe('a board across projects names the components of every project', () => {
  test('the «Components» card property shows names, one request per project', async () => {
    window.localStorage.setItem('skein.tasks.kanbanAxis', 'status');
    window.localStorage.setItem('skein.tasks.kanbanCardFields', 'id,components');
    renderBoard();

    // Each project answers its own request: wait until both answers are shown.
    await waitFor(() => {
      expect(card('alpha-1').textContent).toContain('Billing');
      expect(card('alpha-2').textContent).toContain('Billing');
      expect(card('beta-1').textContent).toContain('Search');
    });
    expect(asked()).toEqual([A, B]);
  });

  test('columns by component are named after the components of both projects', async () => {
    window.localStorage.setItem('skein.tasks.kanbanAxis', 'component');
    window.localStorage.setItem('skein.tasks.kanbanCardFields', 'id');
    renderBoard();

    await waitFor(() => {
      expect(screen.getAllByText('Billing').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Search').length).toBeGreaterThan(0);
    });
    expect(asked()).toEqual([A, B]);
  });

  test('with the property hidden on another axis the board asks for no components', async () => {
    window.localStorage.setItem('skein.tasks.kanbanAxis', 'status');
    window.localStorage.setItem('skein.tasks.kanbanCardFields', 'id,components');
    renderBoard();
    await waitFor(() => expect(asked()).toEqual([A, B]));

    listComponentsSpy.mockClear();
    act(() => ui!.setKanbanCardFields(new Set(['id'])));
    await act(() => qc.invalidateQueries({ queryKey: ['components'] }));

    expect(listComponentsSpy).not.toHaveBeenCalled();
    // The card is still on the board — only the component name left it.
    expect(card('alpha-1').textContent).not.toContain('Billing');
  });
  test('a list view of the same cards asks for no components', async () => {
    window.localStorage.setItem('skein.tasks.view', 'cards');
    window.localStorage.setItem('skein.tasks.kanbanAxis', 'component');
    window.localStorage.setItem('skein.tasks.kanbanCardFields', 'id,components');
    renderBoard();
    await waitFor(() => expect(card('alpha-1')).toBeTruthy());

    expect(listComponentsSpy).not.toHaveBeenCalled();
  });
});
