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
import { MemoryRouter } from 'react-router';
import i18n from '../../../i18n/config';
import type { PushDevice } from '../../../api/push';
import { emptyConsent, type Consent } from '../../../lib/push/pushState';
import type { PushLifecycleState } from '../../../lib/push/pushLifecycle';

// ── Mocks ────────────────────────────────────────────────────────

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

// The push state of the current appearance and the explicit actions of the
// push controller, as `usePush` hands them to the page.
const push = vi.hoisted(() => ({
  state: null as unknown as PushLifecycleState,
  enable: vi.fn(),
  disable: vi.fn(),
  removeDevice: vi.fn(),
}));

vi.mock('../../../lib/usePush', () => ({
  usePush: () => ({
    state: push.state,
    enable: push.enable,
    disable: push.disable,
    removeDevice: push.removeDevice,
    retry: vi.fn(),
  }),
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

// `endpointHash` of this browser's channel, as the decision reported it.
const CURRENT_HASH = 'currenthash';
const A = '11111111-1111-4111-8111-111111111111';

/** The push state of a decided appearance of A, with `change` applied. */
function decided(change: Partial<PushLifecycleState> = {}, consent: Partial<Consent> = {}): PushLifecycleState {
  return {
    appearance: { userId: A, seq: 1 },
    supported: true,
    decided: true,
    row: 8,
    serverPush: 'enabled',
    permission: 'granted',
    consent: { ...emptyConsent(), ...consent },
    devices: [],
    thisDeviceHash: CURRENT_HASH,
    foreignChannelWarnings: [],
    ...change,
  };
}

beforeEach(() => {
  push.state = decided();
  push.enable.mockReset().mockResolvedValue({ kind: 'done' });
  push.disable.mockReset().mockResolvedValue({ kind: 'done' });
  push.removeDevice.mockReset().mockResolvedValue({ kind: 'done' });
});

afterEach(() => cleanup());

const t = (key: string) => i18n.t(`push:${key}`);

function renderSection() {
  render(
    <Wrap>
      <PushDevicesSection />
    </Wrap>,
  );
}

describe('PushDevicesSection — push on this device (row 37; row 79)', () => {
  test('the switch calls the enable action in the click; the block is not a reason row', () => {
    renderSection();
    // The block carries no reason table of its own: what it configures is
    // WHICH BROWSERS are subscribed, not which reasons reach which channel.
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByText('Push notification categories')).toBeNull();

    fireEvent.click(categorySwitch('Turn on push on this device'));
    // Synchronously, inside the click: the permission prompt needs the gesture.
    expect(push.enable).toHaveBeenCalledTimes(1);
    expect(push.disable).not.toHaveBeenCalled();
  });

  test('with push on, the switch calls the disable action (both parts of the revocation)', () => {
    push.state = decided({}, { state: 'enabled', label: 'l', labels: ['l'] });
    renderSection();

    fireEvent.click(categorySwitch('Push on this device is on'));
    expect(push.disable).toHaveBeenCalledTimes(1);
    expect(push.enable).not.toHaveBeenCalled();
  });

  test.each([
    { case: 'push unsupported', change: { supported: false }, reason: 'device.unsupportedTitle' },
    { case: 'permission denied', change: { permission: 'denied' as const }, reason: 'device.deniedTitle' },
    { case: 'push disabled on the server', change: { serverPush: 'disabled' as const }, reason: 'device.serverDisabledTitle' },
  ])('$case: the reason instead of the switch', ({ change, reason }) => {
    push.state = decided(change);
    renderSection();
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.getByText(t(reason))).toBeTruthy();
  });
});

test('the server configuration could not be read: the switch stays, with that reason, not "push is off on the server"', () => {
  push.state = decided({ serverPush: 'unknown' });
  renderSection();
  expect(screen.getByRole('switch')).toBeTruthy();
  expect(screen.getByText(t('device.serverUnknownTitle'))).toBeTruthy();
  expect(screen.queryByText(t('device.serverDisabledTitle'))).toBeNull();
});

test('the channel could not be read (row 0): the list is shown and push can be turned off', () => {
  const THIS = { id: 'dev-this', endpointHash: CURRENT_HASH, ua: '', createdAt: '2026-06-01T10:00:00Z', lastSeenAt: '2026-06-01T10:00:00Z', deviceLabel: 'l', version: 1 };
  push.state = decided({ decided: false, row: 0, devices: [THIS] }, { state: 'enabled', label: 'l', labels: ['l'] });
  renderSection();

  expect(screen.getByRole('list')).toBeTruthy();
  expect(screen.queryByText(t('devices.loadFailed'))).toBeNull();
  fireEvent.click(categorySwitch('Push on this device is on'));
  expect(push.disable).toHaveBeenCalledTimes(1);
});

describe('PushDevicesSection — "disable not confirmed" (row 79, US-3)', () => {
  const THIS = { id: 'dev-this', endpointHash: CURRENT_HASH, ua: '', createdAt: '2026-06-01T10:00:00Z', lastSeenAt: '2026-06-01T10:00:00Z', deviceLabel: null, version: 1 };

  test('shown while the disable is unconfirmed and this device is still listed (also as read after a reload); its retry disables again', () => {
    push.state = decided({ devices: [THIS] }, { state: 'off', offUnconfirmed: true });
    renderSection();

    const retry = screen.getByRole('button', { name: t('device.offUnconfirmedRetry') });
    fireEvent.click(retry);
    expect(push.disable).toHaveBeenCalledTimes(1);
  });

  test.each([
    { case: 'this device is no longer listed', devices: [] as PushDevice[], consent: { state: 'off' as const, offUnconfirmed: true } },
    { case: 'the disable is confirmed', devices: [THIS], consent: { state: 'off' as const, offUnconfirmed: false } },
  ])('hidden when $case', ({ devices, consent }) => {
    push.state = decided({ devices }, consent);
    renderSection();
    expect(screen.queryByRole('button', { name: t('device.offUnconfirmedRetry') })).toBeNull();
  });
});

describe('PushDevicesSection — push-service-error help callout (sk-62.3.7)', () => {
  test('an enable the browser could not complete shows the help callout', async () => {
    push.enable.mockResolvedValue({ kind: 'failed', reason: 'channel' });
    renderSection();

    fireEvent.click(categorySwitch('Turn on push on this device'));

    await waitFor(() =>
      expect(screen.getByText(/couldn't reach its push service/i)).toBeTruthy(),
    );
    expect(push.enable).toHaveBeenCalledTimes(1);
  });

  test('no callout on a successful enable', async () => {
    renderSection();

    fireEvent.click(categorySwitch('Turn on push on this device'));

    await waitFor(() => expect(push.enable).toHaveBeenCalledTimes(1));
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
  const DEVICES: PushDevice[] = [
    {
      id: 'dev-other',
      endpointHash: 'other-hash',
      ua: FIREFOX_UA,
      createdAt: '2026-06-01T10:00:00Z',
      lastSeenAt: '2026-06-02T10:00:00Z',
      deviceLabel: 'dddddddd-0000-4000-8000-000000000004',
      version: 1,
    },
    {
      id: 'dev-current',
      endpointHash: CURRENT_HASH,
      ua: CHROME_UA,
      createdAt: '2026-06-03T10:00:00Z',
      lastSeenAt: '2026-06-04T10:00:00Z',
      deviceLabel: 'aaaaaaaa-0000-4000-8000-000000000001',
      version: 1,
    },
  ];

  beforeEach(() => {
    push.state = decided({ devices: DEVICES }, { state: 'enabled', label: 'l', labels: ['l'] });
  });

  test('current device shows the badge, renders a readable UA, and sorts to the top', () => {
    renderSection();

    expect(screen.getByText('this device')).toBeTruthy();

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
    // the device in its accessible name, so a screen-reader user can tell
    // which device they are about to remove.
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

  test('the devices are a list, one listitem per device', () => {
    renderSection();
    // A homogeneous set of revocable rows is a list: AT announces "list,
    // N items" and can walk it.
    const list = screen.getByRole('list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(DEVICES.length);
  });

  test("a non-current row's Unsubscribe removes that device by id (POST /push/device-removals)", async () => {
    renderSection();

    fireEvent.click(deviceUnsubscribeButton('Firefox 151 · Windows'));

    await waitFor(() => expect(push.removeDevice).toHaveBeenCalledWith('dev-other'));
    expect(push.disable).not.toHaveBeenCalled();
  });

  test("the current row's Unsubscribe is the disable of this device (not the removal by id)", async () => {
    renderSection();

    fireEvent.click(deviceUnsubscribeButton('Chrome 149 · Windows'));

    await waitFor(() => expect(push.disable).toHaveBeenCalledTimes(1));
    expect(push.removeDevice).not.toHaveBeenCalled();
  });
});
