/**
 * sk-674.18 T052 — the place «space» (spec US-3; the
 * `outboxMode` invariant of the root CLAUDE.md; screens 1.7, 1.16).
 *
 * On `/spaces/<id>-<slug>` the Tasks column lists every project of the
 * space, and the Delegated lens (`outboxMode`) switches EVERY surface of
 * the place at once: the list (its rows), the header counter (its total)
 * and the filter predicate the list is read under (`createdBy=me` — the
 * `/me/created-by` read — still narrowed to the space). A surface that
 * kept the unlensed value while the
 * others switched is the defect the row names.
 *
 * A space the reader cannot see and a space that does not exist read the
 * same: «Space not found» with the way back to «All projects», and no
 * request for the space goes out — the client cannot tell them apart and
 * must not let the server's answer differ either.
 *
 * The real Shell, layout provider, `useTasks` and `useMySpaces` over a
 * stubbed `fetch`; the list hooks the column does not own are stubbed as
 * in `HeaderBar.navSections.test.tsx`.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '../../../i18n/config';
import type { IssueSummary } from '../../../api/issues';
import type { MySpace } from '../../../api/spaces';

const SESSION = {
  user: { id: 'u-1', email: 'u1@test.com', username: 'u1', name: 'U1', role: 'user' },
  isLoading: false,
  sessionResolved: true,
  login: vi.fn(),
  logout: vi.fn(),
};
vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => SESSION,
  useAuthOptional: () => SESSION,
}));

vi.mock('../../../components/Toaster', () => ({
  useToaster: () => ({ info: vi.fn(), error: vi.fn(), success: vi.fn() }),
  toaster: { info: vi.fn(), error: vi.fn(), success: vi.fn() },
}));

// The Inbox queue reads `/me/assigned-to` too; it is by the person, not by
// the place, so it is stubbed out of the request log (as in
// `HeaderBar.navSections.test.tsx`).
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

import { Shell } from '../Shell';
import { uiPrefsKey } from '../../../lib/useUiPrefs';

const ACME = 'k3x9p2qa';

const mySpaces: MySpace[] = [
  { id: 'p0aa11bb', name: 'Личное', kind: 'personal' },
  { id: ACME, name: 'Acme', kind: 'regular' },
].map((s) => ({
  ...s,
  slug: s.name.toLowerCase(),
  kind: s.kind as MySpace['kind'],
  myRole: 'member' as const,
  adminAccess: false,
  canCreateProject: true,
  memberCount: 2,
  memberLimit: null,
  pendingInvitations: 0,
  projectCount: 1,
  projectQuota: null,
  storageUsedBytes: 0,
  storageQuotaBytes: null,
}));

const issue = (id: string, title: string, assignee: string): IssueSummary => ({
  id,
  projectId: 'proj-acme',
  spaceId: ACME,
  parentIdCurrent: null,
  version: 1,
  title,
  type: 'task',
  priority: 2,
  status: 'open',
  pinned: false,
  assignee,
  assigneeUserId: null,
  isBlocked: false,
  componentIds: [],
  labels: [],
  createdAt: '2026-10-01T10:00:00Z',
  updatedAt: '2026-10-01T10:00:00Z',
});

/** Every request the page made, as a URL. */
let requests: URL[] = [];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  window.localStorage.clear();
  requests = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === 'string' ? input : input.toString(), 'http://app.test');
      requests.push(url);
      if (url.pathname === '/api/v1/me/spaces') {
        return json({ items: mySpaces, ownedCount: 0, ownedLimit: null, canCreate: true, cannotCreateReason: null });
      }
      // Without the lens: every task of the space.
      if (url.pathname === '/api/v1/issues') {
        return json({
          items: [
            issue('ac-1', 'Everyone sees this', 'bob'),
            issue('ac-2', 'Mine to delegate', 'carol'),
            issue('ac-3', 'Another one', 'dave'),
          ],
          total: 3,
          hasMore: false,
          nextCursor: null,
        });
      }
      // Delegated: what I created and gave to someone else.
      if (url.pathname === '/api/v1/me/created-by') {
        return json({
          items: [issue('ac-2', 'Mine to delegate', 'carol')],
          total: 1,
          hasMore: false,
          nextCursor: null,
        });
      }
      return json({ error: 'not_found' }, 404);
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

function mount(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(uiPrefsKey('u-1'), { issueModalViews: [], density: 'normal', navLayout: 'columns' });
  return render(
    <MantineProvider forceColorScheme="dark">
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/" element={<Shell />} />
            <Route path="/spaces/:space" element={<Shell />} />
            <Route path="/spaces/:space/issues/:id" element={<Shell />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

/** The Tasks column header's counter. */
function headerCount(): string | null {
  return document.querySelector('.col-tasks-header .col-header-count')?.textContent ?? null;
}

/**
 * The reads of the Tasks column's list — every endpoint `useTasks` can
 * call for a place without a project. The personal queues (Inbox,
 * Watching) are by the person, not by the place, and are not counted.
 */
const LIST_PATHS = new Set([
  '/api/v1/issues',
  '/api/v1/me/created-by',
  '/api/v1/me/assigned-to',
  '/api/v1/search',
]);
const listReads = () => requests.filter((u) => LIST_PATHS.has(u.pathname));

describe('row 237 — the Delegated lens switches every surface of the space place', () => {
  test('without the lens: all tasks of the space — list, counter and the read', async () => {
    mount(`/spaces/${ACME}-acme`);
    expect(await screen.findByText('Everyone sees this')).toBeTruthy();
    expect(screen.getByText('Another one')).toBeTruthy();
    expect(headerCount()).toBe('3');
    const reads = listReads();
    expect(reads.map((u) => u.pathname)).toEqual(['/api/v1/issues']);
    expect(reads[0].searchParams.get('space')).toBe(ACME);
    // The heading names the place.
    expect(screen.getByText('Acme', { selector: '.tasks-heading-project' })).toBeTruthy();
  });

  test('with the lens: the list, the counter and the read all switch to «created by me», still in the space', async () => {
    mount(`/spaces/${ACME}-acme?lens=delegated`);
    expect(await screen.findByText('Mine to delegate')).toBeTruthy();
    // The rows only the unlensed read returns are gone.
    expect(screen.queryByText('Everyone sees this')).toBeNull();
    expect(screen.queryByText('Another one')).toBeNull();
    // The counter is the lens's total, not the space's.
    expect(headerCount()).toBe('1');
    // The filter predicate is the lens's — `/me/created-by` — narrowed to
    // the space, and no unlensed read of the space went out.
    const reads = listReads();
    expect(reads.map((u) => u.pathname)).toEqual(['/api/v1/me/created-by']);
    expect(reads[0].searchParams.get('space')).toBe(ACME);
    // The place stays named under the lens.
    expect(screen.getByText('Acme', { selector: '.tasks-heading-project' })).toBeTruthy();
  });
});

describe('row 237 — an inaccessible space and a nonexistent one read the same', () => {
  // `z9z9z9z9` exists for someone else, `qqqqqqqq` for nobody: neither is
  // among the reader's spaces, and that is all the client can know.
  test.each([
    ['another person’s space', 'z9z9z9z9-secret'],
    ['a space that does not exist', 'qqqqqqqq-nothing'],
  ])('%s: «Space not found», the way back, and no request for it', async (_label, segment) => {
    // The same assertions for both — the client has nothing that could
    // tell them apart, so neither may show more than the other.
    mount(`/spaces/${segment}`);
    expect(await screen.findByText(i18n.t('tasks:spaceNotFound'))).toBeTruthy();
    const back = screen.getByRole('link', { name: i18n.t('tasks:spaceNotFoundBack') });
    expect(back.getAttribute('href')).toBe('/');
    expect(listReads()).toEqual([]);
    expect(headerCount()).toBe('0');
    // No task of any space is listed and no space of the reader is named.
    expect(screen.queryByText('Everyone sees this')).toBeNull();
    expect(screen.queryByText('Acme', { selector: '.tasks-heading-project' })).toBeNull();
  });
});
