/**
 * sk-285.7 T016 — WHICH WIDTH RANGE the window is in, decided by the
 * application and published to the document as an attribute.
 *
 * ─── Why the application decides, and not the stylesheet ────────────
 *
 * INV-6: the shared stylesheet must not carry a width condition at or
 * below the floor in ANY at-rule. That is not a style preference — under a
 * floored layout the viewport is not the width of anything on screen
 * (the root pans instead of reflowing), so a rule keyed on the viewport
 * below the floor describes a width the layout never has.
 *
 * The redesign still needs two narrow layouts, so the branch has to
 * live somewhere the invariant allows: here. This module asks the
 * browser the two width questions, turns the pair of answers into one
 * of three modes, and writes it to `<html data-width-mode="…">`.
 * Mode-specific CSS keys on THAT attribute (plan decision R7), which is
 * a selector rather than an at-rule condition, so the stylesheet never
 * learns a width below the floor.
 *
 * ─── The three ranges, and where a boundary belongs ─────────────────
 *
 *     mobile   width <  768                       (`--bp-mobile`)
 *     tablet   768   ≤ width < 1284               (`--app-min-width`)
 *     desktop  1284  ≤ width
 *
 * A threshold belongs to the UPPER range, and the queries say so by
 * construction rather than by a rule written here: `(min-width: N)` is
 * `width >= N` in CSS — inclusive, per Media Queries Level 4 — so a
 * window exactly 768 wide answers `TABLET_MIN_QUERY` `true` and lands in
 * tablet. That is what makes a width sitting exactly on a boundary
 * resolve to one mode with no oscillation: there is no width at which
 * both "below" and "at or above" are true, so nothing can flip back and
 * forth while the number stands still.
 *
 * The tablet/desktop threshold IS the app floor. It gets no token of
 * its own on purpose (R7): a second name for the same number is a
 * second thing to forget when the floor moves, and the floor moves —
 * T009 moved it from 1240 to 1284 within this very task tree.
 *
 * ─── Why `matchMedia` rather than reading `innerWidth` ──────────────
 *
 * Because the question is CSS's question. The browser answers a
 * `matchMedia` query with the same evaluation it applies to `@media`,
 * and it tells us the moment the answer flips instead of on every pixel
 * of a drag — two subscriptions, one notification per boundary crossed.
 * A `resize` listener would have to re-derive the mode on every frame of
 * a window drag to learn the same thing.
 *
 * `window.innerWidth` is the FALLBACK, for an environment that has no
 * `matchMedia` — the same shape `useTheme` already uses for its
 * `prefers-color-scheme` listener. The two readers agree by definition
 * rather than by luck: Media Queries Level 4 defines the `width`
 * feature for continuous media as the viewport width INCLUDING a
 * rendered scrollbar, which is exactly what `innerWidth` reports (MDN,
 * `Window.innerWidth`). `useWidthMode.test.ts` pins the agreement
 * across the ranges and both boundaries anyway, because "by definition"
 * is a claim about specs and the assertion is about this code — and it
 * pins it THROUGH THE FALLBACK, with `matchMedia` deleted, which is the
 * only way that walk exercises the `innerWidth` branch at all. (It did
 * not, until a review: the fallback was reached at two widths
 * and neither was a boundary, so the docblock promised a coverage the
 * suite did not have.)
 */

import { useEffect, useLayoutEffect, useState } from 'react';

/** The three layout ranges the shell is built for. */
export type WidthMode = 'mobile' | 'tablet' | 'desktop';

/** The attribute mode-specific CSS keys on. */
export const WIDTH_MODE_ATTRIBUTE = 'data-width-mode';

/**
 * The mobile/tablet threshold, in px — `--bp-mobile` in `src/index.css`.
 *
 * Declared in both places because neither can read the other at
 * runtime: vitest runs jsdom with `css: false` and there is no cascade
 * to interrogate, so a `getComputedStyle` version of this would resolve
 * to the empty string in every test. `useWidthMode.test.ts` parses the
 * stylesheet off disk and fails when the two numbers drift apart, which
 * is the same arrangement `widthBudget.ts` and `theme-boot.js` are held
 * to.
 */
export const MOBILE_MIN_PX = 768;

/**
 * The tablet/desktop threshold, in px — the app floor,
 * `--app-min-width` in `src/index.css`. NOT a second breakpoint: above
 * this width the desktop layout fits, below it the shell would pan, and
 * that is the whole definition of the floor.
 */
export const DESKTOP_MIN_PX = 1284;

/**
 * sk-404.2 — the width from which the VIEW SEGMENT may draw its words,
 * in px. The fourth number in this module, and the first one that is not
 * a layout mode.
 *
 * ── Why it exists at all ────────────────────────────────────────────
 *
 * handoff §6 draws each member of the segment as "icon 20 + label
 * 14/500». sk-285.7.8 shipped the words, measured them at the app's own
 * floor and took them back off: labelled, the segment is ~126px wider,
 * and the only track that can yield — the brand's `minmax(0, 1fr)` —
 * had nothing left to yield, so «SKEIN» was cut in half. sk-285.7.9 then
 * made that a DECISION: the words stay off, and one of the three ways
 * out it named was «a fourth width step».
 *
 * This is that step, taken on the maintainers' instruction to put the words
 * back ("no labels in the List / tree / kanban choice"). The words are
 * drawn where they fit and not where they do not, which is the only
 * answer that satisfies both the instruction and the measurement.
 *
 * ── Why it is NOT a fourth `WidthMode` ──────────────────────────────
 *
 * A mode is a LAYOUT: which columns exist, which zone is on screen,
 * what the shell does with a drag. Every `[data-width-mode='desktop']`
 * rule in the sheet is written for that layout, and a fourth value
 * would either have to repeat them all or be silently missed by them.
 * This threshold changes nothing about the layout — one control draws
 * two extra words — so it is its own lens, read where it is needed
 * (`useViewLabels`), not a new mode everything else has to learn.
 *
 * ── Where the number comes from ─────────────────────────────────────
 *
 * MEASURED on the running app in headless Chromium, not derived. The
 * threshold was pinned LOW (1000) so the words were drawn everywhere,
 * and the viewport then walked one pixel at a time while the brand's
 * grid track was compared against the brand link's own natural width —
 * 82.42px for the mark and the word together. The track grows one for
 * one with the window:
 *
 *     1363  track 80.77  → the link spills 1.66px past its track
 *     1364  track 81.77  → spills 0.66
 *     1365  track 82.77  → fits, 0.34 to spare
 *
 * 1365 is therefore the narrowest window at which the labelled rail
 * leaves the mark whole, and it is this constant. (sk-285.7.9 estimated
 * «~1370» for a rail that still carried the unreviewed jump; sk-404.3
 * took that control out and gave 49.1px back, which is most of the
 * difference.)
 *
 * `HeaderViewLabels.test.tsx` re-derives the same number from the widths
 * it pins, so a rail that grows or shrinks moves the threshold instead
 * of leaving it asserting a width nobody has.
 */
export const VIEW_LABELS_MIN_PX = 1365;

/** True from `VIEW_LABELS_MIN_PX` upward — the width the words fit in. */
export const VIEW_LABELS_QUERY = `(min-width: ${VIEW_LABELS_MIN_PX}px)`;

/**
 * The query that is true from the tablet floor UPWARD — in tablet AND
 * in desktop, false only in mobile.
 *
 * Named for the range it OPENS, not for the range below it. It used to
 * be called `MOBILE_QUERY`, which read as "the mobile query" and was
 * true in exactly the two modes that are not mobile: the one name in
 * this module that meant the opposite of what it said. Both queries are
 * `min-width`s and both are true above the floor — they are a pair of
 * lower bounds, not a partition — which is also why `readWidthMode`
 * has to ask the wider one first.
 */
export const TABLET_MIN_QUERY = `(min-width: ${MOBILE_MIN_PX}px)`;
/** True only in desktop: the app floor is the desktop range's lower bound. */
export const DESKTOP_QUERY = `(min-width: ${DESKTOP_MIN_PX}px)`;

/**
 * The mode a given width is in.
 *
 * Ordered widest-first so the thresholds are inclusive on the upper
 * side without a separate rule saying so. A width that is not a number
 * — `NaN`, which is what an unreadable `innerWidth` would produce —
 * fails both comparisons and comes out `mobile`; that is the safe end
 * (the narrow layout fits on a wide screen, the wide one does not fit
 * on a narrow screen), and it needs no branch of its own to get there.
 */
export function widthModeFor(width: number): WidthMode {
  if (width >= DESKTOP_MIN_PX) return 'desktop';
  if (width >= MOBILE_MIN_PX) return 'tablet';
  return 'mobile';
}

/**
 * Ask the environment which mode it is in, right now.
 *
 * The desktop query is asked FIRST because both queries are true above
 * the floor — they are two `min-width`s, not a partition — so the wider
 * answer has to win. Asking in the other order would report `tablet`
 * for every desktop window.
 */
export function readWidthMode(): WidthMode {
  if (typeof window.matchMedia === 'function') {
    if (window.matchMedia(DESKTOP_QUERY).matches) return 'desktop';
    if (window.matchMedia(TABLET_MIN_QUERY).matches) return 'tablet';
    return 'mobile';
  }
  return widthModeFor(window.innerWidth);
}

/**
 * Call `onChange` whenever the answer can have changed; returns the
 * unsubscribe.
 *
 * Two subscriptions, one per boundary — a crossing notifies exactly the
 * list whose boundary was crossed. The fallback subscribes to `resize`,
 * which fires far more often than the mode changes; that is why it is
 * the fallback and not the mechanism.
 */
function subscribeToWidth(onChange: () => void): () => void {
  if (typeof window.matchMedia === 'function') {
    const lists = [window.matchMedia(TABLET_MIN_QUERY), window.matchMedia(DESKTOP_QUERY)];
    for (const list of lists) list.addEventListener('change', onChange);
    return () => {
      for (const list of lists) list.removeEventListener('change', onChange);
    };
  }
  window.addEventListener('resize', onChange);
  return () => window.removeEventListener('resize', onChange);
}

/**
 * The current width mode, kept in sync with the window, and published
 * to `<html>` as `data-width-mode`.
 *
 * ── Three details that are decisions rather than boilerplate ─────────
 *
 * 1. The subscribe effect RE-READS the mode after subscribing. Between
 *    the first render computing the initial state and the effect
 *    running, nothing is listening; a window resized in that gap would
 *    leave the hook reporting a mode the window has left. Re-reading
 *    costs one comparison and closes the gap. (`setState` to the same
 *    value is a no-op for React, so the common case does not re-render.)
 *
 * 2. The attribute is written in a LAYOUT effect, not a passive one.
 *    Layout effects run before the browser paints, so the frame that
 *    renders a new mode is painted with the matching attribute already
 *    on `<html>`. A passive effect would paint one frame with the old
 *    mode's CSS — the flash the spec rules out for the first frame
 *    ("the first frame must not show a layout that is plainly wrong for a
 *    narrow screen"), arriving one boundary crossing later instead.
 *
 *    ⚠ NOT PINNED BY THE SUITE, and said out loud rather than implied
 *    by the paragraph above: swapping this `useLayoutEffect` for a
 *    plain `useEffect` leaves all 80 assertions of
 *    `useWidthMode.test.ts` green (measured in a review fix).
 *    It has to — jsdom never paints, so "before the paint" is not a
 *    property this environment has, and no assertion written here could
 *    observe it. The claim is load-bearing in a browser and unprovable
 *    in the harness; it is held by this note and by review, not by a
 *    red test, and a reader deciding to "simplify" the hook should know
 *    that the suite will not stop them.
 *
 * 3. Unmounting does NOT remove the attribute. The mode is a property
 *    of the window, not of any component, and the boot script (T017)
 *    puts it there before React exists; clearing it on unmount would
 *    take the document from "a known mode" to "no mode" — the state
 *    only ever seen before the very first paint — with the last mount
 *    of a shell that is going away anyway. The subscription IS released,
 *    and the test pins that: after unmount, a width change moves
 *    nothing.
 */
export function useWidthMode(): WidthMode {
  const [mode, setMode] = useState<WidthMode>(readWidthMode);

  useEffect(() => {
    const sync = (): void => setMode(readWidthMode());
    const unsubscribe = subscribeToWidth(sync);
    sync();
    return unsubscribe;
  }, []);

  useLayoutEffect(() => {
    document.documentElement.setAttribute(WIDTH_MODE_ATTRIBUTE, mode);
  }, [mode]);

  return mode;
}

/**
 * Whether the view segment may draw its words, right now.
 *
 * Same shape as `readWidthMode` and for the same reasons: `matchMedia`
 * is CSS's own evaluation of the width question, and `innerWidth` is the
 * fallback for an environment without it. Read SYNCHRONOUSLY into the
 * initial state below, so the first frame of a wide window is painted
 * with the words already there rather than one frame after it.
 */
export function readViewLabels(): boolean {
  if (typeof window.matchMedia === 'function') {
    return window.matchMedia(VIEW_LABELS_QUERY).matches;
  }
  return window.innerWidth >= VIEW_LABELS_MIN_PX;
}

/**
 * The view segment's word lens, kept in sync with the window.
 *
 * Deliberately NOT published to `<html>` as an attribute the way
 * `data-width-mode` is. The words are markup — a member that draws no
 * word must not reserve the space for one — so the branch belongs where
 * the markup is, and a CSS-only version would leave the label in the
 * DOM and the segment as wide as if it were shown.
 */
export function useViewLabels(): boolean {
  const [on, setOn] = useState<boolean>(readViewLabels);

  useEffect(() => {
    const sync = (): void => setOn(readViewLabels());
    if (typeof window.matchMedia === 'function') {
      const list = window.matchMedia(VIEW_LABELS_QUERY);
      list.addEventListener('change', sync);
      sync();
      return () => list.removeEventListener('change', sync);
    }
    window.addEventListener('resize', sync);
    sync();
    return () => window.removeEventListener('resize', sync);
  }, []);

  return on;
}
