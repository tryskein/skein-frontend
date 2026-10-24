import { useId } from 'react';

/**
 * sk-285.2.24 — the Skein mark, drawn inline.
 * sk-550 — a ball of yarn again.
 *
 * ## What it draws
 *
 * A ball of yarn on a 24 grid, the size the header uses it at: a disc,
 * five uneven wraps crossing it in two directions, a sheen at the upper
 * left, and a loose thread that leaves the ball at about two o'clock,
 * winds down its right side and runs off to the left UNDER the ball.
 *
 * sk-285.7.2.38 had replaced the yarn ball with the handoff's ring (an
 * ember disc in a band of the surface, later with a hairline of four
 * arcs). The owner preferred the old yarn ball and chose this drawing
 * from a side-by-side comparison of candidates (variant K2). It is
 * the pre-redesign ball redrawn, not scaled: that one was drawn on a
 * 64 grid with 2.5-unit threads, which at 16–24px merge into a smear.
 * Here the threads are about one unit, i.e. one device pixel at 24px.
 *
 * The ball is drawn on its own 24 grid (centre 10.8, 10.4, r 9.2) and
 * then shrunk to 0.9 and moved up and left by one transform, which frees
 * the right edge and the bottom for the thread. Keeping the ball in its
 * own coordinates means the wraps can be retuned without redoing the
 * arithmetic of the move.
 *
 * ## Colour
 *
 * Every part takes the `--accent` role, the ember the handoff reserves for
 * the logo: the disc and the loose thread in the role itself, the wraps a
 * shade darker and the sheen a shade lighter, both MIXED from the role
 * (`index.css#.skein-mark-wrap`) rather than written as hexes. So the ball
 * follows the theme — it lightens with the dark theme's lighter ember —
 * and editing `--accent` in the theme editor repaints all of it. The old
 * ball's fixed `#cb4b16` did neither, and on the dark header it was the
 * darkest ember on screen.
 *
 * ## Why inline SVG and not `<img src="/favicon.svg">`
 *
 *   • The header is chrome — it renders on every route, including the
 *     ones the user reaches when something is already wrong (offline, a
 *     failed chunk, an error boundary). An `<img>` has a load state and a
 *     failure state; the header's brand should have neither.
 *   • `/favicon.svg` is an ABSOLUTE path. Mounted under a sub-path
 *     (`/skein/`) that request 404s and the header shows a broken image.
 *   • The mark is THEMED. An `<img>` is an isolated document: the page's
 *     custom properties do not cross into it.
 *
 * The cost is two copies of one drawing: `public/favicon.svg` carries the
 * same paths with the light theme's colours written out (and the dark
 * theme's under `prefers-color-scheme`), because a favicon is fetched as
 * its own document. Redraw one — redraw the other; `public/favicon.ico`
 * is rasterised from the SVG (the command is in its comment).
 *
 * Decorative (`aria-hidden`): the word SKEIN sits right next to it and
 * the link already has its own `aria-label`, so a second accessible name
 * here would make screen readers announce the brand twice.
 */
export function SkeinMark() {
  // The clip needs a document-unique id: the mark can be mounted more
  // than once. `useId` returns colons, which are not safe inside `url(#…)`.
  const clipId = `skein-mark-${useId().replace(/:/g, '')}`;
  return (
    <svg
      className="header-logo-mark"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      // Not focusable: IE-era SVGs land in the tab order without this in
      // some engines, and a decorative mark must never take a tab stop
      // in front of the link that contains it.
      focusable="false"
    >
      <defs>
        <clipPath id={clipId}>
          <circle cx="10.8" cy="10.4" r="9.2" />
        </clipPath>
      </defs>
      {/* The ball, shrunk and moved up-left to leave room for the thread. */}
      <g transform="translate(0.48 0.84) scale(0.9)">
        <circle className="skein-mark-ball" cx="10.8" cy="10.4" r="9.2" />
        <g className="skein-mark-wrap" clipPath={`url(#${clipId})`} fill="none" strokeWidth="1.25" strokeLinecap="round">
          <path d="M2.2 8.2 C 6.5 4.6, 13.5 4.9, 19.6 9.4" />
          <path d="M1.8 11.6 C 7.5 13.2, 13.8 13.4, 19.9 11.9" />
          <path d="M3.0 15.4 C 8 19.0, 13.5 19.2, 18.4 15.8" />
          <path d="M7.6 1.6 C 9.4 7.5, 9.2 13.8, 7.4 19.6" />
          <path d="M14.4 1.8 C 13.4 7.8, 13.6 13.4, 15.2 19.2" />
        </g>
        <path
          className="skein-mark-sheen"
          d="M4.6 7.0 C 5.6 5.2, 7.2 3.9, 9.2 3.3"
          fill="none"
          strokeWidth="1.15"
          strokeLinecap="round"
        />
      </g>
      {/* The loose thread: out at two o'clock, down the right side, and
          away to the left under the ball. */}
      <path
        className="skein-mark-thread"
        d="M17.2 6.2 C 20.6 6.4, 22.4 8.6, 21.0 11.0 C 19.6 13.4, 22.8 15.0, 21.0 18.2 C 19.0 21.6, 12.0 22.8, 6.4 21.4 C 3.8 20.8, 2.4 21.8, 1.2 23.0"
        fill="none"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
