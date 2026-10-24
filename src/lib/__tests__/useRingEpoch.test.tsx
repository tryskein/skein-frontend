/**
 * sk-551.36 — `useRingEpoch`: the header's finite ring starts again when
 * a NEW alarm goes off, and only then.
 *
 * Contract (from the task): the ringing animations run ~10 s and stop;
 * "repeat on a new ring". A new ring is a reminder entering the
 * ringing set — including a snoozed one ringing again (a new
 * `remindAt`); the scheduler stamping `notifiedAt` on a ring already seen
 * is not a new ring. Silencing one alarm (it leaves the set) must not ring
 * the rest again, and a refetch that changes nothing must not either.
 */
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { Reminder, RemindersListResponse } from '../../api/reminders';
import { remindersListKey, useRingEpoch } from '../useReminders';

// The cache is seeded by hand; the network fetch must never resolve.
vi.mock('../../api/reminders', async (importActual) => {
  const actual = await importActual<typeof import('../../api/reminders')>();
  return { ...actual, listReminders: () => new Promise(() => {}) };
});

function reminder(
  id: string,
  state: Reminder['state'],
  notifiedAt?: string,
  remindAt = '2026-10-04T06:00:00Z',
): Reminder {
  return {
    id,
    issueId: `sk-${id}`,
    issueTitle: id,
    issueStatus: 'open',
    projectId: 'p1',
    issueType: 'task',
    issuePriority: 2,
    remindAt,
    notifiedAt: notifiedAt ?? null,
    snoozeCount: 0,
    state,
  } as Reminder;
}

function setup(initial: Reminder[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const put = (reminders: Reminder[]) =>
    client.setQueryData<RemindersListResponse>(remindersListKey, {
      reminders,
      ringingTaskCount: reminders.filter((r) => r.state === 'ringing').length,
    });
  put(initial);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useRingEpoch(), { wrapper });
  // TanStack hands cache updates to observers on a later tick, so the
  // act() has to be awaited for the hook to see them.
  const update = (reminders: Reminder[]) =>
    act(async () => {
      put(reminders);
      await new Promise((r) => setTimeout(r, 0));
    });
  return { hook, update };
}

describe('useRingEpoch', () => {
  it('steps when a reminder starts ringing next to one already ringing', async () => {
    const a = reminder('a', 'ringing', '2026-10-04T06:00:00Z');
    const { hook, update } = setup([a, reminder('b', 'armed')]);
    const before = hook.result.current;

    await update([a, reminder('b', 'ringing', '2026-10-04T06:05:00Z')]);

    expect(hook.result.current).toBe(before + 1);
  });

  it('does not step when a ringing reminder is dismissed or snoozed', async () => {
    const a = reminder('a', 'ringing', '2026-10-04T06:00:00Z');
    const b = reminder('b', 'ringing', '2026-10-04T06:01:00Z');
    const { hook, update } = setup([a, b]);
    const before = hook.result.current;

    await update([a]); // b dismissed
    await update([a, reminder('b', 'armed')]); // …or snoozed back to armed

    expect(hook.result.current).toBe(before);
  });

  it('does not step on a refetch that brings the same ringing set', async () => {
    const a = reminder('a', 'ringing', '2026-10-04T06:00:00Z');
    const { hook, update } = setup([a]);
    const before = hook.result.current;

    await update([reminder('a', 'ringing', '2026-10-04T06:00:00Z')]);

    expect(hook.result.current).toBe(before);
  });

  it('steps when a snoozed reminder rings again, even if no poll saw it armed', async () => {
    const { hook, update } = setup([reminder('a', 'ringing', '2026-10-04T06:00:00Z')]);
    const before = hook.result.current;

    // Snooze moved remindAt to 06:15 and the reminder rang again there.
    await update([
      reminder('a', 'ringing', '2026-10-04T06:15:00Z', '2026-10-04T06:15:00Z'),
    ]);

    expect(hook.result.current).toBe(before + 1);
  });

  it('does not step when the scheduler stamps notifiedAt on a ring already seen', async () => {
    // The server derives `ringing` from remindAt, so a poll can see the
    // ring before `notifiedAt` is set; the stamp arriving later is the
    // same ring.
    const { hook, update } = setup([reminder('a', 'ringing')]);
    const before = hook.result.current;

    await update([reminder('a', 'ringing', '2026-10-04T06:00:03Z')]);

    expect(hook.result.current).toBe(before);
  });
});
