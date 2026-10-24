/**
 * sk-285.2.6 — the board focused on a handful of projects.
 *
 * The rules asserted here are the ones that make the setting safe to
 * leave switched on:
 *
 *   - a focused board says so, names the projects, and prints what the
 *     focus cost — the same "a filtered list must never look like an
 *     empty one" rule the filter panel's badge follows;
 *   - "all projects" is one click away;
 *   - opening a single project PAUSES the focus rather than intersecting
 *     with it, and the board says which of the two is in force;
 *   - on the project axis the focus is the COLUMN set, so a focused
 *     project with nothing loaded still gets its (empty) column.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { KanbanBoard, type KanbanBoardProps } from '../KanbanBoard';
import type { IssueSummary } from '../../../api/issues';

const MOB = 'uuid-mob';
const PAY = 'uuid-pay';
const SHOP = 'uuid-shop';

const HANDLES = new Map([
  [MOB, 'mob'],
  [PAY, 'pay'],
  [SHOP, 'shop'],
]);

function issue(id: string, projectId: string): IssueSummary {
  return {
    id,
    projectId,
    version: 1,
    title: `title of ${id}`,
    type: 'task',
    priority: 3,
    status: 'open',
    pinned: false,
    componentIds: [],
    labels: [],
    isBlocked: false,
    updatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };
}

const ITEMS: IssueSummary[] = [
  issue('mob-1', MOB),
  issue('pay-1', PAY),
  issue('shop-1', SHOP),
  issue('shop-2', SHOP),
];

function renderBoard(over: Partial<KanbanBoardProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const props: KanbanBoardProps = {
    items: ITEMS,
    axis: 'status',
    statusFilter: 'all',
    onStatusFilterChange: vi.fn(),
    projectHandles: HANDLES,
    selectedIssueId: null,
    onSelect: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    ...over,
  };
  const utils = render(
    <QueryClientProvider client={client}>
      <MantineProvider forceColorScheme="dark">
        <MemoryRouter>
          <KanbanBoard {...props} />
        </MemoryRouter>
      </MantineProvider>
    </QueryClientProvider>,
  );
  return { ...utils, props };
}

/**
 * The focus bar, or null. Queried by class rather than by
 * `getByRole('status')`: dnd-kit mounts its own `role="status"` live
 * region on every board, so the role alone is ambiguous here.
 */
function focusBar(): HTMLElement | null {
  return document.querySelector('.kanban-focus-bar');
}

/** Card titles currently on the board, in DOM order. */
function cardTitles(): string[] {
  return [...document.querySelectorAll('.kanban-card-title')].map(
    (n) => n.textContent ?? '',
  );
}

afterEach(() => cleanup());

describe('KanbanBoard — project focus', () => {
  test('no focus: every project is on the board and nothing is announced', () => {
    renderBoard();
    expect(cardTitles()).toHaveLength(4);
    expect(focusBar()).toBeNull();
  });

  test('a focus narrows the board AND states itself, projects and cost', () => {
    renderBoard({ projectFocus: new Set([MOB, PAY]) });
    expect(cardTitles()).toEqual(['title of mob-1', 'title of pay-1']);

    const bar = focusBar()!;
    // Named by handle, not by uuid — the label the user knows.
    expect(bar.textContent).toContain('mob, pay');
    // And the two rows it took are counted, so a narrowed board can
    // never read as a small one.
    expect(bar.textContent).toContain('2 tasks hidden');
  });

  test('an unresolvable project id still shows as focused rather than vanishing', () => {
    renderBoard({ projectFocus: new Set(['uuid-of-a-deleted-project']) });
    expect(cardTitles()).toHaveLength(0);
    // The tail, not the head — that is the part that tells two ids apart.
    expect(focusBar()!.textContent).toContain('…-project');
  });

  test('"all projects" is one click', () => {
    const onClearProjectFocus = vi.fn();
    renderBoard({ projectFocus: new Set([MOB]), onClearProjectFocus });
    fireEvent.click(screen.getByRole('button', { name: 'All projects' }));
    expect(onClearProjectFocus).toHaveBeenCalledTimes(1);
  });

  test('an open project PAUSES the focus — nothing is hidden and the board says why', () => {
    renderBoard({ projectFocus: new Set([MOB, PAY]), projectFocusPausedBy: 'shop' });
    // The Projects column has already narrowed the query; the board must
    // not narrow it a second time, or picking `shop` while focused on
    // `mob`+`pay` would blank a board nobody asked to blank.
    expect(cardTitles()).toHaveLength(4);
    const bar = focusBar()!;
    expect(bar.textContent).toContain('paused');
    expect(bar.textContent).toContain('shop');
  });

  test('the paused board offers the way out — back to all projects', () => {
    const onShowAllProjects = vi.fn();
    renderBoard({
      projectFocus: new Set([MOB]),
      projectFocusPausedBy: 'shop',
      onShowAllProjects,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Back to all projects' }));
    expect(onShowAllProjects).toHaveBeenCalledTimes(1);
  });

  test('an empty focus never renders the bar, open project or not', () => {
    renderBoard({ projectFocus: new Set(), projectFocusPausedBy: 'shop' });
    expect(focusBar()).toBeNull();
  });

  test('on the project axis the focus IS the column set — empty ones included', () => {
    renderBoard({
      axis: 'project',
      // `pay` has one row, `shop` is focused but has nothing loaded here.
      items: [issue('mob-1', MOB), issue('pay-1', PAY)],
      projectFocus: new Set([PAY, SHOP]),
    });
    const names = screen
      .getAllByRole('region')
      .map((c) => c.getAttribute('aria-label') ?? '');
    expect(names).toHaveLength(2);
    expect(names.join(' ')).toContain('pay');
    expect(names.join(' ')).toContain('shop');
  });
});
