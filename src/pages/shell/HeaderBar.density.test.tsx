/**
 * sk-551.7 — Appearance → "Density: Normal / Compact".
 *
 * The reference is the maintainers' decisions (sk-551.7, 2026-09-30 and 2026-10-05):
 * the density switch sits in the avatar menu next to the theme, applies
 * at once, the menu does not close; it is stored as a profile field in user_ui_prefs; the
 * default is "Normal". Brief: the choice sends a PUT with `density` only (the PUT
 * is partial, it does not touch the task window), compact is the attribute
 * `data-density="compact"` on `<html>`; a server refusal returns both the
 * switch and the attribute.
 *
 * The real `HeaderBar`, the real hooks and the real `DensitySync` (the
 * root-level writer of the attribute) run against a stub of `fetch` — the
 * network boundary. What is asserted is what the page SENDS and what it
 * SHOWS: the PUT body, the radios, the attribute on `<html>`.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '../../i18n/config';

/** Who the auth context says is signed in; a test may switch it. */
let authUser = { id: 'u-1', username: 'admin', role: 'admin' };
vi.mock('../../auth/AuthContext', () => ({
  useAuthOptional: () => null,
  useAuth: () => ({ user: authUser, isLoading: false, logout: vi.fn() }),
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

const toastError = vi.fn();
vi.mock('../../components/Toaster', () => ({
  useToaster: () => ({ error: toastError, success: vi.fn(), info: vi.fn() }),
}));

vi.mock('../../lib/useInspectMode', () => ({
  useInspectMode: () => ({ enabled: false, enable: vi.fn(), disable: vi.fn(), toggle: vi.fn() }),
}));

vi.mock('../../components/VersionCheck', () => ({ AppVersionBadge: () => null }));
// The theme segment has its own suite; here it would only add /me/theme
// traffic to the stub.
vi.mock('../../components/ThemeToggle', () => ({ ThemeToggle: () => null }));

import { HeaderBar } from './HeaderBar';
import { DensitySync } from '../../components/DensitySync';
import { TasksUiStateProvider } from '../../lib/useTasksUiState';

interface Prefs {
  issueModalViews: string[];
  density: string;
}

/** When set, GETs wait until the test calls it. */
let releaseGet: (() => void) | null;
let holdGet: boolean;

/** Requests to /api/v1/me/ui-prefs, in order. */
let calls: Array<{ user: string; method: string; body: unknown }>;
/** What the stubbed server holds, per user. */
let servers: Record<string, Prefs>;
/** Each PUT waits until the test answers it, oldest first, with a status. */
let heldPuts: Array<(status: number) => void>;
function answerPut(status = 200) {
  const next = heldPuts.shift();
  if (next === undefined) throw new Error('no PUT is waiting');
  next(status);
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const puts = () => calls.filter((c) => c.method === 'PUT');
const densityAttr = () => document.documentElement.getAttribute('data-density');

beforeEach(() => {
  authUser = { id: 'u-1', username: 'admin', role: 'admin' };
  calls = [];
  servers = {
    'u-1': { issueModalViews: ['tree'], density: 'normal' },
    'u-2': { issueModalViews: [], density: 'normal' },
  };
  heldPuts = [];
  holdGet = false;
  releaseGet = null;
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-density');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (!url.endsWith('/api/v1/me/ui-prefs')) return json(404, { error: 'not_found' });
      const method = init?.method ?? 'GET';
      const body = init?.body ? (JSON.parse(String(init.body)) as Partial<Prefs>) : undefined;
      const user = authUser.id;
      calls.push({ user, method, body });
      if (method === 'GET') {
        if (holdGet) await new Promise<void>((resolve) => (releaseGet = resolve));
        return json(200, servers[user]);
      }
      const status = await new Promise<number>((resolve) => heldPuts.push(resolve));
      if (status !== 200) return json(status, { error: 'internal_error' });
      servers[user] = { ...servers[user], ...body };
      return json(200, servers[user]);
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  toastError.mockReset();
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-density');
});

function tree(qc: QueryClient): ReactElement {
  return (
    <MantineProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/']}>
          <TasksUiStateProvider>
            <DensitySync />
            <HeaderBar />
          </TasksUiStateProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>
  );
}

function renderHeader() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const view = render(tree(qc));
  return { rerender: () => view.rerender(tree(qc)) };
}

const label = (key: string) => i18n.t(`header:density.${key}`);

/** Opens the account menu and returns the density group once it is live. */
async function openDensity() {
  renderHeader();
  fireEvent.click(screen.getByRole('button', { name: `Account menu — ${authUser.username}` }));
  const group = await screen.findByRole('group', { name: label('label') });
  await waitFor(() => expect(radio(group, 'normal').disabled).toBe(false));
  return group;
}

function radio(group: HTMLElement, value: 'normal' | 'compact'): HTMLInputElement {
  return within(group).getByRole('radio', { name: label(value) }) as HTMLInputElement;
}

describe('sk-551.7 — Appearance: density', () => {
  test('a person who never chose sees «Normal» and the page carries no density attribute', async () => {
    const group = await openDensity();
    expect(radio(group, 'normal').checked).toBe(true);
    expect(radio(group, 'compact').checked).toBe(false);
    expect(densityAttr()).toBeNull();
  });

  test('before the person\'s own density arrives the switch cannot be used', async () => {
    // A click then would show a guess as their choice.
    holdGet = true;
    renderHeader();
    fireEvent.click(screen.getByRole('button', { name: `Account menu — ${authUser.username}` }));
    const group = await screen.findByRole('group', { name: label('label') });

    expect(radio(group, 'compact').disabled).toBe(true);
    fireEvent.click(radio(group, 'compact'));
    expect(puts()).toHaveLength(0);
    expect(densityAttr()).toBeNull();

    await waitFor(() => expect(releaseGet).not.toBeNull());
    releaseGet!();
    await waitFor(() => expect(radio(group, 'compact').disabled).toBe(false));
  });

  test('the switch and the page reflect a compact density stored in the profile', async () => {
    servers['u-1'].density = 'compact';
    const group = await openDensity();
    await waitFor(() => expect(radio(group, 'compact').checked).toBe(true));
    expect(densityAttr()).toBe('compact');
  });

  test('choosing «Compact» sends only the density, applies at once and keeps the menu open', async () => {
    const group = await openDensity();

    fireEvent.click(radio(group, 'compact'));

    // On the page in the same frame as the click, before any answer.
    expect(densityAttr()).toBe('compact');
    await waitFor(() => expect(radio(group, 'compact').checked).toBe(true));
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0].body).toEqual({ density: 'compact' });

    answerPut();
    await waitFor(() => expect(servers['u-1'].density).toBe('compact'));
    expect(servers['u-1'].issueModalViews).toEqual(['tree']);
    expect(densityAttr()).toBe('compact');
    expect(screen.getByRole('group', { name: label('label') })).toBe(group);
  });

  test('back to «Normal» removes the attribute', async () => {
    servers['u-1'].density = 'compact';
    const group = await openDensity();
    await waitFor(() => expect(densityAttr()).toBe('compact'));

    fireEvent.click(radio(group, 'normal'));

    expect(densityAttr()).toBeNull();
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0].body).toEqual({ density: 'normal' });
    answerPut();
    await waitFor(() => expect(servers['u-1'].density).toBe('normal'));
    expect(densityAttr()).toBeNull();
  });

  test('a refused write puts the switch and the page back and says so', async () => {
    const group = await openDensity();

    fireEvent.click(radio(group, 'compact'));
    expect(densityAttr()).toBe('compact');
    await waitFor(() => expect(heldPuts).toHaveLength(1));
    answerPut(500);

    await waitFor(() => expect(densityAttr()).toBeNull());
    expect(radio(group, 'normal').checked).toBe(true);
    expect(toastError).toHaveBeenCalledWith(label('saveFailed'));
    expect(servers['u-1'].density).toBe('normal');
  });

  test('another person signs in without a reload: the switch writes THEIR density', async () => {
    const { rerender } = renderHeader();
    fireEvent.click(screen.getByRole('button', { name: `Account menu — ${authUser.username}` }));
    let group = await screen.findByRole('group', { name: label('label') });
    await waitFor(() => expect(radio(group, 'normal').disabled).toBe(false));

    authUser = { id: 'u-2', username: 'other', role: 'user' };
    rerender();
    group = screen.getByRole('group', { name: label('label') });
    await waitFor(() => expect(calls.filter((c) => c.method === 'GET')).toHaveLength(2));
    await waitFor(() => expect(radio(group, 'normal').disabled).toBe(false));

    fireEvent.click(radio(group, 'compact'));
    expect(densityAttr()).toBe('compact');
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0]).toEqual({ user: 'u-2', method: 'PUT', body: { density: 'compact' } });
    await waitFor(() => expect(radio(group, 'compact').checked).toBe(true));
    answerPut();
    await waitFor(() => expect(servers['u-2'].density).toBe('compact'));
    expect(servers['u-1'].density).toBe('normal');
    expect(densityAttr()).toBe('compact');
  });

  test('a density click and a window click that overlap do not undo each other', async () => {
    // Accepted density, refused window: the page stays compact and the
    // window set is the one the server holds.
    const group = await openDensity();
    const windows = screen.getByRole('group', { name: i18n.t('header:issueModal.label') });
    const cards = within(windows).getByRole('checkbox', { name: i18n.t('filters:view.cards') });

    fireEvent.click(radio(group, 'compact'));
    fireEvent.click(cards);
    await waitFor(() => expect(heldPuts).toHaveLength(1));
    answerPut(200);
    await waitFor(() => expect(heldPuts).toHaveLength(1));
    expect(puts()[1].body).toEqual({ issueModalViews: ['cards', 'tree'] });
    answerPut(500);

    await waitFor(() => expect((cards as HTMLInputElement).checked).toBe(false));
    expect(densityAttr()).toBe('compact');
    expect(radio(group, 'compact').checked).toBe(true);
    expect(servers['u-1']).toEqual({ issueModalViews: ['tree'], density: 'compact' });
  });
});
