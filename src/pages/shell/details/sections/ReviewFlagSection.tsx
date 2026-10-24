import { Switch } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import type { IssueDetail } from '../../../../api/issues';
import { Section } from '../Section';

export interface ReviewFlagSectionProps {
  issue: IssueDetail;
  /**
   * Whether the reader created this issue. The ONLY gate on this whole
   * section (INV-2 / INV-4): the flag is the author's private bookkeeping,
   * invisible and unchangeable for everyone else — the assignee, a previous
   * assignee and an admin alike.
   *
   * Derived from `createdBy`, not from whether the review keys arrived: the
   * server omits them for non-authors, so absence would be indistinguishable
   * from an author whose flag is simply unset.
   */
  isAuthor: boolean;
  /** Flip the flag. */
  onChange: (next: boolean) => void;
  /** A write is in flight. */
  pending?: boolean;
}

/**
 * sk-303.14 (T028, US-3) — «Needs review» on one issue.
 *
 * Its own section rather than a control inside the close block, because the
 * flag is meaningful on an issue that is not closed yet: US-3 lets the
 * author clear it on an EXISTING task, closed or not, and clearing it before
 * the close is how the result never enters the unreviewed set in the first
 * place. The MARK is the part that belongs to the close block and only
 * exists there (row 98).
 *
 * Turning the flag off removes the issue from the unreviewed set
 * immediately, in all three of its manifestations, and does NOT leave a
 * review mark behind (INV-12 — clearing the flag is not "I read it").
 * Turning it back on brings the issue back.
 *
 * Nothing about this is visible to the assignee: the change moves neither
 * the version nor the modification stamp and raises no notification, so
 * there is no side channel through which they could infer it (INV-2).
 */
export function ReviewFlagSection({
  issue,
  isAuthor,
  onChange,
  pending = false,
}: ReviewFlagSectionProps) {
  // sk-398 — the hook goes BEFORE the early return: React counts hook calls
  // by order, and the «not the author» branch would skip it, breaking the
  // component on the very first switch of the card from someone else's to its own.
  const { t } = useTranslation('review');

  if (!isAuthor) return null;

  // The server sends the key to the author always — `false` included, since
  // `omitempty` on a pointer drops only nil. Treating a missing key as "on"
  // would silently promise a set membership the server never granted, so an
  // absent value reads as off.
  const required = issue.reviewRequired === true;

  return (
    <Section title={t('flag.title')} className="review-flag-section">
      <Switch
        checked={required}
        disabled={pending}
        onChange={(e) => onChange(e.currentTarget.checked)}
        label={t('flag.label')}
        data-testid="review-required-switch"
        description={t(required ? 'flag.onDescription' : 'flag.offDescription')}
      />
    </Section>
  );
}
