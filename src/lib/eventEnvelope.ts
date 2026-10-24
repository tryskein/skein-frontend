/**
 * Browser contract of the skein-web SignalR hub `/hub` — TypeScript mirror
 * of `skein-web/src/Hubs/BrowserContract.cs` (spec sk-622.21 US-9 / US-11 /
 * US-12 / US-10, plan T030; this file — T040). Frontend and skein-web ship
 * together (R5), so every name here — client method names, hub method
 * names, JSON field names, enumerated string values — is a stable contract:
 * additive changes only.
 *
 * The hub calls four client methods ({@link BrowserClientMethods}):
 *  - `event`    — a compact project / user event ({@link EventEnvelope}),
 *                 and, on the same method, the personal notification
 *                 envelope (told apart by shape: it carries
 *                 `notificationId` instead of `id`);
 *  - `signal`   — a coalesced personal signal ({@link PersonalSignal});
 *  - `reminder` — a personal reminder frame ({@link ReminderFrame});
 *  - `resync`   — "re-read" ({@link ResyncFrame}).
 * The three theme methods keep their own names and payloads and are not
 * part of this contract.
 *
 * The browser calls two hub methods ({@link SkeinHubMethods}):
 * `DeclareProjects(string[])` and `DeclareAllVisible(boolean)`, both
 * answering {@link DeclareResult}.
 */

/** Client-side method names the hub invokes on a browser connection. */
export const BrowserClientMethods = {
  /** Compact event envelope (and the personal notification envelope). */
  Event: 'event',
  /** Coalesced personal signal, at most one per connection per window. */
  Signal: 'signal',
  /** Personal reminder frame; never coalesced, may arrive twice. */
  Reminder: 'reminder',
  /** "Re-read": declare first, then re-read the tab's active data. */
  Resync: 'resync',
} as const;

/** Hub method names the browser invokes (`connection.invoke(name, …)`). */
export const SkeinHubMethods = {
  /** Replace the connection's declared project set (priority order). */
  DeclareProjects: 'DeclareProjects',
  /** Turn the "all projects visible to me" mode on or off (`/activity`). */
  DeclareAllVisible: 'DeclareAllVisible',
} as const;

/** Closed set of {@link DeclareRejection.reason} values. */
export type DeclareRejectReason = 'no_access' | 'limit' | 'rate' | 'invalid';

/** One rejected project of a declaration. */
export interface DeclareRejection {
  /**
   * The id exactly as the client sent it (may be a non-UUID string when
   * `reason` is `invalid`); the empty string on a refused `DeclareAllVisible`
   * — that refusal concerns the mode, not a project.
   */
  projectId: string;
  /** Why it was rejected. Open for forward-compat. */
  reason: DeclareRejectReason | (string & {});
}

/** Result of `DeclareProjects` / `DeclareAllVisible`. */
export interface DeclareResult {
  /**
   * Ids of THIS call that entered the connection's set, in declaration
   * order, as the client sent them. `[]` for a call refused with `rate`
   * (the previous set stays in force and is not echoed), and always `[]`
   * for `DeclareAllVisible` (the mode names no project).
   */
  accepted: string[];
  /** One entry per rejected id; empty when everything was accepted. */
  rejected: DeclareRejection[];
}

/** Known entity tags on the wire; open via `(string & {})` for forward-compat. */
export type EventEntityType =
  | 'issue'
  | 'project'
  | 'comment'
  | 'dep'
  | 'dependency'
  | 'attachment'
  | 'component'
  | 'user'
  | (string & {});

/** Actor transport axis on the wire (closed set from events.actor_type). */
export type EventActorType = 'human' | 'agent' | 'system';

/**
 * Known `<entity>.<action>` event types. The wire set is larger and grows;
 * unknown strings remain assignable via `(string & {})`. Per-field child
 * edit events (`*.field_changed`) are never delivered to browsers: the
 * parent edit event carries {@link EventEnvelope.changedFields} instead.
 */
export type EventType =
  | 'issue.created'
  | 'issue.updated'
  | 'issue.closed'
  | 'issue.claimed'
  | 'issue.unclaimed'
  | 'issue.status_changed'
  // sk-489 (US-3) — change of the outcome of an already closed issue. The type is PUBLIC (not
  // journal-only): it reaches open surfaces through NATS →
  // SignalR, and it resets the card, the rows and the parent summary
  // (US-12, handled in `lib/liveEventInvalidation.ts`).
  | 'issue.outcome_changed'
  | 'issue.reparented'
  | 'issue.commits_attached'
  | 'comment.created'
  | 'comment.updated'
  | 'comment.deleted'
  | 'attachment.created'
  | 'attachment.deleted'
  | 'dependency.created'
  | 'dependency.deleted'
  | 'project.member_added'
  | 'project.member_removed'
  | 'user.created'
  | 'user.deactivated'
  | (string & {});

/**
 * Dependency part of an envelope (R8, K15): the type and only those ends
 * whose project equals the event's project. An end lying in another
 * project is omitted — the envelope never identifies an issue outside the
 * recipient's horizon (INV-17).
 */
export interface EnvelopeDependency {
  /** Dependency type, e.g. `blocks`, `parent-child`, `related`. */
  type: string;
  /** Hierarchical id of the "from" end; absent when it lies in another project. */
  fromId?: string;
  /** Hierarchical id of the "to" end; absent when it lies in another project. */
  toId?: string;
}

/** Re-parent part of an envelope. */
export interface EnvelopeReparent {
  /** Parents the issue was detached from (empty when it had none). */
  oldParentIds: string[];
  /** The new parent. */
  newParentId: string;
}

/**
 * Compact event envelope (US-12, phase 1; plus {@link row} in phase 2) —
 * the payload of the `event` client method.
 *
 * It carries no field values of the issue: no `payload`, `oldData` or
 * `newData`. Values of the issue text fields and comment bodies never
 * appear in it; {@link changedFields} holds field NAMES only (INV-13).
 *
 * Delivery is at-least-once: subscribers MUST dedup on {@link id}.
 * Nullable fields arrive as `null` when unknown; optional fields are
 * omitted when absent.
 */
export interface EventEnvelope {
  /** BIGSERIAL id of the events row in skein-api; the dedup key. */
  id: number;
  /** Canonical event time (ISO-8601 UTC). */
  occurredAt: string;
  /** "<entity>.<action>" — first segment is entity short-name. */
  eventType: EventType;
  /** issue | project | comment | dep | attachment | component | user. */
  entityType: EventEntityType;
  /** Hierarchical id (issues) or uuid (others). For user events == userId. */
  entityId: string;
  /** Project UUID; null on user events. */
  projectId?: string | null;
  /** Username of the event author; null when unknown. */
  actor?: string | null;
  /** Actor transport axis; null when unknown. */
  actorType?: EventActorType | null;
  /** Actor user UUID; null on system events. */
  actorUserId?: string | null;
  /** Issue title (for comments — the parent issue's title); null when none. */
  entityTitle?: string | null;
  /** Project id prefix (e.g. "sk"); null when projectId is null. */
  projectIdPrefix?: string | null;
  /** The issue a comment or attachment event belongs to; absent otherwise. */
  issueId?: string;
  /** Names of the issue fields changed by a parent edit event; absent otherwise. */
  changedFields?: string[];
  /** Dependency type and in-project ends; absent on non-dependency events. */
  dep?: EnvelopeDependency;
  /** Old and new parents of a re-parent event; absent otherwise. */
  reparent?: EnvelopeReparent;
  /** Commit hashes linked by a commit-attach event; absent otherwise. */
  commitHashes?: string[];
  /** Phase 2: the issue's neutral list row (opaque here, carries `rowSeq`). */
  row?: unknown;
}

/**
 * Closed set of personal signal areas (US-11, plus `spaces` of sk-674.18
 * US-19 / K-18); open for forward-compat.
 */
export type PersonalSignalArea =
  | 'inbox'
  | 'mentions'
  | 'watching'
  | 'lens'
  | 'unreviewed'
  | 'tasks'
  | 'projects'
  /**
   * The user's spaces, their projects, invitations and counters. The only
   * area with a payload: {@link PersonalSignal.spaces}.
   */
  | 'spaces'
  | (string & {});

/**
 * Closed set of {@link PersonalSignalSpace.reason} values — the literal set
 * of spec sk-674.18 US-19 (screens 1.15), mirror of skein-web
 * `SpaceSignalReason`. Every reason re-reads «my spaces», projects,
 * invitations and counters; the reason only chooses the toast and whether
 * an open space page is left (`removed`, `deleted`).
 */
export const SpaceSignalReason = {
  /** The user was invited to the space. */
  Invited: 'invited',
  /** An invitation the user sent was accepted. */
  Accepted: 'accepted',
  /** An invitation the user sent was declined (to the owner and the sender). */
  Declined: 'declined',
  /** An invitation expired (to the owner and the sender). */
  Expired: 'expired',
  /** The user was removed from the space — an open page of it is left. */
  Removed: 'removed',
  /** The user became a member (accepted, or added by an admin). */
  Added: 'added',
  /** The user became the owner (created for them by an admin, or an owner change). */
  OwnerAssigned: 'owner_assigned',
  /** The owner changed (to the previous owner and the members). */
  OwnerChanged: 'owner_changed',
  /** The space was deleted — an open page of it is left. */
  Deleted: 'deleted',
  /** The space was renamed; the entry carries the new name. */
  Renamed: 'renamed',
} as const;

/** A value of {@link SpaceSignalReason}; open for forward-compat. */
export type SpaceSignalReasonValue =
  | (typeof SpaceSignalReason)[keyof typeof SpaceSignalReason]
  | (string & {});

/**
 * One space-level event of a personal signal (sk-674.18 US-19, K-18).
 * Names the space only by its short id and, where the tab needs it for a
 * toast and may no longer be able to read it, its name. No issue or
 * project data.
 */
export interface PersonalSignalSpace {
  reason: SpaceSignalReasonValue;
  /** Space short id — the `id` of GET /api/v1/me/spaces. */
  spaceId: string;
  /**
   * Space name at the time of the event (the new name for `renamed`).
   * Present for `invited`, `added`, `owner_assigned`, `removed`, `deleted`
   * and `renamed`; absent otherwise.
   */
  spaceName?: string;
}

/**
 * Personal signal (US-11) — payload of the `signal` client method. Carries
 * no data, only the personal areas to re-read through REST — except the
 * `spaces` area, whose entries ride in {@link spaces}.
 */
export interface PersonalSignal {
  /** Non-empty set of areas, each at most once. */
  areas: PersonalSignalArea[];
  /** Publish time (UTC). Diagnostic only — never order or dedup by it. */
  sentAt: string;
  /**
   * Space-level events for this user, in the order they happened. Present
   * and non-empty exactly when `areas` contains `spaces`; absent otherwise.
   *
   * Coalescing (skein-web `BrowserContract.cs#PersonalSignal`): a frame that
   * unions several signals loses no entry. Entries identical in all three
   * fields (`reason`, `spaceId`, `spaceName`) are carried once, at the
   * position of their LAST occurrence; the list is ordered by last
   * occurrence, so the final entry for a space is its latest event. E.g.
   * renames Acme → Acme Ltd → Acme within one window arrive as
   * `[{renamed, Acme Ltd}, {renamed, Acme}]` — the current name is the last.
   */
  spaces?: PersonalSignalSpace[];
}

/** Lifecycle step of a reminder frame; only `rang` rings the bell. */
export type ReminderFrameKind = 'set' | 'snoozed' | 'rang' | 'dismissed' | (string & {});

/**
 * Personal reminder frame (US-11) — payload of the `reminder` client
 * method. At-least-once: ring at most once per {@link firingId}.
 */
export interface ReminderFrame {
  reminderId: string;
  /** Hierarchical id of the reminded issue. */
  issueId: string;
  projectId: string;
  kind: ReminderFrameKind;
  /** Due time (UTC) after this step. */
  remindAt: string;
  /** `{reminderId}@{remindAt}` — the ring dedup key. */
  firingId: string;
}

/** Payload of the `resync` client method; the frame itself is the instruction. */
export interface ResyncFrame {
  /** Time (UTC) the replica sent the frame. Diagnostic only. */
  sentAt: string;
}
