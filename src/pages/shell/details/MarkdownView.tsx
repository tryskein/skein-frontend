import {
  Fragment,
  createElement,
  useEffect,
  useMemo,
  useState,
  type JSX,
  type ReactNode,
} from 'react';
import MarkdownIt from 'markdown-it';
import DOMPurify, { type Config as DOMPurifyConfig } from 'dompurify';
import { type MentionRef } from '../../../api/issues';
import { renderTextWithMentions } from '../../../lib/renderMentions';

/**
 * MarkdownView — renders the long-text body fields (description,
 * acceptance_criteria, notes) through a real markdown parser plus
 * `@username` mention substitution.
 *
 * Pipeline:
 *   1. markdown-it parses the source into HTML. `html: false` blocks
 *      raw HTML pass-through (no script tags, no event handlers, no
 *      arbitrary attributes via inline `<span style=…>`); `linkify:
 *      true` auto-links bare URLs; `breaks: true` maps single `\n` to
 *      `<br>` so line breaks the user typed survive without requiring
 *      a blank line.
 *   2. DOMPurify sanitises the HTML against a strict allow-list of
 *      common-prose markdown tags. Defence-in-depth on top of step 1 —
 *      protects against any future markdown-it plugin / regression
 *      that would emit unintended HTML.
 *   3. We walk the sanitised DOM and convert each node to React. Plain
 *      text nodes are passed through `renderTextWithMentions` so
 *      `@username` chips become real `<UserMention>` links. Mention
 *      substitution runs ONLY on text nodes — it never touches an
 *      `<a href>` target attribute (which would break linkify-emitted
 *      anchors) and never produces nested anchors inside an existing
 *      `<a>` (which would be invalid HTML anyway).
 *
 * The intermediate HTML is reused across renders (memoised by
 * `text + mentions identity`); the React-tree conversion runs each
 * call but is cheap.
 *
 * Click handling note: the parent wraps the read-mode body in a
 * click-to-edit affordance and ignores clicks on `<a>` so links inside
 * the rendered markdown stay activatable.
 */
export interface MarkdownViewProps {
  text: string;
  mentions?: MentionRef[];
}

// Module-level singleton — markdown-it construction is non-trivial and
// the parser is idempotent / re-entrant. `html: false` is the
// load-bearing security default; `linkify: true` auto-links bare URLs;
// `breaks: true` matches the chat-style line-break expectation users
// have for issue notes.
const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
});

// sk-41 — Shiki syntax-highlighting plugin install state.
//
// We register `@shikijs/markdown-it/core`'s `fromHighlighter(...)`
// plugin on the singleton md instance ONCE per app lifetime, lazily.
// Triggering the install in a `useEffect` (instead of at module load)
// keeps Shiki (themes + langs + wasm) out of the initial JS chunk —
// vite splits the dynamic imports inside `lib/shiki.ts` into a
// separate bundle. Re-entering MarkdownView while the install is in
// flight is harmless; the `installState` machine guards against
// double-registration.
//
// `installListeners` lets each mounted MarkdownView re-render after
// the plugin finishes loading so existing prose with fenced code
// blocks paints with highlighting instead of staying plain.
type ShikiInstallState = 'idle' | 'loading' | 'ready' | 'failed';
let shikiInstallState: ShikiInstallState = 'idle';
const installListeners = new Set<() => void>();

function notifyShikiReady(): void {
  for (const listener of installListeners) listener();
}

/**
 * Kick off the Shiki plugin install (idempotent). Errors are swallowed
 * after logging — markdown still renders without highlighting if Shiki
 * can't load.
 */
function ensureShikiInstalled(): void {
  if (shikiInstallState !== 'idle') return;
  shikiInstallState = 'loading';
  // Dynamic import keeps shiki out of the initial chunk; the module
  // itself uses further dynamic imports for themes / langs / wasm.
  import('../../../lib/shiki')
    .then(({ getMarkdownItShikiPlugin }) => getMarkdownItShikiPlugin())
    .then((plugin) => {
      md.use(plugin);
      // sk-42 — defence-in-depth: even with the plugin's
      // `fallbackLanguage: 'text'` option, Shiki can still throw
      // synchronously from the installed `md.options.highlight`
      // callback (corrupt grammar, oniguruma engine fault, future
      // unknown failure mode). That throw propagates up through
      // `md.render(text)` into the React `useMemo` below and
      // white-screens the entire details panel. Wrap the callback so
      // any throw degrades to markdown-it's default `<pre><code>`
      // rendering (which it falls back to on an empty-string return).
      const installed = md.options.highlight;
      if (installed) {
        md.options.highlight = (code, lang, attrs) => {
          try {
            return installed(code, lang, attrs);
          } catch (err) {
            if (import.meta.env.DEV) {
              // eslint-disable-next-line no-console
              console.warn('shiki highlight failed; falling back to plain code block', { lang, err });
            }
            return '';
          }
        };
      }
      shikiInstallState = 'ready';
      notifyShikiReady();
    })
    .catch((err) => {
      shikiInstallState = 'failed';
      // Highlighting is best-effort — plain `<pre><code>` still
      // renders. Surface in console for diagnostics (dev only); do not throw.
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.warn('shiki plugin install failed', err);
      }
    });
}

// Allow-list of tags markdown-it emits for the prose subset we render.
// Excludes raw HTML tags users could try to smuggle through; even
// though `html: false` already prevents that, the sanitiser is the
// belt-and-suspenders pass.
const ALLOWED_TAGS = [
  'p',
  'br',
  'strong',
  'em',
  'b',
  'i',
  'u',
  's',
  'del',
  'code',
  'pre',
  'blockquote',
  'a',
  'ul',
  'ol',
  'li',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  // sk-15 — markdown-it emits these for GFM-style tables; comments and
  // diagnostic notes routinely use tables, so they need to render
  // instead of getting stripped. Description / acceptance / notes
  // benefit from the same widening.
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  // GFM tables rarely ship a caption; we inject one for SR when
  // missing. Keep caption in the allow-list so authored captions survive.
  'caption',
];

// Anchors only — no event handlers, no inline styles. `align` rides
// along for table cells (markdown-it emits `<th align="right">`-style
// attrs for `| :---: |` column markers). `scope` names header direction
// for screen readers (we default th → col when the source omits it).
const ALLOWED_ATTR = ['href', 'title', 'align', 'scope'];

// sk-41 — sanitiser config covers both the plain-prose pipeline AND
// the shiki-augmented one. Shiki emits
// `<pre class="shiki" style="..."><code><span class="line"><span style="color:#..."></span></span></code></pre>`,
// where the inline `style` carries the token colour and the dual-theme
// CSS variable references. Adding `span` to the allow-list and `class`
// + `style` to the attribute list lets the highlighted markup survive
// sanitation; for plain prose (no Shiki) these attributes are simply
// never emitted by markdown-it so the surface is unchanged.
//
// The `style` attribute is constrained at render time by
// `parseInlineStyle` (allowed properties: color / background-color +
// the `--shiki-*` custom properties). The DOMPurify pass intentionally
// allows the attribute through; the constrained whitelist lives one
// layer in.
const ALLOWED_TAGS_SHIKI = [...ALLOWED_TAGS, 'span'];
const ALLOWED_ATTR_SHIKI = [...ALLOWED_ATTR, 'class', 'style'];

// sk-41 (review TS-W4) — tag-restriction hook. DOMPurify's
// `ALLOWED_ATTR` is a global allow-list, so widening it to include
// `class` and `style` would let those attributes survive on every tag
// in the allow-list (e.g. `<a style=…>`, `<p class=…>`). Today the
// React-tree builder only forwards class/style from span/pre/code, so
// surplus attributes on other tags are silently dropped during tree
// conversion — durable but fragile (a future contributor extending
// another branch to forward attributes inherits the over-broad
// allow-list). The hook re-caps the surface so class/style are kept
// ONLY on span / pre / code, mirroring the React-tree's actual
// usage; everything else loses the attribute at sanitisation time.
const SHIKI_STYLE_TAGS = new Set(['SPAN', 'PRE', 'CODE']);
DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
  if ((data.attrName === 'style' || data.attrName === 'class')
      && !SHIKI_STYLE_TAGS.has(node.nodeName)) {
    data.keepAttr = false;
  }
});

const SANITIZE_CONFIG_SHIKI: DOMPurifyConfig = {
  ALLOWED_TAGS: ALLOWED_TAGS_SHIKI,
  ALLOWED_ATTR: ALLOWED_ATTR_SHIKI,
  KEEP_CONTENT: true,
};

/**
 * Parse an inline `style="..."` attribute into a React style object.
 * sk-41 — needed because Shiki emits colour / background-color values
 * for the highlighted spans and the wrapping `<pre>`. We hand-roll a
 * micro-parser instead of pulling in a library: the only values Shiki
 * emits are simple CSS declarations of the form `prop: value;` with
 * occasional CSS-variable references; nothing that needs a full CSS
 * parser. Unknown / malformed entries are silently dropped.
 *
 * Allow-list scope: `color`, `background-color`, plus the
 * `--shiki-…` custom properties Shiki uses for dual-theme rendering
 * (e.g. `--shiki-dark`, `--shiki-light-bg`). Anything else is dropped
 * defensively — even though Shiki's output is trusted, the sanitiser
 * earlier in the pipeline now allows the `style` attribute through,
 * so this layer caps what actually reaches the DOM.
 */
function parseInlineStyle(raw: string | null): Record<string, string> | undefined {
  if (!raw) return undefined;
  const out: Record<string, string> = {};
  for (const decl of raw.split(';')) {
    const idx = decl.indexOf(':');
    if (idx <= 0) continue;
    const prop = decl.slice(0, idx).trim();
    const value = decl.slice(idx + 1).trim();
    if (!prop || !value) continue;
    // Allow Shiki's known properties + its CSS custom properties.
    if (
      prop === 'color'
      || prop === 'background-color'
      || prop === 'background'
      || prop.startsWith('--shiki-')
    ) {
      // Reject anything with parens (url(), expression-like) except the
      // canonical CSS variable reference `var(--…)` Shiki emits.
      if (/[()]/.test(value) && !/^var\(--[\w-]+\)$/.test(value)) continue;
      // React expects camelCase for standard properties; CSS custom
      // properties stay verbatim.
      const key = prop.startsWith('--')
        ? prop
        : prop.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
      out[key] = value;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Convert a sanitised `Element` (or `DocumentFragment`) into a flat
 * list of ReactNodes, substituting mentions in text nodes along the
 * way. Recursive — children are rendered via the same routine so the
 * full DOM tree is preserved.
 */
function nodeToReact(
  node: Node,
  mentions: MentionRef[] | undefined,
  keyPrefix: string,
): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? '';
    if (!text) return null;
    if (mentions && mentions.length > 0) {
      // renderTextWithMentions returns a flat ReactNode array — wrap in
      // a Fragment so the parent map() retains a stable key.
      return <Fragment key={keyPrefix}>{renderTextWithMentions(text, mentions)}</Fragment>;
    }
    return text;
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return null;
  }

  const el = node as Element;
  const tag = el.tagName.toLowerCase();

  // Build child ReactNodes recursively. Indexing children by position
  // gives stable keys for the lifetime of one render — markdown source
  // → DOM is deterministic so position is enough.
  const children: ReactNode[] = [];
  for (let i = 0; i < el.childNodes.length; i++) {
    const childNode = el.childNodes[i];
    children.push(nodeToReact(childNode, mentions, `${keyPrefix}-${i}`));
  }

  // Anchor elements need href + target/rel hardening. markdown-it +
  // linkify don't add target by default; we open in a new tab and add
  // noopener/noreferrer so external pages can't reach back into the
  // SPA window.
  if (tag === 'a') {
    const href = el.getAttribute('href') ?? undefined;
    const title = el.getAttribute('title') ?? undefined;
    return (
      <a
        key={keyPrefix}
        href={href}
        title={title}
        target="_blank"
        rel="noopener noreferrer"
      >
        {children}
      </a>
    );
  }

  // Self-closing-ish tags (no children needed even if children list is
  // empty). React requires correct children semantics, so we explicitly
  // omit children for the void elements.
  if (tag === 'br' || tag === 'hr') {
    return tag === 'br' ? <br key={keyPrefix} /> : <hr key={keyPrefix} />;
  }

  // Generic element — pass children through. We restrict the tag name
  // to the allow-list so React's createElement only ever sees a known
  // string (additionally protects against attribute-smuggling were
  // DOMPurify ever bypassed). sk-41 — also accept `<span>` from the
  // Shiki-extended allow-list.
  if (!ALLOWED_TAGS.includes(tag) && tag !== 'span') {
    // Should never happen — DOMPurify already stripped unknown tags.
    return <Fragment key={keyPrefix}>{children}</Fragment>;
  }

  // sk-41 — `<pre>`, `<code>`, and `<span>` may carry a `class` and
  // `style` attribute when Shiki emitted them. Forward both so the
  // highlighted colours actually paint. The `parseInlineStyle` helper
  // re-caps the allow-list to colour properties + Shiki's custom
  // properties; everything else is dropped.
  if (tag === 'span' || tag === 'pre' || tag === 'code') {
    const className = el.getAttribute('class') ?? undefined;
    const style = parseInlineStyle(el.getAttribute('style'));
    return createElementForTag(tag, keyPrefix, children, { className, style });
  }

  // GFM tables: give SR a name via caption + column header direction
  // via scope. markdown-it does not emit either by default.
  if (tag === 'table') {
    const hasCaption = Array.from(el.children).some(
      (c) => c.tagName.toLowerCase() === 'caption',
    );
    const tableChildren = hasCaption
      ? children
      : [
          createElement(
            'caption',
            { key: `${keyPrefix}-cap`, className: 'sr-only' },
            'Table',
          ),
          ...children,
        ];
    return createElement('table', { key: keyPrefix }, tableChildren);
  }

  if (tag === 'th') {
    const scope = el.getAttribute('scope') ?? 'col';
    const align = el.getAttribute('align') ?? undefined;
    return createElement(
      'th',
      { key: keyPrefix, scope, ...(align ? { align } : {}) },
      children,
    );
  }

  if (tag === 'td') {
    const align = el.getAttribute('align') ?? undefined;
    return createElement(
      'td',
      { key: keyPrefix, ...(align ? { align } : {}) },
      children,
    );
  }

  // React requires intrinsic tag names to be the literal string; we
  // don't preserve attributes other than href/title (already handled
  // for `<a>` above).
  return createElementForTag(tag, keyPrefix, children);
}

/**
 * Type-safe wrapper around React.createElement for the small set of
 * intrinsic tags we render. Avoids the `as any` we'd otherwise need to
 * pass a runtime-computed string into JSX.
 *
 * sk-41 — optional `className` / `style` props let the shiki-extended
 * tags (`<pre>`, `<code>`, `<span>`) carry their highlight metadata
 * without breaking the typing of the other tag paths.
 */
function createElementForTag(
  tag: string,
  key: string,
  children: ReactNode,
  extras?: { className?: string; style?: Record<string, string> },
): ReactNode {
  // tag is already restricted to ALLOWED_TAGS (+ span) by the caller —
  // cast to intrinsic element name is type-only, no runtime change.
  return createElement(
    tag as keyof JSX.IntrinsicElements,
    { key, className: extras?.className, style: extras?.style },
    children,
  );
}

export function MarkdownView({ text, mentions }: MarkdownViewProps) {
  // sk-41 — local tick that re-renders this view once the lazily-
  // installed Shiki plugin lands. Without this the first MarkdownView
  // mounted before the install completes would stay paint-stale
  // (plain `<pre><code>` for code fences). Bumping the tick busts the
  // `sanitised` memo so `md.render(text)` re-runs through the now-
  // augmented singleton.
  const [shikiReadyTick, setShikiReadyTick] = useState(
    shikiInstallState === 'ready' ? 1 : 0,
  );
  useEffect(() => {
    ensureShikiInstalled();
    if (shikiInstallState === 'ready') return;
    const listener = () => setShikiReadyTick((n) => n + 1);
    installListeners.add(listener);
    return () => {
      installListeners.delete(listener);
    };
  }, []);

  // markdown-it + DOMPurify are pure functions of the inputs; cache the
  // sanitised HTML so back-to-back renders don't re-parse on every
  // keystroke from the parent. `shikiReadyTick` bumps when the Shiki
  // plugin finishes loading so the cached HTML rebuilds with code
  // highlighting in place.
  const sanitised = useMemo(() => {
    if (!text) return '';
    const rendered = md.render(text);
    const cleaned = DOMPurify.sanitize(rendered, SANITIZE_CONFIG_SHIKI);
    return cleaned;
    // `shikiReadyTick` participates in the cache key on purpose — the
    // first render before Shiki resolves caches the plain HTML; once
    // the tick advances we redo `md.render(text)` so the now-
    // installed plugin emits highlighted spans.
  }, [text, shikiReadyTick]);

  // The DOM-walk → React-tree conversion is cheap and depends on the
  // mentions array identity, which TanStack Query keeps stable for
  // unchanged data. We don't memoise to keep mention edits responsive.
  const tree = useMemo(() => {
    if (!sanitised) return null;
    const tpl = document.createElement('template');
    tpl.innerHTML = sanitised;
    const out: ReactNode[] = [];
    for (let i = 0; i < tpl.content.childNodes.length; i++) {
      out.push(nodeToReact(tpl.content.childNodes[i], mentions, `n-${i}`));
    }
    return out;
  }, [sanitised, mentions]);

  if (!text) return null;

  return <div className="markdown-render">{tree}</div>;
}
