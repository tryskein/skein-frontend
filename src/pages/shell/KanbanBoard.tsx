import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  IconFilter,
  IconFilterOff,
  IconLayoutSidebarLeftCollapse,
  IconLock,
  IconStarFilled,
} from '@tabler/icons-react';
import { Attribute, priorityFill, statusFill } from '../../components/Attribute';
import { IssueIDBadge } from '../../components/IssueIDBadge';
import { SkeinTooltip } from '../../components/SkeinTooltip';
import { formatRelative, formatTimestamp } from '../../components/format';
import type { IssueStatus, IssueSummary, StatusFilter } from '../../api/issues';
import {
  KANBAN_CLOSED_WINDOW_DAYS,
  KANBAN_READ_ONLY_AXES,
  buildKanbanColumns,
  foldFilterFor,
  isCardDraggable,
  kanbanCardKey,
  otherAxisValues,
  type KanbanAxis,
  type KanbanColumn,
} from '../../lib/kanbanBoard';
import {
  KANBAN_DEFAULT_CARD_FIELDS,
  hasCardField,
  visibleCardFieldsMask,
  type KanbanCardField,
} from '../../lib/kanbanCardFields';
import {
  applyProjectFocus,
  projectFocusState,
  EMPTY_PROJECT_FOCUS,
  type ProjectFocus,
} from '../../lib/kanbanProjectFocus';
import { useKanbanMove } from '../../lib/useKanbanMove';
import {
  useKanbanFoldMemory,
  type KanbanFoldMemory,
} from '../../lib/useKanbanFoldMemory';

/**
 * sk-285.2.3 / sk-285.2.4 — Kanban body of the Tasks column.
 *
 * The third view mode next to Cards and Tree. NOT a separate page: it
 * sits in the same column, reads the same `useTasks` result and the same
 * filter set, and hands selection to the same Details panel. Switching
 * view therefore never changes WHICH tasks you are looking at, only how
 * they are laid out — which is the whole promise of a board being a
 * projection rather than a second surface.
 *
 * Anatomy:
 *
 *   ┌ Open 12 ─┐┌ In progress 3 ─┐┌ Deferred 1 ─┐┌ Done 4 ─┐┌ 🔒 Standing 2 ┐
 *   │ [card]   ││ [card]         ││ [card]      ││ [card]  ││ [card]        │
 *   │ [card]   ││                ││             ││         ││               │
 *   └──────────┘└────────────────┘└─────────────┘└─────────┘└───────────────┘
 *   ← horizontally scrollable; each column scrolls vertically ─────────────→
 *
 * The board does not cap the column count and does not shrink columns to
 * fit: it pans, exactly as the shell does below its own min-width.
 * That is what lets the wider axes (type, assignee, label) work without
 * re-doing the layout.
 *
 * ── What a card prints is a choice too (sk-285.2.5) ───────────────
 *
 * `cardFields` is the user's «display properties» set — a flat list of
 * switches, Linear-style. The board resolves it against the axis ONCE
 * (`visibleCardFieldsMask`) and hands every card the packed result, so
 * the rule "a card never repeats its own column" lives in one place
 * instead of in each chip's render condition.
 *
 * ── The axis is a choice (sk-285.2.4) ─────────────────────────────
 *
 * `axis` says which field the columns project — status, priority, type,
 * assignee, project, component or label. The board itself is written
 * against the axis, not against status: labels, drop rules and the write
 * are all derived, so nothing here special-cases "the status board".
 *
 * On the two MULTI-VALUE axes (component, label) one issue can occupy
 * several columns at once. The duplicate is deliberate (research §4.2)
 * but it must not be silent, or three cards read as three tasks: every
 * copy names the other columns it also sits in ("also in: backend"), and
 * a drag REPLACES the value of the column it started from, leaving the
 * issue's other components / labels alone.
 *
 * ── Focused on a few projects (sk-285.2.6) ────────────────────────
 *
 * `projectFocus` narrows the cross-project board to the handful of
 * projects the user actually works in — the stage's stated reason for
 * existing. It is applied HERE, over the rows the shared query already
 * returned, so the list and the board keep one filter set between them.
 *
 * Two rules make it safe to leave switched on:
 *
 *   - it announces itself. The bar above the strip names the focused
 *     projects and how many rows they cost, exactly as the filter
 *     panel's badge announces an active filter;
 *   - it yields to the Projects column. Open one project and the focus
 *     PAUSES rather than intersecting — see `lib/kanbanProjectFocus.ts`.
 *
 * ── Drag = write the axis field ───────────────────────────────────
 *
 * Dropping a card into a column writes that column's value through the
 * ordinary endpoint for that field (see `useKanbanMove`). Three rules
 * are painted BEFORE the gesture rather than enforced after it:
 *
 *   - `standing` is locked in both directions on the status axis (the
 *     backend refuses those transitions — see `kanbanBoard.ts`), so its
 *     cards carry no drag listeners and its droppable is disabled;
 *   - the whole `project` axis is read-only, for the same
 *     paint-it-first reason: Skein has no move-between-projects;
 *   - a column blanked by the shared status filter says so, and offers
 *     the one click that un-blanks it.
 *
 * ── Keyboard ──────────────────────────────────────────────────────
 *
 * Cards are real `<button>`s: Tab reaches them, Enter/Space opens the
 * task in Details. dnd-kit's `KeyboardSensor` is deliberately NOT
 * registered — it binds Enter/Space on the draggable to "lift", which
 * would take the card's primary action away from keyboard users and
 * give them a worse one. Every axis field remains editable from the
 * keyboard through the Details panel, so dragging is an accelerator,
 * never the only path.
 */

export interface KanbanBoardProps {
  items: readonly IssueSummary[];
  /** Which issue field the columns project. Persisted in `useTasksUiState`. */
  axis: KanbanAxis;
  /**
   * The EFFECTIVE status filter (lens/search overlay applied), same
   * value the filter dropdown displays. Drives which columns are
   * blanked — see `isColumnHiddenByFilter`.
   */
  statusFilter: StatusFilter;
  /**
   * Setter behind the folded column's sliver ("show every status") and,
   * sk-551.32, behind the fold that puts the filter back.
   */
  onStatusFilterChange: (v: StatusFilter) => void;
  /**
   * sk-551.32 — the fold memory, from the owner of the board's place
   * (`TasksBody`), so it survives the board being swapped for a loading
   * state. Omitted → the board keeps its own (see `useKanbanFoldMemory`).
   */
  foldMemory?: KanbanFoldMemory;
  /**
   * Component uuid → name, for the component axis. Already fetched by
   * the Tasks column for the cards; empty on the cross-project surface,
   * where a column falls back to a short id rather than going missing.
   */
  componentNames?: Map<string, string>;
  /** Project uuid → handle, for the project axis. Same story. */
  projectHandles?: Map<string, string>;
  /**
   * sk-285.2.5 — which properties the cards print («display
   * properties»). Optional, defaulting to the set the board shipped
   * with, so a caller that has not been taught about the setting still
   * renders the board it always rendered.
   */
  cardFields?: ReadonlySet<KanbanCardField>;
  /**
   * sk-285.2.6 — the projects this board is focused on (uuids). Empty =
   * every visible project, i.e. the board as it was before the setting
   * existed.
   *
   * The board applies the focus itself rather than being handed
   * pre-filtered rows, because it also has to SAY that it is filtered
   * and by how much — a board that is merely shorter than the list
   * behind it is exactly the "an incomplete board, without knowing why" the
   * setting must not produce.
   */
  projectFocus?: ProjectFocus;
  /**
   * sk-285.2.6 — the handle of the single project open in the Projects
   * column, or null on the cross-project surface.
   *
   * Non-null PAUSES the focus (see `lib/kanbanProjectFocus.ts`): the
   * left column's explicit choice governs, the saved set waits, and the
   * board prints which of the two is in force so the user is never left
   * to guess why a focus they can see switched on is not narrowing
   * anything.
   */
  projectFocusPausedBy?: string | null;
  /**
   * sk-674.18 T052 — the name of the space that is the selected place
   * when the saved focus holds none of its projects, or null. Non-null
   * PAUSES the focus like an open project does, and the board says that
   * the space has no focused project (`lib/kanbanProjectFocus.ts`,
   * «On the place space»). With a focused project in the space the caller
   * passes the intersection as `projectFocus` and leaves this null.
   */
  projectFocusPausedBySpace?: string | null;
  /** Reset to «all projects». Omitted → the reset affordance is not drawn. */
  onClearProjectFocus?: () => void;
  /** Leave the single project, which un-pauses the focus. */
  onShowAllProjects?: () => void;
  selectedIssueId: string | null;
  onSelect: (item: IssueSummary) => void;
  /**
   * More pages exist behind the loaded ones. The board shows an explicit
   * "load more" button rather than the Cards view's IntersectionObserver:
   * a board has no single bottom edge to observe, and an always-visible
   * sentinel would page through a whole project unattended.
   */
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
}

interface LabelMaps {
  componentNames?: Map<string, string>;
  projectHandles?: Map<string, string>;
}

/**
 * The column head's text for one axis value.
 *
 * Wire vocabularies are NOT translated (`type`, labels, usernames) —
 * they are the same strings the filters, the MCP tools and the API use,
 * and translating them would make the column disagree with the filter
 * that produced it. Only the buckets that exist in the UI alone (the
 * three "none" buckets) are copy.
 */
function columnLabel(
  axis: KanbanAxis,
  value: string | null,
  t: TFunction,
  maps: LabelMaps,
): string {
  switch (axis) {
    case 'status':
      // Reuse the filter dropdown's status vocabulary so the column head
      // and the filter that hides it are worded identically.
      return t(`filters:status.${value}`);
    case 'priority':
      return `P${value}`;
    case 'type':
      return String(value);
    case 'assignee':
      return value ?? t('common:unassigned');
    case 'project':
      return maps.projectHandles?.get(value ?? '') ?? shortId(value);
    case 'component':
      return value === null
        ? t('kanban.noComponent')
        : maps.componentNames?.get(value) ?? shortId(value);
    case 'label':
      return value ?? t('kanban.noLabel');
  }
}

/**
 * A uuid we could not resolve to a name — show enough to tell two apart.
 *
 * The TAIL, not the head: Skein's ids are time-ordered (uuidv7), so a
 * project's components, created minutes apart, share their first
 * characters — twelve columns all reading `01a02456` are worse than no
 * label at all. The tail is the random part.
 */
function shortId(value: string | null): string {
  return value ? `…${value.slice(-8)}` : '—';
}

export function KanbanBoard({
  items,
  axis,
  statusFilter,
  onStatusFilterChange,
  foldMemory: foldMemoryProp,
  componentNames,
  projectHandles,
  cardFields,
  projectFocus = EMPTY_PROJECT_FOCUS,
  projectFocusPausedBy = null,
  projectFocusPausedBySpace = null,
  onClearProjectFocus,
  onShowAllProjects,
  selectedIssueId,
  onSelect,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
}: KanbanBoardProps) {
  const { t } = useTranslation('tasks');
  const move = useKanbanMove();
  const [active, setActive] = useState<{ item: IssueSummary; from: string | null } | null>(
    null,
  );

  // sk-551.32 — the fold memory. The owner's when given (it outlives this
  // board's unmount on a loading state, see `useKanbanFoldMemory`); this
  // board's own otherwise.
  const ownFoldMemory = useKanbanFoldMemory(statusFilter, onStatusFilterChange);
  const foldMemory = foldMemoryProp ?? ownFoldMemory;

  const maps = useMemo<LabelMaps>(
    () => ({ componentNames, projectHandles }),
    [componentNames, projectHandles],
  );

  /**
   * sk-285.2.5 — the user's field set, minus the one the axis states,
   * packed into a bitmask.
   *
   * A NUMBER and not the `Set` itself, because it is handed to a
   * `memo()`d card: a number compares by value, a freshly-derived Set
   * would be a new reference on every board tick and would quietly turn
   * that memo into dead weight (see `KanbanCard`'s prop contract).
   */
  const fields = useMemo(
    () => visibleCardFieldsMask(cardFields ?? KANBAN_DEFAULT_CARD_FIELDS, axis),
    [cardFields, axis],
  );

  /**
   * sk-285.2.6 — the focus, resolved once for the whole board: which
   * state it is in, which rows survive it, and how many it took.
   */
  const focusState = projectFocusState(
    projectFocus,
    projectFocusPausedBy ?? projectFocusPausedBySpace,
  );
  const focused = useMemo(
    () => applyProjectFocus(items, projectFocus, focusState),
    [items, projectFocus, focusState],
  );
  const focusLabels = useMemo(
    () =>
      [...projectFocus]
        .map((id) => projectHandles?.get(id) ?? shortId(id))
        .sort((a, b) => a.localeCompare(b))
        .join(', '),
    [projectFocus, projectHandles],
  );

  const columns = useMemo<KanbanColumn[]>(
    () =>
      buildKanbanColumns({
        axis,
        items: focused.items,
        statusFilter,
        knownComponentIds:
          axis === 'component' && componentNames ? [...componentNames.keys()] : undefined,
        // sk-285.2.6 — on the project axis the focus IS the column set:
        // a focused project with nothing loaded still gets its (empty)
        // column, so the board shows the shape the user asked for
        // rather than silently dropping half of it.
        knownProjectIds:
          axis === 'project' && focusState === 'active' ? [...projectFocus] : undefined,
        // Dynamic columns sort by what the user READS, not by the uuid
        // behind it — otherwise the component axis comes out in uuid
        // order, which is indistinguishable from no order at all.
        resolveLabel: (v) => columnLabel(axis, v, t, maps),
      }),
    [axis, focused.items, statusFilter, componentNames, maps, t, focusState, projectFocus],
  );

  /**
   * dnd id → what that draggable actually is.
   *
   * A card's id carries its COLUMN as well as its issue (see
   * `kanbanCardKey`), because on a multi-value axis the same issue is
   * draggable from several columns and the drop needs to know which of
   * the issue's values it is replacing.
   */
  const cards = useMemo(() => {
    const out = new Map<string, { item: IssueSummary; from: string | null }>();
    for (const col of columns) {
      for (const item of col.items) {
        out.set(kanbanCardKey(col.key, item.id), { item, from: col.value });
      }
    }
    return out;
  }, [columns]);

  const columnsByKey = useMemo(() => {
    const out = new Map<string, KanbanColumn>();
    for (const col of columns) out.set(col.key, col);
    return out;
  }, [columns]);

  // Distance activation: without it a plain click on a card would be
  // swallowed as a micro-drag and the task would never open.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const handleDragStart = useCallback(
    (e: DragStartEvent) => {
      setActive(cards.get(String(e.active.id)) ?? null);
    },
    [cards],
  );

  const handleDragEnd = useCallback(
    (e: DragEndEvent) => {
      const picked = active;
      setActive(null);
      if (!picked || !e.over) return;
      const target = columnsByKey.get(String(e.over.id));
      // Belt and braces: a locked column's droppable is disabled, so
      // `over` cannot be it — but the drop handler is the last place
      // where a bad write can still be stopped, so it re-checks rather
      // than trusting the paint.
      if (!target || !target.droppable) return;
      if (!isCardDraggable(axis, picked.item)) return;
      if (target.value === picked.from) return;
      move.mutate({ item: picked.item, axis, from: picked.from, to: target.value });
    },
    [active, axis, columnsByKey, move],
  );

  const handleDragCancel = useCallback(() => setActive(null), []);

  const announceColumn = useCallback(
    (id: string | number | undefined) => {
      const col = id === undefined ? undefined : columnsByKey.get(String(id));
      return col ? columnLabel(axis, col.value, t, maps) : '';
    },
    [axis, columnsByKey, maps, t],
  );

  return (
    <div className="col-body tasks-body kanban-body">
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
        accessibility={{
          // dnd-kit's defaults are hardcoded English AND advertise the
          // keyboard lift we deliberately do not register. Replace both.
          screenReaderInstructions: { draggable: t('kanban.dragInstructions') },
          announcements: {
            onDragStart: ({ active: a }) =>
              t('kanban.announceStart', {
                id: cards.get(String(a.id))?.item.id ?? String(a.id),
              }),
            onDragOver: ({ active: a, over }) =>
              over
                ? t('kanban.announceOver', {
                    id: cards.get(String(a.id))?.item.id ?? String(a.id),
                    column: announceColumn(over.id),
                  })
                : undefined,
            onDragEnd: ({ active: a, over }) =>
              over
                ? t('kanban.announceDrop', {
                    id: cards.get(String(a.id))?.item.id ?? String(a.id),
                    column: announceColumn(over.id),
                  })
                : t('kanban.announceCancel', {
                    id: cards.get(String(a.id))?.item.id ?? String(a.id),
                  }),
            onDragCancel: ({ active: a }) =>
              t('kanban.announceCancel', {
                id: cards.get(String(a.id))?.item.id ?? String(a.id),
              }),
          },
        }}
      >
        {/* sk-285.2.6 — the focus states itself. Same rule as the
            active-filter badge on the filter panel: a narrowed board
            must never be able to pass for a small one. It sits ABOVE the
            strip, outside the horizontal scroller, so it cannot pan out
            of sight along with the columns it is explaining. */}
        {focusState === 'active' ? (
          <div className="kanban-focus-bar" role="status">
            <span className="kanban-focus-icon" aria-hidden>
              <IconFilter size={16} stroke={1.75} />
            </span>
            <span className="kanban-focus-text">
              {t('kanban.focusActive', {
                count: projectFocus.size,
                projects: focusLabels,
              })}
              {focused.hidden > 0 ? (
                <span className="kanban-focus-hidden">
                  {' '}
                  {t('kanban.focusHidden', { count: focused.hidden })}
                </span>
              ) : null}
            </span>
            {onClearProjectFocus ? (
              <button
                type="button"
                className="kanban-focus-action"
                onClick={onClearProjectFocus}
              >
                {t('kanban.focusReset')}
              </button>
            ) : null}
          </div>
        ) : focusState === 'paused' ? (
          <div className="kanban-focus-bar is-paused" role="status">
            <span className="kanban-focus-icon" aria-hidden>
              <IconFilterOff size={16} stroke={1.75} />
            </span>
            <span className="kanban-focus-text">
              {projectFocusPausedBy === null && projectFocusPausedBySpace !== null
                ? t('kanban.focusPausedSpace', {
                    count: projectFocus.size,
                    space: projectFocusPausedBySpace,
                  })
                : t('kanban.focusPaused', {
                    count: projectFocus.size,
                    project: projectFocusPausedBy,
                  })}
            </span>
            {onShowAllProjects ? (
              <button
                type="button"
                className="kanban-focus-action"
                onClick={onShowAllProjects}
              >
                {t('kanban.focusResume')}
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="kanban-scroller">
          {columns.map((col) => (
            <KanbanColumnView
              key={col.key}
              column={col}
              label={columnLabel(axis, col.value, t, maps)}
              maps={maps}
              fields={fields}
              exactCounts={!hasNextPage}
              dragging={active !== null}
              selectedIssueId={selectedIssueId}
              onSelect={onSelect}
              onUnfold={foldMemory.unfold}
              foldTo={
                col.axis === 'status'
                  ? foldFilterFor(
                      col.value as IssueStatus,
                      statusFilter,
                      foldMemory.restoreTo,
                    )
                  : null
              }
              onFold={foldMemory.fold}
              focusAfterToggle={foldMemory.focusAfterToggle === col.key}
              onToggleFocused={foldMemory.toggleFocused}
            />
          ))}
          {columns.length === 0 ? (
            <div className="kanban-col-note kanban-no-columns">
              {t('kanban.noColumns')}
            </div>
          ) : null}
        </div>
        <DragOverlay dropAnimation={null}>
          {active ? (
            <KanbanCard
              item={active.item}
              dragId=""
              selected={false}
              draggable={false}
              fields={fields}
              componentNames={componentNames}
              alsoIn=""
              overlay
              onSelect={onSelect}
            />
          ) : null}
        </DragOverlay>
      </DndContext>
      {hasNextPage ? (
        <div className="kanban-footer">
          <button
            type="button"
            className="kanban-load-more"
            onClick={fetchNextPage}
            disabled={isFetchingNextPage}
          >
            {isFetchingNextPage ? t('common:loadingMore') : t('kanban.loadMore')}
          </button>
        </div>
      ) : null}
    </div>
  );
}

interface KanbanColumnViewProps {
  column: KanbanColumn;
  label: string;
  maps: LabelMaps;
  /** sk-285.2.5 — packed visible-field set for every card in this column. */
  fields: number;
  /**
   * False while more pages are unloaded: the head then prints `N+`,
   * the same honesty the column header chip uses for search results —
   * "N on the board so far", not "N in this status".
   */
  exactCounts: boolean;
  dragging: boolean;
  selectedIssueId: string | null;
  onSelect: (item: IssueSummary) => void;
  /**
   * The sliver's action: widen the shared status filter to `'all'`.
   * `focusColumn` is passed for a keyboard press only (see `KanbanFoldMemory`).
   */
  onUnfold: (focusColumn?: string) => void;
  /**
   * sk-551.32 — the filter that folds this column back into a sliver, or
   * `null` when the head offers no fold (see `foldFilterFor`).
   */
  foldTo: StatusFilter | null;
  /** `focusColumn` is passed for a keyboard fold only (see `KanbanFoldMemory`). */
  onFold: (to: StatusFilter, focusColumn?: string) => void;
  /**
   * sk-551.32 — this column was folded or unfolded from the keyboard: the
   * control that replaced the pressed one (sliver, or fold button) takes
   * focus as soon as it is drawn.
   */
  focusAfterToggle: boolean;
  onToggleFocused: () => void;
}

/**
 * sk-285.7 T029 — the token a column head wears, handoff §6 «Board view»:
 * "header 36px with an 8px dot of the status colour, a 2px bottom border of the same
 * colour". Returned as a token NAME (`--ok`), the same shape
 * {@link statusFill} / {@link priorityFill} already speak, so the head and
 * the chips inside it cannot drift onto two different greens.
 *
 * Colour is spent on STATUS and PRIORITY only — the human's hybrid call on
 * sk-285.7.3: colour encodes what peripheral vision reads (status,
 * priority), form encodes the rest (type is an outline, not a fill). The
 * remaining axes — type, assignee, project, component, label — group by
 * something this language gives no hue, so their heads take the neutral
 * control outline rather than inventing one. Same for the `null` bucket on
 * any axis: "no value" is not a value with a colour.
 *
 * `--line-2` and not `--line` for that neutral: the dot and the 2px rule
 * are the head's only non-text marks, so they answer to §7's 3:1 floor for
 * UI, which is exactly the step `--line-2` exists to hold (§3). The
 * measurement lives in `KanbanBoardLanguage.test.ts`, recomputed from the
 * sheet rather than asserted from this comment.
 */
export function kanbanColumnAccent(
  axis: KanbanAxis,
  value: string | null,
): string {
  if (value === null) return '--line-2';
  if (axis === 'status') return statusFill(value as IssueStatus);
  if (axis === 'priority') {
    const n = Number(value);
    return Number.isFinite(n) ? priorityFill(n) : '--line-2';
  }
  return '--line-2';
}

function KanbanColumnView({
  column,
  label,
  maps,
  fields,
  exactCounts,
  dragging,
  selectedIssueId,
  onSelect,
  onUnfold,
  foldTo,
  onFold,
  focusAfterToggle,
  onToggleFocused,
}: KanbanColumnViewProps) {
  const { t } = useTranslation('tasks');
  const { setNodeRef, isOver } = useDroppable({
    id: column.key,
    disabled: !column.droppable || column.hiddenByFilter,
  });
  const count = column.items.length;
  const countText = exactCounts ? String(count) : `${count}+`;
  // The lock says something different per axis, because the reason
  // differs: a standing status is a workflow rule, a read-only project
  // axis is a missing operation.
  const lockedTooltip = KANBAN_READ_ONLY_AXES.has(column.axis)
    ? t('kanban.readOnlyAxisTooltip')
    : t('kanban.lockedTooltip');
  // The head's dot and its 2px rule are one colour, declared once as a
  // custom property so the stylesheet keeps both marks in step. Read by
  // `.kanban-col-dot` and `.kanban-col-header`.
  const accentStyle = {
    '--kanban-col-accent': `var(${kanbanColumnAccent(column.axis, column.value)})`,
  } as CSSProperties;

  // sk-551.32 — folding and unfolding each remove the very button that had
  // focus. Pressed from the keyboard, the control that replaces it on the
  // same column — the sliver after a fold, the fold button after an
  // unfold — takes focus instead, so Enter, Enter goes there and back.
  // Found through the section rather than by a ref on the button:
  // `SkeinTooltip` puts its own ref on the element it wraps.
  const sectionRef = useRef<HTMLElement | null>(null);
  const setSectionRef = useCallback(
    (node: HTMLElement | null) => {
      sectionRef.current = node;
      if (column.hiddenByFilter) setNodeRef(node);
    },
    [column.hiddenByFilter, setNodeRef],
  );
  const hasFold = foldTo !== null;
  useEffect(() => {
    if (!focusAfterToggle) return;
    const target = sectionRef.current?.querySelector<HTMLElement>(
      column.hiddenByFilter ? '.kanban-col-sliver' : '.kanban-col-fold',
    );
    if (!target) return;
    target.focus();
    onToggleFocused();
  }, [focusAfterToggle, column.hiddenByFilter, hasFold, onToggleFocused]);

  // sk-551.3 — a column the status filter hides holds nothing, yet it took
  // a full 232px of a board that does not fit a laptop, at the expense of
  // the reading pane beside it. It folds into a sliver instead — the same
  // idiom and width as the folded Queues / Projects columns — that names
  // the column and, pressed, does what «Show every status» did: widens
  // the SHARED status filter, so the column (and every other filtered
  // one) comes back at full width. The freed pixels go to the pane.
  //
  // Still a droppable `section` with `setNodeRef`: dnd-kit keeps a
  // registered node per column key, disabled here, exactly as before.
  if (column.hiddenByFilter) {
    const showAll = t('kanban.showAllStatusesFor', { name: label });
    return (
      <section
        className="kanban-col is-hidden-by-filter is-collapsed"
        style={accentStyle}
        aria-label={t('kanban.columnAriaFiltered', { name: label })}
        ref={setSectionRef}
      >
        {/* sk-551.32 — `SkeinTooltip`, not a native `title`: the house
            rule is a tooltip that opens at once, and `title` opens on the
            browser's own delay. */}
        <SkeinTooltip content={showAll} position="right">
          <button
            type="button"
            className="kanban-col-sliver"
            // `detail` is 0 for a click synthesised from Enter / Space (and
            // by assistive tech), ≥ 1 for a real pointer press: only the
            // former moves focus on to the column's fold button.
            onClick={(e) => onUnfold(e.detail === 0 ? column.key : undefined)}
            aria-label={showAll}
          >
            <span className="kanban-col-dot" aria-hidden />
            <span className="kanban-col-sliver-label">{label}</span>
          </button>
        </SkeinTooltip>
      </section>
    );
  }

  return (
    <section
      className={[
        'kanban-col',
        column.droppable ? '' : 'is-locked',
        isOver ? 'is-over' : '',
        dragging && !column.droppable ? 'is-drop-blocked' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={accentStyle}
      ref={setSectionRef}
      aria-label={
        column.droppable
          ? t('kanban.columnAria', { name: label, count })
          : t('kanban.columnAriaLocked', { name: label, count })
      }
    >
      <header className="kanban-col-header">
        {/* §6's 8px dot. Decorative by construction: it repeats, in colour,
            the value the title beside it already spells out — so it carries
            no information a screen reader would lose. */}
        <span className="kanban-col-dot" aria-hidden />
        <span className="kanban-col-title" title={label}>
          {label}
        </span>
        <span
          className={
            count === 0 ? 'col-header-count col-count-empty' : 'col-header-count'
          }
        >
          {countText}
        </span>
        {column.droppable ? null : (
          <SkeinTooltip content={lockedTooltip} position="bottom">
            <span className="kanban-col-lock" role="img" aria-label={lockedTooltip}>
              {/* sk-285.7.2.88 — U+1F512 LOCK is an emoji: it resolves
                  to the platform's colour-emoji face, arrives in that
                  face's own palette rather than the header's ink, has
                  no stroke to set and no place on §8's 16/20/24 scale.
                  Measured live in this container it drew 7.45×12 — the
                  missing-glyph box, not a padlock. §8's name list has
                  no `lock` because no artboard draws a locked column;
                  §9 is the clause that governs that case, and it says
                  to apply the system to what the design does not
                  cover. So: Tabler, 1.75, 16 — the like-for-like
                  drawing of the character, nothing invented but the
                  medium. `role="img"` + `aria-label` stay on the span,
                  which is what names this mark for a screen reader. */}
              <IconLock size={16} stroke={1.75} />
            </span>
          </SkeinTooltip>
        )}
        {/* sk-551.32 — the way back to the sliver this column was unfolded
            from: the inverse of the sliver's click, written to the same
            shared filter. Same idiom (and icon) as the fold on the shell's
            own Queues / Projects / Tasks heads. */}
        {foldTo === null ? null : (
          <SkeinTooltip content={t('kanban.foldColumn', { name: label })} position="bottom">
            <button
              type="button"
              className="kanban-col-fold"
              // Keyboard press only (see the sliver): focus moves on to the
              // sliver that replaces this button.
              onClick={(e) => onFold(foldTo, e.detail === 0 ? column.key : undefined)}
              aria-label={t('kanban.foldColumn', { name: label })}
            >
              <IconLayoutSidebarLeftCollapse size={16} stroke={1.75} aria-hidden />
            </button>
          </SkeinTooltip>
        )}
      </header>
      <div className="kanban-col-body" ref={setNodeRef}>
        {column.items.map((item) => (
          <KanbanCard
            key={item.id}
            dragId={kanbanCardKey(column.key, item.id)}
            item={item}
            selected={selectedIssueId === item.id}
            draggable={column.droppable && isCardDraggable(column.axis, item)}
            fields={fields}
            componentNames={maps.componentNames}
            alsoIn={otherAxisValues(item, column.axis, column.value)
              .map((v) => columnLabel(column.axis, v, t, maps))
              .join(', ')}
            onSelect={onSelect}
          />
        ))}
        {count === 0 ? (
          <div className="kanban-col-empty">{t('kanban.columnEmpty')}</div>
        ) : null}
        {column.hiddenByWindow > 0 ? (
          <div className="kanban-col-note kanban-col-window-note">
            {t('kanban.closedWindowNote', {
              count: column.hiddenByWindow,
              days: KANBAN_CLOSED_WINDOW_DAYS,
            })}
          </div>
        ) : null}
      </div>
    </section>
  );
}

interface KanbanCardProps {
  item: IssueSummary;
  /** dnd draggable id — column + issue, see `kanbanCardKey`. */
  dragId: string;
  selected: boolean;
  /** False in a locked column and for the drag ghost. */
  draggable: boolean;
  /**
   * sk-285.2.5 — the properties this card may print, packed by
   * `visibleCardFieldsMask` (the user's «display properties» minus the
   * one the current axis already states).
   *
   * A NUMBER, not a `Set`: see the `memo()` contract below.
   */
  fields: number;
  /**
   * Component uuid → name, for the `components` property. Optional and
   * stable (one `useMemo` in the Tasks column), so it does not break the
   * memo; an unresolved id degrades to its short tail rather than to a
   * blank line.
   */
  componentNames?: Map<string, string>;
  /**
   * On a multi-value axis: the OTHER columns this same issue sits in,
   * already joined for display. Empty everywhere else. Rendered as
   * "also in: …" so a card appearing three times never reads as three
   * tasks.
   *
   * A STRING rather than an array on purpose: the column builds this per
   * render, and a fresh array would defeat the `memo()` below on every
   * board tick.
   */
  alsoIn: string;
  /** Rendered inside `<DragOverlay>` — no drag listeners, no dimming. */
  overlay?: boolean;
  onSelect: (item: IssueSummary) => void;
}

/**
 * One card on the board.
 *
 * Built out of the SAME `<Attribute>` chips the list rows use (type,
 * priority, and the derived `blocked` marker) plus `<IssueIDBadge>` —
 * there is no board-specific badge vocabulary, on purpose: two badge
 * systems in one product is the drift `<Attribute>` was created to end.
 *
 * WHICH attributes it prints is the user's call (sk-285.2.5 — «display
 * properties»), narrowed by one standing rule: a card never repeats what
 * its own column already says, so the axis suppresses exactly one field
 * (status on the status axis, assignee on the assignee axis, and the
 * component / label lists on their own axes — see
 * `KANBAN_AXIS_SUPPRESSED`). Both halves arrive here already resolved,
 * as the packed `fields` mask; nothing on this card re-derives the rule.
 *
 * The defaults reproduce the board exactly as sk-285.2.3/2.4 painted it,
 * so switching this feature on changed nobody's board.
 *
 * Memoised for the same reason `TaskCard` is: the board re-renders on
 * every query tick and every drag frame, while the rows behind the
 * cards do not change. That memo rests on every prop being stable
 * between ticks — which is why `fields` is a number rather than the
 * user's `Set`, and why `componentNames` is the Map the Tasks column
 * already memoises rather than one derived here.
 */
const KanbanCard = memo(function KanbanCard({
  item,
  dragId,
  selected,
  draggable,
  fields,
  componentNames,
  alsoIn,
  overlay = false,
  onSelect,
}: KanbanCardProps) {
  const { t } = useTranslation('tasks');
  const { listeners, setNodeRef, isDragging } = useDraggable({
    id: dragId,
    disabled: !draggable,
  });
  const assigneeText = item.assignee || t('common:unassigned');

  // The derived blocked marker rides the status chip (`<Attribute>` has
  // one chip for both, by design — `blocked` REPLACES the wire status on
  // a chip that would otherwise say `open`). So the chip is drawn when
  // either switch asks for it, and it says "blocked" only when the
  // blocked switch is on AND the graph says so.
  const wantBlocked = hasCardField(fields, 'blocked') && item.isBlocked;
  const wantStatus = hasCardField(fields, 'status');
  const componentsText =
    hasCardField(fields, 'components') && item.componentIds.length > 0
      ? item.componentIds.map((id) => componentNames?.get(id) ?? shortId(id)).join(', ')
      : '';
  const labelsText =
    hasCardField(fields, 'labels') && item.labels.length > 0
      ? item.labels.join(', ')
      : '';
  const showUpdated = hasCardField(fields, 'updated');
  const showCreated = hasCardField(fields, 'created');
  const showDelegated = hasCardField(fields, 'delegated') && !!item.iAssigned;

  return (
    <button
      type="button"
      ref={overlay ? undefined : setNodeRef}
      className={[
        'kanban-card',
        selected ? 'selected' : '',
        item.type === 'epic' ? 'is-epic' : '',
        item.status === 'standing' ? 'is-standing' : '',
        !draggable && !overlay ? 'is-locked' : '',
        alsoIn ? 'is-duplicated' : '',
        isDragging ? 'is-dragging' : '',
        overlay ? 'is-overlay' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-label={
        alsoIn
          ? `${t('card.openIssue', { id: item.id, title: item.title })} — ${t(
              'kanban.alsoIn',
              { columns: alsoIn },
            )}`
          : t('card.openIssue', { id: item.id, title: item.title })
      }
      // dnd-kit's `attributes` aria bundle is deliberately NOT spread:
      // it advertises "press space bar to lift", which is false here —
      // no KeyboardSensor is registered — and its `role`/`tabIndex`
      // would override the card's own button semantics. Only the
      // pointer listeners are taken.
      {...(overlay ? {} : listeners)}
      // The ghost inside <DragOverlay> is a visual duplicate of a card
      // that is still in the DOM: keep it out of the tab order.
      tabIndex={overlay ? -1 : undefined}
      // sk-551.4 — where focus returns when this issue's pane closes
      // (`Shell.tsx#restoreFocusAfterPane`). Not on the drag ghost.
      data-issue-id={overlay ? undefined : item.id}
      onClick={() => onSelect(item)}
    >
      <span className="kanban-card-title" title={item.title}>
        {showDelegated ? (
          <span className="kanban-card-star" title={t('card.delegatedStarTitle')}>
            {/* sk-285.7 T029 — 16, per FR-003 / handoff §8 "16 inline in
                text and inside chips". It was 11, which is off the scale
                altogether, and the list card's identical star is already
                16 — one glyph, one size, both surfaces. */}
            <IconStarFilled size={16} aria-hidden />
            <span className="sr-only">{t('card.delegatedByMe')}</span>
          </span>
        ) : null}
        {item.title}
      </span>
      {hasCardField(fields, 'id') ? (
        <span className="kanban-card-id-line">
          <IssueIDBadge id={item.id} />
        </span>
      ) : null}
      {hasCardField(fields, 'type') ||
      hasCardField(fields, 'priority') ||
      wantStatus ||
      wantBlocked ||
      hasCardField(fields, 'assignee') ? (
        <span className="kanban-card-meta">
          <span className="kanban-card-attrs">
            {hasCardField(fields, 'type') ? (
              <Attribute kind="type" value={item.type} />
            ) : null}
            {hasCardField(fields, 'priority') ? (
              <Attribute kind="priority" value={item.priority} />
            ) : null}
            {wantStatus || wantBlocked ? (
              <Attribute kind="status" value={item.status} isBlocked={wantBlocked} />
            ) : null}
          </span>
          {hasCardField(fields, 'assignee') ? (
            <span className="kanban-card-assignee">{assigneeText}</span>
          ) : null}
        </span>
      ) : null}
      {componentsText ? (
        <span className="kanban-card-tags" title={componentsText}>
          {t('kanban.cardComponents', { names: componentsText })}
        </span>
      ) : null}
      {labelsText ? (
        <span className="kanban-card-tags" title={labelsText}>
          {t('kanban.cardLabels', { names: labelsText })}
        </span>
      ) : null}
      {showUpdated || showCreated ? (
        <span
          className="kanban-card-dates"
          // sk-285.6.7 — one hover, both exact stamps. The two labels
          // share a span, so the title names which is which.
          title={[
            showUpdated ? `updated ${formatTimestamp(item.updatedAt)}` : null,
            showCreated ? `created ${formatTimestamp(item.createdAt)}` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        >
          {showUpdated
            ? t('kanban.cardUpdated', { when: formatRelative(item.updatedAt) })
            : null}
          {showUpdated && showCreated ? ' · ' : null}
          {showCreated
            ? t('kanban.cardCreated', { when: formatRelative(item.createdAt) })
            : null}
        </span>
      ) : null}
      {alsoIn ? (
        <span className="kanban-card-also" title={t('kanban.alsoIn', { columns: alsoIn })}>
          <span aria-hidden>⧉ </span>
          {t('kanban.alsoIn', { columns: alsoIn })}
        </span>
      ) : null}
    </button>
  );
});
