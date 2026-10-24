/**
 * sk-285.6.3 — exactly one primary action in the card header, per state.
 *
 * The header drew six controls in one weight — `→ start work`, `✓ Accept`,
 * `👁 Watch`, `↪ Move`, the version chip and the close × — all
 * outlined, all 12px, all the same. Nothing on the row said what the
 * reader was meant to do next, and the green `open` status chip sat
 * shoulder to shoulder with a button, so a STATE read as a COMMAND.
 *
 * The property under test is not "the accept button is filled". It is
 * the INVARIANT: whatever the state, the row promotes one action and
 * exactly one. That is what a rank is; two filled buttons is the same
 * defect as none, and the old code was one hard-coded `primary` class
 * away from producing two the moment a second state matched.
 *
 * So the first block below sweeps the whole state matrix and counts.
 * The named-action tests that follow only pin down WHICH one — they
 * are the table from `DetailsHeader.tsx` restated as behaviour, so the
 * table and the code cannot drift apart silently.
 */

import { ReactNode } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../../auth/AuthContext', async (importActual) => {
  const actual = await importActual<typeof import('../../../auth/AuthContext')>();
  return {
    ...actual,
    useAuth: () => ({
      user: {
        id: 'user-bob',
        username: 'bob',
        email: 'bob@example.com',
        name: 'Bob',
        role: 'user',
      },
      isLoading: false,
      login: vi.fn(),
      logout: vi.fn(),
    }),
  };
});

import type { IssueDetail, IssueStatus } from '../../../api/issues';
import { LayoutProvider } from '../../../lib/useLayoutState';
import { DetailsHeader, primaryActionFor } from './DetailsHeader';

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

interface Cell {
  status: IssueStatus;
  mine: boolean;
  accepted: boolean;
}

function makeIssue({ status, mine, accepted }: Cell): IssueDetail {
  return {
    id: 'sk-42',
    projectId: 'p1',
    version: 1,
    title: 't',
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
    acceptedAt: accepted ? '2026-05-15T11:00:00Z' : null,
    metadata: {},
    componentIds: [],
    labels: [],
    commentsCount: 0,
    commitRefs: [],
    mentions: [],
    isBlocked: false,
    blockers: [],
    assignee: mine ? 'bob' : 'charlie',
    previousAssignees: [],
    dismissedBy: [],
  } as unknown as IssueDetail;
}

const handlers = {
  onUpdateField: vi.fn(),
  onChangeStatus: vi.fn(),
  onAccept: vi.fn(),
  onWatchToggle: vi.fn(),
};

function renderHeader(cell: Cell, isWatching = false) {
  return render(
    <Wrapper>
      <DetailsHeader
        issue={makeIssue(cell)}
        isWatching={isWatching}
        watchToggling={false}
        {...handlers}
      />
    </Wrapper>,
  );
}

/** Every promoted control on the row, by its visible label. */
function primaries(container: HTMLElement): string[] {
  return [...container.querySelectorAll('.action-button.primary')].map((el) =>
    (el.textContent ?? '').trim(),
  );
}

const STATUSES: IssueStatus[] = [
  'open',
  'in_progress',
  'deferred',
  'standing',
  'closed',
];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('sk-285.6.3 — the rank invariant, over the whole state matrix', () => {
  for (const status of STATUSES) {
    for (const mine of [true, false]) {
      for (const accepted of [true, false]) {
        test(`${status} · ${mine ? 'mine' : "someone else's"} · ${
          accepted ? 'accepted' : 'unaccepted'
        } promotes exactly one action`, () => {
          const { container } = renderHeader({ status, mine, accepted });
          // Both directions matter. Zero is the defect as reported — a
          // flat row with no answer to "what now". Two or more is the
          // defect the fix could easily introduce, and would be worse:
          // a rank that ranks two things is not a rank.
          expect(primaries(container)).toHaveLength(1);
        });
      }
    }
  }
});

describe('sk-285.6.3 — and the table says which one', () => {
  test('a task handed to me and not yet accepted promotes Accept', () => {
    // Acknowledging outranks everything while it applies: until you
    // accept, the task is not really on your plate.
    const { container } = renderHeader({
      status: 'open',
      mine: true,
      accepted: false,
    });
    expect(primaries(container)).toEqual(['Accept']);
  });

  test('once accepted, an open task promotes → in progress', () => {
    const { container } = renderHeader({
      status: 'open',
      mine: true,
      accepted: true,
    });
    expect(primaries(container)).toEqual(['in progress']);
  });

  test('my in-progress task promotes the close', () => {
    const { container } = renderHeader({
      status: 'in_progress',
      mine: true,
      accepted: true,
    });
    expect(primaries(container)).toEqual(['close']);
  });

  test('a deferred task promotes RESUME, not the close beside it', () => {
    // The only state that renders TWO shortcuts, so the only one where
    // "which of them" is a question at all. What this render assertion
    // canNOT do is separate "the table said in_progress" from "whatever
    // is listed first" — resume happens to be first today. The unit
    // block below pins the mapping so a reordering cannot move the
    // promotion onto the destructive twin unnoticed.
    const { container } = renderHeader({
      status: 'deferred',
      mine: true,
      accepted: true,
    });
    expect(primaries(container)).toEqual(['resume']);
    expect(container.querySelector('.action-button.primary.danger')).toBeNull();
  });

  test('someone else’s task promotes Watch — the only useful thing to do', () => {
    const { container } = renderHeader({
      status: 'in_progress',
      mine: false,
      accepted: true,
    });
    expect(primaries(container)).toEqual(['Watch']);
  });

  test('and stops promoting it once I am already watching', () => {
    // `active` is the more useful thing for a toggle to report about
    // itself than "you should press me", and promoting a control that
    // is already engaged is noise. The row then has no filled button,
    // which is the ONE case the invariant sweep does not cover — hence
    // its own test rather than a hole in the matrix.
    const { container } = renderHeader(
      { status: 'in_progress', mine: false, accepted: true },
      true,
    );
    expect(primaries(container)).toEqual([]);
    expect(container.querySelector('.action-button.active')).not.toBeNull();
  });
});

describe('sk-285.7.2.53 — state and commands are two ROWS', () => {
  // sk-285.6.3 kept them apart with a 1px rule inside one wrapping row
  // (`.details-header-sep`). §6 and `Sk Details.dc.html` draw them as
  // two rows instead — "a `project · id · status · P · type · v7 ·
  // ✕` row; an actions row" — and a row break states the separation
  // structurally, so the rule went with the reflow. The property under
  // test did not change: a reading of the task never shares a line with
  // a command.
  test('the metadata row holds the readings, and no action button', () => {
    const { container } = renderHeader({
      status: 'open',
      mine: true,
      accepted: true,
    });
    const row = container.querySelector('.details-header-row')!;
    expect(row).not.toBeNull();
    expect(row.querySelector('.header-status')).not.toBeNull();
    expect(row.querySelector('.header-priority')).not.toBeNull();
    expect(row.querySelector('.header-type')).not.toBeNull();
    // …and nothing to press except the ✕, which closes the panel rather
    // than acting on the task.
    expect(row.querySelector('.action-button')).toBeNull();
    expect(row.querySelector('.details-header-close')).not.toBeNull();
  });

  test('the actions row holds the commands, and no reading', () => {
    const { container } = renderHeader({
      status: 'open',
      mine: true,
      accepted: true,
    });
    const actions = container.querySelector('.details-header-actions')!;
    expect(actions).not.toBeNull();
    expect(actions.querySelectorAll('.action-button').length).toBeGreaterThan(0);
    for (const cls of ['.header-status', '.header-priority', '.header-type']) {
      expect(actions.querySelector(cls)).toBeNull();
    }
    expect(actions.querySelector('.details-header-version')).toBeNull();
  });

  test('the metadata row reads project · id · status · P · type · v · ✕', () => {
    // D2B-2: the three attributes came out `type · P · status`, the
    // exact reverse of §6. Asserted as a SEQUENCE — every element was
    // present before, it was the order that differed.
    const { container } = renderHeader({
      status: 'open',
      mine: true,
      accepted: true,
    });
    const row = container.querySelector('.details-header-row')!;
    const marks: Array<[string, string]> = [
      ['.details-header-eyebrow', 'project'],
      ['.issue-id-badge', 'id'],
      ['.header-status', 'status'],
      ['.header-priority', 'priority'],
      ['.header-type', 'type'],
      ['.details-header-version', 'version'],
      ['.details-header-close', 'close'],
    ];
    const seen = [...row.querySelectorAll('*')];
    const order: Array<{ name: string; at: number }> = [];
    for (const [sel, name] of marks) {
      const el = row.querySelector(sel);
      if (el) order.push({ name, at: seen.indexOf(el) });
    }
    // Tripwire: a selector that stopped matching would silently drop out
    // of the sequence and leave a shorter list that still ascends.
    expect(order.map((x) => x.name)).toEqual([
      'project',
      'id',
      'status',
      'priority',
      'type',
      'version',
      'close',
    ]);
    for (let i = 1; i < order.length; i += 1) {
      expect(order[i].at).toBeGreaterThan(order[i - 1].at);
    }
  });

  test('the version chip is the short form the artboard writes', () => {
    // D2B-3: it read «version 7». §6 and the artboard both write `v7`,
    // and the row it sits in also has to hold the handle, the id and
    // three chips. The hover still says what the number counts —
    // repeating the visible text there would teach nothing.
    const { container } = renderHeader({
      status: 'open',
      mine: true,
      accepted: true,
    });
    const version = container.querySelector('.details-header-version');
    expect(version?.textContent).toBe('v1');
    expect(version?.getAttribute('title')).toContain('edit counter');
  });
});

describe('sk-285.6.3 — the table itself, independent of how it is drawn', () => {
  // The doc-comment table in DetailsHeader.tsx, restated as data. A
  // table that lives only in prose drifts from the code it describes;
  // this is the assertion that keeps the two honest, and it is the one
  // place the deferred → in_progress mapping is pinned by NAME rather
  // than by the accident of list order.
  const TABLE: Array<[Cell, string, IssueStatus | undefined]> = [
    [{ status: 'open', mine: true, accepted: false }, 'accept', undefined],
    [{ status: 'in_progress', mine: true, accepted: false }, 'accept', undefined],
    [{ status: 'deferred', mine: true, accepted: false }, 'accept', undefined],
    [{ status: 'standing', mine: true, accepted: false }, 'accept', undefined],
    [{ status: 'standing', mine: true, accepted: true }, 'subtask', undefined],
    [{ status: 'standing', mine: false, accepted: true }, 'subtask', undefined],
    [{ status: 'open', mine: true, accepted: true }, 'status-shortcut', 'in_progress'],
    [{ status: 'in_progress', mine: true, accepted: true }, 'status-shortcut', 'closed'],
    [{ status: 'deferred', mine: true, accepted: true }, 'status-shortcut', 'in_progress'],
    [{ status: 'closed', mine: true, accepted: true }, 'status-shortcut', 'open'],
    [{ status: 'closed', mine: true, accepted: false }, 'status-shortcut', 'open'],
    [{ status: 'open', mine: false, accepted: true }, 'watch', undefined],
    [{ status: 'in_progress', mine: false, accepted: false }, 'watch', undefined],
    [{ status: 'closed', mine: false, accepted: true }, 'watch', undefined],
  ];

  for (const [cell, action, next] of TABLE) {
    test(`${cell.status} · ${cell.mine ? 'mine' : "theirs"} · ${
      cell.accepted ? 'accepted' : 'unaccepted'
    } → ${action}${next ? ` (${next})` : ''}`, () => {
      const verdict = primaryActionFor({
        status: cell.status,
        isAssignee: cell.mine,
        isAccepted: cell.accepted,
      });
      expect(verdict.action).toBe(action);
      expect(verdict.shortcutNext).toBe(next);
    });
  }

  test('a closed task assigned to me does NOT ask to be accepted', () => {
    // The backend rejects accept-on-closed (`cannot_accept_closed`), so
    // promoting it would be promoting a guaranteed error. Called out
    // separately because it is the one row of the table where the
    // "unaccepted" branch deliberately does not fire.
    expect(
      primaryActionFor({ status: 'closed', isAssignee: true, isAccepted: false })
        .action,
    ).not.toBe('accept');
  });
});
