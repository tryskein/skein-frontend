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
 * no bundler, no imports, no app code.
 *
 * The worker shows notifications and opens their URL on click — nothing
 * else. It never writes to the server and never creates a push channel:
 * when the browser changes the subscription (`pushsubscriptionchange`) the
 * worker does nothing, and the page applies its decision table on the next
 * appearance of a user with consent. Registering a channel from the worker
 * would use whichever session cookie happens to be present, without
 * checking whose it is.
 *
 * userVisibleOnly contract: the subscription is created with
 * `userVisibleOnly: true`, so the browser REQUIRES that every `push`
 * event results in a visible notification. The `push` handler therefore
 * always calls `showNotification`, even on a malformed / empty payload.
 */

/* global self, clients */

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
