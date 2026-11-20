/**
 * Row 75 — the banner conditions (spec US-12).
 *
 * Expected: shown only after the decision of this appearance ran with a read
 * list (not rows 0 and 1), with push supported and enabled on the server, the
 * permission `default` or `granted`, the current user's consent "no mark", and
 * no dismissal by this user in the last 30 days. Hidden at `denied`,
 * "enabled", "explicitly off" and this user's dismissal; another user's
 * dismissal does not hide it.
 */
import { afterEach, describe, expect, test } from 'vitest';
import { BANNER_DISMISSAL_COOLDOWN_MS, dismissBanner } from '../lib/push/bannerDismissal';
import { shouldShowSoftAsk } from './PushSoftAsk';

const NOW = 1_000_000_000_000;
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

const SHOWN = {
  supported: true,
  decided: true,
  serverPush: 'enabled' as const,
  permission: 'default' as const,
  consentState: 'none' as const,
  userId: A,
  now: NOW,
};

afterEach(() => localStorage.clear());

describe('row 75 — shouldShowSoftAsk', () => {
  test.each([
    { case: 'permission default', change: {} },
    { case: 'permission granted', change: { permission: 'granted' as const } },
    { case: 'the server configuration could not be read', change: { serverPush: 'unknown' as const } },
  ])('shown: $case, no mark, decided, supported, push on the server', ({ change }) => {
    expect(shouldShowSoftAsk({ ...SHOWN, ...change })).toBe(true);
  });

  test.each([
    { case: 'push unsupported', change: { supported: false } },
    { case: 'no decision with a read list yet (rows 0, 1)', change: { decided: false } },
    { case: 'push disabled on the server', change: { serverPush: 'disabled' as const } },
    { case: 'permission denied', change: { permission: 'denied' as const } },
    { case: 'consent enabled', change: { consentState: 'enabled' as const } },
    { case: 'consent explicitly off', change: { consentState: 'off' as const } },
  ])('hidden: $case', ({ change }) => {
    expect(shouldShowSoftAsk({ ...SHOWN, ...change })).toBe(false);
  });

  test("hidden after this user's dismissal, still shown to another user", () => {
    dismissBanner(A, NOW - 1000);
    expect(shouldShowSoftAsk(SHOWN)).toBe(false);
    expect(shouldShowSoftAsk({ ...SHOWN, userId: B })).toBe(true);
  });

  test('shown again to the same user once 30 days passed', () => {
    dismissBanner(A, NOW - BANNER_DISMISSAL_COOLDOWN_MS - 1);
    expect(shouldShowSoftAsk(SHOWN)).toBe(true);
  });
});
