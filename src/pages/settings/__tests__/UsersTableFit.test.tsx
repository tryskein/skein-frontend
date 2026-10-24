/**
 * sk-408 (2) — the Users table dropped columns so it fits the panel it is
 * drawn in.
 *
 * The owner: "In Users all the information does not fit in the block. The number of
 * columns needs to be reduced and a popup with more detailed
 * information could be made".
 *
 * Measured at sk-408 (Chromium, 1284×900, 100 users): the eight columns
 * needed 1270.62px of natural width against 894px of panel body. The fix
 * removed the three detail columns and merged Username and Name into one
 * User column. These tests hold the composition the page renders; the
 * widths themselves are not asserted (sk-540.11, owner decision: layout
 * is not checked from jsdom).
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { User, UserListResult } from '../../../api/users';

import { skeinTheme } from '../../../theme';

vi.mock('../../../lib/useAuthConfig', () => ({
  useAuthConfig: () => ({
    data: { authMode: 'local' },
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

const someone: User = {
  id: 'u-1',
  email: 'olivia.stone@test.com',
  username: 'ostone',
  name: 'Olivia Stone',
  role: 'admin',
  createdAt: '2026-01-01T00:00:00Z',
  lastLoginAt: '2026-08-31T17:31:00Z',
  deactivatedAt: null,
  authMethod: 'password',
  isExternal: false,
};

const { mockListUsers } = vi.hoisted(() => ({ mockListUsers: vi.fn() }));

vi.mock('../../../api/users', () => ({
  listUsers: mockListUsers,
  createUser: vi.fn(),
  updateUser: vi.fn(),
  deactivateUser: vi.fn(),
  reactivateUser: vi.fn(),
}));

import { NewUsersPage } from '../new/UsersPage';

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MantineProvider theme={skeinTheme} forceColorScheme="light">
        <MemoryRouter>
          <NewUsersPage />
        </MemoryRouter>
      </MantineProvider>
    </QueryClientProvider>,
  );
}

/** The headings the page actually draws, in order. */
async function renderedColumns(): Promise<string[]> {
  renderPage();
  await waitFor(() => expect(screen.getByText('ostone')).toBeTruthy());
  const table = document.querySelector('table');
  if (!table) throw new Error('the page rendered no table');
  return [...table.querySelectorAll('thead th')].map((th) => th.textContent?.trim() ?? '');
}

beforeEach(() => {
  mockListUsers.mockReset();
  mockListUsers.mockImplementation(
    async (): Promise<UserListResult> => ({
      items: [someone],
      nextCursor: null,
      hasMore: false,
    }),
  );
});

afterEach(() => {
  cleanup();
});

describe('sk-408 — the Users table composition', () => {
  test('the three detail columns are gone from the row', async () => {
    const columns = await renderedColumns();
    for (const gone of ['Auth', 'Last login', 'State']) {
      expect(columns, `«${gone}» is back in the row`).not.toContain(gone);
    }
  });

  test('the identity columns merged rather than one of them being dropped', async () => {
    // «User» present and «Username» / «Name» absent is what «merged»
    // means; dropping one of the two would also fit, so it is excluded.
    const columns = await renderedColumns();
    expect(columns).toContain('User');
    expect(columns).not.toContain('Username');
    expect(columns).not.toContain('Name');
    expect(columns).toContain('Email');
  });
});
