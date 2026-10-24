/**
 * sk-118 (§6, §11.8) — the "Create subtask" affordance REPLACES the
 * claim/start action on a standing task. A standing task is never
 * claimed directly: the user spawns a child cycle via skein_create
 * parentId=<standing>. These tests assert DetailsHeader surfaces the
 * Create-subtask button on a standing issue (and NOT the "→ in progress"
 * work shortcut), and the inverse for a normal open issue.
 */

import { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../../auth/AuthContext', async (importActual) => {
  const actual = await importActual<typeof import('../../../auth/AuthContext')>();
  return {
    ...actual,
    useAuth: () => ({
      user: { id: 'user-bob', username: 'bob', email: 'b@x', name: 'Bob', role: 'user' },
      isLoading: false,
      login: vi.fn(),
      logout: vi.fn(),
    }),
  };
});

import type { IssueDetail, IssueStatus } from '../../../api/issues';
import { LayoutProvider } from '../../../lib/useLayoutState';
import { DetailsHeader } from './DetailsHeader';

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
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

function makeIssue(status: IssueStatus): IssueDetail {
  return {
    id: 'sk-42',
    projectId: 'p1',
    version: 1,
    title: 'keep fork in sync',
    description: '',
    type: 'task',
    priority: 2,
    status,
    pinned: false,
    source: 'human',
    design: '',
    acceptanceCriteria: '',
    notes: '',
    createdBy: 'user-alice',
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
    assignee: 'charlie',
    previousAssignees: [],
    dismissedBy: [],
  };
}

const noopHandlers = {
  onUpdateField: vi.fn(),
  onChangeStatus: vi.fn().mockResolvedValue(undefined),
  onAccept: vi.fn(),
  onWatchToggle: vi.fn(),
};

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe('DetailsHeader — sk-118 create-subtask affordance on standing', () => {
  test('standing issue shows "Create subtask" and NOT the «→ in progress» work shortcut', () => {
    render(
      <Wrapper>
        <DetailsHeader
          issue={makeIssue('standing')}
          isWatching={false}
          watchToggling={false}
          {...noopHandlers}
        />
      </Wrapper>,
    );
    expect(screen.queryByText(/Create subtask/i)).toBeTruthy();
    // The standing task is not "worked" in place — no in-progress shortcut.
    expect(screen.queryByText(/^in progress$/i)).toBeNull();
    // The retire shortcut IS offered (closing a standing = retire).
    expect(screen.queryByText(/retire/i)).toBeTruthy();
  });

  test('an OPEN issue shows the «→ in progress» work shortcut, NOT Create subtask', () => {
    render(
      <Wrapper>
        <DetailsHeader
          issue={makeIssue('open')}
          isWatching={false}
          watchToggling={false}
          {...noopHandlers}
        />
      </Wrapper>,
    );
    expect(screen.queryByText(/^in progress$/i)).toBeTruthy();
    expect(screen.queryByText(/Create subtask/i)).toBeNull();
  });
});
