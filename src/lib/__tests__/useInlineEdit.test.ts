/**
 * F7 smoke tests for `useInlineEdit` (F5).
 *
 * The hook implements the inline-field UX from Q12:
 *   - Type → 2s debounce → flush via onSave.
 *   - Blur cancels the pending timer and flushes immediately if dirty.
 *   - External `initialValue` change resets local state ONLY when not
 *     dirty (server pushes don't stomp on user edits in progress).
 *   - onSave error sets `error` but does NOT roll back the local value
 *     — the user keeps their text so they can fix and retry.
 *
 * Timer-driven tests use `vi.useFakeTimers()` — never real setTimeout
 * (would make the suite flaky on slow CI).
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useInlineEdit } from '../useInlineEdit';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useInlineEdit — initial state', () => {
  test('value mirrors initialValue on first render', () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useInlineEdit<string>({ initialValue: 'hello', onSave }),
    );
    expect(result.current.value).toBe('hello');
    expect(result.current.isDirty).toBe(false);
    expect(result.current.isFlushing).toBe(false);
    expect(result.current.error).toBeNull();
  });
});

describe('useInlineEdit — debounce + flush', () => {
  test('setValue does not save immediately', () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useInlineEdit<string>({ initialValue: 'hello', onSave }),
    );

    act(() => result.current.setValue('hello world'));

    expect(result.current.value).toBe('hello world');
    expect(result.current.isDirty).toBe(true);
    expect(onSave).not.toHaveBeenCalled();
  });

  test('saves after 2s of no further setValue calls', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useInlineEdit<string>({ initialValue: 'hello', onSave }),
    );

    act(() => result.current.setValue('hello world'));
    expect(onSave).not.toHaveBeenCalled();

    // Drive the debounce timer to fire.
    await act(async () => {
      vi.advanceTimersByTime(2000);
      // The flush is async — let pending microtasks settle.
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith('hello world');
  });

  test('two setValue calls within 2s coalesce into one save with the latest value', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useInlineEdit<string>({ initialValue: 'hello', onSave }),
    );

    act(() => result.current.setValue('foo'));
    act(() => {
      vi.advanceTimersByTime(500);
    });
    act(() => result.current.setValue('bar'));

    await act(async () => {
      vi.advanceTimersByTime(2000);
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith('bar');
  });

  test('reverting to original cancels the pending save', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useInlineEdit<string>({ initialValue: 'hello', onSave }),
    );

    act(() => result.current.setValue('changed'));
    act(() => {
      vi.advanceTimersByTime(500);
    });
    act(() => result.current.setValue('hello')); // back to original

    await act(async () => {
      vi.advanceTimersByTime(2000);
      await Promise.resolve();
    });

    expect(result.current.isDirty).toBe(false);
    expect(onSave).not.toHaveBeenCalled();
  });

  test('onBlur flushes immediately and cancels the timer', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useInlineEdit<string>({ initialValue: 'hello', onSave }),
    );

    act(() => result.current.setValue('blurred'));
    // Blur happens before the 2s debounce expires.
    await act(async () => {
      result.current.onBlur();
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith('blurred');

    // Now advance time past the original debounce — the timer was
    // cancelled, so no second save fires.
    await act(async () => {
      vi.advanceTimersByTime(5000);
      await Promise.resolve();
    });
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  test('onBlur with no dirty state is a no-op', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useInlineEdit<string>({ initialValue: 'hello', onSave }),
    );

    await act(async () => {
      result.current.onBlur();
      await Promise.resolve();
    });

    expect(onSave).not.toHaveBeenCalled();
  });
});

describe('useInlineEdit — initialValue refresh from server', () => {
  /**
   * P1 fix: the hook now tracks the *previous* serialised initialValue
   * via a ref, so the external-sync effect can compare `value` against
   * the value the user last saw — not the new server value. That makes
   * the clean-vs-dirty decision correct in both directions:
   *   - clean field → adopt server value
   *   - dirty field → preserve user input
   */
  test('external initialValue change resets value when user was clean', () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(
      (props: { v: string }) => useInlineEdit<string>({ initialValue: props.v, onSave }),
      { initialProps: { v: 'hello' } },
    );

    expect(result.current.value).toBe('hello');
    expect(result.current.isDirty).toBe(false);

    act(() => {
      rerender({ v: 'server-pushed' });
    });

    // User wasn't typing — we follow the server.
    expect(result.current.value).toBe('server-pushed');
    expect(result.current.isDirty).toBe(false);
  });

  test('external initialValue change is ignored while user is mid-edit (dirty)', () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(
      (props: { v: string }) => useInlineEdit<string>({ initialValue: props.v, onSave }),
      { initialProps: { v: 'hello' } },
    );

    act(() => result.current.setValue('user-typing'));
    expect(result.current.isDirty).toBe(true);

    // Server-pushed value lands while user is mid-edit.
    act(() => {
      rerender({ v: 'server-pushed' });
    });
    // Local edit preserved — server update doesn't stomp the user.
    expect(result.current.value).toBe('user-typing');
    expect(result.current.isDirty).toBe(true);
  });

  test('after user flushes their edit, a subsequent external change is adopted', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(
      (props: { v: string }) => useInlineEdit<string>({ initialValue: props.v, onSave }),
      { initialProps: { v: 'hello' } },
    );

    // 1. User types and the parent eventually echoes the saved value back.
    act(() => result.current.setValue('user-typed'));
    await act(async () => {
      vi.advanceTimersByTime(2000);
      await Promise.resolve();
    });
    expect(onSave).toHaveBeenCalledWith('user-typed');

    // 2. Parent refetches and passes the saved value as new initialValue.
    act(() => {
      rerender({ v: 'user-typed' });
    });
    expect(result.current.value).toBe('user-typed');
    expect(result.current.isDirty).toBe(false);

    // 3. Someone else updates the field on the server.
    act(() => {
      rerender({ v: 'other-user-edit' });
    });
    expect(result.current.value).toBe('other-user-edit');
    expect(result.current.isDirty).toBe(false);
  });
});

describe('useInlineEdit — post-save isDirty', () => {
  /**
   * P1 polish: isDirty is computed against `lastSaved`, not against
   * the live `initialValue`. Without this, the field briefly shows
   * dirty between save success and the parent's invalidation refetch
   * landing (~100ms+). The state should flip clean the moment onSave
   * resolves, not when the parent re-renders us with the new value.
   */
  test('after successful save, isDirty becomes false immediately, before any external initialValue refresh', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useInlineEdit<string>({ initialValue: 'hello', onSave }),
    );

    act(() => result.current.setValue('hello world'));
    expect(result.current.isDirty).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(2000);
      await Promise.resolve();
    });

    // Save resolved. We have NOT rerendered with a fresh initialValue
    // yet (the parent's refetch hasn't landed). isDirty must already
    // be false — otherwise the input visibly flickers as "dirty" until
    // the network round-trip completes.
    expect(onSave).toHaveBeenCalledWith('hello world');
    expect(result.current.value).toBe('hello world');
    expect(result.current.isDirty).toBe(false);
  });
});

describe('useInlineEdit — error handling', () => {
  test('onSave failure sets error but preserves the local value', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() =>
      useInlineEdit<string>({ initialValue: 'hello', onSave }),
    );

    act(() => result.current.setValue('attempted'));

    // Use `runAllTimersAsync` — it advances pending timers AND drains
    // microtasks, which the rejected promise needs to flow through the
    // catch + finally + setError chain. Plain `advanceTimersByTime`
    // does not yield to microtasks, so the test would otherwise hang.
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe('boom');

    // Per the docstring: failed save does NOT roll back. The user
    // keeps their text and can paste / retry.
    expect(result.current.value).toBe('attempted');
    expect(result.current.isDirty).toBe(true);
  });

  test('non-Error rejection is normalised to Error so consumers can read .message safely', async () => {
    // Some APIs reject with strings or plain objects. The hook used
    // to store `unknown` and consumers cast unsafely; now we wrap
    // non-Error rejections in `new Error(String(...))`.
    const onSave = vi.fn().mockRejectedValue('plain string error');
    const { result } = renderHook(() =>
      useInlineEdit<string>({ initialValue: 'hello', onSave }),
    );

    act(() => result.current.setValue('attempted'));

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe('plain string error');
  });
});

describe('useInlineEdit — optimistic writer refuses (sk-425)', () => {
  // The card's PATCH writes the typed text into the cache BEFORE the
  // request (initialValue old → typed) and rolls it back on refusal
  // (typed → old), then rejects. Neither step is a server push the user
  // should lose their draft to.
  test('optimistic echo then rollback, then rejection: the draft stays, dirty, with the error', async () => {
    let reject: (e: Error) => void = () => {};
    const onSave = vi.fn(
      () =>
        new Promise<void>((_res, rej) => {
          reject = rej;
        }),
    );
    const { result, rerender } = renderHook(
      (props: { v: string }) => useInlineEdit<string>({ initialValue: props.v, onSave }),
      { initialProps: { v: 'server' } },
    );

    act(() => result.current.setValue('typed'));
    act(() => result.current.onBlur());
    expect(onSave).toHaveBeenCalledWith('typed');

    act(() => rerender({ v: 'typed' })); // optimistic write
    expect(result.current.isDirty).toBe(true); // not confirmed yet
    act(() => rerender({ v: 'server' })); // rollback
    expect(result.current.value).toBe('typed');

    await act(async () => {
      reject(new Error('locked'));
      await Promise.resolve();
    });

    expect(result.current.value).toBe('typed');
    expect(result.current.isDirty).toBe(true);
    expect(result.current.error?.message).toBe('locked');
  });

  test('retry re-sends the kept draft; a success makes it the clean baseline', async () => {
    const onSave = vi.fn().mockRejectedValueOnce(new Error('locked')).mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useInlineEdit<string>({ initialValue: 'server', onSave }),
    );
    act(() => result.current.setValue('typed'));
    await act(async () => {
      result.current.onBlur();
      await vi.runAllTimersAsync();
    });
    expect(result.current.error?.message).toBe('locked');

    await act(async () => {
      result.current.retry();
      await vi.runAllTimersAsync();
    });

    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave).toHaveBeenLastCalledWith('typed');
    expect(result.current.error).toBeNull();
    expect(result.current.isDirty).toBe(false);
    expect(result.current.value).toBe('typed');
  });
});

describe('useInlineEdit — fast-typing flush race', () => {
  /**
   * Regression: a user typing fast enough to trigger a debounce
   * flush while a previous onSave is still in flight used to fire
   * two parallel saves. If they resolved out of order, lastSaved
   * was committed against a stale value and the input showed
   * "unsaved" forever on a value the server already accepted.
   *
   * The hook now serialises flushes via `inFlightRef` + a pending
   * re-flush flag — only one onSave is in flight at a time, and
   * the latest value wins.
   */
  test('overlapping flushes serialise; latest value wins', async () => {
    let resolveFirst: (() => void) | null = null;
    const onSave = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockImplementationOnce(() => Promise.resolve());

    const { result } = renderHook(() =>
      useInlineEdit<string>({ initialValue: 'hello', onSave }),
    );

    // First debounce flush kicks off and stays in-flight (we hold
    // the resolve handle).
    act(() => result.current.setValue('first'));
    await act(async () => {
      vi.advanceTimersByTime(2000);
      await Promise.resolve();
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith('first');

    // While first flush is still pending, the user types more and
    // the next debounce timer fires.
    act(() => result.current.setValue('second'));
    await act(async () => {
      vi.advanceTimersByTime(2000);
      await Promise.resolve();
    });

    // Crucially: the in-flight first flush blocks the parallel
    // second save. onSave is still only at 1 invocation.
    expect(onSave).toHaveBeenCalledTimes(1);

    // First flush resolves; the queued re-flush fires with the
    // latest value.
    await act(async () => {
      resolveFirst?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave).toHaveBeenLastCalledWith('second');
    // After the second resolves, isDirty must flip clean against
    // the latest value.
    expect(result.current.isDirty).toBe(false);
  });
});
