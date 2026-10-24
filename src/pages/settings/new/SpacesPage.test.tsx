/**
 * sk-674.18 T057 — the "Spaces" tab (US-4, INV-14;
 * screens 2.1, 2.2, 1.14).
 *
 *   • "New space" answers as the server would: its state and its
 *     reason come from `canCreate` + `cannotCreateReason` of GET /me/spaces
 *     — for every reason code — not from the page's own arithmetic on the
 *     numbers;
 *   • a refusal of POST /spaces at the moment of creation (the limit was
 *     reached in between) is said under the field;
 *   • an external user has no «Spaces» tab.
 *
 * The real `SpacesPage` and `SettingsLayout`; stubbed are the network
 * (`getMySpaces`, `listMyInvitations`, `createSpace`), the signed-in person
 * and the header (badge counts, irrelevant to the tab row).
 */
import { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import i18n from '../../../i18n/config';
import type { CannotCreateSpaceReason, MySpace, MySpacesResponse } from '../../../api/spaces';
import { BusinessError } from '../../../api/client';

const world = vi.hoisted(() => ({
  user: { id: 'u-1', username: 'anna', role: 'user', isExternal: false } as {
    id: string;
    username: string;
    role: string;
    isExternal: boolean;
  },
  spaces: null as unknown,
  createSpace: (() => Promise.resolve({ id: 'n3w5pace', slug: 'x' })) as (input: unknown) => Promise<unknown>,
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
    getMySpaces: async () => world.spaces as MySpacesResponse,
    createSpace: (input: unknown) => world.createSpace(input),
  };
});
vi.mock('../../../api/invitations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/invitations')>();
  return { ...actual, listMyInvitations: async () => ({ items: [] }) };
});

import { SpacesPage } from './SpacesPage';
import { SettingsLayout } from './SettingsLayout';

function space(id: string, name: string, kind: MySpace['kind'], over: Partial<MySpace> = {}): MySpace {
  return {
    id, slug: kind === 'personal' ? '' : name.toLowerCase(), name, kind, myRole: 'owner', adminAccess: false,
    canCreateProject: true, memberCount: 1, memberLimit: null, pendingInvitations: 0,
    projectCount: 0, projectQuota: null, storageUsedBytes: 0, storageQuotaBytes: null, ...over,
  };
}

function answer(over: Partial<MySpacesResponse>): MySpacesResponse {
  return {
    items: [space('p0aa11bb', 'Личное', 'personal'), space('k3x9p2qa', 'Acme', 'regular')],
    ownedCount: 1,
    ownedLimit: 3,
    canCreate: true,
    cannotCreateReason: null,
    ...over,
  };
}

function Wrap({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return (
    <MantineProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/settings/spaces']}>{children}</MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>
  );
}

const newSpace = () => screen.queryByRole('button', { name: i18n.t('spaces:list.newSpace') });
/** The table is there — «my spaces» answered. */
const answered = () => screen.findByRole('table', { name: i18n.t('spaces:list.caption') });

beforeEach(async () => {
  await i18n.changeLanguage('ru');
  world.user = { id: 'u-1', username: 'anna', role: 'user', isExternal: false };
  world.spaces = answer({});
  world.createSpace = () => Promise.resolve({ id: 'n3w5pace', slug: 'x' });
});

afterEach(() => cleanup());

describe('row 249 — "New space" follows the server’s answer', () => {
  test('canCreate — the button is on, no reason beside it', async () => {
    render(<Wrap><SpacesPage /></Wrap>);
    await answered();
    const button = newSpace()!;
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(button.getAttribute('aria-describedby')).toBeNull();
  });

  test.each<[CannotCreateSpaceReason, () => string]>([
    ['owned_limit', () => i18n.t('spaces:quota.owned', { owned: 3, limit: 3 })],
    ['admin_only', () => i18n.t('spaces:list.adminOnly')],
  ])('%s — the button is off, the reason is said beside it', async (reason, text) => {
    world.spaces = answer({ ownedCount: 3, ownedLimit: 3, canCreate: false, cannotCreateReason: reason });
    render(<Wrap><SpacesPage /></Wrap>);
    await answered();
    const button = screen.getByRole('button', { name: i18n.t('spaces:list.newSpace'), description: text() });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  test('owned_limit: "Your spaces: 3 of 3" is said once, and it describes the button', async () => {
    world.spaces = answer({ ownedCount: 3, ownedLimit: 3, canCreate: false, cannotCreateReason: 'owned_limit' });
    render(<Wrap><SpacesPage /></Wrap>);
    await answered();
    const label = i18n.t('spaces:quota.owned', { owned: 3, limit: 3 });
    expect(screen.getAllByText(label)).toHaveLength(1);
    expect(screen.getByRole('button', { name: i18n.t('spaces:list.newSpace'), description: label })).toBeTruthy();
  });

  test.each<CannotCreateSpaceReason>(['space_creation_disabled', 'external_user'])(
    '%s — there is no button at all',
    async (reason) => {
      world.spaces = answer({ canCreate: false, cannotCreateReason: reason });
      render(<Wrap><SpacesPage /></Wrap>);
      await answered();
      expect(newSpace()).toBeNull();
    },
  );

  test('the numbers do not decide: "4 of 3" with canCreate (an admin, V2) — the button is on', async () => {
    world.user = { id: 'u-1', username: 'root', role: 'admin', isExternal: false };
    world.spaces = answer({ ownedCount: 4, ownedLimit: 3, canCreate: true, cannotCreateReason: null });
    render(<Wrap><SpacesPage /></Wrap>);
    await answered();
    // The limit line is shown as the server counts it …
    expect(screen.getByText(i18n.t('spaces:quota.owned', { owned: 4, limit: 3 }))).toBeTruthy();
    // … and the button still follows `canCreate`.
    expect((newSpace() as HTMLButtonElement).disabled).toBe(false);
  });

  test('without a limit there is no "Your spaces" line', async () => {
    world.spaces = answer({ ownedLimit: null });
    render(<Wrap><SpacesPage /></Wrap>);
    await answered();
    // The label's fixed part, read from the dictionary: no line starts with it.
    const lead = i18n.t('spaces:quota.owned', { owned: '§', limit: '§' }).split('§')[0];
    expect(screen.queryByText((text) => text.startsWith(lead))).toBeNull();
  });

  test('the limit reached between opening and sending — the server’s refusal is said under the field', async () => {
    world.createSpace = () =>
      Promise.reject(new BusinessError(422, 'owned limit', 'owned_limit', { ownedCount: 3, ownedLimit: 3 }));
    render(<Wrap><SpacesPage /></Wrap>);
    await answered();
    fireEvent.click(newSpace()!);
    const dialog = await screen.findByRole('dialog', { name: i18n.t('spaces:create.title') });
    fireEvent.change(within(dialog).getByRole('textbox', { name: i18n.t('spaces:create.name') }), {
      target: { value: 'Backend' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: i18n.t('spaces:create.submit') }));
    await waitFor(() =>
      expect(
        within(dialog).getByText(i18n.t('spaces:create.errors.owned_limit', { owned: 3, limit: 3 })),
      ).toBeTruthy(),
    );
  });
});

describe('row 249 — no «Spaces» tab for an external user', () => {
  const tab = () =>
    within(screen.getByRole('navigation', { name: i18n.t('settings:tabsAria') })).queryByRole('link', {
      name: i18n.t('settings:tabs.spaces'),
    });

  test('an internal user has the tab, leading to /settings/spaces', () => {
    render(<Wrap><SettingsLayout active="password">body</SettingsLayout></Wrap>);
    expect(tab()?.getAttribute('href')).toBe('/settings/spaces');
  });

  test('an external user has none', () => {
    world.user = { id: 'u-2', username: 'guest', role: 'user', isExternal: true };
    render(<Wrap><SettingsLayout active="password">body</SettingsLayout></Wrap>);
    expect(tab()).toBeNull();
    // Positive control: the rest of the row is there.
    expect(
      within(screen.getByRole('navigation', { name: i18n.t('settings:tabsAria') })).getByRole('link', {
        name: i18n.t('settings:tabs.password'),
      }),
    ).toBeTruthy();
  });
});

describe('sk-733.2 — a space’s settings are a ⚙ in its row, names are not links', () => {
  test('no space name is a link; "Common" and a team space have a ⚙ to their settings, "Personal" none', async () => {
    world.spaces = answer({
      items: [
        space('p0aa11bb', 'Личное', 'personal'),
        space('c0mm0n11', 'Общее', 'common', { myRole: 'member' }),
        space('k3x9p2qa', 'Acme', 'regular'),
      ],
    });
    render(<SpacesPage />, { wrapper: Wrap });
    const table = await answered();
    const personal = i18n.t('spaces:list.personal');
    for (const name of [personal, 'Общее', 'Acme']) {
      expect(within(table).getByText(name).closest('a'), `${name} is plain text`).toBeNull();
    }
    const gear = (name: string) => within(table).queryByRole('link', { name: i18n.t('spaces:list.settingsAria', { name }) });
    expect(gear('Общее')?.getAttribute('href')).toBe('/settings/spaces/c0mm0n11-общее');
    expect(gear('Acme')?.getAttribute('href')).toBe('/settings/spaces/k3x9p2qa-acme');
    expect(gear(personal)).toBeNull();
    expect(within(table).getAllByRole('link')).toHaveLength(2);
  });
});
