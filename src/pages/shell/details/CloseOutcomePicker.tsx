import { Group, Radio, Stack, TextInput } from '@mantine/core';
import { useTranslation } from 'react-i18next';

import type { CloseOutcome, KnownCloseOutcome } from '../../../api/issues';
import {
  KNOWN_CLOSE_OUTCOMES,
  closeOutcomeAcceptsTarget,
  closeOutcomeLabelKey,
} from '../../../lib/closeOutcome';

/**
 * sk-489 — the close outcome picker: four values and a target.
 *
 * sk-540.2 — the target is REQUIRED with "duplicate" / "superseded"; whether the
 * exceptions of an already closed issue apply is the caller's call
 * (`lib/closeOutcome.ts#closeTargetRequired`), passed in as `targetRequired`
 * — the picker only marks the field, and each caller gates its own OK.
 *
 * ONE form for the two places that ask for it: the close modal (US-1,
 * `StatusChangeReasonModal.tsx`) and the edit control in the card header
 * (US-12, `CloseOutcomeControl.tsx`). US-12 explicitly requires the target
 * to be asked "as in the close modal" — and two copies of one form
 * diverge on the first edit, and diverge silently: both keep
 * working, just differently.
 *
 * A radio group, not a dropdown: there are four values, and all four are
 * visible at once, without opening anything. The labels are taken through
 * `lib/closeOutcome.ts#closeOutcomeLabelKey` — the same way the
 * card and the epic section rows take them.
 *
 * An UNKNOWN current value (the api is newer than us, INV-2) selects no
 * button — and this is the right display, not a lost state:
 * substituting "done" would lie about the current outcome, and adding a
 * fifth button would print a foreign string as our own option.
 */
export interface CloseOutcomePickerProps {
  /** The current value. An unfamiliar one selects no button. */
  value: CloseOutcome;
  onChange: (next: KnownCloseOutcome) => void;
  /** The target of the "duplicate" / "superseded" link. The field is shown only with them. */
  target: string;
  onTargetChange: (next: string) => void;
  /**
   * sk-540.2 — the target field is required for the current pick: marked
   * required (asterisk and `required` on the input). The caller keeps its
   * confirm button disabled while it is empty.
   */
  targetRequired?: boolean;
  disabled?: boolean;
}

export function CloseOutcomePicker({
  value,
  onChange,
  target,
  onTargetChange,
  targetRequired,
  disabled,
}: CloseOutcomePickerProps) {
  const { t } = useTranslation('details');
  const acceptsTarget = closeOutcomeAcceptsTarget(value);

  return (
    <Stack gap="md">
      <Radio.Group
        label={t('closeOutcome.modalLabel')}
        value={value}
        onChange={(v) => onChange(v as KnownCloseOutcome)}
      >
        <Group gap="md" mt="xs">
          {KNOWN_CLOSE_OUTCOMES.map((o) => (
            <Radio
              key={o}
              value={o}
              label={t(closeOutcomeLabelKey(o)!)}
              disabled={disabled}
            />
          ))}
        </Group>
      </Radio.Group>
      {acceptsTarget ? (
        <TextInput
          label={t('closeOutcome.modalTargetLabel')}
          description={t('closeOutcome.modalTargetDescription')}
          placeholder={t('closeOutcome.modalTargetPlaceholder')}
          value={target}
          onChange={(e) => onTargetChange(e.currentTarget.value)}
          required={!!targetRequired}
          disabled={disabled}
        />
      ) : null}
    </Stack>
  );
}

/**
 * The pick payload: the outcome always, the target only for outcomes
 * that accept it, and only if non-empty.
 *
 * Shared by both callers for the same reason as the form itself: target text
 * left over from a previous pick must not go on the wire from either
 * the modal or the card.
 */
export function closeOutcomePayload(
  outcome: KnownCloseOutcome,
  target: string,
): { closeOutcome: KnownCloseOutcome; closeTarget?: string } {
  const trimmed = target.trim();
  return closeOutcomeAcceptsTarget(outcome) && trimmed
    ? { closeOutcome: outcome, closeTarget: trimmed }
    : { closeOutcome: outcome };
}

/**
 * sk-540.2 — the confirm button's gate: a required target that is still
 * blank blocks the submit. Shared by both callers so the modal and the
 * card cannot disagree on what "blank" means.
 */
export function closeTargetMissing(targetRequired: boolean, target: string): boolean {
  return targetRequired && target.trim() === '';
}
