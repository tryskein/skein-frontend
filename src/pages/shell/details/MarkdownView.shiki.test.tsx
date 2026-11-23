/**
 * sk-1048.89 — MarkdownView installs the code highlighter and survives it.
 *
 * Contract (`MarkdownView.tsx#ensureShikiInstalled`): the first mounted view
 * loads the highlighting plugin from `lib/shiki` and installs it on the shared
 * markdown renderer; a view already on screen re-renders, so a fenced block
 * painted plain comes back highlighted. If highlighting a block throws, that
 * block falls back to a plain `<pre><code>` with its source text; if the plugin
 * cannot be loaded at all, code stays plain. Either way the note renders.
 *
 * Real Shiki cannot load under jsdom (its wasm loader fails there; the module
 * itself is tested in `lib/shiki.test.ts` under node), so `lib/shiki` is
 * replaced at the boundary by a plugin with a controlled `highlight`: it marks
 * known languages and throws for the language `boom`.
 *
 * The install state and the markdown renderer live in MarkdownView's module
 * scope, once per page. Each test therefore loads a fresh copy of the module,
 * so no test starts from a renderer an earlier one already set up.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type MarkdownIt from 'markdown-it';

const { loadPlugin, plugin } = vi.hoisted(() => ({
  loadPlugin: vi.fn(),
  plugin: { fails: false },
}));

vi.mock('../../../lib/shiki', () => ({
  getMarkdownItShikiPlugin: () => {
    loadPlugin();
    if (plugin.fails) return Promise.reject(new Error('wasm failed to load'));
    return Promise.resolve((md: InstanceType<typeof MarkdownIt>) => {
      md.options.highlight = (code: string, lang: string) => {
        if (lang === 'boom') throw new Error('grammar exploded');
        const escaped = md.utils.escapeHtml(code);
        return `<pre class="shiki test-highlighted"><code>${escaped}</code></pre>`;
      };
    });
  },
}));

beforeEach(() => {
  vi.resetModules();
  loadPlugin.mockClear();
  plugin.fails = false;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function renderNote(text: string) {
  const { MarkdownView } = await import('./MarkdownView');
  return render(
    <MemoryRouter>
      <MarkdownView text={text} />
    </MemoryRouter>,
  );
}

const highlighted = (root: HTMLElement) => root.querySelector('pre.test-highlighted');

describe('MarkdownView — the code highlighter', () => {
  test('a fenced block painted before the plugin loads is repainted highlighted', async () => {
    const { container } = await renderNote('before\n\n```ts\nconst answer = 42;\n```\n');
    expect(highlighted(container)).toBeNull();
    expect(container.querySelector('pre code')?.textContent).toBe('const answer = 42;\n');

    await waitFor(() => expect(highlighted(container)).not.toBeNull());
    expect(highlighted(container)?.textContent).toContain('const answer = 42;');
    expect(container.textContent).toContain('before');
    expect(loadPlugin).toHaveBeenCalledTimes(1);
  });

  test('a block whose highlighting throws falls back to plain code and the note still renders', async () => {
    const { container } = await renderNote(
      'intro\n\n```ts\nconst ok = 1;\n```\n\n```boom\nraw <b>source</b>\n```\n',
    );
    await waitFor(() => expect(highlighted(container)).not.toBeNull());

    const blocks = Array.from(container.querySelectorAll('pre'));
    expect(blocks).toHaveLength(2);
    const fallback = blocks.find((pre) => !pre.classList.contains('test-highlighted'));
    expect(fallback?.querySelector('code')?.textContent).toBe('raw <b>source</b>\n');
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toContain('intro');
  });

  test('a plugin that fails to load leaves code plain and the note rendered', async () => {
    plugin.fails = true;
    const { container } = await renderNote('intro\n\n```ts\nconst ok = 1;\n```\n');

    await waitFor(() => expect(loadPlugin).toHaveBeenCalledTimes(1));
    // Let the rejected load settle before reading the screen.
    await act(async () => {});

    expect(highlighted(container)).toBeNull();
    expect(container.querySelector('pre code')?.textContent).toBe('const ok = 1;\n');
    expect(container.textContent).toContain('intro');
  });
});
