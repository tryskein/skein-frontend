import { Center, Loader, Stack, Text } from '@mantine/core';
import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from './AuthContext';
import { PushForeignChannelNotice } from '../components/PushForeignChannelNotice';
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

  // The push banners belong to a signed-in user, so they are mounted inside
  // the authed boundary. They only read the push state (`usePush`); the push
  // controller itself runs in `PushProvider` and registers nothing on mount.
  return (
    <>
      <PushForeignChannelNotice />
      <PushSoftAsk />
      <Outlet />
    </>
  );
}
