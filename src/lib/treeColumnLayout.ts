/**
 * sk-285.2.19 — the GEOMETRY of the tree table: how wide each column is
 * allowed to get, how tall a row is, and how those two facts reach CSS.
 *
 * `treeColumns.ts` (the registry) answers WHICH columns exist and which
 * are switched on. It deliberately stores no widths — the set is a user
 * preference, the geometry is not. This module is the other half: given
 * an order from `treeColumnOrder`, it produces the one string CSS needs
 * (`grid-template-columns`) and the one number the scroll container
 * needs (the width below which the table pans instead of squeezing).
 *
 * ─── Fixed row height, and why it is here rather than in CSS alone ──
 *
 * The tree row is FIXED height now: a long title is cut with an
 * ellipsis, and the whole title is on hover. That is a product decision
 * (a table whose rows are all the same height can be scanned down a
 * column; one whose rows breathe cannot), and it retires
 * `lib/treeRowHeightEstimate.ts` — a per-row model of how a wrapping
 * title changes a row's height has nothing left to model once no title
 * wraps.
 *
 * The virtualizer still needs that height in JavaScript, before first
 * paint, for a row it has not rendered: `estimateSize` is now EXACT
 * rather than an estimate, which is the whole benefit. A module cannot
 * read a stylesheet at import time, so the number is declared twice —
 * here and as `--tree-row-h` in `index.css` — and the two are pinned to
 * each other by `TreeTableLayout.test.tsx`, the same arrangement
 * `--tree-indent-step` already lives under.
 *
 * ─── Widths: MINIMUMS, and they are choices, not measurements ───────
 *
 * Every number in {@link TREE_COLUMN_WIDTH_PX} is a floor picked from
 * what the cell holds — a pill, a relative date ("3 days ago"), a person's
 * name, a progress pair (`done/counted`, or `closed/total` on an api
 * without the outcome legs — the two never differ in printed length by
 * more than the verb, and the floor below is set by the header anyway). They are deliberately on the generous
 * side of "the value fits", because the failure they exist to prevent —
 * a column squeezed until every cell is an ellipsis — is worse than a
 * table that pans.
 *
 * WHERE A NUMBER CAME FROM IS STATED PER COLUMN, and the two provenances
 * are not interchangeable. NOTHING here is measured by this repo's tests:
 * vitest runs with no layout engine, so a number presented as measured
 * BY THE SUITE would be a fabrication. Several of them were nevertheless
 * measured — `status`, `priority`, `assignee`, `progress`, `updated` — in
 * Chromium on the running app, each with its date, its locale and the
 * box it was compared against written into its own note. Read those as
 * dated observations: change the fonts, the cell padding or the sort
 * control and they have to be taken again.
 *
 * ─── Panning, not squeezing ────────────────────────────────────────
 *
 * The Tasks column is ~450px of content at the 1284px floor in Cards
 * view, and ~754px in Tree view, where the column takes the whole row
 * the two folded navigation columns gave back (sk-285.2.23 — the same
 * mechanism the Kanban board uses; see `Shell.tsx` for the arithmetic).
 * Nine default columns fit in neither, and no reshuffling of the widths
 * below would make them: the answer is the one Stage 1 already chose for this
 * shell — the interface PANS, it does not squeeze. So the table declares
 * its own minimum width ({@link treeTableMinWidthPx}) and the tree's
 * scroll container scrolls horizontally when the column is narrower than
 * that. The page itself never gains a scrollbar; the panning lives
 * inside the one container that owns the table, header included, which
 * is why the header is INSIDE that scroller rather than above it.
 *
 * The title column is the only elastic track (`minmax(min, 1fr)`): extra
 * width goes to the titles, which is the column a reader actually reads.
 */

import {
  TREE_TITLE_COLUMN,
  type TreeColumn,
  type TreeOptionalColumn,
  type TreeTitleColumn,
} from './treeColumns';

/**
 * Height of one table row, in px — the exact value `estimateSize` hands
 * the virtualizer, and the mirror of `--tree-row-h` in `index.css`.
 *
 * It is `--tap-target` (44px, WCAG 2.5.5 AAA) and not a smaller "dense
 * table" number for a reason that is structural rather than aesthetic:
 * the row contains the expand/collapse chevron, which is a 44×44 hit box.
 * A shorter row would either overflow
 * that box or shrink it below the floor the whole shell is held to.
 */
export const TREE_ROW_HEIGHT_PX = 44;

/**
 * Height of the sticky column-header strip, in px — mirror of
 * `--tree-head-h`.
 *
 * Needed in JS as well as CSS because the header sits INSIDE the
 * virtualizer's scroll container (that is what makes it pan sideways
 * with the rows it labels), so the row canvas starts `--tree-head-h`
 * into that container. `scrollMargin` is the virtualizer's own option
 * for exactly this; without it every `scrollToIndex` — i.e. every
 * keyboard move onto an off-screen row — would land the row one header
 * height too high, behind the sticky header.
 *
 * sk-285.7 T028 — 40, up from 28: handoff §6 «Tree view» draws the
 * strip at "header 40px `--elev`". It is a BAND like the column header
 * (48) and the app header (56), and 28 was a number with nothing behind
 * it. The strip also holds a sort control per column, which at 28 had
 * 28px of height to be a button in.
 */
export const TREE_HEAD_HEIGHT_PX = 40;

/**
 * Floor for the structural title column, in px.
 *
 * The one track that grows: whatever the Tasks column has beyond the sum
 * of the fixed columns goes here. The floor has to hold the chevron
 * (44px), a connector rail and a few levels of indent before any title
 * text starts, so it is not comparable to the other numbers below.
 */
export const TREE_TITLE_MIN_PX = 200;

/**
 * Width of each switchable column, in px. See «Widths» in the module
 * doc: these are chosen floors, not measurements.
 *
 *   id          — a hierarchical id (`sk-285.7.2.36.78`) is the longest
 *                 identity string the product has, and since T028 the
 *                 column is wide enough for it. See its own note below.
 *   status      — one pill (`in_progress` is the longest wire value).
 *   blocked     — one pill (`blocked`), or nothing.
 *   priority    — one pill (`P0`…`P4`). The VALUE is the narrowest thing
 *                 the table prints (26px measured); the column is not,
 *                 because the header `ПРИОРИТЕТ` sets its floor at 108
 *                 (see below). The narrowest column is `type`, 72.
 *   type        — one pill (`decision` is the longest).
 *   assignee    — a username, or the «unassigned» word. Its floor is the
 *                 HEADER `ИСПОЛНИТЕЛЬ` (120), not the names.
 *   components  — a comma-joined list; clipped, with the full list on
 *                 hover.
 *   labels      — same shape as components.
 *   progress    — `(сделано 3/9)`-ish. Its floor is the HEADER `ПРОГРЕСС`
 *                 and then the value; see its own note below. The
 *                 sk-489 relabel does not move that floor: the Russian
 *                 form kept its length («закрыто» → «сделано») and the
 *                 English one got shorter (`closed` → `done`).
 *   updated     — a timestamp label: relative while fresh, and the
 *                 absolute `YYYY-MM-DD UTC` from a week old on. See the
 *                 note on its width below — the ABSOLUTE form is what
 *                 sets the floor, not the relative one.
 *   created     — the same shape.
 */
export const TREE_COLUMN_WIDTH_PX: Record<TreeOptionalColumn, number> = {
  /**
   * 124, not the 88 it was, and not the 140 handoff §6 draws.
   *
   * WHY IT MOVED. sk-285.7 T028 stepped the badge in this cell down to
   * `--font-xs` (12px) — until then nothing declared
   * `--issue-id-font-size` anywhere an id in this table could inherit
   * it, so the badge fell back to `--font-base` and painted a 16px id in
   * a table whose every other value reads at 12 (the tree half of
   * sk-362). At 16px this column held about eight characters; the point
   * of a fixed column is that the id in it is READABLE, so the width is
   * re-derived against the size the cell now actually paints.
   *
   * THE ARITHMETIC, stated as the allowance it is — vitest has no layout
   * engine and nothing here could have measured it. The longest id this
   * project has produced is `sk-285.7.2.36.78`, 16 characters, and 0.6em
   * is the monospace advance this file already uses for `status`:
   *
   *   16 × 7.2px glyphs                            = 115.2
   *   + 2 × 4px cell padding                       = 123.2  → 124
   *
   * WHY NOT §6's 140. §6's five numbers («minmax(0,1fr) 140 130 90 120»)
   * are RENDERED widths on one 1440px artboard; every number in this
   * record is a FLOOR in a table that pans and has nine switchable
   * columns. Adopting the artboard's widths as floors spends the switch
   * budget at the app's MINIMUM width. The derivation, in the tense it
   * actually has — this is a BEFORE/AFTER of the very change that set
   * `124`, not a description of today: the default set was 596px with
   * this column at 88, against ~754px of table area at the 1284px floor,
   * so 158px was what a user turning ONE more column on could spend, and
   * the widest optional column costs 112. Raising this column by 52 (to
   * §6's 140) would have left 106 and put the horizontal scrollbar back
   * the moment anyone switched on `components`, `labels`, `updated` or
   * `created` — a promise `TreeTableLayout.test.tsx` pins on purpose
   * («turning ONE more column on still fits»). 124 spends 36 of the 158
   * and left 122, so every one of them still fitted then. The 596/158
   * pair above is the state THAT decision was taken against.
   *
   * ── sk-285.7.14 — where the budget stands now ──────────────────────
   *
   * 660 is today's default set and 94 today's slack: `priority` and
   * `assignee` were re-measured against the headers they actually draw
   * and grew by 12 and 16. So the four 112px columns no longer fit at
   * the floor, and the paragraph above describes a hazard that has since
   * been ACCEPTED with its price recorded, not one still being avoided.
   *
   * That does NOT make §6's 140 free for this column. It is the reverse:
   * with 94px of slack, spending 16 more here would leave 78, and the
   * «fits one at a time» list — already down to `type` 72 and
   * `progress` 92 since sk-412 widened `blocked` to 104 for its heading
   * — would lose `progress` too and be one column long. This width has
   * a current derivation and its content measures 69px against the
   * 116 it is given, so §6's 140 stays declined — for want of a reason,
   * now, rather than for want of room.
   *
   * If the artboard's exact widths are wanted, that is a trade against
   * the switch budget and belongs to whoever owns the budget — not to a
   * silent edit here.
   */
  id: 124,
  /**
   * 108, not the 84 it was: at 84 the longest value was CUT MID-WORD —
   * `in_progres` — which a live screenshot showed and no test here could,
   * since vitest runs with no layout engine.
   *
   * The number, stated as the arithmetic it is rather than as a
   * measurement: the chip is `--font-mono` at `--font-xs` (12px) with
   * `letter-spacing: 0.04em` and `padding: 1px 6px` (`Attribute.tsx`,
   * size `compact`), and the cell adds `padding: 0 var(--space-1)`. The
   * longest status is `in_progress`, 11 characters, and a monospace
   * advance is 0.6em:
   *
   *   11 × 7.2px glyphs + 11 × 0.48px tracking     = 84.5
   *   + 2 × 6px chip padding                       = 96.5
   *   + 2 × 4px cell padding                       = 104.5  → 108
   *
   * Still an allowance and not a measurement — 0.6em is the advance of
   * JetBrains Mono and of every fallback in `--font-mono`, so it holds
   * for the stack rather than for one face that may not have loaded.
   */
  status: 108,
  /**
   * 104, not the 76 it was — sk-412, and this one was DECIDED rather
   * than derived: the arithmetic was never in doubt, the price was.
   *
   * The value half always fitted: the cell holds one `blocked` pill, or
   * nothing. The HEADER did not, and has not since TR7 put the column
   * headings in uppercase with `--tracking-label` — no width was edited
   * that day, and this column became too narrow for its own label
   * without a single test seeing it (vitest runs with no layout engine).
   * Measured in Chromium at 1440 on the running app, `skein.lang=ru`,
   * Geist, `Range.getClientRects()` over the heading's text node:
   *
   *   header `БЛОКИРОВКА`  natural  92.92  in a 68px content box → cut
   *   header `BLOCKED`     natural  62.23  in the same 68        → fits
   *
   * The column draws no sort control (`treeColumnSortKey('blocked')` is
   * null), so its chrome is the cell's `padding: 0 var(--space-1)` and
   * nothing else:
   *
   *   92.92 + 8px cell padding = 100.92  →  104
   *
   * So this is a RUSSIAN-ONLY defect, and 104 is the round number above
   * the 101 the Russian heading needs. Nothing cheaper exists: dropping
   * `--tracking-label` from the heading returns 10 × 0.07 × 12 = 8.4px
   * and leaves the label at ≈84.5, still past the 68 it had.
   *
   * ── THE PRICE, which is the whole reason this sat open ────────────
   *
   * The default set is 660 against ~754 of table area at the 1284px
   * floor, so a single extra column may cost 94. At 76 this column was
   * one of the THREE that fitted one at a time (`type` 72, `blocked` 76,
   * `progress` 92); at 104 it is not, and the picker's «still fits at
   * the floor» list drops from three columns to two. That is a real
   * loss, it is paid on purpose, and `TreeTableLayout.test.tsx` records
   * it — its `stillFit.length` floor moved 3 → 2 in the same commit.
   * The guard was not being worked around: it was stating the budget
   * correctly both before and after, and the maintainers chose which side of
   * it to be on (sk-412, options 1/2/3 — "widen").
   *
   * Renaming the heading instead was option 2 and was NOT taken: the
   * table heading reads `filters:treeColumns.blocked`, the same string
   * that labels the column's switch in the picker, and
   * `TaskTreeVirtualList.tsx` calls that correspondence a decision
   * rather than a coincidence. A short label would either break it or
   * need a second key; the same word also names a field on the list
   * card and the board card.
   */
  blocked: 104,
  /**
   * 96, not the 48 it was: at 48 the HEADER did not fit — `Priority`
   * rendered as `P...`, and Russian `Приоритет` is half again as long.
   * The values (`P0`…`P4`) always fitted; the label never did.
   *
   * Measured in Chromium rather than estimated, because the header is
   * Inter (proportional) and no monospace arithmetic applies to it. The
   * label is `--font-xs` (12px) Inter inside `.task-tree-head-sort`, a
   * flex button with `gap: 4px` holding the label and the `⇅` arrow, in
   * a cell with `padding: 0 var(--space-1)`:
   *
   *   label `Приоритет`, natural width  (`scrollWidth`)   = 67
   *   label `Priority`,  natural width                    = 45
   *   + 4px button gap + 14px arrow + 8px cell padding    = 93 (ru)
   *                                                         71 (en)
   *   → 96, the round number above the longer of the two
   *
   * The measurement is of the fonts as they render in the running app;
   * nothing in this repo can reproduce it (vitest has no layout engine),
   * so treat it as a dated observation rather than an invariant — if the
   * header font or the sort control changes, re-measure.
   *
   * ── sk-285.7.14 — RE-MEASURED, on that instruction ────────────────
   *
   * The header DID change. TR7 put the column headers in uppercase with
   * `--tracking-label`, and `ПРИОРИТЕТ` is not `Приоритет`: nine capitals
   * plus nine letter-spaces. Re-measured in Chromium at 1440 on the
   * running app, `skein.lang=ru`:
   *
   *   label `ПРИОРИТЕТ`, natural width (`scrollWidth`)     = 81
   *   the box it was given (`clientWidth`)                 = 73
   *   → ellipsised on screen, «ПРИОРИТ…», in a screenshot
   *
   *   81 + 4px button gap + 14px arrow + 8px cell padding  = 107 → 108
   *
   * So 96 was a correct derivation of a header that no longer exists.
   * This is that paragraph's own instruction being followed, not a
   * second opinion about it.
   *
   * §6 draws this column at **90**, and that is REJECTED on the same
   * measurement: 90 is below the 107 the localized header needs, so
   * adopting it would deepen a defect that is on screen today. §6 gives
   * one number for a column whose header is translated, and it is the
   * English one — the package is under-specified here rather than wrong,
   * and this is the record of that (audit finding TR5).
   */
  priority: 108,
  type: 72,
  /**
   * 120, and this one is §6's own number — adopted because the
   * measurement independently arrives at it, not because the artboard
   * says so.
   *
   * At 104 BOTH halves of the column were cut. Measured in Chromium at
   * 1440 on the running app, `skein.lang=ru`:
   *
   *   header `ИСПОЛНИТЕЛЬ`  natural 111 in a 104 box  → ellipsised
   *   widest assignee CELL  natural 107.6             → 9 of 21 rows
   *                                                     ellipsised
   *
   *   111 + 8px cell padding = 119 → 120
   *
   * The cell half is why this is not merely a label fix: nearly half the
   * visible rows were printing a truncated username. A username has no
   * bound, so 120 does not promise every name fits — the cell keeps its
   * ellipsis and its `title`. What it does is stop the column being too
   * narrow for its own HEADER and for the names actually in the data.
   */
  assignee: 120,
  components: 112,
  labels: 112,
  /**
   * 92, not the 72 it was — sk-407 (3), the requirement "at the minimum the
   * header fits, at the maximum — the value".
   *
   * BOTH halves were cut at 72, and neither was visible to this repo's
   * suite (vitest has no layout engine). Measured in Chromium at 1440
   * on the running app, `skein.lang=ru`, Geist:
   *
   *   header `ПРОГРЕСС`   natural  71.06  in a 64px content box → cut
   *   value  `(закрыто 1/10)`      82.56  in the same 64        → cut
   *
   * The cell is `padding: 0 var(--space-1)`, i.e. 8px of chrome, so:
   *
   *   header needs   71.06 + 8  =  79.06  →  80
   *   value  needs   82.56 + 8  =  90.56  →  92
   *
   * 92 takes both. It is also the LAST width this column can have at
   * the floor: the default set is 660 against ~754 available, so a
   * single extra column may cost 94, and at 96 this one would stop
   * fitting and drop the picker's «still fits at the floor» list from
   * three columns to two.
   *
   * WHAT STILL DOES NOT FIT, stated rather than rounded away: a
   * two-digit/two-digit rollup. `(закрыто 10/10)` measures 90.89 and
   * needs 98.89 with the padding — 5px past the 94 the budget allows.
   * Such a cell keeps its ellipsis and its hover. Widening past 94 is a
   * trade against the switch budget and belongs to whoever owns the
   * budget, not to a silent edit here.
   *
   * (The value shrank by 9.14px in the same change: the cell printed
   * `card.epicProgress`, whose trailing `· ` separator has nothing to
   * separate from in a table. This cell was that string's last reader,
   * so the key was removed with the fix — see `TaskTreeNode.tsx`.)
   */
  progress: 92,
  /**
   * 112, not the 88 it was — a regression that arrived from another
   * file entirely. sk-285.6.7 did two things to `formatRelative`: it
   * dropped the relative→absolute switch-over from 30 days to 7
   * (`RELATIVE_UNTIL_MS`), and it lengthened the absolute form from
   * `2026-08-24` to `2026-08-24 UTC` so the zone is stated rather than
   * implied. 88px was chosen against the RELATIVE form; it was never
   * asked to hold the absolute one, and after that change every task
   * older than a week — i.e. most of a live project — printed its
   * `updated` as `2026-08-2…` in the table's own default sort key.
   *
   * The arithmetic, stated as the allowance it is rather than as a
   * measurement (vitest has no layout engine, and nothing here could
   * have measured this honestly): `2026-08-24 UTC` is 14 characters,
   * the cell is `--font-xs` (12px) with `padding: 0 var(--space-1)`,
   * and 0.6em is the monospace advance this file already uses for
   * `status`:
   *
   *   14 × 7.2px glyphs                            = 100.8
   *   + 2 × 4px cell padding                       = 108.8  → 112
   *
   * 0.6em is the PESSIMISTIC width here: the cell renders in the
   * proportional UI face, where digits and the space are narrower, so
   * a number that holds for monospace holds for what actually paints.
   * ── sk-285.7.14 — this column no longer fits at the FLOOR ──────────
   *
   * The default set demands 660px (title 200 + id 124 + status 108 +
   * priority 108 + assignee 120) against ~754 available, so the ceiling a
   * SINGLE extra column may reach is 754 − 660 = 94, and this one costs
   * 116. Turning it on at the app's minimum width lands on 776 and the
   * table pans; on any wider window it fits as before.
   *
   * The three earlier versions of this note read 596/158/46, then
   * 632/122/10, and each said the same thing more faintly: «the next
   * column to grow is one of these four». The column that grew was not
   * one of these four — it was `priority` and `assignee`, re-measured
   * against headers TR7 had made uppercase — but the outcome is the one
   * the paragraph kept predicting, and it has now happened.
   *
   * So the sentence this note used to make («112 sits well inside the
   * width budget») is retired rather than restated with a new number.
   * What is true today: 112 is the widest tier the table has, it is the
   * first tier to fall out of the floor budget, and it is out.
   *
   * The 112 itself is unchanged and still derived from the absolute
   * `2026-08-24 UTC` form — the arithmetic below is about what this
   * column NEEDS, not about what the budget can afford, and those two
   * questions are answered in different places on purpose.
   *
   * Not verified in a browser by the change that raised it — the number
   * above is arithmetic, and the clipping it fixes was diagnosed from
   * the same arithmetic. Worth one look at the running table.
   *
   * ── sk-407 (3) — 116, and this half WAS verified in a browser ──────
   *
   * That last paragraph asked for the look; this is it, and it found the
   * other half of the column cut. Measured in Chromium at 1440 on the
   * running app, `skein.lang=ru`, Geist:
   *
   *   value  `2026-09-01 UTC`  natural  96.72  in a 104px box → fits
   *   header `ОБНОВЛЕНО`       natural  84.41  in an 84px box → CUT,
   *                                                    «ОБНОВЛЕН…»
   *
   * The header's box is what is left of the track after the cell's
   * `padding: 0 var(--space-1)` (8), the sort button's `gap: 4px` and
   * the 16px direction glyph — 112 − 28 = 84, against 84.41 of label.
   * `scrollWidth` rounds to 84 and reports no overflow, which is why a
   * probe said it fitted and a screenshot said otherwise; the screenshot
   * is the one that is right.
   *
   *   84.41 + 4px gap + 16px arrow + 8px cell padding = 112.41 → 116
   *
   * The BUDGET does not move: this column was already past the 94px a
   * single extra column may cost at the floor, so 116 changes how far it
   * pans, not whether it fits. `created` is left at 112 deliberately —
   * `СОЗДАНО` is 66.63 and clears its own 84px box by 17px, so raising
   * it would be widening a column to fix a defect it does not have.
   */
  updated: 116,
  /**
   * Same CONTENT and same reasoning as `updated` — and 112 rather than
   * 116, because the two headers are not the same length: `СОЗДАНО`
   * measures 66.63 against `ОБНОВЛЕНО`'s 84.41 (Chromium, 1440, ru), so
   * this one has never been the column that clipped.
   */
  created: 112,
};

/** The order a header row and a body row both iterate. */
export type TreeColumnOrder = readonly [TreeTitleColumn, ...TreeOptionalColumn[]];

/**
 * Width of one column as a grid track — the title column elastic, every
 * other one fixed at its floor.
 *
 * Exported so the header, the rows and the min-width calculation cannot
 * disagree about what a track is: they all read this.
 */
export function treeColumnTrack(column: TreeColumn): string {
  if (column === TREE_TITLE_COLUMN) return `minmax(${TREE_TITLE_MIN_PX}px, 1fr)`;
  return `${TREE_COLUMN_WIDTH_PX[column]}px`;
}

/**
 * `grid-template-columns` for the whole table — the header strip and
 * every row are laid out by THIS string, published once as
 * `--tree-grid-cols` on the scroll container and inherited by both. A
 * header that computed its own tracks is a header that can drift out of
 * alignment with the rows under it.
 */
export function treeGridTemplate(order: TreeColumnOrder): string {
  return order.map(treeColumnTrack).join(' ');
}

/**
 * The smallest width one column's track can be, in px — READ BACK out
 * of the track {@link treeColumnTrack} produces, not computed alongside
 * it.
 *
 * Parsing a string this module just built looks like a detour, and it is
 * the point. The floor below is a SUM OF THE TRACKS it describes; the
 * two used to be independent walks over the same constants, and a change
 * to how a track is written (a padding allowance folded into the width,
 * a `min()` around it) moved the tracks while leaving the floor behind.
 * The table then panned to a width that no longer matched its columns —
 * every track present but the last one cut off, and nothing red anywhere
 * to say so. Going through the track makes that divergence unreachable:
 * there is one place a column's width is decided, and this reads it.
 *
 * Both track shapes start with the number that matters — `88px` for a
 * fixed column, `minmax(200px, 1fr)` for the elastic title, whose
 * minimum IS its floor — so one pattern covers them. A track that does
 * not start with a px length has no minimum this function can honestly
 * report, and it throws rather than guess: a silent 0 would shrink the
 * floor and take the panning with it.
 */
function treeColumnMinPx(column: TreeColumn): number {
  const track = treeColumnTrack(column);
  const match = /^(?:minmax\(\s*)?(\d+(?:\.\d+)?)px/.exec(track);
  if (!match) {
    throw new Error(
      `tree column "${column}" has no px minimum in its track "${track}"`,
    );
  }
  return Number(match[1]);
}

/**
 * Width below which the table pans instead of squeezing, in px: the
 * title column at its floor plus every fixed column at its own — i.e.
 * the sum of the minimums of the very tracks
 * {@link treeGridTemplate} lays the table out on (see
 * {@link treeColumnMinPx} for why it is read off them rather than
 * summed beside them).
 *
 * Published as `--tree-table-min-w` and applied as `min-width` to the
 * header and to the row canvas, which is what turns "the tracks
 * overflow" into "the scroll container has something to scroll".
 */
export function treeTableMinWidthPx(order: TreeColumnOrder): number {
  let total = 0;
  for (const column of order) total += treeColumnMinPx(column);
  return total;
}
