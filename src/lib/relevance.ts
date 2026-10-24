/**
 * sk-53 — RRF relevance score → display helpers for the search-only
 * relevance badge on Tasks-column cards.
 *
 * The score is the raw RRF value from `/api/v1/search` (vector + FTS
 * fusion, `SUM(1/(k+vec_rank) + 1/(k+fts_rank))`, k=60). We map it to a
 * percent using an ABSOLUTE calibration, NOT relative to the page top —
 * a relative-to-top scheme would paint the strongest row of a weak
 * result set as 100% even when nothing really matched (the alpha-24
 * case). Absolute calibration lets a weak top row read honestly low.
 */

/** RRF dampening constant — mirrors `rrfK` in skein-api `internal/search/store.go`. */
export const RRF_K = 60;

/**
 * Theoretical RRF ceiling: a row ranked #1 by BOTH retrievers (vector +
 * FTS) scores `2 × 1/(k+1)`. Used as the 100% anchor. Observed in prod:
 * strong literal matches ~0.030 → ~90%+, weak semantic ~0.015 → ~45%,
 * noise <0.008 → <25%.
 */
export const RELEVANCE_MAX = 2 / (RRF_K + 1); // ≈ 0.03279

/**
 * Map an absolute RRF score to an integer percent in 0..100. Clamped at
 * the top so a score at/above the theoretical ceiling reads 100%, and at
 * 0 for non-positive / non-finite input.
 */
export function relevancePercent(score: number): number {
  if (!Number.isFinite(score) || score <= 0) return 0;
  const ratio = Math.min(1, score / RELEVANCE_MAX);
  return Math.round(ratio * 100);
}

/** Bar width used by every call site in the app (badge on Tasks cards). */
const DEFAULT_BAR_WIDTH = 6;

/**
 * Every possible bar at the default width, indexed by filled-cell count
 * (0..DEFAULT_BAR_WIDTH). Immutable strings, built once at module load —
 * the badge renders once per visible card, and the seven outcomes never
 * change. Non-default widths fall through to the generic path below.
 */
const DEFAULT_BARS: readonly string[] = Array.from(
  { length: DEFAULT_BAR_WIDTH + 1 },
  (_, filled) =>
    '█'.repeat(filled) + '░'.repeat(DEFAULT_BAR_WIDTH - filled),
);

/**
 * Mini ASCII bar (terminal aesthetic), `width` chars, filled
 * proportional to percent. Pairs with the numeric `NN%`.
 */
export function relevanceBar(percent: number, width = DEFAULT_BAR_WIDTH): string {
  const p = Math.max(0, Math.min(100, percent));
  const filled = Math.round((p / 100) * width);
  if (width === DEFAULT_BAR_WIDTH) {
    const cached = DEFAULT_BARS[filled];
    // Miss (a non-integer / non-finite `percent`) falls through to the
    // generic path, so behaviour for junk input is bit-for-bit unchanged.
    if (cached !== undefined) return cached;
  }
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled));
}

/**
 * Brand-intensity opacity for the badge: faint (low relevance) → full
 * (high). Floored at 0.45 so the low end stays legible. The badge text +
 * bar are coloured `var(--primary)`; opacity carries the intensity ramp.
 */
export function relevanceOpacity(percent: number): number {
  const p = Math.max(0, Math.min(100, percent));
  return 0.45 + 0.55 * (p / 100);
}
