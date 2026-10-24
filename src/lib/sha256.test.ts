/**
 * sk-62.3.8 — sha256Hex tests.
 *
 * Known NIST vectors. jsdom ships the WebCrypto SubtleCrypto API, so the
 * real digest runs here with no stubbing.
 */
import { describe, expect, test } from 'vitest';
import { sha256Hex } from './sha256';

describe('sha256Hex', () => {
  test('sha256("abc") matches the known vector', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  test('sha256("") matches the known empty-string vector', async () => {
    expect(await sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  test('output is lowercase hex, 64 chars', async () => {
    const hex = await sha256Hex('https://fcm.googleapis.com/fcm/send/abc123');
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
  });
});
