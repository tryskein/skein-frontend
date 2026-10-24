/**
 * sk-421.3 T05 (PK-1, SC-001, SC-002, INV-2, INV-4, INV-10, R-2) —
 * distribution of the epic section rows into categories.
 *
 * ─── What this is and what it is not ──────────────────────────────
 *
 * Pure logic: rows in SERVER order in, a list of categories
 * out. No rendering, no labels, no tones — the category label and
 * its colour are decided by whoever draws. Separated deliberately: the PK-1 rule
 * is proven without a stand, like `epicRowFocus` and `treeKeyboardNav`.
 *
 * ─── The row order inside a category is NOT touched ─────────────────
 *
 * No sorting at all (R-2, INV-2): the server has already returned the children by its own
 * order rule, and a second sort on the frontend could diverge from
 * it on the same data. The design draws children re-sorted by
 * number — that is a direct contradiction of the mechanism, and the requirement is stronger.
 *
 * ─── "Known to the client" — a VALUE check, not a type cast ─────────
 *
 * `IssueStatus` is a closed union, while anything can arrive on the wire:
 * the server is newer than the client, and a new status is routine for it.
 * So membership in the five values is checked at runtime
 * (`isKnownEpicChildStatus`), and `as IssueStatus` is forbidden here: it
 * would be a claim about the wire that is not there.
 *
 * The consequence everything is built for (PL-3): for an unknown
 * value `statusFill` is not called AT ALL — this module does not
 * import it. On an unknown value the map answers `--ink-2`, the same
 * tone as for `deferred` (after sk-460.9 `closed` moved to `--ink-3`,
 * and one coincidence remained instead of two), i.e. it would paint a foreign
 * status — exactly what PK-1 forbids. The category type
 * is a tagged union here for precisely this reason: a tone can only be
 * asked of the `status` branch, while `unknown`, `nostatus` and
 * `unavailable` simply have none, and one cannot forget this — it
 * does not compile.
 *
 * ─── The sum of the counters and the header numbers are DIFFERENT quantities ───
 *
 * `standing` is a full-fledged named category here, but the header summary
 * does not include standing tasks in the total (`EpicRollup`, sk-118). So
 * the sum of the category counters need not match the header numbers, and
 * INV-4 does not require it: it speaks of the number of SHOWN rows, and that
 * always matches. Recorded so that the next reader does not "fix"
 * a non-existent discrepancy.
 */

import type { IssueStatus, IssueTreeRowItem } from '../api/issues';

/**
 * The order of the named categories (PK-1, SC-002). The positions are fixed and
 * do not depend on the data composition — which is how they differ from the trailing ones.
 */
const KNOWN_ORDER: readonly IssueStatus[] = [
  'in_progress',
  'open',
  'deferred',
  'closed',
  'standing',
];

const KNOWN = new Set<string>(KNOWN_ORDER);

/** Whether the client knows this status value (a runtime check, PL-3). */
export function isKnownEpicChildStatus(value: string): value is IssueStatus {
  return KNOWN.has(value);
}

/**
 * Whether the row's task is inaccessible: a reference AND without status and type.
 *
 * Both conditions are mandatory. Referentiality alone is also a repeated
 * occurrence of a node; empty values without referentiality the server does
 * not send. The title is not part of the predicate (R-4, F-6).
 *
 * ─── Why the predicate lives HERE, not in the row (sk-464) ───────────
 *
 * It used to be declared in `EpicChildRow` — a page component — and
 * this module pulled it FROM THERE. The edge `lib → pages` was inverted: the
 * domain layer has no right to depend on the rendering layer, and together with the normal
 * edge `pages → lib` (the row asks `isKnownEpicChildStatus`) it
 * closed a cycle. The cycle was safe by initialisation order exactly until the
 * first line calling a foreign module at the top level — and would have broken
 * irreproducibly, depending on which of the two modules loaded first.
 *
 * The domain predicate also belongs to the domain by substance: it is asked by
 * FOUR places — the distribution into categories here, the row itself,
 * the selection of section rows in "Tree" and the rule for showing the blockers sub-row.
 * None of them is the owner, so the owner is `lib/`,
 * next to `epicBranchFill` and `epicRowFocus`. One direction remained.
 */
export function isUnavailableChild(
  item: IssueTreeRowItem,
  isReference: boolean,
): boolean {
  return isReference && item.status === '' && item.type === '';
}

/** The minimum the rule needs from a row: the task itself and referentiality. */
export interface EpicChildCategoryRow {
  item: IssueTreeRowItem;
  isReference: boolean;
}

/**
 * A row category. A tagged union, not a record with an
 * optional status: "unavailable" has no status, and a trailing one
 * has it, but it cannot be painted by it (see the docblock).
 */
export type EpicChildCategory<T> =
  /** A status known to the client — the only branch that can be painted. */
  | { kind: 'status'; key: string; status: IssueStatus; rows: T[] }
  /** A wire value the client does not know. Has no tone. */
  | { kind: 'unknown'; key: string; value: string; rows: T[] }
  /**
   * There is no status, and the row is not a stub (PK-1 item 4). Always
   * second to last — after the trailing ones, before "unavailable". Carries no label
   * (nothing to print) and has no tone.
   */
  | { kind: 'nostatus'; key: 'nostatus'; rows: T[] }
  /** Rows of inaccessible tasks. Always last, has no tone. */
  | { kind: 'unavailable'; key: 'unavailable'; rows: T[] };

/**
 * Rows → categories per PK-1.
 *
 * Generalising over `T` is not decoration: the caller passes its own response nodes and
 * gets back in the categories THE SAME ones, not a trimmed copy — otherwise the row
 * would have to be looked up in the input array again by identifier.
 *
 * A category with zero rows is not created by construction (P-03): a bucket
 * is created at the moment the first row lands in it, so an empty one
 * never exists — this is a property of the code, not a check on the output.
 */
export function epicChildCategories<T extends EpicChildCategoryRow>(
  rows: readonly T[],
): EpicChildCategory<T>[] {
  const known = new Map<IssueStatus, T[]>();
  // Insertion order in a Map is the order of the value's FIRST APPEARANCE in
  // the input (server) array, and that is exactly what PK-1 requires for the trailing ones.
  const unknown = new Map<string, T[]>();
  // A separate bucket, NOT the empty-value key in the table of trailing ones:
  // the "no status" position is fixed (SC-002), while a place in the table of
  // trailing ones would be determined by the first-appearance order, i.e. by the
  // data composition.
  const nostatus: T[] = [];
  const unavailable: T[] = [];

  for (const row of rows) {
    // 1. A stub. The predicate is SHARED — the same one the row, the selection of
    //    "Tree" rows and the blockers sub-row rule call: a second copy
    //    of the triple condition would diverge from the first, and a row would land
    //    in "unavailable" on one surface and not on another.
    if (isUnavailableChild(row.item, row.isReference)) {
      unavailable.push(row);
      continue;
    }

    // Widened to `string` deliberately: `IssueStatus` is a closed
    // union, while anything can be on the wire, an empty value
    // included. Comparing with `''` through the contract type is not allowed — the compiler
    // rightly says there is no overlap.
    const status: string = row.item.status;

    // 2. A status known to the client.
    if (isKnownEpicChildStatus(status)) {
      const bucket = known.get(status);
      if (bucket) bucket.push(row);
      else known.set(status, [row]);
      continue;
    }

    // 3. There is no status, and the row is not a stub — the "no
    //    status" category (PK-1 item 4).
    //
    // The branch is SEPARATE, and this is the essence of the requirement, not styling.
    // The previous edition put such a row into the table of trailing categories
    // under the empty-value key, justifying it by "a trailing
    // category is precisely a value the client does not know how to
    // handle". The argument was wrong: the place in the output would then be determined
    // by the order of FIRST APPEARANCE among unknown values, i.e. by the
    // data composition, — while SC-002 requires the opposite. "No status"
    // stands SECOND TO LAST, after all the trailing ones and before "unavailable", and
    // this position is fixed exactly like the positions of the named ones.
    //
    // The category label is LOCALISED by whoever draws, on the model of
    // "unavailable", not on the model of the status headers that print
    // the contract value (INV-1 does not extend here): there is
    // nothing to print, no value, and an empty header with a counter
    // tells the user nothing. The category carries no tone
    // (INV-6, SC-006): there is nothing and nothing to paint by.
    //
    // A caveat about likelihood: the server does not produce such rows today —
    // it sets an empty status only for stubs of inaccessible tasks. But
    // the contract does not guarantee that, and the distribution rule must
    // be complete: a row with an empty status and a non-empty type will still
    // appear on screen, and a silent disappearance from the counters
    // (INV-4) is worse than a category nobody will see.
    if (status === '') {
      nostatus.push(row);
      continue;
    }

    // 4. A status exists but is unknown to the client — a trailing category
    //    of its own value (PK-1 item 3).
    const bucket = unknown.get(status);
    if (bucket) bucket.push(row);
    else unknown.set(status, [row]);
  }

  const out: EpicChildCategory<T>[] = [];
  for (const status of KNOWN_ORDER) {
    const bucket = known.get(status);
    if (bucket) out.push({ kind: 'status', key: `status:${status}`, status, rows: bucket });
  }
  for (const [value, bucket] of unknown) {
    out.push({ kind: 'unknown', key: `unknown:${value}`, value, rows: bucket });
  }
  // Second to last: after the trailing ones, before "unavailable" (PK-1 item 4,
  // SC-002). The position is fixed and does not depend on the data composition — unlike
  // the MUTUAL order of the trailing ones, which depends on it
  // by construction.
  if (nostatus.length > 0) {
    out.push({ kind: 'nostatus', key: 'nostatus', rows: nostatus });
  }
  if (unavailable.length > 0) {
    out.push({ kind: 'unavailable', key: 'unavailable', rows: unavailable });
  }
  return out;
}
