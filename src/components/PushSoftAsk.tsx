/**
 * PushSoftAsk — the in-app "enable notifications?" soft-ask banner.
 * sk push phase 1.
 *
 * Shows ONLY when push is supported, permission is still `'default'`
 * (never asked), and the user hasn't recently dismissed it. The native
 * `Notification.requestPermission()` is fired exclusively inside the [Yes]
 * handler — NEVER on mount. A permission prompt shown on page load that
 * the user reflexively dismisses is permanent and unrecoverable, so we
 * gate it behind an explicit soft-ask the user can decline cheaply.
 *
 * Dismissal ("Not now") persists a timestamp in localStorage; the
 * banner stays hidden until SOFT_ASK_COOLDOWN_MS has elapsed, so it
 * doesn't nag. The settings page (separate ticket) is the way to enable
 * notifications after a dismissal / denial.
 *
 * Styling reuses `.version-check-banner` (the existing top-of-viewport
 * app banner) so this slots into the same visual register without new
 * one-off CSS.
 */

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { usePush } from '../lib/usePush';

const DISMISS_KEY = 'skein.push.softAskDismissedAt';
/** 30 days — re-surface the soft-ask only after a long quiet interval. */
export const SOFT_ASK_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

function readDismissedAt(): number {
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY);
    if (!raw) return 0;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function writeDismissedAt(ts: number): void {
  try {
    window.localStorage.setItem(DISMISS_KEY, String(ts));
  } catch {
    // localStorage unavailable (private mode quota / disabled) — the
    // banner will reappear next mount; acceptable degradation.
  }
}

/** Pure predicate, exported for unit tests. */
export function shouldShowSoftAsk(args: {
  supported: boolean;
  permission: string;
  dismissedAt: number;
  now: number;
  cooldownMs?: number;
}): boolean {
  const cooldown = args.cooldownMs ?? SOFT_ASK_COOLDOWN_MS;
  if (!args.supported) return false;
  if (args.permission !== 'default') return false;
  if (args.dismissedAt > 0 && args.now - args.dismissedAt < cooldown) return false;
  return true;
}

export function PushSoftAsk() {
  const { t } = useTranslation('chrome');
  const { supported, permission, subscribe } = usePush();
  const [dismissedAt, setDismissedAt] = useState<number>(() => readDismissedAt());
  // Hide synchronously after the user acts in this session, independent of
  // the persisted timestamp (avoids a flash if the permission state lags).
  const [actedThisSession, setActedThisSession] = useState(false);

  // Keep the persisted dismissal in sync if it changes in another tab.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === DISMISS_KEY) setDismissedAt(readDismissedAt());
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const onYes = useCallback(async () => {
    setActedThisSession(true);
    // requestPermission + subscribe live entirely inside usePush.subscribe,
    // which is gesture-safe. If the user declines the native prompt the
    // permission flips to 'denied'/'default' and the banner won't return.
    await subscribe();
  }, [subscribe]);

  const onLater = useCallback(() => {
    const ts = Date.now();
    writeDismissedAt(ts);
    setDismissedAt(ts);
    setActedThisSession(true);
  }, []);

  if (actedThisSession) return null;
  if (
    !shouldShowSoftAsk({
      supported,
      permission,
      dismissedAt,
      now: Date.now(),
    })
  ) {
    return null;
  }

  return (
    <div className="version-check-banner" role="region" aria-label={t('push.aria')}>
      <span className="version-check-banner-text">{t('push.body')}</span>
      {/* sk-381 — was `color="cyan"`. Mantine's builtin cyan ramp is not
       * derived from our tokens and does not move with the theme, so the
       * white ink `defaultVariantColorsResolver` hardcodes for `filled`
       * measured 2.38:1 against `#22b8cf` — in BOTH themes, and below
       * even the 3:1 large-text floor. Dropping the prop puts the button
       * on the primary ramp, where `variantColorResolver` (src/theme.ts)
       * already answers `--on-primary`: measured 8.42:1 light / 7.10:1
       * dark on the live engine. It is also the right language for the
       * affirmative action of a banner — the brand ramp, as the comment
       * composer's Post button uses. */}
      <Button size="xs" variant="filled" onClick={onYes}>
        {t('push.yes')}
      </Button>
      <Button size="xs" variant="default" onClick={onLater}>
        {t('push.later')}
      </Button>
    </div>
  );
}
