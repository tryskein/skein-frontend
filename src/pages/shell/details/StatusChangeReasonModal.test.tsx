/**
 * sk-489 (test plan, row 54) — the close modal: outcome pick, target,
 * retirement without a pick, and the path of the outcome to `onChangeStatus`.
 *
 * The file holds TWO levels, and both are needed:
 *
 *  1. the modal itself — what it offers and what it hands to `onSubmit`;
 *  2. its stitching with the card header — that what is handed over reaches
 *     `onChangeStatus` and that a refusal is shown INSIDE the modal by the usual
 *     path `DetailsHeader.tsx#surfaceReasonError`, and the modal stays
 *     open.
 *
 * Without the second level a state would stay green in which the modal
 * assembles the outcome correctly while the header loses it: the user picks
 * "won't do", the close goes through, and the task is closed as "done".
 *
 * Guards of the same requirement that must stay green and check nothing again
 * here: `RetireDialog.standing.test.tsx`
 * (the retirement frame).
 *
 * ⚠ A Mantine modal appears in the portal NOT in the same tick as the click
 * (a timer inside), so its content is reached with `findBy*`, not
 * `getBy*`.
 */

import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
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

import type { IssueDetail } from '../../../api/issues';
import { BusinessError } from '../../../api/client';
import { LayoutProvider } from '../../../lib/useLayoutState';
import { DetailsHeader } from './DetailsHeader';
import { StatusChangeReasonModal } from './StatusChangeReasonModal';

function Plain({ children }: { children: ReactNode }) {
  return <MantineProvider forceColorScheme="dark">{children}</MantineProvider>;
}

function Shell({ children }: { children: ReactNode }) {
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

function makeIssue(over: Partial<IssueDetail> = {}): IssueDetail {
  return {
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
    createdBy: 'user-bob',
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
    assignee: 'bob',
    ...over,
  };
}

afterEach(() => cleanup());

describe('StatusChangeReasonModal — outcome pick on close (US-1, US-2)', () => {
  const renderModal = (
    props: Partial<React.ComponentProps<typeof StatusChangeReasonModal>> = {},
  ) => {
    const onSubmit = vi.fn();
    render(
      <Plain>
        <StatusChangeReasonModal
          opened
          issueId="sk-42"
          next="closed"
          onSubmit={onSubmit}
          onClose={vi.fn()}
          {...props}
        />
      </Plain>,
    );
    return onSubmit;
  };

  test('offers four outcomes, and "done" is PRESELECTED', () => {
    renderModal();
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(4);
    // The preselection is the same as what happens without the modal: the default
    // of the transition to "closed" (US-1). Any other preselection would change
    // the behaviour of the most frequent close path.
    // jest-dom is not wired up in this suite — the state is read off the
    // element itself, not with the `toBeChecked` matcher.
    const checked = (name: string) =>
      (screen.getByRole('radio', { name }) as HTMLInputElement).checked;
    expect(checked('done')).toBe(true);
    for (const name of ["won't do", 'duplicate', 'superseded']) {
      expect(checked(name)).toBe(false);
    }
  });

  test('the target field is only for "duplicate" and "superseded"', async () => {
    const u = userEvent.setup();
    renderModal();
    // With "done" preselected there is no target.
    expect(screen.queryByLabelText(/target issue/i)).toBeNull();

    await u.click(screen.getByRole('radio', { name: "won't do" }));
    // And with "won't do" too: a target with it is a server validation refusal,
    // and a field that cannot be filled without a refusal is not offered.
    expect(screen.queryByLabelText(/target issue/i)).toBeNull();

    await u.click(screen.getByRole('radio', { name: 'duplicate' }));
    expect(screen.getByLabelText(/target issue/i)).toBeTruthy();

    await u.click(screen.getByRole('radio', { name: 'superseded' }));
    expect(screen.getByLabelText(/target issue/i)).toBeTruthy();
  });

  test('submit hands over the picked outcome and target', async () => {
    const u = userEvent.setup();
    const onSubmit = renderModal();
    await u.click(screen.getByRole('radio', { name: 'duplicate' }));
    await u.type(screen.getByLabelText(/target issue/i), 'sk-7');
    await u.type(screen.getByLabelText(/reason/i), 'same work');
    await u.click(screen.getByRole('button', { name: 'OK' }));

    expect(onSubmit).toHaveBeenCalledWith('same work', {
      closeOutcome: 'duplicate',
      closeTarget: 'sk-7',
    });
  });

  test('sk-540.2 — "duplicate" without a target: required field, OK waits for it', async () => {
    const u = userEvent.setup();
    const onSubmit = renderModal();
    await u.click(screen.getByRole('radio', { name: 'duplicate' }));
    const input = screen.getByLabelText(/target issue/i) as HTMLInputElement;
    expect(input.required).toBe(true);
    const ok = screen.getByRole('button', { name: 'OK' }) as HTMLButtonElement;
    expect(ok.disabled).toBe(true);
    await u.click(ok);
    expect(onSubmit).not.toHaveBeenCalled();

    // Whitespace is not a target.
    await u.type(input, '   ');
    expect(ok.disabled).toBe(true);

    await u.clear(input);
    await u.type(input, 'sk-7');
    expect(ok.disabled).toBe(false);
  });

  test('sk-540.2 — the target label no longer says "optional"', async () => {
    const u = userEvent.setup();
    renderModal();
    await u.click(screen.getByRole('radio', { name: 'superseded' }));
    const input = screen.getByLabelText(/target issue/i) as HTMLInputElement;
    expect(input.labels?.[0]?.textContent ?? '').not.toMatch(/optional/i);
  });

  test('"done" is handed over by the modal explicitly — the filtering is done by the api layer', async () => {
    // The modal reports the user's PICK. The rule "`done` does not go on the
    // wire" lives in `api/issues.ts` (line 52) — one place for all
    // callers; a modal that decided to stay silent about "done" by itself would deprive
    // the header of the ability to tell "picked done" from "not asked".
    const u = userEvent.setup();
    const onSubmit = renderModal();
    await u.click(screen.getByRole('button', { name: 'OK' }));
    expect(onSubmit).toHaveBeenCalledWith('', { closeOutcome: 'done' });
  });

  test('a target typed and abandoned does not go on the wire', async () => {
    const u = userEvent.setup();
    const onSubmit = renderModal();
    await u.click(screen.getByRole('radio', { name: 'duplicate' }));
    await u.type(screen.getByLabelText(/target issue/i), 'sk-7');
    // Changed their mind: an outcome that does not accept a target.
    await u.click(screen.getByRole('radio', { name: "won't do" }));
    await u.click(screen.getByRole('button', { name: 'OK' }));
    expect(onSubmit).toHaveBeenCalledWith('', { closeOutcome: 'wont_do' });
  });

  test('retirement has NO outcome pick (US-1, a permanent task)', () => {
    renderModal({ isRetire: true });
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    // And retirement itself still works: the button is in place.
    expect(screen.getByRole('button', { name: 'Retire' })).toBeTruthy();
  });

  test('retirement hands over "not asked", not "done"', async () => {
    // The outcome of a permanent task is "done", but the SERVER sets it as
    // the default of the transition. Were the modal to put the key itself, retirement would start
    // failing on an api that knows nothing about the outcome (US-10).
    const u = userEvent.setup();
    const onSubmit = renderModal({ isRetire: true });
    await u.click(screen.getByRole('button', { name: 'Retire' }));
    expect(onSubmit).toHaveBeenCalledWith('');
    expect(onSubmit.mock.calls[0]).toHaveLength(1);
  });

  test('"defer" has no outcome pick — it is not a close', () => {
    renderModal({ next: 'deferred' });
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
  });
});

describe('StatusChangeReasonModal — the outcome path through the card header', () => {
  const openCloseModal = async (
    onChangeStatus: ReturnType<typeof vi.fn>,
  ): Promise<ReturnType<typeof userEvent.setup>> => {
    const u = userEvent.setup();
    render(
      <Shell>
        <DetailsHeader
          issue={makeIssue()}
          isWatching={false}
          watchToggling={false}
          onUpdateField={vi.fn()}
          onChangeStatus={onChangeStatus}
          onAccept={vi.fn()}
          onWatchToggle={vi.fn()}
        />
      </Shell>,
    );
    // The status label opens the menu, the "closed" item opens the reason modal.
    await u.click(screen.getByRole('button', { name: /status/i }));
    // Mantine 7 hard-sets `role="menuitem"` on `Menu.Item` and
    // ignores the passed `menuitemradio` — the real role is queried
    // (the same is recorded in `DetailsHeader.test.tsx`).
    const dropdown = await screen.findByRole('menu');
    await u.click(within(dropdown).getByRole('menuitem', { name: 'closed' }));
    return u;
  };

  beforeEach(() => vi.clearAllMocks());

  test('the picked outcome reaches onChangeStatus', async () => {
    const onChangeStatus = vi.fn().mockResolvedValue(makeIssue({ status: 'closed' }));
    const u = await openCloseModal(onChangeStatus);

    await u.click(await screen.findByRole('radio', { name: "won't do" }));
    await u.click(screen.getByRole('button', { name: 'OK' }));

    expect(onChangeStatus).toHaveBeenCalledWith('closed', undefined, {
      closeOutcome: 'wont_do',
    });
  });

  test('an old api refusal on "won\'t do" is shown INSIDE the modal, and it is open', async () => {
    // Exactly the SC-010 case: an api that knows nothing about the outcome rejects
    // the whole request. The refusal must stay in the modal — by the usual path
    // `surfaceReasonError`, — and not close it as if the close
    // had gone through.
    const refusal = new BusinessError(
      400,
      'unknown field "closeOutcome"',
      'validation_error',
    );
    const onChangeStatus = vi.fn().mockResolvedValue({ error: refusal });
    const u = await openCloseModal(onChangeStatus);

    await u.click(await screen.findByRole('radio', { name: "won't do" }));
    await u.click(screen.getByRole('button', { name: 'OK' }));

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(/unknown field "closeOutcome"/)).toBeTruthy();
    // The modal stayed open: the outcome pick is in place, and it can be
    // changed without starting over.
    expect(
      (screen.getByRole('radio', { name: "won't do" }) as HTMLInputElement).checked,
    ).toBe(true);
    expect(screen.getByRole('button', { name: 'OK' })).toBeTruthy();
    // The card is unchanged: the status label in the header is still the old one.
    expect(
      screen.getByRole('button', { name: /status/i }).getAttribute('aria-label'),
    ).toContain('open');
  });
});
