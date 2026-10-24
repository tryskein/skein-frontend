/**
 * sk-62.2 — `useReminders` hook tests.
 *
 * Mocks the FROZEN reminders REST client so tests never hit a live
 * endpoint, and asserts the derivations every reminder surface depends
 * on:
 *   - the badge reads `ringingTaskCount` off the canonical list query;
 *   - the cross-surface ringing SET is the distinct ringing issue ids;
 *   - per-issue reminders filter correctly (multiple reminders/issue);
 *   - dismiss optimistically removes the row + recomputes the badge.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render, cleanup, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type { Reminder, RemindersListResponse } from '../../api/reminders';
import {
  remindersListKey,
  useDismissReminder,
  useIssueReminders,
  useRingingIssueIds,
  useRingingTaskCount,
} from '../useReminders';

const listSpy = vi.fn<() => Promise<RemindersListResponse>>();
const dismissSpy = vi.fn<(id: string, note?: string) => Promise<void>>();

vi.mock('../../api/reminders', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/reminders')>();
  return {
    ...actual,
    listReminders: () => listSpy(),
    dismissReminder: (id: string, note?: string) => dismissSpy(id, note),
  };
});

vi.mock('../../components/Toaster', () => ({
  useToaster: () => ({ error: vi.fn(), success: vi.fn() }),
}));

function reminder(over: Partial<Reminder> = {}): Reminder {
  return {
    id: 'rem-1',
    issueId: 'sk-1',
    issueTitle: 'title',
    issueStatus: 'open',
    projectId: 'p-uuid',
    issueType: 'task',
    issuePriority: 3,
    remindAt: '2026-06-01T10:00:00.000Z',
    snoozeCount: 0,
    state: 'armed',
    ...over,
  };
}

let captured: {
  ringingCount: number;
  ringingIds: ReadonlySet<string>;
  issueReminders: Reminder[];
  dismiss: ReturnType<typeof useDismissReminder>;
} | null = null;

function Host({ issueId }: { issueId: string }) {
  const ringingCount = useRingingTaskCount();
  const ringingIds = useRingingIssueIds();
  const issueReminders = useIssueReminders(issueId);
  const dismiss = useDismissReminder();
  captured = { ringingCount, ringingIds, issueReminders, dismiss };
  return null;
}

function renderHost(issueId = 'sk-1') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const utils = render(
    <QueryClientProvider client={client}>
      <Host issueId={issueId} />
    </QueryClientProvider>,
  );
  return { client, ...utils };
}

beforeEach(() => {
  listSpy.mockReset();
  dismissSpy.mockReset();
  captured = null;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('useReminders — badge + ringing set derivations', () => {
  test('badge reads ringingTaskCount from the list response', async () => {
    listSpy.mockResolvedValue({
      reminders: [reminder({ state: 'ringing' })],
      ringingTaskCount: 5, // server-authoritative distinct-issue count
    });
    renderHost();

    await waitFor(() => expect(captured?.ringingCount).toBe(5));
  });

  test('ringing set is the DISTINCT ringing issue ids (armed excluded)', async () => {
    listSpy.mockResolvedValue({
      reminders: [
        reminder({ id: 'a', issueId: 'sk-1', state: 'ringing' }),
        // second ringing reminder on the SAME issue → one set entry
        reminder({ id: 'b', issueId: 'sk-1', state: 'ringing' }),
        reminder({ id: 'c', issueId: 'sk-2', state: 'ringing' }),
        // armed → excluded from the ringing set
        reminder({ id: 'd', issueId: 'sk-3', state: 'armed' }),
      ],
      ringingTaskCount: 2,
    });
    renderHost();

    await waitFor(() => expect(captured?.ringingIds.size).toBe(2));
    expect(captured?.ringingIds.has('sk-1')).toBe(true);
    expect(captured?.ringingIds.has('sk-2')).toBe(true);
    expect(captured?.ringingIds.has('sk-3')).toBe(false);
  });

  test('useIssueReminders returns ALL reminders for the issue (>1 supported)', async () => {
    listSpy.mockResolvedValue({
      reminders: [
        reminder({ id: 'a', issueId: 'sk-1' }),
        reminder({ id: 'b', issueId: 'sk-1', state: 'ringing' }),
        reminder({ id: 'c', issueId: 'sk-2' }),
      ],
      ringingTaskCount: 1,
    });
    renderHost('sk-1');

    await waitFor(() => expect(captured?.issueReminders.length).toBe(2));
    expect(captured?.issueReminders.map((r) => r.id).sort()).toEqual(['a', 'b']);
  });
});

describe('useDismissReminder — optimistic removal', () => {
  test('optimistically drops the row and recomputes the ringing badge', async () => {
    const full: RemindersListResponse = {
      reminders: [
        reminder({ id: 'a', issueId: 'sk-1', state: 'ringing' }),
        reminder({ id: 'b', issueId: 'sk-2', state: 'ringing' }),
      ],
      ringingTaskCount: 2,
    };
    const afterDismiss: RemindersListResponse = {
      reminders: [reminder({ id: 'b', issueId: 'sk-2', state: 'ringing' })],
      ringingTaskCount: 1,
    };
    // First fetch returns the full list; the settle-refetch (after the
    // dismiss round-trip) returns the server's post-dismiss list — so the
    // optimistic state and the reconciled state agree on 1.
    listSpy.mockResolvedValueOnce(full).mockResolvedValue(afterDismiss);
    dismissSpy.mockResolvedValue(undefined);
    renderHost();

    await waitFor(() => expect(captured?.ringingCount).toBe(2));

    // Dismiss the only ringing reminder on sk-1 → badge drops to 1
    // (distinct-issue count) and the ringing set loses sk-1.
    act(() => {
      captured!.dismiss.mutate({ reminderId: 'a' });
    });

    await waitFor(() => expect(captured?.ringingCount).toBe(1));
    expect(captured?.ringingIds.has('sk-1')).toBe(false);
    expect(captured?.ringingIds.has('sk-2')).toBe(true);
    expect(dismissSpy).toHaveBeenCalledWith('a', undefined);
  });
});

// ───────── sk-303.13 (T035, row 43) — the badge follows the invalidation ─────────

describe('useReminders — the alarm badge needs no notification frame', () => {
  test('busting the canonical key refetches and the badge follows', async () => {
    // This is the whole client half of the T035 path: the project
    // `EventEnvelope reminder.rang` busts this key (asserted in
    // liveEventInvalidation / useLiveEvents), and the badge has to move
    // on that alone — no NotificationEnvelope, no web push, nothing
    // per-user at all. The rung reminder here is the SC-023 case: the
    // owner has no active devices, and the alarm still shows.
    listSpy.mockResolvedValueOnce({
      reminders: [reminder({ state: 'armed' })],
      ringingTaskCount: 0,
    });
    const { client } = renderHost();
    await waitFor(() => expect(captured!.ringingCount).toBe(0));

    listSpy.mockResolvedValueOnce({
      reminders: [reminder({ state: 'ringing' })],
      ringingTaskCount: 1,
    });
    await act(async () => {
      await client.invalidateQueries({ queryKey: remindersListKey });
    });

    await waitFor(() => expect(captured!.ringingCount).toBe(1));
    // …and the cross-surface highlight moves with it, so a ringing task
    // is amber on the board and in the inbox, not only in the lens.
    expect(captured!.ringingIds.has('sk-1')).toBe(true);
    expect(listSpy).toHaveBeenCalledTimes(2);
  });
});
