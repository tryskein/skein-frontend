/**
 * Icon-only controls carry an accessible name.
 *
 * A button whose only content is a drawn icon (`aria-hidden` svg) has no
 * text of its own, so a screen reader announces it as a bare «button»
 * unless the control names itself. This file mounts the real components
 * that host such controls and reaches every one of them the way an
 * assistive-technology user does: by role and accessible name. The
 * expected names come from the dictionary (`en`), not from the rendered
 * output.
 *
 * Each control is also required to carry the name in `aria-label`, not
 * only in `title`: the accessible-name algorithm falls back to `title`,
 * but its announcement is advisory and inconsistent across screen
 * readers, so a control named by `title` alone is the defect this guards.
 *
 * Replaces the source scan removed at sk-540.11: that read TSX text,
 * this renders.
 * Controls already reached by name elsewhere are not repeated here —
 * the column collapse buttons (`ColumnCountsZero`, `QueuesColumn`), the
 * project component caret (`ProjectTreeCollapse`), the watching-card
 * unsubscribe (`WatchingUI`).
 */

import { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../../auth/AuthContext', async (importActual) => {
  const actual = await importActual<typeof import('../../../auth/AuthContext')>();
  return {
    ...actual,
    useAuth: () => ({
      user: { id: 'u-1', username: 'bob', email: 'bob@example.com', name: 'Bob', role: 'user' },
      isLoading: false,
      login: vi.fn(),
      logout: vi.fn(),
    }),
  };
});

vi.mock('../../../lib/useReminders', async (importActual) => {
  const actual = await importActual<typeof import('../../../lib/useReminders')>();
  return { ...actual, useRingingIssueIds: () => new Set<string>() };
});

const { mockListAttachments } = vi.hoisted(() => ({ mockListAttachments: vi.fn() }));

vi.mock('../../../api/attachments', async (importActual) => {
  const actual = await importActual<typeof import('../../../api/attachments')>();
  return {
    ...actual,
    listAttachments: mockListAttachments,
    getDownloadURL: vi.fn(async () => ({ url: 'blob:none', expiresAt: '' })),
  };
});

vi.mock('../../../api/dependencies', async (importActual) => {
  const actual = await importActual<typeof import('../../../api/dependencies')>();
  return {
    ...actual,
    listDependencies: vi.fn(async () => ({ outgoing: [], incoming: [] })),
  };
});

/* Shiki is a wasm highlighter behind a dynamic import; the viewer header
 * does not depend on it. */
vi.mock('../../../lib/shiki', () => ({
  SHIKI_LIGHT_THEME: 'github-light',
  SHIKI_DARK_THEME: 'github-dark',
  getHighlighter: async () => ({ codeToHtml: () => '<pre></pre>' }),
  getMarkdownItShikiPlugin: async () => [() => {}, {}],
  __resetShikiForTests: () => {},
}));

import { en } from '../../../i18n/locales/en';
import type { Attachment } from '../../../api/attachments';
import type { IssueDetail } from '../../../api/issues';
import type { FlatTreeRow } from '../../../lib/flattenTree';
import { LayoutProvider } from '../../../lib/useLayoutState';
import { TREE_DEFAULT_COLUMNS, treeColumnOrder, treeColumnsMask } from '../../../lib/treeColumns';
import { BlobCodesResult } from '../BlobCodesResult';
import { TaskTreeNode } from '../TaskTreeNode';
import { DetailsHeader } from '../details/DetailsHeader';
import { FileViewerPanel } from '../details/FileViewerPanel';
import { WatchersSection } from '../details/sections/WatchersSection';

function Providers({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={qc}>
      <MantineProvider forceColorScheme="dark">
        <MemoryRouter>
          <LayoutProvider>{children}</LayoutProvider>
        </MemoryRouter>
      </MantineProvider>
    </QueryClientProvider>
  );
}

/**
 * The control is reached by role + name, and the name is its own
 * `aria-label` rather than a `title` fallback.
 */
function namedButton(name: string): HTMLElement {
  const button = screen.getByRole('button', { name });
  expect(button.getAttribute('aria-label')).toBe(name);
  return button;
}

beforeEach(() => {
  mockListAttachments.mockReset();
});

afterEach(() => cleanup());

describe('icon-only controls are reachable by role and name', () => {
  test('the pasted-codes result: the ✕ that leaves blob mode', () => {
    const onExit = vi.fn();
    render(
      <Providers>
        <BlobCodesResult
          chips={[]}
          matched={[]}
          foundCount={0}
          notFoundCount={0}
          totalCount={0}
          isLoading={false}
          error={null}
          selectedIssueId={null}
          componentNames={new Map()}
          fields={0}
          onSelect={vi.fn()}
          onExit={onExit}
          onExpandEpic={vi.fn()}
        />
      </Providers>,
    );
    fireEvent.click(namedButton(en.tasks.blob.exitAria));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  test('the watchers section: the ✕ on the caller’s own row', () => {
    render(
      <Providers>
        <WatchersSection
          issueId="sk-7"
          watchers={[
            {
              userId: 'u-1',
              username: 'bob',
              name: 'Bob',
              reasons: ['manual'],
              since: '2026-05-01T10:00:00Z',
            },
            {
              userId: 'u-2',
              username: 'alice',
              name: 'Alice',
              reasons: ['manual'],
              since: '2026-05-01T10:00:00Z',
            },
          ]}
        />
      </Providers>,
    );
    // Only the caller's own row offers the control; one named button.
    expect(screen.getAllByRole('button', { name: en.details.watchers.stopWatching })).toHaveLength(
      1,
    );
    namedButton(en.details.watchers.stopWatching);
  });

  test('the file viewer: download and close', async () => {
    const attachment: Attachment = {
      id: '11111111-1111-4111-8111-111111111111',
      issueId: 'sk-7',
      filename: 'notes.txt',
      contentType: 'text/plain',
      sizeBytes: 12,
      status: 'ready',
      uploadedBy: 'u-1',
      uploadedAt: '2026-05-01T10:00:00Z',
    };
    mockListAttachments.mockResolvedValue({ items: [attachment], total: 1 });
    const onClose = vi.fn();
    render(
      <Providers>
        <FileViewerPanel issueId="sk-7" attachmentId={attachment.id} onClose={onClose} />
      </Providers>,
    );
    // The download control names the file it downloads.
    await screen.findByRole('button', { name: 'Download notes.txt' });
    namedButton('Download notes.txt');
    fireEvent.click(namedButton(en.details.fileViewer.closeAria));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('the details header: the ✕ that closes the issue', () => {
    const issue: IssueDetail = {
      id: 'sk-42',
      projectId: 'p1',
      version: 1,
      title: 't',
      description: '',
      type: 'task',
      priority: 2,
      status: 'open',
      pinned: false,
      source: 'human',
      design: '',
      acceptanceCriteria: '',
      notes: '',
      createdBy: 'u-2',
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
    render(
      <Providers>
        <DetailsHeader
          issue={issue}
          isWatching={false}
          watchToggling={false}
          onUpdateField={vi.fn()}
          onChangeStatus={vi.fn()}
          onAccept={vi.fn()}
          onWatchToggle={vi.fn()}
        />
      </Providers>,
    );
    namedButton(en.details.header.closeAria);
  });

  test.each([
    ['folded', false, en.tasks.tree.expand],
    ['unfolded', true, en.tasks.tree.collapse],
  ] as const)('the tree row chevron, %s, says which way it goes', (_state, open, name) => {
    const row: FlatTreeRow = {
      item: {
        id: 'sk-42',
        projectId: 'p',
        version: 1,
        title: 'a parent',
        type: 'task',
        priority: 3,
        status: 'open',
        pinned: false,
        componentIds: [],
        labels: [],
        isBlocked: false,
        updatedAt: '2026-05-01T10:00:00Z',
        createdAt: '2026-05-01T10:00:00Z',
      },
      depth: 0,
      edgeType: null,
      isReference: false,
      isContext: false,
      firstSeenAt: null,
      hasChildren: true,
    };
    const onToggle = vi.fn();
    render(
      <Providers>
        <TaskTreeNode
          row={row}
          selectedId={null}
          expanded={new Set(open ? ['sk-42'] : [])}
          searchQuery=""
          componentNames={new Map()}
          columns={treeColumnOrder(TREE_DEFAULT_COLUMNS)}
          columnsMask={treeColumnsMask(TREE_DEFAULT_COLUMNS)}
          onSelect={vi.fn()}
          onToggle={onToggle}
          position={{ setSize: 1, posInSet: 1 }}
          ariaRowIndex={2}
        />
      </Providers>,
    );
    fireEvent.click(namedButton(name));
    expect(onToggle).toHaveBeenCalled();
  });
});
