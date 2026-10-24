/**
 * Phase 2 of the live reaction — the event's neutral row is laid onto what
 * the tab shows (spec sk-622.21 US-15 "List row in the event (phase 2)",
 * D7; plan T049, K16, K17, K21). Driven by `liveEventInvalidation.ts`, which
 * keeps every other reaction of the event's matrix row.
 *
 * ─── The row and its freshness ─────────────────────────────────────
 *
 * An issue event carries `row` — the issue's list row after the commit, with
 * no reader-dependent field (INV-14) — and `rowSeq`, an order that tells
 * every committed change of ONE issue apart, label and component writes
 * included, which do not move `version` (skein-api
 * `issues/types.go#NeutralRow`, `outbox/envelope.go#Envelope.Row`). The rule
 * is the server's: substitute only if the row's `rowSeq` is greater than the
 * one shown for that issue. The order is per issue — values of different
 * issues are not comparable — so «shown» is the greatest of:
 *  - the `rowSeq` of every cached copy of the issue (list rows, ancestor
 *    backfills, tree items, the card) — what REST delivered or a patch laid;
 *  - the greatest `rowSeq` of this issue's rows this tab already took from
 *    events ({@link RowFreshness}, bounded) — a read started before an event
 *    may land after it with an older row, and a later stale event must not
 *    win over it.
 * A row that is not fresher changes no surface and sends no request on its
 * own account; the event's other reactions stay — the lists whose filter a
 * row cannot answer are re-read here, the rest is the caller's.
 * A repeat of the same envelope never reaches here (dedup on `id`, provider).
 *
 * ─── Fields of the reader ──────────────────────────────────────────
 *
 *  - `iAssigned` is computed here by the server's rule (K17,
 *    `issues/store.go#ListIssues` `iAssignedExpr`): `createdBy == me &&
 *    assigneeUserId != null && assigneeUserId != me`; the key is absent when
 *    false, as REST omits it.
 *  - `isBlocked` and `epicProgress` depend on the reader's horizon: they are
 *    kept as shown and re-read by the event reactions that can change them
 *    (blocking links, status / outcome of a blocker or a child — the
 *    caller), and on focus / visibility (`liveVisibility.ts`).
 *  - `parentIdCurrent` is on the row only when the parent lives in the
 *    issue's own project (INV-17); absent, the shown parent is kept.
 *
 * ─── Lists (`['tasks', …]`), K21 ───────────────────────────────────
 *
 * The server pages a list by `(updated_at | created_at) DESC, id DESC` with
 * a keyset cursor (the last row's values). A row is laid into a loaded list
 * without a request only if every condition of the list is computable from
 * the row (`useTasks.ts#tasksListServerShape`), the row still belongs to the
 * list, and the loaded prefix stays the server's prefix with a continuation
 * that neither skips nor repeats — that is, the row stays at or before the
 * last loaded row while more pages exist. Then it moves to its server
 * position; the column re-sorts the screen order itself. Every other case
 * — the row entered or left, a condition the row cannot answer (text
 * search, blocked-ness, source, the delegated lens) — re-reads the list from
 * its first page, dropping the loaded tail (batcher `firstPageOnly`).
 *
 * ─── Trees, backfills, the card ────────────────────────────────────
 *
 * Tree answers and ancestor backfills are whole answers, not pages: the row
 * is laid onto every node showing the issue (and onto blocker entries naming
 * it). The open card takes the row only when the event changes nothing but
 * fields of the row (title, priority, type, labels, components, pinned —
 * {@link isRowOnlyChange}); any other event re-reads it (caller).
 *
 * A surface with a read in flight is patched AND re-read: the read may have
 * started before the commit and would lay the older answer over the patch
 * (a list keeps its loaded pages for that re-read — its set did not move).
 * A surface whose FIRST read is still out has nothing to patch and is
 * re-read after that read, whatever the row's freshness (US-13: an event
 * that arrives while a read it touches is in flight shows once that read
 * returned) — {@link rereadFirstReads}.
 */

import type { InfiniteData, Query, QueryCache } from '@tanstack/react-query';
import type {
  CloseOutcome,
  IssueDetail,
  IssueStatus,
  IssueSummary,
  IssueType,
} from '../api/issues';
import type { EventEnvelope } from './eventEnvelope';
import type { LiveInvalidationTarget } from './liveInvalidationBatcher';
import { layRowOntoIssueDetail } from './useIssueDetail';
import { patchLayeredTreeRow } from './useLayeredTree';
import { tasksListServerShape, type TasksListServerShape } from './useTasks';

// ───────────────────────────── the row ───────────────────────────────

/**
 * The phase-2 neutral row as it arrives in `EventEnvelope.row` — the JSON of
 * skein-api `issues.NeutralRow`: `IssueSummary` without `iAssigned`,
 * `isBlocked`, `epicProgress`, plus `rowSeq`. Optional keys are omitted on
 * the wire when empty.
 */
export interface NeutralRow {
  id: string;
  projectId: string;
  /** Present only when the parent is in the issue's own project. */
  parentIdCurrent?: string;
  version: number;
  title: string;
  type: IssueType;
  priority: number;
  status: IssueStatus;
  pinned: boolean;
  assignee?: string;
  assigneeUserId?: string;
  createdBy: string;
  createdByUsername?: string;
  componentIds: string[];
  labels: string[];
  acceptedAt?: string;
  closeOutcome?: CloseOutcome;
  updatedAt: string;
  createdAt: string;
  /**
   * Freshness order. 0 = «order unknown»: a row not written since phase 2
   * was rolled out (skein-api migration 000064, decision R26). It is never
   * fresher than anything shown, so such a row is not laid in.
   */
  rowSeq: number;
}

/**
 * Read the row off an issue envelope. `null` — and the event is handled as
 * in phase 1 — when there is none (a phase-1 server, a deleted issue), when
 * it names another issue or project than the envelope, or when a required
 * field is missing or of the wrong type: the wire is untrusted, and a
 * half-row laid onto a list would show holes.
 */
export function readEventRow(envelope: EventEnvelope): NeutralRow | null {
  const raw: unknown = envelope.row;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown): v is string => typeof v === 'string';
  const optStr = (v: unknown): v is string | undefined | null => v === undefined || v === null || typeof v === 'string';
  const strArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');
  if (
    !str(r.id) || r.id !== envelope.entityId
    || !str(r.projectId)
    || (typeof envelope.projectId === 'string' && r.projectId !== envelope.projectId)
    || typeof r.rowSeq !== 'number' || !Number.isFinite(r.rowSeq) || r.rowSeq < 0
    || typeof r.version !== 'number'
    || !str(r.title) || !str(r.type) || !str(r.status)
    || typeof r.priority !== 'number'
    || typeof r.pinned !== 'boolean'
    || !str(r.createdBy)
    || !strArray(r.componentIds) || !strArray(r.labels)
    || !str(r.updatedAt) || !str(r.createdAt)
    || !optStr(r.parentIdCurrent) || !optStr(r.assignee) || !optStr(r.assigneeUserId)
    || !optStr(r.createdByUsername) || !optStr(r.acceptedAt) || !optStr(r.closeOutcome)
  ) {
    return null;
  }
  const row: NeutralRow = {
    id: r.id,
    projectId: r.projectId,
    version: r.version,
    title: r.title,
    type: r.type as IssueType,
    priority: r.priority,
    status: r.status as IssueStatus,
    pinned: r.pinned,
    createdBy: r.createdBy,
    componentIds: r.componentIds,
    labels: r.labels,
    updatedAt: r.updatedAt,
    createdAt: r.createdAt,
    rowSeq: r.rowSeq,
  };
  if (str(r.parentIdCurrent)) row.parentIdCurrent = r.parentIdCurrent;
  if (str(r.assignee)) row.assignee = r.assignee;
  if (str(r.assigneeUserId)) row.assigneeUserId = r.assigneeUserId;
  if (str(r.createdByUsername)) row.createdByUsername = r.createdByUsername;
  if (str(r.acceptedAt)) row.acceptedAt = r.acceptedAt;
  if (str(r.closeOutcome)) row.closeOutcome = r.closeOutcome as CloseOutcome;
  return row;
}

/**
 * `iAssigned` for reader `me`, by the server's rule (K17): the reader created
 * the issue and it is assigned to someone else who resolves to a user.
 */
export function computeIAssigned(
  row: Pick<NeutralRow, 'createdBy' | 'assigneeUserId'>,
  me: string,
): boolean {
  return row.createdBy === me && row.assigneeUserId !== undefined && row.assigneeUserId !== me;
}

/** Keys the row sets when present and clears when absent (wire omitempty). */
const OPTIONAL_ROW_KEYS = ['assignee', 'assigneeUserId', 'createdByUsername', 'acceptedAt', 'closeOutcome'] as const;

/**
 * The shown list row `shown` with the event row laid in. The reader's fields
 * are recomputed (`iAssigned`) or kept (`isBlocked`, `epicProgress`), the
 * parent is kept when the row does not carry one, and anything else the
 * shown row has that a list row never gets from the server (a search row's
 * `score`) stays.
 */
export function layRowOntoSummary<T extends { id: string }>(shown: T, row: NeutralRow, me: string): T {
  const out: Record<string, unknown> = {
    ...shown,
    projectId: row.projectId,
    version: row.version,
    title: row.title,
    type: row.type,
    priority: row.priority,
    status: row.status,
    pinned: row.pinned,
    createdBy: row.createdBy,
    componentIds: row.componentIds,
    labels: row.labels,
    updatedAt: row.updatedAt,
    createdAt: row.createdAt,
    rowSeq: row.rowSeq,
  };
  for (const k of OPTIONAL_ROW_KEYS) {
    if (row[k] !== undefined) out[k] = row[k];
    else delete out[k];
  }
  if (row.parentIdCurrent !== undefined) out.parentIdCurrent = row.parentIdCurrent;
  if (computeIAssigned(row, me)) out.iAssigned = true;
  else delete out.iAssigned;
  return out as T;
}

// ─────────────────────────── row-only change ─────────────────────────

/**
 * Event actions whose whole change is a field of the row (skein-api
 * `issues/events.go`): labels, pin, the legacy priority event, components.
 */
const ROW_ONLY_ACTIONS: ReadonlySet<string> = new Set([
  'label_added',
  'label_removed',
  'pinned',
  'unpinned',
  'priority_changed',
  'components_changed',
]);

/**
 * Names of `issue.updated`'s `changedFields` that are fields of the row
 * (`issues/fields.go#IssuePatchFields`). An explicit list on purpose: a name
 * this client does not know might be anything, and the card is re-read.
 */
const ROW_PATCH_FIELDS: ReadonlySet<string> = new Set(['title', 'type', 'priority']);

/**
 * Does the event change nothing but fields of the row — title, priority,
 * type, labels, components, pinned (US-15, the normative list)? Only then is
 * the open card patched; anything else (status, assignee — it changes the
 * accepter —, dates and estimate, blocking, texts, outcome, closing) re-reads
 * it. An `issue.updated` without field names (an older writer) is not.
 */
export function isRowOnlyChange(action: string, changedFields: readonly string[] | undefined): boolean {
  if (ROW_ONLY_ACTIONS.has(action)) return true;
  if (action !== 'updated' || changedFields === undefined || changedFields.length === 0) return false;
  return changedFields.every((f) => ROW_PATCH_FIELDS.has(f));
}

// ─────────────────────────── freshness store ─────────────────────────

/** Bound of the per-issue store; the oldest issue drops out first. */
export const MAX_TRACKED_ISSUES = 10_000;

/** An issue dropped from the store, with the order the tab had taken. */
interface Evicted {
  id: string;
  taken: number;
}

/**
 * Size of the awaiting set below which it is not swept (see
 * {@link RowFreshness.hold}).
 */
const MIN_AWAITING_SWEEP = 64;

/**
 * The greatest `rowSeq` of each issue taken from events in this tab. One per
 * `QueryCache` (= per tab: the provider keeps one QueryClient), so it
 * survives reconnects like the envelope dedup. Bounded: past
 * {@link MAX_TRACKED_ISSUES} the issue taken longest ago drops out of
 * `seen`. If a cached copy of it still shows less than the tab took, its
 * mark moves to `awaiting` and keeps judging freshness until no cached copy
 * is older — the repair read delivered an answer at or past it, or the copy
 * left the cache (see {@link releaseEvicted}). Only then freshness falls
 * back to the copies alone.
 *
 * Why `awaiting` is bounded too: an entry is needed only while a cached copy
 * of its issue is older than its mark, so the needed entries are at most the
 * issues the query cache holds copies of — and that cache is itself bounded
 * (what the screens loaded; unobserved queries are collected after
 * `gcTime`). Entries that stopped being needed are dropped when the issue's
 * next event consults them, and by a sweep: whenever the set reaches twice
 * its size after the previous sweep (at least {@link MIN_AWAITING_SWEEP}),
 * one pass over the cache keeps only the entries still needed. So the set
 * never holds more than twice the issues with an older cached copy (or
 * {@link MIN_AWAITING_SWEEP}), at the cost of one cache pass per doubling.
 */
class RowFreshness {
  private readonly seen = new Map<string, number>();
  private readonly awaiting = new Map<string, number>();
  private sweepAt = MIN_AWAITING_SWEEP;

  /**
   * The greatest `rowSeq` of `id` the tab took from an event and still has
   * to guard; 0 when none. An awaiting mark is kept while `olderCopy` says a
   * cached copy is older than it, and dropped otherwise.
   */
  taken(id: string, olderCopy: (id: string, mark: number) => boolean): number {
    const seen = this.seen.get(id);
    if (seen !== undefined) return seen;
    const mark = this.awaiting.get(id);
    if (mark === undefined) return 0;
    if (olderCopy(id, mark)) return mark;
    this.awaiting.delete(id);
    return 0;
  }

  /** Remember that `rowSeq` of `id` was taken; returns the issue dropped. */
  take(id: string, rowSeq: number): Evicted | undefined {
    const prev = this.seen.get(id) ?? this.awaiting.get(id) ?? 0;
    this.awaiting.delete(id);
    this.seen.delete(id);
    this.seen.set(id, Math.max(prev, rowSeq));
    if (this.seen.size <= MAX_TRACKED_ISSUES) return undefined;
    const [oldest, taken] = this.seen.entries().next().value as [string, number];
    this.seen.delete(oldest);
    return { id: oldest, taken };
  }

  /**
   * Keep the mark of a dropped issue whose cached copy is older than it.
   * `stillNeeded` answers, in one pass over the cache, which of the given
   * marks still have an older copy; it runs only when the set doubled.
   */
  hold(evicted: Evicted, stillNeeded: (marks: ReadonlyMap<string, number>) => ReadonlySet<string>): void {
    this.awaiting.set(evicted.id, evicted.taken);
    if (this.awaiting.size < this.sweepAt) return;
    const needed = stillNeeded(this.awaiting);
    for (const id of [...this.awaiting.keys()]) if (!needed.has(id)) this.awaiting.delete(id);
    this.sweepAt = Math.max(MIN_AWAITING_SWEEP, 2 * this.awaiting.size);
  }
}

const stores = new WeakMap<QueryCache, { owner: string; store: RowFreshness }>();

/**
 * The tab's freshness store — one per query cache AND signed-in identity. A
 * logout does not reload the page and keeps the query cache (it only marks
 * it stale), so the store would outlive the session; like the Inbox
 * snapshots (R12) it belongs to the identity that took the rows, and the
 * first event under another identity starts an empty one.
 */
function rowFreshnessOf(cache: QueryCache, me: string): RowFreshness {
  const s = stores.get(cache);
  if (s !== undefined && s.owner === me) return s.store;
  const store = new RowFreshness();
  stores.set(cache, { owner: me, store });
  return store;
}

/**
 * The greatest `rowSeq` any cached copy of issue `id` shows: list rows,
 * ancestor backfills, tree items, the card. A copy without the key, or with
 * 0 (a row not written since phase 2 was rolled out, R26; the Ready surface
 * does not carry it at all), counts as 0 — unknown: any event row with a
 * positive order is fresher than it.
 */
export function shownRowSeq(cache: QueryCache, id: string): number {
  let max = 0;
  visitCopies(cache, id, (_q, seq) => {
    if (seq > max) max = seq;
  });
  return max;
}

/**
 * Call `visit` for every cached copy of issue `id` (list rows, ancestor
 * backfills, tree items, the card) with its `rowSeq` — 0 when the copy has
 * none (R26: order unknown).
 */
function visitCopies(cache: QueryCache, id: string, visit: (q: Query, rowSeq: number) => void): void {
  walkCopies(cache, (copyId, q, seq) => {
    if (copyId === id) visit(q, seq);
  });
}

/**
 * Call `visit` for every cached copy of any issue (list rows, ancestor
 * backfills, tree items, cards) with its id and `rowSeq` (0 when none).
 */
function walkCopies(cache: QueryCache, visit: (id: string, q: Query, rowSeq: number) => void): void {
  for (const q of cache.getAll()) {
    const see = (v: unknown) => {
      if (!v || typeof v !== 'object') return;
      const o = v as { id?: unknown; rowSeq?: unknown };
      if (typeof o.id === 'string') visit(o.id, q, typeof o.rowSeq === 'number' ? o.rowSeq : 0);
    };
    const key = q.queryKey;
    const data: unknown = q.state.data;
    if (!data || typeof data !== 'object') continue;
    if (key[0] === 'issues' && key[1] === 'detail') {
      see(data);
      continue;
    }
    if (key[0] === 'issues' && key[1] === 'tree') {
      const rows = (data as { rows?: unknown }).rows;
      if (Array.isArray(rows)) for (const n of rows) see((n as { item?: unknown } | null)?.item);
      continue;
    }
    if (key[0] !== 'tasks') continue;
    if (Array.isArray(data)) {
      data.forEach(see);
      continue;
    }
    const pages = (data as { pages?: unknown }).pages;
    if (!Array.isArray(pages)) continue;
    for (const p of pages) {
      const items = (p as { items?: unknown } | null)?.items;
      if (Array.isArray(items)) items.forEach(see);
    }
  }
}

/** Does a cached copy of issue `id` show less than `mark`? */
function hasOlderCopy(cache: QueryCache, id: string, mark: number): boolean {
  let older = false;
  visitCopies(cache, id, (_q, seq) => {
    if (seq < mark) older = true;
  });
  return older;
}

/** Of the given marks, those whose issue has a cached copy older than the mark — one pass. */
function marksWithOlderCopy(cache: QueryCache, marks: ReadonlyMap<string, number>): ReadonlySet<string> {
  const needed = new Set<string>();
  walkCopies(cache, (id, _q, seq) => {
    const mark = marks.get(id);
    if (mark !== undefined && seq < mark) needed.add(id);
  });
  return needed;
}

/**
 * An issue dropped from the store. Its mark guards one thing: that a stale
 * event is not laid over copies a read started before an earlier event left
 * with an OLDER answer than that event's row. Freshness judged by the copies
 * alone still refuses a row not newer than every copy — a stale event can
 * never be laid over a copy at or past its own order. So the mark is
 * redundant when no copy shows less than it, and when no copy is cached at
 * all: then it is simply let go. Otherwise a cached copy is older than what
 * this tab already took: every reader holding a copy of the issue is
 * re-read, so the older answer is replaced by the server's rather than left
 * until a later event — and until that answer is delivered (the batcher's
 * window, a read in flight, a hidden tab that only takes obligations, an
 * inactive reader only marked stale) the mark stays in the store's awaiting
 * set, so a stale event in between is still refused.
 */
function releaseEvicted(qc: LiveInvalidationTarget, cache: QueryCache, store: RowFreshness, evicted: Evicted): void {
  const holders = new Set<Query>();
  let older = false;
  visitCopies(cache, evicted.id, (q, seq) => {
    holders.add(q);
    if (seq < evicted.taken) older = true;
  });
  if (!older) return;
  store.hold(evicted, (marks) => marksWithOlderCopy(cache, marks));
  for (const q of holders) void qc.invalidateQueries({ queryKey: q.queryKey, exact: true });
}

// ─────────────────────────── server order ────────────────────────────

const RFC3339_UTC = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?Z$/;

/**
 * Compare two wire timestamps at the server's precision (microseconds — a
 * `Date` keeps milliseconds only and would tie two writes of one
 * millisecond). UTC strings `…Z` compare by text with the fraction padded;
 * anything else falls back to `Date.parse`.
 */
export function compareTimestamps(a: string, b: string): number {
  const ma = RFC3339_UTC.exec(a);
  const mb = RFC3339_UTC.exec(b);
  if (ma && mb) {
    if (ma[1] !== mb[1]) return ma[1] < mb[1] ? -1 : 1;
    const fa = (ma[2] ?? '').padEnd(9, '0');
    const fb = (mb[2] ?? '').padEnd(9, '0');
    return fa === fb ? 0 : fa < fb ? -1 : 1;
  }
  return Math.sign(Date.parse(a) - Date.parse(b));
}

interface OrderedRow {
  id: string;
  updatedAt: string;
  createdAt: string;
}

/**
 * Server order of a Tasks-column list: negative when `a` comes first —
 * `(updated_at | created_at) DESC, id DESC` (`issues/store.go#ListIssues`,
 * keyset `(col, id) < (cursor)`).
 */
export function compareServerOrder(order: 'updated' | 'created', a: OrderedRow, b: OrderedRow): number {
  const ts = order === 'created'
    ? compareTimestamps(a.createdAt, b.createdAt)
    : compareTimestamps(a.updatedAt, b.updatedAt);
  if (ts !== 0) return -ts;
  if (a.id === b.id) return 0;
  return a.id < b.id ? 1 : -1;
}

// ───────────────────────────── applying ──────────────────────────────

interface TasksPageShape {
  items: IssueSummary[];
  hasMore?: boolean;
}

/** Does a read of this query run right now? */
function reading(q: Query): boolean {
  return q.state.fetchStatus === 'fetching';
}

/** Re-read one list from its first page (K21), through the batcher. */
function refetchFirstPage(qc: LiveInvalidationTarget, q: Query): void {
  void qc.invalidateQueries({ queryKey: q.queryKey, exact: true, firstPageOnly: true });
}

/**
 * Write a patched answer as a local write (`manual`, not a delivered read —
 * the batcher tells the two apart). The patch replaces one row, it does not
 * make the rest of the answer any fresher: TanStack's `success` (manual too,
 * `query.js#successState`, @tanstack/query-core 5.100.6) would clear
 * `isInvalidated` and move `dataUpdatedAt` to now, so an inactive list or
 * tree an earlier reaction marked stale would not re-read on mount within
 * its `staleTime`. The answer's own time is kept, and a mark already set is
 * set again.
 */
function write(q: Query, data: unknown): void {
  const { dataUpdatedAt, isInvalidated } = q.state;
  q.setData(data, { manual: true, updatedAt: dataUpdatedAt });
  if (isInvalidated) q.invalidate();
}

function isTasksPages(data: unknown): data is InfiniteData<TasksPageShape> {
  if (!data || typeof data !== 'object') return false;
  const pages = (data as { pages?: unknown }).pages;
  return Array.isArray(pages) && pages.every((p) => Array.isArray((p as { items?: unknown } | null)?.items));
}

/**
 * Decide one loaded list for the row (see the module header, «Lists»):
 * returns the new answer to write, `'refetch'` for a re-read from the first
 * page, or `null` when the list is not affected.
 */
export function decideTasksList(
  shape: TasksListServerShape,
  data: InfiniteData<TasksPageShape>,
  row: NeutralRow,
  me: string,
): InfiniteData<TasksPageShape> | 'refetch' | null {
  if (!shape.computable) return 'refetch';
  const flat: IssueSummary[] = [];
  for (const p of data.pages) flat.push(...p.items);
  const idx = flat.findIndex((r) => r.id === row.id);

  const member = shape.matches(row);
  const lastPage = data.pages[data.pages.length - 1];
  const hasMore = lastPage?.hasMore === true;
  const lastLoaded = flat[flat.length - 1];

  if (idx < 0) {
    if (!member) return null;
    // The whole list is loaded and the row is not in it — it entered.
    if (!hasMore || lastLoaded === undefined) return 'refetch';
    // It sorts within the loaded prefix — it entered; past it, the
    // continuation brings it in its turn.
    return compareServerOrder(shape.order, row, lastLoaded) <= 0 ? 'refetch' : null;
  }

  if (!member) return 'refetch';
  const after = layRowOntoSummary(flat[idx], row, me);
  // The continuation cursor is the last loaded row's key as the server cut
  // it. A row sorting after it while more pages exist would come again with
  // the next page (and leave a hole where it sat) — not a prefix any more.
  if (hasMore && lastLoaded !== undefined && compareServerOrder(shape.order, after, lastLoaded) > 0) {
    return 'refetch';
  }
  const rest = flat.filter((_, i) => i !== idx);
  let pos = rest.findIndex((r) => compareServerOrder(shape.order, after, r) < 0);
  if (pos < 0) pos = rest.length;
  rest.splice(pos, 0, after);
  // Same page sizes as loaded: the set is the same, only its order moved.
  let offset = 0;
  const pages = data.pages.map((p) => {
    const items = rest.slice(offset, offset + p.items.length);
    offset += p.items.length;
    return { ...p, items };
  });
  return { ...data, pages };
}

/** What phase 2 did with an event's row; `null` from the caller = no row. */
export interface EventRowOutcome {
  /** The row was fresher than everything shown and was laid in. */
  fresh: boolean;
  /** The event changes nothing but fields of the row (card patched, not re-read). */
  rowOnly: boolean;
  /**
   * A tree showing the issue had a read in flight: its patch may be
   * overwritten, so the caller re-reads the trees showing the issue.
   */
  treesNeedReset: boolean;
  /**
   * A tree (a column tree or an epic section) has no answer yet: what it
   * will show is unknown and its first read may have started before the
   * commit, so the caller re-reads the unanswered trees.
   */
  treesUnanswered: boolean;
  /**
   * The row's status gates readiness as a blocker (skein-api
   * `status.GatesReadiness`: neither closed nor standing).
   */
  gates: boolean;
}

/**
 * Apply an issue event's row (phase 2). Returns `null` when the envelope
 * carries no usable row — the caller then reacts as in phase 1. With
 * `layOnSurfaces: false` (issue created, re-parented — their lists and
 * trees are re-read by the caller) only the freshness is recorded.
 *
 * Every re-read goes through `qc` (in the app the coalescing batcher, so a
 * hidden tab only takes obligations, K22); patches are local writes into
 * the cache and send nothing.
 */
export function applyEventRow(
  qc: LiveInvalidationTarget,
  envelope: EventEnvelope,
  action: string,
  changedFields: readonly string[] | undefined,
  me: string,
  opts: { layOnSurfaces: boolean },
): EventRowOutcome | null {
  const row = readEventRow(envelope);
  if (row === null) return null;
  const cache = qc.getQueryCache();
  const store = rowFreshnessOf(cache, me);
  const rowOnly = isRowOnlyChange(action, changedFields);
  const taken = store.taken(row.id, (id, mark) => hasOlderCopy(cache, id, mark));
  const fresh = row.rowSeq > Math.max(taken, shownRowSeq(cache, row.id));
  const outcome: EventRowOutcome = {
    fresh,
    rowOnly,
    treesNeedReset: false,
    treesUnanswered: false,
    gates: row.status !== 'closed' && row.status !== 'standing',
  };
  if (fresh) {
    const evicted = store.take(row.id, row.rowSeq);
    if (evicted !== undefined) releaseEvicted(qc, cache, store, evicted);
  }
  if (!opts.layOnSurfaces) return outcome;
  outcome.treesUnanswered = rereadFirstReads(qc, cache, row, rowOnly, me);
  if (!fresh) {
    rereadOpaqueLists(qc, cache, row, me);
    return outcome;
  }

  layOnTaskLists(qc, cache, row, me);
  outcome.treesNeedReset = layOnTrees(cache, row, me);
  if (rowOnly) layOnCard(qc, cache, row);
  return outcome;
}

/**
 * Readers of the issue that have no answer yet: their first read may have
 * started before the commit and will then lay the older state, and the
 * envelope is not repeated (dedup on `id`). Each is re-read through `qc` —
 * the batcher carries the reset to the end of the read in flight — fresh row
 * or stale, as phase 1 re-read them on every event:
 *  - task lists the row can reach: of its project, «all», and the personal
 *    lenses (what they will show is unknown); a list of another project
 *    cannot hold it;
 *  - ancestor backfills (which rows they ask for is not on the key);
 *  - the card, on a row-only event (any other event re-reads it anyway).
 * Unanswered trees are reported to the caller (`true`), which resets them
 * together with the event's other tree resets and their catch-up clocks.
 */
function rereadFirstReads(
  qc: LiveInvalidationTarget,
  cache: QueryCache,
  row: NeutralRow,
  rowOnly: boolean,
  me: string,
): boolean {
  for (const q of cache.findAll({ queryKey: ['tasks'] })) {
    if (q.state.data !== undefined) continue;
    const key = q.queryKey;
    if (key[1] !== 'ancestors') {
      const shape = tasksListServerShape(key, me);
      if (shape === null) continue;
      if (shape.scope !== row.projectId && shape.scope !== 'all' && shape.scope !== 'personal') continue;
    }
    void qc.invalidateQueries({ queryKey: key, exact: true });
  }
  if (rowOnly) {
    const card = cache.find({ queryKey: ['issues', 'detail', row.id], exact: true });
    if (card !== undefined && card.state.data === undefined) {
      void qc.invalidateQueries({ queryKey: card.queryKey, exact: true });
    }
  }
  return cache.findAll({ queryKey: ['issues', 'tree'] }).some((q) => q.state.data === undefined);
}

/**
 * A row that is not fresher changes no list, but a list whose filter the row
 * cannot answer (`computable: false`) is still re-read from its first page,
 * as for a fresh row: what another copy of the issue shows says nothing
 * about what that filtered answer holds (US-15 — a stale row keeps the
 * other reactions of its matrix row, the lists with filters a row cannot
 * answer among them). Same reach as {@link layOnTaskLists}.
 */
function rereadOpaqueLists(qc: LiveInvalidationTarget, cache: QueryCache, row: NeutralRow, me: string): void {
  for (const q of cache.findAll({ queryKey: ['tasks'] })) {
    const data: unknown = q.state.data;
    const shape = tasksListServerShape(q.queryKey, me);
    if (shape === null || shape.computable || !isTasksPages(data)) continue;
    const shows = data.pages.some((p) => p.items.some((r) => r.id === row.id));
    const reachable = shape.scope === row.projectId || shape.scope === 'all';
    if (shows || reachable) refetchFirstPage(qc, q);
  }
}

function layOnTaskLists(qc: LiveInvalidationTarget, cache: QueryCache, row: NeutralRow, me: string): void {
  for (const q of cache.findAll({ queryKey: ['tasks'] })) {
    const key = q.queryKey;
    const data: unknown = q.state.data;
    if (key[1] === 'ancestors') {
      // A backfill of the tree view: a whole answer of rows.
      if (!Array.isArray(data) || !data.some((r: { id?: unknown }) => r?.id === row.id)) continue;
      write(q, data.map((r: IssueSummary) => (r.id === row.id ? layRowOntoSummary(r, row, me) : r)));
      if (reading(q)) void qc.invalidateQueries({ queryKey: key, exact: true });
      continue;
    }
    const shape = tasksListServerShape(key, me);
    // Not a list, or never answered — nothing shown, a reader reads fresh.
    if (shape === null || !isTasksPages(data)) continue;
    const shows = data.pages.some((p) => p.items.some((r) => r.id === row.id));
    const reachable = shape.scope === row.projectId || shape.scope === 'all';
    // A list of another project cannot hold the row; a personal lens takes
    // its membership from the personal signal `tasks` (K18) and only its
    // shown rows follow the event.
    if (!shows && !reachable) continue;
    const decision = decideTasksList(shape, data, row, me);
    if (decision === null) continue;
    if (decision === 'refetch') {
      refetchFirstPage(qc, q);
      continue;
    }
    write(q, decision);
    // The row stays a member and the set is the same: only the read in
    // flight could lay the older answer over the patch. Re-read the pages
    // as loaded (as phase 1 did), not from the first page — a tail the user
    // just scrolled in stays.
    if (reading(q)) void qc.invalidateQueries({ queryKey: key, exact: true });
  }
}

/** Patch every cached tree showing the issue; true if one was being read. */
function layOnTrees(cache: QueryCache, row: NeutralRow, me: string): boolean {
  let readInFlight = false;
  for (const q of cache.findAll({ queryKey: ['issues', 'tree'] })) {
    const next = patchLayeredTreeRow(
      q.state.data,
      row.id,
      (item) => layRowOntoSummary(item, row, me),
      { title: row.title, status: row.status },
    );
    if (next === undefined) continue;
    write(q, next);
    if (reading(q)) readInFlight = true;
  }
  return readInFlight;
}

/** Lay the row fields onto the cached card (row-only events). */
function layOnCard(qc: LiveInvalidationTarget, cache: QueryCache, row: NeutralRow): void {
  const q = cache.find({ queryKey: ['issues', 'detail', row.id], exact: true });
  const detail = q?.state.data as IssueDetail | undefined;
  if (q === undefined || detail === undefined) return;
  const next = layRowOntoIssueDetail(detail, row);
  if (next === undefined) return;
  write(q, next);
  if (reading(q)) void qc.invalidateQueries({ queryKey: q.queryKey, exact: true });
}
