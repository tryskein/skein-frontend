/**
 * Row 35a — the push locks on top of `navigator.locks`.
 *
 * Contract (plan "Key decisions", rule 8): a whole operation and a write of
 * the push state take two different locks, `skein.push.op` and
 * `skein.push.store`, both exclusive; the caller's abort signal reaches the
 * lock request, and an abort while waiting rejects without running the body;
 * without `navigator.locks` the push parts are not supported.
 *
 * The native cross-tab guarantees of Web Locks belong to the browser; this
 * test checks our mapping onto the API, with a stand-in lock manager that
 * queues requests per name and honours the signal like the browser does.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  PushLocksUnavailableError,
  pushLocksSupported,
  withPushOpLock,
  withPushStoreLock,
} from './locks';

interface Request {
  name: string;
  mode: LockMode | undefined;
  signal: AbortSignal | undefined;
}

function installLocks(): Request[] {
  const requests: Request[] = [];
  const tails = new Map<string, Promise<void>>();
  const request = (name: string, options: LockOptions, callback: LockGrantedCallback<unknown>) => {
    requests.push({ name, mode: options.mode, signal: options.signal });
    const signal = options.signal;
    const previous = tails.get(name) ?? Promise.resolve();
    const result = new Promise<unknown>((resolve, reject) => {
      let waiting = true;
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      signal?.addEventListener('abort', () => {
        if (waiting) reject(signal.reason);
      }, { once: true });
      void previous.then(async () => {
        if (signal?.aborted) return;
        waiting = false;
        try {
          resolve(await callback({ name, mode: options.mode ?? 'exclusive' } as Lock));
        } catch (e) {
          reject(e);
        }
      });
    });
    tails.set(name, result.then(() => undefined, () => undefined));
    return result;
  };
  Object.defineProperty(navigator, 'locks', { value: { request }, configurable: true });
  return requests;
}

function removeLocks(): void {
  delete (navigator as unknown as { locks?: unknown }).locks;
}

describe('row 35a — push locks', () => {
  let requests: Request[];

  beforeEach(() => {
    requests = installLocks();
  });

  afterEach(() => {
    removeLocks();
  });

  test('an operation and a state write take two different exclusive locks', async () => {
    expect(await withPushOpLock(async () => 'op')).toBe('op');
    expect(await withPushStoreLock(() => 'store')).toBe('store');
    expect(requests.map((r) => [r.name, r.mode])).toEqual([
      ['skein.push.op', 'exclusive'],
      ['skein.push.store', 'exclusive'],
    ]);
  });

  test('the abort signal is passed to the lock request', async () => {
    const opSignal = new AbortController().signal;
    const storeSignal = new AbortController().signal;
    await withPushOpLock(async () => undefined, opSignal);
    await withPushStoreLock(() => undefined, storeSignal);
    expect(requests[0].signal).toBe(opSignal);
    expect(requests[1].signal).toBe(storeSignal);
  });

  test('an abort while waiting for the lock rejects and the body never runs', async () => {
    let release!: () => void;
    const holder = withPushOpLock(() => new Promise<void>((resolve) => { release = resolve; }));
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));

    const controller = new AbortController();
    const body = vi.fn(async () => 'ran');
    const waiter = withPushOpLock(body, controller.signal);
    controller.abort(new DOMException('deadline', 'AbortError'));

    await expect(waiter).rejects.toMatchObject({ name: 'AbortError' });
    release();
    await holder;
    expect(body).not.toHaveBeenCalled();
  });
});

describe('row 35a — without navigator.locks', () => {
  test('push is not supported and a lock request rejects without running the body', async () => {
    removeLocks();
    expect(pushLocksSupported()).toBe(false);
    const body = vi.fn(async () => undefined);
    await expect(withPushOpLock(body)).rejects.toBeInstanceOf(PushLocksUnavailableError);
    await expect(withPushStoreLock(body)).rejects.toBeInstanceOf(PushLocksUnavailableError);
    expect(body).not.toHaveBeenCalled();
  });

  test('with navigator.locks push is supported', () => {
    installLocks();
    expect(pushLocksSupported()).toBe(true);
    removeLocks();
  });
});
