/**
 * sk-1048.69 — the Activity dashboard client on the HTTP boundary.
 *
 * Routes are skein-api `GET /api/v1/dashboard/{scoring,feed,in-progress,agents,race,projects}`;
 * the handlers read `window`, `project`, `user`, `limit`, `cursor`, `metric`,
 * `topN` and the space filter `space`. A filter left unset (undefined or null)
 * is not sent at all.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  getDashboardAgents,
  getDashboardFeed,
  getDashboardInProgress,
  getDashboardProjects,
  getDashboardRace,
  getDashboardScoring,
} from './dashboard';

const fetchSpy = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchSpy.mockReset();
  fetchSpy.mockImplementation(async () => new Response('{}', {
    status: 200, headers: { 'content-type': 'application/json' },
  }));
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => vi.unstubAllGlobals());

function sent(): { path: string; query: Record<string, string>; method: string } {
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  const [url, init] = fetchSpy.mock.calls[0];
  const parsed = new URL(String(url), 'http://localhost');
  return {
    path: parsed.pathname,
    query: Object.fromEntries(parsed.searchParams),
    method: init?.method ?? 'GET',
  };
}

describe('dashboard client — path and query of every request', () => {
  test.each([
    {
      name: 'scoring with every filter',
      run: () => getDashboardScoring({ window: '7d', projectId: 'p-1', username: 'ann', space: 'sp1' }),
      path: '/api/v1/dashboard/scoring',
      query: { window: '7d', project: 'p-1', user: 'ann', space: 'sp1' },
    },
    {
      name: 'scoring with null filters',
      run: () => getDashboardScoring({ window: 'all-time', projectId: null, username: null, space: null }),
      path: '/api/v1/dashboard/scoring',
      query: { window: 'all-time' },
    },
    {
      name: 'feed with limit, cursor and space',
      run: () => getDashboardFeed({ limit: 20, cursor: 'c 1', space: 'sp1' }),
      path: '/api/v1/dashboard/feed',
      query: { limit: '20', cursor: 'c 1', space: 'sp1' },
    },
    {
      name: 'feed without filters',
      run: () => getDashboardFeed(),
      path: '/api/v1/dashboard/feed',
      query: {},
    },
    {
      name: 'in-progress with every filter',
      run: () => getDashboardInProgress({ projectId: 'p-1', limit: 5, space: 'sp1' }),
      path: '/api/v1/dashboard/in-progress',
      query: { project: 'p-1', limit: '5', space: 'sp1' },
    },
    {
      name: 'in-progress with a null project',
      run: () => getDashboardInProgress({ projectId: null }),
      path: '/api/v1/dashboard/in-progress',
      query: {},
    },
    {
      name: 'agents in a space',
      run: () => getDashboardAgents({ space: 'sp1' }),
      path: '/api/v1/dashboard/agents',
      query: { space: 'sp1' },
    },
    {
      name: 'agents without a space',
      run: () => getDashboardAgents(),
      path: '/api/v1/dashboard/agents',
      query: {},
    },
    {
      name: 'race with every filter',
      run: () => getDashboardRace({ metric: 'commits', window: '30d', topN: 3, space: 'sp1' }),
      path: '/api/v1/dashboard/race',
      query: { metric: 'commits', window: '30d', topN: '3', space: 'sp1' },
    },
    {
      name: 'race without the optional filters',
      run: () => getDashboardRace({ metric: 'closed', window: 'all' }),
      path: '/api/v1/dashboard/race',
      query: { metric: 'closed', window: 'all' },
    },
    {
      name: 'projects in a space',
      run: () => getDashboardProjects('24h', 'sp1'),
      path: '/api/v1/dashboard/projects',
      query: { window: '24h', space: 'sp1' },
    },
    {
      name: 'projects with a null space',
      run: () => getDashboardProjects('all', null),
      path: '/api/v1/dashboard/projects',
      query: { window: 'all' },
    },
  ])('$name', async ({ run, path, query }) => {
    await run();
    expect(sent()).toEqual({ path, query, method: 'GET' });
  });
});
