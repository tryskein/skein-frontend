/**
 * sk-734 — the space that has just appeared in «my spaces», so the
 * projects column can bring it into view and light it up.
 *
 * The owner: an accepted invitation's space joins the column by name,
 * after "Personal" and the common space, and lands off screen — under the
 * toast that announced it. «Appeared» is read off the list itself, not off
 * the "Accept" click: the space accepted from the invitation email or in
 * another tab arrives here by the personal signal (`livePersonalSignal.ts`)
 * and is just as lost.
 *
 * The first answer of the list is the baseline and lights nothing — those
 * spaces were there before the person looked. A space that leaves the list
 * lights nothing either.
 */
import { useEffect, useRef, useState } from 'react';
import type { MySpace } from '../api/spaces';

/**
 * How long an arrived space blinks. The owner: 2.5 s was over before they
 * found it — it blinks for 15 s (`.space-tree-node.arrived`, ten pulses).
 */
export const ARRIVED_SPACE_HIGHLIGHT_MS = 15_000;

/**
 * The ids of `next` not in `known`. `known === null` — no list seen yet:
 * this answer is the baseline, nothing arrived.
 */
export function arrivedSpaceIds(
  known: ReadonlySet<string> | null,
  next: readonly Pick<MySpace, 'id'>[],
): string[] {
  if (known === null) return [];
  return next.filter((sp) => !known.has(sp.id)).map((sp) => sp.id);
}

/**
 * The id of the space that arrived last, held for
 * `ARRIVED_SPACE_HIGHLIGHT_MS`, else null. `items` is the list of
 * `useMySpaces` — undefined while there is none (loading, signed out), and
 * then the baseline is dropped: the next person's first list is a baseline
 * again, not a list of arrivals.
 */
export function useArrivedSpace(items: readonly MySpace[] | undefined): string | null {
  const knownRef = useRef<ReadonlySet<string> | null>(null);
  const [arrived, setArrived] = useState<string | null>(null);

  useEffect(() => {
    if (items === undefined) {
      knownRef.current = null;
      return;
    }
    const fresh = arrivedSpaceIds(knownRef.current, items);
    knownRef.current = new Set(items.map((sp) => sp.id));
    if (fresh.length > 0) setArrived(fresh[fresh.length - 1]);
  }, [items]);

  useEffect(() => {
    if (arrived === null) return;
    const timer = setTimeout(() => setArrived(null), ARRIVED_SPACE_HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [arrived]);

  return arrived;
}
