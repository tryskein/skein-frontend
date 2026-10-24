/**
 * sk-303.13 / row 37 — one settings form, and the /settings/push address
 * still answers.
 *
 * The wave deleted two surfaces: the legacy notification-settings page and the
 * push page's category switches. Deleting a page is easy; the part worth
 * testing is what happens to the addresses that pointed at it. Links live in
 * bookmarks and in chat history, and a route quietly falling through to the
 * catch-all would dump the reader on the home board with no explanation —
 * which reads as "the settings are gone", not as "they moved".
 *
 * sk-303.15 later removed the whole /legacy/* route tree (including the
 * `/legacy/settings/notifications` redirect this file used to also assert
 * on) — that address now falls through to the same catch-all as every
 * other /legacy/* address, which is covered by App-level routing, not
 * settings-specific behaviour worth a dedicated case here.
 *
 * So: /settings/push lands on THE form, and no route anywhere renders a
 * second dictionary of channel settings.
 *
 * The app's route table is exercised through the real `App`, not a copy of it:
 * a test that re-declares the routes would only prove the copy agrees with
 * itself.
 */
import { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    user: { username: 'u', role: 'user' },
    isLoading: false,
  }),
}));

// The soft-ask registers a service worker on mount; irrelevant here and
// noisy in jsdom.
vi.mock('../../components/PushSoftAsk', () => ({
  PushSoftAsk: () => null,
}));

// Chrome only — the assertions are about WHICH page a route resolves to.
vi.mock('./new/SettingsLayout', async (importActual) => {
  const actual = await importActual<typeof import('./new/SettingsLayout')>();
  return {
    ...actual,
    SettingsLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  };
});

vi.mock('./new/PushDevicesSection', () => ({
  PushDevicesSection: () => <div data-testid="push-devices" />,
}));

const getReasonPrefsSpy = vi.fn();
vi.mock('../../api/notification-reasons', async (importActual) => {
  const actual =
    await importActual<typeof import('../../api/notification-reasons')>();
  return { ...actual, getReasonPrefs: () => getReasonPrefsSpy() };
});

import App from '../../App';
import type { ReasonPrefs } from '../../api/notification-reasons';
import * as notificationsApi from '../../api/notifications';
import * as pushApi from '../../api/push';

const PREFS: ReasonPrefs = {
  reasons: [
    {
      key: 'comment',
      label: 'Comment',
      hint: 'feed — on issues I watch',
      feed: { applicable: true, audience: 'subscribers', enabled: false },
      push: { applicable: false, audience: '', enabled: false },
    },
  ],
  suppressAgentActions: false,
  unwatchOnClose: false,
};

function renderAt(path: string) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
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

/** The single form, identified by a cell only it renders. */
async function expectTheOneForm() {
  await waitFor(() => expect(screen.getByText('Comment')).toBeTruthy());
  expect(screen.getByText('Feed')).toBeTruthy();
  expect(screen.getByText('Push')).toBeTruthy();
}

beforeEach(() => {
  getReasonPrefsSpy.mockReset().mockResolvedValue(PREFS);
});

afterEach(() => cleanup());

describe('settings routes — one form, compatible addresses', () => {
  test('/settings/notifications renders the reason form', async () => {
    renderAt('/settings/notifications');
    await expectTheOneForm();
  });

  test('/settings/push redirects to the one form instead of 404-ing home', async () => {
    renderAt('/settings/push');
    await expectTheOneForm();
    // And nothing of the deleted surface came along: the category switches
    // were the second vocabulary of channels this wave removed.
    expect(screen.queryByText('Push notification categories')).toBeNull();
  });
});

describe('settings modules — no second channel dictionary is left behind', () => {
  test('the retired per-user prefs client is gone from api/notifications', () => {
    // `/me/notification-prefs` (event-type whitelist + agent-action suppression)
    // was replaced by the reason contract. A leftover client for it would be
    // a dead settings module — and the field the whole sk-88 fix removed,
    // `defaultInboxScope`, lived exactly there.
    expect('getPrefs' in notificationsApi).toBe(false);
    expect('updatePrefs' in notificationsApi).toBe(false);
    expect(JSON.stringify(notificationsApi)).not.toContain('defaultInboxScope');
  });

  test('the retired push-category client is gone from api/push', () => {
    expect('getPushPrefs' in pushApi).toBe(false);
    expect('updatePushPrefs' in pushApi).toBe(false);
    // Device management is NOT retired — it is a different contract.
    expect('listPushDevices' in pushApi).toBe(true);
    expect('deleteSubscriptionById' in pushApi).toBe(true);
    expect('registerSubscription' in pushApi).toBe(true);
  });

  test('the local event-type dictionary is gone from api/notifications', () => {
    expect('NOTIFICATION_EVENT_TYPES' in notificationsApi).toBe(false);
    expect('NOTIFICATION_CATEGORIES' in notificationsApi).toBe(false);
    expect('listSubscriptionEventTypes' in notificationsApi).toBe(true);
  });
});
