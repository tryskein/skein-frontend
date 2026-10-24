/**
 * sk-303.13 (T028) — the one settings fact the Watching column needs:
 * are ALL feed-capable reasons switched off?
 *
 * The column has to tell "subscriptions exist, no events yet" apart from
 * "reason channels are off" (US-5), and only the settings payload can
 * say which. Nothing else about the form is read here.
 *
 * The query key is shared with the settings page on purpose: one cache
 * entry, one fetch, no chance of the column and the form disagreeing
 * about the caller's own channels.
 */

import { useQuery } from '@tanstack/react-query';
import { getReasonPrefs, type ReasonPrefs } from '../api/notification-reasons';

/** Shared cache key — imported by the settings page, not retyped there. */
export const reasonPrefsQueryKey = ['notifications', 'reasons'] as const;

/**
 * `true` — every reason that HAS a feed channel has it off.
 * `false` — at least one feed channel is on.
 * `null` — the registry exposes no feed-capable reason, so there is
 * nothing to be all-off about and the caller must not claim otherwise.
 */
export function feedChannelsAllOff(prefs: ReasonPrefs): boolean | null {
  const feedCapable = prefs.reasons.filter((row) => row.feed.applicable);
  if (feedCapable.length === 0) return null;
  return feedCapable.every((row) => !row.feed.enabled);
}

/**
 * `enabled` gates the fetch: the column asks only when it is actually
 * about to explain an empty feed, so a user with activity never pays
 * for a settings round-trip. Returns `null` while the answer is not in
 * hand — the classifier treats that as "no claim", not as "channels are
 * on".
 */
export function useFeedChannelsAllOff(enabled: boolean): boolean | null {
  const q = useQuery({
    queryKey: reasonPrefsQueryKey,
    queryFn: getReasonPrefs,
    enabled,
    staleTime: 60_000,
  });
  return q.data ? feedChannelsAllOff(q.data) : null;
}
