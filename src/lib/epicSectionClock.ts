/**
 * sk-421.2 T017 (US-2 "Freshness on display", R-7, F-3, F-21, SC-015) —
 * a clock for "the last section event received by this tab".
 *
 * ─── Why a separate clock rather than a refetch flag ───────────────
 *
 * An epic section must refetch the rows it shows when a card is opened and
 * when the mode is switched, IF the response they came from was requested
 * before the tab received the section's last live event.
 * A "refetch on mount" flag cannot express this: switching the mode does
 * not consult mounting, and a successful response clears the stale mark,
 * so a single cache invalidation is not enough. A pair of numbers is
 * needed: the moment the response was REQUESTED and the clock reading.
 *
 * ─── Why the REQUEST moment, not the arrival moment ────────────────
 *
 * The moment the response was requested is compared. If the arrival moment
 * were compared, rows requested BEFORE the event and arriving AFTER it
 * would be wrongly considered fresh: they know nothing about the change
 * the event came for. This is exactly the error the spec names separately.
 *
 * ─── What counts as a "section event" ──────────────────────────────
 *
 * ANY event from the US-2 list received by the tab. Whether the changed
 * issue belongs to this section is NOT checked, and this is not a
 * simplification: before the response the tab does not know the section's
 * composition, so the check would chase its own tail and the requirement
 * would become unprovable. T021 advances the clock from the same router branches where it marks keys stale.
 *
 * ─── Boundaries stated explicitly here ─────────────────────────────
 *
 *   • The clock does NOT go backwards. Events arrive over the network and
 *     may carry a smaller stamp than one already counted; rolling the
 *     clock back would "rejuvenate" responses that are in fact stale.
 *   • Equal moments do NOT count as stale: a response requested STRICTLY
 *     before the event is stale. On equality the request already carried
 *     this change.
 *   • No response at all (`null`) counts as stale, not the other way
 *     round: there is nothing to show, and a refetch does no harm.
 *
 * The state lives on the module, not in React: the live-event router (a plain module
 * with no component) advances it, and several surfaces read it.
 * This is TAB state: another tab has its own clock, as required.
 */

/** 0 means no section event has been received during the tab's lifetime. */
let lastEventAt = 0;

/**
 * Mark that the tab received a section event.
 *
 * Called from the live-event router (T021) on every event of the US-2
 * list. The argument is for tests and for events with their own stamp;
 * the current time is used by default.
 */
export function markEpicSectionEvent(at: number = Date.now()): void {
  // Monotonic: the clock does not go backwards even on an event "from the past".
  if (at > lastEventAt) lastEventAt = at;
}

/** Clock reading: the moment of the last section event (0 means no events yet). */
export function epicSectionClock(): number {
  return lastEventAt;
}

/**
 * Whether a response REQUESTED at `requestedAt` is stale.
 *
 * `null` means no response: counted as stale, there is nothing to show anyway.
 */
export function isStaleAgainstEpicSectionClock(
  requestedAt: number | null | undefined,
): boolean {
  if (requestedAt === null || requestedAt === undefined) return true;
  return requestedAt < lastEventAt;
}

/**
 * Clock reset. FOR TESTS ONLY: the state is module-level and survives
 * unmounting, so without a reset tests would affect each other.
 */
export function resetEpicSectionClockForTests(): void {
  lastEventAt = 0;
}
