/**
 * sk-285.7 T024 — the COMPACT headers (tablet / mobile).
 *
 * Handoff §5 gives the header three states:
 *
 *   ≥1024 desktop — everything, labels included.
 *   768–1024 tablet — "view segment and lenses without text labels,
 *                     HOT ZONE — icon only".
 *   <768 mobile   — "logo · Cards/Tree/Board icons · one
 *                    'Queues' button with a total counter · avatar".
 *
 * The mode is expressed as a SELECTOR (`<html data-width-mode>`), and
 * vitest runs jsdom with `css: false`: «what the tablet draws» cannot be
 * asserted by rendering at 1024px. What is asserted is COMPOSITION —
 * every control is in the DOM at every width — plus the behaviour of the
 * one control T024 adds. What each mode hides is not checked by tests
 * (sk-540.11, owner decision).
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MantineProvider } from '@mantine/core';

// ─────────────────────────── Mocks ───────────────────────────

vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u-1', username: 'admin', role: 'admin' },
    logout: vi.fn(async () => {}),
  }),
}));

const setInboxCollapsed = vi.fn();
const setInboxTab = vi.fn();
const setActiveZone = vi.fn();
let mockInboxCollapsed = false;
vi.mock('../../../lib/useLayoutState', () => ({
  useLayoutState: () => ({
    outboxMode: false,
    toggleOutboxMode: vi.fn(),
    onMeMode: false,
    toggleOnMeMode: vi.fn(),
    budilnikMode: false,
    toggleBudilnikMode: vi.fn(),
    inboxCollapsed: mockInboxCollapsed,
    inboxTab: 'mentions' as const,
    setInboxCollapsed,
    setInboxTab,
    setActiveZone,
  }),
  // sk-303.14 — `TasksUiStateProvider` reads the layout through the OPTIONAL
  // accessor so it can be mounted with no provider above it, and a module
  // mock has to carry that export too or the provider throws on the missing
  // name before a single assertion runs. `null` is the honest answer: this
  // file mocks the layout wholesale, so there is no context to hand back.
  useOptionalLayoutState: () => null,
}));

const navigateSpy = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateSpy };
});

vi.mock('../../../lib/useReminders', () => ({ useRingingTaskCount: () => 0, useRingEpoch: () => 0 }));

/**
 * Counts that are distinct AND whose sum is not one of them: 7+2+5 is 14,
 * so an aggregate that accidentally printed a single queue rather than
 * the total cannot pass by coincidence.
 */
let mockCounts = {
  inbox: 7,
  mentions: 2,
  watching: 5,
  onMeOpenCount: 4,
  delegatedOpenCount: 6,
};
vi.mock('../../../lib/useNotificationCounts', () => ({
  notificationCountsKey: ['notification-counts'] as const,
  useNotificationCounts: () => ({ counts: mockCounts, isLoading: false, error: null }),
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
import { setViewportWidth } from '../../../test/viewport';

function renderHeader(at = '/') {
  return render(
    <MantineProvider>
      <MemoryRouter initialEntries={[at]}>
        <TasksUiStateProvider>
          <HeaderBar />
        </TasksUiStateProvider>
      </MemoryRouter>
    </MantineProvider>,
  );
}

const MOBILE = 390;
const TABLET = 1024;
const DESKTOP = 1440;

beforeEach(() => {
  mockInboxCollapsed = false;
  mockCounts = {
    inbox: 7,
    mentions: 2,
    watching: 5,
    onMeOpenCount: 4,
    delegatedOpenCount: 6,
  };
  setViewportWidth(DESKTOP);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.documentElement.removeAttribute('data-width-mode');
});

// ── The rendered half — composition, and the new control's behaviour ──

describe('T024 — the header renders ONE composition at every width', () => {
  /**
   * The controls the three modes choose among. If any of these were
   * mounted conditionally, every stylesheet assertion further down would
   * be describing a rule with nothing to apply to — which is the failure
   * mode a CSS-only responsive header has, and the reason this list is
   * checked first.
   */
  const CONTROLS: ReadonlyArray<[string, string]> = [
    ['the brand', '.header-logo'],
    ['the view switcher', '.header-viewswitch'],
    ['the aggregate Queues button', '.header-queues-total'],
    ['the four queue badges', '.header-queues'],
    ['the three lens pills', '.header-lenses'],
    ['View settings', '.header-viewsettings-anchor'],
    ['HOT ZONE', '.header-hotzone'],
    ['Inspect', '.header-inspect-btn'],
    ['the language control', '.header-lang-anchor'],
    ['the avatar', '.header-user-anchor'],
  ];

  test.each([
    ['mobile', MOBILE],
    ['tablet', TABLET],
    ['desktop', DESKTOP],
  ])('at %s width every control is in the DOM', (_name, width) => {
    setViewportWidth(width);
    renderHeader();
    const missing = CONTROLS.filter(([, sel]) => document.querySelector(sel) === null).map(
      ([name]) => name,
    );
    expect(missing, 'a control is mounted conditionally on width').toEqual([]);
  });

  test('the aggregate button carries the SUM of the four queues', () => {
    renderHeader();
    const btn = document.querySelector<HTMLElement>('.header-queues-total');
    expect(btn, 'no aggregate Queues button').not.toBeNull();
    // 7 + 3 + 2 + 5. Both the drawn chip and the accessible name, because
    // they are authored independently — the chip is `aria-hidden` and the
    // name comes from the button's own `aria-label`.
    expect(btn!.textContent).toBe('14');
    expect(btn!.getAttribute('aria-label')).toBe('Queues — 14 unread');
  });

  test('an empty set of queues draws no chip but still announces the zero', () => {
    // The rail's standing rule — a zero draws nothing — applied to the
    // one control that replaces four. The number still has to reach a
    // screen reader, which is why the name is authored separately.
    mockCounts = { ...mockCounts, inbox: 0, mentions: 0, watching: 0 };
    renderHeader();
    const btn = document.querySelector<HTMLElement>('.header-queues-total');
    expect(btn!.querySelector('.header-badge-chip')).toBeNull();
    expect(btn!.getAttribute('aria-label')).toBe('Queues — 0 unread');
    // …and it is still a real, focusable control: an unread count of
    // zero does not mean the queues are empty (see `QueueBadge`'s doc
    // block). Since sk-303.13 (T027) it is an <a>, because the queue it
    // opens has an address.
    expect(btn!.tagName).toBe('A');
  });

  test('clicking it SHOWS the Queues zone, not just unfolds its column', () => {
    // The half a phone needs. Unfolding is enough on a desktop, where all
    // four zones are on screen; on a phone exactly one zone is drawn, so
    // a handler that only unfolded a hidden column would leave the user
    // on the screen they clicked from — a dead control.
    mockInboxCollapsed = true;
    renderHeader();
    const btn = screen.getByRole('link', { name: 'Queues — 14 unread' });
    // It opens the queue the user last picked rather than resetting them
    // to Inbox: it is an aggregate ENTRY POINT, not another queue. Since
    // sk-303.13 (T027) that choice travels in the ADDRESS.
    expect(btn.getAttribute('href')).toBe('/?tab=mentions');
    fireEvent.click(btn);
    expect(setActiveZone).toHaveBeenCalledWith('queues');
    expect(setInboxCollapsed).toHaveBeenCalledWith(false);
  });

  test('…and from a focus page it points back at the shell', () => {
    // /settings, /legacy and /activity have no Queues column at all, so
    // selecting a zone there would set state nobody can see. Same rule
    // the badges already follow: the destination is the shell root
    // carrying the queue.
    renderHeader('/settings/api-keys');
    expect(
      screen.getByRole('link', { name: 'Queues — 14 unread' }).getAttribute('href'),
    ).toBe('/?tab=mentions');
  });

  test('the badges also show the zone — one rule for every entry', () => {
    // The aggregate replaces the badges on a phone, but above the
    // threshold they are the entry points, and a badge that unfolded a
    // column without selecting its zone would be the same dead control
    // one mode up. Asserted through a badge, not through the aggregate,
    // so the two paths cannot diverge unnoticed.
    renderHeader();
    const badge = screen.getByRole('link', { name: 'Watching 5' });
    expect(badge.getAttribute('href')).toBe('/?tab=watching');
    fireEvent.click(badge);
    expect(setActiveZone).toHaveBeenCalledWith('queues');
  });
});
