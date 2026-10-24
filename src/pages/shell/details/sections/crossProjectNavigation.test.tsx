/**
 * sk-421.1 T014 / T015 — review fix F-3: opening a parent or a blocker that
 * lives in ANOTHER project, from a component-filtered route.
 *
 * `layout.setSelectedIssue(id, projectHandle)` keeps the CURRENT route's
 * component segment, so on `/projects/A/components/<A's component>/issues/…`
 * it built `/projects/B/components/<A's component>/issues/<id>` — another
 * project filtered by a component it does not have. «Dependencies» goes to
 * `/projects/<pid>/issues/<id>`; the properties row and the «Blocked»
 * block now do the same.
 *
 * Harness: a REAL router on the app's own route shapes and a REAL
 * `LayoutProvider` (with its query client). The test reads the location the
 * click produced, not a spy — so the old helper path, which needs the
 * provider, renders here too and fails on the URL it builds, not on a
 * missing provider.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import type { DependencyList } from '../../../../api/dependencies';
import type { IssueDetail, IssueTreeNode } from '../../../../api/issues';
import { LayoutProvider } from '../../../../lib/useLayoutState';
import {
  issueDependenciesKey,
  issueDetailKey,
  issueWatchersKey,
} from '../../../../lib/useIssueDetail';
import { layeredTreeQueryKey } from '../../../../lib/useLayeredTree';
import { resetEpicSectionClockForTests } from '../../../../lib/epicSectionClock';

vi.mock('../../../../lib/useProjectComponentNames', () => ({
  useProjectComponentNames: () => ({ status: 'pending', data: undefined }),
}));

// sk-421.2.8 row 38 — the epic section reads the user (mode memory,
// sk-421.2 R-6), and `useAuth` outside a provider throws. The other surfaces
// of the stand do not read the user, so the mock does not affect them.
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

// sk-421.2.8 row 39 — a stand with the real details panel. Sections that do not
// take part in navigation and focus are stubbed (otherwise each would hit the network);
// the epic section, «Dependencies», the properties row and «Blocked» are real:
// the stands of row 38 and F-3 of this file rest on them.
vi.mock('./ActivitySection', () => ({ ActivitySection: () => null }));
vi.mock('./AttachmentsSection', () => ({ AttachmentsSection: () => null }));
vi.mock('./ClosedReasonSection', () => ({ ClosedReasonSection: () => null }));
vi.mock('./CommentsSection', () => ({ CommentsSection: () => null }));
vi.mock('./CommitsSection', () => ({ CommitsSection: () => null }));
vi.mock('./EditableTextSection', () => ({ EditableTextSection: () => null }));
vi.mock('./RemindersSection', () => ({ RemindersSection: () => null }));
vi.mock('./ReviewFlagSection', () => ({ ReviewFlagSection: () => null }));
vi.mock('./WatchersSection', () => ({ WatchersSection: () => null }));
vi.mock('../PeopleChain', () => ({ PeopleChain: () => null }));
vi.mock('../IssueTitleEdit', () => ({ IssueTitleEdit: () => null }));
vi.mock('../../../../lib/useReminders', async (importActual) => {
  const actual = await importActual<typeof import('../../../../lib/useReminders')>();
  // The real hook returns an ARRAY (the panel reads `.length`).
  return { ...actual, useIssueReminders: () => [] };
});
vi.mock('../../../../lib/useProjectByHandle', async (importActual) => {
  const actual = await importActual<typeof import('../../../../lib/useProjectByHandle')>();
  return {
    ...actual,
    useProjectByHandle: (handle: string | null) => ({
      project: handle ? { id: handle, idPrefix: handle, name: handle } : null,
      isLoading: false,
      isUnresolved: false,
    }),
  };
});

import { IssueDetailPanel } from '../IssueDetailPanel';
import { BlockedBySection } from './BlockedBySection';
import { DependenciesSection } from './DependenciesSection';
import { EpicProgressSection } from './EpicProgressSection';
import { IssuePropertiesRow } from './IssuePropertiesRow';

/** The route the card was opened from: project A, filtered by A's component. */
const FILTERED_ROUTE = '/projects/proj-a/components/cmp-a-1/issues/sk-1';

function issue(): IssueDetail {
  return {
    id: 'sk-1',
    projectId: 'proj-a',
    version: 1,
    title: 'task',
    description: '',
    type: 'task',
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
    parentIdCurrent: 'sk-900',
    isBlocked: true,
    blockers: [{ id: 'other-2', title: 'Blocker in project B', status: 'in_progress' }],
  } as IssueDetail;
}

/** Parent and blocker both live in project B. */
const DEPS: DependencyList = {
  outgoing: [
    {
      type: 'parent-child',
      fromId: 'sk-1',
      toId: 'sk-900',
      version: 1,
      createdAt: '2026-01-01T00:00:00Z',
      metadata: {},
      issue: { id: 'sk-900', projectId: 'proj-b', title: 'Parent in B', status: 'open', priority: 2, type: 'epic' },
    },
    {
      type: 'blocks',
      fromId: 'sk-1',
      toId: 'other-2',
      version: 1,
      createdAt: '2026-01-01T00:00:00Z',
      metadata: {},
      issue: { id: 'other-2', projectId: 'proj-b', title: 'Blocker in project B', status: 'in_progress', priority: 2, type: 'task' },
    },
  ],
  incoming: [],
};

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function Card({ children }: { children?: ReactNode }) {
  const value = issue();
  return (
    <LayoutProvider>
      <IssuePropertiesRow
        issue={value}
        projectId={value.projectId}
        dependencies={DEPS}
        dependenciesStatus="success"
      />
      <BlockedBySection issue={value} dependencies={DEPS} dependenciesStatus="success" />
      <LocationProbe />
      {children}
    </LayoutProvider>
  );
}

function mountAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MantineProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            {/* The app's own shell route shapes (App.tsx). */}
            <Route path="/projects/:alias/components/:cid/issues/:id" element={<Card />} />
            <Route path="/projects/:alias/issues/:id" element={<Card />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

afterEach(cleanup);

describe('opening a card in another project from a component-filtered route (review F-3)', () => {
  test('parent in project B → /projects/B/issues/<id>, no component segment of project A', () => {
    const { container, getByTestId } = mountAt(FILTERED_ROUTE);
    expect(getByTestId('location').textContent).toBe(FILTERED_ROUTE);

    fireEvent.click(container.querySelector('[data-segment="parent"] button')!);

    expect(getByTestId('location').textContent).toBe('/projects/proj-b/issues/sk-900');
    expect(getByTestId('location').textContent).not.toContain('/components/');
  });

  test('blocker in project B → /projects/B/issues/<id>, no component segment of project A', () => {
    const { container, getByTestId } = mountAt(FILTERED_ROUTE);

    fireEvent.click(container.querySelector('.blocked-by-row button')!);

    expect(getByTestId('location').textContent).toBe('/projects/proj-b/issues/other-2');
    expect(getByTestId('location').textContent).not.toContain('/components/');
  });
});

// ─────────── sk-421.2.8 row 38 — blocker link in the epic section (US-3, SC-007, R-17) ───────────
//
// The stand is the real epic section with the real «List» and the real
// `useLayeredTree`. Rows arrive through a `fetch` stub in the wire shape
// (`/issues/tree`), not through a hook mock: this way the file stays usable
// for the row 39 stands with the real QueryClient cache.

/** An epic in project A; its child is blocked by a blocker from project B. */
function epic(): IssueDetail {
  return {
    ...issue(),
    id: 'ep-1',
    title: 'epic',
    type: 'epic',
    parentIdCurrent: undefined,
    isBlocked: false,
    blockers: [],
    epic: {
      totalChildren: 1,
      openChildren: 1,
      inProgressChildren: 0,
      closedChildren: 0,
      blockedChildren: 1,
      eligibleForClose: false,
    },
  } as IssueDetail;
}

/** The section's tree response: an epic root and one blocked child. */
const EPIC_TREE: IssueTreeNode[] = [
  {
    item: {
      id: 'ep-1', projectId: 'proj-a', version: 1, title: 'epic', type: 'epic', priority: 2,
      status: 'open', pinned: false, componentIds: [], labels: [], isBlocked: false,
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z',
    },
    depth: 0,
    parentRef: null,
    isReference: false,
    firstSeenAt: null,
  },
  {
    item: {
      id: 'ep-1.1', projectId: 'proj-a', version: 1, title: 'child', type: 'task', priority: 2,
      status: 'open', pinned: false, componentIds: [], labels: [], isBlocked: true,
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z',
    },
    depth: 1,
    parentRef: { id: 'ep-1', edgeType: 'parent-child' },
    isReference: false,
    firstSeenAt: null,
    // Four entries: the blocker from B first, so that it is in both the substring and
    // the expanded list; «+1» gives the expansion.
    blockers: [
      { id: 'other-2', title: 'Blocker in project B', status: 'in_progress', projectId: 'proj-b' },
      { id: 'sk-7', title: 'A7', status: 'open', projectId: 'proj-a' },
      { id: 'sk-8', title: 'A8', status: 'open', projectId: 'proj-a' },
      { id: 'sk-9', title: 'A9', status: 'open', projectId: 'proj-a' },
    ],
  },
];

/** Network stub: answers only the section tree; the rest — as without a network. */
function stubTreeFetch() {
  const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/issues/tree')) {
      return new Response(JSON.stringify({ items: EPIC_TREE }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new TypeError('offline');
  });
  vi.stubGlobal('fetch', fetchSpy);
  return fetchSpy;
}

function FullLocationProbe() {
  const location = useLocation();
  return (
    <>
      <div data-testid="path">{location.pathname}</div>
      <div data-testid="search">{location.search}</div>
    </>
  );
}

/** Epic card: the epic section and «Dependencies» on one stand. */
function EpicCard() {
  const value = epic();
  return (
    <LayoutProvider>
      <EpicProgressSection issue={value} />
      <DependenciesSection
        projectId={value.projectId}
        issueId={value.id}
        dependencies={DEPS}
        isEpic
      />
      <FullLocationProbe />
    </LayoutProvider>
  );
}

function mountEpicAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MantineProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            {/* The app's own shell route shapes (App.tsx). */}
            <Route path="/issues/:id" element={<EpicCard />} />
            <Route path="/projects/:alias/issues/:id" element={<EpicCard />} />
            <Route path="/projects/:alias/components/:cid/issues/:id" element={<EpicCard />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

/**
 * The blocker link EXACTLY in the epic section's substring. The «Dependencies»
 * link on the same stand has the same accessible name (`other-2`), and a search by role
 * and name alone could press it and give a green navigation, saying nothing about
 * the epic section. So the search is limited to the substring container.
 */
async function epicSublineLink(
  view: ReturnType<typeof mountEpicAt>,
  id: string,
): Promise<HTMLButtonElement> {
  // Wait for the substring's link: «Dependencies» is drawn at once, while the
  // section rows only after the tree response.
  return waitFor(() => {
    const link = Array.from(
      view.container.querySelectorAll<HTMLButtonElement>('.epic-child-blockers-line button'),
    ).find((b) => b.textContent === id);
    expect(link, `no link ${id} in the epic section substring`).toBeDefined();
    return link!;
  });
}

const EPIC_FILTERED_ROUTE = '/projects/proj-a/components/cmp-a-1/issues/ep-1';
/** The «All projects» view with the query string of the current view. */
const ALL_PROJECTS_ROUTE = '/issues/ep-1?q=blocker&sort=updated';

describe('sk-421.2.8 row 38 — navigating by a visible blocker from the epic section (R-17)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  test('link in the substring: project B blocker → /projects/proj-b/issues/<id>, no /components/, child not opened, mode unchanged', async () => {
    stubTreeFetch();
    const view = mountEpicAt(EPIC_FILTERED_ROUTE);
    const link = await epicSublineLink(view, 'other-2');
    // The mode before the click is «List».
    expect(view.getByRole('radio', { name: 'List' }).getAttribute('aria-checked')).toBe('true');

    fireEvent.click(link);

    // Neither component A's segment nor the child card (`/issues/ep-1.1`).
    expect(view.getByTestId('path').textContent).toBe('/projects/proj-b/issues/other-2');
    expect(view.getByTestId('path').textContent).not.toContain('/components/');
    expect(view.getByTestId('path').textContent).not.toContain('ep-1.1');
    expect(view.getByRole('radio', { name: 'List' }).getAttribute('aria-checked')).toBe('true');
  });

  test('the link in the expanded list leads to the same place', async () => {
    stubTreeFetch();
    const view = mountEpicAt(EPIC_FILTERED_ROUTE);
    fireEvent.click(await view.findByRole('button', { name: '+1' }));
    const expanded = view.getByRole('list', { name: 'All blockers' });
    const link = Array.from(expanded.querySelectorAll('button')).find(
      (b) => b.textContent === 'other-2',
    );
    expect(link, 'no blocker link in the expanded list').toBeDefined();

    fireEvent.click(link!);

    expect(view.getByTestId('path').textContent).toBe('/projects/proj-b/issues/other-2');
    expect(view.getByTestId('path').textContent).not.toContain('/components/');
    expect(view.getByRole('radio', { name: 'List' }).getAttribute('aria-checked')).toBe('true');
  });

  test('from the «All projects» view: the blocker project route, the query string is not carried over — as for «Dependencies»', async () => {
    stubTreeFetch();
    const fromEpic = mountEpicAt(ALL_PROJECTS_ROUTE);
    expect(fromEpic.getByTestId('search').textContent).toBe('?q=blocker&sort=updated');
    fireEvent.click(await epicSublineLink(fromEpic, 'other-2'));
    const epicResult = {
      path: fromEpic.getByTestId('path').textContent,
      search: fromEpic.getByTestId('search').textContent,
    };
    cleanup();

    // The reference is a navigation from «Dependencies» on the same route of the same stand.
    stubTreeFetch();
    const fromDeps = mountEpicAt(ALL_PROJECTS_ROUTE);
    const depsLink = Array.from(
      fromDeps.container.querySelectorAll<HTMLButtonElement>('.detail-row--dep .detail-row-link'),
    ).find((b) => b.textContent === 'other-2');
    expect(depsLink, 'no blocker link in «Dependencies»').toBeDefined();
    fireEvent.click(depsLink!);
    const depsResult = {
      path: fromDeps.getByTestId('path').textContent,
      search: fromDeps.getByTestId('search').textContent,
    };

    expect(epicResult).toEqual({ path: '/projects/proj-b/issues/other-2', search: '' });
    expect(epicResult).toEqual(depsResult);
  });
});

// ─────── sk-421.2.8 row 39 — focus after navigating by a blocker link (US-3, m-8) ───────
//
// A stand with a REAL card switch: the route and the details panel mount
// the epic E card; Enter on the blocker link changes the route, and the same panel
// shows the blocker B card. The main fixture has no loading frame:
// the detail, links and tree of B are in the QueryClient cache beforehand (by the mode keys,
// with the blockers flag), so the panel is not replaced by a loading stub, and
// the epic section, «List» and «Tree» (without `key`) survive the card switch.
//
// What is compared is the focus OUTCOME CLASS — the role and name of the focused element
// or `body` — for a navigation from the epic section («List» and «Tree» separately) and
// for a navigation from «Dependencies» of the child card C, which has the same blocker.
// The mutant is the substring's focus memory not reset on an epic change: it
// would pull the focus to a row of the new card's section.

const E = 'ep-e';
const C = 'ep-e.1';
const B = 'ep-b';

function detail(over: Partial<IssueDetail>): IssueDetail {
  return {
    ...issue(),
    parentIdCurrent: undefined,
    isBlocked: false,
    blockers: [],
    ...over,
  } as IssueDetail;
}

const EPIC_E = detail({
  id: E,
  projectId: 'proj-a',
  title: 'Epic E',
  type: 'epic',
  epic: { totalChildren: 1, openChildren: 1, inProgressChildren: 0, closedChildren: 0, blockedChildren: 1, eligibleForClose: false },
} as Partial<IssueDetail>);

const EPIC_B = detail({
  id: B,
  projectId: 'proj-b',
  title: 'Blocker epic B',
  type: 'epic',
  epic: { totalChildren: 1, openChildren: 1, inProgressChildren: 0, closedChildren: 0, blockedChildren: 0, eligibleForClose: false },
} as Partial<IssueDetail>);

const CHILD_C = detail({
  id: C,
  projectId: 'proj-a',
  title: 'Child C',
  type: 'task',
  parentIdCurrent: E,
  isBlocked: true,
  blockers: [{ id: B, title: 'Blocker epic B', status: 'open' }],
} as Partial<IssueDetail>);

function treeItem(id: string, projectId: string, over: Partial<IssueTreeNode['item']> = {}) {
  return {
    id, projectId, version: 1, title: id, type: 'task', priority: 2, status: 'open',
    pinned: false, componentIds: [], labels: [], isBlocked: false,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z',
    ...over,
  } as IssueTreeNode['item'];
}

const TREE_E: IssueTreeNode[] = [
  { item: treeItem(E, 'proj-a', { type: 'epic' }), depth: 0, parentRef: null, isReference: false, firstSeenAt: null },
  {
    item: treeItem(C, 'proj-a', { isBlocked: true }),
    depth: 1,
    parentRef: { id: E, edgeType: 'parent-child' },
    isReference: false,
    firstSeenAt: null,
    blockers: [{ id: B, title: 'Blocker epic B', status: 'open', projectId: 'proj-b' }],
  },
];

const TREE_B: IssueTreeNode[] = [
  { item: treeItem(B, 'proj-b', { type: 'epic' }), depth: 0, parentRef: null, isReference: false, firstSeenAt: null },
  {
    item: treeItem('ep-b.1', 'proj-b'),
    depth: 1,
    parentRef: { id: B, edgeType: 'parent-child' },
    isReference: false,
    firstSeenAt: null,
  },
];

const DEPS_C: DependencyList = {
  outgoing: [
    {
      type: 'blocks',
      fromId: C,
      toId: B,
      version: 1,
      createdAt: '2026-01-01T00:00:00Z',
      metadata: {},
      issue: { id: B, projectId: 'proj-b', title: 'Blocker epic B', status: 'open', priority: 2, type: 'epic' },
    },
  ],
  incoming: [],
};
const NO_DEPS: DependencyList = { outgoing: [], incoming: [] };

function seedTree(qc: QueryClient, rootId: string, rows: IssueTreeNode[]) {
  // An entry in the shape `useLayeredTree` stores it: the rows and the moment
  // of the request. The key comes from the exported builder.
  //
  // sk-460.12 — ONE key: the «List» scope is merged with «Tree», they share
  // the request. Before, two were seeded, one per mode key.
  const payload = { rows, requestedAt: Date.now() };
  qc.setQueryData(layeredTreeQueryKey(null, rootId, ['parent-child'], undefined, true), payload);
}

function seededClient(withBlockerCard = true): QueryClient {
  // staleTime Infinity: seeded entries are not refetched on mount —
  // the network is closed on this stand, and a refetch would turn the card into an error.
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  for (const [value, deps] of [
    [EPIC_E, NO_DEPS],
    [CHILD_C, DEPS_C],
    ...(withBlockerCard ? [[EPIC_B, NO_DEPS] as const] : []),
  ] as Array<readonly [IssueDetail, DependencyList]>) {
    qc.setQueryData(issueDetailKey(value.id), value);
    qc.setQueryData(issueDependenciesKey(value.projectId, value.id), deps);
    qc.setQueryData(issueWatchersKey(value.id), []);
  }
  seedTree(qc, E, TREE_E);
  if (withBlockerCard) seedTree(qc, B, TREE_B);
  return qc;
}

function PanelRoute() {
  const { alias, id } = useParams();
  return (
    <>
      <IssueDetailPanel issueId={id!} projectHandle={alias ?? null} />
      <FullLocationProbe />
    </>
  );
}

function mountPanel(path: string, qc: QueryClient) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new TypeError('offline');
    }),
  );
  return render(
    <MantineProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route
              path="/projects/:alias/issues/:id"
              element={
                <LayoutProvider>
                  <PanelRoute />
                </LayoutProvider>
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

/** Focus outcome class: the role and name of the focused element or `body`. */
function focusOutcome(): string {
  const el = document.activeElement as HTMLElement | null;
  if (!el || el === document.body) return 'body';
  const role = el.getAttribute('role') ?? el.tagName.toLowerCase();
  const name = el.getAttribute('aria-label') ?? el.textContent ?? '';
  return `${role}:${name}`;
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

/** The blocker link in the epic section's substring (not in «Dependencies»). */
async function sublineLink(container: HTMLElement, id: string): Promise<HTMLButtonElement> {
  return waitFor(() => {
    const link = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.epic-child-blockers-line button'),
    ).find((b) => b.textContent === id);
    expect(link, `no link ${id} in the substring`).toBeDefined();
    return link!;
  });
}

async function runFromEpicSection(mode: 'list' | 'tree') {
  const view = mountPanel(`/projects/proj-a/issues/${E}`, seededClient());
  if (mode === 'tree') {
    fireEvent.click(await view.findByRole('radio', { name: 'Tree' }));
  }
  const link = await sublineLink(view.container, B);
  if (mode === 'tree') {
    expect(link.closest('[role="treeitem"]'), 'the link is not in a «Tree» row').not.toBeNull();
  } else {
    expect(link.closest('li'), 'the link is not in a «List» row').not.toBeNull();
  }
  const sectionBefore = view.container.querySelector('.epic-progress');
  expect(sectionBefore).not.toBeNull();

  const user = userEvent.setup();
  link.focus();
  await user.keyboard('{Enter}');

  await waitFor(() => expect(view.getByTestId('path').textContent).toBe(`/projects/proj-b/issues/${B}`));
  // Stand preconditions: the new card's rows are visible, the epic section root is
  // the same DOM node (the panel was not replaced by a loading stub).
  await waitFor(() =>
    expect(
      Array.from(view.container.querySelectorAll('.epic-child-title')).map((el) => el.textContent),
    ).toContain('ep-b.1'),
  );
  expect(view.container.querySelector('.epic-progress')).toBe(sectionBefore);
  await settle();
  return focusOutcome();
}

async function runFromDependencies() {
  const view = mountPanel(`/projects/proj-a/issues/${C}`, seededClient());
  const link = await waitFor(() => {
    const found = Array.from(
      view.container.querySelectorAll<HTMLButtonElement>('.detail-row--dep .detail-row-link'),
    ).find((b) => b.textContent === B);
    expect(found, 'no blocker link in «Dependencies»').toBeDefined();
    return found!;
  });
  const user = userEvent.setup();
  link.focus();
  await user.keyboard('{Enter}');
  await waitFor(() => expect(view.getByTestId('path').textContent).toBe(`/projects/proj-b/issues/${B}`));
  await waitFor(() =>
    expect(
      Array.from(view.container.querySelectorAll('.epic-child-title')).map((el) => el.textContent),
    ).toContain('ep-b.1'),
  );
  await settle();
  return focusOutcome();
}

describe('sk-421.2.8 row 39 — focus after navigating by a blocker link is as after «Dependencies»', () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetEpicSectionClockForTests();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  test('epic section «List»: the focus outcome class is the same as for «Dependencies»', async () => {
    const fromList = await runFromEpicSection('list');
    cleanup();
    window.localStorage.clear();
    const fromDeps = await runFromDependencies();
    expect(fromList).toBe(fromDeps);
  });

  test('epic section «Tree»: the focus outcome class is the same as for «Dependencies»', async () => {
    const fromTree = await runFromEpicSection('tree');
    cleanup();
    window.localStorage.clear();
    const fromDeps = await runFromDependencies();
    expect(fromTree).toBe(fromDeps);
  });

  test('stand check without a cache (with a loading frame): the card really changed', async () => {
    // Does not count as discrimination — it only confirms that the navigation
    // changes the card, and not the route on top of the same one.
    const view = mountPanel(`/projects/proj-a/issues/${E}`, seededClient(false));
    const link = await sublineLink(view.container, B);
    const user = userEvent.setup();
    link.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(view.getByTestId('path').textContent).toBe(`/projects/proj-b/issues/${B}`));
    await waitFor(() => expect(view.container.textContent).toContain(B));
    expect(view.container.querySelector('.epic-progress')).toBeNull();
    await settle();
    expect(focusOutcome()).toBe('body');
  });
});
