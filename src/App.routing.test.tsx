/**
 * sk-303.15 review follow-up — smoke test for the App-level catch-all
 * route (`path="*"` → `Navigate to="/"`).
 *
 * sk-303.15 deleted the whole `/legacy/*` route tree in one commit,
 * which means the catch-all — unchanged code, but suddenly responsible
 * for 18 formerly-real addresses instead of stray typos — is now what
 * every old bookmark, doc link, and chat-pasted `/legacy/...` URL falls
 * through to. `settingsRoutes.test.tsx` explains (in its docblock) why
 * it stopped asserting on one specific former address
 * (`/legacy/settings/notifications`) once that stopped being
 * settings-specific behaviour; this file is the general-purpose
 * assertion that gap left open: an arbitrary unmatched path — not just
 * a settings one — lands on a real, rendered surface, not a blank
 * screen or a thrown error.
 *
 * `Shell` is mocked to a lightweight stub — this test is about ROUTING
 * (which top-level component mounts), not Shell's own internals
 * (covered by `pages/shell/__tests__/Shell.test.tsx`).
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

vi.mock('./auth/AuthContext', () => ({
  useAuth: () => ({
    user: {
      id: 'u-1',
      email: 'tester@example.com',
      username: 'tester',
      name: 'Tester',
      role: 'user',
      createdAt: null,
      lastLoginAt: null,
    },
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

vi.mock('./pages/shell/Shell', () => ({
  Shell: () => <div data-testid="shell-stub">shell</div>,
}));

import App from './App';

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MantineProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

afterEach(() => cleanup());

describe('App catch-all route — stale /legacy/* addresses', () => {
  test.each([
    '/legacy/settings/notifications',
    '/legacy/projects/1/issues/42',
    '/legacy/users/someone',
  ])('%s falls through to Shell, not a blank screen', async (path) => {
    renderAt(path);
    expect(await screen.findByTestId('shell-stub')).toBeTruthy();
  });
});
