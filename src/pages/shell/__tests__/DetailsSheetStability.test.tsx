/**
 * sk-366 — crossing the mobile boundary must not REBUILD the description
 * panel.
 *
 * The defect, as measured before the fix: `DetailsColumn.frame()` opened
 * with `if (!sheet) return content;`, so the sheet wrapper appeared and
 * disappeared with the width mode. That moves the panel from the top of
 * the function's output to inside two new elements, and React answers a
 * change of DEPTH by unmounting the subtree and mounting a fresh one.
 * `.col-details` came back as a different node object; everything the
 * instance held went with the old one — an unsent comment draft first
 * among them. The spec's NF line: "Switching the width mode does not cause
 * loss of state (scroll position, selected task, typed
 * text)".
 *
 * ── Why NODE IDENTITY is the assertion, not "the markup is still right"
 *
 * A remount produces an identical-looking DOM. Only the object identity
 * of the host node distinguishes "React reused this element" from "React
 * built an equal one and threw the old state away". So every check below
 * compares element OBJECTS across the resize, and the typed-text check
 * carries the same claim one level deeper: the draft lives in a
 * `useState` inside the panel, so text that is still there after two
 * crossings proves the component instance was never torn down — which
 * identity alone cannot say.
 *
 * ── Why the guard tests are here ────────────────────────────────────
 *
 * Two ways this file could pass while claiming nothing: the resize might
 * not move the app between modes (then everything is compared with
 * itself), and the sheet might not actually render (then there is no
 * boundary to cross). Both are asserted outright before anything else.
 */

import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { setViewportWidth } from '../../../test/viewport';
import { issueDetailKey } from '../../../lib/useIssueDetail';
import type { IssueDetail } from '../../../api/issues';

// The same seams `WidthModeStatePersistence.test.tsx` cuts, for the same
// reason: the shell is exercised whole, and every network-backed hook it
// mounts would otherwise decide the outcome of a test about layout.

vi.mock('../../../auth/AuthContext', () => ({
  useAuthOptional: () => null,
  useAuth: () => ({
    user: {
      id: 'u-1',
      email: 'admin@test.com',
      username: 'admin',
      name: 'Admin',
      role: 'admin',
      createdAt: null,
      lastLoginAt: null,
    },
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

function summary(id: string, title: string) {
  return {
    id,
    projectId: 'p1',
    parentIdCurrent: null,
    version: 1,
    title,
    type: 'task',
    priority: 3,
    status: 'open',
    pinned: false,
    componentIds: [],
    labels: [],
    assignee: null,
    updatedAt: '2026-05-01T10:00:00Z',
    createdAt: '2026-05-01T09:00:00Z',
  };
}

const ALL = [summary('sk-1', 'One'), summary('sk-3', 'Three')];

vi.mock('../../../lib/useTasks', async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return {
    ...actual,
    useTasks: () => ({
      data: ALL,
      tree: null,
      total: ALL.length,
      totalIsExact: true,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: () => {},
      isLoading: false,
      error: null,
      emptyReason: null,
      searchDegraded: false,
      loadedAssignees: [],
      delegateeAssignees: [],
      resolvedProjectId: 'p1',
      min: null,
      max: null,
      sort: null,
    }),
  };
});

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

vi.mock('../../../lib/useNotificationCounts', () => ({
  notificationCountsKey: ['notification-counts'] as const,
  useNotificationCounts: () => ({
    counts: {
      inbox: 0,
      outbox: 0,
      mentions: 0,
      watching: 0,
      onMeOpenCount: 0,
      delegatedOpenCount: 0,
    },
    isLoading: false,
    error: null,
  }),
}));

import { Shell } from '../Shell';

const MOBILE = 390;
const DESKTOP = 1440;

/**
 * The open issue, seeded straight into the query cache.
 *
 * Not a mock of `useIssueDetail`: the panel is supposed to run its real
 * code here, because the thing under test is whether that code's STATE
 * survives. TanStack Query renders cached data immediately, so the panel
 * mounts fully — composer included — without a network layer.
 */
const DETAIL: IssueDetail = {
  id: 'sk-3',
  projectId: 'p1',
  parentIdCurrent: null,
  version: 1,
  title: 'Three',
  description: 'body',
  type: 'task',
  priority: 3,
  status: 'open',
  pinned: false,
  source: 'human',
  assignee: null,
  design: '',
  acceptanceCriteria: '',
  notes: '',
  createdBy: 'u-1',
  createdByUsername: 'admin',
  createdAt: '2026-05-01T09:00:00Z',
  updatedAt: '2026-05-01T10:00:00Z',
  componentIds: [],
  labels: [],
  mentions: [],
  commentsCount: 0,
  attachmentsCount: 0,
  childrenCount: 0,
  unclosedChildrenCount: 0,
  isBlocked: false,
  blockers: [],
  commitRefs: [],
  metadata: {},
} as unknown as IssueDetail;

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } },
  });
  qc.setQueryData(issueDetailKey('sk-3'), DETAIL);
  return (
    <MantineProvider forceColorScheme="dark">
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/projects/alpha/issues/sk-3']}>
          <Routes>
            <Route path="/projects/:alias/issues/:id" element={children} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>
  );
}

/** Move the window, the way the app hears it. */
function resizeTo(width: number): void {
  act(() => {
    setViewportWidth(width);
  });
}

const detailsNode = () => document.querySelector('.col-details');

/**
 * The comment composer — a `useState` behind a real textarea, inside the
 * panel. This is the field whose contents sk-366 says the user was
 * losing.
 */
function composer(): HTMLTextAreaElement {
  // By its accessible name, not by a Mantine-generated class: the class
  // is a build artefact and would rename itself on a dependency bump.
  const el = document.querySelector<HTMLTextAreaElement>(
    '.col-details textarea[aria-label="Add comment"]',
  );
  expect(el, 'the panel rendered no comment composer to type into').not.toBeNull();
  return el!;
}

/** The title field — a second piece of panel state, edited in place. */
function titleField(): HTMLTextAreaElement {
  const el = document.querySelector<HTMLTextAreaElement>('.col-details .issue-title-input');
  expect(el, 'the panel rendered no title field').not.toBeNull();
  return el!;
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  setViewportWidth(DESKTOP);
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-width-mode');
});

describe('sk-366 — the guards, so a green here cannot be vacuous', () => {
  test('the harness really crosses the boundary, and the sheet really appears', () => {
    render(
      <Wrapper>
        <Shell />
      </Wrapper>,
    );
    expect(document.documentElement.getAttribute('data-width-mode')).toBe('desktop');
    expect(document.querySelector('.details-sheet'), 'a sheet on desktop').toBeNull();

    resizeTo(MOBILE);
    expect(document.documentElement.getAttribute('data-width-mode')).toBe('mobile');
    // The sheet, its header and its way back — the branch that used to
    // do the rebuilding.
    expect(document.querySelector('.details-sheet')).not.toBeNull();
    expect(document.querySelector('.details-sheet-back')).not.toBeNull();

    resizeTo(DESKTOP);
    expect(document.querySelector('.details-sheet')).toBeNull();
  });

  test('the panel really mounted — there is something to lose', () => {
    render(
      <Wrapper>
        <Shell />
      </Wrapper>,
    );
    expect(detailsNode(), 'no description column at all').not.toBeNull();
    expect(
      document.querySelector('.col-details-empty'),
      'the description is showing its empty state — no issue is open',
    ).toBeNull();
    expect(composer()).toBeTruthy();
  });
});

describe('sk-366 — the panel is the SAME element on both sides of the boundary', () => {
  test.each([
    ['desktop → mobile → desktop', [MOBILE, DESKTOP]],
    ['desktop → mobile → desktop → mobile', [MOBILE, DESKTOP, MOBILE]],
  ])('%s reuses the description panel', (_name, widths) => {
    render(
      <Wrapper>
        <Shell />
      </Wrapper>,
    );
    const before = detailsNode();
    expect(before).not.toBeNull();
    for (const width of widths) {
      resizeTo(width);
      // Identity, not equality: an equal-looking node in the same place
      // is exactly what a remount produces.
      expect(detailsNode(), `the panel was rebuilt at ${width}px`).toBe(before);
    }
  });

  test('and it really did change frames — the wrapper renamed itself around it', () => {
    // Without this, "same node" could mean the sheet never engaged.
    render(
      <Wrapper>
        <Shell />
      </Wrapper>,
    );
    const node = detailsNode();
    expect(node!.closest('.details-frame'), 'no frame around it on desktop').not.toBeNull();
    expect(node!.closest('.details-sheet')).toBeNull();

    // BOTH wrappers rename, not just the outer one. The inner one is the
    // sheet's scrolling body — `display: flex` with a `1 1 0%` child —
    // and if it kept the off-sheet spelling it would stay `display:
    // contents` on the phone: no box, so nothing to give the panel its
    // height under the sheet header. That is invisible in jsdom unless
    // the class is asserted, so it is asserted.
    expect(node!.closest('.details-frame-body'), 'inner wrapper off-sheet').not.toBeNull();
    expect(node!.closest('.details-sheet-body')).toBeNull();

    resizeTo(MOBILE);
    expect(detailsNode()).toBe(node);
    expect(node!.closest('.details-sheet'), 'the sheet did not take it in').not.toBeNull();
    expect(node!.closest('.details-frame')).toBeNull();
    expect(
      node!.closest('.details-sheet-body'),
      'the inner wrapper kept its off-sheet class — the sheet body has no box',
    ).not.toBeNull();
    expect(node!.closest('.details-frame-body')).toBeNull();

    resizeTo(DESKTOP);
    expect(node!.closest('.details-frame-body'), 'the way back kept the sheet spelling').not.toBeNull();
    expect(node!.closest('.details-sheet-body')).toBeNull();
  });

  test('the frame element itself is reused too — it renames, it is not replaced', () => {
    render(
      <Wrapper>
        <Shell />
      </Wrapper>,
    );
    const frame = document.querySelector('.details-frame');
    expect(frame).not.toBeNull();
    resizeTo(MOBILE);
    expect(
      document.querySelector('.details-sheet'),
      'the sheet is a NEW element — the wrapper was rebuilt, not renamed',
    ).toBe(frame);
    resizeTo(DESKTOP);
    expect(document.querySelector('.details-frame')).toBe(frame);
  });
});

describe('sk-366 — the draft survives, which is what the user actually loses', () => {
  test('text typed into the panel is still there after two crossings', () => {
    render(
      <Wrapper>
        <Shell />
      </Wrapper>,
    );
    fireEvent.change(composer(), { target: { value: 'half-written comment' } });
    fireEvent.change(titleField(), { target: { value: 'Three, renamed' } });
    expect(composer().value).toBe('half-written comment');

    resizeTo(MOBILE);
    expect(composer().value, 'the sheet ate the comment draft').toBe('half-written comment');
    expect(titleField().value, 'the sheet ate the title edit').toBe('Three, renamed');
    resizeTo(DESKTOP);
    expect(composer().value, 'the way back ate the comment draft').toBe('half-written comment');
    expect(titleField().value, 'the way back ate the title edit').toBe('Three, renamed');
  });

  test('an EMPTY draft crossing is not mistaken for a surviving one', () => {
    // The negative path: the check above would pass just as well on a
    // remount if the field were empty on both sides, since '' === ''.
    // This states the baseline the other test is measured against.
    render(
      <Wrapper>
        <Shell />
      </Wrapper>,
    );
    expect(composer().value).toBe('');
    resizeTo(MOBILE);
    expect(composer().value).toBe('');
    // …and typing on the phone side survives the trip back, too.
    fireEvent.change(composer(), { target: { value: 'typed on the phone' } });
    resizeTo(DESKTOP);
    expect(composer().value).toBe('typed on the phone');
  });
});

describe('sk-366 — desktop layout is untouched by the frame', () => {
  test('the description is still inside the column row, in INV-1 order', () => {
    render(
      <Wrapper>
        <Shell />
      </Wrapper>,
    );
    const row = document.querySelector('.shell-columns');
    const panel = detailsNode();
    expect(row!.contains(panel!)).toBe(true);
    // Last of the four zones — the frame must not have moved it.
    const tasks = document.querySelector('.col-tasks, .col-tasks-collapsed');
    expect(
      tasks!.compareDocumentPosition(panel!) & Node.DOCUMENT_POSITION_FOLLOWING,
      'the description no longer comes after the Tasks zone',
    ).toBeTruthy();
  });
});
