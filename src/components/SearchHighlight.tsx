import { CSSProperties, useMemo } from 'react';
import DOMPurify from 'dompurify';

/**
 * SearchHighlight renders a `ts_headline()` snippet that may carry inline
 * `<b>...</b>` tags around matched terms. The HTML originates server-side
 * from PostgreSQL and is not under our control on a per-character basis,
 * so it MUST be sanitized client-side before going through React's
 * `dangerouslySetInnerHTML`.
 *
 * Why DOMPurify: a single allowlist rule (`<b>` only, no attributes) is
 * the smallest blast radius we can give the HTML pipeline. Anything else
 * in the snippet — `<script>`, `<img>`, `<style>`, on-* handlers — is
 * stripped before the browser ever sees it.
 *
 * The `<b>` tag inside `.skein-highlight` gets the orange accent colour
 * via global CSS so the highlight reads as part of the terminal palette
 * rather than the browser default `font-weight: bold`.
 */
export interface SearchHighlightProps {
  /** Server-rendered ts_headline HTML. May be empty, may contain `<b>` tags. */
  html: string;
  className?: string;
  style?: CSSProperties;
}

// Strict allowlist: `<b>` only, no attributes. We intentionally do NOT
// set USE_PROFILES — that flag enables DOMPurify's full HTML profile
// (~80 tags incl. <a>, <img>, <form>) and silently overrides
// ALLOWED_TAGS/ALLOWED_ATTR. KEEP_CONTENT preserves the text inside
// stripped tags so a malicious payload still renders as plain text
// rather than disappearing entirely.
const SANITIZE_CONFIG = {
  ALLOWED_TAGS: ['b'],
  ALLOWED_ATTR: [] as string[],
  KEEP_CONTENT: true,
};

export function SearchHighlight({ html, className, style }: SearchHighlightProps) {
  const sanitized = useMemo(
    () => DOMPurify.sanitize(html ?? '', SANITIZE_CONFIG),
    [html],
  );

  return (
    <span
      className={['skein-highlight', className].filter(Boolean).join(' ')}
      style={style}
      // Sanitized via DOMPurify allowlist (`<b>` only). React's
      // dangerouslySetInnerHTML is safe given the prior sanitization.
      dangerouslySetInnerHTML={{ __html: sanitized }}
    />
  );
}
