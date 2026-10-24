/**
 * Reminders API client — sk-62.2 phase 1.
 *
 * Wraps the four REST endpoints the skein-api backend exposes (the
 * skein-web BFF proxies `/api/v1` with the session cookie):
 *
 *   GET    /api/v1/reminders?state=ringing|armed|all
 *   POST   /api/v1/projects/{projectID}/issues/{issueID}/reminders
 *   POST   /api/v1/reminders/{reminderID}/snooze
 *   DELETE /api/v1/reminders/{reminderID}
 *
 * A "reminder" is a per-user "nudge me on this date" alarm on a single
 * issue. The row exists ⟺ the alarm is active; dismissing deletes it.
 * State is DERIVED from `remindAt`: `armed` (remindAt > now) vs
 * `ringing` (remindAt <= now and the scheduler has emitted the bell).
 * The backend stamps the `state` field so the client doesn't have to
 * re-derive it from the clock for list rendering — but the card-level
 * countdown ticks client-side off `remindAt` (see `reminderState`).
 *
 * Wire shapes mirror the API contract in sk-62.2; all camelCase JSON.
 */

import { apiFetch, apiJson } from './client';
import type { IssueStatus, IssueType } from './issues';

// ───────────────────────── Wire enums ─────────────────────────

/**
 * Derived reminder state.
 *   - `armed`   — remindAt is in the future; counting down.
 *   - `ringing` — remindAt has passed; the scheduler emitted the bell
 *                 and the relentless visual nag is on until the user
 *                 dismisses or snoozes.
 */
export type ReminderState = 'armed' | 'ringing';

/**
 * The `state` query filter for the list endpoint. `all` returns both
 * armed and ringing reminders; `ringing` / `armed` narrow to one.
 * Regardless of the filter the response ALWAYS carries the full
 * cross-project `ringingTaskCount` (the badge number).
 */
export type ReminderStateFilter = 'ringing' | 'armed' | 'all';

/**
 * Snooze presets the card chips map to (the API `by` value). Hourly
 * bumps `1h`…`12h` (+1h…+12h), then `1d` +1d, `3d` +3d, `5d`
 * +5d, `1w` +1w. The custom-date path uses `{ until }` instead
 * of `{ by }`. The backend ParseBy accepts any `<n>h|d|w`, so this
 * union is just the curated chip set, not the full accepted range.
 */
export type SnoozeBy =
  | '1h'
  | '2h'
  | '3h'
  | '4h'
  | '5h'
  | '6h'
  | '7h'
  | '8h'
  | '9h'
  | '10h'
  | '11h'
  | '12h'
  | '1d'
  | '3d'
  | '5d'
  | '1w';

// ───────────────────────── Wire DTOs ─────────────────────────

/**
 * One reminder row. Carries enough denormalized issue context
 * (`issueTitle` / `issueStatus` / `issueType` / `issuePriority`) for
 * the budilnik lens to render a flat list without a per-row issue
 * fetch.
 */
export interface Reminder {
  /** Reminder UUID — the target of snooze / dismiss. */
  id: string;
  /** Hierarchical issue id the reminder is attached to (e.g. `sk-62`). */
  issueId: string;
  /** Denormalized issue title for the flat lens list. */
  issueTitle: string;
  /** Denormalized issue status (badge in the lens row). */
  issueStatus: IssueStatus;
  /** Project UUID the issue belongs to. */
  projectId: string;
  /**
   * sk-674.18 (T029) — short id of the space of the row's issue. Additive:
   * absent until skein-api serves it.
   */
  spaceId?: string;
  /** Denormalized issue type. */
  issueType: IssueType;
  /** Denormalized issue priority (0..4). */
  issuePriority: number;
  /** When the alarm fires — RFC3339 UTC. */
  remindAt: string;
  /**
   * When the scheduler emitted the bell notification for the current
   * `remindAt`. Present only after the alarm rang; absent (omitempty)
   * while armed. Snooze resets it to null on the server.
   */
  notifiedAt?: string | null;
  /** How many times this reminder has been snoozed (UI "snoozed N times"). */
  snoozeCount: number;
  /** Reason of the last snooze, if one was given. */
  lastReason?: string | null;
  /** Server-derived state — `armed` vs `ringing`. */
  state: ReminderState;
}

/**
 * Response of `GET /api/v1/reminders`. `ringingTaskCount` is the
 * number of DISTINCT issues with at least one ringing reminder for
 * the caller — always full cross-project, independent of the `state`
 * filter. This is the badge number.
 */
export interface RemindersListResponse {
  reminders: Reminder[];
  ringingTaskCount: number;
}

/** Empty list response — first-paint default so consumers never branch on undefined. */
export const EMPTY_REMINDERS_LIST: RemindersListResponse = {
  reminders: [],
  ringingTaskCount: 0,
};

// ───────────────────────── Operations ─────────────────────────

/**
 * List the caller's reminders, cross-project. `state` filters the
 * returned rows; `ringingTaskCount` is always the full ringing count.
 */
export async function listReminders(
  state: ReminderStateFilter = 'all',
): Promise<RemindersListResponse> {
  const raw = await apiJson<Partial<RemindersListResponse>>(
    `/api/v1/reminders?state=${encodeURIComponent(state)}`,
    { method: 'GET' },
  );
  // Per-field default — a malformed / partial wire response still
  // yields a usable shape (empty list, 0 badge) rather than undefined.
  return {
    reminders: Array.isArray(raw.reminders) ? raw.reminders : [],
    ringingTaskCount:
      typeof raw.ringingTaskCount === 'number' ? raw.ringingTaskCount : 0,
  };
}

/** Payload for creating a reminder. */
export interface CreateReminderArgs {
  /** Project UUID the issue belongs to (path param). */
  projectId: string;
  /** Hierarchical issue id (path param). */
  issueId: string;
  /** When the alarm should fire — RFC3339. */
  remindAt: string;
  /** Optional free-form note recorded on the reminder.set event. */
  note?: string;
}

/**
 * Create (set) a new reminder on an issue. Multiple reminders per
 * (issue, user) are allowed — this always INSERTs a new row.
 */
export async function createReminder(args: CreateReminderArgs): Promise<Reminder> {
  const body: { remindAt: string; note?: string } = { remindAt: args.remindAt };
  if (args.note && args.note.trim() !== '') body.note = args.note.trim();
  return apiJson<Reminder>(
    `/api/v1/projects/${encodeURIComponent(args.projectId)}/issues/${encodeURIComponent(args.issueId)}/reminders`,
    { method: 'POST', body: JSON.stringify(body) },
  );
}

/**
 * Snooze args — EXACTLY ONE of `by` (a preset / `<n>h|d|w`) or `until`
 * (an absolute RFC3339 timestamp) must be supplied. The base of a
 * `by` snooze is "now + N" (computed server-side from the moment the
 * call lands), matching the UX decision in sk-62.2.
 */
export interface SnoozeReminderArgs {
  reminderId: string;
  /** Relative bump — preset or `<n>h|d|w`. Mutually exclusive with `until`. */
  by?: SnoozeBy | string;
  /** Absolute target — RFC3339. Mutually exclusive with `by`. */
  until?: string;
  /** Optional reason recorded on the reminder.snoozed event + `lastReason`. */
  reason?: string;
}

/** Snooze a reminder — moves `remindAt`, resets `notifiedAt`, bumps `snoozeCount`. */
export async function snoozeReminder(args: SnoozeReminderArgs): Promise<Reminder> {
  const body: { by?: string; until?: string; reason?: string } = {};
  if (args.until) {
    body.until = args.until;
  } else if (args.by) {
    body.by = args.by;
  }
  if (args.reason && args.reason.trim() !== '') body.reason = args.reason.trim();
  return apiJson<Reminder>(
    `/api/v1/reminders/${encodeURIComponent(args.reminderId)}/snooze`,
    { method: 'POST', body: JSON.stringify(body) },
  );
}

/** Dismiss (delete) a reminder — silences the nag for that one alarm only. */
export async function dismissReminder(
  reminderId: string,
  note?: string,
): Promise<void> {
  const trimmed = note?.trim();
  const hasNote = trimmed !== undefined && trimmed !== '';
  await apiFetch(`/api/v1/reminders/${encodeURIComponent(reminderId)}`, {
    method: 'DELETE',
    ...(hasNote ? { body: JSON.stringify({ note: trimmed }) } : {}),
  });
}
