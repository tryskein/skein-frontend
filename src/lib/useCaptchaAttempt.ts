import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * sk-674.18 — one Turnstile challenge for a send the server answered with
 * `captcha_required` (T057 invitation form; T067 resending an invitation).
 *
 * An attempt is the send the challenge was issued for, frozen at the moment
 * the server asked for it (`payload`), and its number (`id` — the widget's
 * `key`, so a new attempt remounts it: a token is single-use, and after a
 * refused token Cloudflare's guidance is a fresh widget).
 *
 * A token passes only for the attempt that is still current and only once:
 * a token of an attempt that was cancelled or replaced is dropped (review
 * fe/4 #1), and a late callback of a widget whose token already went sends
 * nothing. Unmounting the owner ends the attempt as well:
 * a token arriving after the form is closed or the page is left sends
 * nothing.
 */
export interface CaptchaAttempt<P> {
  id: number;
  payload: P;
}

export interface CaptchaAttemptState<P> {
  /** The current attempt; null — no widget. */
  attempt: CaptchaAttempt<P> | null;
  /** A new challenge for `payload` (replaces any current one). */
  start: (payload: P) => void;
  /** No challenge any more: later tokens send nothing. */
  cancel: () => void;
  /** The widget of attempt `id` handed a token (null — expired or failed). */
  onToken: (id: number, token: string | null) => void;
  /** The Turnstile script could not be loaded for the current attempt; a new attempt clears it. */
  broken: boolean;
  markBroken: () => void;
}

/** `send` repeats the frozen send with the token; called at most once per attempt. */
export function useCaptchaAttempt<P>(send: (payload: P, token: string) => void): CaptchaAttemptState<P> {
  const [attempt, setAttempt] = useState<CaptchaAttempt<P> | null>(null);
  const current = useRef<CaptchaAttempt<P> | null>(null);
  current.current = attempt;
  const seq = useRef(0);
  // The attempt whose token was already sent — a token is single-use.
  const sent = useRef<number | null>(null);
  const sendRef = useRef(send);
  sendRef.current = send;
  const [broken, setBroken] = useState(false);

  const start = useCallback((payload: P) => {
    seq.current += 1;
    const next = { id: seq.current, payload };
    // The ref follows at once: a token of the replaced attempt arriving
    // before the re-render is already stale.
    current.current = next;
    setAttempt(next);
    // A new attempt tries the widget again: after a failed script load the
    // next mount loads it anew (`Turnstile.tsx#loadTurnstile`).
    setBroken(false);
  }, []);
  const cancel = useCallback(() => {
    current.current = null;
    setAttempt(null);
  }, []);
  const onToken = useCallback((id: number, token: string | null) => {
    const now = current.current;
    if (token === null || now === null || now.id !== id) return;
    if (sent.current === id) return;
    sent.current = id;
    sendRef.current(now.payload, token);
  }, []);
  const markBroken = useCallback(() => setBroken(true), []);
  useEffect(
    () => () => {
      current.current = null;
    },
    [],
  );

  return { attempt, start, cancel, onToken, broken, markBroken };
}
