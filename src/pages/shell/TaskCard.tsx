import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { IconAlarm, IconCornerDownRight, IconStarFilled } from '@tabler/icons-react';
import { IssueIDBadge } from '../../components/IssueIDBadge';
import { Attribute } from '../../components/Attribute';
import { SearchHighlight } from '../../components/SearchHighlight';
import { SkeinTooltip } from '../../components/SkeinTooltip';
import { formatRelative, formatTimestamp } from '../../components/format';
import { highlightMatch } from '../../lib/highlightMatch';
import { relevanceBar, relevanceOpacity, relevancePercent } from '../../lib/relevance';
import {
  DEP_TYPE_CSS_VARS,
  DEP_TYPE_GLYPHS,
  DEP_TYPE_ICONS,
  DEP_TYPE_TOOLTIPS,
} from '../../lib/depTypeIcons';
import { hasListCardField } from '../../lib/listCardFields';
import { progressCaption, progressNumbers } from '../../lib/progressNumbers';
import { epicProgressChipText } from './epicProgressChipText';
import type { DepType } from '../../api/dependencies';
import type { IssueSummary } from '../../api/issues';

/**
 * One row in the Tasks column (F4, Sc3) — cards mode.
 *
 * Layout (the title block wraps to two lines):
 *
 *   Row 1   : [★?] {title-starts-here-and-wraps-onto}
 *   Row 2   : {row 2 of title continuing… ellipsis if longer}
 *   Row 3   : {idBadge}
 *   Row 4 L : [status] [priority]
 *   Row 4 R : {assignee} · {component count} · {relative date}
 *
 * The title owns the first line alone; the id sits on its own quiet
 * line below it, in the slot the project handle used to occupy. The
 * handle was dropped from this card — on a single-project list it
 * repeated the column the reader was already looking at.
 *
 * The leading ★ (filled with `var(--primary)`) only renders for issues
 * the caller created and assigned to someone else (`iAssigned === true`,
 * Q23). When set, the card also gets a subtle `assigned-by-me` tint on
 * the first ~30% of its width so the user can scan delegated tasks.
 *
 * Selected → left brand stripe + `var(--primary-t)` background,
 * mirroring InboxCard. Hover → `var(--elev)` for parity with other
 * columns.
 */
export interface TaskCardProps {
  item: IssueSummary;
  selected: boolean;
  /** Search query (already debounced) — empty string when no search. */
  searchQuery: string;
  /**
   * Lookup map id → name for components of the current project. When
   * an item has exactly one component AND the map has a name for it,
   * we show that name; otherwise fall back to the count format.
   * Cross-project Outbox passes an empty map and always sees counts.
   */
  componentNames: Map<string, string>;
  /**
   * sk-62.2 — this row has ≥1 RINGING reminder for the caller (amber
   * wash + 🔔 flag).
   *
   * sk-194.5.2.8.5 — a plain `boolean` computed by the list owner, NOT
   * the `ReadonlySet` from `useRingingIssueIds()`. The card used to call
   * that hook itself, which meant one `QueryObserver` on the reminders
   * query PER ROW: TanStack Query dedupes the network request by key but
   * NOT the observers, and every observer re-installs both of its timers
   * (`clearTimeout`+`setTimeout`+`clearInterval`+`setInterval`) on every
   * update of that query — `QueryObserver.onQueryUpdate → #updateTimers`.
   * On a 474-row board that was 474 observers; profiling
   * measured 2 998 timer installs / 26 s and put ~26 % of the
   * live-event window in timer self-time under `onSubscribe`/`subscribe`.
   *
   * It MUST stay a primitive: a `Set` or an object here would be a fresh
   * reference on every parent render and would silently kill the `memo()`
   * below (see the prop-stability list in its doc comment).
   */
  isRinging: boolean;
  /**
   * Which attributes this card is allowed to print — the user's list
   * «display properties», packed by `listCardFieldsMask`.
   *
   * A NUMBER, not the `ReadonlySet` the preference is stored as, and
   * required rather than optional. The prop-stability list in the
   * `memo()` doc below is the reason: a fresh `Set` per parent render
   * would compare unequal every time and silently kill the memo on a
   * list that re-renders on every keystroke. A mask compares by value.
   * The same contract `KanbanCard.fields` carries.
   */
  fields: number;
  /**
   * Open this row in the Details column.
   *
   * sk-194.5.2.8.2 — takes the row as an argument rather than being a
   * pre-bound thunk. Call sites used to pass `onSelect={() => onSelect(item)}`,
   * a fresh closure per row per render, which defeats the `memo()` below
   * outright. With the item supplied here the caller can hand over ONE
   * referentially-stable handler for the whole list.
   */
  onSelect: (item: IssueSummary) => void;
}

/**
 * sk-36 — small icon strip rendered before the text badges in a card.
 * Derives the set of icons from IssueSummary flags that are available
 * on the listIssues wire shape WITHOUT an extra fetch. Each glyph is a
 * SkeinTooltip-wrapped span so hover surfaces the dep-type definition
 * — the same iconography users see on tree connectors.
 *
 * Coverage (today): `parent-child` from `parentIdCurrent`, `blocks`
 * from `isBlocked`. Full 7-type coverage requires the backend to
 * project an `outgoingDepTypes []string` column on IssueSummary —
 * tracked as a follow-up to this slice.
 */
function DepTypeIconStrip({
  item,
  showBlocked,
}: {
  item: IssueSummary;
  showBlocked: boolean;
}) {
  const { t } = useTranslation('tasks');
  const icons: DepType[] = [];
  // The has-parent marker is NOT switchable: it says where the row sits in the
  // hierarchy, which is the same "structural, not a property" call the
  // tree makes for its title column. ⊘ (blocked) IS — it is a fact about
  // the task, derived from the dependency graph, and it rides the
  // `blocked` switch together with the marker the status chip folds in.
  if (item.parentIdCurrent) icons.push('parent-child');
  if (item.isBlocked && showBlocked) icons.push('blocks');
  if (icons.length === 0) return null;
  return (
    <span className="task-card-dep-icons" aria-label={t('card.depIconsAria')}>
      {icons.map((t) => {
        // sk-285.7.2.52 — the subtask marker is the one edge type the
        // handoff draws as an icon (§8, `corner-down-right`); the other
        // six keep their characters, because §8 names no icon for them.
        const Icon = DEP_TYPE_ICONS[t as keyof typeof DEP_TYPE_ICONS] as
          | typeof IconCornerDownRight
          | undefined;
        return (
          <SkeinTooltip key={t} content={DEP_TYPE_TOOLTIPS[t]} position="top">
            <span
              className="task-card-dep-icon"
              role="img"
              aria-label={DEP_TYPE_TOOLTIPS[t]}
              style={{ color: `var(${DEP_TYPE_CSS_VARS[t]})` }}
            >
              {Icon ? <Icon size={16} stroke={1.75} aria-hidden /> : DEP_TYPE_GLYPHS[t]}
            </span>
          </SkeinTooltip>
        );
      })}
    </span>
  );
}

/**
 * sk-194.5.2.8.2 — memoised.
 *
 * Profiling (sk-238) put the
 * per-keystroke cost of the Tasks column at `≈16 ms + 0,053 ms × rows`. The
 * linear term is this component: the search box state lives ABOVE the list
 * and the query is debounced by 200 ms, so every keystroke re-rendered every
 * loaded row while the data behind them had not changed at all (923 rows
 * after one scroll → 64,9 ms per keystroke, long task on 9 of 9 presses).
 *
 * `memo()` only pays off because all six props are referentially stable
 * between keystrokes, which was checked rather than assumed:
 *   - `item`      — an object out of the TanStack cache page, re-exposed via
 *                   `useMemo` in `useTasks` keyed on `query.data`; a keystroke
 *                   changes `ui.search`, not `debouncedSearch`, so the memo
 *                   does not recompute and the row objects keep identity.
 *   - `componentNames` — `useMemo` over its query data.
 *   - `searchQuery` — the DEBOUNCED string, not the raw box value.
 *   - `selected` / `isRinging` — primitives.
 *   - `fields`    — a primitive too, and that is why the list's «display
 *                   properties» arrive as a packed bitmask rather than as
 *                   the `ReadonlySet` they are stored as: a fresh `Set`
 *                   per parent render would compare unequal on every
 *                   keystroke and undo everything below.
 *   - `onSelect`  — now one stable callback for the whole list (see the prop
 *                   doc above and `handleSelect` in TasksColumn).
 * Drop any of those guarantees and this memo silently becomes dead weight.
 *
 * sk-194.5.2.8.5 — `isRinging` was deliberately added as a `boolean` rather
 * than keeping `useRingingIssueIds()` inside the card. Hooks are invisible to
 * `memo()`, so the old shape ALSO meant every row re-rendered whenever the
 * reminders query updated, on top of holding a live observer + two timers per
 * row. See the `isRinging` prop doc for the measurement.
 */
export const TaskCard = memo(function TaskCard({ item, selected, searchQuery, componentNames, isRinging, fields, onSelect }: TaskCardProps) {
  // sk-285.1.17 — `useTranslation` is a plain event-emitter subscription on
  // the i18next instance (no query observer, no timers), so it does NOT
  // reintroduce the per-row cost `isRinging` was lifted out to avoid. It is
  // invisible to `memo()` on purpose: a language switch MUST re-render every
  // card, and that is the only thing it re-renders on.
  const { t } = useTranslation('tasks');
  const titleHtml = highlightMatch(item.title, searchQuery);
  // The ★ and the tint it comes with are ONE mark, so they ride one
  // switch: `delegated` off means the row carries no delegated signal at
  // all, rather than losing the glyph and keeping the wash.
  const isAssignedByMe = !!item.iAssigned && hasListCardField(fields, 'delegated');

  const showBlocked = hasListCardField(fields, 'blocked');
  // The derived blocked marker rides the status chip (`<Attribute>` has
  // one chip for both, by design — `blocked` REPLACES the wire status on
  // a chip that would otherwise say `open`), so the chip is drawn when
  // either switch asks for it and says "blocked" only when the blocked
  // switch is on AND the graph says so. Same rule as on the board.
  const wantBlocked = showBlocked && item.isBlocked;
  const wantStatus = hasListCardField(fields, 'status');

  const componentSegment = (() => {
    if (!hasListCardField(fields, 'components')) return null;
    const n = item.componentIds.length;
    if (n === 0) return null;
    if (n === 1) {
      const name = componentNames.get(item.componentIds[0]);
      if (name) return name;
    }
    return t('card.components', { count: n });
  })();

  /**
   * The right-hand meta line, as a list of whole segments joined by
   * ` · `. It used to be four hard-coded spans with the separators baked
   * into their text; with every segment switchable that spelling puts a
   * dangling `·` on the card the moment a neighbour is turned off. The
   * separator therefore belongs to the JOIN, not to the segment.
   *
   * Each segment stays its own element because `.task-card-meta-right >
   * *` is what carries `white-space: nowrap` — that is the rule which
   * makes the group wrap between segments instead of cutting one in half
   * (sk-285.1.8). One span per segment, never one span for the line.
   */
  // sk-285.6.7 — `title` carries the full `YYYY-MM-DD HH:MM UTC` stamp
  // for the segments that print a relative label, so the exact instant
  // is one hover away here exactly as it is in the card.
  const metaSegments: Array<{
    key: string;
    text: string;
    className?: string;
    title?: string;
  }> =
    [];
  if (hasListCardField(fields, 'progress') && item.epicProgress) {
    // sk-489 T016 (US-6, INV-5) — the row's progress numbers are read from ONE
    // place: `lib/progressNumbers.ts`. There is neither subtraction nor
    // division here — only the choice of label, and this choice is made by `fromNewFields`,
    // NOT by the presence of a number: an api response that knows nothing about the outcome must
    // print today's "closed / total" pair (US-10).
    // sk-540.3 — the caption form (pair, pair + excluded tail, or the
    // empty-denominator caption) is chosen by `progressCaption`, one rule
    // for the chip, the tree cell and the branch row.
    const caption = progressCaption(progressNumbers(item.epicProgress));
    metaSegments.push({
      key: 'progress',
      className: 'task-card-epic-progress',
      text: epicProgressChipText(caption, t),
    });
  }
  if (componentSegment) {
    metaSegments.push({ key: 'components', text: componentSegment });
  }
  if (hasListCardField(fields, 'labels') && item.labels.length > 0) {
    metaSegments.push({
      key: 'labels',
      text: t('card.labels', { names: item.labels.join(', ') }),
    });
  }
  if (hasListCardField(fields, 'assignee')) {
    metaSegments.push({
      key: 'assignee',
      text: item.assignee || t('common:unassigned'),
    });
  }
  if (hasListCardField(fields, 'updated')) {
    metaSegments.push({
      key: 'updated',
      text: formatRelative(item.updatedAt),
      title: formatTimestamp(item.updatedAt),
    });
  }
  if (hasListCardField(fields, 'created')) {
    metaSegments.push({
      key: 'created',
      text: t('card.createdWhen', { when: formatRelative(item.createdAt) }),
      title: formatTimestamp(item.createdAt),
    });
  }

  // sk-32 slice 7: epic-typed rows get a faint orange wash + brand-tinted
  // left-rail. The class is purely visual; logic stays in TaskCard.
  const isEpic = item.type === 'epic';

  // sk-53 — relevance badge, search-only. `score` is present only on rows
  // that came from the hybrid /search endpoint; absolute-calibrated to a
  // percent (NOT relative-to-top) so a weak top row reads honestly low.
  const relevance =
    item.score != null ? relevancePercent(item.score) : null;

  return (
    <button
      type="button"
      className={[
        'task-card',
        selected ? 'selected' : '',
        isAssignedByMe ? 'assigned-by-me' : '',
        isEpic ? 'is-epic' : '',
        item.status === 'standing' ? 'is-standing' : '',
        isRinging ? 'reminder-ringing' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-label={
        isRinging
          ? t('card.openIssueRinging', { id: item.id, title: item.title })
          : t('card.openIssue', { id: item.id, title: item.title })
      }
      // sk-551.5 — the anchor `Shell` returns focus to when the issue's
      // pane or pop-up window closes; the board's cards and the tree's
      // rows carry the same attribute.
      data-issue-id={item.id}
      onClick={() => onSelect(item)}
    >
      {isRinging ? (
        <span
          className="task-card-ringing-flag"
          aria-hidden
          title={t('card.ringingTitle')}
        >
          {/* sk-285.7.2.88 — `alarm`, the name §8 gives this object and
              the one sk-285.7.2.57 already chose for it in the Details
              panel. The flag was U+1F514 BELL: an emoji resolves to the
              platform's colour-emoji face, so it arrived in that face's
              yellow no matter what `--warn` this corner is painted, and
              in a container without that face it draws the
              missing-glyph box (measured live here at 7.45×12 for its
              siblings 👁 and 🔒). The OUTLINE alarm, not
              `IconAlarmFilled`: a filled Tabler icon emits `fill` and
              no `stroke`, so it cannot carry §8's 1.75. This flag is
              only ever rendered while the reminder rings, so it has no
              second state to distinguish. */}
          <IconAlarm size={16} stroke={1.75} />
        </span>
      ) : null}
      {/* Search-only relevance badge. This row used to also carry a
       * project-handle eyebrow ABOVE the title; the handle is gone from
       * this card entirely. Nothing goes above the title — it is the
       * first line of every card. */}
      {relevance !== null ? (
        <div className="task-card-eyebrow-row">
          <SkeinTooltip
            content={t('card.relevanceTooltip', { percent: relevance })}
            position="top"
          >
            <span
              className="task-card-relevance"
              style={{ opacity: relevanceOpacity(relevance) }}
              aria-label={t('card.relevanceAria', { percent: relevance })}
            >
              <span className="task-card-relevance-bar" aria-hidden>
                {relevanceBar(relevance)}
              </span>
              <span className="task-card-relevance-pct">{relevance}%</span>
            </span>
          </SkeinTooltip>
        </div>
      ) : null}
      {/* handoff §6 "Task list": "Heading 16/500 on the left, ID mono 12
       * `--primary` on the right" — title and id on ONE line, title first.
       *
       * The id has been in three places on this card and the order of
       * the moves is the argument. It started INLINE BEFORE the title,
       * which made every title start at a different offset — a column
       * of titles that read ragged, and the reason it was moved out. It
       * then took a line of its own under the title (the slot the
       * project handle vacated; the handle itself is gone from this
       * card, it repeated on every row of a single-project list while
       * naming the column the reader was already looking at). §6 brings
       * it back onto the title's line on the OTHER side, which is what
       * answers the ragged-offset objection rather than ignoring it:
       * the title still starts flush at the card's padding edge on
       * every row, and the id is right-aligned, where a ragged edge is
       * how a scannable data column is supposed to look.
       *
       * Do NOT put the badge back INSIDE `.task-card-title-block`: that
       * block is the 2-line clamp, so an id inside it would flow after
       * however much title there was and be the first thing the
       * ellipsis ate. The row wrapper keeps them side by side instead
       * (`.task-card-title-row` in index.css). */}
      <div className="task-card-title-row">
        <div className="task-card-title-block" title={item.title}>
          {isAssignedByMe ? (
            <span
              className="task-card-star"
              title={t('card.delegatedStarTitle')}
            >
              {/* FR-003 / handoff §8 — 16px, the inline-in-text step. It
                  was 11, a size that is on no scale. */}
              <IconStarFilled size={16} aria-hidden />
              <span className="sr-only">{t('card.delegatedByMe')}</span>
            </span>
          ) : null}
          <span className="task-card-title-text">
            <SearchHighlight html={titleHtml} />
          </span>
        </div>
        {hasListCardField(fields, 'id') ? (
          <div className="task-card-id-line">
            <IssueIDBadge id={item.id} />
          </div>
        ) : null}
      </div>
      <div className="task-card-meta-row">
        <div className="task-card-meta-left">
          {/* sk-36 — leading dep-type icons. Surfaces a quick at-a-glance
           * summary of which typed-deps the issue participates in.
           * Currently rendered from IssueSummary flags available on the
           * wire: `parentIdCurrent` → the subtask icon, `isBlocked` → ⊘
           * (blocked by something). Hovering each icon surfaces the
           * SkeinTooltip definition so users learn the iconography. */}
          <DepTypeIconStrip item={item} showBlocked={showBlocked} />
          {wantStatus || wantBlocked ? (
            <Attribute
              kind="status"
              value={item.status}
              isBlocked={wantBlocked}
              pinned={item.pinned}
            />
          ) : null}
          {hasListCardField(fields, 'priority') ? (
            <Attribute kind="priority" value={item.priority} />
          ) : null}
          {hasListCardField(fields, 'type') ? (
            <Attribute kind="type" value={item.type} />
          ) : null}
        </div>
        <div className="task-card-meta-right">
          {metaSegments.map((seg, i) => (
            <span key={seg.key} className={seg.className} title={seg.title}>
              {i === 0 ? seg.text : ` · ${seg.text}`}
            </span>
          ))}
        </div>
      </div>
    </button>
  );
});
