import { useRef, type MouseEvent } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IconCheck, IconUser } from '@tabler/icons-react';
import { IssueIDBadge } from '../../components/IssueIDBadge';
import { SkeinTooltip } from '../../components/SkeinTooltip';
import { Attribute } from '../../components/Attribute';
import { TimeLabel } from '../../components/TimeLabel';
import { useAcceptIssue } from '../../lib/useAcceptIssue';
import { useFitsWidth } from './WatchingFilter';
import type { IssueSummary } from '../../api/issues';
import type { MySpace } from '../../api/spaces';

/**
 * sk-674.18 T054 — the space of a queue card, drawn where the project
 * handle was (screens 1.3–1.5, plan 5.2): `Acme shop-9.15` — the project
 * is already in the id. "Personal" is a person icon without a word
 * (decision No. 5), named "Personal" for a screen reader and on hover. Not a
 * link: the card opens the issue, the space is one chip away in its
 * header (V5).
 *
 * Given only with two spaces or more (`InboxColumn.tsx#queueSpaceOf`);
 * with one the card shows the project handle as before.
 */
export function QueueSpaceLabel({ space, className }: { space: MySpace; className: string }) {
  const { t } = useTranslation('inbox');
  if (space.kind !== 'personal') {
    return <span className={className}>{space.name}</span>;
  }
  const name = t('space.personal');
  return (
    <SkeinTooltip content={name} position="top">
      <span className={`${className} queue-space-personal`} role="img" aria-label={name}>
        <IconUser size={14} stroke={1.75} aria-hidden />
      </span>
    </SkeinTooltip>
  );
}

/**
 * One row in the Inbox column (F3, Sc1).
 *
 * Three-block layout (Variant A):
 *
 *   Row 1 — header chips: IssueIDBadge · PriorityBadge · type pill
 *   Row 2 — title, wraps up to 3 lines, ellipsis on the 3rd
 *   Row 3 — footer meta on the left + Accept button anchored bottom-right
 *
 * sk-733.4 — when the footer is too narrow for «from … · date» and the
 * labelled button on one line, the button folds to the ✓ glyph alone
 * (same accessible name, an instant tooltip «Accept this issue») instead
 * of dropping to a row of its own — the maintainers' decision: the lone button
 * under the meta looked broken. The decision follows the FOOTER's own
 * width (`WatchingFilter.tsx#useFitsWidth` against a hidden copy of the
 * full row), not the window's: the column is resized by its handle.
 *
 * The Accept button is a sibling of the body button (the card-shell
 * pattern, not nested) and is absolutely positioned in the bottom-right
 * corner so it never overlaps the title. The footer text reserves
 * enough right-padding to not run under the button.
 *
 * Click on the card body navigates to
 * `/projects/{alias}/issues/{id}`. sk-405 — that is all it does now:
 * the navigation used to carry `state.fromInbox=true`, on which Shell
 * unmounted the Projects and Tasks columns, and the maintainers asked for
 * those columns to stay. The issue opens in the Details column and this
 * card takes `.selected`, as does its row in the Tasks list when that
 * list holds it.
 *
 * Click on Accept performs the mutation in place — the optimistic
 * update in `useAcceptIssue` removes the row before the server
 * round-trip finishes.
 */
export interface InboxCardProps {
  item: IssueSummary;
  selected: boolean;
  /**
   * If true, click handlers are no-ops. Used while the projects list
   * is still loading and we can't resolve the project handle.
   */
  disabled?: boolean;
  onSelect: () => void;
  /**
   * Display alias / idPrefix for the project the issue belongs to.
   * Resolved from `useProjectsList()` in the parent — the API does
   * not denormalize the project handle onto the issue summary, and
   * we don't want a second fetch per row.
   */
  projectHandle: string;
  /**
   * sk-674.18 T054 — the space of the issue when the person has two
   * spaces or more: drawn instead of the project handle. null — the
   * handle, as before.
   */
  space?: MySpace | null;
  /**
   * sk-62.2 — this row has ≥1 RINGING reminder for the caller.
   *
   * sk-194.5.2.8.5 — computed by `InboxColumn` from a single
   * `useRingingIssueIds()` read, not by calling that hook here. Per-row the
   * hook meant one live `QueryObserver` on the reminders query per rendered
   * card (the inbox query pages at `limit: 100`), and each observer
   * re-installs both of its timers on every update of that query
   * (`QueryObserver.onQueryUpdate → #updateTimers`). Same lift as
   * `TaskCard`; see its `isRinging` doc for the measurement.
   */
  isRinging: boolean;
}

export function InboxCard({
  item,
  selected,
  disabled,
  onSelect,
  projectHandle,
  space = null,
  isRinging,
}: InboxCardProps) {
  const { t } = useTranslation('inbox');
  const acceptMut = useAcceptIssue();
  const { pathname } = useLocation();
  const accepting = acceptMut.isPending;
  // Truthy check — backend omits `acceptedAt` for unaccepted items
  // (JSON omitempty), so === null fails on the wire shape. Optimistic
  // patch sets a non-empty ISO string. Both paths covered by truthy.
  const accepted = !!item.acceptedAt;

  const onClickAccept = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (accepting || disabled || accepted) return;
    // R12 — the card accepted here stays dimmed in place until the route
    // changes, through every re-read of Inbox (`inboxAcceptedRetention.ts`).
    acceptMut.mutate({ id: item.id, expectedVersion: item.version, retainOnRoute: pathname });
  };

  const creator = item.createdByUsername || '?';
  const footerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const fits = useFitsWidth(footerRef, measureRef);
  const meta = (
    <>
      {t('card.from')} <span className="inbox-meta-creator">{creator}</span>
      {' · '}
      <TimeLabel iso={item.createdAt} />
    </>
  );

  return (
    <div
      className={[
        'inbox-card',
        selected ? 'selected' : '',
        accepted ? 'dimmed' : '',
        isRinging ? 'reminder-ringing' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <button
        type="button"
        className="inbox-card-body"
        aria-label={t('card.openIssue', { id: item.id, title: item.title })}
        disabled={disabled}
        onClick={onSelect}
      >
        {/* sk-285.7.2.47 — row 1 is `project id`, ONE line, exactly as
            `Sk Queues.dc.html` draws the card's first child. The handle
            used to be an eyebrow on a line of its own with the id a line
            below among the chips, which split one piece of information
            (which task, in which project) across two rows and pushed the
            title — the thing a reader scans for — down to row three. */}
        <div className="inbox-card-header">
          {space ? (
            <QueueSpaceLabel space={space} className="inbox-card-project" />
          ) : projectHandle && projectHandle !== '?' ? (
            <span className="inbox-card-project">{projectHandle}</span>
          ) : null}
          <IssueIDBadge id={item.id} />
        </div>
        <div className="inbox-card-title" title={item.title}>
          {item.title}
        </div>
        {/* Row 3 — the chips sit BELOW the title in the artboard. They
            were above it, which gave every card a row of small coloured
            pills before its subject. */}
        <div className="inbox-card-chips">
          <Attribute kind="priority" value={item.priority} />
          <Attribute kind="type" value={item.type} />
        </div>
      </button>
      {/* sk-285.7.2.47 — row 4, and the fix for the overlap.
          The meta text used to live INSIDE the body button while the
          action sat in an absolutely-positioned sibling, with the gap
          between them held open by a hand-written `padding-bottom` that
          was smaller than the 36px button. Measured: the date's box and
          the button's box intersected by 73.0 × 7.2 px, and the button
          paints `--surface`, so the bottom of the date was simply
          painted over.
          The artboard draws both as flex children of ONE row with
          `space-between`, which is what this is now: two in-flow
          siblings in a single flex line cannot intersect, so the defect
          is removed by construction rather than by a reserved gap that
          has to be kept in step with the button by hand. */}
      <div className={`inbox-card-footer${fits ? '' : ' compact'}`} ref={footerRef}>
        <span className="inbox-card-meta">{meta}</span>
        {accepted ? (
          // Static "accepted" indicator instead of an action button —
          // mirrors the Mentions pattern where mark-read leaves a
          // dimmed card visible until the next refetch drops it.
          <span
            className="inbox-accepted-badge"
            aria-label={t('card.acceptedAria', { id: item.id })}
          >
            {/* sk-285.7.2.46 — the same ✓ the button next door carries,
                drawn the same way. Its literal came out of the string
                for the same reason the button's did. */}
            <IconCheck size={16} stroke={1.75} aria-hidden />
            {fits ? t('card.accepted') : null}
          </span>
        ) : (
          <SkeinTooltip content={t('card.acceptTitle')} position="top">
            <button
              type="button"
              className={`inbox-accept-btn${fits ? '' : ' compact'}`}
              disabled={accepting || disabled}
              aria-label={t('card.acceptAria', { id: item.id })}
              onClick={onClickAccept}
            >
              {/* handoff §6 — the check glyph, 16px (the inline-in-text step
                  of §8's 16/20/24), painted `--ok` by `.inbox-accept-icon`.
                  Decorative: the button's own accessible name already says
                  what it does, so a second announcement would be noise. */}
              <IconCheck className="inbox-accept-icon" size={16} stroke={1.75} aria-hidden />
              {fits ? (accepting ? '…' : t('card.accept')) : null}
            </button>
          </SkeinTooltip>
        )}
        {/* The full row, laid out on one line but never shown: its width
            is what the footer needs to keep the labelled button. */}
        <span className="inbox-card-footer-measure" ref={measureRef} aria-hidden="true">
          <span className="inbox-card-meta">{meta}</span>
          <span className="inbox-accept-btn">
            <IconCheck size={16} stroke={1.75} aria-hidden />
            {t('card.accept')}
          </span>
        </span>
      </div>
    </div>
  );
}
