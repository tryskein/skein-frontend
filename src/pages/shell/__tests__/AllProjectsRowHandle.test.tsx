/**
 * sk-406, requirement 2 — "Remove the 'all' text at the start, one
 * heading Все проекты/All projects is enough".
 *
 * ── What the word was ──────────────────────────────────────────────
 *
 * A hard-coded display string, not a state value. `ProjectRow` read
 *
 *     const displayHandle = isPseudo ? 'all' : project!.idPrefix;
 *
 * and rendered it into `.project-row-handle`, the slot that carries a
 * real project's `idPrefix` (`shop`, `infra`, …). So the pseudo-row
 * borrowed the identifier slot to print a word that identifies nothing:
 * the «all projects» surface is `selectedProject === null` and the URL
 * `/` — there is no `'all'` anywhere in the state. Checked before
 * deleting, because the task said to: every other `'all'` in `src/`
 * belongs to the Tasks filters (`statusFilter` / `typeFilter` /
 * `priorityFilter` / `originFilter`, where `'all'` really is the "no
 * filter" value) and to the reminders query key. None of them is read
 * by the Projects column, and none of them is this string.
 *
 * ── What this file pins ────────────────────────────────────────────
 *
 * Rendered DOM, not stylesheet text — «is there a handle in this row»
 * is a question a jsdom render can answer honestly:
 *
 *   1. the pseudo-row renders NO handle element at all (an empty one
 *      would still take the row's `gap` and leave a hole where the word
 *      was);
 *   2. its visible text is exactly the localized title, once;
 *   3. the accessible name is untouched — the row still announces
 *      «Select all projects», which is the only place the word "all"
 *      belonged;
 *   4. the deletion is SCOPED: real project rows keep their handle and
 *      it still prints the project's own `idPrefix`. Without (4) a
 *      mutation that deletes the handle from every row passes (1)–(3).
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import type { ProjectListItem } from '../../../api/projects';
import { LayoutProvider } from '../../../lib/useLayoutState';
import { ProjectsColumn } from '../ProjectsColumn';

const PROJECT: ProjectListItem = {
  id: 'p-1',
  name: 'Storefront',
  idPrefix: 'shop',
  defaultIdMode: 'counter',
  description: '',
  createdAt: '2026-06-01T00:00:00Z',
  updatedAt: '2026-06-01T00:00:00Z',
  openCount: 2,
  inProgressCount: 1,
  blockedCount: 0,
  myOutboxOpenCount: 0,
  myOutboxInProgressCount: 0,
  myOutboxBlockedCount: 0,
};

let projects: ProjectListItem[] = [PROJECT];

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
  listComponents: async () => [],
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
});
afterEach(() => cleanup());

describe('sk-406 — the All-projects row carries the title and nothing before it', () => {
  test('the pseudo-row renders no handle element', async () => {
    const { container } = renderColumn();
    await screen.findByText('Storefront');
    const pseudo = container.querySelector('.project-row-shell-pseudo')!;
    expect(pseudo).not.toBeNull();
    // Not «the handle is empty» — «there is no handle». An empty span
    // still spends the row's `gap` and leaves the title off its own
    // left edge, which is the hole the word used to fill.
    expect(pseudo.querySelector('.project-row-handle')).toBeNull();
  });

  test('its visible text is the title alone', async () => {
    const { container } = renderColumn();
    await screen.findByText('Storefront');
    const pseudo = container.querySelector('.project-row-shell-pseudo')!;
    expect(pseudo.textContent?.trim()).toBe('All projects');
    // The row's only text node is the name slot — said separately so a
    // stray word added anywhere else in the row also fails here.
    expect(pseudo.querySelector('.project-row-name')?.textContent).toBe('All projects');
  });

  test('the accessible name still says «all projects»', async () => {
    renderColumn();
    // The word belongs in the label, where it names the ACTION, and the
    // label is the one place a screen-reader user hears it. Deleting the
    // printed word must not take it from there too.
    expect(await screen.findByRole('button', { name: 'Select all projects' })).toBeTruthy();
  });

  test('negative: a real project row keeps its handle and its idPrefix', async () => {
    const { container } = renderColumn();
    await screen.findByText('Storefront');
    const row = container.querySelector('.project-tree-node .project-row-shell')!;
    const handle = row.querySelector('.project-row-handle');
    expect(handle).not.toBeNull();
    expect(handle!.textContent).toBe('shop');
    // …and it is the ONLY handle left in the column: one per project,
    // none on the pseudo-row.
    expect(container.querySelectorAll('.project-row-handle')).toHaveLength(projects.length);
  });
});
