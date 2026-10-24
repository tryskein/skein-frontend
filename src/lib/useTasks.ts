/**
 * Tasks-column data hook (F4, Sc3).
 *
 * Resolves the right backend call from URL + outbox-mode + filter UI
 * state, returns a ready-to-render slice for `TasksColumn`. The query
 * key always starts with `'tasks'` so the live-event invalidation
 * router can match it via predicate without knowing every filter
 * permutation.
 *
 * Four surfaces:
 *
 *   1. Project selected, outboxMode OFF
 *        → GET /api/v1/projects/{pid}/issues with status / origin /
 *          search filters. The default surface — every task in the
 *          project the user can see.
 *
 *   2. Project selected, outboxMode ON
 *        → Same endpoint as (1) but with `createdBy=me`. Filtered
 *          per-project Outbox.
 *
 *   3. No project selected, outboxMode ON
 *        → GET /api/v1/me/created-by. Cross-project Outbox.
 *
 *   4. No project selected, outboxMode OFF
 *        → GET /api/v1/issues — cross-project list of every task the
 *          caller can see (visibility-filtered server-side). Powers
 *          the "All projects" surface. Server-side `q` search, single
 *          status / type filters, origin grouping, sort, cursor
 *          pagination.
 *
 *   sk-674.18 T052 — the place «space» (screens 1.7) is the third branch
 *   beside «no project» and «project»: the same cross-project surfaces
 *   (3, 4, the On me `/me/assigned-to` and the search) with `space=<id>`
 *   on the wire, so the Delegated lens narrows the place exactly as it
 *   narrows «All projects» (`createdBy=me` via `/me/created-by`, whose
 *   `myOutbox*` counters follow `space`). A space missing from «my
 *   spaces» is `'space-not-found'` and nothing is fetched — an
 *   inaccessible space and a nonexistent one read the same.
 *
 * Pagination model:
 *   Migrated from a single `useQuery` (hard-coded 100 per page) to
 *   `useInfiniteQuery` so the Tasks column can paginate beyond the
 *   first page. First page is 500 rows (the new server cap); the
 *   sentinel-driven IntersectionObserver in TasksColumn triggers
 *   `fetchNextPage()` as the user scrolls. Mirrors the Projects
 *   column shape (`useProjectsInfinite`).
 *
 * The wire `sort` param accepts only `'updated' | 'created'`. The F4
 * column also offers `priority` and `priority-updated` (default,
 * Q30) — those are realised client-side after the fetch returns.
 *
 * Search (sk-44.2 — unified hybrid RRF):
 *   - Project-scoped + "All projects" surfaces route to the hybrid
 *     `GET /api/v1/search` endpoint (`globalSearch`, kind=['issue'])
 *     the moment the search box is non-empty. RRF fuses vector recall
 *     + dual-FTS over title/description/acceptance/design/notes, so
 *     the box now finds semantic matches the old `text=` ILIKE / `q=`
 *     FTS paths missed. `project=<uuid>` scopes to one project; absent
 *     = every visible project. The legacy `text=` (B1) and `q=` (B2)
 *     search branches were removed.
 *   - The cross-project lens surfaces (`/me/created-by` outbox,
 *     `/me/assigned-to` on-me) STAY client-side: RRF can't express the
 *     `createdBy=me` / `assignee=me` ownership predicate those lenses
 *     are built on (the /search wire shape has no createdBy/assignee
 *     filter), so routing them to RRF would silently drop the lens.
 *     `clientSearch` over the fetched lens rows preserves the ownership
 *     scope.
 *
 * Project alias → projectId resolution:
 *   - `useProjectsList()` already runs at the Shell level so its cache
 *     is hot. We look the project up by `idPrefix === alias` (the
 *     URL shape produced by `setSelectedProject`). If not found —
 *     either the alias is a non-canonical alias or the project was
 *     just unhidden — we surface a `'project-not-found'` empty state
 *     and skip the fetch.
 *
 * `total` semantics (header counter):
 *   Non-search mode — the first page response carries an authoritative
 *   server-side COUNT(*) over the same WHERE clause as items[] (sans
 *   cursor). We surface that value on `UseTasksResult.total`. Caveats —
 *   these mirror the Projects column policy:
 *     - `statusFilter === 'active'`, the `typeFilter` post-filter
 *       on /me/created-by, and the `priorityFilter` post-filter on the
 *       cross-project + /me surfaces (sk-86) are client-side, so `total`
 *       will sit ≥ displayed-row-count when those filters narrow the
 *       result. (On the project-scoped + search surfaces priority IS a
 *       wire param, so `total` there reflects it exactly.)
 *     - Client-side search on /me/created-by narrows the visible
 *       list below `total`.
 *     - sk-103 — Tree view also makes the visible-row count < `total`:
 *       subtrees collapse, so loaded issues sit hidden under collapsed
 *       ancestors. `total` stays an honest flat count; the Tasks header
 *       surfaces the gap as "N · M collapsed" (M = hidden loaded rows)
 *       rather than shrinking the number itself.
 *   Search mode (sk-44.2) — the hybrid `/search` endpoint does NOT
 *   return an exact COUNT(*) (RRF fuses unbounded vector + FTS rank
 *   lists; a true count would mean fully materialising both sides).
 *   Surfacing a fake number would be dishonest, so we report the count
 *   of rows the column has actually LOADED so far (`data.length` after
 *   client post-filters). It grows as the user scrolls more pages and
 *   never claims more than is on screen. The header reads "Tasks · N
 *   loaded" semantics rather than "N total matches" — the trade-off is
 *   documented here and in the comment at the `total` computation.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import {
  listAllIssues,
  listAssignedToMe,
  listCreatedByMe,
  listIssues,
  type IssueSource,
  type IssueStatus,
  type IssueSummary,
  type OriginFilter,
  type PriorityFilter,
  type StatusFilter,
  type TasksSortKey,
  type TypeFilter,
} from '../api/issues';
import { globalSearch, type SearchItem } from '../api/search';
import type { PersonStatus } from '../api/users';
import { useProjectByHandle } from './useProjectByHandle';
import { compareIssuesBy } from './taskSort';
import { compareStanding } from './standingOrder';

export type TasksEmptyReason =
  | 'no-results'
  | 'project-not-found'
  /** sk-674.18 T052 — the place names a space that is not among «my spaces». */
  | 'space-not-found'
  | null;

/**
 * sk-44.2 — one page of the Tasks-column infinite query. Structurally a
 * superset of `ListIssuesResult` plus an optional `degraded` flag that
 * only the hybrid `/search` (RRF) branch populates (true = embedder was
 * down, results are FTS-only). The list-endpoint branches omit it
 * (undefined) — they have no notion of a degraded retriever.
 */
interface TasksPage {
  items: IssueSummary[];
  total?: number;
  nextCursor?: string | null;
  hasMore: boolean;
  /** sk-44.2 — search-mode only. undefined on list-endpoint pages. */
  degraded?: boolean;
}

/**
 * Per-page row count for every Tasks-column surface. 500 = server cap
 * (raised from 100 alongside the infinite-scroll work). Most users see
 * everything in one page; the sentinel kicks `fetchNextPage` for the
 * tail end.
 */
const PAGE_SIZE = 500;

/**
 * sk-44.2 — per-page row count for the hybrid `/search` (RRF) endpoint.
 * The endpoint clamps `limit` to 1..100 server-side (it materialises
 * vector + FTS rank lists per page, so the cap is much lower than the
 * 500-row list endpoints). 100 = the server max; the infinite-scroll
 * sentinel pages the rest in.
 */
const PAGE_SIZE_SEARCH = 100;

export interface UseTasksArgs {
  /** Alias / idPrefix from the URL (or null = "All projects" pseudo). */
  selectedProject: string | null;
  /**
   * sk-674.18 T052 — the id of the space that is the selected place, or
   * null. Only read while `selectedProject` is null (the two places never
   * coexist); narrows every cross-project surface with `space=<id>`.
   * Omitted — no space is the place, as before the place existed.
   */
  selectedSpace?: string | null;
  /**
   * sk-674.18 T052 — what «my spaces» says of `selectedSpace`, the
   * caller's oracle (`useMySpaces`): `'resolving'` while it loads (the
   * list waits — a request for a space about to be refused would flash
   * its error first), `'not-found'` when the space is not in it (an
   * inaccessible space and a nonexistent one read the same, nothing is
   * fetched), `'found'`, or `'unknown'` when «my spaces» cannot answer
   * (the list goes out and the server decides). Omitted — `'unknown'`.
   */
  selectedSpaceStatus?: 'resolving' | 'found' | 'not-found' | 'unknown';
  /**
   * Component UUID from the URL or null. Only meaningful when
   * `selectedProject` is non-null — components live under a project,
   * so the cross-project Outbox surface ignores this field. The
   * project-scoped surface forwards it as `componentId={cid}` on the
   * wire and includes it in the cache key so different components
   * don't share cached pages.
   */
  selectedComponent: string | null;
  /** Outbox-mode toggle from layout state (header bar). */
  outboxMode: boolean;
  /**
   * sk-30 — "On me" lens toggle from layout state. Mutually exclusive
   * with `outboxMode` (mutex enforced in useLayoutState); when ON the
   * Tasks column narrows to issues assigned to the caller by someone
   * else that the caller has accepted (assignee=me ∧ createdBy=not-me
   * ∧ acceptedAt=not-null ∧ status=open).
   */
  onMeMode: boolean;
  /** Status filter buttons in the column header. `'all'` = no filter. */
  statusFilter: StatusFilter;
  /** Source / origin filter buttons. `'all'` = no filter. */
  originFilter: OriginFilter;
  /**
   * Type filter pills (bug/feature/task/.../note + 'all'). The
   * cross-project `/api/v1/issues` surface accepts `type=` on the
   * wire; the project-scoped and `/me/created-by` surfaces don't,
   * so we post-filter for those two.
   */
  typeFilter: TypeFilter;
  /**
   * sk-86 — priority filter pills. `'all'` = no filter. Wire support is
   * split (mirror image of `typeFilter`): the project-scoped `listIssues`
   * and the hybrid `/search` (`globalSearch`) endpoints accept a
   * `priority=<int>` param, so we forward it there; the cross-project
   * `/api/v1/issues` and the `/me/*` lens surfaces have no wire `priority`,
   * so we post-filter those by `item.priority` after the fetch.
   */
  priorityFilter: PriorityFilter;
  /** Search box (already debounced by the caller). */
  search: string;
  /**
   * Sort dropdown — affects client-side ordering.
   *
   * The KEY only. There is deliberately no `sortDir` beside it: this
   * hook is the ONE query behind every body of the Tasks column (Cards,
   * Kanban and the tree all read its `data`), and the direction is a
   * property of the TREE TABLE alone — see «Direction belongs to the
   * tree table» in `lib/taskSort.ts`. Whatever key is in force, the list
   * this hook returns is ordered in that key's NATURAL direction, and
   * the tree re-orders its own rows on top of that
   * (`buildIssueTree` / `sortDfsBlocks` in `TasksColumn`).
   *
   * Do not add the direction back here: a heading click in the table
   * would then invert the Cards list and the order inside every Kanban
   * column — the board does not even print a sort indicator, so the
   * change would arrive with nothing on screen to explain it.
   */
  sort: TasksSortKey;
  /**
   * sk-79 — assignee filter (username) or null for "anyone". Forwarded as
   * `assignee=<username>` to the project-scoped (`listIssues`) and
   * cross-project (`listAllIssues`) list surfaces, which the backend
   * filters server-side. The hybrid `/search` (RRF) endpoint has no
   * assignee param, so in search mode it is realised client-side over the
   * fetched rows (`item.assignee`). The caller (TasksColumn) only ever
   * supplies a non-null value on the non-lens surfaces where the avatar
   * picker is shown — under the outbox / on-me lenses the picker is
   * hidden and this stays null.
   */
  assigneeFilter: string | null;
}

/**
 * One person among the assignees of the loaded tasks (the chip source of
 * the assignee filter). sk-674.18 T055 (review C4) — with their state as
 * the rows carry it (`IssueSummary.assigneeStatus`), so the filter marks a
 * departed or deleted person as every other place people are shown does.
 */
export interface LoadedAssignee {
  username: string;
  userId: string | null;
  status?: PersonStatus;
}

/**
 * The state of one person over several rows — which may be issues of
 * different spaces. A deletion is of the account, so one deleted row says
 * it for all. A departure is from ONE space: the person is marked departed
 * only when every row says so — departed from Acme yet still in Zeta is,
 * on a board of both, a person who is still here. A row without a state
 * (an api that does not serve it yet) knows nothing and so is not
 * «departed».
 */
export function mergeAssigneeStatus(
  acc: PersonStatus | undefined,
  next: PersonStatus | undefined,
  first: boolean,
): PersonStatus | undefined {
  const deleted = (acc?.deleted === true) || (next?.deleted === true);
  const departed = first ? next?.departed === true : acc?.departed === true && next?.departed === true;
  if (!deleted && !departed) return undefined;
  return {
    deleted,
    departed: !deleted && departed,
    pseudonym: (acc?.deleted ? acc.pseudonym : undefined) ?? (next?.deleted ? next.pseudonym : undefined) ?? null,
  };
}

export interface UseTasksResult {
  data: IssueSummary[] | undefined;
  /**
   * Server-side count for the same WHERE clause as items[] (taken
   * from the first page; 0 while loading or for the project-not-found
   * branch). Drives the Tasks-column header "Tasks · N" counter.
   */
  total: number;
  /** True when more pages exist server-side. */
  hasNextPage: boolean;
  /** True while a `fetchNextPage()` is in flight. */
  isFetchingNextPage: boolean;
  /** Kick the next-page fetch; no-op when `hasNextPage` is false. */
  fetchNextPage: () => void;
  isLoading: boolean;
  error: unknown;
  emptyReason: TasksEmptyReason;
  /**
   * sk-44.2 — true when the column is in search mode AND the hybrid
   * `/search` endpoint reported `degraded:true` (embedder down →
   * FTS-only recall). The column surfaces a non-blocking hint; it is
   * NOT an error. Always false outside search mode.
   */
  searchDegraded: boolean;
  /**
   * sk-44.2 — true when the column is in hybrid-search mode (the RRF
   * `/search` endpoint is driving the list). Exposed so the column
   * header can render the count with a "loaded so far" affordance
   * rather than implying an authoritative total (see `totalIsExact`).
   */
  searchMode: boolean;
  /**
   * sk-44.2 — true when `total` is an authoritative server-side COUNT(*)
   * over the same WHERE clause as items[] (the list-endpoint surfaces).
   * False in search mode, where RRF returns no COUNT and `total` is the
   * count of rows LOADED so far (grows on scroll). The header reads this
   * to disambiguate "12 matches" from "12 loaded so far" — see the
   * `total` computation and the module-header note.
   */
  totalIsExact: boolean;
  /**
   * Resolved project UUID for the currently-selected URL handle, or
   * null when no project is selected / handle didn't resolve.
   * Exported so callers (TasksColumn) can fire sibling queries scoped
   * to the same project — e.g. component-name lookup for card meta.
   */
  resolvedProjectId: string | null;
  /**
   * sk-84 — distinct assignees of the loaded delegated tasks (the people the
   * caller delegated to). Populated only under the Delegated lens
   * (outboxMode); empty otherwise. Derived from the list BEFORE the
   * client-side assignee filter, so it stays complete regardless of the
   * currently-picked delegatee. TasksColumn turns this into the chip row.
   */
  delegateeAssignees: LoadedAssignee[];
  /**
   * sk-285.5.5 — distinct assignees of the tasks LOADED in the column, on
   * EVERY surface (unlike {@link delegateeAssignees}, which is empty outside
   * the Delegated lens). Feeds the cross-project "All projects" assignee
   * chip row, which used to fetch the entire org directory.
   *
   * Stays complete while an assignee is picked, by two different means
   * depending on the surface (review F1): where the assignee filter is
   * applied client-side (search mode, Delegated lens) the rows in hand are
   * already un-narrowed; where it goes on the wire (the list surfaces) this
   * serves the last set observed while NOTHING was picked. Either way,
   * picking one person never collapses the chip row to that one person.
   *
   * It is NOT a guarantee that the picked assignee appears here — somebody
   * chosen through the directory search may have no task on the board at
   * all. TasksColumn appends the pick to the chip options so the filter is
   * always removable.
   */
  loadedAssignees: LoadedAssignee[];
  /** Stable query key — exported for tests + live-event invalidation matching. */
  cacheKey: readonly unknown[];
}

/**
 * Map our wire-supported sort buckets to what the backend accepts.
 * Priority-driven sorts fall through to `'updated'` (a sensible
 * baseline) and are re-sorted client-side after the fetch.
 */
function wireSort(sort: TasksSortKey): 'updated' | 'created' {
  if (sort === 'created') return 'created';
  // 'updated' | 'priority' | 'priority-updated' all map to 'updated' on
  // the wire; the priority-aware variants are client-side realised.
  return 'updated';
}

/**
 * The fields of a list row the server-side WHERE of a Tasks-column list can
 * test, as a phase-2 event row carries them (sk-622.21 US-15, K17).
 */
export type ServerFilterRow = Pick<
  IssueSummary,
  'projectId' | 'status' | 'type' | 'priority' | 'componentIds' | 'acceptedAt' | 'assignee' | 'assigneeUserId' | 'createdBy'
>;

/**
 * sk-622.21 (US-15, T049) — what the SERVER does for one cached
 * `['tasks', …]` list: which rows it returns and in what order it cuts
 * pages. Decoded from the key built by {@link useTasks} (`cacheKey`) and
 * mirroring, wire parameter by wire parameter, the `queryFn` above and the
 * skein-api WHERE it reaches (`issues/store.go#ListIssues`,
 * `issues/list_all.go#buildAllIssuesWhere`). Client-side post-filters
 * (`active`, the type pill on the project list, the priority pill on the
 * cross-project list, the delegated assignee pick) are NOT part of it: they
 * narrow what the column shows, not what the server pages over, and they
 * are re-applied to the patched rows by the `data` memo.
 *
 *  - `computable` — every condition is a field the phase-2 row carries:
 *    status, type, priority, assignee / «me», author / «me», component,
 *    project. `matches` answers membership of a row, `order` is the wire
 *    sort (`updated_at DESC, id DESC` or `created_at DESC, id DESC`).
 *  - `opaque` — a condition the row cannot answer: the source filter (the
 *    row has no `source`), blocked-ness and the unreviewed selection
 *    (reader's horizon), the delegated lens (previous assignees and
 *    dismissals are not on the row), a text search (relevance order). Such
 *    a list is re-read from the first page (K21).
 *
 * sk-674.18 T052 — a list of the place «space» (the space id, last in
 * the cross-project and `/me/*` keys) is `opaque`: the event row does not
 * say which space its project lives in, so whether it belongs is not
 * answerable and the list is re-read from the first page.
 *
 * `scope` says which events can reach the list: a project UUID, `'all'`
 * (every project the reader sees) or `'personal'` (the `/me/*` lenses —
 * their membership follows the personal signal `tasks`, not project
 * events; only the rows they show follow the event, computable or not). `null` for keys that are not a list (`['tasks','ancestors',…]`,
 * `['tasks','not-found',…]`).
 */
export type TasksListServerShape =
  | {
      computable: true;
      scope: string;
      order: 'updated' | 'created';
      matches: (row: ServerFilterRow) => boolean;
    }
  | { computable: false; scope: string };

export function tasksListServerShape(
  key: readonly unknown[],
  me: string,
): TasksListServerShape | null {
  if (key[0] !== 'tasks') return null;
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  switch (key[1]) {
    case 'search':
      // RRF relevance order and a text match: nothing a row can answer.
      return { computable: false, scope: str(key[2]) || 'all' };
    case 'me': {
      // `['tasks','me',lens,status,origin,type,priority,search,sort,space]`. Only
      // «on me» (`/me/assigned-to`) is computable: `ua.id = me`, `created_by
      // <> me`, `accepted_at IS NOT NULL`, the status, the source, the order
      // fixed at `updated_at DESC, id DESC` (skein-api
      // `issues/list_by_user.go`); type, priority, search and sort are
      // client-side here. «Delegated» (`/me/created-by`) also matches
      // previous assignees and dismissals, which the row does not carry.
      const status = str(key[3]);
      const origin = str(key[4]);
      const space = str(key[9]);
      if (key[2] !== 'on-me' || origin !== 'all' || !statusComputable(status) || space !== '') {
        return { computable: false, scope: 'personal' };
      }
      return {
        computable: true,
        scope: 'personal',
        order: 'updated',
        matches: (row) =>
          row.assigneeUserId === me
          && row.createdBy !== undefined
          && row.createdBy !== me
          && !!row.acceptedAt
          && personalStatusMatches(status, row.status),
      };
    }
    case 'project': {
      const pid = str(key[2]);
      const lens = str(key[3]);
      const status = str(key[4]);
      const origin = str(key[5]);
      const priority = str(key[7]);
      const component = str(key[8]);
      const sort = str(key[10]) as TasksSortKey;
      const assignee = str(key[11]);
      if (lens === 'outbox' || origin !== 'all' || !statusComputable(status)) {
        return { computable: false, scope: pid };
      }
      return {
        computable: true,
        scope: pid,
        order: wireSort(sort),
        matches: (row) =>
          row.projectId === pid
          && statusMatches(status, row.status)
          && (priority === 'all' || priority === '' || row.priority === Number(priority))
          && (component === '' || row.componentIds.includes(component))
          && (lens === 'on-me'
            // `assignee=me ∧ createdBy=not-me ∧ acceptedAt=not-null`: the
            // server matches «me» on the resolved user (`ua.id`), the very
            // join the row's `assigneeUserId` comes from.
            ? row.assigneeUserId === me
              && row.createdBy !== undefined
              && row.createdBy !== me
              && !!row.acceptedAt
            // `assignee=<username>` is exact text equality (`i.assignee = $`).
            : assignee === '' || row.assignee === assignee),
      };
    }
    case 'all': {
      const status = str(key[3]);
      const origin = str(key[4]);
      const type = str(key[5]);
      const sort = str(key[8]) as TasksSortKey;
      const assignee = str(key[9]);
      const space = str(key[10]);
      if (origin !== 'all' || !statusComputable(status) || space !== '') {
        return { computable: false, scope: 'all' };
      }
      return {
        computable: true,
        scope: 'all',
        order: wireSort(sort),
        matches: (row) =>
          statusMatches(status, row.status)
          && (type === 'all' || type === '' || row.type === type)
          // `LOWER(i.assignee) = LOWER($)` on this endpoint.
          && (assignee === '' || (row.assignee ?? '').toLowerCase() === assignee.toLowerCase()),
      };
    }
    default:
      return null;
  }
}

/**
 * Status pills the server answers with a plain `status=` (or with nothing):
 * `all` and `active` send no status (`active` drops closed rows client-side),
 * a concrete status sends itself. `blocked` and `unreviewed` are relations to
 * the reader, not columns of the row.
 */
function statusComputable(status: string): boolean {
  return status !== 'blocked' && status !== 'unreviewed';
}

function statusMatches(filter: string, status: IssueStatus): boolean {
  return filter === 'all' || filter === 'active' || filter === '' || status === filter;
}

/**
 * The status condition of a `/me/*` read: `all` sends `includeClosed`, a
 * concrete status sends itself, and no status keeps the server's default —
 * active work only, neither closed nor standing (`status.ActiveWork`).
 */
function personalStatusMatches(filter: string, status: IssueStatus): boolean {
  if (filter === 'all') return true;
  if (filter === 'active' || filter === '') return status !== 'closed' && status !== 'standing';
  return status === filter;
}

/**
 * sk-118 (decision #6, §11.12) — MANDATORY top band. Standing
 * (perpetual-obligation) tasks ALWAYS render above every other task, in
 * EVERY sort order (updated / created / priority / id), INDEPENDENT of
 * the `pinned` flag. Implemented as a stable pre-sort partition:
 *
 *   [ standing block (priority ASC, then updatedAt DESC) ] ++ [ rest ]
 *
 * Within the standing block the order is priority→recency (decision #6);
 * the non-standing tail keeps whatever order the caller's chosen sort
 * produced (`rest` is already `clientSort`-ed when this runs after it).
 * The partition is stable (relative order inside each bucket is
 * preserved by Array.filter), so a standing task that is also `pinned`
 * still floats by status, not by the pin.
 *
 * Exported for unit testing the band invariant.
 */
export function partitionStanding(items: IssueSummary[]): IssueSummary[] {
  const standing = items.filter((i) => i.status === 'standing');
  if (standing.length === 0) return items;
  const rest = items.filter((i) => i.status !== 'standing');
  // Order the standing block priority ASC (P0 first), then most-recent
  // updatedAt — its own internal ranking, decoupled from the active sort.
  // sk-135 — `compareStanding` is the SHARED primitive the Tree path
  // (`partitionStandingTreeRows`) reuses, so Cards and Tree agree.
  const standingSorted = [...standing].sort(compareStanding);
  return [...standingSorted, ...rest];
}

/**
 * Order a loaded page by the active sort key, in that key's NATURAL
 * direction.
 *
 * sk-285.2.19 (step 4) — the comparator itself lives in `lib/taskSort.ts`
 * and is the SAME one the tree hands `buildIssueTree` for its sibling
 * order. It used to be written out here as a second copy, which is how
 * one stored preference could come to mean two different orders in two
 * views of one column.
 *
 * sk-285.2.19 (step 5) — no `direction` parameter, on purpose: this
 * function orders the list EVERY body of the column shares, and the
 * direction is the tree table's own (`compareIssuesBy(sort, sortDir)`
 * there). Passing one in here is exactly the leak
 * `TasksSortDirectionScope.test.tsx` guards.
 *
 * BOUNDARY: this orders the pages that are LOADED, not the project. The
 * wire sort is coarse (`wireSort`) and every list surface is re-ranked
 * client-side afterwards, so with another page still unfetched the head
 * of this list is the best of what has arrived — not of what exists.
 * That has been true of every key since the column was written; the
 * direction inherits it rather than introducing it.
 *
 * `relevance` is not re-ordered (its comparator answers 0 for every
 * pair, and the caller skips this call entirely) — the server's RRF
 * ranking is the order.
 */
function clientSort(
  items: IssueSummary[],
  sort: TasksSortKey,
): IssueSummary[] {
  // Stable sort — clone first so the cached list isn't mutated.
  const copy = [...items];
  copy.sort(compareIssuesBy(sort));
  return copy;
}

/**
 * Client-side text search for the cross-project `/me/created-by`
 * surface — the endpoint doesn't accept `text=` on the wire. We
 * lowercase + substring on the title only (matching the project-scoped
 * server-side semantics). Empty query returns the input unchanged.
 */
function clientSearch(items: IssueSummary[], query: string): IssueSummary[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((i) => i.title.toLowerCase().includes(q));
}

/**
 * sk-44.2 — map the column's `OriginFilter` onto the hybrid `/search`
 * endpoint's `source` param. `/search`'s `source` filters on the
 * creator-set `issues.source` column (closed set `human` /
 * `agent_directed` / `agent_autonomous`), whereas the column's origin
 * chips are the broader `human-driven` / `agent-autonomous` grouping.
 * The closest honest mapping (sk-421.1 US-11):
 *   human-driven      → human             (issues a person created)
 *   agent-autonomous  → agent_autonomous  (self-spawned agent traffic)
 *   all               → undefined         (no filter)
 * This is an approximation: `agent_directed` issues count as
 * `human-driven` in the column but a single `source` value cannot
 * express `human ∪ agent_directed`, so they fall out of the search-mode
 * "people" filter — slightly coarser than the non-search list filter.
 * Documented as a known edge — full parity needs an `origin=` param on
 * /search server-side.
 */
function originToSource(origin: OriginFilter): IssueSource | undefined {
  if (origin === 'human-driven') return 'human';
  if (origin === 'agent-autonomous') return 'agent_autonomous';
  return undefined;
}

/**
 * sk-44.2 — adapt a hybrid-search `SearchItem` (kind=issue) into the
 * `IssueSummary` shape the Tasks-column row renderers (`TaskCard`,
 * `TaskTreeNode`) consume. The `/search` projection is leaner than the
 * list endpoints — it carries id/title/status/priority/type/pinned/
 * assignee/updatedAt but NOT version, componentIds, parentIdCurrent,
 * epicProgress, isBlocked, iAssigned, createdAt. We backfill those with
 * safe defaults:
 *   - version 0 — search rows are read-only entry points; the user
 *     clicks through to the Details panel which fetches the live
 *     IssueDetail (with the real version) before any mutation. A 0 here
 *     never reaches a write path.
 *   - componentIds [] — the card's component segment renders nothing
 *     rather than a wrong count.
 *   - isBlocked false / parentIdCurrent null — no dep-icon strip; the
 *     search row is a navigation affordance, not a dep-graph view.
 *   - createdAt = updatedAt — only used by the `created` client sort,
 *     which is a best-effort ordering on search results anyway (RRF
 *     already ranked by relevance; see clientSort note in queryFn).
 * `projectId` falls back to '' only when the row IS a project entity,
 * which can't happen here because we always pass kind=['issue'].
 */
export function searchItemToSummary(it: SearchItem): IssueSummary {
  return {
    id: it.id,
    projectId: it.projectId ?? '',
    version: 0,
    title: it.title,
    type: it.type ?? 'task',
    priority: it.priority ?? 3,
    status: it.status ?? 'open',
    pinned: it.pinned ?? false,
    assignee: it.assignee ?? null,
    componentIds: [],
    labels: [],
    isBlocked: false,
    parentIdCurrent: null,
    updatedAt: it.updatedAt,
    createdAt: it.updatedAt,
    // sk-53 — carry the RRF relevance score through so the card can
    // render the search-only relevance badge. Only search rows have it.
    score: it.score,
  };
}

export function useTasks(args: UseTasksArgs): UseTasksResult {
  const {
    selectedProject,
    selectedSpace: selectedSpaceArg,
    selectedSpaceStatus = 'unknown',
    selectedComponent,
    outboxMode,
    onMeMode,
    statusFilter,
    originFilter,
    typeFilter,
    priorityFilter,
    search,
    sort,
    assigneeFilter,
  } = args;

  // Resolve alias → projectId via the dedicated hook. Two-stage: cached
  // first-page list (fast path) → fallback to `/projects/resolve` for
  // aliases that paginate past the first page (e.g. `demo` whose project
  // name `demodemodemo` sorts past first 100 alphabetically). Without the
  // fallback, freshly-navigated URLs to such projects show
  // "project-not-found" even though the project exists.
  const resolved = useProjectByHandle(selectedProject);
  const resolvedProjectId = resolved.project?.id ?? null;
  const projectNotFound = resolved.isUnresolved;

  // sk-674.18 T052 — the place «space» (see `selectedSpaceStatus`).
  const selectedSpace = selectedProject === null ? selectedSpaceArg ?? null : null;
  const spaceResolving = selectedSpace !== null && selectedSpaceStatus === 'resolving';
  const spaceNotFound = selectedSpace !== null && selectedSpaceStatus === 'not-found';
  const spaceParam = selectedSpace ?? undefined;

  // Surfaces (sk-30 — added the "On me" lens, mutually exclusive with
  // outboxMode upstream so both can't be ON at once):
  //   project + outbox      → listIssues(createdBy=me)
  //   project + on-me       → listIssues(assignee=me, createdBy=not-me,
  //                                       acceptedAt=not-null)
  //   project + neither     → listIssues() — all tasks of the project
  //   no project + outbox   → /me/created-by
  //   no project + on-me    → /me/assigned-to(createdBy=not-me, acceptedAt=not-null)
  //   no project + neither  → /api/v1/issues — cross-project all
  const crossProjectAll = selectedProject === null && !outboxMode && !onMeMode;
  const crossProjectOutbox = selectedProject === null && outboxMode;
  const crossProjectOnMe = selectedProject === null && onMeMode;

  // sk-44.2 — search mode discriminator. A non-empty search box routes
  // the project-scoped + "All projects" surfaces to the hybrid
  // `globalSearch` (RRF) endpoint. The cross-project lens surfaces
  // (outbox / on-me) deliberately stay OUT of search mode — RRF can't
  // express their createdBy/assignee ownership predicate — so they keep
  // their existing endpoint + client-side `clientSearch`.
  const trimmedSearch = search.trim();
  const searchMode =
    trimmedSearch !== '' && !crossProjectOutbox && !crossProjectOnMe;

  // Lens discriminator for the cache key — collapses the (outboxMode,
  // onMeMode) pair into a single token so cache entries never bleed
  // across lenses.
  const lens: 'outbox' | 'on-me' | 'all' = onMeMode
    ? 'on-me'
    : outboxMode
      ? 'outbox'
      : 'all';

  // Build the cache key. Always starts with 'tasks' so liveEventInvalidation
  // can match it via predicate.
  const cacheKey = useMemo<readonly unknown[]>(() => {
    if (projectNotFound) {
      return ['tasks', 'not-found', selectedProject] as const;
    }
    if (spaceNotFound) {
      return ['tasks', 'space-not-found', selectedSpace] as const;
    }
    // sk-44.2 — search mode short-circuits both the project-scoped and
    // "All projects" surfaces to the hybrid RRF endpoint. The cache key
    // carries a `'search'` token + the project scope (UUID or 'all') so
    // RRF pages never share a cache entry with the list-endpoint pages.
    // It still starts with `'tasks'` so liveEventInvalidation matches.
    if (searchMode) {
      // sk-50 — `sort` is DELIBERATELY absent from the search cache key.
      // The RRF `/search` request is sort-independent (relevance order is
      // server-fixed; we pass no sort param), and the effective sort is a
      // pure client-side post-process in the `data` useMemo (which has
      // `sort` in its own dep array). Keying on `sort` here would make a
      // mid-search sort flip (Relevance → Priority) look like a brand-new
      // query → wasted RRF refetch AND the infinite-scroll page set reset
      // to page 1. Omitting it lets the loaded pages survive a re-sort.
      return [
        'tasks',
        'search',
        resolvedProjectId ?? 'all',
        statusFilter,
        originFilter,
        typeFilter,
        priorityFilter,
        selectedComponent ?? '',
        trimmedSearch,
        // sk-79 — search mode applies assignee client-side; key on it so
        // the post-filtered slice is cached per assignee selection.
        assigneeFilter ?? '',
        // sk-674.18 T052 — the place «space» narrows the search too. LAST,
        // like on every cross-project key: the positions before it are
        // decoded by `tasksListServerShape` and
        // `liveEventInvalidation.ts#tasksListInfo`.
        selectedSpace ?? '',
      ] as const;
    }
    if (resolvedProjectId !== null) {
      return [
        'tasks',
        'project',
        resolvedProjectId,
        lens,
        statusFilter,
        originFilter,
        typeFilter,
        priorityFilter,
        // Component bucket goes in here so a component-filtered cache
        // entry doesn't bleed into the all-tasks one (and vice versa).
        selectedComponent ?? '',
        search,
        sort,
        // sk-79 — assignee is a wire filter on this surface; key on it so
        // switching assignee refetches rather than serving a stale slice.
        assigneeFilter ?? '',
      ] as const;
    }
    if (crossProjectAll) {
      // Cross-project "All projects" surface — non-search list path.
      return [
        'tasks',
        'all',
        'cross-project',
        statusFilter,
        originFilter,
        typeFilter,
        priorityFilter,
        search,
        sort,
        // sk-79 — assignee wire filter on the cross-project surface too.
        assigneeFilter ?? '',
        // sk-674.18 T052 — the place «space» (last, see the search key).
        selectedSpace ?? '',
      ] as const;
    }
    if (crossProjectOnMe) {
      // No project + onMeMode ON → /me/assigned-to with on-me filters.
      return ['tasks', 'me', 'on-me', statusFilter, originFilter, typeFilter, priorityFilter, search, sort, selectedSpace ?? ''] as const;
    }
    // No project + outboxMode ON → /me/created-by surface.
    return ['tasks', 'me', 'created-by', statusFilter, originFilter, typeFilter, priorityFilter, search, sort, selectedSpace ?? ''] as const;
  }, [
    projectNotFound,
    spaceNotFound,
    selectedSpace,
    selectedProject,
    resolvedProjectId,
    lens,
    crossProjectAll,
    crossProjectOnMe,
    searchMode,
    trimmedSearch,
    statusFilter,
    originFilter,
    typeFilter,
    priorityFilter,
    selectedComponent,
    search,
    sort,
    assigneeFilter,
  ]);

  // Map StatusFilter onto the wire shape.
  //   - 'all'     → undefined (no filter)
  //   - 'active'  → undefined on the wire (backend can't express
  //                 "not closed" in a single param); we post-filter the
  //                 returned rows below to drop `closed`.
  //   - 'blocked' → sk-31: blocked is no longer a wire status. We OMIT
  //                 the wire `status` param and set `isBlocked=true`
  //                 instead, which the backend resolves through the dep
  //                 graph EXISTS predicate.
  //   - 'unreviewed' → sk-303.14 (T024/T025, contract C3): same shape as
  //                 'blocked'. Not a status of the issue but a relation
  //                 between the issue and the caller, so the wire `status`
  //                 param is OMITTED and the selection travels as its own
  //                 parameter on the delegated paths.
  //   - concrete  → pass through as wire IssueStatus.
  const wireStatus: IssueStatus | undefined =
    statusFilter === 'all'
      || statusFilter === 'active'
      || statusFilter === 'blocked'
      || statusFilter === 'unreviewed'
      ? undefined
      : statusFilter;

  // sk-31 — wire-side derived blocked-ness filter. true when the user
  // picked the [Blocked] pill; otherwise undefined so the server returns
  // every row (blocked or not).
  const wireIsBlocked: boolean | undefined =
    statusFilter === 'blocked' ? true : undefined;

  // sk-303.14 (T025, contract C3) — wire-side unreviewed selection. Set on
  // BOTH halves of the Delegated surface: the project-scoped
  // `listIssues(createdBy='me')` and the cross-project `/me/created-by`.
  //
  // Both, not one. Picking a project swaps which of the two runs, so a
  // selection wired into only the cross-project builder would quietly stop
  // being a selection the moment the user narrows to a project — the list
  // would widen back to every delegated task while the chip still claims a
  // narrowing. That failure is silent by nature: no error, just more rows.
  //
  // The selection is NEVER re-derived client-side. Membership is defined
  // once, on the server, and the second number and the reminder audience
  // read the same definition (INV-3); a client-side approximation here
  // would be a second definition and the three would drift.
  const wireUnreviewed: boolean | undefined =
    statusFilter === 'unreviewed' ? true : undefined;

  const wireOrigin: OriginFilter | undefined =
    originFilter === 'all' ? undefined : originFilter;

  // sk-86 — wire-side priority filter. The pill value is the string union
  // ('all' | '0'..'4'); the wire/board priority is the int 0..4. 'all' →
  // undefined (no filter); a concrete pill → the parsed int. Forwarded to
  // the surfaces that accept it on the wire (listIssues, globalSearch);
  // the cross-project + /me surfaces post-filter client-side (see `data`).
  const wirePriority: number | undefined =
    priorityFilter === 'all' ? undefined : Number(priorityFilter);

  // Three enabling conditions:
  //   - project URL but project not in cache: surface empty-state.
  //   - project URL with cache resolved: fetch.
  //   - no project (any outboxMode): fetch the cross-project endpoint.
  const enabled =
    !projectNotFound
    && !spaceNotFound
    && !spaceResolving
    && (resolvedProjectId !== null || selectedProject === null);

  const query = useInfiniteQuery<TasksPage>({
    queryKey: cacheKey,
    enabled,
    initialPageParam: undefined as string | undefined,
    // `last.nextCursor` is `string | null | undefined`. When `hasMore`
    // is false the server omits `nextCursor` entirely; we still need
    // to return `undefined` (not `null`) so TanStack treats it as
    // "no next page".
    getNextPageParam: (last) =>
      last.hasMore ? last.nextCursor ?? undefined : undefined,
    queryFn: async ({ pageParam }) => {
      const cursor = (pageParam as string | undefined) ?? undefined;
      // sk-44.2 — hybrid RRF search. Covers BOTH the project-scoped
      // surface (project=<uuid>) and the "All projects" surface (no
      // project). kind=['issue'] so the column only sees issue rows
      // (the endpoint can also return comment/project/component rows
      // which the Tasks column has no renderer for). Status / type /
      // source filters are forwarded so the chip row still narrows
      // results when "within filters" mode is on (sub-task 3 re-applies
      // them; when off the filters are cleared upstream so this passes
      // undefined). `degraded:true` (embedder down → FTS-only) is
      // surfaced via the result but never thrown — fewer-recall results
      // are still useful.
      if (searchMode) {
        const res = await globalSearch({
          q: trimmedSearch,
          project: resolvedProjectId ?? undefined,
          space: spaceParam,
          kind: ['issue'],
          status: wireStatus ? [wireStatus] : undefined,
          type: typeFilter === 'all' ? undefined : typeFilter,
          // sk-86 — priority is a wire filter on /search.
          priority: wirePriority,
          source: originToSource(originFilter),
          cursor,
          limit: PAGE_SIZE_SEARCH,
        });
        return {
          items: res.items
            // Defence-in-depth: we already pass kind=['issue'] on the
            // wire, so the server should only return issue rows. This
            // client filter is a belt-and-braces guard against a server
            // that ignores/loosens the kind param leaking comment /
            // project / component rows the Tasks column can't render.
            .filter((it) => it.kind === 'issue')
            .map(searchItemToSummary),
          // RRF has no COUNT(*) — surface 0 here so the column-header
          // `total` falls back to the loaded-row count (see the `total`
          // computation below). hasMore + nextCursor drive infinite
          // scroll exactly like the list endpoints.
          total: 0,
          hasMore: res.hasMore,
          nextCursor: res.nextCursor,
          degraded: res.degraded,
        };
      }
      if (resolvedProjectId !== null) {
        // sk-30 — when onMeMode is ON, override wire filters with the
        // "On me" set: assignee=me ∧ createdBy=not-me ∧ acceptedAt=
        // not-null. Status is NOT hardcoded — the user's StatusFilter
        // from the toolbar drives it (default preset is 'active' which
        // post-filters closed rows below). Letting the user pick
        // 'closed' inside On me is intentional: they may want to
        // review work that was assigned to them and they've since
        // finished.
        if (onMeMode) {
          return listIssues(resolvedProjectId, {
            status: wireStatus ? [wireStatus] : undefined,
            // sk-86 — priority is a wire filter on the project-scoped endpoint.
            priority: wirePriority,
            assignee: 'me',
            createdBy: 'not-me',
            acceptedAtNotNull: true,
            origin: wireOrigin,
            componentId: selectedComponent ?? undefined,
            // sk-44.2 — search no longer flows through `text=`; a
            // non-empty box routes to the RRF branch above (searchMode),
            // so this list path only ever runs unsearched.
            sort: wireSort(sort),
            isBlocked: wireIsBlocked,
            cursor,
            limit: PAGE_SIZE,
          });
        }
        return listIssues(resolvedProjectId, {
          status: wireStatus ? [wireStatus] : undefined,
          // sk-86 — priority is a wire filter on the project-scoped endpoint.
          priority: wirePriority,
          origin: wireOrigin,
          createdBy: outboxMode ? 'me' : undefined,
          // sk-303.14 — the project-scoped half of the delegated surface.
          // Gated on the lens: the selection narrows THIS surface, and the
          // other surfaces on this endpoint have no such set.
          unreviewed: outboxMode ? wireUnreviewed : undefined,
          // sk-79 — assignee filter on the NON-lens project surface goes on
          // the wire (chip set comes from project members, independent of the
          // result). sk-84 — under Delegated (outboxMode) we deliberately do
          // NOT wire-filter: the chips are derived FROM the delegated result,
          // so the list must stay un-narrowed (else picking one delegatee
          // would collapse the chip set to that single user). Delegated
          // assignee filtering is applied client-side in the `data` memo.
          assignee: outboxMode ? undefined : assigneeFilter ?? undefined,
          // Component filter is project-scoped — backend rejects
          // component IDs from other projects with an empty result, so
          // a stale URL with a deleted component renders empty rather
          // than 4xx. Cross-project Outbox path doesn't accept it.
          componentId: selectedComponent ?? undefined,
          // sk-44.2 — search routes to the RRF branch (searchMode); this
          // list path only runs when the box is empty.
          sort: wireSort(sort),
          isBlocked: wireIsBlocked,
          cursor,
          limit: PAGE_SIZE,
        });
      }
      if (crossProjectOutbox) {
        // /me/created-by — server doesn't accept text/sort, so we
        // apply both client-side after the fetch.
        //
        // statusFilter === 'all' must override the /me/* legacy default
        // of excluding closed when no status is set; we pass
        // includeClosed=true so the server returns every status. For
        // 'active' / concrete statuses / 'blocked' we let the default
        // stand (closed isn't useful in those views).
        return listCreatedByMe({
          status: wireStatus,
          includeClosed: statusFilter === 'all' ? true : undefined,
          origin: wireOrigin,
          isBlocked: wireIsBlocked,
          // sk-303.14 — the cross-project half of the same surface. No
          // `includeClosed` rides along: the server lifts its own
          // "closed excluded by default" rule for this selection, and
          // sending both would state the same thing twice in two
          // vocabularies.
          unreviewed: wireUnreviewed,
          space: spaceParam,
          cursor,
          limit: PAGE_SIZE,
        });
      }
      if (crossProjectOnMe) {
        // sk-30 — /me/assigned-to with the on-me filters: caller is the
        // assignee, did NOT create the issue, has already accepted it.
        // Status is driven by the user's StatusFilter (no hardcoded
        // 'open') — see the project-scoped branch above.
        // statusFilter === 'all' must override the /me/* legacy default
        // (closed excluded when status is empty).
        return listAssignedToMe({
          status: wireStatus,
          includeClosed: statusFilter === 'all' ? true : undefined,
          createdBy: 'not-me',
          acceptedAtNotNull: true,
          origin: wireOrigin,
          isBlocked: wireIsBlocked,
          space: spaceParam,
          cursor,
          limit: PAGE_SIZE,
        });
      }
      // Cross-project "All projects" (non-search). sk-44.2 — the `q=`
      // FTS search branch was removed; a non-empty box on this surface
      // routes to the RRF `globalSearch` branch above (searchMode) with
      // no `project`, so this list path only runs unsearched. Single
      // status / type filter, origin grouping, sort. Returns
      // ListAllIssuesResult which is structurally a superset of
      // ListIssuesResult; narrow it here so the page shape stays
      // uniform across surfaces.
      const res = await listAllIssues({
        status: wireStatus,
        type: typeFilter === 'all' ? undefined : typeFilter,
        origin: wireOrigin,
        // sk-79 — assignee filter on the cross-project "All projects"
        // surface. null when no project picker is shown.
        assignee: assigneeFilter ?? undefined,
        sortBy: wireSort(sort),
        isBlocked: wireIsBlocked,
        space: spaceParam,
        cursor,
        limit: PAGE_SIZE,
      });
      return {
        items: res.items,
        total: res.total,
        hasMore: res.hasMore,
        nextCursor: res.nextCursor,
      };
    },
    // 30s — same cadence as the inbox query (R3.2d), invalidated on
    // every issue.* event by liveEventInvalidation.
    staleTime: 30_000,
  });

  // Flatten pages into a single item list — same pattern as
  // `useProjectsInfinite`. Spread is fine: `pages` is a small array
  // (typically 1..few) so the cost is negligible.
  const flatItems = useMemo<IssueSummary[]>(() => {
    if (!query.data) return [];
    const out: IssueSummary[] = [];
    for (const page of query.data.pages) {
      for (const it of page.items) out.push(it);
    }
    return out;
  }, [query.data]);

  // sk-285.5.5 — distinct assignees of the LOADED tasks, on every surface.
  // Each entry carries the display handle + (when known) the user uuid for
  // the avatar colour seed.
  //
  // This was `delegateeAssignees` (sk-84) and computed only under the
  // Delegated lens; the cross-project "All projects" chip row used to feed
  // itself from the WHOLE org directory instead — an unbounded fetch of
  // every active user on mount. The people worth filtering by on a task
  // board are the people who appear on it, so both surfaces now read the
  // same derivation and the directory is a SEARCH source only.
  const rawLoadedAssignees = useMemo<LoadedAssignee[]>(() => {
    const seen = new Map<string, LoadedAssignee>();
    for (const it of flatItems) {
      const handle = it.assignee?.trim();
      if (!handle) continue;
      const lower = handle.toLowerCase();
      const prev = seen.get(lower);
      if (!prev) {
        seen.set(lower, {
          username: handle,
          userId: it.assigneeUserId ?? null,
          status: mergeAssigneeStatus(undefined, it.assigneeStatus, true),
        });
      } else {
        prev.status = mergeAssigneeStatus(prev.status, it.assigneeStatus, false);
      }
    }
    return [...seen.values()];
  }, [flatItems]);

  // sk-285.5.5 review F1 — the chip row must NOT collapse to one chip when a
  // chip is clicked, and `flatItems` alone cannot guarantee that.
  //
  // Whether `flatItems` is a valid chip source depends on the surface:
  //
  //   - Delegated lens (outboxMode) and search mode filter the assignee
  //     CLIENT-side (see the `data` memo and the `listIssues` comment), so
  //     the rows in hand are the un-narrowed set — deriving from them is
  //     already complete.
  //   - The cross-project "All projects" and project list paths send the
  //     picked assignee ON THE WIRE (it is part of `cacheKey`, so picking
  //     one refetches). There `flatItems` holds ONLY that assignee's rows;
  //     deriving the chips from it would leave exactly one chip and no way
  //     back to the other people — the trap sk-84 avoided by not wiring the
  //     filter at all. Wiring it is required here (a person picked from the
  //     directory search may have no row on the current page at all), so
  //     the compensation is a SNAPSHOT instead: remember the last set seen
  //     while nothing was picked, and keep serving that while a pick is
  //     active.
  const assigneeNarrowedOnWire = assigneeFilter !== null && !searchMode && !outboxMode;

  // Identity of the board the snapshot describes: every wire input EXCEPT
  // the assignee. When it changes the snapshot is about a different board
  // and the next unfiltered load replaces it.
  const assigneeSnapshotKey = useMemo(
    () =>
      JSON.stringify([
        resolvedProjectId ?? '',
        selectedProject ?? '',
        selectedSpace ?? '',
        lens,
        statusFilter,
        originFilter,
        typeFilter,
        priorityFilter,
        selectedComponent ?? '',
        trimmedSearch,
        searchMode,
      ]),
    [
      resolvedProjectId,
      selectedProject,
      selectedSpace,
      lens,
      statusFilter,
      originFilter,
      typeFilter,
      priorityFilter,
      selectedComponent,
      trimmedSearch,
      searchMode,
    ],
  );

  const assigneeSnapshotRef = useRef<{
    key: string;
    assignees: LoadedAssignee[];
  }>({ key: '', assignees: [] });
  const [assigneeSnapshot, setAssigneeSnapshot] = useState<LoadedAssignee[]>([]);

  useEffect(() => {
    // A wire-narrowed page is not a snapshot source — keep the last one.
    // Note this deliberately also keeps a snapshot taken under a DIFFERENT
    // `assigneeSnapshotKey`: if the reader changes, say, the status pill
    // while an assignee is picked, the previous board's people are a
    // superset-ish approximation and still give a way out of the filter,
    // whereas an empty chip row does not. Clearing the pick re-snapshots.
    if (assigneeNarrowedOnWire) return;
    if (query.data === undefined) return;
    const prev = assigneeSnapshotRef.current;
    if (
      prev.key === assigneeSnapshotKey &&
      prev.assignees.length === rawLoadedAssignees.length &&
      prev.assignees.every(
        (a, i) =>
          a.username === rawLoadedAssignees[i].username &&
          a.userId === rawLoadedAssignees[i].userId &&
          a.status?.departed === rawLoadedAssignees[i].status?.departed &&
          a.status?.deleted === rawLoadedAssignees[i].status?.deleted &&
          a.status?.pseudonym === rawLoadedAssignees[i].status?.pseudonym,
      )
    ) {
      return;
    }
    assigneeSnapshotRef.current = { key: assigneeSnapshotKey, assignees: rawLoadedAssignees };
    setAssigneeSnapshot(rawLoadedAssignees);
  }, [assigneeNarrowedOnWire, assigneeSnapshotKey, rawLoadedAssignees, query.data]);

  const loadedAssignees = assigneeNarrowedOnWire ? assigneeSnapshot : rawLoadedAssignees;

  // sk-84 — the Delegated-lens view of the same set ("who I delegated to").
  // Kept as its own field because it is lens-scoped by contract: outside the
  // Delegated lens it is EMPTY, and TasksColumn relies on that to pick which
  // chip source to render.
  const delegateeAssignees = useMemo<LoadedAssignee[]>(
    () => (outboxMode ? loadedAssignees : []),
    [outboxMode, loadedAssignees],
  );

  // Post-process: client-side sort for priority buckets, client-side
  // search for the /me path. The server already filters status/origin
  // (and on /api/v1/issues also type), so the only client-side work
  // is the priority sort + the optional search on /me/created-by +
  // type post-filter on /me/created-by.
  //
  // sk-31 wire-mapping note: when statusFilter === 'blocked' the
  // upstream wire query passes `isBlocked=true` without a status
  // constraint — the server returns every blocked row including
  // closed-with-residual-blockers. The UI excludes the closed rows
  // here to stay consistent with the `'active'` lens semantics
  // (a closed issue is terminal regardless of dep state, never
  // "actionable blocked work" the lens is meant to surface).
  const data = useMemo<IssueSummary[] | undefined>(() => {
    if (!query.data) return undefined;
    let items = flatItems;
    // `active` UI filter = "everything except closed". The wire status
    // param is omitted upstream; the closed rows are dropped here.
    if (statusFilter === 'active') {
      items = items.filter((i) => i.status !== 'closed');
    }
    // sk-31: same shape for `'blocked'` — drop closed rows so the
    // [Blocked] lens stays a list of actionable work. Without this
    // the column rendered closed issues under a derived `[blocked]`
    // chip, which contradicts the lens intent.
    if (statusFilter === 'blocked') {
      items = items.filter((i) => i.status !== 'closed');
    }
    // sk-303.14 (T025) — `'unreviewed'` is deliberately ABSENT from the two
    // branches above, and this comment is here so it stays absent. The two
    // older sentinels drop closed rows because they mean "actionable work";
    // the unreviewed set is closed results BY CONSTRUCTION, so the same
    // line applied to it would filter the list down to nothing while the
    // server had already returned the right rows and the second number
    // went on counting them. There is no client-side narrowing for this
    // selection at all — membership is the server's, once (INV-3).
    // Type filter — both `/api/v1/issues` (crossProjectAll) and the
    // hybrid `/search` (searchMode) accept a wire `type` param so we
    // skip the post-filter on those surfaces (already narrow on the
    // wire). Project-scoped + /me/created-by list surfaces don't accept
    // `type`, so we keep the post-filter for those.
    if (typeFilter !== 'all' && !crossProjectAll && !searchMode) {
      items = items.filter((i) => i.type === typeFilter);
    }
    // sk-86 — priority filter. Mirror image of the type post-filter above:
    // priority IS a wire param on the project-scoped (`listIssues`) and
    // search (`globalSearch`) surfaces — already narrowed server-side there —
    // so we only post-filter the cross-project + /me surfaces that lack it
    // (`listAllIssues`, `/me/created-by`, `/me/assigned-to`). `!searchMode`
    // excludes the all-projects-search case (crossProjectAll can be true
    // alongside searchMode), where the wire param already applied.
    if (
      priorityFilter !== 'all' &&
      !searchMode &&
      (crossProjectAll || crossProjectOutbox || crossProjectOnMe)
    ) {
      const want = Number(priorityFilter);
      items = items.filter((i) => i.priority === want);
    }
    // Assignee filter applied CLIENT-side. Surfaces that need it (their wire
    // shape has no assignee param, OR we deliberately don't wire-filter):
    //   - sk-79: SEARCH mode (the RRF `/search` endpoint).
    //   - sk-84: Delegated lens (outboxMode) — BOTH the project (`listIssues
    //     createdBy=me`) and cross-project (`/me/created-by`) paths. We keep
    //     the wire un-narrowed so the chip set ("who I delegated to") can be
    //     derived from the full delegated list (see delegateeAssignees), then
    //     filter to the picked delegatee here.
    // Rows carry `assignee` (display handle); match case-insensitively
    // against the picked username. No-op when no assignee is picked.
    if ((searchMode || outboxMode) && assigneeFilter) {
      const want = assigneeFilter.toLowerCase();
      items = items.filter((i) => (i.assignee ?? '').toLowerCase() === want);
    }
    // Client-side text search applies ONLY to the lens surfaces
    // (outbox / on-me) — every other surface either has no search
    // (empty box) or routes through the RRF endpoint (searchMode),
    // which already did the matching server-side.
    if ((crossProjectOutbox || crossProjectOnMe) && search.trim()) {
      items = clientSearch(items, search);
    }
    // sk-44 / sk-50 — ordering is driven by the EFFECTIVE sort key
    // (`sort` here = the caller-supplied effectiveSort). The server
    // returns search rows already ranked by RRF relevance (vector + FTS
    // fusion); applying clientSort would clobber that ranking — with
    // sort=ID it re-orders by hierarchical id, so the weakest semantic
    // match floats to the top purely because its id sorts first
    // alphabetically (e.g. `alpha-*` above a literal title hit in
    // `gamma-web-*`).
    //
    // Two cases preserve the input (server) order verbatim:
    //   - sort === 'relevance' (sk-50): the ephemeral search-sort default.
    //     The combobox surfaces this only while a search is active and it
    //     means "keep RRF order". clientSort has no relevance branch, so
    //     we MUST skip it here rather than fall through to the `default`
    //     no-op (which would still clone but, more importantly, makes the
    //     intent explicit and survives any future clientSort change).
    //   - any other key while searchMode is active falls through to
    //     clientSort below — the legit "find X, then show by priority"
    //     case the user opts into mid-search.
    // Outside search, `sort` is the persisted list-surface key and
    // clientSort realises the priority/updated/created/id buckets.
    if (sort !== 'relevance') {
      items = clientSort(items, sort);
    }
    // sk-118 (decision #6) — pin standing tasks to the very top of EVERY
    // sort order (incl. the relevance/search branch, where clientSort is
    // skipped). The partition runs last so it sits on top of whatever
    // ordering produced `items`, independent of `pinned`.
    items = partitionStanding(items);
    return items;
  }, [query.data, flatItems, crossProjectAll, crossProjectOutbox, crossProjectOnMe, outboxMode, searchMode, search, sort, statusFilter, typeFilter, priorityFilter, assigneeFilter]);

  // Total (header counter):
  //   Non-search — first-page server-side COUNT(*) for the same WHERE
  //     clause. All pages return the same value, so reading pages[0] is
  //     canonical. Older servers omitted it and returned 0.
  //   Search (sk-44.2) — the RRF `/search` endpoint has no COUNT(*) (it
  //     fuses unbounded vector + FTS rank lists; an exact count would
  //     mean fully materialising both), so its pages carry total:0. We
  //     fall back to the loaded-and-post-filtered row count so the
  //     header shows "N loaded" rather than a fabricated total. The
  //     number grows as the user scrolls and never overstates what's on
  //     screen. See the module-header `total` note.
  const total = searchMode
    ? data?.length ?? 0
    : query.data?.pages[0]?.total ?? 0;

  // sk-44.2 — true when the most recent search page came back with the
  // embedder down (FTS-only recall). Exposed so the column can surface a
  // gentle "fewer results than usual" hint without treating it as an
  // error. `degraded` is set PER-REQUEST by the server, so we read the
  // LATEST loaded page (`pages.at(-1)`) — that reflects the current
  // recall state. Reading pages[0] missed a page-2 fetch that came back
  // degraded (and inversely stuck the banner on after a degraded page 1
  // when later pages recovered).
  const searchDegraded =
    searchMode && (query.data?.pages.at(-1)?.degraded ?? false);

  // Derive empty-state reason. Order matters: not-found beats
  // no-results (data came back empty after filters).
  const emptyReason: TasksEmptyReason = (() => {
    if (projectNotFound) return 'project-not-found';
    if (spaceNotFound) return 'space-not-found';
    if (
      query.isSuccess
      && data !== undefined
      && data.length === 0
    ) {
      return 'no-results';
    }
    return null;
  })();

  // Loading semantics: the column shows "Loading tasks…" while either
  // the alias resolver OR the task-list query is in flight. Project
  // resolution only blocks the project-scoped surface; the cross-
  // project surfaces don't depend on it. We treat `isPending` (no
  // data yet) — NOT `isFetching` (which stays true between pages) —
  // as the "show the spinner" signal so the column doesn't blank
  // out while loading more rows.
  const projectsResolving =
    selectedProject !== null && resolved.isLoading;
  const isLoading =
    !projectNotFound
    && !spaceNotFound
    && (projectsResolving || spaceResolving || (enabled && query.isPending));

  // Empty-surface sentinel: when the URL points at a non-existent
  // project, `data` is `[]` so consumers can render the empty state
  // via `emptyReason` without first dealing with `undefined`.
  // Otherwise we forward the query result (`undefined` while loading,
  // then `IssueSummary[]`).
  return {
    data: projectNotFound || spaceNotFound ? [] : data,
    total: projectNotFound || spaceNotFound ? 0 : total,
    hasNextPage: query.hasNextPage ?? false,
    isFetchingNextPage: query.isFetchingNextPage,
    fetchNextPage: () => {
      // useInfiniteQuery's fetchNextPage returns a promise; we don't
      // need to await it from callers (the IntersectionObserver
      // doesn't care when it lands, only that it was kicked off).
      void query.fetchNextPage();
    },
    isLoading,
    error: query.error,
    emptyReason,
    searchDegraded: projectNotFound || spaceNotFound ? false : searchDegraded,
    searchMode,
    // sk-44.2 — `total` is an exact server COUNT(*) only on the
    // list-endpoint surfaces. In search mode RRF has no count and
    // `total` is the loaded-row count, so it is NOT exact.
    totalIsExact: !searchMode,
    resolvedProjectId,
    delegateeAssignees,
    loadedAssignees,
    cacheKey,
  };
}
