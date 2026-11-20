/**
 * PushForeignChannelNotice — the warning to the user who appeared in a
 * browser that still had the previous user's push channel (spec US-6).
 *
 * The channel was removed and its subscription removed on the server by its
 * endpoint; until the server confirmed that removal, the previous user's
 * notifications may still arrive in this browser. The warning lasts while
 * such a removal is unfinished, and "Try again" repeats it.
 */

import { useState } from 'react';
import { Button } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { usePush } from '../lib/usePush';

export function PushForeignChannelNotice() {
  const { t } = useTranslation('chrome');
  const { state, retry } = usePush();
  const [retrying, setRetrying] = useState(false);

  if (state.appearance === null || state.foreignChannelWarnings.length === 0) return null;

  const onRetry = async () => {
    setRetrying(true);
    try {
      await retry();
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className="version-check-banner" role="region" aria-label={t('push.foreignAria')}>
      <span className="version-check-banner-text">{t('push.foreignBody')}</span>
      <Button size="xs" variant="default" loading={retrying} onClick={() => void onRetry()}>
        {t('push.foreignRetry')}
      </Button>
    </div>
  );
}
