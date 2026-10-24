/**
 * sk-41 — shared Shiki highlighter singleton.
 *
 * Two consumers:
 *
 *   1. `MarkdownView` — augments the module-level markdown-it instance
 *      with `@shikijs/markdown-it/core` `fromHighlighter(...)` so fenced
 *      code blocks inside issue descriptions / acceptance / notes /
 *      stand-alone `.md` files get highlighted under the dual light/dark
 *      themes. Markdown rendering itself stays synchronous — the plugin
 *      is registered once, in a fire-and-forget async hook, and any
 *      render before that point falls back to the existing
 *      "plain code in a <pre><code>" path.
 *
 *   2. `FileViewerPanel` — calls `getHighlighter()` directly and uses
 *      `highlighter.codeToHtml(text, { lang, themes: { light, dark } })`
 *      to render standalone `.ts` / `.tsx` / `.go` / `.cs` / `.sql` /
 *      `.json` / `.yaml` files.
 *
 * Bundle-size hygiene:
 *   - We import `shiki/core` (not the kitchen-sink `shiki` entry) so
 *     vite chunks themes / langs / engine into separate code-split
 *     bundles. The viewer (and the markdown plugin) load Shiki lazily,
 *     so the initial-load JS does NOT include Shiki at all.
 *   - All themes / langs / the wasm binary use `import('…')` so vite
 *     emits separate chunks.
 *   - The whole module's external API is one promise: re-entering
 *     `getHighlighter()` returns the same `Promise<HighlighterCore>`.
 *
 * Adding a new language: drop a row into `LANG_LOADERS` and add the
 * matching `ViewableKind.language` value in `fileViewerSupport.ts`.
 */

import {
  createHighlighterCore,
  type HighlighterCore,
  type LanguageInput,
} from 'shiki/core';
import { createOnigurumaEngine } from 'shiki/engine/oniguruma';

/**
 * Names exposed to callers. Must match `fileViewerSupport.ts`'s
 * `language` values and the registered grammar keys (the Shiki loader
 * uses the grammar's `name` field, which we trust to match the import
 * path).
 *
 * sk-42 — the list is intentionally broader than what
 * `fileViewerSupport.ts` exposes as attachment file types. The markdown
 * plugin (consumed by `MarkdownView`) needs every language a human
 * might reasonably tag in a ```fence; an unknown fence lang would
 * otherwise make Shiki throw synchronously inside `md.render(...)` and
 * white-screen the entire React tree. `fallbackLanguage: 'text'` on
 * the markdown plugin (see `getMarkdownItShikiPlugin`) is the
 * belt-and-suspenders for truly unknown langs, but registering the
 * common ones still gives them proper highlighting.
 */
export type ShikiLanguage =
  | 'json'
  | 'yaml'
  | 'typescript'
  | 'tsx'
  | 'go'
  | 'csharp'
  | 'sql'
  | 'bash'
  | 'shell'
  | 'diff'
  | 'markdown'
  | 'dockerfile'
  | 'python'
  | 'javascript'
  | 'jsx'
  | 'html'
  | 'css';

/**
 * Light / dark theme identifiers used everywhere. The FileViewerPanel
 * picks one based on Mantine's `colorScheme`; the markdown plugin
 * registers both and lets CSS variables on the rendered HTML pick the
 * right one at paint time.
 */
export const SHIKI_LIGHT_THEME = 'github-light';
export const SHIKI_DARK_THEME = 'github-dark';

/**
 * Dynamic loader map. Each entry is a thunk returning the
 * `import('@shikijs/langs/…')` promise — Shiki accepts this exact
 * shape (`() => Awaitable<MaybeModule<MaybeArray<LanguageRegistration>>>`)
 * as a `LanguageInput`. Vite chunks each lang into a separate bundle.
 */
const LANG_LOADERS: Record<ShikiLanguage, LanguageInput> = {
  json: () => import('@shikijs/langs/json'),
  yaml: () => import('@shikijs/langs/yaml'),
  typescript: () => import('@shikijs/langs/typescript'),
  tsx: () => import('@shikijs/langs/tsx'),
  go: () => import('@shikijs/langs/go'),
  csharp: () => import('@shikijs/langs/csharp'),
  sql: () => import('@shikijs/langs/sql'),
  bash: () => import('@shikijs/langs/bash'),
  shell: () => import('@shikijs/langs/shellscript'),
  diff: () => import('@shikijs/langs/diff'),
  markdown: () => import('@shikijs/langs/markdown'),
  dockerfile: () => import('@shikijs/langs/dockerfile'),
  python: () => import('@shikijs/langs/python'),
  javascript: () => import('@shikijs/langs/javascript'),
  jsx: () => import('@shikijs/langs/jsx'),
  html: () => import('@shikijs/langs/html'),
  css: () => import('@shikijs/langs/css'),
};

/**
 * Module-level singleton — initialised on first call to
 * `getHighlighter()`. We never reset it; Shiki's HighlighterCore is
 * designed to live for the lifetime of the page.
 */
let highlighterPromise: Promise<HighlighterCore> | null = null;

/**
 * Initialise (or reuse) the Shiki highlighter. Resolves to a long-
 * lived `HighlighterCore` with both light + dark themes and every
 * language in `ShikiLanguage` pre-loaded.
 */
export function getHighlighter(): Promise<HighlighterCore> {
  if (highlighterPromise) return highlighterPromise;

  highlighterPromise = createHighlighterCore({
    themes: [
      import('@shikijs/themes/github-light'),
      import('@shikijs/themes/github-dark'),
    ],
    langs: Object.values(LANG_LOADERS),
    engine: createOnigurumaEngine(() => import('shiki/wasm')),
  });

  return highlighterPromise;
}

/**
 * Lazy `@shikijs/markdown-it` plugin factory. Returns a sync
 * markdown-it plugin function (suitable for `md.use(plugin)`) once the
 * highlighter has resolved.
 *
 * MarkdownView calls this from a `useEffect` that fires once per app
 * lifetime and registers the plugin on the shared md singleton; any
 * `md.render()` call that happens after registration picks up the
 * highlighter automatically. Calls that happen before fall back to
 * markdown-it's default `<pre><code>` rendering — still correct,
 * just unhighlighted.
 *
 * Two themes are registered so the same rendered HTML adapts to the
 * Mantine colour scheme via Shiki's CSS-variable dual-theme mode (no
 * re-render needed when the user flips between light and dark).
 */
export async function getMarkdownItShikiPlugin(): Promise<
  (md: import('markdown-it').default) => void
> {
  // Dynamic import keeps `@shikijs/markdown-it/core` out of the
  // initial bundle. We only load it once both the highlighter and the
  // plugin module have arrived; the wrapping `await` in callers
  // forces sequence.
  const [highlighter, { fromHighlighter }] = await Promise.all([
    getHighlighter(),
    import('@shikijs/markdown-it/core'),
  ]);

  // `fromHighlighter` declares `HighlighterGeneric<any, any>` which TS
  // narrows down to `never` under strict mode — cast through
  // `unknown` so the call type-checks without bleeding `any` into the
  // surrounding code.
  return fromHighlighter(highlighter as unknown as Parameters<typeof fromHighlighter>[0], {
    themes: {
      light: SHIKI_LIGHT_THEME,
      dark: SHIKI_DARK_THEME,
    },
    // sk-42 — unknown fence langs (e.g. ```rust before we register it)
    // would otherwise make Shiki throw synchronously inside md.render()
    // and white-screen the React tree. 'text' is Shiki's built-in no-op
    // plaintext lang, always available regardless of which grammars are
    // loaded; the markdown-it plugin treats it as the substitute lang
    // when the requested one isn't in the highlighter's registry. The
    // cast is needed because Shiki's BundledLanguage union excludes the
    // plaintext aliases ('text' / 'txt' / 'plain' / 'plaintext' /
    // 'ansi') even though the runtime accepts them — they're handled
    // by a special path in the highlighter rather than as a bundled
    // grammar.
    fallbackLanguage: 'text' as unknown as Parameters<typeof fromHighlighter>[1]['fallbackLanguage'],
  });
}

/**
 * Test-only: reset the singleton so a fresh `getHighlighter()` call
 * starts from scratch. Not exported from any production code path —
 * the runtime never needs to drop the highlighter.
 */
export function __resetShikiForTests(): void {
  highlighterPromise = null;
}
