/**
 * Marking mentions read (sk-38): the real `useMarkNotificationsRead`, next to
 * the real `useMentions` feed and `useNotificationCounts` badge it serves, on
 * a `fetch` stub that models the server.
 *
 * Contract (sk-38, the hook's own docblock): the chosen mention cards turn
 * read in the feed before the server answers; a success refreshes the badge
 * counters and keeps the read cards in the feed until its next natural
 * refresh (the server filters read rows out, so a refetch would drop them);
 * a failure puts the cards back as they were.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { NotificationItem } from '../api/notifications';
import { useMarkNotificationsRead } from './useMarkNotificationsRead';
import { useMentions } from './useMentions';
import { useNotificationCounts } from './useNotificationCounts';

const mention = (id: number): NotificationItem => ({
  id,
  type: 'comment.mention',
  createdAt: '2026-11-20T10:00:00Z',
  readAt: null,
  archivedAt: null,
  actor: { type: 'human', userId: 'u-2', username: 'bob' },
  entity: { type: 'issue', id: `sk-${id}`, title: `t${id}`, projectId: 'p1', projectIdPrefix: 'sk' },
  summary: `bob mentioned you in sk-${id}`,
  field: null,
  oldValue: null,
  newValue: null,
  mentionContext: `@ann see sk-${id}`,
});

interface Deferred {
  resolve: (r: Response) => void;
}

/** The server: three unread mentions; reads filter out of the feed. */
let readIds: Set<number>;
let failReadOf: number | null;
let pendingReads: Map<number, Deferred>;
let holdReads: boolean;
const fetchSpy = vi.fn<typeof fetch>();

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function serverAnswer(url: string, init?: RequestInit): Promise<Response> {
  const read = /^\/api\/v1\/notifications\/(\d+)\/read$/.exec(url);
  if (read && init?.method === 'POST') {
    const id = Number(read[1]);
    const answer = () => {
      if (id === failReadOf) return json({ error: 'internal' }, 500);
      readIds.add(id);
      return new Response(null, { status: 204 });
    };
    if (!holdReads) return Promise.resolve(answer());
    return new Promise((resolve) => {
      pendingReads.set(id, { resolve: () => resolve(answer()) });
    });
  }
  if (url.startsWith('/api/v1/notifications?') && url.includes('scope=mentions')) {
    const items = [11, 12, 13].filter((id) => !readIds.has(id)).map(mention);
    return Promise.resolve(json({ items, nextCursor: null, hasMore: false }));
  }
  if (url === '/api/v1/me/notification-counts') {
    return Promise.resolve(json({ inbox: 0, mentions: 3 - readIds.size, watching: 0 }));
  }
  return Promise.resolve(json({ error: 'unexpected' }, 599));
}

const urlOf = (call: Parameters<typeof fetch>) => String(call[0]);
const callsTo = (pred: (url: string, method: string) => boolean) =>
  fetchSpy.mock.calls.filter((c) => pred(urlOf(c), (c[1]?.method ?? 'GET').toUpperCase()));
const feedReads = () => callsTo((u) => u.startsWith('/api/v1/notifications?')).length;
const readPosts = () =>
  callsTo((u, m) => m === 'POST' && /\/read$/.test(u)).map((c) => urlOf(c));

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return renderHook(
    () => ({ feed: useMentions(), badge: useNotificationCounts(), mark: useMarkNotificationsRead() }),
    { wrapper },
  );
}

const readState = (items: NotificationItem[] | undefined) =>
  (items ?? []).map((it) => [it.id, it.readAt !== null] as const);

beforeEach(() => {
  readIds = new Set();
  failReadOf = null;
  pendingReads = new Map();
  holdReads = false;
  fetchSpy.mockReset();
  fetchSpy.mockImplementation((input, init) => serverAnswer(String(input), init));
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function mountLoaded() {
  const view = mount();
  await waitFor(() => expect(view.result.current.feed.data?.items).toHaveLength(3));
  await waitFor(() => expect(view.result.current.badge.counts.mentions).toBe(3));
  return view;
}

describe('marking mentions read', () => {
  test('only the chosen cards turn read in the feed before the server answers', async () => {
    holdReads = true;
    const view = await mountLoaded();

    act(() => view.result.current.mark.mutate([11, 13]));

    await waitFor(() =>
      expect(readState(view.result.current.feed.data?.items)).toEqual([
        [11, true],
        [12, false],
        [13, true],
      ]),
    );
    expect(pendingReads.size).toBe(2);
    expect(readPosts().sort()).toEqual([
      '/api/v1/notifications/11/read',
      '/api/v1/notifications/13/read',
    ]);
    expect(view.result.current.mark.isPending).toBe(true);
  });

  test('a success refreshes the counters and keeps the read cards in the feed', async () => {
    const view = await mountLoaded();
    const feedReadsBefore = feedReads();

    await act(() => view.result.current.mark.mutateAsync([11, 12]));

    await waitFor(() => expect(view.result.current.badge.counts.mentions).toBe(1));
    // The server would now drop 11 and 12 from the feed; they stay, read.
    expect(readState(view.result.current.feed.data?.items)).toEqual([
      [11, true],
      [12, true],
      [13, false],
    ]);
    expect(feedReads()).toBe(feedReadsBefore);
  });

  test('a failure puts every card back as it was', async () => {
    failReadOf = 12;
    const view = await mountLoaded();
    const before = view.result.current.feed.data;

    await act(async () => {
      await expect(view.result.current.mark.mutateAsync([11, 12])).rejects.toThrow();
    });
    // TanStack delivers cache changes to observers on a later task; the
    // error state is delivered after every cache write of this mutation, so
    // once it is rendered the feed shows its final state, not a stale one.
    await waitFor(() => expect(view.result.current.mark.isError).toBe(true));

    expect(view.result.current.feed.data).toEqual(before);
    expect(readState(view.result.current.feed.data?.items)).toEqual([
      [11, false],
      [12, false],
      [13, false],
    ]);
  });

  test('marking read before the feed was ever loaded still reaches the server', async () => {
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const view = renderHook(() => useMarkNotificationsRead(), { wrapper });

    await act(() => view.result.current.mutateAsync([12]));

    expect(readPosts()).toEqual(['/api/v1/notifications/12/read']);
    expect(readIds).toEqual(new Set([12]));
  });

  test('an empty selection sends nothing and changes no card', async () => {
    const view = await mountLoaded();

    await act(() => view.result.current.mark.mutateAsync([]));
    await waitFor(() => expect(view.result.current.mark.isSuccess).toBe(true));

    expect(readPosts()).toEqual([]);
    expect(readState(view.result.current.feed.data?.items)).toEqual([
      [11, false],
      [12, false],
      [13, false],
    ]);
  });
});
