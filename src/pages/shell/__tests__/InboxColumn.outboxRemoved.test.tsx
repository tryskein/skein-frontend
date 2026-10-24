/**
 * sk-303.13 (T025/T026, test matrix row 39) — the left column after the
 * Outbox surface: three tabs, and the two feeds that stayed still work.
 *
 * Two halves, and the second is the one worth having. Asserting that a
 * tab is missing is cheap; the removal's real risk was collateral — the
 * mark-read mutations used to patch THREE caches in one pass, and taking
 * the middle one out is the kind of edit that quietly drops a sibling.
 * So the Mentions and Watching click paths are exercised end to end
 * here, not just the absence of a button.
 *
 * The state layer of row 39 (stored tab, `?tab=`, the untouched
 * My-assigned lens, the counts DTO) lives in
 * `lib/__tests__/outboxSurfaceRemoved.test.tsx`.
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MantineProvider } from '@mantine/core';
import type { InboxTab } from '../../../lib/shellUrlState';
import type { NotificationItem, WatchingListResponse } from '../../../api/notifications';

const markReadMutate = vi.fn();
const markCardReadMutate = vi.fn();
const unwatchMutate = vi.fn();
const selectInboxIssue = vi.fn();
let tab: InboxTab = 'mentions';

const MENTION: NotificationItem = {
  id: 7,
  type: 'comment.mention',
  createdAt: '2026-08-30T10:00:00Z',
  readAt: null,
  archivedAt: null,
  actor: { username: 'alice', userId: 'u1', type: 'human' },
  entity: { type: 'issue', id: 'sk-1', title: 'Mentioned here', projectId: 'p1', projectIdPrefix: 'sk' },
  summary: 'alice mentioned you',
  field: 'description',
  oldValue: null,
  newValue: null,
  mentionContext: '…@me…',
};

const WATCHING: WatchingListResponse = {
  items: [
    {
      item: { id: 'sk-9', title: 'Watched', projectId: 'p1' } as never,
      reasons: ['creator'],
      unreadEventsCount: 2,
      recentEvents: [],
      since: '2026-01-01T00:00:00Z',
    },
  ],
  unreadTotal: 2,
  subscriptionsTotal: 1,
  truncated: false,
  state: 'open',
  stateTotal: 1,
  openTotal: 1,
  closedTotal: 0,
  closedAutoTotal: 0,
};

const bulkUnwatchMutate = vi.fn();
vi.mock('../../../lib/useLayoutState', () => ({
  useLayoutState: () => ({
    setInboxCollapsed: vi.fn(),
    selectedIssue: null,
    selectInboxIssue,
    inboxTab: tab,
    setInboxTab: vi.fn(),
  }),
}));
vi.mock('../../../lib/useInbox', () => ({
  useInbox: () => ({ data: { items: [] }, isSuccess: true }),
}));
// sk-674.18 T054 — the invitation cards and «my spaces» of the column:
// none here, one space (the cards keep their project handles).
vi.mock('../../../lib/useMyInvitations', () => ({
  useMyInvitations: () => ({ data: { items: [] }, isSuccess: true }),
}));
vi.mock('../../../lib/useMySpaces', () => ({
  useMySpaces: () => ({ data: undefined }),
}));
vi.mock('../../../lib/useMentions', () => ({
  useMentions: () => ({ data: { items: [MENTION] }, isSuccess: true }),
}));
vi.mock('../../../lib/useWatching', () => ({
  useWatching: () => ({ data: WATCHING, isSuccess: true }),
}));
vi.mock('../../../lib/useReasonPrefsProbe', () => ({ useFeedChannelsAllOff: () => null }));
vi.mock('../../../lib/useProjectsList', () => ({
  useProjectsList: () => ({ data: { items: [{ id: 'p1', idPrefix: 'sk' }] } }),
}));
vi.mock('../../../lib/useMarkNotificationsRead', () => ({
  useMarkNotificationsRead: () => ({ mutate: markReadMutate }),
}));
// sk-622.21 (US-7) — the Watching card's click is «read card X» now.
vi.mock('../../../lib/useMarkWatchingCardRead', () => ({
  useMarkWatchingCardRead: () => ({ mutate: markCardReadMutate }),
}));
vi.mock('../../../lib/useUnwatch', () => ({ useUnwatch: () => ({ mutate: unwatchMutate }) }));
vi.mock('../../../lib/useBulkUnwatch', () => ({
  useBulkUnwatch: () => ({ mutate: bulkUnwatchMutate, isPending: false }),
}));
vi.mock('../../../lib/useReminders', () => ({ useRingingIssueIds: () => new Set() }));

import { InboxColumn } from '../InboxColumn';

function mount(collapsed = false) {
  // sk-285.7 (T027) — the column's queue selector is a Mantine
  // `<Select>` now, so the provider is required to render it.
  return render(
    <MantineProvider>
      <MemoryRouter>
        <InboxColumn collapsed={collapsed} width={340} />
      </MemoryRouter>
    </MantineProvider>,
  );
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  tab = 'mentions';
});

describe('row 39 — the column offers three queues and no fourth', () => {
  // sk-285.7 (T027) replaced the pill tab row with ONE `<Select>`, so
  // the enumeration is read off its options rather than off `role="tab"`.
  // The assertion is unchanged in substance: exactly three queues, and
  // none of them is Outbox.
  test('the picker offers exactly Inbox / Mentions / Watching', () => {
    mount();
    fireEvent.click(screen.getByRole('textbox', { name: 'Queue' }));
    expect(
      screen.getAllByRole('option').map((o) => o.getAttribute('value')),
    ).toEqual(['inbox', 'mentions', 'watching']);
    expect(screen.queryByRole('option', { name: /Outbox/i })).toBeNull();
  });

  test('the collapsed sliver names the same three queues', () => {
    mount(true);
    const sliver = screen.getByRole('button', { name: /Expand Queues column/ });
    expect(sliver.getAttribute('aria-label')).toBe(
      'Expand Queues column — 3 unread: Inbox 0, Mentions 1, Watching 2',
    );
    expect(sliver.textContent).not.toMatch(/Outbox/i);
  });
});

describe('row 39 — Mentions and Watching are undamaged by the removal', () => {
  test('a mention card still marks its notification read and opens the issue', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: /alice/i }));
    expect(markReadMutate).toHaveBeenCalledWith([7]);
    expect(selectInboxIssue).toHaveBeenCalledWith('sk-1', 'sk');
  });

  test('a watching card still marks the card read and opens it', () => {
    tab = 'watching';
    mount();
    // sk-303.13.2.10 (W2) — the card head no longer overrides its own
    // accessible name with an `aria-label`; the name is now the hidden
    // lead-in plus the visible id and title.
    fireEvent.click(screen.getByRole('button', { name: /^Open issue.*sk-9/ }));
    expect(markCardReadMutate).toHaveBeenCalledWith('sk-9');
    expect(selectInboxIssue).toHaveBeenCalledWith('sk-9', 'sk');
  });

  test('the × on a watching card still unsubscribes and does not open the issue', () => {
    tab = 'watching';
    mount();
    fireEvent.click(screen.getByRole('button', { name: /Unsubscribe from sk-9/ }));
    expect(unwatchMutate).toHaveBeenCalledWith('sk-9');
    // stopPropagation still holds: leaving is not opening.
    expect(selectInboxIssue).not.toHaveBeenCalled();
  });
});
