/**
 * sk-622.1 — coalescing of cache invalidations from live SignalR events.
 *
 * ─── What failure this closes ──────────────────────────────────────
 *
 * The live-event router (`liveEventInvalidation.ts`) called `invalidateQueries`
 * on about ten keys for every project event, and did so
 * immediately. TanStack Query defaults to `cancelRefetch: true`: a new invalidation
 * ABORTS the running read and starts a new one. Agents produce dozens of events a
 * minute, every open tab refetched that many times, and an aborted
 * request still managed to eat the database CPU on the server. On 2026-10-07 this twice took
 * production down (sk-609, epic sk-622).
 *
 * ─── What the coalescing does ──────────────────────────────────────
 *
 *  1. Invalidations ACCUMULATE instead of being applied. The first event after a lull
 *     starts a timer for {@link LIVE_INVALIDATION_WINDOW_MS}; everything that arrived
 *     before it fires is applied in ONE wave. So there is at most one wave
 *     per window — at any event rate.
 *  2. Within a wave, an invalidation is counted per cache QUERY, not per filter: ten
 *     events that hit `['notification-counts']` give one invalidation of that
 *     query. Predicate filters cannot be compared, so deduplication
 *     goes by what they landed on.
 *  3. The wave is applied with `cancelRefetch: false` — a running read is brought
 *     to the end instead of being aborted.
 *  4. The tail is not lost. The price of `cancelRefetch: false` is known (see
 *     `tasksColumnTreeClock.ts`): a read started BEFORE the event and running at
 *     the moment of invalidation clears the stale mark with its success, and the event
 *     is swallowed. So a query that, at the moment of the wave, is still reading
 *     a response started before the event is not invalidated now but
 *     CARRIED OVER to the next wave — and invalidated when the read
 *     ends. While there are carry-overs, waves keep running without new
 *     events.
 *  5. There is no extra reading either: if, after the LATEST of the events that hit the
 *     query, a read attempt STARTED and DELIVERED a response (the screen itself,
 *     a mutation or polling re-read it) — the change is already in it, and the wave
 *     leaves it alone. A failed, cancelled (including with a rollback to the old
 *     response) and still running attempt does not count as delivery. "Earlier / later"
 *     is compared not by clocks but by a shared ordering counter: an event and the
 *     start of a read within one millisecond would otherwise be indistinguishable.
 *
 * ─── Why a 1500 ms window ──────────────────────────────────────────
 *
 * The brief asks for 1–2 s. The lower bound is what to coalesce: the outbox dispatcher in
 * skein-api publishes in a batch every 250 ms (`internal/outbox/dispatcher.go#
 * defaultPollInterval`), and one agent write — a close, creating an epic with
 * children, `close_many` — yields several events spread over several
 * such ticks, plus a separate notification envelope. 1500 ms covers six
 * ticks, that is, a typical write entirely; a 1 s window would cut it into two
 * waves more often. The upper bound is latency: a single event reaches the
 * screen no later than one window, and 1.5 s still reads as a "live"
 * update (the epic section e2e waits up to 15 s — a tenfold margin). The brief does not allow more than
 * 2 s.
 *
 * ─── What the coalescing does not touch ────────────────────────────
 *
 * The epic section and column tree clocks (`epicSectionClock.ts`,
 * `tasksColumnTreeClock.ts`) are advanced by the router at the moment the event ARRIVES,
 * as before: the real `getQueryCache()` is passed, without delay. The clocks
 * therefore show the moment of the event, not of the wave, and their consumers judge
 * the freshness of a response more precisely, not more coarsely.
 *
 * ─── Boundaries left deliberately ──────────────────────────────────
 *
 *   • A carried-over query wakes the tab once per window until its read
 *     ends — including a read paused offline (`paused`)
 *     or hanging without a timeout. This does not touch the network or the server: the wave only
 *     iterates over the carried-over queries. A query that left the cache drops out of the carry-over —
 *     otherwise its frozen "reading" state (removal with a `queryFn` without
 *     `signal`) would wake the tab forever.
 *   • Filters are evaluated at the moment of the WAVE, not of the event. A predicate that reads
 *     query data (`liveEventInvalidation.ts#treeShowsAny`) looks at
 *     it 0–1500 ms after the event; if `setQueryData` changed the data
 *     in between, the invalidation may miss a query that matched
 *     at the moment of the event. The window is narrow; data changed by a read after
 *     the event is covered by the event anyway.
 *   • `refetchType` defaults to `'active'`; `filters.type` is not taken into account
 *     when choosing the refetch (in TanStack it is `refetchType ?? type ??
 *     'active'`). Today no call on the live path passes `type`.
 */

import type {
  InvalidateOptions,
  InvalidateQueryFilters,
  Query,
  QueryCache,
  QueryClient,
} from '@tanstack/react-query';

/** Coalescing window, ms. The rationale for the value is in the module header. */
export const LIVE_INVALIDATION_WINDOW_MS = 1500;

/**
 * Filters of the live-path invalidation. On top of the TanStack filters — one flag:
 *
 * `firstPageOnly` — sk-622.21 K21 ("re-read from the first page", US-15,
 * reaction matrix K18: "first page of `['tasks', …]`"). For an infinite
 * query the wave, before invalidating, leaves only the first page and
 * its `pageParam` in the data (`setQueryData`), and the refetch goes one page:
 * `refetch` of an infinite query in TanStack v5 re-reads ALL loaded
 * pages in a row, and `resetQueries` would give an empty screen. The trim is done at the
 * moment of the wave, not of the event: only queries without a running
 * read get into the wave (running ones are carried over), so the trimmed data will not overwrite the response of
 * a read started before the trim. A query hit in one wave by both an invalidation with the
 * flag and one without it is re-read from the first page: the flag is stronger
 * — the re-read first page shows what an ordinary invalidation would give too,
 * and the distant pages are loaded by scrolling.
 *
 * A real `QueryClient` does not know the flag and silently ignores it (an ordinary
 * invalidation of all pages) — this is how the router is called by its tests.
 */
export interface LiveInvalidateFilters extends InvalidateQueryFilters {
  firstPageOnly?: boolean;
}

/**
 * What the live-event router uses of the client. A real
 * `QueryClient` satisfies this interface — the router is called with it by
 * tests; the coalescer substitutes itself.
 */
export interface LiveInvalidationTarget {
  invalidateQueries(
    filters?: LiveInvalidateFilters,
    options?: InvalidateOptions,
  ): Promise<void>;
  getQueryCache(): QueryCache;
}

export interface LiveInvalidationBatcher extends LiveInvalidationTarget {
  /**
   * sk-622.21 K22 — the tab is visible again: settle the refetch obligations
   * accumulated while it was hidden, and everything waiting for a wave, — now, without
   * waiting for the window. What is covered by a delivered read is dropped, a running read
   * is carried over to its end, the other active queries are re-read
   * once each. While the tab is hidden, the call does nothing.
   */
  resume(): void;
  /** Remove the timer and the subscription. Accumulated work is not applied: the tab is leaving. */
  dispose(): void;
}

/** Whether the tab is hidden (`document.hidden`); outside the browser — no. */
export function documentHidden(): boolean {
  return typeof document !== 'undefined' && document.hidden === true;
}

type RefetchType = NonNullable<InvalidateQueryFilters['refetchType']>;

interface PendingFilter {
  filters: LiveInvalidateFilters;
  /** Ordering number of the receipt of the event that invalidated these filters. */
  seq: number;
}

interface DueQuery {
  /** Ordering number of the LATEST event that hit the query. */
  seq: number;
  refetchType: RefetchType;
  /** K21: before invalidating, leave only the first page. */
  firstPageOnly: boolean;
}

/** Data of a TanStack infinite query: pages and their parameters. */
interface InfiniteDataShape {
  pages: unknown[];
  pageParams: unknown[];
}

function isInfiniteData(data: unknown): data is InfiniteDataShape {
  return (
    typeof data === 'object'
    && data !== null
    && Array.isArray((data as InfiniteDataShape).pages)
    && Array.isArray((data as InfiniteDataShape).pageParams)
  );
}

/**
 * Merge two refetch requirements for one query. The stale mark
 * is always set; the wider refetch of the two wins — `'all'`
 * covers both active and inactive, `'none'` yields to any.
 */
function mergeRefetchType(a: RefetchType, b: RefetchType): RefetchType {
  if (a === b) return a;
  if (a === 'none') return b;
  if (b === 'none') return a;
  return 'all';
}

/**
 * Create the coalescer on top of `qc`. One per SignalR connection (`useLiveEvents`).
 */
export function createLiveInvalidationBatcher(
  qc: QueryClient,
  windowMs: number = LIVE_INVALIDATION_WINDOW_MS,
  isHidden: () => boolean = documentHidden,
): LiveInvalidationBatcher {
  const cache = qc.getQueryCache();

  // Shared ordering counter: event received → a number; query read
  // started → a number. Comparing the numbers answers "did a read start after
  // the event" without relying on clock resolution. Numbers do not repeat.
  let seq = 0;
  // The number of the start of a running (or last) read attempt of the query.
  const fetchStartedSeq = new WeakMap<Query, number>();
  // The number of the start of the last read attempt that DELIVERED a response.
  //
  // Review sk-622.1 (codex): delivery cannot be judged by the current state of the
  // query. A cancelled read (the last observer left, and `queryFn` took
  // `signal`) is rolled back by TanStack to the previous successful response: `status`
  // is `success` again, `fetchStatus` is `idle`, and the start number is already from the
  // cancelled attempt. So delivery is recorded separately — by the `success`
  // action of the read itself. `setQueryData` dispatches the same `success`, but with
  // `manual: true`; that is not a server response to a read and does not count as delivery.
  const deliveredSeq = new WeakMap<Query, number>();
  const unsubscribe = cache.subscribe((e) => {
    if (e.type !== 'updated') return;
    if (e.action.type === 'fetch') {
      fetchStartedSeq.set(e.query, ++seq);
    } else if (e.action.type === 'success' && e.action.manual !== true) {
      deliveredSeq.set(e.query, fetchStartedSeq.get(e.query) ?? 0);
    }
  });

  let pending: PendingFilter[] = [];
  // Queries that in the previous wave were still reading a response started before the event.
  let carried = new Map<Query, DueQuery>();
  // sk-622.21 K22 — refetch obligations of a hidden tab: query →
  // the number of the LATEST event that hit it (the same numbering as in
  // `readCoversEvent`). Cleared only by a read started after the event and
  // delivering a response; TanStack's `isInvalidated` flag is not the source of
  // truth — the success of a read started BEFORE the event resets it.
  let obligations = new Map<Query, DueQuery>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const schedule = (): void => {
    if (timer !== null || disposed) return;
    timer = setTimeout(flush, windowMs);
  };

  /**
   * Whether the event `eventSeq` is covered: whether there was a read attempt started AFTER
   * it that delivered a response. A failed, cancelled (including with a rollback to
   * the old response) and still running read did not deliver the change and does not
   * cover the event; a running one is carried over and checked when it ends.
   */
  const readCoversEvent = (q: Query, eventSeq: number): boolean =>
    // 0 — there have been no deliveries since the coalescer was created; event numbers
    // start at 1, so such a read covers nothing.
    (deliveredSeq.get(q) ?? 0) > eventSeq;

  /** K21: leave only the first page in the data of an infinite query. */
  function keepFirstPage(q: Query): void {
    const data: unknown = q.state.data;
    if (!isInfiniteData(data) || data.pages.length <= 1) return;
    qc.setQueryData(q.queryKey, {
      pages: data.pages.slice(0, 1),
      pageParams: data.pageParams.slice(0, 1),
    });
  }

  function flush(): void {
    timer = null;

    const due = new Map<Query, DueQuery>();
    const addDue = (q: Query, d: DueQuery): void => {
      const prev = due.get(q);
      // The LATEST event must be compared with the read: a read started
      // between two events covers the first one but not the second.
      due.set(
        q,
        prev
          ? {
            seq: Math.max(prev.seq, d.seq),
            refetchType: mergeRefetchType(prev.refetchType, d.refetchType),
            firstPageOnly: prev.firstPageOnly || d.firstPageOnly,
          }
          : d,
      );
    };

    for (const [q, d] of carried) {
      // The query left the cache (garbage collection, exit) — nothing to invalidate, and
      // its "reading" state could have frozen: carrying it further would
      // wake the tab once per window forever.
      if (cache.get(q.queryHash) === q) addDue(q, d);
    }
    carried = new Map();

    // The same query hit by many filters gets one entry:
    // this is the deduplication within a wave. Predicates cannot be compared, but
    // the queries they landed on can.
    for (const p of pending) {
      const refetchType = p.filters.refetchType ?? 'active';
      const firstPageOnly = p.filters.firstPageOnly === true;
      for (const q of cache.findAll(p.filters)) {
        addDue(q, { seq: p.seq, refetchType, firstPageOnly });
      }
    }
    pending = [];

    if (isHidden()) {
      // K22: a hidden tab sends no requests (US-14, SC-006). Everything hit
      // becomes an obligation; an inactive query (nobody
      // shows it) is only marked stale without a read — then it
      // is re-read on mount, as before.
      const inactive = new Set<Query>();
      for (const [q, d] of due) {
        const prev = obligations.get(q);
        obligations.set(
          q,
          prev
            ? {
              seq: Math.max(prev.seq, d.seq),
              refetchType: mergeRefetchType(prev.refetchType, d.refetchType),
              firstPageOnly: prev.firstPageOnly || d.firstPageOnly,
            }
            : d,
        );
        if (!q.isActive()) inactive.add(q);
      }
      if (inactive.size > 0) {
        void qc.invalidateQueries(
          { predicate: (q) => inactive.has(q), refetchType: 'none' },
          { cancelRefetch: false },
        );
      }
      return;
    }

    for (const [q, d] of obligations) {
      if (cache.get(q.queryHash) === q) addDue(q, d);
    }
    obligations = new Map();

    const byRefetchType = new Map<RefetchType, Set<Query>>();
    for (const [q, d] of due) {
      if (readCoversEvent(q, d.seq)) continue;
      if (q.state.fetchStatus !== 'idle') {
        // A read is running. It was started BEFORE the event — invalidating now would let
        // its success clear the mark and swallow the event; started AFTER — it
        // may still fail. In both cases we wait for its end.
        carried.set(q, d);
        continue;
      }
      if (d.firstPageOnly) keepFirstPage(q);
      let set = byRefetchType.get(d.refetchType);
      if (!set) {
        set = new Set();
        byRefetchType.set(d.refetchType, set);
      }
      set.add(q);
    }

    for (const [refetchType, set] of byRefetchType) {
      // `cancelRefetch: false` here is a safeguard, not a mechanism: only
      // queries without a running read are invalidated (running ones are carried over above), so
      // there is nothing to abort. The option keeps this promise even
      // when the selection above changes one day.
      void qc.invalidateQueries(
        { predicate: (q) => set.has(q), refetchType },
        { cancelRefetch: false },
      );
    }

    if (carried.size > 0) schedule();
  }

  return {
    invalidateQueries(filters?: LiveInvalidateFilters): Promise<void> {
      // Without a filter `invalidateQueries` invalidates everything; the meaning is preserved.
      // The router options (`cancelRefetch`) are deliberately not preserved:
      // the wave is always applied with `cancelRefetch: false`, see the header.
      pending.push({ filters: filters ?? {}, seq: ++seq });
      schedule();
      return Promise.resolve();
    },
    getQueryCache(): QueryCache {
      return cache;
    },
    resume(): void {
      if (disposed || isHidden()) return;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      flush();
    },
    dispose(): void {
      disposed = true;
      clearTimeout(timer ?? undefined);
      timer = null;
      unsubscribe();
    },
  };
}
