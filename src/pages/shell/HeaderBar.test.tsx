/**
 * sk-54 — "On me" / "Delegated" tab count badges.
 *
 * Renders HeaderBar with mocked hooks and asserts the two lens toggles
 * surface their non-closed counts from `useNotificationCounts`
 * (`onMeOpenCount` / `delegatedOpenCount`) — including the empty-state
 * "0" render. The live-update path (SignalR → ['notification-counts']
 * invalidation → refetch) is covered separately in
 * `lib/liveEventInvalidation.test.ts`; here we pin the render contract.
 *
 * All of HeaderBar's hook dependencies are mocked at the module level so
 * the test is deterministic and offline — same strategy as Shell.test.tsx.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { MantineProvider } from '@mantine/core';

// ─────────────────────────── Mocks ───────────────────────────

// sk-285.6.16 — Logout changed its LOOK, not its behaviour, so the
// async call and its failure path are asserted here. Module-level spies
// (the factory only closes over them; it never reads them at hoist
// time) so a test can make the logout reject and see what the header
// does about it.
const logoutSpy = vi.fn(async () => {});
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    // sk-285.7.11 (AM2) — the menu's identity block shows WHICH
    // account, not just whose name, so the mocked caller carries the
    // address the artboard writes on `#2c`.
    user: { id: 'u-1', username: 'admin', role: 'admin', email: 'admin@skein.local' },
    logout: logoutSpy,
  }),
}));

const toggleOnMeMode = vi.fn();
const toggleOutboxMode = vi.fn();
const toggleBudilnikMode = vi.fn();
// Queue-badge wiring (the header badge drives the Queues column) is
// asserted through these spies, so they are module-level and the
// column state they read is mutable per test.
const setInboxCollapsed = vi.fn();
// sk-303.13 (T027) — kept as a spy precisely so a test can assert it is
// NOT called: the tab comes from the address now, not from a setter.
const setInboxTab = vi.fn();
// sk-285.7 T024 — the badges now also SHOW the Queues zone, not just
// unfold its column: on a phone exactly one zone is drawn, so unfolding
// alone left the user on the screen they clicked from.
const setActiveZone = vi.fn();
let mockLayout = {
  inboxCollapsed: false,
  inboxTab: 'inbox' as 'inbox' | 'mentions' | 'watching',
};
const mockSetUnreviewedSelected = vi.fn();
vi.mock('../../lib/useLayoutState', () => ({
  useLayoutState: () => ({
    outboxMode: false,
    toggleOutboxMode,
    onMeMode: false,
    toggleOnMeMode,
    budilnikMode: false,
    toggleBudilnikMode,
    inboxCollapsed: mockLayout.inboxCollapsed,
    inboxTab: mockLayout.inboxTab,
    setInboxCollapsed,
    setInboxTab,
    setActiveZone,
    setUnreviewedSelected: mockSetUnreviewedSelected,
  }),
  // sk-303.14 — `TasksUiStateProvider` (mounted by the harness below) reads
  // the layout through the OPTIONAL accessor so it can be mounted with no
  // provider above it. A module mock has to carry it too, or the provider
  // throws on a missing export before a single assertion runs. `null` is
  // the honest answer here: this file mocks the layout wholesale, so there
  // is no context to hand back, and no selection is what these tests want.
  useOptionalLayoutState: () => null,
}));

// Navigation off a focus page (settings / legacy / activity → "/") is
// part of the badge contract, so the real router is kept and only
// `useNavigate` is spied on.
const navigateSpy = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>(
    'react-router-dom',
  );
  return { ...actual, useNavigate: () => navigateSpy };
});

// sk-62.2 — the alarm badge reads the ringing count; mock it so the
// header renders without a QueryClient. Mutable so per-test ringing
// permutations drive the badge.
let mockRingingTaskCount = 0;
vi.mock('../../lib/useReminders', () => ({
  useRingingTaskCount: () => mockRingingTaskCount,
  useRingEpoch: () => 0,
}));

// The counts hook is the unit under test — driven per-test via mutable
// state so we can render different count permutations.
let mockCounts = {
  inbox: 0,
  mentions: 0,
  watching: 0,
  onMeOpenCount: 0,
  delegatedOpenCount: 0,
  // sk-303.14 — the two contract-C2 keys, spelled out even though
  // this suite is not about them. A mock frozen at the pre-C2 shape
  // renders no second number at all, so a green run here would say
  // nothing about whether the header reads the flag (T030). Off is
  // the right value for these cases; the flag itself is exercised in
  // unreviewedSecondNumber.test.tsx.
  reviewMechanicEnabled: false,
  delegatedUnreviewedCount: null,
};
vi.mock('../../lib/useNotificationCounts', () => ({
  notificationCountsKey: ['notification-counts'] as const,
  useNotificationCounts: () => ({ counts: mockCounts, isLoading: false, error: null }),
}));

const toastError = vi.fn();
vi.mock('../../components/Toaster', () => ({
  useToaster: () => ({ error: toastError, success: vi.fn() }),
}));

// Inspect is a standalone header icon again (sk-285.1.18.5). The spy is
// module-level so it survives re-renders — a fresh vi.fn() per render
// would lose the call.
const toggleInspect = vi.fn();
vi.mock('../../lib/useInspectMode', () => ({
  useInspectMode: () => ({
    enabled: false,
    enable: vi.fn(),
    disable: vi.fn(),
    toggle: toggleInspect,
  }),
}));

vi.mock('../../components/VersionCheck', () => ({
  AppVersionBadge: () => null,
}));

vi.mock('../../components/ThemeToggle', () => ({
  ThemeToggle: () => null,
}));
// sk-551.5 — the Appearance checkboxes read the ui-prefs query; this harness
// renders the header without a QueryClient, as for ThemeToggle above.
vi.mock('../../components/IssueModalViewsSetting', () => ({ IssueModalViewsSetting: () => null }));
vi.mock('../../components/DensitySetting', () => ({ DensitySetting: () => null }));
vi.mock('../../components/NavLayoutSetting', () => ({ NavLayoutSetting: () => null }));

import { HeaderBar } from './HeaderBar';
import { TasksUiStateProvider, useTasksUiState } from '../../lib/useTasksUiState';
import { TREE_DEFAULT_COLUMNS } from '../../lib/treeColumns';
import { KANBAN_DEFAULT_CARD_FIELDS } from '../../lib/kanbanCardFields';
import { KANBAN_DEFAULT_AXIS } from '../../lib/kanbanBoard';
import { LIST_DEFAULT_CARD_FIELDS } from '../../lib/listCardFields';

/**
 * Shows the current address next to the header so a badge click can be
 * asserted on where it actually LANDS, not merely on which spy fired.
 */
function LocationProbe() {
  const loc = useLocation();
  return <span data-testid="url">{`${loc.pathname}${loc.search}`}</span>;
}

function renderHeader(pathname = '/') {
  return render(
    <MantineProvider>
      <MemoryRouter initialEntries={[pathname]}>
        {/* Stage 2 — the rail now carries the Tasks-column view switcher
            and its settings popover, so the header reads useTasksUiState.
            Real provider rather than a mock: the switcher's whole point
            is that it drives the same persisted state the column reads,
            and a stub would let those two drift apart unnoticed. */}
        <TasksUiStateProvider>
          <HeaderBar />
        </TasksUiStateProvider>
        <LocationProbe />
      </MemoryRouter>
    </MantineProvider>,
  );
}

/**
 * sk-285.1.18.5 — the hamburger is gone. Queues, lenses, HOT ZONE and
 * Inspect are all in the header itself; only identity, theme, language
 * and the Settings links live behind the avatar. Tests that assert on
 * THOSE open the account menu first.
 */
function openUserMenu() {
  fireEvent.click(screen.getByRole('button', { name: 'Account menu — admin' }));
}

function renderHeaderWithMenu() {
  const result = renderHeader();
  openUserMenu();
  return result;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  logoutSpy.mockReset();
  logoutSpy.mockResolvedValue(undefined);
  mockLayout = { inboxCollapsed: false, inboxTab: 'inbox' };
});

describe('HeaderBar — sk-54 lens count badges', () => {
  beforeEach(() => {
    mockCounts = {
      inbox: 0,
      mentions: 0,
      watching: 0,
      onMeOpenCount: 0,
      delegatedOpenCount: 0,
      reviewMechanicEnabled: false,
      delegatedUnreviewedCount: null,
    };
    mockRingingTaskCount = 0;
  });

  test('renders the On me / Delegated counts from useNotificationCounts', () => {
    mockCounts = { ...mockCounts, onMeOpenCount: 4, delegatedOpenCount: 6 };
    renderHeader();

    // The buttons carry an aria-label "<Label> <count>" — assert via that
    // accessible name so the count is announced to assistive tech.
    const onMe = screen.getByRole('button', { name: 'On me 4' });
    expect(within(onMe).getByText('4')).toBeTruthy();

    const delegated = screen.getByRole('button', { name: 'Delegated 6' });
    expect(within(delegated).getByText('6')).toBeTruthy();
  });

  test('an empty lens draws NO chip, but still announces its zero', () => {
    // counts default to 0 via beforeEach.
    renderHeader();

    // The chip is a notification badge: absent means "nothing here".
    const onMe = screen.getByRole('button', { name: 'On me 0' });
    expect(onMe.querySelector('.lens-toggle-count')).toBeNull();

    const delegated = screen.getByRole('button', { name: 'Delegated 0' });
    expect(delegated.querySelector('.lens-toggle-count')).toBeNull();

    // The number is NOT lost — it lives in the accessible name, which is
    // how the getByRole queries above found these buttons at all.
  });
});

describe('HeaderBar — sk-62.2 Reminders lens button', () => {
  beforeEach(() => {
    mockCounts = {
      inbox: 0,
      mentions: 0,
      watching: 0,
      onMeOpenCount: 0,
      delegatedOpenCount: 0,
      reviewMechanicEnabled: false,
      delegatedUnreviewedCount: null,
    };
    mockRingingTaskCount = 0;
  });

  test('calm alarm clock shows no chip at all, ringing or quiet', () => {
    mockRingingTaskCount = 0;
    renderHeader();

    // Calm state — accessible name is just "Reminders", no count.
    const btn = screen.getByRole('button', { name: 'Reminders' });
    expect(btn).toBeTruthy();
    // No loud amber pill, no shaking icon.
    expect(btn.querySelector('.budilnik-badge')).toBeNull();
    expect(btn.querySelector('.budilnik-icon.shaking')).toBeNull();
    expect(btn.classList.contains('ringing')).toBe(false);
    // …and no quiet chip either: a zero draws nothing anywhere on the
    // rail, so a calm alarm is just the bare glyph.
    expect(btn.querySelector('.lens-toggle-count')).toBeNull();
  });

  test('ringing badge shows ringingTaskCount + shakes when > 0', () => {
    mockRingingTaskCount = 3;
    renderHeader();

    // The accessible name carries the ringing count + plural copy.
    const btn = screen.getByRole('button', { name: /Reminders — 3/ });
    expect(btn.classList.contains('ringing')).toBe(true);
    const badge = btn.querySelector('.budilnik-badge');
    expect(badge?.textContent).toBe('3');
    // Icon is in the violent-shake state.
    expect(btn.querySelector('.budilnik-icon.shaking')).not.toBeNull();
  });

  test('clicking the alarm toggles budilnik mode', () => {
    renderHeader();
    const btn = screen.getByRole('button', { name: 'Reminders' });
    fireEvent.click(btn);
    expect(toggleBudilnikMode).toHaveBeenCalledTimes(1);
  });
});


/**
 * sk-285.1.18.5 — brand left, one control rail right.
 *
 * The hamburger is gone. The rail carries the four queue badges, the
 * three lenses, HOT ZONE and Inspect; only identity, appearance,
 * language and the Settings links sit behind the avatar. These tests
 * pin that contract: what is reachable without opening anything, that
 * every rail control is the REAL control (a lens must flip the lens,
 * not merely look like a switch), and that the account menu still
 * carries what moved into it.
 */
describe('HeaderBar — sk-285.1.18.5 header rail', () => {
  beforeEach(() => {
    mockCounts = {
      inbox: 2,
      mentions: 0,
      watching: 0,
      onMeOpenCount: 0,
      delegatedOpenCount: 0,
      reviewMechanicEnabled: false,
      delegatedUnreviewedCount: null,
    };
    mockRingingTaskCount = 0;
  });

  test('the rail exposes queues, lenses, HOT ZONE and Inspect with no menu open', () => {
    renderHeader();

    expect(screen.getByRole('link', { name: /Skein/i })).toBeTruthy();
    // Queues.
    expect(screen.getByLabelText('Inbox 2')).toBeTruthy();
    // No Outbox: sk-303.13 / US-9 removed the queue. The LENS of the
    // same name is asserted two lines down and is a different thing.
    expect(screen.queryByLabelText(/^Outbox /)).toBeNull();
    expect(screen.getByLabelText('Mentions 0')).toBeTruthy();
    expect(screen.getByLabelText('Watching 0')).toBeTruthy();
    // Lenses — out of the drawer, back in the header.
    expect(screen.getByRole('button', { name: 'On me 0' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delegated 0' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reminders' })).toBeTruthy();
    // HOT ZONE — a link straight to /activity, no dropdown behind it.
    const hotZone = screen.getByRole('link', { name: /HOT ZONE/i });
    expect(hotZone.getAttribute('href')).toBe('/activity');
    expect(hotZone.getAttribute('aria-haspopup')).toBeNull();
    // Inspect — a standalone icon again (sk-285.1.18.1 reverted).
    expect(
      screen.getByRole('button', { name: 'Inspect element for theme editing' }),
    ).toBeTruthy();
    // The avatar replaced the hamburger.
    expect(screen.queryByRole('button', { name: 'Menu' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Account menu — admin' })).toBeTruthy();

    // Account-menu contents stay behind the avatar.
    expect(screen.queryByRole('button', { name: /Log out/i })).toBeNull();
    expect(screen.queryByRole('link', { name: 'API keys' })).toBeNull();
  });

  test('HOT ZONE is a labelled button, not an icon — and carries no hardcoded fire skin', () => {
    renderHeader();
    const hotZone = screen.getByRole('link', { name: /HOT ZONE/i });
    // Visible text, not just an aria-label.
    expect(hotZone.querySelector('.header-hotzone-label')?.textContent).toBe('HOT ZONE');
    // The old gradient badge painted an animated flame silhouette; it is
    // gone along with its off-token palette.
    expect(hotZone.querySelector('.hotzone-flames')).toBeNull();
    expect(hotZone.classList.contains('header-badge-hotzone')).toBe(false);
  });

  test('the avatar button reports its expanded state and opens the account menu', () => {
    renderHeader();

    const avatar = screen.getByRole('button', { name: 'Account menu — admin' });
    expect(avatar.getAttribute('aria-expanded')).toBe('false');

    openUserMenu();
    expect(avatar.getAttribute('aria-expanded')).toBe('true');

    // Identity.
    expect(screen.getByText('admin')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Log out/i })).toBeTruthy();
    // Settings group — Inspect is NOT among them any more, and since
    // sk-402 the group is the settings tab row entry for entry: Push
    // left with its page, Password arrived with its own.
    expect(screen.getByRole('link', { name: 'Password' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'API keys' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Users' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Notifications' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Theme' })).toBeTruthy();
    // Exactly one Inspect control in the document — the header icon.
    expect(
      screen.getAllByRole('button', { name: 'Inspect element for theme editing' }),
    ).toHaveLength(1);
  });

  // sk-285.6.15 — the UI-language switcher left the account menu for the
  // rail. It is reachable with nothing open, and the menu no longer
  // carries a language section at all.
  test('the UI language is a rail control, not an account-menu section', () => {
    renderHeader();

    const lang = screen.getByRole('button', { name: 'Language: English' });
    expect(lang.getAttribute('aria-haspopup')).toBe('menu');

    openUserMenu();
    // Nothing about language inside the menu — neither the old heading
    // nor the old pair of buttons.
    const menu = document.querySelector('.header-menu')!;
    expect(within(menu as HTMLElement).queryByText('Language')).toBeNull();
    expect(menu.querySelector('.language-switcher')).toBeNull();
    expect(menu.querySelector('.header-lang-anchor')).toBeNull();
  });

  test('the lens icons in the rail drive the real layout state', () => {
    renderHeader();

    fireEvent.click(screen.getByRole('button', { name: 'On me 0' }));
    expect(toggleOnMeMode).toHaveBeenCalledTimes(1);
    expect(toggleOutboxMode).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Delegated 0' }));
    expect(toggleOutboxMode).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Reminders' }));
    expect(toggleBudilnikMode).toHaveBeenCalledTimes(1);
  });

  test('Inspect drives the hook and keeps the data-inspect-toggle anchor', () => {
    renderHeader();

    const inspect = screen.getByRole('button', {
      name: 'Inspect element for theme editing',
    });
    // useInspectMode's capture-phase click handler recognises its own
    // toggle via this attribute (it used to match the aria-label, which
    // moved twice — sk-285.1.18.4 into the drawer, .18.5 back out).
    expect(inspect.hasAttribute('data-inspect-toggle')).toBe(true);

    fireEvent.click(inspect);
    expect(toggleInspect).toHaveBeenCalledTimes(1);
  });

  test('queue badges render icon + corner chip and stay clickable at every count', () => {
    renderHeader();

    // Icon + a corner chip carrying the count + a label node that CSS
    // hides at every width; the accessible name is authored on the
    // wrapper, so it never depends on any of those nodes.
    const inbox = screen.getByLabelText('Inbox 2');
    expect(inbox.querySelector('.header-badge-label')?.textContent).toBe('Inbox');
    expect(inbox.querySelector('.header-badge-icon')).not.toBeNull();
    expect(inbox.querySelector('.header-badge-chip')?.textContent).toBe('2');
    // sk-303.13 (T027) — an anchor, not a button: the queue has an
    // address, and the element says so.
    expect(inbox.tagName).toBe('A');

    // Empty bucket stays a real link. The badge is its queue's ENTRY
    // POINT, and the number is an unread counter, not the queue's length
    // — Watching 0 still fronts the whole subscription list, Inbox 0 the
    // whole assignment list. The <span> rendering the inline badges used
    // made those queues unreachable from the header and skipped by
    // keyboard; only the dim "empty" paint is kept, and the chip is
    // simply absent.
    const watching = screen.getByLabelText('Watching 0');
    expect(watching.tagName).toBe('A');
    expect(watching.classList.contains('header-badge-empty')).toBe(true);
  });

  test('an empty queue draws NO chip, and stays a reachable link', () => {
    // The chip is a notification badge: its presence means "there is
    // something here". Three zeros must therefore draw three bare
    // glyphs, not a row of noughts.
    mockCounts = {
      ...mockCounts,
      inbox: 0,
      mentions: 0,
      watching: 0,
    };
    renderHeader();

    for (const label of ['Inbox 0', 'Mentions 0', 'Watching 0']) {
      const badge = screen.getByLabelText(label);
      expect(
        badge.querySelector('.header-badge-chip'),
        `${label} must not draw a chip at zero`,
      ).toBeNull();
      // The dim paint carries "empty" instead…
      expect(badge.classList.contains('header-badge-empty')).toBe(true);
      // …and the badge remains a real link: the count is an UNREAD
      // counter, not the queue's length, so a chip-less queue routinely
      // still holds tasks and must stay reachable and keyboard-focusable.
      expect(badge.tagName).toBe('A');
    }
  });

  test('the number never doubles up in the accessible name', () => {
    // The chip is visible text AND the button carries an aria-label with
    // the same number. aria-label wins in the accname algorithm, so the
    // name must be exactly "Inbox 2" — never "Inbox 2 2" — and the chip
    // is aria-hidden to say so.
    mockCounts = { ...mockCounts, inbox: 2 };
    renderHeader();

    const inbox = screen.getByRole('link', { name: 'Inbox 2' });
    expect(
      inbox.querySelector('.header-badge-chip')?.getAttribute('aria-hidden'),
    ).toBe('true');
    expect(screen.queryByRole('link', { name: 'Inbox 2 2' })).toBeNull();
  });

  test('a queue badge names that queue as its destination', () => {
    mockCounts = { ...mockCounts, mentions: 5 };
    renderHeader('/');

    const badge = screen.getByRole('link', { name: 'Mentions 5' });
    // sk-303.13 (T027) — the selection travels in the ADDRESS, not
    // through a setter: `useLayoutState.inboxTab` reads `?tab=`, so the
    // column's own picker and this badge are still one selection.
    expect(badge.getAttribute('href')).toBe('/?tab=mentions');
    fireEvent.click(badge);
    expect(setInboxTab).not.toHaveBeenCalled();
    // Column already expanded → no pointless state write.
    expect(setInboxCollapsed).not.toHaveBeenCalled();
  });

  test('a queue badge expands the Queues column when it is a sliver', () => {
    mockLayout = { inboxCollapsed: true, inboxTab: 'inbox' };
    renderHeader('/');

    fireEvent.click(screen.getByRole('link', { name: 'Watching 0' }));

    expect(setInboxCollapsed).toHaveBeenCalledWith(false);
  });

  // sk-303.15 removed `/legacy/projects` from this row with the route
  // tree behind it. Two focus routes are left and both stay listed — the
  // claim is about the CLASS of surface, not about one page, so it needs
  // more than a single example to keep meaning what it says.
  test.each(['/settings/api-keys', '/activity'])(
    'a queue badge on %s points back at the shell, on the chosen queue',
    (pathname) => {
      renderHeader(pathname);

      // Those surfaces have no Queues column at all, so the destination
      // is the shell root CARRYING the queue — the address names it
      // rather than relying on local state to restore it after the jump.
      expect(
        screen.getByRole('link', { name: 'Watching 0' }).getAttribute('href'),
      ).toBe('/?tab=watching');
    },
  );

  test('the badge of the queue on screen is marked as current', () => {
    mockLayout = { inboxCollapsed: false, inboxTab: 'mentions' };
    renderHeader('/');

    const mentions = screen.getByRole('link', { name: 'Mentions 0' });
    expect(mentions.getAttribute('aria-current')).toBe('true');
    expect(mentions.classList.contains('header-badge-active')).toBe(true);

    const inbox = screen.getByRole('link', { name: 'Inbox 2' });
    expect(inbox.getAttribute('aria-current')).toBeNull();
  });

  test('no badge is marked current off the shell — the column is not there', () => {
    mockLayout = { inboxCollapsed: false, inboxTab: 'mentions' };
    // Was `/legacy`, which sk-303.15 deleted. `/activity` is the same
    // case: mounted outside the Shell, so no Queues column is on screen.
    renderHeader('/activity');

    expect(
      screen.getByRole('link', { name: 'Mentions 0' }).getAttribute('aria-current'),
    ).toBeNull();
  });

  test('Escape closes the account menu', () => {
    renderHeaderWithMenu();
    const logout = screen.getByRole('button', { name: /Log out/i });
    expect(logout).toBeTruthy();

    // The panel traps focus while open, so a real Escape is dispatched
    // from INSIDE the dropdown — fire it there rather than on <body>,
    // which no focused element would ever be.
    fireEvent.keyDown(logout, { key: 'Escape' });

    expect(screen.queryByRole('button', { name: /Log out/i })).toBeNull();
    expect(
      screen
        .getByRole('button', { name: 'Account menu — admin' })
        .getAttribute('aria-expanded'),
    ).toBe('false');
  });
});

/**
 * sk-285.2.19 — the tree table's column picker lives beside the board's
 * card-property picker, in the rail's View settings popover, and is
 * gated on the view it shapes.
 *
 * A knob that shapes the tree must not be reachable while the board is
 * on screen: it would silently do nothing, which reads as broken. This
 * asserts the gate in both directions through the REAL
 * TasksUiStateProvider (the harness above mounts it), so the control and
 * the state it drives cannot drift apart.
 */
describe('HeaderBar — sk-285.2.19 tree column picker', () => {
  // The popover animates in, so every assertion waits for the dropdown
  // itself before reading its contents. Asserting a control is ABSENT
  // without that wait would pass on an empty portal — i.e. it would pass
  // no matter what the gate does.
  async function openViewSettings() {
    fireEvent.click(screen.getByRole('button', { name: 'View settings' }));
    return screen.findByRole('dialog');
  }

  afterEach(() => {
    localStorage.removeItem('skein.tasks.view');
  });

  test('tree view offers the table columns', async () => {
    localStorage.setItem('skein.tasks.view', 'tree');
    renderHeader();
    const panel = await openViewSettings();

    expect(within(panel).getByText('Table columns')).toBeTruthy();
    // …and the board's knobs are not in the way.
    expect(within(panel).queryByText('Card properties')).toBeNull();
    expect(within(panel).queryByText('Columns')).toBeNull();
  });

  test('board view does not — it would shape nothing', async () => {
    localStorage.setItem('skein.tasks.view', 'kanban');
    renderHeader();
    const panel = await openViewSettings();

    expect(within(panel).getByText('Card properties')).toBeTruthy();
    expect(within(panel).queryByText('Table columns')).toBeNull();
  });

  test('and neither does cards view', async () => {
    localStorage.setItem('skein.tasks.view', 'cards');
    renderHeader();
    const panel = await openViewSettings();

    expect(within(panel).queryByText('Table columns')).toBeNull();
    expect(within(panel).queryByText('Card properties')).toBeNull();
  });
});

/**
 * Cards view gets a picker of its own.
 *
 * The acceptance complaint this answers: opening «View settings» in the
 * list showed an EMPTY panel — a control that opens onto nothing reads
 * as broken, not as "there is nothing to configure here". The list now
 * carries the same «which fields» switch list the board and the tree
 * have, gated on cards view exactly as those two are gated on theirs.
 *
 * Both directions again: a knob that shapes the list must not be
 * reachable from the board or the tree, where it would silently do
 * nothing.
 */
describe('HeaderBar — the list attribute picker', () => {
  async function openViewSettings() {
    fireEvent.click(screen.getByRole('button', { name: 'View settings' }));
    return screen.findByRole('dialog');
  }

  afterEach(() => {
    localStorage.removeItem('skein.tasks.view');
  });

  test('cards view offers the card attributes — the panel is not empty any more', async () => {
    localStorage.setItem('skein.tasks.view', 'cards');
    renderHeader();
    const panel = await openViewSettings();

    expect(within(panel).getByText('Card attributes')).toBeTruthy();
  });

  test('tree view does not — it would shape nothing there', async () => {
    localStorage.setItem('skein.tasks.view', 'tree');
    renderHeader();
    const panel = await openViewSettings();

    expect(within(panel).queryByText('Card attributes')).toBeNull();
    expect(within(panel).getByText('Table columns')).toBeTruthy();
  });

  test('and neither does board view', async () => {
    localStorage.setItem('skein.tasks.view', 'kanban');
    renderHeader();
    const panel = await openViewSettings();

    expect(within(panel).queryByText('Card attributes')).toBeNull();
    expect(within(panel).getByText('Card properties')).toBeTruthy();
  });
});

/**
 * sk-285.2.20 — the two View-settings pickers are WIRED: what the user
 * ticks reaches the preference, and what the preference holds is what
 * the picker shows.
 *
 * The describe above pins that each picker appears in the view it
 * shapes; `TreeColumnsSelect.test.tsx` / `kanbanCardFields*.test.*` pin
 * the controls and the storage in isolation, against `vi.fn()` and a
 * bare provider. Between those sits one line per picker in
 * `HeaderBar.tsx` — `value={ui.treeColumns} onChange={ui.setTreeColumns}`
 * and its card-field twin — and nothing could see it: replacing either
 * `onChange` with `() => {}`, or either `value` with a hard-coded set,
 * left the whole suite green. A picker that saves nothing and a picker
 * that shows somebody else's set are exactly the two shapes that bug
 * takes, so both directions are asserted here, through the REAL
 * `TasksUiStateProvider` the harness already mounts.
 *
 * The probe below is the reader: it renders the context the header
 * writes into, so the assertion is about the STATE the tree and the
 * board go on to read — not about a spy the header was handed.
 */

/** Renders the two picked sets from the same context the header drives. */
function UiProbe() {
  const ui = useTasksUiState();
  return (
    <>
      {/* Sorted: the sets are sets — membership is the subject, order is
          not a promise either picker makes. */}
      <div data-testid="probe-tree-columns">
        {[...ui.treeColumns].sort().join(',')}
      </div>
      <div data-testid="probe-card-fields">
        {[...ui.kanbanCardFields].sort().join(',')}
      </div>
      <div data-testid="probe-list-fields">
        {[...ui.listCardFields].sort().join(',')}
      </div>
      {/* sk-285.7.11 (VS4) — «Reset to default» in board view puts BOTH
          of that view's knobs back, so the axis has to be readable too;
          without it the reset test could only see half of what it
          undoes. */}
      <div data-testid="probe-kanban-axis">{ui.kanbanAxis}</div>
    </>
  );
}

function renderHeaderWithProbe() {
  return render(
    <MantineProvider>
      <MemoryRouter initialEntries={['/']}>
        <TasksUiStateProvider>
          <HeaderBar />
          <UiProbe />
        </TasksUiStateProvider>
      </MemoryRouter>
    </MantineProvider>,
  );
}

describe('HeaderBar — sk-285.2.20 the View settings pickers drive the real state', () => {
  async function openViewSettings() {
    fireEvent.click(screen.getByRole('button', { name: 'View settings' }));
    return screen.findByRole('dialog');
  }

  /** The MultiSelect box named `label`, with its pills, inside the panel. */
  function pickerBox(panel: HTMLElement, label: string): HTMLElement {
    return within(panel)
      .getByRole('textbox', { name: label })
      .closest('.task-filter-select') as HTMLElement;
  }

  /** Open the picker's dropdown and tick the option starting with `name`. */
  async function tick(panel: HTMLElement, label: string, name: RegExp) {
    fireEvent.click(within(panel).getByRole('textbox', { name: label }));
    fireEvent.click(await screen.findByRole('option', { name }));
  }

  function probe(
    which: 'tree-columns' | 'card-fields' | 'list-fields',
  ): string {
    return screen.getByTestId(`probe-${which}`).textContent ?? '';
  }

  afterEach(() => {
    localStorage.removeItem('skein.tasks.view');
    localStorage.removeItem('skein.tasks.treeColumns');
    localStorage.removeItem('skein.tasks.kanbanCardFields');
    localStorage.removeItem('skein.tasks.listCardFields');
  });

  test('ticking a table column changes the set the tree will read', async () => {
    // `labels` is off by default, so the resulting set cannot be
    // confused with the one that went in.
    localStorage.setItem('skein.tasks.view', 'tree');
    renderHeaderWithProbe();
    const panel = await openViewSettings();

    expect(probe('tree-columns')).toBe([...TREE_DEFAULT_COLUMNS].sort().join(','));
    await tick(panel, 'Table columns', /^Labels/);
    expect(probe('tree-columns')).toBe(
      [...TREE_DEFAULT_COLUMNS, 'labels'].sort().join(','),
    );
  });

  test('un-ticking a table column takes it out of that set', async () => {
    localStorage.setItem('skein.tasks.view', 'tree');
    renderHeaderWithProbe();
    const panel = await openViewSettings();

    await tick(panel, 'Table columns', /^Assignee/);
    expect(probe('tree-columns')).toBe(
      TREE_DEFAULT_COLUMNS.filter((c) => c !== 'assignee')
        .slice()
        .sort()
        .join(','),
    );
  });

  test('the table-column picker shows the STORED set, not a fixed one', async () => {
    // Two defaults dropped and `created` — which is off by default —
    // switched on: no hard-coded set can produce this list.
    localStorage.setItem('skein.tasks.view', 'tree');
    localStorage.setItem('skein.tasks.treeColumns', 'id,type,created');
    renderHeaderWithProbe();
    const panel = await openViewSettings();

    const box = pickerBox(panel, 'Table columns');
    expect(box.textContent).toContain('ID');
    expect(box.textContent).toContain('Type');
    expect(box.textContent).toContain('Created');
    expect(box.textContent).not.toContain('Assignee');
    expect(box.textContent).not.toContain('Status');
  });

  test('ticking a card property changes the set the board will read', async () => {
    localStorage.setItem('skein.tasks.view', 'kanban');
    renderHeaderWithProbe();
    const panel = await openViewSettings();

    expect(probe('card-fields')).toBe(
      [...KANBAN_DEFAULT_CARD_FIELDS].sort().join(','),
    );
    await tick(panel, 'Card properties', /^Labels/);
    expect(probe('card-fields')).toBe(
      [...KANBAN_DEFAULT_CARD_FIELDS, 'labels'].sort().join(','),
    );
  });

  test('the card-property picker shows the STORED set, not a fixed one', async () => {
    localStorage.setItem('skein.tasks.view', 'kanban');
    localStorage.setItem('skein.tasks.kanbanCardFields', 'labels,created');
    renderHeaderWithProbe();
    const panel = await openViewSettings();

    const box = pickerBox(panel, 'Card properties');
    expect(box.textContent).toContain('Labels');
    expect(box.textContent).toContain('Created');
    expect(box.textContent).not.toContain('Priority');
    expect(box.textContent).not.toContain('Assignee');
  });

  /* The list's picker is the third one, and it gets the same two
     assertions for the same reason: one line in `HeaderBar.tsx` wires it
     (`value={ui.listCardFields} onChange={ui.setListCardFields}`), and
     without these an empty `onChange` — a picker that saves nothing — or
     a hard-coded `value` — a picker showing somebody else's set — would
     leave the whole suite green. */

  test('ticking a card attribute changes the set the list will read', async () => {
    // `labels` is off by default, so the resulting set cannot be
    // confused with the one that went in.
    localStorage.setItem('skein.tasks.view', 'cards');
    renderHeaderWithProbe();
    const panel = await openViewSettings();

    expect(probe('list-fields')).toBe(
      [...LIST_DEFAULT_CARD_FIELDS].sort().join(','),
    );
    await tick(panel, 'Card attributes', /^Labels/);
    expect(probe('list-fields')).toBe(
      [...LIST_DEFAULT_CARD_FIELDS, 'labels'].sort().join(','),
    );
  });

  test('un-ticking a card attribute takes it out of that set', async () => {
    localStorage.setItem('skein.tasks.view', 'cards');
    renderHeaderWithProbe();
    const panel = await openViewSettings();

    await tick(panel, 'Card attributes', /^Assignee/);
    expect(probe('list-fields')).toBe(
      LIST_DEFAULT_CARD_FIELDS.filter((f) => f !== 'assignee')
        .slice()
        .sort()
        .join(','),
    );
  });

  test('the card-attribute picker shows the STORED set, not a fixed one', async () => {
    // Two defaults dropped and `created` — which is off by default —
    // switched on: no hard-coded set can produce this list.
    localStorage.setItem('skein.tasks.view', 'cards');
    localStorage.setItem('skein.tasks.listCardFields', 'id,type,created');
    renderHeaderWithProbe();
    const panel = await openViewSettings();

    const box = pickerBox(panel, 'Card attributes');
    expect(box.textContent).toContain('ID');
    expect(box.textContent).toContain('Type');
    expect(box.textContent).toContain('Created');
    expect(box.textContent).not.toContain('Assignee');
    expect(box.textContent).not.toContain('Status');
  });

  test('and narrowing the list does not move the board or the tree', async () => {
    // The three pickers share a shape; this is the wiring mistake that
    // shape invites — one `onChange` pointed at a neighbour's setter.
    localStorage.setItem('skein.tasks.view', 'cards');
    renderHeaderWithProbe();
    const panel = await openViewSettings();

    await tick(panel, 'Card attributes', /^Labels/);
    expect(probe('tree-columns')).toBe([...TREE_DEFAULT_COLUMNS].sort().join(','));
    expect(probe('card-fields')).toBe(
      [...KANBAN_DEFAULT_CARD_FIELDS].sort().join(','),
    );
  });
});

/**
 * The view switcher sits in the MIDDLE OF THE HEADER, not in the middle
 * of whatever room its neighbours leave.
 *
 * The acceptance complaint this answers: the switcher was wherever the
 * flex flow dropped it — inside `.header-controls`, after the queue
 * badges and the lens toggles — so a count going from 9 to 10, a
 * translated HOT ZONE label or a hidden badge slid it sideways.
 *
 * Under vitest there is no cascade and no layout engine (`css: false`),
 * so "it is centred" cannot be measured here and is NOT asserted. What is
 * asserted is the structure: the switcher is a direct child of
 * `.header-bar`, out of the rail, so the rail's contents cannot push it.
 */
describe('HeaderBar — the view switcher is centred on the header', () => {
  test('the switcher is a child of the header itself, not of the control rail', () => {
    const { container } = renderHeader();
    const bar = container.querySelector('.header-bar')!;
    const rail = container.querySelector('.header-controls')!;
    const swi = container.querySelector('.header-viewswitch')!;

    expect(swi.parentElement).toBe(bar);
    expect(rail.contains(swi)).toBe(false);
  });

  test('and it is the MIDDLE of the header three children', () => {
    // Brand, switcher, rail — the three grid tracks, in that order, so
    // the tab order reads the way the header looks.
    const { container } = renderHeader();
    const kids = Array.from(container.querySelector('.header-bar')!.children);
    expect(kids).toHaveLength(3);
    expect(kids[0].className).toContain('header-logo');
    expect(kids[1].className).toContain('header-viewswitch');
    expect(kids[2].className).toContain('header-controls');
  });
});

/* ══════════════════════════════════════════════════════════════════════
 * sk-285.2.24 — the mark in the header.
 * ═════════════════════════════════════════════════════════════════════ */

describe('HeaderBar — sk-285.2.24 the Skein mark', () => {
  beforeEach(() => {
    mockLayout = { ...mockLayout, inboxCollapsed: false };
  });
  afterEach(cleanup);

  test('the brand is the mark followed by the word, and the wings are gone', () => {
    renderHeader();
    const link = screen.getByRole('link', { name: /skein/i });
    const mark = link.querySelector('.header-logo-mark');
    expect(mark, 'the brand link renders no mark').not.toBeNull();
    // Mark FIRST, word after it — the acceptance remark was about the
    // order, so the order is what is asserted, not merely the presence.
    expect(link.firstElementChild).toBe(mark);
    expect(link.textContent).toBe('SKEIN');
    // The ░▒▓ wings are gone from the markup…
    expect(link.querySelector('.header-logo-wing')).toBeNull();
    expect(link.textContent).not.toMatch(/[░▒▓]/);
  });

  test('the mark is decorative — the link keeps ONE accessible name', () => {
    renderHeader();
    const link = screen.getByRole('link', { name: /skein/i });
    const mark = link.querySelector('.header-logo-mark')!;
    expect(mark.getAttribute('aria-hidden')).toBe('true');
    // Not a tab stop of its own, and no <title> that would make a screen
    // reader announce the brand twice.
    expect(mark.getAttribute('focusable')).toBe('false');
    expect(mark.querySelector('title')).toBeNull();
    // Exactly one link named for the brand — if the mark contributed a
    // name of its own this query would find the same link twice over.
    expect(screen.getAllByRole('link', { name: /skein/i })).toHaveLength(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════
 * sk-285.6.15 — the UI language moved into the rail.
 * ═════════════════════════════════════════════════════════════════════ */

describe('HeaderBar — sk-285.6.15 the language control in the rail', () => {
  afterEach(cleanup);

  test('it stands in the rail, immediately before the avatar', () => {
    const { container } = renderHeader();
    const rail = container.querySelector('.header-controls')!;
    const lang = container.querySelector('.header-lang-anchor')!;
    const user = container.querySelector('.header-user-anchor')!;

    // A child of the RAIL, not of the header: that is what puts its
    // width inside the rail's grid track (sk-285.2.25).
    expect(lang.parentElement).toBe(rail);
    // Language and avatar are the rail's last two controls, in that
    // order and with nothing between them — one "me and this device"
    // cluster, no divider.
    const kids = Array.from(rail.children);
    expect(kids.indexOf(lang)).toBe(kids.length - 2);
    expect(kids.indexOf(user)).toBe(kids.length - 1);
  });

  test('the language button shows the tag alone, with no flag', () => {
    renderHeader();
    const button = screen.getByRole('button', { name: 'Language: English' });
    // sk-285.7.2.38 — the control's content went from a flag SVG to §6's
    // mono tag.
    expect(button.textContent).toBe('en');
    expect(button.querySelector('.header-lang-code')).not.toBeNull();
    expect(button.querySelector('svg')).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════
 * sk-285.6.16 — Logout looks like a menu row, stays a button.
 * ═════════════════════════════════════════════════════════════════════ */

describe('HeaderBar — sk-285.6.16 Logout in the row of menu items', () => {
  afterEach(cleanup);

  test('it wears the menu-item row but is still a <button>, not a link', () => {
    renderHeaderWithMenu();
    const logout = screen.getByRole('button', { name: /Log out/i });

    expect(logout.tagName).toBe('BUTTON');
    // A logout CHANGES STATE; as an <a href> it would be openable in a
    // new tab and by middle click, and a /logout route would fire on
    // link prefetch. The parity with the other entries is visual only.
    expect(logout.getAttribute('href')).toBeNull();
    expect(logout.classList.contains('header-drawer-item')).toBe(true);
    // The bespoke class is gone from the markup…
    expect(logout.classList.contains('logout-btn')).toBe(false);
    expect(document.querySelector('.logout-btn')).toBeNull();
  });

  test('it still awaits logout, and a rejection is surfaced, not swallowed', async () => {
    logoutSpy.mockRejectedValueOnce(new Error('session server unreachable'));
    renderHeaderWithMenu();

    fireEvent.click(screen.getByRole('button', { name: /Log out/i }));
    await waitFor(() => expect(logoutSpy).toHaveBeenCalledTimes(1));
    // The failure reaches the user as a toast carrying the reason. The
    // silent `void logout()` this replaced left the UI claiming "logged
    // in" with tokens possibly half-cleared.
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('session server unreachable'),
    );
  });
});

/* ══════════════════════════════════════════════════════════════════════
 * sk-285.6.17 — the view switcher gets you back to the tasks.
 * ═════════════════════════════════════════════════════════════════════ */

describe('HeaderBar — sk-285.6.17 the view switcher off the main shell', () => {
  afterEach(() => {
    cleanup();
    localStorage.removeItem('skein.tasks.view');
  });

  test('from a focus page it sets the view AND lands on the main shell', () => {
    localStorage.setItem('skein.tasks.view', 'cards');
    renderHeader('/settings/api-keys');

    fireEvent.click(screen.getByRole('button', { name: 'View: Tree' }));

    // Same arc `goToSidebarTab` already draws for the queue badges: on a
    // focus page there is no Tasks column, so flipping the view alone
    // leaves the user staring at the page they were already on.
    expect(navigateSpy).toHaveBeenCalledWith('/');
    // The view is SET, not merely navigated to: a hop that landed on the
    // shell still showing the previous layout would be the same dead
    // click in a different place. That the value also survives the
    // provider unmount the real navigation causes is pinned separately,
    // in `lib/__tests__/viewPersistOnUnmount.test.tsx` — jsdom keeps
    // this provider mounted (navigate is a spy), so this assertion alone
    // could not tell the two apart.
    expect(localStorage.getItem('skein.tasks.view')).toBe('tree');
  });

  // sk-303.15 dropped `/legacy` from this list along with the route tree
  // behind it. The row's point — «every focus route, not just settings» —
  // still needs a second route to make it, and /activity is it: it is
  // mounted outside the Shell, so `isMainShell` returns false there too.
  test.each(['/activity'])(
    'the same from %s — every focus route, not just settings',
    (pathname) => {
      renderHeader(pathname);
      fireEvent.click(screen.getByRole('button', { name: 'View: Board' }));
      expect(navigateSpy).toHaveBeenCalledWith('/');
    },
  );

  test('on the main shell it changes the view and navigates NOWHERE', () => {
    localStorage.setItem('skein.tasks.view', 'cards');
    renderHeader('/');

    fireEvent.click(screen.getByRole('button', { name: 'View: Tree' }));

    expect(navigateSpy).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: 'View: Tree' }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(localStorage.getItem('skein.tasks.view')).toBe('tree');
  });
});

/* ══════════════════════════════════════════════════════════════════════
 * sk-285.6.18 — the Legacy dashboard entry is gone from the menu.
 * ═════════════════════════════════════════════════════════════════════ */

describe('HeaderBar — sk-285.6.18 no Legacy entry in the account menu', () => {
  afterEach(cleanup);

  test('the menu offers no way into /legacy', () => {
    renderHeaderWithMenu();

    expect(screen.queryByRole('link', { name: /Legacy/i })).toBeNull();
    // Nothing in the menu points at the legacy surface any more —
    // asserted on the hrefs rather than on the label, so re-adding the
    // entry under a different name goes red too.
    const menu = document.querySelector('.header-menu')!;
    const hrefs = [...menu.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs.some((h) => h?.startsWith('/legacy'))).toBe(false);
    // The divider that separated the Settings links from that one entry
    // has nothing left to separate.
    expect(menu.querySelector('.header-drawer-divider')).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════
 * sk-285.7.11 — fidelity F2, the half a render can see.
 *
 * The theme segment's behaviour is in `HeaderBar.theme.test.tsx`, where the theme machinery is real.
 * What is asserted HERE is composition and wiring: which elements the
 * menu and the panel put on screen, and what their controls do.
 * ═════════════════════════════════════════════════════════════════════ */

describe('HeaderBar — sk-285.7.11 the account menu (AM2 / AM4 / AM5)', () => {
  afterEach(cleanup);

  test('the identity block names the account, not just the user', () => {
    // AM2 — the name alone does not say WHICH account you are signed
    // into, and this menu is the only surface in the shell that can.
    renderHeaderWithMenu();
    const block = document.querySelector('.header-menu-user')!;
    expect(within(block as HTMLElement).getByText('admin')).toBeTruthy();
    expect(within(block as HTMLElement).getByText('admin@skein.local')).toBeTruthy();
  });

  test('every settings row leads with a glyph, and Logout with its own', () => {
    // AM4 — the menu drew a column of bare words; §8 lists key / users /
    // bell / device-mobile-message / palette / logout with nowhere to be
    // spent. Asserted per ROW rather than by counting `svg` in the
    // panel, so an icon landing on the wrong row cannot pass.
    // sk-402 replaced device-mobile-message (its page is gone) with §8's
    // `lock` on the password row; WHICH rows exist is compared against
    // the settings tab row in `AccountMenuSettingsItems.test.tsx`.
    renderHeaderWithMenu();
    for (const name of ['Password', 'API keys', 'Users', 'Notifications', 'Theme']) {
      const row = screen.getByRole('link', { name });
      expect(row.querySelector('svg.header-drawer-icon'), name).toBeTruthy();
    }
    const logout = screen.getByRole('button', { name: 'Log out' });
    expect(logout.querySelector('svg.header-drawer-icon')).toBeTruthy();
  });

  test('Logout is marked as the one row that is not navigation', () => {
    // AM5 — the colour itself is a declaration and lives in the CSS
    // guard; what a render can honestly see is that the row carries the
    // class that colour hangs off, and that no OTHER menu row does.
    renderHeaderWithMenu();
    const logout = screen.getByRole('button', { name: 'Log out' });
    expect(logout.classList.contains('header-drawer-logout')).toBe(true);
    const marked = document.querySelectorAll('.header-menu .header-drawer-logout');
    expect(marked.length).toBe(1);
  });
});

describe('HeaderBar — sk-285.7.11 View settings (VS3 / VS4 / VS5)', () => {
  afterEach(() => {
    cleanup();
    localStorage.removeItem('skein.tasks.view');
    localStorage.removeItem('skein.tasks.listCardFields');
    localStorage.removeItem('skein.tasks.treeColumns');
    localStorage.removeItem('skein.tasks.kanbanCardFields');
    localStorage.removeItem('skein.tasks.kanbanAxis');
  });

  // The popover animates in, so every test waits for the dropdown
  // itself before reading its contents — asserting on an un-awaited
  // portal passes no matter what the panel holds.
  async function openViewSettings() {
    renderHeaderWithProbe();
    fireEvent.click(screen.getByRole('button', { name: 'View settings' }));
    return screen.findByRole('dialog');
  }

  test('the panel closes from its own ✕', async () => {
    // VS5 — Esc and click-outside already closed it, and both are
    // invisible: a floating panel with no visible way out does not read
    // as dismissible at all.
    const panel = await openViewSettings();
    const close = within(panel).getByRole('button', { name: 'Close view settings' });
    fireEvent.click(close);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  test('the dashed chip opens the picker it names', async () => {
    // VS3 — the chip is a real affordance, not a decoration: it focuses
    // and clicks the actual field, so the options the picker holds
    // appear. Asserted on the OPTIONS rather than on a call spy, because
    // "the picker opened" is the promise the label makes.
    const panel = await openViewSettings();
    expect(screen.queryAllByRole('option').length).toBe(0);
    fireEvent.click(within(panel).getByRole('button', { name: /Add attribute/ }));
    await waitFor(() => expect(screen.queryAllByRole('option').length).toBeGreaterThan(0));
  });

  test('the footer states the panel\u2019s reach and hands back the default set', async () => {
    // VS4 — once a user had switched attributes off there was no way to
    // find out what the shipped set had been.
    const panel = await openViewSettings();
    expect(
      within(panel).getByText(/Cards, Board and Tree each keep their own set/),
    ).toBeTruthy();

    const listFields = () => screen.getByTestId('probe-list-fields').textContent ?? '';
    const shipped = [...LIST_DEFAULT_CARD_FIELDS].sort().join(',');
    expect(listFields()).toBe(shipped);

    // Narrow the set through the picker the panel actually offers, so
    // the reset has something real to undo.
    fireEvent.click(within(panel).getByRole('textbox', { name: 'Card attributes' }));
    fireEvent.click(await screen.findByRole('option', { name: /^Assignee/ }));
    expect(listFields()).not.toBe(shipped);

    fireEvent.click(within(panel).getByRole('button', { name: 'Reset to default' }));
    await waitFor(() => expect(listFields()).toBe(shipped));
  });

  test('reset puts the TREE’s columns back, and only those', async () => {
    // One branch per view, so a reset written for the view you happen to
    // be testing cannot pass for the other two. sk-285.7.11 caught this
    // the hard way: a mutant that disabled the board branch survived a
    // suite that only ever opened the panel in cards view.
    localStorage.setItem('skein.tasks.view', 'tree');
    const panel = await openViewSettings();
    const treeColumns = () => screen.getByTestId('probe-tree-columns').textContent ?? '';
    const listFields = () => screen.getByTestId('probe-list-fields').textContent ?? '';
    const shipped = [...TREE_DEFAULT_COLUMNS].sort().join(',');
    expect(treeColumns()).toBe(shipped);

    fireEvent.click(within(panel).getByRole('textbox', { name: 'Table columns' }));
    fireEvent.click(await screen.findByRole('option', { name: /^Labels/ }));
    expect(treeColumns()).not.toBe(shipped);

    const listBefore = listFields();
    fireEvent.click(within(panel).getByRole('button', { name: 'Reset to default' }));
    await waitFor(() => expect(treeColumns()).toBe(shipped));
    // Scoped: the three sets live under three keys on purpose, and a
    // reset that also cleared the list's attributes while you were
    // looking at the tree would be a destructive surprise.
    expect(listFields()).toBe(listBefore);
  });

  test('reset puts BOTH of the board’s knobs back', async () => {
    localStorage.setItem('skein.tasks.view', 'kanban');
    const panel = await openViewSettings();
    const axis = () => screen.getByTestId('probe-kanban-axis').textContent ?? '';
    const cardFields = () => screen.getByTestId('probe-card-fields').textContent ?? '';
    const shippedFields = [...KANBAN_DEFAULT_CARD_FIELDS].sort().join(',');
    expect(axis()).toBe(KANBAN_DEFAULT_AXIS);
    expect(cardFields()).toBe(shippedFields);

    // Move the axis…
    fireEvent.click(within(panel).getByRole('textbox', { name: 'Columns' }));
    fireEvent.click(await screen.findByRole('option', { name: /^Priority/ }));
    await waitFor(() => expect(axis()).not.toBe(KANBAN_DEFAULT_AXIS));
    // …and the card properties, so the reset has both to undo.
    fireEvent.click(within(panel).getByRole('textbox', { name: 'Card properties' }));
    fireEvent.click(await screen.findByRole('option', { name: /^Labels/ }));
    expect(cardFields()).not.toBe(shippedFields);

    fireEvent.click(within(panel).getByRole('button', { name: 'Reset to default' }));
    await waitFor(() => expect(axis()).toBe(KANBAN_DEFAULT_AXIS));
    expect(cardFields()).toBe(shippedFields);
  });
});

// ───────────── sk-303.13 (T027, row 40) — badge navigation ─────────────

describe('HeaderBar — a badge is a link to the tab, not a hidden toggle', () => {
  beforeEach(() => {
    mockCounts = {
      inbox: 3,
      mentions: 2,
      watching: 5,
      onMeOpenCount: 0,
      delegatedOpenCount: 0,
      reviewMechanicEnabled: false,
      delegatedUnreviewedCount: null,
    };
    mockRingingTaskCount = 0;
    mockLayout = { inboxCollapsed: false, inboxTab: 'inbox' };
  });

  test.each([
    ['Inbox 3', 'inbox'],
    ['Mentions 2', 'mentions'],
    ['Watching 5', 'watching'],
  ])('from a focus page, %s lands on the address of that tab', (label, tab) => {
    // On /settings/* the left column isn't mounted, so flipping the tab
    // in place would leave the user staring at the settings page. The
    // badge has to navigate — and to the tab's OWN address, not to the
    // app root with the tab restored from local state.
    renderHeader('/settings/api-keys');
    const link = screen.getByRole('link', { name: label });
    // A real link: the destination is readable, copyable and openable in
    // a new tab before anyone clicks anything.
    expect(link.getAttribute('href')).toBe(`/?tab=${tab}`);
    fireEvent.click(link);
    expect(screen.getByTestId('url').textContent).toBe(`/?tab=${tab}`);
  });

  test.each([
    ['Inbox 3', 'inbox'],
    ['Mentions 2', 'mentions'],
    ['Watching 5', 'watching'],
  ])('on the main shell, %s writes ?tab= on the current path', (label, tab) => {
    // The column is right there, so the path stays and only the tab
    // parameter moves — `?file=` and everything else on the address
    // survive the switch.
    renderHeader('/projects/sk/issues/sk-42?file=att-1');
    const link = screen.getByRole('link', { name: label });
    expect(link.getAttribute('href')).toBe(
      `/projects/sk/issues/sk-42?file=att-1&tab=${tab}`,
    );
    fireEvent.click(link);
    expect(screen.getByTestId('url').textContent).toBe(
      `/projects/sk/issues/sk-42?file=att-1&tab=${tab}`,
    );
  });

  test('a collapsed column is expanded and scrolled by the click side effect', () => {
    // The address alone cannot do this: re-clicking the tab you are
    // already on lands on the same URL, so nothing downstream re-runs.
    mockLayout = { inboxCollapsed: true, inboxTab: 'inbox' };
    renderHeader('/projects/sk/issues/sk-42');
    fireEvent.click(screen.getByRole('link', { name: 'Watching 5' }));
    expect(setInboxCollapsed).toHaveBeenCalledWith(false);
    // The tab itself comes from the address now, not from a setter.
    expect(setInboxTab).not.toHaveBeenCalled();
  });

  test('an empty queue is STILL a link', () => {
    // The opposite of what T027 asserted for the inline text badges it
    // wrote, and deliberately so — see `QueueBadge`. The chip counts
    // UNREAD, not queue length: «Mentions 0» is a queue with nothing new
    // in it, and «Inbox 0» is an assignment list with no unaccepted
    // items — both routinely hold plenty to look at. On this rail the
    // badge is the queue's only affordance, so making it inert at zero
    // would put three of the three queues out of reach on a quiet day.
    mockCounts = { ...mockCounts, mentions: 0 };
    renderHeader('/');
    const link = screen.getByRole('link', { name: 'Mentions 0' });
    expect(link.getAttribute('href')).toBe('/?tab=mentions');
  });
});

// ───────────── sk-303.13 (T025, row 39) — the removed queue ─────────────

describe('HeaderBar — the Outbox badge is gone, the My-assigned lens is not', () => {
  beforeEach(() => {
    mockCounts = {
      inbox: 3,
      mentions: 2,
      watching: 5,
      onMeOpenCount: 1,
      delegatedOpenCount: 6,
      reviewMechanicEnabled: false,
      delegatedUnreviewedCount: null,
    };
    mockRingingTaskCount = 0;
    mockLayout = { inboxCollapsed: false, inboxTab: 'inbox' };
  });

  test('the header carries exactly the three surviving queue badges', () => {
    renderHeader('/');
    // Enumerated, not "queryBy(Outbox) is null": a whitelist also fails
    // when a fourth queue is added without a decision, which is the
    // other half of "the header shows what exists".
    const labels = Array.from(
      // The HOT ZONE link wears the same chrome class but is not a
      // queue — it counts nothing and has no tab.
      document.querySelectorAll('.header-badge[aria-label]:not(.header-badge-hotzone)'),
    ).map((el) => el.getAttribute('aria-label'));
    expect(labels).toEqual(['Inbox 3', 'Mentions 2', 'Watching 5']);
  });

  test('nothing in the header offers the removed tab as a destination', () => {
    renderHeader('/');
    const hrefs = Array.from(document.querySelectorAll('a[href]')).map((a) =>
      a.getAttribute('href'),
    );
    expect(hrefs.some((h) => h !== null && h.includes('tab=outbox'))).toBe(false);
  });

  test('the My-assigned lens button survives with its own count', () => {
    // Same word inside its class name and its storage key; a different
    // thing. Removing the queue must not have touched it.
    renderHeader('/');
    const lens = screen.getByRole('button', { name: 'Delegated 6' });
    expect(lens.getAttribute('aria-pressed')).toBe('false');
    lens.click();
    expect(toggleOutboxMode).toHaveBeenCalledTimes(1);
  });
});
