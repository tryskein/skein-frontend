/**
 * sk-285.7.6 — a broadcast `theme.updated` must not kill a live preview's
 * TTL unless it is about the theme the caller is actually wearing.
 *
 * ── The defect, stated as the thing this file reproduces ─────────────
 *
 * `theme.preview` paints an ARBITRARY variable map inline on <html>,
 * pins `data-theme="custom"` and arms a 10-minute auto-revert. That timer
 * is the only mechanism in the whole shell that ever takes those keys
 * back off again on its own — nothing else knows they are there, because
 * a preview belongs to no saved theme.
 *
 * `theme.updated` is BROADCAST: it fires for every theme in the system,
 * whoever owns it. It used to call `cancelAutoReset()` unconditionally,
 * right after validating `themeId` and before asking whether the theme in
 * question was the active one. On any theme but the active one the
 * handler then went on to touch a query nobody in this tab reads, so
 * nothing repainted — and the preview stayed on screen, with its own
 * arbitrary role names, until the tab was closed.
 *
 * ── Why the pair, and why the positive case is not decoration ────────
 *
 * A test that only asserts «the timer survived a foreign event» passes on
 * a build where `cancelAutoReset` is never called at all — i.e. on a
 * build that has traded this bug for the opposite one, where saving a
 * theme leaves the preview's revert armed to undo the new baseline ten
 * minutes later. The two cases have to be read together: the SAME event
 * type must cancel for the active theme and not cancel for another one,
 * which is a statement about the predicate rather than about the call.
 *
 * ── How «did the timer fire» is observed ────────────────────────────
 *
 * By its effect, not by spying on the module. The TTL callback is
 * `reapplyActiveTheme()`, which strips every key this runtime applied and
 * re-paints `data-theme`. `useTheme` is deliberately NOT mounted here, so
 * its module snapshot stays at the boot default (builtin / light) and the
 * revert is unambiguous: the preview key disappears and `data-theme` goes
 * back to a builtin value. If the timer was cancelled, nothing in this
 * harness touches <html> at all and both stay exactly as the preview left
 * them. One observation, two opposite readings, no mocking of the unit
 * under test.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as signalr from '@microsoft/signalr';
import { LiveEventsProvider } from './useLiveEvents';
import { ME_THEME_QUERY_KEY, THEMES_QUERY_KEY, themeQueryKey, type Theme as ApiTheme } from '../api/themes';
import { LIVE_INVALIDATION_WINDOW_MS } from '../lib/liveInvalidationBatcher';
import { stripAppliedVariables } from '../lib/themeRuntime';

const ACTIVE_THEME_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_THEME_ID = '22222222-2222-4222-8222-222222222222';

/** A role name from no dictionary at all — a preview may carry any key. */
const PREVIEW_KEY = '--zzz-preview-only';
const PREVIEW_VALUE = 'rgb(1, 2, 3)';

const TTL_MS = 10 * 60 * 1000;

// ─────────────────────────── Mocks ───────────────────────────

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u-1', username: 'admin', role: 'admin' } }),
}));

vi.mock('@microsoft/signalr', () => {
  const HubConnectionState = {
    Disconnected: 'Disconnected',
    Connecting: 'Connecting',
    Connected: 'Connected',
    Reconnecting: 'Reconnecting',
  } as const;
  const LogLevel = {
    Trace: 0, Debug: 1, Information: 2, Warning: 3, Error: 4, Critical: 5, None: 6,
  } as const;

  // Unlike the sk-64 suite's fake, this one RECORDS the handlers so a
  // test can deliver a frame — that is the whole point here.
  const registry: { handlers: Map<string, (payload: unknown) => void> } = {
    handlers: new Map(),
  };

  class FakeConn {
    state: string = HubConnectionState.Disconnected;
    on = vi.fn((method: string, cb: (payload: unknown) => void) => {
      registry.handlers.set(method, cb);
    });
    onclose = vi.fn();
    onreconnecting = vi.fn();
    onreconnected = vi.fn();
    stop = vi.fn(() => { this.state = HubConnectionState.Disconnected; return Promise.resolve(); });
    start = vi.fn(function (this: FakeConn) {
      this.state = HubConnectionState.Connected;
      return Promise.resolve();
    });
  }

  class HubConnectionBuilder {
    withUrl() { return this; }
    withAutomaticReconnect() { return this; }
    configureLogging() { return this; }
    build() { return new FakeConn(); }
  }

  return { HubConnectionBuilder, HubConnectionState, LogLevel, __mock: registry };
});

const mock = (signalr as unknown as {
  __mock: { handlers: Map<string, (payload: unknown) => void> };
}).__mock;

// ─────────────────────────── Harness ───────────────────────────

/**
 * Mount the provider with a cache that already knows the caller wears
 * ACTIVE_THEME_ID. The predicate under test reads exactly these two
 * fields, so seeding the cache is the whole fixture.
 */
async function renderProvider(): Promise<QueryClient> {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(ME_THEME_QUERY_KEY, {
    mode: 'custom',
    builtinTheme: 'light',
    customThemeId: ACTIVE_THEME_ID,
  });
  // Both theme rows exist in the cache so the handler's optimistic
  // setQueryData has something to merge into either way — otherwise the
  // "active" and "other" branches would differ by more than the id.
  const row = (id: string): ApiTheme => ({
    id,
    name: `theme-${id.slice(0, 4)}`,
    base: 'light',
    variables: { '--bg': '#ffffff' },
    createdBy: { id: 'u-1', username: 'admin', name: 'admin' },
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    updatedBy: null,
  } as unknown as ApiTheme);
  qc.setQueryData(themeQueryKey(ACTIVE_THEME_ID), row(ACTIVE_THEME_ID));
  qc.setQueryData(themeQueryKey(OTHER_THEME_ID), row(OTHER_THEME_ID));
  // `await act` rather than a bare render: the fake connection's start()
  // resolves on a microtask and flips provider state, which React would
  // otherwise report as an unwrapped update.
  await act(async () => {
    render(
      <QueryClientProvider client={qc}>
        <LiveEventsProvider>
          <span />
        </LiveEventsProvider>
      </QueryClientProvider>,
    );
  });
  return qc;
}

function deliver(method: string, payload: unknown): void {
  const handler = mock.handlers.get(method);
  if (!handler) throw new Error(`no handler registered for ${method}`);
  handler(payload);
}

const previewKeyOnRoot = () =>
  document.documentElement.style.getPropertyValue(PREVIEW_KEY);
const dataTheme = () => document.documentElement.getAttribute('data-theme');

/** Deliver a preview frame and assert it landed — the shared arrange. */
function arrangeLivePreview(): void {
  act(() => {
    deliver('theme.preview', { variables: { [PREVIEW_KEY]: PREVIEW_VALUE } });
  });
  expect(previewKeyOnRoot()).toBe(PREVIEW_VALUE);
  expect(dataTheme()).toBe('custom');
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  mock.handlers.clear();
  document.documentElement.removeAttribute('data-theme');
});

afterEach(() => {
  cleanup();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  // The runtime's appliedKeys Set is module state shared by every test in
  // this file; leave <html> and that Set clean for the next one.
  stripAppliedVariables();
  document.documentElement.style.removeProperty(PREVIEW_KEY);
  document.documentElement.removeAttribute('data-theme');
});

describe('theme.updated vs a live preview TTL (sk-285.7.6)', () => {
  test('an event about ANOTHER theme leaves the auto-revert armed', async () => {
    await renderProvider();
    arrangeLivePreview();

    act(() => {
      deliver('theme.updated', {
        themeId: OTHER_THEME_ID,
        variables: { '--bg': '#000000' },
      });
    });

    // Nothing repainted — the event was about a theme this tab does not
    // wear — so the preview is still up and the TTL is what has to end it.
    expect(previewKeyOnRoot()).toBe(PREVIEW_VALUE);

    act(() => {
      vi.advanceTimersByTime(TTL_MS);
    });

    expect(previewKeyOnRoot()).toBe('');
    expect(dataTheme()).not.toBe('custom');
  });

  test('an event about the ACTIVE theme cancels the auto-revert', async () => {
    await renderProvider();
    arrangeLivePreview();

    act(() => {
      deliver('theme.updated', {
        themeId: ACTIVE_THEME_ID,
        variables: { '--bg': '#000000' },
      });
    });

    act(() => {
      vi.advanceTimersByTime(TTL_MS);
    });

    // The timer was cancelled, so nothing in this harness stripped the
    // keys. In the shell the repaint comes from useTheme's applyActive,
    // which is deliberately out of this fixture — what is being pinned
    // here is that the TTL did NOT fire and undo a fresh baseline.
    expect(previewKeyOnRoot()).toBe(PREVIEW_VALUE);
    expect(dataTheme()).toBe('custom');
  });

  test('an event about the active theme id while the caller is on a BUILTIN does not cancel', async () => {
    // `customThemeId` survives a switch back to builtin (useTheme
    // preserves it so the user's pick is remembered), so the id alone is
    // not evidence that anything will repaint — `mode` is the other half
    // of the predicate, and without it this case would strand the preview
    // exactly like a foreign theme does.
    const qc = await renderProvider();
    qc.setQueryData(ME_THEME_QUERY_KEY, {
      mode: 'builtin',
      builtinTheme: 'light',
      customThemeId: ACTIVE_THEME_ID,
    });
    arrangeLivePreview();

    act(() => {
      deliver('theme.updated', {
        themeId: ACTIVE_THEME_ID,
        variables: { '--bg': '#000000' },
      });
    });
    act(() => {
      vi.advanceTimersByTime(TTL_MS);
    });

    expect(previewKeyOnRoot()).toBe('');
  });

  test('a malformed frame is still dropped before anything is touched', async () => {
    await renderProvider();
    arrangeLivePreview();

    act(() => {
      deliver('theme.updated', { themeId: '' });
      deliver('theme.updated', null);
      deliver('theme.updated', { variables: { '--bg': '#000' } });
    });
    act(() => {
      vi.advanceTimersByTime(TTL_MS);
    });

    // None of those name a theme, so none of them can be «the active
    // one»; the TTL is untouched and fires on schedule.
    expect(previewKeyOnRoot()).toBe('');
  });
});

// ───── sk-622.21 No. 74 — "Theme events": the three channels stay wired ─────
//
// T042 rewrote the event reaction and added the `signal` channel next to
// the theme channels. K18 row "Theme events": the three client methods and
// their handlers are not removed and keep their behaviour, their cache
// resets going through the same 1.5 s coalescing as every other frame.

describe('sk-622.21 No. 74 — theme channels after the reaction rewrite', () => {
  const invalidatedAfterWave = async (qc: QueryClient, key: readonly unknown[]) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LIVE_INVALIDATION_WINDOW_MS);
    });
    return qc.getQueryState(key)?.isInvalidated === true;
  };

  test('theme.user-pref.updated re-reads /me/theme and supersedes the preview', async () => {
    const qc = await renderProvider();
    arrangeLivePreview();

    act(() => {
      deliver('theme.user-pref.updated', {});
    });
    expect(await invalidatedAfterWave(qc, ME_THEME_QUERY_KEY)).toBe(true);

    act(() => {
      vi.advanceTimersByTime(TTL_MS);
    });
    // The auto-revert was cancelled: nothing in this harness stripped the
    // preview (the repaint belongs to useTheme, not mounted here).
    expect(previewKeyOnRoot()).toBe(PREVIEW_VALUE);
  });

  test('theme.updated merges the variables at once and re-reads the theme and the catalogue', async () => {
    const qc = await renderProvider();
    qc.setQueryData(THEMES_QUERY_KEY, []);

    act(() => {
      deliver('theme.updated', { themeId: OTHER_THEME_ID, variables: { '--bg': '#000000' } });
    });
    // Optimistic merge, before any wave.
    expect(qc.getQueryData<ApiTheme>(themeQueryKey(OTHER_THEME_ID))?.variables).toEqual({ '--bg': '#000000' });
    expect(qc.getQueryState(themeQueryKey(OTHER_THEME_ID))?.isInvalidated).toBe(false);

    expect(await invalidatedAfterWave(qc, themeQueryKey(OTHER_THEME_ID))).toBe(true);
    expect(qc.getQueryState(THEMES_QUERY_KEY)?.isInvalidated).toBe(true);
    // A theme frame is not a task event: the theme of another row is not touched.
    expect(qc.getQueryState(themeQueryKey(ACTIVE_THEME_ID))?.isInvalidated).toBe(false);
  });

  test('theme.preview, theme.updated, theme.user-pref.updated are registered beside event and signal', async () => {
    await renderProvider();
    for (const method of ['theme.preview', 'theme.updated', 'theme.user-pref.updated', 'event', 'signal']) {
      expect(mock.handlers.has(method), method).toBe(true);
    }
  });
});
