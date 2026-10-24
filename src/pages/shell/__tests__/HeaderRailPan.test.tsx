/**
 * sk-285.7.2.76 — audit 2B §4.1, findings W-1 (A + C) and W-2 (A).
 *
 * One cause, one repair, two symptoms. The header's control rail pans in
 * tablet and said nothing about it. Measured in Chromium at 768, at rest:
 *
 *   .header-controls   clientWidth 498   scrollWidth 712   hidden 214
 *   past the right edge: HOT ZONE, Inspect, EN, the ACCOUNT MENU
 *   scrollbarWidth "none" · mask-image "none" · background-image "none"
 *
 * — W-1, and the account menu is the only route to Logout, the settings
 * and the theme. At 900 the same clip lands inside a control:
 * `.header-lang-code` spans 885.5…901.3 against innerWidth 900, so «EN»
 * is guillotined 1.3px into the glyph — W-2.
 *
 * ── The claims, and where they live ─────────────────────────────────
 *
 *   1. the ARITHMETIC — `src/lib/__tests__/useScrollEdges.test.tsx`,
 *      with the metrics jsdom does not compute supplied per element;
 *   2. the WIRING — here, on a rendered header: the rail carries the
 *      attributes when the metrics say so and carries neither when they
 *      do not.
 *
 * The fade the attributes switch on is paint and is not checked by
 * tests (sk-540.11, owner decision).
 *
 * The negative half of (2) is the one that matters most: a fade that is
 * always on would satisfy every "is there a fade" assertion and would be
 * a lie at every width where the rail fits — which is the whole desktop
 * range and the top third of the tablet band.
 */

import type { ReactNode } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { setViewportWidth } from '../../../test/viewport';
import { LayoutProvider } from '../../../lib/useLayoutState';
import { TasksUiStateProvider } from '../../../lib/useTasksUiState';

// ─────────────────────────── Mocks ───────────────────────────

vi.mock('../../../auth/AuthContext', () => ({
  useAuthOptional: () => null,
  useAuth: () => ({
    user: {
      id: 'u-1',
      email: 'admin@test.com',
      username: 'admin',
      name: 'Admin',
      role: 'admin',
      createdAt: null,
      lastLoginAt: null,
    },
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

vi.mock('../../../lib/useNotificationCounts', () => ({
  notificationCountsKey: ['notification-counts'] as const,
  useNotificationCounts: () => ({
    counts: {
      inbox: 0,
      outbox: 0,
      mentions: 0,
      watching: 0,
      onMeOpenCount: 0,
      delegatedOpenCount: 0,
    },
    isLoading: false,
    error: null,
  }),
}));

import { HeaderBar } from '../HeaderBar';

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return (
    <MantineProvider forceColorScheme="dark">
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/']}>
          <LayoutProvider>
            <TasksUiStateProvider>{children}</TasksUiStateProvider>
          </LayoutProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>
  );
}

/**
 * jsdom computes no layout, so every element reports 0 for the three
 * metrics the hook reads. `.header-controls` gets the numbers a real
 * tablet produces; everything else keeps jsdom's honest zeros, so a
 * fade appearing anywhere else would be visible as a failure rather
 * than hidden by a blanket stub.
 */
function stubRailMetrics(scrollWidth: number, clientWidth: number, scrollLeft = 0): void {
  const railOnly =
    (metric: number) =>
    function (this: HTMLElement): number {
      return this.classList.contains('header-controls') ? metric : 0;
    };
  for (const [name, value] of [
    ['scrollWidth', scrollWidth],
    ['clientWidth', clientWidth],
    ['scrollLeft', scrollLeft],
  ] as const) {
    Object.defineProperty(HTMLElement.prototype, name, {
      configurable: true,
      get: railOnly(value),
    });
  }
}

function unstubRailMetrics(): void {
  for (const name of ['scrollWidth', 'clientWidth', 'scrollLeft']) {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
  }
}

function rail(): HTMLElement | null {
  return document.querySelector('.header-controls');
}

describe('W-1 — the rail publishes what it is hiding', () => {
  afterEach(() => {
    cleanup();
    unstubRailMetrics();
  });

  test('nothing hidden: NEITHER attribute — the fade must not lie at widths that fit', () => {
    // The negative claim, first, because it is the one a hardcoded
    // attribute would fail. Measured in Chromium: hidden is 0 at 1000,
    // 1024, 1100, 1283 and on every desktop window.
    setViewportWidth(1440);
    stubRailMetrics(981, 981);
    render(
      <Wrapper>
        <HeaderBar />
      </Wrapper>,
    );
    expect(rail()).not.toBeNull();
    expect(rail()!.getAttribute('data-pan-end')).toBeNull();
    expect(rail()!.getAttribute('data-pan-start')).toBeNull();
  });

  test('214px hidden to the right, at rest: the END edge is marked', () => {
    // The numbers are the tablet rail's own at 768.
    setViewportWidth(768);
    stubRailMetrics(712, 498);
    render(
      <Wrapper>
        <HeaderBar />
      </Wrapper>,
    );
    expect(rail()!.getAttribute('data-pan-end')).toBe('true');
    expect(rail()!.getAttribute('data-pan-start')).toBeNull();
  });

  test('panned to the far end: the mark moves to the START edge', () => {
    // Which is what happens the moment a keyboard user tabs to the
    // account button — the browser scrolls it into view. Measured live:
    // scrollLeft 0 → 214 and the button lands at 709.4…753.4, fully
    // inside the window.
    setViewportWidth(768);
    stubRailMetrics(712, 498, 214);
    render(
      <Wrapper>
        <HeaderBar />
      </Wrapper>,
    );
    expect(rail()!.getAttribute('data-pan-start')).toBe('true');
    expect(rail()!.getAttribute('data-pan-end')).toBeNull();
  });

  test('the attribute is written only when true, never as "false"', () => {
    // `[data-pan-end]` matches a bare attribute, so `"false"` would
    // switch the fade ON. Pinned because the failure is silent: the
    // markup would read as correct and paint the opposite.
    setViewportWidth(1440);
    stubRailMetrics(981, 981);
    render(
      <Wrapper>
        <HeaderBar />
      </Wrapper>,
    );
    expect(rail()!.hasAttribute('data-pan-end')).toBe(false);
    expect(rail()!.hasAttribute('data-pan-start')).toBe(false);
  });
});
