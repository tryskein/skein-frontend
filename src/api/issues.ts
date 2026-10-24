/**
 * Issues API client. Wraps every endpoint under
 *   /api/v1/projects/{projectId}/issues/...
 *
 * All mutation endpoints that change persistent state require an
 * `If-Match: <version>` header for optimistic concurrency. The helper
 * functions exposed here always pass the version through — callers must
 * supply the freshest known value (taken from a previously fetched
 * IssueDetail.version or the cache).
 *
 * The 422 / 409 / 428 / 404 responses surface as the standard typed errors
 * defined in ./client (BusinessError for 422, ApiError otherwise) so UI
 * code branches by `instanceof` and `.code`.
 *
 * Wire shapes mirror skein-api/internal/issues/types.go (camelCase JSON).
 */

import { ApiError, apiFetch, apiJson } from './client';
import type { DepType } from './dependencies';
import type { PersonStatus } from './users';

// ───────────────────────── Wire enums ─────────────────────────

export type IssueStatus =
  | 'open'
  | 'in_progress'
  | 'deferred'
  | 'standing'
  | 'closed';

/**
 * Phase 2 ui-redesign — F4. UI-side discriminator for the status filter
 * row in the Tasks column. Wraps the wire `IssueStatus` union with
 * three extra sentinels:
 *   - `'all'`     — no filter, every status visible (incl. closed)
 *   - `'active'`  — everything except `closed` (default — closed tasks
 *                   clutter the day-to-day scan)
 *   - `'blocked'` — sk-31. Derived blocked-ness lens. NOT a wire status
 *                   value (the backend dropped status='blocked'); the
 *                   `useTasks` hook translates this to
 *                   `isBlocked=true` on the wire and the resulting rows
 *                   render `[blocked]` via StatusBadge.
 *
 *   - `'unreviewed'` — sk-303.14 (T024/T025, contract C3). The set of
 *                   closed results the caller delegated and has not
 *                   marked reviewed. Also NOT a wire status — and not a
 *                   state of the issue at all, but a relation between the
 *                   issue and the caller — so `useTasks` omits the wire
 *                   `status` param and sends `unreviewed=true` instead,
 *                   on BOTH delegated paths (project-scoped and
 *                   cross-project). It is the ONE sentinel that must not
 *                   drop closed rows client-side: the set is closed
 *                   results by construction.
 *
 * The backend recognises only the wire `IssueStatus` values. `'all'`,
 * `'active'`, `'blocked'` and `'unreviewed'` are translated client-side:
 * `'all'` → omit the wire status param; `'active'` → omit the param and
 * post-filter out the closed rows; `'blocked'` → set `isBlocked=true` on
 * the wire and skip the status param; `'unreviewed'` → set
 * `unreviewed=true` on the wire and skip the status param.
 */
export type StatusFilter =
  | IssueStatus
  | 'all'
  | 'active'
  | 'blocked'
  | 'unreviewed';

/**
 * Phase 2 ui-redesign — F4. UI-side discriminator for the source filter
 * row. Wire values are the strings the backend whitelists in `issues.go`
 * (OriginHumanDriven / OriginAgentAutonomous). `'all'` is encoded by
 * omitting the param on the wire, but the UI carries it as an explicit
 * value so the button group has a single source of truth.
 */
export type OriginFilter = 'human-driven' | 'agent-autonomous' | 'all';

/**
 * Phase 2 ui-redesign — type filter row in the Tasks column. `'all'`
 * means "no filter". Backend's ListIssues has no `Types` field yet —
 * useTasks post-filters on the wire response by `item.type`. Works
 * fine while the per-page limit (100) is larger than typical type
 * distribution; revisit with a server-side `Types []string` arg if
 * pagination accuracy ever matters here.
 */
export type TypeFilter = IssueType | 'all';

/**
 * sk-86 — priority filter row in the Tasks column. The board / wire
 * priority is the integer 0..4 (0 = highest); this filter is the
 * STRING-encoded union so it slots into the shared
 * `PillButton<T extends string>` chip component and round-trips through
 * localStorage unchanged. `'all'` = no filter.
 *
 * Wire support is split (mirror image of `TypeFilter`): `listIssues`
 * (project-scoped) and `globalSearch` accept `priority=<int>`, so useTasks
 * parses the numeric strings and forwards them there; `listAllIssues` and
 * the `/me/*` lenses have no wire `priority`, so useTasks post-filters
 * those surfaces client-side by `item.priority`.
 */
export type PriorityFilter = 'all' | '0' | '1' | '2' | '3' | '4';

/**
 * Phase 2 ui-redesign — F4. Tasks column body switch.
 *
 * sk-285.2.3 — `'kanban'` joined `'cards'` / `'tree'` as a THIRD mode of
 * the same column, not a separate page: it renders the same task set,
 * under the same filters, into status columns. See
 * `pages/shell/KanbanBoard.tsx`.
 */
export type ViewMode = 'cards' | 'tree' | 'kanban';

/**
 * Phase 2 ui-redesign — F4. Tasks column sort key. The backend currently
 * accepts only `'updated' | 'created'` on the wire, so `priority` and
 * `priority-updated` are realised client-side after the fetch returns.
 * Default per Q30 is `priority-updated` (priority ASC + updated_at DESC).
 *
 * sk-50 — `'relevance'` is an EPHEMERAL, search-only key. It means "keep
 * the server RRF (vector + FTS fusion) ranking — apply no client sort".
 * It is auto-selected when a search begins and lives ONLY in the
 * `useTaskSearchModes` ephemeral `searchSort` overlay; it is never
 * persisted to localStorage (deliberately absent from the `SORT_VALUES`
 * whitelist in `useTasksUiState`) and is never a valid value outside an
 * active search. Both the `useTasks` (cards/flat) and the `TasksColumn`
 * tree comparator treat it as "no re-sort, preserve input order".
 */
export type TasksSortKey =
  | 'priority-updated'
  | 'updated'
  | 'priority'
  | 'created'
  | 'id'
  | 'relevance';

export type IssueType =
  | 'bug'
  | 'feature'
  | 'task'
  | 'epic'
  | 'chore'
  | 'decision'
  | 'idea'
  | 'note';

/**
 * Issue origin — the server's closed set (sk-421.1 US-11). `human` —
 * created by a person (web UI / REST); `agent_directed` — created by an
 * agent on a person's instruction; `agent_autonomous` — created by an
 * agent on its own initiative. The detail DTO, the task-list `source`
 * param and the `/search` `source` param all use this one type, so a
 * value outside the server set fails the type build instead of hitting
 * `400 invalid_source` at runtime.
 */
export type IssueSource = 'human' | 'agent_directed' | 'agent_autonomous';

export type CommentAuthorType = 'human' | 'agent' | 'system';

/**
 * sk-489 (US-1, INV-2) — the close outcome: how a CLOSED issue ended.
 * The set is closed, and the SERVER closes it: it rejects a value outside the four
 * on input (`close_outcome.go#ValidateCloseOutcome`).
 */
export type KnownCloseOutcome = 'done' | 'wont_do' | 'duplicate' | 'superseded';

/**
 * The outcome on the wire. `(string & {})` is not a loophole and not "just in case":
 * the client must ACCEPT a value it does not know (the api is newer than us, or
 * the set was extended), print it as is, with no tone, and attribute it neither to
 * the done nor to the dropped ones (INV-2). Narrowing the type to a union would mean
 * forcing every print site to pretend that an unfamiliar value cannot exist.
 *
 * Telling known from unfamiliar is `lib/closeOutcome.ts`
 * (`#isKnownCloseOutcome`, `#closeOutcomeLabelKey`), not a comparison
 * of strings at the call site.
 */
export type CloseOutcome = KnownCloseOutcome | (string & {});

// ───────────────────────── Wire DTOs ─────────────────────────

/** Lean shape returned by GET /issues — omits long text and metadata. */
export interface IssueSummary {
  id: string;
  projectId: string;
  /**
   * sk-674.18 (T032) — short id of the space of the issue's project; never
   * null once served. Additive: absent until skein-api serves it.
   */
  spaceId?: string;
  /**
   * sk-674.18 (T027, the lead's decision on T055) — the state of the
   * assignee and of the author in the issue's space: departed / deleted +
   * pseudonym. Additive: absent until skein-api serves it; absent = nothing
   * to mark.
   */
  assigneeStatus?: PersonStatus;
  createdByStatus?: PersonStatus;
  /**
   * Current parent id derived from the dependencies graph (sk-35:
   * first parent-child edge by `created_at`). Wire field is
   * `parentIdCurrent` — the legacy `issues.parent_id` column is
   * frozen and would silently miss children created post-sk-35.
   * `null` when the issue has no parent.
   */
  parentIdCurrent?: string | null;
  version: number;
  title: string;
  type: IssueType;
  priority: number;
  status: IssueStatus;
  pinned: boolean;
  /** Display name / handle for the assignee (back-compat field). */
  assignee?: string | null;
  /**
   * UUID of the user record behind `assignee`. Optional — present when the
   * server resolved the handle against a real user. Enables clickable
   * profile links in the UI.
   */
  assigneeUserId?: string | null;
  /**
   * Username of the issue creator. Optional — present when the server
   * resolved createdBy (UUID) against a real user. Falls back to '?' in UI.
   */
  createdByUsername?: string | null;
  componentIds: string[];
  labels: string[];
  /**
   * ISO-8601 timestamp of the last explicit `accept` from the current
   * assignee. `null`/missing → "needs acceptance" (Inbox surface). Reset
   * to null whenever the assignee changes; auto-populated when the creator
   * self-assigns. Wire shape: backend omits the field when null
   * (`json:",omitempty"` on the Go side), so TS sees `undefined` for
   * unaccepted issues. Phase 2 ui-redesign — B5.
   */
  acceptedAt?: string | null;
  /**
   * True when the caller created the issue and assigned it to someone else
   * — used by the UI to highlight "tasks I delegated" (★ tint per Q23).
   * Server computes from `created_by == caller AND assignee != caller`;
   * absent for issues the caller is also assignee of, and for unauth'd
   * callers. Wire field is `omitempty`, so TS sees `undefined` outside
   * "I delegated" rows. Phase 2 ui-redesign — B5.
   */
  iAssigned?: boolean;
  /**
   * sk-31. Derived blocked-ness flag — true when the issue has at least
   * one outgoing typed-deps edge (`blocks` / `waits-for`) to an unclosed
   * target. Backend computes this on every SELECT, so callers never see
   * a stale value relative to the dep graph. Use for the `[blocked]`
   * chip in `StatusBadge` (overrides the wire `status` when true).
   */
  isBlocked: boolean;
  /**
   * sk-32. Compact child-count rollup surfaced on epic-typed rows so the
   * task list can render inline progress without a per-row IssueDetail
   * fetch. Carries the original `closed` / `total` pair AND, since
   * sk-489, the progress legs `done` / `noWork` / `counted`; an api that
   * predates the feature sends the pair alone (US-10). Children counted via hierarchical (parent_id)
   * only (sk-33 dropped the parent-child dep edge). Absent on every
   * non-epic row (server uses CASE-WHEN so non-epic rows pay zero
   * cost).
   */
  epicProgress?: EpicProgress | null;
  /**
   * sk-489 (US-7) — the close outcome of a row. Present exactly on a closed
   * issue (INV-1) and wire `omitempty`, so `undefined` reads two ways —
   * "the issue is not closed" OR "an api that knows nothing about the outcome answers"
   * (US-10). Neither is "done": absence is substituted
   * with a default value nowhere.
   */
  closeOutcome?: CloseOutcome | null;
  updatedAt: string;
  createdAt: string;
  /**
   * UUID of the issue creator. Sent by every list endpoint (the server
   * row carries it); absent on rows adapted from the `/search` projection
   * (`useTasks.ts#searchItemToSummary`). The phase-2 row patch reads it to
   * compute `iAssigned` the way the server does (sk-622.21 K17).
   */
  createdBy?: string;
  /**
   * sk-622.21 (US-15, K16) — row freshness order: the value of the issue's
   * freshness sequence after its last committed change, label and
   * component writes included. For ONE issue a greater value is a later
   * state; values of different issues are not comparable. A phase-2 event
   * row is substituted only if its `rowSeq` is greater than the shown one
   * (`lib/liveRowPatch.ts`). Absent (or 0) = order unknown — any event
   * row counts as fresher (a `/search` row, an older api).
   */
  rowSeq?: number;
  /**
   * sk-53. RRF relevance score, present ONLY on rows that came from the
   * hybrid `/search` endpoint (search mode) — the list endpoints don't
   * carry it. Drives the search-only relevance badge. Absolute RRF value
   * (vector + FTS fusion, ~0..0.033); the UI calibrates it to a percent,
   * NOT relative to the page top. Absent → no badge.
   */
  score?: number | null;
}

/**
 * sk-32. Compact rollup on IssueSummary rows for epic-typed issues.
 * Powers the progress chip in TaskCard / TaskTreeNode meta-rows without
 * a per-row IssueDetail fetch — "(done N/M)" when the outcome legs
 * are present, "(closed N/M)" when they are not (sk-489 US-10).
 */
export interface EpicProgress {
  closed: number;
  total: number;
  /**
   * sk-421.2 / sk-291. Children in projects the caller cannot see. They
   * stay inside `total` and are absent from `closed` — and, since
   * sk-489, inside `counted` and absent from `done` by the same
   * construction — so the chip stays honest on either pair without
   * disclosing anything about the invisible rows. Optional: absent means the server does not
   * report it, which must not be rendered as 0 (INV-8).
   */
  unavailable?: number;
  /**
   * sk-489 (US-6, INV-5) — the numerator of the row progress: visible children
   * closed with the outcome "done".
   *
   * All three new fields are OPTIONAL on the client side, although the server sends
   * them always (no `omitempty`, zero is meaningful): optionality here
   * describes not the server but the ROLLOUT WINDOW — the new frontend must survive
   * an api answer that knows nothing about the outcome, and not turn absence into
   * zero (US-10, SC-010). They are read only through
   * `lib/progressNumbers.ts#progressNumbers`, which holds this distinction;
   * `?? 0` at the call site is forbidden.
   */
  done?: number;
  /** Visible children closed without work. Not part of the denominator. */
  noWork?: number;
  /** The progress denominator: `total` minus the visible dropped ones. */
  counted?: number;
}

/**
 * sk-32. Full rollup on IssueDetail for epic-typed issues. Surfaces the
 * counters needed by the Epic Progress section + the "Ready to close"
 * badge in DetailsHeader. Absent on every non-epic IssueDetail (server
 * uses i.type='epic' gate).
 *
 * sk-421.2 — the identity the card renders MUST close:
 *   closed + (open + inProgress) + deferred + unavailable = total
 * `standingChildren` is outside it by design (a perpetual obligation
 * never closes, so it must not hold its epic open).
 *
 * `blockedChildren` is NOT a bucket of its own: since R-11 it counts only
 * children that are themselves `open` or `in_progress` AND carry an
 * active blocker, i.e. it is a SUBSET of open + inProgress and can never
 * exceed them. Read it as a breakdown of "not done", never as a status
 * pill of its own and never as a total. A DEFERRED child carrying a
 * blocker lands in `deferredChildren` only.
 */
export interface EpicRollup {
  totalChildren: number;
  openChildren: number;
  inProgressChildren: number;
  closedChildren: number;
  blockedChildren: number;
  /**
   * sk-421.2 (R-1). Children parked as `deferred`. They are NOT closed,
   * so they keep the epic unfinished, and without this bucket the card's
   * identity did not close at all. Optional so a new frontend keeps
   * working against an API that predates it (INV-8) — absent means "the
   * server does not report it", which the card must not render as 0.
   */
  deferredChildren?: number;
  /**
   * sk-421.2 / sk-291. Children in projects the caller cannot see. They
   * stay in `totalChildren` and appear in NO status bucket — the status
   * of an invisible task must not be recoverable, including by
   * subtraction. Optional for the same INV-8 reason as above.
   */
  unavailableChildren?: number;
  /**
   * sk-118 (F2h, §11.5). Count of `standing` children under this epic.
   * Standing children are EXCLUDED from totalChildren / eligibleForClose
   * (a perpetual obligation never closes, so it must not block its
   * parent epic from becoming "ready to close") and surfaced in this
   * dedicated bucket only. Optional so the type degrades gracefully if
   * the frontend ships ahead of the backend.
   */
  standingChildren?: number;
  /**
   * True when totalChildren > 0 AND closedChildren == totalChildren.
   * Empty epics never become eligible (would be a false signal: "0 of
   * 0 closed" doesn't mean "done"). sk-118: standing children are
   * excluded from totalChildren, so an epic whose only non-closed child
   * is standing still becomes eligible.
   */
  eligibleForClose: boolean;
  /**
   * sk-489 (US-5, INV-5) — the ring numerator: visible children closed with
   * the outcome "done". Differs from `closedChildren`, which stays
   * a breakdown BY STATUS and does not change with the feature (INV-3).
   *
   * Optionality is about the rollout window, not the server: see the same paragraph
   * at `EpicProgress.done`. Read only through
   * `lib/progressNumbers.ts#progressNumbers`.
   */
  doneChildren?: number;
  /** Visible children closed without work. The tail "without work: N" of the ring. */
  noWorkChildren?: number;
  /** The progress denominator: `totalChildren` minus the visible dropped ones. */
  countedChildren?: number;
}

/** Full DTO returned by GET /issues/{id} and every mutation. */
export interface IssueDetail {
  id: string;
  projectId: string;
  /**
   * sk-674.18 (T032) — short id of the space of the issue's project; never
   * null once served. Additive: absent until skein-api serves it.
   */
  spaceId?: string;
  /**
   * sk-674.18 (T027, the lead's decision on T055) — the state of the
   * assignee and of the author in the issue's space: departed / deleted +
   * pseudonym. Additive: absent until skein-api serves it; absent = nothing
   * to mark.
   */
  assigneeStatus?: PersonStatus;
  createdByStatus?: PersonStatus;
  /**
   * sk-674.18 (T034) — the caller may release another holder's claim
   * (project owner, space owner, admin). Additive: absent until skein-api
   * serves it; absent reads as `false`.
   */
  canForceUnlock?: boolean;
  /**
   * Current parent id derived from the dependencies graph. See
   * IssueSummary.parentIdCurrent for the full rationale.
   */
  parentIdCurrent?: string | null;
  version: number;
  title: string;
  description: string;
  type: IssueType;
  priority: number;
  status: IssueStatus;
  pinned: boolean;
  source: IssueSource;
  sourceContext?: string | null;
  assignee?: string | null;
  /**
   * UUID of the user record behind `assignee`, if resolvable. Optional —
   * see IssueSummary.assigneeUserId.
   */
  assigneeUserId?: string | null;
  lockedBy?: string | null;
  lockedAt?: string | null;
  /**
   * sk-421.1 (US-8, US-15) — username of the claim holder, derived by the
   * server from the live claim record. Optional and wire-omitempty:
   * absent when the issue is not claimed, or when there is no record of
   * the claim fact. The card shows it instead of `lockedBy` (a session
   * id, never displayed — INV-4).
   */
  lockedByUsername?: string | null;
  design: string;
  acceptanceCriteria: string;
  notes: string;
  estimatedMinutes?: number | null;
  dueAt?: string | null;
  deferUntil?: string | null;
  startedAt?: string | null;
  closedAt?: string | null;
  closedReason?: string | null;
  /**
   * sk-489 (US-1, US-7) — the close outcome. Present exactly on a closed issue
   * (INV-1); reopening erases it (US-4).
   *
   * `undefined` is ambiguous and this is NOT a type defect: "the issue is not closed" and
   * "an api that knows nothing about the outcome answers" are one and the same absence
   * (US-10). The outcome edit control in the card is shown only when the
   * field ARRIVED, that is, the distinction is looked at, not the value.
   */
  closeOutcome?: CloseOutcome | null;
  /**
   * Accepted-by triple, mirroring the IssueSummary surface but with the
   * additional `acceptedBy` user-uuid + `acceptedByUsername` join used by
   * the details panel. All three are wire-`omitempty` so an unaccepted
   * issue surfaces as `undefined` for each.
   */
  acceptedAt?: string | null;
  acceptedBy?: string | null;
  acceptedByUsername?: string | null;
  externalRef?: string | null;
  createdBy: string;
  /**
   * Username of the issue creator, when the server resolved createdBy
   * against a known user. Falls back to '?' in UI when missing.
   */
  createdByUsername?: string | null;
  createdAt: string;
  updatedAt: string;
  /**
   * sk-622.21 (US-15, K16) — row freshness order of the card; same value
   * and rule as `IssueSummary.rowSeq`. An event that changes only fields
   * of the row is laid onto the open card only if its row's `rowSeq` is
   * greater (`lib/liveRowPatch.ts`).
   */
  rowSeq?: number;
  metadata: Record<string, unknown>;
  componentIds: string[];
  labels: string[];
  commentsCount: number;
  /**
   * Commit references attached to this issue (populated by the
   * commit-on-close work, R3.4). One entry per commit linked via
   * `skein_close({commits: [...]})`. Always non-null array `[]` when
   * none are attached.
   */
  commitRefs: CommitRef[];
  /**
   * R4.3 — resolved @username mentions across description / notes /
   * acceptance_criteria / design. Frontend renderer substitutes
   * <UserMention> for `@username` matches whose username is in this
   * list; unresolved `@foo` stays plain text. Always non-empty array
   * `[]` rather than null/undefined.
   */
  mentions: MentionRef[];
  /**
   * sk-31. Same as IssueSummary.isBlocked. True when the issue has at
   * least one open blocker (outgoing blocks/waits-for edge to a target
   * whose status != 'closed').
   *
   * sk-423: only blockers the READER can see count — a blocker in a
   * project outside the reader's horizon never makes the issue blocked
   * (it is counted in `unavailableBlockingLinks` instead). True iff
   * `blockers` of the same response is non-empty. An api older than
   * sk-423 counted hidden blockers too; the frontend takes the flag as
   * sent either way and never derives blocked-ness on its own.
   */
  isBlocked: boolean;
  /**
   * sk-31. The list of currently-open blockers backing `isBlocked`.
   * Empty array when not blocked. Carries the slim {id, title, status}
   * triple so the UI can render a tooltip / chip without a per-blocker
   * fetch. Always non-null on the wire.
   *
   * sk-423: every entry is a blocker the reader can see. An api older
   * than sk-423 also sent `{id, redacted: true}` for a hidden blocker
   * (sk-421.1, see `BlockerRef`) — still read, never produced by the
   * current api.
   */
  blockers: BlockerRef[];
  /**
   * sk-423 — number of outgoing `blocks` / `waits-for` edges to issues
   * outside the reader's horizon, WHATEVER their status (closed and
   * standing included). The fact of a link, not a claim that it blocks:
   * it says nothing about the hidden issue's status. Such an issue may
   * still keep this one out of the ready list, since readiness counts
   * every blocker — that is what the card explains with it.
   *
   * The current api always sends it (0 when there are none). Optional
   * because an api older than sk-423 does not send it at all: absent
   * reads as «nothing to show», never as an error.
   */
  unavailableBlockingLinks?: number;
  /**
   * sk-32. Epic rollup — populated only when type === 'epic', absent
   * (undefined) on every other type. Carries the five child-count
   * aggregates + the eligibleForClose flag for the "Ready to close"
   * badge in DetailsHeader.
   */
  epic?: EpicRollup | null;
  /**
   * sk-34. Delegation chain — every user UUID that was ever the issue's
   * assignee, in append-order with no duplicates. The current assignee
   * is NOT in this array (it's pruned when they're (re)assigned).
   *
   * Drives the "Drop from Delegated" affordance: a caller whose UUID is
   * here AND not in dismissedBy AND is not the current assignee AND is
   * not the creator sees the Drop button. Wire-omitempty — older
   * clients see undefined.
   */
  previousAssignees?: string[];
  /**
   * sk-37 — username projection of previousAssignees in matching order.
   * Drives the delegation-chain renderer in the details header. Empty
   * strings stand in for deleted users; the renderer skips those slots.
   */
  previousAssigneeUsernames?: string[];
  /**
   * Username projection of dismissedBy in matching order. Same semantics
   * as previousAssigneeUsernames.
   */
  dismissedByUsernames?: string[];
  /**
   * sk-34. Users who explicitly opted out of this issue's Delegated
   * lens via "Drop from Delegated" (skein_drop_delegated). Sticky —
   * cleared only when the user becomes the current assignee again.
   * Wire-omitempty — older clients see undefined.
   */
  dismissedBy?: string[];

  // ─── sk-303.14 (contract C1) — the review workflow, AUTHOR-ONLY ───
  //
  // All three keys are wire-`omitempty` AND the server sends them only to
  // the issue's author (INV-2, SC-028): a reader who is not the author
  // gets no key at all — not `false`, not `null`. That is the whole point:
  // an empty value would still tell the assignee that a mechanic exists
  // and is currently "not marked", and the invariant is that they cannot
  // tell a marked issue from an unmarked one at all.
  //
  // So `undefined` here is ambiguous BY DESIGN — "I am not the author" and
  // "the author's flag is unset" are the same absence — and the UI must not
  // read authorship out of it. Gate on `issue.createdBy === user.id`, which
  // is the invariant INV-4 actually states, and only then read these.

  /**
   * «Needs review» — the author's per-issue flag. When cleared, the
   * issue can never enter the unreviewed set and marking it reviewed is
   * refused (`review_flag_cleared`): a cleared flag is a stated "I am not
   * interested", and asking the same question again ignores that answer.
   *
   * Changed via `setReviewRequired` below — NEVER through `patchIssue`
   * alongside other fields; the server rejects a mixed body with 400.
   */
  reviewRequired?: boolean;
  /** When the author marked the result read. Absent = not marked. */
  reviewedAt?: string | null;
  /** UUID of whoever placed the mark (always the author). */
  reviewedBy?: string | null;
}

/**
 * sk-31. One entry of IssueDetail.blockers — the issue blocking the
 * loaded one. Title + status let the UI render an actionable tooltip
 * without an extra round-trip per blocker.
 *
 * sk-423 contract (current api): every entry is visible, `{id, title,
 * status}`, no `redacted` key.
 *
 * Legacy form (api older than sk-423, sk-421.1): a blocker the reader
 * cannot see is sent as `{id, redacted: true}` — `title` and `status`
 * ABSENT. That api also counted it in `isBlocked`, so the card keeps
 * drawing it (lock + "unavailable") for as long as such an api answers.
 * Hence both descriptive fields stay optional: a renderer must check
 * `redacted` (or the fields) and never print a hidden blocker's title.
 */
export interface BlockerRef {
  id: string;
  /** Absent on a redacted entry. */
  title?: string;
  /** Absent on a redacted entry. */
  status?: IssueStatus;
  /** `true` when the blocker is hidden from the reader; absent otherwise. */
  redacted?: boolean;
}

/**
 * One resolved mention entry. Matches the backend MentionRef DTO —
 * username is the canonical lowercase form, userId is the users.id.
 * Used for both IssueDetail.mentions and CommentDTO.mentions.
 */
export interface MentionRef {
  username: string;
  userId: string;
  /**
   * sk-674.18 (T027, review C3 of T055) — the mentioned person's state in
   * the issue's space: departed / deleted + pseudonym. Additive: absent
   * until skein-api serves it; absent = nothing to mark.
   */
  status?: PersonStatus;
}

/**
 * One commit reference linked to an issue via the commit-on-close work
 * (R3.4). Mirrors `internal/issues/types.go::CommitRef`. `repoUrl` /
 * `url` / `message` / `author` are populated when the project's git
 * repo metadata + git provider integration could resolve them; missing
 * fields stay undefined on the wire (`omitempty` Go-side).
 */
export interface CommitRef {
  hash: string;
  repoId: string;
  repoUrl?: string;
  url?: string;
  message?: string;
  author?: string;
  committedAt?: string;
  linkedAt: string;
  linkedBy?: string;
  /**
   * Who linked the commit. Mirrors the `CommentAuthorType` union —
   * server emits `human` (UI / REST), `agent` (MCP-driven close), or
   * `system` (replay / migration job).
   */
  linkedByKind: 'human' | 'agent' | 'system';
}

/**
 * sk-16 — the *intent* axis on a comment, orthogonal to `authorType`
 * (the transport axis).
 *
 *  - `human`            — posted via the cookie-session UI by a human user
 *  - `agent_directed`   — posted by an agent on the human's instruction
 *                         ("leave a comment with my answer below")
 *  - `agent_autonomous` — posted by an agent on its own initiative
 *                         (handoff note, progress update, side-quest)
 *
 * The Humans / Agents filter chips on the comment thread fold the first
 * two into "Humans" (a human is semantically behind the comment) and
 * surface `agent_autonomous` separately as "Agents". `authorType`
 * (`human` / `agent` / `system`) is preserved on the wire — it reports
 * HOW the comment was posted, not WHO is behind it.
 */
export type CommentAuthorKind = 'human' | 'agent_directed' | 'agent_autonomous';

export interface CommentDTO {
  id: string;
  issueId: string;
  author: string;
  authorUserId?: string | null;
  /**
   * sk-674.18 (T027, the lead's decision on T055) — the author's state in
   * the issue's space: departed / deleted + pseudonym. Additive: absent
   * until skein-api serves it.
   */
  authorStatus?: PersonStatus;
  authorType: CommentAuthorType;
  /** sk-16 — intent axis; see CommentAuthorKind. */
  authorKind: CommentAuthorKind;
  body: string;
  createdAt: string;
  updatedAt: string;
  /**
   * sk-57 — optimistic-concurrency counter (starts at 1, bumped on every
   * edit). Pass the value you last read as `expectedVersion` when calling
   * {@link updateComment}.
   */
  version: number;
  /**
   * sk-57 — set on the first edit (null until then). Non-null ⇒ render an
   * "edited" badge with the edit timestamp as tooltip.
   */
  editedAt?: string | null;
  /**
   * sk-57 — set when the comment is soft-deleted. Non-null ⇒ render a
   * muted tombstone ("comment deleted") in place of the body, with no
   * edit/delete actions. `body` and `mentions` arrive blanked from the
   * server for deleted rows.
   */
  deletedAt?: string | null;
  /**
   * R4.3 — resolved @username mentions in this comment's body. Same
   * shape and semantics as IssueDetail.mentions. Always non-null.
   */
  mentions: MentionRef[];
}

/**
 * sk-16 — optional `kind` parameter on POST /comments. Cookie-session
 * callers should omit this (backend forces `human`); agent callers
 * MUST pass one of these values or the backend returns 400.
 *
 * The frontend's cookie path leaves this undefined — the corresponding
 * field on the wire is omitted by `addComment`. Agent-driven callers
 * (e.g. a future SDK path) pass `directed` or `autonomous`.
 */
export type CommentKindParam = 'directed' | 'autonomous';

export interface LabelStat {
  label: string;
  count: number;
}

export interface ListIssuesResult {
  items: IssueSummary[];
  /**
   * Absolute caller-visible count for the same WHERE clause as items[]
   * (sans cursor). Populated by every list endpoint — project-scoped
   * `/projects/{id}/issues`, caller-scoped `/me/{mode}`, and cross-
   * project `/issues`. The Tasks column reads this for its header
   * counter ("Tasks · N") without paging through every match. Older
   * servers (pre-infinite-scroll Tasks work) returned 0; treat
   * undefined/missing as 0 for back-compat.
   */
  total?: number;
  nextCursor?: string | null;
  hasMore: boolean;
}

/**
 * Sc3 — cross-project list result (`GET /api/v1/issues`). Adds an
 * absolute `total` count over the same WHERE clause so the "All
 * projects" Tasks column can render an authoritative counter without
 * paging through every match. The project-scoped + caller-scoped list
 * endpoints don't populate this field (server returns `0`), and we
 * keep the surface separate so the type system reflects the contract.
 */
export interface ListAllIssuesResult {
  items: IssueSummary[];
  total: number;
  nextCursor?: string | null;
  hasMore: boolean;
}

/**
 * One row from POST /issues/check-duplicates. The server scores the
 * supplied (title, description?) pair against existing issues in two
 * layers — trigram similarity on the title (pg_trgm) and a semantic
 * vector rerank — and states which of them produced this row.
 */
export interface DuplicateCandidate {
  id: string;
  title: string;
  status: IssueStatus;
  type: IssueType;
  /** 0.0..1.0, the strongest of the per-layer scores below. */
  similarity: number;
  /**
   * Per-layer scores. `null` means that layer did not score this row —
   * never absent, so provenance is read, not guessed (sk-228).
   */
  trigramSimilarity: number | null;
  semanticSimilarity: number | null;
  /** Which layer(s) scored the row. */
  matchedBy: 'trigram' | 'semantic' | 'both';
}

export interface CheckDuplicatesResponse {
  candidates: DuplicateCandidate[];
  /**
   * sk-228 — true means the semantic layer could not be consulted, so an
   * empty `candidates` is "we could not compare", not "we compared and
   * found nothing". A UI that reads an empty list as a clean bill of
   * health while this is true is telling the user something the server
   * did not say.
   */
  degraded: boolean;
  /** Prose for a human; present only while `degraded` is true. */
  degradedReason?: string;
}

export interface CheckDuplicatesInput {
  title: string;
  description?: string;
}

// ───────────────────────── Inputs ─────────────────────────

export interface ListIssuesParams {
  /**
   * Comma-separated list of statuses. Server accepts repeated `?status=`
   * but our helper joins into one CSV — both shapes work.
   */
  status?: IssueStatus[];
  priority?: number;
  /** Filter by hierarchical parent id (e.g. `demo-42`). */
  parentId?: string;
  pinned?: boolean;
  /** ILIKE on title. R1.5 will replace with FTS. */
  text?: string;
  assignee?: string;
  /**
   * Phase 2 ui-redesign — F4 / sk-30. Outbox-mode filter. `'me'` maps to
   * `createdBy=me` (issues the caller originated); `'not-me'` maps to
   * `createdBy=not-me` (the "On me" lens — issues the caller did NOT
   * originate). Server rejects any other value.
   */
  createdBy?: 'me' | 'not-me';
  /**
   * Phase 2 ui-redesign — F4. When true, restricts the result to issues
   * whose assignee hasn't accepted yet (`accepted_at IS NULL`). Maps to
   * the literal `acceptedAt=null` query parameter the server expects.
   */
  acceptedAtNull?: boolean;
  /**
   * sk-30 — "On me" lens prefix. When true, restricts to issues with
   * `accepted_at IS NOT NULL`. Maps to query param `acceptedAt=not-null`.
   * Mutually exclusive with `acceptedAtNull` at the wire level (server
   * accepts only one of the two literal values).
   */
  acceptedAtNotNull?: boolean;
  /**
   * Phase 2 ui-redesign — F4. Origin grouping (`human-driven` /
   * `agent-autonomous` / `all`). The wire encodes `'all'` as the
   * absence of the param; we accept the literal here so the UI button
   * group has one source of truth.
   */
  origin?: OriginFilter;
  /** Repeated `?label=` on the wire. */
  labels?: string[];
  /**
   * Component UUID — restricts the result to issues pinned via the
   * `issue_components` junction table. The backend pushes this into an
   * EXISTS subquery so callers don't have to over-fetch and post-filter.
   * Single value only; multi-component intersect / union is not yet a
   * use case the UI exercises.
   */
  componentId?: string;
  /**
   * Filter by issue origin — one of the server's closed set
   * (`IssueSource`: `human` / `agent_directed` / `agent_autonomous`).
   * Vision §F24/§F25. Server validates and returns 400 invalid_source
   * on anything else.
   *
   * Distinct from `origin` above: `source` filters on the creator-set
   * `issues.source` column only; `origin` filters on the broader
   * human-driven / agent-autonomous grouping the new shell exposes
   * (which factors in the actor on the most recent transition, not
   * just the creator).
   */
  source?: IssueSource;
  /**
   * Wire sort accepts only `'updated'` / `'created'`; the F4 column
   * supports `priority` and `priority-updated` too via client-side
   * realisation (see useTasks.ts). Anything beyond the wire-supported
   * pair is normalised to `'updated'` before being sent on the wire.
   */
  sort?: 'updated' | 'created';
  /**
   * sk-31. Derived blocked-ness filter. `true` narrows to issues with at
   * least one open outgoing blocks/waits-for edge; `false` narrows to
   * issues with no open blockers. `undefined` = no filter. Maps to
   * `?isBlocked=true|false` on the wire.
   */
  isBlocked?: boolean;
  /**
   * sk-303.14 (T025, contract C3) — the unreviewed selection on the
   * PROJECT-SCOPED half of the Delegated surface. `true` narrows to the
   * closed results the caller created, delegated to someone else and has
   * not marked reviewed; membership is defined once, server-side (INV-3),
   * so there is no client-side re-derivation of the set anywhere.
   *
   * Maps to the literal `?unreviewed=true`; the server accepts no other
   * value, deliberately — a typo must not read as "the selection applied
   * and found nothing".
   *
   * This path has no "closed excluded by default" rule to lift, so
   * nothing else has to travel with it. Pair it with `createdBy: 'me'`:
   * the selection narrows the delegated surface, it does not define it.
   */
  unreviewed?: boolean;
  cursor?: string | null;
  /** 1..100, default 50. */
  limit?: number;
}

export interface CreateIssueInput {
  /** Only honoured when project.defaultIdMode === 'custom'. */
  id?: string;
  parentId?: string;
  title: string;
  description?: string;
  type: IssueType;
  priority?: number;
  assignee?: string;
  componentIds?: string[];
  labels?: string[];
  design?: string;
  acceptanceCriteria?: string;
  notes?: string;
  estimatedMinutes?: number;
  dueAt?: string;
  deferUntil?: string;
  externalRef?: string;
  metadata?: Record<string, unknown>;
}

export interface PatchIssueInput {
  title?: string;
  description?: string;
  type?: IssueType;
  priority?: number;
  assignee?: string | null;
  design?: string;
  acceptanceCriteria?: string;
  notes?: string;
  estimatedMinutes?: number | null;
  dueAt?: string | null;
  deferUntil?: string | null;
  externalRef?: string | null;
  /**
   * sk-489 (US-12) — editing the outcome of an already closed issue, without reopening.
   *
   * Here, unlike `transitionStatus`, the outcome ALWAYS goes on the wire,
   * including `done`: this is not a transition that has a server default, but
   * an explicit field edit, and "done" is its value just like the other
   * three. Omitting it would mean sending a PATCH that changes nothing.
   */
  closeOutcome?: CloseOutcome;
  /** The target of a "duplicate" / "superseded" link (US-2). Only with these two outcomes. */
  closeTarget?: string;
  // sk-303.14 — `reviewRequired` is DELIBERATELY absent from this type.
  // The server refuses (400) any PATCH body that carries the review flag
  // together with an ordinary field, because half-applying such a request
  // is exactly what that rule prevents. Keeping the key out of the shared
  // patch input means no caller can assemble the forbidden body by
  // accident; the flag has its own function, `setReviewRequired`.
}

// ───────────────────────── URL helpers ─────────────────────────

function buildIssuesQuery(params: ListIssuesParams): string {
  const sp = new URLSearchParams();
  if (params.status && params.status.length) sp.set('status', params.status.join(','));
  if (params.priority !== undefined) sp.set('priority', String(params.priority));
  if (params.parentId) sp.set('parentId', params.parentId);
  if (params.pinned !== undefined) sp.set('pinned', String(params.pinned));
  if (params.text) sp.set('text', params.text);
  if (params.assignee) sp.set('assignee', params.assignee);
  if (params.createdBy) sp.set('createdBy', params.createdBy);
  if (params.acceptedAtNull) sp.set('acceptedAt', 'null');
  if (params.acceptedAtNotNull) sp.set('acceptedAt', 'not-null');
  // 'all' is the wire default — encoded as absence of the param.
  if (params.origin && params.origin !== 'all') sp.set('origin', params.origin);
  // Repeated `?label=` on the wire — `append` instead of `set`.
  if (params.labels) for (const l of params.labels) sp.append('label', l);
  if (params.componentId) sp.set('componentId', params.componentId);
  if (params.source) sp.set('source', params.source);
  if (params.sort) sp.set('sort', params.sort);
  if (params.isBlocked !== undefined) sp.set('isBlocked', String(params.isBlocked));
  // sk-303.14 — only the literal "true" exists on the wire; `false` is
  // spelled by leaving the parameter out, so we never send it.
  if (params.unreviewed) sp.set('unreviewed', 'true');
  if (params.cursor) sp.set('cursor', params.cursor);
  if (params.limit !== undefined) sp.set('limit', String(params.limit));
  const qs = sp.toString();
  return qs ? `?${qs}` : '';
}

function ifMatchHeaders(version: number): Record<string, string> {
  return { 'If-Match': String(version) };
}

const base = (projectId: string) =>
  `/api/v1/projects/${encodeURIComponent(projectId)}`;

// ───────────────────────── Listing ─────────────────────────

export async function listIssues(
  projectId: string,
  params: ListIssuesParams = {},
): Promise<ListIssuesResult> {
  return apiJson<ListIssuesResult>(`${base(projectId)}/issues${buildIssuesQuery(params)}`);
}

/**
 * R3.3 — caller-scoped issue lists across every visible project.
 *
 *  - `assigned-by`  → issues whose creator is the caller
 *  - `assigned-to`  → issues whose assignee resolves (case-insensitive
 *                     username match) to the caller
 *
 * Both are open-only by default; pass `includeClosed=true` to surface
 * closed issues. Cursor-paginated.
 */
export interface ListMineParams {
  cursor?: string | null;
  limit?: number;
  includeClosed?: boolean;
  /**
   * Phase 2 ui-redesign — B5b. When true, restricts the result to issues
   * whose assignee hasn't accepted yet (`accepted_at IS NULL`). Drives the
   * Inbox surface in the new shell. Maps to query param `acceptedAt=null`.
   */
  acceptedAtNull?: boolean;
  /**
   * sk-30. When true, restricts to `accepted_at IS NOT NULL` — the
   * "On me" lens prefix (caller has acknowledged the task and is
   * actively working). Maps to query param `acceptedAt=not-null`.
   */
  acceptedAtNotNull?: boolean;
  /**
   * sk-30. `'not-me'` adds `createdBy=not-me` to carve out the "On me"
   * lens on `/me/assigned-to` (the caller is assignee but did NOT
   * create the issue). Server rejects any other value on /me/* paths.
   */
  createdBy?: 'not-me';
  /**
   * Phase 2 ui-redesign — B5b. Single-status filter; maps to query param
   * `status=<value>`. Server actually supports comma-separated multi-select,
   * but the Inbox + Outbox views only ever filter by one status at a time.
   * When set, takes precedence over `includeClosed` server-side.
   */
  status?: IssueStatus;
  /**
   * Phase 2 ui-redesign — B5b. Source-group filter. `'all'` is the wire
   * default and is encoded as the absence of the param. The UI uses
   * `human-driven` / `agent-autonomous` for the two-button source toggle in
   * the Tasks column header (F4); the Inbox surface (F3) always passes
   * undefined.
   */
  origin?: 'human-driven' | 'agent-autonomous' | 'all';
  /**
   * sk-31. Derived blocked-ness filter; same semantics as the project-
   * scoped path. Maps to `?isBlocked=true|false` on the wire.
   */
  isBlocked?: boolean;
  /**
   * sk-303.14 (T025, contract C3) — the unreviewed selection on the
   * CROSS-PROJECT half of the Delegated surface (`/me/created-by`). Same
   * parameter, same set, same single server-side definition as the
   * project-scoped path: both halves must narrow identically, or picking a
   * project would silently turn a server-side selection into no selection
   * at all.
   *
   * One difference belongs to this path and is the server's to apply: the
   * `/me/*` endpoints exclude closed rows when no status is named, and the
   * selection LIFTS that default (the set is closed results). So callers
   * do NOT have to pair it with `includeClosed`.
   */
  unreviewed?: boolean;
  /**
   * sk-674.18 (T032) — only that space (short id). Contract of
   * `/me/assigned-to` and `/me/created-by`; `/me/assigned-by` does not list
   * it, so leave it unset there.
   */
  space?: string | null;
}

function buildMineQuery(params: ListMineParams): string {
  const sp = new URLSearchParams();
  if (params.cursor) sp.set('cursor', params.cursor);
  if (params.limit) sp.set('limit', String(params.limit));
  if (params.includeClosed) sp.set('includeClosed', 'true');
  if (params.acceptedAtNull) sp.set('acceptedAt', 'null');
  if (params.acceptedAtNotNull) sp.set('acceptedAt', 'not-null');
  if (params.createdBy) sp.set('createdBy', params.createdBy);
  if (params.status) sp.set('status', params.status);
  if (params.origin && params.origin !== 'all') sp.set('origin', params.origin);
  if (params.isBlocked !== undefined) sp.set('isBlocked', String(params.isBlocked));
  // sk-303.14 — literal "true" only; absence is the "no selection" value.
  if (params.unreviewed) sp.set('unreviewed', 'true');
  if (params.space) sp.set('space', params.space);
  const qs = sp.toString();
  return qs ? `?${qs}` : '';
}

export async function listAssignedByMe(
  params: ListMineParams = {},
): Promise<ListIssuesResult> {
  return apiJson<ListIssuesResult>(`/api/v1/me/assigned-by${buildMineQuery(params)}`);
}

export async function listAssignedToMe(
  params: ListMineParams = {},
): Promise<ListIssuesResult> {
  return apiJson<ListIssuesResult>(`/api/v1/me/assigned-to${buildMineQuery(params)}`);
}

/**
 * Phase 2 ui-redesign — F4. Cross-project Outbox surface ("tasks I
 * originated"). Same scope predicate as `/me/assigned-by`
 * (`i.created_by = caller`); coexists for the distinct UI surface name
 * — the F4 Tasks column reaches for this when the user has no project
 * selected AND the outbox-mode toggle is ON.
 *
 * Note: the `/me/created-by` endpoint does NOT accept `text` (search)
 * or `sort` query params — both are only meaningful on the project-
 * scoped path. Search + sort for the cross-project Outbox surface are
 * realised client-side in useTasks.ts.
 */
export async function listCreatedByMe(
  params: ListMineParams = {},
): Promise<ListIssuesResult> {
  return apiJson<ListIssuesResult>(`/api/v1/me/created-by${buildMineQuery(params)}`);
}

/**
 * Sc3 — cross-project list ("All projects" Tasks column). Visibility-
 * filtered to the caller's project_members horizon (admins see all).
 * Supports server-side FTS (`q`), single status / type filter, origin
 * grouping, assignee/createdBy/acceptedAt, cursor pagination, and an
 * absolute `total` count on every page so the column can show a real
 * counter without exhausting the cursor.
 */
export interface ListAllIssuesParams {
  /**
   * Search box — server-side FTS over title + description +
   * acceptance + design + notes. Exact issue id matches
   * (`prefix-N[.N…]`) get an exact-id boost.
   */
  q?: string;
  status?: IssueStatus;
  type?: IssueType;
  /**
   * `'all'` is the wire default (encoded as the absence of the param);
   * we keep the literal here so the UI has one source of truth.
   */
  origin?: OriginFilter;
  /** `'me'` resolves to the caller; any other value is a free-form username. */
  assignee?: 'me' | string;
  /**
   * `'me'` restricts to caller-created issues (cross-project Outbox).
   * `'not-me'` restricts to issues the caller did NOT create — paired
   * with `assignee=me` for the "On me" cross-project lens (sk-30).
   */
  createdBy?: 'me' | 'not-me';
  /** When true, restricts to `accepted_at IS NULL` (Inbox-style). */
  acceptedAtNull?: boolean;
  /**
   * sk-30. When true, restricts to `accepted_at IS NOT NULL` — the
   * "On me" lens prefix.
   */
  acceptedAtNotNull?: boolean;
  cursor?: string | null;
  /** 1..100, default 50 server-side. */
  limit?: number;
  /** Wire sort axis. Default `'updated'`. */
  sortBy?: 'updated' | 'created';
  /**
   * sk-31. Derived blocked-ness filter; same semantics as the project-
   * scoped path. Maps to `?isBlocked=true|false` on the wire.
   */
  isBlocked?: boolean;
  /**
   * sk-674.18 (T032) — only that space (short id); the `myOutbox*`
   * counters follow the same narrowing.
   */
  space?: string | null;
}

function buildAllIssuesQuery(params: ListAllIssuesParams): string {
  const sp = new URLSearchParams();
  if (params.q) sp.set('q', params.q);
  if (params.status) sp.set('status', params.status);
  if (params.type) sp.set('type', params.type);
  if (params.origin && params.origin !== 'all') sp.set('origin', params.origin);
  if (params.assignee) sp.set('assignee', params.assignee);
  if (params.createdBy) sp.set('createdBy', params.createdBy);
  if (params.acceptedAtNull) sp.set('acceptedAt', 'null');
  if (params.acceptedAtNotNull) sp.set('acceptedAt', 'not-null');
  if (params.cursor) sp.set('cursor', params.cursor);
  if (params.limit !== undefined) sp.set('limit', String(params.limit));
  if (params.sortBy) sp.set('sortBy', params.sortBy);
  if (params.isBlocked !== undefined) sp.set('isBlocked', String(params.isBlocked));
  if (params.space) sp.set('space', params.space);
  const qs = sp.toString();
  return qs ? `?${qs}` : '';
}

/**
 * sk-421.1 T016 — options of a READ that can be cancelled. `signal` is the
 * AbortSignal TanStack hands to a `queryFn`; passed down to `fetch`, a
 * cancelled read (a newer invalidation, the last observer leaving) really
 * stops on the wire instead of running to completion in the background.
 */
export interface ReadOptions {
  signal?: AbortSignal;
}

export async function listAllIssues(
  params: ListAllIssuesParams = {},
  opts: ReadOptions = {},
): Promise<ListAllIssuesResult> {
  return apiJson<ListAllIssuesResult>(`/api/v1/issues${buildAllIssuesQuery(params)}`, {
    signal: opts.signal,
  });
}

// ───────────────────────── CRUD ─────────────────────────

/**
 * Read one issue in a known project. `opts.signal` (T016) reaches the
 * `fetch`, so cancelling the read aborts the request itself.
 */
export async function getIssue(
  projectId: string,
  id: string,
  opts: ReadOptions = {},
): Promise<IssueDetail> {
  return apiJson<IssueDetail>(`${base(projectId)}/issues/${encodeURIComponent(id)}`, {
    signal: opts.signal,
  });
}

/**
 * Read an issue knowing only its id, without knowing which project it
 * lives in. Two hops, both on endpoints that already exist:
 *
 *   1. `GET /api/v1/issues?q={id}` — the cross-project list. It is
 *      visibility-filtered server-side and gives exact issue ids an
 *      exact-match boost, and every row carries its `projectId`.
 *   2. `GET /api/v1/projects/{projectId}/issues/{id}` — the normal
 *      scoped read, now that we know the project.
 *
 * Why not one hop: there is no `GET /api/v1/issues/{id}` route on the
 * server — that path prefix only serves sub-resources (`/watchers`,
 * `/attachments`, `/accept`, …), so a bare GET falls through to chi's
 * plain-text 404. Resolving the project here keeps the fix entirely in
 * the frontend.
 *
 * What this replaces: deriving the project by parsing the id as
 * `{prefix}-{n}` and matching the prefix against a project's idPrefix.
 * That guess silently fails for hash / custom id modes (e.g.
 * `fv-other-1fe1d873`) and for any issue whose id prefix no longer
 * matches its project — and the failure mode was that NO request went
 * out at all, leaving the panel on "failed to load" forever.
 *
 * The match is by strict id equality, not "first row": the boost makes
 * the exact hit come first, but a substring match must never be opened
 * in place of the id the caller asked for. An id nobody can see and an
 * id that does not exist both surface as 404 — the list simply returns
 * no matching row, so this cannot be used to probe ids either.
 */
export async function getIssueByID(id: string, opts: ReadOptions = {}): Promise<IssueDetail> {
  // T016 — the signal reaches BOTH hops. A cancel that lands between them
  // must not let the second request go out: check it before hop 2 (a
  // fetch handed an already-aborted signal would reject too, but the
  // explicit check keeps the second request from even being built).
  const row = await findIssueSummaryById(id, opts);
  if (!row) {
    throw new ApiError(404, `issue ${id} not found`, 'issue_not_found');
  }
  opts.signal?.throwIfAborted();
  return getIssue(row.projectId, id, opts);
}

/**
 * Hop 1 of `getIssueByID`, exposed on its own: resolve an id to its
 * summary row without knowing the project, and WITHOUT the second
 * scoped read.
 *
 * Callers that only need the list-shaped fields — id, projectId,
 * `parentIdCurrent`, title, status … — get them in one request instead
 * of two. That is the whole ancestor-backfill path (`useTreeAncestors`):
 * it climbs `parentIdCurrent` and feeds `IssueSummary` rows straight
 * into `buildIssueTree`, so pulling the full `IssueDetail` for every
 * ancestor would double the round-trips for prose nobody renders.
 *
 * Returns `null` instead of throwing when nothing matches: for the
 * caller "id not visible to me" is an ordinary outcome to route around
 * (leave the child where it is), not a failure to report. `getIssueByID`
 * keeps its 404 contract by raising on the null itself.
 *
 * Match is strict id equality for the same reason as `getIssueByID`:
 * the exact-id boost puts the wanted row first, but a substring hit
 * must never be substituted for the id that was asked for.
 */
export async function findIssueSummaryById(
  id: string,
  opts: ReadOptions = {},
): Promise<IssueSummary | null> {
  const found = await listAllIssues({ q: id, limit: 20 }, opts);
  return found.items.find((i) => i.id === id) ?? null;
}

export async function createIssue(
  projectId: string,
  input: CreateIssueInput,
): Promise<IssueDetail> {
  return apiJson<IssueDetail>(`${base(projectId)}/issues`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function patchIssue(
  projectId: string,
  id: string,
  version: number,
  patch: PatchIssueInput,
): Promise<IssueDetail> {
  return apiJson<IssueDetail>(`${base(projectId)}/issues/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: ifMatchHeaders(version),
    body: JSON.stringify(patch),
  });
}

// ─────────── sk-303.14 — review workflow (contract C1) ───────────

/**
 * Turn the author's «needs review» flag on or off (US-3, INV-4).
 *
 * A PATCH carrying the flag AND NOTHING ELSE. The server routes such a body
 * out of the ordinary update path entirely: the flag changes without moving
 * the issue's version, without stamping `updatedAt` and without any fan-out,
 * so the assignee cannot observe that anything happened (INV-2). A body that
 * mixes the flag with any ordinary field is refused with 400 by the form
 * check — which is why this function builds the body itself instead of
 * accepting a caller-assembled patch.
 *
 * The current version still travels in `If-Match`, exactly as an ordinary
 * edit: the server VERIFIES it (a stale one is refused) but does not
 * INCREMENT it. A caller that refreshes its local version from the response
 * therefore gets the same number back — that is the invariant working, not a
 * missed bump.
 *
 * Refusals (all 422): `review_forbidden` — not the author (an admin gets the
 * identical answer, INV-4); `version_conflict` — the presented version drifted.
 */
export async function setReviewRequired(
  projectId: string,
  id: string,
  version: number,
  required: boolean,
): Promise<IssueDetail> {
  return apiJson<IssueDetail>(`${base(projectId)}/issues/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: ifMatchHeaders(version),
    body: JSON.stringify({ reviewRequired: required }),
  });
}

/**
 * Mark a closed result read (US-1). Its own route, not a field of an edit:
 * the mark shares no field with an ordinary patch, and it moves neither the
 * version nor `updatedAt`.
 *
 * The version travels in the BODY here rather than in `If-Match`, matching
 * `/accept`: this is a point action taken from the card, not an edit of the
 * resource. It is verified and, as with the flag, not incremented.
 *
 * Repeating the mark is idempotent — no second event, and the first mark's
 * author and timestamp stay put.
 *
 * Refusals (all 422): `review_forbidden` — not the author;
 * `review_issue_not_closed` — nothing to read yet; `review_flag_cleared` —
 * the author already said they are not interested; `version_conflict`.
 */
export async function markReviewed(
  projectId: string,
  id: string,
  expectedVersion: number,
): Promise<IssueDetail> {
  return apiJson<IssueDetail>(
    `${base(projectId)}/issues/${encodeURIComponent(id)}/review`,
    {
      method: 'POST',
      body: JSON.stringify({ expectedVersion }),
    },
  );
}

// ───────────────────────── Status / pin ─────────────────────────

/**
 * sk-489 (US-1, US-2) — the outcome and the target of a transition to "closed".
 *
 * A separate object, not two trailing positional parameters: the optional
 * `reason` and `force` already stand before them, and a caller that
 * needs only the outcome would have to write `undefined, undefined` — a shape
 * in which neighbouring optional values sooner or later get swapped
 * silently.
 */
export interface TransitionCloseInput {
  closeOutcome?: CloseOutcome;
  closeTarget?: string;
}

export async function transitionStatus(
  projectId: string,
  id: string,
  version: number,
  status: IssueStatus,
  reason?: string,
  force?: boolean,
  close?: TransitionCloseInput,
): Promise<IssueDetail> {
  const qs = force ? '?force=true' : '';
  const body: Record<string, unknown> = { status };
  if (reason) body.reason = reason;
  // ⚠ US-10, SC-010 — "done" DOES NOT GO ON THE WIRE, and this is the only
  // place with such a rule.
  //
  // An old api rejects an unfamiliar request field AS A WHOLE, it does not ignore
  // it. So a close from the modal with a preselected "done" — the most
  // frequent path in the world — would fail on an old api, although the server result is
  // exactly the one asked for: the DEFAULT of a TRANSITION to "closed" is
  // "done" (US-1). By omitting the key we ask for the same thing in a way
  // that both versions understand.
  //
  // The rule does NOT extend to `patchIssue` and `bulkAction`: an outcome
  // edit (US-12) and an explicit batch outcome (US-11) are not a transition, they have no default,
  // and an omitted `done` there would mean "do not change".
  if (close?.closeOutcome !== undefined && close.closeOutcome !== 'done') {
    body.closeOutcome = close.closeOutcome;
  }
  if (close?.closeTarget) body.closeTarget = close.closeTarget;
  return apiJson<IssueDetail>(
    `${base(projectId)}/issues/${encodeURIComponent(id)}/transitions${qs}`,
    {
      method: 'POST',
      headers: ifMatchHeaders(version),
      body: JSON.stringify(body),
    },
  );
}

export async function pinIssue(
  projectId: string,
  id: string,
  version: number,
): Promise<IssueDetail> {
  return apiJson<IssueDetail>(
    `${base(projectId)}/issues/${encodeURIComponent(id)}/pin`,
    {
      method: 'POST',
      headers: ifMatchHeaders(version),
    },
  );
}

export async function unpinIssue(
  projectId: string,
  id: string,
  version: number,
): Promise<IssueDetail> {
  return apiJson<IssueDetail>(
    `${base(projectId)}/issues/${encodeURIComponent(id)}/unpin`,
    {
      method: 'POST',
      headers: ifMatchHeaders(version),
    },
  );
}

// ───────────────────────── Components ─────────────────────────

/**
 * PUT replaces the full set. `[]` clears all components. Bumps version
 * on the server side; the returned IssueDetail carries the new value.
 */
export async function replaceComponents(
  projectId: string,
  id: string,
  componentIds: string[],
): Promise<IssueDetail> {
  return apiJson<IssueDetail>(
    `${base(projectId)}/issues/${encodeURIComponent(id)}/components`,
    {
      method: 'PUT',
      body: JSON.stringify({ componentIds }),
    },
  );
}

// ───────────────────────── Labels ─────────────────────────

export async function addLabel(
  projectId: string,
  id: string,
  label: string,
): Promise<IssueDetail> {
  return apiJson<IssueDetail>(
    `${base(projectId)}/issues/${encodeURIComponent(id)}/labels`,
    {
      method: 'POST',
      body: JSON.stringify({ label }),
    },
  );
}

export async function removeLabel(
  projectId: string,
  id: string,
  label: string,
): Promise<IssueDetail> {
  // RemoveLabel returns the post-state. Server uses DELETE on
  // /labels/{label} — apiJson matches every other mutation helper.
  return apiJson<IssueDetail>(
    `${base(projectId)}/issues/${encodeURIComponent(id)}/labels/${encodeURIComponent(label)}`,
    { method: 'DELETE' },
  );
}

export async function listProjectLabels(projectId: string): Promise<LabelStat[]> {
  return apiJson<LabelStat[]>(`${base(projectId)}/labels`);
}

// ───────────────────────── Check duplicates ─────────────────────────

/**
 * POST /issues/check-duplicates — read-only trigram search. Used by the
 * create-issue form to suggest possible duplicates as the user types.
 * Does NOT create an issue, does NOT write events.
 */
export async function checkDuplicates(
  projectId: string,
  input: CheckDuplicatesInput,
): Promise<CheckDuplicatesResponse> {
  return apiJson<CheckDuplicatesResponse>(
    `${base(projectId)}/issues/check-duplicates`,
    {
      method: 'POST',
      body: JSON.stringify({
        title: input.title,
        ...(input.description ? { description: input.description } : {}),
      }),
    },
  );
}

// ───────────────────────── Comments ─────────────────────────

/**
 * sk-16 — `origin` is the optional `?origin=human-driven|agent-autonomous|all`
 * server-side filter on the comment list. The Humans/Agents UI chips in
 * `CommentsThread` filter client-side on the already-loaded list (no
 * second round-trip), so this param defaults to omitted — but the helper
 * exposes it for surfaces that want the filtered list directly.
 */
export type CommentOriginParam = 'human-driven' | 'agent-autonomous' | 'all';

export async function listComments(
  projectId: string,
  id: string,
  origin?: CommentOriginParam,
): Promise<CommentDTO[]> {
  const qs = origin ? `?origin=${encodeURIComponent(origin)}` : '';
  return apiJson<CommentDTO[]>(
    `${base(projectId)}/issues/${encodeURIComponent(id)}/comments${qs}`,
  );
}

/**
 * sk-16 — `kind` is required for agent (api-key) callers. The cookie path
 * (the Web UI) leaves it undefined; the backend forces `author_kind='human'`
 * on that path and silently ignores any value passed.
 */
export async function addComment(
  projectId: string,
  id: string,
  body: string,
  kind?: CommentKindParam,
): Promise<CommentDTO> {
  const payload: { body: string; kind?: CommentKindParam } = { body };
  if (kind !== undefined) payload.kind = kind;
  return apiJson<CommentDTO>(
    `${base(projectId)}/issues/${encodeURIComponent(id)}/comments`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  );
}

/**
 * sk-57 — edit a comment's body. AUTHOR-ONLY on the server: a non-author
 * gets 403. `expectedVersion` is the optimistic-concurrency token — pass
 * the `version` you last read; a concurrent edit yields a 409
 * `version_conflict` ApiError (code === 'version_conflict') so the caller
 * can refetch and retry. `kind` mirrors {@link addComment} (cookie path
 * leaves it undefined). Returns the updated comment (new version, editedAt
 * set, re-hydrated mentions).
 */
export async function updateComment(
  projectId: string,
  id: string,
  commentId: string,
  body: string,
  expectedVersion: number,
  kind?: CommentKindParam,
): Promise<CommentDTO> {
  const payload: { body: string; expectedVersion: number; kind?: CommentKindParam } = {
    body,
    expectedVersion,
  };
  if (kind !== undefined) payload.kind = kind;
  return apiJson<CommentDTO>(
    `${base(projectId)}/issues/${encodeURIComponent(id)}/comments/${encodeURIComponent(commentId)}`,
    {
      method: 'PUT',
      body: JSON.stringify(payload),
    },
  );
}

/**
 * sk-57 — soft-delete a comment. AUTHOR OR project owner/admin on the
 * server (a plain non-author member gets 403). The comment becomes a
 * tombstone (body blanked, slot retained). Optional `reason` is recorded
 * on the comment.deleted event. The server returns a small ack object; we
 * ignore the body and let the caller invalidate the comment list.
 */
export async function deleteComment(
  projectId: string,
  id: string,
  commentId: string,
  reason?: string,
): Promise<void> {
  const payload: { reason?: string } = {};
  if (reason !== undefined && reason !== '') payload.reason = reason;
  await apiJson<unknown>(
    `${base(projectId)}/issues/${encodeURIComponent(id)}/comments/${encodeURIComponent(commentId)}`,
    {
      method: 'DELETE',
      body: JSON.stringify(payload),
    },
  );
}

// ───────────────────────── Bulk actions ─────────────────────────

export type BulkAction = 'close' | 'reopen' | 'pin' | 'unpin' | 'archive';

export interface BulkRequest {
  ids: string[];
  action: BulkAction;
  /** Optional human-readable reason — required by some actions (e.g. close). */
  reason?: string;
  /** When true, override pinned-protection / similar safeguards. */
  force?: boolean;
  /**
   * sk-489 (US-11) — ONE outcome for the whole batch. Always goes on the wire,
   * including `done`: an explicit batch outcome overrides the default of each
   * position (for archiving an unclosed non-permanent task it is "will not
   * do"), and omitting it would mean asking for something else.
   *
   * For actions that do not close (`reopen` / `pin` / `unpin`),
   * the server rejects the batch as a whole before executing.
   */
  closeOutcome?: CloseOutcome;
  /** One target for the whole batch — a "duplicate" / "superseded" link (US-2). */
  closeTarget?: string;
}

/**
 * Per-id failure surface from a bulk operation. Code is machine-readable
 * (e.g. "pinned_no_force", "invalid_transition"). Message is human-friendly.
 */
export interface BulkFailure {
  id: string;
  code: string;
  message: string;
}

export interface BulkResult {
  succeeded: string[];
  failed: BulkFailure[];
}

/**
 * POST /api/v1/projects/{pid}/issues/bulk — multi-issue mutation.
 *
 * Returns 207 Multi-Status with per-id outcomes. apiFetch only treats
 * 4xx/5xx as errors; 207 falls through as a normal Response. We parse
 * the JSON body directly here.
 */
export async function bulkAction(
  projectId: string,
  request: BulkRequest,
): Promise<BulkResult> {
  const resp = await apiFetch(`${base(projectId)}/issues/bulk`, {
    method: 'POST',
    body: JSON.stringify(request),
  });
  return (await resp.json()) as BulkResult;
}

// ───────────────────────── Accept ─────────────────────────

/**
 * POST /api/v1/issues/{id}/accept — explicit assignee acknowledgement.
 *
 * Path is non-project-scoped (the issue id alone identifies the row).
 * Body carries the optimistic-concurrency token; server bumps version,
 * sets accepted_at = now() / accepted_by = caller, writes one
 * `issue.accepted` event, and fans out a notification to the creator
 * + watchers. Idempotent — a second call on an already-accepted issue
 * returns the current detail without bumping version.
 *
 * Errors (BusinessError):
 *   - 404 issue_not_found    — issue missing or not visible
 *   - 422 forbidden          — caller is not assignee and not admin
 *   - 422 version_conflict   — expectedVersion mismatch (refetch + retry)
 */
export async function acceptIssue(
  id: string,
  expectedVersion: number,
): Promise<IssueDetail> {
  return apiJson<IssueDetail>(
    `/api/v1/issues/${encodeURIComponent(id)}/accept`,
    {
      method: 'POST',
      body: JSON.stringify({ expectedVersion }),
    },
  );
}

/**
 * sk-674.18 (T034) — POST /api/v1/projects/{project}/issues/{issueID}/unlock:
 * release another holder's claim ("Remove lock"). Allowed to the project
 * owner, the space owner and the admin — the card's `canForceUnlock`. 200
 * with the issue card, as its GET. Refusal: 422 `force_unlock_forbidden`.
 */
export async function forceUnlockIssue(projectId: string, id: string): Promise<IssueDetail> {
  return apiJson<IssueDetail>(`${base(projectId)}/issues/${encodeURIComponent(id)}/unlock`, {
    method: 'POST',
  });
}

// ───────────────────────── Delegated chain (sk-34) ─────────────────────────

/**
 * POST /api/v1/issues/{id}/dismiss — caller opts out of the issue's
 * Delegated lens. Backend appends the caller's user uuid to
 * `dismissed_by` and installs a sticky-unwatch row on issue_watchers
 * (bell silenced). Idempotent — re-call on an already-dismissed issue
 * is a silent no-op.
 *
 * Use when the caller delegated this task further and doesn't want to
 * track it anymore. To resume, call `undismissIssue` — that clears the
 * opt-out but does NOT re-arm bell notifications (separate user intent
 * via `watchIssue`).
 */
export async function dismissIssue(id: string): Promise<IssueDetail> {
  return apiJson<IssueDetail>(
    `/api/v1/issues/${encodeURIComponent(id)}/dismiss`,
    { method: 'POST' },
  );
}

/**
 * POST /api/v1/issues/{id}/undismiss — symmetric inverse of `dismissIssue`.
 * Removes the caller from `dismissed_by`. Does NOT re-add a watcher row;
 * the sticky-unwatch installed by dismiss persists until the user
 * explicitly calls `watchIssue`.
 *
 * Idempotent — caller not in `dismissed_by` → silent no-op.
 */
export async function undismissIssue(id: string): Promise<IssueDetail> {
  return apiJson<IssueDetail>(
    `/api/v1/issues/${encodeURIComponent(id)}/undismiss`,
    { method: 'POST' },
  );
}

// ───────────────────────── Helpers ─────────────────────────

/**
 * Allowed transitions per current status. We mirror this server-side rule
 * in the UI so disabled buttons reflect real behaviour rather than getting
 * a 422 when the user clicks. The server is still the source of truth.
 *
 * sk-31: 'blocked' was dropped from the writable status set. To mark an
 * issue as blocked the caller adds a typed-deps edge (blocks /
 * waits-for) — the derived `isBlocked` flag on `IssueSummary` /
 * `IssueDetail` picks it up automatically. No status transition is
 * needed.
 */
export function allowedTransitions(s: IssueStatus): IssueStatus[] {
  switch (s) {
    case 'open':
      // sk-118 (F2c): `open → standing` promotes a task to a perpetual
      // obligation. A clean (un-claimed) open task can be promoted
      // directly; the menu offers it alongside the normal transitions.
      return ['in_progress', 'deferred', 'standing', 'closed'];
    case 'in_progress':
      // sk-118: `in_progress → standing` is NOT offered. A locked /
      // in-progress task must be unclaimed (→ open) before it can be
      // promoted to standing — the backend rejects the direct edge with
      // `cannot_promote_locked_to_standing`.
      return ['open', 'deferred', 'closed'];
    case 'deferred':
      // sk-118 (F2c): `deferred → standing` promotes a punted task.
      return ['in_progress', 'standing', 'closed'];
    case 'standing':
      // sk-118 (F2c) — the CORRECTED matrix: the ONLY demote edge out of
      // standing is `standing → open`. `standing → in_progress` and
      // `standing → deferred` are rejected by the backend
      // (`cannot_work_standing_directly` / `cannot_defer_standing`):
      // act on a standing task via spawned `parent.N` children, never by
      // working/deferring it in place. Retiring (closing) goes through
      // the retire dialog, not this transition list (it needs a reason +
      // surfaces the open-children guard), so `closed` is intentionally
      // ABSENT here.
      return ['open'];
    case 'closed':
      // sk-118 (decision #5): `closed → standing` reopen is allowed — a
      // low-priority escape hatch to un-retire a perpetual obligation
      // straight back into the standing band.
      return ['open', 'standing'];
    default: {
      // Compile-time exhaustiveness: a new IssueStatus without a case
      // fails tsc. Runtime still returns [] for any unexpected value.
      const _exhaustive: never = s;
      void _exhaustive;
      return [];
    }
  }
}

// ───────────────────────── Tree (sk-36) ─────────────────────────

/**
 * sk-36 — one row in the flat layered-tree response. Mirrors the Go DTO
 * `internal/issues/tree.go::IssueTreeNode`. The wire is a flat pre-order
 * DFS list; `parentRef` (null for roots) carries both the parent id and
 * the typed-deps edge that connected them so the renderer can colour the
 * connector per edge type.
 *
 * Reference rows (cycle / duplicate / cross-project-hidden stubs) carry
 * `isReference=true`. `firstSeenAt` points at the parent id of the FIRST
 * occurrence so the UI can offer a "↻ jump back" affordance. For hidden
 * cross-project parents the backend emits `item.title = "<hidden>"` plus
 * `isReference=true` and a null `firstSeenAt`.
 */
/**
 * sk-421.2 — the item of a TREE ROW, which is not quite an IssueSummary.
 *
 * A row standing for a task in a project the caller cannot see carries
 * EMPTY `status` and `type` on the wire (INV-2: the status of an
 * invisible task is card content and must not travel; the keys stay so
 * older clients keep parsing). So the tree row's item admits `''` where
 * a normal summary cannot.
 *
 * RECORDED DEVIATION from F-4, which asked for the shared `IssueStatus`
 * / `IssueType` unions to admit the empty value. Widening those would
 * force an `''` branch into machinery where such a value can never
 * legitimately appear: `allowedTransitions` carries a compile-time
 * exhaustiveness guard, `Record<IssueStatus, …>` maps in the card header
 * demand an icon and a CSS class per status, and the kanban axis demands
 * a column. F-4's substance — that no render or sort branch of the Tasks
 * column breaks on empty values — is satisfied by widening the ROW type
 * instead, which is what this alias does.
 *
 * Narrowing back to the closed unions happens at the one place that
 * needs it: the stub branch is already detected via `isHiddenStub`
 * before a status/type chip is ever rendered.
 */
export type IssueTreeRowItem = Omit<IssueSummary, 'status' | 'type'> & {
  status: IssueStatus | '';
  type: IssueType | '';
};

export interface IssueTreeNode {
  item: IssueTreeRowItem;
  depth: number;
  parentRef?: TreeParentRef | null;
  isReference: boolean;
  firstSeenAt?: string | null;
  /**
   * sk-421.2.8 (US-4) — the blockers of this node's task, one entry per
   * blocking edge (`blocks` and `waits-for` to the same task are two
   * entries). Sent only when the request asked for it
   * (`FetchIssueTreeArgs.includeBlockers`), and then only on a visible
   * canonical node whose server-side `item.isBlocked` is true in the same
   * response — regardless of the node's own status. Absent (not `[]`) on
   * stubs, on reference rows, on nodes that are not blocked, and in every
   * response of a server that predates the parameter.
   *
   * Order is the server's. sk-423: every entry is a blocker the reader can
   * see; an api older than sk-423 also sent redacted entries after the
   * visible ones (see `TreeBlockerRefRedacted`).
   */
  blockers?: TreeBlockerRef[];
  /**
   * sk-423 — `IssueDetail.unavailableBlockingLinks` of this node's task:
   * edges `blocks` / `waits-for` to issues outside the reader's horizon,
   * whatever their status. Sent only with `includeBlockers`, only on a
   * canonical visible row, and only when > 0 — absent otherwise, and
   * absent in every response of an api older than sk-423. Absent reads
   * as 0.
   */
  unavailableBlockingLinks?: number;
}

/**
 * sk-421.2.8 (US-4, R-1) — a visible blocker entry of a tree node. Mirrors
 * the visible wire form of `tree.go::TreeBlockerRef`:
 * `{id, title, status, projectId}`, `redacted` absent.
 */
export interface TreeBlockerRefVisible {
  id: string;
  title: string;
  status: IssueStatus;
  /** The blocker's own project — its card opens there. */
  projectId: string;
  redacted?: never;
}

/**
 * sk-421.2.8 (US-4) — a redacted blocker entry: the blocker lives in a
 * project outside the reader's horizon. LEGACY: only an api older than
 * sk-423 sends it (that api also counted it in `item.isBlocked`); the
 * current api counts such edges in `IssueTreeNode.unavailableBlockingLinks`
 * instead and never sends this form. `title`, `status` and `projectId`
 * are ABSENT, not empty. `id` is present for an internal reader and absent
 * for an external collaborator or a request without a reader.
 */
export interface TreeBlockerRefRedacted {
  redacted: true;
  id?: string;
  title?: never;
  status?: never;
  projectId?: never;
}

/**
 * sk-421.2.8 (US-4) — one entry of `IssueTreeNode.blockers`. A type of its
 * own, mirroring `tree.go::TreeBlockerRef`: the detail's `BlockerRef` is
 * deliberately not reused. Narrow with `entry.redacted === true`.
 */
export type TreeBlockerRef = TreeBlockerRefVisible | TreeBlockerRefRedacted;

/**
 * sk-36 — slim ref to the parent row plus the typed-deps edge that
 * connected this row to it. Mirrors `tree.go::TreeParentRef`.
 */
export interface TreeParentRef {
  id: string;
  edgeType: DepType;
}

/**
 * sk-36 — wire wrapper for the `/issues/tree` family. Always non-null
 * `items` (`[]` rather than `null`) per the Go-side contract.
 */
export interface IssueTreeResponse {
  items: IssueTreeNode[];
}

/**
 * Arguments accepted by `fetchIssueTree`. When `projectId` is undefined,
 * the helper hits the cross-project endpoint (`GET /api/v1/issues/tree`);
 * otherwise it scopes to the project (`GET /api/v1/projects/{pid}/issues/tree`).
 *
 * `types` is the user-toggled lens set — backend defaults to
 * `['parent-child']` if omitted, but the helper always serialises
 * whatever the caller passes so the wire is explicit. `rootId` anchors
 * the walk at a single issue id; omit to walk the forest of all
 * root-less (= no outgoing parent-child) issues.
 */
export interface FetchIssueTreeArgs {
  projectId?: string;
  rootId?: string | null;
  types: DepType[];
  /**
   * sk-421.2 (US-3). Optional depth cap, counted from the seed row
   * (depth 0), so `1` yields the roots plus their direct children. The
   * server applies it as a condition of the recursive step, not as a
   * filter over a finished walk, which is what lets the epic card's
   * "List" mode avoid paying for a full descent on a large epic.
   *
   * Omit it entirely against an API that predates the parameter: an
   * unknown query parameter is ignored there, so the response is simply
   * the full walk and the caller trims client-side (INV-8).
   */
  maxDepth?: number;
  /**
   * sk-421.2.8 (US-4, D-2). Ask the server to attach `blockers` to the
   * nodes (see `IssueTreeNode.blockers`). Serialised as
   * `includeBlockers=true` ONLY when true; `false` and omitted produce the
   * same URL as a request without the flag, so a surface that does not
   * show blockers (the Tasks column) never pays for assembling them.
   *
   * An API that predates the parameter ignores it: the response then
   * simply has no `blockers` field, and callers render as before.
   */
  includeBlockers?: boolean;
  signal?: AbortSignal;
}

/**
 * GET `/issues/tree` (project-scoped or cross-project depending on
 * `projectId`). Repeats `types[]=...` for each type the caller passes —
 * the backend accepts both `types[]=...` (PHP convention) and
 * `types=...`; we use the bracketed form to match the doc string in
 * `handler/issues.go::parseTreeTypes`.
 *
 * Errors:
 *   - 400 `invalid_dep_type`   — caller passed an unknown type
 *   - 400 `invalid_max_depth`  — maxDepth is not a whole number, is
 *                                below 1, or exceeds the server ceiling
 *   - 400 `invalid_include_blockers` — includeBlockers is not a valid
 *                                boolean (cannot happen from this helper,
 *                                which only ever sends `true`)
 *   - 422 `tree_too_large`     — walk exceeded the server cap (1000
 *                                nodes); extra carries `{limit: 1000}`.
 */
export async function fetchIssueTree(
  args: FetchIssueTreeArgs,
): Promise<IssueTreeResponse> {
  const sp = new URLSearchParams();
  for (const t of args.types) sp.append('types[]', t);
  if (args.rootId) sp.set('rootId', args.rootId);
  if (args.maxDepth !== undefined) sp.set('maxDepth', String(args.maxDepth));
  if (args.includeBlockers === true) sp.set('includeBlockers', 'true');
  const qs = sp.toString();
  const path =
    (args.projectId
      ? `/api/v1/projects/${encodeURIComponent(args.projectId)}/issues/tree`
      : `/api/v1/issues/tree`) + (qs ? `?${qs}` : '');
  return apiJson<IssueTreeResponse>(path, { signal: args.signal });
}
