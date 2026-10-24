/**
 * Vitest setup file — polyfills required by jsdom for our component tests.
 *
 * jsdom doesn't ship `ResizeObserver` (Mantine modal/popover internals
 * touch it) or `Element.scrollIntoView` (Mantine's combobox keeps the
 * active option in view while you arrow through a list). Both are stubbed
 * here so tests that mount Mantine components don't crash.
 *
 * `window.matchMedia` is a third case and a different one: jsdom does
 * not ship it at all, so the conditional stub that used to sit here
 * installed on every run — it was the live implementation the whole
 * suite answered width questions through, not dead code. What it
 * answered was `false` to every query at every window size, which is
 * fine until something asks a WIDTH question — see `viewport.ts`, which
 * replaces it with one that evaluates width queries against the same
 * number `window.innerWidth` reports, and installs unconditionally so
 * the environment stops depending on which jsdom is on disk
 * (sk-285.7 T035).
 *
 * It also boots i18n (sk-285.1.17) with the REAL dictionaries so component
 * tests assert against the strings the app actually renders. The language
 * is pinned to the product default (`en`) rather than whatever a previous
 * test wrote to localStorage, so a test that flips the language can never
 * leak into the next file.
 */
import { afterEach } from 'vitest';
import i18n, { DEFAULT_LANGUAGE } from '../i18n/config';
import { installTestViewport, resetViewportWidth } from './viewport';

if (i18n.language !== DEFAULT_LANGUAGE) {
  void i18n.changeLanguage(DEFAULT_LANGUAGE);
}

if (typeof window !== 'undefined') {
  installTestViewport();

  // Per-TEST isolation: this file runs once per test FILE, so without a
  // hook a width declared by one test would still be in force for the
  // next one in the same file.
  afterEach(() => {
    resetViewportWidth();
  });

  if (typeof window.ResizeObserver === 'undefined') {
    class ResizeObserverPolyfill {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    (window as unknown as { ResizeObserver: typeof ResizeObserverPolyfill }).ResizeObserver =
      ResizeObserverPolyfill;
  }

  /**
   * sk-285.2.10 — a stand-in layout for virtualized lists.
   *
   * jsdom has no layout engine: every element reports `offsetHeight === 0`.
   * A virtualizer reads that as "the scroll container shows nothing" and
   * renders ZERO rows — so without a height here, every test that mounts
   * the Tasks tree would be asserting against an empty list and would say
   * nothing about the tree. This is the same kind of stub as the two
   * above: the environment supplying what the browser would, not the
   * product branching on being under test.
   *
   * Scoped to the ONE shape that decides how many rows exist, so every
   * other element keeps jsdom's honest 0: `.col-body`, the scroll
   * container of a column.
   *
   * sk-285.2.19 — there used to be a second entry here, a height for
   * `[data-index]` (a measured row). The tree's rows are a fixed height
   * now and nothing measures them (see «Library choice» in
   * `TaskTreeVirtualList.tsx`), so a per-row height here would be a
   * number no code reads.
   */
  const VIRTUAL_VIEWPORT_PX = 800;
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement): number {
      if (this.matches('.col-body')) return VIRTUAL_VIEWPORT_PX;
      return 0;
    },
  });

  // Mantine's combobox calls `scrollIntoView()` on the active option
  // during keyboard navigation. jsdom has no layout engine and no such
  // method, so without this stub every arrow-key test throws instead of
  // asserting. A no-op is honest here: there is nothing to scroll.
  if (typeof Element !== 'undefined' && typeof Element.prototype.scrollIntoView !== 'function') {
    Element.prototype.scrollIntoView = function scrollIntoView(): void {};
  }
}
