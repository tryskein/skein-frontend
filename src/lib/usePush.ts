/**
 * usePush — the push state of the current appearance and the explicit push
 * actions, for the push UI (banner, previous-user warning, settings).
 *
 * The state comes from the push controller (`lib/push/pushLifecycle.ts`),
 * which `PushProvider` runs; this hook only reads it and never registers
 * anything itself — mounting it sends no push request (spec INV-2).
 *
 * The state is keyed by the appearance (`auth/appearance.ts`): a state that
 * belongs to an earlier appearance is never returned, so right after another
 * user (or a new session) appears the UI shows nothing of the previous one.
 *
 * `enable` must be called directly in the click handler: it takes the
 * consent generation and asks for the notification permission inside the
 * user's gesture.
 */

import { useSyncExternalStore } from 'react';
import { type Appearance, currentAppearance, subscribeAppearance } from '../auth/appearance';
import {
  disablePush,
  enablePush,
  getPushLifecycleState,
  type PushActionResult,
  type PushLifecycleState,
  removeOtherDevice,
  repeatPushDecision,
  subscribePushLifecycle,
} from './push/pushLifecycle';

export interface UsePushResult {
  /** The push state of the current appearance; blank before its decision. */
  state: PushLifecycleState;
  /** Enables push on this device. Call it directly in the click handler. */
  enable: () => Promise<PushActionResult>;
  /** Disables push on this device (also: removes the current device). */
  disable: () => Promise<PushActionResult>;
  /** Removes another device by its subscription id. */
  removeDevice: (id: string) => Promise<PushActionResult>;
  /** Runs the decision of this appearance again (retry of unfinished work). */
  retry: () => Promise<void>;
}

function sameAppearance(a: Appearance | null, b: Appearance | null): boolean {
  return a === b || (a !== null && b !== null && a.seq === b.seq && a.userId === b.userId);
}

/** A state that shows nothing: the decision of `appearance` has not published yet. */
function blankState(appearance: Appearance | null, from: PushLifecycleState): PushLifecycleState {
  return {
    appearance,
    supported: from.supported,
    decided: false,
    row: null,
    serverPush: 'unknown',
    permission: from.permission,
    consent: null,
    devices: null,
    thisDeviceHash: null,
    foreignChannelWarnings: [],
  };
}

const blanks = new WeakMap<PushLifecycleState, PushLifecycleState>();

/** The controller's state, if it belongs to the current appearance. */
function stateOfCurrentAppearance(): PushLifecycleState {
  const state = getPushLifecycleState();
  const appearance = currentAppearance();
  if (sameAppearance(state.appearance, appearance)) return state;
  // A stable object per controller state, as useSyncExternalStore requires.
  let blank = blanks.get(state);
  if (blank === undefined || !sameAppearance(blank.appearance, appearance)) {
    blank = blankState(appearance, state);
    blanks.set(state, blank);
  }
  return blank;
}

function subscribe(listener: () => void): () => void {
  const offState = subscribePushLifecycle(listener);
  const offAppearance = subscribeAppearance(listener);
  return () => {
    offState();
    offAppearance();
  };
}

export function usePush(): UsePushResult {
  const state = useSyncExternalStore(subscribe, stateOfCurrentAppearance, stateOfCurrentAppearance);

  // The actions publish the list as it is after them; the decision of the
  // appearance is not run again (a lost answer stays unconfirmed until the
  // next appearance, US-1). `enablePush` is passed as is: it must start in
  // the caller's click (the permission prompt).
  return {
    state,
    enable: enablePush,
    disable: disablePush,
    removeDevice: removeOtherDevice,
    retry: repeatPushDecision,
  };
}
