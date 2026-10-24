/**
 * Regression — "clicking the avatar switches the theme to dark".
 *
 * The account menu never toggled anything. `useTheme()` — the hook that
 * reconciles `<html data-theme>` with the SERVER preference — used to be
 * mounted ONLY by `<ThemeToggle>`, which lives inside the account-menu
 * dropdown. Mantine mounts a popover's dropdown lazily, so the very
 * first `GET /me/theme` (and the repaint that follows it) happened at
 * the moment the user clicked their avatar: boot-painted light shell →
 * click → dark shell. `<ThemeSync>` now mounts the hook at the app root,
 * so the reconciliation happens on load and the avatar is inert.
 *
 * This file therefore renders the REAL `ThemeToggle` (the shared
 * `HeaderBar.test.tsx` stubs it out to avoid a QueryClient) next to
 * `<ThemeSync>`, with the themes API mocked, and pins:
 *   1. the server preference lands WITHOUT any interaction;
 *   2. clicking the avatar opens the menu and leaves `data-theme` alone
 *      — and issues no PUT;
 *   3. the toggle inside the menu still switches the theme (so #2 can't
 *      pass by the theme machinery simply being dead).
 *
 * HeaderBar's hook dependencies are mocked exactly as in
 * `HeaderBar.test.tsx`; only the theme path is real.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { UserThemePref } from '../../api/themes';

// ─────────────────────────── Mocks ───────────────────────────

vi.mock('../../auth/AuthContext', () => ({
  // sk-285.7 T013: `useTheme` asks who is signed in before writing a
  // migrated theme back. This suite is about what the account menu does
  // NOT touch, so `null` keeps the write-back out of it entirely.
  useAuthOptional: () => null,
  useAuth: () => ({
    user: { id: 'u-1', username: 'admin', role: 'admin' },
    isLoading: false,
    logout: vi.fn(),
  }),
}));

vi.mock('../../lib/useLayoutState', () => ({
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

vi.mock('../../lib/useReminders', () => ({
  useRingingTaskCount: () => 0,
  useRingEpoch: () => 0,
}));

vi.mock('../../lib/useNotificationCounts', () => ({
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

vi.mock('../../components/Toaster', () => ({
  useToaster: () => ({ error: vi.fn(), success: vi.fn() }),
}));

vi.mock('../../lib/useInspectMode', () => ({
  useInspectMode: () => ({
    enabled: false,
    enable: vi.fn(),
    disable: vi.fn(),
    toggle: vi.fn(),
  }),
}));

vi.mock('../../components/VersionCheck', () => ({
  AppVersionBadge: () => null,
}));

// The theme API is the only wire the theme path touches. Everything else
// in `themes.ts` (query keys, channel name) stays real so `useTheme` and
// the test agree on cache identity.
const getMeTheme = vi.fn<() => Promise<UserThemePref>>();
const setMeTheme = vi.fn<(body: UserThemePref) => Promise<UserThemePref>>();
vi.mock('../../api/themes', async () => {
  const actual = await vi.importActual<typeof import('../../api/themes')>('../../api/themes');
  return {
    ...actual,
    listThemes: () => Promise.resolve([]),
    getTheme: () => Promise.reject(new Error('no custom theme in this test')),
    getMeTheme: () => getMeTheme(),
    setMeTheme: (body: UserThemePref) => setMeTheme(body),
  };
});

import { ThemeSync } from '../../components/ThemeSync';
import { HeaderBar } from './HeaderBar';
import { TasksUiStateProvider } from '../../lib/useTasksUiState';

function renderShellHeader() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <MantineProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/']}>
          {/* Same composition as main.tsx: the sync component sits at the
              root, the header renders the account menu below it. */}
          <ThemeSync />
          <TasksUiStateProvider>
          <HeaderBar />
        </TasksUiStateProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

const dataTheme = () => document.documentElement.getAttribute('data-theme');

function clickAvatar() {
  fireEvent.click(screen.getByRole('button', { name: 'Account menu — admin' }));
}

beforeEach(() => {
  // What theme-boot.js painted before React mounted: the local guess.
  document.documentElement.setAttribute('data-theme', 'light');
  // …while the SERVER remembers dark. The mismatch is the whole point:
  // it is what used to become visible on the first avatar click.
  getMeTheme.mockResolvedValue({
    mode: 'builtin',
    builtinTheme: 'dark',
    customThemeId: null,
  });
  setMeTheme.mockImplementation((body) => Promise.resolve(body));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.documentElement.removeAttribute('data-theme');
});

describe('HeaderBar — account menu does not touch the theme', () => {
  test('the server preference is applied on load, before any interaction', async () => {
    renderShellHeader();

    await waitFor(() => expect(dataTheme()).toBe('dark'));
    // Nothing was clicked — the account menu is still closed.
    expect(screen.queryByRole('link', { name: 'API keys' })).toBeNull();
  });

  test('clicking the avatar opens the menu and leaves data-theme alone', async () => {
    renderShellHeader();
    await waitFor(() => expect(dataTheme()).toBe('dark'));

    clickAvatar();

    // Menu is open…
    await screen.findByRole('link', { name: 'API keys' });
    // …and the theme is untouched, on this tick and after the dropdown's
    // effects (including the mount of ThemeToggle's own useTheme) settle.
    expect(dataTheme()).toBe('dark');
    await waitFor(() => expect(dataTheme()).toBe('dark'));
    expect(setMeTheme).not.toHaveBeenCalled();

    // Closing it again is equally inert.
    clickAvatar();
    await waitFor(() => expect(screen.queryByRole('link', { name: 'API keys' })).toBeNull());
    expect(dataTheme()).toBe('dark');
    expect(setMeTheme).not.toHaveBeenCalled();
  });

  test('the control is a segment: both themes offered, the current one marked', async () => {
    // sk-285.7.11 (AM3) — it was ONE icon that flipped, which states the
    // theme you are NOT in and hides the set of choices. A segment shows
    // the whole set and marks the current member.
    //
    // sk-285.7.19 — the set is TWO. A third cell («System») was built
    // under sk-383 and withdrawn whole, server half included, by the
    // owner. Its absence is asserted here rather than left implicit: a
    // cell whose server column no longer exists would send a field the
    // deployed API rejects, and the theme would stop switching at all.
    renderShellHeader();
    await waitFor(() => expect(dataTheme()).toBe('dark'));
    clickAvatar();

    const light = await screen.findByRole('button', { name: 'Light theme' });
    const dark = await screen.findByRole('button', { name: 'Dark theme' });
    expect(light.getAttribute('aria-pressed')).toBe('false');
    expect(dark.getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('button', { name: 'System theme' })).toBeNull();

  });

  test('the theme segment inside the menu still switches the theme', async () => {
    renderShellHeader();
    await waitFor(() => expect(dataTheme()).toBe('dark'));

    clickAvatar();
    // sk-285.7.11 (AM3) — the control is a two-cell segment now, so the
    // theme is chosen by NAME rather than flipped: the cell that selects
    // light is what a user in dark reaches for.
    const toggle = await screen.findByRole('button', { name: 'Light theme' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(toggle);

    await waitFor(() => expect(dataTheme()).toBe('light'));
    // sk-285.7.19 — exactly these three keys. `toHaveBeenCalledWith` is
    // an equality check on the body, so a `followSystem` creeping back
    // in fails here — which is the shape of the 400 the deployed API
    // answers with when it sees a field it does not know.
    expect(setMeTheme).toHaveBeenCalledWith({
      mode: 'builtin',
      builtinTheme: 'light',
      customThemeId: null,
    });
  });
});
