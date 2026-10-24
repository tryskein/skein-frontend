/**
 * sk-389 (self-review W-3) — two clicks in flight must not split the
 * client the way ONE refusal used to.
 *
 * ── What the fix for sk-389 left open ───────────────────────────────
 *
 * sk-389 moved the `skein.theme` write off the call site and into
 * `onMutate`, and its rollback into `onError`, so a refused PUT takes
 * the storage write back out with the query cache. The snapshot it
 * rolls back to is read in `onMutate` — from the CURRENT contents of
 * the key, not from anything this mutation owns.
 *
 * `useMutation` does not serialise concurrent calls on its own, so two
 * clicks give the second mutation a snapshot of the FIRST one's
 * optimistic write:
 *
 *     click 1 (→dark):  previousStored = null ;  writes 'dark'
 *     click 2 (→light): previousStored = 'dark' (click 1's optimism!)
 *     click 2 accepted → cache and DOM say light
 *     click 1 refused  → restoreStoredBuiltin(null) → key REMOVED
 *
 * MEASURED on the real hook before the fix (PUT #1 answering 500 after
 * 80 ms, PUT #2 answering 200 at once):
 *
 *     dataTheme = light   stored = null   toasts = 1
 *
 * Which is the same shape sk-389 exists to remove — three surfaces,
 * two answers — reached by a different road. And `skein.theme === null`
 * is not inert: it means «this person never picked here», it gates the
 * OS-preference tracker, and after a logout (which clears the boot
 * cache) the login screen paints from the OS rather than from the
 * colour the server actually accepted.
 *
 * Two neighbouring cells in the header, clicked in succession, is an
 * ordinary gesture — not a contrived one.
 *
 * ── What the fix is, and what it is NOT ────────────────────────────
 *
 * The obvious answer is `scope: { id: … }`, and on its own it is
 * wrong. In `mutation.js`, `execute()` awaits `onMutate` BEFORE
 * `retryer.start()`, and the scope gate lives in the retryer's
 * `canRun` — so a scope serialises the network calls and lets both
 * `onMutate`s run back to back exactly as before. Measured with scope
 * and nothing else, both writes refused: `dataTheme=dark`,
 * `stored=dark`. The surfaces agree now, on a colour the server
 * rejected twice. Agreement is not the invariant; agreement on a
 * CONFIRMED value is.
 *
 * So the bookkeeping moved to the CHAIN of writes that overlap in
 * time: one baseline for the whole chain, advanced by each
 * acceptance, and applied to both surfaces when the chain drains.
 * `scope` stays for the other half of the problem — it makes the PUTs
 * land in CLICK order, so «the newest confirmed state» means the
 * newest click the server took rather than whichever response was
 * quickest.
 *
 * ── Why the clicks are a tick apart, and the answers are gated ─────
 *
 * `onMutate` opens with `await cancelQueries`, so two clicks issued in
 * ONE synchronous block both reach their snapshot before either
 * optimistic write has landed — and the bug needs the second snapshot
 * to see the first write. And an answer that arrives with no delay
 * settles inside its own `act()`: the chain drains, the next click
 * starts a chain of its own, and a test written that way is two
 * sequential writes wearing a concurrency test's name. Both were
 * measured here: with the calls synchronous, deleting the once-per-
 * chain baseline left this file green; with the first answer ungated,
 * so did deleting the newest-write paint guard. Every case below
 * therefore keeps the first write in flight across the second click.
 *
 * Assertions are read only after `settled()` — every write ANSWERED
 * plus a turn for the client to react. A `waitFor` on the surfaces
 * would sample during the window between two answers and pass on a
 * state the chain is about to replace.
 *
 * ── Why the assertions are about AGREEMENT ─────────────────────────
 *
 * As in `useTheme.putFailure.test.tsx`: the defect is that the
 * surfaces disagreed, so they are read as a pair. Pinning each one
 * against a constant would pass on a fix that made them agree on a
 * value the server never accepted — which is why the third case below
 * exists, where the accepted colour is the FIRST one and the refusal
 * comes second.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

import { useTheme } from '../useTheme';

const toastError = vi.fn();
vi.mock('../../components/Toaster', () => ({
  useToaster: () => ({ error: toastError, success: vi.fn(), info: vi.fn() }),
}));

const STORAGE_KEY = 'skein.theme';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * `/me/theme` where each PUT, in arrival order, is answered by the
 * matching entry of `plan`. `delayMs` on an entry makes that answer
 * land LATER than the ones after it, which is the whole point: the
 * unserialised bug needs the first write to still be in flight when
 * the second settles.
 */
function stubServer(
  stored: { mode: 'builtin'; builtinTheme: 'light' | 'dark'; customThemeId: null },
  plan: ReadonlyArray<{ status: number; delayMs?: number; gate?: Promise<void> }>,
) {
  const puts: string[] = [];
  /**
   * PUTs that have been ANSWERED, in the order the answers left the
   * stub. `puts` alone is not enough to know the client has settled —
   * a request is recorded when it starts — and every assertion here is
   * about a settled client. Without this, a `waitFor` that samples
   * during the window between two answers can pass on a state the
   * chain is about to replace, and the guard it was written to be
   * would be gone.
   */
  const answered: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/api/v1/me/theme')) {
        if ((init?.method ?? 'GET').toUpperCase() === 'PUT') {
          const body = String(init?.body ?? '{}');
          const nth = puts.length;
          puts.push(body);
          const answer = plan[Math.min(nth, plan.length - 1)];
          if (answer.delayMs) await sleep(answer.delayMs);
          // A gated answer stays in flight until the test opens it —
          // the only way to read the client MID-chain rather than
          // after it has drained.
          if (answer.gate) await answer.gate;
          answered.push(body);
          if (answer.status >= 400) {
            return new Response(JSON.stringify({ error: 'server_error', message: 'nope' }), {
              status: answer.status,
              headers: { 'content-type': 'application/json' },
            });
          }
          // The API echoes what it stored.
          return new Response(body, {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(JSON.stringify(stored), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/api/auth/me')) return new Response('unauthorized', { status: 401 });
      throw new Error(`unexpected request: ${url}`);
    }),
  );
  return { puts, answered };
}

/**
 * Wait until every planned write has been answered AND the client has
 * had a turn to react to the last of them.
 */
async function settled(server: { answered: string[] }, count: number) {
  await waitFor(() => expect(server.answered).toHaveLength(count));
  await act(async () => {
    await sleep(20);
  });
}

function wrapper(): ({ children }: { children: ReactNode }) => ReturnType<typeof createElement> {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
}

function surfaces() {
  return {
    dataTheme: document.documentElement.getAttribute('data-theme'),
    stored: window.localStorage.getItem(STORAGE_KEY),
  };
}

const LIGHT = { mode: 'builtin', builtinTheme: 'light', customThemeId: null } as const;

/**
 * Two clicks, a tick apart.
 *
 * NOT two synchronous calls: `onMutate` opens with
 * `await cancelQueries`, so back-to-back calls both reach their
 * snapshot BEFORE either optimistic write has landed — and the bug
 * needs the second snapshot to see the first write. Measured: with the
 * two calls in one synchronous block, a baseline recaptured on every
 * write is indistinguishable from one captured once, and the guard
 * that fix depends on could be deleted with the suite still green. A
 * real double click is tens of milliseconds apart; one flushed tick is
 * the smallest gap that is honest about that.
 */
async function clickTwice(
  setBuiltin: (t: 'light' | 'dark') => void,
  first: 'light' | 'dark',
  second: 'light' | 'dark',
) {
  await act(async () => {
    setBuiltin(first);
  });
  await act(async () => {
    setBuiltin(second);
  });
}

beforeEach(() => {
  toastError.mockClear();
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('sk-389 (W-3) — two theme writes in flight', () => {
  test('a refusal does not erase the pick a LATER write had accepted', async () => {
    // Nothing stored (a person who has never picked in this browser),
    // account on light. Click dark — slow refusal — then light, which
    // the server takes at once.
    const server = stubServer(LIGHT, [
      { status: 500, delayMs: 80 },
      { status: 200 },
    ]);

    const { result } = renderHook(() => useTheme(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'));

    await clickTwice(result.current.setBuiltin, 'dark', 'light');

    // Both writes really were attempted — otherwise a hook that had
    // stopped talking to the server would satisfy everything below.
    await waitFor(() => expect(server.puts).toHaveLength(2));
    await settled(server, 2);
    // The refusal is reported.
    expect(toastError).toHaveBeenCalledTimes(1);

    // The colour the server ACCEPTED, on record in both places.
    const s1 = surfaces();
    expect(s1.dataTheme).toBe('light');
    expect(s1.stored).toBe('light');
    // Said as its own assertion because it is the consequence, not a
    // restatement: `null` here means «never picked», which gates the
    // OS-preference tracker and survives a logout.
    expect(window.localStorage.getItem(STORAGE_KEY)).not.toBeNull();
    expect(result.current.theme).toBe('light');
  });

  test('and the accepted colour wins even when it was the FIRST click', async () => {
    // The mirror case: dark is accepted, the light that follows is
    // refused. A fix that simply always kept the LAST intent would
    // pass the test above and fail here.
    // The delay is load-bearing: without it the first write settles
    // inside its own `act` and the two never overlap, so the case
    // would be two sequential writes wearing a concurrency test's
    // name.
    const server = stubServer(LIGHT, [{ status: 200, delayMs: 80 }, { status: 500 }]);

    const { result } = renderHook(() => useTheme(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'));

    await clickTwice(result.current.setBuiltin, 'dark', 'light');

    await waitFor(() => expect(server.puts).toHaveLength(2));
    await settled(server, 2);
    expect(toastError).toHaveBeenCalledTimes(1);

    const s2 = surfaces();
    expect(s2.dataTheme).toBe('dark');
    expect(s2.stored).toBe('dark');
    expect(result.current.theme).toBe('dark');
  });

  test('the newest ACCEPTED click wins, not the quickest response', async () => {
    // Both writes are taken; the first one answers late. Without the
    // mutation `scope` the two PUTs are in the air together, the
    // second is confirmed first and the FIRST one lands last — so the
    // client settles on the colour the user moved away from. The scope
    // makes the round trips run in click order, which is what makes
    // «the newest confirmed state» mean «the newest click».
    const server = stubServer(LIGHT, [
      { status: 200, delayMs: 80 },
      { status: 200 },
    ]);

    const { result } = renderHook(() => useTheme(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'));

    await clickTwice(result.current.setBuiltin, 'dark', 'light');

    await waitFor(() => expect(server.puts).toHaveLength(2));
    // The bodies arrive in the order they were clicked — the scope's
    // own contract, asserted so a fix that dropped it fails HERE and
    // not only through the state it leaves behind.
    expect(server.puts[0]).toContain('"builtinTheme":"dark"');
    expect(server.puts[1]).toContain('"builtinTheme":"light"');

    await settled(server, 2);
    const s3 = surfaces();
    expect(s3.dataTheme).toBe('light');
    expect(s3.stored).toBe('light');
    expect(toastError).not.toHaveBeenCalled();
  });

  test('a settled EARLIER write does not repaint over a later one still in flight', async () => {
    // The mid-chain half of the invariant, and the only one a
    // final-state assertion cannot see: while the newest write is
    // still in the air, nothing older may touch either surface —
    // neither an older ACCEPTANCE writing the server's answer over
    // the newer optimism, nor a drain-time reconcile firing early.
    // Either would repaint the shell for a whole round trip with the
    // colour the user has already clicked away from.
    //
    // BOTH answers are gated, and that is what makes the case real:
    // an ungated first write settles inside its own `act`, the chain
    // drains, and the second click starts a chain of its own with
    // nothing to overlap. Measured — with only the second gated, this
    // test passed with the newest-write paint guard DELETED.
    let openFirst = () => {};
    let openSecond = () => {};
    const first = new Promise<void>((resolve) => {
      openFirst = resolve;
    });
    const second = new Promise<void>((resolve) => {
      openSecond = resolve;
    });
    const server = stubServer(LIGHT, [
      { status: 200, gate: first },
      { status: 200, gate: second },
    ]);

    const { result } = renderHook(() => useTheme(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'));

    await clickTwice(result.current.setBuiltin, 'dark', 'light');

    // Tripwire: without it the reads below could be of a chain that
    // had not started.
    await waitFor(() => expect(server.puts).toHaveLength(1));

    // Let the FIRST write be accepted, with the second still open.
    openFirst();
    await settled(server, 1);

    // Nothing older has repainted: the newest click is what is on
    // screen and on record, and it stays that way until the server
    // has answered it.
    const midChain = surfaces();
    expect(midChain.dataTheme).toBe('light');
    expect(midChain.stored).toBe('light');

    openSecond();
    await settled(server, 2);
    const s4 = surfaces();
    expect(s4.dataTheme).toBe('light');
    expect(s4.stored).toBe('light');
    expect(toastError).not.toHaveBeenCalled();
  });

  test('and when BOTH are refused, the client is back where it started', async () => {
    // Guards the direction the two cases above cannot: a rollback that
    // wrote SOMETHING unconditionally would agree with itself and still
    // convert a person who never picked into one who did.
    const server = stubServer(LIGHT, [
      { status: 500, delayMs: 80 },
      { status: 500 },
    ]);

    const { result } = renderHook(() => useTheme(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'));

    await clickTwice(result.current.setBuiltin, 'dark', 'light');

    await waitFor(() => expect(server.puts).toHaveLength(2));
    await settled(server, 2);
    expect(toastError).toHaveBeenCalledTimes(2);

    const s5 = surfaces();
    expect(s5.dataTheme).toBe('light');
    expect(s5.stored).toBeNull();
    expect(result.current.theme).toBe('light');
  });
});
