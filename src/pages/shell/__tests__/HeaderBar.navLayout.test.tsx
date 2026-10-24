/**
 * sk-551.8 F10 — Appearance → "Left panel", the profile client of the
 * layout and this browser's copy of it.
 *
 * Reference: spec US-1 (the switch is unavailable until the person's own
 * value is in and then shows the server's; a refusal rolls back and says
 * so; the menu stays open), SC-002, SC-005 (no frame of the side-by-side
 * layout when this machine's copy is this person's), INV-10 (whose copy
 * is used; logout and «not authorised» erase it, a dropped connection
 * does not; a late confirmation after a logout, a 401 or another
 * person's session writes nothing), the "Profile client" contract (only
 * the exact word `sections`; the field is not lost in the answer to
 * another field's PUT; the PUT carries only the changed field), and the
 * two regressions found in review (R1, R2).
 *
 * The real `HeaderBar`, the real hooks and the real `NavLayoutSync` run
 * against a stub of `fetch` (the network boundary) and a stub of the
 * session (`auth/AuthContext`). What is asserted is what the page sends,
 * what it shows and what it keeps in localStorage. The boot script
 * (`theme-boot.js`) is not part of this layout's first frame (plan P5).
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '../../../i18n/config';

interface Session {
  user: { id: string; username: string; role: string } | null;
  isLoading: boolean;
  sessionResolved: boolean;
  logout: () => Promise<void>;
}
/** The session the stubbed auth context reports; a test may switch it. */
let session: Session;
/** `false` — as if no AuthProvider were mounted (`useAuthOptional` → null). */
let authProviderMounted: boolean;
vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => session,
  useAuthOptional: () => (authProviderMounted ? session : null),
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
  }),
  useOptionalLayoutState: () => null,
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
    counts: { inbox: 0, outbox: 0, mentions: 0, watching: 0, onMeOpenCount: 0, delegatedOpenCount: 0 },
    isLoading: false,
    error: null,
  }),
}));

const toastError = vi.fn();
vi.mock('../../../components/Toaster', () => ({
  useToaster: () => ({ error: toastError, success: vi.fn(), info: vi.fn() }),
}));

vi.mock('../../../lib/useInspectMode', () => ({
  useInspectMode: () => ({ enabled: false, enable: vi.fn(), disable: vi.fn(), toggle: vi.fn() }),
}));

vi.mock('../../../components/VersionCheck', () => ({ AppVersionBadge: () => null }));
vi.mock('../../../components/ThemeToggle', () => ({ ThemeToggle: () => null }));

import { HeaderBar } from '../HeaderBar';
import { NavLayoutSync } from '../../../components/NavLayoutSync';
import { TasksUiStateProvider } from '../../../lib/useTasksUiState';
import { useNavLayout, useNavLayoutOptional } from '../../../lib/useNavLayout';
import {
  NAV_LAYOUT_BOOT_CACHE_KEY,
  readNavLayoutBootCache,
  writeNavLayoutBootCache,
} from '../../../lib/navLayoutBootCache';

type Prefs = Record<string, unknown>;

const U1 = { id: 'u-1', username: 'admin', role: 'admin' };
const U2 = { id: 'u-2', username: 'other', role: 'user' };

/** GETs wait until released while `holdGet` is set. */
let holdGet: boolean;
let releaseGets: Array<() => void>;
/** GETs fail at the network level while set (a dropped connection). */
let failGet: boolean;
/** Requests to /api/v1/me/ui-prefs, in order. */
let calls: Array<{ user: string; method: string; body: unknown }>;
/** What the stubbed server holds and answers, per user. */
let servers: Record<string, Prefs>;
/** Each PUT waits until the test answers it, oldest first. */
let heldPuts: Array<(status: number) => void>;

function answerPut(status = 200) {
  const next = heldPuts.shift();
  if (next === undefined) throw new Error('no PUT is waiting');
  next(status);
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const puts = () => calls.filter((c) => c.method === 'PUT');

beforeEach(() => {
  session = { user: U1, isLoading: false, sessionResolved: true, logout: vi.fn(async () => {}) };
  authProviderMounted = true;
  calls = [];
  servers = {
    'u-1': { issueModalViews: [], density: 'normal', navLayout: 'columns' },
    'u-2': { issueModalViews: [], density: 'normal', navLayout: 'columns' },
  };
  heldPuts = [];
  holdGet = false;
  failGet = false;
  releaseGets = [];
  window.localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (!url.endsWith('/api/v1/me/ui-prefs')) return json(404, { error: 'not_found' });
      const method = init?.method ?? 'GET';
      const body = init?.body ? (JSON.parse(String(init.body)) as Prefs) : undefined;
      const user = session.user?.id ?? 'nobody';
      calls.push({ user, method, body });
      if (method === 'GET') {
        if (failGet) throw new TypeError('Failed to fetch');
        if (holdGet) await new Promise<void>((resolve) => releaseGets.push(resolve));
        return json(200, servers[user]);
      }
      const status = await new Promise<number>((resolve) => heldPuts.push(resolve));
      if (status !== 200) return json(status, { error: 'invalid_nav_layout' });
      servers[user] = { ...servers[user], ...body };
      return json(200, servers[user]);
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  toastError.mockReset();
  window.localStorage.clear();
});

/** What the layout hook answered on each render, and its setter. */
let seen: string[];
let hook: ReturnType<typeof useNavLayout> | null;
function Probe() {
  hook = useNavLayout();
  seen.push(hook.navLayout);
  return null;
}

function tree(qc: QueryClient, header = true): ReactElement {
  return (
    <MantineProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/']}>
          <TasksUiStateProvider>
            <NavLayoutSync />
            <Probe />
            {header ? <HeaderBar /> : null}
          </TasksUiStateProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>
  );
}

function mount(header = true) {
  seen = [];
  hook = null;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const view = render(tree(qc, header));
  const rerender = () => view.rerender(tree(qc, header));
  lastRerender = rerender;
  return { rerender };
}

/** Re-render the last mounted tree with the current session. */
let lastRerender: (() => void) | null = null;
function rerenderLast() {
  lastRerender?.();
}

const label = (key: string) => i18n.t(`header:navLayout.${key}`);

function radio(group: HTMLElement, value: 'columns' | 'sections'): HTMLInputElement {
  return within(group).getByRole('radio', { name: label(value) }) as HTMLInputElement;
}

async function openMenu() {
  const view = mount();
  fireEvent.click(screen.getByRole('button', { name: `Account menu — ${U1.username}` }));
  const group = await screen.findByRole('group', { name: label('label') });
  return { group, ...view };
}

async function openLoaded() {
  const opened = await openMenu();
  await waitFor(() => expect(radio(opened.group, 'columns').disabled).toBe(false));
  return opened;
}

describe('US-1 — the switch', () => {
  test('unavailable until the person’s own value is in, then it shows the server’s', async () => {
    servers['u-1'].navLayout = 'sections';
    holdGet = true;
    const { group } = await openMenu();
    expect(radio(group, 'columns').disabled).toBe(true);
    expect(radio(group, 'sections').disabled).toBe(true);
    expect(radio(group, 'columns').checked || radio(group, 'sections').checked).toBe(false);
    fireEvent.click(radio(group, 'sections'));
    expect(puts()).toHaveLength(0);

    await waitFor(() => expect(releaseGets.length).toBeGreaterThan(0));
    act(() => releaseGets.forEach((r) => r()));
    await waitFor(() => expect(radio(group, 'sections').checked).toBe(true));
    expect(radio(group, 'sections').disabled).toBe(false);
  });

  test('a click sends only {navLayout} and the menu stays open', async () => {
    const { group } = await openLoaded();
    fireEvent.click(radio(group, 'sections'));
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0].body).toEqual({ navLayout: 'sections' });
    expect(radio(group, 'sections').checked).toBe(true);
    answerPut();
    await waitFor(() => expect(servers['u-1'].navLayout).toBe('sections'));
    expect(screen.getByRole('group', { name: label('label') })).toBe(group);
    expect(servers['u-1'].density).toBe('normal');
  });

  test('a refusal puts the switch back and says so', async () => {
    const { group } = await openLoaded();
    fireEvent.click(radio(group, 'sections'));
    await waitFor(() => expect(heldPuts).toHaveLength(1));
    answerPut(400);
    await waitFor(() => expect(radio(group, 'columns').checked).toBe(true));
    expect(toastError).toHaveBeenCalledWith(label('saveFailed'));
    expect(servers['u-1'].navLayout).toBe('columns');
  });

  test('R1: sections then columns in one tick, columns observed — the last choice wins, no call lost', async () => {
    mount(false);
    await waitFor(() => expect(hook?.loaded).toBe(true));
    act(() => {
      hook!.setNavLayout('sections');
      hook!.setNavLayout('columns');
    });
    await waitFor(() => expect(heldPuts).toHaveLength(1));
    answerPut();
    await waitFor(() => expect(heldPuts).toHaveLength(1));
    answerPut();
    await waitFor(() => expect(puts()).toHaveLength(2));
    expect(puts().map((p) => p.body)).toEqual([{ navLayout: 'sections' }, { navLayout: 'columns' }]);
    await waitFor(() => expect(servers['u-1'].navLayout).toBe('columns'));
    expect(hook!.navLayout).toBe('columns');
  });
});

describe('"Profile client" — the exact word, and the field survives other answers', () => {
  test.each([
    ['absent', undefined],
    ['"Sections"', 'Sections'],
    ['42', 42],
  ])('a server value %s reads as columns', async (_name, value) => {
    if (value === undefined) delete servers['u-1'].navLayout;
    else servers['u-1'].navLayout = value;
    const { group } = await openLoaded();
    expect(radio(group, 'columns').checked).toBe(true);
    expect(hook!.navLayout).toBe('columns');
  });

  test('the answer to a density PUT keeps navLayout: sections', async () => {
    servers['u-1'].navLayout = 'sections';
    const { group } = await openLoaded();
    await waitFor(() => expect(radio(group, 'sections').checked).toBe(true));
    const density = screen.getByRole('group', { name: i18n.t('header:density.label') });
    fireEvent.click(within(density).getByRole('radio', { name: i18n.t('header:density.compact') }));
    await waitFor(() => expect(heldPuts).toHaveLength(1));
    expect(puts()[0].body).toEqual({ density: 'compact' });
    answerPut();
    await waitFor(() => expect(servers['u-1'].density).toBe('compact'));
    await waitFor(() => expect(hook!.navLayout).toBe('sections'));
    expect(radio(group, 'sections').checked).toBe(true);
  });
});

describe('INV-10 / SC-005 — this browser’s copy', () => {
  test('this person’s own sections record gives sections on the first render, before the GET answers', async () => {
    writeNavLayoutBootCache('u-1', 'sections');
    holdGet = true;
    mount(false);
    expect(seen[0]).toBe('sections');
    expect(seen).not.toContain('columns');
  });

  test('another person’s record is not applied: columns until their own answer', async () => {
    writeNavLayoutBootCache('u-2', 'sections');
    holdGet = true;
    mount(false);
    expect(seen[0]).toBe('columns');
  });

  test('the confirmed value is written under this person', async () => {
    servers['u-1'].navLayout = 'sections';
    mount(false);
    await waitFor(() => expect(readNavLayoutBootCache()).toEqual({ v: 1, userId: 'u-1', navLayout: 'sections' }));
  });

  test.each([
    ['a logout (the session answered: nobody)'],
    ['«not authorised» (a 401 resolved the session to nobody)'],
  ])('%s erases the record', async () => {
    writeNavLayoutBootCache('u-1', 'sections');
    const { rerender } = mount(false);
    await waitFor(() => expect(hook?.loaded).toBe(true));
    session = { ...session, user: null, sessionResolved: true };
    rerender();
    await waitFor(() => expect(window.localStorage.getItem(NAV_LAYOUT_BOOT_CACHE_KEY)).toBeNull());
  });

  test('a dropped connection neither erases the record nor resets the layout', async () => {
    writeNavLayoutBootCache('u-1', 'sections');
    failGet = true;
    const { rerender } = mount(false);
    await waitFor(() => expect(calls.filter((c) => c.method === 'GET').length).toBeGreaterThan(0));
    // the session itself becomes unknown (the /me request is failing too)
    session = { ...session, user: null, sessionResolved: false };
    rerender();
    expect(readNavLayoutBootCache()).toEqual({ v: 1, userId: 'u-1', navLayout: 'sections' });
    expect(hook!.navLayout).toBe('sections');
  });
});

describe('INV-10 — a late confirmation writes nothing', () => {
  test.each([['a logout'], ['a 401']])('PUT started, then %s, then the answer: the record stays empty', async () => {
    mount(false);
    await waitFor(() => expect(hook?.loaded).toBe(true));
    act(() => hook!.setNavLayout('sections'));
    await waitFor(() => expect(heldPuts).toHaveLength(1));
    session = { ...session, user: null, sessionResolved: true };
    rerenderLast();
    await waitFor(() => expect(window.localStorage.getItem(NAV_LAYOUT_BOOT_CACHE_KEY)).toBeNull());
    answerPut();
    await waitFor(() => expect(servers['u-1'].navLayout).toBe('sections'));
    await new Promise((r) => setTimeout(r, 0));
    expect(window.localStorage.getItem(NAV_LAYOUT_BOOT_CACHE_KEY)).toBeNull();
  });

  test('PUT started, then another person’s session, then the answer: the record is not the first person’s', async () => {
    mount(false);
    await waitFor(() => expect(hook?.loaded).toBe(true));
    act(() => hook!.setNavLayout('sections'));
    await waitFor(() => expect(heldPuts).toHaveLength(1));
    session = { ...session, user: U2 };
    rerenderLast();
    await waitFor(() => expect(readNavLayoutBootCache()?.userId).toBe('u-2'));
    answerPut();
    await waitFor(() => expect(servers['u-1'].navLayout).toBe('sections'));
    await new Promise((r) => setTimeout(r, 0));
    expect(readNavLayoutBootCache()).toEqual({ v: 1, userId: 'u-2', navLayout: 'columns' });
  });
});

describe('R2 — the provider-free reader', () => {
  function Optional({ out }: { out: string[] }) {
    out.push(useNavLayoutOptional());
    return null;
  }

  test('without QueryClientProvider, with a session and its own sections record → columns', () => {
    writeNavLayoutBootCache('u-1', 'sections');
    const out: string[] = [];
    render(<Optional out={out} />);
    expect(out[0]).toBe('columns');
  });

  test('without AuthProvider → columns, and it does not throw', () => {
    writeNavLayoutBootCache('u-1', 'sections');
    authProviderMounted = false;
    const out: string[] = [];
    const qc = new QueryClient();
    expect(() =>
      render(
        <QueryClientProvider client={qc}>
          <Optional out={out} />
        </QueryClientProvider>,
      ),
    ).not.toThrow();
    expect(out[0]).toBe('columns');
  });
});
