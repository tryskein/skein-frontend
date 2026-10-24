/**
 * Live project declaration — which projects' events this tab needs
 * (spec sk-622.21 US-9, R1′, R2; plan T041, K18).
 *
 * The hub delivers a project's events only to connections that declared
 * that project (or the "all visible" mode). This module owns the tab's
 * declaration: it composes the set by the registry rule of the spec
 * (§"Surface registry", class 1 — rows of tasks) and sends it to the
 * hub through the browser contract of T030
 * (`DeclareProjects(string[])`, `DeclareAllVisible(boolean)`).
 *
 * The set, in priority order — the hub applies its per-connection limit
 * (`HUB_MAX_PROJECTS_PER_CONNECTION`) in declaration order, so the order
 * IS the priority under the limit:
 *   1. the project of the open route (registered by the tasks column);
 *   2. the project of the open issue card;
 *   3. the expanded rows of the projects column;
 *   4. the projects of the rows shown by any ACTIVE `['tasks', …]` or
 *      `['issues', 'tree', …]` query — every tasks-column surface (any
 *      view, any lens, "All projects", the board with or without focus)
 *      and the epic section — ordered by how many shown rows they own.
 *      Read straight from the query cache, so a new surface that keys its
 *      rows under those prefixes is declared without registering itself;
 *      the paste-a-blob mode keys its lookup elsewhere and stays out
 *      (out of scope, spec §"Surface registry").
 * The `/activity` page turns the "all visible" mode on while mounted.
 *
 * Sending: a change of the set is debounced ({@link DECLARE_DEBOUNCE_MS})
 * and sent once; re-composing the same set sends nothing. Sends are kept
 * under the hub's per-connection rate limit
 * ({@link DECLARE_RATE_LIMIT} per {@link DECLARE_RATE_WINDOW_MS}) — a
 * change past it waits for the window instead of being refused. Every
 * (re)connection starts with an empty server-side set, so
 * {@link ProjectDeclarationController.connect} declares at once, without
 * the debounce, and resolves when the declaration has been answered —
 * re-reading after a reconnect waits for it (US-14, edge 12). Rejections
 * are written to the console (edge 11); a rejection of one project never
 * affects the others.
 */

import { createContext, useContext, useEffect, useRef } from 'react';
import type { Query, QueryCache, QueryCacheNotifyEvent } from '@tanstack/react-query';
import {
  SkeinHubMethods,
  type DeclareRejection,
  type DeclareResult,
} from './eventEnvelope';

/**
 * Quiet period after the last change of the set before it is sent: 300 ms.
 * A burst of changes (navigation, pages of a list landing one by one,
 * folding rows) costs one call and stays clear of the hub's rate limit.
 * The price is a window of about 300 ms plus the call's round trip in
 * which rows of a newly shown project are on screen but its events are
 * not delivered yet; a change in that window is picked up by the
 * re-read on focus / navigation (registry class 3, R1′). A (re)connection
 * declares at once, without this wait.
 */
export const DECLARE_DEBOUNCE_MS = 300;

/**
 * The hub's per-connection rate limit on set changes (skein-web
 * `ISkeinHubDeclarations`: at most 10 changes per 10 s, both methods
 * count). Mirrored here so the tab waits instead of being refused.
 */
export const DECLARE_RATE_LIMIT = 10;
export const DECLARE_RATE_WINDOW_MS = 10_000;

/**
 * Back-off after a hub call that threw (transport error, or the hub's
 * access check failed — the hub then keeps the previous set). One retry
 * per entry, then the tab waits for the next change of the set or the
 * next (re)connection. Each retry still goes through the rate limit: the
 * failed call counts against it, because the hub spends the rate slot
 * before its access check (`SkeinHub.DeclareProjects`).
 */
export const DECLARE_RETRY_DELAYS_MS: readonly number[] = [1_000, 2_000, 5_000, 10_000, 30_000];

/** An explicitly registered source of declared projects. */
export type DeclarationSource = 'route' | 'card' | 'expanded';

/** Explicit sources in priority order; row projects follow them. */
const SOURCE_PRIORITY: readonly DeclarationSource[] = ['route', 'card', 'expanded'];

/** The part of the hub connection the declaration needs. */
export interface DeclarationHub {
  invoke<T = unknown>(methodName: string, ...args: unknown[]): Promise<T>;
}

export interface ProjectDeclarationController {
  /** Register or replace the projects of one explicit source entry. */
  setExplicit(token: object, source: DeclarationSource, projectIds: readonly string[]): void;
  /** Drop one explicit source entry. */
  clearExplicit(token: object): void;
  /** Turn one requester of the "all visible" mode on or off. */
  setAllVisible(token: object, enabled: boolean): void;
  /** Follow the rows of active queries in `cache`; returns the unsubscribe. */
  attachQueryCache(cache: QueryCache): () => void;
  /**
   * A connection (re)established: its server-side set is empty. Declares
   * the current set at once and resolves when the hub has answered (or
   * immediately when there is nothing to declare). Never rejects.
   */
  connect(hub: DeclarationHub): Promise<void>;
  /** The connection is gone; nothing is sent until the next connect. */
  disconnect(): void;
  /** The set as it would be declared now, in priority order. */
  computeProjectSet(): string[];
  /**
   * Projects currently registered under one explicit `source` — e.g. the
   * expanded rows of the projects column. The live reaction (T042, K18)
   * reads `'expanded'` to re-read a project's counters only while its row
   * is expanded.
   */
  explicitProjects(source: DeclarationSource): ReadonlySet<string>;
  /** Stop timers and detach from the query cache. */
  dispose(): void;
}

/** Is this query key one whose rows feed the declaration? */
function isRowQueryKey(key: readonly unknown[]): boolean {
  return key[0] === 'tasks' || (key[0] === 'issues' && key[1] === 'tree');
}

/**
 * Can this cache event change the rows of active row queries? Data moves
 * only on a `success` or `setState` update; whether a query is active
 * (`Query#isActive`: an observer whose `enabled` is not false) moves when
 * a query or an observer comes or goes, and when an observer's options
 * change — `enabled` is one of them (`QueryObserver#setOptions` notifies
 * `observerOptionsUpdated`). `observerResultsUpdated` follows a query
 * update already counted and changes neither data nor observers.
 */
function affectsShownRows(event: QueryCacheNotifyEvent): boolean {
  switch (event.type) {
    case 'added':
    case 'removed':
    case 'observerAdded':
    case 'observerRemoved':
    case 'observerOptionsUpdated':
      return true;
    case 'updated':
      return event.action.type === 'success' || event.action.type === 'setState';
    default:
      return false;
  }
}

function readProjectId(row: unknown): string | undefined {
  if (!row || typeof row !== 'object') return undefined;
  const direct = (row as { projectId?: unknown }).projectId;
  if (typeof direct === 'string' && direct.length > 0) return direct;
  // Tree rows wrap the issue: `{ item: { projectId }, depth, … }`. A
  // redacted item carries no projectId and is skipped.
  const item = (row as { item?: unknown }).item;
  if (item && typeof item === 'object') {
    const nested = (item as { projectId?: unknown }).projectId;
    if (typeof nested === 'string' && nested.length > 0) return nested;
  }
  return undefined;
}

function countRows(rows: unknown, counts: Map<string, number>): void {
  if (!Array.isArray(rows)) return;
  for (const row of rows) {
    const pid = readProjectId(row);
    if (pid !== undefined) counts.set(pid, (counts.get(pid) ?? 0) + 1);
  }
}

/**
 * Count shown rows per project in one query's data. The shapes are the
 * ones the row queries cache: an infinite list (`{ pages: [{ items }] }`,
 * every `['tasks', …]` surface), a flat row array (`['tasks','ancestors',…]`)
 * and the tree response (`{ rows: [{ item }] }`, `['issues','tree',…]`).
 */
function countQueryRows(data: unknown, counts: Map<string, number>): void {
  if (Array.isArray(data)) {
    countRows(data, counts);
    return;
  }
  if (!data || typeof data !== 'object') return;
  const pages = (data as { pages?: unknown }).pages;
  if (Array.isArray(pages)) {
    for (const page of pages) {
      if (page && typeof page === 'object') {
        countRows((page as { items?: unknown }).items, counts);
      }
    }
    return;
  }
  countRows((data as { rows?: unknown }).rows, counts);
  countRows((data as { items?: unknown }).items, counts);
}

function sameMembers(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

function hasRateRejection(rejected: readonly DeclareRejection[]): boolean {
  return rejected.some((r) => r.reason === 'rate');
}

function warnRejected(method: string, rejected: readonly DeclareRejection[]): void {
  if (rejected.length === 0) return;
  console.warn(`[live-events] ${method} rejected`, rejected);
}

function readRejected(result: unknown): DeclareRejection[] {
  const rejected = (result as Partial<DeclareResult> | null | undefined)?.rejected;
  return Array.isArray(rejected) ? rejected : [];
}

export function createProjectDeclaration(): ProjectDeclarationController {
  const explicit = new Map<object, { source: DeclarationSource; ids: readonly string[] }>();
  const allVisibleTokens = new Set<object>();
  let rowCounts = new Map<string, number>();

  let hub: DeclarationHub | null = null;
  /** Bumped on every connect / disconnect; stale answers are ignored. */
  let generation = 0;
  /**
   * The candidate set the hub holds for this connection — the ids of the
   * last answered call that the hub kept (everything but `limit` and
   * `invalid` rejections; `no_access` still takes a slot, as on the hub,
   * `SkeinHub.DeclareProjects`). Null = unknown, resend.
   */
  let declared: Set<string> | null = new Set();
  /**
   * The hub's per-connection limit as learned from its answers: the number
   * of candidates it kept when it cut a tail with `limit`. Null while no
   * answer has shown a cut. The limit is the hub's setting
   * (`HUB_MAX_PROJECTS_PER_CONNECTION`), so it is learned, not mirrored,
   * and forgotten on every (re)connection.
   */
  let knownLimit: number | null = null;
  /** The mode the server holds for this connection; null = unknown, resend. */
  let declaredAllVisible: boolean | null = false;
  /** Send times on this connection, for the rate limit. */
  let sendTimes: number[] = [];
  /** Consecutive failed calls on this connection; indexes the back-off. */
  let failures = 0;
  let runningGeneration = -1;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** Last composed set — a change of it (in members or order) arms the debounce. */
  let lastComposed: string[] = [];
  let lastAllVisible = false;

  function computeProjectSet(): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    const push = (id: string) => {
      if (id.length === 0 || seen.has(id)) return;
      seen.add(id);
      out.push(id);
    };
    for (const source of SOURCE_PRIORITY) {
      for (const entry of explicit.values()) {
        if (entry.source === source) entry.ids.forEach(push);
      }
    }
    const byFrequency = [...rowCounts.entries()].sort(
      (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0),
    );
    for (const [id] of byFrequency) push(id);
    return out;
  }

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function schedule(delayMs: number): void {
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      void run();
    }, delayMs);
  }

  /** A source changed: re-compose and arm the debounce if the outcome moved. */
  function changed(): void {
    const composed = computeProjectSet();
    const allVisible = allVisibleTokens.size > 0;
    if (sameOrder(composed, lastComposed) && allVisible === lastAllVisible) return;
    lastComposed = composed;
    lastAllVisible = allVisible;
    // A new wish starts a fresh back-off.
    failures = 0;
    if (hub !== null) schedule(DECLARE_DEBOUNCE_MS);
  }

  /** Milliseconds until one more send fits the rate limit (0 = now). */
  function rateWait(now: number): number {
    sendTimes = sendTimes.filter((t) => now - t < DECLARE_RATE_WINDOW_MS);
    if (sendTimes.length < DECLARE_RATE_LIMIT) return 0;
    return sendTimes[0] + DECLARE_RATE_WINDOW_MS - now;
  }

  /** A call threw: schedule the next bounded retry, if any is left. */
  function retryAfterFailure(): void {
    if (failures < DECLARE_RETRY_DELAYS_MS.length) {
      schedule(DECLARE_RETRY_DELAYS_MS[failures]);
    }
    failures += 1;
  }

  /**
   * Send what differs from the server's state, one call at a time, until
   * nothing differs. Re-composes before every call, so a change that lands
   * while a call is in flight is picked up by the same run.
   */
  async function run(): Promise<void> {
    const gen = generation;
    if (runningGeneration === gen) return;
    runningGeneration = gen;
    try {
      for (;;) {
        const conn = hub;
        if (conn === null || gen !== generation) return;
        const wantSet = computeProjectSet();
        const wantAll = allVisibleTokens.size > 0;
        // Under the hub's limit only the leading part of the set takes
        // effect, so that part is what must match: a project that rose
        // from the cut tail (became the route or the open card) changes
        // the kept part even though the members of the whole set did not.
        const wantKept = knownLimit === null ? wantSet : wantSet.slice(0, knownLimit);
        const projectsDiffer = declared === null || !sameMembers(wantKept, [...declared]);
        const modeDiffers = declaredAllVisible !== wantAll;
        if (!projectsDiffer && !modeDiffers) return;

        const now = Date.now();
        const wait = rateWait(now);
        if (wait > 0) {
          schedule(wait);
          return;
        }
        sendTimes.push(now);

        if (projectsDiffer) {
          let result: unknown;
          try {
            result = await conn.invoke<DeclareResult>(SkeinHubMethods.DeclareProjects, wantSet);
          } catch (err) {
            if (gen !== generation) return;
            console.warn('[live-events] DeclareProjects failed', err);
            declared = null;
            retryAfterFailure();
            return;
          }
          if (gen !== generation) return;
          failures = 0;
          const rejected = readRejected(result);
          warnRejected(SkeinHubMethods.DeclareProjects, rejected);
          if (hasRateRejection(rejected)) {
            // The previous set stays in force on the server; resend after
            // the window.
            schedule(DECLARE_RATE_WINDOW_MS);
            return;
          }
          const cut = new Set(
            rejected
              .filter((r) => r.reason === 'limit' || r.reason === 'invalid')
              .map((r) => r.projectId),
          );
          const kept = wantSet.filter((id) => !cut.has(id));
          if (rejected.some((r) => r.reason === 'limit')) {
            knownLimit = kept.length;
          } else if (knownLimit !== null && kept.length > knownLimit) {
            // The hub kept more than the learned limit: its setting changed.
            knownLimit = null;
          }
          declared = new Set(kept);
          continue;
        }

        let result: unknown;
        try {
          result = await conn.invoke<DeclareResult>(SkeinHubMethods.DeclareAllVisible, wantAll);
        } catch (err) {
          if (gen !== generation) return;
          console.warn('[live-events] DeclareAllVisible failed', err);
          declaredAllVisible = null;
          retryAfterFailure();
          return;
        }
        if (gen !== generation) return;
        failures = 0;
        const rejected = readRejected(result);
        warnRejected(SkeinHubMethods.DeclareAllVisible, rejected);
        if (hasRateRejection(rejected)) {
          declaredAllVisible = null;
          schedule(DECLARE_RATE_WINDOW_MS);
          return;
        }
        // Any other refusal is final for this mode value: remember it so
        // the same switch is not repeated until the wish changes.
        declaredAllVisible = wantAll;
      }
    } finally {
      if (runningGeneration === gen) runningGeneration = -1;
    }
  }

  return {
    setExplicit(token, source, projectIds) {
      explicit.set(token, { source, ids: [...projectIds] });
      changed();
    },
    clearExplicit(token) {
      if (explicit.delete(token)) changed();
    },
    setAllVisible(token, enabled) {
      const had = allVisibleTokens.has(token);
      if (enabled === had) return;
      if (enabled) allVisibleTokens.add(token);
      else allVisibleTokens.delete(token);
      changed();
    },
    attachQueryCache(cache) {
      const recount = () => {
        const counts = new Map<string, number>();
        for (const query of cache.getAll() as Query[]) {
          if (!isRowQueryKey(query.queryKey) || !query.isActive()) continue;
          countQueryRows(query.state.data, counts);
        }
        rowCounts = counts;
        changed();
      };
      recount();
      const unsubscribe = cache.subscribe((event) => {
        if (isRowQueryKey(event.query.queryKey) && affectsShownRows(event)) recount();
      });
      return () => {
        unsubscribe();
        rowCounts = new Map();
        changed();
      };
    },
    connect(nextHub) {
      clearTimer();
      generation += 1;
      hub = nextHub;
      declared = new Set();
      knownLimit = null;
      failures = 0;
      declaredAllVisible = false;
      sendTimes = [];
      lastComposed = computeProjectSet();
      lastAllVisible = allVisibleTokens.size > 0;
      return run();
    },
    disconnect() {
      clearTimer();
      generation += 1;
      hub = null;
    },
    computeProjectSet,
    explicitProjects(source) {
      const out = new Set<string>();
      for (const entry of explicit.values()) {
        if (entry.source === source) entry.ids.forEach((id) => out.add(id));
      }
      return out;
    },
    dispose() {
      clearTimer();
      generation += 1;
      hub = null;
    },
  };
}

/**
 * The tab's declaration controller, provided by `LiveEventsProvider`.
 * Null outside the provider — the registration hooks below are then
 * no-ops, so a surface rendered without live events (a test, a page
 * outside the shell) needs no stub.
 */
export const ProjectDeclarationContext = createContext<ProjectDeclarationController | null>(null);

/**
 * Register projects shown by this component as an explicit source of the
 * declaration. Null / undefined / empty ids are ignored; the entry is
 * dropped on unmount.
 */
export function useDeclareProjects(
  source: DeclarationSource,
  projectIds: ReadonlyArray<string | null | undefined>,
): void {
  const controller = useContext(ProjectDeclarationContext);
  const tokenRef = useRef<object>({});
  const key = projectIds
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
    .join('\n');
  useEffect(() => {
    if (controller === null) return;
    controller.setExplicit(tokenRef.current, source, key === '' ? [] : key.split('\n'));
  }, [controller, source, key]);
  useEffect(() => {
    if (controller === null) return;
    const token = tokenRef.current;
    return () => controller.clearExplicit(token);
  }, [controller]);
}

/**
 * Keep the "all projects visible to me" mode on while this component is
 * mounted and `enabled` is true (the `/activity` page, R2).
 */
export function useDeclareAllVisible(enabled: boolean): void {
  const controller = useContext(ProjectDeclarationContext);
  const tokenRef = useRef<object>({});
  useEffect(() => {
    if (controller === null) return;
    const token = tokenRef.current;
    controller.setAllVisible(token, enabled);
    return () => controller.setAllVisible(token, false);
  }, [controller, enabled]);
}
