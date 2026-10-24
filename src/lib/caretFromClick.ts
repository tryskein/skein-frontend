/**
 * sk-285.1.3 — "put the caret where I clicked".
 *
 * Inline-edit sections show RENDERED markdown in read mode and the RAW
 * markdown source in edit mode. When the user clicks in the middle of a
 * paragraph we want the textarea's caret to land on the same word, not
 * at the end of the field (the old behaviour — the user clicked a spot
 * and the cursor appeared somewhere else entirely).
 *
 * That needs two steps:
 *
 *   1. Which character of the RENDERED text did the pointer hit?
 *      `renderedOffsetFromPoint` asks the browser (caretPositionFromPoint
 *      / caretRangeFromPoint) and converts the (node, offset) answer into
 *      a flat offset over the container's text nodes.
 *
 *   2. Which character of the SOURCE does that correspond to?
 *      `mapRenderedOffsetToSource` walks both strings with two pointers.
 *      Rendering only ever DROPS characters (`**`, `#`, `[`…`](url)`) or
 *      reshapes whitespace, so a greedy alignment that skips unmatched
 *      source characters lands on the right word. It is an approximation
 *      by construction — an exact map would require a position-tracking
 *      markdown renderer — but the failure mode is "caret a few chars
 *      off inside the clicked word", not "caret at the far end".
 *
 * Everything here is pure except the one DOM read, so the mapping is
 * unit-testable without a layout engine (jsdom has none).
 */

/** Whitespace equivalence class — HTML collapses runs of it. */
function isWs(ch: string): boolean {
  return ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r' || ch === '\u00A0';
}

/**
 * Map an offset in the rendered text onto an offset in the markdown
 * source. Clamped into `[0, source.length]`.
 */
export function mapRenderedOffsetToSource(
  source: string,
  rendered: string,
  renderedOffset: number,
): number {
  const target = Math.max(0, Math.min(renderedOffset, rendered.length));
  if (target === 0) return 0;

  let si = 0;
  let ri = 0;
  while (ri < target && si < source.length) {
    const sc = source[si];
    const rc = rendered[ri];
    if (sc === rc || (isWs(sc) && isWs(rc))) {
      const wasWs = isWs(sc) && isWs(rc);
      si += 1;
      ri += 1;
      if (wasWs) {
        // A run of source whitespace ("\n\n" between blocks, the space
        // after "# ") renders as a single break. Swallow the rest of
        // the run so the caret lands on the next real character rather
        // than in the middle of the blank line.
        while (
          si < source.length &&
          isWs(source[si]) &&
          (ri >= rendered.length || !isWs(rendered[ri]))
        ) {
          si += 1;
        }
      }
      continue;
    }
    // Mismatch → this source character didn't survive rendering: markup
    // syntax (`*`, `#`, `[`, `](url)`) or whitespace the renderer
    // collapsed. Spend it and try again against the same rendered char.
    si += 1;
  }

  // The walk stops the instant `ri` hits the target, which can leave the
  // caret sitting just BEFORE the markup that opens the clicked word
  // ("…world |**bold**"). Step over that opener so the caret lands on
  // the word itself. Bounded: markup runs are short, and an unbounded
  // skip on a mis-aligned pair would run to the end of the field.
  const MAX_OPENER_SKIP = 8;
  const nextRendered = target < rendered.length ? rendered[target] : null;
  if (nextRendered !== null && !isWs(nextRendered)) {
    let skipped = 0;
    while (
      si < source.length &&
      skipped < MAX_OPENER_SKIP &&
      source[si] !== nextRendered &&
      !isWs(source[si])
    ) {
      si += 1;
      skipped += 1;
    }
  }
  return si;
}

type CaretPosition = { offsetNode: Node; offset: number };
type CaretDocument = Document & {
  caretPositionFromPoint?: (x: number, y: number) => CaretPosition | null;
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
};

/**
 * Flat text offset of (node, offset) inside `container`, counting only
 * the container's text nodes in document order. Returns null when the
 * node isn't inside the container.
 */
function flatTextOffset(container: HTMLElement, node: Node, offset: number): number | null {
  if (!container.contains(node)) return null;

  const walker = container.ownerDocument.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT,
  );

  if (node.nodeType === Node.TEXT_NODE) {
    let total = 0;
    let current = walker.nextNode();
    while (current) {
      const len = current.textContent?.length ?? 0;
      if (current === node) {
        return total + Math.max(0, Math.min(offset, len));
      }
      total += len;
      current = walker.nextNode();
    }
    return null;
  }

  // Element-level hit — the browser answers with (element, childIndex)
  // when the point lands on padding or between children. Flat offset of
  // the element's first text node, plus the text of the children that
  // precede childIndex.
  const el = node as Element;
  let before = 0;
  for (let i = 0; i < Math.min(offset, el.childNodes.length); i += 1) {
    before += el.childNodes[i].textContent?.length ?? 0;
  }
  let total = 0;
  let current = walker.nextNode();
  while (current) {
    if (el.contains(current)) return total + before;
    total += current.textContent?.length ?? 0;
    current = walker.nextNode();
  }
  return total + before;
}

/**
 * Offset into `container.textContent` for a viewport point, or null when
 * the browser can't answer (no caret API — e.g. jsdom — or the point is
 * outside the container).
 */
export function renderedOffsetFromPoint(
  container: HTMLElement,
  clientX: number,
  clientY: number,
): number | null {
  const doc = container.ownerDocument as CaretDocument | null;
  if (!doc) return null;

  if (typeof doc.caretPositionFromPoint === 'function') {
    const pos = doc.caretPositionFromPoint(clientX, clientY);
    if (pos) return flatTextOffset(container, pos.offsetNode, pos.offset);
  }
  if (typeof doc.caretRangeFromPoint === 'function') {
    const range = doc.caretRangeFromPoint(clientX, clientY);
    if (range) return flatTextOffset(container, range.startContainer, range.startOffset);
  }
  return null;
}

/**
 * End-to-end helper used by the inline editors: viewport point over the
 * rendered body → caret index in the markdown source. Null means "no
 * opinion" and the caller should fall back to its default (end of text).
 */
export function sourceCaretFromClick(
  container: HTMLElement,
  source: string,
  clientX: number,
  clientY: number,
): number | null {
  const renderedOffset = renderedOffsetFromPoint(container, clientX, clientY);
  if (renderedOffset === null) return null;
  return mapRenderedOffsetToSource(source, container.textContent ?? '', renderedOffset);
}
