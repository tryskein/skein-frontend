/**
 * sk-551.8 — "expansion by address": telling a deliberate move to a queue
 * apart from every other way the shell can show `?tab=` (spec "Concepts",
 * US-12; plan P3, P12, "Decision on the fork", variant (a)).
 *
 * A deliberate move opens the sections column and its Queues section; the
 * following do NOT, even with `?tab=` in the address: a page refresh, a
 * return to the shell from `/activity`, `/search`, `/settings/*` by
 * ordinary navigation, Back/Forward, a restored or duplicated tab, a new
 * sign-in. No single signal separates them, so each source is a
 * conjunction:
 *
 *   (a) the INITIAL LOAD of the document by a link or the address bar —
 *       `readInitialLoadIntent`: Navigation Timing says `navigate`, the
 *       router is on its initial entry (`key === 'default'`), it is the
 *       first ask in this document, and this tab's `sessionStorage` has
 *       not already seen this very href. The last one is the guard against
 *       the browsers that copy the source tab's navigation type into a
 *       duplicate (and against session restore): `sessionStorage` is
 *       copied with the tab and survives a restore, so the href that
 *       already opened the column once does not open it again. Its
 *       accepted cost: typing the IDENTICAL address again in the same tab
 *       does not open the section again (plan, Known residuals).
 *
 *   (b) a deliberate move INSIDE the app — `isIntentNavigation`: a PUSH
 *       whose `location.state.queueReveal` carries a one-shot nonce this
 *       shell has not handled yet. The nonce is planted only by the
 *       targeted actions (`withReveal`: a queue badge on a page without
 *       the column, choosing another queue), and every OTHER carry of
 *       `location.state` goes through `carryState`, which cuts it out —
 *       so an ordinary move never inherits it. A POP is never a move of
 *       this kind, nonce or not.
 *
 * Pure functions and module state only; the subscriber that calls them is
 * the layout provider's (plan P12), and it runs only with the sections
 * layout active.
 */
import { NavigationType } from 'react-router-dom';
import { TAB_PARAM } from './shellUrlState';

/** The `location.state` field that carries the one-shot nonce. */
export const QUEUE_REVEAL_STATE_KEY = 'queueReveal';

/** sessionStorage key: the href whose initial load already opened the column. */
export const INITIAL_REVEAL_HREF_KEY = 'skein.nav.address-reveal-href';

/** Set once the first ask in this document has been answered. */
let initialLoadAsked = false;

/** The document's nonce counter — unique within this document. */
let lastNonce = 0;

/** The current document's Navigation Timing type, or `null` when unknown. */
function documentNavigationType(): string | null {
  try {
    const entries = performance.getEntriesByType('navigation');
    const first = entries[0] as PerformanceNavigationTiming | undefined;
    return typeof first?.type === 'string' ? first.type : null;
  } catch {
    return null;
  }
}

/**
 * Source (a). `true` at most ONCE per document, and only when every part
 * of the conjunction holds:
 *
 *   - this is the first ask in this document (a later shell mount — a
 *     second SPA entry — is not the initial load);
 *   - `locationKey` is the router's initial entry (`'default'`);
 *   - Navigation Timing says `navigate` (not `reload`, `back_forward`,
 *     `prerender`, nor unknown);
 *   - the address names a queue (`?tab=`);
 *   - this tab's `sessionStorage` has not recorded the current href as
 *     already revealed; when it says yes, the href is recorded.
 *
 * When `sessionStorage` is unavailable the guard cannot run and the first
 * three parts decide alone.
 */
export function readInitialLoadIntent(locationKey: string): boolean {
  if (initialLoadAsked) return false;
  initialLoadAsked = true;
  if (locationKey !== 'default') return false;
  if (documentNavigationType() !== 'navigate') return false;
  // The spec's "opening a link with `?tab=` from outside": a load without a queue
  // in the address is not a move to a queue, and records nothing.
  if (!new URLSearchParams(window.location.search).has(TAB_PARAM)) return false;
  const href = window.location.href;
  try {
    if (window.sessionStorage.getItem(INITIAL_REVEAL_HREF_KEY) === href) return false;
    window.sessionStorage.setItem(INITIAL_REVEAL_HREF_KEY, href);
  } catch {
    /* no sessionStorage — the type and the key decide */
  }
  return true;
}

/** A fresh one-shot nonce for `queueReveal`. */
export function nextRevealNonce(): number {
  lastNonce += 1;
  return lastNonce;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * `location.state` as an ordinary move carries it over: everything kept
 * (`selfOpenedFile` and whatever else is there) except `queueReveal`. A
 * state that is not an object is passed through unchanged.
 */
export function carryState(state: unknown): unknown {
  if (!isPlainObject(state) || !(QUEUE_REVEAL_STATE_KEY in state)) return state;
  const { [QUEUE_REVEAL_STATE_KEY]: _dropped, ...rest } = state;
  return rest;
}

/**
 * `location.state` for a targeted move to a queue: the carried state plus
 * a fresh `queueReveal` nonce.
 */
export function withReveal(state: unknown): Record<string, unknown> {
  const carried = carryState(state);
  return { ...(isPlainObject(carried) ? carried : {}), [QUEUE_REVEAL_STATE_KEY]: nextRevealNonce() };
}

/** The nonce on a state, or `null` when there is none. */
export function readRevealNonce(state: unknown): number | null {
  if (!isPlainObject(state)) return null;
  const nonce = state[QUEUE_REVEAL_STATE_KEY];
  return typeof nonce === 'number' && Number.isFinite(nonce) ? nonce : null;
}

/**
 * Source (b): a PUSH whose state carries a nonce not yet in `handled`.
 * POP and REPLACE never are — Back/Forward onto an entry that still holds
 * a nonce is not a deliberate move.
 */
export function isIntentNavigation(
  location: { state: unknown },
  navigationType: NavigationType,
  handled: ReadonlySet<number>,
): boolean {
  if (navigationType !== NavigationType.Push) return false;
  const nonce = readRevealNonce(location.state);
  return nonce !== null && !handled.has(nonce);
}
