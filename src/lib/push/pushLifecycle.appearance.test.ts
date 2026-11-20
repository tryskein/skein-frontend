/**
 * Rows 49–55 — the push controller on a user's appearance (spec US-2 with the
 * decision table and "Repeats", US-6, US-8, US-9, US-10; composition rules
 * 3, 5, 6, 7, 9; INV-2, INV-12; Edge 6, 7; plan "Key decisions": the
 * appearance token, the guard, warning B and the two kinds of 204).
 *
 * Only two boundaries are substituted: the push transport (the functions of
 * `api/push.ts`, answered by a small model of the server's push contract)
 * and the browser adapter `browserPush.ts` (one channel, created and removed
 * on request). The locks are the real `locks.ts` over a substituted
 * `navigator.locks`, the state is the real `pushState.ts` over jsdom's
 * localStorage, the decision is the real `decide.ts`, the appearance is the
 * real store `auth/appearance.ts`.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { RemoveChannelArgs, SubscribeArgs } from '../../api/push';
import { noteLogin, noteSignedOut, registerMeReload } from '../../auth/appearance';
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
  LABEL_B,
  model,
  seed,
  server,
  settle as settleLocks,
  sha256,
  uninstallPushHarness,
} from '../../test/pushHarness';
import type { BrowserChannel } from './browserPush';
import { keysFingerprint } from './fingerprint';
import { PUSH_STORE_LOCK } from './locks';
import { type Consent, PUSH_STATE_KEY, readConsent, readPushState, revokeConsent } from './pushState';

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
}));

vi.mock('./browserPush', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./browserPush')>()),
  ...browserApi,
}));

import { getPushLifecycleState, type PushLifecycleState, startPushLifecycle, stopPushLifecycle, subscribePushLifecycle } from './pushLifecycle';

let locks: FakeLocks;

const meReload = vi.fn(async () => undefined);
const published: PushLifecycleState[] = [];
let unregisterReload: () => void = () => undefined;
let unsubscribeState: () => void = () => undefined;

/** Waits until no push operation holds or waits for a lock. */
const settle = () => settleLocks(locks);

/** User `userId` appears (the server confirms them) and the decision runs to its end. */
async function appear(userId: string): Promise<void> {
  server.caller = userId;
  noteLogin(userId);
  await settle();
}

beforeEach(() => {
  locks = new FakeLocks();
  installPushHarness(api, browserApi, locks);
  meReload.mockClear();
  unregisterReload = registerMeReload(meReload);
  published.length = 0;
  unsubscribeState = subscribePushLifecycle(() => published.push(getPushLifecycleState()));
});

afterEach(async () => {
  stopPushLifecycle();
  noteSignedOut();
  await settle();
  unsubscribeState();
  unregisterReload();
  uninstallPushHarness();
});

/** Starts the controller as on a page load, without a user. */
async function load(): Promise<void> {
  startPushLifecycle();
  await settle();
}

const allPushCalls = () =>
  api.pushListDevices.mock.calls.length +
  api.pushSubscribe.mock.calls.length +
  api.pushRemoveChannel.mock.calls.length +
  api.pushRevokeDevices.mock.calls.length +
  api.pushRemoveDevice.mock.calls.length;

// ───────────────────────── Row 49 ─────────────────────────

describe('row 49 — a replaced appearance ends the decision without an effect', () => {
  test('the appearance ends after a successful list read: no state write, no channel removal, no publication', async () => {
    // B appears with A's channel, which is not in B's list: row 5.
    browser.channel = channel('a');
    await load();
    const stateBefore = localStorage.getItem(PUSH_STATE_KEY);
    api.pushListDevices.mockImplementationOnce(async (userId: string) => {
      const listed = await model.list(userId);
      noteSignedOut();
      published.length = 0;
      return listed;
    });

    await appear(B);

    expect(api.pushListDevices).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(PUSH_STATE_KEY)).toBe(stateBefore);
    expect(browserApi.removeChannel).not.toHaveBeenCalled();
    expect(api.pushRemoveChannel).not.toHaveBeenCalled();
    expect(browser.channel).toEqual(channel('a'));
    expect(published.filter((s) => s.appearance !== null)).toEqual([]);
  });

  test('a new session of the same user (a new seq) ends the decision of the old one', async () => {
    browser.channel = channel('a');
    await load();
    let oldSeq = 0;
    api.pushListDevices
      .mockImplementationOnce(async (userId: string) => {
        const listed = await model.list(userId);
        oldSeq = getPushLifecycleState().appearance!.seq;
        noteLogin(B);
        return listed;
      })
      // The new appearance's own decision reads nothing.
      .mockImplementationOnce(async () => ({ kind: 'lost' }));

    await appear(B);

    expect(api.pushListDevices).toHaveBeenCalledTimes(2);
    expect(readPushState().works).toEqual([]);
    expect(browserApi.removeChannel).not.toHaveBeenCalled();
    expect(api.pushRemoveChannel).not.toHaveBeenCalled();
    expect(published.some((s) => s.appearance?.seq === oldSeq && s.decided)).toBe(false);
  });

  test('the appearance ends between the server removal and the local one: the channel and the work stay', async () => {
    browser.channel = channel('a');
    await load();
    api.pushRemoveChannel.mockImplementationOnce(async (args: RemoveChannelArgs) => {
      const outcome = await model.removeChannel(args);
      noteSignedOut();
      return outcome;
    });

    await appear(B);

    expect(api.pushRemoveChannel).toHaveBeenCalledTimes(1);
    expect(browserApi.removeChannel).not.toHaveBeenCalled();
    expect(browser.channel).toEqual(channel('a'));
    // The `ok` arrived in a replaced appearance: it finishes nothing.
    expect(readPushState().works.map((w) => w.type).sort()).toEqual(['foreignRemoval', 'localUnsubscribe']);
  });
});

describe('row 49 — a write queued on skein.push.store after the appearance was replaced', () => {
  test('the work of row 5 is not written once the lock is granted', async () => {
    browser.channel = channel('a');
    await load();
    let release: () => void = () => undefined;
    api.pushListDevices
      .mockImplementationOnce(async (userId: string) => {
        const listed = await model.list(userId);
        // Another tab holds the store lock while this decision reaches its first write.
        void locks.request(PUSH_STORE_LOCK, { mode: 'exclusive' }, () => new Promise<void>((r) => (release = r)));
        return listed;
      })
      .mockImplementationOnce(async () => ({ kind: 'lost' }));

    server.caller = B;
    noteLogin(B);
    for (let i = 0; i < 20; i += 1) await new Promise((r) => setTimeout(r, 0));
    noteLogin(B);
    release();
    await settle();

    expect(readPushState().works).toEqual([]);
    expect(browserApi.removeChannel).not.toHaveBeenCalled();
    expect(api.pushRemoveChannel).not.toHaveBeenCalled();
  });
});

describe('row 49 — the appearance is replaced after a write the row prepared, before its request', () => {
  const withoutRev = (c: Consent) => ({ ...c, rev: 0 });

  /** Replaces the appearance as the first push state write of the decision is done. */
  function replaceAfterFirstWrite(): void {
    locks.onRelease = (name) => {
      if (name !== PUSH_STORE_LOCK) return;
      locks.onRelease = null;
      noteLogin(server.caller);
    };
    api.pushListDevices.mockImplementation(async (userId: string) =>
      api.pushListDevices.mock.calls.length > 1 ? { kind: 'lost' } : model.list(userId),
    );
  }

  test('row 2: the new channel is taken away again and the consent put back; nothing is registered', async () => {
    seed({ [A]: enabledConsent(LABEL_A, channel('gone'), null) });
    await load();
    const before = withoutRev(readConsent(A));
    server.caller = A;
    replaceAfterFirstWrite();

    await appear(A);

    expect(browserApi.createChannel).toHaveBeenCalledTimes(1);
    expect(api.pushSubscribe).not.toHaveBeenCalled();
    expect(browser.channel).toBeNull();
    expect(withoutRev(readConsent(A))).toEqual(before);
  });

  test('row 5: the first of its two works is taken back', async () => {
    browser.channel = channel('a');
    await load();
    server.caller = B;
    replaceAfterFirstWrite();

    await appear(B);

    expect(api.pushRemoveChannel).not.toHaveBeenCalled();
    expect(readPushState().works).toEqual([]);
    expect(browser.channel).toEqual(channel('a'));
  });
});

describe('row 49 — the appearance is replaced while the browser removes a channel', () => {
  test('the controller passes its liveness to the browser: the channel stays', async () => {
    const a = channel('a');
    browser.channel = a;
    seed({ [A]: { state: 'off', endpoint: a.endpoint } });
    await load();
    const remove = browserApi.removeChannel.getMockImplementation()!;
    browserApi.removeChannel.mockImplementationOnce(async (endpoint: string, precondition?: () => void) => {
      // The appearance changes after the browser read its subscription.
      noteLogin(A);
      return remove(endpoint, precondition);
    });
    api.pushListDevices.mockImplementation(async (userId: string) =>
      api.pushListDevices.mock.calls.length > 1 ? { kind: 'lost' } : model.list(userId),
    );

    await appear(A);

    expect(browser.channel).toEqual(a);
  });
});

describe('row 49 — a channel created while the appearance was replaced', () => {
  test('is removed again; the consent is not written', async () => {
    seed({ [A]: enabledConsent(LABEL_A, channel('gone'), null) });
    await load();
    const stateBefore = localStorage.getItem(PUSH_STATE_KEY);
    browserApi.createChannel.mockImplementationOnce(async () => {
      // The browser finished the subscription after another login.
      noteLogin(A);
      browser.channel = channel('late');
      return browser.channel;
    });
    api.pushListDevices.mockImplementation(async (userId: string) =>
      api.pushListDevices.mock.calls.length > 1 ? { kind: 'lost' } : model.list(userId),
    );

    await appear(A);

    expect(browserApi.createChannel).toHaveBeenCalledTimes(1);
    expect(browser.channel).toBeNull();
    expect(localStorage.getItem(PUSH_STATE_KEY)).toBe(stateBefore);
    expect(api.pushSubscribe).not.toHaveBeenCalled();
  });
});

// ───────────────────────── Row 50 ─────────────────────────

describe('row 50 — repeats of unfinished work (rule 6)', () => {
  test("the owner's device revocation is repeated by the owner and, until ok, blocks rows 2 and 4", async () => {
    const old = channel('old');
    seed(
      { [A]: enabledConsent(LABEL_A, old, null) },
      [{ id: 'w1', type: 'deviceRevoke', ownerUserId: A, labels: ['cccccccc-0000-4000-8000-000000000003'], guard: 'absent' }],
    );
    await load();
    api.pushRevokeDevices.mockImplementationOnce(async () => ({ kind: 'lost' }));

    await appear(A);

    expect(api.pushRevokeDevices).toHaveBeenCalledWith(
      { expectedUserId: A, deviceLabels: ['cccccccc-0000-4000-8000-000000000003'], endpoint: undefined },
      expect.any(AbortSignal),
    );
    expect(readPushState().works.map((w) => w.id)).toEqual(['w1']);
    // Row 2 (enabled, no channel) waits.
    expect(browserApi.createChannel).not.toHaveBeenCalled();
    expect(api.pushSubscribe).not.toHaveBeenCalled();

    await appear(A);

    expect(readPushState().works).toEqual([]);
    expect(browserApi.createChannel).toHaveBeenCalledTimes(1);
    expect(api.pushSubscribe).toHaveBeenCalledWith(
      expect.objectContaining({ expectedUserId: A, deviceLabel: LABEL_A, mode: 'upsert' }),
      expect.any(AbortSignal),
    );
  });

  test("another user repeats the owner's revocation guarded by {id, version} as a conditional removal; the owner's work and block stay", async () => {
    const a = channel('a');
    const sub = addSub(A, a.endpoint, LABEL_A);
    seed(
      { [A]: enabledConsent('dddddddd-0000-4000-8000-000000000004', channel('a2'), null) },
      [{ id: 'w1', type: 'deviceRevoke', ownerUserId: A, labels: [LABEL_A], endpoint: a.endpoint, guard: { id: sub.id, version: sub.version } }],
    );
    await load();

    await appear(B);

    expect(api.pushRemoveChannel).toHaveBeenCalledWith(
      { expectedUserId: B, endpoint: a.endpoint, ifSubscription: { id: sub.id, version: sub.version } },
      expect.any(AbortSignal),
    );
    expect(api.pushRevokeDevices).not.toHaveBeenCalled();
    expect(readPushState().works.map((w) => w.id)).toEqual(['w1']);

    // The owner's rows 2 and 4 are still blocked by the same work.
    api.pushRevokeDevices.mockImplementationOnce(async () => ({ kind: 'lost' }));
    await appear(A);
    expect(browserApi.createChannel).not.toHaveBeenCalled();
    expect(api.pushSubscribe).not.toHaveBeenCalled();
  });

  test.each(['absent', 'unconfirmed'] as const)(
    "another user does not call the server for the owner's revocation guarded by %s",
    async (guard) => {
      const a = channel('a');
      seed({}, [{ id: 'w1', type: 'deviceRevoke', ownerUserId: A, labels: [LABEL_A], endpoint: a.endpoint, guard }]);
      await load();

      await appear(B);

      expect(api.pushRemoveChannel).not.toHaveBeenCalled();
      expect(api.pushRevokeDevices).not.toHaveBeenCalled();
      expect(readPushState().works.map((w) => w.id)).toEqual(['w1']);
    },
  );

  test('a foreign channel removal is repeated by any user and finished by ok', async () => {
    const a = channel('a');
    addSub(A, a.endpoint, LABEL_A);
    seed({}, [{ id: 'w1', type: 'foreignRemoval', endpoint: a.endpoint }]);
    await load();

    await appear(B);

    expect(api.pushRemoveChannel).toHaveBeenCalledWith({ expectedUserId: B, endpoint: a.endpoint }, expect.any(AbortSignal));
    expect(readPushState().works).toEqual([]);
    expect(server.subs).toEqual([]);
  });

  test('a local channel removal is repeated on page load without a user, only on the channel it names', async () => {
    browser.channel = channel('a');
    seed({}, [{ id: 'w1', type: 'localUnsubscribe', endpoint: channel('a').endpoint }]);

    await load();

    expect(browserApi.removeChannel.mock.calls.map((c) => c[0])).toContain(channel('a').endpoint);
    expect(browser.channel).toBeNull();
    expect(readPushState().works).toEqual([]);
    expect(allPushCalls()).toBe(0);
  });

  test('a local channel removal leaves another current channel alone', async () => {
    browser.channel = channel('b');
    seed({}, [{ id: 'w1', type: 'localUnsubscribe', endpoint: channel('a').endpoint }]);

    await load();

    expect(browser.channel).toEqual(channel('b'));
    expect(readPushState().works).toEqual([]);
  });
});

// ───────────────────────── Row 51 ─────────────────────────

describe('row 51 — row 5: the previous user’s channel, warning B', () => {
  test.each([
    { serverOk: true, localOk: true },
    { serverOk: true, localOk: false },
    { serverOk: false, localOk: true },
    { serverOk: false, localOk: false },
  ])('removal on the server ok=$serverOk, channel removal ok=$localOk: each step done or kept as work', async ({ serverOk, localOk }) => {
    const a = channel('a');
    addSub(A, a.endpoint, LABEL_A);
    browser.channel = a;
    browser.removeFails = !localOk;
    await load();
    let warningAtRequest: string[] = [];
    api.pushRemoveChannel.mockImplementationOnce(async (args: RemoveChannelArgs) => {
      warningAtRequest = getPushLifecycleState().foreignChannelWarnings;
      return serverOk ? model.removeChannel(args) : { kind: 'lost' };
    });

    await appear(B);

    expect(api.pushRemoveChannel).toHaveBeenCalledWith({ expectedUserId: B, endpoint: a.endpoint }, expect.any(AbortSignal));
    expect(browserApi.removeChannel.mock.calls.map((c) => c[0])).toContain(a.endpoint);
    // The warning is shown before the answer of the unconditional removal.
    expect(warningAtRequest).toEqual([a.endpoint]);
    const types = readPushState().works.map((w) => w.type).sort();
    const expected = [...(serverOk ? [] : ['foreignRemoval']), ...(localOk ? [] : ['localUnsubscribe'])].sort();
    expect(types).toEqual(expected);
    expect(getPushLifecycleState().foreignChannelWarnings).toEqual(serverOk ? [] : [a.endpoint]);
    expect(browser.channel === null).toBe(localOk);
    // No device revocation of A is set, and A's subscription has no new owner.
    expect(api.pushRevokeDevices).not.toHaveBeenCalled();
    expect(server.subs.filter((s) => s.owner === B)).toEqual([]);
  });

  test('of two unfinished removals ok for A1 removes the work and warning of A1 only', async () => {
    const a1 = channel('a1');
    const a2 = channel('a2');
    seed({}, [
      { id: 'w1', type: 'foreignRemoval', endpoint: a1.endpoint },
      { id: 'w2', type: 'foreignRemoval', endpoint: a2.endpoint },
    ]);
    await load();
    expect(getPushLifecycleState().foreignChannelWarnings).toEqual([a1.endpoint, a2.endpoint]);
    api.pushRemoveChannel.mockImplementation(async (args: RemoveChannelArgs) =>
      args.endpoint === a1.endpoint ? model.removeChannel(args) : { kind: 'lost' },
    );

    await appear(B);

    expect(readPushState().works.map((w) => w.id)).toEqual(['w2']);
    expect(getPushLifecycleState().foreignChannelWarnings).toEqual([a2.endpoint]);
  });

  test("ok of a conditional removal at A1 keeps the warning of A1 and the owner's work", async () => {
    const a1 = channel('a1');
    const sub = addSub(A, a1.endpoint, LABEL_A);
    seed({}, [
      { id: 'w1', type: 'foreignRemoval', endpoint: a1.endpoint },
      { id: 'w2', type: 'deviceRevoke', ownerUserId: A, labels: [LABEL_A], endpoint: a1.endpoint, guard: { id: sub.id, version: sub.version } },
    ]);
    await load();
    api.pushRemoveChannel.mockImplementation(async (args: RemoveChannelArgs) =>
      args.ifSubscription !== undefined ? model.removeChannel(args) : { kind: 'lost' },
    );

    await appear(B);

    expect(api.pushRemoveChannel).toHaveBeenCalledWith(
      { expectedUserId: B, endpoint: a1.endpoint, ifSubscription: { id: sub.id, version: sub.version } },
      expect.any(AbortSignal),
    );
    expect(server.subs).toEqual([]);
    expect(readPushState().works.map((w) => w.id).sort()).toEqual(['w1', 'w2']);
    expect(getPushLifecycleState().foreignChannelWarnings).toEqual([a1.endpoint]);
  });

  test("B's rows 2 and 4 wait for the removal of A's channel; A's channel is never registered by B", async () => {
    const a = channel('a');
    addSub(A, a.endpoint, LABEL_A);
    browser.channel = a;
    browser.removeFails = true;
    seed({ [B]: enabledConsent(LABEL_B, channel('b-old'), null) });
    await load();

    await appear(B);

    expect(browserApi.createChannel).not.toHaveBeenCalled();
    expect(api.pushSubscribe).not.toHaveBeenCalled();

    // The browser removes the channel at the next try: B gets a new channel of its own.
    browser.removeFails = false;
    await appear(B);

    expect(browser.channel).not.toEqual(a);
    expect(browserApi.createChannel).toHaveBeenCalledTimes(1);
    expect(api.pushSubscribe).toHaveBeenCalledTimes(1);
    expect(api.pushSubscribe.mock.calls[0][0]).toMatchObject({ expectedUserId: B, deviceLabel: LABEL_B, mode: 'upsert' });
    expect(api.pushSubscribe.mock.calls[0][0].endpoint).not.toBe(a.endpoint);
  });
});

// ───────────────────────── Row 52 ─────────────────────────

describe('row 52 — "user changed", "session ended", "lost"', () => {
  test.each(['list', 'repeat', 'registration'] as const)(
    '"user changed" on the %s re-reads /me, with no consent write, push request, channel removal or publication before or besides it',
    async (where) => {
      const a = channel('a');
      // A confirmed consent of B whose endpoint left the list: row 4 registers.
      seed({ [B]: enabledConsent(LABEL_B, a, null) }, where === 'repeat' ? [{ id: 'w1', type: 'foreignRemoval', endpoint: channel('x').endpoint }] : []);
      browser.channel = a;
      await load();
      const stateBefore = localStorage.getItem(PUSH_STATE_KEY);
      const refuse = async () => ({ kind: 'userChanged' as const });
      if (where === 'list') api.pushListDevices.mockImplementationOnce(refuse);
      if (where === 'repeat') api.pushRemoveChannel.mockImplementationOnce(refuse);
      if (where === 'registration') api.pushSubscribe.mockImplementationOnce(refuse);
      let callsAtRefusal = 0;
      let publishedAtRefusal = 0;
      const mark = () => {
        callsAtRefusal = allPushCalls();
        publishedAtRefusal = published.length;
      };
      meReload.mockImplementationOnce(async () => {
        mark();
        return undefined;
      });

      await appear(B);

      expect(meReload).toHaveBeenCalledTimes(1);
      expect(localStorage.getItem(PUSH_STATE_KEY)).toBe(stateBefore);
      expect(browserApi.removeChannel).not.toHaveBeenCalled();
      expect(allPushCalls()).toBe(callsAtRefusal);
      // Nothing was published by the decision: only the reset of the new appearance.
      expect(published.slice(1).filter((s) => s.decided)).toEqual([]);
      expect(published.length).toBe(publishedAtRefusal);
    },
  );

  test.each(['sessionEnded', 'lost'] as const)('%s on the list leaves the consent and the work as they were', async (kind) => {
    const a = channel('a');
    seed({ [B]: enabledConsent(LABEL_B, a, null, { label: LABEL_B, kind: 'enable' }) }, [
      { id: 'w1', type: 'deviceRevoke', ownerUserId: B, labels: ['eeeeeeee-0000-4000-8000-000000000005'], guard: 'absent' },
    ]);
    browser.channel = a;
    await load();
    api.pushRevokeDevices.mockImplementationOnce(async () => ({ kind }));
    api.pushListDevices.mockImplementationOnce(async () => ({ kind }));
    const stateBefore = localStorage.getItem(PUSH_STATE_KEY);

    await appear(B);

    expect(localStorage.getItem(PUSH_STATE_KEY)).toBe(stateBefore);
    expect(api.pushSubscribe).not.toHaveBeenCalled();
    expect(browserApi.removeChannel).not.toHaveBeenCalled();
    expect(meReload).not.toHaveBeenCalled();
    expect(getPushLifecycleState().decided).toBe(false);
  });

  test.each(['sessionEnded', 'lost'] as const)('%s on a registration leaves the consent unconfirmed', async (kind) => {
    const a = channel('a');
    seed({ [B]: enabledConsent(LABEL_B, a, null, { label: LABEL_B, kind: 'enable' }) });
    browser.channel = a;
    await load();
    api.pushSubscribe.mockImplementationOnce(async () => ({ kind }));
    const stateBefore = localStorage.getItem(PUSH_STATE_KEY);

    await appear(B);

    expect(api.pushSubscribe).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(PUSH_STATE_KEY)).toBe(stateBefore);
  });
});

describe('row 52 — "user changed" on the request of a row leaves nothing the row prepared', () => {
  const withoutRev = (c: Consent) => ({ ...c, rev: 0 });
  const userChanged = async () => ({ kind: 'userChanged' as const });

  test.each([
    {
      row: 2,
      setup: () => seed({ [B]: enabledConsent(LABEL_B, channel('gone'), null) }),
      refuse: () => api.pushSubscribe.mockImplementationOnce(userChanged),
    },
    {
      row: 5,
      setup: () => {
        browser.channel = channel('a');
      },
      refuse: () => api.pushRemoveChannel.mockImplementationOnce(userChanged),
    },
    {
      row: 6,
      setup: () => {
        browser.channel = channel('a');
        addSub(B, channel('a').endpoint, null);
      },
      refuse: () => api.pushSubscribe.mockImplementationOnce(userChanged),
    },
    {
      row: 9,
      setup: () => {
        browser.channel = channel('a');
        addSub(B, channel('a').endpoint, LABEL_B);
        seed({ [B]: enabledConsent(LABEL_B, channel('old'), null) });
      },
      refuse: () => api.pushSubscribe.mockImplementationOnce(userChanged),
    },
  ])('row $row: the consent, the works and the channel are as before', async ({ setup, refuse }) => {
    setup();
    await load();
    const consentBefore = withoutRev(readConsent(B));
    const channelBefore = browser.channel;
    refuse();

    await appear(B);

    expect(meReload).toHaveBeenCalledTimes(1);
    expect(withoutRev(readConsent(B))).toEqual(consentBefore);
    expect(readPushState().works).toEqual([]);
    expect(browser.channel).toEqual(channelBefore);
    expect(getPushLifecycleState().foreignChannelWarnings).toEqual([]);
  });
});

// ───────────────────────── Row 53 ─────────────────────────

describe('row 53 — the browser changed the channel (US-10)', () => {
  test("the new endpoint is in U's list: row 9 — the consent takes the endpoint, the subscription is updated with U's label", async () => {
    const before = channel('a');
    const after = channel('a-renewed');
    addSub(A, after.endpoint, LABEL_A);
    seed({ [A]: enabledConsent(LABEL_A, before, await keysFingerprint(before.keys)) });
    browser.channel = after;
    await load();

    await appear(A);

    expect(api.pushSubscribe).toHaveBeenCalledTimes(1);
    expect(api.pushSubscribe.mock.calls[0][0]).toMatchObject({
      expectedUserId: A,
      endpoint: after.endpoint,
      deviceLabel: LABEL_A,
      mode: 'updateOnly',
    });
    const consent = readConsent(A);
    expect(consent).toMatchObject({ state: 'enabled', label: LABEL_A, endpoint: after.endpoint, pending: null });
  });

  test('the new endpoint is not in the list: row 5 removes it, then row 2 creates and registers a channel', async () => {
    const before = channel('a');
    const after = channel('a-renewed');
    seed({ [A]: enabledConsent(LABEL_A, before, await keysFingerprint(before.keys)) });
    browser.channel = after;
    await load();

    await appear(A);

    expect(browserApi.removeChannel.mock.calls.map((c) => c[0])).toContain(after.endpoint);
    expect(api.pushRemoveChannel).toHaveBeenCalledWith({ expectedUserId: A, endpoint: after.endpoint }, expect.any(AbortSignal));
    expect(browserApi.createChannel).toHaveBeenCalledTimes(1);
    expect(api.pushSubscribe).toHaveBeenCalledTimes(1);
    expect(api.pushSubscribe.mock.calls[0][0]).toMatchObject({ expectedUserId: A, deviceLabel: LABEL_A, mode: 'upsert' });
    expect(readConsent(A)).toMatchObject({ state: 'enabled', endpoint: browser.channel!.endpoint, pending: null });
  });
});

// ───────────────────────── Row 54 ─────────────────────────

describe('row 54 — rule 7 in execution', () => {
  test('an unconfirmed accept answered "not found" goes back to no mark and creates nothing', async () => {
    const a = channel('a');
    seed({ [A]: enabledConsent(LABEL_A, a, null, { label: LABEL_A, kind: 'accept' }) });
    browser.channel = a;
    await load();

    await appear(A);

    expect(api.pushSubscribe).toHaveBeenCalledTimes(1);
    expect(api.pushSubscribe.mock.calls[0][0]).toMatchObject({ mode: 'updateOnly', deviceLabel: LABEL_A });
    expect(readConsent(A)).toMatchObject({ state: 'none', label: null, pending: null, labels: [LABEL_A] });
    expect(server.subs).toEqual([]);
  });

  test('"revoked" on row 4 turns the consent off and removes the channel', async () => {
    const a = channel('a');
    server.revoked.add(`${A}/${LABEL_A}`);
    seed({ [A]: enabledConsent(LABEL_A, a, null) });
    browser.channel = a;
    await load();

    await appear(A);

    expect(readConsent(A).state).toBe('off');
    expect(browser.channel).toBeNull();
    expect(browserApi.removeChannel.mock.calls.map((c) => c[0])).toContain(a.endpoint);
  });

  test('"revoked" on row 2 turns the consent off and removes the new channel', async () => {
    server.revoked.add(`${A}/${LABEL_A}`);
    seed({ [A]: enabledConsent(LABEL_A, channel('gone'), null) });
    await load();

    await appear(A);

    expect(browserApi.createChannel).toHaveBeenCalledTimes(1);
    expect(readConsent(A).state).toBe('off');
    expect(browser.channel).toBeNull();
  });

  test('the consent is confirmed only by ok; a lost answer of an enable is finished by the next appearance with the same label', async () => {
    seed({ [A]: enabledConsent(LABEL_A, channel('gone'), null, { label: LABEL_A, kind: 'enable' }) });
    await load();
    api.pushSubscribe.mockImplementationOnce(async () => ({ kind: 'lost' }));

    await appear(A);

    expect(readConsent(A).pending).toEqual({ label: LABEL_A, kind: 'enable' });
    const firstEndpoint = browser.channel!.endpoint;

    await appear(A);

    expect(api.pushSubscribe).toHaveBeenCalledTimes(2);
    expect(api.pushSubscribe.mock.calls[1][0]).toMatchObject({ deviceLabel: LABEL_A, endpoint: firstEndpoint, mode: 'upsert' });
    expect(readConsent(A)).toMatchObject({ state: 'enabled', label: LABEL_A, pending: null, endpoint: firstEndpoint });
    expect(server.subs.map((s) => [s.owner, s.deviceLabel])).toEqual([[A, LABEL_A]]);
  });

  test('a confirmed consent whose endpoint left the list registers by itself (US-8)', async () => {
    const a = channel('a');
    seed({ [A]: enabledConsent(LABEL_A, a, await keysFingerprint(a.keys)) });
    browser.channel = a;
    await load();

    await appear(A);

    expect(api.pushSubscribe).toHaveBeenCalledTimes(1);
    expect(api.pushSubscribe.mock.calls[0][0]).toMatchObject({ endpoint: a.endpoint, deviceLabel: LABEL_A, mode: 'upsert' });
    expect(server.subs.map((s) => [s.owner, s.endpoint, s.deviceLabel])).toEqual([[A, a.endpoint, LABEL_A]]);
  });
});

describe('rows 7 and 10 — the removal of the channel is journaled (US-2 "Repeats")', () => {
  test.each([
    { row: 7, listed: true },
    { row: 10, listed: false },
  ])('row $row: a failed removal leaves a localUnsubscribe work; the next page load without a user repeats it', async ({ listed }) => {
    const a = channel('a');
    browser.channel = a;
    browser.removeFails = true;
    if (listed) addSub(A, a.endpoint, null);
    seed({ [A]: { state: 'off', endpoint: a.endpoint } });
    await load();

    await appear(A);

    expect(browser.channel).toEqual(a);
    expect(readPushState().works).toEqual([expect.objectContaining({ type: 'localUnsubscribe', endpoint: a.endpoint })]);

    // A page load without a user.
    stopPushLifecycle();
    noteSignedOut();
    browser.removeFails = false;
    await load();

    expect(browser.channel).toBeNull();
    expect(readPushState().works).toEqual([]);
  });
});

describe('rule 8 — row 2 answered after a revocation of this device', () => {
  test('the channel the decision created is removed by it; "enabled" does not come back', async () => {
    seed({ [A]: enabledConsent(LABEL_A, channel('gone'), null) });
    await load();
    api.pushSubscribe.mockImplementationOnce(async (args: SubscribeArgs) => {
      const answer = await model.subscribe(args);
      // A logout in another tab: the revocation transition, without skein.push.op.
      await revokeConsent(A, { endpoint: null, guard: 'unconfirmed' });
      return answer;
    });

    await appear(A);

    expect(browserApi.createChannel).toHaveBeenCalledTimes(1);
    expect(browser.channel).toBeNull();
    expect(readConsent(A).state).toBe('off');
  });
});

// ───────────────────────── Row 54a ─────────────────────────

describe('row 54a — the key fingerprint and a channel that changed before the confirmation', () => {
  test('no recorded fingerprint: it is recorded from the channel, no key update is sent', async () => {
    const a = channel('a');
    addSub(A, a.endpoint, LABEL_A);
    seed({ [A]: enabledConsent(LABEL_A, a, null) });
    browser.channel = a;
    await load();

    await appear(A);

    expect(api.pushSubscribe).not.toHaveBeenCalled();
    expect(readConsent(A).keysFingerprint).toBe(await keysFingerprint(a.keys));
  });

  test('a different fingerprint: one update; until ok the old one stays and is updated again; after ok none is sent', async () => {
    const a = channel('a');
    addSub(A, a.endpoint, LABEL_A);
    seed({ [A]: enabledConsent(LABEL_A, a, 'old-fingerprint') });
    browser.channel = a;
    await load();
    api.pushSubscribe.mockImplementationOnce(async () => ({ kind: 'lost' }));

    await appear(A);

    expect(api.pushSubscribe).toHaveBeenCalledTimes(1);
    expect(api.pushSubscribe.mock.calls[0][0]).toMatchObject({ mode: 'updateOnly', deviceLabel: LABEL_A, keys: a.keys });
    expect(readConsent(A).keysFingerprint).toBe('old-fingerprint');

    await appear(A);

    expect(api.pushSubscribe).toHaveBeenCalledTimes(2);
    expect(readConsent(A).keysFingerprint).toBe(await keysFingerprint(a.keys));

    await appear(A);

    expect(api.pushSubscribe).toHaveBeenCalledTimes(2);
  });

  test.each([
    { case: 'disappeared', current: null as BrowserChannel | null },
    { case: 'changed', current: channel('other') },
  ])('an unconfirmed accept whose channel $case goes back to no mark, without a creation or an update', async ({ current }) => {
    seed({ [A]: enabledConsent(LABEL_A, channel('a'), null, { label: LABEL_A, kind: 'accept' }) });
    browser.channel = current;
    await load();

    await appear(A);

    expect(readConsent(A)).toMatchObject({ state: 'none', pending: null });
    expect(api.pushSubscribe).not.toHaveBeenCalled();
    expect(browserApi.createChannel).not.toHaveBeenCalled();
  });
});

describe('the push configuration of the server could not be read', () => {
  test('allows no registration (rule 9, as push off); the request carries the step signal', async () => {
    const a = channel('a');
    seed({ [A]: enabledConsent(LABEL_A, a, await keysFingerprint(a.keys)) });
    browser.channel = a;
    api.getPushConfig.mockRejectedValue(new Error('network'));
    await load();

    await appear(A);

    expect(api.getPushConfig).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(api.pushSubscribe).not.toHaveBeenCalled();
    expect(getPushLifecycleState().serverPush).toBe('unknown');
  });

  test('an empty key is "push off on the server": no registration', async () => {
    const a = channel('a');
    seed({ [A]: enabledConsent(LABEL_A, a, await keysFingerprint(a.keys)) });
    browser.channel = a;
    server.publicKey = '';
    await load();

    await appear(A);

    expect(api.pushSubscribe).not.toHaveBeenCalled();
    expect(getPushLifecycleState().serverPush).toBe('disabled');
  });
});

describe('what the settings are shown (US-3)', () => {
  test('row 0 (channel not read): the list and this device are published, nothing is done', async () => {
    const a = channel('a');
    addSub(A, a.endpoint, LABEL_A);
    seed({ [A]: enabledConsent(LABEL_A, a, null) });
    browser.readFails = true;
    await load();

    await appear(A);

    const shown = getPushLifecycleState();
    expect(shown).toMatchObject({ decided: false, row: 0, thisDeviceHash: await sha256(a.endpoint) });
    expect(shown.devices?.map((d) => d.deviceLabel)).toEqual([LABEL_A]);
    expect(api.pushSubscribe).not.toHaveBeenCalled();
  });

  test('row 7 removed this device but the list after it did not come: no stale list is shown', async () => {
    const a = channel('a');
    browser.channel = a;
    addSub(A, a.endpoint, null);
    seed({ [A]: { state: 'off', endpoint: a.endpoint } });
    await load();
    api.pushListDevices.mockImplementation(async (userId: string) =>
      api.pushListDevices.mock.calls.length > 1 ? { kind: 'lost' } : model.list(userId),
    );

    await appear(A);

    expect(server.subs).toEqual([]);
    expect(getPushLifecycleState()).toMatchObject({ decided: true, row: 7, devices: null });
  });

  test('after 5 → 2 the published device and list are the new channel\'s', async () => {
    seed({ [A]: enabledConsent(LABEL_A, channel('old'), null) });
    browser.channel = channel('renewed');
    await load();

    await appear(A);

    const shown = getPushLifecycleState();
    expect(browser.channel?.endpoint).toBe(channel('new-1').endpoint);
    expect(shown.thisDeviceHash).toBe(await sha256(channel('new-1').endpoint));
    expect(shown.devices?.map((d) => d.endpointHash)).toEqual([await sha256(channel('new-1').endpoint)]);
  });
});

// ───────────────────────── Row 55 ─────────────────────────

describe('row 55 — registrations only after the confirmation of the expected user (INV-2)', () => {
  test('a registration follows the list read of the same appearance', async () => {
    seed({ [A]: enabledConsent(LABEL_A, channel('gone'), null) });
    await load();

    await appear(A);

    expect(api.pushSubscribe).toHaveBeenCalledTimes(1);
    expect(api.pushListDevices).toHaveBeenCalledWith(A, expect.any(AbortSignal));
    expect(api.pushListDevices.mock.invocationCallOrder[0]).toBeLessThan(api.pushSubscribe.mock.invocationCallOrder[0]);
    expect(api.pushSubscribe.mock.calls[0][0].expectedUserId).toBe(A);
  });

  test.each([
    { case: 'no mark, no channel (row 8)', consent: {} as Partial<Consent>, current: null as BrowserChannel | null, listed: false },
    { case: 'off, no channel (row 8)', consent: { state: 'off' } as Partial<Consent>, current: null, listed: false },
    { case: 'off, own channel not listed (row 10)', consent: { state: 'off', endpoint: channel('a').endpoint } as Partial<Consent>, current: channel('a'), listed: false },
    { case: 'off, channel listed (row 7)', consent: { state: 'off' } as Partial<Consent>, current: channel('a'), listed: true },
    { case: 'no mark, foreign channel not listed (row 5)', consent: {} as Partial<Consent>, current: channel('a'), listed: false },
  ])('without an enabled consent and outside rows 6 and 9 there is no registration: $case', async ({ consent, current, listed }) => {
    if (listed && current !== null) addSub(A, current.endpoint, null);
    seed({ [A]: consent });
    browser.channel = current;
    await load();

    await appear(A);

    expect(getPushLifecycleState().decided).toBe(true);
    expect(api.pushSubscribe).not.toHaveBeenCalled();
    expect(browserApi.createChannel).not.toHaveBeenCalled();
  });

  test('without an appearance there is no push request', async () => {
    browser.channel = channel('a');
    seed({ [A]: enabledConsent(LABEL_A, channel('a'), null) });

    await load();

    expect(allPushCalls()).toBe(0);
    expect(api.getPushConfig).not.toHaveBeenCalled();
    expect(browserApi.createChannel).not.toHaveBeenCalled();
  });
});
