/**
 * sk-551.5 — Appearance → «Open the issue in a pop-up window», one checkbox
 * per view.
 *
 * The reference is the maintainers' decision (sk-551.5, 2026-10-05): in the avatar menu →
 * Appearance three independent checkboxes Cards / Board / Tree; by
 * default all are off; stored in the profile; applied at once. Brief:
 * the menu does not close on click; the write is a PUT of the whole set.
 *
 * Review of sk-551.5: clicks whose writes overlap
 * end on the set of the last click that the server accepted — whichever
 * response arrives first and whichever fails; the settings are personal — after
 * a user change without reload another person's set is not shown and is not
 * written.
 *
 * The real `HeaderBar` and the real hook run against a stub of `fetch` —
 * the network boundary. What is asserted is what the page SENDS (the PUT
 * body) and what the boxes SHOW after the server answered, never an echo
 * of the stub's own answer.
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
import { TasksUiStateProvider } from '../../lib/useTasksUiState';

interface Call {
  user: string;
  method: string;
  body: unknown;
}

/** Requests to /api/v1/me/ui-prefs, in order, with whose session sent them. */
let calls: Call[];
/** What the stubbed server holds, per user. */
let server: Record<string, string[]>;
/** Each PUT waits until the test answers it, oldest first, with a status. */
let heldPuts: Array<(status: number) => void>;
function answerPut(status = 200) {
  const next = heldPuts.shift();
  if (next === undefined) throw new Error('no PUT is waiting');
  next(status);
}
/** GETs of these users never answer (until the test calls the release). */
let heldGets: Record<string, () => void>;
/** When true, GETs after a user's first never answer: what the boxes show
 *  then is the page's own doing, not a fresh read from the server. */
let holdLaterGets: boolean;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const puts = () => calls.filter((c) => c.method === 'PUT');

beforeEach(() => {
  authUser = { id: 'u-1', username: 'admin', role: 'admin' };
  calls = [];
  server = { 'u-1': ['tree'], 'u-2': [] };
  heldPuts = [];
  heldGets = {};
  holdLaterGets = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (!url.endsWith('/api/v1/me/ui-prefs')) return json(404, { error: 'not_found' });
      const user = authUser.id;
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ user, method, body });
      if (method === 'GET') {
        const earlier = calls.filter((c) => c.method === 'GET' && c.user === user).length - 1;
        if (holdLaterGets && earlier > 0) return new Promise<Response>(() => {});
        if (user in heldGets) {
          await new Promise<void>((resolve) => {
            heldGets[user] = resolve;
          });
        }
        return json(200, { issueModalViews: server[user] });
      }
      const status = await new Promise<number>((resolve) => heldPuts.push(resolve));
      if (status !== 200) return json(status, { error: 'internal_error' });
      server[user] = (body as { issueModalViews: string[] }).issueModalViews;
      return json(200, { issueModalViews: server[user] });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  toastError.mockReset();
});

const client = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

function tree(qc: QueryClient): ReactElement {
  return (
    <MantineProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/']}>
          <TasksUiStateProvider>
            <HeaderBar />
          </TasksUiStateProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>
  );
}

function renderHeader() {
  const qc = client();
  const view = render(tree(qc));
  return { rerender: () => view.rerender(tree(qc)) };
}

/** Opens the account menu and returns the setting's group. */
async function openSetting() {
  fireEvent.click(screen.getByRole('button', { name: `Account menu — ${authUser.username}` }));
  return screen.findByRole('group', { name: i18n.t('header:issueModal.label') });
}

function box(group: HTMLElement, view: 'cards' | 'kanban' | 'tree'): HTMLInputElement {
  return within(group).getByRole('checkbox', {
    name: i18n.t(`filters:view.${view}`),
  }) as HTMLInputElement;
}

function ticked(group: HTMLElement): string[] {
  return (['cards', 'kanban', 'tree'] as const).filter((v) => box(group, v).checked);
}

async function ready() {
  renderHeader();
  const group = await openSetting();
  await waitFor(() => expect(box(group, 'cards').disabled).toBe(false));
  return group;
}

describe('sk-551.5 — Appearance: the issue in a pop-up window, per view', () => {
  test('the three boxes show what the server holds', async () => {
    const group = await ready();
    expect(ticked(group)).toEqual(['tree']);
  });

  test('ticking Board sends the whole set, applies at once, and keeps the menu open', async () => {
    const group = await ready();

    fireEvent.click(box(group, 'kanban'));

    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0].body).toEqual({ issueModalViews: ['kanban', 'tree'] });
    // Ticked while the request is still in flight.
    await waitFor(() => expect(box(group, 'kanban').checked).toBe(true));
    answerPut();
    await waitFor(() => expect(server['u-1']).toEqual(['kanban', 'tree']));
    expect(ticked(group)).toEqual(['kanban', 'tree']);
    expect(screen.getByRole('group', { name: i18n.t('header:issueModal.label') })).toBe(group);
  });

  test('unticking a view sends the set without it', async () => {
    const group = await ready();

    fireEvent.click(box(group, 'tree'));

    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0].body).toEqual({ issueModalViews: [] });
    await waitFor(() => expect(box(group, 'tree').checked).toBe(false));
  });

  test('two quick clicks: the writes go out in click order and the last click wins', async () => {
    const group = await ready();

    fireEvent.click(box(group, 'cards'));
    fireEvent.click(box(group, 'kanban'));
    await waitFor(() => expect(ticked(group)).toEqual(['cards', 'kanban', 'tree']));
    // The second write waits for the first: its answer cannot overtake it.
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0].body).toEqual({ issueModalViews: ['cards', 'tree'] });

    answerPut();
    await waitFor(() => expect(puts()).toHaveLength(2));
    expect(puts()[1].body).toEqual({ issueModalViews: ['cards', 'kanban', 'tree'] });
    // The first acceptance does not repaint over the second click.
    expect(ticked(group)).toEqual(['cards', 'kanban', 'tree']);

    answerPut();
    await waitFor(() => expect(server['u-1']).toEqual(['cards', 'kanban', 'tree']));
    expect(ticked(group)).toEqual(['cards', 'kanban', 'tree']);
  });

  test('the first write is refused, the second accepted: profile and boxes hold the last click', async () => {
    holdLaterGets = true;
    const group = await ready();

    fireEvent.click(box(group, 'cards'));
    fireEvent.click(box(group, 'kanban'));
    await waitFor(() => expect(heldPuts).toHaveLength(1));

    answerPut(500);
    // The refusal does not undo the newer, still pending, click.
    await waitFor(() => expect(puts()).toHaveLength(2));
    expect(toastError).toHaveBeenCalledWith(i18n.t('header:issueModal.saveFailed'));
    expect(ticked(group)).toEqual(['cards', 'kanban', 'tree']);

    answerPut(200);
    await waitFor(() => expect(server['u-1']).toEqual(['cards', 'kanban', 'tree']));
    await waitFor(() => expect(ticked(group)).toEqual(['cards', 'kanban', 'tree']));
  });

  test('the first write is accepted, the second refused: the boxes fall back to what the server took', async () => {
    holdLaterGets = true;
    const group = await ready();

    fireEvent.click(box(group, 'cards'));
    fireEvent.click(box(group, 'kanban'));
    await waitFor(() => expect(heldPuts).toHaveLength(1));
    answerPut(200);
    await waitFor(() => expect(heldPuts).toHaveLength(1));
    answerPut(500);

    await waitFor(() => expect(ticked(group)).toEqual(['cards', 'tree']));
    expect(server['u-1']).toEqual(['cards', 'tree']);
  });

  test('both writes refused: the boxes go back to what the server held before the first click', async () => {
    holdLaterGets = true;
    const group = await ready();

    fireEvent.click(box(group, 'cards'));
    fireEvent.click(box(group, 'kanban'));
    await waitFor(() => expect(heldPuts).toHaveLength(1));
    answerPut(500);
    await waitFor(() => expect(heldPuts).toHaveLength(1));
    answerPut(500);

    await waitFor(() => expect(ticked(group)).toEqual(['tree']));
    expect(server['u-1']).toEqual(['tree']);
  });

  test('a refused write puts the box back and says so', async () => {
    holdLaterGets = true;
    const group = await ready();

    fireEvent.click(box(group, 'cards'));
    await waitFor(() => expect(box(group, 'cards').checked).toBe(true));
    await waitFor(() => expect(heldPuts).toHaveLength(1));
    answerPut(500);

    await waitFor(() => expect(box(group, 'cards').checked).toBe(false));
    expect(ticked(group)).toEqual(['tree']);
    expect(toastError).toHaveBeenCalledWith(i18n.t('header:issueModal.saveFailed'));
  });

  test('before the server answers the boxes cannot be clicked', async () => {
    // A click on a set nobody has read yet would overwrite the stored one.
    heldGets['u-1'] = () => {};
    renderHeader();
    const group = await openSetting();

    expect(box(group, 'kanban').disabled).toBe(true);

    await waitFor(() => expect(calls).toHaveLength(1));
    heldGets['u-1']();
    await waitFor(() => expect(box(group, 'kanban').disabled).toBe(false));
  });

  test('another person signs in without a reload: the first one\'s set is neither shown nor written', async () => {
    const { rerender } = renderHeader();
    let group = await openSetting();
    await waitFor(() => expect(ticked(group)).toEqual(['tree']));

    // u-2 signs in in the same tab; their own set has not arrived yet.
    heldGets['u-2'] = () => {};
    authUser = { id: 'u-2', username: 'other', role: 'user' };
    rerender();
    group = screen.getByRole('group', { name: i18n.t('header:issueModal.label') });

    expect(ticked(group)).toEqual([]);
    expect(box(group, 'cards').disabled).toBe(true);
    fireEvent.click(box(group, 'cards'));
    expect(puts()).toHaveLength(0);

    await waitFor(() => expect(calls.some((c) => c.user === 'u-2')).toBe(true));
    heldGets['u-2']();
    await waitFor(() => expect(box(group, 'cards').disabled).toBe(false));
    expect(ticked(group)).toEqual([]);

    fireEvent.click(box(group, 'kanban'));
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0]).toEqual({ user: 'u-2', method: 'PUT', body: { issueModalViews: ['kanban'] } });
    answerPut();
    await waitFor(() => expect(server['u-2']).toEqual(['kanban']));
    expect(server['u-1']).toEqual(['tree']);
  });
});
