/**
 * Watching an issue from its card: the header's Watch toggle
 * (`IssueDetailPanel#watchMut`) and the Watchers section's own control
 * (`WatchersSection#onToggleSelf`). Either one subscribes or unsubscribes the
 * caller; the header toggle's state, the section's count and the watcher list
 * follow, and the list is read again from the server afterwards. A refusal
 * leaves everything as it was and says why.
 *
 * The stand: the real panel with the real Watchers section and the real
 * `useIssueDetail`; the watchers endpoints are a stateful stub that answers
 * like the server, the rest of the card's wire is quiet (as in
 * `closeOutcomeSeam.test.tsx`).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { WatcherEntry } from '../../../api/watchers';

const PID = 'proj-uuid-watch';
const ID = 'sk-78';

const server = vi.hoisted(() => ({
  watchers: [] as WatcherEntry[],
  refuse: null as string | null,
  listReads: 0,
  /** Held answers: a write or a list read waits here until the test opens it. */
  writeGate: null as Promise<void> | null,
  readGate: null as Promise<void> | null,
  watch: vi.fn(),
  unwatch: vi.fn(),
}));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));

vi.mock('../../../api/issues', async (importActual) => {
  const actual = await importActual<typeof import('../../../api/issues')>();
  return {
    ...actual,
    getIssue: () => Promise.resolve(fixture()),
    listComments: () => Promise.resolve([]),
  };
});
vi.mock('../../../api/activity', () => ({
  listIssueActivity: () => Promise.resolve({ items: [], nextCursor: null }),
}));
vi.mock('../../../api/attachments', () => ({
  listAttachments: () => Promise.resolve({ items: [] }),
}));
vi.mock('../../../api/dependencies', () => ({
  listDependencies: () => Promise.resolve({ outgoing: [], incoming: [] }),
}));
vi.mock('../../../api/watchers', async (importActual) => {
  const actual = await importActual<typeof import('../../../api/watchers')>();
  const me: WatcherEntry = { userId: 'u-1', username: 'carol', name: 'Carol', reasons: ['manual'], since: '2026-11-23T10:00:00Z' };
  return {
    ...actual,
    listIssueWatchers: async () => {
      server.listReads += 1;
      await server.readGate;
      return server.watchers.map((w) => ({ ...w, reasons: [...w.reasons] }));
    },
    watchIssue: async (iid: string) => {
      server.watch(iid);
      await server.writeGate;
      if (server.refuse) throw new Error(server.refuse);
      server.watchers = [...server.watchers.filter((w) => w.userId !== me.userId), me];
    },
    unwatchIssue: async (iid: string) => {
      server.unwatch(iid);
      await server.writeGate;
      if (server.refuse) throw new Error(server.refuse);
      server.watchers = server.watchers.filter((w) => w.userId !== me.userId);
    },
  };
});

vi.mock('./sections/ActivitySection', () => ({ ActivitySection: () => null }));
vi.mock('./sections/AttachmentsSection', () => ({ AttachmentsSection: () => null }));
vi.mock('./sections/CommentsSection', () => ({ CommentsSection: () => null }));
vi.mock('./sections/CommitsSection', () => ({ CommitsSection: () => null }));
vi.mock('./sections/DependenciesSection', () => ({ DependenciesSection: () => null }));
vi.mock('./sections/EpicProgressSection', () => ({ EpicProgressSection: () => null }));
vi.mock('./sections/IssuePropertiesRow', () => ({ IssuePropertiesRow: () => null }));
vi.mock('./sections/BlockedBySection', () => ({ BlockedBySection: () => null }));
vi.mock('./sections/RemindersSection', () => ({ RemindersSection: () => null }));
vi.mock('./PeopleChain', () => ({ PeopleChain: () => null }));

vi.mock('../../../lib/useProjectByHandle', () => ({
  useProjectByHandle: () => ({
    project: { id: PID, idPrefix: 'sk', name: 'watch' },
    isLoading: false,
    isUnresolved: false,
  }),
}));
vi.mock('../../../lib/useReminders', () => ({ useIssueReminders: () => [] }));
vi.mock('../../../components/Toaster', () => ({ useToaster: () => toast }));
vi.mock('../../../auth/AuthContext', async (importActual) => {
  const actual = await importActual<typeof import('../../../auth/AuthContext')>();
  return {
    ...actual,
    useAuth: () => ({
      user: { id: 'u-1', username: 'carol', email: 'c@example.com', name: 'Carol', role: 'user' },
      isLoading: false,
      login: vi.fn(),
      logout: vi.fn(),
    }),
  };
});

import i18n from '../../../i18n/config';
import { LayoutProvider } from '../../../lib/useLayoutState';
import { IssueDetailPanel } from './IssueDetailPanel';

function fixture(): Record<string, unknown> {
  return {
    id: ID, projectId: PID, version: 3, title: 'watch fixture', description: '', acceptanceCriteria: '',
    notes: '', design: '', type: 'task', priority: 2, status: 'in_progress', pinned: false, source: 'human',
    createdBy: 'u-9', createdByUsername: 'dave', createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z', metadata: {}, componentIds: [], labels: [], commentsCount: 0,
    commitRefs: [], mentions: [], isBlocked: false, blockers: [], assignee: 'dave',
    previousAssignees: [], dismissedBy: [],
  };
}

const DAVE: WatcherEntry = { userId: 'u-9', username: 'dave', name: 'Dave', reasons: ['assignee'], since: '2026-11-01T00:00:00Z' };

function mountPanel() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <MantineProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <LayoutProvider>
            <IssueDetailPanel issueId={ID} projectHandle="sk" />
          </LayoutProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

const d = (key: string) => i18n.t(`details:${key}`) as string;
/** The header toggle, whichever state it is in. */
const headerToggle = () =>
  screen.getByRole('button', { name: new RegExp(`^(${d('header.watch')}|${d('header.watching')})$`) });
const watchersSection = () =>
  screen.getByRole('heading', { name: new RegExp(`^${d('sectionsMore.watchers')}`) }).closest('section') as HTMLElement;
const sectionCount = () => watchersSection().querySelector('.detail-section-count')?.textContent ?? '0';
const watcherNames = () =>
  [...watchersSection().querySelectorAll('.watcher-name')].map((n) => (n.textContent ?? '').trim().replace(/^@/, ''));

beforeEach(() => {
  server.watchers = [DAVE];
  server.refuse = null;
  server.listReads = 0;
  server.writeGate = null;
  server.readGate = null;
  server.watch.mockClear();
  server.unwatch.mockClear();
  toast.error.mockClear();
});

afterEach(() => cleanup());

async function loaded() {
  mountPanel();
  await waitFor(() => expect(watcherNames()).toEqual(['dave']));
}

describe('watching the issue from its card', () => {
  test('the header toggle subscribes and unsubscribes; toggle, count and list follow', async () => {
    const user = userEvent.setup();
    await loaded();
    expect(headerToggle().getAttribute('aria-pressed')).toBe('false');

    let reads = server.listReads;
    await user.click(headerToggle());
    await waitFor(() => expect(headerToggle().getAttribute('aria-pressed')).toBe('true'));
    expect(server.watch).toHaveBeenCalledWith(ID);
    await waitFor(() => expect(server.listReads).toBeGreaterThan(reads));
    await waitFor(() => expect(watcherNames()).toEqual(['dave', 'carol']));
    expect(sectionCount()).toBe('2');

    reads = server.listReads;
    await user.click(headerToggle());
    await waitFor(() => expect(headerToggle().getAttribute('aria-pressed')).toBe('false'));
    expect(server.unwatch).toHaveBeenCalledWith(ID);
    await waitFor(() => expect(server.listReads).toBeGreaterThan(reads));
    await waitFor(() => expect(watcherNames()).toEqual(['dave']));
    expect(sectionCount()).toBe('1');
  });

  test('the Watchers section subscribes and unsubscribes; toggle, count and list follow', async () => {
    const user = userEvent.setup();
    await loaded();

    await user.click(within(watchersSection()).getByRole('button', { name: d('watchers.add') }));
    await waitFor(() => expect(watcherNames()).toEqual(['dave', 'carol']));
    expect(server.watch).toHaveBeenCalledWith(ID);
    expect(sectionCount()).toBe('2');
    expect(headerToggle().getAttribute('aria-pressed')).toBe('true');

    await user.click(within(watchersSection()).getByRole('button', { name: d('watchers.stopWatching') }));
    await waitFor(() => expect(watcherNames()).toEqual(['dave']));
    expect(server.unwatch).toHaveBeenCalledWith(ID);
    expect(sectionCount()).toBe('1');
    expect(headerToggle().getAttribute('aria-pressed')).toBe('false');
  });

  test('a refused subscribe from the header leaves everything as it was and says why', async () => {
    const user = userEvent.setup();
    await loaded();
    server.refuse = 'watching is not allowed here';

    await user.click(headerToggle());

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('watching is not allowed here'));
    await waitFor(() => expect(headerToggle().getAttribute('aria-pressed')).toBe('false'));
    expect(watcherNames()).toEqual(['dave']);
    expect(sectionCount()).toBe('1');
  });

  test('a refused subscribe from the section leaves the list as it was and says why', async () => {
    const user = userEvent.setup();
    await loaded();
    server.refuse = 'watching is not allowed here';

    await user.click(within(watchersSection()).getByRole('button', { name: d('watchers.add') }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('watching is not allowed here'));
    expect(server.watch).toHaveBeenCalledWith(ID);
    expect(watcherNames()).toEqual(['dave']);
    expect(headerToggle().getAttribute('aria-pressed')).toBe('false');
    await waitFor(() =>
      expect(
        (within(watchersSection()).getByRole('button', { name: d('watchers.add') }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
  });
  function hold(slot: 'writeGate' | 'readGate') {
    let open: () => void = () => {};
    server[slot] = new Promise<void>((resolve) => { open = resolve; });
    return () => { server[slot] = null; open(); };
  }

  test('the subscription shows on the card before the server answers', async () => {
    const user = userEvent.setup();
    await loaded();
    const release = hold('writeGate');

    await user.click(headerToggle());

    await waitFor(() => expect(watcherNames()).toEqual(['dave', 'carol']));
    expect(headerToggle().getAttribute('aria-pressed')).toBe('true');
    expect(server.watchers.map((w) => w.username)).toEqual(['dave']);
    release();
  });

  test('the unsubscription shows on the card before the server answers', async () => {
    server.watchers = [DAVE, { userId: 'u-1', username: 'carol', name: 'Carol', reasons: ['manual'], since: '2026-11-20T00:00:00Z' }];
    const user = userEvent.setup();
    mountPanel();
    await waitFor(() => expect(watcherNames()).toEqual(['dave', 'carol']));
    const release = hold('writeGate');

    await user.click(headerToggle());

    await waitFor(() => expect(watcherNames()).toEqual(['dave']));
    expect(headerToggle().getAttribute('aria-pressed')).toBe('false');
    release();
  });

  test('watching again after an explicit unwatch shows the caller back before the server answers', async () => {
    // The server keeps an unwatched entry with its other reasons: carol is
    // the assignee but said «stop watching».
    server.watchers = [DAVE, { userId: 'u-1', username: 'carol', name: 'Carol', reasons: ['assignee', 'unwatched'], since: '2026-11-20T00:00:00Z' }];
    const user = userEvent.setup();
    mountPanel();
    await waitFor(() => expect(watcherNames()).toEqual(['dave']));
    expect(headerToggle().getAttribute('aria-pressed')).toBe('false');
    const release = hold('writeGate');

    await user.click(headerToggle());

    await waitFor(() => expect(watcherNames()).toEqual(['dave', 'carol']));
    expect(headerToggle().getAttribute('aria-pressed')).toBe('true');
    release();
  });

  test('a refused subscribe takes the caller off the list before the list is read again', async () => {
    const user = userEvent.setup();
    await loaded();
    server.refuse = 'watching is not allowed here';
    const releaseRead = hold('readGate');

    await user.click(headerToggle());

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('watching is not allowed here'));
    // The re-read the refusal starts is held: this is the card's own rollback.
    await waitFor(() => expect(watcherNames()).toEqual(['dave']));
    expect(headerToggle().getAttribute('aria-pressed')).toBe('false');
    releaseRead();
  });
  test('in the section, an explicitly unwatched caller is offered «Watch», not «Stop watching»', async () => {
    server.watchers = [DAVE, { userId: 'u-1', username: 'carol', name: 'Carol', reasons: ['assignee', 'unwatched'], since: '2026-11-20T00:00:00Z' }];
    mountPanel();
    await waitFor(() => expect(watcherNames()).toEqual(['dave']));

    expect(within(watchersSection()).getByRole('button', { name: d('watchers.add') })).toBeTruthy();
    expect(within(watchersSection()).queryByRole('button', { name: d('watchers.stopWatching') })).toBeNull();
  });

  test('the section control is off while its request is in flight', async () => {
    const user = userEvent.setup();
    await loaded();
    const release = hold('writeGate');

    const add = within(watchersSection()).getByRole('button', { name: d('watchers.add') }) as HTMLButtonElement;
    await user.click(add);

    await waitFor(() => expect(add.disabled).toBe(true));
    expect(server.watch).toHaveBeenCalledTimes(1);
    release();
  });
});
