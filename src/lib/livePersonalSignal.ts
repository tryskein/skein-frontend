/**
 * Reaction of a VISIBLE tab to the personal signal (spec sk-622.21 US-11,
 * US-13; plan T042, K18 rows "Signal `inbox` … `projects`").
 *
 * The signal (`signal` client method, {@link PersonalSignal}) carries no
 * data — only the personal areas whose content may have changed for this
 * user. Each area re-reads exactly its keys; the header counters and the
 * personal queues are moved by signals only, never by project events
 * (`liveEventInvalidation.ts`).
 *
 * Resets go through the same coalescing batcher as events (window 1.5 s,
 * `liveInvalidationBatcher.ts#LIVE_INVALIDATION_WINDOW_MS`), and the
 * default `refetchType: 'active'` gives the matrix's «if open» / «if
 * visible»: the Watching column re-reads only while it is mounted.
 *
 * Not here: the hidden tab (T043), the 60 s safety net (T045), keeping the
 * Inbox card accepted in this tab (T046).
 */

import type { PersonalSignal } from './eventEnvelope';
import { isLensSegment, tasksListInfo } from './liveEventInvalidation';
import type { LiveInvalidationTarget } from './liveInvalidationBatcher';
import { projectsListQueryKey } from './projectHandleCache';
import { MY_SPACES_QUERY_PREFIX } from './useMySpaces';

/**
 * sk-674.18 T053 — prefixes of the invitation reads the area `spaces`
 * resets: the addressee's own invitations (`/me/invitations`, Inbox cards)
 * and every space's invitations and settings (`['spaces', …]`). Readers of
 * those routes key their queries under these prefixes.
 */
export const MY_INVITATIONS_QUERY_PREFIX = ['me', 'invitations'] as const;
export const SPACES_QUERY_PREFIX = ['spaces'] as const;

/** Header counters (`useNotificationCounts.ts`). */
const COUNTS_KEY = ['notification-counts'] as const;

/**
 * Apply one personal signal. Unknown areas are ignored (the set is open
 * for forward-compat); a malformed frame does nothing.
 */
export function invalidateForSignal(qc: LiveInvalidationTarget, signal: PersonalSignal): void {
  const areas = readAreas(signal);
  for (const area of areas) {
    switch (area) {
      case 'inbox':
        qc.invalidateQueries({ queryKey: COUNTS_KEY });
        qc.invalidateQueries({ queryKey: ['inbox'] });
        // sk-674.18 T054 — the invitation cards of Inbox: a confirmed email
        // turns "Accept" on in the open tab without a reload (screens 1.3).
        qc.invalidateQueries({ queryKey: MY_INVITATIONS_QUERY_PREFIX });
        break;
      case 'mentions':
        qc.invalidateQueries({ queryKey: COUNTS_KEY });
        qc.invalidateQueries({ queryKey: ['mentions', 'feed'] });
        break;
      case 'watching':
        qc.invalidateQueries({ queryKey: COUNTS_KEY });
        qc.invalidateQueries({ queryKey: ['watching'] });
        break;
      case 'lens':
        qc.invalidateQueries({ queryKey: COUNTS_KEY });
        // The lenses of the projects column, while a lens is on: the
        // projects list with a lens and the component lists with a lens.
        qc.invalidateQueries({
          predicate: (q) => {
            const key = q.queryKey;
            return (
              key[0] === projectsListQueryKey[0]
              && key[1] === projectsListQueryKey[1]
              && key[2] === projectsListQueryKey[2]
              && key[3] === 'infinite'
              && isLensSegment(key[5])
            );
          },
        });
        qc.invalidateQueries({
          predicate: (q) =>
            q.queryKey[0] === 'components'
            && q.queryKey[1] === 'list'
            && isLensSegment(q.queryKey[3]),
        });
        break;
      case 'tasks':
        // Membership of the personal task lists — "assigned to me", "delegated",
        // "created by me": the cross-project `/me` surfaces and the project
        // lists under a lens. From the first page (K21).
        qc.invalidateQueries({
          predicate: (q) => {
            const info = tasksListInfo(q.queryKey);
            if (info === null) return false;
            if (info.kind === 'me') return true;
            return info.kind === 'project' && isLensSegment(info.lens);
          },
          firstPageOnly: true,
        });
        break;
      case 'unreviewed':
        qc.invalidateQueries({ queryKey: COUNTS_KEY });
        // Lists filtered by «unreviewed», from the first page.
        qc.invalidateQueries({
          predicate: (q) => tasksListInfo(q.queryKey)?.status === 'unreviewed',
          firstPageOnly: true,
        });
        // The open card's private review fields live on its detail.
        qc.invalidateQueries({ queryKey: ['issues', 'detail'] });
        break;
      case 'projects':
        qc.invalidateQueries({ queryKey: projectsListQueryKey, exact: true });
        qc.invalidateQueries({ queryKey: [...projectsListQueryKey, 'infinite'] });
        qc.invalidateQueries({ queryKey: ['members', 'list'] });
        break;
      case 'spaces':
        // sk-674.18 T053 (US-19, screens 1.15) — every reason: «my spaces»,
        // the projects (a space joined, left or deleted moves the project
        // set), the invitations and the counters (the Inbox badge counts
        // pending invitations). The reason itself — a toast, leaving a lost
        // place — is `accessLoss.ts`.
        qc.invalidateQueries({ queryKey: COUNTS_KEY });
        qc.invalidateQueries({ queryKey: MY_SPACES_QUERY_PREFIX });
        qc.invalidateQueries({ queryKey: projectsListQueryKey, exact: true });
        qc.invalidateQueries({ queryKey: [...projectsListQueryKey, 'infinite'] });
        qc.invalidateQueries({ queryKey: ['members', 'list'] });
        qc.invalidateQueries({ queryKey: MY_INVITATIONS_QUERY_PREFIX });
        qc.invalidateQueries({ queryKey: SPACES_QUERY_PREFIX });
        break;
      default:
        break;
    }
  }
}

/** The distinct string areas of a frame; empty for a malformed one. */
function readAreas(signal: PersonalSignal | null | undefined): Set<string> {
  const out = new Set<string>();
  const raw: unknown = signal?.areas;
  if (!Array.isArray(raw)) return out;
  for (const a of raw) {
    if (typeof a === 'string' && a.length > 0) out.add(a);
  }
  return out;
}
