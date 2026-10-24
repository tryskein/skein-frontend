import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { ME_THEME_QUERY_KEY } from '../api/themes';
import { useTheme } from '../lib/useTheme';

/**
 * ThemeSync — mounts the theme hook once, at the app root.
 *
 * BUG IT FIXES (avatar click flipped the theme to dark):
 *   `useTheme()` is what reconciles `<html data-theme>` with the SERVER
 *   preference (GET /api/v1/me/theme). Before this component existed the
 *   only thing mounting it inside the shell was `<ThemeToggle>` — and
 *   `ThemeToggle` sits inside the account-menu dropdown, which Mantine
 *   mounts only when the popover opens. So what the user saw was:
 *
 *     theme-boot.js paints data-theme from localStorage / OS  → light
 *     …shell renders; nothing ever asks the server…
 *     user clicks the avatar → dropdown mounts → ThemeToggle mounts →
 *       useTheme fetches /me/theme → server says "dark" → applyActive()
 *       repaints the whole page dark
 *
 *   Nothing was toggling: the stored preference was simply applied for
 *   the first time, at the moment the menu opened — which reads exactly
 *   like "the avatar is a theme switch". `ActivityDashboard` had already
 *   hit this edge and worked around it by calling `useTheme()` in the
 *   page (see its comment); this component is that workaround done once,
 *   globally, so reconciliation happens on load instead.
 *
 *   The hook is idempotent and query-cache backed, so the `useTheme()`
 *   still living inside `ThemeToggle` costs nothing: both instances read
 *   the same TanStack Query entry and `applyActive` writes the same
 *   attributes.
 *
 * IDENTITY CHANGES:
 *   `/me/theme` is cached with `staleTime: Infinity`, and on the login
 *   page it resolves to the local bootstrap (401 → localStorage / OS).
 *   Nothing in `AuthProvider.login` invalidates queries, so without the
 *   effect below that pre-auth value would stick for the whole session
 *   and the user's saved theme would never be applied after a login —
 *   trading one bug for another. We therefore refetch whenever the
 *   signed-in identity CHANGES while mounted (login, logout, account
 *   switch). The first resolved identity is only recorded, not
 *   invalidated: that initial fetch already went out with whatever
 *   session cookie the page loaded with, so re-issuing it would just be
 *   a duplicate request.
 *
 * Renders nothing. Must sit under `QueryClientProvider` (the hook uses
 * `useQuery`/`useMutation`) and under `AuthProvider`.
 */
export function ThemeSync(): null {
  useTheme();

  const { user, isLoading } = useAuth();
  const queryClient = useQueryClient();
  // `null` = no identity resolved yet in THIS mount. Distinct from the
  // resolved-but-signed-out state, which is stored as `{ id: null }`.
  const seenIdentity = useRef<{ id: string | null } | null>(null);

  useEffect(() => {
    if (isLoading) return;
    const id = user?.id ?? null;
    if (seenIdentity.current === null) {
      seenIdentity.current = { id };
      return;
    }
    if (seenIdentity.current.id === id) return;
    seenIdentity.current = { id };
    void queryClient.invalidateQueries({ queryKey: ME_THEME_QUERY_KEY });
  }, [isLoading, user?.id, queryClient]);

  return null;
}
