/**
 * usePush — Web Push registration + subscription state machine.
 * sk push phase 1.
 *
 * Owns the browser side of Web Push:
 *   - feature-detection (SW + PushManager + Notification),
 *   - registering `/sw.js` at scope `/`,
 *   - subscribe() / unsubscribe() against the backend,
 *   - exposing `permission` / `supported` / `subscribed`,
 *   - a login re-sync that re-POSTs the live subscription so the server
 *     record can't drift from the browser's (e.g. after the server DB was
 *     reset, or the subscription was created on another login).
 *
 * The soft-ask banner (PushSoftAsk) calls `Notification.requestPermission`
 * inside a user gesture and then `subscribe()` — this hook NEVER prompts
 * on its own. A load-time prompt that gets dismissed permanently blocks
 * future asks, so permission requests are strictly gesture-driven.
 *
 * Data layer: the canonical `pushManager.getSubscription()` lives in
 * browser/SW state, not the server, so subscribe/unsubscribe are plain
 * imperative async actions wrapped as TanStack mutations only for the
 * shared error toast + cache invalidation. The DEVICE LIST (settings,
 * separate ticket) is a normal query keyed `['push','devices']`; we bust
 * it here so it stays fresh after subscribe/unsubscribe.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  deleteSubscription,
  getPushConfig,
  registerSubscription,
} from '../api/push';
import { urlBase64ToUint8Array } from './urlBase64';
import { useToaster } from '../components/Toaster';

/** Query key for the device list (consumed by the settings page ticket). */
export const pushDevicesKey = ['push', 'devices'] as const;

export type NotificationPermissionState = 'default' | 'granted' | 'denied';

export interface UsePushResult {
  /**
   * Whether the browser exposes the full Web Push surface
   * (serviceWorker + PushManager + Notification). When false every other
   * field is inert and the soft-ask must not render.
   */
  supported: boolean;
  /** Live `Notification.permission`, normalized. `'default'` when unsupported. */
  permission: NotificationPermissionState;
  /** True when a `PushSubscription` currently exists in this browser. */
  subscribed: boolean;
  /** True while a subscribe/unsubscribe round-trip is in flight. */
  busy: boolean;
  /**
   * Request permission (if needed) and create + register a subscription.
   * Safe to call only from a user gesture. Resolves true on success.
   * No-op returning false when unsupported, denied, or push is disabled
   * server-side (empty VAPID key).
   */
  subscribe: () => Promise<boolean>;
  /** Tear down the subscription locally and remove it from the backend. */
  unsubscribe: () => Promise<boolean>;
}

function detectSupport(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window &&
    'Notification' in window
  );
}

function currentPermission(supported: boolean): NotificationPermissionState {
  if (!supported) return 'default';
  return Notification.permission as NotificationPermissionState;
}

/**
 * Register (or reuse) the `/sw.js` service worker at scope `/`.
 * `navigator.serviceWorker.register` is idempotent — calling it for an
 * already-registered SW returns the existing registration.
 */
async function ensureRegistration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration('/');
  if (existing) return existing;
  return navigator.serviceWorker.register('/sw.js', { scope: '/' });
}

/**
 * Create a fresh subscription (or reuse the existing one) and POST it to
 * the backend. Returns true on success, false when push is unavailable
 * (no VAPID key). Throws on unexpected failures so the mutation surfaces
 * a toast.
 */
async function doSubscribe(): Promise<boolean> {
  const { publicKey } = await getPushConfig();
  if (!publicKey) return false; // push disabled server-side

  const registration = await ensureRegistration();
  // Wait for the worker to be active before subscribing — a brand-new
  // registration may still be installing.
  await navigator.serviceWorker.ready;

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }

  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    throw new Error('subscription is missing endpoint/keys');
  }
  await registerSubscription({
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    ua: navigator.userAgent,
  });
  return true;
}

async function doUnsubscribe(): Promise<boolean> {
  const registration = await navigator.serviceWorker.getRegistration('/');
  if (!registration) return false;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return false;

  const { endpoint } = subscription.toJSON();
  // Remove the server row FIRST. If the DELETE fails we deliberately keep the
  // local subscription (and let the error propagate) so the user can retry —
  // unsubscribing locally first would orphan the server device row, which this
  // browser could no longer delete once its endpoint is gone.
  if (endpoint) {
    await deleteSubscription(endpoint);
  }
  await subscription.unsubscribe();
  return true;
}

export function usePush(): UsePushResult {
  const supported = useMemo(detectSupport, []);
  const qc = useQueryClient();
  const toast = useToaster();

  const [permission, setPermission] = useState<NotificationPermissionState>(() =>
    currentPermission(supported),
  );
  const [subscribed, setSubscribed] = useState(false);

  const refreshSubscribed = useCallback(async () => {
    if (!supported) return;
    try {
      const registration = await navigator.serviceWorker.getRegistration('/');
      const sub = registration
        ? await registration.pushManager.getSubscription()
        : null;
      setSubscribed(!!sub);
    } catch {
      setSubscribed(false);
    }
  }, [supported]);

  // On mount: register the SW, read the current subscription, and (when
  // permission is already granted) re-POST the live subscription so the
  // server record can't drift from the browser. This is the login
  // re-sync — cheap, idempotent, and covers the "server DB reset" /
  // "subscribed on another tab" cases without a banner round-trip.
  useEffect(() => {
    if (!supported) return;
    let cancelled = false;

    void (async () => {
      try {
        await ensureRegistration();
      } catch {
        // SW registration blocked (e.g. insecure context) — nothing else
        // works; bail quietly. `supported` stays true but actions no-op.
        return;
      }
      if (cancelled) return;
      await refreshSubscribed();
      if (cancelled) return;

      if (currentPermission(supported) === 'granted') {
        try {
          // Re-sync only if we already have (or can get) a subscription;
          // doSubscribe reuses the existing one and re-POSTs it.
          await doSubscribe();
          if (!cancelled) {
            await refreshSubscribed();
          }
        } catch {
          // Re-sync is best-effort — a failure here must not surface a
          // toast on every page load. The explicit subscribe() path
          // (from the banner) does surface errors.
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [supported, refreshSubscribed]);

  const subscribeMutation = useMutation<boolean, Error, void>({
    mutationFn: () => doSubscribe(),
    onSuccess: async (ok) => {
      if (ok) {
        await refreshSubscribed();
        void qc.invalidateQueries({ queryKey: pushDevicesKey });
        toast.success('Desktop notifications on');
      } else {
        toast.info('Push notifications disabled on the server');
      }
    },
    onError: (err) =>
      toast.error(`Couldn't enable notifications: ${err.message || 'error'}`),
  });

  const unsubscribeMutation = useMutation<boolean, Error, void>({
    mutationFn: () => doUnsubscribe(),
    onSuccess: async () => {
      await refreshSubscribed();
      void qc.invalidateQueries({ queryKey: pushDevicesKey });
      toast.success('Desktop notifications off');
    },
    onError: (err) =>
      toast.error(`Couldn't disable notifications: ${err.message || 'error'}`),
  });

  const subscribe = useCallback(async (): Promise<boolean> => {
    if (!supported) return false;
    if (Notification.permission === 'default') {
      const result = await Notification.requestPermission();
      setPermission(result as NotificationPermissionState);
      if (result !== 'granted') return false;
    } else if (Notification.permission === 'denied') {
      setPermission('denied');
      return false;
    } else {
      setPermission('granted');
    }
    return subscribeMutation.mutateAsync();
  }, [supported, subscribeMutation]);

  const unsubscribe = useCallback(async (): Promise<boolean> => {
    if (!supported) return false;
    return unsubscribeMutation.mutateAsync();
  }, [supported, unsubscribeMutation]);

  return {
    supported,
    permission,
    subscribed,
    busy: subscribeMutation.isPending || unsubscribeMutation.isPending,
    subscribe,
    unsubscribe,
  };
}
