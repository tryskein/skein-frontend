/**
 * Row 47a — fingerprints of a channel.
 *
 * Expected: the endpoint fingerprint is the lowercase hex SHA-256 of the
 * endpoint, i.e. the server's `endpointHash` (NIST vector for "abc", the same
 * reference `src/lib/sha256.test.ts` uses); the key fingerprint changes when
 * either key changes and is equal for equal keys.
 */
import { describe, expect, test } from 'vitest';
import { endpointFingerprint, keysFingerprint } from './fingerprint';

describe('row 47a — channel fingerprints', () => {
  test('the endpoint fingerprint is the SHA-256 hex of the endpoint', async () => {
    expect(await endpointFingerprint('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  test('the key fingerprint is equal for equal keys', async () => {
    expect(await keysFingerprint({ p256dh: 'BPk', auth: 'AQID' }))
      .toBe(await keysFingerprint({ p256dh: 'BPk', auth: 'AQID' }));
  });

  test.each([
    ['p256dh', { p256dh: 'BPl', auth: 'AQID' }],
    ['auth', { p256dh: 'BPk', auth: 'AQIE' }],
    ['the split between the keys', { p256dh: 'BPkA', auth: 'QID' }],
  ])('the key fingerprint changes with %s', async (_name, keys) => {
    expect(await keysFingerprint(keys)).not.toBe(await keysFingerprint({ p256dh: 'BPk', auth: 'AQID' }));
  });
});
