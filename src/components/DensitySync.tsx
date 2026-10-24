import { useDensitySync } from '../lib/useDensity';

/**
 * DensitySync — sk-551.7. Keeps `<html data-density>` on the signed-in
 * person's density from the moment the app mounts, the way `ThemeSync`
 * keeps `data-theme`. The switch lives in the account menu, which Mantine
 * mounts only when it opens; without a root-level reader the stored
 * density would be applied the first time someone clicked the avatar
 * (the exact defect `ThemeSync.tsx` describes for the theme).
 *
 * Renders nothing. Must sit under `QueryClientProvider` and `AuthProvider`.
 */
export function DensitySync(): null {
  useDensitySync();
  return null;
}
