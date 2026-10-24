/**
 * sk-303.13 (T028, test matrix row 42) — the empty Watching feed states
 * its cause, and only a cause it can prove.
 *
 * The classifier is pure, so this file can enumerate the whole input
 * space instead of arranging renders. What it is guarding is one
 * property, stated as a rule rather than as three examples: NO OUTPUT
 * MAY CLAIM MORE THAN ITS INPUTS ESTABLISH. The old single line («Not
 * watching anything yet») violated it in two cases out of three, and the
 * acceptance names the violation explicitly — "the text does not claim
 * that all notifications are off when they are not".
 *
 * The tricky half is `feedChannelsAllOff: null`. It is NOT `false`: it
 * says the settings answer is not in hand (still loading, failed, or a
 * registry with no feed-capable reason at all). A verdict that treats
 * the two alike would tell a user with all channels off that his feed is
 * merely quiet — or, worse the other way, blame settings on a failed
 * read.
 *
 * ─── sk-396: where "what exactly is said" lives now ─────────────────
 *
 * The sentences moved into the dictionary (`inbox:watching.empty.<kind>`), and
 * the assertions about the WORDS moved after them — into the last describe of this
 * file, where they are checked against BOTH locales at once. This is not a weakening:
 * before, the rule "no verdict says that notifications are off"
 * held for one English literal, and now also for the Russian one,
 * which did not exist before i18n. What stays here is the ranking
 * of the branches — what the pure function decides.
 */

import { describe, expect, test } from 'vitest';
import {
  describeWatchingEmptiness,
  type WatchingEmptinessInput,
  type WatchingEmptinessKind,
} from '../watchingEmptiness';
import { feedChannelsAllOff } from '../useReasonPrefsProbe';
import type { ReasonPrefs } from '../../api/notification-reasons';
import { en } from '../../i18n/locales/en';
import { ru } from '../../i18n/locales/ru';

const LOCALES = { en, ru } as const;
type Lang = keyof typeof LOCALES;

/**
 * Markers of "the sentence refers to the settings switches".
 *
 * Not "the word off" — Russian has none, and a rule written for one
 * language silently stops checking anything in the second. So the markers
 * are separate per locale and cover both forms in which the branch
 * `feed-channels-off` can only speak: "channel is off" and
 * "in the settings".
 */
const MENTIONS_SWITCHES: Record<Lang, RegExp> = {
  en: /\boff\b|\bsettings\b/i,
  ru: /выключ|настройк/i,
};

/** A verdict sentence in the given language, with the number substituted. */
function sentence(lang: Lang, kind: WatchingEmptinessKind, total = 4): string {
  return LOCALES[lang].inbox.watching.empty[kind].replace(/\{\{total\}\}/g, String(total));
}

const base: WatchingEmptinessInput = {
  subscriptionsTotal: 0,
  itemsCount: 0,
  unreadTotal: 0,
  hasDeliveredEvents: false,
  feedChannelsAllOff: null,
};

const reason = (key: string, applicable: boolean, enabled: boolean) => ({
  key,
  label: key,
  hint: '',
  feed: { applicable, audience: applicable ? 'subscribers' : '', enabled },
  push: { applicable: false, audience: '', enabled: false },
});
const prefs = (rows: ReturnType<typeof reason>[]): ReasonPrefs => ({
  reasons: rows,
  suppressAgentActions: false,
  unwatchOnClose: false,
});

describe('row 42 — three causes, three verdicts', () => {
  test('no subscriptions at all', () => {
    const v = describeWatchingEmptiness(base)!;
    expect(v.kind).toBe('no-subscriptions');
    expect(v.settingsIsTheFix).toBe(false);
  });

  test('subscriptions exist, nothing was delivered', () => {
    const v = describeWatchingEmptiness({
      ...base,
      subscriptionsTotal: 4,
      itemsCount: 4,
      feedChannelsAllOff: false,
    })!;
    expect(v.kind).toBe('no-matching-events');
    // The subscription count is the only substitution, and it must arrive:
    // a sentence without it would not tell one subscription from two hundred.
    for (const lang of ['en', 'ru'] as const) {
      expect(sentence(lang, v.kind, 4), lang).toContain('4');
    }
  });

  test('every feed-capable reason is switched off', () => {
    const v = describeWatchingEmptiness({
      ...base,
      subscriptionsTotal: 4,
      itemsCount: 4,
      feedChannelsAllOff: true,
    })!;
    expect(v.kind).toBe('feed-channels-off');
    expect(v.settingsIsTheFix).toBe(true);
  });

  test('there is unread activity — the column owes no explanation', () => {
    expect(
      describeWatchingEmptiness({
        subscriptionsTotal: 4,
        itemsCount: 4,
        unreadTotal: 3,
        hasDeliveredEvents: true,
        feedChannelsAllOff: true,
      }),
    ).toBeNull();
  });
});

describe('row 42 — no verdict claims more than its inputs prove', () => {
  test('an unknown settings answer never becomes "everything is off"', () => {
    // The acceptance sentence, as an assertion: quiet is quiet, and the
    // text must not announce a switch nobody has read.
    const v = describeWatchingEmptiness({
      ...base,
      subscriptionsTotal: 9,
      itemsCount: 9,
      feedChannelsAllOff: null,
    })!;
    expect(v.kind).toBe('no-matching-events');
    expect(v.settingsIsTheFix).toBe(false);
    // …and the neutral sentence is silent about the switches — see the last
    // describe, where this is checked on both locales on all branches.
  });

  test('"no subscriptions" wins over an off-channel claim, and stays silent about channels', () => {
    // Both facts hold; only one of them is the reason the user sees
    // nothing, and it is the one that would still empty the feed with
    // every channel on.
    const v = describeWatchingEmptiness({ ...base, feedChannelsAllOff: true })!;
    expect(v.kind).toBe('no-subscriptions');
  });

  test('only the verdict set by the settings response may speak about the switches', () => {
    // A scan of the whole input space: whichever branch wins,
    // referring to the settings is allowed only to the one set by
    // the settings response. The words live in the dictionary, so they are checked through
    // it — immediately in both languages.
    const kinds = new Set<string>();
    for (const feedChannelsAllOff of [true, false, null] as const) {
      for (const hasDeliveredEvents of [true, false]) {
      for (const subscriptionsTotal of [0, 1, 200]) {
        const v = describeWatchingEmptiness({
          subscriptionsTotal,
          itemsCount: subscriptionsTotal === 0 ? 0 : 1,
          unreadTotal: 0,
          hasDeliveredEvents,
          feedChannelsAllOff,
        });
        if (v === null) continue;
        kinds.add(v.kind);
        // The settings answer is the only thing that may establish this verdict.
        expect(v.kind !== 'feed-channels-off' || feedChannelsAllOff === true, v.kind).toBe(true);
        for (const lang of ['en', 'ru'] as const) {
          const text = sentence(lang, v.kind, subscriptionsTotal);
          expect(MENTIONS_SWITCHES[lang].test(text), `${lang}/${v.kind}`).toBe(
            v.kind === 'feed-channels-off',
          );
        }
      }
      }
    }
    // The sweep must reach the verdict that is allowed to mention switches
    // and at least one that is not, or it proved nothing.
    expect(kinds.has('feed-channels-off')).toBe(true);
    expect(kinds.size).toBeGreaterThan(1);
  });
});

describe('sk-303.13.2.10 (W1) — "all read" is not "no events yet"', () => {
  test('a delivered-and-read feed says so, and never claims nothing arrived', () => {
    // The defect: one screen asserting no new events above a card whose
    // timeline lists one. Zero unread proves the events were READ.
    const v = describeWatchingEmptiness({
      ...base,
      subscriptionsTotal: 4,
      itemsCount: 4,
      hasDeliveredEvents: true,
      feedChannelsAllOff: false,
    })!;
    expect(v.kind).toBe('all-read');
    expect(v.settingsIsTheFix).toBe(false);
  });

  test('without evidence of delivery the neutral verdict is unchanged', () => {
    const v = describeWatchingEmptiness({
      ...base,
      subscriptionsTotal: 4,
      itemsCount: 4,
      hasDeliveredEvents: false,
      feedChannelsAllOff: false,
    })!;
    expect(v.kind).toBe('no-matching-events');
  });

  test('«no subscriptions» still wins — there is nothing to have read', () => {
    const v = describeWatchingEmptiness({ ...base, hasDeliveredEvents: true })!;
    expect(v.kind).toBe('no-subscriptions');
  });

  test('switched-off channels outrank it, and stop denying the events on screen', () => {
    // Both facts hold. The actionable one wins, and its sentence is
    // about what will not arrive rather than about what never did — so
    // it stays true beside a card showing old read rows.
    const v = describeWatchingEmptiness({
      ...base,
      subscriptionsTotal: 4,
      itemsCount: 4,
      hasDeliveredEvents: true,
      feedChannelsAllOff: true,
    })!;
    expect(v.kind).toBe('feed-channels-off');
    expect(v.settingsIsTheFix).toBe(true);
  });
});

describe('row 42 — reading "are all feed channels off" out of the settings payload', () => {
  test('all feed-capable reasons off → true', () => {
    expect(
      feedChannelsAllOff(prefs([reason('assign', true, false), reason('comment', true, false)])),
    ).toBe(true);
  });

  test('one left on → false', () => {
    expect(
      feedChannelsAllOff(prefs([reason('assign', true, false), reason('comment', true, true)])),
    ).toBe(false);
  });

  test('a reason with no feed channel does not count as "off"', () => {
    // The alarm has no feed channel at all. Counting an inapplicable
    // channel as a switched-off one would report "everything is off" on
    // a perfectly healthy account.
    expect(
      feedChannelsAllOff(prefs([reason('budilnik', false, false), reason('comment', true, true)])),
    ).toBe(false);
  });

  test('nothing feed-capable in the registry → null, not true', () => {
    expect(feedChannelsAllOff(prefs([reason('budilnik', false, false)]))).toBeNull();
    expect(feedChannelsAllOff(prefs([]))).toBeNull();
  });
});

/**
 * sk-396 — the sentences themselves. Checked against both locales: before i18n
 * there was no Russian text, and the rule "a verdict does not claim
 * more than is proven" held only for the English literal.
 */
describe('sk-396 — the four dictionary sentences say the same as the verdicts', () => {
  const KINDS: WatchingEmptinessKind[] = [
    'no-subscriptions',
    'no-matching-events',
    'all-read',
    'feed-channels-off',
  ];

  test.each(KINDS)('"%s" is in both locales and non-empty', (kind) => {
    // The floor under everything else: a missing key would give `undefined`, and
    // every check below would pass on emptiness.
    for (const lang of ['en', 'ru'] as const) {
      expect(typeof LOCALES[lang].inbox.watching.empty[kind], lang).toBe('string');
      expect(sentence(lang, kind).length, lang).toBeGreaterThan(20);
    }
  });

  test.each(['no-matching-events', 'all-read', 'feed-channels-off'] as const)(
    '"%s" names the number of subscriptions',
    (kind) => {
      for (const lang of ['en', 'ru'] as const) {
        expect(LOCALES[lang].inbox.watching.empty[kind], lang).toContain('{{total}}');
      }
    },
  );

  test('"no subscriptions" does NOT name a number — there is nothing to count', () => {
    for (const lang of ['en', 'ru'] as const) {
      expect(LOCALES[lang].inbox.watching.empty['no-subscriptions'], lang).not.toContain(
        '{{total}}',
      );
    }
  });

  test('exactly one reason speaks about the switches', () => {
    for (const lang of ['en', 'ru'] as const) {
      const mentioning = KINDS.filter((k) => MENTIONS_SWITCHES[lang].test(sentence(lang, k)));
      expect(mentioning, lang).toEqual(['feed-channels-off']);
    }
  });

  test('"all read" does not deny events that are visible on the cards', () => {
    // Defect sk-303.13.2.10 (W1): the screen claimed "no new events"
    // above a card whose feed listed those events.
    const DENIES_EVENTS: Record<Lang, RegExp> = {
      en: /no (new )?events|nothing (has )?(arrived|happened)|yet\b/i,
      ru: /событий (пока )?нет|ничего не приход|пока нет/i,
    };
    const READ: Record<Lang, RegExp> = { en: /\bread\b/i, ru: /прочитан/i };
    for (const lang of ['en', 'ru'] as const) {
      expect(sentence(lang, 'all-read'), lang).toMatch(READ[lang]);
      expect(sentence(lang, 'all-read'), lang).not.toMatch(DENIES_EVENTS[lang]);
      // The "channels off" branch is ranked above "all read", so
      // it too may stand above a card with old events:
      // it speaks of what WILL NOT COME, not of what did not happen.
      expect(sentence(lang, 'feed-channels-off'), lang).not.toMatch(DENIES_EVENTS[lang]);
    }
  });

  test('no sentence claims that notifications are off entirely', () => {
    const ALL_OFF: Record<Lang, RegExp> = {
      en: /all notifications are off|notifications are off/i,
      ru: /уведомления выключены|уведомления отключены/i,
    };
    for (const lang of ['en', 'ru'] as const) {
      for (const kind of KINDS) {
        expect(sentence(lang, kind), `${lang}/${kind}`).not.toMatch(ALL_OFF[lang]);
      }
    }
  });
});
