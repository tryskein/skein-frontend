/**
 * The query cache holds the signed-in person's data; when that identity ends
 * or is replaced in the same tab (no page reload), the data has to go with
 * it. The earlier defect: the logout only marked the cache stale and the 401
 * handler only wrote `null` into `['auth','me']`, so the next person to sign
 * in in the tab got the previous person's projects and lists rendered from
 * the cache under the same query keys.
 *
 * The stand: the real `AuthProvider` on the app's real client
 * (`createAppQueryClient`, with its 401 handler); the auth endpoints are
 * mocks. A previous person's answer is seeded under a key the shell reads.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const logoutApi = vi.fn();
const meApi = vi.fn();
const getAuthConfig = vi.fn();

vi.mock('../../api/auth', () => ({
  logoutApi: (...args: unknown[]) => logoutApi(...args),
  meApi: (...args: unknown[]) => meApi(...args),
  getAuthConfig: (...args: unknown[]) => getAuthConfig(...args),
  loginApi: vi.fn(),
}));

import { UnauthorizedError } from '../../api/client';
import { createAppQueryClient } from '../../lib/appQueryClient';
import { AuthProvider, ME_KEY, useAuth } from '../AuthContext';

const user = (id: string) => ({
  id, email: `${id}@test.com`, username: id, name: id, role: 'user', createdAt: null, lastLoginAt: null,
});
const PROJECTS_KEY = ['projects'];

let auth: ReturnType<typeof useAuth>;
function Probe() {
  auth = useAuth();
  return null;
}

let qc: ReturnType<typeof createAppQueryClient>;
beforeEach(() => {
  vi.clearAllMocks();
  meApi.mockResolvedValue(user('u-1'));
  logoutApi.mockResolvedValue({ redirectTo: null });
  getAuthConfig.mockResolvedValue({ authMode: 'local' });
  qc = createAppQueryClient();
});
afterEach(() => {
  cleanup();
});

test.each<[string, () => Promise<void>]>([
  ['logout', async () => {
    await act(async () => { await auth.logout(); });
  }],
  ['a 401 from any request', async () => {
    await act(async () => {
      await qc
        .fetchQuery({ queryKey: ['tasks'], queryFn: () => Promise.reject(new UnauthorizedError()) })
        .catch(() => {});
    });
  }],
  ['`/me` re-read answers nobody', async () => {
    meApi.mockResolvedValue(null);
    await act(async () => { await qc.invalidateQueries({ queryKey: ME_KEY }); });
  }],
  ['`/me` re-read answers another person', async () => {
    meApi.mockResolvedValue(user('v-2'));
    await act(async () => { await qc.invalidateQueries({ queryKey: ME_KEY }); });
  }],
])('after %s, the previous person\'s cached data is gone', async (_name, endSession) => {
  render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(auth.user?.id).toBe('u-1'));
  act(() => { qc.setQueryData(PROJECTS_KEY, [{ id: 'p-of-u-1' }]); });

  await endSession();

  await waitFor(() => expect(auth.user?.id).not.toBe('u-1'));
  await waitFor(() => expect(qc.getQueryData(PROJECTS_KEY)).toBeUndefined());
});
