import { Center, Loader, Stack, Text } from '@mantine/core';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { PushSoftAsk } from '../components/PushSoftAsk';

/**
 * Route guard. Three states:
 *   - isLoading  → render a centered spinner until /api/auth/me settles
 *   - user       → render the nested route via <Outlet />
 *   - no user    → redirect to /login, preserving the attempted path in
 *                  router state so the login page can bounce us back
 */
export function RequireAuth() {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <Center mih="100vh">
        <Stack align="center" gap="xs">
          <Loader color="orange" type="dots" />
          <Text c="ember.3" size="xs" tt="lowercase">
            authenticating...
          </Text>
        </Stack>
      </Center>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  // Mounted here (inside the authed boundary) so the Web Push soft-ask +
  // service-worker registration / login re-sync only run for a logged-in
  // user — never on /login. PushSoftAsk self-suppresses unless push is
  // supported, permission is still 'default', and it wasn't recently
  // dismissed (usePush does the SW registration as a mount side-effect).
  return (
    <>
      <PushSoftAsk />
      <Outlet />
    </>
  );
}
