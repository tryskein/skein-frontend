/**
 * TanStack Query hook for «my spaces» — `GET /api/v1/me/spaces`
 * (sk-674.18, T050): every space the caller sees, whole, in projects-column
 * order, plus whether a new space can be created now.
 *
 * One query for every surface that needs spaces (projects column, place,
 * Inbox cards, search, HOT ZONE, settings), so they share one cache entry.
 * Its reset belongs to the live layer: the personal signal area `spaces`
 * re-reads it (`livePersonalSignal.ts`, T053) — the hook itself does not
 * poll.
 *
 * An external user gets an empty list: the interface then behaves as with
 * one space (E-16).
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { getMySpaces, type MySpacesResponse } from '../api/spaces';
import { useAuthOptional } from '../auth/AuthContext';

/**
 * Prefix of every person's «my spaces» entry. The live layer resets the
 * signed-in person's entry through it without knowing the id.
 */
export const MY_SPACES_QUERY_PREFIX = ['me', 'spaces'] as const;

/**
 * The cache key of ONE person's spaces — the same reasoning as
 * `useUiPrefs.ts#uiPrefsKey`: a logout followed by another login in the
 * same tab reloads neither the page nor the cache, so a key without the id
 * would show the next person the previous one's spaces until the refetch
 * landed.
 */
export function mySpacesQueryKey(userId: string) {
  return [...MY_SPACES_QUERY_PREFIX, userId] as const;
}

/**
 * The signed-in person's spaces. Disabled — no request, no data — while
 * nobody is signed in, and outside an `AuthProvider` (the identity is read
 * with `useAuthOptional`, as `useInbox.ts` does): a surface rendered
 * without a session then behaves as with one space.
 */
export function useMySpaces(): UseQueryResult<MySpacesResponse> {
  const userId = useAuthOptional()?.user?.id ?? null;
  return useQuery<MySpacesResponse>({
    queryKey: userId === null ? [...MY_SPACES_QUERY_PREFIX, null] : mySpacesQueryKey(userId),
    queryFn: getMySpaces,
    enabled: userId !== null,
  });
}
