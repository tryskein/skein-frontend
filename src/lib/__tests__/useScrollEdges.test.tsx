/**
 * sk-285.7.2.76 — the measurement behind the header rail's pan fade.
 *
 * The hook answers «does content sit past this edge», and the whole
 * point of it existing is that the answer is a MEASUREMENT rather than a
 * width. So the numbers are what this file supplies: jsdom reports 0 for
 * `scrollWidth`, `clientWidth` and `scrollLeft` on every element, which
 * means an unstubbed test here would assert «no edges» forever and pass
 * on a hook that answered nothing at all.
 *
 * The three inputs are therefore defined per element, and each assertion
 * names the arithmetic it is about. `scrollWidth − clientWidth` is the
 * hidden total; `scrollLeft` is how much of it has been consumed; the
 * two booleans fall out of where the box sits between 0 and that total.
 */

import { useRef } from 'react';
import { afterEach, describe, expect, test } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';

import { useScrollEdges, type ScrollEdges } from '../useScrollEdges';

afterEach(cleanup);

/** Give one element the three metrics jsdom will not compute. */
function stub(
  el: HTMLElement,
  metrics: { scrollWidth: number; clientWidth: number; scrollLeft?: number },
): void {
  Object.defineProperty(el, 'scrollWidth', {
    configurable: true,
    get: () => metrics.scrollWidth,
  });
  Object.defineProperty(el, 'clientWidth', {
    configurable: true,
    get: () => metrics.clientWidth,
  });
  let left = metrics.scrollLeft ?? 0;
  Object.defineProperty(el, 'scrollLeft', {
    configurable: true,
    get: () => left,
    set: (v: number) => {
      left = v;
    },
  });
}

/**
 * Mount a box with the given metrics and expose both the live edges and
 * the node, so a test can pan it and watch the answer move.
 */
function mountBox(metrics: {
  scrollWidth: number;
  clientWidth: number;
  scrollLeft?: number;
}): { edges: () => ScrollEdges; node: HTMLElement } {
  let seen: ScrollEdges = { start: false, end: false };
  let node: HTMLElement | null = null;

  function Probe() {
    const ref = useRef<HTMLDivElement | null>(null);
    // The stub has to be in place BEFORE the hook's layout effect reads
    // the element, and the ref callback runs first — which is also the
    // only ordering a real browser has, where the metrics exist the
    // moment the node does.
    seen = useScrollEdges(ref);
    return (
      <div
        data-testid="box"
        ref={(el) => {
          ref.current = el;
          if (el !== null && node === null) {
            node = el;
            stub(el, metrics);
          }
        }}
      />
    );
  }

  render(<Probe />);
  return { edges: () => seen, node: node as unknown as HTMLElement };
}

describe('useScrollEdges — what the arithmetic says', () => {
  test('nothing hidden: neither edge', () => {
    // The state the rail is in from ~1000 up, and the one an always-on
    // fade would lie about.
    const { edges } = mountBox({ scrollWidth: 498, clientWidth: 498 });
    expect(edges()).toEqual({ start: false, end: false });
  });

  test('hidden and not panned: the END edge only', () => {
    // The resting state of the tablet rail at 768 — 712 of content in
    // 498 of track, 214 hidden, all of it to the right.
    const { edges } = mountBox({ scrollWidth: 712, clientWidth: 498 });
    expect(edges()).toEqual({ start: false, end: true });
  });

  test('panned to the far end: the START edge only', () => {
    const { edges } = mountBox({ scrollWidth: 712, clientWidth: 498, scrollLeft: 214 });
    expect(edges()).toEqual({ start: true, end: false });
  });

  test('panned to the middle: BOTH', () => {
    const { edges } = mountBox({ scrollWidth: 712, clientWidth: 498, scrollLeft: 100 });
    expect(edges()).toEqual({ start: true, end: true });
  });

  test('a scroll event re-measures — the answer follows the gesture', () => {
    const { edges, node } = mountBox({ scrollWidth: 712, clientWidth: 498 });
    expect(edges()).toEqual({ start: false, end: true });
    act(() => {
      node.scrollLeft = 214;
      node.dispatchEvent(new Event('scroll'));
    });
    expect(edges()).toEqual({ start: true, end: false });
  });

  test('sub-pixel slack is not an edge', () => {
    // A flex row's scrollWidth and clientWidth differ by fractions on
    // layouts that cannot scroll at all. Without the epsilon the rail
    // would wear a fade with nothing behind it — which is the same lie
    // as an always-on fade, only harder to spot.
    const { edges } = mountBox({ scrollWidth: 498.4, clientWidth: 498 });
    expect(edges()).toEqual({ start: false, end: false });
  });

  test('an RTL box reports the start edge from the magnitude', () => {
    // `scrollLeft` is negative in an RTL scroller. The app has no RTL
    // locale today; the assertion is here so adding one does not turn
    // the leading fade off.
    const { edges } = mountBox({ scrollWidth: 712, clientWidth: 498, scrollLeft: -214 });
    expect(edges().start).toBe(true);
  });

  test('an empty ref answers no edges instead of throwing', () => {
    function Probe() {
      const ref = useRef<HTMLDivElement | null>(null);
      const edges = useScrollEdges(ref);
      return <span data-testid="out">{`${edges.start}/${edges.end}`}</span>;
    }
    const view = render(<Probe />);
    expect(view.getByTestId('out').textContent).toBe('false/false');
  });
});
