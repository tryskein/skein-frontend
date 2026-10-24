import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Group, Modal, Stack, Textarea } from '@mantine/core';
import type {
  IssueStatus,
  KnownCloseOutcome,
  TransitionCloseInput,
} from '../../../api/issues';
import { DANGER_BUTTON_VARS } from '../../../lib/dangerButtonVars';
import { closeTargetRequired } from '../../../lib/closeOutcome';
import {
  CloseOutcomePicker,
  closeOutcomePayload,
  closeTargetMissing,
} from './CloseOutcomePicker';

/**
 * Mantine modal that gathers an optional reason for a reason-required
 * status transition (close / defer / retire).
 *
 * Replaces the original `window.prompt()` flow — that breaks visual
 * continuity (native font + native chrome) and offers no spinner /
 * error path. The modal:
 *   - Focuses the textarea on open.
 *   - Submits via OK button or modal-default (Enter is intentionally
 *     NOT a submit — multi-line reasons are common and Enter should
 *     insert a newline). Use the explicit OK button or Cmd/Ctrl-Enter
 *     if we add that later.
 *   - On submit, shows `loading=true` and disables both buttons. The
 *     parent calls `onClose()` after the mutation resolves; on error
 *     the parent passes a fresh error message via `error` and the
 *     modal stays open.
 *   - Cancel/ESC/overlay-click closes without firing the mutation.
 *
 * sk-118 — retire framing. Closing a `standing` task is a retire,
 * not a normal close: pass `isRetire` to reframe the verb,
 * placeholder, and the `standing_has_open_children` guard (see props).
 */
export interface StatusChangeReasonModalProps {
  opened: boolean;
  /** Hierarchical issue id (e.g. "demo-42"). */
  issueId: string;
  /** The transition target — drives the title verb. */
  next: IssueStatus;
  /** True while the mutation is in flight. */
  loading?: boolean;
  /** Optional error message; shown inline above the buttons. */
  error?: string | null;
  /**
   * sk-118 — retire framing. When true AND `next === 'closed'`, the modal
   * reframes the close as a retire of a standing
   * (perpetual-obligation) task: the verb becomes "Retire", the
   * placeholder suggests EOL-style reasons ("no longer relevant / left
   * the fork / EOL"), and the inline error renders the
   * `standing_has_open_children` guard distinctly (with the offending
   * child ids when the backend supplies them).
   */
  isRetire?: boolean;
  /**
   * sk-118 — offending child ids backing a `standing_has_open_children`
   * rejection. Surfaced as a list beneath the error when present. Empty /
   * undefined → the modal just shows `error`. Over REST the backend
   * currently sends only the code + message (no ids), so this is a
   * forward-compat hook the MCP path / a future REST enrichment fills.
   */
  standingChildIds?: string[];
  /**
   * User clicked OK. Reason is the trimmed textarea contents — empty
   * string if blank.
   *
   * sk-489 (US-1, US-2) — `close` carries the picked outcome and the
   * optional target. It is `undefined` on every transition that is not a
   * close and on a retire: those have no outcome pick at all, and the
   * server's own default applies ("done" on the transition into
   * closed). `undefined` therefore means «did not ask», never «done».
   */
  onSubmit: (reason: string, close?: TransitionCloseInput) => void;
  /** User clicked Cancel / ESC / overlay-click. */
  onClose: () => void;
}

// sk-31: 'blocked' is no longer a writable status. The modal opens for
// 'closed' / 'deferred' (and, sk-118, the retire framing reuses the
// 'closed' transition with `isRetire`). The map holds dictionary KEYS —
// the verb is copy, the status is the wire value.
const VERB_KEY_FOR_STATUS: Partial<Record<IssueStatus, string>> = {
  closed: 'statusReason.verbClosed',
  deferred: 'statusReason.verbDeferred',
};

export function StatusChangeReasonModal({
  opened,
  issueId,
  next,
  loading,
  error,
  isRetire,
  standingChildIds,
  onSubmit,
  onClose,
}: StatusChangeReasonModalProps) {
  const { t } = useTranslation('details');
  const [reason, setReason] = useState('');
  // sk-489 (US-1) — "done" is preselected: it is the default of the TRANSITION into
  // "closed", and the modal offers the same thing that would happen without it.
  const [outcome, setOutcome] = useState<KnownCloseOutcome>('done');
  const [target, setTarget] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Reset the textarea every time the modal opens (or the target issue
  // changes underneath it). Without this, switching to another issue
  // and re-opening would carry over the previous draft.
  useEffect(() => {
    if (opened) {
      setReason('');
      // sk-489 — the same reset and for the same reason: otherwise the outcome picked
      // last time (and especially the typed target) would silently move to
      // another task.
      setOutcome('done');
      setTarget('');
      // Focus is auto-handled by Mantine on opened, but we want the
      // textarea (not the title); a small rAF defers until after the
      // portal has mounted.
      const id = requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
      return () => cancelAnimationFrame(id);
    }
  }, [opened, issueId]);

  // sk-118 — retire reframes the 'closed' transition. The verb / title /
  // placeholder switch to the retire vocabulary so the user reads it
  // as retiring a perpetual obligation, not closing an ordinary task.
  const retire = !!isRetire && next === 'closed';
  const verb = t(VERB_KEY_FOR_STATUS[next] ?? 'statusReason.verbDefault');
  const title = retire
    ? t('statusReason.titleRetire', { id: issueId })
    : t('statusReason.title', { verb, id: issueId });
  const placeholder = retire
    ? t('statusReason.placeholderRetire')
    : t('statusReason.placeholder', { status: next });

  // sk-118 — the standing-children guard renders distinctly from a plain
  // error: a heading + the offending child ids (when supplied) so the
  // user knows exactly which children to close/retire first.
  const hasStandingChildren = (standingChildIds?.length ?? 0) > 0;

  // sk-489 (US-1) — the outcome pick exists exactly for CLOSE and exactly not for
  // retirement. "Defer" is not a close; retiring a permanent
  // task is a close, but its outcome is always "done"
  // (a permanent task is a commitment, not work, and does not count
  // in progress), so there is nothing to ask.
  const picksOutcome = next === 'closed' && !retire;
  // sk-540.2 — this modal is a TRANSITION into closed, so "duplicate" /
  // "superseded" require a target with no exception (those are for issues
  // that are already closed — the card's control).
  const targetRequired = picksOutcome && closeTargetRequired(outcome);
  const blocked = closeTargetMissing(targetRequired, target);
  const submit = () => {
    if (blocked) return;
    if (!picksOutcome) {
      onSubmit(reason.trim());
      return;
    }
    // The target is accepted by "duplicate" and "superseded" (US-2); the selection is in the shared
    // `closeOutcomePayload`, so that the modal and the card select the same way.
    const close: TransitionCloseInput = closeOutcomePayload(outcome, target);
    onSubmit(reason.trim(), close);
  };

  return (
    <Modal
      opened={opened}
      onClose={() => {
        if (loading) return;
        onClose();
      }}
      title={title}
      centered
      size="md"
      closeOnEscape={!loading}
      closeOnClickOutside={!loading}
    >
      <Stack gap="md">
        {retire ? (
          <div className="status-change-reason-blurb">
            {t('statusReason.retireBlurb')}
          </div>
        ) : null}
        {picksOutcome ? (
          /* sk-489 (US-1) — the outcome pick before the reason: the outcome is machine-
             distinguishable and counts toward progress, the reason is free text.
             The same form as the edit control in the card header (US-12
             requires "as in the close modal"). */
          <CloseOutcomePicker
            value={outcome}
            onChange={setOutcome}
            target={target}
            onTargetChange={setTarget}
            targetRequired={targetRequired}
            disabled={loading}
          />
        ) : null}
        <Textarea
          ref={textareaRef}
          label={
            retire
              ? t('statusReason.reasonLabelRetire')
              : t('statusReason.reasonLabel')
          }
          placeholder={placeholder}
          minRows={3}
          maxRows={8}
          autosize
          value={reason}
          onChange={(e) => setReason(e.currentTarget.value)}
          disabled={loading}
          classNames={{ input: 'status-change-reason-textarea' }}
        />
        {hasStandingChildren ? (
          <div role="alert" className="status-change-reason-alert">
            <div>{t('statusReason.standingChildren')}</div>
            <ul className="status-change-reason-alert-list">
              {standingChildIds!.map((cid) => (
                <li key={cid}>{cid}</li>
              ))}
            </ul>
          </div>
        ) : error ? (
          <div role="alert" className="status-change-reason-alert">
            {error}
          </div>
        ) : null}
        <Group justify="flex-end" gap="sm">
          <Button
            variant="outline"
            color="orange"
            disabled={loading}
            onClick={onClose}
            size="sm"
          >
            {t('common:cancel')}
          </Button>
          {/* sk-285.7.2.85 — the same omission the audit measured on
              «Move issue» (N-5): `theme.ts` makes `default` the default
              variant and `default` IGNORES `color`, so this button drew
              the same box as the Cancel beside it and the dialog had no
              confirming action — in BOTH branches, retire and ordinary.
              The retire branch does not get `color="red"` back: filled
              `red` is a builtin Mantine ramp at 3.28:1 (sk-381). It
              takes the product's own destructive plate instead; see
              `DANGER_BUTTON_VARS`. */}
          <Button
            variant="filled"
            {...(retire ? { style: DANGER_BUTTON_VARS } : { color: 'orange' })}
            loading={loading}
            // sk-540.2 — a required target that is still blank.
            disabled={blocked}
            onClick={submit}
            size="sm"
          >
            {retire ? t('statusReason.verbRetire') : t('statusReason.ok')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
