/**
 * sk-674.18 T055 — a person who left the space, and a deleted account,
 * wherever people are shown (row 245; spec INV-18, US-13;
 * screens 1.10).
 *
 * A departed person keeps the name, with the WORD "left" beside it — an
 * accessible text, not a colour. A deleted account is its permanent
 * pseudonym: the old name nowhere, no profile link, no avatar. A person
 * with no state reads as before. Checked on the three surfaces the row
 * names: the people chain of the card, a mention, and the people of the
 * assignee filter (through the real `TasksColumn`).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '../i18n/config';
import type { IssueDetail, IssueSummary } from '../api/issues';
import type { ProjectMember } from '../api/projects';

let members: ProjectMember[] = [];
/** The board useTasks hands the column: a project, or «All projects» / Delegated. */
let board: { resolvedProjectId: string | null; loadedAssignees: unknown[]; delegateeAssignees: unknown[] } = {
  resolvedProjectId: 'proj-uuid-1',
  loadedAssignees: [],
  delegateeAssignees: [],
};

vi.mock('../lib/useTasks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/useTasks')>();
  return {
    ...actual,
    useTasks: () => ({
      data: [] as IssueSummary[],
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
      resolvedProjectId: board.resolvedProjectId,
      delegateeAssignees: board.delegateeAssignees,
      loadedAssignees: board.loadedAssignees,
      cacheKey: ['tasks', 'test'],
    }),
  };
});
vi.mock('../lib/useProjectsList', () => ({
  projectsListQueryKey: ['projects', 'list', 'shell'],
  useProjectsList: () => ({ data: { items: [] }, isLoading: false, isError: false }),
  useProjectsInfinite: () => ({
    items: [], total: 0, isLoading: false, isFetching: false, isFetchingNextPage: false,
    isError: false, hasNextPage: false, fetchNextPage: () => {},
  }),
}));
vi.mock('../lib/useProjectByHandle', () => ({
  useProjectByHandle: () => ({ project: null, isLoading: false, isError: false }),
}));
vi.mock('../lib/useReminders', () => ({
  useRingingIssueIds: () => new Set<string>(),
  useRingingTaskCount: () => 0,
  useRemindersList: () => ({ reminders: [], ringingTaskCount: 0, isLoading: false, error: null }),
}));
vi.mock('../api/components', () => ({ listComponents: async () => [] }));
vi.mock('../api/projects', () => ({ listMembers: async () => members }));
vi.mock('../api/users', () => ({ listUserDirectory: async () => ({ items: [], hasMore: false }) }));
vi.mock('../auth/AuthContext', () => ({
  useAuthOptional: () => null,
  useAuth: () => ({ user: { id: 'u-1', username: 'admin' } }),
}));

import { UserMention } from './UserMention';
import { MarkdownView } from '../pages/shell/details/MarkdownView';
import { PeopleChain } from '../pages/shell/details/PeopleChain';
import { LayoutProvider } from '../lib/useLayoutState';
import { TasksUiStateProvider } from '../lib/useTasksUiState';
import { TasksColumn } from '../pages/shell/TasksColumn';

const DEPARTED = { departed: true, deleted: false, pseudonym: null };
const DELETED = { departed: false, deleted: true, pseudonym: 'deleted-7f3a' };

beforeEach(async () => {
  await i18n.changeLanguage('ru');
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function inRouter(node: React.ReactNode) {
  return render(<MemoryRouter>{node}</MemoryRouter>);
}

describe('row 245 — a mention', () => {
  test('departed → the name with "left" as text, no profile link', () => {
    const { container } = inRouter(<UserMention username="oleg" userId="u-oleg" status={DEPARTED} />);
    expect(container.textContent).toBe(`@oleg · ${i18n.t('common:person.departed')}`);
    expect(screen.queryByRole('link')).toBeNull();
  });

  test('deleted → the pseudonym, the old name nowhere, no profile link', () => {
    const { container } = inRouter(<UserMention username="oleg" userId="u-oleg" status={DELETED} />);
    expect(container.textContent).toBe(`@deleted-7f3a · ${i18n.t('common:person.deleted')}`);
    expect(container.innerHTML).not.toContain('oleg');
    expect(screen.queryByRole('link')).toBeNull();
  });

  // sk-674.18 T055 (INV-18) — a deleted account whose
  // pseudonym did not come never falls back to the old name.
  test('deleted without a pseudonym → a neutral name, the old name nowhere, no link', () => {
    const { container } = inRouter(
      <UserMention username="oleg" userId="u-oleg" status={{ deleted: true, pseudonym: null }} />,
    );
    expect(container.textContent).toContain(i18n.t('common:person.deletedName'));
    expect(container.innerHTML).not.toContain('oleg');
    expect(screen.queryByRole('link')).toBeNull();
  });

  test('no state → as before: the name, a link to the profile', () => {
    inRouter(<UserMention username="oleg" userId="u-oleg" />);
    expect(screen.getByRole('link', { name: '@oleg' }).getAttribute('href')).toBe('/users/oleg');
  });
});

// sk-674.18 T055 (review C3) — a mention inside a text (description,
// notes, a comment body) goes MarkdownView → renderTextWithMentions →
// UserMention; the state rides on the mention reference (`MentionRef.status`).
describe('row 245 — a mention in a text', () => {
  test('a departed person mentioned in a text → "left", no profile link', async () => {
    const { container } = inRouter(
      <MarkdownView
        text="ask @oleg please"
        mentions={[{ username: 'oleg', userId: 'u-oleg', status: DEPARTED }]}
      />,
    );
    await vi.waitFor(() =>
      expect(container.textContent).toContain(`@oleg · ${i18n.t('common:person.departed')}`),
    );
    expect(screen.queryByRole('link')).toBeNull();
  });

  test('without a state (positive control) → the mention links to the profile, as before', async () => {
    inRouter(<MarkdownView text="ask @oleg please" mentions={[{ username: 'oleg', userId: 'u-oleg' }]} />);
    expect((await screen.findByRole('link', { name: '@oleg' })).getAttribute('href')).toBe('/users/oleg');
  });
});

function card(over: Partial<IssueDetail>): IssueDetail {
  return {
    id: 'sk-42',
    projectId: 'p1',
    createdBy: 'u-anna',
    createdByUsername: 'anna',
    assignee: 'oleg',
    previousAssigneeUsernames: [],
    dismissedByUsernames: [],
    ...over,
  } as IssueDetail;
}

describe('row 245 — the people chain of the card', () => {
  test('a departed assignee → "left" beside the name', () => {
    render(<PeopleChain issue={card({ assigneeStatus: DEPARTED })} />);
    const chain = screen.getByRole('group');
    expect(chain.textContent).toContain(`oleg · ${i18n.t('common:person.departed')}`);
    // The author has no state: as before.
    expect(chain.textContent).not.toContain('anna ·');
  });

  test('a deleted author → the pseudonym, not the snapshot name', () => {
    render(
      <PeopleChain issue={card({ createdByUsername: 'anna', createdByStatus: { ...DELETED, pseudonym: 'deleted-0b1c' } })} />,
    );
    const chain = screen.getByRole('group');
    expect(chain.textContent).toContain(`deleted-0b1c · ${i18n.t('common:person.deleted')}`);
    expect(chain.textContent).not.toContain('anna');
  });

  test('author & assignee in one, deleted → the pseudonym without an avatar', () => {
    const { container } = render(
      <PeopleChain
        issue={card({ createdByUsername: 'anna', assignee: 'anna', createdByStatus: { ...DELETED, pseudonym: 'deleted-0b1c' } })}
      />,
    );
    const chain = screen.getByRole('group');
    expect(chain.textContent).toContain(`deleted-0b1c · ${i18n.t('common:person.deleted')}`);
    expect(chain.textContent).not.toContain('anna');
    // No avatar or anything else carrying the old name.
    expect(container.innerHTML).not.toContain('anna');
  });
});

async function openAssigneeFilter(outboxMode = false, path = '/projects/demo') {
  // The filters panel open, in its default combobox layout.
  window.localStorage.setItem('skein.layout.task-filters-collapsed', 'false');
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MantineProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route
              path={path === '/' ? '/' : '/projects/:alias'}
              element={
                <LayoutProvider>
                  <TasksUiStateProvider>
                    <TasksColumn width={468} collapsed={false} outboxMode={outboxMode} onMeMode={false} budilnikMode={false} />
                  </TasksUiStateProvider>
                </LayoutProvider>
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
  const input = await screen.findByRole('textbox', { name: i18n.t('filters:labels.assignee') });
  fireEvent.click(input);
  return screen.findByRole('listbox');
}

const departedOption = (name: string) => `${name} · ${i18n.t('common:person.departed')}`;
const deletedOption = (name: string) => `${name} · ${i18n.t('common:person.deleted')}`;

describe('row 245 — the people of the assignee filter', () => {
  beforeEach(() => {
    board = { resolvedProjectId: 'proj-uuid-1', loadedAssignees: [], delegateeAssignees: [] };
  });

  test('a project: a departed member is offered with "left", a deleted one by the pseudonym', async () => {
    members = [
      { userId: 'u-oleg', username: 'oleg', name: 'Oleg', role: 'member', ...DEPARTED } as ProjectMember,
      { userId: 'u-x', username: 'deleted-7f3a', name: '', role: 'member', ...DELETED } as ProjectMember,
      { userId: 'u-ira', username: 'ira', name: 'Ira', role: 'member' } as ProjectMember,
    ];
    const list = await openAssigneeFilter();
    await vi.waitFor(() => expect(within(list).getByRole('option', { name: departedOption('Oleg') })).toBeTruthy());
    expect(within(list).getByRole('option', { name: deletedOption('deleted-7f3a') })).toBeTruthy();
    // No state: the name as before.
    expect(within(list).getByRole('option', { name: 'Ira' })).toBeTruthy();
  });

  test('«All projects» / a space: the assignees of the board carry their state', async () => {
    board = {
      resolvedProjectId: null,
      loadedAssignees: [
        { username: 'oleg', userId: 'u-oleg', status: DEPARTED },
        { username: 'ira', userId: 'u-ira' },
      ],
      delegateeAssignees: [],
    };
    const list = await openAssigneeFilter(false, '/');
    await vi.waitFor(() => expect(within(list).getByRole('option', { name: departedOption('oleg') })).toBeTruthy());
    expect(within(list).getByRole('option', { name: 'ira' })).toBeTruthy();
  });

  test('Delegated: the delegatees carry their state', async () => {
    board = {
      resolvedProjectId: null,
      loadedAssignees: [],
      delegateeAssignees: [{ username: 'oleg', userId: 'u-oleg', status: DEPARTED }],
    };
    const list = await openAssigneeFilter(true);
    await vi.waitFor(() => expect(within(list).getByRole('option', { name: departedOption('oleg') })).toBeTruthy());
  });
});
