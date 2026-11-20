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

async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration(SW_SCOPE);
  if (!registration) return null;
  return registration.pushManager.getSubscription();
}

/**
 * Reads the current channel: `none` when the browser has none, `unreadable`
 * when the browser failed to answer or returned a channel without keys.
 */
export async function readChannel(): Promise<ChannelRead> {
  try {
    const subscription = await currentSubscription();
    if (subscription === null) return { kind: 'none' };
    const channel = channelOf(subscription);
    return channel === null ? { kind: 'unreadable' } : { kind: 'channel', channel };
  } catch {
    return { kind: 'unreadable' };
  }
}

async function ensureRegistration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration(SW_SCOPE);
  if (existing) return existing;
  return navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE });
}

/**
 * Creates a new channel with the server's VAPID public key (base64url).
 * Rejects when the browser refuses.
 */
export async function createChannel(publicKey: string): Promise<BrowserChannel> {
  await ensureRegistration();
  const registration = await navigator.serviceWorker.ready;
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
 * one or there is none. Rejects when the browser fails.
 */
export async function removeChannel(endpoint: string): Promise<'removed' | 'notCurrent'> {
  const subscription = await currentSubscription();
  if (subscription === null || subscription.endpoint !== endpoint) return 'notCurrent';
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
