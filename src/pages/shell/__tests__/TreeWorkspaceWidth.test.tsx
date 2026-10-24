/**
 * sk-285.2.23 — the tree takes the workspace the same way the board does.
 *
 * This file used to pin sk-285.2.9: a width PROJECTION that pinned the two
 * navigation columns to a tree-only floor and handed the difference to the
 * Tasks column. That helper (`treeWorkspaceWidths.ts`) is gone. It could not
 * reach the number the acceptance remark asked for — "about as wide as the kanban"
 * — because the pixels the tree needed were the ones the navigation
 * columns were still holding, all of them, which is what FOLDING does and
 * pinning cannot.
 *
 * So the tree now enters by the board's door: `enterWorkspaceView` /
 * `leaveWorkspaceView` in `useLayoutState`, one shared record, one class
 * (`.col-tasks-fill`) that makes the Tasks column flex into the row while
 * Details holds a width of its own (sk-551.29 / sk-551.3, `index.css`).
 *
 * What that leaves to test HERE is the WIRING — the four ways the shared
 * mechanism can still be mis-wired for the tree specifically, none of which
 * `useLayoutState.test.tsx` (which drives the hook directly) can see:
 *
 *   1. Entering the tree folds; leaving it gives back exactly what the fold
 *      took, and never more.
 *   2. A RELOAD inside the tree folds nothing — the columns come back the way
 *      the user left them. That is the one behaviour this design exists to
 *      protect, and it is the mount path, not the transition path.
 *   3. Board ↔ tree is not a transition at all: both are workspace views, so
 *      the columns hold still and a column the user re-opened by hand on the
 *      board stays open in the tree.
 *   4. The Tasks column stops carrying a width and starts flexing, while the
 *      PERSISTED width — the number a drag moves and Cards view reads back —
 *      is left untouched in storage and on the handle.
 *
 * Same harness as `Shell.test.tsx`: the data hooks are mocked so the real
 * layout renders with deterministic, empty content. Widths are read off the
 * inline `style` the columns set, which is the only place they exist under
 * vitest (`css: false` — there is no cascade and no layout engine). Which is
 * also why nothing below asserts a PIXEL of the filling column: the row is
 * flexed by the browser.
 */

import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ─────────────────────────── Mocks ───────────────────────────

vi.mock('../../../auth/AuthContext', () => ({
  // sk-551.8 — LayoutProvider reads the layout via useNavLayoutOptional;
  // null = no session known, the side-by-side layout.
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

// One inbox item on purpose: an EMPTY inbox auto-collapses the Queues
// column (Q32), and a collapsed column lends nothing — the projection
// under test would become a no-op and every assertion below would pass
// vacuously.
vi.mock('../../../lib/useInbox', () => ({
  inboxQueryKey: ['inbox', 'assigned-to-me-unaccepted-open'] as const,
  useInbox: () => ({
    data: {
      items: [
        {
          id: 'sk-1',
          projectId: 'p1',
          parentIdCurrent: null,
          version: 1,
          title: 'Sample inbox issue',
          type: 'task',
          priority: 3,
          status: 'open',
          pinned: false,
          componentIds: [],
          labels: [],
          updatedAt: '2026-05-01T10:00:00Z',
          createdAt: '2026-05-01T09:00:00Z',
        },
      ],
      hasMore: false,
      nextCursor: null,
    },
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
import { COL_BOUNDS } from '../../../lib/useLayoutState';
import i18n from '../../../i18n/config';

const VIEW_KEY = 'skein.tasks.view';
const WIDTH_KEY = {
  inbox: 'skein.layout.col.inbox',
  projects: 'skein.layout.col.projects',
  tasks: 'skein.layout.col.tasks',
} as const;

/**
 * Widths the user dragged. Two properties make them usable as evidence,
 * and the test right below asserts both rather than trusting the
 * numbers to stay true:
 *
 *   • inside `[min, max]`, so nothing here is silently clamped on read
 *     and every assertion is about persistence rather than clamping;
 *   • DIFFERENT from the column's `default`, so "the persisted width
 *     came back" cannot be satisfied by the default falling through.
 *
 * The second one is why `projects` is 320 rather than the 300 it was
 * until sk-285.7: T009 moved that column's default to exactly 300 (the
 * width handoff §1 gives), and five assertions below quietly became
 * tautologies the moment it did — they would have passed just as well
 * on a build that had lost the stored value entirely.
 */
const PERSISTED = {
  inbox: 260,
  projects: 320,
  tasks: 460,
} as const;

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return (
    <MantineProvider forceColorScheme="dark">
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/projects/demo']}>{children}</MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>
  );
}

/** Inline width the column rendered with, in px. */
function widthOf(selector: string): number {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`no element for ${selector}`);
  return Number.parseInt(el.style.width, 10);
}

function renderShell(view: 'cards' | 'tree' | 'kanban') {
  window.localStorage.setItem(VIEW_KEY, view);
  window.localStorage.setItem(WIDTH_KEY.inbox, String(PERSISTED.inbox));
  window.localStorage.setItem(WIDTH_KEY.projects, String(PERSISTED.projects));
  window.localStorage.setItem(WIDTH_KEY.tasks, String(PERSISTED.tasks));
  render(
    <Wrapper>
      <Shell />
    </Wrapper>,
  );
}

/**
 * The header's view button, found by the label it actually renders.
 *
 * By label rather than by position: the switcher is three buttons in a row
 * and an index would keep passing while pointing at the wrong one if their
 * order ever changed. The label is built from the same i18n keys the
 * component uses, so a renamed string moves both sides at once and a MISSING
 * button fails loudly here instead of silently skipping a click.
 */
function viewButton(view: 'cards' | 'tree' | 'kanban'): HTMLElement {
  const label = `${i18n.t('filters:labels.view')}: ${i18n.t(`filters:view.${view}`)}`;
  const el = document.querySelector<HTMLElement>(
    `.header-view-btn[aria-label="${label}"]`,
  );
  if (!el) throw new Error(`no view button for "${view}" (aria-label "${label}")`);
  return el;
}

/** Switch views the way a user does — through the header switcher. */
function switchTo(view: 'cards' | 'tree' | 'kanban') {
  fireEvent.click(viewButton(view));
  expect(viewButton(view).getAttribute('aria-pressed')).toBe('true');
}

/** Which navigation columns are currently folded into their sliver. */
function folded() {
  return {
    inbox: document.querySelector('.col-inbox-collapsed') !== null,
    projects: document.querySelector('.col-projects-collapsed') !== null,
  };
}

function tasksColumn(): HTMLElement {
  const el = document.querySelector<HTMLElement>('.col-tasks');
  if (!el) throw new Error('no .col-tasks in the document');
  return el;
}

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('sk-285.2.23 — the tree takes the workspace', () => {
  test.each(Object.keys(PERSISTED) as Array<keyof typeof PERSISTED>)(
    'the %s fixture can actually witness persistence',
    (col) => {
      // sk-285.7 T009 regression guard. Every "the persisted width came
      // back" assertion in this file compares against PERSISTED, and
      // such a comparison proves nothing about persistence while the
      // fixture equals the column's own default — the default falling
      // through would satisfy it too. T009 walked `projects` into
      // exactly that state by moving its default to 300, which is what
      // this check now makes impossible to do silently: move a default
      // onto a fixture again and the failure lands HERE, naming the
      // column, rather than turning five assertions vacuous in silence.
      const bounds = COL_BOUNDS[col];
      expect(PERSISTED[col], `${col}: fixture equals its own default`).not.toBe(bounds.default);
      expect(PERSISTED[col], `${col}: fixture below min, would be clamped`).toBeGreaterThanOrEqual(
        bounds.min,
      );
      expect(PERSISTED[col], `${col}: fixture above max, would be clamped`).toBeLessThanOrEqual(
        bounds.max,
      );
    },
  );

  test('Cards view renders the persisted widths untouched', () => {
    renderShell('cards');
    expect(folded()).toEqual({ inbox: false, projects: false });
    expect(widthOf('.col-inbox')).toBe(PERSISTED.inbox);
    expect(widthOf('.col-projects')).toBe(PERSISTED.projects);
    expect(widthOf('.col-tasks')).toBe(PERSISTED.tasks);
  });

  test('switching INTO the tree folds both navigation columns', () => {
    renderShell('cards');
    switchTo('tree');
    expect(folded()).toEqual({ inbox: true, projects: true });
    // …and the folded ones are gone as sized columns, not merely hidden:
    // their width is what the filling column is being given.
    expect(document.querySelector('.col-inbox')).toBeNull();
    expect(document.querySelector('.col-projects')).toBeNull();
  });

  test('the Tasks column stops carrying a width and flexes into the row', () => {
    renderShell('cards');
    expect(tasksColumn().classList.contains('col-tasks-fill')).toBe(false);
    switchTo('tree');

    const tasks = tasksColumn();
    expect(tasks.classList.contains('col-tasks-fill')).toBe(true);
    // No inline width at all — a leftover one would win over the flex basis
    // and pin the tree to the very number this change exists to escape.
    expect(tasks.style.width).toBe('');
    expect(tasks.style.flex).toBe('1 1 0%');
    // The floor a dragged column has is still the floor here, so a narrow
    // window pans the table instead of squeezing it into mush.
    expect(tasks.style.minWidth).toBe(`${COL_BOUNDS.tasks.min}px`);
  });

  test('the board enters by the SAME door — one mechanism, two views', () => {
    // The claim sk-285.2.23 rests on. If the two views ever grow separate
    // paths again, one of these two lines stops matching the other.
    renderShell('cards');
    switchTo('kanban');
    expect(folded()).toEqual({ inbox: true, projects: true });
    expect(tasksColumn().classList.contains('col-tasks-fill')).toBe(true);
  });

  test('board ↔ tree is not a transition: the columns hold still', () => {
    renderShell('cards');
    switchTo('kanban');
    // The user disagrees about Projects and re-opens it BY HAND while the
    // board is on screen — an opt-out the automation must respect from then
    // on, in either workspace view.
    fireEvent.click(document.querySelector<HTMLElement>('.col-projects-collapsed')!);
    expect(folded()).toEqual({ inbox: true, projects: false });

    switchTo('tree');
    // Nothing folded, nothing unfolded: Projects stays open because the user
    // said so, Queues stays folded because nobody touched it. A tree that
    // re-ran the fold would take Projects away again on a switch that is not
    // a transition at all.
    expect(folded()).toEqual({ inbox: true, projects: false });
    expect(widthOf('.col-projects')).toBe(PERSISTED.projects);
  });

  test('a RELOAD inside the tree folds nothing', () => {
    // The mount path is not the transition path: the columns come back
    // exactly as the user left them. Re-folding a column they had re-opened
    // by hand is the one behaviour this design exists to prevent.
    renderShell('tree');
    expect(folded()).toEqual({ inbox: false, projects: false });
    expect(widthOf('.col-inbox')).toBe(PERSISTED.inbox);
    expect(widthOf('.col-projects')).toBe(PERSISTED.projects);
  });

  test('leaving for Cards gives back exactly what the fold took', () => {
    renderShell('cards');
    switchTo('tree');
    expect(folded()).toEqual({ inbox: true, projects: true });

    switchTo('cards');
    expect(folded()).toEqual({ inbox: false, projects: false });
    expect(widthOf('.col-inbox')).toBe(PERSISTED.inbox);
    expect(widthOf('.col-projects')).toBe(PERSISTED.projects);
    expect(widthOf('.col-tasks')).toBe(PERSISTED.tasks);
    expect(tasksColumn().classList.contains('col-tasks-fill')).toBe(false);
  });

  test('folding never writes over the widths the user dragged', () => {
    renderShell('cards');
    switchTo('tree');
    expect(window.localStorage.getItem(WIDTH_KEY.inbox)).toBe(
      String(PERSISTED.inbox),
    );
    expect(window.localStorage.getItem(WIDTH_KEY.projects)).toBe(
      String(PERSISTED.projects),
    );
    expect(window.localStorage.getItem(WIDTH_KEY.tasks)).toBe(
      String(PERSISTED.tasks),
    );
  });

  test('the folded columns take their handles with them, and so does Tasks', () => {
    // A folded column has no width to drag, so no handle is RENDERED.
    // sk-551.4 — and with no issue open there is no reading pane beside
    // the tree, so no border between them to drag either: Tasks has no
    // handle at all. The two handles it does have (with an issue open)
    // are pinned in `WorkspaceSplit.test.tsx`, which can open one.
    // Cards: Queues, Projects, Tasks — one handle each. The workspace
    // handle is not rendered in Cards (sk-551.4; before it, both Tasks
    // handles were rendered always and a stylesheet hid one).
    renderShell('cards');
    expect(screen.getAllByRole('separator')).toHaveLength(3);

    switchTo('tree');
    expect(screen.queryAllByRole('separator')).toHaveLength(0);

    // …and back in Cards the Tasks handle reports the persisted width.
    switchTo('cards');
    const separators = screen.getAllByRole('separator');
    expect(separators).toHaveLength(3);
    expect(
      screen
        .getByRole('separator', { name: i18n.t('shell:resizeColumn', { col: 'tasks' }) })
        .getAttribute('aria-valuenow'),
    ).toBe(String(PERSISTED.tasks));
  });
});
