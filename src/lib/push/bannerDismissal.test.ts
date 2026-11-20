/**
 * Row 40 — US-12: the banner dismissal is per user.
 *
 * Expected (spec US-12): a dismissal by user A hides the banner from A for 30
 * days and never from B; after 30 days A sees it again; the previous
 * site-wide key `skein.push.softAskDismissedAt` is not read and is removed.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { dismissBanner, isBannerDismissed } from './bannerDismissal';

const A = 'a1a1a1a1-0000-4000-8000-000000000001';
const B = 'b2b2b2b2-0000-4000-8000-000000000002';
const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 10, 1);

beforeEach(() => window.localStorage.clear());
afterEach(() => window.localStorage.clear());

describe('row 40 — banner dismissal per user', () => {
  test('A dismissing hides the banner from A for 30 days and not from B', () => {
    dismissBanner(A, T0);
    expect(isBannerDismissed(A, T0 + 1)).toBe(true);
    expect(isBannerDismissed(A, T0 + 30 * DAY - 1)).toBe(true);
    expect(isBannerDismissed(B, T0 + 1)).toBe(false);
  });

  test('after 30 days A sees the banner again', () => {
    dismissBanner(A, T0);
    expect(isBannerDismissed(A, T0 + 30 * DAY)).toBe(false);
  });

  test('the site-wide key of the previous banner is not read and is removed', () => {
    window.localStorage.setItem('skein.push.softAskDismissedAt', String(T0));
    expect(isBannerDismissed(B, T0 + 1)).toBe(false);
    expect(window.localStorage.getItem('skein.push.softAskDismissedAt')).toBeNull();
  });
});
