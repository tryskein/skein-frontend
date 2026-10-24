/**
 * sk-29.2 — RaceChart vitest suite.
 *
 * Six render-only test cases:
 *   1. Renders chart with 3 mock users + others, asserts polyline count
 *      and end-of-line labels.
 *   2. Renders empty-state when users=[] and others.userCount=0.
 *   3. Renders cold-start label when isColdStart=true.
 *   4. Clicking a chip updates URL searchParams.
 *   5. Reading URL on mount initializes chip state.
 *   6. Mock envelope arrival via the dashboard bus → matching user's
 *      cumulative bumps (smoke test).
 *
 * Wiring patterns mirror ActivityDashboard.test.tsx — Mantine + Query
 * client + MemoryRouter, plus a getDashboardRace mock so no fetch
 * actually fires.
 */
import { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';

vi.mock('../../api/dashboard', async () => {
  const actual = await vi.importActual<typeof import('../../api/dashboard')>(
    '../../api/dashboard',
  );
  return {
    ...actual,
    getDashboardRace: vi.fn(),
  };
});

import { getDashboardRace, type RaceResult } from '../../api/dashboard';
import type { EventEnvelope } from '../../lib/eventEnvelope';
import { RaceChart } from './RaceChart';
import { applyEnvelopeToResult } from '../../lib/applyEnvelopeToRace';
import {
  publishEnvelopeToDashboard,
  _resetDashboardBusForTests,
} from '../../lib/dashboardEventBus';

const mockedRace = vi.mocked(getDashboardRace);

function Wrap({ children, initialEntry = '/activity' }: { children: ReactNode; initialEntry?: string }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <MantineProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[initialEntry]}>{children}</MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>
  );
}

/** Test probe — surfaces the current location.search into the DOM so
 *  the URL-state tests can read it without dragging in act/await for
 *  router internals. Rendered as a sibling of RaceChart inside Wrap. */
function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="loc-search">{loc.search}</div>;
}

function sampleResult(overrides: Partial<RaceResult> = {}): RaceResult {
  return {
    metric: 'closed',
    window: '30d',
    effectiveStart: '2026-04-24T00:00:00Z',
    effectiveEnd: '2026-05-24T00:00:00Z',
    isColdStart: false,
    users: [
      {
        userId: 'u-alice',
        username: 'alice',
        total: 12,
        points: [
          { day: '2026-04-24T00:00:00Z', cumulative: 0 },
          { day: '2026-04-25T00:00:00Z', cumulative: 2 },
          { day: '2026-04-26T00:00:00Z', cumulative: 5 },
          { day: '2026-04-27T00:00:00Z', cumulative: 8 },
          { day: '2026-04-28T00:00:00Z', cumulative: 12 },
        ],
      },
      {
        userId: 'u-bob',
        username: 'bob',
        total: 7,
        points: [
          { day: '2026-04-24T00:00:00Z', cumulative: 0 },
          { day: '2026-04-25T00:00:00Z', cumulative: 1 },
          { day: '2026-04-26T00:00:00Z', cumulative: 3 },
          { day: '2026-04-27T00:00:00Z', cumulative: 5 },
          { day: '2026-04-28T00:00:00Z', cumulative: 7 },
        ],
      },
      {
        userId: 'u-carol',
        username: 'carol',
        total: 4,
        points: [
          { day: '2026-04-24T00:00:00Z', cumulative: 0 },
          { day: '2026-04-25T00:00:00Z', cumulative: 1 },
          { day: '2026-04-26T00:00:00Z', cumulative: 2 },
          { day: '2026-04-27T00:00:00Z', cumulative: 3 },
          { day: '2026-04-28T00:00:00Z', cumulative: 4 },
        ],
      },
    ],
    others: {
      userCount: 4,
      total: 5,
      points: [
        { day: '2026-04-24T00:00:00Z', cumulative: 0 },
        { day: '2026-04-25T00:00:00Z', cumulative: 1 },
        { day: '2026-04-26T00:00:00Z', cumulative: 2 },
        { day: '2026-04-27T00:00:00Z', cumulative: 4 },
        { day: '2026-04-28T00:00:00Z', cumulative: 5 },
      ],
    },
    ...overrides,
  };
}

beforeEach(() => {
  mockedRace.mockReset();
  _resetDashboardBusForTests();
});

afterEach(() => {
  cleanup();
});

describe('RaceChart', () => {
  test('renders 3 user polylines + others polyline + end-of-line labels', async () => {
    mockedRace.mockResolvedValue(sampleResult());

    render(
      <Wrap>
        <RaceChart />
      </Wrap>,
    );

    await waitFor(() => expect(mockedRace).toHaveBeenCalled());

    // Wait for the SVG to render once the query resolves.
    const svg = await waitFor(() => {
      const el = document.querySelector('svg.race-chart-svg');
      if (!el) throw new Error('svg not yet rendered');
      return el as SVGElement;
    });

    // 3 user lines + 1 others line = 4 polylines on the plot.
    const polylines = svg.querySelectorAll('polyline');
    expect(polylines.length).toBe(4);

    // Three end-of-line `@username` labels.
    expect(screen.getByText('@alice')).toBeTruthy();
    expect(screen.getByText('@bob')).toBeTruthy();
    expect(screen.getByText('@carol')).toBeTruthy();
  });

  test('empty state when users=[] and others.userCount=0', async () => {
    mockedRace.mockResolvedValue(
      sampleResult({
        users: [],
        others: { userCount: 0, total: 0, points: [] },
      }),
    );

    render(
      <Wrap>
        <RaceChart />
      </Wrap>,
    );

    await waitFor(() => expect(mockedRace).toHaveBeenCalled());

    // Placeholder text, no SVG axis.
    await waitFor(() => {
      expect(screen.getByText(/no closed events in this window/)).toBeTruthy();
    });
    expect(document.querySelector('svg.race-chart-svg')).toBeNull();
  });

  test('cold-start label «since X» when isColdStart=true', async () => {
    mockedRace.mockResolvedValue(
      sampleResult({
        isColdStart: true,
        effectiveStart: '2026-05-18T00:00:00Z',
      }),
    );

    render(
      <Wrap>
        <RaceChart />
      </Wrap>,
    );

    await waitFor(() => expect(mockedRace).toHaveBeenCalled());
    // Header hint should read `since May 18`, not the generic
    // `30d race · closed`.
    await waitFor(() => {
      expect(screen.getByText(/since May 18/)).toBeTruthy();
    });
  });

  test('clicking a chip updates URL searchParams (non-default only)', async () => {
    mockedRace.mockResolvedValue(sampleResult());

    render(
      <Wrap initialEntry="/activity">
        <RaceChart />
        <LocationProbe />
      </Wrap>,
    );

    await waitFor(() => expect(mockedRace).toHaveBeenCalled());

    // Click the `7d` window chip — non-default value, must land in
    // the URL as ?window=7d.
    const windowGroup = screen.getByRole('group', { name: 'Window' });
    fireEvent.click(within(windowGroup).getByRole('button', { name: '7d' }));
    await waitFor(() => {
      expect(screen.getByTestId('loc-search').textContent).toContain('window=7d');
    });

    // Click `created` metric — non-default, must also land in URL.
    const metricGroup = screen.getByRole('group', { name: 'Metric' });
    fireEvent.click(within(metricGroup).getByRole('button', { name: 'created' }));
    await waitFor(() => {
      const search = screen.getByTestId('loc-search').textContent ?? '';
      expect(search).toContain('metric=created');
    });

    // Click back to the default window 30d — the URL should DROP the
    // window param (defaults aren't written, per spec).
    fireEvent.click(within(windowGroup).getByRole('button', { name: '30d' }));
    await waitFor(() => {
      const search = screen.getByTestId('loc-search').textContent ?? '';
      expect(search).not.toContain('window=');
    });
  });

  test('reads URL on mount and initialises chip state', async () => {
    mockedRace.mockResolvedValue(sampleResult({ metric: 'comments', window: '7d' }));

    render(
      <Wrap initialEntry="/activity?metric=comments&window=7d">
        <RaceChart />
      </Wrap>,
    );

    await waitFor(() => expect(mockedRace).toHaveBeenCalled());

    // The hook should have been called with the URL-derived params,
    // not the defaults.
    const firstCall = mockedRace.mock.calls[0][0];
    expect(firstCall.metric).toBe('comments');
    expect(firstCall.window).toBe('7d');

    // Active chip aria-pressed state must reflect the URL too.
    await waitFor(() => {
      const metricGroup = screen.getByRole('group', { name: 'Metric' });
      const commentsBtn = within(metricGroup).getByRole('button', { name: 'comments' });
      expect(commentsBtn.getAttribute('aria-pressed')).toBe('true');
      const windowGroup = screen.getByRole('group', { name: 'Window' });
      const sevenDBtn = within(windowGroup).getByRole('button', { name: '7d' });
      expect(sevenDBtn.getAttribute('aria-pressed')).toBe('true');
    });
  });

  test('envelope arrival bumps the matched user cumulative line', async () => {
    mockedRace.mockResolvedValue(sampleResult());

    render(
      <Wrap>
        <RaceChart />
      </Wrap>,
    );

    await waitFor(() => expect(mockedRace).toHaveBeenCalled());

    // Wait for initial render, then snapshot the alice polyline's
    // points attribute — bumping the cumulative changes the path.
    const svg = await waitFor(() => {
      const el = document.querySelector('svg.race-chart-svg');
      if (!el) throw new Error('svg not yet rendered');
      return el as SVGElement;
    });

    // Pull alice's polyline by its stroke color match — the user has
    // a deterministic hash-based color. Easier: pick the FIRST coloured
    // polyline (the others line has the .race-line-others class) and
    // assert that its points attribute changes after the envelope lands.
    const userLines = Array.from(
      svg.querySelectorAll('polyline.race-line-user'),
    ) as SVGPolylineElement[];
    expect(userLines.length).toBe(3);
    const before = userLines[0].getAttribute('points');

    // Publish an envelope matching alice by username (the envelope's
    // actorUserId path also works, but matching on actor handles the
    // case where sk-21 enrichment hasn't run yet).
    await act(async () => {
      publishEnvelopeToDashboard({
        id: 9001,
        occurredAt: '2026-04-28T12:00:00Z',
        eventType: 'issue.closed',
        entityType: 'issue',
        entityId: 'demo-42',
        projectId: 'p-1',
        actor: 'alice',
        actorUserId: 'u-alice',
      });
    });

    await waitFor(() => {
      const after = userLines[0].getAttribute('points');
      expect(after).not.toBe(before);
    });
  });

  test('commits metric bumps by hash count on issue.commits_attached', async () => {
    mockedRace.mockResolvedValue(sampleResult({ metric: 'commits' }));

    render(
      <Wrap initialEntry="/activity?metric=commits">
        <RaceChart />
      </Wrap>,
    );

    await waitFor(() => expect(mockedRace).toHaveBeenCalled());

    const svg = await waitFor(() => {
      const el = document.querySelector('svg.race-chart-svg');
      if (!el) throw new Error('svg not yet rendered');
      return el as SVGElement;
    });

    const userLines = Array.from(
      svg.querySelectorAll('polyline.race-line-user'),
    ) as SVGPolylineElement[];
    const aliceLine = userLines.find(
      (line) => line.getAttribute('data-username') === 'alice',
    );
    expect(aliceLine).toBeTruthy();
    const before = aliceLine!.getAttribute('points');

    await act(async () => {
      publishEnvelopeToDashboard({
        id: 9002,
        occurredAt: '2026-04-28T12:00:00Z',
        eventType: 'issue.commits_attached',
        entityType: 'issue',
        entityId: 'demo-42',
        projectId: 'p-1',
        actor: 'alice',
        actorUserId: 'u-alice',
        commitHashes: ['aaa', 'bbb', 'ccc'],
      });
    });

    await waitFor(() => {
      const after = aliceLine!.getAttribute('points');
      expect(after).not.toBe(before);
    });
  });

  test('commits metric ignores issue.closed envelopes', async () => {
    mockedRace.mockResolvedValue(sampleResult({ metric: 'commits' }));

    render(
      <Wrap initialEntry="/activity?metric=commits">
        <RaceChart />
      </Wrap>,
    );

    await waitFor(() => expect(mockedRace).toHaveBeenCalled());

    const svg = await waitFor(() => {
      const el = document.querySelector('svg.race-chart-svg');
      if (!el) throw new Error('svg not yet rendered');
      return el as SVGElement;
    });

    const userLines = Array.from(
      svg.querySelectorAll('polyline.race-line-user'),
    ) as SVGPolylineElement[];
    const aliceLine = userLines.find(
      (line) => line.getAttribute('data-username') === 'alice',
    );
    expect(aliceLine).toBeTruthy();
    const before = aliceLine!.getAttribute('points');

    await act(async () => {
      publishEnvelopeToDashboard({
        id: 9003,
        occurredAt: '2026-04-28T12:00:00Z',
        eventType: 'issue.closed',
        entityType: 'issue',
        entityId: 'demo-43',
        projectId: 'p-1',
        actor: 'alice',
        actorUserId: 'u-alice',
      });
    });

    // Allow any async state update to settle — points must stay unchanged.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(aliceLine!.getAttribute('points')).toBe(before);
  });
});

// Pure-function unit tests for the live-increment reducer. These assert
// the EXACT delta (not just "something changed"), which the rendered-SVG
// smoke tests above cannot — geometry strings don't reveal magnitude.
describe('applyEnvelopeToResult', () => {
  function env(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
    return {
      id: 1,
      occurredAt: '2026-04-28T12:00:00Z',
      eventType: 'issue.commits_attached',
      entityType: 'issue',
      entityId: 'demo-42',
      actor: 'alice',
      actorUserId: 'u-alice',
      ...overrides,
    };
  }

  test('commits: bumps matched user total + last cumulative by exact hash count', () => {
    const prev = sampleResult({ metric: 'commits' });
    const next = applyEnvelopeToResult(prev, env({ commitHashes: ['a', 'b', 'c'] }), 'commits');
    const u = next.users.find((x) => x.userId === 'u-alice')!;
    expect(u.total).toBe(12 + 3);
    expect(u.points[u.points.length - 1].cumulative).toBe(12 + 3);
    // Non-matched users are untouched.
    expect(next.users.find((x) => x.userId === 'u-bob')!.total).toBe(7);
    // Immutability: prev is not mutated.
    expect(prev.users.find((x) => x.userId === 'u-alice')!.total).toBe(12);
  });

  test('commits: issue.closed envelope is ignored (no bump, same reference)', () => {
    const prev = sampleResult({ metric: 'commits' });
    const next = applyEnvelopeToResult(prev, env({ eventType: 'issue.closed' }), 'commits');
    expect(next).toBe(prev);
  });

  test('commits: empty / missing / non-array commitHashes contribute 0', () => {
    const prev = sampleResult({ metric: 'commits' });
    expect(applyEnvelopeToResult(prev, env({ commitHashes: [] }), 'commits')).toBe(prev);
    expect(applyEnvelopeToResult(prev, env({ commitHashes: undefined }), 'commits')).toBe(prev);
    expect(
      applyEnvelopeToResult(prev, env({ commitHashes: 'abc' as unknown as string[] }), 'commits'),
    ).toBe(prev);
  });

  // sk-622.21 US-12 — the compact envelope carries the hashes
  // in `commitHashes`; the old `newData.hashes` is gone from the wire. An
  // envelope still carrying only the old field must not bump the race.
  test('commits: legacy newData.hashes without commitHashes contributes 0', () => {
    const prev = sampleResult({ metric: 'commits' });
    const legacy = {
      ...env({}),
      newData: { hashes: ['a', 'b', 'c'] },
    } as unknown as EventEnvelope;
    expect(applyEnvelopeToResult(prev, legacy, 'commits')).toBe(prev);
  });

  test('commits: contributor outside top-N folds into others by hash count', () => {
    const prev = sampleResult({ metric: 'commits' });
    const next = applyEnvelopeToResult(
      prev,
      env({ actor: 'stranger', actorUserId: 'u-99', commitHashes: ['a', 'b'] }),
      'commits',
    );
    expect(next.others.total).toBe(prev.others.total + 2);
    expect(next.others.points[next.others.points.length - 1].cumulative).toBe(
      prev.others.points[prev.others.points.length - 1].cumulative + 2,
    );
  });

  test('closed metric: issue.closed still bumps by exactly 1 (baseline preserved)', () => {
    const prev = sampleResult({ metric: 'closed' });
    const next = applyEnvelopeToResult(prev, env({ eventType: 'issue.closed' }), 'closed');
    expect(next.users.find((x) => x.userId === 'u-alice')!.total).toBe(13);
  });
});
