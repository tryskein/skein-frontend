/**
 * Fingerprints of a push channel.
 *
 * The endpoint fingerprint is the lowercase hex SHA-256 of the endpoint —
 * the same value the server sends as `endpointHash` — so the page finds its
 * own channel in the device list without the raw endpoint on the wire.
 *
 * The key fingerprint tells whether the channel keys changed since the
 * consent recorded them; it is never sent to the server.
 */

import { sha256Hex } from '../sha256';
import type { ChannelKeys } from './browserPush';

/** Lowercase hex SHA-256 of `endpoint`, equal to the server's `endpointHash`. */
export function endpointFingerprint(endpoint: string): Promise<string> {
  return sha256Hex(endpoint);
}

/**
 * Fingerprint of the channel keys. The two keys are base64url, which has no
 * `.`, so the joined string is unambiguous.
 */
export function keysFingerprint(keys: ChannelKeys): Promise<string> {
  return sha256Hex(`${keys.p256dh}.${keys.auth}`);
}
