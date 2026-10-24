/**
 * urlBase64ToUint8Array — sk push phase 1.
 *
 * Convert a base64url string (the shape the VAPID public key arrives in
 * from `/api/v1/push/config`) into the `Uint8Array` the Push API's
 * `applicationServerKey` parameter requires.
 *
 * base64url differs from standard base64 in two ways:
 *   - it uses `-` and `_` instead of `+` and `/`, and
 *   - it usually omits the `=` padding.
 * So we re-pad to a multiple of 4 and swap the alphabet back before
 * handing the result to `atob`.
 *
 * Pure + dependency-free so it can be unit-tested in isolation. A
 * byte-for-byte copy lives inside `public/sw.js` (the worker can't import
 * app modules); keep the two in sync.
 */
export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  // Back the view with a concrete ArrayBuffer (not ArrayBufferLike) so the
  // result satisfies the Push API's `applicationServerKey: BufferSource`
  // type — TS otherwise widens to a possibly-SharedArrayBuffer view.
  const buffer = new ArrayBuffer(raw.length);
  const output = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i += 1) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}
