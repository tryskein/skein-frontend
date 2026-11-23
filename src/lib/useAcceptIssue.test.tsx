/**
 * Accepting an issue from Inbox (F3; the docblock of `useAcceptIssue`): the
 * real hook next to the real header-badge counters (`useNotificationCounts`)
 * on a `fetch` stub that models the server — after an accept the server
 * counts one Inbox issue fewer.
 *
 * sk-1060 — the header badge counters are re-read once the accept has
 * settled, whatever its outcome ("Notification counts ARE invalidated so the
 * header bell badge ticks down as soon as the row is accepted").
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toaster } from '../components/Toaster';
import { releaseAllAccepted } from './inboxAcceptedRetention';
import { useAcceptIssue } from './useAcceptIssue';
import { useInbox } from './useInbox';
import { useNotificationCounts } from './useNotificationCounts';

const fetchSpy = vi.fn<typeof fetch>();

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** The server: two unaccepted Inbox issues until one is accepted. */
let accepted: Set<string>;
let acceptAnswer: 'ok' | 'down';
/** The issue's version on the server; an accept must carry it (optimistic concurrency). */
const SERVER_VERSION = 7;
/** A held accept: the POST waits here until the test opens it. */
let acceptGate: Promise<void> | null;

const detailOf = (id: string) => ({
  id,
  projectId: 'p1',
  title: `t ${id}`,
  status: 'open',
  assignee: 'ann',
  acceptedAt: '2026-11-23T12:00:00Z',
  version: 8,
});

async function serverAnswer(url: string, init?: RequestInit): Promise<Response> {
  const accept = /^\/api\/v1\/issues\/([^/]+)\/accept$/.exec(url);
  if (accept && init?.method === 'POST') {
    await acceptGate;
    if (acceptAnswer === 'down') {
      return json({ error: 'internal', message: 'database unavailable' }, 500);
    }
    const { expectedVersion } = JSON.parse(String(init.body)) as { expectedVersion?: number };
    if (expectedVersion !== SERVER_VERSION) {
      return json({ error: 'version_conflict', message: 'stale version' }, 422);
    }
    accepted.add(decodeURIComponent(accept[1]));
    return json(detailOf(decodeURIComponent(accept[1])));
  }
  if (url === '/api/v1/me/notification-counts') {
    return json({ inbox: 2 - accepted.size, mentions: 0, watching: 0 });
  }
  if (url.startsWith('/api/v1/me/assigned-to?')) {
    // Inbox is «not accepted»: an accepted issue is no longer in the answer.
    const items = INBOX_IDS.filter((id) => !accepted.has(id)).map((id) => ({
      id, projectId: 'p1', title: `t ${id}`, status: 'open', assignee: 'ann', acceptedAt: null, version: 7,
    }));
    return json({ items, nextCursor: null, hasMore: false });
  }
  return json({ error: 'unexpected' }, 599);
}

const INBOX_IDS = ['sk-6', 'sk-7', 'sk-8'];

beforeEach(() => {
  accepted = new Set();
  acceptAnswer = 'ok';
  acceptGate = null;
  fetchSpy.mockReset();
  fetchSpy.mockImplementation((input, init) => serverAnswer(String(input), init));
  vi.stubGlobal('fetch', fetchSpy);
  vi.spyOn(toaster, 'success').mockImplementation(() => undefined as never);
  vi.spyOn(toaster, 'error').mockImplementation(() => undefined as never);
});

afterEach(() => {
  releaseAllAccepted();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const countReads = () =>
  fetchSpy.mock.calls.filter((c) => String(c[0]) === '/api/v1/me/notification-counts').length;

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const view = renderHook(() => ({ badge: useNotificationCounts(), accept: useAcceptIssue() }), { wrapper });
  return { qc, view };
}

describe('sk-1060 — the header counters after an accept', () => {
  test('an accepted issue leaves the Inbox badge', async () => {
    const { view } = mount();
    await waitFor(() => expect(view.result.current.badge.counts.inbox).toBe(2));

    await act(() => view.result.current.accept.mutateAsync({ id: 'sk-7', expectedVersion: 7 }));

    await waitFor(() => expect(view.result.current.badge.counts.inbox).toBe(1));
  });

  test('a refused accept re-reads the counters too', async () => {
    const { view } = mount();
    await waitFor(() => expect(view.result.current.badge.counts.inbox).toBe(2));
    const readsBefore = countReads();

    await act(async () => {
      await expect(
        view.result.current.accept.mutateAsync({ id: 'sk-7', expectedVersion: SERVER_VERSION - 1 }),
      ).rejects.toThrow();
    });

    await waitFor(() => expect(countReads()).toBe(readsBefore + 1));
    expect(view.result.current.badge.counts.inbox).toBe(2);
  });
});

/**
 * sk-1048.62 — what else an accept leaves behind (the hook's docblock): the
 * detail of the issue holds the server's answer (its `acceptedAt` and the new
 * version) without a fresh GET; the accept itself does not re-read Inbox (the
 * card staying in place through a re-read is `inboxAcceptedRetention.test.tsx`);
 * a refused accept puts the card back as it was and says why.
 */
describe('accepting from the Inbox column', () => {
  const ROUTE = '/inbox';

  function mountColumn() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const view = renderHook(() => ({ inbox: useInbox(ROUTE), accept: useAcceptIssue() }), { wrapper });
    return { qc, view };
  }

  const inboxReads = () =>
    fetchSpy.mock.calls.filter((c) => String(c[0]).startsWith('/api/v1/me/assigned-to?')).length;

  const cards = (view: ReturnType<typeof mountColumn>['view']) =>
    (view.result.current.inbox.data?.items ?? []).map((it) => [it.id, it.acceptedAt !== null] as const);

  test('the detail of the issue holds the server answer, under its own id', async () => {
    const { qc, view } = mountColumn();
    await waitFor(() => expect(cards(view)).toHaveLength(3));

    await act(() =>
      view.result.current.accept.mutateAsync({ id: 'sk-7', expectedVersion: 7, retainOnRoute: ROUTE }),
    );

    expect(qc.getQueryData(['issues', 'detail', 'sk-7'])).toMatchObject({
      id: 'sk-7',
      acceptedAt: '2026-11-23T12:00:00Z',
      version: 8,
    });
    expect(qc.getQueryData(['issues', 'detail', 'sk-6'])).toBeUndefined();
    expect(toaster.success).toHaveBeenCalledWith(expect.stringContaining('sk-7'));
  });

  test('an accept does not re-read Inbox itself', async () => {
    const { view } = mountColumn();
    await waitFor(() => expect(cards(view)).toHaveLength(3));
    const readsBefore = inboxReads();

    await act(() =>
      view.result.current.accept.mutateAsync({ id: 'sk-7', expectedVersion: 7, retainOnRoute: ROUTE }),
    );
    await waitFor(() => expect(view.result.current.accept.isSuccess).toBe(true));

    expect(inboxReads()).toBe(readsBefore);
    expect(cards(view)).toEqual([
      ['sk-6', false],
      ['sk-7', true],
      ['sk-8', false],
    ]);
  });

  test('accepting an issue the column does not show lays nothing into it', async () => {
    const { view } = mountColumn();
    await waitFor(() => expect(cards(view)).toHaveLength(3));

    await act(() =>
      view.result.current.accept.mutateAsync({ id: 'sk-99', expectedVersion: 7, retainOnRoute: ROUTE }),
    );
    await waitFor(() => expect(view.result.current.accept.isSuccess).toBe(true));

    expect(cards(view)).toEqual([
      ['sk-6', false],
      ['sk-7', false],
      ['sk-8', false],
    ]);
  });

  test('a server failure is said with the issue and the server reason', async () => {
    acceptAnswer = 'down';
    const { view } = mountColumn();
    await waitFor(() => expect(cards(view)).toHaveLength(3));

    await act(async () => {
      await expect(
        view.result.current.accept.mutateAsync({ id: 'sk-7', expectedVersion: 7, retainOnRoute: ROUTE }),
      ).rejects.toThrow();
    });
    await waitFor(() => expect(view.result.current.accept.isError).toBe(true));

    const shown = String(vi.mocked(toaster.error).mock.calls[0][0]);
    expect(shown).toContain('sk-7');
    expect(shown).toContain('database unavailable');
    expect(cards(view).map(([, acc]) => acc)).toEqual([false, false, false]);
  });

  test('a refused accept turns the card accepted at once, then back, and says why', async () => {
    const { view } = mountColumn();
    await waitFor(() => expect(cards(view)).toHaveLength(3));
    let open: () => void = () => {};
    acceptGate = new Promise<void>((resolve) => { open = resolve; });

    let settled: Promise<unknown> = Promise.resolve();
    act(() => {
      settled = view.result.current.accept
        .mutateAsync({ id: 'sk-7', expectedVersion: SERVER_VERSION - 1, retainOnRoute: ROUTE })
        .catch((e: unknown) => e);
    });
    // Before the server answers, the card is already shown accepted.
    await waitFor(() =>
      expect(cards(view)).toEqual([
        ['sk-6', false],
        ['sk-7', true],
        ['sk-8', false],
      ]),
    );

    open();
    await act(async () => {
      expect(await settled).toBeInstanceOf(Error);
    });
    // Observers get cache changes on a later task; the error state comes
    // after every cache write of this mutation.
    await waitFor(() => expect(view.result.current.accept.isError).toBe(true));

    expect(cards(view)).toEqual([
      ['sk-6', false],
      ['sk-7', false],
      ['sk-8', false],
    ]);
    expect(toaster.error).toHaveBeenCalledTimes(1);
    const shown = String(vi.mocked(toaster.error).mock.calls[0][0]);
    expect(shown).toContain('sk-7');
    expect(shown).toContain('stale version');
  });
});
