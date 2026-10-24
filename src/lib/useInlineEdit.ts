/**
 * Inline-edit hook (F5, Q12).
 *
 * Pattern:
 *   - User types into a controlled input.
 *   - 2s after the last keystroke, flush via `onSave`.
 *   - On blur, cancel the pending timer and flush immediately if dirty.
 *   - On `onSave` error, surface via `error` but do NOT revert the
 *     local value — the user keeps their text so they can fix and
 *     retry. They can also paste it elsewhere.
 *
 * Server pushes:
 *   When a SignalR live event refetches the issue and `initialValue`
 *   changes from underneath us, we reset the local state ONLY if the
 *   user has no text the server has not confirmed (sk-425: judged
 *   against the last confirmed save, so an optimistic write and its
 *   rollback are not mistaken for a server push). Otherwise we let them keep typing —
 *   their work-in-progress is more important than reflecting the
 *   server's view of a field they're editing right now.
 *
 * Generic shape:
 *   The hook treats `initialValue` and the saved value as the same
 *   type T, but the input itself is always a string. Callers can
 *   override `serialize` / `parse` to bridge a non-string T (e.g.
 *   number priority). Default serialize/parse are identity for strings.
 *
 * No useEffect for the timer — we own a ref and clear it on unmount,
 * blur, and fresh keystrokes. Effects would re-run on every value
 * change which is the wrong granularity.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseInlineEditArgs<T> {
  /**
   * Source of truth for the field — typically `issue.title` etc.
   * When this prop changes from outside (e.g. live refetch) we reset
   * local state, but only when the user isn't mid-edit.
   */
  initialValue: T;
  /** T → string (input value). Default: identity for strings. */
  serialize?: (v: T) => string;
  /** string (input value) → T (passed to onSave). Default: identity. */
  parse?: (s: string) => T;
  /** Called after the debounce timer or on-blur flush. */
  onSave: (v: T) => Promise<void>;
  /** Default 2000ms (Q12). */
  debounceMs?: number;
}

export interface UseInlineEditResult {
  /** Controlled value for the input — always a string. */
  value: string;
  /** Update local state and (re)start the debounce timer. */
  setValue: (v: string) => void;
  /** Cancel any pending timer and flush immediately if dirty. */
  onBlur: () => void;
  /** True iff `value` differs from the serialised initialValue. */
  isDirty: boolean;
  /** True while the most recent `onSave` is in flight. */
  isFlushing: boolean;
  /** Last save error, or null. Cleared on next setValue. */
  error: Error | null;
  /**
   * sk-425 — save the current text again now (no debounce). A no-op
   * when nothing is unsaved. The explicit "retry" after a refusal; the
   * text itself never left the hook.
   */
  retry: () => void;
}

const DEFAULT_DEBOUNCE_MS = 2000;

function defaultSerialize<T>(v: T): string {
  // String values pass through; null/undefined become empty string.
  if (v === null || v === undefined) return '';
  return typeof v === 'string' ? v : String(v);
}

export function useInlineEdit<T>(
  args: UseInlineEditArgs<T>,
): UseInlineEditResult {
  const {
    initialValue,
    onSave,
    debounceMs = DEFAULT_DEBOUNCE_MS,
  } = args;
  const serialize = args.serialize ?? (defaultSerialize as (v: T) => string);
  // Default parse: identity for strings. Callers with a non-string T
  // MUST supply a real parse — TS doesn't enforce it because the
  // return type is `T` and the runtime would already cast.
  const parse = args.parse ?? ((s: string) => s as unknown as T);

  const initialString = serialize(initialValue);

  const [value, setValueState] = useState<string>(initialString);
  const [isFlushing, setIsFlushing] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  // The "last known clean" string. Updated after a successful save and
  // when the parent pushes a new initialValue while we're not dirty.
  // `isDirty` is computed against this — NOT against `initialString` —
  // to eliminate the post-save flicker where the just-saved value is
  // still flagged dirty until the parent's invalidation lands a fresh
  // initialValue (the round-trip can be 100ms+ on slow networks).
  const [lastSaved, setLastSaved] = useState<string>(initialString);

  const isDirty = value !== lastSaved;

  // Refs so the debounce closure always sees the latest values without
  // having to add them to a dep array (which would re-create the timer
  // schedule on every keystroke).
  const valueRef = useRef(value);
  valueRef.current = value;
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const parseRef = useRef(parse);
  parseRef.current = parse;
  const initialStringRef = useRef(initialString);
  initialStringRef.current = initialString;
  const lastSavedRef = useRef(lastSaved);
  lastSavedRef.current = lastSaved;
  // Track the *previous* serialised initialValue so the external-sync
  // effect can decide cleanness against the value the user last saw,
  // not the current `value !== initialString` which is true the moment
  // initialValue changes (and would lock out every external update).
  // Distinct purpose from `lastSaved`: this one drives the "should we
  // adopt the external change?" decision; `lastSaved` drives `isDirty`.
  const prevInitialStringRef = useRef(initialString);

  // Pending timer + dirty flag. The timer id is stored on a ref so
  // setValue / onBlur / unmount can all clear it without state churn.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDirtyRef = useRef(false);
  isDirtyRef.current = isDirty;

  // Race-prevention: each flush gets a monotonic id. Only the LATEST
  // flush is allowed to commit `lastSaved` / `error` state; older
  // flushes that resolve out of order become no-ops. Without this,
  // a slow earlier write resolving after a fast later write would
  // overwrite the newer "saved" baseline and leave the input visibly
  // dirty on a value the server already accepted.
  const flushIdRef = useRef(0);
  // True while a flush is currently in-flight; a setValue call during
  // that window flips `pendingFlushRef` so we re-run after the
  // current flush settles (always saving the freshest value).
  const inFlightRef = useRef(false);
  const pendingFlushRef = useRef(false);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  // Internal flush — used by both the debounce timer and onBlur.
  // Reads from refs so a stale closure can't fire a stale value.
  const flush = useCallback(async () => {
    if (!isDirtyRef.current) return;
    if (inFlightRef.current) {
      // Another flush is in-flight; mark a re-flush so the freshest
      // value goes out after it settles. Don't kick a parallel
      // request — that's the race condition we're avoiding.
      pendingFlushRef.current = true;
      return;
    }
    inFlightRef.current = true;
    const myId = ++flushIdRef.current;
    const current = valueRef.current;
    setIsFlushing(true);
    try {
      await onSaveRef.current(parseRef.current(current));
      // Only commit if THIS flush is still the most recent. A newer
      // flush (started before this one resolved — but inFlightRef
      // gates that, so this is defensive) would have a higher id.
      if (myId === flushIdRef.current) {
        setError(null);
        // Mark this string as "saved" so isDirty flips to false right
        // away — without waiting for the parent's invalidation refetch
        // to land. When the refetch eventually arrives with the same
        // string, the external-sync effect's "value !== prev" guard
        // makes it a no-op (prevInitialString updates, lastSaved is
        // already correct).
        setLastSaved(current);
      }
    } catch (err) {
      if (myId === flushIdRef.current) {
        // Save failed — leave lastSaved untouched; the user's current
        // value is still genuinely dirty and should keep flagging so
        // the UI can show the error and let them retry. Normalise
        // the rejection to a real Error so consumers can read .message
        // without unsafe casts.
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      inFlightRef.current = false;
      setIsFlushing(false);
      // If a later setValue queued another flush while we were
      // running, fire it now with the freshest value. We don't
      // re-debounce here — the queued flush represents text the user
      // typed during the in-flight window, and they've already
      // committed to saving by the time the previous flush returned.
      if (pendingFlushRef.current) {
        pendingFlushRef.current = false;
        if (isDirtyRef.current) {
          void flush();
        }
      }
    }
  }, []);

  const setValue = useCallback(
    (next: string) => {
      // Clear the previous error so the UI doesn't carry a stale
      // error banner while the user is mid-typing a fix.
      setError(null);
      setValueState(next);
      clearTimer();
      // If the user typed back to the last-saved value there's nothing
      // new to flush. We check `lastSaved` (not `initialString`) so the
      // cancel still works during the post-save window where the
      // parent's invalidation refetch hasn't landed yet.
      if (next === lastSavedRef.current) {
        return;
      }
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void flush();
      }, debounceMs);
    },
    [debounceMs, flush],
  );

  const onBlur = useCallback(() => {
    clearTimer();
    if (isDirtyRef.current) {
      void flush();
    }
  }, [flush]);

  // Same flush as blur: the retry after a refusal is "save what is in
  // the editor now".
  const retry = onBlur;

  // Reset local state when the underlying initial value changes from
  // outside — but only if the user has nothing unconfirmed.
  //
  // sk-425 — "nothing unconfirmed" means: local `value` equals
  // `lastSaved`, the last string the SERVER accepted (or the last
  // server value we adopted). It used to be "value equals the previous
  // initialValue", and that broke under an optimistic writer: the
  // card's PATCH writes the typed text X into the cache before the
  // request (initialValue old → X, so "previous" became X), and on
  // refusal rolls the cache back (X → old). The rollback then looked
  // like "the server changed a field the user was not editing" —
  // value === previous === X — and replaced the typed text with the
  // server's, before `onSave` had even reported the refusal.
  //
  // Against `lastSaved` neither step is adopted: the optimistic X and
  // the rollback both arrive while value X differs from the confirmed
  // baseline, so the draft stays, `isDirty` stays true, and a refusal
  // lands on `error` with the text still in place. A successful save
  // moves `lastSaved` to X in `flush`, after which the server's echo of
  // X (and any later change by someone else) is adopted as before.
  useEffect(() => {
    const prev = prevInitialStringRef.current;
    if (initialString !== prev) {
      if (valueRef.current === lastSavedRef.current) {
        // No unconfirmed input — adopt the new server value and make it
        // the new clean baseline.
        setValueState(initialString);
        setLastSaved(initialString);
      }
      // else: the user has input the server has not confirmed — keep
      // it. Their next blur, debounce flush or `retry` reconciles.
      prevInitialStringRef.current = initialString;
    }
  }, [initialString]);

  // Cleanup any pending timer on unmount. We deliberately do NOT
  // flush on unmount — if a user navigates away mid-edit, their text
  // is lost, but flushing without their explicit intent (blur or
  // wait) feels worse: it could fire a save the user meant to abandon.
  useEffect(() => {
    return () => {
      clearTimer();
    };
  }, []);

  return {
    value,
    setValue,
    onBlur,
    isDirty,
    isFlushing,
    error,
    retry,
  };
}
