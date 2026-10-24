import { useNavLayoutSync } from '../lib/useNavLayout';

/**
 * NavLayoutSync — sk-551.8. Keeps this browser's copy of the left-panel
 * layout (`lib/navLayoutBootCache.ts`) on the signed-in person's profile
 * from the moment the app mounts, the way `DensitySync` does for the
 * density's copy — whatever page is shown, and whether or not the account
 * menu (where the switch lives) has ever been opened.
 *
 * Renders nothing. Must sit under `QueryClientProvider` and `AuthProvider`.
 */
export function NavLayoutSync(): null {
  useNavLayoutSync();
  return null;
}
