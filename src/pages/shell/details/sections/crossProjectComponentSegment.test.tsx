/**
 * sk-439 — opening an epic's child from a component-filtered route.
 *
 * The section opens a child through `layout.setSelectedIssue(id, <the
 * row's project UUID>)`. On `/projects/proj-a/components/cmp-a-1/…` that
 * used to carry project A's component into ANY target, so a child living
 * in project B opened at `/projects/<B>/components/cmp-a-1/issues/<id>` —
 * project B filtered by a component B does not have.
 *
 * The rule (contract on `useLayoutState.tsx#setSelectedIssue`): the
 * component rides along only when the target is KNOWN to be in the
 * current project; unknown → dropped; the query string is carried as
 * before; the «All projects» view is untouched.
 *
 * The «Dependencies» / «Blocked» / blocker-link paths are pinned by
 * `crossProjectNavigation.test.tsx` and do not go through
 * `setSelectedIssue`; this file is only about the child-row open.
 *
 * Harness: a REAL router on the app's own route shapes, a REAL
 * `LayoutProvider`, the REAL section with its REAL `useLayeredTree`
 * (rows come through a stubbed `fetch` in wire shape). The assertion is
 * the address the open produced, read from the router.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { ListProjectsResult } from '../../../../api/projects';
import type { IssueDetail, IssueTreeNode } from '../../../../api/issues';
import { LayoutProvider } from '../../../../lib/useLayoutState';
import { projectsListQueryKey } from '../../../../lib/projectHandleCache';
import { resetEpicSectionClockForTests } from '../../../../lib/epicSectionClock';

vi.mock('../../../../auth/AuthContext', () => ({
  // sk-551.8 — LayoutProvider reads the layout via useNavLayoutOptional;
  // null = no session known, the side-by-side layout.
  useAuthOptional: () => null,
  useAuth: () => ({
    user: { id: 'u-nav', username: 'nav', role: 'user' },
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

import { EpicProgressSection } from './EpicProgressSection';

const UUID_A = '0198aaaa-0000-7000-8000-00000000000a';
const UUID_B = '0198bbbb-0000-7000-8000-00000000000b';

const FILTERED = '/projects/proj-a/components/cmp-a-1/issues/ep-1';
const QUERY = '?q=needle';

const EPIC: IssueDetail = {
  id: 'ep-1',
  projectId: UUID_A,
  version: 1,
  title: 'epic',
  description: '',
  type: 'epic',
  priority: 2,
  status: 'open',
  pinned: false,
  source: 'human',
  design: '',
  acceptanceCriteria: '',
  notes: '',
  createdBy: 'u-1',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
  metadata: {},
  componentIds: [],
  labels: [],
  commentsCount: 0,
  commitRefs: [],
  mentions: [],
  isBlocked: false,
  blockers: [],
  epic: {
    totalChildren: 2,
    openChildren: 2,
    inProgressChildren: 0,
    closedChildren: 0,
    blockedChildren: 0,
    eligibleForClose: false,
  },
} as IssueDetail;

function node(id: string, projectId: string, depth: number): IssueTreeNode {
  return {
    item: {
      id, projectId, version: 1, title: id, type: depth === 0 ? 'epic' : 'task', priority: 2,
      status: 'open', pinned: false, componentIds: [], labels: [], isBlocked: false,
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z',
    },
    depth,
    parentRef: depth === 0 ? null : { id: 'ep-1', edgeType: 'parent-child' },
    isReference: false,
    firstSeenAt: null,
  } as IssueTreeNode;
}

/** Root, a child of the SAME project and a child of project B. */
const TREE: IssueTreeNode[] = [
  node('ep-1', UUID_A, 0),
  node('ep-1.1', UUID_A, 1),
  node('bb-5', UUID_B, 1),
];

const PROJECTS = {
  items: [
    { id: UUID_A, idPrefix: 'proj-a', name: 'A' },
    { id: UUID_B, idPrefix: 'proj-b', name: 'B' },
  ],
} as unknown as ListProjectsResult;

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/issues/tree')) {
        return new Response(JSON.stringify({ items: TREE }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new TypeError('offline');
    }),
  );
}

function Probe() {
  const location = useLocation();
  return (
    <>
      <div data-testid="path">{location.pathname}</div>
      <div data-testid="search">{location.search}</div>
    </>
  );
}

function Card() {
  return (
    <LayoutProvider>
      <EpicProgressSection issue={EPIC} />
      <Probe />
    </LayoutProvider>
  );
}

/** `projectsKnown` — whether the shell's projects list is in the cache. */
function mountAt(entry: string, { projectsKnown }: { projectsKnown: boolean }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  if (projectsKnown) qc.setQueryData(projectsListQueryKey, PROJECTS);
  stubFetch();
  return render(
    <MantineProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route path="/issues/:id" element={<Card />} />
            <Route path="/projects/:alias/issues/:id" element={<Card />} />
            <Route path="/projects/:alias/components/:cid/issues/:id" element={<Card />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

type View = ReturnType<typeof mountAt>;
type Mode = 'List' | 'Tree';
type How = 'mouse' | 'Enter';

const openName = (id: string) => `Open child issue ${id}: ${id}`;

/** Open child `id` in `mode` by `how`; returns the resulting address. */
async function open(view: View, mode: Mode, how: How, id: string) {
  const user = userEvent.setup();
  if (mode === 'Tree') await user.click(await view.findByRole('radio', { name: 'Tree' }));
  const button = await view.findByRole('button', { name: openName(id) });
  if (mode === 'Tree') expect(button.closest('[role="treeitem"]')).not.toBeNull();
  if (how === 'mouse') {
    await user.click(button);
  } else {
    // «List»: Enter on the row button; «Tree»: Enter on the tree row.
    const target = mode === 'Tree' ? button.closest<HTMLElement>('[role="treeitem"]')! : button;
    act(() => target.focus());
    await user.keyboard('{Enter}');
  }
  await waitFor(() => expect(view.getByTestId('path').textContent).not.toBe(FILTERED));
  return {
    path: view.getByTestId('path').textContent,
    search: view.getByTestId('search').textContent,
  };
}

beforeEach(() => {
  window.localStorage.clear();
  resetEpicSectionClockForTests();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('sk-439 — open an epic child from a route with a component filter', () => {
  for (const mode of ['List', 'Tree'] as const) {
    for (const how of ['mouse', 'Enter'] as const) {
      test(`«${mode}», ${how}: a project B child → address without project A's component, query string kept`, async () => {
        const view = mountAt(FILTERED + QUERY, { projectsKnown: true });
        const to = await open(view, mode, how, 'bb-5');
        expect(to).toEqual({ path: `/projects/${UUID_B}/issues/bb-5`, search: QUERY });
        expect(to.path).not.toContain('/components/');
      });

      test(`«${mode}», ${how}: a child of its own project (UUID vs alias in the address) → component and query string kept`, async () => {
        const view = mountAt(FILTERED + QUERY, { projectsKnown: true });
        const to = await open(view, mode, how, 'ep-1.1');
        expect(to).toEqual({
          path: `/projects/${UUID_A}/components/cmp-a-1/issues/ep-1.1`,
          search: QUERY,
        });
      });
    }
  }

  test('project list unknown → target project unknown → component is NOT carried over (safe side)', async () => {
    const view = mountAt(FILTERED + QUERY, { projectsKnown: false });
    const to = await open(view, 'List', 'mouse', 'ep-1.1');
    expect(to).toEqual({ path: `/projects/${UUID_A}/issues/ep-1.1`, search: QUERY });
  });

  test('«All projects»: address and query string — as they were', async () => {
    const view = mountAt(`/issues/ep-1${QUERY}`, { projectsKnown: true });
    const to = await open(view, 'List', 'mouse', 'bb-5');
    expect(to).toEqual({ path: '/issues/bb-5', search: QUERY });
  });
});
