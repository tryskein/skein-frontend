/**
 * sk-285.7 T008 — the WIDTH BUDGET: what the app's floor width is made
 * of, and the readability threshold the leftover has to clear.
 *
 * ─── Why this module exists ────────────────────────────────────────
 *
 * `--app-min-width` is not a design preference, it is a SUM. The
 * workspace draws three fixed columns at their `COL_BOUNDS` defaults,
 * a drag handle between each pair, a lens frame down both edges, and
 * hands everything left over to Details. The floor is the width at
 * which that leftover is still readable — so the floor is DERIVED from
 * the threshold, never the other way round.
 *
 * Until now that arithmetic lived in a comment beside the token in
 * `index.css` and the threshold (234) was named only in prose. SC-008
 * of the redesign spec is explicit that this will not do: the default
 * column widths live in code rather than in the stylesheet, and "the threshold of
 * readability of the remainder must be declared explicitly, not derived from a
 * comment". Hence one exported constant and one pure function, plus
 * `widthBudget.test.ts`, which recomputes the declared floor from the
 * live inputs and fails when the two drift apart.
 *
 * ─── DETAILS_MIN_READABLE_PX = 234, and what it costs ──────────────
 *
 * 234px is the leftover Details actually had at the pre-redesign floor
 * (`6 + 240 + 280 + 468 + 12 + 234 = 1240`). It is kept unchanged as a
 * deliberate decision, not carried over by inertia: it was already «the
 * narrowest at which the panel still reads», and raising it under the
 * new 16px base would push ordinary laptop widths (1280, 1366) below
 * the floor and into the tablet layout, which is a worse outcome than a
 * narrow Details panel at the one width where the window is exactly the
 * floor.
 *
 * T009 has since widened two of the columns (Queues 264, Projects 300 —
 * handoff §1) and the floor followed the sum to 1284, so 1280 and 1366
 * no longer sit the same way: 1366 is still above it, 1280 has fallen
 * just under and now pans by 4px. The threshold stayed 234 through that
 * — it is the one term that is a DECISION rather than a consequence,
 * and raising it as well would have taken the floor further still.
 *
 * ⚠ THE ACCEPTED COMPROMISE, stated plainly so nobody has to rediscover
 * it: a line of description text at the floor is SHORTER than the 45–75
 * character band this repo elsewhere treats as comfortable. This is a
 * compromise that was CHOSEN, not an oversight — Details is the elastic
 * zone, so every pixel past the floor goes to it, and the affordances
 * for buying width (drag a handle, fold Queues / Projects to their
 * slivers) are live at every width. Do not "fix" this by raising the
 * threshold without re-deciding the floor: the two move together, and
 * the floor decides where the tablet layout starts.
 *
 * ── sk-344 — the number, measured, and why the band is out of reach ──
 *
 * This paragraph used to point at the measure token in `index.css` and
 * at the test that pinned it, for the band and its calibration. BOTH
 * ARE GONE: sk-419 removed the cap on the maintainers' instruction ("the text
 * is not displayed over the whole width of the card block"), and the record of
 * that removal is sk-419 itself. A reader following the old pointer
 * found nothing, so the numbers live here.
 *
 * Measured in Chromium against the dev server, task `shop-6`,
 * 2026-09-20, counting characters per visual line with `Range`:
 *
 *   window 1284 (the floor)   .col-details 246   prose 194px   23 chars
 *   window 1440 (defaults)    .col-details 402   prose 350px   41 chars
 *
 * The 44 characters sk-344 was filed about is the 1440 DEFAULT column,
 * not the narrow end. The narrow end is 23 — half the band's lower
 * bound — and no amount of tuning reaches 45 there:
 *
 *   • raising this threshold: 45 characters need ≈380px of prose, i.e.
 *     a Details column of ≈422 and a floor of ≈1472. Every ordinary
 *     laptop width (1280, 1366, 1440) would fall BELOW the floor into
 *     the tablet layout — the cure is worse than the defect it treats;
 *   • shrinking the type: characters per line scale inversely with font
 *     size, so 23 → 45 asks for ≈8px text. Even `--font-xs` (12px), the
 *     smallest step this repo has, only reaches ≈31.
 *
 * So the band's lower end is unreachable at the floor BY CONSTRUCTION,
 * and 23 characters is the recorded deviation rather than an open bug.
 * Re-measure this table if the base font, the floor or `COL_BOUNDS`
 * moves.
 *
 * ─── Reading the formula ───────────────────────────────────────────
 *
 *     floor = LENS_FRAME_SIDES · lensFrame        ← chrome on the root
 *           + Σ bounds[col].default               ← the fixed columns
 *           + handleCount · widthResize           ← one handle each
 *           + DETAILS_MIN_READABLE_PX             ← the elastic zone
 *
 * Nothing here is hard-coded to today's three columns: the column term
 * walks whatever `COL_BOUNDS` contains and the handle count follows it,
 * on the assumption that the side-by-side shell renders one
 * `ResizeHandle` per entry. No test checks that count against
 * `Shell.tsx`; a column added to the map must be checked against the
 * shell by review. The sections column (sk-551.8) is not in `COL_BOUNDS`
 * and not a term of the floor (INV-2).
 */

/** One column's resize bounds — the shape of a `COL_BOUNDS` entry. */
export interface ColWidthBounds {
  readonly min: number;
  readonly max: number;
  readonly default: number;
}

/**
 * The fixed columns of the workspace, keyed by column id.
 *
 * Structurally the same map as `COL_BOUNDS` in `useLayoutState.tsx`,
 * declared here as its own type rather than imported so this module
 * stays a pure statement of the arithmetic and the test supplies the
 * real map as data.
 */
export type ColWidthBoundsMap = Readonly<Record<string, ColWidthBounds>>;

/** The stylesheet lengths the budget consumes, in px. */
export interface WidthBudgetTokens {
  /** `--lens-frame` — the border drawn on `.shell-root`. */
  readonly lensFramePx: number;
  /** `--width-resize` — the hit area of one drag handle. */
  readonly widthResizePx: number;
}

/**
 * The floor, itemised. Returned rather than just the total so the test
 * can assert WHICH columns were counted — a budget that silently skips
 * a column would otherwise only show up as a wrong number, with no way
 * to tell a dropped term from a changed default.
 */
export interface FloorBreakdown {
  /** Per-column contribution, in `Object.keys(bounds)` order. */
  readonly columns: ReadonlyArray<{ readonly col: string; readonly px: number }>;
  /** Σ of the column defaults. */
  readonly columnsPx: number;
  /** The lens frame, both sides. */
  readonly framePx: number;
  /** One drag handle per fixed column. */
  readonly handleCount: number;
  /** `handleCount · widthResize`. */
  readonly handlesPx: number;
  /** The elastic zone's guaranteed share: `DETAILS_MIN_READABLE_PX`. */
  readonly detailsPx: number;
  /** The sum of every term above — the floor. */
  readonly floorPx: number;
}

/**
 * The readability threshold for the Details panel, in px.
 *
 * The width below which the description stops being worth reading, and
 * therefore the share of the floor that is reserved for Details before
 * any other zone gets a pixel. Declared, not derived: see the docblock
 * above for why the value is 234 and what it concedes.
 */
export const DETAILS_MIN_READABLE_PX = 234;

/**
 * How many times the lens frame is paid out of the floor.
 *
 * Two — one border down each edge of `.shell-root`. Named because the
 * stylesheet spends the same 2 in `.shell-root`'s
 * `--app-min-width-inner: calc(var(--app-min-width) - 2 * var(--lens-frame))`,
 * and the two have to agree: if the shell subtracted a frame the budget
 * had not added, the columns row would be a frame narrower than the
 * layout is designed for at the exact width it is designed for. The
 * test pins this constant against that declaration.
 */
export const LENS_FRAME_SIDES = 2;

function requireFinite(value: number, what: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`widthBudget: ${what} must be a finite, non-negative number, got ${value}`);
  }
  return value;
}

/**
 * Itemise the floor width from the live column defaults and stylesheet
 * lengths.
 *
 * Throws on an empty `bounds` map. A workspace with no fixed columns is
 * not a layout this budget describes, and returning `frame + threshold`
 * for one would hand every caller a plausible number computed from
 * nothing — the failure mode a guard exists to prevent, not to model.
 */
export function appFloorBreakdown(
  bounds: ColWidthBoundsMap,
  tokens: WidthBudgetTokens,
): FloorBreakdown {
  const keys = Object.keys(bounds);
  if (keys.length === 0) {
    throw new Error('widthBudget: bounds is empty — the width budget needs at least one column');
  }

  const lensFramePx = requireFinite(tokens.lensFramePx, '--lens-frame');
  const widthResizePx = requireFinite(tokens.widthResizePx, '--width-resize');

  const columns = keys.map((col) => ({
    col,
    px: requireFinite(bounds[col].default, `${col}.default`),
  }));
  const columnsPx = columns.reduce((sum, c) => sum + c.px, 0);

  const framePx = LENS_FRAME_SIDES * lensFramePx;
  // One drag handle per fixed column — the shell renders exactly one
  // `ResizeHandle` for each entry of the map, so the count follows the
  // map instead of being a literal that a fourth column would outdate.
  const handleCount = keys.length;
  const handlesPx = handleCount * widthResizePx;

  return {
    columns,
    columnsPx,
    framePx,
    handleCount,
    handlesPx,
    detailsPx: DETAILS_MIN_READABLE_PX,
    floorPx: framePx + columnsPx + handlesPx + DETAILS_MIN_READABLE_PX,
  };
}

/**
 * The floor width the layout should declare as `--app-min-width`, in px.
 *
 * The value `index.css` is expected to carry; the guard in
 * `widthBudget.test.ts` compares the declaration against this.
 */
export function appFloorPx(bounds: ColWidthBoundsMap, tokens: WidthBudgetTokens): number {
  return appFloorBreakdown(bounds, tokens).floorPx;
}

/**
 * What is left for Details once the fixed zones, their handles and the
 * frame are paid out of `floorPx`.
 *
 * Separate from `appFloorPx` on purpose: the floor being EQUAL to the
 * formula and the leftover CLEARING the threshold are two different
 * claims. A floor set above the formula still satisfies the budget
 * (Details simply gets more), and only this function can say so.
 */
export function detailsRemainderPx(
  floorPx: number,
  bounds: ColWidthBoundsMap,
  tokens: WidthBudgetTokens,
): number {
  const b = appFloorBreakdown(bounds, tokens);
  return requireFinite(floorPx, 'floorPx') - b.framePx - b.columnsPx - b.handlesPx;
}
