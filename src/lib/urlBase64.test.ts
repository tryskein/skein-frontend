/**
 * sk push — urlBase64ToUint8Array unit tests.
 *
 * The VAPID public key arrives base64url (no padding, `-`/`_` alphabet);
 * the Push API needs the decoded bytes as a Uint8Array. These tests pin
 * the padding + alphabet handling and the round-trip against known bytes.
 */
import { describe, expect, test } from 'vitest';
import { urlBase64ToUint8Array } from './urlBase64';

describe('urlBase64ToUint8Array', () => {
  test('decodes a padding-less base64url string to the correct bytes', () => {
    // "Man" → base64 "TWFu" (no padding needed, length 4).
    const out = urlBase64ToUint8Array('TWFu');
    expect(Array.from(out)).toEqual([0x4d, 0x61, 0x6e]); // M a n
  });

  test('re-adds the omitted padding (length not a multiple of 4)', () => {
    // "M" → base64 "TQ==" → base64url "TQ" (padding stripped).
    expect(Array.from(urlBase64ToUint8Array('TQ'))).toEqual([0x4d]);
    // "Ma" → base64 "TWE=" → base64url "TWE".
    expect(Array.from(urlBase64ToUint8Array('TWE'))).toEqual([0x4d, 0x61]);
  });

  test('translates the base64url alphabet (- → +, _ → /)', () => {
    // Bytes [0xff, 0xff, 0xfe] → standard base64 "//7+"? Build from a
    // value that exercises both - and _ once translated.
    // 0xfb 0xff 0xbf → base64 "+/+/" → base64url "-_-_".
    const out = urlBase64ToUint8Array('-_-_');
    expect(Array.from(out)).toEqual([0xfb, 0xff, 0xbf]);
  });

  test('returns a typed Uint8Array (applicationServerKey contract)', () => {
    const out = urlBase64ToUint8Array('TWFu');
    expect(out).toBeInstanceOf(Uint8Array);
    expect(out.length).toBe(3);
  });

  test('empty string yields an empty array', () => {
    expect(urlBase64ToUint8Array('').length).toBe(0);
  });
});
