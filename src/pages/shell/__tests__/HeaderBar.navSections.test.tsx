/**
 * sk-551.8 F11 — the queue badges and the sum button with the sections
 * layout (US-12, US-9).
 *
 * Reference: spec US-12 (a badge on the shown sections column is the
 * person's GESTURE: it opens the column and the Queues section and, on a
 * board, records the sections opt-out; a badge on a page without the
 * column — /search included, in the sections layout — leads into the task
 * shell, which reveals by address, without an opt-out; neither touches
 * the side-by-side values), US-9 / "Scope" (on a phone the sum button
 * writes nothing in either layout's record), "Concepts → Expansion by
 * address".
 *
 * The real HeaderBar, AppChrome, Shell and layout provider in ONE router,
 * so the badge's reveal mark and the shell's address subscriber meet with
 * nothing stubbed between them. Stubbed: the session, the list data hooks
 * (as in `Shell.test.tsx`), the toaster, and `fetch`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '../../../i18n/config';
import { resetViewportWidth, setViewportWidth } from '../../../test/viewport';

const SESSION = {
  user: { id: 'u-1', email: 'admin@test.com', username: 'admin', name: 'Admin', role: 'admin' },
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

vi.mock('../../../lib/useInbox', () => ({
  inboxQueryKey: ['inbox', 'assigned-to-me-unaccepted-open'] as const,
  useInbox: () => ({
    data: {
      items: [
        {
          id: 'sk-1',
          projectId: 'p1',
          parentIdCurrent: null,
          version: 1,
          title: 'Sample inbox issue',
          type: 'task',
          priority: 3,
          status: 'open',
          pinned: false,
          componentIds: [],
          labels: [],
          updatedAt: '2026-05-01T10:00:00Z',
          createdAt: '2026-05-01T09:00:00Z',
        },
      ],
      hasMore: false,
      nextCursor: null,
    },
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
      inbox: 1,
      mentions: 0,
      watching: 0,
      onMeOpenCount: 0,
      delegatedOpenCount: 0,
      reviewMechanicEnabled: false,
      delegatedUnreviewedCount: null,
    },
    isLoading: false,
    error: null,
  }),
}));

import { Shell } from '../Shell';
import { AppChrome } from '../AppChrome';
import { uiPrefsKey } from '../../../lib/useUiPrefs';

let currentLocation: { pathname: string; search: string } | null = null;
function LocationProbe() {
  const l = useLocation();
  currentLocation = { pathname: l.pathname, search: l.search };
  return null;
}

function mount(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(uiPrefsKey('u-1'), { issueModalViews: [], density: 'normal', navLayout: 'sections' });
  return render(
    <MantineProvider forceColorScheme="dark">
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>
          <LocationProbe />
          <Routes>
            <Route path="/" element={<Shell />} />
            <Route element={<AppChrome />}>
              <Route path="/search" element={<div>search page</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

/** Every `skein.layout.*` key and its value. */
function layoutKeys(): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const k = window.localStorage.key(i)!;
    if (k.startsWith('skein.layout.')) out[k] = window.localStorage.getItem(k);
  }
  return out;
}

/** The side-by-side record (INV-3). */
function sideBySide(): Record<string, string | null> {
  const all = layoutKeys();
  return Object.fromEntries(
    Object.entries(all).filter(
      ([k]) =>
        k.startsWith('skein.layout.col.') ||
        k === 'skein.layout.inbox-collapsed' ||
        k === 'skein.layout.kanban-workspace',
    ),
  );
}

const inboxBadge = () =>
  within(screen.getByRole('navigation', { name: i18n.t('header:queuesAria') })).getByRole('link', {
    name: `${i18n.t('header:badges.inbox')} 1`,
  });

const navWorkspace = () =>
  JSON.parse(window.localStorage.getItem('skein.layout.nav.workspace') ?? '{"auto":false,"optOut":false}') as {
    auto: boolean;
    optOut: boolean;
  };

/**
 * Folded everywhere. The side-by-side record carries a non-default
 * opt-out but no auto-fold mark: a mark on cards is stale, and the shell
 * shown again on cards drops it by rule (Concepts → Return) — that is not
 * what these cases are about.
 */
function seedFolded() {
  window.localStorage.setItem('skein.layout.nav.collapsed', 'true');
  window.localStorage.setItem(
    'skein.layout.nav.sections',
    JSON.stringify({ split: 0.5, collapsed: { projects: false, queues: true } }),
  );
  window.localStorage.setItem('skein.layout.inbox-collapsed', 'true');
  window.localStorage.setItem('skein.layout.col.projects-collapsed', 'true');
  window.localStorage.setItem(
    'skein.layout.kanban-workspace',
    JSON.stringify({ auto: { inbox: false, projects: false }, optOut: { inbox: true, projects: true } }),
  );
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  currentLocation = null;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{"error":"not_found"}', { status: 404, headers: { 'Content-Type': 'application/json' } })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetViewportWidth();
  window.localStorage.clear();
});

describe('F11 — a badge on /search, sections layout: into the shell, revealed by address', () => {
  it('leads to /?tab=…; on a board the shell that opens shows the column and the Queues section with no opt-out and the mark kept, side-by-side values untouched', () => {
    seedFolded();
    // On a board, marked by the board's auto-fold: a GESTURE would write
    // the opt-out and drop the mark; a reveal by address does neither.
    window.localStorage.setItem('skein.tasks.view', 'kanban');
    window.localStorage.setItem('skein.layout.nav.workspace', JSON.stringify({ auto: true, optOut: false }));
    mount('/search');
    const before = sideBySide();
    fireEvent.click(inboxBadge());
    expect(currentLocation).toEqual({ pathname: '/', search: '?tab=inbox' });
    expect(screen.getByRole('region', { name: i18n.t('shell:nav.queues') })).toBeTruthy();
    expect(window.localStorage.getItem('skein.layout.nav.collapsed')).toBe('false');
    expect(JSON.parse(window.localStorage.getItem('skein.layout.nav.sections')!).collapsed.queues).toBe(false);
    expect(navWorkspace()).toEqual({ auto: true, optOut: false });
    expect(sideBySide()).toEqual(before);
  });
});

describe('F11 — the phone, sections layout: the sum button writes nothing', () => {
  it('not a single fold key of either layout changes', () => {
    setViewportWidth(500);
    seedFolded();
    mount('/');
    const before = layoutKeys();
    const main = screen.getByRole('main', { name: i18n.t('shell:workspace') });
    expect(main.getAttribute('data-active-zone')).not.toBe('queues');
    fireEvent.click(screen.getByRole('link', { name: i18n.t('header:queuesTotalAria', { count: 1 }) }));
    // what the button does on a phone: the Queues sheet
    expect(main.getAttribute('data-active-zone')).toBe('queues');
    expect(layoutKeys()).toEqual(before);
  });
});

describe('F11 — a badge on the shown sections column: a gesture', () => {
  it('board, sliver: the column and Queues open, the sections opt-out is written, kanban-workspace and inbox-collapsed unchanged', () => {
    window.localStorage.setItem('skein.tasks.view', 'kanban');
    seedFolded();
    window.localStorage.setItem('skein.layout.nav.workspace', JSON.stringify({ auto: true, optOut: false }));
    mount('/');
    const kanbanWorkspace = window.localStorage.getItem('skein.layout.kanban-workspace');
    const inboxCollapsed = window.localStorage.getItem('skein.layout.inbox-collapsed');
    const queueBody = document.querySelector<HTMLElement>('[data-queue-body]')!;
    queueBody.scrollTop = 120;
    fireEvent.click(inboxBadge());
    // the queue body is scrolled back to its top (US-12)
    expect(queueBody.scrollTop).toBe(0);
    expect(window.localStorage.getItem('skein.layout.nav.collapsed')).toBe('false');
    expect(JSON.parse(window.localStorage.getItem('skein.layout.nav.sections')!).collapsed.queues).toBe(false);
    expect(navWorkspace()).toEqual({ auto: false, optOut: true });
    expect(window.localStorage.getItem('skein.layout.kanban-workspace')).toBe(kanbanWorkspace);
    expect(window.localStorage.getItem('skein.layout.inbox-collapsed')).toBe(inboxCollapsed);
  });
});

describe('the phone, sections layout, /search: the sum button stays where it always went', () => {
  it('the address stays /search with its query, the task shell is not mounted, no fold key of either layout changes', () => {
    setViewportWidth(500);
    seedFolded();
    mount('/search?q=billing');
    const before = layoutKeys();
    fireEvent.click(screen.getByRole('link', { name: i18n.t('header:queuesTotalAria', { count: 1 }) }));
    expect(currentLocation?.pathname).toBe('/search');
    expect(new URLSearchParams(currentLocation!.search).get('q')).toBe('billing');
    expect(screen.getByText('search page')).toBeTruthy();
    expect(screen.queryByRole('main', { name: i18n.t('shell:workspace') })).toBeNull();
    expect(layoutKeys()).toEqual(before);
  });
});
