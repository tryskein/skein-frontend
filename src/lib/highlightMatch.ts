/**
 * Wrap matched substrings in `<b>` tags for SearchHighlight to render
 * as yellow highlights. Case-insensitive, leftmost-greedy, escapes
 * regex metacharacters in the user-supplied query so a query like
 * `(`, `*`, `+` doesn't blow up the regex compiler.
 *
 * HTML-escapes the surrounding text — without this, content containing
 * literal `<` or `&` would slip through to the DOMPurify pass and
 * render mis-encoded. Only `<b>` markup is authorised by SearchHighlight,
 * so all other special chars must be escaped before they hit the
 * sanitizer.
 *
 * **Contract:** the returned HTML string MUST only be rendered via
 * `SearchHighlight` (or an equivalent path that runs DOMPurify with the
 * same allow-list). Do not inject into `dangerouslySetInnerHTML` bare,
 * and do not extend the generator to emit other tags — the sanitizer
 * gate is the only safety net for XSS from title/description text.
 *
 * Used by ProjectRow, TaskCard, TaskTreeNode (and previously duplicated
 * across all three).
 */
export function highlightMatch(text: string, query: string): string {
  const escapeHtml = (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  if (!query) return escapeHtml(text);

  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(${escaped})`, 'gi');
  // Split keeps the matched groups intact so we can wrap each one.
  return text
    .split(re)
    .map((part, idx) => {
      const isMatch = idx % 2 === 1;
      const escapedPart = escapeHtml(part);
      return isMatch ? `<b>${escapedPart}</b>` : escapedPart;
    })
    .join('');
}
