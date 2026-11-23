/**
 * sk-1048.46 — the owner change dialog: nothing is sent until a member is
 * picked, the previous owner is said to stay a member, and a refused change
 * keeps the dialog open with the reason and lets the person try again.
 *
 * The real `changeSpaceOwner` runs against a stubbed `fetch`
 * (`POST /api/v1/spaces/{id}/owner`, body `{ userId }`).
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import i18n from '../../../i18n/config';
import type { SpaceDetail, SpaceMember } from '../../../api/spaces';
import { OwnerChangeDialog } from './OwnerChangeDialog';

function member(userId: string, username: string, role: SpaceMember['role']): SpaceMember {
  return { userId, username, name: '', role, deactivated: false };
}

const SPACE: SpaceDetail = {
  id: 'k3x9p2qa', slug: 'acme', name: 'Acme', kind: 'regular', myRole: 'owner', adminAccess: false,
  canCreateProject: true, memberCount: 2, memberLimit: null, pendingInvitations: 0,
  projectCount: 0, projectQuota: null, storageUsedBytes: 0, storageQuotaBytes: null,
  members: [member('u-anna', 'anna', 'owner'), member('u-oleg', 'oleg', 'member')],
  invitations: null, canDelete: true, cannotDeleteReason: null,
};

const fetchSpy = vi.fn<typeof fetch>();

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  fetchSpy.mockReset();
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function open() {
  const onDone = vi.fn();
  const onClose = vi.fn();
  render(
    <MantineProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
        <OwnerChangeDialog space={SPACE} onClose={onClose} onDone={onDone} />
      </QueryClientProvider>
    </MantineProvider>,
  );
  const confirm = () => screen.getByRole('button', { name: i18n.t('spaces:owner.confirm') });
  const pick = (userId: string) =>
    fireEvent.change(screen.getByRole('combobox', { name: i18n.t('spaces:owner.next') }), { target: { value: userId } });
  return { onDone, onClose, confirm, pick };
}

const stays = () => i18n.t('spaces:owner.stays', { name: 'anna' });

describe('OwnerChangeDialog', () => {
  test('before a member is picked the change is disabled and a submitted form sends nothing', () => {
    const { confirm } = open();

    expect((confirm() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(confirm().closest('form')!);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.queryByText(stays())).toBeNull();
  });

  test('a picked member enables the change and the current owner is said to stay a member', () => {
    const { confirm, pick } = open();

    pick('u-oleg');

    expect((confirm() as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText(stays())).toBeTruthy();
  });

  test('a refusal keeps the dialog open with the reason, and a retry can succeed', async () => {
    const { confirm, pick, onDone, onClose } = open();
    pick('u-oleg');
    fetchSpy.mockResolvedValueOnce(json(422, { error: 'owner_limit_reached', message: 'oleg already owns too many spaces' }));

    fireEvent.click(confirm());

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'oleg already owns too many spaces');
    expect(onDone).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe('/api/v1/spaces/k3x9p2qa/owner');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ userId: 'u-oleg' });

    const next = { ...SPACE, members: [member('u-oleg', 'oleg', 'owner'), member('u-anna', 'anna', 'member')] };
    fetchSpy.mockResolvedValueOnce(json(200, next));
    await waitFor(() => expect((confirm() as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(confirm());

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(onDone.mock.calls[0][0]).toEqual(next);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
