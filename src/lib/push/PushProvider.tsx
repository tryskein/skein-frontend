/**
 * PushProvider — runs the push controller of this tab
 * (`lib/push/pushLifecycle.ts`) while the app is mounted: the repeats of
 * unfinished push work on page load, with or without a user, and the
 * decision on every appearance of a user.
 *
 * Mounted once, inside `AuthProvider` and outside `RequireAuth`, so the page
 * load repeats also run on `/login`. The push UI reads the state through
 * `usePush`.
 */

import { type ReactNode, useEffect } from 'react';
import { startPushLifecycle } from './pushLifecycle';

export function PushProvider({ children }: { children: ReactNode }) {
  useEffect(() => startPushLifecycle(), []);
  return <>{children}</>;
}
