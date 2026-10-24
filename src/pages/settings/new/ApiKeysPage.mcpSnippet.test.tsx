/**
 * The MCP snippet is withheld until the deployment's address is actually
 * known.
 *
 * `mcpUrl` from the runtime config is `null` in three different situations:
 * the BFF said "same-origin", the query has not resolved, and the query
 * failed. Collapsing them meant a deployment that serves MCP from its own
 * origin rendered the same-origin fallback first — a copyable, plausible,
 * WRONG address, next to a Copy button inviting the reader to take it. On a
 * lasting failure it never corrected itself.
 *
 * These cases pin the three states apart: resolved renders the snippet,
 * pending renders neither snippet nor copy affordance, and failure says so
 * instead of guessing.
 */
import { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const getAuthConfig = vi.fn();
const listApiKeys = vi.fn();

vi.mock('../../../lib/useAuthConfig', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/useAuthConfig')>(
    '../../../lib/useAuthConfig',
  );
  const { useQuery } = await import('@tanstack/react-query');
  return {
    ...actual,
    useAuthConfig: () =>
      useQuery({
        queryKey: ['auth', 'config'],
        queryFn: () => getAuthConfig(),
        retry: false,
        staleTime: Infinity,
        gcTime: Infinity,
      }),
  };
});

vi.mock('../../../auth/AuthContext', () => ({
  // sk-551.8 — LayoutProvider reads the layout via useNavLayoutOptional;
  // null = no session known, the side-by-side layout.
  useAuthOptional: () => null,
  useAuth: () => ({
    user: { username: 'alice', role: 'user' },
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

vi.mock('../../../api/api-keys', () => ({
  listApiKeys: (...a: unknown[]) => listApiKeys(...a),
  createApiKey: vi.fn(),
  revokeApiKey: vi.fn(),
}));

import { NewApiKeysPage } from './ApiKeysPage';

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MantineProvider>
      <MemoryRouter>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </MemoryRouter>
    </MantineProvider>
  );
  return render(<NewApiKeysPage />, { wrapper });
}

describe('ApiKeysPage MCP snippet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listApiKeys.mockResolvedValue([]);
  });
  afterEach(cleanup);

  it('renders the snippet once the deployment address has resolved', async () => {
    getAuthConfig.mockResolvedValue({
      authMode: 'local',
      logoutRedirectUrl: null,
      mcpUrl: 'https://mcp.example.net/mcp',
    });

    renderPage();

    const block = await screen.findByRole('region', {
      name: 'MCP server configuration JSON',
    });
    expect(block.textContent).toContain('https://mcp.example.net/mcp');
  });

  it('shows no snippet and no copy button while the address is still unknown', async () => {
    // A promise that never settles: the pending state, held still.
    getAuthConfig.mockImplementation(() => new Promise(() => {}));

    renderPage();

    await waitFor(() => expect(getAuthConfig).toHaveBeenCalled());
    expect(
      screen.queryByRole('region', { name: 'MCP server configuration JSON' }),
    ).toBeNull();
    expect(screen.queryByRole('button', { name: /copy/i })).toBeNull();
  });

  it('says the address could not be read instead of guessing one', async () => {
    getAuthConfig.mockRejectedValue(new Error('config unreachable'));

    renderPage();

    expect(await screen.findByText(/Configuration unavailable/i)).toBeTruthy();
    expect(
      screen.queryByRole('region', { name: 'MCP server configuration JSON' }),
    ).toBeNull();
  });
});
