// @vitest-environment node
/**
 * sk-1048.54 — the code highlighter (`shiki.ts`).
 *
 * Contract: one highlighter per page, created on first use and reused after
 * (the tests share it, as the page does); every `ShikiLanguage` the module
 * lists is loaded; both themes the readers ask for by name
 * (`SHIKI_LIGHT_THEME`, `SHIKI_DARK_THEME`) are registered; the
 * markdown-it plugin highlights a fence of a known language in both themes and
 * falls back to plain text for an unknown one instead of throwing.
 *
 * Runs the real Shiki (grammars, themes, wasm engine): a stub would only
 * repeat what the test told it. The node environment, because Shiki's wasm
 * loader does not run under jsdom; the HTML is read as text.
 */

import { describe, expect, test } from 'vitest';
import MarkdownIt from 'markdown-it';

import {
  SHIKI_DARK_THEME,
  SHIKI_LIGHT_THEME,
  __resetShikiForTests,
  getHighlighter,
  getMarkdownItShikiPlugin,
  type ShikiLanguage,
} from './shiki';

const LOAD_MS = 30_000;

// Must list exactly the keys of `LANG_LOADERS` in `shiki.ts` (the module does
// not export them): a grammar added there belongs here too.
const LANGUAGES: ShikiLanguage[] = [
  'json', 'yaml', 'typescript', 'tsx', 'go', 'csharp', 'sql', 'bash', 'shell', 'diff',
  'markdown', 'dockerfile', 'python', 'javascript', 'jsx', 'html', 'css',
];

describe('getHighlighter', () => {
  test('creates the highlighter once and hands the same one back', async () => {
    __resetShikiForTests();
    const first = getHighlighter();
    expect(getHighlighter()).toBe(first);
    const hl = await first;
    expect(await getHighlighter()).toBe(hl);
  }, LOAD_MS);

  test('registers both reader themes', async () => {
    const hl = await getHighlighter();
    expect(hl.getLoadedThemes()).toEqual(expect.arrayContaining([SHIKI_LIGHT_THEME, SHIKI_DARK_THEME]));
  }, LOAD_MS);

  test.each(LANGUAGES)('highlights %s', async (lang) => {
    const hl = await getHighlighter();
    const tokens = hl.codeToTokens('x', { lang, theme: SHIKI_DARK_THEME });
    expect(tokens.tokens.length).toBeGreaterThan(0);
  }, LOAD_MS);

  test('a keyword is coloured, and the two themes colour it differently', async () => {
    const hl = await getHighlighter();
    const keyword = (theme: string) =>
      hl.codeToTokens('const answer = 42;', { lang: 'typescript', theme })
        .tokens[0].find((t) => t.content === 'const');
    const light = keyword(SHIKI_LIGHT_THEME);
    const dark = keyword(SHIKI_DARK_THEME);
    expect(light?.color).toBeTruthy();
    expect(dark?.color).toBeTruthy();
    expect(light?.color).not.toBe(dark?.color);
  }, LOAD_MS);
});

describe('getMarkdownItShikiPlugin', () => {
  async function renderer() {
    const md = new MarkdownIt();
    md.use(await getMarkdownItShikiPlugin());
    return md;
  }

  test('a fence of a known language is highlighted with both themes', async () => {
    const html = (await renderer()).render('```ts\nconst answer = 42;\n```\n');
    const preClass = /<pre class="([^"]*)"/.exec(html)?.[1].split(' ') ?? [];
    expect(preClass).toEqual(expect.arrayContaining(['shiki', SHIKI_LIGHT_THEME, SHIKI_DARK_THEME]));
    expect(html).toContain('answer');
  }, LOAD_MS);

  test('a fence of an unknown language renders as plain text instead of throwing', async () => {
    const md = await renderer();
    let html = '';
    expect(() => { html = md.render('```nolang\nraw <b>text</b>\n```\n'); }).not.toThrow();
    expect(html).toContain('<code class="language-text">');
    expect(html).toContain('raw ');
    expect(html).not.toContain('<b>');
  }, LOAD_MS);
});
