/**
 * sk-285.7 T029 — the board speaks the Stage 2.2 language.
 *
 * Handoff §6 «Board view»: every column head carries a status dot, and a
 * column the status filter excludes stays on the board with a way back
 * ("Show every status"; since sk-551.3 the folded column is itself that
 * way back). What a render can see is pinned here: the dot is
 * mounted in every head and hidden from assistive technology, the
 * hidden-by-filter column offers its way back, and the accent resolver
 * does not crash on a non-numeric priority value.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import i18n from '../../../i18n/config';
import { KanbanBoard, kanbanColumnAccent, type KanbanBoardProps } from '../KanbanBoard';
import type { IssueSummary, StatusFilter } from '../../../api/issues';

function issue(over: Partial<IssueSummary> = {}): IssueSummary {
  return {
    id: 'sk-1',
    projectId: 'p',
    version: 1,
    title: 'hello world',
    type: 'task',
    priority: 3,
    status: 'open',
    pinned: false,
    componentIds: [],
    labels: [],
    isBlocked: false,
    updatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    ...over,
  };
}

function renderBoard(over: Partial<KanbanBoardProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const props: KanbanBoardProps = {
    items: [],
    axis: 'status',
    statusFilter: 'all' as StatusFilter,
    onStatusFilterChange: vi.fn(),
    selectedIssueId: null,
    onSelect: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    ...over,
  };
  return render(
    <QueryClientProvider client={client}>
      <MantineProvider forceColorScheme="dark">
        <MemoryRouter>
          <KanbanBoard {...props} />
        </MemoryRouter>
      </MantineProvider>
    </QueryClientProvider>,
  );
}

/** Columns are `<section aria-label>`, i.e. accessible regions. */
const columns = () => screen.getAllByRole('region');

afterEach(() => cleanup());

describe('T029 · the column head carries §6’s dot and its colour', () => {
  test('every column mounts a dot — including the ones that hold nothing', () => {
    // Rendered, not read from the sheet: a dot that is styled but never
    // mounted is invisible to a stylesheet check and is exactly the shape
    // of miss that survives a CSS-only guard.
    renderBoard({ items: [issue()] });
    const cols = columns();
    expect(cols).toHaveLength(5);
    for (const col of cols) {
      expect(
        col.querySelector('.kanban-col-header > .kanban-col-dot'),
        `${col.getAttribute('aria-label')} has no dot in its head`,
      ).toBeTruthy();
    }
  });

  test('the dot is decorative — it repeats the title, so it is hidden from AT', () => {
    renderBoard();
    for (const dot of document.querySelectorAll('.kanban-col-dot')) {
      expect(dot.getAttribute('aria-hidden')).toBe('true');
    }
  });


  test('a priority axis value that is not a number falls back, it does not crash', () => {
    // Negative path: the axis value is a string off the wire, and
    // `Number('')` is 0 while `Number('x')` is NaN. Only a real number
    // may reach `priorityFill`.
    expect(kanbanColumnAccent('priority', 'x')).toBe('--line-2');
    expect(kanbanColumnAccent('priority', '0')).toBe('--err');
  });
});

describe('T029 · a column the filter excludes is drawn as an outline of itself', () => {
  test('it is marked hidden and offers the way back', () => {
    renderBoard({ statusFilter: 'open' });
    const done = columns().find((c) =>
      (c.getAttribute('aria-label') ?? '').startsWith('Done'),
    );
    expect(done, 'no Done column rendered').toBeTruthy();
    expect(done!.classList.contains('is-hidden-by-filter')).toBe(true);
    // sk-551.3 — the way back is the folded column itself, named after it.
    expect(
      within(done!).getByRole('button', {
        name: i18n.t('tasks:kanban.showAllStatusesFor', { name: 'Done' }),
      }),
    ).toBeTruthy();
  });

});
