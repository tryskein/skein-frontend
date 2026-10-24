/**
 * sk-489 · review of wave F/1, BLOCKER-1 — a regression on the SEAM "header → panel →
 * hook → wire".
 *
 * ══ What is checked here and why it was missing ═══════════════════════════
 *
 * The close outcome picked in the modal passes through four hands:
 * `StatusChangeReasonModal` assembles it into `TransitionCloseInput`,
 * `DetailsHeader#submitReason` hands it over as the third argument of the prop
 * `onChangeStatus`, `IssueDetailPanel#onChangeStatus` moves it to the
 * FOURTH argument of `useIssueDetail#changeStatus` (the positions diverge
 * on purpose: the hook has `force` between them), and only the hook calls
 * `api/issues#transitionStatus`.
 *
 * There were tests at both ends — and none on the joint. The rig of
 * `DetailsHeader.test.tsx` reaches the PROP `onChangeStatus` and then
 * looks at a mock; `lib/__tests__/useIssueDetail.changeStatus.test.tsx`
 * starts from an already called `changeStatus`. The blocker lived in the gap between them:
 * the panel's arrow declared TWO parameters, the header's third argument
 * silently vanished, the task closed as "done", the link by target was not
 * created, there was no error. TypeScript does not catch this — a function with
 * fewer parameters is assignable to a type with more.
 *
 * So a REAL panel is mounted here with the real `DetailsHeader`
 * and `useIssueDetail`, and the mock stands on exactly one thing — `api/issues`, i.e.
 * on the wire. The assertion is about the FULL positional argument list of
 * `transitionStatus`: so it goes red also on the "obvious" fix
 * through `(...args)`, which would put the outcome into `force` and send
 * `?force=true`.
 *
 * ══ What this is NOT ═══════════════════════════════════════════════════════
 *
 * The rig is taken from `saveRefusalToast.test.tsx` — it mounts the card the same
 * way (a real hook, a mock on `api/issues`, neighbouring sections
 * stubbed). But it checks something ELSE: the display of a save REFUSAL — the toast at the
 * header fields, the reason under the editor, — and it asserts nothing about the close
 * wiring. What is more, its own card is a COPY of the stitching,
 * declared in the test itself; it does not execute the product arrow `IssueDetailPanel` at
 * all and so would have survived the blocker's return green.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const PID = 'proj-uuid-seam';
const ID = 'sk-78';
const VERSION = 3;

const api = vi.hoisted(() => ({
  getIssue: vi.fn(),
  patchIssue: vi.fn(),
  transitionStatus: vi.fn(),
}));

// The wire — and only it. Everything else on the outcome's path is real.
vi.mock('../../../api/issues', async (importActual) => {
  const actual = await importActual<typeof import('../../../api/issues')>();
  return {
    ...actual,
    getIssue: (...args: unknown[]) => api.getIssue(...args),
    patchIssue: (...args: unknown[]) => api.patchIssue(...args),
    transitionStatus: (...args: unknown[]) => api.transitionStatus(...args),
    listComments: () => Promise.resolve([]),
  };
});
vi.mock('../../../api/activity', () => ({
  listIssueActivity: () => Promise.resolve({ items: [], nextCursor: null }),
}));
vi.mock('../../../api/attachments', () => ({
  listAttachments: () => Promise.resolve({ items: [] }),
}));
vi.mock('../../../api/dependencies', () => ({
  listDependencies: () => Promise.resolve({ outgoing: [], incoming: [] }),
}));
vi.mock('../../../api/watchers', async (importActual) => {
  const actual = await importActual<typeof import('../../../api/watchers')>();
  return { ...actual, listIssueWatchers: () => Promise.resolve([]) };
});

// Sections that read their own and follow links: they have nothing to do with the
// seam — stubbed the same way as in `sections/reviewOnCard.test.tsx`.
vi.mock('./sections/ActivitySection', () => ({ ActivitySection: () => null }));
vi.mock('./sections/AttachmentsSection', () => ({ AttachmentsSection: () => null }));
vi.mock('./sections/CommentsSection', () => ({ CommentsSection: () => null }));
vi.mock('./sections/CommitsSection', () => ({ CommitsSection: () => null }));
vi.mock('./sections/DependenciesSection', () => ({ DependenciesSection: () => null }));
vi.mock('./sections/EpicProgressSection', () => ({ EpicProgressSection: () => null }));
vi.mock('./sections/IssuePropertiesRow', () => ({ IssuePropertiesRow: () => null }));
vi.mock('./sections/BlockedBySection', () => ({ BlockedBySection: () => null }));
vi.mock('./sections/RemindersSection', () => ({ RemindersSection: () => null }));
vi.mock('./sections/WatchersSection', () => ({ WatchersSection: () => null }));
vi.mock('./PeopleChain', () => ({ PeopleChain: () => null }));

vi.mock('../../../lib/useProjectByHandle', () => ({
  useProjectByHandle: () => ({
    project: { id: PID, idPrefix: 'sk', name: 'seam' },
    isLoading: false,
    isUnresolved: false,
  }),
}));
vi.mock('../../../lib/useReminders', () => ({
  useIssueReminders: () => [],
}));
vi.mock('../../../components/Toaster', () => ({
  useToaster: () => ({ error: vi.fn(), success: vi.fn() }),
}));
vi.mock('../../../auth/AuthContext', async (importActual) => {
  const actual = await importActual<typeof import('../../../auth/AuthContext')>();
  return {
    ...actual,
    useAuth: () => ({
      user: { id: 'u-1', username: 'carol', email: 'c@example.com', name: 'Carol', role: 'user' },
      isLoading: false,
      login: vi.fn(),
      logout: vi.fn(),
    }),
  };
});

import { LayoutProvider } from '../../../lib/useLayoutState';
import { IssueDetailPanel } from './IssueDetailPanel';

function fixture(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ID,
    projectId: PID,
    version: VERSION,
    title: 'seam fixture',
    description: '',
    acceptanceCriteria: '',
    notes: '',
    design: '',
    type: 'task',
    priority: 2,
    status: 'in_progress',
    pinned: false,
    source: 'human',
    createdBy: 'u-9',
    createdByUsername: 'dave',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    metadata: {},
    componentIds: [],
    labels: [],
    commentsCount: 0,
    commitRefs: [],
    mentions: [],
    isBlocked: false,
    blockers: [],
    assignee: 'dave',
    previousAssignees: [],
    dismissedBy: [],
    ...over,
  };
}

function mountPanel() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <MantineProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <LayoutProvider>
            <IssueDetailPanel issueId={ID} projectHandle="sk" />
          </LayoutProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

/** The user path: status → "closed" → outcome pick → confirmation. */
async function closeThroughTheModal(
  user: ReturnType<typeof userEvent.setup>,
  outcomeLabel: string,
  target?: string,
) {
  await user.click(await screen.findByRole('button', { name: 'Status: in_progress' }));
  // Mantine 7 hard-sets `role="menuitem"` on `Menu.Item` and ignores the passed
  // `menuitemradio` — the real role is queried (the same is
  // recorded in `DetailsHeader.test.tsx` and `StatusChangeReasonModal.test.tsx`).
  const dropdown = await screen.findByRole('menu');
  await user.click(within(dropdown).getByRole('menuitem', { name: 'closed' }));
  // A Mantine modal appears in the portal not in the same tick as the click.
  await user.click(await screen.findByRole('radio', { name: outcomeLabel }));
  if (target !== undefined) {
    await user.type(screen.getByLabelText(/target issue/i), target);
  }
  await user.click(screen.getByRole('button', { name: 'OK' }));
}

beforeEach(() => {
  api.getIssue.mockReset();
  api.patchIssue.mockReset();
  api.transitionStatus.mockReset();
  api.getIssue.mockImplementation(() => Promise.resolve(fixture()));
});

afterEach(() => {
  cleanup();
});

describe('sk-489 · F/1 BLOCKER-1 — the picked outcome reaches the wire', () => {
  test('"won\'t do" arrives in transitionStatus and is not lost on the way', async () => {
    api.transitionStatus.mockImplementation(() =>
      Promise.resolve(fixture({ status: 'closed', closeOutcome: 'wont_do', version: VERSION + 1 })),
    );
    const user = userEvent.setup();
    mountPanel();

    await closeThroughTheModal(user, "won't do");

    // The full positional list: it is the subject of the dispute. The sixth argument is
    // `force`, and an outcome that slid into it is red here, not "also true".
    expect(api.transitionStatus).toHaveBeenCalledTimes(1);
    expect(api.transitionStatus).toHaveBeenCalledWith(
      PID,
      ID,
      VERSION,
      'closed',
      undefined,
      undefined,
      { closeOutcome: 'wont_do' },
    );
  });

  test('"duplicate" carries the TARGET too — the second half of the pick (US-2)', async () => {
    api.transitionStatus.mockImplementation(() =>
      Promise.resolve(
        fixture({ status: 'closed', closeOutcome: 'duplicate', version: VERSION + 1 }),
      ),
    );
    const user = userEvent.setup();
    mountPanel();

    await closeThroughTheModal(user, 'duplicate', 'sk-9');

    expect(api.transitionStatus).toHaveBeenCalledWith(
      PID,
      ID,
      VERSION,
      'closed',
      undefined,
      undefined,
      { closeOutcome: 'duplicate', closeTarget: 'sk-9' },
    );
  });
});
