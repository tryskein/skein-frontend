/**
 * sk-489 (T012) — the task close outcome on the client: the known values,
 * their label keys and the "closed without work" predicate.
 *
 * The outcome is a separate enumerable property of a CLOSED task that answers
 * the question "how did it end". The server is the only one who validates it and who
 * computes the progress numbers from it (R-3): there is not, and must not be, a single
 * addition here. This module does exactly two things — names a value
 * with a word and says whether it belongs to "no work".
 *
 * A mirror of the server side — `close_outcome.go#IsNoWorkOutcome` and
 * `close_outcome.go#ValidCloseOutcomes` in skein-api. The set of values
 * is closed (INV-2), and a divergence from the server does not "fix" anything here:
 * a value the server does not know will not come here, and a value
 * WE do not know is printed as is (see below).
 *
 * ⚠ AN UNKNOWN VALUE is neither an error nor "done". A client that received
 * an outcome outside the four (older or newer than us) prints the string as is, without a
 * tone, and counts it neither as done nor as dropped out (INV-2, the precedent is
 * showing an unknown status). So both predicates below give false on an
 * unfamiliar string: "I do not claim".
 */

import type { DependencyList } from '../api/dependencies';
import type { CloseOutcome, KnownCloseOutcome } from '../api/issues';

/**
 * The label keys of the four outcomes — AND AT THE SAME TIME the source of the list.
 *
 * `Record<KnownCloseOutcome, …>` is chosen deliberately instead of an array of strings:
 * adding a fifth value to the `KnownCloseOutcome` union becomes
 * a TYPE ERROR here, not a silent hole in the list from which both
 * `KNOWN_CLOSE_OUTCOMES` and the modal's choice list are
 * built. A handwritten copy of the list would diverge silently — exactly the class of defect
 * the server side describes at `ValidCloseOutcomes`.
 *
 * The keys are namespaced (`details:`), because the outcome vocabulary is
 * printed by surfaces from different namespaces — the card header and the rows of
 * the epic section (`details`), the progress chips (`tasks`). One source of truth
 * is worth more than the key belonging to "its own" dictionary.
 */
const CLOSE_OUTCOME_LABEL_KEYS: Record<KnownCloseOutcome, string> = {
  done: 'details:closeOutcome.done',
  wont_do: 'details:closeOutcome.wontDo',
  duplicate: 'details:closeOutcome.duplicate',
  superseded: 'details:closeOutcome.superseded',
};

/**
 * The four known values in display order: "done" first — it is
 * preselected on closing (US-1).
 */
export const KNOWN_CLOSE_OUTCOMES = Object.keys(
  CLOSE_OUTCOME_LABEL_KEYS,
) as KnownCloseOutcome[];

/**
 * The values for which closing accepts a target (US-2). Since sk-540.2 the
 * target is REQUIRED with them — see `closeTargetRequired`.
 */
const OUTCOMES_WITH_TARGET: Record<KnownCloseOutcome, boolean> = {
  done: false,
  wont_do: false,
  duplicate: true,
  superseded: true,
};

/** The outcome belongs to the closed set of four values. */
export function isKnownCloseOutcome(
  outcome: CloseOutcome | null | undefined,
): outcome is KnownCloseOutcome {
  return (
    typeof outcome === 'string' &&
    Object.prototype.hasOwnProperty.call(CLOSE_OUTCOME_LABEL_KEYS, outcome)
  );
}

/**
 * The label key of the outcome — or `null` if the value is unknown.
 *
 * `null` here is the requirement "print as is": the caller gets no
 * key under which it could print an unfamiliar string in someone
 * else's word, and all that is left to it is to show the string itself.
 */
export function closeOutcomeLabelKey(
  outcome: CloseOutcome | null | undefined,
): string | null {
  return isKnownCloseOutcome(outcome) ? CLOSE_OUTCOME_LABEL_KEYS[outcome] : null;
}

/**
 * "Closed without work" — closed with an outcome other than "done".
 *
 * A whitelist of three values, not "anything that is not done": an unfamiliar
 * string is not dropped out (INV-2). The predicate is needed by the interface to DISTINGUISH
 * rows and labels; the progress numbers are not computed from it anywhere
 * — the server sends them (R-3).
 */
export function isNoWorkOutcome(outcome: CloseOutcome | null | undefined): boolean {
  return (
    outcome === 'wont_do' || outcome === 'duplicate' || outcome === 'superseded'
  );
}

/** The "done" outcome — exactly one value; an unfamiliar string does not count as it. */
export function isDoneOutcome(outcome: CloseOutcome | null | undefined): boolean {
  return outcome === 'done';
}

/**
 * The outcome accepts a target — "duplicate" and "superseded" (US-2).
 * An unfamiliar value does not accept a target: the interface does not
 * offer a field whose meaning we do not know.
 */
export function closeOutcomeAcceptsTarget(
  outcome: CloseOutcome | null | undefined,
): boolean {
  return isKnownCloseOutcome(outcome) ? OUTCOMES_WITH_TARGET[outcome] : false;
}

/**
 * sk-540.2 — the edge a closed issue must already carry for its outcome to
 * change to `duplicate` / `superseded` without a target: `duplicates` FROM
 * the issue (outgoing), `supersedes` TO it (incoming). Mirrors
 * `close_outcome.go#closeLinkEdge` in skein-api; the other end of the edge
 * is not constrained, and a redacted edge still counts — the server checks
 * the edge, not whether this reader may see its far side.
 */
export function hasOutcomeEdge(
  outcome: CloseOutcome | null | undefined,
  deps: DependencyList | undefined,
): boolean {
  if (!deps) return false;
  if (outcome === 'duplicate') {
    return deps.outgoing.some((e) => e.type === 'duplicates');
  }
  if (outcome === 'superseded') {
    return deps.incoming.some((e) => e.type === 'supersedes');
  }
  return false;
}

/**
 * sk-540.2 — whether the picked outcome must name a target.
 *
 * `duplicate` and `superseded` require one, with the two exceptions the
 * server makes, both for an ALREADY closed issue (`currentOutcome` given):
 * (b) the outcome does not change; (a) it changes and the matching edge
 * already exists (`hasEdge`, see `hasOutcomeEdge`). A transition into
 * closed (`currentOutcome` absent) has no exception. The server decides in
 * the end; this only keeps the form from sending what it would refuse.
 */
export function closeTargetRequired(
  outcome: CloseOutcome | null | undefined,
  current?: { currentOutcome: CloseOutcome; hasEdge: boolean },
): boolean {
  if (!closeOutcomeAcceptsTarget(outcome)) return false;
  if (!current) return true;
  if (outcome === current.currentOutcome) return false;
  return !current.hasEdge;
}
