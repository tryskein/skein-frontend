
import { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { MySpace, MySpacesResponse } from '../../api/spaces';
import type { ListProjectsResult, ProjectListItem } from '../../api/projects';
import i18n from '../../i18n/config';

// sk-674.18 T056 — the signed-in person, «my spaces» and the projects
// list, set per test; the suites before T056 keep no identity, so the page
// behaves for them as with one space.
const spacesWorld = vi.hoisted(() => ({
  auth: null as { user: { id: string; username: string } } | null,
  spaces: [] as unknown[],
  spacesAnswered: 0,
  projects: [] as unknown[],
  projectsAnswered: 0,
}));
vi.mock('../../api/spaces', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/spaces')>();
  return {
    ...actual,
    getMySpaces: async (): Promise<MySpacesResponse> => {
      spacesWorld.spacesAnswered += 1;
      return {
        items: spacesWorld.spaces as MySpace[],
        ownedCount: 0,
        ownedLimit: null,
        canCreate: true,
        cannotCreateReason: null,
      };
    },
  };
});
vi.mock('../../api/projects', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/projects')>();
  return {
    ...actual,
    listProjects: async (): Promise<ListProjectsResult> => {
      spacesWorld.projectsAnswered += 1;
      return {
        items: spacesWorld.projects as ProjectListItem[],
        total: spacesWorld.projects.length,
        nextCursor: null,
      } as unknown as ListProjectsResult;
    },
  };
});

// Mock the dashboard + activity API surface and the LiveEvents hook.
vi.mock('../../api/dashboard', async () => {
  return {
    getDashboardScoring: vi.fn(),
    getDashboardFeed: vi.fn(),
    getDashboardInProgress: vi.fn().mockResolvedValue({ items: [] }),
    getDashboardAgents: vi.fn().mockResolvedValue({ items: [] }),
    // sk-29.2 — RaceChart is mounted unconditionally at the top of
    // ActivityDashboard. We're not testing the race chart here (its
    // own suite covers it), so feed an empty-state result — the chart
    // renders a placeholder line, no SVG, no extra DOM noise.
    getDashboardRace: vi.fn().mockResolvedValue({
      metric: 'closed',
      window: '30d',
      effectiveStart: '2026-04-24T00:00:00Z',
      effectiveEnd: '2026-05-24T00:00:00Z',
      isColdStart: false,
      users: [],
      others: { userCount: 0, total: 0, points: [] },
    }),
    // sk-183.2 — Projects zone default: empty leaderboard (just the
    // ALL PROJECTS summary row, no per-project rows). Individual tests
    // override with `mockedProjects.mockResolvedValue(...)` when they
    // need real rows — same convention as `getDashboardAgents` above.
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
  };
});
vi.mock('../../hooks/useLiveEvents', () => {
  return {
    useLiveEventsState: () => 'connected',
  };
});
// sk-303.15 — `useAuth` is no longer mocked: the page stopped reading the
// caller when profile links went away with `/legacy/users/:username`, so a
// stub for it would describe scaffolding rather than the page. What stays is
// `useAuthOptional`, which `useTheme` calls here (sk-285.7 T013): `null` means
// "no identity", i.e. this suite never triggers the migrated-theme write-back.
vi.mock('../../auth/AuthContext', () => {
  return {
    useAuthOptional: () => spacesWorld.auth,
  };
});

import {
  getDashboardAgents,
  getDashboardFeed,
  getDashboardInProgress,
  getDashboardProjects,
  getDashboardRace,
  getDashboardScoring,
  type AgentsResult,
  type DashboardFeedResponse,
  type ProjectsResult,
  type ScoringResult,
} from '../../api/dashboard';
import { ActivityDashboard } from './ActivityDashboard';
import { createProjectDeclaration, ProjectDeclarationContext } from '../../lib/liveProjectDeclaration';
import {
  publishDashboardPurge,
  publishEnvelopeToDashboard,
  _resetDashboardBusForTests,
} from '../../lib/dashboardEventBus';
import { resetAfterAccessLoss } from '../../lib/accessLoss';

const mockedScoring = vi.mocked(getDashboardScoring);
const mockedFeed = vi.mocked(getDashboardFeed);
const mockedAgents = vi.mocked(getDashboardAgents);
const mockedProjects = vi.mocked(getDashboardProjects);

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

function scoring(): ScoringResult {
  return {
    window: '24h',
    scope: {},
    metrics: [
      { key: 'issues_created', human: 8, agent_directed: 3, agent_autonomous: 45 },
      { key: 'issues_closed', human: 5, agent_directed: 2, agent_autonomous: 38 },
      { key: 'issues_closed_with_commits', human: 3, agent_directed: 1, agent_autonomous: 18 },
      { key: 'comments_authored', human: 12, agent_directed: 7, agent_autonomous: 65 },
      { key: 'comments_on_others_issues', human: 9, agent_directed: 4, agent_autonomous: 12 },
      { key: 'mentions_sent', human: 3, agent_directed: 1, agent_autonomous: 0 },
      { key: 'dep_edges_added', human: 1, agent_directed: 2, agent_autonomous: 8 },
    ],
    leaderboards: {
      closed_human_driven: [
        { username: 'alice', count: 7 },
        { username: 'bob', count: 3 },
      ],
      closed_with_commits: [{ username: 'alice', count: 4 }],
    },
    matrixUsers: [
      {
        username: 'alice',
        issuesCreatedHuman: 3,
        issuesCreatedDirected: 1,
        issuesCreatedAutonomous: 10,
        issuesClosedHuman: 5,
        issuesClosedDirected: 2,
        issuesClosedAutonomous: 6,
        closedWithCommitsHuman: 3,
        closedWithCommitsDir: 1,
        closedWithCommitsAuto: 2,
        commentsHuman: 8,
        commentsDirected: 4,
        commentsAutonomous: 12,
        closedHumanDriven: 7,
      },
    ],
  };
}

/**
 * sk-183.2 — sample ProjectsResult: ALL PROJECTS summary + one visible
 * project row + one redacted row. Per the backend contract, a redacted
 * row hides ONLY project identity — every metric/count/contributor
 * username stays real, which this fixture models explicitly (the
 * redacted row's numbers/contributors are deliberately non-zero and
 * distinctive so a test can assert they're still rendered).
 */
function projectsResult(): ProjectsResult {
  return {
    window: '24h',
    all: {
      redacted: false,
      events: {
        count: 551,
        contributors: [
          { username: 'alice', count: 300 },
          { username: 'bob', count: 251 },
        ],
      },
      commits: { count: 34, contributors: [{ username: 'alice', count: 34 }] },
      issuesOpened: { count: 23, contributors: [{ username: 'alice', count: 23 }] },
      issuesClosed: { count: 17, contributors: [{ username: 'alice', count: 17 }] },
      activeAgents: { count: 9, contributors: [{ username: 'alice', count: 9 }] },
      topActor: { username: 'alice', count: 300 },
    },
    rows: [
      {
        projectId: 'p-acm',
        projectName: 'acme',
        projectPrefix: 'acm',
        redacted: false,
        events: { count: 214, contributors: [{ username: 'alice', count: 200 }] },
        commits: { count: 19, contributors: [{ username: 'alice', count: 19 }] },
        issuesOpened: { count: 12, contributors: [{ username: 'alice', count: 12 }] },
        issuesClosed: { count: 9, contributors: [{ username: 'alice', count: 9 }] },
        activeAgents: { count: 5, contributors: [{ username: 'alice', count: 5 }] },
        topActor: { username: 'alice', count: 200 },
      },
      {
        // No projectId/projectName/projectPrefix — the server drops
        // project-identity fields entirely on a redacted row. Every
        // other field stays populated with real (distinctive) data.
        redacted: true,
        events: { count: 96, contributors: [{ username: 'carol', count: 96 }] },
        commits: { count: 8, contributors: [{ username: 'carol', count: 8 }] },
        issuesOpened: { count: 4, contributors: [{ username: 'carol', count: 4 }] },
        issuesClosed: { count: 3, contributors: [{ username: 'carol', count: 3 }] },
        activeAgents: { count: 2, contributors: [{ username: 'carol', count: 2 }] },
        topActor: { username: 'carol', count: 96 },
      },
    ],
  };
}

function feedSample(): DashboardFeedResponse {
  return {
    items: [
      {
        id: 100,
        occurredAt: '2026-05-23T10:00:00Z',
        type: 'issue.closed',
        actor: { userId: null, username: 'alice', type: 'human' },
        entity: {
          type: 'issue',
          id: 'demo-25',
          title: 'Fix login redirect',
          projectId: 'p-1',
          projectIdPrefix: 'demo',
        },
        summary: 'alice closed demo-25 (Fix login redirect)',
        projectId: 'p-1',
      },
      {
        id: 99,
        occurredAt: '2026-05-23T09:59:00Z',
        type: 'comment.created',
        actor: { userId: null, username: 'agent-bob', type: 'agent' },
        entity: {
          type: 'comment',
          id: 'sk-16',
          title: 'Fix done',
          projectId: 'p-1',
          projectIdPrefix: 'sk',
        },
        summary: 'agent-bob commented sk-16',
        projectId: 'p-1',
      },
    ],
    nextCursor: null,
  };
}

beforeEach(() => {
  mockedScoring.mockReset();
  mockedFeed.mockReset();
  spacesWorld.auth = null;
  spacesWorld.spaces = [];
  spacesWorld.spacesAnswered = 0;
  spacesWorld.projects = [];
  spacesWorld.projectsAnswered = 0;
  // sk-17 review fix C2 follow-up — reset the dashboard event bus
  // between tests so a stray listener from a previous run can't
  // capture the next test's mock-published envelope and explode.
  _resetDashboardBusForTests();
});

afterEach(() => {
  cleanup();
});

describe('ActivityDashboard render', () => {
  test('renders podium, throughput matrix, leaderboards, ticker, matrix', async () => {
    mockedScoring.mockResolvedValue(scoring());
    mockedFeed.mockResolvedValue(feedSample());

    render(
      <Wrap>
        <ActivityDashboard />
      </Wrap>,
    );

    // Podium hero — alice appears multiple times (podium + leaderboards
    // + matrix).
    await waitFor(() => {
      const names = screen.getAllByText('alice');
      if (names.length === 0) throw new Error('alice not yet rendered');
    });
    // Throughput row label
    expect(screen.getByText('Issues created')).toBeTruthy();
    // Leaderboard titles
    expect(screen.getByText(/Top 5 · closed \(human \+ directed\)/)).toBeTruthy();
    expect(screen.getByText(/Top 5 · closed with commits/)).toBeTruthy();
    // Live ticker — entries from the feed. The feed resolves on its OWN
    // async path (separate from scoring, which the alice waitFor above
    // gates on), so this MUST await — a synchronous getByRole races the
    // ticker render and flakes under CI-runner load (sk-78).
    expect(await screen.findByRole('link', { name: 'demo-25' })).toBeTruthy();
    // Connection indicator
    expect(screen.getByLabelText(/SignalR connected/)).toBeTruthy();
  });

  test('sk-514 (13) — the ticker table names its seven columns with column headers', async () => {
    mockedScoring.mockResolvedValue(scoring());
    mockedFeed.mockResolvedValue(feedSample());

    render(
      <Wrap>
        <ActivityDashboard />
      </Wrap>,
    );

    await screen.findByRole('link', { name: 'demo-25' });
    const table = screen.getByRole('table', { name: /Live activity ticker/ });
    const headers = within(table).getAllByRole('columnheader');
    expect(headers.map((h) => (h.textContent ?? '').trim())).toEqual([
      'Time',
      'Who',
      'Origin',
      'Action',
      'Entity',
      'Id',
      'Title',
    ]);
    for (const h of headers) expect(h.getAttribute('scope')).toBe('col');
  });

  test('chip filters hide ticker rows by intent axis', async () => {
    mockedScoring.mockResolvedValue(scoring());
    mockedFeed.mockResolvedValue(feedSample());

    render(
      <Wrap>
        <ActivityDashboard />
      </Wrap>,
    );

    await waitFor(() => screen.getByRole('link', { name: 'demo-25' }));

    // Turn off Humans — demo-25 (human actor) should disappear.
    const humansChip = screen.getByRole('button', { name: 'Humans' });
    fireEvent.click(humansChip);
    await waitFor(() => {
      expect(screen.queryByRole('link', { name: 'demo-25' })).toBeNull();
    });
    // Agent rows still visible via the agent-bob ticker entity (sk-16
    // comment renders the entity id as plain text — no link since
    // entity.type is "comment").
    expect(screen.getByText(/agent-bob/)).toBeTruthy();
  });

  test('window tab change triggers scoring refetch', async () => {
    mockedScoring.mockResolvedValue(scoring());
    mockedFeed.mockResolvedValue(feedSample());

    render(
      <Wrap>
        <ActivityDashboard />
      </Wrap>,
    );

    await waitFor(() => expect(mockedScoring).toHaveBeenCalled());
    const initialCalls = mockedScoring.mock.calls.length;

    // sk-17 review fix TS W4 / HTML W2 — WindowTabs migrated from
    // role="tab" (broken tabs pattern, no panel wiring) to
    // role="group" + aria-pressed toggle buttons. Test queries the
    // button by accessible name now.
    //
    // sk-29.2 — RaceChart also renders a `7d` button (in its own
    // Window chip row), and sk-285.7.2.62 turned the global switcher
    // into a `ChipRow` too, so THREE groups are now named "Window".
    // Scope the click by the zone the switcher sits in — the throughput
    // matrix header — which is what tells the three apart.
    const windowTabs = document.querySelector(
      '.activity-throughput-wrap .race-chip-row',
    ) as HTMLElement;
    fireEvent.click(within(windowTabs).getByRole('button', { name: '7d' }));
    await waitFor(() => {
      expect(mockedScoring.mock.calls.length).toBeGreaterThan(initialCalls);
    });
    // Verify 7d was passed as window
    const lastCall = mockedScoring.mock.calls.at(-1);
    expect(lastCall?.[0].window).toBe('7d');
  });

  // sk-674.18 US-19 (screens 1.15, review C2): HOT ZONE keeps a rolling
  // buffer outside the query cache and merges every new answer INTO it, so
  // a row of a lost space the authorized answer omits would stay. On a loss
  // the purge (`accessLoss.ts`: the cache reset, then the bus purge) drops
  // the buffer, and the ticker seeds again from the next answer alone.
  test('sk-674.18 — a loss of access drops the live buffer; the ticker seeds again from the authorized answer', async () => {
    mockedScoring.mockResolvedValue(scoring());
    mockedFeed.mockResolvedValue(feedSample());
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <MantineProvider>
        <QueryClientProvider client={qc}>
          <MemoryRouter>
            <ActivityDashboard />
          </MemoryRouter>
        </QueryClientProvider>
      </MantineProvider>,
    );
    await waitFor(() => screen.getByRole('link', { name: 'demo-25' }));

    // A live row of a space the reader is about to lose.
    publishEnvelopeToDashboard({
      id: 200,
      occurredAt: '2026-05-23T10:01:00Z',
      eventType: 'issue.created',
      entityType: 'issue',
      entityId: 'demo-26',
      projectId: 'p-lost',
      actor: 'carol',
      actorType: 'human',
    });
    await waitFor(() => screen.getByRole('link', { name: 'demo-26' }));

    // The authorized answer after the loss does not carry it.
    act(() => {
      resetAfterAccessLoss(qc);
      publishDashboardPurge();
    });
    expect(await screen.findByRole('link', { name: 'demo-25' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'demo-26' })).toBeNull();
  });

  test('sk-674.18 — a live row still waiting in the 250 ms batch at the loss is dropped too', async () => {
    mockedScoring.mockResolvedValue(scoring());
    mockedFeed.mockResolvedValue(feedSample());
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <MantineProvider>
        <QueryClientProvider client={qc}>
          <MemoryRouter>
            <ActivityDashboard />
          </MemoryRouter>
        </QueryClientProvider>
      </MantineProvider>,
    );
    await waitFor(() => screen.getByRole('link', { name: 'demo-25' }));
    act(() => {
      publishEnvelopeToDashboard({
        id: 201,
        occurredAt: '2026-05-23T10:02:00Z',
        eventType: 'issue.created',
        entityType: 'issue',
        entityId: 'demo-27',
        projectId: 'p-lost',
        actor: 'carol',
        actorType: 'human',
      });
      // Before the batch flushes.
      resetAfterAccessLoss(qc);
      publishDashboardPurge();
    });
    expect(await screen.findByRole('link', { name: 'demo-25' })).toBeTruthy();
    // The batch's flush timer (250 ms) was queued with the row; a timer of
    // the same delay queued after it fires after it — so by then the flush
    // has run, whatever the machine's speed. Nothing of the lost space lands.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 250));
    });
    expect(screen.queryByRole('link', { name: 'demo-27' })).toBeNull();
  });

  test('SignalR push prepends a new ticker row (batched)', async () => {
    mockedScoring.mockResolvedValue(scoring());
    mockedFeed.mockResolvedValue(feedSample());

    render(
      <Wrap>
        <ActivityDashboard />
      </Wrap>,
    );

    await waitFor(() => screen.getByRole('link', { name: 'demo-25' }));

    // Publish a new envelope — the dashboard buffer batches at 250ms.
    publishEnvelopeToDashboard({
      id: 200,
      occurredAt: '2026-05-23T10:01:00Z',
      eventType: 'issue.created',
      entityType: 'issue',
      entityId: 'demo-26',
      projectId: 'p-1',
      actor: 'carol',
      actorType: 'human',
    });

    // Wait for the 250ms batch to flush.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });

    // The new id should now be the topmost item — surfaced via the
    // ticker as a clickable link.
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'demo-26' })).toBeTruthy();
    });
  });

  // sk-622.21 US-12 , matrix row "Dashboard `/activity`": the
  // ticker row is built from the COMPACT envelope alone — author, actor
  // type, title, project prefix — with no network request.
  test('sk-21 — SignalR push envelope with actor/title fields renders enriched row (no "system" fallback)', async () => {
    mockedScoring.mockResolvedValue(scoring());
    mockedFeed.mockResolvedValue(feedSample());

    render(
      <Wrap>
        <ActivityDashboard />
      </Wrap>,
    );

    await waitFor(() => screen.getByRole('link', { name: 'demo-25' }));
    const feedCallsBeforePush = mockedFeed.mock.calls.length;

    // sk-21: outbox dispatcher now populates actor + actorType +
    // actorUserId + entityTitle + projectIdPrefix directly on the
    // envelope (resolved via JOIN at publish time). Frontend should
    // surface those fields verbatim. Pre-sk-21 fallback was the
    // literal string 'system' — guard against the regression here.
    publishEnvelopeToDashboard({
      id: 314,
      occurredAt: '2026-05-23T10:30:00Z',
      eventType: 'issue.closed',
      entityType: 'issue',
      entityId: 'demo-99',
      projectId: 'p-1',
      actor: 'alice',
      actorType: 'agent',
      actorUserId: '5ae08323-abce-4835-9021-2e7e5fdbc64c',
      entityTitle: 'Test enrichment title',
      projectIdPrefix: 'demo',
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'demo-99' })).toBeTruthy();
    });
    // Actor must be the resolved username, NOT the legacy 'system' fallback.
    expect(screen.getAllByText('alice').length).toBeGreaterThan(0);
    expect(screen.queryAllByText('system').length).toBe(0);
    // Title must surface (rendered as «…» in the ticker title cell).
    expect(screen.getByText(/Test enrichment title/)).toBeTruthy();
    // The row itself carries author, actor type and title from the envelope.
    const row = screen.getByRole('link', { name: 'demo-99' }).closest('tr') as HTMLElement;
    expect(within(row).getByText('alice')).toBeTruthy();
    expect(within(row).getByText('agent')).toBeTruthy();
    expect(within(row).getByText('«Test enrichment title»')).toBeTruthy();
    // Built from the envelope, not fetched: the feed was not re-read.
    expect(mockedFeed.mock.calls.length).toBe(feedCallsBeforePush);
  });

  test('sk-30 — clicking heroes-window "this week" triggers scoring fetch with window=7d', async () => {
    mockedScoring.mockResolvedValue(scoring());
    mockedFeed.mockResolvedValue(feedSample());

    render(
      <Wrap>
        <ActivityDashboard />
      </Wrap>,
    );

    await waitFor(() => expect(mockedScoring).toHaveBeenCalled());

    // Scope to the heroes-window group (NOT the global "Time window"
    // group nor the RaceChart's own window chip row) so the click
    // lands on the right button — the global switcher also has a
    // `7d` label.
    const heroesBar = screen.getByRole('group', { name: 'Heroes window' });
    fireEvent.click(within(heroesBar).getByRole('button', { name: 'this week' }));

    // After the click, getDashboardScoring should have been called
    // with window=7d (via heroesWindowToApi mapping `week` → `7d`).
    await waitFor(() => {
      const calls = mockedScoring.mock.calls.filter((c) => c[0]?.window === '7d');
      expect(calls.length).toBeGreaterThan(0);
    });
  });

  test('sk-30 — clicking heroes-window "all-time" triggers scoring fetch with window=all-time', async () => {
    mockedScoring.mockResolvedValue(scoring());
    mockedFeed.mockResolvedValue(feedSample());

    render(
      <Wrap>
        <ActivityDashboard />
      </Wrap>,
    );

    await waitFor(() => expect(mockedScoring).toHaveBeenCalled());

    const heroesBar = screen.getByRole('group', { name: 'Heroes window' });
    fireEvent.click(within(heroesBar).getByRole('button', { name: 'all-time' }));

    await waitFor(() => {
      const calls = mockedScoring.mock.calls.filter((c) => c[0]?.window === 'all-time');
      expect(calls.length).toBeGreaterThan(0);
    });
  });

  test('sk-30 — heroes-window "this week" updates the podium title dynamically', async () => {
    mockedScoring.mockResolvedValue(scoring());
    mockedFeed.mockResolvedValue(feedSample());

    render(
      <Wrap>
        <ActivityDashboard />
      </Wrap>,
    );

    // Initial state — podium title reads "Today's heroes".
    await waitFor(() => expect(screen.getByText(/Today's heroes/)).toBeTruthy());

    const heroesBar = screen.getByRole('group', { name: 'Heroes window' });
    fireEvent.click(within(heroesBar).getByRole('button', { name: 'this week' }));

    // Podium title swaps to "This week's heroes".
    await waitFor(() => expect(screen.getByText(/This week's heroes/)).toBeTruthy());
    // The old title is gone.
    expect(screen.queryByText(/Today's heroes/)).toBeNull();
  });

  test('sk-30 — heroes-window click does NOT change the global WindowTabs active state', async () => {
    mockedScoring.mockResolvedValue(scoring());
    mockedFeed.mockResolvedValue(feedSample());

    render(
      <Wrap>
        <ActivityDashboard />
      </Wrap>,
    );

    await waitFor(() => expect(mockedScoring).toHaveBeenCalled());

    // Sanity: the global window switcher's `24h` member is pressed
    // initially. Scoped by zone — see the note in the refetch test
    // above on why the accessible name no longer identifies it.
    const globalTabs = document.querySelector(
      '.activity-throughput-wrap .race-chip-row',
    ) as HTMLElement;
    const initialActiveGlobal = within(globalTabs)
      .getAllByRole('button')
      .find((b) => b.getAttribute('aria-pressed') === 'true');
    expect(initialActiveGlobal?.textContent).toBe('24h');

    // Click `all-time` in the LOCAL heroes-window bar.
    const heroesBar = screen.getByRole('group', { name: 'Heroes window' });
    fireEvent.click(within(heroesBar).getByRole('button', { name: 'all-time' }));

    // Global stays on 24h regardless of heroes-window change.
    await waitFor(() => {
      const activeGlobal = within(globalTabs)
        .getAllByRole('button')
        .find((b) => b.getAttribute('aria-pressed') === 'true');
      expect(activeGlobal?.textContent).toBe('24h');
    });
  });

  test('sk-68 — previous podium/leaderboard data stays rendered during a heroes-window refetch (no collapse)', async () => {
    // First window resolves immediately with the sample (alice podium).
    // Second window (this week) hangs on a deferred promise so we can
    // observe the in-flight refetch state: with keepPreviousData the held
    // alice rows must still be on screen — without it the podium would
    // collapse to its "no closes" empty-state and the page below would jump.
    let resolveSecond: ((v: ScoringResult) => void) | undefined;
    const secondPending = new Promise<ScoringResult>((res) => {
      resolveSecond = res;
    });
    mockedScoring
      .mockResolvedValueOnce(scoring()) // global windowSel=24h (matrices)
      .mockResolvedValueOnce(scoring()) // heroesWindow=today (podium)
      .mockReturnValueOnce(secondPending); // heroesWindow=week → in-flight
    mockedFeed.mockResolvedValue(feedSample());

    render(
      <Wrap>
        <ActivityDashboard />
      </Wrap>,
    );

    // Initial podium present.
    await waitFor(() => {
      expect(screen.getAllByText('alice').length).toBeGreaterThan(0);
    });

    // Switch heroes window — triggers the deferred (still-pending) refetch.
    const heroesBar = screen.getByRole('group', { name: 'Heroes window' });
    fireEvent.click(within(heroesBar).getByRole('button', { name: 'this week' }));

    // While the refetch is in flight, the previous data is held: the podium
    // still shows alice AND the empty-state line never appears.
    await waitFor(() => expect(screen.getByText(/This week's heroes/)).toBeTruthy());
    // sk-303.15 — usernames here are plain text, not links: the profile page
    // they pointed at is deleted and nothing replaced it.
    expect(screen.getAllByText('alice').length).toBeGreaterThan(0);
    expect(screen.queryByText(/no closes with commits in this window/)).toBeNull();

    // The zone is flagged busy for screen readers during the transition.
    const podiumSection = screen
      .getByText(/This week's heroes/)
      .closest('section.activity-podium') as HTMLElement;
    expect(podiumSection.getAttribute('aria-busy')).toBe('true');

    // Resolve the refetch — the held state clears, no crash.
    await act(async () => {
      resolveSecond?.(scoring());
      await Promise.resolve();
    });
    await waitFor(() => {
      const section = screen
        .getByText(/This week's heroes/)
        .closest('section.activity-podium') as HTMLElement;
      expect(section.getAttribute('aria-busy')).toBe('false');
    });
  });

  test('sk-163.18 — HARD-redacted ticker row renders 🔒, leaks no id/prefix in DOM or attrs, and usernames stay plain text', async () => {
    mockedScoring.mockResolvedValue(scoring());

    // feedSample()[0] is a normal demo-25 issue row (link + «title»).
    // Add a HARD-redacted row. The real server DROPS entity.id /
    // projectId / projectIdPrefix / title / summary on such a row; we
    // deliberately seed them here with a `secret`-tagged poison value so
    // this test proves the FRONTEND guard (render gates on `redacted`,
    // not on field presence) never surfaces them even if a buggy/older
    // server leaves them on the wire — belt-and-braces defence in depth.
    const feed = feedSample();
    feed.items.push({
      id: 200,
      occurredAt: '2026-05-23T09:58:00Z',
      type: 'issue.created',
      actor: { userId: null, username: 'agent-x', type: 'agent' },
      entity: {
        type: 'issue',
        id: 'secret-7',
        title: 'secrettitle',
        projectId: 'psecret-uuid',
        projectIdPrefix: 'secret',
      },
      summary: 'agent-x created secret-7 (secrettitle)',
      projectId: 'psecret-uuid',
      redacted: true,
    });
    mockedFeed.mockResolvedValue(feed);

    const { container } = render(
      <Wrap>
        <ActivityDashboard />
      </Wrap>,
    );

    // Normal (visible-project) entry: issue link is present + «title».
    expect(await screen.findByRole('link', { name: 'demo-25' })).toBeTruthy();
    expect(screen.getByText('«Fix login redirect»')).toBeTruthy();

    // Redacted entry: renders a 🔒 lock glyph (id cell), NOT the id.
    await waitFor(() => expect(screen.getByText('🔒')).toBeTruthy());

    // Redacted entry: a blurred-title placeholder is present, labelled
    // so screen-readers know why it's hidden.
    const redactedTitle = container.querySelector('.activity-redacted-title');
    expect(redactedTitle).toBeTruthy();

    // No navigable link to the secret id.
    expect(screen.queryByRole('link', { name: 'secret-7' })).toBeNull();

    // AIRTIGHT: the `secret` token must not appear ANYWHERE — neither in
    // rendered text nor in ANY attribute value (title / aria-* / href).
    expect(document.body.textContent ?? '').not.toContain('secret');
    document.body.querySelectorAll('*').forEach((el) => {
      for (const attr of Array.from(el.attributes)) {
        expect(attr.value).not.toContain('secret');
      }
    });

    // alice shows up (podium / leaderboards / matrix) as plain text,
    // never a link — sk-303.15 removed the profile page ProfileName
    // used to link to (see ActivityDashboard.tsx), and there's no
    // `isExternal` split left to gate that behaviour on.
    expect(screen.getAllByText('alice').length).toBeGreaterThan(0);
    expect(screen.queryByRole('link', { name: 'alice' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'bob' })).toBeNull();
  });

  test('sk-303.15 — plain-text usernames render without profile links', async () => {
    mockedScoring.mockResolvedValue(scoring());
    mockedFeed.mockResolvedValue(feedSample());

    render(
      <Wrap>
        <ActivityDashboard />
      </Wrap>,
    );

    await waitFor(() => {
      expect(screen.getAllByText('alice').length).toBeGreaterThan(0);
    });
    expect(screen.queryByRole('link', { name: 'alice' })).toBeNull();
  });

  test('sk-22 — agents zone renders per-user MCP-session counts', async () => {
    mockedScoring.mockResolvedValue(scoring());
    mockedFeed.mockResolvedValue(feedSample());
    const agentsResult: AgentsResult = {
      items: [
        { username: 'alice', live: 3, h24: 8, d7: 32, d30: 127, allTime: 904 },
        { username: 'carol', live: 0, h24: 2, d7: 5, d30: 18, allTime: 211 },
      ],
    };
    mockedAgents.mockResolvedValue(agentsResult);

    render(
      <Wrap>
        <ActivityDashboard />
      </Wrap>,
    );

    // Wait for the agents zone to surface the seeded rows.
    await waitFor(() => screen.getByText('●●●'));
    // Zone heading + footer-note (semantics warning) must be present.
    expect(screen.getByRole('heading', { name: 'Agents' })).toBeTruthy();
    expect(screen.getByText(/sessions ≈ MCP/)).toBeTruthy();
    // The all-time column renders with its own header + per-user totals.
    expect(screen.getByRole('columnheader', { name: 'all' })).toBeTruthy();
    // Both user rows render with their distinctive count values.
    expect(screen.getByText('127')).toBeTruthy(); // alice.d30 — distinctive enough
    expect(screen.getAllByText('18').length).toBeGreaterThan(0); // carol.d30 (may share with throughput matrix)
    expect(screen.getByText('904')).toBeTruthy(); // alice.allTime — distinctive
    expect(screen.getByText('211')).toBeTruthy(); // carol.allTime — distinctive
  });

  test('sk-183.2 — projects zone renders ALL PROJECTS summary row pinned above per-project rows, in server-given order', async () => {
    mockedScoring.mockResolvedValue(scoring());
    mockedFeed.mockResolvedValue(feedSample());
    mockedProjects.mockResolvedValue(projectsResult());

    const { container } = render(
      <Wrap>
        <ActivityDashboard />
      </Wrap>,
    );

    // Wait for the fetched data to actually land (the heading renders
    // immediately regardless of query state; gate on the ALL PROJECTS
    // events count so the table body is guaranteed populated).
    await waitFor(() => screen.getByText('551'));

    // Column headers per the acceptance criteria.
    expect(screen.getByRole('columnheader', { name: 'Project' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Events' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Commits' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Issues opened' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Closed' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Agents' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Top actor' })).toBeTruthy();

    // ALL PROJECTS row is the FIRST body row, visually distinct via its
    // own class, and shows the org-wide totals from `data.all`.
    const bodyRows = container.querySelectorAll('.activity-projects-table tbody tr');
    expect(bodyRows.length).toBe(3); // all + acm + redacted
    expect(bodyRows[0].classList.contains('activity-projects-summary-row')).toBe(true);
    expect(within(bodyRows[0] as HTMLElement).getByText('ALL PROJECTS')).toBeTruthy();
    expect(within(bodyRows[0] as HTMLElement).getByText('551')).toBeTruthy();

    // Per-project rows follow in the EXACT server-given order (acm
    // then the redacted row) — the component must not re-sort them.
    expect(within(bodyRows[1] as HTMLElement).getByText('acme')).toBeTruthy();
    expect(within(bodyRows[1] as HTMLElement).getByText('214')).toBeTruthy();
    expect(bodyRows[2].classList.contains('activity-projects-summary-row')).toBe(false);
  });

  test('sk-183.2 — redacted project row blurs ONLY the Project cell; every other cell shows real values', async () => {
    mockedScoring.mockResolvedValue(scoring());
    mockedFeed.mockResolvedValue(feedSample());
    mockedProjects.mockResolvedValue(projectsResult());

    const { container } = render(
      <Wrap>
        <ActivityDashboard />
      </Wrap>,
    );

    await waitFor(() => screen.getByText('96')); // redacted row's events count

    const bodyRows = container.querySelectorAll('.activity-projects-table tbody tr');
    const redactedRow = bodyRows[2] as HTMLElement;

    // Project cell is blurred via the shared RedactedTitle component —
    // no real project name/prefix leaks into the DOM for this row.
    expect(redactedRow.querySelector('.activity-redacted-title')).toBeTruthy();
    expect(within(redactedRow).queryByText(/acme/)).toBeNull();

    // Every OTHER cell renders its real value, unblurred — this is the
    // deliberately narrower redaction contract vs. NowWorking's rows.
    expect(within(redactedRow).getByText('96')).toBeTruthy(); // events
    expect(within(redactedRow).getByText('8')).toBeTruthy(); // commits
    expect(within(redactedRow).getByText('4')).toBeTruthy(); // issuesOpened
    expect(within(redactedRow).getByText('3')).toBeTruthy(); // issuesClosed
    expect(within(redactedRow).getByText('2')).toBeTruthy(); // activeAgents
    expect(within(redactedRow).getByText('carol')).toBeTruthy(); // topActor

    // None of the redacted row's numeric/actor cells carry the blur class.
    expect(redactedRow.querySelectorAll('.activity-redacted-title').length).toBe(1);
  });

  test('sk-183.2 — hovering a metric cell shows its contributor breakdown from the already-fetched result (no extra request)', async () => {
    mockedScoring.mockResolvedValue(scoring());
    mockedFeed.mockResolvedValue(feedSample());
    mockedProjects.mockResolvedValue(projectsResult());

    render(
      <Wrap>
        <ActivityDashboard />
      </Wrap>,
    );

    await waitFor(() => screen.getByText('551'));

    const callsBeforeHover = mockedProjects.mock.calls.length;

    // ALL PROJECTS row's Events cell (551) breaks down into alice:300
    // and bob:251 — hover reveals the breakdown via a Mantine
    // Tooltip (openDelay=0, see ProjectMetricCell).
    //
    // NOTE: `userEvent.hover`, not `fireEvent.mouseEnter` — Floating
    // UI's `useHover` (what Mantine Tooltip binds to under the hood)
    // gates its `mouseOnly` branch on a pointerType it only learns
    // from a preceding `pointerenter`/`pointerover` event; a bare
    // `fireEvent.mouseEnter`/`.mouseOver` never establishes that and
    // the hover is silently ignored. `userEvent.hover` dispatches the
    // full realistic sequence (pointerover → pointerenter → mouseover
    // → mouseenter → pointermove → mousemove), which is what actually
    // opens the tooltip in jsdom.
    const eventsCell = screen.getByText('551');
    const user = userEvent.setup();
    await user.hover(eventsCell);

    await waitFor(() => {
      expect(screen.getByText('300')).toBeTruthy();
      expect(screen.getByText('251')).toBeTruthy();
    });
    // 'bob' also appears in the heroes leaderboard fixture — assert
    // presence rather than uniqueness.
    expect(screen.getAllByText('bob').length).toBeGreaterThan(0);

    // sk-183.2 acceptance criteria: hover must not trigger a new fetch —
    // the tooltip reads straight from the already-fetched ProjectsResult.
    expect(mockedProjects.mock.calls.length).toBe(callsBeforeHover);

    await user.unhover(eventsCell);
  });

  /* ── Negative paths: HOT ZONE with nothing in the window ──────────
   *
   * sk-285.7.2.32 (T031). The page moved onto the shared roles, and a
   * render test that only ever sees POPULATED zones is blind to the
   * half of the surface that shows when the org was quiet: the podium,
   * both Top-5 boards and the metric matrix all swap themselves for an
   * `.activity-empty` plate, and none of those plates appear in the
   * DOM of the populated fixture above. The handoff draws that plate
   * (§6: "empty state — dashed"), so it is a surface with a
   * design, not an error path.
   */
  test('T031 — zero heroes: every scoring zone falls back to its empty plate, and the hero still renders', async () => {
    mockedScoring.mockResolvedValue({
      window: '24h',
      scope: {},
      metrics: [],
      leaderboards: { closed_human_driven: [], closed_with_commits: [] },
      matrixUsers: [],
    });
    mockedFeed.mockResolvedValue({ items: [], nextCursor: null });

    render(
      <Wrap>
        <ActivityDashboard />
      </Wrap>,
    );

    // The hero is not data-driven — it must survive an empty window.
    // This is the assertion that would have caught a hero keyed off the
    // scoring response rather than off the route.
    const title = await waitFor(() => {
      const el = document.querySelector('h1.hotzone-title');
      if (!el) throw new Error('hotzone title not yet rendered');
      return el as HTMLElement;
    });
    expect(title.textContent).toBeTruthy();

    // Both leaderboards render their own plate rather than an empty
    // <ol> — an empty list would collapse to zero height and read as a
    // rendering failure.
    await waitFor(() => {
      const plates = Array.from(document.querySelectorAll('.activity-empty'));
      if (plates.length < 3) throw new Error(`only ${plates.length} empty plates so far`);
    });
    const text = Array.from(document.querySelectorAll('.activity-empty')).map(
      (el) => el.textContent ?? '',
    );
    expect(text).toContain('no rows');
    expect(text).toContain('no metrics in this window');

    // Not one podium card, and — the part that matters for T031 — not
    // one medal edge either: `place-1`/`place-2`/`place-3` carry the
    // three colour roles, so a stale card left behind on an empty
    // window would paint a medal for a hero who is not there.
    expect(document.querySelectorAll('.activity-podium-card').length).toBe(0);
    expect(document.querySelectorAll('[class*="place-"]').length).toBe(0);

    // sk-370 — the podium's plate is the ONE empty state the design
    // draws a glyph in (`Skein Redesign.dc.html`: `ti-trophy-off` beside
    // this very sentence), and until sk-370 the app drew none anywhere.
    // §8 lists `trophy-off` among the icons in use while nothing used
    // it; this is the surface that spends it.
    const podiumPlate = Array.from(
      document.querySelectorAll('.activity-empty'),
    ).find((el) => (el.textContent ?? '').includes('no closes with commits'))!;
    expect(podiumPlate, 'the podium drew no empty plate').toBeTruthy();
    const glyph = podiumPlate.querySelector('.activity-empty-icon')!;
    expect(glyph, 'the podium plate draws no glyph').toBeTruthy();
    // Decorative: the sentence beside it says the same thing, so a
    // second accessible name would announce the emptiness twice.
    expect(glyph.getAttribute('aria-hidden')).toBe('true');

    // …and it is the ONLY one. The other plates stay text, because the
    // artboards draw them as text — a glyph on every one of them would
    // be a decision this task explicitly did not take.
    const withGlyph = Array.from(document.querySelectorAll('.activity-empty')).filter(
      (el) => el.querySelector('.activity-empty-icon') !== null,
    );
    expect(withGlyph).toHaveLength(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════
 * sk-285.7.11 — fidelity F2, §3.8 HOT ZONE. The composition half.
 *
 * jsdom has no cascade and no layout, so an assertion about a computed
 * width or font here would compare initial values and pass on a deleted
 * rule. What a render CAN see honestly is which elements exist and where in the tree they sit —
 * and that is exactly what HZ1, HZ2 and HZ4 are about.
 * ═════════════════════════════════════════════════════════════════════ */

describe('ActivityDashboard — sk-285.7.11 HOT ZONE composition', () => {
  async function renderPage() {
    mockedScoring.mockResolvedValue(scoring());
    mockedFeed.mockResolvedValue(feedSample());
    render(
      <Wrap>
        <ActivityDashboard />
      </Wrap>,
    );
    await waitFor(() => {
      if (!document.querySelector('.hotzone-grid')) throw new Error('page not rendered yet');
    });
  }

  test('HZ1 / sk-551.1 — race, heroes rail and Top-5 boards are three zones of one grid', async () => {
    // The artboard puts the race on the left and the heroes rail on the
    // right. sk-551.1 (2026-10-03): the two Top-5 boards moved out
    // of the rail to sit under the race, side by side, and the rail holds
    // the podium alone. Asserted on CONTAINMENT rather than on class
    // presence: a `.hotzone-grid` holding nothing would satisfy the latter.
    await renderPage();
    const grid = document.querySelector('.hotzone-grid')!;
    const zones = [...grid.children];
    const race = grid.querySelector('.activity-race-wrap')!;
    const rail = grid.querySelector('.hotzone-rail')!;
    const boards = grid.querySelector('.activity-leaderboards-wrap')!;
    // All three are the grid's own children — that is what lets the
    // stylesheet place them by area — and in reading order.
    expect(zones).toEqual([race, rail, boards]);
    expect(rail.querySelector('.activity-podium')).toBeTruthy();
    expect(rail.querySelector('.activity-leaderboard')).toBeNull();
    expect(boards.querySelectorAll('.activity-leaderboard')).toHaveLength(2);

    // The zones the design does not draw (§9) stay outside the grid at
    // full width; folding them in would be designing, not matching.
    for (const zone of ['.activity-agents', '.activity-projects', '.activity-ticker-wrap']) {
      expect(document.querySelector(zone), zone).toBeTruthy();
      expect(grid.querySelector(zone), zone).toBeNull();
    }
  });

  test('sk-551.1 — a hero card reads one row per metric: number, h/d/a, and its tooltip', async () => {
    // Reference — sk-551.1: five rows per hero, each row the label, the
    // number, the bar and the h/d/a split of that number; tooltips stay.
    // The fixture's alice closed 5 human + 2 directed + 6 autonomous.
    await renderPage();
    await waitFor(() => {
      if (!document.querySelector('.activity-podium-card')) throw new Error('podium not rendered yet');
    });
    const card = document.querySelector('.activity-podium-card')!;
    const rows = [...card.querySelectorAll('.activity-podium-stat')];
    expect(rows).toHaveLength(5);
    const closed = rows[0];
    expect(closed.querySelector('.activity-podium-stat-value')!.textContent).toBe('13');
    const split = closed.querySelector('.activity-podium-stat-breakdown')!;
    expect([...split.querySelectorAll('.axis-h, .axis-d, .axis-a')].map((e) => e.textContent)).toEqual([
      'h\u00a05',
      'd\u00a02',
      'a\u00a06',
    ]);
    // The autonomous row IS the autonomous count — nothing to split.
    expect(rows[4].querySelector('.activity-podium-stat-breakdown')).toBeNull();

    // Every row is a keyboard-reachable tooltip trigger.
    for (const row of rows) expect(row.getAttribute('tabindex')).toBe('0');
    // `userEvent.hover` for the realistic pointer sequence Floating UI's
    // `useHover` needs (see the sk-183.2 hover test above).
    await userEvent.setup().hover(closed);
    await waitFor(() => expect(screen.getByRole('tooltip')).toBeTruthy());
  });

  test.each([
    ['a Top-5 row', '.activity-leaderboard-name'],
    ['a hero card header', '.activity-podium-name'],
  ])('sk-551.1 — a name cut by its cell in %s offers the full name; an uncut one does not', async (_, selector) => {
    // Reference — sk-551.1 and its follow-up: a name
    // cut with an ellipsis must be reachable in full. jsdom has no
    // layout, so the cell's overflow is stated through the two
    // measurements the component reads; what is checked is the
    // component's answer to them, not any geometry.
    await renderPage();
    await waitFor(() => {
      if (!document.querySelector(selector)) throw new Error('names not rendered yet');
    });
    // Uncut (jsdom reports 0 / 0): a plain name, not a focus stop.
    for (const name of document.querySelectorAll(selector)) {
      expect(name.getAttribute('tabindex')).toBeNull();
    }
    cleanup();

    const cut = (el: Element) => el.matches(selector);
    const scroll = vi.spyOn(Element.prototype, 'scrollWidth', 'get').mockImplementation(function (this: Element) {
      return cut(this) ? 200 : 0;
    });
    const client = vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function (this: Element) {
      return cut(this) ? 40 : 0;
    });
    try {
      await renderPage();
      await waitFor(() => {
        const name = document.querySelector(selector);
        if (name?.getAttribute('tabindex') !== '0') throw new Error('cut name not measured yet');
      });
      const name = document.querySelector(selector)!;
      await userEvent.setup().hover(name);
      const tip = await screen.findByRole('tooltip');
      expect(tip.textContent).toBe(name.textContent);
    } finally {
      scroll.mockRestore();
      client.mockRestore();
    }
  });

  test('sk-551.26 — a login cut by its Agents cell offers the full name; an uncut one does not', async () => {
    // Reference — sk-551.26: a long login (`konstantin_vasilevsky`) in
    // the Agents table is cut with an ellipsis and its full name is in a
    // tooltip. Same measurement stand-in as the boards' test above.
    const login = 'konstantin_vasilevsky';
    mockedAgents.mockResolvedValue({
      items: [{ username: login, live: 2, h24: 5, d7: 9, d30: 14, allTime: 40 }],
    });
    const selector = '.activity-agents-user-name';
    const row = () => screen.getByRole('row', { name: new RegExp(`^${login}`) });
    try {
      await renderPage();
      await waitFor(() => row());
      expect(within(row()).queryByRole('button')).toBeNull();
      expect(row().querySelector('[tabindex="0"]')).toBeNull();
      cleanup();

      const cut = (el: Element) => el.matches(selector);
      const scroll = vi.spyOn(Element.prototype, 'scrollWidth', 'get').mockImplementation(function (this: Element) {
        return cut(this) ? 210 : 0;
      });
      const client = vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function (this: Element) {
        return cut(this) ? 140 : 0;
      });
      try {
        await renderPage();
        await waitFor(() => {
          if (!row().querySelector('[tabindex="0"]')) throw new Error('cut login not measured yet');
        });
        const name = row().querySelector('[tabindex="0"]')!;
        expect(name.textContent).toBe(login);
        await userEvent.setup().hover(name);
        const tip = await screen.findByRole('tooltip');
        expect(tip.textContent).toBe(login);
      } finally {
        scroll.mockRestore();
        client.mockRestore();
      }
    } finally {
      mockedAgents.mockResolvedValue({ items: [] });
    }
  });

  test('HZ2 — the heading carries the flame, and it is decorative', async () => {
    await renderPage();
    const h1 = document.querySelector('h1.hotzone-title')!;
    const flame = h1.querySelector('svg.hotzone-title-flame');
    expect(flame).toBeTruthy();
    // The word says the same thing; a second accessible name would have
    // a screen reader announce the page twice.
    expect(flame!.getAttribute('aria-hidden')).toBe('true');
    // No `size` attribute pair off the icon scale: the box is set in the
    // stylesheet, in the heading's own `em`.
    expect(h1.textContent).toContain('HOT ZONE');
  });

  test('HZ4 — the heroes window sits in the page header, as a segment', async () => {
    // It had been under the race chart, between two zones it does not
    // drive, so it read as a control of whichever one you were looking
    // at. The artboard puts it at the header's right end.
    await renderPage();
    const header = document.querySelector('.activity-dashboard-header-hotzone')!;
    const tabs = header.querySelector('.activity-heroes-window-tabs');
    expect(tabs).toBeTruthy();
    expect(tabs!.classList.contains('segment-track')).toBe(true);
    // The bar it used to live in is gone, not merely bypassed.
    expect(document.querySelector('.activity-heroes-window-bar')).toBeNull();
    // Every member is a segment cell, and exactly one is on.
    const cells = [...tabs!.querySelectorAll('button')];
    expect(cells.length).toBe(4);
    expect(cells.every((c) => c.classList.contains('segment-cell'))).toBe(true);
    expect(cells.filter((c) => c.getAttribute('aria-pressed') === 'true').length).toBe(1);
  });

  test('HZ5 — the race chart’s metric and window rows are segments too', async () => {
    await renderPage();
    const rows = [...document.querySelectorAll('.race-chip-row')];
    expect(rows.length).toBeGreaterThanOrEqual(1);
    for (const row of rows) {
      const track = row.querySelector('.segment-track');
      expect(track, row.textContent ?? '').toBeTruthy();
      // The old vocabulary is gone from these rows: a filter chip marks
      // one of several INDEPENDENT toggles — not one position of one
      // control. (It was `.filter-pill` when this was written; sk-414.7
      // merged the product's three chip classes into `.filter-chip`.)
      expect(row.querySelector('.filter-chip')).toBeNull();
    }
  });

  test('HZ7 — the one empty state the design draws a glyph in has one', async () => {
    // Filed by the audit as missing; sk-370 had already drawn it. Kept
    // as an assertion so it cannot quietly go away again.
    mockedScoring.mockResolvedValue({
      ...scoring(),
      leaderboards: { closed_human_driven: [], closed_with_commits: [] },
    });
    mockedFeed.mockResolvedValue(feedSample());
    render(
      <Wrap>
        <ActivityDashboard />
      </Wrap>,
    );
    await waitFor(() => {
      if (!document.querySelector('.activity-podium .activity-empty')) {
        throw new Error('empty podium not rendered yet');
      }
    });
    const plate = document.querySelector('.activity-podium .activity-empty')!;
    expect(plate.querySelector('svg.activity-empty-icon')).toBeTruthy();
  });
});

/* ══════════════════════════════════════════════════════════════════════
 * sk-285.7.2.62 — audit 2B, HZ2B-6. ONE way to draw a window selector.
 *
 * The page carried two. Above the fold, four switchers were segments
 * (`.segment-track` + `.segment-cell`, §4/§6). Below it, the throughput
 * matrix header drew the same role as loose filter chips — measured
 * live at 24px against §6's 36, the current member a solid `--primary`
 * plate rather than a raised `--surface` one, and no track under them.
 *
 * The fix deleted the second implementation instead of restyling it, so
 * what is asserted here is an ABSENCE as much as a presence: no window
 * switcher is drawn any other way, and the component that drew them is
 * gone from the source rather than merely unused.
 *
 * The ticker's Humans / Directed / Autonomous chips keep the filter
 * chip and that is not a leftover: all three can be on at once, so they
 * are three independent toggles rather than three positions of one
 * control. The last test states that property, because it is the reason
 * the vocabulary differs. (`.filter-pill` was the class until sk-414.7
 * merged the product's three chip classes into `.filter-chip`; the
 * solid `--primary` plate went with it, and the chip now marks its on
 * state with a `--primary` outline over the brand tint.)
 * ═════════════════════════════════════════════════════════════════════ */

describe('ActivityDashboard — sk-285.7.2.62 one window vocabulary', () => {
  async function renderPage() {
    mockedScoring.mockResolvedValue(scoring());
    mockedFeed.mockResolvedValue(feedSample());
    render(
      <Wrap>
        <ActivityDashboard />
      </Wrap>,
    );
    await waitFor(() => {
      if (!document.querySelector('.hotzone-grid')) throw new Error('page not rendered yet');
    });
  }

  test('the throughput matrix picks its window with a segment', async () => {
    await renderPage();
    const zone = document.querySelector('.activity-throughput-wrap')!;
    const row = zone.querySelector('.race-chip-row')!;
    expect(row, 'the throughput header renders no window control').toBeTruthy();
    const track = row.querySelector('.segment-track')!;
    expect(track).toBeTruthy();
    const cells = [...track.querySelectorAll('button')];
    expect(cells.map((c) => c.textContent)).toEqual(['24h', '7d', '30d']);
    expect(cells.every((c) => c.classList.contains('segment-cell'))).toBe(true);
    // One control, one position on. That is the claim a segment makes
    // and the pill row did not.
    expect(cells.filter((c) => c.getAttribute('aria-pressed') === 'true')).toHaveLength(1);
    expect(zone.querySelector('.filter-chip')).toBeNull();
  });

  test('no window switcher on the page is drawn any other way', async () => {
    await renderPage();
    // Every labelled window/metric row is a track. `.race-chip-row` is
    // the shape `ChipRow` renders; there is no second one.
    const rows = [...document.querySelectorAll('.race-chip-row')];
    expect(rows.length).toBeGreaterThanOrEqual(2); // projects + throughput
    for (const row of rows) {
      expect(row.querySelector('.segment-track'), row.textContent ?? '').toBeTruthy();
      expect(row.querySelector('.filter-chip'), row.textContent ?? '').toBeNull();
    }
  });

  test('the pills that remain are independent toggles, and all of them can be on', async () => {
    await renderPage();
    const pills = [...document.querySelectorAll('.filter-chip')];
    expect(pills.length).toBeGreaterThan(0);
    for (const pill of pills) {
      const group = pill.closest('[role="group"]');
      expect(group?.getAttribute('aria-label'), pill.textContent ?? '').toBe('Intent filters');
    }
    // The property that keeps them out of the segment vocabulary: a
    // segment would be lying about this control.
    expect(pills.map((p) => p.getAttribute('aria-pressed'))).toEqual(pills.map(() => 'true'));
  });
});

/* ══════════════════════════════════════════════════════════════════════
 * sk-527 — hiding a glyph must not fuse two numbers into one.
 *
 * The task arrived as a contrast defect: `.axis-sep` painted the `│` of
 * a per-user triplet with `--line-2`, the ramp's BORDER grade, which as
 * ink measures 3.13…4.17 and misses WCAG AA's 4.5 as well as the
 * stage's 4.8 floor. It arrived with two repairs offered — call the
 * glyph decoration and `aria-hidden` it (graphics are held to 3:1, which
 * it already clears), or call it text and give it an ink grade — and the
 * card recommended the first as "more honest in meaning".
 *
 * It is not. The two are not a matter of taste, and the deciding fact is
 * in the markup rather than in anyone's reading of the glyph: the spans
 * of a `.activity-matrix-triplet` carry NO whitespace between them, so
 * this `│` is the only delimiter three bare numbers have. Take it out of
 * the accessibility tree and «3│1│10» is read as «3110» — a number that
 * is not in the data, presented with no sign that anything was dropped.
 * A screen reader user is not told less than a sighted one; they are
 * told something false.
 *
 * The ink grade of the separator was measured at sk-527 (3.13…4.17 as
 * ink). This file holds the classification itself: the separator is
 * text, not decoration.
 *
 * ─── The class, not the case ───────────────────────────────────────
 *
 * The subject is not `.axis-sep` and not the matrix. It is EVERY element
 * of the rendered page, and the property is arithmetic rather than
 * nominal: removing the `aria-hidden` subtrees must never make a RUN OF
 * DIGITS longer than any run the sighted reader sees. A longer run is
 * exactly the harm — two values touching where a separator used to be —
 * and it is detectable without knowing which element was the separator,
 * which glyph it used, or what the numbers were.
 *
 * That is why the podium's breakdown passes and this did not. There the
 * whole `.activity-podium-stat-breakdown` is `aria-hidden` and each part
 * is self-labelled («h 12», «d 4»), so nothing is left to fuse; here the
 * parts are bare and only the glyph stood between them.
 * ═════════════════════════════════════════════════════════════════════ */

/** The text assistive technology is offered: `aria-hidden` subtrees gone. */
function accessibleText(el: Element): string {
  const copy = el.cloneNode(true) as Element;
  for (const hidden of [...copy.querySelectorAll('[aria-hidden="true"]')]) hidden.remove();
  return copy.textContent ?? '';
}

/** The longest unbroken run of digits in a string. */
function longestDigitRun(text: string): number {
  return (text.match(/\d+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0);
}

describe('ActivityDashboard — sk-527 no hidden glyph fuses two numbers', () => {
  async function renderPage() {
    mockedScoring.mockResolvedValue(tripletScoring());
    mockedFeed.mockResolvedValue(feedSample());
    mockedProjects.mockResolvedValue(projectsResult());
    render(
      <Wrap>
        <ActivityDashboard />
      </Wrap>,
    );
    await waitFor(() => {
      if (!document.querySelector('.activity-matrix-triplet')) {
        throw new Error('per-user matrix not rendered yet');
      }
    });
  }

  /**
   * The fixture is chosen to REACH the differentiating case, which an
   * arbitrary one does not. Every triplet here is (two digits, one
   * digit, two digits): fused it reads as a five-digit number, so the
   * defect is a run of 5 against a longest legitimate run of 2 — a gap
   * no rounding or ordering accident can produce. A triplet of
   * single-digit values would fuse into 3 against 1 and still be caught,
   * but a triplet of zeroes («0│0│0» → «000») is the case where the
   * fused text still LOOKS like a plausible count, so the numbers here
   * are deliberately distinct and multi-digit.
   */
  function tripletScoring(): ScoringResult {
    return {
      ...scoring(),
      matrixUsers: [
        {
          username: 'alice',
          issuesCreatedHuman: 12,
          issuesCreatedDirected: 3,
          issuesCreatedAutonomous: 40,
          issuesClosedHuman: 11,
          issuesClosedDirected: 2,
          issuesClosedAutonomous: 30,
          closedWithCommitsHuman: 10,
          closedWithCommitsDir: 1,
          closedWithCommitsAuto: 20,
          commentsHuman: 14,
          commentsDirected: 5,
          commentsAutonomous: 60,
          closedHumanDriven: 11,
        },
      ],
    };
  }

  test('every triplet cell still reads as three numbers, not one', async () => {
    await renderPage();
    const cells = [...document.querySelectorAll('.activity-matrix-triplet')];
    // Four metric columns × one user. Asserted so that a matrix that
    // stopped rendering triplets cannot satisfy the loop vacuously.
    expect(cells).toHaveLength(4);
    for (const cell of cells) {
      const parts = accessibleText(cell)
        .split(/[^\d]+/)
        .filter((p) => p !== '');
      expect(parts, `«${accessibleText(cell)}» is not three separate values`).toHaveLength(3);
    }
  });

  test('the separator is in the accessibility tree, and it is the only thing between the values', async () => {
    await renderPage();
    const cell = document.querySelector('.activity-matrix-triplet')!;
    const sep = cell.querySelector('.axis-sep')!;
    expect(sep.getAttribute('aria-hidden')).toBeNull();
    expect(sep.closest('[aria-hidden="true"]')).toBeNull();
    // The premise the whole classification rests on: the values are
    // adjacent, so the glyph is load-bearing rather than ornamental.
    // Asserted rather than assumed — add a space to the markup tomorrow
    // and this claim stops being true, which is worth knowing.
    expect(cell.textContent).toBe('12│3│40');
    const withoutSeparators = [...cell.children]
      .filter((c) => !c.classList.contains('axis-sep'))
      .map((c) => c.textContent)
      .join('');
    expect(withoutSeparators).toBe('12340');
  });

  test('NOWHERE on the page does hiding a subtree lengthen a run of digits', async () => {
    await renderPage();
    const elements = [...document.querySelectorAll('*')];
    // The page is mounted in full — podium, throughput matrix, hot zone,
    // leaderboards, ticker, per-user matrix — so the sweep has a subject.
    expect(elements.length).toBeGreaterThan(300);
    let examined = 0;
    for (const el of elements) {
      const full = el.textContent ?? '';
      if (!/\d/.test(full)) continue;
      if (el.querySelector('[aria-hidden="true"]') === null) continue;
      examined += 1;
      expect(
        longestDigitRun(accessibleText(el)),
        `<${el.tagName.toLowerCase()} class="${el.className}"> reads «${accessibleText(el)}»`
          + ` where the page shows «${full}»`,
      ).toBeLessThanOrEqual(longestDigitRun(full));
    }
    // The sweep is only worth its runtime if it looked at something: the
    // page does hide subtrees next to numbers (the podium's ASCII bars
    // and its h/d/a breakdown, for two), and a version of this test that
    // examined none would pass on a blank page.
    expect(examined, 'no element on the page mixes digits with a hidden subtree').toBeGreaterThan(
      10,
    );
  });
});

/* ═════════════════════════════════════════════════════════════════════
 * sk-551.2 — «Top 5 · closed with commits» draws five places.
 *
 * Reference — the acceptance of sk-551.2: people who closed in the heroes
 * window without a commit top the board up to five with a count of 0 and
 * `0/N closes · 0%`; order is commit-backed closes ↓, then all closes ↓,
 * then the name; places nobody fills read «·N —»; the top-up follows the
 * heroes-window switch. The data is the same response's `matrixUsers`.
 * ═════════════════════════════════════════════════════════════════════ */
describe('ActivityDashboard — sk-551.2 closed-with-commits top-up', () => {
  type Axes = [human: number, directed: number, autonomous: number];

  /**
   * A matrix row with only the closing axes set; the rest is zero. The
   * axes are given separately because the totals the board ranks by are
   * sums over all three origins.
   */
  function closer(username: string, closed: Axes, withCommits: Axes = [0, 0, 0]) {
    return {
      username,
      issuesCreatedHuman: 0,
      issuesCreatedDirected: 0,
      issuesCreatedAutonomous: 0,
      issuesClosedHuman: closed[0],
      issuesClosedDirected: closed[1],
      issuesClosedAutonomous: closed[2],
      closedWithCommitsHuman: withCommits[0],
      closedWithCommitsDir: withCommits[1],
      closedWithCommitsAuto: withCommits[2],
      commentsHuman: 0,
      commentsDirected: 0,
      commentsAutonomous: 0,
      closedHumanDriven: closed[0] + closed[1],
    };
  }

  /**
   * Three with commit-backed closes — ben and cid tie on 2, cid has more
   * closes overall — plus whatever the caller adds to the matrix.
   */
  function threeWithCommits(extra: ReturnType<typeof closer>[]): ScoringResult {
    return {
      ...scoring(),
      leaderboards: {
        closed_human_driven: [],
        // The backend's own tie order (`actor ASC`): ben before cid.
        closed_with_commits: [
          { username: 'ann', count: 4 },
          { username: 'ben', count: 2 },
          { username: 'cid', count: 2 },
        ],
      },
      matrixUsers: [
        closer('ann', [4, 0, 0], [4, 0, 0]),
        closer('ben', [3, 0, 0], [2, 0, 0]),
        // 5 closes overall, spread over all three origins.
        closer('cid', [1, 1, 3], [0, 1, 1]),
        ...extra,
      ],
    };
  }

  type Row = { rank: string; name: string; count: string; detail: string };

  function board(): Row[] {
    const title = screen.getByText('Top 5 · closed with commits');
    const list = title.closest('.activity-leaderboard')!;
    const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
    return [...list.querySelectorAll('li')].map((li) => ({
      rank: text(li.querySelector('.activity-leaderboard-rank')),
      name: text(li.querySelector('.activity-leaderboard-name')),
      count: text(li.querySelector('.activity-leaderboard-count')),
      detail: text(li.querySelector('.activity-leaderboard-detail')),
    }));
  }

  async function renderWith(byWindow: (window: string) => ScoringResult) {
    mockedScoring.mockImplementation(async (q) => byWindow(q.window));
    mockedFeed.mockResolvedValue(feedSample());
    render(
      <Wrap>
        <ActivityDashboard />
      </Wrap>,
    );
    await waitFor(() => {
      if (board()[0]?.name !== 'ann') throw new Error('board not rendered yet');
    });
  }

  test('3 with commits + 2 without → five rows, the two at the bottom at 0, by all closes', async () => {
    // eve closed 6 (over all three origins), dan 2, ike 1: eve and dan
    // take places 4 and 5, ike is the sixth closer and falls off.
    await renderWith(() =>
      threeWithCommits([
        closer('ike', [1, 0, 0]),
        closer('dan', [2, 0, 0]),
        closer('eve', [2, 1, 3]),
      ]),
    );
    expect(board().map((r) => [r.name, r.count])).toEqual([
      ['ann', '4'],
      // The tie on 2 resolves by all closes (cid 5 > ben 3), against the
      // backend's alphabetical order.
      ['cid', '2'],
      ['ben', '2'],
      ['eve', '0'],
      ['dan', '0'],
    ]);
    expect(board()[3].detail).toBe('0/6 closes · 0%');
    expect(board()[4].detail).toBe('0/2 closes · 0%');
  });

  test('a tie on all closes too resolves by name', async () => {
    await renderWith(() =>
      threeWithCommits([closer('zed', [2, 0, 0]), closer('dan', [0, 2, 0])]),
    );
    expect(board().map((r) => r.name)).toEqual(['ann', 'cid', 'ben', 'dan', 'zed']);
  });

  test('3 with commits + nobody without → three rows and two vacant places', async () => {
    await renderWith(() => threeWithCommits([]));
    expect(board().map((r) => `${r.rank} ${r.name}`)).toEqual([
      '🥇 ann',
      '🥈 cid',
      '🥉 ben',
      '·4 —',
      '·5 —',
    ]);
  });

  test('a closer with no close at all is not a top-up row', async () => {
    // fay is in the matrix for other activity but closed nothing in the
    // window, so she is not a closer and leaves the place vacant.
    await renderWith(() => threeWithCommits([closer('fay', [0, 0, 0])]));
    expect(board().map((r) => r.name)).toEqual(['ann', 'cid', 'ben', '—', '—']);
  });

  test('a commit-backed closer the backend cut off ranks by his real count, never as 0', async () => {
    // gus has 2 commit-backed closes (directed + autonomous) and 9 closes
    // overall but is not on the backend's capped board. Ranked from the
    // matrix he ties ben and cid on 2 and leads them on all closes.
    await renderWith(() => threeWithCommits([closer('gus', [0, 1, 8], [0, 1, 1])]));
    expect(board().map((r) => [r.name, r.count])).toEqual([
      ['ann', '4'],
      ['gus', '2'],
      ['cid', '2'],
      ['ben', '2'],
      ['—', ''],
    ]);
  });

  test('the backend cap does not hide a winner on the tie-break', async () => {
    // Reference: sk-551.2. Eleven people with one
    // commit-backed close each; the backend's board stops at ten
    // (`LIMIT 10`, ordered by name on the tie) and leaves u11 out, yet
    // u11 has 20 closes against everyone else's 1 and so ranks first on
    // the board and on the podium.
    const ids = Array.from({ length: 11 }, (_, i) => `u${String(i + 1).padStart(2, '0')}`);
    const capped: ScoringResult = {
      ...scoring(),
      leaderboards: {
        closed_human_driven: [],
        closed_with_commits: ids.slice(0, 10).map((username) => ({ username, count: 1 })),
      },
      matrixUsers: ids.map((id) => closer(id, [id === 'u11' ? 20 : 1, 0, 0], [1, 0, 0])),
    };
    mockedScoring.mockResolvedValue(capped);
    mockedFeed.mockResolvedValue(feedSample());
    render(
      <Wrap>
        <ActivityDashboard />
      </Wrap>,
    );
    await waitFor(() => {
      if (board().length === 0) throw new Error('board not rendered yet');
    });
    expect(board().map((r) => r.name)).toEqual(['u11', 'u01', 'u02', 'u03', 'u04']);
    const podium = [...document.querySelectorAll('.activity-podium-card .activity-podium-name')].map(
      (n) => n.textContent,
    );
    expect(podium).toEqual(['u11', 'u01', 'u02']);
  });

  test('the podium breaks ties the way the board does, and takes no top-up row', async () => {
    const one: ScoringResult = {
      ...threeWithCommits([]),
      leaderboards: {
        closed_human_driven: [],
        closed_with_commits: [{ username: 'ann', count: 4 }],
      },
      matrixUsers: [closer('ann', [4, 0, 0], [4, 0, 0]), closer('dan', [2, 0, 0])],
    };
    // Today: four people with a commit-backed close — the fourth, dee,
    // is on the board and not on a three-place podium.
    const four = threeWithCommits([closer('dee', [1, 0, 0], [1, 0, 0])]);
    four.leaderboards.closed_with_commits.push({ username: 'dee', count: 1 });
    await renderWith((window) => (window === '7d' ? one : four));
    const podium = () =>
      [...document.querySelectorAll('.activity-podium-card .activity-podium-name')].map(
        (n) => n.textContent,
      );
    expect(podium()).toEqual(['ann', 'cid', 'ben']);

    const heroesBar = screen.getByRole('group', { name: 'Heroes window' });
    fireEvent.click(within(heroesBar).getByRole('button', { name: 'this week' }));
    // dan is on the board at 0 but has no commit-backed close to rank.
    await waitFor(() => expect(board().map((r) => r.name)).toContain('dan'));
    expect(podium()).toEqual(['ann']);
  });

  test('switching the heroes window recomputes the top-up', async () => {
    await renderWith((window) =>
      window === '7d'
        ? threeWithCommits([closer('hal', [1, 0, 0])])
        : threeWithCommits([closer('dan', [2, 0, 0]), closer('eve', [6, 0, 0])]),
    );
    await waitFor(() => expect(board().map((r) => r.name)).toContain('eve'));

    const heroesBar = screen.getByRole('group', { name: 'Heroes window' });
    fireEvent.click(within(heroesBar).getByRole('button', { name: 'this week' }));

    await waitFor(() =>
      expect(board().map((r) => r.name)).toEqual(['ann', 'cid', 'ben', 'hal', '—']),
    );
  });
});

// sk-622.21 T041 (R2) — the page asks the hub for the events
// of every project the user sees while it is mounted.
describe('ActivityDashboard — live declaration', () => {
  test('a connection made while the page is mounted declares the "all visible" mode', async () => {
    mockedScoring.mockResolvedValue(scoring());
    mockedFeed.mockResolvedValue(feedSample());
    const controller = createProjectDeclaration();
    render(
      <ProjectDeclarationContext.Provider value={controller}>
        <Wrap>
          <ActivityDashboard />
        </Wrap>
      </ProjectDeclarationContext.Provider>,
    );
    const invoke = vi.fn((_method: string, ..._args: unknown[]) => Promise.resolve({ accepted: [], rejected: [] }));
    await act(async () => {
      await controller.connect({ invoke: invoke as never });
    });
    expect(invoke.mock.calls).toEqual([['DeclareAllVisible', true]]);
    controller.dispose();
  });
});

// ───────────────────────── sk-674.18 T056 — the space choice ─────────────────────────
//
// Row 248 of the matrix (US-13, SC-014, screens 1.12): "All my
// spaces" or one space, in `?space=`, goes into EVERY request of the
// page — the two scoring reads (throughput and heroes), the feed, «now
// working», the agents poll, the hot projects and the race. With one space
// and for an external user (none) there is no choice. A request without
// the parameter turns the test red.

describe('ActivityDashboard — sk-674.18 T056 space choice (row 248)', () => {
  const PERSONAL = 'p0aa11bb';
  const ACME = 'k3x9p2qa';
  const mockedInProgress = vi.mocked(getDashboardInProgress);
  const mockedRace = vi.mocked(getDashboardRace);

  function space(id: string, name: string, kind: MySpace['kind']): MySpace {
    return {
      id, slug: kind === 'personal' ? '' : name.toLowerCase(), name, kind, myRole: 'member', adminAccess: false,
      canCreateProject: true, memberCount: 2, memberLimit: null, pendingInvitations: 0,
      projectCount: 1, projectQuota: null, storageUsedBytes: 0, storageQuotaBytes: null,
    };
  }

  /** The space each request of the page was last sent with, by request. */
  function spacesSent(): Record<string, unknown[]> {
    return {
      scoring: mockedScoring.mock.calls.map((c) => c[0].space),
      feed: mockedFeed.mock.calls.map((c) => c[0]?.space),
      inProgress: mockedInProgress.mock.calls.map((c) => c[0]?.space),
      agents: mockedAgents.mock.calls.map((c) => c[0]?.space),
      projects: mockedProjects.mock.calls.map((c) => c[1]),
      race: mockedRace.mock.calls.map((c) => c[0].space),
    };
  }
  function clearRequests() {
    for (const m of [mockedScoring, mockedFeed, mockedInProgress, mockedAgents, mockedProjects, mockedRace]) {
      m.mockClear();
    }
  }

  let location = '';
  function LocationProbe() {
    const loc = useLocation();
    location = `${loc.pathname}${loc.search}`;
    return null;
  }

  function mount(url: string) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <MantineProvider>
        <QueryClientProvider client={qc}>
          <MemoryRouter initialEntries={[url]}>
            <Routes>
              <Route
                path="*"
                element={
                  <>
                    <ActivityDashboard />
                    <LocationProbe />
                  </>
                }
              />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </MantineProvider>,
    );
  }

  const choice = () => screen.queryByRole('group', { name: i18n.t('common:spaceFilter.label') });

  beforeEach(async () => {
    await i18n.changeLanguage('ru');
    spacesWorld.auth = { user: { id: 'user-bob', username: 'bob' } };
    mockedScoring.mockResolvedValue(scoring());
    mockedFeed.mockResolvedValue(feedSample());
    clearRequests();
    location = '';
  });

  test('choosing «Acme» writes `?space=` and every request of the page carries it', async () => {
    spacesWorld.spaces = [space(PERSONAL, 'Личное', 'personal'), space(ACME, 'Acme', 'common')];
    mount('/activity');

    const group = await screen.findByRole('group', { name: i18n.t('common:spaceFilter.label') });
    const all = within(group).getByRole('button', { name: i18n.t('common:spaceFilter.allMine') });
    // Default — «all my spaces»: no request names a space.
    expect(all.getAttribute('aria-pressed')).toBe('true');
    await waitFor(() => {
      for (const sent of Object.values(spacesSent())) expect(sent.length).toBeGreaterThan(0);
    });
    for (const sent of Object.values(spacesSent())) expect(sent.every((sp) => sp == null)).toBe(true);

    clearRequests();
    fireEvent.click(within(group).getByRole('button', { name: 'Acme' }));
    expect(location).toBe(`/activity?space=${ACME}`);

    // Every request of the page is made again, each with the space.
    await waitFor(() => {
      // The throughput and the heroes read share one scoring entry while
      // their windows agree (24h / today), so one request may serve both.
      for (const [name, list] of Object.entries(spacesSent())) {
        expect([name, list.length > 0]).toEqual([name, true]);
      }
    });
    for (const [name, list] of Object.entries(spacesSent())) {
      expect([name, list.every((sp) => sp === ACME)]).toEqual([name, true]);
    }
  });

  test('`?space=` from the address goes into the first request of each kind', async () => {
    spacesWorld.spaces = [space(PERSONAL, 'Личное', 'personal'), space(ACME, 'Acme', 'common')];
    mount(`/activity?space=${ACME}`);
    await waitFor(() => {
      for (const sent of Object.values(spacesSent())) expect(sent.length).toBeGreaterThan(0);
    });
    for (const [name, list] of Object.entries(spacesSent())) {
      expect([name, list[0]]).toEqual([name, ACME]);
    }
    const group = await screen.findByRole('group', { name: i18n.t('common:spaceFilter.label') });
    expect(within(group).getByRole('button', { name: 'Acme' }).getAttribute('aria-pressed')).toBe('true');
  });

  test('an unknown `?space=`: each request once, without it; the address drops it', async () => {
    spacesWorld.spaces = [space(PERSONAL, 'Личное', 'personal'), space(ACME, 'Acme', 'common')];
    mount('/activity?space=zzzzzzzz');
    await waitFor(() => {
      for (const sent of Object.values(spacesSent())) expect(sent.length).toBeGreaterThan(0);
    });
    await waitFor(() => expect(location).toBe('/activity'));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    for (const [name, list] of Object.entries(spacesSent())) {
      expect([name, list.every((sp) => sp == null)]).toEqual([name, true]);
    }
    // One read of each kind, not a first one with the unknown id and a second without.
    expect(mockedRace).toHaveBeenCalledTimes(1);
    expect(mockedAgents).toHaveBeenCalledTimes(1);
    expect(mockedFeed).toHaveBeenCalledTimes(1);
  });

  test('the agents poll keeps the space on every round', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      spacesWorld.spaces = [space(PERSONAL, 'Личное', 'personal'), space(ACME, 'Acme', 'common')];
      mount(`/activity?space=${ACME}`);
      await waitFor(() => expect(mockedAgents).toHaveBeenCalled());
      const first = mockedAgents.mock.calls.length;
      // Two poll rounds (every 30 s).
      await act(async () => {
        await vi.advanceTimersByTimeAsync(61_000);
      });
      await waitFor(() => expect(mockedAgents.mock.calls.length).toBeGreaterThan(first + 1));
      expect(mockedAgents.mock.calls.map((c) => c[0]?.space).every((sp) => sp === ACME)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  test.each([
    ['one space', () => [space(PERSONAL, 'Личное', 'personal')]],
    ['an external user — no space', () => []],
  ])('%s: no choice, and no request names a space', async (_name, spacesOf) => {
    spacesWorld.spaces = spacesOf();
    mount('/activity');
    await waitFor(() => expect(spacesWorld.spacesAnswered).toBeGreaterThan(0));
    await waitFor(() => {
      for (const sent of Object.values(spacesSent())) expect(sent.length).toBeGreaterThan(0);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(choice()).toBeNull();
    expect(screen.queryByRole('combobox', { name: i18n.t('common:spaceFilter.label') })).toBeNull();
    for (const sent of Object.values(spacesSent())) expect(sent.every((sp) => sp == null)).toBe(true);
  });

  // T056 — the ticker also grows from live envelopes between reads. With
  // one space chosen, an event of a project in another space must not slip
  // into it; one of the chosen space does.
  test('with a space chosen, the ticker takes live events of that space only', async () => {
    spacesWorld.spaces = [space(PERSONAL, 'Личное', 'personal'), space(ACME, 'Acme', 'common')];
    spacesWorld.projects = [
      { id: 'p-acme', name: 'web', idPrefix: 'web', spaceId: ACME },
      { id: 'p-home', name: 'blog', idPrefix: 'home', spaceId: PERSONAL },
    ];
    mount(`/activity?space=${ACME}`);
    await waitFor(() => screen.getByRole('link', { name: 'demo-25' }));

    const envelope = (id: number, entityId: string, projectId: string) => ({
      id,
      occurredAt: '2026-05-23T10:01:00Z',
      eventType: 'issue.created' as const,
      entityType: 'issue' as const,
      entityId,
      projectId,
      actor: 'carol',
      actorType: 'human' as const,
    });
    // The projects list (where a project's space is read) has answered.
    await waitFor(() => expect(spacesWorld.projectsAnswered).toBeGreaterThan(0));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    publishEnvelopeToDashboard(envelope(301, 'home-3', 'p-home'));
    publishEnvelopeToDashboard(envelope(302, 'web-8', 'p-acme'));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
    await waitFor(() => expect(screen.getByRole('link', { name: 'web-8' })).toBeTruthy());
    expect(screen.queryByRole('link', { name: 'home-3' })).toBeNull();
  });

  // the race grows live only from events of the chosen
  // space; read off the chart's accessible standings («alice 12, …»).
  test('the race takes live increments of the chosen space only', async () => {
    spacesWorld.spaces = [space(PERSONAL, 'Личное', 'personal'), space(ACME, 'Acme', 'common')];
    spacesWorld.projects = [
      { id: 'p-acme', name: 'web', idPrefix: 'web', spaceId: ACME },
      { id: 'p-home', name: 'blog', idPrefix: 'home', spaceId: PERSONAL },
    ];
    mockedRace.mockResolvedValue({
      metric: 'closed',
      window: '30d',
      effectiveStart: '2026-04-24T00:00:00Z',
      effectiveEnd: '2026-04-26T00:00:00Z',
      isColdStart: false,
      users: [
        {
          userId: 'u-alice',
          username: 'alice',
          total: 12,
          points: [
            { day: '2026-04-24T00:00:00Z', cumulative: 4 },
            { day: '2026-04-25T00:00:00Z', cumulative: 8 },
            { day: '2026-04-26T00:00:00Z', cumulative: 12 },
          ],
        },
      ],
      others: { userCount: 0, total: 0, points: [] },
    });
    mount(`/activity?space=${ACME}`);
    await screen.findByRole('img', { name: /alice 12/ });
    await waitFor(() => expect(spacesWorld.projectsAnswered).toBeGreaterThan(0));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const closed = (id: number, projectId: string) => ({
      id,
      occurredAt: '2026-04-26T12:00:00Z',
      eventType: 'issue.closed' as const,
      entityType: 'issue' as const,
      entityId: `x-${id}`,
      projectId,
      actor: 'alice',
      actorUserId: 'u-alice',
    });
    await act(async () => {
      publishEnvelopeToDashboard(closed(501, 'p-home'));
    });
    expect(screen.getByRole('img', { name: /alice 12/ })).toBeTruthy();
    await act(async () => {
      publishEnvelopeToDashboard(closed(502, 'p-acme'));
    });
    await screen.findByRole('img', { name: /alice 13/ });
  });

  // the ticker's buffer holds rows of the previous choice;
  // another space chosen, they go, and the new read fills it.
  test('another space chosen: the rows of the previous choice leave the ticker', async () => {
    spacesWorld.spaces = [space(PERSONAL, 'Личное', 'personal'), space(ACME, 'Acme', 'common')];
    mockedFeed.mockImplementation(async (q) =>
      q?.space === ACME
        ? {
            items: [
              {
                id: 700,
                occurredAt: '2026-05-23T10:05:00Z',
                type: 'issue.created',
                actor: { userId: null, username: 'alice', type: 'human' },
                entity: { type: 'issue', id: 'web-7', title: 'Acme row', projectId: 'p-acme', projectIdPrefix: 'web' },
                summary: 'alice created web-7',
                projectId: 'p-acme',
              },
            ],
            nextCursor: null,
          }
        : feedSample(),
    );
    mount('/activity');
    await waitFor(() => screen.getByRole('link', { name: 'demo-25' }));
    const group = await screen.findByRole('group', { name: i18n.t('common:spaceFilter.label') });
    fireEvent.click(within(group).getByRole('button', { name: 'Acme' }));
    await waitFor(() => screen.getByRole('link', { name: 'web-7' }));
    expect(screen.queryByRole('link', { name: 'demo-25' })).toBeNull();
  });

  // an event of a project the map does not hold (beyond
  // the first page of projects, or before the map answered) is neither
  // taken blindly nor lost: the feed and the race are read again with the
  // chosen space, and the server answers with what belongs. A KNOWN project
  // of another space is still dropped, with no request.
  describe('events of projects outside the map', () => {
    const envelope = (id: number, entityId: string, projectId: string) => ({
      id,
      occurredAt: '2026-05-23T10:01:00Z',
      eventType: 'issue.created' as const,
      entityType: 'issue' as const,
      entityId,
      projectId,
      actor: 'carol',
      actorType: 'human' as const,
    });
    async function mountAcme() {
      spacesWorld.spaces = [space(PERSONAL, 'Личное', 'personal'), space(ACME, 'Acme', 'common')];
      spacesWorld.projects = [
        { id: 'p-acme', name: 'web', idPrefix: 'web', spaceId: ACME },
        { id: 'p-home', name: 'blog', idPrefix: 'home', spaceId: PERSONAL },
      ];
      mount(`/activity?space=${ACME}`);
      await waitFor(() => screen.getByRole('link', { name: 'demo-25' }));
      await waitFor(() => expect(spacesWorld.projectsAnswered).toBeGreaterThan(0));
      await waitFor(() => expect(mockedRace).toHaveBeenCalled());
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    }

    test('a project outside the map: the feed and the race are read again with the space; no row taken blindly', async () => {
      await mountAcme();
      const feedBefore = mockedFeed.mock.calls.length;
      const raceBefore = mockedRace.mock.calls.length;

      publishEnvelopeToDashboard(envelope(401, 'far-1', 'p-far'));
      await waitFor(() => expect(mockedFeed.mock.calls.length).toBeGreaterThan(feedBefore), { timeout: 3000 });
      await waitFor(() => expect(mockedRace.mock.calls.length).toBeGreaterThan(raceBefore), { timeout: 3000 });
      expect(mockedFeed.mock.calls.slice(feedBefore).every((c) => c[0]?.space === ACME)).toBe(true);
      expect(mockedRace.mock.calls.slice(raceBefore).every((c) => c[0].space === ACME)).toBe(true);
      // The envelope itself was not taken into the ticker.
      expect(screen.queryByRole('link', { name: 'far-1' })).toBeNull();
    });

    test('a known project of another space: no row and no request', async () => {
      await mountAcme();
      const feedBefore = mockedFeed.mock.calls.length;
      const raceBefore = mockedRace.mock.calls.length;

      publishEnvelopeToDashboard(envelope(402, 'home-4', 'p-home'));
      await act(async () => {
        await new Promise((r) => setTimeout(r, 1500));
      });
      expect(screen.queryByRole('link', { name: 'home-4' })).toBeNull();
      expect(mockedFeed.mock.calls.length).toBe(feedBefore);
      expect(mockedRace.mock.calls.length).toBe(raceBefore);
    });
  });
});
