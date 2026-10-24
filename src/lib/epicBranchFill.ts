/**
 * sk-421.3 T14a (PL-6a, US-5 acceptance "segment edges do not lie") — the rule
 * for the SIZE of the progress segment of a nested epic's branch.
 *
 * ─── Why this is NOT `ringPercentText` and cannot be ─────────────
 *
 * The neighbour (`epicRingPercent.ts`) is a PRINTING rule: in the header ring the edge
 * is taken by TEXT, and there the printed number is clamped to 1…99, while the geometry
 * of the arcs stays an exact share. The branch has no text at all: the only
 * carrier of meaning here is the segment width itself. So clamping IT
 * after the ring's model is forbidden — that is exactly the duplication
 * `m-16` and the neighbour's docblock warn against ("clamp the share along with the text —
 * and the arc at 199/200 would become shorter than it is"). A shared name for two
 * rules would merge printing with geometry; hence a separate module alongside, not
 * a branch inside the neighbour.
 *
 * ─── What was wrong ───────────────────────────────────────────────
 *
 * The first implementation took `Math.round((closed / total) * 100)` and
 * put THE SAME number into `width`. The rounding reached the screen
 * twice — both as the size and as the only carrier of meaning:
 *
 *   · `Math.round(199 / 200 * 100)` = **100** — the bar was filled
 *     COMPLETELY for an epic with a live unclosed child, i.e. the STYLING
 *     claimed completeness of a branch, which the neighbouring US-5 acceptance
 *     "meaning of numbers" forbids in so many words;
 *   · `Math.round(1 / 1000 * 100)` = **0** — an empty bar where
 *     the work is done.
 *
 * ─── The rule: two edges, an exact share between them ──────────────
 *
 * Full fill happens IF AND ONLY IF `done >=
 * denominator`; with `done > 0` the width is non-zero; everything between is an exact
 * share, WITHOUT rounding to whole percents.
 *
 * [sk-489 T016] The names `done` / `denominator` here are those the module
 * actually reads. The previous edition held the rule in `closed` /
 * `total`, and after INV-5 that became not an outdated synonym but a LIE on
 * a whole class of inputs: for a row `{closed: 3, total: 4, done: 3,
 * counted: 3, noWork: 1}` the condition `closed >= total` is false, yet the fill
 * is full — "if and only if" failed in both directions.
 * Found by the wave F/2 review (the critic self, by probing this very input).
 *
 * A non-zero width at `done > 0` comes here not from a clamp but from
 * construction: the exact share of a positive `done` is positive by itself.
 * A clamp from below (as in printing) would add a second rule where arithmetic
 * suffices, and would diverge from it at the first edit.
 *
 * There is no rounding at all, and this is the essence of the rule, not thrift: ANY
 * rounding to a fixed precision brings back the same defect at
 * its own scale — to whole numbers it arrives at 199/200, to hundredths at
 * 24999/25000. An exact share does not lie on any input.
 */

import type { ProgressNumbers } from './progressNumbers';

/**
 * The fill share of a branch segment in percent, or `null` if there is no segment.
 *
 * `null`, not `0`: "there is no segment" and "the segment is empty" are different claims.
 * A zero denominator means the former (nothing to divide by), and the caller uses
 * this value to decide whether to draw the element at all — the US-5 "boundary" acceptance
 * forbids empty space in place of the segment.
 *
 * A number, not a string with a percent: the unit of measure belongs to the place
 * of use (`width: N%`), and the rule owns the magnitude.
 *
 * sk-489 T016 (US-6, INV-5) — the input became the result of `progressNumbers`, and
 * for the same reason `ringPercentText`'s input did: a `(number, number)`
 * pair accepted `closed` / `total` — exactly the pair progress is moving away from —
 * and a place that computed the share bypassing the denominator
 * would stay green for the compiler. Now it does not build.
 *
 * A row whose counted children ALL dropped out arrives here with
 * a zero denominator and gets no segment — the numbers on it are replaced by the word
 * "no work", and there is nothing to draw an empty bar next to it for.
 *
 * @param progress the row progress numbers — `lib/progressNumbers.ts`
 */
export function branchFillPercent(progress: ProgressNumbers): number | null {
  const { done, denominator } = progress;

  // Nothing to divide by — there is no segment.
  if (denominator <= 0) return null;

  // The upper edge is EXACT and is taken only by the truth: a full fill
  // means "all counted children are done", and one cannot approach it.
  // `>=`, not `===`: a summary with `done` greater than the denominator is data we
  // do not invent, but we will not draw a segment longer than the bar either.
  if (done >= denominator) return 100;

  // The lower edge: no work done — the segment is empty. A negative
  // `done` goes here too, there is no negative width.
  if (done <= 0) return 0;

  // Between the edges — an exact share. Neither `Math.round` nor `toFixed`: see
  // the docblock, any precision brings the defect back at its own scale.
  return (done / denominator) * 100;
}
