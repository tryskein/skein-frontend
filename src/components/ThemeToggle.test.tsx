/**
 * Saved themes in the theme menu (right-click on the theme segment;
 * `ThemeToggle`): the caller's own themes are listed under «My themes» with
 * a delete control, everybody else's under «Team themes» without one (for a
 * non-admin). Confirming the delete of an own theme deletes that theme, the
 * menu re-reads the catalog, and the active-theme preference is re-read from
 * the server — the server's cascade clears a deleted active theme, and the
 * page falls back to the built-in palette (`deleteMutation`).
 *
 * The stand: the real `ThemeToggle` next to the real `ThemeSync` (the app
 * root's owner of the preference), on a `fetch` stub that models the themes
 * endpoints and that cascade.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { Theme, UserThemePref } from '../api/themes';
import i18n from '../i18n/config';

vi.mock('../auth/AuthContext', () => ({
  useAuthOptional: () => null,
  useAuth: () => ({ user: { id: 'u-1', username: 'ann', role: 'user' }, isLoading: false, logout: vi.fn() }),
}));

import { ThemeSync } from './ThemeSync';
import { ThemeToggle } from './ThemeToggle';

const theme = (id: string, name: string, ownerId: string): Theme => ({
  id, name, base: 'dark', variables: { '--sk-test-accent': '#123456' },
  createdBy: { id: ownerId, username: ownerId }, updatedBy: { id: ownerId, username: ownerId },
  createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z',
});

let themes: Theme[];
let pref: UserThemePref;
const fetchSpy = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  themes = [theme('th-mine', 'Midnight', 'u-1'), theme('th-team', 'Harbour', 'u-2')];
  pref = { mode: 'custom', builtinTheme: 'light', customThemeId: 'th-mine' } as UserThemePref;
  fetchSpy.mockReset();
  fetchSpy.mockImplementation(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url === '/api/v1/themes' && method === 'GET') return json(themes);
    const one = /^\/api\/v1\/themes\/([^/]+)$/.exec(url);
    if (one && method === 'GET') {
      const found = themes.find((t) => t.id === decodeURIComponent(one[1]));
      return found ? json(found) : json({ error: 'theme_not_found' }, 404);
    }
    if (one && method === 'DELETE') {
      const id = decodeURIComponent(one[1]);
      themes = themes.filter((t) => t.id !== id);
      // The server's cascade: a user whose active theme it was loses it.
      if (pref.customThemeId === id) pref = { ...pref, customThemeId: null };
      return new Response(null, { status: 204 });
    }
    if (url === '/api/v1/me/theme' && method === 'GET') return json(pref);
    if (url === '/api/v1/me/theme' && method === 'PUT') {
      pref = JSON.parse(String(init?.body)) as UserThemePref;
      return json(pref);
    }
    return json({ error: 'unexpected' }, 599);
  });
  vi.stubGlobal('fetch', fetchSpy);
  document.documentElement.setAttribute('data-theme', 'light');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('style');
});

function renderToggle() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <MantineProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <ThemeSync />
          <ThemeToggle />
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

const chrome = (key: string) => i18n.t(`chrome:${key}`) as string;

async function openMenu() {
  fireEvent.contextMenu(screen.getByRole('group', { name: chrome('theme.group') }));
  return screen.findByRole('menu');
}

/** The menu as a reader meets it: each group label followed by its themes. */
function groups(menu: HTMLElement): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  let current = '';
  // The divider ends the saved themes; the editor actions follow it.
  for (const el of menu.querySelectorAll('.mantine-Menu-label, .mantine-Menu-divider, [role="menuitem"]')) {
    if (el.classList.contains('mantine-Menu-divider')) break;
    if (el.classList.contains('mantine-Menu-label')) {
      current = (el.textContent ?? '').trim();
      out[current] = [];
    } else if (current) {
      out[current].push((el.textContent ?? '').trim());
    }
  }
  return out;
}

const dataTheme = () => document.documentElement.getAttribute('data-theme');
const requests = (method: string, url: string) =>
  fetchSpy.mock.calls.filter((c) => (c[1]?.method ?? 'GET') === method && String(c[0]) === url).length;

describe('ThemeToggle — saved themes', () => {
  test('own themes and team themes are in their own groups; only own ones can be deleted', async () => {
    renderToggle();
    const menu = await openMenu();
    await within(menu).findByText('Midnight');

    expect(groups(menu)).toMatchObject({
      [chrome('theme.myThemes')]: ['Midnight'],
      [chrome('theme.teamThemes')]: ['Harbour'],
    });
    expect(within(menu).getByRole('button', { name: 'Delete theme Midnight' })).toBeTruthy();
    expect(within(menu).queryByRole('button', { name: 'Delete theme Harbour' })).toBeNull();
  });

  test('confirming the delete of the active own theme removes it and falls back to the built-in palette', async () => {
    renderToggle();
    await waitFor(() => expect(dataTheme()).toBe('custom'));
    const menu = await openMenu();
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(await within(menu).findByRole('button', { name: 'Delete theme Midnight' }));

    const dialog = await screen.findByRole('dialog');
    const prefReadsBefore = requests('GET', '/api/v1/me/theme');
    fireEvent.click(within(dialog).getByRole('button', { name: i18n.t('common:confirmDialog.confirm') as string }));

    await waitFor(() => expect(requests('DELETE', '/api/v1/themes/th-mine')).toBe(1));
    expect(requests('DELETE', '/api/v1/themes/th-team')).toBe(0);
    await waitFor(() => expect(requests('GET', '/api/v1/me/theme')).toBeGreaterThan(prefReadsBefore));
    await waitFor(() => expect(dataTheme()).toBe('light'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    const reopened = await openMenu();
    await waitFor(() => expect(groups(reopened)).toEqual({ [chrome('theme.teamThemes')]: ['Harbour'] }));
  });
});

describe('ThemeToggle — cancelling the delete', () => {
  test('Cancel closes the dialog and deletes nothing', async () => {
    renderToggle();
    const menu = await openMenu();
    fireEvent.click(await within(menu).findByRole('button', { name: 'Delete theme Midnight' }));
    const dialog = await screen.findByRole('dialog');

    fireEvent.click(within(dialog).getByRole('button', { name: i18n.t('common:confirmDialog.cancel') as string }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(requests('DELETE', '/api/v1/themes/th-mine')).toBe(0);
  });
});

/**
 * sk-1048.74 — with Russian selected this surface shows the Russian text of
 * its dictionary section, not the English fallback: a section emptied in
 * `ru.ts` would quietly fall back to English and pass every English test.
 */
describe('ThemeToggle in Russian (chrome)', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  test('the theme segment and the saved-themes group are in Russian', async () => {
    await i18n.changeLanguage('ru');
    renderToggle();
    fireEvent.contextMenu(screen.getByRole('group', { name: 'Тема' }));
    const menu = await screen.findByRole('menu');
    expect(await within(menu).findByText('Мои темы')).toBeTruthy();
  });
});
