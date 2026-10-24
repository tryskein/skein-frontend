/**
 * sk-303.20 — client-side Pwned Passwords k-anonymity hint.
 *
 * Only ever called when the server has reported (via
 * GET /api/v1/me/password/policy) that the pwned check is enabled for this
 * deployment — see PasswordPage.tsx. That gate is what keeps a
 * closed-network deployment from making an unexpected outbound browser
 * request just because a user opened this page: the server is the single
 * source of truth for "do we call out to a third party", never this
 * module deciding on its own.
 *
 * Model: SHA-1(password) is computed locally via the Web Crypto API; only
 * the first 5 hex characters (the k-anonymity prefix) are sent to the
 * range endpoint. The service returns every suffix sharing that prefix,
 * and the match is decided locally — the password and its full hash never
 * leave the browser. Same contract as internal/pwned on the server side
 * (see the Go client for the shared reasoning).
 */

export type PwnedHintState = 'idle' | 'checking' | 'clean' | 'found' | 'unknown';

const PWNED_RANGE_URL = 'https://api.pwnedpasswords.com/range/';

/**
 * sk-303.20 review (codex + grok Warning) — a hung TCP/HTTP connection to
 * the third-party range endpoint used to leave the caller's promise (and
 * the UI's "Checking against known breaches…" state) unresolved forever;
 * fetch has no default timeout. This is the hard ceiling on that call —
 * past it we give up and report 'unknown', same as any other failure.
 */
const PWNED_FETCH_TIMEOUT_MS = 5000;

/**
 * Checks `password` against the Pwned Passwords k-anonymity range API.
 * Returns 'found' / 'clean' on a definitive answer, 'unknown' on any
 * failure (network unreachable, non-200, blocked by a firewall, timeout,
 * or the caller aborting via `options.signal`) — this is a UX hint, not a
 * gate, so a failure here is swallowed rather than surfaced as an error;
 * see PasswordPage's submit logic, which never blocks on this result.
 *
 * `options.signal` lets the caller cancel an in-flight check — e.g. the
 * new-password field changed since this check started, or the component
 * unmounted. Cancelling it (or hitting the internal timeout above) both
 * resolve to 'unknown' rather than rejecting, so callers never need a
 * separate catch path for "I cancelled this on purpose".
 */
export async function checkPwnedHint(
  password: string,
  options: { signal?: AbortSignal } = {},
): Promise<PwnedHintState> {
  // A manual AbortController (not AbortSignal.timeout/any) so the timeout
  // path is exercisable deterministically with fake timers in tests, and
  // so a caller-supplied signal and the internal timeout compose without
  // depending on AbortSignal.any browser support.
  const requestController = new AbortController();
  const timeoutId = setTimeout(() => requestController.abort(), PWNED_FETCH_TIMEOUT_MS);
  const onExternalAbort = () => requestController.abort();
  options.signal?.addEventListener('abort', onExternalAbort);

  try {
    const bytes = new TextEncoder().encode(password);
    const digest = await crypto.subtle.digest('SHA-1', bytes);
    const hex = [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
      .join('');
    const prefix = hex.slice(0, 5);
    const suffix = hex.slice(5);

    const res = await fetch(PWNED_RANGE_URL + prefix, {
      headers: { 'Add-Padding': 'true' },
      // Deliberately no credentials: this is a third-party origin, not
      // ours — no cookie belongs on this request.
      credentials: 'omit',
      signal: requestController.signal,
    });
    if (!res.ok) return 'unknown';
    const body = await res.text();
    const found = body
      .split('\n')
      .some((line) => line.split(':')[0]?.trim() === suffix);
    return found ? 'found' : 'clean';
  } catch {
    // Network unreachable, blocked, timed out, aborted, or any other
    // failure — a UX hint that couldn't be computed, not an error the
    // user needs to see.
    return 'unknown';
  } finally {
    clearTimeout(timeoutId);
    options.signal?.removeEventListener('abort', onExternalAbort);
  }
}
