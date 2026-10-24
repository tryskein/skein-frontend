/**
 * sk-47.2 — pure task-code extractor for the Tasks-column paste-a-blob flow.
 *
 * The Tasks search box intercepts a PASTE and pulls Skein issue ids out of
 * the pasted wall of text so the user can paste e.g. a chat transcript /
 * commit body / standup note and get clickable chips + the matched task
 * cards instead of dumping prose into a free-text search.
 *
 * A valid code is the hierarchical issue-id shape Skein uses everywhere:
 *
 *     {prefix}-{n}            sk-14, demo-2, billing-9
 *     {prefix}-{n}.{m}[.{k}]  sk-14.2, demo-2.1.3  (subtasks, any depth)
 *
 * where `prefix` is `[a-z][a-z0-9_-]*` (a project id-prefix: starts with a
 * letter, then letters / digits / `_` / `-`). The numeric tail is one or
 * more dot-separated integer segments.
 *
 * IMPORTANT — bare numbers are NOT codes. A stray `15` or `2024` in prose
 * must never be extracted: the regex requires the full `prefix-number`
 * shape, so a lone integer (no `prefix-` lead) never matches. This is the
 * single most load-bearing property of the extractor and is covered by the
 * unit tests.
 *
 * Matching is case-insensitive (we lowercase the input first), so `SK-14`
 * and `sk-14` both extract as the canonical lowercase `sk-14`. Results are
 * de-duplicated preserving first-seen order so the chip row reads in the
 * order the codes appeared in the pasted text.
 */

/**
 * Global, case-insensitive issue-code matcher.
 *
 *   \b                  word boundary so we don't match mid-token
 *   [a-z]               prefix MUST start with a letter (rejects bare `15-3`)
 *   [a-z0-9_-]*         rest of the prefix: letters / digits / _ / -
 *   -\d+                the mandatory `-<digits>` head of the numeric tail
 *   (?:\.\d+)*          zero or more `.<digits>` subtask segments
 *   \b                  trailing boundary
 *
 * The trailing `\b` after the final digit prevents partial matches like
 * `sk-14abc` leaking a `sk-14` (the `abc` is not a boundary). We run it
 * over a lowercased copy of the text so the character class can stay
 * lowercase-only while still matching uppercase input.
 *
 * Note: a fresh RegExp is constructed per call (not a module-level
 * singleton) so the stateful `lastIndex` of a `/g` regex can never leak
 * between invocations.
 */
const CODE_PATTERN = '\\b[a-z][a-z0-9_-]*-\\d+(?:\\.\\d+)*\\b';

/**
 * Extract every Skein issue code from a blob of pasted text.
 *
 * @param text raw pasted text (any case, any length)
 * @returns canonical lowercase codes, de-duplicated, in first-seen order.
 *          Empty array when the text contains no codes (the caller treats
 *          this as "not blob mode" → let the normal paste happen).
 */
export function extractIssueCodes(text: string): string[] {
  if (!text) return [];
  const lowered = text.toLowerCase();
  const re = new RegExp(CODE_PATTERN, 'g');
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of lowered.matchAll(re)) {
    const code = match[0];
    if (!seen.has(code)) {
      seen.add(code);
      out.push(code);
    }
  }
  return out;
}
