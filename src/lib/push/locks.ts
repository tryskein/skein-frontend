/**
 * Web Locks of the browser push state, shared by every tab of the origin.
 *
 *   - `skein.push.op` serialises a whole push operation (an enable, a
 *     disable, the decision on a user's appearance, an explicit logout or
 *     the logout after an account deletion), network included. A logout
 *     waits for it only within its budget and goes on without it.
 *   - `skein.push.store` serialises the short read-modify-write of the push
 *     state record, without network.
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

/**
 * Prefix of the lock an explicit logout holds while the works it wrote are
 * still its own (`pushState.ts#isHeld`): from before its first write until
 * its verdict and its take-back or channel removal are done, at most its
 * budget. The browser frees it when the tab goes, so it never outlives its
 * logout, whatever the clock says.
 */
export const DEPARTURE_LOCK_PREFIX = 'skein.push.departure.';

/** The names of the locks held right now in any tab of the origin. */
export async function heldLockNames(): Promise<Set<string>> {
  const locks = lockManager();
  if (locks === null) return new Set();
  const snapshot = await locks.query();
  const names = new Set<string>();
  for (const lock of snapshot.held ?? []) if (typeof lock.name === 'string') names.add(lock.name);
  return names;
}

/** Resolves once nobody holds `name` (at once when nobody does). */
export async function afterLockReleased(name: string): Promise<void> {
  const locks = lockManager();
  if (locks === null) return;
  await locks.request(name, { mode: 'shared' }, () => undefined);
}

/**
 * Holds the lock `name`: `held` settles `true` once it is granted, `false`
 * when `signal` or `release` ended the wait first. `release` frees a granted
 * lock, or withdraws the request still waiting for it.
 */
export function holdLock(name: string, signal?: AbortSignal): { held: Promise<boolean>; release: () => void } {
  const request = new AbortController();
  const withdraw = () => request.abort(signal?.reason ?? new DOMException('the holder ended', 'AbortError'));
  if (signal?.aborted) withdraw();
  else signal?.addEventListener('abort', withdraw, { once: true });
  let granted = false;
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = () => {
      signal?.removeEventListener('abort', withdraw);
      if (!granted) request.abort(new DOMException('the holder ended', 'AbortError'));
      resolve();
    };
  });
  const held = new Promise<boolean>((resolve) => {
    withLock(
      name,
      async () => {
        granted = true;
        resolve(true);
        await released;
      },
      request.signal,
    ).catch(() => resolve(false));
  });
  return { held, release };
}
