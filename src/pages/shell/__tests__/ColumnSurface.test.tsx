/**
 * sk-285.7 T027 — the Projects column renders its rows in the edge
 * cases: no projects, a project with no components, a very long name.
 *
 * The declarations of the column surfaces (band heights, type steps,
 * tones, icon sizes) are not checked here (sk-540.11, owner decision):
 * what a person sees is not asserted from the stylesheet or the source.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import type { ProjectListItem } from '../../../api/projects';
import type { Component } from '../../../api/components';
import { LayoutProvider } from '../../../lib/useLayoutState';
import { ProjectsColumn } from '../ProjectsColumn';

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

/** Mutable so each test can hand the column a different world. */
let projects: ProjectListItem[] = [PROJECT];
let components: Component[] = [COMPONENT];

vi.mock('../../../lib/useProjectsList', () => ({
  useProjectsInfinite: () => ({
    items: projects,
    total: projects.length,
    isLoading: false,
    isFetching: false,
    isFetchingNextPage: false,
    isError: false,
    hasNextPage: false,
    fetchNextPage: () => {},
  }),
  // sk-551.12 — the column resolves the addressed project through
  // `useProjectByHandle`, whose fast path reads this list.
  useProjectsList: () => ({ data: { items: projects } }),
}));

vi.mock('../../../api/components', () => ({
  listComponents: async () => components,
}));

function renderColumn() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MantineProvider forceColorScheme="dark">
        <QueryClientProvider client={qc}>
          <MemoryRouter initialEntries={['/']}>
            <Routes>
              <Route path="/" element={<LayoutProvider>{children}</LayoutProvider>} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </MantineProvider>
    );
  }
  return render(
    <Wrapper>
      <ProjectsColumn width={280} collapsed={false} />
    </Wrapper>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  projects = [PROJECT];
  components = [COMPONENT];
});
afterEach(() => cleanup());

describe('T027 · what the column renders at the edges', () => {
  test('negative: an empty project list still renders the All-projects row', async () => {
    projects = [];
    const { container } = renderColumn();
    // The pseudo-row is not part of the data — it must survive a world
    // with nothing in it, and it is the row the shell starts selected on.
    const pseudo = container.querySelector('.project-row-shell-pseudo')!;
    expect(pseudo).not.toBeNull();
    expect(pseudo.className).toContain('selected');
    expect(container.querySelectorAll('.project-tree-node')).toHaveLength(0);
    expect(container.querySelector('.col-header-count')?.textContent).toBe('0');
  });

  test('negative: a project with no components draws no guide segments', async () => {
    components = [];
    const { container } = renderColumn();
    await screen.findByText('Storefront');
    expect(container.querySelectorAll('.component-row-shell')).toHaveLength(0);
    // …and the project row itself is untouched by the absence. Scoped
    // to the tree node anyway: the handle belongs to a PROJECT, and the
    // pseudo-row above is not one — it had a handle of its own (the word
    // «all») until sk-406 took it out, and the scoping is what let that
    // change happen without touching this assertion.
    expect(
      container.querySelector('.project-tree-node .project-row-handle')?.textContent,
    ).toBe('shop');
  });

  test('negative: a very long name stays whole in the DOM, and the row keeps its parts', async () => {
    projects = [{ ...PROJECT, name: 'a'.repeat(300) }];
    const { container } = renderColumn();
    const name = container.querySelector(
      '.project-tree-node .project-row-name',
    )!;
    // The text is all there (the ellipsis is visual, not a truncation of
    // the DOM) and the row keeps its three parts.
    expect(name.textContent).toHaveLength(300);
    expect(container.querySelector('.project-row-handle')).not.toBeNull();
    expect(container.querySelector('.project-row-counts')).not.toBeNull();
  });
});
