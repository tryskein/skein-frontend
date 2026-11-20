/**
 * Rows 63–67a — the push part of an explicit logout (spec US-4, INV-7,
 * SC-006, rule 5 with its exception for an explicit logout, rule 6; Edge 12,
 * 13; plan T014: one budget of 2 s on `prepare` and `finish`).
 *
 * Substituted: the push transport (`api/push.ts`, a model of the server's
 * push contract) and the browser adapter `browserPush.ts`. Real: the
 * departure, the controller, the locks over a substituted `navigator.locks`,
 * the push state over jsdom's localStorage, the appearance store. Time is
 * vitest's controlled clock; real work that is not time (hashing) is let run
 * by a real-timer flush.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { PushOutcome, RevokeDevicesArgs } from '../../api/push';
import { noteLogin, noteSignedOut } from '../../auth/appearance';
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
  settle,
  uninstallPushHarness,
} from '../../test/pushHarness';
import { PUSH_STORE_LOCK } from './locks';
import { PUSH_STATE_KEY, readConsent, readPushState } from './pushState';

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

import { beginExplicitDeparture, DEPARTURE_BUDGET_MS, type DepartureVerdict } from './departure';
import { startPushLifecycle, stopPushLifecycle } from './pushLifecycle';

const realSetTimeout = globalThis.setTimeout;

/** Lets real asynchronous work (not timers) run. */
async function flush(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => realSetTimeout(resolve, 0));
}

let locks: FakeLocks;

function never<T>(): Promise<T> {
  return new Promise<T>(() => undefined);
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

/** The click on "Log out" and the push part around `POST /api/auth/logout`. */
function clickLogout(): { done: () => boolean; verdict: Promise<DepartureVerdict> } {
  const departure = beginExplicitDeparture();
  let finished = false;
  const verdict = (async () => {
    const v = await departure.prepare();
    if (v === 'proceed') await departure.finish();
    finished = true;
    return v;
  })();
  return { done: () => finished, verdict };
}

/** U = A has appeared. */
function appearA(): void {
  server.caller = A;
  noteLogin(A);
}

beforeEach(() => {
  locks = new FakeLocks();
  installPushHarness(api, browserApi, locks);
});

afterEach(async () => {
  vi.useRealTimers();
  stopPushLifecycle();
  noteSignedOut();
  await settle(locks);
  uninstallPushHarness();
});

// ───────────────────────── Row 63 ─────────────────────────

describe('row 63 — the logout is held up by push for at most 2 s (INV-7, SC-006)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });

  test('push requests hang: the logout goes on at 2 s; a late answer sends nothing and writes nothing', async () => {
    seed({ [A]: enabledConsent(LABEL_A, channel('a'), null) });
    appearA();
    const list = deferred<PushOutcome<never>>();
    api.pushListDevices.mockImplementationOnce(() => list.promise);
    const stateBefore = localStorage.getItem(PUSH_STATE_KEY);

    const run = clickLogout();
    await flush();
    await vi.advanceTimersByTimeAsync(DEPARTURE_BUDGET_MS - 1);
    expect(run.done()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await flush();
    expect(run.done()).toBe(true);

    list.resolve({ kind: 'lost' });
    await flush();
    expect(api.pushRevokeDevices).not.toHaveBeenCalled();
    expect(localStorage.getItem(PUSH_STATE_KEY)).toBe(stateBefore);
  });

  test('the wait for skein.push.store hangs: the logout goes on at 2 s; a lock granted later writes nothing', async () => {
    seed({ [A]: enabledConsent(LABEL_A, channel('a'), null) });
    appearA();
    api.pushListDevices.mockImplementationOnce(async () => ({ kind: 'lost' }));
    const holder = deferred<void>();
    void locks.request(PUSH_STORE_LOCK, { mode: 'exclusive' }, () => holder.promise);
    const stateBefore = localStorage.getItem(PUSH_STATE_KEY);

    const run = clickLogout();
    await flush();
    await vi.advanceTimersByTimeAsync(DEPARTURE_BUDGET_MS - 1);
    expect(run.done()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await flush();
    expect(run.done()).toBe(true);

    holder.resolve();
    await flush();
    expect(localStorage.getItem(PUSH_STATE_KEY)).toBe(stateBefore);
    expect(api.pushRevokeDevices).not.toHaveBeenCalled();
  });

  test('the channel removal hangs: the logout goes on at 2 s; a late removal writes nothing', async () => {
    const a = channel('a');
    browser.channel = a;
    addSub(A, a.endpoint, LABEL_A);
    seed({ [A]: enabledConsent(LABEL_A, a, null) });
    appearA();
    const removal = deferred<'removed'>();
    browserApi.removeChannel.mockImplementationOnce(() => removal.promise);

    const run = clickLogout();
    await flush();
    expect(api.pushRevokeDevices).toHaveBeenCalledTimes(1);
    expect(browserApi.removeChannel).toHaveBeenCalledWith(a.endpoint);
    await vi.advanceTimersByTimeAsync(DEPARTURE_BUDGET_MS - 1);
    expect(run.done()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await flush();
    expect(run.done()).toBe(true);

    const stateAtDeadline = localStorage.getItem(PUSH_STATE_KEY);
    removal.resolve('removed');
    await flush();
    expect(localStorage.getItem(PUSH_STATE_KEY)).toBe(stateAtDeadline);
    expect(readPushState().works).toEqual([expect.objectContaining({ type: 'localUnsubscribe', endpoint: a.endpoint })]);
  });

  test('every push part hangs at once: still at most 2 s', async () => {
    seed({ [A]: enabledConsent(LABEL_A, channel('a'), null) });
    appearA();
    api.pushListDevices.mockImplementation(() => never());
    api.pushRevokeDevices.mockImplementation(() => never());
    browserApi.readChannel.mockImplementation(() => never());

    const run = clickLogout();
    await vi.advanceTimersByTimeAsync(DEPARTURE_BUDGET_MS);
    await flush();
    expect(run.done()).toBe(true);
    expect(await run.verdict).toBe('proceed');
  });
});

// ───────────────────────── Row 63a ─────────────────────────

describe('row 63a — branch (c): the body of the logout without a confirmation', () => {
  test('(1) empty S, channel not read: off, gen + 1, no deviceRevoke work, no push request', async () => {
    browser.readFails = true;
    appearA();
    api.pushListDevices.mockImplementationOnce(async () => ({ kind: 'lost' }));

    expect(await clickLogout().verdict).toBe('proceed');
    expect(readConsent(A)).toMatchObject({ state: 'off', gen: 1 });
    expect(readPushState().works).toEqual([]);
    expect(api.pushRevokeDevices).not.toHaveBeenCalled();
  });

  test('(2) empty S, channel read: exactly one revocation with this endpoint and no labels', async () => {
    const a = channel('a');
    browser.channel = a;
    appearA();
    api.pushListDevices.mockImplementationOnce(async () => ({ kind: 'lost' }));
    api.pushRevokeDevices.mockImplementationOnce(async () => ({ kind: 'lost' }));

    await clickLogout().verdict;
    expect(revocationBodies()).toEqual([{ expectedUserId: A, deviceLabels: [], endpoint: a.endpoint }]);
  });

  test('(3) |S| = 1000: exactly one revocation with all 1000 labels', async () => {
    const labels = Array.from({ length: 1000 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    seed({ [A]: { state: 'none', labels } });
    appearA();
    api.pushListDevices.mockImplementationOnce(async () => ({ kind: 'lost' }));
    api.pushRevokeDevices.mockImplementationOnce(async () => ({ kind: 'lost' }));

    await clickLogout().verdict;
    expect(revocationBodies()).toHaveLength(1);
    expect(new Set(revocationBodies()[0].deviceLabels)).toEqual(new Set(labels));
  });
});

// ───────────────────────── Row 64 ─────────────────────────

describe('row 64 — the three branches of prepare', () => {
  test('(a) confirmed: the server part of the revocation in prepare, the channel removal in finish', async () => {
    const a = channel('a');
    browser.channel = a;
    addSub(A, a.endpoint, LABEL_A);
    seed({ [A]: enabledConsent(LABEL_A, a, null) });
    appearA();

    const departure = beginExplicitDeparture();
    expect(await departure.prepare()).toBe('proceed');
    expect(revocationBodies()).toEqual([{ expectedUserId: A, deviceLabels: [LABEL_A], endpoint: a.endpoint }]);
    expect(browserApi.removeChannel).not.toHaveBeenCalled();

    await departure.finish();
    expect(browserApi.removeChannel).toHaveBeenCalledWith(a.endpoint);
    expect(browser.channel).toBeNull();
    expect(readPushState().works).toEqual([]);
    expect(readConsent(A)).toMatchObject({ state: 'off', offUnconfirmed: false });
  });

  test('(b) "user changed": the push part stops; nothing is written, revoked or removed', async () => {
    const a = channel('a');
    browser.channel = a;
    seed({ [A]: enabledConsent(LABEL_A, a, null), [B]: enabledConsent(LABEL_B, channel('b'), null) });
    appearA();
    server.caller = B;
    const stateBefore = localStorage.getItem(PUSH_STATE_KEY);

    expect(await clickLogout().verdict).toBe('userChanged');
    expect(localStorage.getItem(PUSH_STATE_KEY)).toBe(stateBefore);
    expect(api.pushRevokeDevices).not.toHaveBeenCalled();
    expect(browserApi.removeChannel).not.toHaveBeenCalled();
  });

  test.each(['lost', 'sessionEnded'] as const)(
    '(c) %s on the confirmation: U off, gen + 1, a work guarded unconfirmed, the channel kept, B untouched',
    async (kind) => {
      const a = channel('a');
      browser.channel = a;
      seed({ [A]: enabledConsent(LABEL_A, a, null), [B]: enabledConsent(LABEL_B, channel('b'), null) });
      appearA();
      api.pushListDevices.mockImplementationOnce(async () => ({ kind }));
      api.pushRevokeDevices.mockImplementationOnce(async () => ({ kind }));
      const consentOfB = readConsent(B);

      expect(await clickLogout().verdict).toBe('proceed');
      expect(readConsent(A)).toMatchObject({ state: 'off', gen: 1, labels: [] });
      expect(readPushState().works).toEqual([
        expect.objectContaining({ type: 'deviceRevoke', ownerUserId: A, labels: [LABEL_A], endpoint: a.endpoint, guard: 'unconfirmed' }),
      ]);
      expect(browser.channel).toEqual(a);
      expect(browserApi.removeChannel).not.toHaveBeenCalled();
      expect(readConsent(B)).toEqual(consentOfB);
    },
  );

  test('(c) ok of the revocation within the budget: the work is finished and the channel removed', async () => {
    const a = channel('a');
    browser.channel = a;
    addSub(A, a.endpoint, LABEL_A);
    seed({ [A]: enabledConsent(LABEL_A, a, null) });
    appearA();
    api.pushListDevices.mockImplementationOnce(async () => ({ kind: 'lost' }));

    expect(await clickLogout().verdict).toBe('proceed');
    expect(revocationBodies()).toEqual([{ expectedUserId: A, deviceLabels: [LABEL_A], endpoint: a.endpoint }]);
    expect(readPushState().works).toEqual([]);
    expect(browser.channel).toBeNull();
    expect(server.subs).toEqual([]);
  });
});

// ───────────────────────── Row 65 ─────────────────────────

describe('row 65 — the appearance grows after the click', () => {
  test('a new login before the nearest effect: no state write, no further request, no channel removal', async () => {
    const a = channel('a');
    browser.channel = a;
    addSub(A, a.endpoint, LABEL_A);
    seed({ [A]: enabledConsent(LABEL_A, a, null) });
    appearA();
    api.pushListDevices.mockImplementationOnce(async (userId: string) => {
      const listed = await model.list(userId);
      noteLogin(A);
      return listed;
    });
    const stateBefore = localStorage.getItem(PUSH_STATE_KEY);

    expect(await clickLogout().verdict).toBe('proceed');
    expect(localStorage.getItem(PUSH_STATE_KEY)).toBe(stateBefore);
    expect(allPushCalls()).toBe(1);
    expect(browserApi.removeChannel).not.toHaveBeenCalled();
  });
});

// ───────────────────────── Row 66 ─────────────────────────

describe('row 66 — after branch (c) the next appearance of U repeats the revocation (rule 6)', () => {
  test('another user does not call the server for it; U finishes it with ok', async () => {
    const a = channel('a');
    browser.channel = a;
    addSub(A, a.endpoint, LABEL_A);
    seed({ [A]: enabledConsent(LABEL_A, a, null) });
    appearA();
    api.pushListDevices.mockImplementationOnce(async () => ({ kind: 'lost' }));
    api.pushRevokeDevices.mockImplementationOnce(async () => ({ kind: 'lost' }));
    await clickLogout().verdict;
    expect(readPushState().works).toHaveLength(1);
    api.pushRevokeDevices.mockClear();
    api.pushRemoveChannel.mockClear();

    noteSignedOut();
    startPushLifecycle();
    server.caller = B;
    noteLogin(B);
    await settle(locks);

    expect(api.pushRevokeDevices).not.toHaveBeenCalled();
    expect(api.pushRemoveChannel).not.toHaveBeenCalledWith(expect.objectContaining({ ifSubscription: expect.anything() }), expect.anything());
    expect(readPushState().works.filter((w) => w.type === 'deviceRevoke')).toHaveLength(1);

    server.caller = A;
    noteLogin(A);
    await settle(locks);

    expect(api.pushRevokeDevices).toHaveBeenCalledWith(
      { expectedUserId: A, deviceLabels: [LABEL_A], endpoint: a.endpoint },
      expect.any(AbortSignal),
    );
    expect(readPushState().works.filter((w) => w.type === 'deviceRevoke')).toEqual([]);
  });
});

// ───────────────────────── Row 67 ─────────────────────────

describe('row 67 — without push support (Edge 13)', () => {
  test('the logout goes on at once, without a push request', async () => {
    browserApi.browserPushSupported.mockReturnValue(false);
    seed({ [A]: enabledConsent(LABEL_A, channel('a'), null) });
    appearA();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const stateBefore = localStorage.getItem(PUSH_STATE_KEY);

    const run = clickLogout();
    expect(await run.verdict).toBe('proceed');
    expect(run.done()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(allPushCalls()).toBe(0);
    expect(locks.requests).toEqual([]);
    expect(localStorage.getItem(PUSH_STATE_KEY)).toBe(stateBefore);
  });
});

// ───────────────────────── Row 67a ─────────────────────────

describe('row 67a — push disabled on the server (Edge 12)', () => {
  test('an explicit logout still turns the consent off and revokes its label', async () => {
    server.publicKey = '';
    addSub(A, channel('a').endpoint, LABEL_A);
    seed({ [A]: enabledConsent(LABEL_A, channel('a'), null) });
    appearA();

    expect(await clickLogout().verdict).toBe('proceed');
    expect(readConsent(A).state).toBe('off');
    expect(revocationBodies()).toEqual([{ expectedUserId: A, deviceLabels: [LABEL_A], endpoint: undefined }]);
  });
});
