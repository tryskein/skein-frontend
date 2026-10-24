/**
 * sk-551.8 F8 — the layout provider's sections machinery: the fold router
 * (plan P11), applying the fold rules, the address subscriber (P12/P3)
 * with the side-by-side gate (P4), and the layout-change cell (P13).
 *
 * Reference: spec "Fold events rule" (Scope, Concepts — Reveal
 * by address, layer 1), US-9, US-12, INV-3; plan P3, P4, P11–P13.
 *
 * Only the provider is mounted (no Shell). The session is a boundary and
 * is stubbed (`auth/AuthContext`); the active layout comes the real way —
 * the person's profile in the query cache, read by `useNavLayoutOptional`.
 * Navigation Timing does not exist in jsdom and is stubbed through
 * `performance.getEntriesByType`; the intent functions and the subscriber
 * are the real ones.
 *
 * `navAddressIntent` answers the initial-load question once per DOCUMENT
 * (module state), so every case mounts a fresh copy of the module graph
 * (`vi.resetModules` + dynamic imports, React included) — a new document.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ViewMode } from '../../api/issues';
import type { NavLayout } from '../../api/uiPrefs';
import { resetViewportWidth, setViewportWidth } from '../../test/viewport';

const USER = { id: 'u-1', username: 'u1', role: 'user' };

vi.mock('../../auth/AuthContext', () => {
  const session = {
    user: USER,
    isLoading: false,
    sessionResolved: true,
    login: vi.fn(),
    logout: vi.fn(),
  };
  return { useAuth: () => session, useAuthOptional: () => session };
});

type LayoutModule = typeof import('../useLayoutState');
type Api = ReturnType<LayoutModule['useLayoutState']>;
type Entry = string | { pathname: string; search?: string; state?: unknown };

interface Mounted {
  api: () => Api;
  location: () => { key: string; search: string; state: unknown };
  navigate: (to: string | number, opts?: { state?: unknown }) => Promise<void>;
  act: (fn: () => void) => Promise<void>;
  /** The person's profile now carries this layout (a late GET, another tab). */
  setLayout: (layout: NavLayout) => Promise<void>;
  unmount: () => void;
}

/** The module graph of the last fresh mount, for a second provider in the SAME document. */
let lastGraph: Awaited<ReturnType<typeof loadGraph>> | null = null;

async function loadGraph() {
  return {
    React: await import('react'),
    rtl: await import('@testing-library/react'),
    rr: await import('react-router-dom'),
    rq: await import('@tanstack/react-query'),
    ls: (await import('../useLayoutState')) as LayoutModule,
    prefs: await import('../useUiPrefs'),
  };
}

let cleanups: Array<() => void> = [];

async function mount(opts: {
  /** The person's profile layout; `null` — the profile has not answered yet. */
  layout: NavLayout | null;
  entries: Entry[];
  index?: number;
  width?: number;
  navType?: string | null;
  /** The task view the shell reports on mount (`syncNavView`). */
  view?: ViewMode;
  /** Mount into the module graph of the previous mount — the same document. */
  sameDocument?: boolean;
}): Promise<Mounted> {
  if (!opts.sameDocument) {
    vi.resetModules();
    const navType = opts.navType ?? null;
    vi.spyOn(performance, 'getEntriesByType').mockImplementation((kind: string) =>
      kind === 'navigation' && navType !== null
        ? ([{ type: navType }] as unknown as PerformanceEntryList)
        : [],
    );
    lastGraph = await loadGraph();
  }
  setViewportWidth(opts.width ?? 1440);
  const { React, rtl, rr, rq, ls, prefs } = lastGraph!;

  const qc = new rq.QueryClient();
  if (opts.layout !== null) {
    qc.setQueryData(prefs.uiPrefsKey(USER.id), {
      issueModalViews: [],
      density: 'normal',
      navLayout: opts.layout,
    });
  }

  let api: Api | null = null;
  let loc: { key: string; search: string; state: unknown } | null = null;
  let nav: ((to: string | number, o?: { state?: unknown }) => void) | null = null;
  const view = opts.view;
  function Probe() {
    api = ls.useLayoutState();
    // A child's layout effect runs before the provider's effects — the
    // shell reports its view before the address subscriber looks.
    const sync = api.syncNavView;
    React.useLayoutEffect(() => {
      if (view !== undefined) sync(view);
    }, [sync]);
    const l = rr.useLocation();
    loc = { key: l.key, search: l.search, state: l.state };
    const n = rr.useNavigate();
    nav = (to, o) => (typeof to === 'number' ? n(to) : n(to, o));
    return null;
  }
  const h = React.createElement;
  const rendered = rtl.render(
    h(
      rq.QueryClientProvider,
      { client: qc },
      h(
        rr.MemoryRouter,
        { initialEntries: opts.entries, initialIndex: opts.index ?? 0 },
        h(ls.LayoutProvider, null, h(Probe)),
      ),
    ),
  );
  cleanups.push(() => rendered.unmount());
  return {
    api: () => api!,
    location: () => loc!,
    navigate: async (to, o) => {
      await rtl.act(async () => nav!(to, o));
    },
    act: async (fn) => {
      await rtl.act(async () => fn());
    },
    setLayout: async (layout) => {
      await rtl.act(async () => {
        qc.setQueryData(prefs.uiPrefsKey(USER.id), {
          issueModalViews: [],
          density: 'normal',
          navLayout: layout,
        });
      });
    },
    unmount: () => rendered.unmount(),
  };
}

/** Every `skein.layout.*` key and its value. */
function layoutKeys(): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const k = window.localStorage.key(i)!;
    if (k.startsWith('skein.layout.')) out[k] = window.localStorage.getItem(k);
  }
  return out;
}

const NAV_COLLAPSED = 'skein.layout.nav.collapsed';
const NAV_SECTIONS = 'skein.layout.nav.sections';
const NAV_WORKSPACE = 'skein.layout.nav.workspace';

function queuesFolded(): boolean {
  const raw = window.localStorage.getItem(NAV_SECTIONS);
  return raw !== null && (JSON.parse(raw) as { collapsed: { queues: boolean } }).collapsed.queues;
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  for (const c of cleanups) c();
  cleanups = [];
  vi.restoreAllMocks();
  resetViewportWidth();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('F8 (1) — dispatchNavEvent writes the fold rules’ result, the deferred return carries over', () => {
  it('board, sliver by auto-fold, shared file: leaving for cards, then closing the file, opens the column', async () => {
    window.localStorage.setItem(NAV_COLLAPSED, 'true');
    window.localStorage.setItem(NAV_WORKSPACE, JSON.stringify({ auto: true, optOut: false }));
    const m = await mount({ layout: 'sections', entries: ['/?file=att-1'] });
    // The shell reports the shared file it finds on screen.
    await m.act(() => {
      m.api().dispatchNavEvent({ type: 'fileOpened' }, 'kanban');
    });

    await m.act(() => {
      m.api().dispatchNavEvent({ type: 'viewChanged', from: 'kanban', to: 'cards', onShownShell: true }, 'kanban');
    });
    // deferred: nothing opened yet
    expect(window.localStorage.getItem(NAV_COLLAPSED)).toBe('true');

    await m.navigate('/');
    await m.act(() => {
      m.api().dispatchNavEvent({ type: 'fileClosed' }, 'cards');
    });
    expect(window.localStorage.getItem(NAV_COLLAPSED)).toBe('false');
    expect(JSON.parse(window.localStorage.getItem(NAV_WORKSPACE)!)).toEqual({ auto: false, optOut: false });
    expect(m.api().navColumnCollapsed).toBe(false);
  });
});

describe('F8 (2) — reportQueueFell is routed by the active layout and the width', () => {
  it('sections on a phone: not a single skein.layout.* key changes', async () => {
    window.localStorage.setItem('skein.layout.inbox-collapsed', 'false');
    const m = await mount({ layout: 'sections', entries: ['/'], width: 500 });
    const before = layoutKeys();
    await m.act(() => m.api().reportQueueFell());
    expect(layoutKeys()).toEqual(before);
  });

  it('sections on a desktop: only the Queues section folds', async () => {
    const m = await mount({ layout: 'sections', entries: ['/'] });
    await m.act(() => m.api().reportQueueFell());
    expect(queuesFolded()).toBe(true);
    expect(m.api().navSectionsCollapsed).toEqual({ projects: false, queues: true });
    expect(window.localStorage.getItem('skein.layout.inbox-collapsed')).not.toBe('true');
  });

  it('side-by-side: the Queues column folds as before', async () => {
    const m = await mount({ layout: 'columns', entries: ['/'] });
    await m.act(() => m.api().reportQueueFell());
    expect(m.api().inboxCollapsed).toBe(true);
    expect(window.localStorage.getItem('skein.layout.inbox-collapsed')).toBe('true');
    expect(window.localStorage.getItem(NAV_SECTIONS)).toBeNull();
  });
});

describe('F8 (3) — setInboxTab plants the one-shot mark, a lens move does not carry it', () => {
  it('selfOpenedFile survives, queueReveal is planted, the next lens switch drops it', async () => {
    const m = await mount({
      layout: 'columns',
      entries: [{ pathname: '/', search: '?tab=inbox&lens=on-me', state: { selfOpenedFile: true } }],
    });
    await m.act(() => m.api().setInboxTab('mentions'));
    const planted = m.location().state as Record<string, unknown>;
    expect(planted.selfOpenedFile).toBe(true);
    expect(typeof planted.queueReveal).toBe('number');

    await m.act(() => m.api().setOutboxMode(true)); // lens switch: same path, state carried
    const carried = m.location().state as Record<string, unknown>;
    expect(new URLSearchParams(m.location().search).get('lens')).toBe('delegated');
    expect(carried.selfOpenedFile).toBe(true);
    expect('queueReveal' in carried).toBe(false);
  });
});

describe('F8 (4) — the P13 cell', () => {
  it('a noted gesture is «gesture» exactly once; without a note — «profile»', async () => {
    const m = await mount({ layout: 'columns', entries: ['/'] });
    m.api().noteNavModeGesture('sections');
    expect(m.api().takeNavModeSource('sections')).toBe('gesture');
    expect(m.api().takeNavModeSource('sections')).toBe('profile');
    expect(m.api().takeNavModeSource('columns')).toBe('profile');
  });

  it('a series sections → columns before observation, then a rollback to sections: «profile», the cell empty', async () => {
    const m = await mount({ layout: 'columns', entries: ['/'] });
    m.api().noteNavModeGesture('sections');
    m.api().noteNavModeGesture('columns');
    expect(m.api().takeNavModeSource('sections')).toBe('profile');
    expect(m.api().takeNavModeSource('columns')).toBe('profile');
  });

  it('a new provider does not inherit the cell', async () => {
    const first = await mount({ layout: 'columns', entries: ['/'] });
    first.api().noteNavModeGesture('sections');
    first.unmount();
    // The same document (module graph): only the provider is new.
    const second = await mount({ layout: 'columns', entries: ['/'], sameDocument: true });
    expect(second.api().takeNavModeSource('sections')).toBe('profile');
  });
});

describe('F8 (5) — the P12 subscriber, sections active', () => {
  it('a PUSH carrying queueReveal opens the Queues section and the mark leaves the entry', async () => {
    window.localStorage.setItem(NAV_SECTIONS, JSON.stringify({ split: 0.5, collapsed: { projects: false, queues: true } }));
    // On a board, with the board's auto-fold mark: a reveal by address
    // sets no opt-out and keeps the mark (a gesture would do both).
    window.localStorage.setItem(NAV_COLLAPSED, 'true');
    window.localStorage.setItem(NAV_WORKSPACE, JSON.stringify({ auto: true, optOut: false }));
    const m = await mount({ layout: 'sections', entries: ['/start', '/?tab=inbox'], index: 1, view: 'kanban' });
    expect(queuesFolded()).toBe(true);
    await m.navigate('/?tab=mentions', { state: { queueReveal: 77, selfOpenedFile: true } });
    expect(queuesFolded()).toBe(false);
    expect(window.localStorage.getItem(NAV_COLLAPSED)).toBe('false');
    expect(JSON.parse(window.localStorage.getItem(NAV_WORKSPACE)!)).toEqual({ auto: true, optOut: false });
    const state = m.location().state as Record<string, unknown>;
    expect('queueReveal' in state).toBe(false);
    expect(state.selfOpenedFile).toBe(true);
    // Taken off THE entry, not left behind it: Back lands on the entry
    // before the move, not on a marked copy of this one.
    await m.navigate(-1);
    expect(new URLSearchParams(m.location().search).get('tab')).toBe('inbox');
  });

  it('a POP onto an entry that still carries a nonce opens nothing', async () => {
    window.localStorage.setItem(NAV_SECTIONS, JSON.stringify({ split: 0.5, collapsed: { projects: false, queues: true } }));
    const m = await mount({
      layout: 'sections',
      entries: [{ pathname: '/', search: '?tab=watching', state: { queueReveal: 5 } }, '/?tab=inbox'],
      index: 1,
    });
    await m.navigate(-1);
    expect(new URLSearchParams(m.location().search).get('tab')).toBe('watching');
    expect(queuesFolded()).toBe(true);
  });

  it('side-by-side active: the subscriber reads nothing — the mark stays on the entry', async () => {
    const m = await mount({ layout: 'columns', entries: ['/start', '/?tab=inbox'], index: 1 });
    await m.navigate('/?tab=mentions', { state: { queueReveal: 9 } });
    expect((m.location().state as Record<string, unknown>).queueReveal).toBe(9);
    expect(window.localStorage.getItem(NAV_SECTIONS)).toBeNull();
  });
});

describe('F8 (6) — source (a) through the real subscriber', () => {
  const seed = () => {
    window.localStorage.setItem(NAV_COLLAPSED, 'true');
    window.localStorage.setItem(NAV_SECTIONS, JSON.stringify({ split: 0.5, collapsed: { projects: false, queues: true } }));
    window.localStorage.setItem('skein.layout.inbox-collapsed', 'true');
    window.localStorage.setItem(
      'skein.layout.kanban-workspace',
      JSON.stringify({ auto: { inbox: true, projects: false }, optOut: { inbox: false, projects: true } }),
    );
    window.history.replaceState(null, '', '/?tab=watching');
  };

  it('navigate, the initial entry, empty sessionStorage, /?tab=watching on a board: column and Queues open, no opt-out, the mark kept, side-by-side keys untouched', async () => {
    seed();
    window.localStorage.setItem(NAV_WORKSPACE, JSON.stringify({ auto: true, optOut: false }));
    const sideBySide = {
      inbox: window.localStorage.getItem('skein.layout.inbox-collapsed'),
      workspace: window.localStorage.getItem('skein.layout.kanban-workspace'),
    };
    await mount({ layout: 'sections', entries: ['/?tab=watching'], navType: 'navigate', view: 'kanban' });
    expect(window.localStorage.getItem(NAV_COLLAPSED)).toBe('false');
    expect(queuesFolded()).toBe(false);
    // A gesture on the board would have set the opt-out and dropped the mark.
    expect(JSON.parse(window.localStorage.getItem(NAV_WORKSPACE)!)).toEqual({ auto: true, optOut: false });
    expect(window.localStorage.getItem('skein.layout.inbox-collapsed')).toBe(sideBySide.inbox);
    expect(window.localStorage.getItem('skein.layout.kanban-workspace')).toBe(sideBySide.workspace);
  });

  it('the same mount with the type reload opens nothing', async () => {
    seed();
    await mount({ layout: 'sections', entries: ['/?tab=watching'], navType: 'reload' });
    expect(window.localStorage.getItem(NAV_COLLAPSED)).toBe('true');
    expect(queuesFolded()).toBe(true);
  });

  it('type navigate, but the href is already in sessionStorage (duplicate / restore): opens nothing', async () => {
    seed();
    window.sessionStorage.setItem('skein.nav.address-reveal-href', window.location.href);
    await mount({ layout: 'sections', entries: ['/?tab=watching'], navType: 'navigate' });
    expect(window.localStorage.getItem(NAV_COLLAPSED)).toBe('true');
    expect(queuesFolded()).toBe(true);
  });
});

describe('F8 (6) — the initial-load question: once per document, only for the first entry while no move has happened', () => {
  const seed = () => {
    window.localStorage.setItem(NAV_COLLAPSED, 'true');
    window.localStorage.setItem(NAV_SECTIONS, JSON.stringify({ split: 0.5, collapsed: { projects: false, queues: true } }));
    window.localStorage.setItem(NAV_WORKSPACE, JSON.stringify({ auto: true, optOut: false }));
    window.history.replaceState(null, '', '/?tab=watching');
  };

  it('(i) side-by-side first, a PUSH, sections switched on, Back (POP) onto the first entry: nothing opens', async () => {
    seed();
    const m = await mount({ layout: 'columns', entries: ['/?tab=watching'], navType: 'navigate', view: 'kanban' });
    await m.navigate('/?tab=inbox');
    await m.setLayout('sections');
    await m.navigate(-1);
    expect(new URLSearchParams(m.location().search).get('tab')).toBe('watching');
    expect(window.localStorage.getItem(NAV_COLLAPSED)).toBe('true');
    expect(queuesFolded()).toBe(true);
  });

  it('(ii) a link load whose first frame is side-by-side (no stored record), the first profile answer brings sections on the same entry: opens, no opt-out', async () => {
    seed();
    const m = await mount({ layout: null, entries: ['/?tab=watching'], navType: 'navigate', view: 'kanban' });
    expect(window.localStorage.getItem(NAV_COLLAPSED)).toBe('true');
    await m.setLayout('sections');
    expect(window.localStorage.getItem(NAV_COLLAPSED)).toBe('false');
    expect(queuesFolded()).toBe(false);
    expect(JSON.parse(window.localStorage.getItem(NAV_WORKSPACE)!)).toEqual({ auto: true, optOut: false });
  });

  it('(iii) the same, but a PUSH happened before sections arrived: nothing opens', async () => {
    seed();
    const m = await mount({ layout: null, entries: ['/?tab=watching'], navType: 'navigate', view: 'kanban' });
    await m.navigate('/?tab=inbox');
    await m.setLayout('sections');
    expect(window.localStorage.getItem(NAV_COLLAPSED)).toBe('true');
    expect(queuesFolded()).toBe(true);
  });
});

describe('F8 — gestures use the view the shell reported (syncNavView)', () => {
  it('view synced to the board: a click on the sliver opens the column and writes the opt-out (US-7)', async () => {
    window.localStorage.setItem(NAV_COLLAPSED, 'true');
    window.localStorage.setItem(NAV_WORKSPACE, JSON.stringify({ auto: true, optOut: false }));
    const m = await mount({ layout: 'sections', entries: ['/start', '/x'], index: 1, view: 'kanban' });
    await m.act(() => {
      m.api().setNavCollapsed(false);
    });
    expect(window.localStorage.getItem(NAV_COLLAPSED)).toBe('false');
    expect(JSON.parse(window.localStorage.getItem(NAV_WORKSPACE)!)).toEqual({ auto: false, optOut: true });
  });
});

describe('F8 (6) — decided by the person’s FIRST KNOWN layout', () => {
  it('(iv) a link load, the first profile answer is side-by-side, then sections on the same entry: no reveal by address', async () => {
    window.localStorage.setItem(NAV_COLLAPSED, 'true');
    window.localStorage.setItem(NAV_SECTIONS, JSON.stringify({ split: 0.5, collapsed: { projects: false, queues: true } }));
    window.history.replaceState(null, '', '/?tab=inbox');
    // No stored record: the first known layout is the profile's `columns`.
    const m = await mount({ layout: 'columns', entries: ['/?tab=inbox'], navType: 'navigate', view: 'kanban' });
    await m.setLayout('sections');
    expect(queuesFolded()).toBe(true);
    expect(window.localStorage.getItem(NAV_COLLAPSED)).toBe('true');
  });
});
