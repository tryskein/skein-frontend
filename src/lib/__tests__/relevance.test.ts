import { describe, expect, test } from 'vitest';
import {
  RELEVANCE_MAX,
  relevanceBar,
  relevanceOpacity,
  relevancePercent,
} from '../relevance';

describe('relevancePercent — absolute calibration (sk-53)', () => {
  test('score at/above the RRF ceiling → clamped 100%', () => {
    expect(relevancePercent(RELEVANCE_MAX)).toBe(100);
    expect(relevancePercent(RELEVANCE_MAX * 3)).toBe(100);
    expect(relevancePercent(0.05)).toBe(100);
  });

  test('weak semantic score is NOT 100% — the alpha-24 anti-regression', () => {
    // A weak neighbour (~0.015) must read honestly low, NOT painted as a
    // perfect match the way relative-to-top normalisation would.
    const pct = relevancePercent(0.015);
    expect(pct).toBeGreaterThan(30);
    expect(pct).toBeLessThan(60);
  });

  test('strong literal match (~0.030) → high', () => {
    expect(relevancePercent(0.03)).toBeGreaterThanOrEqual(85);
  });

  test('noise (<0.008) → low', () => {
    expect(relevancePercent(0.005)).toBeLessThan(20);
  });

  test('non-positive / non-finite → 0', () => {
    expect(relevancePercent(0)).toBe(0);
    expect(relevancePercent(-0.5)).toBe(0);
    expect(relevancePercent(Number.NaN)).toBe(0);
    expect(relevancePercent(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('relevanceBar', () => {
  test('full / empty / half at default width 6', () => {
    expect(relevanceBar(100)).toBe('██████');
    expect(relevanceBar(0)).toBe('░░░░░░');
    expect(relevanceBar(50)).toBe('███░░░');
  });
  test('clamps out-of-range percent', () => {
    expect(relevanceBar(150)).toBe('██████');
    expect(relevanceBar(-10)).toBe('░░░░░░');
  });
  test('honours custom width', () => {
    expect(relevanceBar(100, 3)).toBe('███');
    expect(relevanceBar(0, 3)).toBe('░░░');
  });
});

describe('relevanceOpacity', () => {
  test('floor at low %, full at high %', () => {
    expect(relevanceOpacity(0)).toBeCloseTo(0.45);
    expect(relevanceOpacity(100)).toBeCloseTo(1.0);
    expect(relevanceOpacity(50)).toBeCloseTo(0.725);
  });
  test('clamps out-of-range', () => {
    expect(relevanceOpacity(-20)).toBeCloseTo(0.45);
    expect(relevanceOpacity(200)).toBeCloseTo(1.0);
  });
});
