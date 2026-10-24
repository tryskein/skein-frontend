/**
 * sk-622.21 R12 — the Inbox cards accepted in a tab are the accepting
 * person's: a change of the signed-in identity in the same tab (no page
 * reload) drops them. The earlier defect: the
 * snapshots lived in a module `Map` that the logout did not touch, and the
 * next person's Inbox on the same route showed the previous person's card.
 *
 * The stand: the real `AuthProvider` (logout, login, `['auth','me']`) and
 * the real `useInbox` reader on one route; the auth endpoints and the Inbox
 * endpoint are `fetch` stubs that answer for whoever is signed in. The card
 * accepted by U is the snapshot `useAcceptIssue` leaves (`retainAccepted`).
 * The route never changes here, so only the identity can drop the card.
 */
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AuthProvider, ME_KEY, useAuth } from '../AuthContext';
import { useInbox } from '../../lib/useInbox';
import { retainAccepted } from '../../lib/inboxAcceptedRetention';

const ROUTE = '/session-route';

const user = (id: string) => ({
  id, email: `${id}@test.com`, username: id, name: id, role: 'user', createdAt: null, lastLoginAt: null,
});
const issue = (id: string) => ({
  id, projectId: 'p1', parentIdCurrent: null, version: 1, title: id, type: 'task', priority: 2,
  status: 'open', pinned: false, componentIds: [], labels: [], createdByUsername: 'bob',
  updatedAt: '2026-10-01T10:00:00Z', createdAt: '2026-10-01T09:00:00Z',
});

/** Who the server thinks is signed in, and each person's Inbox. */
let signedIn: string | null;
/** Requests for Inbox. */
let inboxReads = 0;
const serverInbox: Record<string, string[]> = {};

function stubServer(): void {
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
    if (url.startsWith('/api/v1/me/assigned-to')) {
      inboxReads += 1;
      const ids = signedIn ? serverInbox[signedIn] : [];
      return json({ items: ids.map(issue), total: ids.length, hasMore: false });
    }
    return json({});
  }));
}

let auth: ReturnType<typeof useAuth>;
function Tab() {
  auth = useAuth();
  const inbox = useInbox(ROUTE);
  return <ul aria-label="inbox">{(inbox.data?.items ?? []).map((it) => <li key={it.id}>{it.id}</li>)}</ul>;
}
const shown = () => screen.queryAllByRole('listitem').map((li) => li.textContent);

let qc: QueryClient;
beforeEach(() => {
  signedIn = 'u-1';
  serverInbox['u-1'] = ['sk-2'];
  serverInbox['v-2'] = ['sk-9'];
  stubServer();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test.each<[string, () => Promise<void>]>([
  ['logout, then login as V', async () => {
    await act(async () => { await auth.logout(); });
    await act(async () => { await auth.login({ email: 'v-2@test.com', password: 'x' } as never); });
  }],
  ['a 401 ends the session, then login as V', async () => {
    signedIn = null;
    act(() => { qc.setQueryData(ME_KEY, null); });
    await act(async () => { await auth.login({ email: 'v-2@test.com', password: 'x' } as never); });
  }],
  ['`/me` answers V (signed in as V elsewhere in this browser)', async () => {
    signedIn = 'v-2';
    await act(async () => { await qc.invalidateQueries({ queryKey: ME_KEY }); });
  }],
])('U accepted a card; %s: V\'s Inbox on the same route does not show it', async (_name, switchToV) => {
  render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <Tab />
      </AuthProvider>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(auth.user?.id).toBe('u-1'));
  // U accepts sk-1 in the Inbox column on ROUTE (the snapshot `useAcceptIssue` leaves).
  await waitFor(() => expect(shown()).toEqual(['sk-2']));
  retainAccepted({ ...issue('sk-1'), acceptedAt: '2026-10-09T10:00:00Z' } as never, 0, ROUTE, 'u-1');
  // Positive control: U's next Inbox answer has the card laid back in.
  serverInbox['u-1'] = ['sk-2', 'sk-3'];
  await act(async () => { await qc.invalidateQueries({ queryKey: ['inbox'] }); });
  await waitFor(() => expect(shown()).toEqual(['sk-1', 'sk-2', 'sk-3']));

  await switchToV();
  await waitFor(() => expect(auth.user?.id).toBe('v-2'));
  // Right after the change of identity, with no
  // Inbox read of its own, the list on screen has no card U accepted.
  const readsAtSwitch = inboxReads;
  await act(async () => { await Promise.resolve(); });
  expect(shown()).not.toContain('sk-1');
  expect(inboxReads).toBe(readsAtSwitch);
  // V's Inbox is read.
  await act(async () => { await qc.invalidateQueries({ queryKey: ['inbox'] }); });
  await waitFor(() => expect(shown()).toContain('sk-9'));
  expect(shown()).toEqual(['sk-9']);
});
