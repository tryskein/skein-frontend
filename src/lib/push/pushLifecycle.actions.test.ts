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
  sha256,
  uninstallPushHarness,
} from '../../test/pushHarness';
import type { NotificationPermissionState } from './browserPush';
import { PUSH_OP_LOCK, PUSH_STORE_LOCK } from './locks';
import { PUSH_STATE_KEY, readConsent, readPushState, retireConsent, revokeConsent, undoRevocation } from './pushState';

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

describe('row 57 — the appearance grows after the registration was accepted', () => {
  test('the enable is superseded, not a storage failure; the registration is not taken back', async () => {
    const tab = await openTab(A);
    let release: () => void = () => undefined;
    api.pushSubscribe.mockImplementationOnce(async (args: SubscribeArgs) => {
      const answer = await model.subscribe(args);
      // Another tab holds the store lock as the confirmation is about to be written.
      void locks.request(PUSH_STORE_LOCK, { mode: 'exclusive' }, () => new Promise<void>((r) => (release = r)));
      return answer;
    });

    const enabling = tab.lifecycle.enablePush();
    for (let i = 0; i < 20; i += 1) await new Promise((r) => setTimeout(r, 0));
    tab.appearance.noteLogin(A);
    release();

    expect(await enabling).toEqual({ kind: 'superseded' });
    expect(api.pushRevokeDevices).not.toHaveBeenCalled();
    const label = subscribeBodies()[0].deviceLabel;
    expect(readConsent(A)).toMatchObject({ state: 'enabled', label, pending: { label, kind: 'enable' } });
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
    if (replaced) expect(browserApi.removeChannel.mock.calls.map((c) => c[0])).toContain(x.endpoint);
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
    expect(browserApi.removeChannel.mock.calls.map((c) => c[0])).toContain(x.endpoint);
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

describe('row 61 — the current channel carries a label S does not have', () => {
  test('the revocation carries that label too; the labelled subscription is gone', async () => {
    const x = channel('x');
    browser.channel = x;
    addSub(A, x.endpoint, LABEL_A);
    // The consent that held LABEL_A was lost: no mark, empty S.
    const tab = await openTab(A);

    expect(await tab.lifecycle.disablePush()).toEqual({ kind: 'done' });
    expect(revocationBodies()).toEqual([{ expectedUserId: A, deviceLabels: [LABEL_A], endpoint: x.endpoint }]);
    expect(server.subs).toEqual([]);
    expect(readConsent(A)).toMatchObject({ state: 'off', offUnconfirmed: false });
  });

  test('with a full S that subscription is removed by id, which revokes its label', async () => {
    const x = channel('x');
    browser.channel = x;
    const sub = addSub(A, x.endpoint, LABEL_A);
    const labels = Array.from({ length: 1000 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    seed({ [A]: { state: 'none', labels } });
    const tab = await openTab(A);

    expect(await tab.lifecycle.disablePush()).toEqual({ kind: 'done' });
    expect(revocationBodies()).toHaveLength(1);
    expect(revocationBodies()[0].deviceLabels).toHaveLength(1000);
    expect(api.pushRemoveDevice).toHaveBeenCalledWith({ expectedUserId: A, id: sub.id }, expect.any(AbortSignal));
    expect(server.subs).toEqual([]);
  });
});

describe('row 61 — the removal by id of a full S is recorded with the revocation', () => {
  test('a failed removal by id is repeated by the next appearance of the owner, which removes the subscription', async () => {
    const x = channel('x');
    browser.channel = x;
    const sub = addSub(A, x.endpoint, LABEL_A);
    const labels = Array.from({ length: 1000 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    seed({ [A]: { state: 'none', labels } });
    const tab = await openTab(A);
    api.pushRemoveDevice.mockImplementationOnce(async () => ({ kind: 'lost' }));

    expect(await tab.lifecycle.disablePush()).toEqual({ kind: 'failed', reason: 'unconfirmed' });
    expect(readPushState().works).toEqual([
      expect.objectContaining({ type: 'deviceRevoke', ownerUserId: A, removeSubscriptionId: sub.id }),
    ]);
    expect(server.subs).toHaveLength(1);

    // A reload: the owner appears again.
    await openTab(A, true);

    expect(api.pushRemoveDevice).toHaveBeenCalledTimes(2);
    expect(server.subs).toEqual([]);
    expect(readPushState().works).toEqual([]);
  });
});

describe('row 61 — the revocation transition is decided on the record under skein.push.store', () => {
  test('S filled up while the transition waited for the lock: the subscription outside S is removed by id', async () => {
    const x = channel('x');
    browser.channel = x;
    const sub = addSub(A, x.endpoint, LABEL_A);
    const labels = Array.from({ length: 999 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    seed({ [A]: { state: 'none', labels } });
    const tab = await openTab(A);

    const holder = deferred<void>();
    void locks.request(PUSH_STORE_LOCK, { mode: 'exclusive' }, () => holder.promise);
    const disabling = tab.lifecycle.disablePush();
    const waits = () => locks.requests.filter((name) => name === PUSH_STORE_LOCK).length >= 2;
    for (let i = 0; i < 200 && !waits(); i += 1) await new Promise((r) => setTimeout(r, 0));
    expect(waits()).toBe(true);
    // Another tab wrote one more label meanwhile: S holds 1000 now.
    seed({ [A]: { state: 'none', labels: [...labels, 'ffffffff-0000-4000-8000-000000000999'] } });
    holder.resolve();

    expect(await disabling).toEqual({ kind: 'done' });
    expect(revocationBodies()[0].deviceLabels).toHaveLength(1000);
    expect(revocationBodies()[0].deviceLabels).not.toContain(LABEL_A);
    expect(api.pushRemoveDevice).toHaveBeenCalledWith({ expectedUserId: A, id: sub.id }, expect.any(AbortSignal));
    expect(server.subs).toEqual([]);
  });

  test('"user changed" after the consent was written meanwhile: the undo changes nothing, the works stay', async () => {
    const x = channel('x');
    browser.channel = x;
    addSub(A, x.endpoint, LABEL_A);
    seed({ [A]: enabledConsent(LABEL_A, x, null) });
    const tab = await openTab(A);
    let written = '';
    api.pushRevokeDevices.mockImplementationOnce(async () => {
      // Another write of A's consent lands between the transition and the answer.
      const record = JSON.parse(localStorage.getItem(PUSH_STATE_KEY)!);
      record.consents[A].rev += 1;
      written = JSON.stringify(record);
      localStorage.setItem(PUSH_STATE_KEY, written);
      return { kind: 'userChanged' };
    });

    expect(await tab.lifecycle.disablePush()).toEqual({ kind: 'superseded' });
    expect(localStorage.getItem(PUSH_STATE_KEY)).toBe(written);
    expect(readPushState().works.map((w) => w.type).sort()).toEqual(['deviceRevoke', 'localUnsubscribe']);
  });
});

describe('row 56 — the channel an enable created goes when a revocation came meanwhile (rule 8)', () => {
  test('"user changed" on the registration after a revocation wrote the consent: the consent stays off, the new channel goes', async () => {
    const tab = await openTab(A);
    api.pushSubscribe.mockImplementationOnce(async (args: SubscribeArgs) => {
      // A logout in another tab: its transition keeps the undo of the enable from writing.
      await revokeConsent(A, { endpoint: args.endpoint, guard: 'unconfirmed' });
      return { kind: 'userChanged' };
    });

    expect(await tab.lifecycle.enablePush()).toEqual({ kind: 'superseded' });
    expect(readConsent(A)).toMatchObject({ state: 'off', labels: [] });
    expect(browser.created).toBe(1);
    expect(browser.channel).toBeNull();
  });

  test('the appearance is replaced while the registration is answered after a revocation: the new channel goes', async () => {
    const tab = await openTab(A);
    api.pushSubscribe.mockImplementationOnce(async (args: SubscribeArgs) => {
      const answer = await model.subscribe(args);
      await revokeConsent(A, { endpoint: args.endpoint, guard: 'unconfirmed' });
      tab.appearance.noteLogin(A);
      return answer;
    });

    expect(await tab.lifecycle.enablePush()).toEqual({ kind: 'superseded' });
    expect(browser.created).toBe(1);
    expect(browser.channel).toBeNull();
  });

  test.each(['lost', 'sessionEnded'] as const)(
    'the registration answer is %s after a revocation came meanwhile: the new channel goes',
    async (kind) => {
      const tab = await openTab(A);
      api.pushSubscribe.mockImplementationOnce(async (args: SubscribeArgs) => {
        await revokeConsent(A, { endpoint: args.endpoint, guard: 'unconfirmed' });
        return { kind };
      });

      expect(await tab.lifecycle.enablePush()).toEqual({ kind: 'failed', reason: 'unconfirmed' });
      expect(browser.created).toBe(1);
      expect(browser.channel).toBeNull();
    },
  );

  test('the browser does not answer the removal of the created channel: the lock is freed in bounded time, the removal journaled', async () => {
    const tab = await openTab(A);
    api.pushSubscribe.mockImplementationOnce(async (args: SubscribeArgs) => {
      await revokeConsent(A, { endpoint: args.endpoint, guard: 'unconfirmed' });
      return { kind: 'lost' };
    });
    browserApi.removeChannel.mockImplementationOnce(
      (_endpoint: string, _precondition?: () => void, signal?: AbortSignal) =>
        new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(signal.reason), { once: true })),
    );

    expect(await tab.lifecycle.enablePush()).toEqual({ kind: 'failed', reason: 'unconfirmed' });
    await settle();
    expect(locks.idle()).toBe(true);
    const created = browser.channel;
    expect(readPushState().works).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'localUnsubscribe', endpoint: created?.endpoint, ownerUserId: A })]),
    );
  });

  test('a decision\'s registration (row 2) is lost after a revocation came meanwhile: the channel it created goes', async () => {
    const x = channel('x');
    addSub(A, x.endpoint, LABEL_A);
    seed({ [A]: enabledConsent(LABEL_A, x, null) });
    api.pushSubscribe.mockImplementationOnce(async (args: SubscribeArgs) => {
      await revokeConsent(A, { endpoint: args.endpoint, guard: 'unconfirmed' });
      return { kind: 'lost' };
    });

    await openTab(A, true);
    expect(browser.created).toBe(1);
    expect(browser.channel).toBeNull();
  });

  test('a revocation transition taken back while the registration was on its way: the registered channel stays, the next appearance confirms it', async () => {
    const tab = await openTab(A);
    api.pushSubscribe.mockImplementationOnce(async (args: SubscribeArgs) => {
      const answer = await model.subscribe(args);
      // A logout in another tab wrote its transition and took it back (nothing was sent).
      const transition = await revokeConsent(A, { endpoint: null, guard: 'unconfirmed' });
      await undoRevocation(A, {
        expect: { gen: transition.consent.gen, rev: transition.consent.rev },
        previous: transition.previous,
        workIds: transition.work === null ? [] : [transition.work.id],
      });
      return answer;
    });

    expect(await tab.lifecycle.enablePush()).toEqual({ kind: 'superseded' });
    const created = browser.channel;
    expect(created).not.toBeNull();
    expect(readConsent(A)).toMatchObject({ state: 'enabled', endpoint: created?.endpoint });

    await openTab(A, true);
    expect(browser.channel).toEqual(created);
    expect(readConsent(A)).toMatchObject({ state: 'enabled', pending: null, endpoint: created?.endpoint });
  });

  test('the appearance is replaced while the registration is answered, without a revocation: the channel stays for the next appearance', async () => {
    const tab = await openTab(A);
    api.pushSubscribe.mockImplementationOnce(async (args: SubscribeArgs) => {
      const answer = await model.subscribe(args);
      tab.appearance.noteLogin(A);
      return answer;
    });

    expect(await tab.lifecycle.enablePush()).toEqual({ kind: 'superseded' });
    expect(browser.channel).not.toBeNull();
    expect(readConsent(A)).toMatchObject({ state: 'enabled', endpoint: browser.channel?.endpoint });
  });
});

describe('row 69 — a late answer after the deletion of the account', () => {
  test('a "revoked" formed before the deletion and delivered after it: the deleted consent stays deleted, nothing is journaled', async () => {
    const tab = await openTab(A);
    api.pushSubscribe.mockImplementationOnce(async () => {
      // Another tab finished the deletion of A's account meanwhile.
      await retireConsent(A);
      return { kind: 'revoked' };
    });

    await tab.lifecycle.enablePush();
    expect(readConsent(A)).toMatchObject({ state: 'none', labels: [], endpoint: null, retired: true });
    expect(readPushState().works).toEqual([]);
    expect(browser.channel).toBeNull();
  });

  test('a stale explicit logout of the deleted account writes nothing over it', async () => {
    await openTab(A);
    await retireConsent(A);
    const before = localStorage.getItem(PUSH_STATE_KEY);

    await expect(revokeConsent(A, { endpoint: channel('x').endpoint, guard: 'unconfirmed' })).rejects.toThrow();
    expect(localStorage.getItem(PUSH_STATE_KEY)).toBe(before);
  });
});

describe('row 7 against a logout in another tab that may still be taken back (rule 5, US-4)', () => {
  test('tab 2 decides while tab 1 logs out: rows 7/10 wait; the logout is superseded; A\'s subscription and channel stay', async () => {
    const x = channel('x');
    browser.channel = x;
    addSub(A, x.endpoint, LABEL_A);
    seed({ [A]: enabledConsent(LABEL_A, x, null) });
    // Tab 2: its decision holds skein.push.op from before the click and waits for the server's configuration.
    const config = deferred<void>();
    api.getPushConfig.mockImplementationOnce(async () => {
      await config.promise;
      return { publicKey: server.publicKey };
    });
    const tab2 = await openTab(A);
    tab2.lifecycle.startPushLifecycle();
    for (let i = 0; i < 200 && api.getPushConfig.mock.calls.length === 0; i += 1) await new Promise((r) => setTimeout(r, 0));
    expect(api.getPushConfig).toHaveBeenCalledTimes(1);

    // Tab 1: A clicks "Log out"; the transition (off, the held revocation) is
    // written, its confirmation is still on its way.
    api.pushListDevices.mockImplementationOnce(() => new Promise(() => undefined));
    vi.resetModules();
    const tab1Appearance = await import('../../auth/appearance');
    const tab1Departure = await import('./departure');
    tab1Appearance.noteLogin(A);
    const departure = tab1Departure.beginExplicitDeparture();
    for (let i = 0; i < 200 && readConsent(A).state !== 'off'; i += 1) await new Promise((r) => setTimeout(r, 0));
    expect(readConsent(A).state).toBe('off');

    // Tab 2 decides on the off consent: row 7 must not revoke or remove.
    config.resolve();
    for (let i = 0; i < 50; i += 1) await new Promise((r) => setTimeout(r, 0));
    expect(api.pushRevokeDevices).not.toHaveBeenCalled();
    expect(browser.channel).toEqual(x);

    // A new session in tab 1 before its revocation was sent: superseded, taken back.
    tab1Appearance.noteLogin(A);
    expect(await departure.prepare()).toBe('superseded');
    await settle();

    expect(api.pushRevokeDevices).not.toHaveBeenCalled();
    expect(server.subs.map((sub) => sub.endpoint)).toEqual([x.endpoint]);
    expect(browser.channel).toEqual(x);
    expect(readConsent(A)).toMatchObject({ state: 'enabled', label: LABEL_A, endpoint: x.endpoint });
    tab1Appearance.noteSignedOut();
  });
});

describe('a browser read under skein.push.op ends with the operation (Edge 13)', () => {
  test('the channel read of a decision does not answer: ending the operation frees the lock', async () => {
    browserApi.readChannel.mockImplementationOnce(
      (signal?: AbortSignal) =>
        new Promise((resolve) => signal?.addEventListener('abort', () => resolve({ kind: 'unreadable' }), { once: true })),
    );
    const tab = await openTab(A);
    tab.lifecycle.startPushLifecycle();
    for (let i = 0; i < 200 && browserApi.readChannel.mock.calls.length === 0; i += 1) await new Promise((r) => setTimeout(r, 0));
    expect(browserApi.readChannel.mock.calls[0][0]).toBeInstanceOf(AbortSignal);
    expect(locks.idle()).toBe(false);

    tab.lifecycle.abortPushOperations();
    await settle();
    expect(locks.idle()).toBe(true);
  });
});

describe('the fresh read after an action and the confirmation of the user (rule 5, US-2)', () => {
  test('"user changed" on the list read after an enable: /me is read again and the enable ends as superseded', async () => {
    const tab = await openTab(A);
    const reload = vi.fn(async () => undefined);
    tab.appearance.registerMeReload(reload);
    api.pushListDevices.mockImplementationOnce(model.list).mockImplementationOnce(async () => ({ kind: 'userChanged' }));

    expect(await tab.lifecycle.enablePush()).toEqual({ kind: 'superseded' });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  test('a late "user changed" of an appearance replaced meanwhile is dropped', async () => {
    const tab = await openTab(A);
    const reload = vi.fn(async () => undefined);
    tab.appearance.registerMeReload(reload);
    api.pushListDevices.mockImplementationOnce(model.list).mockImplementationOnce(async () => {
      tab.appearance.noteLogin(A);
      return { kind: 'userChanged' };
    });

    expect(await tab.lifecycle.enablePush()).toEqual({ kind: 'done' });
    expect(reload).not.toHaveBeenCalled();
  });

  test('the fresh read does not answer: the enable answers at the end of its wait, what it wrote shown before', async () => {
    const tab = await openTab(A);
    api.pushListDevices.mockImplementationOnce(model.list).mockImplementationOnce(() => new Promise(() => undefined));
    const realSetTimeout = globalThis.setTimeout;
    const flush = async () => {
      for (let i = 0; i < 50; i += 1) await new Promise((r) => realSetTimeout(r, 0));
    };
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      let answer: unknown = null;
      void tab.lifecycle.enablePush().then((result) => {
        answer = result;
      });
      for (let i = 0; i < 200 && api.pushListDevices.mock.calls.length < 2; i += 1) await flush();
      expect(api.pushListDevices).toHaveBeenCalledTimes(2);
      // What the enable wrote is shown before the list answers.
      expect(tab.lifecycle.getPushLifecycleState().consent).toMatchObject({ state: 'enabled', pending: null });

      await vi.advanceTimersByTimeAsync(tab.lifecycle.SHOWN_READ_WAIT_MS - 1);
      await flush();
      expect(answer).toBeNull();
      await vi.advanceTimersByTimeAsync(1);
      await flush();
      expect(answer).toEqual({ kind: 'done' });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('what the settings show after an action is read outside skein.push.op (US-3)', () => {
  test('the list read after an enable hangs: the lock is free for the next operation; the list and the device come as one read', async () => {
    const tab = await openTab(A);
    const relist = deferred<void>();
    api.pushListDevices
      .mockImplementationOnce(model.list)
      .mockImplementationOnce(async (userId: string) => {
        await relist.promise;
        return model.list(userId);
      });

    const enabling = tab.lifecycle.enablePush();
    for (let i = 0; i < 200 && api.pushListDevices.mock.calls.length < 2; i += 1) await new Promise((r) => setTimeout(r, 0));
    expect(api.pushListDevices).toHaveBeenCalledTimes(2);
    let nextRan = false;
    await locks.request(PUSH_OP_LOCK, { mode: 'exclusive' }, async () => {
      nextRan = true;
    });
    expect(nextRan).toBe(true);

    relist.resolve();
    expect(await enabling).toEqual({ kind: 'done' });
    const shown = tab.lifecycle.getPushLifecycleState();
    expect(shown.devices).toHaveLength(1);
    expect(shown.thisDeviceHash).toBe(shown.devices![0].endpointHash);
  });

  test('the list read after an enable is lost: the list is shown as not read, not the one from before', async () => {
    const tab = await openTab(A, true);
    expect(tab.lifecycle.getPushLifecycleState().devices).toEqual([]);
    api.pushListDevices.mockImplementationOnce(model.list).mockImplementationOnce(async () => ({ kind: 'lost' }));

    expect(await tab.lifecycle.enablePush()).toEqual({ kind: 'done' });
    const shown = tab.lifecycle.getPushLifecycleState();
    expect(shown.devices).toBeNull();
    expect(shown.thisDeviceHash).not.toBeNull();
  });

  test('a decision that acted reads the list again without holding the lock', async () => {
    const x = channel('x');
    addSub(A, x.endpoint, LABEL_A);
    seed({ [A]: enabledConsent(LABEL_A, x, null) });
    const relist = deferred<void>();
    // Row 2: the consent's channel is gone; the decision creates one and registers it.
    api.pushListDevices.mockImplementation(async (userId: string) => {
      if (api.pushListDevices.mock.calls.length > 1) await relist.promise;
      return model.list(userId);
    });

    const tab = await openTab(A, true);
    expect(api.pushSubscribe).toHaveBeenCalledTimes(1);
    expect(api.pushListDevices).toHaveBeenCalledTimes(2);
    expect(locks.idle()).toBe(true);

    relist.resolve();
    await settle();
    const shown = tab.lifecycle.getPushLifecycleState();
    const hash = await sha256(browser.channel!.endpoint);
    expect(shown.thisDeviceHash).toBe(hash);
    expect(shown.devices?.map((d) => d.endpointHash)).toContain(hash);
  });
});

describe('row 61 — the transition is taken back only while nothing of it reached the server (rule 5)', () => {
  test('the appearance is replaced after the transition, before the revocation request: the transition is taken back', async () => {
    const x = channel('x');
    browser.channel = x;
    addSub(A, x.endpoint, LABEL_A);
    seed({ [A]: enabledConsent(LABEL_A, x, null) });
    const tab = await openTab(A);
    const consentBefore = readConsent(A);
    let replaced = false;
    locks.onRelease = (name) => {
      if (name !== PUSH_STORE_LOCK || replaced) return;
      // The transition is written: a new login of A replaces the appearance.
      replaced = true;
      tab.appearance.noteLogin(A);
    };

    expect(await tab.lifecycle.disablePush()).toEqual({ kind: 'superseded' });
    expect(api.pushRevokeDevices).not.toHaveBeenCalled();
    expect({ ...readConsent(A), gen: 0, rev: 0 }).toEqual({ ...consentBefore, gen: 0, rev: 0 });
    expect(readConsent(A).gen).toBe(consentBefore.gen + 1);
    expect(readPushState().works).toEqual([]);
    expect(browser.channel).toEqual(x);
  });

  test('"user changed" on the removal by id after the labels were revoked: off and the work stay; the owner finishes it', async () => {
    const x = channel('x');
    browser.channel = x;
    const sub = addSub(A, x.endpoint, LABEL_A);
    const labels = Array.from({ length: 1000 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    seed({ [A]: { state: 'none', labels } });
    const tab = await openTab(A);
    api.pushRemoveDevice.mockImplementationOnce(async () => ({ kind: 'userChanged' }));

    expect(await tab.lifecycle.disablePush()).toEqual({ kind: 'superseded' });
    expect(readConsent(A)).toMatchObject({ state: 'off', labels: [] });
    expect(readPushState().works).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'deviceRevoke', ownerUserId: A, removeSubscriptionId: sub.id })]),
    );

    // The owner appears again: the recorded removal by id goes.
    await openTab(A, true);
    expect(server.subs).toEqual([]);
    expect(readPushState().works.filter((w) => w.type === 'deviceRevoke')).toEqual([]);
  });
});

describe('row 61 — the manual retry of an unconfirmed disable (US-3)', () => {
  test('after a lost revocation and a removed channel, disabling again sends the recorded revocation', async () => {
    const x = channel('x');
    browser.channel = x;
    addSub(A, x.endpoint, LABEL_A);
    seed({ [A]: enabledConsent(LABEL_A, x, null) });
    const tab = await openTab(A);
    api.pushRevokeDevices.mockImplementationOnce(async () => ({ kind: 'lost' }));

    expect(await tab.lifecycle.disablePush()).toEqual({ kind: 'failed', reason: 'unconfirmed' });
    expect(browser.channel).toBeNull();
    expect(server.subs).toHaveLength(1);

    expect(await tab.lifecycle.disablePush()).toEqual({ kind: 'done' });
    expect(revocationBodies()[1]).toEqual({ expectedUserId: A, deviceLabels: [LABEL_A], endpoint: x.endpoint });
    expect(server.subs).toEqual([]);
    expect(readPushState().works).toEqual([]);
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
