/**
 * sk-622.1 — coalescing of cache invalidations from live events.
 *
 * The reference is the sk-622.1 brief and the analysis of incident sk-609:
 *  - invalidations from events are applied in a wave no more often than once per window, the tail
 *    is applied for certain;
 *  - identical keys within a wave are invalidated once;
 *  - a wave does not abort a running read (`cancelRefetch: false`);
 *  - an event that arrived during a read started before it is not lost.
 *
 * What is observed is the number of `queryFn` calls and the abort signal that TanStack
 * passes to `queryFn`: these are what reach the server as requests and aborts.
 * Queries are made active through `QueryObserver` — the same way a
 * mounted screen holds them.
 */
import { InfiniteQueryObserver, QueryClient, QueryObserver } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  LIVE_INVALIDATION_WINDOW_MS,
  createLiveInvalidationBatcher,
  type LiveInvalidationBatcher,
} from './liveInvalidationBatcher';

const W = LIVE_INVALIDATION_WINDOW_MS;

interface Deferred {
  resolve: (v: unknown) => void;
  signal: AbortSignal;
}

let qc: QueryClient;
let batcher: LiveInvalidationBatcher;
const unsubscribers: Array<() => void> = [];

beforeEach(() => {
  vi.useFakeTimers();
  // `gcTime: Infinity` — TanStack is left with no garbage-collection timers of its own,
  // and `vi.getTimerCount()` sees only the coalescer's timers.
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  batcher = createLiveInvalidationBatcher(qc);
});

afterEach(() => {
  batcher.dispose();
  unsubscribers.splice(0).forEach((u) => u());
  qc.clear();
  vi.useRealTimers();
});

/** An active query that answers immediately. Returns the `queryFn` call counter. */
async function activeQuery(queryKey: unknown[]): Promise<{ calls: () => number }> {
  let n = 0;
  const obs = new QueryObserver(qc, {
    queryKey,
    queryFn: async () => {
      n += 1;
      return n;
    },
  });
  unsubscribers.push(obs.subscribe(() => {}));
  await vi.advanceTimersByTimeAsync(0);
  return { calls: () => n };
}

/**
 * An active query whose responses are given by the test. Each `queryFn` call puts its own
 * "response" and abort signal into `pending`.
 */
async function controlledQuery(queryKey: unknown[]): Promise<{ pending: Deferred[] }> {
  const pending: Deferred[] = [];
  const obs = new QueryObserver(qc, {
    queryKey,
    queryFn: ({ signal }) =>
      new Promise((resolve) => {
        pending.push({ resolve, signal });
      }),
  });
  unsubscribers.push(obs.subscribe(() => {}));
  await vi.advanceTimersByTimeAsync(0);
  return { pending };
}

const isWatching = (q: { queryKey: readonly unknown[] }) => q.queryKey[0] === 'watching';

describe('coalescing: a wave no more often than once per window', () => {
  test('N events per window — one refetch per key, and not before the end of the window', async () => {
    const counts = await activeQuery(['notification-counts']);
    const watching = await activeQuery(['watching', 'feed']);
    expect(counts.calls()).toBe(1);
    expect(watching.calls()).toBe(1);

    // Ten events in a row, each invalidating both keys — like the router
    // on every project event (by key and by predicate).
    for (let i = 0; i < 10; i += 1) {
      void batcher.invalidateQueries({ queryKey: ['notification-counts'] });
      void batcher.invalidateQueries({ predicate: isWatching });
      await vi.advanceTimersByTimeAsync(100);
    }
    // 1000 ms after the first event — the window is still open, no requests yet.
    expect(counts.calls()).toBe(1);
    expect(watching.calls()).toBe(1);

    await vi.advanceTimersByTimeAsync(W);
    expect(counts.calls()).toBe(2);
    expect(watching.calls()).toBe(2);
  });

  test('tail: an event after a wave is applied by the next wave, without a new event', async () => {
    const counts = await activeQuery(['notification-counts']);

    void batcher.invalidateQueries({ queryKey: ['notification-counts'] });
    await vi.advanceTimersByTimeAsync(W);
    expect(counts.calls()).toBe(2);

    // The last event of the series — silence after it.
    void batcher.invalidateQueries({ queryKey: ['notification-counts'] });
    await vi.advanceTimersByTimeAsync(W - 1);
    expect(counts.calls()).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(counts.calls()).toBe(3);
  });

  test('a continuous stream of events gives at most one wave per window', async () => {
    const counts = await activeQuery(['notification-counts']);

    // An event every 200 ms for 10 windows.
    const ticks = (10 * W) / 200;
    for (let i = 0; i < ticks; i += 1) {
      void batcher.invalidateQueries({ queryKey: ['notification-counts'] });
      await vi.advanceTimersByTimeAsync(200);
    }
    await vi.advanceTimersByTimeAsync(W);
    // The first request is the mount; after that no more than one per window (+ tail).
    expect(counts.calls() - 1).toBeLessThanOrEqual(11);
    expect(counts.calls() - 1).toBeGreaterThanOrEqual(10);
  });

  test('an inactive query is marked stale but not re-read', async () => {
    let n = 0;
    await qc.fetchQuery({ queryKey: ['watching', 'feed'], queryFn: async () => ++n });
    // Several events in a window — several invalidations of the same query.
    void batcher.invalidateQueries({ predicate: isWatching });
    void batcher.invalidateQueries({ predicate: isWatching });
    await vi.advanceTimersByTimeAsync(W);
    const q = qc.getQueryCache().find({ queryKey: ['watching', 'feed'] })!;
    expect(q.state.isInvalidated).toBe(true);
    expect(n).toBe(1);
  });

  test('refetchType of coalesced invalidations: the wider of the two is re-read', async () => {
    // An inactive query: 'active' does not re-read it, 'all' does.
    let inactive = 0;
    await qc.fetchQuery({ queryKey: ['inactive'], queryFn: async () => ++inactive });
    void batcher.invalidateQueries({ queryKey: ['inactive'], refetchType: 'active' });
    void batcher.invalidateQueries({ queryKey: ['inactive'], refetchType: 'all' });
    // Active: 'none' alone — only the mark; 'none' + 'active' — a re-read.
    const onlyNone = await activeQuery(['only-none']);
    const noneAndActive = await activeQuery(['none-and-active']);
    void batcher.invalidateQueries({ queryKey: ['only-none'], refetchType: 'none' });
    void batcher.invalidateQueries({ queryKey: ['none-and-active'], refetchType: 'none' });
    void batcher.invalidateQueries({ queryKey: ['none-and-active'], refetchType: 'active' });
    void batcher.invalidateQueries({ queryKey: ['active-and-none'], refetchType: 'active' });
    const activeAndNone = await activeQuery(['active-and-none']);
    void batcher.invalidateQueries({ queryKey: ['active-and-none'], refetchType: 'none' });

    // Inactive under 'none' + 'active' in any order — only the mark.
    let noneThenActive = 0;
    let activeThenNone = 0;
    await qc.fetchQuery({ queryKey: ['inactive-na'], queryFn: async () => ++noneThenActive });
    await qc.fetchQuery({ queryKey: ['inactive-an'], queryFn: async () => ++activeThenNone });
    void batcher.invalidateQueries({ queryKey: ['inactive-na'], refetchType: 'none' });
    void batcher.invalidateQueries({ queryKey: ['inactive-na'], refetchType: 'active' });
    void batcher.invalidateQueries({ queryKey: ['inactive-an'], refetchType: 'active' });
    void batcher.invalidateQueries({ queryKey: ['inactive-an'], refetchType: 'none' });

    await vi.advanceTimersByTimeAsync(W);
    expect(inactive).toBe(2);
    expect(noneThenActive).toBe(1);
    expect(activeThenNone).toBe(1);
    expect(onlyNone.calls()).toBe(1);
    expect(qc.getQueryCache().find({ queryKey: ['only-none'] })!.state.isInvalidated).toBe(true);
    expect(noneAndActive.calls()).toBe(2);
    expect(activeAndNone.calls()).toBe(2);
  });

  test('after a wave with no carry-overs the tab holds no timers', async () => {
    await activeQuery(['notification-counts']);
    void batcher.invalidateQueries({ queryKey: ['notification-counts'] });
    await vi.advanceTimersByTimeAsync(W);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('coalescing does not abort a running read and does not lose an event', () => {
  test('a wave during a read started before the event: the read is not cancelled, exactly one refetch after it', async () => {
    const { pending } = await controlledQuery(['notification-counts']);
    pending[0].resolve(0);
    await vi.advanceTimersByTimeAsync(0);

    // The screen re-read the query itself; the read takes long (database under load).
    void qc.refetchQueries({ queryKey: ['notification-counts'] });
    await vi.advanceTimersByTimeAsync(0);
    expect(pending).toHaveLength(2);

    // An event arrives during the read.
    void batcher.invalidateQueries({ queryKey: ['notification-counts'] });
    await vi.advanceTimersByTimeAsync(W);
    // The running read is not aborted and there is no second request next to it.
    expect(pending[1].signal.aborted).toBe(false);
    expect(pending).toHaveLength(2);

    // The read ended with a response that knows nothing about the event.
    pending[1].resolve(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(pending).toHaveLength(2);

    // The next wave catches up with the event — without a new event.
    await vi.advanceTimersByTimeAsync(W);
    expect(pending).toHaveLength(3);
    expect(pending[2].signal.aborted).toBe(false);
  });

  test('a read started AFTER the event already contains it: the wave leaves the query alone', async () => {
    const counts = await activeQuery(['notification-counts']);

    void batcher.invalidateQueries({ queryKey: ['notification-counts'] });
    await vi.advanceTimersByTimeAsync(100);
    // The screen re-read the query after the event (mutation, focus, polling).
    await qc.refetchQueries({ queryKey: ['notification-counts'] });
    expect(counts.calls()).toBe(2);

    await vi.advanceTimersByTimeAsync(W);
    expect(counts.calls()).toBe(2);
  });

  test('a read started after the event and failed does not cover the event', async () => {
    let n = 0;
    let fail = false;
    const obs = new QueryObserver(qc, {
      queryKey: ['notification-counts'],
      queryFn: async () => {
        n += 1;
        if (fail) throw new Error('boom');
        return n;
      },
    });
    unsubscribers.push(obs.subscribe(() => {}));
    await vi.advanceTimersByTimeAsync(0);

    void batcher.invalidateQueries({ queryKey: ['notification-counts'] });
    fail = true;
    await qc.refetchQueries({ queryKey: ['notification-counts'] });
    fail = false;
    expect(n).toBe(2);

    await vi.advanceTimersByTimeAsync(W);
    expect(n).toBe(3);
  });

  test('an event that arrived during a read started after the PREVIOUS event is not lost', async () => {
    const { pending } = await controlledQuery(['notification-counts']);
    pending[0].resolve(0);
    await vi.advanceTimersByTimeAsync(0);

    void batcher.invalidateQueries({ queryKey: ['notification-counts'] });
    // The screen re-read the query after the first event; the read is running.
    void qc.refetchQueries({ queryKey: ['notification-counts'] });
    await vi.advanceTimersByTimeAsync(0);
    expect(pending).toHaveLength(2);
    // The second event arrives during that very read.
    void batcher.invalidateQueries({ queryKey: ['notification-counts'] });

    await vi.advanceTimersByTimeAsync(W);
    pending[1].resolve(1);
    await vi.advanceTimersByTimeAsync(W);
    // The read covered the first event but not the second: one more request is needed.
    expect(pending).toHaveLength(3);
  });

  test('the first read of a new query, started after the event, covers it', async () => {
    void batcher.invalidateQueries({ predicate: isWatching });
    // The screen mounted after the event; its first read takes long.
    const { pending } = await controlledQuery(['watching', 'feed']);
    expect(pending).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(W);
    pending[0].resolve([]);
    await vi.advanceTimersByTimeAsync(W * 2);
    expect(pending).toHaveLength(1);
  });

  test('a read started after the event and failed only AFTER the wave does not cover the event', async () => {
    void batcher.invalidateQueries({ predicate: isWatching });
    let calls = 0;
    const rejecters: Array<(e: Error) => void> = [];
    const obs = new QueryObserver(qc, {
      queryKey: ['watching', 'feed'],
      queryFn: () => {
        calls += 1;
        if (calls === 1) return new Promise((_, reject) => { rejecters.push(reject); });
        return Promise.resolve([]);
      },
    });
    unsubscribers.push(obs.subscribe(() => {}));
    await vi.advanceTimersByTimeAsync(0);

    // The wave finds the first read in flight; it fails after the wave.
    await vi.advanceTimersByTimeAsync(W);
    expect(calls).toBe(1);
    rejecters[0](new Error('boom'));
    await vi.advanceTimersByTimeAsync(W);
    expect(calls).toBe(2);
  });

  test('a re-read with data, started after the event and failed after the wave, does not cover the event', async () => {
    // The test supplies the responses: success is `resolve`, failure is `reject` (this is how
    // the endpoint behaves under an overloaded database: 504 after a long wait).
    const reads: Array<{ resolve: (v: unknown) => void; reject: (e: Error) => void }> = [];
    const obs = new QueryObserver(qc, {
      queryKey: ['notification-counts'],
      queryFn: () => new Promise((resolve, reject) => { reads.push({ resolve, reject }); }),
    });
    unsubscribers.push(obs.subscribe(() => {}));
    await vi.advanceTimersByTimeAsync(0);
    reads[0].resolve(0);
    await vi.advanceTimersByTimeAsync(0);

    void batcher.invalidateQueries({ queryKey: ['notification-counts'] });
    void qc.refetchQueries({ queryKey: ['notification-counts'] });
    await vi.advanceTimersByTimeAsync(W);
    expect(reads).toHaveLength(2);

    reads[1].reject(new Error('504'));
    await vi.advanceTimersByTimeAsync(W);
    // The failed read did not deliver the change — the wave re-reads the query.
    expect(reads).toHaveLength(3);
  });

  test('a re-read after the event, cancelled with a rollback to the old response, does not cover the event', async () => {
    // The sk-622.1 review scenario (codex): a fresh response in the cache; an event;
    // the screen starts a re-read (the request takes `signal`); the last
    // observer leaves before the response — TanStack cancels the read and ROLLS BACK
    // the state to the old successful response. There was no response after the event,
    // and a screen mounted again must read anew.
    const reads: Array<{ resolve: (v: unknown) => void; signal: AbortSignal }> = [];
    const options = {
      queryKey: ['watching', 'feed'],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        new Promise((resolve) => { reads.push({ resolve, signal }); }),
    };
    const first = new QueryObserver(qc, options);
    const unsubscribeFirst = first.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    reads[0].resolve('OLD');
    await vi.advanceTimersByTimeAsync(0);

    void batcher.invalidateQueries({ predicate: isWatching });
    void qc.refetchQueries({ queryKey: ['watching', 'feed'] });
    await vi.advanceTimersByTimeAsync(0);
    expect(reads).toHaveLength(2);
    unsubscribeFirst();
    await vi.advanceTimersByTimeAsync(0);
    expect(reads[1].signal.aborted).toBe(true);

    await vi.advanceTimersByTimeAsync(W);
    const again = new QueryObserver(qc, options);
    unsubscribers.push(again.subscribe(() => {}));
    await vi.advanceTimersByTimeAsync(0);
    expect(reads).toHaveLength(3);
  });

  test('setQueryData after a failed re-read does not count as delivery', async () => {
    // A failed read started after the event, then an optimistic edit
    // of the cache (`setQueryData`, `manual: true`): there was still no server response
    // after the event, and the wave must re-read.
    let n = 0;
    let fail = false;
    const obs = new QueryObserver(qc, {
      queryKey: ['notification-counts'],
      queryFn: async () => {
        n += 1;
        if (fail) throw new Error('504');
        return n;
      },
    });
    unsubscribers.push(obs.subscribe(() => {}));
    await vi.advanceTimersByTimeAsync(0);

    void batcher.invalidateQueries({ queryKey: ['notification-counts'] });
    fail = true;
    await qc.refetchQueries({ queryKey: ['notification-counts'] });
    fail = false;
    qc.setQueryData(['notification-counts'], 42);
    expect(n).toBe(2);

    await vi.advanceTimersByTimeAsync(W);
    expect(n).toBe(3);
  });

  test('a carried-over query removed from the cache mid-read without signal does not wake the tab', async () => {
    // The read does not take `signal`: removal from the cache cancels it "silently", and
    // the query state stays `fetching` (TanStack 5.100, review
    // sk-622.1, claude). Carrying such a query over would go on forever.
    const resolvers: Array<(v: unknown) => void> = [];
    const obs = new QueryObserver(qc, {
      queryKey: ['notification-counts'],
      queryFn: () => new Promise((resolve) => { resolvers.push(resolve); }),
    });
    unsubscribers.push(obs.subscribe(() => {}));
    await vi.advanceTimersByTimeAsync(0);

    void batcher.invalidateQueries({ queryKey: ['notification-counts'] });
    await vi.advanceTimersByTimeAsync(W);
    // A read started before the event is running — the query is carried over.
    expect(resolvers).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(1);

    qc.removeQueries({ queryKey: ['notification-counts'] });
    await vi.advanceTimersByTimeAsync(W);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('a carried-over query that left the cache does not wake the tab', async () => {
    const { pending } = await controlledQuery(['notification-counts']);
    void batcher.invalidateQueries({ queryKey: ['notification-counts'] });
    await vi.advanceTimersByTimeAsync(W);
    // A read started before the event is still running — the query is carried over.
    expect(pending).toHaveLength(1);
    unsubscribers.splice(0).forEach((u) => u());
    qc.removeQueries({ queryKey: ['notification-counts'] });

    await vi.advanceTimersByTimeAsync(W);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('dispose drops the accumulated work and the subscription: no waves after it', async () => {
    const counts = await activeQuery(['notification-counts']);
    void batcher.invalidateQueries({ queryKey: ['notification-counts'] });
    batcher.dispose();
    expect(qc.getQueryCache().hasListeners()).toBe(false);
    await vi.advanceTimersByTimeAsync(W * 2);
    // A late call after dispose (an event in flight at disconnect).
    void batcher.invalidateQueries({ queryKey: ['notification-counts'] });
    await vi.advanceTimersByTimeAsync(W * 2);
    expect(counts.calls()).toBe(1);
  });
});

// ─────────── sk-622.21 K21 / K22 — first page and hidden tab ───────────
//
// The reference is plan sk-622.21 K21 (a list is re-read "from the first page"
// only on demand, otherwise all loaded pages) and K22 (a hidden
// tab sends no requests: what is hit is an obligation, an inactive query is only
// marked; `resume` applies the obligations at once; `dispose` — accumulated work
// is not applied), spec US-13/US-14.

/** An active infinite query with two loaded pages; `params` — the parameters of each page read. */
async function twoPageList(queryKey: unknown[]): Promise<{ params: unknown[]; pages: () => number }> {
  const params: unknown[] = [];
  const obs = new InfiniteQueryObserver<number, Error, { pages: number[] }, unknown[], number>(qc, {
    queryKey,
    queryFn: async ({ pageParam }) => {
      params.push(pageParam);
      return pageParam;
    },
    initialPageParam: 0,
    getNextPageParam: (last) => (last < 1 ? last + 1 : undefined),
  });
  unsubscribers.push(obs.subscribe(() => {}));
  await vi.advanceTimersByTimeAsync(0);
  await obs.fetchNextPage();
  params.splice(0);
  return {
    params,
    pages: () => (qc.getQueryData<{ pages: number[] }>(queryKey)?.pages.length ?? 0),
  };
}

/** A coalescer with a controllable hidden-tab flag. */
function hiddenAwareBatcher(): { b: LiveInvalidationBatcher; setHidden: (v: boolean) => void } {
  let hidden = false;
  const b = createLiveInvalidationBatcher(qc, W, () => hidden);
  unsubscribers.push(() => b.dispose());
  return { b, setHidden: (v) => { hidden = v; } };
}

describe('K21 — "first page only" does not spread to neighbouring invalidations', () => {
  test('two ordinary invalidations of one list in one wave re-read all loaded pages', async () => {
    const list = await twoPageList(['projects', 'list', 'shell', 'infinite']);
    void batcher.invalidateQueries({ queryKey: ['projects'] });
    void batcher.invalidateQueries({ queryKey: ['projects', 'list'] });
    await vi.advanceTimersByTimeAsync(W);
    expect(list.params).toEqual([0, 1]);
  });

  test('"first page" for a list whose first read failed without a response: the wave goes through and re-reads it', async () => {
    let n = 0;
    const obs = new InfiniteQueryObserver<number, Error, { pages: number[] }, unknown[], number>(qc, {
      queryKey: ['tasks', 'failed'],
      queryFn: async () => {
        n += 1;
        if (n === 1) throw new Error('down');
        return 0;
      },
      initialPageParam: 0,
      getNextPageParam: () => undefined,
    });
    unsubscribers.push(obs.subscribe(() => {}));
    await vi.advanceTimersByTimeAsync(0);
    expect(qc.getQueryData(['tasks', 'failed'])).toBeUndefined();

    void batcher.invalidateQueries({ queryKey: ['tasks', 'failed'], firstPageOnly: true });
    await vi.advanceTimersByTimeAsync(W);
    expect(n).toBe(2);
  });
});

describe('K22 — hidden tab: obligations, marks, return', () => {
  test('a "first page" obligation and an ordinary one in different hidden waves: on return — one first page', async () => {
    const { b, setHidden } = hiddenAwareBatcher();
    const list = await twoPageList(['tasks', 'p']);
    setHidden(true);
    void b.invalidateQueries({ queryKey: ['tasks', 'p'], firstPageOnly: true });
    await vi.advanceTimersByTimeAsync(W);
    void b.invalidateQueries({ queryKey: ['tasks', 'p'] });
    await vi.advanceTimersByTimeAsync(W);
    expect(list.params).toEqual([]);

    setHidden(false);
    b.resume();
    await vi.advanceTimersByTimeAsync(0);
    expect(list.params).toEqual([0]);
    expect(list.pages()).toBe(1);
  });

  test('two ordinary obligations in different hidden waves: on return — all loaded pages', async () => {
    const { b, setHidden } = hiddenAwareBatcher();
    const list = await twoPageList(['projects', 'list', 'shell', 'infinite']);
    setHidden(true);
    void b.invalidateQueries({ queryKey: ['projects'] });
    await vi.advanceTimersByTimeAsync(W);
    void b.invalidateQueries({ queryKey: ['projects'] });
    await vi.advanceTimersByTimeAsync(W);

    setHidden(false);
    b.resume();
    await vi.advanceTimersByTimeAsync(0);
    expect(list.params).toEqual([0, 1]);
  });

  test('a hit active query in a hidden tab stays fresh: a new observer does not read it', async () => {
    const { b, setHidden } = hiddenAwareBatcher();
    const counts = await activeQuery(['notification-counts']);
    setHidden(true);
    void b.invalidateQueries({ queryKey: ['notification-counts'] });
    await vi.advanceTimersByTimeAsync(W);

    // The screen mounted one more reader of the same key while the tab is hidden.
    let secondCalls = 0;
    const second = new QueryObserver(qc, {
      queryKey: ['notification-counts'],
      queryFn: async () => ++secondCalls,
      staleTime: Infinity,
    });
    unsubscribers.push(second.subscribe(() => {}));
    await vi.advanceTimersByTimeAsync(0);
    expect(counts.calls() + secondCalls).toBe(1);
  });

  test('a hit inactive query in a hidden tab is marked stale and not read', async () => {
    const { b, setHidden } = hiddenAwareBatcher();
    let n = 0;
    await qc.fetchQuery({ queryKey: ['watching', 'feed'], queryFn: async () => ++n });
    setHidden(true);
    void b.invalidateQueries({ queryKey: ['watching', 'feed'] });
    await vi.advanceTimersByTimeAsync(W);
    expect(n).toBe(1);
    expect(qc.getQueryCache().find({ queryKey: ['watching', 'feed'] })!.state.isInvalidated).toBe(true);
  });

  test('the obligation of a query that left the cache does not put it back into the cache on return', async () => {
    const { b, setHidden } = hiddenAwareBatcher();
    await twoPageList(['tasks', 'gone']);
    setHidden(true);
    void b.invalidateQueries({ queryKey: ['tasks', 'gone'], firstPageOnly: true });
    await vi.advanceTimersByTimeAsync(W);
    unsubscribers.splice(1).forEach((u) => u());
    qc.removeQueries({ queryKey: ['tasks', 'gone'] });

    setHidden(false);
    b.resume();
    await vi.advanceTimersByTimeAsync(0);
    expect(qc.getQueryCache().find({ queryKey: ['tasks', 'gone'] })).toBeUndefined();
  });

  test('resume after dispose does not apply the accumulated work', async () => {
    const counts = await activeQuery(['notification-counts']);
    void batcher.invalidateQueries({ queryKey: ['notification-counts'] });
    batcher.dispose();
    batcher.resume();
    await vi.advanceTimersByTimeAsync(W * 2);
    expect(counts.calls()).toBe(1);
  });

  test('resume drops the waiting window: an event after it waits a whole window', async () => {
    const counts = await activeQuery(['notification-counts']);
    void batcher.invalidateQueries({ queryKey: ['notification-counts'] });
    await vi.advanceTimersByTimeAsync(W / 2);
    batcher.resume();
    await vi.advanceTimersByTimeAsync(0);
    expect(counts.calls()).toBe(2);

    void batcher.invalidateQueries({ queryKey: ['notification-counts'] });
    // The previous window would have ended here; the new one — only W after the event.
    await vi.advanceTimersByTimeAsync(W - 10);
    expect(counts.calls()).toBe(2);
    await vi.advanceTimersByTimeAsync(20);
    expect(counts.calls()).toBe(3);
  });
});
