/**
 * sk-36 F1 — `useTreeDepTypes` hook tests.
 *
 * Covers:
 *   - default = Set(['parent-child']) when storage empty
 *   - read from storage (sorted JSON array)
 *   - setter normalises to enforce `parent-child` membership
 *   - per-project key isolation
 *   - cross-project storage key
 *   - corrupt storage → fallback to default
 */

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { DepType } from '../../api/dependencies';
import { useTreeDepTypes } from '../useTreeDepTypes';

const KEY = (p: string | null) =>
  `skein.tasks.tree.${p ?? '__cross__'}.depTypes`;

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  window.localStorage.clear();
});

describe('useTreeDepTypes', () => {
  test('default state contains only parent-child when storage empty', () => {
    const { result } = renderHook(() => useTreeDepTypes('proj-a'));
    const [state] = result.current;
    expect([...state].sort()).toEqual(['parent-child']);
  });

  test('reads persisted set from localStorage on mount', () => {
    window.localStorage.setItem(
      KEY('proj-a'),
      JSON.stringify(['blocks', 'parent-child']),
    );
    const { result } = renderHook(() => useTreeDepTypes('proj-a'));
    const [state] = result.current;
    expect([...state].sort()).toEqual(['blocks', 'parent-child']);
  });

  test('setter always enforces parent-child membership', () => {
    const { result } = renderHook(() => useTreeDepTypes('proj-a'));
    // Caller passes an explicit set that LACKS parent-child — the
    // hook must merge it back in.
    act(() => {
      const [, set] = result.current;
      set(new Set<DepType>(['blocks', 'related']));
    });
    const [state] = result.current;
    expect(state.has('parent-child')).toBe(true);
    expect(state.has('blocks')).toBe(true);
    expect(state.has('related')).toBe(true);
  });

  test('setter persists to localStorage with sorted JSON', () => {
    const { result } = renderHook(() => useTreeDepTypes('proj-a'));
    act(() => {
      const [, set] = result.current;
      set(new Set<DepType>(['blocks', 'parent-child']));
    });
    const raw = window.localStorage.getItem(KEY('proj-a'));
    expect(raw).toBe(JSON.stringify(['blocks', 'parent-child']));
  });

  test('re-reads storage when project handle changes', () => {
    window.localStorage.setItem(
      KEY('proj-a'),
      JSON.stringify(['parent-child', 'related']),
    );
    window.localStorage.setItem(
      KEY('proj-b'),
      JSON.stringify(['blocks', 'parent-child']),
    );
    const { result, rerender } = renderHook(
      ({ p }: { p: string | null }) => useTreeDepTypes(p),
      { initialProps: { p: 'proj-a' as string | null } },
    );
    let [state] = result.current;
    expect([...state].sort()).toEqual(['parent-child', 'related']);
    rerender({ p: 'proj-b' });
    [state] = result.current;
    expect([...state].sort()).toEqual(['blocks', 'parent-child']);
  });

  test('cross-project (project=null) uses __cross__ key', () => {
    window.localStorage.setItem(
      KEY(null),
      JSON.stringify(['parent-child', 'supersedes']),
    );
    const { result } = renderHook(() => useTreeDepTypes(null));
    const [state] = result.current;
    expect([...state].sort()).toEqual(['parent-child', 'supersedes']);
  });

  test('corrupt storage falls back to default set', () => {
    window.localStorage.setItem(KEY('proj-a'), '{not-json');
    const { result } = renderHook(() => useTreeDepTypes('proj-a'));
    const [state] = result.current;
    expect([...state].sort()).toEqual(['parent-child']);
  });

  test('storage with non-array value falls back to default', () => {
    window.localStorage.setItem(
      KEY('proj-a'),
      JSON.stringify({ blocks: true }),
    );
    const { result } = renderHook(() => useTreeDepTypes('proj-a'));
    const [state] = result.current;
    expect([...state].sort()).toEqual(['parent-child']);
  });
});
