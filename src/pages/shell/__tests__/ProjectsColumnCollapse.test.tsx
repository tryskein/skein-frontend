/**
 * sk-290 — collapsing the WHOLE Projects column into a sliver.
 *
 * Five things are pinned here, all user-visible:
 *
 *   1. SLIVER, NOT `display: none`. Collapsing must leave a real,
 *      focusable control on screen. A column hidden outright strands
 *      the user: there is nothing left to click, and nothing left in
 *      the tab order to reach it with. The test asserts a `<button>`
 *      survives and still says "Projects".
 *   2. ROUND TRIP. The header "−" folds; the sliver unfolds. Both are
 *      buttons, and each announces the disclosure state through
 *      `aria-expanded` so a screen-reader user knows which way the
 *      control will go before pressing it.
 *   3. KEYBOARD. Both controls are real `<button>`s, so Enter and
 *      Space operate them for free — that is the whole reason the
 *      sliver is not a clickable `<div>`. Exercised, not assumed.
 *   4. IT SURVIVES A RELOAD. The flag is written to localStorage under
 *      the column namespace and read back on the next mount.
 *   5. TWO INDEPENDENT LEVELS. The per-project carets (sk-285.1.2) and
 *      the whole-column fold do not disturb each other: a project
 *      opened before the column was collapsed is still open — and
 *      every other project still folded (sk-551.12 default) — when the
 *      column reopens.
 *
 * The column is rendered for real (LayoutProvider + router) through a
 * host that wires `projectsCollapsed` back into the `collapsed` prop
 * exactly the way Shell.tsx does, so the state round-trip is exercised
 * end to end; only the two network hooks are mocked.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import type { ProjectListItem } from '../../../api/projects';
import type { Component } from '../../../api/components';
import { LayoutProvider, useLayoutState } from '../../../lib/useLayoutState';
import { ProjectsColumn } from '../ProjectsColumn';
import {
  createProjectDeclaration,
  ProjectDeclarationContext,
  type ProjectDeclarationController,
} from '../../../lib/liveProjectDeclaration';

const COLLAPSE_KEY = 'skein.layout.col.projects-collapsed';
const TREE_KEY = 'skein.layout.project-tree.expanded';

function project(id: string, name: string, idPrefix: string): ProjectListItem {
  return {
    id,
    name,
    idPrefix,
    defaultIdMode: 'counter',
    description: '',
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
    openCount: 0,
    inProgressCount: 0,
    blockedCount: 0,
    myOutboxOpenCount: 0,
    myOutboxInProgressCount: 0,
    myOutboxBlockedCount: 0,
  };
}

const PROJECTS = [
  project('proj-uuid-1', 'Storefront', 'shop'),
  project('proj-uuid-2', 'Backoffice', 'back'),
];

const COMPONENTS: Component[] = [
  {
    id: 'comp-uuid-1',
    projectId: 'proj-uuid-1',
    name: 'gateway',
    description: '',
    paths: [],
    createdBy: 'u-1',
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
    openCount: 0,
    inProgressCount: 0,
    blockedCount: 0,
    myOutboxOpenCount: 0,
    myOutboxInProgressCount: 0,
    myOutboxBlockedCount: 0,
  },
  {
    id: 'comp-uuid-2',
    projectId: 'proj-uuid-2',
    name: 'ingest',
    description: '',
    paths: [],
    createdBy: 'u-1',
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
    openCount: 0,
    inProgressCount: 0,
    blockedCount: 0,
    myOutboxOpenCount: 0,
    myOutboxInProgressCount: 0,
    myOutboxBlockedCount: 0,
  },
];

vi.mock('../../../lib/useProjectsList', () => ({
  useProjectsInfinite: () => ({
    items: PROJECTS,
    total: PROJECTS.length,
    isLoading: false,
    isFetching: false,
    isFetchingNextPage: false,
    isError: false,
    hasNextPage: false,
    fetchNextPage: () => {},
  }),
  // sk-551.12 — the column resolves the addressed project through
  // `useProjectByHandle`, whose fast path reads this list.
  useProjectsList: () => ({ data: { items: PROJECTS } }),
}));

vi.mock('../../../api/components', () => ({
  listComponents: async (projectId: string) =>
    COMPONENTS.filter((c) => c.projectId === projectId),
}));

/**
 * Mirrors Shell.tsx: the fold flag lives in layout state and comes back
 * down as the `collapsed` prop. Rendering the column with a hard-coded
 * prop instead would test nothing about persistence.
 */
function ColumnHost() {
  const { projectsCollapsed } = useLayoutState();
  return <ProjectsColumn width={280} collapsed={projectsCollapsed} />;
}

function renderColumn() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MantineProvider forceColorScheme="dark">
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route
              path="/"
              element={
                <LayoutProvider>
                  <ColumnHost />
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
  screen.getByRole('button', { name: /collapse projects column/i });
const expandBtn = () =>
  screen.getByRole('button', { name: /expand projects column/i });

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => cleanup());

describe('sk-290 — whole-column collapse', () => {
  test('the column starts expanded and offers a collapse button', () => {
    renderColumn();

    expect(screen.getByPlaceholderText('search projects…')).toBeTruthy();
    const btn = collapseBtn();
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.getAttribute('type')).toBe('button');
    expect(btn.getAttribute('aria-expanded')).toBe('true');
  });

  test('collapsing leaves a labelled sliver button, not a hidden column', async () => {
    const user = userEvent.setup();
    renderColumn();

    await user.click(collapseBtn());

    // The tree is gone…
    await waitFor(() =>
      expect(screen.queryByPlaceholderText('search projects…')).toBeNull(),
    );
    expect(screen.queryByText('Storefront')).toBeNull();

    // …but the sliver is still on screen, still a button, still named.
    const sliver = expandBtn();
    expect(sliver.tagName).toBe('BUTTON');
    expect(sliver.getAttribute('aria-expanded')).toBe('false');
    expect(sliver.className).toContain('col-projects-collapsed');
    // The label carries the count so a folded column is still readable.
    expect(sliver.getAttribute('aria-label')).toContain('2 projects');
  });

  test('clicking the sliver expands the column again', async () => {
    const user = userEvent.setup();
    renderColumn();

    await user.click(collapseBtn());
    await waitFor(() => expect(expandBtn()).toBeTruthy());

    await user.click(expandBtn());

    expect(await screen.findByPlaceholderText('search projects…')).toBeTruthy();
    expect(screen.getByText('Storefront')).toBeTruthy();
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
    expect(await screen.findByPlaceholderText('search projects…')).toBeTruthy();
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
    expect(screen.queryByPlaceholderText('search projects…')).toBeNull();
  });

  test('per-project folds survive the column fold untouched', async () => {
    const user = userEvent.setup();
    renderColumn();

    // Open ONE project's subtree (the inner level from sk-285.1.2;
    // folded is the default since sk-551.12).
    await user.click(
      screen.getByRole('button', { name: /expand components of Storefront/i }),
    );
    expect(await screen.findByText('gateway')).toBeTruthy();
    // The other project is untouched.
    expect(screen.queryByText('ingest')).toBeNull();

    // Fold the whole column, then unfold it.
    await user.click(collapseBtn());
    await waitFor(() => expect(expandBtn()).toBeTruthy());
    // The outer fold does not rewrite the inner level's storage.
    expect(window.localStorage.getItem(TREE_KEY)).toBe('["proj-uuid-1"]');

    await user.click(expandBtn());
    expect(await screen.findByPlaceholderText('search projects…')).toBeTruthy();

    // Exactly the shape the user left: Storefront open, Backoffice folded.
    expect(
      screen.getByRole('button', { name: /collapse components of Storefront/i }),
    ).toBeTruthy();
    expect(await screen.findByText('gateway')).toBeTruthy();
    expect(screen.queryByText('ingest')).toBeNull();
  });

  test('the two levels use separate storage keys', async () => {
    const user = userEvent.setup();
    renderColumn();

    await user.click(collapseBtn());
    await waitFor(() =>
      expect(window.localStorage.getItem(COLLAPSE_KEY)).toBe('true'),
    );

    // Folding the column never touches the per-project set nor the
    // persisted column width.
    expect(window.localStorage.getItem(TREE_KEY)).toBe('[]');
    expect(window.localStorage.getItem('skein.layout.col.projects')).toBeNull();
  });
});

// sk-622.21 T041 (US-9) — the expanded project rows are
// declared while they are on screen: an open column or an open, visible
// Projects section. Observed through the declaration controller the
// provider hands down (`explicitProjects('expanded')`).
describe('sk-622.21 T041 — expanded rows declared while shown', () => {
  type Shape = { collapsed: boolean; section?: { collapsed: boolean; hidden?: boolean } };

  function renderDeclared(shape: Shape) {
    window.localStorage.setItem(TREE_KEY, '["proj-uuid-1"]');
    const controller: ProjectDeclarationController = createProjectDeclaration();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = (sh: Shape) => (
      <MantineProvider forceColorScheme="dark">
        <QueryClientProvider client={qc}>
          <ProjectDeclarationContext.Provider value={controller}>
            <MemoryRouter initialEntries={['/']}>
              <Routes>
                <Route
                  path="/"
                  element={
                    <LayoutProvider>
                      <ProjectsColumn
                        width={280}
                        collapsed={sh.collapsed}
                        section={sh.section ? { ...sh.section, onToggle: () => {} } : undefined}
                      />
                    </LayoutProvider>
                  }
                />
              </Routes>
            </MemoryRouter>
          </ProjectDeclarationContext.Provider>
        </QueryClientProvider>
      </MantineProvider>
    );
    const view = render(tree(shape));
    return {
      expanded: () => [...controller.explicitProjects('expanded')],
      rerender: (sh: Shape) => view.rerender(tree(sh)),
    };
  }

  test.each([
    ['an open column', { collapsed: false }, ['proj-uuid-1']],
    ['a folded column', { collapsed: true }, []],
    ['an open section', { collapsed: false, section: { collapsed: false, hidden: false } }, ['proj-uuid-1']],
    ['a folded section', { collapsed: false, section: { collapsed: true, hidden: false } }, []],
    ['a section hidden by a shared file', { collapsed: false, section: { collapsed: false, hidden: true } }, []],
  ] as const)('%s declares %j', (_n, shape, expected) => {
    const { expanded } = renderDeclared(shape as Shape);
    expect(expanded()).toEqual(expected);
  });

  test('folding the column takes the expanded rows out; unfolding brings them back', () => {
    const { expanded, rerender } = renderDeclared({ collapsed: false });
    expect(expanded()).toEqual(['proj-uuid-1']);
    rerender({ collapsed: true });
    expect(expanded()).toEqual([]);
    rerender({ collapsed: false });
    expect(expanded()).toEqual(['proj-uuid-1']);
  });
});
