/**
 * sk-421.1 T015 — render tests of the "Blocked" block
 * (`BlockedBySection.tsx`). One file for the cases that land on the
 * block itself: the lens, and the cases that follow it in this group.
 *
 * Harness:
 *   - `useLayoutState` is a FILE mock: the block only calls
 *     `setSelectedIssue` (opening a blocker), and `outboxMode` is exposed so
 *     the lens test can flip it;
 *   - i18n is the real bundled instance (English unless a test switches).
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { DependencyEdge, DependencyList } from '../../../../api/dependencies';
import type { BlockerRef, IssueDetail } from '../../../../api/issues';
import i18n, { DEFAULT_LANGUAGE } from '../../../../i18n/config';

const layout = vi.hoisted(() => ({
  setSelectedIssue: vi.fn(),
  // Read by the REAL DetailsHeader in the row-47 panel render.
  clearSelectedIssue: vi.fn(),
  selectedProject: 'test' as string | null,
  outboxMode: false,
}));
vi.mock('../../../../lib/useLayoutState', () => ({
  useLayoutState: () => layout,
}));

// Review F-3 — a blocker link navigates by path (`/projects/<pid>/issues/<id>`),
// so the navigation spy is `useNavigate`, not the layout helper.
const router = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('react-router-dom', async (importActual) => {
  const actual = await importActual<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => router.navigate };
});

import { BlockedBySection } from './BlockedBySection';
import { IssueDetailPanel } from '../IssueDetailPanel';

// ───────────────────────── fixtures ─────────────────────────

/** A blocked, open issue with no blockers yet (tests supply them). */
function issue(over: Partial<IssueDetail> = {}): IssueDetail {
  return {
    id: 'sk-1',
    projectId: 'proj-a',
    version: 1,
    title: 'task',
    description: '',
    type: 'task',
    priority: 2,
    status: 'open',
    pinned: false,
    source: 'human',
    design: '',
    acceptanceCriteria: '',
    notes: '',
    createdBy: 'u-1',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
    metadata: {},
    componentIds: [],
    labels: [],
    commentsCount: 0,
    commitRefs: [],
    mentions: [],
    isBlocked: true,
    blockers: [],
    ...over,
  } as IssueDetail;
}

/** A `blocks` edge from the issue to a visible blocker in `projectId`. */
function blocksEdge(blocker: { id: string; title: string }, projectId: string): DependencyEdge {
  return {
    type: 'blocks',
    fromId: 'sk-1',
    toId: blocker.id,
    version: 1,
    createdAt: '2026-01-01T00:00:00Z',
    metadata: {},
    issue: {
      id: blocker.id,
      projectId,
      title: blocker.title,
      status: 'in_progress',
      priority: 2,
      type: 'task',
    },
  } as DependencyEdge;
}

/** Visible with a known project, visible without one, and a hidden one. */
const MIXED_BLOCKERS: BlockerRef[] = [
  { id: 'other-2', title: 'Blocker in another project', status: 'in_progress' },
  { id: 'sk-3', title: 'Blocker without an edge', status: 'deferred' },
  { id: 'hidden-9', redacted: true },
];

const MIXED_DEPS: DependencyList = {
  outgoing: [blocksEdge({ id: 'other-2', title: 'Blocker in another project' }, 'proj-other')],
  incoming: [],
};

function mountBlock(
  value: IssueDetail,
  dependencies: DependencyList | undefined = MIXED_DEPS,
  status: 'pending' | 'error' | 'success' = 'success',
) {
  return render(
    <MantineProvider>
      <BlockedBySection issue={value} dependencies={dependencies} dependenciesStatus={status} />
    </MantineProvider>,
  );
}

afterEach(async () => {
  cleanup();
  vi.clearAllMocks();
  layout.outboxMode = false;
  // Language back AFTER cleanup: switching it while a tree is still mounted
  // re-renders that tree outside act() (the same order as
  // IssuePropertiesRow.test.tsx).
  if (i18n.language !== DEFAULT_LANGUAGE) {
    await i18n.changeLanguage(DEFAULT_LANGUAGE);
  }
});

// ──────── row 45 — the My-assigned lens does not change the block (INV-8) ────────

describe('"Blocked" block — identical with the My-assigned lens off and on (INV-8, row 45)', () => {
  function blockHtml(outboxMode: boolean): string {
    layout.outboxMode = outboxMode;
    const { container, unmount } = mountBlock(issue({ blockers: MIXED_BLOCKERS }));
    const html = container.querySelector('.blocked-by')?.outerHTML ?? '';
    unmount();
    return html;
  }

  test('lens off and lens on render the same block, row for row', () => {
    const off = blockHtml(false);
    const on = blockHtml(true);
    // Guard against a vacuous pass: the block really rendered all three rows.
    // `(?=[\s"])` and not `\b`: the hidden row also carries
    // `blocked-by-row--hidden`, and `\b` matches before its `-`.
    expect(off.match(/blocked-by-row(?=[\s"])/g)?.length).toBe(3);
    expect(on).toBe(off);
  });
});

// ──────── row 46 — the block only shows, it never writes (INV-1) ────────
//
// Same check as the properties row: the block takes no mutation callback,
// so a write could only go over the network. Every row and every control in
// it is clicked; `fetch` must not be called. Opening a visible blocker is
// navigation (`setSelectedIssue`) and is the only allowed effect.

describe('"Blocked" block — display only, no writes (INV-1, row 46)', () => {
  test('clicking every row and every control in it sends no request; nothing is editable', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { container } = mountBlock(issue({ blockers: MIXED_BLOCKERS }));
    const block = container.querySelector('.blocked-by')!;
    const rows = Array.from(block.querySelectorAll('li'));
    expect(rows.length).toBe(3);

    for (const row of rows) {
      fireEvent.click(row);
      row.querySelectorAll('button, a, span').forEach((el) => {
        fireEvent.click(el);
        fireEvent.doubleClick(el);
      });
    }

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(block.querySelector('input, textarea, select, [contenteditable]')).toBeNull();
    // Only the visible blocker with a known project is a link.
    expect(router.navigate).toHaveBeenCalledWith('/projects/proj-other/issues/other-2');
    expect(router.navigate).toHaveBeenCalledTimes(1);
    fetchSpy.mockRestore();
  });
});

// ──────── row 47 — ONE rule: header outline and block in ONE panel render ────────
//
// INV-9 is a relation between two consumers of one predicate, so both are
// asserted in the same render of the real panel. Separate tests would stay
// green while the header and the block each restated the rule differently.
//
// Harness:
//   - REAL: IssueDetailPanel, DetailsHeader, BlockedBySection;
//   - stubbed: every other section (the properties row included),
//     PeopleChain, IssueTitleEdit — NOT the header: a header stub would make
//     "no outline" pass vacuously;
//   - mocked: useIssueDetail (with `issueDependenciesKey`, which the header's
//     MoveIssueButton computes on render), plus the file-level useLayoutState
//     mock above (the real header reads clearSelectedIssue / selectedProject).

vi.mock('./ActivitySection', () => ({ ActivitySection: () => null }));
vi.mock('./AttachmentsSection', () => ({ AttachmentsSection: () => null }));
vi.mock('./ClosedReasonSection', () => ({ ClosedReasonSection: () => null }));
vi.mock('./CommentsSection', () => ({ CommentsSection: () => null }));
vi.mock('./CommitsSection', () => ({ CommitsSection: () => null }));
vi.mock('./DependenciesSection', () => ({ DependenciesSection: () => null }));
vi.mock('./EditableTextSection', () => ({ EditableTextSection: () => null }));
vi.mock('./EpicProgressSection', () => ({ EpicProgressSection: () => null }));
vi.mock('./IssuePropertiesRow', () => ({ IssuePropertiesRow: () => null }));
vi.mock('./RemindersSection', () => ({ RemindersSection: () => null }));
vi.mock('./ReviewFlagSection', () => ({ ReviewFlagSection: () => null }));
vi.mock('./WatchersSection', () => ({ WatchersSection: () => null }));
vi.mock('../PeopleChain', () => ({ PeopleChain: () => null }));
vi.mock('../IssueTitleEdit', () => ({ IssueTitleEdit: () => null }));

vi.mock('../../../../lib/useProjectByHandle', () => ({
  useProjectByHandle: () => ({
    project: { id: 'proj-a', idPrefix: 'test', name: 'test' },
    isLoading: false,
    isUnresolved: false,
  }),
}));
// The real hook returns an ARRAY (the panel reads `.length`).
vi.mock('../../../../lib/useReminders', () => ({
  useIssueReminders: () => [],
}));
vi.mock('../../../../components/Toaster', () => ({
  useToaster: () => ({ error: vi.fn(), success: vi.fn() }),
}));
vi.mock('../../../../auth/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u-1', username: 'author', role: 'user' },
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

const panel = vi.hoisted(() => ({
  issue: undefined as unknown,
  dependencies: undefined as unknown,
}));
vi.mock('../../../../lib/useIssueDetail', () => ({
  issueWatchersKey: (id: string) => ['watchers', 'issue', id] as const,
  issueDetailKey: (id: string) => ['issues', 'detail', id] as const,
  issueDependenciesKey: (projectId: string, id: string) => ['deps', projectId, id] as const,
  isStatusChangeFailure: () => false,
  useIssueDetail: () => ({
    issue: panel.issue,
    isLoading: false,
    isError: false,
    error: null,
    comments: [],
    attachments: [],
    dependencies: panel.dependencies,
    dependenciesStatus: 'success',
    activity: [],
    watchers: [],
    issueQuery: { isLoading: false, isError: false },
    updateField: vi.fn(),
    changeStatus: vi.fn(),
    accept: vi.fn(),
    changeReviewRequired: vi.fn(),
    markResultReviewed: vi.fn(),
    reviewPending: false,
  }),
}));

describe('one «blocked» rule on the card — header outline and block in one panel render (INV-9, SC-013, row 47)', () => {
  function renderPanel(value: IssueDetail) {
    panel.issue = value;
    panel.dependencies = MIXED_DEPS;
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <MantineProvider>
        <QueryClientProvider client={qc}>
          <MemoryRouter>
            <IssueDetailPanel issueId="sk-1" projectHandle="test" />
          </MemoryRouter>
        </QueryClientProvider>
      </MantineProvider>,
    );
  }

  /** Both consumers of the rule, read off the SAME render. */
  function consumers(container: HTMLElement) {
    const status = container.querySelector('.header-status');
    // Guard: the real header rendered its status trigger.
    expect(status, 'the real DetailsHeader rendered its status trigger').not.toBeNull();
    return {
      // The header's blocked mark, read off the trigger's accessible
      // name — the channel that carries it alongside the outline.
      outline: /blocked by dependencies/.test(status!.getAttribute('aria-label') ?? ''),
      block: container.querySelector('.blocked-by') !== null,
    };
  }

  test.each([
    ['closed', true, MIXED_BLOCKERS, { outline: false, block: false }],
    ['standing', true, MIXED_BLOCKERS, { outline: false, block: false }],
    [
      'in_progress',
      true,
      [{ id: 'sk-3', title: 'Blocker in progress', status: 'in_progress' }],
      { outline: true, block: true },
    ],
    [
      'deferred',
      true,
      [{ id: 'sk-3', title: 'Deferred blocker', status: 'deferred' }],
      { outline: true, block: true },
    ],
    ['open', true, [], { outline: true, block: false }],
    ['open', false, MIXED_BLOCKERS, { outline: false, block: false }],
  ] as Array<[IssueDetail['status'], boolean, BlockerRef[], { outline: boolean; block: boolean }]>)(
    'status %s, isBlocked %s, %j blockers → %j',
    (status, isBlocked, blockers, expected) => {
      const { container } = renderPanel(issue({ status, isBlocked, blockers }));
      expect(consumers(container)).toEqual(expected);
    },
  );

  test('all blockers hidden → outline, and a block made only of «unavailable» rows', () => {
    const hidden: BlockerRef[] = [
      { id: 'hidden-1', redacted: true },
      { id: 'hidden-2', redacted: true },
    ];
    const { container } = renderPanel(issue({ status: 'open', isBlocked: true, blockers: hidden }));
    expect(consumers(container)).toEqual({ outline: true, block: true });
    const rows = Array.from(container.querySelectorAll('.blocked-by-row'));
    expect(rows.length).toBe(2);
    for (const row of rows) {
      expect(row.classList.contains('blocked-by-row--hidden')).toBe(true);
      expect(row.textContent).toBe('unavailable');
    }
    expect(container.innerHTML).not.toContain('hidden-1');
    expect(container.innerHTML).not.toContain('hidden-2');
  });
});

// ──────── row 48 — block rows: shape, hidden entry, link into the blocker's project ────────

describe('"Blocked" rows — shape, hidden entry, link into the blocker project (US-5, INV-3, row 48)', () => {
  /**
   * INV-3 on the frontend: a hidden entry arrives as `{id, redacted: true}`
   * with NO title and NO status. Typed as a blocker record, this literal
   * compiles only because T012 made those fields optional — the type build
   * is the discriminator for that half.
   */
  const REDACTED_ENTRY: BlockerRef = { id: 'hidden-typed', redacted: true };

  function rows(container: HTMLElement): HTMLElement[] {
    return Array.from(container.querySelectorAll<HTMLElement>('.blocked-by-row'));
  }

  test('rows follow the server order; a visible row is id · title · status as separate elements', () => {
    const { container } = mountBlock(issue({ blockers: MIXED_BLOCKERS }));
    const all = rows(container);
    expect(all.length).toBe(3);

    // Order of the response, not sorted, not grouped by visibility.
    expect(all[0].textContent?.startsWith('other-2 ')).toBe(true);
    expect(all[1].textContent?.startsWith('sk-3 ')).toBe(true);
    expect(all[2].classList.contains('blocked-by-row--hidden')).toBe(true);

    // id → title → status, each its own element, in that order.
    const line = all[1].querySelector('.detail-row-line')!;
    const parts = Array.from(line.children);
    expect(parts[0].textContent).toBe('sk-3');
    expect(parts[1].classList.contains('blocked-by-row-title')).toBe(true);
    expect(parts[1].textContent).toBe('Blocker without an edge');
    expect(parts[2].classList.contains('status-chip')).toBe(true);
    expect(parts[2].getAttribute('data-status')).toBe('deferred');
  });

  test('a hidden entry → lock and the "unavailable" text; no id, no title, no status, not clickable', async () => {
    await i18n.changeLanguage('ru');
    const { container } = mountBlock(
      issue({ blockers: [REDACTED_ENTRY] }),
      { outgoing: [], incoming: [] },
      'success',
    );
    const [row] = rows(container);
    expect(row).toBeDefined();
    expect(row.querySelector('svg')).not.toBeNull();
    expect(row.textContent).toBe('недоступно');
    expect(row.querySelector('button, a')).toBeNull();
    expect(row.querySelector('.status-chip')).toBeNull();
    expect(container.innerHTML).not.toContain('hidden-typed');
  });

  test('a visible blocker in ANOTHER project opens its card in that project, not in the issue project', () => {
    const { container } = mountBlock(issue({ projectId: 'proj-a', blockers: MIXED_BLOCKERS }));
    const link = rows(container)[0].querySelector('button')!;
    expect(link.textContent).toBe('other-2');
    fireEvent.click(link);
    expect(router.navigate).toHaveBeenCalledWith('/projects/proj-other/issues/other-2');
    expect(router.navigate).not.toHaveBeenCalledWith('/projects/proj-a/issues/other-2');
  });

  test('a blocker through a WAITS-FOR edge is a link into its project too', () => {
    // A blocker is the other side of an outgoing `blocks` OR `waits-for`
    // edge (spec "Terms"); the server fills `blockers[]` from both.
    const waitsFor = {
      type: 'waits-for',
      fromId: 'sk-1',
      toId: 'wait-4',
      version: 1,
      createdAt: '2026-01-01T00:00:00Z',
      metadata: { gate: 'all-children' },
      issue: {
        id: 'wait-4',
        projectId: 'proj-wait',
        title: 'Waited-on epic',
        status: 'open',
        priority: 2,
        type: 'epic',
      },
    } as DependencyEdge;
    const { container } = mountBlock(
      issue({ blockers: [{ id: 'wait-4', title: 'Waited-on epic', status: 'open' }] }),
      { outgoing: [waitsFor], incoming: [] },
      'success',
    );
    const link = rows(container)[0].querySelector('button');
    expect(link).not.toBeNull();
    expect(link!.textContent).toBe('wait-4');
    fireEvent.click(link!);
    expect(router.navigate).toHaveBeenCalledWith('/projects/proj-wait/issues/wait-4');
  });

  test('no native title in the rows; a cut title carries its full text in the instant tooltip', () => {
    const { container } = mountBlock(issue({ blockers: MIXED_BLOCKERS }));
    const block = container.querySelector('.blocked-by')!;
    // Native tooltips are delayed — the card's rule is instant ones only.
    expect(block.querySelector('[title]')).toBeNull();

    const title = rows(container)[0].querySelector('.blocked-by-row-title')!;
    fireEvent.mouseEnter(title);
    expect(document.body.querySelector('[role="tooltip"]')?.textContent).toBe(
      'Blocker in another project',
    );
  });

  test.each([
    ['dependencies not received yet', undefined, 'pending'],
    ['dependencies failed', undefined, 'error'],
    ['received, but no blocks edge to it', { outgoing: [], incoming: [] }, 'success'],
  ] as Array<[string, DependencyList | undefined, 'pending' | 'error' | 'success']>)(
    'project unknown (%s) → id, title and status as text, no link',
    (_name, deps, status) => {
      const { container } = mountBlock(issue({ blockers: MIXED_BLOCKERS }), deps, status);
      const first = rows(container)[0];
      expect(first.querySelector('button, a')).toBeNull();
      expect(first.querySelector('.blocked-by-id')?.textContent).toBe('other-2');
      expect(first.querySelector('.blocked-by-row-title')?.textContent).toBe(
        'Blocker in another project',
      );
      expect(first.querySelector('.status-chip')?.getAttribute('data-status')).toBe('in_progress');
      expect(router.navigate).not.toHaveBeenCalled();
    },
  );
});
