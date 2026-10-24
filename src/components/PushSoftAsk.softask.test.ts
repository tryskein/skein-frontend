/**
 * sk push — shouldShowSoftAsk predicate tests.
 *
 * The banner's visibility logic is a pure function so the gating rules
 * (supported, permission==='default', cooldown) are testable without
 * mounting the component / mocking the whole Web Push surface.
 */
import { describe, expect, test } from 'vitest';
import { shouldShowSoftAsk, SOFT_ASK_COOLDOWN_MS } from './PushSoftAsk';

const NOW = 1_000_000_000_000;

describe('shouldShowSoftAsk', () => {
  test('shows when supported, permission default, never dismissed', () => {
    expect(
      shouldShowSoftAsk({ supported: true, permission: 'default', dismissedAt: 0, now: NOW }),
    ).toBe(true);
  });

  test('hidden when push is unsupported', () => {
    expect(
      shouldShowSoftAsk({ supported: false, permission: 'default', dismissedAt: 0, now: NOW }),
    ).toBe(false);
  });

  test('hidden when permission already granted', () => {
    expect(
      shouldShowSoftAsk({ supported: true, permission: 'granted', dismissedAt: 0, now: NOW }),
    ).toBe(false);
  });

  test('hidden when permission denied (must use settings to re-enable)', () => {
    expect(
      shouldShowSoftAsk({ supported: true, permission: 'denied', dismissedAt: 0, now: NOW }),
    ).toBe(false);
  });

  test('hidden during the cooldown window after a dismissal', () => {
    const dismissedAt = NOW - 1000; // dismissed 1s ago
    expect(
      shouldShowSoftAsk({ supported: true, permission: 'default', dismissedAt, now: NOW }),
    ).toBe(false);
  });

  test('re-shows once the cooldown has fully elapsed', () => {
    const dismissedAt = NOW - SOFT_ASK_COOLDOWN_MS - 1;
    expect(
      shouldShowSoftAsk({ supported: true, permission: 'default', dismissedAt, now: NOW }),
    ).toBe(true);
  });
});
