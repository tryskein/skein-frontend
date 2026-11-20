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
 * Explicit logout, in two parts around `POST /api/auth/logout`:
 *   `prepare` — the list confirms U: (a) the server part of the revocation
 *     (`pushLifecycle#revokeConfirmedDevice`); (b) the server says the user
 *     changed: the push part stops and the caller does not log out, the page
 *     appears again with the confirmed user; (c) U could not be confirmed
 *     (lost, session ended, an answer without the contract v2 marker): the
 *     exception of rule 5 — U's consent becomes "explicitly off", `gen`
 *     grows, and with a label or a known channel endpoint a `deviceRevoke`
 *     work guarded `unconfirmed` is written and one revocation is tried;
 *   `finish` — the channel known at the confirmation is removed: in (a), or
 *     in (c) after `ok` of the revocation.
 * The budget starts in the click and bounds both parts: every wait for the
 * `skein.push.store` lock, every push request and the channel removal. A step
 * that ends after the budget, or after the appearance was replaced, sends no
 * request and writes nothing. The explicit logout never takes
 * `skein.push.op`: it does not wait for another tab's network.
 */

import { type PushDevice, type PushOutcome, pushListDevices, pushRevokeDevices } from '../../api/push';
import { currentAppearance } from '../../auth/appearance';
import { browserPushSupported, type ChannelRead, readChannel, removeChannel } from './browserPush';
import { removeLocalChannel, revokeConfirmedDevice } from './pushLifecycle';
import { deleteConsent, readConsent, removePushWork, replacePushWork, revokeConsent, setConsentOffUnconfirmed } from './pushState';
import { guardOf, isLive, live, type PushStep, request, StepEnded } from './pushStep';

/** How long the push parts may hold up an explicit logout. */
export const DEPARTURE_BUDGET_MS = 2000;

/**
 * The part of the budget for confirming the user and reading the channel.
 * The rest is kept for the revocation transition, which an explicit logout
 * writes also when the confirmation did not come in time (rule 5).
 */
export const DEPARTURE_CONFIRM_MS = 1500;

/** What the logout does after `prepare`. */
export type DepartureVerdict = 'proceed' | 'userChanged';

/** The push part of one explicit logout. */
export interface ExplicitDeparture {
  /** The server part of the revocation; `userChanged` — do not log out. */
  prepare(): Promise<DepartureVerdict>;
  /** The removal of the channel; call it after `POST /api/auth/logout`. */
  finish(): Promise<void>;
}

const NO_PUSH: ExplicitDeparture = {
  prepare: async () => 'proceed',
  finish: async () => undefined,
};

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

/** A step of the current appearance with a deadline of {@link DEPARTURE_BUDGET_MS}. */
function budgetedStep(): { step: PushStep; stop: () => void } | null {
  const token = currentAppearance();
  if (token === null || !browserPushSupported()) return null;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException('the push part of the logout ran out of time', 'TimeoutError')),
    DEPARTURE_BUDGET_MS,
  );
  return {
    step: { token, signal: controller.signal },
    stop: () => clearTimeout(timer),
  };
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

/** A step of `step`'s appearance that also ends after `ms`. */
function shorterStep(step: PushStep, ms: number): { step: PushStep; stop: () => void } {
  const controller = new AbortController();
  const end = () => controller.abort(new DOMException('the confirmation ran out of time', 'TimeoutError'));
  const timer = setTimeout(end, ms);
  step.signal.addEventListener('abort', end, { once: true });
  return {
    step: { token: step.token, signal: controller.signal },
    stop: () => {
      clearTimeout(timer);
      step.signal.removeEventListener('abort', end);
    },
  };
}

/**
 * The server part of an explicit logout. Returns the channel endpoint that
 * `finish` removes, or `null`.
 *
 * The list (the confirmation of U) and the channel are read within
 * {@link DEPARTURE_CONFIRM_MS}; whatever did not come by then counts as not
 * read, so the revocation transition of branch (c) still has the rest of the
 * budget.
 */
async function revokeOnLogout(step: PushStep): Promise<string | null> {
  const userId = step.token.userId;
  const confirmation = shorterStep(step, DEPARTURE_CONFIRM_MS);
  let listed: { value: PushOutcome<PushDevice[]> } | undefined;
  let channelRead: { value: ChannelRead } | undefined;
  try {
    [listed, channelRead] = await Promise.all([
      untilAbort(
        request(confirmation.step, (signal) => pushListDevices(userId, signal)),
        confirmation.step.signal,
      ),
      untilAbort(readChannel(), confirmation.step.signal),
    ]);
  } finally {
    confirmation.stop();
  }
  live(step);
  const read: ChannelRead = channelRead?.value ?? { kind: 'unreadable' };
  if (listed?.value.kind === 'ok') {
    // (a) U is confirmed.
    const revocation = await revokeConfirmedDevice(step, listed.value.value, read);
    return revocation.endpoint;
  }
  // (c) U could not be confirmed: the consent of U alone goes off.
  const endpoint = read.kind === 'channel' ? read.channel.endpoint : null;
  const { work } = await revokeConsent(userId, { endpoint, guard: 'unconfirmed' }, guardOf(step));
  if (work === null || work.type !== 'deviceRevoke') return null;
  const outcome = await request(step, (signal) =>
    pushRevokeDevices({ expectedUserId: userId, deviceLabels: work.labels, endpoint: work.endpoint }, signal),
  );
  if (outcome.kind !== 'ok') return null;
  // `ok` confirms U: the work is finished and the channel may go. The
  // removal of the channel takes its place in the same write, so a failed
  // or cut-off removal is repeated on the next page load.
  if (endpoint !== null) {
    await replacePushWork(work.id, { type: 'localUnsubscribe', endpoint }, guardOf(step));
  } else {
    await removePushWork(work.id, guardOf(step));
  }
  const off = readConsent(userId);
  live(step);
  if (off.state === 'off') {
    await setConsentOffUnconfirmed(userId, { gen: off.gen, rev: off.rev }, false, guardOf(step));
  }
  return endpoint;
}

/**
 * Starts the push part of an explicit logout of the rendered user. Call it
 * in the click: the appearance is taken and the budget starts here. Without
 * a user or without push support the push part does nothing.
 */
export function beginExplicitDeparture(): ExplicitDeparture {
  const budgeted = budgetedStep();
  if (budgeted === null) return NO_PUSH;
  const { step, stop } = budgeted;
  let channelToRemove: string | null = null;
  return {
    prepare() {
      const work = revokeOnLogout(step).then(
        (endpoint): DepartureVerdict => {
          channelToRemove = endpoint;
          return 'proceed';
        },
        (error: unknown): DepartureVerdict => {
          if (error instanceof StepEnded && error.reason === 'userChanged') {
            // Nobody logs out: there is no `finish`, the budget ends here.
            stop();
            return 'userChanged';
          }
          return 'proceed';
        },
      );
      return withinBudget(work, step.signal, 'proceed');
    },
    async finish() {
      try {
        const endpoint = channelToRemove;
        if (endpoint !== null && isLive(step)) {
          await withinBudget(removeLocalChannel(step, endpoint), step.signal, false);
        }
      } finally {
        stop();
      }
    },
  };
}

/**
 * The push part of the logout after the deletion of one's own account: the
 * consent of the user is deleted from the push state and the user's channel
 * removed, without a server call, within {@link DEPARTURE_BUDGET_MS}.
 */
export async function departAfterAccountDeletion(): Promise<void> {
  const budgeted = budgetedStep();
  if (budgeted === null) return;
  const { step, stop } = budgeted;
  const work = (async () => {
    const userId = step.token.userId;
    const ownEndpoint = readConsent(userId).endpoint;
    live(step);
    await deleteConsent(userId, guardOf(step));
    if (ownEndpoint === null) return;
    live(step);
    await removeChannel(ownEndpoint, () => live(step));
  })();
  try {
    await withinBudget(work, step.signal, undefined);
  } finally {
    stop();
  }
}
