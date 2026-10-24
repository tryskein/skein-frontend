import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { BlockerRef, IssueStatus, IssueType } from '../api/issues';
import type { DepType, Gate } from '../api/dependencies';
import type { SearchKind } from '../api/search';
import { IconCornerDownRight } from '@tabler/icons-react';

import { DEP_TYPE_CSS_VARS, DEP_TYPE_GLYPHS, DEP_TYPE_ICONS } from '../lib/depTypeIcons';
import { SkeinTooltip } from './SkeinTooltip';

/**
 * sk-285.1.5 — THE attribute chip.
 *
 * Every "small labelled attribute of an issue" in the product — type,
 * status (incl. the derived `blocked` marker), priority, dependency
 * type, search-result kind — is rendered by THIS component and by
 * nothing else. The tree, the task cards, the details panel and the
 * search results all funnel through the same `<Attribute>` call, so a
 * per-surface divergence is not something a reviewer has to catch: it
 * is structurally impossible to express.
 *
 * Why a single component and not a shared CSS class: a class only
 * unifies the *paint*. Each surface still owned its own markup, its own
 * font-size and its own bracket/prefix/aria conventions, which is
 * exactly how the four renderings drifted apart in the first place.
 * Here the markup, the size scale, the colour map and the a11y wiring
 * live in one place; call sites supply the domain value and nothing
 * else.
 *
 * Two sizes, and only two:
 *
 *   compact  — dense lists: tree rows, task cards, dependency rows,
 *              search results, tables. The default.
 *   regular  — the Details panel, where the attribute row is a primary
 *              control rather than a scan target.
 *
 * There is deliberately NO `style` / `className` / `fontSize` escape
 * hatch: an arbitrary size at a call site is the failure mode this task
 * exists to remove.
 *
 * ── sk-285.1.9 → sk-367 — from ONE dialect to THREE FORMS ──────────
 *
 * The product once spoke two badge dialects at once: bracket-text
 * (`[ open ]`, `[P2]`, `[ bug ]`) for most attributes and a filled chip
 * for the few "loud" ones. sk-285.1.9 collapsed both into a single
 * filled pill — one background in the attribute's semantic colour,
 * `--bg` text on top, damped one notch toward `--ink-2` (sk-285.1.1) so
 * three of them in a row would stop shouting over the title.
 *
 * That was one shape carrying FOUR independent meanings on one channel:
 * hue. The Stage 2.2 language has eight tones and the shell has four sets
 * to encode (status, priority, issue type, dependency type), so the
 * channel ran out — `feature` and `in_progress` both landed on `--info`,
 * `decision` and `P1` both on `--primary`, and the first pair sits in
 * the SAME badge row (§6). sk-285.7.3 put that to the human, who chose
 * the hybrid:
 *
 *   Colour is spent on STATUS and PRIORITY — what the eye reads
 *   peripherally. Issue types and dependency types are told apart by
 *   FORM: an outline instead of a fill, a glyph, a marker.
 *
 * So there is no longer one shape. There are three, and which one a chip
 * wears IS its dimension (handoff §6, "Task list"):
 *
 *   ● in_progress      P1        feature
 *   tint plate + dot   mono chip  outline
 *   = status           = priority = type
 *
 *   status    filled: the role's `-t` wash, a 6px dot in the full tone,
 *             and 12/600 text in that same tone. Proportional type.
 *   priority  filled the same way, but MONOSPACED and dotless (§2 gives
 *             mono to ids, counters, times — §6 puts the priority chip
 *             in that family).
 *   outline   no fill at all: a 1px edge and text. Worn by issue types
 *             (edge `--line`, text `--ink-2`; epic takes `--violet` for
 *             both, §3), by dependency types (edge and text in the
 *             edge's own tone, plus its glyph from `DEP_TYPE_GLYPHS`)
 *             and by the search-result kind letter.
 *
 * Two consequences worth stating, because they invert older rules in
 * this file:
 *
 *   1. Two chips MAY now share a tone, provided their forms differ.
 *      `blocked` and `P0` are both `--err`; `deferred`, `closed` and
 *      `P2+` are all `--ink-2` on `--elev`. That is no longer a defect:
 *      one is a dotted proportional pill, the other a dotless mono chip,
 *      and `closed` additionally carries §3's line-through. What is
 *      still banned is a pair matching in tone AND form.
 *   2. The type axis has NO tone of its own any more (`typeFill` answers
 *      `--violet` for epic and the neutral ink for everything else).
 *      Per-type hues were the collision.
 *
 * ── why the plate is OPAQUE, and anchored to `--surface` ────────────
 *
 * §6 writes the status plate as `background: var(--ok-t)` — a wash at
 * 10–16% alpha, so what it actually measures depends on what it is
 * composited over. The design draws it in exactly one place, the task
 * card, whose ground is `--surface`. `<Attribute>` is drawn in many
 * more, and the wash does not survive the trip. Measured (WCAG 2.x, the
 * sheet's own token values, light theme):
 *
 *   --ok on --ok-t over --surface  5.34   over --bg  4.90   over --elev  4.58
 *   --warn on --warn-t  "  "       5.69        "      5.22        "      4.89
 *
 * ⚠ Those three columns used to read 4.55 / 4.17 / 3.90 and 4.89 / 4.49
 * / 4.21, i.e. the two thinnest pairs FAILED AA on the column ground and
 * failed it worse on the raised one, and that was the first of the three
 * reasons for flattening. sk-368 gave both grades a text step in the
 * light base (`--ok` #1f7a3f → #1b6e38, `--warn` #8a5a05 → #7d5104) and
 * that reason has EXPIRED — every ground now clears the bar on its own.
 * It is written down as expired rather than deleted so the argument is
 * not re-derived from a number that has moved.
 *
 * The second reason was `/legacy/*`: those pages painted their own
 * opaque near-black ground under whichever theme was active, so a
 * light-theme wash over it did not merely thin — it inverted. sk-303.15
 * deleted the whole route tree, and sk-400 recorded that reason expired
 * too.
 *
 * ⚠ The THIRD did not, and sk-400 re-measured it rather than inheriting
 * it. A wash measures whatever it is composited over, so an unflattened
 * chip has one ratio per GROUND instead of one per theme, and this chip
 * is drawn on all three planes. Swept over `--bg` / `--surface` /
 * `--elev` in both bases, the unflattened alternative does not FAIL —
 * nothing falls under AA. What it is, is flush: its thinnest pair is the
 * epic outline on `--elev` in light at 4.5004:1, four ten-thousandths
 * over the bar, where the flattened floor (`open`, below) stands at
 * 5.34. The flattening therefore buys most of a grade of margin, and
 * that is the reason it stays (both floors measured at sk-285.7).
 *
 * So the wash is flattened HERE, at author time, onto the ground §6
 * draws it on: `linear-gradient(var(--ok-t), var(--ok-t)), var(--surface)`
 * is the tint painted over an opaque `--surface`. On the task card this
 * is pixel-identical to what the design specifies; everywhere else the
 * chip keeps the surface-independence the filled pill always had, and
 * one measured number per theme is the whole truth about it. The outline
 * forms take the same plate, plain — an outline chip whose middle is
 * transparent is legible only on the ground it was measured against, and
 * the legacy pages are the counter-example.
 *
 * A tone with no `-t` partner (`--ink-2`) falls to `--elev`, which is
 * §3's own plate for the muted steps ("deferred → on --elev", "P2 → on
 * --elev"). That is a derivation, not a second map: see `TINT_OF`.
 *
 * ── contrast, as measured, not as inherited (§7: text 4.5, graphic 3) ─
 *
 * Every ratio below is text-on-its-own-plate, so it is the same on every
 * ground the chip can appear on. The 6px dot is a graphic against the
 * same plate, so its bar is 3:1 and its ratio is its status row.
 *
 *                          light   dark
 *   status open            5.34    6.61     --ok on --ok-t/--surface
 *   status in_progress     5.36    6.21     --info
 *   status blocked         5.55    5.44     --err
 *   status standing        6.25    6.66     --secondary
 *   status deferred       8.57    9.45     --ink-2 on --elev
 *   status closed         5.02    5.63     --ink-3 on --elev  (sk-460.9)
 *   priority P0            5.55    5.44     --err on --err-t/--surface
 *   priority P1            5.69    6.18     --warn
 *   priority P2..P4        8.57    9.45     --ink-2 on --elev
 *   type (non-epic)       10.10   10.46     --ink-2 on --surface
 *   type epic              6.08    7.15     --violet
 *   dep blocks             6.55    6.81     --err
 *   dep waits-for          6.88    8.42     --warn
 *   dep related            7.27    8.71     --secondary
 *   dep discovered-from    6.21    8.01     --info
 *   dep supersedes         6.08    7.15     --violet
 *   dep parent-child      10.10   10.46     --ink-2
 *   dep duplicates         5.92    6.24     --ink-3
 *   search issue           8.42    6.94     --primary
 *   search comment        10.10   10.46     --ink-2
 *   search project         7.27    8.71     --secondary
 *   search component       6.08    7.15     --violet
 *
 * The thinnest pair in the product is still `open`, now at 5.34:1 —
 * the same `--ok`/`--ok-t` pairing, but on the text grade sk-368 gave
 * the green rather than the handoff's first cut. It used to stand at
 * 4.55, five hundredths above the bar, which is why the plate had to
 * stop moving; the plate still may not move, for the two reasons above
 * that the retune did not touch. The numbers above were measured at
 * sk-285.7 and are documentation, not a guard.
 *
 * `--line`, the edge of the type chip, is NOT held to 3:1 — it measures
 * 1.35 light / 1.33 dark on `--surface`. That is deliberate on both
 * sides: the sheet declares `--line` "the decorative hairline … exempt
 * from the 3:1 bar" and §3 names it for exactly this chip. The type
 * chip's meaning rides on its TEXT (10.10:1); the edge is a container,
 * not a graphical object required to understand the content. Every OTHER
 * outline draws its edge in the same tone as its text, so those clear
 * the text bar and the graphic bar together.
 */
export type AttributeSize = 'compact' | 'regular';

export type AttributeProps =
  | { kind: 'type'; value: IssueType; size?: AttributeSize }
  | {
      kind: 'status';
      value: IssueStatus;
      /**
       * sk-31 — derived blocked-ness from the dep graph. When true and
       * the status is neither `closed` nor `standing`, the chip renders
       * `blocked` instead of the wire status.
       */
      isBlocked?: boolean;
      /** Open blockers behind `isBlocked` — listed in tooltip + aria-label. */
      blockers?: BlockerRef[];
      /** Leading ★ for pinned issues. */
      pinned?: boolean;
      size?: AttributeSize;
    }
  | { kind: 'priority'; value: number; size?: AttributeSize }
  | { kind: 'dep-type'; value: DepType; gate?: Gate; size?: AttributeSize }
  | { kind: 'search-kind'; value: SearchKind; size?: AttributeSize };

/**
 * The whole size scale — font step, the pill's own padding, and the box
 * height the pill is not allowed to fall below.
 *
 * sk-285.7 fidelity T2 — `minHeight` is new on `compact`. Both artboards
 * that draw this chip (`Sk Tasks.dc.html`, `Sk Details.dc.html`) write it
 * as `height:22px;border-radius:11px`, and 11 is exactly half of 22: the
 * pill radius only reads as a pill when the box is the height the radius
 * was drawn for. Left to the content the box came out 20.8 — 12px text at
 * `line-height: 1.4` is 16.8, plus 1px of padding and 1px of border on
 * each edge — so `--radius-pill` collapsed to 10.4 and every badge row in
 * the product sat 1.2px short of the design.
 *
 * A FLOOR rather than a fixed `height`, because the chip is `inline-flex`
 * and a call site may put a longer glyph or a second line's worth of
 * content in it; `height` would crop that, and a cropped badge is a worse
 * failure than a 1.2px one. The content of every chip the product builds
 * today is shorter than the floor, so the floor is what paints.
 *
 * `regular` deliberately keeps no floor. It exists for the Details panel,
 * where the chip is 14px — content alone is 25.6 there, already past 22 —
 * so a 22px floor would be inert, and any other number would be invented
 * rather than read off an artboard. The design draws the Details header
 * chips at the same 12/22 as the card; whether this panel should follow
 * it is a size-scale decision, not this fidelity pass.
 */
const SIZES: Record<AttributeSize, { fontSize: string; padding: string; minHeight?: string }> = {
  compact: { fontSize: 'var(--font-xs)', padding: '1px 6px', minHeight: '22px' },
  regular: { fontSize: 'var(--font-sm)', padding: '2px 8px' },
};

/**
 * The ground every chip's plate is flattened onto. See the header
 * docblock: §6 draws the badge row on the task card, and the card is
 * `--surface`.
 */
const PLATE_GROUND = '--surface';

/**
 * Roles that own a `-t` wash, i.e. that can wear the FILLED forms.
 *
 * A status or a priority whose tone is absent here has no tint to sit
 * on and falls to `--elev` — which is what §3 asks for by name for the
 * muted steps ("deferred → `--ink-3` on `--elev`", "P2 → `--ink-2` on
 * `--elev`"). Written as a derivation rather than as a second per-status
 * plate map, so a role that gains or loses its wash in `index.css`
 * cannot leave a stale plate behind here.
 */
const TINT_OF: Readonly<Record<string, string>> = {
  '--primary': '--primary-t',
  '--secondary': '--secondary-t',
  '--ok': '--ok-t',
  '--warn': '--warn-t',
  '--err': '--err-t',
  '--info': '--info-t',
  '--violet': '--violet-t',
};

/** The plate a filled chip in `tone` stands on — flattened, never a wash. */
export function chipPlate(tone: string): string {
  const tint = TINT_OF[tone];
  if (tint === undefined) return `var(--elev)`;
  return `linear-gradient(var(${tint}), var(${tint})), var(${PLATE_GROUND})`;
}

/**
 * The three forms of §6, and the whole of what distinguishes a
 * dimension from its neighbours in the badge row.
 *
 *   `status`    tint plate · 6px dot in the tone · proportional 600
 *   `priority`  tint plate · no dot · MONOSPACED 600
 *   `outline`   no fill · 1px edge · proportional 500
 */
export type ChipForm = 'status' | 'priority' | 'outline';

interface Chip {
  /** Text inside the pill. */
  text: string;
  /** Glyph(s) rendered before the text (★, ∞, ↳, ≈, …). */
  prefix?: string;
  /**
   * sk-285.7.2.52 — a rendered prefix, for the one dep type the handoff
   * draws as an ICON rather than as a character (§8's
   * `corner-down-right`). Kept separate from {@link Chip.prefix} rather
   * than widening it to `ReactNode`: the string form carries its own
   * trailing space, an element does not, and the two want different
   * spacing. Wins when both are set.
   */
  prefixNode?: ReactNode;
  /** Which of §6's three shapes this chip wears. */
  form: ChipForm;
  /**
   * CSS custom property name (WITHOUT `var()`) the chip's TEXT — and,
   * on a status chip, its dot — is painted in. On the filled forms it
   * is also what picks the plate (see {@link chipPlate}); on `outline`
   * it is the ink alone and {@link Chip.edge} owns the border.
   */
  tone: string;
  /**
   * Border colour of an `outline` chip, as a custom-property name.
   * Ignored by the filled forms, which draw a transparent 1px edge so
   * every form keeps the same box height.
   */
  edge?: string;
  /** §3: "done → the same + line-through". */
  strike?: boolean;
  role?: 'status' | 'img';
  ariaLabel?: string;
  title?: string;
  /**
   * Hide the pill's glyph from assistive tech. Used by the search-kind
   * chip, whose visible content is a single letter that only means
   * something next to its `aria-label`.
   */
  decorative?: boolean;
  /** Hover tooltip (SkeinTooltip — 0ms, per the UI guidelines). */
  tooltip?: string;
}

// ───────────────────────── colour maps ─────────────────────────
//
// sk-285.7 T025 — the three `*Fill` functions below are EXPORTED, and
// that is the whole point of them being functions rather than switch
// bodies inlined in the chip builders. The filter panel's quick list
// (mode B) puts a 6px dot on every status / priority / epic chip
// (handoff §6), and the board paints its column heads from the same
// answer; a dot painted from a second copy of these maps is a second
// place for a hue to be decided. There is one map per dimension and
// every surface reads it.
//
// They answer the role TONE as a CSS custom-property NAME (no `var()`).
// What each caller does with it differs — this component turns it into
// a plate plus ink plus a dot, the filter chip paints a bare dot, the
// board paints a dot and a 2px underline — so the name says "the tone
// this value is drawn in", not "the colour of its background".

/**
 * The tone an issue TYPE is drawn in — and after sk-367 there are only
 * two answers, because the type axis no longer owns a hue.
 *
 * sk-285.7.3's hybrid spends colour on status and priority and gives the
 * type set FORM instead: §3 draws every type as an outline, `--line`
 * edge and `--ink-2` text, with `epic` the single exception the design
 * names — `--violet`, the same token as the card's left rail and the
 * tree's epic marker. The per-type hues this map used to answer (bug
 * `--err`, feature `--info`, task `--secondary`, decision `--primary`,
 * idea `--warn`) were exactly the collision sk-285.7.3 was opened for:
 * `feature` and `in_progress` both reached `--info` and sat in the SAME
 * badge row.
 *
 * The one caller that still asks — the filter panel's quick list — asks
 * only about `epic`, because §6 dots epics and no other type.
 */
export function typeFill(type: IssueType): string {
  return type === 'epic' ? '--violet' : '--ink-2';
}

function typeChip(type: IssueType): Chip {
  const tone = typeFill(type);
  return {
    text: type,
    form: 'outline',
    tone,
    // §3: "type (bug/task/feature) → outline `--line`, text `--ink-2`;
    // epic → outline/text `--violet`". Only epic paints its own edge.
    edge: type === 'epic' ? tone : '--line',
  };
}

/**
 * Status tones — the axis the hybrid keeps colour on, so this map is
 * the one that did NOT change with sk-367.
 *
 * `standing` and the thick row rail name the SAME token, `--secondary`.
 * They used to take the hue at two grades — the rail on the plain accent
 * (a bare bar, non-text contrast, 3:1) and the pill on a `-fill`
 * partner, because the plain one carried `--bg` text at only ~2.9:1.
 * sk-285.7 removed the split: the Stage 2.2 language declares one grade
 * per role and this one is text-capable. sk-133's "rail and pill move
 * together" intent is no longer merely preserved — it is now structural,
 * because there is one token to move.
 *
 * `deferred` and `closed` used to share `--ink-2`; sk-460.9 split them
 * — `deferred` keeps `--ink-2`, `closed` drops one step to `--ink-3`.
 *
 * WHY THEY SPLIT, and why the split is product-wide rather than local to
 * the epic section: two statuses that differ in MEANING have to differ
 * everywhere, or the difference is a property of one screen instead of a
 * property of the data. So this map moved, and with it the Tasks column,
 * the board, the card header and the epic section — all of them read
 * here, which is the whole point of there being one map.
 *
 * WHICH way round, and why it is not a coin toss: the "Improvisation 50%"
 * artefact draws `deferred: #6b6760` against `closed: #8a857c`, i.e. the
 * CLOSED one is the lighter, weaker tone. `--ink-3` is the weaker step in
 * BOTH themes — the neutral ramp flips end-for-end, so `--ink-3` is
 * lighter than `--ink-2` on light and darker on dark — so the roles
 * reproduce the artefact's ordering instead of merely differing from it.
 * sk-460.11 had already made the closed row TITLE `--ink-3` by the same
 * argument; this puts the status carrier on the same footing.
 *
 * ROLE, NOT LITERAL — decided by measurement, not taste. The artefact's
 * own `#8a857c` reads 3.67:1 on white, BELOW the 4.5:1 text bar: at this
 * spot the design is not "different", it is inaccessible. `--ink-3` on
 * the chip plate reads 5.02:1 light and 5.63:1 dark (5.92 / 6.24 on
 * `--surface`). The two tones sit 1.71:1 apart on light and 1.68:1 on
 * dark — a slightly WIDER separation than the artefact's own 1.53:1.
 *
 * ⚠ THE `default` BRANCH IS DELIBERATELY UNTOUCHED, and that is not an
 * oversight. It still answers `--ink-2`, i.e. the same tone as
 * `deferred`. sk-463 fixed the unknown-status defect STRUCTURALLY — the
 * epic section never calls this map for a value the client does not
 * know (`epicChildCategories` makes that a compile-time property via its
 * discriminated union) — and a fix that depended on every known tone
 * being distinct from the fallback would be a much weaker one, because
 * the palette has no "neutral that is no status" role to spare. What the
 * split DOES do here is shrink the overlap rather than widen it: the
 * fallback used to collide with two statuses, now it collides with one.
 * INV-6 permits two known statuses to share a tone; what it forbids is
 * painting an UNKNOWN value in a known status's tone, and that remains
 * prevented by construction (INV-6, SC-006).
 */
export function statusFill(status: IssueStatus | 'blocked'): string {
  switch (status) {
    case 'open':
      return '--ok';
    case 'in_progress':
      return '--info';
    case 'blocked':
      return '--err';
    case 'deferred':
      return '--ink-2';
    case 'standing':
      return '--secondary';
    case 'closed':
      return '--ink-3';
    default:
      return '--ink-2';
  }
}

/**
 * Does the derived blocked marker actually WIN over this status?
 *
 * sk-31: blocked supersedes when derived true AND not closed — a closed
 * issue keeps its terminal marker even with a stale blocker edge.
 * sk-118: standing is ALSO immune. Nothing can target a standing task
 * with blocks/waits-for (§11.2), so a stray isBlocked must not flip the
 * "Permanent" chip.
 *
 * EXPORTED because {@link statusChip} is not the only place the answer
 * is needed: sk-285.2.19 gave the tree table a `blocked` COLUMN, and a
 * cell that owns blocked-ness has to know whether there is any to print
 * BEFORE it renders a chip — a chip asked for a suppressed marker falls
 * through to the plain status chip, i.e. the blocked column would quietly
 * print the status column's value on closed and standing rows. The rule
 * keeps its single home here; the caller asks it rather than restating
 * it, which is what stops the two copies from drifting apart.
 */
export function isDerivedBlocked(
  status: IssueStatus,
  isBlocked?: boolean,
): boolean {
  return !!isBlocked && status !== 'closed' && status !== 'standing';
}

/**
 * How a status VALUE is spelled inside the chip.
 *
 * sk-285.7 fidelity T3 — the underscore is a wire spelling, and the chip
 * is the one place it reached the screen as one. Both artboards write the
 * badge as «in progress» (`Sk Tasks.dc.html` keys its status map on that
 * exact string; `Sk Details.dc.html` prints `open`), while the SAME
 * design keeps `in_progress` monospaced in the activity feed — so the
 * distinction the design draws is not "underscores are wrong" but "a
 * badge is prose, an event line is a value". Only the badge is retyped.
 *
 * A typographic transform of the value, not a translation: the chip has
 * never been localised (it prints the wire enum on every locale, which is
 * what makes the badge row comparable with the API), and localising it
 * here would be a different decision on a different surface. Every other
 * status is a single word, so `in_progress` is the only value this
 * touches today — written as a rule rather than a special case so a
 * future two-word status arrives already spelled.
 */
export function statusChipText(status: IssueStatus | 'blocked'): string {
  return status.replace(/_/g, ' ');
}

function statusChip(
  props: {
    value: IssueStatus;
    isBlocked?: boolean;
    blockers?: BlockerRef[];
    pinned?: boolean;
  },
  t: TFunction,
): Chip {
  const derivedBlocked = isDerivedBlocked(props.value, props.isBlocked);
  const display: IssueStatus | 'blocked' = derivedBlocked ? 'blocked' : props.value;
  const isStanding = display === 'standing';

  const blockedLabel =
    props.blockers && props.blockers.length > 0
      ? t('attributes.blockedBy', {
          ids: props.blockers.map((b) => b.id).join(', '),
        })
      : t('attributes.blocked');

  return {
    text: statusChipText(display),
    prefix: `${props.pinned ? '★ ' : ''}${isStanding ? '∞ ' : ''}` || undefined,
    form: 'status',
    tone: statusFill(display),
    // §3: "done → the same + line-through". Until sk-460.9 the strike was
    // the ONLY thing separating `closed` from `deferred`, which shared
    // its plate and ink exactly. The tones are split now, but the strike
    // stays: the two still share a PLATE, and a distinction carried by
    // colour alone is exactly what the high-contrast rule forbids.
    strike: display === 'closed',
    role: derivedBlocked || isStanding ? 'status' : undefined,
    ariaLabel: derivedBlocked
      ? blockedLabel
      : isStanding
        ? t('attributes.standingAria')
        : undefined,
    title: isStanding ? t('attributes.standingTitle') : undefined,
    tooltip: derivedBlocked ? blockedLabel : undefined,
  };
}

/**
 * Priority ramp — realigned to handoff §3 by sk-367: **P0 `--err`, P1
 * `--warn`, P2 and below `--ink-2` on `--elev`**.
 *
 * This is one of the two divergences sk-285.7.3 left open, and it is
 * RESOLVED here rather than recorded as a departure. The code answered
 * P1 `--primary` / P2 `--warn` / P3+ `--ink-2`, which was pre-reform
 * semantics carried across under new names in T004 — not a decision
 * anyone took about the new language. Both the handoff prose (§3
 * "priority: P0 → --err, P1 → --warn, P2 → --ink-2 on --elev") and the
 * design it calls the source of truth (`Sk Tasks.dc.html`:
 * `P0:[--err-t,--err] P1:[--warn-t,--warn] P2:[--elev,--ink-2]`) say the
 * same thing, and the hybrid keeps priority ON the colour axis, so there
 * was nothing to trade away. It also frees `--primary` — which §3
 * reserves for the brand, ids and selection — from meaning "P1", and
 * with it the second collision sk-285.7.3 named (`decision` vs P1).
 *
 * §3 stops at P2 because the design shows three steps. P3 and P4
 * continue the muted step: they are quieter than P2, and the language
 * has nothing quieter than `--ink-2` that a chip's own text can sit on.
 * They stay tellable apart by their TEXT, which is the whole content of
 * the chip, and no two of them ever share a badge row — an issue has one
 * priority.
 *
 * The tone is a plain role name; the plate follows from it via
 * {@link chipPlate}, so P0/P1 land on their wash and P2+ on `--elev`
 * without a second table saying so.
 */
export function priorityFill(priority: number): string {
  switch (Math.max(0, Math.min(4, priority | 0))) {
    case 0:
      return '--err';
    case 1:
      return '--warn';
    default:
      return '--ink-2';
  }
}

function priorityChip(priority: number): Chip {
  const clamped = Math.max(0, Math.min(4, priority | 0));
  return { text: `P${clamped}`, form: 'priority', tone: priorityFill(clamped) };
}

/**
 * Dependency edge type — the second set the hybrid moves onto FORM.
 *
 * A dep chip is an OUTLINE carrying its glyph: two of the three form
 * channels sk-285.7.3 names ("outline instead of fill, icon, marker"),
 * so no dep type has to be told from a status by hue. The glyph comes
 * from `DEP_TYPE_GLYPHS` and the tone from `DEP_TYPE_CSS_VARS` — the
 * same two maps the filter panel's chip row and the per-card icon strip
 * read, so an edge keeps one glyph and one colour everywhere it appears.
 *
 * The tone paints the edge AND the text, which is what retired
 * `DEP_FILL_OVERRIDES`. That map existed because the tones had to be
 * legal PLANES for `--bg` text to sit on, and `duplicates`' `--ink-3` is
 * the muted chrome step — an ink, not a plane. As ink it is exactly
 * what it was made for: 5.92:1 light / 6.24:1 dark on the chip's plate,
 * comfortably past AA, so the substitution has nothing left to fix.
 * All seven tones now reach the chip unmodified.
 *
 * Every type gets a glyph, including the four that previously had none:
 * with the fill gone, an outline chip whose only content is its wire
 * name is the one shape a reader cannot tell from an issue-type chip at
 * a glance. `DEP_TYPE_GLYPHS` already had all seven.
 */
function depTypeChip(type: DepType, gate?: Gate): Chip {
  const showGate = type === 'waits-for' && !!gate;
  const text = showGate ? `${type}: ${gate}` : type;
  const ariaLabel = showGate
    ? `dependency type ${type}, gate ${gate}`
    : `dependency type ${type}`;
  const glyph = DEP_TYPE_GLYPHS[type];
  const tone = DEP_TYPE_CSS_VARS[type];
  if (glyph === undefined || tone === undefined) {
    // Defensive: an unknown wire value means a stale cache or a typo.
    // Give it a neutral chip + `?` so it can't masquerade as valid.
    return { text, ariaLabel, form: 'outline', tone: '--ink-2', edge: '--ink-2', prefix: '? ' };
  }
  // sk-285.7.2.52 — a type the handoff names an icon for gets the icon,
  // here as everywhere else. `null` in the glyph map is that signal, and
  // it is distinct from `undefined`, which above means "unknown wire
  // value": drawn differently is not the same as not recognised.
  const Icon = DEP_TYPE_ICONS[type as keyof typeof DEP_TYPE_ICONS] as
    | typeof IconCornerDownRight
    | undefined;
  if (Icon) {
    return {
      text,
      ariaLabel,
      form: 'outline',
      tone,
      edge: tone,
      // 16px — §8's inline-in-text step, which is what a chip prefix is.
      prefixNode: <Icon size={16} stroke={1.75} aria-hidden />,
    };
  }
  return { text, ariaLabel, form: 'outline', tone, edge: tone, prefix: `${glyph} ` };
}

/**
 * Search-result kind. The single letter is the visible content and is
 * decorative; the human label rides on `aria-label` / `title`.
 * Lowercase `c` for component keeps Project / component distinguishable
 * in dense lists; one hue per entity kind keeps them apart at a glance.
 *
 * It takes the OUTLINE form, and that is a decision rather than a
 * default. §6 never draws this chip — the search list is not in the
 * design — but the hybrid leaves only two filled shapes in the product,
 * and both of them are claims about an issue: "this is its status",
 * "this is its priority". A filled letter sitting in the same row
 * (`SearchResultCard` draws kind · status · priority · type on one line)
 * would read as a third such claim. Outline says "a marker, not a
 * state", which is what an entity kind is.
 */
const SEARCH_KIND_TONES: Readonly<Record<SearchKind, { letter: string; tone: string }>> = {
  issue: { letter: 'I', tone: '--primary' },
  comment: { letter: 'C', tone: '--ink-2' },
  project: { letter: 'P', tone: '--secondary' },
  component: { letter: 'c', tone: '--violet' },
};

function searchKindChip(kind: SearchKind): Chip {
  const known = SEARCH_KIND_TONES[kind];
  const { letter, tone } = known ?? { letter: '?', tone: '--ink-2' };
  const label = known ? kind : 'unknown';
  return {
    text: letter,
    form: 'outline',
    tone,
    edge: tone,
    role: 'img',
    ariaLabel: label,
    title: label,
    decorative: true,
  };
}

function chipFor(props: AttributeProps, t: TFunction): Chip {
  switch (props.kind) {
    case 'type':
      return typeChip(props.value);
    case 'status':
      return statusChip(props, t);
    case 'priority':
      return priorityChip(props.value);
    case 'dep-type':
      return depTypeChip(props.value, props.gate);
    case 'search-kind':
      return searchKindChip(props.value);
    default: {
      const _exhaustive: never = props;
      return _exhaustive;
    }
  }
}

// ───────────────────────── the component ─────────────────────────

export function Attribute(props: AttributeProps) {
  // Only the status chip's aria/title copy is translated — the pill TEXT
  // stays the wire value (`open`, `bug`, `waits-for`, …) so one issue
  // reads the same in the board, the tree and the API.
  const { t } = useTranslation('common');
  const chip = chipFor(props, t);
  const size = SIZES[props.size ?? 'compact'];
  const filled = chip.form !== 'outline';

  const body: ReactNode = (
    <>
      {chip.prefixNode ?? chip.prefix ?? ''}
      {chip.text}
    </>
  );

  const span = (
    <span
      // a11y: `role` + `aria-label` is the canonical "this glyph carries
      // meaning, here is its name" recipe — without a role, the
      // accessible-name computation skips aria-label on a bare <span>.
      role={chip.role}
      aria-label={chip.ariaLabel}
      title={chip.title}
      style={{
        // inline-flex, not inline-block: the status dot is a real child
        // box that has to sit on the text's centre line.
        display: 'inline-flex',
        alignItems: 'center',
        // The artboard's 22px box (see SIZES). `align-items: center`
        // above is what makes the floor centre the text rather than
        // stretch it.
        minHeight: size.minHeight,
        gap: chip.form === 'status' ? '5px' : undefined,
        // §2 gives mono to ids, counters and times; §6 puts the priority
        // chip in that family and leaves the other two proportional.
        fontFamily: chip.form === 'priority' ? 'var(--font-mono)' : 'var(--font-ui)',
        fontSize: size.fontSize,
        // §6: the filled forms are 600, the outline 500 — the badge row
        // is read status-first, and weight is the third channel saying so.
        fontWeight: filled
          ? 'var(--font-weight-semibold)'
          : 'var(--font-weight-medium)',
        lineHeight: 1.4,
        letterSpacing: '0.04em',
        whiteSpace: 'nowrap',
        textDecoration: chip.strike ? 'line-through' : undefined,
        // The tone is the INK on every form (sk-367): a filled chip
        // stands on its own wash flattened onto --surface, an outline
        // chip on that ground plain. Never a raw wash — see the header
        // docblock for the ratios that rule it out.
        color: `var(${chip.tone})`,
        background: filled ? chipPlate(chip.tone) : `var(${PLATE_GROUND})`,
        // A transparent edge on the filled forms, so all three shapes
        // occupy the same box and a badge row does not step up and down.
        border: `1px solid ${filled ? 'transparent' : `var(${chip.edge ?? chip.tone})`}`,
        // §4 names the badge as a consumer of the pill radius.
        borderRadius: 'var(--radius-pill)',
        padding: size.padding,
      }}
    >
      {chip.form === 'status' ? (
        <span
          // The dot repeats the pill's own tone and its text; it is a
          // scan target, not information, so AT never sees it.
          aria-hidden="true"
          style={{
            inlineSize: '6px',
            blockSize: '6px',
            flex: 'none',
            borderRadius: 'var(--radius-pill)',
            background: `var(${chip.tone})`,
          }}
        />
      ) : null}
      {chip.decorative ? <span aria-hidden="true">{body}</span> : body}
    </span>
  );

  if (!chip.tooltip) return span;
  return (
    <SkeinTooltip content={chip.tooltip} position="top">
      {span}
    </SkeinTooltip>
  );
}
