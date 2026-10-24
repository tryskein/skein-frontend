/**
 * sk-404.3 — the header rail carries NO separate jump to the unreviewed
 * set, and the Delegated pill's second number is untouched.
 *
 * ## What was removed, and on whose word
 *
 * sk-303.14 (T027) shipped two things side by side: a SECOND NUMBER inside
 * the Delegated toggle (closed results the caller created and has not read)
 * and, beside it, a one-action JUMP into that set — `.unreviewed-jump`, an
 * envelope button. The decision of 2026-09-09: the Delegated button already leads to the
 * unreviewed set, so one of the two goes, and it is the jump.
 *
 * This is deletion of freshly merged work, so it is pinned rather than left to look like
 * a merge loss. The set stays reachable — the status axis carries an
 * «Unreviewed» chip, which is the route `unreviewedEntry.test.tsx` drives —
 * so what went is a shortcut, not a capability.
 *
 * ## Why the guard is shaped like this
 *
 * Independent statements, because a removal can be half-done in several
 * different ways and each one leaves a different piece of litter:
 *
 *   1. THE CONTROL. Read off the MOUNTED rail, by both routes a reader
 *      could reach it: its class, and its accessible name. Enumerating the
 *      rail's own focusable children rather than asking for one selector
 *      means a jump that comes back under a new class still fails here.
 *   2. THE SECOND NUMBER. Asserted PRESENT in the same breath. «Remove the
 *      jump» is one control away from «remove the mechanic», and the
 *      acceptance names the number as the half that stays.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MantineProvider } from '@mantine/core';


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

vi.mock('../../../lib/useReminders', () => ({
  useRingingTaskCount: () => 0,
  useRingEpoch: () => 0,
}));

/**
 * The mechanic is ON and the set is non-empty — the ONE state in which the
 * jump used to be rendered at all. A guard run with the mechanic off would
 * be green against a build that still ships the button.
 */
const COUNTS = {
  inbox: 7,
  mentions: 2,
  watching: 5,
  onMeOpenCount: 4,
  delegatedOpenCount: 6,
  reviewMechanicEnabled: true,
  delegatedUnreviewedCount: 2,
};
vi.mock('../../../lib/useNotificationCounts', () => ({
  notificationCountsKey: ['notification-counts'] as const,
  useNotificationCounts: () => ({ counts: COUNTS, isLoading: false, error: null }),
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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ───────────── 1 + 2 — the control is gone, the number is not ─────────────

describe('sk-404.3 — the rail has no jump to the unreviewed set', () => {
  test('the mounted rail carries no jump control, under either name', () => {
    renderHeader();

    // Sanity: the mechanic really is on in this render, so the absence
    // below is «removed», not «never rendered in this state». Read off the
    // counts the render was given — sk-411 took the on-screen chip away, so
    // the DOM can no longer answer this question.
    expect(COUNTS.reviewMechanicEnabled).toBe(true);

    const rail = document.querySelector<HTMLElement>('.header-controls');
    expect(rail, 'no header rail in the document').not.toBeNull();

    // By class — the litter a partial removal leaves.
    expect(rail!.querySelectorAll('.unreviewed-jump').length).toBe(0);

    // …and by accessible name, over every focusable the rail actually
    // draws. A jump re-added under some other class is still a control
    // that says «go to unreviewed results», and it fails here.
    const names = [...rail!.querySelectorAll<HTMLElement>('button, a[href]')].map(
      (el) => el.getAttribute('aria-label') ?? el.textContent ?? '',
    );
    expect(
      names.filter((n) => /unreviewed results|непросмотренным результатам/i.test(n)),
    ).toEqual([]);
  });

  /*
   * sk-411 — this test asserted the opposite of what the control now
   * draws: «the second number stays inside the Delegated toggle». The
   * second number was removed, so
   * the assertion is inverted rather than deleted — the subject is the
   * same control, and a silent deletion would leave nothing standing
   * against the number coming back.
   */
  test('the Delegated toggle draws ONE number, and the mechanic is on', () => {
    renderHeader();

    const toggle = screen.getByRole('button', { name: 'Delegated 6' });
    // The first number is untouched.
    expect(within(toggle).getByText('6')).toBeTruthy();
    // …and the second one is gone from the control and from its name,
    // with the mechanic switched ON in this very render.
    expect(COUNTS.reviewMechanicEnabled).toBe(true);
    expect(screen.queryByTestId('delegated-unreviewed-count')).toBeNull();
    expect(toggle.getAttribute('aria-label')).not.toMatch(/unreviewed|непросмотр/i);
  });
});
