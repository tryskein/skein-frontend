/**
 * The decision table of US-2 (rows 41–47 of the test matrix).
 *
 * The expected rows and actions are the spec's decision table, composition
 * rules 7 and 9, ИНВ-2, US-3/6/8/9/10 and Edge 9/11/12, written as literals.
 */
import { describe, expect, test } from 'vitest';
import type { PushDevice, PushOutcome } from '../../api/push';
import { decide, type Decision, type DecisionAction, type DecisionChannel, type DecisionInput, type RegisterPlan } from './decide';
import { emptyConsent, type Consent } from './pushState';

const OWN = 'https://push.example.test/send/own';
const FOREIGN = 'https://push.example.test/send/foreign';
const LABEL = 'l-own';
const OLD_LABEL = 'l-old';
const hashOf = (endpoint: string) => `hash:${endpoint}`;

function device(endpoint: string, deviceLabel: string | null = LABEL): PushDevice {
  return {
    id: `sub:${endpoint}`,
    endpointHash: hashOf(endpoint),
    ua: '',
    createdAt: '2026-11-20T10:00:00Z',
    lastSeenAt: '2026-11-20T10:00:00Z',
    deviceLabel,
    version: 1,
  };
}

const listed = (...devices: PushDevice[]): PushOutcome<PushDevice[]> => ({ kind: 'ok', value: devices });
const EMPTY_LIST = listed();

function channel(endpoint: string, keysFingerprint = 'fp-1'): DecisionChannel {
  return { kind: 'channel', endpoint, endpointHash: hashOf(endpoint), keysFingerprint };
}
const NO_CHANNEL: DecisionChannel = { kind: 'none' };

type ConsentKind = 'none' | 'off' | 'confirmed' | 'enablePending' | 'acceptPending';

function consentOf(kind: ConsentKind, over: Partial<Consent> = {}): Consent {
  const base = emptyConsent();
  switch (kind) {
    case 'none':
      return { ...base, ...over };
    case 'off':
      return { ...base, state: 'off', gen: 1, endpoint: OWN, keysFingerprint: 'fp-1', ...over };
    case 'confirmed':
      return { ...base, state: 'enabled', labels: [LABEL], label: LABEL, endpoint: OWN, keysFingerprint: 'fp-1', ...over };
    case 'enablePending':
      return { ...base, state: 'enabled', labels: [LABEL], label: LABEL, pending: { label: LABEL, kind: 'enable' }, endpoint: OWN, keysFingerprint: 'fp-1', ...over };
    case 'acceptPending':
      return { ...base, state: 'enabled', labels: [LABEL], label: LABEL, pending: { label: LABEL, kind: 'accept' }, endpoint: OWN, keysFingerprint: 'fp-1', ...over };
  }
}

function input(consent: Consent, ch: DecisionChannel, list: PushOutcome<PushDevice[]>, over: Partial<DecisionInput> = {}): DecisionInput {
  return {
    consent,
    channel: ch,
    list,
    permission: 'granted',
    serverPushEnabled: true,
    blocks: { ownRevokePending: false, foreignRemovalPending: false },
    ...over,
  };
}

const NOTHING: DecisionAction = { type: 'nothing' };
const upsert: RegisterPlan = { mode: 'upsert', label: LABEL };
const updateOnly: RegisterPlan = { mode: 'updateOnly', label: LABEL };

/** Every registration an action would send, row 6 included. */
function registrations(action: DecisionAction): Array<RegisterPlan | 'accept'> {
  switch (action.type) {
    case 'createChannelAndRegister':
    case 'register':
    case 'adoptChannel':
      return [action.register];
    case 'acceptExisting':
      return ['accept'];
    case 'removeForeignChannel':
      return registrations(action.then);
    default:
      return [];
  }
}

describe('row 41 — rows 2–10 of the decision table', () => {
  test.each<[string, DecisionInput, Decision]>([
    ['row 2: enabled, no channel → create a channel and register',
      input(consentOf('confirmed'), NO_CHANNEL, EMPTY_LIST),
      { row: 2, action: { type: 'createChannelAndRegister', register: upsert } }],
    ['row 3: enabled confirmed, own channel listed → nothing',
      input(consentOf('confirmed'), channel(OWN), listed(device(OWN))),
      { row: 3, action: NOTHING }],
    ['row 4: enabled confirmed, own channel not listed → register (US-8)',
      input(consentOf('confirmed'), channel(OWN), EMPTY_LIST),
      { row: 4, action: { type: 'register', endpoint: OWN, register: upsert } }],
    ['row 4: enabled unconfirmed, own channel listed → register',
      input(consentOf('enablePending'), channel(OWN), listed(device(OWN))),
      { row: 4, action: { type: 'register', endpoint: OWN, register: upsert } }],
    ['row 5 (US-6, A did not leave): B without a mark, A\'s channel not in B\'s list → remove it, nothing else',
      input(consentOf('none'), channel(FOREIGN), EMPTY_LIST),
      { row: 5, action: { type: 'removeForeignChannel', endpoint: FOREIGN, then: NOTHING } }],
    ['row 5 → 2: B enabled, A\'s channel not in B\'s list → remove it, then row 2',
      input(consentOf('confirmed'), channel(FOREIGN), EMPTY_LIST),
      { row: 5, action: { type: 'removeForeignChannel', endpoint: FOREIGN, then: { type: 'createChannelAndRegister', register: upsert } } }],
    ['row 5: explicitly off, foreign channel not listed → remove it',
      input(consentOf('off'), channel(FOREIGN), EMPTY_LIST),
      { row: 5, action: { type: 'removeForeignChannel', endpoint: FOREIGN, then: NOTHING } }],
    ['row 6 (US-9): no mark, a pre-change subscription listed → accept it',
      input(consentOf('none'), channel(OWN), listed(device(OWN, null))),
      { row: 6, action: { type: 'acceptExisting', endpoint: OWN } }],
    ['row 6 (Edge 9): storage cleared, the channel is in the list → accept it',
      input(emptyConsent(), channel(OWN), listed(device(OWN, OLD_LABEL))),
      { row: 6, action: { type: 'acceptExisting', endpoint: OWN } }],
    ['row 5 (Edge 9, US-9): storage cleared, the channel is not in the list → remove it',
      input(emptyConsent(), channel(OWN), EMPTY_LIST),
      { row: 5, action: { type: 'removeForeignChannel', endpoint: OWN, then: NOTHING } }],
    ['row 7 (US-3): explicitly off, own channel listed → revoke the device and remove the channel',
      input(consentOf('off'), channel(OWN), listed(device(OWN, LABEL))),
      { row: 7, action: { type: 'revokeDevice', labels: [LABEL], endpoint: OWN } }],
    ['row 7: explicitly off, any channel listed → revoke',
      input(consentOf('off'), channel(FOREIGN), listed(device(FOREIGN, OLD_LABEL))),
      { row: 7, action: { type: 'revokeDevice', labels: [OLD_LABEL], endpoint: FOREIGN } }],
    ['row 8 (US-3, US-6 A left): explicitly off, no channel → nothing',
      input(consentOf('off'), NO_CHANNEL, EMPTY_LIST),
      { row: 8, action: NOTHING }],
    ['row 8: no mark, no channel → nothing',
      input(consentOf('none'), NO_CHANNEL, listed(device(OWN))),
      { row: 8, action: NOTHING }],
    ['row 9 (US-10): enabled, the browser changed the channel and the new one is listed → adopt it',
      input(consentOf('confirmed'), channel(FOREIGN), listed(device(FOREIGN, LABEL))),
      { row: 9, action: { type: 'adoptChannel', endpoint: FOREIGN, register: updateOnly } }],
    ['row 5 → 2 (US-10): enabled, the new channel is not listed → remove it, then row 2',
      input(consentOf('confirmed'), channel(FOREIGN), listed(device(OWN))),
      { row: 5, action: { type: 'removeForeignChannel', endpoint: FOREIGN, then: { type: 'createChannelAndRegister', register: upsert } } }],
    ['row 10 (US-3): explicitly off, own channel not listed → remove the channel',
      input(consentOf('off'), channel(OWN), EMPTY_LIST),
      { row: 10, action: { type: 'removeChannel', endpoint: OWN } }],
  ])('%s', (_name, given, expected) => {
    expect(decide(given)).toEqual(expected);
  });

  test.each<[string, Partial<DecisionInput>]>([
    ['the own device revocation', { blocks: { ownRevokePending: true, foreignRemovalPending: false } }],
    ['the removal of the previous user\'s channel', { blocks: { ownRevokePending: false, foreignRemovalPending: true } }],
  ])('unfinished %s holds back rows 2 and 4', (_name, over) => {
    expect(decide(input(consentOf('confirmed'), NO_CHANNEL, EMPTY_LIST, over))).toEqual({ row: 2, action: NOTHING });
    expect(decide(input(consentOf('confirmed'), channel(OWN), EMPTY_LIST, over))).toEqual({ row: 4, action: NOTHING });
    expect(decide(input(consentOf('confirmed'), channel(FOREIGN), EMPTY_LIST, over)))
      .toEqual({ row: 5, action: { type: 'removeForeignChannel', endpoint: FOREIGN, then: NOTHING } });
  });

  test.each<[string, Partial<DecisionInput>]>([
    ['the own device revocation', { blocks: { ownRevokePending: true, foreignRemovalPending: false } }],
    ['the removal of the previous user\'s channel', { blocks: { ownRevokePending: false, foreignRemovalPending: true } }],
  ])('unfinished %s leaves an unconfirmed accept as it is on row 2 and on 5 → 2', (_name, over) => {
    expect(decide(input(consentOf('acceptPending'), NO_CHANNEL, EMPTY_LIST, over))).toEqual({ row: 2, action: NOTHING });
    expect(decide(input(consentOf('acceptPending'), channel(FOREIGN), EMPTY_LIST, over)))
      .toEqual({ row: 5, action: { type: 'removeForeignChannel', endpoint: FOREIGN, then: NOTHING } });
  });
});

describe('row 42 — rule 7: unconfirmed consents', () => {
  test('an unconfirmed enable registers with upsert on row 4', () => {
    expect(decide(input(consentOf('enablePending'), channel(OWN), EMPTY_LIST)).action)
      .toEqual({ type: 'register', endpoint: OWN, register: upsert });
  });

  test('an unconfirmed accept on row 4 only updates', () => {
    for (const list of [EMPTY_LIST, listed(device(OWN))]) {
      expect(decide(input(consentOf('acceptPending'), channel(OWN), list))).toEqual({
        row: 4,
        action: { type: 'register', endpoint: OWN, register: updateOnly },
      });
    }
  });

  test('an unconfirmed accept whose channel disappeared (row 2) goes back to no mark and creates nothing', () => {
    expect(decide(input(consentOf('acceptPending'), NO_CHANNEL, EMPTY_LIST)))
      .toEqual({ row: 2, action: { type: 'abandonPending', label: LABEL } });
  });

  test('an unconfirmed accept whose channel changed (5 → 2) goes back to no mark and creates nothing', () => {
    expect(decide(input(consentOf('acceptPending'), channel(FOREIGN), EMPTY_LIST))).toEqual({
      row: 5,
      action: { type: 'removeForeignChannel', endpoint: FOREIGN, then: { type: 'abandonPending', label: LABEL } },
    });
  });

  test('an unconfirmed accept whose channel changed to a listed one (row 9) goes back to no mark', () => {
    expect(decide(input(consentOf('acceptPending'), channel(FOREIGN), listed(device(FOREIGN)))))
      .toEqual({ row: 9, action: { type: 'abandonPending', label: LABEL } });
  });

  test('an unconfirmed enable whose channel disappeared registers on a new channel (row 2, upsert)', () => {
    expect(decide(input(consentOf('enablePending'), NO_CHANNEL, EMPTY_LIST)))
      .toEqual({ row: 2, action: { type: 'createChannelAndRegister', register: upsert } });
  });

  test('a confirmed enable whose endpoint left the list registers with its label and may create (US-8)', () => {
    expect(decide(input(consentOf('confirmed'), channel(OWN), listed(device(FOREIGN)))))
      .toEqual({ row: 4, action: { type: 'register', endpoint: OWN, register: upsert } });
  });
});

describe('row 43 — rule 9: permission denied, push disabled on the server', () => {
  const held: Array<[string, Partial<DecisionInput>]> = [
    ['permission denied', { permission: 'denied' }],
    ['push disabled on the server', { serverPushEnabled: false }],
  ];

  test.each(held)('%s: rows 2, 3, 4, 6, 9 do nothing', (_name, over) => {
    expect(decide(input(consentOf('confirmed'), NO_CHANNEL, EMPTY_LIST, over))).toEqual({ row: 2, action: NOTHING });
    expect(decide(input(consentOf('confirmed'), channel(OWN, 'fp-2'), listed(device(OWN)), over))).toEqual({ row: 3, action: NOTHING });
    expect(decide(input(consentOf('enablePending'), channel(OWN), EMPTY_LIST, over))).toEqual({ row: 4, action: NOTHING });
    expect(decide(input(consentOf('none'), channel(OWN), listed(device(OWN)), over))).toEqual({ row: 6, action: NOTHING });
    expect(decide(input(consentOf('confirmed'), channel(FOREIGN), listed(device(FOREIGN)), over))).toEqual({ row: 9, action: NOTHING });
  });

  test.each(held)('%s: an unconfirmed accept stays as it is on rows 2 and 9, and 5 → 2 stops after the removal', (_name, over) => {
    expect(decide(input(consentOf('acceptPending'), NO_CHANNEL, EMPTY_LIST, over))).toEqual({ row: 2, action: NOTHING });
    expect(decide(input(consentOf('acceptPending'), channel(FOREIGN), listed(device(FOREIGN)), over))).toEqual({ row: 9, action: NOTHING });
    expect(decide(input(consentOf('acceptPending'), channel(FOREIGN), EMPTY_LIST, over)))
      .toEqual({ row: 5, action: { type: 'removeForeignChannel', endpoint: FOREIGN, then: NOTHING } });
  });

  test.each(held)('%s: rows 5, 7, 10 still run, and 5 → 2 stops after the removal', (_name, over) => {
    expect(decide(input(consentOf('confirmed'), channel(FOREIGN), EMPTY_LIST, over)))
      .toEqual({ row: 5, action: { type: 'removeForeignChannel', endpoint: FOREIGN, then: NOTHING } });
    expect(decide(input(consentOf('off'), channel(OWN), listed(device(OWN)), over)))
      .toEqual({ row: 7, action: { type: 'revokeDevice', labels: [LABEL], endpoint: OWN } });
    expect(decide(input(consentOf('off'), channel(OWN), EMPTY_LIST, over)))
      .toEqual({ row: 10, action: { type: 'removeChannel', endpoint: OWN } });
  });
});

describe('row 44 — rows 0 and 1', () => {
  test.each<[string, PushOutcome<PushDevice[]>]>([
    ['a read list', listed(device(OWN))],
    ['a lost list', { kind: 'lost' }],
  ])('an unreadable channel is row 0 with %s', (_name, list) => {
    for (const kind of ['none', 'off', 'confirmed'] as const) {
      expect(decide(input(consentOf(kind), { kind: 'unreadable' }, list))).toEqual({ row: 0, action: NOTHING });
    }
  });

  test.each<[string, PushOutcome<PushDevice[]>]>([
    ['lost', { kind: 'lost' }],
    ['sessionEnded', { kind: 'sessionEnded' }],
  ])('a list read %s is row 1', (_name, list) => {
    for (const ch of [NO_CHANNEL, channel(OWN), channel(FOREIGN)]) {
      for (const kind of ['none', 'off', 'confirmed', 'enablePending'] as const) {
        expect(decide(input(consentOf(kind), ch, list))).toEqual({ row: 1, action: NOTHING });
      }
    }
  });
});

describe('row 45 — ИНВ-2: no registration without consent outside rows 6 and 9', () => {
  const consents: ConsentKind[] = ['none', 'off', 'confirmed', 'enablePending', 'acceptPending'];
  const channels: DecisionChannel[] = [{ kind: 'unreadable' }, NO_CHANNEL, channel(OWN), channel(OWN, 'fp-2'), channel(FOREIGN)];
  const lists: Array<PushOutcome<PushDevice[]>> = [
    EMPTY_LIST,
    listed(device(OWN)),
    listed(device(FOREIGN)),
    listed(device(OWN, null)),
    { kind: 'lost' },
  ];
  const cases: DecisionInput[] = [];
  for (const c of consents) {
    for (const ch of channels) {
      for (const list of lists) {
        for (const permission of ['default', 'granted', 'denied'] as const) {
          for (const serverPushEnabled of [true, false]) {
            for (const ownRevokePending of [true, false]) {
              cases.push(input(consentOf(c), ch, list, {
                permission,
                serverPushEnabled,
                blocks: { ownRevokePending, foreignRemovalPending: false },
              }));
            }
          }
        }
      }
    }
  }

  test('the whole finite table', () => {
    expect(cases.length).toBeGreaterThan(0);
    let withRegistration = 0;
    for (const given of cases) {
      const d = decide(given);
      if (registrations(d.action).length > 0) {
        withRegistration += 1;
        expect(given.consent.state === 'enabled' || d.row === 6, JSON.stringify({ given, d })).toBe(true);
      }
      if (given.consent.state === 'off') expect(d.row).not.toBe(6);
    }
    expect(withRegistration).toBeGreaterThan(0);
  });
});

describe('row 46 — off without labels, a full S', () => {
  test('off without labels: row 7 revokes by the endpoint of the current channel', () => {
    expect(decide(input(consentOf('off', { labels: [] }), channel(OWN), listed(device(OWN, null)))))
      .toEqual({ row: 7, action: { type: 'revokeDevice', labels: [], endpoint: OWN } });
  });

  test('with 1000 labels in S row 6 is not selected', () => {
    const labels = Array.from({ length: 1000 }, (_, i) => `l-${i}`);
    expect(decide(input(consentOf('none', { labels }), channel(OWN), listed(device(OWN, null)))))
      .toEqual({ row: null, action: NOTHING });
  });

  test('off with a full S: row 7 keeps one request of 1000 labels and removes the listed subscription by id', () => {
    const labels = Array.from({ length: 1000 }, (_, i) => `l-${i}`);
    const d = decide(input(consentOf('off', { labels }), channel(OWN), listed(device(OWN, OLD_LABEL))));
    expect(d.row).toBe(7);
    expect(d.action).toEqual({ type: 'revokeDevice', labels, endpoint: OWN, removeSubscriptionId: `sub:${OWN}` });
  });

  test('off with 999 labels: the listed label joins the one request', () => {
    const labels = Array.from({ length: 999 }, (_, i) => `l-${i}`);
    expect(decide(input(consentOf('off', { labels }), channel(OWN), listed(device(OWN, OLD_LABEL)))).action)
      .toEqual({ type: 'revokeDevice', labels: [...labels, OLD_LABEL], endpoint: OWN });
  });

  test('with 999 labels in S row 6 is selected', () => {
    const labels = Array.from({ length: 999 }, (_, i) => `l-${i}`);
    expect(decide(input(consentOf('none', { labels }), channel(OWN), listed(device(OWN, null)))).row).toBe(6);
  });
});

describe('row 41 — row 3: the listed subscription carries the consent\'s label', () => {
  test.each<[string, string | null]>([
    ['an unlabelled record', null],
    ['another label', OLD_LABEL],
  ])('a confirmed consent whose listed row has %s updates it with the consent\'s label', (_name, deviceLabel) => {
    expect(decide(input(consentOf('confirmed'), channel(OWN), listed(device(OWN, deviceLabel)))))
      .toEqual({ row: 3, action: { type: 'register', endpoint: OWN, register: updateOnly } });
  });

  test('with permission denied the mismatch changes nothing', () => {
    expect(decide(input(consentOf('confirmed'), channel(OWN), listed(device(OWN, null)), { permission: 'denied' })))
      .toEqual({ row: 3, action: NOTHING });
  });
});

describe('row 47 — row 3: key fingerprint', () => {
  test('a key fingerprint other than the recorded one updates the own subscription', () => {
    expect(decide(input(consentOf('confirmed'), channel(OWN, 'fp-2'), listed(device(OWN)))))
      .toEqual({ row: 3, action: { type: 'register', endpoint: OWN, register: updateOnly } });
  });

  test('the recorded fingerprint: no update', () => {
    expect(decide(input(consentOf('confirmed'), channel(OWN, 'fp-1'), listed(device(OWN)))))
      .toEqual({ row: 3, action: NOTHING });
  });

  test('no recorded fingerprint: no update', () => {
    expect(decide(input(consentOf('confirmed', { keysFingerprint: null }), channel(OWN, 'fp-2'), listed(device(OWN)))))
      .toEqual({ row: 3, action: NOTHING });
  });
});
