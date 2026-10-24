/**
 * Inbox cards accepted in THIS tab stay on screen, dimmed, in place, until
 * the route changes (spec sk-622.21 US-14 "Inbox after acceptance", R12;
 * plan T046, K19).
 *
 * ─── Why a snapshot, not «do not re-read Inbox» ────────────────────
 *
 * Inbox is re-read by many paths: the personal signal `inbox` (sent on a
 * status change or an accept), focus and visibility, `resync` and
 * reconnect, the 60 s safety net; a status / accept EVENT of a project does
 * not touch `['inbox']` (R22). The server answers without an accepted card (Inbox
 * is «assigned to me, open, NOT accepted»), so any of them would take the
 * card the person just acknowledged out from under the pointer. Forbidding
 * the re-reads would freeze the OTHER cards too. Instead the accepted card
 * is kept as a snapshot, and every answer the column shows has the
 * snapshots laid back in at their former positions (`useInbox`'s `select`
 * — {@link applyAcceptedRetention}). Other tabs and the header counters
 * update normally: the snapshot lives in this tab only.
 *
 * ─── Lifetime ──────────────────────────────────────────────────────
 *
 *  - Taken when the accept is sent from the Inbox column
 *    (`useAcceptIssue`, `retainOnRoute`), with the card as the person saw
 *    it, `acceptedAt` set, and its position.
 *  - Dropped when the accept fails (the card is no longer accepted).
 *  - Dropped when the route changes — any change of path, whether or not
 *    the Inbox column is mounted on the new one (`/activity`, settings):
 *    {@link releaseAllAccepted} is called by `LiveNavigationRefresh`
 *    (`liveVisibility.ts`), which stays mounted on every route. Leaving
 *    and coming back to the same path therefore shows the server's list.
 *    A snapshot also remembers its route and is laid back only there: in
 *    the render that already shows the new route, before the navigation
 *    effect has run, the column must not lay it onto the new route (its
 *    `select` result would be kept until the next answer).
 *  - Belongs to the person who accepted: a snapshot remembers the signed-in
 *    identity and is laid back only for it. The column's `select` depends
 *    on the identity, so the first render after a change of identity —
 *    logout, a 401, `/me` answering another person — recomputes the list
 *    without the previous person's cards, with no Inbox read of its own.
 *    `AuthProvider` also drops the set on that change.
 *  - Dropped when access is lost (sk-674.18 US-19, review C2): the cards
 *    of a lost space, or every card when the lost project set is unknown
 *    ({@link releaseAcceptedWhere}, called by `accessLoss.ts`). The route
 *    stays the same and the next Inbox answer may equal the previous one
 *    (TanStack then keeps the old `select` result), so the release moves
 *    a revision the column's `select` depends on
 *    ({@link useAcceptedRetentionRevision}).
 *
 * Module state: one set per tab, shared by every reader of Inbox.
 */

import { useSyncExternalStore } from 'react';
import type { IssueSummary, ListIssuesResult } from '../api/issues';

interface Snapshot {
  item: IssueSummary;
  /** Position in the list as the person saw it. */
  index: number;
  /** Route (path) the card was accepted on. */
  route: string;
  /** The signed-in user who accepted it (`null` when none is known). */
  identity: string | null;
}

const snapshots = new Map<string, Snapshot>();

/** Moves on every release that must change a list already on screen. */
let revision = 0;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The revision of the snapshot set, for `useInbox`'s `select`: a release
 * of {@link releaseAcceptedWhere} re-projects the list on screen without
 * waiting for an answer that differs.
 */
export function useAcceptedRetentionRevision(): number {
  return useSyncExternalStore(subscribe, () => revision);
}

/** Keep the accepted card `item` at `index` on route `route`, for `identity`. */
export function retainAccepted(
  item: IssueSummary,
  index: number,
  route: string,
  identity: string | null,
): void {
  snapshots.set(item.id, { item, index: Math.max(0, index), route, identity });
}

/** Drop the snapshot of one card (its accept failed). */
export function releaseAccepted(id: string): void {
  snapshots.delete(id);
}

/**
 * Drop the snapshots whose card matches `lost` — the cards of a lost space
 * or project — and re-project the lists on screen.
 */
export function releaseAcceptedWhere(lost: (item: IssueSummary) => boolean): void {
  let dropped = false;
  for (const [id, s] of snapshots) {
    if (lost(s.item)) {
      snapshots.delete(id);
      dropped = true;
    }
  }
  if (!dropped) return;
  revision += 1;
  for (const l of listeners) l();
}

/** Drop every snapshot: the route changed (`LiveNavigationRefresh`). */
export function releaseAllAccepted(): void {
  snapshots.clear();
}

/**
 * Lay the snapshots of route `route` taken by `identity` back into an Inbox
 * answer: each at its former position (or at the end, if the list got
 * shorter), replacing the card's own row when the server still returns it.
 * Snapshots of another route or of another identity are not laid back. Pure: it runs as `useInbox`'s `select`, during
 * render, and changes no state. Returns `data` itself when there is nothing
 * to lay back.
 */
export function applyAcceptedRetention(
  data: ListIssuesResult,
  route: string,
  identity: string | null,
): ListIssuesResult {
  const here = [...snapshots.values()].filter((s) => s.route === route && s.identity === identity);
  if (here.length === 0) return data;

  const ids = new Set(here.map((s) => s.item.id));
  const items = data.items.filter((it) => !ids.has(it.id));
  const ordered = here.sort((a, b) => a.index - b.index);
  for (const s of ordered) {
    items.splice(Math.min(s.index, items.length), 0, s.item);
  }
  return { ...data, items };
}
