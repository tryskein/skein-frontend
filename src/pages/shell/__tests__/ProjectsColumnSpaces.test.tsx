/**
 * sk-674.18 T051 — space rows of the Projects column (spec US-3, SC-014, E-16; screens 1.1, 1.2).
 *
 *   234 — with one space (and with none — an external user) neither the
 *         Projects column nor the header carries a single element of a
 *         space: no space row, no fold caret of a space, no ⚙ of a space,
 *         no empty-space hint. Found by role and accessible name.
 *   235 — with three spaces and more: rows in the order "Personal" → common
 *         → the rest by name; an empty "Personal" starts folded; a fold is
 *         remembered only when chosen by hand (a search opens a folded
 *         space with matches and writes nothing); an empty space has its
 *         hint; "Projects are created by your agent" (K2) with no project and no
 *         API key.
 *
 * The real Shell, HeaderBar and layout provider in one router; «my spaces»
 * and the account come through the real hooks over a stubbed `fetch`. The
 * project list is stubbed at its hook, as in `HeaderBar.navSections.test`.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '../../../i18n/config';
import type { ProjectListItem } from '../../../api/projects';
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

let projects: ProjectListItem[] = [];
vi.mock('../../../lib/useProjectsList', () => ({
  projectsListQueryKey: ['projects', 'list', 'shell'] as const,
  useProjectsList: () => ({
    data: { items: projects, total: projects.length, hasMore: false, nextCursor: null },
    isLoading: false,
    isError: false,
    isSuccess: true,
    error: null,
  }),
  // The column's search goes to the server; the stub answers every query
  // with the same rows, which is what a search matching them all returns.
  useProjectsInfinite: () => ({
    items: projects,
    total: projects.length,
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
import { myAccountQueryKey } from '../../../lib/useMyAccount';

const FOLD_KEY = 'skein.layout.space-tree.fold';

const space = (
  id: string,
  name: string,
  kind: MySpace['kind'],
  projectCount: number,
): MySpace => ({
  id,
  slug: name.toLowerCase(),
  name,
  kind,
  myRole: kind === 'personal' ? 'owner' : 'member',
  adminAccess: false,
  canCreateProject: true,
  memberCount: 1,
  memberLimit: null,
  pendingInvitations: 0,
  projectCount,
  projectQuota: null,
  storageUsedBytes: 0,
  storageQuotaBytes: null,
});

const project = (id: string, name: string, spaceId: string): ProjectListItem => ({
  id,
  name,
  idPrefix: id,
  defaultIdMode: 'counter',
  description: '',
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  openCount: 1,
  inProgressCount: 0,
  blockedCount: 0,
  myOutboxOpenCount: 0,
  myOutboxInProgressCount: 0,
  myOutboxBlockedCount: 0,
  componentsCount: 0,
  spaceId,
});

/** What the stubbed server answers: «my spaces» and the account. */
let mySpaces: MySpace[] = [];
let hasApiKeys: boolean | undefined = true;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  window.localStorage.clear();
  projects = [];
  mySpaces = [];
  hasApiKeys = true;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.startsWith('/api/v1/me/spaces')) {
        return json({
          items: mySpaces,
          ownedCount: 0,
          ownedLimit: null,
          canCreate: true,
          cannotCreateReason: null,
        });
      }
      if (url.startsWith('/api/v1/auth/me')) {
        return json({
          id: 'u-1',
          email: 'u1@test.com',
          username: 'u1',
          name: 'U1',
          role: 'user',
          isExternal: false,
          createdAt: '2026-10-01T00:00:00Z',
          lastLoginAt: null,
          ...(hasApiKeys === undefined ? {} : { hasApiKeys }),
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

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(uiPrefsKey('u-1'), { issueModalViews: [], density: 'normal', navLayout: 'columns' });
  const view = render(
    <MantineProvider forceColorScheme="dark">
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/" element={<Shell />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
  return { ...view, qc };
}

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(`projects:${key}`, opts);

/** The space rows, in DOM order, by their accessible name. */
function spaceRowNames(): string[] {
  return screen
    .queryAllByRole('button', { name: /^Select space / })
    .map((b) => b.getAttribute('aria-label')!.replace('Select space ', ''));
}

/** Waits until «my spaces» has answered and the column drew from it. */
async function settled() {
  await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/v1/me/spaces', expect.anything()));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: t('select', { name: projects[0]?.name ?? '' }) })).toBeTruthy(),
  );
}

describe('row 234 — one space, or none: no element of a space in the column or the header', () => {
  test.each([
    ['one space («Личное»)', [space('p0aa11bb', 'Личное', 'personal', 1)]],
    ['an external user — no space at all', []],
  ])('%s', async (_label, spaces) => {
    mySpaces = spaces;
    projects = [project('home', 'Home', 'p0aa11bb')];
    mount();
    await settled();
    // Positive control: the column and the header are there.
    expect(screen.getByRole('button', { name: t('selectAll') })).toBeTruthy();
    expect(screen.getByRole('banner')).toBeTruthy();

    expect(screen.queryAllByRole('button', { name: /^Select space / })).toEqual([]);
    expect(screen.queryAllByRole('button', { name: /^(Expand|Collapse) space / })).toEqual([]);
    expect(screen.queryAllByRole('link', { name: /^Settings for space / })).toEqual([]);
    expect(screen.queryByText(t('spaceEmpty'))).toBeNull();
    expect(screen.queryByText(t('spaceEmptyAskAgent'))).toBeNull();
  });
});

describe('row 235 — three spaces and more', () => {
  beforeEach(() => {
    mySpaces = [
      space('p0aa11bb', 'Личное', 'personal', 0),
      space('c0mm0n00', 'Общее', 'common', 1),
      space('k3x9p2qa', 'Acme', 'regular', 1),
      space('z9z9z9z9', 'Zeta', 'regular', 0),
    ];
    projects = [project('web', 'Website', 'c0mm0n00'), project('api', 'Backend', 'k3x9p2qa')];
  });

  test('rows in the order "Personal" → common → the rest by name, each project under its space', async () => {
    mount();
    await settled();
    expect(spaceRowNames()).toEqual(['Личное', 'Общее', 'Acme', 'Zeta']);
    const order = screen
      .getAllByRole('button', { name: /^Select (space|project) / })
      .map((b) => b.getAttribute('aria-label'));
    expect(order).toEqual([
      'Select space Личное',
      'Select space Общее',
      t('select', { name: 'Website' }),
      'Select space Acme',
      t('select', { name: 'Backend' }),
      'Select space Zeta',
    ]);
    // "Personal" has no ⚙; the others do.
    expect(screen.queryByRole('link', { name: 'Settings for space Личное' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Settings for space Acme' })).toBeTruthy();
  });

  test('an empty "Personal" starts folded, the rest open; an empty open space shows its hint', async () => {
    mount();
    await settled();
    expect(screen.getByRole('button', { name: 'Expand space Личное' }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByRole('button', { name: 'Collapse space Zeta' }).getAttribute('aria-expanded')).toBe('true');
    // One hint — Zeta's; the folded empty "Personal" shows none.
    expect(screen.getAllByText(t('spaceEmpty'))).toHaveLength(1);
    const zeta = screen.getByRole('button', { name: 'Select space Zeta' }).closest('.space-tree-node')!;
    expect(within(zeta as HTMLElement).getByText(t('spaceEmptyAskAgent'))).toBeTruthy();
    // Nothing was chosen by hand, so nothing is stored.
    expect(window.localStorage.getItem(FOLD_KEY) ?? '{}').toBe('{}');
  });

  test('a fold chosen by hand survives a reload; an untouched default follows the data', async () => {
    const view = mount();
    await settled();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse space Acme' }));
    expect(screen.queryByRole('button', { name: t('select', { name: 'Backend' }) })).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(FOLD_KEY)!)).toEqual({ k3x9p2qa: 'collapsed' });
    view.unmount();

    // "Personal" got its first project meanwhile; nobody folded it by hand.
    mySpaces = mySpaces.map((s) => (s.kind === 'personal' ? { ...s, projectCount: 1 } : s));
    projects = [project('home', 'Home', 'p0aa11bb'), ...projects];
    mount();
    await settled();
    expect(screen.getByRole('button', { name: 'Expand space Acme' }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByRole('button', { name: 'Collapse space Личное' }).getAttribute('aria-expanded')).toBe('true');
  });

  test('a search opens a folded space with matches and writes nothing; clearing it restores the fold', async () => {
    window.localStorage.setItem(FOLD_KEY, JSON.stringify({ k3x9p2qa: 'collapsed' }));
    mount();
    await settled();
    expect(screen.queryByRole('button', { name: t('select', { name: 'Backend' }) })).toBeNull();

    fireEvent.change(screen.getByRole('textbox', { name: t('searchAria') }), {
      target: { value: 'back' },
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: t('select', { name: 'Backend' }) })).toBeTruthy(),
    );
    expect(JSON.parse(window.localStorage.getItem(FOLD_KEY)!)).toEqual({ k3x9p2qa: 'collapsed' });

    fireEvent.change(screen.getByRole('textbox', { name: t('searchAria') }), { target: { value: '' } });
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: t('select', { name: 'Backend' }) })).toBeNull(),
    );
  });

  test.each([
    ['no project and no API key — the line is shown', false, true],
    ['an API key — no line', true, false],
    ['the flag not served yet — no line', undefined, false],
  ])('K2 "Projects are created by your agent": %s', async (_label, keys, shown) => {
    projects = [];
    mySpaces = mySpaces.map((s) => ({ ...s, projectCount: 0 }));
    hasApiKeys = keys;
    const { qc } = mount();
    await waitFor(() => expect(spaceRowNames()).toHaveLength(4));
    // The account answer has landed in the cache…
    await waitFor(() => expect(qc.getQueryState(myAccountQueryKey('u-1'))?.status).toBe('success'));
    // …and its subscribers have been told: TanStack hands the change to
    // them in a zero-delay task queued when the answer landed, so a task
    // queued after it runs after it (FIFO), whatever the machine's speed.
    await act(() => new Promise<void>((r) => setTimeout(r, 0)));
    if (shown) {
      const line = await screen.findByRole('link', { name: t('agentCreatesProjects') });
      expect(line.getAttribute('href')).toBe('/settings/api-keys');
      // Under «All projects», above the space rows.
      const all = screen.getByRole('button', { name: t('selectAll') });
      const firstSpace = screen.getByRole('button', { name: 'Select space Личное' });
      expect(all.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(line.compareDocumentPosition(firstSpace) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    } else {
      expect(screen.queryByRole('link', { name: t('agentCreatesProjects') })).toBeNull();
    }
  });
});

describe('sk-734 — a space that joins the list is brought to the top of the column', () => {
  /** Accessible names of the space rows `scrollIntoView` was called on. */
  let scrolled: string[];
  beforeEach(() => {
    scrolled = [];
    HTMLElement.prototype.scrollIntoView = vi.fn(function (this: HTMLElement) {
      const row = this.querySelector('button[aria-label^="Select space "]');
      scrolled.push(row?.getAttribute('aria-label') ?? '');
    });
    mySpaces = [
      space('p0aa11bb', 'Личное', 'personal', 1),
      space('c0mm0n00', 'Общее', 'common', 1),
    ];
    projects = [project('home', 'Home', 'p0aa11bb'), project('web', 'Website', 'c0mm0n00')];
  });
  afterEach(() => {
    delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
  });

  /** «my spaces» answers again — as on the personal signal after an accept. */
  async function joins(view: ReturnType<typeof mount>, joined: MySpace) {
    mySpaces = [...mySpaces, joined];
    projects = [...projects, project('hack', 'Hackathon', joined.id)];
    await act(async () => {
      await view.qc.invalidateQueries({ queryKey: ['me', 'spaces'] });
    });
    await waitFor(() => expect(spaceRowNames()).toContain(joined.name));
  }

  test('the first answer is a baseline: nothing scrolls', async () => {
    mount();
    await settled();
    expect(spaceRowNames()).toEqual(['Личное', 'Общее']);
    expect(scrolled).toEqual([]);
  });

  test('the joined space is scrolled to, once, to the top of the column', async () => {
    const view = mount();
    await settled();
    await joins(view, space('h4ck2026', 'Hackathon', 'regular', 1));
    await waitFor(() => expect(scrolled).toEqual(['Select space Hackathon']));
    expect(vi.mocked(HTMLElement.prototype.scrollIntoView).mock.calls[0][0]).toMatchObject({ block: 'start' });
    // A later answer with nothing new scrolls nothing.
    await act(async () => {
      await view.qc.invalidateQueries({ queryKey: ['me', 'spaces'] });
    });
    expect(scrolled).toEqual(['Select space Hackathon']);
  });

  test('a space folded by hand before (left and joined again) opens on arrival', async () => {
    window.localStorage.setItem(FOLD_KEY, JSON.stringify({ h4ck2026: 'collapsed' }));
    const view = mount();
    await settled();
    await joins(view, space('h4ck2026', 'Hackathon', 'regular', 1));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Collapse space Hackathon' }).getAttribute('aria-expanded')).toBe('true'),
    );
    expect(screen.getByRole('button', { name: t('select', { name: 'Hackathon' }) })).toBeTruthy();
  });

  test('a space that leaves the list scrolls nothing', async () => {
    mySpaces = [...mySpaces, space('k3x9p2qa', 'Acme', 'regular', 0)];
    const view = mount();
    await settled();
    mySpaces = mySpaces.filter((s) => s.id !== 'k3x9p2qa');
    await act(async () => {
      await view.qc.invalidateQueries({ queryKey: ['me', 'spaces'] });
    });
    await waitFor(() => expect(spaceRowNames()).toEqual(['Личное', 'Общее']));
    expect(scrolled).toEqual([]);
  });
});
