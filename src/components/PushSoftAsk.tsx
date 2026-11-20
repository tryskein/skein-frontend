/**
 * PushSoftAsk — the banner inviting the signed-in user to turn push on
 * (spec US-12).
 *
 * Shown only after the decision of this appearance ran with a read list
 * (not on rows 0 and 1), when push is supported and enabled on the server,
 * the notification permission is `default` or `granted`, the current user's
 * consent is "no mark", and this user has not dismissed the banner in the
 * last 30 days. A dismissal is the user's own: it never hides the banner
 * from another user of this browser.
 *
 * "Yes" calls the enable action directly in the click: the notification
 * permission is asked inside the user's gesture, never on mount.
 *
 * Styling reuses `.version-check-banner` (the existing top-of-viewport app
 * banner).
 */

import { useState } from 'react';
import { Button } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import type { ConsentState } from '../lib/push/pushState';
import type { NotificationPermissionState } from '../lib/push/browserPush';
import { dismissBanner, isBannerDismissed } from '../lib/push/bannerDismissal';
import { usePush } from '../lib/usePush';

/** The banner conditions of US-12, as a predicate. */
export function shouldShowSoftAsk(args: {
  supported: boolean;
  /** The decision of this appearance ran with a read list. */
  decided: boolean;
  serverPushEnabled: boolean;
  permission: NotificationPermissionState;
  /** The consent of the current user. */
  consentState: ConsentState | null;
  /** The current user. */
  userId: string;
  now: number;
}): boolean {
  if (!args.supported || !args.decided || !args.serverPushEnabled) return false;
  if (args.permission === 'denied') return false;
  if (args.consentState !== 'none') return false;
  return !isBannerDismissed(args.userId, args.now);
}

export function PushSoftAsk() {
  const { t } = useTranslation('chrome');
  const { state, enable } = usePush();
  // Hidden at once after the user answered in this appearance.
  const [answeredIn, setAnsweredIn] = useState<number | null>(null);
  const appearance = state.appearance;

  if (appearance === null || answeredIn === appearance.seq) return null;
  if (
    !shouldShowSoftAsk({
      supported: state.supported,
      decided: state.decided,
      serverPushEnabled: state.serverPushEnabled,
      permission: state.permission,
      consentState: state.consent?.state ?? null,
      userId: appearance.userId,
      now: Date.now(),
    })
  ) {
    return null;
  }

  const onYes = () => {
    // First, inside the click: the permission prompt needs the gesture.
    void enable();
    setAnsweredIn(appearance.seq);
  };

  const onLater = () => {
    dismissBanner(appearance.userId);
    setAnsweredIn(appearance.seq);
  };

  return (
    <div className="version-check-banner" role="region" aria-label={t('push.aria')}>
      <span className="version-check-banner-text">{t('push.body')}</span>
      {/* sk-381 — no `color`: the primary ramp answers `--on-primary`
       * (src/theme.ts), Mantine's builtin cyan did not meet contrast. */}
      <Button size="xs" variant="filled" onClick={onYes}>
        {t('push.yes')}
      </Button>
      <Button size="xs" variant="default" onClick={onLater}>
        {t('push.later')}
      </Button>
    </div>
  );
}
