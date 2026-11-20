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
import type { ServerPush } from '../lib/push/pushLifecycle';
import { dismissBanner, isBannerDismissed } from '../lib/push/bannerDismissal';
import type { PushActionResult } from '../lib/push/pushLifecycle';
import { usePush } from '../lib/usePush';

/** The banner conditions of US-12, as a predicate. */
export function shouldShowSoftAsk(args: {
  supported: boolean;
  /** The decision of this appearance ran with a read list. */
  decided: boolean;
  /** Push on the server; only `disabled` hides the banner. */
  serverPush: ServerPush;
  permission: NotificationPermissionState;
  /** The consent of the current user. */
  consentState: ConsentState | null;
  /** The current user. */
  userId: string;
  now: number;
}): boolean {
  if (!args.supported || !args.decided || args.serverPush === 'disabled') return false;
  if (args.permission === 'denied') return false;
  if (args.consentState !== 'none') return false;
  return !isBannerDismissed(args.userId, args.now);
}

/** The message for an enable from the banner that did not turn push on. */
function failureKey(result: PushActionResult): string | null {
  switch (result.kind) {
    case 'done':
    case 'superseded':
      return null;
    case 'denied':
      return 'push:device.deniedTitle';
    case 'unavailable':
      return 'push:device.serverDisabledTitle';
    case 'failed':
      return `push:device.failed.${result.reason}`;
  }
}

export function PushSoftAsk() {
  const { t } = useTranslation('chrome');
  const { state, enable } = usePush();
  // Per appearance: hidden after "Not now" or a done enable; busy while the
  // enable runs; the reason when it did not turn push on (US-1).
  const [answer, setAnswer] = useState<{ seq: number; phase: 'hidden' | 'busy' | 'failed'; message?: string } | null>(null);
  const appearance = state.appearance;
  const mine = appearance !== null && answer?.seq === appearance.seq ? answer : null;

  if (appearance === null || mine?.phase === 'hidden') return null;
  if (
    !shouldShowSoftAsk({
      supported: state.supported,
      decided: state.decided,
      serverPush: state.serverPush,
      permission: state.permission,
      consentState: state.consent?.state ?? null,
      userId: appearance.userId,
      now: Date.now(),
    })
  ) {
    // An enable that did not turn push on keeps the banner with its reason.
    if (mine?.phase !== 'failed') return null;
  }

  const seq = appearance.seq;
  const onYes = () => {
    // First, inside the click: the permission prompt needs the gesture.
    const action = enable();
    setAnswer({ seq, phase: 'busy' });
    void action.then((result) => {
      const key = failureKey(result);
      setAnswer(key === null ? { seq, phase: 'hidden' } : { seq, phase: 'failed', message: t(key) });
    });
  };

  const onLater = () => {
    dismissBanner(appearance.userId);
    setAnswer({ seq, phase: 'hidden' });
  };

  return (
    <div className="version-check-banner" role="region" aria-label={t('push.aria')}>
      <span className="version-check-banner-text">{t('push.body')}</span>
      {mine?.phase === 'failed' ? (
        <span className="version-check-banner-text" role="alert">
          {mine.message}
        </span>
      ) : null}
      {/* sk-381 — no `color`: the primary ramp answers `--on-primary`
       * (src/theme.ts), Mantine's builtin cyan did not meet contrast. */}
      <Button size="xs" variant="filled" loading={mine?.phase === 'busy'} onClick={onYes}>
        {t('push.yes')}
      </Button>
      <Button size="xs" variant="default" onClick={onLater}>
        {t('push.later')}
      </Button>
    </div>
  );
}
