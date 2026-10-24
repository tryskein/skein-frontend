/**
 * sk-285.1.3 — click-to-caret mapping.
 *
 * The rendered-offset → source-offset walk is pure, so it's testable
 * without a layout engine. The DOM half (`renderedOffsetFromPoint`) is
 * exercised with a stubbed caret API — jsdom has neither
 * caretPositionFromPoint nor caretRangeFromPoint, which is exactly the
 * "no opinion → fall back to end of text" path the editor relies on.
 */

import { afterEach, describe, expect, test } from 'vitest';
import {
  mapRenderedOffsetToSource,
  renderedOffsetFromPoint,
  sourceCaretFromClick,
} from '../caretFromClick';

describe('mapRenderedOffsetToSource', () => {
  test('plain text maps 1:1', () => {
    const s = 'hello world';
    expect(mapRenderedOffsetToSource(s, s, 0)).toBe(0);
    expect(mapRenderedOffsetToSource(s, s, 6)).toBe(6);
    expect(mapRenderedOffsetToSource(s, s, 11)).toBe(11);
  });

  test('skips inline markup so the caret lands on the clicked word', () => {
    const source = 'Hello **bold** world';
    const rendered = 'Hello bold world';
    // Rendered index 11 is the "w" of "world"; in the source that's 15.
    expect(source.slice(15)).toBe('world');
    expect(mapRenderedOffsetToSource(source, rendered, 11)).toBe(15);
    // Index 6 is the "b" of "bold" → source index 8 (after the `**`).
    expect(mapRenderedOffsetToSource(source, rendered, 6)).toBe(8);
  });

  test('collapses the blank line between blocks', () => {
    const source = '# Title\n\npara';
    const rendered = 'Title\npara';
    expect(mapRenderedOffsetToSource(source, rendered, 6)).toBe(
      source.indexOf('para'),
    );
  });

  test('link syntax — caret inside the label maps into the label', () => {
    const source = 'see [the docs](https://example.com) now';
    const rendered = 'see the docs now';
    expect(mapRenderedOffsetToSource(source, rendered, 8)).toBe(
      source.indexOf('docs'),
    );
  });

  test('clamps out-of-range offsets', () => {
    const source = 'abc';
    expect(mapRenderedOffsetToSource(source, 'abc', -5)).toBe(0);
    expect(mapRenderedOffsetToSource(source, 'abc', 99)).toBe(3);
  });

  test('never returns past the end of the source', () => {
    const source = '**x**';
    const rendered = 'x plus renderer-only text';
    const idx = mapRenderedOffsetToSource(source, rendered, rendered.length);
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThanOrEqual(source.length);
  });
});

/**
 * jsdom ships neither caret API, so the tests install one. The cast goes
 * through `unknown` because lib.dom's `CaretPosition` carries a
 * `getClientRect()` the stub has no use for.
 */
type CaretHit = { offsetNode: Node; offset: number };

function stubCaretApi(hit: () => CaretHit | null): void {
  (document as unknown as Record<string, unknown>).caretPositionFromPoint = hit;
}

function clearCaretApi(): void {
  Reflect.deleteProperty(document, 'caretPositionFromPoint');
}

afterEach(() => {
  clearCaretApi();
  document.body.innerHTML = '';
});

describe('renderedOffsetFromPoint', () => {
  test('returns null when the browser has no caret API (jsdom)', () => {
    const host = document.createElement('div');
    host.textContent = 'hello';
    document.body.appendChild(host);
    expect(renderedOffsetFromPoint(host, 10, 10)).toBeNull();
  });

  test('flattens (node, offset) across sibling text nodes', () => {
    const host = document.createElement('div');
    host.innerHTML = '<p>Hello </p><p>world</p>';
    document.body.appendChild(host);
    const second = host.querySelectorAll('p')[1].firstChild as Text;

    stubCaretApi(() => ({ offsetNode: second, offset: 2 }));

    // "Hello " (6) + 2 into "world".
    expect(renderedOffsetFromPoint(host, 1, 1)).toBe(8);
  });

  test('ignores hits outside the container', () => {
    const host = document.createElement('div');
    host.textContent = 'inside';
    const other = document.createElement('div');
    other.textContent = 'outside';
    document.body.append(host, other);

    stubCaretApi(() => ({ offsetNode: other.firstChild as Text, offset: 1 }));

    expect(renderedOffsetFromPoint(host, 1, 1)).toBeNull();
  });
});

describe('sourceCaretFromClick', () => {
  test('rendered click → markdown source index', () => {
    const host = document.createElement('div');
    host.innerHTML = '<p>Hello bold world</p>';
    document.body.appendChild(host);
    const text = host.querySelector('p')!.firstChild as Text;

    stubCaretApi(() => ({ offsetNode: text, offset: 11 }));

    const source = 'Hello **bold** world';
    expect(sourceCaretFromClick(host, source, 5, 5)).toBe(15);
  });

  test('null when the point cannot be resolved', () => {
    const host = document.createElement('div');
    host.textContent = 'text';
    document.body.appendChild(host);
    expect(sourceCaretFromClick(host, 'text', 5, 5)).toBeNull();
  });
});
