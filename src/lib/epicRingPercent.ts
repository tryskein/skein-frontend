/**
 * sk-421.3 T18 (PL-6, US-7 acceptance "edges do not lie", SC-013, m-16) —
 * the rule for PRINTING the percentage inside the epic section header ring.
 *
 * ─── Why a separate rule, when there is rounding ──────────────────
 *
 * The percentage inside the ring is the FIRST place where rounding reaches the
 * screen: before this feature it only set the bar width and could not
 * err. The server is deliberately built so that the number of done ones does not become equal
 * to the counted ones while an unclosed invisible child is alive:
 * the invisible one goes into `unavailable` but does not leave the DENOMINATOR.
 * Ordinary rounding would zero out this property at the most visible place
 * of the card, and in both directions at once:
 *
 *   · `Math.round(199 / 200 * 100)` = `Math.round(99.5)` = **100** —
 *     "all done" for an epic with a live unclosed counted task;
 *   · `Math.round(3 / 1000 * 100)` = `Math.round(0.3)` = **0** —
 *     "not started" for an epic where three tasks are already done.
 *
 * So `100` is printed if and only if `done` has reached the
 * DENOMINATOR, and `0` if and only if `done` is zero.
 * Everything between is clamped to `1…99`: the edge is occupied by the exact answer and
 * must not be pretended.
 *
 * [sk-489 T015] The rule is stated in `done` / `denominator`, not in
 * `closed` / `total`, and this is not a rename: with INV-5 a task closed without
 * work drops out of the DENOMINATOR, so "all closed" and
 * "all counted are done" are different claims, diverging exactly by
 * the dropped ones. The previous edition of this line contradicted the "Terms"
 * section three paragraphs below; found by the wave F/2 review (both critics
 * independently — by `epicRingPercent.test.ts`, where 2 of 2 are closed and
 * there is nothing to print).
 *
 * ─── What does NOT live here, and this is the essence of m-16 ──────
 *
 * The arc widths. The arcs draw the MAGNITUDE and take the exact share — there is nothing
 * for them to round, and they do not know this function. The duplication m-16 fears
 * does not arise precisely because the printing rule lives in one place and
 * does not touch the geometry. Clamp the share together with the text — and the
 * duplication would happen in the opposite direction: the arc at 199/200 would become
 * shorter than it actually is.
 *
 * ─── Terms ─────────────────────────────────────────────────────────
 *
 * The denominator is the PROGRESS DENOMINATOR of the summary (`countedChildren`, and on
 * an old api response — the former total), not "counted children". The counted ones
 * are the total PLUS the standing ones, and this number stands in the section header;
 * they need not match. `100` means "all counted
 * children are done", not "no unclosed rows are left on screen".
 *
 * ─── sk-489 T015 (US-5, INV-5): the input is the result of the numbers rule ───
 *
 * The function takes `ProgressNumbers` AS A WHOLE, not a pair of numbers, and this is
 * a guard, not a convenience. A `(number, number)` pair accepted any two
 * fields of the summary, including `closedChildren` / `totalChildren` — exactly the
 * pair the feature removes from progress: the share must be computed from the
 * denominator where the dropped ones are already subtracted (INV-5). After the input change
 * such a call does not build, and a place that bypassed `progressNumbers`
 * becomes a compile error, not a silently wrong number on screen.
 */

import type { ProgressNumbers } from './progressNumbers';

/**
 * What to print inside the ring, or `null` if there is nothing to print.
 *
 * `null`, not an empty string: "nothing to print" and "print an empty value" are
 * different claims, and the caller must tell them apart when deciding whether
 * to draw the element at all.
 *
 * @param progress the summary progress numbers — `lib/progressNumbers.ts`
 */
export function ringPercentText(progress: ProgressNumbers): string | null {
  const { done, denominator } = progress;

  // Nothing to divide by: the share does not exist, and "0" would claim that
  // nothing is done out of something. An epic whose ALL counted children dropped out
  // also arrives here: the ring is empty, and the text saying that no task is
  // counted in the progress is printed by the caller.
  if (denominator <= 0) return null;

  // Both edges are EXACT answers, and they must not be occupied by an approximation.
  if (done >= denominator) return '100';
  if (done <= 0) return '0';

  // Everything else is rounding clamped between the edges: `99.5` may not
  // become `100`, nor `0.3` zero.
  const rounded = Math.round((done / denominator) * 100);
  return String(Math.min(99, Math.max(1, rounded)));
}
