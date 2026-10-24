import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Group, Modal, Stack } from '@mantine/core';
import { IconPencil } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';

import { listDependencies, type DependencyList } from '../../../api/dependencies';
import type {
  CloseOutcome,
  IssueDetail,
  PatchIssueInput,
} from '../../../api/issues';
import {
  closeOutcomeLabelKey,
  closeTargetRequired,
  hasOutcomeEdge,
  isDoneOutcome,
  isKnownCloseOutcome,
} from '../../../lib/closeOutcome';
import { issueDependenciesKey } from '../../../lib/useIssueDetail';
import {
  CloseOutcomePicker,
  closeOutcomePayload,
  closeTargetMissing,
} from './CloseOutcomePicker';

/**
 * sk-489 (US-7, US-12) — the close outcome next to the status, and editing it.
 *
 * ═══ What is shown and when ═══════════════════════════════════════════
 *
 * The outcome label — when the outcome is DIFFERENT from "done" (US-7). "Done"
 * gets no extra text: "closed" already reads as done, and
 * the label would repeat the status. A value the client does not know
 * is printed as is, without a tone (INV-2) — hence `closeOutcomeLabelKey`,
 * returning `null` instead of a label, and not an invented key.
 *
 * The edit control is on a CLOSED task whose outcome field ARRIVED, including
 * "done". The difference is subtle and intentional: hiding by
 * VALUE ("done" → no control) would mean one could not leave "done";
 * hiding by the ABSENCE of the field is exactly US-10: an api that knows nothing about the
 * outcome will not send the field, and an edit on it would be
 * a refusal anyway.
 *
 * ═══ The control does not check permissions ═══════════════════════════
 *
 * There is NO permission gate of its own here — as with the other header fields
 * (priority, type): the outcome can be edited by the same circle that can
 * edit this task's fields (US-12), and the server knows that circle. The refusal
 * comes from it and is shown the usual way — by the toast
 * `lib/useIssueDetail.ts#patchMutation` → `lib/saveFailureReason.ts`.
 * A client gate introduced only for the outcome would diverge from the rest of the
 * header and would forbid the edit to those to whom the server allows it.
 *
 * ═══ An unfamiliar current outcome: show it, but do not send it ═══════
 *
 * The pick state is `CloseOutcome`, not `KnownCloseOutcome`: the input
 * holds the task's CURRENT outcome, and it may be an unfamiliar string from a
 * newer api (INV-2). The previous edition declared the state familiar and
 * cast the current value to it (`current as KnownCloseOutcome`) —
 * the type lied, and the interface lied after it: no button is selected (that is
 * correct, see the `CloseOutcomePicker` docblock), but "OK" is active and sends
 * an unfamiliar string to `patchIssue`. The server rightly rejects it
 * (`close_outcome.go#ValidateCloseOutcome`), and the user gets a toast
 * about a refusal of an action they did not take.
 *
 * So "OK" waits for a PICK: with an unfamiliar value it is disabled, and `save`
 * stops there too — the gate is named twice, because the button
 * is responsible for the display, and `save` for making sure that what was not
 * picked does not go on the wire (a call from elsewhere, the keyboard, a future markup edit).
 *
 * ═══ sk-540.2: the target of "duplicate" / "superseded" ═══════════════
 *
 * Changing the outcome to duplicate / superseded requires a target, except
 * (b) when the pick equals the current outcome and (a) when the issue
 * already carries the matching edge (`lib/closeOutcome.ts#hasOutcomeEdge`).
 * The card (`IssueDetail`) carries no edges, so the control reads the
 * issue's dependencies itself — the same query and cache key the card's
 * dependency section uses (`useIssueDetail#issueDependenciesKey`), fetched
 * while the dialog is open. Until the list arrives (or if it fails) the
 * target counts as required: the conservative reading, which the user can
 * always satisfy by typing a target.
 */
export interface CloseOutcomeControlProps {
  issue: IssueDetail;
  /**
   * Editing a task field — the same path by which the header edits priority and
   * type (`useIssueDetail#updateField` → `patchMutation`). The outcome is sent
   * ALWAYS, including "done": this is an explicit field edit, not a transition with a
   * default.
   */
  onUpdateField: (
    patch: Pick<PatchIssueInput, 'closeOutcome' | 'closeTarget'>,
  ) => Promise<unknown>;
}

export function CloseOutcomeControl({ issue, onUpdateField }: CloseOutcomeControlProps) {
  const { t } = useTranslation('details');
  const [opened, setOpened] = useState(false);
  const [outcome, setOutcome] = useState<CloseOutcome>('done');
  const [target, setTarget] = useState('');
  const [saving, setSaving] = useState(false);

  // sk-540.2 — edges for exception (a); see the file's doc block.
  const depsQuery = useQuery<DependencyList>({
    queryKey: issueDependenciesKey(issue.projectId, issue.id),
    queryFn: () => listDependencies(issue.projectId, issue.id),
    enabled: opened,
  });

  const current = issue.closeOutcome;
  // "The field arrived" — exactly a string, not "truthy". An empty string is not an
  // outcome: the server rejects it on input, and showing the control for it
  // would promise an edit of something that does not exist.
  const arrived = typeof current === 'string' && current !== '';
  // Both conditions are named, although INV-1 makes them the same: an outcome exists
  // if and only if the task is closed. If the api breaks this invariant,
  // the card stays silent rather than showing a contradiction.
  if (issue.status !== 'closed' || !arrived) return null;

  const labelKey = closeOutcomeLabelKey(current);
  // Label: a known one — by a word, an unfamiliar one — by the string itself, "done" —
  // by nothing (US-7).
  const shown = isDoneOutcome(current) ? null : labelKey ? t(labelKey) : current;
  // The outcome in WORDS — for the accessible name of the control. Here, unlike
  // `shown`, "done" does not stay silent: the label next to the status is dropped because
  // the word "closed" itself repeats it, but the control's name must name
  // the value being edited — as the neighbouring header labels name it
  // (`header.statusAria`, `header.changeType`).
  const spoken = labelKey ? t(labelKey) : current;

  const targetRequired = closeTargetRequired(outcome, {
    currentOutcome: current,
    hasEdge: hasOutcomeEdge(outcome, depsQuery.data),
  });
  const blocked = closeTargetMissing(targetRequired, target);

  const open = () => {
    // The current outcome is preselected if we know it; an unfamiliar one selects
    // no button — see the `CloseOutcomePicker` docblock.
    setOutcome(current);
    setTarget('');
    setOpened(true);
  };

  const save = async () => {
    // There is no pick — nothing to send: the server would reject an unfamiliar string, and
    // the refusal would arrive for an action the user did not take.
    if (!isKnownCloseOutcome(outcome)) return;
    // sk-540.2 — a required target that is still blank: the server would
    // refuse it (close_target_required).
    if (blocked) return;
    setSaving(true);
    try {
      await onUpdateField(closeOutcomePayload(outcome, target));
    } finally {
      setSaving(false);
    }
    // We close in any outcome: the refusal is already shown by the toast of the common path, and
    // there is nothing to keep the modal open over it — the control has no place of its own
    // for the error (unlike the close modal, where there is one
    // and it is used).
    setOpened(false);
  };

  return (
    <>
      <button
        type="button"
        className="header-attr-trigger header-close-outcome"
        aria-label={t('closeOutcome.editAriaCurrent', {
          id: issue.id,
          outcome: spoken,
        })}
        title={t('closeOutcome.editLabel')}
        onClick={open}
      >
        {shown ? <span className="header-close-outcome-value">{shown}</span> : null}
        {/* 16 — the smallest step of the product icon scale: the header
            label icons beside it sit on the same step. */}
        <IconPencil size={16} stroke={1.75} aria-hidden />
      </button>

      <Modal
        opened={opened}
        onClose={() => {
          if (saving) return;
          setOpened(false);
        }}
        title={t('closeOutcome.editAria', { id: issue.id })}
        centered
        size="md"
        closeOnEscape={!saving}
        closeOnClickOutside={!saving}
      >
        <Stack gap="md">
          <CloseOutcomePicker
            value={outcome}
            onChange={setOutcome}
            target={target}
            onTargetChange={setTarget}
            targetRequired={targetRequired}
            disabled={saving}
          />
          <Group justify="flex-end" gap="sm">
            <Button
              variant="outline"
              color="orange"
              disabled={saving}
              onClick={() => setOpened(false)}
              size="sm"
            >
              {t('common:cancel')}
            </Button>
            <Button
              variant="filled"
              color="orange"
              loading={saving}
              // An unfamiliar current outcome selects no button — which means
              // there is no pick yet, and nothing to confirm. See the file docblock.
              // sk-540.2 — or a required target is still blank.
              disabled={!isKnownCloseOutcome(outcome) || blocked}
              onClick={() => void save()}
              size="sm"
            >
              {t('statusReason.ok')}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
