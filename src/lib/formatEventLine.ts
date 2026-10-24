/**
 * sk-37 — per-event line formatter for the shell's event lines. Written
 * for the Outbox feed; that surface is gone (sk-303.13 / US-9) and the
 * Watching card, which shared the formatter from the start, is the
 * consumer left.
 *
 * Returns a STRUCTURED breakdown of the event into parts so the
 * renderer can colour-code each piece. The line shape is:
 *
 *   {actor} {verb} {field?} {oldValue → newValue}? {tail?}
 *
 * Examples (rendered with colour spans):
 *
 *   alice  changed status   (open → in_progress)
 *   system released the lock  (stale)
 *   alice  commented
 *   bob    created the issue
 *   alice  updated  (priority, assignee)
 *
 * sk-489 (US-3, SC-011) — closing names the OUTCOME, and an outcome change became
 * its own row:
 *
 *   alice  changed status   (open → closed)  (wont_do)
 *   alice  changed status   (open → closed)
 *   alice  changed outcome  (done → wont_do)
 *
 * Both closing rows here are `issue.status_changed`, and this is not a choice
 * of example but the only reachable form: the second closing reason,
 * `issue.closed`, does not become a feed row today at all (why is
 * spelled out in the docblock of `#closeOutcomeTail`). The second row is a closing
 * with the outcome "done": no tail, the text stayed as it is today, as
 * SC-011 requires.
 *
 * Backend `NotificationDTO.summary` is `"<actor> <verb> <entityRef>"`
 * where `entityRef = "id (title)"`. Reusing that string duplicates the
 * issue title (already in the card header), so this formatter ignores
 * `summary` and re-builds a clean line from the structured fields
 * (`type`, `actor.username`, `field`, `oldValue`, `newValue`).
 *
 * sk-551.24 — every word the line adds of its own (the verb, «someone»,
 * yes / no, «(stale)») comes from the `inbox:eventLine` dictionary, so the
 * caller passes its `t`. What the line only relays stays as it came: the
 * actor's login, the field name and the values on either side of the
 * arrow are contract values, not prose.
 */

import type { TFunction } from 'i18next';
import type { NotificationItem } from '../api/notifications';
import { isDoneOutcome } from './closeOutcome';

/**
 * Structured breakdown of a single notification row. Each property
 * maps to a separate `<span>` in `EventLineRender` so the renderer can
 * paint actor / verb / field / diff arrows in their own colours.
 */
export interface EventLineParts {
  /** Username of the actor — "system" for reaper-driven events. */
  actor: string;
  /** True when the actor is the `system` user (stale-lock reaper). */
  actorIsSystem: boolean;
  /** Human verb (or short verb-phrase) describing the action. */
  verb: string;
  /** Optional field name (when the event is a typed single-field diff). */
  field?: string;
  /** Old value as a display string (only when `newValue` is also present). */
  oldValue?: string;
  /** New value as a display string. */
  newValue?: string;
  /** Optional trailing detail (e.g. "(stale)" for unclaimed by system). */
  tail?: string;
}

function valStr(v: unknown, t: TFunction<'inbox'>): string {
  if (v === null || v === undefined) return '∅';
  if (typeof v === 'boolean') return v ? t('eventLine.yes') : t('eventLine.no');
  if (typeof v === 'string') return v;
  return String(v);
}

/**
 * sk-489 T018 (US-3, US-7, SC-011) — the feed row tail naming the
 * close outcome.
 *
 * It is called by TWO closing reasons — `issue.status_changed` with a transition to
 * "closed" and `issue.closed`. But these are NOT two working paths: exactly
 * one works, `issue.status_changed`. The `issue.closed` branch is a GUARD against
 * a change of the reasons registry, not a description of today's behaviour, and its
 * unreachability today is held by three independent facts:
 *
 *   • the type is declared JOURNAL-ONLY — it is in the list
 *     `notifications/reasons.go#auditOnlyEventTypes`, whose header
 *     says "Being on this list is a decision, not an
 *     omission": no notification row is written for such a type at all;
 *   • this function accepts `NotificationItem`, that is, only a
 *     row of the notifications table. The feed has no other source: the consumer
 *     chain is `formatEventLine` → `EventLineRender.tsx#EventLineRender`
 *     → `WatchingCard.tsx#EventLineRender`;
 *   • no historical rows of this type survived either — the migration
 *     `migrations/000041_classify_prune_notification_history.up.sql`
 *     deleted the records that must not be visible after the rollout, and
 *     `issue.closed` is in its own `audit_only` list.
 *
 * A fourth fact lies in THIS repository, in the very module `NotificationItem`
 * comes from: the docblock of the subscription event-type catalog
 * (`api/notifications.ts#Subscription event-type catalog`) lists
 * `issue.closed` among the types "with no delivery at all", which the server
 * rejects as a filter (422 `invalid_event_type`). So there is no need to go to the api —
 * the mismatch is visible without leaving the frontend.
 *
 * The branch is nevertheless NOT removed, and this is a decision, not an oversight:
 * `formatEventLine` already branches on the event type anyway, the extra condition
 * costs one line, and when the type is registered in the registry in future the tail
 * appears by itself rather than vanishing silently. The three tests of
 * `formatEventLine.test.ts#outcome on issue.closed` guard exactly this and
 * call themselves guards of the unreachable, so that the next reader does not
 * take them for proof of a working path.
 *
 * No second copy of the rule is introduced, and this is true of BOTH
 * reasons: the server puts the outcome into the same payload key of both events
 * (`issues/close_outcome.go#closeOutcomePayload`). It would be wrong only to
 * go on to say that the materialization carries it into the feed row of both types —
 * the feed row is `issue.status_changed`, and the docblock of the field itself
 * (`api/notifications.ts#closeOutcome`) says the same.
 *
 * It stays silent in TWO cases, and they differ:
 *   • the outcome "done" — SC-011 requires today's text to stay as it is:
 *     "closed" already reads as done;
 *   • no field at all — an api that knows nothing about the outcome answers (US-10),
 *     or the row is not about closing. Absence must not be replaced by a value
 *     in either direction.
 *
 * The value is printed AS IT CAME, without translating into a word: the row verb
 * comes from the dictionary (sk-551.24), but the feed prints contract values
 * raw — the neighbouring sides of a status transition (`in_progress`) arrive
 * the same way. This is also
 * the INV-2 requirement about an unfamiliar value, fulfilled by construction, and
 * not by a separate branch.
 */
function closeOutcomeTail(ev: NotificationItem): string | undefined {
  const outcome = ev.closeOutcome;
  if (typeof outcome !== 'string' || outcome === '') return undefined;
  if (isDoneOutcome(outcome)) return undefined;
  return `(${outcome})`;
}

/**
 * Pull the field-list from a backend `issue.updated` summary. Backend
 * produced `"alice updated demo-X (title) (priority, assignee)"`; the
 * field list is the LAST parenthesised group. Returns `null` when the
 * pattern doesn't match (older summaries, mention events).
 */
function fieldListFromSummary(summary: string): string | null {
  const m = summary.match(/\(([^()]+)\)\s*$/);
  if (!m) return null;
  const inner = m[1].trim();
  if (!inner) return null;
  // A field list is comma-separated identifiers (no internal spaces
  // beyond the comma joins). Reject anything that looks like a sentence.
  if (/^[a-z_][a-z0-9_]*(\s*,\s*[a-z_][a-z0-9_]*)*$/i.test(inner)) {
    return inner;
  }
  return null;
}

export function formatEventLine(
  ev: NotificationItem,
  t: TFunction<'inbox'>,
): EventLineParts {
  const actor = ev.actor.username || t('eventLine.someone');
  const actorIsSystem = actor === 'system';
  const base: Pick<EventLineParts, 'actor' | 'actorIsSystem'> = {
    actor,
    actorIsSystem,
  };

  switch (ev.type) {
    case 'issue.created':
      return { ...base, verb: t('eventLine.verb.created') };
    // The tail here is a GUARD, not a working path: the feed does not receive rows of this type
    // today (docblock `#closeOutcomeTail`, four facts).
    case 'issue.closed':
      return { ...base, verb: t('eventLine.verb.closed'), tail: closeOutcomeTail(ev) };
    case 'issue.archived':
      return { ...base, verb: t('eventLine.verb.archived') };
    case 'issue.accepted':
      return { ...base, verb: t('eventLine.verb.accepted') };
    case 'issue.claimed':
      return { ...base, verb: t('eventLine.verb.claimed') };
    case 'issue.unclaimed':
      return {
        ...base,
        verb: t('eventLine.verb.unclaimed'),
        tail: actorIsSystem ? t('eventLine.stale') : undefined,
      };
    case 'issue.status_changed':
      return {
        ...base,
        verb: t('eventLine.verb.statusChanged'),
        oldValue: valStr(ev.oldValue, t),
        newValue: valStr(ev.newValue, t),
        // The outcome is named TOGETHER with the transition, not instead of it: the closing
        // feed row answers two questions at once — where the
        // issue went and how it ended (SC-011).
        tail: closeOutcomeTail(ev),
      };
    /**
     * sk-489 T018 (US-3) — change of the outcome of a closed issue.
     *
     * The form is the same as for a status change: two sides of the transition without
     * a field label. A label (`field`) would be superfluous here and would mislead:
     * the row describes not an edit of a field from the card but a change of the
     * issue state, and the feed reader cares about the sides, not the name of the
     * column. The outcome arrives EXACTLY as the pair `oldValue` / `newValue`, not as the
     * `closeOutcome` key (see the field docblock in `api/notifications.ts`),
     * so the closing tail is not called here.
     *
     * Without the branch the row would be built by the generic `default` tail: it would print
     * "outcome changed" and lose both sides — the very thing the
     * event exists for.
     */
    case 'issue.outcome_changed':
      return {
        ...base,
        verb: t('eventLine.verb.outcomeChanged'),
        oldValue: valStr(ev.oldValue, t),
        newValue: valStr(ev.newValue, t),
      };
    case 'comment.created':
      return { ...base, verb: t('eventLine.verb.commented') };
    case 'comment.mention':
    case 'issue.mention':
      return { ...base, verb: t('eventLine.verb.mentionedYou') };
    case 'dependency.created':
      return { ...base, verb: t('eventLine.verb.dependencyAdded') };
    case 'dependency.removed':
      return { ...base, verb: t('eventLine.verb.dependencyRemoved') };
    case 'issue.reparented':
      return { ...base, verb: t('eventLine.verb.reparented') };
    case 'attachment.added':
      return { ...base, verb: t('eventLine.verb.attachmentAdded') };
    case 'reminder.rang':
      return { ...base, verb: t('eventLine.verb.reminderRang') };
    case 'issue.updated': {
      // Typed single-field change.
      if (ev.field) {
        return {
          ...base,
          verb: t('eventLine.verb.changedField'),
          field: ev.field,
          oldValue: valStr(ev.oldValue, t),
          newValue: valStr(ev.newValue, t),
        };
      }
      // Multi-field bulk update.
      const fields = fieldListFromSummary(ev.summary);
      if (fields) {
        return { ...base, verb: t('eventLine.verb.updatedFields'), tail: `(${fields})` };
      }
      return { ...base, verb: t('eventLine.verb.updated') };
    }
    default: {
      const event = ev.type
        .replace(/^issue\./, '')
        .replace(/^comment\./, '')
        .replace(/_/g, ' ');
      return { ...base, verb: t('eventLine.verb.other', { event }) };
    }
  }
}
