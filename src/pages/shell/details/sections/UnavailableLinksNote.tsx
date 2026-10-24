/**
 * sk-479 (api contract sk-423) — the card line about links to issues from
 * unavailable projects.
 *
 * Placed in the properties area right after the «Blocked» block
 * (`BlockedBySection`), as a separate element and not as its row: a link to
 * an unavailable issue no longer means «blocks» (the maintainers' decision on
 * sk-423, option B), and inside the blockers block it would read exactly so. That is
 * why the tone is not red like the blockers header but muted — like
 * the muted segments of the properties row; the lock is the same «no access»
 * icon as for an unavailable parent and the hidden rows of «Dependencies».
 *
 * Two parts: the count («Linked to N issues in unavailable projects») and
 * an explanation of why the issue may still be not ready for work — the status
 * of those issues is hidden from the reader, while readiness counts all blockers.
 *
 * When it is drawn is decided by `unavailableLinksToShow` from
 * `lib/unavailableLinks.ts`: the number is above zero and the issue is not closed and not
 * standing. With the old api (no field) — nothing. It sits calmly next to a blocked
 * issue: visible blockers in their block, links here.
 *
 * Display only; the «Delegated» lens does not touch it — the number
 * belongs to the issue itself.
 */

import { useTranslation } from 'react-i18next';
import { IconLock } from '@tabler/icons-react';
import type { IssueDetail } from '../../../../api/issues';
import { unavailableLinksToShow } from '../../../../lib/unavailableLinks';

export function UnavailableLinksNote({ issue }: { issue: IssueDetail }) {
  const { t } = useTranslation('details');
  const count = unavailableLinksToShow(issue.status, issue.unavailableBlockingLinks);
  if (count === 0) return null;
  return (
    <div className="unavailable-links-note">
      <div className="unavailable-links-note-count">
        {/* 16 — the product's icon scale; the word carries the meaning, the icon does not. */}
        <IconLock size={16} stroke={1.75} aria-hidden />
        {t('unavailableLinks.note', { count })}
      </div>
      <div className="unavailable-links-note-explain">{t('unavailableLinks.explain')}</div>
    </div>
  );
}
