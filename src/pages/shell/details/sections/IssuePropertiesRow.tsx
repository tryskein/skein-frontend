/**
 * sk-421.1 T014 — the issue card's properties row (US-1…US-4, US-6…US-8,
 * US-10, US-12, US-13).
 *
 * One line under the people chain that states what the server already
 * sends about the issue, as a list of WHOLE segments in a fixed order:
 *
 *   parent · labels · components · due · estimate · deferred until ·
 *   source · link · claim · accepted · started · updated
 *
 * ─── Shape ───────────────────────────────────────────────────────────
 *
 * - The container is a `role="list"`; every segment is its own
 *   `role="listitem"`, so a screen reader announces segments one by one.
 * - The « · » separator is a separate `aria-hidden` node BETWEEN two
 *   segments — never part of a segment's text, so a segment boundary is
 *   visible whatever the value contains (unlike `TaskCard`, whose
 *   separator is glued into the segment string).
 * - A segment exists only when its value does (INV-6): no empty segment,
 *   no dangling separator, no label without a value. "updated" always
 *   exists, so the row is on every card.
 * - Each segment names itself with a visible word; icons are decoration.
 * - The row wraps between segments; a segment does not wrap inside. A
 *   value that can be long (parent title, labels, component names, link)
 *   is truncated with an ellipsis and carries its full text in a
 *   `SkeinTooltip` (instant, like every tooltip on the card).
 * - Times use the native tooltip, like the close-reason time on the same
 *   card: the tail segments use `TimeLabel` as is (its relative label is
 *   deliberately English — accepted limit); the claim moment has its own
 *   `<time>` with both strings from `captureMoment` (UTC, stated).
 *
 * ─── What it never does ──────────────────────────────────────────────
 *
 * - Writes nothing (INV-1): no inputs, no mutations; the only action is
 *   opening the parent's card.
 * - Prints no component id and no MCP session id, in text or tooltips
 *   (INV-4): components show names from the directory or a bare count;
 *   the claim shows the holder's username or no name at all.
 * - Reads no lens (INV-8): `outboxMode` and the Tasks-column lenses do not
 *   change a single segment.
 */

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { IconLock } from '@tabler/icons-react';
import type { DependencyList } from '../../../../api/dependencies';
import type { IssueDetail } from '../../../../api/issues';
import { SkeinTooltip } from '../../../../components/SkeinTooltip';
import { TimeLabel } from '../../../../components/TimeLabel';
import {
  calendarDay,
  captureMoment,
  classifyExternalRef,
  isDayOver,
  sourceLabelKey,
  splitEstimate,
} from '../../../../lib/issueProperties';
import type { UseIssueDetailResult } from '../../../../lib/useIssueDetail';
import { useNavigate } from 'react-router-dom';
import { useProjectComponentNames } from '../../../../lib/useProjectComponentNames';
import { ForceUnlockButton } from '../ForceUnlockButton';

export interface IssuePropertiesRowProps {
  issue: IssueDetail;
  /**
   * The ISSUE's project — the panel passes `issue.projectId`, never the
   * project selected in the tree (US-3, INV-8). The component directory
   * is read for it.
   */
  projectId: string;
  /** The issue's dependency list, as `useIssueDetail` holds it. */
  dependencies: DependencyList | undefined;
  /** Load state of that list — tells «not yet» from «failed» (US-4). */
  dependenciesStatus: UseIssueDetailResult['dependenciesStatus'];
}

/** One rendered segment: a stable key for order plus its content. */
interface Segment {
  key: string;
  node: ReactNode;
  muted?: boolean;
  warn?: boolean;
}

/** Statuses on which an overdue due date is NOT highlighted (US-6). */
const NO_DUE_WARNING = new Set(['closed', 'standing']);

export function IssuePropertiesRow({
  issue,
  projectId,
  dependencies,
  dependenciesStatus,
}: IssuePropertiesRowProps) {
  const { t } = useTranslation('details');
  // Opening the parent goes straight to `/projects/<its project>/issues/<id>`,
  // the path «Dependencies» uses — NOT `layout.setSelectedIssue`, which on a
  // component-filtered route keeps the CURRENT project's component segment
  // and would build «other project + this project's component» (review F-3).
  const navigate = useNavigate();
  const componentNames = useProjectComponentNames(projectId, issue.componentIds);
  const now = new Date();

  const segments: Segment[] = [];

  // ── parent (US-4) ──
  // sk-674.18 T055 (decision of the lead on T009): skein-api no longer
  // serves the real id of a hidden issue — the hidden end of a redacted
  // edge is a synthetic `hidden-<k>`, and `parentIdCurrent` is absent when
  // the parent is unavailable. «Parent unavailable» therefore follows the
  // PRESENCE of a redacted parent-child edge, not a match on the parent id.
  const parentId = issue.parentIdCurrent ?? null;
  const hiddenParent =
    dependenciesStatus === 'success' && dependencies
      ? dependencies.outgoing.some((e) => e.type === 'parent-child' && e.redacted === true)
      : false;
  const unavailableParent = (): Segment => ({
    key: 'parent',
    node: (
      <>
        <Label>{t('properties.parent')}</Label>
        <span className="issue-props-value issue-props-unavailable">
          {/* 16 — the product icon scale, same
              padlock size as the redacted row in «Dependencies». */}
          <IconLock size={16} stroke={1.75} aria-hidden />
          {t('properties.parentUnavailable')}
        </span>
      </>
    ),
  });
  if (hiddenParent) {
    segments.push(unavailableParent());
  } else if (parentId) {
    if (dependenciesStatus === 'error') {
      segments.push({
        key: 'parent',
        node: (
          <>
            <Label>{t('properties.parent')}</Label>
            <span className="issue-props-value">{t('properties.parentFailed')}</span>
          </>
        ),
      });
    } else if (dependenciesStatus === 'success' && dependencies) {
      // Matched by the detail's CURRENT parent id — a stale edge to a
      // previous parent can still be in the list right after a re-parent.
      const edge = dependencies.outgoing.find(
        (e) => e.type === 'parent-child' && e.toId === parentId,
      );
      if (edge && edge.issue) {
        const parent = edge.issue;
        const full = `${parent.id} ${parent.title}`;
        segments.push({
          key: 'parent',
          node: (
            <>
              <Label>{t('properties.parent')}</Label>
              <Truncated full={full}>
                <button
                  type="button"
                  className="issue-props-value issue-props-link"
                  aria-label={t('properties.openParent', {
                    id: parent.id,
                    title: parent.title,
                  })}
                  onClick={() =>
                    navigate(
                      `/projects/${encodeURIComponent(parent.projectId)}/issues/${encodeURIComponent(parent.id)}`,
                    )
                  }
                >
                  {full}
                </button>
              </Truncated>
            </>
          ),
        });
      } else if (edge) {
        // An edge to the current parent without its card: unavailable.
        segments.push(unavailableParent());
      }
      // No edge to the current parent in the list → unknown → no segment.
    }
    // `pending` → unknown → no segment.
  }

  // ── labels (US-2) ──
  if (issue.labels.length > 0) {
    const text = issue.labels.join(', ');
    segments.push({
      key: 'labels',
      node: (
        <>
          <Label>{t('properties.labels')}</Label>
          <Truncated full={text}>
            <span className="issue-props-value">{text}</span>
          </Truncated>
        </>
      ),
    });
  }

  // ── components (US-3) ──
  if (issue.componentIds.length > 0) {
    if (componentNames.status === 'error') {
      segments.push({
        key: 'components',
        node: (
          <span className="issue-props-value">
            {t('properties.componentsCount', { count: issue.componentIds.length })}
          </span>
        ),
      });
    } else if (componentNames.status === 'success' && componentNames.data) {
      const map = componentNames.data;
      const known = issue.componentIds.flatMap((id) => {
        const entry = map.get(id);
        return entry ? [entry] : [];
      });
      const unknownCount = issue.componentIds.length - known.length;
      const full = [
        // Same spelling as the visible value: name, space, «archived» — one
        // mark, not «legacy archived» on the row and «legacy (archived)» in the tooltip.
        ...known.map((c) => (c.archived ? `${c.name} ${t('properties.archived')}` : c.name)),
        ...(unknownCount > 0 ? [t('properties.componentsMore', { count: unknownCount })] : []),
      ].join(', ');
      segments.push({
        key: 'components',
        node: (
          <>
            <Label>{t('properties.components')}</Label>
            <Truncated full={full}>
              <span className="issue-props-value">
                {known.map((c, i) => (
                  <span key={`${c.name}-${i}`}>
                    {i > 0 ? ', ' : null}
                    {c.name}
                    {c.archived ? (
                      <span className="issue-props-archived">
                        {' '}
                        {t('properties.archived')}
                      </span>
                    ) : null}
                  </span>
                ))}
                {unknownCount > 0 ? (
                  <span>
                    {known.length > 0 ? ', ' : null}
                    {t('properties.componentsMore', { count: unknownCount })}
                  </span>
                ) : null}
              </span>
            </Truncated>
          </>
        ),
      });
    }
    // `pending` → the directory is not here yet → no segment, never ids.
  }

  // ── due (US-6) ──
  const due = calendarDay(issue.dueAt);
  if (due) {
    segments.push({
      key: 'due',
      warn: isDayOver(issue.dueAt, now) && !NO_DUE_WARNING.has(issue.status),
      node: (
        <>
          <Label>{t('properties.due')}</Label>
          <span className="issue-props-value">{due}</span>
        </>
      ),
    });
  }

  // ── estimate (US-6) ──
  const estimate = splitEstimate(issue.estimatedMinutes);
  if (estimate) {
    const text =
      estimate.hours > 0 && estimate.minutes > 0
        ? t('properties.estimateHoursMinutes', {
            hours: estimate.hours,
            minutes: estimate.minutes,
          })
        : estimate.hours > 0
          ? t('properties.estimateHours', { hours: estimate.hours })
          : t('properties.estimateMinutes', { minutes: estimate.minutes });
    segments.push({
      key: 'estimate',
      node: (
        <>
          <Label>{t('properties.estimate')}</Label>
          <span className="issue-props-value">{text}</span>
        </>
      ),
    });
  }

  // ── deferred until (US-7) ──
  const deferUntil = calendarDay(issue.deferUntil);
  if (deferUntil) {
    segments.push({
      key: 'defer-until',
      warn: isDayOver(issue.deferUntil, now) && issue.status === 'deferred',
      node: (
        <>
          <Label>{t('properties.deferUntil')}</Label>
          <span className="issue-props-value">{deferUntil}</span>
        </>
      ),
    });
  }

  // ── source (US-10) ──
  const sourceKey = sourceLabelKey(issue.source);
  if (sourceKey) {
    const context = issue.sourceContext?.trim() ?? '';
    const value = <span className="issue-props-value">{t(sourceKey)}</span>;
    segments.push({
      key: 'source',
      node: (
        <>
          <Label>{t('properties.sourceLabel')}</Label>
          {context ? (
            <SkeinTooltip content={context} position="bottom-start">
              {value}
            </SkeinTooltip>
          ) : (
            value
          )}
        </>
      ),
    });
  }

  // ── external link (US-12, INV-5) ──
  const ref = classifyExternalRef(issue.externalRef);
  if (ref.kind !== 'none') {
    segments.push({
      key: 'external-ref',
      node: (
        <>
          <Label>{t('properties.link')}</Label>
          <Truncated full={ref.text}>
            {ref.kind === 'link' ? (
              <a
                className="issue-props-value issue-props-link"
                href={ref.href}
                target="_blank"
                rel="noopener noreferrer"
              >
                {ref.text}
              </a>
            ) : (
              <span className="issue-props-value">{ref.text}</span>
            )}
          </Truncated>
        </>
      ),
    });
  }

  // ── claim (US-8, INV-4) ──
  const claimed = !!(issue.lockedBy || issue.lockedByUsername);
  const moment = claimed ? captureMoment(issue.lockedAt, now) : null;
  if (moment) {
    const name = issue.lockedByUsername?.trim() || '';
    segments.push({
      key: 'claim',
      node: (
        <>
          <span className="issue-props-label">
            {name
              ? t('properties.claimedBy', { name })
              : t('properties.claimedNoName')}
          </span>{' '}
          <time
            className="issue-props-value"
            dateTime={issue.lockedAt ?? undefined}
            title={moment.full}
          >
            {moment.label}
          </time>
          {/* sk-674.18 T055 (US-16) — beside the claim mark itself. */}
          <ForceUnlockButton issue={issue} claimedAt={moment.label} />
        </>
      ),
    });
  }

  // ── accepted / started / updated (US-13), muted ──
  if (issue.acceptedAt) {
    const name = issue.acceptedByUsername?.trim() || '';
    segments.push({
      key: 'accepted',
      muted: true,
      node: (
        <>
          <Label>{t('properties.accepted')}</Label>
          {name ? (
            <>
              <span className="issue-props-value">{name}</span>{' '}
            </>
          ) : null}
          <TimeLabel iso={issue.acceptedAt} className="issue-props-time" />
        </>
      ),
    });
  }
  if (issue.startedAt) {
    segments.push({
      key: 'started',
      muted: true,
      node: (
        <>
          <Label>{t('properties.started')}</Label>
          <TimeLabel iso={issue.startedAt} className="issue-props-time" />
        </>
      ),
    });
  }
  segments.push({
    key: 'updated',
    muted: true,
    node: (
      <>
        <Label>{t('properties.updated')}</Label>
        <TimeLabel iso={issue.updatedAt} className="issue-props-time" />
      </>
    ),
  });

  return (
    <div className="issue-props" role="list" aria-label={t('properties.aria')}>
      {segments.map((seg, i) => (
        <SegmentSlot key={seg.key} segment={seg} first={i === 0} />
      ))}
    </div>
  );
}

function SegmentSlot({ segment, first }: { segment: Segment; first: boolean }) {
  const className = [
    'issue-props-seg',
    segment.muted ? 'issue-props-seg--muted' : '',
    segment.warn ? 'is-warn' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <>
      {first ? null : (
        <span className="issue-props-sep" aria-hidden="true">
          ·
        </span>
      )}
      <span className={className} role="listitem" data-segment={segment.key}>
        {segment.node}
      </span>
    </>
  );
}

/**
 * The visible word naming a segment. The trailing space is a real text
 * node: the visual gap comes from CSS, but a screen reader and the
 * segment's text content need a word boundary ("due 2026-03-09", not
 * "due2026-03-09"). Inside the inline-flex segment a whitespace-only text
 * node is not rendered, so the layout is unchanged.
 */
function Label({ children }: { children: ReactNode }) {
  return (
    <>
      <span className="issue-props-label">{children}</span>{' '}
    </>
  );
}

/** A value that may not fit: ellipsis via CSS, full text in a tooltip. */
function Truncated({ full, children }: { full: string; children: ReactNode }) {
  return (
    <SkeinTooltip content={full} position="bottom-start">
      <span className="issue-props-truncate">{children}</span>
    </SkeinTooltip>
  );
}
