/**
 * sk-421.1 T015 — the "Blocked" block of the issue card (US-5).
 *
 * Sits right under the properties row, inside the properties area. One
 * row per blocker, in the server's order, in the style of the
 * "Dependencies" rows: id · title · status.
 *
 * ─── When it is shown (INV-9) ─────────────────────────────────────────
 *
 * Exactly when the header outlines the status in red: the shared
 * `isDerivedBlocked(status, isBlocked)` from `components/Attribute.tsx` —
 * the server flag, and the issue is neither closed nor standing. The
 * header imports the same predicate, so the two cannot drift apart. On a
 * contradictory answer (INV-11): flag true with an empty list → the
 * header outlines, this block draws nothing; flag false with a non-empty
 * list → neither (the list is ignored).
 *
 * ─── A row ────────────────────────────────────────────────────────────
 *
 * - Hidden blocker (`redacted`, or no title) → lock + "unavailable"; no id,
 *   no title, no status, not clickable.
 * - Visible blocker whose project is known from the issue's dependency
 *   list (a `blocks` edge to it) → the id opens its card IN ITS project;
 *   the blocker may live in another visible project.
 * - Visible blocker whose project is not known (list not received,
 *   failed, or no such edge) → id, title and status as text, no link.
 *
 * Shows only (INV-1); the lens does not reach it (INV-8); its height is
 * deliberately not capped.
 */

import { useTranslation } from 'react-i18next';
import { IconLock } from '@tabler/icons-react';
import type { DependencyList } from '../../../../api/dependencies';
import type { BlockerRef, IssueDetail } from '../../../../api/issues';
import { isDerivedBlocked, statusChipText } from '../../../../components/Attribute';
import { SkeinTooltip } from '../../../../components/SkeinTooltip';
import type { UseIssueDetailResult } from '../../../../lib/useIssueDetail';
import { useNavigate } from 'react-router-dom';

export interface BlockedBySectionProps {
  issue: IssueDetail;
  /** The issue's dependency list — the only source of a blocker's project. */
  dependencies: DependencyList | undefined;
  /** Its load state; anything but `success` means «project unknown». */
  dependenciesStatus: UseIssueDetailResult['dependenciesStatus'];
}

export function BlockedBySection({
  issue,
  dependencies,
  dependenciesStatus,
}: BlockedBySectionProps) {
  const { t } = useTranslation('details');
  // Opening a blocker goes straight to `/projects/<its project>/issues/<id>`,
  // the path "Dependencies" uses — NOT `layout.setSelectedIssue`, which on a
  // component-filtered route keeps the CURRENT project's component segment
  // and would build «other project + this project's component» (review F-3).
  const navigate = useNavigate();

  if (!isDerivedBlocked(issue.status, issue.isBlocked)) return null;
  const blockers = issue.blockers ?? [];
  if (blockers.length === 0) return null;

  /**
   * Project of a visible blocker, from the outgoing edge to it — or
   * unknown. A blocker is the other side of an outgoing `blocks` OR
   * `waits-for` edge (spec "Terms"); the server fills `blockers[]` from
   * both, so both edge types must resolve the project.
   */
  const projectOf = (blockerId: string): string | null => {
    if (dependenciesStatus !== 'success' || !dependencies) return null;
    const edge = dependencies.outgoing.find(
      (e) =>
        (e.type === 'blocks' || e.type === 'waits-for')
        && e.toId === blockerId
        && !e.redacted
        && e.issue,
    );
    return edge?.issue?.projectId ?? null;
  };

  return (
    <div className="blocked-by">
      <div className="blocked-by-title" id={`blocked-by-${issue.id}`}>
        {t('blocked.title')}
      </div>
      <ul className="blocked-by-list" aria-labelledby={`blocked-by-${issue.id}`}>
        {blockers.map((blocker, i) => (
          <BlockerRow
            key={`${blocker.id}-${i}`}
            blocker={blocker}
            projectId={isHidden(blocker) ? null : projectOf(blocker.id)}
            onOpen={(id, projectId) =>
              navigate(
                `/projects/${encodeURIComponent(projectId)}/issues/${encodeURIComponent(id)}`,
              )
            }
          />
        ))}
      </ul>
    </div>
  );
}

/** A blocker the reader may not see: flagged, or its title is absent. */
function isHidden(blocker: BlockerRef): boolean {
  return !!blocker.redacted || blocker.title === undefined;
}

function BlockerRow({
  blocker,
  projectId,
  onOpen,
}: {
  blocker: BlockerRef;
  projectId: string | null;
  onOpen: (id: string, projectId: string) => void;
}) {
  const { t } = useTranslation('details');

  if (isHidden(blocker)) {
    return (
      <li className="detail-row detail-row--dep blocked-by-row blocked-by-row--hidden">
        <span className="detail-row-main">
          <span className="detail-row-line">
            <span className="dep-chip dep-chip--redacted">
              {/* 16 — the product icon scale, same padlock as the redacted
                  row in "Dependencies"; the word carries the state. */}
              <IconLock size={16} stroke={1.75} aria-hidden />
              {t('blocked.unavailable')}
            </span>
          </span>
        </span>
      </li>
    );
  }

  return (
    <li className="detail-row detail-row--dep blocked-by-row">
      <span className="detail-row-main">
        <span className="detail-row-line">
          {/* Real spaces between id, title and status: the gap is CSS, but
              a screen reader and the row's text need word boundaries
              ("sk-3 Title deferred", not "sk-3Titledeferred"). Inside the
              flex line a whitespace-only text node is not rendered. */}
          {projectId ? (
            <button
              type="button"
              className="detail-row-link"
              onClick={() => onOpen(blocker.id, projectId)}
            >
              {blocker.id}
            </button>
          ) : (
            <span className="blocked-by-id">{blocker.id}</span>
          )}{' '}
          {/* No native `title` anywhere in the row: the card's tooltips open
              instantly (SkeinTooltip), and a native one is delayed. The id is
              short and never cut, so it needs none; the title can be cut with
              an ellipsis, so its full text rides a SkeinTooltip — the same
              way the properties row carries a cut value. */}
          <SkeinTooltip content={blocker.title} position="bottom-start">
            <span className="detail-row-title blocked-by-row-title">{blocker.title}</span>
          </SkeinTooltip>
          {blocker.status ? (
            <>
              {' '}
              <span className="status-chip" data-status={blocker.status}>
                <span className="status-chip-dot" aria-hidden />
                {statusChipText(blocker.status)}
              </span>
            </>
          ) : null}
        </span>
      </span>
    </li>
  );
}
