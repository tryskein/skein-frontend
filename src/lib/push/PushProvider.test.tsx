/**
 * Rows 76, 76a — the push UI follows the appearance (spec rule 5 for the UI,
 * US-12; plan "Key decisions": the UI state is keyed by the appearance token
 * and reset synchronously when it changes).
 *
 * `PushProvider` runs the real controller; the real `PushSoftAsk` and
 * `PushForeignChannelNotice` render from it. Substituted: only the push
 * transport (`api/push.ts`, a model of the server's push contract) and the
 * browser adapter `browserPush.ts`. Real: the locks over a substituted
 * `navigator.locks`, the push state, the decision, the appearance store.
 * The banner and the warning are found by role and accessible name.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { PushDevice, PushOutcome } from '../../api/push';
import { noteLogin, noteSignedOut } from '../../auth/appearance';
import i18n from '../../i18n/config';
import {
  A,
  B,
  browser,
  channel,
  FakeLocks,
  installPushHarness,
  model,
  server,
  settle,
  uninstallPushHarness,
} from '../../test/pushHarness';

const api = vi.hoisted(() => ({
  getPushConfig: vi.fn(),
  pushListDevices: vi.fn(),
  pushSubscribe: vi.fn(),
  pushRemoveChannel: vi.fn(),
  pushRevokeDevices: vi.fn(),
  pushRemoveDevice: vi.fn(),
}));

vi.mock('../../api/push', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/push')>()),
  ...api,
}));

const browserApi = vi.hoisted(() => ({
  browserPushSupported: vi.fn(),
  readChannel: vi.fn(),
  createChannel: vi.fn(),
  removeChannel: vi.fn(),
  notificationPermission: vi.fn(),
  requestNotificationPermission: vi.fn(),
}));

vi.mock('./browserPush', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./browserPush')>()),
  ...browserApi,
}));

import { PushForeignChannelNotice } from '../../components/PushForeignChannelNotice';
import { PushSoftAsk } from '../../components/PushSoftAsk';
import { PushProvider } from './PushProvider';

let locks: FakeLocks;

const banner = () => screen.queryByRole('region', { name: i18n.t('chrome:push.aria') });
const warning = () => screen.queryByRole('region', { name: i18n.t('chrome:push.foreignAria') });

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function mount(): void {
  render(
    <MantineProvider>
      <PushProvider>
        <PushForeignChannelNotice />
        <PushSoftAsk />
      </PushProvider>
    </MantineProvider>,
  );
}

async function appear(userId: string): Promise<void> {
  server.caller = userId;
  await act(async () => {
    noteLogin(userId);
  });
}

async function settled(): Promise<void> {
  await act(async () => {
    await settle(locks);
  });
}

beforeEach(() => {
  locks = new FakeLocks();
  installPushHarness(api, browserApi, locks);
});

afterEach(async () => {
  cleanup();
  noteSignedOut();
  await settle(locks);
  uninstallPushHarness();
});

describe('row 76 — right after another appearance nothing of the previous one is shown', () => {
  test('the banner and the warning of A are gone as soon as B appears', async () => {
    // A appears in a browser with the previous user's channel; its removal on
    // the server is not confirmed: A sees the warning and the banner.
    browser.channel = channel('previous');
    api.pushRemoveChannel.mockImplementation(async () => ({ kind: 'lost' }));
    mount();
    await appear(A);
    await settled();
    expect(warning()).not.toBeNull();
    expect(banner()).not.toBeNull();

    // B appears; B's list has not been read yet.
    api.pushListDevices.mockImplementationOnce(
      (_userId: string, signal: AbortSignal) =>
        new Promise((resolve) => signal.addEventListener('abort', () => resolve({ kind: 'lost' }))),
    );
    await appear(B);

    expect(warning()).toBeNull();
    expect(banner()).toBeNull();
  });
});

describe('row 76a — the banner through the real controller', () => {
  test('hidden until the list of this appearance is read, shown after the decision', async () => {
    const list = deferred<PushOutcome<PushDevice[]>>();
    api.pushListDevices.mockImplementationOnce(() => list.promise);
    mount();
    await appear(A);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(banner()).toBeNull();

    await act(async () => {
      list.resolve(await model.list(A));
    });
    await settled();
    expect(banner()).not.toBeNull();
  });

  test.each(['lost', 'sessionEnded'] as const)('the list read is %s (row 1): no banner', async (kind) => {
    api.pushListDevices.mockImplementationOnce(async () => ({ kind }));
    mount();
    await appear(A);
    await settled();
    expect(banner()).toBeNull();
  });

  test('"Yes" enables push for the current user', async () => {
    mount();
    await appear(A);
    await settled();

    fireEvent.click(screen.getByRole('button', { name: i18n.t('chrome:push.yes') }));
    await settled();

    expect(api.pushSubscribe).toHaveBeenCalledTimes(1);
    expect(api.pushSubscribe.mock.calls[0][0]).toMatchObject({ expectedUserId: A, mode: 'upsert' });
    expect(banner()).toBeNull();
  });

  test('"Not now" hides it from this user; B, appearing next, gets it after the read of B\'s list', async () => {
    mount();
    await appear(A);
    await settled();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('chrome:push.later') }));
    expect(banner()).toBeNull();

    await appear(B);
    await settled();
    expect(banner()).not.toBeNull();

    await appear(A);
    await settled();
    expect(banner()).toBeNull();
  });
});
