/**
 * sk-489 (T012) — the ONE place where progress numbers are read.
 *
 * The progress rule is one for all surfaces (INV-5): ratio = "done" /
 * denominator, where denominator = total minus visible dropped. The server
 * sends both values ready-made (R-3), so there is neither subtraction
 * nor division here — only a choice between two sets of fields.
 *
 * ═══ Why the module is needed at all ═══════════════════════════════════
 *
 * The new frontend must work against an api that knows nothing about the outcome
 * (US-10, SC-010). Such an api sends neither "done" nor a denominator —
 * and "the field did not arrive" is NOT TREATED AS ZERO: zero done out of zero
 * counted is an assertion, and the old api asserted nothing. It
 * sends the old pair "closed / total", from which the ring, branch and
 * chips must show exactly what they show today.
 *
 * Hence the shape of the answer: besides the numbers — the `fromNewFields` flag,
 * by which the caller decides whether to show the "no work" tail. The tail
 * is not shown at all without the new fields (not "shown as zero").
 *
 * ⚠ `?? 0` in this module and in its callers is FORBIDDEN. It turns
 * "the api did not answer" into "counted, and there are zero of them", that is, it erases exactly the
 * difference this module was written for.
 */

import type { EpicProgress, EpicRollup } from '../api/issues';

/**
 * Progress numbers of one surface.
 *
 * `noWork` is ABSENT (not equal to zero) when the server did not
 * report the dropped ones. `noWork: 0` — it reported, and there are none: these are different assertions, and
 * the tail "no work: N" is shown only when `noWork > 0`.
 */
export interface ProgressNumbers {
  /** Numerator: children closed with the outcome "done". */
  done: number;
  /** Progress denominator: total minus visible dropped. */
  denominator: number;
  /** Visible dropped. Absent if the server did not count them. */
  noWork?: number;
  /**
   * The numbers are taken from the new outcome fields. `false` — a response of the old api, and
   * then `done`/`denominator` is the old pair "closed / total",
   * matching today's behaviour (INV-3).
   */
  fromNewFields: boolean;
}

/**
 * Progress numbers from the epic rollup (`epic`) or the row progress
 * (`epicProgress`). The two forms differ only in the spelling of the fields —
 * they have one rule, and it must be one in the code too: two copies
 * would drift apart at the first fix.
 */
export function progressNumbers(source: EpicRollup | EpicProgress): ProgressNumbers {
  // Distinguished by a field that exists only in the epic rollup. The type
  // `EpicRollup` carries `totalChildren`, `EpicProgress` — `total`;
  // no field name overlaps between the forms.
  if ('totalChildren' in source) {
    const { doneChildren, countedChildren, noWorkChildren } = source;
    if (typeof doneChildren === 'number' && typeof countedChildren === 'number') {
      return withNoWork(
        { done: doneChildren, denominator: countedChildren, fromNewFields: true },
        noWorkChildren,
      );
    }
    return {
      done: source.closedChildren,
      denominator: source.totalChildren,
      fromNewFields: false,
    };
  }

  const { done, counted, noWork } = source;
  if (typeof done === 'number' && typeof counted === 'number') {
    return withNoWork({ done, denominator: counted, fromNewFields: true }, noWork);
  }
  return { done: source.closed, denominator: source.total, fromNewFields: false };
}

/**
 * Appends `noWork` ONLY when it arrived as a number. Spreading
 * `undefined` will not do: the key would appear with the value `undefined`, and
 * `'noWork' in result` would stop distinguishing "did not arrive" from "zero".
 */
function withNoWork(
  base: { done: number; denominator: number; fromNewFields: true },
  noWork: number | undefined,
): ProgressNumbers {
  return typeof noWork === 'number' ? { ...base, noWork } : base;
}

/**
 * sk-540.3 — which caption a compact progress surface (the list card
 * chip, the tree `progress` cell, the epic section's branch row) prints.
 *
 * The three surfaces word their captions differently, but the choice
 * between the forms is one rule and lives here, next to the numbers it
 * reads:
 *
 * - `allExcluded` — the denominator is zero AND children were excluded
 *   from scope (closed as won't do / duplicate / superseded). A bare
 *   "0/0" would read as "no children at all", so the surface prints the
 *   excluded count instead of the pair.
 * - `done` — the outcome numbers are present. `excluded` carries the
 *   count of children excluded from scope when it is above zero, and is
 *   `null` otherwise (zero, or not reported): the tail is hidden at zero
 *   by the maintainers' decision, and a count the server did not send is never
 *   shown as 0.
 * - `plain` — an api that predates close outcomes: the legacy
 *   closed/total pair, no tail (US-10).
 *
 * The ring in the epic section is NOT a caller: it keeps its own
 * arithmetic and its own tail.
 */
export type ProgressCaption =
  | { kind: 'allExcluded'; excluded: number }
  | { kind: 'done'; done: number; counted: number; excluded: number | null }
  | { kind: 'plain'; closed: number; total: number };

export function progressCaption(numbers: ProgressNumbers): ProgressCaption {
  if (!numbers.fromNewFields) {
    return { kind: 'plain', closed: numbers.done, total: numbers.denominator };
  }
  const excluded =
    typeof numbers.noWork === 'number' && numbers.noWork > 0 ? numbers.noWork : null;
  if (numbers.denominator === 0 && excluded !== null) {
    return { kind: 'allExcluded', excluded };
  }
  return { kind: 'done', done: numbers.done, counted: numbers.denominator, excluded };
}
