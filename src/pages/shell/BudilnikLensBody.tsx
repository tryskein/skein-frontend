import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconAlarm, IconAlarmFilled } from '@tabler/icons-react';
import { IssueIDBadge } from '../../components/IssueIDBadge';
import { Attribute } from '../../components/Attribute';
import { useLayoutState } from '../../lib/useLayoutState';
import { useProjectsList } from '../../lib/useProjectsList';
import { useRemindersList } from '../../lib/useReminders';
import {
  compareReminderUrgency,
  formatCountdown,
  formatRingingSince,
  reminderState,
} from '../../lib/reminderCountdown';
import type { Reminder } from '../../api/reminders';

/**
 * sk-62.2 — "Reminders" lens body, rendered in the Tasks column when
 * `budilnikMode` is active (REPLACING the normal board, exactly like
 * the blob-codes panel does).
 *
 * Shows a FLAT, cross-project list of tasks that have reminders, most
 * urgent first: ringing reminders on top (amber accent + extra emphasis
 * so they obviously demand attention), armed reminders below with a
 * live countdown. The list is the canonical `state=all` reminders query
 * (`useRemindersList`); the row order is derived client-side off a
 * per-second clock tick so an armed reminder visibly promotes itself to
 * the ringing group the instant its `remindAt` passes.
 *
 * Clicking a row opens the issue in the Details column. The relentless
 * nag is NOT silenced by opening — only the card's Turn off / Snooze
 * buttons do that (per spec); this lens is a triage list.
 */
export function BudilnikLensBody({ selectedIssueId }: { selectedIssueId: string | null }) {
  const { t } = useTranslation('tasks');
  const layout = useLayoutState();
  const projectsQ = useProjectsList();
  const { reminders, isLoading, error } = useRemindersList();

  // Per-second tick so the countdown + the ringing/armed partition stay
  // live without a refetch. A bare counter is enough to force a
  // re-render; the actual time math reads Date.now() at render.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => (n + 1) % 1_000_000), 1_000);
    return () => window.clearInterval(id);
  }, []);

  // Resolve project UUID → idPrefix so a row click can navigate to the
  // project-scoped issue URL (same trick the Tasks column uses for the
  // cross-project Outbox surface).
  const projectHandles = useMemo(() => {
    const out = new Map<string, string>();
    for (const p of projectsQ.data?.items ?? []) out.set(p.id, p.idPrefix);
    return out;
  }, [projectsQ.data]);

  const now = Date.now();
  // Time-dependent sort: `now` IS a dependency, so the memo recomputes on
  // each per-second tick — that's intended, the ringing/armed partition and
  // ordering shift as armed reminders cross into ringing.
  const sorted = useMemo(
    () => [...reminders].sort((a, b) => compareReminderUrgency(a, b, now)),
    [reminders, now],
  );

  const handleSelect = (r: Reminder) => {
    const handle = projectHandles.get(r.projectId) ?? prefixFromIssueId(r.issueId) ?? '';
    layout.setSelectedIssue(r.issueId, handle);
  };

  if (isLoading) {
    return (
      <div className="col-body tasks-body">
        <div className="col-empty">{t('remindersLens.loading')}</div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="col-body tasks-body">
        <div className="col-empty col-error">{t('remindersLens.loadFailed')}</div>
      </div>
    );
  }
  if (sorted.length === 0) {
    return (
      <div className="col-body tasks-body">
        <div className="col-empty">{t('remindersLens.empty')}</div>
      </div>
    );
  }

  return (
    <div className="col-body tasks-body budilnik-lens-body">
      {sorted.map((r) => (
        <BudilnikRow
          key={r.id}
          reminder={r}
          now={now}
          selected={selectedIssueId === r.issueId}
          onSelect={() => handleSelect(r)}
        />
      ))}
    </div>
  );
}

function BudilnikRow({
  reminder,
  now,
  selected,
  onSelect,
}: {
  reminder: Reminder;
  now: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation('tasks');
  const state = reminderState(reminder.remindAt, now);
  const ringing = state === 'ringing';
  const Icon = ringing ? IconAlarmFilled : IconAlarm;
  const countdown = formatCountdown(reminder.remindAt, now);
  const since = formatRingingSince(reminder.notifiedAt, reminder.remindAt);

  return (
    <button
      type="button"
      className={[
        'task-card',
        'budilnik-row',
        ringing ? 'ringing' : 'armed',
        selected ? 'selected' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-label={t('remindersLens.openIssue', {
        id: reminder.issueId,
        title: reminder.issueTitle,
      })}
      onClick={onSelect}
    >
      {/* Same layout rule as TaskCard: the title owns the first line
       * alone, the id sits on the quiet line under it. Neither the
       * project handle nor the id belongs above the title. */}
      <div className="task-card-title-block" title={reminder.issueTitle}>
        <span
          className={`budilnik-row-icon${ringing ? ' shaking' : ''}`}
          aria-hidden
        >
          <Icon size={16} stroke={2} />
        </span>
        <span className="task-card-title-text">{reminder.issueTitle}</span>
      </div>
      <div className="task-card-id-line">
        <IssueIDBadge id={reminder.issueId} />
      </div>
      <div className="budilnik-row-when">
        {ringing ? (
          <span className="budilnik-when-ringing">
            {/* sk-285.7.2.88 — `alarm`, the name §8 gives this object,
                in place of the 🔔 / ⏰ that used to open these two
                strings. This is the same fix sk-285.7.2.57 made in the
                Details panel; the lens was the second copy of the same
                four emoji and did not get it. U+1F514 and U+23F0
                resolve to the platform's EMOJI face: they arrive in
                that face's own colours, ignore `currentColor`, have no
                stroke to set and no place on §8's 16/20/24 scale. Live
                measurement in this container put the sibling 👁 at
                7.45×12 — the missing-glyph box, i.e. not an eye at all.
                One name for both states, exactly as the Details block
                argues: ringing vs armed is already carried by the word,
                by `--warn` against `--ink-2` and by the blink. */}
            <IconAlarm size={16} stroke={1.75} aria-hidden />
            {since
              ? t('remindersLens.ringingSince', { since })
              : t('remindersLens.ringing')}
          </span>
        ) : (
          <span className="budilnik-when-armed">
            <IconAlarm size={16} stroke={1.75} aria-hidden />
            {t('remindersLens.armedIn', {
              countdown: countdown ?? t('remindersLens.lessThanMinute'),
            })}
          </span>
        )}
        {reminder.snoozeCount > 0 ? (
          <span className="budilnik-when-snoozed">
            {t('remindersLens.snoozed', { count: reminder.snoozeCount })}
          </span>
        ) : null}
      </div>
      <div className="task-card-meta-row">
        <div className="task-card-meta-left">
          <Attribute kind="status" value={reminder.issueStatus} />
          <Attribute kind="priority" value={reminder.issuePriority} />
          <Attribute kind="type" value={reminder.issueType} />
        </div>
      </div>
    </button>
  );
}

/**
 * Issue id is `{prefix}-{n}` (subtasks `{prefix}-{n}.{m}`) so the
 * project handle is recoverable from the id alone — fallback when the
 * projects list hasn't loaded the project's UUID yet.
 */
function prefixFromIssueId(id: string): string | null {
  const m = id.match(/^(.+)-\d+(?:\.\d+)*$/);
  return m ? m[1] : null;
}
