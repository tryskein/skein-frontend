/**
 * sk-421.3 T20 (P-21, SC-004, A15) — the lifetime boundary of the UNSAVED grouping
 * choice: a PANEL-level stand.
 *
 * ─── Why a panel-level stand, not a section-level one ──────────────
 *
 * The SC-004 acceptance separates two cases, and it is not the section that tells them apart:
 *
 *   · «the section was not interrupted» — the panel kept rendering the section,
 *     the unsaved choice holds (P-20, checked at the section level
 *     in `EpicProgressSection.test.tsx`);
 *   · «the section was interrupted» — on the way to the new card the panel stopped
 *     rendering the section, and the choice is lost (P-21, this file).
 *
 * The decision to show the section is made by the PANEL: card loading, card
 * failure and the issue-type condition live in `IssueDetailPanel`, not in
 * the section. A section-level test does not reach them: it replaces
 * `useLayeredTree`, while the panel reads `useIssueDetail`.
 *
 * ─── A finding against the paper ───────────────────────────────────
 *
 * The test plan (N-5, D-1) and the T20 brief claim that a stand at the level of
 * `IssueDetailPanel` does NOT exist in the repository and must be built from scratch.
 * That is wrong: `crossProjectNavigation.test.tsx` mounts the REAL
 * panel, stubbing unrelated sections and seeding `useIssueDetail` through the
 * `QueryClient` cache, and even checks both halves of the needed mechanism —
 * with a cache the section root survives a card switch as the same DOM node, without
 * a cache the loading frame carries it away. This file is built on the same technique, and
 * does not invent a second one.
 *
 * ─── Which interruption path is chosen and why exactly it ──────────
 *
 * There are three paths (loading, card failure, type condition). Taken here is
 * the TYPE CONDITION: both cards are in the cache, so no network is needed
 * at all, and the interruption happens deterministically — a non-epic simply has
 * no section. The loading path on the same stand would leave the card without
 * data (the network is closed), and the section would not come back, so there would be nothing
 * to check the RETURN to the saved value against.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { IssueDetail, IssueTreeNode } from '../../../../api/issues';
import type { DependencyList } from '../../../../api/dependencies';
import { LayoutProvider } from '../../../../lib/useLayoutState';
import {
  issueDependenciesKey,
  issueDetailKey,
  issueWatchersKey,
} from '../../../../lib/useIssueDetail';
import { layeredTreeQueryKey } from '../../../../lib/useLayeredTree';
import { resetEpicSectionClockForTests } from '../../../../lib/epicSectionClock';

vi.mock('../../../../lib/useProjectComponentNames', () => ({
  useProjectComponentNames: () => ({ status: 'pending', data: undefined }),
}));

const USER = 'u-lifetime';
vi.mock('../../../../auth/AuthContext', () => ({
  // sk-551.8 — LayoutProvider reads the layout via useNavLayoutOptional;
  // null = no session known, the side-by-side layout.
  useAuthOptional: () => null,
  useAuth: () => ({
    user: { id: 'u-lifetime', username: 'life', role: 'user' },
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

// Unrelated sections are stubbed: otherwise each would hit the network, which this
// stand does not have. The epic section is real, it is the subject.
vi.mock('./ActivitySection', () => ({ ActivitySection: () => null }));
vi.mock('./AttachmentsSection', () => ({ AttachmentsSection: () => null }));
vi.mock('./ClosedReasonSection', () => ({ ClosedReasonSection: () => null }));
vi.mock('./CommentsSection', () => ({ CommentsSection: () => null }));
vi.mock('./CommitsSection', () => ({ CommitsSection: () => null }));
vi.mock('./DependenciesSection', () => ({ DependenciesSection: () => null }));
vi.mock('./EditableTextSection', () => ({ EditableTextSection: () => null }));
vi.mock('./RemindersSection', () => ({ RemindersSection: () => null }));
vi.mock('./ReviewFlagSection', () => ({ ReviewFlagSection: () => null }));
vi.mock('./WatchersSection', () => ({ WatchersSection: () => null }));
vi.mock('./BlockedBySection', () => ({ BlockedBySection: () => null }));
vi.mock('./IssuePropertiesRow', () => ({ IssuePropertiesRow: () => null }));
vi.mock('../PeopleChain', () => ({ PeopleChain: () => null }));
vi.mock('../IssueTitleEdit', () => ({ IssueTitleEdit: () => null }));
vi.mock('../../../../lib/useReminders', async (importActual) => {
  const actual = await importActual<typeof import('../../../../lib/useReminders')>();
  return { ...actual, useIssueReminders: () => [] };
});
vi.mock('../../../../lib/useProjectByHandle', async (importActual) => {
  const actual = await importActual<typeof import('../../../../lib/useProjectByHandle')>();
  return {
    ...actual,
    useProjectByHandle: (handle: string | null) => ({
      project: handle ? { id: handle, idPrefix: handle, name: handle } : null,
      isLoading: false,
      isUnresolved: false,
    }),
  };
});

import { IssueDetailPanel } from '../IssueDetailPanel';

const EPIC_ID = 'lf-1';
const TASK_ID = 'lf-2';
const GROUPING_KEY = `skein.epic.sectionGrouping.${USER}`;
const NO_DEPS: DependencyList = { outgoing: [], incoming: [] };

function base(over: Partial<IssueDetail>): IssueDetail {
  return {
    id: EPIC_ID,
    projectId: 'proj-a',
    version: 1,
    title: 'card',
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
    isBlocked: false,
    blockers: [],
    ...over,
  } as IssueDetail;
}

const EPIC = base({
  id: EPIC_ID,
  title: 'epic',
  type: 'epic',
  epic: {
    totalChildren: 2,
    openChildren: 1,
    inProgressChildren: 1,
    closedChildren: 0,
    blockedChildren: 0,
    eligibleForClose: false,
  },
} as Partial<IssueDetail>);

/** A plain task: the panel has NO epic section for it — that is the interruption. */
const TASK = base({ id: TASK_ID, title: 'plain task', type: 'task' });

function treeItem(id: string, status: string) {
  return {
    id,
    projectId: 'proj-a',
    version: 1,
    title: id,
    type: 'task',
    priority: 2,
    status,
    pinned: false,
    componentIds: [],
    labels: [],
    isBlocked: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
  } as IssueTreeNode['item'];
}

const TREE: IssueTreeNode[] = [
  { item: treeItem(EPIC_ID, 'open'), depth: 0, parentRef: null, isReference: false, firstSeenAt: null },
  {
    item: treeItem('lf-1.1', 'open'),
    depth: 1,
    parentRef: { id: EPIC_ID, edgeType: 'parent-child' },
    isReference: false,
    firstSeenAt: null,
  },
  {
    item: treeItem('lf-1.2', 'in_progress'),
    depth: 1,
    parentRef: { id: EPIC_ID, edgeType: 'parent-child' },
    isReference: false,
    firstSeenAt: null,
  },
];

/**
 * A cache with ALL the stand's cards: the network is closed, and `staleTime: Infinity`
 * prevents refetching the seeded data. So there is no loading frame on any
 * switch — the interruption happens only where it is caused on purpose.
 */
function seededClient(): QueryClient {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  for (const value of [EPIC, TASK]) {
    qc.setQueryData(issueDetailKey(value.id), value);
    qc.setQueryData(issueDependenciesKey(value.projectId, value.id), NO_DEPS);
    qc.setQueryData(issueWatchersKey(value.id), []);
  }
  // sk-460.12 — ONE key for both modes. Before, two were seeded, one per
  // mode key: «List» went for depth 1. The scope is merged, the request is
  // shared by the modes — and a second seed would become an entry nobody
  // reads, that is, a silent prop under the stand.
  const payload = { rows: TREE, requestedAt: Date.now() };
  qc.setQueryData(layeredTreeQueryKey(null, EPIC_ID, ['parent-child'], undefined, true), payload);
  return qc;
}

function mountPanel(issueId: string) {
  const qc = seededClient();
  const ui = (id: string) => (
    <MantineProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`/projects/proj-a/issues/${id}`]}>
          <LayoutProvider>
            <IssueDetailPanel issueId={id} projectHandle="proj-a" />
          </LayoutProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>
  );
  const view = render(ui(issueId));
  return { ...view, show: (id: string) => view.rerender(ui(id)) };
}

const organ = (c: HTMLElement) => c.querySelector<HTMLButtonElement>('.epic-group-toggle');
const groupsOf = (c: HTMLElement) => c.querySelector('.epic-children-groups');

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new TypeError('offline');
    }),
  );
  window.localStorage.clear();
  resetEpicSectionClockForTests();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('sk-421.3 T20 — P-21: an unsaved choice and an INTERRUPTION of the section', () => {
  test('the stand is sound: the real panel shows the epic section and the grouping control', async () => {
    // Without this everything below is green "because nothing was found": an empty
    // panel satisfies any assertion of absence.
    const view = mountPanel(EPIC_ID);
    await waitFor(() => expect(view.container.querySelector('.epic-progress')).not.toBeNull());
    await waitFor(() => expect(organ(view.container)).not.toBeNull());
    expect(groupsOf(view.container), 'default A1 — grouping is on').not.toBeNull();
  });

  test('on the way to the new card the section STOPPED rendering → the unsaved choice is lost', async () => {
    const view = mountPanel(EPIC_ID);
    await waitFor(() => expect(organ(view.container)).not.toBeNull());

    // The choice is made with a broken WRITE: it does not reach the disk, so it
    // lives exactly as long as the section does. That is the
    // discriminating input — with a saved choice the test would pass even on code
    // that simply re-read the disk.
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    try {
      fireEvent.click(organ(view.container)!);
      expect(groupsOf(view.container), 'the choice was not applied').toBeNull();
      expect(window.localStorage.getItem(GROUPING_KEY), 'the choice is saved after all').toBeNull();

      // INTERRUPTION: the panel shows a non-epic, and has no section.
      view.show(TASK_ID);
      expect(
        view.container.querySelector('.epic-progress'),
        'the section was not interrupted — the check proves the wrong thing',
      ).toBeNull();

      // Back to the epic: the section mounts anew and reads the storage.
      view.show(EPIC_ID);
      await waitFor(() => expect(view.container.querySelector('.epic-progress')).not.toBeNull());
    } finally {
      setItem.mockRestore();
    }

    // The unsaved choice did not survive the interruption: the default applies.
    await waitFor(() => expect(groupsOf(view.container)).not.toBeNull());
  });

  test('the difference from P-20 rests on the INTERRUPTION, not on a card switch as such', async () => {
    // The half without which the previous test proves nothing: by itself
    // a move between cards does NOT remount the section (the panel is
    // rendered without `key`), and the choice survives it. It is lost exactly
    // when the section stopped rendering.
    //
    // Here the SAVED choice cannot be checked — it would come back from disk
    // either way. So the DOM node identity is checked:
    // an «epic → epic» move does not touch the section at all.
    const view = mountPanel(EPIC_ID);
    await waitFor(() => expect(view.container.querySelector('.epic-progress')).not.toBeNull());
    const rootBefore = view.container.querySelector('.epic-progress');

    view.show(EPIC_ID);

    expect(
      view.container.querySelector('.epic-progress'),
      'the panel remounted the section where it should not have',
    ).toBe(rootBefore);
  });
});
