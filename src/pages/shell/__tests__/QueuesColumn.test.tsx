/**
 * Stage-1 visual review — the Queues column header and its queue
 * picker.
 *
 * Before this, the column opened with a bare row of four tab pills: no
 * title (the only column in the shell without one) and, at the default
 * width, two rows of pills. It now carries a `Queues N` heading in the
 * shape the Projects / Tasks columns use, plus ONE `<Select>` listing
 * the four queues with their counters.
 *
 * What is pinned here is exactly what the change promised and what a
 * refactor could silently take away:
 *
 *   1. the heading exists and carries the cross-queue total;
 *   2. the picker is a real combobox with an accessible name, and the
 *      SELECTED queue (with its count) is readable while the list is
 *      closed — a picker that only reads once opened is worse than the
 *      tab row it replaced;
 *   3. every queue is offered with its own counter;
 *   4. picking a queue switches the body — including via keyboard;
 *   5. the collapse affordance still folds the column to its sliver.
 *
 * The four queue hooks are mocked with distinct counts so a count that
 * gets wired to the wrong queue fails loudly instead of matching by
 * coincidence.
 */

import type { ReactNode } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const query = <T,>(data: T) => ({
  data,
  isLoading: false,
  isError: false,
  isSuccess: true,
  error: null,
});

/** Three unaccepted issues → Inbox count 3. */
vi.mock('../../../lib/useInbox', () => ({
  inboxQueryKey: ['inbox', 'assigned-to-me-unaccepted-open'] as const,
  useInbox: () => ({
    data: {
      items: [1, 2, 3].map((n) => ({
        id: `sk-${n}`,
        projectId: 'p1',
        parentIdCurrent: null,
        version: 1,
        title: `Incoming ${n}`,
        type: 'task',
        priority: 3,
        status: 'open',
        pinned: false,
        componentIds: [],
        labels: [],
        updatedAt: '2026-05-01T10:00:00Z',
        createdAt: '2026-05-01T09:00:00Z',
      })),
      hasMore: false,
      nextCursor: null,
    },
    isLoading: false,
    isError: false,
    isSuccess: true,
    error: null,
  }),
}));

/** Two unread outbox notifications on one issue → Outbox count 2. */
vi.mock('../../../lib/useOutbox', () => ({
  outboxQueryKey: ['outbox'] as const,
  // `<OutboxCard>` lazily pulls the already-read events of an issue;
  // an idle query keeps it on the unread ones the feed handed it.
  useIssueNotifications: () => query(undefined),
  useOutbox: () =>
    query({
      items: [1, 2].map((n) => ({
        id: n,
        type: 'issue.updated',
        createdAt: '2026-05-01T10:00:00Z',
        readAt: null,
        archivedAt: null,
        actor: { id: 'u-2', username: 'bob' },
        entity: {
          id: 'sk-9',
          projectId: 'p1',
          projectIdPrefix: 'sk',
          title: 'Delegated work',
          type: 'task',
          status: 'open',
          priority: 3,
        },
        summary: `bob updated sk-9 (${n})`,
        field: null,
        oldValue: null,
        newValue: null,
      })),
      hasMore: false,
      nextCursor: null,
    }),
}));

/** One unread mention → Mentions count 1. */
vi.mock('../../../lib/useMentions', () => ({
  mentionsQueryKey: ['mentions'] as const,
  useMentions: () =>
    query({
      items: [
        {
          id: 11,
          type: 'comment.mention',
          createdAt: '2026-05-01T10:00:00Z',
          readAt: null,
          archivedAt: null,
          actor: { id: 'u-2', username: 'bob' },
          mentionContext: 'ping @admin',
          entity: {
            id: 'sk-7',
            projectId: 'p1',
            projectIdPrefix: 'sk',
            title: 'Mentioned issue',
            type: 'task',
            status: 'open',
            priority: 3,
          },
          summary: 'bob mentioned you in sk-7',
          field: null,
          oldValue: null,
          newValue: null,
        },
      ],
      hasMore: false,
      nextCursor: null,
    }),
}));

/** Watching is a subscription list: 4 unread events on one issue. */
vi.mock('../../../lib/useWatching', () => ({
  watchingQueryKey: ['watching'] as const,
  useWatching: () =>
    query({
      items: [
        {
          item: {
            id: 'sk-5',
            projectId: 'p1',
            parentIdCurrent: null,
            version: 1,
            title: 'Watched issue',
            type: 'task',
            priority: 3,
            status: 'open',
            pinned: false,
            componentIds: [],
            labels: [],
            updatedAt: '2026-05-01T10:00:00Z',
            createdAt: '2026-05-01T09:00:00Z',
          },
          reasons: ['manual'],
          unreadEventsCount: 4,
          recentEvents: [],
        },
      ],
      // sk-303.13 (T028 / INV-3) — the badge is the response's OWN
      // uncapped total, not a sum over the cards: the server caps the
      // cards at 100 and counts the badge over every subscription.
      unreadTotal: 4,
      subscriptionsTotal: 1,
      truncated: false,
      hasMore: false,
      nextCursor: null,
    }),
}));

vi.mock('../../../lib/useProjectsList', () => ({
  projectsListQueryKey: ['projects', 'list', 'shell'] as const,
  useProjectsList: () =>
    query({
      items: [{ id: 'p1', idPrefix: 'sk', name: 'Skein' }],
      total: 1,
      hasMore: false,
      nextCursor: null,
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

vi.mock('../../../lib/useReminders', () => ({
  useRingingIssueIds: () => new Set<string>(),
}));

import { InboxColumn } from '../InboxColumn';
import { LayoutProvider, useLayoutState } from '../../../lib/useLayoutState';

/** Mounts the column with real layout state (collapse flag included). */
function Harness() {
  const { inboxCollapsed } = useLayoutState();
  return <InboxColumn collapsed={inboxCollapsed} width={280} />;
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

function renderColumn() {
  return render(
    <Wrapper>
      <Harness />
    </Wrapper>,
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('Queues column — header', () => {
  test('the column has a heading, like Projects and Tasks do', () => {
    renderColumn();
    expect(screen.getByText('Queues')).toBeTruthy();
  });

  test('the heading counts every unread across the queues', () => {
    renderColumn();
    // 3 inbox + 1 mention + 4 watching. (Outbox contributed 2 until
    // sk-303.13 / US-9 removed the queue.)
    const chip = screen.getByText('8');
    expect(chip.className).toContain('col-header-count');
    // A bare "8" next to "Queues" is ambiguous to a screen reader.
    expect(chip.getAttribute('aria-label')).toBe('8 unread across all queues');
  });

  test('the collapse button still folds the column to its sliver', () => {
    renderColumn();
    fireEvent.click(screen.getByLabelText('Collapse Queues column'));
    // The sliver replaces the whole column with one re-expand button…
    expect(screen.queryByRole('textbox', { name: 'Queue' })).toBeNull();
    const sliver = screen.getByLabelText(/Expand Queues column/);
    expect(sliver.tagName).toBe('BUTTON');
    expect(sliver.getAttribute('aria-expanded')).toBe('false');
  });

  // The folded column used to spell out every queue (`Inbox 3 /
  // Mentions 1 / …`) — a leftover from when it had no name of its own.
  // It now says what the column IS, carrying the same cross-queue
  // total the expanded header carries, exactly like the Projects
  // sliver beside it.
  test('the sliver names the column and carries the cross-queue total', () => {
    renderColumn();
    fireEvent.click(screen.getByLabelText('Collapse Queues column'));

    const sliver = screen.getByLabelText(/Expand Queues column/);
    expect(within(sliver).getByText('Queues')).toBeTruthy();
    // Same 3 + 1 + 4 the expanded heading shows — one source.
    const chip = within(sliver).getByText('8');
    expect(chip.className).toContain('col-inbox-sliver-count');
    // …and the per-queue split survives in the accessible name.
    expect(sliver.getAttribute('aria-label')).toBe(
      'Expand Queues column — 8 unread: Inbox 3, Mentions 1, Watching 4',
    );
  });
});

describe('Queues column — queue picker', () => {
  test('one combobox replaces the four tab pills', () => {
    renderColumn();
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    const input = screen.getByRole('textbox', { name: 'Queue' });
    expect(input).toBeTruthy();
  });

  test('the selected queue and its count read without opening the list', () => {
    renderColumn();
    const input = screen.getByRole('textbox', { name: 'Queue' }) as HTMLInputElement;
    expect(input.value).toBe('Inbox 3');
  });

  test('every queue is offered, each with its own count', () => {
    renderColumn();
    fireEvent.click(screen.getByRole('textbox', { name: 'Queue' }));
    const options = screen.getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([
      'Inbox3',
      'Mentions1',
      'Watching4',
    ]);
  });

  test('picking a queue switches the body', () => {
    renderColumn();
    fireEvent.click(screen.getByRole('textbox', { name: 'Queue' }));
    fireEvent.click(screen.getByRole('option', { name: /Mentions/ }));
    const input = screen.getByRole('textbox', { name: 'Queue' }) as HTMLInputElement;
    expect(input.value).toBe('Mentions 1');
    // The mention card for the mocked notification is on screen…
    expect(screen.getByText('Mentioned issue')).toBeTruthy();
    // …and the panel names the queue it is showing.
    const panel = screen.getByRole('region', { name: 'Mentions queue' });
    expect(within(panel).getByText('Mentioned issue')).toBeTruthy();
  });

  test('the queue can be changed from the keyboard alone', () => {
    renderColumn();
    const input = screen.getByRole('textbox', { name: 'Queue' }) as HTMLInputElement;
    input.focus();
    // ArrowDown opens the list and moves through the options; Enter commits.
    // Mantine's combobox keyboard handler reads `event.code`, not
    // `event.key` — a keyDown without `code` is silently ignored, which
    // would make this test pass vacuously in the "nothing happened"
    // direction if the assertion ever flipped to a negative one.
    fireEvent.keyDown(input, { key: 'ArrowDown', code: 'ArrowDown' });
    // First ArrowDown opens the list on the CURRENT selection (Inbox);
    // the second moves one down, Enter commits it.
    expect(screen.getAllByRole('option')).toHaveLength(3);
    fireEvent.keyDown(input, { key: 'ArrowDown', code: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    expect(input.value).toBe('Mentions 1');
  });
});
