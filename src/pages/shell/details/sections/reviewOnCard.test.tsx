/**
 * sk-303.14 (T030, matrix rows 97, 98, 108) — the review workflow ON THE CARD.
 *
 * Two levels, and both are needed:
 *
 *   - the two section components, where the render rules live (a closed issue
 *     with no written reason still shows the block and the action; a reopened
 *     one shows neither);
 *   - `IssueDetailPanel`, where AUTHORSHIP is decided. That decision is a
 *     single comparison, and a wrong one — against the assignee, or against
 *     the username instead of the id — is exactly the INV-2 breach the rows
 *     exist to catch. It is invisible to a section test, which is handed
 *     `isAuthor` already computed, so it is pinned where it is made.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { IssueDetail } from '../../../../api/issues';

// ─────────────────────────── Fixtures ───────────────────────────

const AUTHOR_ID = 'u-author';
const OTHER_ID = 'u-somebody-else';

function issue(over: Partial<IssueDetail> = {}): IssueDetail {
  return {
    id: 'sk-1',
    projectId: 'proj-uuid-test',
    version: 3,
    title: 'delegated task',
    description: '',
    type: 'task',
    priority: 2,
    status: 'closed',
    pinned: false,
    source: 'human',
    design: '',
    acceptanceCriteria: '',
    notes: '',
    createdBy: AUTHOR_ID,
    createdByUsername: 'author',
    createdAt: '2026-05-01T09:00:00Z',
    updatedAt: '2026-05-01T10:00:00Z',
    metadata: {},
    componentIds: [],
    labels: [],
    commentsCount: 0,
    commitRefs: [],
    mentions: [],
    isBlocked: false,
    blockers: [],
    closedAt: '2026-05-02T10:00:00Z',
    // The default fixture is the row-108 shape: closed, NO reason text.
    closedReason: null,
    assignee: 'bob',
    reviewRequired: true,
    ...over,
  } as unknown as IssueDetail;
}

function wrap(node: ReactNode) {
  return render(<MantineProvider>{node}</MantineProvider>);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ───────────────── the section components ─────────────────

import { ClosedReasonSection } from './ClosedReasonSection';
import { ReviewFlagSection } from './ReviewFlagSection';

describe('row 108 — a close with NO reason text still carries the section and the action', () => {
  test('the block renders, and the mark is in it', () => {
    wrap(
      <ClosedReasonSection issue={issue()} isAuthor onMarkReviewed={vi.fn()} />,
    );
    // Where the action lives must not depend on whether somebody happened
    // to type a sentence when closing (Q2 → A2, US-1).
    expect(screen.getByLabelText('Close reason')).toBeTruthy();
    expect(screen.getByTestId('mark-reviewed')).toBeTruthy();
  });

  test('with reason text the block ALSO shows the text — the action is unchanged', () => {
    wrap(
      <ClosedReasonSection
        issue={issue({ closedReason: 'done, see the diffs' })}
        isAuthor
        onMarkReviewed={vi.fn()}
      />,
    );
    expect(screen.getByText('done, see the diffs')).toBeTruthy();
    expect(screen.getByTestId('mark-reviewed')).toBeTruthy();
  });

  test('clicking the mark calls the action once, with the card still on screen', () => {
    const onMark = vi.fn();
    wrap(
      <ClosedReasonSection issue={issue()} isAuthor onMarkReviewed={onMark} />,
    );
    screen.getByTestId('mark-reviewed').click();
    expect(onMark).toHaveBeenCalledTimes(1);
  });

  test('once marked, the mark is replaced by the fact of it — not offered twice', () => {
    wrap(
      <ClosedReasonSection
        issue={issue({ reviewedAt: '2026-05-03T08:00:00Z' })}
        isAuthor
        onMarkReviewed={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('mark-reviewed')).toBeNull();
    expect(screen.getByTestId('review-mark-done')).toBeTruthy();
  });

  test('a cleared flag withdraws the mark — the author already said no', () => {
    // US-1: a cleared flag is a stated "I don't care", the server
    // refuses the mark with `review_flag_cleared`, and a button that can
    // only fail is worse than no button.
    wrap(
      <ClosedReasonSection
        issue={issue({ reviewRequired: false })}
        isAuthor
        onMarkReviewed={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Close reason')).toBeTruthy();
    expect(screen.queryByTestId('mark-reviewed')).toBeNull();
  });
});

describe('row 98 — a reopened, still-unclosed issue shows no mark', () => {
  test('the whole close block is gone, and the mark with it', () => {
    // A mark here would read as "result read" while the work is
    // visibly running.
    //
    // The fixture carries `reviewedAt` on purpose: the NAMED scenario of
    // row 98 is "marked, then reopened" — the mark was placed, it
    // SURVIVES on the server (it is not withdrawn by a reopen), and the
    // card must nevertheless stop showing it. A fixture without it proves
    // only the easy half: a status gate that fell through whenever a mark
    // existed would draw «👁 Reviewed» over running work and pass.
    wrap(
      <ClosedReasonSection
        issue={issue({
          status: 'in_progress',
          closedReason: 'first pass',
          reviewedAt: '2026-05-03T08:00:00Z',
        })}
        isAuthor
        onMarkReviewed={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText('Close reason')).toBeNull();
    expect(screen.queryByTestId('mark-reviewed')).toBeNull();
    // Neither the action NOR the fact of an earlier mark.
    expect(screen.queryByTestId('review-mark-done')).toBeNull();
    expect(screen.queryByText(/Reviewed/)).toBeNull();
  });

  test('…but the FLAG stays reachable on the unclosed issue (US-3)', () => {
    // Clearing the flag before the close is how the result never enters the
    // set in the first place, so the flag must not disappear with the mark.
    wrap(
      <ReviewFlagSection
        issue={issue({ status: 'in_progress' })}
        isAuthor
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId('review-required-switch')).toBeTruthy();
  });
});

describe('row 97 (sections) — the flag is the author’s, and it is controllable', () => {
  test('the switch reflects the stored flag and reports the flip', () => {
    const onChange = vi.fn();
    wrap(<ReviewFlagSection issue={issue()} isAuthor onChange={onChange} />);
    const sw = screen.getByTestId('review-required-switch') as HTMLInputElement;
    expect(sw.checked).toBe(true);
    sw.click();
    expect(onChange).toHaveBeenCalledWith(false);
  });

  test('a cleared flag renders as cleared, and can be turned back on', () => {
    const onChange = vi.fn();
    wrap(
      <ReviewFlagSection
        issue={issue({ reviewRequired: false })}
        isAuthor
        onChange={onChange}
      />,
    );
    const sw = screen.getByTestId('review-required-switch') as HTMLInputElement;
    expect(sw.checked).toBe(false);
    sw.click();
    expect(onChange).toHaveBeenCalledWith(true);
  });

  test('non-author sees no flag section at all', () => {
    wrap(
      <ReviewFlagSection issue={issue()} isAuthor={false} onChange={vi.fn()} />,
    );
    expect(screen.queryByTestId('review-required-switch')).toBeNull();
  });
});

// ───────────────── row 97 (wiring) — who counts as the author ─────────────────

/**
 * The panel is mounted for real, with the sections that fetch on their own
 * stubbed out. Everything the two review sections need travels through
 * `useIssueDetail`, which is mocked wholesale — so what remains under test is
 * precisely the panel's own decision about authorship.
 */
vi.mock('./ActivitySection', () => ({ ActivitySection: () => null }));
vi.mock('./AttachmentsSection', () => ({ AttachmentsSection: () => null }));
vi.mock('./CommentsSection', () => ({ CommentsSection: () => null }));
vi.mock('./CommitsSection', () => ({ CommitsSection: () => null }));
vi.mock('./DependenciesSection', () => ({ DependenciesSection: () => null }));
vi.mock('./EpicProgressSection', () => ({ EpicProgressSection: () => null }));
// sk-421.1 T014 — the properties row navigates with `useNavigate` (parent
// link; this file mounts no router) and reads the component directory; like
// its siblings above it is not what this file tests.
vi.mock('./IssuePropertiesRow', () => ({ IssuePropertiesRow: () => null }));
// sk-421.1 T015 — the «Blocked» block navigates with `useNavigate` too
// (blocker link).
vi.mock('./BlockedBySection', () => ({ BlockedBySection: () => null }));
vi.mock('./RemindersSection', () => ({ RemindersSection: () => null }));
vi.mock('./WatchersSection', () => ({ WatchersSection: () => null }));
vi.mock('../DetailsHeader', () => ({ DetailsHeader: () => null }));
vi.mock('../PeopleChain', () => ({ PeopleChain: () => null }));

vi.mock('../../../../lib/useProjectByHandle', () => ({
  useProjectByHandle: () => ({
    project: { id: 'proj-uuid-test', idPrefix: 'test', name: 'test' },
    isLoading: false,
    isUnresolved: false,
  }),
}));

vi.mock('../../../../lib/useReminders', () => ({
  useIssueReminders: () => ({ data: [], isLoading: false }),
}));

vi.mock('../../../../components/Toaster', () => ({
  useToaster: () => ({ error: vi.fn(), success: vi.fn() }),
}));

let mockUser: { id: string; username: string; role: string } | null = null;
vi.mock('../../../../auth/AuthContext', () => ({
  useAuth: () => ({ user: mockUser, isLoading: false, login: vi.fn(), logout: vi.fn() }),
}));

let mockIssue: IssueDetail;
const changeReviewRequired = vi.fn();
const markResultReviewed = vi.fn();
vi.mock('../../../../lib/useIssueDetail', () => ({
  issueWatchersKey: (id: string) => ['issue', id, 'watchers'] as const,
  issueDetailKey: (id: string) => ['issues', 'detail', id] as const,
  isStatusChangeFailure: () => false,
  useIssueDetail: () => ({
    issue: mockIssue,
    isLoading: false,
    isError: false,
    error: null,
    comments: [],
    attachments: [],
    dependencies: undefined,
    activity: [],
    watchers: [],
    issueQuery: { isLoading: false, isError: false },
    updateField: vi.fn(),
    changeStatus: vi.fn(),
    accept: vi.fn(),
    changeReviewRequired,
    markResultReviewed,
    reviewPending: false,
  }),
}));

import { IssueDetailPanel } from '../IssueDetailPanel';

function mountPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MantineProvider>
      <QueryClientProvider client={qc}>
        <IssueDetailPanel issueId="sk-1" projectHandle="test" />
      </QueryClientProvider>
    </MantineProvider>,
  );
}

describe('row 97 — the card shows the mechanic to the AUTHOR and to nobody else', () => {
  beforeEach(() => {
    mockIssue = issue();
  });

  test('the author gets both the flag and the mark, and both act', () => {
    mockUser = { id: AUTHOR_ID, username: 'author', role: 'user' };
    mountPanel();

    const sw = screen.getByTestId('review-required-switch') as HTMLInputElement;
    sw.click();
    expect(changeReviewRequired).toHaveBeenCalledWith(false);

    screen.getByTestId('mark-reviewed').click();
    expect(markResultReviewed).toHaveBeenCalledTimes(1);
  });

  test('the ASSIGNEE gets neither — and the close block still renders', () => {
    // The nastiest wrong comparison is against the assignee, and the second
    // nastiest is against the username: this reader is the assignee ('bob')
    // and has a different id, so either mistake lights the controls up here.
    mockUser = { id: OTHER_ID, username: 'bob', role: 'user' };
    mountPanel();

    expect(screen.queryByTestId('review-required-switch')).toBeNull();
    expect(screen.queryByTestId('mark-reviewed')).toBeNull();
    expect(screen.queryByTestId('review-mark-done')).toBeNull();
    // Not by hiding the close block from them — that would be a different,
    // visible change to their card. Only the mechanic is absent.
    expect(screen.getByLabelText('Close reason')).toBeTruthy();
  });

  test('an ADMIN who did not create it is refused exactly like anyone else (INV-4)', () => {
    mockUser = { id: OTHER_ID, username: 'admin', role: 'admin' };
    mountPanel();
    expect(screen.queryByTestId('review-required-switch')).toBeNull();
    expect(screen.queryByTestId('mark-reviewed')).toBeNull();
  });

  test('a non-author whose card carries a review mark is told nothing about it', () => {
    // Belt and braces on SC-028: even if a mark somehow reached this reader's
    // payload, the card must not render it. Authorship gates the display, not
    // the presence of the key.
    mockIssue = issue({ reviewedAt: '2026-05-03T08:00:00Z' });
    mockUser = { id: OTHER_ID, username: 'bob', role: 'user' };
    mountPanel();
    expect(screen.queryByTestId('review-mark-done')).toBeNull();
    expect(screen.queryByText(/Reviewed/)).toBeNull();
  });
});
