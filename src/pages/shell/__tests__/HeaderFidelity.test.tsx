/**
 * sk-285.7.8 — the header rail against `design/fable`: the parts of the
 * audit a render can see.
 *
 * The pixel audit measured eighteen places where the shipped chrome and
 * the approved artboards disagreed. Most were single declarations
 * (tokens, weights, plates); those are not checked by tests (sk-540.11,
 * owner decision: what a person sees is not asserted from the
 * stylesheet). What stays is markup: how many dividers the rail draws,
 * and the accessible names of the view-switch members.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MantineProvider } from '@mantine/core';

// ═══════════════════ 7. The rendered half ═════════════════════════════

vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u-1', username: 'admin', role: 'admin' },
    logout: vi.fn(async () => {}),
  }),
}));
vi.mock('../../../lib/useLayoutState', () => ({
  useLayoutState: () => ({
    outboxMode: false,
    toggleOutboxMode: vi.fn(),
    onMeMode: false,
    toggleOnMeMode: vi.fn(),
    budilnikMode: false,
    toggleBudilnikMode: vi.fn(),
    inboxCollapsed: false,
    inboxTab: 'inbox' as const,
    setInboxCollapsed: vi.fn(),
    setInboxTab: vi.fn(),
    setActiveZone: vi.fn(),
  }),
  // sk-303.14 — `TasksUiStateProvider` reads the layout through the OPTIONAL
  // accessor so it can be mounted with no provider above it, and a module
  // mock has to carry that export too or the provider throws on the missing
  // name before a single assertion runs. `null` is the honest answer: this
  // file mocks the layout wholesale, so there is no context to hand back.
  useOptionalLayoutState: () => null,
}));
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn() };
});
vi.mock('../../../lib/useReminders', () => ({ useRingingTaskCount: () => 0, useRingEpoch: () => 0 }));
vi.mock('../../../lib/useNotificationCounts', () => ({
  notificationCountsKey: ['notification-counts'] as const,
  useNotificationCounts: () => ({
    counts: {
      inbox: 7,
      outbox: 3,
      mentions: 2,
      watching: 5,
      onMeOpenCount: 4,
      delegatedOpenCount: 6,
    },
    isLoading: false,
    error: null,
  }),
}));
vi.mock('../../../components/Toaster', () => ({
  useToaster: () => ({ error: vi.fn(), success: vi.fn() }),
}));
vi.mock('../../../lib/useInspectMode', () => ({
  useInspectMode: () => ({ enabled: false, enable: vi.fn(), disable: vi.fn(), toggle: vi.fn() }),
}));
vi.mock('../../../components/VersionCheck', () => ({ AppVersionBadge: () => null }));
vi.mock('../../../components/ThemeToggle', () => ({ ThemeToggle: () => null }));

// eslint-disable-next-line import/first
import { HeaderBar } from '../HeaderBar';
// eslint-disable-next-line import/first
import { TasksUiStateProvider } from '../../../lib/useTasksUiState';
// eslint-disable-next-line import/first
import { setViewportWidth } from '../../../test/viewport';

function renderHeader() {
  return render(
    <MantineProvider>
      <MemoryRouter initialEntries={['/']}>
        <TasksUiStateProvider>
          <HeaderBar />
        </TasksUiStateProvider>
      </MemoryRouter>
    </MantineProvider>,
  );
}

beforeEach(() => setViewportWidth(1440));
afterEach(cleanup);

describe('sk-285.7.8 — the rendered half of the rail', () => {
  test('the rail carries the TWO dividers §6 draws, not five', () => {
    // §6 separates the two CLUSTERS from the single controls after them
    // — "queues … · divider · lenses … · divider · View settings
    // · HOT ZONE · Inspect · language · avatar" — and the rail had a divider
    // after View settings, after HOT ZONE and after Inspect as well.
    //
    // Counted on the rendered rail rather than grepped out of the file:
    // a divider is markup, and the question is how many the header
    // actually draws.
    const { container } = renderHeader();
    const rail = container.querySelector('.header-controls');
    expect(rail).not.toBeNull();
    expect(rail!.querySelectorAll('.header-divider')).toHaveLength(2);
  });

  test('…and the members keep the name they always had', () => {
    // The word is gone from the DOM; the ACCESSIBLE name is not, and
    // never was. Asserted here so "no visible label" can never quietly
    // become "no name at all".
    const { container } = renderHeader();
    const names = [...container.querySelectorAll('.header-view-btn')].map((b) =>
      b.getAttribute('aria-label'),
    );
    expect(names).toEqual(['View: Cards', 'View: Tree', 'View: Board']);
  });
});
