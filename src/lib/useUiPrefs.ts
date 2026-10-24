import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  ME_UI_PREFS_QUERY_KEY,
  getMeUiPrefs,
  putMeUiPrefs,
  type UiPrefs,
  type UiPrefsUpdate,
} from '../api/uiPrefs';
import { useAuth } from '../auth/AuthContext';
import { useToaster } from '../components/Toaster';

/**
 * The cache key of ONE person's settings.
 *
 * sk-551.5 (review W1) — the key carries the user id. The settings are
 * personal, and a logout followed by another login in the same tab does
 * not reload the page or clear the cache: without the id the second person
 * saw the first one's settings, and a click wrote them into their profile.
 */
export function uiPrefsKey(userId: string) {
  return [...ME_UI_PREFS_QUERY_KEY, userId] as const;
}

/**
 * The state a chain of overlapping writes falls back to — one per person.
 *
 * sk-551.5 (review C1). Two clicks in quick succession used to send two
 * PUTs that raced: an older answer arriving later repainted the cache over
 * the newer click, and an older refusal rolled the cache back over a newer
 * optimistic value. The cure is the one
 * `useTheme.ts#ME_THEME_MUTATION_SCOPE` documents (read «Why `scope` alone
 * does not fix it» there):
 *
 *   - a mutation `scope` per person makes the PUTs leave and land in CLICK
 *     order — but `onMutate` runs before the scope's gate, so it cannot by
 *     itself keep a rollback from undoing a later click;
 *   - so the rollback belongs to the CHAIN of writes that overlap in time:
 *     the first write records the last settings the server confirmed,
 *     every acceptance advances that record, and only when the chain
 *     drains is the cache put back onto it — a no-op when the last write
 *     was taken;
 *   - an acceptance paints the cache only if it is the newest write, so an
 *     older answer never repaints over a newer click.
 *
 * sk-551.7 — ONE chain for every field of the record, not one per control.
 * The window checkboxes and the density switch write the same row, and the
 * server answers each PUT with the WHOLE record; two chains would each
 * hold a «confirmed» record with the other control's field frozen at the
 * moment the chain opened, and the later rollback would undo the other
 * control's accepted write. One scope, one chain: every acceptance carries
 * every field as the server now holds it.
 *
 * Kept per QueryClient and per user, outside any component: the scope is
 * global to the QueryClient, so every mounted reader shares one queue and
 * must share one record of it.
 */
interface WriteChain {
  inFlight: number;
  started: number;
  confirmed: UiPrefs | undefined;
}
const writeChains = new WeakMap<QueryClient, Map<string, WriteChain>>();

function chainOf(qc: QueryClient, userId: string): WriteChain {
  let perUser = writeChains.get(qc);
  if (perUser === undefined) {
    perUser = new Map();
    writeChains.set(qc, perUser);
  }
  let chain = perUser.get(userId);
  if (chain === undefined) {
    chain = { inFlight: 0, started: 0, confirmed: undefined };
    perUser.set(userId, chain);
  }
  return chain;
}

/**
 * Open (or join) a chain — SYNCHRONOUSLY, in the click handler. TanStack
 * runs `onMutate` a microtask after `mutate()`, so two clicks in one tick
 * would both compute their value from the cache before either had painted
 * its own; the second click would then drop the first one's change.
 */
function beginWrite(qc: QueryClient, userId: string): number {
  const chain = chainOf(qc, userId);
  if (chain.inFlight === 0) {
    chain.confirmed = qc.getQueryData<UiPrefs>(uiPrefsKey(userId));
  }
  chain.inFlight += 1;
  chain.started += 1;
  return chain.started;
}

function endWrite(qc: QueryClient, userId: string): void {
  const chain = chainOf(qc, userId);
  chain.inFlight -= 1;
  if (chain.inFlight > 0) return;
  chain.inFlight = 0;
  if (chain.confirmed !== undefined) {
    qc.setQueryData<UiPrefs>(uiPrefsKey(userId), chain.confirmed);
  }
}

interface Write {
  userId: string;
  /** Only the fields this click changes — the PUT is partial. */
  patch: UiPrefsUpdate;
  /** This write's place in its chain (`beginWrite`). */
  seq: number;
  /** What the toast says when the server refuses this write. */
  failMessage: string;
}

export interface UiPrefsApi {
  /** The signed-in person's id, or `null` when nobody is signed in. */
  userId: string | null;
  /**
   * The signed-in person's OWN settings, or `undefined` until they arrive
   * (and when the request failed). Never another person's: the cache key
   * carries the user id.
   */
  prefs: UiPrefs | undefined;
  /**
   * Change some fields. Applied at once (optimistic) and sent as a PARTIAL
   * PUT carrying only those fields. `patch` is computed from the person's
   * loaded settings; a call before they arrived does nothing — a value
   * computed from «nothing loaded» could overwrite what they had stored.
   * `failMessage` is the toast on refusal. Returns whether the write was
   * started (false: nobody signed in, or their settings not in yet).
   */
  update: (patch: (current: UiPrefs) => UiPrefsUpdate, failMessage: string) => boolean;
}

/**
 * sk-551.5 / sk-551.7 — the signed-in person's appearance settings
 * (`/api/v1/me/ui-prefs`): one query per person, shared by every reader
 * (the Appearance controls in the account menu, the shell deciding how to
 * draw the selected issue, `DensitySync` writing `<html data-density>`),
 * so a click in the menu re-renders them all in the same frame. No person
 * known — no query: nothing is shown and nothing can be written.
 *
 * The write is OPTIMISTIC: the cache takes the new value before the
 * request leaves; a refusal says so in a toast, and once the chain of
 * overlapping writes drains the cache stands on the newest settings the
 * server actually took (see `WriteChain`).
 */
export function useUiPrefs(): UiPrefsApi {
  const qc = useQueryClient();
  const toaster = useToaster();
  const userId = useAuth().user?.id ?? null;

  const query = useQuery<UiPrefs>({
    queryKey: uiPrefsKey(userId ?? ''),
    queryFn: getMeUiPrefs,
    enabled: userId !== null,
    staleTime: 60_000,
  });

  const mutation = useMutation<UiPrefs, Error, Write>({
    scope: { id: `me-ui-prefs:${userId ?? ''}` },
    mutationFn: ({ patch }) => putMeUiPrefs(patch),
    onError: (_err, { failMessage }) => {
      // No rollback here — that is `onSettled`'s, once the chain drains.
      toaster.error(failMessage);
    },
    onSuccess: (server, { userId: owner, seq }) => {
      const chain = chainOf(qc, owner);
      chain.confirmed = server;
      if (seq === chain.started) {
        qc.setQueryData<UiPrefs>(uiPrefsKey(owner), server);
      }
    },
    onSettled: (_data, _err, { userId: owner }) => {
      endWrite(qc, owner);
    },
  });

  const { mutate } = mutation;
  const update = useCallback(
    (makePatch: (current: UiPrefs) => UiPrefsUpdate, failMessage: string): boolean => {
      if (userId === null) return false;
      const loaded = qc.getQueryData<UiPrefs>(uiPrefsKey(userId));
      // Only settings read for THIS person may be edited.
      if (loaded === undefined) return false;
      const patch = makePatch(loaded);
      // Bookkeeping and the optimistic paint happen HERE, before `mutate`
      // (see `beginWrite`); `onSettled` closes the write.
      const seq = beginWrite(qc, userId);
      void qc.cancelQueries({ queryKey: uiPrefsKey(userId) });
      qc.setQueryData<UiPrefs>(uiPrefsKey(userId), { ...loaded, ...patch });
      mutate({ userId, patch, seq, failMessage });
      return true;
    },
    [qc, mutate, userId],
  );

  return { userId, prefs: userId === null ? undefined : query.data, update };
}
