/**
 * MarkdownView — schemaless links in a note stay links.
 *
 * markdown-it 15 ships linkify-it 6, which stopped recognising links
 * without a scheme by default (`fuzzyLink: false`). Notes written before
 * that upgrade rely on `example.com/path` and `www.example.com` being
 * clickable, so MarkdownView turns the recognition back on
 * (`md.linkify.set({ fuzzyLink: true })`).
 *
 * Expected href: linkify-it's README gives the normalised URL of the
 * schemaless match `github.com` as `http://github.com` — the scheme is
 * prepended, the visible text stays as written. The target/rel pair is
 * the hardening MarkdownView applies to every anchor (the `tag === 'a'`
 * branch of `nodeToReact`).
 *
 * Without the `fuzzyLink` line both inputs render as plain text and
 * `getByRole('link')` finds nothing.
 */
import { afterEach, describe, expect, test } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { MarkdownView } from './MarkdownView';

afterEach(cleanup);

describe('MarkdownView — schemaless links', () => {
  test.each([
    ['example.com/path', 'http://example.com/path'],
    ['www.example.com', 'http://www.example.com'],
  ])('«%s» in a note is a link to %s that opens in a new tab', (written, href) => {
    render(
      <MemoryRouter>
        <MarkdownView text={`see ${written} for details`} />
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: written });
    expect(link.getAttribute('href')).toBe(href);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });
});
