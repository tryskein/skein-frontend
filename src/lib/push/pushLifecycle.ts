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
  createChannel,
  notificationPermission,
  type NotificationPermissionState,
  readChannel,
  removeChannel,
} from './browserPush';
import { decide, type DecisionAction, type DecisionChannel, type DecisionRow, type RegisterPlan } from './decide';
import { endpointFingerprint, keysFingerprint } from './fingerprint';
import { withPushOpLock } from './locks';
import {
  abandonConsentLabel,
  addPushWork,
  beginConsentLabel,
  type Consent,
  type ConsentSnapshot,
  confirmConsent,
  type PushWork,
  readConsent,
  readPushState,
  recordUnconfirmedChannel,
  removePushWork,
  revokeConsent,
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
  /** Push is enabled on the server (it publishes a VAPID key); `false` until known. */
  serverPushEnabled: boolean;
  permission: NotificationPermissionState;
  /** The consent of the appearing user; `null` without a user. */
  consent: Consent | null;
  /** The user's subscriptions as the decision read them; `null` until read. */
  devices: PushDevice[] | null;
  /**
   * Endpoints of previous users' channels in this browser whose removal on
   * the server is not confirmed yet (warning B).
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
    serverPushEnabled: false,
    permission: notificationPermission(),
    consent: appearance === null ? null : readConsent(appearance.userId),
    devices: null,
    foreignChannelWarnings: foreignWarnings(),
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

// ───────────────────────── Steps and tokens ─────────────────────────

/** Ends a step: its appearance was replaced, or the server said the user changed. */
class StepEnded extends Error {
  constructor(readonly reason: 'superseded' | 'userChanged') {
    super(reason);
    this.name = 'StepEnded';
  }
}

/** One asynchronous push step of an appearance. */
interface Step {
  token: Appearance;
  /** Aborted when the appearance is replaced. */
  signal: AbortSignal;
}

/** Throws unless the step's appearance is still current. */
function live(step: Step): void {
  if (!isCurrentAppearance(step.token)) throw new StepEnded('superseded');
}

/**
 * Sends one push operation of the step. The answer of a step whose
 * appearance was replaced is not a basis for anything; "user changed" ends
 * the decision.
 */
async function request<T>(step: Step, send: (signal: AbortSignal) => Promise<PushOutcome<T>>): Promise<PushOutcome<T>> {
  live(step);
  const outcome = await send(step.signal);
  live(step);
  if (outcome.kind === 'userChanged') throw new StepEnded('userChanged');
  return outcome;
}

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

function snapshotOf(consent: Consent): ConsentSnapshot {
  return { gen: consent.gen, rev: consent.rev };
}

/** Removes the channel `endpoint` if it is still current; `failed` when the browser failed. */
async function removeChannelQuietly(endpoint: string): Promise<'removed' | 'notCurrent' | 'failed'> {
  try {
    return await removeChannel(endpoint);
  } catch {
    return 'failed';
  }
}

async function removeWorks(match: (work: PushWork) => boolean): Promise<void> {
  for (const work of readPushState().works) {
    if (match(work)) await removePushWork(work.id);
  }
}

// ───────────────────────── Repeats of unfinished work ─────────────────────────

/**
 * Repeats a local channel removal: the channel is unsubscribed only if its
 * endpoint is still the work's; a channel that is no longer current finishes
 * the work as well. A browser failure keeps it.
 */
async function repeatLocalUnsubscribe(work: Extract<PushWork, { type: 'localUnsubscribe' }>, step: Step | null): Promise<void> {
  if (step !== null) live(step);
  const result = await removeChannelQuietly(work.endpoint);
  if (result === 'failed') return;
  if (step !== null) live(step);
  await removePushWork(work.id);
}

/** Rule 6: the unfinished work of the browser, as user `step.token.userId`. */
async function repeatWork(step: Step): Promise<void> {
  const userId = step.token.userId;
  for (const work of readPushState().works) {
    switch (work.type) {
      case 'localUnsubscribe':
        await repeatLocalUnsubscribe(work, step);
        break;
      case 'foreignRemoval': {
        const outcome = await request(step, (signal) =>
          pushRemoveChannel({ expectedUserId: userId, endpoint: work.endpoint }, signal),
        );
        if (outcome.kind === 'ok') await removeWorks((w) => w.type === 'foreignRemoval' && w.endpoint === work.endpoint);
        break;
      }
      case 'deviceRevoke':
        if (work.ownerUserId === userId) {
          const outcome = await request(step, (signal) =>
            pushRevokeDevices({ expectedUserId: userId, deviceLabels: work.labels, endpoint: work.endpoint }, signal),
          );
          if (outcome.kind === 'ok') await removePushWork(work.id);
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
  await setConsentOffUnconfirmed(ctx.userId, snapshotOf(consent), false);
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
  const { work } = await revokeConsent(userId, { endpoint, guard });
  if (work !== null && work.type === 'deviceRevoke') {
    const outcome = await request(step, (signal) =>
      pushRevokeDevices({ expectedUserId: userId, deviceLabels: work.labels, endpoint: work.endpoint }, signal),
    );
    if (outcome.kind === 'ok') {
      await removePushWork(work.id);
      const off = readConsent(userId);
      if (off.state === 'off') await setConsentOffUnconfirmed(userId, snapshotOf(off), false);
    }
  }
  live(step);
  await removeChannelQuietly(endpoint);
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
): Promise<void> {
  const { step, userId } = ctx;
  const outcome = await request(step, (signal) =>
    pushSubscribe(
      {
        expectedUserId: userId,
        endpoint,
        keys,
        ua: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
        deviceLabel: plan.label,
        mode: plan.mode,
      },
      signal,
    ),
  );
  switch (outcome.kind) {
    case 'ok':
      await confirmConsent(userId, { expect: snapshotOf(consent), label: plan.label, endpoint, keysFingerprint: fingerprint });
      return;
    case 'revoked':
      await goOffAfterRevoked(ctx, endpoint);
      return;
    case 'notFound':
    case 'refused':
    case 'taken':
      if (consent.pending !== null) {
        await abandonConsentLabel(userId, { expect: snapshotOf(consent), label: consent.pending.label });
      }
      return;
    case 'sessionEnded':
    case 'lost':
      return;
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
      await updateConsentChannel(userId, {
        expect: snapshotOf(consent),
        endpoint: action.endpoint,
        keysFingerprint: action.keysFingerprint,
      });
      return;

    case 'abandonPending':
      live(step);
      await abandonConsentLabel(userId, { expect: snapshotOf(consent), label: action.label });
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
        channel = await createChannel(ctx.publicKey, step.signal);
      } catch {
        return;
      }
      const fingerprint = await keysFingerprint(channel.keys);
      live(step);
      let recorded: Consent;
      try {
        recorded = await recordUnconfirmedChannel(userId, {
          expect: snapshotOf(consent),
          label: action.register.label,
          endpoint: channel.endpoint,
          keysFingerprint: fingerprint,
          kind: 'enable',
        });
      } catch (error) {
        // The consent moved on or could not be written: the new channel is
        // nobody's, so it does not stay.
        await removeChannelQuietly(channel.endpoint);
        throw error;
      }
      await register(ctx, recorded, channel.endpoint, channel.keys, fingerprint, action.register);
      return;
    }

    case 'removeForeignChannel': {
      const endpoint = action.endpoint;
      // Both steps are written first, so a closed tab finishes them later.
      const works = readPushState().works;
      live(step);
      if (!works.some((w) => w.type === 'foreignRemoval' && w.endpoint === endpoint)) {
        await addPushWork({ type: 'foreignRemoval', endpoint });
      }
      if (!works.some((w) => w.type === 'localUnsubscribe' && w.endpoint === endpoint)) {
        await addPushWork({ type: 'localUnsubscribe', endpoint });
      }
      publish(step, {});
      // The removal by endpoint, without a condition: only its `ok` proves the
      // previous user's subscription at this endpoint is gone.
      const outcome = await request(step, (signal) => pushRemoveChannel({ expectedUserId: userId, endpoint }, signal));
      if (outcome.kind === 'ok') {
        await removeWorks((w) => w.type === 'foreignRemoval' && w.endpoint === endpoint);
      }
      // The channel is removed whatever the server answered.
      live(step);
      const local = await removeChannelQuietly(endpoint);
      if (local === 'failed') return;
      live(step);
      await removeWorks((w) => w.type === 'localUnsubscribe' && w.endpoint === endpoint);
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
        accepted = await beginConsentLabel(userId, {
          expect: snapshotOf(consent),
          kind: 'accept',
          endpoint: action.endpoint,
          keysFingerprint: ctx.channelKeysFingerprint,
        });
      } catch {
        return;
      }
      if (ctx.channel === null || accepted.label === null) return;
      await register(ctx, accepted, action.endpoint, ctx.channel.keys, ctx.channelKeysFingerprint, {
        mode: action.mode,
        label: accepted.label,
      });
      return;
    }

    case 'adoptChannel': {
      if (ctx.channel === null) return;
      live(step);
      const adopted = await recordUnconfirmedChannel(userId, {
        expect: snapshotOf(consent),
        label: action.register.label,
        endpoint: action.endpoint,
        keysFingerprint: ctx.channelKeysFingerprint,
        kind: 'accept',
      });
      await register(ctx, adopted, action.endpoint, ctx.channel.keys, ctx.channelKeysFingerprint, action.register);
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
      live(step);
      await removeChannelQuietly(action.endpoint);
      return;
    }

    case 'removeChannel':
      live(step);
      await removeChannelQuietly(action.endpoint);
      return;
  }
}

async function readServerPush(): Promise<{ enabled: boolean; publicKey: string }> {
  try {
    const { publicKey } = await getPushConfig();
    return { enabled: publicKey !== '', publicKey };
  } catch {
    return { enabled: false, publicKey: '' };
  }
}

/** The appearance of `step.token.userId`, under `skein.push.op`. */
async function decideOnAppearance(step: Step): Promise<void> {
  const userId = step.token.userId;
  live(step);
  await repeatWork(step);

  const read = await readChannel();
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
    publish(step, { decided: false, row: 0 });
    return;
  }

  const list = await request(step, (signal) => pushListDevices(userId, signal));
  if (list.kind !== 'ok') {
    publish(step, { decided: false, row: 1 });
    return;
  }

  const server = await readServerPush();
  live(step);
  const permission = notificationPermission();
  const consent = readConsent(userId);
  const works = readPushState().works;
  const decision = decide({
    consent,
    channel,
    list,
    permission,
    serverPushEnabled: server.enabled,
    blocks: {
      ownRevokePending: works.some((w) => w.type === 'deviceRevoke' && w.ownerUserId === userId),
      foreignRemovalPending: works.some((w) => w.type === 'localUnsubscribe'),
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
  publish(step, {
    decided: true,
    row: decision.row,
    serverPushEnabled: server.enabled,
    permission,
    devices: list.value,
  });
}

// ───────────────────────── Running ─────────────────────────

/** Controllers of the decisions started and not ended yet. */
const running = new Set<AbortController>();
let stopAppearance: (() => void) | null = null;

/** Runs the decision of `token`; returns when it ended, whatever the outcome. */
async function runAppearance(token: Appearance): Promise<void> {
  const controller = new AbortController();
  running.add(controller);
  const step: Step = { token, signal: controller.signal };
  let userChanged = false;
  try {
    await withPushOpLock(() => decideOnAppearance(step), controller.signal);
  } catch (error) {
    // A replaced appearance, an abort, a storage failure or a consent that
    // moved on end the decision as it stands; the next appearance decides
    // again.
    if (error instanceof StepEnded && error.reason === 'userChanged') userChanged = true;
  } finally {
    running.delete(controller);
  }
  if (userChanged && isCurrentAppearance(token)) await reloadMeAfterUserChanged();
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
  try {
    await withPushOpLock(async () => {
      for (const work of readPushState().works) {
        if (work.type === 'localUnsubscribe') await repeatLocalUnsubscribe(work, null);
      }
    });
  } catch {
    // Storage or locks failed: the work stays for the next load.
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
