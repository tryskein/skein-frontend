/**
 * The boundary between the work area (tree, board) and the task panel.
 *
 * Reference — the maintainers' decisions:
 * - sk-551.14: "the handle's travel in 'Tree' and on 'Board' is the same as in
 *   'Cards'" — the boundary follows the cursor from the first pixel, in both
 *   directions; "the drag start is counted from the measured width, not from
 *   the saved one; the top does not exceed the available width";
 * - sk-551.29: "on a wide window the task card must not grow — the extra
 *   width goes to the board/tree. The card width is remembered, the view is
 *   the remainder". The panel is not narrower than its floor (420), the view not narrower than 280.
 *
 * jsdom does no layout: the column widths are substituted here through
 * `getBoundingClientRect` — that is how the handle sees them in a browser. The assertions are
 * about what is written to storage, what the handle declares (`separator`) and
 * which elements are on screen; the row layout is computed by the browser, and it is
 * checked by eye, not by `style` literals and classes (codex review,
 * the project guidelines).
 *
 * The harness is as in `DetailsSheetStability.test.tsx`: a task is open
 * (route `/projects/:alias/issues/:id`), its detail sits in the query
 * cache, the network hooks are replaced.
 */

import type { ComponentProps, ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { issueDetailKey } from '../../../lib/useIssueDetail';
import { uiPrefsKey } from '../../../lib/useUiPrefs';
import type { ViewMode } from '../../../api/issues';
import { DEFAULT_TEST_VIEWPORT_WIDTH, setViewportWidth } from '../../../test/viewport';
import type { IssueDetail } from '../../../api/issues';

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

function summary(id: string, title: string) {
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

const ALL = [summary('sk-1', 'One'), summary('sk-3', 'Three')];

vi.mock('../../../lib/useTasks', async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return {
    ...actual,
    useTasks: () => ({
      data: ALL,
      tree: null,
      total: ALL.length,
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
    }),
  };
});

vi.mock('../../../lib/useInbox', () => ({
  inboxQueryKey: ['inbox', 'assigned-to-me-unaccepted-open'] as const,
  useInbox: () => ({
    data: { items: [], hasMore: false, nextCursor: null },
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
import i18n from '../../../i18n/config';

const DETAIL: IssueDetail = {
  id: 'sk-3',
  projectId: 'p1',
  parentIdCurrent: null,
  version: 1,
  title: 'Three',
  description: 'body',
  type: 'task',
  priority: 3,
  status: 'open',
  pinned: false,
  source: 'human',
  assignee: null,
  design: '',
  acceptanceCriteria: '',
  notes: '',
  createdBy: 'u-1',
  createdByUsername: 'admin',
  createdAt: '2026-05-01T09:00:00Z',
  updatedAt: '2026-05-01T10:00:00Z',
  componentIds: [],
  labels: [],
  mentions: [],
  commentsCount: 0,
  attachmentsCount: 0,
  childrenCount: 0,
  unclosedChildrenCount: 0,
  isBlocked: false,
  blockers: [],
  commitRefs: [],
  metadata: {},
} as unknown as IssueDetail;

const VIEW_KEY = 'skein.tasks.view';
const DETAILS_KEY = 'skein.layout.col.workspace-details';
/** sk-551.30 — the tablet layout has its own width (R10). */
const TABLET_DETAILS_KEY = 'skein.layout.col.workspace-details-tablet';
/** sk-551.14 — the VIEW width; sk-551.29 erases it without carrying it over. */
const LEGACY_VIEW_KEY = 'skein.layout.col.workspace';
const LEGACY_MAX_KEY = 'skein.layout.col.workspaceMax';

/** A router entry: a path, or a location with a query and navigation state. */
type InitialEntry = NonNullable<ComponentProps<typeof MemoryRouter>['initialEntries']>[number];

const ISSUE_PATH = '/projects/alpha/issues/sk-3';
const PROJECT_PATH = '/projects/alpha';

function Wrapper({
  path,
  modalViews,
  client,
  children,
}: {
  path: InitialEntry;
  /** sk-551.5 — what the server holds for the pop-up window setting. */
  modalViews?: ViewMode[];
  /** sk-551.5 — a client the test drives itself; the detail is then NOT
   *  pre-seeded, so the test decides when the issue «arrives». */
  client?: QueryClient;
  children: ReactNode;
}) {
  const qc =
    client ??
    new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } },
    });
  if (client === undefined) qc.setQueryData(issueDetailKey('sk-3'), DETAIL);
  if (modalViews !== undefined) {
    qc.setQueryData(uiPrefsKey('u-1'), { issueModalViews: modalViews });
  }
  return (
    <MantineProvider forceColorScheme="dark">
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/projects/:alias" element={children} />
            <Route path="/projects/:alias/issues/:id" element={children} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>
  );
}

function renderShell(
  view: 'cards' | 'tree' | 'kanban',
  path: InitialEntry = ISSUE_PATH,
  modalViews?: ViewMode[],
  client?: QueryClient,
) {
  window.localStorage.setItem(VIEW_KEY, view);
  render(
    <Wrapper path={path} modalViews={modalViews} client={client}>
      <Shell />
    </Wrapper>,
  );
}

/** A resize handle, found by its role and accessible name. */
function separator(col: 'tasks' | 'workspace'): HTMLElement | null {
  return screen.queryByRole('separator', { name: i18n.t('shell:resizeColumn', { col }) });
}

function workspaceHandle(): HTMLElement {
  const el = document.querySelector<HTMLElement>('.resize-handle--workspace');
  if (!el) throw new Error('no workspace handle in the document');
  return el;
}

/**
 * jsdom 25 has no `PointerEvent`. The handle reads only `clientX` and
 * `button`, both of which `MouseEvent` carries, so a MouseEvent under the
 * pointer name is the browser's event as far as the handle can tell.
 */
class TestPointerEvent extends MouseEvent {}
const hadPointerEvent = 'PointerEvent' in window;
beforeAll(() => {
  if (!hadPointerEvent) {
    (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = TestPointerEvent;
  }
});
afterAll(() => {
  if (!hadPointerEvent) delete (window as unknown as { PointerEvent?: unknown }).PointerEvent;
});

/** Widths the browser would report for the view and the reading pane. */
function layoutWidths(view: number, details: number) {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: Element,
  ) {
    const width = this.classList.contains('col-tasks')
      ? view
      : this.classList.contains('col-details')
        ? details
        : 0;
    return {
      width,
      height: 0,
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: width,
      bottom: 0,
      toJSON: () => ({}),
    } as DOMRect;
  });
}

/**
 * One drag of a handle (the workspace one unless named): press at `from`, move to `to`,
 * release. Animation frames are held and flushed by hand, so the commit
 * the handle coalesces into a frame lands inside `act`.
 */
function drag(from: number, to: number, handle: () => HTMLElement = workspaceHandle) {
  const frames: FrameRequestCallback[] = [];
  const raf = vi
    .spyOn(window, 'requestAnimationFrame')
    .mockImplementation((cb) => frames.push(cb));
  const caf = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  fireEvent.pointerDown(handle(), { clientX: from, button: 0 });
  act(() => {
    window.dispatchEvent(new TestPointerEvent('pointermove', { clientX: to }));
  });
  act(() => {
    frames.splice(0).forEach((cb) => cb(0));
  });
  act(() => {
    window.dispatchEvent(new TestPointerEvent('pointerup', { clientX: to }));
  });
  raf.mockRestore();
  caf.mockRestore();
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
  setViewportWidth(DEFAULT_TEST_VIEWPORT_WIDTH);
  document.documentElement.removeAttribute('data-width-mode');
});

describe('sk-551.29 — the handle moves the task panel width, travel as in "Cards"', () => {
  test('until dragged — no width is written', () => {
    renderShell('tree');
    expect(window.localStorage.getItem(DETAILS_KEY)).toBeNull();
  });

  test('the drag starts from the MEASURED panel width, not from the saved one', () => {
    // 900 is saved (another window), but the panel on screen is 500. Cursor to the right
    // by 10 px — the boundary is 10 px to the right of what is VISIBLE: the panel is 490, and
    // not 890 and not "nothing until the cursor passes 400".
    window.localStorage.setItem(DETAILS_KEY, '900');
    renderShell('tree');
    layoutWidths(600, 500);

    drag(1000, 1010);

    expect(window.localStorage.getItem(DETAILS_KEY)).toBe('490');
  });

  test('drag in both directions: to the left the boundary also moves from the first pixel', () => {
    renderShell('tree');
    layoutWidths(600, 500);
    drag(1000, 990);
    expect(window.localStorage.getItem(DETAILS_KEY)).toBe('510');
  });

  test.each(['tree', 'kanban'] as const)(
    '%s: the top — the panel plus all the view can give beyond its floor of 280',
    (view) => {
      // Panel 500 + view 600: the view gives 320. A cursor at −1000 gives 820, and
      // no more — the remainder would be a dead zone on the way back.
      renderShell(view);
      layoutWidths(600, 500);
      drag(1000, 0);
      expect(window.localStorage.getItem(DETAILS_KEY)).toBe('820');
    },
  );

  test('the bottom — the panel floor of 420', () => {
    renderShell('kanban');
    layoutWidths(600, 500);
    drag(1000, 2000);
    expect(window.localStorage.getItem(DETAILS_KEY)).toBe('420');
  });

  test('keyboard: an arrow moves the boundary its way, Home/End — to the panel limits', () => {
    renderShell('tree');
    fireEvent.keyDown(workspaceHandle(), { key: 'Home' });
    expect(window.localStorage.getItem(DETAILS_KEY)).toBe('420');

    layoutWidths(600, 500);
    // Boundary to the left — the panel is wider.
    fireEvent.keyDown(workspaceHandle(), { key: 'ArrowLeft' });
    expect(window.localStorage.getItem(DETAILS_KEY)).toBe('516');
    // Boundary to the right — the panel is narrower (the measurement is still 500).
    fireEvent.keyDown(workspaceHandle(), { key: 'ArrowRight' });
    expect(window.localStorage.getItem(DETAILS_KEY)).toBe('484');
    fireEvent.keyDown(workspaceHandle(), { key: 'End' });
    expect(window.localStorage.getItem(DETAILS_KEY)).toBe('820');
  });

  test('the screen reader hears the same travel the keys make, not the saved number', () => {
    // 900 is saved, but the window is narrower: the view is squeezed to its floor of 280, the panel
    // to 500. The handle travel is 420…500 from 500; announcing "900 of 3840"
    // would promise a travel that does not exist.
    window.localStorage.setItem(DETAILS_KEY, '900');
    renderShell('tree');
    layoutWidths(280, 500);
    const handle = workspaceHandle();
    fireEvent.focus(handle);
    expect(handle.getAttribute('aria-valuenow')).toBe('500');
    expect(handle.getAttribute('aria-valuemin')).toBe('420');
    expect(handle.getAttribute('aria-valuemax')).toBe('500');

    fireEvent.keyDown(handle, { key: 'End' });
    expect(window.localStorage.getItem(DETAILS_KEY)).toBe('500');

    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(window.localStorage.getItem(DETAILS_KEY)).toBe('484');
  });

  test('the window got wider: the remembered panel width and what the screen reader hears do not change', () => {
    // Acceptance of sk-551.29: "widening the window with an open task enlarges
    // the board/tree, the task panel keeps its width". The layout itself is the
    // browser's; here — that the PANEL width is remembered and that after the view
    // grows the handle announces the same panel, and the travel to the right became wider.
    renderShell('kanban');
    layoutWidths(600, 500);
    drag(1000, 1010);
    expect(window.localStorage.getItem(DETAILS_KEY)).toBe('490');

    vi.restoreAllMocks();
    layoutWidths(1400, 490);
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });

    const handle = workspaceHandle();
    expect(handle.getAttribute('aria-valuenow')).toBe('490');
    expect(handle.getAttribute('aria-valuemax')).toBe(String(490 + 1400 - 280));
    expect(window.localStorage.getItem(DETAILS_KEY)).toBe('490');
  });

  test.each(['pointerup', 'pointercancel', 'blur'] as const)(
    'the last move before %s is not lost, even if the frame did not make it',
    (end) => {
      // grok review (ts): the width was written only from the animation frame, and the end of
      // the drag cancelled the frame without writing it. The frame is not run here and
      // `cancelAnimationFrame` is real — as in a hidden tab, where
      // frames stand still.
      renderShell('kanban');
      layoutWidths(600, 500);
      const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
      fireEvent.pointerDown(workspaceHandle(), { clientX: 1000, button: 0 });
      act(() => {
        window.dispatchEvent(new TestPointerEvent('pointermove', { clientX: 1030 }));
      });
      act(() => {
        if (end === 'blur') window.dispatchEvent(new Event('blur'));
        else window.dispatchEvent(new TestPointerEvent(end, { clientX: 1030 }));
      });
      raf.mockRestore();
      expect(window.localStorage.getItem(DETAILS_KEY)).toBe('470');
    },
  );

  test('double click and Delete do nothing — as in "Cards"', () => {
    window.localStorage.setItem(DETAILS_KEY, '560');
    renderShell('tree');
    fireEvent.doubleClick(workspaceHandle());
    fireEvent.keyDown(workspaceHandle(), { key: 'Delete' });
    expect(window.localStorage.getItem(DETAILS_KEY)).toBe('560');
  });

  test('one width for the tree and the board, and "Cards" does not read it', () => {
    window.localStorage.setItem('skein.layout.col.tasks', '460');
    // Dragged on the board…
    renderShell('kanban');
    layoutWidths(600, 500);
    drag(1000, 990);
    expect(window.localStorage.getItem(DETAILS_KEY)).toBe('510');
    cleanup();
    vi.restoreAllMocks();

    // …the tree starts from the same one: without a measurement (jsdom) the handle announces
    // the saved width.
    renderShell('tree');
    expect(separator('workspace')?.getAttribute('aria-valuenow')).toBe('510');
    cleanup();

    // "Cards" — its own width, the work area did not touch it.
    renderShell('cards');
    expect(separator('tasks')?.getAttribute('aria-valuenow')).toBe('460');
    expect(window.localStorage.getItem('skein.layout.col.tasks')).toBe('460');
  });

  test('the sk-551.14 view width and the sk-514 ceiling are erased and not carried over to the panel width', () => {
    window.localStorage.setItem(LEGACY_VIEW_KEY, '900');
    window.localStorage.setItem(LEGACY_MAX_KEY, '1200');
    renderShell('tree');
    expect(window.localStorage.getItem(LEGACY_VIEW_KEY)).toBeNull();
    expect(window.localStorage.getItem(LEGACY_MAX_KEY)).toBeNull();
    expect(window.localStorage.getItem(DETAILS_KEY)).toBeNull();
  });
});

/**
 * sk-551.30 — a narrow window (tablet layout). Reference — the maintainers'
 * decision: "on a small window the divider between the board/tree and
 * the task card must exist too and be draggable". R10 (the tablet neither reads
 * nor writes the desktop widths) stays in force: the tablet has its own panel
 * width. The mobile layout (a sheet from below) does not change — no handle.
 */
describe('sk-551.30 — the divider between the view and the panel in the tablet layout', () => {
  test.each(['tree', 'kanban'] as const)(
    '%s: the divider exists and drags from the first pixel, writes the tablet width',
    (view) => {
      setViewportWidth(1024);
      window.localStorage.setItem(DETAILS_KEY, '600');
      renderShell(view);
      expect(separator('workspace')).not.toBeNull();

      layoutWidths(500, 400);
      drag(700, 690);

      expect(window.localStorage.getItem(TABLET_DETAILS_KEY)).toBe('410');
      // The desktop width is untouched.
      expect(window.localStorage.getItem(DETAILS_KEY)).toBe('600');
    },
  );

  test('the desktop width is not read in the tablet, the tablet one is read', () => {
    // Without a measurement (jsdom) the handle announces the remembered width of its own
    // layout; the desktop 600 must not surface in either.
    window.localStorage.setItem(DETAILS_KEY, '600');
    setViewportWidth(1024);
    renderShell('kanban');
    const handle = separator('workspace');
    expect(handle).not.toBeNull();
    expect(handle?.getAttribute('aria-valuenow')).not.toBe('600');
    cleanup();

    window.localStorage.setItem(TABLET_DETAILS_KEY, '480');
    renderShell('kanban');
    expect(separator('workspace')?.getAttribute('aria-valuenow')).toBe('480');
    cleanup();

    // …and on a wide window the desktop one again.
    setViewportWidth(DEFAULT_TEST_VIEWPORT_WIDTH);
    renderShell('kanban');
    expect(separator('workspace')?.getAttribute('aria-valuenow')).toBe('600');
  });

  test('on a phone there is no divider — the panel there is a full-screen sheet', () => {
    setViewportWidth(390);
    renderShell('kanban');
    expect(separator('workspace')).toBeNull();
  });
});

/**
 * sk-551.4 — beside the board and the tree an EMPTY reading pane is not
 * drawn. Reference — acceptance of sk-551.4: without a selected task there is no details column,
 * the view takes the whole row, there is no "Select a task…" text; selecting
 * opens the panel, the cross removes it; "Cards" unchanged; no
 * dangling handle at the right edge.
 */
describe('sk-551.4 — no empty reading pane beside a workspace view', () => {
  test.each(['tree', 'kanban'] as const)(
    '%s, nothing open: no pane, no «select a task» text, no handle',
    (view) => {
      // Whether the view then really spans the row is geometry — the
      // manual browser pass, not jsdom.
      window.localStorage.setItem(DETAILS_KEY, '560');
      renderShell(view, PROJECT_PATH);
      expect(document.querySelector('.col-details')).toBeNull();
      expect(screen.queryByText(i18n.t('details:empty'))).toBeNull();
      expect(separator('workspace')).toBeNull();
      expect(separator('tasks')).toBeNull();
      // The saved width is kept for the next open issue, not erased.
      expect(window.localStorage.getItem(DETAILS_KEY)).toBe('560');
    },
  );

  test.each(['tree', 'kanban'] as const)(
    '%s, an issue open: the pane is there with ONE handle — the workspace one',
    (view) => {
      renderShell(view);
      expect(document.querySelector('.col-details')).not.toBeNull();
      expect(separator('workspace')).not.toBeNull();
      expect(separator('tasks')).toBeNull();
    },
  );

  test('the × in the pane header takes the pane and its handle away', () => {
    renderShell('kanban');
    expect(document.querySelector('.col-details')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: i18n.t('details:header.closeAria') }));

    expect(document.querySelector('.col-details')).toBeNull();
    expect(separator('workspace')).toBeNull();
  });

  test('Esc with focus on the workspace handle: focus goes to the open card, not to body', () => {
    // sk-551.4 review (grok html-css): the handle is a tab stop and leaves together with
    // the panel; without a transfer focus fell into <body>.
    renderShell('kanban');
    const handle = workspaceHandle();
    handle.focus();
    expect(document.activeElement).toBe(handle);

    fireEvent.keyDown(handle, { key: 'Escape' });

    expect(document.querySelector('.col-details')).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: /Open issue sk-3/ }),
    );
  });

  test('Esc with focus inside the pane: focus goes to the open card', () => {
    renderShell('kanban');
    const close = screen.getByRole('button', { name: i18n.t('details:header.closeAria') });
    close.focus();
    fireEvent.keyDown(close, { key: 'Escape' });

    expect(document.querySelector('.col-details')).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: /Open issue sk-3/ }),
    );
  });

  test('the open issue is not on the board: focus goes to the Tasks column header', () => {
    renderShell('kanban', '/projects/alpha/issues/sk-9');
    const handle = workspaceHandle();
    handle.focus();
    fireEvent.keyDown(handle, { key: 'Escape' });

    expect(document.querySelector('.col-details')).toBeNull();
    const active = document.activeElement;
    expect(active).not.toBe(document.body);
    expect(active?.classList.contains('col-tasks-header')).toBe(true);
  });

  test('Cards view is unchanged: the empty pane stays, with the Tasks width handle', () => {
    renderShell('cards', PROJECT_PATH);
    expect(screen.getByText(i18n.t('details:empty'))).toBeTruthy();
    expect(separator('tasks')).not.toBeNull();
    expect(separator('workspace')).toBeNull();
  });
});

/**
 * sk-551.43 — "Cards": the handle moves the width of the TASKS COLUMN, the panel is
 * the remainder. Reference — acceptance of sk-551.43: the handle can be dragged until the card
 * of the task becomes 420 px, as in the tree and on the kanban; the handle from the first
 * pixel, ARIA from the live measurement; the top of the drag = column + panel − 420.
 */
describe('sk-551.43 — "Cards": the task card can be narrowed to 420', () => {
  const TASKS_KEY = 'skein.layout.col.tasks';
  const tasksHandle = () => {
    const el = separator('tasks');
    if (!el) throw new Error('no tasks handle in the document');
    return el;
  };

  test('a drag to the right stops at column + panel − 420, not at 600', () => {
    // 1440, navigation folded: column 468, panel 878.
    renderShell('cards');
    layoutWidths(468, 878);
    drag(1000, 3000, tasksHandle);
    expect(window.localStorage.getItem(TASKS_KEY)).toBe(String(468 + 878 - 420));
  });

  test('from the first pixel: the start is from the measured column, not from the saved one', () => {
    window.localStorage.setItem(TASKS_KEY, '900');
    renderShell('cards');
    layoutWidths(600, 600);
    drag(1000, 1010, tasksHandle);
    expect(window.localStorage.getItem(TASKS_KEY)).toBe('610');
  });

  test('ARIA and End — from the live measurement', () => {
    renderShell('cards');
    layoutWidths(468, 878);
    const handle = tasksHandle();
    fireEvent.focus(handle);
    expect(handle.getAttribute('aria-valuenow')).toBe('468');
    expect(handle.getAttribute('aria-valuemax')).toBe('926');
    fireEvent.keyDown(handle, { key: 'End' });
    expect(window.localStorage.getItem(TASKS_KEY)).toBe('926');
  });

  test('the window is narrower than the saved value: the panel is at the floor 420 — travel to the right is closed, not narrower than 420', () => {
    // 900 is saved on a wide window; on a narrow one the row squeezed the column to 600, and
    // the panel holds 420. The handle travel is only to where the panel grows.
    window.localStorage.setItem(TASKS_KEY, '900');
    renderShell('cards');
    layoutWidths(600, 420);
    const handle = tasksHandle();
    fireEvent.focus(handle);
    expect(handle.getAttribute('aria-valuenow')).toBe('600');
    expect(handle.getAttribute('aria-valuemax')).toBe('600');

    drag(1000, 1200, tasksHandle);
    expect(window.localStorage.getItem(TASKS_KEY)).toBe('600');
    drag(1000, 990, tasksHandle);
    expect(window.localStorage.getItem(TASKS_KEY)).toBe('590');
  });
});

/**
 * sk-551.5 — the open issue in a pop-up window, per view.
 *
 * Reference — the maintainers' decision (sk-551.5, 2026-10-05):
 * - a view with the tick: there is no panel on the right (and in "Cards" an empty "select a
 *   task" is not reserved), the task is a modal window in the centre; the dialog
 *   name is the task title;
 * - a view without the tick — all as now;
 * - closing — the cross and Esc, Esc is two-step (first the attachment,
 *   then the task); a click outside does NOT close the window;
 * - after closing the focus goes to the `[data-issue-id]` card of the closed task;
 * - switching the view with a task open — the task is shown as
 *   configured for the new view;
 * - desktop and tablet; the phone is a sheet, it does not read the setting.
 */
describe('sk-551.5 — the issue in a pop-up window over the view', () => {
  const ALL_VIEWS: ViewMode[] = ['cards', 'kanban', 'tree'];
  const issueDialog = () => screen.queryByRole('dialog', { name: 'Three' });
  const closeButton = () =>
    screen.getByRole('button', { name: i18n.t('details:header.closeAria') });

  test.each(ALL_VIEWS)('%s with its box ticked: a dialog named by the title, no pane in the row', (view) => {
    renderShell(view, ISSUE_PATH, [view]);

    const dialog = issueDialog();
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(dialog?.querySelector('.col-details')).not.toBeNull();
    expect(document.querySelector('.details-frame')).toBeNull();
    expect(separator('workspace')).toBeNull();
    expect(separator('tasks')).toBeNull();
  });

  test.each(ALL_VIEWS)('%s without its box: the pane beside the view, no dialog', (view) => {
    renderShell(view, ISSUE_PATH, ALL_VIEWS.filter((v) => v !== view));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('.details-frame .col-details')).not.toBeNull();
  });

  test('Cards with its box ticked and nothing open: no empty «select a task» pane, no width handle', () => {
    window.localStorage.setItem('skein.layout.col.tasks', '420');
    renderShell('cards', PROJECT_PATH, ['cards']);

    expect(screen.queryByText(i18n.t('details:empty'))).toBeNull();
    expect(document.querySelector('.col-details')).toBeNull();
    expect(separator('tasks')).toBeNull();
    // The Cards width is not touched: turning the window off brings it back.
    expect(window.localStorage.getItem('skein.layout.col.tasks')).toBe('420');
  });

  test('the dialog is named by the title once the issue arrives, by its id until then', () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } },
    });
    // The detail read never answers on its own here: the test hands it in.
    client.setQueryDefaults(issueDetailKey('sk-3'), { queryFn: () => new Promise(() => {}) });
    renderShell('kanban', ISSUE_PATH, ['kanban'], client);

    expect(screen.getByRole('dialog', { name: 'sk-3' })).toBeTruthy();

    act(() => {
      client.setQueryData(issueDetailKey('sk-3'), DETAIL);
    });

    expect(issueDialog()).not.toBeNull();
  });

  test('a shared-file link keeps its split layout, not the window', () => {
    renderShell('kanban', { pathname: ISSUE_PATH, search: '?file=att-1' }, ['kanban']);

    expect(issueDialog()).toBeNull();
    expect(document.querySelector('.details-frame .col-details')).not.toBeNull();
  });

  test('the window takes focus itself, and Shift+Tab from there stays inside it', () => {
    renderShell('kanban', ISSUE_PATH, ['kanban']);
    const dialog = issueDialog()!;
    expect(document.activeElement).toBe(dialog);
    // Focusable by script, not a Tab stop of its own.
    expect(dialog.tabIndex).toBe(-1);

    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });

    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(dialog);
    // …and Tab from that last stop wraps to the first, still inside.
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  test('the columns under the window are inert while it is open, and only then', () => {
    renderShell('kanban', ISSUE_PATH, ['kanban']);
    const columns = () =>
      ['.col-inbox', '.col-projects', '.col-tasks'].map((sel) => document.querySelector(sel)!);
    for (const col of columns()) expect(col.hasAttribute('inert')).toBe(true);
    expect(issueDialog()!.hasAttribute('inert')).toBe(false);
    // The backdrop stays live too: it is what swallows the stray click.
    expect(document.querySelector('.details-modal-backdrop')?.hasAttribute('inert')).toBe(false);
    // The header is not part of it — it stays usable above the window.
    const header = document.querySelector('header');
    expect(header).not.toBeNull();
    expect(header!.closest('[inert]')).toBeNull();

    fireEvent.click(closeButton());

    for (const col of columns()) expect(col.hasAttribute('inert')).toBe(false);
  });

  test('tablet: the window too', () => {
    setViewportWidth(1024);
    renderShell('kanban', ISSUE_PATH, ['kanban']);
    expect(issueDialog()).not.toBeNull();
  });

  test('phone: the sheet whatever the setting says', () => {
    setViewportWidth(390);
    renderShell('kanban', ISSUE_PATH, ALL_VIEWS);

    expect(issueDialog()).toBeNull();
    expect(screen.getByRole('dialog', { name: i18n.t('details:sheet.title') })).toBeTruthy();
  });

  test('the × closes the window', () => {
    renderShell('kanban', ISSUE_PATH, ['kanban']);
    fireEvent.click(closeButton());
    expect(issueDialog()).toBeNull();
  });

  test('a click on the dimmed view does NOT close the window', () => {
    renderShell('kanban', ISSUE_PATH, ['kanban']);
    const backdrop = document.querySelector<HTMLElement>('.details-modal-backdrop');
    expect(backdrop).not.toBeNull();

    fireEvent.mouseDown(backdrop!);
    fireEvent.click(backdrop!);

    expect(issueDialog()).not.toBeNull();
  });

  test('Esc is two-stage: the open attachment first, the issue second', () => {
    renderShell(
      'kanban',
      { pathname: ISSUE_PATH, search: '?file=att-1', state: { selfOpenedFile: true } },
      ['kanban'],
    );
    const dialog = issueDialog();
    expect(dialog).not.toBeNull();
    expect(dialog?.querySelector('.col-details-viewer')).not.toBeNull();

    fireEvent.keyDown(dialog!, { key: 'Escape' });

    // The attachment is gone, the issue is still in its window.
    expect(issueDialog()).not.toBeNull();
    expect(document.querySelector('.col-details-viewer')).toBeNull();

    fireEvent.keyDown(issueDialog()!, { key: 'Escape' });

    expect(issueDialog()).toBeNull();
  });

  test.each(ALL_VIEWS)('%s: after the × focus is on the closed issue\'s [data-issue-id]', (view) => {
    renderShell(view, ISSUE_PATH, [view]);
    const close = closeButton();
    close.focus();
    expect(document.activeElement).toBe(close);

    fireEvent.click(close);

    expect(issueDialog()).toBeNull();
    expect((document.activeElement as HTMLElement | null)?.dataset.issueId).toBe('sk-3');
  });

  test('switching Cards (no box) → Board (box) with the issue open: the window appears, the panel is kept', () => {
    renderShell('cards', ISSUE_PATH, ['kanban']);
    expect(screen.queryByRole('dialog')).toBeNull();
    const panel = document.querySelector('.issue-detail-panel');
    expect(panel).not.toBeNull();

    fireEvent.click(
      screen.getByRole('button', {
        name: `${i18n.t('filters:labels.view')}: ${i18n.t('filters:view.kanban')}`,
      }),
    );

    expect(issueDialog()).not.toBeNull();
    // The same panel instance — an unsent draft survives the switch (sk-366).
    expect(document.querySelector('.issue-detail-panel')).toBe(panel);
  });
});

/**
 * sk-551.8 D1 (manual acceptance of Stage 7) — Esc with the avatar menu open
 * closes both the menu and the open task, including when the focus is on
 * the "Left panel" radio button (where it stays after a layout switch).
 * Reference — the description of defect D1: "expectation — as without the preceding
 * switch: both the menu and the task close". A text field keeps
 * Esc for itself (comment at the handler in `DetailsColumn`), the task
 * is not closed in that case.
 */
describe('sk-551.8 D1 — Esc from the account menu closes the open task', () => {
  const accountButton = () => screen.getByRole('button', { name: 'Account menu — admin' });
  const taskOpen = () => screen.queryByText(i18n.t('details:empty')) === null;

  test('focus on the «Left panel» radio: the menu and the task both close', () => {
    // The person's profile is in (the radios are disabled until it is).
    renderShell('cards', ISSUE_PATH, []);
    expect(taskOpen()).toBe(true);
    fireEvent.click(accountButton());
    const radio = screen.getByRole('radio', { name: i18n.t('header:navLayout.columns') });
    radio.focus();
    expect(document.activeElement).toBe(radio);

    fireEvent.keyDown(radio, { key: 'Escape' });

    expect(accountButton().getAttribute('aria-expanded')).toBe('false');
    expect(taskOpen()).toBe(false);
  });

  test('Esc typed in a text field leaves the task open', () => {
    renderShell('cards');
    const search = screen.getByRole('textbox', { name: /Search tasks/ });
    search.focus();

    fireEvent.keyDown(search, { key: 'Escape' });

    expect(taskOpen()).toBe(true);
  });
});
