/**
 * sk-763 — a task list being read is not reset under the reader.
 *
 * ─── What the owner decided ────────────────────────────────────────
 *
 * While the Tasks column shows a loaded task list (tree, cards or board),
 * the background does not drop its pages or re-read them — one page or
 * many, from its start or not: a row change the client can apply with
 * certainty is applied in place
 * (`liveRowPatch.ts`), and everything else — a change the list cannot
 * answer from the event, a new row, focus, visibility, a reconnect — marks
 * the list «updates available». The person applies it with one explicit
 * click, which reads the first page in one request (a layered tree with the
 * task list behind it: the tree once and that first page once). Some numbers (the
 * total, blocked markers, epic progress of the far pages) may be stale
 * until then. No automatic re-read of the loaded pages.
 *
 * This replaces, for such lists, the norm «re-read from the first page,
 * dropping the loaded pages» of spec sk-622.21 US-15 / plan K21 — kept for
 * every other list.
 *
 * ─── Which list is held ────────────────────────────────────────────
 *
 * {@link holdsReadingList}: the list the Tasks column SHOWS now as its
 * ordinary list — a task list (`['tasks', …]`, not a text search: the hybrid
 * search pages a server snapshot with its own recovery, sk-346) in the
 * cards, the board or the parent-child tree, or the project's layered tree
 * (`['issues', 'tree', pid, '__forest__', …]`) the tree view draws with a
 * link lens beyond parent-child (then the task list behind it is shown too:
 * it decides the body around the tree and the header's count, and the one
 * «Updates available» reads both, `TasksUpdatesButton.tsx`); not under the
 * reminders lens, a rooted subtree or the pasted-codes result, which keep
 * the query observed but show something else ({@link useReportReadingPosition})
 * — and that has an answer loaded (a tree answered with no row too) —
 * however many pages, wherever its reader is in it: one page read from its
 * start is held too (the owner's decision: the list does not rebuild itself
 * while it is looked at, and the background reads less). A list nobody
 * shows and a list the column shows something else over are re-read as
 * before (K21) — a held list nobody shows any more is cut as before, and its
 * return reads that one page, which drops its mark. The first read of a
 * list is its own: nothing is loaded yet, nothing is held. The decision is
 * made by the coalescing batcher at the moment of the wave
 * (`liveInvalidationBatcher.ts`).
 *
 * ─── What the mark is ──────────────────────────────────────────────
 *
 * One flag per cached list — on the cache's `Query` object itself (a weak
 * set, module state of the tab): a list removed from the cache, or a cache
 * replaced (sign-out, another client), carries no mark, while a reconnect,
 * which keeps the cache, keeps it. It says «a full read of this list was
 * owed and not done». It is dropped when a read of the list from its first
 * page delivers an answer started after the last held reset (the button,
 * or a mount that reads it again), and when the list leaves the cache or is
 * reset. Another project, filter or sort is another list: its mark is its
 * own, nothing carries over by matching ids.
 */

import { useCallback, useEffect, useSyncExternalStore, type RefObject } from 'react';
import { hashKey, useQueryClient, type Query, type QueryClient, type QueryKey } from '@tanstack/react-query';
import { tasksListInfo } from './liveEventInvalidation';
import type { ReadingHold } from './liveInvalidationBatcher';

const dirty = new WeakSet<Query>();
/** Lists the Tasks column shows as its ordinary list now. */
const shownByColumn = new WeakSet<Query>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

/** Infinite data of a task list: its loaded pages. */
function loadedPages(data: unknown): number {
  const pages = (data as { pages?: unknown } | null | undefined)?.pages;
  return Array.isArray(pages) ? pages.length : 0;
}

/**
 * Is `key` the column's layered tree of a project — the tree the Tasks
 * column draws with a link lens beyond parent-child
 * (`useLayeredTree.ts#layeredTreeQueryKey` with no root)? Not a subtree
 * rooted at an epic (`rootId`), not the cross-project tree.
 */
function columnTreeKey(key: QueryKey): boolean {
  return key[0] === 'issues' && key[1] === 'tree'
    && typeof key[2] === 'string' && key[2] !== '__cross__'
    && key[3] === '__forest__';
}

/** Is `key` a list a reading hold may apply to: a task list (no text search) or the column's layered tree? */
function holdableListKey(key: QueryKey): boolean {
  const info = tasksListInfo(key);
  if (info !== null) return info.kind !== 'search';
  return columnTreeKey(key);
}

/** Whether `q` has an answer shown: a page of a task list, the tree's answer (empty or not). */
function answered(q: Query): boolean {
  return columnTreeKey(q.queryKey) ? q.state.data !== undefined : loadedPages(q.state.data) > 0;
}

/** Whether the background must not reset `q` now (see the module header). */
export function holdsReadingList(q: Query): boolean {
  return holdableListKey(q.queryKey) && q.isActive() && shownByColumn.has(q) && answered(q);
}

/**
 * What the Tasks column reports of the list `q` ({@link useReportReadingPosition}):
 * whether it shows it as its ordinary list.
 */
function reportReadingList(q: Query, shown: boolean): void {
  if (shown) shownByColumn.add(q);
  else shownByColumn.delete(q);
}

/**
 * The scroll containers of the Tasks column a reader moves in: the body of
 * the tree and of the cards (`.col-body.tasks-body`), and every lane of the
 * board (`.kanban-col-body` — the board's own body does not scroll).
 */
const READING_SCROLLERS = '.col-body.tasks-body, .kanban-col-body';

function scrollersIn(root: HTMLElement | null): HTMLElement[] {
  return root ? [...root.querySelectorAll<HTMLElement>(READING_SCROLLERS)] : [];
}

/** Bring every scroll container of the column to its start (the reader applies updates). */
export function scrollReadingToStart(root: HTMLElement | null): void {
  for (const el of scrollersIn(root)) {
    if (el.scrollTop !== 0) el.scrollTo({ top: 0 });
  }
}

/**
 * Report the list `key` the Tasks column shows (`shown`: its ordinary list
 * is on screen), and let the reader's moves in it open the infinite scroll
 * after an apply. The cache entry is looked up by hash, and found again when
 * the list is evicted and read anew. The events are listened to in the
 * capture phase on the document: the column may mount folded and its body
 * appear later.
 */
export function useReportReadingPosition(
  key: QueryKey,
  opts: { shown: boolean; root: RefObject<HTMLElement | null> },
): void {
  const qc = useQueryClient();
  const hash = hashKey(key);
  const { shown, root } = opts;
  useEffect(() => {
    const cache = qc.getQueryCache();
    let q: Query | undefined = cache.get(hash);
    if (q) reportReadingList(q, shown);
    // The reader moving in the list — a wheel turn or a touch drag over it,
    // a navigation key on it, a press on a scroll container itself (its
    // scrollbar) — lets the infinite scroll go on after an apply
    // ({@link applyHeldList}). Only the list counts: the column's header and
    // filters sit outside its scroll containers, and a key typed into a text
    // field (the search, an inline edit) edits that field. A scroll event
    // alone does not count either: the apply itself scrolls the column.
    const inList = (t: EventTarget | null): t is Element => {
      const scroller = t instanceof Element ? t.closest(READING_SCROLLERS) : null;
      return scroller !== null && root.current?.contains(scroller) === true;
    };
    const onIntent = (e: Event) => {
      const t = e.target;
      if (!q || !inList(t)) return;
      if (e.type === 'pointerdown' && !t.matches(READING_SCROLLERS)) return;
      if (e.type === 'keydown' && (!NAVIGATION_KEYS.has((e as KeyboardEvent).key) || editsText(t))) return;
      openContinuation(q);
    };
    const intents = ['wheel', 'touchmove', 'keydown', 'pointerdown'] as const;
    const unsubscribe = cache.subscribe((ev) => {
      if (ev.query.queryHash !== hash) return;
      if (ev.type === 'added') {
        q = ev.query;
        reportReadingList(q, shown);
      } else if (ev.type === 'removed' && ev.query === q) {
        q = undefined;
      }
    });
    for (const type of intents) document.addEventListener(type, onIntent, { capture: true, passive: true });
    return () => {
      for (const type of intents) document.removeEventListener(type, onIntent, { capture: true });
      unsubscribe();
      if (q) reportReadingList(q, false);
    };
    // `key` is read through its hash: a new array of the same key is the same list.
  }, [qc, hash, shown, root]);
}

/** Mark the list of `q` «updates available». */
function markListDirty(q: Query): void {
  if (dirty.has(q)) return;
  dirty.add(q);
  emit();
}

/**
 * Drop the mark of the list of `q` (a fresh first-page read landed, the list
 * left). A failed apply of it is over too: nothing is owed any more.
 */
function clearListDirty(q: Query): void {
  const wasFailed = applyPhase.get(q) === 'failed';
  if (wasFailed) applyPhase.delete(q);
  if (!dirty.delete(q) && !wasFailed) return;
  emit();
}

/** The hold the live coalescer applies (`useLiveEvents.tsx`). */
export const readingListHold: ReadingHold = {
  holds: holdsReadingList,
  marked: (q) => dirty.has(q),
  mark: markListDirty,
  release: clearListDirty,
};

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** The keys that move a reader through a list. */
const NAVIGATION_KEYS: ReadonlySet<string> = new Set(['ArrowDown', 'PageDown', 'End', ' ', 'ArrowUp', 'PageUp', 'Home']);

/** Whether a key pressed on `t` goes to a field that edits text or a choice, not to the list. */
function editsText(t: Element): boolean {
  return t.matches('input, textarea, select') || (t instanceof HTMLElement && t.isContentEditable);
}

// ───────────────────────── the apply ─────────────────────────

/**
 * The reader's apply of a held list — ONE operation per cache entry
 * (another client, or the entry evicted, starts with none): every view of
 * the list sees it, a second press joins it, and the column mounting the
 * same list again finds it running.
 */
const applyPhase = new WeakMap<Query, 'applying' | 'failed'>();
/**
 * Lists whose infinite scroll waits after an apply that ended with an
 * answer or a failure: the first page is shown from its start, and the
 * next page is read when the reader moves in the list, not because a short
 * page leaves the sentinel in view. An apply that ended with no outcome
 * (its read cancelled, or never started) leaves the way open.
 */
const continuationClosed = new WeakSet<Query>();

type ApplyOutcome = 'applied' | 'failed';

/**
 * One press of «Updates available» ({@link applyHeldLists}): the surface
 * pressed — every list it shows, read or not — and the outcome of each
 * list's apply it waits for as that apply ends: `undefined` while it runs,
 * `null` when it ended with no outcome.
 */
interface SurfaceAttempt {
  surface: readonly Query[];
  reads: Map<Query, ApplyOutcome | null | undefined>;
}
/** The attempts a list's running apply is awaited by; the entry goes when that apply ends. */
const surfaceAttempts = new WeakMap<Query, Set<SurfaceAttempt>>();
const appliedListeners = new Set<(surface: readonly Query[]) => void>();

/** The apply of `q` ended: every attempt awaiting it learns it, and tells when all its reads landed. */
function settleSurfaceAttempts(q: Query, outcome: ApplyOutcome | null): void {
  const attempts = surfaceAttempts.get(q);
  if (attempts === undefined) return;
  surfaceAttempts.delete(q);
  for (const attempt of attempts) {
    attempt.reads.set(q, outcome);
    const outcomes = [...attempt.reads.values()];
    if (outcomes.includes(undefined)) continue;
    if (!outcomes.every((o) => o === 'applied')) continue;
    for (const listener of appliedListeners) listener(attempt.surface);
  }
}

function openContinuation(q: Query): void {
  if (!continuationClosed.delete(q)) return;
  emit();
}

function phaseOf(q: Query | undefined): 'idle' | 'applying' | 'failed' {
  return (q && applyPhase.get(q)) ?? 'idle';
}

/**
 * Whether a read of the next page of `q` may start now. While an apply
 * reads the first page, no: it would cancel that read. After the apply, not
 * on its own (the sentinel of a short page) — only on the reader's move in
 * the list or an `explicit` request («Load more»), which opens the way.
 */
export function mayContinue(q: Query | undefined, explicit: boolean): boolean {
  if (!q) return true;
  if (phaseOf(q) === 'applying') return false;
  if (!continuationClosed.has(q)) return true;
  if (!explicit) return false;
  openContinuation(q);
  return true;
}

/**
 * The reader applies the updates (the button): the list is cut to its first
 * page and that page is read again — one request (a layered tree has no
 * pages: it is read again as it is); a read in flight is
 * cancelled first (its pages are dropped). The operation ends with the
 * REAL end of that read — the success of a full read of the list, or its
 * failure; a read paused offline keeps it running until the network is
 * back. The mark goes when the answer lands (the batcher sees the read),
 * and stays if the read fails, so the button offers a retry.
 *
 * The operation belongs to the cache entry `q` it started on, not to its
 * key. Once it is over — the entry left the cache (removed, the cache
 * cleared) or was reset — the steps still pending do nothing: they neither
 * bring the removed list back nor touch a new entry of the same key.
 *
 * The apply's own read cancelled (`cancelQueries`, TanStack's default
 * `revert`: the state before the read comes back, idle, with no error) is
 * not an answer: the operation ends with no outcome — the mark stays, the
 * button offers the updates again and the next page may be read. The
 * cancel the apply makes itself, of a read in flight before its own, is
 * part of the operation and ends nothing.
 *
 * The client may start no read at all (it skips a list whose observer is
 * switched off): with no read running once the request returns, the
 * operation ends with no outcome as well — it never waits for an answer
 * that will not come. A failed read ends it with the reader's offer to
 * retry, and, like an answer, does not start the next page on its own.
 */
export function applyHeldList(qc: QueryClient, key: QueryKey): void {
  const cache = qc.getQueryCache();
  const q = cache.get(hashKey(key));
  if (!q || applyPhase.get(q) === 'applying') return;
  applyPhase.set(q, 'applying');
  emit();
  let over = false;
  // The apply's own read is asked for (its preparatory cancel is behind).
  let ownRead = false;
  // A read of the list started after `ownRead` (the apply's own, or one that replaced it).
  let readStarted = false;
  let full = false;
  /** The operation still runs, on the entry the cache holds for this key. */
  const live = () => !over && cache.get(q.queryHash) === q;
  const finish = (outcome: ApplyOutcome | null) => {
    if (over) return;
    over = true;
    unsubscribe();
    if (outcome === 'failed') applyPhase.set(q, 'failed');
    else applyPhase.delete(q);
    if (outcome !== null) continuationClosed.add(q);
    emit();
    settleSurfaceAttempts(q, outcome);
  };
  const unsubscribe = cache.subscribe((e) => {
    if (e.query !== q) return;
    if (e.type === 'removed') {
      finish(null);
      return;
    }
    if (e.type !== 'updated') return;
    const a = e.action;
    if (a.type === 'fetch') {
      if (ownRead) readStarted = true;
      full = (a.meta as { fetchMore?: unknown } | undefined)?.fetchMore === undefined;
    } else if (a.type === 'success' && a.manual !== true && full) {
      finish('applied');
    } else if (a.type === 'error' && full) {
      finish('failed');
    } else if (a.type === 'setState' && q.state.data === undefined) {
      // Reset (access purge, sign-out): there is no list left to apply to.
      finish(null);
    } else if (a.type === 'setState' && ownRead && q.state.fetchStatus === 'idle') {
      // The apply's read was cancelled with `revert`: no answer came.
      finish(null);
    }
  });
  void (async () => {
    await q.cancel({ revert: true });
    if (!live()) return;
    const data = q.state.data as { pages?: unknown[]; pageParams?: unknown[] } | undefined;
    if (data && Array.isArray(data.pages) && Array.isArray(data.pageParams) && data.pages.length > 1) {
      qc.setQueryData(key, { pages: data.pages.slice(0, 1), pageParams: data.pageParams.slice(0, 1) });
    }
    ownRead = true;
    await qc.refetchQueries({ queryKey: key, exact: true, predicate: (x) => x === q }).catch(() => {});
    // No read was started for the request (a paused read did start: it
    // dispatched its `fetch`), and none runs: no answer will come.
    if (live() && !readStarted && q.state.fetchStatus === 'idle') finish(null);
  })();
}

/**
 * The reader applies the updates of one surface. `surface` is every list
 * the pressed control shows (its identity); `owed`, a part of it, the lists
 * that owe updates — each goes through its own {@link applyHeldList} (a list
 * whose apply already runs joins that read), a clean list is not read.
 *
 * The press is one attempt, known before any of its reads can end, and it
 * belongs to the cache entries of this client, not to the control: a
 * control of the SAME surface mounted again while the reads run (it moved
 * between the column header and the filters row) learns the end like the
 * one pressed, while a surface that only shares a list with it (another
 * task filter over the same tree, the cards turned into a tree) does not.
 * A surface with a list not in the cache has no identity to confirm: its
 * reads run, its end is told to no one.
 *
 * The attempt landed when every awaited apply ended with an answer; a
 * failure of any, or an apply that ended with no outcome (its read
 * cancelled, the entry left the cache or was reset), is no success. The end
 * says only that the reads landed: an event they did not carry keeps its
 * own mark (the live layer, or the column's tree clock after the answer is
 * committed, `TasksColumn.tsx`), and the offer stays. Where the focus goes
 * is not decided here (`TasksUpdatesButton.tsx`). Nothing is kept once each
 * awaited apply ended: no element, no history.
 */
function everyCached(lists: ReadonlyArray<Query | undefined>): lists is readonly Query[] {
  return lists.every((q) => q !== undefined);
}

export function applyHeldLists(qc: QueryClient, surface: readonly QueryKey[], owed: readonly QueryKey[]): void {
  const cache = qc.getQueryCache();
  const shown = surface.map((k) => cache.get(hashKey(k)));
  const awaited = [...new Set(owed.map((k) => cache.get(hashKey(k))).filter((q): q is Query => q !== undefined))];
  if (awaited.length > 0 && everyCached(shown)) {
    const attempt: SurfaceAttempt = {
      surface: [...new Set(shown)],
      reads: new Map(awaited.map((q) => [q, undefined])),
    };
    for (const q of awaited) {
      const attempts = surfaceAttempts.get(q);
      if (attempts === undefined) surfaceAttempts.set(q, new Set([attempt]));
      else attempts.add(attempt);
    }
  }
  for (const k of owed) applyHeldList(qc, k);
}

/** Called with the surface of every attempt that landed whole (the button of that surface announces it). */
export function onUpdatesApplied(listener: (surface: readonly Query[]) => void): () => void {
  appliedListeners.add(listener);
  return () => {
    appliedListeners.delete(listener);
  };
}

/** The cache entry of the list `key` in the current client (O(1), by hash). */
function useListQuery(key: QueryKey): Query | undefined {
  const qc = useQueryClient();
  const hash = hashKey(key);
  const subscribeEntry = useCallback(
    (cb: () => void) => qc.getQueryCache().subscribe((e) => {
      if (e.query.queryHash === hash && (e.type === 'added' || e.type === 'removed')) cb();
    }),
    [qc, hash],
  );
  const read = useCallback(() => qc.getQueryCache().get(hash), [qc, hash]);
  return useSyncExternalStore(subscribeEntry, read, () => undefined);
}

/**
 * What the reader is offered for the list `key`: whether it owes updates,
 * and the phase of its apply. One snapshot string, so the store's object
 * identity never decides a re-render.
 */
export function useListState(key: QueryKey): { dirty: boolean; phase: 'idle' | 'applying' | 'failed'; query: Query | undefined } {
  const q = useListQuery(key);
  const snap = useSyncExternalStore(
    subscribe,
    () => `${q !== undefined && dirty.has(q) ? 1 : 0}${phaseOf(q)}`,
    () => '0idle',
  );
  return { dirty: snap[0] === '1', phase: snap.slice(1) as 'idle' | 'applying' | 'failed', query: q };
}

/** Whether the infinite scroll of the list `key` waits for the reader (re-renders on change). */
export function useContinuationClosed(key: QueryKey): boolean {
  const q = useListQuery(key);
  return useSyncExternalStore(subscribe, () => q !== undefined && (continuationClosed.has(q) || phaseOf(q) === 'applying'), () => false);
}
