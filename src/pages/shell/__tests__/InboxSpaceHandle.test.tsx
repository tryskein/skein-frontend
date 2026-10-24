/**
 * sk-674.18 T054 — the space on the queue cards (spec
 * US-13, SC-014; screens 1.3–1.5).
 *
 * With two spaces or more, a card of Inbox, Mentions and Watching names
 * the SPACE of its issue where the project handle was (`Acme sk-1` — the
 * project is in the id); "Personal" is a person icon whose accessible name
 * is "Personal", without the word on screen. With one space — or none, an
 * external user — the card shows the project handle as before.
 *
 * Driven through the real `InboxColumn` with the real «my spaces» read
 * (`useMySpaces`) over a stubbed `GET /me/spaces`: the number of spaces is
 * the server's answer, as in the tab.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MantineProvider } from '@mantine/core';
import i18n from '../../../i18n/config';
import type { MySpace } from '../../../api/spaces';
import type { NotificationItem, WatchingListResponse } from '../../../api/notifications';
import { InboxColumn } from '../InboxColumn';

const PERSONAL = 'p0aa11bb';
const ACME = 'k3x9p2qa';
const ZETA = 'z9z9z9z9';

let inboxTab: 'inbox' | 'mentions' | 'watching' = 'inbox';
/** The space of the one issue every queue shows; undefined = not served. */
let rowSpace: string | undefined;

vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u-1', username: 'u1', role: 'user' } }),
  useAuthOptional: () => ({ user: { id: 'u-1', username: 'u1', role: 'user' } }),
}));
vi.mock('../../../lib/useLayoutState', () => ({
  useLayoutState: () => ({
    setInboxCollapsed: vi.fn(),
    selectedIssue: null,
    selectInboxIssue: vi.fn(),
    inboxTab,
    setInboxTab: vi.fn(),
    reportQueueFell: vi.fn(),
  }),
}));
vi.mock('../../../lib/useInbox', () => ({
  useInbox: () => ({
    data: {
      items: [
        {
          id: 'sk-1',
          projectId: 'p1',
          ...(rowSpace === undefined ? {} : { spaceId: rowSpace }),
          title: 'Incoming task',
          type: 'task',
          priority: 2,
          status: 'open',
          version: 1,
          createdAt: '2026-10-01T10:00:00Z',
          createdByUsername: 'anna',
        },
      ],
    },
    isSuccess: true,
  }),
}));
vi.mock('../../../lib/useMentions', () => ({
  useMentions: () => ({ data: { items: [mention()] }, isSuccess: true }),
}));
vi.mock('../../../lib/useWatching', () => ({
  useWatching: () => ({ data: watching(), isSuccess: true, isPlaceholderData: false }),
}));
vi.mock('../../../lib/useReasonPrefsProbe', () => ({ useFeedChannelsAllOff: () => null }));
vi.mock('../../../lib/useProjectsList', () => ({
  useProjectsList: () => ({ data: { items: [{ id: 'p1', idPrefix: 'sk' }] } }),
}));
vi.mock('../../../lib/useMarkNotificationsRead', () => ({
  useMarkNotificationsRead: () => ({ mutate: vi.fn() }),
}));
vi.mock('../../../lib/useMarkWatchingCardRead', () => ({
  useMarkWatchingCardRead: () => ({ mutate: vi.fn() }),
}));
vi.mock('../../../lib/useUnwatch', () => ({ useUnwatch: () => ({ mutate: vi.fn() }) }));
vi.mock('../../../lib/useBulkUnwatch', () => ({
  useBulkUnwatch: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../../../lib/useReminders', () => ({ useRingingIssueIds: () => new Set() }));

function mention(): NotificationItem {
  return {
    id: 7,
    type: 'comment.mention',
    ...(rowSpace === undefined ? {} : { spaceId: rowSpace }),
    createdAt: '2026-10-01T10:00:00Z',
    readAt: null,
    archivedAt: null,
    actor: { username: 'alice', userId: 'u2', type: 'human' },
    entity: { type: 'issue', id: 'sk-1', title: 'Incoming task', projectId: 'p1', projectIdPrefix: 'sk' },
    summary: 'alice mentioned you',
    field: 'description',
    oldValue: null,
    newValue: null,
  } as NotificationItem;
}

function watching(): WatchingListResponse {
  return {
    items: [
      {
        item: { id: 'sk-1', title: 'Incoming task', projectId: 'p1' } as never,
        ...(rowSpace === undefined ? {} : { spaceId: rowSpace }),
        reasons: ['creator'],
        unreadEventsCount: 0,
        recentEvents: [],
        since: '2026-01-01T00:00:00Z',
      },
    ],
    unreadTotal: 0,
    subscriptionsTotal: 1,
    truncated: false,
    state: 'open',
    stateTotal: 1,
    openTotal: 1,
    closedTotal: 0,
    closedAutoTotal: 0,
  };
}

function space(id: string, name: string, kind: MySpace['kind']): MySpace {
  return {
    id, slug: name.toLowerCase(), name, kind, myRole: 'member', adminAccess: false,
    canCreateProject: true, memberCount: 2, memberLimit: null, pendingInvitations: 0,
    projectCount: 1, projectQuota: null, storageUsedBytes: 0, storageQuotaBytes: null,
  };
}

const THREE = [space(PERSONAL, 'Личное', 'personal'), space(ACME, 'Acme', 'common'), space(ZETA, 'Zeta', 'regular')];
/** GET /me/spaces answers these. */
let mySpaces: MySpace[];

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

async function mount(): Promise<void> {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MantineProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <InboxColumn collapsed={false} width={320} />
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
  // «My spaces» answered — then the subscribers are told on the next task
  // (TanStack's notify scheduler is `setTimeout(cb, 0)`), FIFO behind it.
  await vi.waitFor(() => expect(qc.getQueryState(['me', 'spaces', 'u-1'])?.status).toBe('success'));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

beforeEach(async () => {
  await i18n.changeLanguage('ru');
  rowSpace = ACME;
  mySpaces = THREE;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/v1/me/spaces')) {
        return json({ items: mySpaces, ownedCount: 0, ownedLimit: null, canCreate: true, cannotCreateReason: null });
      }
      return json({ items: [] });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const TABS = ['inbox', 'mentions', 'watching'] as const;

describe('row 242 — the space instead of the project handle, with two spaces or more', () => {
  test.each(TABS)('%s: a card of a common space names the space, not the handle', async (tab) => {
    inboxTab = tab;
    await mount();
    await vi.waitFor(() => expect(screen.getByText('Acme')).toBeTruthy());
    expect(screen.queryByText('sk')).toBeNull();
  });

  test.each(TABS)('%s: a card of "Personal" is an icon named "Personal", without the word', async (tab) => {
    inboxTab = tab;
    rowSpace = PERSONAL;
    await mount();
    const icon = await screen.findByRole('img', { name: i18n.t('inbox:space.personal') });
    expect(icon.textContent).toBe('');
    expect(screen.queryByText(i18n.t('inbox:space.personal'))).toBeNull();
    expect(screen.queryByText('sk')).toBeNull();
  });

  test.each(TABS)('%s: a row without its space keeps the project handle', async (tab) => {
    inboxTab = tab;
    rowSpace = undefined;
    await mount();
    expect(screen.getByText('sk')).toBeTruthy();
    expect(screen.queryByText('Acme')).toBeNull();
  });
});

describe('row 242 — one space, or none: as before', () => {
  test.each(
    TABS.flatMap((tab) => [
      [tab, 'one space', [space(ACME, 'Acme', 'personal')]],
      [tab, 'an external user, no spaces', []],
    ] as const),
  )('%s, %s: the project handle, no space', async (tab, _case, spaces) => {
    inboxTab = tab;
    mySpaces = [...spaces];
    await mount();
    expect(screen.getByText('sk')).toBeTruthy();
    expect(screen.queryByText('Acme')).toBeNull();
    expect(screen.queryByRole('img', { name: i18n.t('inbox:space.personal') })).toBeNull();
  });
});
