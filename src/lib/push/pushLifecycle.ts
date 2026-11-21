/**
 * The push controller of the page (one per tab): what the page does with
 * push on a user's appearance (spec US-2, the decision table), and the state
 * the push UI shows.
 *
 * On page load, with or without a user, it repeats the unfinished local
 * channel removals (`localUnsubscribe`) whose channel is still current. On
 * every appearance of a user U (`auth/appearance.ts`) it takes
 * `skein.push.op` and, with the appearance as its token:
 *   1. repeats the unfinished work (rule 6): local channel removals; foreign
 *      channel removals (`foreignRemoval`) for any user; U's own device
 *      revocations (`deviceRevoke` of owner U) — only U repeats them, and
 *      while one is unfinished rows 2 and 4 of U wait; another user's device
 *      revocation is repeated by U as a removal of a foreign channel: with
 *      the guard `{id, version}` a conditional removal (`ifSubscription`),
 *      with `absent` or `unconfirmed` no server call — the owner's work is
 *      never finished by U;
 *   2. reads the browser channel, then U's subscription list as the expected
 *      user U — the list is the server's confirmation of U in this decision;
 *   3. decides by the table (`decide.ts`) and executes the row.
 *
 * Rule 5: every push request carries U as the expected user. "User changed"
 * on any of them ends the decision without a local or server consequence and
 * `/me` is read again, which starts a new appearance. "Session ended" and
 * "lost" (also any answer without the contract v2 marker) change neither the
 * consent nor the work. The local effects of a decision — writes of the push
 * state, removal of a channel, publication of the UI state — happen only
 * after the list confirmed U in this decision and only while the appearance
 * is still current; a channel is removed only by the endpoint known when U
 * was confirmed. A work is finished only by `ok`.
 *
 * Warning B (US-6): row 5 writes a `foreignRemoval` work for the previous
 * user's endpoint; the warning lasts while that work is unfinished and goes
 * only with `ok` of the removal WITHOUT `ifSubscription` at that endpoint. An
 * `ok` of a conditional removal proves nothing about delivery to the
 * endpoint and changes neither the warning nor the owner's work.
 *
 * Without service worker, Push API, notifications or Web Locks the controller
 * does nothing (Edge 13).
 */

import {
  getPushConfig,
  pushListDevices,
  pushRemoveChannel,
  pushRemoveDevice,
  pushRevokeDevices,
  pushSubscribe,
  type PushDevice,
  type PushOutcome,
} from '../../api/push';
import {
  type Appearance,
  currentAppearance,
  isCurrentAppearance,
  reloadMeAfterUserChanged,
  subscribeAppearance,
} from '../../auth/appearance';
import {
  type BrowserChannel,
  browserPushSupported,
  type ChannelKeys,
  type ChannelRead,
  createChannel,
  notificationPermission,
  type NotificationPermissionState,
  readChannel,
  removeChannel,
  requestNotificationPermission,
} from './browserPush';
import { decide, type DecisionAction, type DecisionChannel, type DecisionRow, type RegisterPlan } from './decide';
import { endpointFingerprint, keysFingerprint } from './fingerprint';
import { afterLockReleased, heldLockNames, liveDeparturesOf, withPushOpLock } from './locks';
import { guardOf, isLive, live, type PushStep, request, StepEnded } from './pushStep';
import {
  abandonConsentLabel,
  addPushWork,
  beginConsentLabel,
  type Consent,
  claimedByOther,
  offNamingOthers,
  type ConsentSnapshot,
  DepartureInProgressError,
  noLiveDeparture,
  confirmConsent,
  isHeld,
  MAX_CONSENT_LABELS,
  PushLabelLimitError,
  PushStateConflictError,
  type PushWork,
  readConsent,
  readConsentGen,
  readPushState,
  recordUnconfirmedChannel,
  removePushWork,
  restoreConsent,
  revokeConsent,
  undoRevocation,
  type RevokeGuard,
  setConsentOffUnconfirmed,
  updateConsentChannel,
} from './pushState';

// ───────────────────────── State for the UI ─────────────────────────

/** What the push UI of the current appearance shows. */
export interface PushLifecycleState {
  /** The appearance this state belongs to; `null` without a user. */
  appearance: Appearance | null;
  /** The browser supports push (service worker, Push API, notifications, Web Locks). */
  supported: boolean;
  /**
   * The decision of this appearance ran with a read channel and a read list
   * (any row but 0 and 1).
   */
  decided: boolean;
  /** Row of that decision; `null` before it, or when row 6 was excluded by a full S. */
  row: DecisionRow | null;
  /**
   * Push on the server: `enabled` (it publishes a VAPID key), `disabled`
   * (the key is empty), `unknown` (the configuration could not be read, or
   * not yet).
   */
  serverPush: ServerPush;
  permission: NotificationPermissionState;
  /** The consent of the appearing user; `null` without a user. */
  consent: Consent | null;
  /** The user's subscriptions as the decision read them; `null` until read. */
  devices: PushDevice[] | null;
  /**
   * `endpointHash` of this device's subscription: of the channel read by the
   * decision, or of the consent's endpoint when there was no channel; `null`
   * when neither is known.
   */
  thisDeviceHash: string | null;
  /**
   * Endpoints of previous users' channels in this browser whose removal on
   * the server is not confirmed yet (warning B). For a user, filled by the
   * decision of this appearance, never carried over from the previous one.
   */
  foreignChannelWarnings: string[];
}

type Listener = () => void;

function initialState(appearance: Appearance | null): PushLifecycleState {
  return {
    appearance,
    supported: browserPushSupported(),
    decided: false,
    row: null,
    serverPush: 'unknown',
    permission: notificationPermission(),
    consent: appearance === null ? null : readConsent(appearance.userId),
    devices: null,
    thisDeviceHash: null,
    foreignChannelWarnings: appearance === null ? foreignWarnings() : [],
  };
}

let state: PushLifecycleState | null = null;
const listeners = new Set<Listener>();

function foreignWarnings(): string[] {
  const endpoints: string[] = [];
  for (const work of readPushState().works) {
    if (work.type === 'foreignRemoval' && !endpoints.includes(work.endpoint)) endpoints.push(work.endpoint);
  }
  return endpoints;
}

function setState(next: PushLifecycleState): void {
  state = next;
  for (const listener of [...listeners]) listener();
}

/** The state of the current appearance. */
export function getPushLifecycleState(): PushLifecycleState {
  if (state === null) state = initialState(currentAppearance());
  return state;
}

/** Subscribes to the state; returns the unsubscribe. */
export function subscribePushLifecycle(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// ───────────────────────── Steps ─────────────────────────

/** A push step of this controller (`pushStep.ts`). */
type Step = PushStep;

/** Publishes the UI state of the step's appearance. */
function publish(step: Step, patch: Partial<PushLifecycleState>): void {
  live(step);
  const base = state !== null && state.appearance === step.token ? state : initialState(step.token);
  setState({
    ...base,
    ...patch,
    appearance: step.token,
    consent: readConsent(step.token.userId),
    foreignChannelWarnings: foreignWarnings(),
  });
}

/**
 * Shows the warnings of the browser's works again in the state of the step's
 * appearance after an undo — the step itself has ended, its appearance may
 * still be current.
 */
function republishWarnings(step: Step): void {
  if (state === null || state.appearance !== step.token || !isCurrentAppearance(step.token)) return;
  setState({ ...state, foreignChannelWarnings: foreignWarnings() });
}

function snapshotOf(consent: Consent): ConsentSnapshot {
  return { gen: consent.gen, rev: consent.rev };
}

/**
 * Removes the channel `endpoint` if it is still current; `failed` when the
 * browser failed. With a step, the step must still be live right before the
 * unsubscription (else {@link StepEnded} is thrown); without one — the
 * repeats on page load and the removal of a channel the step itself just
 * created — nothing is checked.
 */
async function removeChannelQuietly(
  endpoint: string,
  step: Step | null,
  signal?: AbortSignal,
): Promise<'removed' | 'notCurrent' | 'failed'> {
  try {
    return step === null
      ? await removeChannel(endpoint, undefined, signal)
      : await removeChannel(endpoint, () => live(step), step.signal);
  } catch (error) {
    if (error instanceof StepEnded) throw error;
    return 'failed';
  }
}

/**
 * Removes the channel `endpoint` with a `localUnsubscribe` work written
 * first and finished only by the browser's success, so a failed or cut-off
 * removal is repeated on the next page load.
 */
async function removeChannelJournaled(step: Step, endpoint: string): Promise<void> {
  if (!readPushState().works.some((w) => w.type === 'localUnsubscribe' && w.endpoint === endpoint)) {
    await addPushWork({ type: 'localUnsubscribe', endpoint, ownerUserId: step.token.userId }, guardOf(step));
  }
  await removeLocalChannel(step, endpoint);
}

/**
 * Creates a channel for the step; the step must be live right before each
 * browser effect. A channel that came into being although the step ended
 * meanwhile is removed again: it is nobody's.
 */
async function createChannelFor(step: Step, publicKey: string): Promise<BrowserChannel> {
  const channel = await createChannel(publicKey, step.signal, () => live(step));
  if (!isLive(step)) {
    await dropCreatedChannel(channel.endpoint, step.token.userId);
    throw new StepEnded('superseded');
  }
  return channel;
}

async function removeWorks(step: Step, match: (work: PushWork) => boolean): Promise<void> {
  for (const work of readPushState().works) {
    if (match(work)) await removePushWork(work.id, guardOf(step));
  }
}

// ───────────────────────── Repeats of unfinished work ─────────────────────────

/**
 * Repeats a local channel removal: the channel is unsubscribed only if its
 * endpoint is still the work's; a channel that is no longer current finishes
 * the work as well. A browser failure keeps it.
 */
async function repeatLocalUnsubscribe(
  work: Extract<PushWork, { type: 'localUnsubscribe' }>,
  step: Step | null,
  signal: AbortSignal | undefined,
  onHeld: (lock: string | null) => void,
): Promise<void> {
  if (step !== null) live(step);
  // The record first, then the locks (see repeatWork).
  const record = readPushState();
  if (claimedByOther(work, record)) {
    // Another user accepted this channel since: it is theirs now.
    await removePushWork(work.id, step === null ? undefined : guardOf(step));
    return;
  }
  const others = offNamingOthers(work, record);
  if (others.length > 0) {
    // Another user whose consent names this channel may be logging out:
    // while that may still be taken back, the channel is theirs.
    const held = await heldLocksOrNull();
    const departing = held === null ? null : others.flatMap((id) => liveDeparturesOf(held, id));
    if (departing === null) {
      onHeld(null);
      return;
    }
    if (departing.length > 0) {
      for (const lock of departing) onHeld(lock);
      return;
    }
  }
  const result = await removeChannelQuietly(work.endpoint, step, signal);
  if (result === 'failed') return;
  if (step !== null) live(step);
  await removePushWork(work.id, step === null ? undefined : guardOf(step));
}

/**
 * Rule 6: the unfinished work of the browser, as user `step.token.userId`.
 * A work an explicit logout still holds (`pushState.ts#isHeld`) is skipped,
 * and `onHeld` hears its lock at once — the repeat is arranged at the first
 * skip, whatever the rest of the step does.
 */
async function repeatWork(step: Step, onHeld: (lock: string | null) => void): Promise<void> {
  const userId = step.token.userId;
  // The journal first, then the locks: a work written by a logout carries a
  // lock taken before the write, so a snapshot taken after the read shows
  // it while that logout is live.
  const works = readPushState().works;
  const held = await heldLocksOrNull();
  live(step);
  for (const work of works) {
    if (held === null ? heldByOf(work) !== '' : isHeld(work, held)) {
      // Without a snapshot no marked work is taken for free (no fail-open).
      onHeld(held === null ? null : heldByOf(work));
      continue;
    }
    switch (work.type) {
      case 'localUnsubscribe':
        await repeatLocalUnsubscribe(work, step, undefined, onHeld);
        break;
      case 'foreignRemoval': {
        const outcome = await request(step, (signal) =>
          pushRemoveChannel({ expectedUserId: userId, endpoint: work.endpoint }, signal),
        );
        if (outcome.kind === 'ok') await removeWorks(step, (w) => w.type === 'foreignRemoval' && w.endpoint === work.endpoint);
        break;
      }
      case 'deviceRevoke':
        if (work.ownerUserId === userId) {
          await repeatOwnRevocation(step, work);
        } else if (typeof work.guard === 'object' && work.endpoint !== undefined) {
          // Another user's revocation: only the subscription the owner's
          // confirmed list showed, and only if it is still that record. The
          // answer finishes nothing of the owner's.
          const ifSubscription = work.guard;
          const endpoint = work.endpoint;
          await request(step, (signal) =>
            pushRemoveChannel({ expectedUserId: userId, endpoint, ifSubscription }, signal),
          );
        }
        break;
    }
  }
}

/** The lock a held work is held by. */
function heldByOf(work: PushWork): string {
  return work.type === 'foreignRemoval' ? '' : (work.heldBy ?? '');
}

/** How many times a repeat is tried again when the browser's locks could not be read or waited for. */
export const HOLD_RETRIES = 3;

/** How long to wait before such a try. */
export const HOLD_RETRY_MS = 1000;

/** The snapshot of the held locks, or `null` when the browser cannot give one. */
async function heldLocksOrNull(): Promise<Set<string> | null> {
  try {
    return await heldLockNames();
  } catch {
    return null;
  }
}

/** Repeats waiting, by the lock (or `''` for a retry) and the repeat they run. */
const waiting = new Map<string, Set<string>>();

/** How many tries a repeat already had after the locks could not be read or waited for. */
const retries = new Map<string, number>();

/**
 * Runs `repeat` once the lock `lock` is free — the explicit logout that held
 * the works a repeat skipped has ended — while the controller still runs.
 * Each lock is waited for on its own; one wait per lock and `key`. With
 * `lock` `null` (the locks could not be read), or when the wait itself is
 * refused, `repeat` runs again after {@link HOLD_RETRY_MS}, at most
 * {@link HOLD_RETRIES} times per `key`.
 */
function repeatWhenFree(lock: string | null, key: string, repeat: () => Promise<void>): void {
  const name = lock ?? '';
  const keys = waiting.get(name) ?? new Set<string>();
  if (keys.has(key)) return;
  keys.add(key);
  waiting.set(name, keys);
  const run = () => {
    keys.delete(key);
    if (keys.size === 0) waiting.delete(name);
    if (stopAppearance !== null) void repeat().catch(() => undefined);
  };
  const later = () => {
    const tries = retries.get(key) ?? 0;
    if (tries >= HOLD_RETRIES) {
      keys.delete(key);
      if (keys.size === 0) waiting.delete(name);
      return;
    }
    retries.set(key, tries + 1);
    setTimeout(run, HOLD_RETRY_MS);
  };
  if (lock === null) later();
  else afterLockReleased(lock).then(run, later);
}

/**
 * How far the server part of a revocation got: `sent` — its revocation
 * request went out; `revoked` — the server confirmed it; `refused` — the
 * server answered that very request "user changed". A transition is taken
 * back only while nothing of it can have reached the server: before `sent`,
 * or when its own request was refused (rule 5). A lost or pending answer of
 * that request, or "user changed" on any other request (an earlier work,
 * the list, the removal by id), keeps the transition and its work, which the
 * owner's next appearance finishes.
 */
export interface RevocationProgress {
  sent: boolean;
  /** The answer of the revocation request came, whatever it was. */
  answered: boolean;
  revoked: boolean;
  refused: boolean;
}

/** A progress before anything was sent. */
export function revocationProgress(): RevocationProgress {
  return { sent: false, answered: false, revoked: false, refused: false };
}

/** Whether a revocation at `progress` is taken back. */
export function revocationTakenBack(progress: RevocationProgress): boolean {
  return !progress.sent || progress.refused;
}

/**
 * Sends the revocation of `labels` and `endpoint` as the first request of a
 * revocation, recording its progress.
 */
export async function sendRevocation(
  step: Step,
  labels: string[],
  endpoint: string | undefined,
  progress?: RevocationProgress,
): Promise<PushOutcome> {
  const userId = step.token.userId;
  return request(step, async (signal) => {
    if (progress !== undefined) progress.sent = true;
    const outcome = await pushRevokeDevices({ expectedUserId: userId, deviceLabels: labels, endpoint }, signal);
    // Recorded as the answer arrives, before the step hears it.
    if (progress !== undefined) {
      progress.answered = true;
      if (outcome.kind === 'userChanged') progress.refused = true;
    }
    return outcome;
  });
}

/**
 * Sends the owner's revocation work as the step's user, its owner: the
 * labels and the endpoint in one request, then the removal by id it
 * records — or, for a work written without a confirmed list, of the
 * subscription the owner's list still shows at the endpoint. Only when all
 * of it is confirmed is the work finished; it then returns `true`.
 */
export async function repeatOwnRevocation(
  step: Step,
  work: Extract<PushWork, { type: 'deviceRevoke' }>,
  progress?: RevocationProgress,
): Promise<boolean> {
  const userId = step.token.userId;
  const outcome = await sendRevocation(step, work.labels, work.endpoint, progress);
  if (outcome.kind !== 'ok') return false;
  if (progress !== undefined) progress.revoked = true;
  let removeId = work.removeSubscriptionId;
  if (work.guard === 'unconfirmed' && work.endpoint !== undefined) {
    // Written without a confirmed list (an explicit logout that could not
    // confirm the user): the subscription at the endpoint may carry a label
    // the work does not know, which a revocation by endpoint leaves. The
    // owner's list decides: such a subscription is removed by id.
    const listed = await request(step, (signal) => pushListDevices(userId, signal));
    if (listed.kind !== 'ok') return false;
    const hash = await endpointFingerprint(work.endpoint);
    const left = listed.value.find((d) => d.endpointHash === hash);
    if (left !== undefined) removeId = left.id;
  }
  if (removeId !== undefined) {
    const id = removeId;
    const removal = await request(step, (signal) => pushRemoveDevice({ expectedUserId: userId, id }, signal));
    if (removal.kind !== 'ok' && removal.kind !== 'notFound') return false;
  }
  await removePushWork(work.id, guardOf(step));
  return true;
}

// ───────────────────────── The decision ─────────────────────────

/** What one decision knows after U was confirmed. */
interface DecisionContext {
  step: Step;
  userId: string;
  consent: Consent;
  /** The channel read in this decision, `null` when there was none. */
  channel: BrowserChannel | null;
  channelKeysFingerprint: string | null;
  devices: PushDevice[];
  publicKey: string;
  /** Row 7 removed this device on the server in this decision. */
  deviceRemoved: boolean;
}

/** The guard of a revocation from U's confirmed list: U's subscription at `endpoint`, or `absent`. */
async function guardFromList(devices: PushDevice[], endpoint: string): Promise<RevokeGuard> {
  const hash = await endpointFingerprint(endpoint);
  const listed = devices.find((d) => d.endpointHash === hash);
  return listed === undefined ? 'absent' : { id: listed.id, version: listed.version };
}

/**
 * Clears "disable not confirmed" once nothing of this device is left on the
 * server: no unfinished own revocation, and no subscription of this channel
 * or of the consent's endpoint in the list just read.
 */
async function settleOffUnconfirmed(ctx: DecisionContext): Promise<void> {
  const consent = readConsent(ctx.userId);
  if (consent.state !== 'off' || !consent.offUnconfirmed) return;
  if (readPushState().works.some((w) => w.type === 'deviceRevoke' && w.ownerUserId === ctx.userId)) return;
  if (!ctx.deviceRemoved) {
    const endpoints = [ctx.channel?.endpoint, consent.endpoint].filter((e): e is string => typeof e === 'string');
    for (const endpoint of endpoints) {
      const hash = await endpointFingerprint(endpoint);
      if (ctx.devices.some((d) => d.endpointHash === hash)) return;
    }
  }
  live(ctx.step);
  await setConsentOffUnconfirmed(ctx.userId, snapshotOf(consent), false, guardOf(ctx.step));
}

/**
 * The server refused a registration as "revoked": the consent becomes
 * "explicitly off" (S moves into a revocation work guarded by this list),
 * the revocation is sent right away, and the channel is removed.
 */
async function goOffAfterRevoked(ctx: DecisionContext, endpoint: string): Promise<void> {
  const { step, userId } = ctx;
  const guard = await guardFromList(ctx.devices, endpoint);
  live(step);
  // Only for the consent the registration was sent for: a revocation or the
  // deletion of the account since then keeps its own result.
  const { work } = await revokeConsent(
    userId,
    { endpoint, guard, localUnsubscribe: true, expect: { gen: ctx.consent.gen } },
    guardOf(step),
  );
  if (work !== null && work.type === 'deviceRevoke') {
    const outcome = await request(step, (signal) =>
      pushRevokeDevices({ expectedUserId: userId, deviceLabels: work.labels, endpoint: work.endpoint }, signal),
    );
    if (outcome.kind === 'ok') {
      await removePushWork(work.id, guardOf(step));
      const off = readConsent(userId);
      if (off.state === 'off') await setConsentOffUnconfirmed(userId, snapshotOf(off), false, guardOf(step));
    }
  }
  await removeLocalChannel(step, endpoint);
}

/**
 * Passes `outcome` on; when it ends the step as "user changed" — or fails in
 * any way before the request was sent, as `sent` tells — `undo` takes
 * back what the decision prepared for this request first (rule 5: the refused
 * or abandoned decision leaves no consequence). After a request was sent and
 * its answer is unknown, nothing is undone: the next appearance repeats it.
 * A failed undo leaves the record as it is.
 */
async function undoingOnUserChanged<T>(
  outcome: Promise<T>,
  undo?: () => Promise<void>,
  sent?: () => boolean,
): Promise<T> {
  try {
    return await outcome;
  } catch (error) {
    // Also when the step ended before its request was sent: nothing reached
    // the server, so nothing the decision prepared for it may stay.
    const notSent = sent !== undefined && !sent();
    const userChanged = error instanceof StepEnded && error.reason === 'userChanged';
    if (undo !== undefined && (userChanged || notSent)) {
      try {
        await undo();
      } catch {
        // The record moved on meanwhile; its newer state stays.
      }
    }
    throw error;
  }
}

/**
 * Whether a revocation of this device that stands took `label` since it was
 * sent: a revocation transition moves S whole into its work, and only that
 * takes a label out of S. A transition taken back puts S back — the
 * generation grows all the same, so it is the barrier for writes, not the
 * proof of a revocation. A retired consent (the account was deleted) holds
 * no label.
 */
function revokedSince(userId: string, label: string): boolean {
  return !readConsent(userId).labels.includes(label);
}

/**
 * Removes the channel an operation created for `label` when a revocation
 * that stands took that label (`revokedSince`). A label that went into the
 * work of an explicit logout still live is not that yet — the logout may
 * take it back: the removal is then decided again, under `skein.push.op`,
 * once that logout ended.
 */
async function dropIfRevoked(userId: string, label: string, endpoint: string): Promise<void> {
  if (!revokedSince(userId, label)) return;
  // The journal first, then the locks (see repeatWork).
  const works = readPushState().works;
  const held = await heldLocksOrNull();
  const holder = works.find(
    (w): w is Extract<PushWork, { type: 'deviceRevoke' }> =>
      w.type === 'deviceRevoke' &&
      w.ownerUserId === userId &&
      w.labels.includes(label) &&
      w.heldBy !== undefined &&
      (held === null || held.has(w.heldBy)),
  );
  if (holder === undefined) {
    await dropCreatedChannel(endpoint, userId);
    return;
  }
  repeatWhenFree(held === null ? null : (holder.heldBy ?? null), `drop:${endpoint}`, () =>
    withPushOpLock(() => dropIfRevoked(userId, label, endpoint)),
  );
}

/**
 * Passes `outcome` on; when it fails after the registration of a channel
 * the step created was sent and `revokedSince` says a revocation of this
 * device came meanwhile, the channel is removed: the revocation did not know
 * it, so it is nobody's. Without a revocation the channel stays — the
 * consent is unconfirmed, and the next appearance repeats the registration.
 */
async function compensatingCreated<T>(
  created: boolean,
  sent: () => boolean,
  label: string,
  endpoint: string,
  userId: string,
  outcome: Promise<T>,
): Promise<T> {
  try {
    return await outcome;
  } catch (error) {
    if (created && sent()) await dropIfRevoked(userId, label, endpoint);
    throw error;
  }
}

/**
 * The undo of a write before the registration of a channel the step
 * created: the consent is put back if nothing wrote it since, and the
 * channel goes in any case — also when a newer write (a revocation) keeps
 * the consent as it is.
 */
function undoWithCreatedChannel(undoConsent: () => Promise<void>, endpoint: string, userId: string): () => Promise<void> {
  return async () => {
    try {
      await undoConsent();
    } finally {
      await dropCreatedChannel(endpoint, userId);
    }
  };
}

/**
 * How long removing a channel an operation created waits for the browser —
 * the whole removal, the unsubscription included — before it journals the
 * removal instead; and, apart from that, how long it waits to journal it.
 */
export const COMPENSATION_WAIT_MS = 1500;

/** Resolves with `work`, or with `late` after `ms`. */
function orAfter<T, L>(work: Promise<T>, ms: number, late: L): Promise<T | L> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(late), ms);
    void work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(late);
      },
    );
  });
}

/**
 * Removes a channel the operation created and nobody accepted. The browser
 * is waited for at most {@link COMPENSATION_WAIT_MS} — the operation may hold
 * `skein.push.op`; when it fails or does not answer, the removal is
 * journaled for the repeats (`localUnsubscribe` of `ownerUserId`, which no
 * repeat performs once another user has confirmed that channel), waiting for
 * the store at most as long again. An unsubscription still running that
 * lands later leaves the repeat a channel that is gone already.
 */
async function dropCreatedChannel(endpoint: string, ownerUserId: string): Promise<void> {
  const bound = new AbortController();
  const result = await orAfter(removeChannelQuietly(endpoint, null, bound.signal), COMPENSATION_WAIT_MS, 'late' as const);
  bound.abort(new DOMException('the browser did not answer', 'TimeoutError'));
  if (result === 'removed' || result === 'notCurrent') return;
  const journal = new AbortController();
  const timer = setTimeout(() => journal.abort(new DOMException('the store did not answer', 'TimeoutError')), COMPENSATION_WAIT_MS);
  try {
    await addPushWork({ type: 'localUnsubscribe', endpoint, ownerUserId }, { signal: journal.signal });
  } catch {
    // The store failed too: the channel stays to the decision table (row 5).
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Sends a registration of the step's user unless an explicit logout of that
 * user is live (`locks.ts#DEPARTURE_LOCK_PREFIX`), checked right before the
 * request — the label was already written before that logout began, so its
 * transition revokes it. A live logout, or one that cannot be ruled out,
 * ends the step before the request.
 */
async function registeredUnlessDeparting<T>(
  step: Step,
  send: (signal: AbortSignal) => Promise<PushOutcome<T>>,
): Promise<PushOutcome<T>> {
  try {
    await noLiveDeparture(step.token.userId);
  } catch {
    throw new StepEnded('superseded');
  }
  return request(step, send);
}

/** Puts the consent back as `previous` if `written` is still the last write of it. */
function undoConsentWrite(userId: string, previous: Consent, written: Consent): () => Promise<void> {
  return async () => {
    await restoreConsent(userId, { expect: snapshotOf(written), previous });
  };
}

/**
 * Registers U's subscription for the channel with the plan's label and mode,
 * then applies the answer to the consent (rule 7): `ok` confirms the consent
 * with this label at this endpoint, only if it was not written since;
 * "revoked" turns it off; a definite refusal of an unconfirmed consent takes
 * it back to "no mark" (the label stays in S); "lost" and "session ended"
 * leave it as it is.
 */
async function register(
  ctx: DecisionContext,
  consent: Consent,
  endpoint: string,
  keys: ChannelKeys,
  fingerprint: string | null,
  plan: RegisterPlan,
  undo?: () => Promise<void>,
  created = false,
): Promise<void> {
  const { step, userId } = ctx;
  let sent = false;
  const outcome = await compensatingCreated(
    created,
    () => sent,
    plan.label,
    endpoint,
    userId,
    undoingOnUserChanged(
      registeredUnlessDeparting(step, (signal) => {
        sent = true;
        return pushSubscribe(
          {
            expectedUserId: userId,
            endpoint,
            keys,
            ua: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
            deviceLabel: plan.label,
            mode: plan.mode,
          },
          signal,
        );
      }),
      undo,
      () => sent,
    ),
  );
  try {
    switch (outcome.kind) {
      case 'ok':
        // A revocation of this device (a logout, a disable in another tab)
        // that came after the registration was sent refuses this write:
        // "enabled" does not come back (rule 8).
        await confirmConsent(userId, { expect: snapshotOf(consent), label: plan.label, endpoint, keysFingerprint: fingerprint }, guardOf(step));
        return;
      case 'revoked':
        await goOffAfterRevoked(ctx, endpoint);
        return;
      case 'notFound':
      case 'refused':
      case 'taken':
        if (consent.pending !== null) {
          await abandonConsentLabel(userId, { expect: snapshotOf(consent), label: consent.pending.label }, guardOf(step));
        }
        return;
      case 'sessionEnded':
      case 'lost':
        return;
    }
  } finally {
    // On every way out — an answer, a refused write, an ended step: a channel
    // this decision created is nobody's once a revocation of this device came
    // meanwhile, which did not know it (revokedSince). Without one it stays
    // for the repeat, and a later appearance confirms it (row 4).
    if (created) await dropIfRevoked(userId, plan.label, endpoint);
  }
}

/** Executes a decided action. */
async function execute(ctx: DecisionContext, action: DecisionAction): Promise<void> {
  const { step, userId } = ctx;
  const consent = ctx.consent;
  switch (action.type) {
    case 'nothing':
      return;

    case 'recordKeysFingerprint':
      live(step);
      await updateConsentChannel(
        userId,
        { expect: snapshotOf(consent), endpoint: action.endpoint, keysFingerprint: action.keysFingerprint },
        guardOf(step),
      );
      return;

    case 'abandonPending':
      live(step);
      await abandonConsentLabel(userId, { expect: snapshotOf(consent), label: action.label }, guardOf(step));
      return;

    case 'register': {
      if (ctx.channel === null) return;
      await register(ctx, consent, action.endpoint, ctx.channel.keys, ctx.channelKeysFingerprint, action.register);
      return;
    }

    case 'createChannelAndRegister': {
      if (ctx.publicKey === '') return;
      live(step);
      let channel: BrowserChannel;
      try {
        channel = await createChannelFor(step, ctx.publicKey);
      } catch (error) {
        if (error instanceof StepEnded) throw error;
        return;
      }
      let fingerprint: string;
      let recorded: Consent;
      try {
        // From here until the registration is sent, an ending step takes the
        // new channel away again.
        fingerprint = await keysFingerprint(channel.keys);
        live(step);
        recorded = await recordUnconfirmedChannel(
          userId,
          {
            expect: snapshotOf(consent),
            label: action.register.label,
            endpoint: channel.endpoint,
            keysFingerprint: fingerprint,
            kind: 'enable',
          },
          guardOf(step),
        );
      } catch (error) {
        // The consent moved on or could not be written: the new channel is
        // nobody's, so it does not stay.
        await dropCreatedChannel(channel.endpoint, userId);
        throw error;
      }
      await register(
        ctx,
        recorded,
        channel.endpoint,
        channel.keys,
        fingerprint,
        action.register,
        undoWithCreatedChannel(undoConsentWrite(userId, consent, recorded), channel.endpoint, userId),
        true,
      );
      return;
    }

    case 'removeForeignChannel': {
      const endpoint = action.endpoint;
      // Both steps are written first, so a closed tab finishes them later.
      const works = readPushState().works;
      const added: string[] = [];
      let sent = false;
      const undoWorks = async () => {
        for (const id of added) await removePushWork(id);
        republishWarnings(step);
      };
      // The removal by endpoint, without a condition: only its `ok` proves the
      // previous user's subscription at this endpoint is gone. "User changed",
      // or a step that ends before the request, takes the works of this
      // decision back.
      const outcome = await undoingOnUserChanged(
        (async () => {
          live(step);
          if (!works.some((w) => w.type === 'foreignRemoval' && w.endpoint === endpoint)) {
            added.push((await addPushWork({ type: 'foreignRemoval', endpoint }, guardOf(step))).id);
          }
          if (!works.some((w) => w.type === 'localUnsubscribe' && w.endpoint === endpoint)) {
            added.push((await addPushWork({ type: 'localUnsubscribe', endpoint }, guardOf(step))).id);
          }
          publish(step, {});
          return request(step, (signal) => {
            sent = true;
            return pushRemoveChannel({ expectedUserId: userId, endpoint }, signal);
          });
        })(),
        undoWorks,
        () => sent,
      );
      if (outcome.kind === 'ok') {
        await removeWorks(step, (w) => w.type === 'foreignRemoval' && w.endpoint === endpoint);
      }
      // The channel is removed whatever the server answered.
      live(step);
      const local = await removeChannelQuietly(endpoint, step);
      if (local === 'failed') return;
      live(step);
      await removeWorks(step, (w) => w.type === 'localUnsubscribe' && w.endpoint === endpoint);
      // Rows 2 and 4 of U wait for the removal of the previous user's channel.
      ctx.channel = null;
      ctx.channelKeysFingerprint = null;
      await execute(ctx, action.then);
      return;
    }

    case 'acceptExisting': {
      live(step);
      let accepted: Consent;
      try {
        accepted = await beginConsentLabel(
          userId,
          { expect: snapshotOf(consent), kind: 'accept', endpoint: action.endpoint, keysFingerprint: ctx.channelKeysFingerprint },
          guardOf(step),
        );
      } catch {
        return;
      }
      if (ctx.channel === null || accepted.label === null) return;
      await register(
        ctx,
        accepted,
        action.endpoint,
        ctx.channel.keys,
        ctx.channelKeysFingerprint,
        { mode: action.mode, label: accepted.label },
        undoConsentWrite(userId, consent, accepted),
      );
      return;
    }

    case 'adoptChannel': {
      if (ctx.channel === null) return;
      live(step);
      const adopted = await recordUnconfirmedChannel(
        userId,
        {
          expect: snapshotOf(consent),
          label: action.register.label,
          endpoint: action.endpoint,
          keysFingerprint: ctx.channelKeysFingerprint,
          kind: 'accept',
        },
        guardOf(step),
      );
      await register(
        ctx,
        adopted,
        action.endpoint,
        ctx.channel.keys,
        ctx.channelKeysFingerprint,
        action.register,
        undoConsentWrite(userId, consent, adopted),
      );
      return;
    }

    case 'revokeDevice': {
      const outcome = await request(step, (signal) =>
        pushRevokeDevices({ expectedUserId: userId, deviceLabels: action.labels, endpoint: action.endpoint }, signal),
      );
      // Revocation first, then the local step: the channel stays until the
      // server confirmed, so row 7 repeats.
      if (outcome.kind !== 'ok') return;
      if (action.removeSubscriptionId !== undefined) {
        const id = action.removeSubscriptionId;
        const removal = await request(step, (signal) => pushRemoveDevice({ expectedUserId: userId, id }, signal));
        if (removal.kind !== 'ok' && removal.kind !== 'notFound') return;
      }
      ctx.deviceRemoved = true;
      await removeChannelJournaled(step, action.endpoint);
      return;
    }

    case 'removeChannel':
      await removeChannelJournaled(step, action.endpoint);
      return;
  }
}

/** Push on the server as the page knows it. */
export type ServerPush = 'enabled' | 'disabled' | 'unknown';

/**
 * Reads the push configuration of the server for the step. A configuration
 * that could not be read (network, an error status, the step ended) is
 * `unknown`, not `disabled`: only an empty key says push is off there.
 */
async function readServerPush(step: Step): Promise<{ state: ServerPush; publicKey: string }> {
  try {
    const { publicKey } = await getPushConfig(step.signal);
    return { state: publicKey !== '' ? 'enabled' : 'disabled', publicKey };
  } catch {
    return { state: 'unknown', publicKey: '' };
  }
}

/**
 * The appearance of `step.token.userId`, under `skein.push.op`. Returns
 * what to publish again with a fresh read once the lock is released, `null`
 * when the decision did not act.
 */
async function decideOnAppearance(step: Step): Promise<DecisionResult> {
  const userId = step.token.userId;
  live(step);
  // The decision is run again, while this appearance is current, once a
  // logout whose works or barrier it met has ended.
  const token = step.token;
  const again = (lock: string | null) =>
    repeatWhenFree(lock, `appearance:${token.seq}`, async () => {
      if (isCurrentAppearance(token)) await runAppearance(token);
    });
  await repeatWork(step, again);

  const read = await readChannel(step.signal);
  live(step);
  let channel: DecisionChannel;
  let browserChannel: BrowserChannel | null = null;
  let channelKeysFingerprint: string | null = null;
  if (read.kind === 'channel') {
    browserChannel = read.channel;
    channelKeysFingerprint = await keysFingerprint(read.channel.keys);
    channel = {
      kind: 'channel',
      endpoint: read.channel.endpoint,
      endpointHash: await endpointFingerprint(read.channel.endpoint),
      keysFingerprint: channelKeysFingerprint,
    };
  } else {
    channel = read;
  }

  if (channel.kind === 'unreadable') {
    // Row 0: nothing is done. The list is still read for the settings, which
    // offer the disable also when the channel cannot be read (US-3).
    const listed = await request(step, (signal) => pushListDevices(userId, signal));
    const ownEndpoint = readConsent(userId).endpoint;
    publish(step, {
      decided: false,
      row: 0,
      devices: listed.kind === 'ok' ? listed.value : null,
      thisDeviceHash: ownEndpoint === null ? null : await endpointFingerprint(ownEndpoint),
    });
    return { shown: null };
  }

  const list = await request(step, (signal) => pushListDevices(userId, signal));
  if (list.kind !== 'ok') {
    publish(step, { decided: false, row: 1 });
    return { shown: null };
  }

  const server = await readServerPush(step);
  live(step);
  const permission = notificationPermission();
  const consent = readConsent(userId);
  const works = readPushState().works;
  // Read after the consent and the journal: a logout of U that wrote them
  // began before, and its lock is in this snapshot while it is live.
  const heldNow = await heldLocksOrNull();
  live(step);
  // Without a snapshot a live logout of U cannot be ruled out: rows 7 and 10 wait.
  const departing = heldNow === null ? null : liveDeparturesOf(heldNow, userId);
  if (departing === null) again(null);
  else for (const lock of departing) again(lock);
  const decision = decide({
    consent,
    channel,
    list,
    permission,
    // Registrations need push known to be on: a configuration that could
    // not be read allows only removals and revocations, as push off does
    // (rule 9) — it may well hide a server with push off.
    serverPushEnabled: server.state === 'enabled',
    blocks: {
      ownRevokePending: works.some((w) => w.type === 'deviceRevoke' && w.ownerUserId === userId),
      foreignRemovalPending: works.some((w) => w.type === 'localUnsubscribe'),
      ownRevokeHeld: departing === null || departing.length > 0,
    },
  });

  const ctx: DecisionContext = {
    step,
    userId,
    consent,
    channel: browserChannel,
    channelKeysFingerprint,
    devices: list.value,
    publicKey: server.publicKey,
    deviceRemoved: false,
  };
  await execute(ctx, decision.action);
  await settleOffUnconfirmed(ctx);
  const shown: Partial<PushLifecycleState> = {
    decided: true,
    row: decision.row,
    serverPush: server.state,
    permission,
  };
  // The list and this device as the decision read them, one pair. A row
  // that acted may have replaced the channel (5 → 2) or changed the list:
  // they are read again once the lock is released (publishFresh).
  shownReads += 1;
  const ownEndpoint = readConsent(userId).endpoint;
  const thisDeviceHash =
    channel.kind === 'channel'
      ? channel.endpointHash
      : ownEndpoint !== null
        ? await endpointFingerprint(ownEndpoint)
        : null;
  publish(step, { ...shown, devices: list.value, thisDeviceHash });
  return { shown: decision.action.type === 'nothing' ? null : shown };
}

/** What a decision leaves for after its lock: what to publish again with a fresh read (`null` when it did not act). */
interface DecisionResult {
  shown: Partial<PushLifecycleState> | null;
}

// ───────────────────────── Running ─────────────────────────

/** Controllers of the decisions started and not ended yet. */
const running = new Set<AbortController>();
let stopAppearance: (() => void) | null = null;

/** How an operation of an appearance ended early. */
type EndedEarly = 'superseded' | 'userChanged';

/**
 * Runs `body` as a step of `token` under `skein.push.op`. Returns its result,
 * or how it ended early: the appearance was replaced (the step is aborted
 * then), or the server said the user changed — then `/me` is read again.
 * Any other error is thrown.
 */
async function underOpLock<T>(token: Appearance, body: (step: Step) => Promise<T>): Promise<T | EndedEarly> {
  const controller = new AbortController();
  running.add(controller);
  const step: Step = { token, signal: controller.signal };
  let ended: EndedEarly;
  try {
    return await withPushOpLock(() => {
      live(step);
      return body(step);
    }, controller.signal);
  } catch (error) {
    if (error instanceof StepEnded) ended = error.reason;
    else if (controller.signal.aborted || !isCurrentAppearance(token)) ended = 'superseded';
    else throw error;
  } finally {
    running.delete(controller);
  }
  if (ended === 'userChanged' && isCurrentAppearance(token)) await reloadMeAfterUserChanged();
  return ended;
}

/** Runs the decision of `token`; returns when it ended, whatever the outcome. */
async function runAppearance(token: Appearance): Promise<void> {
  try {
    const result = await underOpLock(token, decideOnAppearance);
    if (endedEarly(result)) return;
    if (result.shown !== null) await publishFresh(token, result.shown);
  } catch {
    // A storage failure or a consent that moved on ends the decision as it
    // stands; the next appearance decides again.
  }
}

/**
 * Ends the push operations this tab runs for the current appearance: an
 * explicit logout does so in the click, so its wait for `skein.push.op` is
 * not a wait for this tab's own decision or action.
 */
export function abortPushOperations(): void {
  abortRunning('the user is logging out');
}

function abortRunning(reason: string): void {
  for (const controller of running) controller.abort(new DOMException(reason, 'AbortError'));
  running.clear();
}

function onAppearanceChange(): void {
  const next = currentAppearance();
  const shown = state?.appearance ?? null;
  if (next === shown || (next !== null && shown !== null && next.seq === shown.seq)) return;
  abortRunning('the appearance was replaced');
  // The UI of the previous appearance is dropped at once.
  setState(initialState(next));
  if (next !== null) void runAppearance(next);
}

/** Repeats the unfinished local channel removals of this browser (page load, no user needed). */
async function repeatLocalUnsubscribesOnLoad(): Promise<void> {
  // Ended like the operations of an appearance (an explicit logout aborts
  // them): a browser that does not answer does not keep the lock.
  const controller = new AbortController();
  running.add(controller);
  try {
    await withPushOpLock(async () => {
      const works = readPushState().works;
      const held = await heldLocksOrNull();
      for (const work of works) {
        if (controller.signal.aborted) return;
        if (work.type !== 'localUnsubscribe') continue;
        if (held === null ? work.heldBy !== undefined : isHeld(work, held)) {
          // Repeated once the logout that holds it ended — arranged now,
          // whatever happens to the rest of this pass.
          repeatWhenFree(held === null ? null : heldByOf(work), 'load', repeatLocalUnsubscribesOnLoad);
          continue;
        }
        await repeatLocalUnsubscribe(work, null, controller.signal, (lock) =>
          repeatWhenFree(lock, 'load', repeatLocalUnsubscribesOnLoad),
        );
      }
    }, controller.signal);
  } catch {
    // Storage or locks failed, or the repeat was ended: the work stays for the next load.
  } finally {
    running.delete(controller);
  }
}

/**
 * Starts the controller of this tab: the page-load repeats, then a decision
 * on every appearance. Idempotent; returns the stop. Without push support it
 * does nothing.
 */
export function startPushLifecycle(): () => void {
  if (stopAppearance === null) {
    setState(initialState(currentAppearance()));
    if (browserPushSupported()) {
      const unsubscribe = subscribeAppearance(onAppearanceChange);
      stopAppearance = () => {
        unsubscribe();
        abortRunning('the controller stopped');
      };
      const appearance = currentAppearance();
      void repeatLocalUnsubscribesOnLoad().then(() => {
        if (appearance !== null && isCurrentAppearance(appearance)) return runAppearance(appearance);
        return undefined;
      });
    } else {
      stopAppearance = () => undefined;
    }
  }
  return stopPushLifecycle;
}

/** Stops the controller; the next start begins as on a page load. */
export function stopPushLifecycle(): void {
  stopAppearance?.();
  stopAppearance = null;
}

/**
 * Runs the decision of the current appearance again (the retry of warning B
 * and of an unconfirmed disable). Resolves when it ended.
 */
export async function repeatPushDecision(): Promise<void> {
  const appearance = currentAppearance();
  if (appearance === null || stopAppearance === null || !browserPushSupported()) return;
  await runAppearance(appearance);
}

// ───────────────────────── Explicit actions ─────────────────────────

/** Result of an explicit push action. */
export type PushActionResult =
  | { kind: 'done' }
  /** The notification permission is denied (or the prompt was dismissed). */
  | { kind: 'denied' }
  /** Push is not available: no support, no signed-in user, or push disabled on the server. */
  | { kind: 'unavailable' }
  /**
   * The action did not complete:
   *   - `unconfirmed` — the server's answer is missing (lost, session ended)
   *     or the user could not be confirmed; an enable stays unconfirmed, a
   *     disable stays "not confirmed";
   *   - `refused` — the server refused the registration; the consent is "no mark";
   *   - `revoked` — the device label is revoked; the consent is "explicitly off";
   *   - `labelLimit` — S is full, no new label until this device is revoked;
   *   - `storage` — the push state could not be written;
   *   - `channel` — the browser could not read, create or replace the channel.
   */
  | { kind: 'failed'; reason: 'unconfirmed' | 'refused' | 'revoked' | 'labelLimit' | 'storage' | 'channel' }
  /**
   * The action ended without effect: the appearance was replaced, the server
   * said the user changed, or a revocation of this device came first.
   */
  | { kind: 'superseded' };

const NOTHING: DecisionAction = { type: 'nothing' };

function endedEarly<T>(result: T | EndedEarly): result is EndedEarly {
  return result === 'superseded' || result === 'userChanged';
}

/** Maps an error that ended an action to its result. */
function failure(error: unknown): PushActionResult {
  // A step that ended (its appearance replaced) is not a failure of storage.
  if (error instanceof StepEnded || error instanceof PushStateConflictError || error instanceof DepartureInProgressError) {
    return { kind: 'superseded' };
  }
  if (error instanceof PushLabelLimitError) return { kind: 'failed', reason: 'labelLimit' };
  return { kind: 'failed', reason: 'storage' };
}

/** Grows with every read of what the settings show; an older read does not publish over a newer one. */
let shownReads = 0;

/**
 * Publishes the list and this device as they are after a decision that
 * acted or an explicit action — one read of the channel and of the list, in
 * a step of `token` that does not hold `skein.push.op`, so a read that hangs
 * holds up no push operation. A list that does not come is shown as not
 * read (`null`), beside the device read with it; nothing else is done.
 */
async function publishFresh(token: Appearance, patch: Partial<PushLifecycleState>): Promise<'shown' | 'userChanged' | 'ended'> {
  const ticket = (shownReads += 1);
  const controller = new AbortController();
  running.add(controller);
  const step: Step = { token, signal: controller.signal };
  try {
    live(step);
    const userId = token.userId;
    const read = await readChannel(step.signal);
    const listed = await request(step, (signal) => pushListDevices(userId, signal));
    const ownEndpoint = readConsent(userId).endpoint;
    const endpoint = read.kind === 'channel' ? read.channel.endpoint : ownEndpoint;
    const thisDeviceHash = endpoint === null ? null : await endpointFingerprint(endpoint);
    if (ticket !== shownReads) return 'ended';
    publish(step, { ...patch, devices: listed.kind === 'ok' ? listed.value : null, thisDeviceHash });
    return 'shown';
  } catch (error) {
    // "User changed" for the appearance still current: `/me` is read again
    // (rule 5, US-2). The answer of an appearance replaced since is dropped.
    if (error instanceof StepEnded && error.reason === 'userChanged' && isCurrentAppearance(token)) {
      void reloadMeAfterUserChanged();
      return 'userChanged';
    }
    return 'ended';
  } finally {
    running.delete(controller);
  }
}

/** Reads the confirmed list of the step's user; `null` when it did not come. */
async function confirmUser(step: Step): Promise<PushDevice[] | null> {
  const list = await request(step, (signal) => pushListDevices(step.token.userId, signal));
  return list.kind === 'ok' ? list.value : null;
}

/** The step's user takes back a label sent in a registration whose consent could not be written. */
async function undoRegistration(step: Step, label: string, endpoint: string): Promise<void> {
  const userId = step.token.userId;
  await request(step, (signal) => pushRevokeDevices({ expectedUserId: userId, deviceLabels: [label], endpoint }, signal));
  live(step);
  await removeChannelQuietly(endpoint, step);
}

/**
 * The enable of `step`'s user under `skein.push.op` (US-1). `gen` is the
 * consent generation read in the click handler: a revocation of this device
 * since then ends the enable before any label is written (rule 8).
 */
async function enableUnderLock(step: Step, gen: number, refresh: () => void): Promise<PushActionResult> {
  const userId = step.token.userId;
  const devices = await confirmUser(step);
  if (devices === null) return { kind: 'failed', reason: 'unconfirmed' };
  const server = await readServerPush(step);
  live(step);
  if (server.state === 'disabled') return { kind: 'unavailable' };
  if (server.state === 'unknown') return { kind: 'failed', reason: 'unconfirmed' };

  let consent = readConsent(userId);
  if (consent.gen !== gen) return { kind: 'superseded' };

  const read = await readChannel(step.signal);
  live(step);
  if (read.kind === 'unreadable') return { kind: 'failed', reason: 'channel' };
  let current: BrowserChannel | null = read.kind === 'channel' ? read.channel : null;

  // An unconfirmed accept is given up: the explicit enable writes its own label.
  if (consent.state === 'enabled' && consent.pending?.kind === 'accept') {
    live(step);
    consent = await abandonConsentLabel(userId, { expect: snapshotOf(consent), label: consent.pending.label }, guardOf(step));
  }
  // "Enabled" keeps its label (row 4); "no mark" and "explicitly off" get a new one.
  const keptLabel = consent.state === 'enabled' ? consent.label : null;
  // With a full S no new label is created (the store refuses it too); the
  // channel is not touched for an enable that cannot happen.
  if (keptLabel === null && consent.labels.length >= MAX_CONSENT_LABELS) {
    return { kind: 'failed', reason: 'labelLimit' };
  }

  // The current channel is kept unless it is another user's or revoked.
  if (current !== null) {
    const hash = await endpointFingerprint(current.endpoint);
    const listed = devices.some((d) => d.endpointHash === hash);
    const own = consent.endpoint === current.endpoint;
    if (consent.state === 'off' && (own || listed)) {
      live(step);
      if ((await removeChannelQuietly(current.endpoint, step)) === 'failed') return { kind: 'failed', reason: 'channel' };
      current = null;
    } else if (!own && !listed) {
      const ctx: DecisionContext = {
        step,
        userId,
        consent,
        channel: current,
        channelKeysFingerprint: null,
        devices,
        publicKey: server.publicKey,
        deviceRemoved: false,
      };
      await execute(ctx, { type: 'removeForeignChannel', endpoint: current.endpoint, then: NOTHING });
      if (readPushState().works.some((w) => w.type === 'localUnsubscribe' && w.endpoint === current?.endpoint)) {
        return { kind: 'failed', reason: 'channel' };
      }
      current = null;
    }
  }

  let created = false;
  if (current === null) {
    live(step);
    try {
      current = await createChannelFor(step, server.publicKey);
    } catch (error) {
      if (error instanceof StepEnded) throw error;
      live(step);
      return { kind: 'failed', reason: 'channel' };
    }
    created = true;
  }
  const channel = current;

  // The label is in the consent, unconfirmed, before the registration is sent.
  // Until the registration is sent, an ending step takes a channel this
  // enable created away again.
  let fingerprint: string;
  let pending: Consent;
  try {
    fingerprint = await keysFingerprint(channel.keys);
    live(step);
    pending =
      keptLabel === null
        ? await beginConsentLabel(
            userId,
            { expect: { gen }, kind: 'enable', endpoint: channel.endpoint, keysFingerprint: fingerprint },
            guardOf(step),
          )
        : await recordUnconfirmedChannel(
            userId,
            { expect: { gen, rev: consent.rev }, label: keptLabel, endpoint: channel.endpoint, keysFingerprint: fingerprint, kind: 'enable' },
            guardOf(step),
          );
  } catch (error) {
    if (created) await dropCreatedChannel(channel.endpoint, userId);
    if (error instanceof StepEnded) throw error;
    return failure(error);
  }
  const label = pending.label;
  if (label === null) return { kind: 'failed', reason: 'storage' };
  const written = pending;

  let sent = false;
  const undoEnable = undoConsentWrite(userId, consent, written);
  const outcome = await compensatingCreated(
    created,
    () => sent,
    label,
    channel.endpoint,
    userId,
    undoingOnUserChanged(
      registeredUnlessDeparting(step, (signal) => {
        sent = true;
        return pushSubscribe(
          {
            expectedUserId: userId,
            endpoint: channel.endpoint,
            keys: channel.keys,
            ua: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
            deviceLabel: label,
            mode: 'upsert',
          },
          signal,
        );
      }),
      created ? undoWithCreatedChannel(undoEnable, channel.endpoint, userId) : undoEnable,
      () => sent,
    ),
  );
  const ctx: DecisionContext = {
    step,
    userId,
    consent: pending,
    channel,
    channelKeysFingerprint: fingerprint,
    devices,
    publicKey: server.publicKey,
    deviceRemoved: false,
  };
  try {
    switch (outcome.kind) {
      case 'ok':
        try {
          // Confirmed only with the same generation and the same pending label:
          // a revocation since then keeps the consent off.
          await confirmConsent(
            userId,
            { expect: snapshotOf(pending), label, endpoint: channel.endpoint, keysFingerprint: fingerprint },
            guardOf(step),
          );
        } catch (error) {
          // The appearance was replaced after the registration was accepted:
          // the consent stays unconfirmed and the next appearance confirms it
          // (row 4) — the registration is not taken back.
          if (error instanceof StepEnded) throw error;
          // A revocation came first (rule 8): see below for the channel.
          if (error instanceof PushStateConflictError) return { kind: 'superseded' };
          await undoRegistration(step, label, channel.endpoint);
          return { kind: 'failed', reason: 'storage' };
        }
        refresh();
        return { kind: 'done' };
      case 'revoked':
        await goOffAfterRevoked(ctx, channel.endpoint);
        refresh();
        return { kind: 'failed', reason: 'revoked' };
      case 'notFound':
      case 'refused':
      case 'taken':
        try {
          await abandonConsentLabel(userId, { expect: snapshotOf(pending), label }, guardOf(step));
        } catch (error) {
          return failure(error);
        }
        publish(step, {});
        return { kind: 'failed', reason: 'refused' };
      case 'sessionEnded':
      case 'lost':
        publish(step, {});
        return { kind: 'failed', reason: 'unconfirmed' };
      case 'userChanged':
        // `request` ends the step on this outcome before it gets here.
        return { kind: 'superseded' };
      default: {
        const unknown: never = outcome;
        throw new Error(`an unknown registration outcome: ${JSON.stringify(unknown)}`);
      }
    }
  } finally {
    // On every way out — an answer, a refused write, an ended step: a channel
    // this enable created is nobody's once a revocation of this device came
    // meanwhile. Without one it stays for the repeat of an unknown answer.
    if (created) await dropIfRevoked(userId, label, channel.endpoint);
  }
}

/**
 * Runs an explicit action under `skein.push.op`. When the body asks for it
 * (`refresh`), the list and this device are read again after the lock is
 * released, before the result is returned.
 */
async function finishAction(
  token: Appearance,
  body: (step: Step, refresh: () => void) => Promise<PushActionResult>,
): Promise<PushActionResult> {
  let wanted = false;
  let result: PushActionResult;
  try {
    const outcome = await underOpLock(token, (step) =>
      body(step, () => {
        wanted = true;
        // What the action wrote is shown at once; the list follows.
        if (isLive(step)) publish(step, {});
      }),
    );
    result = endedEarly(outcome) ? { kind: 'superseded' } : outcome;
  } catch (error) {
    result = failure(error);
  }
  if (!wanted || result.kind === 'superseded') return result;
  // The answer waits for the fresh read only so long; a later read still
  // publishes, and a later "user changed" still reads `/me` again.
  const shown = await withinTime(publishFresh(token, {}), SHOWN_READ_WAIT_MS);
  return shown === 'userChanged' ? { kind: 'superseded' } : result;
}

/** How long the answer of an explicit action waits for the fresh read of what the settings show. */
export const SHOWN_READ_WAIT_MS = 1500;

/** Resolves with `work`, or with `undefined` after `ms`. */
function withinTime<T>(work: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), ms);
    void work.then((value) => {
      clearTimeout(timer);
      resolve(value);
    });
  });
}

/**
 * Enables push on this device for the signed-in user (US-1). Call it from
 * the click handler: the consent generation and the appearance are taken
 * synchronously, and the permission prompt is the first `await`, before the
 * lock and the network — browsers honour it only inside the user's gesture.
 */
export function enablePush(): Promise<PushActionResult> {
  const token = currentAppearance();
  if (token === null || !browserPushSupported()) return Promise.resolve({ kind: 'unavailable' });
  const gen = readConsentGen(token.userId);
  const permission = notificationPermission();
  if (permission === 'denied') return Promise.resolve({ kind: 'denied' });
  const asked = permission === 'default' ? requestNotificationPermission() : Promise.resolve(permission);
  return asked.then(
    (answer) => (answer === 'granted' ? finishAction(token, (step, refresh) => enableUnderLock(step, gen, refresh)) : { kind: 'denied' }),
    () => ({ kind: 'denied' }),
  );
}

/** Result of the server part of a revocation of this device. */
export interface ServerRevocation {
  /** The list confirmed the user; without it nothing was written or sent. */
  confirmed: boolean;
  /** The server confirmed the revocation (or there was nothing to send it for). */
  revoked: boolean;
  /** Endpoint of this device's channel known at the confirmation; `null` when unread. */
  endpoint: string | null;
}

/**
 * The server part of the revocation of this device (disable here, removal of
 * the current device, explicit logout): the list confirms the user; the
 * revocation transition — consent off, `gen + 1`, S into a `deviceRevoke`
 * work guarded by that list, a `localUnsubscribe` work for the channel —
 * is written; then one request revokes S and the channel's endpoint. `ok`
 * finishes the revocation work and clears "disable not confirmed". With an
 * empty S and an unread channel nothing is sent: row 7 removes the
 * subscription by its endpoint once the channel is read.
 */
async function revokeDeviceOnServer(step: Step): Promise<ServerRevocation> {
  const devices = await confirmUser(step);
  if (devices === null) return { confirmed: false, revoked: false, endpoint: null };
  return revokeConfirmedDevice(step, devices);
}

/**
 * The server part of the revocation of this device once `devices`, the
 * user's list read in this step, confirmed the user (see
 * {@link revokeDeviceOnServer}). `channelRead` is the channel as the caller
 * already read it; `onTransition` hears the endpoint once the revocation
 * transition is written, before the request. Every wait for the store lock
 * and every request is bounded by the step's signal.
 */
export async function revokeConfirmedDevice(
  step: PushStep,
  devices: PushDevice[],
  channelRead?: ChannelRead,
  onTransition?: (endpoint: string | null) => void,
): Promise<ServerRevocation> {
  const userId = step.token.userId;
  const read = channelRead ?? (await readChannel(step.signal));
  live(step);
  const endpoint = read.kind === 'channel' ? read.channel.endpoint : null;
  const hash = endpoint === null ? null : await endpointFingerprint(endpoint);
  const listed = hash === null ? undefined : devices.find((d) => d.endpointHash === hash);
  const guard: RevokeGuard = listed === undefined ? 'absent' : { id: listed.id, version: listed.version };
  live(step);
  // The label of the current channel's subscription joins the revocation,
  // or that subscription is removed by id when S is full — decided on the
  // record under the store lock (`pushState.ts#withListedLabel`).
  const { consent: revokedConsent, previous, work, localWork } = await revokeConsent(
    userId,
    {
      endpoint,
      guard,
      localUnsubscribe: true,
      listed: listed === undefined ? undefined : { id: listed.id, label: listed.deviceLabel },
    },
    guardOf(step),
  );
  // Nothing of this revocation reached the server (see
  // RevocationProgress): the transition is taken back in one write
  // (rule 5) — unless something wrote the consent since.
  const undo = async () => {
    await undoRevocation(userId, {
      expect: snapshotOf(revokedConsent),
      previous,
      workIds: [work, localWork].flatMap((w) => (w === null ? [] : [w.id])),
    });
  };
  // The transition is written (with the local removal journaled): the
  // channel may go now, whatever the revocation request answers.
  onTransition?.(endpoint);
  const progress = revocationProgress();
  let done: boolean;
  try {
    if (work !== null && work.type === 'deviceRevoke') {
      // The work records the removal by id too, so a repeat performs all of it.
      done = await repeatOwnRevocation(step, work, progress);
    } else {
      // No label and no channel: nothing new of this device is on the server,
      // unless the channel could not be read (row 7 removes it once it is).
      done = read.kind === 'none';
    }
    // Earlier unfinished revocations of this device by the same owner are
    // sent now as well: a disable asked again is the manual retry of US-3.
    const works = readPushState().works;
    const held = await heldLocksOrNull();
    for (const earlier of works) {
      if (earlier.type !== 'deviceRevoke' || earlier.ownerUserId !== userId || earlier.id === work?.id) continue;
      if (held === null ? earlier.heldBy !== undefined : isHeld(earlier, held)) continue;
      done = (await repeatOwnRevocation(step, earlier)) && done;
    }
  } catch (error) {
    if (revocationTakenBack(progress)) {
      try {
        await undo();
      } catch {
        // The record moved on meanwhile; its newer state stays.
      }
    }
    throw error;
  }
  if (!done) return { confirmed: true, revoked: false, endpoint };
  const off = readConsent(userId);
  live(step);
  if (off.state === 'off') await setConsentOffUnconfirmed(userId, snapshotOf(off), false, guardOf(step));
  return { confirmed: true, revoked: true, endpoint };
}

/**
 * The local part of the revocation of this device: the channel with the
 * endpoint known at the confirmation is removed, if it is still current;
 * success finishes its `localUnsubscribe` work.
 */
export async function removeLocalChannel(step: PushStep, endpoint: string): Promise<boolean> {
  live(step);
  const result = await removeChannelQuietly(endpoint, step);
  if (result === 'failed') return false;
  live(step);
  for (const work of readPushState().works) {
    if (work.type === 'localUnsubscribe' && work.endpoint === endpoint) await removePushWork(work.id, guardOf(step));
  }
  return true;
}

/**
 * Disables push on this device, or removes the current device from the list
 * (US-3): the server part of the revocation, then the local part.
 */
export function disablePush(): Promise<PushActionResult> {
  const token = currentAppearance();
  if (token === null || !browserPushSupported()) return Promise.resolve({ kind: 'unavailable' });
  return finishAction(token, async (step, refresh) => {
    const server = await revokeDeviceOnServer(step);
    if (!server.confirmed) return { kind: 'failed', reason: 'unconfirmed' };
    if (server.endpoint !== null) await removeLocalChannel(step, server.endpoint);
    refresh();
    return server.revoked ? { kind: 'done' } : { kind: 'failed', reason: 'unconfirmed' };
  });
}

/**
 * Removes another device of the signed-in user by its subscription id
 * (US-3): its subscription is deleted and its label revoked. The consent and
 * the channel of this browser do not change.
 */
export function removeOtherDevice(id: string): Promise<PushActionResult> {
  const token = currentAppearance();
  if (token === null || !browserPushSupported()) return Promise.resolve({ kind: 'unavailable' });
  return finishAction(token, async (step, refresh) => {
    const outcome = await request(step, (signal) =>
      pushRemoveDevice({ expectedUserId: step.token.userId, id }, signal),
    );
    if (outcome.kind !== 'ok' && outcome.kind !== 'notFound') return { kind: 'failed', reason: 'unconfirmed' };
    refresh();
    return { kind: 'done' };
  });
}
