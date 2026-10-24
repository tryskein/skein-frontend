import { useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { IconAlarm, IconPlus } from "@tabler/icons-react";
import type { TFunction } from "i18next";
import {
  useCreateReminder,
  useDismissReminder,
  useIssueReminders,
  useSnoozeReminder,
} from "../../../../lib/useReminders";
import {
  compareReminderUrgency,
  formatCountdown,
  formatRingingSince,
  reminderState,
} from "../../../../lib/reminderCountdown";
import { formatTimestamp } from "../../../../components/format";
import type { Reminder, SnoozeBy } from "../../../../api/reminders";
import { Section } from "../Section";

/**
 * sk-62.2 — card reminder block ("Reminders"), rendered near the top of
 * the issue detail view.
 *
 * Lists ALL reminders on the task (there can be > 1). Per reminder:
 *   - armed   → live countdown "⏰ rings in Xh Ym" (ticks per second)
 *   - ringing → "🔔 ringing since HH:MM UTC" (pulsing)
 * Per-reminder controls:
 *   - Snooze: quick chips +1h…+12h / +1d / +3d / +5d /
 *     +1w (mapped to the API `by` values 1h…12h / 1d / 3d / 5d / 1w)
 *     + a custom date option (mapped to `until`), plus an optional
 *     reason field.
 *   - Turn off (dismiss): deletes that one reminder.
 * Below the list: "+ add reminder" opens a datepicker to create another.
 *
 * The relentless nag is silenced ONLY by Turn off / Snooze here —
 * merely opening the card does NOT stop it (the bell keeps ringing in
 * the icon + the cross-surface highlight stays until the user acts).
 */

/**
 * Quick-snooze chips. `by` is the WIRE value the API accepts; the label
 * is copy, so the hour chips are generated from one pluralised key
 * instead of sixteen hand-written strings.
 */
function snoozeChips(t: TFunction): { label: string; by: SnoozeBy }[] {
  const hours: SnoozeBy[] = [
    "1h", "2h", "3h", "4h", "5h", "6h",
    "7h", "8h", "9h", "10h", "11h", "12h",
  ];
  return [
    ...hours.map((by, i) => ({
      by,
      label: t("reminders.chips.hours", { count: i + 1 }),
    })),
    { label: t("reminders.chips.day1"), by: "1d" as SnoozeBy },
    { label: t("reminders.chips.day3"), by: "3d" as SnoozeBy },
    { label: t("reminders.chips.day5"), by: "5d" as SnoozeBy },
    { label: t("reminders.chips.week1"), by: "1w" as SnoozeBy },
  ];
}

export interface RemindersSectionProps {
  /** Issue project UUID (path param for create). */
  projectId: string;
  /** Hierarchical issue id. */
  issueId: string;
}

export function RemindersSection({
  projectId,
  issueId,
}: RemindersSectionProps) {
  const { t } = useTranslation("details");
  const reminders = useIssueReminders(issueId);
  const [adding, setAdding] = useState(false);

  // Per-second tick so countdowns + the armed→ringing flip stay live.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(
      () => setTick((n) => (n + 1) % 1_000_000),
      1_000,
    );
    return () => window.clearInterval(id);
  }, []);

  const now = Date.now();
  // Time-dependent sort: `now` is a dependency, so the memo recomputes on
  // each per-second tick (countdowns + the armed→ringing flip stay live).
  const sorted = useMemo(
    () => [...reminders].sort((a, b) => compareReminderUrgency(a, b, now)),
    [reminders, now],
  );

  // The block is always rendered (so the "+ Add reminder" affordance is
  // discoverable even on a task with no reminders yet). sk-285.6.2 — with
  // no reminders and the add-form closed it collapses to ONE row and the
  // affordance rides on it, so a task nobody set an alarm on pays a line
  // rather than a heading + a sentence + a button.
  const addButton = (
    <button
      type="button"
      className="reminder-add-btn"
      onClick={() => setAdding(true)}
    >
      {/* sk-285.7.2.57 — §8 names `plus`; the literal `'+ '` that used
          to open this label was a character on the system's face. 16px
          is the inline step every other labelled control of this panel
          spends. */}
      <IconPlus size={16} stroke={1.75} aria-hidden />
      {t("reminders.add")}
    </button>
  );

  return (
    <Section
      title={t("reminders.title")}
      className="reminders-section"
      count={sorted.length}
      id="reminders"
      empty={sorted.length === 0 && !adding}
      emptyAction={addButton}
    >
      {sorted.map((r) => (
        <ReminderRow key={r.id} reminder={r} now={now} />
      ))}

      {adding ? (
        <AddReminderForm
          projectId={projectId}
          issueId={issueId}
          onDone={() => setAdding(false)}
        />
      ) : (
        addButton
      )}
    </Section>
  );
}

function ReminderRow({ reminder, now }: { reminder: Reminder; now: number }) {
  const { t } = useTranslation("details");
  const chips = useMemo(() => snoozeChips(t), [t]);
  const snoozeMut = useSnoozeReminder();
  const dismissMut = useDismissReminder();
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [customDate, setCustomDate] = useState("");
  const snoozePanelId = useId();
  const snoozeToggleId = useId();
  const dismissBtnId = useId();
  // Id of the row's own "when" text. The action buttons borrow it for their
  // accessible name so the spoken name is exactly what the row shows.
  const whenId = useId();

  const state = reminderState(reminder.remindAt, now);
  const ringing = state === "ringing";
  const countdown = formatCountdown(reminder.remindAt, now);
  const since = formatRingingSince(reminder.notifiedAt, reminder.remindAt);

  const busy = snoozeMut.isPending || dismissMut.isPending;

  const doSnoozeBy = (by: SnoozeBy) => {
    snoozeMut.mutate(
      { reminderId: reminder.id, by, reason: reason.trim() || undefined },
      {
        onSuccess: () => {
          setSnoozeOpen(false);
          setReason("");
          setCustomDate("");
        },
      },
    );
  };

  const doSnoozeUntil = () => {
    if (!customDate) return;
    // datetime-local yields a local wall-clock string with no zone; the
    // Date ctor reads it as local time, toISOString() emits UTC RFC3339.
    const iso = localInputToIso(customDate);
    if (!iso) return;
    snoozeMut.mutate(
      {
        reminderId: reminder.id,
        until: iso,
        reason: reason.trim() || undefined,
      },
      {
        onSuccess: () => {
          setSnoozeOpen(false);
          setReason("");
          setCustomDate("");
        },
      },
    );
  };

  return (
    <div className={`reminder-row${ringing ? " ringing" : " armed"}`}>
      <div className="reminder-row-when" id={whenId}>
        {ringing ? (
          <span className="reminder-when-ringing">
            {/* sk-285.7.2.57 — `alarm`, the name §8 gives this object,
                in place of the emoji 🔔 / ⏰ that used to open these two
                strings. An emoji is not an icon that happens to be
                typed: U+1F514 and U+23F0 resolve to the SYSTEM's emoji
                face, arrive in that face's own colours, and cannot be
                put on §8's stroke or scale at all.
                One name for both states, not two: what separates
                «ringing» from «armed» here is already carried three
                ways — the word, `--warn` against `--ink`, and the
                blink — and a second glyph would be a fourth encoding of
                a distinction the row does not have trouble making. */}
            <IconAlarm size={16} stroke={1.75} aria-hidden />
            {since
              ? t("reminders.ringingSince", { since })
              : t("reminders.ringing")}
          </span>
        ) : (
          <span
            className="reminder-when-armed"
            // sk-285.6.7 — `formatTimestamp`, the product's one absolute
            // form (`YYYY-MM-DD HH:MM UTC`), and not the `DD.MM HH:MM`
            // local stamp that used to sit here. That one named no zone
            // and no year in a card whose every other absolute label is
            // UTC-suffixed, so a reader in UTC+3 read the alarm three
            // hours wrong in the single place on the card where a time
            // is a promise to wake them.
            title={t("reminders.armedTitle", {
              when: formatTimestamp(reminder.remindAt),
            })}
          >
            <IconAlarm size={16} stroke={1.75} aria-hidden />
            {t("reminders.armedIn", {
              countdown: countdown ?? t("reminders.lessThanMinute"),
            })}
          </span>
        )}
        {reminder.snoozeCount > 0 ? (
          <span className="reminder-snoozed-tag">
            {t("reminders.snoozed", { count: reminder.snoozeCount })}
          </span>
        ) : null}
        {reminder.lastReason ? (
          <span className="reminder-last-reason" title={reminder.lastReason}>
            {t("reminders.lastReason", { reason: reminder.lastReason })}
          </span>
        ) : null}
      </div>

      <div className="reminder-row-actions">
        <button
          type="button"
          id={snoozeToggleId}
          className="reminder-action-btn"
          disabled={busy}
          aria-expanded={snoozeOpen}
          aria-controls={snoozePanelId}
          // Name = own text + the row's "when" text ("Snooze ⏰ rings
          // in 3 hours"). Two earlier attempts were not actually
          // distinguishing: issueId is identical on every row here (the
          // section renders ONE issue), and the local `DD.MM HH:MM` stamp
          // that used to back this tooltip printed no year, so reminders
          // a year apart produced the same string.
          // Borrowing the visible row text keeps the spoken name unique
          // whenever the rows read differently on screen — and if they don't,
          // that is a display problem, not a labelling one.
          aria-labelledby={`${snoozeToggleId} ${whenId}`}
          onClick={() => setSnoozeOpen((v) => !v)}
        >
          {t("reminders.snooze")}
        </button>
        <button
          type="button"
          className="reminder-action-btn reminder-dismiss-btn"
          disabled={busy}
          id={dismissBtnId}
          aria-labelledby={`${dismissBtnId} ${whenId}`}
          onClick={() => dismissMut.mutate({ reminderId: reminder.id })}
        >
          {t("reminders.dismiss")}
        </button>
      </div>

      {snoozeOpen ? (
        <div
          id={snoozePanelId}
          className="reminder-snooze-panel"
          role="region"
          aria-labelledby={snoozeToggleId}
        >
          <div className="reminder-snooze-chips">
            {chips.map((c) => (
              <button
                key={c.by}
                type="button"
                className="reminder-chip"
                disabled={busy}
                onClick={() => doSnoozeBy(c.by)}
              >
                {c.label}
              </button>
            ))}
          </div>
          <div className="reminder-snooze-custom">
            <input
              type="datetime-local"
              className="reminder-custom-date"
              value={customDate}
              onChange={(e) => setCustomDate(e.target.value)}
              aria-label={t("reminders.snoozeDateAria")}
            />
            <button
              type="button"
              className="reminder-chip"
              disabled={busy || !customDate}
              onClick={doSnoozeUntil}
            >
              {t("reminders.snoozeDateBtn")}
            </button>
          </div>
          <input
            type="text"
            className="reminder-reason-input"
            placeholder={t("reminders.reasonPlaceholder")}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            aria-label={t("reminders.reasonAria")}
          />
        </div>
      ) : null}
    </div>
  );
}

function AddReminderForm({
  projectId,
  issueId,
  onDone,
}: {
  projectId: string;
  issueId: string;
  onDone: () => void;
}) {
  const { t } = useTranslation("details");
  const createMut = useCreateReminder();
  const [when, setWhen] = useState("");
  const [note, setNote] = useState("");

  const submit = () => {
    const iso = localInputToIso(when);
    if (!iso) return;
    createMut.mutate(
      { projectId, issueId, remindAt: iso, note: note.trim() || undefined },
      { onSuccess: () => onDone() },
    );
  };

  return (
    <div className="reminder-add-form">
      <input
        type="datetime-local"
        className="reminder-custom-date"
        // sk-285.6.2 — the form only ever appears because the reader
        // pressed "+ another reminder", and that press unmounts the
        // button. Without a landing place the focus drops to <body>
        // and the keyboard path to the form the reader just asked for
        // is a full pass through the card (WCAG 2.4.3).
        autoFocus
        value={when}
        onChange={(e) => setWhen(e.target.value)}
        aria-label={t("reminders.whenAria")}
      />
      <input
        type="text"
        className="reminder-reason-input"
        placeholder={t("reminders.notePlaceholder")}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        aria-label={t("reminders.noteAria")}
      />
      <div className="reminder-add-actions">
        <button
          type="button"
          className="reminder-action-btn"
          disabled={createMut.isPending || !when}
          onClick={submit}
        >
          {t("reminders.create")}
        </button>
        <button
          type="button"
          className="reminder-action-btn"
          disabled={createMut.isPending}
          onClick={onDone}
        >
          {t("common:cancel")}
        </button>
      </div>
    </div>
  );
}

/**
 * Convert a `<input type="datetime-local">` value (local wall-clock,
 * no timezone, e.g. "2026-06-01T15:30") to an RFC3339 UTC string. The
 * Date constructor interprets the bare string as LOCAL time, so
 * `toISOString()` yields the correct UTC instant. Returns null on empty
 * / unparseable input so callers can no-op.
 */
function localInputToIso(value: string): string | null {
  if (!value) return null;
  const t = Date.parse(value);
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString();
}
