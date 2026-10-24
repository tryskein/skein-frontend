/**
 * sk-41 — single source of truth for "which attachment extensions does
 * the in-card viewer support?"
 *
 * AttachmentList consults this to decide whether a row click should
 * open the viewer (?file= URL) or fall back to the original download
 * flow. FileViewerPanel consults the same map to dispatch on render
 * type (markdown / plaintext / shiki-highlighted code) and to pick the
 * Shiki language name for code files.
 *
 * Anything not in this map falls through to the download behaviour —
 * no regression for PDFs, images, archives, or arbitrary binaries.
 *
 * The list is intentionally narrow: well-defined plain-text / code
 * formats only. Adding a binary or rich format here would silently
 * dump bytes into a `<pre>`.
 */

/**
 * Render kind for a viewable attachment.
 *
 *   - `markdown` → MarkdownView pipeline (markdown-it + DOMPurify + the
 *      shiki plugin once it lazy-loads).
 *   - `text` → monospace `<pre>` with no highlighting.
 *   - `code` → Shiki standalone render under the dual github-light /
 *      github-dark themes. The Shiki `lang` is the value of `language`
 *      on this object.
 */
export interface ViewableKind {
  /** Lower-case file extension WITHOUT the leading dot. */
  ext: string;
  kind: 'markdown' | 'text' | 'code';
  /** Shiki language identifier. Empty for non-`code` rows. */
  language: string;
}

/**
 * Canonical viewer registry. The shape (rather than two parallel
 * arrays) keeps the spec-defined extensions, render kind, and Shiki
 * language identifier together in one row so they can't drift apart.
 */
export const VIEWABLE_EXTENSIONS: readonly ViewableKind[] = [
  // Markdown — runs through MarkdownView (existing pipeline + shiki plugin).
  { ext: 'md', kind: 'markdown', language: '' },
  { ext: 'markdown', kind: 'markdown', language: '' },
  // Plain text — monospace <pre> without highlighting.
  { ext: 'txt', kind: 'text', language: '' },
  // Code — Shiki highlighted. Language names match the shiki bundle keys
  // (see src/lib/shiki.ts loadLang() map).
  { ext: 'json', kind: 'code', language: 'json' },
  { ext: 'yaml', kind: 'code', language: 'yaml' },
  { ext: 'yml', kind: 'code', language: 'yaml' },
  { ext: 'ts', kind: 'code', language: 'typescript' },
  { ext: 'tsx', kind: 'code', language: 'tsx' },
  { ext: 'go', kind: 'code', language: 'go' },
  { ext: 'cs', kind: 'code', language: 'csharp' },
  { ext: 'sql', kind: 'code', language: 'sql' },
];

/**
 * Extract the final dot-separated extension from a filename, lower
 * cased and without the dot. Filenames without an extension (or with a
 * leading dot only — e.g. `.env`) yield an empty string.
 *
 * Exported so tests can pin the parsing behaviour separately from the
 * extension-lookup helpers.
 */
export function extractExtension(filename: string): string {
  if (!filename) return '';
  // Strip a path prefix defensively — filenames coming through the
  // attachment API should already be bare, but the helper is exported
  // and could be reused on uploader-supplied raw strings.
  const baseStart = Math.max(filename.lastIndexOf('/'), filename.lastIndexOf('\\'));
  const base = baseStart >= 0 ? filename.slice(baseStart + 1) : filename;
  const dot = base.lastIndexOf('.');
  // A leading dot (e.g. `.env`) is not a usable extension — there is
  // no name part before it.
  if (dot <= 0 || dot === base.length - 1) return '';
  return base.slice(dot + 1).toLowerCase();
}

/**
 * Look up a filename in the viewer registry. Returns the `ViewableKind`
 * row for the file's extension, or null when the extension isn't
 * supported (caller should fall through to download behaviour).
 */
export function getViewableKind(filename: string): ViewableKind | null {
  const ext = extractExtension(filename);
  if (!ext) return null;
  for (const row of VIEWABLE_EXTENSIONS) {
    if (row.ext === ext) return row;
  }
  return null;
}

/**
 * Boolean wrapper around `getViewableKind` for call sites that only
 * need "should clicking this row open the viewer?".
 */
export function isViewableExtension(filename: string): boolean {
  return getViewableKind(filename) !== null;
}

/**
 * Cap above which the viewer refuses to render the file and shows a
 * "too large" placeholder with a download button. 2 MiB matches the
 * spec — large enough for any reasonable text artefact, small enough
 * that fetching + rendering stays snappy.
 */
export const FILE_VIEWER_MAX_BYTES = 2 * 1024 * 1024;
