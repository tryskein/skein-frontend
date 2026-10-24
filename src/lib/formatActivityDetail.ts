/**
 * sk-73 — structured formatter for the issue-details Activity feed.
 *
 * The Activity section used to render the backend's flat `summary`
 * string verbatim, so a run of edits read as identical noise:
 *
 *   alice updated sk-71.1
 *   alice changed status of sk-71.1
 *   alice updated sk-71.1
 *
 * This formatter turns an `ActivityEntry` into a STRUCTURED breakdown so
 * the renderer can show what actually changed — `open → in_progress`
 * for a status change, `priority: P3 → P2` for a field edit, and a
 * compact `description changed` (with expandable before/after) for large
 * markdown fields. The detail comes from the event's own audit data
 * (`oldValue` / `newValue` / `changes[]`), never from guessing against
 * the issue's current state.
 *
 * Pure module (no React, no DOM) so it is unit-tested in isolation.
 */

import type { ActivityChange, ActivityEntry } from '../api/activity';
import { formatLocalDay } from '../components/format';

/** Issue fields whose values are large markdown/text — rendered as a
 * compact "<field> changed" with an expandable before/after rather than
 * an inline `old → new`. Mirrors the backend large-field set. */
const LARGE_FIELDS = new Set(['description', 'acceptanceCriteria', 'design', 'notes']);

/** Sentinel for an absent / empty value (null assignee, unset due date). */
export const EMPTY_VALUE = '∅';

/** One rendered field change for an `issue.updated` row. */
export interface ActivityFieldChange {
  /** Raw field name from the event (e.g. "acceptanceCriteria"). */
  field: string;
  /** Human label (e.g. "acceptance criteria"). */
  label: string;
  /** True for large markdown fields → compact summary + expandable detail. */
  large: boolean;
  /** Formatted old value (always present; `∅` when absent). */
  oldText: string;
  /** Formatted new value (always present; `∅` when absent). */
  newText: string;
}

/** A two-sided transition rendered as `from → to` with no field label
 * (status changes, re-parent moves). */
export interface ActivityTransition {
  from: string;
  to: string;
}

/** Structured breakdown of one activity row. */
export interface ActivityDetail {
  /** Verb phrase, e.g. "changed status", "updated", "created this task". */
  verb: string;
  /** Single `from → to` transition (status / parent), when applicable. */
  transition?: ActivityTransition;
  /** Per-field diff for `issue.updated`; empty for every other type. */
  changes: ActivityFieldChange[];
  /** Trailing note, e.g. "(stale)" or a dependency edge descriptor. */
  tail?: string;
  /**
   * True only when the row is an `issue.updated` carrying an EXPLICIT
   * empty `changes: []`. The renderer suppresses these so a content-less
   * "updated" stops showing up as empty noise. The backend never writes
   * an issue.updated with an empty diff (WriteHybridUpdateEvents skips
   * it), so this can only be a synthetic/malformed row.
   *
   * An issue.updated with `changes` ABSENT (undefined — a legacy row, or
   * a payload that failed to decode) is NOT detailless: it renders with a
   * generic "updated the issue" verb so its audit trace isn't silently
   * dropped.
   */
  detailless: boolean;
}

function humanLabel(field: string): string {
  switch (field) {
    case 'acceptanceCriteria':
      return 'acceptance criteria';
    case 'estimatedMinutes':
      return 'estimate';
    case 'dueAt':
      return 'due date';
    case 'deferUntil':
      return 'defer-until';
    case 'externalRef':
      return 'external ref';
    case 'sourceContext':
      return 'source context';
    default:
      // title, description, type, priority, assignee, design, notes
      return field;
  }
}

/** Format a `dueAt` / `deferUntil` style timestamp as a local YYYY-MM-DD,
 * falling back to the raw string if it isn't a parseable date. The day
 * rule itself is the shared `formatLocalDay` (sk-421.1 T011). */
function formatDateish(value: unknown): string {
  if (typeof value !== 'string' || !value) return EMPTY_VALUE;
  return formatLocalDay(value) ?? value;
}

/** Render a field value for display, keyed by field name. */
export function formatFieldValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return EMPTY_VALUE;
  switch (field) {
    case 'priority':
      return typeof value === 'number' ? `P${value}` : String(value);
    case 'estimatedMinutes':
      return typeof value === 'number' ? `${value}m` : String(value);
    case 'dueAt':
    case 'deferUntil':
      return formatDateish(value);
    default:
      if (typeof value === 'boolean') return value ? 'yes' : 'no';
      return String(value);
  }
}

function toFieldChange(c: ActivityChange): ActivityFieldChange {
  return {
    field: c.field,
    label: humanLabel(c.field),
    large: LARGE_FIELDS.has(c.field),
    oldText: formatFieldValue(c.field, c.oldValue),
    newText: formatFieldValue(c.field, c.newValue),
  };
}

/**
 * A scalar value of one side of a transition row — or `∅` if the
 * side is absent.
 *
 * sk-489 T018 — the name is generic (`scalarStr`), not `statusStr` as it was
 * originally given: a transition now has two pairs of sides — status and close outcome — and
 * a name that names only one of them would read as a mistake for the second. The rule
 * is still ONE and did not get a second copy: both pairs arrive from the wire
 * as strings, and both are printed as is.
 */
function scalarStr(v: unknown): string {
  return typeof v === 'string' && v ? v : EMPTY_VALUE;
}

/** Pull the post-move parent id from an `issue.reparented` newValue
 * (`{parentId}`). "top-level" when the issue was moved to no parent. */
function reparentTo(v: unknown): string {
  if (v && typeof v === 'object' && 'parentId' in v) {
    const p = (v as { parentId?: unknown }).parentId;
    if (typeof p === 'string' && p) return p;
  }
  return 'top-level';
}

/** Pull the pre-move parent id from an `issue.reparented` oldValue
 * (`{parentIds:[...]}`). "top-level" when it had no parent before. */
function reparentFrom(v: unknown): string {
  if (v && typeof v === 'object' && 'parentIds' in v) {
    const arr = (v as { parentIds?: unknown }).parentIds;
    if (Array.isArray(arr) && arr.length > 0) return String(arr[0]);
  }
  return 'top-level';
}

/** Build a `type: fromId → toId` descriptor from a dependency edge
 * payload (`{fromId, toId, type}`). Returns undefined when the shape is
 * unrecognised so the row just shows the verb. */
function depTail(v: unknown): string | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as { fromId?: unknown; toId?: unknown; type?: unknown };
  const from = typeof o.fromId === 'string' ? o.fromId : undefined;
  const to = typeof o.toId === 'string' ? o.toId : undefined;
  if (!from || !to) return undefined;
  const type = typeof o.type === 'string' && o.type ? o.type : 'related';
  return `${type}: ${from} → ${to}`;
}

export function formatActivityDetail(entry: ActivityEntry): ActivityDetail {
  const actorIsSystem =
    entry.actor.type === 'system' || entry.actor.username === 'system';
  const base = (verb: string): ActivityDetail => ({
    verb,
    changes: [],
    detailless: false,
  });

  switch (entry.type) {
    case 'issue.created':
      return base('created this task');
    case 'issue.accepted':
      return base('accepted the task');
    case 'issue.claimed':
      return base('claimed the task');
    case 'issue.unclaimed':
      return {
        verb: 'released the lock',
        changes: [],
        detailless: false,
        tail: actorIsSystem ? '(stale)' : undefined,
      };
    case 'issue.closed':
      return base('closed the issue');
    case 'issue.archived':
      return base('archived the issue');
    case 'comment.created':
      return base('commented');
    case 'issue.status_changed':
      return {
        verb: 'changed status',
        transition: { from: scalarStr(entry.oldValue), to: scalarStr(entry.newValue) },
        changes: [],
        detailless: false,
      };
    /**
     * sk-489 T018 (US-3, SC-008) — change of the outcome of a closed issue.
     *
     * The form is taken from the NEIGHBOUR ABOVE, not invented: the spec requires a
     * "was → became" row "by the norm of its surface", and the norm of this
     * surface is a transition with two sides and no field label, exactly as in
     * a status change. Hence `transition`, not an entry in `changes[]`:
     * the latter would draw `closeOutcome: done → wont_do`, that is,
     * a FIELD CHANGE, while the event describes a change of the issue state.
     *
     * In English too — by the norm of the surface, not by locale: the history
     * prints all events in English in both locales, and the new row
     * must speak the same way as its neighbours. Localizing the history is
     * separate work and not this task.
     *
     * Side values are printed as they came: the server puts the outcome strings into `old_data` /
     * `new_data` (`issues/close_outcome.go#writeOutcomeChangedInTx`),
     * and a client that is a day older than the server must show an
     * unfamiliar value, not replace it with its own word (INV-2).
     * Without this row the branch would not exist at all: the generic `default` tail
     * would print "outcome changed" and lose both sides — the very
     * content of the event.
     */
    case 'issue.outcome_changed':
      return {
        verb: 'changed outcome',
        transition: { from: scalarStr(entry.oldValue), to: scalarStr(entry.newValue) },
        changes: [],
        detailless: false,
      };
    case 'issue.reparented':
      return {
        verb: 'changed parent',
        transition: { from: reparentFrom(entry.oldValue), to: reparentTo(entry.newValue) },
        changes: [],
        detailless: false,
      };
    case 'dependency.created':
      return {
        verb: 'added a dependency',
        changes: [],
        detailless: false,
        tail: depTail(entry.newValue),
      };
    case 'dependency.deleted':
      return {
        verb: 'removed a dependency',
        changes: [],
        detailless: false,
        tail: depTail(entry.oldValue),
      };
    case 'issue.updated': {
      // `changes` ABSENT (undefined) = legacy row or a payload that
      // failed to decode → keep the row visible with a generic verb so
      // it isn't silently dropped. `changes` PRESENT but empty ([]) =
      // suppressible noise (see the detailless doc above).
      if (entry.changes === undefined) {
        return { verb: 'updated the issue', changes: [], detailless: false };
      }
      const changes = entry.changes.map(toFieldChange);
      return { verb: 'updated', changes, detailless: changes.length === 0 };
    }
    default: {
      const verb = entry.type
        .replace(/^issue\./, '')
        .replace(/^comment\./, '')
        .replace(/^dependency\./, '')
        .replace(/_/g, ' ');
      return base(verb);
    }
  }
}
