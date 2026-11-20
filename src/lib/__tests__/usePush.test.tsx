/**
 * Row 78 — usePush registers nothing on mount (spec problem 2, INV-2).
 *
 * Expected: no instance of `usePush`, mounted with the permission `granted`
 * and a live channel, registers or sends any push request — the page used to
 * re-POST the live subscription on every load. Its actions are the explicit
 * actions of the push controller: enable registers with the expected user,
 * disable revokes this device, removing another device removes it by id.
 *
 * Substituted: the push transport (`api/push.ts`, a model of the server's push
 * contract) and the browser adapter `browserPush.ts`. Real: the controller,
 * the locks over a substituted `navigator.locks`, the push state, the
 * appearance store.
 */
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { noteLogin, noteSignedOut } from '../../auth/appearance';
import {
  A,
  addSub,
  browser,
  channel,
  enabledConsent,
  FakeLocks,
  installPushHarness,
  LABEL_A,
  seed,
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

vi.mock('../push/browserPush', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../push/browserPush')>()),
  ...browserApi,
}));

import { usePush, type UsePushResult } from '../usePush';

let locks: FakeLocks;
const hosts: Array<UsePushResult | null> = [];

function Host({ index }: { index: number }) {
  hosts[index] = usePush();
  return null;
}

const allPushCalls = () =>
  api.pushListDevices.mock.calls.length +
  api.pushSubscribe.mock.calls.length +
  api.pushRemoveChannel.mock.calls.length +
  api.pushRevokeDevices.mock.calls.length +
  api.pushRemoveDevice.mock.calls.length;

beforeEach(() => {
  locks = new FakeLocks();
  installPushHarness(api, browserApi, locks);
  hosts.length = 0;
  server.caller = A;
  noteLogin(A);
});

afterEach(async () => {
  cleanup();
  noteSignedOut();
  await settle(locks);
  uninstallPushHarness();
});

describe('row 78 — usePush', () => {
  test('mounted three times with permission granted and a live channel: no registration, no push request', async () => {
    const a = channel('a');
    browser.channel = a;
    browser.permission = 'granted';
    addSub(A, a.endpoint, LABEL_A);
    seed({ [A]: enabledConsent(LABEL_A, a, null) });

    render(
      <>
        <Host index={0} />
        <Host index={1} />
        <Host index={2} />
      </>,
    );
    await act(async () => {
      await settle(locks);
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(hosts.filter((h) => h !== null)).toHaveLength(3);
    expect(allPushCalls()).toBe(0);
    expect(api.getPushConfig).not.toHaveBeenCalled();
    expect(browserApi.createChannel).not.toHaveBeenCalled();
  });

  test('enable is the explicit enable: it registers as the expected user', async () => {
    render(<Host index={0} />);

    await act(async () => {
      expect(await hosts[0]!.enable()).toEqual({ kind: 'done' });
    });

    expect(api.pushSubscribe).toHaveBeenCalledTimes(1);
    expect(api.pushSubscribe.mock.calls[0][0]).toMatchObject({ expectedUserId: A, mode: 'upsert' });
  });

  test('disable revokes this device; removing another device removes it by id', async () => {
    const a = channel('a');
    browser.channel = a;
    addSub(A, a.endpoint, LABEL_A);
    const other = addSub(A, channel('d2').endpoint, 'dddddddd-0000-4000-8000-000000000004');
    seed({ [A]: enabledConsent(LABEL_A, a, null) });
    render(<Host index={0} />);

    await act(async () => {
      expect(await hosts[0]!.removeDevice(other.id)).toEqual({ kind: 'done' });
    });
    expect(api.pushRemoveDevice).toHaveBeenCalledWith({ expectedUserId: A, id: other.id }, expect.any(AbortSignal));

    await act(async () => {
      expect(await hosts[0]!.disable()).toEqual({ kind: 'done' });
    });
    expect(api.pushRevokeDevices).toHaveBeenCalledWith(
      { expectedUserId: A, deviceLabels: [LABEL_A], endpoint: a.endpoint },
      expect.any(AbortSignal),
    );
    expect(browser.channel).toBeNull();
  });
});
