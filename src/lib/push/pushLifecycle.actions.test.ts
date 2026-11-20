/**
 * Rows 56–62 — the explicit push actions of the controller (spec US-1, US-3,
 * US-4 "an enable started before the logout"; composition rules 4, 7, 8;
 * Edge 8, 10; plan "Key decisions": S, `gen`, one revocation request, the
 * permission prompt as the first `await`).
 *
 * Substituted: the push transport (`api/push.ts`, a model of the server's
 * push contract) and the browser adapter `browserPush.ts`. Real: the locks
 * over a substituted `navigator.locks`, the push state over jsdom's
 * localStorage, the decision, the appearance store. A "tab" is a fresh
 * module graph of the controller and the appearance store; two tabs share
 * the storage and the locks, as two tabs of one browser do.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { RevokeDevicesArgs, SubscribeArgs } from '../../api/push';
import {
  A,
  addSub,
  B,
  browser,
  channel,
  enabledConsent,
  FakeLocks,
  installPushHarness,
  LABEL_A,
  model,
  seed,
  server,
  settle as settleLocks,
  uninstallPushHarness,
} from '../../test/pushHarness';
import type { NotificationPermissionState } from './browserPush';
import { PUSH_STATE_KEY, readConsent, readPushState, revokeConsent } from './pushState';

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

interface Tab {
  lifecycle: typeof import('./pushLifecycle');
  appearance: typeof import('../../auth/appearance');
}

let locks: FakeLocks;
const tabs: Tab[] = [];

const settle = () => settleLocks(locks);

/**
 * Opens a tab where `userId` has appeared. `start` also runs the
 * controller's decisions on appearances; an action needs only the appearance.
 */
async function openTab(userId: string, start = false): Promise<Tab> {
  vi.resetModules();
  const tab: Tab = {
    lifecycle: await import('./pushLifecycle'),
    appearance: await import('../../auth/appearance'),
  };
  tabs.push(tab);
  server.caller = userId;
  tab.appearance.noteLogin(userId);
  if (start) tab.lifecycle.startPushLifecycle();
  await settle();
  return tab;
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const allPushCalls = () =>
  api.pushListDevices.mock.calls.length +
  api.pushSubscribe.mock.calls.length +
  api.pushRemoveChannel.mock.calls.length +
  api.pushRevokeDevices.mock.calls.length +
  api.pushRemoveDevice.mock.calls.length;

const revocationBodies = () => api.pushRevokeDevices.mock.calls.map((c) => c[0] as RevokeDevicesArgs);
const subscribeBodies = () => api.pushSubscribe.mock.calls.map((c) => c[0] as SubscribeArgs);

beforeEach(() => {
  locks = new FakeLocks();
  installPushHarness(api, browserApi, locks);
});

afterEach(async () => {
  for (const tab of tabs) {
    tab.lifecycle.stopPushLifecycle();
    tab.appearance.noteSignedOut();
  }
  tabs.length = 0;
  await settle();
  vi.restoreAllMocks();
  uninstallPushHarness();
});

// ───────────────────────── Row 56 ─────────────────────────

describe('row 56 — the revocation boundary against an enable (rule 8, Edge 8)', () => {
  test('(a) the enable waits for the lock while a disable in another tab passes: no label, no registration', async () => {
    const tab1 = await openTab(A);
    const tab2 = await openTab(A);
    const list = deferred<void>();
    api.pushListDevices.mockImplementationOnce(async (userId: string) => {
      await list.promise;
      return model.list(userId);
    });

    // The disable holds `skein.push.op` from its call; the enable queues behind it.
    const disabling = tab2.lifecycle.disablePush();
    const enabling = tab1.lifecycle.enablePush();
    list.resolve();

    expect(await disabling).toEqual({ kind: 'done' });
    expect(await enabling).toEqual({ kind: 'superseded' });
    expect(readConsent(A)).toMatchObject({ state: 'off', gen: 1, labels: [] });
    expect(api.pushSubscribe).not.toHaveBeenCalled();
    expect(browserApi.createChannel).not.toHaveBeenCalled();
  });

  test('(a) the enable waits for the confirmation while a revocation passes: no label, no registration', async () => {
    const tab = await openTab(A);
    api.pushListDevices.mockImplementationOnce(async (userId: string) => {
      const listed = await model.list(userId);
      // A logout in another tab: the revocation transition, under the store lock only.
      await revokeConsent(A, { endpoint: null, guard: 'unconfirmed' });
      return listed;
    });

    expect(await tab.lifecycle.enablePush()).toEqual({ kind: 'superseded' });
    expect(readConsent(A)).toMatchObject({ state: 'off', labels: [] });
    expect(api.pushSubscribe).not.toHaveBeenCalled();
  });

  test('(b) a registration sent before the revocation and answered after it: no "enabled", its label is in the revocation work', async () => {
    const tab = await openTab(A);
    api.pushSubscribe.mockImplementationOnce(async (args: SubscribeArgs) => {
      const answer = await model.subscribe(args);
      await revokeConsent(A, { endpoint: args.endpoint, guard: 'unconfirmed' });
      return answer;
    });

    expect(await tab.lifecycle.enablePush()).toEqual({ kind: 'superseded' });
    const sentLabel = subscribeBodies()[0].deviceLabel;
    expect(readConsent(A)).toMatchObject({ state: 'off', labels: [], label: null });
    const revocations = readPushState().works.filter((w) => w.type === 'deviceRevoke');
    expect(revocations).toHaveLength(1);
    expect(revocations[0]).toMatchObject({ ownerUserId: A, labels: [sentLabel] });

    // (c) An enable after the revocation: the new generation, a new label.
    const genAfterRevocation = readConsent(A).gen;
    expect(await tab.lifecycle.enablePush()).toEqual({ kind: 'done' });
    const enabled = readConsent(A);
    expect(enabled).toMatchObject({ state: 'enabled', gen: genAfterRevocation, pending: null });
    expect(enabled.label).not.toBe(sentLabel);
    expect(subscribeBodies()[1].deviceLabel).toBe(enabled.label);
  });
});

// ───────────────────────── Row 57 ─────────────────────────

describe('row 57 — the appearance grows after the click: no effect', () => {
  test.each([
    { how: 'a new login of the same user', change: (tab: Tab) => tab.appearance.noteLogin(A) },
    {
      how: '/me answering another user',
      change: (tab: Tab) => {
        server.caller = B;
        tab.appearance.noteMeAnswer(B, A, 'load');
      },
    },
    {
      how: '/me after null',
      change: (tab: Tab) => {
        tab.appearance.noteSignedOut();
        tab.appearance.noteMeAnswer(A, null, 'load');
      },
    },
  ])('$how during the permission prompt', async ({ change }) => {
    browser.channel = channel('a');
    seed({ [A]: { state: 'off', endpoint: channel('a').endpoint } });
    const tab = await openTab(A);
    browser.permission = 'default';
    const answer = deferred<NotificationPermissionState>();
    browserApi.requestNotificationPermission.mockImplementationOnce(() => answer.promise);
    const stateBefore = localStorage.getItem(PUSH_STATE_KEY);

    const enabling = tab.lifecycle.enablePush();
    change(tab);
    answer.resolve('granted');

    expect(await enabling).toEqual({ kind: 'superseded' });
    expect(localStorage.getItem(PUSH_STATE_KEY)).toBe(stateBefore);
    expect(allPushCalls()).toBe(0);
    expect(browserApi.removeChannel).not.toHaveBeenCalled();
    expect(browserApi.createChannel).not.toHaveBeenCalled();
  });

  test('a new login of the same user after the confirmation: no state write, no further request, no channel removal', async () => {
    browser.channel = channel('a');
    seed({ [A]: { state: 'off', endpoint: channel('a').endpoint } });
    const tab = await openTab(A);
    api.pushListDevices.mockImplementationOnce(async (userId: string) => {
      const listed = await model.list(userId);
      tab.appearance.noteLogin(A);
      return listed;
    });
    const stateBefore = localStorage.getItem(PUSH_STATE_KEY);

    expect(await tab.lifecycle.disablePush()).toEqual({ kind: 'superseded' });
    expect(localStorage.getItem(PUSH_STATE_KEY)).toBe(stateBefore);
    expect(allPushCalls()).toBe(1);
    expect(browserApi.removeChannel).not.toHaveBeenCalled();
  });
});

// ───────────────────────── Row 58 ─────────────────────────

describe('row 58 — the permission prompt (US-1)', () => {
  test('default → granted: the prompt is made in the click, before any lock and any request', async () => {
    const tab = await openTab(A);
    browser.permission = 'default';
    let locksAtPrompt = -1;
    let callsAtPrompt = -1;
    browserApi.requestNotificationPermission.mockImplementationOnce(async () => {
      locksAtPrompt = locks.requests.length;
      callsAtPrompt = allPushCalls();
      return 'granted';
    });
    const locksBefore = locks.requests.length;

    const enabling = tab.lifecycle.enablePush();
    expect(browserApi.requestNotificationPermission).toHaveBeenCalledTimes(1);

    expect(await enabling).toEqual({ kind: 'done' });
    expect(locksAtPrompt).toBe(locksBefore);
    expect(callsAtPrompt).toBe(0);
    expect(readConsent(A)).toMatchObject({ state: 'enabled', pending: null });
  });

  test('default → denied: neither a lock nor a request', async () => {
    const tab = await openTab(A);
    browser.permission = 'default';
    browserApi.requestNotificationPermission.mockImplementationOnce(async () => 'denied');
    const locksBefore = locks.requests.length;

    expect(await tab.lifecycle.enablePush()).toEqual({ kind: 'denied' });
    expect(locks.requests.length).toBe(locksBefore);
    expect(allPushCalls()).toBe(0);
    expect(api.getPushConfig).not.toHaveBeenCalled();
    expect(localStorage.getItem(PUSH_STATE_KEY)).toBeNull();
  });
});

// ───────────────────────── Row 59 ─────────────────────────

describe('row 59 — outcomes of an enable (US-1, Edge 10)', () => {
  test('the new label is in the consent, enabled and unconfirmed, before the registration; ok confirms it', async () => {
    const tab = await openTab(A);
    let atRegistration: ReturnType<typeof readConsent> | null = null;
    api.pushSubscribe.mockImplementationOnce(async (args: SubscribeArgs) => {
      atRegistration = readConsent(A);
      return model.subscribe(args);
    });

    expect(await tab.lifecycle.enablePush()).toEqual({ kind: 'done' });
    const label = subscribeBodies()[0].deviceLabel;
    expect(atRegistration).toMatchObject({ state: 'enabled', label, labels: [label], pending: { label, kind: 'enable' } });
    expect(subscribeBodies()[0]).toMatchObject({ expectedUserId: A, mode: 'upsert' });
    expect(readConsent(A)).toMatchObject({ state: 'enabled', label, pending: null, endpoint: browser.channel!.endpoint });
  });

  test.each([
    { case: "another user's channel", consent: {}, listedOwner: null as string | null, replaced: true },
    { case: 'a revoked channel of this device', consent: { state: 'off' as const, endpoint: channel('x').endpoint }, listedOwner: A, replaced: true },
    { case: "the user's own listed channel", consent: {}, listedOwner: A, replaced: false },
  ])('the channel is new for $case, otherwise kept', async ({ consent, listedOwner, replaced }) => {
    const x = channel('x');
    browser.channel = x;
    if (listedOwner !== null) addSub(listedOwner, x.endpoint, null);
    seed({ [A]: consent });
    const tab = await openTab(A);

    expect(await tab.lifecycle.enablePush()).toEqual({ kind: 'done' });
    expect(browserApi.createChannel).toHaveBeenCalledTimes(replaced ? 1 : 0);
    expect(subscribeBodies()[0].endpoint === x.endpoint).toBe(!replaced);
    if (replaced) expect(browserApi.removeChannel).toHaveBeenCalledWith(x.endpoint);
  });

  test('"revoked" turns the consent off and removes the channel', async () => {
    const tab = await openTab(A);
    api.pushSubscribe.mockImplementationOnce(async () => ({ kind: 'revoked' }));

    expect(await tab.lifecycle.enablePush()).toEqual({ kind: 'failed', reason: 'revoked' });
    expect(readConsent(A).state).toBe('off');
    expect(browser.channel).toBeNull();
  });

  test.each(['refused', 'taken', 'notFound'] as const)('a definite refusal (%s) goes back to no mark with an error; the label stays in S', async (kind) => {
    const tab = await openTab(A);
    api.pushSubscribe.mockImplementationOnce(async () => ({ kind }));

    expect(await tab.lifecycle.enablePush()).toEqual({ kind: 'failed', reason: 'refused' });
    const label = subscribeBodies()[0].deviceLabel;
    expect(readConsent(A)).toMatchObject({ state: 'none', label: null, pending: null, labels: [label] });
  });

  test.each(['lost', 'sessionEnded'] as const)('%s leaves the consent unconfirmed', async (kind) => {
    const tab = await openTab(A);
    api.pushSubscribe.mockImplementationOnce(async () => ({ kind }));

    expect(await tab.lifecycle.enablePush()).toEqual({ kind: 'failed', reason: 'unconfirmed' });
    const label = subscribeBodies()[0].deviceLabel;
    expect(readConsent(A)).toMatchObject({ state: 'enabled', label, pending: { label, kind: 'enable' } });
  });

  test('the consent cannot be written after ok: the label is revoked, the channel removed, an error shown', async () => {
    const tab = await openTab(A);
    let failWrites = false;
    const setItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (failWrites) throw new DOMException('quota', 'QuotaExceededError');
      setItem.call(this, key, value);
    });
    api.pushSubscribe.mockImplementationOnce(async (args: SubscribeArgs) => {
      const answer = await model.subscribe(args);
      failWrites = true;
      return answer;
    });

    expect(await tab.lifecycle.enablePush()).toEqual({ kind: 'failed', reason: 'storage' });
    const sent = subscribeBodies()[0];
    expect(revocationBodies()).toEqual([{ expectedUserId: A, deviceLabels: [sent.deviceLabel], endpoint: sent.endpoint }]);
    expect(browser.channel).toBeNull();
    expect(server.subs).toEqual([]);
  });
});

// ───────────────────────── Row 60 ─────────────────────────

describe('row 60 — S on the wire', () => {
  test('labels of a refused enable, an abandoned accept and an enable with a lost answer are all revoked by one request', async () => {
    const x = channel('x');
    browser.channel = x;
    const tab = await openTab(A, true);

    // 1. An enable refused by the server.
    api.pushSubscribe.mockImplementationOnce(async () => ({ kind: 'refused' }));
    expect(await tab.lifecycle.enablePush()).toEqual({ kind: 'failed', reason: 'refused' });
    // 2. An accept of an existing subscription (row 6) that disappeared meanwhile.
    browser.channel = x;
    addSub(A, x.endpoint, null);
    api.pushSubscribe.mockImplementationOnce(async () => ({ kind: 'notFound' }));
    await tab.lifecycle.repeatPushDecision();
    expect(readConsent(A).state).toBe('none');
    // 3. An enable whose answer is lost.
    api.pushSubscribe.mockImplementationOnce(async () => ({ kind: 'lost' }));
    expect(await tab.lifecycle.enablePush()).toEqual({ kind: 'failed', reason: 'unconfirmed' });

    const sentLabels = subscribeBodies().map((b) => b.deviceLabel);
    expect(new Set(sentLabels).size).toBe(3);
    expect(new Set(readConsent(A).labels)).toEqual(new Set(sentLabels));

    api.pushRevokeDevices.mockClear();
    await tab.lifecycle.disablePush();

    expect(revocationBodies()).toHaveLength(1);
    expect(new Set(revocationBodies()[0].deviceLabels)).toEqual(new Set(sentLabels));
  });

  test('with |S| = 1000 an enable fails without a new label; the disable sends all 1000 labels in one request', async () => {
    const labels = Array.from({ length: 1000 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    seed({ [A]: { state: 'none', labels } });
    const tab = await openTab(A);

    expect(await tab.lifecycle.enablePush()).toEqual({ kind: 'failed', reason: 'labelLimit' });
    expect(api.pushSubscribe).not.toHaveBeenCalled();
    expect(readConsent(A).labels).toHaveLength(1000);

    await tab.lifecycle.disablePush();

    expect(revocationBodies()).toHaveLength(1);
    expect(new Set(revocationBodies()[0].deviceLabels)).toEqual(new Set(labels));
  });

  test('a series of lost revocation answers does not grow S; the next enable adds one label', async () => {
    const x = channel('x');
    browser.channel = x;
    addSub(A, x.endpoint, LABEL_A);
    seed({ [A]: enabledConsent(LABEL_A, x, null) });
    const tab = await openTab(A);
    api.pushRevokeDevices.mockImplementation(async () => ({ kind: 'lost' }));

    for (let i = 0; i < 3; i += 1) {
      expect(await tab.lifecycle.disablePush()).toEqual({ kind: 'failed', reason: 'unconfirmed' });
      expect(readConsent(A).labels).toEqual([]);
    }

    api.pushRevokeDevices.mockImplementation(model.revokeDevices);
    expect(await tab.lifecycle.enablePush()).toEqual({ kind: 'done' });
    expect(readConsent(A).labels).toHaveLength(1);
  });
});

// ───────────────────────── Row 61 ─────────────────────────

describe('row 61 — disable on this device (US-3)', () => {
  test('confirmation by the list, the revocation of S and the endpoint, then the channel; ok finishes the work', async () => {
    const x = channel('x');
    browser.channel = x;
    addSub(A, x.endpoint, LABEL_A);
    seed({ [A]: enabledConsent(LABEL_A, x, null) });
    const tab = await openTab(A);

    expect(await tab.lifecycle.disablePush()).toEqual({ kind: 'done' });
    expect(api.pushListDevices.mock.invocationCallOrder[0]).toBeLessThan(api.pushRevokeDevices.mock.invocationCallOrder[0]);
    expect(revocationBodies()).toEqual([{ expectedUserId: A, deviceLabels: [LABEL_A], endpoint: x.endpoint }]);
    expect(browserApi.removeChannel).toHaveBeenCalledWith(x.endpoint);
    expect(browserApi.removeChannel.mock.invocationCallOrder[0]).toBeGreaterThan(api.pushRevokeDevices.mock.invocationCallOrder[0]);
    expect(browser.channel).toBeNull();
    expect(readPushState().works).toEqual([]);
    expect(readConsent(A)).toMatchObject({ state: 'off', gen: 1, offUnconfirmed: false });
    expect(server.subs).toEqual([]);
  });

  test('a server refusal keeps "explicitly off" and "disable not confirmed"; the work carries the guard of the list', async () => {
    const x = channel('x');
    browser.channel = x;
    const sub = addSub(A, x.endpoint, LABEL_A);
    seed({ [A]: enabledConsent(LABEL_A, x, null) });
    const tab = await openTab(A);
    api.pushRevokeDevices.mockImplementationOnce(async () => ({ kind: 'lost' }));

    expect(await tab.lifecycle.disablePush()).toEqual({ kind: 'failed', reason: 'unconfirmed' });
    expect(readConsent(A)).toMatchObject({ state: 'off', offUnconfirmed: true });
    expect(readPushState().works).toEqual([
      expect.objectContaining({ type: 'deviceRevoke', ownerUserId: A, labels: [LABEL_A], endpoint: x.endpoint, guard: { id: sub.id, version: sub.version } }),
    ]);
  });

  test('an unlabelled subscription of this device is revoked by the endpoint of the current channel', async () => {
    const x = channel('x');
    browser.channel = x;
    addSub(A, x.endpoint, null);
    const tab = await openTab(A);

    expect(await tab.lifecycle.disablePush()).toEqual({ kind: 'done' });
    expect(revocationBodies()).toEqual([{ expectedUserId: A, deviceLabels: [], endpoint: x.endpoint }]);
    expect(server.subs).toEqual([]);
    expect(readConsent(A).state).toBe('off');
  });

  test('empty S and an unread channel: off, gen + 1, not confirmed, no work, no request; after a reload row 7 removes it by its endpoint', async () => {
    const x = channel('x');
    browser.channel = x;
    browser.readFails = true;
    addSub(A, x.endpoint, null);
    const tab = await openTab(A);

    expect(await tab.lifecycle.disablePush()).toEqual({ kind: 'failed', reason: 'unconfirmed' });
    expect(readConsent(A)).toMatchObject({ state: 'off', gen: 1, offUnconfirmed: true });
    expect(readPushState().works).toEqual([]);
    expect(api.pushRevokeDevices).not.toHaveBeenCalled();

    // A reload: the channel is readable again.
    browser.readFails = false;
    await openTab(A, true);

    expect(revocationBodies()).toEqual([{ expectedUserId: A, deviceLabels: [], endpoint: x.endpoint }]);
    expect(api.pushSubscribe).not.toHaveBeenCalled();
    expect(server.subs).toEqual([]);
    expect(browser.channel).toBeNull();
    expect(readConsent(A)).toMatchObject({ state: 'off', offUnconfirmed: false });
  });
});

// ───────────────────────── Row 62 ─────────────────────────

describe('row 62 — removal of another device (US-3)', () => {
  test('sends the removal by id with the expected user; the consent and the channel here do not change', async () => {
    const x = channel('x');
    browser.channel = x;
    addSub(A, x.endpoint, LABEL_A);
    const other = addSub(A, channel('d2').endpoint, 'dddddddd-0000-4000-8000-000000000004');
    seed({ [A]: enabledConsent(LABEL_A, x, null) });
    const tab = await openTab(A);
    const stateBefore = localStorage.getItem(PUSH_STATE_KEY);

    expect(await tab.lifecycle.removeOtherDevice(other.id)).toEqual({ kind: 'done' });
    expect(api.pushRemoveDevice).toHaveBeenCalledWith({ expectedUserId: A, id: other.id }, expect.any(AbortSignal));
    expect(localStorage.getItem(PUSH_STATE_KEY)).toBe(stateBefore);
    expect(browser.channel).toEqual(x);
    expect(server.subs.map((s) => s.endpoint)).toEqual([x.endpoint]);
  });
});
