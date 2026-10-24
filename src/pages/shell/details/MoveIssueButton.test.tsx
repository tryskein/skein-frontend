/**
 * sk-35 — MoveIssueButton smoke tests.
 *
 * The component opens a Mantine modal with an epic picker that talks to
 * the cross-project listAllIssues endpoint. We don't exercise the full
 * mutation chain end-to-end (that's the migration / cycle tests on the
 * backend) — we just verify the button renders, the modal opens, and
 * the "Top-level" sentinel is in the picker options.
 */

import { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type { IssueDetail } from '../../../api/issues';
import { listAllIssues } from '../../../api/issues';
import { LayoutProvider } from '../../../lib/useLayoutState';
import i18n from '../../../i18n/config';
import type { DependencyEdge } from '../../../api/dependencies';
import { addDependency, listDependencies, removeDependency } from '../../../api/dependencies';

// Mock the network calls — Move opens a useQuery for epics + deps and
// fires a mutation chain on confirm. We stub all four so the modal
// renders with the sentinel option and the existing-deps line.
vi.mock('../../../api/issues', async () => {
  const actual = await vi.importActual<typeof import('../../../api/issues')>(
    '../../../api/issues',
  );
  return {
    ...actual,
    listAllIssues: vi.fn(async () => ({
      items: [
        {
          id: 'demo-1',
          projectId: 'p1',
          parentIdCurrent: null,
          version: 1,
          title: 'Existing epic',
          type: 'epic',
          priority: 2,
          status: 'open',
          pinned: false,
          componentIds: [],
          labels: [],
          isBlocked: false,
          createdAt: '2026-05-01T10:00:00Z',
          updatedAt: '2026-05-01T10:00:00Z',
        },
      ],
      total: 1,
      hasMore: false,
    })),
  };
});

vi.mock('../../../api/dependencies', async () => {
  const actual = await vi.importActual<
    typeof import('../../../api/dependencies')
  >('../../../api/dependencies');
  return {
    ...actual,
    listDependencies: vi.fn(async () => ({ outgoing: [], incoming: [] })),
    addDependency: vi.fn(),
    removeDependency: vi.fn(),
  };
});

import { MoveIssueButton } from './MoveIssueButton';

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

function makeIssue(): IssueDetail {
  return {
    id: 'sk-42',
    projectId: 'p1',
    version: 1,
    title: 'the issue',
    description: '',
    type: 'task',
    priority: 2,
    status: 'open',
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
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('MoveIssueButton — sk-35', () => {
  test('renders Move button', () => {
    render(
      <Wrapper>
        <MoveIssueButton issue={makeIssue()} />
      </Wrapper>,
    );
    expect(screen.getByText(/Move/)).toBeTruthy();
  });

  test('opens modal with picker on click', async () => {
    render(
      <Wrapper>
        <MoveIssueButton issue={makeIssue()} />
      </Wrapper>,
    );
    fireEvent.click(screen.getByText(/Move/));
    // Mantine Modal mounts via Portal — content lives outside the
    // initial render tree, so we have to use findBy* (async).
    expect(await screen.findByText(/Move issue/i)).toBeTruthy();
    expect(
      await screen.findByPlaceholderText(/search epics by id or title/i),
    ).toBeTruthy();
  });
});

// sk-674.18 T055 (review C1; the lead's decision on T009) — the hidden end
// of a redacted parent-child edge is a synthetic `hidden-<k>`. It is never
// shown as a parent and never sent to a removal; since every move takes
// the issue off its parent, a hidden parent refuses the move with a reason
// and no request.
describe('MoveIssueButton — a parent behind a hidden edge', () => {
  function parentEdge(toId: string, over: Partial<DependencyEdge> = {}): DependencyEdge {
    return {
      fromId: 'sk-42',
      toId,
      type: 'parent-child',
      version: 1,
      createdAt: '2026-05-01T10:00:00Z',
      metadata: {},
      ...over,
    } as DependencyEdge;
  }

  async function openDialog() {
    render(
      <Wrapper>
        <MoveIssueButton issue={makeIssue()} />
      </Wrapper>,
    );
    fireEvent.click(screen.getByRole('button', { name: i18n.t('details:move.buttonAria', { id: 'sk-42' }) }));
    return screen.findByRole('dialog');
  }

  const moveButton = (dialog: HTMLElement) =>
    within(dialog).getByRole('button', { name: i18n.t('details:move.button') });

  test('the hidden parent is not named, the move is refused with its reason, nothing is sent', async () => {
    vi.mocked(listDependencies).mockResolvedValue({
      outgoing: [parentEdge('hidden-1', { redacted: true })],
      incoming: [],
    });
    const dialog = await openDialog();
    expect(await within(dialog).findByText(i18n.t('details:move.hiddenParent'))).toBeTruthy();
    expect(document.body.textContent).not.toContain('hidden-1');

    fireEvent.change(within(dialog).getByRole('textbox', { name: i18n.t('details:move.destination') }), {
      target: { value: i18n.t('details:move.topLevel') },
    });
    expect(moveButton(dialog).hasAttribute('disabled')).toBe(true);
    fireEvent.click(moveButton(dialog));
    expect(addDependency).not.toHaveBeenCalled();
    expect(removeDependency).not.toHaveBeenCalled();
  });

  test('a visible parent (positive control): named, and a move to the top level takes it off', async () => {
    vi.mocked(listDependencies).mockResolvedValue({
      outgoing: [parentEdge('demo-0', { issue: { id: 'demo-0', projectId: 'p1', title: 'Old', status: 'open', priority: 2, type: 'epic' } })],
      incoming: [],
    });
    const dialog = await openDialog();
    expect(await within(dialog).findByText(i18n.t('details:move.currentParent', { ids: 'demo-0' }))).toBeTruthy();

    fireEvent.change(within(dialog).getByRole('textbox', { name: i18n.t('details:move.destination') }), {
      target: { value: i18n.t('details:move.topLevel') },
    });
    fireEvent.click(moveButton(dialog));
    await waitFor(() => expect(removeDependency).toHaveBeenCalledWith('p1', 'sk-42', 'demo-0', 'parent-child'));
    expect(addDependency).not.toHaveBeenCalled();
  });
});

// sk-674.18 T055 (review C2; screens 1.10, INV-24) — the destinations are
// the epics of the issue's own space: the request names the space, and a
// row of another space is not offered even if it comes back.
describe('MoveIssueButton — destinations within the issue’s space', () => {
  function epic(id: string, spaceId: string) {
    return {
      id, projectId: `p-${spaceId}`, spaceId, parentIdCurrent: null, version: 1, title: `Epic ${id}`,
      type: 'epic', priority: 2, status: 'open', pinned: false, componentIds: [], labels: [],
      isBlocked: false, createdAt: '2026-05-01T10:00:00Z', updatedAt: '2026-05-01T10:00:00Z',
    };
  }

  async function openPicker(issue: IssueDetail) {
    render(
      <Wrapper>
        <MoveIssueButton issue={issue} />
      </Wrapper>,
    );
    fireEvent.click(screen.getByRole('button', { name: i18n.t('details:move.buttonAria', { id: 'sk-42' }) }));
    const dialog = await screen.findByRole('dialog');
    const input = within(dialog).getByRole('textbox', { name: i18n.t('details:move.destination') });
    fireEvent.focus(input);
    fireEvent.click(input);
    return input;
  }

  test('the request names the issue’s space; an epic of another space is not offered', async () => {
    vi.mocked(listDependencies).mockResolvedValue({ outgoing: [], incoming: [] });
    vi.mocked(listAllIssues).mockResolvedValue({
      items: [epic('acme-1', 'k3x9p2qa'), epic('zeta-1', 'z9z9z9z9')],
      total: 2,
      hasMore: false,
    } as never);
    await openPicker({ ...makeIssue(), spaceId: 'k3x9p2qa' });

    await waitFor(() =>
      expect(listAllIssues).toHaveBeenCalledWith(expect.objectContaining({ type: 'epic', space: 'k3x9p2qa' })),
    );
    expect(await screen.findByRole('option', { name: 'acme-1 — Epic acme-1' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'zeta-1 — Epic zeta-1' })).toBeNull();
  });

  test('a card without its space searches as before, without the parameter', async () => {
    vi.mocked(listDependencies).mockResolvedValue({ outgoing: [], incoming: [] });
    await openPicker(makeIssue());
    await waitFor(() => expect(listAllIssues).toHaveBeenCalled());
    expect(vi.mocked(listAllIssues).mock.calls[0][0]?.space).toBeUndefined();
  });
});
