/**
 * sk-47.2 — blob-mode result panel for the Tasks column.
 *
 * Rendered INSTEAD of the normal typed-search board while blob mode is
 * active (the user pasted text containing ≥1 issue code). Two parts:
 *
 *   1. A chips header:
 *      - "extracted N codes" summary + an × to leave blob mode;
 *      - one chip per requested code — FOUND chips are clickable and
 *        navigate to `/issues/{id}`; NOT-FOUND chips are dimmed/muted and
 *        inert (the code was nonexistent or not visible to the caller).
 *   2. The matched task cards below, reusing the existing `TaskCard`
 *      renderer (so they look identical to normal board rows). Selection /
 *      project-handle resolution flow through the column's `onSelect`, the
 *      same path the cards-view list uses.
 *
 * All colours come from theme tokens — found chips lean on the brand /
 * accent tokens, not-found chips on `--ink-2` — so custom themes pick up
 * the styling without hardcoded values.
 */

import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IconX, IconQuestionMark, IconBinaryTree2 } from '@tabler/icons-react';
import { TaskCard } from './TaskCard';
import { useRingingIssueIds } from '../../lib/useReminders';
import type { BlobChip } from '../../lib/useBlobMode';
import type { IssueSummary } from '../../api/issues';

export interface BlobCodesResultProps {
  /** Chip descriptors in first-seen (paste) order. */
  chips: BlobChip[];
  /** Matched rows (found subset) mapped to IssueSummary for TaskCard. */
  matched: IssueSummary[];
  foundCount: number;
  notFoundCount: number;
  /** Total requested codes (= chips.length) — drives the "extracted N" copy. */
  totalCount: number;
  isLoading: boolean;
  error: unknown;
  /** Currently-selected issue id (for the card's selected highlight). */
  selectedIssueId: string | null;
  /** id → name lookup for component segments (may be empty for cross-project). */
  componentNames: Map<string, string>;
  /**
   * The list's «display properties», packed by `listCardFieldsMask` —
   * the same mask the cards body hands its rows. A number rather than
   * the stored `ReadonlySet` because `TaskCard` is `memo()`d; see the
   * `fields` prop doc there.
   */
  fields: number;
  /** Open a matched task in the Details column (same path as the cards list). */
  onSelect: (item: IssueSummary) => void;
  /** Leave blob mode (the × button). */
  onExit: () => void;
  /**
   * sk-98 — expand a found epic into a rooted Tree view (epic + its
   * parent-child descendants). Only rendered on `type === 'epic'` rows
   * that carry a real `projectId` (blob `SearchItem`s map projectId via
   * `searchItemToSummary`, which falls back to '' for project entities —
   * never reachable here since blob lookups are kind=['issue']).
   */
  onExpandEpic: (anchor: { id: string; projectId: string }) => void;
}

export function BlobCodesResult({
  chips,
  matched,
  foundCount,
  notFoundCount,
  totalCount,
  isLoading,
  error,
  selectedIssueId,
  componentNames,
  fields,
  onSelect,
  onExit,
  onExpandEpic,
}: BlobCodesResultProps) {
  const { t } = useTranslation('tasks');
  const navigate = useNavigate();

  // sk-62.2 / sk-194.5.2.8.5 — one ringing-set read for the whole result
  // list; each card gets a `boolean`. Same rule as the cards list in
  // TasksBody: the hook must NOT live inside `TaskCard` (one QueryObserver +
  // two re-installed timers per row) and the prop must stay a primitive so
  // `memo(TaskCard)` keeps holding.
  const ringingIssueIds = useRingingIssueIds();

  // Cross-project chip navigation: the bare `/issues/{id}` route is the
  // cross-project issue shape (App.tsx). Pasted codes span projects, so we
  // route there directly rather than threading a per-code project handle.
  const openCode = (id: string) => {
    navigate(`/issues/${encodeURIComponent(id)}`);
  };

  return (
    <div className="col-body tasks-body blob-result">
      <div className="blob-result-header">
        <div className="blob-result-summary">
          <span className="blob-result-count">
            {t('blob.extracted', { count: totalCount })}
          </span>
          {notFoundCount > 0 ? (
            <span className="blob-result-notfound-summary">
              {t('blob.foundSummary', {
                found: foundCount,
                notFound: notFoundCount,
              })}
            </span>
          ) : null}
          <button
            type="button"
            className="blob-result-close"
            aria-label={t('blob.exitAria')}
            title={t('blob.exitAria')}
            onClick={onExit}
          >
            <IconX size={20} stroke={1.5} aria-hidden />
          </button>
        </div>
        <div className="blob-result-chips" role="list" aria-label={t('blob.chipsAria')}>
          {chips.map((chip) =>
            chip.found ? (
              <button
                key={chip.code}
                type="button"
                role="listitem"
                className="blob-chip blob-chip-found"
                title={chip.item?.title ?? chip.code}
                aria-label={
                  chip.item?.title
                    ? t('blob.openChipWithTitle', {
                        code: chip.code,
                        title: chip.item.title,
                      })
                    : t('blob.openChip', { code: chip.code })
                }
                onClick={() => openCode(chip.code)}
              >
                {chip.code}
              </button>
            ) : (
              <span
                key={chip.code}
                role="listitem"
                className="blob-chip blob-chip-notfound"
                title={t('blob.notFoundTitle')}
                aria-label={t('blob.notFoundAria', { code: chip.code })}
              >
                {/* Icon + strikethrough = non-colour status cue (WCAG 1.4.1
                    + CLAUDE_DEV "not by color alone"): the dim/dashed/line-through
                    styling reads as "absent" even with colour removed. */}
                <IconQuestionMark
                  size={16}
                  stroke={2}
                  aria-hidden
                  className="blob-chip-notfound-icon"
                />
                {chip.code}
              </span>
            ),
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="col-empty">{t('blob.resolving')}</div>
      ) : error ? (
        <div className="col-empty col-error">{t('blob.resolveFailed')}</div>
      ) : matched.length === 0 ? (
        <div className="col-empty">
          {totalCount === 0 ? t('blob.emptyNoCodes') : t('blob.emptyNoMatches')}
        </div>
      ) : (
        matched.map((item) => (
          <div key={item.id} className="blob-matched-row">
            <TaskCard
              item={item}
              selected={selectedIssueId === item.id}
              // Blob rows are an exact id resolution, not a text search — no
              // term to highlight.
              searchQuery=""
              componentNames={componentNames}
              // The same list «display properties» the cards body honours
              // — blob rows ARE task cards, and a preference that held on
              // one list but not the other would read as a bug.
              fields={fields}
              // Blob results are cross-project by nature, so the handle
              // under the title is the only thing that places a row.
              // Map lookup only — an id-derived prefix would lie on
              // renamed projects (see TaskCard's prop doc).
              // sk-194.5.2.8.5 — boolean off the single ringing set above.
              isRinging={ringingIssueIds.has(item.id)}
              // sk-194.5.2.8.2 — pass the caller's handler through as-is;
              // TaskCard supplies the row. A per-row thunk here would defeat
              // memo(TaskCard).
              onSelect={onSelect}
            />
            {/* sk-98 — found-epic affordance: drill into a rooted Tree view.
                Gate on `type === 'epic'` ONLY (blob SearchItems never carry
                epicProgress) plus a real projectId (the layered-tree endpoint
                is project-scoped, so '' would yield a dead query). */}
            {item.type === 'epic' && item.projectId !== '' ? (
              <button
                type="button"
                className="blob-epic-expand"
                title={t('blob.expandEpicTitle')}
                aria-label={t('blob.expandEpicAria', { id: item.id })}
                onClick={() =>
                  onExpandEpic({ id: item.id, projectId: item.projectId })
                }
              >
                <IconBinaryTree2 size={16} stroke={1.6} aria-hidden />
                {t('blob.expandEpic')}
              </button>
            ) : null}
          </div>
        ))
      )}
    </div>
  );
}
