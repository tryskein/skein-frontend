/**
 * sk-285.7 T023 — the three lenses are LABELLED PILLS, and their
 * counters are outside the global lens.
 *
 * Coverage matrix rows 30, 52 and 53 (US-4, INV-10, SC-007):
 *   52 — "every lens carries a text label and a counter; the active one
 *        is distinguishable from the inactive ones"
 *   53 — "the ringing reminder is rendered with the warning role"
 *   30 — "lens counters and queue badges do **not** react to the lens"
 *
 * ── Why row 30 is the interesting one ────────────────────────────────
 *
 * INV-10 makes the delegated lens a GLOBAL one: every surface that
 * prints a number derived from issues has to narrow to it. The lens
 * CONTROLS are the documented exception, and the spec gives the reason
 * in one line — "their counters exist to show the
 * opposite side — subordinating them to their own lens would zero
 * them by construction". A Delegated pill that scoped its own count to the
 * delegated lens would read 0 whenever the lens was off and would be the
 * one number on screen nobody could use to decide whether to turn it on.
 *
 * So this file asserts the ABSENCE of scoping, which is a shape a test
 * has to work at: "the number did not change" is also what you get from
 * a surface that reads no counts at all. Two independent statements
 * therefore stand behind it — the rendered numbers hold still across a
 * lens toggle, AND the counts hook is handed nothing to scope BY. The
 * second is what makes the first mean something: a hook called with no
 * arguments cannot be lens-aware, whatever it does inside.
 *
 * ── Where each claim is read from ────────────────────────────────────
 *
 * The label, the count and the pressed state are read from the RENDERED
 * header — they are DOM facts. The colour roles are not checked by tests
 * (sk-540.11, owner decision).
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MantineProvider } from '@mantine/core';

// ─────────────────────────── Mocks ───────────────────────────

vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u-1', username: 'admin', role: 'admin' },
    logout: vi.fn(async () => {}),
  }),
}));

/**
 * The global lens, mutable per test.
 *
 * A real piece of state rather than a constant: row 30 is about what
 * happens when it FLIPS, and a header rendered twice from two constants
 * would not exercise the toggle path at all.
 */
let mockOutboxMode = false;
const toggleOutboxMode = vi.fn(() => {
  mockOutboxMode = !mockOutboxMode;
});
vi.mock('../../../lib/useLayoutState', () => ({
  useLayoutState: () => ({
    outboxMode: mockOutboxMode,
    toggleOutboxMode,
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

let mockRingingTaskCount = 0;
vi.mock('../../../lib/useReminders', () => ({
  useRingingTaskCount: () => mockRingingTaskCount,
  useRingEpoch: () => 0,
}));

/**
 * The counts hook, wrapped in a spy that records HOW it was called.
 *
 * The arguments are the evidence for row 30: `useNotificationCounts()`
 * takes none, so it cannot narrow to a lens, and a future edit that
 * started passing it one would be the first step of exactly the defect
 * INV-10's exception exists to prevent.
 */
const COUNTS = {
  inbox: 7,
  mentions: 2,
  watching: 5,
  onMeOpenCount: 4,
  delegatedOpenCount: 6,
};
const countsSpy = vi.fn(() => ({ counts: COUNTS, isLoading: false, error: null }));
vi.mock('../../../lib/useNotificationCounts', () => ({
  notificationCountsKey: ['notification-counts'] as const,
  useNotificationCounts: (...args: unknown[]) => countsSpy(...(args as [])),
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

/** The three lens pills, by the class that makes each one a pill. */
function pills(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.lens-pill')];
}

beforeEach(() => {
  mockOutboxMode = false;
  mockRingingTaskCount = 0;
  countsSpy.mockClear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ── row 52 — a lens says what it is and how much of it there is ─────

describe('T023 / row 52 — every lens carries a label and a count', () => {
  test('there are exactly three pills, and they are the three lenses', () => {
    // The floor under every `.each` below: three is the number INV-1 and
    // the handoff both give, and a pill that stopped being one would
    // silently drop out of the checks instead of failing them.
    renderHeader();
    expect(pills().map((p) => p.textContent)).toEqual([
      'On me4',
      'Delegated6',
      'Reminders',
    ]);
  });

  test.each([
    ['On me', 'on-me', '4'],
    ['Delegated', 'delegated', '6'],
  ])('the %s pill shows its word and its number', (label, lens, count) => {
    renderHeader();
    const pill = document.querySelector<HTMLElement>(`.lens-pill.${lens}`);
    expect(pill, `no ${lens} pill`).not.toBeNull();
    // The WORD, as a text node of the button — not as a tooltip and not
    // as an aria-label. That is the whole change T023 makes: before it,
    // the only way to learn what a lens was called was to hover it.
    expect(within(pill!).getByText(label)).toBeTruthy();
    expect(within(pill!).getByText(count)).toBeTruthy();
    // …and the accessible name still carries both, so nothing was
    // traded away for the visible label.
    expect(pill!.getAttribute('aria-label')).toBe(`${label} ${count}`);
  });

  test('the alarm pill carries its word too, and its number when it rings', () => {
    // The alarm's count is the ringing one, not a queue count, so it is
    // the one pill whose number is absent at rest — the shell-wide rule
    // that a zero draws nothing. The WORD is not conditional.
    renderHeader();
    const calm = document.querySelector<HTMLElement>('.lens-pill.budilnik')!;
    expect(within(calm).getByText('Reminders')).toBeTruthy();
    expect(calm.querySelector('.budilnik-badge')).toBeNull();

    cleanup();
    mockRingingTaskCount = 3;
    renderHeader();
    const ringing = document.querySelector<HTMLElement>('.lens-pill.budilnik')!;
    expect(within(ringing).getByText('Reminders')).toBeTruthy();
    expect(within(ringing).getByText('3')).toBeTruthy();
  });

  test('an active lens is distinguishable from an inactive one', () => {
    // The pressed state is what a screen reader hears.
    mockOutboxMode = true;
    renderHeader();
    const delegated = document.querySelector<HTMLElement>('.lens-pill.delegated')!;
    const onMe = document.querySelector<HTMLElement>('.lens-pill.on-me')!;
    expect(delegated.getAttribute('aria-pressed')).toBe('true');
    expect(onMe.getAttribute('aria-pressed')).toBe('false');
    expect(delegated.className).toContain('active');
    expect(onMe.className).not.toContain('active');
  });
});

// ── row 53 — a ringing reminder is drawn in the warning role ────────

describe('T023 / row 53 — a ringing reminder marks the lens pill', () => {
  test('the ringing state reaches the DOM at all', () => {
    // The warning role is keyed on this class; a class nothing puts on
    // the button is a rule nothing applies.
    mockRingingTaskCount = 2;
    renderHeader();
    const alarm = document.querySelector<HTMLElement>('.lens-pill.budilnik')!;
    expect(alarm.className).toContain('ringing');
    cleanup();

    mockRingingTaskCount = 0;
    renderHeader();
    expect(
      document.querySelector<HTMLElement>('.lens-pill.budilnik')!.className,
    ).not.toContain('ringing');
  });
});

// ── row 30 — the lens controls are OUTSIDE the global lens ──────────

describe('T023 / row 30 — lens counters and queue badges ignore the global lens', () => {
  test('the counts hook is handed nothing it could scope by', () => {
    // The structural half of the claim, and the one that survives a
    // refactor: a hook called with no arguments cannot narrow to a lens.
    // Asserted on EVERY call, because the header calls it once per
    // render and a lens-aware argument added on a re-render only would
    // be the same defect arriving late.
    renderHeader();
    expect(countsSpy.mock.calls.length).toBeGreaterThan(0);
    for (const call of countsSpy.mock.calls) {
      expect(call, 'useNotificationCounts was handed a scope').toEqual([]);
    }
  });

  test('turning the global lens on moves no number in the header', () => {
    // The observable half. Every number the rail prints is read before
    // and after the toggle — the queue badges and the two lens counts —
    // and the toggle is performed through the real control, so this
    // exercises the path a user actually takes.
    renderHeader();
    const numbers = () =>
      [...document.querySelectorAll('.header-badge-chip, .lens-toggle-count')].map(
        (n) => n.textContent,
      );
    const before = numbers();
    // Guard against a vacuous pass: a rail printing nothing would give
    // two equal empty lists.
    //
    // The leading 14 is the phone's aggregate Queues chip (T024) —
    // 7+2+5, the sum of the badges that follow it. It is in the
    // DOM at every width (the stylesheet, not the markup, decides which
    // of the two forms is drawn), so it is one more number row 30 has to
    // hold for, and it is listed here rather than filtered out for
    // exactly that reason: a total assembled from lens-blind parts stays
    // lens-blind only as long as nobody re-sources it.
    expect(before).toEqual(['14', '7', '2', '5', '4', '6']);

    fireEvent.click(screen.getByRole('button', { name: 'Delegated 6' }));
    expect(toggleOutboxMode).toHaveBeenCalled();
    cleanup();
    // `mockOutboxMode` was flipped by the toggle; re-render under it.
    expect(mockOutboxMode).toBe(true);
    renderHeader();

    expect(numbers(), 'a header number narrowed itself to the global lens').toEqual(before);
    // …and the lens itself did change state, so the re-render really was
    // the lensed one and not a repeat of the first.
    expect(
      document.querySelector('.lens-pill.delegated')!.getAttribute('aria-pressed'),
    ).toBe('true');
  });
});
