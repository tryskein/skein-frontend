import type { CSSProperties } from 'react';

/**
 * sk-386 — the dictionary pairs a `variant="light"` Mantine control
 * takes instead of one of the library's built-in ramps.
 *
 * ── Why a built-in ramp is not an option ────────────────────────────
 *
 * `Alert variant="light" color="red"` paints two values that both live
 * inside `@mantine/core` — a translucent wash and an ink — and neither
 * is reachable from this project's dictionary. They do not move with
 * the theme. What DOES move is the surface behind them, because the
 * wash is translucent and our surface composites into the measurement.
 * So the pair is asymmetric by construction, and the asymmetry is the
 * defect: the light theme fails and the dark one passes comfortably, so
 * a dark-theme spot check certifies it as fine.
 *
 * Measured on a live Chromium against the running app, ink over
 * (wash over surface), with the ramps read from the RUNTIME variables
 * rather than from `styles.css` (see below), on each of the three
 * planes the themed app paints on:
 *
 *                 light theme                dark theme
 *   ramp      --bg  --surface  --elev    --bg  --surface  --elev
 *   red       2.30    2.51     2.16     13.01   12.02     10.65
 *   gray      1.79    1.95     1.68     12.32   11.23      9.92
 *   blue      2.48    2.71     2.32     12.81   11.74     10.43
 *   green     1.71    1.87     1.61     12.50   11.43     10.14
 *   yellow    1.40    1.53     1.32     12.24   11.17      9.86
 *
 * Against a 4.5 floor: every one of the five fails on EVERY plane in
 * the light theme, and passes on every plane in dark. That is what
 * makes the surface-by-surface question the task warned about
 * unnecessary here — the answer does not depend on which plane a
 * given control sits on, only on which theme is showing.
 *
 * ⚠ RUNTIME values, not the library's defaults, and the difference is
 * a whole ramp step. `theme.ts` sets `primaryShade: { light: 5, dark:
 * 5 }`, and Mantine derives `-light` / `-light-color` / `-outline` from
 * the primary SHADE INDEX rather than from a fixed 6. So the pair the
 * app actually paints for `blue` is `#339af0` on `rgba(51,154,240,.1)`
 * (shade 5), where `styles.css` alone reads `#228be6` on
 * `rgba(34,139,230,.1)` (shade 6). Modelling from the stylesheet gives
 * 3.17 where the browser gives 2.71 — still a failure, but the wrong
 * number, and a guard built on the wrong number cannot be checked
 * against a live reading.
 *
 * ── The pairs that replace them ─────────────────────────────────────
 *
 * Same idiom sk-381 and sk-385 used for the Badge and the Alert: the
 * roles go in as inline custom properties and the `color=` prop is
 * DELETED. Leaving `color=` beside them would put a built-in ramp back
 * into the enumeration while being inert, which reads as a choice and
 * is not one. Measured over the same three planes, worst of the three:
 *
 *   --err  on --err-t    4.75 light / 4.86 dark
 *   --info on --info-t   4.59 / 5.56
 *   --ok   on --ok-t     4.57 / 5.92
 *   --warn on --warn-t   4.89 / 5.49
 *
 * The margins are thin — `--ok` clears by 0.07 on `--elev` — and that
 * is a property of the dictionary's own washes, not of this change.
 */

/** The error Alert: `--err` on `--err-t`. */
export const ERR_ALERT_VARS = {
  '--alert-bg': 'var(--err-t)',
  '--alert-color': 'var(--err)',
} as CSSProperties;

/** The informational Alert: `--info` on `--info-t`. */
export const INFO_ALERT_VARS = {
  '--alert-bg': 'var(--info-t)',
  '--alert-color': 'var(--info)',
} as CSSProperties;

/** The success Alert: `--ok` on `--ok-t`. */
export const OK_ALERT_VARS = {
  '--alert-bg': 'var(--ok-t)',
  '--alert-color': 'var(--ok)',
} as CSSProperties;

/** The caution Alert: `--warn` on `--warn-t`. */
export const WARN_ALERT_VARS = {
  '--alert-bg': 'var(--warn-t)',
  '--alert-color': 'var(--warn)',
} as CSSProperties;

/** The informational Badge — same pair, Mantine's other property names. */
export const INFO_BADGE_VARS = {
  '--badge-bg': 'var(--info-t)',
  '--badge-color': 'var(--info)',
} as CSSProperties;

/**
 * The ink/wash roles each constant above names, for the guard.
 *
 * Kept beside the constants rather than re-derived by parsing them: a
 * guard that re-parsed would go green on a typo'd role, which is
 * precisely the failure the pairs exist to prevent (an invalid custom
 * property is not an error, it is a dropped declaration — and a
 * dropped declaration hands the control back to Mantine's default).
 */
export const VARIANT_ROLE_PAIRS: ReadonlyArray<{
  name: string;
  ink: string;
  wash: string;
}> = [
  { name: 'ERR_ALERT_VARS', ink: '--err', wash: '--err-t' },
  { name: 'INFO_ALERT_VARS', ink: '--info', wash: '--info-t' },
  { name: 'OK_ALERT_VARS', ink: '--ok', wash: '--ok-t' },
  { name: 'WARN_ALERT_VARS', ink: '--warn', wash: '--warn-t' },
  { name: 'INFO_BADGE_VARS', ink: '--info', wash: '--info-t' },
];
