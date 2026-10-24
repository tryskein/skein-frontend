import { useTranslation } from 'react-i18next';
import { IssueIDBadge } from '../../components/IssueIDBadge';
import type { MySpace } from '../../api/spaces';
import { QueueSpaceLabel } from './InboxCard';
import { PersonStatusMark, personLabel } from '../../components/UserMention';
import { TimeLabel } from '../../components/TimeLabel';
import type { NotificationItem } from '../../api/notifications';

/**
 * sk-38 — one Mentions feed card.
 *
 * Renders a single `comment.mention` / `issue.mention` notification.
 * We deliberately do NOT cluster — each mention is a standalone act and
 * grouping would obscure individual @ events.
 *
 * Shape:
 *
 *   ┌─────────────────────────────────────────┐
 *   │ project-prefix                           │
 *   │ ccm-3 Demo: dep types showcase           │ ← issue id + title
 *   │                                           │
 *   │ alice mentioned you in description       │ ← actor + verb + field
 *   │ "...we should loop in @admin on this..." │ ← snippet (italic, dim)
 *   │                                   2h ago │ ← relative time
 *   └─────────────────────────────────────────┘
 *
 * Whole card is one <button> (no nested action buttons → no
 * button-in-button violation), full click opens the issue.
 *
 * Dimmed-stay UX. Clicking optimistically marks the notification read;
 * the card stays in the list at opacity 0.55, next refetch drops it.
 */
export interface MentionCardProps {
  item: NotificationItem;
  /** Display alias / idPrefix for the project the issue belongs to. */
  projectHandle: string;
  /**
   * sk-674.18 T054 — the space of the issue when the person has two
   * spaces or more: drawn instead of the project handle (screens 1.4–1.5).
   */
  space?: MySpace | null;
  selected: boolean;
  /**
   * True when the notification has been marked read. Renders the card
   * in a grayed-out state so the user keeps the context of what they
   * just dismissed; the next natural refetch drops it.
   */
  dimmed: boolean;
  /** Routes to the issue AND fires the mark-read mutation. */
  onSelect: () => void;
}

/**
 * Extract the field name from a backend-built mention `summary`.
 *
 * Backend produces:
 *   - comment.mention: `<actor> mentioned you in <id> (<title>)` — no
 *     field marker (a comment IS the field). We hard-code "comment".
 *   - issue.mention: `<actor> mentioned you in <id> (<title>) (<fields>)` —
 *     trailing parenthesised group is comma-separated field names. We
 *     return the FIRST (matches the backend's MentionContext column
 *     selection rule). When extraction fails, fall back to a generic
 *     "this issue" so the rendered line still makes sense.
 */
function mentionFieldFromItem(
  item: NotificationItem,
  labels: { comment: string; thisIssue: string },
): string {
  if (item.type === 'comment.mention') {
    return labels.comment;
  }
  // issue.mention — the field list lives in the LAST parenthesised
  // group of the summary. Pattern mirrors `formatEventLine`'s
  // `fieldListFromSummary` so the two views stay aligned.
  const m = item.summary.match(/\(([^()]+)\)\s*$/);
  if (!m) return labels.thisIssue;
  const inner = m[1].trim();
  if (!inner) return labels.thisIssue;
  // Reject sentences — field lists are comma-separated identifiers.
  if (!/^[a-z_][a-z0-9_]*(\s*,\s*[a-z_][a-z0-9_]*)*$/i.test(inner)) {
    return labels.thisIssue;
  }
  // First field — matches the backend's snippet-source pick.
  return inner.split(',')[0].trim();
}

/**
 * Wrap the backend snippet in display quotes. Backend already prepends
 * / appends "..." when content was trimmed; this just adds the outer
 * quote marks. Defensive: when the snippet is empty (missing source
 * body, hydration failure), we hide the line entirely.
 */
function formatSnippet(raw: string | undefined): string | null {
  if (!raw) return null;
  return `"${raw}"`;
}

export function MentionCard({
  item,
  projectHandle,
  space = null,
  selected,
  dimmed,
  onSelect,
}: MentionCardProps) {
  const { t } = useTranslation('inbox');
  // sk-674.18 T055 — a deleted actor reads as its pseudonym, a departed one
  // with "left" (screens 1.10, INV-18).
  const actorLabel = personLabel(item.actor.username || t('mentionCard.someone'), item.actor);
  const actor = actorLabel.text;
  const actorIsSystem = actor === 'system';
  // The field name is a BACKEND identifier (`description`, `notes`, …)
  // everywhere except the two fallbacks, which are prose and therefore
  // translated. Passing the two labels in keeps the parser pure.
  const field = mentionFieldFromItem(item, {
    comment: t('mentionCard.comment'),
    thisIssue: t('mentionCard.thisIssue'),
  });
  const snippet = formatSnippet(item.mentionContext);

  return (
    <button
      type="button"
      className={[
        'mention-card',
        selected ? 'selected' : '',
        dimmed ? 'dimmed' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-label={t('mentionCard.openIssue', {
        id: item.entity.id,
        title: item.entity.title,
        actor,
      })}
      onClick={onSelect}
    >
      {space ? (
        <QueueSpaceLabel space={space} className="task-card-project-eyebrow" />
      ) : projectHandle && projectHandle !== '?' ? (
        <div className="task-card-project-eyebrow">{projectHandle}</div>
      ) : null}
      <div className="mention-card-header">
        <IssueIDBadge id={item.entity.id} />
        <span className="mention-card-title" title={item.entity.title}>
          {item.entity.title}
        </span>
      </div>
      <div className="mention-card-event-line">
        <span
          className={[
            'outbox-ev-actor',
            actorIsSystem ? 'system' : '',
            // Review HTML-W1 — the gone look on the actor's name too.
            actorLabel.departed || actorLabel.deleted ? 'person-gone' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {actor}
          <PersonStatusMark label={actorLabel} />
        </span>
        {' '}
        <span className="outbox-ev-verb">{t('mentionCard.mentionedYouIn')}</span>
        {' '}
        <span className="outbox-ev-field">{field}</span>
      </div>
      {snippet ? (
        <div className="mention-card-snippet" title={snippet}>
          {snippet}
        </div>
      ) : null}
      <div className="mention-card-footer">
        <TimeLabel iso={item.createdAt} className="mention-card-time" />
      </div>
    </button>
  );
}
