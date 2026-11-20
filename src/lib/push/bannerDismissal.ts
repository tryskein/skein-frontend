/**
 * "Not now" on the push invitation banner, per user of this browser.
 *
 * A dismissal hides the banner from that user for
 * {@link BANNER_DISMISSAL_COOLDOWN_MS}; it never hides it from another user.
 * It lives under its own key per user, outside the push state record: it is
 * not part of any consent transition.
 *
 * The site-wide key of the previous banner (`skein.push.softAskDismissedAt`)
 * is never read — it would hide the banner from every user — and is removed.
 */

/** Prefix of the per-user dismissal key; the user id follows. */
export const BANNER_DISMISSAL_KEY_PREFIX = 'skein.push.v1.bannerDismissedAt.';

/** Site-wide dismissal key of the previous banner. */
export const LEGACY_BANNER_DISMISSAL_KEY = 'skein.push.softAskDismissedAt';

/** 30 days. */
export const BANNER_DISMISSAL_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

function storage(): Storage | null {
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Removes the site-wide dismissal key of the previous banner. */
export function removeLegacyBannerDismissal(): void {
  try {
    storage()?.removeItem(LEGACY_BANNER_DISMISSAL_KEY);
  } catch {
    // Storage refused the removal; the key is never read anyway.
  }
}

/** When `userId` last dismissed the banner (epoch ms); 0 when never. */
export function readBannerDismissedAt(userId: string): number {
  removeLegacyBannerDismissal();
  let raw: string | null = null;
  try {
    raw = storage()?.getItem(BANNER_DISMISSAL_KEY_PREFIX + userId) ?? null;
  } catch {
    raw = null;
  }
  if (raw === null) return 0;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Records that `userId` dismissed the banner at `now`. */
export function dismissBanner(userId: string, now: number = Date.now()): void {
  removeLegacyBannerDismissal();
  try {
    storage()?.setItem(BANNER_DISMISSAL_KEY_PREFIX + userId, String(now));
  } catch {
    // Storage unavailable: the banner may show again on the next appearance.
  }
}

/** Whether the banner is hidden from `userId` at `now` by their dismissal. */
export function isBannerDismissed(userId: string, now: number = Date.now()): boolean {
  const at = readBannerDismissedAt(userId);
  return at > 0 && now - at < BANNER_DISMISSAL_COOLDOWN_MS;
}
