/**
 * sk-285.2.19 — which columns the tree TABLE prints.
 *
 * This is the same model as `lib/kanbanCardFields.ts` (sk-285.2.5),
 * deliberately and to the letter: a flat list of switches in Linear's
 * «display properties» sense — no per-column renaming, no widths stored
 * here, and (see «Order» below) no drag-to-arrange. There is no third
 * way to say "show me this field" in this app, and this file exists so
 * there will not be one.
 *
 * What is NOT the same, and is the whole reason for a separate module:
 *
 *   • **The first column is structural.** A board card is a bag of
 *     properties and may legally print nothing but its title. A tree
 *     table cannot: the first cell carries the chevron, the depth
 *     indent, the typed-deps connector and the title, and switching it
 *     off does not "hide a property" — it deletes the tree. So the
 *     title column is not a member of the switchable set AT ALL (see
 *     {@link TreeOptionalColumn} vs {@link TreeColumn}); it cannot be
 *     dropped by a type-checked caller, it cannot be dropped by a
 *     hand-edited localStorage value, and {@link treeColumnOrder}
 *     re-asserts it as position 0 on every call.
 *
 *   • **The set is stored under its OWN key.** Card fields and table
 *     columns are two independent preferences for two different
 *     surfaces; a user narrowing their board must not silently narrow
 *     their tree. `useTasksUiState` keeps them in separate state and
 *     separate storage keys, and `treeColumnsPersist.test.tsx` pins
 *     that they cannot leak into each other.
 *
 * ## Which columns exist
 *
 * A column exists only if the row ALREADY HAS the data — every entry
 * below is a property of `IssueSummary`, the shape the Tasks list query
 * returns (`api/issues.ts`). Nothing here needs a second fetch, and a
 * switch can never turn on a column the table cannot fill.
 *
 * ## Order
 *
 * FIXED, by the order of {@link TREE_OPTIONAL_COLUMNS} — the user picks
 * WHICH columns, never WHERE. Two reasons, and the second is the real
 * one:
 *
 *   1. Drag-to-arrange headers is a whole second interaction (grab
 *      handles, drop targets, a keyboard equivalent, a persisted
 *      permutation that has to survive a column being added in a later
 *      build). That is a large cost for a preference nobody has asked
 *      for, and the brief says not to take it without a demonstrated
 *      need.
 *   2. The order below is not arbitrary, it is a reading order:
 *      identity → state → people → taxonomy → rollups → time. A table
 *      whose columns can be shuffled per user is a table where no two
 *      screenshots, and no two people pairing at one desk, look alike.
 *
 * If reordering is ever wanted, it belongs here as a stored permutation
 * applied by {@link treeColumnOrder} — the title column staying pinned
 * at index 0 regardless.
 */

/** The structural first column. Not switchable — see the module doc. */
export const TREE_TITLE_COLUMN = 'title';

/**
 * The type of the structural column, as its own type so the pinned slot
 * is visible in signatures rather than being a bare string literal.
 */
export type TreeTitleColumn = typeof TREE_TITLE_COLUMN;

/**
 * One switchable column of the tree table.
 *
 * Names are the UI's vocabulary, not the wire's: `components` /
 * `labels` are plural because the cell prints the whole list, `updated`
 * / `created` drop the `At` suffix, and `progress` names what the cell
 * MEANS (done/counted children of an epic — sk-489 INV-5: children
 * closed without work leave the denominator) rather than the wire's
 * `epicProgress`.
 *
 * Why each one is here — every entry answers "what does the tree row
 * already show, or already carry, that a reader might want as a sorted,
 * aligned column":
 *
 *   • `id`        — the row prints it today on its own line; in a table
 *                   it is the one truly fixed-width cell, and the thing
 *                   people paste into chat.
 *   • `status`    — printed today; the primary state of a task.
 *   • `blocked`   — printed today, folded into the status chip. It is a
 *                   SEPARATE column because it is not a status: it is
 *                   derived from the dependency graph (`isBlocked`), and
 *                   a reader scanning for "what is stuck" wants it even
 *                   with the status column off. Same reasoning that made
 *                   it a separate card field in sk-285.2.5.
 *   • `priority`  — printed today; the second axis every triage scan
 *                   uses.
 *   • `type`      — printed today; bug / feature / epic changes how a
 *                   row should be read.
 *   • `assignee`  — printed today; "who has this".
 *   • `components`— printed today (first component + «+N»); the row's
 *                   place in the project's structure.
 *   • `labels`    — NOT printed today, but carried on every row
 *                   (`labels: string[]`) and already a card field. A
 *                   table is the surface where a taxonomy column finally
 *                   pays for itself, so it is offered — and, being new
 *                   information, it is off by default (see
 *                   {@link TREE_DEFAULT_COLUMNS}, which since sk-285.2.22
 *                   is a width budget rather than a transcript of the
 *                   old mini-card row).
 *   • `progress`  — printed today on every row that CARRIES a rollup
 *                   (`epicProgress`, done/counted) — which since sk-461
 *                   is no longer epics alone. The tree endpoint used to
 *                   gate the projection on `type = 'epic'`; the gate is
 *                   gone, so any row WITH CHILDREN now carries the pair
 *                   and a parent task prints its share here too. Kept
 *                   deliberately (the maintainers' call on sk-462: a parent
 *                   with subtasks does have a share, and hiding it
 *                   bought nothing) — and it keeps this column agreeing
 *                   with the epic section's own row, `EpicChildRow`,
 *                   which prints the same field. Empty on rows the
 *                   server sent no pair for: a leaf has nothing to roll
 *                   up.
 *   • `updated`   — printed today as one timestamp label: relative while
 *                   fresh, absolute `YYYY-MM-DD UTC` past a week
 *                   (sk-285.6.7). The default sort key's other half.
 *   • `created`   — NOT printed today, carried on every row, already a
 *                   card field, and the one date that answers "how long
 *                   has this been sitting here". Off by default.
 *
 * Deliberately ABSENT, and each for a reason:
 *
 *   • `title` — structural, see {@link TREE_TITLE_COLUMN}.
 *   • the delegated ★ (`iAssigned`) and the pin (`pinned`) — both are
 *     marks ON the title/identity of the row, not facts beside it, and
 *     the tree row paints them inside the first cell today. Making them
 *     columns would move them away from the thing they mark.
 *   • `score` — search-only (`/search` sets it, the list endpoints do
 *     not), so a column for it would be blank in the mode the tree is
 *     normally used in.
 *   • `project` — the Tasks column is scoped to the selected project (or
 *     to a lens that already says so); a column repeating one value on
 *     every row is a column of noise. If cross-project trees ever grow a
 *     need for it, it is one entry here plus one cell.
 */
export type TreeOptionalColumn =
  | 'id'
  | 'status'
  | 'blocked'
  | 'priority'
  | 'type'
  | 'assignee'
  | 'components'
  | 'labels'
  | 'progress'
  | 'updated'
  | 'created';

/**
 * Any column of the table, structural one included. Use this where a
 * consumer walks the whole header/row; use {@link TreeOptionalColumn}
 * wherever the value could be turned off, so that "turn off the title"
 * fails to compile.
 */
export type TreeColumn = TreeTitleColumn | TreeOptionalColumn;

/**
 * The switch list — top to bottom in the picker, and left to right in
 * the table (after the pinned title column).
 *
 * identity → state → people → taxonomy → rollups → time. See «Order» in
 * the module doc for why this is fixed.
 */
export const TREE_OPTIONAL_COLUMNS: readonly TreeOptionalColumn[] = [
  'id',
  'status',
  'blocked',
  'priority',
  'type',
  'assignee',
  'components',
  'labels',
  'progress',
  'updated',
  'created',
];

/**
 * The columns a user who never opens the picker sees — CHOSEN TO FIT the
 * column they are drawn in, which is the one thing the first version of
 * this list did not do.
 *
 * ## What changed, and why (sk-285.2.22)
 *
 * The first version was «the tree row as it reads today»: every property
 * `TaskTreeNode` printed as a mini-card became a column, nine of them,
 * on the principle that turning the table on must not take information
 * away. That principle is right and it is kept below — it just was not
 * the only constraint. Nine columns do not fit the Tasks column, so the
 * default state of the default view was a table under a permanent
 * horizontal scrollbar, and on first sight of the running app that is
 * exactly what came back: «make the tree block wider so the whole table
 * fits». Panning is the right mechanism for a narrow window or for a
 * user who switches everything on; it is the wrong DEFAULT.
 *
 * ## The arithmetic — every number below is declared somewhere in this
 * repo, and none of them is a measurement
 *
 * The width available to the table, at the 1284px floor, in Tree view,
 * with the two navigation columns folded (which is what entering Tree
 * view does — sk-285.2.23). Every line moved by 44px in sk-285.7 T009,
 * which raised the floor 1240 → 1284 under the new density:
 *
 *   `.shell-columns`  min-width  1284 − 2 × 3px lens frame        = 1278
 *   − Queues, Projects  2 × 44px slivers (`--width-sliver`)       = 1190
 *   − Details           `--col-details-board` 420, the pane's
 *                       floor beside the tree (sk-551.29)          =  770
 *   Tasks column      flexes into what is left                    =  770
 *   − `.col-tasks`    `border-right: 1px`, and the column is
 *                     border-box (Mantine's reset)                =  769
 *   − the vertical scrollbar on `.col-body`                       ≈  754
 *
 * `.tasks-body` sets `padding: 0`, so nothing else is deducted. The
 * scrollbar is the one UA-dependent term: 15px is the classic Chromium
 * one, and it is used here because it is the PESSIMISTIC case — with
 * overlay scrollbars (macOS) it takes 0 and the table gets the full 769.
 * ASSUMPTION, labelled as one: no layout engine runs in this repo's
 * tests, so 15px is a documented allowance, not something anyone
 * measured here.
 *
 * sk-405 made that term CONDITIONAL — `.col-body` reserves the gutter on
 * demand (`scrollbar-gutter: auto`) instead of always (`stable`) — and
 * the number above is unchanged, because a tree long enough to matter is
 * scrolling, which is exactly the case the pessimistic allowance already
 * described. A tree short enough not to scroll now gets 769; that is
 * slack, and slack cannot break an inequality that already held at
 * 754.
 *
 * What the table demands, at the set below
 * ({@link treeTableMinWidthPx}, i.e. the sum of the tracks):
 *
 *   title 200 + id 124 + status 108 + priority 108 + assignee 120  =  660
 *
 * 660 ≤ 754 — it FITS, with 94px to spare, and every one of those 94px
 * goes to the title, the only elastic track: the title renders well above
 * its 200px floor.
 *
 * sk-551.3 — that row has the pane at its floor, which is where the user
 * can drag it. Until they do, the pane takes 40 % of the 1190 it splits
 * with the tree (476), the column is 714 and the table gets 698: the
 * default set still fits (38px to spare), but none of the dropped
 * columns below does without that drag. `TreeTableLayout.test.tsx` pins the inequality, so
 * adding a column here — or widening one in `treeColumnLayout.ts` — turns
 * red rather than quietly bringing the scrollbar back.
 *
 * Four of those widths were raised after the table was seen running, and
 * each is recorded where it lives (`TREE_COLUMN_WIDTH_PX`): `status`
 * 84 → 108, because `in_progress` was being cut mid-word; `priority`
 * 48 → 96 and then 96 → 108, because the header read `P...` and later,
 * once TR7 made the headers uppercase, `ПРИОРИТ…`; `assignee` 104 → 120,
 * because `ИСПОЛНИТЕЛЬ` needed 111 in a 104 box and 9 of 21 visible rows
 * were printing a truncated username. None was catchable here: vitest
 * runs with no layout engine, so no test in this repo compares a track's
 * width against the width of the text inside it. That gap is real — new
 * columns need a look at the running app, not just a green suite.
 *
 * For contrast, the same arithmetic before sk-285.2.22: 944 demanded
 * against 572 available (588 − 1 − 15) — 372px short, on every screen,
 * forever. And before sk-285.2.23, when the tree pinned the navigation
 * columns to a 176px floor instead of folding them: 620 available
 * against the 524 the default set demanded then — 96px of slack, against
 * the 94 the folded row leaves the 660 it demands today.
 *
 * Switching ONE of the dropped columns back on fits for the NARROW two
 * and no longer for the five widest: type (+72) = 732 and
 * progress (+92) = 752 are ≤ 754; blocked (+104) = 764, over by 10,
 * components / labels / created (+112) = 772, over by 18, and
 * updated (+116) = 776, over by 22.
 *
 * (sk-412 moved `blocked` out of that list, 76 → 104: `БЛОКИРОВКА`
 * measured 92.92 in a 68px content box and had been cut on screen since
 * TR7. The maintainers were asked first, because the repair is exactly this
 * budget line — «a clipped heading» against «one fewer column that fits
 * at the floor» — and chose to widen. The English heading `BLOCKED`
 * never clipped, so the defect, and its price, are Russian-only.)
 *
 * (sk-407 moved two of those numbers, both because a HEADER was cut on
 * screen and neither catchable here: `progress` 72 → 92, where `ПРОГРЕСС`
 * needed 79 of a 72px track and `(закрыто 1/10)` needed 91; `updated`
 * 112 → 116, where `ОБНОВЛЕНО` needed 84.41 of an 84px label box and
 * rendered as «ОБНОВЛЕН…». `progress` is now the last column that fits
 * at the floor — 92 against 94 of slack — so it is the one to check
 * first the next time a width moves.)
 *
 * ── sk-285.7.14 — that last sentence used to say «EVERY one» ────────
 *
 * It did, against a 632px set with 122px of slack, and the paragraph
 * above it warned in as many words: «at 10px of headroom it will say it
 * soon». It said it. Re-measuring `priority` and `assignee` against the
 * headers they actually draw took the set to 660, and the four widest
 * optional columns stopped fitting at the FLOOR — they still fit on any
 * window wider than 1284, and at the floor the table pans, which is a
 * mechanism this file already relies on rather than a new failure.
 *
 * The price was not avoidable by taking the cheaper repair: `priority`
 * ALONE leaves 110px of slack, already under the 112 those four cost.
 * The trade was never «one column or two», it was this budget line
 * against two ellipsised headers and a truncated username on nearly half
 * the visible rows.
 *
 * (`updated` / `created` joined the 112px group in sk-285.6.7 — 88 → 112,
 * because the absolute form they now print past a week is
 * `2026-08-24 UTC` and not `2026-08-24`; sk-407 then took `updated` to
 * 116 for its header.) Two of the widest together (660 + 116 + 112 = 888)
 * do not fit, and neither does the full set — which is correct, and is
 * what the panning is still there for.
 *
 * That the default set is no longer the only one that fits is a reason
 * to REVISIT it, not to change it here and now: the columns dropped by
 * sk-285.2.22 stay one click away in the picker, and the spare width
 * goes to the titles until someone decides otherwise on purpose.
 *
 * ## Why THESE five slots, and what each dropped column costs
 *
 * Kept — identity, state, urgency, owner. That is the row of a triage
 * table, and it is what the first cell cannot say on its own:
 *   • `id`       — the string people paste into chat, and the only
 *                  fixed-width cell in the table.
 *   • `status`   — the primary state, and with `blocked` off it carries
 *                  the blocked marker again (`TaskTreeNode` folds it
 *                  back into the chip), so nothing is actually lost.
 *   • `priority` — the second axis of every triage scan. Its VALUE is
 *                  the narrowest thing the table prints (`P0`…`P4`),
 *                  but the column is 96px, not the 48 this line used to
 *                  claim: sk-285.7 widened it because the header
 *                  `Приоритет` did not fit. The narrowest COLUMNS are
 *                  `type` and `progress`, 72 each, and both are off by
 *                  default.
 *   • `assignee` — "who has this".
 *
 * Dropped, each recoverable from the picker in one click:
 *   • `blocked`  — folded into the status chip while it is off, see
 *                  above. This is the only one whose information does
 *                  not leave the screen at all.
 *   • `type`     — epics still read as epics (the magenta `.is-epic`
 *                  rail), so what is dropped is the bug/feature/decision
 *                  distinction, and that is a 72px column.
 *   • `progress` — empty on every non-epic row by construction, so it is
 *                  the column that pays the least rent per pixel.
 *   • `components` — 112px, the widest the table has, TIED with
 *                  `labels`, `updated` and `created` rather than alone
 *                  at the top; and the one whose value the Projects
 *                  column beside it already states for the current
 *                  scope.
 *   • `updated`  — the loss worth naming: it is the default sort key's
 *                  other half, so the reader now sees the ORDER without
 *                  the number behind it. The reason it was dropped no
 *                  longer holds, and saying so is the point of this
 *                  line: at the 1240px floor, turning it on left the
 *                  title track 8px above its 200px floor, and a tree
 *                  whose titles are ellipsed at depth 3 is a worse
 *                  table than one missing a date. T009's 1284px floor
 *                  ended that — with `id` still at 88 it read
 *                  596 + 112 = 708 of 754, a title track of 246px,
 *                  46 above its floor.
 *
 *                  ⚠ T028 has since taken most of that back, and the
 *                  CONCLUSION moves with it rather than the number
 *                  alone: `id` 88 → 124 makes it 632 + 112 = 744 of
 *                  754, so the title track is 210px — TEN above its
 *                  floor, against the EIGHT that got the column dropped
 *                  in the first place. "The reason it was dropped no
 *                  longer holds" is therefore no longer safe to say. It
 *                  holds by 2px. `updated` is still among the four most
 *                  expensive columns to turn back on rather than the
 *                  cheapest (that is `type` or `progress`, +72 → 704),
 *                  and switching it on at the floor now costs very
 *                  nearly what it cost before T009.
 *
 * `labels` and `created` were never in this set and still are not: the
 * mini-card row never printed them, so the table must not start.
 */
export const TREE_DEFAULT_COLUMNS: readonly TreeOptionalColumn[] = [
  'id',
  'status',
  'priority',
  'assignee',
];

/** The stored / in-memory shape of the preference. */
export type TreeColumnSet = ReadonlySet<TreeOptionalColumn>;

/**
 * The columns the table draws, in order, with the structural title
 * column pinned at index 0.
 *
 * The return type is a TUPLE whose head is {@link TreeTitleColumn}, so a
 * consumer destructuring `[first, ...rest]` is told by the compiler that
 * `first` is the title cell. There is no code path — here or in a
 * caller — that produces an order without it.
 */
export function treeColumnOrder(
  columns: Iterable<TreeOptionalColumn>,
): readonly [TreeTitleColumn, ...TreeOptionalColumn[]] {
  const on = new Set(columns);
  return [TREE_TITLE_COLUMN, ...TREE_OPTIONAL_COLUMNS.filter((c) => on.has(c))];
}

/** Bit per optional column. Order-independent; only uniqueness matters. */
const COLUMN_BIT: Record<TreeOptionalColumn, number> = {
  id: 1 << 0,
  status: 1 << 1,
  blocked: 1 << 2,
  priority: 1 << 3,
  type: 1 << 4,
  assignee: 1 << 5,
  components: 1 << 6,
  labels: 1 << 7,
  progress: 1 << 8,
  updated: 1 << 9,
  created: 1 << 10,
};

/**
 * Pack a column set into a bitmask.
 *
 * The tree is virtualized (sk-285.2.10) and its rows are memo()d, so a
 * row that took the `Set` as a prop would re-render on every parent tick
 * — a fresh `Set` per render breaks memo by identity. A number compares
 * by value and costs nothing. Same contract, same reason, as
 * `cardFieldsMask`.
 */
export function treeColumnsMask(columns: Iterable<TreeOptionalColumn>): number {
  let mask = 0;
  for (const c of columns) mask |= COLUMN_BIT[c];
  return mask;
}

/**
 * Is this switchable column drawn?
 *
 * {@link TreeOptionalColumn} and not the whole {@link TreeColumn} union:
 * the title column is not in the mask at all — it is structural, always
 * drawn, and `treeColumnOrder` puts it in front of every order without
 * consulting a bit. The signature used to be the wider one, with a
 * `column === TREE_TITLE_COLUMN → true` branch in front, and nothing in
 * the app ever took it: the one caller (`TaskTreeNode`, asking whether a
 * `blocked` column is carrying the marker its status chip would
 * otherwise show) passes a switchable column, and every loop over the
 * header cells reads the ORDER, which already has the title in it. A
 * branch whose only caller was its own test answers a question no
 * screen asks, and the type now says so.
 */
export function hasTreeColumn(mask: number, column: TreeOptionalColumn): boolean {
  return (mask & COLUMN_BIT[column]) !== 0;
}

/**
 * Storage encoding: comma-separated column names, registry order.
 *
 * The structural column is never written — it is not part of the set,
 * and a stored `title` would be a value the reader has to know to
 * ignore. AN EMPTY SET IS A LEGAL CHOICE (a bare tree of titles, which
 * is precisely the tree as it looked before columns existed), so it
 * serialises to `''`, and only a MISSING key means "no preference".
 */
export function serializeTreeColumns(
  columns: Iterable<TreeOptionalColumn>,
): string {
  const on = new Set(columns);
  return TREE_OPTIONAL_COLUMNS.filter((c) => on.has(c)).join(',');
}

/**
 * Decode a stored value. THREE outcomes, and the difference between the
 * last two is the whole point of this function:
 *
 *   • a MISSING key (`null` / `undefined`) → `null`, "no preference",
 *     and the caller falls back to {@link TREE_DEFAULT_COLUMNS};
 *   • an EMPTY value (`''`, the output of `serializeTreeColumns([])`) →
 *     the EMPTY SET. Turning every column off is a legal, deliberate
 *     choice — a bare tree of titles — and it has to come back as one;
 *   • a value this reader cannot read → `null` as well, i.e. the
 *     defaults.
 *
 * That last case is why "always return a set, however damaged the
 * input" was wrong. A hand-edited or half-written value that happens to
 * contain no column name at all (`'{"cols":["id"]}'`, a JSON blob from
 * some other key) used to parse as the empty set — which is
 * INDISTINGUISHABLE from the deliberate "titles only" choice. The table
 * then drew nothing but titles and the write-through effect stored `''`
 * over the damaged value, promoting an accident into a permanent
 * preference nobody chose. Unreadable input must degrade to the
 * defaults, not to somebody's setting.
 *
 * Degrading is still PARTIAL wherever it can be: as long as at least one
 * name is recognised, unknown names are dropped silently rather than
 * rejecting the value, so a set written by a newer build that offered
 * one more column still loads here, minus the column this build cannot
 * draw. `title` is one such unknown name — it is not a member of the
 * switchable set, so it is dropped like any other, and the pinned first
 * column comes from {@link treeColumnOrder} instead.
 *
 * Whitespace around the empty value is tolerated (`'   '` reads as the
 * empty choice) for the same reason it is trimmed around names: the
 * values this has to survive are hand-edited by people.
 */
export function parseTreeColumns(
  raw: string | null | undefined,
): TreeColumnSet | null {
  if (raw === null || raw === undefined) return null;
  // The empty CHOICE — stated explicitly, before any parsing, so it can
  // never be confused with "parsed and nothing came out".
  if (raw.trim() === '') return new Set<TreeOptionalColumn>();
  const known = new Set<string>(TREE_OPTIONAL_COLUMNS);
  const out = new Set<TreeOptionalColumn>();
  for (const part of raw.split(',')) {
    const name = part.trim();
    if (known.has(name)) out.add(name as TreeOptionalColumn);
  }
  // Not empty, and not one recognisable column name in it: this is not a
  // narrowed selection, it is a value this build cannot read. Say so.
  if (out.size === 0) return null;
  return out;
}
