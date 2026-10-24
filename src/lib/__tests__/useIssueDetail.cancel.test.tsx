/**
 * sk-421.1 T016 — rows 53, 55, 63: cancelling the issue-detail
 * read, end to end «hook → API → network».
 *
 * Harness (shared by the three rows):
 *   - the REAL `getIssue` runs over a cancel-aware `fetch` stub: a detail
 *     request stays open until the test answers it, and rejects with an
 *     `AbortError` the moment its signal aborts;
 *   - the detail request is picked by its FULL path
 *     `/api/v1/projects/{pid}/issues/{id}` — the hook's other reads
 *     (comments, attachments, dependencies, watchers, activity) extend that
 *     path, go to the same stub, are answered at once with empty bodies and
 *     are not counted;
 *   - `toast.error` is ONE module-level spy read lazily inside the mock, so
 *     «no toast» is checkable (a `vi.fn()` created per hook call is not).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('../../components/Toaster', () => ({
  useToaster: () => toast,
}));

import { issueDetailKey, useIssueDetail } from '../useIssueDetail';

const PID = 'proj-cancel';
const ID = 'sk-77';
const DETAIL_PATH = `/api/v1/projects/${PID}/issues/${ID}`;

interface DetailRequest {
  signal: AbortSignal | undefined;
  settled: boolean;
  respond: (body: unknown) => void;
}

let detailRequests: DetailRequest[] = [];

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/** Empty but well-shaped bodies for the hook's side reads. */
function sideReadBody(url: string): unknown {
  if (url.includes('/attachments')) return { items: [] };
  if (url.includes('/dependencies')) return { outgoing: [], incoming: [] };
  if (url.includes('/activity')) return { items: [], nextCursor: null };
  return [];
}

function detail(title: string) {
  return {
    id: ID,
    projectId: PID,
    version: 1,
    title,
    description: '',
    type: 'task',
    priority: 2,
    status: 'open',
    pinned: false,
    source: 'human',
    design: '',
    acceptanceCriteria: '',
    notes: '',
    createdBy: 'u-1',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    metadata: {},
    componentIds: [],
    labels: [],
    commentsCount: 0,
    commitRefs: [],
    mentions: [],
    isBlocked: false,
    blockers: [],
  };
}

beforeEach(() => {
  detailRequests = [];
  toast.error.mockReset();
  toast.success.mockReset();
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url !== DETAIL_PATH) {
        return Promise.resolve(jsonResponse(sideReadBody(url)));
      }
      return new Promise<Response>((resolve, reject) => {
        const signal = init?.signal ?? undefined;
        const request: DetailRequest = {
          signal,
          settled: false,
          respond: (body) => {
            if (request.settled) return;
            request.settled = true;
            resolve(jsonResponse(body));
          },
        };
        detailRequests.push(request);
        signal?.addEventListener('abort', () => {
          if (request.settled) return;
          request.settled = true;
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function newClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function wrapperFor(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

/** Detail requests still open (neither answered nor aborted). */
function inFlight(): number {
  return detailRequests.filter((r) => !r.settled).length;
}

function mountHook(qc: QueryClient) {
  return renderHook(() => useIssueDetail({ issueId: ID, projectHandle: PID }), {
    wrapper: wrapperFor(qc),
  });
}

// ─────────────── row 53 — refetch of a SHOWN detail ───────────────

describe('refetch of a shown detail: a newer event cancels the running read on the wire (row 53)', () => {
  test('two resets in a row → the first refetch request is aborted, one in flight, the last answer shown', async () => {
    const qc = newClient();
    const { result } = mountHook(qc);

    // First load, answered: the detail is on screen.
    await waitFor(() => expect(detailRequests.length).toBe(1));
    act(() => detailRequests[0].respond(detail('original')));
    await waitFor(() => expect(result.current.issue?.title).toBe('original'));

    // Event 1 → refetch starts.
    act(() => {
      void qc.invalidateQueries({ queryKey: issueDetailKey(ID) });
    });
    await waitFor(() => expect(detailRequests.length).toBe(2));
    expect(inFlight()).toBe(1);

    // Event 2 while that refetch runs → it is cancelled ON THE WIRE.
    act(() => {
      void qc.invalidateQueries({ queryKey: issueDetailKey(ID) });
    });
    await waitFor(() => expect(detailRequests.length).toBe(3));
    expect(detailRequests[1].signal?.aborted).toBe(true);
    expect(inFlight()).toBe(1);

    // The last read answers with the change: it is what the card shows.
    act(() => detailRequests[2].respond(detail('changed')));
    await waitFor(() => expect(result.current.issue?.title).toBe('changed'));
    expect(result.current.isError).toBe(false);
    expect(toast.error).not.toHaveBeenCalled();
  });
});

// ─────────────── row 55 — event during the FIRST load ───────────────

describe('event during the FIRST load joins it — the accepted limit of the method (row 55)', () => {
  test('a reset during the first load starts no second read; the load answer is shown', async () => {
    const qc = newClient();
    const { result } = mountHook(qc);

    await waitFor(() => expect(detailRequests.length).toBe(1));
    expect(result.current.issue).toBeUndefined();

    // The event lands while the detail is not in the cache yet.
    act(() => {
      void qc.invalidateQueries({ queryKey: issueDetailKey(ID) });
    });

    // No second request; the running load is not cancelled — it is still
    // open. Checked on the request itself, not on its signal: this row is
    // a characterizing guard of the method's limit and must not depend on
    // how (or whether) the signal is wired.
    await act(async () => {
      await Promise.resolve();
    });
    expect(detailRequests.length).toBe(1);
    expect(detailRequests[0].settled).toBe(false);

    // Its answer (without the change) is what the card shows.
    act(() => detailRequests[0].respond(detail('as loaded')));
    await waitFor(() => expect(result.current.issue?.title).toBe('as loaded'));
    expect(detailRequests.length).toBe(1);
    expect(result.current.isError).toBe(false);
  });
});

// ─────────────── row 63 — last observer leaves during the load ───────────────

describe('closing the card during the load aborts the request; reopening reads again (row 63)', () => {
  test('unmount mid-load → detail request aborted; remount → a new detail request; no error, no toast', async () => {
    const qc = newClient();
    const first = mountHook(qc);

    await waitFor(() => expect(detailRequests.length).toBe(1));
    expect(detailRequests[0].signal).toBeDefined();

    // The card closes before the detail answers.
    first.unmount();
    await waitFor(() => expect(detailRequests[0].signal?.aborted).toBe(true));

    // Reopened: a NEW detail request goes out (only the detail path counts).
    const second = mountHook(qc);
    await waitFor(() => expect(detailRequests.length).toBe(2));
    act(() => detailRequests[1].respond(detail('reopened')));
    await waitFor(() => expect(second.result.current.issue?.title).toBe('reopened'));

    expect(second.result.current.isError).toBe(false);
    expect(toast.error).not.toHaveBeenCalled();
    second.unmount();
  });
});
