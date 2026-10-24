/**
 * sk-421.2 T016 — `useEpicSectionMode` (US-2, R-6, SC-007).
 *
 * Covers:
 *   - by default "List" when the storage is empty;
 *   - the choice survives a reload (a new mount reads the storage);
 *   - the choice is NOT carried over to another user of the same browser;
 *   - a user change on a live hook rereads its own key;
 *   - a write from another tab does NOT redraw the open tab;
 *   - an unknown value in the storage → "List";
 *   - an unavailable (throwing) storage → "List", without an exception.
 *
 * The key is assembled ANEW here, not imported from the module: a test
 * that took the key from the implementation would agree with any change of it — and silently
 * stop checking what it was written for (per-user isolation).
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useEpicSectionMode } from '../useEpicSectionMode';

const KEY = (userId: string) => `skein.epic.sectionMode.${userId}`;

const ALICE = 'u-alice';
const BOB = 'u-bob';

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('useEpicSectionMode', () => {
  test('by default "List" when the storage is empty', () => {
    const { result } = renderHook(() => useEpicSectionMode(ALICE));
    expect(result.current[0]).toBe('list');
  });

  test('the choice survives a reload: a new mount reads the storage', () => {
    const first = renderHook(() => useEpicSectionMode(ALICE));
    act(() => first.result.current[1]('tree'));
    expect(first.result.current[0]).toBe('tree');
    expect(window.localStorage.getItem(KEY(ALICE))).toBe('tree');

    // A tab reload = the hook mounts anew on top of the same storage.
    first.unmount();
    const second = renderHook(() => useEpicSectionMode(ALICE));
    expect(second.result.current[0]).toBe('tree');
  });

  test('one user\'s choice does not go to another in the same browser', () => {
    const alice = renderHook(() => useEpicSectionMode(ALICE));
    act(() => alice.result.current[1]('tree'));
    alice.unmount();

    const bob = renderHook(() => useEpicSectionMode(BOB));
    expect(bob.result.current[0]).toBe('list');
    // …and Alice's choice is intact: each has their own key.
    expect(window.localStorage.getItem(KEY(ALICE))).toBe('tree');
    expect(window.localStorage.getItem(KEY(BOB))).toBeNull();
  });

  test('a user change on a live hook rereads its own key', () => {
    window.localStorage.setItem(KEY(ALICE), 'tree');
    window.localStorage.setItem(KEY(BOB), 'list');

    const { result, rerender } = renderHook(
      ({ user }: { user: string }) => useEpicSectionMode(user),
      { initialProps: { user: ALICE } },
    );
    expect(result.current[0]).toBe('tree');

    rerender({ user: BOB });
    expect(result.current[0]).toBe('list');
  });

  test('SC-007 — a write from another tab does NOT redraw the open tab', () => {
    const { result } = renderHook(() => useEpicSectionMode(ALICE));
    expect(result.current[0]).toBe('list');

    // The other tab wrote "Tree" and broadcast a storage event.
    act(() => {
      window.localStorage.setItem(KEY(ALICE), 'tree');
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: KEY(ALICE),
          newValue: 'tree',
          storageArea: window.localStorage,
        }),
      );
    });

    // This tab stays in its mode until a reload — the acceptance
    // requires so. There is NO `storage` subscription in the hook, DELIBERATELY.
    expect(result.current[0]).toBe('list');
  });

  test('an unknown value in the storage is read as "List"', () => {
    window.localStorage.setItem(KEY(ALICE), 'kanban');
    const { result } = renderHook(() => useEpicSectionMode(ALICE));
    expect(result.current[0]).toBe('list');
  });

  test('no user — "List", and nothing is written to the storage', () => {
    // sk-421.2 T022 — the section is typed through `useAuth`, whose
    // user is `User | null`. Coercing null to an empty string is not allowed:
    // it would produce ONE shared slot for everyone, i.e. exactly the leak of the
    // choice between accounts for which the key was keyed by
    // identifier.
    const { result } = renderHook(() => useEpicSectionMode(null));
    expect(result.current[0]).toBe('list');

    act(() => result.current[1]('tree'));
    // In the tab's memory the choice lives…
    expect(result.current[0]).toBe('tree');
    // …but nothing appears on disk: neither under an empty key nor under
    // any other.
    expect(window.localStorage.length).toBe(0);
  });

  test('unavailable storage — "List", without an exception', () => {
    // Before this, the repository only faked the storage CONTENT
    // (broken JSON). A failure of access itself is needed here: private mode and
    // a site block make the getter THROW, not return null.
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

    const { result } = renderHook(() => useEpicSectionMode(ALICE));
    expect(result.current[0]).toBe('list');

    // And the toggle does not crash the tab: the choice lives in memory.
    expect(() => act(() => result.current[1]('tree'))).not.toThrow();
    expect(result.current[0]).toBe('tree');

    expect(getItem).toHaveBeenCalled();
    expect(setItem).toHaveBeenCalled();
  });
});
