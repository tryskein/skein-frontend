/**
 * sk-303.20 — client-side Pwned Passwords k-anonymity hint.
 *
 * Verifies the request shape against the real Web Crypto API (jsdom's
 * `crypto.subtle` — available in this project's Vitest/jsdom setup, see
 * PasswordPage.test.tsx for the same check made explicit) and that a
 * network failure degrades to 'unknown' without throwing.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { checkPwnedHint } from './pwnedCheck';

// SHA-1('password') = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8 (verified via
// Node's crypto module — see the task's implementation notes), so the
// k-anonymity prefix is '5BAA6' and the remaining suffix is
// '1E4C9B93F3F0682250B6CF8331B7EE68FD8'.
const PASSWORD = 'password';
const PREFIX = '5BAA6';
const SUFFIX = '1E4C9B93F3F0682250B6CF8331B7EE68FD8';

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('checkPwnedHint — request shape', () => {
  test('requests exactly the 5-char uppercase-hex prefix', async () => {
    fetchSpy.mockResolvedValue(new Response(`${SUFFIX}:123\r\n`, { status: 200 }));
    await checkPwnedHint(PASSWORD);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://api.pwnedpasswords.com/range/${PREFIX}`);
  });

  test('sends the Add-Padding header', async () => {
    fetchSpy.mockResolvedValue(new Response('', { status: 200 }));
    await checkPwnedHint(PASSWORD);
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['Add-Padding']).toBe('true');
  });

  test('does not send cookies (credentials: omit) — third-party origin', async () => {
    fetchSpy.mockResolvedValue(new Response('', { status: 200 }));
    await checkPwnedHint(PASSWORD);
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(init.credentials).toBe('omit');
  });
});

describe('checkPwnedHint — outcome mapping', () => {
  test('matching suffix in the response → found', async () => {
    fetchSpy.mockResolvedValue(
      new Response(`OTHERSUFFIXNOTMATCHING1234567890AB:1\r\n${SUFFIX}:3730471\r\n`, {
        status: 200,
      }),
    );
    await expect(checkPwnedHint(PASSWORD)).resolves.toBe('found');
  });

  test('no matching suffix → clean', async () => {
    fetchSpy.mockResolvedValue(
      new Response('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:1\r\n', { status: 200 }),
    );
    await expect(checkPwnedHint(PASSWORD)).resolves.toBe('clean');
  });

  test('non-200 response → unknown, no throw', async () => {
    fetchSpy.mockResolvedValue(new Response('', { status: 500 }));
    await expect(checkPwnedHint(PASSWORD)).resolves.toBe('unknown');
  });

  test('network failure (fetch rejects) → unknown, no throw', async () => {
    fetchSpy.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(checkPwnedHint(PASSWORD)).resolves.toBe('unknown');
  });
});

// sk-303.20 review (codex+grok Warning) — a hung connection used to leave
// the caller's promise (and the UI's "Checking against known breaches…"
// state) unresolved forever. checkPwnedHint now carries its own hard
// timeout and accepts an external AbortSignal so a caller (PasswordPage)
// can cancel a check that's no longer relevant.
describe('checkPwnedHint — timeout / cancellation', () => {
  // A fetch double that never settles on its own — only reacts to its
  // AbortSignal firing, exactly like a real hung TCP connection being
  // cancelled would.
  function neverResolvingFetch() {
    return vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        // Mirror real fetch: a signal that's ALREADY aborted by the time
        // fetch is called rejects immediately — 'abort' is a one-shot
        // event, so a listener attached after the fact would never fire.
        if (init?.signal?.aborted) {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
          return;
        }
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      });
    });
  }

  test('every request carries an AbortSignal', async () => {
    fetchSpy.mockResolvedValue(new Response('', { status: 200 }));
    await checkPwnedHint(PASSWORD);
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  test('a connection that never resolves times out to "unknown" instead of hanging forever', async () => {
    vi.useFakeTimers();
    try {
      fetchSpy.mockImplementation(neverResolvingFetch());
      const promise = checkPwnedHint(PASSWORD);
      // Nothing has settled yet — the internal timeout hasn't fired.
      let settled = false;
      void promise.then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(1000);
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(5000);
      await expect(promise).resolves.toBe('unknown');
    } finally {
      vi.useRealTimers();
    }
  });

  test('an externally aborted signal (e.g. the password changed) resolves to "unknown", not a hang', async () => {
    fetchSpy.mockImplementation(neverResolvingFetch());
    const controller = new AbortController();
    const promise = checkPwnedHint(PASSWORD, { signal: controller.signal });
    controller.abort();
    await expect(promise).resolves.toBe('unknown');
  });
});
