/**
 * sk-674.18 T057 — the settings of a space (US-4, US-5,
 * US-7, US-14; screens 2.3, 2.14).
 *
 *   • invitations: "Again" and "Revoke" reach the server for that
 *     invitation; a declined one has neither; a member sees no list;
 *   • removing a member shows the server's preview before the button, and
 *     the button removes that member; the owner's row has no button;
 *   • leaving (a member) shows the first-person consequences and leaves;
 *   • deleting: the button is on only once the typed text is the name, the
 *     typed name goes to the server, and its `name_mismatch` is said under
 *     the field;
 *   • the admin changes the owner among the members;
 *   • quota labels only for the limits that are set; "Seats taken: N of M
 *     (K of them invitations)", without brackets when nothing is pending.
 *
 * The real page and dialogs; stubbed are the network (spaces and
 * invitations routes), the signed-in person and the header.
 */
import { afterEach, beforeEach, describe, expect, test, vi, type MockInstance } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import i18n from '../../../i18n/config';
import type { SpaceDetail, SpaceMember } from '../../../api/spaces';
import { BusinessError } from '../../../api/client';
import { toaster } from '../../../components/Toaster';

const world = vi.hoisted(() => ({
  user: { id: 'u-anna', username: 'anna', role: 'user', isExternal: false } as {
    id: string;
    username: string;
    role: string;
    isExternal: boolean;
  },
  detail: null as unknown,
  /** GET /spaces/{id} of other spaces, by id; any other id answers `detail`. */
  details: {} as Record<string, unknown>,
  /** GET /spaces/{id}/deletion-preview — replaced per test to hold or refuse it. */
  deletionPreview: null as unknown as () => Promise<unknown>,
  /** `turnstileSiteKey` of `/api/auth/config`; null — Turnstile is not configured. */
  siteKey: 'site-key' as string | null,
}));
const api = vi.hoisted(() => ({
  createInvitation: vi.fn(async (_s: string, _input: unknown): Promise<unknown> => ({ outcome: 'sent', invitation: null })),
  resendInvitation: vi.fn(async (_s: string, _i: string, _token?: string): Promise<unknown> => ({})),
  revokeInvitation: vi.fn(async (_s: string, _i: string) => undefined),
  removeSpaceMember: vi.fn(async (_s: string, _u: string) => undefined),
  leaveSpace: vi.fn(async (_s: string) => undefined),
  deleteSpace: vi.fn(async (_s: string, _n: string) => undefined),
  changeSpaceOwner: vi.fn(async (_s: string, _u: string) => world.detail),
  getMemberRemovalPreview: vi.fn(async (_s: string, _u: string) => ({
    openAssignedIssues: 4,
    claimedIssues: 1,
    ownedProjects: [{ id: 'pr-1', name: 'Website', idPrefix: 'web' }],
  })),
}));

vi.mock('../../../auth/AuthContext', () => ({
  useAuthOptional: () => ({ user: world.user }),
  useAuth: () => ({ user: world.user, isLoading: false, logout: vi.fn() }),
}));
vi.mock('../../shell/HeaderBar', () => ({
  HeaderBar: () => <div data-testid="header" />,
}));
vi.mock('../../../api/spaces', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/spaces')>();
  return {
    ...actual,
    getSpace: async (id: string) => (world.details[id] ?? world.detail) as SpaceDetail,
    getMySpaces: async () => ({ items: [], ownedCount: 0, ownedLimit: null, canCreate: true, cannotCreateReason: null }),
    getMemberRemovalPreview: api.getMemberRemovalPreview,
    getSpaceDeletionPreview: () => world.deletionPreview(),
    removeSpaceMember: api.removeSpaceMember,
    leaveSpace: api.leaveSpace,
    deleteSpace: api.deleteSpace,
    changeSpaceOwner: api.changeSpaceOwner,
  };
});
vi.mock('../../../api/invitations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/invitations')>();
  return {
    ...actual,
    createInvitation: api.createInvitation,
    resendInvitation: api.resendInvitation,
    revokeInvitation: api.revokeInvitation,
  };
});
// The instance asks for Turnstile (a site key is set); the widget itself is
// `window.turnstile`, faked below — the script is never loaded.
vi.mock('../../../api/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/auth')>();
  return {
    ...actual,
    getAuthConfig: async () => ({
      authMode: 'local', logoutRedirectUrl: null, mcpUrl: null, signupEnabled: false, emailEnabled: true,
      turnstileSiteKey: world.siteKey, projectPrefixMinLength: null, termsUrl: null, privacyUrl: null,
    }),
  };
});

import { SpaceSettingsPage } from './SpaceSettingsPage';

const ACME = 'k3x9p2qa';
const DELETION_PREVIEW = {
  projectCount: 6,
  issueCount: 412,
  storageBytes: 0,
  pendingInvitations: 2,
  ownerUsername: 'anna',
};

function member(userId: string, username: string, role: SpaceMember['role']): SpaceMember {
  return { userId, username, name: username.toUpperCase(), role, deactivated: false };
}

function detail(over: Partial<SpaceDetail> = {}): SpaceDetail {
  return {
    id: ACME, slug: 'acme', name: 'Acme', kind: 'regular', myRole: 'owner', adminAccess: false,
    canCreateProject: true, memberCount: 3, memberLimit: null, pendingInvitations: 0,
    projectCount: 6, projectQuota: null, storageUsedBytes: 0, storageQuotaBytes: null,
    members: [member('u-anna', 'anna', 'owner'), member('u-oleg', 'oleg', 'member'), member('u-max', 'max', 'member')],
    invitations: [
      { id: 'inv-1', email: 'dev@client.io', status: 'pending', invitedBy: 'anna', expiresAt: '2026-10-18T00:00:00Z', createdAt: '2026-10-11T00:00:00Z' },
      { id: 'inv-2', email: 'max@example.com', status: 'not_accepted', invitedBy: 'anna', expiresAt: null, createdAt: '2026-10-10T00:00:00Z' },
    ],
    canDelete: true,
    cannotDeleteReason: null,
    ...over,
  };
}

let location = '';
function LocationProbe() {
  location = useLocation().pathname;
  return null;
}

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <MantineProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`/settings/spaces/${ACME}-acme`]}>
          <Routes>
            <Route path="/settings/spaces/:space" element={<SpaceSettingsPage />} />
            <Route path="*" element={<LocationProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

/** The page answered: the members' panel is there. */
const loaded = () =>
  screen.findByRole('heading', { name: i18n.t('spaces:settings.membersTitle', { count: 3 }) });
const button = (name: string) => screen.getByRole('button', { name });
const queryButton = (name: string) => screen.queryByRole('button', { name });
/** No line on the page starts with the fixed part of a quota label. */
function noLineOf(key: string) {
  const lead = i18n.t(key, { used: '§', limit: '§', count: '§', quota: '§' }).split('§')[0];
  expect(screen.queryByText((text) => text.startsWith(lead))).toBeNull();
}

beforeEach(async () => {
  await i18n.changeLanguage('ru');
  world.user = { id: 'u-anna', username: 'anna', role: 'user', isExternal: false };
  world.detail = detail();
  world.details = {};
  world.siteKey = 'site-key';
  world.deletionPreview = async () => DELETION_PREVIEW;
  for (const fn of Object.values(api)) fn.mockClear();
  location = '';
});

afterEach(() => cleanup());

describe('row 250 — invitations', () => {
  test('"Again" and "Revoke" go to the server for that invitation; a declined one has neither', async () => {
    mount();
    await loaded();
    fireEvent.click(button(i18n.t('spaces:settings.resendAria', { email: 'dev@client.io' })));
    await waitFor(() => expect(api.resendInvitation).toHaveBeenCalledWith(ACME, 'inv-1', undefined));
    fireEvent.click(button(i18n.t('spaces:settings.revokeAria', { email: 'dev@client.io' })));
    await waitFor(() => expect(api.revokeInvitation).toHaveBeenCalledWith(ACME, 'inv-1'));

    expect(queryButton(i18n.t('spaces:settings.resendAria', { email: 'max@example.com' }))).toBeNull();
    expect(queryButton(i18n.t('spaces:settings.revokeAria', { email: 'max@example.com' }))).toBeNull();
    expect(screen.getByText(i18n.t('spaces:settings.invitationStatus.not_accepted'))).toBeTruthy();
  });

  test('a member sees neither the list nor "Invite"', async () => {
    world.user = { id: 'u-oleg', username: 'oleg', role: 'user', isExternal: false };
    world.detail = detail({ myRole: 'member', invitations: null, canDelete: false, cannotDeleteReason: 'forbidden' });
    mount();
    await loaded();
    expect(screen.queryByRole('heading', { name: i18n.t('spaces:settings.invitationsTitle', { count: 2 }) })).toBeNull();
    expect(queryButton(i18n.t('spaces:settings.invite'))).toBeNull();
    expect(queryButton(i18n.t('spaces:settings.delete'))).toBeNull();
  });
});

describe('row 250 — removing a member and leaving', () => {
  test('the preview is shown before the button; "Remove" removes that member', async () => {
    mount();
    await loaded();
    // The owner's row has no button.
    expect(queryButton(i18n.t('spaces:settings.removeAria', { name: 'anna' }))).toBeNull();

    fireEvent.click(button(i18n.t('spaces:settings.removeAria', { name: 'oleg' })));
    const dialog = await screen.findByRole('dialog', {
      name: i18n.t('spaces:removal.removeTitle', { name: 'oleg', space: 'Acme' }),
    });
    expect(api.getMemberRemovalPreview).toHaveBeenCalledWith(ACME, 'u-oleg');
    await within(dialog).findByText(i18n.t('spaces:removal.openAssigned', { count: 4 }));
    expect(
      within(dialog).getByText(
        i18n.t('spaces:removal.owned', { name: 'oleg', space: 'Acme', projects: 'Website' }),
      ),
    ).toBeTruthy();
    expect(api.removeSpaceMember).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: i18n.t('spaces:removal.confirmRemove') }));
    await waitFor(() => expect(api.removeSpaceMember).toHaveBeenCalledWith(ACME, 'u-oleg'));
  });

  test('a member leaves: first-person consequences, then the space is left and the tab goes to /', async () => {
    world.user = { id: 'u-oleg', username: 'oleg', role: 'user', isExternal: false };
    world.detail = detail({ myRole: 'member', invitations: null, canDelete: false, cannotDeleteReason: 'forbidden' });
    mount();
    await loaded();
    fireEvent.click(button(i18n.t('spaces:settings.leave')));
    const dialog = await screen.findByRole('dialog', { name: i18n.t('spaces:removal.leaveTitle', { space: 'Acme' }) });
    expect(api.getMemberRemovalPreview).toHaveBeenCalledWith(ACME, 'u-oleg');
    await within(dialog).findByText(i18n.t('spaces:removal.myOpenAssigned', { count: 4 }));
    fireEvent.click(within(dialog).getByRole('button', { name: i18n.t('spaces:removal.confirmLeave') }));
    await waitFor(() => expect(api.leaveSpace).toHaveBeenCalledWith(ACME));
    await waitFor(() => expect(location).toBe('/'));
  });

  test('the owner has no "Leave"', async () => {
    mount();
    await loaded();
    expect(queryButton(i18n.t('spaces:settings.leave'))).toBeNull();
  });
});

describe('row 250 — deleting the space', () => {
  test('on only once the name is typed; the typed name goes to the server', async () => {
    mount();
    await loaded();
    fireEvent.click(button(i18n.t('spaces:settings.delete')));
    const dialog = await screen.findByRole('dialog', { name: i18n.t('spaces:deletion.title', { name: 'Acme' }) });
    const confirm = within(dialog).getByRole('button', { name: i18n.t('spaces:deletion.confirm') });
    const field = within(dialog).getByRole('textbox', { name: i18n.t('spaces:deletion.typeName') });

    fireEvent.change(field, { target: { value: 'Acm' } });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(field, { target: { value: 'Acme' } });
    expect((confirm as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(confirm);
    await waitFor(() => expect(api.deleteSpace).toHaveBeenCalledWith(ACME, 'Acme'));
    await waitFor(() => expect(location).toBe('/'));
  });

  test('the server’s `name_mismatch` is said under the field', async () => {
    api.deleteSpace.mockRejectedValueOnce(new BusinessError(422, 'mismatch', 'name_mismatch'));
    mount();
    await loaded();
    fireEvent.click(button(i18n.t('spaces:settings.delete')));
    const dialog = await screen.findByRole('dialog', { name: i18n.t('spaces:deletion.title', { name: 'Acme' }) });
    fireEvent.change(within(dialog).getByRole('textbox', { name: i18n.t('spaces:deletion.typeName') }), {
      target: { value: 'Acme' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: i18n.t('spaces:deletion.confirm') }));
    await within(dialog).findByText(i18n.t('spaces:deletion.errors.name_mismatch'));
    expect(location).toBe('');
  });

  test('the common space with projects: the button is off with its reason', async () => {
    world.detail = detail({ kind: 'common', canDelete: false, cannotDeleteReason: 'common_space_not_empty' });
    mount();
    await loaded();
    const del = screen.getByRole('button', {
      name: i18n.t('spaces:settings.delete'),
      description: i18n.t('spaces:settings.cannotDelete.common_space_not_empty'),
    });
    expect((del as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('no deletion without a successful preview', () => {
  async function openDeletion() {
    mount();
    await loaded();
    fireEvent.click(button(i18n.t('spaces:settings.delete')));
    return screen.findByRole('dialog', { name: i18n.t('spaces:deletion.title', { name: 'Acme' }) });
  }
  /** Type the name and try both ways to send: the button and the form's Enter. */
  function typeAndTry(dialog: HTMLElement) {
    const field = within(dialog).getByRole('textbox', { name: i18n.t('spaces:deletion.typeName') });
    fireEvent.change(field, { target: { value: 'Acme' } });
    fireEvent.click(within(dialog).getByRole('button', { name: i18n.t('spaces:deletion.confirm') }));
    fireEvent.submit(field.closest('form')!);
  }

  test('preview still loading — the name typed, nothing is deleted', async () => {
    world.deletionPreview = () => new Promise(() => undefined);
    const dialog = await openDeletion();
    typeAndTry(dialog);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(api.deleteSpace).not.toHaveBeenCalled();
    expect((within(dialog).getByRole('button', { name: i18n.t('spaces:deletion.confirm') }) as HTMLButtonElement).disabled).toBe(true);
  });

  test('preview refused — "Retry" is offered, nothing is deleted; after a successful retry it is', async () => {
    let fail = true;
    world.deletionPreview = () => (fail ? Promise.reject(new Error('boom')) : Promise.resolve(DELETION_PREVIEW));
    const dialog = await openDeletion();
    await within(dialog).findByText(i18n.t('spaces:deletion.previewFailed'));
    typeAndTry(dialog);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(api.deleteSpace).not.toHaveBeenCalled();

    fail = false;
    fireEvent.click(within(dialog).getByRole('button', { name: i18n.t('spaces:deletion.retry') }));
    await within(dialog).findByText(i18n.t('spaces:deletion.invitations'));
    fireEvent.click(within(dialog).getByRole('button', { name: i18n.t('spaces:deletion.confirm') }));
    await waitFor(() => expect(api.deleteSpace).toHaveBeenCalledTimes(1));
    expect(api.deleteSpace).toHaveBeenCalledWith(ACME, 'Acme');
  });
});

describe('row 250 — the admin changes the owner', () => {
  test('among the members; the choice goes to the server', async () => {
    world.user = { id: 'u-root', username: 'root', role: 'admin', isExternal: false };
    world.detail = detail({ myRole: null, adminAccess: true });
    mount();
    await loaded();
    fireEvent.click(button(i18n.t('spaces:settings.changeOwner')));
    const dialog = await screen.findByRole('dialog', { name: i18n.t('spaces:owner.title', { space: 'Acme' }) });
    const select = within(dialog).getByRole('combobox', { name: i18n.t('spaces:owner.next') });
    // Only members, the current owner not among them.
    const values = within(select).getAllByRole('option').map((o) => (o as HTMLOptionElement).value);
    expect(values).toEqual(['', 'u-oleg', 'u-max']);
    fireEvent.change(select, { target: { value: 'u-max' } });
    fireEvent.click(within(dialog).getByRole('button', { name: i18n.t('spaces:owner.confirm') }));
    await waitFor(() => expect(api.changeSpaceOwner).toHaveBeenCalledWith(ACME, 'u-max'));
  });

  test('not offered to the owner who is not the instance admin', async () => {
    mount();
    await loaded();
    expect(queryButton(i18n.t('spaces:settings.changeOwner'))).toBeNull();
  });
});

describe('the tables name their columns', () => {
  test('members and invitations have localized column headers', async () => {
    mount();
    await loaded();
    const headers = (caption: string) =>
      within(screen.getByRole('table', { name: caption }))
        .getAllByRole('columnheader')
        .map((h) => h.textContent);
    expect(headers(i18n.t('spaces:settings.membersCaption'))).toEqual(
      ['username', 'name', 'role', 'actions'].map((k) => i18n.t(`spaces:settings.membersCol.${k}`)),
    );
    expect(headers(i18n.t('spaces:settings.invitationsCaption'))).toEqual(
      ['email', 'expires', 'status', 'actions'].map((k) => i18n.t(`spaces:settings.invitationsCol.${k}`)),
    );
  });
});

describe('row 250 — seats and quotas (K3)', () => {
  test('set limits only; seats count pending invitations', async () => {
    world.detail = detail({ memberCount: 5, pendingInvitations: 2, memberLimit: 25, projectCount: 6, projectQuota: 10 });
    mount();
    await loaded();
    expect(screen.getByText(i18n.t('spaces:quota.seatsWithInvitations', { used: 7, limit: 25, count: 2 }))).toBeTruthy();
    expect(screen.getByText(i18n.t('spaces:quota.projects', { count: 6, quota: 10 }))).toBeTruthy();
    // Storage quota not set — no line.
    noLineOf('spaces:quota.storage');
  });

  test('files over the soft quota: "5.3 of 5 GB · upload stopped"', async () => {
    const GIB = 1024 ** 3;
    world.detail = detail({ storageUsedBytes: Math.round(5.3 * GIB), storageQuotaBytes: 5 * GIB });
    mount();
    await loaded();
    expect(
      screen.getByText(
        i18n.t('spaces:quota.storage', { used: '5,3', quota: '5 ГБ' }) + i18n.t('spaces:quota.storageStopped'),
      ),
    ).toBeTruthy();
  });

  test('files under the quota: the line without the stop', async () => {
    const GIB = 1024 ** 3;
    world.detail = detail({ storageUsedBytes: Math.round(1.2 * GIB), storageQuotaBytes: 5 * GIB });
    mount();
    await loaded();
    expect(screen.getByText(i18n.t('spaces:quota.storage', { used: '1,2', quota: '5 ГБ' }))).toBeTruthy();
  });

  test('nothing pending — the seats line has no brackets', async () => {
    world.detail = detail({ memberCount: 5, pendingInvitations: 0, memberLimit: 25 });
    mount();
    await loaded();
    expect(screen.getByText(i18n.t('spaces:quota.seats', { used: 5, limit: 25 }))).toBeTruthy();
  });

  test('no limit set — no seats, projects or files line', async () => {
    mount();
    await loaded();
    noLineOf('spaces:quota.seats');
    noLineOf('spaces:quota.projects');
    noLineOf('spaces:quota.storage');
  });
});

// ───────────────────────── Invitation form and Turnstile ─────────────────────────

/** A fake `window.turnstile`: every rendered widget, its callbacks, removals and resets. */
interface FakeWidget {
  id: string;
  options: Record<string, unknown> & { callback: (token: string) => void };
  removed: boolean;
}
function installTurnstile() {
  const widgets: FakeWidget[] = [];
  const fake = {
    render: vi.fn((_el: HTMLElement, options: FakeWidget['options']) => {
      const w: FakeWidget = { id: `w${widgets.length + 1}`, options, removed: false };
      widgets.push(w);
      return w.id;
    }),
    remove: vi.fn((id: string) => {
      const w = widgets.find((x) => x.id === id);
      if (w) w.removed = true;
    }),
    reset: vi.fn(),
  };
  (window as unknown as { turnstile?: unknown }).turnstile = fake;
  return { widgets, fake, live: () => widgets.filter((w) => !w.removed) };
}

describe('the invitation form and its captcha', () => {
  let ts: ReturnType<typeof installTurnstile>;
  beforeEach(() => {
    ts = installTurnstile();
  });
  afterEach(() => {
    delete (window as unknown as { turnstile?: unknown }).turnstile;
  });

  const captchaRequired = () => new BusinessError(422, 'captcha', 'captcha_required');
  async function openForm() {
    mount();
    await loaded();
    fireEvent.click(button(i18n.t('spaces:settings.invite')));
    return screen.findByRole('dialog', { name: i18n.t('spaces:invite.title', { space: 'Acme' }) });
  }
  const field = (dialog: HTMLElement) =>
    within(dialog).getByRole('textbox', { name: i18n.t('spaces:invite.field') });
  const send = (dialog: HTMLElement) =>
    fireEvent.click(within(dialog).getByRole('button', { name: i18n.t('spaces:invite.invite') }));

  test('#1 — A → captcha_required → the field changed to B → a token: the invitation of A does not go', async () => {
    api.createInvitation.mockRejectedValueOnce(captchaRequired());
    const dialog = await openForm();
    fireEvent.change(field(dialog), { target: { value: 'a@client.io' } });
    send(dialog);
    await waitFor(() => expect(ts.widgets).toHaveLength(1));
    expect(api.createInvitation).toHaveBeenCalledTimes(1);

    fireEvent.change(field(dialog), { target: { value: 'b@client.io' } });
    // The token of the challenge issued for A arrives after the change.
    act(() => ts.widgets[0].options.callback('token-for-a'));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(api.createInvitation).toHaveBeenCalledTimes(1);
    expect(api.createInvitation.mock.calls.some(([, input]) => (input as { email?: string }).email === 'a@client.io' && (input as { turnstileToken?: string }).turnstileToken)).toBe(false);
  });

  test('#4 — captcha_failed: a NEW challenge, its token sends again; the form stays open', async () => {
    api.createInvitation
      .mockRejectedValueOnce(captchaRequired())
      .mockRejectedValueOnce(new BusinessError(422, 'bad token', 'captcha_failed'));
    const dialog = await openForm();
    fireEvent.change(field(dialog), { target: { value: 'a@client.io' } });
    send(dialog);
    await waitFor(() => expect(ts.widgets).toHaveLength(1));
    // An expired token is refreshed by the person, never by the widget alone.
    expect(ts.widgets[0].options['refresh-expired']).toBe('manual');

    act(() => ts.widgets[0].options.callback('token-1'));
    await waitFor(() => expect(api.createInvitation).toHaveBeenCalledTimes(2));
    expect(api.createInvitation.mock.calls[1][1]).toMatchObject({ email: 'a@client.io', turnstileToken: 'token-1' });

    // The refused token's widget is gone; a fresh one is up.
    await waitFor(() => expect(ts.live()).toHaveLength(1));
    expect(ts.widgets).toHaveLength(2);
    expect(ts.widgets[0].removed).toBe(true);

    act(() => ts.widgets[1].options.callback('token-2'));
    await waitFor(() => expect(api.createInvitation).toHaveBeenCalledTimes(3));
    expect(api.createInvitation.mock.calls[2][1]).toMatchObject({ email: 'a@client.io', turnstileToken: 'token-2' });
    await within(dialog).findByText(i18n.t('spaces:invite.sent'));
    expect(screen.getByRole('dialog', { name: i18n.t('spaces:invite.title', { space: 'Acme' }) })).toBe(dialog);
    // Sent — the widget is taken down.
    expect(ts.live()).toHaveLength(0);
  });

  test('#4 — a refusal other than the captcha takes the widget down: no later token sends anything', async () => {
    api.createInvitation
      .mockRejectedValueOnce(captchaRequired())
      .mockRejectedValueOnce(new BusinessError(422, 'limit', 'daily_limit'));
    const dialog = await openForm();
    fireEvent.change(field(dialog), { target: { value: 'a@client.io' } });
    send(dialog);
    await waitFor(() => expect(ts.widgets).toHaveLength(1));
    act(() => ts.widgets[0].options.callback('token-1'));
    await within(dialog).findByText(i18n.t('spaces:invite.errors.daily_limit'));
    expect(ts.live()).toHaveLength(0);
    // A late callback of that widget (a refreshed token) sends nothing.
    act(() => ts.widgets[0].options.callback('token-late'));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(api.createInvitation).toHaveBeenCalledTimes(2);
  });
});

// ───────────────────────── T067 — a resend passes the captcha rule ─────────────────────────

describe('T067 — resending an invitation: captcha_required shows Turnstile, its token resends', () => {
  let ts: ReturnType<typeof installTurnstile>;
  let toastError: MockInstance<typeof toaster.error>;
  beforeEach(() => {
    ts = installTurnstile();
    toastError = vi.spyOn(toaster, 'error').mockImplementation(() => '');
  });
  afterEach(() => {
    delete (window as unknown as { turnstile?: unknown }).turnstile;
    toastError.mockRestore();
  });

  const refusal = (code: string) => new BusinessError(422, code, code);
  const resendInList = () => button(i18n.t('spaces:settings.resendAria', { email: 'dev@client.io' }));

  test('"Again" in the list → captcha_required → the widget; its token resends that invitation with the token', async () => {
    api.resendInvitation.mockRejectedValueOnce(refusal('captcha_required'));
    mount();
    await loaded();
    fireEvent.click(resendInList());
    await waitFor(() => expect(ts.widgets).toHaveLength(1));
    expect(api.resendInvitation).toHaveBeenCalledTimes(1);
    expect(api.resendInvitation.mock.calls[0][2]).toBeUndefined();
    expect(ts.widgets[0].options['refresh-expired']).toBe('manual');

    act(() => ts.widgets[0].options.callback('token-1'));
    await waitFor(() => expect(api.resendInvitation).toHaveBeenCalledTimes(2));
    expect(api.resendInvitation.mock.calls[1]).toEqual([ACME, 'inv-1', 'token-1']);
    // Resent — the widget is taken down, a late token sends nothing.
    await waitFor(() => expect(ts.live()).toHaveLength(0));
    act(() => ts.widgets[0].options.callback('token-late'));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(api.resendInvitation).toHaveBeenCalledTimes(2);
  });

  test('the list: captcha_failed of the token — the refusal and a fresh challenge whose token resends again', async () => {
    api.resendInvitation
      .mockRejectedValueOnce(refusal('captcha_required'))
      .mockRejectedValueOnce(refusal('captcha_failed'));
    mount();
    await loaded();
    fireEvent.click(resendInList());
    await waitFor(() => expect(ts.widgets).toHaveLength(1));
    act(() => ts.widgets[0].options.callback('token-1'));
    // The refusal is said (a toast), and the next check is a fresh one.
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(ts.widgets).toHaveLength(2));
    expect(ts.widgets[0].removed).toBe(true);

    act(() => ts.widgets[1].options.callback('token-2'));
    await waitFor(() => expect(api.resendInvitation).toHaveBeenCalledTimes(3));
    expect(api.resendInvitation.mock.calls[2]).toEqual([ACME, 'inv-1', 'token-2']);
  });

  test('the list: a refusal other than the captcha after the token takes the widget down; a late token sends nothing', async () => {
    api.resendInvitation
      .mockRejectedValueOnce(refusal('captcha_required'))
      .mockRejectedValueOnce(refusal('daily_limit'));
    mount();
    await loaded();
    fireEvent.click(resendInList());
    await waitFor(() => expect(ts.widgets).toHaveLength(1));
    act(() => ts.widgets[0].options.callback('token-1'));
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(ts.live()).toHaveLength(0));
    expect(ts.widgets).toHaveLength(1);
    act(() => ts.widgets[0].options.callback('token-late'));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(api.resendInvitation).toHaveBeenCalledTimes(2);
  });

  const formField = (dialog: HTMLElement) =>
    within(dialog).getByRole('textbox', { name: i18n.t('spaces:invite.field') });

  async function pendingInForm() {
    api.createInvitation.mockResolvedValueOnce({
      outcome: 'already_pending',
      invitation: { id: 'inv-9', email: 'a@client.io', status: 'pending', invitedBy: 'anna', expiresAt: null, createdAt: '2026-10-11T00:00:00Z' },
    });
    mount();
    await loaded();
    fireEvent.click(button(i18n.t('spaces:settings.invite')));
    const dialog = await screen.findByRole('dialog', { name: i18n.t('spaces:invite.title', { space: 'Acme' }) });
    fireEvent.change(within(dialog).getByRole('textbox', { name: i18n.t('spaces:invite.field') }), {
      target: { value: 'a@client.io' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: i18n.t('spaces:invite.invite') }));
    await within(dialog).findByRole('button', { name: i18n.t('spaces:invite.resend') });
    return dialog;
  }

  test('the form: "Send again" → captcha_required → the widget; its token resends with the token', async () => {
    api.resendInvitation.mockRejectedValueOnce(refusal('captcha_required'));
    const dialog = await pendingInForm();
    fireEvent.click(within(dialog).getByRole('button', { name: i18n.t('spaces:invite.resend') }));
    await waitFor(() => expect(ts.widgets).toHaveLength(1));
    expect(api.resendInvitation.mock.calls[0]).toEqual([ACME, 'inv-9', undefined]);

    act(() => ts.widgets[0].options.callback('token-1'));
    // Resent: the pending invitation's "Send again" is done with, no refusal.
    await waitFor(() =>
      expect(within(dialog).queryByRole('button', { name: i18n.t('spaces:invite.resend') })).toBeNull(),
    );
    expect(formField(dialog).getAttribute('aria-invalid')).not.toBe('true');
    expect(api.resendInvitation).toHaveBeenCalledTimes(2);
    expect(api.resendInvitation.mock.calls[1]).toEqual([ACME, 'inv-9', 'token-1']);
    // No invitation was created on the way.
    expect(api.createInvitation).toHaveBeenCalledTimes(1);
    expect(ts.live()).toHaveLength(0);
  });

  test('the form: captcha_failed of the resend token — the refusal under the field and a fresh challenge', async () => {
    api.resendInvitation
      .mockRejectedValueOnce(refusal('captcha_required'))
      .mockRejectedValueOnce(refusal('captcha_failed'));
    const dialog = await pendingInForm();
    fireEvent.click(within(dialog).getByRole('button', { name: i18n.t('spaces:invite.resend') }));
    await waitFor(() => expect(ts.widgets).toHaveLength(1));
    act(() => ts.widgets[0].options.callback('token-1'));
    // The refusal is said under the field.
    await waitFor(() => expect(formField(dialog).getAttribute('aria-invalid')).toBe('true'));
    await waitFor(() => expect(ts.live()).toHaveLength(1));
    expect(ts.widgets).toHaveLength(2);

    act(() => ts.widgets[1].options.callback('token-2'));
    await waitFor(() => expect(api.resendInvitation).toHaveBeenCalledTimes(3));
    expect(api.resendInvitation.mock.calls[2]).toEqual([ACME, 'inv-9', 'token-2']);
  });
});

// ───────────────────────── captcha_required without a Turnstile key ─────────────────────────

describe('captcha_required on an instance without Turnstile: a refusal, no widget, no automatic resend', () => {
  let ts: ReturnType<typeof installTurnstile>;
  let toastError: MockInstance<typeof toaster.error>;
  beforeEach(() => {
    world.siteKey = null;
    ts = installTurnstile();
    toastError = vi.spyOn(toaster, 'error').mockImplementation(() => '');
  });
  afterEach(() => {
    delete (window as unknown as { turnstile?: unknown }).turnstile;
    toastError.mockRestore();
  });
  const settle = () =>
    act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

  test('the list: the refusal is said; no widget; the resend is not repeated', async () => {
    api.resendInvitation.mockRejectedValueOnce(new BusinessError(422, 'captcha_required', 'captcha_required'));
    mount();
    await loaded();
    fireEvent.click(button(i18n.t('spaces:settings.resendAria', { email: 'dev@client.io' })));
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    // Nothing failed to load — the refusal is not the load failure's.
    expect(toastError).not.toHaveBeenCalledWith(i18n.t('spaces:invite.captchaUnavailable'));
    await settle();
    expect(ts.fake.render).not.toHaveBeenCalled();
    expect(api.resendInvitation).toHaveBeenCalledTimes(1);
  });

  test('the form: the refusal is said under the field; no widget; the resend is not repeated', async () => {
    api.createInvitation.mockResolvedValueOnce({
      outcome: 'already_pending',
      invitation: { id: 'inv-9', email: 'a@client.io', status: 'pending', invitedBy: 'anna', expiresAt: null, createdAt: '2026-10-11T00:00:00Z' },
    });
    api.resendInvitation.mockRejectedValueOnce(new BusinessError(422, 'captcha_required', 'captcha_required'));
    mount();
    await loaded();
    fireEvent.click(button(i18n.t('spaces:settings.invite')));
    const dialog = await screen.findByRole('dialog', { name: i18n.t('spaces:invite.title', { space: 'Acme' }) });
    const field = within(dialog).getByRole('textbox', { name: i18n.t('spaces:invite.field') });
    fireEvent.change(field, { target: { value: 'a@client.io' } });
    fireEvent.click(within(dialog).getByRole('button', { name: i18n.t('spaces:invite.invite') }));
    fireEvent.click(await within(dialog).findByRole('button', { name: i18n.t('spaces:invite.resend') }));
    await waitFor(() => expect(field.getAttribute('aria-invalid')).toBe('true'));
    // Nothing failed to load — the refusal is not the load failure's.
    expect(within(dialog).queryByText(i18n.t('spaces:invite.captchaUnavailable'))).toBeNull();
    await settle();
    expect(ts.fake.render).not.toHaveBeenCalled();
    expect(api.resendInvitation).toHaveBeenCalledTimes(1);
  });
});

// ───────────────────────── a closed form or a left page sends nothing ─────────────────────────

describe('a check started and abandoned before its token sends nothing', () => {
  let ts: ReturnType<typeof installTurnstile>;
  beforeEach(() => {
    ts = installTurnstile();
  });
  afterEach(() => {
    delete (window as unknown as { turnstile?: unknown }).turnstile;
  });
  const refusal = (code: string) => new BusinessError(422, code, code);
  const settle = () =>
    act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

  test('the form: captcha_required → "Cancel" before the token → the held callback sends no request', async () => {
    api.createInvitation.mockRejectedValueOnce(refusal('captcha_required'));
    mount();
    await loaded();
    fireEvent.click(button(i18n.t('spaces:settings.invite')));
    const dialog = await screen.findByRole('dialog', { name: i18n.t('spaces:invite.title', { space: 'Acme' }) });
    fireEvent.change(within(dialog).getByRole('textbox', { name: i18n.t('spaces:invite.field') }), {
      target: { value: 'a@client.io' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: i18n.t('spaces:invite.invite') }));
    await waitFor(() => expect(ts.widgets).toHaveLength(1));

    fireEvent.click(within(dialog).getByRole('button', { name: i18n.t('spaces:invite.cancel') }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: i18n.t('spaces:invite.title', { space: 'Acme' }) })).toBeNull(),
    );
    act(() => ts.widgets[0].options.callback('token-after-close'));
    await settle();
    expect(api.createInvitation).toHaveBeenCalledTimes(1);
    expect(api.resendInvitation).not.toHaveBeenCalled();
  });

  test('the list: captcha_required → the page is left before the token → the held callback sends no request', async () => {
    api.resendInvitation.mockRejectedValueOnce(refusal('captcha_required'));
    const view = mount();
    await loaded();
    fireEvent.click(button(i18n.t('spaces:settings.resendAria', { email: 'dev@client.io' })));
    await waitFor(() => expect(ts.widgets).toHaveLength(1));

    view.unmount();
    act(() => ts.widgets[0].options.callback('token-after-leave'));
    await settle();
    expect(api.resendInvitation).toHaveBeenCalledTimes(1);
  });
});

// ───────────────────────── only the last action's answer counts ─────────────────────────

describe('an answer to an earlier resend changes nothing', () => {
  let ts: ReturnType<typeof installTurnstile>;
  let toastSuccess: MockInstance<typeof toaster.success>;
  let toastError: MockInstance<typeof toaster.error>;
  beforeEach(() => {
    ts = installTurnstile();
    toastSuccess = vi.spyOn(toaster, 'success').mockImplementation(() => '');
    toastError = vi.spyOn(toaster, 'error').mockImplementation(() => '');
    world.detail = detail({
      invitations: [
        { id: 'inv-1', email: 'dev@client.io', status: 'pending', invitedBy: 'anna', expiresAt: '2026-10-18T00:00:00Z', createdAt: '2026-10-11T00:00:00Z' },
        { id: 'inv-3', email: 'ops@client.io', status: 'pending', invitedBy: 'anna', expiresAt: '2026-10-18T00:00:00Z', createdAt: '2026-10-12T00:00:00Z' },
      ],
    });
  });
  afterEach(() => {
    delete (window as unknown as { turnstile?: unknown }).turnstile;
    toastSuccess.mockRestore();
    toastError.mockRestore();
  });
  const refusal = (code: string) => new BusinessError(422, code, code);
  /** A resend answer held until the test lets it go. */
  function held() {
    let release!: (outcome: { error?: unknown }) => void;
    const promise = new Promise<unknown>((resolve, reject) => {
      release = ({ error }) => (error === undefined ? resolve({}) : reject(error));
    });
    return { promise, release };
  }
  const resendOf = (email: string) => button(i18n.t('spaces:settings.resendAria', { email }));

  test('the list: A and B overlap — A’s late captcha_required does not take B’s check; the token resends B', async () => {
    const a = held();
    const b = held();
    api.resendInvitation.mockImplementationOnce(() => a.promise).mockImplementationOnce(() => b.promise);
    mount();
    await loaded();
    fireEvent.click(resendOf('dev@client.io'));
    fireEvent.click(resendOf('ops@client.io'));
    await waitFor(() => expect(api.resendInvitation).toHaveBeenCalledTimes(2));

    await act(async () => b.release({ error: refusal('captcha_required') }));
    await waitFor(() => expect(ts.live()).toHaveLength(1));
    await act(async () => a.release({ error: refusal('captcha_required') }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    // B's check stands, untouched.
    expect(ts.widgets).toHaveLength(1);
    expect(ts.live()).toHaveLength(1);

    act(() => ts.live()[0].options.callback('token-b'));
    await waitFor(() => expect(api.resendInvitation).toHaveBeenCalledTimes(3));
    expect(api.resendInvitation.mock.calls[2]).toEqual([ACME, 'inv-3', 'token-b']);
  });

  test('the list: A’s late success neither takes B’s check down nor reports a resend', async () => {
    const a = held();
    const b = held();
    api.resendInvitation.mockImplementationOnce(() => a.promise).mockImplementationOnce(() => b.promise);
    mount();
    await loaded();
    fireEvent.click(resendOf('dev@client.io'));
    fireEvent.click(resendOf('ops@client.io'));
    await waitFor(() => expect(api.resendInvitation).toHaveBeenCalledTimes(2));

    await act(async () => b.release({ error: refusal('captcha_required') }));
    await waitFor(() => expect(ts.live()).toHaveLength(1));
    await act(async () => a.release({}));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(ts.live()).toHaveLength(1);
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  test('the form: the addressee edited while A’s invitation is on its way — A’s late «sent» leaves B in the field', async () => {
    let answerSent!: () => void;
    api.createInvitation.mockImplementationOnce(
      () => new Promise((resolve) => (answerSent = () => resolve({ outcome: 'sent', invitation: null }))),
    );
    mount();
    await loaded();
    fireEvent.click(button(i18n.t('spaces:settings.invite')));
    const dialog = await screen.findByRole('dialog', { name: i18n.t('spaces:invite.title', { space: 'Acme' }) });
    const field = within(dialog).getByRole('textbox', { name: i18n.t('spaces:invite.field') }) as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'a@client.io' } });
    fireEvent.click(within(dialog).getByRole('button', { name: i18n.t('spaces:invite.invite') }));
    await waitFor(() => expect(api.createInvitation).toHaveBeenCalledTimes(1));

    fireEvent.change(field, { target: { value: 'b@client.io' } });
    await act(async () => answerSent());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    // The answer was for A: the field the person is filling in is untouched, no outcome is announced.
    expect(field.value).toBe('b@client.io');
    expect(within(dialog).queryByRole('status')).toBeNull();
  });

  test('the form: "Invite" while the resend check is up — that check’s token resends nothing', async () => {
    api.createInvitation.mockResolvedValueOnce({
      outcome: 'already_pending',
      invitation: { id: 'inv-9', email: 'a@client.io', status: 'pending', invitedBy: 'anna', expiresAt: null, createdAt: '2026-10-11T00:00:00Z' },
    });
    // The new invitation's answer is still on its way when the token comes.
    const creation = held();
    api.createInvitation.mockImplementationOnce(() => creation.promise);
    api.resendInvitation.mockRejectedValueOnce(refusal('captcha_required'));
    mount();
    await loaded();
    fireEvent.click(button(i18n.t('spaces:settings.invite')));
    const dialog = await screen.findByRole('dialog', { name: i18n.t('spaces:invite.title', { space: 'Acme' }) });
    fireEvent.change(within(dialog).getByRole('textbox', { name: i18n.t('spaces:invite.field') }), {
      target: { value: 'a@client.io' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: i18n.t('spaces:invite.invite') }));
    fireEvent.click(await within(dialog).findByRole('button', { name: i18n.t('spaces:invite.resend') }));
    await waitFor(() => expect(ts.widgets).toHaveLength(1));

    fireEvent.click(within(dialog).getByRole('button', { name: i18n.t('spaces:invite.invite') }));
    await waitFor(() => expect(api.createInvitation).toHaveBeenCalledTimes(2));
    act(() => ts.widgets[0].options.callback('token-of-the-resend-check'));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(api.resendInvitation).toHaveBeenCalledTimes(1);
  });
});

// ───────────────────────── a resend check belongs to its space ─────────────────────────

describe('the check of a resend in A never resends in B', () => {
  let ts: ReturnType<typeof installTurnstile>;
  beforeEach(() => {
    ts = installTurnstile();
  });
  afterEach(() => {
    delete (window as unknown as { turnstile?: unknown }).turnstile;
  });

  const BETA = 'm7v4t1rb';
  let go: (to: string) => void = () => undefined;
  function Navigator() {
    go = useNavigate();
    return null;
  }

  test('A: captcha_required → B (already loaded once) before the token → the late token of A sends no request', async () => {
    world.details[BETA] = detail({
      id: BETA,
      slug: 'beta',
      name: 'Beta',
      invitations: [
        { id: 'inv-b', email: 'qa@beta.io', status: 'pending', invitedBy: 'anna', expiresAt: '2026-10-18T00:00:00Z', createdAt: '2026-10-11T00:00:00Z' },
      ],
    });
    api.resendInvitation.mockRejectedValueOnce(new BusinessError(422, 'captcha_required', 'captcha_required'));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <MantineProvider>
        <QueryClientProvider client={qc}>
          <MemoryRouter initialEntries={[`/settings/spaces/${BETA}-beta`]}>
            <Navigator />
            <Routes>
              <Route path="/settings/spaces/:space" element={<SpaceSettingsPage />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </MantineProvider>,
    );
    // B is visited first, so coming back to it shows it at once from the cache.
    await screen.findByRole('button', { name: i18n.t('spaces:settings.resendAria', { email: 'qa@beta.io' }) });
    act(() => go(`/settings/spaces/${ACME}-acme`));
    fireEvent.click(await screen.findByRole('button', { name: i18n.t('spaces:settings.resendAria', { email: 'dev@client.io' }) }));
    await waitFor(() => expect(ts.widgets).toHaveLength(1));

    act(() => go(`/settings/spaces/${BETA}-beta`));
    await screen.findByRole('button', { name: i18n.t('spaces:settings.resendAria', { email: 'qa@beta.io' }) });
    for (const w of ts.widgets) act(() => w.options.callback('token-of-a'));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(api.resendInvitation).toHaveBeenCalledTimes(1);
    expect(api.resendInvitation.mock.calls.some(([space]) => space === BETA)).toBe(false);
  });
});

// ───────────────────────── the list's check is where the person clicked ─────────────────────────

describe('the check of a resend in the list comes right under its invitation, announced', () => {
  beforeEach(() => {
    installTurnstile();
    world.detail = detail({
      invitations: [
        { id: 'inv-1', email: 'dev@client.io', status: 'pending', invitedBy: 'anna', expiresAt: '2026-10-18T00:00:00Z', createdAt: '2026-10-11T00:00:00Z' },
        { id: 'inv-3', email: 'ops@client.io', status: 'pending', invitedBy: 'anna', expiresAt: '2026-10-18T00:00:00Z', createdAt: '2026-10-12T00:00:00Z' },
      ],
    });
  });
  afterEach(() => {
    delete (window as unknown as { turnstile?: unknown }).turnstile;
  });

  test('captcha_required on the first row: a status line in the row right after it, not after the whole list', async () => {
    api.resendInvitation.mockRejectedValueOnce(new BusinessError(422, 'captcha_required', 'captcha_required'));
    mount();
    await loaded();
    const resendFirst = button(i18n.t('spaces:settings.resendAria', { email: 'dev@client.io' }));
    fireEvent.click(resendFirst);

    const table = screen.getByRole('table', { name: i18n.t('spaces:settings.invitationsCaption') });
    const status = await within(table).findByRole('status');
    const rows = within(table).getAllByRole('row');
    const clicked = rows.findIndex((row) => row.contains(resendFirst));
    expect(clicked).toBeGreaterThan(-1);
    expect(rows[clicked + 1].contains(status)).toBe(true);
  });
});

// ───────────────────────── the widget's container is named by its caption ─────────────────────────

describe('the check is a group named by its caption', () => {
  beforeEach(() => {
    installTurnstile();
  });
  afterEach(() => {
    delete (window as unknown as { turnstile?: unknown }).turnstile;
  });
  const captchaRequired = () => new BusinessError(422, 'captcha_required', 'captcha_required');

  test('the list: the check of the resend of dev@client.io is a group with the caption as its name', async () => {
    api.resendInvitation.mockRejectedValueOnce(captchaRequired());
    mount();
    await loaded();
    fireEvent.click(button(i18n.t('spaces:settings.resendAria', { email: 'dev@client.io' })));
    await screen.findByRole('group', { name: i18n.t('spaces:settings.resendCaptcha', { email: 'dev@client.io' }) });
  });

  test('the form: the check of the invitation is a group with the caption as its name', async () => {
    api.createInvitation.mockRejectedValueOnce(captchaRequired());
    mount();
    await loaded();
    fireEvent.click(button(i18n.t('spaces:settings.invite')));
    const dialog = await screen.findByRole('dialog', { name: i18n.t('spaces:invite.title', { space: 'Acme' }) });
    fireEvent.change(within(dialog).getByRole('textbox', { name: i18n.t('spaces:invite.field') }), {
      target: { value: 'a@client.io' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: i18n.t('spaces:invite.invite') }));
    await within(dialog).findByRole('group', { name: i18n.t('spaces:invite.captcha') });
  });
});

// ───────────────────────── a new attempt tries the widget again ─────────────────────────

describe('after the script failed to load, the next check mounts the widget again', () => {
  afterEach(() => {
    delete (window as unknown as { turnstile?: unknown }).turnstile;
  });

  test('the list: load failure → "Again" again → captcha_required → the widget is rendered', async () => {
    delete (window as unknown as { turnstile?: unknown }).turnstile;
    const captchaRequired = () => new BusinessError(422, 'captcha_required', 'captcha_required');
    api.resendInvitation.mockRejectedValueOnce(captchaRequired()).mockRejectedValueOnce(captchaRequired());
    mount();
    await loaded();
    const resendIt = () => fireEvent.click(button(i18n.t('spaces:settings.resendAria', { email: 'dev@client.io' })));
    resendIt();

    // The first check: the script is requested and fails.
    let script: HTMLScriptElement | null = null;
    await waitFor(() => {
      script = document.head.querySelector<HTMLScriptElement>('script[src*="challenges.cloudflare.com"]');
      expect(script).not.toBeNull();
    });
    act(() => {
      script!.dispatchEvent(new Event('error'));
    });
    await screen.findByRole('alert');

    // The network is back; the person asks again.
    const ts = installTurnstile();
    resendIt();
    await waitFor(() => expect(api.resendInvitation).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(ts.fake.render).toHaveBeenCalledTimes(1));
  });
});

describe('sk-733.1 — the way back to «My spaces»', () => {
  test('a space’s settings lead back to the list of spaces', async () => {
    mount();
    await loaded();
    fireEvent.click(screen.getByRole('link', { name: i18n.t('spaces:settings.backToList') }));
    expect(location).toBe('/settings/spaces');
  });
});
