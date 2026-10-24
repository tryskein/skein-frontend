import type { FontPreset } from './themePresets';
import { MONO_FONT_PRESETS, UI_FONT_PRESETS } from './themePresets';

/**
 * Canonical catalog of CSS custom properties exposed by the theme system.
 *
 * Source of truth is the `:root, [data-theme='light']` and
 * `[data-theme='dark']` blocks at the top of `src/index.css` — this
 * module mirrors those declarations so the editor knows what controls
 * to render and the "apply theme" path knows which keys to wipe when
 * switching back to builtin.
 *
 * ── sk-285.7 (T003) — the dictionary was REPLACED, not extended ──────
 *
 * The pre-redesign dictionary (Solarized-descended dark + a white light
 * column bolted on beside it, 61 roles named after what they painted:
 * `--bg-base`, `--fg-low`, `--brand-fill`, `--accent-cyan`) is gone. The
 * roles below come from the Stage 2.2 design handoff —
 * its token sheet and README §3 — and are named
 * after what they MEAN: a neutral ramp (`--n-50…--n-900`) that the
 * surface and ink roles are cut from, one `--primary` family, one
 * `--secondary`, an `--accent` reserved for the logo and HOT ZONE, the
 * four status hues `--ok / --warn / --err / --info` with their tints,
 * `--violet` for epics, and `--focus` for the focus ring.
 *
 * Three consequences worth stating out loud, because each of them is a
 * decision someone will otherwise try to "fix":
 *
 *   1. **No alias layer.** Old names are not kept pointing at new ones
 *      (plan decision R3). An alias would put two editable entries on
 *      one role in the theme editor and in Inspect, which is exactly the
 *      doubling FR-004 forbids; and outside the registry an alias is a
 *      value no theme can reach. Every call site moved (T004).
 *   2. **Ownership is a declared field, not a guess** (`owner`, plan
 *      decision R4 for INV-11). See the `TokenDef.owner` docs below.
 *   3. **Roles with no counterpart in the new language are retired**,
 *      by name and with a reason, in `RETIRED_ROLES` at the bottom of
 *      this file. INV-8 allows exactly that and nothing more: a role
 *      that HAS a counterpart must survive, under its own name or its
 *      successor's, and `predecessors` on each `TokenDef` records which.
 *
 * ── What this file does NOT own ─────────────────────────────────────
 *
 * The redesign lands in phases and this file only holds the values its
 * own phase set. T003/T004 brought the COLOUR values; T006 brought the
 * TYPE values (Geist stacks, scale 12/14/16/20/24/32/48, the seven-step
 * line-height ramp). Still pre-redesign and still owed: the spacing /
 * radius / height scale, which is T007's — those roles carry their old
 * values under their new names until it lands.
 *
 * ── Declared here, not yet painting anything ────────────────────────
 *
 * The same phasing leaves some roles DECLARED and editable before the
 * surface that spends them exists. They are listed by name below,
 * because a catalog that names only the one it happens to remember
 * reads as "everything else is wired up", and a user who retunes one of
 * these in the editor sees nothing move. Counts verified by grepping
 * each name's own `var(…)` call sites across `src/` — all zero as of
 * sk-285.7.2.32 (T031), which is also when three names left this list
 * and two were found never to have belonged on it:
 *
 *   (--surface)                REMOVED. This entry claimed zero call
 *                              sites and was wrong when written: the
 *                              surfaces phase had already spent it, and
 *                              at the T031 baseline `index.css` named it
 *                              14 times. Left here as a struck entry
 *                              rather than deleted, because "the list
 *                              shrank" and "the list was never right"
 *                              are different facts and only the second
 *                              one warns the next reader to re-grep
 *                              instead of trusting the column.
 *   (--accent, --accent-text,  REMOVED by T031. All three now paint the
 *    --accent-t)               HOT ZONE: `--accent-text` the 48/700
 *                              heading, the ember Top-5 count and the
 *                              `dep` ticker badge; `--accent` the bronze
 *                              podium edge, the header rule and the
 *                              human-axis Top-5 bar (it is the ≥3:1 UI
 *                              grade, so it never carries text);
 *                              `--accent-t` the header's hatching. Their
 *                              `selectors: []` is lifted with the entry.
 *                              The OTHER half of the handoff's §3
 *                              reservation — the logo mark — landed with
 *                              sk-285.7.2.38: `--accent` paints the
 *                              mark's two ember bands and `--accent-text`
 *                              the wordmark on hover. Nothing is left of
 *                              this row; it is kept struck because "the
 *                              list shrank" and "the list was never
 *                              right" are different facts.
 *   --ok-t, --err-t            The success / error washes. The plan
 *                              assigns them NO task by name; the
 *                              surfaces that would wear them (a passing
 *                              gate, an error plate) belong to T026 and
 *                              T030. Stated as an unknown rather than
 *                              guessed: the other six tints are spent,
 *                              these two are not.
 *   --n-400, --n-800           Two steps of the ramp with no role cut
 *                              from them yet. The ramp is declared whole
 *                              (handoff §3) so retuning it moves
 *                              everything derived from it in one pass;
 *                              a ten-step ramp missing two steps is not
 *                              a ramp.
 *
 * The list above is colour, because colour is all the phasing left
 * unspent when it was written. sk-285.7 T006 declared the type scale and
 * the line-height ramp whole for exactly the reason the neutral ramp is
 * declared whole, and eight TYPE roles landed in the same state without
 * being written down here. They are:
 *
 *   (--font-3xl, --line-h1,    REMOVED by T031. All three landed on the
 *    --tracking-display)       one 48/700 display heading the handoff
 *                              draws — `h1.hotzone-title` — which is
 *                              also the only place §6 asks for that
 *                              step. They are spent together or not at
 *                              all: a 48px heading at the 16px body
 *                              leading, or without the −0.02em §2 rides
 *                              on that step, is not the heading drawn.
 *   (--line-h3)                REMOVED. Like --surface above, this entry
 *                              claimed zero call sites and was wrong
 *                              when written: `.issue-title-input`
 *                              already named it at the T031 baseline.
 *                              T030 may well spend it AGAIN on the
 *                              Task-description title, but "no surface
 *                              has it yet" was not true.
 *   --font-2xl, --line-h2      The 32px step and its leading. Stated as
 *                              an UNKNOWN rather than guessed: §2 names
 *                              the step, and no surface in §6 and no
 *                              task in the plan asks for 32px type. The
 *                              scale is declared whole so the editor can
 *                              show one complete set; the surface that
 *                              spends it may not exist yet.
 *   --line-small               The 1.45 leading of the 14px band. No
 *                              task names it: the 14px surfaces belong
 *                              to the whole T026–T031 phase, and each
 *                              picks up its own leading there.
 *   --line-caption             The 1.4 leading of the 12px band — and
 *                              the one entry here that is not merely
 *                              unspent. The sheet writes 1.4 as a bare
 *                              literal (20 rules at the T031 baseline;
 *                              the note said seventeen and had not been
 *                              recounted since), so the value is
 *                              painting everywhere while the ROLE paints
 *                              nothing, and retuning it in the editor
 *                              moves none of them. Those literals are
 *                              not band-aligned (several sit on 14px
 *                              controls, whose band is --line-small at
 *                              1.45), so they cannot be swapped for the
 *                              token wholesale without naming a 14px
 *                              control "caption". Each one is its own
 *                              surface's decision, and the surfaces are
 *                              T026–T030 — T031 is closed and moved
 *                              none of them, because HOT ZONE's own
 *                              leadings are h1 and the mono body.
 *
 * The other three tracking roles are NOT here: --tracking-caption (73
 * call sites), --tracking-label (5) and --tracking-heading (3) were
 * wired to their surfaces when they were declared.
 *
 * Layout (sk-10.3 — Designer-style):
 *
 *   Tokens are grouped into UI-ZONE SECTIONS (Neutrals / Surfaces /
 *   Text / Brand / Accents / Search / Geometry / Type) instead of
 *   value-type buckets. Sections carry CSS selectors so the editor can
 *   broadcast a "highlight section X" message and the parent window can
 *   outline the matching elements live.
 *
 *   Backend storage is unchanged — `Theme.variables` is still a flat
 *   `Record<string, string>` keyed by CSS-variable name. Sections are
 *   purely a UI grouping concern.
 *
 * Why duplicate the list in TypeScript rather than parse the CSS at
 * runtime? Two reasons:
 *   1. The editor needs per-variable metadata (kind, owner, default per
 *      base, label, selectors) that the raw CSS doesn't carry.
 *   2. Parsing CSS in the browser is ~30 lines of code for what's
 *      conceptually a static array — keeping it explicit makes adding a
 *      new variable a one-line change in two places (the CSS and here).
 *
 * If the CSS file gains or loses a variable, this module MUST be updated
 * in the same commit.
 *
 * ── sk-285.1.6 — what "fully themeable" means here ───────────────────
 *
 * SCOPE: colour, typography and the density roles the registry already
 * carried (spacing, radii, control widths). Per-entity styling is
 * deliberately NOT part of the MCP-facing surface.
 *
 * Within that scope the invariant is: NOTHING that paints a colour or
 * picks a font may be written as a literal outside this catalog. That
 * covers `src/index.css`, `src/legacy.css`, inline `style={{…}}` in
 * `.tsx`, AND `src/theme.ts` — the Mantine colour tuples used to be
 * frozen hex, which meant `color="orange"` controls ignored the brand
 * entirely; they are now `var(…)`-derived.
 *
 * Values are allowed to DERIVE from a token (`color-mix(in srgb,
 * var(--info) 14%, transparent)`, `var(--n-100)`) — that still tracks
 * the theme. What is banned is a raw `#hex` / `rgb()` / font stack that
 * the theme cannot reach.
 *
 * CONSCIOUS EXCEPTIONS — audited, intentionally left as literals:
 *
 *   1. (retired by T031 — kept as a numbered gap so exceptions 2–8 do
 *      not renumber under the tests and docblocks that cite them.)
 *      HOT ZONE / activity dashboard (`.activity-*` in index.css) used
 *      to be a deliberately theme-INDEPENDENT decorative war-room
 *      palette. It is not one any more: sk-285.7.2.32 moved the fire
 *      gradient, the podium medals, the per-metric stats, the priority
 *      ramp, the eight project buckets, the ticker badges and the race
 *      chart's per-user lines onto the shared roles, and `.activity-*`
 *      now declares no colour literal at all.
 *   2. Theme-editor tooling overlays — the `#E53935` section-highlight
 *      ring (`lib/useTheme.ts`) and the `#00D7B0` inspect ring
 *      (`lib/useInspectMode.ts`). These must stay legible ON TOP of
 *      whatever theme is being authored, including one that retunes
 *      every accent; theming them would let a skin hide its own editor.
 *   3. `Avatar.tsx` PALETTE — a per-entity identity palette hashed from
 *      the username. Per-entity styling is out of scope by definition,
 *      and the colours must be stable across themes so a given user
 *      keeps the same chip. (Handoff §8 keeps it as-is.)
 *      sk-371 extended this entry to the chip's INK and to the `system`
 *      ground, which were `var(--skein-fg)` and `var(--skein-fg-muted)`
 *      — theme-varying roles pinned on top of a theme-INVARIANT ground.
 *      That pairing is what put the rendered chip at 4.10:1 (and at
 *      1.51:1 inside `.col-details`, where `--skein-fg` is rebound to
 *      `--ink`). Measured, no single ink clears 4.5:1 on all eight
 *      shades — pure white peaks at 4.27 on `#c25e25` — so the ink is
 *      picked per ground by `inkForGround`, and both sides of every pair
 *      are now literals (measured at sk-285.7).
 *   4. `--skein-*` (src/legacy.css) — the legacy CRT palette behind
 *      `/legacy/*`, a separate token family scheduled for retirement.
 *      It is not exposed to MCP on purpose; every legacy widget that
 *      renders inside the new shell has its `--skein-*` rebound onto
 *      the tokens below by the `.col-details` block in index.css.
 *   5. Gradients / masks that do not read as text or chrome
 *      (`mask-image: linear-gradient(90deg, #000 82%, transparent)`) —
 *      luminance stops, not palette choices.
 *   6. Drag-shadow literals on the kanban card (`box-shadow: 0 4px 12px
 *      rgba(0, 0, 0, 0.25)`) — a lift cue under the pointer, not a
 *      surface colour; the shadow ROLES are `--shadow-popover` /
 *      `--shadow-segment` below.
 *
 * Exceptions 7 and 8 were `SkeinMark.tsx`'s four fixed ember shades and
 * `LanguageSwitcher.tsx`'s two flag SVGs. Both are GONE rather than
 * re-owned. The flags became a mono language tag that takes the ink
 * roles like any other label. The mark is a yarn ball again (sk-550), but
 * its shades are no longer literals: the ball and its loose thread are
 * `--accent`, and the wraps and sheen are mixed FROM `--accent`
 * (`index.css#.skein-mark-wrap`), so they follow the role. There is one
 * literal palette left in the shell — the favicon's, which is a separate
 * document the page's variables cannot reach; its hexes are the light
 * and dark values of `--accent` and the same mixes, written out.
 *
 * ── sk-363 — handoff names this shell deliberately does NOT declare ──
 *
 * The exceptions above are literals we chose not to TOKENISE. This list
 * is the mirror image: three custom properties the design handoff's
 * token sheet declares in its base `:root` (lines 50, 51, 54) that exist
 * NOWHERE in this shell — not in the registry below, not in
 * `src/index.css`. The other 86 handoff roles are here byte for byte, so
 * an unexplained absence is indistinguishable from an oversight, and
 * that ambiguity is the whole defect this entry closes. Each of the
 * three is a DECISION, and two of them cannot be undone by pasting the
 * handoff line back:
 *
 *   A. `--bp-tablet: 768px` — landed under a better name. T016 declares
 *      the very same 768px as `--bp-mobile` (`index.css`, beside
 *      `--app-min-width`), and the plan's name is the accurate one: the
 *      threshold separates MOBILE from tablet rather than "starting"
 *      tablet. Declaring `--bp-tablet` too would be a second name for
 *      one number — the duplicated input FR-004 forbids — so
 *      `useWidthMode.test.ts` asserts the name stays absent. Note it is
 *      a layout MECHANISM and not a role either way: the reason it is
 *      not in the registry below is recorded against `--bp-mobile` in
 *      `NON_ROLE_DECLARATIONS`.
 *
 *   B. `--bp-desktop: 1024px` — the boundary was retired, not mislaid.
 *      Spec Changelog [2026-09-05] stretched tablet UP TO THE FLOOR so
 *      that raising the floor would not push 1280/1366 laptops into
 *      horizontal panning; US-7 now reads "tablet — from its threshold
 *      to the floor, desktop — from the floor". 1024 is therefore not a
 *      mode boundary in this model at all, and re-declaring it would
 *      resurrect a border the spec deliberately removed. Were the token
 *      ever wanted, its value would have to BE the floor — at which
 *      point it just duplicates `--app-min-width`.
 *
 *   C. `--tooltip-delay: 0ms` — the value is an invariant, and an
 *      invariant must not be an editable knob. INV-7 (from
 *      the project guidelines, Tooltips) requires the delay to be zero
 *      unconditionally; `SkeinTooltip.tsx` encodes that as
 *      `useHover(…, { delay: { open: 0, close: 0 }, restMs: 0 })` and
 *      accepts no per-call-site override, and `DetailsSurface.test.tsx`
 *      keeps every call site inside that wrapper. A theme role for the
 *      delay would hand the user a control whose only non-default
 *      setting breaks the invariant. It would also be inert: the delay
 *      is read by a JS hook, not by a declaration, so nothing in the
 *      stylesheet could consume the property.
 *
 * Reintroducing one is a deliberate edit that has to revisit this text.
 */

/** Kind hint for the editor — picks the input widget. */
export type TokenKind = 'color' | 'text';

/**
 * Ownership class (INV-11, plan decision R4).
 *
 * Declared per role rather than inferred from the name or the `kind`,
 * because neither carries the answer: font stacks and shadows are
 * `kind: 'text'` yet belong to the user, and a name says nothing at all.
 * The field is REQUIRED, so "a role in neither class" is a compile
 * error rather than a migration that silently drops it.
 *
 *   - `'user'` — colours, font stacks, transition durations, shadows.
 *     A saved theme's value for these is a deliberate authoring choice
 *     and migrates across verbatim.
 *   - `'structural'` — text sizes, line heights, weights, spacing,
 *     radii, control widths. These carry the redesign itself, so they
 *     are re-seeded with the new defaults — but ONLY where the saved
 *     value still equals the OLD default, i.e. where the user never
 *     touched them (plan decision R5). A value that differs is the
 *     user's own setting and survives.
 */
export type TokenOwner = 'user' | 'structural';

export interface TokenDef {
  /** Full CSS custom-property name including the leading `--`. */
  key: string;
  /** Human-readable label for the editor. */
  label: string;
  /** Picks an `<input type=color>` (color) or text field (text). */
  kind: TokenKind;
  /** Ownership class — see {@link TokenOwner}. Required (INV-11). */
  owner: TokenOwner;
  /** Default value when base = 'light'. */
  light: string;
  /** Default value when base = 'dark'. */
  dark: string;
  /**
   * Pre-redesign role names this role succeeds (sk-285.7, INV-8).
   *
   * Read as "a saved theme's value for THESE keys belongs to this role
   * now". Several old roles may land on one new role (the ink ramp went
   * from five steps to three, the brand from three grades to one), which
   * is why this is a list and not a single name.
   *
   * Omitted means the role is NEW: it had no counterpart in the old
   * dictionary, so a migrated theme gets the builtin value of its own
   * base for it (INV-9) rather than anything carried over.
   *
   * Together with `RETIRED_ROLES` this must cover `LEGACY_TOKEN_KEYS`
   * exactly — every old role either has a successor here or is retired
   * with a reason there, and never both. `themeTokens.test.ts` proves it.
   */
  predecessors?: readonly string[];
  /** Optional helper sentence rendered under the input. */
  hint?: string;
  /**
   * Per-token CSS selectors. When set, hovering this token's row in the
   * editor broadcasts THESE selectors to the parent window (overriding
   * the section-level defaults). When unset, the parent falls back to
   * the section's selectors.
   *
   * Only set for tokens whose effect is visible on a SPECIFIC element
   * (e.g. `--ok` lights up the epic-progress fill). Tokens whose effect
   * spans the section (e.g. `--bg` paints the whole shell) inherit
   * section-level selectors.
   *
   * An EMPTY array is a third, deliberate state: "this role paints
   * nothing yet". Unset falls back to the section, which for a role
   * with no call sites is a false promise — Inspect would name it on an
   * element it does not touch. See `--accent`.
   */
  selectors?: string[];
  /**
   * Optional list of curated font-stack presets. When set, the editor
   * renders a `<Select>` of these options next to the text input;
   * picking one overwrites the variable with the preset's `stack` and
   * (for Google-hosted families) triggers a `<link rel="stylesheet">`
   * injection. Only meaningful for `kind:'text'` typography tokens —
   * currently `--font-ui` and `--font-mono`.
   */
  presets?: readonly FontPreset[];
}

/**
 * UI-zone section. `selectors` light up in the parent window whenever
 * this section is active OR hovered in the editor sidebar.
 */
export interface TokenSection {
  /** Stable id — persisted in localStorage and broadcast on the wire. */
  id: string;
  /** Human-readable sidebar label. */
  label: string;
  /** One-line tooltip / description rendered in the main pane header. */
  description: string;
  /** CSS selectors of elements affected by tokens in this section. */
  selectors: string[];
  /** Tokens that live in this section. */
  tokens: TokenDef[];
}

/**
 * The 8 UI-zone sections.
 *
 * Selector verification (grepped against `src/index.css` and `src/**.tsx`):
 *   - confirmed: `.shell-root`, `.col-details`, `.task-card`,
 *     `.inbox-card`, `.task-tree-node-row`, `.mantine-Modal-content`,
 *     `.settings-panel`, `.header-bar`, `.action-button.primary`,
 *     `.filter-chip`, `.header-status.status-in-progress`,
 *     `.epic-ring-done`, `.task-card.is-epic`,
 *     `.task-card-title-text`, `.task-card-dep-icon`,
 *     `.match-highlight`, `mark`, `.issue-id-badge`,
 *     `.header-logo-link`, `.header-priority`,
 *     `.header-status`, `.header-badge`, `.action-button.danger`,
 *     `.issue-title-input`, `body`, `a`, `.task-card.is-standing`,
 *     `.task-tree-node-row.is-standing`, `.lens-toggle.budilnik.active`,
 *     `.budilnik-badge`, `.outbox-card-event-time`, `.markdown-render`,
 *     `.task-card-title-block`, `.settings-tab`,
 *     `.theme-editor-tab.active`.
 */
export const TOKEN_SECTIONS: TokenSection[] = [
  {
    id: 'neutrals',
    label: 'Neutrals',
    description:
      'The ten-step neutral ramp every surface and ink role is cut from. Editing a step moves everything derived from it — retune the ramp to reskin the whole shell in one pass.',
    selectors: ['.shell-root', 'body'],
    tokens: [
      { key: '--n-50', label: 'Neutral 50', kind: 'color', owner: 'user', light: '#ffffff', dark: '#141210' },
      { key: '--n-100', label: 'Neutral 100', kind: 'color', owner: 'user', light: '#f6f4f1', dark: '#1c1917' },
      { key: '--n-200', label: 'Neutral 200', kind: 'color', owner: 'user', light: '#efece7', dark: '#26221e' },
      { key: '--n-300', label: 'Neutral 300', kind: 'color', owner: 'user', light: '#e2ddd6', dark: '#33302b' },
      { key: '--n-400', label: 'Neutral 400', kind: 'color', owner: 'user', light: '#c6bfb6', dark: '#4a453f' },
      { key: '--n-500', label: 'Neutral 500', kind: 'color', owner: 'user', light: '#8c847b', dark: '#7d766d' },
      { key: '--n-600', label: 'Neutral 600', kind: 'color', owner: 'user', light: '#6a635b', dark: '#a2998f' },
      { key: '--n-700', label: 'Neutral 700', kind: 'color', owner: 'user', light: '#46413b', dark: '#cfc7be' },
      { key: '--n-800', label: 'Neutral 800', kind: 'color', owner: 'user', light: '#2b2622', dark: '#e6e0d9' },
      { key: '--n-900', label: 'Neutral 900', kind: 'color', owner: 'user', light: '#1c1917', dark: '#f3eee8' },
    ],
  },
  {
    id: 'surfaces',
    label: 'Surfaces',
    description:
      'Page background, card surface, elevated plates, hairlines and control outlines, radii and elevation shadows. Affects every framed surface.',
    selectors: [
      '.shell-root',
      '.col-details',
      '.task-card',
      '.inbox-card',
      '.task-tree-node-row',
      '.mantine-Modal-content',
      '.settings-panel',
      '.header-bar',
    ],
    tokens: [
      {
        key: '--bg',
        label: 'Page background',
        kind: 'text',
        owner: 'user',
        light: 'var(--n-100)',
        dark: 'var(--n-50)',
        predecessors: ['--bg-base'],
        hint: 'The page and the columns. Cards and panels sit on --surface, one step off this.',
      },
      {
        key: '--surface',
        label: 'Card surface',
        kind: 'text',
        owner: 'user',
        light: 'var(--n-50)',
        dark: 'var(--n-100)',
        hint: 'Cards, header, fields, the Details panel — the plate the page background is read against.',
        // Declared and themeable from T004; the surfaces that will SIT on
        // it are re-pointed here by the surfaces phase (T026 cards, T027
        // columns, T028 tree, T029 board, T030 details), which is where
        // the design assigns each one. Until then the shell paints on
        // --bg and cards are told apart by their --line outline, exactly
        // as they were before the redesign.
      },
      {
        key: '--elev',
        label: 'Elevated / inactive plate',
        kind: 'text',
        owner: 'user',
        light: 'var(--n-200)',
        dark: 'var(--n-200)',
        predecessors: ['--bg-elevated', '--bg-hover'],
        hint: 'Segment controls, disabled and deferred plates, hover wash.',
      },
      {
        key: '--line',
        label: 'Hairline',
        kind: 'text',
        owner: 'user',
        light: 'var(--n-300)',
        dark: 'var(--n-300)',
        predecessors: ['--border-subtle'],
        hint: 'Decorative separators between rows and zones — exempt from the 3:1 bar.',
      },
      {
        key: '--line-2',
        label: 'Control outline',
        kind: 'text',
        owner: 'user',
        light: 'var(--n-500)',
        dark: 'var(--n-500)',
        predecessors: ['--border'],
        hint: 'Outlines real controls — keep it ≥3:1 against both surfaces.',
      },
      {
        key: '--radius-control',
        label: 'Control radius',
        kind: 'text',
        owner: 'structural',
        light: '6px',
        dark: '6px',
        predecessors: ['--radius-default'],
        hint: 'Buttons, inputs, segment controls — handoff §4 (6px).',
      },
      {
        key: '--radius-card',
        label: 'Card radius',
        kind: 'text',
        owner: 'structural',
        light: '8px',
        dark: '8px',
        // No predecessor: the pre-reform sheet had two radii (control /
        // dialog) and cut cards with whichever was nearer. A role with
        // no predecessor is seeded from the built-in theme at migration
        // (INV-9) rather than guessed from a neighbour.
        hint: 'Task and inbox cards — handoff §4 (8px).',
      },
      {
        key: '--radius-panel',
        label: 'Panel / dialog radius',
        kind: 'text',
        owner: 'structural',
        light: '12px',
        dark: '12px',
        predecessors: ['--radius-dialog'],
        hint: 'Popovers, menus, dialogs — handoff §4 (12px).',
      },
      {
        key: '--radius-pill',
        label: 'Pill radius',
        kind: 'text',
        owner: 'structural',
        light: '999px',
        dark: '999px',
        // 999px, not 50%: half of a box wider than it is tall is an
        // ellipse, and every pill in this language (badge, lens, filter
        // chip) is exactly that box. An over-large radius clamps to the
        // stadium the handoff draws.
        hint: 'Badges, lenses, filter chips — the stadium corner (handoff §4).',
      },
      {
        key: '--shadow-segment',
        label: 'Shadow (segment)',
        kind: 'text',
        owner: 'user',
        light: '0 1px 2px rgba(20, 18, 16, 0.12)',
        dark: '0 1px 2px rgba(0, 0, 0, 0.30)',
        predecessors: ['--shadow-elevation-1'],
        selectors: ['.task-card', '.inbox-card'],
      },
      {
        key: '--shadow-popover',
        label: 'Shadow (popover)',
        kind: 'text',
        owner: 'user',
        light: '0 8px 24px rgba(20, 18, 16, 0.16)',
        dark: '0 8px 24px rgba(0, 0, 0, 0.40)',
        predecessors: ['--shadow-elevation-2'],
        selectors: ['.mantine-Modal-content'],
      },
    ],
  },
  {
    id: 'text',
    label: 'Text',
    description:
      'The three ink steps — primary, secondary, muted. Global; affects every rendered glyph. All three clear AA on --bg and --surface in both themes.',
    selectors: ['body'],
    tokens: [
      {
        key: '--ink',
        label: 'Text primary',
        kind: 'text',
        owner: 'user',
        light: 'var(--n-900)',
        dark: 'var(--n-900)',
        predecessors: ['--fg-high', '--fg-emphasis'],
        hint: 'Titles and body copy that should land first. On --bg: 15.9:1 light, 16.2:1 dark (17.5 / 15.2 on --surface). Recomputed from the values above — the handoff\u2019s own 16.4 / 16.1 do not reproduce from them.',
      },
      {
        key: '--ink-2',
        label: 'Text secondary',
        kind: 'text',
        owner: 'user',
        light: 'var(--n-700)',
        dark: 'var(--n-700)',
        predecessors: ['--fg-base', '--fg-low'],
        hint: 'Running text and values. On --bg: 9.2:1 light, 11.2:1 dark (10.1 / 10.5 on --surface).',
      },
      {
        key: '--ink-3',
        label: 'Text muted',
        kind: 'text',
        owner: 'user',
        light: 'var(--n-600)',
        dark: 'var(--n-600)',
        predecessors: ['--fg-muted'],
        hint: 'Meta, counters, placeholders. On --bg: 5.4:1 light, 6.7:1 dark (5.9 / 6.2 on --surface) \u2014 the tightest of the three, so retune it last.',
      },
    ],
  },
  {
    id: 'brand',
    label: 'Brand',
    description:
      'The oxblood primary family — primary buttons, active pills and lenses, issue ids, the selected-row wash.',
    // `.header-status.status-in-progress` was here and is gone (sk-285.7):
    // since sk-285.1.5 the per-status colours live in the one <Attribute>
    // chip every surface renders, and the `status-*` class survives only as
    // a state hook — the sole rule still naming it is a forced-colors
    // outline, which paints no role of ours at all. Inspect on the status
    // trigger would therefore have offered the whole brand family
    // (--primary-h, --primary-t, --on-primary) as "what paints this". The
    // role that actually does is `--info`, which names the same selector
    // personally further down, and that one stays.
    // sk-414.7 — `.filter-pill.active` stood here as the second example
    // of a brand FILL. It is gone: the product's one filter chip marks
    // its picked state with a `--primary` outline over a `--primary-t`
    // ground, which is the tint's example and not the fill's. The link
    // beside it is what still shows `--primary` as ink.
    selectors: ['.action-button.primary', 'a', '.filter-chip[aria-pressed=\'true\']'],
    tokens: [
      {
        key: '--primary',
        label: 'Primary',
        kind: 'color',
        owner: 'user',
        light: '#8a2d2d',
        dark: '#e49090',
        predecessors: ['--brand', '--brand-text', '--brand-fill'],
        hint: 'One grade for text AND fill. On dark the fill is LIGHTER than the text on it — pair it with --on-primary, never with --ink.',
        selectors: ['.action-button.primary', '.issue-id-badge'],
      },
      {
        key: '--primary-h',
        label: 'Primary hover',
        kind: 'color',
        owner: 'user',
        light: '#6f2222',
        dark: '#ee9f9f',
        predecessors: ['--brand-hover'],
      },
      {
        key: '--primary-t',
        label: 'Primary tint',
        kind: 'text',
        owner: 'user',
        light: 'rgba(138, 45, 45, 0.09)',
        dark: 'rgba(227, 139, 139, 0.14)',
        predecessors: ['--brand-muted', '--bg-selected'],
        hint: 'The selected-row wash, the ghost-button hover, and the ground under a picked filter chip.',
        selectors: ['.filter-chip[aria-pressed=\'true\']'],
      },
      {
        key: '--on-primary',
        label: 'Text on primary',
        kind: 'color',
        owner: 'user',
        light: '#ffffff',
        dark: '#2a0f0f',
        selectors: ['.action-button.primary'],
      },
    ],
  },
  {
    id: 'accents',
    label: 'Accents',
    description:
      'Semantic hues — standing status, the logo / HOT ZONE ember, the four status colours with their tints, the epic violet, and the focus ring.',
    selectors: [
      '.task-card-dep-icon',
      '.header-priority',
      '.header-status',
      '.epic-ring-done',
      '.task-card.is-epic',
    ],
    tokens: [
      {
        key: '--secondary',
        label: 'Secondary (teal)',
        kind: 'color',
        owner: 'user',
        light: '#1f5f66',
        dark: '#6fc4cd',
        predecessors: ['--accent-cyan', '--accent-cyan-fill', '--status-standing'],
        hint: 'Standing (∞) status and the On-me lens.',
        selectors: ['.task-card.is-standing', '.task-tree-node-row.is-standing'],
      },
      {
        key: '--secondary-t',
        label: 'Secondary tint',
        kind: 'text',
        owner: 'user',
        light: 'rgba(31, 95, 102, 0.10)',
        dark: 'rgba(111, 196, 205, 0.14)',
      },
      {
        key: '--accent',
        label: 'Accent (ember)',
        kind: 'color',
        owner: 'user',
        light: '#d2521a',
        dark: '#f0834d',
        hint: 'Reserved for the logo mark and HOT ZONE (handoff §3) — both halves are painted now. The ≥3:1 UI grade — borders, bars, rules, the mark; text takes --accent-text. Ordinary chrome uses --primary.',
        // Filled in by T031, completed by sk-285.7.2.38. The list was
        // EMPTY ON PURPOSE before T031 — `.header-logo-link` had been
        // declared here while the logo was still painted from
        // SkeinMark.tsx's fixed ember shades, so Inspect told the user
        // this role paints the logo, they edited it, and nothing moved.
        // Leaving the key off was not the fix either: the lookup falls
        // back to the SECTION's selectors (`.task-card-dep-icon`,
        // `.header-status`, …), which this role paints even less.
        //
        // `.header-logo-mark` is on the list now, and this time the
        // promise is real: every part of the yarn ball is painted from
        // this role (`index.css#.skein-mark-ball` and the rules after
        // it), so editing the role in the theme editor moves the logo.
        selectors: [
          '.header-logo-mark',
          '.activity-dashboard-header-hotzone',
          '.activity-podium-card.place-3',
          '.activity-leaderboard.kind-closed-human-driven .activity-leaderboard-bar',
        ],
      },
      {
        key: '--accent-text',
        label: 'Accent (text)',
        kind: 'color',
        owner: 'user',
        light: '#9b390e',
        dark: '#f59a6c',
        hint: 'The ≥4.5:1 text grade of the ember. HOT ZONE headline and its text-carrying accents, and the wordmark under the pointer; --accent is the non-text grade.',
        selectors: [
          '.header-logo-link:hover',
          '.activity-dashboard-title h1.hotzone-title',
          '.activity-leaderboard.kind-closed-human-driven .activity-leaderboard-count',
          '.activity-ticker-type-badge.type-dep',
          '.activity-now-project.proj-1',
        ],
      },
      {
        key: '--accent-t',
        label: 'Accent tint',
        kind: 'text',
        owner: 'user',
        light: 'rgba(210, 82, 26, 0.12)',
        dark: 'rgba(240, 131, 77, 0.16)',
        hint: 'The ember wash — the hatching along the bottom edge of the HOT ZONE header.',
        selectors: ['.activity-dashboard-header-hotzone'],
      },
      {
        key: '--ok',
        label: 'Success',
        kind: 'color',
        owner: 'user',
        // sk-368 — one step darker than the handoff's first cut, LIGHT
        // ONLY. The old #1f7a3f could not carry text on the two grounds
        // this product actually paints it on: 4.22:1 on a selected
        // project row and 3.90:1 on its own chip tint over `--elev`.
        // The arithmetic and the full before/after table live beside the
        // declaration in index.css; the amendment is recorded in
        // the design handoff.
        light: '#196534',
        dark: '#6cc98a',
        predecessors: ['--accent-green'],
        // sk-421.3 T17 — `.epic-progress-bar-fill` no longer exists:
        // the header bar was replaced by a ring, and the green in it is the
        // "closed" arc. The entry is not cosmetic: the theme editor highlights
        // live elements by this list (`applyHighlight`), and a dead
        // selector would mean that a user who picked `--ok` would
        // see no highlight at all.
        selectors: ['.header-status.status-open', '.epic-ring-done'],
      },
      {
        key: '--ok-t',
        label: 'Success tint',
        kind: 'text',
        owner: 'user',
        light: 'rgba(31, 122, 63, 0.12)',
        dark: 'rgba(108, 201, 138, 0.14)',
      },
      {
        key: '--warn',
        label: 'Warning',
        kind: 'color',
        owner: 'user',
        // sk-368 — darkened with `--ok` and for the same reason, LIGHT
        // ONLY: the status chip measured 4.21:1 on `--elev` and 4.49 on
        // `--bg`. See the note on `--ok` above.
        light: '#794e04',
        dark: '#e6a93f',
        predecessors: ['--accent-amber', '--accent-amber-fill'],
        selectors: ['.lens-toggle.budilnik.ringing', '.budilnik-badge'],
      },
      {
        key: '--warn-t',
        label: 'Warning tint',
        kind: 'text',
        owner: 'user',
        // rgb() copied verbatim from the design handoff's token sheet. It is
        // NOT the rgb of --warn above (154,93,5 vs 125,81,4); the handoff
        // declares it that way. The gap was 16/255 while both grades came
        // from the handoff untouched and is 29/255 since sk-368 darkened
        // the TEXT grade; at 14% alpha it remains a design call about the
        // WASH — which sk-368 deliberately did not re-decide, because
        // leaving the chip's ground where it was is what buys the ink its
        // contrast — not a typo to "fix" here on our own authority.
        light: 'rgba(154, 93, 5, 0.14)',
        dark: 'rgba(230, 169, 63, 0.16)',
        predecessors: ['--accent-amber-tint'],
      },
      {
        key: '--err',
        label: 'Error',
        kind: 'color',
        owner: 'user',
        light: '#a82121',
        dark: '#f38787',
        predecessors: ['--accent-red'],
        selectors: ['.action-button.danger', '.task-card-dep-icon'],
      },
      {
        key: '--err-t',
        label: 'Error tint',
        kind: 'text',
        owner: 'user',
        light: 'rgba(180, 35, 35, 0.10)',
        dark: 'rgba(242, 128, 128, 0.14)',
      },
      {
        key: '--info',
        label: 'Info',
        kind: 'color',
        owner: 'user',
        light: '#1b57a9',
        dark: '#7fb2f7',
        predecessors: ['--accent-blue'],
        // sk-421.3 T17 — the second arc of the header ring takes `--info`, and
        // the theme editor must highlight it on a par with the status chip.
        selectors: ['.header-status.status-in-progress', '.epic-ring-doing'],
      },
      {
        key: '--info-t',
        label: 'Info tint',
        kind: 'text',
        owner: 'user',
        light: 'rgba(30, 95, 184, 0.10)',
        dark: 'rgba(127, 178, 247, 0.14)',
      },
      {
        key: '--violet',
        label: 'Violet (epic)',
        kind: 'color',
        owner: 'user',
        light: '#5e39d1',
        dark: '#aa9dee',
        predecessors: ['--accent-violet'],
        selectors: ['.task-card.is-epic'],
      },
      {
        key: '--violet-t',
        label: 'Violet tint',
        kind: 'text',
        owner: 'user',
        light: 'rgba(105, 71, 212, 0.10)',
        dark: 'rgba(168, 155, 238, 0.14)',
      },
      {
        key: '--focus',
        label: 'Focus ring',
        kind: 'color',
        owner: 'user',
        light: '#1e5fb8',
        dark: '#7fb2f7',
        hint: 'The ONE colour every :focus-visible outline is drawn in (INV-5). Keep it ≥3:1 against both surfaces.',
      },
    ],
  },
  {
    id: 'search',
    label: 'Search',
    description:
      'Inline search-match highlight — background wash and its foreground, for matched substrings inside titles, comments and descriptions.',
    selectors: ['mark', '.match-highlight'],
    tokens: [
      {
        key: '--mark',
        label: 'Match background',
        kind: 'text',
        owner: 'user',
        light: 'rgba(234, 179, 8, 0.38)',
        dark: 'rgba(181, 137, 0, 0.3)',
        predecessors: ['--match-bg'],
        hint: 'The handoff palette has no search-highlight role, so this one keeps its measured wash and only changed name.',
        selectors: ['mark', '.match-highlight'],
      },
      {
        key: '--on-mark',
        label: 'Match foreground',
        kind: 'text',
        owner: 'user',
        light: 'var(--ink)',
        dark: 'var(--ink)',
        predecessors: ['--match-fg'],
        hint: 'Derives from the primary ink so a retuned neutral ramp carries the highlight with it.',
      },
    ],
  },
  {
    id: 'geometry',
    label: 'Geometry',
    description:
      'Spacing scale, the heights of the named control bands (header, column head, field, dense button), sliver / resize column widths, the touch-target size, and transition speed. Affects layout density and motion.',
    selectors: ['.shell-root', '.task-card'],
    tokens: [
      {
        key: '--space-1',
        label: 'Space 1',
        kind: 'text',
        owner: 'structural',
        light: '4px',
        dark: '4px',
        // NOT `--space-xs`: that role is retired, so its saved value does
        // not migrate here. Its CALL SITES move to this role (2px → 4px)
        // — a re-code, not a value carried over. See RETIRED_ROLES.
        predecessors: ['--space-sm'],
      },
      {
        key: '--space-2',
        label: 'Space 2',
        kind: 'text',
        owner: 'structural',
        light: '8px',
        dark: '8px',
        predecessors: ['--space-md'],
      },
      {
        key: '--space-3',
        label: 'Space 3',
        kind: 'text',
        owner: 'structural',
        light: '12px',
        dark: '12px',
        predecessors: ['--space-lg'],
      },
      {
        key: '--space-4',
        label: 'Space 4',
        kind: 'text',
        owner: 'structural',
        light: '16px',
        dark: '16px',
        predecessors: ['--space-xl'],
      },
      // The upper half of the scale (handoff §4). No predecessors: the
      // pre-reform scale stopped at 16px, so these four are new roles
      // and are seeded from the built-in theme at migration (INV-9).
      {
        key: '--space-6',
        label: 'Space 6',
        kind: 'text',
        owner: 'structural',
        light: '24px',
        dark: '24px',
      },
      {
        key: '--space-8',
        label: 'Space 8',
        kind: 'text',
        owner: 'structural',
        light: '32px',
        dark: '32px',
      },
      {
        key: '--space-12',
        label: 'Space 12',
        kind: 'text',
        owner: 'structural',
        light: '48px',
        dark: '48px',
      },
      {
        key: '--space-16',
        label: 'Space 16',
        kind: 'text',
        owner: 'structural',
        light: '64px',
        dark: '64px',
      },
      {
        key: '--tap-target',
        label: 'Touch target',
        kind: 'text',
        owner: 'structural',
        light: '44px',
        dark: '44px',
        hint: 'WCAG 2.5.5 target size for icon-only controls, fields, list and menu rows. In touch mode it is a floor the theme cannot go under (INV-4).',
      },
      // The four named bands of handoff §4/§6. Each is the height of a
      // band the language names, not a free number, so retuning one
      // moves every surface that band covers.
      {
        key: '--height-header',
        label: 'App header height',
        kind: 'text',
        owner: 'structural',
        light: '56px',
        dark: '56px',
        selectors: ['.header-bar'],
      },
      {
        key: '--height-column-head',
        label: 'Column header height',
        kind: 'text',
        owner: 'structural',
        light: '48px',
        dark: '48px',
        selectors: ['.col-header'],
      },
      {
        key: '--height-field',
        label: 'Input field height',
        kind: 'text',
        owner: 'structural',
        // A REFERENCE, not a literal 44px — the same decision
        // `--width-sliver` below carries. INV-4 puts input fields in
        // the same 44px class as icon-only buttons, list rows and
        // slivers; written as a literal, that class comes apart the
        // first time `--tap-target` is retuned.
        light: 'var(--tap-target)',
        dark: 'var(--tap-target)',
      },
      {
        key: '--height-control',
        label: 'Dense control height',
        kind: 'text',
        owner: 'structural',
        light: '36px',
        dark: '36px',
        hint: 'Text buttons in dense panels — handoff §6 requires ≥8px of clearance around them (INV-4).',
      },
      {
        key: '--width-sliver',
        label: 'Sliver column width',
        kind: 'text',
        owner: 'structural',
        // FR-005: the registry used to declare a bare `28px` here while
        // index.css declared `var(--tap-target)` — a role with two
        // different values depending on who read it. The collapsed column
        // IS one full-height button, so the stylesheet was right; the
        // registry now says the same thing, byte for byte.
        light: 'var(--tap-target)',
        dark: 'var(--tap-target)',
        predecessors: ['--width-sliver'],
      },
      {
        key: '--width-resize',
        label: 'Resize handle width',
        kind: 'text',
        owner: 'structural',
        light: '4px',
        dark: '4px',
        predecessors: ['--width-resize'],
      },
      {
        key: '--transition-fast',
        label: 'Transition (fast)',
        kind: 'text',
        owner: 'user',
        light: '80ms ease-out',
        dark: '80ms ease-out',
        predecessors: ['--transition-fast'],
      },
    ],
  },
  {
    id: 'type',
    label: 'Type',
    description:
      'Typography — UI font stack (body / labels / buttons), monospace stack (inline code / id badges), the font-size scale, line-height ramp and per-purpose weights. Global; sets the typographic voice.',
    selectors: ['body'],
    tokens: [
      {
        key: '--font-ui',
        label: 'UI stack',
        kind: 'text',
        owner: 'user',
        // Must stay byte-identical to the matching entry in UI_FONT_PRESETS
        // and to the `--font-ui` declaration in index.css — findPreset()
        // is an exact string match, so drift renders as "Custom".
        // The family is `Geist`, not `Geist Sans` — that is the name the
        // @fontsource package registers (FR-001).
        light: "'Geist', system-ui, sans-serif",
        dark: "'Geist', system-ui, sans-serif",
        predecessors: ['--font-ui'],
        presets: UI_FONT_PRESETS,
      },
      {
        key: '--font-mono',
        label: 'Monospace stack',
        kind: 'text',
        owner: 'user',
        light: "'Geist Mono', ui-monospace, Menlo, Consolas, monospace",
        dark: "'Geist Mono', ui-monospace, Menlo, Consolas, monospace",
        predecessors: ['--font-mono'],
        presets: MONO_FONT_PRESETS,
      },
      // The four `--font-size-*` semantic aliases that used to sit on top
      // of this scale are RETIRED (FR-004), so they are not listed as
      // predecessors here: their saved values do not migrate. Their call
      // sites move onto the scale step each one resolved to — same number,
      // no visual change. See RETIRED_ROLES.
      // The scale is STATIC — no step is derived from the viewport (SC-006).
      // Base 16px, steps 12/14/16/20/24/32/48 (handoff §2). `--font-2xl`
      // and `--font-3xl` are NEW roles: the pre-redesign scale stopped at
      // 18px, so they have no predecessor and the migration seeds them
      // from the built-in theme of the saved theme's base (INV-9).
      // Defaults must stay byte-identical to the declarations in index.css —
      // the editor compares strings, so drift renders an untouched default
      // as "Custom".
      { key: '--font-xs', label: 'Font size XS', kind: 'text', owner: 'structural', light: '12px', dark: '12px', predecessors: ['--font-xs'] },
      { key: '--font-sm', label: 'Font size SM', kind: 'text', owner: 'structural', light: '14px', dark: '14px', predecessors: ['--font-sm'] },
      { key: '--font-base', label: 'Font size base', kind: 'text', owner: 'structural', light: '16px', dark: '16px', predecessors: ['--font-base'] },
      { key: '--font-lg', label: 'Font size LG', kind: 'text', owner: 'structural', light: '20px', dark: '20px', predecessors: ['--font-lg'] },
      { key: '--font-xl', label: 'Font size XL', kind: 'text', owner: 'structural', light: '24px', dark: '24px', predecessors: ['--font-xl'] },
      { key: '--font-2xl', label: 'Font size 2XL', kind: 'text', owner: 'structural', light: '32px', dark: '32px' },
      { key: '--font-3xl', label: 'Font size 3XL', kind: 'text', owner: 'structural', light: '48px', dark: '48px' },
      // Line-height ramp, one step per size band (handoff §2). Only the
      // two ends of it existed before — `--line-base` and `--line-tight`
      // became `--line-body` and `--line-h4`; the five between and above
      // them are new and, like the two new sizes, carry no predecessor.
      {
        key: '--line-body',
        label: 'Line height (body)',
        kind: 'text',
        owner: 'structural',
        light: '1.5',
        dark: '1.5',
        predecessors: ['--line-base'],
      },
      {
        key: '--line-small',
        label: 'Line height (small)',
        kind: 'text',
        owner: 'structural',
        light: '1.45',
        dark: '1.45',
      },
      {
        key: '--line-caption',
        label: 'Line height (caption)',
        kind: 'text',
        owner: 'structural',
        light: '1.4',
        dark: '1.4',
      },
      {
        key: '--line-h4',
        label: 'Line height (h4)',
        kind: 'text',
        owner: 'structural',
        light: '1.3',
        dark: '1.3',
        predecessors: ['--line-tight'],
      },
      {
        key: '--line-h3',
        label: 'Line height (h3)',
        kind: 'text',
        owner: 'structural',
        light: '1.2',
        dark: '1.2',
      },
      {
        key: '--line-h2',
        label: 'Line height (h2)',
        kind: 'text',
        owner: 'structural',
        light: '1.15',
        dark: '1.15',
      },
      {
        key: '--line-h1',
        label: 'Line height (h1)',
        kind: 'text',
        owner: 'structural',
        light: '1.1',
        dark: '1.1',
      },
      // Tracking, handoff §2: "48px −0.02em, 32/24px −0.01em, caption
      // +0.02em, uppercase labels +0.06…0.08em". FOUR rules in the
      // handoff, four roles here — deliberately NOT one per step of the
      // scale: 32 and 24 share a value, and 20 / 16 / 14 have no rule at
      // all. Two entries holding one number is the dictionary doubling
      // FR-004 forbids, so the cut follows the rules, not the steps.
      // `--tracking-label` is the midpoint of the only value the handoff
      // states as a range. All four are new roles with no pre-redesign
      // predecessor — the old sheet spelled tracking as per-rule literals.
      {
        key: '--tracking-display',
        label: 'Tracking (display)',
        kind: 'text',
        owner: 'structural',
        light: '-0.02em',
        dark: '-0.02em',
      },
      {
        key: '--tracking-heading',
        label: 'Tracking (heading)',
        kind: 'text',
        owner: 'structural',
        light: '-0.01em',
        dark: '-0.01em',
        selectors: ['.settings-title', '.settings-panel-title', '.issue-title-input'],
      },
      {
        key: '--tracking-caption',
        label: 'Tracking (caption)',
        kind: 'text',
        owner: 'structural',
        light: '0.02em',
        dark: '0.02em',
        selectors: ['.task-card-meta-right', '.col-header-count'],
      },
      {
        key: '--tracking-label',
        label: 'Tracking (uppercase label)',
        kind: 'text',
        owner: 'structural',
        light: '0.07em',
        dark: '0.07em',
        selectors: ['.header-drawer-heading', '.comment-kind-badge'],
      },
      {
        key: '--font-weight-normal',
        label: 'Body weight',
        kind: 'text',
        owner: 'structural',
        light: '400',
        dark: '400',
        predecessors: ['--font-weight-normal'],
      },
      {
        key: '--font-weight-medium',
        label: 'Medium weight',
        kind: 'text',
        owner: 'structural',
        light: '500',
        dark: '500',
        predecessors: ['--font-weight-medium'],
        selectors: ['.settings-tab', '.theme-editor-tab.active'],
      },
      {
        key: '--font-weight-semibold',
        label: 'Title weight',
        kind: 'text',
        owner: 'structural',
        light: '600',
        dark: '600',
        predecessors: ['--font-weight-semibold'],
        selectors: ['.issue-title-input'],
      },
      {
        key: '--font-weight-bold',
        label: 'Strong weight',
        kind: 'text',
        owner: 'structural',
        light: '700',
        dark: '700',
        predecessors: ['--font-weight-bold'],
      },
    ],
  },
];

/**
 * Roles of the PRE-redesign dictionary that the new language has no
 * place for (sk-285.7 T003, INV-8 as weakened in the spec's round-4
 * changelog).
 *
 * Keyed by the old role name; the value is the reason it was retired.
 * A CONSTANT, not a comment, because two gates read it by name: this
 * file's own INV-8 test (successors + retirements must cover
 * `LEGACY_TOKEN_KEYS` exactly, with no overlap and no remainder) and
 * T010's `LEGACY_TO_NEW`, whose `null`-valued keys must be exactly this
 * set — so the migration map cannot quietly drop a role that this file
 * promised to keep.
 *
 * The bar for entering this list is the invariant's own: the new
 * language offers NO counterpart. "A different role could paint the
 * same pixels" is not a counterpart — that is what a successor is, and
 * a role with one is not allowed in here.
 *
 * A retired role's call sites are not left dangling: T004 re-codes each
 * of them onto the role the design assigns that surface. Reasons below
 * say where they went.
 */
export const RETIRED_ROLES: Record<string, string> = {
  '--accent-magenta':
    'The new language has no magenta: its palette is primary / secondary / accent / ok / warn / err / info / violet. The surfaces it used to paint were re-coded by purpose: the epic stripe (card, tree, kanban) uses --violet, and the current assignee in the people chain and the "creator" chip use --primary.',
  '--accent-magenta-tint':
    'A tint of the retired hue. It had no consumers of its own even before the redesign (no var(--accent-magenta-tint) occurrences in src/), and the tints of the new language are bound to roles that remain.',
  '--accent-orange':
    'The orange of the new language (--accent / --accent-text) is reserved for the logo and the HOT ZONE, so it has no general-purpose orange role. All FOUR consumers went their own way by meaning: the "new value" in the change feed (.outbox-ev-new) uses --primary, because it is an emphasis, not a warning, and --warn on every feed row would read as an alarm; the "mention" chip (.watching-card-reason.mention) and the enabled Inspect button (.header-inspect-btn[aria-pressed=true]) use --warn; the unsubscribe button hover (.watching-card-unsubscribe:hover) uses --err.',
  '--accent-yellow':
    'The yellow-amber band is folded into one role, --warn, taken by its closer predecessor --accent-amber. The language has no second role of the same hue; both consumers (an unsaved edit, a live feed reconnecting) are warnings, so they moved to --warn.',
  '--space-xs':
    'The spacing scale of the new language is a multiple of 4px (4 / 8 / 12 / 16 / 24 / 32 / 48 / 64); it has no 2px half-step. Consumers moved to --space-1 (4px).',
  '--font-size-meta':
    'A semantic alias over a scale step (its value was var(--font-xs)). The theme model requires ONE editable input per role, and the pair "--font-size-meta + --font-xs" is exactly the vocabulary doubling it forbids. Consumers moved to --font-xs; the value is the same, so nothing changes visibly.',
  '--font-size-body': 'The same doubling (its value was var(--font-base)). Consumers moved to --font-base.',
  '--font-size-title': 'The same doubling (its value was var(--font-lg)). Consumers moved to --font-lg.',
  '--font-size-heading': 'The same doubling (its value was var(--font-xl)). Consumers moved to --font-xl.',
};

/**
 * Legacy `TOKEN_GROUPS` export — kept for any external consumer that may
 * still reach for the old value-type grouping. Maps 1:1 to `TOKEN_SECTIONS`
 * so the editor never has to think about it. Prefer `TOKEN_SECTIONS`.
 */
export interface TokenGroup {
  title: string;
  tokens: TokenDef[];
}

export const TOKEN_GROUPS: TokenGroup[] = TOKEN_SECTIONS.map((s) => ({
  title: s.label,
  tokens: s.tokens,
}));

/** Flat list of every token (no section structure). */
export const ALL_TOKENS: TokenDef[] = TOKEN_SECTIONS.flatMap((s) => s.tokens);

/** Flat list of every token key as a string set — convenient for
 *  "is this key part of the theme system?" checks when stripping inline
 *  styles applied via preview / custom-theme apply. */
export const ALL_TOKEN_KEYS: readonly string[] = ALL_TOKENS.map((t) => t.key);

/**
 * Resolve a section id to its CSS selectors. Used by the receiver in
 * useTheme to build the highlight `<style>` element when a
 * `highlight-section` message arrives carrying just an id (not a full
 * selectors list).
 */
export function selectorsForSection(id: string | null | undefined): string[] | null {
  if (!id) return null;
  const sec = TOKEN_SECTIONS.find((s) => s.id === id);
  return sec ? sec.selectors : null;
}

/** Build a default variables map for the given base. Used as the seed
 *  for a brand-new theme draft. */
export function defaultVariablesForBase(base: 'light' | 'dark'): Record<string, string> {
  const result: Record<string, string> = {};
  for (const tok of ALL_TOKENS) {
    result[tok.key] = base === 'dark' ? tok.dark : tok.light;
  }
  return result;
}

/**
 * For the sk-10.3 Inspect button: given a clicked element's CSS selector
 * (typically `.foo.bar`) plus the selectors of its ancestor chain, return
 * the list of theme-token keys whose registered `selectors[]` (per-token,
 * or section-level fallback) match any of them.
 *
 * Matching is class-token-set based: we split each selector on CSS
 * structural separators (whitespace, `.`, `#`, `>`, `+`, `~`) into a set
 * of class tokens, then require that EVERY class in the registered
 * selector appears in at least one candidate's class set. This eliminates
 * the false-positive case where `.task-card-title-text` matched a token
 * registered for `.task-card` via plain substring.
 *
 * Examples:
 *   - Click on `.task-card-title-text`. Candidate tokens =
 *     {"task-card-title-text"}. Registry has `.task-card`. Required
 *     class "task-card" is NOT in the candidate set → no false positive.
 *   - Click on `.task-card.is-epic`. Candidate tokens =
 *     {"task-card", "is-epic"}. Registry `.task-card` matches; registry
 *     `.task-card.is-epic` also matches.
 *   - Click on `.action-button.primary`. Candidate tokens =
 *     {"action-button", "primary"}. Registry `.action-button.primary`
 *     matches; registry `.action-button.danger` requires "danger" which
 *     isn't in the candidate set → no false positive.
 *
 * Duplicates are de-duped via Set. Order is the natural iteration order
 * of TOKEN_SECTIONS (Neutrals → Surfaces → Text → …). Since sk-285.7
 * there is no alias layer, so two entries of the result can never be two
 * names for one role (FR-004).
 */
export function reverseLookupTokens(selector: string, parents: string[]): string[] {
  const out = new Set<string>();
  const candidates = [selector, ...parents];
  // Tokenise each candidate selector into its class-name parts.
  // e.g. ".task-card.is-epic" → ["task-card", "is-epic"]
  const tokenise = (s: string): string[] =>
    s.split(/[\s.#>+~]+/).filter(Boolean);
  const candidateClassSets = candidates.map((c) => new Set(tokenise(c)));

  for (const section of TOKEN_SECTIONS) {
    for (const token of section.tokens) {
      const sels = token.selectors ?? section.selectors;
      for (const s of sels) {
        const wanted = tokenise(s);
        if (wanted.length === 0) continue;
        // Match when EVERY class in the registered selector is present
        // in at least one candidate's class set.
        for (const candSet of candidateClassSets) {
          if (wanted.every((w) => candSet.has(w))) {
            out.add(token.key);
            break; // no need to test the rest of the candidate chain
          }
        }
      }
    }
  }
  return [...out];
}
