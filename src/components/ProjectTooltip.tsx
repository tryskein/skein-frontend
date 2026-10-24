import { useQuery } from '@tanstack/react-query';
import { getProject, type Project, type ProjectListItem } from '../api/projects';
import { useTranslation } from 'react-i18next';
import { TimeLabel } from './TimeLabel';
import { MarkdownView } from '../pages/shell/details/MarkdownView';

/**
 * Hover tooltip for the ⓘ of a project row in the Projects column.
 *
 * sk-551.15 — it used to open on the WHOLE row, 400px wide, and repeat
 * what the row already shows (id prefix, open/blocked counts), plus
 * created/updated dates and member/component/repo counters nobody picks a
 * project by, and the raw description in full (markdown unrendered). The
 * owner called it a large uninformative popup in the way. Now it opens
 * only on the row's ⓘ and carries just what the row does not:
 *   - the description, rendered as markdown and clamped to a few lines;
 *   - every status count on ONE line;
 *   - one line about me: assigned · created · last activity.
 * Repo links and the full description are left out on purpose: the
 * tooltip layer is `pointer-events: none`, so links could never be
 * followed, and a separate «About» click panel was dropped by the owner
 * as noise.
 *
 * First paint uses ONLY the lean `ProjectListItem` (open / in progress /
 * blocked) so the zero-delay tooltip never shows empty; `getProject(id)`
 * backfills the rest in the background, cached 60s.
 *
 * NOTE (outboxMode): the counts are INTENTIONALLY UNSCOPED — a
 * whole-project overview, distinct from the ProjectRow counts which flip
 * to the myOutbox*Count fields under outboxMode (pre-existing, kept).
 */
export interface ProjectTooltipProps {
  project: ProjectListItem;
}

function useProjectDetail(projectId: string) {
  return useQuery<Project>({
    queryKey: ['project', 'detail', projectId],
    queryFn: () => getProject(projectId),
    staleTime: 60_000,
  });
}

export function ProjectTooltip({ project }: ProjectTooltipProps) {
  const { t } = useTranslation('projects');
  const detail = useProjectDetail(project.id).data;
  const s = detail?.stats;

  const counts: Array<[number, string]> = [
    [s?.open ?? project.openCount, t('tooltip.open')],
    [s?.inProgress ?? project.inProgressCount, t('tooltip.inProgress')],
    [s?.blocked ?? project.blockedCount, t('tooltip.blocked')],
  ];
  if (s) {
    counts.push([s.deferred, t('tooltip.deferred')]);
    if ((s.standingCount ?? 0) > 0) counts.push([s.standingCount ?? 0, t('tooltip.standing')]);
    counts.push([s.closed, t('tooltip.closed')]);
  }

  return (
    <div className="project-tooltip">
      <h4>{project.name}</h4>
      {project.description ? (
        <div className="project-tooltip-desc">
          <MarkdownView text={project.description} />
        </div>
      ) : null}
      <p className="project-tooltip-line">
        {counts.map(([n, label], i) => (
          <span key={label}>
            {i > 0 ? ' · ' : null}
            <span className="project-tooltip-num">{n}</span> {label}
          </span>
        ))}
      </p>
      {s ? (
        <p className="project-tooltip-line project-tooltip-me">
          {t('tooltip.me')}{' '}
          <span className="project-tooltip-num">{s.myAssigned}</span> {t('tooltip.assignedToMe')}
          {' · '}
          <span className="project-tooltip-num">{s.myCreated}</span> {t('tooltip.createdByMe')}
          {s.lastActivity ? (
            <>
              {' · '}
              {t('tooltip.lastActivity')} <TimeLabel iso={s.lastActivity} />
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
