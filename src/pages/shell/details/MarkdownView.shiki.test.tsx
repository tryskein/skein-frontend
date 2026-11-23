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
 * replaced at the boundary. The fake loader hands back a promise the test
 * settles itself, so "before the plugin arrives" is a state the test holds, not
 * a guess about scheduling. The plugin it installs marks known languages and
 * throws for the language `boom`.
 *
 * The install state and the markdown renderer live in MarkdownView's module
 * scope, once per page, so each test loads a fresh copy of the module. That
 * copy registers its DOMPurify hook on the shared sanitizer; the test removes
 * exactly that hook again afterwards, so no case sanitizes with another's.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';

type Plugin = (md: InstanceType<typeof MarkdownIt>) => void;

const { loadPlugin, load } = vi.hoisted(() => ({
  loadPlugin: vi.fn(),
  load: {} as { resolve: (p: Plugin) => void; reject: (e: unknown) => void },
}));

vi.mock('../../../lib/shiki', () => ({
  getMarkdownItShikiPlugin: () => {
    loadPlugin();
    return new Promise<Plugin>((resolve, reject) => {
      load.resolve = resolve;
      load.reject = reject;
    });
  },
}));

const fakePlugin: Plugin = (md) => {
  md.options.highlight = (code: string, lang: string) => {
    if (lang === 'boom') throw new Error('grammar exploded');
    const escaped = md.utils.escapeHtml(code);
    return `<pre class="shiki test-highlighted"><code>${escaped}</code></pre>`;
  };
};

let addedHooks: Array<Parameters<typeof DOMPurify.addHook>> = [];

beforeEach(() => {
  vi.resetModules();
  loadPlugin.mockClear();
  addedHooks = [];
  const addHook = DOMPurify.addHook.bind(DOMPurify);
  vi.spyOn(DOMPurify, 'addHook').mockImplementation(((...args: Parameters<typeof DOMPurify.addHook>) => {
    addedHooks.push(args);
    return (addHook as (...a: unknown[]) => void)(...args);
  }) as typeof DOMPurify.addHook);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  for (const [entryPoint, hook] of addedHooks) {
    (DOMPurify.removeHook as (e: unknown, h: unknown) => void)(entryPoint, hook);
  }
  vi.restoreAllMocks();
});

async function mount(...texts: string[]) {
  const { MarkdownView } = await import('./MarkdownView');
  return render(
    <MemoryRouter>
      {texts.map((text) => <MarkdownView key={text} text={text} />)}
    </MemoryRouter>,
  );
}

const highlighted = (root: HTMLElement) => root.querySelectorAll('pre.test-highlighted');

describe('MarkdownView — the code highlighter', () => {
  test('a fenced block shown plain while the plugin loads is repainted highlighted when it arrives', async () => {
    const { container } = await mount('before\n\n```ts\nconst answer = 42;\n```\n');
    await waitFor(() => expect(loadPlugin).toHaveBeenCalledTimes(1));

    expect(highlighted(container)).toHaveLength(0);
    expect(container.querySelector('pre code')?.textContent).toBe('const answer = 42;\n');

    await act(async () => load.resolve(fakePlugin));

    await waitFor(() => expect(highlighted(container)).toHaveLength(1));
    expect(highlighted(container)[0].textContent).toContain('const answer = 42;');
    expect(container.textContent).toContain('before');
  });

  test('two views on screen load the plugin once and both repaint', async () => {
    const { container } = await mount('```ts\nconst a = 1;\n```\n', '```ts\nconst b = 2;\n```\n');
    await waitFor(() => expect(loadPlugin).toHaveBeenCalledTimes(1));

    await act(async () => load.resolve(fakePlugin));

    await waitFor(() => expect(highlighted(container)).toHaveLength(2));
    expect(loadPlugin).toHaveBeenCalledTimes(1);
  });

  test('a block whose highlighting throws falls back to plain code and the note still renders', async () => {
    const { container } = await mount(
      'intro\n\n```ts\nconst ok = 1;\n```\n\n```boom\nraw <b>source</b>\n```\n',
    );
    await waitFor(() => expect(loadPlugin).toHaveBeenCalledTimes(1));
    await act(async () => load.resolve(fakePlugin));
    await waitFor(() => expect(highlighted(container)).toHaveLength(1));

    const blocks = Array.from(container.querySelectorAll('pre'));
    expect(blocks).toHaveLength(2);
    const fallback = blocks.find((pre) => !pre.classList.contains('test-highlighted'));
    expect(fallback?.querySelector('code')?.textContent).toBe('raw <b>source</b>\n');
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toContain('intro');
  });

  test('a plugin that fails to load leaves code plain and the note rendered', async () => {
    const { container } = await mount('intro\n\n```ts\nconst ok = 1;\n```\n');
    await waitFor(() => expect(loadPlugin).toHaveBeenCalledTimes(1));

    await act(async () => load.reject(new Error('wasm failed to load')));

    expect(highlighted(container)).toHaveLength(0);
    expect(container.querySelector('pre code')?.textContent).toBe('const ok = 1;\n');
    expect(container.textContent).toContain('intro');
  });
});
