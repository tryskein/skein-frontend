/**
 * sk-303.13 (T028) — why the Watching tab has nothing to show, stated
 * so that the answer is TRUE (US-5).
 *
 * The old column had one line for every kind of nothing: «Not watching
 * anything yet». It was wrong two ways out of three — a user with forty
 * live subscriptions and a quiet week was told he was not watching
 * anything, and a user whose feed channels were all switched off was
 * told the same, with no hint of where to switch them back on.
 *
 * Four causes, four answers, and the ranking below is the whole
 * mechanism: each branch may only make a claim its inputs actually
 * prove, so the weaker statement wins whenever the stronger one is not
 * established. In particular "channels are off" is claimed ONLY on a
 * settings answer that says so — a settings read that failed, is still
 * in flight, or carries no feed-capable reason at all lands on the
 * neutral "no events yet", which is true regardless.
 *
 * Pure and input-only on purpose: no fetching, no React. The column
 * hands it the response's own facts and renders the verdict.
 *
 * sk-396 — and there is no TEXT here any more. The verdict is a `kind`, and the sentence
 * for it lies in the dictionary under the same name
 * (`inbox:watching.empty.<kind>`, both locales). Assembling the sentence here
 * would mean gluing a literal inside a pure function that has neither a
 * language nor `t()` — that is, the four states would have stayed untranslatable
 * forever. What exactly each branch may claim is guarded by
 * `__tests__/watchingEmptiness.test.ts`: the dictionary strings themselves are
 * checked there too, in both locales.
 */

export type WatchingEmptinessKind =
  /** No subscriptions exist at all. */
  | 'no-subscriptions'
  /** Subscriptions exist; nothing has been delivered against them. */
  | 'no-matching-events'
  /** Subscriptions exist, events were delivered, and all of them are read. */
  | 'all-read'
  /** Subscriptions exist; every feed-capable reason is switched off. */
  | 'feed-channels-off';

export interface WatchingEmptinessInput {
  /** Uncapped count of live subscriptions (`subscriptionsTotal`). */
  subscriptionsTotal: number;
  /** How many cards the response actually carried. */
  itemsCount: number;
  /** Uncapped unread count (`unreadTotal`), the number the column shows. */
  unreadTotal: number;
  /**
   * Whether any card in this response carries a delivered notification
   * at all (a non-empty `recentEvents`). sk-303.13.2.10 (FE-G2 / W1):
   * `unreadTotal === 0` proves «nothing is UNREAD», never «nothing was
   * DELIVERED», and the column used to print the second sentence on the
   * strength of the first — above cards whose timelines listed the very
   * events it said had not happened. One delivered row is enough to
   * disprove "no events yet", so that is what this carries. It cannot
   * prove the converse: the window is 7 days and 5 rows per card, so
   * `false` means «no evidence of delivery», which is exactly the claim
   * the neutral branch is allowed to make.
   */
  hasDeliveredEvents: boolean;
  /**
   * Whether EVERY feed-capable reason is off in the caller's settings.
   * `null` when that is not known — the settings read failed, has not
   * arrived, or the registry exposes no feed-capable reason to judge.
   * `null` is not `false`: it withdraws the claim rather than denying it.
   */
  feedChannelsAllOff: boolean | null;
}

export interface WatchingEmptiness {
  kind: WatchingEmptinessKind;
  /**
   * Whether the link to notification settings is the actionable next
   * step for THIS cause. It always renders (US-5 asks for it on every
   * empty state); this flag only decides whether the copy points at it
   * as the fix or offers it as a place to look.
   */
  settingsIsTheFix: boolean;
}

/**
 * `null` — there is unread activity, so the column has something to
 * show and owes no explanation.
 *
 * Four causes now, not three (sk-303.13.2.10 / FE-G2 W1): "all
 * read" was being announced as "no events yet", which is a
 * different — and, next to a card listing those events, visibly false —
 * statement.
 */
export function describeWatchingEmptiness(
  input: WatchingEmptinessInput,
): WatchingEmptiness | null {
  const { subscriptionsTotal, itemsCount, unreadTotal, hasDeliveredEvents, feedChannelsAllOff } =
    input;

  if (subscriptionsTotal <= 0 && itemsCount === 0) {
    return { kind: 'no-subscriptions', settingsIsTheFix: false };
  }

  if (unreadTotal > 0) return null;

  // Ranked above "all read" on purpose: it is the only branch that
  // names something the user can act on, and its claim — every feed
  // channel is off — is established by the settings answer no matter
  // what was delivered before the switches were flipped. The sentence is
  // phrased about what will NOT arrive rather than about what never
  // did, so it stays true on a card whose timeline shows old read rows.
  if (feedChannelsAllOff === true) {
    return { kind: 'feed-channels-off', settingsIsTheFix: true };
  }

  // sk-303.13.2.10 (FE-G2 / W1) — the fourth state, which used to be
  // folded into the third. "All read" and "no events yet" are
  // different statements about the same zero, and the acceptance asked
  // for honest states, not for a convenient one.
  if (hasDeliveredEvents) {
    return { kind: 'all-read', settingsIsTheFix: false };
  }

  // Deliberately silent about switches. An earlier draft reassured the
  // reader that this does NOT mean notifications are off — which put the
  // words "notifications are off" on a screen where they are not true,
  // and left every reader to parse the negation correctly. Saying only
  // what holds is both shorter and safer; the settings link is right
  // beside it for anyone who wants to check.
  return { kind: 'no-matching-events', settingsIsTheFix: false };
}
