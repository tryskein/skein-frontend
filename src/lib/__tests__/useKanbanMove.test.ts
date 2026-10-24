/**
 * sk-285.2.3 — the optimistic patch and the failure wording behind a
 * card drop.
 *
 * Both are pure functions on purpose: the patch decides what the board
 * shows in the ~200 ms before the server answers (and what a rollback
 * has to restore), and the wording is the only thing the user gets when
 * the answer is "no".
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError, BusinessError } from '../../api/client';
import {
  applyKanbanPatchToTasksCache,
  computeKanbanPatch,
  formatTransitionError,
  useKanbanMove,
} from '../useKanbanMove';
import type { IssueStatus, IssueSummary, TransitionCloseInput } from '../../api/issues';

// sk-489 (test plan, row 56) — a spy on `transitionStatus`. A shape with
// `vi.mock` + `renderHook` did not exist in this file until now: it held
// only pure helpers. The model of the shape is `useIssueDetail.changeStatus.test.tsx`
// (that one runs `useIssueDetail` and does not import the board).
const transitionStatusSpy =
  vi.fn<
    (
      project: string,
      id: string,
      expectedVersion: number,
      status: IssueStatus,
      reason?: string,
      force?: boolean,
      close?: TransitionCloseInput,
    ) => Promise<unknown>
  >();

vi.mock('../../api/issues', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/issues')>();
  return {
    ...actual,
    transitionStatus: (...args: unknown[]) =>
      (transitionStatusSpy as unknown as (...a: unknown[]) => Promise<unknown>)(...args),
  };
});

vi.mock('../../components/Toaster', () => ({
  useToaster: () => ({ error: vi.fn(), success: vi.fn() }),
}));

function issue(over: Partial<IssueSummary> = {}): IssueSummary {
  return {
    id: 'sk-1',
    projectId: 'p',
    version: 4,
    title: 'hello',
    type: 'task',
    priority: 3,
    status: 'open',
    pinned: false,
    componentIds: [],
    labels: [],
    isBlocked: false,
    updatedAt: '2026-08-20T10:00:00Z',
    createdAt: '2026-08-01T10:00:00Z',
    ...over,
  };
}

const paged = (...items: IssueSummary[][]) => ({
  pages: items.map((page) => ({ items: page, total: page.length })),
  pageParams: [undefined],
});

/** Echoes the key back so assertions read as the key, not as English. */
const t = ((key: string) => key) as unknown as TFunction;

/**
 * sk-285.2.4 — the status axis expressed as the generic patch the hook
 * now builds for every axis. Wrapping it here keeps these assertions
 * about the CACHE mechanics (what moves, what keeps its reference)
 * rather than about the shape of one axis's patch.
 */
const statusPatch = (status: IssueSummary['status']) => ({
  fields: { status },
  bumpVersion: true,
});

describe('applyKanbanPatchToTasksCache', () => {
  test('moves the target issue and bumps its version', () => {
    const before = paged([issue({ id: 'sk-1' }), issue({ id: 'sk-2' })]);
    const after = applyKanbanPatchToTasksCache(before, 'sk-1', statusPatch('in_progress'));
    expect(after.pages[0].items[0]).toMatchObject({
      id: 'sk-1',
      status: 'in_progress',
      version: 5,
    });
  });

  test('leaves every other row untouched, by reference', () => {
    const other = issue({ id: 'sk-2' });
    const before = paged([issue({ id: 'sk-1' }), other]);
    const after = applyKanbanPatchToTasksCache(before, 'sk-1', statusPatch('closed'));
    expect(after.pages[0].items[1]).toBe(other);
  });

  test('finds the issue on any page, not just the first', () => {
    const before = paged([issue({ id: 'sk-1' })], [issue({ id: 'sk-9' })]);
    const after = applyKanbanPatchToTasksCache(before, 'sk-9', statusPatch('deferred'));
    expect(after.pages[1].items[0].status).toBe('deferred');
    // Untouched page keeps its identity → memoised rows do not re-render.
    expect(after.pages[0]).toBe(before.pages[0]);
  });

  test('a cache entry without the issue is returned unchanged, by reference', () => {
    const before = paged([issue({ id: 'sk-2' })]);
    expect(applyKanbanPatchToTasksCache(before, 'sk-1', statusPatch('closed'))).toBe(before);
  });

  test('a no-op move (already in that status) changes nothing', () => {
    const before = paged([issue({ id: 'sk-1', status: 'open' })]);
    expect(applyKanbanPatchToTasksCache(before, 'sk-1', statusPatch('open'))).toBe(before);
  });

  test('a cache entry that is not a paged issue list is left alone', () => {
    expect(applyKanbanPatchToTasksCache(undefined, 'sk-1', statusPatch('closed'))).toBe(undefined);
    const junk = { something: 'else' };
    expect(applyKanbanPatchToTasksCache(junk, 'sk-1', statusPatch('closed'))).toBe(junk);
    const emptyPages = { pages: [undefined] };
    expect(applyKanbanPatchToTasksCache(emptyPages, 'sk-1', statusPatch('closed'))).toBe(emptyPages);
  });
});

describe('formatTransitionError', () => {
  test('a 409 gets the version-conflict wording, not the raw server text', () => {
    const err = new ApiError(409, 'if-match failed', 'version_conflict');
    expect(formatTransitionError(err, t)).toBe('kanban.errorVersionConflict');
  });

  test('a forbidden transition surfaces the server’s own reason', () => {
    const err = new BusinessError(
      422,
      'cannot work a standing issue directly',
      'cannot_work_standing_directly',
    );
    expect(formatTransitionError(err, t)).toBe(
      'cannot work a standing issue directly',
    );
  });

  test('an error with no message still says something actionable', () => {
    expect(formatTransitionError(new BusinessError(422, ''), t)).toBe(
      'kanban.errorGeneric',
    );
    expect(formatTransitionError(new Error(''), t)).toBe('kanban.errorGeneric');
    expect(formatTransitionError('boom-string', t)).toBe('kanban.errorGeneric');
  });

  test('a plain network error keeps its own message', () => {
    expect(formatTransitionError(new Error('Failed to fetch'), t)).toBe(
      'Failed to fetch',
    );
  });
});

/**
 * sk-285.2.4 — what a drop MEANS, per axis.
 *
 * This is the half of the gesture the server never sees: the patch
 * decides both what the board paints immediately and what the request
 * will carry. Getting it wrong on a multi-value axis silently destroys
 * data (a task loses the components it was not dragged by), so the
 * replacement rule is pinned here rather than left to the drag handler.
 */
describe('computeKanbanPatch', () => {
  test('status → the status field, version bumped', () => {
    expect(computeKanbanPatch(issue({ status: 'open' }), 'status', 'open', 'closed')).toEqual({
      fields: { status: 'closed' },
      bumpVersion: true,
    });
  });

  test('priority → the numeric field, not the column string', () => {
    expect(computeKanbanPatch(issue({ priority: 3 }), 'priority', '3', '0')).toEqual({
      fields: { priority: 0 },
      bumpVersion: true,
    });
  });

  test('type → the type field', () => {
    expect(computeKanbanPatch(issue({ type: 'task' }), 'type', 'task', 'bug')).toEqual({
      fields: { type: 'bug' },
      bumpVersion: true,
    });
  });

  test('assignee → the assignee, and the unassigned column is a real target', () => {
    expect(computeKanbanPatch(issue({ assignee: 'zoe' }), 'assignee', 'zoe', 'adam')).toEqual({
      fields: { assignee: 'adam' },
      bumpVersion: true,
    });
    expect(computeKanbanPatch(issue({ assignee: 'zoe' }), 'assignee', 'zoe', null)).toEqual({
      fields: { assignee: null },
      bumpVersion: true,
    });
  });

  test('component → REPLACES the dragged-from value, keeps the others', () => {
    expect(
      computeKanbanPatch(
        issue({ componentIds: ['api', 'ui'] }),
        'component',
        'api',
        'db',
      ),
    ).toEqual({ fields: { componentIds: ['db', 'ui'] }, bumpVersion: true });
  });

  test('label → same replacement, but NO version bump', () => {
    // The label endpoints write updated_at only (no version = version+1),
    // so guessing a bump here would make the NEXT drag send a stale
    // If-Match and 409 for no reason.
    expect(
      computeKanbanPatch(issue({ labels: ['ux', 'perf'] }), 'label', 'ux', 'a11y'),
    ).toEqual({ fields: { labels: ['a11y', 'perf'] }, bumpVersion: false });
  });

  test('project → no patch at all; the board never writes that axis', () => {
    expect(computeKanbanPatch(issue(), 'project', 'p1', 'p2')).toBeNull();
  });

  test('a move that changes nothing produces no patch', () => {
    expect(computeKanbanPatch(issue({ status: 'open' }), 'status', 'open', 'open')).toBeNull();
    expect(
      computeKanbanPatch(issue({ componentIds: ['api'] }), 'component', 'api', 'api'),
    ).toBeNull();
  });
});

describe('applyKanbanPatchToTasksCache — non-status axes', () => {
  test('a label move rewrites the labels and leaves the version alone', () => {
    const before = paged([issue({ id: 'sk-1', labels: ['ux'], version: 4 })]);
    const after = applyKanbanPatchToTasksCache(before, 'sk-1', {
      fields: { labels: ['a11y'] },
      bumpVersion: false,
    });
    expect(after.pages[0].items[0]).toMatchObject({ labels: ['a11y'], version: 4 });
  });

  test('an array patch equal to what is already there is a no-op, by reference', () => {
    const before = paged([issue({ id: 'sk-1', componentIds: ['api'] })]);
    expect(
      applyKanbanPatchToTasksCache(before, 'sk-1', {
        fields: { componentIds: ['api'] },
        bumpVersion: true,
      }),
    ).toBe(before);
  });
});


/**
 * sk-489 (test plan, row 56) — a GUARD: the board does not pass the outcome.
 *
 * US-1: "dragging a card into the 'closed' column gives the outcome
 * 'done'; there is no outcome choice on the board". The default is set by the SERVER on
 * the transition, and that is exactly why the board must stay silent: if it put
 * `closeOutcome: "done"` into the body itself, closing from the board would start
 * getting a refusal on an api that knows nothing about the outcome (US-10, SC-010),
 * although the same result was asked for.
 *
 * The test is green even WITHOUT the feature row: the plan did not change the board. Its point is
 * to forbid a FUTURE passing of the outcome from here against US-1. The discriminating
 * power is in the pair with row 52 (`transitionStatus` does not put the key into the body
 * when the outcome is not set): together they say "the board does not ask for an outcome, and
 * the request body does not carry it".
 */
describe('useKanbanMove — sk-489 guard: the board does not pass the close outcome', () => {
  // The file is `.ts`, not `.tsx`: JSX is unavailable here, and the wrapper is built
  // with `createElement`. The client is created once per describe — a new one on each
  // render would reset the cache in the middle of a mutation.
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);

  beforeEach(() => {
    transitionStatusSpy.mockReset();
    transitionStatusSpy.mockResolvedValue({});
  });

  afterEach(() => cleanup());

  test('a move to "closed" calls transitionStatus WITHOUT outcome and target', async () => {
    const { result } = renderHook(() => useKanbanMove(), { wrapper });

    result.current.mutate({
      item: issue({ id: 'sk-1', projectId: 'p', version: 4, status: 'open' }),
      axis: 'status',
      from: 'open',
      to: 'closed',
    });

    await waitFor(() => expect(transitionStatusSpy).toHaveBeenCalledTimes(1));
    // Exactly four arguments: neither a seventh (outcome and target), nor even
    // `undefined` in its place. `toHaveBeenCalledWith` checks arity,
    // so an extra argument turns red even if it is empty.
    expect(transitionStatusSpy).toHaveBeenCalledWith('p', 'sk-1', 4, 'closed');
  });
});
