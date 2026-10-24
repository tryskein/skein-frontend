/**
 * sk-421.3 T04 — `useEpicSectionGrouping` (US-2, R-3, SC-004, A1).
 *
 * Repeats BY NAME all eight cases of the model (`useEpicSectionMode`) and
 * adds a ninth — the default. It repeats deliberately rather than referring to
 * the model's test: there are two settings, and the proof that the second behaves
 * the same way must exist separately from the proof about the first —
 * otherwise "the common mechanism was extracted" is checked from one side only.
 *
 * The key is assembled ANEW here, not imported from the module: a test
 * that took the key from the implementation would agree with any change of it — and silently
 * stop checking what it was written for (per-user isolation).
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useEpicSectionGrouping } from '../useEpicSectionGrouping';

const KEY = (userId: string) => `skein.epic.sectionGrouping.${userId}`;

const ALICE = 'u-alice';
const BOB = 'u-bob';

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('useEpicSectionGrouping', () => {
  test('P-11 — by default grouping is ON (A1)', () => {
    // A difference from the model, where the default is "List". Here a setting
    // the user has not touched shows children by category.
    const { result } = renderHook(() => useEpicSectionGrouping(ALICE));
    expect(result.current[0]).toBe('on');
    // …and the default does not count as a choice: nothing goes to disk.
    expect(window.localStorage.getItem(KEY(ALICE))).toBeNull();
  });

  test('P-12 — the choice survives a reload: a new mount reads the storage', () => {
    const first = renderHook(() => useEpicSectionGrouping(ALICE));
    act(() => first.result.current[1]('off'));
    expect(first.result.current[0]).toBe('off');
    expect(window.localStorage.getItem(KEY(ALICE))).toBe('off');

    // A tab reload = the hook mounts anew on top of the same storage.
    first.unmount();
    const second = renderHook(() => useEpicSectionGrouping(ALICE));
    expect(second.result.current[0]).toBe('off');
  });

  test('P-13 — one user\'s choice does not go to another in the same browser', () => {
    const alice = renderHook(() => useEpicSectionGrouping(ALICE));
    act(() => alice.result.current[1]('off'));
    alice.unmount();

    const bob = renderHook(() => useEpicSectionGrouping(BOB));
    // Bob has his own default, not Alice's choice.
    expect(bob.result.current[0]).toBe('on');
    // …and Alice's choice is intact: each has their own key.
    expect(window.localStorage.getItem(KEY(ALICE))).toBe('off');
    expect(window.localStorage.getItem(KEY(BOB))).toBeNull();
  });

  test('P-14 — a user change on a live hook rereads its own key', () => {
    window.localStorage.setItem(KEY(ALICE), 'off');
    window.localStorage.setItem(KEY(BOB), 'on');

    const { result, rerender } = renderHook(
      ({ user }: { user: string }) => useEpicSectionGrouping(user),
      { initialProps: { user: ALICE } },
    );
    expect(result.current[0]).toBe('off');

    rerender({ user: BOB });
    expect(result.current[0]).toBe('on');
  });

  test('P-15 — a write from another tab does NOT redraw the open tab', () => {
    const { result } = renderHook(() => useEpicSectionGrouping(ALICE));
    expect(result.current[0]).toBe('on');

    // The other tab turned grouping off and broadcast a storage event.
    act(() => {
      window.localStorage.setItem(KEY(ALICE), 'off');
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: KEY(ALICE),
          newValue: 'off',
          storageArea: window.localStorage,
        }),
      );
    });

    // This tab stays as it was until a reload — the acceptance
    // requires so. There is NO `storage` subscription in the mechanism, DELIBERATELY.
    expect(result.current[0]).toBe('on');
  });

  test('P-16 — an unknown value in the storage is read as the default', () => {
    window.localStorage.setItem(KEY(ALICE), 'by-assignee');
    const { result } = renderHook(() => useEpicSectionGrouping(ALICE));
    expect(result.current[0]).toBe('on');
  });

  test('P-17 — no user: the default, and nothing is written to the storage', () => {
    // Coercing null to an empty string is not allowed: it would produce ONE shared slot
    // for everyone, i.e. exactly the leak of the choice between accounts
    // for which the key was keyed by identifier.
    const { result } = renderHook(() => useEpicSectionGrouping(null));
    expect(result.current[0]).toBe('on');

    act(() => result.current[1]('off'));
    // In the consumer's memory the choice lives…
    expect(result.current[0]).toBe('off');
    // …but nothing appears on disk: neither under an empty key nor under
    // any other.
    expect(window.localStorage.length).toBe(0);
  });

  test('P-18 — unavailable storage: the default, the tab does not crash', () => {
    // A failure of ACCESS itself is needed, not corrupt content: private mode
    // and a site block make the getter THROW, not return null.
    const getItem = vi
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation(() => {
        throw new Error('storage denied');
      });
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('storage denied');
      });

    const { result } = renderHook(() => useEpicSectionGrouping(ALICE));
    expect(result.current[0]).toBe('on');

    // And the toggle does not crash the tab: the choice lives in memory.
    expect(() => act(() => result.current[1]('off'))).not.toThrow();
    expect(result.current[0]).toBe('off');

    expect(getItem).toHaveBeenCalled();
    expect(setItem).toHaveBeenCalled();
  });

  test('P-19 — the write succeeded: the next STORAGE READ gives the saved value', () => {
    // What is checked is exactly the storage read, not the live hook memory:
    // the US-2 acceptance "the write succeeded" speaks of a new tab,
    // a reload and a repeated mount.
    const first = renderHook(() => useEpicSectionGrouping(ALICE));
    act(() => first.result.current[1]('off'));
    first.unmount();

    expect(window.localStorage.getItem(KEY(ALICE))).toBe('off');
    const second = renderHook(() => useEpicSectionGrouping(ALICE));
    expect(second.result.current[0]).toBe('off');
  });

  /**
   * sk-421.3 T20 (F-11) — the DISTINGUISHING memory case that was missing.
   *
   * A finding of the critique: four acceptance cases were reduced to two failures at once.
   * P-18 fails BOTH the read AND the write at the same time, and on such an input
   * "the default" is the right answer for TWO independent reasons: there is nothing
   * to read and nowhere to write. Having passed it, the mechanism proved nothing about
   * the case the acceptance names separately: the read succeeded, but the write
   * failed.
   *
   * Here it is exactly that. The storage returns the OLD value, the write throws:
   *
   *   · the new choice lives while the consumer is mounted continuously;
   *   · a repeated read (a new mount) returns the OLD value,
   *     NOT the default — nothing changed on disk, and the mechanism has no right to
   *     invent a default where a meaningful choice lies.
   *
   * The second half is why the case is separated: on the P-18 input it is
   * indistinguishable from the first, because there is simply no old value there.
   */
  test('F-11 — the read succeeded, ONLY the write failed: the choice lives until unmount, then the OLD one is read', () => {
    // The old choice lies on disk and is read normally.
    window.localStorage.setItem(KEY(ALICE), 'off');

    const first = renderHook(() => useEpicSectionGrouping(ALICE));
    expect(first.result.current[0], 'the old value was not read').toBe('off');

    // ONLY the write fails — the read keeps working. That is the
    // difference from P-18, where both ends are broken at once.
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('quota exceeded');
      });

    expect(() => act(() => first.result.current[1]('on'))).not.toThrow();
    // The choice is in effect while the consumer is alive.
    expect(first.result.current[0], 'the unsaved choice is not in effect').toBe('on');
    expect(setItem).toHaveBeenCalled();

    // …and it did not reach the disk: the old value is still there.
    setItem.mockRestore();
    expect(window.localStorage.getItem(KEY(ALICE))).toBe('off');

    // The life boundary: unmount. A new mount reads the disk.
    first.unmount();
    const second = renderHook(() => useEpicSectionGrouping(ALICE));
    expect(
      second.result.current[0],
      'after unmount something other than the old value came back',
    ).toBe('off');
  });

  test('F-11 — on the P-18 input this case is indistinguishable: there is no old value at all', () => {
    // Proof that the previous test checks NOT THE SAME THING.
    // Break both ends — and "the default" is right for two reasons at once,
    // so the answer does not say which of them fired. Here this is
    // recorded: with a broken read the old value is unreachable,
    // and "returned the saved one" cannot be told from "returned the default".
    window.localStorage.setItem(KEY(ALICE), 'off');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage denied');
    });

    const { result } = renderHook(() => useEpicSectionGrouping(ALICE));
    // The default — and it COINCIDES with what the broken path would return,
    // and does NOT coincide with the 'off' lying on disk. So the P-18 input says
    // nothing about the saved value.
    expect(result.current[0]).toBe('on');
    expect(result.current[0]).not.toBe('off');
  });
});
