import { useId, useRef, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { Icon } from '@tabler/icons-react';
import {
  IconArrowUpRight,
  IconAt,
  IconCircle,
  IconCircleCheckFilled,
  IconEye,
  IconPencil,
  IconPoint,
  IconStar,
  IconX,
} from '@tabler/icons-react';
import { IssueIDBadge } from '../../components/IssueIDBadge';
import type { MySpace } from '../../api/spaces';
import { QueueSpaceLabel } from './InboxCard';
import { TimeLabel } from '../../components/TimeLabel';
import {
  isHistoricalWatchingCard,
  type NotificationItem,
  type WatchingItem,
} from '../../api/notifications';
import { EventLineRender } from '../../components/EventLineRender';
import { SkeinTooltip } from '../../components/SkeinTooltip';

/**
 * sk-39 — one Watching card. The card unit is a SUBSCRIPTION, not an
 * issue with activity, and sk-303.13 (T028, US-6, Q8) is what makes the
 * difference visible: a subtree subscription on an ancestor gathers the
 * activity of every descendant onto the ancestor's ONE card. There is no
 * card per descendant, because there is no subscription on a descendant
 * to unsubscribe from — a list of things you cannot leave would be a
 * list of the wrong things, and one busy tree would push every other
 * subscription off the screen.
 *
 * That makes the card carry two different issues at once, and the whole
 * layout below exists to keep them apart:
 *
 *   ┌────────────────────────────────────────────┐
 *   │ ccm9e6312                              [×]  │ ← project + unsubscribe
 *   │ ccm9e6312-100 Refactor auth service          │ ← THE SUBSCRIPTION
 *   │ [icon]creator [icon]assignee [icon]manual    │ ← reasons row
 *   │ watching this issue and its descendants      │ ← only when subtree
 *   │                                              │
 *   │ Recent (7d, 3 new):                         │ ← header w/ unread badge
 *   │ • alice changed status (open → in_progress) │ ← on the subscription
 *   │ • …-100.2 bob commented               25m ago│ ← on a DESCENDANT
 *   └────────────────────────────────────────────┘
 *
 * Click targets, all of them real `<button>`s, none nested:
 *   1. Card head (id + title + reasons) → «read card X» (sk-622.21, US-7)
 *      and navigates to the card's task: every unread notification whose
 *      card is X is read — the task's own and, on a subtree card, its
 *      descendants' (`useMarkWatchingCardRead`). The card STAYS in the
 *      list: only the badge moves.
 *
 *      sk-303.13.2.10 (FE-G2 / C2) recorded the gap this closes: the
 *      click used to send `mark-read-by-entity`, scoped to the task
 *      itself, so a subtree card kept its descendants' unread and the
 *      badge could not be cleared from the card. The server now has a
 *      card-scoped route, and the click uses it.
 *   2. An activity row on the SUBSCRIPTION itself → same handler, so the
 *      old "click anywhere on the card" affordance is unchanged.
 *   3. An activity row on a DESCENDANT → navigates to that descendant,
 *      which is where the thing the row describes happened. It does not
 *      mark anything read: the read state it could plausibly clear is
 *      the descendant's, and the card's own count would then be stale
 *      until the next refetch. Opening the task is the affordance;
 *      acknowledging the subscription stays on the card head.
 *   4. × (top-right) → unsubscribes from the SUBSCRIPTION, which for a
 *      subtree card is the ancestor named in the title, never the
 *      descendant whose activity the user was reading. Its label says
 *      which issue it leaves, and on a subtree card says that the
 *      subtree goes with it.
 *
 * sk-622.21 (US-5, US-6) — a HISTORICAL card (no subscription, only
 * notifications left in the Watching window, e.g. after the automatic
 * unsubscribe on close) has no reasons and no subscription time. There is
 * nothing to unsubscribe from, so its × is «remove the card» — label and
 * hint say so, and nothing about an automatic subscription not coming
 * back, because no opt-out is written (R3). A one-line note under the
 * title says why the card is still here.
 *
 * sk-551.33 — select mode (the list's multi-select) changes all four.
 * The whole card becomes ONE toggle: a click anywhere on it ticks or
 * unticks it, the card head is the keyboard path (a toggle button,
 * `aria-pressed`), the activity rows stop being buttons, and the × gives
 * its corner to a circle check drawn in the same 44px box — so nothing
 * on the card moves when the mode starts. The circle is a picture of the
 * state, not a control: it lets the click through to the head beneath
 * it. Outside the mode a Ctrl / Cmd click on the card does not open
 * anything; it ticks the card and starts the mode (`onModifierSelect`).
 *
 * The dimmed-stay UX of the Mentions feed is NOT applicable here.
 * Watching cards are "always-on" — dimming would imply temporary state.
 * After mark-read the card stays at full opacity, just without the
 * unread badge. sk-303.13.2.10 (FE-G2 / W7) is where that stopped being
 * only a comment: the card took a `dimmed` prop and the column passed
 * `unreadEventsCount === 0`, so the stylesheet said the opposite of this
 * paragraph and the new quiet state greyed out every live subscription
 * at once. The prop is gone; the read state is the missing badge.
 *
 * An empty timeline next to a non-zero unread badge is legal, not a bug:
 * the badge has no window, the timeline is capped at 7 days and 5 rows
 * (contract C3).
 */
export interface WatchingCardProps {
  row: WatchingItem;
  /** Display alias / idPrefix for the project the SUBSCRIPTION belongs to. */
  projectHandle: string;
  /**
   * sk-674.18 T054 — the space of the issue when the person has two
   * spaces or more: drawn instead of the project handle (screens 1.4–1.5).
   */
  space?: MySpace | null;
  selected: boolean;
  /**
   * «Read card X» — every unread notification of this card, the
   * descendants' included — and navigate to the card's task. See the
   * click-target notes above and `useMarkWatchingCardRead` (US-7).
   */
  onSelect: () => void;
  /**
   * Opens the issue an activity row points at, when that is NOT the
   * subscribed issue. Receives the descendant's hierarchical id and the
   * project uuid the notification carries, so the caller can resolve the
   * handle the same way it does for the card itself.
   */
  onOpenActivityTarget: (issueId: string, projectId: string) => void;
  /**
   * Fires the unwatchIssue mutation on the card's task: «unsubscribe» on
   * a subscribed card, «remove» on a historical one (the same request;
   * the server tells the two apart, US-6).
   */
  onUnsubscribe: () => void;
  /**
   * sk-551.10 / sk-551.33 — select mode of the Watching list. When set,
   * a click on the card flips `checked` through `onToggleChecked` instead
   * of opening anything (see the select-mode note above).
   */
  selectable?: boolean;
  checked?: boolean;
  onToggleChecked?: () => void;
  /**
   * sk-551.33 — a Ctrl / Cmd click outside select mode: tick this card
   * and enter the mode. Omitted while selection is not allowed (the list
   * is a placeholder), and the click then does what a plain one does.
   */
  onModifierSelect?: () => void;
}

/**
 * Visual marker per reason — sk-285.7.2.88 made these DRAWN.
 *
 * They used to be five typed characters, and the file used to say the
 * reason was that characters «render in any terminal-styled font».
 * Measured live in this container at 1440×900, that is exactly what
 * they did not do: `★` came out 11×12, `↗` 10.3×12, and `👁` 7.45×12 —
 * the missing-glyph box, because U+1F441 resolves to a COLOUR-EMOJI
 * face and this container has none. So the row was already drawing its
 * five siblings at three different sizes, one of them not an eye at
 * all, and the per-reason colour the stylesheet sets could not reach
 * the emoji even where the face exists: an emoji paints in its own
 * palette and ignores `currentColor`.
 *
 * Why all five and not only the emoji: the row is ONE vocabulary read
 * left to right. Drawing the member that had to be drawn and typing the
 * other four would put the row on two footings — three sizes becomes
 * one svg plus four characters, which is the same defect with fewer
 * members. §8 names `eye`, `at` and `pencil` outright; `star` and
 * `arrow-up-right` it does not name, and §9 is the clause that covers
 * them — a surface no artboard draws "apply tokens and components from
 * sections 2–6", i.e. the system (Tabler, stroke 1.75, the 16/20/24
 * scale). Nothing is invented but the medium: each icon is the
 * like-for-like drawing of the character it replaces.
 *
 * The star is OUTLINE on purpose. `IconStarFilled` is already spoken
 * for in this shell — `TaskCard.tsx` draws it for «delegated by me» —
 * and this star means «you watch this because you are the assignee».
 * Two related-but-different stakes, told apart the way Tabler tells its
 * own pairs apart, rather than one picture asserting two facts.
 *
 * Order rationale: highest-investment relationship first. The server
 * also pre-sorts, but we map labels by lookup so the order survives
 * any backend tweak.
 */
const REASON_ICONS: Record<string, Icon> = {
  manual: IconEye,
  assignee: IconStar,
  creator: IconArrowUpRight,
  mention: IconAt,
  commenter: IconPencil,
};

/**
 * Unknown reasons (a backend that grew one before the UI did) fall back
 * to §8's own `point` rather than to the bullet character this row used
 * to type — an unknown reason is still a reason, and it is drawn on the
 * same footing as the five that are known.
 */
const UNKNOWN_REASON_ICON: Icon = IconPoint;

/**
 * Does this activity row describe something that happened on the
 * subscribed issue itself, or somewhere below it?
 *
 * The server does not flag a subscription as subtree-scoped, and it does
 * not need to: an event attributed to this card but recorded on another
 * issue can only have arrived through the subtree, so the row itself is
 * the evidence. A card whose rows all name its own issue is
 * indistinguishable from an exact subscription — and correctly so,
 * because until a descendant does something the two behave alike.
 */
function isDescendantEvent(ev: NotificationItem, subscribedIssueId: string): boolean {
  return ev.entity.type === 'issue' && ev.entity.id !== subscribedIssueId;
}

export function WatchingCard({
  row,
  projectHandle,
  space = null,
  selected,
  onSelect,
  onOpenActivityTarget,
  onUnsubscribe,
  selectable = false,
  checked = false,
  onToggleChecked,
  onModifierSelect,
}: WatchingCardProps) {
  const { t } = useTranslation('inbox');
  const { item, reasons, unreadEventsCount, recentEvents } = row;
  const headerLabel = unreadEventsCount > 0
    ? t('watchingCard.recentWithNew', { count: unreadEventsCount })
    : t('watchingCard.recent');
  const hasDescendantActivity = recentEvents.some((ev) =>
    isDescendantEvent(ev, item.id),
  );
  const historical = isHistoricalWatchingCard(row);
  // What the × takes away. On a subtree card it is emphatically NOT the
  // descendant the user has been reading about, so the label says both
  // which issue is left and that its subtree goes with it. On a
  // historical card there is no subscription to leave: it removes the card.
  const unsubscribeLabel = historical
    ? t('watchingCard.removeAria', { id: item.id })
    : hasDescendantActivity
      ? t('watchingCard.unsubscribeSubtreeAria', { id: item.id })
      : t('watchingCard.unsubscribeAria', { id: item.id });

  // sk-551.10 review — the reason hints were only
  // reachable by hovering a chip inside the card button. They are now
  // also the card button's accessible DESCRIPTION, so a keyboard or
  // screen-reader user hears why the subscription exists on focus,
  // without a second interactive element nested in the button.
  const reasonHint = (r: string) => {
    const label = t(`watchingCard.reasons.${r}`, { defaultValue: r });
    return t(`watchingCard.reasonHints.${r}`, {
      defaultValue: t('watchingCard.reasonTitle', { reason: label }),
    });
  };
  const reasonsDescId = useId();
  // sk-551.33 review — the head is the one control the
  // card keeps in both modes. Entering the mode unmounts the × and the
  // activity-row buttons; when one of them held focus, focus fell to the
  // viewport, and the column's Esc no longer heard the key. Focus is moved
  // here instead — also on a plain click in the mode, where a browser
  // that does not focus a clicked button (Safari) would otherwise leave
  // focus outside the column.
  const headRef = useRef<HTMLButtonElement>(null);
  const focusHead = () => headRef.current?.focus({ preventScroll: true });

  const handleUnsubscribeClick = (ev: MouseEvent<HTMLButtonElement>) => {
    // Don't let the click bubble up to the card — that would double-fire
    // mark-read + navigate alongside the unsubscribe.
    ev.stopPropagation();
    onUnsubscribe();
  };

  // sk-551.33 — Ctrl / Cmd click, caught on the way DOWN so that neither
  // the head (open the issue), an activity row (open a descendant) nor
  // the × (unsubscribe) acts on it: the click means «select», wherever
  // on the card it lands.
  const handleModifierClickCapture = (ev: MouseEvent<HTMLDivElement>) => {
    if (!onModifierSelect || !(ev.ctrlKey || ev.metaKey)) return;
    ev.preventDefault();
    ev.stopPropagation();
    // Before the mode re-renders the card: the head survives it, so focus
    // never passes through a removed node.
    focusHead();
    onModifierSelect();
  };

  return (
    // Outer div, not a <button>, so the head, the activity rows and the
    // × can each be a real <button> without nesting.
    //
    // sk-551.33 — in select mode the div itself takes the click: one
    // handler for the head, the activity rows and the padding between
    // them. It is the pointer path only; the keyboard reaches the same
    // toggle through the head button, whose click bubbles here.
    <div
      className={[
        'watching-card',
        selected ? 'selected' : '',
        selectable ? 'selectable' : '',
        checked ? 'checked' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={
        selectable
          ? () => {
              focusHead();
              onToggleChecked?.();
            }
          : undefined
      }
      onClickCapture={selectable ? undefined : handleModifierClickCapture}
    >
      {reasons.length > 0 ? (
        // `hidden`: referenced by aria-describedby (which reads hidden
        // content), never rendered or read a second time in browse mode.
        <span id={reasonsDescId} hidden>
          {reasons.map(reasonHint).join(' ')}
        </span>
      ) : null}
      <button
        ref={headRef}
        type="button"
        className="watching-card-body"
        // In select mode the click bubbles to the card's own handler.
        onClick={selectable ? undefined : onSelect}
        aria-pressed={selectable ? checked : undefined}
        aria-describedby={reasons.length > 0 ? reasonsDescId : undefined}
      >
        {/* sk-303.13.2.10 (FE-G2 / W2) — this used to be an `aria-label`,
          * which REPLACES the accessible name instead of extending it:
          * the id, the title, the reasons and the subtree note were all
          * drawn inside this button and none of them reached a screen
          * reader (WCAG 2.5.3 «Label in Name»). A visually hidden lead-in
          * says what the click does; everything the eye reads below is
          * now also what the ear gets. */}
        <span className="sr-only">
          {selectable
            ? t('watchingCard.selectLeadIn')
            : unreadEventsCount > 0
              ? t('watchingCard.openLeadInUnread', { count: unreadEventsCount })
              : t('watchingCard.openLeadIn')}
        </span>
        {space ? (
          <QueueSpaceLabel space={space} className="task-card-project-eyebrow" />
        ) : projectHandle && projectHandle !== '?' ? (
          <div className="task-card-project-eyebrow">{projectHandle}</div>
        ) : null}
        <div className="watching-card-header">
          <IssueIDBadge id={item.id} />
          <span className="watching-card-title" title={item.title}>
            {item.title}
          </span>
        </div>
        {/* No `aria-label` on the reasons row: on a plain <div> it does
          * not announce a group, but it DOES substitute for the reason
          * names when this button's name is computed from its content —
          * the same W2 defect one level down. */}
        {reasons.length > 0 ? (
          <div className="watching-card-reasons">
            {reasons.map((r) => {
              const ReasonIcon = REASON_ICONS[r] ?? UNKNOWN_REASON_ICON;
              // Unknown reasons (a backend that grew a new one before the
              // UI did) fall back to the raw wire value rather than an
              // empty label — `defaultValue` keeps i18next from echoing
              // the key path.
              const label = t(`watchingCard.reasons.${r}`, { defaultValue: r });
              // sk-551.10, item 2 — the hint says what the reason MEANS
              // (why the subscription exists, whether it is automatic),
              // not just its name again. Unknown reasons keep the generic
              // sentence.
              const hint = reasonHint(r);
              return (
                <SkeinTooltip key={r} content={hint} position="bottom" width={240}>
                  <span className={`watching-card-reason ${r}`}>
                    <span className="watching-card-reason-icon" aria-hidden="true">
                      <ReasonIcon size={16} stroke={1.75} />
                    </span>
                    {label}
                  </span>
                </SkeinTooltip>
              );
            })}
          </div>
        ) : null}
        {historical ? (
          <div className="watching-card-historical-note">
            {t('watchingCard.historicalNote')}
          </div>
        ) : null}
        {hasDescendantActivity ? (
          // sk-622.21 (US-5) — a historical card has no subscription, so
          // its note says only where the activity is, not «watching».
          <div className="watching-card-subtree-note">
            {historical
              ? t('watchingCard.subtreeNoteHistorical')
              : t('watchingCard.subtreeNote')}
          </div>
        ) : null}
      </button>
      <div className="watching-card-activity">
        <div className="watching-card-recent-header">
          {headerLabel}
          {unreadEventsCount > 0 ? (
            <span className="watching-card-unread-badge">
              {' '}
              {t('watchingCard.newBadge', { count: unreadEventsCount })}
            </span>
          ) : null}
        </div>
        {recentEvents.length === 0 ? (
          <div className="watching-card-empty">{t('watchingCard.noRecent')}</div>
        ) : (
          <ul className="watching-card-events">
            {recentEvents.map((ev) => {
              const descendant = isDescendantEvent(ev, item.id);
              // sk-551.33 — in select mode a row is text: its click
              // belongs to the card (tick), and a button named «Open …»
              // that ticks instead would lie about what it does.
              if (selectable) {
                return (
                  <li key={ev.id} className="outbox-card-event">
                    <span className="outbox-card-event-bullet" aria-hidden="true">
                      •
                    </span>
                    <span className="outbox-card-event-summary watching-card-event-text">
                      {descendant ? (
                        <span className="watching-card-event-target">
                          <IssueIDBadge id={ev.entity.id} />
                        </span>
                      ) : null}
                      <EventLineRender ev={ev} />
                    </span>
                    <TimeLabel iso={ev.createdAt} className="outbox-card-event-time" />
                  </li>
                );
              }
              // sk-303.13.2.10 (FE-G2 / W2) — the event line IS this
              // row's label. The old `aria-label` replaced it, so every
              // row of one descendant announced identically and neither
              // the action nor the time reached the reader. Now: hidden
              // lead-in, spoken event line, and the time (which lives
              // outside the button) attached by reference as the
              // description rather than duplicated into the name.
              //
              // `outbox-card-event*` / `outbox-ev-*` below are historical
              // names — the Outbox surface they were written for is gone
              // (US-9) and these rows are the live consumers. Renaming
              // them would be a repaint, not a fix.
              return (
                <li key={ev.id} className="outbox-card-event">
                  <span className="outbox-card-event-bullet" aria-hidden="true">
                    •
                  </span>
                  <button
                    type="button"
                    className="outbox-card-event-summary watching-card-event-open"
                    aria-describedby={`watching-ev-time-${ev.id}`}
                    onClick={() => {
                      if (descendant) {
                        onOpenActivityTarget(ev.entity.id, ev.entity.projectId);
                        return;
                      }
                      onSelect();
                    }}
                  >
                    <span className="sr-only">
                      {descendant
                        ? t('watchingCard.openEventDescendant')
                        : t('watchingCard.openEventOwn', { id: item.id })}
                    </span>
                    {descendant ? (
                      <span className="watching-card-event-target">
                        <IssueIDBadge id={ev.entity.id} />
                      </span>
                    ) : null}
                    <EventLineRender ev={ev} />
                  </button>
                  {/* sk-285.6.7 — `TimeLabel`, not a bare
                      `formatRelative()`: the exact stamp stays one hover
                      away wherever the short form is shown. */}
                  <TimeLabel
                    iso={ev.createdAt}
                    className="outbox-card-event-time"
                    id={`watching-ev-time-${ev.id}`}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {selectable ? (
        // sk-551.33 — the ×'s corner, the ×'s box: the check takes its
        // place instead of pushing the text aside. A picture of the state
        // (`aria-hidden`; the head says it with `aria-pressed`), and
        // `pointer-events: none` in the sheet hands its click to the head.
        <span className="watching-card-check" aria-hidden="true">
          {checked ? (
            <IconCircleCheckFilled size={20} aria-hidden />
          ) : (
            <IconCircle size={20} stroke={1.75} aria-hidden />
          )}
        </span>
      ) : (
      /* sk-551.10 — the hint says what the × does beyond its name: the
          automatic subscription will not come back, a manual one is
          always possible. The accessible name stays on the button. */
      <SkeinTooltip
        content={t(historical ? 'watchingCard.removeHint' : 'watchingCard.unsubscribeHint')}
        position="left"
        width={240}
      >
      <button
        type="button"
        className="watching-card-unsubscribe"
        aria-label={unsubscribeLabel}
        onClick={handleUnsubscribeClick}
      >
        {/* sk-285.7.2.88 — §8 names `x`, and this is the same control
            sk-285.7.2.45 drew with it in the Details header. It was
            U+00D7 MULTIPLICATION SIGN in a 44×44 box (measured live),
            i.e. a character standing in for a picture at whatever
            weight the system font happened to give it. 20 is §8's
            in-control step. The accessible name is on the button. */}
        <IconX size={20} stroke={1.75} aria-hidden />
      </button>
      </SkeinTooltip>
      )}
    </div>
  );
}
