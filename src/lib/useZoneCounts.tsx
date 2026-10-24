/**
 * sk-285.7 fidelity M1 — what the two NAVIGATION zones are holding,
 * published for the mobile tab strip.
 *
 * ─── Why this module exists ─────────────────────────────────────────
 *
 * `1g-mobile-390` draws the strip as three captioned counters —
 * «Queues 10 · Projects 5 · Tasks 49» — one number per tab. The strip
 * had one number for all three (the Tasks total), so two of the three
 * tabs were unlabelled and the surviving number sat at the far right
 * where it read as belonging to the strip rather than to a tab.
 *
 * The Tasks number already had a publisher: `useTasksOutlet`, and it has
 * to keep it. That number is LENS-DERIVED (INV-10 — `outboxMode` /
 * `onMeMode` narrow it, and the column applies per-mode corrections on
 * top), so it can only come from the one `useTasks` call that computed
 * it. The two numbers here are not:
 *
 *   · Queues is the sum of the four notification queues, and those are
 *     `user_id = caller` by construction — the root CLAUDE.md lists the
 *     header badges under "NOT needed scoping" for exactly this reason;
 *   · Projects is how many projects the caller can see, which no lens
 *     narrows.
 *
 * They are published rather than recomputed all the same, and for the
 * plainer of the two reasons `useTasksOutlet` gives: the column already
 * worked the number out, and a second derivation is a second thing to
 * keep in step. `InboxColumn` folds four counts into one total and
 * `ProjectsColumn` takes its total as a prop — re-deriving either at the
 * shell would be re-implementing it.
 *
 * ─── Why two contexts ───────────────────────────────────────────────
 *
 * The same split, and the same reason, as `useTasksOutlet`: the
 * publishers need a setter that never changes, the consumer needs a
 * value that changes on every result. One context for both would
 * re-render the publishers on every publish.
 *
 * ─── Reading `null` ─────────────────────────────────────────────────
 *
 * `null` is «this zone has not answered yet», not zero — a column that
 * is still loading, or is not mounted at all. The strip prints nothing
 * there. Zero IS printed: an empty queue set is a fact, and the column
 * headers print their own zeroes for the same reason.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/** The zones that publish here. Tasks is `useTasksOutlet`'s. */
export type CountedZone = 'queues' | 'projects';

export type ZoneCounts = Readonly<Record<CountedZone, number | null>>;

const EMPTY_COUNTS: ZoneCounts = { queues: null, projects: null };

const ValueContext = createContext<ZoneCounts>(EMPTY_COUNTS);
const PublishContext = createContext<
  ((zone: CountedZone, count: number | null) => void) | null
>(null);

/**
 * sk-551.8 — the per-queue split of the Queues total, for the sections
 * column's sliver: its accessible name speaks the total AND the split
 * (Inbox, Mentions, Watching), as the folded Queues column does today
 * (US-6). Published by `InboxColumn`, the one owner of these numbers.
 * `null` until the column has answered.
 */
export interface QueueBreakdown {
  inbox: number;
  mentions: number;
  watching: number;
}

const BreakdownValueContext = createContext<QueueBreakdown | null>(null);
const BreakdownPublishContext = createContext<((b: QueueBreakdown) => void) | null>(null);

export function ZoneCountsProvider({ children }: { children: ReactNode }) {
  const [counts, setCounts] = useState<ZoneCounts>(EMPTY_COUNTS);
  const [breakdown, setBreakdown] = useState<QueueBreakdown | null>(null);
  const publishBreakdown = useCallback((next: QueueBreakdown) => {
    setBreakdown((prev) =>
      prev !== null &&
      prev.inbox === next.inbox &&
      prev.mentions === next.mentions &&
      prev.watching === next.watching
        ? prev
        : next,
    );
  }, []);
  // Stable for the life of the provider: `setState` is, and nothing else
  // is closed over.
  const publish = useCallback((zone: CountedZone, count: number | null) => {
    setCounts((prev) =>
      // Equal by content — returning `prev` makes the publish a no-op for
      // React, so a column re-rendering on an unrelated change does not
      // re-render the strip.
      prev[zone] === count ? prev : { ...prev, [zone]: count },
    );
  }, []);
  return (
    <PublishContext.Provider value={publish}>
      <BreakdownPublishContext.Provider value={publishBreakdown}>
        <ValueContext.Provider value={counts}>
          <BreakdownValueContext.Provider value={breakdown}>{children}</BreakdownValueContext.Provider>
        </ValueContext.Provider>
      </BreakdownPublishContext.Provider>
    </PublishContext.Provider>
  );
}

/**
 * Read what the navigation zones are holding.
 *
 * Outside a provider this answers the empty counts rather than throwing:
 * the consumer is a layout surface that must render on any route, and a
 * missing provider is «no counters to show», not a crash.
 */
export function useZoneCounts(): ZoneCounts {
  return useContext(ValueContext);
}

/** sk-551.8 — the Queues split, or `null` (no provider, or not answered yet). */
export function useQueueBreakdown(): QueueBreakdown | null {
  return useContext(BreakdownValueContext);
}

/** sk-551.8 — publish the Queues split. A no-op outside a provider. */
export function usePublishQueueBreakdown(inbox: number, mentions: number, watching: number): void {
  const publish = useContext(BreakdownPublishContext);
  useEffect(() => {
    if (publish === null) return;
    publish({ inbox, mentions, watching });
  }, [publish, inbox, mentions, watching]);
}

/**
 * Publish one zone's count. Call it from the ONE component that owns
 * that zone's number; a second publisher for the same zone would make
 * the last render win, which is the drift this module removes.
 *
 * A no-op outside a provider, so each column stays mountable on its own
 * in tests.
 */
export function usePublishZoneCount(zone: CountedZone, count: number | null): void {
  const publish = useContext(PublishContext);
  useEffect(() => {
    if (publish === null) return;
    publish(zone, count);
  }, [publish, zone, count]);
}

/**
 * The three labels the strip prints, in one place so the strip does not
 * have to know that one of its numbers comes from somewhere else.
 *
 * `tasksLabel` is a STRING because the Tasks column does not always
 * print its total as itself: a search total is «rows loaded so far» and
 * the column marks that with a `+`. Passing the label through means the
 * strip and the column header can never read differently.
 */
export function zoneTabLabels(
  counts: ZoneCounts,
  tasksLabel: string | null,
): Readonly<Record<'queues' | 'projects' | 'tasks', string | null>> {
  return {
    queues: counts.queues === null ? null : String(counts.queues),
    projects: counts.projects === null ? null : String(counts.projects),
    tasks: tasksLabel,
  };
}

/** Memo-friendly wrapper for the above; the strip re-renders on identity. */
export function useZoneTabLabels(tasksLabel: string | null) {
  const counts = useZoneCounts();
  return useMemo(() => zoneTabLabels(counts, tasksLabel), [counts, tasksLabel]);
}
