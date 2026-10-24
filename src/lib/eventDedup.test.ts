import { describe, expect, test } from 'vitest';
import { EventDedup } from './eventDedup';

describe('EventDedup', () => {
  test('empty dedup — has() returns false for any id', () => {
    const dedup = new EventDedup();
    expect(dedup.has(1)).toBe(false);
    expect(dedup.has(0)).toBe(false);
    expect(dedup.has(Number.MAX_SAFE_INTEGER)).toBe(false);
    expect(dedup.size()).toBe(0);
  });

  test('add then has — true', () => {
    const dedup = new EventDedup();
    dedup.add(42);
    expect(dedup.has(42)).toBe(true);
    expect(dedup.size()).toBe(1);
  });

  test('add is idempotent — re-adding does not change size', () => {
    const dedup = new EventDedup();
    dedup.add(1);
    dedup.add(1);
    dedup.add(1);
    expect(dedup.has(1)).toBe(true);
    expect(dedup.size()).toBe(1);
  });

  test('FIFO eviction at capacity — oldest id is dropped', () => {
    const dedup = new EventDedup(3);
    dedup.add(1);
    dedup.add(2);
    dedup.add(3);
    expect(dedup.size()).toBe(3);

    dedup.add(4);
    // Adding a 4th id must evict id=1 (oldest) before inserting id=4.
    expect(dedup.size()).toBe(3);
    expect(dedup.has(1)).toBe(false);
    expect(dedup.has(2)).toBe(true);
    expect(dedup.has(3)).toBe(true);
    expect(dedup.has(4)).toBe(true);
  });

  test('FIFO eviction continues — multiple evictions in sequence', () => {
    const dedup = new EventDedup(2);
    dedup.add(1);
    dedup.add(2);
    dedup.add(3); // evicts 1
    dedup.add(4); // evicts 2
    expect(dedup.has(1)).toBe(false);
    expect(dedup.has(2)).toBe(false);
    expect(dedup.has(3)).toBe(true);
    expect(dedup.has(4)).toBe(true);
    expect(dedup.size()).toBe(2);
  });

  test('idempotent add does NOT bump position in FIFO order', () => {
    // Critical semantic: re-adding the oldest id must not move it to the
    // newest slot. If it did, we would never evict the oldest entry as
    // long as we keep seeing it in re-deliveries — defeating the bound.
    const dedup = new EventDedup(3);
    dedup.add(1);
    dedup.add(2);
    dedup.add(3);
    dedup.add(1); // re-add: must NOT bump 1 to most-recent.
    dedup.add(4); // adding 4 should still evict 1 (the original oldest).
    expect(dedup.has(1)).toBe(false);
    expect(dedup.has(2)).toBe(true);
    expect(dedup.has(3)).toBe(true);
    expect(dedup.has(4)).toBe(true);
  });

  test('default capacity is 1024', () => {
    const dedup = new EventDedup();
    for (let i = 0; i < 1024; i++) {
      dedup.add(i);
    }
    expect(dedup.size()).toBe(1024);

    dedup.add(1024);
    expect(dedup.size()).toBe(1024);
    expect(dedup.has(0)).toBe(false);
    expect(dedup.has(1)).toBe(true);
    expect(dedup.has(1024)).toBe(true);
  });

  test('rejects non-positive maxSize', () => {
    expect(() => new EventDedup(0)).toThrow();
    expect(() => new EventDedup(-1)).toThrow();
    expect(() => new EventDedup(1.5)).toThrow();
  });
});
