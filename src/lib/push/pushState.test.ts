/**
 * Browser push state record (rows 35–39 of the test matrix).
 *
 * Expected values come from the spec and the plan's "Key decisions": one
 * record `skein.push.v1.state`; a revocation sets `off`, grows `gen` (also
 * with an empty S) and moves S whole into a `deviceRevoke` work; a write
 * that fails leaves the previous record whole; consent writes are
 * compare-and-set on `gen` and `rev`; a `deviceRevoke` work needs a guard
 * and a label or an endpoint; nothing but a revocation takes a label out of
 * S; S holds at most 1000 labels; consents of two users are independent.
 *
 * `navigator.locks` is replaced by a lock manager that grants at once: the
 * lock mapping itself is row 35a.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { pushRevokeDevices } from '../../api/push';
import { decide } from './decide';
import {
  InvalidPushWorkError,
  PUSH_STATE_KEY,
  PushLabelLimitError,
  PushStateConflictError,
  PushStorageError,
  abandonConsentLabel,
  addPushWork,
  beginConsentLabel,
  confirmConsent,
  emptyConsent,
  isNoMark,
  readConsent,
  readConsentGen,
  readPushState,
  recordUnconfirmedChannel,
  revokeConsent,
  setConsentOffUnconfirmed,
  updateConsentChannel,
  type NewPushWork,
  type RevokeGuard,
} from './pushState';

const A = 'a1a1a1a1-0000-4000-8000-000000000001';
const B = 'b2b2b2b2-0000-4000-8000-000000000002';
const ENDPOINT = 'https://push.example.test/send/one';
const ENDPOINT_2 = 'https://push.example.test/send/two';

beforeEach(() => {
  window.localStorage.clear();
  Object.defineProperty(navigator, 'locks', {
    value: { request: (_name: string, _options: LockOptions, cb: LockGrantedCallback<unknown>) => Promise.resolve().then(() => cb(null)) },
    configurable: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (navigator as unknown as { locks?: unknown }).locks;
  window.localStorage.clear();
});

function raw(): string | null {
  return window.localStorage.getItem(PUSH_STATE_KEY);
}

/** Writes a consent of `userId` holding `labels` straight into the record. */
function seedConsent(userId: string, labels: string[], state: 'none' | 'enabled' | 'off' = 'none'): void {
  const label = state === 'enabled' ? labels[labels.length - 1] : null;
  window.localStorage.setItem(PUSH_STATE_KEY, JSON.stringify({
    consents: {
      [userId]: {
        state,
        gen: 4,
        labels,
        label,
        pending: null,
        endpoint: state === 'none' ? null : ENDPOINT,
        keysFingerprint: null,
        offUnconfirmed: false,
        rev: 9,
      },
    },
    works: [],
  }));
}

function labelsOf(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
}

async function enabledConsent(userId: string): Promise<string> {
  const c = await beginConsentLabel(userId, {
    expect: { gen: readConsentGen(userId) },
    kind: 'enable',
    endpoint: ENDPOINT,
    keysFingerprint: 'fp1',
  });
  return c.label as string;
}

describe('row 35 — a revocation is one write of the whole record', () => {
  test('a setItem that throws during the revocation leaves the previous record whole', async () => {
    const label = await enabledConsent(A);
    const before = raw();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });

    await expect(revokeConsent(A, { endpoint: ENDPOINT, guard: 'absent' })).rejects.toBeInstanceOf(PushStorageError);

    vi.restoreAllMocks();
    expect(raw()).toBe(before);
    const reopened = readPushState();
    expect(reopened.works).toEqual([]);
    expect(reopened.consents[A]).toMatchObject({ state: 'enabled', gen: 0, labels: [label] });
  });

  test('a revocation that landed is seen whole on reopening: off, gen + 1, S in the work, S empty', async () => {
    const label = await enabledConsent(A);

    await revokeConsent(A, { endpoint: ENDPOINT, guard: { id: 'sub-1', version: 2 } });

    const reopened = readPushState();
    expect(reopened.consents[A]).toMatchObject({ state: 'off', gen: 1, labels: [] });
    expect(reopened.works).toHaveLength(1);
    expect(reopened.works[0]).toMatchObject({
      type: 'deviceRevoke',
      ownerUserId: A,
      labels: [label],
      endpoint: ENDPOINT,
      guard: { id: 'sub-1', version: 2 },
    });
  });

  test('unavailable storage refuses the transition with an error', async () => {
    const own = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('denied', 'SecurityError');
      },
    });
    try {
      await expect(beginConsentLabel(A, { expect: { gen: 0 }, kind: 'enable', endpoint: ENDPOINT, keysFingerprint: null }))
        .rejects.toBeInstanceOf(PushStorageError);
      await expect(revokeConsent(A, { endpoint: ENDPOINT, guard: 'absent' })).rejects.toBeInstanceOf(PushStorageError);
    } finally {
      if (own) Object.defineProperty(window, 'localStorage', own);
      else delete (window as unknown as { localStorage?: unknown }).localStorage;
    }
  });
});

describe('row 36 — consent writes are compare-and-set on gen and rev', () => {
  test('a write with a stale gen is refused and the record is unchanged', async () => {
    const staleGen = readConsentGen(A);
    await revokeConsent(A, { endpoint: null, guard: 'unconfirmed' });
    const before = raw();

    await expect(beginConsentLabel(A, { expect: { gen: staleGen }, kind: 'enable', endpoint: ENDPOINT, keysFingerprint: null }))
      .rejects.toBeInstanceOf(PushStateConflictError);

    expect(raw()).toBe(before);
  });

  test('a confirmation with a stale gen is refused: a revocation in between wins', async () => {
    const label = await enabledConsent(A);
    const gen = readConsentGen(A);
    await revokeConsent(A, { endpoint: ENDPOINT, guard: 'absent' });
    const before = raw();

    await expect(confirmConsent(A, { expect: { gen }, label, endpoint: ENDPOINT, keysFingerprint: 'fp1' }))
      .rejects.toBeInstanceOf(PushStateConflictError);

    expect(raw()).toBe(before);
    expect(readConsent(A).state).toBe('off');
  });

  test('a write with a stale rev is refused and the record is unchanged', async () => {
    const label = await enabledConsent(A);
    const seen = readConsent(A);
    await confirmConsent(A, { expect: { gen: seen.gen }, label, endpoint: ENDPOINT, keysFingerprint: 'fp1' });
    const before = raw();

    await expect(updateConsentChannel(A, { expect: { gen: seen.gen, rev: seen.rev }, endpoint: ENDPOINT_2, keysFingerprint: 'fp2' }))
      .rejects.toBeInstanceOf(PushStateConflictError);

    expect(raw()).toBe(before);
  });
});

describe('row 35 — the revocation write marks the disable as not confirmed (US-3)', () => {
  test.each<[string, () => Promise<unknown>, string | null]>([
    ['with labels and an endpoint', () => enabledConsent(A), ENDPOINT],
    ['with an empty S and an unread channel', async () => undefined, null],
  ])('%s: off, gen + 1 and offUnconfirmed land in one write and survive a reload', async (_name, arrange, endpoint) => {
    await arrange();
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    await revokeConsent(A, { endpoint, guard: 'unconfirmed' });

    expect(setItem).toHaveBeenCalledTimes(1);
    expect(readConsent(A)).toMatchObject({ state: 'off', gen: 1, offUnconfirmed: true });
  });

  test('the mark is cleared once the server confirmed the result', async () => {
    const { consent } = await revokeConsent(A, { endpoint: ENDPOINT, guard: 'absent' });
    await setConsentOffUnconfirmed(A, { gen: consent.gen, rev: consent.rev }, false);
    expect(readConsent(A)).toMatchObject({ state: 'off', offUnconfirmed: false });
  });
});

describe('row 37 — gen and the deviceRevoke work', () => {
  test('a revocation grows gen also with an empty S, and writes no work without a label or an endpoint', async () => {
    expect(readConsentGen(A)).toBe(0);
    const first = await revokeConsent(A, { endpoint: null, guard: 'unconfirmed' });
    expect(first.work).toBeNull();
    expect(readConsentGen(A)).toBe(1);
    await revokeConsent(A, { endpoint: null, guard: 'absent' });
    expect(readConsentGen(A)).toBe(2);
    expect(readPushState().works).toEqual([]);
  });

  test('a revocation with an empty S and a known endpoint writes the work with that endpoint', async () => {
    await revokeConsent(A, { endpoint: ENDPOINT, guard: 'unconfirmed' });
    expect(readPushState().works).toMatchObject([
      { type: 'deviceRevoke', ownerUserId: A, labels: [], endpoint: ENDPOINT, guard: 'unconfirmed' },
    ]);
  });

  test.each<[string, RevokeGuard]>([
    ['the owner subscription', { id: 'sub-1', version: 3 }],
    ['absent', 'absent'],
    ['unconfirmed', 'unconfirmed'],
  ])('a deviceRevoke work with guard %s is written', async (_name, guard) => {
    await addPushWork({ type: 'deviceRevoke', ownerUserId: A, labels: ['l1'], guard });
    expect(readPushState().works).toMatchObject([{ type: 'deviceRevoke', labels: ['l1'], guard }]);
  });

  test.each<[string, unknown]>([
    ['without a guard', { type: 'deviceRevoke', ownerUserId: A, labels: ['l1'] }],
    ['with an unknown guard', { type: 'deviceRevoke', ownerUserId: A, labels: ['l1'], guard: 'maybe' }],
    ['without labels and endpoint', { type: 'deviceRevoke', ownerUserId: A, labels: [], guard: 'absent' }],
  ])('a deviceRevoke work %s is not written', async (_name, work) => {
    await expect(addPushWork(work as NewPushWork)).rejects.toBeInstanceOf(InvalidPushWorkError);
    expect(raw()).toBeNull();
  });

  test('a revocation without a guard is refused and changes nothing', async () => {
    await enabledConsent(A);
    const before = raw();
    await expect(revokeConsent(A, { endpoint: ENDPOINT, guard: undefined as unknown as RevokeGuard }))
      .rejects.toBeInstanceOf(InvalidPushWorkError);
    expect(raw()).toBe(before);
  });
});

describe('row 38 — the label set S', () => {
  test('an abandoned accept leaves its label in S; the next accept adds one', async () => {
    const first = await beginConsentLabel(A, { expect: { gen: 0 }, kind: 'accept', endpoint: ENDPOINT, keysFingerprint: null });
    const l1 = first.label as string;
    await abandonConsentLabel(A, { expect: { gen: 0 }, label: l1 });
    expect(readConsent(A)).toMatchObject({ state: 'none', labels: [l1], pending: null });

    const second = await beginConsentLabel(A, { expect: { gen: 0 }, kind: 'accept', endpoint: ENDPOINT, keysFingerprint: null });
    expect(second.labels).toEqual([l1, second.label]);
    expect(second.label).not.toBe(l1);
  });

  test('with 1000 labels in S no new label is created', async () => {
    seedConsent(A, labelsOf(1000));
    const before = raw();
    await expect(beginConsentLabel(A, { expect: { gen: 4 }, kind: 'enable', endpoint: ENDPOINT, keysFingerprint: null }))
      .rejects.toBeInstanceOf(PushLabelLimitError);
    expect(raw()).toBe(before);
  });

  test('with 999 labels the 1000th is created', async () => {
    seedConsent(A, labelsOf(999));
    const c = await beginConsentLabel(A, { expect: { gen: 4 }, kind: 'enable', endpoint: ENDPOINT, keysFingerprint: null });
    expect(c.labels).toHaveLength(1000);
  });

  test('the revocation work carries all 1000 labels and makes one request body with them', async () => {
    const labels = labelsOf(1000);
    seedConsent(A, labels, 'enabled');
    const { work } = await revokeConsent(A, { endpoint: ENDPOINT, guard: 'absent' });
    expect(work).toMatchObject({ type: 'deviceRevoke', labels });

    const fetchMock = vi.fn(async () => new Response(null, { status: 204, headers: { 'Skein-Push-Contract': '2' } }));
    vi.stubGlobal('fetch', fetchMock);
    await pushRevokeDevices({ expectedUserId: A, deviceLabels: work!.type === 'deviceRevoke' ? work!.labels : [] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body)).deviceLabels).toEqual(labels);
  });
});

describe('row 36 — a new channel of a confirmed consent is written unconfirmed (row 2)', () => {
  test('the endpoint of the new channel is unconfirmed until the answer, and a lost answer is finished by row 4', async () => {
    const label = await enabledConsent(A);
    const begun = readConsent(A);
    const confirmed = await confirmConsent(A, { expect: { gen: begun.gen, rev: begun.rev }, label, endpoint: ENDPOINT, keysFingerprint: 'fp1' });
    expect(confirmed.pending).toBeNull();

    await recordUnconfirmedChannel(A, {
      expect: { gen: confirmed.gen, rev: confirmed.rev },
      label,
      endpoint: ENDPOINT_2,
      keysFingerprint: 'fp2',
      kind: 'enable',
    });
    // The registration answer is lost: the record holds the new endpoint, unconfirmed.
    const reopened = readConsent(A);
    expect(reopened).toMatchObject({ state: 'enabled', label, endpoint: ENDPOINT_2, keysFingerprint: 'fp2', pending: { label, kind: 'enable' } });

    const next = decide({
      consent: reopened,
      channel: { kind: 'channel', endpoint: ENDPOINT_2, endpointHash: 'h2', keysFingerprint: 'fp2' },
      list: { kind: 'ok', value: [] },
      permission: 'granted',
      serverPushEnabled: true,
      blocks: { ownRevokePending: false, foreignRemovalPending: false },
    });
    expect(next).toEqual({ row: 4, action: { type: 'register', endpoint: ENDPOINT_2, register: { mode: 'upsert', label } } });
  });

  test('a stale revision or another label is refused and the record is unchanged', async () => {
    const label = await enabledConsent(A);
    const seen = readConsent(A);
    await updateConsentChannel(A, { expect: { gen: seen.gen, rev: seen.rev }, endpoint: ENDPOINT, keysFingerprint: 'fp3' });
    const before = raw();

    await expect(recordUnconfirmedChannel(A, { expect: { gen: seen.gen, rev: seen.rev }, label, endpoint: ENDPOINT_2, keysFingerprint: null, kind: 'enable' }))
      .rejects.toBeInstanceOf(PushStateConflictError);
    const now = readConsent(A);
    await expect(recordUnconfirmedChannel(A, { expect: { gen: now.gen, rev: now.rev }, label: 'other', endpoint: ENDPOINT_2, keysFingerprint: null, kind: 'enable' }))
      .rejects.toBeInstanceOf(PushStateConflictError);
    expect(raw()).toBe(before);
  });
});

describe('row 39 — a consent per user of the browser', () => {
  test('a transition of one user does not change the other user', async () => {
    const labelB = await enabledConsent(B);
    const consentB = readConsent(B);

    await enabledConsent(A);
    await revokeConsent(A, { endpoint: ENDPOINT, guard: 'absent' });

    expect(readConsent(B)).toEqual(consentB);
    expect(readConsent(B).labels).toEqual([labelB]);
    expect(readConsent(A).state).toBe('off');
  });

  test('a user without a record has none with an empty S, which is no mark', () => {
    const consent = readConsent(A);
    expect(consent).toEqual(emptyConsent());
    expect(consent).toMatchObject({ state: 'none', labels: [] });
    expect(isNoMark(consent)).toBe(true);
  });

  test('a stored none with an empty S is no mark', () => {
    seedConsent(A, []);
    expect(isNoMark(readConsent(A))).toBe(true);
  });
});
