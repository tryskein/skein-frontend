/**
 * sk-36 — single source of truth for dep-type iconography + human-
 * readable tooltips. Consumed by the chip-row in `TaskFilters`, the
 * per-card icon strip in `TaskCard` and the dep-edge attribute in
 * `Attribute`. Keeping the maps here means each surface picks the same
 * glyph / tooltip / colour token for a given dep type — toggling one
 * renames the others.
 *
 * sk-285.2.23 — the TREE was the fourth consumer: `TaskTreeNode` drew a
 * connector glyph per row for the edge linking it to its parent. That
 * slot was removed (a column of symbols down the left gutter of an
 * expanded epic), so the tree no longer shows an edge's type at all.
 * Nothing here changed with it — these maps are what a replacement
 * surface would read, and `TaskTreeNode`'s header says which one.
 */

import { IconCornerDownRight } from '@tabler/icons-react';

import type { DepType } from '../api/dependencies';

/**
 * sk-285.7.2.52 (audit finding S-4) — the ONE edge type the handoff
 * draws as an icon.
 *
 * §6 "Task list" writes the subtask marker as "[↳ icon for
 * subtasks]" and §8 names it: `corner-down-right`. It is the only one of
 * the seven the package names at all — nothing in §8 covers blocks,
 * waits-for, related, discovered-from, supersedes or duplicates — so the
 * map is deliberately PARTIAL rather than padded out with icons the
 * design never chose. A type absent from here is drawn from
 * {@link DEP_TYPE_GLYPHS}, and that is the design's own division, not a
 * gap waiting on a task.
 *
 * The character it replaces was `↥` (U+21A5, an arrow rising from a
 * bar). Beyond not being an icon it pointed the wrong way: the reference
 * `1b` marks a child row with a stroke going DOWN and to the RIGHT — the
 * parent is above, the child indented under it — and `↥` reads as
 * "upward", i.e. the relation stated backwards.
 */
export const DEP_TYPE_ICONS = {
  'parent-child': IconCornerDownRight,
} as const satisfies Partial<Record<DepType, typeof IconCornerDownRight>>;

/**
 * Single-character glyph used as the visual cue for each dep type.
 * Every surface that names an edge type uses the same glyph so the eye
 * learns the iconography across the UI.
 *
 * `null` means «this type is drawn as an icon» — see
 * {@link DEP_TYPE_ICONS}. Spelled as an explicit null rather than as a
 * missing key so the map stays TOTAL over `DepType`: consumers already
 * treat an absent entry as "unknown wire value" and draw a `?` chip, and
 * a type that is merely drawn differently must not fall into that
 * branch.
 */
export const DEP_TYPE_GLYPHS = {
  'parent-child': null,
  blocks: '⊘',
  'waits-for': '⧖',
  related: '↔',
  'discovered-from': '↳',
  supersedes: '⇐',
  duplicates: '≈',
} as const satisfies Record<DepType, string | null>;

/**
 * Human-readable tooltip text. Phrased from the perspective of the
 * FROM-side row — i.e., what does THIS issue mean when it sits at
 * the from-end of an edge of this type.
 */
export const DEP_TYPE_TOOLTIPS = {
  'parent-child': 'parent-child — this issue is a child of its parent above',
  blocks: 'blocks — this issue is blocked by the linked issue (cannot close until it does)',
  'waits-for': 'waits-for — this issue is gated on the linked issue (structural blocker for /ready)',
  related: 'related — symmetric cross-link with the linked issue (no direction)',
  'discovered-from': 'discovered-from — this issue was found while working on the linked issue',
  supersedes: 'supersedes — this issue replaces the linked issue (the linked one is now obsolete)',
  duplicates: 'duplicates — this issue is a duplicate of the linked one (the linked one is the original)',
} as const satisfies Record<DepType, string>;

/**
 * CSS custom property names for the per-type accent colour. Use with
 * `var(${DEP_TYPE_CSS_VARS[t]})` to keep the colour palette in sync
 * with the connector / chip / icon-strip surfaces.
 */
export const DEP_TYPE_CSS_VARS = {
  'parent-child': '--ink-2',
  blocks: '--err',
  'waits-for': '--warn',
  related: '--secondary',
  'discovered-from': '--info',
  supersedes: '--violet',
  duplicates: '--ink-3',
} as const satisfies Record<DepType, string>;

/**
 * Canonical order used to render any per-issue dep-type icon strip.
 * Mirrors the chip-row in `TaskFilters` so users see the icons in
 * the same sequence everywhere.
 */
export const DEP_TYPE_ORDER: ReadonlyArray<DepType> = [
  'parent-child',
  'blocks',
  'waits-for',
  'related',
  'discovered-from',
  'supersedes',
  'duplicates',
];
