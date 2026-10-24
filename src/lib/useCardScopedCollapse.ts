/**
 * sk-421.3 T15a (PK-3, INV-12, SC-016) — the collapsed state of "Tree" nodes,
 * owned by the CARD.
 *
 * ─── What is stored here and why not in the tree ──────────────────
 *
 * The set of collapsed nodes must survive switching
 * "Tree → List → Tree" while the card is open, while the internal
 * state of the tree dies with it. So the state lives with the
 * section, and the hook is here, next to the rest of the section's memory
 * (`useEpicSectionMode`, `useEpicSectionGrouping`).
 *
 * ─── Why a reset, and why it is EXPLICIT ──────────────────────────
 *
 * The earlier argument — "the section is remounted for every new card,
 * so "fully expanded on every open" holds by itself" — WAS
 * WRONG: the detail panel is rendered without a `key`, and a change of the card identity does not
 * remount the section, only the prop changes. It held because of a
 * MISMATCH of node identifiers of different epics — another card's collapsed state
 * simply matched nothing. The mismatch was an accident, while mass
 * collapsing (T16) puts the identifiers of ALL tree nodes into the set
 * and makes the match systematic.
 *
 * ─── Why NOT `useEffect`, and this is the essence of T15a ──────────
 *
 * A reset in a passive effect runs AFTER the frame is painted. On a direct
 * "epic → epic" transition, when the new card's tree is already in the query
 * cache, the first frame managed to paint the NEW rows against the OLD
 * set of collapsed nodes — one frame of another card's collapsed state on screen. The SC-016
 * requirement reads "opening a card of another epic SHOWS its tree
 * fully expanded", and such a frame formally contradicts it.
 *
 * So the reset is computed IN THE RENDER PHASE, by comparison with the previous
 * identifier: a card change is noticed on the same render in
 * which it arrived, and an ALREADY empty set goes out. A frame with another
 * card's collapsed state does not exist at all — not "it is short", but it is absent.
 *
 * `useLayoutEffect` would solve the visible half (the browser would not have time to
 * show the frame), but the frame would still BE PAINTED, and there would be nothing to check
 * its absence with. Here the absence is observable: the value
 * the hook returned on the very first render of the new card is the empty
 * set, and this is exactly what the check guards.
 *
 * ⚠ `next` is returned, not `collapsed`: on the render where the card
 * changed, the state still holds the old set (the request to change it
 * React executes on the next pass), and handing it out would mean
 * handing out that very foreign collapsed state. The difference between these two names is
 * the whole fix — do not mix them up.
 */

import { useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

/**
 * One empty set for all resets.
 *
 * Not recreated: React compares the reference and
 * skips an extra render, and the caller may compare the received set by
 * identity.
 */
const EMPTY: ReadonlySet<string> = new Set<string>();

/**
 * The set of collapsed nodes, reset when the card changes.
 *
 * @param cardId identifier of the card that owns the collapsed state
 */
export function useCardScopedCollapse(
  cardId: string,
): readonly [ReadonlySet<string>, Dispatch<SetStateAction<ReadonlySet<string>>>] {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(EMPTY);
  const [seenCard, setSeenCard] = useState(cardId);

  // Comparing with the previous identifier in the render phase is the technique by which
  // React prescribes adjusting state to a prop change. Both
  // calls are made BEFORE the return: React will notice them immediately and re-render
  // without committing the intermediate result.
  let next = collapsed;
  if (seenCard !== cardId) {
    setSeenCard(cardId);
    next = EMPTY;
    // The empty set is not recreated: on a card opened with an already
    // expanded tree there is nothing to change in the state.
    if (collapsed !== EMPTY) setCollapsed(EMPTY);
  }

  return [next, setCollapsed] as const;
}
