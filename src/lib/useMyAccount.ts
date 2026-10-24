/**
 * TanStack Query hook for the caller's own account — `GET /api/v1/auth/me`
 * (`api/account.ts#getMyAccount`, sk-674.18 T051): the account as the
 * database holds it now, with the additive `emailConfirmed` / `hasApiKeys`
 * flags the cookie-derived session check (`/api/auth/me`) does not carry.
 *
 * Keyed by the signed-in person for the reason `useMySpaces.ts` gives: a
 * logout followed by another login in the same tab keeps the query cache,
 * and a key without the id would hand the next person the previous one's
 * flags until the refetch landed. Disabled — no request, no data — while
 * nobody is signed in or outside an `AuthProvider`.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { getMyAccount, type MyAccount } from '../api/account';
import { useAuthOptional } from '../auth/AuthContext';

/** Prefix of every person's account entry. */
export const MY_ACCOUNT_QUERY_PREFIX = ['me', 'account'] as const;

/** The cache key of ONE person's account. */
export function myAccountQueryKey(userId: string) {
  return [...MY_ACCOUNT_QUERY_PREFIX, userId] as const;
}

/** The signed-in person's account. */
export function useMyAccount(): UseQueryResult<MyAccount> {
  const userId = useAuthOptional()?.user?.id ?? null;
  return useQuery<MyAccount>({
    queryKey: userId === null ? [...MY_ACCOUNT_QUERY_PREFIX, null] : myAccountQueryKey(userId),
    queryFn: getMyAccount,
    enabled: userId !== null,
  });
}
