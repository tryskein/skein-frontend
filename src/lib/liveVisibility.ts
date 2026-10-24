/**
 * Visibility, focus and navigation of a live tab (spec sk-622.21 US-13,
 * US-14, SC-006; plan T043, K22 and the K18 rows "Focus/visibility/
 * navigation", "User events" — the exit obligation).
 *
 * ─── What a hidden tab does ─────────────────────────────────────────
 *
 * Nothing on the network. Events and personal signals still go through the
 * coalescing batcher, which, while `document.hidden`, turns every touched
 * query into a re-read obligation instead of a request
 * (`liveInvalidationBatcher.ts`, K22). `user.deactivated` about the
 * signed-in user is not a re-read: it leaves an EXIT obligation here.
 *
 * ─── What the return of visibility does, in this order ──────────────
 *
 *  1. The exit obligation, if any: the same `useAuth().logout()` as a
 *     visible tab would have run (K18). The session ends; the re-read
 *     obligations are NOT walked — every request after it would answer 401,
 *     and the logout re-reads the whole cache itself (`AuthContext#onSettled`).
 *
 * ─── While the exit runs: no reads ──────────────────────────────────
 *
 * From the moment the logout starts (visible tab, or the return of
 * visibility) until it ends, this connection reads nothing: the batcher is
 * disposed first, so its armed wave, the carried reads, the obligations and
 * every later reset — an event, a signal, the safety net, `resync`, focus,
 * navigation — are dropped, not sent while `POST /api/auth/logout` waits for
 * its answer. The exit obligation is lifted only by the end of the logout,
 * and it is the last thing this connection does: the logout always ends the
 * session (`onSettled` writes `null` even on failure), and the provider
 * tears the connection down with it.
 *  2. Otherwise the registry class 3 is refreshed (below), and the batcher
 *     walks its obligations at once: covered by a delivered read → dropped,
 *     a read in flight → carried until it ends, any other active query →
 *     read once. Class 3 and the obligations land in the same wave, so a
 *     query in both is read once.
 *
 * ─── Registry class 3 (R1′) — focus, visibility, navigation ─────────
 *
 * Data no event or signal keeps fresh: counters of folded rows of the
 * projects column, new rows of undeclared projects in the task lists, the
 * projects list and the members, the watchers of the open card, the info
 * of the open card about linked issues of undeclared projects, the horizon
 * fields of lists and trees. K18 row "Focus/visibility/navigation":
 *   - first page of every `['tasks', …]` list (K21);
 *   - the projects column list (`['projects','list','shell','infinite',…]`)
 *     and the lookup list `['projects','list','shell']`;
 *   - `['members','list',*]`;
 *   - the open card: `['watchers','issue',openId]`, `['deps',*,openId]`,
 *     `['issues','detail',openId]`;
 *   - the active trees (`['issues','tree',…]`).
 * Only mounted readers re-read (`refetchType: 'active'`).
 *
 * Returning to a tab fires `visibilitychange` and then `focus`; the second
 * refresh inside one coalescing window is skipped, so a return costs one
 * read per query.
 */

import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import type { Query } from '@tanstack/react-query';
import {
  documentHidden,
  LIVE_INVALIDATION_WINDOW_MS,
  type LiveInvalidationBatcher,
} from './liveInvalidationBatcher';
import { tasksListInfo } from './liveEventInvalidation';
import { releaseAllAccepted } from './inboxAcceptedRetention';

export interface LiveVisibilityController {
  /**
   * The signed-in user was deactivated (K18): log out now in a visible tab;
   * in a hidden one keep the obligation for the return of visibility.
   */
  requestLogout(): void;
  /** Refresh registry class 3 (navigation; focus and visibility call it). */
  refreshClass3(): void;
  /** Detach the listeners. */
  dispose(): void;
}

export interface LiveVisibilityOptions {
  batcher: LiveInvalidationBatcher;
  /** `useAuth().logout()`; its failure is swallowed (the session is cleared either way). */
  logout: () => Promise<unknown>;
  /** Clock for the focus de-duplication; `Date.now` by default. */
  now?: () => number;
}

/** Filters of registry class 3, through the batcher. */
function invalidateClass3(batcher: LiveInvalidationBatcher): void {
  batcher.invalidateQueries({
    predicate: (q: Query) => tasksListInfo(q.queryKey) !== null,
    firstPageOnly: true,
  });
  batcher.invalidateQueries({ queryKey: ['projects', 'list', 'shell'] });
  batcher.invalidateQueries({ queryKey: ['members', 'list'] });
  batcher.invalidateQueries({ queryKey: ['watchers', 'issue'] });
  batcher.invalidateQueries({ queryKey: ['deps'] });
  batcher.invalidateQueries({ queryKey: ['issues', 'detail'] });
  batcher.invalidateQueries({ queryKey: ['issues', 'tree'] });
}

/**
 * Attach the visibility / focus handling of one live connection. Created
 * and disposed together with the connection's batcher (`useLiveEvents.tsx`).
 */
export function createLiveVisibility(opts: LiveVisibilityOptions): LiveVisibilityController {
  const { batcher } = opts;
  const now = opts.now ?? Date.now;
  /**
   * The exit obligation: `none`; `pending` — kept by a hidden tab for the
   * return of visibility; `exiting` — the logout has started. `exiting` is
   * never left: the logout ends the session and this connection with it.
   */
  let exit: 'none' | 'pending' | 'exiting' = 'none';
  let disposed = false;
  let lastClass3At = Number.NEGATIVE_INFINITY;

  const runLogout = () => {
    exit = 'exiting';
    // No read of this connection from here on (see «While the exit runs»).
    batcher.dispose();
    opts.logout().catch(() => {});
  };

  const refreshClass3 = () => {
    if (disposed || exit !== 'none') return;
    lastClass3At = now();
    invalidateClass3(batcher);
  };

  const onVisibility = () => {
    if (disposed || documentHidden()) return;
    if (exit === 'pending') {
      runLogout();
      return;
    }
    if (exit === 'exiting') return;
    refreshClass3();
    batcher.resume();
  };

  const onFocus = () => {
    if (disposed || documentHidden() || exit !== 'none') return;
    // The return to a tab fires visibilitychange, then focus: one refresh.
    if (now() - lastClass3At < LIVE_INVALIDATION_WINDOW_MS) return;
    refreshClass3();
  };

  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('focus', onFocus);

  return {
    requestLogout() {
      if (disposed || exit === 'exiting') return;
      if (documentHidden()) {
        exit = 'pending';
        return;
      }
      runLogout();
    },
    refreshClass3,
    dispose() {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
    },
  };
}

/**
 * What a navigation (a change of route) does in a live tab. Rendered by
 * `LiveEventsProvider` inside the router, so it stays mounted on every
 * route, the shell's or not:
 *  - registry class 3 is refreshed (R1′);
 *  - the Inbox cards accepted in this tab are released (R12, K19 —
 *    `inboxAcceptedRetention.ts`), whether or not the Inbox column is
 *    mounted on the new route.
 * The first render is the initial load, not a navigation, and does nothing.
 */
export function LiveNavigationRefresh({
  controller,
}: {
  controller: { current: LiveVisibilityController | null };
}): null {
  // The path, not the query string: the shell keeps the open card and the
  // filters in the query string, and a click on a card is not a navigation.
  const { pathname } = useLocation();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    releaseAllAccepted();
    controller.current?.refreshClass3();
  }, [pathname, controller]);
  return null;
}
