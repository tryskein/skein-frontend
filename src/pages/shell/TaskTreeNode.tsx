import {
  IconChevronDown,
  IconChevronRight,
  IconPoint,
  IconStarFilled,
} from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { IssueIDBadge } from '../../components/IssueIDBadge';
import { Attribute, isDerivedBlocked } from '../../components/Attribute';
import { SearchHighlight } from '../../components/SearchHighlight';
import { formatRelative, formatTimestamp } from '../../components/format';
import { highlightMatch } from '../../lib/highlightMatch';
import { isExpandableRow, isOpenRow } from '../../lib/treeKeyboardNav';
import { hasTreeColumn, type TreeOptionalColumn } from '../../lib/treeColumns';
import { progressCaption, progressNumbers } from '../../lib/progressNumbers';
import { epicProgressChipText } from './epicProgressChipText';
import type { TreeColumnOrder } from '../../lib/treeColumnLayout';
import type { EpicProgress, IssueTreeRowItem } from '../../api/issues';
import type { FlatTreeRow } from '../../lib/flattenTree';
import type { TreeRowPosition } from '../../lib/treeRowPositions';

/**
 * One row in the Tasks-column layered tree-view (sk-36).
 *
 * Rewritten in sk-36 as a SINGLE-ROW component — the recursion was
 * pushed up to the caller, which now feeds a pre-flattened DFS row
 * list. This keeps the renderer simple (one node = one DOM row), lets
 * the caller centralise expand/collapse filtering, and makes the
 * cycle/reference rows trivial to surface (just another flat row with
 * `isReference=true`).
 *
 * ─── sk-285.2.19 — the row is a TABLE ROW ──────────────────────────
 *
 * It used to be a small card: title, then the id on its own line, then a
 * meta line of chips and dates — the same four-line stack `TaskCard`
 * draws, so that flipping Cards ↔ Tree changed the list's structure and
 * not the shape of its rows. That stack is gone. A tree is read by
 * scanning DOWN, and a stack of ragged mini-cards gives the eye no
 * column to scan: "who is this on" sits at a different x on every row,
 * because it follows however much title the row above happened to have.
 *
 * So: one row, one grid, one cell per column, the columns chosen by the
 * user (`lib/treeColumns.ts`) and laid out by `lib/treeColumnLayout.ts`.
 * The recipe per row is now:
 *
 *   [ chev? ★? title…                        ] [id] [status] [P2] … 
 *
 * Two consequences worth stating, because they are decisions and not
 * side effects:
 *
 *   • FIXED HEIGHT. Every row is `--tree-row-h` tall; a title that does
 *     not fit is cut with an ellipsis and the whole of it is on hover
 *     (`title` attribute). A table with rows of three different heights
 *     is not scannable, and a virtualized list of fixed rows can be
 *     positioned exactly rather than estimated and corrected.
 *   • THE FIRST CELL IS THE TREE. The chevron and the depth indent
 *     live inside the title cell, which is why `treeColumnOrder` pins
 *     `'title'` at index 0 and why the title cell is written out here
 *     rather than coming out of the generic cell switch. Nothing structural may leak into
 *     the value columns: a status chip that moved right as the row got
 *     deeper would destroy the very column the table exists to create.
 *
 * ─── THE EDGE TYPE IS NO LONGER SHOWN (accepted trade-off) ─────────
 *
 * Until this change the first cell opened with a 12-px CONNECTOR slot:
 * for every row with `depth > 0 && edgeType`, a glyph + coloured rail
 * keyed on the dep type (↥ parent-child, ⊘ blocks, ⧖ waits-for,
 * ↔ related, ↳ discovered-from, ⇐ supersedes, ≈ duplicates), plus a
 * hairline indent guide down the parent's column. Expanding an epic
 * stacked those glyphs into a column of symbols on the left edge, and
 * on review of the running app both were called noise and removed: the
 * nesting is already legible from the indent step alone.
 *
 * WHAT WAS LOST, said plainly so the next reader does not go hunting.
 * The connector was the ONLY place in the tree where an edge's TYPE was
 * visible. Today that costs nothing in practice because the flattener
 * feeds the tree parent-child edges, but in the layered mode — where
 * `blocks` / `waits-for` / `related` edges are walked as well — a child
 * reached by a `blocks` edge now renders identically to a plain
 * descendant. `row.edgeType` still carries the type on every flat row
 * (`lib/flattenTree.ts`), and `DEP_TYPE_GLYPHS` / `DEP_TYPE_TOOLTIPS` /
 * `DEP_TYPE_CSS_VARS` still exist in `lib/depTypeIcons.ts` (TaskCard
 * and TaskFilters use them), so nothing has to be rebuilt to bring the
 * information back. Bring it back as a COLUMN of the table — an
 * optional `edge` column in `lib/treeColumns.ts`, one glyph in its own
 * cell — rather than as a leading slot in the title cell: a column is
 * scannable down the page and cannot re-grow the left gutter, which is
 * what the removal was about.
 *
 * Reference rows (isReference=true) render at opacity 0.45 in italics
 * with a trailing "↻ see {firstSeenAt}" jump button that calls
 * `onJumpToFirst`. They never render the chevron and never recurse —
 * children are suppressed upstream by the backend / adapter.
 *
 * Hidden-stub detection: cross-project parents the caller can't see
 * surface as `isReference=true && firstSeenAt === null && item.title
 * === '<hidden>'` — rendered as a plain gray non-clickable row with no
 * jump-back affordance, and with its value cells left EMPTY: the stub
 * carries no data of its own, and printing a status for a record the
 * caller cannot see would be inventing one. The empty cells are still
 * rendered, so the stub keeps the table's column alignment.
 *
 * Context rows (`isContext=true`, sk-285.2.7) are real, openable issues
 * that are on screen only to hold a branch up: a parent pulled in
 * because the page did not contain it. They render dimmed, and WITHOUT
 * a chevron — the caller keeps them permanently expanded, because
 * collapsing scaffolding the user never asked for would hide the rows
 * that actually matched the filter. This is the one "structural row"
 * state in the tree; ancestors-of-matches reuse it rather than adding
 * a second look for the same idea. They also carry no search highlight
 * (sk-285.2.8) — see `titleHtml` below.
 */
export interface TaskTreeNodeProps {
  row: FlatTreeRow;
  selectedId: string | null;
  /**
   * Ids rendered open. Read-only: sk-285.2.8 hands down a MERGED set
   * (persisted manual expansion + the paths auto-opened under a filter),
   * which the row must not mutate.
   */
  expanded: ReadonlySet<string>;
  searchQuery: string;
  componentNames: Map<string, string>;
  /**
   * sk-285.2.19 — the columns this row prints, in order, title first.
   *
   * An ARRAY and not the preference `Set`: the list memoises it once per
   * column change (`treeColumnOrder`) and hands the same reference to
   * every row, where a fresh `Set` per render would defeat any memo the
   * rows grow later. It is also the SAME array the header strip
   * iterates, which is what keeps a cell under its own heading.
   */
  columns: TreeColumnOrder;
  /**
   * The same set as a bitmask, for the one place a cell has to ask about
   * a column OTHER than itself: the status chip carries the derived
   * blocked marker only when there is no `blocked` column to carry it.
   */
  columnsMask: number;
  onSelect: (item: IssueTreeRowItem) => void;
  onToggle: (id: string) => void;
  /**
   * Reference-row affordance — fired when the user clicks "↻ see
   * {firstSeenAt}". Caller scrolls / opens the first-occurrence row.
   */
  onJumpToFirst?: (firstSeenAt: string) => void;
  /**
   * sk-285.2.11 — this row owns the tree's single tab stop (roving
   * tabindex). Exactly one rendered row may carry it; the list decides
   * which, because only the list knows the focused INDEX — an issue id
   * can occupy two rows at once (canonical + reference pointer) and both
   * would claim the stop if the row decided for itself.
   *
   * Optional so the row stays renderable on its own in tests and in any
   * future non-navigable listing; the default (`false`) simply means
   * "not the tab stop".
   */
  focused?: boolean;
  /**
   * sk-285.2.19 — which CELL of this row owns the tab stop, or `null`
   * when the row itself does. Only meaningful while `focused`.
   *
   * A treegrid has two focus modes, and the roving tabindex has to land
   * on exactly one element either way: the row in row mode, that cell in
   * cell mode. The list decides, for the same reason it decides
   * `focused` — the cursor is one pair of coordinates over the whole
   * grid, not a fact each row can hold a piece of.
   */
  focusedColumn?: number | null;
  /**
   * Fired when focus lands anywhere inside this row (the row itself, a
   * cell of it, or the chevron / jump button inside a cell). The list
   * uses it to keep the roving tabindex on whatever the user actually
   * reached — with the mouse, with Tab, or with a screen reader's own
   * navigation.
   *
   * `col` says which axis focus landed on: `null` for the row, a number
   * for that cell, and `undefined` for anything else inside the row (the
   * chevron, the jump button) — which must leave the cursor's mode
   * exactly as it was rather than drag it onto the cell that happens to
   * contain the control.
   */
  onRowFocus?: (id: string, col?: number | null) => void;
  /**
   * sk-285.2.13 — where this row sits among its siblings, for
   * `aria-setsize` / `aria-posinset`. Computed by the list over the WHOLE
   * row list (`lib/treeRowPositions.ts`), because a row cannot count
   * siblings it does not hold and the virtualizer keeps most of them out
   * of the DOM.
   *
   * REQUIRED, unlike `focused`. A missing position is not a neutral
   * default: it silently renders a row with no set at all, in a
   * flat virtualized tree where the reader has no other way to count.
   * Making it mandatory is what turns "every row carries the pair" from
   * a habit into something the compiler enforces at every call site.
   */
  position: TreeRowPosition;
  /**
   * sk-285.2.19 — this row's `aria-rowindex`: its 1-based place in the
   * WHOLE grid, counting the header row as 1 (so the first data row is
   * 2).
   *
   * REQUIRED for the same reason `position` is, and against the same
   * failure: under virtualization the mounted rows are a window, so a
   * row that does not state its index is announced at whatever position
   * it happens to occupy in the DOM — "row 3 of 500" for the row a
   * reader scrolled to at 300. The grid states the total
   * (`aria-rowcount`); this is the other half of that pair, and half of
   * it is worse than neither.
   */
  ariaRowIndex: number;
}

/** A component id with no name loaded yet — same shortening the board uses. */
function shortId(id: string): string {
  return id.slice(0, 8);
}

/**
 * What one VALUE cell prints, and the `title` (hover) text that carries
 * whatever the cell had to clip.
 *
 * Every column reads a field the Tasks list query already returns
 * (`IssueSummary`), so no switch here can ask for data the table cannot
 * fill — that invariant is the registry's, and this is where it is
 * spent.
 */
/**
 * sk-489 T016 (US-6, INV-5) — the label of the "Progress" cell of a tree row.
 *
 * Extracted from `renderCell` not for brevity: the branching here has three legs, and the
 * cell returns a node together with a hint, and a ternary in an object field
 * would hide the rule inside the markup. The rule is one for three surfaces
 * (the list card, this cell, the epic section branch), and it must
 * read as a whole in one place.
 */
function progressCellText(progress: EpicProgress, t: TFunction): string {
  // sk-540.3 — the chip's caption rule, but compact: the progress column is
  // 92px and clips with an ellipsis, so the "excluded: N" tail of a
  // counted pair would be cut off (review sk-540.12 / sk-540.13). The pair
  // stays bare here; the list card, the branch row and the ring carry the
  // tail. When nothing is counted the short form replaces the pair.
  const caption = progressCaption(progressNumbers(progress));
  if (caption.kind === 'allExcluded') {
    return t('details:closeOutcome.excludedShort', { count: caption.excluded });
  }
  return epicProgressChipText(
    caption.kind === 'done' ? { ...caption, excluded: null } : caption,
    t,
  );
}

function renderCell(
  column: TreeOptionalColumn,
  item: IssueTreeRowItem,
  ctx: {
    t: TFunction;
    componentNames: Map<string, string>;
    /** Whether the `blocked` column exists to carry the derived marker. */
    hasBlockedColumn: boolean;
  },
): { content: React.ReactNode; title?: string } {
  const { t, componentNames, hasBlockedColumn } = ctx;
  switch (column) {
    case 'id':
      return { content: <IssueIDBadge id={item.id} />, title: item.id };
    case 'status':
      // sk-421.2 — the row of an inaccessible task carries an empty status (INV-2).
      // Narrowing is done by CHECKING THE VALUE, not by a type cast:
      // `as IssueStatus` would be a lie about what lies on the wire — a status.
      // The caller does not call renderCell for stubs anyway (the cells
      // are short-circuited), so the empty-value branch is unreachable —
      // but it is expressed here, where the type requires it.
      if (item.status === '') return { content: null, title: undefined };
      return {
        content: (
          <Attribute
            kind="status"
            value={item.status}
            // The chip renders `blocked` INSTEAD of the wire status
            // (sk-31). With a dedicated blocked column on screen that
            // would hide the status behind a fact the next cell already
            // states, so the marker is left to the column that owns it —
            // the same "one chip for both switches" rule the board
            // follows in sk-285.2.5, resolved the other way round because
            // a table has somewhere else to put it.
            isBlocked={!hasBlockedColumn && item.isBlocked}
            pinned={item.pinned}
          />
        ),
        title: item.status,
      };
    case 'blocked':
      // Blocked-ness is DERIVED from the dependency graph, and whether it
      // outranks the row's own status is a rule with exactly one home:
      // `isDerivedBlocked` suppresses it on closed and standing rows (a
      // terminal status beats a stale blocker edge). This cell ASKS that
      // rule instead of restating it, so the two cannot drift apart.
      //
      // Asking BEFORE rendering rather than handing the chip an
      // `isBlocked` it may ignore is the whole fix: a suppressed marker
      // falls through to the ordinary status chip, so a closed-but-still-
      // linked row used to print `closed` in the BLOCKED column — the
      // status column's value, in the column that exists to answer a
      // different question. A column that owns blocked-ness prints
      // blocked-ness or nothing.
      if (item.status === '') return { content: null };
      return {
        content: isDerivedBlocked(item.status, item.isBlocked) ? (
          <Attribute kind="status" value={item.status} isBlocked />
        ) : null,
      };
    case 'priority':
      return { content: <Attribute kind="priority" value={item.priority} /> };
    case 'type':
      if (item.type === '') return { content: null };
      return { content: <Attribute kind="type" value={item.type} /> };
    case 'assignee': {
      const text = item.assignee || t('common:unassigned');
      return { content: text, title: text };
    }
    case 'components': {
      if (item.componentIds.length === 0) return { content: null };
      const names = item.componentIds
        .map((id) => componentNames.get(id) ?? shortId(id))
        .join(', ');
      return { content: names, title: names };
    }
    case 'labels': {
      if (item.labels.length === 0) return { content: null };
      const names = item.labels.join(', ');
      return { content: names, title: names };
    }
    case 'progress':
      return {
        // sk-407 (3) — `epicProgressPlain`, not the `epicProgress` this
        // asked for. That string carried a TRAILING `· `, a separator
        // that only makes sense inside a meta LINE whose segments are
        // joined end to end — which the list card had already stopped
        // being (it joins its own, and moved to the plain form for that
        // reason). A table cell joins nothing: the column printed
        // "(closed 1/10) ·" — a dangling glyph, and 9.14px of a 72px
        // track spent on it (Chromium, 1440, ru). This cell was the
        // separator variant's last reader; the key is gone with it, so
        // there is now ONE rollup string and no way to pick the wrong
        // one again.
        //
        // sk-489 T016 (US-6, INV-5) — the same label as on the list
        // card, and by the same rules: the numbers are taken from
        // `lib/progressNumbers.ts`, the label is chosen by `fromNewFields`, and
        // a zero denominator with live children prints a word instead of
        // the pair "0/0" (otherwise a row all of whose counted children have dropped out
        // looks like a row without children).
        content: item.epicProgress ? progressCellText(item.epicProgress, t) : null,
      };
    case 'updated':
      return {
        content: formatRelative(item.updatedAt),
        // sk-285.6.7 — the formatted stamp, not the raw ISO: the hover
        // is the "exact time" affordance the relative label owes the
        // reader, and it should read the same everywhere.
        title: formatTimestamp(item.updatedAt),
      };
    case 'created':
      return {
        content: formatRelative(item.createdAt),
        title: formatTimestamp(item.createdAt),
      };
  }
}

export function TaskTreeNode({
  row,
  selectedId,
  expanded,
  searchQuery,
  componentNames,
  columns,
  columnsMask,
  onSelect,
  onToggle,
  onJumpToFirst,
  focused = false,
  focusedColumn = null,
  onRowFocus,
  position,
  ariaRowIndex,
}: TaskTreeNodeProps) {
  const { t } = useTranslation('tasks');
  // `edgeType` is deliberately NOT destructured: nothing in the row
  // renders it since the connector slot was removed (see the file
  // header). It is still on `row` for whoever surfaces it next.
  const { item, depth, isReference, firstSeenAt, isContext, hasChildren } = row;
  const isOpen = isOpenRow(row, expanded);
  const selected = selectedId === item.id;
  // sk-285.2.8 — a context row is scaffolding, not a result: it never
  // passed the query, so painting a yellow hit inside its title would
  // claim a match the filter did not make. Highlighting stays on the
  // rows that actually matched.
  const titleHtml = highlightMatch(item.title, isContext ? '' : searchQuery);
  const isAssignedByMe = !!item.iAssigned;

  // sk-36 — hidden cross-project ancestor stub. The backend emits
  // `Title="<hidden>"` + IsReference=true + FirstSeenAt=nil; we
  // render a plain gray "cross-project parent (no access)" non-
  // clickable row.
  const isHiddenStub =
    isReference && firstSeenAt === null && item.title === '<hidden>';

  // sk-32 slice 7: epic-typed rows get a left-rail of their own. sk-36 V1
  // swapped the orange wash for magenta; sk-285.7 retired magenta and the
  // rail is `--violet`, the tone the handoff gives the epic (§3, §6).
  const isEpic = item.type === 'epic';

  // sk-285.2.11 — the accessible name of the TREEITEM. It moved up here
  // from the row-body `<button>` that used to carry it (that button is
  // now a plain container): a row inside which a button repeats the
  // same name is announced twice, and the inner button would also be a
  // second tab stop, which is exactly what the roving tabindex forbids.
  const rowLabel = isHiddenStub
    ? t('tree.hiddenParent')
    : isContext
      ? t('tree.contextParentAria', { id: item.id, title: item.title })
      : t('card.openIssue', { id: item.id, title: item.title });

  // `columns[0]` is 'title' by construction (`treeColumnOrder` re-asserts
  // it on every call) — the value columns are everything after it.
  const valueColumns = columns.slice(1) as readonly TreeOptionalColumn[];
  const hasBlockedColumn = hasTreeColumn(columnsMask, 'blocked');

  /**
   * sk-285.2.19 — the roving tabindex, resolved for one element of this
   * row. Exactly one element in the whole grid answers 0: the row while
   * the cursor is in row mode, that one cell while it is in cell mode.
   * Everything else is -1 — focusABLE (the keyboard and the list's focus
   * effect both move focus programmatically) but never a tab stop.
   */
  const rowIsTabStop = focused && focusedColumn === null;
  const cellTabIndex = (index: number): number =>
    focused && focusedColumn === index ? 0 : -1;

  /**
   * Which axis focus landed on, for `onRowFocus`. `null` = the row
   * itself, a number = that cell, `undefined` = something inside a cell
   * (the chevron, the jump button), which leaves the cursor's mode
   * alone.
   */
  const focusAxis = (target: HTMLElement, self: HTMLElement) => {
    if (target === self) return null;
    if (!target.classList.contains('task-tree-cell')) return undefined;
    const col = target.getAttribute('data-col');
    return col === null ? undefined : Number(col);
  };

  return (
    /* sk-285.2.13 — a LAYOUT box between the `role="treegrid"` and the
       `role="row"` inside it, and nothing more. Left with its
       implicit generic role it would break the grid's ownership of its
       own rows (ARIA lets a grid own only rows and rowgroups), which
       costs more than a missing name: a reader that no longer treats
       these as the tree's items stops announcing level, position and set
       size — the very facts this row exists to carry. `presentation`
       removes the box from the accessibility tree while leaving
       everything inside it exactly where it was. */
    <div className="task-tree-node" role="presentation">
      <div
        // sk-285.2.11 — the grid row IS this element, not the body
        // inside it: it is the box the chevron and the cells both live
        // in, so `aria-expanded` sits with the thing it describes and one
        // focus target covers the whole row.
        //
        // sk-285.2.19 — `row`, not `treeitem`: the row has columns now,
        // and a treeitem cannot own gridcells. Everything a treeitem
        // carried stays where it is — a row in a treegrid takes
        // `aria-level`, `aria-expanded`, `aria-selected`,
        // `aria-setsize` and `aria-posinset` too.
        role="row"
        aria-level={depth + 1}
        // sk-285.2.19 — where this row sits in the WHOLE grid, header
        // row included. Under virtualization the mounted rows are a
        // window, so DOM order states nothing; this and the grid's
        // `aria-rowcount` are the pair that does.
        aria-rowindex={ariaRowIndex}
        // sk-285.2.13 — required alongside `aria-level` because the tree
        // is flat (no nested `role="group"`) AND virtualized: the full set
        // of siblings is never in the DOM for a reader to count.
        aria-setsize={position.setSize}
        aria-posinset={position.posInSet}
        aria-selected={selected}
        // Only rows that actually own a subtree carry the state. A leaf
        // with `aria-expanded="false"` claims a subtree that does not
        // exist. Reference rows never own one (the cycle guard prunes
        // them); context rows do and are permanently open.
        aria-expanded={hasChildren && !isReference ? isOpen : undefined}
        aria-label={rowLabel}
        tabIndex={rowIsTabStop ? 0 : -1}
        // sk-551.4 — where focus returns when this issue's pane closes
        // (`Shell.tsx#restoreFocusAfterPane`).
        data-issue-id={item.id}
        onFocus={(e) =>
          onRowFocus?.(item.id, focusAxis(e.target as HTMLElement, e.currentTarget))
        }
        // sk-285.2.19 — the WHOLE row is the click target now. It used to
        // be the inner body box, which in a table would mean "the title
        // cell only": clicking a row's status or assignee would do
        // nothing, in a layout whose entire point is that those cells are
        // part of the same row. The hidden stub is the one row with no
        // issue to open, so it takes no handler at all.
        onClick={isHiddenStub ? undefined : () => onSelect(item)}
        className={[
          'task-tree-node-row',
          selected ? 'selected' : '',
          isAssignedByMe ? 'assigned-by-me' : '',
          isEpic ? 'is-epic' : '',
          item.status === 'standing' ? 'is-standing' : '',
          isReference ? 'is-reference' : '',
          isContext ? 'is-context' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        style={{ '--depth': depth } as React.CSSProperties}
      >
        {/* THE STRUCTURAL CELL. Everything that makes this a tree rather
         * than a list lives in here — and only in here. That is the
         * depth indent (the cell's own `padding-left`, keyed on the
         * `--depth` above) and the chevron, so a deeper row moves its
         * title and nothing else; the value cells to the right stay on
         * the columns the header names. */}
        <div
          className={[
            'task-tree-cell',
            'task-tree-cell--title',
            isHiddenStub ? 'task-tree-hidden-stub' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          // sk-285.2.19 — the structural cell is still a CELL: it is the
          // first stop of the cell-mode cursor, and a reader moving
          // along the row has to be able to land on the title like on
          // any other value. `data-col` is how the list's focus effect
          // addresses it; `aria-colindex` is 1-based and matches the
          // heading above it.
          role="gridcell"
          aria-colindex={1}
          data-col={0}
          tabIndex={cellTabIndex(0)}
        >
          {/* No connector slot here any more, and no indent guide behind
           * it: the cell opens straight on the chevron. The type of the
           * edge that links this row to its parent (`row.edgeType`) is
           * therefore not shown anywhere in the tree — see «THE EDGE
           * TYPE IS NO LONGER SHOWN» at the top of this file for what
           * that costs and where to put it back. */}
          {isExpandableRow(row) ? (
            <button
              type="button"
              className="task-tree-toggle"
              aria-label={isOpen ? t('tree.collapse') : t('tree.expand')}
              // sk-285.2.11 — a MOUSE affordance only. The tree's single
              // tab stop is the row; a chevron in the tab order would put
              // a second one inside every parent row. Keyboard users open
              // and close with →/← on the row itself, and the state they
              // read is the row's own `aria-expanded` (not repeated here —
              // one control, one announcement).
              tabIndex={-1}
              // Clicking must not drag DOM focus off the row into a button
              // the keyboard contract does not know about; the toggle
              // handler below moves the roving focus to this row instead.
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                // The row itself now opens the issue on click; a chevron
                // press must expand and NOT open.
                e.stopPropagation();
                onToggle(item.id);
              }}
            >
              {/* sk-285.7 T028 — 16, the inline step (FR-003 / §8). It
                  was 12, which is a TYPE step and on no icon scale. */}
              {isOpen ? (
                <IconChevronDown size={16} stroke={1.75} aria-hidden />
              ) : (
                <IconChevronRight size={16} stroke={1.75} aria-hidden />
              )}
            </button>
          ) : (
            /* sk-285.7 T028 — §6 gives the tree THREE glyphs, not two:
               «chevron `chevron-down`/`chevron-right`/`point`». A leaf
               row used to render an empty box of the chevron's width,
               which kept the alignment and said nothing; the dot says
               "this row has nothing under it", which is the answer a
               reader is looking for when they scan the gutter of a
               tree. It stays a `<span>` and not a button — there is
               nothing to toggle — and stays `aria-hidden`, because the
               row's own `aria-expanded` (absent on a leaf) is where a
               screen reader reads the same fact. */
            <span className="task-tree-toggle-placeholder" aria-hidden>
              <IconPoint size={16} stroke={1.75} />
            </span>
          )}
          {/* One line, clipped with an ellipsis; the whole title on
           * hover. That is the price of a fixed row height, and it is
           * paid here rather than by letting one long title push a row
           * to twice the height of its neighbours. */}
          <span
            className="task-tree-title"
            title={
              isHiddenStub
                ? t('tree.hiddenParent')
                : isContext
                  ? `${item.title} — ${t('tree.contextParent')}`
                  : item.title
            }
          >
            {isAssignedByMe ? (
              <span
                className="task-card-star"
                title={t('card.delegatedStarTitle')}
              >
                {/* 16, the inline-in-text step — the same one the card's
                    star took in T026. It was 11, a size on no scale. */}
                <IconStarFilled size={16} aria-hidden />
                <span className="sr-only">{t('card.delegatedByMe')}</span>
              </span>
            ) : null}
            <span className="task-card-title-text">
              {isHiddenStub ? (
                '<hidden>'
              ) : (
                <SearchHighlight html={titleHtml} />
              )}
            </span>
            {isReference && firstSeenAt ? (
              <button
                type="button"
                className="task-tree-jump-ref"
                aria-label={t('tree.jumpAria', { id: firstSeenAt })}
                // sk-285.2.11 — mouse affordance, like the chevron: a
                // tab stop here would be a second one inside a
                // row, and the row it points at is reachable from
                // the keyboard anyway (arrows, or typeahead on its
                // title) — this button is a shortcut, not the only way
                // there. Focus stays put on click so the roving stop
                // does not land on a button that the jump is about to
                // scroll out of the DOM.
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.stopPropagation();
                  onJumpToFirst?.(firstSeenAt);
                }}
              >
                {t('tree.jumpLabel', { id: firstSeenAt })}
              </button>
            ) : null}
          </span>
        </div>
        {valueColumns.map((column, i) => {
          // +1 for the pinned title cell, which is column 0 / colindex 1.
          const colIndex = i + 1;
          // The stub has no readable issue behind it, so its value cells
          // stay empty — but they are still rendered, or the columns to
          // its right would slide left and the table would lose its
          // alignment on exactly the rows that already read as odd.
          const cell = isHiddenStub
            ? { content: null, title: undefined }
            : renderCell(column, item, {
                t,
                componentNames,
                hasBlockedColumn,
              });
          return (
            <div
              key={column}
              className={`task-tree-cell task-tree-cell--${column}`}
              title={cell.title}
              role="gridcell"
              aria-colindex={colIndex + 1}
              data-col={colIndex}
              tabIndex={cellTabIndex(colIndex)}
            >
              {cell.content}
            </div>
          );
        })}
      </div>
    </div>
  );
}
