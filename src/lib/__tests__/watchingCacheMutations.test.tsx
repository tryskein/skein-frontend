/**
 * sk-303.13.2.10 (FE-G2 / C1 + C2) — what the two Watching mutations
 * write into the cache, asserted on the cache itself.
 *
 * The column tests mock both hooks away, so before this file there was
 * no gate at all on the patch they apply. Two defects lived in that gap:
 *
 *  C1 — since T028 the tab's number and the empty-state verdict come
 *       from the response's own `unreadTotal` / `subscriptionsTotal`,
 *       not from the cards. Both mutations still patched `items` alone,
 *       so the bell ticked down and the tab did not, and leaving the
 *       last subscription produced "Subscriptions: 1…" for someone who had
 *       just left it.
 *  C2 — `mark-read-by-entity` clears notifications recorded on the
 *       subscribed issue. A subtree card's badge also counts
 *       notifications recorded on DESCENDANTS, which that request does
 *       not touch; zeroing the whole badge made the number bounce back
 *       on the next refetch.
 *
 * sk-622.21 (No. 84) — C2 is resolved on the server: the card's
 * click is «read card X» (US-7), which reads every unread notification of
 * the card, the descendants' included. So the C2 block now asserts the
 * opposite of what it used to: the whole card clears, and the request is
 * the card route, never `mark-read-by-entity`. Historical cards (US-5/6)
 * are cards but not subscriptions: removing them moves the card totals,
 * never `subscriptionsTotal`, and a closed sweep reports them in
 * `historicalRemoved`.
 *
 * Everything below drives the REAL hooks against a real QueryClient —
 * only the two network calls are stubbed — because the thing under test
 * is the cache write, and a mocked hook writes nothing.
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import type {
  NotificationItem,
  WatchingItem,
  WatchingListResponse,
} from '../../api/notifications';
import { watchingStateQueryKey } from '../useWatching';
import { useMarkWatchingCardRead } from '../useMarkWatchingCardRead';
import { useUnwatch } from '../useUnwatch';
import { useBulkUnwatch } from '../useBulkUnwatch';

const markReadByEntitySpy = vi.fn<() => Promise<void>>();
const markCardReadSpy = vi.fn<(issueId: string) => Promise<{ marked: number }>>();
const unwatchIssueSpy = vi.fn<() => Promise<void>>();
const bulkUnwatchSpy = vi.fn<
  (input: unknown) => Promise<{ unwatched: number; keptManual: number; historicalRemoved: number }>
>();

vi.mock('../../api/notifications', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/notifications')>();
  return {
    ...actual,
    markReadByEntity: () => markReadByEntitySpy(),
    markWatchingCardRead: (issueId: string) => markCardReadSpy(issueId),
  };
});
vi.mock('../../api/watchers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/watchers')>();
  return {
    ...actual,
    unwatchIssue: () => unwatchIssueSpy(),
    bulkUnwatch: (input: unknown) => bulkUnwatchSpy(input),
  };
});

// ── fixtures ────────────────────────────────────────────────────────

function ev(id: number, onIssue: string, read = false): NotificationItem {
  return {
    id,
    type: 'comment.created',
    createdAt: '2026-08-30T10:00:00Z',
    readAt: read ? '2026-08-30T11:00:00Z' : null,
    archivedAt: null,
    actor: { username: 'alice', userId: 'u1', type: 'human' },
    entity: {
      type: 'issue',
      id: onIssue,
      title: `title of ${onIssue}`,
      projectId: 'p1',
      projectIdPrefix: 'sk',
    },
    summary: `alice commented on ${onIssue}`,
    field: null,
    oldValue: null,
    newValue: null,
  };
}

function sub(id: string, unread: number, events: NotificationItem[]): WatchingItem {
  return {
    item: { id, title: `Task ${id}`, projectId: 'p1' } as never,
    reasons: ['creator'],
    unreadEventsCount: unread,
    recentEvents: events,
    since: '2026-01-01T00:00:00Z',
  };
}

/** sk-622.21 (US-5) — a historical card: no reasons, no subscription time. */
function historical(id: string, unread: number, events: NotificationItem[]): WatchingItem {
  return { ...sub(id, unread, events), reasons: [], since: null };
}

let qc: QueryClient;

type SeedResponse = Omit<WatchingListResponse, 'state' | 'stateTotal' | 'openTotal' | 'closedTotal' | 'closedAutoTotal'> &
  Partial<WatchingListResponse>;

// sk-551.10 — the feed is cached per filter; these fixtures are the «all»
// entry, with every subscription open unless the fixture says otherwise.
function seed(response: SeedResponse) {
  qc.setQueryData<WatchingListResponse>(watchingStateQueryKey('all'), {
    state: 'all',
    stateTotal: response.subscriptionsTotal,
    openTotal: response.subscriptionsTotal,
    closedTotal: 0,
    closedAutoTotal: 0,
    ...response,
  });
}
function watchingNow(): WatchingListResponse {
  return qc.getQueryData<WatchingListResponse>(watchingStateQueryKey('all'))!;
}

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  markReadByEntitySpy.mockResolvedValue(undefined);
  markCardReadSpy.mockResolvedValue({ marked: 0 });
  unwatchIssueSpy.mockResolvedValue(undefined);
  qc = new QueryClient({
    defaultOptions: {
      // sk-551.10 review — the writers now refetch every Watching cache
      // once they settle. A refetch that never answers keeps each cache
      // exactly as the optimistic write left it, which is what these
      // tests assert on; whether the refetch was REQUESTED is asserted
      // separately (isInvalidated).
      queries: { retry: false, queryFn: () => new Promise<never>(() => {}) },
      mutations: { retry: false },
    },
  });
});

// ── C1: mark-read moves the total, not only the row ─────────────────

describe('C1 — mark-read patches the aggregate the column actually renders', () => {
  test('an exact subscription: row AND unreadTotal both reach zero', async () => {
    seed({
      items: [sub('sk-42', 3, [ev(1, 'sk-42'), ev(2, 'sk-42'), ev(3, 'sk-42')])],
      unreadTotal: 3,
      subscriptionsTotal: 1,
      truncated: false,
    });
    const { result } = renderHook(() => useMarkWatchingCardRead(), { wrapper });
    result.current.mutate('sk-42');
    await waitFor(() => expect(watchingNow().items[0].unreadEventsCount).toBe(0));
    // The number the tab shows. Before the fix it stayed at 3 while the
    // header bell refetched to 0.
    expect(watchingNow().unreadTotal).toBe(0);
    // The card is a subscription: it stays.
    expect(watchingNow().items).toHaveLength(1);
    expect(watchingNow().subscriptionsTotal).toBe(1);
  });

  test('other subscriptions keep their contribution to the total', async () => {
    seed({
      items: [sub('sk-42', 3, [ev(1, 'sk-42')]), sub('sk-7', 2, [ev(2, 'sk-7')])],
      unreadTotal: 5,
      subscriptionsTotal: 2,
      truncated: false,
    });
    const { result } = renderHook(() => useMarkWatchingCardRead(), { wrapper });
    result.current.mutate('sk-42');
    await waitFor(() => expect(watchingNow().items[0].unreadEventsCount).toBe(0));
    expect(watchingNow().unreadTotal).toBe(2);
    expect(watchingNow().items[1].unreadEventsCount).toBe(2);
  });

  test('rollback restores the total together with the row', async () => {
    markCardReadSpy.mockRejectedValue(new Error('boom'));
    seed({
      items: [sub('sk-42', 3, [ev(1, 'sk-42'), ev(2, 'sk-42'), ev(3, 'sk-42')])],
      unreadTotal: 3,
      subscriptionsTotal: 1,
      truncated: false,
    });
    const { result } = renderHook(() => useMarkWatchingCardRead(), { wrapper });
    result.current.mutate('sk-42');
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(watchingNow().unreadTotal).toBe(3);
    expect(watchingNow().items[0].unreadEventsCount).toBe(3);
  });
});

// ── C2 → US-7: «read card X» clears the whole card ─────────────────

describe('US-7 — «read card X» clears every unread of the card, descendants included', () => {
  test('a subtree card: the descendants’ unread come off with the ancestor’s own', async () => {
    // 4 unread on the ancestor's card: three recorded on descendants,
    // one on the ancestor. Another card holds 2 that must stay.
    seed({
      items: [
        sub('sk-42', 4, [
          ev(1, 'sk-42.1'),
          ev(2, 'sk-42.3.7'),
          ev(3, 'sk-42'),
          ev(4, 'sk-42.1'),
        ]),
        sub('sk-7', 2, [ev(5, 'sk-7')]),
      ],
      unreadTotal: 6,
      subscriptionsTotal: 2,
      truncated: false,
    });
    const { result } = renderHook(() => useMarkWatchingCardRead(), { wrapper });
    result.current.mutate('sk-42');
    await waitFor(() => expect(watchingNow().items[0].unreadEventsCount).toBe(0));
    // The badge drops by the card's 4, not by the ancestor's own 1.
    expect(watchingNow().unreadTotal).toBe(2);
    // Every row of the card's timeline is read — the descendants' too.
    expect(
      watchingNow().items[0].recentEvents.every((e) => typeof e.readAt === 'string' && e.readAt !== ''),
    ).toBe(true);
    // The read rows are still the same notifications.
    expect(watchingNow().items[0].recentEvents.map((e) => e.id)).toEqual([1, 2, 3, 4]);
    // Other cards are untouched.
    expect(watchingNow().items[1].unreadEventsCount).toBe(2);
    expect(watchingNow().items[1].recentEvents[0].readAt).toBeNull();
    // The card stays: it is still a subscription.
    expect(watchingNow().items).toHaveLength(2);
  });

  test('the request is the card route for the card, never mark-read-by-entity', async () => {
    seed({
      items: [sub('sk-42', 2, [ev(1, 'sk-42.1'), ev(2, 'sk-42')])],
      unreadTotal: 2,
      subscriptionsTotal: 1,
      truncated: false,
    });
    const { result } = renderHook(() => useMarkWatchingCardRead(), { wrapper });
    result.current.mutate('sk-42');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(markCardReadSpy).toHaveBeenCalledWith('sk-42');
    expect(markReadByEntitySpy).not.toHaveBeenCalled();
  });

  test('the badge moves by the card’s in-window unread, not by the server’s `marked`', async () => {
    // `marked` also counts rows outside the window, which the badge never
    // counted (US-7: the badge drops exactly by the card's unread in the window).
    markCardReadSpy.mockResolvedValue({ marked: 9 });
    seed({
      items: [sub('sk-42', 3, [ev(1, 'sk-42.1')]), sub('sk-7', 1, [])],
      unreadTotal: 4,
      subscriptionsTotal: 2,
      truncated: false,
    });
    const { result } = renderHook(() => useMarkWatchingCardRead(), { wrapper });
    result.current.mutate('sk-42');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(watchingNow().unreadTotal).toBe(1);
  });

  test('a card no cached list carries moves nothing and does not fail', async () => {
    seed({
      items: [sub('sk-7', 2, [ev(1, 'sk-7')])],
      unreadTotal: 2,
      subscriptionsTotal: 1,
      truncated: false,
    });
    const { result } = renderHook(() => useMarkWatchingCardRead(), { wrapper });
    result.current.mutate('sk-999');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(markCardReadSpy).toHaveBeenCalledWith('sk-999');
    expect(watchingNow().unreadTotal).toBe(2);
    expect(watchingNow().items[0].unreadEventsCount).toBe(2);
  });

  test('once settled it refetches the header counters and Watching — not the rest of the cache', async () => {
    seed({ items: [sub('sk-42', 1, [ev(1, 'sk-42')])], unreadTotal: 1, subscriptionsTotal: 1, truncated: false });
    qc.setQueryData(['notification-counts'], { watching: 1 });
    qc.setQueryData(['tasks', 'list', 'p1'], { items: [] });
    const { result } = renderHook(() => useMarkWatchingCardRead(), { wrapper });
    result.current.mutate('sk-42');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(qc.getQueryState(['notification-counts'])!.isInvalidated).toBe(true);
    expect(qc.getQueryState(watchingStateQueryKey('all'))!.isInvalidated).toBe(true);
    expect(qc.getQueryState(['tasks', 'list', 'p1'])!.isInvalidated).toBe(false);
  });

  test('a historical card is read the same way and stays on screen', async () => {
    seed({
      items: [historical('sk-9', 2, [ev(1, 'sk-9'), ev(2, 'sk-9.4')])],
      unreadTotal: 2,
      subscriptionsTotal: 0,
      truncated: false,
    });
    const { result } = renderHook(() => useMarkWatchingCardRead(), { wrapper });
    result.current.mutate('sk-9');
    await waitFor(() => expect(watchingNow().items[0].unreadEventsCount).toBe(0));
    expect(watchingNow().unreadTotal).toBe(0);
    expect(watchingNow().items).toHaveLength(1);
  });
});

// ── C1: unwatch moves both totals ───────────────────────────────────

describe('C1 — unwatch patches subscriptionsTotal and unreadTotal', () => {
  test('leaving the only silent subscription cannot report "Subscriptions: 1"', async () => {
    seed({
      items: [sub('sk-42', 0, [])],
      unreadTotal: 0,
      subscriptionsTotal: 1,
      truncated: false,
    });
    const { result } = renderHook(() => useUnwatch(), { wrapper });
    result.current.mutate('sk-42');
    await waitFor(() => expect(watchingNow().items).toHaveLength(0));
    expect(watchingNow().subscriptionsTotal).toBe(0);
  });

  test('leaving a subscription that still had unread takes its share off the total', async () => {
    // Otherwise the column keeps a non-zero total with no cards and
    // paints "Subscriptions exist, but their issues are currently unavailable."
    seed({
      items: [sub('sk-42', 3, [ev(1, 'sk-42')])],
      unreadTotal: 3,
      subscriptionsTotal: 1,
      truncated: false,
    });
    const { result } = renderHook(() => useUnwatch(), { wrapper });
    result.current.mutate('sk-42');
    await waitFor(() => expect(watchingNow().items).toHaveLength(0));
    expect(watchingNow().unreadTotal).toBe(0);
    expect(watchingNow().subscriptionsTotal).toBe(0);
  });

  test('with other subscriptions left, only the removed row’s share moves', async () => {
    seed({
      items: [sub('sk-42', 3, []), sub('sk-7', 2, [])],
      unreadTotal: 5,
      subscriptionsTotal: 2,
      truncated: false,
    });
    const { result } = renderHook(() => useUnwatch(), { wrapper });
    result.current.mutate('sk-42');
    await waitFor(() => expect(watchingNow().items).toHaveLength(1));
    expect(watchingNow().unreadTotal).toBe(2);
    expect(watchingNow().subscriptionsTotal).toBe(1);
  });

  test('an unwatch on an issue this feed never carried moves nothing', async () => {
    seed({
      items: [sub('sk-7', 2, [])],
      unreadTotal: 2,
      subscriptionsTotal: 40,
      truncated: true,
    });
    const { result } = renderHook(() => useUnwatch(), { wrapper });
    result.current.mutate('sk-999');
    await waitFor(() => expect(unwatchIssueSpy).toHaveBeenCalled());
    expect(watchingNow().subscriptionsTotal).toBe(40);
    expect(watchingNow().unreadTotal).toBe(2);
  });

  test('rollback restores rows and totals together', async () => {
    unwatchIssueSpy.mockRejectedValue(new Error('boom'));
    seed({
      items: [sub('sk-42', 3, [])],
      unreadTotal: 3,
      subscriptionsTotal: 1,
      truncated: false,
    });
    const { result } = renderHook(() => useUnwatch(), { wrapper });
    result.current.mutate('sk-42');
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(watchingNow().items).toHaveLength(1);
    expect(watchingNow().unreadTotal).toBe(3);
    expect(watchingNow().subscriptionsTotal).toBe(1);
  });
});

// ── sk-551.10: one cache per filter, all of them patched ────────────

describe('sk-551.10 — unwatch moves every cached filter', () => {
  function closedSub(id: string, unread: number): WatchingItem {
    const base = sub(id, unread, []);
    return { ...base, item: { ...(base.item as object), status: 'closed' } as never };
  }

  test('a closed card leaves «closed» and «all»; «open» keeps its cards but its totals move', async () => {
    const closedCard = closedSub('sk-7', 2);
    const openCard = { ...sub('sk-8', 1, []), item: { id: 'sk-8', title: 'Task sk-8', projectId: 'p1', status: 'open' } as never };
    const totals = { unreadTotal: 3, subscriptionsTotal: 2, openTotal: 1, closedTotal: 1, closedAutoTotal: 1, truncated: false };
    qc.setQueryData<WatchingListResponse>(watchingStateQueryKey('all'), {
      ...totals, items: [closedCard, openCard], state: 'all', stateTotal: 2,
    });
    qc.setQueryData<WatchingListResponse>(watchingStateQueryKey('closed'), {
      ...totals, items: [closedCard], state: 'closed', stateTotal: 1,
    });
    qc.setQueryData<WatchingListResponse>(watchingStateQueryKey('open'), {
      ...totals, items: [openCard], state: 'open', stateTotal: 1,
    });

    const { result } = renderHook(() => useUnwatch(), { wrapper });
    result.current.mutate('sk-7');

    const get = (s: 'open' | 'closed' | 'all') =>
      qc.getQueryData<WatchingListResponse>(watchingStateQueryKey(s))!;
    await waitFor(() => expect(get('closed').items).toHaveLength(0));
    expect(get('closed').stateTotal).toBe(0);
    expect(get('all').items.map((it) => it.item.id)).toEqual(['sk-8']);
    expect(get('all').stateTotal).toBe(1);
    // «open» never carried the card, and its own selection is unchanged…
    expect(get('open').items.map((it) => it.item.id)).toEqual(['sk-8']);
    expect(get('open').stateTotal).toBe(1);
    // …but the totals every filter shows are the same set, so they move.
    for (const s of ['open', 'closed', 'all'] as const) {
      expect(get(s).closedTotal).toBe(0);
      expect(get(s).closedAutoTotal).toBe(0);
      expect(get(s).openTotal).toBe(1);
      expect(get(s).subscriptionsTotal).toBe(1);
      expect(get(s).unreadTotal).toBe(1);
    }
  });
});

// ── sk-551.10 review: caches that disagree ──────────────────────────

describe('sk-551.10 review — each cache is patched from its own row, totals from the freshest', () => {
  const key = (s: 'open' | 'closed' | 'all') => watchingStateQueryKey(s);
  const get = (s: 'open' | 'closed' | 'all') => qc.getQueryData<WatchingListResponse>(key(s))!;
  function put(
    s: 'open' | 'closed' | 'all',
    items: WatchingItem[],
    over: Partial<WatchingListResponse>,
    updatedAt: number,
  ) {
    qc.setQueryData<WatchingListResponse>(
      key(s),
      {
        items,
        unreadTotal: 0,
        subscriptionsTotal: items.length,
        truncated: false,
        state: s,
        stateTotal: items.length,
        openTotal: items.length,
        closedTotal: 0,
        closedAutoTotal: 0,
        ...over,
      },
      { updatedAt },
    );
  }
  const withStatus = (row: WatchingItem, status: string): WatchingItem => ({
    ...row,
    item: { ...(row.item as object), status } as never,
  });

  test('card read: a stale «open» copy does not decide what the fresh «all» card loses', async () => {
    // Inserted first and OLDER: one unread. Inserted second and NEWER: three.
    put('open', [sub('sk-1', 1, [])], { unreadTotal: 1 }, 1_000);
    put('all', [sub('sk-1', 3, [])], { unreadTotal: 3 }, 2_000);

    const { result } = renderHook(() => useMarkWatchingCardRead(), { wrapper });
    result.current.mutate('sk-1');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Each card from its own copy: both reach zero.
    expect(get('all').items[0].unreadEventsCount).toBe(0);
    expect(get('open').items[0].unreadEventsCount).toBe(0);
    // The shared total moves by the fresh copy's 3.
    expect(get('all').unreadTotal).toBe(0);
    expect(get('open').unreadTotal).toBe(0);
    // And both are sent back to the server once settled.
    expect(qc.getQueryState(key('all'))!.isInvalidated).toBe(true);
    expect(qc.getQueryState(key('open'))!.isInvalidated).toBe(true);
  });

  test('unwatch: the fresh copy says «closed», so closedTotal moves — not openTotal', async () => {
    const stale = withStatus(sub('sk-1', 0, []), 'open');
    const fresh = withStatus(sub('sk-1', 0, []), 'closed');
    const totals = { subscriptionsTotal: 2, openTotal: 1, closedTotal: 1, closedAutoTotal: 1 };
    put('open', [stale], { ...totals, stateTotal: 1 }, 1_000);
    put('all', [fresh, withStatus(sub('sk-2', 0, []), 'open')], { ...totals, stateTotal: 2 }, 2_000);

    const { result } = renderHook(() => useUnwatch(), { wrapper });
    result.current.mutate('sk-1');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    for (const s of ['open', 'all'] as const) {
      expect(get(s).closedTotal).toBe(0);
      expect(get(s).closedAutoTotal).toBe(0);
      expect(get(s).openTotal).toBe(1);
      expect(get(s).subscriptionsTotal).toBe(1);
      expect(get(s).items.map((it) => it.item.id)).not.toContain('sk-1');
    }
    expect(get('all').stateTotal).toBe(1);
    // A closed task was never part of «open»'s own selection.
    expect(get('open').stateTotal).toBe(1);
    expect(qc.getQueryState(key('all'))!.isInvalidated).toBe(true);
  });

  test('a filter still loading its first answer is not cancelled by a write', async () => {
    put('all', [sub('sk-1', 0, [])], {}, 1_000);
    let land!: (v: WatchingListResponse) => void;
    const firstFetch = qc.prefetchQuery({
      queryKey: key('closed'),
      queryFn: () => new Promise<WatchingListResponse>((r) => (land = r)),
    });

    const { result } = renderHook(() => useUnwatch(), { wrapper });
    result.current.mutate('sk-1');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    land({
      items: [],
      unreadTotal: 0,
      subscriptionsTotal: 0,
      truncated: false,
      state: 'closed',
      stateTotal: 0,
      openTotal: 0,
      closedTotal: 0,
      closedAutoTotal: 0,
    });
    await firstFetch;
    expect(qc.getQueryState(key('closed'))!.status).toBe('success');
    expect(get('closed').state).toBe('closed');
  });

  test('bulk unwatch of a selection removes the cards from every filter', async () => {
    bulkUnwatchSpy.mockResolvedValue({ unwatched: 1, keptManual: 0, historicalRemoved: 0 });
    const card = withStatus(sub('sk-1', 2, []), 'closed');
    const totals = { subscriptionsTotal: 2, openTotal: 1, closedTotal: 1, closedAutoTotal: 1, unreadTotal: 2 };
    put('closed', [card], { ...totals, stateTotal: 1 }, 1_000);
    put('all', [card, withStatus(sub('sk-2', 0, []), 'open')], { ...totals, stateTotal: 2 }, 2_000);

    const { result } = renderHook(() => useBulkUnwatch(), { wrapper });
    result.current.mutate({ issueIds: ['sk-1'] });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(get('closed').items).toHaveLength(0);
    expect(get('all').items.map((it) => it.item.id)).toEqual(['sk-2']);
    for (const s of ['closed', 'all'] as const) {
      expect(get(s).closedTotal).toBe(0);
      expect(get(s).subscriptionsTotal).toBe(1);
      expect(get(s).unreadTotal).toBe(0);
    }
    expect(qc.getQueryState(key('closed'))!.isInvalidated).toBe(true);
  });

  test('bulk sweep of closed drops the automatic closed cards and keeps manual ones', async () => {
    bulkUnwatchSpy.mockResolvedValue({ unwatched: 3, keptManual: 1, historicalRemoved: 0 });
    const auto = withStatus(sub('sk-1', 0, []), 'closed');
    const manual = { ...withStatus(sub('sk-2', 0, []), 'closed'), reasons: ['creator', 'manual'] };
    put(
      'closed',
      [auto, manual],
      { subscriptionsTotal: 9, openTotal: 5, closedTotal: 4, closedAutoTotal: 3, stateTotal: 4 },
      1_000,
    );
    put(
      'open',
      [withStatus(sub('sk-3', 0, []), 'open')],
      { subscriptionsTotal: 9, openTotal: 5, closedTotal: 4, closedAutoTotal: 3, stateTotal: 5 },
      1_000,
    );

    const { result } = renderHook(() => useBulkUnwatch(), { wrapper });
    result.current.mutate({ state: 'closed' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(get('closed').items.map((it) => it.item.id)).toEqual(['sk-2']);
    expect(get('closed').stateTotal).toBe(1);
    expect(get('closed').closedAutoTotal).toBe(0);
    expect(get('open').stateTotal).toBe(5);
    expect(get('open').subscriptionsTotal).toBe(6);
    expect(qc.getQueryState(key('open'))!.isInvalidated).toBe(true);
  });
});

// ── sk-622.21 (US-6): historical cards are cards, not subscriptions ──

describe('US-6 — removing historical cards', () => {
  const key = (st: 'open' | 'closed' | 'all') => watchingStateQueryKey(st);
  const get = (st: 'open' | 'closed' | 'all') => qc.getQueryData<WatchingListResponse>(key(st))!;
  const closed = (row: WatchingItem): WatchingItem => ({
    ...row,
    item: { ...(row.item as object), status: 'closed' } as never,
  });

  test('«remove» on one historical card: the card and its unread go, subscriptionsTotal stays', async () => {
    qc.setQueryData<WatchingListResponse>(key('all'), {
      items: [closed(historical('sk-9', 2, [])), sub('sk-1', 0, [])],
      unreadTotal: 2,
      subscriptionsTotal: 1,
      truncated: false,
      state: 'all',
      stateTotal: 2,
      openTotal: 1,
      closedTotal: 1,
      closedAutoTotal: 1,
    });
    const { result } = renderHook(() => useUnwatch(), { wrapper });
    result.current.mutate('sk-9');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(get('all').items.map((it) => it.item.id)).toEqual(['sk-1']);
    expect(get('all').subscriptionsTotal).toBe(1);
    expect(get('all').closedTotal).toBe(0);
    expect(get('all').closedAutoTotal).toBe(0);
    expect(get('all').stateTotal).toBe(1);
    expect(get('all').unreadTotal).toBe(0);
  });

  test('a selection mixing both kinds: subscriptionsTotal moves only by the subscribed ones', async () => {
    bulkUnwatchSpy.mockResolvedValue({ unwatched: 1, keptManual: 0, historicalRemoved: 1 });
    qc.setQueryData<WatchingListResponse>(key('all'), {
      items: [historical('sk-9', 1, []), sub('sk-1', 1, []), sub('sk-2', 0, [])],
      unreadTotal: 2,
      subscriptionsTotal: 2,
      truncated: false,
      state: 'all',
      stateTotal: 3,
      openTotal: 3,
      closedTotal: 0,
      closedAutoTotal: 0,
    });
    const { result } = renderHook(() => useBulkUnwatch(), { wrapper });
    result.current.mutate({ issueIds: ['sk-9', 'sk-1'] });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(get('all').items.map((it) => it.item.id)).toEqual(['sk-2']);
    expect(get('all').subscriptionsTotal).toBe(1);
    expect(get('all').openTotal).toBe(1);
    expect(get('all').stateTotal).toBe(1);
    expect(get('all').unreadTotal).toBe(0);
  });

  test('bulk sweep of closed: historical cards go, the card totals count them, `historicalRemoved` is reported', async () => {
    bulkUnwatchSpy.mockResolvedValue({ unwatched: 1, keptManual: 1, historicalRemoved: 2 });
    const auto = closed(sub('sk-1', 0, []));
    const manual = { ...closed(sub('sk-2', 0, [])), reasons: ['manual'] };
    const hist = closed(historical('sk-3', 1, []));
    // 6 closed cards: on screen 1 automatic subscription, 1 manual, 1
    // historical; the sweep takes 1 subscription and 2 historical cards.
    // closedAutoTotal also counts automatic closed cards beyond the screen.
    const totals = { subscriptionsTotal: 2, openTotal: 0, closedTotal: 6, closedAutoTotal: 5, unreadTotal: 1 };
    qc.setQueryData<WatchingListResponse>(key('closed'), {
      ...totals, items: [auto, manual, hist], truncated: true, state: 'closed', stateTotal: 6,
    });

    const { result } = renderHook(() => useBulkUnwatch(), { wrapper });
    result.current.mutate({ state: 'closed' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.historicalRemoved).toBe(2);
    expect(get('closed').items.map((it) => it.item.id)).toEqual(['sk-2']);
    // Cards: 1 subscription + 2 historical left the closed set.
    expect(get('closed').closedTotal).toBe(3);
    expect(get('closed').closedAutoTotal).toBe(2);
    expect(get('closed').stateTotal).toBe(3);
    // Subscriptions: only the one that was stopped.
    expect(get('closed').subscriptionsTotal).toBe(1);
    expect(qc.getQueryState(key('closed'))!.isInvalidated).toBe(true);
  });

  test('a sweep of open moves the open card totals by subscriptions and historical cards alike', async () => {
    bulkUnwatchSpy.mockResolvedValue({ unwatched: 2, keptManual: 0, historicalRemoved: 3 });
    qc.setQueryData<WatchingListResponse>(key('all'), {
      items: [sub('sk-1', 0, []), historical('sk-2', 0, [])],
      unreadTotal: 0,
      subscriptionsTotal: 4,
      truncated: true,
      state: 'all',
      stateTotal: 9,
      openTotal: 7,
      closedTotal: 2,
      closedAutoTotal: 2,
    });
    const { result } = renderHook(() => useBulkUnwatch(), { wrapper });
    result.current.mutate({ state: 'open' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(get('all').items).toHaveLength(0);
    expect(get('all').openTotal).toBe(2);
    expect(get('all').stateTotal).toBe(4);
    expect(get('all').subscriptionsTotal).toBe(2);
    expect(get('all').closedTotal).toBe(2);
  });

  test('a sweep of all leaves the open/closed split to the refetch', async () => {
    bulkUnwatchSpy.mockResolvedValue({ unwatched: 2, keptManual: 0, historicalRemoved: 1 });
    qc.setQueryData<WatchingListResponse>(key('all'), {
      items: [sub('sk-1', 0, [])],
      unreadTotal: 0,
      subscriptionsTotal: 4,
      truncated: true,
      state: 'all',
      stateTotal: 9,
      openTotal: 7,
      closedTotal: 2,
      closedAutoTotal: 2,
    });
    const { result } = renderHook(() => useBulkUnwatch(), { wrapper });
    result.current.mutate({ state: 'all' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(get('all').stateTotal).toBe(6);
    expect(get('all').subscriptionsTotal).toBe(2);
    // Which of the swept cards were open is unknown: not guessed.
    expect(get('all').openTotal).toBe(7);
    expect(get('all').closedTotal).toBe(2);
  });
});

