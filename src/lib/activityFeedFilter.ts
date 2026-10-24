import type { ActivityEntry } from '../api/activity';

/**
 * sk-285.6.6 — what the issue card's Activity feed is allowed to repeat.
 *
 * The per-issue activity endpoint deliberately returns comment events
 * alongside issue events: it is the same feed the project page and the
 * cross-project dashboard read, and there a `comment.created` row is the
 * ONLY trace a comment leaves. On the issue card it is not: the
 * Comments section directly above prints every one of those comments in
 * full — author, time and body. The Activity copy adds no text, no new
 * author and no new time; it is the same four events a second time, and
 * the reader has to recognise each one twice.
 *
 * So the card drops them, and nothing else: status transitions,
 * assignment and accept verbs, commit links, dependency edges and field
 * edits appear NOWHERE else on the card, and losing them would be a
 * worse trade than tolerating the duplicate (the rejected option in the
 * ticket).
 *
 * The predicate stays here, pure and separately testable, rather than
 * inline in the section: it encodes a product rule ("do not repeat what
 * the card already shows in full"), and the next surface that shows
 * comments in full will need the same rule.
 */

/**
 * True for an event whose whole content is a comment.
 *
 * Two independent signals, because either alone has a hole:
 *
 *   - the event TYPE namespace (`comment.created`, and any future
 *     `comment.updated` / `comment.deleted` the backend adds — matching
 *     the prefix means a new sibling type is excluded on arrival rather
 *     than leaking a fresh duplicate into the feed);
 *   - the ENTITY type, which the backend sets to `comment` for rows
 *     about a comment even where the event type is spelled differently.
 *
 * Deliberately NOT matched: an issue event that merely mentions a
 * comment in its summary. Only rows whose subject IS the comment go.
 */
export function isCommentEvent(entry: ActivityEntry): boolean {
  return entry.type.startsWith('comment.') || entry.entity.type === 'comment';
}

/**
 * The feed as the issue card should show it: everything except the rows
 * the Comments section already renders in full.
 *
 * Order is preserved — the caller has already sorted, and day-grouping
 * downstream depends on it.
 */
export function withoutCommentEvents(entries: ActivityEntry[]): ActivityEntry[] {
  return entries.filter((e) => !isCommentEvent(e));
}
