// @vitest-environment node
/**
 * sk-1048.54 — the code highlighter (`shiki.ts`).
 *
 * Contract: one highlighter per page, created on first use and reused after;
 * every `ShikiLanguage` the module lists is loaded; both themes the readers ask
 * for by name (`SHIKI_LIGHT_THEME`, `SHIKI_DARK_THEME`) are registered; the
 * markdown-it plugin highlights a fence of a known language in both themes and
 * falls back to plain text for an unknown one instead of throwing.
 *
 * Runs the real Shiki (grammars, themes, wasm engine): a stub would only
 * repeat what the test told it. The node environment, because Shiki's wasm
 * loader does not run under jsdom; the HTML is read as text.
 */

import { afterEach, describe, expect, test } from 'vitest';
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

afterEach(() => __resetShikiForTests());

const LANGUAGES: ShikiLanguage[] = [
  'json', 'yaml', 'typescript', 'tsx', 'go', 'csharp', 'sql', 'bash', 'shell', 'diff',
  'markdown', 'dockerfile', 'python', 'javascript', 'jsx', 'html', 'css',
];

describe('getHighlighter', () => {
  test('creates the highlighter once and hands the same one back', async () => {
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

  test('a code sample is coloured by tokens, differently in the two themes', async () => {
    const hl = await getHighlighter();
    const light = hl.codeToHtml('const answer = 42;', { lang: 'typescript', theme: SHIKI_LIGHT_THEME });
    const dark = hl.codeToHtml('const answer = 42;', { lang: 'typescript', theme: SHIKI_DARK_THEME });
    expect(light).toMatch(/<span style="color:#[0-9A-Fa-f]{6}">const<\/span>/);
    expect(light).not.toBe(dark);
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
    expect(html).toContain('--shiki-dark');
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
