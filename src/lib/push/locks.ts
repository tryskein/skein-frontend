/**
 * Web Locks of the browser push state, shared by every tab of the origin.
 *
 *   - `skein.push.op` serialises a whole push operation (an enable, a
 *     disable, the decision on a user's appearance), network included.
 *   - `skein.push.store` serialises the short read-modify-write of the push
 *     state record, without network, so an explicit logout never waits for
 *     another tab's network call.
 *
 * Both are taken in exclusive mode. Without `navigator.locks` the push parts
 * of the page are inactive: there is no other way to keep two tabs from
 * running enables at the same time.
 */

/** Lock of a whole push operation. */
export const PUSH_OP_LOCK = 'skein.push.op';

/** Lock of a read-modify-write of the push state record. */
export const PUSH_STORE_LOCK = 'skein.push.store';

/** Thrown when the browser has no Web Locks API. */
export class PushLocksUnavailableError extends Error {
  constructor() {
    super('Web Locks API is unavailable');
    this.name = 'PushLocksUnavailableError';
  }
}

function lockManager(): LockManager | null {
  if (typeof navigator === 'undefined') return null;
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  return locks && typeof locks.request === 'function' ? locks : null;
}

/** Whether the browser supports the locks the push parts need. */
export function pushLocksSupported(): boolean {
  return lockManager() !== null;
}

async function withLock<T>(name: string, body: () => T | Promise<T>, signal?: AbortSignal): Promise<T> {
  const locks = lockManager();
  if (locks === null) throw new PushLocksUnavailableError();
  const options: LockOptions = { mode: 'exclusive' };
  if (signal !== undefined) options.signal = signal;
  return (await locks.request(name, options, () => body())) as T;
}

/**
 * Runs a push operation under `skein.push.op`. Aborting `signal` while the
 * lock is awaited rejects with the abort reason and the body never runs.
 */
export function withPushOpLock<T>(body: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  return withLock(PUSH_OP_LOCK, body, signal);
}

/**
 * Runs a read-modify-write of the push state under `skein.push.store`.
 * Aborting `signal` while the lock is awaited rejects and the body never runs.
 */
export function withPushStoreLock<T>(body: () => T | Promise<T>, signal?: AbortSignal): Promise<T> {
  return withLock(PUSH_STORE_LOCK, body, signal);
}
