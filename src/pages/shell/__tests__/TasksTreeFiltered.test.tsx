/**
 * sk-285.2.8 — the Tasks tree under a NARROWED set, end to end through
 * the real column (only the network hooks are stubbed).
 *
 * The defect being pinned: server-side filtering returns matches only,
 * so the tree used to lose the hierarchy exactly when it mattered —
 * parents dropped out, children floated to the root, and any match under
 * a collapsed ancestor became invisible while the header still counted
 * it. Five properties, one per acceptance point:
 *
 *   1. A matched subtask stays at its real depth; the parent that did
 *      not match is pulled in as scaffolding rather than dropped.
 *   2. That scaffolding row is announced as context in its accessible name.
 *   3. The path to every match is open, even where the user had
 *      collapsed it by hand.
 *   4. Clearing the narrowing gives the hand-made shape back, and
 *      nothing about the narrowed view was ever written to localStorage.
 *   5. The header count reports MATCHES, not the context rows added
 *      around them.
 *
 * The narrowing is driven through the `outboxMode` lens prop because it
 * is the one dimension the host can flip in place, so property 4 can be
 * observed as a real transition rather than inferred from two separate
 * mounts. `describeTreeNarrowing` treats every dimension identically —
 * its own per-dimension coverage lives in
 * `lib/__tests__/filteredTreeExpansion.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { useState } from 'react';

import type { IssueSummary } from '../../../api/issues';
import { LayoutProvider } from '../../../lib/useLayoutState';
import { TasksUiStateProvider } from '../../../lib/useTasksUiState';
import { TasksColumn } from '../TasksColumn';

const TREE_KEY = 'skein.tasks.tree.demo.expanded';

function issue(
  id: string,
  parentIdCurrent: string | null,
  over: Partial<IssueSummary> = {},
): IssueSummary {
  return {
    id,
    projectId: 'proj-uuid-1',
    version: 1,
    title: `title ${id}`,
    type: 'task',
    priority: 2,
    status: 'open',
    pinned: false,
    assignee: null,
    parentIdCurrent,
    componentIds: [],
    labels: [],
    isBlocked: false,
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
    ...over,
  };
}

/**
 * What a filtered query returns: three MATCHES. `demo-2.1` hangs off a
 * matched parent that is on the page; `demo-1.1` hangs off `demo-1`,
 * which did NOT match and therefore is not here.
 */
const MATCHES = [
  issue('demo-2', null),
  issue('demo-2.1', 'demo-2'),
  issue('demo-1.1', 'demo-1'),
];

/** The parent only the backfill can supply. */
const MISSING_PARENT = issue('demo-1', null, { title: 'title demo-1' });

const findIssueSummaryById = vi.fn(async (id: string) =>
  id === 'demo-1' ? MISSING_PARENT : null,
);

vi.mock('../../../api/issues', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/issues')>();
  return {
    ...actual,
    findIssueSummaryById: (id: string) => findIssueSummaryById(id),
  };
});

vi.mock('../../../lib/useTasks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/useTasks')>();
  return {
    ...actual,
    useTasks: () => ({
      data: MATCHES,
      // The server counts MATCHES; the backfilled parent is not one.
      total: MATCHES.length,
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

/** Flips the lens in place so the narrowing can be turned off live. */
function ColumnHost({ initialLens }: { initialLens: boolean }) {
  const [lens, setLens] = useState(initialLens);
  return (
    <>
      <button type="button" onClick={() => setLens((v) => !v)}>
        toggle lens
      </button>
      <TasksColumn
        width={468}
        collapsed={false}
        outboxMode={lens}
        onMeMode={false}
        budilnikMode={false}
      />
    </>
  );
}

function renderColumn(initialLens: boolean) {
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
                    <ColumnHost initialLens={initialLens} />
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

/**
 * The tree row element for an issue, or null when it is not rendered.
 * Matches the title EXACTLY: `demo-1` is a prefix of `demo-1.1`, so a
 * `includes()` probe would silently answer questions about the wrong row.
 */
function treeRow(container: HTMLElement, id: string): HTMLElement | null {
  const rows = Array.from(container.querySelectorAll('.task-tree-node-row'));
  for (const row of rows) {
    const title = row.querySelector('.task-card-title-text')?.textContent;
    if (title === `title ${id}`) return row as HTMLElement;
  }
  return null;
}

beforeEach(() => {
  window.localStorage.clear();
  // Tree view, and a hand-made expansion state where NOTHING is open.
  window.localStorage.setItem('skein.tasks.view', 'tree');
  window.localStorage.setItem(TREE_KEY, JSON.stringify([]));
  findIssueSummaryById.mockClear();
});

afterEach(() => cleanup());

describe('Tasks tree — matches plus ancestors under a narrowing', () => {
  test('a matched subtask keeps its place in the hierarchy, under a context parent', async () => {
    const { container } = renderColumn(true);

    // The backfilled parent arrives asynchronously (one lookup by id).
    await waitFor(() => expect(treeRow(container, 'demo-1')).not.toBeNull());

    const parent = treeRow(container, 'demo-1')!;
    const child = treeRow(container, 'demo-1.1')!;

    // (2) the parent is marked as context — it never passed the filter.
    expect(parent.getAttribute('aria-label')).toMatch(/parent shown for context/);
    // (1) and the match sits one level under it, not at the root.
    expect(parent.getAttribute('aria-level')).toBe('1');
    expect(child.getAttribute('aria-level')).toBe('2');
    // A context row is scaffolding: no chevron to collapse it with.
    expect(parent.querySelector('.task-tree-toggle')).toBeNull();
  });

  test('the path to a match is unfolded even where the user had collapsed it', async () => {
    const { container } = renderColumn(true);
    await waitFor(() => expect(treeRow(container, 'demo-1')).not.toBeNull());

    // `demo-2` is absent from the persisted expanded set, yet its matched
    // child is on screen: the narrowing opened the path.
    expect(treeRow(container, 'demo-2')).not.toBeNull();
    expect(treeRow(container, 'demo-2.1')).not.toBeNull();
  });

  test('with no narrowing the hand-made collapse is honoured', async () => {
    const { container } = renderColumn(false);
    // The backfill runs regardless of the lens — context rows are about a
    // missing page, not about a filter.
    await waitFor(() => expect(treeRow(container, 'demo-1')).not.toBeNull());

    expect(treeRow(container, 'demo-2')).not.toBeNull();
    expect(treeRow(container, 'demo-2.1')).toBeNull();
  });

  test('clearing the narrowing restores the hand-made shape, and nothing was persisted', async () => {
    const user = userEvent.setup();
    const { container } = renderColumn(true);
    await waitFor(() => expect(treeRow(container, 'demo-2.1')).not.toBeNull());

    // Collapse the auto-opened row while narrowed — a statement about the
    // filtered view only.
    const toggle = treeRow(container, 'demo-2')!.querySelector(
      '.task-tree-toggle',
    ) as HTMLButtonElement;
    await user.click(toggle);
    await waitFor(() => expect(treeRow(container, 'demo-2.1')).toBeNull());
    expect(window.localStorage.getItem(TREE_KEY)).toBe('[]');

    // Lens off → back to the persisted state, which had `demo-2` closed.
    await user.click(screen.getByRole('button', { name: 'toggle lens' }));
    await waitFor(() => expect(treeRow(container, 'demo-2')).not.toBeNull());
    expect(treeRow(container, 'demo-2.1')).toBeNull();
    expect(window.localStorage.getItem(TREE_KEY)).toBe('[]');

    // Lens on again → the ephemeral collapse is gone with the narrowing
    // it described, so the path to the match is open once more.
    await user.click(screen.getByRole('button', { name: 'toggle lens' }));
    await waitFor(() => expect(treeRow(container, 'demo-2.1')).not.toBeNull());
    expect(window.localStorage.getItem(TREE_KEY)).toBe('[]');
  });

  test('the header count reports matches, not the context rows around them', async () => {
    const { container } = renderColumn(true);
    await waitFor(() => expect(treeRow(container, 'demo-1')).not.toBeNull());

    // Four rows on screen, three of them matches.
    expect(container.querySelectorAll('.task-tree-node-row').length).toBe(4);
    const count = container.querySelector('.col-header-count');
    expect(count?.textContent).toBe(String(MATCHES.length));
  });
});
