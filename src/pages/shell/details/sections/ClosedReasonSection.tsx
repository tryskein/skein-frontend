import { useTranslation } from 'react-i18next';
import { IconCheck, IconEye } from '@tabler/icons-react';
import type { IssueDetail } from '../../../../api/issues';
import { TimeLabel } from '../../../../components/TimeLabel';
import { MarkdownView } from '../MarkdownView';

export interface ClosedReasonSectionProps {
  issue: IssueDetail;
  /**
   * Whether the reader created this issue. sk-303.14 (INV-4) — the review
   * mark belongs to the author and to nobody else; an admin is refused
   * exactly as an assignee is.
   *
   * Passed in rather than derived here from the review keys' presence: the
   * server omits those keys for non-authors, so their absence would ALSO be
   * how an author's unset flag looks. Authorship is a fact about
   * `createdBy`, and that is what this reads.
   */
  isAuthor?: boolean;
  /** Place the mark. Absent = the surface offers no mark (read-only host). */
  onMarkReviewed?: () => void;
  /** A mark is in flight — the button is disabled while it is. */
  marking?: boolean;
}

/**
 * sk-59 / sk-63 — the close block at the TOP of a closed issue, before
 * Description, as an accent callout.
 *
 * sk-303.14 (T028, Q2 → A2, matrix row 108) — IT RENDERS WHENEVER THE ISSUE
 * IS CLOSED, text or no text. It used to require a non-empty `closedReason`,
 * which was fine while the block was purely decorative and became a defect
 * the moment it carried an action: the author of a task closed with no
 * written reason would have had nowhere to mark the result read, and «where
 * the action lives» would have depended on whether somebody happened to type
 * a sentence. With no text there is still a heading and, for the author, the
 * action; the body is what disappears.
 *
 * Reopened issues show nothing at all — the block is about a close that is
 * currently in force, and that is also what keeps the mark off a reopened,
 * still-unclosed task (row 98): a mark there would read as «result read»
 * while the work is visibly running.
 *
 * The mark itself is offered only while the flag is ON. A cleared flag is
 * the author's own stated "I don't care" (US-1), the server refuses the
 * mark with `review_flag_cleared`, and offering a button that can only fail
 * is worse than offering none.
 */
export function ClosedReasonSection({
  issue,
  isAuthor = false,
  onMarkReviewed,
  marking = false,
}: ClosedReasonSectionProps) {
  const { t } = useTranslation('details');
  // AFTER the hook, not before it: the early return is conditional and a
  // hook behind it would change hook order between a closed and a reopened
  // issue. Same rule, opposite order from the incoming side, same result.
  if (issue.status !== 'closed') return null;

  const reason = issue.closedReason?.trim();
  const reviewed = Boolean(issue.reviewedAt);
  // Author-only, flag-on, not yet marked, and the host actually wired an
  // action. Everything else falls through to "no action".
  const canMark =
    isAuthor
    && issue.reviewRequired === true
    && !reviewed
    && onMarkReviewed !== undefined;

  return (
    <aside className="closed-reason-callout" aria-label={t('closedReason.aria')}>
      <div className="closed-reason-header">
        {/* sk-285.7.2.57 — the tick is DRAWN. It used to live inside the
            translation as `'✓ Closed'` (U+2713), i.e. a character whose
            weight and terminals come from whatever face the system
            resolves rather than from §8's stroke 1.75. 16px is the
            inline step, the one the panel's own labelled controls spend
            (`DetailsHeader`'s Accept / shortcut row). It inherits
            `--ok` from `.closed-reason-label` through `currentColor`,
            so the tick and the word stay one colour. */}
        <span className="closed-reason-label">
          <IconCheck size={16} stroke={1.75} aria-hidden />
          {t('closedReason.label')}
        </span>
        {issue.closedAt ? (
          <TimeLabel iso={issue.closedAt} className="closed-reason-when" />
        ) : null}
        {isAuthor && reviewed ? (
          /* sk-285.7.2.88 §8 — the mark is DRAWN, like the tick above it.
             The incoming side wrote it as `👁`, and an emoji is the one
             glyph that cannot take `stroke="currentColor"`: it would sit
             beside `IconCheck` in the same header at a different weight and
             a colour of the system's choosing. */
          <span className="closed-reason-reviewed" data-testid="review-mark-done">
            <IconEye size={16} stroke={1.75} aria-hidden />
            {t('closedReason.reviewed')}
            {issue.reviewedAt ? (
              <>
                {' · '}
                <TimeLabel iso={issue.reviewedAt} />
              </>
            ) : null}
          </span>
        ) : null}
        {canMark ? (
          <button
            type="button"
            className="closed-reason-review-btn"
            data-testid="mark-reviewed"
            disabled={marking}
            onClick={onMarkReviewed}
            title={t('closedReason.markTitle')}
          >
            {t('closedReason.markAction')}
          </button>
        ) : null}
      </div>
      {reason ? (
        <div className="closed-reason-body">
          <MarkdownView text={reason} mentions={issue.mentions} />
        </div>
      ) : null}
    </aside>
  );
}
