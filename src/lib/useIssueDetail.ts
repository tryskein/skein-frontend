/**
 * Shared issue-detail data layer (F5).
 *
 * Lifts the data-fetching + mutation plumbing out of the legacy
 * /legacy/projects/:pid/issues/:iid page (`pages/issues/detail.tsx`)
 * so both the legacy page and the new shell DetailsColumn share one
 * cache + one mutation surface. The legacy page is updated to consume
 * this hook in the same patch.
 *
 * Why a single hook instead of the legacy's inline useQuery soup:
 *   1. Cache key consistency — same key for `['issues', 'detail', id]`
 *      across both pages so live-event invalidation hits both views
 *      with one round-trip.
 *   2. Optimistic updates (Q40) are tricky to keep right in two
 *      places. `updateField` here is the canonical implementation:
 *      write-through to the cache, fire PATCH with `If-Match`, on
 *      error rollback + toast.
 *   3. Adds the new bits the legacy page doesn't surface — comments,
 *      attachments, deps, activity, watchers — all on the same hook
 *      instance so the panel can render them in one scroll.
 *
 * Project resolution:
 *   The new shell's URL is `/projects/:alias/issues/:id`. The hook
 *   accepts `projectHandle` and resolves it against `useProjectsList`
 *   to a UUID. The IssueDetail wire shape echoes back `projectId` as
 *   a UUID, but we need *something* before the GET fires to build the
 *   path. The legacy page passes `pid` directly because its URL is
 *   already shaped that way.
 *
 * Live updates:
 *   Live events (SignalR) bust the cache via predicates in
 *   `liveEventInvalidation.ts`. F5 only needs to make sure the new
 *   shell's keys are matched too (they already are, see the inline
 *   doc on `liveEventInvalidation.ts::invalidateIssueEvent` —
 *   `['issues', 'detail', issueId]` is the canonical key both places
 *   read).
 */

import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  type QueryKey,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  type IssueDetail,
  type IssueStatus,
  type PatchIssueInput,
  type TransitionCloseInput,
  acceptIssue,
  getIssue,
  getIssueByID,
  markReviewed,
  patchIssue,
  setReviewRequired,
  transitionStatus,
} from '../api/issues';
import {
  type ActivityEntry,
  type ActivityListResponse,
  listIssueActivity,
} from '../api/activity';
import {
  type Attachment,
  type AttachmentList as AttachmentListResp,
  listAttachments,
} from '../api/attachments';
import {
  type DependencyList,
  listDependencies,
} from '../api/dependencies';
import {
  type CommentDTO,
  listComments,
} from '../api/issues';
import {
  type WatcherEntry,
  listIssueWatchers,
} from '../api/watchers';
import { ApiError, BusinessError } from '../api/client';
import { useToaster } from '../components/Toaster';
import { isVersionConflict, saveFailureReason } from './saveFailureReason';

// ───────────────────────── Query keys ─────────────────────────
//
// Centralised so both the hook and the live-event invalidation
// router can match against them. We KEEP the existing keys the
// legacy page already uses so a coexistence period works out of the
// box — `['issues', 'detail', id]`, `['issues', 'comments', id]`,
// `['issues', id, 'attachments']`, `['deps', pid, id]`,
// `['watchers', 'issue', id]`. The activity query key is new for F5.

export const issueDetailKey = (id: string): QueryKey =>
  ['issues', 'detail', id] as const;

export const issueCommentsKey = (id: string): QueryKey =>
  ['issues', 'comments', id] as const;

export const issueAttachmentsKey = (id: string): QueryKey =>
  ['issues', id, 'attachments'] as const;

export const issueDependenciesKey = (
  projectId: string,
  id: string,
): QueryKey => ['deps', projectId, id] as const;

export const issueWatchersKey = (id: string): QueryKey =>
  ['watchers', 'issue', id] as const;

export const issueActivityKey = (projectId: string, id: string): QueryKey =>
  ['activity', 'issue', projectId, id] as const;

// ───────────────────────── Phase-2 row patch ─────────────────────────

/**
 * The part of a phase-2 event row an open card takes from it (sk-622.21
 * US-15): the fields of the row — title, priority, type, labels,
 * components, pinned — plus the stamps that move with any committed write
 * (`version`, `updatedAt`) and the freshness order itself.
 */
export type IssueDetailRowFields = Pick<
  IssueDetail,
  'title' | 'priority' | 'type' | 'labels' | 'componentIds' | 'pinned' | 'version' | 'updatedAt' | 'rowSeq'
>;

/**
 * sk-622.21 (US-15, T049) — lay the row fields of a phase-2 event onto the
 * cached card `['issues','detail',id]` without a request. Used ONLY for an
 * event that changes nothing but fields of the row
 * (`liveRowPatch.ts#isRowOnlyChange`): every other field of the card —
 * texts, blocking, the accepter, dates and estimate, close time and reason,
 * commits, attachments, the comment counter, the author's review fields —
 * is not on the row, so any other event re-reads the card instead.
 *
 * `version` is taken too: the card's next write sends it as
 * `expectedVersion`, and the row's version is the issue's version after the
 * very commit whose row fields are being laid in. Returns `undefined` when
 * the card's own `rowSeq` is not lower — the card already shows this state
 * or a later one.
 */
export function layRowOntoIssueDetail(
  detail: IssueDetail,
  row: IssueDetailRowFields & { rowSeq: number },
): IssueDetail | undefined {
  if ((detail.rowSeq ?? 0) >= row.rowSeq) return undefined;
  return {
    ...detail,
    title: row.title,
    priority: row.priority,
    type: row.type,
    labels: row.labels,
    componentIds: row.componentIds,
    pinned: row.pinned,
    version: row.version,
    updatedAt: row.updatedAt,
    rowSeq: row.rowSeq,
  };
}

// ───────────────────────── Status-change result ─────────────────────────
//
// changeStatus returns IssueDetail (success) | StatusChangeFailure
// (error) | null (no-op). The explicit failure wrapper exists so a
// reason-required caller (the retire dialog) can branch on outcome
// without the mutation having to throw — see the `changeStatus` doc on
// UseIssueDetailResult below.

/** Failure outcome of a status transition — carries the raw error. */
export interface StatusChangeFailure {
  error: Error;
}

/**
 * sk-425 — failure outcome of `updateField`, the same shape as
 * `StatusChangeFailure`: the raw error, so the caller can say WHY.
 */
export type SaveFailure = StatusChangeFailure;

/** Narrow an `updateField` result to its failure variant. */
/**
 * sk-492 — options of `updateField`.
 *
 * `reportsInline` — the caller shows the refusal reason itself, in place
 * (the text sections and the title editor print `saveFailureReason` under
 * the editor). The hook then raises no toast: the same reason said twice,
 * once in place and once in a toast, is the defect this flag exists for.
 * Without it (the header's priority / type) the toast IS the report, and
 * it carries the same `saveFailureReason` wording.
 */
export interface UpdateFieldOptions {
  reportsInline?: boolean;
}

export function isSaveFailure(r: unknown): r is SaveFailure {
  return r !== null && typeof r === 'object' && 'error' in r && (r as SaveFailure).error instanceof Error;
}

/** Narrow a changeStatus result to its failure variant. */
export function isStatusChangeFailure(
  r: IssueDetail | StatusChangeFailure | null,
): r is StatusChangeFailure {
  return r !== null && typeof r === 'object' && 'error' in r;
}

// ───────────────────────── Hook surface ─────────────────────────

export interface UseIssueDetailResult {
  // Reads
  issue: IssueDetail | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  comments: CommentDTO[] | undefined;
  attachments: Attachment[] | undefined;
  dependencies: DependencyList | undefined;
  /**
   * sk-421.1 T012 (US-4, US-5) — load state of the issue's dependency
   * list, so a consumer can tell «not received yet» from «failed»:
   *   - `'pending'` — not received yet (including while the query is
   *     disabled because the project is not known yet);
   *   - `'error'`   — the read failed and NO list is held;
   *   - `'success'` — `dependencies` holds a received list.
   *
   * NOT the raw query status. On a failed background refetch TanStack
   * keeps the last data but sets `status: 'error'` unconditionally
   * (`@tanstack/query-core` `query.js`, reducer `error`). Passed through,
   * that would turn a card that still holds a real list into «failed to
   * load» — the parent segment, the blocker links and the component names
   * would all degrade. So whenever a list is held the state is `'success'`
   * (the data is real); `'error'` only when there is nothing to show.
   */
  dependenciesStatus: UseQueryResult<DependencyList>['status'];
  /** Per-issue activity feed (P5), reverse-chronological. */
  activity: ActivityEntry[] | undefined;
  watchers: WatcherEntry[] | undefined;

  // Sub-query exposure for callers that need .isLoading / .isError per
  // section. Keeps the legacy page's per-tab loading affordances usable
  // without forcing every consumer to surface a single global spinner.
  issueQuery: UseQueryResult<IssueDetail, Error>;

  // Mutations — return promises so callers can await + chain.
  /**
   * Optimistic patch. Writes the updated detail to the cache, sends
   * PATCH with `If-Match: <version>`. On any error (incl.
   * version_conflict and locked_by_other), rolls back the cache and
   * surfaces a toast worded by `saveFailureReason` — unless the caller
   * reports the refusal in place (`opts.reportsInline`, sk-492).
   *
   * sk-425 — resolves the saved detail, or a `SaveFailure` carrying
   * the raw error (never throws, never `null`): an inline editor must
   * be able to tell a refusal from a save, or it marks refused text as
   * saved. On a version conflict the card is also re-read, so a retry
   * goes out against the version the server now has.
   */
  updateField: (
    patch: PatchIssueInput,
    opts?: UpdateFieldOptions,
  ) => Promise<IssueDetail | SaveFailure>;
  /**
   * Status transition. Optional `reason` is required server-side for
   * close/blocked/deferred. `force` overrides pinned-issue protection.
   *
   * Returns a typed three-way result so reason-required callers (the
   * retire dialog in DetailsHeader) can distinguish success from
   * failure WITHOUT relying on the mutation throwing:
   *   - `IssueDetail`        → transition succeeded (canonical post-state).
   *   - `{ error: Error }`   → transition failed; `error` is the raw
   *                            mutation error (e.g. a BusinessError with
   *                            code `standing_has_open_children` + the
   *                            offending child ids in `extra.childIds`).
   *                            The generic toast already fired in
   *                            `onError`; the caller may additionally
   *                            surface the error inline and keep its
   *                            modal open.
   *   - `null`               → no-op (issue not loaded in cache).
   *
   * The previous contract collapsed the failure case into `null`, which
   * made the retire modal's open-children guard unreachable — a failed
   * retire looked identical to a successful one to the caller. (sk-118.)
   */
  changeStatus: (
    next: IssueStatus,
    reason?: string,
    force?: boolean,
    // sk-489 (US-1, US-2) — the outcome and the closing goal collected by the modal.
    // Passed to `transitionStatus` as is; the rule "`done` does not
    // go on the wire" lives THERE, in one place for all callers.
    close?: TransitionCloseInput,
  ) => Promise<IssueDetail | StatusChangeFailure | null>;
  /**
   * Explicit assignee acknowledgement (B5). Idempotent — calling on an
   * already-accepted issue returns current detail without a version bump.
   */
  accept: () => Promise<IssueDetail | null>;

  /**
   * sk-303.14 (contract C1, US-3) — flip "needs review". Author only;
   * every other caller gets a 422 `review_forbidden`, admins included.
   *
   * Does NOT move the issue's version or its modification stamp — that is
   * the invariant, not an omission (INV-2), so the optimistic cache write
   * behind this leaves `version` alone and the next ordinary edit still
   * carries a valid `If-Match`.
   */
  changeReviewRequired: (required: boolean) => Promise<IssueDetail | null>;
  /**
   * sk-303.14 (contract C1, US-1) — mark a closed result read. Author only.
   * Refused on an unclosed issue and on one whose flag is cleared. Repeats
   * are idempotent and keep the first mark's author and timestamp.
   */
  markResultReviewed: () => Promise<IssueDetail | null>;
  /** True while either review write is in flight. */
  reviewPending: boolean;
}

export interface UseIssueDetailArgs {
  /** Hierarchical issue id (e.g. "demo-42"). null disables every fetch. */
  issueId: string | null;
  /**
   * Project handle (alias / idPrefix / UUID). Backend's `getIssue`
   * resolves all three on the path, so we forward verbatim. null
   * disables every fetch — the new shell passes this when the issue
   * id is selected via the inbox-overlay route, in which case the
   * caller resolves the alias from the issue itself before mounting.
   *
   * Special case: when the URL was `/issues/:id` (inbox-overlay), the
   * caller can pass null here and the hook will fall back to the
   * issueDetail's own `projectId` once it lands. Until then, the deps
   * / activity queries stay disabled (they need a project id). This
   * is acceptable — those sections render "loading…" briefly.
   */
  projectHandle: string | null;
}

// Default page size for the per-issue activity feed (P5). The endpoint
// supports keyset pagination via nextCursor; the panel is a single-
// scroll view today and 50 rows is plenty for the common case. Bump or
// wire "load more" when traffic on a single issue warrants it.
const ACTIVITY_PAGE_LIMIT = 50;

export function useIssueDetail(
  args: UseIssueDetailArgs,
): UseIssueDetailResult {
  const { issueId, projectHandle } = args;
  const qc = useQueryClient();
  const toast = useToaster();
  const { t } = useTranslation('details');

  // Issue detail. Needs only the issue id: with a known project we use
  // the scoped route, without one `getIssueByID` resolves the project
  // first (cross-project list filtered by the id) and then reads it.
  //
  // Waiting for a project handle used to be the gate here, and that was
  // a real bug: when the caller could not derive a project from the id —
  // hash / custom id modes, or an id whose prefix no longer matches its
  // project — the query stayed disabled forever, no request was ever
  // sent, and the panel sat on "failed to load". Keep the gate on
  // `issueId` alone.
  const issueQuery = useQuery<IssueDetail, Error>({
    queryKey: issueId ? issueDetailKey(issueId) : ['issues', 'detail', '∅'],
    // sk-421.1 T016 — the read takes TanStack's signal and hands it to every
    // request (both hops of `getIssueByID`), like `useLayeredTree`. A newer
    // invalidation cancels the running read ON THE WIRE, so a burst of
    // events leaves at most one detail request in flight; closing the card
    // mid-load cancels it too. A cancelled read writes no error and fires
    // no toast — the library handles the abort itself.
    queryFn: ({ signal }) =>
      projectHandle
        ? getIssue(projectHandle, issueId!, { signal })
        : getIssueByID(issueId!, { signal }),
    enabled: !!issueId,
  });

  const issue = issueQuery.data;
  // Once the detail lands, prefer its echoed projectId (UUID) over
  // the URL handle for child-query paths — keeps the deps / activity
  // calls stable when the URL alias differs from the canonical UUID
  // (e.g. an alternate alias that happens to also resolve).
  const projectIdForChildren = issue?.projectId ?? projectHandle ?? null;

  // Comments are project-scoped on the wire, so they wait for a project
  // — but take it from `projectIdForChildren`, which falls back to the
  // projectId echoed by the detail response. That way an issue opened
  // by id alone still loads its thread, one round-trip later.
  const commentsQuery = useQuery<CommentDTO[]>({
    queryKey: issueId ? issueCommentsKey(issueId) : ['issues', 'comments', '∅'],
    queryFn: () => listComments(projectIdForChildren!, issueId!),
    enabled: !!issueId && !!projectIdForChildren,
  });

  const attachmentsQuery = useQuery<AttachmentListResp>({
    queryKey: issueId
      ? issueAttachmentsKey(issueId)
      : ['issues', '∅', 'attachments'],
    queryFn: () => listAttachments(issueId!),
    enabled: !!issueId,
  });

  const dependenciesQuery = useQuery<DependencyList>({
    queryKey:
      issueId && projectIdForChildren
        ? issueDependenciesKey(projectIdForChildren, issueId)
        : ['deps', '∅', '∅'],
    queryFn: () => listDependencies(projectIdForChildren!, issueId!),
    enabled: !!issueId && !!projectIdForChildren,
  });

  const watchersQuery = useQuery<WatcherEntry[]>({
    queryKey: issueId ? issueWatchersKey(issueId) : ['watchers', 'issue', '∅'],
    queryFn: () => listIssueWatchers(issueId!),
    enabled: !!issueId,
  });

  // Activity — per-issue feed (P5). The dedicated
  // `/projects/{pid}/issues/{iid}/activity` endpoint returns events
  // already scoped to this issue (direct issue events + comment events
  // on this issue + dep-edge events involving this issue), newest
  // first via keyset pagination. We render the first page only — a
  // future patch can wire "load more" against the returned nextCursor.
  const activityQuery = useQuery<ActivityListResponse>({
    queryKey:
      issueId && projectIdForChildren
        ? issueActivityKey(projectIdForChildren, issueId)
        : ['activity', 'issue', '∅', '∅'],
    queryFn: () =>
      listIssueActivity(projectIdForChildren!, issueId!, {
        limit: ACTIVITY_PAGE_LIMIT,
      }),
    enabled: !!issueId && !!projectIdForChildren,
  });

  // Server already returns DESC by occurredAt; no client-side filter
  // needed now that the endpoint is issue-scoped.
  const activity: ActivityEntry[] | undefined = activityQuery.data?.items;

  // ─────────────── Mutations ───────────────

  // patchMutation — optimistic updateField. Snapshot the current
  // cache, write the merged optimistic state, send PATCH. On error
  // restore the snapshot and toast. On success, write the canonical
  // server response back (it has the bumped version + any server-
  // side derived fields).
  //
  // Version race fix: callers pass `expectedVersion` directly in the
  // mutation variables. Previously the mutationFn read version from
  // `qc.getQueryData(...)`, but TanStack Query v5 runs `onMutate`
  // BEFORE `mutationFn`, so the optimistic write at line 290 bumped
  // version to N+1 and the mutationFn then sent N+1 as If-Match —
  // server rejected with 409 on every save. Capturing version into
  // mutation variables (resolved from cache by the public action
  // wrapper before mutateAsync fires) sidesteps the race entirely.
  const patchMutation = useMutation<
    IssueDetail,
    Error,
    { patch: PatchIssueInput; expectedVersion: number; reportsInline: boolean },
    { previous: IssueDetail | undefined }
  >({
    mutationFn: async ({ patch, expectedVersion }) => {
      // projectIdForChildren, not projectHandle: an issue opened by id
      // alone has no handle, but the detail response echoed its
      // projectId — without this the edit would fire at `/projects/
      // undefined/...`.
      return patchIssue(projectIdForChildren!, issueId!, expectedVersion, patch);
    },
    onMutate: async ({ patch }) => {
      const key = issueDetailKey(issueId!);
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<IssueDetail>(key);
      if (previous) {
        // Optimistic merge. We bump version locally so any sibling
        // component reading off the cache sees a "post-patch" world;
        // when the server responds we overwrite with canonical data.
        // PatchIssueInput is a field-subset of IssueDetail — spread
        // merge is type-safe without assertion.
        const optimistic: IssueDetail = {
          ...previous,
          ...patch,
          version: previous.version + 1,
        };
        qc.setQueryData<IssueDetail>(key, optimistic);
      }
      return { previous };
    },
    onError: (err, vars, ctx) => {
      const key = issueDetailKey(issueId!);
      // Roll back the optimistic merge.
      if (ctx?.previous) {
        qc.setQueryData<IssueDetail>(key, ctx.previous);
      } else {
        // Fallback — refetch fresh from server.
        void qc.invalidateQueries({ queryKey: key });
      }
      // sk-425 — a version conflict means the snapshot is itself stale:
      // re-read it, so the next attempt (the editor keeps the refused
      // text and offers a retry) carries the version the server has.
      if (isVersionConflict(err)) {
        void qc.invalidateQueries({ queryKey: key });
      }
      // sk-492 — one report per refusal, in one wording. An editor that
      // prints the reason in place asked for no toast; everyone else gets
      // the toast, worded by `saveFailureReason` (translated, the claim
      // holder by the card's own `lockedByUsername`, never the session
      // id the refusal carries) — not the server's raw English message.
      if (!vars.reportsInline) {
        toast.error(
          t('editable.fieldSaveFailed', {
            message: saveFailureReason(err, t, ctx?.previous?.lockedByUsername, 'field'),
          }),
        );
      }
    },
    onSuccess: (dto) => {
      qc.setQueryData<IssueDetail>(issueDetailKey(issueId!), dto);
    },
  });

  const transitionMutation = useMutation<
    IssueDetail,
    Error,
    {
      status: IssueStatus;
      reason?: string;
      force?: boolean;
      close?: TransitionCloseInput;
      expectedVersion: number;
    },
    { previous: IssueDetail | undefined }
  >({
    mutationFn: async ({ status, reason, force, close, expectedVersion }) => {
      return transitionStatus(
        // Same reason as patchMutation above — see the note there.
        projectIdForChildren!,
        issueId!,
        expectedVersion,
        status,
        reason,
        force,
        close,
      );
    },
    onMutate: async ({ status }) => {
      const key = issueDetailKey(issueId!);
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<IssueDetail>(key);
      if (previous) {
        // Optimistic flip — clear the locked_by field on close so the
        // claim button hides immediately, mirror server-side rules.
        const next: IssueDetail = {
          ...previous,
          status,
          version: previous.version + 1,
        };
        qc.setQueryData<IssueDetail>(key, next);
      }
      return { previous };
    },
    onError: (err, _vars, ctx) => {
      const key = issueDetailKey(issueId!);
      if (ctx?.previous) {
        qc.setQueryData<IssueDetail>(key, ctx.previous);
      } else {
        void qc.invalidateQueries({ queryKey: key });
      }
      toast.error(formatPatchError(err));
    },
    onSuccess: (dto) => {
      qc.setQueryData<IssueDetail>(issueDetailKey(issueId!), dto);
    },
  });

  const acceptMutation = useMutation<
    IssueDetail,
    Error,
    { expectedVersion: number },
    { previous: IssueDetail | undefined }
  >({
    mutationFn: async ({ expectedVersion }) => {
      return acceptIssue(issueId!, expectedVersion);
    },
    onMutate: async () => {
      const key = issueDetailKey(issueId!);
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<IssueDetail>(key);
      if (previous) {
        qc.setQueryData<IssueDetail>(key, {
          ...previous,
          acceptedAt: new Date().toISOString(),
          version: previous.version + 1,
        });
      }
      return { previous };
    },
    onError: (err, _vars, ctx) => {
      const key = issueDetailKey(issueId!);
      if (ctx?.previous) qc.setQueryData<IssueDetail>(key, ctx.previous);
      toast.error(formatPatchError(err));
    },
    onSuccess: (dto) => {
      qc.setQueryData<IssueDetail>(issueDetailKey(issueId!), dto);
      toast.success(`Accepted ${dto.id}`);
      // Inbox + counts may have shifted — bust the predicates.
      void qc.invalidateQueries({
        predicate: (q) =>
          Array.isArray(q.queryKey) && q.queryKey[0] === 'inbox',
      });
      void qc.invalidateQueries({
        predicate: (q) =>
          Array.isArray(q.queryKey) && q.queryKey[0] === 'notifications',
      });
    },
  });

  // ─────────── sk-303.14 — review workflow (contract C1) ───────────
  //
  // Two mutations, one shared rule that separates them from every other
  // mutation in this file: THEY MUST NOT MOVE THE VERSION. The server
  // verifies the presented version and deliberately leaves it where it was
  // (INV-2 — the assignee with the card open must not see "something
  // happened"), so an optimistic `version + 1` here would put the cache one
  // ahead of the server and make the NEXT ordinary edit fail its If-Match.
  // The optimistic writes below therefore copy `previous.version` through
  // untouched — the omission is the point, not an oversight.

  const reviewFlagMutation = useMutation<
    IssueDetail,
    Error,
    { required: boolean; expectedVersion: number },
    { previous: IssueDetail | undefined }
  >({
    mutationFn: async ({ required, expectedVersion }) =>
      setReviewRequired(projectHandle!, issueId!, expectedVersion, required),
    onMutate: async ({ required }) => {
      const key = issueDetailKey(issueId!);
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<IssueDetail>(key);
      if (previous) {
        qc.setQueryData<IssueDetail>(key, {
          ...previous,
          reviewRequired: required,
          // version intentionally NOT bumped — see the note above.
        });
      }
      return { previous };
    },
    onError: (err, _vars, ctx) => {
      const key = issueDetailKey(issueId!);
      if (ctx?.previous) qc.setQueryData<IssueDetail>(key, ctx.previous);
      else void qc.invalidateQueries({ queryKey: key });
      toast.error(formatPatchError(err));
    },
    onSuccess: (dto) => {
      qc.setQueryData<IssueDetail>(issueDetailKey(issueId!), dto);
      // Clearing or restoring the flag moves the issue out of / back into
      // the unreviewed set immediately (US-3), so the second number and the
      // unreviewed list are both stale the moment this returns.
      invalidateUnreviewedSurfaces(qc);
    },
  });

  const markReviewedMutation = useMutation<
    IssueDetail,
    Error,
    { expectedVersion: number },
    { previous: IssueDetail | undefined }
  >({
    mutationFn: async ({ expectedVersion }) =>
      markReviewed(projectHandle!, issueId!, expectedVersion),
    onMutate: async () => {
      const key = issueDetailKey(issueId!);
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<IssueDetail>(key);
      if (previous) {
        qc.setQueryData<IssueDetail>(key, {
          ...previous,
          reviewedAt: new Date().toISOString(),
          // version intentionally NOT bumped — see the note above.
        });
      }
      return { previous };
    },
    onError: (err, _vars, ctx) => {
      const key = issueDetailKey(issueId!);
      if (ctx?.previous) qc.setQueryData<IssueDetail>(key, ctx.previous);
      else void qc.invalidateQueries({ queryKey: key });
      toast.error(formatPatchError(err));
    },
    onSuccess: (dto) => {
      qc.setQueryData<IssueDetail>(issueDetailKey(issueId!), dto);
      invalidateUnreviewedSurfaces(qc);
    },
  });

  // ─────────────── Public actions ───────────────
  //
  // Each wrapper resolves the canonical version from the query cache
  // BEFORE calling mutateAsync — capturing it at the moment the user
  // initiates the action, not at the moment the request fires. This
  // avoids the race where TanStack's onMutate runs first, bumps the
  // cached version optimistically, and the mutation function then
  // reads the bumped version and sends a stale If-Match header.

  const updateField = useCallback(
    async (patch: PatchIssueInput, opts?: UpdateFieldOptions) => {
      const reportsInline = opts?.reportsInline ?? false;
      const cur = qc.getQueryData<IssueDetail>(issueDetailKey(issueId!));
      if (!cur) {
        if (!reportsInline) toast.error('Save failed — issue not loaded');
        return { error: new Error('issue not loaded') };
      }
      try {
        return await patchMutation.mutateAsync({
          patch,
          expectedVersion: cur.version,
          reportsInline,
        });
      } catch (err) {
        // Already rolled back (and, unless reported inline, toast'd) in
        // onError. sk-425 — the
        // refusal is REPORTED, not swallowed: it used to resolve `null`,
        // which an inline editor could not tell from success, so it
        // marked the refused text as saved and the rollback then
        // replaced it. Same wrapper as `changeStatus`.
        return { error: err instanceof Error ? err : new Error(String(err)) };
      }
    },
    [patchMutation, qc, issueId, toast],
  );

  const changeStatus = useCallback(
    async (
      next: IssueStatus,
      reason?: string,
      force?: boolean,
      close?: TransitionCloseInput,
    ) => {
      const cur = qc.getQueryData<IssueDetail>(issueDetailKey(issueId!));
      if (!cur) {
        toast.error('Status change failed — issue not loaded');
        return null;
      }
      try {
        return await transitionMutation.mutateAsync({
          status: next,
          reason,
          force,
          close,
          expectedVersion: cur.version,
        });
      } catch (err) {
        // The mutation's onError already rolled back the optimistic
        // flip and fired the generic toast. Surface the raw error to
        // the caller (wrapped, so success/failure are distinguishable
        // from `null`) instead of swallowing it — reason-required
        // callers keep their modal open and render an inline guard.
        return { error: err instanceof Error ? err : new Error(String(err)) };
      }
    },
    [transitionMutation, qc, issueId, toast],
  );

  /**
   * sk-303.14 (T028) — flip "needs review" (author only, INV-4).
   * Resolves to the server card on success, `null` on a refusal already
   * surfaced by the mutation's own toast.
   */
  const changeReviewRequired = useCallback(
    async (required: boolean) => {
      const cur = qc.getQueryData<IssueDetail>(issueDetailKey(issueId!));
      if (!cur) {
        toast.error("Couldn't change the flag — issue isn't loaded");
        return null;
      }
      try {
        return await reviewFlagMutation.mutateAsync({
          required,
          expectedVersion: cur.version,
        });
      } catch {
        return null;
      }
    },
    [reviewFlagMutation, qc, issueId, toast],
  );

  /** sk-303.14 (T028) — mark a closed result read (author only, US-1). */
  const markResultReviewed = useCallback(async () => {
    const cur = qc.getQueryData<IssueDetail>(issueDetailKey(issueId!));
    if (!cur) {
      toast.error("Couldn't mark — issue isn't loaded");
      return null;
    }
    try {
      return await markReviewedMutation.mutateAsync({
        expectedVersion: cur.version,
      });
    } catch {
      return null;
    }
  }, [markReviewedMutation, qc, issueId, toast]);

  const accept = useCallback(async () => {
    const cur = qc.getQueryData<IssueDetail>(issueDetailKey(issueId!));
    if (!cur) {
      toast.error('Accept failed — issue not loaded');
      return null;
    }
    try {
      return await acceptMutation.mutateAsync({
        expectedVersion: cur.version,
      });
    } catch {
      return null;
    }
  }, [acceptMutation, qc, issueId, toast]);

  return {
    issue,
    isLoading: issueQuery.isLoading,
    isError: issueQuery.isError,
    error: issueQuery.error,
    comments: commentsQuery.data,
    attachments: attachmentsQuery.data?.items,
    dependencies: dependenciesQuery.data,
    // Held data wins over a failed refetch — see the docblock on the type.
    dependenciesStatus:
      dependenciesQuery.data !== undefined ? 'success' : dependenciesQuery.status,
    activity,
    watchers: watchersQuery.data,
    issueQuery,
    updateField,
    changeStatus,
    accept,
    changeReviewRequired,
    markResultReviewed,
    reviewPending:
      reviewFlagMutation.isPending || markReviewedMutation.isPending,
  };
}

/**
 * sk-303.14 — the surfaces derived from the unreviewed set (INV-3): the
 * second number on the Delegated control and any Tasks list that may be
 * showing the unreviewed selection. Both go stale the instant the flag or
 * the mark changes, and both are invalidated by predicate rather than by an
 * enumerated key list — a hand-written list of keys is silent when a new
 * surface is added, and the number diverging from its own list is precisely
 * what INV-3 forbids.
 */
function invalidateUnreviewedSurfaces(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({
    predicate: (q) =>
      Array.isArray(q.queryKey)
      && (q.queryKey[0] === 'notification-counts' || q.queryKey[0] === 'tasks'),
  });
}

/** Shape a save error into a short toast string. */
function formatPatchError(err: Error): string {
  if (err instanceof ApiError && err.statusCode === 409) {
    return 'Version conflict — refresh and retry.';
  }
  if (err instanceof BusinessError) return err.message;
  if (err instanceof ApiError) return err.message;
  return err.message || 'Save failed';
}
