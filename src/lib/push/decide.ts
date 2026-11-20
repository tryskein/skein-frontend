/**
 * The decision table of a user's appearance (spec US-2) as a pure function.
 *
 * Input: the user's consent, the outcome of reading the browser channel, the
 * outcome of reading the user's subscription list as the expected user, the
 * notification permission, whether push is enabled on the server, and the
 * blocks left by unfinished work. Output: the table row and the action to
 * execute. No network, storage or locks here.
 *
 * Rows (spec US-2):
 *   0  channel not read                       → nothing
 *   1  list not read                          → nothing
 *   2  enabled, no channel                    → create a channel, register
 *   3  enabled confirmed, own, listed         → nothing; update the
 *                                               subscription when its label
 *                                               is not the consent's or the
 *                                               key fingerprint differs
 *   4  enabled, own, not listed or unconfirmed→ register (rule 7)
 *   5  any, foreign, not listed               → remove the foreign channel,
 *                                               then row 2 when enabled
 *   6  no mark, a channel, listed             → accept it with a new label
 *   7  explicitly off, a channel, listed      → revoke the device, remove the
 *                                               channel
 *   8  no mark / off, no channel              → nothing
 *   9  enabled, foreign, listed               → adopt the channel
 *   10 explicitly off, own, not listed        → remove the channel
 *
 * Rule 7 (an unconfirmed consent): an unconfirmed explicit enable registers
 * with its label and may create the subscription (`upsert`); an unconfirmed
 * accept only updates an existing subscription (`updateOnly`), and if its
 * channel disappeared or changed before the confirmation the consent goes
 * back to "no mark" without creating anything. A confirmed consent whose
 * endpoint left the list registers with its label (`upsert`, US-8).
 *
 * Rule 9: rows 2–10 need a read channel and a read list; with permission
 * `denied` or push disabled on the server only removals and revocations run
 * (rows 5, 7, 10) — rows 2, 3, 4, 6 and 9 do nothing, without an error, and
 * the same holds for the 5 → 2 transition.
 *
 * Unfinished work blocks rows 2 and 4: the user's own device revocation,
 * and the removal of the channel of the previous user of this browser.
 *
 * With {@link MAX_CONSENT_LABELS} labels in S row 6 is not selected: no new
 * label can be created.
 */

import type { PushDevice, PushOutcome, PushSubscribeMode } from '../../api/push';
import type { NotificationPermissionState } from './browserPush';
import { MAX_CONSENT_LABELS, type Consent } from './pushState';

/** The browser channel as the decision sees it. */
export type DecisionChannel =
  | { kind: 'unreadable' }
  | { kind: 'none' }
  | {
      kind: 'channel';
      endpoint: string;
      /** SHA-256 hex of `endpoint`, compared with the list's `endpointHash`. */
      endpointHash: string;
      /** Fingerprint of the channel keys. */
      keysFingerprint: string;
    };

/** Unfinished work that holds back rows 2 and 4. */
export interface DecisionBlocks {
  /** A revocation of this user's own device is not finished. */
  ownRevokePending: boolean;
  /** The removal of a previous user's channel in this browser is not finished. */
  foreignRemovalPending: boolean;
}

export interface DecisionInput {
  consent: Consent;
  channel: DecisionChannel;
  /** Outcome of reading the list as the expected user. */
  list: PushOutcome<PushDevice[]>;
  permission: NotificationPermissionState;
  /** Whether push is enabled on the server (a VAPID key is published). */
  serverPushEnabled: boolean;
  blocks: DecisionBlocks;
}

export type DecisionRow = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

/** A registration of the user's subscription with a device label. */
export interface RegisterPlan {
  mode: PushSubscribeMode;
  label: string;
}

export type DecisionAction =
  | { type: 'nothing' }
  /**
   * Row 2: create a channel, write its endpoint into the consent as
   * unconfirmed (`recordUnconfirmedChannel`, kind `enable`) before the
   * registration, register, then confirm.
   */
  | { type: 'createChannelAndRegister'; register: RegisterPlan }
  /** Rows 3 and 4: register the current own channel. */
  | { type: 'register'; endpoint: string; register: RegisterPlan }
  /** Rule 7: the unconfirmed accept lost its channel — back to "no mark". */
  | { type: 'abandonPending'; label: string }
  /** Row 5: remove the foreign channel, then `then`. */
  | { type: 'removeForeignChannel'; endpoint: string; then: DecisionAction }
  /**
   * Row 6: accept the listed channel with a new label. Rule 7: an accept only
   * updates the existing subscription, never creates one.
   */
  | { type: 'acceptExisting'; endpoint: string; mode: 'updateOnly' }
  /** Row 9: take the listed channel as the user's own, update only. */
  | { type: 'adoptChannel'; endpoint: string; register: RegisterPlan }
  /**
   * Row 7: revoke the device by these labels (at most MAX_CONSENT_LABELS) and
   * endpoint, remove the subscription `removeSubscriptionId` by id when set,
   * then remove the channel.
   */
  | { type: 'revokeDevice'; labels: string[]; endpoint: string; removeSubscriptionId?: string }
  /** Row 10: remove the channel. */
  | { type: 'removeChannel'; endpoint: string };

export interface Decision {
  /** The table row, or `null` when row 6 is excluded by a full S. */
  row: DecisionRow | null;
  action: DecisionAction;
}

const NOTHING: DecisionAction = { type: 'nothing' };

function decision(row: DecisionRow | null, action: DecisionAction = NOTHING): Decision {
  return { row, action };
}

/**
 * Row 2 for an enabled consent (directly or after row 5): create a channel and
 * register. Rule 9 and the blocks come first — while registrations are held
 * back or blocked the row does nothing at all, the consent included. Only then
 * an unconfirmed accept, which must not create anything, goes back to "no
 * mark".
 */
function row2Action(consent: Consent, registrationsAllowed: boolean, blocked: boolean): DecisionAction {
  if (!registrationsAllowed || blocked) return NOTHING;
  if (consent.pending?.kind === 'accept') return { type: 'abandonPending', label: consent.pending.label };
  if (consent.label === null) return NOTHING;
  return { type: 'createChannelAndRegister', register: { mode: 'upsert', label: consent.label } };
}

/** Decides what to do on the user's appearance. */
export function decide(input: DecisionInput): Decision {
  const { consent, channel, list, blocks } = input;

  if (channel.kind === 'unreadable') return decision(0);
  if (list.kind !== 'ok') return decision(1);

  const registrationsAllowed = input.permission !== 'denied' && input.serverPushEnabled;
  const blocked = blocks.ownRevokePending || blocks.foreignRemovalPending;
  const enabled = consent.state === 'enabled';

  if (channel.kind === 'none') {
    if (enabled) return decision(2, row2Action(consent, registrationsAllowed, blocked));
    return decision(8);
  }

  const listed = list.value.find((d) => d.endpointHash === channel.endpointHash);
  const own = consent.endpoint !== null && channel.endpoint === consent.endpoint;

  if (consent.state === 'off') {
    if (listed !== undefined) {
      // One revocation request carries at most MAX_CONSENT_LABELS labels. The
      // listed subscription's label joins S when it fits; otherwise that
      // subscription is removed by id, which also revokes its label.
      const labels = [...consent.labels];
      const action: DecisionAction = { type: 'revokeDevice', labels, endpoint: channel.endpoint };
      if (listed.deviceLabel !== null && !labels.includes(listed.deviceLabel)) {
        if (labels.length < MAX_CONSENT_LABELS) labels.push(listed.deviceLabel);
        else action.removeSubscriptionId = listed.id;
      }
      return decision(7, action);
    }
    if (own) return decision(10, { type: 'removeChannel', endpoint: channel.endpoint });
    return decision(5, { type: 'removeForeignChannel', endpoint: channel.endpoint, then: NOTHING });
  }

  if (!enabled) {
    if (listed === undefined) {
      return decision(5, { type: 'removeForeignChannel', endpoint: channel.endpoint, then: NOTHING });
    }
    if (consent.labels.length >= MAX_CONSENT_LABELS) return decision(null);
    if (!registrationsAllowed) return decision(6);
    return decision(6, { type: 'acceptExisting', endpoint: channel.endpoint, mode: 'updateOnly' });
  }

  // enabled
  if (!own) {
    if (listed === undefined) {
      return decision(5, {
        type: 'removeForeignChannel',
        endpoint: channel.endpoint,
        then: row2Action(consent, registrationsAllowed, blocked),
      });
    }
    if (!registrationsAllowed) return decision(9);
    if (consent.pending?.kind === 'accept') {
      return decision(9, { type: 'abandonPending', label: consent.pending.label });
    }
    if (consent.label === null) return decision(9);
    return decision(9, {
      type: 'adoptChannel',
      endpoint: channel.endpoint,
      register: { mode: 'updateOnly', label: consent.label },
    });
  }

  const label = consent.label;
  if (listed !== undefined && consent.pending === null) {
    if (!registrationsAllowed || label === null) return decision(3);
    // Rule 7: the consent is confirmed only by a subscription with its label
    // at its endpoint. A listed row without that label (an unlabelled record
    // left by an older api, another label) is brought to the consent's label
    // by an update; a revoked label is refused by the server.
    if (listed.deviceLabel !== label) {
      return decision(3, { type: 'register', endpoint: channel.endpoint, register: { mode: 'updateOnly', label } });
    }
    if (consent.keysFingerprint === null || consent.keysFingerprint === channel.keysFingerprint) return decision(3);
    return decision(3, { type: 'register', endpoint: channel.endpoint, register: { mode: 'updateOnly', label } });
  }

  if (!registrationsAllowed || blocked || label === null) return decision(4);
  const mode: PushSubscribeMode = consent.pending?.kind === 'accept' ? 'updateOnly' : 'upsert';
  return decision(4, { type: 'register', endpoint: channel.endpoint, register: { mode, label } });
}
