import type { CSSProperties } from 'react';

/**
 * sk-285.7.2.85 — the destructive plate for a Mantine `<Button>`, as
 * inline custom properties.
 *
 * ── Why this is not just `color="red"` ──────────────────────────────
 *
 * Two facts collide on a destructive confirm button.
 *
 * `theme.ts` sets `Button.defaultProps.variant = 'default'`, and
 * Mantine's `default` variant IGNORES the `color` prop entirely — it
 * paints `--mantine-color-default*` whatever colour is asked for. So
 * `<Button color="red">` without a variant is a neutral box: measured
 * on «Move issue» before sk-285.7.2.82, the confirming button and the
 * Cancel beside it were the SAME `rgb(255,255,255)` / `rgb(33,37,41)`
 * 36px box, and the dialog had no primary action.
 *
 * Adding `variant="filled"` fixes the first fact and lands on the
 * second: `red` is a BUILTIN Mantine ramp, a table of literals inside
 * `@mantine/core` that this repo's tokens never reach. sk-381 cleared
 * the tree of builtin ramps on measurement, and this one measures
 * white on `#fa5252` = **3.28:1** — under the 4.5 floor and under even
 * the 3:1 allowed for large text.
 *
 * ── What it is instead ──────────────────────────────────────────────
 *
 * The dictionary, through the same inline-custom-property route sk-381
 * used for the Badge and the Alert. `--err` under `--bg` ink is the
 * product's OWN destructive plate — `.action-button.primary.danger` in
 * `index.css` is that exact pair — and it measures **5.97:1** light /
 * **6.81:1** dark (computed from the token blocks; the guard recomputes
 * it rather than trusting these numbers).
 *
 * Every one of the four properties is named on purpose:
 *
 *   • `--button-bg` / `--button-color` — the plate and its ink;
 *   • `--button-hover` — left unset it falls back to
 *     `--mantine-primary-color-filled-hover`, i.e. the plate changes
 *     RAMP under the pointer, which is the failure mode that makes a
 *     hover-only bug;
 *   • `--button-hover-color` — Mantine reads it separately from
 *     `--button-color`, so an unset one drops the ink back on hover
 *     for exactly as long as the pointer is there (the same trap
 *     sk-373 recorded on `hoverColor`);
 *   • `--button-bd` — the filled variant's default border is
 *     `transparent`, which is right on a plate that fills its own box
 *     and wrong here only if the plate is ever made translucent. Named
 *     so the edge follows the plate rather than a Mantine default.
 *
 * ⚠ Do NOT pass `color=` beside this. It would put a builtin ramp back,
 * and the ramp would be inert (these properties outrank it) — a prop that reads as
 * the source of the colour and is not.
 */
export const DANGER_BUTTON_VARS = {
  '--button-bg': 'var(--err)',
  '--button-hover': 'var(--err)',
  '--button-color': 'var(--bg)',
  '--button-hover-color': 'var(--bg)',
  '--button-bd': '1px solid var(--err)',
} as CSSProperties;

/** The role pair the plate is built from — the guard measures these. */
export const DANGER_PLATE = { bg: '--err', ink: '--bg' } as const;
