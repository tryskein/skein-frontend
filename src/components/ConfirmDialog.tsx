import { Group, Modal, Stack, Text } from '@mantine/core';
import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * ConfirmDialog wraps a Mantine <Modal> with a cancel / confirm pair of
 * shell buttons. Used by archive / unarchive / remove confirmation flows.
 *
 * sk-551.28 — the default labels are plain words. They used to read
 * `[ n · cancel ]` / `[ y · confirm ]`, the CRT dialect sk-414.2 retired
 * from the callers' own labels; the defaults were missed, so a delete
 * dialog paired «Delete» with «[ n · cancel ]» and promised a key that
 * was never bound.
 *
 * sk-397 — colours are read from the roles of the new vocabulary (`--ink`, `--err`), NOT
 * from the `--skein-*` bridge. The bridge is declared twice: the amber values of the CRT skin
 * on `:root` (`legacy.css`) and a remap to roles under `.col-details`
 * (`index.css`). This dialog is a `<Modal>`, that is a portal straight into `body`:
 * `.col-details` will NEVER be above it, even when it was opened
 * by a button inside the column. So the bridge here always gave the amber
 * `#e85d3d` — the same on the light and the dark theme, missing `--err`,
 * which differs between them. Lifting the bridge to `:root` was impossible: it is
 * already on `:root`, and for exactly that reason — the login page keeps the amber look.
 */
export interface ConfirmDialogProps {
  opened: boolean;
  title?: ReactNode;
  message: ReactNode;
  /** Default: the translated `common:confirmDialog.confirm`. */
  confirmLabel?: string;
  /** Default: the translated `common:confirmDialog.cancel`. */
  cancelLabel?: string;
  /** When true, Confirm button shows a spinner and disables both buttons. */
  loading?: boolean;
  /** When true, Confirm uses the danger-tinted (still orange, no yellow). */
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  opened,
  title,
  message,
  confirmLabel,
  cancelLabel,
  loading,
  danger,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  // Defaults are resolved here rather than in the parameter list: a
  // default parameter would be evaluated before `t` exists, and the
  // fallback must follow the active language, not the module load order.
  const { t } = useTranslation('common');
  const resolvedTitle = title ?? t('confirmDialog.title');
  const resolvedConfirm = confirmLabel ?? t('confirmDialog.confirm');
  const resolvedCancel = cancelLabel ?? t('confirmDialog.cancel');
  return (
    <Modal
      opened={opened}
      onClose={onCancel}
      title={resolvedTitle}
      centered
      withCloseButton={false}
      size="md"
    >
      <Stack gap="md">
        <Text
          style={{
            color: 'var(--ink)',
            fontSize: 'var(--font-base)',
            whiteSpace: 'pre-wrap',
          }}
        >
          {message}
        </Text>
        {/* sk-514 (5) — SHELL BUTTONS, not the stock Mantine ones.
            Stock package buttons stood here and were given an
            orange palette: the package's palette, not a theme role, and a shape
            that exists nowhere else in the panel. Right next to it
            in the same shell every "cancel / action" pair is drawn with the
            classes `action-button` and `action-button primary`, and a
            destructive action has its own `danger` — so the language for
            this dialog existed, and the dialog did not speak it.

            Danger is expressed by a CLASS, not by an inline colour: before,
            `--err` was put into `backgroundColor`, bypassing the sheet rule,
            and hover with focus came from the package's orange button.
            `.action-button.primary.danger` carries all three states. */}
        <Group justify="flex-end" gap="sm">
          <button
            type="button"
            className="action-button"
            disabled={loading}
            onClick={onCancel}
          >
            {resolvedCancel}
          </button>
          <button
            type="button"
            className={danger ? 'action-button primary danger' : 'action-button primary'}
            disabled={loading}
            onClick={onConfirm}
          >
            {loading ? <span className="detail-spinner" aria-hidden /> : null}
            {resolvedConfirm}
          </button>
        </Group>
      </Stack>
    </Modal>
  );
}
