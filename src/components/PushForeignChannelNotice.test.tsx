/**
 * Row 77 — warning B (spec US-6): "notifications of the previous user may
 * still arrive" is shown while the controller holds an unconfirmed removal of
 * the previous user's channel by its endpoint; "Try again" repeats it; after
 * the server confirmed the removal the warning is gone.
 *
 * `PushProvider` runs the real controller. Substituted: only the push
 * transport (`api/push.ts`, a model of the server's push contract) and the
 * browser adapter. The warning is found by role and accessible name.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { RemoveChannelArgs } from '../api/push';
import { noteLogin, noteSignedOut } from '../auth/appearance';
import i18n from '../i18n/config';
import {
  A,
  addSub,
  B,
  browser,
  channel,
  FakeLocks,
  installPushHarness,
  LABEL_A,
  model,
  server,
  settle,
  uninstallPushHarness,
} from '../test/pushHarness';

const api = vi.hoisted(() => ({
  getPushConfig: vi.fn(),
  pushListDevices: vi.fn(),
  pushSubscribe: vi.fn(),
  pushRemoveChannel: vi.fn(),
  pushRevokeDevices: vi.fn(),
  pushRemoveDevice: vi.fn(),
}));

vi.mock('../api/push', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/push')>()),
  ...api,
}));

const browserApi = vi.hoisted(() => ({
  browserPushSupported: vi.fn(),
  readChannel: vi.fn(),
  createChannel: vi.fn(),
  removeChannel: vi.fn(),
  notificationPermission: vi.fn(),
}));

vi.mock('../lib/push/browserPush', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/push/browserPush')>()),
  ...browserApi,
}));

import { PushProvider } from '../lib/push/PushProvider';
import { PushForeignChannelNotice } from './PushForeignChannelNotice';

let locks: FakeLocks;

const warning = () => screen.queryByRole('region', { name: i18n.t('chrome:push.foreignAria') });

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

describe('row 77 — warning B', () => {
  test('shown while the removal by endpoint is unconfirmed; "Try again" repeats it; gone after ok', async () => {
    const a = channel('a');
    browser.channel = a;
    addSub(A, a.endpoint, LABEL_A);
    let serverAnswers = false;
    api.pushRemoveChannel.mockImplementation(async (args: RemoveChannelArgs) =>
      serverAnswers ? model.removeChannel(args) : { kind: 'lost' },
    );
    render(
      <MantineProvider>
        <PushProvider>
          <PushForeignChannelNotice />
        </PushProvider>
      </MantineProvider>,
    );

    server.caller = B;
    await act(async () => {
      noteLogin(B);
      await settle(locks);
    });
    expect(warning()).not.toBeNull();
    expect(api.pushRemoveChannel).toHaveBeenCalledTimes(1);

    serverAnswers = true;
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: i18n.t('chrome:push.foreignRetry') }));
      await settle(locks);
    });

    expect(api.pushRemoveChannel).toHaveBeenCalledTimes(2);
    expect(api.pushRemoveChannel.mock.calls[1][0]).toEqual({ expectedUserId: B, endpoint: a.endpoint });
    expect(warning()).toBeNull();
    expect(server.subs).toEqual([]);
  });
});
