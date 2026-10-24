/**
 * sk-285.7 T019 — the MOBILE layout: a strip of zone tabs in INV-1 order
 * and a full-screen description sheet you can get back out of.
 *
 * Coverage matrix rows 28, 29 and 54 (US-6, INV-1, INV-10; SC-005,
 * SC-007):
 *   28 — "the order and set of zones is the same in all three modes"
 *   29 — "the total zone counter and the positional counter of the sheet react
 *        to the global issue lens"
 *   54 — "from the full-screen description sheet there is a way back to the list"
 *
 * ── How the lens is exercised ───────────────────────────────────────
 *
 * `useTasks` is mocked with an implementation that READS the lens
 * arguments it is handed and answers a different result set for each —
 * which is what the real hook does on the wire, and the only part of it
 * these two counters depend on. A mock that ignored the arguments would
 * make row 29 unfalsifiable: both counters would print the same number
 * whether or not the surfaces consulted the lens at all.
 *
 * The lens itself is turned on through the persisted flag rather than by
 * clicking the header toggle: the assertion is about the counters, and
 * routing it through a button would make a change to that button able to
 * fail this file for an unrelated reason.
 */

import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { setViewportWidth } from '../../../test/viewport';

// ─────────────────────────── Mocks ───────────────────────────

vi.mock('../../../auth/AuthContext', () => ({
  useAuthOptional: () => null,
  useAuth: () => ({
    user: {
      id: 'u-1',
      email: 'admin@test.com',
      username: 'admin',
      name: 'Admin',
      role: 'admin',
      createdAt: null,
      lastLoginAt: null,
    },
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

function issue(id: string, title: string) {
  return {
    id,
    projectId: 'p1',
    parentIdCurrent: null,
    version: 1,
    title,
    type: 'task',
    priority: 3,
    status: 'open',
    pinned: false,
    componentIds: [],
    labels: [],
    assignee: null,
    updatedAt: '2026-05-01T10:00:00Z',
    createdAt: '2026-05-01T09:00:00Z',
  };
}

/**
 * The unlensed result and the delegated-lens result, deliberately
 * different in BOTH length and membership.
 *
 * Different length so the aggregate counter has to move; different
 * membership so the positional counter has to move too — `sk-3` is
 * second in one list and first in the other, which is a change no
 * "recompute the total but keep the index" half-implementation can
 * produce.
 */
const ALL = [issue('sk-1', 'One'), issue('sk-3', 'Three'), issue('sk-9', 'Nine')];
const DELEGATED = [issue('sk-3', 'Three'), issue('sk-9', 'Nine')];

vi.mock('../../../lib/useTasks', async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return {
    ...actual,
    useTasks: (args: { outboxMode: boolean; onMeMode: boolean }) => {
      const data = args.outboxMode || args.onMeMode ? DELEGATED : ALL;
      return {
        data,
        tree: null,
        total: data.length,
        totalIsExact: true,
        hasNextPage: false,
        isFetchingNextPage: false,
        fetchNextPage: () => {},
        isLoading: false,
        error: null,
        emptyReason: null,
        searchDegraded: false,
        loadedAssignees: [],
        delegateeAssignees: [],
        resolvedProjectId: 'p1',
        min: null,
        max: null,
        sort: null,
      };
    },
  };
});

vi.mock('../../../lib/useInbox', () => ({
  inboxQueryKey: ['inbox', 'assigned-to-me-unaccepted-open'] as const,
  useInbox: () => ({
    data: { items: [issue('sk-1', 'One')], hasMore: false, nextCursor: null },
    isLoading: false,
    isError: false,
    isSuccess: true,
    error: null,
  }),
}));

vi.mock('../../../lib/useProjectsList', () => ({
  projectsListQueryKey: ['projects', 'list', 'shell'] as const,
  useProjectsList: () => ({
    data: { items: [], total: 0, hasMore: false, nextCursor: null },
    isLoading: false,
    isError: false,
    isSuccess: true,
    error: null,
  }),
  useProjectsInfinite: () => ({
    items: [],
    total: 0,
    isLoading: false,
    isFetching: false,
    isFetchingNextPage: false,
    isError: false,
    hasNextPage: false,
    fetchNextPage: () => {},
  }),
}));

vi.mock('../../../lib/useNotificationCounts', () => ({
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

import { Shell } from '../Shell';

// ─────────────────────────── Harness ───────────────────────────

const MOBILE = 390;
const TABLET = 1024;
const DESKTOP = 1440;

function Wrapper({ children, at = '/' }: { children: ReactNode; at?: string }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  // Real routes, because `useLayoutState` reads the open issue out of
  // `useParams()`. Without them `selectedIssue` is always null and the sheet
  // could never be reached.
  return (
    <MantineProvider forceColorScheme="dark">
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[at]}>
          <Routes>
            <Route path="/" element={children} />
            <Route path="/projects/:alias" element={children} />
            <Route path="/projects/:alias/issues/:id" element={children} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>
  );
}

/**
 * The zones as the DOM has them, top to bottom, named the way INV-1
 * names them. Reads the expanded class OR the sliver class for each, so
 * one list describes all three modes — a zone that is a 44px sliver in
 * tablet is still that zone in that position.
 */
function zoneOrder(): string[] {
  const map: ReadonlyArray<[string, string]> = [
    ['.col-inbox, .col-inbox-collapsed', 'queues'],
    ['.col-projects, .col-projects-collapsed', 'projects'],
    ['.col-tasks, .col-tasks-collapsed', 'tasks'],
    ['.col-details', 'details'],
  ];
  const found: Array<{ node: Element; name: string }> = [];
  for (const [selector, name] of map) {
    const node = document.querySelector(selector);
    if (node !== null) found.push({ node, name });
  }
  // Sort by document position so the answer is the DOM's order, not the
  // order this function happened to look things up in.
  found.sort((a, b) =>
    a.node.compareDocumentPosition(b.node) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
  );
  return found.map((f) => f.name);
}

/**
 * A tab's NAME, without the count beside it.
 *
 * sk-285.7 fidelity M1 — every tab carries its own number now
 * (`1g-mobile-390`), so `textContent` on a tab reads «Queues1». The name
 * and the count are separate claims and the tests that care about order
 * and selection want the first one; `tabCount` below is the other half.
 */
function tabName(tab: Element): string {
  const count = tab.querySelector('.zone-tab-count');
  const text = tab.textContent ?? '';
  return count === null ? text : text.slice(0, text.length - (count.textContent ?? '').length);
}

function tabNames(): string[] {
  const list = document.querySelector('.zone-tabs-list');
  if (list === null) return [];
  return [...list.querySelectorAll('[role="tab"]')].map(tabName);
}

/** The number printed on the tab whose name starts with `name`. */
function tabCount(name: string): string | null {
  const tab = [...document.querySelectorAll('.zone-tabs-list [role="tab"]')].find((b) =>
    tabName(b).startsWith(name),
  );
  return tab?.querySelector('.zone-tab-count')?.textContent ?? null;
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  setViewportWidth(DESKTOP);
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-width-mode');
});

// ── Row 28 / SC-005 — the zones, and their order ────────────────────

describe('T019 / row 28 — order and composition of the zones, in all three modes', () => {
  test.each([
    ['desktop', DESKTOP],
    ['tablet', TABLET],
    ['mobile', MOBILE],
  ])('%s renders all four zones in INV-1 order', (_name, width) => {
    setViewportWidth(width);
    render(
      <Wrapper>
        <Shell />
      </Wrapper>,
    );
    // INV-1: "header on top, below it the zones in the order Queues → Projects →
    // Task list → Task description". On a phone the last of them is
    // present but not displayed (it becomes the sheet when a task is
    // open); the composition and the ORDER are the claim here, and they
    // are identical in all three.
    expect(zoneOrder()).toEqual(['queues', 'projects', 'tasks', 'details']);
  });

  test('the mobile strip lists the three navigation zones in the same order', () => {
    setViewportWidth(MOBILE);
    render(
      <Wrapper>
        <Shell />
      </Wrapper>,
    );
    expect(tabNames()).toEqual(['Queues', 'Projects', 'Tasks']);
    // …and it is the same order the DOM has, not a second ordering that
    // happens to agree today. `zoneOrder()` minus the description is the
    // list the strip navigates.
    expect(zoneOrder().slice(0, 3)).toEqual(['queues', 'projects', 'tasks']);
  });

  test('no strip above the mobile threshold — every zone is already visible', () => {
    // The negative half of row 28: three tabs that select what is
    // already on screen would be three keyboard stops that do nothing.
    for (const width of [TABLET, DESKTOP]) {
      setViewportWidth(width);
      const view = render(
        <Wrapper>
          <Shell />
        </Wrapper>,
      );
      expect(document.querySelector('.zone-tabs'), `${width}px`).toBeNull();
      view.unmount();
    }
  });

  test('switching tabs changes which zone is active, not which zones exist', () => {
    setViewportWidth(MOBILE);
    render(
      <Wrapper>
        <Shell />
      </Wrapper>,
    );
    const main = document.querySelector('.shell-columns') as HTMLElement;
    expect(main.getAttribute('data-active-zone')).toBe('tasks');

    fireEvent.click(screen.getByRole('tab', { name: /^Queues/ }));
    expect(main.getAttribute('data-active-zone')).toBe('queues');
    // Still all four, still in order — the strip does not unmount a
    // zone, it marks which one the stylesheet shows. That is what keeps
    // the aggregate counter live while the user is in another zone.
    expect(zoneOrder()).toEqual(['queues', 'projects', 'tasks', 'details']);

    fireEvent.click(screen.getByRole('tab', { name: /^Projects/ }));
    expect(main.getAttribute('data-active-zone')).toBe('projects');
    expect(zoneOrder()).toEqual(['queues', 'projects', 'tasks', 'details']);
  });

  test('exactly one tab is selected, and it is the active zone', () => {
    setViewportWidth(MOBILE);
    render(
      <Wrapper>
        <Shell />
      </Wrapper>,
    );
    const selected = () =>
      [...document.querySelectorAll('[role="tab"]')]
        .filter((b) => b.getAttribute('aria-selected') === 'true')
        .map(tabName);
    expect(selected()).toEqual(['Tasks']);
    fireEvent.click(screen.getByRole('tab', { name: /^Queues/ }));
    expect(selected()).toEqual(['Queues']);
  });
});

// ── R10 on a phone — no width-resize surface, and no write ──────────

/**
 * The mobile counterpart of `TabletLayout.test.tsx`'s «no drag handles in
 * tablet», which had no equivalent here — and the gap was not theoretical.
 * `Shell.tsx` derived `inboxCollapsed` / `projectsCollapsed` as
 * `tabletSlivers || (!mobileZones && …)`, i.e. FALSE on a phone, and the
 * two navigation handles were rendered on the `!collapsed` condition
 * alone. A phone therefore drew two `role="separator"` stops that read the
 * persisted desktop widths into `aria-valuenow` and wrote them back
 * through `setColWidth` on an arrow key — inside a stacked
 * `.shell-columns` where nothing hid them.
 *
 * Two tests rather than one, because the first alone is what let this
 * survive elsewhere: «not on screen at mount» is the cheap half, and a
 * surface that reappeared after a tab switch, or a handle that wrote
 * without being visible, would sail past it. The second test does the
 * INTERACTION and then compares the persisted namespace byte for byte —
 * that is the half whose absence let the bug through.
 */
describe('T019 / R10 — a phone has no surface that reads or writes the persisted widths', () => {
  /** Deliberately un-round, so a written-back value cannot coincide. */
  const SEEDED: Readonly<Record<string, string>> = {
    'skein.layout.col.inbox': '311',
    'skein.layout.col.projects': '277',
    'skein.layout.col.tasks': '523',
  };

  /**
   * The persisted WIDTHS — the exact bytes `setColWidth` moves.
   *
   * Keyed by name rather than by a `skein.layout.col.` prefix scan: the
   * fold flags live in that namespace too (`…col.projects-collapsed`),
   * and `useLayoutState` write-throughs their defaults on mount in every
   * mode, desktop included. A prefix scan would therefore report a
   * difference that has nothing to do with the claim under test, and the
   * only way to keep it quiet would be to seed the flags as well — which
   * is seeding a snapshot to make it pass. The claim is "the persist of WIDTHS
   * is not written", so the snapshot is the widths.
   */
  function widthStorage(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const key of Object.keys(SEEDED)) {
      const value = window.localStorage.getItem(key);
      if (value !== null) out[key] = value;
    }
    return out;
  }

  /** Every resize surface on screen, named so a failure says WHICH. */
  function handles(): string[] {
    return [...document.querySelectorAll('[role="separator"], .resize-handle')].map(
      (h) => h.getAttribute('aria-label') ?? h.className,
    );
  }

  test('desktop first: the handles ARE there, so the mobile claim is not vacuous', () => {
    // The control. Without it «no handles on a phone» would also pass on
    // a build that had removed the handles from every mode, or on a
    // harness where they never rendered in the first place.
    setViewportWidth(DESKTOP);
    render(
      <Wrapper>
        <Shell />
      </Wrapper>,
    );
    expect(handles().length).toBeGreaterThan(0);
  });

  test('no drag handles on a phone — the one writer of the widths is not on screen', () => {
    setViewportWidth(MOBILE);
    render(
      <Wrapper>
        <Shell />
      </Wrapper>,
    );
    expect(handles()).toEqual([]);
  });

  test('nor after switching zones — the strip must not bring one back', () => {
    // Each tab shows a different zone, and the handles sit BETWEEN zones.
    // A condition written per-zone rather than per-mode would leak one
    // back the moment its neighbour became the active zone.
    setViewportWidth(MOBILE);
    render(
      <Wrapper>
        <Shell />
      </Wrapper>,
    );
    for (const tab of ['Queues', 'Projects', 'Tasks']) {
      // Matched on the name's START: sk-285.7 fidelity M1 put each tab's
      // count into its accessible name («Tasks, 3 items»).
      fireEvent.click(screen.getByRole('tab', { name: new RegExp(`^${tab}`) }));
      expect(handles(), `after selecting ${tab}`).toEqual([]);
    }
  });

  test('and a phone visit leaves the persisted widths byte-for-byte', () => {
    // The write half, and the reason this file needed a second test:
    // "absent at mount" says nothing about what happens when the surface
    // is USED. Every separator on screen is driven the way a keyboard
    // user would drive it — `ResizeHandle`'s ArrowLeft calls
    // `setColWidth`, the only writer of `skein.layout.col.*` — and the
    // widths are compared afterwards. Measured on the pre-fix build: two
    // separators on screen, and the seeded inbox 311 → 480 and projects
    // 277 → 400 (ArrowLeft nudged them, End snapped them to their bounds)
    // while the untouched tasks width stayed 523.
    for (const [key, value] of Object.entries(SEEDED)) {
      window.localStorage.setItem(key, value);
    }
    const before = widthStorage();
    expect(before).toEqual(SEEDED);

    setViewportWidth(MOBILE);
    render(
      <Wrapper>
        <Shell />
      </Wrapper>,
    );

    for (const handle of document.querySelectorAll('[role="separator"], .resize-handle')) {
      fireEvent.keyDown(handle, { key: 'ArrowLeft' });
      fireEvent.keyDown(handle, { key: 'End' });
    }

    expect(widthStorage()).toEqual(before);
  });
});

// ── Row 54 — the way back out of the sheet ──────────────────────────

describe('T019 / row 54 — the description sheet has a way back to the list', () => {
  test('opening a task on a phone gives a sheet with a back control', () => {
    setViewportWidth(MOBILE);
    render(
      <Wrapper at="/projects/p/issues/sk-3">
        <Shell />
      </Wrapper>,
    );
    const sheet = document.querySelector('.details-sheet');
    expect(sheet).not.toBeNull();
    // A real control, reachable by keyboard and named for where it goes
    // rather than for what it closes.
    const back = within(sheet as HTMLElement).getByRole('button', {
      name: 'Back to the task list',
    });
    expect(back.tagName).toBe('BUTTON');
  });

  test('pressing it returns to the list — no dead end', () => {
    setViewportWidth(MOBILE);
    render(
      <Wrapper at="/projects/p/issues/sk-3">
        <Shell />
      </Wrapper>,
    );
    expect(document.querySelector('.details-sheet')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Back to the task list' }));

    expect(document.querySelector('.details-sheet')).toBeNull();
    // …and what is behind it is the strip and the zones, not a blank
    // screen: "back" has to land somewhere.
    expect(tabNames()).toEqual(['Queues', 'Projects', 'Tasks']);
    expect(zoneOrder()).toEqual(['queues', 'projects', 'tasks', 'details']);
  });

  test('no sheet without an open task — an empty sheet would be the dead end', () => {
    // The negative path that makes the previous one meaningful: a sheet
    // that appeared with nothing in it would cover the strip with the
    // "select a task" placeholder, and its own back button would be the
    // only way out of a screen the user never asked for.
    setViewportWidth(MOBILE);
    render(
      <Wrapper>
        <Shell />
      </Wrapper>,
    );
    expect(document.querySelector('.details-sheet')).toBeNull();
  });

  test('above the mobile threshold the same task opens as a column, not a sheet', () => {
    for (const width of [TABLET, DESKTOP]) {
      setViewportWidth(width);
      const view = render(
        <Wrapper at="/projects/p/issues/sk-3">
          <Shell />
        </Wrapper>,
      );
      expect(document.querySelector('.details-sheet'), `${width}px`).toBeNull();
      expect(document.querySelector('.col-details'), `${width}px`).not.toBeNull();
      view.unmount();
    }
  });
});

describe('T019 / row 29 — the two new counters follow the global result lens', () => {
  /**
   * The Tasks number as the strip prints it.
   *
   * sk-285.7 fidelity M1 — it lives ON the Tasks tab now, not in a
   * strip-wide `.zone-tabs-total` at the right edge. The claim below is
   * unchanged and is the one that matters: whatever the strip prints for
   * Tasks moves with the lens, because it is the column's own published
   * number rather than a second derivation.
   */
  function stripTotal(): string | null {
    return tabCount('Tasks');
  }
  function sheetPosition(): string | null {
    return document.querySelector('.details-sheet-position')?.textContent ?? null;
  }

  test('the aggregate counter on the strip changes when the lens is on', () => {
    setViewportWidth(MOBILE);
    const off = render(
      <Wrapper>
        <Shell />
      </Wrapper>,
    );
    expect(stripTotal()).toBe(String(ALL.length));
    off.unmount();

    // The delegated lens, persisted the way the header toggle persists it.
    window.localStorage.setItem('skein.outbox-mode', 'true');
    render(
      <Wrapper>
        <Shell />
      </Wrapper>,
    );
    expect(stripTotal()).toBe(String(DELEGATED.length));
    expect(stripTotal()).not.toBe(String(ALL.length));
  });

  test('the positional counter in the sheet changes when the lens is on', () => {
    setViewportWidth(MOBILE);
    const off = render(
      <Wrapper at="/projects/p/issues/sk-3">
        <Shell />
      </Wrapper>,
    );
    // `sk-3` is the SECOND of three without the lens…
    expect(sheetPosition()).toBe('2 of 3');
    off.unmount();

    window.localStorage.setItem('skein.outbox-mode', 'true');
    render(
      <Wrapper at="/projects/p/issues/sk-3">
        <Shell />
      </Wrapper>,
    );
    // …and the FIRST of two under it. Both halves of the counter moved,
    // which no "recompute the total, keep the index" shortcut produces.
    expect(sheetPosition()).toBe('1 of 2');
  });

  test('the On-me lens moves them too — the rule is the lens, not one lens', () => {
    setViewportWidth(MOBILE);
    window.localStorage.setItem('skein.layout.onmode', 'true');
    render(
      <Wrapper at="/projects/p/issues/sk-3">
        <Shell />
      </Wrapper>,
    );
    expect(stripTotal()).toBe(String(DELEGATED.length));
    expect(sheetPosition()).toBe('1 of 2');
  });

  test('a task that is not in the lensed list has NO position, rather than a made-up one', () => {
    // The negative path INV-10 needs most: `sk-1` drops out of the
    // result under the delegated lens. It is still openable (from the
    // Queues column, from a link), and the sheet still has to work — but
    // "1 of 2" would place it in a list it is not in. Absent, not zero,
    // not one.
    setViewportWidth(MOBILE);
    window.localStorage.setItem('skein.outbox-mode', 'true');
    render(
      <Wrapper at="/projects/p/issues/sk-1">
        <Shell />
      </Wrapper>,
    );
    expect(document.querySelector('.details-sheet')).not.toBeNull();
    expect(sheetPosition()).toBeNull();
    // …and the way back is still there, which is the part that must not
    // depend on the counter.
    expect(
      screen.getByRole('button', { name: 'Back to the task list' }),
    ).toBeTruthy();
  });

  test('the strip counter and the Tasks column header never disagree', () => {
    // One number, published by the column, read by the strip — so this
    // cannot be satisfied by a second derivation that happens to agree
    // today.
    //
    // sk-285.7 fidelity M2 — the two are no longer on screen TOGETHER on
    // a phone: the stylesheet stands the duplicate header row down there
    // (`[data-width-mode='mobile'] .col-tasks-header.col-header-zone-
    // name-only`). Both are still in the DOM, which is what this reads,
    // and the equality is still the point: the header is what a wide
    // window shows and the tab is what a phone shows, so a divergence
    // would be two devices disagreeing about one number.
    setViewportWidth(MOBILE);
    render(
      <Wrapper>
        <Shell />
      </Wrapper>,
    );
    const header = document.querySelector('.col-tasks .col-header-count');
    expect(header).not.toBeNull();
    expect(stripTotal()).toBe((header as HTMLElement).textContent);
  });
});

// ── sk-285.7 fidelity M1 / M2 — one count per tab, one heading per zone ──

describe('sk-285.7 fidelity — the strip carries every zone’s own count', () => {
  test('each of the three tabs prints a number of its own', () => {
    // `1g-mobile-390`: «Queues 10 · Projects 5 · Tasks 49». The mocks
    // above give this harness one inbox item, no projects and three
    // tasks, so the three numbers are 1 / 0 / 3 — different from each
    // other, which is what makes a per-tab count distinguishable from
    // one number repeated three times.
    setViewportWidth(MOBILE);
    render(
      <Wrapper>
        <Shell />
      </Wrapper>,
    );
    expect(tabCount('Queues')).toBe('1');
    expect(tabCount('Projects')).toBe('0');
    expect(tabCount('Tasks')).toBe('3');
  });

  test('a zero is printed, not dropped', () => {
    // The Projects column answers 0 here. That is a fact about the
    // account, not a missing value, and the column headers print their
    // own zeroes for the same reason. `null` — a column that has not
    // answered — is the case that prints nothing, and it is not this one.
    setViewportWidth(MOBILE);
    render(
      <Wrapper>
        <Shell />
      </Wrapper>,
    );
    expect(tabCount('Projects')).toBe('0');
  });

  test('the count is named for assistive tech, not left as a loose token', () => {
    // The number is inside the tab now, so «Tasks 49» would reach a
    // screen reader as two unrelated words. The accessible name says
    // what the number counts (WCAG 1.3.1); the visible text stays short.
    setViewportWidth(MOBILE);
    render(
      <Wrapper>
        <Shell />
      </Wrapper>,
    );
    const tab = screen.getByRole('tab', { name: /^Tasks/ });
    expect(tab.getAttribute('aria-label')).toBe('Tasks, 3 items');
  });

  test('…and the Tasks header keeps its breadcrumb when there IS one', () => {
    // The other half of M2, and the reason the rule is keyed on a class
    // rather than on the column: with a project selected the heading is
    // a path no tab repeats, so the row survives — without the count and
    // the collapse button, which the strip and the phone respectively
    // make redundant.
    setViewportWidth(MOBILE);
    render(
      <Wrapper at="/projects/p">
        <Shell />
      </Wrapper>,
    );
    const header = document.querySelector('.col-tasks-header');
    expect(header).not.toBeNull();
    expect(header?.classList.contains('col-header-zone-name-only')).toBe(false);
  });

  test('…and drops it back when the project selection is cleared', () => {
    // The class is a STATE, not a mode: on the all-projects route the
    // same header is nothing but the zone name again.
    setViewportWidth(MOBILE);
    render(
      <Wrapper>
        <Shell />
      </Wrapper>,
    );
    const header = document.querySelector('.col-tasks-header');
    expect(header?.classList.contains('col-header-zone-name-only')).toBe(true);
  });
});

// ── sk-285.7.2.74 / audit M-2 — the way FORWARD in the sheet header ──

/**
 * §5 lists three things in the sheet's header — "a 56px header with '← Tasks',
 * the `4 of 49` counter, a next-task button" — and `1g-mobile-390`
 * frame 2 draws the third as a chevron immediately right of the counter.
 * The product had two: the header held exactly one `<button>`.
 *
 * The claims are about BEHAVIOUR, so they live beside the counter's own:
 * the control reads the same published list, which is what makes INV-10
 * true of it as well — a lens that renumbers «2 of 3» changes where this
 * button goes, and the assertions below exercise exactly that rather
 * than the button's existence.
 */
describe('M-2 — the sheet header offers the next task', () => {
  function nextButton(): HTMLButtonElement | null {
    return document.querySelector('.details-sheet-next');
  }

  test('it is there, beside the counter, and it is a real button', () => {
    setViewportWidth(MOBILE);
    render(
      <Wrapper at="/projects/p/issues/sk-3">
        <Shell />
      </Wrapper>,
    );
    const header = document.querySelector('.details-sheet-header');
    expect(header).not.toBeNull();
    // Two now: the way back and the way forward. The number is asserted
    // rather than just "the next button exists" so a third control
    // arriving unannounced in this band is a red test.
    expect(header!.querySelectorAll('button')).toHaveLength(2);
    const button = nextButton();
    expect(button).not.toBeNull();
    expect(button!.tagName).toBe('BUTTON');
    // §8's control step, drawn rather than spelled: the pack lists
    // `chevron-down` and the reference draws a glyph, not a character.
    expect(button!.querySelector('svg')).not.toBeNull();
    expect(button!.getAttribute('aria-label')).toBe('Next task in the list');
    // …and it sits with the counter, not at the far end of the band.
    expect(button!.closest('.details-sheet-nav')?.querySelector('.details-sheet-position'))
      .not.toBeNull();
  });

  test('pressing it opens the task the published list puts next', () => {
    setViewportWidth(MOBILE);
    render(
      <Wrapper at="/projects/p/issues/sk-3">
        <Shell />
      </Wrapper>,
    );
    expect(document.querySelector('.details-sheet-position')?.textContent).toBe('2 of 3');
    fireEvent.click(nextButton()!);
    // `sk-9` follows `sk-3` in ALL — read off the list, not off an
    // alphabetical or id order the component might have invented.
    expect(document.querySelector('.details-sheet-position')?.textContent).toBe('3 of 3');
  });

  test('the LENS decides what "next" means (INV-10)', () => {
    // The claim that makes this button part of INV-10 rather than a
    // decoration next to it. `sk-1` is first in ALL and absent from
    // DELEGATED; with the lens off the next task after it is `sk-3`,
    // and the same press under the lens cannot happen at all because
    // `sk-1` is not in the list — which the block below asserts.
    setViewportWidth(MOBILE);
    const off = render(
      <Wrapper at="/projects/p/issues/sk-1">
        <Shell />
      </Wrapper>,
    );
    expect(document.querySelector('.details-sheet-position')?.textContent).toBe('1 of 3');
    fireEvent.click(nextButton()!);
    expect(document.querySelector('.details-sheet-position')?.textContent).toBe('2 of 3');
    off.unmount();

    window.localStorage.setItem('skein.outbox-mode', 'true');
    render(
      <Wrapper at="/projects/p/issues/sk-3">
        <Shell />
      </Wrapper>,
    );
    // Under the lens `sk-3` is FIRST, so the next one is `sk-9` and the
    // counter reads two, not three. Same press, different destination —
    // because the list moved, not because the button did.
    expect(document.querySelector('.details-sheet-position')?.textContent).toBe('1 of 2');
    fireEvent.click(nextButton()!);
    expect(document.querySelector('.details-sheet-position')?.textContent).toBe('2 of 2');
  });

  test('on the last row it is disabled rather than gone', () => {
    // Two states, two different true statements: the pair is on screen
    // because the issue IS in the list, and the chevron is grey because
    // the list ends here. Removing the button instead would slide the
    // counter sideways on the one row where nothing else changed.
    setViewportWidth(MOBILE);
    render(
      <Wrapper at="/projects/p/issues/sk-9">
        <Shell />
      </Wrapper>,
    );
    expect(document.querySelector('.details-sheet-position')?.textContent).toBe('3 of 3');
    expect(nextButton()).not.toBeNull();
    expect(nextButton()!.disabled).toBe(true);
  });

  test('a task outside the lensed list gets NO counter and no chevron', () => {
    // The same negative path the counter has, and for the same reason:
    // "next" is a place in a list this issue is not in. Absent, not
    // disabled — a disabled control would claim the list applies here.
    setViewportWidth(MOBILE);
    window.localStorage.setItem('skein.outbox-mode', 'true');
    render(
      <Wrapper at="/projects/p/issues/sk-1">
        <Shell />
      </Wrapper>,
    );
    expect(document.querySelector('.details-sheet')).not.toBeNull();
    expect(document.querySelector('.details-sheet-position')).toBeNull();
    expect(nextButton()).toBeNull();
    // …and the way OUT is untouched by that, which is the part the
    // sheet cannot be without.
    expect(screen.getByRole('button', { name: 'Back to the task list' })).toBeTruthy();
  });

  test('there is no chevron off the sheet — this is the phone’s control', () => {
    // Desktop has the column beside the list and needs no positional
    // navigation inside the card; the button belongs to the sheet's
    // header, which only the phone draws.
    setViewportWidth(1440);
    render(
      <Wrapper at="/projects/p/issues/sk-3">
        <Shell />
      </Wrapper>,
    );
    expect(document.querySelector('.details-sheet')).toBeNull();
    expect(nextButton()).toBeNull();
  });
});

// ── sk-285.7.2.75 / audit M-3 — one exit on a phone, not two ────────

/**
 * The stylesheet half — that `[data-width-mode='mobile']` really hides
 * `.details-header-close` — is seen in a browser. This is the half that
 * stylesheet cannot make: hiding the ✕ is only safe because the band that carries «←
 * Tasks» is present in EVERY phone state that can draw the metadata row.
 *
 * The two come from different expressions in `Shell.tsx` —
 * `detailsAsSheet = mobileZones && selectedIssue !== null` for the band,
 * an open issue for the row inside `IssueDetailPanel` — so this is a
 * claim about the component, not an identity. The condition is asserted
 * on the band, which is what this harness mounts: the issue query is not
 * stubbed here, so the panel's own row never renders and an assertion
 * about it would be about the stub, not about the app.
 */
describe('M-3 — the phone draws the band in every state that can hold the ✕', () => {
  test('an open issue on a phone: the band and its way back are there', () => {
    setViewportWidth(MOBILE);
    render(
      <Wrapper at="/projects/p/issues/sk-3">
        <Shell />
      </Wrapper>,
    );
    expect(document.querySelector('.details-sheet-header')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Back to the task list' })).toBeTruthy();
  });

  test('no open issue on a phone: no band, and no row to hide a ✕ in', () => {
    // The state the hiding rule must not be asked about — and the reason
    // `detailsAsSheet` is narrow: a sheet with no issue would cover the
    // strip with an empty screen whose only exit is its own back button.
    setViewportWidth(MOBILE);
    render(
      <Wrapper at="/projects/p">
        <Shell />
      </Wrapper>,
    );
    expect(document.querySelector('.details-sheet-header')).toBeNull();
    expect(document.querySelector('.details-header')).toBeNull();
  });

  test('off the phone there is no band — which is why the ✕ stays there', () => {
    setViewportWidth(1440);
    render(
      <Wrapper at="/projects/p/issues/sk-3">
        <Shell />
      </Wrapper>,
    );
    expect(document.querySelector('.details-sheet')).toBeNull();
    expect(document.querySelector('.details-sheet-header')).toBeNull();
    // …and the column that holds the row is the ordinary one.
    expect(document.querySelector('.col-details')).not.toBeNull();
  });
});
