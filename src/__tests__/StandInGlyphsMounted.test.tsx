/**
 * sk-285.7.2.88 — controls that used to type a stand-in character now
 * draw an icon.
 *
 * Each surface is MOUNTED and asked two things of the same tree:
 *
 *   • the control contains a drawn `<svg>`;
 *   • the control carries none of the characters it used to type, so an
 *     icon added beside a glyph that stayed (`✓ ✓ Accept`) fails here.
 *
 * Every surface needs module-level `vi.mock` calls (auth, the settings
 * header, API clients, query hooks), which is why they live together in
 * this file.
 *
 * Each mount opens with a tripwire on the node it is about to read: a
 * `querySelector` that returns null would make every assertion after it
 * vacuously true.
 *
 * Icon size and stroke are not checked (sk-540.11, owner decision):
 * what a person sees is not asserted from markup.
 */

import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type { Reminder } from '../api/reminders';
import type { IssueDetail } from '../api/issues';
import type { User, UserListResult } from '../api/users';
import type { Attachment, AttachmentList } from '../api/attachments';

/* ══════════════════════════════════════════════════════════════════
 * Mocks — the network edge only. Every component under test is the
 * real one; what is stubbed is what it would otherwise fetch.
 * ══════════════════════════════════════════════════════════════════ */

vi.mock('../auth/AuthContext', () => ({
  // sk-551.8 — LayoutProvider reads the layout via useNavLayoutOptional;
  // null = no session known, the side-by-side layout.
  useAuthOptional: () => null,
  useAuth: () => ({
    user: { id: 'u-1', username: 'admin', role: 'admin' },
    login: vi.fn(),
    logout: vi.fn(),
    isLoading: false,
  }),
}));

/* The settings header is a whole second shell (badges, lenses, project
 * menu) and draws none of the marks this file is about. */
vi.mock('../pages/shell/HeaderBar', () => ({ HeaderBar: () => null }));

vi.mock('../lib/useAuthConfig', () => ({
  useAuthConfig: () => ({
    data: { authMode: 'local' },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

const { mockListUsers, mockListApiKeys, mockListIssues, mockListAttachments } =
  vi.hoisted(() => ({
    mockListUsers: vi.fn(),
    mockListApiKeys: vi.fn(),
    mockListIssues: vi.fn(),
    mockListAttachments: vi.fn(),
  }));

vi.mock('../api/users', () => ({
  listUsers: mockListUsers,
  createUser: vi.fn(),
  updateUser: vi.fn(),
  deactivateUser: vi.fn(),
  reactivateUser: vi.fn(),
  listUserDirectory: async () => ({ items: [], hasMore: false }),
}));

vi.mock('../api/api-keys', () => ({
  listApiKeys: mockListApiKeys,
  createApiKey: vi.fn(),
  revokeApiKey: vi.fn(),
}));

vi.mock('../api/issues', async (importActual) => {
  const actual = await importActual<typeof import('../api/issues')>();
  return { ...actual, listIssues: mockListIssues, createIssue: vi.fn() };
});

vi.mock('../api/attachments', async (importActual) => {
  const actual = await importActual<typeof import('../api/attachments')>();
  return {
    ...actual,
    listAttachments: mockListAttachments,
    getDownloadURL: vi.fn(async () => ({ url: 'blob:none', expiresAt: '' })),
  };
});

/**
 * The file viewer's ERROR branch lives in `DetailsColumn`, and the only
 * way into it is for the lazily-imported viewer to THROW — which is
 * what the boundary was written for (a bad deploy, a Shiki throw on a
 * pathological input). So the module is wrapped rather than replaced:
 * disarmed it is the real component (that is what the success-branch
 * test below mounts), armed it throws on render.
 */
const { viewerBomb } = vi.hoisted(() => ({ viewerBomb: { armed: false } }));

vi.mock('../pages/shell/details/FileViewerPanel', async (importActual) => {
  const actual =
    await importActual<typeof import('../pages/shell/details/FileViewerPanel')>();
  const Real = actual.FileViewerPanel;
  return {
    ...actual,
    FileViewerPanel: (props: Parameters<typeof Real>[0]) => {
      if (viewerBomb.armed) throw new Error('viewer chunk failed to load');
      return <Real {...props} />;
    },
  };
});

/* Shiki is a wasm highlighter behind a dynamic import; the file viewer
 * HEADER — the two controls this file reads — renders before any of it
 * resolves, and pulling the engine in would buy nothing but seconds. */
vi.mock('../lib/shiki', () => ({
  SHIKI_LIGHT_THEME: 'github-light',
  SHIKI_DARK_THEME: 'github-dark',
  getHighlighter: async () => ({
    codeToHtml: () => '<pre></pre>',
  }),
  getMarkdownItShikiPlugin: async () => [() => {}, {}],
  __resetShikiForTests: () => {},
}));

const { mockReminders } = vi.hoisted(() => ({ mockReminders: { list: [] as Reminder[] } }));

vi.mock('../lib/useReminders', () => ({
  remindersListKey: ['reminders', 'list', 'all'],
  useRemindersQuery: () => ({ data: undefined, isLoading: false, error: null }),
  useRemindersList: () => ({
    reminders: mockReminders.list,
    ringingTaskCount: mockReminders.list.filter((r) => r.state === 'ringing').length,
    isLoading: false,
    error: null,
  }),
  useRingingTaskCount: () => 0,
  useRingingIssueIds: () => new Set<string>(),
  useIssueReminders: () => [],
  useCreateReminder: () => ({ mutate: vi.fn(), isPending: false }),
  useSnoozeReminder: () => ({ mutate: vi.fn(), isPending: false }),
  useDismissReminder: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('../lib/useTasks', async (importActual) => {
  const actual = await importActual<typeof import('../lib/useTasks')>();
  return {
    ...actual,
    useTasks: () => ({
      data: [],
      total: 0,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: () => {},
      isLoading: false,
      error: null,
      emptyReason: 'none',
      searchDegraded: false,
      searchMode: false,
      totalIsExact: true,
      resolvedProjectId: 'proj-uuid-1',
      delegateeAssignees: [],
      cacheKey: ['tasks', 'stand-in-glyphs'],
    }),
  };
});

vi.mock('../lib/useProjectByHandle', () => ({
  useProjectByHandle: () => ({ project: null, isLoading: false, isError: false }),
}));

vi.mock('../api/components', () => ({ listComponents: async () => [] }));
vi.mock('../api/projects', () => ({ listMembers: async () => [] }));

/* The anchored subtree is served by the layered-tree endpoint. Mocking
 * the hook — rather than the fetch under it — is what makes BOTH of the
 * anchored body's ways back reachable: one is the FAILED query, the
 * other the query that resolved to nothing. */
const { mockLayered } = vi.hoisted(() => ({
  mockLayered: {
    state: {
      tree: [] as unknown[],
      isLoading: false,
      error: null as unknown,
      tooLarge: false,
      // sk-421.2 T017 — the moment the shown answer was requested.
      requestedAt: null as number | null,
    },
  },
}));

vi.mock('../lib/useLayeredTree', async (importActual) => {
  const actual = await importActual<typeof import('../lib/useLayeredTree')>();
  return { ...actual, useLayeredTree: () => mockLayered.state };
});

vi.mock('../lib/useProjectsList', () => ({
  projectsListQueryKey: ['projects', 'list', 'shell'],
  useProjectsList: () => ({ data: { items: [] }, isLoading: false, isError: false }),
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

/* Imported AFTER the mocks so the mocked modules are the ones wired in. */
import { KanbanBoard } from '../pages/shell/KanbanBoard';
import { BudilnikLensBody } from '../pages/shell/BudilnikLensBody';
import { EpicProgressSection } from '../pages/shell/details/sections/EpicProgressSection';
import { NewApiKeysPage } from '../pages/settings/new/ApiKeysPage';
import { NewUsersPage } from '../pages/settings/new/UsersPage';
import { FileViewerPanel } from '../pages/shell/details/FileViewerPanel';
import { DetailsColumn } from '../pages/shell/DetailsColumn';
import { TasksColumn } from '../pages/shell/TasksColumn';
import { LayoutProvider } from '../lib/useLayoutState';
import { TasksUiStateProvider, useTasksUiState } from '../lib/useTasksUiState';
import type { StatusFilter } from '../api/issues';

/* ══════════════════════════════════════════════════════════════════
 * The two assertions
 * ══════════════════════════════════════════════════════════════════ */

/**
 * The characters these surfaces used to type instead of drawing an icon.
 * Each one is named at the test that reads its surface.
 */
const STAND_INS = /[\u2190\u2193\u00D7\u2715\u2713\u23F0\u2934\u29BE\u29BF]|\u{1F512}|\u{1F514}/gu;

/** The control draws an icon: an `<svg>` is mounted inside it. */
function assertDrawn(node: Element, what: string): void {
  expect(node.querySelectorAll('svg').length, `nothing drawn inside ${what}`).toBeGreaterThan(0);
}

function noStandIn(node: Element): string[] {
  return (node.textContent ?? '').match(STAND_INS) ?? [];
}

/** The node the assertions are about — never a silent null. */
function must(container: HTMLElement, selector: string): Element {
  const node = container.querySelector(selector);
  expect(node, `${selector} did not render — every assertion on it would be vacuous`)
    .not.toBeNull();
  return node!;
}

type RouterEntry = string | { pathname: string; search?: string; state?: unknown };

function Providers({
  children,
  entry = '/',
}: {
  children: React.ReactNode;
  entry?: RouterEntry;
}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={qc}>
      <MantineProvider forceColorScheme="dark">
        <MemoryRouter initialEntries={[entry as never]}>
          <LayoutProvider>
            <TasksUiStateProvider>{children}</TasksUiStateProvider>
          </LayoutProvider>
        </MemoryRouter>
      </MantineProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  viewerBomb.armed = false;
  mockReminders.list = [];
  mockLayered.state = {
    tree: [],
    isLoading: false,
    error: null,
    tooLarge: false,
    requestedAt: null,
  };
  mockListUsers.mockReset();
  mockListApiKeys.mockReset();
  mockListIssues.mockReset();
  mockListAttachments.mockReset();
  mockListUsers.mockResolvedValue({
    items: [] as User[],
    nextCursor: null,
    hasMore: false,
  } satisfies UserListResult);
  mockListApiKeys.mockResolvedValue([]);
  mockListIssues.mockResolvedValue({ items: [], total: 0, hasMore: false });
  mockListAttachments.mockResolvedValue({ items: [], total: 0 } satisfies AttachmentList);
});

afterEach(() => cleanup());

/* ══════════════════════════════════════════════════════════════════
 * 1. The kanban board's locked column
 * ══════════════════════════════════════════════════════════════════ */

describe('sk-285.7.2.88 — the locked column draws a padlock', () => {
  function renderBoard() {
    return render(
      <Providers>
        <KanbanBoard
          items={[]}
          axis="status"
          statusFilter={'all' as StatusFilter}
          onStatusFilterChange={vi.fn()}
          selectedIssueId={null}
          onSelect={vi.fn()}
          hasNextPage={false}
          isFetchingNextPage={false}
          fetchNextPage={vi.fn()}
        />
      </Providers>,
    );
  }

  /**
   * sk-391 — the focus bar's two states, which used to be a filled and a
   * hollow target (`⦿` U+29BF / `⦾` U+29BE, Miscellaneous
   * Mathematical Symbols-B). No mark class reached that block until this
   * task widened `SYMBOLS`, so the pair was outside the guard entirely.
   *
   * Replaced rather than exempted, because the product already OWNS the
   * pair that says this: `IconFilter` / `IconFilterOff`, which the filter
   * panel draws for «narrowing in force» / «narrowing lifted». A project
   * focus is a narrowing over projects, and the bar's own words say
   * «active» / «paused», so the two icons state exactly what the two
   * characters stated.
   */
  function renderFocusBar(paused: boolean) {
    return render(
      <Providers>
        <KanbanBoard
          items={[]}
          axis="status"
          statusFilter={'all' as StatusFilter}
          onStatusFilterChange={vi.fn()}
          selectedIssueId={null}
          onSelect={vi.fn()}
          hasNextPage={false}
          isFetchingNextPage={false}
          fetchNextPage={vi.fn()}
          projectFocus={new Set(['uuid-shop'])}
          projectFocusPausedBy={paused ? 'shop' : null}
        />
      </Providers>,
    );
  }

  test.each([
    ['active', false],
    ['paused', true],
  ] as const)('the focus bar says «%s» with a drawn icon', (_name, paused) => {
    const { container } = renderFocusBar(paused);
    const bar = must(container, '.kanban-focus-bar');
    expect(bar.classList.contains('is-paused'), 'wrong branch of the bar').toBe(paused);
    assertDrawn(must(bar as HTMLElement, '.kanban-focus-icon'), '.kanban-focus-icon');
    expect(noStandIn(bar)).toEqual([]);
    // The sentence beside it survives — the icon sorts the state, the
    // words carry it.
    expect((must(bar as HTMLElement, '.kanban-focus-text').textContent ?? '').trim().length)
      .toBeGreaterThan(0);
  });

  test('the `standing` column marks itself with a drawn lock', () => {
    // `standing` is the one status the board may not be dropped into
    // (`KANBAN_LOCKED_STATUSES`), so the lock is on screen with no
    // configuration at all. It was U+1F512 — an emoji, measured at
    // 7.45×12 in this container: the missing-glyph box.
    const { container } = renderBoard();
    const lock = must(container, '.kanban-col-lock');
    assertDrawn(lock, '.kanban-col-lock');
    expect(noStandIn(lock)).toEqual([]);
    // The mark is decoration; the name is on the span.
    expect(lock.getAttribute('aria-label') ?? '').not.toBe('');
  });
});

/* ══════════════════════════════════════════════════════════════════
 * 2. The epic panel's «Add child»
 * ══════════════════════════════════════════════════════════════════ */

const EPIC: IssueDetail = {
  id: 'sk-32',
  projectId: '00000000-0000-0000-0000-000000000001',
  version: 1,
  title: 'an epic with children',
  description: '',
  type: 'epic',
  priority: 2,
  status: 'open',
  pinned: false,
  source: 'human',
  design: '',
  acceptanceCriteria: '',
  notes: '',
  createdBy: 'u-1',
  createdAt: '2026-05-15T10:00:00Z',
  updatedAt: '2026-05-15T10:00:00Z',
  metadata: {},
  componentIds: [],
  labels: [],
  commentsCount: 0,
  commitRefs: [],
  mentions: [],
  isBlocked: false,
  blockers: [],
  epic: {
    totalChildren: 8,
    openChildren: 5,
    inProgressChildren: 2,
    closedChildren: 1,
    blockedChildren: 0,
    eligibleForClose: false,
  },
} as unknown as IssueDetail;

describe('sk-285.7.2.88 — «Add child» opens with a drawn plus', () => {
  test('the toggle carries a drawn `plus`, not the character U+002B', async () => {
    const { container } = render(
      <Providers>
        <EpicProgressSection issue={EPIC} />
      </Providers>,
    );
    const toggle = await waitFor(() => must(container, '.epic-add-child-toggle'));
    assertDrawn(toggle, '.epic-add-child-toggle');
    // The `+` used to OPEN the label; the label itself survives.
    expect(noStandIn(toggle)).toEqual([]);
    expect((toggle.textContent ?? '').trim().length).toBeGreaterThan(0);
    expect((toggle.textContent ?? '').trim().startsWith('+')).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════
 * 3. The settings chrome — its way back, and its two `+` buttons
 * ══════════════════════════════════════════════════════════════════ */

describe('sk-285.7.2.88 — the settings screens', () => {
  test('«Back» is a drawn arrow, in the layout every settings page wears', async () => {
    // `SettingsLayout` has no page of its own: it is mounted through a
    // real settings page, which is also how a user ever sees it.
    const { container } = render(
      <Providers>
        <NewApiKeysPage />
      </Providers>,
    );
    const back = await waitFor(() => must(container, '.settings-back-link'));
    assertDrawn(back, '.settings-back-link');
    // The `←` lived INSIDE `settings.back` in both locales, so a
    // regression puts it back in the run beside the icon.
    expect(noStandIn(back)).toEqual([]);
    expect((back.textContent ?? '').trim().length).toBeGreaterThan(0);
  });

  test('«New key» opens with a drawn plus', async () => {
    const { container } = render(
      <Providers>
        <NewApiKeysPage />
      </Providers>,
    );
    const button = await waitFor(() => {
      const b = [...container.querySelectorAll('button')].find((el) =>
        (el.textContent ?? '').includes('New key'),
      );
      expect(b, 'the «New key» button did not render').toBeTruthy();
      return b!;
    });
    assertDrawn(button, '«New key»');
    expect(noStandIn(button)).toEqual([]);
    expect((button.textContent ?? '').trim().startsWith('+')).toBe(false);
  });

  test('«New user» opens with a drawn plus', async () => {
    const { container } = render(
      <Providers>
        <NewUsersPage />
      </Providers>,
    );
    const button = await waitFor(() => {
      const b = [...container.querySelectorAll('button')].find((el) =>
        (el.textContent ?? '').includes('New user'),
      );
      expect(b, 'the «New user» button did not render').toBeTruthy();
      return b!;
    });
    assertDrawn(button, '«New user»');
    expect(noStandIn(button)).toEqual([]);
    expect((button.textContent ?? '').trim().startsWith('+')).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════
 * 4. The reminders lens — both of its when-rows
 * ══════════════════════════════════════════════════════════════════ */

function reminder(over: Partial<Reminder> = {}): Reminder {
  return {
    id: 'r-1',
    issueId: 'sk-7',
    issueTitle: 'a task with an alarm',
    issueStatus: 'open',
    projectId: 'p',
    issueType: 'task',
    issuePriority: 3,
    remindAt: new Date(Date.now() + 3_600_000).toISOString(),
    notifiedAt: null,
    snoozeCount: 0,
    lastReason: null,
    state: 'armed',
    ...over,
  } as Reminder;
}

describe('sk-285.7.2.88 — the Alarm clock lens rows', () => {
  function renderLens() {
    return render(
      <Providers>
        <BudilnikLensBody selectedIssueId={null} />
      </Providers>,
    );
  }

  test('an ARMED row opens its countdown with a drawn alarm, not ⏰', async () => {
    mockReminders.list = [reminder()];
    const { container } = renderLens();
    const when = await waitFor(() => must(container, '.budilnik-when-armed'));
    assertDrawn(when, '.budilnik-when-armed');
    expect(noStandIn(when)).toEqual([]);
  });

  test('a RINGING row opens its line with a drawn alarm, not 🔔', async () => {
    mockReminders.list = [
      reminder({
        id: 'r-2',
        state: 'ringing',
        remindAt: new Date(Date.now() - 3_600_000).toISOString(),
        notifiedAt: new Date(Date.now() - 3_500_000).toISOString(),
      }),
    ];
    const { container } = renderLens();
    const when = await waitFor(() => must(container, '.budilnik-when-ringing'));
    assertDrawn(when, '.budilnik-when-ringing');
    expect(noStandIn(when)).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════════
 * 5. The file viewer's header, on the SUCCESS branch
 * ══════════════════════════════════════════════════════════════════ */

const ATTACHMENT: Attachment = {
  id: '11111111-1111-4111-8111-111111111111',
  issueId: 'sk-7',
  filename: 'notes.txt',
  contentType: 'text/plain',
  sizeBytes: 12,
  status: 'ready',
  uploadedBy: 'u-1',
  uploadedAt: '2026-05-01T10:00:00Z',
};

describe('sk-285.7.2.88 — the file viewer header', () => {
  test('download and close are drawn, not typed', async () => {
    mockListAttachments.mockResolvedValue({ items: [ATTACHMENT], total: 1 });
    const { container } = render(
      <Providers>
        <FileViewerPanel issueId="sk-7" attachmentId={ATTACHMENT.id} onClose={vi.fn()} />
      </Providers>,
    );
    const header = await waitFor(() => must(container, '.file-viewer-header'));
    const actions = [...header.querySelectorAll('.file-viewer-action')];
    // Two controls: `↓` and `×`. A branch that stopped rendering one of
    // them would otherwise pass on the survivor alone.
    expect(actions).toHaveLength(2);
    assertDrawn(actions[0], '.file-viewer-action (download)');
    assertDrawn(actions[1], '.file-viewer-action (close)');
    expect(noStandIn(header)).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════════
 * 6. The lens HEADING, which lives one component above the rows
 * ══════════════════════════════════════════════════════════════════ */

describe('sk-285.7.2.88 — the Alarm clock column heading', () => {
  test('the heading is drawn, not opened with ⏰', async () => {
    // `budilnikMode` is an early return in `TasksColumn`: the lens
    // replaces the whole board, so this heading is the column's own and
    // is not reachable from `BudilnikLensBody` above.
    const { container } = render(
      <Providers>
        <TasksColumn
          width={468}
          collapsed={false}
          outboxMode={false}
          onMeMode={false}
          budilnikMode
        />
      </Providers>,
    );
    const heading = await waitFor(() => must(container, '.budilnik-heading'));
    assertDrawn(heading, '.budilnik-heading');
    expect(noStandIn(heading)).toEqual([]);
    expect((heading.textContent ?? '').trim().length).toBeGreaterThan(0);
  });
});

/* ══════════════════════════════════════════════════════════════════
 * 7. The anchored subtree's three ways back
 * ══════════════════════════════════════════════════════════════════ */

/**
 * The anchor is in-memory state on `TasksUiStateProvider` (sk-98 — it
 * deliberately does not persist), so a test reaches it the way the app
 * does: through the context, from inside the provider.
 */
function SetAnchor({ id }: { id: string }): null {
  const ui = useTasksUiState();
  const set = ui.setTreeRootAnchor;
  useEffect(() => {
    set({ id, projectId: 'proj-uuid-1' });
  }, [set, id]);
  return null;
}

function renderAnchored() {
  return render(
    <Providers>
      <SetAnchor id="sk-1" />
      <TasksColumn
        width={468}
        collapsed={false}
        outboxMode={false}
        onMeMode={false}
        budilnikMode={false}
      />
    </Providers>,
  );
}

describe('sk-285.7.2.88 — the anchored subtree bar', () => {
  test('the breadcrumb back button is a drawn arrow, not U+2190', async () => {
    const { container } = renderAnchored();
    const back = await waitFor(() => must(container, 'button.tasks-tree-anchor-back'));
    assertDrawn(back, '.tasks-tree-anchor-back');
    expect(noStandIn(back)).toEqual([]);
    expect((back.textContent ?? '').trim().length).toBeGreaterThan(0);
  });

  test('and the label beside it opens with a drawn `corner-down-right`', async () => {
    // sk-391 — this used to be `⤴` (U+2934, Supplemental Arrows-B) and
    // the test above said so, scoping itself to the BUTTON so the arrow
    // beside it would not redden it. The arrow is gone: the label names
    // an EPIC SUBTREE, which is the object §8 gives `corner-down-right`,
    // and the band already drew `arrow-left` at 16 one node over.
    //
    // Measured on the bar rather than on the button, which is the scope
    // the old comment had to exclude.
    const { container } = renderAnchored();
    const label = await waitFor(() => must(container, '.tasks-tree-anchor-label'));
    assertDrawn(label, '.tasks-tree-anchor-label');
    expect(noStandIn(label)).toEqual([]);
    // The words survive — the icon decorates the label, it is not the label.
    expect((label.textContent ?? '').trim().length).toBeGreaterThan(0);
  });

  test('the way back offered when the subtree FAILED is drawn too', async () => {
    mockLayered.state = {
      tree: [],
      isLoading: false,
      error: new Error('layered tree unavailable'),
      tooLarge: false,
      // sk-421.2 T017 — the request failed, there is no shown answer: there is no
      // moment of its request either. By the freshness rule "no answer" means stale.
      requestedAt: null,
    };
    const { container } = renderAnchored();
    // `.col-error` is the branch marker: it is the FAILED-query copy,
    // not the empty-subtree one the next test reads.
    const failed = await waitFor(() => must(container, '.col-empty.col-error'));
    const inline = must(failed as HTMLElement, '.tasks-tree-anchor-back-inline');
    assertDrawn(inline, '.tasks-tree-anchor-back-inline (load failed)');
    expect(noStandIn(inline)).toEqual([]);
  });

  test('and so is the one offered when it resolved to NOTHING', async () => {
    // Same control, a different branch of the same body — shipping one
    // drawn and one typed is exactly the split this task refused for
    // the file viewer's two branches.
    const { container } = renderAnchored();
    const empty = await waitFor(() => must(container, '.col-empty'));
    expect(empty.classList.contains('col-error')).toBe(false);
    const inline = must(empty as HTMLElement, '.tasks-tree-anchor-back-inline');
    assertDrawn(inline, '.tasks-tree-anchor-back-inline (empty subtree)');
    expect(noStandIn(inline)).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════════
 * 8. …and the file viewer's ERROR branch, which is a second component
 * ══════════════════════════════════════════════════════════════════ */

describe('sk-285.7.2.88 — the file viewer that failed to load', () => {
  test('its close button is drawn too — the two branches agree', async () => {
    // The task named only the ErrorBoundary's `×`; the commit moved
    // both branches, because a close button that changes shape
    // depending on whether the file loaded is not a fix. This is the
    // half that lives in `DetailsColumn`, behind a `lazy()` import — so
    // it is reached the way the boundary is reached in production: the
    // viewer throws.
    viewerBomb.armed = true;
    const { container } = render(
      <Providers
        entry={{
          pathname: '/',
          search: `?file=${ATTACHMENT.id}`,
          // `selfOpenedFile` is the in-card open path: the viewer
          // REPLACES the card, so the boundary is the only thing this
          // column renders and the assertion cannot be reading some
          // other `.file-viewer-action`.
          state: { selfOpenedFile: true },
        }}
      >
        <DetailsColumn issueId="sk-7" />
      </Providers>,
    );
    const header = await waitFor(() => {
      const h = container.querySelector('.file-viewer-panel .file-viewer-header');
      expect(h, 'the error boundary did not render its own header').not.toBeNull();
      return h!;
    });
    const close = must(header as HTMLElement, '.file-viewer-action');
    assertDrawn(close, '.file-viewer-action (error branch)');
    expect(noStandIn(close)).toEqual([]);
    expect(close.getAttribute('aria-label') ?? '').not.toBe('');
  });
});
