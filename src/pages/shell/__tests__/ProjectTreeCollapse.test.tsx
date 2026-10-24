/**
 * sk-285.1.2 / sk-551.12 — per-project fold of the component subtree in
 * the Projects column.
 *
 * Pinned here, all of it user-visible:
 *
 *   1. DEFAULT COLLAPSED (sk-551.12). `expandedProjectIds` holds the ids
 *      the user opened, so an empty set — the state a fresh browser
 *      starts in — shows no subtree, and a project that appears later
 *      arrives collapsed.
 *   2. REAL BUTTON. The caret is a `<button>` with `aria-expanded` and
 *      an `aria-label`, not a clickable `<div>`: it has to be reachable
 *      and operable from the keyboard, and a screen reader has to be
 *      able to announce the fold state.
 *   3. IT UNFOLDS, WITHOUT SELECTING. Clicking the caret shows the
 *      component rows and does NOT navigate (the caret is a sibling of
 *      the row-body button, not nested inside it).
 *   4. IT SURVIVES A RELOAD. The fold state is written to localStorage
 *      and read back on the next mount — the tree shape the user left
 *      behind is the one they come back to.
 *   5. THE SELECTED PROJECT IS OPEN (sk-551.12). The project the address
 *      selects — alone or with a component — is expanded, so the
 *      selected component is never hidden; the user can still fold it.
 *
 * The column is rendered for real (LayoutProvider + router) so the
 * state round-trip is exercised end to end; only the two network hooks
 * are mocked.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';

import type { ProjectListItem } from '../../../api/projects';
import type { Component } from '../../../api/components';
import { LayoutProvider } from '../../../lib/useLayoutState';
import { ProjectsColumn } from '../ProjectsColumn';

const STORAGE_KEY = 'skein.layout.project-tree.expanded';

const PROJECT: ProjectListItem = {
  id: 'proj-uuid-1',
  name: 'Storefront',
  idPrefix: 'shop',
  defaultIdMode: 'counter',
  description: '',
  createdAt: '2026-06-01T00:00:00Z',
  updatedAt: '2026-06-01T00:00:00Z',
  openCount: 3,
  inProgressCount: 1,
  blockedCount: 0,
  myOutboxOpenCount: 0,
  myOutboxInProgressCount: 0,
  myOutboxBlockedCount: 0,
};

const COMPONENT: Component = {
  id: 'comp-uuid-1',
  projectId: 'proj-uuid-1',
  name: 'gateway',
  description: '',
  paths: [],
  createdBy: 'u-1',
  createdAt: '2026-06-01T00:00:00Z',
  updatedAt: '2026-06-01T00:00:00Z',
  openCount: 2,
  inProgressCount: 0,
  blockedCount: 0,
  myOutboxOpenCount: 0,
  myOutboxInProgressCount: 0,
  myOutboxBlockedCount: 0,
};

// sk-551.52 — the rows the column renders; a test swaps in a variant of
// PROJECT (e.g. with `componentsCount`). Reset in beforeEach.
let listedProjects: ProjectListItem[] = [PROJECT];

vi.mock('../../../lib/useProjectsList', () => ({
  useProjectsInfinite: () => ({
    items: listedProjects,
    total: 1,
    isLoading: false,
    isFetching: false,
    isFetchingNextPage: false,
    isError: false,
    hasNextPage: false,
    fetchNextPage: () => {},
  }),
  // sk-551.12 — the column resolves the addressed project through
  // `useProjectByHandle`, whose fast path reads this list.
  useProjectsList: () => ({ data: { items: listedProjects } }),
}));

// sk-551.12 review — an alias is not in the list, so `useProjectByHandle`
// asks the resolver; the answer lands after the first render.
const resolveProject = vi.fn(async (q: string) => ({
  match:
    q === 'storefront'
      ? {
          id: PROJECT.id,
          name: PROJECT.name,
          idPrefix: PROJECT.idPrefix,
          similarity: 1,
          matchedVia: 'alias' as const,
        }
      : null,
  candidates: [],
}));
vi.mock('../../../api/projects', async (importActual) => ({
  ...(await importActual<typeof import('../../../api/projects')>()),
  resolveProject: (q: string) => resolveProject(q),
}));

const listComponents = vi.fn(async () => [COMPONENT]);
vi.mock('../../../api/components', () => ({
  listComponents: (...args: unknown[]) =>
    (listComponents as unknown as (...a: unknown[]) => Promise<Component[]>)(...args),
}));

function renderColumn(initialPath = '/') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    const shell = <LayoutProvider>{children}</LayoutProvider>;
    return (
      <MantineProvider forceColorScheme="dark">
        <QueryClientProvider client={qc}>
          <MemoryRouter initialEntries={[initialPath]}>
            <Routes>
              <Route path="/" element={shell} />
              <Route path="/projects/:alias" element={shell} />
              <Route path="/projects/:alias/components/:cid" element={shell} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </MantineProvider>
    );
  }
  const view = render(
    <Wrapper>
      {/* sk-290 added the whole-column fold; this suite covers the
          INNER per-project level, so the column itself stays open. */}
      <ProjectsColumn width={280} collapsed={false} />
    </Wrapper>,
  );
  return Object.assign(view, { queryClient: qc });
}

beforeEach(() => {
  listedProjects = [PROJECT];
  window.localStorage.clear();
  listComponents.mockClear();
  resolveProject.mockClear();
});

afterEach(() => cleanup());

const expandCaret = () =>
  screen.getByRole('button', { name: /expand components of Storefront/i });
const collapseCaret = () =>
  screen.getByRole('button', { name: /collapse components of Storefront/i });

describe('sk-285.1.2 / sk-551.12 — per-project tree fold', () => {
  test('every project starts collapsed and carries a caret button', () => {
    renderColumn();

    const caret = expandCaret();
    // A real button — keyboard-operable for free, unlike a clickable div.
    expect(caret.tagName).toBe('BUTTON');
    expect(caret.getAttribute('type')).toBe('button');
    expect(caret.getAttribute('aria-expanded')).toBe('false');
    // No subtree, and no subtree query either.
    expect(screen.queryByText('gateway')).toBeNull();
    expect(listComponents).not.toHaveBeenCalled();
  });

  test('a project the stored set does not name arrives collapsed', () => {
    // Someone else's project was opened before this one existed.
    window.localStorage.setItem(STORAGE_KEY, '["proj-uuid-0"]');
    renderColumn();

    expect(expandCaret().getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('gateway')).toBeNull();
  });

  test('the caret unfolds the subtree without selecting the project', async () => {
    const user = userEvent.setup();
    renderColumn();

    await user.click(expandCaret());

    expect(await screen.findByText('gateway')).toBeTruthy();
    // "All projects" is still the selected row — unfolding is not selecting.
    expect(
      screen.getByRole('button', { name: 'Select all projects' }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(collapseCaret().getAttribute('aria-expanded')).toBe('true');
  });

  test('the caret is operable from the keyboard', async () => {
    const user = userEvent.setup();
    renderColumn();

    const caret = expandCaret();
    caret.focus();
    expect(document.activeElement).toBe(caret);
    await user.keyboard('{Enter}');

    expect(await screen.findByText('gateway')).toBeTruthy();
  });

  test('unfolding persists to localStorage and survives a remount', async () => {
    const user = userEvent.setup();
    const first = renderColumn();

    await user.click(expandCaret());
    await waitFor(() =>
      expect(window.localStorage.getItem(STORAGE_KEY)).toBe('["proj-uuid-1"]'),
    );

    first.unmount();
    renderColumn();

    // Still open after the "reload".
    expect(collapseCaret()).toBeTruthy();
    expect(await screen.findByText('gateway')).toBeTruthy();
  });

  test('folding again hides the subtree and clears the stored id', async () => {
    const user = userEvent.setup();
    renderColumn();

    await user.click(expandCaret());
    expect(await screen.findByText('gateway')).toBeTruthy();

    await user.click(collapseCaret());
    await waitFor(() => expect(screen.queryByText('gateway')).toBeNull());
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('[]');
  });

  test.each([
    ['the selected project', '/projects/shop'],
    ['the project of the selected component', '/projects/shop/components/comp-uuid-1'],
  ])('%s is expanded automatically', async (_what, path) => {
    renderColumn(path);

    expect(await screen.findByText('gateway')).toBeTruthy();
    expect(collapseCaret().getAttribute('aria-expanded')).toBe('true');
  });

  test.each([
    ['UUID', '/projects/proj-uuid-1/components/comp-uuid-1'],
    ['alias', '/projects/storefront/components/comp-uuid-1'],
  ])('a project addressed by its %s is expanded automatically', async (_how, path) => {
    renderColumn(path);

    expect(await screen.findByText('gateway')).toBeTruthy();
    expect(collapseCaret().getAttribute('aria-expanded')).toBe('true');
  });

  // sk-551.12 review — the selection is the same resolved project as the
  // expansion: the component row is pressed, and pressing it again drops
  // the component and leaves the project selected.
  test.each([
    ['UUID', '/projects/proj-uuid-1/components/comp-uuid-1'],
    ['alias', '/projects/storefront/components/comp-uuid-1'],
  ])('a project addressed by its %s highlights its selected component', async (_how, path) => {
    const user = userEvent.setup();
    renderColumn(path);

    const component = await screen.findByRole('button', {
      name: 'Deselect component gateway',
    });
    expect(component.getAttribute('aria-pressed')).toBe('true');

    await user.click(component);

    const released = await screen.findByRole('button', {
      name: 'Filter tasks by component gateway',
    });
    expect(released.getAttribute('aria-pressed')).toBe('false');
    expect(
      screen.getByRole('button', { name: 'Select project Storefront' }).getAttribute('aria-pressed'),
    ).toBe('true');
  });

  test('a hand fold of a project addressed by alias survives a refetch', async () => {
    const user = userEvent.setup();
    const { queryClient } = renderColumn('/projects/storefront/components/comp-uuid-1');
    expect(await screen.findByText('gateway')).toBeTruthy();
    expect(resolveProject).toHaveBeenCalledWith('storefront');

    await user.click(collapseCaret());
    await waitFor(() => expect(screen.queryByText('gateway')).toBeNull());

    await act(() => queryClient.refetchQueries());

    expect(resolveProject.mock.calls.length).toBeGreaterThan(1);
    expect(expandCaret().getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('gateway')).toBeNull();
  });

  test('the selected project can still be folded by hand', async () => {
    const user = userEvent.setup();
    renderColumn('/projects/shop');
    expect(await screen.findByText('gateway')).toBeTruthy();

    await user.click(collapseCaret());

    await waitFor(() => expect(screen.queryByText('gateway')).toBeNull());
    expect(expandCaret().getAttribute('aria-expanded')).toBe('false');
  });

  // sk-551.52 — a project with no (non-archived) components has nothing
  // to unfold, so it gets no chevron; with components, or when the API
  // does not send the count at all (older skein-api), the chevron stays.
  test.each([
    ['no components', 0, false],
    ['one component', 1, true],
    ['no count from the API', undefined, true],
  ] as const)('%s → chevron present: %s', (_what, componentsCount, hasCaret) => {
    listedProjects = [{ ...PROJECT, componentsCount }];
    renderColumn();

    expect(
      screen.queryByRole('button', { name: /expand components of Storefront/i }) !== null,
    ).toBe(hasCaret);
    // The row itself is still there and selectable either way.
    expect(screen.getByRole('button', { name: 'Select project Storefront' })).toBeTruthy();
  });

  test('the "All projects" pseudo-row has no caret to fold', () => {
    renderColumn();
    expect(
      screen.queryByRole('button', { name: /components of All projects/i }),
    ).toBeNull();
  });
});
