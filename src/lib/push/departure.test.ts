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
import { PUSH_OP_LOCK, PUSH_STORE_LOCK } from './locks';
import { beginConsentLabel, type Consent, emptyConsent, PUSH_STATE_KEY, readConsent, readPushState } from './pushState';

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

/** `hang` makes the fingerprint of an endpoint never come. */
const fingerprint = vi.hoisted(() => ({ hang: false }));

vi.mock('./fingerprint', async (importOriginal) => {
  const real = await importOriginal<typeof import('./fingerprint')>();
  return {
    ...real,
    endpointFingerprint: (endpoint: string) =>
      fingerprint.hang ? new Promise<string>(() => undefined) : real.endpointFingerprint(endpoint),
  };
});

import {
  beginExplicitDeparture,
  departAfterAccountDeletion,
  DEPARTURE_BUDGET_MS,
  DEPARTURE_CONFIRM_MS,
  DEPARTURE_PREPARE_MS,
  type DepartureVerdict,
} from './departure';
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

/**
 * Lets the hold of the logout's works end (pushState.ts#isHeld): the next
 * appearance or page load comes later than the logout's budget.
 */
function afterTheHold(): void {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.now() + DEPARTURE_BUDGET_MS + 1);
}

/** U = A has appeared. */
function appearA(): void {
  server.caller = A;
  noteLogin(A);
}

/** The consent as the decision table sees it: without its generation and revision. */
const effective = (consent: Consent) => ({ ...consent, gen: 0, rev: 0 });

beforeEach(() => {
  locks = new FakeLocks();
  installPushHarness(api, browserApi, locks);
  fingerprint.hang = false;
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

  test('push requests hang: at 1.5 s the consent goes off with an unconfirmed revocation; the logout goes on by 1.75 s; late answers change nothing', async () => {
    seed({ [A]: enabledConsent(LABEL_A, channel('a'), null) });
    appearA();
    const list = deferred<PushOutcome<never>>();
    api.pushListDevices.mockImplementationOnce(() => list.promise);
    const revocation = deferred<PushOutcome>();
    api.pushRevokeDevices.mockImplementationOnce(() => revocation.promise);

    const run = clickLogout();
    await flush();
    await vi.advanceTimersByTimeAsync(DEPARTURE_CONFIRM_MS);
    await flush();
    // Rule 5, the explicit logout without a confirmation: U's consent is off
    // and the revocation is recorded within the budget.
    expect(readConsent(A)).toMatchObject({ state: 'off', gen: 1, labels: [] });
    expect(readPushState().works).toEqual([
      expect.objectContaining({ type: 'deviceRevoke', ownerUserId: A, labels: [LABEL_A], guard: 'unconfirmed' }),
    ]);
    expect(api.pushRevokeDevices).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(DEPARTURE_PREPARE_MS - DEPARTURE_CONFIRM_MS - 1);
    expect(run.done()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await flush();
    expect(run.done()).toBe(true);

    const stateAtDeadline = localStorage.getItem(PUSH_STATE_KEY);
    list.resolve({ kind: 'lost' });
    revocation.resolve({ kind: 'ok', value: undefined });
    await flush();
    expect(api.pushRevokeDevices).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(PUSH_STATE_KEY)).toBe(stateAtDeadline);
  });

  test('the wait for skein.push.store hangs: the logout goes on by 1.5 s; the transition lands once the lock comes, no request after the deadline', async () => {
    seed({ [A]: enabledConsent(LABEL_A, channel('a'), null) });
    appearA();
    api.pushListDevices.mockImplementationOnce(async () => ({ kind: 'lost' }));
    const holder = deferred<void>();
    void locks.request(PUSH_STORE_LOCK, { mode: 'exclusive' }, () => holder.promise);

    const run = clickLogout();
    await flush();
    // Without the transition by the end of the confirmation nothing else can
    // be written: the server part ends there.
    await vi.advanceTimersByTimeAsync(DEPARTURE_CONFIRM_MS - 1);
    expect(run.done()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await flush();
    expect(run.done()).toBe(true);
    expect(await run.verdict).toBe('proceed');

    // The local part of the revocation is not given up with the budget: the
    // next appearance of U finishes the work it leaves.
    holder.resolve();
    await flush();
    expect(readConsent(A)).toMatchObject({ state: 'off', gen: 1, labels: [] });
    expect(readPushState().works).toEqual([
      expect.objectContaining({ type: 'deviceRevoke', ownerUserId: A, labels: [LABEL_A], guard: 'unconfirmed' }),
    ]);
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
    expect(browserApi.removeChannel.mock.calls.map((c) => c[0])).toContain(a.endpoint);
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

  test('the list confirms U but the revocation does not answer: the known channel is removed within 2 s', async () => {
    const a = channel('a');
    browser.channel = a;
    addSub(A, a.endpoint, LABEL_A);
    seed({ [A]: enabledConsent(LABEL_A, a, null) });
    appearA();
    api.pushRevokeDevices.mockImplementation(() => never());

    const run = clickLogout();
    await flush();
    await vi.advanceTimersByTimeAsync(DEPARTURE_PREPARE_MS);
    await flush();
    await vi.advanceTimersByTimeAsync(DEPARTURE_BUDGET_MS - DEPARTURE_PREPARE_MS);
    await flush();

    expect(run.done()).toBe(true);
    expect(browser.channel).toBeNull();
    // The revocation stays recorded for the next appearance of U.
    expect(readPushState().works).toEqual([
      expect.objectContaining({ type: 'deviceRevoke', ownerUserId: A, labels: [LABEL_A], endpoint: a.endpoint }),
    ]);
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
    // Neither the list nor the channel came: the consent is off all the same.
    expect(readConsent(A)).toMatchObject({ state: 'off', gen: 1 });
    expect(readPushState().works).toEqual([
      expect.objectContaining({ type: 'deviceRevoke', labels: [LABEL_A], guard: 'unconfirmed' }),
    ]);
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

  test('(2) empty S, a channel U\'s consent does not name: no work, no request with its endpoint (row 7 removes it later)', async () => {
    const a = channel('a');
    browser.channel = a;
    appearA();
    api.pushListDevices.mockImplementationOnce(async () => ({ kind: 'lost' }));

    expect(await clickLogout().verdict).toBe('proceed');
    expect(readPushState().works).toEqual([]);
    expect(api.pushRevokeDevices).not.toHaveBeenCalled();
  });

  test('(2a) the channel read is another one than U\'s consent names: the revocation carries U\'s labels only', async () => {
    browser.channel = channel('b');
    seed({ [A]: enabledConsent(LABEL_A, channel('a'), null) });
    appearA();
    api.pushListDevices.mockImplementationOnce(async () => ({ kind: 'lost' }));
    api.pushRevokeDevices.mockImplementationOnce(async () => ({ kind: 'lost' }));

    await clickLogout().verdict;
    expect(revocationBodies()).toEqual([{ expectedUserId: A, deviceLabels: [LABEL_A], endpoint: undefined }]);
    expect(readPushState().works).toEqual([expect.objectContaining({ type: 'deviceRevoke', labels: [LABEL_A] })]);
    expect(readPushState().works[0]).not.toHaveProperty('endpoint');
    expect(browser.channel).toEqual(channel('b'));
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
    expect(browserApi.removeChannel.mock.calls.map((c) => c[0])).toContain(a.endpoint);
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
    const consentOfA = readConsent(A);
    const consentOfB = readConsent(B);

    expect(await clickLogout().verdict).toBe('userChanged');
    await settle(locks);
    // The transition written in the click is taken back: only the generation moved on.
    expect(effective(readConsent(A))).toEqual(effective(consentOfA));
    expect(readConsent(B)).toEqual(consentOfB);
    expect(readPushState().works).toEqual([]);
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

  test('(c) ok of the revocation within the budget: the channel is removed; the work waits for the owner\'s list', async () => {
    const a = channel('a');
    browser.channel = a;
    addSub(A, a.endpoint, LABEL_A);
    seed({ [A]: enabledConsent(LABEL_A, a, null) });
    appearA();
    api.pushListDevices.mockImplementationOnce(async () => ({ kind: 'lost' }));

    expect(await clickLogout().verdict).toBe('proceed');
    expect(revocationBodies()).toEqual([{ expectedUserId: A, deviceLabels: [LABEL_A], endpoint: a.endpoint }]);
    expect(readPushState().works).toEqual([
      expect.objectContaining({ type: 'deviceRevoke', ownerUserId: A, endpoint: a.endpoint, guard: 'unconfirmed' }),
    ]);
    expect(browser.channel).toBeNull();
    expect(server.subs).toEqual([]);
  });

  test('(c) ok of a revocation by endpoint whose subscription carries an unknown label: the next appearance of U removes it', async () => {
    const a = channel('a');
    browser.channel = a;
    // An earlier disable kept the endpoint but S lost the label: empty S, a labelled subscription.
    addSub(A, a.endpoint, LABEL_A);
    seed({ [A]: { state: 'off', gen: 1, endpoint: a.endpoint, offUnconfirmed: true } });
    appearA();
    api.pushListDevices.mockImplementationOnce(async () => ({ kind: 'lost' }));

    expect(await clickLogout().verdict).toBe('proceed');
    expect(server.subs).toHaveLength(1);
    expect(readPushState().works).toEqual([
      expect.objectContaining({ type: 'deviceRevoke', ownerUserId: A, labels: [], endpoint: a.endpoint }),
    ]);

    noteSignedOut();
    afterTheHold();
    startPushLifecycle();
    appearA();
    await settle(locks);

    expect(server.subs).toEqual([]);
    expect(readPushState().works).toEqual([]);
  });
});

describe('row 64 (c) — after ok the removal of the channel is journaled', () => {
  test('a failed removal leaves a localUnsubscribe work; the next page load without a user repeats it', async () => {
    const a = channel('a');
    browser.channel = a;
    browser.removeFails = true;
    addSub(A, a.endpoint, LABEL_A);
    seed({ [A]: enabledConsent(LABEL_A, a, null) });
    appearA();
    api.pushListDevices.mockImplementationOnce(async () => ({ kind: 'lost' }));

    expect(await clickLogout().verdict).toBe('proceed');
    expect(browser.channel).toEqual(a);
    expect(readPushState().works).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'localUnsubscribe', endpoint: a.endpoint })]),
    );

    noteSignedOut();
    browser.removeFails = false;
    afterTheHold();
    startPushLifecycle();
    await settle(locks);

    expect(browser.channel).toBeNull();
    expect(readPushState().works.filter((w) => w.type === 'localUnsubscribe')).toEqual([]);
  });
});

describe('row 64 (a) — a channel the browser has besides the confirmed one', () => {
  test('is not removed: another tab accepted it for the user who appeared since', async () => {
    const a = channel('a');
    browser.channel = a;
    addSub(A, a.endpoint, LABEL_A);
    seed({ [A]: enabledConsent(LABEL_A, a, null) });
    appearA();
    const remove = browserApi.removeChannel.getMockImplementation()!;
    browserApi.removeChannel.mockImplementationOnce(async (endpoint: string, precondition?: () => void) => {
      const result = await remove(endpoint, precondition);
      // Another tab: B appeared and its decision created B's channel.
      browser.channel = channel('b-new');
      return result;
    });

    expect(await clickLogout().verdict).toBe('proceed');
    expect(browser.channel).toEqual(channel('b-new'));
    expect(browserApi.removeChannel.mock.calls.map((c) => c[0])).toEqual([a.endpoint]);
  });
});

// ───────────────────────── Row 65 ─────────────────────────

describe('row 64 (b) — "user changed" on the revocation after the list confirmed U', () => {
  test('no logout, and the revocation transition is taken back', async () => {
    const a = channel('a');
    browser.channel = a;
    addSub(A, a.endpoint, LABEL_A);
    seed({ [A]: enabledConsent(LABEL_A, a, null) });
    appearA();
    const consentBefore = readConsent(A);
    api.pushRevokeDevices.mockImplementationOnce(async () => ({ kind: 'userChanged' }));

    expect(await clickLogout().verdict).toBe('userChanged');
    // Taking the transition back follows the verdict.
    await settle(locks);
    // The generation moves on (an enable started before stays refused, rule 8); the rest is as before.
    expect({ ...readConsent(A), rev: 0, gen: 0 }).toEqual({ ...consentBefore, rev: 0, gen: 0 });
    expect(readPushState().works).toEqual([]);
    expect(browser.channel).toEqual(a);
  });
});

describe('row 65 — the appearance grows after the click', () => {
  test('a new login after the click, before the revocation request: no request, no removal; the transition is taken back', async () => {
    const a = channel('a');
    browser.channel = a;
    addSub(A, a.endpoint, LABEL_A);
    seed({ [A]: enabledConsent(LABEL_A, a, null) });
    appearA();
    const consentBefore = readConsent(A);
    api.pushListDevices.mockImplementationOnce(async (userId: string) => {
      const listed = await model.list(userId);
      noteLogin(A);
      return listed;
    });

    expect(await clickLogout().verdict).toBe('superseded');
    await settle(locks);
    expect(effective(readConsent(A))).toEqual(effective(consentBefore));
    expect(readPushState().works).toEqual([]);
    expect(allPushCalls()).toBe(1);
    expect(browserApi.removeChannel).not.toHaveBeenCalled();
  });
});

describe('row 64 (b) — "user changed" that arrives as the step ends', () => {
  test('a list answer after the confirmation ran out is still "user changed": the logout does not go on', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    seed({ [A]: enabledConsent(LABEL_A, channel('a'), null) });
    appearA();
    const list = deferred<PushOutcome<never>>();
    api.pushListDevices.mockImplementationOnce(() => list.promise);
    api.pushRevokeDevices.mockImplementationOnce(() => never());

    const run = clickLogout();
    await flush();
    await vi.advanceTimersByTimeAsync(DEPARTURE_CONFIRM_MS + 100);
    list.resolve({ kind: 'userChanged' });
    await flush();

    expect(await run.verdict).toBe('userChanged');
    // The revocation was sent and its answer is unknown: the list's "user
    // changed" is no proof that it did not reach the server.
    vi.useRealTimers();
    await settle(locks);
    expect(readConsent(A)).toMatchObject({ state: 'off', labels: [] });
    expect(readPushState().works).toEqual([
      expect.objectContaining({ type: 'deviceRevoke', ownerUserId: A, labels: [LABEL_A] }),
    ]);
  });

  test('the revocation is lost, then an earlier work of U is refused as "user changed": no logout, the transition and both works stay', async () => {
    const a = channel('a');
    browser.channel = a;
    addSub(A, a.endpoint, LABEL_A);
    seed({ [A]: enabledConsent(LABEL_A, a, null) }, [
      { id: 'w0', type: 'deviceRevoke', ownerUserId: A, labels: ['cccccccc-0000-4000-8000-000000000003'], guard: 'absent' },
    ]);
    appearA();
    api.pushRevokeDevices
      .mockImplementationOnce(async () => ({ kind: 'lost' }))
      .mockImplementationOnce(async () => ({ kind: 'userChanged' }));

    expect(await clickLogout().verdict).toBe('userChanged');
    await settle(locks);
    expect(readConsent(A)).toMatchObject({ state: 'off', labels: [] });
    const revocations = readPushState().works.filter((w) => w.type === 'deviceRevoke');
    expect(revocations).toHaveLength(2);
    expect(revocations).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'w0' }), expect.objectContaining({ labels: [LABEL_A], endpoint: a.endpoint })]),
    );
  });
});

describe('row 65 — the appearance grows while a write waits for skein.push.store', () => {
  test('a new login of the same user before the lock is granted: nothing is written', async () => {
    seed({ [A]: enabledConsent(LABEL_A, channel('a'), null) });
    appearA();
    api.pushListDevices.mockImplementationOnce(async () => ({ kind: 'lost' }));
    const holder = deferred<void>();
    void locks.request(PUSH_STORE_LOCK, { mode: 'exclusive' }, () => holder.promise);
    const stateBefore = localStorage.getItem(PUSH_STATE_KEY);

    const run = clickLogout();
    for (let i = 0; i < 20; i += 1) await new Promise((r) => setTimeout(r, 0));
    noteLogin(A);
    holder.resolve();
    await run.verdict;
    for (let i = 0; i < 20; i += 1) await new Promise((r) => setTimeout(r, 0));

    expect(localStorage.getItem(PUSH_STATE_KEY)).toBe(stateBefore);
    expect(api.pushRevokeDevices).not.toHaveBeenCalled();
  });
});

// ───────────────────────── The model of the explicit logout ─────────────────────────

describe('row 64 — the local part of the revocation is written before anything that may end the logout', () => {
  test('a 401 of another request signs the page out during the logout: U is still off with an unfinished revocation', async () => {
    seed({ [A]: enabledConsent(LABEL_A, channel('a'), null) });
    appearA();
    api.pushListDevices.mockImplementationOnce(async () => ({ kind: 'sessionEnded' }));
    api.pushRevokeDevices.mockImplementationOnce(async () => ({ kind: 'sessionEnded' }));
    const holder = deferred<void>();
    void locks.request(PUSH_STORE_LOCK, { mode: 'exclusive' }, () => holder.promise);

    const run = clickLogout();
    // The 401 handler: no user is confirmed any more, nobody else appeared.
    noteSignedOut();
    holder.resolve();

    expect(await run.verdict).toBe('proceed');
    expect(readConsent(A)).toMatchObject({ state: 'off', gen: 1, labels: [] });
    expect(readPushState().works).toEqual([
      expect.objectContaining({ type: 'deviceRevoke', ownerUserId: A, labels: [LABEL_A], guard: 'unconfirmed' }),
    ]);
  });
});

describe('row 64 (b) — the verdict is fixed when "user changed" arrives', () => {
  test('the undo waits for skein.push.store past 1.75 s: the verdict stays "user changed", the logout does not go', async () => {
    const a = channel('a');
    browser.channel = a;
    addSub(A, a.endpoint, LABEL_A);
    seed({ [A]: enabledConsent(LABEL_A, a, null) });
    appearA();
    const consentBefore = readConsent(A);
    const holder = deferred<void>();
    api.pushRevokeDevices.mockImplementationOnce(async () => {
      // Another tab takes the store lock and keeps it past the deadline.
      void locks.request(PUSH_STORE_LOCK, { mode: 'exclusive' }, () => holder.promise);
      return { kind: 'userChanged' };
    });

    const departure = beginExplicitDeparture();
    expect(await departure.prepare()).toBe('userChanged');
    await new Promise((r) => realSetTimeout(r, DEPARTURE_PREPARE_MS + 50));
    expect(departure.refusal()).toBe('userChanged');

    holder.resolve();
    await settle(locks);
    expect(effective(readConsent(A))).toEqual(effective(consentBefore));
    expect(readPushState().works).toEqual([]);
    expect(browser.channel).toEqual(a);
  });

  test('"user changed" after the verdict, before the logout request: the request must not go; the transition is taken back', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    seed({ [A]: enabledConsent(LABEL_A, channel('a'), null) });
    appearA();
    const consentBefore = readConsent(A);
    api.pushListDevices.mockImplementationOnce(async () => ({ kind: 'lost' }));
    const revocation = deferred<PushOutcome>();
    api.pushRevokeDevices.mockImplementationOnce(() => revocation.promise);

    const departure = beginExplicitDeparture();
    await flush();
    await vi.advanceTimersByTimeAsync(DEPARTURE_PREPARE_MS);
    expect(await departure.prepare()).toBe('proceed');
    expect(departure.refusal()).toBeNull();

    // The logout request waits for the network; the revocation answers now.
    revocation.resolve({ kind: 'userChanged' });
    await flush();
    expect(departure.refusal()).toBe('userChanged');
    departure.cancel();
    vi.useRealTimers();
    await settle(locks);
    expect(effective(readConsent(A))).toEqual(effective(consentBefore));
    expect(readPushState().works).toEqual([]);
  });

  test('(c) "user changed" on the revocation without a confirmation: the transition is taken back', async () => {
    const a = channel('a');
    browser.channel = a;
    seed({ [A]: enabledConsent(LABEL_A, a, null) });
    appearA();
    const consentBefore = readConsent(A);
    api.pushListDevices.mockImplementationOnce(async () => ({ kind: 'lost' }));
    api.pushRevokeDevices.mockImplementationOnce(async () => ({ kind: 'userChanged' }));

    expect(await clickLogout().verdict).toBe('userChanged');
    await settle(locks);
    expect(effective(readConsent(A))).toEqual(effective(consentBefore));
    expect(readPushState().works).toEqual([]);
    expect(browser.channel).toEqual(a);
  });
});

describe('row 64 (b) — a refused logout takes its transition back before anyone performs it', () => {
  test('the take-back waits for skein.push.store: the op lock is still the logout\'s until the transition is back', async () => {
    const a = channel('a');
    browser.channel = a;
    addSub(A, a.endpoint, LABEL_A);
    seed({ [A]: enabledConsent(LABEL_A, a, null) });
    appearA();
    const consentBefore = readConsent(A);
    const holder = deferred<void>();
    api.pushRevokeDevices.mockImplementationOnce(async () => {
      void locks.request(PUSH_STORE_LOCK, { mode: 'exclusive' }, () => holder.promise);
      return { kind: 'userChanged' };
    });

    expect(await clickLogout().verdict).toBe('userChanged');
    // Another tab of A asks for the op lock to repeat the journal.
    let seen: Consent | null = null;
    let worksSeen: unknown[] = [];
    const other = locks.request(PUSH_OP_LOCK, { mode: 'exclusive' }, async () => {
      seen = readConsent(A);
      worksSeen = readPushState().works;
    });
    await flush();
    expect(seen).toBeNull();

    holder.resolve();
    await other;
    expect(effective(seen!)).toEqual(effective(consentBefore));
    expect(worksSeen).toEqual([]);
  });

  test('a work an explicit logout still holds is not repeated by an appearance; once the hold ends it is', async () => {
    const heldUntil = Date.now() + 60_000;
    seed({ [A]: { state: 'off', gen: 1 } }, [
      { id: 'w', type: 'deviceRevoke', ownerUserId: A, labels: [LABEL_A], guard: 'unconfirmed', heldUntil },
    ]);
    startPushLifecycle();
    appearA();
    await settle(locks);
    expect(api.pushRevokeDevices).not.toHaveBeenCalled();

    seed({ [A]: { state: 'off', gen: 1 } }, [
      { id: 'w', type: 'deviceRevoke', ownerUserId: A, labels: [LABEL_A], guard: 'unconfirmed', heldUntil: Date.now() - 1 },
    ]);
    noteLogin(A);
    await settle(locks);
    expect(api.pushRevokeDevices).toHaveBeenCalledWith(
      { expectedUserId: A, deviceLabels: [LABEL_A], endpoint: undefined },
      expect.any(AbortSignal),
    );
    expect(readPushState().works).toEqual([]);
  });

  test('a take-back after the hold ended changes nothing', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    seed({ [A]: enabledConsent(LABEL_A, channel('a'), null) });
    appearA();
    api.pushListDevices.mockImplementationOnce(async () => ({ kind: 'lost' }));
    const revocation = deferred<PushOutcome>();
    api.pushRevokeDevices.mockImplementationOnce(() => revocation.promise);

    const departure = beginExplicitDeparture();
    await flush();
    await vi.advanceTimersByTimeAsync(DEPARTURE_BUDGET_MS + 10);
    revocation.resolve({ kind: 'userChanged' });
    await flush();
    departure.cancel();
    await flush();

    expect(readConsent(A)).toMatchObject({ state: 'off', labels: [] });
    expect(readPushState().works).toEqual([expect.objectContaining({ type: 'deviceRevoke', labels: [LABEL_A] })]);
  });
});

describe('row 64 (a) — the logout holds skein.push.op; it removes only the channel read under it and named by the confirmation', () => {
  test('another tab made B\'s channel before the lock came to this logout: it is not removed, its endpoint is not revoked', async () => {
    const a = channel('a');
    const b = channel('b');
    browser.channel = a;
    addSub(A, a.endpoint, LABEL_A);
    seed({ [A]: enabledConsent(LABEL_A, a, null) });
    appearA();
    // B's tab holds the op lock: its decision replaces the channel with B's.
    const holder = deferred<void>();
    void locks.request(PUSH_OP_LOCK, { mode: 'exclusive' }, async () => {
      await holder.promise;
      browser.channel = b;
      const record = JSON.parse(localStorage.getItem(PUSH_STATE_KEY)!);
      record.consents[B] = { ...emptyConsent(), ...enabledConsent(LABEL_B, b, null) };
      localStorage.setItem(PUSH_STATE_KEY, JSON.stringify(record));
    });

    const run = clickLogout();
    await flush();
    holder.resolve();

    expect(await run.verdict).toBe('proceed');
    await flush();
    expect(browser.channel).toEqual(b);
    expect(browserApi.removeChannel).not.toHaveBeenCalled();
    expect(revocationBodies()).toEqual([{ expectedUserId: A, deviceLabels: [LABEL_A], endpoint: undefined }]);
  });

  test('another tab waits for skein.push.op while the logout holds it, until the channel is removed', async () => {
    const a = channel('a');
    browser.channel = a;
    addSub(A, a.endpoint, LABEL_A);
    seed({ [A]: enabledConsent(LABEL_A, a, null) });
    appearA();

    const departure = beginExplicitDeparture();
    expect(await departure.prepare()).toBe('proceed');
    let otherRan = false;
    const other = locks.request(PUSH_OP_LOCK, { mode: 'exclusive' }, async () => {
      otherRan = true;
      expect(browser.channel).toBeNull();
    });
    await flush();
    expect(otherRan).toBe(false);

    await departure.finish();
    await other;
    expect(otherRan).toBe(true);
  });

  test('a logout refused while it waits for skein.push.op withdraws the request: no late grant reads the channel', async () => {
    const a = channel('a');
    browser.channel = a;
    seed({ [A]: enabledConsent(LABEL_A, a, null) });
    appearA();
    server.caller = B;
    const holder = deferred<void>();
    void locks.request(PUSH_OP_LOCK, { mode: 'exclusive' }, () => holder.promise);

    expect(await clickLogout().verdict).toBe('userChanged');
    await flush();
    holder.resolve();
    await settle(locks);

    expect(locks.requests.filter((name) => name === PUSH_OP_LOCK)).toHaveLength(2);
    expect(browserApi.readChannel).not.toHaveBeenCalled();
    expect(locks.idle()).toBe(true);
  });

  test('skein.push.op is not granted within 1.5 s: branch (c) without reading or removing the channel', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const a = channel('a');
    browser.channel = a;
    addSub(A, a.endpoint, LABEL_A);
    seed({ [A]: enabledConsent(LABEL_A, a, null) });
    appearA();
    const holder = deferred<void>();
    void locks.request(PUSH_OP_LOCK, { mode: 'exclusive' }, () => holder.promise);

    const run = clickLogout();
    await flush();
    await vi.advanceTimersByTimeAsync(DEPARTURE_BUDGET_MS);
    await flush();

    expect(await run.verdict).toBe('proceed');
    expect(browserApi.readChannel).not.toHaveBeenCalled();
    expect(browserApi.removeChannel).not.toHaveBeenCalled();
    expect(readConsent(A)).toMatchObject({ state: 'off', gen: 1 });
    expect(revocationBodies()).toEqual([{ expectedUserId: A, deviceLabels: [LABEL_A], endpoint: undefined }]);
    holder.resolve();
  });

  test('the fingerprint of the endpoint does not come within the confirmation: the transition stands, the channel stays', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const a = channel('a');
    browser.channel = a;
    addSub(A, a.endpoint, LABEL_A);
    seed({ [A]: enabledConsent(LABEL_A, a, null) });
    appearA();
    fingerprint.hang = true;

    const run = clickLogout();
    await flush();
    await vi.advanceTimersByTimeAsync(DEPARTURE_BUDGET_MS);
    await flush();

    expect(await run.verdict).toBe('proceed');
    expect(readConsent(A)).toMatchObject({ state: 'off', gen: 1, labels: [] });
    expect(revocationBodies()).toEqual([{ expectedUserId: A, deviceLabels: [LABEL_A], endpoint: undefined }]);
    expect(browser.channel).toEqual(a);
  });
});

// ───────────────────────── Row 69 ─────────────────────────

describe('row 69 — the deletion of the account invalidates the owner\'s operations started before', () => {
  test('a first enable (gen 0) holds skein.push.op past the clean-up\'s wait: its later label is refused, the consent stays deleted', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    appearA();
    const holder = deferred<void>();
    let written: string | null = null;
    void locks.request(PUSH_OP_LOCK, { mode: 'exclusive' }, async () => {
      await holder.promise;
      written = await beginConsentLabel(A, { expect: { gen: 0 }, kind: 'enable', endpoint: channel('x').endpoint, keysFingerprint: null }).then(
        () => 'written',
        (error: Error) => error.name,
      );
    });

    const deletion = departAfterAccountDeletion(null, async () => ({ kind: 'none' }));
    await flush();
    await vi.advanceTimersByTimeAsync(DEPARTURE_BUDGET_MS);
    expect(await deletion).toBe('proceed');
    holder.resolve();
    await flush();

    expect(written).toBe('PushStateConflictError');
    expect(readConsent(A)).toMatchObject({ state: 'none', labels: [], gen: 1 });
    expect(browserApi.readChannel).not.toHaveBeenCalled();
  });
});

describe('row 69 — a clean-up without skein.push.op journals nothing', () => {
  test('B accepts X after the clean-up of A gave up the lock: no work of A removes X later', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const x = channel('x');
    browser.channel = x;
    seed({ [A]: enabledConsent(LABEL_A, x, null) });
    appearA();
    // B's decision holds the op lock past the clean-up's wait, then accepts X.
    const holder = deferred<void>();
    void locks.request(PUSH_OP_LOCK, { mode: 'exclusive' }, async () => {
      await holder.promise;
      const record = JSON.parse(localStorage.getItem(PUSH_STATE_KEY)!);
      record.consents[B] = { ...emptyConsent(), ...enabledConsent(LABEL_B, x, null) };
      localStorage.setItem(PUSH_STATE_KEY, JSON.stringify(record));
    });

    const deletion = departAfterAccountDeletion(null, async () => ({ kind: 'none' }));
    await flush();
    await vi.advanceTimersByTimeAsync(DEPARTURE_BUDGET_MS);
    await deletion;
    holder.resolve();
    await flush();
    expect(readPushState().works).toEqual([]);

    // The next page load, without a user.
    vi.useRealTimers();
    noteSignedOut();
    startPushLifecycle();
    await settle(locks);
    expect(browser.channel).toEqual(x);
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
    afterTheHold();
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
