import { describe, expect, test } from 'vitest';
import { compareHierarchicalId } from '../hierIdCompare';

describe('compareHierarchicalId', () => {
  test('equal ids return 0', () => {
    expect(compareHierarchicalId('acm-1', 'acm-1')).toBe(0);
    expect(compareHierarchicalId('acm-1.2', 'acm-1.2')).toBe(0);
  });

  test('numeric segments compared as numbers, not strings', () => {
    expect(compareHierarchicalId('acm-1.2', 'acm-1.10')).toBeLessThan(0);
    expect(compareHierarchicalId('acm-1.10', 'acm-1.2')).toBeGreaterThan(0);
    expect(compareHierarchicalId('acm-2', 'acm-10')).toBeLessThan(0);
  });

  test('shorter id wins when all common segments equal', () => {
    expect(compareHierarchicalId('acm-1', 'acm-1.1')).toBeLessThan(0);
    expect(compareHierarchicalId('acm-1.1', 'acm-1')).toBeGreaterThan(0);
  });

  test('different projects compared lexicographically by prefix', () => {
    expect(compareHierarchicalId('acm-1', 'demo-1')).toBeLessThan(0);
    expect(compareHierarchicalId('demo-1', 'acm-99')).toBeGreaterThan(0);
  });

  test('sort produces natural order on a realistic sibling set', () => {
    const ids = [
      'acm-1.10',
      'acm-1.2',
      'acm-1.1',
      'acm-2',
      'acm-1',
      'acm-1.3',
    ];
    ids.sort(compareHierarchicalId);
    expect(ids).toEqual([
      'acm-1',
      'acm-1.1',
      'acm-1.2',
      'acm-1.3',
      'acm-1.10',
      'acm-2',
    ]);
  });

  test('deeper hierarchies sort correctly', () => {
    expect(compareHierarchicalId('acm-1.2.3', 'acm-1.2.10')).toBeLessThan(0);
    expect(compareHierarchicalId('acm-1.2', 'acm-1.2.1')).toBeLessThan(0);
  });

  test('non-numeric segments fall back to lex compare', () => {
    expect(compareHierarchicalId('foo-bar', 'foo-baz')).toBeLessThan(0);
  });
});

// REFERENCE ORDER (the "Reference id sample" appendix). Exactly the same literal list is pinned by
// the server half — internal/issues/idorder_test.go, idOrderReference.
// The list is NOT derived from the implementation: a test that checks the implementation against itself
// would agree with any of its errors. The match of the TWO literals is SC-004.
const idOrderReference = [
  'sk-1--2',
  'sk-2',
  'sk-2-1',
  'sk-2.1',
  'sk-2.2',
  'sk-2.10',
  'sk-2.',
  'sk-002',
  'sk-10',
  'sk-42',
  'sk-00000000000000000000042',
  'sk-123456',
  'sk--1',
  'sk-42x',
  'sk-x42',
];

/** Deterministic permutations of the input: the result may not depend on them. */
function permute(src: readonly string[], kind: number): string[] {
  const out = [...src];
  switch (kind) {
    case 0:
      return out;
    case 1:
      return out.reverse();
    case 2:
      // Byte order is certainly NOT the target one: if the sort
      // keeps it, the comparator did not work.
      return out.sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
    default: {
      const even = out.filter((_, i) => i % 2 === 0);
      const odd = out.filter((_, i) => i % 2 === 1);
      return [...even, ...odd];
    }
  }
}

describe('id order rule (US-6) — check against the reference', () => {
  test('any permutation of the input gives the reference order', () => {
    for (let kind = 0; kind < 4; kind++) {
      const got = permute(idOrderReference, kind);
      got.sort(compareHierarchicalId);
      expect(got, `permutation ${kind}`).toEqual(idOrderReference);
    }
  });

  test('strict total order: different ids are never equal', () => {
    for (let i = 0; i < idOrderReference.length; i++) {
      for (let j = 0; j < idOrderReference.length; j++) {
        const x = idOrderReference[i];
        const y = idOrderReference[j];
        const c = compareHierarchicalId(x, y);
        if (i === j) {
          expect(c, `${x} with itself`).toBe(0);
        } else if (i < j) {
          expect(c, `${x} before ${y}`).toBeLessThan(0);
          expect(compareHierarchicalId(y, x), `${y} after ${x}`).toBeGreaterThan(0);
        }
      }
    }
  });

  test('transitivity on all ordered triples', () => {
    const n = idOrderReference.length;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        for (let k = j + 1; k < n; k++) {
          const x = idOrderReference[i];
          const y = idOrderReference[j];
          const z = idOrderReference[k];
          expect(compareHierarchicalId(x, y)).toBeLessThan(0);
          expect(compareHierarchicalId(y, z)).toBeLessThan(0);
          expect(compareHierarchicalId(x, z), `${x} < ${y} < ${z}`).toBeLessThan(0);
        }
      }
    }
  });

  test('the three divergences of the former comparator are closed by name', () => {
    // Leading zeros: DIFFERENT ids that used to give 0.
    expect(compareHierarchicalId('sk-2', 'sk-002')).toBeLessThan(0);
    expect(compareHierarchicalId('sk-002', 'sk-2')).toBeGreaterThan(0);
    // A digit segment longer than the machine number precision (F-15).
    expect(
      compareHierarchicalId('sk-90071992547409910', 'sk-90071992547409911'),
    ).toBeLessThan(0);
    // An empty non-digit segment → goes AFTER the digit one (item 4).
    expect(compareHierarchicalId('sk-2', 'sk--1')).toBeLessThan(0);
    // Item 7: they differ only in separators — not equal.
    expect(compareHierarchicalId('sk-1-2', 'sk-1.2')).not.toBe(0);
  });
});
