/**
 * sk-489 T018 — the feed row names the close OUTCOME (US-3, US-7, SC-011,
 * matrix row 64).
 *
 * This task created the file: the feed row formatter had no suite of its
 * own at all, and the SC-011 promise ("on closing with the outcome
 * "won't do" the feed row names the outcome; with "done" the text is as today")
 * had nothing to check it.
 *
 * THREE event types are checked, each with its own side of the contract:
 *
 *   • `issue.status_changed` — a transition to "closed" carries the outcome TOGETHER with
 *     the transition, not instead of it. This is the ONLY reachable reason
 *     for closing in the feed today;
 *   • `issue.closed` — the second reason for closing, which does NOT become a feed
 *     row today (three facts are in the docblock of
 *     `formatEventLine.ts#closeOutcomeTail`). Its cases here are
 *     a GUARD of the mirror branch that the wave left on purpose: when the
 *     type is registered, the tail must appear by itself, not vanish silently;
 *   • `issue.outcome_changed` — its own row with the sides of the transition.
 *
 * The negative assertions ("done" is silent, no field - silent) are not an
 * add-on: SC-011 requires today's text to stay today's text,
 * and US-10 requires that an old api response does not produce an invented word.
 */

import { describe, expect, test } from 'vitest';
import type { NotificationItem } from '../api/notifications';
import i18n from '../i18n/config';
import { formatEventLine as formatWith } from './formatEventLine';

// The existing cases read the English line; sk-551.24 adds the RU side below.
const enT = i18n.getFixedT('en', 'inbox');
const formatEventLine = (e: NotificationItem) => formatWith(e, enT);

function ev(partial: Partial<NotificationItem>): NotificationItem {
  return {
    id: 1,
    type: 'issue.status_changed',
    createdAt: '2026-09-19T10:00:00Z',
    readAt: null,
    archivedAt: null,
    actor: { username: 'alice', userId: 'u-1', type: 'human' },
    entity: {
      type: 'issue',
      id: 'sk-42',
      title: 'Example',
      projectId: 'p-1',
      projectIdPrefix: 'sk',
    },
    summary: 'alice changed status of sk-42 (Example)',
    field: null,
    oldValue: 'open',
    newValue: 'closed',
    ...partial,
  };
}

describe('formatEventLine — close outcome on a status transition (SC-011)', () => {
  test('transition to "closed" with "will not do": the outcome is named, the transition stays', () => {
    const parts = formatEventLine(ev({ closeOutcome: 'wont_do' }));
    expect(parts.verb).toBe('changed status');
    // The outcome TOGETHER with the transition: the row answers both questions at once —
    // where the issue went and how it ended.
    expect(parts.oldValue).toBe('open');
    expect(parts.newValue).toBe('closed');
    expect(parts.tail).toBe('(wont_do)');
  });

  test('"done": text as today — no extra tail', () => {
    const parts = formatEventLine(ev({ closeOutcome: 'done' }));
    expect(parts.newValue).toBe('closed');
    expect(parts.tail).toBeUndefined();
  });

  test('no field at all (old api, US-10): no tail', () => {
    // Absence is not replaced by a value in either direction: neither
    // "done" nor "no work".
    expect(formatEventLine(ev({})).tail).toBeUndefined();
  });

  test('an empty string is not counted as an outcome', () => {
    // The server will not send this, but an empty "()" tail on screen would be
    // garbage, not a statement.
    expect(formatEventLine(ev({ closeOutcome: '' })).tail).toBeUndefined();
  });

  test('an unfamiliar value is named AS IS (INV-2)', () => {
    // A client that is a day older than the server prints the string that came,
    // rather than replacing it with its own word or staying silent about it.
    expect(formatEventLine(ev({ closeOutcome: 'flattened_into_epic' })).tail).toBe(
      '(flattened_into_epic)',
    );
  });
});

/**
 * sk-489 — a GUARD for a reason unreachable today.
 *
 * Feed rows of type `issue.closed` do not exist: the type is declared only
 * as journal-only (`notifications/reasons.go#auditOnlyEventTypes`), this function
 * reads only rows of the notifications table, and historical records were
 * cleaned up by migration `000041_classify_prune_notification_history.up.sql`.
 * The branch in `formatEventLine.ts#closeOutcomeTail` is left on purpose — as a
 * guard against a change of the reasons registry — and these three cases guard
 * exactly it, and do NOT prove that such rows arrive today.
 *
 * The assertions are no weaker for that: they describe what the feed must
 * say if the type is registered. Weaken them, and registering the type
 * would silently bring back a row without an outcome.
 */
describe('formatEventLine — outcome on issue.closed: guard of the mirror branch', () => {
  const closed = (closeOutcome?: string) =>
    formatEventLine(
      ev({
        type: 'issue.closed',
        oldValue: null,
        newValue: null,
        ...(closeOutcome === undefined ? {} : { closeOutcome }),
      }),
    );

  test('if the type is registered: "duplicate" is named, the verb is unchanged', () => {
    // A guard of the mirror branch, not evidence of today's path:
    // there are no rows of this type in the feed today (see the block header). The assertion is
    // about an obligation for the future: once the reason is registered, the tail
    // must arrive with it. An implementation that hung the tail only on the
    // status transition is green in the suite above and goes red here.
    expect(closed('duplicate')).toMatchObject({
      verb: 'closed the issue',
      tail: '(duplicate)',
    });
  });

  test('if the type is registered: "superseded" is named too — there are three dropped outcomes', () => {
    expect(closed('superseded').tail).toBe('(superseded)');
  });

  test('if the type is registered: "done" and a missing field — text as today', () => {
    expect(closed('done').tail).toBeUndefined();
    expect(closed().tail).toBeUndefined();
    expect(closed().verb).toBe('closed the issue');
  });
});

describe('formatEventLine — issue.outcome_changed (US-3)', () => {
  const changed = (oldValue: unknown, newValue: unknown) =>
    formatEventLine(
      ev({
        type: 'issue.outcome_changed',
        field: 'closeOutcome',
        oldValue,
        newValue,
      }),
    );

  test('its own row: "was → became" without a field label', () => {
    const parts = changed('done', 'wont_do');
    expect(parts.verb).toBe('changed outcome');
    expect(parts.oldValue).toBe('done');
    expect(parts.newValue).toBe('wont_do');
    // A field label would mislead: the row describes a change of the issue
    // state, not an edit of a column from the card.
    expect(parts.field).toBeUndefined();
  });

  test('the generic tail is NOT acceptable: it loses both sides', () => {
    // A discriminating assertion. Without the `default` branch it yields
    // "outcome changed" and not a single side of the transition.
    const parts = changed('wont_do', 'duplicate');
    expect(parts.verb).not.toBe('outcome changed');
    expect(parts.oldValue).toBe('wont_do');
    expect(parts.newValue).toBe('duplicate');
  });

  test('the outcome of this row arrives as a PAIR, not as the closeOutcome key', () => {
    // The contract is named in the docblock of the `api/notifications.ts` field: in a row
    // of the new reason the outcome is carried by `field` / `oldValue` / `newValue`.
    // An implementation that called the closing tail here would add to the row
    // also "(wont_do)" — the same value in a second voice.
    expect(changed('done', 'wont_do').tail).toBeUndefined();
  });
});

describe('formatEventLine — guards of the previous behaviour', () => {
  test('a system claim release still carries "(stale)"', () => {
    // The row has one tail, and a new owner of the slot must not have displaced
    // the previous one.
    const parts = formatEventLine(
      ev({
        type: 'issue.unclaimed',
        actor: { username: 'system', userId: null, type: 'system' },
      }),
    );
    expect(parts.tail).toBe('(stale)');
    expect(parts.actorIsSystem).toBe(true);
  });

  test('an outcome on an event unrelated to closing changes nothing', () => {
    // The server will not send this: the key appears only on rows about
    // closing. An assertion that the tail is called by EXACTLY two reasons, and
    // not "everywhere the field arrived".
    const parts = formatEventLine(
      ev({ type: 'issue.claimed', closeOutcome: 'wont_do' }),
    );
    expect(parts.verb).toBe('claimed the task');
    expect(parts.tail).toBeUndefined();
  });
});

/**
 * sk-551.24 — the event row speaks the interface language. Acceptance reference:
 * the `status_changed` verb in both languages comes from the dictionary ("changed
 * status" / its Russian counterpart); in RU none of the row's verbs stays
 * English.
 */
describe('formatEventLine — row language (sk-551.24)', () => {
  const ruT = i18n.getFixedT('ru', 'inbox');

  test.each([
    ['en', 'changed status'],
    ['ru', 'сменил статус'],
  ] as const)('status change in %s: "%s", transition sides as they came', (lang, verb) => {
    const parts = formatWith(ev({}), i18n.getFixedT(lang, 'inbox'));
    expect(parts.verb).toBe(verb);
    expect(parts.oldValue).toBe('open');
    expect(parts.newValue).toBe('closed');
  });

  test.each([
    ['issue.created', {}],
    ['issue.closed', {}],
    ['issue.archived', {}],
    ['issue.accepted', {}],
    ['issue.claimed', {}],
    ['issue.unclaimed', {}],
    ['issue.status_changed', {}],
    ['issue.outcome_changed', {}],
    ['issue.reparented', {}],
    ['comment.created', {}],
    ['comment.mention', {}],
    ['issue.mention', {}],
    ['attachment.added', {}],
    ['reminder.rang', {}],
    ['dependency.created', {}],
    ['dependency.removed', {}],
    ['issue.updated', { field: 'priority' }],
    ['issue.updated', { summary: 'alice updated sk-42 (Example) (priority, assignee)' }],
    ['issue.updated', { summary: 'alice updated sk-42' }],
  ] as const)('RU: verb %s without Latin letters', (type, extra) => {
    const parts = formatWith(ev({ type, ...extra }), ruT);
    expect(parts.verb).not.toBe('');
    expect(parts.verb).not.toMatch(/[a-z]/i);
  });

  test('RU: system claim release — the tail comes from the dictionary', () => {
    const parts = formatWith(
      ev({
        type: 'issue.unclaimed',
        actor: { username: 'system', userId: null, type: 'system' },
      }),
      ruT,
    );
    expect(parts.tail).toBe(ruT('eventLine.stale'));
    expect(parts.tail).not.toMatch(/[a-z]/i);
  });

  test('RU: an unfamiliar type is named by its own name inside the Russian phrase', () => {
    const parts = formatWith(ev({ type: 'issue.teleported' }), ruT);
    expect(parts.verb).toBe('событие teleported');
  });

  test('RU: an empty login — "someone", a boolean value — yes / no', () => {
    const parts = formatWith(
      ev({
        type: 'issue.updated',
        field: 'pinned',
        oldValue: false,
        newValue: true,
        actor: { username: '', userId: null, type: 'human' },
      }),
      ruT,
    );
    expect(parts.actor).toBe('кто-то');
    expect(parts.oldValue).toBe('нет');
    expect(parts.newValue).toBe('да');
  });
});
