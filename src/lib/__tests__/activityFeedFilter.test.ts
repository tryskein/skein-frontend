/**
 * sk-285.6.6 — the issue card's Activity feed must not re-tell the
 * Comments section.
 *
 * On `shop-9` four comments were printed in full — author, time, body —
 * and then listed a second time in Activity as `10:17 reviewer
 * commented`. The second copy carried no text and no new fact; the
 * reader recognised each event twice.
 *
 * What the tests below are actually protecting is a PAIR of claims,
 * because either one alone is a different (and worse) bug:
 *
 *   - comment rows do NOT reach the feed, and
 *   - every other row DOES.
 *
 * The rejected fix in the ticket was deleting the section outright, and
 * a filter that quietly over-matched would land in the same place: no
 * duplicate, and no status history either. So the second block below
 * walks the full wire event vocabulary rather than sampling it.
 */

import { describe, expect, it } from 'vitest';
import type { ActivityEntry } from '../../api/activity';
import { isCommentEvent, withoutCommentEvents } from '../activityFeedFilter';

let nextId = 1;

function entry(
  type: string,
  entityType: ActivityEntry['entity']['type'] = 'issue',
): ActivityEntry {
  return {
    id: nextId++,
    occurredAt: '2026-08-31T10:17:00Z',
    type,
    actor: { userId: 'u-1', username: 'reviewer', type: 'human' },
    entity: { type: entityType, id: 'shop-9', title: 'a task' },
  };
}

describe('sk-285.6.6 — Activity drops what Comments already shows', () => {
  it('excludes the comment event the Comments section renders in full', () => {
    expect(isCommentEvent(entry('comment.created', 'comment'))).toBe(true);
  });

  it('excludes a future comment.* sibling the backend has not shipped yet', () => {
    // Matching the NAMESPACE, not the one literal. `comment.updated` and
    // `comment.deleted` are the obvious next two; if either arrives and
    // the filter only knew `comment.created`, a fresh duplicate would
    // appear in the feed with nobody watching for it.
    expect(isCommentEvent(entry('comment.updated', 'comment'))).toBe(true);
    expect(isCommentEvent(entry('comment.deleted', 'comment'))).toBe(true);
  });

  it('excludes a comment row even when only the ENTITY says so', () => {
    // The two signals are independent on purpose: the wire has carried
    // comment rows under an issue-shaped type before. Either signal
    // alone is enough to drop the row.
    expect(isCommentEvent(entry('issue.commented', 'comment'))).toBe(true);
  });

  it('keeps every event type that appears nowhere else on the card', () => {
    // This is the half that stops the filter from becoming the deletion
    // the ticket rejected. Each of these is the ONLY trace its fact
    // leaves on the issue card.
    const kept = [
      'issue.created',
      'issue.accepted',
      'issue.claimed',
      'issue.unclaimed',
      'issue.closed',
      'issue.archived',
      'issue.status_changed',
      'issue.reparented',
      'issue.updated',
      'dependency.created',
      'dependency.deleted',
    ];
    for (const type of kept) {
      expect(isCommentEvent(entry(type))).toBe(false);
    }
  });

  it('does not drop an issue row whose type merely CONTAINS "comment"', () => {
    // `startsWith`, not `includes`: a hypothetical `issue.comment_locked`
    // is a change to the issue, belongs in the feed, and is not shown
    // anywhere else.
    expect(isCommentEvent(entry('issue.comment_locked'))).toBe(false);
  });

  it('filters a mixed feed and preserves the order of what remains', () => {
    // Order is load-bearing downstream: the section groups the surviving
    // rows into day buckets by walking them in sequence, so a filter
    // that reordered would silently split a day in two.
    const feed = [
      entry('issue.status_changed'),
      entry('comment.created', 'comment'),
      entry('issue.accepted'),
      entry('comment.created', 'comment'),
      entry('dependency.created'),
    ];
    const out = withoutCommentEvents(feed);
    expect(out.map((e) => e.type)).toEqual([
      'issue.status_changed',
      'issue.accepted',
      'dependency.created',
    ]);
    expect(out.map((e) => e.id)).toEqual([feed[0].id, feed[2].id, feed[4].id]);
  });

  it('returns an empty feed when every row was a comment', () => {
    expect(
      withoutCommentEvents([
        entry('comment.created', 'comment'),
        entry('comment.created', 'comment'),
      ]),
    ).toEqual([]);
  });
});
