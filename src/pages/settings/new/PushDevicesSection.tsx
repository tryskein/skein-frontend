import {
  Alert,
  Badge,
  Box,
  Button,
  Code,
  Group,
  Loader,
  Stack,
  Switch,
  Text,
} from '@mantine/core';
import { useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import type { PushDevice } from '../../../api/push';
import type { PushActionResult } from '../../../lib/push/pushLifecycle';
import { usePush } from '../../../lib/usePush';
import { parseUserAgent } from '../../../lib/parseUserAgent';
import { SettingsPanel } from './SettingsLayout';
import { ERR_ALERT_VARS, INFO_BADGE_VARS, WARN_ALERT_VARS } from '../../../lib/mantineVariantVars';

/**
 * PushDevicesSection — push on THIS browser plus the caller's list of
 * registered devices, each removable.
 *
 * Devices are not a reason (sk-303.13 / US-1): what the settings table
 * configures is which reasons reach which channel, and that answer is the same
 * on every device the caller owns. Which browsers are subscribed is a separate
 * question with a separate contract, so it lives in its own block beside the
 * table.
 *
 *   1. Push ON THIS DEVICE — the switch calls the explicit actions of the push
 *      controller (`lib/push/pushLifecycle.ts`) through `usePush`: turning it
 *      on calls the enable action directly in the click (the permission
 *      prompt needs the gesture); turning it off revokes this device on the
 *      server, then removes its channel. While the server has not confirmed
 *      a disable and this device's subscription is still listed, "not
 *      confirmed" is shown with a retry.
 *   2. The caller's devices, as the decision of this appearance read them.
 *      Removing the current device is the disable above; removing another
 *      one removes it on the server by id (`POST /push/device-removals`).
 *
 * Unsupported browsers, a blocked permission and push turned off on the
 * server get an explanatory callout instead of the switch.
 */

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

type FailureReason = Extract<PushActionResult, { kind: 'failed' }>['reason'];

export function PushDevicesSection() {
  const { t } = useTranslation('push');
  const { state, enable, disable, removeDevice } = usePush();
  const { supported, permission, consent, devices, thisDeviceHash } = state;

  // The last failed explicit action; `channel` is the browser failing to
  // reach its push service (see the help callout below).
  const [failure, setFailure] = useState<FailureReason | null>(null);
  const [busy, setBusy] = useState(false);
  // Brave disables Google push by default — when detected we lead the callout
  // with the Brave-specific fix. navigator.brave.isBrave() is async + Brave-only.
  const [isBrave, setIsBrave] = useState(false);
  useEffect(() => {
    const brave = (
      navigator as Navigator & { brave?: { isBrave?: () => Promise<boolean> } }
    ).brave;
    brave?.isBrave?.().then(setIsBrave).catch(() => undefined);
  }, []);

  const settle = (action: Promise<PushActionResult>) => {
    setFailure(null);
    setBusy(true);
    void action
      .then((result) => setFailure(result.kind === 'failed' ? result.reason : null))
      .finally(() => setBusy(false));
  };

  // The channel could not be read (row 0) and this browser holds no mark:
  // a subscription of the user listed here may be this device's (one made
  // before the consent existed), so the switch offers to turn it off — the
  // disable records "explicitly off" and row 7 removes it by its endpoint
  // once the channel is read (US-3).
  const maybeThisDevice = state.row === 0 && consent?.state === 'none' && (devices?.length ?? 0) > 0;
  const enabled = consent?.state === 'enabled' || maybeThisDevice;
  const thisDeviceListed =
    thisDeviceHash !== null && (devices ?? []).some((d) => d.endpointHash === thisDeviceHash);
  const offUnconfirmed = consent?.state === 'off' && consent.offUnconfirmed && thisDeviceListed;

  // Called directly by the switch: the enable action must start in the click.
  const onToggleDevicePush = (checked: boolean) => {
    settle(checked ? enable() : disable());
  };

  const [removingId, setRemovingId] = useState<string | null>(null);
  const onRemove = (device: PushDevice) => {
    setRemovingId(device.id);
    const action = device.endpointHash === thisDeviceHash ? disable() : removeDevice(device.id);
    settle(action.finally(() => setRemovingId(null)));
  };

  // The current device first; otherwise the server order (newest first).
  const sortedDevices = [...(devices ?? [])].sort((a, b) => {
    const aCur = thisDeviceHash !== null && a.endpointHash === thisDeviceHash;
    const bCur = thisDeviceHash !== null && b.endpointHash === thisDeviceHash;
    if (aCur === bCur) return 0;
    return aCur ? -1 : 1;
  });

  return (
    <Stack gap="xl">
        {/* ── 1. This device ─────────────────────────────────────── */}
        <SettingsPanel
          title={t('device.title')}
          description={t('device.description')}
        >
          {!supported ? (
            <Alert
              variant="light"
              style={WARN_ALERT_VARS}
              title={t('device.unsupportedTitle')}
            >
              {t('device.unsupportedBody')}
            </Alert>
          ) : permission === 'denied' ? (
            <Alert variant="light" style={ERR_ALERT_VARS} title={t('device.deniedTitle')}>
              {t('device.deniedBody')}
            </Alert>
          ) : state.serverPush === 'disabled' ? (
            <Alert variant="light" style={WARN_ALERT_VARS} title={t('device.serverDisabledTitle')}>
              {t('device.serverDisabledBody')}
            </Alert>
          ) : (
            <Stack gap="sm">
              <Switch
                size="md"
                checked={enabled}
                disabled={busy || devices === null}
                onChange={(e) => onToggleDevicePush(e.currentTarget.checked)}
                label={enabled ? t('device.switchOn') : t('device.switchOff')}
              />
              <Text size="sm" c="var(--ink-2)">
                {t('device.permission')}{' '}
                <Text component="span" fw={600}>
                  {t(`device.permissionLabels.${permission}`, {
                    defaultValue: permission,
                  })}
                </Text>
              </Text>
            </Stack>
          )}

          {supported && permission !== 'denied' && state.decided && state.serverPush === 'unknown' ? (
            <Alert variant="light" style={WARN_ALERT_VARS} title={t('device.serverUnknownTitle')} mt="sm">
              {t('device.serverUnknownBody')}
            </Alert>
          ) : null}

          {supported && offUnconfirmed ? (
            <Alert variant="light" style={WARN_ALERT_VARS} title={t('device.offUnconfirmedTitle')} mt="sm">
              <Stack gap="xs" align="flex-start">
                <Text size="sm">{t('device.offUnconfirmedBody')}</Text>
                <Button size="xs" variant="default" loading={busy} onClick={() => settle(disable())}>
                  {t('device.offUnconfirmedRetry')}
                </Button>
              </Stack>
            </Alert>
          ) : null}

          {failure !== null && failure !== 'channel' ? (
            <Alert variant="light" style={ERR_ALERT_VARS} mt="sm">
              {t(`device.failed.${failure}`)}
            </Alert>
          ) : null}

          {failure === 'channel' && supported && permission !== 'denied' ? (
            <Alert
              color="orange"
              variant="light"
              title={t('device.serviceErrorTitle')}
              mt="sm"
            >
              <Stack gap="xs">
                <Text size="sm">{t('device.serviceErrorBody')}</Text>
                <Text size="sm">
                  {/* <Trans> keeps the inline <b> / <code> emphasis inside a
                      translatable sentence — splitting it into prefix /
                      suffix keys would force every language into English
                      word order. */}
                  <Trans
                    i18nKey={isBrave ? 'device.braveKnown' : 'device.braveMaybe'}
                    ns="push"
                    components={{ b: <b />, code: <Code /> }}
                  />
                </Text>
              </Stack>
            </Alert>
          ) : null}
        </SettingsPanel>

        {/* ── 2. Registered devices ──────────────────────────────── */}
        {supported ? (
          <SettingsPanel
            title={t('devices.title')}
            description={t('devices.description')}
          >
            {devices === null && state.row === null ? (
              <Box className="settings-loading" role="status" aria-live="polite">
                <Loader size="sm" aria-hidden="true" />
                <span className="sr-only">{t('devices.loading')}</span>
              </Box>
            ) : devices === null ? (
              <Alert variant="light" style={ERR_ALERT_VARS} title={t('devices.error')}>
                {t('devices.loadFailed')}
              </Alert>
            ) : sortedDevices.length === 0 ? (
              <Text size="sm" c="var(--ink-2)">
                {t('devices.empty')}
              </Text>
            ) : (
              // A homogeneous set of revocable rows is a list: AT should hear
              // "list, N items" and be able to walk it, which a bare
              // stack of <div>s does not offer.
              <Stack component="ul" gap="sm" className="settings-device-list">
                {sortedDevices.map((d) => {
                  const isCurrent = thisDeviceHash !== null && d.endpointHash === thisDeviceHash;
                  return (
                    <Group
                      component="li"
                      key={d.id}
                      justify="space-between"
                      wrap="nowrap"
                      align="flex-start"
                    >
                      <Box style={{ minWidth: 0 }}>
                        <Group gap="xs" wrap="nowrap" align="center">
                          <Text
                            size="sm"
                            fw={600}
                            style={{ wordBreak: 'break-word' }}
                          >
                            {parseUserAgent(d.ua)}
                          </Text>
                          {isCurrent ? (
                            <Badge size="sm" variant="light" style={INFO_BADGE_VARS}>
                              {t('devices.thisDevice')}
                            </Badge>
                          ) : null}
                        </Group>
                        <Text size="xs" c="var(--ink-2)">
                          {t('devices.meta', { created: formatTime(d.createdAt), lastSeen: formatTime(d.lastSeenAt) })}
                        </Text>
                      </Box>
                      <Button
                        variant="default"
                        size="xs"
                        loading={removingId === d.id}
                        disabled={removingId !== null && removingId !== d.id}
                        aria-label={t('devices.unsubscribeAria', {
                          device: parseUserAgent(d.ua),
                        })}
                        onClick={() => onRemove(d)}
                      >
                        {t('devices.unsubscribe')}
                      </Button>
                    </Group>
                  );
                })}
              </Stack>
            )}
          </SettingsPanel>
        ) : null}

    </Stack>
  );
}
