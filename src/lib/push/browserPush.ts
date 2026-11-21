/**
 * Browser side of Web Push for the push lifecycle: support, the current
 * channel, its creation and removal, and the notification permission.
 *
 * A browser profile holds at most one Skein channel: the push subscription of
 * the service worker registered at scope `/`.
 *
 * Push is supported only with a service worker, the Push API, notifications
 * and Web Locks together; without any of them the push parts of the page do
 * nothing (logout and settings keep working).
 *
 * Reading the channel distinguishes "no channel" from "could not read": a
 * browser error must never be taken for an absent channel (decision table,
 * row 0).
 */

import { urlBase64ToUint8Array } from '../urlBase64';
import { pushLocksSupported } from './locks';

/** Encryption keys of a channel, base64url as `PushSubscription.toJSON()` gives them. */
export interface ChannelKeys {
  p256dh: string;
  auth: string;
}

/** A push channel of this browser. */
export interface BrowserChannel {
  endpoint: string;
  keys: ChannelKeys;
}

/** Result of reading the current channel. */
export type ChannelRead =
  | { kind: 'none' }
  | { kind: 'channel'; channel: BrowserChannel }
  | { kind: 'unreadable' };

export type NotificationPermissionState = 'default' | 'granted' | 'denied';

const SW_SCOPE = '/';
const SW_URL = '/sw.js';

/**
 * Whether the browser has everything the push parts need: a service worker,
 * the Push API, notifications and Web Locks.
 */
export function browserPushSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window &&
    'Notification' in window &&
    pushLocksSupported()
  );
}

function toBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function channelOf(subscription: PushSubscription): BrowserChannel | null {
  const p256dh = subscription.getKey('p256dh');
  const auth = subscription.getKey('auth');
  if (!subscription.endpoint || p256dh === null || auth === null) return null;
  return { endpoint: subscription.endpoint, keys: { p256dh: toBase64Url(p256dh), auth: toBase64Url(auth) } };
}

/**
 * The current subscription. The browser's answers are awaited until `signal`
 * aborts (they cannot be cancelled): a caller holding `skein.push.op` must
 * not wait for a browser that does not answer longer than its step lives.
 */
async function currentSubscription(signal?: AbortSignal): Promise<PushSubscription | null> {
  const registration = await untilAborted(navigator.serviceWorker.getRegistration(SW_SCOPE), signal);
  if (!registration) return null;
  return untilAborted(registration.pushManager.getSubscription(), signal);
}

/**
 * Reads the current channel: `none` when the browser has none, `unreadable`
 * when the browser failed to answer, returned a channel without keys, or did
 * not answer before `signal` aborted.
 */
export async function readChannel(signal?: AbortSignal): Promise<ChannelRead> {
  try {
    const subscription = await currentSubscription(signal);
    if (subscription === null) return { kind: 'none' };
    const channel = channelOf(subscription);
    return channel === null ? { kind: 'unreadable' } : { kind: 'channel', channel };
  } catch {
    return { kind: 'unreadable' };
  }
}

async function ensureRegistration(precondition?: () => void): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration(SW_SCOPE);
  if (existing) return existing;
  precondition?.();
  return navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE });
}

/**
 * Resolves with `promise`, or rejects with the abort reason as soon as
 * `signal` aborts.
 */
function untilAborted<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return promise;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

/**
 * Creates a new channel with the server's VAPID public key (base64url).
 * Rejects when the browser refuses. `navigator.serviceWorker.ready` never
 * settles while no worker is active, so the wait for it ends when `signal`
 * aborts — the caller may hold the `skein.push.op` lock.
 *
 * `precondition` runs right before each effect — the registration of the
 * service worker and the subscription — after the waits that precede it,
 * and throws to stop the creation without that effect.
 */
export async function createChannel(
  publicKey: string,
  signal?: AbortSignal,
  precondition?: () => void,
): Promise<BrowserChannel> {
  await untilAborted(ensureRegistration(precondition), signal);
  const registration = await untilAborted(navigator.serviceWorker.ready, signal);
  if (signal?.aborted) throw signal.reason;
  precondition?.();
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
  const channel = channelOf(subscription);
  if (channel === null) throw new Error('the new push subscription has no endpoint or keys');
  return channel;
}

/**
 * Removes the current channel only if its endpoint is `endpoint`: `removed`
 * when it was unsubscribed, `notCurrent` when the current channel is another
 * one or there is none. Rejects when the browser fails. `precondition` runs
 * right before the unsubscription, after the subscription was read, and
 * throws to stop without it. `signal` bounds the wait for the subscription;
 * the unsubscription itself, once started, is not cut off.
 */
export async function removeChannel(
  endpoint: string,
  precondition?: () => void,
  signal?: AbortSignal,
): Promise<'removed' | 'notCurrent'> {
  const subscription = await currentSubscription(signal);
  if (subscription === null || subscription.endpoint !== endpoint) return 'notCurrent';
  precondition?.();
  const ok = await subscription.unsubscribe();
  if (!ok) throw new Error('the browser did not remove the push subscription');
  return 'removed';
}

/** The notification permission of the site; `default` without notifications. */
export function notificationPermission(): NotificationPermissionState {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'default';
  const p = Notification.permission;
  return p === 'granted' || p === 'denied' ? p : 'default';
}

/**
 * Asks for the notification permission. Call it as the first `await` of a
 * click handler: browsers honour the prompt only inside the user's gesture.
 */
export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'default';
  const p = await Notification.requestPermission();
  return p === 'granted' || p === 'denied' ? p : 'default';
}
