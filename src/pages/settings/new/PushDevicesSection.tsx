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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../auth/AuthContext';
import { ApiError, BusinessError } from '../../../api/client';
import { PushDevice, deleteSubscriptionById, listPushDevices } from '../../../api/push';
import { usePush, pushDevicesKey } from '../../../lib/usePush';
import { parseUserAgent } from '../../../lib/parseUserAgent';
import { sha256Hex } from '../../../lib/sha256';
import { SettingsPanel } from './SettingsLayout';
import { ERR_ALERT_VARS, INFO_BADGE_VARS, WARN_ALERT_VARS } from '../../../lib/mantineVariantVars';

/**
 * PushDevicesSection — enabling push in THIS browser plus the caller's list of
 * registered devices, each revocable.
 *
 * Devices are not a reason (sk-303.13 / US-1): what the settings table
 * configures is which reasons reach which channel, and that answer is the same
 * on every device the caller owns. Which browsers are subscribed is a separate
 * question with a separate contract, so it lives in its own block beside the
 * table rather than as rows inside it. What went away from the old push page
 * is only the CATEGORY switches — a second vocabulary of channels, which the
 * reason table now owns.
 *
 *   1. Enable/disable push ON THIS DEVICE — drives usePush.subscribe() /
 *      unsubscribe(). The hook owns all subscription mechanics; this block
 *      only renders state and triggers the gesture.
 *   2. The caller's registered devices (GET /push/subscriptions). ANY device
 *      can be removed here: the current browser via usePush.unsubscribe()
 *      (tears down the local subscription + server row by endpoint), every
 *      other device via DELETE /push/subscriptions/{id}. The current device is
 *      identified by hashing this browser's live endpoint (SHA-256) and
 *      matching it against each row's `endpointHash`, then badged + sorted to
 *      the top.
 *
 * Unsupported / denied browsers see an explanatory callout instead of a dead
 * toggle.
 */

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

function describeError(
  err: unknown,
  fallback: string,
  internalError: string,
): string {
  if (err instanceof BusinessError) return err.message;
  if (err instanceof ApiError) return err.message || internalError;
  if (err instanceof Error) return err.message || fallback;
  return fallback;
}

// A failed pushManager.subscribe() that means "the browser couldn't reach its
// push service" (Google FCM for Chromium): Chrome/Brave throw AbortError with
// "Registration failed - push service error". The whole Skein pipeline is fine
// (Firefox, which uses Mozilla autopush, works) — this is a browser/profile
// limitation, most often Brave with Google push disabled. We surface a
// callout so users don't read it as a Skein bug.
function isPushServiceError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const m = err.message.toLowerCase();
  return (
    err.name === 'AbortError' ||
    m.includes('push service') ||
    m.includes('registration failed')
  );
}

export function PushDevicesSection() {
  const { t } = useTranslation('push');
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { supported, permission, subscribed, busy, subscribe, unsubscribe } =
    usePush();

  // Set when subscribe() fails because the browser couldn't reach its push
  // service (see isPushServiceError). Drives the help callout below; cleared
  // on a fresh attempt / unsubscribe.
  const [pushServiceError, setPushServiceError] = useState(false);
  // Brave disables Google push by default — when detected we lead the callout
  // with the Brave-specific fix. navigator.brave.isBrave() is async + Brave-only.
  const [isBrave, setIsBrave] = useState(false);
  useEffect(() => {
    const brave = (
      navigator as Navigator & { brave?: { isBrave?: () => Promise<boolean> } }
    ).brave;
    brave?.isBrave?.().then(setIsBrave).catch(() => undefined);
  }, []);

  const devicesQuery = useQuery({
    queryKey: pushDevicesKey,
    queryFn: listPushDevices,
    enabled: !!user && supported,
  });

  // SHA-256 hex of THIS browser's live push endpoint, used to spot the
  // current device in the list (the raw endpoint never leaves the server,
  // so we hash our own endpoint the same way the backend does and match on
  // the digest). Null when there's no SW / no active subscription / no
  // crypto.subtle → nothing is highlighted. Recomputed when the local
  // subscription state flips so it tracks subscribe/unsubscribe.
  const [currentEndpointHash, setCurrentEndpointHash] = useState<string | null>(
    null,
  );
  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    void (async () => {
      try {
        const reg = await navigator.serviceWorker.getRegistration('/');
        const sub = reg ? await reg.pushManager.getSubscription() : null;
        const endpoint = sub?.endpoint;
        if (!endpoint || !crypto?.subtle) {
          if (!cancelled) setCurrentEndpointHash(null);
          return;
        }
        const hash = await sha256Hex(endpoint);
        if (!cancelled) setCurrentEndpointHash(hash);
      } catch {
        if (!cancelled) setCurrentEndpointHash(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supported, subscribed]);

  // Per-row unsubscribe. For the CURRENT device we route through
  // usePush.unsubscribe() so the LOCAL browser subscription is torn down too
  // (not just the server row); every other device is a plain id-based delete.
  // Both end by invalidating the device list so it refreshes.
  const [removingId, setRemovingId] = useState<string | null>(null);
  const removeDeviceMutation = useMutation<void, Error, PushDevice>({
    mutationFn: async (device) => {
      if (
        currentEndpointHash &&
        device.endpointHash === currentEndpointHash
      ) {
        await unsubscribe();
        return;
      }
      await deleteSubscriptionById(device.id);
    },
    onMutate: (device) => setRemovingId(device.id),
    onSettled: () => {
      setRemovingId(null);
      void queryClient.invalidateQueries({ queryKey: pushDevicesKey });
    },
  });

  // Sort the current device to the top; otherwise keep the server order
  // (newest-first is the backend's ordering). A pure copy — never mutate the
  // query cache array in place.
  const sortedDevices = [...(devicesQuery.data ?? [])].sort((a, b) => {
    const aCur = !!currentEndpointHash && a.endpointHash === currentEndpointHash;
    const bCur = !!currentEndpointHash && b.endpointHash === currentEndpointHash;
    if (aCur === bCur) return 0;
    return aCur ? -1 : 1;
  });

  const onToggleDevicePush = async (checked: boolean) => {
    if (checked) {
      setPushServiceError(false);
      try {
        await subscribe();
      } catch (err) {
        // usePush already surfaces a toast; we additionally show a persistent
        // callout (and swallow here so the rejection doesn't hit the console)
        // when the failure is the browser↔push-service handshake.
        if (isPushServiceError(err)) setPushServiceError(true);
      }
    } else {
      setPushServiceError(false);
      await unsubscribe();
    }
  };

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
          ) : (
            <Stack gap="sm">
              <Switch
                size="md"
                checked={subscribed}
                disabled={busy}
                onChange={(e) => void onToggleDevicePush(e.currentTarget.checked)}
                label={
                  subscribed ? t('device.switchOn') : t('device.switchOff')
                }
              />
              <Text size="sm" c="var(--ink-2)">
                Browser permission:{' '}
                <Text component="span" fw={600}>
                  {t(`device.permissionLabels.${permission}`, {
                    defaultValue: permission,
                  })}
                </Text>
                .
              </Text>
            </Stack>
          )}

          {pushServiceError && supported && permission !== 'denied' ? (
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
                {isBrave ? (
                  <Text size="sm">
                    <strong>Brave</strong> disables Google push by default. Open{' '}
                    <Code>brave://settings/privacy</Code>, turn on "Use Google
                    services for push messaging" and <strong>fully restart
                    Brave</strong>. If that doesn't help — create a new Brave
                    profile or use Chrome / Edge / Firefox.
                  </Text>
                ) : (
                  <Text size="sm">
                    If this is <strong>Brave</strong> — open{' '}
                    <Code>brave://settings/privacy</Code>, turn on "Use Google
                    services for push messaging" and restart the browser.
                    Otherwise try Chrome, Edge or Firefox on desktop and check
                    that the network / VPN isn't blocking Google services.
                  </Text>
                )}
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
            {devicesQuery.isLoading ? (
              <Box className="settings-loading" role="status" aria-live="polite">
                <Loader size="sm" aria-hidden="true" />
                <span className="sr-only">Loading devices</span>
              </Box>
            ) : devicesQuery.error ? (
              <Alert variant="light" style={ERR_ALERT_VARS} title={t('devices.error')}>
                {describeError(
                  devicesQuery.error,
                  t('devices.loadFailed'),
                  t('internalError'),
                )}
              </Alert>
            ) : sortedDevices.length === 0 ? (
              <Text size="sm" c="var(--ink-2)">
                No devices with push enabled yet.
              </Text>
            ) : (
              // A homogeneous set of revocable rows is a list: AT should hear
              // "list, N items" and be able to walk it, which a bare
              // stack of <div>s does not offer.
              <Stack component="ul" gap="sm" className="settings-device-list">
                {sortedDevices.map((d) => {
                  const isCurrent =
                    !!currentEndpointHash &&
                    d.endpointHash === currentEndpointHash;
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
                          added {formatTime(d.createdAt)} · active{' '}
                          {formatTime(d.lastSeenAt)}
                        </Text>
                      </Box>
                      <Button
                        variant="default"
                        size="xs"
                        loading={
                          removeDeviceMutation.isPending && removingId === d.id
                        }
                        disabled={
                          removeDeviceMutation.isPending && removingId !== d.id
                        }
                        aria-label={t('devices.unsubscribeAria', {
                          device: parseUserAgent(d.ua),
                        })}
                        onClick={() => removeDeviceMutation.mutate(d)}
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
