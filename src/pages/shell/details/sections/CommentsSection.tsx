import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconCheck } from '@tabler/icons-react';
import {
  CommentsThread,
  splitCommentsByFilter,
  useIssueComments,
} from '../../../../components/CommentsThread';
import { Section } from '../Section';

export interface CommentsSectionProps {
  projectHandle: string;
  issueId: string;
  count: number;
}

/**
 * Comments section — artboard 4d.
 *
 * The heading carries the title, the count and, right-aligned, the two
 * author-kind chips; the body is `CommentsThread`. Both read the SAME
 * TanStack entry (`useIssueComments`), so the counts on the chips and
 * the rows under them cannot disagree and only one request is made.
 *
 * ─── Why the filter state lives here and not in the thread ─────────
 *
 * It used to live in `CommentsThread`, which rendered the chips above
 * the list. Artboard 4d puts them on the heading row — the slot
 * `Section` already has as `headerAction` — and a child cannot render
 * into its parent's heading. So the state moved up to the component
 * that owns both, which is also the plain React answer: the chips and
 * the list are two views of one filter.
 *
 * The chips are the product's `.filter-chip`. They were a class of
 * their own when this section was drawn, because decision 2 of the epic
 * held the product-wide move to the new shape back to sk-414.7; that
 * task has since made the move, so there is one filter chip in the
 * product and this is it. Only the wrapper is the thread's own.
 */
export function CommentsSection({ projectHandle, issueId, count }: CommentsSectionProps) {
  const { t } = useTranslation(['details', 'comments']);
  // sk-16 — both on = show everything. Local state by design: this is
  // per-screen ephemeral UI, not a global lens like `outboxMode`.
  const [showHumans, setShowHumans] = useState(true);
  const [showAgents, setShowAgents] = useState(true);

  const commentsQuery = useIssueComments(projectHandle, issueId);
  const { all, humansCount, agentsCount } = splitCommentsByFilter(
    commentsQuery.data,
    showHumans,
    showAgents,
  );

  const resetFilter = () => {
    setShowHumans(true);
    setShowAgents(true);
  };

  // No thread, no chips: a filter over nothing is a control that can
  // only disappoint. It comes back the moment the first comment lands.
  const filterChips =
    all.length > 0 ? (
      // sk-16 review fix W1/W8 — the explanatory sentence lives in
      // `aria-label` (mirroring `title`) so keyboard-only and touch
      // users get the context mouse-hover users do; `title` stays as
      // the hover affordance for desktop.
      <span className="comment-filter-chips" role="group" aria-label={t('comments:filterAria')}>
        <FilterChip
          on={showHumans}
          label={t('comments:humans')}
          count={humansCount}
          ariaLabel={t('comments:humansAria', {
            suffix: humansCount > 0 ? ` (${humansCount})` : '',
          })}
          title={t('comments:humansTitle')}
          onToggle={() => setShowHumans((v) => !v)}
        />
        <FilterChip
          on={showAgents}
          label={t('comments:agents')}
          count={agentsCount}
          ariaLabel={t('comments:agentsAria', {
            suffix: agentsCount > 0 ? ` (${agentsCount})` : '',
          })}
          title={t('comments:agentsTitle')}
          onToggle={() => setShowAgents((v) => !v)}
        />
      </span>
    ) : undefined;

  return (
    <Section
      title={t('details:sectionsMore.comments')}
      count={count}
      // sk-285.7.2.56 (audit D2B-8) — §6 / reference `1b` write the empty
      // heading as «Comments · none yet». The emptiness used to be a
      // SENTENCE under the heading, and it opened with `> ` — a command
      // prompt, the same terminal dialect the redesign removed from
      // `[ post ]`. Comments cannot use the collapsed-section form that
      // states «none» for every other section, because its body has to
      // stay mounted for the composer; the heading is where it fits.
      note={count === 0 ? `· ${t('comments:none')}` : undefined}
      headerAction={filterChips}
    >
      <CommentsThread
        projectId={projectHandle}
        issueId={issueId}
        showHumans={showHumans}
        showAgents={showAgents}
        onResetFilter={resetFilter}
      />
    </Section>
  );
}

/**
 * One author-kind chip.
 *
 * `aria-pressed` is the state — it is what tells a screen reader this
 * is a toggle rather than a link, and the stylesheet paints off the
 * same attribute so the two cannot drift. The check glyph is the
 * second channel the canvas draws for the on state (outline, tint, ink
 * and glyph), which is what keeps it readable in greyscale. It carries
 * `.filter-chip-check` because the chip closes its leading padding by
 * the glyph's account — see the sk-414.7 block in `index.css`.
 */
function FilterChip({
  on,
  label,
  count,
  ariaLabel,
  title,
  onToggle,
}: {
  on: boolean;
  label: string;
  count: number;
  ariaLabel: string;
  title: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="filter-chip"
      aria-pressed={on}
      aria-label={ariaLabel}
      title={title}
      onClick={onToggle}
    >
      {on ? <IconCheck className="filter-chip-check" size={16} stroke={2} aria-hidden /> : null}
      {label}
      <span className="filter-chip-count">{count}</span>
    </button>
  );
}
