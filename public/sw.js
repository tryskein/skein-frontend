/*
 * Skein Web Push service worker (sk push — phase 1).
 *
 * Served at the site ROOT as `/sw.js` so its scope is `/` (a SW can only
 * control pages at or below its own path). In `vite dev` this file is
 * served verbatim from `public/`; in production skein-web serves it from
 * wwwroot. A separate ticket owns the `Service-Worker-Allowed` /
 * `Content-Type: text/javascript` headers — this file is just the logic.
 *
 * Plain dependency-free JS on purpose: the SW runs in a worker scope with
 * no bundler, no imports, no app code. Everything it needs (the API base,
 * the VAPID key) it derives at runtime from same-origin endpoints.
 *
 * userVisibleOnly contract: the subscription is created with
 * `userVisibleOnly: true`, so the browser REQUIRES that every `push`
 * event results in a visible notification. The `push` handler therefore
 * always calls `showNotification`, even on a malformed / empty payload.
 */

/* global self, clients */

const PUSH_CONFIG_URL = '/api/v1/push/config';
const SUBSCRIPTIONS_URL = '/api/v1/push/subscriptions';
const NOTIFICATION_ICON = '/favicon.svg';
const DEFAULT_URL = '/';

// Activate immediately so a freshly-installed SW starts handling pushes
// for already-open tabs without waiting for every client to close.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

/*
 * push — render a notification for every push.
 *
 * Payload shape (JSON) from skein-api:
 *   { title, body, url, category, issueId }
 * Any field may be missing; we degrade to safe defaults so the
 * userVisibleOnly contract is never violated (a push with no notification
 * gets the origin flagged as "silent push" by the UA and may be revoked).
 */
self.addEventListener('push', (event) => {
  let payload = {};
  if (event.data) {
    try {
      payload = event.data.json();
    } catch (err) {
      // Non-JSON / corrupt payload — fall back to the raw text as the body
      // so the user still sees SOMETHING (contract requires a notification).
      payload = { body: safeText(event.data) };
    }
  }

  const title = typeof payload.title === 'string' && payload.title.trim()
    ? payload.title
    : 'Skein';
  const body = typeof payload.body === 'string' ? payload.body : '';
  const url = typeof payload.url === 'string' && payload.url ? payload.url : DEFAULT_URL;
  // Coalesce notifications for the same issue (or the same category when
  // there's no issue) so a burst doesn't stack a dozen toasts.
  const tag = payload.issueId || payload.category || undefined;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      data: { url },
      icon: NOTIFICATION_ICON,
      tag,
    }),
  );
});

function safeText(data) {
  try {
    return data.text();
  } catch (err) {
    return '';
  }
}

/*
 * notificationclick — focus an existing tab on the target URL if one is
 * open, else open a new window. Closes the notification first.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  const targetUrl = typeof data.url === 'string' && data.url ? data.url : DEFAULT_URL;
  // Same-origin guard: the push payload URL is server-supplied, but a tampered
  // or misconfigured payload must never be able to navigate/open an external
  // origin from a notification click (open-redirect / phishing vector). Resolve
  // against our origin and, if the result points elsewhere, fall back to a safe
  // in-app default.
  const parsed = new URL(targetUrl, self.location.origin);
  const absolute =
    parsed.origin === self.location.origin
      ? parsed.href
      : new URL(DEFAULT_URL, self.location.origin).href;

  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((windowClients) => {
        for (const client of windowClients) {
          // Same path (ignoring trailing differences) → just focus it.
          if (client.url === absolute && 'focus' in client) {
            return client.focus();
          }
        }
        // Otherwise prefer focusing any open Skein tab and navigating it,
        // falling back to a brand-new window.
        for (const client of windowClients) {
          if ('navigate' in client && 'focus' in client) {
            return client.focus().then((focused) =>
              focused && focused.navigate ? focused.navigate(absolute) : focused,
            );
          }
        }
        if (clients.openWindow) {
          return clients.openWindow(absolute);
        }
        return undefined;
      }),
  );
});

/*
 * pushsubscriptionchange — the browser rotated / expired our subscription.
 * Re-subscribe with the SAME applicationServerKey and tell the backend
 * about the new endpoint, otherwise pushes silently stop arriving.
 *
 * VAPID key delivery: we RE-FETCH `/api/v1/push/config` from the worker
 * rather than baking the key in at build time. The SW runs same-origin so
 * the session cookie rides along and the config endpoint returns the
 * server's current public key. This is the robust choice — a server-side
 * VAPID key rotation is picked up automatically, whereas a build-time
 * inlined key would go stale and break re-subscription after rotation.
 */
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(resubscribe());
});

async function resubscribe() {
  let publicKey = '';
  try {
    const res = await fetch(PUSH_CONFIG_URL, { credentials: 'include' });
    if (res.ok) {
      const cfg = await res.json();
      if (cfg && typeof cfg.publicKey === 'string') publicKey = cfg.publicKey;
    }
  } catch (err) {
    // Network failure — nothing we can do from the worker; the page-side
    // re-sync (usePush, on next load with permission granted) will repair.
    return;
  }
  if (!publicKey) return; // push disabled server-side

  let subscription;
  try {
    subscription = await self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  } catch (err) {
    return;
  }

  const json = subscription.toJSON();
  if (!json || !json.endpoint || !json.keys) return;

  try {
    await fetch(SUBSCRIPTIONS_URL, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint: json.endpoint,
        keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
        ua: self.navigator ? self.navigator.userAgent : undefined,
      }),
    });
  } catch (err) {
    // Swallow — page-side re-sync repairs the server record next load.
  }
}

/*
 * urlBase64ToUint8Array — convert a base64url VAPID public key (as the
 * server hands it out) into the Uint8Array the Push API's
 * applicationServerKey expects. Standard helper, duplicated here because
 * the worker can't import the app's copy. Kept byte-for-byte identical to
 * src/lib/usePush.ts so both code paths agree.
 */
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = self.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}
