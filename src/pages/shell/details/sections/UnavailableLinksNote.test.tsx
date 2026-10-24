/**
 * sk-479 (api contract sk-423) — the issue card when an issue is linked to one
 * from an unavailable project. The real IssueDetailPanel, DetailsHeader,
 * BlockedBySection and UnavailableLinksNote in ONE render: the assertion
 * «does not look blocked» is a relation between the status outline in the header,
 * the «Blocked» block and the links line, and it cannot be checked separately.
 *
 * Two response shapes:
 *   - new api (sk-423): no hidden entries, `isBlocked` counts visible
 *     blockers only, `unavailableBlockingLinks` is always a number;
 *   - old api (before sk-423): no such field, a hidden blocker arrives as an entry
 *     `{id, redacted: true}` and counts in `isBlocked` — the card draws it
 *     as before (lock + «unavailable»), no links line.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { BlockerRef, IssueDetail } from '../../../../api/issues';
import i18n, { DEFAULT_LANGUAGE } from '../../../../i18n/config';

const layout = vi.hoisted(() => ({
  setSelectedIssue: vi.fn(),
  clearSelectedIssue: vi.fn(),
  selectedProject: 'test' as string | null,
  outboxMode: false,
}));
vi.mock('../../../../lib/useLayoutState', () => ({
  useLayoutState: () => layout,
}));

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

const panel = vi.hoisted(() => ({ issue: undefined as unknown }));
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
    dependencies: { outgoing: [], incoming: [] },
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

import { IssueDetailPanel } from '../IssueDetailPanel';

/** Issue detail; `extra` may also drop a key (old api) — see `oldApi`. */
function issue(over: Record<string, unknown> = {}): IssueDetail {
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
    isBlocked: false,
    blockers: [],
    ...over,
  } as unknown as IssueDetail;
}

/** Old api response: the `unavailableBlockingLinks` key is absent altogether. */
function oldApi(over: Record<string, unknown>): IssueDetail {
  const value = issue(over) as unknown as Record<string, unknown>;
  delete value.unavailableBlockingLinks;
  expect('unavailableBlockingLinks' in value).toBe(false);
  return value as unknown as IssueDetail;
}

function renderPanel(value: IssueDetail) {
  panel.issue = value;
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

/** Three card surfaces taken from ONE render. */
function surfaces(container: HTMLElement) {
  const status = container.querySelector('.header-status');
  expect(status, 'the real header rendered the status').not.toBeNull();
  const note = container.querySelector('.unavailable-links-note');
  return {
    // The header's blocked mark, read off the trigger's accessible name
    // (both locales) — the channel that carries it alongside the outline.
    outline: /\((blocked by dependencies|заблокировано зависимостями)\)$/.test(
      status!.getAttribute('aria-label') ?? '',
    ),
    block: container.querySelector('.blocked-by') !== null,
    note: note?.textContent ?? null,
    noteEl: note,
  };
}

afterEach(async () => {
  cleanup();
  vi.clearAllMocks();
  if (i18n.language !== DEFAULT_LANGUAGE) {
    await i18n.changeLanguage(DEFAULT_LANGUAGE);
  }
});

const EXPLAIN_EN =
  'Not counted as blocking: their status is hidden from you. The task may still be waiting on them even though it is not marked blocked.';

describe('new api (sk-423) — a link to an unavailable issue is not a block', () => {
  test('blocked ONLY by an unavailable one: no outline, no block; a separate line with the count and the explanation', () => {
    const { container } = renderPanel(
      issue({ isBlocked: false, blockers: [], unavailableBlockingLinks: 2 }),
    );
    const got = surfaces(container);
    expect({ outline: got.outline, block: got.block }).toEqual({ outline: false, block: false });
    expect(got.note).toBe(`Linked to 2 tasks in projects you cannot access${EXPLAIN_EN}`);
    // Not a row of the blockers block and not inside its red frame.
    expect(got.noteEl!.closest('.blocked-by')).toBeNull();
    expect(container.textContent).not.toContain('Blocked by:');
    expect(container.textContent).not.toContain('unavailable');
  });

  test('0 — no line, the card as without links', () => {
    const { container } = renderPanel(
      issue({ isBlocked: false, blockers: [], unavailableBlockingLinks: 0 }),
    );
    expect(surfaces(container)).toMatchObject({ outline: false, block: false, note: null });
  });

  test('a visible blocker and an unavailable link: the block holds only the visible one, the links line is separate, in the singular', () => {
    const visible: BlockerRef[] = [{ id: 'sk-3', title: 'Visible blocker', status: 'in_progress' }];
    const { container } = renderPanel(
      issue({ isBlocked: true, blockers: visible, unavailableBlockingLinks: 1 }),
    );
    const got = surfaces(container);
    expect({ outline: got.outline, block: got.block }).toEqual({ outline: true, block: true });
    const rows = container.querySelectorAll('.blocked-by-row');
    expect(rows).toHaveLength(1);
    expect(container.querySelector('.blocked-by-row--hidden')).toBeNull();
    expect(got.note).toBe(`Linked to 1 task in projects you cannot access${EXPLAIN_EN}`);
    // The blockers block comes BEFORE the links line.
    const block = container.querySelector('.blocked-by')!;
    expect(block.compareDocumentPosition(got.noteEl!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test.each(['closed', 'standing'] as const)(
    '%s — no line: the issue has no readiness question',
    (status) => {
      const { container } = renderPanel(
        issue({ status, isBlocked: false, blockers: [], unavailableBlockingLinks: 3 }),
      );
      expect(surfaces(container).note).toBeNull();
    },
  );

  test.each([
    [1, 'Связь с 1 задачей из недоступных проектов'],
    [2, 'Связь с 2 задачами из недоступных проектов'],
    [5, 'Связь с 5 задачами из недоступных проектов'],
    [21, 'Связь с 21 задачей из недоступных проектов'],
  ])('ru, %d → «%s»', async (count, text) => {
    await i18n.changeLanguage('ru');
    const { container } = renderPanel(
      issue({ isBlocked: false, blockers: [], unavailableBlockingLinks: count }),
    );
    expect(container.querySelector('.unavailable-links-note-count')?.textContent).toBe(text);
    expect(container.querySelector('.unavailable-links-note-explain')?.textContent).toBe(
      'Не считается блокировкой: статус этих задач вам не виден. Задача может ждать их, даже если не отмечена заблокированной.',
    );
  });
});

describe('old api (before sk-423) — no field, a hidden blocker entry', () => {
  test('hidden blocker in isBlocked: the card as before (outline, «unavailable»), no links line', () => {
    const { container } = renderPanel(
      oldApi({ isBlocked: true, blockers: [{ id: 'hidden-9', redacted: true }] }),
    );
    const got = surfaces(container);
    expect({ outline: got.outline, block: got.block, note: got.note }).toEqual({
      outline: true,
      block: true,
      note: null,
    });
    const hidden = container.querySelector('.blocked-by-row--hidden');
    expect(hidden?.textContent).toBe('unavailable');
    expect(container.innerHTML).not.toContain('hidden-9');
  });

  test('not blocked and no field — nothing, no error', () => {
    const { container } = renderPanel(oldApi({ isBlocked: false, blockers: [] }));
    expect(surfaces(container)).toMatchObject({ outline: false, block: false, note: null });
  });
});
