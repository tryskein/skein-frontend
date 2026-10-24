/**
 * sk-285.7 T012 — the theme editor seeds its draft through the SAME
 * migration the shell reads through.
 *
 * Before this task the editor seeded with `{ ...defaultVariablesForBase(
 * t.base), ...t.variables }`: every saved key won and the builtin filled
 * the gaps. That is a second ownership rule, and after the redesign it
 * is the wrong one — it would show the pre-redesign type scale as if the
 * user had chosen it, keep names the new dictionary no longer knows, and
 * disagree with what the shell is painting at that very moment. Two
 * rules in two files drift; the point of this file is that there is one.
 *
 * What is checked is what the user SEES in the editor's inputs, not how
 * the seed was computed — a test of the computation would just be the
 * migration's own unit tests a second time. The interesting pair is
 * therefore a structural role nobody touched (must show the NEW default,
 * because the redesign IS that number) next to one the user did touch
 * (must show theirs), plus a colour that changed name on the way
 * (`--brand` → `--primary`).
 *
 * The settings chrome is stubbed out: it drags in the header, auth and
 * the layout providers, none of which have anything to do with seeding.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

vi.mock('../new/SettingsLayout', () => ({
  SettingsLayout: ({ children }: { children: ReactNode }) =>
    createElement('div', { 'data-testid': 'settings-layout' }, children),
  SettingsPanel: ({ children }: { children: ReactNode }) =>
    createElement('div', { 'data-testid': 'settings-panel' }, children),
}));

import { ThemeEditorPage } from '../ThemeEditorPage';
import { ALL_TOKENS } from '../../../lib/themeTokens';
import { LEGACY_DEFAULTS } from '../../../lib/themeTokensLegacy';

const THEME_ID = 'theme-in-the-editor';
const USER_BRAND = '#0f7b6c';
const USER_FONT_SM = '11px';

function builtinLight(key: string): string {
  const def = ALL_TOKENS.find((t) => t.key === key);
  if (!def) throw new Error(`${key} is not a role of the new registry`);
  return def.light;
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function stubServer(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/api/v1/me/theme')) {
        return json({ mode: 'custom', builtinTheme: 'light', customThemeId: THEME_ID });
      }
      if (url.includes('/api/v1/themes/')) {
        return json({
          id: THEME_ID,
          name: 'Saved before the redesign',
          base: 'light',
          variables: {
            ...LEGACY_DEFAULTS.light,
            '--brand': USER_BRAND,
            '--font-sm': USER_FONT_SM,
          },
          createdBy: { id: 'u1', username: 'someone' },
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
          updatedBy: { id: 'u1', username: 'someone' },
        });
      }
      throw new Error(`unexpected request: ${url}`);
    }),
  );
}

function renderEditor(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    createElement(
      MantineProvider,
      null,
      createElement(
        QueryClientProvider,
        { client },
        createElement(
          MemoryRouter,
          { initialEntries: [`/settings/theme?theme=${THEME_ID}`] },
          createElement(ThemeEditorPage),
        ),
      ),
    ),
  );
}

/** The editor's text field for one role, by the id it renders with. */
function field(key: string): HTMLInputElement {
  const el = document.getElementById(`tok-${key}`);
  if (!(el instanceof HTMLInputElement)) throw new Error(`no editor field for ${key}`);
  return el;
}

beforeEach(() => {
  window.localStorage.clear();
  // The editor remembers the last section; pin it so the Type roles are
  // the ones on screen when the draft lands.
  window.localStorage.setItem('skein.theme-editor.section', 'type');
  stubServer();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('T012 — the editor shows the migrated theme, not the saved bytes', () => {
  test('the pair this file leans on really differs', () => {
    // Without this, "shows 16px" would be satisfied by a seed that
    // simply echoed the snapshot.
    expect(LEGACY_DEFAULTS.light['--font-base']).not.toBe(builtinLight('--font-base'));
    expect(LEGACY_DEFAULTS.light['--font-sm']).not.toBe(USER_FONT_SM);
    expect(builtinLight('--font-sm')).not.toBe(USER_FONT_SM);
    expect(builtinLight('--primary')).not.toBe(USER_BRAND);
  });

  test('an untouched structural role shows the NEW default, a touched one the user value', async () => {
    renderEditor();
    await waitFor(() => expect(document.getElementById('tok---font-base')).not.toBeNull());

    // Nobody chose 14px — it was the old default, so the redesign wins.
    expect(field('--font-base').value).toBe(builtinLight('--font-base'));
    expect(field('--font-base').value).not.toBe(LEGACY_DEFAULTS.light['--font-base']);
    // 11px is not anyone's default on either side — it is a choice.
    expect(field('--font-sm').value).toBe(USER_FONT_SM);
  });

  test('a role that changed name carries the user colour to its successor', async () => {
    renderEditor();
    await waitFor(() => expect(document.getElementById('tok---font-base')).not.toBeNull());

    // `--primary` lives in the Brand section; switch to it.
    fireEvent.click(screen.getByRole('button', { name: 'Brand' }));
    await waitFor(() => expect(document.getElementById('tok---primary')).not.toBeNull());

    expect(field('--primary').value).toBe(USER_BRAND);
  });

  test('a role the saved theme never had is seeded, not left blank', async () => {
    renderEditor();
    await waitFor(() => expect(document.getElementById('tok---font-2xl')).not.toBeNull());

    // `--font-2xl` has no predecessor — the redesign introduced it. An
    // empty field here is the "half-populated set of roles" the spec's
    // failure edge names, arriving through the editor instead.
    expect(field('--font-2xl').value).toBe(builtinLight('--font-2xl'));
    expect(field('--font-2xl').value).not.toBe('');
  });

  test('no field on screen is empty', async () => {
    renderEditor();
    await waitFor(() => expect(document.getElementById('tok---font-base')).not.toBeNull());

    const empties = [...document.querySelectorAll<HTMLInputElement>('input[id^="tok-"]')]
      .filter((i) => i.value === '')
      .map((i) => i.id);
    expect(empties).toEqual([]);
    // Non-degenerate: there ARE fields on screen.
    expect(document.querySelectorAll('input[id^="tok-"]').length).toBeGreaterThan(0);
  });
});
