/**
 * sk-763 — a task list being read is not reset under the reader.
 *
 * ─── What the owner decided ────────────────────────────────────────
 *
 * While a person reads a loaded task list (the Tasks column, tree or
 * cards), the background does not drop the pages they scrolled in: a row
 * change the client can apply with certainty is applied in place
 * (`liveRowPatch.ts`), and everything else — a change the list cannot
 * answer from the event, a new row, focus, visibility, a reconnect — marks
 * the list «updates available». The person applies it with one explicit
 * click, which reads the first page in one request. Some numbers (the
 * total, blocked markers, epic progress of the far pages) may be stale
 * until then. No automatic re-read of the loaded pages.
 *
 * This replaces, for such lists, the norm «re-read from the first page,
 * dropping the loaded pages» of spec sk-622.21 US-15 / plan K21 — kept for
 * every other list.
 *
 * ─── Which list is held ────────────────────────────────────────────
 *
 * {@link holdsReadingList}: a Tasks-column list (`['tasks', …]`, not a text
 * search — the hybrid search pages a server snapshot with its own
 * recovery, sk-346) that the column SHOWS now as its ordinary list (tree,
 * cards or board — not under the reminders lens, a rooted subtree or the
 * pasted-codes result, which keep the query observed but show something
 * else; {@link useReportReadingPosition}), and that the reader is in:
 *  - it already owes updates (a mark): it stays held until the reader
 *    applies them — returning to the start applies nothing on its own;
 *  - more than one page is loaded: a re-read of the first page drops the
 *    pages after it;
 *  - one page is loaded and the column is scrolled away from its start:
 *    new rows on top would push the rows being read out of the page.
 * A list shown from its start with one page, a list nobody shows and a
 * list the column shows something else over are re-read as before (K21) —
 * a held list nobody shows any more is cut as before, and its return reads
 * that one page, which drops its mark. The decision is made by the
 * coalescing batcher at the moment of the wave (`liveInvalidationBatcher.ts`).
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
/** Lists whose column is scrolled away from the start (the reader is in them). */
const awayFromStart = new WeakSet<Query>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

/** Infinite data of a task list: its loaded pages. */
function loadedPages(data: unknown): number {
  const pages = (data as { pages?: unknown } | null | undefined)?.pages;
  return Array.isArray(pages) ? pages.length : 0;
}

/** Is `key` a task list a reading hold may apply to (no text search)? */
function holdableListKey(key: QueryKey): boolean {
  const info = tasksListInfo(key);
  return info !== null && info.kind !== 'search';
}

/** Whether the background must not reset `q` now (see the module header). */
export function holdsReadingList(q: Query): boolean {
  if (!holdableListKey(q.queryKey) || !q.isActive() || !shownByColumn.has(q)) return false;
  if (dirty.has(q)) return true;
  const pages = loadedPages(q.state.data);
  return pages > 1 || (pages === 1 && awayFromStart.has(q));
}

/**
 * What the Tasks column reports of the list `q` ({@link useReportReadingPosition}):
 * whether it shows it as its ordinary list, and whether its reader is away
 * from the start.
 */
function reportReadingList(q: Query, report: { shown: boolean; awayFromStart: boolean }): void {
  if (report.shown) shownByColumn.add(q);
  else shownByColumn.delete(q);
  if (report.awayFromStart) awayFromStart.add(q);
  else awayFromStart.delete(q);
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
 * is on screen) and where its reader is: away from the start when any of
 * the column's scroll containers inside `root` is scrolled. `scroll` does
 * not bubble, so it is listened to in the capture phase on the document —
 * the column may mount folded and its body appear later. The cache entry is
 * looked up by hash, and found again when the list is evicted and read
 * anew; a scroll writes only a change of the away flag.
 *
 * `surface` names the surface the list is shown on: the column's view
 * (tree, cards) and, for the board, its grouping — another grouping is
 * another set of lanes. Another surface brings other scroll containers,
 * which start at their start and send no `scroll`. A change of `surface`
 * subscribes the hook again, and the subscription measures the position on
 * the scroll containers then in the column, so a list left scrolled on the
 * previous surface is not taken as one its reader is away in. Nothing else
 * of the list changes with it — its mark, its continuation and its data
 * stay, and nothing is read. Absent — one surface.
 */
export function useReportReadingPosition(
  key: QueryKey,
  opts: { shown: boolean; root: RefObject<HTMLElement | null>; surface?: string },
): void {
  const qc = useQueryClient();
  const hash = hashKey(key);
  const { shown, root, surface } = opts;
  useEffect(() => {
    const cache = qc.getQueryCache();
    let q: Query | undefined = cache.get(hash);
    const measure = () => scrollersIn(root.current).some((el) => el.scrollTop > 0);
    let away = measure();
    const apply = () => {
      if (q) reportReadingList(q, { shown, awayFromStart: away });
    };
    apply();
    const onScroll = (e: Event) => {
      const t = e.target;
      if (!(t instanceof HTMLElement) || !t.matches(READING_SCROLLERS) || !root.current?.contains(t)) return;
      const next = measure();
      if (next === away) return;
      away = next;
      apply();
    };
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
        apply();
      } else if (ev.type === 'removed' && ev.query === q) {
        q = undefined;
      }
    });
    document.addEventListener('scroll', onScroll, true);
    for (const type of intents) document.addEventListener(type, onIntent, { capture: true, passive: true });
    return () => {
      document.removeEventListener('scroll', onScroll, true);
      for (const type of intents) document.removeEventListener(type, onIntent, { capture: true });
      unsubscribe();
      if (q) reportReadingList(q, { shown: false, awayFromStart: false });
    };
    // `key` is read through its hash: a new array of the same key is the same
    // list. `surface` is not read here: its change re-subscribes, and the
    // subscription measures the scroll containers of the surface shown now.
  }, [qc, hash, shown, root, surface]);
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
const outcomeListeners = new Set<(q: Query, outcome: ApplyOutcome) => void>();

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
 * page and that page is read again — one request; a read in flight is
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
    if (outcome) for (const l of outcomeListeners) l(q, outcome);
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

/** Called with the outcome of every apply as it ends (the button moves focus, announces). */
export function onApplyOutcome(listener: (q: Query, outcome: ApplyOutcome) => void): () => void {
  outcomeListeners.add(listener);
  return () => {
    outcomeListeners.delete(listener);
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
