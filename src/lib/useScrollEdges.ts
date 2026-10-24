/**
 * sk-285.7.2.76 — «is there more content past this edge?», measured.
 *
 * ─── Why a hook and not a stylesheet ────────────────────────────────
 *
 * The header's control rail pans horizontally in tablet: at 768 it holds
 * 712px of controls in 498px of track, so 214px — HOT ZONE, Inspect, the
 * language switch and the ACCOUNT MENU — sit past the right edge. They
 * are reachable (`scrollLeft` runs to exactly 214), and that half was
 * already right. What was missing is that nothing said so:
 * `scrollbar-width: none` plus a `::-webkit-scrollbar { display: none }`,
 * `mask-image: none`, `background-image: none`. In its resting state the
 * rail was indistinguishable from a rail with nothing past its edge.
 *
 * The question «is content hidden past the trailing edge» has no CSS
 * answer that this codebase may use:
 *
 *   · a width query is out — INV-6 forbids any at-rule keyed at or below
 *     `--app-min-width`, and the whole defect band (768…~982) is below
 *     it;
 *   · an always-on fade would lie at the widths where the rail fits —
 *     from ~1000 up, and on every desktop window;
 *   · the scroll-shadow trick (`background-attachment: local` under a
 *     `scroll` layer) answers it, but paints BEHIND the controls: the
 *     glyph clipped by the edge stays crisp, which is finding W-2 and
 *     the reason a background is not enough here;
 *   · a scrollbar has nowhere to go. Measured: the bar is 56px, the
 *     rail 52, the controls inside it 44 — so the rail's entire
 *     vertical slack IS the 4px of focus-ring room it keeps a side, and
 *     any scrollbar that occupies height takes that ring or grows §6's
 *     band. How much one would take is NOT claimed here and was not
 *     measured: headless Chromium answered
 *     `offsetHeight - clientHeight = 0` under `scrollbar-width: thin`,
 *     i.e. it drew an overlay bar, which is not what a
 *     classic-scrollbar platform gives. The argument does not rest on
 *     that number.
 *
 * So the app measures it, the way it already measures the width mode
 * (`useWidthMode.ts`) rather than asking a media query: two integers off
 * the element, published as data attributes, and the stylesheet keys on
 * those.
 *
 * ─── When it re-measures, and why each trigger is needed ────────────
 *
 * Three inputs move the answer, and no two of them fire the same event:
 *
 *   1. the user pans        → `scroll` on the element;
 *   2. the window resizes   → `ResizeObserver` on the element (the rail
 *      is a grid track, so a window resize changes its clientWidth
 *      without any React state changing);
 *   3. the CONTENT changes  → neither of the above. A badge gaining a
 *      second digit, a lens pill appearing, a translation switching
 *      language: `scrollWidth` moves while the box does not. That is
 *      why the layout effect below carries NO dependency array — it runs
 *      after every render of the host component, which is exactly when
 *      its content can have changed, and costs two integer reads.
 *
 * `useLayoutEffect`, not `useEffect`: the attributes decide paint, and a
 * fade that arrives a frame late is a visible flash on the first render.
 *
 * ─── What it cannot see ─────────────────────────────────────────────
 *
 * jsdom has no layout engine: `scrollWidth`, `clientWidth` and
 * `scrollLeft` are all 0 there, so under vitest this hook always answers
 * «no edges» unless a test defines those three properties itself. The
 * unit test beside it does exactly that; the live numbers are recorded
 * in the CSS rule's own comment and in sk-285.7.2.76.
 */

import { useCallback, useLayoutEffect, useState, type RefObject } from 'react';

export interface ScrollEdges {
  /** Content is hidden BEFORE the start edge, i.e. the box has been panned. */
  readonly start: boolean;
  /** Content is hidden PAST the end edge — the resting state of a rail that overflows. */
  readonly end: boolean;
}

const NO_EDGES: ScrollEdges = { start: false, end: false };

/**
 * Sub-pixel slack. A flex row's `scrollWidth` and `clientWidth` differ by
 * fractions on plenty of layouts that are not scrollable at all, and a
 * zero threshold would put a fade on a rail with nothing behind it.
 */
const EPSILON = 1;

/**
 * Which edges of `ref`'s box currently hide content, on the INLINE axis.
 *
 * Answers `{start: false, end: false}` while the ref is empty, so a
 * consumer never has to branch on the mount order.
 */
export function useScrollEdges(ref: RefObject<HTMLElement | null>): ScrollEdges {
  const [edges, setEdges] = useState<ScrollEdges>(NO_EDGES);

  const measure = useCallback(() => {
    const el = ref.current;
    if (el === null) {
      setEdges((prev) => (prev.start || prev.end ? NO_EDGES : prev));
      return;
    }
    // `scrollLeft` is negative in an RTL box, so the distance to the
    // start edge is its magnitude rather than the value itself. The app
    // has no RTL locale today; taking the magnitude costs nothing and
    // stops this from being a bug the day it does.
    const offset = Math.abs(el.scrollLeft);
    const hidden = el.scrollWidth - el.clientWidth;
    const next: ScrollEdges = {
      start: offset > EPSILON,
      end: hidden - offset > EPSILON,
    };
    setEdges((prev) => (prev.start === next.start && prev.end === next.end ? prev : next));
  }, [ref]);

  // No dependency array on purpose — see the docblock: a content change
  // moves `scrollWidth` without firing scroll or resize, and "after this
  // component rendered" is precisely when its content may have changed.
  useLayoutEffect(measure);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    el.addEventListener('scroll', measure, { passive: true });
    // Guarded rather than assumed: jsdom ships no ResizeObserver of its
    // own (the test setup stubs one), and a hook that threw on a missing
    // global would take the whole header down with it.
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(el);
    return () => {
      el.removeEventListener('scroll', measure);
      observer?.disconnect();
    };
  }, [ref, measure]);

  return edges;
}
