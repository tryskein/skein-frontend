/**
 * sk-551.11 — an explicit pick in the Projects column ends the Budilnik
 * lens; nothing else does.
 *
 * Expected behaviour is the task's acceptance:
 *   - Budilnik on → a click on a project, a component or «All projects»
 *     turns it off and lands on the picked surface;
 *   - a click on a task in the Budilnik list keeps it on;
 *   - Back / Forward keep it on (the switch-off lives in the click
 *     handlers, not on a URL change);
 *   - On me / Delegated stay on when a project is picked.
 *
 * The column and the lens body are rendered for real under
 * `LayoutProvider` + a memory router; only the network hooks are mocked.
 * The probe reads the lens back from layout state and the address from
 * the router, which is what the Tasks column and the header read.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';

import type { ProjectListItem } from '../../../api/projects';
import type { Component } from '../../../api/components';
import type { Reminder } from '../../../api/reminders';
import { LayoutProvider, useLayoutState } from '../../../lib/useLayoutState';
import { ProjectsColumn } from '../ProjectsColumn';
import { BudilnikLensBody } from '../BudilnikLensBody';

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
];

const REMINDERS: Reminder[] = [
  {
    id: 'rem-1',
    issueId: 'back-7',
    issueTitle: 'Renew the certificate',
    issueStatus: 'open',
    projectId: 'proj-uuid-2',
    issueType: 'task',
    issuePriority: 2,
    remindAt: '2026-01-01T00:00:00Z',
    notifiedAt: '2026-01-01T00:00:00Z',
    snoozeCount: 0,
    state: 'ringing',
  },
];

vi.mock('../../../lib/useProjectsList', async (importActual) => ({
  ...(await importActual<typeof import('../../../lib/useProjectsList')>()),
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
  useProjectsList: () => ({ data: { items: PROJECTS } }),
}));

vi.mock('../../../lib/useReminders', async (importActual) => ({
  ...(await importActual<typeof import('../../../lib/useReminders')>()),
  useRemindersList: () => ({
    reminders: REMINDERS,
    ringingTaskCount: REMINDERS.length,
    isLoading: false,
    error: null,
  }),
}));

vi.mock('../../../api/components', () => ({
  listComponents: async (projectId: string) =>
    COMPONENTS.filter((c) => c.projectId === projectId),
}));

/** Lens and address as the rest of the shell sees them, plus a Back button. */
function Probe() {
  const layout = useLayoutState();
  const location = useLocation();
  const navigate = useNavigate();
  const lens = layout.budilnikMode
    ? 'budilnik'
    : layout.onMeMode
      ? 'on-me'
      : layout.outboxMode
        ? 'delegated'
        : 'none';
  return (
    <>
      <output data-testid="lens">{lens}</output>
      <output data-testid="address">{location.pathname + location.search}</output>
      <button type="button" onClick={() => navigate(-1)}>
        history back
      </button>
    </>
  );
}

function Surface() {
  const layout = useLayoutState();
  return (
    <>
      <Probe />
      <ProjectsColumn width={280} collapsed={false} />
      {layout.budilnikMode ? <BudilnikLensBody selectedIssueId={layout.selectedIssue} /> : null}
    </>
  );
}

function renderAt(entries: string[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const shell = (
    <LayoutProvider>
      <Surface />
    </LayoutProvider>
  );
  return render(
    <MantineProvider forceColorScheme="dark">
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
          <Routes>
            <Route path="/" element={shell} />
            <Route path="/projects/:alias" element={shell} />
            <Route path="/projects/:alias/issues/:id" element={shell} />
            <Route path="/projects/:alias/components/:cid" element={shell} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

const lens = () => screen.getByTestId('lens').textContent;
const address = () => screen.getByTestId('address').textContent;

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => cleanup());

describe('sk-551.11 — a Projects-column pick ends the Budilnik lens', () => {
  test.each([
    ['a project', /^Select project Backoffice$/, '/projects/back'],
    ['«All projects»', /^Select all projects$/, '/'],
    ['a component', /^Filter tasks by component gateway$/, '/projects/shop/components/comp-uuid-1'],
  ])('clicking %s turns Budilnik off and shows the pick', async (_what, name, target) => {
    const user = userEvent.setup();
    // The selected project's subtree is on screen whatever the default
    // fold is, so the component row is reachable.
    renderAt(['/projects/shop?lens=budilnik']);
    expect(lens()).toBe('budilnik');

    await user.click(await screen.findByRole('button', { name }));

    await waitFor(() => expect(lens()).toBe('none'));
    expect(address()).toBe(target);
  });

  test('clicking a task in the Budilnik list keeps the lens', async () => {
    const user = userEvent.setup();
    // Inside another project, so the click moves the project too — the
    // side effect the lens has to survive.
    renderAt(['/projects/shop?lens=budilnik']);

    await user.click(
      screen.getByRole('button', { name: 'Open task back-7: Renew the certificate' }),
    );

    await waitFor(() => expect(address()).toBe('/projects/back/issues/back-7?lens=budilnik'));
    expect(lens()).toBe('budilnik');
  });

  test('Back keeps the lens', async () => {
    const user = userEvent.setup();
    renderAt(['/projects/back?lens=budilnik', '/?lens=budilnik']);

    await user.click(screen.getByRole('button', { name: 'history back' }));

    await waitFor(() => expect(address()).toBe('/projects/back?lens=budilnik'));
    expect(lens()).toBe('budilnik');
  });

  test.each([['on-me'], ['delegated']])(
    'picking a project keeps the %s lens',
    async (kept) => {
      const user = userEvent.setup();
      renderAt([`/?lens=${kept}`]);

      await user.click(screen.getByRole('button', { name: /^Select project Backoffice$/ }));

      await waitFor(() => expect(address()).toBe(`/projects/back?lens=${kept}`));
      expect(lens()).toBe(kept);
    },
  );
});
