/**
 * sk-285.7 T030 — the tooltip wrapper does not let a call site put the
 * delay back.
 *
 * Coverage matrix row 49 (INV-7, "tooltips open without a delay"),
 * and behind it the project guideline: "Tooltips
 * open instantly — delay 0ms. No delay, timeout, animations
 * of appearance."
 *
 * ── What is under test, and what is deliberately not ─────────────────
 *
 * `SkeinTooltip` hardcodes `useHover(context, { delay: { open: 0, close:
 * 0 }, restMs: 0 })`. Floating UI's own behaviour is NOT the subject
 * here — it is somebody else's code and it has its own suite. What is
 * the subject is the WRAPPER'S CONTRACT: the invariant is satisfied
 * today, and a consumer must have no way to opt out of it. So the two
 * halves below are
 *
 *   • the RESULT, observed on the real component: a `mouseenter` puts
 *     the popup in the document, and a `mouseleave` takes it out, with
 *     no timer ever advanced;
 *   • the SURFACE: `SkeinTooltipProps` declares no delay-shaped prop, so
 *     asking for one is a compile error, and a runtime spread of the
 *     same keys (the way a `as any` call site would smuggle them in)
 *     changes neither the timing nor the DOM.
 *
 * ── Why fake timers are the instrument ───────────────────────────────
 *
 * "It opened fast" is not a measurement — an assertion made right after
 * a `fireEvent` passes for a 0ms delay and for a 300ms one alike if the
 * test then waits. Fake timers turn the question into a binary one that
 * needs no stopwatch: the clock is installed and NEVER advanced, so a
 * `setTimeout` scheduled by a non-zero delay can never fire. Floating
 * UI opens synchronously inside the event handler only when the delay is
 * 0 (any other value goes through `setTimeout`), and `restMs` waits for
 * a pointer to come to rest through the same clock. Under a frozen clock
 * "the popup is in the document" therefore means "there is no delay", with no
 * inference in between.
 *
 * jsdom runs with `css: false` and no layout engine, so nothing here
 * measures an animation frame or a rendered fade.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { FLOATING_LAYER_ID, SkeinTooltip } from '../SkeinTooltip';

/** The popup, wherever in the floating layer it landed. */
const popup = () => document.querySelector('.skein-tooltip');

const anchor = () => screen.getByRole('button', { name: 'anchor' });

/**
 * Render one tooltip. `extra` is spread AFTER the declared props, which
 * is precisely how a call site holding an `as any` would try to hand the
 * wrapper a delay.
 */
function renderTooltip(extra: Record<string, unknown> = {}) {
  return render(
    <SkeinTooltip content="the body" {...extra}>
      <button type="button">anchor</button>
    </SkeinTooltip>,
  );
}

afterEach(() => {
  cleanup();
  // The layer is created outside the React tree and outlives it, so a
  // leftover from one test must not be read as another test's popup.
  document.getElementById(FLOATING_LAYER_ID)?.replaceChildren();
});

describe('T030 / row 49 — the hover popup opens on the event, not on a timer', () => {
  beforeEach(() => {
    // Installed, never advanced. See the docblock: this is the whole
    // measurement.
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('mouseenter puts the popup in the document with the clock frozen', () => {
    renderTooltip();
    // Guard against a vacuous pass: an assertion that the popup is
    // present says nothing unless it was absent a line earlier.
    expect(popup(), 'the popup was on screen before anything hovered it').toBeNull();

    fireEvent.mouseEnter(anchor());

    expect(popup(), 'the popup needed a timer to run — INV-7 is broken').not.toBeNull();
    expect(popup()!.textContent).toBe('the body');
  });

  test('mouseleave takes it away again, on the same frozen clock', () => {
    // The close half of `delay: { open: 0, close: 0 }`. A non-zero close
    // delay is the more forgivable of the two and just as forbidden.
    renderTooltip();
    fireEvent.mouseEnter(anchor());
    expect(popup()).not.toBeNull();

    fireEvent.mouseLeave(anchor());

    expect(popup(), 'the popup lingered past the pointer').toBeNull();
  });

  test('a call site that asks for a delay anyway is ignored, not obeyed', () => {
    // Every spelling a consumer might reach for — Floating UI's own
    // (`delay`, `restMs`) and Mantine's (`openDelay`, `closeDelay`),
    // since the wrapper replaced a Mantine HoverCard and a call site
    // written from memory would use those names.
    renderTooltip({
      delay: { open: 400, close: 400 },
      restMs: 400,
      openDelay: 400,
      closeDelay: 400,
    });
    expect(popup()).toBeNull();

    fireEvent.mouseEnter(anchor());
    expect(popup(), 'a prop from the call site re-introduced the open delay').not.toBeNull();

    fireEvent.mouseLeave(anchor());
    expect(popup(), 'a prop from the call site re-introduced the close delay').toBeNull();
  });

  test('…and none of those keys reaches the DOM either', () => {
    // The other way an ignored prop can still do damage: forwarded onto
    // the anchor as an attribute. The wrapper clones the child with
    // Floating UI's interaction props only, and this is the line that
    // says so.
    renderTooltip({
      delay: { open: 400, close: 400 },
      restMs: 400,
      openDelay: 400,
      closeDelay: 400,
    });
    for (const name of ['delay', 'restms', 'opendelay', 'closedelay']) {
      expect(anchor().hasAttribute(name), `${name} was forwarded to the anchor`).toBe(false);
    }
  });
});

/**
 * T030 / row 49 — the props surface offers no delay to ask for.
 *
 * A compile-time pin, enforced by `npm run typecheck` (the
 * `include: ["src"]` of `tsconfig.json` covers this file) and never
 * executed: each `@ts-expect-error` is an ERROR when the line it precedes
 * compiles cleanly, so adding `delay` / `openDelay` / `closeDelay` to
 * `SkeinTooltipProps` fails the type build with "Unused
 * '@ts-expect-error' directive".
 */
export function tooltipDelayPropsPin() {
  return [
    // @ts-expect-error — SkeinTooltipProps declares no `delay`: INV-7 is
    // not a default a call site gets to override.
    <SkeinTooltip key="delay" content="the body" delay={{ open: 400, close: 400 }}>
      <button type="button">anchor</button>
    </SkeinTooltip>,
    // @ts-expect-error — the Mantine spelling of the same request.
    <SkeinTooltip key="open-close" content="the body" openDelay={400} closeDelay={400}>
      <button type="button">anchor</button>
    </SkeinTooltip>,
  ];
}
