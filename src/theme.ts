import {
  createTheme,
  defaultVariantColorsResolver,
  type MantineColorsTuple,
  type VariantColorsResolver,
} from '@mantine/core';

/*
 * Mantine theme — bridges Mantine's component variables onto the CSS
 * custom properties defined in src/index.css and catalogued in
 * src/lib/themeTokens.ts.
 *
 * Strategy:
 *   - Keep `primaryColor: 'orange'` so any unscoped `color="orange"`
 *     usage still resolves. The tuple is derived from `--primary`, so a
 *     theme authored over MCP retunes Mantine's primary along with the
 *     rest of the UI (sk-285.1.6).
 *   - Defer surface / border / text colours to CSS variables — that
 *     way the same Mantine component renders correctly on both
 *     [data-theme="light"] and [data-theme="dark"] with no
 *     per-component overrides.
 *   - `defaultRadius: '2px'` per Q22 (sharp corners, dialogs only
 *     get the 6px treatment via component-level overrides).
 */

/*
 * sk-285.1.6 — both ramps are DERIVED from CSS custom properties, not
 * frozen hex.
 *
 * Before this change the tuples were literal palette / ember hex
 * values, which meant every `color="orange"` Mantine control (Loader,
 * Checkbox, ActionIcon, Button, Badge…) and every `c="ember.N"` text
 * kept the builtin palette even after a theme authored over MCP
 * retuned `--primary`. The theme was therefore only partially
 * configurable: our own CSS followed the tokens, Mantine's did not.
 *
 * Mantine 7 supports CSS variables inside a colours tuple — its
 * `alpha()` / `darken()` / `lighten()` helpers all special-case a
 * `var(…)` value and emit `color-mix()` instead of parsing RGB
 * (see `@mantine/core/…/color-functions/`). The generated
 * `--mantine-color-{name}-{0..9}` variables are copied through
 * verbatim, so the indirection costs nothing at runtime.
 *
 * sk-285.7: `--primary` is now the oxblood of the Stage 2.2 language, and
 * the ramp follows it because it is derived rather than frozen — which
 * is the whole point of this indirection. The tuple's light end mixes
 * toward `--bg` and its deep end steps down from `--primary-h`; with the
 * dark theme's hover grade being LIGHTER than its fill (see index.css),
 * the "deep end" is deep relative to the hover grade, not absolutely
 * dark.
 */

// Brand ramp — Mantine's `primaryColor`. Four steps are resolved by the
// framework at runtime: 5 is `-filled`, 6 is `-filled-hover`, and under
// the DARK scheme 3 and 4 back `-light-color` / `-outline` (verified in
// @mantine/core/styles.css; under the light scheme both come from 6).
// The rest exist to keep the tuple a well-formed 10-step ramp.
//
// The light end mixes toward `--bg` so the tints stay on-surface in both
// light and dark skins. The deep end steps down from `--primary-h` —
// NOT from `--primary`, which is what the first pass of this task wrote
// and what made the ramp stop being a ramp: with two brand grades left
// in the language, index 7 was set to `var(--primary)`, i.e. byte-equal
// to index 5 and LIGHTER than index 6, and the two remaining deep steps
// (mixed from `--primary`) landed above index 6 as well — in light,
// relative luminance ran 0.0747 (5) · 0.0464 (6) · 0.0747 (7) · 0.0497
// (8) · 0.0323 (9). Taking 7–9 from `--primary-h` restores a strictly
// descending 0→9 in the light theme (…0.0747 · 0.0464 · 0.0336 · 0.0232
// · 0.0150) and, in dark, a strictly descending 6→9 under the one
// inversion the dark hover grade makes on purpose at 5→6.
const orange: MantineColorsTuple = [
  'color-mix(in srgb, var(--primary) 8%, var(--bg))',
  'color-mix(in srgb, var(--primary) 22%, var(--bg))',
  'color-mix(in srgb, var(--primary) 40%, var(--bg))',
  'color-mix(in srgb, var(--primary) 58%, var(--bg))',
  'color-mix(in srgb, var(--primary) 78%, var(--bg))',
  'var(--primary)', // primary — `--mantine-color-orange-filled`
  'var(--primary-h)', // `--mantine-color-orange-filled-hover`
  'color-mix(in srgb, var(--primary-h), black 15%)',
  'color-mix(in srgb, var(--primary-h), black 30%)',
  'color-mix(in srgb, var(--primary-h), black 45%)',
];

// Warm ember ramp — the ember palette. It was «the palette behind
// `/legacy/*`»; sk-303.15 removed that route tree, and the ramp did NOT
// go with it: the login page and the widgets the shell reuses verbatim
// (CommentsThread, RequireAuth's frame) still read it. Bound to the
// `--skein-*` custom properties declared in src/legacy.css rather than
// duplicating their hex values, so the two can no longer drift. (They
// already had: ember[4] was still #7a6a55 after `--skein-fg-muted` was
// deliberately bumped to #8a7a65 for AA, so `c="ember.4"` text was
// rendering the value that bump was meant to retire.)
//
// NOTE for anyone extending this: `c="ember.N"` compiles to
// `var(--mantine-color-ember-N)`, and Mantine declares those variables
// on `:root`. Custom properties substitute at the element that DECLARES
// them, so a descendant that rebinds `--skein-*` does NOT retarget the
// ember variables — index.css rebinds `--mantine-color-ember-*` under
// `.col-details` explicitly for that reason.
//
// The ramp has 10 steps but the ember palette only names 8 tones, so
// indices 1 and 2 (which nothing in the app reads) reuse their nearest
// neighbour. The retirement note that used to sit here said «remove the
// whole ramp once /legacy/* is retired» — that condition is met and the
// conclusion did not follow: `c="ember.N"` survives in RequireAuth.tsx
// and CommentsThread.tsx (measured), so the ramp goes when THOSE move
// onto the role dictionary, not before.
const ember: MantineColorsTuple = [
  'var(--skein-fg)', // text — warm cream
  'var(--skein-fg)',
  'var(--skein-fg-dim)',
  'var(--skein-fg-dim)',
  'var(--skein-fg-muted)',
  'var(--skein-border-bright)',
  'var(--skein-border)', // border
  'var(--skein-bg-elev-2)',
  'var(--skein-bg-elev)', // surface elevated
  'var(--skein-bg)', // surface base
];

/*
 * sk-373 — the ink on a PRIMARY-filled Mantine control is `--on-primary`,
 * never Mantine's white.
 *
 * ─── The defect ───────────────────────────────────────────────────
 *
 * `defaultVariantColorsResolver` hardcodes `color:
 * var(--mantine-color-white)` for `variant="filled"` (verified in
 * @mantine/core's own source, not from memory). That is a safe default
 * for a ramp whose index 5 is dark, and ours is NOT: the `orange` tuple
 * above is DERIVED from `--primary`, and the redesign's dark theme
 * deliberately makes the primary FILL lighter than the text on it
 * (`--primary` #e38b8b, `--on-primary` #2a0f0f — see index.css). White
 * on that fill measured 2.52:1 in Chromium, against a 4.5 floor and a
 * pre-reform 4.61 the invariant INV-3 forbids regressing past.
 *
 * ─── Why no stylesheet fixed it, and why no guard saw it ──────────
 *
 * The 12 rules that moved to `--on-primary` earlier are rules — they
 * exist in `index.css` and a text scan can read them. This ink is not a
 * declaration in any stylesheet this repo owns: it is computed by a
 * function inside @mantine/core and injected as an inline
 * `--button-color` custom property at render time. So the sweep was
 * complete over its own subject (stylesheet rules) and still missed
 * every bare `<Button variant="filled">`, because those carry no rule
 * to sweep. Nor could the guards see it downstream: vitest runs jsdom
 * with `css: false`, so a computed-style assertion reads empty.
 *
 * The repair therefore has to happen where the value is actually
 * produced — in the resolver — and its guard has to call the resolver
 * as a function rather than look for a rule.
 *
 * ─── Scope: the primary ramp only ─────────────────────────────────
 *
 * `--on-primary` is the pair of `--primary` and means nothing on any
 * other fill, so the override fires only when the resolved fill IS the
 * primary ramp; every other colour keeps Mantine's own answer. Shade
 * suffixes (`color="orange.5"`) name the same ramp and are matched on
 * the base name.
 */
const variantColorResolver: VariantColorsResolver = (input) => {
  // Button and its siblings pass `color || theme.primaryColor`, so in the
  // app `color` is always set. Mantine's own resolver does NOT tolerate
  // the undefined case — `parseThemeColor` throws "Expected color to be a
  // string" rather than falling back to the primary ramp — so normalise
  // here and this resolver stays total for every caller.
  const named = input.color ?? input.theme.primaryColor;
  const resolved = defaultVariantColorsResolver({ ...input, color: named });
  if (input.variant !== 'filled') return resolved;
  if (named.split('.')[0] !== input.theme.primaryColor) return resolved;
  return { ...resolved, color: 'var(--on-primary)', hoverColor: 'var(--on-primary)' };
};

export const skeinTheme = createTheme({
  primaryColor: 'orange',
  variantColorResolver,
  primaryShade: { light: 5, dark: 5 },
  colors: {
    orange,
    ember,
  },
  // `--font-ui` drives general UI text everywhere Mantine renders;
  // `--font-mono` stays bound to `fontFamilyMonospace` so `<Code>` and
  // any explicit `ff="monospace"` consumer keeps its monospaced voice.
  // The two stacks are distinct by default (Inter / JetBrains Mono,
  // sk-285.1.10) and both are editable from the theme editor, so no
  // Mantine surface can pin a font the theme cannot change.
  fontFamily: 'var(--font-ui)',
  fontFamilyMonospace: 'var(--font-mono)',
  fontSizes: {
    xs: 'var(--font-xs)',
    sm: 'var(--font-sm)',
    md: 'var(--font-base)',
    lg: 'var(--font-lg)',
    xl: 'var(--font-xl)',
  },
  headings: {
    fontFamily: 'var(--font-ui)',
    fontWeight: 'var(--font-weight-semibold)',
  },
  defaultRadius: 'var(--radius-control)',
  cursorType: 'pointer',
  components: {
    /*
     * sk-285.1.12 — every Mantine close ✕ (Modal, Drawer, Notification)
     * is an icon-only control, so it gets the project's single tap
     * target: 44×44 CSS px (WCAG 2.5.5 AAA, `--tap-target` in
     * index.css). `size` is a number, i.e. rem(44) → 2.75rem, the same
     * value Mantine's own "xl" close button uses.
     *
     * `iconSize` is pinned because the stylesheet default is a
     * PERCENTAGE (`--cb-icon-size: 70%`): without it a 44px button
     * would draw a 31px ✕ and read as a panel rather than a glyph.
     *
     * Not affected: `Input.ClearButton` (Select/Autocomplete "clearable"
     * ✕) and Alert's close, which both pass an explicit `size` — an
     * explicit prop always beats theme defaultProps — so inputs keep
     * their in-field sizing.
     *
     * `aria-label` is defaulted here for the same reason: Mantine's
     * Modal / Drawer / Notification close buttons render a bare <svg>
     * with no text, so without it a screen reader announces "button".
     * Surfaces that can say something better (the header drawer says
     * "Close menu") pass their own `closeButtonProps` and win over this
     * default.
     */
    CloseButton: {
      defaultProps: {
        size: 44,
        iconSize: 18,
        'aria-label': 'Close',
      },
    },
    Button: {
      defaultProps: {
        variant: 'default',
      },
      styles: {
        root: {
          fontFamily: 'var(--font-ui)',
          letterSpacing: '0.02em',
          borderWidth: '1px',
        },
      },
    },
    /*
     * ── sk-285.7 fidelity P5 — why these four no longer paint `input` ──
     *
     * `styles` reaches the DOM as an INLINE style attribute, and inline
     * beats every selector a stylesheet can write short of `!important`.
     * These four components used to paint the field here —
     * `backgroundColor: var(--elev)`, `borderColor: var(--line-2)` — and
     * that made three rules in `index.css` unreachable without anybody
     * noticing:
     *
     *   `.projects-search .mantine-Input-input`   --surface / --line   (§6 «Column»)
     *   `.task-filters-search …`                  --surface / --line   (§6 «Column»)
     *   `.queue-select .mantine-Input-input`      --surface            (§6 «Queues»)
     *   `.comment-composer-input`                 --bg                 (§6 «Description»)
     *
     * All four are written, all four were correct, and all four lost:
     * measured in Chromium at 1440×900 the Projects search field painted
     * `rgb(239,236,231)` (`--elev`) behind `rgb(140,132,123)` (`--line-2`)
     * with the sheet asking for `--surface` behind `--line`. The guard in
     * `ColumnSurface.test.tsx` was green throughout — it reads the
     * stylesheet as text, and the declaration it looks for was there.
     *
     * So the field's paint moved OUT of here and into `index.css` (search
     * for «the Mantine field ground»), where the default is stated once
     * as a real rule at (0,1,0) — which per-surface rules can then
     * override the ordinary way.
     *
     * P5 moved the values across UNCHANGED (`--elev` / `--line-2`), so
     * that commit argued about reachability only. sk-285.7.13 then took
     * the second half and put the default on `--surface`, which is what
     * §3 and §6 «Forms» both name for a field; the numbers are in that
     * rule's comment. The reason it is worth knowing here: the ground of
     * every form outside the workspace shell is decided by that rule and
     * by nothing in this file, and it stays that way only while these
     * four keep their hands off `input`.
     *
     * ── sk-285.7.2.72 — the label's SIZE left for the same reason ────
     *
     * `label` used to carry `fontSize: 'var(--font-sm)'` here, and it
     * beat `.task-filter-select label { font-size: var(--font-xs) }` in
     * this sheet the same way `input` beat the four surface rules above
     * — by being inline. sk-285.7.2.67 could therefore only fix the
     * filter panel, and only by adding a SECOND inline declaration (a
     * `styles` prop on five controls). Audit 2B then measured 14px on
     * `/login`, `/settings/theme` and the Move dialog, against §6
     * «Forms»'s «Label 12/500 --ink-3».
     *
     * So the size went to `index.css` as a rule on
     * `.mantine-InputWrapper-label` (search for «the Mantine field
     * LABEL»), the panel's `styles` prop went away with it, and the
     * reach widened for free: this `components` map names four
     * components, while the app also renders `MultiSelect`,
     * `Autocomplete` and `TagsInput`, which have no entry here and so
     * were never dressed at all. The shared class covers all of them.
     *
     * `fontFamily` and `color` stay: nothing in the sheet contests
     * them, and the tone is recorded deviation 16, which belongs in one
     * place. Do not put a size back here — it would silently take the
     * whole set out of the sheet's reach again.
     */
    TextInput: {
      styles: {
        label: {
          fontFamily: 'var(--font-ui)',
          color: 'var(--ink-2)',
        },
      },
    },
    PasswordInput: {
      styles: {
        innerInput: {
          fontFamily: 'var(--font-ui)',
          color: 'var(--ink)',
        },
        label: {
          fontFamily: 'var(--font-ui)',
          color: 'var(--ink-2)',
        },
      },
    },
    Textarea: {
      styles: {
        label: {
          fontFamily: 'var(--font-ui)',
          color: 'var(--ink-2)',
        },
      },
    },
    Select: {
      styles: {
        label: {
          fontFamily: 'var(--font-ui)',
          color: 'var(--ink-2)',
        },
      },
    },
    Alert: {
      styles: {
        root: {
          fontFamily: 'var(--font-ui)',
        },
      },
    },
    Modal: {
      styles: {
        content: {
          borderRadius: 'var(--radius-panel)',
        },
        header: {
          fontFamily: 'var(--font-ui)',
        },
      },
    },
  },
});
