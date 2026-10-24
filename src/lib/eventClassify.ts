/**
 * Pure structural classifier for {@link EventEnvelope}. Takes the wire
 * shape produced by the SignalR Hub and produces a {@link ClassifiedEvent}
 * the invalidation router can switch on without inspecting raw NATS
 * subject strings.
 *
 * Decision (R3.2d, finalized): work on envelope fields, NOT a raw subject
 * string. The envelope does not carry the original NATS subject — there
 * is nothing to parse. The mappings here mirror the Go BuildSubject and
 * .NET SubjectParser logic at the structural level:
 *
 *   - entityType === "user"  → user namespace, entityId === userId
 *   - else if projectId set  → project namespace
 *   - else                   → malformed
 *
 * Action is the second segment of eventType (split on the first '.'),
 * which by construction matches the action token .NET / Go put in the
 * subject path. Changed field names come from the compact envelope's
 * `changedFields` — see ClassifiedEvent.changedFields.
 */

import type { EventEnvelope } from './eventEnvelope';

/** Top-level routing namespace, mirrors SubjectNamespace.cs. */
export type Namespace = 'project' | 'user' | 'malformed';

/**
 * Result of classifying an envelope. Shape mirrors ParsedSubject in the
 * .NET Hub bridge so an invalidation rule that works on one side has an
 * obvious analogue on the other.
 */
export interface ClassifiedEvent {
  /** Routing namespace. `malformed` is dropped before invalidation. */
  namespace: Namespace;
  /** Short entity tag from the envelope (issue, project, comment, ...). */
  entityType: string;
  /**
   * Action token — second segment of eventType. e.g. "created",
   * "updated", "claimed", "member_added".
   */
  action: string;
  /** entityId carried verbatim from the envelope. */
  entityId: string;
  /** Project UUID (project namespace only). */
  projectId?: string;
  /**
   * User UUID (user namespace only). Matches entityId by construction —
   * .NET's SubjectParser puts the user uuid in both fields and we keep
   * the same invariant.
   */
  userId?: string;
  /**
   * Names of the issue fields changed by a parent edit event
   * (`issue.updated`), taken from the compact envelope's `changedFields`
   * (spec sk-622.21 US-12). Names only, never values. Absent on every
   * other event — the browser never receives per-field child events.
   */
  changedFields?: readonly string[];
}

/**
 * Sentinel returned for envelopes that fail validation. The router drops
 * these (with a console.warn) instead of dispatching invalidations.
 */
const MALFORMED: ClassifiedEvent = {
  namespace: 'malformed',
  entityType: '',
  action: '',
  entityId: '',
};

/**
 * Classify a wire envelope into the routable shape used by
 * {@link invalidateForEvent}. Pure: no IO, no clock, no cache. Returning
 * a stable shape (not throwing) keeps the dispatch loop simple — every
 * branch downstream just checks `namespace !== 'malformed'`.
 */
export function classifyEvent(e: EventEnvelope): ClassifiedEvent {
  // Defensive: malformed input should never blow up the receive callback.
  if (!e || typeof e.eventType !== 'string' || typeof e.entityType !== 'string'
      || typeof e.entityId !== 'string') {
    return MALFORMED;
  }

  // Action splits on the first '.', mirroring SubjectInput.EventType
  // parsing on the Go side. Empty action or empty entity short-name is
  // treated as malformed.
  const dotIdx = e.eventType.indexOf('.');
  if (dotIdx <= 0 || dotIdx === e.eventType.length - 1) {
    return MALFORMED;
  }
  const action = e.eventType.slice(dotIdx + 1);
  if (!action) {
    return MALFORMED;
  }

  // User namespace: entityType=="user". entityId is the user UUID by
  // construction (mirrors .NET SubjectParser which sets EntityId = uid
  // string for user subjects; H-12).
  if (e.entityType === 'user') {
    if (!e.entityId) {
      return MALFORMED;
    }
    return {
      namespace: 'user',
      entityType: 'user',
      action,
      entityId: e.entityId,
      userId: e.entityId,
      changedFields: readChangedFields(e),
    };
  }

  // Project namespace: every non-user entity requires a projectId. A
  // missing projectId on a non-user event is a writer bug on the
  // skein-api side — Go BuildSubject routes these to skein.events.malformed
  // and the Hub bridge drops them before forwarding, so in practice we
  // never see this branch. Defensive nonetheless.
  if (!e.projectId) {
    return MALFORMED;
  }
  if (!e.entityId || !e.entityType) {
    return MALFORMED;
  }

  return {
    namespace: 'project',
    entityType: e.entityType,
    action,
    entityId: e.entityId,
    projectId: e.projectId,
    changedFields: readChangedFields(e),
  };
}

/**
 * Read `changedFields` off the compact envelope: the string entries of a
 * non-empty array, or `undefined` when the field is absent, not an array,
 * or holds no usable names. Never consults any other envelope field — the
 * compact envelope carries no `payload` (US-12).
 */
function readChangedFields(e: EventEnvelope): readonly string[] | undefined {
  const raw: unknown = e.changedFields;
  if (!Array.isArray(raw)) return undefined;
  const names = raw.filter((v): v is string => typeof v === 'string' && v.length > 0);
  return names.length > 0 ? names : undefined;
}
