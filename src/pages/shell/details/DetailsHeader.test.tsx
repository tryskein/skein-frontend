/**
 * sk-34 — visibility matrix for the "Drop from Delegated" / "Resume
 * tracking" buttons in DetailsHeader.
 *
 * The 16-cell matrix is `inChain × dismissed × isAssignee × isCreator`.
 * We sample the load-bearing cells (not all 16 — many collapse to the
 * same outcome). The button-visibility rule is:
 *
 *   showDrop   = inChain ∧ ¬dismissed ∧ ¬isAssignee ∧ ¬isCreator
 *   showResume = inChain ∧  dismissed ∧ ¬isAssignee ∧ ¬isCreator
 *
 * Creator gets neither button (created_by branch always wins in the
 * Delegated predicate). Current assignee gets neither (the lens hides
 * tasks currently on the user's plate via On-me).
 */

import { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

// sk-540.2 — the close-outcome control reads the issue's dependencies for
// exception (a); the wire is mocked here and nowhere else.
const EMPTY_DEPS = { outgoing: [], incoming: [] };
const deps = vi.hoisted(() => ({
  listDependencies: vi.fn(),
}));
vi.mock('../../../api/dependencies', async (importActual) => {
  const actual = await importActual<typeof import('../../../api/dependencies')>();
  return {
    ...actual,
    listDependencies: (...args: unknown[]) => deps.listDependencies(...args),
  };
});

import type { DependencyList } from '../../../api/dependencies';
import type { IssueDetail } from '../../../api/issues';
import { BusinessError } from '../../../api/client';
import { LayoutProvider } from '../../../lib/useLayoutState';
import { DetailsHeader } from './DetailsHeader';

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

/**
 * Bob is the caller; tweak the four flags on top of a base IssueDetail
 * so each test cell maps directly to the predicate variables.
 */
function makeIssue(opts: {
  inChain?: boolean;
  dismissed?: boolean;
  isAssignee?: boolean;
  isCreator?: boolean;
  status?: IssueDetail['status'];
  isBlocked?: boolean;
  // sk-489 (row 57) — the close outcome. `undefined` is twofold and intentional:
  // "the task is not closed" and "an api that knows nothing about the outcome answers" —
  // are the same absence (US-10).
  closeOutcome?: string;
}): IssueDetail {
  const bobId = 'user-bob';
  const aliceId = 'user-alice';
  return {
    id: 'sk-42',
    projectId: 'p1',
    version: 1,
    title: 't',
    description: '',
    type: 'task',
    priority: 2,
    status: opts.status ?? 'open',
    pinned: false,
    source: 'human',
    design: '',
    acceptanceCriteria: '',
    notes: '',
    createdBy: opts.isCreator ? bobId : aliceId,
    createdAt: '2026-05-15T10:00:00Z',
    updatedAt: '2026-05-15T10:00:00Z',
    metadata: {},
    componentIds: [],
    labels: [],
    commentsCount: 0,
    commitRefs: [],
    mentions: [],
    isBlocked: opts.isBlocked ?? false,
    blockers: [],
    assignee: opts.isAssignee ? 'bob' : 'charlie',
    previousAssignees: opts.inChain ? [bobId] : [],
    dismissedBy: opts.dismissed ? [bobId] : [],
    ...(opts.closeOutcome === undefined ? {} : { closeOutcome: opts.closeOutcome }),
  };
}

const noopHandlers = {
  onUpdateField: vi.fn(),
  onChangeStatus: vi.fn(),
  onAccept: vi.fn(),
  onWatchToggle: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  deps.listDependencies.mockResolvedValue(EMPTY_DEPS);
});

afterEach(() => {
  cleanup();
});

describe('DetailsHeader — sk-34 Drop/Resume visibility matrix', () => {
  test('inChain + not dismissed + not assignee + not creator → Drop visible', () => {
    render(
      <Wrapper>
        <DetailsHeader
          issue={makeIssue({ inChain: true })}
          isWatching={false}
          watchToggling={false}
          {...noopHandlers}
        />
      </Wrapper>,
    );
    expect(screen.queryByText(/Drop from Delegated/i)).toBeTruthy();
    expect(screen.queryByText(/Resume tracking/i)).toBeNull();
  });

  test('inChain + dismissed → Resume visible, Drop hidden', () => {
    render(
      <Wrapper>
        <DetailsHeader
          issue={makeIssue({ inChain: true, dismissed: true })}
          isWatching={false}
          watchToggling={false}
          {...noopHandlers}
        />
      </Wrapper>,
    );
    expect(screen.queryByText(/Drop from Delegated/i)).toBeNull();
    expect(screen.queryByText(/Resume tracking/i)).toBeTruthy();
  });

  test('not in chain → neither button visible', () => {
    render(
      <Wrapper>
        <DetailsHeader
          issue={makeIssue({ inChain: false })}
          isWatching={false}
          watchToggling={false}
          {...noopHandlers}
        />
      </Wrapper>,
    );
    expect(screen.queryByText(/Drop from Delegated/i)).toBeNull();
    expect(screen.queryByText(/Resume tracking/i)).toBeNull();
  });

  test('current assignee (even if in chain) → neither button visible', () => {
    render(
      <Wrapper>
        <DetailsHeader
          issue={makeIssue({ inChain: true, isAssignee: true })}
          isWatching={false}
          watchToggling={false}
          {...noopHandlers}
        />
      </Wrapper>,
    );
    expect(screen.queryByText(/Drop from Delegated/i)).toBeNull();
    expect(screen.queryByText(/Resume tracking/i)).toBeNull();
  });

  test('creator (even if also in chain) → neither button visible', () => {
    render(
      <Wrapper>
        <DetailsHeader
          issue={makeIssue({ inChain: true, isCreator: true })}
          isWatching={false}
          watchToggling={false}
          {...noopHandlers}
        />
      </Wrapper>,
    );
    expect(screen.queryByText(/Drop from Delegated/i)).toBeNull();
    expect(screen.queryByText(/Resume tracking/i)).toBeNull();
  });
});

/**
 * sk-25 — the Accept button must NOT appear on closed issues, even when
 * (a) the caller is the assignee and (b) acceptedAt is still null. This
 * scenario happens when the caller closed the row themselves without
 * ever accepting it via the Accept verb. Backend now also rejects this
 * (cannot_accept_closed); the UI hides the affordance so the user
 * doesn't see a button that would always 422.
 */
describe('DetailsHeader — sk-25 Accept button visibility on closed issues', () => {
  function withAcceptCondition(status: 'open' | 'closed'): IssueDetail {
    // Use the existing makeIssue helper as a base, then flip the
    // accept-relevant flags. Bob is the caller (per the module-level
    // useAuth mock), so set assignee=bob and acceptedAt=null.
    const issue = makeIssue({ isAssignee: true });
    return { ...issue, status, acceptedAt: null };
  }

  test('open + assignee + acceptedAt=null → Accept button visible', () => {
    render(
      <Wrapper>
        <DetailsHeader
          issue={withAcceptCondition('open')}
          isWatching={false}
          watchToggling={false}
          {...noopHandlers}
        />
      </Wrapper>,
    );
    // Baseline sanity check — without this we don't know the negative
    // case in the next test is actually load-bearing on `status`.
    expect(screen.queryByText(/Accept/)).toBeTruthy();
  });

  test('closed + assignee + acceptedAt=null → Accept button hidden', () => {
    render(
      <Wrapper>
        <DetailsHeader
          issue={withAcceptCondition('closed')}
          isWatching={false}
          watchToggling={false}
          {...noopHandlers}
        />
      </Wrapper>,
    );
    // Whole-button assertion: the "Accept" label rendered
    // by the affordance in DetailsHeader.tsx:398 must not appear.
    expect(screen.queryByText('Accept')).toBeNull();
  });
});

/**
 * sk-7 — the TypeBadge is now a Mantine <Menu> trigger so the issue
 * type can be changed from the card. Mirrors the Priority menu:
 * controlled open-state, 8 options, single-pick semantics carried by
 * aria-checked (the current value is the only checked item), mutation
 * via onUpdateField({ type }).
 *
 * Note on roles: the source sets role="menuitemradio" on each
 * <Menu.Item> (matching the Priority/Status menus), but Mantine 7's
 * <Menu.Item> hard-codes role="menuitem" on the rendered <button> and
 * ignores the prop — `aria-checked` and the `active` class still pass
 * through, so the single-pick affordance is conveyed by aria-checked.
 * These tests therefore query the real rendered role ('menuitem') and
 * assert the checkmark via aria-checked, which is what reaches the DOM.
 */
describe('DetailsHeader — sk-7 change issue type from the card', () => {
  test('trigger carries aria-label "Change type — currently <type>"', () => {
    render(
      <Wrapper>
        <DetailsHeader
          issue={makeIssue({})}
          isWatching={false}
          watchToggling={false}
          {...noopHandlers}
        />
      </Wrapper>,
    );
    // makeIssue defaults type='task'.
    expect(
      screen.getByRole('button', { name: 'Change type — currently task' }),
    ).toBeTruthy();
  });

  test('clicking the trigger opens a dropdown listing all 8 types', async () => {
    const user = userEvent.setup();
    render(
      <Wrapper>
        <DetailsHeader
          issue={makeIssue({})}
          isWatching={false}
          watchToggling={false}
          {...noopHandlers}
        />
      </Wrapper>,
    );
    await user.click(
      screen.getByRole('button', { name: 'Change type — currently task' }),
    );
    const dropdown = await screen.findByRole('menu');
    const items = within(dropdown).getAllByRole('menuitem');
    expect(items).toHaveLength(8);
    const labels = items.map((el) => el.textContent);
    expect(labels).toEqual([
      'bug',
      'feature',
      'task',
      'epic',
      'chore',
      'decision',
      'idea',
      'note',
    ]);
  });

  test('the current type is the only aria-checked item', async () => {
    const user = userEvent.setup();
    render(
      <Wrapper>
        <DetailsHeader
          issue={makeIssue({})}
          isWatching={false}
          watchToggling={false}
          {...noopHandlers}
        />
      </Wrapper>,
    );
    await user.click(
      screen.getByRole('button', { name: 'Change type — currently task' }),
    );
    const dropdown = await screen.findByRole('menu');
    const checked = within(dropdown)
      .getAllByRole('menuitem')
      .filter((el) => el.getAttribute('aria-checked') === 'true');
    expect(checked).toHaveLength(1);
    expect(checked[0].textContent).toBe('task');
  });

  test('selecting a different type calls onUpdateField({ type })', async () => {
    const user = userEvent.setup();
    const onUpdateField = vi.fn().mockResolvedValue(undefined);
    render(
      <Wrapper>
        <DetailsHeader
          issue={makeIssue({})}
          isWatching={false}
          watchToggling={false}
          {...noopHandlers}
          onUpdateField={onUpdateField}
        />
      </Wrapper>,
    );
    await user.click(
      screen.getByRole('button', { name: 'Change type — currently task' }),
    );
    const dropdown = await screen.findByRole('menu');
    await user.click(within(dropdown).getByRole('menuitem', { name: 'bug' }));
    expect(onUpdateField).toHaveBeenCalledTimes(1);
    expect(onUpdateField).toHaveBeenCalledWith({ type: 'bug' });
  });

  test('selecting the already-current type is a no-op (no mutation)', async () => {
    const user = userEvent.setup();
    const onUpdateField = vi.fn().mockResolvedValue(undefined);
    render(
      <Wrapper>
        <DetailsHeader
          issue={makeIssue({})}
          isWatching={false}
          watchToggling={false}
          {...noopHandlers}
          onUpdateField={onUpdateField}
        />
      </Wrapper>,
    );
    await user.click(
      screen.getByRole('button', { name: 'Change type — currently task' }),
    );
    const dropdown = await screen.findByRole('menu');
    await user.click(within(dropdown).getByRole('menuitem', { name: 'task' }));
    expect(onUpdateField).not.toHaveBeenCalled();
  });
});

/**
 * sk-118 — the retire dialog's open-children guard MUST be reachable.
 *
 * Regression for the codex finding: changeStatus() in useIssueDetail
 * CATCHES transition errors and resolves a typed result rather than
 * throwing, so submitReason()'s old try/catch never fired and a FAILED
 * retire closed the modal as if it had succeeded — the
 * `standing_has_open_children` guard never rendered. The contract is now
 * a three-way result (IssueDetail | { error } | null); these tests drive
 * the full DetailsHeader retire flow and assert the modal STAYS OPEN with
 * the child-id guard when onChangeStatus reports failure — covering both
 * the returned-`{ error }` path and the defensive thrown-error path —
 * while a successful retire still closes the modal.
 */
describe('DetailsHeader — sk-118 retire guard reachability', () => {
  const childErr = () =>
    new BusinessError(
      422,
      'cannot retire (close) a standing task while it still has non-closed children',
      'standing_has_open_children',
      { childIds: ['sk-42.3', 'sk-42.5'] },
    );

  async function openRetireModal(onChangeStatus: ReturnType<typeof vi.fn>) {
    const user = userEvent.setup();
    render(
      <Wrapper>
        <DetailsHeader
          issue={makeIssue({ status: 'standing' })}
          isWatching={false}
          watchToggling={false}
          {...noopHandlers}
          onChangeStatus={onChangeStatus}
        />
      </Wrapper>,
    );
    // The standing shortcut is "retire" — clicking it opens the modal
    // (status==='standing' routes the close through the retire framing).
    await user.click(screen.getByRole('button', { name: /^retire$/i }));
    // The modal Retire button fires onSubmit → submitReason.
    const retireBtn = await screen.findByRole('button', { name: 'Retire' });
    await user.click(retireBtn);
    return user;
  }

  test('returned { error } with standing_has_open_children keeps the modal open + shows the child-id guard', async () => {
    const onChangeStatus = vi.fn().mockResolvedValue({ error: childErr() });
    await openRetireModal(onChangeStatus);

    expect(onChangeStatus).toHaveBeenCalledTimes(1);
    // Modal still open: the retire title + Retire button are still present.
    expect(screen.getByText(/Retire standing task sk-42/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retire' })).toBeTruthy();
    // Guard rendered with the offending child ids.
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(/non-closed children/i);
    expect(screen.getByText('sk-42.3')).toBeTruthy();
    expect(screen.getByText('sk-42.5')).toBeTruthy();
  });

  test('a THROWN standing_has_open_children (defensive path) also keeps the modal open + guard', async () => {
    const onChangeStatus = vi.fn().mockRejectedValue(childErr());
    await openRetireModal(onChangeStatus);

    expect(onChangeStatus).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Retire' })).toBeTruthy();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(/non-closed children/i);
    expect(screen.getByText('sk-42.3')).toBeTruthy();
  });

  test('a non-guard failure keeps the modal open with the message but no child-id list', async () => {
    const onChangeStatus = vi
      .fn()
      .mockResolvedValue({ error: new Error('boom — server unavailable') });
    await openRetireModal(onChangeStatus);

    expect(screen.getByRole('button', { name: 'Retire' })).toBeTruthy();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(/boom — server unavailable/i);
    // No standing-children list — this is a generic failure.
    expect(alert.textContent).not.toMatch(/non-closed children/i);
    expect(screen.queryByText('sk-42.3')).toBeNull();
  });

  test('a SUCCESSFUL retire (resolves IssueDetail) closes the modal', async () => {
    const onChangeStatus = vi
      .fn()
      .mockResolvedValue({ ...makeIssue({ status: 'standing' }), status: 'closed', version: 2 });
    await openRetireModal(onChangeStatus);

    expect(onChangeStatus).toHaveBeenCalledTimes(1);
    // Modal closed: the retire title is gone, and no guard is shown.
    expect(screen.queryByText(/Retire standing task sk-42/i)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

/**
 * sk-118 (Fix 3) — the Details header status pill must mirror the
 * StatusBadge guard: a `standing` issue with a stray isBlocked=true must
 * NOT be marked blocked (class / aria-label / title). Nothing can target
 * a standing task with blocks/waits-for (§11.2), so the Standing
 * marker is the dominant signal.
 */
describe('DetailsHeader — sk-118 standing immune to derived-blocked override', () => {
  test('standing + isBlocked=true renders as standing, not blocked', () => {
    render(
      <Wrapper>
        <DetailsHeader
          issue={makeIssue({ status: 'standing', isBlocked: true })}
          isWatching={false}
          watchToggling={false}
          {...noopHandlers}
        />
      </Wrapper>,
    );
    // The status pill is the button labelled "Status: standing" — NOT the
    // blocked-extended "(blocked by dependencies)" aria-label.
    const pill = screen.getByRole('button', { name: 'Status: standing' });
    expect(pill).toBeTruthy();
    expect(pill.className).toContain('status-standing');
    expect(pill.className).not.toContain('is-blocked');
    // No blocked-by-dependencies labelling leaked through.
    expect(screen.queryByRole('button', { name: /blocked by dependencies/i })).toBeNull();
  });

  test('a NON-standing blocked issue still gets the blocked override (control)', () => {
    render(
      <Wrapper>
        <DetailsHeader
          issue={makeIssue({ status: 'in_progress', isBlocked: true })}
          isWatching={false}
          watchToggling={false}
          {...noopHandlers}
        />
      </Wrapper>,
    );
    const pill = screen.getByRole('button', { name: /blocked by dependencies/i });
    expect(pill).toBeTruthy();
    expect(pill.className).toContain('is-blocked');
  });
});

/**
 * sk-437 — the header carries the issue's creation date next to the
 * version badge. The fixture's `createdAt` is 2026-05-15T10:00:00Z, so
 * the rendered date is asserted in UTC: the formatter is deliberately
 * locale-independent, and a test that accepted the local rendering
 * would pass in CI and lie about what a reader in another timezone
 * sees.
 */
describe('DetailsHeader — sk-437 creation date', () => {
  test('renders the created date in UTC with the full timestamp on hover', () => {
    render(
      <Wrapper>
        <DetailsHeader
          issue={makeIssue({})}
          isWatching={false}
          watchToggling={false}
          {...noopHandlers}
        />
      </Wrapper>,
    );
    const created = screen.getByText(/^created 2026-05-15$/);
    expect(created).toBeTruthy();
    // The fixture is far older than the 30-day relative window, so the
    // relative form collapses to the same date — the tooltip must NOT
    // repeat it in parentheses.
    expect(created.getAttribute('title')).toBe('Created 2026-05-15 10:00 UTC');
  });

  test('a recent issue keeps the relative form in the hover text', () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    render(
      <Wrapper>
        <DetailsHeader
          issue={{ ...makeIssue({}), createdAt: twoDaysAgo }}
          isWatching={false}
          watchToggling={false}
          {...noopHandlers}
        />
      </Wrapper>,
    );
    const created = screen.getByText(/^created \d{4}-\d{2}-\d{2}$/);
    expect(created.getAttribute('title')).toMatch(/^Created .+ UTC \(2 days ago\)$/);
  });
});


/**
 * sk-489 (test plan, row 57) — the close outcome in the card header:
 * display (US-7) and the edit control (US-12, US-10).
 *
 * Two mistakes are discriminated here, both silent:
 *
 *  1. HIDING BY VALUE instead of hiding by the absence of the field. A control
 *     hidden at "done" looks reasonable — and forbids leaving
 *     "done", i.e. cancels half of US-12. It must be hidden by the
 *     ABSENCE of the field: an api that knows nothing about the outcome will not send the field
 *     (US-10), and an edit on it would be a refusal anyway.
 *  2. The control's OWN PERMISSION GATE. No other header
 *     field has one (all four `disabled` in `DetailsHeader.tsx` are waiting for
 *     mutations), and one introduced for the outcome would diverge from US-12 "the same
 *     circle that can edit the fields". The server knows the circle; the refusal
 *     comes from it and is shown by the usual toast (the model path is
 *     `saveRefusalToast.test.tsx`).
 *
 * ⚠ A Mantine modal appears in the portal not in the same tick as the click, —
 * its content is reached with `findBy*`.
 */
describe('DetailsHeader — sk-489 close outcome (row 57)', () => {
  const CONTROL = /close outcome of sk-42/i;

  function renderHeader(
    issue: IssueDetail,
    onUpdateField = vi.fn().mockResolvedValue(undefined),
  ) {
    render(
      <Wrapper>
        <DetailsHeader
          issue={issue}
          isWatching={false}
          watchToggling={false}
          {...noopHandlers}
          onUpdateField={onUpdateField}
        />
      </Wrapper>,
    );
    return onUpdateField;
  }

  const closed = (closeOutcome?: string) =>
    makeIssue({ status: 'closed', closeOutcome });

  test('closed as "won\'t do" — the outcome label next to the status', () => {
    renderHeader(closed('wont_do'));
    expect(screen.getByText("won't do")).toBeTruthy();
  });

  test('closed as "done" — NO extra text, but the control is there', () => {
    renderHeader(closed('done'));
    // "Closed" already reads as done; the label would repeat the status.
    expect(screen.queryByText('done')).toBeNull();
    // And yet one can leave "done" — the control is in place.
    expect(screen.getByRole('button', { name: CONTROL })).toBeTruthy();
  });

  test('an unfamiliar value is printed AS IS (INV-2)', () => {
    renderHeader(closed('invented_by_a_newer_server'));
    expect(screen.getByText('invented_by_a_newer_server')).toBeTruthy();
  });

  test('an UNCLOSED task has no control', () => {
    renderHeader(makeIssue({ status: 'open' }));
    expect(screen.queryByRole('button', { name: CONTROL })).toBeNull();
  });

  test('a closed one WITHOUT THE FIELD has no control (US-10 — an old api)', () => {
    renderHeader(closed(undefined));
    expect(screen.queryByRole('button', { name: CONTROL })).toBeNull();
  });

  test('the control is rendered even under SOMEONE ELSE\'S lock — it has no permission gate of its own', () => {
    // US-12: the outcome can be edited by the same circle that can edit the fields
    // of this task. A client-side gate for header field edits does not exist, and
    // the outcome has none either — the refusal comes from the server.
    const issue: IssueDetail = {
      ...closed('wont_do'),
      lockedBy: 'mcp-session-someone-else',
      lockedByUsername: 'alice',
    };
    renderHeader(issue);
    const control = screen.getByRole('button', { name: CONTROL });
    expect(control).toBeTruthy();
    expect(control.hasAttribute('disabled')).toBe(false);
  });

  test('an edit to "done" sends closeOutcome: "done"', async () => {
    const user = userEvent.setup();
    const onUpdateField = renderHeader(closed('wont_do'));
    await user.click(screen.getByRole('button', { name: CONTROL }));
    await user.click(await screen.findByRole('radio', { name: 'done' }));
    await user.click(screen.getByRole('button', { name: 'OK' }));
    // Exactly a key with a value, not an empty body: an outcome edit is not a
    // transition, it has no default (US-12).
    expect(onUpdateField).toHaveBeenCalledWith({ closeOutcome: 'done' });
  });

  test('"duplicate" offers a target — as in the close modal (US-2)', async () => {
    const user = userEvent.setup();
    const onUpdateField = renderHeader(closed('done'));
    await user.click(screen.getByRole('button', { name: CONTROL }));
    await user.click(await screen.findByRole('radio', { name: 'duplicate' }));
    await user.type(screen.getByLabelText(/target issue/i), 'sk-9');
    await user.click(screen.getByRole('button', { name: 'OK' }));
    expect(onUpdateField).toHaveBeenCalledWith({
      closeOutcome: 'duplicate',
      closeTarget: 'sk-9',
    });
  });

  test('the current outcome is preselected in the control', async () => {
    const user = userEvent.setup();
    renderHeader(closed('superseded'));
    await user.click(screen.getByRole('button', { name: CONTROL }));
    const radio = (await screen.findByRole('radio', {
      name: 'superseded',
    })) as HTMLInputElement;
    expect(radio.checked).toBe(true);
  });

  test('an unfamiliar current outcome selects no button', async () => {
    // Substituting "done" would lie about the current outcome, and
    // adding a fifth button would print a foreign string as our own option.
    const user = userEvent.setup();
    renderHeader(closed('invented_by_a_newer_server'));
    await user.click(screen.getByRole('button', { name: CONTROL }));
    const radios = (await screen.findAllByRole('radio')) as HTMLInputElement[];
    expect(radios).toHaveLength(4);
    expect(radios.filter((r) => r.checked)).toHaveLength(0);
  });

  /**
   * sk-489 · review of wave F/1, MINOR (both critics independently) — "OK" with
   * an unfamiliar current outcome.
   *
   * No button is selected — that is correct (INV-2, the test above). But "OK"
   * stayed active and sent the unfamiliar string to `patchIssue`;
   * the server rightly rejects it (`close_outcome.go#ValidateCloseOutcome`),
   * and the user got a refusal toast for an action they did not
   * take. Both the ban and its lifting by a PICK are checked —
   * otherwise a forever-disabled "OK" would pass as a "fix".
   */
  test('unfamiliar outcome: "OK" is disabled and sends nothing', async () => {
    const user = userEvent.setup();
    const onUpdateField = renderHeader(closed('invented_by_a_newer_server'));
    await user.click(screen.getByRole('button', { name: CONTROL }));
    const ok = (await screen.findByRole('button', { name: 'OK' })) as HTMLButtonElement;
    expect(ok.disabled).toBe(true);
    await user.click(ok);
    expect(onUpdateField).not.toHaveBeenCalled();
  });

  test('unfamiliar outcome: a pick enables "OK", and the PICKED value is sent', async () => {
    const user = userEvent.setup();
    const onUpdateField = renderHeader(closed('invented_by_a_newer_server'));
    await user.click(screen.getByRole('button', { name: CONTROL }));
    await user.click(await screen.findByRole('radio', { name: "won't do" }));
    const ok = screen.getByRole('button', { name: 'OK' }) as HTMLButtonElement;
    expect(ok.disabled).toBe(false);
    await user.click(ok);
    expect(onUpdateField).toHaveBeenCalledWith({ closeOutcome: 'wont_do' });
  });

  /**
   * sk-489 · review of wave F/1, MINOR — the outcome must be announced by a
   * screen reader.
   *
   * `aria-label` REPLACES the button content, so the control's name must
   * carry the value itself — the neighbouring header labels do so
   * (`header.statusAria`, `header.changeType`), and the type test above
   * ("Change type — currently <type>") checks exactly that on the neighbour.
   * The ACCESSIBLE NAME is checked, not the attribute: replacing the content is exactly
   * the property because of which a visible label does not become the name.
   */
  test('the accessible name of the control names the current outcome', () => {
    renderHeader(closed('wont_do'));
    expect(
      screen.getByRole('button', { name: /currently won't do/i }),
    ).toBeTruthy();
  });

  test('the accessible name also names "done" — it has no visible label', () => {
    // The label next to the status is dropped for "done" on purpose (US-7), and
    // without the value in the name the control would say nothing about the outcome at all.
    renderHeader(closed('done'));
    expect(
      screen.getByRole('button', { name: /currently done/i }),
    ).toBeTruthy();
  });

  /**
   * sk-540.2 — "duplicate" / "superseded" require a target, except (b) keeping the
   * current outcome and (a) a change when the matching edge exists:
   * `duplicates` outgoing, `supersedes` incoming. The edges come from the
   * issue's dependency list (the card carries none).
   */
  describe('sk-540.2 — target required for duplicate / superseded', () => {
    const edge = (
      type: 'duplicates' | 'supersedes',
      fromId: string,
      toId: string,
    ): DependencyList['outgoing'][number] => ({
      type,
      fromId,
      toId,
      version: 1,
      createdAt: '2026-09-01T00:00:00Z',
      metadata: {},
    });

    beforeEach(() => {
      deps.listDependencies.mockReset();
      deps.listDependencies.mockResolvedValue(EMPTY_DEPS);
    });

    const openControl = async (issue: IssueDetail) => {
      const user = userEvent.setup();
      const onUpdateField = renderHeader(issue);
      await user.click(screen.getByRole('button', { name: CONTROL }));
      return { user, onUpdateField };
    };

    test('label has no "(optional)"; without an edge the target is required and OK waits for it', async () => {
      const { user, onUpdateField } = await openControl(closed('done'));
      await user.click(await screen.findByRole('radio', { name: 'duplicate' }));
      const input = screen.getByLabelText(/target issue/i) as HTMLInputElement;
      expect(input.labels?.[0]?.textContent ?? '').not.toMatch(/optional/i);
      expect(input.required).toBe(true);
      const ok = screen.getByRole('button', { name: 'OK' }) as HTMLButtonElement;
      expect(ok.disabled).toBe(true);
      await user.click(ok);
      expect(onUpdateField).not.toHaveBeenCalled();

      await user.type(input, 'sk-9');
      expect(ok.disabled).toBe(false);
    });

    test('(a) an outgoing duplicates edge lifts the requirement', async () => {
      const issue = closed('done');
      deps.listDependencies.mockResolvedValue({
        outgoing: [edge('duplicates', issue.id, 'sk-1')],
        incoming: [],
      });
      const { user, onUpdateField } = await openControl(issue);
      await user.click(await screen.findByRole('radio', { name: 'duplicate' }));
      const ok = screen.getByRole('button', { name: 'OK' }) as HTMLButtonElement;
      await vi.waitFor(() => expect(ok.disabled).toBe(false));
      expect(deps.listDependencies).toHaveBeenCalledWith(issue.projectId, issue.id);
      expect((screen.getByLabelText(/target issue/i) as HTMLInputElement).required).toBe(false);
      await user.click(ok);
      expect(onUpdateField).toHaveBeenCalledWith({ closeOutcome: 'duplicate' });
    });

    test('(a) direction matters: superseded needs an INCOMING supersedes edge', async () => {
      const issue = closed('done');
      // Wrong direction for superseded: this issue supersedes another.
      deps.listDependencies.mockResolvedValue({
        outgoing: [edge('supersedes', issue.id, 'sk-1')],
        incoming: [edge('duplicates', 'sk-2', issue.id)],
      });
      const { user } = await openControl(issue);
      await user.click(await screen.findByRole('radio', { name: 'superseded' }));
      await vi.waitFor(() => expect(deps.listDependencies).toHaveBeenCalled());
      const ok = screen.getByRole('button', { name: 'OK' }) as HTMLButtonElement;
      expect(ok.disabled).toBe(true);
    });

    test('(a) an incoming supersedes edge lifts the requirement for superseded', async () => {
      const issue = closed('wont_do');
      deps.listDependencies.mockResolvedValue({
        outgoing: [],
        incoming: [edge('supersedes', 'sk-3', issue.id)],
      });
      const { user, onUpdateField } = await openControl(issue);
      await user.click(await screen.findByRole('radio', { name: 'superseded' }));
      const ok = screen.getByRole('button', { name: 'OK' }) as HTMLButtonElement;
      await vi.waitFor(() => expect(ok.disabled).toBe(false));
      await user.click(ok);
      expect(onUpdateField).toHaveBeenCalledWith({ closeOutcome: 'superseded' });
    });

    test('(b) keeping the current duplicate outcome needs no target', async () => {
      const { user, onUpdateField } = await openControl(closed('duplicate'));
      const ok = (await screen.findByRole('button', { name: 'OK' })) as HTMLButtonElement;
      expect(ok.disabled).toBe(false);
      await user.click(ok);
      expect(onUpdateField).toHaveBeenCalledWith({ closeOutcome: 'duplicate' });
    });
  });

  test('an unfamiliar outcome sounds as the string itself, without a tone (INV-2)', () => {
    renderHeader(closed('invented_by_a_newer_server'));
    expect(
      screen.getByRole('button', { name: /currently invented_by_a_newer_server/i }),
    ).toBeTruthy();
  });
});
