import { useQuery, UseQueryResult } from '@tanstack/react-query';
import { getAuthConfig, RuntimeAuthConfig } from '../api/auth';

/**
 * Runtime auth-mode flag fetched from skein-web `/api/auth/config`.
 *
 * The value is process-stable (the BFF reads it from configuration at
 * startup), so the query is configured with `staleTime: Infinity` and
 * `gcTime: Infinity`. One round-trip per page load, cached for the
 * lifetime of the SPA — components that need the flag just call this
 * hook and read `.data`.
 *
 * Note: the endpoint is anonymous (`[AllowAnonymous]` on the BFF
 * controller), so this hook works on the /login page before the user
 * has any cookie.
 */
/**
 * Query key of the runtime auth config.
 *
 * Exported because logout needs the value IMPERATIVELY, not as rendered
 * state: see `AuthContext`. A hook's `.data` is whatever had arrived by
 * render time, and logout must not depend on that.
 */
export const AUTH_CONFIG_KEY = ['auth', 'config'] as const;

/** Fetcher paired with `AUTH_CONFIG_KEY`, for imperative reads. */
export const authConfigQueryOptions = {
  queryKey: AUTH_CONFIG_KEY,
  queryFn: getAuthConfig,
  staleTime: Infinity,
  gcTime: Infinity,
  retry: 1,
};

export function useAuthConfig(): UseQueryResult<RuntimeAuthConfig> {
  return useQuery<RuntimeAuthConfig>({
    queryKey: AUTH_CONFIG_KEY,
    queryFn: getAuthConfig,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}
