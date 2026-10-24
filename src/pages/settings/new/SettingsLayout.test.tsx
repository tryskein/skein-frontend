/**
 * sk-303.13 / row 37 — the settings chrome offers ONE notification form.
 *
 * Deleting the push page is not enough on its own: a tab still pointing at it
 * would keep telling people there are two places to configure notifications,
 * and the one it led to no longer decides anything. So the navigation is part
 * of the acceptance, not a cosmetic afterthought.
 */
import { ReactNode } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../../auth/AuthContext', () => ({
  // sk-551.8 — LayoutProvider reads the layout via useNavLayoutOptional;
  // null = no session known, the side-by-side layout.
  useAuthOptional: () => null,
  useAuth: () => ({ user: { username: 'u', role: 'user' }, isLoading: false }),
}));

// The header pulls badge counts over the network and mounts the whole shell
// state; irrelevant to what the tab row advertises.
vi.mock('../../shell/HeaderBar', () => ({
  HeaderBar: () => <div data-testid="header" />,
}));

import { SettingsLayout } from './SettingsLayout';

function Wrap({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <MantineProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter>{children}</MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>
  );
}

afterEach(() => cleanup());

describe('SettingsLayout — one notification surface in the navigation', () => {
  test('there is a Notifications tab and no Push tab', () => {
    render(
      <Wrap>
        <SettingsLayout active="notifications">body</SettingsLayout>
      </Wrap>,
    );
    const nav = screen.getByLabelText('Settings sections');
    expect(within(nav).getByText('Notifications')).toBeTruthy();
    expect(within(nav).queryByText('Push')).toBeNull();
  });

  test('no tab links to the deleted push page', () => {
    render(
      <Wrap>
        <SettingsLayout active="notifications">body</SettingsLayout>
      </Wrap>,
    );
    const nav = screen.getByLabelText('Settings sections');
    const hrefs = within(nav)
      .getAllByRole('link')
      .map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/settings/notifications');
    expect(hrefs).not.toContain('/settings/push');
  });
});
