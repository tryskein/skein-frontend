import { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, render, screen, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock the issues API before importing the component under test.
//
// sk-421.2 T019 — `listIssues` left here: the section has not used it since
// sk-36, and from this task the rows are taken by a cross-project tree query
// with depth 1. The plan prescribed "move the mock to fetchIssueTree", but
// the purpose has ALREADY been achieved in another, more precise way: T015 raised the mock
// to the level of the `useLayeredTree` hook itself (below), and this allows
// checking the query ARGUMENTS — which a network-layer mock does not give. Lowering
// it back to `fetchIssueTree` would mean losing the SC-011 and
// SC-014 guards. `createIssue` stays: the "Add
// child" form depends on it.
vi.mock('../../../../api/issues', async (importActual) => {
  const actual = await importActual<typeof import('../../../../api/issues')>();
  return {
    ...actual,
    createIssue: vi.fn(),
  };
});

// sk-421.2 T015 — SC-014 requires that when "total + standing = 0" the rows
// query is NOT executed, and SC-011 — that the query arguments contain no
// "My-assigned mode" lens. Both are properties of the CALL, not of the markup:
// from the DOM "there was no query" cannot be told from "there was a query and it returned empty".
// So the hook is replaced and its arguments are recorded.
const layeredCalls: UseLayeredTreeArgs[] = [];
const layeredState: UseLayeredTreeResult = {
  tree: [],
  isLoading: false,
  error: null,
  tooLarge: false,
  // sk-421.2 T017 — the moment the shown response was requested; there is no response here.
  requestedAt: null,
};
// sk-421.2 T022 — the section started reading the user (mode memory per
// user, R-6). `useAuth` throws outside the provider, so its mock is
// mandatory; the shape is the same as in sections/reviewOnCard.test.tsx,
// so that this directory has ONE technique, not two.
const mockUser = { id: 'u-alice', username: 'alice', role: 'user' };
vi.mock('../../../../auth/AuthContext', () => ({
  // sk-551.8 — LayoutProvider reads the layout via useNavLayoutOptional;
  // null = no session known, the side-by-side layout.
  useAuthOptional: () => null,
  useAuth: () => ({
    user: mockUser,
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

vi.mock('../../../../lib/useLayeredTree', async (importActual) => {
  const actual =
    await importActual<typeof import('../../../../lib/useLayeredTree')>();
  return {
    ...actual,
    useLayeredTree: (args: UseLayeredTreeArgs) => {
      layeredCalls.push(args);
      return layeredState;
    },
  };
});

import type {
  IssueDetail,
  IssueTreeNode,
  IssueTreeRowItem,
} from '../../../../api/issues';
import type {
  UseLayeredTreeArgs,
  UseLayeredTreeResult,
} from '../../../../lib/useLayeredTree';
import { LayoutProvider, useLayoutState } from '../../../../lib/useLayoutState';
import type { TreeBlockerRef } from '../../../../api/issues';
import {
  markEpicSectionEvent,
  resetEpicSectionClockForTests,
} from '../../../../lib/epicSectionClock';
import { layeredTreeQueryKey } from '../../../../lib/useLayeredTree';
import { EpicProgressSection } from './EpicProgressSection';

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return (
    <MantineProvider forceColorScheme="dark">
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <LayoutProvider>{children}</LayoutProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>
  );
}

const BASE_EPIC: IssueDetail = {
  id: 'demo-32',
  projectId: '00000000-0000-0000-0000-000000000001',
  version: 1,
  title: 'first-class epics light',
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
};

beforeEach(() => {
  vi.clearAllMocks();
  // The mock state is shared per file: without a reset the tests would affect each other.
  layeredCalls.length = 0;
  layeredState.tree = [];
  layeredState.isLoading = false;
  layeredState.error = null;
  layeredState.tooLarge = false;
  layeredState.requestedAt = null;
  // sk-421.2 T022 — the mode is persisted per user in the REAL
  // jsdom localStorage. Without clearing, the mode chosen by one test
  // would leak into the next and quietly devalue its assertions.
  window.localStorage.clear();
  // sk-421.2 — the section clock lives in the module and only grows. Without a reset
  // an event of one test would make the next test's response stale in advance.
  resetEpicSectionClockForTests();
});

/** A tree response row: by default a visible direct child. */
function childNode(
  id: string,
  item: Partial<IssueTreeRowItem> = {},
  node: Partial<IssueTreeNode> = {},
): IssueTreeNode {
  return {
    item: {
      id,
      projectId: 'proj-child',
      version: 1,
      title: id,
      type: 'task',
      priority: 2,
      status: 'open',
      pinned: false,
      assignee: null,
      componentIds: [],
      labels: [],
      isBlocked: false,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      ...item,
    } as IssueTreeRowItem,
    depth: 1,
    parentRef: { id: 'demo-32', edgeType: 'parent-child' },
    isReference: false,
    firstSeenAt: null,
    ...node,
  };
}

afterEach(() => {
  cleanup();
});

describe('EpicProgressSection (sk-32 slice 6)', () => {
  test('renders progress bar + counters from the rollup', () => {
    render(
      <Wrapper>
        <EpicProgressSection issue={BASE_EPIC} />
      </Wrapper>,
    );
    // sk-421.2 US-1 — the line became "Done X · Not done Y"; Y is
    // open AND in progress (5 + 2 = 7), not a count of open ones.
    expect(screen.getByText(/Done 1/)).toBeTruthy();
    expect(screen.getByText(/Not done 7/)).toBeTruthy();
    // The progress bar has role=progressbar.
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('1');
    expect(bar.getAttribute('aria-valuemax')).toBe('8');
  });

  test('shows in_progress + blocked counters when non-zero', () => {
    render(
      <Wrapper>
        <EpicProgressSection issue={BASE_EPIC} />
      </Wrapper>,
    );
    // sk-421.2 — the "in progress" tail stayed (a caption without an underline), while
    // the "open" tail is gone: open ones went into "Not done".
    expect(screen.getByText(/2 in progress/)).toBeTruthy();
    expect(screen.queryByText(/ open/i)).toBeNull();
    // blocked = 0 → segment should not render
    expect(screen.queryByText(/blocked/i)).toBeNull();
  });

  test('returns null when issue.epic is undefined (non-epic guard)', () => {
    const taskIssue: IssueDetail = { ...BASE_EPIC, type: 'task', epic: null };
    render(
      <Wrapper>
        <EpicProgressSection issue={taskIssue} />
      </Wrapper>,
    );
    // The component returns null; the only DOM under the wrapper
    // belongs to Mantine's style provider. Probe for the section
    // heading instead — its absence proves the guard fired.
    expect(screen.queryByText(/Epic Progress/i)).toBeNull();
  });

  test('sk-514 (8) — "Add child" opens a POPUP, and the footer keeps the button', async () => {
    const user = (await import('@testing-library/user-event')).default.setup();
    const { container } = render(
      <Wrapper>
        <EpicProgressSection issue={BASE_EPIC} />
      </Wrapper>,
    );
    const toggle = screen.getByRole('button', { name: 'Add child' });
    await user.click(toggle);

    // The dialog is mounted through a portal, so its content is not in the
    // tree at once — that is the reason to wait, not "just in case".
    const dialog = await screen.findByRole('dialog');
    expect(dialog.contains(screen.getByPlaceholderText(/new child title/i))).toBe(true);

    // Before, the form PUSHED the footer apart, replacing the button. Now
    // the button stays in place and precisely in the footer, not in the dialog.
    const foot = container.querySelector('.epic-progress-foot')!;
    expect(foot.querySelector('.epic-add-child-toggle')).not.toBeNull();
    expect(dialog.querySelector('.epic-add-child-toggle')).toBeNull();

    // The button and submit labels are DISTINCT — otherwise in one tree with
    // the popup the two buttons would become indistinguishable by accessible name.
    expect(dialog.querySelector('button[type="submit"]')!.textContent).toBe('Add');
  });
});

// ───────────────────────── sk-421.2 T015 ─────────────────────────

/** The whole summary, on top of which tests change individual counters. */
function rollup(over: Record<string, number | boolean> = {}): IssueDetail {
  return {
    ...BASE_EPIC,
    epic: {
      totalChildren: 8,
      closedChildren: 3,
      openChildren: 4,
      inProgressChildren: 1,
      blockedChildren: 0,
      standingChildren: 0,
      deferredChildren: 0,
      unavailableChildren: 0,
      eligibleForClose: false,
      ...over,
    },
  } as unknown as IssueDetail;
}

describe('sk-421.2 T015 — progress line, bar, number in the heading', () => {
  test('"Done" and "Not done" are always visible; "Not done" = open + in progress', () => {
    // US-1: Y is open AND in progress, not a count of open ones. 4 + 1 = 5.
    render(
      <Wrapper>
        <EpicProgressSection issue={rollup()} />
      </Wrapper>,
    );
    expect(screen.getByText(/Done 3/)).toBeTruthy();
    expect(screen.getByText(/Not done 5/)).toBeTruthy();
  });

  test('tails are hidden at zero and shown at non-zero', () => {
    const { unmount } = render(
      <Wrapper>
        <EpicProgressSection issue={rollup()} />
      </Wrapper>,
    );
    // All five tails are zero except "in progress" — they are absent.
    expect(screen.queryByText(/blocked/i)).toBeNull();
    expect(screen.queryByText(/deferred/i)).toBeNull();
    expect(screen.queryByText(/unavailable/i)).toBeNull();
    expect(screen.queryByText(/standing/i)).toBeNull();
    unmount();

    render(
      <Wrapper>
        <EpicProgressSection
          issue={rollup({
            blockedChildren: 2,
            deferredChildren: 1,
            unavailableChildren: 1,
            standingChildren: 3,
          })}
        />
      </Wrapper>,
    );
    expect(screen.getByText(/1 in progress/)).toBeTruthy();
    expect(screen.getByText(/2 blocked/)).toBeTruthy();
    expect(screen.getByText(/1 deferred/)).toBeTruthy();
    expect(screen.getByText(/1 unavailable/)).toBeTruthy();
    expect(screen.getByText(/3 standing/)).toBeTruthy();
  });

  test('SC-014 case 1 — total > 0: accessible bar text "done X of total"', () => {
    render(
      <Wrapper>
        <EpicProgressSection issue={rollup()} />
      </Wrapper>,
    );
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuetext')).toBe('3 of 8 done');
    expect(bar.getAttribute('aria-label')).toBe('3 of 8 done');
  });

  test('SC-014 case 2 — total + standing = 0: "no child tasks"', () => {
    render(
      <Wrapper>
        <EpicProgressSection
          issue={rollup({
            totalChildren: 0,
            closedChildren: 0,
            openChildren: 0,
            inProgressChildren: 0,
            standingChildren: 0,
          })}
        />
      </Wrapper>,
    );
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuetext')).toBe('No children');
    // …and it is the only visible content under the progress line.
    expect(screen.getByText('No children')).toBeTruthy();
  });

  test('SC-014 case 3 — total 0 with standing > 0: "no task is counted"', () => {
    render(
      <Wrapper>
        <EpicProgressSection
          issue={rollup({
            totalChildren: 0,
            closedChildren: 0,
            openChildren: 0,
            inProgressChildren: 0,
            standingChildren: 2,
          })}
        />
      </Wrapper>,
    );
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuetext')).toBe('no task counts toward progress');
    // The text "no child tasks" must NOT be here: there are children.
    expect(screen.queryByText('No children')).toBeNull();
    expect(screen.getByText(/2 standing/)).toBeTruthy();
  });

  test('sk-460.6 — the section heading does NOT print numbers; the numbers live in the caption', () => {
    // Before, the opposite was asserted here: "the number in the section heading =
    // total + standing", and `.detail-section-count` = 10 was checked.
    // That was a recorded deviation No. 17 ("the header prints more than
    // the design"), and the maintainers lifted it together with moving the heading to the ring:
    // the design prints nothing in the heading.
    //
    // The requirement is not weakened but RE-ADDRESSED: the numbers must stay
    // on screen, and now the place where the design draws them is checked.
    const { container } = render(
      <Wrapper>
        <EpicProgressSection issue={rollup({ standingChildren: 2 })} />
      </Wrapper>,
    );
    expect(container.querySelector('.detail-section-count')).toBeNull();

    const counters = container.querySelector('.epic-progress-counters');
    expect(counters, 'there is no caption under the heading — the numbers vanished from the screen').not.toBeNull();
    // Standing ones (the very ones that distinguished 10 from 8) are still named.
    expect(counters!.textContent).toMatch(/2 standing/);
    expect(counters!.textContent).toMatch(/Done 3/);
  });

  test('SC-010 — the section has no link-type chips and no raw English labels', () => {
    const { container } = render(
      <Wrapper>
        <EpicProgressSection issue={rollup()} />
      </Wrapper>,
    );
    expect(container.querySelector('.filter-chip')).toBeNull();
    expect(container.querySelector('.epic-progress-deps-row')).toBeNull();
    // Raw link type values that the former row printed.
    for (const raw of ['waits-for', 'discovered-from', 'supersedes', 'duplicates']) {
      expect(screen.queryByText(raw)).toBeNull();
    }
  });

  test('SC-014 / F-19 — when "total + standing = 0" the rows query is not executed', () => {
    layeredCalls.length = 0;
    render(
      <Wrapper>
        <EpicProgressSection
          issue={rollup({
            totalChildren: 0,
            closedChildren: 0,
            openChildren: 0,
            inProgressChildren: 0,
            standingChildren: 0,
          })}
        />
      </Wrapper>,
    );
    expect(layeredCalls.length).toBeGreaterThan(0); // the hook is called…
    expect(layeredCalls.every((a) => a.enabled === false)).toBe(true); // …but disabled
  });

  test('SC-014 — with standing > 0 the rows are still requested', () => {
    // The reverse half of the previous one: "do not load" applies to an EMPTY set,
    // not to a zero total. Otherwise standing children would become invisible.
    layeredCalls.length = 0;
    render(
      <Wrapper>
        <EpicProgressSection
          issue={rollup({
            totalChildren: 0,
            closedChildren: 0,
            openChildren: 0,
            inProgressChildren: 0,
            standingChildren: 2,
          })}
        />
      </Wrapper>,
    );
    expect(layeredCalls.some((a) => a.enabled === true)).toBe(true);
  });

  test('SC-011 / INV-5 — the query goes only by hierarchical links and without the lens', () => {
    layeredCalls.length = 0;
    render(
      <Wrapper>
        <EpicProgressSection issue={rollup()} />
      </Wrapper>,
    );
    expect(layeredCalls.length).toBeGreaterThan(0);

    // sk-421.2 T022 — there are TWO shapes: the "List" asks for depth 1, the "Tree" — for a
    // full walk without it (R-7). The key sets are ENUMERATED, not
    // checked for "contains at least": weakened to inclusion, the lens field
    // would slip through silently, and the guard would stop guarding the
    // one thing it was written for.
    //
    // sk-421.2.8 T011 (line 28) — both shapes got `includeBlockers`, and
    // in both calls it is true: the blockers sub-row is in BOTH modes
    // (US-1, D-2). The list is still exact — the lens does not slip through.
    // sk-460.12 — ONE shape. Before, there were two, and they differed in exactly the
    // depth: the "List" asked for `maxDepth: 1`. The coverage is aligned, the set of the
    // modes is shared, so the query is one — and `maxDepth` vanished from the shape
    // altogether, rather than becoming optional.
    const SHAPE = ['enabled', 'includeBlockers', 'project', 'rootId', 'types'];
    for (const args of layeredCalls) {
      expect(args.types).toEqual(['parent-child']);
      expect(Object.keys(args).sort()).toEqual(SHAPE);
      expect(args.includeBlockers).toBe(true);
    }

    // No call carries a depth. The assertion is negative and
    // intentionally so: "one shape" would also pass on a call tree where the
    // depth moved to another field.
    expect(layeredCalls.every((a) => a.maxDepth === undefined)).toBe(true);
    expect(layeredCalls.length).toBeGreaterThan(0);
  });

  test('R-3 / sk-460.12 — the query is cross-project and WITHOUT a depth limit', () => {
    render(
      <Wrapper>
        <EpicProgressSection issue={rollup()} />
      </Wrapper>,
    );
    // The cross-project variant (project === null): tree visibility equals the
    // caller's horizon, otherwise visible children from OTHER projects would arrive
    // as stubs and the list would declare "no access" (INV-7).
    expect(
      layeredCalls.some((a) => a.project === null && a.maxDepth === undefined),
    ).toBe(true);
    // sk-460.12 — there is NO queue with a depth any more. Before, there were two, and
    // the "List" went for the first level; the coverage is aligned with the "Tree", and
    // there is nothing and no reason to ask for a truncated walk.
    expect(layeredCalls.some((a) => a.maxDepth === 1)).toBe(false);
  });

  test('R-8 / INV-7 — an inaccessible child stays as a "no access" row', () => {
    // The earlier `!isReference` selection threw out both kinds of reference
    // rows. The stub must stay: hiding it would mean the tail
    // "inaccessible W" points to children that are nowhere.
    layeredState.tree = [
      childNode('sk-42.1'),
      childNode('hidden-1', { status: '', type: '' }, { isReference: true }),
    ];
    const { container } = render(
      <Wrapper>
        <EpicProgressSection issue={rollup({ unavailableChildren: 1 })} />
      </Wrapper>,
    );
    // sk-421.3 T02 — "a section row", not "a direct child of this `ul`".
    expect(container.querySelectorAll('[data-epic-row]')).toHaveLength(2);
    expect(screen.getByText('no access')).toBeTruthy();
  });

  test('US-2 — a repeated occurrence of a node (not a stub) is not shown', () => {
    layeredState.tree = [
      childNode('sk-42.1'),
      childNode('sk-42.2', {}, { isReference: true, firstSeenAt: 'sk-9' }),
    ];
    const { container } = render(
      <Wrapper>
        <EpicProgressSection issue={rollup()} />
      </Wrapper>,
    );
    // sk-421.3 T02 — "a section row", not "a direct child of this `ul`".
    expect(container.querySelectorAll('[data-epic-row]')).toHaveLength(1);
  });

  test('sk-460.12 — the "List" shows ALL rows of the walk, not the first level', () => {
    // This test asserted the OPPOSITE: that the list itself cuts off the first
    // level, even when it received a full walk ("INV-8 — an old server
    // ignores the depth"). The maintainers' decision of 2026-09-18 lifted both the
    // depth query and this cut: the modes are built from one set.
    layeredState.tree = [
      childNode('sk-42.1'),
      childNode('sk-42.1.1', {}, { depth: 2, parentRef: { id: 'sk-42.1', edgeType: 'parent-child' } }),
    ];
    const { container } = render(
      <Wrapper>
        <EpicProgressSection issue={rollup()} />
      </Wrapper>,
    );
    // Both rows: a direct child AND a grandchild. Before, there was a one here.
    expect(container.querySelectorAll('[data-epic-row]')).toHaveLength(2);
    // The grandchild is not merely counted but visible by id — otherwise a two
    // would also match two direct children, proving nothing.
    expect(screen.getByText('sk-42.1.1')).toBeTruthy();
  });

  test('SC-005 — "too large" denial: its own message, counters in place', () => {
    layeredState.tooLarge = true;
    render(
      <Wrapper>
        <EpicProgressSection issue={rollup()} />
      </Wrapper>,
    );
    expect(screen.getByText('Too many child issues')).toBeTruthy();
    // The shared text of the Tasks column advises narrowing the filters — the epic
    // card has no filters, and this advice must not be here.
    expect(screen.queryByText(/Narrow the filter set/i)).toBeNull();
    // Counters do not vanish on denial (INV-7 names the denial an exception).
    expect(screen.getByText(/Done 3/)).toBeTruthy();
  });

  test('row loading error: its own message, counters in place', () => {
    layeredState.error = new Error('boom');
    render(
      <Wrapper>
        <EpicProgressSection issue={rollup()} />
      </Wrapper>,
    );
    expect(screen.getByText('Failed to load children')).toBeTruthy();
    expect(screen.getByText(/Done 3/)).toBeTruthy();
  });

  test('SC-009 — a summary from an old server without the new fields renders without errors', () => {
    // BASE_EPIC.epic is the shape of an old server: no deferred, no
    // inaccessible, no standing. No tails, the section is intact.
    render(
      <Wrapper>
        <EpicProgressSection issue={BASE_EPIC} />
      </Wrapper>,
    );
    expect(screen.getByText(/Done 1/)).toBeTruthy();
    expect(screen.getByText(/Not done 7/)).toBeTruthy();
    expect(screen.queryByText(/deferred/i)).toBeNull();
    expect(screen.queryByText(/unavailable/i)).toBeNull();
  });
});

describe('sk-421.2 T022 — mode toggle, collapsed state, focus', () => {
  test('SC-014 — with a zero set there is NO toggle', () => {
    const { container } = render(
      <Wrapper>
        <EpicProgressSection
          issue={rollup({
            totalChildren: 0,
            closedChildren: 0,
            openChildren: 0,
            inProgressChildren: 0,
            standingChildren: 0,
          })}
        />
      </Wrapper>,
    );
    expect(container.querySelector('[role="radiogroup"]')).toBeNull();
  });

  test('with a non-empty set the toggle exists and is named', () => {
    const { container } = render(
      <Wrapper>
        <EpicProgressSection issue={rollup()} />
      </Wrapper>,
    );
    const group = container.querySelector('[role="radiogroup"]');
    expect(group).not.toBeNull();
    // The group is named: the screen reader announces WHAT is being toggled, not just
    // the selected option.
    expect(group!.getAttribute('aria-label')).toBe('Children view mode');
  });

  test('US-2 — the selected mode is announced, "List" by default', () => {
    render(
      <Wrapper>
        <EpicProgressSection issue={rollup()} />
      </Wrapper>,
    );
    expect(screen.getByRole('radio', { name: 'List' }).getAttribute('aria-checked'))
      .toBe('true');
    expect(screen.getByRole('radio', { name: 'Tree' }).getAttribute('aria-checked'))
      .toBe('false');
  });

  test('switching to "Tree" changes the announced mode', () => {
    render(
      <Wrapper>
        <EpicProgressSection issue={rollup()} />
      </Wrapper>,
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Tree' }));
    expect(screen.getByRole('radio', { name: 'Tree' }).getAttribute('aria-checked'))
      .toBe('true');
    expect(screen.getByRole('radio', { name: 'List' }).getAttribute('aria-checked'))
      .toBe('false');
  });

  test('R-7 — the queue of only the active mode is enabled', () => {
    layeredCalls.length = 0;
    render(
      <Wrapper>
        <EpicProgressSection issue={rollup()} />
      </Wrapper>,
    );
    // sk-460.12 — the queue is ONE and enabled regardless of the mode: the set of
    // rows is shared by the modes, so the "queue of the inactive mode" for the
    // sake of which this test existed has ceased to exist.
    expect(layeredCalls.length).toBeGreaterThan(0);
    expect(layeredCalls.every((a) => a.enabled === true)).toBe(true);
    expect(layeredCalls.every((a) => a.maxDepth === undefined)).toBe(true);

    // And a mode switch does not introduce a second query shape — exactly this
    // is what "one cache record for both modes" means.
    const before = layeredCalls.length;
    fireEvent.click(screen.getByRole('radio', { name: 'Tree' }));
    for (const args of layeredCalls.slice(before)) {
      expect(args.maxDepth).toBeUndefined();
      expect(args.enabled).toBe(true);
    }
  });

  test('the collapsed state survives "Tree → List → Tree"', () => {
    // A node with a child: it can be collapsed.
    layeredState.tree = [
      childNode('sk-42.1'),
      childNode('sk-42.1.1', {}, {
        depth: 2,
        parentRef: { id: 'sk-42.1', edgeType: 'parent-child' },
      }),
    ];
    const { container } = render(
      <Wrapper>
        <EpicProgressSection issue={rollup()} />
      </Wrapper>,
    );

    fireEvent.click(screen.getByRole('radio', { name: 'Tree' }));
    // The tree is expanded in full: the grandchild is visible.
    expect(container.querySelectorAll('[role="treeitem"]')).toHaveLength(2);

    // Collapse the parent.
    fireEvent.click(container.querySelector('.epic-tree-chevron')!);
    expect(container.querySelectorAll('[role="treeitem"]')).toHaveLength(1);

    // We go to the "List" and come back — the collapsed state must survive.
    // because it lives in the SECTION, not in the tree (the tree is unmounted).
    fireEvent.click(screen.getByRole('radio', { name: 'List' }));
    expect(container.querySelector('[role="tree"]')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'Tree' }));
    expect(container.querySelectorAll('[role="treeitem"]')).toHaveLength(1);
  });
});

// ───────────── sk-421.2 · fixes for the findings of the wave B/2 and B/1 review ─────────────

describe('INV-8 — a server without the standing-children field', () => {
  /** A summary from an OLD server: there is no `standingChildren` key at all. */
  const LEGACY = {
    ...BASE_EPIC,
    epic: {
      totalChildren: 0,
      closedChildren: 0,
      openChildren: 0,
      inProgressChildren: 0,
      blockedChildren: 0,
      eligibleForClose: false,
    },
  } as unknown as IssueDetail;

  test('the rows query IS sent, and "no child tasks" is not printed', () => {
    // An epic all of whose children are standing: per sk-118 the server does not count them in
    // the total, and does not send the standing field at all. `?? 0` glued "no
    // field" together with "zero standing" — the query was not sent, and the section claimed that
    // there were no children while standing above the rows.
    layeredState.tree = [childNode('sk-42.1')];
    const { container } = render(
      <Wrapper>
        <EpicProgressSection issue={LEGACY} />
      </Wrapper>,
    );
    // sk-460.12 — the queue is one, there is no depth in it; the gate is still the same.
    expect(layeredCalls.some((a) => a.enabled === true)).toBe(true);
    // The claim "no children" is a lie with a non-empty response.
    expect(container.querySelector('.col-empty')).toBeNull();
    // And there is something to toggle.
    expect(container.querySelector('[role="radiogroup"]')).not.toBeNull();
  });

  test('the field ARRIVED and equals zero — the former behaviour is intact (SC-014)', () => {
    // Negative control: it is the PRESENCE of the field that matters, not its
    // value. Otherwise the fix would simply have turned the gate off.
    const { container } = render(
      <Wrapper>
        <EpicProgressSection
          issue={rollup({
            totalChildren: 0,
            closedChildren: 0,
            openChildren: 0,
            inProgressChildren: 0,
            standingChildren: 0,
          })}
        />
      </Wrapper>,
    );
    // sk-460.12 — the negative control is intact: the field ARRIVED and equals zero,
    // so there is nothing to load and the only queue is disabled.
    expect(layeredCalls.length).toBeGreaterThan(0);
    expect(layeredCalls.every((a) => a.enabled === false)).toBe(true);
    expect(container.querySelector('.col-empty')).not.toBeNull();
  });
});

describe('SC-015 — the shown response is older than the section event', () => {
  test('a re-read is triggered, and by the key of the ACTIVE mode', () => {
    const spy = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
    layeredState.tree = [childNode('sk-42.1')];
    // The response was requested at 1000, the section event arrived at 2000 — what is shown
    // is stale, although the request could have returned later than the event.
    layeredState.requestedAt = 1000;
    markEpicSectionEvent(2000);

    const epic = rollup();
    render(
      <Wrapper>
        <EpicProgressSection issue={epic} />
      </Wrapper>,
    );

    // sk-421.2.8 line 29 — tightened from the prefix `['issues','tree']` to
    // DEEP equality with the key that the active mode reads: the same
    // builder, the same depth and the same blockers flag as in the section
    // query (T011). The prefix stayed green even on an invalidation of a key
    // without the flag — someone else's record, which the section does not read.
    const invalidatedKeys = () =>
      spy.mock.calls
        .map((c) => (c[0] as { queryKey?: unknown })?.queryKey)
        .filter((key): key is unknown[] => Array.isArray(key));

    // sk-460.12 — ONE key for both modes: there is no depth in the query any more,
    // so there is none in the key. Before, the test compared TWO keys and required
    // the invalidation to follow the active mode.
    const key = layeredTreeQueryKey(null, epic.id, ['parent-child'], undefined, true);
    expect(invalidatedKeys()).toContainEqual(key);

    // A key with a depth does not exist at all — no call touches it.
    // The assertion is negative: without it "contains the needed key" would pass
    // even on a section that also hits someone else's cache record
    // that nobody reads.
    const legacyListKey = layeredTreeQueryKey(null, epic.id, ['parent-child'], 1, true);
    expect(invalidatedKeys()).not.toContainEqual(legacyListKey);

    // A mode switch does not introduce a second key: the cache record is shared.
    spy.mockClear();
    fireEvent.click(screen.getByRole('radio', { name: 'Tree' }));
    expect(invalidatedKeys()).not.toContainEqual(legacyListKey);
    spy.mockRestore();
  });

  test('the response is NEWER than the event — no re-read', () => {
    // Negative control: without it an effect that re-reads
    // always would be green too.
    const spy = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
    layeredState.tree = [childNode('sk-42.1')];
    markEpicSectionEvent(2000);
    layeredState.requestedAt = 3000;

    render(
      <Wrapper>
        <EpicProgressSection issue={rollup()} />
      </Wrapper>,
    );

    const treeKeyCall = spy.mock.calls.find((c) => {
      const key = (c[0] as { queryKey?: unknown })?.queryKey;
      return Array.isArray(key) && key[0] === 'issues' && key[1] === 'tree';
    });
    expect(treeKeyCall).toBeUndefined();
    spy.mockRestore();
  });
});

// ───────── sk-421.2.8 line 35 — US-1 Unchanged: the lens and the blockers field ─────────
//
// The epic section deliberately does not read the "My-assigned mode" lens (the exception is deliberate, US-1 Unchanged):
// blockers are a property of the task, not of the selection. And the sub-row is an ADDITION under the row: the number and order of
// rows, the status highlight and the progress summary do not depend on the field.

/** The lens is set by the address (`?lens=delegated`), as in the app. */
function LensWrapper({ path, children }: { path: string; children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return (
    <MantineProvider forceColorScheme="dark">
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>
          <LayoutProvider>{children}</LayoutProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>
  );
}

/** Shows which lens the provider has actually enabled. */
function LensProbe() {
  const { outboxMode } = useLayoutState();
  return <span data-testid="lens-probe">{String(outboxMode)}</span>;
}

const SUBLINE_BLOCKERS: TreeBlockerRef[] = [
  { id: 'sk-7', title: 'A7', status: 'open', projectId: 'proj-a' },
  { id: 'q-1', redacted: true },
  { id: 'sk-8', title: 'A8', status: 'in_progress', projectId: 'proj-a' },
  { id: 'sk-9', title: 'A9', status: 'deferred', projectId: 'proj-a' },
];

/** The "List" response: two blocked children with the field and one free one. */
function treeWithField(): IssueTreeNode[] {
  return [
    childNode('sk-42.1', { isBlocked: true }, { blockers: SUBLINE_BLOCKERS }),
    childNode('sk-42.2'),
    childNode(
      'sk-42.3',
      { status: 'deferred', isBlocked: true },
      { blockers: [SUBLINE_BLOCKERS[0]] },
    ),
  ];
}

/** The same response without the field — like a server that did not send it. */
function withoutField(rows: IssueTreeNode[]): IssueTreeNode[] {
  return rows.map(({ blockers: _drop, ...rest }) => rest);
}

const ROLLUP_35 = {
  totalChildren: 3,
  closedChildren: 0,
  openChildren: 2,
  inProgressChildren: 0,
  blockedChildren: 1,
  deferredChildren: 1,
};

describe('sk-421.2.8 line 35 — the sub-row does not depend on the lens, rows and summary do not change', () => {
  test('outboxMode off and on — the same sub-row', () => {
    const sublines = (path: string, lensOn: boolean) => {
      layeredState.tree = treeWithField();
      const view = render(
        <LensWrapper path={path}>
          <LensProbe />
          <EpicProgressSection issue={rollup(ROLLUP_35)} />
        </LensWrapper>,
      );
      // The harness really did enable (or not enable) the lens — otherwise
      // comparing two identical renders would prove nothing.
      expect(view.getByTestId('lens-probe').textContent).toBe(String(lensOn));
      const html = Array.from(view.container.querySelectorAll('.epic-child-blockers')).map(
        (el) => el.outerHTML,
      );
      view.unmount();
      return html;
    };

    const off = sublines('/', false);
    const on = sublines('/?lens=delegated', true);
    expect(off).toHaveLength(2);
    expect(on).toEqual(off);
  });

  test('a response with the field and without it — the same rows, order, highlight and summary', () => {
    const snapshot = (rows: IssueTreeNode[]) => {
      layeredState.tree = rows;
      const view = render(
        <Wrapper>
          <EpicProgressSection issue={rollup(ROLLUP_35)} />
        </Wrapper>,
      );
      const c = view.container;
      const result = {
        rows: Array.from(c.querySelectorAll('.epic-children-list > li')).map((li) => ({
          name: li.querySelector('.epic-child-open')?.getAttribute('aria-label') ?? null,
          row: li.querySelector('.epic-children-row')?.textContent ?? null,
          highlighted: li.querySelector('.epic-children-row .is-blocked') !== null,
        })),
        counters: c.querySelector('.epic-progress-counters')?.textContent ?? null,
        bar: c.querySelector('[role="progressbar"]')?.getAttribute('aria-valuetext') ?? null,
        sublines: c.querySelectorAll('.epic-child-blockers').length,
      };
      view.unmount();
      return result;
    };

    const withIt = snapshot(treeWithField());
    const without = snapshot(withoutField(treeWithField()));

    // Harness guard: the sub-row is really there with the field and absent without it.
    expect(withIt.sublines).toBe(2);
    expect(without.sublines).toBe(0);

    expect(withIt.rows.map((r) => r.row)).toHaveLength(3);
    expect(withIt.rows).toEqual(without.rows);
    expect(withIt.rows.map((r) => r.highlighted)).toEqual([true, false, true]);
    expect(withIt.counters).toBe(without.counters);
    expect(withIt.bar).toBe(without.bar);
  });

  // sk-421.3 T06 — a second comparison of THE SAME kind: grouping on
  // versus off. Without it INV-2 ("the composition does not change") has no
  // executor at the render level: the comparison above takes both runs with the
  // SAME grouping and therefore says nothing about it.
  describe('sk-421.3 T06 — grouping does not change the composition of rows', () => {
    const GROUPING_KEY = `skein.epic.sectionGrouping.${mockUser.id}`;

    afterEach(() => window.localStorage.removeItem(GROUPING_KEY));

    const snapshotAt = (grouping: 'on' | 'off') => {
      window.localStorage.setItem(GROUPING_KEY, grouping);
      layeredState.tree = treeWithField();
      layeredCalls.length = 0;
      const view = render(
        <Wrapper>
          <EpicProgressSection issue={rollup(ROLLUP_35)} />
        </Wrapper>,
      );
      const c = view.container;
      const result = {
        grouped: c.querySelector('.epic-children-groups') !== null,
        rows: Array.from(c.querySelectorAll('[data-epic-row]')).map((li) => ({
          name: li.querySelector('.epic-child-open')?.getAttribute('aria-label') ?? null,
          highlighted: li.querySelector('.epic-children-row .is-blocked') !== null,
        })),
        counters: c.querySelector('.epic-progress-counters')?.textContent ?? null,
        sublines: c.querySelectorAll('.epic-child-blockers').length,
        calls: layeredCalls.map((a) => JSON.stringify(a)),
      };
      view.unmount();
      return result;
    };

    test('on versus off — the same composition of rows and the same highlight', () => {
      const on = snapshotAt('on');
      const off = snapshotAt('off');

      // Harness guard: grouping REALLY toggled. Without it
      // the "composition is the same" comparison is green also when both halves are the same
      // because grouping was never turned on.
      expect(on.grouped, 'grouping did not turn on').toBe(true);
      expect(off.grouped, 'grouping did not turn off').toBe(false);

      // The composition — as a multiset: the order under grouping is different, and
      // that is its right (INV-2 speaks of the composition, not of the order).
      const byName = (a: { name: string | null }, b: { name: string | null }) =>
        String(a.name).localeCompare(String(b.name));
      expect([...on.rows].sort(byName)).toEqual([...off.rows].sort(byName));
      expect(on.rows).toHaveLength(off.rows.length);
      expect(on.sublines).toBe(off.sublines);
      expect(on.counters).toBe(off.counters);
    });

    /**
     * sk-481 — the same INV-2, but on a MULTI-LEVEL subtree.
     *
     * After sk-460.12 the "List" is built from the whole subtree walk, while all
     * the earlier inputs of the composition comparison (above) and P-22 are only direct children.
     * So the branch `EpicChildrenList.tsx#if (!grouped)`, which cuts off everything
     * deeper than the first level, passed the whole suite. Here the fixture has
     * rows of depth 2 and 3 with different statuses (under grouping they
     * scatter over different categories), and the composition is checked not only
     * "on = off" but also against the EXPECTED list: equality of the two halves
     * is green also when both lost the same thing.
     */
    test('sk-481 — multi-level subtree: on and off — one composition, depth ≥ 2 in place', () => {
      const deep = (id: string, parent: string, depth: number, status: string) =>
        childNode(id, { status } as Partial<IssueTreeRowItem>, {
          depth,
          parentRef: { id: parent, edgeType: 'parent-child' },
        });
      const tree = [
        childNode('sk-42.1'),
        deep('sk-42.1.1', 'sk-42.1', 2, 'in_progress'),
        deep('sk-42.1.1.1', 'sk-42.1.1', 3, 'closed'),
        childNode('sk-42.2', { status: 'deferred' }),
        deep('sk-42.2.1', 'sk-42.2', 2, 'closed'),
      ];
      const EXPECTED = ['sk-42.1', 'sk-42.1.1', 'sk-42.1.1.1', 'sk-42.2', 'sk-42.2.1'];

      const idsAt = (grouping: 'on' | 'off') => {
        window.localStorage.setItem(GROUPING_KEY, grouping);
        layeredState.tree = tree;
        const view = render(
          <Wrapper>
            <EpicProgressSection issue={rollup(ROLLUP_35)} />
          </Wrapper>,
        );
        const c = view.container;
        const result = {
          grouped: c.querySelector('.epic-children-groups') !== null,
          // the row id — from the identifier badge inside its button.
          ids: Array.from(
            c.querySelectorAll('[data-epic-row] .epic-child-open .issue-id-badge'),
          ).map((b) => b.textContent ?? ''),
        };
        view.unmount();
        return result;
      };

      const on = idsAt('on');
      const off = idsAt('off');
      expect(on.grouped, 'grouping did not turn on').toBe(true);
      expect(off.grouped, 'grouping did not turn off').toBe(false);

      // Grouping off — the server walk order in full.
      expect(off.ids, 'the disabled grouping lost the rows deeper than the first level').toEqual(
        EXPECTED,
      );
      // On — the same composition (the order under grouping is its own, INV-2
      // speaks of the composition).
      expect([...on.ids].sort()).toEqual([...EXPECTED].sort());
    });

    test('P-80 — the control stands AFTER the rows, the mode toggle — before them', () => {
      layeredState.tree = treeWithField();
      const { container } = render(
        <Wrapper>
          <EpicProgressSection issue={rollup(ROLLUP_35)} />
        </Wrapper>,
      );
      // sk-460.1 — the order is computed by the TREE WALK, not by the list
      // of direct children of `.epic-progress`, as it was before.
      //
      // The reason is that the P-80 claim was never about direct
      // children: it is about the reader meeting the toggle before the
      // rows, and the control after. While all three lay in one plane,
      // "a direct child" and "earlier in the document" coincided. The sk-460.1
      // footer gathered the control and the button into its own row, and the coincidence
      // ended: by direct children the control would have been NOT found
      // (`findIndex` → −1), and the check "rows before the control" would have passed
      // the other way round — i.e. it would have gone green on a markup where the control was not
      // put into the section at all.
      //
      // `querySelectorAll('*')` returns the nodes in document order, so
      // the nesting of the control in the footer row stops meaning anything, and
      // the claim itself stays the same.
      const root = container.querySelector('.epic-progress')!;
      const all = Array.from(root.querySelectorAll('*'));
      const at = (cls: string) => all.findIndex((k) => k.classList.contains(cls));

      const switchAt = at('epic-mode-switch');
      const rowsAt = Math.max(at('epic-children-groups'), at('epic-children-list'));
      const organAt = at('epic-group-toggle');

      expect(switchAt, 'there is no mode toggle').toBeGreaterThanOrEqual(0);
      expect(rowsAt, 'there are no rows').toBeGreaterThanOrEqual(0);
      expect(organAt, 'there is no grouping control').toBeGreaterThanOrEqual(0);
      expect(switchAt).toBeLessThan(rowsAt);
      expect(rowsAt).toBeLessThan(organAt);
    });

    describe('sk-460.1 — the section footer: one row, the button on the left, the control on the right', () => {
      const foot = (c: HTMLElement) => c.querySelector<HTMLElement>('.epic-progress-foot');

      test('both the add button and the control lie in ONE footer row', () => {
        // The essence of the design fix: before, these were two independent blocks
        // standing one under the other. The check is exactly for a common parent, not
        // for "both exist": they existed before the footer too.
        layeredState.tree = treeWithField();
        const { container } = render(
          <Wrapper>
            <EpicProgressSection issue={rollup(ROLLUP_35)} />
          </Wrapper>,
        );

        const row = foot(container);
        expect(row, 'there is no footer row').not.toBeNull();
        expect(
          row!.querySelector('.epic-add-child-toggle'),
          'the add button stayed outside the footer row',
        ).not.toBeNull();
        expect(
          row!.querySelector('.epic-group-toggle'),
          'the grouping control stayed outside the footer row',
        ).not.toBeNull();
      });

      test('in the markup the button goes BEFORE the control — as on screen', () => {
        // The design draws the button on the left, the control on the right. The control is pushed to the right by
        // `margin-left: auto`, i.e. the visual order coincides with
        // the markup order — and must coincide: swapping them via
        // `order`, leaving the markup as it was, would pull the keyboard traversal
        // apart from the reading with the eyes (WCAG 1.3.2, 2.4.3).
        //
        // The check catches exactly that edit: a swap of two nodes inside
        // the row, where both stay in place and both are visible.
        layeredState.tree = treeWithField();
        const { container } = render(
          <Wrapper>
            <EpicProgressSection issue={rollup(ROLLUP_35)} />
          </Wrapper>,
        );

        const kids = Array.from(foot(container)!.children);
        const idx = (cls: string) => kids.findIndex((k) => k.classList.contains(cls));
        expect(idx('epic-add-child-toggle')).toBeGreaterThanOrEqual(0);
        expect(idx('epic-group-toggle')).toBeGreaterThanOrEqual(0);
        expect(idx('epic-add-child-toggle')).toBeLessThan(idx('epic-group-toggle'));
      });

      test('in the "Tree" the collapse control lies in the same row', () => {
        // The second mode — the second control, and they share the row. Without this
        // check the footer would be proven only for the "List".
        //
        // The tree is taken NESTED, and this is not decoration of the harness. The collapse
        // control is gated on the presence of expandable nodes, and
        // `treeWithField()` returns three leaves of ONE depth: on it there is
        // rightly no control, and the check would go red on a markup that is correct.
        // Verified: on a flat tree this test failed exactly that way.
        layeredState.tree = [
          childNode('sk-42.1'),
          childNode(
            'sk-42.1.1',
            {},
            { depth: 2, parentRef: { id: 'sk-42.1', edgeType: 'parent-child' } },
          ),
        ];
        const { container } = render(
          <Wrapper>
            <EpicProgressSection issue={rollup(ROLLUP_35)} />
          </Wrapper>,
        );
        fireEvent.click(screen.getByRole('radio', { name: 'Tree' }));

        const row = foot(container);
        expect(row, 'there is no footer row').not.toBeNull();
        expect(
          row!.querySelector('.epic-collapse-toggle'),
          'there is no collapse control in the footer row — either it is outside the row, or ' +
            'the harness gave no expandable node',
        ).not.toBeNull();
        expect(
          row!.querySelector('.epic-add-child-toggle'),
          'the add button stayed outside the footer row',
        ).not.toBeNull();
      });
    });

    describe('sk-460.2 — the header: the ring with the caption on the left, the toggle on the right', () => {
      const head = (c: HTMLElement) => c.querySelector<HTMLElement>('.epic-progress-head');

      test('the mode toggle lies IN THE HEADER, not in a row under it', () => {
        // The essence of the design fix. Before, `.epic-mode-switch` was the section's own
        // row with its own top margin; the check "it exists"
        // would be green then too,
        // so exactly the parent is asked.
        layeredState.tree = treeWithField();
        const { container } = render(
          <Wrapper>
            <EpicProgressSection issue={rollup(ROLLUP_35)} />
          </Wrapper>,
        );

        const bar = head(container);
        expect(bar, 'there is no header').not.toBeNull();
        expect(
          bar!.querySelector('.epic-mode-switch'),
          'the toggle stayed outside the header',
        ).not.toBeNull();
      });

      test('the ring and the caption are one block, the toggle goes AFTER it', () => {
        // The design holds the ring with the caption as a single group at the left edge, and
        // the toggle at the right; it is pushed right by the header's `space-between`,
        // i.e. the markup order coincides with the on-screen order.
        //
        // The ring and the counters are checked INSIDE the group, not merely inside
        // the header: without the wrapper they would become the third and fourth items
        // of a row with two edges and spread over it — the very thing the
        // wrapper was introduced for.
        layeredState.tree = treeWithField();
        const { container } = render(
          <Wrapper>
            <EpicProgressSection issue={rollup(ROLLUP_35)} />
          </Wrapper>,
        );

        const bar = head(container)!;
        const line = bar.querySelector('.epic-progress-headline');
        expect(line, 'there is no "ring + caption" block').not.toBeNull();
        expect(line!.querySelector('.epic-ring'), 'the ring is outside the block').not.toBeNull();
        expect(
          line!.querySelector('.epic-progress-counters'),
          'the caption is outside the block',
        ).not.toBeNull();

        const kids = Array.from(bar.children);
        const idx = (cls: string) => kids.findIndex((k) => k.classList.contains(cls));
        expect(idx('epic-progress-headline')).toBeGreaterThanOrEqual(0);
        expect(idx('epic-mode-switch')).toBeGreaterThanOrEqual(0);
        expect(idx('epic-progress-headline')).toBeLessThan(idx('epic-mode-switch'));
      });

      test('sk-460.6 — the heading stands NEXT TO THE RING and is the only one in the section', () => {
        // The design puts the heading with the caption as a column
        // to the right of the ring, inside the same group. Before, the shared
        // `Section` printed it as a separate line ABOVE the header.
        layeredState.tree = treeWithField();
        const { container } = render(
          <Wrapper>
            <EpicProgressSection issue={rollup(ROLLUP_35)} />
          </Wrapper>,
        );

        const line = container.querySelector('.epic-progress-headline')!;
        const column = line.querySelector('.epic-progress-headtext');
        expect(column, 'there is no "heading + caption" column').not.toBeNull();

        // The heading is a REAL `<h2>`: screen readers walk the document
        // structure, and a styled `<span>` would pull the section out of
        // the card's table of contents.
        const heading = column!.querySelector('h2');
        expect(heading, 'the heading stopped being a heading').not.toBeNull();
        expect(heading!.textContent).toBe('Epic progress');
        expect(
          screen.getAllByRole('heading', { name: 'Epic progress' }),
          'the heading is not the only one on screen',
        ).toHaveLength(1);

        // The caption is under the heading, in the same column, and the ring is outside it,
        // on the left: otherwise "next to the ring" would be achieved by nesting, not
        // by layout.
        expect(column!.querySelector('.epic-progress-counters')).not.toBeNull();
        expect(column!.querySelector('.epic-ring'), 'the ring got inside the column').toBeNull();
        const kids = Array.from(line.children);
        expect(kids.findIndex((k) => k.classList.contains('epic-ring'))).toBeLessThan(
          kids.findIndex((k) => k.classList.contains('epic-progress-headtext')),
        );

        // And no counter from the heading is left anywhere in the section.
        expect(container.querySelector('.detail-section-count')).toBeNull();
      });
    });

    test('the control toggles grouping and its label reflects the ACTION', () => {
      layeredState.tree = treeWithField();
      const { container } = render(
        <Wrapper>
          <EpicProgressSection issue={rollup(ROLLUP_35)} />
        </Wrapper>,
      );
      const organ = () => container.querySelector<HTMLButtonElement>('.epic-group-toggle')!;

      // The default — grouping is on (A1), so the action right now is
      // "do not group".
      expect(container.querySelector('.epic-children-groups')).not.toBeNull();
      expect(organ().getAttribute('aria-pressed')).toBe('true');
      expect(organ().textContent).toBe('Ungroup');

      fireEvent.click(organ());

      expect(container.querySelector('.epic-children-groups')).toBeNull();
      expect(container.querySelectorAll('.epic-children-list')).toHaveLength(1);
      expect(organ().getAttribute('aria-pressed')).toBe('false');
      expect(organ().textContent).toBe('Group by status');
    });

    test('P-81 — the control is NOT part of the fallback focus target chain', () => {
      // The US-9 chain ends with the mode toggle, otherwise the
      // "Add child" button. When all rows disappear the control disappears
      // with them, and cannot be a target.
      layeredState.tree = [childNode('sk-42.1')];
      const view = render(
        <Wrapper>
          <EpicProgressSection issue={rollup(ROLLUP_35)} />
        </Wrapper>,
      );
      expect(view.container.querySelector('.epic-group-toggle')).not.toBeNull();

      layeredState.tree = [];
      view.rerender(
        <Wrapper>
          <EpicProgressSection issue={rollup(ROLLUP_35)} />
        </Wrapper>,
      );

      expect(view.container.querySelector('.epic-group-toggle')).toBeNull();
      expect(
        view.container.querySelector('.epic-mode-switch'),
        'the mode toggle must remain',
      ).not.toBeNull();
    });

    describe('four edge states: no control, everything else in place', () => {
      const CASES: Array<[string, () => void, string]> = [
        ['loading', () => { layeredState.isLoading = true; }, 'Loading children…'],
        ['"too large set" denial', () => { layeredState.tooLarge = true; }, 'Too many child issues'],
        ['refresh error', () => { layeredState.error = new Error('boom'); }, 'Failed to load children'],
        ['empty result', () => { layeredState.tree = []; }, ''],
      ];

      test.each(CASES)('%s', (_name, arrange, message) => {
        layeredState.tree = treeWithField();
        arrange();
        const { container } = render(
          <Wrapper>
            <EpicProgressSection issue={rollup(ROLLUP_35)} />
          </Wrapper>,
        );

        // No control — there is nothing to group…
        expect(container.querySelector('.epic-group-toggle')).toBeNull();
        // …while the counters and the mode toggle did not go anywhere
        // (INV-7 names the denial and the error as explicit exceptions), and
        // the message is in place.
        expect(container.querySelector('.epic-progress-counters')).not.toBeNull();
        expect(container.querySelector('.epic-mode-switch')).not.toBeNull();
        if (message) expect(screen.getByText(message)).toBeTruthy();
      });
    });

    test('P-99 — grouping is not part of the rows query arguments (R-1)', () => {
      // Grouping is a layout of an ALREADY received set. Were it to get into the
      // query arguments, switching would go to the server for the same
      // rows.
      expect(snapshotAt('on').calls).toEqual(snapshotAt('off').calls);
    });
  });
});

// ───────── sk-421.2.8 line 41 (b) — the child is gone: the section fallback target ─────────
//
// The target is performed by the SECTION: the "List" only hands over the request. So the check is
// with a real "List" inside the section: if the "List" hands over the request and the section does not
// handle it, the check goes red.

describe('sk-421.2.8 line 41 (b) — focus on the section fallback target', () => {
  const BLOCKED_CHILD = () =>
    childNode(
      'sk-42.2',
      { isBlocked: true },
      { blockers: [{ id: 'p-1', title: 'P1', status: 'open', projectId: 'proj-b' }] },
    );

  function section() {
    return (
      <Wrapper>
        <EpicProgressSection issue={rollup()} />
      </Wrapper>
    );
  }

  test('(b1) other rows remain → the button of the nearest row above', () => {
    layeredState.tree = [childNode('sk-42.1'), BLOCKED_CHILD(), childNode('sk-42.3')];
    const { rerender } = render(section());
    screen.getByRole('button', { name: 'p-1' }).focus();
    expect(document.activeElement?.textContent).toBe('p-1');

    layeredState.tree = [childNode('sk-42.1'), childNode('sk-42.3')];
    rerender(section());

    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Open child issue sk-42.1: sk-42.1' }),
    );
  });

  test('(b2) no rows left → the mode toggle', () => {
    layeredState.tree = [BLOCKED_CHILD()];
    const { rerender } = render(section());
    screen.getByRole('button', { name: 'p-1' }).focus();

    layeredState.tree = [];
    rerender(section());

    // The summary total is non-zero — the toggle is in place; the focus is on the selected mode.
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'List' }));
  });
});

// ───────── review skein-frontend/4 MAJOR-1 — "Tree": the section fallback target ─────────
//
// Spec US-6: the sub-row element with the focus vanished — focus goes to the child's row, and
// if there is none either — by the sk-421.2 US-2 fallback target rule. No rows left
// at all: the target is outside the tree (the mode toggle, otherwise "Add child"), and
// the section performs it — the same as for the "List" in 41(b2). The check is with a
// real "Tree" inside the section: if the tree hands over the request and the section does not
// handle it (or does not pass the tree a handler), the check goes red.

describe('review skein-frontend/4 MAJOR-1 — "Tree": the sub-row element vanished together with all rows', () => {
  const BLOCKED_CHILD = () =>
    childNode(
      'sk-42.2',
      { isBlocked: true },
      { blockers: [{ id: 'p-1', title: 'P1', status: 'open', projectId: 'proj-b' }] },
    );

  function section(over: Record<string, number | boolean> = {}) {
    return (
      <Wrapper>
        <EpicProgressSection issue={rollup(over)} />
      </Wrapper>
    );
  }

  test('no rows left, the toggle exists → focus on the selected "Tree" mode', () => {
    layeredState.tree = [BLOCKED_CHILD()];
    const { rerender } = render(section());
    fireEvent.click(screen.getByRole('radio', { name: 'Tree' }));
    const link = screen.getByRole('button', { name: 'p-1' });
    expect(link.closest('[role="treeitem"]'), 'the link is not in a "Tree" row').not.toBeNull();
    act(() => link.focus());
    expect(document.activeElement).toBe(link);

    layeredState.tree = [];
    rerender(section());

    // The summary total is non-zero — the toggle is in place; the focus is on the selected mode.
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Tree' }));
  });

  test('no rows left and no toggle → focus on "Add child"', () => {
    // Zero counted children in the summary: the toggle is visible only while the tree
    // carries rows, and vanishes together with them.
    const EMPTY_ROLLUP = {
      totalChildren: 0,
      closedChildren: 0,
      openChildren: 0,
      inProgressChildren: 0,
      standingChildren: 0,
    };
    layeredState.tree = [BLOCKED_CHILD()];
    const { rerender } = render(section(EMPTY_ROLLUP));
    fireEvent.click(screen.getByRole('radio', { name: 'Tree' }));
    const link = screen.getByRole('button', { name: 'p-1' });
    act(() => link.focus());

    layeredState.tree = [];
    rerender(section(EMPTY_ROLLUP));

    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add child' }));
  });
});

// ───────── sk-421.2.8 line 37 — "+N" expansion reset rules (R-11) ─────────
//
// Expansion is the local state of the sub-row: a re-read with the same ids keeps it
// (rows are keyed by id), while collapsing an ancestor, a mode change and
// reopening the card unmount the sub-row and reset it.

describe('sk-421.2.8 line 37 — "+N" expansion reset rules', () => {
  const SUBJECT = 'sk-42.1.1';
  const FIVE: TreeBlockerRef[] = [
    { id: 'p-1', title: 'P1', status: 'open', projectId: 'proj-b' },
    { id: 'q-1', redacted: true },
    { id: 'p-2', title: 'P2', status: 'open', projectId: 'proj-b' },
    { id: 'p-3', title: 'P3', status: 'open', projectId: 'proj-b' },
    { id: 'p-4', title: 'P4', status: 'open', projectId: 'proj-b' },
  ];

  /** Subtree: a first-level parent and a blocked child of depth 2. */
  function subtree(): IssueTreeNode[] {
    return [
      childNode('sk-42.1'),
      childNode(
        SUBJECT,
        { isBlocked: true },
        {
          depth: 2,
          parentRef: { id: 'sk-42.1', edgeType: 'parent-child' },
          blockers: FIVE.map((b) => ({ ...b })),
        },
      ),
    ];
  }

  function section() {
    return (
      <Wrapper>
        <EpicProgressSection issue={rollup()} />
      </Wrapper>
    );
  }

  /** The "+N" of the depth-2 child's sub-row, or null if there is no row. */
  function moreButton(container: HTMLElement): HTMLButtonElement | null {
    const title = Array.from(container.querySelectorAll('.epic-child-title')).find(
      (el) => el.textContent === SUBJECT,
    );
    const row = title?.closest('[role="treeitem"]');
    return (
      Array.from(row?.querySelectorAll<HTMLButtonElement>('.epic-child-blockers-line button') ?? []).find(
        (b) => b.textContent === '+2',
      ) ?? null
    );
  }

  function expandSubject(container: HTMLElement) {
    const more = moreButton(container);
    expect(more, 'the depth-2 child has no "+N"').not.toBeNull();
    fireEvent.click(more!);
    expect(moreButton(container)!.getAttribute('aria-expanded')).toBe('true');
  }

  test('a re-read keeps it; an ancestor, a mode change and reopening the card reset it', () => {
    layeredState.tree = subtree();
    const view = render(section());
    fireEvent.click(screen.getByRole('radio', { name: 'Tree' }));
    expect(view.container.querySelector('[role="tree"]')).not.toBeNull();

    // "+N" is expanded on the depth-2 row.
    expandSubject(view.container);

    // (1) A re-read with the same ids → expanded.
    layeredState.tree = subtree();
    view.rerender(section());
    expect(moreButton(view.container)!.getAttribute('aria-expanded')).toBe('true');

    // (2) Collapse and expand the ancestor → collapsed.
    const parentChevron = () =>
      view.container.querySelector<HTMLButtonElement>('[role="treeitem"] .epic-tree-chevron')!;
    fireEvent.click(parentChevron());
    expect(moreButton(view.container)).toBeNull();
    fireEvent.click(parentChevron());
    expect(moreButton(view.container)!.getAttribute('aria-expanded')).toBe('false');

    // (3) "Tree → List → Tree" → collapsed.
    expandSubject(view.container);
    fireEvent.click(screen.getByRole('radio', { name: 'List' }));
    expect(view.container.querySelector('[role="tree"]')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'Tree' }));
    expect(moreButton(view.container)!.getAttribute('aria-expanded')).toBe('false');

    // (4) Close the epic card and open it again → collapsed (the expansion is not remembered
    // between openings). The "Tree" mode is remembered per user.
    expandSubject(view.container);
    view.unmount();
    const reopened = render(section());
    expect(reopened.container.querySelector('[role="tree"]')).not.toBeNull();
    expect(moreButton(reopened.container)!.getAttribute('aria-expanded')).toBe('false');
  });
});

// ───────── sk-421.3 T16 — bulk collapse (US-6, US-9, SC-009) ─────────
//
// The control lives in the SECTION, while the set of expandable nodes is computed from
// the received tree — so it is checked here, on a real "Tree"
// inside the section: if the tree hands over the rows and the section does not count them, the check
// goes red.

describe('sk-421.3 T16 — the bulk collapse control', () => {
  function section() {
    return (
      <Wrapper>
        <EpicProgressSection issue={rollup()} />
      </Wrapper>
    );
  }

  /** A deep chain: A → A1 → A11, plus a separate leaf. */
  function nested(): IssueTreeNode[] {
    return [
      childNode('sk-42.1'),
      childNode('sk-42.1.1', {}, { depth: 2, parentRef: { id: 'sk-42.1', edgeType: 'parent-child' } }),
      childNode('sk-42.1.1.1', {}, { depth: 3, parentRef: { id: 'sk-42.1.1', edgeType: 'parent-child' } }),
      childNode('sk-42.2'),
    ];
  }

  const organ = (c: HTMLElement) => c.querySelector<HTMLButtonElement>('.epic-collapse-toggle');
  const titles = (c: HTMLElement) =>
    Array.from(c.querySelectorAll('.epic-child-title')).map((el) => el.textContent);

  /** A "Tree" row (`treeitem`) by heading. */
  const rowOf = (c: HTMLElement, title: string): HTMLElement => {
    const el = Array.from(c.querySelectorAll<HTMLElement>('.epic-child-title')).find(
      (t) => t.textContent === title,
    );
    const row = el?.closest<HTMLElement>('[role="treeitem"]') ?? null;
    expect(row, `row ${title} not found`).not.toBeNull();
    return row!;
  };

  /**
   * The heading of the ACTIVE row — the return point for the jump key.
   *
   * In the "Tree" there is one traversal point for the whole tree (roving tabindex), and
   * it is held by the `treeitem` with `tabIndex 0`. Uniqueness is checked
   * right here: two return points are the same defect as none, and
   * a check that takes "the first one that comes along" would not notice it.
   */
  const returnPointTitle = (c: HTMLElement): string | null => {
    const active = Array.from(
      c.querySelectorAll<HTMLElement>('[role="treeitem"]'),
    ).filter((r) => r.getAttribute('tabindex') === '0');
    expect(active, 'the return point into the tree is lost or doubled').toHaveLength(1);
    return active[0].querySelector('.epic-child-title')?.textContent ?? null;
  };
  const chevronOf = (c: HTMLElement, title: string): HTMLButtonElement => {
    const el = Array.from(c.querySelectorAll<HTMLElement>('.epic-child-title')).find(
      (t) => t.textContent === title,
    );
    const btn = el?.closest('[role="treeitem"]')?.querySelector<HTMLButtonElement>(
      '.epic-tree-chevron',
    );
    expect(btn, `row ${title} has no chevron`).toBeTruthy();
    return btn!;
  };

  function mountTree(rows: IssueTreeNode[]) {
    layeredState.tree = rows;
    const view = render(section());
    fireEvent.click(screen.getByRole('radio', { name: 'Tree' }));
    return view;
  }

  test('P-51 — when there are no expandable nodes there is no control', () => {
    const { container } = mountTree([childNode('sk-42.1'), childNode('sk-42.2')]);
    expect(container.querySelector('[role="tree"]'), 'the tree is not rendered').not.toBeNull();
    expect(organ(container), 'the control appeared where there is nothing to collapse').toBeNull();
  });

  test('P-47 — "collapse all" collapses EVERY expandable node, including hidden ones', () => {
    const { container } = mountTree(nested());
    expect(organ(container)!.textContent).toBe('Collapse all');

    fireEvent.click(organ(container)!);
    // The top level is collapsed — only it and the leaf are visible.
    expect(titles(container)).toEqual(['sk-42.1', 'sk-42.2']);

    // The essence of the acceptance: a node HIDDEN under a collapsed ancestor is collapsed too.
    // Expand the ancestor by hand — its descendant must turn out
    // collapsed, not expanded.
    fireEvent.click(chevronOf(container, 'sk-42.1'));
    expect(titles(container)).toEqual(['sk-42.1', 'sk-42.1.1', 'sk-42.2']);
    expect(
      titles(container),
      'a node hidden under a collapsed ancestor was not collapsed by the bulk action',
    ).not.toContain('sk-42.1.1.1');
  });

  test('P-50 — "expand" is offered IF AND ONLY IF everything is collapsed', () => {
    const { container } = mountTree(nested());
    expect(organ(container)!.textContent).toBe('Collapse all');

    // ONE of the two expandable nodes is collapsed — not all yet.
    fireEvent.click(chevronOf(container, 'sk-42.1'));
    expect(
      organ(container)!.textContent,
      'the control offered "expand" although not every node is collapsed',
    ).toBe('Collapse all');

    fireEvent.click(organ(container)!);
    expect(organ(container)!.textContent).toBe('Expand all');
  });

  test('P-49 — "expand all" also expands what was collapsed BY HAND before', () => {
    const { container } = mountTree(nested());
    // The user collapsed a nested node themselves…
    fireEvent.click(chevronOf(container, 'sk-42.1'));
    // …then collapsed all and expanded all.
    fireEvent.click(organ(container)!);
    expect(organ(container)!.textContent).toBe('Expand all');
    fireEvent.click(organ(container)!);

    // No separate memory of manual collapses is kept (PK-3): the tree is
    // expanded IN FULL, including the node collapsed by hand first.
    expect(titles(container)).toEqual([
      'sk-42.1',
      'sk-42.1.1',
      'sk-42.1.1.1',
      'sk-42.2',
    ]);
    expect(organ(container)!.textContent).toBe('Collapse all');
  });

  test('P-48 — the chain "inaccessible row → ordinary parent → leaf"', () => {
    const rows = [
      childNode('hidden-1', { status: '', type: '' }, { isReference: true }),
      childNode('sk-42.9', {}, { depth: 2, parentRef: { id: 'hidden-1', edgeType: 'parent-child' } }),
      childNode('sk-42.9.1', {}, { depth: 3, parentRef: { id: 'sk-42.9', edgeType: 'parent-child' } }),
    ];
    const { container } = mountTree(rows);
    fireEvent.click(organ(container)!);

    // The ordinary parent is collapsed, the leaf is hidden…
    expect(titles(container)).toEqual(['sk-42.9']);
    // …while the stub itself is shown: it cannot be collapsed.
    expect(screen.getByText('no access')).toBeTruthy();
  });

  test('P-55 — a keyboard action leaves the focus ON THE CONTROL', () => {
    // The risk here is real: rows disappear, and the "Tree" has focus
    // restore effects. Were they to take the focus from the control, a repeated
    // press would go into the void.
    const { container } = mountTree(nested());
    const btn = organ(container)!;
    act(() => btn.focus());
    expect(document.activeElement).toBe(btn);

    fireEvent.click(btn);

    expect(document.activeElement, 'the tree took the focus from the control').toBe(
      organ(container),
    );

    // ─── The second half of the US-6 "focus" acceptance (F-08) ────────────────
    //
    // The spec names both halves in one sentence: "the focus stays
    // on the control. THE ACTIVE TREE ROW — the return point for the jump key —
    // is chosen by the shared fallback target rule". Checking
    // `document.activeElement` alone covered exactly the first, and the
    // test-plan critique called it insufficient for precisely that reason.
    //
    // The return point in the "Tree" is the only `treeitem` with `tabIndex 0`
    // (roving tabindex). Bulk collapse takes rows off the screen, and
    // the risk here is real: it could move to a vanished row
    // or disappear altogether — a return by Tab would lead nowhere, and silently.
    expect(returnPointTitle(container), 'the return point points to a row that is gone').toBe(
      'sk-42.1',
    );
  });

  test('M-2 — the return point survived the disappearance of ITS row (US-6, F-08)', () => {
    // The input is a discriminating one, and that is all its value: the row that
    // bulk collapse will take OFF the screen is made active. The check
    // above (the focus stood on the first row, and it stayed) does not
    // cover this — there the fallback target would not be needed even if it
    // were broken.
    const { container } = mountTree(nested());
    const deep = rowOf(container, 'sk-42.1.1.1');
    act(() => deep.focus());
    expect(returnPointTitle(container), 'the row did not become active').toBe('sk-42.1.1.1');

    fireEvent.click(organ(container)!);

    // The row with the focus left the screen…
    expect(titles(container)).toEqual(['sk-42.1', 'sk-42.2']);
    // …and the return point is chosen by the SHARED fallback target rule: the nearest
    // surviving one above the vanished one, i.e. its ancestor.
    expect(
      returnPointTitle(container),
      'the return point is lost or moved to a vanished row',
    ).toBe('sk-42.1');
  });

  test('M-3 — after "*" the control label follows the shared rule (US-6)', () => {
    // The US-6 acceptance demands two things from "*", and the second is about the CONTROL:
    // "…and the control again offers 'collapse'", and the label follows the same
    // rule of the expandable-node set as always.
    //
    // Before, the key was pressed only in `EpicChildrenTree.test.tsx` —
    // on a harness WITHOUT the control (the control belongs to the section) — while the label was
    // checked only here, where "*" was never pressed. The files
    // never met, and the clause was left without a guard.
    const { container } = mountTree(nested());
    expect(organ(container)!.textContent).toBe('Collapse all');

    fireEvent.click(organ(container)!);
    expect(organ(container)!.textContent).toBe('Expand all');
    expect(titles(container)).toEqual(['sk-42.1', 'sk-42.2']);

    // "*" on a row expands its siblings and itself.
    const row = rowOf(container, 'sk-42.1');
    act(() => row.focus());
    fireEvent.keyDown(row, { key: '*' });

    expect(titles(container)).toEqual(['sk-42.1', 'sk-42.1.1', 'sk-42.2']);
    // The control again offers "collapse" — and not because everything is
    // expanded (the node `sk-42.1.1` stayed collapsed), but because not
    // EVERY expandable node is collapsed. This is the same rule as in P-50.
    expect(
      organ(container)!.textContent,
      'the control label did not notice the "*" key',
    ).toBe('Collapse all');
  });

  test('P-80 — the control stands AFTER the rows and disappears together with them', () => {
    const view = mountTree(nested());
    const tree = view.container.querySelector('[role="tree"]')!;
    const btn = organ(view.container)!;
    // DOCUMENT_POSITION_FOLLOWING — the control comes after the tree.
    expect(
      tree.compareDocumentPosition(btn) & Node.DOCUMENT_POSITION_FOLLOWING,
      'the control ended up before the rows',
    ).toBeTruthy();

    // And it cannot become the fallback focus target: no rows — no control.
    //
    // a RE-RENDER of the same section, not a second `render`: a second harness
    // does not cancel the first, both live in one document, and a search over it
    // would find the first one's control — i.e. the check would go red (or, what is
    // worse, green) for a reason unrelated to the subject.
    layeredState.tree = [];
    view.rerender(section());
    expect(organ(view.container), 'the control survived the disappearance of the rows').toBeNull();
  });
});

// ───────── sk-421.3 T15 — the collapsed state belongs to the card (PK-3, SC-016) ─────────
//
// There was NO harness for this in the file, and that is half of the task (finding N-5
// of the test plan). No existing `rerender` here changed `issue.id`
// — it is `demo-32` everywhere — and the only "reopening of the card"
// (:1289) is done THROUGH `unmount()`, i.e. in exactly the opposite way
// to the needed one: an unmounted section loses its collapsed state by itself, and
// such a check would pass even WITHOUT the reset by id. Below the section
// is never unmounted, and this is asserted separately.
//
// The input is DISCRIMINATING (finding F-09): card B has a node with an
// id already lying in card A's collapsed set. Without
// this condition the test would pass on the old code — there "expanded in
// full" held on the non-coincidence of node ids of different
// epics, i.e. on an accident, which T16 cancels.

describe('sk-421.3 T15 — a card change expands the tree in full', () => {
  const GROUPING_KEY = `skein.epic.sectionGrouping.${mockUser.id}`;

  /** The section of ONE card: the identity is set by the id. */
  function section(id: string) {
    return (
      <Wrapper>
        <EpicProgressSection issue={{ ...rollup(), id }} />
      </Wrapper>
    );
  }

  /**
   * A subtree with an expandable node. The ids are DELIBERATELY the same
   * in both cards — that is the discriminating input F-09.
   */
  function sharedSubtree(): IssueTreeNode[] {
    return [
      childNode('shared-1'),
      childNode(
        'shared-1.1',
        {},
        { depth: 2, parentRef: { id: 'shared-1', edgeType: 'parent-child' } },
      ),
    ];
  }

  const titles = (c: HTMLElement) =>
    Array.from(c.querySelectorAll('.epic-child-title')).map((el) => el.textContent);

  test('P-96 — a node collapsed on card A is expanded on card B', () => {
    layeredState.tree = sharedSubtree();
    const view = render(section('demo-32'));
    fireEvent.click(screen.getByRole('radio', { name: 'Tree' }));
    expect(titles(view.container)).toEqual(['shared-1', 'shared-1.1']);

    // The node is collapsed — the descendant is hidden.
    const chevron = () =>
      view.container.querySelector<HTMLButtonElement>('.epic-tree-chevron')!;
    fireEvent.click(chevron());
    expect(titles(view.container)).toEqual(['shared-1']);

    // The section identity before the card change — to check continuity.
    const rootBefore = view.container.querySelector('.epic-progress');
    expect(rootBefore, 'the section is not rendered').not.toBeNull();

    // The card changed. Exactly by a RE-RENDER, without unmounting.
    layeredState.tree = sharedSubtree();
    view.rerender(section('demo-90'));

    // (1) The section is the very same element. Without this check the test
    //     would prove a reset by unmounting, which happens on the
    //     code without the fix too.
    expect(
      view.container.querySelector('.epic-progress'),
      'the section was remounted — the check proves the wrong thing',
    ).toBe(rootBefore);

    // (2) …and the new card's tree is expanded in full, although the node
    //     `shared-1` lay in the previous one's collapsed set.
    expect(titles(view.container)).toEqual(['shared-1', 'shared-1.1']);
  });

  test('P-97 — the mode choice and the grouping choice SURVIVE a card change', () => {
    // Mandatory, otherwise "the summary, read literally" will one day cancel
    // the grouping memory too: the PK-3 reset does NOT apply to it
    // (US-11, SC-004). Grouping is set NOT to the default —
    // the default is "on" (A1), so the saved "off"
    // is distinguishable from a reset, rather than coinciding with it.
    window.localStorage.setItem(GROUPING_KEY, 'off');
    layeredState.tree = sharedSubtree();
    const view = render(section('demo-32'));
    fireEvent.click(screen.getByRole('radio', { name: 'Tree' }));

    view.rerender(section('demo-90'));

    expect(
      screen.getByRole('radio', { name: 'Tree' }).getAttribute('aria-checked'),
      'the mode choice did not survive the card change',
    ).toBe('true');

    fireEvent.click(screen.getByRole('radio', { name: 'List' }));
    expect(
      view.container.querySelector('.epic-group-toggle')!.textContent,
      'the grouping choice was reset together with the collapsed state — PK-3 touched too much',
    ).toBe('Group by status');
  });
});

/**
 * sk-421.3 m-9 (NFR "high-contrast mode", SC-015) — EVERY
 * meaning carrier has a non-colour duplicate.
 *
 * ─── Why this is a duplicate guard, not a new mode rule ───────────
 *
 * The `@media (forced-colors: active)` rule in the section exists for exactly one
 * carrier — the ring arcs (`.epic-ring-track` / `-done` / `-doing`).
 * Verified against the stylesheet: of the nine mode blocks, `epic` selectors are carried
 * by only one. Neither the row mark, nor the category dot, nor the linear
 * branch bar has a rule of its own.
 *
 * **This is not a violation, and it is said directly**: the NFR demands "a non-colour
 * duplicate — a caption or a shape — OR a separate rule for this mode".
 * All three have a duplicate: the status chip next to the mark, the caption next to
 * the category dot, the two numbers "X / Y" next to the branch bar. The mode
 * rule was ordered by the plan (m-12) only for the ring — arcs cannot have a duplicate,
 * they are within one drawing and differ only by colour, so they
 * needed a different thickness as well.
 *
 * ⚠ Since sk-466 there are FOUR carriers: the row got a VISIBLE blocked marker
 * — a dashed `--err` border around the status carrier. It does not introduce its own mode rule
 * either, for the same reason as the three above: its duplicate is the
 * SHAPE, the border drawing (`solid` on an unblocked row versus `dashed`
 * on a blocked one), which survives the substitution of the tone by a system one. So
 * the claim "of the nine mode blocks, `epic` selectors are carried only by one"
 * remains true.
 *
 * No case is added here on purpose: on screen the marker is carried by a CLASS, not by
 * text, and there is nothing to assert about it by rendering beyond what
 * `EpicChildRow.test.tsx` already asserts ("a blocked row lights the marker").
 * The tone and its distinctness from both mutings were measured at
 * sk-466 and are seen in a browser.
 *
 * ─── What the gap was, and it is closed here ───────────────────────
 *
 * The duplicates existed, but NO test asserted that they exist
 * IN THIS VERY ROLE. So the next edit that removed the status chip,
 * the category caption or the pair of numbers would take away from the carrier its only
 * non-colour distinction — and break no check: the section
 * would stay green, while in high-contrast mode the carrier would become
 * indistinguishable. Exactly this is recorded by the finding as a gap in the guard.
 *
 * Therefore each case below checks TWO things: that the colour carrier is
 * on screen (otherwise a claim about the duplicate would be a claim about nothing) and
 * that next to it there is a non-colour duplicate with non-empty content.
 */
describe('sk-421.3 m-9 — a non-colour duplicate for every carrier of the section', () => {
  const draw = () =>
    render(
      <Wrapper>
        <EpicProgressSection issue={rollup()} />
      </Wrapper>,
    );

  test('the "Tree" row mark: the duplicate is the status chip', () => {
    layeredState.tree = [childNode('sk-42.1')];
    const { container } = draw();
    fireEvent.click(screen.getByRole('radio', { name: 'Tree' }));

    const row = container.querySelector<HTMLElement>('.epic-tree-row');
    expect(row, 'there is no "Tree" row — nothing to claim about a duplicate').not.toBeNull();

    // The non-colour duplicate: a status chip with ITS OWN text. Under forced-colors
    // the mark tone collapses into a system one, and the chip will tell the statuses apart.
    const chip = row!.querySelector('.epic-child-status');
    expect(chip, 'the row has no status chip — the mark is left without a duplicate').not.toBeNull();
    expect(
      chip!.textContent?.trim(),
      'the status chip is empty: under forced-colors the row becomes indistinguishable',
    ).not.toBe('');
  });

  test('the "List" category dot: the duplicate is the category caption', () => {
    // Grouping is on by default (A1), so the category
    // headings are on screen without extra actions.
    layeredState.tree = [childNode('sk-42.1')];
    const { container } = draw();

    const dot = container.querySelector('.epic-category-dot');
    expect(dot, 'there is no category dot — nothing to claim about a duplicate').not.toBeNull();

    const label = container.querySelector('.epic-category-label');
    expect(label, 'the category has no caption — the dot is left without a duplicate').not.toBeNull();
    expect(
      label!.textContent?.trim(),
      'the category caption is empty: under forced-colors the categories become indistinguishable',
    ).not.toBe('');
  });

  test('branch bar: the duplicate is two numbers next to it', () => {
    // The bar inherits the same pair of roles (--ok on --elev) that was carried by
    // the header bar, which had the mode rule; this wave moved the rule
    // to the ring, and left the new bar on the duplicate.
    layeredState.tree = [
      childNode('sk-42.9', { type: 'epic', epicProgress: { closed: 1, total: 4 } }),
    ];
    const { container } = draw();

    const fill = container.querySelector('.epic-child-branch-fill');
    expect(fill, 'there is no branch bar — nothing to claim about a duplicate').not.toBeNull();

    const numbers = container.querySelector('.epic-child-progress');
    expect(numbers, 'the bar has no pair of numbers — it is left without a duplicate').not.toBeNull();
    expect(
      numbers!.textContent,
      'the pair of numbers is not printed: under forced-colors the share becomes unreadable',
    ).toMatch(/\d+\s*\/\s*\d+/);
  });
});

/**
 * sk-421.3 T17 (US-7, SC-013, m-15) — a ring instead of the linear bar.
 *
 * ─── Half of the guards are introduced BEFORE the replacement ──────
 *
 * Finding N-6 of the test plan: the accessibility contract that the bar supposedly
 * "held" was checked by half. `aria-valuemin` was checked
 * NOWHERE at all, and `aria-label` — in only one case of three
 * (`progressAria`); for `barNoneCounted` and `noChildren` only
 * `aria-valuetext` was checked. That is, replacing the bar with a ring went onto a guard
 * that is half missing, and "preserved in full" would have been a claim
 * without proof — exactly what the two limit numbers turned out to be.
 *
 * Therefore P-62 and P-63 below are NEW work, not a re-check: they
 * name all four numbers and all three texts by name.
 */
describe('sk-421.3 T17 — the header ring', () => {
  const draw = (over: Record<string, number> = {}) =>
    render(
      <Wrapper>
        <EpicProgressSection issue={rollup(over)} />
      </Wrapper>,
    );

  test('P-56 — the number inside the ring = the share of closed', () => {
    // rollup(): total 8, closed 3, in progress 1.
    const { container } = draw();

    // The number inside is the share of CLOSED of the total: 3/8 = 37.5 % → 38.
    expect(container.querySelector('.epic-ring-percent')?.textContent).toBe('38');
  });

  test('the drawing is hidden from the screen reader; the contract is carried by the indicator itself', () => {
    const { container } = draw();
    // Everything the drawing says is already said in words in `aria-valuetext`;
    // a second voice about one fact would be read by the screen reader as two.
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector('.epic-ring-percent')?.getAttribute('aria-hidden')).toBe(
      'true',
    );
    // The role belongs to what HAS a value, not to the drawing inside.
    expect(screen.getByRole('progressbar').classList.contains('epic-ring')).toBe(true);
  });

  test('P-61 — zero total: the percent is NOT printed', () => {
    const { container } = draw({
      totalChildren: 0,
      closedChildren: 0,
      openChildren: 0,
      inProgressChildren: 0,
    });
    expect(
      container.querySelector('.epic-ring-percent'),
      'a percent is printed on an empty epic — "0 of nothing" is not a share',
    ).toBeNull();
    // The ring is in place: the NUMBER disappears, not the indicator.
    expect(container.querySelector('.epic-ring')).not.toBeNull();
  });

  /**
   * The three cases of the contract — the same as the bar text distinguishes today.
   * Listed as a table because they are checked by ONE set
   * of assertions: name, value and all four numbers.
   */
  const CASES: Array<[string, Record<string, number>, string, string]> = [
    ['has a total', {}, '3 of 8 done', '8'],
    [
      'no counted children, but there are standing ones',
      { totalChildren: 0, closedChildren: 0, openChildren: 0, inProgressChildren: 0, standingChildren: 2 },
      'no task counts toward progress',
      '1',
    ],
    [
      'no children at all',
      { totalChildren: 0, closedChildren: 0, openChildren: 0, inProgressChildren: 0, standingChildren: 0 },
      'No children',
      '1',
    ],
  ];

  test.each(CASES)(
    'P-62/P-63/P-64 — "%s": name, value and ALL four numbers',
    (_name, over, text, valuemax) => {
      draw(over);
      const bar = screen.getByRole('progressbar');

      // P-63 — the accessible NAME. Today checked in only one case of
      // three; here — in all three, and it equals the value: name and value
      // are one concept (SC-014), two different texts on one element the
      // screen reader would read as a contradiction.
      expect(bar.getAttribute('aria-label'), 'the accessible NAME is lost').toBe(text);
      // P-64 — the text value (the existing coverage is preserved).
      expect(bar.getAttribute('aria-valuetext')).toBe(text);

      // P-62 — all four numbers, including `aria-valuemin`, which before
      // this task was checked NOWHERE.
      expect(bar.getAttribute('aria-valuemin'), 'aria-valuemin is lost').toBe('0');
      expect(bar.getAttribute('aria-valuemax')).toBe(valuemax);
      expect(bar.getAttribute('aria-valuenow')).toBe(String(over.closedChildren ?? 3));
    },
  );

  test('three cases give three DIFFERENT texts — otherwise the check above would degenerate', () => {
    // Without this the table would pass on code that answers with one text for
    // all three cases: each row is compared with its own expectation, but
    // the difference between them was asserted nowhere.
    const texts = CASES.map(([, , text]) => text);
    expect(new Set(texts).size).toBe(3);
  });

  /**
   * sk-421.3 T18 (P-60) — the printed percent is clamped: 199/200 never
   * reads as a finished 100.
   */
  test('P-60 — at 199/200 the text is clamped to "99"', () => {
    const { container } = draw({
      totalChildren: 200,
      closedChildren: 199,
      openChildren: 1,
      inProgressChildren: 0,
    });

    expect(container.querySelector('.epic-ring-percent')?.textContent).toBe('99');

  });

  test('P-58 on the rendered ring — 3 of 1000 is not printed as zero', () => {
    const { container } = draw({
      totalChildren: 1000,
      closedChildren: 3,
      openChildren: 997,
      inProgressChildren: 0,
    });
    expect(container.querySelector('.epic-ring-percent')?.textContent).toBe('1');
  });

  test('"counted children" and the summary total are DIFFERENT numbers, and the ring counts from the total', () => {
    // The terms are not equal: "counted children" is the total PLUS standing, the ring
    // counts from the pure total. The input is discriminating — standing ones are non-zero.
    //
    // sk-460.6 — the carrier of the first number changed. The heading no longer
    // prints it (the design prints nothing in the heading), so the difference
    // is visible on the pair "the caption tail about standing ones versus the ring share":
    // standing ones are named, but do not enter the share.
    const { container } = draw({ standingChildren: 2 });
    expect(container.querySelector('.detail-section-count')).toBeNull();
    expect(container.querySelector('.epic-progress-counters')?.textContent).toMatch(
      /2 standing/,
    );
    expect(screen.getByRole('progressbar').getAttribute('aria-valuemax')).toBe('8');
    // …and the share is computed from 8, not from 10: 3/8 = 38 %, 3/10 would give 30 %.
    expect(container.querySelector('.epic-ring-percent')?.textContent).toBe('38');
  });

  /**
   * sk-472 — the explanation of the two coverages (sk-460.12) must reach
   * the ring's accessibility tree, and not live only in the hover hint:
   * the ring is not focusable, and the keyboard and the screen reader will not open the hint.
   * The COMPUTED accessible description is checked (`getByRole(…, {description})`),
   * not the presence of an attribute: a reference to a nonexistent id or an empty string
   * would give an attribute without a description.
   */
  const RING_SCOPE_EN =
    'Counts direct children only. The list below covers the whole subtree.';

  test.each(CASES)(
    'sk-472 — "%s": the coverage is named in the accessible DESCRIPTION of the ring, the name is untouched',
    (_name, over, text) => {
      draw(over);
      const bar = screen.getByRole('progressbar', { description: RING_SCOPE_EN });
      // The coverage is a second concept, with its own place: the name stays
      // one text with the value (SC-014), the coverage is not mixed into it.
      expect(bar.getAttribute('aria-label')).toBe(text);
      expect(screen.getByRole('progressbar', { name: text })).toBe(bar);
    },
  );

  test('sk-472 — an open hint does not override the ring description', () => {
    draw();
    const bar = screen.getByRole('progressbar');
    fireEvent.mouseEnter(bar);
    // The hint is really open — otherwise the check below would prove nothing
    // about the merging of `aria-describedby`. By class, not by
    // role: in jsdom Floating UI does not measure, and before measuring the hint
    // stands `visibility: hidden` — Testing Library does not see its role.
    expect(document.querySelector('.skein-tooltip')?.textContent).toBe(RING_SCOPE_EN);
    expect(screen.getByRole('progressbar', { description: RING_SCOPE_EN })).toBe(bar);
    // The hint text is the same, so a single description cannot tell "the reference
    // held" from "the hint intercepted the reference". What tells them apart is the reference target:
    // it must stay on the section line, which lives on after
    // the hint closes, and not on the hint node itself.
    const target = document.getElementById(bar.getAttribute('aria-describedby') ?? '');
    expect(target, 'the ring aria-describedby leads nowhere').not.toBeNull();
    expect(
      target!.closest('.skein-tooltip'),
      'the ring description is intercepted by the hint — after it closes the coverage will vanish',
    ).toBeNull();
  });
});

/**
 * sk-421.3 T20 (US-11, P-90…P-95, P-98, P-20) — section mutations under
 * grouping.
 *
 * The section lives under live updates: rows arrive, leave, change
 * status and type. Under grouping each such mutation has a second
 * effect — a move between categories and a recount of the counters — and it is exactly this
 * that is the subject here.
 *
 * ─── What is NOT checked here and why ──────────────────────────────
 *
 * P-96 and P-97 (a card change expands the tree; the saved choice
 * survives the change) live in the T15 block above and are not doubled here.
 *
 * Focus restoration is guaranteed exactly to the extent of US-8 — when there is
 * sub-row memory. Moving the focus when the focused
 * ROW disappears is not fixed by this feature (it is behind `sk-444`), so the checks
 * "the last row of a category disappeared" and "a child moved" are done
 * INDEPENDENTLY of focus — they are about composition and counters. sk-444 closed
 * this transfer; its checks are in the block `sk-444 — the row with the focus disappeared` of this
 * file and in the tests of the "List" and the "Tree".
 */
describe('sk-421.3 T20 — section mutations under grouping', () => {
  const GROUPING_KEY = `skein.epic.sectionGrouping.${mockUser.id}`;

  /** The section with grouping ENABLED (default A1) and its own summary. */
  const grouped = (over: Record<string, number> = {}, id = 'demo-32') => (
    <Wrapper>
      <EpicProgressSection issue={{ ...rollup(over), id }} />
    </Wrapper>
  );

  /** Category captions in display order. */
  const heads = (c: HTMLElement) =>
    Array.from(c.querySelectorAll('.epic-category-head')).map((h) => ({
      label: h.querySelector('.epic-category-label')?.textContent,
      count: h.querySelector('.epic-category-count')?.textContent,
    }));

  const titles = (c: HTMLElement) =>
    Array.from(c.querySelectorAll('.epic-child-title')).map((el) => el.textContent);

  afterEach(() => {
    window.localStorage.removeItem(GROUPING_KEY);
  });

  test('P-90 — a child created by the form lands in the category of its status, the counter +1, focus on "Add child"', async () => {
    const { createIssue } = await import('../../../../api/issues');
    (createIssue as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'sk-42.9' });

    layeredState.tree = [childNode('sk-42.1', { status: 'open' })];
    const view = render(grouped());
    expect(heads(view.container)).toEqual([{ label: 'open', count: '1' }]);

    // The form creates a child; the server response arrives as a new set of rows —
    // the section does not make rows up, it re-reads them.
    fireEvent.click(screen.getByRole('button', { name: 'Add child' }));
    // sk-514 (8) — the dialog is mounted through a portal: we wait for it before
    // typing into a field that is not yet in the tree.
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByPlaceholderText(/new child title/i), {
      target: { value: 'new' },
    });
    layeredState.tree = [
      childNode('sk-42.1', { status: 'open' }),
      childNode('sk-42.9', { status: 'open' }),
    ];
    await act(async () => {
      // sk-514 (8) — the form is now in the dialog, and the footer button stays
      // on screen next to it. The submit is taken by its OWN label
      // ("Add"): before, both were called the same, and the test relied on
      // one of the two not being rendered.
      fireEvent.click(screen.getByRole('button', { name: 'Add' }));
      await Promise.resolve();
    });
    view.rerender(grouped());

    // The row in its category, the counter recounted.
    expect(heads(view.container)).toEqual([{ label: 'open', count: '2' }]);
    expect(titles(view.container)).toContain('sk-42.9');

    // The focus returned to "Add child": the button is remounted in the same
    // frame, so the transfer is deferred to the next one — and we wait for it.
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add child' }));
  });

  test('P-91 — a status change by a live update moves the row, BOTH counters are recounted', () => {
    layeredState.tree = [
      childNode('sk-42.1', { status: 'open' }),
      childNode('sk-42.2', { status: 'open' }),
      childNode('sk-42.3', { status: 'in_progress' }),
    ];
    const view = render(grouped());
    expect(heads(view.container)).toEqual([
      { label: 'in progress', count: '1' },
      { label: 'open', count: '2' },
    ]);

    // sk-42.2 went into progress.
    layeredState.tree = [
      childNode('sk-42.1', { status: 'open' }),
      childNode('sk-42.2', { status: 'in_progress' }),
      childNode('sk-42.3', { status: 'in_progress' }),
    ];
    view.rerender(grouped());

    // Both counters, not only the one it arrived in: a decrease is as visible
    // as an increase.
    expect(heads(view.container)).toEqual([
      { label: 'in progress', count: '2' },
      { label: 'open', count: '1' },
    ]);
  });

  test('P-92 — the last row of a category disappeared: its heading disappeared too (independently of focus)', () => {
    layeredState.tree = [
      childNode('sk-42.1', { status: 'open' }),
      childNode('sk-42.3', { status: 'deferred' }),
    ];
    const view = render(grouped());
    expect(heads(view.container).map((h) => h.label)).toEqual(['open', 'deferred']);

    layeredState.tree = [childNode('sk-42.1', { status: 'open' })];
    view.rerender(grouped());

    // A category with zero rows is not drawn at all (P-03).
    expect(heads(view.container)).toEqual([{ label: 'open', count: '1' }]);
    expect(view.container.textContent).not.toContain('deferred');
  });

  test('P-93 — the type changed to "epic" and back: the branch indicator appears and disappears, no empty space', () => {
    const plain = () => childNode('sk-42.1', { status: 'open' });
    const asEpic = () =>
      childNode('sk-42.1', { status: 'open', type: 'epic', epicProgress: { closed: 1, total: 2 } });

    layeredState.tree = [plain()];
    const view = render(grouped());
    expect(view.container.querySelector('.epic-child-branch'), 'a non-epic has an indicator').toBeNull();
    // …and no empty space is reserved for it: the heading columns
    // carry nothing extra.
    expect(view.container.querySelectorAll('.epic-child-branch')).toHaveLength(0);

    layeredState.tree = [asEpic()];
    view.rerender(grouped());
    const branch = view.container.querySelector('.epic-child-branch');
    expect(branch, 'the epic has no branch indicator').not.toBeNull();
    expect(view.container.querySelector('.epic-child-branch-fill')).not.toBeNull();

    layeredState.tree = [plain()];
    view.rerender(grouped());
    expect(view.container.querySelector('.epic-child-branch'), 'the indicator survived the type leaving').toBeNull();
  });

  test('P-94 — a child was moved: the row disappeared, the counter decreased (independently of focus)', () => {
    layeredState.tree = [
      childNode('sk-42.1', { status: 'open' }),
      childNode('sk-42.2', { status: 'open' }),
    ];
    const view = render(grouped());
    expect(heads(view.container)).toEqual([{ label: 'open', count: '2' }]);

    // A move to another parent — for this section the row has simply gone.
    layeredState.tree = [childNode('sk-42.1', { status: 'open' })];
    view.rerender(grouped());

    expect(heads(view.container)).toEqual([{ label: 'open', count: '1' }]);
    expect(titles(view.container)).not.toContain('sk-42.2');
  });

  test('P-95 — the user changed without a reload: the grouping choice is re-read under THEIR key', () => {
    // The arriving user has their own setting, and it is off.
    const OTHER = 'u-bob';
    window.localStorage.setItem(`skein.epic.sectionGrouping.${OTHER}`, 'off');

    layeredState.tree = [childNode('sk-42.1', { status: 'open' })];
    const view = render(grouped());
    // Alice made no setting of her own — the default "on" applies.
    expect(view.container.querySelector('.epic-children-groups')).not.toBeNull();

    // The user changed in the same tab.
    mockUser.id = OTHER;
    try {
      view.rerender(grouped());
      // THEIR key is read, not someone else's choice inherited.
      expect(
        view.container.querySelector('.epic-children-groups'),
        'grouping stayed with the other user — the key was not re-read',
      ).toBeNull();
      expect(view.container.querySelectorAll('.epic-children-list')).toHaveLength(1);
    } finally {
      mockUser.id = 'u-alice';
      window.localStorage.removeItem(`skein.epic.sectionGrouping.${OTHER}`);
    }
  });

  test('P-98 — a partial response: categories by the rows that arrived, the header counters by the summary', () => {
    // The summary speaks of eight children, but two rows arrived. This is not an error and
    // not a reason to make rows up: the header answers for the summary, the categories — for
    // what is visible.
    layeredState.tree = [
      childNode('sk-42.1', { status: 'open' }),
      childNode('sk-42.3', { status: 'deferred' }),
    ];
    const view = render(grouped());

    expect(heads(view.container)).toEqual([
      { label: 'open', count: '1' },
      { label: 'deferred', count: '1' },
    ]);
    // The header numbers stayed the SUMMARY numbers: 3 closed, 5 not done of 8.
    expect(screen.getByText(/Done 3/)).toBeTruthy();
    expect(screen.getByText(/Not done 5/)).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuemax')).toBe('8');
  });

  /**
   * P-20 (SC-004, A15) — "the section was NOT interrupted".
   *
   * An unsaved choice holds while the section is mounted continuously.
   * A card change by itself does not break it: the panel is rendered without
   * `key`, and on a direct "epic → epic" transition the section is not remounted.
   *
   * The input is DISCRIMINATING: the choice is made with a broken WRITE, i.e. it did not
   * reach the disk. Otherwise the test would pass even on code that simply re-read
   * the saved value — and would say nothing about the boundary of the life of an unsaved
   * choice.
   */
  test('P-20 — an unsaved choice survives a card change while the section was not interrupted', () => {
    layeredState.tree = [childNode('sk-42.1', { status: 'open' })];
    const view = render(grouped({}, 'demo-32'));

    const rootBefore = view.container.querySelector('.epic-progress');
    expect(rootBefore).not.toBeNull();
    // The default — grouping is on.
    expect(view.container.querySelector('.epic-children-groups')).not.toBeNull();

    // The write fails: the choice will stay only in the section memory.
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    try {
      fireEvent.click(view.container.querySelector('.epic-group-toggle')!);
      expect(view.container.querySelector('.epic-children-groups')).toBeNull();
      expect(window.localStorage.getItem(GROUPING_KEY), 'the choice was saved after all').toBeNull();

      // The card changed — by a RE-RENDER, without unmounting.
      view.rerender(grouped({}, 'demo-90'));

      // (1) the section is the same node — otherwise the test would prove something else;
      expect(
        view.container.querySelector('.epic-progress'),
        'the section was remounted — the check proves the wrong thing',
      ).toBe(rootBefore);
      // (2) …and the unsaved choice is in effect.
      expect(
        view.container.querySelector('.epic-children-groups'),
        'the unsaved choice is lost on a card change',
      ).toBeNull();
    } finally {
      setItem.mockRestore();
    }
  });
});

/**
 * sk-421.3 T21 (US-10, INV-9, INV-10, SC-012, SC-014) — all row
 * states survive the redesign.
 *
 * A cross-cutting check ACROSS ALL surfaces of the feature at once: categories, the
 * left-edge mark, the category mark, the branch indicator, the ring. Their individual
 * rules are checked by their own tasks; here it is checked that no
 * row state that existed BEFORE the redesign vanished or
 * lost its marker when all these surfaces are put together.
 *
 * The set is intentionally ONE for the whole group: an inaccessible task, a standing
 * task, tasks of all EIGHT types, a repeated occurrence and ordinary
 * rows in one epic. Spreading them over separate harnesses would mean
 * checking each state in isolation — while US-10 is exactly about
 * their coexisting on one screen.
 */
describe('sk-421.3 T21 — all row states survive the redesign', () => {
  /** The eight contract types (`IssueType`) — the full list, not a sample. */
  const ALL_TYPES = [
    'bug',
    'feature',
    'task',
    'epic',
    'chore',
    'decision',
    'idea',
    'note',
  ] as const;

  /**
   * A summary for the set below. Standing ones do NOT enter the total (sk-118), so
   * the total counts eight typed rows plus the inaccessible one, while the standing one
   * stands as a separate tail. A discrepancy between the sum of category counters and
   * the header numbers is EXPECTED here (INV-4 speaks of the number of shown
   * rows) and needs no fix.
   */
  const ROLLUP_T21 = {
    totalChildren: 9,
    closedChildren: 0,
    openChildren: 8,
    inProgressChildren: 0,
    deferredChildren: 0,
    unavailableChildren: 1,
    standingChildren: 1,
  };

  /**
   * An epic whose children include EVERYTHING listed in US-10.
   *
   * Row headings are left equal to ids (the `childNode`
   * default), so no heading coincides with a type word
   * — otherwise the check "the row has a chip of its type" would pass on
   * the heading.
   */
  const everyState = (): IssueTreeNode[] => [
    ...ALL_TYPES.map((type, i) =>
      childNode(`sk-42.${i + 1}`, { type, status: 'open' }),
    ),
    childNode('sk-42.9', { type: 'task', status: 'standing' }),
    // An inaccessible task: a reference row with EMPTY status and type.
    childNode('hidden-1', { status: '', type: '' }, { isReference: true }),
    // A repeated occurrence: a reference too, but the values are in place — it must not
    // be shown (US-2), unlike the stub above.
    childNode('sk-42.1', {}, { isReference: true, firstSeenAt: 'sk-9' }),
  ];

  const rowsOf = (c: HTMLElement) =>
    Array.from(c.querySelectorAll<HTMLElement>('[data-epic-row]'));

  /** Category captions in display order. */
  const heads = (c: HTMLElement) =>
    Array.from(c.querySelectorAll('.epic-category-head')).map((h) => ({
      label: h.querySelector('.epic-category-label')?.textContent,
      count: h.querySelector('.epic-category-count')?.textContent,
    }));

  /**
   * The row's TYPE chip: its only descendant whose text equals the type
   * value ENTIRELY. The comparison is exact, not `contains`, — the heading and
   * the identifier do not get into the selection that way.
   */
  const typeChipsOf = (row: HTMLElement) =>
    Array.from(row.querySelectorAll('span'))
      .map((s) => s.textContent ?? '')
      .filter((t) => (ALL_TYPES as readonly string[]).includes(t));

  const draw = (rows: IssueTreeNode[], over: Record<string, number> = {}) => {
    layeredState.tree = rows;
    return render(
      <Wrapper>
        <EpicProgressSection issue={rollup({ ...ROLLUP_T21, ...over })} />
      </Wrapper>,
    );
  };

  test('P-82 — inaccessible, standing and all eight types: every state is visible and did not lose its marker', () => {
    const { container } = draw(everyState());

    // Harness guard: the set is really assembled under grouping, otherwise
    // the claims about categories below would be checking emptiness.
    expect(
      container.querySelector('.epic-children-groups'),
      'grouping did not turn on — the check proves the wrong thing',
      ).not.toBeNull();

    const rows = rowsOf(container);
    // Eight typed rows + standing + inaccessible. There is no repeated
    // occurrence among them — it is checked separately below.
    expect(rows).toHaveLength(10);

    // (1) EACH of the eight types is present and carries ITS OWN chip.
    const byTitle = new Map(
      rows.map((li) => [li.querySelector('.epic-child-title')?.textContent ?? '', li]),
    );
    ALL_TYPES.forEach((type, i) => {
      const row = byTitle.get(`sk-42.${i + 1}`);
      expect(row, `no row of type ${type} at all`).toBeTruthy();
      expect(typeChipsOf(row!), `the row of type ${type} lost the type chip`).toEqual([
        type,
      ]);
    });

    // (2) The standing task — its own category, and the status along with it.
    const standingRow = byTitle.get('sk-42.9');
    expect(standingRow, 'there is no standing row').toBeTruthy();
    expect(
      standingRow!.querySelector('.epic-child-status'),
      'the standing row lost the status carrier',
    ).not.toBeNull();

    // (3) The inaccessible task: "no access", and the status is revealed by NOTHING
    //     (INV-10, SC-014) — neither a caption, nor a chip, nor an identifier.
    const stub = container.querySelector<HTMLElement>('.epic-child-no-access');
    expect(stub, 'there is no "no access" row').not.toBeNull();
    expect(stub!.textContent).toBe('no access');
    expect(
      stub!.querySelector('.issue-id-badge'),
      'the stub prints the identifier',
    ).toBeNull();
    expect(
      stub!.querySelector('.epic-child-status'),
      'the stub prints the status',
    ).toBeNull();
    expect(typeChipsOf(stub!), 'the stub prints the type').toEqual([]);
  });

  test('P-83 — a repeated occurrence is still not shown, while the stub is shown', () => {
    const { container } = draw(everyState());

    // Both rows are reference ones, and they diverged exactly by the stub predicate:
    // the repeated occurrence has status and type in place, the stub has them empty.
    const titles = rowsOf(container).map(
      (li) => li.querySelector('.epic-child-title')?.textContent ?? 'no-access',
    );
    // `sk-42.1` is in the set twice: as an ordinary row and as a repeated occurrence.
    // It must be shown exactly ONCE.
    expect(titles.filter((t) => t === 'sk-42.1')).toHaveLength(1);
    expect(
      container.querySelectorAll('.epic-child-no-access'),
      'the stub of the inaccessible task vanished together with the repeated occurrence',
    ).toHaveLength(1);
  });

  test('P-84 — a standing task lands in the standing category, tied to the "∞ standing" tail', () => {
    const { container } = draw(everyState());

    // The category exists, and has exactly one row in it.
    expect(heads(container)).toContainEqual({ label: 'standing', count: '1' });

    // …and it is THE VERY SAME row, not a category of the same name with someone else's
    // content: we take the category `ul` by its heading.
    const standingHead = Array.from(
      container.querySelectorAll('.epic-category'),
    ).find(
      (cat) =>
        cat.querySelector('.epic-category-label')?.textContent === 'standing',
    );
    expect(standingHead).toBeTruthy();
    expect(
      standingHead!.querySelector('.epic-child-title')?.textContent,
    ).toBe('sk-42.9');

    // The link with the header: the "∞ N standing" tail prints the same number.
    expect(screen.getByText(/∞ 1 standing/)).toBeTruthy();

    // The inaccessible task does NOT get a status category (INV-10): its
    // category is its own and the last.
    expect(heads(container).map((h) => h.label)).toEqual([
      'open',
      'standing',
      'unavailable',
    ]);
  });

  test('P-85 — hierarchical ids of arbitrary length are rendered in full', () => {
    // The longest id the project produces (16
    // characters) — the same worst input by which the indent limit was computed.
    const LONG = 'sk-285.7.2.36.78';
    const { container } = draw([
      childNode(LONG, { status: 'open' }),
      childNode('sk-42.1', { status: 'open' }),
    ]);

    const badges = Array.from(
      container.querySelectorAll('.issue-id-badge'),
    ).map((b) => b.textContent);
    // The badge prints the prefix and the last segment as two nodes; together
    // they must give the id IN FULL, without truncation.
    expect(badges).toContain(LONG);
    expect(badges).toContain('sk-42.1');
  });

  test('P-85 — arbitrary depth is rendered, and every level is named to the screen reader', () => {
    // A tree of depth 6: the card root plus five nestings in a row.
    const deep: IssueTreeNode[] = [
      childNode('sk-42', {}, { depth: 0, parentRef: null }),
      ...Array.from({ length: 6 }, (_, i) =>
        childNode(
          `sk-42${'.1'.repeat(i + 1)}`,
          { status: 'open' },
          {
            depth: i + 1,
            parentRef: {
              id: i === 0 ? 'sk-42' : `sk-42${'.1'.repeat(i)}`,
              edgeType: 'parent-child',
            },
          },
        ),
      ),
    ];
    const { container } = draw(deep, { totalChildren: 6, openChildren: 6 });

    fireEvent.click(screen.getByRole('radio', { name: 'Tree' }));

    const items = Array.from(
      container.querySelectorAll<HTMLElement>('[role="treeitem"]'),
    );
    // The card root is not a row (`treeRowsOf`), so there are
    // six rows, not seven.
    expect(items).toHaveLength(6);

    // The accessibility level carries the REAL depth at every level —
    // the indent limit restricts the shift, but not what is announced to
    // the screen reader (US-4, SC-007).
    expect(items.map((el) => el.getAttribute('aria-level'))).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
    ]);

    // The deepest row reached the screen in full: the heading and its
    // own identifier.
    const deepest = items[5];
    expect(deepest.querySelector('.epic-child-title')?.textContent).toBe(
      'sk-42.1.1.1.1.1.1',
    );
    expect(deepest.querySelector('.issue-id-badge')?.textContent).toBe(
      'sk-42.1.1.1.1.1.1',
    );
  });

  test('P-82 (in the "Tree") — the stub is not announced as expandable', () => {
    const { container } = draw(everyState());
    fireEvent.click(screen.getByRole('radio', { name: 'Tree' }));

    const items = Array.from(
      container.querySelectorAll<HTMLElement>('[role="treeitem"]'),
    );
    expect(items.length).toBeGreaterThan(0);

    // The stub gets no parent mark (INV-10).
    const stubItem = items.find(
      (el) => el.querySelector('.epic-child-no-access') !== null,
    )!;
    expect(stubItem, 'there is no stub in the "Tree"').toBeTruthy();
    expect(
      stubItem.getAttribute('aria-expanded'),
      'the stub is announced as expandable',
    ).toBeNull();
  });
});

// ───────── sk-444 — the ROW with the focus disappeared: the target outside the rows is handled by the section ─────────
//
// sk-421.2 US-2 "Fallback focus target", SC-013: no rows left — the focus goes
// to the mode toggle (the selected mode), and without a toggle — to
// "Add child". The check is with a real "List" and "Tree" inside
// the section: a mode request without the section's handler would go red here.

describe('sk-444 — the row with the focus disappeared: the fallback target in both modes', () => {
  const EMPTY_ROLLUP = {
    totalChildren: 0,
    closedChildren: 0,
    openChildren: 0,
    inProgressChildren: 0,
    standingChildren: 0,
  };

  function section(over: Record<string, number | boolean> = {}) {
    return (
      <Wrapper>
        <EpicProgressSection issue={rollup(over)} />
      </Wrapper>
    );
  }

  const openName = (id: string) => `Open child issue ${id}: ${id}`;

  function focusRow(mode: 'List' | 'Tree', id: string): HTMLElement {
    const button = screen.getByRole('button', { name: openName(id) });
    const target =
      mode === 'Tree' ? button.closest<HTMLElement>('[role="treeitem"]')! : button;
    act(() => target.focus());
    expect(document.activeElement).toBe(target);
    return target;
  }

  for (const mode of ['List', 'Tree'] as const) {
    test(`"${mode}": the row with the focus disappeared, others remain → the nearest row above`, () => {
      layeredState.tree = [childNode('sk-42.1'), childNode('sk-42.5'), childNode('sk-42.2')];
      const { rerender } = render(section());
      if (mode === 'Tree') fireEvent.click(screen.getByRole('radio', { name: 'Tree' }));
      focusRow(mode, 'sk-42.2');

      layeredState.tree = [childNode('sk-42.1'), childNode('sk-42.5')];
      rerender(section());

      const button = screen.getByRole('button', { name: openName('sk-42.5') });
      expect(document.activeElement).toBe(
        mode === 'Tree' ? button.closest('[role="treeitem"]') : button,
      );
    });

    test(`"${mode}": no rows left, the toggle exists → the selected mode`, () => {
      layeredState.tree = [childNode('sk-42.1')];
      const { rerender } = render(section());
      if (mode === 'Tree') fireEvent.click(screen.getByRole('radio', { name: 'Tree' }));
      focusRow(mode, 'sk-42.1');

      layeredState.tree = [];
      rerender(section());

      expect(document.activeElement).toBe(screen.getByRole('radio', { name: mode }));
    });

    test(`"${mode}": no rows left and no toggle → "Add child"`, () => {
      layeredState.tree = [childNode('sk-42.1')];
      const { rerender } = render(section(EMPTY_ROLLUP));
      if (mode === 'Tree') fireEvent.click(screen.getByRole('radio', { name: 'Tree' }));
      focusRow(mode, 'sk-42.1');

      layeredState.tree = [];
      rerender(section(EMPTY_ROLLUP));

      expect(screen.queryByRole('radiogroup')).toBeNull();
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add child' }));
    });
  }
});

// ───────── sk-427 item 3 — the "Tree" remembers the row of its entry point ─────────
//
// sk-421.2 US-2: "on a mode switch the focus stays on the toggle, and
// the 'Tree' remembers the row of its entry point"; if the entry-point row is gone or is
// under a collapsed node — the US-2 fallback target. When leaving for the "List" the tree
// is unmounted, so the section remembers — like the collapsed state.

describe('sk-427 item 3 — the "Tree" entry point survives "Tree → List → Tree"', () => {
  const openName = (id: string) => `Open child issue ${id}: ${id}`;
  const rowOf = (id: string) =>
    screen.getByRole('button', { name: openName(id) }).closest<HTMLElement>('[role="treeitem"]')!;
  const entryRow = (container: HTMLElement) =>
    Array.from(container.querySelectorAll<HTMLElement>('[role="treeitem"][tabindex="0"]'));

  function section(issue = rollup()) {
    return (
      <Wrapper>
        <EpicProgressSection issue={issue} />
      </Wrapper>
    );
  }

  const ROWS = () => [childNode('sk-42.1'), childNode('sk-42.2'), childNode('sk-42.3')];

  async function enterTreeAndGoTo(user: ReturnType<typeof userEvent.setup>, downs: number) {
    await user.click(screen.getByRole('radio', { name: 'Tree' }));
    act(() => rowOf('sk-42.1').focus());
    for (let i = 0; i < downs; i += 1) await user.keyboard('{ArrowDown}');
  }

  test('returned to the "Tree" → focus on the toggle, the entry point is the former row, Tab arrives at it', async () => {
    layeredState.tree = ROWS();
    const user = userEvent.setup();
    const { container } = render(section());
    await enterTreeAndGoTo(user, 2);
    expect(document.activeElement).toBe(rowOf('sk-42.3'));

    await user.click(screen.getByRole('radio', { name: 'List' }));
    expect(container.querySelector('[role="tree"]')).toBeNull();
    await user.click(screen.getByRole('radio', { name: 'Tree' }));

    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Tree' }));
    expect(entryRow(container)).toEqual([rowOf('sk-42.3')]);
    await user.tab();
    expect(document.activeElement).toBe(rowOf('sk-42.3'));
  });

  test('the entry-point row disappeared while the "List" was open → the entry point is the nearest row above', async () => {
    layeredState.tree = ROWS();
    const user = userEvent.setup();
    const { container, rerender } = render(section());
    await enterTreeAndGoTo(user, 2);
    await user.click(screen.getByRole('radio', { name: 'List' }));

    layeredState.tree = [childNode('sk-42.1'), childNode('sk-42.2')];
    rerender(section());
    await user.click(screen.getByRole('radio', { name: 'Tree' }));

    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Tree' }));
    expect(entryRow(container)).toEqual([rowOf('sk-42.2')]);
  });

  test('the entry-point row is hidden by a collapsed node → after the return the entry point is the ancestor', async () => {
    // The ancestor is not the first: "the first row" as the default answer here does not
    // coincide with the correct one.
    layeredState.tree = [
      childNode('sk-42.1'),
      childNode('sk-42.2'),
      childNode('sk-42.2.1', {}, { depth: 2, parentRef: { id: 'sk-42.2', edgeType: 'parent-child' } }),
      childNode('sk-42.3'),
    ];
    const user = userEvent.setup();
    const { container } = render(section());
    await enterTreeAndGoTo(user, 2);
    expect(document.activeElement).toBe(rowOf('sk-42.2.1'));
    // A mouse chevron click does not take the focus: the row with the focus is hidden by the collapse.
    fireEvent.click(rowOf('sk-42.2').querySelector<HTMLButtonElement>('.epic-tree-chevron')!);
    await user.click(screen.getByRole('radio', { name: 'List' }));
    await user.click(screen.getByRole('radio', { name: 'Tree' }));

    expect(screen.queryByRole('button', { name: openName('sk-42.2.1') })).toBeNull();
    expect(entryRow(container)).toEqual([rowOf('sk-42.2')]);
  });

  test('another epic card → the entry point is not carried over: the first row', async () => {
    layeredState.tree = ROWS();
    const user = userEvent.setup();
    const { container, rerender } = render(section());
    await enterTreeAndGoTo(user, 2);
    await user.click(screen.getByRole('radio', { name: 'List' }));

    rerender(section({ ...rollup(), id: 'sk-43' } as IssueDetail));
    await user.click(screen.getByRole('radio', { name: 'Tree' }));

    expect(entryRow(container)).toEqual([rowOf('sk-42.1')]);
  });
});

// ───────── sk-427 item 4 — resetting the trees after creating a child ─────────
//
// The "Add child" form reset the whole `['issues','tree']` prefix —
// along with the tasks column trees of all projects and the sections of other epics. Now
// only the keys of THIS epic's section. The filters of real calls are applied to
// a cache with a set of keys: it is checked which records they cover.

describe('sk-427 item 4 — "Add child" resets only the tree of its own epic', () => {
  test('all variants of this epic section key are covered and nothing else', async () => {
    const { createIssue } = await import('../../../../api/issues');
    (createIssue as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'demo-32.9' });
    const spy = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
    layeredState.tree = [childNode('demo-32.1')];
    render(section());

    fireEvent.click(screen.getByRole('button', { name: 'Add child' }));
    // sk-514 (8) — the dialog is mounted through a portal: we wait for it before
    // typing into a field that is not yet in the tree.
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByPlaceholderText(/new child title/i), {
      target: { value: 'new' },
    });
    await act(async () => {
      // Submit — by its own label, see the argument in P-90 above.
      fireEvent.click(screen.getByRole('button', { name: 'Add' }));
      await Promise.resolve();
    });
    const filters = spy.mock.calls.map((c) => c[0]);
    spy.mockRestore();

    const KEYS: Record<string, readonly unknown[]> = {
      thisSection: layeredTreeQueryKey(null, 'demo-32', ['parent-child'], undefined, true),
      thisSectionCapped: layeredTreeQueryKey(null, 'demo-32', ['parent-child'], 1, true),
      otherEpicSection: layeredTreeQueryKey(null, 'demo-40', ['parent-child'], undefined, true),
      tasksColumn: layeredTreeQueryKey('11111111-2222-3333-4444-555555555555', null, ['parent-child']),
    };
    const probe = new QueryClient();
    for (const key of Object.values(KEYS)) probe.setQueryData(key, { rows: [], requestedAt: 0 });
    const hit = new Set<string>();
    for (const filter of filters) {
      for (const q of probe.getQueryCache().findAll(filter ?? {})) {
        const name = Object.entries(KEYS).find(
          ([, k]) => JSON.stringify(k) === JSON.stringify(q.queryKey),
        )?.[0];
        if (name) hit.add(name);
      }
    }
    probe.clear();

    expect([...hit].sort()).toEqual(['thisSection', 'thisSectionCapped']);
  });

  function section() {
    return (
      <Wrapper>
        <EpicProgressSection issue={rollup()} />
      </Wrapper>
    );
  }
});

// ───────── sk-490 — the mode toggle: one Tab stop, arrows ─────────
//
// The model is the WAI-ARIA radiogroup: in the Tab traversal order only the selected
// segment stands; the arrows ←/→ and ↑/↓ select the neighbouring mode in a circle and move
// the focus to it. The mouse, accessible names and `aria-checked` — as before; the fallback
// focus target (sk-444) and the "Tree" entry-point memory (sk-427 item 3) — are intact.

describe('sk-490 — the mode toggle modelled on a radiogroup', () => {
  const openName = (id: string) => `Open child issue ${id}: ${id}`;
  const radio = (name: 'List' | 'Tree') => screen.getByRole('radio', { name });
  const checked = () =>
    screen.getAllByRole('radio').filter((r) => r.getAttribute('aria-checked') === 'true');

  function section() {
    return (
      <Wrapper>
        <EpicProgressSection issue={rollup()} />
      </Wrapper>
    );
  }

  /** The whole Tab pass over the section from `body` until it returns to it (or the limit). */
  async function tabWalk(user: ReturnType<typeof userEvent.setup>): Promise<Element[]> {
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    const seen: Element[] = [];
    for (let i = 0; i < 40; i += 1) {
      await user.tab();
      const el = document.activeElement;
      if (!el || el === document.body || seen.includes(el)) break;
      seen.push(el);
    }
    return seen;
  }

  for (const [start, other] of [['List', 'Tree'], ['Tree', 'List']] as const) {
    test(`"${start}" selected → Tab enters the group once, on "${start}"; Shift+Tab back — to the same place`, async () => {
      layeredState.tree = [childNode('sk-42.1'), childNode('sk-42.2')];
      const user = userEvent.setup();
      render(section());
      if (start === 'Tree') await user.click(radio('Tree'));

      const walk = await tabWalk(user);
      const radiosVisited = walk.filter((el) => el.getAttribute('role') === 'radio');
      expect(radiosVisited).toEqual([radio(start)]);
      expect(walk).not.toContain(radio(other));

      // From the element after the group Shift+Tab returns to the selected one.
      act(() => radio(start).focus());
      await user.tab();
      expect(document.activeElement?.getAttribute('role')).not.toBe('radio');
      await user.tab({ shift: true });
      expect(document.activeElement).toBe(radio(start));
    });
  }

  test('→ and ← switch the mode in a circle and move the focus', async () => {
    layeredState.tree = [childNode('sk-42.1')];
    const user = userEvent.setup();
    const { container } = render(section());
    act(() => radio('List').focus());

    await user.keyboard('{ArrowRight}');
    expect(checked()).toEqual([radio('Tree')]);
    expect(document.activeElement).toBe(radio('Tree'));
    expect(container.querySelector('[role="tree"]')).not.toBeNull();

    // Last → first: in a circle.
    await user.keyboard('{ArrowRight}');
    expect(checked()).toEqual([radio('List')]);
    expect(document.activeElement).toBe(radio('List'));
    expect(container.querySelector('[role="tree"]')).toBeNull();

    // First ← last: in a circle in the opposite direction.
    await user.keyboard('{ArrowLeft}');
    expect(checked()).toEqual([radio('Tree')]);
    expect(document.activeElement).toBe(radio('Tree'));

    await user.keyboard('{ArrowLeft}');
    expect(checked()).toEqual([radio('List')]);
    expect(document.activeElement).toBe(radio('List'));
  });

  test('↓ and ↑ work the same way as → and ←', async () => {
    layeredState.tree = [childNode('sk-42.1')];
    const user = userEvent.setup();
    render(section());
    act(() => radio('List').focus());

    await user.keyboard('{ArrowDown}');
    expect(checked()).toEqual([radio('Tree')]);
    expect(document.activeElement).toBe(radio('Tree'));
    await user.keyboard('{ArrowDown}');
    expect(checked()).toEqual([radio('List')]);
    expect(document.activeElement).toBe(radio('List'));
    await user.keyboard('{ArrowUp}');
    expect(checked()).toEqual([radio('Tree')]);
    expect(document.activeElement).toBe(radio('Tree'));
  });

  test('after an arrow the single Tab stop moves to the newly selected one', async () => {
    layeredState.tree = [childNode('sk-42.1')];
    const user = userEvent.setup();
    render(section());
    act(() => radio('List').focus());
    await user.keyboard('{ArrowRight}');

    expect(radio('Tree').getAttribute('tabindex')).toBe('0');
    expect(radio('List').getAttribute('tabindex')).toBe('-1');
    const walk = await tabWalk(user);
    expect(walk.filter((el) => el.getAttribute('role') === 'radio')).toEqual([radio('Tree')]);
  });

  test('an arrow with a modifier does not change the mode', async () => {
    layeredState.tree = [childNode('sk-42.1')];
    const user = userEvent.setup();
    render(section());
    act(() => radio('List').focus());
    await user.keyboard('{Alt>}{ArrowRight}{/Alt}');
    expect(checked()).toEqual([radio('List')]);
    expect(document.activeElement).toBe(radio('List'));
  });

  test('the mouse still selects the mode and moves the Tab stop to it', async () => {
    layeredState.tree = [childNode('sk-42.1')];
    const user = userEvent.setup();
    render(section());
    await user.click(radio('Tree'));
    expect(checked()).toEqual([radio('Tree')]);
    expect(radio('Tree').getAttribute('tabindex')).toBe('0');
    await user.click(radio('List'));
    expect(checked()).toEqual([radio('List')]);
    expect(radio('List').getAttribute('tabindex')).toBe('0');
  });

  test('sk-444 — the mode is selected by an arrow, no rows left → focus on the selected segment (it is also the Tab stop)', async () => {
    layeredState.tree = [childNode('sk-42.1')];
    const user = userEvent.setup();
    const { rerender } = render(section());
    act(() => radio('List').focus());
    await user.keyboard('{ArrowRight}');
    const row = screen
      .getByRole('button', { name: openName('sk-42.1') })
      .closest<HTMLElement>('[role="treeitem"]')!;
    act(() => row.focus());

    layeredState.tree = [];
    rerender(section());

    expect(document.activeElement).toBe(radio('Tree'));
    expect(document.activeElement?.getAttribute('tabindex')).toBe('0');
  });

  test('sk-427 item 3 — "Tree" → "List" → "Tree" by arrows: the entry point is the same, Tab arrives at it', async () => {
    layeredState.tree = [childNode('sk-42.1'), childNode('sk-42.2'), childNode('sk-42.3')];
    const user = userEvent.setup();
    const { container } = render(section());
    const rowOf = (id: string) =>
      screen.getByRole('button', { name: openName(id) }).closest<HTMLElement>('[role="treeitem"]')!;

    act(() => radio('List').focus());
    await user.keyboard('{ArrowRight}');
    act(() => rowOf('sk-42.1').focus());
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(document.activeElement).toBe(rowOf('sk-42.3'));

    act(() => radio('Tree').focus());
    await user.keyboard('{ArrowLeft}');
    expect(container.querySelector('[role="tree"]')).toBeNull();
    await user.keyboard('{ArrowLeft}');

    expect(document.activeElement).toBe(radio('Tree'));
    expect(
      Array.from(container.querySelectorAll('[role="treeitem"][tabindex="0"]')),
    ).toEqual([rowOf('sk-42.3')]);
    await user.tab();
    expect(document.activeElement).toBe(rowOf('sk-42.3'));
  });
});

/**
 * sk-489 T015 (US-5, SC-001, SC-012, SC-010, INV-5; test plan line 60) —
 * the ring counts by the PROGRESS DENOMINATOR, not by the summary total.
 *
 * ─── Why six examples, not one ─────────────────────────────────────
 *
 * The US-5 acceptance lists six inputs, and they tell apart DIFFERENT mistakes:
 * the first catches the numerator ("done" versus "closed"), the second —
 * the denominator, the third — the second arc (its divisor is visible only when it is
 * non-zero), the fourth — inaccessible ones (they stay IN the denominator),
 * the fifth and the sixth — two different zeros that must not be confused: "nothing to divide
 * by, but there are children" versus "no children". An implementation that fixed one
 * input goes red on the other five, and this is the essence of the table, not a
 * detail of it.
 *
 * ─── What each row proves as a whole ───────────────────────────────
 *
 * ALL parts of the ring from one denominator (the leading requirement of US-5):
 * so a row checks at once the printed percent, the accessible text
 * "X of Y", the bar limit and value. The arcs themselves are drawn
 * geometry and are seen in a browser.
 */
describe('sk-489 T015 — the ring by the progress denominator', () => {
  const draw = (over: Record<string, number> = {}) =>
    render(
      <Wrapper>
        <EpicProgressSection issue={rollup(over)} />
      </Wrapper>,
    );

  /**
   * A summary of the "new" server. The total fields are set EXPLICITLY in all rows —
   * including those where they would coincide with the former pair: a default
   * would hide the input on which the check stopped distinguishing.
   */
  type Ring = {
    /** The text inside the ring; `null` — nothing to print, there is no element. */
    percent: string | null;
    /** The accessible name and value of the bar — one text (SC-014). */
    bar: string;
    now: string;
    max: string;
    /** The tail under the ring; `null` — no tail at all. */
    tail: string | null;
  };

  const EXAMPLES: Array<[string, Record<string, number>, Ring]> = [
    [
      '3 done + 1 not doing',
      {
        totalChildren: 4,
        closedChildren: 4,
        openChildren: 0,
        inProgressChildren: 0,
        doneChildren: 3,
        noWorkChildren: 1,
        countedChildren: 3,
      },
      { percent: '100', bar: '3 of 3 done', now: '3', max: '3', tail: 'excluded from scope: 1' },
    ],
    [
      '2 done + 1 open + 1 duplicate',
      {
        totalChildren: 4,
        closedChildren: 3,
        openChildren: 1,
        inProgressChildren: 0,
        doneChildren: 2,
        noWorkChildren: 1,
        countedChildren: 3,
      },
      { percent: '67', bar: '2 of 3 done', now: '2', max: '3', tail: 'excluded from scope: 1' },
    ],
    [
      '1 done + 1 in progress + 2 not doing — the ring is filled IN FULL',
      {
        totalChildren: 4,
        closedChildren: 3,
        openChildren: 0,
        inProgressChildren: 1,
        doneChildren: 1,
        noWorkChildren: 2,
        countedChildren: 2,
      },
      { percent: '50', bar: '1 of 2 done', now: '1', max: '2', tail: 'excluded from scope: 2' },
    ],
    [
      '2 done + 1 not doing + 1 inaccessible — the inaccessible one stays in the denominator',
      {
        totalChildren: 4,
        closedChildren: 3,
        openChildren: 0,
        inProgressChildren: 0,
        unavailableChildren: 1,
        doneChildren: 2,
        noWorkChildren: 1,
        countedChildren: 3,
      },
      { percent: '67', bar: '2 of 3 done', now: '2', max: '3', tail: 'excluded from scope: 1' },
    ],
    [
      'all visible dropped, no inaccessible — nothing to divide by',
      {
        totalChildren: 2,
        closedChildren: 2,
        openChildren: 0,
        inProgressChildren: 0,
        doneChildren: 0,
        noWorkChildren: 2,
        countedChildren: 0,
      },
      {
        percent: null,
        bar: 'no task counts toward progress',
        now: '0',
        max: '1',
        tail: 'excluded from scope: 2',
      },
    ],
    [
      'all visible dropped, there is an inaccessible — 0 of 1',
      {
        totalChildren: 3,
        closedChildren: 2,
        openChildren: 0,
        inProgressChildren: 0,
        unavailableChildren: 1,
        doneChildren: 0,
        noWorkChildren: 2,
        countedChildren: 1,
      },
      { percent: '0', bar: '0 of 1 done', now: '0', max: '1', tail: 'excluded from scope: 2' },
    ],
  ];

  test.each(EXAMPLES)('US-5 acceptance — "%s"', (_name, over, want) => {
    const { container } = draw(over);
    const bar = screen.getByRole('progressbar');

    // The printed percent. `null` — there is no element at all: "nothing to print"
    // and "print zero" are different claims (P-61).
    const percentEl = container.querySelector('.epic-ring-percent');
    if (want.percent === null) {
      expect(percentEl, 'the ring printed a number where there is nothing to divide by').toBeNull();
    } else {
      expect(percentEl?.textContent).toBe(want.percent);
    }

    // Name and value — one text (SC-014), both must name "X of Y".
    expect(bar.getAttribute('aria-valuetext')).toBe(want.bar);
    expect(bar.getAttribute('aria-label')).toBe(want.bar);

    // The bar limits — from the denominator, not from the summary total.
    expect(bar.getAttribute('aria-valuenow')).toBe(want.now);
    expect(bar.getAttribute('aria-valuemax')).toBe(want.max);
    expect(bar.getAttribute('aria-valuemin')).toBe('0');

    const counters = container.querySelector('.epic-progress-counters')?.textContent ?? '';
    if (want.tail === null) {
      expect(counters, 'the "without work" tail is printed where it should not be').not.toMatch(
        /excluded/,
      );
    } else {
      expect(counters).toContain(want.tail);
    }
  });

  test('the input is discriminating — the summary total and the denominator diverge in EVERY example', () => {
    // Without this the table above would pass on code that counts from the total: on
    // an input where `totalChildren === countedChildren`, both behaviours give
    // the same number, and the row proves nothing.
    for (const [name, over] of EXAMPLES) {
      expect(over.countedChildren, `${name}: the denominator coincided with the total`).not.toBe(
        over.totalChildren,
      );
    }
  });

  test('"Done N" under the ring is "done", not "closed"', () => {
    // The input is discriminating: 4 closed, of them 3 done.
    const { container } = draw({
      totalChildren: 4,
      closedChildren: 4,
      openChildren: 0,
      inProgressChildren: 0,
      doneChildren: 3,
      noWorkChildren: 1,
      countedChildren: 3,
    });
    const counters = container.querySelector('.epic-progress-counters')?.textContent ?? '';
    expect(counters).toContain('Done 3');
    expect(counters, 'the counter prints the number of CLOSED').not.toContain('Done 4');
  });

  test('the tail at zero is hidden — but this is "they are zero", not "the field did not arrive"', () => {
    // The maintainers' decision: "without work: 0" is not printed. The input is exactly with a
    // ZERO that ARRIVED, otherwise the old api branch would be checked.
    const { container } = draw({
      totalChildren: 4,
      closedChildren: 3,
      openChildren: 1,
      inProgressChildren: 0,
      doneChildren: 3,
      noWorkChildren: 0,
      countedChildren: 4,
    });
    expect(container.querySelector('.epic-progress-counters')?.textContent).not.toMatch(
      /excluded/,
    );
  });

  test('US-10, SC-010 — a response WITHOUT the new fields: the former numbers, no tail', () => {
    // A guard of the rollout window: the old api sends neither "done" nor
    // the denominator, and the ring must show today's pair
    // "closed / total" — 3 of 8, 38 %.
    const { container } = draw();
    const bar = screen.getByRole('progressbar');

    expect(container.querySelector('.epic-ring-percent')?.textContent).toBe('38');
    expect(bar.getAttribute('aria-valuetext')).toBe('3 of 8 done');
    expect(bar.getAttribute('aria-valuenow')).toBe('3');
    expect(bar.getAttribute('aria-valuemax')).toBe('8');
    // There is NO tail: "the field did not arrive" is not "zero dropped".
    expect(container.querySelector('.epic-progress-counters')?.textContent).not.toMatch(
      /excluded/,
    );
  });

  test('all dropped — the text "no task counts toward progress", and the dropped rows are SHOWN', () => {
    // The difference from "no children at all" is observable: there are rows on screen.
    // Without this half "barNoneCounted instead of noChildren" could have been
    // implemented by ceasing to show rows — and both would become true.
    layeredState.tree = [
      childNode('demo-32.1', { status: 'closed' }),
      childNode('demo-32.2', { status: 'closed' }),
    ];
    const { container } = draw({
      totalChildren: 2,
      closedChildren: 2,
      openChildren: 0,
      inProgressChildren: 0,
      doneChildren: 0,
      noWorkChildren: 2,
      countedChildren: 0,
    });

    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuetext')).toBe('no task counts toward progress');
    expect(bar.getAttribute('aria-valuetext'), 'printed "no children" with live children').not.toBe(
      'No children',
    );
    expect(container.querySelectorAll('.epic-children-list > li')).toHaveLength(2);
  });

  test('"no children at all" stays its own text — the two zeros did not merge', () => {
    // A negative control to the previous one: if "all dropped" were
    // implemented by replacing the text unconditionally, this would go red.
    draw({
      totalChildren: 0,
      closedChildren: 0,
      openChildren: 0,
      inProgressChildren: 0,
      standingChildren: 0,
      doneChildren: 0,
      noWorkChildren: 0,
      countedChildren: 0,
    });
    expect(screen.getByRole('progressbar').getAttribute('aria-valuetext')).toBe('No children');
  });

  test('the ring is the same in the "List" and "Tree" modes', () => {
    // The ring belongs to the section header, not to the mode body. ONE render
    // with a switch is checked: two separate renders would compare
    // the harness too, not only the ring markup.
    layeredState.tree = [childNode('demo-32.1', { status: 'closed' })];
    const { container } = draw({
      totalChildren: 4,
      closedChildren: 3,
      openChildren: 0,
      inProgressChildren: 1,
      doneChildren: 1,
      noWorkChildren: 2,
      countedChildren: 2,
    });

    const ringState = () => {
      const bar = screen.getByRole('progressbar');
      return {
        percent: container.querySelector('.epic-ring-percent')?.textContent ?? null,
        text: bar.getAttribute('aria-valuetext'),
        now: bar.getAttribute('aria-valuenow'),
        max: bar.getAttribute('aria-valuemax'),
        counters: container.querySelector('.epic-progress-counters')?.textContent ?? null,
      };
    };

    const list = ringState();
    fireEvent.click(screen.getByRole('radio', { name: 'Tree' }));
    // Harness guard: the mode really switched, otherwise the comparison
    // would compare the "List" with itself.
    expect(screen.getByRole('radio', { name: 'Tree' }).getAttribute('aria-checked')).toBe('true');
    expect(ringState()).toEqual(list);
  });
});
