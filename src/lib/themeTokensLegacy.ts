/**
 * Frozen snapshot of the PRE-REDESIGN theme-role dictionary (sk-285.7 T002).
 *
 * This module is a photograph, not a registry. It records what
 * `themeTokens.ts` declared **before** the sk-285.7 redesign replaced the
 * dictionary, and it is the input to three separate rules that all need
 * to know "what did the default used to be?":
 *
 *   1. **The "touched" rule (INV-11, plan decision R5).** A saved theme
 *      stores a flat snapshot of every role — there is no separate
 *      record of what the user actually edited. The only available
 *      signal of a deliberate setting is therefore: the value in the
 *      snapshot differs from the value the OLD default had. Structural
 *      roles (text sizes, line heights, spacing, radii, control widths)
 *      are re-seeded with the new defaults ONLY when they still equal
 *      their old default; anything else is the user's own choice and
 *      survives the migration untouched. Comparing against the NEW
 *      default instead would re-seed exactly the values a user had
 *      deliberately set, which is the failure US-3 exists to prevent.
 *
 *   2. **Reference resolution (INV-13, plan decision R6).** Some values
 *      here are not literals but references to another role —
 *      `--status-standing: var(--accent-cyan)`, `--font-size-meta:
 *      var(--font-xs)`. A saved theme copied those strings verbatim, so
 *      after the dictionary changes they would point at roles that no
 *      longer exist. Migration first tries to re-point such a value at
 *      the successor role; where there is no unambiguous successor it
 *      resolves the reference against THIS table into a concrete value.
 *
 *   3. **Leftover cleanup (INV-12).** Applying a theme must not leave
 *      values of the previously applied one in the document, including
 *      roles that only existed in the old dictionary.
 *      `LEGACY_TOKEN_KEYS` is the list of names to wipe that the new
 *      registry no longer knows about.
 *
 * ── Do not "update" this file ───────────────────────────────────────
 *
 * When `themeTokens.ts` changes, this file must NOT follow. Its whole
 * value is that it stays pinned to the dictionary as it was on the day
 * of the migration; editing it to match a newer registry would silently
 * redefine "the user touched this" for every saved theme and re-seed
 * settings people chose on purpose. It is frozen data with an owner
 * (the migration), not a mirror.
 *
 * ── Provenance ──────────────────────────────────────────────────────
 *
 * Generated mechanically from the live registry at the T002 commit —
 * `TOKEN_SECTIONS` bundled with esbuild, then `ALL_TOKENS` / the two
 * `defaultVariablesForBase()` maps emitted verbatim — so it is a real
 * copy, not a transcription. 61 roles, in registry order, section
 * comments preserved for readability. The temporary test next to this
 * file re-proves the snapshot against the live registry; it is deleted
 * in T003, where the registry changes and the comparison stops meaning
 * anything by construction.
 */

/**
 * Every role name the pre-redesign registry declared, in registry order
 * (Surfaces → Text → Brand → Accents → Search → Geometry → Type).
 *
 * Names only — for membership tests and for the INV-12 wipe list. The
 * values live in `LEGACY_DEFAULTS`.
 */
export const LEGACY_TOKEN_KEYS: readonly string[] = [
  // Surfaces
  "--bg-base",
  "--bg-elevated",
  "--bg-selected",
  "--bg-hover",
  "--border",
  "--border-subtle",
  "--radius-default",
  "--radius-dialog",
  "--shadow-elevation-1",
  "--shadow-elevation-2",
  // Text
  "--fg-high",
  "--fg-base",
  "--fg-low",
  "--fg-muted",
  "--fg-emphasis",
  // Brand
  "--brand",
  "--brand-text",
  "--brand-fill",
  "--brand-hover",
  "--brand-muted",
  // Accents
  "--accent-blue",
  "--accent-cyan",
  "--accent-cyan-fill",
  "--status-standing",
  "--accent-green",
  "--accent-magenta",
  "--accent-magenta-tint",
  "--accent-orange",
  "--accent-red",
  "--accent-violet",
  "--accent-yellow",
  "--accent-amber",
  "--accent-amber-fill",
  "--accent-amber-tint",
  // Search
  "--match-bg",
  "--match-fg",
  // Geometry
  "--space-xs",
  "--space-sm",
  "--space-md",
  "--space-lg",
  "--space-xl",
  "--width-sliver",
  "--width-resize",
  "--transition-fast",
  // Type
  "--font-ui",
  "--font-mono",
  "--font-xs",
  "--font-sm",
  "--font-base",
  "--font-lg",
  "--font-xl",
  "--line-tight",
  "--line-base",
  "--font-weight-normal",
  "--font-weight-medium",
  "--font-weight-semibold",
  "--font-weight-bold",
  "--font-size-meta",
  "--font-size-body",
  "--font-size-title",
  "--font-size-heading",
];

/**
 * The pre-redesign default value of every role, per base.
 *
 * Same key set and same order as `LEGACY_TOKEN_KEYS` for both bases —
 * the old registry gave every `TokenDef` both a `light` and a `dark`
 * value, including the structural roles where the two were identical.
 *
 * Values are byte-identical to the old `TokenDef.light` / `.dark`,
 * `var(--…)` references included (see reason 2 in the module docblock) —
 * they are compared for equality against saved-theme snapshots, so
 * normalising them would break the very comparison they exist for.
 */
export const LEGACY_DEFAULTS: Record<'light' | 'dark', Record<string, string>> = {
  light: {
    // Surfaces
    "--bg-base": "#ffffff",
    "--bg-elevated": "#f4f4f5",
    "--bg-selected": "rgba(203, 75, 22, 0.1)",
    "--bg-hover": "rgba(24, 24, 27, 0.05)",
    "--border": "#8b8b95",
    "--border-subtle": "#e4e4e7",
    "--radius-default": "2px",
    "--radius-dialog": "6px",
    "--shadow-elevation-1": "0 1px 2px rgba(24, 24, 27, 0.08)",
    "--shadow-elevation-2": "0 2px 8px rgba(24, 24, 27, 0.12)",
    // Text
    "--fg-high": "#27272a",
    "--fg-base": "#3f3f46",
    "--fg-low": "#52525b",
    "--fg-muted": "#6b6b76",
    "--fg-emphasis": "#18181b",
    // Brand
    "--brand": "#cb4b16",
    "--brand-text": "#b0400f",
    "--brand-fill": "#a03a11",
    "--brand-hover": "#b8440f",
    "--brand-muted": "rgba(203, 75, 22, 0.1)",
    // Accents
    "--accent-blue": "#1665d1",
    "--accent-cyan": "#0e7770",
    "--accent-cyan-fill": "#0c6a64",
    "--status-standing": "var(--accent-cyan)",
    "--accent-green": "#147a3a",
    "--accent-magenta": "#b92b73",
    "--accent-magenta-tint": "rgba(185, 43, 115, 0.07)",
    "--accent-orange": "#bb4110",
    "--accent-red": "#c32a30",
    "--accent-violet": "#6947d4",
    "--accent-yellow": "#7d6900",
    "--accent-amber": "#9a5d05",
    "--accent-amber-fill": "#875206",
    "--accent-amber-tint": "rgba(154, 93, 5, 0.1)",
    // Search
    "--match-bg": "rgba(234, 179, 8, 0.38)",
    "--match-fg": "#27272a",
    // Geometry
    "--space-xs": "2px",
    "--space-sm": "4px",
    "--space-md": "8px",
    "--space-lg": "12px",
    "--space-xl": "16px",
    "--width-sliver": "28px",
    "--width-resize": "4px",
    "--transition-fast": "80ms ease-out",
    // Type
    "--font-ui": "'Inter', system-ui, sans-serif",
    "--font-mono": "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
    "--font-xs": "12px",
    "--font-sm": "13px",
    "--font-base": "14px",
    "--font-lg": "16px",
    "--font-xl": "18px",
    "--line-tight": "1.3",
    "--line-base": "1.5",
    "--font-weight-normal": "400",
    "--font-weight-medium": "500",
    "--font-weight-semibold": "600",
    "--font-weight-bold": "700",
    "--font-size-meta": "var(--font-xs)",
    "--font-size-body": "var(--font-base)",
    "--font-size-title": "var(--font-lg)",
    "--font-size-heading": "var(--font-xl)",
  },
  dark: {
    // Surfaces
    "--bg-base": "#002b36",
    "--bg-elevated": "#073642",
    "--bg-selected": "rgba(181, 137, 0, 0.15)",
    "--bg-hover": "rgba(147, 161, 161, 0.06)",
    "--border": "#6c8288",
    "--border-subtle": "#0f4350",
    "--radius-default": "2px",
    "--radius-dialog": "6px",
    "--shadow-elevation-1": "0 1px 2px rgba(0, 0, 0, 0.3)",
    "--shadow-elevation-2": "0 2px 8px rgba(0, 0, 0, 0.5)",
    // Text
    "--fg-high": "#b3bdbc",
    "--fg-base": "#a3aeae",
    "--fg-low": "#93a1a1",
    "--fg-muted": "#839496",
    "--fg-emphasis": "#c5cdcc",
    // Brand
    "--brand": "#cb4b16",
    "--brand-text": "#ed7951",
    "--brand-fill": "#e6734b",
    "--brand-hover": "#f38660",
    "--brand-muted": "rgba(203, 75, 22, 0.18)",
    // Accents
    "--accent-blue": "#268bd2",
    "--accent-cyan": "#2aa198",
    "--accent-cyan-fill": "#2aa198",
    "--status-standing": "var(--accent-cyan)",
    "--accent-green": "#3fb950",
    "--accent-magenta": "#eb67a0",
    "--accent-magenta-tint": "rgba(235, 103, 160, 0.1)",
    "--accent-orange": "#ed7951",
    "--accent-red": "#ff6b6b",
    "--accent-violet": "#8389df",
    "--accent-yellow": "#b58900",
    "--accent-amber": "#d98a1f",
    "--accent-amber-fill": "#d98a1f",
    "--accent-amber-tint": "rgba(217, 138, 31, 0.16)",
    // Search
    "--match-bg": "rgba(181, 137, 0, 0.3)",
    "--match-fg": "#fdf6e3",
    // Geometry
    "--space-xs": "2px",
    "--space-sm": "4px",
    "--space-md": "8px",
    "--space-lg": "12px",
    "--space-xl": "16px",
    "--width-sliver": "28px",
    "--width-resize": "4px",
    "--transition-fast": "80ms ease-out",
    // Type
    "--font-ui": "'Inter', system-ui, sans-serif",
    "--font-mono": "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
    "--font-xs": "12px",
    "--font-sm": "13px",
    "--font-base": "14px",
    "--font-lg": "16px",
    "--font-xl": "18px",
    "--line-tight": "1.3",
    "--line-base": "1.5",
    "--font-weight-normal": "400",
    "--font-weight-medium": "500",
    "--font-weight-semibold": "600",
    "--font-weight-bold": "700",
    "--font-size-meta": "var(--font-xs)",
    "--font-size-body": "var(--font-base)",
    "--font-size-title": "var(--font-lg)",
    "--font-size-heading": "var(--font-xl)",
  },
};
