/**
 * sk-402 — the account menu and the settings tab row name the SAME
 * sections.
 *
 * Two navigation surfaces lead into `/settings/*`: the account drawer in
 * the header (`HeaderBar.tsx`, the `header-drawer-section` labelled
 * "Settings") and the tab row every settings page wears
 * (`SettingsLayout.tsx`, `nav.settings-tabs`). Nothing held them
 * together, and after two waves they had drifted apart in both
 * directions at once: the drawer still offered "Push" — a page
 * `sk-303.13` deleted, whose address `App.tsx` now answers with
 * `<Navigate to="/settings/notifications">`, so the entry opened
 * something other than what it said — and it never learned about
 * `/settings/password`, which `sk-303.20` added to the tabs alone.
 *
 * ── Why the guard is written this way ───────────────────────────────
 *
 * The assertion is a COMPARISON of the two rendered surfaces, not a
 * hard-coded list of five addresses. A literal list would have to be
 * edited by the same hand that adds the next settings page, which is
 * exactly the hand that forgot the drawer this time; a comparison makes
 * the next divergence fail without anyone having to remember this file.
 *
 * Both sides are read from the DOM of the REAL components. The drawer's
 * `to=` props reach `href` only through `<Link>`, and the tab row is
 * derived from `SettingsLayout`'s own `TABS` (which is not exported —
 * rendering is how a test can see it at all). Reading either side out of
 * the source text would prove the two literals agree, not that the two
 * MENUS do.
 *
 * The admin/non-admin pair is not decoration: "Users" is admin-only on
 * both surfaces, and a guard run only as an admin would pass on a drawer
 * that showed Users to everyone.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MantineProvider } from '@mantine/core';
import type { ReactNode } from 'react';

// ─────────────────────────── Mocks ───────────────────────────

let mockRole: 'admin' | 'user' = 'admin';
vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u-1', username: 'admin', email: 'a@b.c', role: mockRole },
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
  useOptionalLayoutState: () => null,
  // `SettingsLayout` mounts its own provider stack because it renders
  // outside `Shell`; the mock has to carry that export or the layout
  // throws on the missing name before a single assertion runs.
  LayoutProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn() };
});

vi.mock('../../../lib/useReminders', () => ({
  useRingingTaskCount: () => 0,
  useRingEpoch: () => 0,
}));

vi.mock('../../../lib/useNotificationCounts', () => ({
  notificationCountsKey: ['notification-counts'] as const,
  useNotificationCounts: () => ({
    counts: {
      inbox: 0,
      mentions: 0,
      watching: 0,
      onMeOpenCount: 0,
      delegatedOpenCount: 0,
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
import { SettingsLayout } from '../../settings/new/SettingsLayout';
import { TasksUiStateProvider } from '../../../lib/useTasksUiState';

// ───────────────────────── Surfaces ─────────────────────────

/** Open the account menu and return the settings destinations it offers. */
function drawerSettingsHrefs(): string[] {
  render(
    <MantineProvider>
      <MemoryRouter initialEntries={['/']}>
        <TasksUiStateProvider>
          <HeaderBar />
        </TasksUiStateProvider>
      </MemoryRouter>
    </MantineProvider>,
  );
  // The avatar button opens the popover; the menu is not in the DOM
  // until it does, so this click is load-bearing, not setup noise.
  fireEvent.click(screen.getByRole('button', { name: /account menu/i }));
  const section = document.querySelector<HTMLElement>(
    'section.header-drawer-section[aria-label="Settings"]',
  );
  expect(section, 'the account menu has no Settings section').not.toBeNull();
  return [...within(section!).getAllByRole('link')].map(
    (a) => a.getAttribute('href') ?? '',
  );
}

/** Render a settings page's chrome and return the tab row's destinations. */
function tabHrefs(): string[] {
  render(
    <MantineProvider>
      <MemoryRouter initialEntries={['/settings/password']}>
        <SettingsLayout active="password">
          <div />
        </SettingsLayout>
      </MemoryRouter>
    </MantineProvider>,
  );
  const nav = document.querySelector<HTMLElement>('nav.settings-tabs');
  expect(nav, 'the settings chrome has no tab row').not.toBeNull();
  return [...within(nav!).getAllByRole('link')].map((a) => a.getAttribute('href') ?? '');
}

beforeEach(() => {
  mockRole = 'admin';
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('sk-402 — the two ways into Settings agree', () => {
  test('the drawer really lists destinations (an empty read passes everything)', () => {
    // The floor under the comparisons below: two empty lists are equal,
    // so without this a drawer that rendered no links at all — or a
    // section whose aria-label changed — would look like agreement.
    const drawer = drawerSettingsHrefs();
    expect(drawer.length).toBeGreaterThanOrEqual(4);
    for (const href of drawer) expect(href.startsWith('/settings/')).toBe(true);
  });

  test('as an admin, the drawer and the tab row name the same sections, in the same order', () => {
    const drawer = drawerSettingsHrefs();
    cleanup();
    expect(drawer).toEqual(tabHrefs());
  });

  test('as a plain user, both surfaces drop the admin-only section together', () => {
    mockRole = 'user';
    const drawer = drawerSettingsHrefs();
    cleanup();
    const tabs = tabHrefs();
    expect(drawer).toEqual(tabs);
    // Stated separately so the case cannot pass by both surfaces
    // keeping Users: the point is that the admin-only entry is gone.
    expect(drawer).not.toContain('/settings/users');
  });

  test('no drawer entry points at an address that only redirects', () => {
    // `/settings/push` is answerable on purpose — bookmarks and chat
    // history point at it — but it is a redirect to
    // `/settings/notifications` (the route, and the reason for it, are
    // pinned by `settingsRoutes.test.tsx`). A MENU entry leading there
    // opens a page other than the one it names, which is the defect
    // this issue is about.
    expect(drawerSettingsHrefs()).not.toContain('/settings/push');
  });
});
