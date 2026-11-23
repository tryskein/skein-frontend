/**
 * Choosing an existing person in the space invite form (`InviteForm`).
 *
 * Typing a name searches people after a short pause, through the interface
 * the caller may use: the user list for an administrator, the people
 * directory for a member. Picking one of them addresses them by id, never by
 * an email: an administrator's «Add» puts the person straight into this space
 * (`POST /spaces/{id}/members`), and «Invite» sends an invitation to that id.
 * A success and a refusal each say what happened.
 *
 * The stand: the real form on a `fetch` stub that models the endpoints.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SpaceDetail } from '../../../api/spaces';
import i18n from '../../../i18n/config';
import { InviteForm } from './InviteForm';

const SPACE: SpaceDetail = {
  id: 'sp-acme', slug: 'acme', name: 'Acme', kind: 'regular', myRole: 'owner', adminAccess: false,
  canCreateProject: true, memberCount: 3, memberLimit: null, pendingInvitations: 0,
  projectCount: 0, projectQuota: null, storageUsedBytes: 0, storageQuotaBytes: null,
  members: [], invitations: [], canDelete: true, cannotDeleteReason: null,
} as SpaceDetail;

const OLEG = { id: 'u-oleg', username: 'oleg', name: 'Oleg Petrov' };

let refuseAdd: { status: number; body: { error: string; message: string } } | null;
const fetchSpy = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  refuseAdd = null;
  fetchSpy.mockReset();
  fetchSpy.mockImplementation(async (input, init) => {
    const url = new URL(String(input), 'http://skein.test');
    const method = init?.method ?? 'GET';
    if (url.pathname === '/api/auth/config') {
      return json({ authMode: 'local', signupEnabled: false, emailEnabled: true, turnstileSiteKey: null });
    }
    if (url.pathname === '/api/v1/users' && method === 'GET') {
      return json({ items: url.searchParams.get('search') === 'ole' ? [{ ...OLEG, email: 'o@x.io', role: 'user' }] : [], nextCursor: null });
    }
    if (url.pathname === '/api/v1/users/directory' && method === 'GET') {
      return json({ items: url.searchParams.get('q') === 'ole' ? [OLEG] : [], hasMore: false });
    }
    if (url.pathname === '/api/v1/spaces/sp-acme/members' && method === 'POST') {
      if (refuseAdd) return json(refuseAdd.body, refuseAdd.status);
      return json({ userId: OLEG.id, username: OLEG.username, name: OLEG.name, role: 'member' });
    }
    if (url.pathname === '/api/v1/spaces/sp-acme/invitations' && method === 'POST') {
      return json({ outcome: 'sent', invitation: { id: 'inv-9' } });
    }
    return json({ error: 'unexpected' }, 599);
  });
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderForm(isAdmin: boolean) {
  const onChanged = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <MantineProvider>
      <QueryClientProvider client={qc}>
        <InviteForm space={SPACE} isAdmin={isAdmin} onClose={() => {}} onChanged={onChanged} />
      </QueryClientProvider>
    </MantineProvider>,
  );
  return { onChanged };
}

const tt = (key: string, opts: Record<string, unknown> = {}) => i18n.t(`spaces:${key}`, opts) as string;
const requests = () =>
  fetchSpy.mock.calls
    .map((c) => ({ url: String(c[0]), method: c[1]?.method ?? 'GET', body: c[1]?.body ? JSON.parse(String(c[1].body)) : null }))
    .filter((r) => !r.url.startsWith('/api/auth/'));

async function pickOleg() {
  const user = userEvent.setup();
  await user.type(screen.getByRole('textbox', { name: tt('invite.field') }), 'ole');
  const option = await screen.findByRole('button', { name: /oleg/ });
  await user.click(option);
  return user;
}

describe('InviteForm — an existing person', () => {
  test('an administrator finds people in the user list and adds the picked one to this space', async () => {
    const { onChanged } = renderForm(true);
    const user = await pickOleg();

    const searches = requests().filter((r) => r.method === 'GET');
    expect(searches.map((r) => r.url)).toContain('/api/v1/users?search=ole&external=false&limit=10');
    expect(searches.some((r) => r.url.startsWith('/api/v1/users/directory'))).toBe(false);

    await user.click(screen.getByRole('button', { name: tt('invite.add') }));

    expect(await screen.findByText(tt('invite.added', { name: 'oleg', space: 'Acme' }))).toBeTruthy();
    const writes = requests().filter((r) => r.method !== 'GET');
    expect(writes).toEqual([{ url: '/api/v1/spaces/sp-acme/members', method: 'POST', body: { userId: 'u-oleg' } }]);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  test('a member finds people in the directory and invites the picked one by id, not by email', async () => {
    renderForm(false);
    const user = await pickOleg();

    const searches = requests().filter((r) => r.method === 'GET');
    expect(searches.map((r) => r.url)).toContain('/api/v1/users/directory?q=ole&limit=10');
    expect(searches.some((r) => r.url.startsWith('/api/v1/users?'))).toBe(false);
    expect(screen.queryByRole('button', { name: tt('invite.add') })).toBeNull();

    await user.click(screen.getByRole('button', { name: tt('invite.invite') }));

    expect(await screen.findByText(tt('invite.sent'))).toBeTruthy();
    const writes = requests().filter((r) => r.method !== 'GET');
    expect(writes).toHaveLength(1);
    expect(writes[0].url).toBe('/api/v1/spaces/sp-acme/invitations');
    expect(writes[0].body).toMatchObject({ userId: 'u-oleg' });
    expect(writes[0].body).not.toHaveProperty('email');
  });

  test('a refused add says why, sends no invitation and reports no change', async () => {
    refuseAdd = { status: 422, body: { error: 'already_member', message: 'member exists' } };
    const { onChanged } = renderForm(true);
    const user = await pickOleg();

    await user.click(screen.getByRole('button', { name: tt('invite.add') }));

    expect(await screen.findByText(tt('invite.errors.already_member'))).toBeTruthy();
    await waitFor(() => expect(requests().filter((r) => r.method !== 'GET')).toHaveLength(1));
    expect(requests().some((r) => r.url.endsWith('/invitations'))).toBe(false);
    expect(screen.queryByText(tt('invite.added', { name: 'oleg', space: 'Acme' }))).toBeNull();
    expect(onChanged).not.toHaveBeenCalled();
  });
  const searches = () => requests().filter((r) => r.method === 'GET' && r.url.startsWith('/api/v1/users'));
  const field = () => screen.getByRole('textbox', { name: tt('invite.field') }) as HTMLInputElement;

  test('nothing is searched before typing; a typed word is searched once, trimmed, after the pause', async () => {
    renderForm(false);
    const user = userEvent.setup();
    expect(searches()).toEqual([]);

    await user.type(field(), '  ole ');

    await screen.findByRole('button', { name: /oleg/ });
    expect(searches().map((r) => r.url)).toEqual(['/api/v1/users/directory?q=ole&limit=10']);
  });

  test('an address with @ is not searched as a name', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderForm(true);
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      await user.type(field(), 'ole@acme.io');
      await act(() => vi.advanceTimersByTimeAsync(1000));

      expect(searches()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  test('«Add» without a picked person asks to pick one and sends nothing', async () => {
    renderForm(true);
    const user = userEvent.setup();
    await user.type(field(), 'ole');

    await user.click(screen.getByRole('button', { name: tt('invite.add') }));

    expect(await screen.findByText(tt('invite.pickForAdd'))).toBeTruthy();
    expect(requests().filter((r) => r.method !== 'GET')).toEqual([]);
  });

  test('after an add the field is empty and ready for the next person', async () => {
    renderForm(true);
    const user = await pickOleg();

    await user.click(screen.getByRole('button', { name: tt('invite.add') }));

    await screen.findByText(tt('invite.added', { name: 'oleg', space: 'Acme' }));
    expect(field().value).toBe('');
  });

  test('a failure that is not a business refusal shows the server message as it is', async () => {
    refuseAdd = { status: 500, body: { error: 'already_member', message: 'storage is down' } };
    renderForm(true);
    const user = await pickOleg();

    await user.click(screen.getByRole('button', { name: tt('invite.add') }));

    expect(await screen.findByText('storage is down')).toBeTruthy();
    expect(screen.queryByText(tt('invite.errors.already_member'))).toBeNull();
  });
});
