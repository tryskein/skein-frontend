/**
 * sk-551.8 F12 — the sections column on the real Shell.
 *
 * Reference: INV-3 (the two layouts' stored values do not cross), US-5
 * and US-8 (the column's width per width mode; a tablet's live limit
 * limits on screen only), INV-7 (Projects → Queues → Tasks), US-3 (a
 * chevron folds a section, its content stays), US-10 (Q32 folds the
 * Queues section, not the column), US-15, US-7 p.2 (switching to
 * sections on a board folds the column when the PERSON switched; a late
 * profile does not), and the sections hint's own flag.
 *
 * The real Shell, the real layout provider, the real switch in the
 * account menu. Stubbed: the session (`auth/AuthContext`), the data
 * hooks of the queue/project lists (as in `Shell.test.tsx`), the toaster
 * (to count notifications), and `fetch` — the network — for the
 * profile's PUT. The person's profile is the query cache entry the real
 * client reads.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
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

const toastInfo = vi.fn();
vi.mock('../../../components/Toaster', () => ({
  useToaster: () => ({ info: toastInfo, error: vi.fn(), success: vi.fn() }),
  toaster: { info: vi.fn(), error: vi.fn(), success: vi.fn() },
}));

/** The Inbox queue's items; a test empties it to make the queue fall. */
let inboxItems: unknown[];
vi.mock('../../../lib/useInbox', () => ({
  inboxQueryKey: ['inbox', 'assigned-to-me-unaccepted-open'] as const,
  useInbox: () => ({
    data: { items: inboxItems, hasMore: false, nextCursor: null },
    isLoading: false,
    isError: false,
    isSuccess: true,
    error: null,
  }),
}));

// sk-674.18 T054 — the other read of the Inbox tab: no pending invitations,
// read successfully (the queue falls only when both reads succeeded).
vi.mock('../../../lib/useMyInvitations', () => ({
  useMyInvitations: () => ({ data: { items: [] }, isLoading: false, isError: false, isSuccess: true }),
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
import { uiPrefsKey } from '../../../lib/useUiPrefs';

const INBOX_ITEM = {
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
};

/** PUTs to /me/ui-prefs wait here until answered. */
let heldPuts: Array<() => void>;
let putBodies: unknown[];

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => {
  window.localStorage.clear();
  inboxItems = [INBOX_ITEM];
  heldPuts = [];
  putBodies = [];
  toastInfo.mockReset();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/v1/me/ui-prefs') && init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        putBodies.push(body);
        await new Promise<void>((resolve) => heldPuts.push(resolve));
        return json(200, { issueModalViews: [], density: 'normal', navLayout: 'columns', ...body });
      }
      return json(404, { error: 'not_found' });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetViewportWidth();
  window.localStorage.clear();
});

function prefs(navLayout: 'columns' | 'sections') {
  return { issueModalViews: [], density: 'normal', navLayout };
}

/** The router's navigate, for moves the test makes (a shared file link). */
let routerNavigate: ((to: string) => void) | null = null;
function RouterProbe() {
  const navigate = useNavigate();
  routerNavigate = (to) => navigate(to);
  return null;
}

function mountShell(navLayout: 'columns' | 'sections') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(uiPrefsKey('u-1'), prefs(navLayout));
  const tree = () => (
    <MantineProvider forceColorScheme="dark">
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/']}>
          <RouterProbe />
          <Shell />
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>
  );
  const view = render(tree());
  return {
    container: view.container,
    rerender: () => view.rerender(tree()),
    /** The profile now says this — a GET answer, not the person's click. */
    /** Move to another address inside the app (a link, Back to a file …). */
    go: (to: string) =>
      act(() => {
        routerNavigate!(to);
      }),
    profileSays: (layout: 'columns' | 'sections') =>
      act(() => {
        qc.setQueryData(uiPrefsKey('u-1'), prefs(layout));
      }),
  };
}

const viewButton = (view: 'cards' | 'kanban') =>
  screen.getByRole('button', {
    name: `${i18n.t('filters:labels.view')}: ${i18n.t(`filters:view.${view}`)}`,
  });

/** The stored values of the side-by-side layout (INV-3). */
function sideBySideKeys(): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const k = window.localStorage.key(i)!;
    if (
      k.startsWith('skein.layout.col.') ||
      k === 'skein.layout.inbox-collapsed' ||
      k === 'skein.layout.kanban-workspace'
    ) {
      out[k] = window.localStorage.getItem(k);
    }
  }
  return out;
}

const navWorkspace = () =>
  JSON.parse(window.localStorage.getItem('skein.layout.nav.workspace') ?? '{"auto":false,"optOut":false}') as {
    auto: boolean;
    optOut: boolean;
  };

describe('F12 (1) — INV-3: a layout round trip leaves the side-by-side values alone', () => {
  it('there and back: col.*, inbox-collapsed, col.projects-collapsed, kanban-workspace and the widths handed to the columns are unchanged', () => {
    // Seeded with values no write of the factory `false` / default could
    // reproduce, so a stray write shows.
    window.localStorage.setItem('skein.layout.col.inbox', '300');
    window.localStorage.setItem('skein.layout.col.projects', '320');
    window.localStorage.setItem('skein.layout.col.tasks', '500');
    window.localStorage.setItem('skein.layout.col.projects-collapsed', 'true');
    window.localStorage.setItem('skein.layout.inbox-collapsed', 'true');
    window.localStorage.setItem(
      'skein.layout.kanban-workspace',
      JSON.stringify({ auto: { inbox: false, projects: false }, optOut: { inbox: true, projects: false } }),
    );
    const shell = mountShell('columns');
    // The baseline is the shown shell: mounting writes its own state
    // through (e.g. the Tasks fold), which is not what is under test.
    const before = sideBySideKeys();
    shell.profileSays('sections');
    expect(shell.container.querySelector('.nav-column')).not.toBeNull();
    shell.profileSays('columns');

    expect(sideBySideKeys()).toEqual(before);
    // both navigation columns are folded (as seeded); the width handed to
    // Tasks is the stored one
    expect(shell.container.querySelector('.col-inbox-collapsed')).not.toBeNull();
    expect(shell.container.querySelector('.col-projects-collapsed')).not.toBeNull();
    expect(shell.container.querySelector<HTMLElement>('.col-tasks')!.style.width).toBe('500px');
  });
});

describe('F12 (2) — the sections column: order, chevrons, search, Q32', () => {
  it('regions go Projects → Queues → Tasks', () => {
    const shell = mountShell('sections');
    const projects = screen.getByRole('region', { name: i18n.t('shell:nav.projects') });
    const queues = screen.getByRole('region', { name: i18n.t('shell:nav.queues') });
    const tasks = shell.container.querySelector('.col-tasks')!;
    expect(projects.compareDocumentPosition(queues) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(queues.compareDocumentPosition(tasks) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('the chevron folds a section, and the search text is still there when it opens again', () => {
    mountShell('sections');
    const search = screen.getByRole('textbox', { name: i18n.t('projects:searchAria') }) as HTMLInputElement;
    fireEvent.change(search, { target: { value: 'skein' } });
    const chevron = screen.getByRole('button', { name: i18n.t('shell:nav.projects') });
    expect(chevron.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(chevron);
    expect(chevron.getAttribute('aria-expanded')).toBe('false');
    expect(JSON.parse(window.localStorage.getItem('skein.layout.nav.sections')!).collapsed.projects).toBe(true);
    fireEvent.click(chevron);
    expect(chevron.getAttribute('aria-expanded')).toBe('true');
    expect(
      (screen.getByRole('textbox', { name: i18n.t('projects:searchAria') }) as HTMLInputElement).value,
    ).toBe('skein');
  });

  it('the queue running dry folds the Queues section, not the column', () => {
    const shell = mountShell('sections');
    inboxItems = [];
    shell.rerender();
    const sections = JSON.parse(window.localStorage.getItem('skein.layout.nav.sections')!);
    expect(sections.collapsed.queues).toBe(true);
    expect(window.localStorage.getItem('skein.layout.nav.collapsed')).not.toBe('true');
    expect(window.localStorage.getItem('skein.layout.inbox-collapsed')).not.toBe('true');
  });
});

describe('F12 (3) — on a board, opening the sliver by hand', () => {
  it('writes the sections opt-out and leaves kanban-workspace alone', () => {
    window.localStorage.setItem('skein.tasks.view', 'kanban');
    window.localStorage.setItem('skein.layout.nav.collapsed', 'true');
    window.localStorage.setItem('skein.layout.nav.workspace', JSON.stringify({ auto: true, optOut: false }));
    const kanbanWorkspace = window.localStorage.getItem('skein.layout.kanban-workspace');
    const shell = mountShell('sections');
    fireEvent.click(shell.container.querySelector<HTMLElement>('.nav-strip')!);
    expect(navWorkspace()).toEqual({ auto: false, optOut: true });
    expect(window.localStorage.getItem('skein.layout.nav.collapsed')).toBe('false');
    expect(window.localStorage.getItem('skein.layout.kanban-workspace')).toBe(kanbanWorkspace);
  });
});

describe('F12 (4) — P13 end to end: the switch versus a late profile', () => {
  it('on a board, the person switching to sections folds the column into its sliver — and touches no side-by-side value', async () => {
    window.localStorage.setItem('skein.tasks.view', 'kanban');
    window.localStorage.setItem('skein.layout.col.inbox', '333');
    window.localStorage.setItem('skein.layout.col.projects', '321');
    window.localStorage.setItem('skein.layout.inbox-collapsed', 'true');
    window.localStorage.setItem('skein.layout.col.projects-collapsed', 'true');
    window.localStorage.setItem(
      'skein.layout.kanban-workspace',
      JSON.stringify({ auto: { inbox: true, projects: false }, optOut: { inbox: false, projects: true } }),
    );
    const shell = mountShell('columns');
    const sideBySide = sideBySideKeys();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('header:accountMenu', { user: 'admin' }) }));
    const group = await screen.findByRole('group', { name: i18n.t('header:navLayout.label') });
    const sections = within(group).getByRole('radio', { name: i18n.t('header:navLayout.sections') });
    await waitFor(() => expect((sections as HTMLInputElement).disabled).toBe(false));
    fireEvent.click(sections);
    await waitFor(() => expect(shell.container.querySelector('.nav-column')).not.toBeNull());
    expect(window.localStorage.getItem('skein.layout.nav.collapsed')).toBe('true');
    expect(navWorkspace().auto).toBe(true);
    expect(putBodies).toEqual([{ navLayout: 'sections' }]);
    expect(sideBySideKeys()).toEqual(sideBySide);
    act(() => heldPuts.forEach((r) => r()));
  });

  it('on a board, the same change arriving as a profile answer does not fold — and touches no side-by-side value', () => {
    window.localStorage.setItem('skein.tasks.view', 'kanban');
    window.localStorage.setItem('skein.layout.col.inbox', '333');
    window.localStorage.setItem('skein.layout.col.projects', '321');
    window.localStorage.setItem('skein.layout.inbox-collapsed', 'true');
    window.localStorage.setItem('skein.layout.col.projects-collapsed', 'true');
    window.localStorage.setItem(
      'skein.layout.kanban-workspace',
      JSON.stringify({ auto: { inbox: true, projects: false }, optOut: { inbox: false, projects: true } }),
    );
    const shell = mountShell('columns');
    const sideBySide = sideBySideKeys();
    shell.profileSays('sections');
    expect(shell.container.querySelector('.nav-column')).not.toBeNull();
    expect(window.localStorage.getItem('skein.layout.nav.collapsed')).not.toBe('true');
    expect(navWorkspace().auto).toBe(false);
    expect(sideBySideKeys()).toEqual(sideBySide);
  });
});

describe('F12 (5) — US-8: a tablet limits the stored width on screen only', () => {
  it('stored 480 for the tablet, a lower live limit: drawn narrower, both width keys untouched', () => {
    setViewportWidth(1000);
    window.localStorage.setItem('skein.layout.nav.width-tablet', '480');
    window.localStorage.setItem('skein.layout.nav.width', '400');
    const original = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('shell-columns')) {
        return { width: 600, height: 800, top: 0, left: 0, right: 600, bottom: 800, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
      }
      return original.call(this);
    });
    const shell = mountShell('sections');
    const column = shell.container.querySelector<HTMLElement>('.nav-column')!;
    // 600 px of row, Tasks keeps its 280 → 320 for the column
    expect(column.style.width).toBe('320px');
    expect(window.localStorage.getItem('skein.layout.nav.width-tablet')).toBe('480');
    expect(window.localStorage.getItem('skein.layout.nav.width')).toBe('400');
  });
});

describe('F12 (6) — the sections hint by its own flag', () => {
  it('the side-by-side flag set, none of its own: the first sections auto-fold notifies once and writes nav.hint-seen only', () => {
    window.localStorage.setItem('skein.layout.board-workspace-hint-seen', 'true');
    mountShell('sections');
    fireEvent.click(viewButton('kanban'));
    expect(toastInfo).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem('skein.layout.nav.hint-seen')).toBe('true');
    expect(window.localStorage.getItem('skein.layout.board-workspace-hint-seen')).toBe('true');

    fireEvent.click(viewButton('cards'));
    fireEvent.click(viewButton('kanban'));
    expect(window.localStorage.getItem('skein.layout.nav.collapsed')).toBe('true');
    expect(toastInfo).toHaveBeenCalledTimes(1);
  });
});

describe('US-11: focus off what a shared file hides', () => {
  it('focus in the Tasks column, a shared file opens: focus lands on "Collapse column" in the Queues header', () => {
    const shell = mountShell('sections');
    const tasksSearch = screen.getByRole('textbox', { name: i18n.t('filters:searchAria') });
    tasksSearch.focus();
    expect(document.activeElement).toBe(tasksSearch);
    shell.go('/?file=att-1');
    const queuesHeader = shell.container.querySelector<HTMLElement>('.nav-section--queues .nav-section-header')!;
    const collapse = within(queuesHeader).getByRole('button', { name: i18n.t('shell:nav.collapseColumn') });
    expect(document.activeElement).toBe(collapse);
  });
});

describe('sections active: the side-by-side record is the fold rules’ alone', () => {
  it('side-by-side folded on the board (marked), sections on, shared file, view → cards, file closed: the side-by-side columns open and lose their marks', () => {
    window.localStorage.setItem('skein.tasks.view', 'kanban');
    window.localStorage.setItem('skein.layout.inbox-collapsed', 'true');
    window.localStorage.setItem('skein.layout.col.projects-collapsed', 'true');
    window.localStorage.setItem(
      'skein.layout.kanban-workspace',
      JSON.stringify({ auto: { inbox: true, projects: true }, optOut: { inbox: false, projects: false } }),
    );
    const shell = mountShell('columns');
    shell.profileSays('sections');
    shell.go('/?file=att-1');
    fireEvent.click(viewButton('cards'));
    // the return waits for the file: the marks must still be there
    expect(JSON.parse(window.localStorage.getItem('skein.layout.kanban-workspace')!).auto).toEqual({
      inbox: true,
      projects: true,
    });
    shell.go('/');
    expect(window.localStorage.getItem('skein.layout.inbox-collapsed')).toBe('false');
    expect(window.localStorage.getItem('skein.layout.col.projects-collapsed')).toBe('false');
    expect(JSON.parse(window.localStorage.getItem('skein.layout.kanban-workspace')!).auto).toEqual({
      inbox: false,
      projects: false,
    });
  });
});

describe('US-15: the bodies’ scroll memory follows the setting', () => {
  const scrollProjects = (top: number) => {
    const body = document.querySelector<HTMLElement>('.projects-body')!;
    body.scrollTop = top;
    fireEvent.scroll(body);
  };

  it('phone, sections arrive late, scroll; back to side-by-side, scroll again; sections, desktop: the position recorded under sections is restored', () => {
    setViewportWidth(500);
    const shell = mountShell('columns');
    shell.profileSays('sections'); // on a phone: no reset, the setting is now on
    scrollProjects(120);
    shell.profileSays('columns'); // the setting off: nothing is recorded
    scrollProjects(300);
    shell.profileSays('sections');
    act(() => setViewportWidth(1440));
    expect(shell.container.querySelector('.nav-column')).not.toBeNull();
    expect(document.querySelector<HTMLElement>('.nav-section--projects .projects-body')!.scrollTop).toBe(120);
  });
});
