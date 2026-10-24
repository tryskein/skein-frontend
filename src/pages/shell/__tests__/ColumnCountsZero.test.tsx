/**
 * Column counters print their number at EVERY value, zero included.
 *
 * The shell used to hide the count chip when it read 0 (`total > 0 ?
 * <chip> : null`), in every column header and in every sliver. A column
 * that shows no number at all cannot be told from one whose count never
 * arrived — the exact ambiguity the header rail already fixed for its
 * queue badges. So the chip now always renders, and "empty" is carried
 * by tone and weight instead of by presence (not asserted here: paint is
 * not checked by tests).
 *
 * What is pinned here is what a refactor could silently take back:
 *   1. an empty Projects column prints "0" in its header AND in its
 *      sliver;
 *   2. the same for the Queues column's cross-queue total;
 *   3. the accessible name of a folded column still carries the count —
 *      "0 projects" is information, silence is not;
 *
 * Both columns are rendered for real (LayoutProvider + router); only the
 * network hooks are mocked, all of them empty.
 */

import type { ReactNode } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('../../../lib/useInbox', () => ({
  inboxQueryKey: ['inbox', 'assigned-to-me-unaccepted-open'] as const,
  useInbox: () => ({
    data: { items: [], hasMore: false, nextCursor: null },
    isLoading: false,
    isError: false,
    isSuccess: true,
    error: null,
  }),
}));

vi.mock('../../../lib/useOutbox', () => ({
  outboxQueryKey: ['outbox'] as const,
  useIssueNotifications: () => ({
    data: undefined,
    isLoading: false,
    isError: false,
    isSuccess: true,
    error: null,
  }),
  useOutbox: () => ({
    data: { items: [], hasMore: false, nextCursor: null },
    isLoading: false,
    isError: false,
    isSuccess: true,
    error: null,
  }),
}));

vi.mock('../../../lib/useMentions', () => ({
  mentionsQueryKey: ['mentions'] as const,
  useMentions: () => ({
    data: { items: [], hasMore: false, nextCursor: null },
    isLoading: false,
    isError: false,
    isSuccess: true,
    error: null,
  }),
}));

vi.mock('../../../lib/useWatching', () => ({
  watchingQueryKey: ['watching'] as const,
  useWatching: () => ({
    data: { items: [], hasMore: false, nextCursor: null },
    isLoading: false,
    isError: false,
    isSuccess: true,
    error: null,
  }),
}));

/** No projects at all — the case the old code rendered as a bare title. */
vi.mock('../../../lib/useProjectsList', () => ({
  projectsListQueryKey: ['projects', 'list', 'shell'] as const,
  useProjectsList: () => ({
    data: { items: [], total: 0, hasMore: false, nextCursor: null },
    isLoading: false,
    isError: false,
    isSuccess: true,
    error: null,
  }),
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

vi.mock('../../../api/components', () => ({
  listComponents: async () => [],
}));

vi.mock('../../../lib/useReminders', () => ({
  useRingingIssueIds: () => new Set<string>(),
}));

import { InboxColumn } from '../InboxColumn';
import { ProjectsColumn } from '../ProjectsColumn';
import { LayoutProvider, useLayoutState } from '../../../lib/useLayoutState';

function ProjectsHost() {
  const { projectsCollapsed } = useLayoutState();
  return <ProjectsColumn width={280} collapsed={projectsCollapsed} />;
}

function QueuesHost() {
  const { inboxCollapsed } = useLayoutState();
  return <InboxColumn width={280} collapsed={inboxCollapsed} />;
}

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return (
    <MantineProvider>
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

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('Projects column — the count is printed at zero', () => {
  test('the header keeps its chip instead of dropping it', () => {
    const { container } = render(
      <Wrapper>
        <ProjectsHost />
      </Wrapper>,
    );

    const chip = container.querySelector('.col-projects-header .col-header-count')!;
    expect(chip).toBeTruthy();
    expect(chip.textContent).toBe('0');
  });

  test('the sliver carries the same zero, and says it in its name', () => {
    const { container } = render(
      <Wrapper>
        <ProjectsHost />
      </Wrapper>,
    );

    fireEvent.click(screen.getByLabelText('Collapse Projects column'));

    const sliver = screen.getByLabelText(/Expand Projects column/);
    const chip = container.querySelector('.col-projects-sliver-count')!;
    expect(chip.textContent).toBe('0');
    // The folded column announces the count even when it is nothing.
    expect(sliver.getAttribute('aria-label')).toBe(
      'Expand Projects column — 0 projects',
    );
  });
});

describe('Queues column — the cross-queue total is printed at zero', () => {
  test('the header keeps its chip, with the count spelled out', () => {
    const { container } = render(
      <Wrapper>
        <QueuesHost />
      </Wrapper>,
    );

    const chip = container.querySelector('.col-queues-header .col-header-count')!;
    expect(chip.textContent).toBe('0');
    expect(chip.getAttribute('aria-label')).toBe('0 unread across all queues');
  });

  test('every queue in the picker shows its own zero', () => {
    render(
      <Wrapper>
        <QueuesHost />
      </Wrapper>,
    );

    // Closed control: the selected queue still reads "<name> <count>".
    const input = screen.getByRole('textbox', { name: 'Queue' }) as HTMLInputElement;
    expect(input.value).toBe('Inbox 0');

    fireEvent.click(input);
    for (const label of ['Inbox', 'Mentions', 'Watching']) {
      const option = screen.getByRole('option', { name: new RegExp(`^${label}`) });
      expect(within(option).getByText('0')).toBeTruthy();
    }
  });

  test('the sliver carries the zero total too', () => {
    const { container } = render(
      <Wrapper>
        <QueuesHost />
      </Wrapper>,
    );

    fireEvent.click(screen.getByLabelText('Collapse Queues column'));

    const sliver = screen.getByLabelText(/Expand Queues column/);
    const chip = container.querySelector('.col-inbox-sliver-count')!;
    expect(chip.textContent).toBe('0');
    expect(sliver.getAttribute('aria-label')).toBe(
      'Expand Queues column — 0 unread: Inbox 0, Mentions 0, Watching 0',
    );
  });
});
