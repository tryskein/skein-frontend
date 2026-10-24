/**
 * Notifications API client. Wraps endpoints under
 *   /api/v1/notifications/...
 *   /api/v1/notification-event-types
 *
 * R1.6 inbox uses 30s polling for the unread badge; the inbox page itself
 * pulls on demand. No real-time push (R3.3 will add SignalR).
 *
 * All shapes mirror the FROZEN backend contract from R1.6 spec.
 */

import { apiFetch, apiJson } from './client';
import { buildQuery } from './queryString';
import type { IssueSummary } from './issues';
import type { PersonStatus } from './users';

// ───────────────────────── Wire enums ─────────────────────────

/**
 * Notification list scopes.
 *
 * - `unread`   — read_at IS NULL (default for the inbox view)
 * - `all`      — non-archived, regardless of read status
 * - `archived` — archived_at IS NOT NULL
 * - `mentions` — sk-38: unread mention-typed notifications
 *                (comment.mention + issue.mention). Drives the shell's
 *                Mentions tab; each row carries a `mentionContext`
 *                snippet extracted from the source body.
 *
 * There was a sixth, `outbox`. sk-303.13 (US-9, contract C2) removed it
 * from the server: the slice now answers 400 `invalid_scope` naming the
 * four above, deliberately rather than an empty 200 — an empty success
 * would tell the client the slice is alive and merely quiet. Keeping the
 * member in this union would let a caller type-check its way into that
 * 400.
 */
export type NotificationScope =
  | 'unread'
  | 'all'
  | 'archived'
  | 'mentions';

export type NotificationActorType = 'human' | 'agent' | 'system';

// ───────────────────────── Wire DTOs ─────────────────────────

/** Who caused the notification — a person object of the spaces contract (`PersonStatus`). */
export interface NotificationActor extends PersonStatus {
  username: string;
  /** null for system events (e.g. "system marked issue stale"). */
  userId: string | null;
  type: NotificationActorType;
}

export interface NotificationEntity {
  type: 'issue' | 'project' | 'component' | 'comment';
  /** Hierarchical id for issues, UUID for projects/components/comments. */
  id: string;
  title: string;
  /** Always populated so client can navigate without a second lookup. */
  projectId: string;
  /** Compact slug (e.g. "demo") for breadcrumbs. */
  projectIdPrefix: string;
}

/**
 * sk-674.18 (T040) — `type` of a notification row that is a pending space
 * invitation card (Inbox).
 */
export const NOTIFICATION_TYPE_SPACE_INVITATION = 'space_invitation';

export interface NotificationItem {
  id: number;
  /**
   * Event type, e.g. "comment.created", "issue.status_changed". Free-form;
   * {@link NOTIFICATION_TYPE_SPACE_INVITATION} marks an invitation card.
   */
  type: string;
  /**
   * sk-674.18 (T029) — short id of the space of the row's issue. Additive:
   * absent until skein-api serves it.
   */
  spaceId?: string;
  createdAt: string;
  /** null until user marks read. */
  readAt: string | null;
  /** null unless archived. */
  archivedAt: string | null;
  actor: NotificationActor;
  entity: NotificationEntity;
  /** Human-readable summary, e.g. "alice commented on demo-42". */
  summary: string;
  /** For status_changed / priority_changed / etc — the field name. */
  field: string | null;
  /** Old value as JSON-ish (string/number/null). Free-form by event type. */
  oldValue: unknown;
  /** New value as JSON-ish (string/number/null). Free-form by event type. */
  newValue: unknown;
  /**
   * sk-38: ~120-char snippet of the body where the @-mention happened.
   * Only populated for `comment.mention` / `issue.mention` rows; absent
   * (undefined) on the wire for everything else (backend
   * `omitempty`). UI uses this to render a "...some preview..." quote
   * under the actor line in the Mentions tab.
   */
  mentionContext?: string;
  /**
   * sk-489 (SC-011) — the close outcome on `issue.status_changed` rows about a
   * close. Wire `omitempty`: absent on all other rows, on
   * close rows with the outcome "done" and on an api answer that does not
   * know about the outcome (US-10).
   *
   * On a row of the new reason `issue.outcome_changed` the outcome does NOT come
   * here but as the former triple `field` = `"closeOutcome"` / `oldValue` /
   * `newValue`: this is a field change, and it is described the same way as any
   * other field change.
   */
  closeOutcome?: string;
}

export interface NotificationCount {
  unread: number;
  total: number;
}

export interface ListNotificationsResult {
  items: NotificationItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

// ───────────────────────── Inputs ─────────────────────────

export interface ListInboxParams {
  scope: NotificationScope;
  /** Optional project UUID — narrow inbox to one project. */
  project?: string;
  /** 1..100, default 50. */
  limit?: number;
  cursor?: string | null;
}

export interface MarkAllReadInput {
  scope?: NotificationScope;
  project?: string;
}

export interface MarkAllReadResult {
  updated: number;
}

export interface MarkReadByEntityInput {
  entityType: 'issue' | 'project' | 'component' | 'comment';
  entityId: string;
}

export interface MarkReadByEntityResult {
  updated: number;
}

export interface CountParams {
  /** Optional UUID — count only notifications for this project. */
  project?: string;
}

// ───────────────────────── Endpoints ─────────────────────────

export async function listInbox(
  params: ListInboxParams,
): Promise<ListNotificationsResult> {
  const qs = buildQuery({
    scope: params.scope,
    project: params.project,
    limit: params.limit,
    cursor: params.cursor,
  });
  return apiJson<ListNotificationsResult>(`/api/v1/notifications${qs}`);
}

// `listIssueNotifications` used to live here: GET
// /api/v1/issues/{id}/notifications, the per-issue "read tail" the Outbox
// card appended under its unread rows. It existed only for that card, its
// name never said «outbox», and the route is now gone from the server —
// the address answers 404 (sk-303.13 / US-9, contract C2). Calling it
// would have turned every card open into a failed request.

export async function getCount(
  params: CountParams = {},
): Promise<NotificationCount> {
  const qs = buildQuery({ project: params.project });
  return apiJson<NotificationCount>(`/api/v1/notifications/count${qs}`);
}

export async function markRead(id: number): Promise<void> {
  await apiFetch(`/api/v1/notifications/${id}/read`, { method: 'POST' });
}

export async function markUnread(id: number): Promise<void> {
  await apiFetch(`/api/v1/notifications/${id}/unread`, { method: 'POST' });
}

export async function archiveNotification(id: number): Promise<void> {
  await apiFetch(`/api/v1/notifications/${id}/archive`, { method: 'POST' });
}

export async function markAllRead(
  input: MarkAllReadInput = {},
): Promise<MarkAllReadResult> {
  return apiJson<MarkAllReadResult>(`/api/v1/notifications/mark-all-read`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/**
 * Used by issue detail page on open: mark every notification for this
 * entity as read so the unread counter reflects what the user has seen.
 */
export async function markReadByEntity(
  input: MarkReadByEntityInput,
): Promise<MarkReadByEntityResult> {
  return apiJson<MarkReadByEntityResult>(
    `/api/v1/notifications/mark-read-by-entity`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
}

// ───────────────────────── Preferences ─────────────────────────
//
// The per-user notification settings client used to live here, over
// `/me/notification-prefs`: a whitelist of event types plus the agent-action
// suppression. sk-303.13 replaced that contract — settings are now stated per
// REASON and per CHANNEL — and the client for the new one lives in
// `api/notification-reasons.ts`. Nothing is left in between: an unused second
// settings client is exactly the "second channel-settings dictionary" the wave
// set out to remove, and `defaultInboxScope` (dead since sk-88 — the server
// never read it) does not come back with it.

// ───────────────────────── Subscription event-type catalog ─────────────────────────

/**
 * One entry of the SERVER-owned catalogue of event types a subscription
 * filter may whitelist (`GET /api/v1/notification-event-types`).
 *
 * This replaced the client-side dictionary that used to live here. The old
 * list was independent of the server and had drifted: it offered types with
 * no delivery at all (`issue.closed`, `issue.claimed`, `issue.archived`,
 * `dependency.created`, `dependency.deleted`) — switches that changed
 * nothing, which is the defect sk-87 was filed for. The server now refuses
 * them (422 `invalid_event_type`), so a local list could only ever be a
 * second source of truth that is wrong.
 *
 * The catalogue is identical for every caller, carries no private data, and
 * is ordered for display. It deliberately excludes personally addressed
 * reasons (mention, reminder): those reach their recipient regardless of any
 * subscription, so offering them as a subscription filter would promise
 * something the system does not do.
 */
export interface SubscriptionEventType {
  /** The `events.type` value stored in the subscription filter. */
  type: string;
  /** Human-readable (RU) name, server-owned. */
  label: string;
  /**
   * EVERY reason this event type projects into for a subscriber — a LIST,
   * not one key. The classifier splits some types by payload: `issue.updated`
   * reaches a subscriber as «Issue assignment» when the assignee changed and
   * as «Other issue edits» when only the priority did. Naming one of the
   * two would group the filter under a reason whose switch does not govern
   * it. Reason keys, not labels — the labels live on the settings form.
   */
  reasons: string[];
}

/**
 * Fetch the catalogue. Per-field defaults guard a malformed wire response so
 * callers always get a well-formed array; entries without a `type` are
 * dropped because they could not be stored in a filter anyway.
 */
export async function listSubscriptionEventTypes(): Promise<SubscriptionEventType[]> {
  const raw = await apiJson<{ eventTypes?: unknown } | null>(
    '/api/v1/notification-event-types',
  );
  const rows = Array.isArray(raw?.eventTypes) ? raw.eventTypes : [];
  const out: SubscriptionEventType[] = [];
  for (const row of rows) {
    const src = (row ?? {}) as Partial<SubscriptionEventType>;
    if (typeof src.type !== 'string' || src.type === '') continue;
    out.push({
      type: src.type,
      label:
        typeof src.label === 'string' && src.label !== '' ? src.label : src.type,
      reasons: Array.isArray(src.reasons)
        ? src.reasons.filter((r): r is string => typeof r === 'string')
        : [],
    });
  }
  return out;
}

// ───────────────────────── R3.3 — custom watchers ─────────────────────────

/**
 * Wire shape of a custom_watchers row's filter jsonb. All fields
 * optional — omitting one disables that axis ("any value passes").
 *
 * Field naming uses snake_case to match the SQL-side jsonb operators
 * used by the server's FanOut SQL evaluation (e.g. `cw.filter->'event_types'`).
 */
export interface CustomWatcherFilter {
  event_types?: string[];
  projects?: string[];
  types?: string[];
  labels?: string[];
  components?: string[];
  priority_max?: number;
}

export interface CustomWatcher {
  id: string;
  name: string;
  filter: CustomWatcherFilter;
  createdAt: string;
}

/**
 * R3.3 consolidated /me/watchers shape — three sections returned by a
 * single endpoint for the /watching page.
 *
 * Each section is server-capped at 50 rows (no paging in R3.3).
 */
export interface IssueWatcherForUser {
  issueId: string;
  issueTitle: string;
  projectId: string;
  projectIdPrefix: string;
  reasons: string[];
  since: string;
}

export interface ProjectWatcherEntry {
  projectId: string;
  projectName: string;
  projectIdPrefix: string;
  reasons: string[];
  since: string;
  /** null = subscribe to all notifiable types. */
  eventTypes: string[] | null;
}

export interface AllWatchers {
  issues: IssueWatcherForUser[];
  projects: ProjectWatcherEntry[];
  custom: CustomWatcher[];
}

export async function listMyWatchers(): Promise<AllWatchers> {
  return apiJson<AllWatchers>(`/api/v1/me/watchers`);
}

// ───────────────────────── sk-39 — Watching feed ─────────────────────────

/**
 * One CARD returned by GET /api/v1/me/watching.
 *
 * sk-622.21 (US-5) — a card is a task, of two kinds:
 *
 *   - **subscribed** — the caller has a live subscription on it (silent
 *     subscriptions, with no notifications yet, are returned too). Its
 *     `reasons` are non-empty and `since` is when the subscription was
 *     written.
 *   - **historical** — no subscription, but the caller's non-archived
 *     notifications inside the Watching window still carry this task as
 *     their card (e.g. the subscription was dropped automatically when the
 *     task closed and the closing notification remains). `reasons` is
 *     empty and `since` is `null`; the card stays while it has
 *     notifications in the window. Its only action is «remove», never
 *     «unsubscribe» — there is nothing to unsubscribe from
 *     (`isHistoricalWatchingCard`).
 *
 * Every notification's card is fixed when the notification is written:
 * the task it is about if the caller watched that task, otherwise the
 * nearest ancestor the caller watched with its subtree. A subtree
 * subscription on an ancestor therefore yields exactly ONE card carrying
 * the activity of every descendant; there is no card for a descendant
 * the caller does not watch itself.
 *
 * `item` carries the full IssueSummary the rest of the shell already
 * renders — the CARD's task. `reasons` lists every reason the caller is
 * subscribed (server pre-sorts by render priority: manual > assignee >
 * creator > mention > commenter); empty on a historical card.
 *
 * `unreadEventsCount` is the caller's unread notifications whose card is
 * this task, written inside the Watching window — the task's own and, on
 * a subtree card, its descendants'. A notification has one card, so
 * summing this field across cards never double-counts.
 *
 * `recentEvents` is the last 5 of the caller's NOTIFICATIONS on this card
 * within 7 days (read or unread), so `recentEvents[].id` is a
 * NOTIFICATION id and `createdAt` is when the notification was written.
 * An empty timeline next to a non-zero `unreadEventsCount` is legal: the
 * count's window is longer than the timeline's.
 *
 * `recentEvents[].entity` points at the issue where the event happened,
 * which on a subtree card is a DESCENDANT of `item`. The card must keep
 * the two apart: its title is the card's task, its activity rows are
 * wherever the activity was.
 *
 * `item` is typed as the shared IssueSummary; the import stays at the
 * top-level `IssueSummary` from `api/issues.ts` so cards can pass the
 * value to the existing TaskCard / IssueIDBadge surfaces unchanged.
 */
export interface WatchingItem {
  item: IssueSummary;
  /**
   * sk-674.18 (T029) — short id of the space of the row's issue. Additive:
   * absent until skein-api serves it.
   */
  spaceId?: string;
  /** Subscription reasons; empty on a historical card. */
  reasons: string[];
  unreadEventsCount: number;
  recentEvents: NotificationItem[];
  /** When the subscription was written; `null` on a historical card. */
  since: string | null;
}

/**
 * Is this a historical card — no live subscription, only notifications
 * in the window (US-5)? The wire marks it twice, by empty `reasons` and
 * a `null` `since`; both are required, because a subscription always has
 * a reason and a time, and a card that has either is something the
 * caller can unsubscribe from.
 */
export function isHistoricalWatchingCard(row: WatchingItem): boolean {
  return row.since == null && row.reasons.length === 0;
}

/**
 * Number of cards the server will return at most. The server's own cap
 * (`notifications.WatchingFeedLimit`); named here so the degraded read
 * below can recognise a page that is sitting exactly on it.
 */
export const WATCHING_CARD_CAP = 100;

/**
 * Wire shape for GET /api/v1/me/watching. Order: newest attributed
 * activity first, silent subscriptions last — they are RETURNED, not
 * dropped, so «subscriptions exist, no events yet» stays distinguishable
 * from «no subscriptions at all» (US-5). Cards are capped at
 * WATCHING_CARD_CAP.
 *
 * The three totals beside `items` are what make the cap honest
 * (contract C3 / INV-3):
 *
 *   - `unreadTotal` — unread across ALL subscriptions, uncapped. Equal
 *     by construction to the header's `watching` badge (same SQL on the
 *     server), which is why the column must show THIS number and never
 *     the sum of the cards it happens to have received: the two agree
 *     only while nothing was cut.
 *   - `subscriptionsTotal` — how many subscriptions exist, uncapped.
 *   - `truncated` — `items` is a prefix. The column has to say so out
 *     loud; silently showing part of a list as if it were all of it is
 *     the exact defect US-7 was filed for.
 */
export interface WatchingListResponse {
  items: WatchingItem[];
  unreadTotal: number;
  subscriptionsTotal: number;
  /** `items` is a prefix of the `stateTotal` cards. */
  truncated: boolean;
  /**
   * sk-551.10 — the Open / Closed / All filter the items were selected
   * by (status of the watched task: closed vs everything else).
   */
  state: WatchingState;
  /** Uncapped number of cards in the selected filter — the number under the filter. */
  stateTotal: number;
  /**
   * Cards of both kinds on tasks that are not closed. open + closed is
   * every card — subscribed and historical — so it may exceed
   * `subscriptionsTotal`.
   */
  openTotal: number;
  /** Cards of both kinds on closed tasks. */
  closedTotal: number;
  /**
   * The part of `closedTotal` without a manual subscription, historical
   * cards included — exactly what «Stop watching closed» would take, so
   * the button states it up front.
   */
  closedAutoTotal: number;
}

/** sk-551.10 — the Watching list filter. */
export type WatchingState = 'open' | 'closed' | 'all';

export const WATCHING_STATES: readonly WatchingState[] = ['open', 'closed', 'all'];

/** Does a card on a task with this status belong to the filter? */
export function watchingStateIncludes(state: WatchingState, status: string): boolean {
  if (state === 'all') return true;
  return (status === 'closed') === (state === 'closed');
}

/**
 * Read the payload, filling in the three C3 totals if they are absent.
 *
 * A build of the API from before C3 sends `items` alone. The fallback
 * reproduces exactly what the column did back then — sum the cards —
 * rather than defaulting the total to 0, which would paint an empty
 * column beside a non-empty header badge. It also raises `truncated`
 * when the page sits on the cap, because that is precisely the case
 * where the old summing was known to disagree with the badge.
 */
export function normalizeWatchingResponse(raw: unknown): WatchingListResponse {
  const src = (raw ?? {}) as Partial<WatchingListResponse>;
  const items = Array.isArray(src.items) ? src.items : [];
  const unreadTotal =
    typeof src.unreadTotal === 'number'
      ? src.unreadTotal
      : items.reduce((acc, it) => acc + (it.unreadEventsCount || 0), 0);
  const subscriptionsTotal =
    typeof src.subscriptionsTotal === 'number' ? src.subscriptionsTotal : items.length;
  const truncated =
    typeof src.truncated === 'boolean'
      ? src.truncated
      : items.length >= WATCHING_CARD_CAP;
  // sk-551.10 — an API from before the filter ignores `?state=` and
  // answers with every subscription. Then the response IS «all»,
  // whatever was asked, and the split is unknown: it is derived from the
  // cards rather than invented, which is exact whenever the list is not
  // truncated.
  const filtered = typeof src.state === 'string' && typeof src.stateTotal === 'number';
  const state: WatchingState = filtered ? (src.state as WatchingState) : 'all';
  const closedInItems = items.filter((it) => it.item?.status === 'closed').length;
  const openTotal =
    typeof src.openTotal === 'number' ? src.openTotal : items.length - closedInItems;
  const closedTotal = typeof src.closedTotal === 'number' ? src.closedTotal : closedInItems;
  const stateTotal = filtered ? (src.stateTotal as number) : subscriptionsTotal;
  // Unknown on an older API: count the closed cards that carry no manual
  // reason — exact whenever the list is not truncated, never invented.
  const closedAutoTotal =
    typeof src.closedAutoTotal === 'number'
      ? src.closedAutoTotal
      : items.filter(
          (it) => it.item?.status === 'closed' && !(it.reasons ?? []).includes('manual'),
        ).length;
  return {
    items,
    unreadTotal,
    subscriptionsTotal,
    truncated,
    state,
    stateTotal,
    openTotal,
    closedTotal,
    closedAutoTotal,
  };
}

export async function fetchWatching(
  state: WatchingState = 'all',
  signal?: AbortSignal,
): Promise<WatchingListResponse> {
  return normalizeWatchingResponse(
    await apiJson<unknown>(`/api/v1/me/watching?state=${encodeURIComponent(state)}`, {
      signal,
    }),
  );
}

/**
 * Response of «read card X» — POST /api/v1/me/watching/{issueId}/read
 * (sk-622.21 T008, US-7). Wire literal: `{"marked":2}`.
 */
export interface MarkCardReadResult {
  /**
   * How many notification rows this call flipped from unread to read —
   * every unread notification whose card is X: the task's own and its
   * descendants', inside the Watching window and outside it. May exceed
   * the drop of the Watching badge, which counts only the window; 0 on a
   * repeat, on a card with nothing unread, or on a card that is not the
   * caller's.
   */
  marked: number;
}

/**
 * «Read card X» (US-7): mark read every unread notification of the
 * caller whose Watching card is `issueId`, descendants' events included.
 * Not the same as `markReadByEntity`, which reads the task's own events
 * only and keeps that contract.
 *
 * A body without a numeric `marked` reads as 0 — the operation is
 * idempotent and the count is informational.
 */
export async function markWatchingCardRead(issueId: string): Promise<MarkCardReadResult> {
  const raw = await apiJson<{ marked?: unknown } | null>(
    `/api/v1/me/watching/${encodeURIComponent(issueId)}/read`,
    { method: 'POST' },
  );
  return { marked: typeof raw?.marked === 'number' ? raw.marked : 0 };
}

export async function listMyCustomWatchers(): Promise<CustomWatcher[]> {
  return apiJson<CustomWatcher[]>(`/api/v1/me/custom-watchers`);
}

export interface CreateCustomWatcherInput {
  name: string;
  filter: CustomWatcherFilter;
}

export async function createCustomWatcher(
  input: CreateCustomWatcherInput,
): Promise<CustomWatcher> {
  return apiJson<CustomWatcher>(`/api/v1/me/custom-watchers`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function deleteCustomWatcher(id: string): Promise<void> {
  await apiFetch(`/api/v1/me/custom-watchers/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}
