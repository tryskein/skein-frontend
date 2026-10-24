/**
 * sk-285.7.2.61 — audit 2B, finding HZ2B-4: the race chart's Y axis
 * skipped a division.
 *
 * Measured live before the fix (Chromium 151, 1440×900, /activity): the
 * axis carried five labels — 5 4 3 1 0 at y = 28, 96, 164, 300, 368 —
 * with the slot at y = 232 empty while the scale ran straight through
 * it. §6 asks for a "20% grid" and the artboard `2a` draws six labels
 * (5 4 3 2 1 0); a reader counting rows off that grid read every value
 * above 1 one row too low.
 *
 * The cause was arithmetic, not layout: the axis was cut into FOUR
 * intervals and each division then rounded to an integer, so at
 * yMax = 5 the divisions were `Math.round` of 0, 1.25, 2.5, 3.75, 5.
 * Rounding a step is what makes a division disappear (2.5 → 3, next to
 * 3.75 → 4) and what could equally print one twice.
 *
 * Two levels are claimed here, because the defect could return at
 * either:
 *   • the pure function, over every maximum the chart can produce —
 *     no skips, no repeats, all integers, and a fifth of the axis
 *     wherever the axis divides by five;
 *   • the RENDERED axis, because a correct list of numbers still has
 *     to reach the <text> nodes, at evenly spaced y.
 */

import { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../api/dashboard', async () => {
  const actual = await vi.importActual<typeof import('../../api/dashboard')>('../../api/dashboard');
  return { ...actual, getDashboardRace: vi.fn() };
});

import { getDashboardRace, type RaceResult } from '../../api/dashboard';
import { RaceChart, yTickValues } from './RaceChart';

const mockedRace = vi.mocked(getDashboardRace);

function Wrap({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <MantineProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/activity']}>{children}</MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>
  );
}

/**
 * A series whose highest cumulative is 4 — which is the case the audit
 * caught. `buildGeometry` pads by 8% and rounds up (`niceMax`), so 4
 * becomes an axis of 5: the exact maximum on which the old step was
 * 1.25.
 */
function resultPeaking(at: number): RaceResult {
  const days = ['2026-04-24', '2026-04-25', '2026-04-26', '2026-04-27', '2026-04-28'];
  const ramp = (top: number) =>
    days.map((d, i) => ({
      day: `${d}T00:00:00Z`,
      cumulative: Math.round((top * i) / (days.length - 1)),
    }));
  return {
    metric: 'closed',
    window: '30d',
    effectiveStart: '2026-04-24T00:00:00Z',
    effectiveEnd: '2026-04-28T00:00:00Z',
    isColdStart: false,
    users: [{ userId: 'u-1', username: 'tester', total: at, points: ramp(at) }],
    others: { userCount: 0, total: 0, points: ramp(0) },
  };
}

describe('HZ2B-4 — the axis divisions are whole and evenly spaced', () => {
  test('a fifth of the axis wherever the axis divides by five', () => {
    // Every value `niceMax` returns from 5 upward is a multiple of 5
    // (5, 10, 20, 50, 100, 200, 500, 1000 …), so this is the normal
    // case rather than a lucky one.
    for (const yMax of [5, 10, 20, 50, 100, 200, 500, 1000]) {
      const ticks = yTickValues(yMax);
      expect(ticks, `yMax=${yMax}`).toHaveLength(6);
      expect(ticks[0]).toBe(0);
      expect(ticks[5]).toBe(yMax);
      expect(ticks[1] - ticks[0]).toBe(yMax / 5);
    }
  });

  test('below five the step is one task, and nothing is invented', () => {
    expect(yTickValues(1)).toEqual([0, 1]);
    expect(yTickValues(2)).toEqual([0, 1, 2]);
    expect(yTickValues(3)).toEqual([0, 1, 2, 3]);
    expect(yTickValues(4)).toEqual([0, 1, 2, 3, 4]);
  });

  test('no maximum skips a division, repeats one, or prints a fraction', () => {
    // Every whole axis up to 200, plus the larger values `niceMax` can
    // return. The sweep is what catches a step that only misbehaves on
    // some maxima — which is exactly how the shipped one behaved.
    const maxima = [...Array.from({ length: 200 }, (_, i) => i + 1), 500, 1000, 2000, 5000];
    for (const yMax of maxima) {
      const ticks = yTickValues(yMax);
      const step = ticks[1] - ticks[0];
      expect(new Set(ticks).size, `yMax=${yMax} repeats a division`).toBe(ticks.length);
      for (const [i, v] of ticks.entries()) {
        expect(Number.isInteger(v), `yMax=${yMax} division ${v} is not whole`).toBe(true);
        expect(v, `yMax=${yMax} division ${i} is off the step`).toBe(i * step);
      }
      expect(ticks[ticks.length - 1], `yMax=${yMax} does not reach its own top`).toBe(yMax);
    }
  });
});

describe('HZ2B-4 — the rendered axis carries every division', () => {
  beforeEach(() => {
    mockedRace.mockReset();
  });
  afterEach(() => {
    cleanup();
  });

  test('a series peaking at 4 draws six labels, evenly spaced', async () => {
    mockedRace.mockResolvedValue(resultPeaking(4));
    const { container } = render(
      <Wrap>
        <RaceChart />
      </Wrap>,
    );

    await waitFor(() => {
      expect(container.querySelector('svg.race-chart-svg')).toBeTruthy();
    });

    const labels = [...container.querySelectorAll('text.race-axis-label')]
      // The X axis draws date labels through the same class; the Y
      // divisions are the numeric ones.
      .filter((t) => /^\d+$/.test(t.textContent ?? ''))
      .map((t) => ({ value: Number(t.textContent), y: Number(t.getAttribute('y')) }))
      .sort((a, b) => a.value - b.value);

    expect(labels.map((l) => l.value)).toEqual([0, 1, 2, 3, 4, 5]);

    // Evenly spaced, which is the half the numbers alone do not say:
    // the shipped axis printed 0 1 3 4 5 at a CONSTANT 68px pitch, so
    // the picture claimed a uniform scale it was not drawing.
    const gaps = labels.slice(1).map((l, i) => labels[i].y - l.y);
    for (const gap of gaps) expect(gap).toBeCloseTo(gaps[0], 6);
    expect(gaps[0]).toBeGreaterThan(0);
  });

  test('every division has a gridline of its own', async () => {
    mockedRace.mockResolvedValue(resultPeaking(4));
    const { container } = render(
      <Wrap>
        <RaceChart />
      </Wrap>,
    );
    await waitFor(() => {
      expect(container.querySelector('svg.race-chart-svg')).toBeTruthy();
    });
    expect(container.querySelectorAll('line.race-grid-line')).toHaveLength(6);
  });
});
