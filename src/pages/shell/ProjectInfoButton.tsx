import { IconInfoCircle } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { SkeinTooltip } from '../../components/SkeinTooltip';
import { ProjectTooltip } from '../../components/ProjectTooltip';
import type { ProjectListItem } from '../../api/projects';

/**
 * sk-551.15 — the ⓘ at the end of a project row: the only anchor of the
 * compact project card (`ProjectTooltip`), shown instantly on hover and
 * on keyboard focus (the org's 0 ms rule). The row itself no longer pops
 * anything up, so moving the mouse down the list is quiet.
 *
 * Not a button: there is nothing to press. A click panel with the full
 * description was tried and dropped by the owner as noise. It is
 * focusable (`tabIndex=0`) so the card is reachable from the keyboard,
 * and named for assistive tech by its label.
 */
export function ProjectInfoButton({ project, name }: { project: ProjectListItem; name: string }) {
  const { t } = useTranslation('projects');
  return (
    <SkeinTooltip content={<ProjectTooltip project={project} />} position="right-start" width={320}>
      <span className="project-row-info" role="img" tabIndex={0} aria-label={t('about.open', { name })}>
        <IconInfoCircle size={16} stroke={1.75} aria-hidden />
      </span>
    </SkeinTooltip>
  );
}
