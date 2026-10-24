/**
 * sk-62.3.5 / sk-303.13 — device-block tests.
 *
 * The block these tests cover is the one /settings/notifications mounts
 * beside the reason table: enabling push in THIS browser, the device list,
 * and revoking any device. Devices are not a reason, so they never became
 * rows of that table — and this is where it is checked that they still work
 * as their own block. The category switches these tests also used to cover
 * are gone with T023: they were a second vocabulary of channels, and the
 * reason table now owns that decision.
 *
 * The page that used to host the block (/settings/push) is deleted; the tests
 * moved to the component, which is where the behaviour lives now.
 */
import { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  render,
  screen,
  cleanup,
  waitFor,
  fireEvent,
  within,
} from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

// ── Mocks ────────────────────────────────────────────────────────
vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({ user: { username: 'u', role: 'user' } }),
}));

// Thin SettingsLayout pass-through — avoids mounting HeaderBar + the
// LayoutProvider/TasksUiState stack. Keeps SettingsPanel real so the
// page's own structure is exercised unchanged.
vi.mock('./SettingsLayout', async (importActual) => {
  const actual = await importActual<typeof import('./SettingsLayout')>();
  return {
    ...actual,
    SettingsLayout: ({ children }: { children: ReactNode }) => (
      <div>{children}</div>
    ),
  };
});

const subscribeSpy = vi.fn();
const unsubscribeSpy = vi.fn();

vi.mock('../../../lib/usePush', () => ({
  pushDevicesKey: ['push', 'devices'],
  usePush: () => ({
    supported: true,
    permission: 'granted',
    subscribed: false,
    busy: false,
    subscribe: subscribeSpy,
    unsubscribe: unsubscribeSpy,
  }),
}));

const listPushDevicesSpy = vi.fn();
const deleteSubscriptionByIdSpy = vi.fn();

vi.mock('../../../api/push', () => ({
  listPushDevices: () => listPushDevicesSpy(),
  deleteSubscriptionById: (id: string) => deleteSubscriptionByIdSpy(id),
}));

// sha256Hex is stubbed so the test controls which row is "this device":
// the effect hashes the live endpoint and matches it against row.endpointHash.
// We make sha256Hex deterministic and point the live endpoint's hash at a
// specific row below.
const sha256HexSpy = vi.fn();
vi.mock('../../../lib/sha256', () => ({
  sha256Hex: (s: string) => sha256HexSpy(s),
}));

import { PushDevicesSection } from './PushDevicesSection';

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

/** Locate the category Switch by its label and return its checkbox input. */
function categorySwitch(label: string): HTMLInputElement {
  const labelEl = screen.getByText(label);
  // Mantine renders the label inside the same <label> as the input.
  const root = labelEl.closest('label') ?? labelEl.parentElement!;
  return within(root).getByRole('switch') as HTMLInputElement;
}

/**
 * Find the device-row "Unsubscribe" button for the device whose label text is
 * given. Walks up from the label to the nearest ancestor that also contains a
 * button (the outer row Group), then queries the button inside it — robust
 * against Mantine's nested Group structure (inner Group = label+badge, outer
 * Group = inner + button).
 */
function deviceUnsubscribeButton(deviceLabel: string): HTMLButtonElement {
  let node: HTMLElement | null = screen.getByText(deviceLabel);
  while (node && !within(node).queryByRole('button', { name: /Unsubscribe/ })) {
    node = node.parentElement;
  }
  if (!node) throw new Error(`no Unsubscribe button found for "${deviceLabel}"`);
  return within(node).getByRole('button', {
    name: /Unsubscribe/,
  }) as HTMLButtonElement;
}

// Live push endpoint this browser reports. Its sha256Hex below resolves to
// CURRENT_HASH, which the "current device" row also carries.
const CURRENT_ENDPOINT = 'https://fcm.googleapis.com/fcm/send/CURRENT';
const CURRENT_HASH = 'currenthash';

/**
 * Stub navigator.serviceWorker so the current-device-detection effect finds a
 * registration → subscription → endpoint. Pass null to simulate "no SW / no
 * subscription" (nothing highlighted).
 */
function stubServiceWorker(endpoint: string | null) {
  const subscription = endpoint ? { endpoint } : null;
  const registration = {
    pushManager: { getSubscription: vi.fn().mockResolvedValue(subscription) },
  };
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { getRegistration: vi.fn().mockResolvedValue(registration) },
  });
}

beforeEach(() => {
  listPushDevicesSpy.mockReset().mockResolvedValue([]);
  deleteSubscriptionByIdSpy.mockReset().mockResolvedValue(undefined);
  subscribeSpy.mockReset().mockResolvedValue(undefined);
  unsubscribeSpy.mockReset().mockResolvedValue(undefined);
  // Default: the live endpoint hashes to CURRENT_HASH.
  sha256HexSpy
    .mockReset()
    .mockImplementation((s: string) =>
      Promise.resolve(s === CURRENT_ENDPOINT ? CURRENT_HASH : `other:${s}`),
    );
  stubServiceWorker(CURRENT_ENDPOINT);
});

afterEach(() => cleanup());

describe('PushDevicesSection — enabling push on this device (row 37)', () => {
  test('the switch subscribes this browser; the block is not a reason row', async () => {
    render(
      <Wrap>
        <PushDevicesSection />
      </Wrap>,
    );
    await waitFor(() =>
      expect(screen.getByText('Turn on push on this device')).toBeTruthy(),
    );
    // The block carries no reason table of its own: what it configures is
    // WHICH BROWSERS are subscribed, not which reasons reach which channel.
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByText('Push notification categories')).toBeNull();

    fireEvent.click(categorySwitch('Turn on push on this device'));
    await waitFor(() => expect(subscribeSpy).toHaveBeenCalledTimes(1));
  });
});

describe('PushDevicesSection — push-service-error help callout (sk-62.3.7)', () => {
  test('a failed subscribe (push service error) shows the help callout', async () => {
    subscribeSpy.mockRejectedValue(
      new Error('Registration failed - push service error'),
    );

    render(
      <Wrap>
        <PushDevicesSection />
      </Wrap>,
    );

    await waitFor(() =>
      expect(screen.getByText('Turn on push on this device')).toBeTruthy(),
    );
    fireEvent.click(categorySwitch('Turn on push on this device'));

    await waitFor(() =>
      expect(screen.getByText(/couldn't reach its push service/i)).toBeTruthy(),
    );
    expect(subscribeSpy).toHaveBeenCalledTimes(1);
  });

  test('no callout on a successful subscribe', async () => {
    subscribeSpy.mockResolvedValue(undefined);

    render(
      <Wrap>
        <PushDevicesSection />
      </Wrap>,
    );

    await waitFor(() =>
      expect(screen.getByText('Turn on push on this device')).toBeTruthy(),
    );
    fireEvent.click(categorySwitch('Turn on push on this device'));

    await waitFor(() => expect(subscribeSpy).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/couldn't reach its push service/i)).toBeNull();
  });
});

describe('PushDevicesSection — device list (sk-62.3.8)', () => {
  const CHROME_UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';
  const FIREFOX_UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:151.0) Gecko/20100101 Firefox/151.0';

  // Two devices: the FIRST in server order is NOT current; the SECOND is the
  // current browser (its endpointHash === CURRENT_HASH). The page must badge
  // and float the current one to the top.
  const DEVICES = [
    {
      id: 'dev-other',
      endpointHash: 'other:https://fcm.googleapis.com/fcm/send/OTHER',
      ua: FIREFOX_UA,
      createdAt: '2026-06-01T10:00:00Z',
      lastSeenAt: '2026-06-02T10:00:00Z',
    },
    {
      id: 'dev-current',
      endpointHash: CURRENT_HASH,
      ua: CHROME_UA,
      createdAt: '2026-06-03T10:00:00Z',
      lastSeenAt: '2026-06-04T10:00:00Z',
    },
  ];

  beforeEach(() => {
  });

  test('current device shows the badge, renders a readable UA, and sorts to the top', async () => {
    listPushDevicesSpy.mockResolvedValue(DEVICES);

    render(
      <Wrap>
        <PushDevicesSection />
      </Wrap>,
    );

    // Badge appears once the live endpoint is hashed and matched.
    await waitFor(() => expect(screen.getByText('this device')).toBeTruthy());

    // Readable labels (not raw UA).
    expect(screen.getByText('Chrome 149 · Windows')).toBeTruthy();
    expect(screen.getByText('Firefox 151 · Windows')).toBeTruthy();
    expect(screen.queryByText(CHROME_UA)).toBeNull();

    // The current device (Chrome) is rendered BEFORE the other (Firefox).
    const chromeIdx = document.body.textContent!.indexOf('Chrome 149');
    const firefoxIdx = document.body.textContent!.indexOf('Firefox 151');
    expect(chromeIdx).toBeGreaterThanOrEqual(0);
    expect(chromeIdx).toBeLessThan(firefoxIdx);

    // a11y (audit sk-194, wave A): each row's unsubscribe button must carry
    // the device in its accessible name. Sighted users tell the buttons apart
    // by the row they sit in; a screen-reader user tabbing through heard only
    // "Unsubscribe", "Unsubscribe" and could not tell which device they were about
    // to remove. Asserting the DISTINCT names — not just that a button exists
    // — is what makes that fix a checked fact rather than a claim.
    const unsubscribeNames = screen
      .getAllByRole('button', { name: /Unsubscribe/ })
      .map((b) => b.getAttribute('aria-label'));
    expect(unsubscribeNames).toEqual(
      expect.arrayContaining([
        'Unsubscribe device Chrome 149 · Windows',
        'Unsubscribe device Firefox 151 · Windows',
      ]),
    );
    expect(new Set(unsubscribeNames).size).toBe(unsubscribeNames.length);
  });

  test('the devices are a list, one listitem per device', async () => {
    listPushDevicesSpy.mockResolvedValue(DEVICES);

    render(
      <Wrap>
        <PushDevicesSection />
      </Wrap>,
    );

    await waitFor(() =>
      expect(screen.getByText('Firefox 151 · Windows')).toBeTruthy(),
    );
    // A homogeneous set of revocable rows is a list: AT announces "list,
    // N items" and can walk it. A bare stack of <div>s announces nothing
    // and gives no count.
    const list = screen.getByRole('list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(DEVICES.length);
  });

  test("clicking a non-current row's Unsubscribe calls deleteSubscriptionById(id)", async () => {
    listPushDevicesSpy.mockResolvedValue(DEVICES);

    render(
      <Wrap>
        <PushDevicesSection />
      </Wrap>,
    );

    await waitFor(() =>
      expect(screen.getByText('Firefox 151 · Windows')).toBeTruthy(),
    );

    // Locate the Firefox (non-current) row and click its Unsubscribe button.
    fireEvent.click(deviceUnsubscribeButton('Firefox 151 · Windows'));

    await waitFor(() =>
      expect(deleteSubscriptionByIdSpy).toHaveBeenCalledWith('dev-other'),
    );
    // The current-device unsubscribe path is NOT taken for a non-current row.
    expect(unsubscribeSpy).not.toHaveBeenCalled();
  });

  test("clicking the current row's Unsubscribe calls usePush.unsubscribe (not the id delete)", async () => {
    listPushDevicesSpy.mockResolvedValue(DEVICES);

    render(
      <Wrap>
        <PushDevicesSection />
      </Wrap>,
    );

    await waitFor(() => expect(screen.getByText('this device')).toBeTruthy());

    fireEvent.click(deviceUnsubscribeButton('Chrome 149 · Windows'));

    await waitFor(() => expect(unsubscribeSpy).toHaveBeenCalledTimes(1));
    expect(deleteSubscriptionByIdSpy).not.toHaveBeenCalled();
  });
});
