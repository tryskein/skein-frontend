import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Group, Modal, Stack, Text } from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import { TerminalLabel } from './TerminalLabel';

/**
 * SecretReveal is the one-shot reveal modal used by:
 *   - API keys creation (R2.1) — plain key shown once.
 *   - Magic link generation (R5.2) — login URL shown once.
 *
 * Behaviour contract:
 *   1. Modal cannot be dismissed by Escape, click-outside, or the X close
 *      button. The caller is responsible for ensuring the user has copied
 *      the secret to a safe place before closing.
 *   2. The "I've copied it, dismiss" button is disabled until the user
 *      has clicked Copy at least once. This nudges the user into actually
 *      transferring the secret instead of muscle-memory dismissing the
 *      dialog and losing the value forever.
 *   3. The value is shown verbatim in a code block — no obfuscation,
 *      since by definition it must be copyable.
 *   4. If the clipboard write fails (insecure context, permissions
 *      policy denial, Firefox without async clipboard), the dismiss
 *      button stays disabled and a manual-copy hint surfaces. The user
 *      can acknowledge with an explicit "I copied manually" affordance
 *      that enables the dismiss button.
 *
 * Reused as a building block for any "shown once, hash stored" flow —
 * keep the component generic (no `apiKey`-specific copy strings).
 *
 * sk-397 — colours are read from the roles of the new vocabulary (`--ink-2`, `--ink-3`,
 * `--primary`, `--elev`, `--line-2`, `--err`), not from the `--skein-*` bridge.
 * The full argument is in `ConfirmDialog.tsx`: the modal goes into a portal, and
 * the bridge remap under `.col-details` never reaches it, so
 * the warning "the key is shown once" was painted amber `#e85d3d`
 * in both themes. The role correspondence is taken from the bridge itself
 * (`index.css`, the `.col-details` block), so that inside the column and outside
 * the colour comes out the same.
 */
export interface SecretRevealProps {
  /** Controls visibility. Caller wires this to its own state. */
  opened: boolean;
  /** Called only after the user clicks "I've copied it, dismiss". */
  onDismiss: () => void;
  /** Modal title — usually "API Key Created" or "Magic Link". */
  title: string;
  /** The secret value to reveal. Rendered in a code block. */
  value: string;
  /** Description shown above the code block; explain what the value is. */
  description?: string;
  /** Warning shown below the value — defaults to a generic "stored as hash" line. */
  warning?: string;
}

const srOnlyStyle: React.CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0,0,0,0)',
  whiteSpace: 'nowrap',
  border: 0,
};

export function SecretReveal({
  opened,
  onDismiss,
  title,
  value,
  description,
  warning,
}: SecretRevealProps) {
  const { t } = useTranslation('secretReveal');
  // `copied` flips to true on first successful Copy click and stays true.
  // The dismiss button gates on this so a user cannot click through
  // without intentionally transferring the secret somewhere.
  const [copied, setCopied] = useState(false);
  // `copiedFlash` resets after a beat to show "copied!" feedback.
  const [copiedFlash, setCopiedFlash] = useState(false);
  // `copyFailed` indicates clipboard API rejected — show manual hint and
  // keep dismiss disabled until the user explicitly acknowledges.
  const [copyFailed, setCopyFailed] = useState(false);
  const [announce, setAnnounce] = useState('');
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  const onCopy = async () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setCopyFailed(false);
      setCopiedFlash(true);
      setAnnounce(t('announce.copied'));
      // 1.4s feedback window; long enough to register, short enough to
      // not feel sticky.
      timerRef.current = window.setTimeout(() => {
        setCopiedFlash(false);
        setAnnounce('');
        timerRef.current = null;
      }, 1400);
    } catch {
      // Clipboard API not available (e.g. http:// outside localhost,
      // permissions-policy denial). Do NOT mark `copied` — the user must
      // acknowledge they manually copied to enable the dismiss button.
      setCopyFailed(true);
      setCopiedFlash(false);
      setAnnounce(t('announce.copyFailed'));
    }
  };

  const onAcknowledgeManualCopy = () => {
    setCopied(true);
    setAnnounce(t('announce.manualAcknowledged'));
  };

  const handleDismiss = () => {
    // Reset internal state so a subsequent open starts fresh.
    setCopied(false);
    setCopiedFlash(false);
    setCopyFailed(false);
    setAnnounce('');
    onDismiss();
  };

  return (
    <Modal
      opened={opened}
      onClose={() => {
        /* deliberate no-op: dismissal goes through the button only */
      }}
      title={title}
      centered
      size="lg"
      withCloseButton={false}
      closeOnEscape={false}
      closeOnClickOutside={false}
      role="alertdialog"
      aria-describedby="secret-reveal-warning"
    >
      <Stack gap="md">
        {description ? (
          <Text
            size="sm"
            style={{
              color: 'var(--ink-2)',
            }}
          >
            {description}
          </Text>
        ) : null}

        <Stack gap={4}>
          <Text
            id="secret-reveal-value-label"
            size="xs"
            style={{
              color: 'var(--ink-3)',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            {t('valueLabel')}
          </Text>
          <code
            aria-labelledby="secret-reveal-value-label"
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--font-base)',
              color: 'var(--primary)',
              backgroundColor: 'var(--elev)',
              border: '1px solid var(--line-2)',
              padding: '10px 12px',
              wordBreak: 'break-all',
              userSelect: 'all',
              display: 'block',
            }}
          >
            {value}
          </code>
        </Stack>

        <Group gap="sm">
          <Button
            data-autofocus
            variant="filled"
            color="orange"
            size="sm"
            onClick={onCopy}
          >
            <TerminalLabel>{copiedFlash ? t('copied') : t('copy')}</TerminalLabel>
          </Button>
        </Group>

        {copyFailed ? (
          <Stack gap={4}>
            <Text
              size="xs"
              style={{
                color: 'var(--err)',
              }}
            >
              {t('clipboardUnavailable')}
            </Text>
            <Group gap="sm">
              <Button
                variant="subtle"
                color="orange"
                size="compact-xs"
                onClick={onAcknowledgeManualCopy}
              >
                <TerminalLabel>{t('acknowledgeManual')}</TerminalLabel>
              </Button>
            </Group>
          </Stack>
        ) : null}

        <Text
          id="secret-reveal-warning"
          size="xs"
          style={{
            color: 'var(--err)',
            border: '1px dashed var(--err)',
            padding: '8px 12px',
          }}
        >
          <IconAlertCircle size={16} stroke={1.75} aria-hidden />{' '}
          {warning ?? t('warningDefault')}
        </Text>

        <Group justify="flex-end" mt="sm">
          <Button
            variant="outline"
            color="orange"
            size="sm"
            disabled={!copied}
            onClick={handleDismiss}
          >
            <TerminalLabel>{t('dismiss')}</TerminalLabel>
          </Button>
        </Group>

        <span role="status" aria-live="polite" style={srOnlyStyle}>
          {announce}
        </span>
      </Stack>
    </Modal>
  );
}
