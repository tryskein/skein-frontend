/**
 * Live event reaction of a VISIBLE tab — the rows of the reaction matrix
 * owned by T042 (spec sk-622.21 US-13 "A tab updates only
 * what is affected", §"Frontend reaction matrix"; plan K18 "Reaction matrix →
 * cache keys", the normative table this module follows row by row).
 *
 * Given one compact envelope ({@link EventEnvelope}, phase 1, US-12) and
 * its {@link ClassifiedEvent}, re-read only the cache keys the event can
 * change — instead of the former «reset everything of the project».
 *
 * ─── What changed against the former router, and why ─────────────
 *
 *  - Header counters (`['notification-counts']`), Watching, Mentions and
 *    the old `['notifications', 'count' | 'list', …]` keys are NOT touched
 *    by project events any more: personal screens are refreshed by the
 *    personal signal (`livePersonalSignal.ts`, US-11) — an event of the
 *    project says nothing about the receiver's own counters.
 *  - Keys no screen reads are not reset at all (K18 row "No longer
 *    reset"): `['ready', …]`, `['issues','project-labels', …]`,
 *    `['projects','members', …]`, `['projects','components', …]`,
 *    `['projects','detail', …]`, `['notifications','count'|'list', …]`,
 *    `['issues','list', …]`.
 *  - Field edits are routed by `changedFields` of the parent
 *    `issue.updated` (the browser never receives `*.field_changed`).
 *  - Dependency ends come from the envelope's `dep` only (R8 / K15: an end
 *    in another project is absent and is not guessed).
 *
 * ─── Conventions ───────────────────────────────────────────────────
 *
 *  - Every reset goes through `qc`, which in the app is the coalescing
 *    batcher (`liveInvalidationBatcher.ts`, window 1.5 s, sk-622.1): resets
 *    pile up and are applied as one wave without cancelling reads in
 *    flight. Router tests pass a real `QueryClient` and see each call.
 *  - Default `refetchType` is `'active'`: a matched key is marked stale and
 *    only a mounted reader re-reads; an unmounted one reads fresh on mount.
 *    «If the card is open» / «if the column is visible» in the matrix is
 *    exactly that rule — no extra bookkeeping of what is on screen.
 *  - «First page» (K21) is the `firstPageOnly` flag of the batcher.
 *  - Predicates that look into cached data (which rows a list shows, which
 *    open card links to an issue) are evaluated by the batcher at wave
 *    time; see its header for that bound.
 *  - Hidden tab, focus / visibility, reconnect / resync, the 60 s safety
 *    net, the reminder frame and keeping accepted Inbox cards are NOT here
 *    (owners in K18: T043, T044, T045, T048, T046).
 *  - Phase 2 (T049, US-15): an issue event carrying its neutral `row` has
 *    the row laid onto the lists, trees, backfills and — when only fields
 *    of the row changed — the open card (`liveRowPatch.ts`). Its own rows
 *    are then NOT re-read here, fresh row or stale: a fresh row has been
 *    laid in (or its list re-read from the first page), a stale one changes
 *    nothing and sends no request on its own account. Every OTHER reaction
 *    of the event's matrix row stays — the card on a non-row change, rows
 *    it may block or unblock, the ancestors' progress, activity, the info on
 *    open cards linking to it, lists whose filter a row cannot answer. An
 *    envelope without a row (a phase-1 server) is handled as before.
 */

import type { Query, QueryCache } from '@tanstack/react-query';
import type { ClassifiedEvent } from './eventClassify';
import { markEpicSectionEvent } from './epicSectionClock';
import { markTasksColumnTreeEvent } from './tasksColumnTreeClock';
import { projectComponentNamesKey } from './useProjectComponentNames';
import { projectsListQueryKey } from './projectHandleCache';
import type { EventEnvelope } from './eventEnvelope';
import type { LiveInvalidationTarget } from './liveInvalidationBatcher';
import { applyEventRow, type EventRowOutcome } from './liveRowPatch';

/** Caller context — who is the receiving user, what the tab shows. */
export interface InvalidationContext {
  /** User has the admin role (drives users-admin list invalidations). */
  isAdmin: boolean;
  /** UUID of the receiving user (drives /me refresh on self-targeted events). */
  currentUserId: string;
  /**
   * Projects whose rows are expanded in the projects column (the
   * `'expanded'` source of the declaration, T041). A project's counters
   * (projects list, its components) are re-read on issue events only while
   * its row is expanded — a folded row is registry class 3 and refreshes on
   * focus / visibility / navigation (R1′). Absent = none expanded.
   */
  expandedProjectIds?: ReadonlySet<string>;
}

/**
 * Event types that change the "in progress" block of `/activity`
 * (K18 row "Dashboard `/activity`": claim / unclaim / status / accept /
 * close). The block reads `['dashboard', 'in-progress', projectId]`.
 */
export const DASHBOARD_IN_PROGRESS_EVENT_TYPES: ReadonlySet<string> = new Set([
  'issue.claimed',
  'issue.unclaimed',
  'issue.status_changed',
  'issue.accepted',
  'issue.closed',
]);

/**
 * Apply the cache reaction to one classified event. Returns void; all side
 * effects are cache resets. Safe to call synchronously from the SignalR
 * `on('event', …)` callback.
 *
 * The self-deactivation logout (K18 row "User events") is not a
 * cache reaction and is driven by the provider (`useLiveEvents.tsx`), see
 * {@link isSelfDeactivation}.
 */
export function invalidateForEvent(
  qc: LiveInvalidationTarget,
  event: ClassifiedEvent,
  envelope: EventEnvelope,
  ctx: InvalidationContext,
): void {
  if (event.namespace === 'malformed') return;

  if (event.namespace === 'user') {
    invalidateUserScoped(qc, event, ctx);
    return;
  }

  if (event.namespace !== 'project' || !event.projectId) return;
  const pid = event.projectId;

  // K18 "Dashboard `/activity`": the "in progress" block, by event type. The
  // ticker itself is fed from the envelope without a request (T040).
  if (DASHBOARD_IN_PROGRESS_EVENT_TYPES.has(envelope.eventType)) {
    qc.invalidateQueries({ queryKey: ['dashboard', 'in-progress'] });
  }

  // sk-622.21 T048 (K18 "Reminder frame") — a project `reminder.*`
  // envelope gets no reaction. A reminder is personal: its owner's tabs
  // re-read the list and ring off the personal `reminder` frame
  // (`useLiveEvents.tsx`, K14), and skein-web no longer projects these
  // events to browsers. Should one arrive anyway, it must not re-read
  // anything — not the list, and not the issue keys below.
  if (envelope.eventType.startsWith('reminder.')) return;

  // `issue.mention` / `comment.mention` are notifications about a write, not
  // changes: the write itself travels as its own event (`comment.created`,
  // `issue.updated`), and the receiver's Mentions follow the personal signal
  // `mentions` (K18 "Notification — nothing beyond the personal signal").
  if (event.action === 'mention') return;

  const trees = new TreeResets();
  switch (event.entityType) {
    case 'issue':
      invalidateIssueEvent(qc, trees, event, envelope, pid, ctx);
      break;
    case 'comment':
      invalidateCommentEvent(qc, envelope, pid);
      break;
    case 'attachment':
      invalidateAttachmentEvent(qc, envelope, pid);
      break;
    case 'project':
      invalidateProjectEvent(qc, pid);
      break;
    case 'component':
      invalidateComponentEvent(qc, pid, ctx);
      break;
    case 'dep':
    case 'dependency':
      invalidateDepEvent(qc, trees, envelope, pid, ctx);
      break;
    default:
      break;
  }
  trees.apply(qc);
}

/**
 * Is this envelope `user.deactivated` about the receiving user? K18: the
 * visible tab then ends the session at once (`useAuth().logout()`); the
 * re-read of `/me` is NOT the mechanism (`AuthController#Me` reads the
 * cookie, which a deactivation does not remove).
 */
export function isSelfDeactivation(
  event: ClassifiedEvent,
  currentUserId: string | null,
): boolean {
  return (
    event.namespace === 'user'
    && event.action === 'deactivated'
    && currentUserId !== null
    && event.userId === currentUserId
  );
}

// ─────────────────────────── issue events ────────────────────────────

/**
 * Field-name groups of `issue.updated` (`changedFields`, names from
 * skein-api `issues/fields.go#IssuePatchFields`), one per matrix row.
 * Every other name — `title`, `priority`, `type`, and any name this
 * router does not know — is a field of the ROW (it may be shown on it):
 * the row group is the default, not a list.
 */
const ASSIGNMENT_FIELDS: ReadonlySet<string> = new Set([
  'assignee',
  'dueAt',
  'estimatedMinutes',
  'deferUntil',
]);
const TEXT_FIELDS: ReadonlySet<string> = new Set([
  'description',
  'design',
  'acceptanceCriteria',
  'notes',
  'externalRef',
]);

/**
 * Actions of the matrix row "Status / closing / reopening / outcome /
 * claim / unclaim / accept". `archived` and `teleported` move the same
 * aggregates (counters, membership of filtered lists) and ride the row.
 */
const STATUS_ACTIONS: ReadonlySet<string> = new Set([
  'status_changed',
  'closed',
  'reopened',
  'outcome_changed',
  'claimed',
  'unclaimed',
  'accepted',
  'archived',
  'teleported',
]);

/**
 * Actions of that row that can make the issue gate as a blocker again
 * (skein-api `status.GatesReadiness`: neither closed nor standing): a
 * status change and a reopen. Closing, archiving and an outcome end or keep
 * it not gating — the rows it blocked carry `isBlocked` and are found by
 * it; claim, unclaim and accept leave an open issue gating.
 */
const GATING_AGAIN_ACTIONS: ReadonlySet<string> = new Set(['status_changed', 'reopened']);

function invalidateIssueEvent(
  qc: LiveInvalidationTarget,
  trees: TreeResets,
  event: ClassifiedEvent,
  envelope: EventEnvelope,
  pid: string,
  ctx: InvalidationContext,
): void {
  const id = event.entityId;
  const action = event.action;

  // Phase 2 (T049): lay the event's row in first. A created issue and a
  // re-parent keep their phase-1 reaction (their lists and trees are re-read
  // from the first page / whole anyway); their row only moves the freshness.
  const layOnSurfaces = action !== 'created' && action !== 'reparented';
  const row = applyEventRow(qc, envelope, action, event.changedFields, ctx.currentUserId, { layOnSurfaces });

  if (action === 'created') {
    issueCreated(qc, trees, id, pid, ctx);
    return;
  }
  if (STATUS_ACTIONS.has(action)) {
    issueStatusChanged(qc, trees, id, pid, ctx, row, GATING_AGAIN_ACTIONS.has(action) && row?.gates === true);
    return;
  }
  if (action === 'reparented') {
    issueReparented(qc, trees, id, pid, envelope);
    return;
  }
  if (action === 'commits_attached' || action === 'commits_detached') {
    // K18 "Commits": the card's commits live on the detail; the `/activity`
    // race reads `commitHashes` from the envelope (T040).
    qc.invalidateQueries({ queryKey: ['issues', 'detail', id] });
    if (row !== null) treesOfRow(trees, id, row);
    return;
  }
  if (action === 'delegation_dropped' || action === 'delegation_resumed') {
    // K18 "Delegation": the open card's watchers (dismiss installs a
    // sticky unwatch row, resume does not undo it). Lenses and counters of
    // the acting user follow the personal signal.
    qc.invalidateQueries({ queryKey: ['watchers', 'issue', id] });
    return;
  }
  if (action === 'assigned') {
    issueFieldsChanged(qc, trees, id, pid, ['assignee'], ctx, row);
    return;
  }
  if (action === 'updated') {
    issueFieldsChanged(qc, trees, id, pid, event.changedFields, ctx, row);
    return;
  }
  // K18 "Row fields" carried as own events — `label_added`,
  // `label_removed`, `pinned`, `unpinned`, `priority_changed`,
  // `components_changed` — and any issue action this router does not know:
  // re-read what a change of the row can move — its card, its rows, the
  // open cards linking to it. Narrower would risk a stale row; wider would
  // be the old fan-out.
  rowFieldsChanged(qc, trees, id, pid, row);
  if (action === 'components_changed') {
    // "with components — component counters".
    invalidateComponentLists(qc, pid);
  }
}

/** K18 "Issue created". */
function issueCreated(
  qc: LiveInvalidationTarget,
  trees: TreeResets,
  id: string,
  pid: string,
  ctx: InvalidationContext,
): void {
  // First page of the task lists that can hold a new row of this project
  // (K21): the project's own lists, "All projects" and the search surfaces of
  // this project or of all projects. Personal lenses get their membership
  // from the `tasks` signal, not from project events.
  qc.invalidateQueries({
    predicate: (q) => {
      const info = tasksListInfo(q.queryKey);
      if (info === null) return false;
      if (info.kind === 'project') return info.scope === pid;
      if (info.kind === 'all') return true;
      if (info.kind === 'search') return info.scope === pid || info.scope === 'all';
      return false;
    },
    firstPageOnly: true,
  });
  // The column trees of the project (a new root of the forest, or a new
  // child of a shown row) and the epic sections of the parent (K18 "if
  // the root is the parent"): the envelope does not name the parent, but a child
  // is created with the id `<parent>.N` (skein-api `nextChildID`), and
  // the create writes no `dependency.created` for that edge. A new root
  // (no parent) is in no section.
  trees.columnTreesOf(pid, [id]);
  const parent = parentOfChildId(id);
  if (parent !== undefined) trees.sectionsOf(parent);
  // Counters of the project's expanded row.
  invalidateExpandedProjectCounters(qc, pid, ctx, false);
  // "the parent's links, if its card is open": deliberately the mounted
  // dependency lists of the whole project, not only the parent's
  // (`parentOfChildId` would name it): only an open card mounts one, so the
  // breadth costs one read at most — a known over-read, kept as it was.
  qc.invalidateQueries({
    predicate: (q) => keyStarts(q.queryKey, 'deps', pid),
  });
  // Project activity.
  qc.invalidateQueries({
    predicate: (q) => keyStarts(q.queryKey, 'activity', 'project', pid),
  });
}

/** K18 "Row fields" / "Assignee, dates, estimate" / "Text fields". */
function issueFieldsChanged(
  qc: LiveInvalidationTarget,
  trees: TreeResets,
  id: string,
  pid: string,
  changedFields: readonly string[] | undefined,
  ctx: InvalidationContext,
  row: EventRowOutcome | null,
): void {
  // An edit event without field names (an older writer): take every row.
  const fields = changedFields ?? ['title', ...ASSIGNMENT_FIELDS, ...TEXT_FIELDS];
  let rowGroup = false;
  let assignment = false;
  let text = false;
  for (const f of fields) {
    if (ASSIGNMENT_FIELDS.has(f)) assignment = true;
    else if (TEXT_FIELDS.has(f)) text = true;
    else rowGroup = true;
  }

  if (rowGroup) {
    rowFieldsChanged(qc, trees, id, pid, row);
  } else if (assignment) {
    // The card and the rows; no linked-issue info (the far side of a link
    // shows title, status, priority and type only). Phase 2: the rows took
    // the event's row instead.
    qc.invalidateQueries({ queryKey: ['issues', 'detail', id] });
    invalidateOwnRows(qc, trees, id, row);
    invalidateIssueActivity(qc, pid, id);
  } else if (text) {
    qc.invalidateQueries({ queryKey: ['issues', 'detail', id] });
    invalidateIssueActivity(qc, pid, id);
  }

  if (assignment && fields.includes('assignee')) {
    // "with an assignee — lenses of the expanded row".
    invalidateExpandedProjectCounters(qc, pid, ctx, true);
  }
  if (text) {
    // "lists with a text search": a text edit can bring the row into (or
    // out of) a search; lists without a search are not touched.
    qc.invalidateQueries({
      predicate: (q) => {
        const info = tasksListInfo(q.queryKey);
        return info !== null && info.search.length > 0;
      },
    });
  }
}

/**
 * K18 "Row fields": the card, the row in lists and trees, the info about
 * the issue on open cards that link to it, its activity.
 *
 * Phase 2: the card is not re-read when the event changes nothing but
 * fields of the row — a fresh row was laid onto it, a stale one changes
 * nothing (US-15); the rows took the row. The info on linking cards and the
 * activity stay, fresh row or not ("related info", "activity").
 */
function rowFieldsChanged(
  qc: LiveInvalidationTarget,
  trees: TreeResets,
  id: string,
  pid: string,
  row: EventRowOutcome | null = null,
): void {
  if (row === null || !row.rowOnly) {
    qc.invalidateQueries({ queryKey: ['issues', 'detail', id] });
  }
  invalidateOwnRows(qc, trees, id, row);
  invalidateOpenCardsLinkingTo(qc, [id]);
  invalidateIssueActivity(qc, pid, id);
}

/**
 * The issue's own rows in lists, backfills and trees: re-read in phase 1;
 * with a row (phase 2) they took it or stay as they are — only trees whose
 * patch a read in flight may overwrite, and trees with no answer yet, are
 * re-read ({@link treesOfRow}).
 */
function invalidateOwnRows(
  qc: LiveInvalidationTarget,
  trees: TreeResets,
  id: string,
  row: EventRowOutcome | null,
): void {
  if (row === null) {
    invalidateRowsShowing(qc, trees, [id]);
    return;
  }
  treesOfRow(trees, id, row);
}

/**
 * The tree resets phase 2 leaves to the router: trees showing the issue
 * whose patch a read in flight may overwrite, and trees with no answer yet
 * (their first read may predate the commit).
 */
function treesOfRow(trees: TreeResets, id: string, row: EventRowOutcome): void {
  if (row.treesNeedReset) trees.showing([id]);
  if (row.treesUnanswered) trees.unanswered();
}

/** K18 "Status / closing / reopening / outcome / claim / unclaim / accept". */
function issueStatusChanged(
  qc: LiveInvalidationTarget,
  trees: TreeResets,
  id: string,
  pid: string,
  ctx: InvalidationContext,
  row: EventRowOutcome | null,
  gatesAgain: boolean,
): void {
  const cache = qc.getQueryCache();
  // The issue and its ancestors as far as the cache knows them: the
  // ancestors' progress (rows, cards) moves with a child's status.
  const ancestors = cachedAncestorIds(cache, id);

  qc.invalidateQueries({ queryKey: ['issues', 'detail', id] });
  for (const a of ancestors) {
    qc.invalidateQueries({ queryKey: ['issues', 'detail', a] });
  }
  // The issue's own rows, the rows of its ancestors (progress), and the
  // loaded rows it may block (lists showing a blocked row). Phase 2: the own
  // rows took the event's row; the ancestors' progress and the blocked rows
  // are fields of the reader's horizon and are re-read as in phase 1. When
  // the issue may gate again (reopened, or a status that gates) the lists
  // showing it are re-read too: a row it now blocks may sit beside it with
  // `isBlocked` still false, and nothing on that row names it.
  const ownRows = row === null || gatesAgain;
  invalidateRowsShowing(qc, trees, ownRows ? [id, ...ancestors] : ancestors, { orBlockedRow: true });
  // The column trees of the project (a tree whose phase-2 patch a read in
  // flight may overwrite is among them); the epic sections of the ancestors —
  // the sections showing the issue (a section holds its root's whole
  // subtree), done by `invalidateRowsShowing` above, together with those
  // showing it as a blocker.
  trees.columnTreesOf(pid, [id]);
  // Open cards of any project that link to the issue (status of a linked
  // issue, the parent's children counters).
  invalidateOpenCardsLinkingTo(qc, [id]);
  // Lists filtered by blocked-ness: from the first page.
  invalidateBlockedFilterLists(qc);
  // Counters of the expanded row of the project.
  invalidateExpandedProjectCounters(qc, pid, ctx, false);
  invalidateIssueActivity(qc, pid, id);
  // Inbox is NOT re-read here (R22): it is a personal screen of class 2 —
  // the personal signal `inbox` the server sends to the assignee and the
  // author on a status change / accept, and the 60 s safety net, keep it
  // fresh (spec "Frontend reaction matrix", row "Status / … / accept", column
  // "Do not touch"). A project event would re-read it from every tab that
  // declared the project. The card accepted in this tab stays by its
  // snapshot through those re-reads (R12, `inboxAcceptedRetention.ts`).
}

/**
 * K18 "Move". `reparent.oldParentIds` is always empty in the browser
 * frame (R19): the old parent of this project is refreshed by the
 * `dependency.deleted` the same reparent writes per detached edge.
 */
function issueReparented(
  qc: LiveInvalidationTarget,
  trees: TreeResets,
  id: string,
  pid: string,
  envelope: EventEnvelope,
): void {
  const newParent = readNewParentId(envelope);
  const touched = newParent ? [id, newParent] : [id];
  for (const t of touched) {
    qc.invalidateQueries({ queryKey: ['issues', 'detail', t] });
  }
  trees.columnTreesOf(pid, touched);
  // The sections of the new parent and its ancestors gain the issue; those
  // showing the issue (the old parent's) lose it — `invalidateRowsShowing`.
  if (newParent) trees.sectionsOf(newParent);
  // The issue's row carries its parent; the ancestor backfills of the tree
  // view hang rows under parents.
  invalidateRowsShowing(qc, trees, touched);
  invalidateAncestorBackfills(qc);
}

// ─────────────────────── dependency events ───────────────────────────

/**
 * Dependency added / removed. Ends come from the envelope's `dep` only;
 * an end in another project is absent (R8 / K15) and is not guessed.
 */
function invalidateDepEvent(
  qc: LiveInvalidationTarget,
  trees: TreeResets,
  envelope: EventEnvelope,
  pid: string,
  ctx: InvalidationContext,
): void {
  const dep = readDepEventData(envelope);
  const ends = [dep.fromId, dep.toId].filter((v): v is string => v !== undefined);

  // The dependency lists of open cards of the ends (every type: the
  // "Links" section lists the edge itself).
  for (const end of ends) {
    qc.invalidateQueries({ queryKey: ['deps', pid, end] });
  }

  if (dep.type === 'parent-child') {
    // K18 "Parent-child link": trees, the epic section and the parent's
    // card, the ancestors' progress.
    for (const end of ends) {
      qc.invalidateQueries({ queryKey: ['issues', 'detail', end] });
    }
    trees.columnTreesOf(pid, ends);
    // The sections of the parent end and its ancestors; the child end's
    // current sections by `invalidateRowsShowing`.
    if (dep.toId !== undefined) trees.sectionsOf(dep.toId);
    invalidateRowsShowing(qc, trees, ends);
    invalidateAncestorBackfills(qc);
    return;
  }

  if (dep.type === 'blocks' || dep.type === 'waits-for') {
    // K18 "Link blocks/waits-for": cards and rows of the ends, the blockers
    // of open epic sections, the blocked counters of the expanded row, the
    // lists filtered by blocked-ness (first page). Other lists untouched.
    for (const end of ends) {
      qc.invalidateQueries({ queryKey: ['issues', 'detail', end] });
    }
    // The sections showing an end — as a row or as a blocker — by
    // `invalidateRowsShowing`.
    trees.columnTreesOf(pid, ends);
    invalidateRowsShowing(qc, trees, ends);
    invalidateBlockedFilterLists(qc);
    invalidateExpandedProjectCounters(qc, pid, ctx, false);
    return;
  }
  // K18 "Other links": only the ends' dependency lists, done above.
}

interface DepEventData {
  type?: string;
  fromId?: string;
  toId?: string;
}

/** Read `{type, fromId, toId}` off the compact envelope's `dep`. */
function readDepEventData(envelope: EventEnvelope): DepEventData {
  const source: unknown = envelope.dep;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return {};
  const obj = source as Record<string, unknown>;
  return {
    type: nonEmptyString(obj.type),
    fromId: nonEmptyString(obj.fromId),
    toId: nonEmptyString(obj.toId),
  };
}

function readNewParentId(envelope: EventEnvelope): string | undefined {
  const source: unknown = envelope.reparent;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return undefined;
  return nonEmptyString((source as Record<string, unknown>).newParentId);
}

// ───────────────────── comment / attachment events ───────────────────

/**
 * K18 "Comment". `entityId` is the comment uuid; the issue comes from
 * the envelope's `issueId`. Without it nothing is reset and the regression
 * is surfaced in the console (sk-206: a mute miss is how sk-201 hid).
 */
function invalidateCommentEvent(
  qc: LiveInvalidationTarget,
  envelope: EventEnvelope,
  pid: string,
): void {
  const issueId = nonEmptyString(envelope.issueId);
  if (!issueId) {
    // eslint-disable-next-line no-console
    console.warn('comment event missing issueId — skipping invalidation', {
      eventType: envelope.eventType,
      entityId: envelope.entityId,
    });
    return;
  }
  qc.invalidateQueries({ queryKey: ['issues', 'comments', issueId] });
  // The card's comment counter lives on the detail.
  qc.invalidateQueries({ queryKey: ['issues', 'detail', issueId] });
  invalidateIssueActivity(qc, pid, issueId);
}

/** K18 "Attachment". Same `issueId` rule as comments. */
function invalidateAttachmentEvent(
  qc: LiveInvalidationTarget,
  envelope: EventEnvelope,
  pid: string,
): void {
  const issueId = nonEmptyString(envelope.issueId);
  if (!issueId) {
    // eslint-disable-next-line no-console
    console.warn('attachment event missing issueId — skipping invalidation', {
      eventType: envelope.eventType,
      entityId: envelope.entityId,
    });
    return;
  }
  qc.invalidateQueries({ queryKey: ['issues', issueId, 'attachments'] });
  invalidateIssueActivity(qc, pid, issueId);
}

// ───────────────────── project / component events ────────────────────

/**
 * K18 "Project/members": the projects lookup list and the infinite list of
 * the projects column, the project's members (assignee options), the
 * handle resolutions that name the project, the project's detail card
 * (`ProjectTooltip.tsx#useProjectDetail`, `['project','detail',P]` — not
 * the unread legacy `['projects','detail',…]`). Tasks are not touched.
 */
function invalidateProjectEvent(qc: LiveInvalidationTarget, pid: string): void {
  qc.invalidateQueries({ queryKey: projectsListQueryKey, exact: true });
  qc.invalidateQueries({ queryKey: [...projectsListQueryKey, 'infinite'] });
  qc.invalidateQueries({ queryKey: ['members', 'list', pid] });
  qc.invalidateQueries({
    predicate: (q) =>
      keyStarts(q.queryKey, 'project', 'resolve') && resolvesTo(q, pid),
  });
  qc.invalidateQueries({ queryKey: ['project', 'detail', pid] });
}

/** Does a cached `['project','resolve',handle]` answer name project `pid`? */
function resolvesTo(q: Query, pid: string): boolean {
  const data = q.state.data as { match?: { id?: unknown } | null } | undefined;
  return data?.match?.id === pid;
}

/**
 * K18 "Component": the project's component lists, the card's component
 * names, the projects list (its `componentsCount` draws the expand chevron,
 * sk-551.52) while the row is expanded. Tasks are not touched.
 */
function invalidateComponentEvent(
  qc: LiveInvalidationTarget,
  pid: string,
  ctx: InvalidationContext,
): void {
  invalidateComponentLists(qc, pid);
  qc.invalidateQueries({ queryKey: projectComponentNamesKey(pid) });
  if (ctx.expandedProjectIds?.has(pid)) {
    qc.invalidateQueries({ queryKey: [...projectsListQueryKey, 'infinite'] });
  }
}

// ──────────────────────────── user events ────────────────────────────

/**
 * K18 "User events": the admin's users list; `/me` when the event
 * is about the receiver (the behaviour of the former router is kept). The
 * self-deactivation logout is the provider's ({@link isSelfDeactivation}).
 */
function invalidateUserScoped(
  qc: LiveInvalidationTarget,
  event: ClassifiedEvent,
  ctx: InvalidationContext,
): void {
  if (ctx.isAdmin) {
    qc.invalidateQueries({ queryKey: ['users-admin'] });
  }
  if (event.userId && event.userId === ctx.currentUserId) {
    qc.invalidateQueries({ queryKey: ['auth', 'me'] });
  }
}

// ───────────────────────────── helpers ───────────────────────────────

/** Re-read the activity of one issue (the open card's feed). */
function invalidateIssueActivity(qc: LiveInvalidationTarget, pid: string, id: string): void {
  qc.invalidateQueries({ queryKey: ['activity', 'issue', pid, id] });
}

/**
 * The project's component lists: the shell's `['components','list',P,lens]`
 * (an expanded row of the projects column) and the tasks column's
 * `['components','list',P]` (its component filter).
 */
function invalidateComponentLists(qc: LiveInvalidationTarget, pid: string): void {
  qc.invalidateQueries({
    predicate: (q) => keyStarts(q.queryKey, 'components', 'list', pid),
  });
}

/**
 * Counters of the expanded row of project `pid` — its line in the projects
 * column (`['projects','list','shell','infinite',q,lens]`) and its
 * component counters. Only while the row is expanded: a folded row is
 * registry class 3 (focus / visibility / navigation, R1′). `lensOnly`:
 * the assignee row of K18 touches only the lens variants ("lenses of the expanded
 * row"), the counters without a lens do not depend on the assignee.
 */
function invalidateExpandedProjectCounters(
  qc: LiveInvalidationTarget,
  pid: string,
  ctx: InvalidationContext,
  lensOnly: boolean,
): void {
  if (!ctx.expandedProjectIds?.has(pid)) return;
  qc.invalidateQueries({
    predicate: (q) => {
      const key = q.queryKey;
      if (!keyStarts(key, ...projectsListQueryKey, 'infinite')) return false;
      return !lensOnly || isLensSegment(key[5]);
    },
  });
  qc.invalidateQueries({
    predicate: (q) => {
      const key = q.queryKey;
      if (!keyStarts(key, 'components', 'list', pid)) return false;
      return !lensOnly || isLensSegment(key[3]);
    },
  });
}

/** A lens segment of a projects / components key: present and not `'all'`. */
export function isLensSegment(v: unknown): boolean {
  return typeof v === 'string' && v.length > 0 && v !== 'all';
}

/**
 * Re-read every task list, ancestor backfill and column tree that shows a
 * row of one of `ids` (plus, with `orBlockedRow`, any blocked row — the
 * rows a status change may unblock, phase 1). Where the matrix asks for
 * the whole project's trees, {@link TreeResets.columnTreesOf} does that;
 * here only the trees showing the rows.
 */
function invalidateRowsShowing(
  qc: LiveInvalidationTarget,
  trees: TreeResets,
  ids: readonly string[],
  opts: { orBlockedRow?: boolean } = {},
): void {
  if (ids.length === 0 && !opts.orBlockedRow) return;
  const wanted = new Set(ids);
  qc.invalidateQueries({
    predicate: (q) => {
      const key = q.queryKey;
      if (key[0] !== 'tasks') return false;
      return rowsOf(q.state.data).some(
        (r) => wanted.has(r.id) || (opts.orBlockedRow === true && r.isBlocked === true),
      );
    },
  });
  trees.showing(ids);
}

/** The ancestor backfills of the tree view (`['tasks','ancestors',…]`). */
function invalidateAncestorBackfills(qc: LiveInvalidationTarget): void {
  qc.invalidateQueries({ queryKey: ['tasks', 'ancestors'] });
}

/** Task lists filtered by blocked-ness: from the first page (K21). */
function invalidateBlockedFilterLists(qc: LiveInvalidationTarget): void {
  qc.invalidateQueries({
    predicate: (q) => tasksListInfo(q.queryKey)?.status === 'blocked',
    firstPageOnly: true,
  });
}

/**
 * Open cards that show info about one of `ids` — a card whose dependency
 * list (`['deps',P,openId]`) has an edge to it, or whose detail names it as
 * the parent. Their dependency list and detail are re-read. Only mounted
 * cards are looked at: an unmounted one reads fresh when it opens.
 */
function invalidateOpenCardsLinkingTo(qc: LiveInvalidationTarget, ids: readonly string[]): void {
  if (ids.length === 0) return;
  const wanted = new Set(ids);
  const cache = qc.getQueryCache();
  const openIds = new Set<string>();
  for (const q of cache.findAll({ queryKey: ['deps'], type: 'active' })) {
    const openId = q.queryKey[2];
    if (typeof openId === 'string' && depsMention(q.state.data, wanted)) openIds.add(openId);
  }
  for (const q of cache.findAll({ queryKey: ['issues', 'detail'], type: 'active' })) {
    const openId = q.queryKey[2];
    if (typeof openId !== 'string') continue;
    const data = q.state.data as { parentIdCurrent?: unknown; blockers?: unknown } | undefined;
    const parent = data?.parentIdCurrent;
    // The card names it as its parent, or lists it among its blockers.
    if (
      (typeof parent === 'string' && wanted.has(parent))
      || blockerIdsOf({ id: openId, ...(data ?? {}) } as CachedRow).some((b) => wanted.has(b))
    ) {
      openIds.add(openId);
    }
  }
  for (const openId of openIds) {
    if (wanted.has(openId)) continue;
    qc.invalidateQueries({ queryKey: ['issues', 'detail', openId] });
    qc.invalidateQueries({
      predicate: (q) => q.queryKey[0] === 'deps' && q.queryKey[2] === openId,
    });
  }
}

/** Does a cached `DependencyList` name one of `wanted` on either side? */
function depsMention(data: unknown, wanted: ReadonlySet<string>): boolean {
  if (!data || typeof data !== 'object') return false;
  const lists = [
    (data as { outgoing?: unknown }).outgoing,
    (data as { incoming?: unknown }).incoming,
  ];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const edge of list) {
      if (!edge || typeof edge !== 'object') continue;
      const e = edge as { fromId?: unknown; toId?: unknown; issue?: { id?: unknown } };
      if (
        (typeof e.fromId === 'string' && wanted.has(e.fromId))
        || (typeof e.toId === 'string' && wanted.has(e.toId))
        || (typeof e.issue?.id === 'string' && wanted.has(e.issue.id))
      ) {
        return true;
      }
    }
  }
  return false;
}

/** Bound of the ancestor walk; a cycle or a deep chain stops here. */
const MAX_ANCESTOR_WALK = 64;

/**
 * Ancestors of `id` as the cache knows them: `parentIdCurrent` read off any
 * cached row or detail, walked up. Never a request; an unknown parent ends
 * the walk.
 */
function cachedAncestorIds(cache: QueryCache, id: string): string[] {
  const parentOf = new Map<string, string>();
  for (const q of cache.getAll()) {
    const key = q.queryKey;
    if (key[0] === 'issues' && key[1] === 'detail' && typeof key[2] === 'string') {
      const p = (q.state.data as { parentIdCurrent?: unknown } | undefined)?.parentIdCurrent;
      if (typeof p === 'string' && p.length > 0) parentOf.set(key[2], p);
      continue;
    }
    if (key[0] !== 'tasks' && !(key[0] === 'issues' && key[1] === 'tree')) continue;
    for (const r of rowsOf(q.state.data)) {
      if (typeof r.parentIdCurrent === 'string' && r.parentIdCurrent.length > 0) {
        parentOf.set(r.id, r.parentIdCurrent);
      }
    }
  }
  const out: string[] = [];
  const seen = new Set<string>([id]);
  let cur = parentOf.get(id);
  while (cur !== undefined && !seen.has(cur) && out.length < MAX_ANCESTOR_WALK) {
    out.push(cur);
    seen.add(cur);
    cur = parentOf.get(cur);
  }
  return out;
}

interface CachedRow {
  id: string;
  isBlocked?: unknown;
  parentIdCurrent?: unknown;
}

/**
 * Rows held by a cached answer of the row surfaces: an infinite task list
 * (`{pages:[{items}]}`), an ancestor backfill (`IssueSummary[]`), a layered
 * tree (`{rows:[{item}]}`).
 */
function rowsOf(data: unknown): CachedRow[] {
  const out: CachedRow[] = [];
  const take = (v: unknown) => {
    if (v && typeof v === 'object' && typeof (v as { id?: unknown }).id === 'string') {
      out.push(v as CachedRow);
    }
  };
  if (Array.isArray(data)) {
    data.forEach(take);
    return out;
  }
  if (!data || typeof data !== 'object') return out;
  const pages = (data as { pages?: unknown }).pages;
  if (Array.isArray(pages)) {
    for (const page of pages) {
      const items = (page as { items?: unknown } | null)?.items;
      if (Array.isArray(items)) items.forEach(take);
    }
  }
  const rows = (data as { rows?: unknown }).rows;
  if (Array.isArray(rows)) {
    for (const r of rows) {
      const node = r as { item?: unknown; blockers?: unknown } | null;
      const item = node?.item;
      if (!item || typeof item !== 'object' || typeof (item as { id?: unknown }).id !== 'string') continue;
      // A tree node carries its blockers beside the item (`IssueTreeNode`).
      out.push(node?.blockers !== undefined ? { ...(item as CachedRow), blockers: node.blockers } as CachedRow : item as CachedRow);
    }
  }
  return out;
}

/** What a `['tasks', …]` list key says about its surface (`useTasks.ts`). */
export interface TasksListInfo {
  kind: 'project' | 'search' | 'all' | 'me';
  /** Project UUID, `'all'`, or the lens of a `'me'` surface. */
  scope: unknown;
  /** `'all'` / `'outbox'` / `'on-me'` on project lists; undefined elsewhere. */
  lens: unknown;
  /** Status filter of the column (`'blocked'`, `'unreviewed'`, …). */
  status: unknown;
  /** Text search, empty when none. */
  search: string;
}

/**
 * Decode a `['tasks', …]` key built by `useTasks.ts#cacheKey`; null for
 * other keys (`['tasks','ancestors',…]`, `['tasks','not-found',…]`).
 * Positions mirror that builder.
 */
export function tasksListInfo(key: readonly unknown[]): TasksListInfo | null {
  if (key[0] !== 'tasks') return null;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  switch (key[1]) {
    case 'project':
      return { kind: 'project', scope: key[2], lens: key[3], status: key[4], search: str(key[9]) };
    case 'search':
      return { kind: 'search', scope: key[2], lens: undefined, status: key[3], search: str(key[8]) };
    case 'all':
      return { kind: 'all', scope: 'all', lens: undefined, status: key[3], search: str(key[7]) };
    case 'me':
      return { kind: 'me', scope: key[2], lens: key[2], status: key[3], search: str(key[7]) };
    default:
      return null;
  }
}

function keyStarts(key: readonly unknown[], ...prefix: readonly unknown[]): boolean {
  if (key.length < prefix.length) return false;
  return prefix.every((v, i) => key[i] === v);
}

/**
 * The parent of a child created under one: skein-api gives it the id
 * `<parent>.N`, N a decimal number (`issues/id.go#nextChildID`). Any other
 * id is a root of its project — `undefined`: a custom-mode root may carry a
 * dot in its suffix (`ValidateCustomSuffix` allows `[a-z0-9_.-]`), e.g.
 * `sk-release.rc`, and is no child of `sk-release`.
 */
function parentOfChildId(id: string): string | undefined {
  const m = /^(.+)\.\d+$/.exec(id);
  return m ? m[1] : undefined;
}

function nonEmptyString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

// ─────────────────── epic section and column trees ───────────────────

/**
 * The tree resets of ONE event, collected and applied together at its end
 * ({@link TreeResets.apply}). Two kinds of tree:
 *
 *  - the epic section — the only reader of the CROSS-project tree
 *    (`project: null` → `['issues','tree','__cross__',…]`,
 *    `useLayeredTree.ts#layeredTreeQueryKey`);
 *  - the column trees — `['issues','tree',<project UUID>,…]`
 *    (`TasksColumn.tsx#useLayeredTree`).
 *
 * Why collected (sk-622.21, test-plan No. 79): the section and the column tree
 * have catch-up clocks (`epicSectionClock.ts`, `tasksColumnTreeClock.ts`,
 * sk-429) — a mounted reader whose shown answer was REQUESTED before the
 * clock re-reads. A clock moved by a second reset of the same event, after
 * the first reset already started the read, would date the event after that
 * read and cost a second, useless one. So both clocks move first, once,
 * and then one reset is issued.
 *
 * Options, as before (sk-421.2 F-21 / F-23, sk-427 item 4):
 *  - by prefix: every variant of a tree key (depth, blockers flag) — both
 *    modes are marked, only the mounted one re-reads;
 *  - `refetchType: 'active'`: a section opened later reads fresh;
 *  - `cancelRefetch: false`: a burst does not restart a running walk.
 * A clock moves only when a MOUNTED tree is hit, so an unrelated event costs
 * no catch-up read. Sections are hit by K18 "ancestors" — the section of an
 * issue and of its ancestors ({@link TreeResets.sectionsOf}, or showing the
 * issue); a section with no answer yet cannot tell what it shows and counts
 * as hit (its first read may have been answered before the event).
 */
class TreeResets {
  private readonly projects = new Set<string>();
  private readonly ids = new Set<string>();
  private readonly roots = new Set<string>();
  private noAnswer = false;

  /** Column trees of project `pid`, and any tree showing one of `ids`. */
  columnTreesOf(pid: string, ids: readonly string[]): void {
    this.projects.add(pid);
    this.showing(ids);
  }

  /** Any tree — column or section — showing one of `ids` (row or blocker). */
  showing(ids: readonly string[]): void {
    ids.forEach((id) => this.ids.add(id));
  }

  /**
   * The epic sections of issue `id` and of its ancestors (K18): a section
   * holds its root's whole subtree without the root (`EpicProgressSection`),
   * so these are the section rooted at `id` and the sections showing `id`.
   */
  sectionsOf(id: string): void {
    this.roots.add(id);
    this.ids.add(id);
  }

  /**
   * Every tree — column or section — with no answer yet: it cannot tell what
   * it will show, and its first read may have started before the event.
   */
  unanswered(): void {
    this.noAnswer = true;
  }

  apply(qc: LiveInvalidationTarget): void {
    const ids = [...this.ids];
    const projects = this.projects;
    const roots = this.roots;
    const noAnswer = this.noAnswer;
    if (projects.size === 0 && ids.length === 0 && !noAnswer) return;

    const column = (q: Query): boolean =>
      q.queryKey[0] === 'issues'
      && q.queryKey[1] === 'tree'
      && q.queryKey[2] !== '__cross__'
      && (
        (typeof q.queryKey[2] === 'string' && projects.has(q.queryKey[2]))
        || treeShowsAny(q, ids)
        || (noAnswer && q.state.data === undefined)
      );
    const section = (q: Query): boolean =>
      keyStarts(q.queryKey, 'issues', 'tree', '__cross__')
      && (
        (typeof q.queryKey[3] === 'string' && roots.has(q.queryKey[3]))
        || q.state.data === undefined
        || treeShowsAny(q, ids)
      );

    const cache = qc.getQueryCache();
    if (cache.findAll({ predicate: column, type: 'active' }).length > 0) {
      markTasksColumnTreeEvent();
    }
    if (cache.findAll({ predicate: section, type: 'active' }).length > 0) {
      markEpicSectionEvent();
    }
    qc.invalidateQueries(
      { predicate: (q) => column(q) || section(q), refetchType: 'active' },
      { cancelRefetch: false },
    );
  }
}

/**
 * Does a cached tree show one of `ids` — as a row, or as a blocker on a row
 * (the epic section's «blocked by» subline carries the blocker's title and
 * status, K18 "info about this issue in open sections")?
 */
function treeShowsAny(q: Query, ids: readonly string[]): boolean {
  if (ids.length === 0) return false;
  return rowsOf(q.state.data).some(
    (r) => ids.includes(r.id) || blockerIdsOf(r).some((b) => ids.includes(b)),
  );
}

/** Ids of the visible blocker refs a row carries (`blockers[].id`). */
function blockerIdsOf(row: CachedRow): string[] {
  const list = (row as { blockers?: unknown }).blockers;
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const b of list) {
    const id = (b as { id?: unknown } | null)?.id;
    if (typeof id === 'string') out.push(id);
  }
  return out;
}
