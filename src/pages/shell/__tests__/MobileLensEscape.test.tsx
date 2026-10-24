/**
 * sk-285.7.7 — on a phone, a lens that is ON is visible and escapable.
 *
 * ── The trap ─────────────────────────────────────────────────────────
 *
 * The three lenses (On me / Delegated / Budilnik) are GLOBAL: the root
 * `CLAUDE.md` defines the delegated one as narrowing the whole shell,
 * and INV-10 makes every zone counter and every list obey it. They are
 * also PERSISTED (`skein.outbox-mode` and its two siblings). And their
 * only controls are the pills in `.header-lenses`, which T024 put in the
 * list of seven blocks the mobile header does not draw.
 *
 * Compose the three and the phone becomes a state with no exit: turn a
 * lens on at a desk, open the same account on a phone, and the task list
 * is short, the zone counters are small, nothing on screen says why, and
 * nothing on screen can undo it. That is the defect — not "a control is
 * hidden", but "a narrowed view has neither an indicator nor an off
 * switch".
 *
 * ── The repair, and why it is a departure from §5 ─────────────────────
 *
 * Handoff §5 draws the mobile rail as "logo · views · Queues · avatar",
 * and T024 implemented exactly that. The layout is what is wrong here,
 * not the implementation, so this is a DELIBERATE departure from it,
 * recorded as a design decision. It is narrowed to the case that creates the
 * trap: the lens group is drawn on a phone only while a lens is ACTIVE,
 * and then only the active pill, without its word.
 *
 * An OFF lens narrows nothing and needs no exit, so the rail with every
 * lens off is §5's four slots unchanged. Turning a lens ON stays a
 * wide-screen action.
 *
 * ── What is pinned here ──────────────────────────────────────────────
 *
 * The rendered DOM fact: `.lens-pill.active` exists exactly when a lens
 * is on, it is a real toggle, and pressing it turns the lens off. The
 * pair check — lens OFF, and no `.active` pill anywhere — stops this from
 * passing on a surface that reads nothing. What the phone actually draws
 * is decided by the stylesheet and is seen in a browser, not here.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
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
 * The three lenses as real, mutable state — this file is about what
 * happens when one of them is ON, and a header rendered from constants
 * would never exercise the branch.
 *
 * They are a three-way mutex in `useLayoutState`, and the fixture keeps
 * that true: at most one is ever set here.
 */
let mockOutboxMode = false;
let mockOnMeMode = false;
let mockBudilnikMode = false;
const toggleOutboxMode = vi.fn();
const toggleOnMeMode = vi.fn();
const toggleBudilnikMode = vi.fn();
vi.mock('../../../lib/useLayoutState', () => ({
  useLayoutState: () => ({
    outboxMode: mockOutboxMode,
    toggleOutboxMode,
    onMeMode: mockOnMeMode,
    toggleOnMeMode,
    budilnikMode: mockBudilnikMode,
    toggleBudilnikMode,
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
  useInspectMode: () => ({
    enabled: false,
    enable: vi.fn(),
    disable: vi.fn(),
    toggle: vi.fn(),
  }),
}));

vi.mock('../../../components/VersionCheck', () => ({ AppVersionBadge: () => null }));
vi.mock('../../../components/ThemeToggle', () => ({ ThemeToggle: () => null }));
// sk-551.5 — the Appearance checkboxes read the ui-prefs query; this harness
// renders the header without a QueryClient, as for ThemeToggle above.
vi.mock('../../../components/IssueModalViewsSetting', () => ({ IssueModalViewsSetting: () => null }));
vi.mock('../../../components/DensitySetting', () => ({ DensitySetting: () => null }));
vi.mock('../../../components/NavLayoutSetting', () => ({ NavLayoutSetting: () => null }));

import { HeaderBar } from '../HeaderBar';
import { TasksUiStateProvider } from '../../../lib/useTasksUiState';
import { setViewportWidth } from '../../../test/viewport';

const MOBILE = 390;
const DESKTOP = 1440;

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

/** The pills the phone would draw: the ACTIVE ones, in the lens group. */
function activePills(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.header-lenses .lens-pill.active')];
}

beforeEach(() => {
  mockOutboxMode = false;
  mockOnMeMode = false;
  mockBudilnikMode = false;
  setViewportWidth(DESKTOP);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.documentElement.removeAttribute('data-width-mode');
});

// ─────────── the rendered half — the fact the sheet keys on ───────────

/**
 * The three lenses, each with the state flag that turns it on and the
 * count its pill prints. Enumerated from one list, so a fourth lens is
 * held to the same contract on the day it is added — and so the claim is
 * about LENSES rather than about the delegated one that happened to be
 * reported.
 */
const LENSES: ReadonlyArray<{
  name: string;
  turnOn: () => void;
  toggle: ReturnType<typeof vi.fn>;
  label: string;
}> = [
  {
    name: 'On me',
    turnOn: () => {
      mockOnMeMode = true;
    },
    toggle: toggleOnMeMode,
    label: 'On me 4',
  },
  {
    name: 'Delegated',
    turnOn: () => {
      mockOutboxMode = true;
    },
    toggle: toggleOutboxMode,
    label: 'Delegated 6',
  },
  {
    name: 'Alarm clock',
    turnOn: () => {
      mockBudilnikMode = true;
    },
    toggle: toggleBudilnikMode,
    label: 'Reminders',
  },
];

describe('sk-285.7.7 — an active lens announces itself and can be switched off', () => {
  test.each(LENSES)('$name: on a phone the active pill is present and is the off switch', (lens) => {
    lens.turnOn();
    setViewportWidth(MOBILE);
    renderHeader();

    // The mutex means there can only ever be this one.
    const pills = activePills();
    expect(pills, `${lens.name} is on but no active pill is rendered`).toHaveLength(1);

    const pill = pills[0];
    // It is the INDICATOR: a control that says out loud that it is on,
    // and names itself for anyone who cannot see the plate colour. The
    // word is hidden on a phone (the rail has no room — see the
    // stylesheet half), so the accessible name is the whole of the name.
    expect(pill.getAttribute('aria-pressed')).toBe('true');
    expect(pill.getAttribute('aria-label')).toContain(lens.label);

    // …and it is the EXIT: the same toggle, one tap.
    fireEvent.click(pill);
    expect(lens.toggle, `pressing the ${lens.name} pill did not toggle the lens`).toHaveBeenCalled();
  });

  test('PAIR — with every lens off there is no active pill to draw', () => {
    // Without this the assertions above hold on a header that draws all
    // three pills unconditionally, which is the layout §5 rejected and
    // the one the phone cannot afford. The stylesheet keys on `.active`,
    // so «the class appears only when a lens is on» is the DOM fact the
    // whole repair rests on.
    setViewportWidth(MOBILE);
    renderHeader();
    expect(activePills()).toHaveLength(0);
    // …and the pills themselves ARE mounted, so the rule that hides them
    // has something to select. One composition at every width.
    expect(document.querySelectorAll('.header-lenses .lens-pill')).toHaveLength(3);
  });

  test('the inactive lenses stay inactive while one is on', () => {
    // The pair check above proves «none on → none active». This is the
    // other direction: one on must not light the other two, or the
    // phone would draw three pills and overflow the rail.
    mockOutboxMode = true;
    setViewportWidth(MOBILE);
    renderHeader();
    expect(activePills()).toHaveLength(1);
    expect(
      [...document.querySelectorAll('.header-lenses .lens-pill')].filter(
        (el) => !el.classList.contains('active'),
      ),
    ).toHaveLength(2);
  });
});

// ─────────── the account menu — the other two rail controls ───────────

/**
 * §5 takes six more blocks off the phone's rail, and two of them were
 * the ONLY way to reach something. They fall back into the account menu,
 * which is the one menu surface a phone has (the avatar is one of §5's
 * four slots) and which costs no rail width at all.
 *
 * The two that did NOT come along are a decision and are recorded as one
 * in `HeaderBar.tsx`: View settings configures the
 * SHAPE the Tasks column is drawn in and can never hide a task or narrow
 * a count — the line this issue draws is between narrowing the data and
 * drawing it — and Inspect arms a click that posts a selector to a
 * paired MCP agent session, which has no phone workflow.
 */
describe('sk-285.7.7 — the phone reaches the language and HOT ZONE through the account menu', () => {
  function openAccountMenu() {
    const avatar = document.querySelector<HTMLElement>('.header-user-btn');
    expect(avatar, 'no account-menu button in the header').not.toBeNull();
    fireEvent.click(avatar!);
  }

  /** Language rows, wherever they are: the shared `LanguageChoiceList`. */
  function languageRows(): HTMLElement[] {
    return [...document.querySelectorAll<HTMLElement>('.header-lang-item')];
  }

  function hotZoneRows(): HTMLElement[] {
    return [...document.querySelectorAll<HTMLElement>('a.header-drawer-item')].filter(
      (a) => a.getAttribute('href') === '/activity',
    );
  }

  test('on a phone the menu carries both', () => {
    setViewportWidth(MOBILE);
    renderHeader();
    openAccountMenu();
    // Every supported language, each an exclusive choice — the same rows
    // the rail control opens, because it is the same component.
    expect(languageRows().length).toBeGreaterThanOrEqual(2);
    expect(languageRows().every((r) => r.getAttribute('role') === 'menuitemradio')).toBe(true);
    expect(languageRows().filter((r) => r.getAttribute('aria-checked') === 'true')).toHaveLength(1);
    expect(hotZoneRows()).toHaveLength(1);
  });

  test('choosing a language hands focus back to the avatar', () => {
    // These are the first entries in this menu that neither navigate nor
    // leave the page — they flip a setting and close the menu — so the
    // pressed row is unmounted under the caret. Without the return,
    // `document.activeElement` falls back to `<body>` and the next Tab
    // restarts at the top of the document. Measured, because the menu's
    // own docblock argues that no entry needed this, and that argument
    // stopped being true here.
    setViewportWidth(MOBILE);
    renderHeader();
    openAccountMenu();
    const other = languageRows().find((r) => r.getAttribute('aria-checked') === 'false');
    expect(other, 'only one language is offered — nothing to switch to').toBeTruthy();
    fireEvent.click(other!);
    expect(document.activeElement).toBe(document.querySelector('.header-user-btn'));
  });

  test('the HOT ZONE row says what it is and names where it goes', () => {
    // Same pair the rail link uses: the accessible name is longer than
    // the visible label and CONTAINS it (WCAG 2.5.3 Label in Name).
    setViewportWidth(MOBILE);
    renderHeader();
    openAccountMenu();
    const row = hotZoneRows()[0];
    const name = row.getAttribute('aria-label') ?? '';
    expect(row.textContent!.trim().length).toBeGreaterThan(0);
    expect(name).toContain(row.textContent!.trim());
  });

  test('PAIR — on a desktop it carries neither, because the rail does', () => {
    // A permanent duplicate would give the language two entries on every
    // screen wide enough to show the rail one, and sk-285.6.15 decided
    // WHICH of the two is the language's home. This fallback does not
    // reopen that: it exists only where the rail is not drawn.
    setViewportWidth(DESKTOP);
    renderHeader();
    openAccountMenu();
    expect(languageRows()).toHaveLength(0);
    expect(hotZoneRows()).toHaveLength(0);
  });

  test('the rail control is still mounted at both widths — the fallback replaces nothing', () => {
    // `CompactHeader.test.tsx` owns the full composition invariant; this
    // is the half that matters here, said next to the fallback it could
    // be mistaken for a replacement of.
    setViewportWidth(MOBILE);
    renderHeader();
    expect(document.querySelector('.header-lang-anchor')).not.toBeNull();
    expect(document.querySelector('.header-hotzone')).not.toBeNull();
  });
});
