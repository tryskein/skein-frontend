/**
 * The id ordering rule — ONE strict total order for the server and the frontend.
 *
 * The source of truth is US-6 of the spec, seven
 * items; the server half lives in `internal/issues/tree.go`
 * (`compareIssueID`). Both sides are checked against one literal list (the
 * "Reference id sample" appendix) — the match of two literals
 * is SC-004. The list is deliberately NOT derived from the implementation: a test
 * that checks the implementation against itself would agree with any of its mistakes.
 *
 * ─── Seven items ───────────────────────────────────────────────────
 *
 *   1. the id is split into segments by `-` and `.`; consecutive or edge
 *      separators give EMPTY segments (`sk--1` → `sk`, ``, `1`);
 *   2. segments are compared left to right, the first differing one decides;
 *   3. two numeric segments — by numeric value of ANY length, with
 *      equal values the shorter notation comes first (`1` before `01`);
 *   4. a numeric segment comes before any non-numeric one; non-numeric means
 *      an empty segment or a segment with at least one non-digit character;
 *   5. two non-numeric ones — bytewise, an empty one before any non-empty one;
 *   6. all common segments are equal → the id with fewer segments comes first;
 *   7. still equal → bytewise comparison of the whole id (distinguishes only
 *      separators: `x-1` against `x.1`).
 *
 * ─── What changed here and why it is not cosmetic ──────────────────
 *
 * The previous implementation diverged from the rule in three places, and each
 * was silent:
 *
 *   • the NUMERIC VALUE was computed via `Number(s)` and subtracted. Numeric
 *     segments of a custom id can be hundreds of digits long (F-15): `Number` loses
 *     precision beyond 2^53, and segments differing in the low digits
 *     became equal. Here the comparison goes by the NOTATION — first the length
 *     without leading zeros, then bytewise — and there is nothing to overflow.
 *   • LEADING ZEROS: `2` and `002` gave `an - bn === 0`, so the comparator
 *     declared DIFFERENT ids equal. No total order exists then:
 *     the sort result depended on the input order.
 *   • an EMPTY SEGMENT was counted as non-numeric and compared lexicographically,
 *     and `'' < '2'` — so `sk--1` ended up BEFORE `sk-2`. By item 4
 *     a numeric segment comes before any non-numeric one, including an empty one,
 *     so `sk--1` stands after all `sk-<digits>`.
 *
 * Plus there was no item 7: `x-1` and `x.1` compared as equal.
 *
 * ─── Bytewise: one honest caveat ───────────────────────────────────
 *
 * Items 5 and 7 in the spec say "bytewise", and the Go server compares
 * exactly bytes. String comparison in JS goes by UTF-16 code units.
 * On ASCII — and identifiers consist of a project prefix, digits and
 * separators — these two orders coincide, and the reference list is entirely
 * ASCII. On a segment with non-ASCII characters the orders can in principle
 * diverge; there is no general promise of matching the server beyond ASCII
 * here, and presenting one as fact would be untrue.
 *
 * Used by the Tasks column (the "by id" sort key) and as a tie-break
 * on priority — both consumers delegate here and keep no rules
 * of their own (`taskSort.ts:224` and `:231`).
 */
export function compareHierarchicalId(a: string, b: string): number {
  // Item 1: empty segments are significant, hence a plain split without dropping them.
  const as = a.split(/[-.]/);
  const bs = b.split(/[-.]/);
  const n = Math.min(as.length, bs.length);

  // Item 2.
  for (let i = 0; i < n; i++) {
    const c = compareSegment(as[i], bs[i]);
    if (c !== 0) return c;
  }

  // Item 6.
  if (as.length !== bs.length) return as.length < bs.length ? -1 : 1;

  // Item 7.
  if (a !== b) return (a < b ? -1 : 1);
  return 0;
}

function compareSegment(a: string, b: string): number {
  const aDigit = isDigitSegment(a);
  const bDigit = isDigitSegment(b);

  if (aDigit && bDigit) {
    // Item 3. The value is compared by notation without leading zeros: first
    // the length (a longer notation is the larger number), then bytewise with
    // equal length. A machine number is not involved — nothing to overflow.
    const ta = trimLeadingZeros(a);
    const tb = trimLeadingZeros(b);
    if (ta.length !== tb.length) return ta.length < tb.length ? -1 : 1;
    if (ta !== tb) return ta < tb ? -1 : 1;
    // Values are equal → the shorter NOTATION comes first: `1` before `01`.
    if (a.length !== b.length) return a.length < b.length ? -1 : 1;
    return 0;
  }

  // Item 4: numeric before any non-numeric, including an empty one.
  if (aDigit !== bDigit) return aDigit ? -1 : 1;

  // Item 5: bytewise; empty before non-empty — a property of string
  // comparison itself, no separate branch needed.
  if (a !== b) return a < b ? -1 : 1;
  return 0;
}

/** A non-empty segment of digits only. An empty segment is NOT numeric. */
function isDigitSegment(s: string): boolean {
  if (s.length === 0) return false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 48 || c > 57) return false;
  }
  return true;
}

/** `000042` → `42`; `000` → `` (a zero notation collapses to empty). */
function trimLeadingZeros(s: string): string {
  let i = 0;
  while (i < s.length && s.charCodeAt(i) === 48) i++;
  return s.slice(i);
}
