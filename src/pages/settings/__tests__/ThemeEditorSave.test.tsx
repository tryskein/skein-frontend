/**
 * sk-1048.52 — saving from the theme editor.
 *
 * Contract (`ThemeEditorPage.tsx`, routes of `api/themes.ts`): «Save as new»
 * POSTs `/api/v1/themes` with the name, base and variables; the editor then
 * opens the created theme by the id of the answer (`?theme=<id>`) and «Save»
 * PATCHes that theme. A refused save shows the server's reason and leaves what
 * was typed in place for another try.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

vi.mock('../new/SettingsLayout', () => ({
  SettingsLayout: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  SettingsPanel: ({ children }: { children: ReactNode }) => createElement('div', null, children),
}));

import { ThemeEditorPage } from '../ThemeEditorPage';

const THEME_ID = '5c0b7a52-1f0e-4a3c-9d2b-6e8f1a2b3c4d';

interface Sent { method: string; url: string; body: Record<string, unknown> | undefined }
let sent: Sent[];
let createAnswers: Response[];

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function stored(name: string, base: string, variables: Record<string, string>) {
  return {
    id: THEME_ID, name, base, variables,
    createdBy: { id: 'u1', username: 'me' }, createdAt: '2026-11-23T10:00:00Z',
    updatedAt: '2026-11-23T10:00:00Z', updatedBy: { id: 'u1', username: 'me' },
  };
}

beforeEach(() => {
  sent = [];
  createAnswers = [];
  window.localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = init?.body === undefined ? undefined : JSON.parse(String(init.body));
    sent.push({ method, url, body });
    if (url === '/api/v1/me/theme') return json(200, { mode: 'builtin', builtinTheme: 'light', customThemeId: null });
    if (url === '/api/v1/themes' && method === 'POST') return createAnswers.shift()!;
    if (url === '/api/v1/themes' && method === 'GET') return json(200, []);
    if (url === `/api/v1/themes/${THEME_ID}` && method === 'GET') {
      const created = sent.find((s) => s.method === 'POST' && s.url === '/api/v1/themes' && s.body)!.body!;
      return json(200, stored(String(created.name), String(created.base), created.variables as Record<string, string>));
    }
    if (url === `/api/v1/themes/${THEME_ID}` && method === 'PATCH') {
      return json(200, stored(String(body!.name), String(body!.base), body!.variables as Record<string, string>));
    }
    throw new Error(`unexpected request: ${method} ${url}`);
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

let search = '';
function LocationProbe() {
  search = useLocation().search;
  return null;
}

async function openNewTheme() {
  render(
    <MantineProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/settings/theme?new=1']}>
          <LocationProbe />
          <ThemeEditorPage />
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
  const name = await screen.findByRole('textbox', { name: 'Name' });
  fireEvent.change(name, { target: { value: 'Cobalt' } });
  return name as HTMLInputElement;
}

const posts = () => sent.filter((s) => s.method === 'POST' && s.url === '/api/v1/themes');

describe('ThemeEditorPage — saving', () => {
  test('a refused «Save as new» shows the reason and keeps the typed name for a retry', async () => {
    createAnswers.push(json(422, { error: 'theme_name_taken', message: 'a theme named Cobalt already exists' }));
    const name = await openNewTheme();

    fireEvent.click(screen.getByRole('button', { name: 'Save as new' }));

    expect(await screen.findByText('a theme named Cobalt already exists')).toBeTruthy();
    expect(name.value).toBe('Cobalt');
    expect(search).toBe('?new=1');
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    await waitFor(() => expect((screen.getByRole('button', { name: 'Save as new' }) as HTMLButtonElement).disabled).toBe(false));
    expect(posts()).toHaveLength(1);
  });

  test('«Save as new» creates the theme, opens it by the answer\'s id, and «Save» then updates that theme', async () => {
    createAnswers.push(json(201, stored('Cobalt', 'light', {})));
    await openNewTheme();

    fireEvent.click(screen.getByRole('button', { name: 'Save as new' }));

    await waitFor(() => expect(new URLSearchParams(search).get('theme')).toBe(THEME_ID));
    expect(posts()).toHaveLength(1);
    expect(posts()[0].body).toMatchObject({ name: 'Cobalt', base: 'light' });
    expect(Object.keys(posts()[0].body!.variables as object).length).toBeGreaterThan(0);

    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));

    await waitFor(() => expect(sent.some((s) => s.method === 'PATCH')).toBe(true));
    const patch = sent.find((s) => s.method === 'PATCH')!;
    expect(patch.url).toBe(`/api/v1/themes/${THEME_ID}`);
    expect(patch.body).toMatchObject({ name: 'Cobalt', base: 'light' });
    expect(posts()).toHaveLength(1);
  });
});
