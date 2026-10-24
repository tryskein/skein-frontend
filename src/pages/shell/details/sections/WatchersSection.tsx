import { PersonStatusMark, personLabel } from '../../../../components/UserMention';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { IconPlus, IconX } from '@tabler/icons-react';
import {
  type WatcherEntry,
  unwatchIssue,
  watchIssue,
} from '../../../../api/watchers';
import { useToaster } from '../../../../components/Toaster';
import { useAuth } from '../../../../auth/AuthContext';
import { issueWatchersKey } from '../../../../lib/useIssueDetail';
import { Section } from '../Section';
import { extractMessage } from '../../../../lib/extractApiMessage';

export interface WatchersSectionProps {
  issueId: string;
  watchers: WatcherEntry[] | undefined;
}

/**
 * Watchers section (F5).
 *
 * Renders the full watcher list for the issue + a toggle for the
 * caller. Adding other users by username is **not** supported by
 * the wire (the issues API only exposes self watch/unwatch); the
 * server derives watchers automatically (creator/assignee/commenter/
 * mention). So the "add" affordance here is just the caller's own
 * watch toggle — a separate `[Watch]` button in the sticky header
 * does the same thing for screen-real-estate reasons.
 *
 * Each row shows username + reasons (comma-separated, minus the
 * `unwatched` overlay) + since-date. Removal is only allowed for the
 * caller's own row — the wire enforces this and we mirror it in the
 * UI by hiding the × button on other people's rows.
 */
export function WatchersSection({ issueId, watchers }: WatchersSectionProps) {
  const { t } = useTranslation('details');
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToaster();
  const [busy, setBusy] = useState(false);

  const total = watchers
    ? watchers.filter((w) => !w.reasons.includes('unwatched')).length
    : 0;

  const watchMut = useMutation<void, Error, boolean>({
    mutationFn: (next) => (next ? watchIssue(issueId) : unwatchIssue(issueId)),
    onSettled: () => {
      setBusy(false);
      void qc.invalidateQueries({ queryKey: issueWatchersKey(issueId) });
    },
    onError: (err) => toast.error(extractMessage(err)),
  });

  const me = watchers?.find((w) => w.userId === user?.id);
  const meIsWatching =
    !!me && me.reasons.length > 0 && !me.reasons.includes('unwatched');

  const onToggleSelf = () => {
    setBusy(true);
    watchMut.mutate(!meIsWatching);
  };

  // sk-285.6.2 — nobody watching yet costs one row, with the watch
  // toggle riding on it. While the list is still loading the section
  // stays expanded so the "loading…" line has somewhere to render.
  const watchButton = !meIsWatching ? (
    <button
      type="button"
      className="empty-section-add"
      disabled={busy}
      aria-label={t('watchers.add')}
      onClick={onToggleSelf}
    >
      {/* sk-285.7.2.55 — see `EditableTextSection`: one-word visible
          label beside `ti-plus`, the full phrase as the accessible
          name. */}
      <IconPlus size={16} stroke={1.75} aria-hidden />
      {t('emptyAdd.watch')}
    </button>
  ) : null;

  return (
    <Section
      title={t('sectionsMore.watchers')}
      count={total}
      empty={!!watchers && total === 0}
      emptyAction={watchButton}
    >
      {!watchers ? (
        <div className="watchers-loading">{t('watchers.loading')}</div>
      ) : (
        <div className="watchers-list">
          {watchers
            .filter((w) => !w.reasons.includes('unwatched'))
            .map((w) => {
              // sk-674.18 T055 — departed / deleted, as everywhere people are shown.
              const label = personLabel(w.username, w);
              return (
              <div key={w.userId} className="watcher-row">
                <span
                  className={
                    label.departed || label.deleted ? 'watcher-name person-gone' : 'watcher-name'
                  }
                >
                  @{label.text}
                  <PersonStatusMark label={label} />
                </span>
                <span className="watcher-reasons">
                  {w.reasons.filter((r) => r !== 'unwatched').join(', ')}
                </span>
                {w.userId === user?.id ? (
                  <button
                    type="button"
                    className="watcher-remove"
                    aria-label={t('watchers.stopWatching')}
                    disabled={busy}
                    onClick={onToggleSelf}
                  >
                    {/* sk-285.7.2.45 — the other ✕ inside the Details
                        panel. It was the literal `×`; the panel is the
                        zone the audit measured at zero `<svg>`, and a
                        second spelling of the same control is exactly how
                        a "fixed" defect survives on one surface. */}
                    <IconX size={20} stroke={1.75} aria-hidden />
                  </button>
                ) : null}
              </div>
              );
            })}
        </div>
      )}
      {watchButton}
    </Section>
  );
}
