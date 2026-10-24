/**
 * sk-429 — a clock for "the last live event that hit the tasks column tree,
 * received by this tab".
 *
 * ─── Why ───────────────────────────────────────────────────────────
 *
 * Invalidation of the column tree (`liveEventInvalidation.ts#invalidateTasksColumnTrees`)
 * marks the key stale with `cancelRefetch: false`, and this is deliberate: under a
 * batch write a running full traversal would otherwise be cancelled by every next
 * event and would never finish. The price of the coalescing is an event that arrived
 * BETWEEN the start and the end of a traversal: the library does not start a new read
 * while one is running, and the success of the running one clears the stale mark. Such an event
 * was not caught up by anything, and the tree stayed stale until the next event —
 * which might never come.
 *
 * The consumer catches it up, not the invalidation: making the invalidating side
 * schedule a retry is not allowed, this is the composition rule accepted by sk-421.1 —
 * a shared invalidation covers several surfaces at once, and a retry from it
 * would make those that already have a check read twice.
 *
 * ─── Why its OWN clock, not the epic section clock ─────────────────
 *
 * `lib/epicSectionClock.ts` is advanced on EVERY issue and link event,
 * whatever project it belongs to: the epic section goes cross-project
 * and deliberately does not check membership (before the response it does not know the section's
 * composition). The column tree is the opposite — narrowed by sk-427 item 4 to events of its own
 * project and to issues already shown in it. If it read the other clock,
 * every event of another project would cost it a catch-up read, that is,
 * the narrowing would be cancelled by this very edit.
 *
 * ─── Boundaries (the same as for the section, and for the same reasons) ─
 *
 *   • The clock does NOT go backwards: an event with a smaller stamp would "rejuvenate" responses
 *     that are in fact stale.
 *   • Equal moments do NOT count as stale: a response
 *     requested STRICTLY before the event is stale; on equality the request already carried
 *     this change.
 *   • No response at all (`null`) counts as stale: there is nothing
 *     to show, and a re-read does no harm.
 *
 * The state lives on the module, not in React: it is advanced by the live-event
 * router — a plain module without a component. This is TAB state; another
 * tab has its own clock, as required.
 */

/** 0 means no event has hit the column tree during the tab's lifetime. */
let lastEventAt = 0;

/**
 * Mark that the tab received an event that hit the tasks column tree.
 *
 * Called from `invalidateTasksColumnTrees` — and only when the invalidation
 * actually covered a mounted tree. The argument is for tests and for
 * events with their own stamp; the current time by default.
 */
export function markTasksColumnTreeEvent(at: number = Date.now()): void {
  if (at > lastEventAt) lastEventAt = at;
}

/** Clock reading (0 means no events yet). */
export function tasksColumnTreeClock(): number {
  return lastEventAt;
}

/**
 * Whether a response REQUESTED at `requestedAt` is stale.
 *
 * Precisely the requested moment, not the received one: a response sent BEFORE the event and
 * arrived AFTER it knows nothing about the change, and by the arrival
 * moment it would wrongly look fresh.
 */
export function isStaleAgainstTasksColumnTreeClock(
  requestedAt: number | null | undefined,
): boolean {
  if (requestedAt === null || requestedAt === undefined) return true;
  return requestedAt < lastEventAt;
}

/**
 * Clock reset. FOR TESTS ONLY: the state is module-level and survives
 * unmounting, so without a reset tests would affect each other.
 */
export function resetTasksColumnTreeClockForTests(): void {
  lastEventAt = 0;
}
