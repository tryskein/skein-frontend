/**
 * Mentions feed query (sk-38).
 *
 * Same `notifications` table as the inbox, same wire shape, different
 * scope filter. Returns unread mention-typed notifications
 * (`comment.mention` + `issue.mention`) addressed to the caller. The
 * backend pre-trims a ~120-char `mentionContext` snippet around the
 * first `@<caller-username>` occurrence so the UI can render the
 * surrounding sentence without an extra fetch.
 *
 * We deliberately DO NOT cluster cards client-side — mentions are
 * typically standalone acts ("alice @ed you in comment X") and grouping
 * would obscure individual mentions. One card per notification id.
 *
 * Cache key is flat (one Mentions surface per user). Live-event
 * invalidation lives in `liveEventInvalidation.ts` — every
 * mention-typed event for the caller hits `['mentions', ...]`.
 *
 * staleTime 30s mirrors the inbox / watching cadence.
 */

import { useQuery } from '@tanstack/react-query';
import { listInbox } from '../api/notifications';

export const mentionsQueryKey = ['mentions', 'feed'] as const;

export function useMentions() {
  return useQuery({
    queryKey: mentionsQueryKey,
    queryFn: () => listInbox({ scope: 'mentions', limit: 100 }),
    staleTime: 30_000,
  });
}
