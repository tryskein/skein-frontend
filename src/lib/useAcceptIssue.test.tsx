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
import { useAcceptIssue } from './useAcceptIssue';
import { useNotificationCounts } from './useNotificationCounts';

const fetchSpy = vi.fn<typeof fetch>();

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** The server: two unaccepted Inbox issues until one is accepted. */
let accepted: Set<string>;
let acceptAnswer: 'ok' | 'conflict';

const detailOf = (id: string) => ({
  id,
  projectId: 'p1',
  title: `t ${id}`,
  status: 'open',
  assignee: 'ann',
  acceptedAt: '2026-11-23T12:00:00Z',
  version: 8,
});

function serverAnswer(url: string, init?: RequestInit): Response {
  const accept = /^\/api\/v1\/issues\/([^/]+)\/accept$/.exec(url);
  if (accept && init?.method === 'POST') {
    if (acceptAnswer === 'conflict') {
      return json({ error: 'version_conflict', message: 'stale version', code: 'version_conflict' }, 422);
    }
    accepted.add(decodeURIComponent(accept[1]));
    return json(detailOf(decodeURIComponent(accept[1])));
  }
  if (url === '/api/v1/me/notification-counts') {
    return json({ inbox: 2 - accepted.size, mentions: 0, watching: 0 });
  }
  return json({ error: 'unexpected' }, 599);
}

beforeEach(() => {
  accepted = new Set();
  acceptAnswer = 'ok';
  fetchSpy.mockReset();
  fetchSpy.mockImplementation(async (input, init) => serverAnswer(String(input), init));
  vi.stubGlobal('fetch', fetchSpy);
  vi.spyOn(toaster, 'success').mockImplementation(() => undefined as never);
  vi.spyOn(toaster, 'error').mockImplementation(() => undefined as never);
});

afterEach(() => {
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
    acceptAnswer = 'conflict';
    const { view } = mount();
    await waitFor(() => expect(view.result.current.badge.counts.inbox).toBe(2));
    const readsBefore = countReads();

    await act(async () => {
      await expect(
        view.result.current.accept.mutateAsync({ id: 'sk-7', expectedVersion: 7 }),
      ).rejects.toThrow();
    });

    await waitFor(() => expect(countReads()).toBe(readsBefore + 1));
    expect(view.result.current.badge.counts.inbox).toBe(2);
  });
});
