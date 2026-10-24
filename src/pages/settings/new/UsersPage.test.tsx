/**
 * sk-163 S8 — admin Users page external-collaborator UI:
 *   - "External" checkbox forces role=user and locks the Role select.
 *   - createUser receives isExternal + role='user'.
 *   - external rows render the "external" badge.
 *   - the "External only" filter segregates external rows.
 *
 * Mirrors login.test.tsx: useAuth / useAuthConfig / api/users are mocked
 * at the module level so the test is offline + deterministic.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { User, UserListResult } from '../../../api/users';

// ─────────────────────────── Mocks ───────────────────────────

type AuthMode = 'local' | 'keycloak' | 'hybrid';

let mockAuthMode: AuthMode = 'local';
vi.mock('../../../lib/useAuthConfig', () => ({
  useAuthConfig: () => ({
    data: { authMode: mockAuthMode },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

vi.mock('../../../auth/AuthContext', () => ({
  // sk-551.8 — LayoutProvider reads the layout via useNavLayoutOptional;
  // null = no session known, the side-by-side layout.
  useAuthOptional: () => null,
  useAuth: () => ({
    user: { id: 'admin-1', username: 'admin', role: 'admin' },
    login: vi.fn(),
    logout: vi.fn(),
    isLoading: false,
  }),
}));

const internalUser: User = {
  id: 'u-internal',
  email: 'staff@corp.local',
  username: 'staff',
  name: 'Staff Member',
  role: 'user',
  createdAt: '2026-01-01T00:00:00Z',
  lastLoginAt: null,
  deactivatedAt: null,
  authMethod: 'password',
  isExternal: false,
};
const externalUser: User = {
  id: 'u-external',
  email: 'partner@customer.com',
  username: 'partner',
  name: 'External Partner',
  role: 'user',
  createdAt: '2026-01-02T00:00:00Z',
  lastLoginAt: null,
  deactivatedAt: null,
  authMethod: 'password',
  isExternal: true,
};

// vi.hoisted so the fns exist before the hoisted vi.mock factory runs
// (referencing a plain top-level const in the factory hits a TDZ).
const { mockListUsers, mockCreateUser } = vi.hoisted(() => ({
  mockListUsers: vi.fn(),
  mockCreateUser: vi.fn(),
}));

vi.mock('../../../api/users', () => ({
  listUsers: mockListUsers,
  createUser: mockCreateUser,
  updateUser: vi.fn(),
  deactivateUser: vi.fn(),
  reactivateUser: vi.fn(),
}));

// Imported AFTER the mocks so the mocked modules are wired in.
import { NewUsersPage } from './UsersPage';

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MantineProvider>
        <MemoryRouter>
          <NewUsersPage />
        </MemoryRouter>
      </MantineProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockAuthMode = 'local';
  mockListUsers.mockReset();
  mockCreateUser.mockReset();
  // Param-aware: the filter is server-side now, so ?external=true returns
  // only the external user (mirrors the backend), otherwise both classes.
  mockListUsers.mockImplementation(
    async (params?: { external?: boolean }): Promise<UserListResult> => ({
      items: params?.external ? [externalUser] : [internalUser, externalUser],
      nextCursor: null,
      hasMore: false,
    }),
  );
  mockCreateUser.mockResolvedValue(externalUser satisfies User);
});

afterEach(() => cleanup());

// jsdom-friendly disabled check: Mantine sets the native `disabled`
// attribute on the underlying input for both Select and Checkbox.
const isDisabled = (el: HTMLElement): boolean =>
  (el as HTMLInputElement).disabled || el.hasAttribute('disabled');

describe('NewUsersPage external users (sk-163 S8)', () => {
  test('list renders an "external" badge only on external rows', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('partner')).toBeTruthy());
    // Exactly one "external" badge — on the external row.
    expect(screen.getAllByText('external')).toHaveLength(1);
  });

  test('"External only" filter refetches server-side with external=true', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('staff')).toBeTruthy());
    // Initial load has NO external filter (both classes).
    expect(mockListUsers).toHaveBeenCalledWith(
      expect.objectContaining({ external: undefined }),
    );

    fireEvent.click(screen.getByLabelText('External only'));
    // Toggling refetches server-side with external=true; once the refetch
    // settles the internal row is gone because the backend (mock) excluded
    // it — not a client filter. Assert all three together so the loader's
    // transient empty state doesn't race the assertions.
    await waitFor(() => {
      expect(mockListUsers).toHaveBeenCalledWith(
        expect.objectContaining({ external: true }),
      );
      expect(screen.queryByText('staff')).toBeNull();
      expect(screen.getByText('partner')).toBeTruthy();
    });
  });

  test('External checkbox forces role=user, locks Role select, and createUser gets isExternal=true', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('partner')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /new user/i }));
    const dialog = await screen.findByRole('dialog');
    const d = within(dialog);

    // Role select starts enabled (internal default in local mode).
    expect(isDisabled(d.getByLabelText('Role'))).toBe(false);

    // Check External → Role locks, exposure warning appears.
    fireEvent.click(d.getByLabelText(/External user/i));
    expect(isDisabled(d.getByLabelText('Role'))).toBe(true);
    expect(d.getByText(/dedicated, external-facing projects/i)).toBeTruthy();

    // Required fields render a "*" asterisk in the label ("Email *"), so
    // match with an anchored regex rather than the exact string.
    fireEvent.change(d.getByLabelText(/^Email/), {
      target: { value: 'new@customer.com' },
    });
    fireEvent.change(d.getByLabelText(/^Name/), {
      target: { value: 'New Partner' },
    });
    fireEvent.change(d.getByLabelText(/^Password/), {
      target: { value: 'passw0rd!' },
    });
    fireEvent.click(d.getByRole('button', { name: /^create$/i }));

    await waitFor(() => expect(mockCreateUser).toHaveBeenCalledTimes(1));
    expect(mockCreateUser).toHaveBeenCalledWith(
      expect.objectContaining({ isExternal: true, role: 'user', email: 'new@customer.com' }),
    );
  });

  test('SSO mode locks the External checkbox on', async () => {
    mockAuthMode = 'keycloak';
    renderPage();
    await waitFor(() => expect(screen.getByText('partner')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /new user/i }));
    const dialog = await screen.findByRole('dialog');
    const d = within(dialog);
    const ext = d.getByLabelText(/External user/i) as HTMLInputElement;
    expect(ext.checked).toBe(true);
    expect(isDisabled(ext)).toBe(true);
    expect(isDisabled(d.getByLabelText('Role'))).toBe(true);
  });
});
