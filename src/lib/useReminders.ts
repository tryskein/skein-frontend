/**
 * Reminders TanStack Query hooks — sk-62.2 phase 1.
 *
 * One canonical list query (`state=all`) is the single source of truth
 * for every reminder surface:
 *
 *   - the header alarm-clock BADGE   → reads `ringingTaskCount`
 *   - the budilnik LENS flat list    → reads `reminders[]`
 *   - the cross-surface RINGING set  → derived from `reminders[]`
 *
 * Fetching `state=all` once (rather than separate ringing / armed
 * queries) keeps a single cache entry warm and avoids the badge and the
 * lens racing over two independent counts. The response always carries
 * the full cross-project `ringingTaskCount` regardless of filter, so
 * `state=all` is a strict superset.
 *
 * Refresh cadence mirrors `useNotificationCounts` (the header-badge
 * sibling): mount + on cache invalidation, on window focus, and a 30s
 * safety poll. sk-622.21 (T048, US-11) — the invalidation arrives with
 * the PERSONAL reminder frame (`reminder` client method, K14), addressed
 * to the reminder's owner whatever projects the tab declared; the project
 * `EventEnvelope reminder.*` no longer reaches browsers and gets no
 * reaction (`liveEventInvalidation.ts`). A `rang` frame also rings the
 * bell at once, deduplicated per firing (`ringReminderFiring`). The poll
 * matters beyond network hiccups: an
 * armed reminder whose `remindAt` quietly passes still gets re-fetched
 * within 30s, and the card surfaces flip armed → ringing off the local
 * `remindAt` clock in `reminderCountdown.ts` without waiting for either.
 */

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import {
  EMPTY_REMINDERS_LIST,
  createReminder,
  dismissReminder,
  listReminders,
  snoozeReminder,
  type CreateReminderArgs,
  type Reminder,
  type RemindersListResponse,
  type SnoozeReminderArgs,
} from '../api/reminders';
import { BusinessError } from '../api/client';
import { useToaster } from '../components/Toaster';
import { notificationCountsKey } from './useNotificationCounts';
import type { ReminderFrame } from './eventEnvelope';

/**
 * Single source-of-truth query key. Exported so the live-events provider
 * can re-read it on the personal reminder frame
 * (`useLiveEvents.tsx#BrowserClientMethods.Reminder`) without importing
 * the hook (avoids an import cycle through the fetcher). A project
 * `EventEnvelope reminder.*` re-reads nothing (sk-622.21, R14 item 5).
 */
export const remindersListKey = ['reminders', 'list', 'all'] as const;

/**
 * Canonical reminders list query. Returns the full `state=all`
 * response. Every reminder surface derives from this one entry.
 */
export function useRemindersQuery() {
  return useQuery<RemindersListResponse>({
    queryKey: remindersListKey,
    queryFn: () => listReminders('all'),
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}

/**
 * Header-badge view: the distinct-ringing-task count. Drives the
 * alarm-clock icon's violent shake + the blinking badge number when
 * `> 0`. Defaults to 0 on first paint so the header renders without an
 * undefined guard.
 */
export function useRingingTaskCount(): number {
  const q = useRemindersQuery();
  return q.data?.ringingTaskCount ?? EMPTY_REMINDERS_LIST.ringingTaskCount;
}

/**
 * Budilnik lens view: the full reminders list (armed + ringing) plus
 * the badge count and load state. The lens body sorts these
 * most-urgent-first client-side (so the partition tracks the live
 * clock, not the server stamp).
 */
export function useRemindersList() {
  const q = useRemindersQuery();
  return {
    reminders: q.data?.reminders ?? EMPTY_REMINDERS_LIST.reminders,
    ringingTaskCount:
      q.data?.ringingTaskCount ?? EMPTY_REMINDERS_LIST.ringingTaskCount,
    isLoading: q.isLoading,
    error: q.error,
  };
}

/**
 * Cross-surface ringing highlight: the SET of issue ids that currently
 * have ≥1 ringing reminder for the caller. TaskCard / InboxCard read
 * this to paint a ringing task amber wherever it appears (board, Inbox,
 * lens), not only inside the budilnik lens.
 *
 * Membership is read off the server-stamped `state === 'ringing'` (the
 * 30s poll + SignalR keep it fresh). A `Set` is referentially stable
 * across renders while the underlying ids don't change, so consumers
 * memoize cleanly.
 */
export function useRingingIssueIds(): ReadonlySet<string> {
  const q = useRemindersQuery();
  const reminders = q.data?.reminders;
  return useMemo(() => {
    const out = new Set<string>();
    for (const r of reminders ?? []) {
      if (r.state === 'ringing') out.add(r.issueId);
    }
    return out;
  }, [reminders]);
}

/**
 * The key of one FIRING of a reminder — `reminderId@remindAt` — with the
 * due time normalised to epoch milliseconds, so the same firing yields the
 * same key whichever wire spelled it: the server builds the frame's
 * `firingId` with RFC 3339 (nano) in UTC, while the list's `remindAt` is
 * whatever offset and precision the REST encoder wrote. A `remindAt` that
 * does not parse is kept verbatim (an exact-string key is still a key).
 */
export function reminderFiringKey(reminderId: string, remindAt: string): string {
  const ms = Date.parse(remindAt);
  return `${reminderId}@${Number.isNaN(ms) ? remindAt : ms}`;
}

/**
 * The firings this tab has already rung, and the ring epoch they produced.
 * One ledger per QueryClient (the tab's session cache): it outlives a
 * reconnect of the hub connection, which is what keeps a frame re-sent
 * after the reconnect from ringing again (US-14), and it is shared by the
 * two sources a ring comes from — the personal `rang` frame and the
 * reminders list gaining a ringing member — so one firing rings once,
 * whichever of them sees it first.
 */
interface RingLedger {
  rung: Set<string>;
  epoch: number;
  listeners: Set<() => void>;
  /**
   * The `useSyncExternalStore` subscribe of this ledger — made ONCE with
   * the ledger, so it is the same function on every render: a new one per
   * render makes React unsubscribe and subscribe again on each render of
   * every consumer (fable MINOR-4).
   */
  subscribe: (onChange: () => void) => () => void;
}

const ringLedgers = new WeakMap<QueryClient, RingLedger>();

function ringLedger(qc: QueryClient): RingLedger {
  let ledger = ringLedgers.get(qc);
  if (!ledger) {
    const listeners = new Set<() => void>();
    ledger = {
      rung: new Set(),
      epoch: 0,
      listeners,
      subscribe: (onChange) => {
        listeners.add(onChange);
        return () => {
          listeners.delete(onChange);
        };
      },
    };
    ringLedgers.set(qc, ledger);
  }
  return ledger;
}

/** Record firings; step the epoch once if any of them is new. */
function ringFirings(ledger: RingLedger, keys: Iterable<string>): boolean {
  let gained = false;
  for (const key of keys) {
    if (ledger.rung.has(key)) continue;
    ledger.rung.add(key);
    gained = true;
  }
  if (!gained) return false;
  ledger.epoch += 1;
  for (const listener of ledger.listeners) listener();
  return true;
}

/**
 * The ledger key of a frame's firing. The server's `firingId` is the
 * canonical dedup key (skein-web `BrowserContract.cs#ReminderFrame`:
 * «the ring dedup key», `{reminderId}@{remindAt}`), so the key is built
 * FROM IT — only its due-time half is normalised to epoch ms, the way
 * `reminderFiringKey` does it for the list, so that the frame and the list
 * name one firing alike (the server spells the frame's time RFC 3339 nano,
 * the list's REST encoder its own way). A `firingId` that is not
 * `id@time` with a parsable time is the key verbatim: whatever the server
 * puts in it is honoured, never second-guessed from `remindAt`.
 *
 * Only a frame WITHOUT a `firingId` falls back to the client's own
 * `reminderId@remindAt` — insurance against a frame the contract does not
 * allow (the provider drops such frames before they get here,
 * `useLiveEvents.tsx#isReminderFrame`).
 */
function frameFiringKey(frame: ReminderFrame): string {
  const firingId = typeof frame.firingId === 'string' ? frame.firingId : '';
  if (firingId === '') {
    return reminderFiringKey(frame.reminderId, frame.remindAt ?? '');
  }
  const at = firingId.indexOf('@');
  return at > 0 ? reminderFiringKey(firingId.slice(0, at), firingId.slice(at + 1)) : firingId;
}

/**
 * sk-622.21 (T048, US-11, US-14) — ring for a personal `rang` frame.
 *
 * The frame reaches every tab of the reminder's owner, the tabs that never
 * declared the issue's project included, so the bell rings there without
 * waiting for the list to be re-read. At-least-once delivery: the same
 * frame may arrive twice, before or after a reconnect, and rings once —
 * the dedup key is the FIRING (the server's `firingId`, i.e. reminder and
 * due time — see `frameFiringKey`), never the reminder alone: a snoozed
 * reminder that fires again is a new firing and rings again. Returns
 * whether this call rang.
 *
 * Only `kind === 'rang'` rings; the other kinds re-read the list only
 * (the caller's job).
 */
export function ringReminderFiring(qc: QueryClient, frame: ReminderFrame): boolean {
  if (frame.kind !== 'rang') return false;
  return ringFirings(ringLedger(qc), [frameFiringKey(frame)]);
}

/**
 * sk-551.36 — the RING EPOCH: a counter that steps each time a NEW ring
 * starts. The ringing animations in the header (pulse, glow, shake, badge)
 * are finite — about ten seconds, then the static "ringing" look — so
 * something has to start them again when another alarm goes off while the
 * pill is already ringing. The header keys that restart off this number
 * (see `BudilnikLensButton` in HeaderBar.tsx).
 *
 * A ring is one FIRING — `reminderFiringKey(id, remindAt)`, the
 * moment this cycle is due — not the bare id and not `notifiedAt`. The
 * server derives `ringing` from `remindAt` alone, so a poll can see the
 * reminder ringing before the scheduler stamps `notifiedAt`; keying on the
 * stamp would count that one ring twice. A snooze moves `remindAt`, so a
 * snoozed reminder that rings again is a new firing even if no poll caught
 * it armed in between. Members LEAVING the ringing set (a dismiss, a
 * snooze) do not step it — silencing one alarm must not make the others
 * ring again.
 *
 * sk-622.21 (T048) — the epoch lives in the tab's ring ledger
 * (`ringLedger`), fed by two sources: the list (a ringing member it has
 * not rung yet) and the personal `rang` frame (`ringReminderFiring`). A
 * firing rings once whichever source sees it first, and never again —
 * not on a repeated frame, not after a reconnect, not when a flaky read
 * drops the member and the next one brings it back.
 */
export function useRingEpoch(): number {
  const qc = useQueryClient();
  const ledger = ringLedger(qc);
  const q = useRemindersQuery();
  const reminders = q.data?.reminders;
  useEffect(() => {
    const ringing: string[] = [];
    for (const r of reminders ?? []) {
      if (r.state === 'ringing') ringing.push(reminderFiringKey(r.id, r.remindAt));
    }
    ringFirings(ledger, ringing);
  }, [reminders, ledger]);
  return useSyncExternalStore(ledger.subscribe, () => ledger.epoch);
}

/**
 * All reminders attached to one issue (for the card reminder block).
 * Derived from the same canonical list cache — no extra round-trip —
 * filtered to the issue. Preserves the server order; the block sorts
 * for display.
 */
export function useIssueReminders(issueId: string | null): Reminder[] {
  const q = useRemindersQuery();
  const reminders = q.data?.reminders;
  return useMemo(() => {
    if (!issueId) return [];
    return (reminders ?? []).filter((r) => r.issueId === issueId);
  }, [reminders, issueId]);
}

function extractMessage(err: unknown): string {
  if (err instanceof BusinessError) return err.message;
  if (err instanceof Error) return err.message || 'unknown error';
  return 'unknown error';
}

/**
 * Shared post-mutation invalidation: bust the reminders list (badge +
 * lens + ringing set all re-derive) AND the notification counts (the
 * bell badge may shift). The issue's own detail isn't touched — the
 * card block reads reminders off the list cache, so the list bust is
 * enough.
 */
function useReminderInvalidate() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: remindersListKey });
    void qc.invalidateQueries({ queryKey: notificationCountsKey });
  };
}

/** Create-reminder mutation — invalidates the list on success. */
export function useCreateReminder() {
  const toast = useToaster();
  const invalidate = useReminderInvalidate();
  return useMutation<Reminder, Error, CreateReminderArgs>({
    mutationFn: (args) => createReminder(args),
    onSuccess: () => {
      toast.success('Reminder set');
      invalidate();
    },
    onError: (err) => toast.error(`Couldn't set reminder: ${extractMessage(err)}`),
  });
}

/** Snooze-reminder mutation — invalidates the list on success. */
export function useSnoozeReminder() {
  const toast = useToaster();
  const invalidate = useReminderInvalidate();
  return useMutation<Reminder, Error, SnoozeReminderArgs>({
    mutationFn: (args) => snoozeReminder(args),
    onSuccess: () => {
      toast.success('Reminder snoozed');
      invalidate();
    },
    onError: (err) => toast.error(`Couldn't snooze: ${extractMessage(err)}`),
  });
}

/**
 * Dismiss-reminder mutation. Optimistically removes the row from the
 * canonical list cache so the relentless nag stops the instant the
 * user clicks Turn off — without waiting for the round-trip — then
 * reconciles on settle.
 */
export function useDismissReminder() {
  const qc = useQueryClient();
  const toast = useToaster();
  const invalidate = useReminderInvalidate();
  return useMutation<
    void,
    Error,
    { reminderId: string; note?: string },
    { previous: RemindersListResponse | undefined }
  >({
    mutationFn: ({ reminderId, note }) => dismissReminder(reminderId, note),
    onMutate: async ({ reminderId }) => {
      await qc.cancelQueries({ queryKey: remindersListKey });
      const previous = qc.getQueryData<RemindersListResponse>(remindersListKey);
      if (previous) {
        const removed = previous.reminders.find((r) => r.id === reminderId);
        const nextReminders = previous.reminders.filter((r) => r.id !== reminderId);
        // Drop the ringing count by one IF the removed reminder was the
        // last ringing reminder on its issue (the count is DISTINCT
        // issues, not reminders). Recompute from the remaining set to
        // stay exact rather than guessing.
        const ringingIssues = new Set<string>();
        for (const r of nextReminders) {
          if (r.state === 'ringing') ringingIssues.add(r.issueId);
        }
        const nextCount = removed
          ? ringingIssues.size
          : previous.ringingTaskCount;
        qc.setQueryData<RemindersListResponse>(remindersListKey, {
          reminders: nextReminders,
          ringingTaskCount: nextCount,
        });
      }
      return { previous };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous !== undefined) {
        qc.setQueryData(remindersListKey, ctx.previous);
      }
      toast.error(`Couldn't turn off: ${extractMessage(err)}`);
    },
    onSuccess: () => {
      toast.success('Reminder turned off');
    },
    onSettled: () => {
      invalidate();
    },
  });
}
