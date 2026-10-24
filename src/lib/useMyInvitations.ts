/**
 * TanStack Query hook for the pending invitations addressed to the
 * signed-in person — `GET /api/v1/me/invitations`
 * (`api/invitations.ts#listMyInvitations`, sk-674.18 T054): the invitation
 * cards of the Inbox (screens 1.3). A module of its own beside
 * `useInbox.ts`, which reads the issue half of the same queue.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { listMyInvitations, type MyInvitationsResponse } from '../api/invitations';
import { useAuthOptional } from '../auth/AuthContext';
import { MY_INVITATIONS_QUERY_PREFIX } from './livePersonalSignal';

/**
 * The cache key of ONE person's pending invitations (`GET /me/invitations`,
 * sk-674.18 T054) — under {@link MY_INVITATIONS_QUERY_PREFIX}, which the
 * personal signal re-reads on `inbox` (an email just confirmed flips
 * `canAccept`) and on `spaces` (an invitation sent, revoked, accepted
 * elsewhere). Keyed by the person for the reason `useMySpaces.ts` gives: a
 * logout and another login in the same tab keep the cache.
 */
export function myInvitationsQueryKey(userId: string) {
  return [...MY_INVITATIONS_QUERY_PREFIX, userId] as const;
}

/**
 * Pending invitations addressed to the signed-in person — the invitation
 * cards pinned above the Inbox tasks (screens 1.3). Shown with any number
 * of spaces: an invitation is the only way into a second one. Disabled —
 * no request, no data — while nobody is signed in.
 */
export function useMyInvitations(): UseQueryResult<MyInvitationsResponse> {
  const userId = useAuthOptional()?.user?.id ?? null;
  return useQuery<MyInvitationsResponse>({
    queryKey:
      userId === null ? [...MY_INVITATIONS_QUERY_PREFIX, null] : myInvitationsQueryKey(userId),
    queryFn: listMyInvitations,
    enabled: userId !== null,
    staleTime: 30_000,
  });
}
