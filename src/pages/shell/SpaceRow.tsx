import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { IconChevronDown, IconChevronRight, IconSettings } from '@tabler/icons-react';
import type { MySpace } from '../../api/spaces';
import { spaceHandle } from '../../lib/shellUrlState';

/**
 * sk-674.18 T051 — one SPACE row of the Projects column (screens 1.1,
 * plan 5.1). Drawn only when the person has two spaces or more; with one
 * (and with none — an external user) the column is as it was.
 *
 * In the style of the «All projects» row and on its level, so it reads
 * apart from the project rows below it; the projects of the space follow
 * WITHOUT an extra indent. The row carries the space's name and ⚙ —
 * nothing else: no task counts (plan 5.1), so the `outboxMode` lens has
 * nothing to narrow here.
 *
 * The fold caret sits in the slot of the project rows' component caret
 * (`ProjectRow.tsx#ProjectRow`): a real `<button>` beside the body, never
 * inside it, so folding a space does not pick it — the same split a
 * project row makes. Any space folds, "Personal" included (K9).
 *
 * The body picks the space as the place `/spaces/<id>-<slug>`; ⚙ leads to
 * the space settings (screens 2.3). "Personal" has no ⚙ — there is nothing
 * to set there.
 */
export interface SpaceRowProps {
  space: MySpace;
  collapsed: boolean;
  /** Flip the fold — the caller records it as the person's explicit choice. */
  onToggleCollapsed: () => void;
  /** The space is the selected place. */
  selected: boolean;
  onSelect: () => void;
}

export function SpaceRow({ space, collapsed, onToggleCollapsed, selected, onSelect }: SpaceRowProps) {
  const { t } = useTranslation('projects');
  const name = space.name;
  return (
    <div
      className={`project-row-shell project-row-shell-pseudo space-row-shell${selected ? ' selected' : ''}`}
    >
      <button
        type="button"
        className="project-collapse-toggle"
        aria-expanded={!collapsed}
        aria-label={collapsed ? t('expandSpace', { name }) : t('collapseSpace', { name })}
        onClick={onToggleCollapsed}
      >
        {collapsed ? (
          <IconChevronRight size={16} stroke={1.75} aria-hidden />
        ) : (
          <IconChevronDown size={16} stroke={1.75} aria-hidden />
        )}
      </button>
      <button
        type="button"
        className="project-row-body project-row-pseudo"
        aria-label={t('selectSpace', { name })}
        aria-pressed={selected}
        onClick={onSelect}
      >
        <span className="project-row-name">{name}</span>
      </button>
      {space.kind === 'personal' ? null : (
        <Link
          className="space-row-settings"
          to={`/settings/spaces/${spaceHandle(space)}`}
          aria-label={t('spaceSettings', { name })}
        >
          <IconSettings size={16} stroke={1.75} aria-hidden />
        </Link>
      )}
    </div>
  );
}
