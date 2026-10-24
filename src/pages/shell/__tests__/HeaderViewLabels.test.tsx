/**
 * sk-404.2 — the view segment carries its words again, and only where
 * they fit.
 *
 * The maintainers' instruction is "no labels in the List/Tree/Board
 * picker" — put the words back. sk-285.7.9 measured that a labelled
 * segment does not fit the app's own floor, so the words are drawn from
 * `VIEW_LABELS_MIN_PX` upward and nowhere else. This file pins that
 * behaviour through the real width lens rather than through a prop:
 * words above the threshold, no words below it, and the same accessible
 * name either way.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MantineProvider } from '@mantine/core';

import {
  DESKTOP_MIN_PX,
  MOBILE_MIN_PX,
  VIEW_LABELS_MIN_PX,
} from '../../../lib/useWidthMode';
import { setViewportWidth } from '../../../test/viewport';

// ─────────────────────────── Mocks ───────────────────────────

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
    setUnreviewedSelected: vi.fn(),
    inboxCollapsed: false,
    inboxTab: 'inbox' as const,
    setInboxCollapsed: vi.fn(),
    setInboxTab: vi.fn(),
    setActiveZone: vi.fn(),
  }),
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
      inbox: 0,
      mentions: 0,
      watching: 0,
      onMeOpenCount: 0,
      delegatedOpenCount: 0,
      reviewMechanicEnabled: false,
      delegatedUnreviewedCount: null,
    },
    isLoading: false,
    error: null,
  }),
}));

vi.mock('../../../components/Toaster', () => ({
  useToaster: () => ({ error: vi.fn(), success: vi.fn() }),
}));

vi.mock('../../../lib/useInspectMode', () => ({
  useInspectMode: () => ({
    enabled: false,
    enable: vi.fn(),
    disable: vi.fn(),
    toggle: vi.fn(),
  }),
}));

vi.mock('../../../components/VersionCheck', () => ({ AppVersionBadge: () => null }));
vi.mock('../../../components/ThemeToggle', () => ({ ThemeToggle: () => null }));

import { HeaderBar } from '../HeaderBar';
import { TasksUiStateProvider } from '../../../lib/useTasksUiState';

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

/** The words on the segment, in rail order. */
function words(): string[] {
  return [...document.querySelectorAll('.header-view-btn-label')].map(
    (el) => el.textContent ?? '',
  );
}

/** The members themselves — three of them, labelled or not. */
function members(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.header-view-btn')];
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ───────────────────────── 1 — the behaviour ─────────────────────────

describe('sk-404.2 — the words are drawn where they fit', () => {
  test(`at ${VIEW_LABELS_MIN_PX} the three members carry their words`, () => {
    setViewportWidth(VIEW_LABELS_MIN_PX);
    renderHeader();
    expect(words()).toEqual(['Cards', 'Tree', 'Board']);
    // The box changes with the word — a member that draws one must be
    // allowed to be wider than the icon square, and the modifier is what
    // says so.
    for (const m of members()) {
      expect(m.className).toContain('header-view-btn-labelled');
    }
  });

  test(`one pixel below it (${VIEW_LABELS_MIN_PX - 1}) there are no words at all`, () => {
    // The boundary belongs to the UPPER range, the same way the width
    // modes' thresholds do: `(min-width: N)` is `width >= N` in CSS.
    setViewportWidth(VIEW_LABELS_MIN_PX - 1);
    renderHeader();
    expect(words()).toEqual([]);
    expect(members()).toHaveLength(3);
    for (const m of members()) {
      expect(m.className).not.toContain('header-view-btn-labelled');
    }
  });

  test.each([
    ['the app floor', DESKTOP_MIN_PX],
    ['a tablet', MOBILE_MIN_PX],
    ['a phone', 390],
  ])('%s draws the segment and no words', (_what, width) => {
    // §5 takes the words off the segment on tablet and phone, and
    // sk-285.7.9 took them off at the desktop floor for a measured
    // reason. All three fall out of one threshold rather than three
    // rules — see the ordering assertion below.
    setViewportWidth(width);
    renderHeader();
    expect(words()).toEqual([]);
    expect(members()).toHaveLength(3);
  });

  test('the accessible name is the same with the word and without it', () => {
    // The word was never the NAME. sk-285.7.9's segment was icon-only
    // and still announced «View: Cards»; putting the word back must not
    // turn that into «View: Cards Cards» either.
    setViewportWidth(VIEW_LABELS_MIN_PX - 1);
    renderHeader();
    const narrow = members().map((m) => m.getAttribute('aria-label'));
    cleanup();

    setViewportWidth(VIEW_LABELS_MIN_PX);
    renderHeader();
    const wide = members().map((m) => m.getAttribute('aria-label'));

    expect(narrow).toEqual(['View: Cards', 'View: Tree', 'View: Board']);
    expect(wide).toEqual(narrow);
    for (const m of members()) {
      expect(screen.getByRole('button', { name: m.getAttribute('aria-label')! })).toBe(m);
    }
  });
});

