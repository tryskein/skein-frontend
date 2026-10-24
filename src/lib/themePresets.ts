/**
 * Font-stack presets for the theme editor (sk-10.4).
 *
 * `--font-mono` and `--font-ui` are free-form CSS strings — the user can
 * paste any stack. To make the common case painless, the editor renders
 * a `<Select>` of curated presets next to the text input. When a preset
 * is chosen, the text input is overwritten with its `stack`; if the
 * preset carries a `googleFamily`, the theme apply path injects a
 * `<link rel="stylesheet" href="fonts.googleapis.com/...">` so the font
 * actually renders.
 *
 * Why frontend-only? Backend `Theme.variables` is `Record<string,string>`
 * — it doesn't care about presets, only about the final stack. Presets
 * are purely a UI affordance. Loading them on the API would require
 * keeping a registry in sync between Go + TS for zero benefit.
 *
 * Why not load every preset's font on app start? Three reasons:
 *   1. Bandwidth — users on a self-hosted Skein with no internet
 *      shouldn't fetch Google Fonts they'll never use.
 *   2. CLS — eager loading adds layout shifts even when the theme
 *      doesn't pick the font.
 *   3. Privacy — Google sees a request per font per session; gating
 *      on user choice limits exposure to themes that explicitly opt in.
 *
 * Geist, Geist Mono, Inter and JetBrains Mono are all shipped via
 * @fontsource (imported in main.tsx) so their presets carry NO
 * `googleFamily` — the cascade picks them up from the local @font-face
 * declarations. Geist / Geist Mono are the redesign defaults
 * (`--font-ui` / `--font-mono`, sk-285.7 FR-001) and Inter /
 * JetBrains Mono remain presets, so the common case needs no network at
 * all and the default-path list of external requests does not grow.
 */

export interface FontPreset {
  /** Stable key for the Select option value. Lowercase kebab-case. */
  id: string;
  /** Display name in the dropdown. */
  label: string;
  /** Full font-stack value assigned to the CSS variable when selected. */
  stack: string;
  /**
   * Google Fonts family name. When set, the loader injects a
   * `<link rel="stylesheet">` for this family on apply. Omit for fonts
   * shipped locally (JetBrains Mono) or pure system stacks.
   */
  googleFamily?: string;
  /**
   * Comma- or semicolon-separated weight list for the Google Fonts
   * request. Defaults to `400;500;600;700` (the four weights Mantine
   * and our CSS use for regular/medium/semibold/bold rendering).
   */
  googleWeights?: string;
}

/** Default weight list used when a preset doesn't specify one. */
export const DEFAULT_GOOGLE_FONT_WEIGHTS = '400;500;600;700';

/**
 * Monospace presets — for `--font-mono`. The leading family is the
 * desired font; the rest is a defensive fallback stack so the user
 * never sees raw serif text if the network drops the Google request.
 */
export const MONO_FONT_PRESETS: FontPreset[] = [
  {
    id: 'geist-mono',
    label: 'Geist Mono',
    stack: "'Geist Mono', ui-monospace, Menlo, Consolas, monospace",
    // NO googleFamily — shipped locally via @fontsource/geist-mono
    // (imported in main.tsx). This string is byte-identical to
    // `--font-mono` in design/fable/handoff/tokens.css and becomes the
    // registry default in T006; findPreset() is an exact match, so the
    // preset, the registry and index.css must not drift apart.
  },
  {
    id: 'jetbrains-mono',
    label: 'JetBrains Mono',
    stack: "'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace",
    // NO googleFamily — shipped locally via @fontsource/jetbrains-mono.
    // The pre-redesign default; kept as a preset (FR-001).
  },
  {
    id: 'fira-code',
    label: 'Fira Code',
    stack: "'Fira Code', ui-monospace, Menlo, Consolas, monospace",
    googleFamily: 'Fira Code',
  },
  {
    id: 'ibm-plex-mono',
    label: 'IBM Plex Mono',
    stack: "'IBM Plex Mono', ui-monospace, Menlo, Consolas, monospace",
    googleFamily: 'IBM Plex Mono',
  },
  {
    id: 'source-code-pro',
    label: 'Source Code Pro',
    stack: "'Source Code Pro', ui-monospace, Menlo, Consolas, monospace",
    googleFamily: 'Source Code Pro',
  },
  {
    id: 'cascadia-code',
    label: 'Cascadia Code',
    stack: "'Cascadia Code', ui-monospace, Menlo, Consolas, monospace",
    googleFamily: 'Cascadia Code',
  },
  {
    id: 'system',
    label: 'System (mono)',
    stack: 'ui-monospace, Menlo, Consolas, monospace',
  },
];

/**
 * UI presets — for `--font-ui`. Drives general UI text (body, labels,
 * buttons, headings, menus). A monospace option is included so users
 * who want the original "all-mono" Skein look can stay there.
 */
export const UI_FONT_PRESETS: FontPreset[] = [
  {
    id: 'geist',
    label: 'Geist',
    stack: "'Geist', system-ui, sans-serif",
    // NO googleFamily — shipped locally via @fontsource/geist (imported
    // in main.tsx; family 'Geist', Cyrillic included — see the package
    // note there). Byte-identical to `--font-ui` in
    // design/fable/handoff/tokens.css and the registry default from
    // T006 on; findPreset() is an exact match.
  },
  {
    id: 'inter',
    label: 'Inter',
    stack: "'Inter', system-ui, sans-serif",
    // NO googleFamily — shipped locally via @fontsource/inter (imported
    // in main.tsx), same as JetBrains Mono. The pre-redesign default
    // `--font-ui`, kept as a preset (FR-001); the strings in index.css /
    // themeTokens.ts must match this one byte-for-byte while it is the
    // default, because findPreset() is an exact match.
  },
  {
    id: 'ibm-plex-sans',
    label: 'IBM Plex Sans',
    stack: "'IBM Plex Sans', system-ui, sans-serif",
    googleFamily: 'IBM Plex Sans',
  },
  {
    id: 'roboto',
    label: 'Roboto',
    stack: "'Roboto', system-ui, sans-serif",
    googleFamily: 'Roboto',
  },
  {
    id: 'source-sans-3',
    label: 'Source Sans 3',
    stack: "'Source Sans 3', system-ui, sans-serif",
    googleFamily: 'Source Sans 3',
  },
  {
    id: 'jetbrains-mono',
    label: 'JetBrains Mono (mono UI)',
    stack: "'JetBrains Mono', ui-monospace, monospace",
    // Local — no googleFamily.
  },
  {
    id: 'system',
    label: 'System',
    stack: 'system-ui, -apple-system, sans-serif',
  },
];

/**
 * Find the preset whose `stack` exactly matches the supplied value.
 * Exact-match keeps the lookup deterministic — fuzzy matching would
 * conflate "Inter, sans-serif" with "Inter, system-ui, sans-serif" and
 * silently rewrite the user's chosen stack on the next render.
 *
 * Returns `null` when no preset matches — the editor falls back to a
 * "Custom" Select entry and the text input stays canonical.
 */
export function findPreset(
  stack: string | null | undefined,
  presets: readonly FontPreset[],
): FontPreset | null {
  if (!stack) return null;
  for (const p of presets) {
    if (p.stack === stack) return p;
  }
  return null;
}
