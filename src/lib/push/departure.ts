/**
 * The push part of the ways a session ends on this page (spec "Ways a session
 * ends", US-4, US-5, INV-3, INV-7).
 *
 *   - explicit logout ("Log out", "switch account" on someone else's
 *     invitation): the device of the rendered user U is revoked and its
 *     channel removed, inside one budget of {@link DEPARTURE_BUDGET_MS};
 *   - logout after the deletion of one's own account: U's consent is deleted
 *     from the push state and U's channel removed, no server call (the
 *     account's subscriptions went with it);
 *   - a consequence of an event (the deactivation of U) and the end of a
 *     session that is not a logout: push is not touched.
 *
 * An explicit logout, from the click:
 *   1. the local part of the revocation is written first — U's consent
 *      becomes "explicitly off", `gen` grows, S moves into a `deviceRevoke`
 *      work guarded `unconfirmed` (rule 5, the exception of an explicit
 *      logout). Nothing that may end the logout cancels this write: not a
 *      401 that signs the page out without another user appearing, not the
 *      budget (a write that waits for `skein.push.store` past it still lands
 *      and leaves the work to the next appearance of U). Only a refusal of
 *      the logout cancels it, or takes it back once written;
 *   2. `skein.push.op` is requested, like any push operation, and held until
 *      the channel is removed or the budget ends: while it is held no other
 *      tab creates or accepts a channel, and a channel made after it is
 *      released belongs to whoever appeared since — this logout never
 *      removes it. U's list is read meanwhile (the confirmation of U);
 *   3. holding the lock, the channel is read. A channel the confirmation
 *      names as U's (in U's list, or the endpoint of U's consent) completes
 *      the work (its endpoint, the guard from the list, the label of its
 *      subscription) and its removal is journaled; then the revocation is
 *      sent. Without a confirmation (lost, session ended, no contract v2
 *      marker) the work still gets the endpoint read and one revocation is
 *      tried; the channel goes only after its `ok`. Without the lock within
 *      {@link DEPARTURE_CONFIRM_MS} the channel is neither read nor removed;
 *   4. the verdict — `proceed`, `userChanged`, `superseded` — is fixed the
 *      moment its cause is known: "user changed" in an answer, another
 *      appearance on this page, or the end of the server part (at the
 *      latest {@link DEPARTURE_PREPARE_MS} after the click). Taking the
 *      transition back after a refusal is a consequence of the verdict that
 *      neither its duration nor its failure changes;
 *   5. `POST /api/auth/logout` goes only after `proceed`, and only while no
 *      "user changed" was heard and no other appearance began
 *      ({@link ExplicitDeparture#refusal}); the removal of the channel runs
 *      beside it, within the budget.
 * Taken back (rule 5) is a transition nothing of which reached the server:
 * its revocation request was not sent, or the server answered "user
 * changed" before it revoked the labels.
 */

import { type PushDevice, pushListDevices } from '../../api/push';
import {
  type Appearance,
  appearedSince,
  currentAppearance,
  subscribeAppearance,
} from '../../auth/appearance';
import { browserPushSupported, type ChannelRead, readChannel } from './browserPush';
import { endpointFingerprint } from './fingerprint';
import { withPushOpLock } from './locks';
import {
  abortPushOperations,
  removeLocalChannel,
  repeatOwnRevocation,
  revocationProgress,
  revocationTakenBack,
  sendRevocation,
} from './pushLifecycle';
import {
  addPushWork,
  type Consent,
  endpointNamedByOther,
  isHeld,
  type PushWork,
  readConsent,
  readPushState,
  refineRevocation,
  removePushWork,
  retireConsent,
  revokeConsent,
  type RevokeGuard,
  setConsentOffUnconfirmed,
  undoRevocation,
} from './pushState';
import { guardOf, isLive, live, type PushStep, request } from './pushStep';

/** How long the push parts may hold up an explicit logout. */
export const DEPARTURE_BUDGET_MS = 2000;

/**
 * The part of the budget for the lock, the confirmation of the user and the
 * reading of the channel. What did not come by then counts as not read.
 */
export const DEPARTURE_CONFIRM_MS = 1500;

/**
 * The part of the budget for the whole server part (`prepare`). The rest is
 * kept for removing the known channel beside the logout request, also when
 * the revocation request does not answer.
 */
export const DEPARTURE_PREPARE_MS = 1750;

/**
 * What the logout does after `prepare`: `proceed` — log out; `userChanged` —
 * the server confirmed another user, do not log out; `superseded` — another
 * appearance replaced the one the logout was for (a login, `/me`), do not
 * log out either.
 */
export type DepartureVerdict = 'proceed' | 'userChanged' | 'superseded';

/** The push part of one explicit logout. */
export interface ExplicitDeparture {
  /** The verdict of the server part (see the module comment). */
  prepare(): Promise<DepartureVerdict>;
  /**
   * Why the logout request must not go now, `null` when it may: "user
   * changed" was heard (also after `proceed`), or another appearance began
   * since the click. Ask right before sending it.
   */
  refusal(): Exclude<DepartureVerdict, 'proceed'> | null;
  /**
   * Removes the channel the confirmation named; call it right after sending
   * `POST /api/auth/logout`, beside it. Settles within the budget.
   */
  finish(): Promise<void>;
  /** The logout request will not be sent: the push part ends here. */
  cancel(): void;
}

type Refusal = Exclude<DepartureVerdict, 'proceed'>;

/** The push part of a logout without push support: only the appearance is checked. */
function withoutPush(token: Appearance | null): ExplicitDeparture {
  return {
    prepare: async () => 'proceed',
    refusal: () => (token !== null && appearedSince(token) ? 'superseded' : null),
    finish: async () => undefined,
    cancel: () => undefined,
  };
}

/** Resolves with `work`, or with `fallback` once `signal` is aborted. */
function withinBudget<T>(work: Promise<T>, signal: AbortSignal, fallback: T): Promise<T> {
  if (signal.aborted) return Promise.resolve(fallback);
  return new Promise<T>((resolve) => {
    const onAbort = () => resolve(fallback);
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      () => {
        signal.removeEventListener('abort', onAbort);
        resolve(fallback);
      },
    );
  });
}

/**
 * Settles with `{ value }` of `work`, or with `undefined` once `signal` is
 * aborted first; a rejection of `work` before that is passed on.
 */
function untilAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<{ value: T } | undefined> {
  if (signal.aborted) return Promise.resolve(undefined);
  return new Promise((resolve, reject) => {
    const onAbort = () => resolve(undefined);
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve({ value });
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

/** A controller aborted after `ms`, or with `parent`; `stop` clears the timer. */
function deadline(ms: number, parent?: AbortSignal): { signal: AbortSignal; stop: () => void } {
  const controller = new AbortController();
  const end = () => controller.abort(new DOMException('the push part of the logout ran out of time', 'TimeoutError'));
  const timer = setTimeout(end, ms);
  if (parent?.aborted) end();
  else parent?.addEventListener('abort', end, { once: true });
  return {
    signal: controller.signal,
    stop: () => {
      clearTimeout(timer);
      parent?.removeEventListener('abort', end);
    },
  };
}

/**
 * `skein.push.op` for the departure: `held` settles `true` once the lock is
 * granted, `false` when `signal` ended the wait first; the lock is kept
 * until `release`.
 */
function holdOpLock(signal: AbortSignal): { held: Promise<boolean>; release: () => void } {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const held = new Promise<boolean>((resolve) => {
    withPushOpLock(async () => {
      resolve(true);
      await released;
    }, signal).catch(() => resolve(false));
  });
  return { held, release };
}

/** Whether the read channel is the one the confirmation names as U's. */
async function confirmedChannel(
  endpoint: string,
  devices: PushDevice[] | null,
  previous: Consent,
): Promise<{ confirmed: boolean; listed?: PushDevice }> {
  if (devices === null) return { confirmed: endpoint === previous.endpoint };
  const hash = await endpointFingerprint(endpoint);
  const listed = devices.find((d) => d.endpointHash === hash);
  return { confirmed: listed !== undefined || endpoint === previous.endpoint, listed };
}

/**
 * Starts the push part of an explicit logout of the rendered user; call it
 * in the click. Without a user or without push support only the appearance
 * is checked before the logout request.
 */
export function beginExplicitDeparture(): ExplicitDeparture {
  const token = currentAppearance();
  if (token === null || !browserPushSupported()) return withoutPush(token);
  const userId = token.userId;

  // ── The verdict and the refusal ──
  let verdict: DepartureVerdict | undefined;
  let decide!: (v: DepartureVerdict) => void;
  const decided = new Promise<DepartureVerdict>((resolve) => {
    decide = resolve;
  });
  let userChangedHeard = false;
  /** The logout request will not go: nothing more is written, the transition is taken back. */
  let abandoned = false;
  const progress = revocationProgress();

  const budget = deadline(DEPARTURE_BUDGET_MS);
  // Until the budget ends the works of this logout are its own: no repeat
  // performs them, so taking them back cannot come after their effect.
  const heldUntil = Date.now() + DEPARTURE_BUDGET_MS;
  const server = deadline(DEPARTURE_PREPARE_MS, budget.signal);
  const lockWait = deadline(DEPARTURE_CONFIRM_MS, server.signal);
  const opLock = holdOpLock(lockWait.signal);

  const step: PushStep = {
    token,
    signal: server.signal,
    holds: () => verdict === undefined && !abandoned && !appearedSince(token),
    onUserChanged: () => {
      userChangedHeard = true;
      settle('userChanged');
    },
  };

  /** What `finish` removes: the endpoint the confirmation named, once its removal is journaled. */
  let removal: string | null = null;
  /** The works this departure wrote, for taking the transition back. */
  const written: string[] = [];
  /** The write completing the transition, once started. */
  let refining: Promise<unknown> = Promise.resolve();
  let ended = false;

  function settle(v: DepartureVerdict): void {
    if (verdict !== undefined) return;
    verdict = v;
    decide(v);
    if (v !== 'proceed') abandon();
  }

  function end(): void {
    if (ended) return;
    ended = true;
    opLock.release();
    unsubscribe();
    budget.stop();
    server.stop();
    lockWait.stop();
  }

  function abandon(): void {
    if (abandoned) return;
    abandoned = true;
    // The lock is kept until the transition is taken back (within the
    // budget): the next tab does not see works about to go.
    void takeBack().finally(end);
  }

  const unsubscribe = subscribeAppearance(() => {
    if (appearedSince(token)) settle('superseded');
  });
  budget.signal.addEventListener('abort', end, { once: true });

  // ── 1. The local part, before anything that may end the logout ──
  abortPushOperations();
  const transition = revokeConsent(userId, { endpoint: null, guard: 'unconfirmed', heldUntil }, {
    check: () => {
      if (abandoned) throw new DOMException('the logout was refused', 'AbortError');
    },
  }).then((result) => {
    if (result.work !== null) written.push(result.work.id);
    return result;
  });
  transition.catch(() => undefined);

  async function takeBack(): Promise<void> {
    // Kept once the revocation may have reached the server: its own request
    // was sent and not refused as "user changed" (see RevocationProgress).
    if (!revocationTakenBack(progress)) return;
    let result: Awaited<typeof transition>;
    try {
      result = await transition;
    } catch {
      return;
    }
    await refining.catch(() => undefined);
    try {
      await undoRevocation(userId, {
        expect: { gen: result.consent.gen, rev: result.consent.rev },
        previous: result.previous,
        workIds: written,
        before: heldUntil,
      });
    } catch {
      // The record moved on meanwhile; its newer state stays.
    }
  }

  // ── 2–3. The lock, the confirmation, the channel, the revocation ──
  const part = serverPart();
  part.then(
    () => settle('proceed'),
    () => settle('proceed'),
  );
  server.signal.addEventListener('abort', () => settle('proceed'), { once: true });

  async function serverPart(): Promise<void> {
    const confirm = deadline(DEPARTURE_CONFIRM_MS, server.signal);
    const confirmStep: PushStep = { ...step, signal: confirm.signal };
    let devices: PushDevice[] | null = null;
    let read: ChannelRead = { kind: 'unreadable' };
    let previous: Consent;
    let work: PushWork | null;
    try {
      const listing = untilAbort(
        request(confirmStep, (signal) => pushListDevices(userId, signal)),
        confirm.signal,
      );
      // The channel is read as soon as the lock is held, beside the list.
      const channelRead = opLock.held.then((held): Promise<ChannelRead> =>
        held ? readChannel() : Promise.resolve({ kind: 'unreadable' }),
      );
      const [listed, channel, done] = await Promise.all([
        listing,
        untilAbort(channelRead, confirm.signal),
        untilAbort(transition, confirm.signal),
      ]);
      // The transition did not land in time: the store is held elsewhere,
      // nothing more can be written; the transition itself still lands.
      if (done === undefined) return;
      previous = done.value.previous;
      work = done.value.work;
      if (listed?.value.kind === 'ok') devices = listed.value.value;
      if (channel !== undefined) read = channel.value;
      live(step);
      if (read.kind === 'channel') {
        const endpoint = read.channel.endpoint;
        const named = await untilAbort(confirmedChannel(endpoint, devices, previous), confirm.signal);
        live(step);
        // A channel the confirmation does not name is not U's: another tab
        // made it for someone else before the lock came to this logout.
        if (named !== undefined && (named.value.confirmed || devices === null)) {
          const listedSub = named.value.listed;
          const guard: RevokeGuard =
            devices === null ? 'unconfirmed' : listedSub === undefined ? 'absent' : { id: listedSub.id, version: listedSub.version };
          const removable = named.value.confirmed && devices !== null;
          const refined = refineRevocation(
            userId,
            {
              workId: work?.id ?? null,
              endpoint,
              guard,
              listed: listedSub === undefined ? undefined : { id: listedSub.id, label: listedSub.deviceLabel },
              localUnsubscribe: removable,
              heldUntil,
            },
            guardOf(step),
          );
          refining = refined;
          const result = await refined;
          if (!written.includes(result.work.id)) written.push(result.work.id);
          if (result.localWork !== null) written.push(result.localWork.id);
          work = result.work;
          if (removable) removal = endpoint;
        }
      }
    } finally {
      confirm.stop();
    }

    if (devices !== null) {
      // (a) U is confirmed.
      let done = work === null ? read.kind === 'none' : await repeatOwnRevocation(step, asRevocation(work), progress);
      for (const earlier of readPushState().works) {
        if (earlier.type !== 'deviceRevoke' || earlier.ownerUserId !== userId || earlier.id === work?.id || isHeld(earlier)) continue;
        done = (await repeatOwnRevocation(step, earlier)) && done;
      }
      if (done) await clearOffUnconfirmed();
      return;
    }
    // (c) U could not be confirmed: one revocation is tried.
    if (work === null) return;
    const revocation = asRevocation(work);
    const outcome = await sendRevocation(step, revocation.labels, revocation.endpoint, progress);
    if (outcome.kind !== 'ok') return;
    progress.revoked = true;
    // `ok` confirms U. Without a list the label of the subscription at the
    // endpoint is unknown, and a revocation by endpoint leaves a labelled
    // one: the work stays until the owner's repeat checked the endpoint
    // against the list. The channel goes if it is the one U's consent
    // names, its removal journaled.
    if (revocation.endpoint !== undefined) {
      if (revocation.endpoint === previous.endpoint) {
        const local = await addPushWork({ type: 'localUnsubscribe', endpoint: revocation.endpoint, heldUntil }, guardOf(step));
        written.push(local.id);
        removal = revocation.endpoint;
      }
      return;
    }
    await removePushWork(revocation.id, guardOf(step));
    await clearOffUnconfirmed();
  }

  async function clearOffUnconfirmed(): Promise<void> {
    const off = readConsent(userId);
    live(step);
    if (off.state === 'off') await setConsentOffUnconfirmed(userId, { gen: off.gen, rev: off.rev }, false, guardOf(step));
  }

  return {
    prepare: () => decided,
    refusal: (): Refusal | null => {
      if (userChangedHeard) return 'userChanged';
      if (verdict !== undefined && verdict !== 'proceed') return verdict;
      return appearedSince(token) ? 'superseded' : null;
    },
    async finish() {
      try {
        const endpoint = removal;
        if (endpoint !== null && !abandoned && !ended) {
          const local: PushStep = { token, signal: budget.signal, holds: () => !abandoned && !appearedSince(token) };
          if (isLive(local)) await withinBudget(removeLocalChannel(local, endpoint), budget.signal, false);
        }
      } finally {
        end();
      }
    },
    cancel: abandon,
  };
}

function asRevocation(work: PushWork): Extract<PushWork, { type: 'deviceRevoke' }> {
  if (work.type !== 'deviceRevoke') throw new Error('not a revocation work');
  return work;
}

/**
 * How the logout after an account deletion goes on: `proceed` — send the
 * logout request (only the cookie of the deleted session is cleared);
 * `userChanged` — the cookie is another user's, no request; `superseded` —
 * another appearance replaced the owner's on this page; `unknown` — who the
 * cookie names did not come within the budget, no request either (the
 * deleted account is signed out on the server already, and the request
 * might end someone else's session).
 */
export type DeletionVerdict = 'proceed' | 'userChanged' | 'superseded' | 'unknown';

/**
 * The push part of the logout after the deletion of one's own account, and
 * the check of whose session the cookie holds now; both within
 * {@link DEPARTURE_BUDGET_MS}.
 *
 * Holding `skein.push.op` (waited for at most {@link DEPARTURE_CONFIRM_MS}):
 * the owner's operations of any tab that started before have ended, and
 * those that start after it fail their confirmation (the account is gone).
 * The consent of the owner is deleted, the removal of the channel its
 * endpoint names journaled, then the channel this browser has is read and
 * removed — also a subscription the user never accepted, or a channel the
 * consent no longer names — unless another user's consent names it. Without
 * the lock the consent is still deleted with that journal, and the channel
 * is neither read nor removed. No server call.
 *
 * `owner` is the appearance in which the deletion was asked for. The clean-up
 * is the owner's also when the page has no user any more (a 401 of the
 * deleted session came first); only another appearance on this page stops
 * it. `whoIsSignedIn` answers whose session the cookie holds (`null`: none).
 */
export async function departAfterAccountDeletion(
  owner: Appearance | null,
  whoIsSignedIn: () => Promise<string | null>,
): Promise<DeletionVerdict> {
  const token = owner ?? currentAppearance();
  if (token !== null && appearedSince(token)) return 'superseded';
  const budget = deadline(DEPARTURE_BUDGET_MS);
  try {
    const session = untilAbort(whoIsSignedIn(), budget.signal).catch(() => undefined);
    const local = token !== null && browserPushSupported() ? cleanUp(token, budget.signal) : Promise.resolve();
    const [cookie] = await Promise.all([session, withinBudget(local, budget.signal, undefined)]);
    if (token !== null && appearedSince(token)) return 'superseded';
    if (cookie === undefined) return 'unknown';
    return cookie.value === null ? 'proceed' : 'userChanged';
  } finally {
    budget.stop();
  }
}

/** The local clean-up of {@link departAfterAccountDeletion}. */
async function cleanUp(token: Appearance, signal: AbortSignal): Promise<void> {
  const userId = token.userId;
  const step: PushStep = { token, signal, holds: () => !appearedSince(token) };
  abortPushOperations();
  const lockWait = deadline(DEPARTURE_CONFIRM_MS, signal);
  const opLock = holdOpLock(lockWait.signal);
  // The lock goes with the budget, also while a browser call still hangs.
  signal.addEventListener('abort', opLock.release, { once: true });
  try {
    const held = await opLock.held;
    live(step);
    const { journaled } = await retireConsent(userId, guardOf(step));
    if (!held) return;
    const read = await readChannel();
    live(step);
    if (read.kind === 'unreadable') return;
    if (read.kind === 'none') {
      // The channel the consent named is gone already.
      if (journaled !== null) await removePushWork(journaled.id, guardOf(step));
      return;
    }
    const endpoint = read.channel.endpoint;
    if (endpoint !== journaled?.endpoint) {
      if (journaled !== null) await removePushWork(journaled.id, guardOf(step));
      if (endpointNamedByOther(userId, endpoint)) return;
      await addPushWork({ type: 'localUnsubscribe', endpoint }, guardOf(step));
    }
    await removeLocalChannel(step, endpoint);
  } finally {
    lockWait.stop();
    signal.removeEventListener('abort', opLock.release);
    opLock.release();
  }
}
