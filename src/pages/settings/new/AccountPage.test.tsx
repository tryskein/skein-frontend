/**
 * sk-674.18 T058 — "Account", "API keys" and "Users" (US-20, US-10, E-26; screens 2.9, 2.13, 1.14).
 *
 * Row 251 — every display condition, met and not met:
 *   • "Account": the email confirmation status only with mail on and not
 *     for SSO — "✓ confirmed" or "⚠ not confirmed" with the send
 *     button; the username is read-only; account deletion only with
 *     registration open — blocked by owned spaces with people (named, with
 *     links), otherwise confirmed by the password;
 *   • "API keys": "The key sees all your spaces" with two spaces or
 *     more only; the "Connection" block;
 *   • "Users": space checkboxes (the common space checked at
 *     creation and sent; an owned space locked), unchecked spaces in ONE
 *     dialog of consequences before the save, "Owns: …" on deactivation.
 * Row 251a — "Send email" is off for a minute after a send, on
 * again after it, and a second send is a second request (fake timers).
 *
 * The real pages and dialogs; stubbed are the network (account, auth
 * config, spaces, users, API keys), the signed-in person and the header.
 */
import { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18n from '../../../i18n/config';
import type { MySpace } from '../../../api/spaces';
import type { User } from '../../../api/users';

const world = vi.hoisted(() => ({
  user: { id: 'u-dev', username: 'dev', role: 'user', isExternal: false } as {
    id: string;
    username: string;
    role: string;
    isExternal: boolean;
  },
  config: {} as Record<string, unknown>,
  account: {} as Record<string, unknown>,
  spaces: [] as unknown[],
  /** GET /me/spaces: 'ok' answers `spaces`, 'pending' never answers, 'error' refuses. */
  spacesState: 'ok' as 'ok' | 'pending' | 'error',
  deletionPreview: {} as unknown,
  users: [] as unknown[],
  userSpaces: {} as Record<string, unknown[]>,
}));
const api = vi.hoisted(() => ({
  requestEmailConfirmation: vi.fn(async (_l: string) => undefined),
  deleteMyAccount: vi.fn(async (_p: string) => undefined),
  createUser: vi.fn(async (_p: unknown) => ({})),
  previewUserSpaces: vi.fn(async (_id: string, _ids: string[]) => ({
    removed: [
      {
        id: 'k3x9p2qa', slug: 'acme', name: 'Acme',
        openAssignedIssues: 3, claimedIssues: 0, ownedProjects: [],
      },
      {
        id: 'b1b1b1b1', slug: 'beta', name: 'Beta',
        openAssignedIssues: 1, claimedIssues: 0, ownedProjects: [],
      },
    ],
  })),
  putUserSpaces: vi.fn(async (_id: string, _ids: string[]) => ({ items: [] })),
  logout: vi.fn(async () => undefined),
}));

vi.mock('../../../auth/AuthContext', () => ({
  useAuthOptional: () => ({ user: world.user }),
  useAuth: () => ({ user: world.user, isLoading: false, logout: api.logout }),
}));
vi.mock('../../shell/HeaderBar', () => ({
  HeaderBar: () => <div data-testid="header" />,
}));
vi.mock('../../../api/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/auth')>();
  return { ...actual, getAuthConfig: async () => world.config };
});
vi.mock('../../../api/account', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/account')>();
  return {
    ...actual,
    getMyAccount: async () => world.account,
    requestEmailConfirmation: api.requestEmailConfirmation,
    getAccountDeletionPreview: async () => world.deletionPreview,
    deleteMyAccount: api.deleteMyAccount,
  };
});
vi.mock('../../../api/spaces', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/spaces')>();
  return {
    ...actual,
    getMySpaces: () =>
      world.spacesState === 'pending'
        ? new Promise(() => undefined)
        : world.spacesState === 'error'
          ? Promise.reject(new Error('boom'))
          : Promise.resolve({
              items: world.spaces,
              ownedCount: 0,
              ownedLimit: null,
              canCreate: true,
              cannotCreateReason: null,
            }),
  };
});
vi.mock('../../../api/users', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/users')>();
  return {
    ...actual,
    listUsers: async () => ({ items: world.users, nextCursor: null, hasMore: false }),
    createUser: api.createUser,
    getUserSpaces: async (id: string) => ({ items: world.userSpaces[id] ?? [] }),
    previewUserSpaces: api.previewUserSpaces,
    putUserSpaces: api.putUserSpaces,
  };
});
vi.mock('../../../api/api-keys', () => ({
  listApiKeys: async () => [],
  createApiKey: vi.fn(),
  revokeApiKey: vi.fn(),
}));

import { AccountPage } from './AccountPage';
import { NewApiKeysPage } from './ApiKeysPage';
import { NewUsersPage } from './UsersPage';

function space(id: string, name: string, kind: MySpace['kind'], over: Partial<MySpace> = {}): MySpace {
  return {
    id, slug: kind === 'personal' ? '' : name.toLowerCase(), name, kind, myRole: 'member', adminAccess: false,
    canCreateProject: true, memberCount: 2, memberLimit: null, pendingInvitations: 0,
    projectCount: 0, projectQuota: null, storageUsedBytes: 0, storageQuotaBytes: null, ...over,
  };
}

function config(over: Record<string, unknown> = {}) {
  return {
    authMode: 'local', logoutRedirectUrl: null, mcpUrl: null, signupEnabled: true, emailEnabled: true,
    turnstileSiteKey: null, projectPrefixMinLength: null, termsUrl: null, privacyUrl: null, ...over,
  };
}

function Wrap({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return (
    <MantineProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/settings/account']}>{children}</MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>
  );
}

beforeEach(async () => {
  await i18n.changeLanguage('ru');
  world.user = { id: 'u-dev', username: 'dev', role: 'user', isExternal: false };
  world.config = config();
  world.account = {
    id: 'u-dev', email: 'dev@client.io', username: 'dev', name: 'Dev', role: 'user',
    isExternal: false, createdAt: '2026-10-01T00:00:00Z', lastLoginAt: null,
    emailConfirmed: false, hasApiKeys: false,
  };
  world.spaces = [space('p0aa11bb', 'Личное', 'personal', { myRole: 'owner' })];
  world.spacesState = 'ok';
  world.deletionPreview = { blocking: [], deleted: [{ id: 'p0aa11bb', slug: '', name: 'Личное', kind: 'personal', projectCount: 2 }], openAssignedIssues: 7 };
  world.users = [];
  world.userSpaces = {};
  for (const fn of Object.values(api)) fn.mockClear();
});

afterEach(() => cleanup());

// ─────────────────────────── "Account" ───────────────────────────

describe('row 251 — "Account": email and its confirmation', () => {
  const emailShown = () => screen.findByText('dev@client.io');
  const sendButton = () => screen.queryByRole('button', { name: i18n.t('account:sendConfirmation') });

  test('mail on, not confirmed: "⚠ not confirmed", the send button and why it matters', async () => {
    render(<Wrap><AccountPage /></Wrap>);
    await emailShown();
    expect(screen.getByText(i18n.t('account:unconfirmed'))).toBeTruthy();
    expect(sendButton()).not.toBeNull();
    expect(screen.getByText(i18n.t('account:confirmationHint'))).toBeTruthy();
  });

  test('confirmed: "✓ confirmed", no button', async () => {
    world.account = { ...world.account, emailConfirmed: true };
    render(<Wrap><AccountPage /></Wrap>);
    await emailShown();
    expect(screen.getByText(i18n.t('account:confirmed'))).toBeTruthy();
    expect(sendButton()).toBeNull();
  });

  test.each([
    ['mail off', { emailEnabled: false }],
    ['SSO (keycloak)', { authMode: 'keycloak' }],
  ])('%s: no status and no button', async (_name, over) => {
    world.config = config(over);
    render(<Wrap><AccountPage /></Wrap>);
    await emailShown();
    expect(screen.queryByText(i18n.t('account:unconfirmed'))).toBeNull();
    expect(screen.queryByText(i18n.t('account:confirmed'))).toBeNull();
    expect(sendButton()).toBeNull();
  });

  test('the username is read-only: shown, marked, and no field to edit it', async () => {
    render(<Wrap><AccountPage /></Wrap>);
    await emailShown();
    expect(screen.getByText('dev')).toBeTruthy();
    expect(screen.getByText(`(${i18n.t('account:readOnly')})`)).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});

describe('row 251 — "Account": deletion only with registration open', () => {
  const deleteButton = () => screen.queryByRole('button', { name: i18n.t('account:deleteAccount') });

  test('registration closed — no danger zone', async () => {
    world.config = config({ signupEnabled: false });
    render(<Wrap><AccountPage /></Wrap>);
    await screen.findByText('dev@client.io');
    // The config has answered: the email status depends on it and is shown.
    await screen.findByText(i18n.t('account:unconfirmed'));
    expect(deleteButton()).toBeNull();
  });

  test('blocked by owned spaces with people: named, each with a link to its settings, no password', async () => {
    world.deletionPreview = {
      blocking: [{ id: 'k3x9p2qa', slug: 'acme', name: 'Acme', kind: 'regular', memberCount: 6 }],
      deleted: [],
      openAssignedIssues: 0,
    };
    render(<Wrap><AccountPage /></Wrap>);
    fireEvent.click(await screen.findByRole('button', { name: i18n.t('account:deleteAccount') }));
    const dialog = await screen.findByRole('dialog', { name: i18n.t('account:deletion.blockedTitle') });
    expect(within(dialog).getByText(i18n.t('account:deletion.blockedMembers', { name: 'Acme', count: 6 }), { exact: false })).toBeTruthy();
    expect(
      within(dialog).getByRole('link', { name: i18n.t('account:deletion.openSettings') }).getAttribute('href'),
    ).toBe('/settings/spaces/k3x9p2qa-acme');
    expect(within(dialog).queryByLabelText(i18n.t('account:deletion.password'))).toBeNull();
  });

  test('the owner of the common space is told to ask the administrator', async () => {
    world.deletionPreview = {
      blocking: [{ id: 'c0mm0n00', slug: 'common', name: 'Общее', kind: 'common', memberCount: 120 }],
      deleted: [],
      openAssignedIssues: 0,
    };
    render(<Wrap><AccountPage /></Wrap>);
    fireEvent.click(await screen.findByRole('button', { name: i18n.t('account:deleteAccount') }));
    const dialog = await screen.findByRole('dialog', { name: i18n.t('account:deletion.blockedTitle') });
    expect(within(dialog).getByText(i18n.t('account:deletion.ownsCommon'))).toBeTruthy();
  });

  test('#6 — deleted: the session is ended and the public "Account deleted" page is shown, with a way to sign in', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const { AccountDeletedPage } = await import('../../AccountDeletedPage');
    render(
      <MantineProvider>
        <QueryClientProvider client={qc}>
          <MemoryRouter initialEntries={['/settings/account']}>
            <Routes>
              <Route path="/settings/account" element={<AccountPage />} />
              <Route path="/account-deleted" element={<AccountDeletedPage />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </MantineProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: i18n.t('account:deleteAccount') }));
    const dialog = await screen.findByRole('dialog', { name: i18n.t('account:deletion.title') });
    fireEvent.change(await within(dialog).findByLabelText(i18n.t('account:deletion.password')), {
      target: { value: 's3cret!' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: i18n.t('account:deletion.confirm') }));
    await waitFor(() => expect(api.deleteMyAccount).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(api.logout).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('heading', { name: i18n.t('account:deletedPage.title') })).toBeTruthy();
    expect(screen.getByRole('link', { name: i18n.t('account:deletedPage.signIn') }).getAttribute('href')).toBe('/login');
  });

  test('not blocked: the consequences, then the password goes to the server', async () => {
    render(<Wrap><AccountPage /></Wrap>);
    fireEvent.click(await screen.findByRole('button', { name: i18n.t('account:deleteAccount') }));
    const dialog = await screen.findByRole('dialog', { name: i18n.t('account:deletion.title') });
    expect(await within(dialog).findByText(i18n.t('account:deletion.assigned', { count: 7 }))).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(i18n.t('account:deletion.password')), {
      target: { value: 's3cret!' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: i18n.t('account:deletion.confirm') }));
    await waitFor(() => expect(api.deleteMyAccount).toHaveBeenCalledWith('s3cret!'));
  });
});

describe('row 251a — "Send email" pauses a minute (E-26)', () => {
  test('off right after a send and at 59 s, on at 60 s; a second send is a second request', async () => {
    // Only what the pause runs on: the timer and the clock. Faking the
    // animation frame too would leave the dialogs of later tests on it.
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      render(<Wrap><AccountPage /></Wrap>);
      const send = await screen.findByRole('button', { name: i18n.t('account:sendConfirmation') });
      fireEvent.click(send);
      await waitFor(() => expect(api.requestEmailConfirmation).toHaveBeenCalledTimes(1));
      await screen.findByText(i18n.t('account:confirmationSent', { email: 'dev@client.io' }));
      const button = () => screen.getByRole('button', { name: i18n.t('account:sendConfirmation') }) as HTMLButtonElement;
      expect(button().disabled).toBe(true);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(59_000);
      });
      expect(button().disabled).toBe(true);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_500);
      });
      await waitFor(() => expect(button().disabled).toBe(false));

      fireEvent.click(button());
      await waitFor(() => expect(api.requestEmailConfirmation).toHaveBeenCalledTimes(2));
    } finally {
      vi.useRealTimers();
    }
  });
});

// ─────────────────────────── "API keys" ───────────────────────────

describe('row 251 — "API keys": the spaces line and "Connection"', () => {
  test('two spaces: "The key sees all your spaces"', async () => {
    world.spaces = [space('p0aa11bb', 'Личное', 'personal'), space('k3x9p2qa', 'Acme', 'regular')];
    render(<Wrap><NewApiKeysPage /></Wrap>);
    expect(await screen.findByText(i18n.t('settings:keys.allSpaces'))).toBeTruthy();
  });

  test('one space: no such line', async () => {
    render(<Wrap><NewApiKeysPage /></Wrap>);
    await screen.findByRole('heading', { name: i18n.t('settings:keys.connectTitle') });
    // «My spaces» answered with one; give the render a tick.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.queryByText(i18n.t('settings:keys.allSpaces'))).toBeNull();
  });

  test('"Connection": where the file goes, which key, how to check', async () => {
    render(<Wrap><NewApiKeysPage /></Wrap>);
    const heading = await screen.findByRole('heading', { name: i18n.t('settings:keys.connectTitle') });
    const block = heading.closest('section')!;
    for (const key of ['connectWhere', 'connectKey', 'connectCheck']) {
      expect(within(block).getByText(i18n.t(`settings:keys.${key}`))).toBeTruthy();
    }
  });
});

// ─────────────────────────── "Users" ───────────────────────────

describe('row 251 — "Users": the spaces of an account', () => {
  const ADMIN = { id: 'u-root', username: 'root', role: 'admin', isExternal: false };
  const oleg: User = {
    id: 'u-oleg', email: 'oleg@acme.io', username: 'oleg', name: 'Oleg', role: 'user',
    createdAt: '2026-10-01T00:00:00Z', lastLoginAt: null, deactivatedAt: null,
    authMethod: 'password', isExternal: false,
  };

  beforeEach(() => {
    world.user = ADMIN;
    world.spaces = [
      space('r00tp3rs', 'Личное', 'personal', { myRole: 'owner' }),
      space('c0mm0n00', 'Общее', 'common'),
      space('k3x9p2qa', 'Acme', 'regular'),
      space('b1b1b1b1', 'Beta', 'regular'),
      space('g4mm4000', 'Gamma', 'regular'),
    ];
    world.users = [oleg];
    world.userSpaces = {
      'u-oleg': [
        { id: 'k3x9p2qa', slug: 'acme', name: 'Acme', kind: 'regular', role: 'member' },
        { id: 'b1b1b1b1', slug: 'beta', name: 'Beta', kind: 'regular', role: 'member' },
        { id: 'g4mm4000', slug: 'gamma', name: 'Gamma', kind: 'regular', role: 'owner' },
      ],
    };
  });

  const box = (scope: HTMLElement, name: string) => within(scope).getByRole('checkbox', { name }) as HTMLInputElement;

  test('creating: every space but personal ones, the common one checked and sent', async () => {
    render(<Wrap><NewUsersPage /></Wrap>);
    fireEvent.click(await screen.findByRole('button', { name: /New user/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Create user' });
    await within(dialog).findByRole('group', { name: i18n.t('settings:users.spacesLabel') });
    expect(within(dialog).queryByRole('checkbox', { name: 'Личное' })).toBeNull();
    expect(box(dialog, 'Общее').checked).toBe(true);
    expect(box(dialog, 'Acme').checked).toBe(false);

    fireEvent.click(box(dialog, 'Acme'));
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Email/ }), { target: { value: 'new@acme.io' } });
    fireEvent.change(within(dialog).getByRole('textbox', { name: /^Name/ }), { target: { value: 'New' } });
    fireEvent.change(within(dialog).getByLabelText(/^Password/), { target: { value: 'longenough' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(api.createUser).toHaveBeenCalled());
    const sent = api.createUser.mock.calls[0][0] as { spaceIds: string[] };
    expect([...sent.spaceIds].sort()).toEqual(['c0mm0n00', 'k3x9p2qa']);
  });

  // the contract: `spaceIds` omitted = the common space.
  // Without an answer of «my spaces» there is nothing to decide from, so
  // the field is not sent at all; an explicit [] only from the person.
  async function createWithForm() {
    fireEvent.click(await screen.findByRole('button', { name: /New user/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Create user' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Email/ }), { target: { value: 'new@acme.io' } });
    fireEvent.change(within(dialog).getByRole('textbox', { name: /^Name/ }), { target: { value: 'New' } });
    fireEvent.change(within(dialog).getByLabelText(/^Password/), { target: { value: 'longenough' } });
    return dialog;
  }

  test.each(['pending', 'error'] as const)(
    '#5 — «my spaces» %s: the account is created without `spaceIds` (the server’s default applies)',
    async (state) => {
      world.spacesState = state;
      render(<Wrap><NewUsersPage /></Wrap>);
      const dialog = await createWithForm();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
      await waitFor(() => expect(api.createUser).toHaveBeenCalledTimes(1));
      expect(api.createUser.mock.calls[0][0]).not.toHaveProperty('spaceIds');
    },
  );

  test('#5 — every box unchecked by the person: an explicit empty set is sent', async () => {
    render(<Wrap><NewUsersPage /></Wrap>);
    const dialog = await createWithForm();
    await within(dialog).findByRole('group', { name: i18n.t('settings:users.spacesLabel') });
    fireEvent.click(box(dialog, 'Общее'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(api.createUser).toHaveBeenCalledTimes(1));
    expect((api.createUser.mock.calls[0][0] as { spaceIds?: string[] }).spaceIds).toEqual([]);
  });

  test('editing: an owned space is checked and locked, with a link to its settings', async () => {
    render(<Wrap><NewUsersPage /></Wrap>);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit oleg' });
    await within(dialog).findByRole('group', { name: i18n.t('settings:users.spacesLabel') });
    const gamma = box(dialog, 'Gamma');
    expect(gamma.checked).toBe(true);
    expect(gamma.disabled).toBe(true);
    expect(
      within(dialog)
        .getByRole('link', { name: i18n.t('settings:users.changeOwnerLink', { name: 'Gamma' }) })
        .getAttribute('href'),
    ).toBe('/settings/spaces/g4mm4000-gamma');
  });

  test('unchecking two spaces: ONE dialog with both, nothing saved before "Save"', async () => {
    render(<Wrap><NewUsersPage /></Wrap>);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit oleg' });
    await within(dialog).findByRole('group', { name: i18n.t('settings:users.spacesLabel') });
    fireEvent.click(box(dialog, 'Acme'));
    fireEvent.click(box(dialog, 'Beta'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    const removal = await screen.findByRole('dialog', { name: i18n.t('settings:users.removalTitle', { name: 'oleg' }) });
    await waitFor(() => expect(api.previewUserSpaces).toHaveBeenCalledWith('u-oleg', ['g4mm4000']));
    expect(within(removal).getByText('Acme')).toBeTruthy();
    expect(within(removal).getByText('Beta')).toBeTruthy();
    expect(within(removal).getByText(i18n.t('spaces:removal.openAssigned', { count: 3 }))).toBeTruthy();
    expect(api.putUserSpaces).not.toHaveBeenCalled();

    fireEvent.click(within(removal).getByRole('button', { name: i18n.t('settings:users.removalConfirm') }));
    await waitFor(() => expect(api.putUserSpaces).toHaveBeenCalledWith('u-oleg', ['g4mm4000']));
    // One preview and one save for the whole change.
    expect(api.previewUserSpaces).toHaveBeenCalledTimes(1);
    expect(api.putUserSpaces).toHaveBeenCalledTimes(1);
    expect(screen.queryAllByRole('dialog', { name: i18n.t('settings:users.removalTitle', { name: 'oleg' }) })).toHaveLength(0);
  });

  test('deactivating: memberships are kept, and what the person owns is named with links', async () => {
    render(<Wrap><NewUsersPage /></Wrap>);
    fireEvent.click(await screen.findByRole('button', { name: 'Deactivate' }));
    const dialog = await screen.findByRole('dialog', { name: 'Deactivate user' });
    expect(within(dialog).getByText(i18n.t('settings:users.deactivateKeeps'), { exact: false })).toBeTruthy();
    const link = await within(dialog).findByRole('link', { name: 'Gamma' });
    expect(link.getAttribute('href')).toBe('/settings/spaces/g4mm4000-gamma');
    expect(within(dialog).getByText(i18n.t('settings:users.ownsLead'), { exact: false })).toBeTruthy();
    // A space only joined is not «owned».
    expect(within(dialog).queryByRole('link', { name: 'Acme' })).toBeNull();
  });

  test('an external account has no space checkboxes', async () => {
    world.users = [{ ...oleg, isExternal: true }];
    render(<Wrap><NewUsersPage /></Wrap>);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit oleg' });
    // Positive control: the card itself is there.
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeTruthy();
    expect(within(dialog).queryByRole('group', { name: i18n.t('settings:users.spacesLabel') })).toBeNull();
  });
});
