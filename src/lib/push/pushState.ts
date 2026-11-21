/**
 * Browser push state: the consent of every user of this browser and the
 * journal of unfinished push work, kept in ONE localStorage record
 * (`skein.push.v1.state`).
 *
 * One record, because a revocation is one transition — the consent becomes
 * "explicitly off", its generation grows and every label it holds moves into
 * a `deviceRevoke` work — and two keys could be left half-written by a failed
 * second write or a closed tab. Every transition is a single `setItem` of the
 * whole record under the `skein.push.store` lock, followed by a read back; a
 * `setItem` that throws leaves the previous record whole.
 *
 * Consent of a user (spec "Terms"):
 *   - `none` with no labels is "no mark"; `none` with labels is still "no
 *     mark" for the decision table, the labels only wait for a revocation;
 *   - `enabled` carries the device label, the channel endpoint and key
 *     fingerprint; `pending` is set until the server confirmed the
 *     subscription with this label, and says whether it came from an
 *     explicit enable or from accepting an existing subscription;
 *   - `off` is "explicitly off".
 *
 * `labels` is the set S: every label written into the consent or sent in a
 * registration, from its creation until the revocation transition moves S
 * whole into a `deviceRevoke` work. Nothing else takes a label out of S: an
 * abandoned accept or a definite refusal leaves it there. While S holds
 * {@link MAX_CONSENT_LABELS} labels no new label is created, so S always fits
 * one revocation request.
 *
 * `gen` grows with every revocation of this device, even without labels. An
 * explicit action reads it synchronously in its click handler
 * ({@link readConsentGen}) and every consent write of that action is a
 * compare-and-set on it, so an action started before a revocation never
 * turns the consent back on. `rev` grows with every write of the consent.
 */

import { MAX_REVOKED_DEVICE_LABELS } from '../../api/push';
import { withPushStoreLock } from './locks';

/** localStorage key of the push state record. */
export const PUSH_STATE_KEY = 'skein.push.v1.state';

/** Largest size of the label set S of one consent. */
export const MAX_CONSENT_LABELS = MAX_REVOKED_DEVICE_LABELS;

export type ConsentState = 'none' | 'enabled' | 'off';

/** How an unconfirmed label came into the consent. */
export type PendingKind = 'enable' | 'accept';

export interface Consent {
  state: ConsentState;
  /** Generation: grows with every revocation of this device. */
  gen: number;
  /** The label set S. */
  labels: string[];
  /** Device label of an `enabled` consent; `null` otherwise. */
  label: string | null;
  /** Set while the server has not confirmed `label`. */
  pending: { label: string; kind: PendingKind } | null;
  /** Endpoint of this user's channel. Kept when the consent is `off`. */
  endpoint: string | null;
  /** Fingerprint of the channel keys written with `endpoint`. */
  keysFingerprint: string | null;
  /** `off` whose revocation the server has not confirmed yet. */
  offUnconfirmed: boolean;
  /** Grows with every write of this consent. */
  rev: number;
}

/**
 * Protection of a `deviceRevoke` work replayed by another user: the owner's
 * subscription with the work's endpoint as the owner's confirmed list showed
 * it, `absent` when that list had none, `unconfirmed` when the owner could not
 * be confirmed.
 */
export type RevokeGuard = { id: string; version: number } | 'absent' | 'unconfirmed';

export type PushWork =
  /** Unsubscribe the browser channel with this endpoint, if it is still current. */
  | { id: string; type: 'localUnsubscribe'; endpoint: string; heldUntil?: number }
  /** Remove the channel with this endpoint on the server, for any user. */
  | { id: string; type: 'foreignRemoval'; endpoint: string }
  /** Revoke the owner's device labels (and unlabelled endpoint). */
  | {
      id: string;
      type: 'deviceRevoke';
      ownerUserId: string;
      labels: string[];
      endpoint?: string;
      guard: RevokeGuard;
      /**
       * A subscription of the owner removed by id after the labels are
       * revoked (its label did not fit into the labels); the removal by id
       * also revokes its label.
       */
      removeSubscriptionId?: string;
      /** See {@link isHeld}. */
      heldUntil?: number;
    };

/**
 * Whether `work` is still held by the explicit logout that wrote it: until
 * `heldUntil` (epoch ms, the end of that logout's budget) the logout may
 * still take it back, so no repeat performs it. After that it is an
 * ordinary unfinished work — also when the tab closed meanwhile.
 */
export function isHeld(work: PushWork, now: number = Date.now()): boolean {
  return work.type !== 'foreignRemoval' && work.heldUntil !== undefined && now < work.heldUntil;
}

/** A work as the caller describes it; the id is assigned on write. */
export type NewPushWork = PushWork extends infer W ? (W extends PushWork ? Omit<W, 'id'> : never) : never;

export interface PushStateRecord {
  consents: Record<string, Consent>;
  works: PushWork[];
}

/**
 * Storage is unavailable, or the write could not be confirmed. A failed read
 * or `setItem` changed nothing; a failed read back leaves either the previous
 * or the new record whole.
 */
export class PushStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PushStorageError';
  }
}

/** The consent moved on since the caller read it. Nothing changed. */
export class PushStateConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PushStateConflictError';
  }
}

/** S is full: no new label is created until this device is revoked. */
export class PushLabelLimitError extends Error {
  constructor() {
    super(`the consent already holds ${MAX_CONSENT_LABELS} device labels`);
    this.name = 'PushLabelLimitError';
  }
}

/** A work that must not be written. Nothing changed. */
export class InvalidPushWorkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidPushWorkError';
  }
}

/** The consent of a user with no record: "no mark". */
export function emptyConsent(): Consent {
  return {
    state: 'none',
    gen: 0,
    labels: [],
    label: null,
    pending: null,
    endpoint: null,
    keysFingerprint: null,
    offUnconfirmed: false,
    rev: 0,
  };
}

// ───────────────────────── Reading ─────────────────────────

function storage(): Storage {
  let s: Storage | undefined;
  try {
    s = window.localStorage;
  } catch {
    s = undefined;
  }
  if (!s) throw new PushStorageError('localStorage is unavailable');
  return s;
}

const isString = (v: unknown): v is string => typeof v === 'string';
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const stringOrNull = (v: unknown): string | null => (isString(v) ? v : null);

function parseGuard(v: unknown): RevokeGuard | undefined {
  if (v === 'absent' || v === 'unconfirmed') return v;
  if (v !== null && typeof v === 'object') {
    const g = v as Record<string, unknown>;
    if (isString(g.id) && g.id !== '' && isCount(g.version)) return { id: g.id, version: g.version };
  }
  return undefined;
}

function parseConsent(v: unknown): Consent {
  const c = emptyConsent();
  if (v === null || typeof v !== 'object') return c;
  const r = v as Record<string, unknown>;
  if (r.state === 'enabled' || r.state === 'off' || r.state === 'none') c.state = r.state;
  if (isCount(r.gen)) c.gen = r.gen;
  if (Array.isArray(r.labels)) c.labels = r.labels.filter(isString);
  c.label = stringOrNull(r.label);
  if (r.pending !== null && typeof r.pending === 'object') {
    const p = r.pending as Record<string, unknown>;
    if (isString(p.label) && (p.kind === 'enable' || p.kind === 'accept')) {
      c.pending = { label: p.label, kind: p.kind };
    }
  }
  c.endpoint = stringOrNull(r.endpoint);
  c.keysFingerprint = stringOrNull(r.keysFingerprint);
  c.offUnconfirmed = r.offUnconfirmed === true;
  if (isCount(r.rev)) c.rev = r.rev;
  return c;
}

function parseWork(v: unknown): PushWork | undefined {
  if (v === null || typeof v !== 'object') return undefined;
  const w = v as Record<string, unknown>;
  if (!isString(w.id)) return undefined;
  if (w.type === 'foreignRemoval' && isString(w.endpoint)) {
    return { id: w.id, type: w.type, endpoint: w.endpoint };
  }
  if (w.type === 'localUnsubscribe' && isString(w.endpoint)) {
    const work: PushWork = { id: w.id, type: w.type, endpoint: w.endpoint };
    if (isCount(w.heldUntil)) work.heldUntil = w.heldUntil;
    return work;
  }
  if (w.type === 'deviceRevoke' && isString(w.ownerUserId) && Array.isArray(w.labels)) {
    const guard = parseGuard(w.guard);
    if (guard === undefined) return undefined;
    const work: PushWork = {
      id: w.id,
      type: 'deviceRevoke',
      ownerUserId: w.ownerUserId,
      labels: w.labels.filter(isString),
      guard,
    };
    if (isString(w.endpoint)) work.endpoint = w.endpoint;
    if (isString(w.removeSubscriptionId) && w.removeSubscriptionId !== '') work.removeSubscriptionId = w.removeSubscriptionId;
    if (isCount(w.heldUntil)) work.heldUntil = w.heldUntil;
    return work;
  }
  return undefined;
}

function parseRecord(raw: string | null): PushStateRecord {
  const record: PushStateRecord = { consents: {}, works: [] };
  if (raw === null) return record;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return record;
  }
  if (v === null || typeof v !== 'object') return record;
  const r = v as Record<string, unknown>;
  if (r.consents !== null && typeof r.consents === 'object') {
    for (const [userId, consent] of Object.entries(r.consents as Record<string, unknown>)) {
      record.consents[userId] = parseConsent(consent);
    }
  }
  if (Array.isArray(r.works)) {
    for (const w of r.works) {
      const work = parseWork(w);
      if (work !== undefined) record.works.push(work);
    }
  }
  return record;
}

/**
 * Reads the whole record synchronously. Without storage, or with a record
 * that is not JSON, the browser holds no consent and no work.
 */
export function readPushState(): PushStateRecord {
  let raw: string | null;
  try {
    raw = storage().getItem(PUSH_STATE_KEY);
  } catch {
    raw = null;
  }
  return parseRecord(raw);
}

/** The consent of `userId`; "no mark" when there is none. */
export function readConsent(userId: string): Consent {
  return readPushState().consents[userId] ?? emptyConsent();
}

/**
 * The generation of `userId`'s consent, read synchronously — an explicit
 * action reads it in its click handler, before the permission prompt, the
 * lock queue and the network.
 */
export function readConsentGen(userId: string): number {
  return readConsent(userId).gen;
}

/** Whether the consent is "no mark" for the decision table. */
export function isNoMark(consent: Consent): boolean {
  return consent.state === 'none';
}

// ───────────────────────── Writing ─────────────────────────

/**
 * Applies `change` to the current record under `skein.push.store` and
 * writes the result with one `setItem`, then reads it back.
 *
 * Outcomes: `change` throws — nothing is written; `setItem` throws — the
 * previous record stays whole, {@link PushStorageError}; the read back fails
 * or differs — {@link PushStorageError}, and the record may hold either the
 * previous or the new state whole (never a mix), so the caller treats the
 * transition as not confirmed and reads the record again.
 *
 * `guard` bounds the write (see {@link WriteGuard}).
 */
async function commit<T>(change: (record: PushStateRecord) => T, guard?: WriteGuard): Promise<T> {
  const signal = guard?.signal;
  return withPushStoreLock(() => {
    if (signal?.aborted) throw signal.reason;
    guard?.check?.();
    const s = storage();
    let before: string | null;
    try {
      before = s.getItem(PUSH_STATE_KEY);
    } catch {
      throw new PushStorageError('the push state could not be read');
    }
    const record = parseRecord(before);
    const result = change(record);
    const next = JSON.stringify(record);
    try {
      s.setItem(PUSH_STATE_KEY, next);
    } catch {
      throw new PushStorageError('the push state could not be written');
    }
    let after: string | null;
    try {
      after = s.getItem(PUSH_STATE_KEY);
    } catch {
      after = null;
    }
    if (after !== next) throw new PushStorageError('the push state did not persist');
    return result;
  }, signal);
}

/**
 * What bounds one write of the push state. `signal` ends the wait for the
 * `skein.push.store` lock: once it is aborted the lock request is given up,
 * and a lock granted after that writes nothing. `check` runs once the lock is
 * held, right before the write, and throws to cancel it — the caller's
 * condition (its appearance is still current) is checked where the write
 * happens, not before the wait for the lock.
 */
export interface WriteGuard {
  signal?: AbortSignal;
  check?: () => void;
}

/** What the caller saw: the generation and, optionally, the revision. */
export interface ConsentExpectation {
  gen: number;
  rev?: number;
}

/** What the caller saw, revision included: the write is refused after any other write. */
export interface ConsentSnapshot {
  gen: number;
  rev: number;
}

function consentFor(record: PushStateRecord, userId: string): Consent {
  return record.consents[userId] ?? emptyConsent();
}

function checkExpectation(consent: Consent, expect: ConsentExpectation): void {
  if (consent.gen !== expect.gen) {
    throw new PushStateConflictError('the consent generation changed');
  }
  if (expect.rev !== undefined && consent.rev !== expect.rev) {
    throw new PushStateConflictError('the consent revision changed');
  }
}

function store(record: PushStateRecord, userId: string, consent: Consent): Consent {
  const next = { ...consent, rev: consent.rev + 1 };
  record.consents[userId] = next;
  return next;
}

function newId(): string {
  return crypto.randomUUID();
}

function validateWork(work: NewPushWork): void {
  if (work.type !== 'deviceRevoke') {
    if (!isString(work.endpoint) || work.endpoint === '') {
      throw new InvalidPushWorkError(`${work.type} needs an endpoint`);
    }
    return;
  }
  if (parseGuard(work.guard) === undefined) {
    throw new InvalidPushWorkError('deviceRevoke needs a guard');
  }
  const hasEndpoint = isString(work.endpoint) && work.endpoint !== '';
  if (work.labels.length === 0 && !hasEndpoint) {
    throw new InvalidPushWorkError('deviceRevoke needs a label or an endpoint');
  }
  if (work.labels.length > MAX_CONSENT_LABELS) {
    throw new InvalidPushWorkError(`deviceRevoke carries at most ${MAX_CONSENT_LABELS} labels`);
  }
}

function appendWork(record: PushStateRecord, work: NewPushWork): PushWork {
  validateWork(work);
  const stored = { ...work, id: newId() } as PushWork;
  record.works.push(stored);
  return stored;
}

/** Arguments of {@link beginConsentLabel}. */
export interface BeginLabelArgs {
  expect: ConsentExpectation;
  kind: PendingKind;
  /** Endpoint of the channel the label is for. */
  endpoint: string;
  keysFingerprint: string | null;
}

/**
 * Creates a new device label and writes it into the consent as "enabled,
 * not confirmed" — before the registration that carries it is sent. An
 * explicit enable starts from "no mark" or "explicitly off"; an accept of an
 * existing subscription (row 6) only from "no mark". Refused with
 * {@link PushLabelLimitError} when S is full.
 */
export async function beginConsentLabel(userId: string, args: BeginLabelArgs, guard?: WriteGuard): Promise<Consent> {
  return commit((record) => {
    const consent = consentFor(record, userId);
    checkExpectation(consent, args.expect);
    if (consent.state === 'enabled') {
      throw new PushStateConflictError('the consent is already enabled');
    }
    if (args.kind === 'accept' && consent.state !== 'none') {
      throw new PushStateConflictError('an existing subscription is accepted only from no mark');
    }
    if (consent.labels.length >= MAX_CONSENT_LABELS) throw new PushLabelLimitError();
    const label = newId();
    return store(record, userId, {
      ...consent,
      state: 'enabled',
      labels: [...consent.labels, label],
      label,
      pending: { label, kind: args.kind },
      endpoint: args.endpoint,
      keysFingerprint: args.keysFingerprint,
      offUnconfirmed: false,
    });
  }, guard);
}

/** Arguments of {@link confirmConsent}. */
export interface ConfirmConsentArgs {
  expect: ConsentSnapshot;
  /** The label the server confirmed. */
  label: string;
  /** The endpoint the server confirmed it at. */
  endpoint: string;
  keysFingerprint: string | null;
}

/**
 * Marks the consent confirmed: the server holds a subscription with this
 * label at this endpoint. Refused when the consent was written since the
 * caller's snapshot, or no longer carries this label at this endpoint — a
 * late answer never brings back an older endpoint or fingerprint.
 */
export async function confirmConsent(userId: string, args: ConfirmConsentArgs, guard?: WriteGuard): Promise<Consent> {
  return commit((record) => {
    const consent = consentFor(record, userId);
    checkExpectation(consent, args.expect);
    if (consent.state !== 'enabled' || consent.label !== args.label || consent.endpoint !== args.endpoint) {
      throw new PushStateConflictError('the consent no longer carries this label at this endpoint');
    }
    return store(record, userId, {
      ...consent,
      pending: null,
      keysFingerprint: args.keysFingerprint,
    });
  }, guard);
}

/** Arguments of {@link recordUnconfirmedChannel}. */
export interface RecordChannelArgs {
  expect: ConsentSnapshot;
  /** The consent's current label; the write is refused when it changed. */
  label: string;
  /** Endpoint of the new channel. */
  endpoint: string;
  keysFingerprint: string | null;
  /**
   * Kind recorded when the consent was confirmed: `enable` for row 2 (a
   * confirmed consent may create its subscription again, US-8), `accept` for
   * row 9 (only an update). An already unconfirmed consent keeps its kind.
   */
  kind: PendingKind;
}

/**
 * Writes the endpoint of a new channel for the consent's existing label as
 * unconfirmed — before the registration that carries it is sent (rows 2 and
 * 9). Until {@link confirmConsent} the consent is "enabled, not confirmed",
 * so a lost answer is finished by row 4 on the next appearance.
 */
export async function recordUnconfirmedChannel(userId: string, args: RecordChannelArgs, guard?: WriteGuard): Promise<Consent> {
  return commit((record) => {
    const consent = consentFor(record, userId);
    checkExpectation(consent, args.expect);
    if (consent.state !== 'enabled' || consent.label !== args.label) {
      throw new PushStateConflictError('the consent no longer carries this label');
    }
    return store(record, userId, {
      ...consent,
      pending: consent.pending ?? { label: args.label, kind: args.kind },
      endpoint: args.endpoint,
      keysFingerprint: args.keysFingerprint,
    });
  }, guard);
}

/** Arguments of {@link abandonConsentLabel}. */
export interface AbandonLabelArgs {
  expect: ConsentExpectation;
  /** The unconfirmed label being given up. */
  label: string;
}

/**
 * Returns an unconfirmed consent to "no mark" (an abandoned accept, a
 * definite refusal of an enable). The label stays in S.
 */
export async function abandonConsentLabel(userId: string, args: AbandonLabelArgs, guard?: WriteGuard): Promise<Consent> {
  return commit((record) => {
    const consent = consentFor(record, userId);
    checkExpectation(consent, args.expect);
    if (consent.state !== 'enabled' || consent.pending?.label !== args.label) {
      throw new PushStateConflictError('the consent no longer waits for this label');
    }
    return store(record, userId, {
      ...consent,
      state: 'none',
      label: null,
      pending: null,
      endpoint: null,
      keysFingerprint: null,
    });
  }, guard);
}

/** Arguments of {@link updateConsentChannel}. */
export interface UpdateChannelArgs {
  expect: ConsentSnapshot;
  endpoint: string;
  keysFingerprint: string | null;
}

/**
 * Replaces the endpoint and key fingerprint of an `enabled` consent. Refused
 * when the consent was written since the caller's snapshot.
 */
export async function updateConsentChannel(userId: string, args: UpdateChannelArgs, guard?: WriteGuard): Promise<Consent> {
  return commit((record) => {
    const consent = consentFor(record, userId);
    checkExpectation(consent, args.expect);
    if (consent.state !== 'enabled') {
      throw new PushStateConflictError('the consent is not enabled');
    }
    return store(record, userId, {
      ...consent,
      endpoint: args.endpoint,
      keysFingerprint: args.keysFingerprint,
    });
  }, guard);
}

/** Arguments of {@link restoreConsent}. */
export interface RestoreConsentArgs {
  /** The snapshot of the write being undone; any later write keeps its result. */
  expect: ConsentSnapshot;
  /** The consent as it was before that write. */
  previous: Consent;
}

/**
 * Undoes the caller's own write of the consent: the consent is put back as
 * it was before that write (generation and revision move on), only if
 * nothing wrote it since. For a write followed by a request the server
 * refused because another user is signed in — nothing reached the server, so
 * nothing of the write may stay.
 */
export async function restoreConsent(userId: string, args: RestoreConsentArgs, guard?: WriteGuard): Promise<Consent> {
  return commit((record) => {
    const consent = consentFor(record, userId);
    checkExpectation(consent, args.expect);
    return store(record, userId, { ...args.previous, gen: consent.gen, rev: consent.rev });
  }, guard);
}

/**
 * The owner's subscription at the revoked endpoint as the owner's confirmed
 * list showed it, with its device label (`null` without one).
 */
export interface ListedSubscription {
  id: string;
  label: string | null;
}

/** Arguments of {@link revokeConsent}. */
export interface RevokeConsentArgs {
  /** Endpoint of this browser's channel, when known. */
  endpoint: string | null;
  guard: RevokeGuard;
  /**
   * Also writes, in the same transition, a `localUnsubscribe` work for
   * `endpoint` (when there is one): the removal of this device's channel
   * that follows the revocation.
   */
  localUnsubscribe?: boolean;
  /** The subscription the owner's list shows at `endpoint` (see {@link withListedLabel}). */
  listed?: ListedSubscription;
  /** The works are held by the explicit logout writing them (see {@link isHeld}). */
  heldUntil?: number;
}

/** Result of {@link revokeConsent}. */
export interface RevokeConsentResult {
  /** The consent as the transition wrote it. */
  consent: Consent;
  /** The consent as it was right before the transition, read under the lock. */
  previous: Consent;
  /** The revocation work, or `null` when there is neither a label nor an endpoint. */
  work: PushWork | null;
  /** The `localUnsubscribe` work, when one was asked for and there is an endpoint. */
  localWork: PushWork | null;
}

/**
 * The labels and the removal by id of a revocation work once `listed`, the
 * subscription the owner's list shows at the endpoint, is known: a label S
 * does not have (an accept whose state was lost) joins the labels while
 * they have room; with a full S that subscription is removed by id instead,
 * which also revokes its label. Decided on the record under the store lock,
 * so a label written meanwhile counts.
 */
function withListedLabel(labels: string[], listed: ListedSubscription | undefined): { labels: string[]; removeSubscriptionId?: string } {
  const next = [...labels];
  if (listed === undefined || listed.label === null || next.includes(listed.label)) return { labels: next };
  if (next.length < MAX_CONSENT_LABELS) {
    next.push(listed.label);
    return { labels: next };
  }
  return { labels: next, removeSubscriptionId: listed.id };
}

/**
 * The revocation transition of this device (explicit logout, disable here,
 * removal of the current device): the consent becomes `off`, `gen` grows —
 * also when S is empty — and S moves whole into a new `deviceRevoke` work,
 * written only when it has a label or an endpoint. The same write marks the
 * disable as not confirmed (`offUnconfirmed`), also with an empty S and an
 * unread channel, so a reload still shows it; the mark is cleared by
 * {@link setConsentOffUnconfirmed} once the server confirmed the result. Not
 * a compare-and-set: a revocation always applies.
 */
export async function revokeConsent(
  userId: string,
  args: RevokeConsentArgs,
  guard?: WriteGuard,
): Promise<RevokeConsentResult> {
  return commit((record) => {
    const consent = consentFor(record, userId);
    const endpoint = args.endpoint !== null && args.endpoint !== '' ? args.endpoint : null;
    let work: PushWork | null = null;
    const { labels, removeSubscriptionId } = withListedLabel(consent.labels, args.listed);
    if (labels.length > 0 || endpoint !== null) {
      const newWork: NewPushWork = {
        type: 'deviceRevoke',
        ownerUserId: userId,
        labels,
        guard: args.guard,
      };
      if (endpoint !== null) newWork.endpoint = endpoint;
      if (removeSubscriptionId !== undefined) newWork.removeSubscriptionId = removeSubscriptionId;
      if (args.heldUntil !== undefined) newWork.heldUntil = args.heldUntil;
      work = appendWork(record, newWork);
    } else if (parseGuard(args.guard) === undefined) {
      throw new InvalidPushWorkError('deviceRevoke needs a guard');
    }
    const localWork =
      args.localUnsubscribe === true && endpoint !== null
        ? appendWork(record, withHeld({ type: 'localUnsubscribe', endpoint }, args.heldUntil))
        : null;
    const next = store(record, userId, {
      ...consent,
      state: 'off',
      gen: consent.gen + 1,
      labels: [],
      label: null,
      pending: null,
      endpoint: endpoint ?? consent.endpoint,
      offUnconfirmed: true,
    });
    return { consent: next, previous: consent, work, localWork };
  }, guard);
}

function withHeld<W extends NewPushWork>(work: W, heldUntil: number | undefined): W {
  return heldUntil === undefined ? work : { ...work, heldUntil };
}

/** Arguments of {@link refineRevocation}. */
export interface RefineRevocationArgs {
  /** The revocation work the transition wrote; `null` when it wrote none. */
  workId: string | null;
  /** The endpoint of this browser's channel, read at the confirmation. */
  endpoint: string;
  /** The guard from the owner's confirmed list, or `unconfirmed`. */
  guard: RevokeGuard;
  /** The subscription the owner's list shows at `endpoint`. */
  listed?: ListedSubscription;
  /** Also journal the removal of the channel (`localUnsubscribe`). */
  localUnsubscribe: boolean;
  /** The works are held by the explicit logout writing them (see {@link isHeld}). */
  heldUntil?: number;
}

/** Result of {@link refineRevocation}. */
export interface RefineRevocationResult {
  /** The revocation work as it stands now. */
  work: PushWork;
  /** The `localUnsubscribe` work this write added, `null` when one was there or none was asked for. */
  localWork: PushWork | null;
}

/**
 * Completes a revocation transition written before the channel was read
 * (an explicit logout writes it in the click): the work gets the channel's
 * endpoint and the guard, and the label of the subscription listed there
 * (see {@link withListedLabel}); the removal of the channel is journaled
 * when asked. The work keeps its id; without one (S was empty and no
 * endpoint was known) a new work is written. One write, the consent is not
 * touched.
 */
export async function refineRevocation(userId: string, args: RefineRevocationArgs, guard?: WriteGuard): Promise<RefineRevocationResult> {
  return commit((record) => {
    const index = record.works.findIndex(
      (w) => w.id === args.workId && w.type === 'deviceRevoke' && w.ownerUserId === userId,
    );
    const existing = index >= 0 ? record.works[index] : undefined;
    const { labels, removeSubscriptionId } = withListedLabel(
      existing !== undefined && existing.type === 'deviceRevoke' ? existing.labels : [],
      args.listed,
    );
    const next: NewPushWork = { type: 'deviceRevoke', ownerUserId: userId, labels, guard: args.guard, endpoint: args.endpoint };
    if (removeSubscriptionId !== undefined) next.removeSubscriptionId = removeSubscriptionId;
    const heldUntil = existing?.type === 'deviceRevoke' ? existing.heldUntil : args.heldUntil;
    if (heldUntil !== undefined) next.heldUntil = heldUntil;
    let work: PushWork;
    if (existing !== undefined) {
      validateWork(next);
      work = { ...next, id: existing.id } as PushWork;
      record.works[index] = work;
    } else {
      work = appendWork(record, next);
    }
    const journaled = record.works.some((w) => w.type === 'localUnsubscribe' && w.endpoint === args.endpoint);
    const localWork =
      args.localUnsubscribe && !journaled
        ? appendWork(record, withHeld({ type: 'localUnsubscribe', endpoint: args.endpoint }, args.heldUntil))
        : null;
    return { work, localWork };
  }, guard);
}

/** Arguments of {@link undoRevocation}. */
export interface UndoRevocationArgs {
  /** The consent as the caller last wrote it; any later write keeps its result. */
  expect: ConsentSnapshot;
  /** The consent right before the revocation transition. */
  previous: Consent;
  /** The works the revocation wrote. */
  workIds: string[];
  /**
   * The end of the hold on those works (see {@link isHeld}): past it a
   * repeat may have performed them, and nothing is taken back.
   */
  before?: number;
}

/**
 * Takes a revocation transition back in one write — the server confirmed
 * another user, or the revocation ended before its request was sent: the
 * consent is put back as it was (the generation keeps its growth, so an
 * action started before the transition stays refused) and the works of the
 * transition go. Refused with {@link PushStateConflictError}, changing
 * nothing, when the consent was written since `expect`, a work of the
 * transition is gone (performed), or its hold ended.
 */
export async function undoRevocation(userId: string, args: UndoRevocationArgs, guard?: WriteGuard): Promise<Consent> {
  return commit((record) => {
    const consent = consentFor(record, userId);
    checkExpectation(consent, args.expect);
    if (args.before !== undefined && Date.now() >= args.before) {
      throw new PushStateConflictError('the hold on the revocation ended');
    }
    if (!args.workIds.every((id) => record.works.some((w) => w.id === id))) {
      throw new PushStateConflictError('a work of the revocation was finished meanwhile');
    }
    record.works = record.works.filter((w) => !args.workIds.includes(w.id));
    return store(record, userId, { ...args.previous, gen: consent.gen, rev: consent.rev });
  }, guard);
}

/**
 * Sets or clears "disable not confirmed" on an `off` consent. Refused when
 * the consent was written since the caller's snapshot.
 */
export async function setConsentOffUnconfirmed(
  userId: string,
  expect: ConsentSnapshot,
  offUnconfirmed: boolean,
  guard?: WriteGuard,
): Promise<Consent> {
  return commit((record) => {
    const consent = consentFor(record, userId);
    checkExpectation(consent, expect);
    if (consent.state !== 'off') throw new PushStateConflictError('the consent is not off');
    return store(record, userId, { ...consent, offUnconfirmed });
  }, guard);
}

/** Whether a consent of another user than `userId` names `endpoint`: the channel is that user's. */
function namedByOther(record: PushStateRecord, userId: string, endpoint: string): boolean {
  return Object.entries(record.consents).some(([id, consent]) => id !== userId && consent.endpoint === endpoint);
}

/** Whether a consent of another user than `userId` names `endpoint` (see {@link retireConsent}). */
export function endpointNamedByOther(userId: string, endpoint: string): boolean {
  return namedByOther(readPushState(), userId, endpoint);
}

/** Result of {@link retireConsent}. */
export interface RetireConsentResult {
  /** The `localUnsubscribe` work written for the consent's endpoint, `null` when none was. */
  journaled: PushWork | null;
}

/**
 * Deletes the consent of `userId` (the account was deleted) and, in the
 * same write, journals the removal of the channel its endpoint names —
 * unless another user's consent names that endpoint or its removal is
 * journaled already — so a removal that does not happen now is repeated on
 * the next page load.
 */
export async function retireConsent(userId: string, guard?: WriteGuard): Promise<RetireConsentResult> {
  return commit((record) => {
    const endpoint = record.consents[userId]?.endpoint ?? null;
    delete record.consents[userId];
    if (endpoint === null || namedByOther(record, userId, endpoint)) return { journaled: null };
    if (record.works.some((w) => w.type === 'localUnsubscribe' && w.endpoint === endpoint)) return { journaled: null };
    return { journaled: appendWork(record, { type: 'localUnsubscribe', endpoint }) };
  }, guard);
}

/** Writes a new unfinished work and returns it with its id. */
export async function addPushWork(work: NewPushWork, guard?: WriteGuard): Promise<PushWork> {
  return commit((record) => appendWork(record, work), guard);
}

/** Removes a finished work; a missing id is not an error. */
export async function removePushWork(id: string, guard?: WriteGuard): Promise<void> {
  await commit((record) => {
    record.works = record.works.filter((w) => w.id !== id);
  }, guard);
}
