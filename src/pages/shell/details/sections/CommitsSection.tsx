import { useTranslation } from 'react-i18next';
import type { CommitRef } from '../../../../api/issues';
import { formatRelative, formatTimestamp } from '../../../../components/format';
import { Section } from '../Section';

export interface CommitsSectionProps {
  commits: CommitRef[];
}

/**
 * Commits section — read-only list of commit refs attached to this
 * issue via `skein_close({commits: [...]})` (R3.4 commit-on-close).
 *
 * The IssueDetail wire shape carries `commitRefs[]`; we render one
 * row per commit. When the project's git provider integration was
 * able to resolve a `url`, the hash links out — otherwise we render
 * just the short hash.
 *
 * sk-285.6.2 — with no commits the section still SHOWS (the heading is
 * what tells a reader the field exists), but it costs one collapsed row
 * instead of a heading + a "0" chip + a sentence. Nothing is addable
 * here: commits are linked by `skein_close({commits})`, never from the
 * card, so the collapsed row carries no affordance.
 */
export function CommitsSection({ commits }: CommitsSectionProps) {
  const { t } = useTranslation('details');
  return (
    <Section
      title={t('sectionsMore.commits')}
      count={commits.length}
      empty={commits.length === 0}
    >
      <div className="commits-list">
        {commits.map((c) => (
          <CommitRow key={`${c.repoId}-${c.hash}`} commit={c} />
        ))}
      </div>
    </Section>
  );
}

function CommitRow({ commit }: { commit: CommitRef }) {
  const { t } = useTranslation('details');
  const shortHash = commit.hash.slice(0, 7);
  // Take only the first line of the commit message — the rest is
  // body and clutters the row. Guard for missing message.
  const subject = commit.message
    ? commit.message.split('\n')[0]
    : t('commits.noMessage');

  const hashEl = commit.url ? (
    <a
      href={commit.url}
      target="_blank"
      rel="noopener noreferrer"
      className="commit-hash"
      title={commit.hash}
    >
      {shortHash}
    </a>
  ) : (
    <span className="commit-hash" title={commit.hash}>
      {shortHash}
    </span>
  );

  return (
    <div className="commit-row">
      {hashEl}
      <span className="commit-subject" title={commit.message ?? ''}>
        {subject}
      </span>
      <span className="commit-meta" title={formatTimestamp(commit.linkedAt)}>
        {commit.author ? t('commits.by', { author: commit.author }) : null}
        {t('commits.linked', { when: formatRelative(commit.linkedAt) })}
      </span>
    </div>
  );
}
