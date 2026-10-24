import { PersonStatusMark, personLabel } from '../../../../components/UserMention';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ActivityEntry } from '../../../../api/activity';
import {
  formatActivityDetail,
  type ActivityDetail,
  type ActivityFieldChange,
} from '../../../../lib/formatActivityDetail';
import { Section } from '../Section';
import { withoutCommentEvents } from '../../../../lib/activityFeedFilter';
import { RELATIVE_UNTIL_MS, formatTimestamp } from '../../../../components/format';

export interface ActivitySectionProps {
  activity: ActivityEntry[] | undefined;
  /**
   * Issue creation timestamp + author — rendered as a synthetic
   * footer row regardless of whether the matching `issue.created`
   * event made it onto the first activity page (or exists at all,
   * for older test-fixture rows). This is the always-visible
   * "task born at" anchor.
   */
  createdAt: string;
  createdByUsername: string;
}

/**
 * Activity log section (F5, Q42).
 *
 * Reverse-chrono day-grouped feed. Buckets:
 *   - Today UTC
 *   - Yesterday UTC
 *   - "N days ago UTC" (2..7 days)
 *   - "YYYY-MM-DD UTC" (older)
 *
 * sk-285.6.7 — day buckets and row times are computed in UTC, not in
 * the browser's zone. The card prints UTC everywhere else (the comment
 * stamps, the closed-at row), and two clocks inside one card is exactly
 * the defect that ticket is about; the product does not know the
 * reader's zone yet (sk-340), so it states the one it does know. The
 * "older than a week" cutoff is `RELATIVE_UNTIL_MS`, the same constant
 * every other timestamp in the product switches on.
 *
 * ─── Where the zone is SAID, and why there ────────────────────────
 *
 * Moving the feed onto the UTC clock without saying so was the worse
 * half of a trade, not a fix: for a reader in UTC+3 a 01:45 local event
 * printed `22:45` and filed itself under `Yesterday`, and nothing on
 * screen admitted it. The ticket's own constraint is that absolute time
 * is shown in UTC *with the zone stated, not silently*, so the marker
 * is now on every day-bucket label — including the word buckets, which
 * are the ones that used to lie.
 *
 * It rides on the BUCKET rather than on each row for the reason
 * `formatDate`'s doc gives: a heading that establishes the zone lets
 * the values under it stay bare, and `22:45 UTC` repeated down forty
 * rows is noise where `Yesterday UTC` once is not. Each row still
 * carries the full `YYYY-MM-DD HH:MM UTC` on hover.
 *
 * NOT decided here: whether the buckets should go back to the reader's
 * local day once the profile knows the zone (sk-340). Local days are
 * what "Today" means to a person; UTC days are what the rest of the
 * card can say honestly today. That is a product call, and it is
 * flagged rather than made.
 *
 * sk-285.6.6 — comment events are dropped: the Comments section above
 * renders those in full, and repeating them here says nothing new.
 *
 * `activity` is filtered project-feed (see useIssueDetail). When
 * undefined we render a loading placeholder; an empty array renders
 * "— no activity yet" so the user knows the section is wired but
 * empty (vs "still loading").
 */
export function ActivitySection({
  activity,
  createdAt,
  createdByUsername,
}: ActivitySectionProps) {
  const { t } = useTranslation('details');
  if (!activity) {
    return (
      <Section title={t('sectionsMore.activity')}>
        <div className="activity-loading">{t('activity.loading')}</div>
      </Section>
    );
  }

  // sk-73 — drop detail-less rows (an `issue.updated` that resolves to
  // no field changes) so a run of edits no longer reads as repeated
  // empty "updated" noise. Every other event type carries meaningful
  // content (status transition, verb, dependency edge) and is kept.
  // sk-285.6.6 — drop the rows the Comments section already shows in
  // full BEFORE the detail-less filter, so a comment event can never
  // reach the feed by some other route.
  const visible = withoutCommentEvents(activity).filter(
    (e) => !formatActivityDetail(e).detailless,
  );

  // Always-visible "created" footer — derived from the issue itself,
  // not from the event log, so it shows up even when the matching
  // `issue.created` event hasn't paginated onto this page (or was
  // never recorded, e.g. test-fixture rows seeded by raw INSERT).
  // Suppressed when the event log already has an `issue.created` row
  // on the first page so we don't double up.
  const createdEventOnPage = visible.some((e) => e.type === 'issue.created');
  const createdFooter = createdEventOnPage ? null : (
    <div className="activity-day">
      <div className="activity-day-label">{labelFor(createdAt)}</div>
      <div className="activity-day-rows">
        <div className="activity-row">
          <span
            className="activity-row-time"
            title={formatTimestamp(createdAt)}
          >
            {formatTimeOfDay(createdAt)}
          </span>
          <span className="activity-row-actor">{createdByUsername}</span>
          <span className="activity-row-summary">{t('activity.created')}</span>
        </div>
      </div>
    </div>
  );

  if (visible.length === 0) {
    return (
      <Section title={t('sectionsMore.activity')}>
        <div className="activity-feed">
          {createdFooter ?? (
            // sk-285.6.8 — the one shared empty-state word. Unreachable
            // in practice (the synthetic "created" footer above only
            // vanishes when the feed already HAS an issue.created row),
            // but it must not be the fifth dialect if it ever renders.
            <div className="activity-empty">{t('emptyValue')}</div>
          )}
        </div>
      </Section>
    );
  }

  const groups = groupByDay(visible);

  return (
    <Section title={t('sectionsMore.activity')}>
      <div className="activity-feed">
        {groups.map((g) => (
          <div key={g.label} className="activity-day">
            <div className="activity-day-label">{g.label}</div>
            <div className="activity-day-rows">
              {g.items.map((item) => (
                <ActivityRow key={item.id} entry={item} />
              ))}
            </div>
          </div>
        ))}
        {createdFooter}
      </div>
    </Section>
  );
}

function ActivityRow({ entry }: { entry: ActivityEntry }) {
  const time = formatTimeOfDay(entry.occurredAt);
  const detail = formatActivityDetail(entry);
  return (
    <div className="activity-row">
      {/* sk-285.6.7 — the exact stamp on hover, like every other
          relative/compact time label in the product. */}
      <span className="activity-row-time" title={formatTimestamp(entry.occurredAt)}>
        {time}
      </span>
      <ActivityActor actor={entry.actor} />
      <span className="activity-row-summary">
        <ActivityDetailLine detail={detail} />
      </span>
    </div>
  );
}

/**
 * Renders the structured change detail for one row: a verb, then either
 * a `from → to` transition (status / parent), a list of per-field
 * changes (issue.updated), or a trailing note (dependency edge / stale
 * lock). Replaces the old flat `entry.summary` dump.
 */
function ActivityDetailLine({ detail }: { detail: ActivityDetail }) {
  return (
    <>
      <span className="activity-verb">{detail.verb}</span>
      {detail.transition ? (
        <span
          className="activity-transition"
          aria-label={`from ${detail.transition.from} to ${detail.transition.to}`}
        >
          <span className="activity-old">{detail.transition.from}</span>
          <span className="activity-arrow" aria-hidden="true">
            →
          </span>
          <span className="activity-new">{detail.transition.to}</span>
        </span>
      ) : null}
      {detail.changes.map((c) => (
        <FieldChangeChip key={c.field} change={c} />
      ))}
      {detail.tail ? <span className="activity-tail">{detail.tail}</span> : null}
    </>
  );
}

/**
 * One field change inside an `issue.updated` row.
 *
 * Simple scalar fields render inline as `field: old → new`. Large
 * markdown fields (description / notes / acceptance criteria / design)
 * render the compact `field changed` with a toggle that reveals the
 * before/after text — the full diff is never expanded by default so a
 * single edit doesn't flood the feed.
 */
function FieldChangeChip({ change }: { change: ActivityFieldChange }) {
  const [open, setOpen] = useState(false);
  // Stable per-chip id so the toggle can point at its own detail region
  // (aria-controls) — a row with several large-field changes then has
  // distinct, individually-addressable disclosures rather than a run of
  // identical "show" buttons.
  const detailId = useId();

  if (!change.large) {
    return (
      <span className="activity-change">
        <span className="activity-field">{change.label}:</span>
        <span className="activity-old">{change.oldText}</span>
        <span className="activity-arrow" aria-hidden="true">
          →
        </span>
        <span className="activity-new">{change.newText}</span>
      </span>
    );
  }

  return (
    <span className="activity-change activity-change-large">
      <span className="activity-field">{change.label} changed</span>
      <button
        type="button"
        className="activity-detail-toggle"
        aria-expanded={open}
        aria-controls={detailId}
        aria-label={`${open ? 'Hide' : 'Show'} ${change.label} change details`}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? 'hide' : 'show'}
      </button>
      {open ? (
        <span id={detailId} className="activity-detail">
          <DetailBlock label="before" text={change.oldText} field={change.label} />
          <DetailBlock label="after" text={change.newText} field={change.label} />
        </span>
      ) : null}
    </span>
  );
}

/**
 * One side (before / after) of a large-field change. The text is capped
 * to a scrollable region (CSS `.activity-detail-text`) rather than
 * silently clipped: `tabIndex={0}` + `role="group"` + a field-specific
 * `aria-label` make the capped content reachable by keyboard and named
 * for assistive tech, so nothing is lost off the bottom edge.
 */
function DetailBlock({
  label,
  text,
  field,
}: {
  label: string;
  text: string;
  field: string;
}) {
  return (
    <span className="activity-detail-block">
      <span className="activity-detail-label">{label}</span>
      <span
        className="activity-detail-text"
        role="group"
        aria-label={`${field} ${label}`}
        tabIndex={0}
      >
        {text}
      </span>
    </span>
  );
}

interface ActivityGroup {
  label: string;
  items: ActivityEntry[];
}

/**
 * Group entries by local-day. Returns groups in the same order as
 * input — caller has already sorted DESC by occurredAt, so the
 * output is naturally newest-first by group.
 *
 * Module-private: the only consumer is this section's render, and the
 * function is inseparable from the section-local `labelFor` /
 * `ActivityGroup` pair. (sk-194 wave C: the audit flagged this as
 * "exported for tests" — no test ever imported it, so the export was
 * simply dead surface rather than a reason to relocate the code.)
 */
function groupByDay(items: ActivityEntry[]): ActivityGroup[] {
  if (items.length === 0) return [];
  const out: ActivityGroup[] = [];
  let currentLabel: string | null = null;
  let currentItems: ActivityEntry[] = [];
  for (const item of items) {
    const label = labelFor(item.occurredAt);
    if (label !== currentLabel) {
      if (currentItems.length > 0 && currentLabel !== null) {
        out.push({ label: currentLabel, items: currentItems });
      }
      currentLabel = label;
      currentItems = [item];
    } else {
      currentItems.push(item);
    }
  }
  if (currentItems.length > 0 && currentLabel !== null) {
    out.push({ label: currentLabel, items: currentItems });
  }
  return out;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Days the feed still describes by counting ("3 days ago") before it
 * pins a bucket to a calendar date. Derived from the product-wide
 * switch-over so the feed cannot drift away from every other timestamp
 * on the page — change `RELATIVE_UNTIL_MS` and this moves with it.
 */
const RELATIVE_UNTIL_DAYS = RELATIVE_UNTIL_MS / MS_PER_DAY;

/**
 * Human-friendly day label for an ISO timestamp, in UTC — `Today` is
 * the UTC day, matching the `… UTC` stamps the rest of the card prints,
 * and the label SAYS so.
 *
 * The `UTC` suffix is unconditional, the word buckets included: `Today`
 * and `Yesterday` are day names, and which day a 22:45Z event falls on
 * is exactly the thing the zone decides. A suffix only on the absolute
 * buckets would mark the one case a reader could already work out and
 * leave the two that mislead unmarked.
 */
function labelFor(iso: string): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return iso;

  const startOfToday = Date.UTC(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth(),
    new Date().getUTCDate(),
  );
  const startOfThen = Date.UTC(
    then.getUTCFullYear(),
    then.getUTCMonth(),
    then.getUTCDate(),
  );

  const dayDiff = Math.round((startOfToday - startOfThen) / MS_PER_DAY);
  if (dayDiff <= 0) return 'Today UTC';
  if (dayDiff === 1) return 'Yesterday UTC';
  if (dayDiff < RELATIVE_UNTIL_DAYS) return `${dayDiff} days ago UTC`;
  // Past the threshold — pin to an absolute day.
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${then.getUTCFullYear()}-${pad(then.getUTCMonth() + 1)}-${pad(then.getUTCDate())} UTC`;
}

/**
 * "HH:MM" on the UTC clock for the per-row time prefix — bare, because
 * the bucket label above the row states the zone for the whole group
 * (see «Where the zone is SAID» in the module doc). The exact instant,
 * zone included, is on the row's `title`.
 */
function formatTimeOfDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/**
 * sk-674.18 T055 (screens 1.10, INV-18) — the actor of an event: a deleted
 * account as its pseudonym, a departed person greyed with "left".
 */
function ActivityActor({ actor }: { actor: ActivityEntry['actor'] }) {
  const label = personLabel(actor.username, actor);
  return (
    <span
      className={
        label.departed || label.deleted ? 'activity-row-actor person-gone' : 'activity-row-actor'
      }
    >
      {label.text}
      <PersonStatusMark label={label} />
    </span>
  );
}
