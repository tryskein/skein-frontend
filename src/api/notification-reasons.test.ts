/**
 * sk-303.13 / row 36 — the reason-settings models.
 *
 * What is under test is the promise the C1 contract makes to a form that may
 * be older than the server it talks to: «unknown is shown neutrally and
 * is not overwritten on save». Two halves, both mechanical rather than
 * aspirational:
 *
 *   - READ: nothing narrows a server string into a closed client union, so a
 *     reason key or an audience code this build has never seen survives
 *     parsing intact and stays renderable.
 *   - WRITE: the body is the difference between what the server sent and what
 *     the user sees, so a row nobody touched — including one the form could
 *     not even draw — is never named, and the server therefore leaves it
 *     alone.
 *
 * The second half is the load-bearing one: partial update on the wire is only
 * half a guarantee. A client that "helpfully" resends every row it knows would
 * still wipe what it does not know the moment the server learns a new reason.
 */
import { describe, expect, test } from 'vitest';
import {
  ReasonPrefs,
  diffReasonPrefs,
  hasReasonPrefsChanges,
  normalizeReasonPrefs,
  setReasonChannel,
} from './notification-reasons';

const WIRE = {
  reasons: [
    {
      key: 'comment',
      label: 'Comment',
      hint: 'feed — on issues I watch',
      feed: { applicable: true, audience: 'subscribers', enabled: false },
      // Inapplicable channels arrive WITHOUT `audience` (omitempty).
      push: { applicable: false, enabled: false },
    },
    {
      key: 'reminder',
      label: 'Reminder',
      hint: 'does not go to the feed: the ring is driven by reminder state',
      feed: { applicable: false, enabled: false },
      push: { applicable: true, audience: 'reminder_owner', enabled: true },
    },
  ],
  suppressAgentActions: false,
};

describe('normalizeReasonPrefs — reading an answer from a newer server', () => {
  test('keeps an unknown reason key and an unknown audience code verbatim', () => {
    const prefs = normalizeReasonPrefs({
      reasons: [
        {
          key: 'quantum_entanglement',
          label: 'Quantum entanglement',
          hint: 'a reason from the future',
          feed: { applicable: true, audience: 'time_travellers', enabled: true },
          push: { applicable: false },
          // A field this build has never heard of must not break the parse.
          severity: 'catastrophic',
        },
      ],
      suppressAgentActions: true,
    });

    expect(prefs.reasons).toHaveLength(1);
    expect(prefs.reasons[0].key).toBe('quantum_entanglement');
    expect(prefs.reasons[0].label).toBe('Quantum entanglement');
    expect(prefs.reasons[0].feed.audience).toBe('time_travellers');
    expect(prefs.reasons[0].feed.enabled).toBe(true);
    expect(prefs.suppressAgentActions).toBe(true);
  });

  test('an inapplicable channel is off and audience-less whatever the payload says', () => {
    const prefs = normalizeReasonPrefs({
      reasons: [
        {
          key: 'reminder',
          label: 'Reminder',
          // The server never sends this pair, but if it ever did, «no such
          // channel» has to win over «and it is on».
          feed: { applicable: false, enabled: true, audience: 'subscribers' },
          push: { applicable: true, audience: 'reminder_owner', enabled: true },
        },
      ],
      suppressAgentActions: false,
    });
    expect(prefs.reasons[0].feed.applicable).toBe(false);
    expect(prefs.reasons[0].feed.enabled).toBe(false);
    // …and audience-less, as the name of the test and the type both say.
    expect(prefs.reasons[0].feed.audience).toBe('');
  });

  test('a row with no key is dropped; a row with no label falls back to the key', () => {
    const prefs = normalizeReasonPrefs({
      reasons: [
        { label: 'unnamed', feed: {}, push: {} },
        { key: 'mention', feed: { applicable: true }, push: {} },
      ],
      suppressAgentActions: false,
    });
    expect(prefs.reasons.map((r) => r.key)).toEqual(['mention']);
    // No client-side label table to fall back on — the key is nameable enough.
    expect(prefs.reasons[0].label).toBe('mention');
    expect(prefs.reasons[0].hint).toBe('');
  });

  test('a malformed payload degrades to an empty form, not to a crash', () => {
    expect(normalizeReasonPrefs(null).reasons).toEqual([]);
    expect(normalizeReasonPrefs({ reasons: 'nope' }).reasons).toEqual([]);
    expect(normalizeReasonPrefs({}).suppressAgentActions).toBe(false);
  });
});

describe('setReasonChannel — what the form is allowed to change', () => {
  const base = normalizeReasonPrefs(WIRE);

  test('switches an applicable channel and leaves the other one alone', () => {
    const next = setReasonChannel(base, 'comment', 'feed', true);
    expect(next.reasons[0].feed.enabled).toBe(true);
    expect(next.reasons[0].push.enabled).toBe(false);
    // Immutable: the input is untouched, so the «what the server sent» side
    // of the diff stays trustworthy.
    expect(base.reasons[0].feed.enabled).toBe(false);
  });

  test('refuses to switch on a channel the reason does not have', () => {
    const next = setReasonChannel(base, 'reminder', 'feed', true);
    expect(next.reasons[1].feed.enabled).toBe(false);
    expect(next).toBe(base);
  });

  test('a reason the payload does not carry is a no-op, not an invention', () => {
    const next = setReasonChannel(base, 'not_a_reason', 'feed', true);
    expect(next).toBe(base);
    expect(next.reasons).toHaveLength(2);
  });
});

describe('diffReasonPrefs — the round-trip guarantee', () => {
  const base = normalizeReasonPrefs(WIRE);

  test('names only the touched reason and only the touched channel', () => {
    const draft = setReasonChannel(base, 'comment', 'feed', true);
    expect(diffReasonPrefs(base, draft)).toEqual({
      reasons: [{ reason: 'comment', feed: true }],
    });
  });

  test('an unchanged form sends nothing at all', () => {
    const empty = diffReasonPrefs(base, base);
    expect(empty).toEqual({});
    expect(hasReasonPrefsChanges(empty)).toBe(false);
  });

  test('a reason absent from the served payload is never named', () => {
    // The form was built against an older registry: `draft` carries a row the
    // server did not send in `base`. Sending it would be the client inventing
    // a preference; leaving it out is what keeps the server's own state safe.
    const draft: ReasonPrefs = {
      ...base,
      reasons: [
        ...base.reasons,
        {
          key: 'unknown_to_server',
          label: 'Unknown',
          hint: '',
          feed: { applicable: true, audience: 'subscribers', enabled: true },
          push: { applicable: false, audience: '', enabled: false },
        },
      ],
    };
    expect(diffReasonPrefs(base, draft)).toEqual({});
  });

  test('a reason the form never rendered keeps its stored state', () => {
    // The realistic shape of «unknown»: the server sends a reason this build
    // does not understand, the user edits a different row, and the body must
    // not mention the one they did not touch.
    const served = normalizeReasonPrefs({
      reasons: [
        ...WIRE.reasons,
        {
          key: 'reserved_for_wave_9',
          label: 'Future-wave reason',
          feed: { applicable: true, audience: 'nobody_yet', enabled: true },
          push: { applicable: true, audience: 'nobody_yet', enabled: true },
        },
      ],
      suppressAgentActions: false,
    });
    const draft = setReasonChannel(served, 'comment', 'feed', true);
    const body = diffReasonPrefs(served, draft);
    expect(body.reasons).toEqual([{ reason: 'comment', feed: true }]);
    expect(
      body.reasons?.some((r) => r.reason === 'reserved_for_wave_9'),
    ).toBe(false);
  });

  test('an inapplicable channel is never named, in either direction', () => {
    // Switching one ON is a business error (`channel_not_applicable`) and
    // naming it OFF would write a state nothing reads. Both are avoided by
    // never mentioning the cell — even when a draft somehow disagrees.
    const draft: ReasonPrefs = {
      ...base,
      reasons: base.reasons.map((r) =>
        r.key === 'reminder'
          ? { ...r, feed: { ...r.feed, enabled: true } }
          : r,
      ),
    };
    expect(diffReasonPrefs(base, draft)).toEqual({});
  });

  test('suppression travels only when it actually changed', () => {
    const draft: ReasonPrefs = { ...base, suppressAgentActions: true };
    const body = diffReasonPrefs(base, draft);
    expect(body).toEqual({ suppressAgentActions: true });
    expect(hasReasonPrefsChanges(body)).toBe(true);
  });

  test('both axes at once still name only what moved', () => {
    const draft: ReasonPrefs = {
      ...setReasonChannel(base, 'reminder', 'push', false),
      suppressAgentActions: true,
    };
    expect(diffReasonPrefs(base, draft)).toEqual({
      reasons: [{ reason: 'reminder', push: false }],
      suppressAgentActions: true,
    });
  });
});
