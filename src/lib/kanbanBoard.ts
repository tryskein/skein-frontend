/**
 * sk-285.2.3 / sk-285.2.4 — the Kanban board's pure model.
 *
 * The board is a PROJECTION of the very list the Tasks column already
 * shows: same query, same filters, same page of issues. Nothing here
 * fetches, nothing here holds state — it takes the visible
 * `IssueSummary[]` and answers three questions:
 *
 *   1. which columns exist, and in what order;
 *   2. which issue belongs to which column;
 *   3. which columns you may drag out of / into.
 *
 * Keeping that in a hook-free module is what makes the rules testable
 * without a DOM, and what stops the drag handler and the paint from
 * disagreeing about whether a drop is legal.
 *
 * ── The axis is a choice (sk-285.2.4) ─────────────────────────────
 *
 * The columns are one FIELD of the issue projected sideways, and which
 * field that is comes from the user (`KanbanAxis`). `status` stays the
 * default because it is the one axis that needs no configuration to be
 * useful (the board must open and
 * work without a single setting).
 *
 * Two axes — `component` and `label` — are MULTI-VALUED per issue. The
 * project decided (research §4.2) to allow them anyway: an issue with
 * two components is shown in two columns. That is a deliberate
 * departure from YouTrack, which forbids such axes precisely to avoid
 * the duplicate. The duplicate is only honest if the user can SEE it,
 * so every copy of a multi-column card carries the list of the other
 * columns it also sits in (`kanban-card-also` in the view).
 */

import type { IssueStatus, IssueSummary, IssueType, StatusFilter } from '../api/issues';

/**
 * Which issue field the columns project.
 *
 * Every value here is a real column of `issues` (or one of its two
 * many-to-many tables) — the board writes fields, it never invents
 * state of its own, so an axis that is not a field is not an axis.
 */
export type KanbanAxis =
  | 'status'
  | 'priority'
  | 'type'
  | 'assignee'
  | 'project'
  | 'component'
  | 'label';

/** Selector order — the same order the dropdown offers. */
export const KANBAN_AXES: readonly KanbanAxis[] = [
  'status',
  'priority',
  'type',
  'assignee',
  'project',
  'component',
  'label',
];

export const KANBAN_DEFAULT_AXIS: KanbanAxis = 'status';

/**
 * Axes on which ONE issue can hold several values at once.
 *
 * The consequence is a card rendered in more than one column. Two
 * things follow, and both are enforced elsewhere in this module's
 * contract rather than left to the view: the duplicate must be
 * recognisable as a duplicate, and a drag must know which of the
 * card's values it is replacing (see `nextMultiValue`).
 */
export const KANBAN_MULTI_VALUE_AXES: ReadonlySet<KanbanAxis> = new Set<KanbanAxis>([
  'component',
  'label',
]);

/**
 * Axes the board may not write.
 *
 * `project` is the whole list: Skein has no "move issue to another
 * project" operation — the equivalent is copy + `supersedes`, a
 * deliberate, two-issue act that a mouse gesture must not perform by
 * accident. The axis stays available because "who is doing what, split
 * by project" is a genuinely useful cross-project read; it is simply
 * read-only, painted with the same lock the `standing` column uses.
 */
export const KANBAN_READ_ONLY_AXES: ReadonlySet<KanbanAxis> = new Set<KanbanAxis>([
  'project',
]);

/**
 * How far back the `closed` column looks, in days.
 *
 * On a real project closed issues outnumber open ones several times
 * over, so a complete `closed` column would drown the board and push
 * every other column off-screen. The column is therefore a WINDOW on
 * recent completions, not an archive — the archive is the list view
 * with `status = Done`.
 *
 * sk-285.2.4 — the window follows the closed ISSUE, not the closed
 * COLUMN: on a priority or assignee axis the same old closures would
 * otherwise flood every column at once. One rule, every axis: work
 * closed longer ago than this is not on the board.
 *
 * Deliberately a single named constant: the window is expected to
 * become a user setting once somebody asks for it (research §4.3), and
 * that change should be "read this from state instead of the constant",
 * nothing more.
 */
export const KANBAN_CLOSED_WINDOW_DAYS = 14;

/**
 * Status column order, left to right.
 *
 * `open → in_progress → deferred → closed` is the flow the user was
 * promised, in that order. `standing` is appended AFTER it rather than
 * spliced into the middle: it is a read-only column (see
 * `isKanbanDropTarget`), and a locked column sitting between two
 * draggable ones would read as a gap in the flow. At the far right it
 * reads as what it is — a parallel bucket of perpetual obligations
 * that the flow does not pass through.
 */
export const KANBAN_COLUMN_ORDER: readonly IssueStatus[] = [
  'open',
  'in_progress',
  'deferred',
  'closed',
  'standing',
];

/** Priority axis — five columns, P0 (highest) to P4. */
export const KANBAN_PRIORITY_ORDER: readonly string[] = ['0', '1', '2', '3', '4'];

/**
 * Type axis — the wire enum, in the order the type filter lists it.
 * Eight columns is a lot, and that is fine: the strip pans.
 */
export const KANBAN_TYPE_ORDER: readonly IssueType[] = [
  'bug',
  'feature',
  'task',
  'epic',
  'chore',
  'decision',
  'idea',
  'note',
];

/**
 * Statuses the board may not move an issue out of, or into.
 *
 * This is NOT a taste call — the backend rejects both directions:
 * `in_progress → standing` fails with `cannot_promote_locked_to_standing`
 * and `standing → in_progress` with `cannot_work_standing_directly`
 * (research §2). A board that accepted the gesture and then bounced the
 * card back would be teaching the user a rule by punishing them for it,
 * so the lock is painted BEFORE the drag: the column is marked locked,
 * its cards carry no drag listeners, and its droppable is disabled.
 */
export const KANBAN_LOCKED_STATUSES: ReadonlySet<IssueStatus> = new Set<IssueStatus>([
  'standing',
]);

/** True when a card in this status may be picked up at all. */
export function isKanbanDraggable(status: IssueStatus): boolean {
  return !KANBAN_LOCKED_STATUSES.has(status);
}

/** True when a card may be dropped into this column. */
export function isKanbanDropTarget(status: IssueStatus): boolean {
  return !KANBAN_LOCKED_STATUSES.has(status);
}

/**
 * Is this closed issue recent enough for the board?
 *
 * `IssueSummary` carries no `closedAt` (only `IssueDetail` does), so the
 * window is measured on `updatedAt`. Closing an issue writes it, so a
 * freshly closed row always passes; the imprecision runs the other way
 * — an OLD closure that was commented on yesterday also passes. That
 * errs toward showing recently-touched work, which is what the window
 * is for. Fetching a detail per row to get an exact `closedAt` would
 * cost one round-trip per card for a cosmetic gain.
 */
export function isWithinClosedWindow(
  updatedAt: string,
  now: number,
  windowDays: number = KANBAN_CLOSED_WINDOW_DAYS,
): boolean {
  const ts = Date.parse(updatedAt);
  // Unparseable timestamp → keep the card. Dropping a row because we
  // could not read its date would silently lose work from the board.
  if (Number.isNaN(ts)) return true;
  return now - ts <= windowDays * 24 * 60 * 60 * 1000;
}

/**
 * Does the SHARED status filter blank this column?
 *
 * The board reads the same filter set as the list — it is a view of one
 * task set, not a second source of truth (research §3.4). On a board
 * whose columns ARE the status axis that has a visible consequence: a
 * status filter no longer narrows rows, it empties whole columns. The
 * default filter (`active`) empties exactly one, `closed`.
 *
 * We report that as its own state rather than letting the column render
 * a plain "empty": "nothing is done here" and "you are not looking at
 * done work" are different facts, and only one of them is fixed by a
 * click.
 *
 * `'blocked'` is orthogonal — it is a derived flag, not a status — so it
 * hides nothing here; whatever rows survive it land in their real
 * status columns.
 *
 * On every OTHER axis the status filter is back to what it always was —
 * a row filter — so no column is ever blanked by it.
 */
export function isColumnHiddenByFilter(
  status: IssueStatus,
  filter: StatusFilter,
): boolean {
  if (filter === 'all' || filter === 'blocked') return false;
  if (filter === 'active') return status === 'closed';
  return filter !== status;
}

/**
 * sk-551.32 — the status filter a board falls back to when nothing
 * better is known: the shared filter's own default (`useTasksUiState`
 * opens on `'active'`), i.e. the filter that folds exactly `closed`.
 */
export const KANBAN_FOLD_FALLBACK_FILTER: StatusFilter = 'active';

/**
 * sk-551.32 — may this status column be folded back into a sliver, and
 * with which filter?
 *
 * A sliver unfolds by widening the SHARED status filter to `'all'`
 * (sk-551.3); the inverse is putting back the filter it was widened
 * from. `restoreTo` is that filter when the board saw the widening, and
 * {@link KANBAN_FOLD_FALLBACK_FILTER} otherwise — after a reload, or when
 * `'all'` was picked in the filter panel, the board has no record of a
 * previous filter, and the default is the one whose folded column (Done)
 * the user is looking at.
 *
 * Offered only while the filter IS `'all'`: under any narrower filter a
 * column is either already folded or one the user chose to see, and
 * swapping that filter out from a column head would undo a choice the
 * board did not make. Returns the filter to write, or `null` when the
 * column has no fold.
 */
export function foldFilterFor(
  status: IssueStatus,
  current: StatusFilter,
  restoreTo: StatusFilter | null,
): StatusFilter | null {
  if (current !== 'all') return null;
  const target = restoreTo ?? KANBAN_FOLD_FALLBACK_FILTER;
  return isColumnHiddenByFilter(status, target) ? target : null;
}

/**
 * The column values one issue occupies on a given axis.
 *
 * `null` is the "none" bucket — unassigned, no component, no label. On
 * the multi-value axes an issue with two components returns two values
 * and is therefore rendered twice, by design (research §4.2).
 */
export function issueAxisValues(
  item: IssueSummary,
  axis: KanbanAxis,
): Array<string | null> {
  switch (axis) {
    case 'status':
      return [item.status];
    case 'priority':
      return [String(item.priority)];
    case 'type':
      return [item.type];
    case 'assignee':
      return [item.assignee ? item.assignee : null];
    case 'project':
      return [item.projectId];
    case 'component':
      return item.componentIds.length > 0 ? [...item.componentIds] : [null];
    case 'label':
      return item.labels.length > 0 ? [...item.labels] : [null];
  }
}

/**
 * Stable per-column identity — the dnd droppable id and the React key.
 *
 * `null` (the "none" bucket) gets a sentinel that no real value can
 * collide with: an empty string is a plausible label, a NUL byte is not.
 */
export function kanbanColumnKey(axis: KanbanAxis, value: string | null): string {
  return `${axis}\u0000${value ?? '\u0000none'}`;
}

/**
 * Per-CARD identity, unique across columns.
 *
 * On a multi-value axis the SAME issue is draggable from several
 * columns, so the issue id alone is not a usable dnd id — two
 * draggables sharing an id makes dnd-kit pick one arbitrarily, and the
 * drag would then claim to start from a column the user never touched.
 * Which column a drag started in is exactly the fact the replacement
 * semantics turn on, so it is carried in the id.
 */
export function kanbanCardKey(columnKey: string, issueId: string): string {
  return `${columnKey}\u0001${issueId}`;
}

export interface KanbanColumn {
  /** dnd droppable id / React key — see {@link kanbanColumnKey}. */
  key: string;
  axis: KanbanAxis;
  /** The axis value this column writes on drop; `null` = the "none" bucket. */
  value: string | null;
  /** Visible cards, in the order the shared sort handed them over. */
  items: IssueSummary[];
  /** The shared status filter excludes this status entirely (status axis only). */
  hiddenByFilter: boolean;
  /** Cards may be dragged out of / dropped into this column. */
  droppable: boolean;
  /**
   * How many of this column's closed issues fell outside the
   * {@link KANBAN_CLOSED_WINDOW_DAYS} window. Surfaced as a footnote so
   * the column never silently swallows rows.
   */
  hiddenByWindow: number;
}

/** True when a column of this axis/value accepts drops. */
export function isColumnDroppable(axis: KanbanAxis, value: string | null): boolean {
  if (KANBAN_READ_ONLY_AXES.has(axis)) return false;
  if (axis === 'status') return isKanbanDropTarget(value as IssueStatus);
  return true;
}

/**
 * True when THIS card, sitting in THIS column, can be picked up.
 *
 * Distinct from `isColumnDroppable` because the two are not symmetric:
 * on the status axis it is the CARD's own status that locks it, and a
 * lock has to be visible on the card, not only on the column.
 */
export function isCardDraggable(
  axis: KanbanAxis,
  item: IssueSummary,
): boolean {
  if (KANBAN_READ_ONLY_AXES.has(axis)) return false;
  if (axis === 'status') return isKanbanDraggable(item.status);
  return true;
}

export interface BuildKanbanInput {
  axis: KanbanAxis;
  items: readonly IssueSummary[];
  /** The EFFECTIVE status filter — the one the dropdown displays. */
  statusFilter: StatusFilter;
  /**
   * Component ids known for the current project, so a component with no
   * loaded issues still gets its (empty) column. Only the component
   * axis takes such a seed: the list is small, already fetched for the
   * cards, and an existing-but-empty component is a fact worth showing.
   * The other dynamic axes derive their columns from the visible issues
   * alone — seeding `assignee` from the org directory would open tens of
   * thousands of columns.
   */
  knownComponentIds?: readonly string[];
  /**
   * sk-285.2.6 — project ids that must get a column on the `project`
   * axis even when no loaded issue lands in them.
   *
   * The board's focus (see `lib/kanbanProjectFocus.ts`) is a statement
   * about the COLUMN SET, not only about the rows: "I work on mob and
   * pay" means a board of mob and pay, and a focused project with
   * nothing open in it is a fact — an empty column — not an absence.
   * Without the seed the axis would quietly drop it and the user would
   * read the board as if the project were not focused at all.
   *
   * Same shape and same reasoning as `knownComponentIds`; unset means
   * the axis derives its columns from the visible issues alone, exactly
   * as before.
   */
  knownProjectIds?: readonly string[];
  /**
   * Display name of an axis value, used ONLY to order the dynamic
   * columns. Injected rather than imported so this module stays free of
   * i18n and of the component/project name caches. Without it the
   * columns sort by raw value, which for component ids means UUID order.
   */
  resolveLabel?: (value: string) => string;
  now?: number;
  windowDays?: number;
}

/**
 * The ordered column values for an axis.
 *
 * Fixed axes (status / priority / type) always return their full
 * enumeration — an empty `deferred` column is information. Dynamic axes
 * return what the visible issues actually contain, sorted by display
 * label, with the "none" bucket LAST.
 *
 * That bucket is kept even when empty on every WRITABLE axis, and it is
 * the drag that decides it: dropping into "no component" is the only way
 * to detach one, and dropping into "unassigned" the only way to unassign.
 * Hiding the bucket the moment its last card leaves would make the axis
 * one-way — the user could drag work out of "unassigned" and never drag
 * it back. On the read-only `project` axis there is no such need (and no
 * project-less issue), so it appears only if something is in it.
 */
function columnValuesFor(input: BuildKanbanInput): Array<string | null> {
  const { axis, items } = input;
  if (axis === 'status') return [...KANBAN_COLUMN_ORDER];
  if (axis === 'priority') return [...KANBAN_PRIORITY_ORDER];
  if (axis === 'type') return [...KANBAN_TYPE_ORDER];

  const seen = new Set<string>();
  let hasNone = false;
  for (const item of items) {
    for (const v of issueAxisValues(item, axis)) {
      if (v === null) hasNone = true;
      else seen.add(v);
    }
  }
  if (axis === 'component') {
    for (const id of input.knownComponentIds ?? []) seen.add(id);
  }
  if (axis === 'project') {
    for (const id of input.knownProjectIds ?? []) seen.add(id);
  }
  const label = input.resolveLabel ?? ((v: string) => v);
  const values: Array<string | null> = [...seen].sort((a, b) =>
    label(a).localeCompare(label(b)),
  );
  if (hasNone || isColumnDroppable(axis, null)) values.push(null);
  return values;
}

/**
 * Bucket the visible issues into board columns.
 *
 * Input order is preserved inside every column: `useTasks` has already
 * applied the shared sort, and the board deliberately does not re-sort
 * (there is no manual rank in the schema — research §2 — so the only
 * honest order is the list's own).
 *
 * Counting note (CLAUDE.md, "My-assigned mode toggle invariant"): the
 * per-column counts are `items.length` of THIS function's output, i.e.
 * derived from the exact rows the board shows. Those rows come from
 * `useTasks`, which already applies the `outboxMode` lens at the wire
 * (`createdBy=me` / the `/me/created-by` surface). So the lens reaches
 * every column head for free, and — more importantly — the board can
 * never print a number that disagrees with the cards under it. Do NOT
 * "fix" this by re-filtering here against a second scoping rule: two
 * scopings is exactly the failure the invariant exists to prevent.
 *
 * On a multi-value axis the SUM of the counts exceeds the number of
 * issues, because a card really is in both columns. That is the price
 * of the axis, and it is paid visibly: each duplicate names the other
 * columns it lives in.
 */
export function buildKanbanColumns(input: BuildKanbanInput): KanbanColumn[] {
  const {
    axis,
    items,
    statusFilter,
    now = Date.now(),
    windowDays = KANBAN_CLOSED_WINDOW_DAYS,
  } = input;

  const order = columnValuesFor(input);
  const columns = new Map<string | null, KanbanColumn>();
  for (const value of order) {
    columns.set(value, {
      key: kanbanColumnKey(axis, value),
      axis,
      value,
      items: [],
      hiddenByFilter:
        axis === 'status'
          ? isColumnHiddenByFilter(value as IssueStatus, statusFilter)
          : false,
      droppable: isColumnDroppable(axis, value),
      hiddenByWindow: 0,
    });
  }

  for (const item of items) {
    // One rule for every axis: work closed longer ago than the window
    // is off the board entirely, not just off the `closed` column.
    const stale =
      item.status === 'closed' && !isWithinClosedWindow(item.updatedAt, now, windowDays);
    for (const value of issueAxisValues(item, axis)) {
      const col = columns.get(value);
      // An unknown value on a FIXED axis would be a wire value the UI
      // has not been taught yet; drop it rather than inventing a column.
      if (!col) continue;
      if (col.hiddenByFilter) continue;
      if (stale) {
        col.hiddenByWindow += 1;
        continue;
      }
      col.items.push(item);
    }
  }

  return order.map((v) => columns.get(v)!);
}

/**
 * The card's OTHER columns on a multi-value axis.
 *
 * Feeds the "also in …" line every duplicate carries. Empty for
 * single-value axes and for a card that genuinely lives in one column,
 * so the line appears exactly when it is telling the user something.
 */
export function otherAxisValues(
  item: IssueSummary,
  axis: KanbanAxis,
  columnValue: string | null,
): string[] {
  if (!KANBAN_MULTI_VALUE_AXES.has(axis)) return [];
  return issueAxisValues(item, axis).filter(
    (v): v is string => v !== null && v !== columnValue,
  );
}

/**
 * Replacement semantics for a multi-value axis (research §4.2).
 *
 * Dragging a card out of the `frontend` column and into `backend`
 * REPLACES `frontend` with `backend` and leaves every other component
 * alone. The alternative — "add the target, keep the source" — makes
 * the gesture unable to ever remove anything, and the card would stay
 * in the column the user just dragged it out of, which reads as a
 * failed drag.
 *
 * The value's POSITION is preserved rather than appended, so a card
 * whose components the user is re-pointing does not shuffle its
 * secondary chips around on every drag.
 *
 * `from === null` (dragged out of the "none" bucket) adds; `to === null`
 * (dropped into it) removes.
 */
export function nextMultiValue(
  current: readonly string[],
  from: string | null,
  to: string | null,
): string[] {
  const hadFrom = from !== null && current.includes(from);
  const out: string[] = [];
  for (const v of current) {
    const next = hadFrom && v === from ? to : v;
    // `to === null` — the value is dropped rather than replaced.
    if (next === null) continue;
    // Replacing `api` with a `ui` the task already carries must not
    // produce two `ui`: the set is a set, whatever the join table would
    // tolerate.
    if (!out.includes(next)) out.push(next);
  }
  if (!hadFrom && to !== null && !out.includes(to)) out.push(to);
  return out;
}
