/**
 * sk-62.3.8 — parseUserAgent table-driven tests.
 *
 * Covers the real-device UA strings the device list will see, plus the
 * detection-order edge cases (Edge embeds "Chrome/", Chrome embeds
 * "Safari/", Android embeds "Linux") and the raw-UA fallback.
 */
import { describe, expect, test } from 'vitest';
import { parseUserAgent } from './parseUserAgent';

describe('parseUserAgent', () => {
  const cases: Array<[string, string]> = [
    // Real devices from the ticket.
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
      'Chrome 149 · Windows',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:151.0) Gecko/20100101 Firefox/151.0',
      'Firefox 151 · Windows',
    ],
    // Edge (Edg/) must win over the embedded Chrome/ token.
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
      'Edge 140 · Windows',
    ],
    // Safari on macOS — Version/<n> drives the number, Chrome must NOT match.
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15',
      'Safari 17 · macOS',
    ],
    // Chrome on Android — Android must win over the embedded "Linux".
    [
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36',
      'Chrome 149 · Android',
    ],
    // Chrome on Linux.
    [
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
      'Chrome 148 · Linux',
    ],
    // iOS Safari (Version/ + Mobile/ + Safari).
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
      'Safari 17 · iOS',
    ],
    // Firefox on macOS.
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:124.0) Gecko/20100101 Firefox/124.0',
      'Firefox 124 · macOS',
    ],
  ];

  test.each(cases)('parses %s', (ua, expected) => {
    expect(parseUserAgent(ua)).toBe(expected);
  });

  test('empty input falls back to a placeholder', () => {
    expect(parseUserAgent('')).toBe('unknown device');
    expect(parseUserAgent('   ')).toBe('unknown device');
  });

  test('unrecognized UA falls back to the raw string (truncated)', () => {
    expect(parseUserAgent('SomeBot/1.0')).toBe('SomeBot/1.0');
    const long = 'X'.repeat(200);
    const out = parseUserAgent(long);
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThan(long.length);
  });

  test('browser without a recognizable OS returns just the browser', () => {
    expect(parseUserAgent('Mozilla/5.0 Chrome/149.0.0.0')).toBe('Chrome 149');
  });
});
