import { IconAlertCircle } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import type { Component } from '../../api/components';
import { useLayoutState } from '../../lib/useLayoutState';

/**
 * Component sub-row rendered as a child of a ProjectRow when the
 * project is expanded. Visually mirrors `<ProjectRow>` minus the caret
 * (components don't nest), shifted right by one indent step.
 *
 * Selecting a component drives the URL to
 * `/projects/{alias}/components/{cid}` via `setSelectedComponent`. A
 * second click on the already-selected row deselects it (URL drops
 * back to `/projects/{alias}`). The Tasks column responds to the
 * URL change via `useTasks(args.selectedComponent)` and renders the
 * `componentId={cid}`-filtered list.
 *
 * Counts are right-aligned, same shape as ProjectRow: `{open} /
 * {inProgress}`, plus an optional `{blocked}` + `alert-circle` chip in the accent-red
 * colour when blocked > 0.
 */
export interface ComponentRowProps {
  component: Component;
  selected: boolean;
  onSelect: () => void;
}

export function ComponentRow({ component, selected, onSelect }: ComponentRowProps) {
  const { t } = useTranslation('projects');
  // outboxMode + onMeMode are global header lens toggles (mutex
  // upstream). Same shape as ProjectRow — three counter columns swap
  // based on which lens is ON. sk-30.
  const { outboxMode, onMeMode } = useLayoutState();
  const counts = {
    open: onMeMode
      ? component.onMeOpenCount ?? 0
      : outboxMode
        ? component.myOutboxOpenCount
        : component.openCount,
    inProgress: onMeMode
      ? component.onMeInProgressCount ?? 0
      : outboxMode
        ? component.myOutboxInProgressCount
        : component.inProgressCount,
    blocked: onMeMode
      ? component.onMeBlockedCount ?? 0
      : outboxMode
        ? component.myOutboxBlockedCount
        : component.blockedCount,
    // sk-118 — Standing aggregate, flips with outboxMode per the CLAUDE.md
    // invariant (myOutboxStandingCount when the Delegated lens is on).
    // No On-me counterpart server-side → 0 there.
    standing: onMeMode
      ? 0
      : outboxMode
        ? component.myOutboxStandingCount ?? 0
        : component.standingCount ?? 0,
  };

  return (
    <div className={`component-row-shell${selected ? ' selected' : ''}`}>
      <span className="project-row-caret-spacer" aria-hidden />
      <button
        type="button"
        className="component-row-body"
        aria-label={
          selected
            ? t('deselectComponent', { name: component.name })
            : t('selectComponent', { name: component.name })
        }
        aria-pressed={selected}
        onClick={onSelect}
      >
        {/* sk-285.7 T027 — the decorative `·` bullet is gone. §6 marks a
            component row with a vertical 1px guide down the indent
            instead, which says the same thing AND connects the rows of
            one group; the bullet could only repeat it once per row. The
            guide is drawn by the caret-width spacer above (see
            `.component-row-shell > .project-row-caret-spacer`). */}
        <span className="component-row-name">{component.name}</span>
        <span
          className="component-row-counts"
          aria-label={
            counts.standing > 0
              ? t('countsAriaWithStanding', counts)
              : t('countsAria', counts)
          }
        >
          {counts.open} / {counts.inProgress}
          {counts.blocked > 0 ? (
            <span className="project-row-blocked-warn" aria-hidden>
              {counts.blocked}
              <IconAlertCircle size={16} stroke={1.75} aria-hidden />
            </span>
          ) : null}
          {counts.standing > 0 ? (
            <span
              className="project-row-standing"
              title={t('standingTitle', { count: counts.standing })}
              aria-hidden
            >
              {' '}∞{counts.standing}
            </span>
          ) : null}
        </span>
      </button>
    </div>
  );
}
