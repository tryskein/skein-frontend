/**
 * sk-674.18 T050 (review fix No. 5) — "my spaces" belong to the person signed
 * in: a logout and a login of someone else in the same tab (no page reload,
 * the query cache survives) must not show the next person the previous
 * one's spaces — neither after the logout nor while the next person's own
 * answer is still on its way.
 *
 * The stand: the real `AuthProvider` (logout, login, `['auth','me']`) and
 * the real `useMySpaces`; the endpoints are `fetch` stubs that answer for
 * whoever is signed in. The second person's `/me/spaces` answer is held
 * back, so the moment between their login and their data is observable.
 */
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AuthProvider, useAuth } from '../../auth/AuthContext';
import { useMySpaces } from '../useMySpaces';

const user = (id: string) => ({
  id, email: `${id}@test.com`, username: id, name: id, role: 'user', createdAt: null, lastLoginAt: null,
});
const spacesOf = (name: string) => ({
  items: [{
    id: `${name.toLowerCase().slice(0, 8).padEnd(8, 'x')}`, slug: name.toLowerCase(), name,
    kind: 'regular', myRole: 'owner', adminAccess: false, canCreateProject: true,
    memberCount: 1, memberLimit: null, pendingInvitations: 0, projectCount: 0,
    projectQuota: null, storageUsedBytes: 0, storageQuotaBytes: null,
  }],
  ownedCount: 1, ownedLimit: null, canCreate: true, cannotCreateReason: null,
});

/** Who the server thinks is signed in. */
let signedIn: string | null;
/** Requests for /me/spaces, by who was signed in when they arrived. */
let spacesReads: Array<string | null>;
/** Releases the held-back answer for the second person. */
let releaseSecond: () => void;

function stubServer(): void {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  releaseSecond = release;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    if (url.includes('/api/auth/logout')) {
      signedIn = null;
      return json({ redirectTo: null });
    }
    if (url.includes('/api/auth/login')) {
      signedIn = 'v-2';
      return json(user('v-2'));
    }
    if (url.includes('/api/auth/me')) {
      return signedIn ? json(user(signedIn)) : json({ error: 'unauthorized' }, 401);
    }
    if (url.includes('/api/auth/config')) return json({ authMode: 'local' });
    if (url.startsWith('/api/v1/me/spaces')) {
      const who = signedIn;
      spacesReads.push(who);
      if (who === null) return json({ error: 'unauthorized' }, 401);
      if (who === 'v-2') {
        await held;
        return json(spacesOf('Bravo'));
      }
      return json(spacesOf('Acme'));
    }
    return json({});
  }));
}

let auth: ReturnType<typeof useAuth>;
function Tab() {
  auth = useAuth();
  const spaces = useMySpaces();
  return (
    <ul aria-label="spaces">
      {(spaces.data?.items ?? []).map((s) => <li key={s.id}>{s.name}</li>)}
    </ul>
  );
}
const shown = () => screen.queryAllByRole('listitem').map((li) => li.textContent);

let qc: QueryClient;
beforeEach(() => {
  signedIn = 'u-1';
  spacesReads = [];
  stubServer();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test('after a logout and another person\'s login the previous person\'s spaces are not shown', async () => {
  render(
    <QueryClientProvider client={qc}>
      <AuthProvider><Tab /></AuthProvider>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(shown()).toEqual(['Acme']));

  await act(async () => { await auth.logout(); });
  await waitFor(() => expect(auth.user).toBeNull());
  expect(shown()).toEqual([]);

  await act(async () => { await auth.login({ email: 'v-2@test.com', password: 'x' }); });
  await waitFor(() => expect(auth.user?.id).toBe('v-2'));
  // The second person's answer is still held back: the first person's
  // spaces must not stand in for it.
  await waitFor(() => expect(spacesReads).toContain('v-2'));
  expect(shown()).toEqual([]);

  await act(async () => { releaseSecond(); });
  await waitFor(() => expect(shown()).toEqual(['Bravo']));
});
