/**
 * A filter chip announces whether it is picked.
 *
 * The app has two kinds of filter chip. A one-of-N row (the task list's
 * quick list) is a `radiogroup` of `radio` chips, and the picked one is
 * `aria-checked="true"`. A row of independent toggles (the activity
 * ticker's intent filters) is a `group` of buttons, and each one's state
 * is `aria-pressed`. Screen readers hear exactly that attribute, so it
 * has to follow the user's pick.
 *
 * Replaces the source scan removed at sk-540.11: this renders the
 * consumers and picks a chip. The comment
 * thread's Humans / Agents toggles are already covered this way in
 * `CommentsSection.test.tsx`, and arrow-key picking in the quick list in
 * `TaskFilters.chipKeys.test.tsx`; this file covers picking by click.
 */

import { ReactNode, useState } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../../api/dashboard', () => ({
  getDashboardScoring: vi.fn().mockResolvedValue({
    window: '24h',
    scope: {},
    metrics: [],
    leaderboards: { closed_human_driven: [], closed_with_commits: [] },
    matrixUsers: [],
  }),
  getDashboardFeed: vi.fn().mockResolvedValue({ items: [] }),
  getDashboardInProgress: vi.fn().mockResolvedValue({ items: [] }),
  getDashboardAgents: vi.fn().mockResolvedValue({ items: [] }),
  getDashboardRace: vi.fn().mockResolvedValue({
    metric: 'closed',
    window: '30d',
    effectiveStart: '2026-04-24T00:00:00Z',
    effectiveEnd: '2026-05-24T00:00:00Z',
    isColdStart: false,
    users: [],
    others: { userCount: 0, total: 0, points: [] },
  }),
  getDashboardProjects: vi.fn().mockResolvedValue({
    window: '24h',
    all: {
      redacted: false,
      events: { count: 0, contributors: [] },
      commits: { count: 0, contributors: [] },
      issuesOpened: { count: 0, contributors: [] },
      issuesClosed: { count: 0, contributors: [] },
      activeAgents: { count: 0, contributors: [] },
    },
    rows: [],
  }),
}));
vi.mock('../../../hooks/useLiveEvents', () => ({ useLiveEventsState: () => 'connected' }));
vi.mock('../../../auth/AuthContext', () => ({ useAuthOptional: () => null }));

import { en } from '../../../i18n/locales/en';
import type { StatusFilter } from '../../../api/issues';
import { ActivityDashboard } from '../../activity/ActivityDashboard';
import { TaskFilters, type TaskFiltersProps } from '../TaskFilters';

afterEach(cleanup);

function filterProps(): TaskFiltersProps {
  return {
    search: '',
    onSearchChange: vi.fn(),
    statusFilter: 'open',
    onStatusChange: vi.fn(),
    originFilter: 'all',
    onOriginChange: vi.fn(),
    typeFilter: 'all',
    onTypeChange: vi.fn(),
    priorityFilter: 'all',
    onPriorityChange: vi.fn(),
    view: 'cards',
    sort: 'updated',
    onSortChange: vi.fn(),
    showAssigneeRow: false,
    assigneeOptions: [],
    assigneeFilter: null,
    onAssigneeChange: vi.fn(),
    searchActive: false,
    filtersEnabled: true,
    withinFilters: false,
    onWithinFiltersToggle: vi.fn(),
    allProjects: false,
    onAllProjectsToggle: vi.fn(),
    allProjectsDisabled: false,
    searchDegraded: false,
    onSearchPaste: vi.fn(),
    blobActive: false,
    collapsed: false,
    onToggleCollapsed: vi.fn(),
    filtersLayout: 'chips',
    onFiltersLayoutChange: vi.fn(),
  };
}

/** The status filter held in state, the way the Tasks column holds it. */
function StatefulFilters() {
  const [status, setStatus] = useState<StatusFilter>('open');
  return (
    <MantineProvider forceColorScheme="dark">
      <TaskFilters {...filterProps()} statusFilter={status} onStatusChange={setStatus} />
    </MantineProvider>
  );
}

const checkedIn = (group: HTMLElement): string[] =>
  within(group)
    .getAllByRole('radio')
    .filter((el) => el.getAttribute('aria-checked') === 'true')
    .map((el) => el.textContent ?? '');

describe('one-of-N chips: the clicked chip becomes the one checked', () => {
  test('the quick list status row', () => {
    render(<StatefulFilters />);
    const row = screen.getByRole('radiogroup', { name: en.filters.labels.status });
    expect(checkedIn(row)).toEqual([en.filters.status.open]);

    fireEvent.click(within(row).getByRole('radio', { name: en.filters.status.in_progress }));
    expect(checkedIn(row)).toEqual([en.filters.status.in_progress]);

    fireEvent.click(within(row).getByRole('radio', { name: en.filters.status.closed }));
    expect(checkedIn(row)).toEqual([en.filters.status.closed]);
  });
});

function Wrap({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <MantineProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter>{children}</MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>
  );
}

describe('independent toggles: aria-pressed follows each chip on its own', () => {
  test('the activity ticker intent filters', async () => {
    render(
      <Wrap>
        <ActivityDashboard />
      </Wrap>,
    );
    const group = await screen.findByRole('group', { name: 'Intent filters' });
    const pressed = () =>
      Object.fromEntries(
        within(group)
          .getAllByRole('button')
          .map((b) => [b.textContent, b.getAttribute('aria-pressed')]),
      );

    // All three axes are shown on arrival.
    expect(pressed()).toEqual({ Humans: 'true', Directed: 'true', Autonomous: 'true' });

    // Turning one off leaves the others as they were.
    fireEvent.click(within(group).getByRole('button', { name: 'Directed' }));
    await waitFor(() =>
      expect(pressed()).toEqual({ Humans: 'true', Directed: 'false', Autonomous: 'true' }),
    );

    // And it comes back on.
    fireEvent.click(within(group).getByRole('button', { name: 'Directed' }));
    await waitFor(() =>
      expect(pressed()).toEqual({ Humans: 'true', Directed: 'true', Autonomous: 'true' }),
    );
  });
});
