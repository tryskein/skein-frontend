/**
 * sk-1048.89 — MarkdownView installs the code highlighter and survives it.
 *
 * Contract (`MarkdownView.tsx#ensureShikiInstalled`): the first mounted view
 * loads the highlighting plugin from `lib/shiki` and installs it on the shared
 * markdown renderer; views already on screen re-render, so a fenced block that
 * was painted plain comes back highlighted. If highlighting a block throws, that
 * block falls back to a plain `<pre><code>` with its source text and the view
 * still renders.
 *
 * Real Shiki cannot load under jsdom (its wasm loader fails there; the module
 * itself is tested in `lib/shiki.test.ts` under node), so `lib/shiki` is
 * replaced at the boundary by a plugin with a controlled `highlight`: it marks
 * known languages and throws for the language `boom`.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type MarkdownIt from 'markdown-it';

const { loadPlugin } = vi.hoisted(() => ({ loadPlugin: vi.fn() }));

vi.mock('../../../lib/shiki', () => ({
  getMarkdownItShikiPlugin: () => {
    loadPlugin();
    return Promise.resolve((md: InstanceType<typeof MarkdownIt>) => {
      md.options.highlight = (code: string, lang: string) => {
        if (lang === 'boom') throw new Error('grammar exploded');
        const escaped = md.utils.escapeHtml(code);
        return `<pre class="shiki test-highlighted"><code>${escaped}</code></pre>`;
      };
    });
  },
}));

import { MarkdownView } from './MarkdownView';

afterEach(cleanup);

function renderNote(text: string) {
  return render(
    <MemoryRouter>
      <MarkdownView text={text} />
    </MemoryRouter>,
  );
}

describe('MarkdownView — the code highlighter', () => {
  test('a fenced block painted before the plugin loads is repainted highlighted', async () => {
    const { container } = renderNote('before\n\n```ts\nconst answer = 42;\n```\n');

    await waitFor(() => expect(container.querySelector('pre.test-highlighted')).not.toBeNull());
    expect(container.querySelector('pre.test-highlighted')?.textContent).toContain('const answer = 42;');
    expect(container.textContent).toContain('before');
    expect(loadPlugin).toHaveBeenCalledTimes(1);
  });

  test('a block whose highlighting throws falls back to plain code and the note still renders', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    // The plugin is installed once per page; wait for it through a block it highlights.
    const { container } = renderNote(
      'intro\n\n```ts\nconst ok = 1;\n```\n\n```boom\nraw <b>source</b>\n```\n',
    );
    await waitFor(() => expect(container.querySelector('pre.test-highlighted')).not.toBeNull());

    const blocks = Array.from(container.querySelectorAll('pre'));
    expect(blocks).toHaveLength(2);
    const fallback = blocks.find((pre) => !pre.classList.contains('test-highlighted'));
    expect(fallback?.querySelector('code')?.textContent).toBe('raw <b>source</b>\n');
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toContain('intro');
  });
});
